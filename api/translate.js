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

    // 2) Verbeterde prompt voor vertaling EN grammaticale analyse
    const prompt = `
Je bent een expert in Portugese grammatica en vertaling. Je taak heeft drie delen:

1. Vertaal de volgende zinnen naar ${target} (Portugees Brazilië)
2. Analyseer elke vertaalde zin en identificeer:
   a) ALLE werkwoorden (hoofdwerkwoorden, hulpwerkwoorden, koppelwerkwoorden, infinitieven)
   b) ALLE zelfstandige naamwoorden (inclusief samengestelde zoals "carteira de motorista")
3. Geef de output terug als een JSON-array van objecten, exact in deze vorm:

[
  {
    "translation": "volledige vertaalde zin",
    "verbs": ["werkwoord1", "werkwoord2"],
    "nouns": ["zelfstandig naamwoord1", "zelfstandig naamwoord2"]
  }
]

SPECIFIEKE REGELS:
- Werkwoorden: markeer in <strong>vet</strong> in de vertaling (alleen vet, geen achtergrondkleur)
- Zelfstandige naamwoorden: markeer in <span style="color:darkred">donkerrood</span> in de vertaling (alleen kleur, geen onderstreping)
- Samengestelde zelfstandige naamwoorden: markeer het GEHELE samengestelde woord (bijv. "carteira de motorista" als één item)
- EIGENNAMEN: Negeer eigennamen (namen van personen, plaatsen, merken, bedrijven) als zelfstandige naamwoorden
- Overlapping: als een woord zowel werkwoord als zelfstandig naamwoord kan zijn, volg de context
- Behoud de originele interpunctie en hoofdletters in de vertaling

Hier zijn de zinnen om te vertalen en analyseren:

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
          { 
            role: "system", 
            content: `Je bent een precieze grammaticale analyzer. Geef ALTIJD geldige JSON output volgens de specificaties.
            BELANGRIJK: Negeer eigennamen (zoals "Maria", "Rio de Janeiro", "Google") bij het identificeren van zelfstandige naamwoorden.
            Werkwoorden: markeer met <strong> tags.
            Zelfstandige naamwoorden: markeer met <span style="color:darkred"> tags.` 
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.1, // Lage temperature voor consistente output
        max_tokens: 4000  // Meer tokens voor complexe analyses
      })
    });

    const data = await response.json();
    console.log("DeepSeek enhanced response:", JSON.stringify(data, null, 2));

    const raw = data?.choices?.[0]?.message?.content || "[]";

    // 4) JSON uit de AI halen en verwerken
    const jsonStart = raw.indexOf("[");
    const jsonEnd = raw.lastIndexOf("]") + 1;
    const jsonText = raw.slice(jsonStart, jsonEnd);

    let parsedResults;
    try {
      parsedResults = JSON.parse(jsonText);
    } catch (e) {
      console.error("Failed to parse AI JSON:", jsonText);
      // Fallback: gewone vertaling zonder markup
      parsedResults = items.map(text => ({
        translation: text,
        verbs: [],
        nouns: []
      }));
    }

    // 5) HTML markup toepassen op de vertalingen - VEREENVOUDIGDE VERSIE
    const enhancedTranslations = parsedResults.map(result => {
      let html = result.translation || "";
      
      // Eerst zelfstandige naamwoorden markeren (van lang naar kort om overlap te voorkomen)
      if (result.nouns && Array.isArray(result.nouns)) {
        // Sorteer op lengte (langste eerst) voor samengestelde naamwoorden
        const sortedNouns = [...result.nouns].sort((a, b) => b.length - a.length);
        sortedNouns.forEach(noun => {
          if (noun && noun.trim()) {
            // Escapen voor regex
            const escapedNoun = noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Woordgrenzen gebruiken, case-insensitive
            const regex = new RegExp(`\\b${escapedNoun}\\b`, 'gi');
            html = html.replace(regex, `<span style="color:darkred">$&</span>`);
          }
        });
      }
      
      // Dan werkwoorden markeren
      if (result.verbs && Array.isArray(result.verbs)) {
        // Sorteer op lengte (langste eerst)
        const sortedVerbs = [...result.verbs].sort((a, b) => b.length - a.length);
        sortedVerbs.forEach(verb => {
          if (verb && verb.trim()) {
            const escapedVerb = verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Eenvoudigere regex zonder complexe lookbehind (werkt beter cross-browser)
            // Vervang alleen als het niet al gemarkeerd is
            const regex = new RegExp(`(?!<[^>]*?)(${escapedVerb})(?![^<]*?>)`, 'gi');
            html = html.replace(regex, (match, p1, offset, string) => {
              // Controleer of dit deel al in een span zit
              const before = string.substring(0, offset);
              const after = string.substring(offset + match.length);
              
              // Als het niet in een tag zit, markeer het
              if (!before.includes('<span') || (before.includes('<span') && before.includes('</span>'))) {
                return `<strong>${match}</strong>`;
              }
              return match;
            });
          }
        });
      }
      
      return html;
    });

    // 6) Response met zowel platte tekst als gemarkeerde HTML
    res.status(200).json({
      count: enhancedTranslations.length,
      translations: enhancedTranslations,
      rawAnalysis: parsedResults // Voor debugging
    });

  } catch (err) {
    console.error("Enhanced vertaalfout:", err);
    
    // Fallback: probeer normale vertaling zonder markup
    try {
      const fallbackPrompt = `Vertaal deze zinnen naar ${target} als JSON array: ${JSON.stringify(items)}`;
      const fallbackResponse = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: "Je bent een vertaalmachine. Output ALLEEN geldige JSON." },
            { role: "user", content: fallbackPrompt }
          ]
        })
      });
      
      const fallbackData = await fallbackResponse.json();
      const raw = fallbackData?.choices?.[0]?.message?.content || "[]";
      const jsonStart = raw.indexOf("[");
      const jsonEnd = raw.lastIndexOf("]") + 1;
      const jsonText = raw.slice(jsonStart, jsonEnd);
      const fallbackTranslations = JSON.parse(jsonText);
      
      res.status(200).json({
        count: fallbackTranslations.length,
        translations: fallbackTranslations,
        warning: "Fallback translation without grammatical markup"
      });
    } catch (fallbackErr) {
      res.status(500).json({ error: "Enhanced vertaalfout met fallback failure" });
    }
  }
}
