import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export default async function handler(req, res) {

  // ✅ ALWAYS set CORS headers FIRST
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // ✅ IMPORTANT: handle OPTIONS properly
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  // ✅ Only POST allowed
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    const chat = await groq.chat.completions.create({
      messages: [{ role: "user", content: message }],
      model: "llama3-70b-8192",
    });

    return res.status(200).json({
      reply: chat.choices[0].message.content,
    });

  } catch (err) {
    return res.status(500).json({
      error: err.message,
    });
  }
}
