import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import handler from './api/send.js';
const clientId='11111111-1111-4111-8111-111111111111';
const requestId='22222222-2222-4222-8222-222222222222';
const calls=[];
let mode='ok';
process.env.RESEND_API_KEY='test-only';
process.env.KERVENOA_QUOTE_API_TOKEN='test-only';
globalThis.fetch=async(url,options={})=>{
 const body=options.body ? JSON.parse(options.body) : {};
 calls.push({url:String(url),body});
 if(String(url).includes('kervenoa-chat-config'))return Response.json({slug:'test-workshop',companyName:'Test Workshop'});
 if(body.mode==='recipients')return Response.json({client_id:clientId,client_slug:'test-workshop',to:'workshop@example.invalid',cc:'kervenoa@proton.me'});
 if(body.mode==='register_request'){
  assert.equal(body.client_id,clientId);
  assert.equal(body.request_data.customer_name,'Test');
  return mode==='db-failure' ? Response.json({error:'unavailable'},{status:500}) : Response.json({client_id:clientId,request_id:requestId});
 }
 if(body.mode==='record_request_delivery'){
  assert.equal(body.request_id,requestId);assert.equal(body.provider_message_id,'mock-email');
  return Response.json({ok:true});
 }
 if(String(url)==='https://api.resend.com/emails'){
  assert.deepEqual(body.to,['kervenoa@proton.me','workshop@example.invalid']);
  assert.ok(!body.to.includes('visitor@example.invalid'));
  assert.ok(body.text.includes('Dossier Kervenoa : '+requestId));
  return Response.json({id:'mock-email'});
 }
 throw Error('Unexpected network request');
};
const run=()=>handler.fetch(new Request('https://test/api/send',{method:'POST',headers:{origin:'https://nautia.vercel.app','Content-Type':'application/json'},body:JSON.stringify({client:'test-workshop',nom:'Test',email:'visitor@example.invalid',demande:'Synthetic test'})}));
let response=await run();assert.equal(response.status,200);
assert.equal((await response.json()).request_id,requestId);
assert.deepEqual(calls.filter(x=>x.body.mode).map(x=>x.body.mode),['recipients','register_request','record_request_delivery']);
calls.length=0;mode='db-failure';response=await run();assert.equal(response.status,502);
assert.ok(!calls.some(x=>x.url==='https://api.resend.com/emails'));

// Run the actual Edge source with an isolated in-memory database. No network or mail.
let edgeHandler, insertPayload, selectedTable, inserted=false, fail=false;
const db={from(table){selectedTable=table;return {
 select(){return this;},eq(){return this;},
 insert(v){insertPayload=v;inserted=true;return this;},
 async single(){return fail ? {error:{message:'test'}} : {data:{id:requestId,requested_at:new Date().toISOString()}};},
 async maybeSingle(){return {data:selectedTable==='kervenoa_chat_clients' ? {id:clientId,slug:'test-workshop',company_name:'Test Workshop',is_active:true,recipient_email_confirmed:true,recipient_email:'workshop@example.invalid'} : {id:requestId,purge_after:null}};},
 then(resolve,reject){return Promise.resolve(fail ? {error:{message:'test'}} : {error:null}).then(resolve,reject);}
 };}};
let source=readFileSync('supabase/functions/kervenoa-quote-context/index.ts','utf8').replace(/^import .*\n/,'');
source=source.replace(/const expected="[a-f0-9]+";/,'const expected="'+createHash('sha256').update('test-only').digest('hex')+'";');
const sandbox={Response,Request,crypto,TextEncoder,Date,console,createClient:()=>db,Deno:{env:{get:()=> 'mock-only'},serve:h=>{edgeHandler=h;}}};
vm.runInNewContext(stripTypeScriptTypes(source,{mode:'strip'}),sandbox);
const edgeRun=(body,key='test-only')=>edgeHandler(new Request('https://test/context',{method:'POST',headers:{'x-kervenoa-quote-key':key,'Content-Type':'application/json'},body:JSON.stringify(body)}));
response=await edgeRun({client_id:clientId,mode:'register_request',request_data:{customer_name:'Test',customer_email:'visitor@example.invalid',request_text:'Synthetic'}});
assert.equal(response.status,200);assert.equal(insertPayload.status,'demande_recue');
assert.equal(insertPayload.preparation_started_at,undefined);
inserted=false;response=await edgeRun({client_id:clientId,mode:'register_request',request_data:{customer_name:'Test',customer_email:'bad',request_text:'Synthetic'}});
assert.equal(response.status,400);assert.equal(inserted,false);
response=await edgeRun({client_id:clientId,mode:'register_request'},'wrong');assert.equal(response.status,401);
fail=true;response=await edgeRun({client_id:clientId,mode:'register_request',request_data:{customer_name:'Test',customer_email:'visitor@example.invalid',request_text:'Synthetic'}});assert.equal(response.status,500);
console.log('PASS: request registration precedes mail; database failure blocks send; recipient routing unchanged; ID in recap; strict Edge validation and authentication. No real email sent.');
