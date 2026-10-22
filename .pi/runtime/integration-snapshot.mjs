import { publishSharedContext } from './shared-context.mjs';
// Guarded, immutable candidate integration for work delivered by parallel groups.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { identifier, git } from './group-store.mjs';

const now = () => new Date().toISOString();
const json = value => JSON.stringify(value, null, 2);
const table = store => store.db.exec(`CREATE TABLE IF NOT EXISTS integration_snapshots (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
const row = (store, id) => { table(store); const r = store.db.prepare('SELECT data FROM integration_snapshots WHERE id=?').get(identifier(id)); return r ? JSON.parse(r.data) : null; };
const save = (store, snap) => { table(store); store.db.prepare('INSERT OR REPLACE INTO integration_snapshots VALUES (?,?)').run(snap.integration_id, JSON.stringify(snap)); writeFileSync(snap.manifest, json(snap)); return snap; };
const manifestPath = (store, id) => join(store.root, 'integrations', `${id}.json`);
const head = (path, ref='HEAD') => git(path, 'rev-parse', ref);
const tree = path => git(path, 'rev-parse', 'HEAD^{tree}');
const dirty = path => git(path, 'status', '--porcelain');
const changed = (path, from, to) => git(path, 'diff', '--name-only', `${from}..${to}`, '--', '.', ':(exclude)groups/**').split(/\r?\n/).filter(Boolean);
const changedAll = (path, from, to) => git(path, 'diff', '--name-only', `${from}..${to}`).split(/\r?\n/).filter(Boolean);
function reviewedMember(store, taskId, integrationId) {
  const t=store.task(taskId), g=store.group(t.group_id);
  if (t.integration_id !== integrationId) throw Error(`task ${taskId} is outside this integration cohort`);
  if (g.archived || g.active_task !== taskId && !t.finalization?.complete) throw Error(`member group ${g.group_id} is archived or no longer owns the task`);
  if (!t.delivery?.commit || t.review?.verdict !== 'pass' || t.review.commit !== t.delivery.commit || t.documentation?.verdict !== 'pass' || t.documentation.code_commit !== t.delivery.commit || !t.documentation.commit) throw Error(`task ${taskId} lacks a passing exact code and documentation review`);
  if(!store.artifact(taskId,'delivery',t.round)) throw Error(`task ${taskId} lacks Coordinator delivery submission`);
  store.assertDelivery(g,t);
  git(g.worktree,'merge-base','--is-ancestor',t.delivery.commit,t.documentation.commit);
  return {task_id:taskId,group_id:g.group_id,worktree:g.worktree,branch:t.branch,base_ref:t.base_ref,base_commit:t.base_commit,delivery_commit:t.delivery.commit,review:{...t.review},documentation:{...t.documentation},docs_commit:t.documentation.commit};
}
const sameReviewedMembers=(a,b)=>JSON.stringify(a.map(({process_commit,...m})=>m))===JSON.stringify(b.map(({process_commit,...m})=>m));
function candidateIntegrity(store,snap) {
  if (!existsSync(snap.worktree) || git(snap.worktree,'rev-parse','--git-common-dir') !== store.common) throw Error('candidate worktree is missing or belongs to another repository');
  if (git(snap.worktree,'branch','--show-current') !== snap.branch) throw Error('candidate branch changed');
  if (dirty(snap.worktree)) throw Error('candidate worktree is dirty');
  if (head(snap.worktree) !== snap.candidate_commit || tree(snap.worktree) !== snap.candidate_tree) throw Error('candidate HEAD/tree changed; inspect before retrying');
}
function withLocks(store, groupIds, fn) {
  const ids=[...new Set(groupIds)].sort();
  const take=i=>i===ids.length?fn():store.operation(`group:${ids[i]}`,()=>take(i+1));
  return store.operation('integration',()=>take(0));
}
function lockIds(store,id,extra=[]) {
  const snap=row(store,id);
  const tasks=snap?.task_ids||extra;
  return [...tasks.map(t=>store.task(t).group_id), ...(snap?[snap.verification_group_id]:[])];
}
function archiveProcessEvidence(store, taskIds) {
  const commits={};
  for(const taskId of taskIds){
    const t=store.task(taskId),g=store.group(t.group_id), prefix=`groups/${g.group_id}/tasks/${taskId}`;
    if(g.active_task!==taskId && t.finalization?.complete) continue;
    if(git(g.worktree,'diff','--cached','--name-only')) throw Error(`group ${g.group_id} index is not empty`);
    const status=git(g.worktree,'status','--porcelain','--untracked-files=all').split(/\r?\n/).filter(Boolean);
    const outside=status.filter(line=>!line.slice(3).replace(/^"|"$/g,'').startsWith(`${prefix}/`));
    if(outside.length) throw Error(`group ${g.group_id} has changes outside authorized task process evidence`);
    git(g.worktree,'add','--',prefix);
    if(git(g.worktree,'diff','--cached','--name-only')) git(g.worktree,'commit','-m',`docs: retain ${taskId} process evidence`);
    commits[taskId]=head(g.worktree);
  }
  return commits;
}
function cleanupIntegrated(store,snap,verificationId,id) {
  const taskIds=[...snap.task_ids,verificationId];
  for(const taskId of taskIds){
    const t=store.task(taskId),g=store.group(t.group_id);
    if(t.outcome!=='accepted'||!t.finalization?.merged&&snap.status==='cleanup_failed'&&g.active_task!==taskId) throw Error(`accepted task state required for cleanup: ${taskId}`);
    if(t.finalization?.complete) continue;
    try {
      if(g.active_task!==taskId) throw Error(`group state changed during batch finalization: ${g.group_id}`);
      if(git(g.worktree,'diff','--cached','--name-only')) throw Error(`group ${g.group_id} index is not empty`);
      git(g.worktree,'switch',g.idle_branch); git(g.worktree,'merge','--ff-only',snap.base_ref);
      store.tx(()=>{g.active_task=null;g.generation++;store.put('groups',g.group_id,g);t.finalization={merged:true,commit:snap.integrated_commit,tested:true,complete:true,branch_preserved:true,integration_id:id};store.put('tasks',taskId,t);publishSharedContext(store,t);});
    } catch(error){
      t.finalization={...t.finalization,merged:true,commit:snap.integrated_commit,tested:true,complete:false,branch_preserved:true,integration_id:id,last_error:error.message,failed_at:now()};store.put('tasks',taskId,t);
      snap.status='cleanup_failed';snap.cleanup_error=error.message;persist(store,snap);throw error;
    }
  }
  snap.status='complete';snap.completed_at=now();return persist(store,snap);
}
function persist(store,snap){ const path=manifestPath(store,snap.integration_id); mkdirSync(dirname(path),{recursive:true}); snap.manifest=path; return save(store,snap); }
export function inspectIntegrationSnapshot(store,id) { const snap=row(store,id); if(!snap) throw Error(`unknown integration snapshot: ${id}`); return structuredClone(snap); }

export function bindIntegrationVerification(store,id,verificationTaskId) {
  id=identifier(id); verificationTaskId=identifier(verificationTaskId);
  const initial=row(store,id); if(!initial) throw Error(`unknown integration snapshot: ${id}`);
  return withLocks(store,[initial.verification_group_id],()=>{
    const snap=row(store,id);
    if(snap.status!=='candidate'||!snap.snapshot_commit||!snap.snapshot_tree) throw Error('verification binding requires a complete candidate snapshot');
    candidateIntegrity(store,snap);
    return store.tx(()=>{
      const t=store.task(verificationTaskId),g=store.group(snap.verification_group_id);
      if(t.group_id!==g.group_id||t.integration_id!==id||g.active_task!==verificationTaskId||t.outcome!=='pending'||t.delivery?.commit) throw Error('verification task must be an active pending task in the independent verification group with no delivery');
      const binding={integration_id:id,commit:snap.snapshot_commit,tree:snap.snapshot_tree};
      if(t.verification_snapshot && JSON.stringify(t.verification_snapshot)!==JSON.stringify(binding)) throw Error('verification task is already bound to a different candidate');
      const already=Boolean(t.verification_snapshot);
      t.verification_snapshot=binding; store.put('tasks',verificationTaskId,t);
      if(!already) store.notice(g.group_id,'coordinator',{type:'integration_candidate_ready',task_id:verificationTaskId,integration_id:id,verification_snapshot:binding,manifest:snap.manifest});
      return {task_id:verificationTaskId,...binding};
    });
  });
}

export function createIntegrationSnapshot(store,input) {
  const id=identifier(input.integration_id); if(!Array.isArray(input.task_ids)||input.task_ids.length<2) throw Error('integration snapshot requires at least two member tasks');
  if(!isAbsolute(input.worktree||'')) throw Error('candidate worktree must be absolute');
  identifier(input.verification_group_id);
  return withLocks(store,input.task_ids.map(t=>store.task(t).group_id),()=>{
    const members=[...new Set(input.task_ids.map(identifier))].map(task=>reviewedMember(store,task,id));
    if(members.length!==input.task_ids.length||new Set(members.map(m=>m.group_id)).size<2) throw Error('integration members must come from at least two distinct groups');
    const baseRef=members[0].base_ref, baseCommit=members[0].base_commit;
    if(members.some(m=>m.base_ref!==baseRef||m.base_commit!==baseCommit)) throw Error('integration members must share exact base_ref and base_commit');
    if(members.some(m=>m.group_id===input.verification_group_id)) throw Error('verification group must be independent of member groups');
    const prior=row(store,id);
    if(prior){ if(prior.status==='creation_failed') throw Error(`candidate creation failed: ${prior.creation_error}; inspect ${prior.manifest}, resolve manually, then use a new integration_id`); candidateIntegrity(store,prior); if(!sameReviewedMembers(prior.members,members)) throw Error('integration members changed; create a new integration id'); return prior; }
    const lead=store.projectRoot;
    if(git(lead,'branch','--show-current')!==baseRef||dirty(lead)||head(lead)!==baseCommit) throw Error('Lead target must be clean at the exact cohort base commit');
    for(const m of members) store.assertIdle(m.group_id);
    const archived=archiveProcessEvidence(store,members.map(m=>m.task_id));
    for(const m of members) m.process_commit=archived[m.task_id];
    // Archival commits may advance task branches; reviewed source commits remain fixed.
    for(const m of members){const g=store.group(m.group_id); if(git(g.worktree,'diff','--cached','--name-only')) throw Error('member index is not empty after evidence archival');}
    for(const m of members){ if(git(m.worktree,'diff','--cached','--name-only')) throw Error(`member ${m.group_id} index is not empty`); }
    const branch=`codex/integration-${id}`; git(lead,'check-ref-format','--branch',branch);
    let exists=false; try { execFileSync('git',['-C',lead,'show-ref','--verify','--quiet',`refs/heads/${branch}`],{stdio:'ignore',windowsHide:true}); exists=true; } catch {}
    if(exists) throw Error('integration branch already exists without a durable snapshot record');
    const worktree=resolve(input.worktree); if(existsSync(worktree)) throw Error('candidate worktree path already exists');
    git(lead,'worktree','add','-b',branch,worktree,baseCommit);
    try {
      for(const m of members){ git(worktree,'merge','--no-commit','--no-ff',m.process_commit); if(git(worktree,'diff','--cached','--name-only')) git(worktree,'commit','-m',`integration: add reviewed ${m.task_id}`); }
      const snap={integration_id:id,task_ids:members.map(m=>m.task_id),verification_group_id:input.verification_group_id,base_ref:baseRef,base_commit:baseCommit,branch,worktree,members,candidate_commit:head(worktree),candidate_tree:tree(worktree),snapshot_commit:head(worktree),snapshot_tree:tree(worktree),created_at:now(),status:'candidate'};
      return persist(store,snap);
    } catch(error){
      try { if(git(worktree,'rev-parse','--verify','MERGE_HEAD')) git(worktree,'merge','--abort'); } catch {}
      const failed={integration_id:id,task_ids:members.map(m=>m.task_id),verification_group_id:input.verification_group_id,base_ref:baseRef,base_commit:baseCommit,branch,worktree,members,created_at:now(),status:'creation_failed',creation_error:error.message};
      try { if(existsSync(worktree)){failed.candidate_commit=head(worktree);failed.candidate_tree=tree(worktree);} } catch {}
      try { persist(store,failed); } catch {}
      throw error;
    }
  });
}

export function finalizeIntegrationSnapshot(store,id,options={}) {
  id=identifier(id); const verificationId=identifier(options.verification_task_id||'');
  return withLocks(store,lockIds(store,id),()=>{
    let snap=row(store,id); if(!snap) throw Error(`unknown integration snapshot: ${id}`);
    if(!['candidate','testing','test_failed','integrated','cleanup_failed','complete'].includes(snap.status)||!snap.snapshot_commit||!snap.snapshot_tree) throw Error(`integration snapshot is not finalizable (status=${snap.status})`);
    candidateIntegrity(store,snap);
    if(snap.status==='complete') return structuredClone(snap);
    if(snap.status==='integrated'||snap.status==='cleanup_failed') {
      const lead=store.projectRoot;
      if(dirty(lead)||head(lead)!==snap.integrated_commit) throw Error('integrated target changed; inspect before retrying cleanup');
      for(const taskId of snap.task_ids){const t=store.task(taskId);if(t.integration_id!==id||t.outcome!=='accepted')throw Error(`persisted member identity or acceptance changed: ${taskId}`);}
      const vt=store.task(verificationId);if(vt.integration_id!==id||vt.group_id!==snap.verification_group_id||vt.outcome!=='accepted')throw Error('persisted verification task identity or acceptance changed');
      return cleanupIntegrated(store,snap,verificationId,id);
    }
    const members=snap.task_ids.map(task=>reviewedMember(store,task,id)); if(!sameReviewedMembers(members,snap.members)) throw Error('reviewed member metadata changed; candidate is invalid');
    for(const m of members){ const t=store.task(m.task_id),g=store.group(m.group_id); if(t.outcome!=='accepted') throw Error(`Lead acceptance required for ${m.task_id}`); store.assertIdle(g.group_id); }
    const vt=store.task(verificationId), vg=store.group(snap.verification_group_id);
    if(vt.group_id!==vg.group_id||vt.integration_id!==id||vg.active_task!==verificationId&&!vt.finalization?.complete||vt.outcome!=='accepted'||vt.review?.verdict!=='pass'||vt.documentation?.verdict!=='pass'||!vt.delivery?.commit) throw Error('accepted independent verification task for this integration is required');
    store.assertDelivery(vg,vt); store.assertIdle(vg.group_id);
    const binding=vt.verification_snapshot;
    if(!binding||binding.integration_id!==id||binding.commit!==snap.snapshot_commit||binding.tree!==snap.snapshot_tree) throw Error('verification task must be explicitly bound to this exact candidate commit and tree');
    if(vg.group_id===members[0].group_id||members.some(m=>m.group_id===vg.group_id)) throw Error('verification group must be independent');
    const lead=store.projectRoot;
    if(git(lead,'branch','--show-current')!==snap.base_ref||dirty(lead)||head(lead)!==snap.base_commit) throw Error('Lead target drifted; inspect and create a new reviewed integration snapshot');
    const candidate=snap.worktree;
    // Evaluation must be an evidence-only, independently reviewed branch relative to the exact common base.
    if(vt.base_commit!==snap.base_commit) throw Error('verification task must start from the exact integration base');
    if(vt.review.commit!==vt.delivery.commit||vt.documentation.code_commit!==vt.delivery.commit) throw Error('verification review must cover its exact delivery');
    const authorizedDocs=new Set(vt.documentation_paths||[]);
    const verifyCommit=vt.documentation?.commit||vt.delivery.commit;
    const ownEvidencePrefix=`groups/${vg.group_id}/tasks/${verificationId}/`;
    const evalChanges=changedAll(vg.worktree,vt.base_commit,verifyCommit);
    if(evalChanges.some(p=>!p.startsWith('tests/')&&!p.startsWith(ownEvidencePrefix)&&!(authorizedDocs.has(p)&&p.endsWith('.md')))) throw Error('verification delivery may change only tests/**, its own process evidence, and explicitly assigned Markdown documentation');
    const archived=archiveProcessEvidence(store,[...snap.task_ids,verificationId]);
    const evidenceCommit=archived[verificationId], taskPrefix=`groups/${vg.group_id}/tasks/${verificationId}`;
    const evidenceChanges=git(vg.worktree,'diff','--name-only',`${verifyCommit}..${evidenceCommit}`).split(/\r?\n/).filter(Boolean);
    if(evidenceChanges.some(p=>!p.startsWith(`${taskPrefix}/`))) throw Error('evaluation evidence archive contains changes outside its task process directory');
    if(!['testing','test_failed'].includes(snap.status)) {
      git(candidate,'merge','--no-commit','--no-ff',evidenceCommit);
      if(git(candidate,'diff','--cached','--name-only')) git(candidate,'commit','-m',`integration: add evaluation ${verificationId}`);
      snap.evaluation_commit=verifyCommit; snap.candidate_commit=head(candidate); snap.candidate_tree=tree(candidate); snap.status='testing'; persist(store,snap);
    } else if(snap.evaluation_commit!==verifyCommit) throw Error('verification task changed after candidate evaluation began');
    try {
      if(snap.status==='integrated'||snap.status==='cleanup_failed') {
        if(head(lead)!==snap.integrated_commit||dirty(lead)) throw Error('integrated target changed; inspect before retrying cleanup');
      } else {
      const spec=JSON.parse(readFileSync(join(candidate,'.pi/project.json'),'utf8')).integration;
      if(!spec||typeof spec.executable!=='string'||!Array.isArray(spec.args)||spec.args.some(a=>typeof a!=='string')) throw Error('configure mandatory .pi/project.json integration executable and args');
      execFileSync(spec.executable==='node'?process.execPath:spec.executable,spec.args,{cwd:candidate,stdio:'pipe',windowsHide:true,shell:false});
      }
    }catch(error){ snap.status='test_failed'; snap.test_error=error.message; persist(store,snap); throw error; }
    candidateIntegrity(store,snap);
    const afterTestMembers=snap.task_ids.map(task=>reviewedMember(store,task,id));
    if(!sameReviewedMembers(afterTestMembers,snap.members)) throw Error('reviewed member metadata changed while mandatory tests ran');
    for(const m of afterTestMembers){const t=store.task(m.task_id),g=store.group(m.group_id);if(t.outcome!=='accepted'||g.active_task!==m.task_id)throw Error(`member acceptance or ownership changed while mandatory tests ran: ${m.task_id}`);}
    const afterTestEval=store.task(verificationId),afterTestGroup=store.group(snap.verification_group_id);
    if(afterTestEval.outcome!=='accepted'||afterTestGroup.active_task!==verificationId||afterTestEval.verification_snapshot?.integration_id!==id||afterTestEval.verification_snapshot?.commit!==snap.snapshot_commit||afterTestEval.verification_snapshot?.tree!==snap.snapshot_tree||afterTestEval.review?.verdict!=='pass'||afterTestEval.review.commit!==afterTestEval.delivery.commit||afterTestEval.documentation?.verdict!=='pass'||afterTestEval.documentation.code_commit!==afterTestEval.delivery.commit) throw Error('verification acceptance, binding, or review evidence changed while mandatory tests ran');
    if(!['integrated','cleanup_failed'].includes(snap.status)) {
      if(head(lead)!==snap.base_commit||dirty(lead)) throw Error('Lead target changed while candidate tests ran');
      git(lead,'merge','--ff-only',snap.branch);
      snap.integrated_commit=head(lead); snap.tested=true; snap.integrated_at=now();
    }
    snap.status='integrated'; persist(store,snap);
    for(const taskId of [...snap.task_ids,verificationId]){
      const t=store.task(taskId),g=store.group(t.group_id);
      if(t.finalization?.complete) continue;
      try {
        if(g.active_task===taskId){
          if(git(g.worktree,'diff','--cached','--name-only')) throw Error(`group ${g.group_id} index is not empty`);
          git(g.worktree,'switch',g.idle_branch); git(g.worktree,'merge','--ff-only',snap.base_ref);
          store.tx(()=>{g.active_task=null;g.generation++;store.put('groups',g.group_id,g);t.finalization={merged:true,commit:snap.integrated_commit,tested:true,complete:true,branch_preserved:true,integration_id:id};store.put('tasks',taskId,t);publishSharedContext(store,t);});
        } else if(!t.finalization?.complete) throw Error(`group state changed during batch finalization: ${g.group_id}`);
      } catch(error){ t.finalization={...t.finalization,merged:true,commit:snap.integrated_commit,tested:true,complete:false,branch_preserved:true,integration_id:id,last_error:error.message,failed_at:now()}; store.put('tasks',taskId,t); snap.status='cleanup_failed'; snap.cleanup_error=error.message; persist(store,snap); throw error; }
    }
    snap.status='complete'; snap.completed_at=now(); return persist(store,snap);
  });
}
