// ╔══════════════════════════════════════════════════════════╗
// ║   POSTERAI — BACKEND (ask.js)                           ║
// ║   4 Channels: image_keywords | poster_json | chat | howto ║
// ╚══════════════════════════════════════════════════════════╝

function setCORS(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json");
}

// ─── GROQ MODELS (fallback chain) ────────────────────────────
const GROQ_MODELS = [
  "llama-3.3-70b-versatile",
  "llama3-70b-8192",
  "mixtral-8x7b-32768",
  "llama3-8b-8192",
  "gemma2-9b-it",
  "llama-3.1-8b-instant",
];

function isRateLimit(status, data) {
  if (status === 429) return true;
  const msg = data?.error?.message || "";
  return msg.toLowerCase().includes("rate");
}

async function tryGroq(messages, maxTokens = 1000) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, error: "GROQ_API_KEY not set" };

  for (const model of GROQ_MODELS) {
    try {
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.7,
          max_tokens: maxTokens,
        }),
      });

      const data = await res.json();
      if (isRateLimit(res.status, data)) { console.log(`[PosterAI] Rate limited: ${model}`); continue; }
      if (!res.ok || data.error) { console.log(`[PosterAI] Error: ${model}`, data.error?.message || ""); continue; }

      const reply = data?.choices?.[0]?.message?.content;
      if (!reply) continue;

      return { ok: true, reply, model };
    } catch (err) {
      console.log(`[PosterAI] Exception: ${model}`, err.message);
      continue;
    }
  }

  return { ok: false, error: "All Groq models failed or rate limited." };
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false;
  return messages.every(m => m && typeof m.role === "string" && typeof m.content === "string");
}

// ════════════════════════════════════════════════════════
// CHANNEL HANDLERS
// ════════════════════════════════════════════════════════

// ── CHANNEL 1: image_keywords ─────────────────────────
// Input:  { type: "image_keywords", topic: "Gym Motivation", mood: "energetic" }
// Output: { keywords: ["gym workout", "fitness weights", ...] }  (10 keywords)
async function handleImageKeywords({ topic, mood }) {
  const messages = [
    {
      role: "system",
      content:
        "You are an image search keyword generator. Output ONLY a valid JSON array of exactly 10 short, diverse search keyword strings (2-4 words each) suitable for fetching stock background images from Unsplash for the given poster topic and mood. No explanation, no markdown, no code fences. Just the raw JSON array.",
    },
    {
      role: "user",
      content: `Topic: ${topic}\nMood: ${mood || "energetic"}\n\nGenerate 10 varied search keywords for background images:`,
    },
  ];

  const result = await tryGroq(messages, 300);
  if (!result.ok) return { ok: false, error: result.error };

  let raw = result.reply.trim().replace(/```json|```/g, "").trim();
  const start = raw.indexOf("[");
  const end   = raw.lastIndexOf("]");
  if (start === -1 || end === -1) return { ok: false, error: "No JSON array in response" };

  const keywords = JSON.parse(raw.substring(start, end + 1));
  return { ok: true, keywords: keywords.slice(0, 10) };
}

// ── CHANNEL 2: poster_json ─────────────────────────────
// Input:  { type: "poster_json", topic, mood, bgType, palette, suggestedTextColors }
// Output: { json: { ...posterJSON } }
async function handlePosterJson({ topic, mood, bgType, palette, suggestedTextColors }) {
  const paletteStr  = (palette || []).join(", ") || "unknown";
  const textColStr  = (suggestedTextColors || []).join(", ") || "#ffffff, #000000";

  const systemPrompt = `You are a poster design JSON generator for a 1080x1920px portrait poster.
Output ONLY raw JSON. No markdown, no explanation, no code blocks, no backticks.

STRUCTURE:
{
  "topic": "short_name",
  "padding": { "top": number, "right": number, "bottom": number, "left": number },
  "googleFonts": ["Font1", "Font2"],
  "background": { "color": "#hexcode", "blur": 0-8 },
  "texts": [ ...text elements... ]
}
NOTE: Do NOT include "image" in background — image is supplied separately.

EACH TEXT ELEMENT:
{
  "content": "text",
  "font": "Google Font Name",
  "fontSize": number,
  "fontWeight": "300|400|600|700|800|900",
  "color": "#hexcode",
  "textAlign": "left|center|right",
  "margin": { "top": number, "left": number, "right": number }
}
(Footer elements: use "bottom" instead of "top")

ANTI-OVERLAP RULES — FOLLOW STRICTLY:
1. estimated_height = ceil(chars / floor(usable_width/(fontSize*0.6))) * fontSize * 1.4
2. Next margin.top = prev margin.top + prev estimated_height + gap (min 60px)
3. Font size: headline 80-140, sub 50-75, body 35-50, footer 35-55
4. Content length: fontSize>=100 max 25 chars | 70-99 max 50 chars | 50-69 max 80 chars | <50 max 150 chars
5. Always give BOTH left AND right in margin
6. Use ONLY suggested text colors for contrast
7. Use ONLY real Google Fonts: Oswald, Poppins, Bebas Neue, Montserrat, Playfair Display, Raleway, Roboto Slab, Nunito
8. Max 5 text elements. Do the height math before placing each element.

OUTPUT ONLY THE JSON:`;

  const userMsg = `Topic: ${topic}
Mood: ${mood || "energetic"}
Background type: ${bgType || "dark"}
Detected palette: ${paletteStr}
Suggested text colors: ${textColStr}

Generate the poster JSON now:`;

  const result = await tryGroq(
    [{ role: "system", content: systemPrompt }, { role: "user", content: userMsg }],
    1200
  );
  if (!result.ok) return { ok: false, error: result.error };

  let raw = result.reply.trim().replace(/```json|```/g, "").trim();
  const start = raw.indexOf("{");
  const end   = raw.lastIndexOf("}");
  if (start === -1 || end === -1) return { ok: false, error: "No JSON object in response" };

  const json = JSON.parse(raw.substring(start, end + 1));
  return { ok: true, json, model: result.model };
}

