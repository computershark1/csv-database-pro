import * as cheerio from "cheerio";

const ALLOWED_HOST = "share.collx.app";
const MAX_PAGES = 100;

export default async function onRequest(context) {
  try {
    const request = context.request;

    if (request.method !== "POST") {
      return jsonResponse(
        { error: "Use a POST request." },
        405
      );
    }

    const body = await request.json();
    const suppliedUrl = String(body.url || "").trim();

    if (!suppliedUrl) {
      return jsonResponse(
        { error: "A CollX shared collection URL is required." },
        400
      );
    }

    let collectionUrl;

    try {
      collectionUrl = new URL(suppliedUrl);
    } catch {
      return jsonResponse(
        { error: "The supplied URL is invalid." },
        400
      );
    }

    if (
      collectionUrl.protocol !== "https:" ||
      collectionUrl.hostname !== ALLOWED_HOST
    ) {
      return jsonResponse(
        { error: "Only https://share.collx.app collection URLs are allowed." },
        400
      );
    }

    collectionUrl.search = "";
    collectionUrl.hash = "";

    const records = [];
    const seenUrls = new Set();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const pageUrl = new URL(collectionUrl);
      pageUrl.searchParams.set("page", String(page));

      const response = await fetch(pageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 compatible; CSVDatabasePro/1.0",
          "Accept": "text/html"
        },
        redirect: "follow"
      });

      if (!response.ok) {
        throw new Error(
          `CollX returned HTTP ${response.status} on page ${page}.`
        );
      }

      const html = await response.text();
      const pageRecords = extractCards(html, pageUrl);

      if (pageRecords.length === 0) {
        break;
      }

      let newRecords = 0;

      for (const record of pageRecords) {
        if (!record.Link || seenUrls.has(record.Link)) {
          continue;
        }

        seenUrls.add(record.Link);
        records.push(record);
        newRecords++;
      }

      if (newRecords === 0) {
        break;
      }
    }

    return jsonResponse({
      source: collectionUrl.toString(),
      importedAt: new Date().toISOString(),
      count: records.length,
      headers: [
        "Title",
        "Year",
        "Player",
        "Card Number",
        "Price",
        "Image",
        "Link"
      ],
      rows: records.map(record => [
        record.Title,
        record.Year,
        record.Player,
        record.CardNumber,
        record.Price,
        record.Image,
        record.Link
      ])
    });
  } catch (error) {
    console.error("CollX import failed:", error);

    return jsonResponse(
      {
        error: "The CollX collection could not be imported.",
        details: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

function extractCards(html, baseUrl) {
  const $ = cheerio.load(html);
  const records = [];

  $("a").each((_, element) => {
    const anchor = $(element);
    const href = anchor.attr("href");
    const title = cleanText(anchor.text());

    if (!href || !looksLikeCardTitle(title)) {
      return;
    }

    const link = new URL(href, baseUrl).toString();
    const container = anchor.closest("article, li, div");
    const image =
      container.find("img").first().attr("src") ||
      anchor.find("img").first().attr("src") ||
      "";

    const parsed = parseCardTitle(title);

    records.push({
      Title: parsed.title,
      Year: parsed.year,
      Player: parsed.player,
      CardNumber: parsed.cardNumber,
      Price: parsed.price,
      Image: image ? new URL(image, baseUrl).toString() : "",
      Link: link
    });
  });

  return records;
}

function looksLikeCardTitle(text) {
  if (!text || text.length < 5) {
    return false;
  }

  return (
    /\b(18|19|20)\d{2}\b/.test(text) ||
    /#[A-Za-z0-9-]+/.test(text) ||
    /\$\d/.test(text)
  );
}

function parseCardTitle(value) {
  const title = cleanText(value);
  const yearMatch = title.match(/\b(18|19|20)\d{2}\b/);
  const numberMatch = title.match(/#([A-Za-z0-9-]+)/);
  const priceMatch = title.match(/\$(\d+(?:\.\d{1,2})?)/);

  let player = title
    .replace(/\$\d+(?:\.\d{1,2})?/, "")
    .replace(/\b(18|19|20)\d{2}\b/, "")
    .replace(/#[A-Za-z0-9-]+/, "")
    .trim();

  return {
    title,
    year: yearMatch ? yearMatch[0] : "",
    player,
    cardNumber: numberMatch ? numberMatch[1] : "",
    price: priceMatch ? priceMatch[1] : ""
  };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
