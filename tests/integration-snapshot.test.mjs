import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { GroupStore, git } from '../.pi/runtime/group-store.mjs';
import { currentSharedContext } from '../.pi/runtime/shared-context.mjs';
import { startTask } from '../.pi/runtime/group-service.mjs';
import { registerFixtureGroup } from './group-fixture.mjs';
import { createIntegrationSnapshot, inspectIntegrationSnapshot, bindIntegrationVerification, finalizeIntegrationSnapshot } from '../.pi/runtime/integration-snapshot.mjs';

function cohort(integrationArgs=['-e','process.exit(0)']) {
  const root=mkdtempSync(join(tmpdir(),'pi-integration-')), main=join(root,'main'); mkdirSync(main);
  git(main,'init','-b','develop'); for(const [k,v] of Object.entries({ 'user.name':'Integration Test','user.email':'test@example.invalid','core.autocrlf':'false' })) git(main,'config',k,v);
  mkdirSync(join(main,'.pi'),{recursive:true}); writeFileSync(join(main,'.pi/project.json'),JSON.stringify({integration:{executable:process.execPath,args:integrationArgs}}));
  mkdirSync(join(main,'docs'),{recursive:true});writeFileSync(join(main,'docs/module-decoupling-validation.md'),'# Validation\nPending.\n');
  writeFileSync(join(main,'base.txt'),'base\n'); git(main,'add','.');git(main,'commit','-m','base');
  const store=new GroupStore(main);
  for(const id of ['alpha','beta','eval']) registerFixtureGroup(store,id,join(root,id));
  for(const id of ['alpha','beta','eval']) { const g=store.group(id); git(main,'add',`groups/${id}/group.md`); }
  // Registration commits leave all idle branches synced to the same final Lead revision.
  for(const id of ['alpha','beta','eval']) { const g=store.group(id); git(g.worktree,'merge','--ff-only','develop'); }
  const base=git(main,'rev-parse','HEAD');
  function task(group,taskId,prodPath=null,beforeDelivery=null,extra={}) {
    const g=store.group(group); const t=startTask(store,group,{task_id:taskId,objective:'deliver reviewed work',acceptance:['reviewed'],base_ref:'develop',integration_id:'batch',documentation_paths:extra.documentationPaths||[]});
    const prefix=`groups/${group}/tasks/${taskId}`, write=(name,body=`# ${name}\nPass.\n`)=>{mkdirSync(join(g.worktree,prefix),{recursive:true});writeFileSync(join(g.worktree,prefix,name),body);return `${prefix}/${name}`;};
    const submit=(role,kind,name,extra={})=>store.submit({group_id:group,role,task_id:taskId,generation:t.generation},{kind,path:write(name),...extra});
    submit('coordinator','task','task.md',extra.classified?{task_type:prodPath?'small_change':'non_change',planning:'direct'}:{});if(!extra.classified){submit('executor','plan','plan.md');submit('validator','plan_review','plan-review.md');}
    if(prodPath){mkdirSync(join(g.worktree,dirname(prodPath)),{recursive:true});writeFileSync(join(g.worktree,prodPath),`${group} implementation\n`);}
    for(const [path,content] of Object.entries(extra.files||{})){mkdirSync(join(g.worktree,dirname(path)),{recursive:true});writeFileSync(join(g.worktree,path),content);}
    write('implementation.md','# implementation\n');git(g.worktree,'add','.');git(g.worktree,'commit','-m',`delivery ${taskId}`);const commit=git(g.worktree,'rev-parse','HEAD');
    if(beforeDelivery) beforeDelivery({g,t,write,commit});
    store.submit({group_id:group,role:'executor',task_id:taskId,generation:t.generation},{kind:'implementation',round:1,commit,path:`${prefix}/implementation.md`});
    if(extra.classified && extra.documentationPath) writeFileSync(join(g.worktree,extra.documentationPath),extra.documentationContent);
    submit('validator','code_review','code-review-01.md',{round:1,commit,verdict:'pass'});
    if(!extra.classified && extra.documentationPath) writeFileSync(join(g.worktree,extra.documentationPath),extra.documentationContent);
    if(!extra.classified){submit('validator','documentation','documentation-1-1.md',{round:1});submit('coordinator','documentation_review','documentation-review-1-1.md',{round:1,verdict:'pass'});}store.submit({group_id:group,role:'coordinator',task_id:taskId,generation:t.generation},{kind:'delivery',path:write('delivery.md','# Delivery\nPass.\n\n## Shared knowledge\nOwn '+group+' implementation; see group.md.\n'),shared_context:{mode:'update'}});
    store.accept(taskId,'Lead checked evidence'); return store.task(taskId);
  }
  const cleanup=()=>{store.close();rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});};
  return {root,main,store,task,cleanup,base};
}

