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
  if(Number(request.headers.get("content-length")||0)>36000) return reply(413,{error:"Demande trop longue"},origin);
  if(!process.env.OPENAI_API_KEY) return reply(503,{error:"OpenAI non configuré dans Vercel"},origin);
  let body; try{body=await request.json()}catch{return reply(400,{error:"Données invalides"},origin)}
  const hist=Array.isArray(body.messages)?body.messages.slice(-30):[];
  if(!hist.length||hist.some(m=>!["user","assistant"].includes(m.role)||typeof m.content!=="string"||m.content.length>5000))
   return reply(400,{error:"Conversation invalide"},origin);
  const slug=typeof body.client==="string"?body.client:"nippon-heritage";
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>80)return reply(400,{error:"Identifiant client invalide"},origin);
  let company;
  try{
   const conf=await fetch("https://obvzuccjxgjlaieghmxm.supabase.co/functions/v1/kervenoa-chat-config?client="+encodeURIComponent(slug),{signal:AbortSignal.timeout(7000)});
   if(!conf.ok)return reply(conf.status===404?404:502,{error:conf.status===404?"Entreprise inconnue":"Configuration client indisponible"},origin);
   company=await conf.json();
   if(company.slug!==slug||typeof company.companyName!=="string"||typeof company.activity!=="string")throw new Error("invalid config");
  }catch{return reply(502,{error:"Impossible de retrouver l'entreprise dans Supabase"},origin)}
  for(const msg of hist) if(msg.role==="user") msg.content=msg.content.replace(/\b(?:jeannot|janot|jeano|jeannau|jeaneau)\b/gi,"Jeanneau");
  const questions=Math.min(12,Math.max(0,Number(body.questionsAsked)||0));
  const instructions=`Tu es l'assistant virtuel de l'entreprise ${company.companyName}. Son activité est : ${company.activity}. Contexte métier vérifié de l'entreprise : ${company.assistantContext || ''}. Accueille ses visiteurs en tant qu'assistant de cette entreprise, et adapte exclusivement les questions à son activité. Ne demande jamais au visiteur son métier ou son domaine d'activité. N'utilise jamais les informations d'une autre entreprise. Pour un simple bonjour, accueille le visiteur et demande comment tu peux l'aider concernant cette entreprise. En français, vouvoiement chaleureux. Tu identifies l'objet et le besoin, puis poses UNE SEULE question utile à la fois, SANS imposer de questionnaire fixe. Tu peux poser au maximum 12 questions complémentaires en tout. Ne redemande jamais une information déjà donnée. Pour l'activité nautique, orthographie précisément les noms de constructeurs connus. Si la dictée transcrit « Jeannot », « Janot » ou « Jeaneau » en parlant de la marque de bateaux, comprends « Jeanneau ». Pour un nom ambigu, demande une confirmation plutôt que d'inventer. La synthèse doit être COURTE, technique et structurée, sans reproduire le dialogue. Dans summary.travaux, énumère impérativement TOUTES les prestations distinctes demandées par le visiteur depuis le début de la conversation, sans en omettre une, même si elles concernent deux interventions différentes. Dans summary.objet, mentionne le modèle et la motorisation connus; dans summary.details, conserve seulement les renseignements techniques utiles non déjà présents. Ne confonds jamais un moteur hors-bord et une embase Z-Drive : reprends les informations du visiteur sans invention. Si le besoin est assez clair, ou après 12 questions, termine la collecte. Ne demande jamais nom, email ou téléphone : un formulaire distinct suit. Ne promets pas de devis ni d'envoi déjà effectué. N'invente aucune référence, prix ou prestation. Tu dois UNIQUEMENT répondre par un objet JSON valide avec :
 {"done":boolean,"reply":"phrase pour le visiteur","summary":{"demande":"nature concise de la demande","objet":"moto/bateau/logement/équipement et caractéristiques connues, sans inventer","travaux":"nature concise des travaux","details":"autres faits techniques pertinents, succincts sur plusieurs lignes"}}
Si done=false, reply doit contenir exactement une question pertinente, summary peut contenir les champs déjà connus. Si done=true, reply="Merci, j'ai les informations nécessaires. Veuillez compléter vos coordonnées dans le formulaire ci-dessous pour transmettre votre demande." sans question supplémentaire. Avec questionsAsked=${questions}, tu dois répondre done=true si questionsAsked >= 12, et si c'est déjà clair tu peux conclure plus tôt. Si le visiteur indique des difficultés ou refuse de répondre, conclure naturellement. Si le visiteur demande à terminer, envoyer sa demande ou passer au formulaire, réponds done=true immédiatement. Ne pose pas de questions inutiles pour atteindre le plafond.`;
  let upstream;
  try{
   upstream=await fetch("https://api.openai.com/v1/responses",{
    method:"POST",headers:{"Authorization":"Bearer "+process.env.OPENAI_API_KEY,"Content-Type":"application/json"},
    body:JSON.stringify({model:"gpt-4.1-mini",instructions,input:[{role:"developer",content:"Réponds uniquement avec un objet JSON valide."},...hist],max_output_tokens:430,store:false,text:{format:{type:"json_object"}}}),
    signal:AbortSignal.timeout(22000)
   });
  }catch{return reply(502,{error:"OpenAI temporairement indisponible. Réessayez."},origin)}
  if(!upstream.ok){
   let apiError={};try{apiError=await upstream.json()}catch{}
   const code=String(apiError?.error?.code||"").slice(0,80);
   const type=String(apiError?.error?.type||"").slice(0,80);
   const detail=String(apiError?.error?.message||"").slice(0,400).replace(/sk-[A-Za-z0-9_-]+/g,"[masqué]");
   console.error("OpenAI failure",upstream.status,"code",code,"type",type,"detail",detail);
   let cause="Erreur OpenAI "+upstream.status;
   if(upstream.status===401) cause="Clé OpenAI non autorisée (401)";
   else if(upstream.status===429 && (code==="insufficient_quota" || type==="insufficient_quota")) cause="Crédit ou plafond de dépenses OpenAI atteint (429)";
   else if(upstream.status===429) cause="Limite temporaire de requêtes OpenAI (429)";
   else if(upstream.status===400) cause="Paramètres de conversation incompatibles avec OpenAI (400)";
   else if(upstream.status===403) cause="Accès refusé par OpenAI (403)";
   return reply(502,{error:cause+" ; détail : "+(detail||code||type||"non précisé")},origin)
  }
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
