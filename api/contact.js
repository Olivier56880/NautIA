const ORIGIN = 'https://kervenoa.syrupybead4.chatgpt.site';
const reply = (status, body) => new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin'}});
export default {async fetch(request) {
 if(request.headers.get('origin')!==ORIGIN) return reply(403,{error:'Origine refusée.'});
 if(request.method==='OPTIONS') return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Vary':'Origin'}});
 if(request.method!=='POST') return reply(405,{error:'Méthode non autorisée.'});
 let data;try {const text=await request.text();if(text.length>14000)return reply(413,{error:'Message trop long.'});data=JSON.parse(text);}catch{return reply(400,{error:'Données incorrectes.'});}
 if(!data||typeof data!=='object')return reply(400,{error:'Données incorrectes.'});
 if(data.website)return reply(200,{ok:true});
 const name=typeof data.name==='string'?data.name.trim():'';
 const email=typeof data.email==='string'?data.email.trim():'';
 const message=typeof data.message==='string'?data.message.trim():'';
 if(!name||name.length>150||!email||email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||message.length<10||message.length>5000)return reply(400,{error:'Vérifiez votre nom, votre e-mail et votre message (10 à 5 000 caractères).'});
 if(!/^[a-f0-9-]{36}$/i.test(data.requestId||''))return reply(400,{error:'Identifiant d’envoi invalide. Rechargez la page.'});
 if(!process.env.RESEND_API_KEY)return reply(503,{error:'Envoi indisponible pour le moment.'});
 try {
 const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+process.env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':'kervenoa-contact/'+data.requestId},body:JSON.stringify({from:'KERVENOA <devis@kervenoa.fr>',to:['kervenoa@proton.me'],reply_to:email,subject:'Contact Kervenoa - '+name.replace(/[\r\n]/g,' '),text:'Nouveau contact depuis le site Kervenoa\n\nNom : '+name+'\nE-mail : '+email+'\n\n'+message}),signal:AbortSignal.timeout(10000)});
 if(!r.ok){console.error('Contact delivery status',r.status);return reply(502,{error:'Envoi non confirmé. Réessayez dans quelques instants.'});}
 const result=await r.json();if(!result.id)return reply(502,{error:'Envoi non confirmé.'});return reply(200,{ok:true});
 }catch{console.error('Contact delivery unavailable');return reply(502,{error:'Service momentanément indisponible. Votre message est conservé dans le formulaire.'});}
}};
