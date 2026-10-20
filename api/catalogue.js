// Internal quote-pricing API. Not accessible from public chatbots.
// Requires two server-only environment variables:
// KERVENOA_ADMIN_API_TOKEN and SUPABASE_SERVICE_ROLE_KEY.
const json = (status, data) => new Response(JSON.stringify(data), {
 status, headers: {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store'}
});
export default {
 async fetch(request) {
  if (request.method !== 'GET') return json(405,{error:'Method not allowed'});
  const adminToken = process.env.KERVENOA_ADMIN_API_TOKEN;
  const dbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!adminToken || !dbKey) return json(503,{error:'Internal pricing access not configured'});
  const given = request.headers.get('authorization') || '';
  if (given !== 'Bearer ' + adminToken) return json(401,{error:'Unauthorized'});
  const url = new URL(request.url);
  const slug = url.searchParams.get('client') || '';
  const search = (url.searchParams.get('q') || '').trim();
  if (slug !== 'nippon-heritage') return json(404,{error:'Demo catalog unavailable for this client'});
  if (search.length > 100) return json(400,{error:'Search too long'});
  const base = 'https://obvzuccjxgjlaieghmxm.supabase.co/rest/v1/';
  const headers = {apikey:dbKey, Authorization:'Bearer '+dbKey};
  try {
   const lookup = await fetch(base+'kervenoa_chat_clients?select=id,slug&slug=eq.nippon-heritage&limit=1',
      {headers,signal:AbortSignal.timeout(7000)});
   if (!lookup.ok) return json(502,{error:'Client lookup failed'});
   const clients = await lookup.json();
   if (clients.length !== 1) return json(404,{error:'Client not found'});
   let endpoint = base+'kervenoa_client_demo_products?select=demo_reference,family,designation,model_note,unit,price_ht,vat_pct,is_demo'
    +'&client_id=eq.'+encodeURIComponent(clients[0].id)+'&is_demo=eq.true&order=demo_reference.asc&limit=100';
   // Filtering is performed after retrieval (36 demo articles; prevents untrusted filter syntax).
   const result = await fetch(endpoint,{headers,signal:AbortSignal.timeout(7000)});
   if (!result.ok) return json(502,{error:'Price lookup failed'});
   const rows = await result.json();
   const query = search.toLocaleLowerCase('fr');
   const products = query ? rows.filter(p=>
      [p.designation,p.family,p.demo_reference,p.model_note].some(v=>String(v||'').toLocaleLowerCase('fr').includes(query))
   ) : rows;
   return json(200,{client:slug,source:'Supabase',demonstration:true,count:products.length,
     products:products.map(p=>({...p,price_ht:Number(p.price_ht),vat_pct:Number(p.vat_pct)}))});
  } catch { return json(502,{error:'Pricing source temporarily unavailable'}); }
 }
};
