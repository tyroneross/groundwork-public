import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../server/picker.js',import.meta.url),'utf8');
test('a superseded browser poll cannot render or cancel its successor',async()=>{
 const pending=[],rendered=[];
 const c=vm.createContext({_pollActive:false,_pollGeneration:0,bootstrappedSession:false,setTimeout,$:()=>({}),showOnly(){},showWalkScreen(){},getJSON:()=>new Promise(r=>pending.push(r)),renderStep:s=>rendered.push(s.id),renderDone(){},renderGenerated(){}});
 vm.runInContext(source.slice(source.indexOf('async function loadStep()'),source.indexOf('// ── switch to standard affordance')),c);
 await vm.runInContext('loadStep()',c);await vm.runInContext('loadStep()',c);
 pending[0]({action:'ask',id:'old'});await new Promise(r=>setImmediate(r));pending[1]({action:'ask',id:'new'});await new Promise(r=>setImmediate(r));assert.deepEqual(rendered,['new']);
});
test('rejected and offline chat sends retain text and reuse the retry identity',async()=>{
 const fn=source.slice(source.indexOf('async function sendChat()'),source.indexOf("\n$('#chat-send')"));
 for(const failure of ['network','rejected']){
  const input={value:'Keep the navigation'},button={},calls=[];
  const c=vm.createContext({currentDrive:'adaptive',chatSending:false,pendingChatId:null,pendingChatText:null,crypto:{randomUUID:()=> 'stable-id'},$:s=>s==='#chat-input'?input:s==='#chat-send'?button:null,postJSON:async(_url,b)=>{calls.push(b);if(failure==='network')throw Error('offline');return{ok:false,reason:'rejected'}},refreshWorkspace:async()=>{},loadStep(){}});
  vm.runInContext(fn,c);await vm.runInContext('sendChat()',c);await vm.runInContext('sendChat()',c);
  assert.equal(input.value,'Keep the navigation');assert.equal(button.disabled,false);assert.equal(calls[0].id,calls[1].id);
 }
});
test('successful send preserves a newer draft typed while waiting',async()=>{
 const fn=source.slice(source.indexOf('async function sendChat()'),source.indexOf("\n$('#chat-send')"));const input={value:'first'};
 const c=vm.createContext({currentDrive:'adaptive',chatSending:false,pendingChatId:null,pendingChatText:null,crypto:{randomUUID:()=> 'id'},$:s=>s==='#chat-input'?input:null,postJSON:async()=>{input.value='new draft';return{ok:true}},refreshWorkspace:async()=>{},loadStep(){}});
 vm.runInContext(fn,c);await vm.runInContext('sendChat()',c);assert.equal(input.value,'new draft');
});

test('baseline comment retries retain the same identity after a lost response',async()=>{
 const calls=[];
 const c=vm.createContext({crypto:{randomUUID:()=> 'baseline-id'},postJSON:async(_url,body)=>{calls.push(body);if(calls.length===1)throw Error('lost response');return {ok:true}},refreshWorkspace(){}});
 vm.runInContext(source.slice(source.indexOf('let baselineRetry ='),source.indexOf('async function bootPicker()')),c);
 await assert.rejects(vm.runInContext("sendBaselineComment('keep it')",c),/lost response/);
 await vm.runInContext("sendBaselineComment('keep it')",c);
 assert.equal(calls[0].id,calls[1].id);
});