// ── CHANNEL 3: chat ────────────────────────────────────
// Input:  { type: "chat", messages: [...], userId?: string }
// Output: { reply: "..." }
async function handleChat({ messages, userId }) {
  if (!validateMessages(messages)) return { ok: false, error: "Invalid messages format" };

  const systemMsgs = messages.filter(m => m.role === "system");
  const convMsgs   = messages.filter(m => m.role !== "system").slice(-20);
  const finalMsgs  = [...systemMsgs, ...convMsgs];

  const result = await tryGroq(finalMsgs, 1000);
  return result;
}

// ── CHANNEL 4: howto ───────────────────────────────────
// Input:  { type: "howto", question: "How do I change blur?" }
// Output: { reply: "..." }
async function handleHowto({ question }) {
  const systemPrompt = `You are a friendly in-app assistant for PosterAI Pro, an AI-powered poster generator. 
You help users understand how to use the app. Keep answers short, friendly, and practical (2-4 sentences max).

App features you know about:
- Upload background image OR search images by topic (100 images shown in a grid dialog)
- AI detects color palette from selected image automatically
- Enter a topic + mood, click Generate Poster
- AI generates a poster JSON with text layout, fonts, colors
- Blur slider to adjust background blur after render
- Download as high-res PNG
- Settings: theme (light/dark), hi-res download toggle, JSON editor toggle, auto-render toggle
- JSON editor: manually edit the generated JSON and re-render
- Light/Dark theme toggle in header
- How-to bot (that's you!) answers usage questions`;

  const result = await tryGroq(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: question || "How do I use this app?" },
    ],
    400
  );
  return result;
}

// ════════════════════════════════════════════════════════
// MAIN HANDLER
// ════════════════════════════════════════════════════════
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const type = body?.type;

    let result;

    switch (type) {
      case "image_keywords":
        result = await handleImageKeywords(body);
        if (!result.ok) return res.status(500).json({ error: result.error });
        return res.status(200).json({ keywords: result.keywords });

      case "poster_json":
        result = await handlePosterJson(body);
        if (!result.ok) return res.status(500).json({ error: result.error });
        return res.status(200).json({ json: result.json, model: result.model });

      case "chat":
        result = await handleChat(body);
        if (!result.ok) return res.status(500).json({ error: result.error });
        return res.status(200).json({ reply: result.reply, model: result.model });

      case "howto":
        result = await handleHowto(body);
        if (!result.ok) return res.status(500).json({ error: result.error });
        return res.status(200).json({ reply: result.reply });

      default:
        // Legacy fallback: { message: "..." } or { messages: [...] }
        if (body?.messages && Array.isArray(body.messages)) {
          result = await handleChat(body);
        } else if (body?.message && typeof body.message === "string") {
          result = await tryGroq([{ role: "user", content: body.message }]);
        } else {
          return res.status(400).json({
            error: "Provide 'type' field: image_keywords | poster_json | chat | howto",
          });
        }
        if (!result.ok) return res.status(500).json({ error: result.error });
        return res.status(200).json({ reply: result.reply, model: result.model });
    }
  } catch (err) {
    console.error("[PosterAI] Handler error:", err.message);
    return res.status(500).json({ error: "Internal server error: " + err.message });
  }
}
