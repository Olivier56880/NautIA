const SYSTEM_INSTRUCTIONS = [
  "Tu es l'assistant de Nippon Héritage (motos japonaises de collection). Réponds en français, avec un ton naturel et professionnel.",
  "Sois très concis : une seule phrase courte si possible, deux au maximum, environ 35 mots ou moins.",
  "Évite les compliments, les remerciements répétés, les reformulations, les introductions et les questions secondaires.",
  "Cherche uniquement à comprendre la moto recherchée et la demande. Pose au maximum UNE question réellement utile à la fois ; si la demande est claire, n'en pose plus.",
  "Si le visiteur cherche une marque, demande éventuellement le type ou le modèle. Ne redemande jamais une information déjà donnée. Ne demande pas la provenance géographique de la moto sans raison.",
  "Dès que la demande est claire, invite brièvement à cliquer sur « Préparer ma demande » pour laisser ses coordonnées. Ne demande pas ces coordonnées dans la conversation.",
  "Tu ne connais ni le stock ni les tarifs. N'invente aucun modèle disponible, aucun prix ni délai.",
  "C'est une démonstration : aucun e-mail ni devis n'est envoyé. Ne promets jamais de transmettre la demande ou de recontacter le visiteur. Le bouton prépare uniquement un récapitulatif."
].join(" ");

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}

export async function POST(request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return json({ error: "Origine non autorisée." }, 403);
  }
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return json({ error: "Format invalide." }, 415);
  }
  if (!process.env.OPENAI_API_KEY) {
    return json({ error: "La connexion IA n'est pas encore configurée." }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Message invalide." }, 400);
  }
  if (!Array.isArray(body?.messages) || body.messages.length < 1 || body.messages.length > 20) {
    return json({ error: "Conversation invalide ou trop longue." }, 400);
  }
  const messages = body.messages.slice(-8);
  if (messages.some(m =>
    !m || !["user", "assistant"].includes(m.role) ||
    typeof m.content !== "string" || !m.content.trim() || m.content.length > 1200
  ) || messages[messages.length - 1].role !== "user") {
    return json({ error: "Message invalide." }, 400);
  }

  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.OPENAI_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        instructions: SYSTEM_INSTRUCTIONS,
        input: messages,
        max_output_tokens: 160,
        store: false
      }),
      signal: AbortSignal.timeout(25000)
    });
    if (!upstream.ok) {
      if (upstream.status === 429) {
        return json({ error: "L'API OpenAI n'est pas disponible actuellement. Vérifiez le crédit et les limites du projet de test." }, 503);
      }
      return json({ error: "L'assistant IA est momentanément indisponible." }, 502);
    }
    const data = await upstream.json();
    const answer = (data.output || [])
      .filter(item => item.type === "message")
      .flatMap(item => item.content || [])
      .filter(item => item.type === "output_text")
      .map(item => item.text)
      .join("\n")
      .trim();
    if (!answer) {
      return json({ error: "L'IA n'a pas renvoyé de réponse. Réessayez." }, 502);
    }
    return json({ reply: answer });
  } catch {
    return json({ error: "Le service ne répond pas pour le moment. Réessayez." }, 504);
  }
}
