const ALLOWED_ORIGINS = new Set([
  'https://olivier56880.github.io',
  'https://nautia.vercel.app',
  'https://nautia-olivierpoulain1971-3208.vercel.app'
]);
const KERVENOA_EMAIL = 'kervenoa@proton.me';
// Env variable SUPABASE_SERVICE_ROLE_KEY is server-only, NEVER sent to browsers.
// A professional recipient is used only after explicit confirmation in Supabase.
async function recipientsForClient(client) {
  const recipients = [KERVENOA_EMAIL];
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return recipients; // Safe test mode.
  const url = 'https://obvzuccjxgjlaieghmxm.supabase.co/rest/v1/kervenoa_chat_clients'
    + '?select=recipient_email,recipient_email_confirmed,is_active&slug=eq.'
    + encodeURIComponent(client) + '&limit=1';
  const r = await fetch(url, {
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    signal: AbortSignal.timeout(7000)
  });
  if (!r.ok) throw new Error('Recipient lookup failed');
  const rows = await r.json();
  const data = rows[0];
  if (!data?.is_active) throw new Error('Client not active');
  const email = String(data.recipient_email || '').trim().toLowerCase();
  if (data.recipient_email_confirmed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    && email !== KERVENOA_EMAIL) recipients.push(email);
  return recipients;
}
const response = (status, body, origin) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://olivier56880.github.io',
    'Vary': 'Origin'
  }
});
export default {
  async fetch(request) {
    const origin = request.headers.get('origin') || '';
    if (request.method === 'OPTIONS') {
      if (!ALLOWED_ORIGINS.has(origin)) return response(403, { error: 'Origine refusée' }, origin);
      return new Response(null, { status: 204, headers: {
        'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '3600',
        'Vary': 'Origin'
      }});
    }
    if (request.method !== 'POST') return response(405, { error: 'Méthode non autorisée' }, origin);
    if (!ALLOWED_ORIGINS.has(origin)) return response(403, { error: 'Origine refusée' }, origin);
    if (Number(request.headers.get('content-length') || 0) > 28000) return response(413, { error: 'Demande trop longue' }, origin);
    let body;
    try { body = await request.json(); } catch { return response(400, { error: 'Données incorrectes' }, origin); }
    if (body.website) return response(200, { ok: true }, origin);
    const client = typeof body.client === 'string' ? body.client : '';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(client) || client.length > 80)
      return response(400, { error: 'Client ID manquant ou invalide' }, origin);
    let company;
    try {
      const config = await fetch('https://obvzuccjxgjlaieghmxm.supabase.co/functions/v1/kervenoa-chat-config?client=' + encodeURIComponent(client), { signal: AbortSignal.timeout(7000) });
      if (!config.ok) return response(config.status === 404 ? 404 : 502, { error: 'Entreprise indisponible' }, origin);
      company = await config.json();
      if (company.slug !== client || typeof company.companyName !== 'string' || !company.companyName.trim())
        return response(502, { error: 'Identification entreprise incorrecte' }, origin);
    } catch { return response(502, { error: 'Impossible de vérifier l’entreprise' }, origin); }
    const companyName = company.companyName.trim().replace(/[\r\n]/g, ' ').slice(0, 100);
    const isArmel = client === 'armel-nautic';
    const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
    const nom = clean(body.nom, 150), email = clean(body.email, 254),
      telephone = clean(body.telephone, 80), demande = clean(body.demande, 3000),
      modele = clean(body.modele, 300), precisions = clean(body.precisions, 3000),
      kilometrage = clean(body.kilometrage, 100), immobilisation = clean(body.immobilisation, 150),
      derniereRevision = clean(body.derniereRevision, 150), problemes = clean(body.problemes, 1000), details = clean(body.details, 1500);
    if (!nom || !demande || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response(400, { error: 'Nom, demande et adresse e-mail valide obligatoires.' }, origin);
    }
    const messagesClient = Array.isArray(body.messagesClient) ? body.messagesClient.slice(0, 24).filter(x => typeof x === 'string').map(x => x.trim().slice(0, 800)).filter(Boolean) : [];
    if (messagesClient.join('').length > 10000) return response(413, { error: 'Conversation trop longue pour l’envoi.' }, origin);
    if (!process.env.RESEND_API_KEY) return response(503, { error: "Envoi non configuré." }, origin);
    const normaliserMarque = (valeur) => isArmel ? valeur.replace(/\b(?:jeannot|janot|jeano|jeannau|jeaneau)\b/gi, 'Jeanneau') : valeur;
    const lines = [
      'DEMANDE DE DEVIS - ' + companyName.toUpperCase(), '',
      'Nom : ' + nom, 'Adresse e-mail : ' + email,
      'Téléphone : ' + (telephone || 'Non communiqué'), '',
      'Objet : ' + normaliserMarque(modele || 'Non précisé'), 'Travaux demandés : ' + normaliserMarque(precisions || demande),
      ...(details ? ['Informations utiles : ' + normaliserMarque(details)] : []),
      ...(kilometrage ? ['Kilométrage : ' + kilometrage] : []),
      ...(immobilisation ? ['Immobilisation : ' + immobilisation] : []),
      ...(derniereRevision ? ['Dernière révision : ' + derniereRevision] : []),
      ...(problemes ? ['Problèmes signalés : ' + problemes] : [])
    ];
    let result;
    try {
      const recipients = await recipientsForClient(client);
      result = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'KERVENOA <devis@kervenoa.fr>',
          to: recipients,
          reply_to: email,
          subject: 'Demande ' + companyName + ' - ' + nom.replace(/[\r\n]/g, ' '),
          text: lines.join('\n')
        }),
        signal: AbortSignal.timeout(10000)
      });
    } catch {
      return response(502, { error: "Service d'envoi momentanément inaccessible." }, origin);
    }
    if (!result.ok) {
      console.error('Resend error status:', result.status);
      return response(502, { error: "Resend a refusé l'envoi. Vérifiez les journaux Vercel." }, origin);
    }
    return response(200, { ok: true }, origin);
  }
};