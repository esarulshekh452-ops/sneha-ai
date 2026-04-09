// ╔════════════════════════════════════╗
// ║   NEOCHAT — GROQ ONLY VERSION     ║
// ╚════════════════════════════════════╝

// ─── CORS ───────────────────────────
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
}

// ─── GROQ MODELS (fallback chain) ───
const GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "llama3-70b-8192",
  "mixtral-8x7b-32768",
  "llama3-8b-8192",
  "gemma2-9b-it",
  "llama-3.1-8b-instant",
];

// ─── Rate limit detect ──────────────
function isRateLimit(status, data) {
  if (status === 429) return true;
  const msg = data?.error?.message || "";
  return msg.toLowerCase().includes("rate");
}

// ─── GROQ CALL ──────────────────────
async function tryGroq(messages) {
  const key = process.env.GROQ_API_KEY;

  if (!key) {
    return { ok: false, error: "GROQ_API_KEY not set" };
  }

  for (const model of GROQ_MODELS) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: 1000,
        }),
      });

      const data = await res.json();

      if (isRateLimit(res.status, data)) {
        console.log(`Rate limited: ${model}`);
        continue;
      }

      if (!res.ok || data.error) {
        console.log(`Error in ${model}`);
        continue;
      }

      const reply = data?.choices?.[0]?.message?.content;
      if (!reply) continue;

      return { ok: true, reply, model };

    } catch (err) {
      console.log(`Fail: ${model}`);
      continue;
    }
  }

  return { ok: false, error: "All Groq models failed" };
}

// ─── MAIN HANDLER ───────────────────
export default async function handler(req, res) {
  setCORS(res);

  // ✅ Preflight fix (CORS)
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const message = body?.message;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    const messages = [
      { role: "user", content: message }
    ];

    const result = await tryGroq(messages);

    if (result.ok) {
      return res.status(200).json({
        reply: result.reply,
        model: result.model,
      });
    }

    return res.status(500).json({
      error: result.error,
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message,
    });
  }
}
