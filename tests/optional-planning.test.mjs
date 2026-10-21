import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './group-fixture.mjs';
for (const route of ['direct','plan','review',undefined]) test('planning route '+(route||'legacy')+' preserves independent review',()=>{const f=fixture();try{
 f.submit('coordinator','task','task.md',route?{planning:route}:{});
 const open=()=>f.store.read('sample','executor').work.map(w=>w.kind);
 assert.deepEqual(open(),[route==='direct'?'implementation-1':'plan']);
 if(route!=='direct'){f.submit('executor','plan','plan.md');if(route!=='plan'){assert.equal(f.store.read('sample','validator').work[0].kind,'plan_review');f.submit('validator','plan_review','plan-review.md');}}
 assert.deepEqual(open(),['implementation-1']);
 assert.throws(()=>f.submit('coordinator','task','task.md',{planning:route==='direct'?'review':'direct'}),/immutable/);
 const commit=f.deliver(1);assert.equal(f.store.read('sample','validator').work[0].kind,'code_review-1');
 assert.throws(()=>f.submit('coordinator','delivery','delivery.md'),/No matching open work/);
 f.submit('validator','code_review','code-review-01.md',{round:1,commit,verdict:'pass'});f.alignDocs(1);f.submit('coordinator','delivery','delivery.md');f.store.accept('T1','Independent review and documentation passed');assert.equal(f.store.task('T1').outcome,'accepted');
}finally{f.cleanup();}});
test('invalid planning route rolls back without handoff',()=>{const f=fixture();try{assert.throws(()=>f.submit('coordinator','task','task.md',{planning:'fast'}),/planning must/);assert.equal(f.store.artifact('T1','task'),null);assert.equal(f.store.read('sample','coordinator').work[0].kind,'task');}finally{f.cleanup();}});
