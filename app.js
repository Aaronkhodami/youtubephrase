const form = document.getElementById("search-form");
const phraseInput = document.getElementById("phrase");
const languageSelect = document.getElementById("language");
const statusEl = document.getElementById("status");
const searchLogEl = document.getElementById("search-log");
const resultsEl = document.getElementById("results");
const resultTemplate = document.getElementById("result-template");

const SUPPORTED_LANGS = new Set(["en", "de", "fi", "ru"]);
const DATA_URL = "./data/catalog.json";
const SEARCH_API = "https://youtube-phrase-match.vercel.app/api/search";

let catalog = [];
let lastSearchResults = [];

loadCatalog();

form.addEventListener("submit", (event) => {
  event.preventDefault();

  const phrase = phraseInput.value.trim();
  const requestedLang = languageSelect.value;
  const lang = SUPPORTED_LANGS.has(requestedLang) ? requestedLang : "en";

  if (!phrase) {
    setStatus("Please enter a phrase.");
    logStep("Empty phrase was rejected.");
    return;
  }

  clearLog();
  clearResults();

  setStatus("Searching YouTube for phrase matches...");
  logStep("Starting live search.");
  logStep(`Language: ${lang}`);
  logStep(`Phrase: ${phrase}`);

  performLiveSearch(phrase, lang);
});

async function performLiveSearch(phrase, language) {
  try {
    const params = new URLSearchParams({ phrase, language });
    const url = `${SEARCH_API}?${params.toString()}`;

    logStep(`Calling: ${url.split("?")[0]}`);

    const response = await fetch(url, { timeout: 10000 });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    lastSearchResults = data.results || [];

    setStatus(
      lastSearchResults.length
        ? `Found ${lastSearchResults.length} clip${lastSearchResults.length === 1 ? "" : "s"} with matches.`
        : "No matches found in YouTube results."
    );
    logStep(`Retrieved ${data.total || 0} videos with phrase matches.`);

    if (!lastSearchResults.length) {
      renderEmptyState("No YouTube videos found with this phrase.");
      return;
    }

    renderLiveResults(lastSearchResults, phrase);
  } catch (error) {
    setStatus("Search failed. Try again.");
    logStep(`Error: ${error.message}`);
    renderEmptyState(`Search error: ${error.message}`);
  }
}

async function loadCatalog() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    catalog = Array.isArray(data) ? data : [];

    if (catalog.length) {
      setStatus(`Loaded ${catalog.length} indexed clip${catalog.length === 1 ? "" : "s"}.`);
      logStep(`Loaded catalog entries: ${catalog.length}`);
    } else {
      setStatus("No indexed clips are loaded yet.");
      renderEmptyState("Add entries to data/catalog.json and redeploy with GitHub Actions.");
    }
  } catch (error) {
    catalog = [];
    setStatus("Catalog file could not be loaded.");
    renderEmptyState("Create data/catalog.json or deploy with the GitHub Actions workflow.");
    logStep(`Catalog load failed: ${error.message}`);
  }
}

function searchCatalog(phrase, language) {
  const query = normalizeText(phrase);

  return catalog
    .filter((entry) => normalizeLanguage(entry.language) === language)
    .map((entry) => {
      const matches = collectMatches(entry, query);
      return matches.length ? { ...entry, matches } : null;
    })
    .filter(Boolean)
    .slice(0, 20);
}

function collectMatches(entry, query) {
  const segments = Array.isArray(entry.segments) ? entry.segments : [];
  const matches = [];

  for (const segment of segments) {
    const text = normalizeText(segment.text || "");
    if (text.includes(query)) {
      matches.push({
        start: Number(segment.start) || 0,
        end: Number(segment.end) || (Number(segment.start) || 0) + 8,
        text: segment.text || "",
      });
    }
  }

  if (matches.length) {
    return matches;
  }

  const transcript = String(entry.transcript || "");
  const normalizedTranscript = normalizeText(transcript);

  if (!normalizedTranscript.includes(query)) {
    return [];
  }

  const index = normalizedTranscript.indexOf(query);
  const start = Math.max(0, index - 80);
  const end = Math.min(transcript.length, index + query.length + 80);

  return [
    {
      start: Number(entry.start) || 0,
      end: Number(entry.end) || (Number(entry.start) || 0) + 8,
      text: transcript.slice(start, end),
    },
  ];
}

