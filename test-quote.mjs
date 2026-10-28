import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import handler from './api/send-quote.js';
const id='b984ed92-85ea-45b7-9f5d-29ea317613f5';
process.env.KERVENOA_QUOTE_API_TOKEN='test-only';process.env.RESEND_API_KEY='test-only';
const p=await PDFDocument.create();p.addPage().drawText('Quote test');const input=Buffer.from(await p.save()).toString('base64');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
let mode='ok',calls=0,attachment,idem;
globalThis.fetch=async(url,options)=>{
 const u=String(url);
 if(u.includes('kervenoa-quote-context')){
  if(mode==='missing')return Response.json({error:'Client logo required'},{status:409});
  return Response.json({client_id:id,company_name:'Nippon Heritage',to:'frostyhem@gmail.com',cc:'kervenoa@proton.me',logo_path:(mode==='wrong'?'other':id)+'/logo.png',logo_url:'https://obvzuccjxgjlaieghmxm.supabase.co/storage/v1/object/sign/kervenoa-client-assets/'+id+'/logo.png?token=test'});
 }
 if(u.includes('/storage/'))return new Response(mode==='corrupt'?Buffer.from('bad'):png);
 if(u==='https://api.resend.com/emails'){
  calls++;if(mode==='timeout')throw new Error('timeout');
  const payload=JSON.parse(options.body);assert.deepEqual(payload.to,['frostyhem@gmail.com']);assert.deepEqual(payload.cc,['kervenoa@proton.me']);
  attachment=payload.attachments[0].content;
  if(idem)assert.equal(options.headers['Idempotency-Key'],idem);idem=options.headers['Idempotency-Key'];
  return Response.json({id:'mock-only'});
 }
 throw Error('Unexpected network '+u);
};
const run=async()=>{const r=await handler.fetch(new Request('https://test/api/send-quote',{method:'POST',headers:{'x-kervenoa-quote-key':'test-only','Content-Type':'application/json'},body:JSON.stringify({client_id:id,quote_number:'NH-TEST',pdf_base64:input,demonstration:true})}));return [r.status,await r.json()];};
for(mode of ['missing','wrong','corrupt']){const [code,b]=await run();assert.ok(code>=400);assert.equal(b.status,'blocked');assert.equal(b.sent,false);assert.equal(calls,0);}
mode='ok';let [code,b]=await run();assert.equal(code,200);assert.equal(b.logo_applied,true);assert.notEqual(attachment,input);
const output=await PDFDocument.load(Buffer.from(attachment,'base64'));assert.equal(output.getPageCount(),1);assert.ok(output.getPage(0).node.Resources().lookupMaybe);
await run();assert.equal(calls,2);
mode='timeout';[code,b]=await run();assert.equal(b.status,'uncertain');assert.equal(b.sent,null);
console.log('PASS: missing/cross-client/corrupt logos blocked; branded PDF and recipients verified; deterministic retry; uncertain status explicit. No real email sent.');
