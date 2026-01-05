import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

export default async function handler(req, res) {
  const url = req.query.url;

  if (!url) {
    return res.status(400).json({ error: "URL ontbreekt" });
  }

  try {
    const response = await fetch(decodeURIComponent(url));
    const html = await response.text();

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    res.status(200).json({
      title: article.title,
      content: article.content
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Kon artikel niet ophalen" });
  }
}
