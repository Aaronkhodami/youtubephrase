// Node 18+ has built-in fetch

const CACHE_TTL = 3600000; // 1 hour
const cache = new Map();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { phrase, language = "en" } = req.query;

  if (!phrase || typeof phrase !== "string") {
    return res.status(400).json({ error: "Phrase query param is required" });
  }

  try {
    console.log(`[SEARCH] phrase="${phrase}" language="${language}"`);
    const results = await searchYouTube(phrase, language);
    console.log(`[SEARCH] found ${results.total} videos with matches`);
    return res.status(200).json(results);
  } catch (error) {
    console.error("[SEARCH] Error:", error.message);
    return res.status(500).json({ error: "Search failed: " + error.message });
  }
}

async function searchYouTube(phrase, language) {
  const cacheKey = `${phrase}:${language}`;
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`[CACHE] Using cached result for "${phrase}"`);
    return cached.data;
  }

  const videos = [];

  // Try multiple Invidious mirrors
  const mirrors = [
    "https://inv.nadeko.net",
    "https://invidious.jing.rocks",
    "https://iv.ggtyler.dev",
  ];

  for (const mirror of mirrors) {
    try {
      console.log(`[MIRROR] Trying ${mirror} for search...`);
      const invidUrl = `${mirror}/api/v1/search?q=${encodeURIComponent(
        phrase
      )}&type=video`;
      const invidRes = await fetch(invidUrl, { timeout: 5000 });

      if (invidRes.ok) {
        const data = await invidRes.json();
        const results = Array.isArray(data) ? data : data.results || [];
        console.log(`[MIRROR] ${mirror} returned ${results.length} videos`);

        for (const item of results.slice(0, 5)) {
          if (item.videoId || item.id) {
            const videoId = item.videoId || item.id;
            const title = item.title || "Unknown";

            videos.push({
              videoId,
              title,
              channel: item.author || "Unknown",
              thumbnail: item.videoThumbnails?.[0]?.url || "",
              mirror,
            });
          }
        }

        if (videos.length > 0) {
          console.log(`[MIRROR] Success! Found ${videos.length} videos`);
          break;
        }
      } else {
        console.log(`[MIRROR] ${mirror} returned ${invidRes.status}`);
      }
    } catch (error) {
      console.warn(`[MIRROR] ${mirror} failed: ${error.message}`);
      continue;
    }
  }

  if (videos.length === 0) {
    console.log(`[SEARCH] No videos found after trying all mirrors`);
    return { phrase, language, results: [] };
  }

  console.log(`[SEARCH] Fetching transcripts for ${videos.length} videos...`);
  const enriched = [];

  for (const video of videos) {
    try {
      const transcriptData = await getTranscript(video.videoId, language, video.mirror);

      if (transcriptData && transcriptData.segments.length > 0) {
        const matches = findMatches(transcriptData, phrase);
        console.log(`[TRANSCRIPT] ${video.title}: ${transcriptData.segments.length} segments, ${matches.length} matches`);

        if (matches.length > 0) {
          enriched.push({
            ...video,
            segments: transcriptData.segments,
            matches,
            matchCount: matches.length,
          });
        }
      }
    } catch (error) {
      console.warn(`[TRANSCRIPT] Failed for ${video.videoId}: ${error.message}`);
    }
  }

  const result = {
    phrase,
    language,
    results: enriched.slice(0, 10),
    total: enriched.length,
  };

  cache.set(cacheKey, { data: result, timestamp: Date.now() });
  return result;
}

async function getTranscript(videoId, language, mirror) {
  try {
    // Try invidious transcript endpoint using the same mirror
    const mirrorUrl = mirror || "https://inv.nadeko.net";
    const transcriptUrl = `${mirrorUrl}/api/v1/captions/${videoId}`;
    const transcriptRes = await fetch(transcriptUrl, { timeout: 5000 });

    if (transcriptRes.ok) {
      const data = await transcriptRes.json();
      const captions = Array.isArray(data) ? data : data.captions || [];

      // Find caption track for the requested language
      let selectedTrack = captions.find((c) =>
        c.label.toLowerCase().includes(language.toLowerCase())
      );

      if (!selectedTrack && captions.length > 0) {
        selectedTrack = captions[0];
      }

      if (selectedTrack && selectedTrack.url) {
        return await fetchAndParseTranscript(selectedTrack.url);
      }
    }
  } catch (error) {
    console.warn("Invidious captions failed:", error.message);
  }

  try {
    // Fallback: try YouTube timedtext URL
    return await fetchYouTubeTimedtext(videoId, language);
  } catch (error) {
    console.warn("Timedtext fallback failed:", error.message);
  }

  return null;
}

async function fetchAndParseTranscript(transcriptUrl) {
  try {
    const res = await fetch(transcriptUrl, { timeout: 5000 });
    if (!res.ok) return null;

    const text = await res.text();
    const segments = parseVtt(text);
    return { segments, url: transcriptUrl };
  } catch (error) {
    console.warn("Transcript parse failed:", error.message);
    return null;
  }
}

async function fetchYouTubeTimedtext(videoId, language) {
  const langCodes = {
    en: "en",
    de: "de",
    fi: "fi",
    ru: "ru",
  };

  const langCode = langCodes[language] || "en";
  const url = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${langCode}&fmt=vtt`;

  try {
    const res = await fetch(url, { timeout: 5000 });
    if (!res.ok) return null;

    const text = await res.text();
    const segments = parseVtt(text);
    return { segments, url };
  } catch (error) {
    return null;
  }
}

function parseVtt(vttText) {
  const segments = [];
  const lines = vttText.split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    // Look for timestamp line
    if (line.includes("-->")) {
      const [startStr] = line.split("-->");
      const start = timestampToSeconds(startStr.trim());

      // Next line is the text
      let text = "";
      i++;
      while (i < lines.length && lines[i].trim() && !lines[i].includes("-->")) {
        text += (text ? " " : "") + lines[i].trim();
        i++;
      }

      if (text) {
        segments.push({
          start,
          text: text.replace(/<[^>]+>/g, ""), // Remove HTML tags
        });
      }
    } else {
      i++;
    }
  }

  return segments;
}

function timestampToSeconds(timestamp) {
  const [hms, ms] = timestamp.split(".");
  const [h, m, s] = hms.split(":").map(Number);
  return h * 3600 + m * 60 + s + (ms ? parseInt(ms) / 1000 : 0);
}

function findMatches(transcriptData, phrase) {
  const normalizedPhrase = normalizeText(phrase);
  const matches = [];

  for (const segment of transcriptData.segments) {
    const normalizedText = normalizeText(segment.text);

    if (normalizedText.includes(normalizedPhrase)) {
      matches.push({
        start: segment.start,
        text: segment.text,
      });
    }
  }

  // If no exact matches, try word-by-word matching
  if (matches.length === 0) {
    const words = normalizedPhrase.split(/\s+/).filter(w => w.length > 2);
    if (words.length > 0) {
      for (const segment of transcriptData.segments) {
        const normalizedText = normalizeText(segment.text);
        const hasAllWords = words.every(word => normalizedText.includes(word));
        
        if (hasAllWords) {
          matches.push({
            start: segment.start,
            text: segment.text,
          });
        }
      }
    }
  }

  return matches;
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
