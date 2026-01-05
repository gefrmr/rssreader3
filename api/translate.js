export default async function handler(req, res) {
  const { sentence, sentences, target = "pt-BR", skipGrammar = "false" } = req.query;
  
  if (!sentence && !sentences) {
    return res.status(400).json({ error: "No input" });
  }

  let items = [];
  if (sentences) {
    try {
      items = JSON.parse(sentences);
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(200).json({ count: 0, translations: [] });
      }
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }
  } else if (sentence) {
    items = [sentence];
  }

  const skipGrammarAnalysis = skipGrammar === "true" || items.length > 20;
  
  if (skipGrammarAnalysis) {
    try {
      const quickPrompt = `Vertaal deze ${items.length} zinnen naar Portugees (Brazilië) als JSON array: ${JSON.stringify(items.slice(0, 30))}`;
      
      const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: "Geef alleen een JSON array met vertalingen." },
            { role: "user", content: quickPrompt }
          ],
          temperature: 0.1,
          max_tokens: 2000
        })
      });

      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content || "[]";
      const jsonMatch = raw.match(/\[.*\]/s);
      const translations = jsonMatch ? JSON.parse(jsonMatch[0]) : items;
      
      return res.status(200).json({
        count: translations.length,
        translations: translations,
        skippedGrammar: true
      });
    } catch (error) {
      return res.status(200).json({
        count: items.length,
        translations: items,
        error: "Translation failed"
      });
    }
  }

  try {
    const itemsToAnalyze = items.slice(0, 15);
    
    const prompt = `
Je bent een expert in Portugese grammatica en vertaling. Je taak heeft drie delen:

1. Vertaal de volgende zinnen naar Portugees (Brazilië)
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

BELANGRIJKE SPECIFICATIES:

1. WERKWOORDEN:
   - Markeer met <strong> tags (alleen vet, geen achtergrond)

2. ZELFSTANDIGE NAAMWOORDEN:
   - Markeer met <span style="color:darkred"> tags (alleen kleur, geen onderstreping)

3. REGELS VOOR ZELFSTANDIGE NAAMWOORDEN:
   - MARKEREN: Gewone zelfstandige naamwoorden zonder hoofdletter
     Voorbeelden: "casa", "carro", "presidente", "doutor", "professor", "carteira de motorista"
   
   - NEGEREN (NIET MARKEREN):
     * Eigennamen: "Maria", "João", "Silva", "Trump", "Biden"
     * Plaatsnamen: "Brazilië", "São Paulo", "Rio de Janeiro", "Europa", "Lisboa"
     * Merken/bedrijven: "Google", "Microsoft", "Apple"
     * Historische gebeurtenissen met hoofdletters: "Segunda Guerra Mundial"
     * Woorden die met een hoofdletter beginnen (behalve aan het begin van de zin)

4. SPECIALE GEVALLEN VOOR TITELS:
   - "presidente Trump" → "presidente" WEL markeren (titel zonder hoofdletter), "Trump" NIET markeren
   - "doutor Silva" → "doutor" WEL markeren, "Silva" NIET markeren  
   - "Professor Carlos" → "Professor" NIET markeren (want met hoofdletter), "Carlos" NIET markeren
   - "o presidente do Brasil" → "presidente" WEL markeren, "Brasil" NIET markeren (plaatsnaam)

5. CONTEXTBEPALING:
   - "O presidente falou" → "presidente" is zelfstandig naamwoord? JA (markeren)
   - "Ele preside a reunião" → "preside" is werkwoord? JA (markeren met <strong>)
   - "Rio é lindo" → "Rio" is zelfstandig naamwoord? NEE (plaatsnaam, niet markeren)
   - "Ele cruzou o rio" → "rio" is zelfstandig naamwoord? JA (geen hoofdletter, markeren)

6. OUTPUT FORMAAT:
   - Voeg HTML tags direct toe in de "translation" veld
   - Behoud interpunctie en hoofdletters van de vertaling

Hier zijn de zinnen om te vertalen en analyseren:

${itemsToAnalyze.map((s, i) => `${i + 1}. ${s}`).join("\n")}
    `.trim();

    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          { 
            role: "system", 
            content: `Je bent een precieze grammaticale analyzer die onderscheid maakt tussen gewone zelfstandige naamwoorden en eigennamen.

KRITISCHE REGELS VOOR ZELFSTANDIGE NAAMWOORDEN:
1. MARKEREN: Gewone zelfstandige naamwoorden ZONDER hoofdletter (ook titels zoals "presidente", "doutor")
2. NEGEREN: Woorden MET hoofdletter (eigennamen, plaatsnamen, merken)
3. MARKEREN: Samengestelde zelfstandige naamwoorden zonder hoofdletters ("carteira de motorista")
4. NEGEREN: Historische gebeurtenissen met hoofdletters ("Segunda Guerra Mundial")
5. TITELS: "presidente" (zonder hoofdletter) → MARKEREN, "Presidente" (met hoofdletter) → NEGEREN

Voor werkwoorden: gebruik <strong> tags.
Voor zelfstandige naamwoorden: gebruik <span style="color:darkred"> tags.

Output ALTIJD geldige JSON volgens het gevraagde formaat.`
          },
          { role: "user", content: prompt }
        ],
        temperature: 0.1,
        max_tokens: 4000
      })
    });

    const data = await response.json();
    console.log("DeepSeek response received");

    const raw = data?.choices?.[0]?.message?.content || "[]";
    
    let jsonText;
    try {
      jsonText = raw;
      
      // Verbeterde JSON extractie
      const jsonMatch = raw.match(/\[\s*\{[\s\S]*\}\s*\]/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
      
      // Clean up common JSON issues
      jsonText = jsonText
        .replace(/[“”]/g, '"')
        .replace(/'/g, '"')
        .replace(/,\s*]/g, ']')  // Remove trailing commas
        .replace(/,\s*}/g, '}'); // Remove trailing commas in objects
      
      const parsedResults = JSON.parse(jsonText);
      
      if (!Array.isArray(parsedResults)) {
        throw new Error("Result is not an array");
      }
      
      // Post-process: filter hoofdletterwoorden maar behoud titels zonder hoofdletter
      const processedResults = parsedResults.map(result => {
        if (!result.nouns || !Array.isArray(result.nouns)) {
          return result;
        }
        
        // Filter logica voor zelfstandige naamwoorden
        const filteredNouns = result.nouns.filter(noun => {
          if (!noun || typeof noun !== 'string') return false;
          
          // Split samengestelde zelfstandige naamwoorden
          const words = noun.split(/\s+/);
          
          // Voor samengestelde zelfstandige naamwoorden:
          if (words.length > 1) {
            // Voor "carteira de motorista" - alle woorden moeten zonder hoofdletter zijn
            const allLowerCase = words.every(word => {
              if (word.length === 0) return true;
              // Negeer stopwoorden zoals "de", "do", "da"
              const stopWords = ['de', 'do', 'da', 'dos', 'das', 'e'];
              if (stopWords.includes(word.toLowerCase())) {
                return true;
              }
              return !/^[A-ZÀ-Ü]/.test(word);
            });
            return allLowerCase;
          }
          
          // Voor enkele zelfstandige naamwoorden:
          // Laat titels zonder hoofdletter DOOR ("presidente", "doutor")
          // Maar blokkeer eigennamen met hoofdletter ("Trump", "São Paulo")
          
          // Lijst van veelvoorkomende titels die we WEL willen markeren
          const commonTitles = [
            'presidente', 'presidenta', 'doutor', 'doutora', 'professor', 'professora',
            'senhor', 'senhora', 'senhorita', 'diretor', 'diretora', 'ministro', 'ministra',
            'prefeito', 'prefeita', 'vereador', 'vereadora', 'deputado', 'deputada',
            'secretário', 'secretária', 'governador', 'governadora', 'rei', 'rainha',
            'príncipe', 'princesa', 'embaixador', 'embaixadora'
          ];
          
          const lowerNoun = noun.toLowerCase();
          
          // Als het een veelvoorkomende titel is ZONDER hoofdletter, markeer het
          if (commonTitles.includes(lowerNoun) && !/^[A-ZÀ-Ü]/.test(noun)) {
            return true;
          }
          
          // Voor andere woorden: alleen markeren als ze zonder hoofdletter beginnen
          return !/^[A-ZÀ-Ü]/.test(noun);
        });
        
        return {
          ...result,
          nouns: filteredNouns,
          // Debug info
          originalNouns: result.nouns,
          filteredOut: result.nouns.filter(noun => !filteredNouns.includes(noun))
        };
      });
      
      // HTML markup toepassen
      const enhancedTranslations = processedResults.map(result => {
        let html = result.translation || "";
        
        // Debug logging
        if (result.filteredOut && result.filteredOut.length > 0) {
          console.log(`Filtered out: ${result.filteredOut.join(', ')}`);
        }
        
        // Eerst zelfstandige naamwoorden markeren (van lang naar kort)
        if (result.nouns && result.nouns.length > 0) {
          const sortedNouns = [...result.nouns].sort((a, b) => b.length - a.length);
          
          sortedNouns.forEach(noun => {
            if (noun && noun.trim()) {
              // Escapen voor regex
              const escaped = noun.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              
              // Voor samengestelde zelfstandige naamwoorden, gebruik exacte match
              if (noun.includes(' ')) {
                const exactRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
                html = html.replace(exactRegex, match => {
                  // Controleer of niet al in een tag
                  const position = html.indexOf(match);
                  const before = html.substring(0, position);
                  const after = html.substring(position + match.length);
                  
                  const lastTagOpen = before.lastIndexOf('<');
                  const lastTagClose = before.lastIndexOf('>');
                  
                  if (lastTagOpen > lastTagClose) {
                    // Binnen een tag
                    return match;
                  }
                  
                  return `<span style="color:darkred">${match}</span>`;
                });
              } else {
                // Voor enkele woorden, woordgrenzen gebruiken
                const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
                html = html.replace(regex, match => {
                  // Alleen vervangen als het exacte woord (case-insensitive)
                  if (match.toLowerCase() === noun.toLowerCase()) {
                    return `<span style="color:darkred">${match}</span>`;
                  }
                  return match;
                });
              }
            }
          });
        }
        
        // Dan werkwoorden markeren
        if (result.verbs && result.verbs.length > 0) {
          const sortedVerbs = [...result.verbs].sort((a, b) => b.length - a.length);
          
          sortedVerbs.forEach(verb => {
            if (verb && verb.trim()) {
              const escaped = verb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
              
              html = html.replace(regex, match => {
                // Controleer of niet al gemarkeerd
                if (!html.includes(`>${match}<`) && 
                    !match.startsWith('<') && 
                    !match.endsWith('>')) {
                  return `<strong>${match}</strong>`;
                }
                return match;
              });
            }
          });
        }
        
        return html;
      });

      res.status(200).json({
        count: enhancedTranslations.length,
        translations: enhancedTranslations,
        rawAnalysis: processedResults
      });

    } catch (parseError) {
      console.error("JSON parse error:", parseError.message);
      console.error("Raw content sample:", raw.substring(0, 300));
      
      // Fallback zonder grammatica markering
      const fallbackTranslations = itemsToAnalyze.map(text => text);
      res.status(200).json({
        count: fallbackTranslations.length,
        translations: fallbackTranslations,
        warning: "Parse error, returning text without grammar markup"
      });
    }

  } catch (err) {
    console.error("Enhanced vertaalfout:", err);
    
    // Ultimate fallback
    res.status(200).json({
      count: items.length,
      translations: items.slice(0, 15),
      error: "Translation service unavailable"
    });
  }
}