test('snapshot combines two exact reviewed deliveries and records immutable candidate identity',()=>{
  const f=cohort();try{
    f.task('alpha','A1','alpha.txt');f.task('beta','B1','beta.txt');
    const snapshot=createIntegrationSnapshot(f.store,{integration_id:'batch',task_ids:['A1','B1'],verification_group_id:'eval',worktree:join(f.root,'candidate')});
    assert.equal(snapshot.base_commit,f.base);assert.equal(git(snapshot.worktree,'show','HEAD:alpha.txt'),'alpha implementation');assert.equal(git(snapshot.worktree,'show','HEAD:beta.txt'),'beta implementation');
    assert.equal(inspectIntegrationSnapshot(f.store,'batch').snapshot_commit,snapshot.candidate_commit);
  }finally{f.cleanup();}
});

test('candidate creation rejects a member whose delivery has not passed both reviews',()=>{
  const f=cohort();try{
    f.task('alpha','A1','alpha.txt');
    startTask(f.store,'beta',{task_id:'B1',objective:'work',acceptance:['done'],base_ref:'develop',integration_id:'batch'});
    assert.throws(()=>createIntegrationSnapshot(f.store,{integration_id:'batch',task_ids:['A1','B1'],verification_group_id:'eval',worktree:join(f.root,'candidate')}),/passing exact code and documentation review/);
    f.store.db.prepare("DELETE FROM artifacts WHERE task_id='A1' AND kind='delivery'").run();
    assert.throws(()=>createIntegrationSnapshot(f.store,{integration_id:'batch',task_ids:['A1','B1'],verification_group_id:'eval',worktree:join(f.root,'candidate')}),/Coordinator delivery submission/);
  }finally{f.cleanup();}
});

test('independent evaluation can bind after candidate creation and binding is idempotent',()=>{
  const f=cohort();try{
    f.task('alpha','A1','alpha.txt');f.task('beta','B1','beta.txt');
    const snap=createIntegrationSnapshot(f.store,{integration_id:'batch',task_ids:['A1','B1'],verification_group_id:'eval',worktree:join(f.root,'candidate')});
    const t=startTask(f.store,'eval',{task_id:'E1',objective:'wait for and evaluate the batch candidate',acceptance:['independent reference tests pass'],base_ref:'develop',integration_id:'batch'});
    const binding=bindIntegrationVerification(f.store,'batch','E1');
    assert.deepEqual(binding,{task_id:'E1',integration_id:'batch',commit:snap.snapshot_commit,tree:snap.snapshot_tree});
    assert.deepEqual(bindIntegrationVerification(f.store,'batch','E1'),binding);
    assert.deepEqual(f.store.task('E1').verification_snapshot,{integration_id:'batch',commit:snap.snapshot_commit,tree:snap.snapshot_tree});
  }finally{f.cleanup();}
});

