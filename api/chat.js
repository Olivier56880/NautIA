const allowed = new Set(["https://olivier56880.github.io","https://nautia.vercel.app","https://nautia-olivierpoulain1971-3208.vercel.app"]);
function reply(status, data, origin) {
  return new Response(JSON.stringify(data), {status, headers:{
    "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
    "Access-Control-Allow-Origin":allowed.has(origin)?origin:"https://nautia.vercel.app","Vary":"Origin"
  }});
}
export default {
 async fetch(request) {
  const origin=request.headers.get("origin")||"";
  if(request.method==="OPTIONS"){
   if(!allowed.has(origin)) return reply(403,{error:"Origine refusée"},origin);
   return new Response(null,{status:204,headers:{"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type","Vary":"Origin"}});
  }
  if(request.method!=="POST") return reply(405,{error:"Méthode refusée"},origin);
  if(!allowed.has(origin)) return reply(403,{error:"Origine refusée"},origin);
  if(Number(request.headers.get("content-length")||0)>12000) return reply(413,{error:"Demande trop longue"},origin);
  if(!process.env.OPENAI_API_KEY) return reply(503,{error:"OpenAI non configuré dans Vercel"},origin);
  let body; try{body=await request.json()}catch{return reply(400,{error:"Données invalides"},origin)}
  const hist=Array.isArray(body.messages)?body.messages.slice(-14):[];
  if(!hist.length||hist.some(m=>!["user","assistant"].includes(m.role)||typeof m.content!=="string"||m.content.length>1200))
   return reply(400,{error:"Conversation invalide"},origin);
  const questions=Math.min(4,Math.max(0,Number(body.questionsAsked)||0));
  const instructions=`Tu es l'assistant de prise de demandes d'une entreprise cliente de KERVENOA. Client démonstrateur : Nippon Héritage, spécialiste des motos anciennes. Le même moteur sera réutilisé pour des plombiers, serruriers, couvreurs, garages et chantiers navals : adapte tes questions au métier du client. En français, vouvoiement chaleureux. Tu identifies l'objet et le besoin, puis poses UNE SEULE question utile à la fois, SANS imposer de questionnaire fixe. Tu peux poser au maximum 4 questions complémentaires en tout. Ne redemande jamais une information déjà donnée. Si le besoin est assez clair, ou après 4 questions, termine la collecte. Ne demande jamais nom, email ou téléphone : un formulaire distinct suit. Ne promets pas de devis ni d'envoi déjà effectué. N'invente aucune référence, prix ou prestation. Tu dois UNIQUEMENT répondre par un objet JSON valide avec :
 {"done":boolean,"reply":"phrase pour le visiteur","summary":{"demande":"nature concise de la demande","objet":"moto/bateau/logement/équipement et caractéristiques connues, sans inventer","travaux":"nature concise des travaux","details":"autres faits techniques pertinents, succincts sur plusieurs lignes"}}
Si done=false, reply doit contenir exactement une question pertinente, summary peut contenir les champs déjà connus. Si done=true, reply="Merci, j'ai les informations nécessaires. Veuillez compléter vos coordonnées dans le formulaire ci-dessous pour transmettre votre demande." sans question supplémentaire. Avec questionsAsked=${questions}, tu dois répondre done=true si questionsAsked >= 4, et si c'est déjà clair tu peux conclure plus tôt. Si le visiteur indique des difficultés ou refuse de répondre, conclure naturellement.`;
  let upstream;
  try{
   upstream=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",headers:{"Authorization":"Bearer "+process.env.OPENAI_API_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({model:"gpt-4.1-mini",instructions,input:hist,max_output_tokens:430,store:false,text:{format:{type:"json_object"}}}),
    signal:AbortSignal.timeout(22000)
   });
  }catch{return reply(502,{error:"OpenAI temporairement indisponible. Réessayez."},origin)}
  if(!upstream.ok){console.error("OpenAI status",upstream.status);return reply(502,{error:"Le service intelligent est momentanément indisponible."},origin)}
  let raw;try{raw=await upstream.json()}catch{return reply(502,{error:"Réponse OpenAI illisible"},origin)}
  const output=(raw.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==="output_text").map(x=>x.text).join("");
  let data;try{data=JSON.parse(output)}catch{return reply(502,{error:"Réponse OpenAI incorrecte, réessayez."},origin)}
  const clean=(s,n)=>typeof s==="string"?s.slice(0,n):"";
  let done=questions>=4||data.done===true;
  const s=data.summary||{};
  const summary={demande:clean(s.demande,400),objet:clean(s.objet,400),travaux:clean(s.travaux,400),details:clean(s.details,1500)};
  const message=done?"Merci, j'ai les informations nécessaires. Veuillez compléter vos coordonnées dans le formulaire ci-dessous pour transmettre votre demande.":clean(data.reply,500);
  if(!message) return reply(502,{error:"Réponse vide du chatbot"},origin);
  return reply(200,{ok:true,done,reply:message,summary},origin);
 }
};
