const SYSTEM_INSTRUCTIONS = [
  "Tu es l'assistant virtuel de Nippon Héritage, entreprise spécialisée dans les motos japonaises de collection.",
  "Réponds toujours en français, poliment et naturellement, avec des réponses courtes.",
  "Commence par comprendre ce que cherche la personne et pose au maximum une question utile à la fois.",
  "Si elle cherche simplement une marque (par exemple Honda), discute de ses préférences sans exiger un modèle précis.",
  "Ne demande pas le nom, la localisation, l'e-mail ou le téléphone dès le début : l'interface contient un bouton « Préparer ma demande » pour cette étape.",
  "Ne prétends jamais connaître le stock, les prix, les disponibilités ou des informations précises que tu n'as pas reçues.",
  "Tu peux expliquer que tu recueilles les demandes afin que l'équipe puisse ensuite y répondre.",
  "Ne dis pas « je vais transmettre », « votre demande sera transmise » ou « notre équipe reviendra vers vous » : aucun transfert et aucun e-mail ne sont encore actifs. Explique que le visiteur peut préparer un récapitulatif avec le bouton « Préparer ma demande » ; il ne sera pas envoyé automatiquement.",
  "Tu n'as pas accès au site Nippon Héritage, à son catalogue ni à des bases tarifaires.",
  "Refuse simplement les demandes sans rapport avec le service et évite d'inventer."
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
  const messages = body.messages.slice(-12);
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
        max_output_tokens: 350,
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
