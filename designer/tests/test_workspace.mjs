import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { workspaceStore } from '../server/workspace-store.mjs';

const root = path.resolve(import.meta.dirname, '../..');
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'groundwork-workspace-')); t.after(() => fs.rmSync(dir, {recursive:true,force:true})); return dir; }

test('notes survive reconstruction, retry once, and acknowledge only named notes', t => {
 const dir=temp(t), store=workspaceStore(dir);
 store.configureReview({ suggestions: true, optionCount: 5, layout: 'compare', fidelity: 'low' });
 store.enqueue('Keep left navigation','note-1'); store.enqueue('Use copper','note-2',{ suggestions: false, optionCount: 2, layout: 'single', fidelity: 'polished' });
 assert.equal(store.enqueue('Keep left navigation','note-1').duplicate,true);
 assert.throws(()=>store.enqueue('different','note-1'),/different text/);
 const restarted=workspaceStore(dir); assert.equal(restarted.read().notes.length,2);
 assert.deepEqual(restarted.read().review,{ suggestions:true,optionCount:5,layout:'compare',fidelity:'low' });
 assert.deepEqual(restarted.read().notes[1].review,{ suggestions:false,optionCount:2,layout:'single',fidelity:'polished' });
 restarted.acknowledge(['note-1']); assert.deepEqual(restarted.read().notes.map(n=>n.status),['processed','received']);
});
test('selection and source provenance survive restart and export exactly the selected HTML', t => {
 const dir=temp(t), store=workspaceStore(dir);
 assert.throws(()=>store.exportPacket(),/Select a design/);
 store.source('Existing navigation must stay on the left');
 const a=store.addAlternative({html:'<style>nav{display:flex}</style><nav>A</nav>',label:'A'});
 const b=store.addAlternative({html:'<main>B</main>',label:'B'},'A second direction');
 store.select(a);store.select(b);
 const packet=workspaceStore(dir).exportPacket(); assert.equal(packet.selected.mockup.html,'<main>B</main>'); assert.equal(packet.sources[0].status,'provided'); assert.equal(packet.limitations.length,3);
 assert.throws(()=>store.select('unknown'),/Unknown/);
});
test('workspace refuses symlinks and concurrent writes without replacing existing bytes', t => {
 const dir=temp(t), other=temp(t);fs.symlinkSync(other,path.join(dir,'.groundwork-workspace'));
 assert.throws(()=>workspaceStore(dir).enqueue('x','x'),/symlinks/);
 fs.unlinkSync(path.join(dir,'.groundwork-workspace'));
 const store=workspaceStore(dir);store.enqueue('x','x');
 fs.writeFileSync(path.join(dir,'.groundwork-workspace/write.lock'),'');
 assert.throws(()=>store.enqueue('y','y'),/writer lock/);assert.equal(store.read().notes.length,1);
});

test('live chat replay, generated comparison, selection and export survive a server restart', async t => {
 const dir=temp(t);let child;
 t.after(()=>child?.kill());
 async function start() {
   child=spawn(process.execPath,[path.join(root,'designer/server/designer-server.mjs'),'--port','0','--out',dir,'--drive','adaptive'],{cwd:root,stdio:['ignore','pipe','pipe']});
   let output=''; const url=await new Promise((resolve,reject)=>{
     child.stdout.on('data',b=>{output+=b;const m=output.match(/http:\/\/(?:localhost|127\.0\.0\.1):(\d+)/);if(m)resolve(`http://127.0.0.1:${m[1]}`);});
     child.once('exit',code=>reject(new Error(`server exited ${code}: ${output}`)));
     setTimeout(()=>reject(new Error('server did not start: '+output)),8000).unref();
   });
   const invalid = await fetch(url+'/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:'{bad json'});
   assert.equal(invalid.status,400); assert.match((await invalid.json()).error,/valid JSON/);
   const oversized = await fetch(url+'/api/chat', {method:'POST',headers:{'Content-Type':'application/json'},body:'x'.repeat(2*1024*1024+1)});
   assert.equal(oversized.status,413);
   return async (route,body)=>{const res=await fetch(url+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return res.json();};
 }
 let api=await start();
 await api('/api/chat',{id:'first',text:'Keep navigation'});await api('/api/chat',{id:'second',text:'Prefer copper'});
 let contract=await api('/api/agent/contract');assert.equal(contract.contract.pending_chats.length,2);
 assert.deepEqual(contract.contract.pending_chat.review,{ suggestions:true,optionCount:3,layout:'compare',fidelity:'low' });
 const replay=await api('/api/agent/contract');assert.equal(replay.contract.pending_chats.length,2);
 const answer=await api('/api/agent/answer',{...contract.contract,seq:contract.seq,answer:{action:'generate',rationale:'Compare this direction',mockup:{html:'<style>main{color:#c34e20}</style><main>Decision Studio</main>',label:'Copper'}}});
 assert.equal(answer.ok,true,JSON.stringify(answer));
 let saved=await api('/api/workspace');assert.deepEqual(saved.notes.map(n=>n.status),['processed','processed']);assert.equal(saved.alternatives.length,1);
 await api('/api/workspace/select',{id:saved.alternatives[0].id});
 await new Promise(resolve=>{child.once('exit',resolve);child.kill();});api=await start();
 const packet=await api('/api/workspace/export');assert.equal(packet.selected.mockup.label,'Copper');
 const retry=await api('/api/chat',{id:'first',text:'Keep navigation'});assert.equal(retry.receipt.duplicate,true);
 saved=await api('/api/workspace');assert.equal(saved.notes.length,2);
});

test('workspace bounds agent context and rejects oversize designs without losing saved records', t => {
 const store=workspaceStore(temp(t));
 for(let i=0;i<8;i++) store.enqueue('x'.repeat(4000),`n${i}`);
 assert.throws(()=>store.enqueue('one more','overflow'),/Pending feedback/);
 store.acknowledge(['n0']); store.enqueue('one more','overflow');
 assert.throws(()=>store.addAlternative({html:'x'.repeat(256001)}),/256 KB/);
 assert.equal(store.read().notes.length,9); assert.equal(store.read().alternatives.length,0);
});