test('end to end finalization merges accepted members plus independently bound reference tests and replays complete',()=>{
  const f=cohort();try{
    f.task('alpha','A1','alpha.txt');f.task('beta','B1','beta.txt');
    const snap=createIntegrationSnapshot(f.store,{integration_id:'batch',task_ids:['A1','B1'],verification_group_id:'eval',worktree:join(f.root,'candidate')});
    f.task('eval','E1','tests/reference.test.js',()=>bindIntegrationVerification(f.store,'batch','E1'),{documentationPaths:['docs/module-decoupling-validation.md'],documentationPath:'docs/module-decoupling-validation.md',documentationContent:'# Validation\nIndependent joint snapshot validation passed.\n'});
    const finalized=finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'});
    assert.equal(finalized.status,'complete');assert.equal(finalized.tested,true);
    for(const group of ['alpha','beta','eval']) assert.equal(currentSharedContext(f.store,group).integration_commit,finalized.integrated_commit);
    assert.equal(git(f.main,'show','HEAD:tests/reference.test.js'),'eval implementation');
    assert.equal(git(f.main,'show','HEAD:docs/module-decoupling-validation.md'),'# Validation\nIndependent joint snapshot validation passed.');
    for(const [group,id] of [['alpha','A1'],['beta','B1'],['eval','E1']]) for(const file of ['delivery.md','code-review-01.md','documentation-1-1.md','documentation-review-1-1.md']) assert.match(git(f.main,'show',`HEAD:groups/${group}/tasks/${id}/${file}`),/#/);
    assert.deepEqual(finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'}),finalized);
    for(const id of ['A1','B1','E1']) assert.equal(f.store.task(id).finalization.complete,true);
  }finally{f.cleanup();}
});

test('mandatory integration failure is durable and retry succeeds without rebuilding candidate',()=>{
  const marker=join(tmpdir(),`pi-integration-once-${process.pid}-${Date.now()}`);
  const script=`const fs=require('node:fs');const p=${JSON.stringify(marker)};if(!fs.existsSync(p)){fs.writeFileSync(p,'failed once');process.exit(7)}`;
  const f=cohort(['-e',script]);try{
    f.task('alpha','A1','alpha.txt');f.task('beta','B1','beta.txt');
    const snap=createIntegrationSnapshot(f.store,{integration_id:'batch',task_ids:['A1','B1'],verification_group_id:'eval',worktree:join(f.root,'candidate')});
    f.task('eval','E1','tests/reference.test.js',()=>bindIntegrationVerification(f.store,'batch','E1'));
    assert.throws(()=>finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'}));
    assert.equal(inspectIntegrationSnapshot(f.store,'batch').status,'test_failed');
    const retried=finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'});
    assert.equal(retried.status,'complete');assert.notEqual(retried.candidate_commit,snap.snapshot_commit);
  }finally{f.cleanup();try{rmSync(marker,{force:true});}catch{}}
});

test('finalization rejects unbound evaluation and changed member review evidence',()=>{
  const f=cohort();try{
    f.task('alpha','A1','alpha.txt');f.task('beta','B1','beta.txt');
    createIntegrationSnapshot(f.store,{integration_id:'batch',task_ids:['A1','B1'],verification_group_id:'eval',worktree:join(f.root,'candidate')});
    f.task('eval','E1','tests/reference.test.js');
    assert.throws(()=>finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'}),/explicitly bound/);
    const a=f.store.task('A1');a.review={...a.review,commit:'0'.repeat(40)};f.store.put('tasks','A1',a);
    assert.throws(()=>finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'}),/passing exact code and documentation review/);
  }finally{f.cleanup();}
});

test('evaluation rejects changes to another group definition even though group paths are excluded from production diffs',()=>{
  const f=cohort();try{
    f.task('alpha','A1','alpha.txt');f.task('beta','B1','beta.txt');
    createIntegrationSnapshot(f.store,{integration_id:'batch',task_ids:['A1','B1'],verification_group_id:'eval',worktree:join(f.root,'candidate')});
    f.task('eval','E1','tests/reference.test.js',()=>bindIntegrationVerification(f.store,'batch','E1'),{files:{'groups/alpha/group.md':'# Unauthorized edit\n'}});
    assert.throws(()=>finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'}),/only tests\/\*\*/,);
  }finally{f.cleanup();}
});

test('finalization rejects candidate drift and dirty Lead target',()=>{
  const f=cohort();try{
    f.task('alpha','A1','alpha.txt');f.task('beta','B1','beta.txt');
    createIntegrationSnapshot(f.store,{integration_id:'batch',task_ids:['A1','B1'],verification_group_id:'eval',worktree:join(f.root,'candidate')});
    f.task('eval','E1','tests/reference.test.js',()=>bindIntegrationVerification(f.store,'batch','E1'));
    writeFileSync(join(f.main,'uncommitted.txt'),'dirty');
    assert.throws(()=>finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'}),/Lead target drifted/);
    rmSync(join(f.main,'uncommitted.txt'));
    writeFileSync(join(join(f.root,'candidate'),'untracked.txt'),'dirty');
    assert.throws(()=>finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'}),/candidate worktree is dirty/);
  }finally{f.cleanup();}
});

test('cleanup failure is durable and retries after an earlier group has been cleared',()=>{
  const f=cohort();try{
    f.task('alpha','A1','alpha.txt');f.task('beta','B1','beta.txt');
    createIntegrationSnapshot(f.store,{integration_id:'batch',task_ids:['A1','B1'],verification_group_id:'eval',worktree:join(f.root,'candidate')});
    f.task('eval','E1','tests/reference.test.js',()=>bindIntegrationVerification(f.store,'batch','E1'));
    const beta=f.store.group('beta'), idle=beta.idle_branch; beta.idle_branch='missing-idle-ref';f.store.put('groups','beta',beta);
    assert.throws(()=>finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'}),/missing-idle-ref/);
    assert.equal(inspectIntegrationSnapshot(f.store,'batch').status,'cleanup_failed');
    assert.equal(f.store.group('alpha').active_task,null);
    beta.idle_branch=idle;f.store.put('groups','beta',beta);
    const done=finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'});
    assert.equal(done.status,'complete');
    for(const id of ['A1','B1','E1']) assert.equal(f.store.task(id).finalization.complete,true);
  }finally{f.cleanup();}
});

test('candidate merge failure leaves a recoverable manifest and preserves the original failure',()=>{
  const f=cohort();try{
    f.task('alpha','A1','shared.txt');f.task('beta','B1','shared.txt');
    assert.throws(()=>createIntegrationSnapshot(f.store,{integration_id:'batch',task_ids:['A1','B1'],verification_group_id:'eval',worktree:join(f.root,'candidate')}));
    const failed=inspectIntegrationSnapshot(f.store,'batch');
    assert.equal(failed.status,'creation_failed');assert.match(failed.creation_error,/merge|conflict/i);
    assert.throws(()=>bindIntegrationVerification(f.store,'batch','E1'),/complete candidate snapshot/);
    assert.throws(()=>finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'}),/not finalizable/);
    assert.throws(()=>createIntegrationSnapshot(f.store,{integration_id:'batch',task_ids:['A1','B1'],verification_group_id:'eval',worktree:join(f.root,'candidate')}),/inspect .*resolve manually.*new integration_id/);
  }finally{f.cleanup();}
});

test('classified combined reviews finalize a joint candidate and publish accepted knowledge',()=>{
 const f=cohort();try{
  f.task('alpha','A1','alpha.txt',null,{classified:true});f.task('beta','B1','beta.txt',null,{classified:true});
  createIntegrationSnapshot(f.store,{integration_id:'batch',task_ids:['A1','B1'],verification_group_id:'eval',worktree:join(f.root,'candidate')});
  f.task('eval','E1','tests/reference.test.js',()=>bindIntegrationVerification(f.store,'batch','E1'),{classified:true,documentationPaths:['docs/module-decoupling-validation.md'],documentationPath:'docs/module-decoupling-validation.md',documentationContent:'# Validation\nCombined review passed.\n'});
  const result=finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'});
  assert.equal(result.status,'complete');assert.equal(result.tested,true);
  assert.equal(git(f.main,'show','HEAD:docs/module-decoupling-validation.md'),'# Validation\nCombined review passed.');
  for(const group of ['alpha','beta','eval']) assert.equal(currentSharedContext(f.store,group).integration_commit,result.integrated_commit);
  assert.deepEqual(finalizeIntegrationSnapshot(f.store,'batch',{verification_task_id:'E1'}),result);
 }finally{f.cleanup();}
});