function renderResults(entries, phrase) {
  if (!resultsEl || !resultTemplate) {
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const entry of entries) {
    const card = resultTemplate.content.firstElementChild.cloneNode(true);
    const titleEl = card.querySelector(".result-title");
    const metaEl = card.querySelector(".result-meta");
    const playerEl = card.querySelector(".player");
    const matchListEl = card.querySelector(".match-list");

    titleEl.textContent = entry.title || "Untitled clip";
    metaEl.textContent = [entry.channel || "Unknown channel", languageLabel(entry.language), entry.publishedAt || ""].filter(Boolean).join(" · ");

    if (entry.videoId) {
      const firstMatch = entry.matches[0];
      playerEl.src = buildYouTubeEmbedUrl(entry.videoId, firstMatch.start);
    } else {
      playerEl.replaceWith(buildMissingPlayerNotice());
    }

    for (const match of entry.matches.slice(0, 5)) {
      const matchItem = document.createElement("article");
      matchItem.className = "match-item";

      const timeLink = document.createElement("a");
      timeLink.className = "match-time";
      timeLink.href = entry.videoId ? buildYouTubeWatchUrl(entry.videoId, match.start) : "#";
      timeLink.target = entry.videoId ? "_blank" : "_self";
      timeLink.rel = "noreferrer";
      timeLink.textContent = `${formatTime(match.start)} - ${formatTime(match.start + 8)}`;

      const text = document.createElement("p");
      text.className = "match-text";
      text.textContent = highlightPhrase(match.text || "", phrase);

      matchItem.append(timeLink, text);
      matchListEl.append(matchItem);
    }

    fragment.append(card);
  }

  resultsEl.append(fragment);
}

function renderLiveResults(entries, phrase) {
  if (!resultsEl) {
    return;
  }

  resultsEl.innerHTML = "";
  const fragment = document.createDocumentFragment();

  for (const entry of entries) {
    const card = document.createElement("article");
    card.className = "result-card";

    const header = document.createElement("header");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "start";
    header.style.gap = "12px";

    const titleEl = document.createElement("h2");
    titleEl.className = "result-title";
    titleEl.textContent = entry.title || "Untitled clip";

    const saveBtn = document.createElement("button");
    saveBtn.className = "save-btn";
    saveBtn.textContent = "Save";
    saveBtn.type = "button";
    saveBtn.style.flexShrink = "0";
    saveBtn.addEventListener("click", () => saveResultToClip(entry, phrase));

    const titleWrap = document.createElement("div");
    titleWrap.style.flex = "1";
    titleWrap.append(titleEl);

    header.append(titleWrap, saveBtn);

    const metaEl = document.createElement("p");
    metaEl.className = "result-meta";
    metaEl.textContent = [entry.channel || "Unknown channel", `${entry.matchCount || 1} match${(entry.matchCount || 1) > 1 ? "es" : ""}`].filter(Boolean).join(" · ");

    const playerWrap = document.createElement("div");
    playerWrap.className = "player-wrap";

    const player = document.createElement("iframe");
    player.className = "player";
    player.title = "YouTube player";
    player.loading = "lazy";
    player.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
    player.allowFullscreen = true;

    if (entry.videoId && entry.matches && entry.matches.length > 0) {
      player.src = buildYouTubeEmbedUrl(entry.videoId, entry.matches[0].start);
    }

    playerWrap.append(player);

    const matchListEl = document.createElement("div");
    matchListEl.className = "match-list";

    for (const match of (entry.matches || []).slice(0, 5)) {
      const matchItem = document.createElement("article");
      matchItem.className = "match-item";

      const timeLink = document.createElement("a");
      timeLink.className = "match-time";
      timeLink.href = entry.videoId ? buildYouTubeWatchUrl(entry.videoId, match.start) : "#";
      timeLink.target = entry.videoId ? "_blank" : "_self";
      timeLink.rel = "noreferrer";
      timeLink.textContent = `${formatTime(match.start)} - ${formatTime(match.start + 8)}`;

      const text = document.createElement("p");
      text.className = "match-text";
      text.textContent = highlightPhrase(match.text || "", phrase);

      matchItem.append(timeLink, text);
      matchListEl.append(matchItem);
    }

    card.append(header, metaEl, playerWrap, matchListEl);
    fragment.append(card);
  }

  resultsEl.append(fragment);
}

