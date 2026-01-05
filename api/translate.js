export default async function handler(req, res) {
  const { sentence, sentences, target = "pt-BR" } = req.query;

  // 1) Normaliseer input
  let items = [];

  if (sentence) {
    items = [sentence];
  } else if (sentences) {
    try {
      items = JSON.parse(sentences);
      if (!Array.isArray(items)) throw new Error("sentences must be an array");
    } catch (e) {
      return res.status(400).json({ error: "Invalid sentences array" });
    }
  } else {
    return res.status(400).json({ error: "No sentence(s) provided" });
  }

  try {
    const apiKey = process.env.DEEPSEEK_API_KEY;

    // 2) Bouw één prompt met ALLE zinnen
    const prompt = `
Vertaal de volgende zinnen naar ${target}.
Geef de output terug als een JSON-array, exact in deze vorm:

["vertaling1", "vertaling2", "vertaling3"]

Hier zijn de zinnen:

${items.map((s, i) => `${i + 1}. ${s}`).join("\n")}
    `.trim();

    // 3) DeepSeek API-call
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "Je bent een vertaalmachine. Output ALLEEN geldige JSON." },
          { role: "user", content: prompt }
        ]
      })
    });

    const data = await response.json();
    console.log("DeepSeek batch response:", JSON.stringify(data, null, 2));

    const raw = data?.choices?.[0]?.message?.content || "";

    // 4) JSON uit de AI halen
    const jsonStart = raw.indexOf("[");
    const jsonEnd = raw.lastIndexOf("]") + 1;
    const jsonText = raw.slice(jsonStart, jsonEnd);

    const translations = JSON.parse(jsonText);

    // 5) Response
    res.status(200).json({
      count: translations.length,
      translations
    });

  } catch (err) {
    console.error("Batch vertaalfout:", err);
    res.status(500).json({ error: "Batch vertaalfout" });
  }
}
