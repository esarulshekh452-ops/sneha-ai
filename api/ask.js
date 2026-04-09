// ╔══════════════════════════════════════════╗
// ║   NEOCHAT — UPGRADED BACKEND (ask.js)   ║
// ║   Accepts full messages array + userId  ║
// ╚══════════════════════════════════════════╝

// ─── CORS ───────────────────────────────────
function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
}

// ─── GROQ MODELS (fallback chain) ───────────
const GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "llama3-70b-8192",
  "mixtral-8x7b-32768",
  "llama3-8b-8192",
  "gemma2-9b-it",
  "llama-3.1-8b-instant",
];

// ─── Rate limit detect ───────────────────────
function isRateLimit(status, data) {
  if (status === 429) return true;
  const msg = data?.error?.message || "";
  return msg.toLowerCase().includes("rate");
}

// ─── GROQ CALL ───────────────────────────────
async function tryGroq(messages) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, error: "GROQ_API_KEY not set" };

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
        console.log(`[NeoChat] Rate limited on: ${model}`);
        continue;
      }

      if (!res.ok || data.error) {
        console.log(`[NeoChat] Error on model: ${model}`, data.error?.message || "");
        continue;
      }

      const reply = data?.choices?.[0]?.message?.content;
      if (!reply) continue;

      return { ok: true, reply, model };
    } catch (err) {
      console.log(`[NeoChat] Exception on model: ${model}`, err.message);
      continue;
    }
  }

  return { ok: false, error: "All Groq models failed or rate limited." };
}

// ─── Validate messages array ─────────────────
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  return messages.every(
    m => m && typeof m.role === "string" && typeof m.content === "string"
  );
}

// ─── MAIN HANDLER ────────────────────────────
export default async function handler(req, res) {
  setCORS(res);

  // Preflight
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // ── Support BOTH new format { messages } and legacy { message } ──
    let messages;

    if (body?.messages && Array.isArray(body.messages)) {
      // New format: full conversation array
      if (!validateMessages(body.messages)) {
        return res.status(400).json({ error: "Invalid messages array format." });
      }
      // Limit to last 20 messages (after any system message) to avoid huge payloads
      const systemMsgs = body.messages.filter(m => m.role === "system");
      const convMsgs   = body.messages.filter(m => m.role !== "system").slice(-20);
      messages = [...systemMsgs, ...convMsgs];

    } else if (body?.message && typeof body.message === "string") {
      // Legacy format: single message string
      messages = [{ role: "user", content: body.message }];

    } else {
      return res.status(400).json({ error: "Provide either 'messages' array or 'message' string." });
    }

    const result = await tryGroq(messages);

    if (result.ok) {
      return res.status(200).json({
        reply: result.reply,
        model: result.model,
      });
    }

    return res.status(500).json({ error: result.error });

  } catch (err) {
    console.error("[NeoChat] Handler error:", err.message);
    return res.status(500).json({ error: "Internal server error." });
  }
}