function renderEmptyState(message) {
  if (!resultsEl) {
    return;
  }

  resultsEl.innerHTML = "";

  const empty = document.createElement("section");
  empty.className = "result-card";

  const heading = document.createElement("h2");
  heading.className = "result-title";
  heading.textContent = "No indexed clips yet";

  const copy = document.createElement("p");
  copy.className = "result-meta";
  copy.textContent = message;

  empty.append(heading, copy);
  resultsEl.append(empty);
}

function buildYouTubeEmbedUrl(videoId, startSeconds) {
  const params = new URLSearchParams({
    start: String(Math.max(0, Math.floor(startSeconds || 0))),
    rel: "0",
    modestbranding: "1",
  });

  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?${params.toString()}`;
}

function buildYouTubeWatchUrl(videoId, startSeconds) {
  const params = new URLSearchParams({
    v: videoId,
    t: `${Math.max(0, Math.floor(startSeconds || 0))}s`,
  });

  return `https://www.youtube.com/watch?${params.toString()}`;
}

function buildMissingPlayerNotice() {
  const notice = document.createElement("div");
  notice.className = "player-wrap";
  notice.style.display = "grid";
  notice.style.placeItems = "center";
  notice.style.padding = "1rem";
  notice.textContent = "Missing videoId for this indexed clip.";
  return notice;
}

function highlightPhrase(text, phrase) {
  if (!text) {
    return "";
  }

  const normalizedText = normalizeText(text);
  const normalizedPhrase = normalizeText(phrase);
  const index = normalizedText.indexOf(normalizedPhrase);

  if (index < 0) {
    return text;
  }

  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + phrase.length + 60);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLanguage(language) {
  const normalized = String(language || "en").toLowerCase();
  return SUPPORTED_LANGS.has(normalized) ? normalized : "en";
}

function languageLabel(language) {
  const labels = {
    en: "English",
    de: "German",
    fi: "Finnish",
    ru: "Russian",
  };

  return labels[normalizeLanguage(language)] || String(language || "EN").toUpperCase();
}

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }

  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function clearLog() {
  if (!searchLogEl) {
    return;
  }

  searchLogEl.textContent = "";
}

function clearResults() {
  if (!resultsEl) {
    return;
  }

  resultsEl.innerHTML = "";
}

function logStep(message) {
  if (!searchLogEl) {
    return;
  }

  const time = new Date().toLocaleTimeString([], { hour12: false });
  const line = `[${time}] ${message}`;
  searchLogEl.textContent += searchLogEl.textContent ? `\n${line}` : line;
}

function saveResultToClip(entry, phrase) {
  if (!entry.videoId) {
    alert("Cannot save: missing video ID.");
    return;
  }

  const newEntry = {
    title: entry.title,
    channel: entry.channel,
    language: languageSelect.value || "en",
    videoId: entry.videoId,
    publishedAt: new Date().toISOString().split("T")[0],
    segments: entry.matches || [],
    transcript: (entry.matches || []).map((m) => m.text).join(" "),
  };

  catalog.push(newEntry);

  // Offer to download the updated catalog
  const jsonStr = JSON.stringify(catalog, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "catalog.json";
  a.click();
  URL.revokeObjectURL(url);

  logStep(`Saved clip "${entry.title}" to catalog.`);
  alert(`✓ Clip saved! Download opened. Replace data/catalog.json with the downloaded file, then push to GitHub.`);
}
