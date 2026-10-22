import { createHash, timingSafeEqual } from 'node:crypto';
const CONTEXT='https://obvzuccjxgjlaieghmxm.supabase.co/functions/v1/kervenoa-quote-context';
const MAX=2*1024*1024;
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const digest=v=>createHash('sha256').update(v).digest();
export default {async fetch(request){
 const secret=process.env.KERVENOA_QUOTE_API_TOKEN;
 const token=request.headers.get('x-kervenoa-quote-key')||'';
 if(!secret||!token||!timingSafeEqual(digest(token),digest(secret)))return json({error:'Unauthorized'},401);
 if(request.method!=='POST')return json({error:'Method not allowed'},405);
 if(Number(request.headers.get('content-length')||0)>MAX*1.4+3000)return json({error:'PDF maximum 2 Mo'},413);
 let body;
 try{
  const reader=request.body.getReader();let size=0,chunks=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX*1.4+3000){await reader.cancel();return json({error:'PDF maximum 2 Mo'},413);}chunks.push(value);}
  body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }catch{return json({error:'Invalid JSON'},400);}
 const {client_id,quote_number,pdf_base64}=body;
 if(typeof client_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client_id))return json({error:'Valid client_id required'},400);
 if(typeof quote_number!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(quote_number))return json({error:'Valid quote number required'},400);
 if(typeof pdf_base64!=='string'||!pdf_base64.length||pdf_base64.length>Math.ceil(MAX/3)*4||pdf_base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(pdf_base64))return json({error:'Valid PDF required'},400);
 const bytes=Buffer.from(pdf_base64,'base64');
 if(bytes.length>MAX||bytes.subarray(0,5).toString()!=='%PDF-'||!bytes.subarray(-1024).includes(Buffer.from('%%EOF'))||bytes.toString('base64')!==pdf_base64)return json({error:'Valid PDF required'},400);
 if(!process.env.RESEND_API_KEY)return json({error:'Resend not configured'},503);
 try{
  const cr=await fetch(CONTEXT,{method:'POST',headers:{'Content-Type':'application/json','x-kervenoa-quote-key':secret},body:JSON.stringify({client_id}),redirect:'error',signal:AbortSignal.timeout(15000)});
  const client=await cr.json();
  if(!cr.ok)return json({error:client.error||'Client lookup failed'},cr.status);
  if(client.client_id!==client_id||!/^\S+@[^\s@]+\.[^\s@]+$/.test(client.to)||client.cc!=='kervenoa@proton.me')return json({error:'Invalid recipient configuration'},502);
  const company=String(client.company_name||'').replace(/[\r\n]/g,' ').slice(0,100);
  const test=body.demonstration===true;
  const subject=(test?'[TEST] ':'')+'Devis '+quote_number+' - '+company;
  const text='Bonjour,\n\nVeuillez trouver en pièce jointe le devis '+quote_number+' pour '+company+'.\n'+(test?'\nIl s’agit d’un test de démonstration non contractuel.\n':'')+'\nCordialement,\nKervenoa';
  const payload={from:'KERVENOA <devis@kervenoa.fr>',to:[client.to],...(client.to!==client.cc?{cc:[client.cc]}:{}),subject,text,attachments:[{filename:'Devis_'+quote_number+'.pdf',content:pdf_base64}]};
  const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'quote-'+client_id+'-'+hash},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
  const result=await r.json();
  if(!r.ok||typeof result.id!=='string'){console.error('Quote send failed',r.status,result.name||'unknown');return json({error:'Resend refused the quote',provider_status:r.status},502);}
  console.info('Quote accepted',quote_number,result.id);
  return json({ok:true,status:'accepted',email_id:result.id,client_id,quote_number,to:payload.to,cc:payload.cc||[],pdf_sha256:createHash('sha256').update(bytes).digest('hex')});
 }catch(e){console.error('Quote send unavailable',e.name);return json({error:'Send status uncertain; retry the same PDF and reference to avoid duplicates'},502);}
}};
