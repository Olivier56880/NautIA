// Private pricing route for KERVENOA quote preparation. Never called by public chatbot.
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export default {async fetch(request){
 if(request.method!=='GET')return json(405,{error:'Method not allowed'});
 const token=process.env.KERVENOA_ADMIN_API_TOKEN;
 if(!token)return json(503,{error:'Internal catalog not configured'});
 if(request.headers.get('authorization')!=='Bearer '+token)return json(401,{error:'Unauthorized'});
 const url=new URL(request.url);
 if(url.searchParams.get('client')!=='nippon-heritage')return json(404,{error:'Catalog unavailable'});
 const q=(url.searchParams.get('q')||'').trim();
 if(q.length>100)return json(400,{error:'Search too long'});
 const target='https://obvzuccjxgjlaieghmxm.supabase.co/functions/v1/kervenoa-demo-catalog-internal?client=nippon-heritage&q='+encodeURIComponent(q);
 try{
  const result=await fetch(target,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(8000)});
  const body=await result.json();
  return json(result.status,body);
 }catch{return json(502,{error:'Catalogue momentanément indisponible'});}
}};