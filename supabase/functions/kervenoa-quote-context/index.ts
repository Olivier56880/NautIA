import {createClient} from "npm:@supabase/supabase-js@2.95.3";
const expected="de95f74f56d5f6f4918e82a9405fd98fcd2b6d651c740547cbfe9889e3f6f287";
const json=(v:unknown,s=200)=>Response.json(v,{status:s,headers:{"Cache-Control":"no-store"}});
const digest=async(v:string)=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)))).map(b=>b.toString(16).padStart(2,"0")).join("");
Deno.serve(async(req:Request)=>{
 try{
 const token=req.headers.get("x-kervenoa-quote-key")||"";
 if(!token||await digest(token)!==expected)return json({error:"Unauthorized"},401);
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 if(Number(req.headers.get("content-length")||0)>20000)return json({error:"Payload too large"},413);
 const {client_id,client_slug,mode,request_data,request_id,provider_message_id}=await req.json();
 const recipientsOnly=mode==="recipients";
 const bySlug=recipientsOnly&&typeof client_slug==="string"&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(client_slug)&&client_slug.length<=80;
 if(!bySlug&&(typeof client_id!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(client_id)))return json({error:"Valid client_id required"},400);
 const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false}});
 const {data:c,error}=await db.from("kervenoa_chat_clients").select("id,slug,company_name,recipient_email,recipient_email_confirmed,is_active").eq(bySlug?"slug":"id",bySlug?client_slug:client_id).maybeSingle();
 if(error)return json({error:"Client lookup failed"},500);
 if(!c||!c.is_active)return json({error:"Client not active"},404);
 const email=String(c.recipient_email||"").trim().toLowerCase();
 if(!c.recipient_email_confirmed||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"Client recipient not confirmed"},409);
 if(mode === "register_request") {
  const v=request_data;
  if(!v || typeof v.customer_name !== "string" || !v.customer_name.trim() || v.customer_name.length>150 ||
    typeof v.customer_email !== "string" || v.customer_email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.customer_email) ||
    typeof v.request_text !== "string" || !v.request_text.trim() || v.request_text.length>12000 ||
    (v.customer_phone != null && (typeof v.customer_phone !== "string" || v.customer_phone.length>80)))
    return json({error:"Invalid request data"},400);
  const {data:r,error:re}=await db.from("kervenoa_quote_requests").insert({client_id:c.id,
    customer_name:v.customer_name.trim(),customer_email:v.customer_email.trim(),customer_phone:v.customer_phone||null,
    request_text:v.request_text,source:"chatbot",status:"demande_recue"}).select("id,requested_at").single();
  if(re || !r)return json({error:"Request registration failed"},500);
  return json({request_id:r.id,client_id:c.id,requested_at:r.requested_at,preparation_started_at:null,purge_after:null});
 }
 if(mode === "record_request_delivery") {
  if(typeof request_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(request_id) ||
    typeof provider_message_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(provider_message_id))return json({error:"Invalid delivery reference"},400);
  const {data:r,error:re}=await db.from("kervenoa_quote_requests").select("id,purge_after").eq("id",request_id).eq("client_id",c.id).maybeSingle();
  if(re)return json({error:"Request lookup failed"},500);
  if(!r || (r.purge_after && new Date(r.purge_after).getTime()<=Date.now()))return json({error:"Request unavailable"},404);
  const {error:de}=await db.from("kervenoa_email_deliveries").insert({request_id:r.id,recipient_type:"kervenoa",
    recipient_email:"kervenoa@proton.me",message_type:"demande",provider_message_id,status:"envoye",sent_at:new Date().toISOString()});
  if(de)return json({error:"Delivery registration failed"},500);
  return json({ok:true,request_id:r.id});
 }
 if(recipientsOnly)return json({client_id:c.id,client_slug:c.slug,to:email,cc:"kervenoa@proton.me"});
 const {data:b,error:be}=await db.from("kervenoa_client_branding").select("logo_bucket,logo_path").eq("client_id",c.id).maybeSingle();
 if(be)return json({error:"Branding read failed"},500);
 if(!b?.logo_path)return json({error:"Client logo required"},409);
 if(b.logo_bucket!=="kervenoa-client-assets"||!b.logo_path.startsWith(c.id+"/"))return json({error:"Invalid logo association"},409);
 const {data:s,error:se}=await db.storage.from(b.logo_bucket).createSignedUrl(b.logo_path,300);
 if(se||!s?.signedUrl)return json({error:"Logo retrieval failed"},502);
 return json({client_id:c.id,client_slug:c.slug,company_name:c.company_name,to:email,cc:"kervenoa@proton.me",logo_path:b.logo_path,logo_url:s.signedUrl});
 }catch{return json({error:"Client lookup failed"},500);}
});
