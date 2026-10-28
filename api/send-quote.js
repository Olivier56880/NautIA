import { createHash, timingSafeEqual } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
const CONTEXT='https://obvzuccjxgjlaieghmxm.supabase.co/functions/v1/kervenoa-quote-context';
const MAX=2*1024*1024;
const json=(v,status=200)=>Response.json(status>=400?{...v,status:v.status||'blocked',sent:v.status==='uncertain'?null:false}:v,{status,headers:{'Cache-Control':'no-store'}});
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
 let sendAttempted=false;
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
  // The trusted client record supplies both the recipient and the logo.
  if(typeof client.logo_path!=='string'||!client.logo_path.startsWith(client_id+'/'))return json({error:'Invalid logo association'},409);
  const logoUrl=new URL(client.logo_url);
  const logoPrefix='/storage/v1/object/sign/kervenoa-client-assets/'+client_id+'/';
  if(logoUrl.origin!=='https://obvzuccjxgjlaieghmxm.supabase.co'||!logoUrl.pathname.startsWith(logoPrefix))return json({error:'Invalid logo location'},409);
  const lr=await fetch(logoUrl,{redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!lr.ok)return json({error:'Client logo unavailable; quote not sent'},409);
  const logoReader=lr.body.getReader();let logoSize=0,logoChunks=[];
  while(true){const {done,value}=await logoReader.read();if(done)break;logoSize+=value.length;if(logoSize>5*1024*1024){await logoReader.cancel();return json({error:'Client logo too large'},409);}logoChunks.push(value);}
  const logoBytes=Buffer.concat(logoChunks);
  let branded;
  try{
   const source=await PDFDocument.load(bytes,{updateMetadata:false});
   if(source.getPageCount()<1||source.getPageCount()>50)throw new Error('Invalid page count');
   // Reject signed documents rather than invalidate a signature.
   if(source.getForm().getFields().some(f=>f.constructor.name==='PDFSignature'))throw new Error('Signed PDF');
   const out=await PDFDocument.create({updateMetadata:false});
   const png=logoBytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
   const jpg=logoBytes[0]===255&&logoBytes[1]===216&&logoBytes[2]===255;
   if(!png&&!jpg)throw new Error('PNG or JPEG logo required');
   const logo=png?await out.embedPng(logoBytes):await out.embedJpg(logoBytes);
   const pages=await out.embedPages(source.getPages());
   for(let i=0;i<pages.length;i++){
    const original=pages[i];const w=original.width,h=original.height;
    if(w<200||h<200||w>2000||h>2000)throw new Error('Unsupported page dimensions');
    const page=out.addPage([w,h]);const header=90;
    const scale=Math.min(1,(h-header)/h);
    page.drawPage(original,{x:(w-w*scale)/2,y:0,width:w*scale,height:h*scale});
    const logoScale=Math.min((w-72)/logo.width,64/logo.height,180/logo.width);
    page.drawImage(logo,{x:36,y:h-12-logo.height*logoScale,width:logo.width*logoScale,height:logo.height*logoScale});
   }
   branded=Buffer.from(await out.save());
   if(branded.length>MAX)return json({error:'Branded PDF exceeds 2 Mo; quote not sent'},413);
  }catch{return json({error:'Unable to create PDF with client logo; quote not sent'},422);}
  const company=String(client.company_name||'').replace(/[\r\n]/g,' ').slice(0,100);
  const test=body.demonstration===true;
  const subject=(test?'[TEST] ':'')+'Devis '+quote_number+' - '+company;
  const text='Bonjour,\n\nVeuillez trouver en pièce jointe le devis '+quote_number+' pour '+company+'.\n'+(test?'\nIl s’agit d’un test de démonstration non contractuel.\n':'')+'\nCordialement,\nKervenoa';
  const payload={from:'KERVENOA <devis@kervenoa.fr>',to:[client.to],...(client.to!==client.cc?{cc:[client.cc]}:{}),subject,text,attachments:[{filename:'Devis_'+quote_number+'.pdf',content:branded.toString('base64')}]};
  const hash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  sendAttempted=true;
  const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'quote-'+client_id+'-'+hash},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});
  const result=await r.json();
  if(!r.ok||typeof result.id!=='string'){console.error('Quote send failed',r.status,result.name||'unknown');return json({status:(!r.ok&&r.status<500)?'blocked':'uncertain',quote_number,error:(!r.ok&&r.status<500)?'Resend refused the quote; quote not sent':'Provider status uncertain; retry the same PDF and reference',provider_status:r.status},502);}
  console.info('Quote accepted',quote_number,result.id);
  return json({ok:true,status:'accepted',email_id:result.id,client_id,quote_number,to:payload.to,cc:payload.cc||[],pdf_sha256:createHash('sha256').update(branded).digest('hex'),logo_applied:true});
 }catch(e){console.error('Quote send unavailable',e.name);return json(sendAttempted?{status:'uncertain',quote_number,error:'Send status uncertain; retry the same PDF and reference to avoid duplicates'}:{status:'blocked',quote_number,error:'Preparation unavailable; quote not sent'},502);}
}};

