// Traitement des demandes Nippon Héritage : aucun secret ni destinataire n'est fourni par le navigateur.
const PROFESSIONAL_EMAIL = "frostyhem@gmail.com";
const OPERATOR_EMAIL = "kervenoa@proton.me";
const MAX_REQUEST_BYTES = 20000;
const MAIL_PATTERN = /^[^\s@<>]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

function field(value, max) {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result.length <= max ? result : null;
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Origine non autorisée." }, 403);
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return json({ error: "Format de demande invalide." }, 415);
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BYTES) {
      return json({ error: "Demande trop volumineuse." }, 413);
    }
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Demande invalide." }, 400);
  }

  // Champ piège pour les robots de formulaires. À compléter par une limite de débit avant publication.
  if (body?.website) return json({ error: "Demande non acceptée." }, 400);

  const name = field(body?.name, 120);
  const location = field(body?.location, 160);
  const email = field(body?.email, 254);
  const phone = field(body?.phone ?? "", 40);
  const messages = body?.messages;
  if (!name || name.length < 2 || !location || location.length < 2 ||
      !email || !MAIL_PATTERN.test(email) || phone === null || body?.consent !== true ||
      !Array.isArray(messages) || messages.length < 1 || messages.length > 18 ||
      !messages.some(m => m?.role === "user") ||
      messages.some(m => !m || !["user", "assistant"].includes(m.role) ||
        typeof m.content !== "string" || !m.content.trim() || m.content.length > 1200)) {
    return json({ error: "Vérifiez vos coordonnées, votre demande et votre consentement." }, 422);
  }

  // Une adresse sur un domaine d'expédition vérifié est indispensable pour les deux destinataires.
  // Ne pas utiliser onboarding@resend.dev pour un envoi à un tiers.
  const apiKey = process.env.RESEND_API_KEY;
  const sender = process.env.RESEND_FROM;
  if (!apiKey || !sender || !MAIL_PATTERN.test(sender) ||
      /@(?:resend\.dev|gmail\.com|proton\.me)$/i.test(sender)) {
    return json({
      error: "L'envoi automatique sera disponible après vérification du domaine d'expédition KERVENOA."
    }, 503);
  }

  const transcript = messages.map(m =>
    (m.role === "user" ? "VISITEUR : " : "ASSISTANT : ") + m.content.trim()
  ).join("\n\n");

  const text = [
    "NOUVELLE DEMANDE DE CONTACT - NIPPON HÉRITAGE",
    "",
    "Nom : " + name,
    "Localisation : " + location,
    "E-mail : " + email,
    "Téléphone : " + (phone || "Non communiqué"),
    "",
    "Conversation :",
    transcript,
    "",
    "Coordonnées communiquées volontairement pour être recontacté."
  ].join("\n");

  try {
    const upstream = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "KERVENOA <" + sender + ">",
        to: [PROFESSIONAL_EMAIL],
        bcc: [OPERATOR_EMAIL],
        reply_to: email,
        subject: "Nouvelle demande - Nippon Héritage - " + name,
        text
      }),
      signal: AbortSignal.timeout(15000)
    });
    if (!upstream.ok) {
      return json({
        error: upstream.status === 403
          ? "Le domaine d'expédition n'est pas encore autorisé dans Resend."
          : "L'envoi n'a pas été accepté. Réessayez ultérieurement."
      }, upstream.status === 403 ? 503 : 502);
    }
    const result = await upstream.json();
    if (!result?.id) {
      return json({ error: "Confirmation d'envoi indisponible." }, 502);
    }
    return json({ sent: true }, 200);
  } catch {
    return json({ error: "Le service d'envoi ne répond pas. Réessayez ultérieurement." }, 504);
  }
}
