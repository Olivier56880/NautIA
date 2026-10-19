const ALLOWED_ORIGINS = new Set([
  'https://olivier56880.github.io',
  'https://nautia.vercel.app',
  'https://nautia-olivierpoulain1971-3208.vercel.app'
]);
const DESTINATAIRES = ['frostyhem@gmail.com', 'kervenoa@proton.me'];
const ARMel_TEST_RECIPIENT = ['kervenoa@proton.me'];
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
    if (Number(request.headers.get('content-length') || 0) > 12000) return response(413, { error: 'Demande trop longue' }, origin);
    let body;
    try { body = await request.json(); } catch { return response(400, { error: 'Données incorrectes' }, origin); }
    if (body.website) return response(200, { ok: true }, origin);
    const client = body.client === 'armel-nautic' ? 'armel-nautic' : (body.client === 'nippon-heritage' || body.client == null ? 'nippon-heritage' : null);
    if (!client) return response(400, {error:'Client inconnu'},origin);
    const isArmel = client === 'armel-nautic'; // champ piège antibot
    const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
    const nom = clean(body.nom, 150), email = clean(body.email, 254),
      telephone = clean(body.telephone, 80), demande = clean(body.demande, 3000),
      modele = clean(body.modele, 300), precisions = clean(body.precisions, 3000),
      kilometrage = clean(body.kilometrage, 100), immobilisation = clean(body.immobilisation, 150),
      derniereRevision = clean(body.derniereRevision, 150), problemes = clean(body.problemes, 1000), details = clean(body.details, 1500);
    if (!nom || !demande || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return response(400, { error: 'Nom, demande et adresse e-mail valide obligatoires.' }, origin);
    }
    if (!process.env.RESEND_API_KEY) return response(503, { error: "Envoi non configuré." }, origin);
    const lines = [
      (isArmel ? 'TEST KERVENOA - DEMANDE ARMEL NAUTIC - NE PAS TRANSMETTRE AU CHANTIER' : 'DEMANDE NIPPON HÉRITAGE'), '',
      'Nom : ' + nom, 'Adresse e-mail : ' + email,
      'Téléphone : ' + (telephone || 'Non communiqué'), '',
      'Objet : ' + (modele || 'Non précisé'), 'Travaux demandés : ' + (precisions || demande),
      ...(details ? ['Informations utiles : ' + details] : []),
      ...(kilometrage ? ['Kilométrage : ' + kilometrage] : []),
      ...(immobilisation ? ['Immobilisation : ' + immobilisation] : []),
      ...(derniereRevision ? ['Dernière révision : ' + derniereRevision] : []),
      ...(problemes ? ['Problèmes signalés : ' + problemes] : [])
    ];
    let result;
    try {
      result = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Nippon Heritage <devis@kervenoa.fr>',
          to: isArmel ? ARMel_TEST_RECIPIENT : DESTINATAIRES,
          reply_to: email,
          subject: (isArmel ? '[TEST KERVENOA] Demande Armel Nautic - ' : 'Nouvelle demande Nippon Héritage - ') + nom.replace(/[\r\n]/g, ' '),
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