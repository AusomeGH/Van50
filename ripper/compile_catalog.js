import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  isValidDeepLink,
  detectWeeklyRecurrence,
  getNextWeekdayDate,
} from "./hybrid_ripper.js";
import { inspectCardForCandidateLink, isWhitelistedTicketingUrl } from "./link_upgrader.js";
import { scanSingleLinkHealth } from "./link_health_scanner.js";
import {
  generatePatronSynopsis,
  isSpecificShowOrPerformance,
  classifyArchetype,
  generateArchetypeProfile,
  isCannedOrSyntheticDesc,
} from "./enricher.js";
import { parseDurationMs, isEventStale, isScanIncomplete } from "./event_batch_qc.js";
import { logCuratorInfo, getCuratorInfo } from "./curator_display.js";
import { isAntigravityEngine, callAntigravityCompilerArbitrator, getAntigravityModel, printAntigravityTimeoutSummary } from "./agy_engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from ripper/ first, then root .env
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const LAYERS_DIR = path.join(DATA_DIR, "layers");

const SEEDS_PATH = path.join(LAYERS_DIR, "seeds.json");
const SCHEDULES_PATH = path.join(LAYERS_DIR, "layer_schedules.json");
const BOX_OFFICE_PATH = path.join(LAYERS_DIR, "layer_box_office.json");
const EDITORIAL_PATH = path.join(LAYERS_DIR, "layer_editorial.json");
const VENUES_PATH = path.join(DATA_DIR, "venues.json");
const EVENTS_PATH = path.join(DATA_DIR, "events.json");
const QUEUE_PATH = path.join(DATA_DIR, "manual_review_queue.json");
const ARCHIVED_PATH = path.join(DATA_DIR, "archived_events.json");
const DATA_JS_PATH = path.join(ROOT_DIR, "js", "data.js");

// Safe JSON loader
function loadJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.warn(`⚠️ Warning loading ${path.basename(filePath)}: ${err.message}`);
    return fallback;
  }
}

function formatIsoTime(rawTime, defaultTime = "19:00:00") {
  if (!rawTime || typeof rawTime !== "string" || /none_available|unknown/i.test(rawTime)) return defaultTime;
  const match = rawTime.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return defaultTime;
  let h = parseInt(match[1], 10);
  const m = match[2] ? match[2] : "00";
  const ampm = (match[3] || "").toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, "0")}:${m}:00`;
}

export function parseHumanDateToIso(str, defaultYear = 2026) {
  if (!str || typeof str !== "string") return null;
  const isoMatch = str.match(/\b(202\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) return isoMatch[0];
  const months = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
  };
  const m = str.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(202\d))?/i);
  if (m) {
    const month = months[m[1].toLowerCase().slice(0, 3)];
    const day = String(parseInt(m[2], 10)).padStart(2, "0");
    const year = m[3] ? m[3] : String(defaultYear);
    return `${year}-${month}-${day}`;
  }
  return null;
}

/**
 * Extracts fallback date from seed, existing record, URL, or eventId
 */
export function extractFallbackDate(eventId, url, seed = {}, existing = {}) {
  const seedParsed = parseHumanDateToIso(seed?.date);
  if (seedParsed) return seedParsed;
  const existParsed = parseHumanDateToIso(existing?.date);
  if (existParsed) return existParsed;
  if (seed?.date && seed.date !== "none_available" && seed.date !== "Schedule Pending Verification") return seed.date;
  if (existing?.date && existing.date !== "none_available" && existing.date !== "Schedule Pending Verification") return existing.date;
  if (seed?.startIso) {
    const m = String(seed.startIso).match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  if (existing?.startIso) {
    const m = String(existing.startIso).match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
  }
  // Check URL for ISO date YYYY-MM-DD
  if (url) {
    const mUrl = String(url).match(/\b(202\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
    if (mUrl) return `${mUrl[1]}-${mUrl[2]}-${mUrl[3]}`;
  }
  // Check eventId for YYYYMMDD suffix or named month pattern (e.g. -nov-15-2026)
  if (eventId) {
    const mId = String(eventId).match(/-(202\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])(?:-\d+)?$/);
    if (mId) return `${mId[1]}-${mId[2]}-${mId[3]}`;
    const mNamed = String(eventId).match(/-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)-(\d{1,2})-(202\d)(?:-\d+)?$/i);
    if (mNamed) {
      const months = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
      const mo = months[mNamed[1].toLowerCase()];
      const day = String(parseInt(mNamed[2], 10)).padStart(2, "0");
      const yr = mNamed[3];
      return `${yr}-${mo}-${day}`;
    }
  }
  return null;
}

/**
 * Converts a 24-hour or shorthand time string (e.g. "19:30", "20:00", "7pm", "09:00:00")
 * into canonical 12-hour AM/PM display format (e.g. "7:30 PM", "8:00 PM", "9:00 AM").
 */
export function formatTime12h(rawTime) {
  if (!rawTime || typeof rawTime !== "string") return rawTime;
  const trimmed = rawTime.trim();
  if (!trimmed || /^(?:none_available|not_applicable|search_exhausted_null|TBD|unknown)$/i.test(trimmed)) {
    return rawTime;
  }
  // Direct single time match: HH:MM(:SS)? (AM|PM)? or H(AM|PM)
  const singleMatch = trimmed.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM|am|pm)?$/);
  if (singleMatch) {
    let h = parseInt(singleMatch[1], 10);
    const m = singleMatch[2] || "00";
    const mer = singleMatch[3] ? singleMatch[3].toUpperCase() : null;
    if (h > 24) return rawTime;
    if (mer) {
      if (mer === "PM" && h < 12) h += 12;
      if (mer === "AM" && h === 12) h = 0;
    }
    const period = h >= 12 && h < 24 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m} ${period}`;
  }
  return formatSchedule12h(trimmed);
}

/**
 * Replaces any embedded 24-hour time tokens (e.g. "19:30", "13:00 - 21:00") inside a schedule string
 * with 12-hour AM/PM format while preserving dates and text.
 */
export function formatSchedule12h(str) {
  if (!str || typeof str !== "string") return str;
  return str.replace(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(\s*(?:AM|PM|am|pm))?\b/g, (full, hh, mm, mer) => {
    let h = parseInt(hh, 10);
    const m = mm;
    const merUpper = mer ? mer.trim().toUpperCase() : null;
    if (merUpper) {
      if (merUpper === "PM" && h < 12) h += 12;
      if (merUpper === "AM" && h === 12) h = 0;
    }
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m} ${period}`;
  });
}

/**
 * Robust Venue Matching
 * Prevents false generic token matching (e.g. 'gallery' matching Little Mountain Gallery, or 'public' matching Granville Island)
 */
export function matchVenue(venueQuery, venues) {
  if (!venueQuery || !Array.isArray(venues)) return null;
  const rawQuery = venueQuery.toLowerCase().trim();
  const cleanQuery = rawQuery.replace(/\(.*?\)/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();

  // 1. Exact match
  let matched = venues.find((v) => (v.venue_name || "").toLowerCase().trim() === rawQuery);
  if (matched) return matched;

  // 2. Clean query match (without parenthetical info / punctuation)
  matched = venues.find((v) => (v.venue_name || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim() === cleanQuery);
  if (matched) return matched;

  // 3. Clean query containment (strip parenthetical suffixes from venue names first so "The Polygon Gallery (The Shipyards)" doesn't hijack "The Shipyards")
  const containmentCandidates = venues.filter((v) => {
    const vNoParens = (v.venue_name || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    return vNoParens.length > 6 && (cleanQuery.includes(vNoParens) || vNoParens.includes(cleanQuery));
  });
  if (containmentCandidates.length > 0) {
    containmentCandidates.sort((a, b) => {
      const aClean = (a.venue_name || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      const bClean = (b.venue_name || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      return Math.abs(aClean.length - cleanQuery.length) - Math.abs(bClean.length - cleanQuery.length);
    });
    return containmentCandidates[0];
  }

  // 4. Token Overlap Scoring with stopword suppression
  const commonStopwords = new Set([
    "gallery", "theatre", "theater", "hall", "centre", "center", "room", "park", "cafe", "club",
    "place", "house", "space", "vancouver", "public", "market", "gardens", "garden", "promenade",
    "courtyard", "district", "waterfront", "quay", "island", "plaza", "building", "square", "beach",
    "fine", "arts", "street", "avenue", "road", "drive", "lane", "studio", "studios", "stage",
    "lounge", "bar", "pub", "inn", "hotel", "society", "association", "classical", "the", "and",
    "for", "with", "at", "by", "of", "central", "north", "south", "east", "west", "main", "downtown",
    "burnaby", "city", "metro"
  ]);

  const queryTokens = cleanQuery.split(" ").filter((t) => t.length >= 3 && !commonStopwords.has(t));
  if (queryTokens.length === 0) return null;

  let bestMatch = null;
  let maxScore = 0;

  for (const v of venues) {
    const vClean = (v.venue_name || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const vTokens = new Set(vClean.split(" ").filter((t) => t.length >= 3 && !commonStopwords.has(t)));

    let score = 0;
    for (const qTok of queryTokens) {
      if (vTokens.has(qTok)) {
        score += 2;
      } else if (vClean.includes(qTok)) {
        score += 1;
      }
    }

    if (score > maxScore && score >= 2) {
      maxScore = score;
      bestMatch = v;
    }
  }

  return bestMatch;
}

/**
 * Detects generic button labels or membership pass names masquerading as event titles
 * (e.g. "Season Pass", "Buy Tickets", "General Admission", "Exhibits and experiences")
 */
export function isButtonOrPassLabelTitle(str) {
  if (!str || typeof str !== "string") return true;
  const s = str.trim();
  if (s.length < 3) return true;
  return /^(?:season\s*pass|annual\s*pass|membership|buy\s*tickets|get\s*tickets|tickets|general\s*admission|admission|exhibits\s+and\s+experiences|cultural\s+event|event|checkout|cart)$/i.test(s);
}

/**
 * Detects cross-layer conflicts or ambiguities between seed, schedule, box_office, and editorial layers
 */
export function detectLayerConflicts({ seed = {}, sched = {}, box = {}, edit = {}, existing = {}, venue = {} }) {
  const conflicts = [];

  // 1. Title conflict or button-label pollution
  const candidateTitles = [
    edit.clean_title,
    edit.title,
    sched.title,
    box.title,
    seed.seed_title || seed.title,
    existing.title
  ].filter((t) => t && typeof t === "string" && t.trim().length > 0);

  if (box.title && isButtonOrPassLabelTitle(box.title)) {
    conflicts.push(`box.title is a button/pass label ("${box.title}")`);
  }
  if (edit.clean_title && isButtonOrPassLabelTitle(edit.clean_title)) {
    conflicts.push(`edit.clean_title is a button/pass label ("${edit.clean_title}")`);
  }
  const uniqueNormTitles = new Set(
    candidateTitles
      .filter((t) => !isButtonOrPassLabelTitle(t))
      .map((t) => t.toLowerCase().replace(/[^a-z0-9]/g, ""))
  );
  if (uniqueNormTitles.size > 1 && sched.title && box.title && sched.title.toLowerCase().trim() !== box.title.toLowerCase().trim()) {
    conflicts.push(`title mismatch between schedule ("${sched.title}") and box office ("${box.title}")`);
  }

  // 2. Inventory vs. Live Tier Availability conflict
  const hasAvailableTier = Array.isArray(box.all_tiers) && box.all_tiers.some(
    (t) => t && t.is_available !== false && t.isAvailable !== false && !/\bsold\s*out\b/i.test(String(t.label || "")) && t.name !== "none_available"
  );
  if ((box.is_sold_out || sched.is_sold_out) && hasAvailableTier) {
    conflicts.push("is_sold_out flag is true while live all_tiers contains available tickets");
  }

  // 3. Date mismatch between Schedule Harvester and Box Office
  const sDate = parseHumanDateToIso(sched.date);
  const bDate = parseHumanDateToIso(box.date);
  if (sDate && bDate && sDate !== bDate) {
    conflicts.push(`date mismatch between schedule (${sDate}) and box office (${bDate})`);
  }

  // 4. Category conflict
  const cats = new Set([edit.category, sched.category, box.category].filter(Boolean));
  if (cats.size > 1) {
    conflicts.push(`category disagreement across layers (${Array.from(cats).join(" vs ")})`);
  }

  return conflicts;
}

/**
 * Gemini AI Compiler Arbitrator
 * Invoked when specialist layers conflict or require semantic arbitration
 */
async function callGeminiCompilerArbitrator(eventId, context, apiKey) {
  if (!apiKey || !apiKey.startsWith("AIzaSy")) return null;
  const { seed, sched, box, edit, existing, venue, curatorNote, conflicts } = context;

  const prompt = `You are the Van50 Compiler AI Arbitrator for Metro Vancouver cultural events (<= $50.00 CAD).
Multiple specialist pipeline layers (Seed, Schedule Harvester, Stagehand Box Office, Editorial Enricher, and Venue Registry) have reported data for event "${eventId}", and the following cross-layer conflicts were detected:
${conflicts.map((c) => `- ${c}`).join("\n")}

${curatorNote ? `MANDATORY CURATOR INSTRUCTION (Tier 1 Supreme Authority): "${curatorNote}"\n` : ""}
Multi-Layer Evidence:
- Seed: ${JSON.stringify({ title: seed.seed_title || seed.title, venue: seed.seed_venue || seed.venue, date: seed.date, url: seed.seed_url || seed.ticket_url })}
- Schedule Layer: ${JSON.stringify({ title: sched.title, date: sched.date, start_time: sched.start_time, doors_time: sched.doors_time, is_sold_out: sched.is_sold_out, category: sched.category })}
- Box Office Layer: ${JSON.stringify({ title: box.title, date: box.date, start_time: box.start_time, is_sold_out: box.is_sold_out, tier1_name: box.tier1_name, tier1_price_all_in: box.tier1_price_all_in, tier2_name: box.tier2_name, tier2_price_all_in: box.tier2_price_all_in, all_tiers: (box.all_tiers || []).slice(0, 5) })}
- Editorial Layer: ${JSON.stringify({ clean_title: edit.clean_title, artist: edit.artist, lineup: edit.lineup, category: edit.category, description: edit.description })}
- Existing Published Card: ${JSON.stringify({ title: existing.title, date: existing.date, price: existing.price, category: existing.category })}
- Grounded Venue: ${JSON.stringify({ venue_name: venue.venue_name, access_model: venue.access_model })}

Arbitration Rules:
1. NEVER pick a generic button/pass label ("Season Pass", "Buy Tickets", "General Admission", "Exhibits and experiences") as clean_title when a real show or venue title exists in Seed, Schedule, or Existing.
2. If any single-visit ticket tier (<= $50 CAD) in all_tiers is available, is_sold_out MUST be false.
3. For paid shows, select the true Adult / General Admission single-visit price (never $0 donation/child/member if a paid adult tier exists).

Return ONLY a valid JSON object:
{
  "clean_title": "Resolved authoritative event title",
  "artist": "Resolved lead artist/performer or null",
  "lineup": ["Performer 1"],
  "date": "YYYY-MM-DD or null",
  "start_time": "HH:MM AM/PM or null",
  "doors_time": "HH:MM AM/PM or null",
  "is_sold_out": false,
  "category": "shows | music | comedy | arts | outdoors | culture | free-public-access",
  "arbitration_reasoning": "1-sentence explanation of how the conflict was resolved"
}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.trim()}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? JSON.parse(text) : null;
  } catch (_) {
    return null;
  }
}

/**
 * AI Arbitrator & Publishing Compiler
 * Merges candidate layers according to the Multi-Dimension Arbitration Matrix
 */
export async function compileCatalog(options = {}) {
  const nowIso = new Date().toISOString();
  const todayIso = nowIso.slice(0, 10);

  const seeds = loadJson(SEEDS_PATH, []);
  const schedules = loadJson(SCHEDULES_PATH, []);
  const boxOffices = loadJson(BOX_OFFICE_PATH, []);
  const editorials = loadJson(EDITORIAL_PATH, []);
  const venues = loadJson(VENUES_PATH, []);
  const existingEvents = loadJson(EVENTS_PATH, []);
  const queueData = loadJson(QUEUE_PATH, { metadata: {}, quarantinedEvents: [] });
  const quarantinedEventsPool = Array.isArray(queueData.quarantinedEvents) ? queueData.quarantinedEvents : [];
  const quarantinedMap = new Map();
  quarantinedEventsPool.forEach((q) => quarantinedMap.set(q.id || q.event_id, q));

  const learnedRules = loadJson(path.join(DATA_DIR, "curator_learned_rules.json"), {});
  const archivedDoc = loadJson(ARCHIVED_PATH, { archivedEvents: [] });
  const archivedEventsList = Array.isArray(archivedDoc) ? archivedDoc : (archivedDoc.archivedEvents || []);
  const archivedIds = new Set([
    ...archivedEventsList.map((a) => a.id || a.event_id),
    ...(Array.isArray(learnedRules.archived_event_ids) ? learnedRules.archived_event_ids : []),
  ].filter(Boolean));

  let targetId = options.id || null;
  let targetIds = options.ids
    ? (Array.isArray(options.ids) ? options.ids : String(options.ids).split(",").map((s) => s.trim()).filter(Boolean))
    : null;

  if (targetId && targetId.includes(",")) {
    const splitIds = targetId.split(",").map((s) => s.trim()).filter(Boolean);
    if (splitIds.length > 1) {
      targetIds = splitIds;
      targetId = null;
    }
  }

  const isAll = options.all === true || options.all === "1" || options.all === "true";
  const force = options.force === true || options.force === "1" || options.force === "true";
  const limit = options.limit !== undefined ? parseInt(options.limit, 10) : 0;
  const offset = options.offset !== undefined ? parseInt(options.offset, 10) : 0;
  const uncompiledOnly = options.uncompiledOnly === true || options.uncompiledOnly === "1" || options.uncompiledOnly === "true";
  const incompleteOnly = options.incompleteOnly === true || options.incompleteOnly === "1" || options.incompleteOnly === "true";
  const stale = options.stale || options.olderThan || null;

  // Build existing map for uncompiled filtering
  const existingMap = new Map();
  existingEvents.forEach((e) => existingMap.set(e.id || e.event_id, e));

  function resolveSeed(id) {
    if (!id) return null;
    const foundSeed = seeds.find((s) => (s.id || s.event_id) === id);
    if (foundSeed) return foundSeed;
    const foundInEvents = existingEvents.find((e) => (e.id || e.event_id) === id);
    if (foundInEvents) return foundInEvents;
    const foundInQ = quarantinedMap.get(id);
    if (foundInQ) {
      foundInQ._isFromQuarantine = true;
      return foundInQ;
    }
    const foundSched = schedules.find((s) => (s.id || s.event_id) === id);
    if (foundSched) {
      return {
        id: foundSched.id || foundSched.event_id,
        event_id: foundSched.id || foundSched.event_id,
        seed_title: foundSched.title,
        title: foundSched.title,
        seed_venue: foundSched.venue || foundSched.venue_name,
        venue: foundSched.venue || foundSched.venue_name,
        seed_url: foundSched.ticket_url || foundSched.details_url || foundSched.source_url,
        ticket_url: foundSched.ticket_url,
        details_url: foundSched.details_url,
        date: foundSched.date,
        time: foundSched.time,
        lifecycle_type: "time_bound_event",
        _isFromHarvest: true
      };
    }
    const foundBox = boxOffices.find((b) => (b.id || b.event_id) === id);
    if (foundBox) {
      return {
        id: foundBox.id || foundBox.event_id,
        event_id: foundBox.id || foundBox.event_id,
        seed_title: foundBox.title,
        title: foundBox.title,
        seed_venue: foundBox.venue_name,
        venue: foundBox.venue_name,
        seed_url: foundBox.ticket_url,
        ticket_url: foundBox.ticket_url,
        lifecycle_type: "time_bound_event",
        _isFromHarvest: true
      };
    }
    return null;
  }

  // Combined pool of all potential seeds and quarantined cards
  const combinedAll = [...seeds];
  const seenIds = new Set(seeds.map((s) => s.id || s.event_id));
  quarantinedEventsPool.forEach((q) => {
    const id = q.id || q.event_id;
    if (!seenIds.has(id)) {
      q._isFromQuarantine = true;
      combinedAll.push(q);
      seenIds.add(id);
    }
  });

  let targetSeeds = [];
  if (isAll) {
    // Force compile through all events across catalog and quarantine candidates
    targetSeeds = [...combinedAll];
    if (offset > 0 || limit > 0) {
      targetSeeds = targetSeeds.slice(offset, limit > 0 ? offset + limit : undefined);
    }
  } else if (targetId) {
    const s = resolveSeed(targetId);
    if (s) targetSeeds.push(s);
  } else if (targetIds && targetIds.length > 0) {
    targetIds.forEach((id) => {
      const s = resolveSeed(id);
      if (s && !targetSeeds.some((x) => (x.id || x.event_id) === (s.id || s.event_id))) {
        targetSeeds.push(s);
      }
    });
  } else if (options.quarantine || options.quarantined) {
    targetSeeds = [...quarantinedEventsPool];
    if (offset > 0 || limit > 0) {
      targetSeeds = targetSeeds.slice(offset, limit > 0 ? offset + limit : undefined);
    }
  } else if (force) {
    // Force scan through all events (even those already run through)
    targetSeeds = [...combinedAll];
    if (offset > 0 || limit > 0) {
      targetSeeds = targetSeeds.slice(offset, limit > 0 ? offset + limit : undefined);
    }
  } else if (incompleteOnly) {
    // Target all events that haven't undergone all scans or are missing compile/publishing
    targetSeeds = combinedAll.filter((s) => {
      const id = s.id || s.event_id;
      const ex = existingMap.get(id);
      return !ex || !ex.last_full_qc_at || isScanIncomplete(ex || s);
    });
    if (offset > 0 || limit > 0) {
      targetSeeds = targetSeeds.slice(offset, limit > 0 ? offset + limit : undefined);
    }
  } else if (stale) {
    // Target events that haven't been scanned in 24 hours, 1 week, etc.
    const durationMs = parseDurationMs(stale);
    if (durationMs !== null) {
      targetSeeds = combinedAll.filter((s) => {
        const id = s.id || s.event_id;
        const ex = existingMap.get(id);
        const checkTarget = ex || s;
        return isEventStale(checkTarget, durationMs);
      });
    }
    if (offset > 0 || limit > 0) {
      targetSeeds = targetSeeds.slice(offset, limit > 0 ? offset + limit : undefined);
    }
  } else if (uncompiledOnly) {
    const uncompiledSeeds = seeds.filter((s) => {
      const id = s.id || s.event_id;
      const ex = existingMap.get(id);
      if (!ex || !ex.last_full_qc_at) return true;
      const sched = schedules.find((x) => (x.id || x.event_id) === id);
      const box = boxOffices.find((x) => (x.id || x.event_id) === id);
      const edit = editorials.find((x) => (x.id || x.event_id) === id);
      const lastCompile = new Date(ex.last_full_qc_at).getTime();
      if (sched?.audited_at && new Date(sched.audited_at).getTime() > lastCompile) return true;
      if (box?.audited_at && new Date(box.audited_at).getTime() > lastCompile) return true;
      if (edit?.enriched_at && new Date(edit.enriched_at).getTime() > lastCompile) return true;
      const vQuery = s.seed_venue || s.venue || s.venue_name;
      const vMatched = matchVenue(vQuery, venues);
      if (vMatched?.last_grounded_at && new Date(vMatched.last_grounded_at).getTime() > lastCompile) return true;
      return false;
    });

    const uncompiledActive = existingEvents.filter((ex) => {
      const id = ex.id || ex.event_id;
      if (!ex.last_full_qc_at) return true;
      const sched = schedules.find((x) => (x.id || x.event_id) === id);
      const box = boxOffices.find((x) => (x.id || x.event_id) === id);
      const edit = editorials.find((x) => (x.id || x.event_id) === id);
      const lastCompile = new Date(ex.last_full_qc_at).getTime();
      if (sched?.audited_at && new Date(sched.audited_at).getTime() > lastCompile) return true;
      if (box?.audited_at && new Date(box.audited_at).getTime() > lastCompile) return true;
      if (edit?.enriched_at && new Date(edit.enriched_at).getTime() > lastCompile) return true;
      if (ex.curator_reviewed_at && new Date(ex.curator_reviewed_at).getTime() > lastCompile) return true;
      const vQuery = ex.venue || ex.venue_name || ex.seed_venue;
      const vMatched = matchVenue(vQuery, venues);
      if (vMatched?.last_grounded_at && new Date(vMatched.last_grounded_at).getTime() > lastCompile) return true;
      return false;
    });

    const uncompiledQuarantined = quarantinedEventsPool.filter((q) => {
      const id = q.id || q.event_id;
      if (!q.last_full_qc_at) return true;
      const sched = schedules.find((x) => (x.id || x.event_id) === id);
      const box = boxOffices.find((x) => (x.id || x.event_id) === id);
      const edit = editorials.find((x) => (x.id || x.event_id) === id);
      const lastCompile = new Date(q.last_full_qc_at).getTime();
      if (sched?.audited_at && new Date(sched.audited_at).getTime() > lastCompile) return true;
      if (box?.audited_at && new Date(box.audited_at).getTime() > lastCompile) return true;
      if (edit?.enriched_at && new Date(edit.enriched_at).getTime() > lastCompile) return true;
      if (q.curator_reviewed_at && new Date(q.curator_reviewed_at).getTime() > lastCompile) return true;
      const vQuery = q.venue || q.venue_name || q.seed_venue;
      const vMatched = matchVenue(vQuery, venues);
      if (vMatched?.last_grounded_at && new Date(vMatched.last_grounded_at).getTime() > lastCompile) return true;
      return false;
    }).map((q) => {
      q._isFromQuarantine = true;
      return q;
    });

    const interleaved = [];
    const maxLen = Math.max(uncompiledSeeds.length, uncompiledActive.length, uncompiledQuarantined.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < uncompiledSeeds.length) interleaved.push(uncompiledSeeds[i]);
      if (i < uncompiledActive.length) interleaved.push(uncompiledActive[i]);
      if (i < uncompiledQuarantined.length) interleaved.push(uncompiledQuarantined[i]);
    }
    targetSeeds = interleaved;
    if (offset > 0 || limit > 0) {
      targetSeeds = targetSeeds.slice(offset, limit > 0 ? offset + limit : undefined);
    }
  } else if (offset > 0 || limit > 0) {
    targetSeeds = combinedAll.slice(offset, limit > 0 ? offset + limit : undefined);
  } else {
    const combinedAll = [...seeds];
    const seen = new Set(seeds.map((s) => s.id || s.event_id));
    quarantinedEventsPool.forEach((q) => {
      const id = q.id || q.event_id;
      if (!seen.has(id)) {
        q._isFromQuarantine = true;
        combinedAll.push(q);
        seen.add(id);
      }
    });
    targetSeeds = combinedAll;
  }

  const modeLabel = targetId
    ? `Single ID (${targetId})`
    : targetIds
      ? `Multiple IDs (${targetIds.length} cards)`
      : isAll
        ? `All Catalog Events (${seeds.length} cards)`
        : offset > 0
          ? `Range (#${offset + 1}–#${offset + (limit > 0 ? limit : targetSeeds.length)})`
          : limit > 0
            ? `Batch (${limit} cards)`
            : `All Catalog Events (${seeds.length} cards)`;

  console.log(`\n================================================================`);
  console.log(`⚡ COMPILER AI ARBITRATOR & CATALOG BUILDER`);
  console.log(`📊 Mode: ${modeLabel}`);
  console.log(`📋 Target Events to Compile: ${targetSeeds.length}`);
  console.log(`📊 Total Seeds: ${seeds.length} | Schedules: ${schedules.length} | Box Office: ${boxOffices.length} | Editorial: ${editorials.length}`);
  console.log(`🏛️ Master Venues: ${venues.length}`);
  console.log(`================================================================\n`);

  if (targetSeeds.length === 0) {
    console.log(`✅ No target events matched the requested compile scope.`);
    return { success: true, totalCompiled: 0, totalQuarantined: 0 };
  }

  const compiledEvents = [];
  const quarantinedEvents = [];

  // Monotonic Event_Num_Perm allocation map (preserves permanent IDs)
  const permMap = new Map();
  let maxPermNum = 0;
  const parsePerm = (val) => {
    if (!val || typeof val !== "string") return 0;
    const m = val.match(/Event_Num_Perm_(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  };

  [...existingEvents, ...quarantinedEventsPool, ...archivedEventsList, ...seeds].forEach((item) => {
    const id = item.id || item.event_id;
    if (id && item.Event_Num_Perm) {
      permMap.set(id, item.Event_Num_Perm);
      const num = parsePerm(item.Event_Num_Perm);
      if (num > maxPermNum) maxPermNum = num;
    }
  });

  // Track count of events where Venue Detailer ground truth (weight: 1.0) was applied
  let venueDetailerWeightedCount = 0;

  for (let idx = 0; idx < targetSeeds.length; idx++) {
    const seed = targetSeeds[idx];
    const eventId = seed.id || seed.event_id;
    const seedTitle = seed.seed_title || seed.title || "Vancouver Cultural Event";
    const seedVenue = seed.seed_venue || seed.venue || null;
    const seedUrl = seed.seed_url || seed.ticket_url || seed.details_url || seed.url || "";
    const seedLifecycle = (seed.lifecycle_type && seed.lifecycle_type !== "unknown") ? seed.lifecycle_type : null;

    // 1. Match Specialist Records (Strictly prioritize exact eventId match before any URL fallback)
    const sched =
      schedules.find((s) => (s.id || s.event_id) === eventId) ||
      schedules.find((s) => !(s.id || s.event_id) && seedUrl && (s.details_url === seedUrl || s.ticket_url === seedUrl || s.source_url === seedUrl)) ||
      {};
    const box =
      boxOffices.find((b) => (b.id || b.event_id) === eventId) ||
      boxOffices.find((b) => !(b.id || b.event_id) && seedUrl && (b.details_url === seedUrl || b.ticket_url === seedUrl || b.source_url === seedUrl)) ||
      {};
    const edit =
      editorials.find((e) => (e.id || e.event_id) === eventId) ||
      editorials.find((e) => !(e.id || e.event_id) && seedUrl && (e.details_url === seedUrl || e.ticket_url === seedUrl || e.source_url === seedUrl)) ||
      {};
    const existing = existingMap.get(eventId) || {};

    // 1B. Freshness Timestamp & Curator Lock Guard:
    // If an active card in data/events.json was directly audited by Cognitive QC AI more recently than all specialist layers
    // (or carries an active D806_curator_lock) and --force was not passed, preserve the verified card intact.
    if (!force && existing && existing.id && existing.dimension_audit) {
      const existingAuditTs = Date.parse(existing.last_qc_audited_at || existing.last_full_qc_at || "") || 0;
      const maxLayerTs = Math.max(
        Date.parse(sched.audited_at || "") || 0,
        Date.parse(box.audited_at || "") || 0,
        Date.parse(edit.audited_at || "") || 0
      );
      const isCuratorLocked = Boolean(
        existing.curator_lock === true ||
        existing.dimension_audit?.D806_curator_lock?.locked === true ||
        existing.dimension_audit?.D806_curator_lock?.value === true
      );
      if ((existingAuditTs > 0 && existingAuditTs > maxLayerTs) || isCuratorLocked) {
        console.log(`🔒 [Compiler Freshness Guard] Preserving directly audited/locked card: "${existing.title}" [${eventId}] (audited_at: ${existing.last_qc_audited_at})`);
        if (existing.start_time) existing.start_time = formatTime12h(existing.start_time);
        if (existing.time) existing.time = formatTime12h(existing.time);
        if (existing.doors_time) existing.doors_time = formatTime12h(existing.doors_time);
        if (existing.end_time) existing.end_time = formatTime12h(existing.end_time);
        if (existing.dateSchedule) existing.dateSchedule = formatSchedule12h(existing.dateSchedule);
        if (Array.isArray(existing.showings)) {
          existing.showings = existing.showings.map((s) => ({
            ...s,
            ...(s.start_time ? { start_time: formatTime12h(s.start_time) } : {}),
            ...(s.doors_time ? { doors_time: formatTime12h(s.doors_time) } : {}),
            ...(s.end_time ? { end_time: formatTime12h(s.end_time) } : {}),
          }));
        }
        if (existing.dimension_audit?.D305_doors_time?.value) existing.dimension_audit.D305_doors_time.value = formatTime12h(existing.dimension_audit.D305_doors_time.value);
        if (existing.dimension_audit?.D306_start_time?.value) existing.dimension_audit.D306_start_time.value = formatTime12h(existing.dimension_audit.D306_start_time.value);
        if (existing.dimension_audit?.D307_end_time?.value) existing.dimension_audit.D307_end_time.value = formatTime12h(existing.dimension_audit.D307_end_time.value);
        if (existing.dimension_audit?.D308_dateSchedule?.value) existing.dimension_audit.D308_dateSchedule.value = formatSchedule12h(existing.dimension_audit.D308_dateSchedule.value);
        compiledEvents.push(existing);
        continue;
      }
    }

    // 2. Match Venue Master Record & Compute Smart Weighting (Perennial Identity Lock)
    const isSeedPerennial = seedLifecycle === "perennial_drop_in" || existing.lifecycle_type === "perennial_drop_in";
    const venueQuery = isSeedPerennial
      ? (seedVenue || existing.venue_name || existing.venue || box.venue_name || sched.venue_name)
      : (box.venue_name || sched.venue_name || seedVenue);
    const matchedVenue = matchVenue(venueQuery, venues);

    // Smart Weighting Architecture (Epistemic Precedence Hierarchy - Rule 2E):
    // Facilities grounded by Stage 4 Venue Detailer AI hold authoritative ground truth (Weight: 1.0).
    const isVenueDetailerGrounded = Boolean(matchedVenue && matchedVenue.last_grounded_at);
    const venueTrustWeight = isVenueDetailerGrounded ? 1.0 : (matchedVenue ? 0.8 : 0.4);
    const venueSourceTool = isVenueDetailerGrounded ? "venue_detailer_ai" : (matchedVenue ? "venue_master_registry" : "fallback_default");
    const venueAuditedAt = (matchedVenue && matchedVenue.last_grounded_at) || nowIso;

    if (isVenueDetailerGrounded) {
      venueDetailerWeightedCount++;
    }

    const isOutdoorSeed = seedVenue ? /park|beach|seawall|canyon|trail|promenade|garden/i.test(seedVenue) : false;
    const fallbackVenue = {
      venue_name: seedVenue || null,
      full_address: null,
      neighborhood: (seedVenue && /stanley\s*park/i.test(seedVenue)) ? "Stanley Park / West End" : null,
      coordinates: (seedVenue && /stanley\s*park/i.test(seedVenue)) ? [49.3017, -123.1417] : null,
      access_model: null,
      environment_type: null,
      weekly_hours: null,
      coffee_benchmark: null,
      beer_benchmark: null,
      cocktail_benchmark: null,
      meal_benchmark: null,
      spend_benchmarks: {
        coffee: null,
        beer: null,
        cocktail: null,
        meal: null
      },
      transit_info: /stanley\s*park/i.test(seedVenue) ? "#19 Stanley Park bus directly to park loop" : null,
      waypoints: [],
      restrictions: null,
      website_url: "",
      calendar_url: "",
    };

    const venue = matchedVenue || fallbackVenue;

    // 2B. COMPILER AI CONFLICT DETECTION & ARBITRATION (Antigravity 1-Event Worker OR Gemini API)
    const rawApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
    const compilerApiKey = rawApiKey.startsWith("AIzaSy") ? rawApiKey : "";
    const useAgy = options.engine === "antigravity" || isAntigravityEngine();
    const detectedConflicts = detectLayerConflicts({ seed, sched, box, edit, existing, venue });
    let aiArbitration = null;
    if ((useAgy || compilerApiKey) && (detectedConflicts.length > 0 || options.ai)) {
      console.log(`🤖 [Compiler AI Arbitrator${useAgy ? ` • Antigravity (${getAntigravityModel()})` : ""}] Resolving ${detectedConflicts.length} cross-layer conflict(s) for "${eventId}": ${detectedConflicts.join("; ")}`);
      const earlyCurator = getCuratorInfo({ eventId, title: seedTitle, venue: venue.venue_name, existingCard: existing });
      const arbContext = { seed, sched, box, edit, existing, venue, curatorNote: earlyCurator.effectiveNote, conflicts: detectedConflicts };
      aiArbitration = useAgy
        ? await callAntigravityCompilerArbitrator(eventId, arbContext)
        : await callGeminiCompilerArbitrator(eventId, arbContext, compilerApiKey);
      if (aiArbitration) {
        console.log(`   ✨ [Compiler AI Decision]: "${aiArbitration.clean_title}" | SoldOut=${aiArbitration.is_sold_out} | Reason: ${aiArbitration.arbitration_reasoning || (useAgy ? "Resolved via Antigravity 1-Event Worker" : "Resolved via Gemini")}`);
        if (aiArbitration.clean_title && !isButtonOrPassLabelTitle(aiArbitration.clean_title)) edit.clean_title = aiArbitration.clean_title;
        if (aiArbitration.artist !== undefined) edit.artist = aiArbitration.artist;
        if (Array.isArray(aiArbitration.lineup) && aiArbitration.lineup.length > 0) edit.lineup = aiArbitration.lineup;
        if (aiArbitration.date && /^\d{4}-\d{2}-\d{2}$/.test(aiArbitration.date)) sched.date = aiArbitration.date;
        if (aiArbitration.start_time) sched.start_time = aiArbitration.start_time;
        if (aiArbitration.doors_time) sched.doors_time = aiArbitration.doors_time;
        if (typeof aiArbitration.is_sold_out === "boolean") box.is_sold_out = aiArbitration.is_sold_out;
        if (aiArbitration.category) edit.category = aiArbitration.category;
      }
    }

    // 3. AI ARBITRATION: Lifecycle & Showings (5 Slots)
    const isPerennial =
      (seedLifecycle === "perennial_drop_in" ||
        sched.lifecycle_type === "perennial_drop_in" ||
        venue.access_model === "open_public_space") &&
      Boolean(venue.weekly_hours || venue.grounding_source === "known_physical_ground_truth");

    // Weekly Recurrence Resolution: Prioritize AI-verified lifecycle_type & weekly_recurring_day from Stage 3 Enricher;
    // never scan raw description prose with regexes (which can false-trigger if a one-off show mentions a weekday in passing).
    const WEEKDAY_INDEX_MAP = {
      sunday: { dayIndex: 0, dayName: "Sunday" },
      monday: { dayIndex: 1, dayName: "Monday" },
      tuesday: { dayIndex: 2, dayName: "Tuesday" },
      wednesday: { dayIndex: 3, dayName: "Wednesday" },
      thursday: { dayIndex: 4, dayName: "Thursday" },
      friday: { dayIndex: 5, dayName: "Friday" },
      saturday: { dayIndex: 6, dayName: "Saturday" }
    };
    const aiRecurringDay = edit.weekly_recurring_day ? WEEKDAY_INDEX_MAP[String(edit.weekly_recurring_day).toLowerCase().trim()] : null;
    const isAiConfirmedWeekly = edit.lifecycle_type === "weekly_recurring_residency" || sched.lifecycle_type === "weekly_recurring_residency" || seedLifecycle === "weekly_recurring_residency";
    const isExplicitlyNonRecurring = edit.lifecycle_type === "time_bound_event" && edit.source_engine && edit.source_engine !== "deterministic_cognitive_nlp";

    const titleAndFreqText = `${seedTitle} ${sched.title || ""} ${sched.frequency || ""} ${edit.frequencyLabel || ""}`;
    const recurrence = aiRecurringDay
      ? {
        frequency: "Weekly Recurring",
        frequencyLabel: `Weekly on ${aiRecurringDay.dayName}s`,
        dayIndex: aiRecurringDay.dayIndex,
        dayName: aiRecurringDay.dayName
      }
      : (!isExplicitlyNonRecurring || isAiConfirmedWeekly)
        ? detectWeeklyRecurrence(titleAndFreqText, sched.frequency || box.frequency || edit.frequency)
        : null;
    const isWeekly = Boolean(recurrence && recurrence.dayIndex != null);

    let showings = [];
    let heroDate = null;
    let heroStartTime = null;
    let heroDoorsTime = null;
    let heroEndTime = null;
    let dateSchedule = "Perennial Daily Access (Year-Round)";
    let frequency = isPerennial ? "Perennial Drop-In" : null;
    let frequencyLabel = isPerennial ? "Perennial Drop-In" : null;

    if (isPerennial) {
      // Perennials have standing hours, zero calendar expiration
      heroDate = null;
      heroStartTime = null;
      heroDoorsTime = null;
      heroEndTime = null;
      const formatWeeklyHours = (wh) => {
        if (!wh) return null;
        if (typeof wh === "string" && wh.trim().length > 0) return wh.trim();
        if (typeof wh === "object") {
          const vals = Object.values(wh).filter(Boolean);
          if (vals.length === 7 && vals.every((v) => v === vals[0])) {
            return `Daily: ${vals[0]}`;
          }
          const entries = Object.entries(wh)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k.slice(0, 3).replace(/^./, (c) => c.toUpperCase())}: ${v}`);
          if (entries.length > 0) return entries.join(" • ");
        }
        return null;
      };
      dateSchedule = formatSchedule12h(
        (existing.dateSchedule && existing.dateSchedule !== "Schedule Pending Verification" && existing.dateSchedule !== "Perennial Daily Access (Year-Round)")
          ? existing.dateSchedule
          : (formatWeeklyHours(venue.weekly_hours) || "Perennial Daily Access (Year-Round)")
      );
      frequency = "Perennial Drop-In";
      frequencyLabel = "Perennial Drop-In";
      showings = [];
    } else {
      // Time-bound event: Process candidate showings
      const fallbackDate = extractFallbackDate(eventId, seedUrl || existing.ticket_url || box.ticket_url, seed, existing);
      const fallbackTime = formatTime12h(seed.time || existing.time || seed.start_time || existing.start_time || null);
      const fallbackDoors = formatTime12h(seed.doors_time || existing.doors_time || null);
      const fallbackEnd = formatTime12h(seed.end_time || existing.end_time || null);

      const candidateShowings =
        (Array.isArray(sched.showings) && sched.showings.length > 0)
          ? sched.showings
          : (Array.isArray(box.showings) && box.showings.length > 0)
            ? box.showings
            : (Array.isArray(seed.showings) && seed.showings.length > 0)
              ? seed.showings
              : (Array.isArray(existing.showings) && existing.showings.length > 0)
                ? existing.showings
                : (sched.date || box.date || fallbackDate)
                  ? [
                    {
                      slot: 1,
                      date: sched.date || box.date || fallbackDate,
                      start_time: formatTime12h(sched.start_time || box.start_time || fallbackTime),
                      doors_time: formatTime12h(sched.doors_time || box.doors_time || fallbackDoors),
                      end_time: formatTime12h(sched.end_time || box.end_time || fallbackEnd),
                      status: "upcoming",
                    },
                  ]
                  : [];

      const validCandidateShowings = candidateShowings.filter((s) => s && s.date && s.date !== "none_available" && s.date !== "TBD" && !s.date.includes("Pending"));

      showings = validCandidateShowings.slice(0, 5).map((s, idx) => {
        const rawSlotDate = (s.date && s.date !== "none_available" && s.date !== "TBD") ? s.date : (fallbackDate || null);
        const slotDate = parseHumanDateToIso(rawSlotDate) || rawSlotDate;
        const isPast = slotDate && /^\d{4}-\d{2}-\d{2}$/.test(slotDate) ? (slotDate < todayIso) : false;
        return {
          slot: idx + 1,
          date: slotDate,
          start_time: formatTime12h((s.start_time && s.start_time !== "none_available") ? s.start_time : (fallbackTime || null)),
          doors_time: formatTime12h((s.doors_time && s.doors_time !== "none_available") ? s.doors_time : (fallbackDoors || null)),
          end_time: formatTime12h((s.end_time && s.end_time !== "none_available") ? s.end_time : (fallbackEnd || null)),
          status: isPast ? "concluded" : (s.status || "upcoming"),
        };
      });

      // Weekly Recurring Auto-Roll: If all candidate showings are concluded (or none exist), roll to next active occurrence
      const hasActiveShowing = showings.some((s) => s.status !== "concluded" && s.date);
      if (isWeekly && !hasActiveShowing) {
        const nextOccurrence = getNextWeekdayDate(recurrence.dayIndex, todayIso);
        const rolledStartTime = formatTime12h(sched.start_time || box.start_time || fallbackTime || null);
        const rolledDoorsTime = formatTime12h(sched.doors_time || box.doors_time || fallbackDoors);
        const rolledEndTime = formatTime12h(sched.end_time || box.end_time || fallbackEnd);
        showings = [
          {
            slot: 1,
            date: nextOccurrence,
            start_time: rolledStartTime,
            doors_time: rolledDoorsTime,
            end_time: rolledEndTime,
            status: "upcoming",
          },
          ...showings.slice(0, 4).map((s, idx) => ({ ...s, slot: idx + 2 })),
        ];
      }

      // Auto-Roll: Pick the next upcoming showing as hero date
      const nextUpcoming = showings.find((s) => s.status !== "concluded" && s.date && s.date !== "none_available") || showings[showings.length - 1];
      if (nextUpcoming && nextUpcoming.date && nextUpcoming.date !== "none_available") {
        heroDate = nextUpcoming.date;
        heroStartTime = formatTime12h(nextUpcoming.start_time);
        heroDoorsTime = formatTime12h(nextUpcoming.doors_time);
        heroEndTime = formatTime12h(nextUpcoming.end_time);
        dateSchedule = heroStartTime ? `${heroDate} • ${heroStartTime}` : heroDate;
      } else {
        const rawDate = sched.date || box.date || fallbackDate || null;
        heroDate = (rawDate && rawDate !== "none_available" && rawDate !== "TBD") ? rawDate : null;
        const rawStartTime = sched.start_time || box.start_time || fallbackTime || null;
        heroStartTime = (rawStartTime && rawStartTime !== "none_available") ? formatTime12h(rawStartTime) : null;
        const rawDoors = sched.doors_time || box.doors_time || fallbackDoors || null;
        heroDoorsTime = (rawDoors && rawDoors !== "none_available") ? formatTime12h(rawDoors) : null;
        const rawEnd = sched.end_time || box.end_time || fallbackEnd || null;
        heroEndTime = (rawEnd && rawEnd !== "none_available") ? formatTime12h(rawEnd) : null;
        dateSchedule = heroDate ? (heroStartTime ? `${heroDate} • ${heroStartTime}` : heroDate) : "Schedule Pending Verification";
      }

      // D309: If there are no dates (and not perennial), it CANNOT be inferred to be a one-off
      if (heroDate && heroDate !== "none_available") {
        if (isWeekly) {
          frequency = "Weekly Recurring";
          frequencyLabel = recurrence.frequencyLabel;
        } else {
          frequency = "One-Off";
          frequencyLabel = "One-Time Event";
        }
      } else {
        frequency = null;
        frequencyLabel = null;
      }
    }

    const resolvedLifecycle = isPerennial
      ? "perennial_drop_in"
      : (heroDate || (showings.length > 0 && showings.some((s) => s.date && s.date !== "none_available")) || seedLifecycle === "time_bound_event")
        ? "time_bound_event"
        : null;

    // 4. AI ARBITRATION: Box Office & Dual-Entry Ledger (Read vs Calculated)
    const hasAuditedBoxOffice = Boolean(box.audited_at);
    const hasAuditedSchedule = Boolean(sched.audited_at);

    // Filter out multi-month memberships / annual passes and any tier exceeding the $50.00 CAD ceiling
    const eligibleAllTiers = Array.isArray(box.all_tiers)
      ? box.all_tiers.filter((t) => {
        if (!t) return false;
        const tName = String(t.name || "");
        if (/\b(?:annual|membership|season\s*pass|12[- ]month|unlimited\s*access)\b/i.test(tName)) return false;
        const tPrice = Number(t.price_all_in ?? t.price ?? t.price_read ?? t.price_base ?? 0);
        if (!isNaN(tPrice) && tPrice > 50.0) return false;
        return true;
      })
      : [];

    // Tier-Grounded Sold-Out Arbitration:
    // 1. Open public spaces / free public access perennials cannot be sold out.
    // 2. If any eligible single-visit tier in the live box office cart is available, the event is available (overrides false-positive sidebar/early-bird Sold Out flags).
    // 3. Otherwise, defer to live Stagehand box office status first, then schedule status.
    const hasAvailableEligibleTier = eligibleAllTiers.some(
      (t) => t.is_available !== false && t.isAvailable !== false && !/\bsold\s*out\b/i.test(String(t.label || "")) && t.name !== "none_available"
    );
    const isFreePublicVenue = isPerennial && (venue.access_model === "open_public_space" || venue.access_model === "free_public_access");
    const isSoldOut = (isFreePublicVenue || hasAvailableEligibleTier)
      ? false
      : Boolean(hasAuditedBoxOffice ? box.is_sold_out : (box.is_sold_out || sched.is_sold_out));

    const tier1Base = box.tier1_price_base ?? sched.price_base ?? (isPerennial ? 0 : null);
    const tier1Fee = box.tier1_price_fee ?? (isPerennial ? 0 : (tier1Base != null ? 0 : null));
    const tier1Tax = box.tier1_price_tax ?? (isPerennial ? 0 : (tier1Base != null ? 0 : null));
    const tier1Other = box.other_cost_price ?? (isPerennial ? 0 : (tier1Base != null ? 0 : null));
    const tier1Calculated = (tier1Base != null) ? (tier1Base + (tier1Fee ?? 0) + (tier1Tax ?? 0) + (tier1Other ?? 0)) : null;

    // Read total is what the live cart modal displayed on the "Order Total" line
    const tier1Read = box.tier1_price_read ?? box.tier1_price_all_in ?? sched.price_all_in ?? tier1Calculated;
    const tier1Delta = (tier1Read != null && tier1Calculated != null) ? Math.abs(tier1Read - tier1Calculated) : null;

    // Guardrail: Sold Out !== Free, and Paid Perennials (e.g. Museums <= $50) !== Free
    let finalAllInPrice = tier1Read;
    let priceLabel = "Pending Box Office QC";
    let isFree = false;

    const isPaidPerennial = isPerennial && tier1Read != null && tier1Read > 0 && venue.access_model !== "open_public_space" && venue.access_model !== "free_public_access";

    if (isPerennial && !isPaidPerennial) {
      finalAllInPrice = 0;
      priceLabel = "Free ($0)";
      isFree = true;
    } else if (isPaidPerennial) {
      finalAllInPrice = tier1Read;
      priceLabel = `$${finalAllInPrice.toFixed(2)} CAD`;
      isFree = false;
    } else if (isSoldOut && tier1Read === 0 && tier1Base > 0) {
      finalAllInPrice = tier1Base;
      priceLabel = "Sold Out";
      isFree = false;
    } else if (isSoldOut && tier1Read === 0 && tier1Base === 0 && sched.price > 0) {
      finalAllInPrice = sched.price;
      priceLabel = "Sold Out";
      isFree = false;
    } else if (hasAuditedBoxOffice || hasAuditedSchedule) {
      const hasFreeQuote = Boolean(
        (box.tier1_quote && (box.tier1_quote.toLowerCase().includes("free") || box.tier1_quote.includes("$0"))) ||
        (box.tier1_name && box.tier1_name.toLowerCase().includes("free")) ||
        box.pricing_model === "free_access"
      );
      if (finalAllInPrice === 0 && (hasFreeQuote || Boolean(box.tier1_quote))) {
        isFree = true;
        priceLabel = "Free ($0)";
      } else if (finalAllInPrice != null && finalAllInPrice > 0) {
        priceLabel = `$${finalAllInPrice.toFixed(2)} CAD`;
        isFree = false;
      } else {
        finalAllInPrice = sched.price ?? null;
        priceLabel = finalAllInPrice != null ? `$${finalAllInPrice.toFixed(2)} CAD` : "Pending Box Office QC";
        isFree = false;
      }
    } else {
      // Clean seed awaiting organic Stagehand / Harvester audit
      finalAllInPrice = null;
      priceLabel = "Pending Box Office QC";
      isFree = false;
    }

    // 4B. Tiers 2 & 3 Dual-Entry Calculations (Strictly from eligible <= $50 single-visit tiers)
    if (eligibleAllTiers.length > 0) {
      if (!box.tier1_name && eligibleAllTiers[0]) {
        box.tier1_name = eligibleAllTiers[0].name;
        box.tier1_price_base = eligibleAllTiers[0].price_base;
        box.tier1_price_fee = eligibleAllTiers[0].price_fee;
        box.tier1_price_tax = eligibleAllTiers[0].price_tax;
        box.tier1_price_all_in = eligibleAllTiers[0].price_all_in ?? eligibleAllTiers[0].price;
      }
      if (!box.tier2_name && eligibleAllTiers[1]) {
        box.tier2_name = eligibleAllTiers[1].name;
        box.tier2_price_base = eligibleAllTiers[1].price_base;
        box.tier2_price_fee = eligibleAllTiers[1].price_fee;
        box.tier2_price_tax = eligibleAllTiers[1].price_tax;
        box.tier2_price_all_in = eligibleAllTiers[1].price_all_in ?? eligibleAllTiers[1].price;
      }
      if (!box.tier3_name && eligibleAllTiers[2]) {
        box.tier3_name = eligibleAllTiers[2].name;
        box.tier3_price_base = eligibleAllTiers[2].price_base;
        box.tier3_price_fee = eligibleAllTiers[2].price_fee;
        box.tier3_price_tax = eligibleAllTiers[2].price_tax;
        box.tier3_price_all_in = eligibleAllTiers[2].price_all_in ?? eligibleAllTiers[2].price;
      }
    }
    // Strip any direct tier2/tier3 fields that are annual memberships or exceed $50 CAD
    if (box.tier2_name && (/\b(?:annual|membership|season\s*pass|12[- ]month|unlimited\s*access)\b/i.test(box.tier2_name) || Number(box.tier2_price_all_in ?? box.tier2_price_base ?? 0) > 50)) {
      box.tier2_name = null;
      box.tier2_price_base = null;
      box.tier2_price_fee = null;
      box.tier2_price_tax = null;
      box.tier2_price_all_in = null;
      box.tier2_price_read = null;
    }
    if (box.tier3_name && (/\b(?:annual|membership|season\s*pass|12[- ]month|unlimited\s*access)\b/i.test(box.tier3_name) || Number(box.tier3_price_all_in ?? box.tier3_price_base ?? 0) > 50)) {
      box.tier3_name = null;
      box.tier3_price_base = null;
      box.tier3_price_fee = null;
      box.tier3_price_tax = null;
      box.tier3_price_all_in = null;
      box.tier3_price_read = null;
    }

    const tier2Base = box.tier2_price_base ?? null;
    const tier2Fee = box.tier2_price_fee ?? null;
    const tier2Tax = box.tier2_price_tax ?? null;
    const tier2Calculated = (tier2Base != null && tier2Fee != null && tier2Tax != null) ? (tier2Base + tier2Fee + tier2Tax) : (box.tier2_price_all_in ?? null);
    const tier2Read = box.tier2_price_read ?? box.tier2_price_all_in ?? tier2Calculated;
    const tier2Delta = (tier2Read != null && tier2Calculated != null) ? Math.abs(tier2Read - tier2Calculated) : null;
    const tier2Name = (box.tier2_name && box.tier2_name !== "none_available")
      ? box.tier2_name
      : (tier2Read != null && tier2Read > tier1Read)
        ? "Tier 2 / General Admission Door/Reserved"
        : null;

    const tier3Base = box.tier3_price_base ?? null;
    const tier3Fee = box.tier3_price_fee ?? null;
    const tier3Tax = box.tier3_price_tax ?? null;
    const tier3Calculated = (tier3Base != null && tier3Fee != null && tier3Tax != null) ? (tier3Base + tier3Fee + tier3Tax) : (box.tier3_price_all_in ?? null);
    const tier3Read = box.tier3_price_read ?? box.tier3_price_all_in ?? tier3Calculated;
    const tier3Delta = (tier3Read != null && tier3Calculated != null) ? Math.abs(tier3Read - tier3Calculated) : null;
    const tier3Name = (box.tier3_name && box.tier3_name !== "none_available")
      ? box.tier3_name
      : (tier3Read != null && tier3Read > (tier2Read ?? tier1Read))
        ? "Tier 3 / VIP / Reserved"
        : null;

    // 5. AI ARBITRATION: Clean Titles & Performer Lineups (Perennial Identity Lock & Anti-Button-Label Guard)
    const pickValidTitle = (...candidates) => {
      for (const c of candidates) {
        if (c && typeof c === "string" && c.trim().length > 2 && !isButtonOrPassLabelTitle(c)) {
          return c.trim();
        }
      }
      return seedTitle || "Vancouver Cultural Event";
    };
    const rawCandidateTitle = isPerennial
      ? pickValidTitle(aiArbitration?.clean_title, seedTitle, existing.title, edit.clean_title, edit.title, sched.title)
      : pickValidTitle(aiArbitration?.clean_title, edit.clean_title, edit.title, sched.title, seedTitle, existing.title);
    const cleanTitle = rawCandidateTitle
      .replace(/^(GET TICKETS|BUY TICKETS|TICKETS|ON SALE NOW|MODO-LIVE PRESENTS:?|PRESENTS:?)\s*[-•:]?\s*/i, "")
      .replace(/\s*[-•:]?\s*(BUY TICKETS|TICKETS ON SALE NOW|MORE INFO→)$/i, "")
      .trim();

    const rawLineup = (Array.isArray(edit.lineup) && edit.lineup.length > 0)
      ? edit.lineup
      : (Array.isArray(sched.lineup) && sched.lineup.length > 0)
        ? sched.lineup
        : (Array.isArray(box.lineup) && box.lineup.length > 0)
          ? box.lineup
          : (sched.artist && sched.artist.toLowerCase().trim() !== cleanTitle.toLowerCase().trim())
            ? [sched.artist]
            : [];

    const lineup = rawLineup.filter((member) => {
      if (!member || typeof member !== "string") return false;
      const mClean = member.toLowerCase().trim();
      if (mClean === cleanTitle.toLowerCase().trim()) return false;
      if (venue.venue_name && mClean === venue.venue_name.toLowerCase().trim()) return false;
      if (mClean === "various artists" || mClean === "lineup tba" || mClean === "tba") return false;
      return true;
    });

    const artist = (edit.artist !== undefined && edit.artist !== null)
      ? edit.artist
      : (sched.artist && sched.artist.toLowerCase().trim() !== cleanTitle.toLowerCase().trim())
        ? sched.artist
        : (lineup.length > 0 ? lineup[0] : null);

    // 6. AI ARBITRATION: Categories & Search Tags
    const rawCategory = edit.category || sched.category || box.category || null;
    const categories = (Array.isArray(edit.categories) && edit.categories.length > 0 && edit.categories[0])
      ? edit.categories
      : (rawCategory ? [rawCategory] : (isPerennial ? ["free-public-access"] : []));

    // D005: Do not infer fake tags if not explicitly provided by organizer/page
    const tags = (Array.isArray(edit.tags) && edit.tags.length > 0)
      ? edit.tags
      : [];

    const subTags = (Array.isArray(edit.subTags) && edit.subTags.length > 0)
      ? edit.subTags
      : tags;

    let description = edit.description || sched.description || box.description || null;
    if (description && (description.trim().length < 15 || description.trim() === `${cleanTitle} at ${venue.venue_name}.` || isCannedOrSyntheticDesc(description, cleanTitle))) {
      description = null;
    }

    // Deep Link & Hierarchy Arbitration (Rule 2E: Curator Rules Supreme)
    const curatorInfo = getCuratorInfo({
      eventId,
      title: cleanTitle,
      venue: venue.venue_name,
      existingCard: existing
    });
    const curatorOverrideUrl = (curatorInfo.instructedUrl && isValidDeepLink(curatorInfo.instructedUrl))
      ? curatorInfo.instructedUrl
      : null;

    const isCuratorTier1 = Boolean(curatorOverrideUrl && isWhitelistedTicketingUrl(curatorOverrideUrl));
    const normalizeUrlForCompare = (u) => (u || "").trim().replace(/\/+$/, "").toLowerCase();

    // Poison-Pill Dead URL Blacklist: Any URL proven dead in Stage 1B or Stage 2 must NEVER be resurrected from older layers
    const deadUrlsSet = new Set(
      [
        ...(Array.isArray(box.dead_urls) ? box.dead_urls : []),
        ...(Array.isArray(sched.dead_urls) ? sched.dead_urls : []),
        ...(Array.isArray(seed.dead_urls) ? seed.dead_urls : []),
        ...(Array.isArray(existing.dead_urls) ? existing.dead_urls : []),
        box.failed_url || null,
        (box.status && box.status.startsWith("FATAL_")) ? box.ticket_url : null,
      ]
        .filter(Boolean)
        .map(normalizeUrlForCompare)
        .filter(Boolean)
    );

    const isLiveEligibleLink = (u) => {
      if (!isValidDeepLink(u)) return false;
      const norm = normalizeUrlForCompare(u);
      if (curatorOverrideUrl && norm === normalizeUrlForCompare(curatorOverrideUrl)) return true;
      return !deadUrlsSet.has(norm);
    };

    const isBoxFatal = Boolean(box.status && box.status.startsWith("FATAL_"));

    const isTrueDirectTier1BoxOfficeUrl = (u) => {
      if (!isLiveEligibleLink(u)) return false;
      if (isFreePublicVenue || isFree || box.status === "VERIFIED_FREE_PUBLIC_ACCESS") return false;
      if (box.booking_protocol === "walk_up_only" || sched.booking_protocol === "walk_up_only") return false;
      if (isWhitelistedTicketingUrl(u)) return true;
      try {
        const parsed = new URL(u);
        const fullPath = `${parsed.pathname}${parsed.search}`.toLowerCase();
        // Only classify non-whitelisted URLs as Tier 1 if they have explicit e-commerce checkout/cart endpoints
        if (/\/(?:checkout|cart|tickets-checkout|buy-tickets|purchase|order|websales\/pages\/ticket)|select-date\?modal_widget=true/i.test(fullPath)) {
          return true;
        }
        return false;
      } catch {
        return false;
      }
    };

    const verifiedTier1Url = (isCuratorTier1 ? curatorOverrideUrl : null) ||
      ((!isBoxFatal && isLiveEligibleLink(box.ticket_url) && isWhitelistedTicketingUrl(box.ticket_url)) ? box.ticket_url : null) ||
      ((!isFreePublicVenue && !isFree && isLiveEligibleLink(sched.candidate_tier1_url) && isWhitelistedTicketingUrl(sched.candidate_tier1_url)) ? sched.candidate_tier1_url : null) ||
      ((sched.best_tier === "tier1" && isLiveEligibleLink(sched.ticket_url) && isWhitelistedTicketingUrl(sched.ticket_url)) ? sched.ticket_url : null) ||
      ((isLiveEligibleLink(seed.tier1_url) && isWhitelistedTicketingUrl(seed.tier1_url)) ? seed.tier1_url : null) ||
      ((!isBoxFatal && isTrueDirectTier1BoxOfficeUrl(box.ticket_url)) ? box.ticket_url : null);

    // D2 requires extracting verified schedule facts (Gate 5 & Layer 2: stub pages with no dates cannot be verified event pages)
    const hasVerifiedSchedulePage = Boolean(
      (heroDate && heroDate !== "none_available") ||
      (isPerennial && (venue.weekly_hours || venue.access_model === "free_public_access")) ||
      curatorOverrideUrl
    ) && Boolean(
      curatorOverrideUrl ||
      (sched.details_url && isLiveEligibleLink(sched.details_url)) ||
      (sched.ticket_url && isLiveEligibleLink(sched.ticket_url)) ||
      (sched.audited_at && isLiveEligibleLink(seedUrl))
    );

    const detailsUrl = hasVerifiedSchedulePage
      ? (curatorOverrideUrl || (isLiveEligibleLink(sched.details_url) ? sched.details_url : (isLiveEligibleLink(sched.ticket_url) ? sched.ticket_url : (isLiveEligibleLink(seedUrl) ? seedUrl : null))))
      : null;

    const calendarUrl = (curatorInfo.learnedVenueUrl && isLiveEligibleLink(curatorInfo.learnedVenueUrl))
      ? curatorInfo.learnedVenueUrl
      : ((venue.calendar_url && isLiveEligibleLink(venue.calendar_url))
          ? venue.calendar_url
          : ((sched.links?.tier3_calendar && isLiveEligibleLink(sched.links.tier3_calendar)) ? sched.links.tier3_calendar : null));

    // Same-Domain Guard for Venue Home (Prevents cross-venue domain leaks like thepolygon.ca on theshipyardsdistrict.ca)
    const rawVenueWebUrl = (venue.website_url && isValidDeepLink(venue.website_url))
      ? venue.website_url
      : ((sched.links?.tier5_venue_home && isValidDeepLink(sched.links.tier5_venue_home)) ? sched.links.tier5_venue_home : null);
    const getHostname = (u) => {
      try { return new URL(u).hostname.replace(/^www\./i, "").toLowerCase(); } catch { return ""; }
    };
    const seedHost = getHostname(seedUrl);
    const venueHost = getHostname(rawVenueWebUrl);
    const websiteUrl = (isPerennial && seedHost && venueHost && seedHost !== venueHost && !isWhitelistedTicketingUrl(seedUrl))
      ? ((sched.links?.tier5_venue_home && isLiveEligibleLink(sched.links.tier5_venue_home)) ? sched.links.tier5_venue_home : (existing.links?.tier5_venue_home || `https://${new URL(seedUrl).hostname}/`))
      : rawVenueWebUrl;

    // Rule 8 Link Deduplication: tier4_civic_destination and tier5_venue_home must NEVER be identical URLs
    const candidateTier4Url = isPerennial ? (detailsUrl || null) : null;
    const tier4Url = (candidateTier4Url && normalizeUrlForCompare(candidateTier4Url) !== normalizeUrlForCompare(websiteUrl))
      ? candidateTier4Url
      : null;

    const ticketUrl = verifiedTier1Url || curatorOverrideUrl || ((!isBoxFatal && isLiveEligibleLink(box.ticket_url)) ? box.ticket_url : (isLiveEligibleLink(sched.ticket_url) ? sched.ticket_url : null));

    const tier1Final = verifiedTier1Url || (isCuratorTier1 ? curatorOverrideUrl : null);
    const tier2Final = (isPerennial && !verifiedTier1Url) ? null : (detailsUrl || null);
    const tier3Final = calendarUrl || null;
    const tier4Final = tier4Url || null;
    const tier5Final = websiteUrl || null;

    const bestAvailableLink = [tier1Final, tier2Final, tier3Final, tier4Final, tier5Final, seedUrl].find(
      (u) => u && typeof u === "string" && u.startsWith("http")
    ) || null;

    // Synchronize showing slot ticket_url fields so stale/dead showing URLs never survive on compiled cards
    if (Array.isArray(showings) && showings.length > 0) {
      showings = showings.map((s) => {
        if (!s || typeof s !== "object") return s;
        const slotUrl = s.ticket_url || null;
        if (slotUrl && !isLiveEligibleLink(slotUrl)) {
          const cleanSlot = { ...s };
          if (ticketUrl || detailsUrl || bestAvailableLink) {
            cleanSlot.ticket_url = ticketUrl || detailsUrl || bestAvailableLink;
          } else {
            delete cleanSlot.ticket_url;
          }
          return cleanSlot;
        }
        return s;
      });
    }
    const bestAvailableTier = (bestAvailableLink && bestAvailableLink === tier1Final)
      ? "Tier 1: Checkout Cart"
      : (bestAvailableLink && bestAvailableLink === tier2Final)
        ? "Tier 2: Event Page"
        : (bestAvailableLink && bestAvailableLink === tier3Final)
          ? "Tier 3: Calendar"
          : (bestAvailableLink && bestAvailableLink === tier4Final)
            ? "Tier 4: Civic Guide"
            : (bestAvailableLink && bestAvailableLink === tier5Final)
              ? "Tier 5: Venue Home"
              : "none_available";

    const resolvedRestrictions = (edit.restrictions && edit.restrictions !== "none_available" && edit.restrictions !== "Unspecified" && !/unspecified|check venue/i.test(edit.restrictions))
      ? edit.restrictions
      : (box.age_restriction && box.age_restriction !== "none_available" && box.age_restriction !== "Unspecified" && !/unspecified|check venue/i.test(box.age_restriction))
        ? box.age_restriction
        : (sched.restrictions && sched.restrictions !== "none_available" && sched.restrictions !== "Unspecified" && !/unspecified|check venue/i.test(sched.restrictions))
          ? sched.restrictions
          : (venue.restrictions && venue.restrictions !== "none_available" && venue.restrictions !== "Unspecified" && venue.restrictions !== "Check Venue Door Policy" && !/check venue/i.test(venue.restrictions))
            ? venue.restrictions
            : (categories[0] === "nightlife")
              ? "19+ w/ 2 Pieces of ID (Check Door Policy)"
              : null;

    // 7. Determine Archetype & Clustered Dimensions
    let eventNumPerm = existing.Event_Num_Perm || seed.Event_Num_Perm || permMap.get(eventId);
    if (!eventNumPerm) {
      maxPermNum++;
      eventNumPerm = `Event_Num_Perm_${String(maxPermNum).padStart(9, "0")}`;
      permMap.set(eventId, eventNumPerm);
    }
    const currentCardIdx = idx + 1;
    const eventNumCard = `Event_Num_Card_${String(currentCardIdx).padStart(9, "0")}`;

    const archetype = (isPerennial
      ? (seed.event_archetype || existing.event_archetype || classifyArchetype(cleanTitle, categories[0] || null, venue.venue_name, null, { description, lifecycle_type: resolvedLifecycle }) || edit.event_archetype || edit.archetype)
      : (edit.event_archetype || edit.archetype || seed.event_archetype || classifyArchetype(cleanTitle, categories[0] || null, venue.venue_name, null, { description, lifecycle_type: resolvedLifecycle }))
    ) || null;
    const archetypeProfile = generateArchetypeProfile(archetype, cleanTitle, venue.venue_name, categories[0] || null, venue, {
      description,
      lineup,
      artist
    });

    // Epistemic Precedence Hierarchy (Rule 2E):
    // Physical facility constants from venue master record (venue.*) rule supreme over speculative editorial heuristics (edit.*).
    const hasValidCoordinates = Boolean(
      venue.coordinates && (
        (Array.isArray(venue.coordinates) &&
          venue.coordinates.length >= 2 &&
          !isNaN(Number(venue.coordinates[0])) &&
          !isNaN(Number(venue.coordinates[1])) &&
          (Number(venue.coordinates[0]) !== 0 || Number(venue.coordinates[1]) !== 0)) ||
        (typeof venue.coordinates === "object" && (
          (!isNaN(Number(venue.coordinates.lat)) && !isNaN(Number(venue.coordinates.lng))) ||
          (!isNaN(Number(venue.coordinates.latitude)) && !isNaN(Number(venue.coordinates.longitude)))
        ))
      )
    );

    let normalizedCoordinates = null;
    if (venue.coordinates) {
      if (Array.isArray(venue.coordinates) && venue.coordinates.length >= 2) {
        normalizedCoordinates = [
          Number(Number(venue.coordinates[0]).toFixed(4)),
          Number(Number(venue.coordinates[1]).toFixed(4))
        ];
      } else if (typeof venue.coordinates === "object") {
        const cLat = venue.coordinates.lat != null ? venue.coordinates.lat : venue.coordinates.latitude;
        const cLng = venue.coordinates.lng != null ? venue.coordinates.lng : venue.coordinates.longitude;
        if (cLat != null && cLng != null && !isNaN(Number(cLat)) && !isNaN(Number(cLng))) {
          normalizedCoordinates = [
            Number(Number(cLat).toFixed(4)),
            Number(Number(cLng).toFixed(4))
          ];
        }
      }
    }

    const venueAddress = (venue.full_address || venue.address || "").trim();
    const isLocationConfirmed = Boolean(
      venueAddress.length > 5 &&
      hasValidCoordinates &&
      venueAddress !== "Check Venue Website"
    );
    const hasAddress = Boolean(
      (venueAddress.length > 5 && venueAddress !== "Check Venue Website") ||
      (seed.address && seed.address.trim().length > 5) ||
      (sched.address && sched.address.trim().length > 5) ||
      isLocationConfirmed
    );
    const isConfirmedFacility = isLocationConfirmed;
    const verifiedCivicRules = venue.civic_provider_rules ||
      (isConfirmedFacility && isPerennial && (venue.venue_type === "park_beach_outdoor" || venue.access_model === "free_public_access") ? "civic_park_by-law" : null);

    const paymentMethods = isConfirmedFacility ? (venue.payment_methods || edit.payment_methods || archetypeProfile.payment_methods || null) : null;
    const waterRefillStation = isConfirmedFacility ? (venue.water_refill_station || edit.water_refill_station || archetypeProfile.water_refill_station || null) : null;
    const stepFreeEntrance = isConfirmedFacility ? (venue.step_free_entrance || edit.step_free_entrance || archetypeProfile.step_free_entrance || null) : null;
    const elevatorLift = isConfirmedFacility ? (venue.elevator_lift || edit.elevator_lift || archetypeProfile.elevator_lift || null) : null;
    const accessibleWashrooms = isConfirmedFacility ? (venue.accessible_washrooms || edit.accessible_washrooms || archetypeProfile.accessible_washrooms || null) : null;
    const sensoryCalibrations = isConfirmedFacility ? (venue.sensory_calibrations || edit.sensory_calibrations || archetypeProfile.sensory_calibrations || null) : null;
    const hearingLoop = isConfirmedFacility ? (venue.hearing_loop || edit.hearing_loop || archetypeProfile.hearing_loop || null) : null;
    const serviceAnimals = isConfirmedFacility ? (venue.service_animals || edit.service_animals || archetypeProfile.service_animals || null) : null;
    const outsideFoodPolicy = isConfirmedFacility ? (venue.outside_food_policy || edit.outside_food_policy || archetypeProfile.outside_food_policy || null) : null;
    const coatCheck = isConfirmedFacility ? (venue.coat_check || edit.coat_check || archetypeProfile.coat_check || null) : null;
    const onSiteFnb = isConfirmedFacility ? (venue.on_site_fnb || edit.on_site_fnb || archetypeProfile.on_site_fnb || null) : null;

    const verifiedAccessModel = isConfirmedFacility ? (venue.access_model || null) : null;
    const verifiedEnvironmentType = isConfirmedFacility ? (venue.environment_type || null) : null;

    const hasAuditedOperationalStatus = isSoldOut || (box.audited_at && (finalAllInPrice != null || box.tier1_name || isFree)) || (isPerennial && venue.weekly_hours);
    const operationalStatusValue = hasAuditedOperationalStatus ? (isSoldOut ? "sold_out" : "available") : null;

    const verifiedBookingProtocol = (isPerennial && (venue.weekly_hours || venue.access_model === "free_public_access"))
      ? "drop_in"
      : (box.audited_at && isValidDeepLink(ticketUrl))
        ? "online_reservation"
        : null;

    const hasValidMultiLayer = Boolean(sched.audited_at || box.audited_at || edit.audited_at);

    // Venue Alcohol & Beverage Discipline (Strict Municipal / Outdoor Invariant):
    // Outdoor public parks, beaches, trails, and civic libraries never carry alcohol benchmarks.
    const isAlcoholFreeArchetype = venue.venue_type === "park_beach_outdoor" || venue.venue_type === "civic_library_community_centre" || archetype === "civic_park" || venue.environment_type === "outdoor";
    const resolvedBeerBenchmark = (!isConfirmedFacility || isAlcoholFreeArchetype) ? null : (venue.beer_benchmark || null);
    const resolvedCocktailBenchmark = (!isConfirmedFacility || isAlcoholFreeArchetype) ? null : (venue.cocktail_benchmark || null);
    const resolvedCoffeeBenchmark = !isConfirmedFacility ? null : (venue.coffee_benchmark || (venue.spend_benchmarks && venue.spend_benchmarks.coffee) || null);
    const resolvedMealBenchmark = !isConfirmedFacility ? null : (venue.meal_benchmark || (venue.spend_benchmarks && venue.spend_benchmarks.meal) || null);
    const resolvedSpendBenchmarks = {
      beer: resolvedBeerBenchmark,
      cocktail: resolvedCocktailBenchmark,
      coffee: resolvedCoffeeBenchmark,
      meal: resolvedMealBenchmark
    };

    // Provenance & Dimension Audit Object (Unified 0XX–8XX Clustered Matrix)
    const dimensionAudit = {
      // Cluster 0XX: Core Event Identity & Lifecycle
      D001_event_name: { status: cleanTitle ? "verified" : "search_exhausted_null", value: cleanTitle, source_tool: "ai_semantic_enricher", audited_at: edit.audited_at || nowIso },
      D002_event_num_perm: { status: "verified", value: eventNumPerm, source_tool: "compiler_ai", audited_at: nowIso },
      D003_event_num_card: { status: "verified", value: eventNumCard, source_tool: "compiler_ai", audited_at: nowIso },
      D004_category: { status: (categories && categories.length > 0 && categories[0]) ? "verified" : "search_exhausted_null", value: (categories && categories.length > 0) ? categories[0] : null, categories: categories, source_tool: "ai_semantic_enricher", audited_at: edit.audited_at || nowIso },
      D005_tags: { status: (tags && tags.length > 0) ? "verified" : "search_exhausted_null", value: (tags && tags.length > 0) ? tags : null, subTags: (subTags && subTags.length > 0) ? subTags : null, source_tool: "ai_semantic_enricher", audited_at: edit.audited_at || nowIso },
      D006_lifecycle_type: { status: resolvedLifecycle ? "verified" : "search_exhausted_null", value: resolvedLifecycle, source_tool: "compiler_ai", audited_at: nowIso },
      D007_event_archetype: { status: archetype ? "verified" : "search_exhausted_null", value: archetype || null, source_tool: "ai_semantic_enricher", audited_at: nowIso },
      D008_restrictions: { status: resolvedRestrictions ? "verified" : "search_exhausted_null", value: resolvedRestrictions, source_tool: "stagehand_box_office", audited_at: nowIso },

      // Cluster 1XX: Discovery, Access & Deep-Link Hierarchy
      D101_tier1_checkout: { status: tier1Final ? "verified" : "none_available", value: tier1Final, source_tool: "stagehand_box_office", audited_at: box.audited_at || (tier1Final ? nowIso : null) },
      D102_tier2_event_page: { status: tier2Final ? "verified" : (isPerennial ? "not_applicable" : "search_exhausted_null"), value: tier2Final, source_tool: "schedule_harvester", audited_at: sched.audited_at || (tier2Final ? nowIso : null) },
      D103_tier3_calendar: { status: tier3Final ? "verified" : "none_available", value: tier3Final, source_tool: "venue_master_registry", audited_at: nowIso },
      D104_tier4_civic_destination: { status: isPerennial ? (tier4Final ? "verified" : "not_applicable") : "not_applicable", value: tier4Final, source_tool: "venue_master_registry", audited_at: nowIso },
      D105_tier5_venue_home: { status: tier5Final ? "verified" : "none_available", value: tier5Final, source_tool: "venue_master_registry", audited_at: nowIso },
      D106_best_available_link: { status: bestAvailableLink ? "verified" : "search_exhausted_null", value: bestAvailableLink, best_tier: bestAvailableTier, source_tool: "compiler_ai", audited_at: nowIso },
      D107_operational_status: { status: hasAuditedOperationalStatus ? "verified" : "search_exhausted_null", value: operationalStatusValue, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D108_geo_jurisdiction: { status: isLocationConfirmed ? "verified" : "search_exhausted_null", value: isLocationConfirmed ? "Metro Vancouver (British Columbia)" : null, in_market: isLocationConfirmed ? true : null, source_tool: "venue_master_registry", audited_at: nowIso },
      D109_currency_standard: { status: isLocationConfirmed ? "verified" : "search_exhausted_null", value: isLocationConfirmed ? "CAD" : null, source_tool: "compiler_ai", audited_at: nowIso },
      D110_iana_timezone: { status: hasAddress ? "verified" : "search_exhausted_null", value: hasAddress ? "America/Vancouver" : null, source_tool: "compiler_ai", audited_at: nowIso },

      // Cluster 2XX: Interactive Multi-Tier Box Office & Checkout Audit
      D201_tier1_name: { status: (box.tier1_name || (tier1Read != null)) ? "verified" : "none_available", value: box.tier1_name || (tier1Read != null ? "General Admission" : null), source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D202_tier1_price_base: { status: tier1Base != null ? "verified" : "none_available", value: tier1Base, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D203_tier1_price_fee: { status: tier1Fee != null ? "verified" : "none_available", value: tier1Fee, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D204_tier1_price_tax: { status: tier1Tax != null ? "verified" : "none_available", value: tier1Tax, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D205_tier1_price_read: { status: tier1Read != null ? "verified" : "none_available", value: tier1Read, quote: box.tier1_quote || (tier1Read != null ? `$${tier1Read.toFixed(2)} CAD` : null), source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D205_tier1_price_calculated: { status: tier1Calculated != null ? "verified" : "none_available", value: tier1Calculated, formula: tier1Calculated != null ? `base($${tier1Base}) + fee($${tier1Fee}) + tax($${tier1Tax}) + other($${tier1Other})` : null, source_tool: "compiler_ai", audited_at: nowIso },
      D205_tier1_discrepancy_delta: { status: tier1Delta != null ? (tier1Delta === 0 ? "verified_reconciled" : "discrepancy_logged") : "none_available", delta: tier1Delta, note: tier1Delta > 0 ? "Platform checkout surcharge or unlisted fee detected" : (tier1Delta === 0 ? "Exact match" : null), source_tool: "compiler_ai", audited_at: nowIso },
      D205_tier1_price_all_in: { status: finalAllInPrice != null ? "verified" : "none_available", value: finalAllInPrice, source_tool: "compiler_ai", audited_at: nowIso },

      D206_tier2_name: { status: tier2Name ? "verified" : "none_available", value: tier2Name, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D207_tier2_price_base: { status: tier2Base != null ? "verified" : "none_available", value: tier2Base, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D208_tier2_price_fee: { status: tier2Fee != null ? "verified" : "none_available", value: tier2Fee, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D209_tier2_price_tax: { status: tier2Tax != null ? "verified" : "none_available", value: tier2Tax, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D210_tier2_price_read: { status: tier2Read != null ? "verified" : "none_available", value: tier2Read, quote: box.tier2_quote || null, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D210_tier2_price_calculated: { status: tier2Calculated != null ? "verified" : "none_available", value: tier2Calculated, source_tool: "compiler_ai", audited_at: nowIso },
      D210_tier2_discrepancy_delta: { status: tier2Delta != null ? (tier2Delta === 0 ? "verified_reconciled" : "discrepancy_logged") : "none_available", delta: tier2Delta, source_tool: "compiler_ai", audited_at: nowIso },
      D210_tier2_price_all_in: { status: tier2Read != null ? "verified" : "none_available", value: tier2Read, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },

      D211_tier3_name: { status: tier3Name ? "verified" : "none_available", value: tier3Name, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D212_tier3_price_base: { status: tier3Base != null ? "verified" : "none_available", value: tier3Base, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D213_tier3_price_fee: { status: tier3Fee != null ? "verified" : "none_available", value: tier3Fee, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D214_tier3_price_tax: { status: tier3Tax != null ? "verified" : "none_available", value: tier3Tax, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D215_tier3_price_read: { status: tier3Read != null ? "verified" : "none_available", value: tier3Read, quote: box.tier3_quote || null, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D215_tier3_price_calculated: { status: tier3Calculated != null ? "verified" : "none_available", value: tier3Calculated, source_tool: "compiler_ai", audited_at: nowIso },
      D215_tier3_discrepancy_delta: { status: tier3Delta != null ? (tier3Delta === 0 ? "verified_reconciled" : "discrepancy_logged") : "none_available", delta: tier3Delta, source_tool: "compiler_ai", audited_at: nowIso },
      D215_tier3_price_all_in: { status: tier3Read != null ? "verified" : "none_available", value: tier3Read, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },

      D216_tier_count_verified: { status: (box.tier1_name || tier1Read != null) ? "verified" : "none_available", count: eligibleAllTiers.length > 0 ? eligibleAllTiers.length : (tier3Name ? 3 : (tier2Name ? 2 : (tier1Read != null || box.tier1_name ? 1 : 0))), source_tool: "compiler_ai", audited_at: nowIso },
      D217_pricing_model: { status: (isFree || box.pricing_model || finalAllInPrice != null) ? "verified" : "none_available", value: isFree ? "free_access" : (box.pricing_model || (finalAllInPrice != null ? "standard" : null)), source_tool: "compiler_ai", audited_at: nowIso },
      D218_budget_qualified_under_50: { status: finalAllInPrice != null ? "verified" : "search_exhausted_null", qualified: finalAllInPrice != null ? finalAllInPrice <= 50.0 : null, total: finalAllInPrice, source_tool: "compiler_ai", audited_at: nowIso },
      D219_other_cost_label: { status: tier1Other > 0 ? "verified" : "none_available", value: box.other_cost_label || null, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D221_ticket_provider: { status: (box.ticket_provider || sched.ticket_provider) ? "verified" : "none_available", value: box.ticket_provider || sched.ticket_provider || null, source_tool: "stagehand_box_office", audited_at: box.audited_at || nowIso },
      D222_booking_protocol: { status: verifiedBookingProtocol ? "verified" : "search_exhausted_null", value: verifiedBookingProtocol, source_tool: "compiler_ai", audited_at: nowIso },

      // Cluster 3XX: Performance, Schedule & Content Reality
      D301_lineup: { status: (lineup && lineup.length > 0) ? "verified" : "search_exhausted_null", value: (lineup && lineup.length > 0) ? lineup : null, source_tool: "schedule_harvester", audited_at: sched.audited_at || nowIso },
      D302_artist: { status: artist ? "verified" : "search_exhausted_null", value: artist || null, source_tool: "schedule_harvester", audited_at: sched.audited_at || nowIso },
      D303_date: { status: isPerennial ? "not_applicable" : (heroDate ? "verified" : "search_exhausted_null"), value: heroDate, source_tool: isPerennial ? "venue_master_registry" : "schedule_harvester", audited_at: nowIso },
      D304_showings_slots: { status: showings && showings.length > 0 ? "verified" : "none_available", slot_count: showings ? showings.length : 0, showings: showings || [], source_tool: "compiler_ai", audited_at: nowIso },
      D305_doors_time: { status: heroDoorsTime ? "verified" : "none_available", value: heroDoorsTime, source_tool: "schedule_harvester", audited_at: sched.audited_at || nowIso },
      D306_start_time: { status: heroStartTime ? "verified" : "none_available", value: heroStartTime, source_tool: "schedule_harvester", audited_at: sched.audited_at || nowIso },
      D307_end_time: { status: heroEndTime ? "verified" : "none_available", value: heroEndTime, source_tool: box.end_time ? "stagehand_box_office" : (sched.end_time ? "schedule_harvester" : "none_available"), audited_at: box.audited_at || sched.audited_at || nowIso },
      D308_dateSchedule: { status: (heroDate || isPerennial) ? "verified" : "search_exhausted_null", value: (heroDate || isPerennial) ? dateSchedule : null, source_tool: "compiler_ai", audited_at: nowIso },
      D309_frequencyLabel: { status: frequencyLabel ? "verified" : "search_exhausted_null", value: frequencyLabel || null, source_tool: "compiler_ai", audited_at: nowIso },
      D310_synopsis: { status: description ? "verified" : "search_exhausted_null", value: description, source_tool: "ai_semantic_enricher", audited_at: edit.audited_at || nowIso },
      D311_festival_affiliation: { status: (sched.festival_affiliation && sched.festival_affiliation !== "None") ? "verified" : "none_available", value: (sched.festival_affiliation && sched.festival_affiliation !== "None") ? sched.festival_affiliation : null, source_tool: "schedule_harvester", audited_at: nowIso },

      // Cluster 4XX: Physical Venue Geography & Constants
      D401_venue_name: { status: venue.venue_name ? "verified" : "search_exhausted_null", value: venue.venue_name, source_tool: "venue_master_registry", audited_at: nowIso },
      D402_full_address: { status: isLocationConfirmed ? "verified" : "search_exhausted_null", value: isLocationConfirmed ? (venue.full_address || venue.address) : null, source_tool: "venue_master_registry", audited_at: nowIso },
      D403_coordinates: { status: isLocationConfirmed ? "verified" : "search_exhausted_null", value: isLocationConfirmed ? (normalizedCoordinates || venue.coordinates) : null, source_tool: venueSourceTool, audited_at: venueAuditedAt },
      D404_neighborhood: { status: isLocationConfirmed ? "verified" : "search_exhausted_null", value: isLocationConfirmed ? venue.neighborhood : null, source_tool: "venue_master_registry", audited_at: nowIso },
      D405_access_model: { status: verifiedAccessModel ? "verified" : "search_exhausted_null", value: verifiedAccessModel, source_tool: "venue_master_registry", audited_at: nowIso },
      D406_environment_type: { status: verifiedEnvironmentType ? "verified" : "search_exhausted_null", value: verifiedEnvironmentType, source_tool: "venue_master_registry", audited_at: nowIso },
      D407_weekly_hours: { status: (isConfirmedFacility && venue.weekly_hours) ? "verified" : "search_exhausted_null", value: (isConfirmedFacility && venue.weekly_hours) ? venue.weekly_hours : null, source_tool: "venue_master_registry", audited_at: nowIso },
      D408_transit_waypoints: { status: (isLocationConfirmed && (venue.transit_info || (edit.waypoints && edit.waypoints.length > 0) || (venue.waypoints && venue.waypoints.length > 0))) ? "verified" : "search_exhausted_null", transit: isLocationConfirmed ? venue.transit_info : null, waypoints: isLocationConfirmed ? (edit.waypoints || venue.waypoints || []) : [], source_tool: "venue_master_registry", audited_at: nowIso },

      // Cluster 5XX: Accessibility Standards
      D501_step_free_entrance: { status: stepFreeEntrance != null ? "verified" : "search_exhausted_null", value: stepFreeEntrance || null, source_tool: "venue_master_registry", audited_at: nowIso },
      D502_elevator_lift: { status: elevatorLift != null ? "verified" : "search_exhausted_null", value: elevatorLift || null, source_tool: "venue_master_registry", audited_at: nowIso },
      D503_accessible_washrooms: { status: accessibleWashrooms != null ? "verified" : "search_exhausted_null", value: accessibleWashrooms || null, source_tool: "venue_master_registry", audited_at: nowIso },
      D504_sensory_calibrations: { status: sensoryCalibrations != null ? "verified" : "search_exhausted_null", value: sensoryCalibrations || null, source_tool: "venue_master_registry", audited_at: nowIso },
      D505_hearing_loop: { status: hearingLoop != null ? "verified" : "search_exhausted_null", value: hearingLoop || null, source_tool: "venue_master_registry", audited_at: nowIso },
      D506_service_animals: { status: serviceAnimals != null ? "verified" : "search_exhausted_null", value: serviceAnimals || null, source_tool: "venue_master_registry", audited_at: nowIso },

      // Cluster 6XX: On-Site Spend & Amenity Benchmarks
      D601_on_site_fnb: { status: onSiteFnb != null ? "verified" : "none_available", value: onSiteFnb, source_tool: "venue_master_registry", audited_at: nowIso },
      D602_coffee_benchmark: { status: resolvedCoffeeBenchmark ? "verified" : "none_available", value: resolvedCoffeeBenchmark || "none_available", source_tool: "venue_master_registry", audited_at: nowIso },
      D603_beer_benchmark: { status: resolvedBeerBenchmark ? "verified" : "none_available", value: resolvedBeerBenchmark || "none_available", source_tool: "venue_master_registry", audited_at: nowIso },
      D604_meal_benchmark: { status: resolvedMealBenchmark ? "verified" : "none_available", value: resolvedMealBenchmark || "none_available", source_tool: "venue_master_registry", audited_at: nowIso },
      D605_outside_food_policy: { status: outsideFoodPolicy != null ? "verified" : "search_exhausted_null", value: outsideFoodPolicy, source_tool: "venue_master_registry", audited_at: nowIso },
      D606_coat_check: { status: coatCheck != null ? "verified" : "search_exhausted_null", value: coatCheck, source_tool: "venue_master_registry", audited_at: nowIso },
      D607_payment_methods: { status: paymentMethods != null ? "verified" : "search_exhausted_null", value: paymentMethods || null, source_tool: "venue_master_registry", audited_at: nowIso },
      D608_water_refill_station: { status: waterRefillStation != null ? "verified" : "search_exhausted_null", value: waterRefillStation || null, source_tool: "venue_master_registry", audited_at: nowIso },

      // Cluster 7XX: Non-Universal Cultural Archetype Profiles (Conditioned on archetype)
      D711_film_runtime: archetype === "cinema" ? { status: (archetypeProfile.film_runtime_minutes != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.film_runtime_minutes != null) ? `${archetypeProfile.film_runtime_minutes} mins` : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "cinema" },
      D712_film_language_subtitles: archetype === "cinema" ? { status: (archetypeProfile.film_language_subtitles != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.film_language_subtitles != null) ? archetypeProfile.film_language_subtitles : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "cinema" },
      D713_projection_format: archetype === "cinema" ? { status: (archetypeProfile.projection_format != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.projection_format != null) ? archetypeProfile.projection_format : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "cinema" },
      D714_print_condition_notes: archetype === "cinema" ? { status: (archetypeProfile.print_condition_notes != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.print_condition_notes != null) ? archetypeProfile.print_condition_notes : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "cinema" },
      D715_concession_alcohol: archetype === "cinema" ? { status: (archetypeProfile.concession_alcohol != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.concession_alcohol != null) ? archetypeProfile.concession_alcohol : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "cinema" },
      D716_festival_pass_rules: archetype === "cinema" ? { status: (archetypeProfile.festival_pass_rules != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.festival_pass_rules != null) ? archetypeProfile.festival_pass_rules : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "cinema" },
      D717_seat_reservation_type: archetype === "cinema" ? { status: (archetypeProfile.seat_reservation_type != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.seat_reservation_type != null) ? archetypeProfile.seat_reservation_type : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "cinema" },

      D721_stage_seating_layout: archetype === "live_stage" ? { status: (archetypeProfile.stage_seating_layout != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.stage_seating_layout != null) ? archetypeProfile.stage_seating_layout : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "live_stage" },
      D722_intermission_details: archetype === "live_stage" ? { status: (archetypeProfile.intermission_details != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.intermission_details != null) ? archetypeProfile.intermission_details : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "live_stage" },
      D723_sound_curfew_time: archetype === "live_stage" ? { status: (archetypeProfile.sound_curfew_time != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.sound_curfew_time != null) ? archetypeProfile.sound_curfew_time : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "live_stage" },
      D724_earplug_availability: archetype === "live_stage" ? { status: (archetypeProfile.earplug_availability != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.earplug_availability != null) ? archetypeProfile.earplug_availability : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "live_stage" },
      D725_stage_sightlines: archetype === "live_stage" ? { status: (archetypeProfile.stage_sightlines != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.stage_sightlines != null) ? archetypeProfile.stage_sightlines : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "live_stage" },

      D731_materials_provided: archetype === "workshop" ? { status: (archetypeProfile.materials_provided != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.materials_provided != null) ? archetypeProfile.materials_provided : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "workshop" },
      D732_take_home_outcome: archetype === "workshop" ? { status: (archetypeProfile.take_home_outcome != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.take_home_outcome != null) ? archetypeProfile.take_home_outcome : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "workshop" },
      D733_workshop_capacity_cap: archetype === "workshop" ? { status: (archetypeProfile.workshop_capacity_cap != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.workshop_capacity_cap != null) ? archetypeProfile.workshop_capacity_cap : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "workshop" },
      D734_registration_cutoff: archetype === "workshop" ? { status: (archetypeProfile.registration_cutoff != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.registration_cutoff != null) ? archetypeProfile.registration_cutoff : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "workshop" },
      D735_prerequisite_skill_level: archetype === "workshop" ? { status: (archetypeProfile.prerequisite_skill_level != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.prerequisite_skill_level != null) ? archetypeProfile.prerequisite_skill_level : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "workshop" },
      D736_instructor_credentials: archetype === "workshop" ? { status: (archetypeProfile.instructor_credentials != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.instructor_credentials != null) ? archetypeProfile.instructor_credentials : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "workshop" },

      D741_table_cover_fee: archetype === "social_gaming" ? { status: (archetypeProfile.table_cover_fee != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.table_cover_fee != null) ? archetypeProfile.table_cover_fee : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "social_gaming" },
      D742_minimum_fnb_spend: archetype === "social_gaming" ? { status: (archetypeProfile.minimum_fnb_spend != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.minimum_fnb_spend != null) ? archetypeProfile.minimum_fnb_spend : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "social_gaming" },
      D743_table_time_limit: archetype === "social_gaming" ? { status: (archetypeProfile.table_time_limit != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.table_time_limit != null) ? archetypeProfile.table_time_limit : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "social_gaming" },
      D744_game_library_size: archetype === "social_gaming" ? { status: (archetypeProfile.game_library_size != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.game_library_size != null) ? archetypeProfile.game_library_size : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "social_gaming" },
      D745_rules_teacher_present: archetype === "social_gaming" ? { status: (archetypeProfile.rules_teacher_present != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.rules_teacher_present != null) ? archetypeProfile.rules_teacher_present : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "social_gaming" },
      D746_tournament_prizes: archetype === "social_gaming" ? { status: (archetypeProfile.tournament_prizes != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.tournament_prizes != null) ? archetypeProfile.tournament_prizes : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "social_gaming" },

      D751_trail_terrain_surface: archetype === "civic_park" ? { status: (archetypeProfile.trail_terrain_surface != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.trail_terrain_surface != null) ? archetypeProfile.trail_terrain_surface : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "civic_park" },
      D752_pet_leash_policy: archetype === "civic_park" ? { status: (archetypeProfile.pet_leash_policy != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.pet_leash_policy != null) ? archetypeProfile.pet_leash_policy : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "civic_park" },
      D753_seasonal_washrooms: archetype === "civic_park" ? { status: (archetypeProfile.seasonal_washrooms != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.seasonal_washrooms != null) ? archetypeProfile.seasonal_washrooms : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "civic_park" },
      D754_equipment_rentals: archetype === "civic_park" ? { status: (archetypeProfile.equipment_rentals != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.equipment_rentals != null) ? archetypeProfile.equipment_rentals : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "civic_park" },
      D755_picnic_shelter_rules: archetype === "civic_park" ? { status: (archetypeProfile.picnic_shelter_rules != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.picnic_shelter_rules != null) ? archetypeProfile.picnic_shelter_rules : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "civic_park" },

      D761_exhibition_run_dates: archetype === "museum_gallery" ? { status: (archetypeProfile.exhibition_run_dates != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.exhibition_run_dates != null) ? archetypeProfile.exhibition_run_dates : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "museum_gallery" },
      D762_special_exhibit_surcharge: archetype === "museum_gallery" ? { status: (archetypeProfile.special_exhibit_surcharge != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.special_exhibit_surcharge != null) ? archetypeProfile.special_exhibit_surcharge : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "museum_gallery" },
      D763_docent_tour_schedule: archetype === "museum_gallery" ? { status: (archetypeProfile.docent_tour_schedule != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.docent_tour_schedule != null) ? archetypeProfile.docent_tour_schedule : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "museum_gallery" },
      D764_bag_check_rules: archetype === "museum_gallery" ? { status: (archetypeProfile.bag_check_rules != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.bag_check_rules != null) ? archetypeProfile.bag_check_rules : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "museum_gallery" },

      D771_digital_waiver_required: archetype === "active_rec" ? { status: (archetypeProfile.digital_waiver_required != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.digital_waiver_required != null) ? archetypeProfile.digital_waiver_required : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "active_rec" },
      D772_required_safety_gear: archetype === "active_rec" ? { status: (archetypeProfile.required_safety_gear != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.required_safety_gear != null) ? archetypeProfile.required_safety_gear : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "active_rec" },
      D773_locker_availability: archetype === "active_rec" ? { status: (archetypeProfile.locker_availability != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.locker_availability != null) ? archetypeProfile.locker_availability : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "active_rec" },
      D774_physical_intensity_level: archetype === "active_rec" ? { status: (archetypeProfile.physical_intensity_level != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.physical_intensity_level != null) ? archetypeProfile.physical_intensity_level : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "active_rec" },
      D775_rainout_policy: archetype === "active_rec" ? { status: (archetypeProfile.rainout_policy != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.rainout_policy != null) ? archetypeProfile.rainout_policy : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "active_rec" },

      D781_location_reveal_protocol: archetype === "roving_series" ? { status: (archetypeProfile.location_reveal_protocol != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.location_reveal_protocol != null) ? archetypeProfile.location_reveal_protocol : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "roving_series" },
      D782_byo_seating_policy: archetype === "roving_series" ? { status: (archetypeProfile.byo_seating_policy != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.byo_seating_policy != null) ? archetypeProfile.byo_seating_policy : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "roving_series" },
      D783_open_mic_signup_protocol: archetype === "roving_series" ? { status: (archetypeProfile.open_mic_signup_protocol != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.open_mic_signup_protocol != null) ? archetypeProfile.open_mic_signup_protocol : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "roving_series" },
      D784_organizer_channel: archetype === "roving_series" ? { status: (archetypeProfile.organizer_channel != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.organizer_channel != null) ? archetypeProfile.organizer_channel : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "roving_series" },

      D791_festival_hub_directory: archetype === "festival" ? { status: (archetypeProfile.festival_hub_directory != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.festival_hub_directory != null) ? archetypeProfile.festival_hub_directory : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "festival" },
      D792_festival_pass_type: archetype === "festival" ? { status: (archetypeProfile.festival_pass_type != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.festival_pass_type != null) ? archetypeProfile.festival_pass_type : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "festival" },
      D793_rush_seating_rules: archetype === "festival" ? { status: (archetypeProfile.rush_seating_rules != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.rush_seating_rules != null) ? archetypeProfile.rush_seating_rules : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "festival" },
      D794_central_box_office: archetype === "festival" ? { status: (archetypeProfile.central_box_office != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.central_box_office != null) ? archetypeProfile.central_box_office : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "festival" },
      D795_volunteer_ticket_exchange: archetype === "festival" ? { status: (archetypeProfile.volunteer_ticket_exchange != null) ? "verified" : "search_exhausted_null", value: (archetypeProfile.volunteer_ticket_exchange != null) ? archetypeProfile.volunteer_ticket_exchange : null, source_tool: "ai_semantic_enricher", audited_at: nowIso } : { status: "not_applicable", value: null, archetype_required: "festival" },

      // Cluster 8XX: Governance & Pipeline Provenance
      D801_srsa_compliance: { status: "verified", compliant: true, single_publisher: "ripper/compile_catalog.js", audited_at: nowIso },
      D802_multi_layer_provenance: {
        status: hasValidMultiLayer ? "verified" : "search_exhausted_null",
        sources: hasValidMultiLayer ? {
          schedules: sched.audited_at ? "layer_schedules" : "seed",
          box_office: box.audited_at ? "stagehand_layer_box_office" : "unverified",
          editorial: edit.audited_at ? "ai_semantic_enricher" : "unverified",
          venue: "venue_master_registry",
        } : null,
        conflicts_detected: detectedConflicts.length > 0 ? detectedConflicts : undefined,
        ai_arbitration_reasoning: aiArbitration?.arbitration_reasoning || undefined,
        source_tool: aiArbitration ? "gemini_compiler_ai" : "compiler_ai",
        audited_at: nowIso,
      },
      D803_spa_hydration_provenance: { status: "verified", method: "stagehand_live_cart", audited_at: box.audited_at || nowIso },
      D804_active_showings: { status: "verified", count: showings.filter((s) => s.status !== "concluded").length, source_tool: "compiler_ai", audited_at: nowIso },
      D805_archived_showings: { status: "verified", count: showings.filter((s) => s.status === "concluded").length, source_tool: "compiler_ai", audited_at: nowIso },
      D806_curator_lock: {
        status: (curatorInfo.effectiveNote || existing.curator_notes) ? "curator_note_attached" : "verified",
        locked: Boolean(curatorInfo.curatorLock || existing.curator_lock),
        ai_curator_appeal: finalAllInPrice > 50.0 || Boolean(curatorInfo.curatorAppeal),
        curator_note: curatorInfo.effectiveNote || existing.curator_notes || null,
        source_tool: "compiler_ai",
        audited_at: nowIso
      },
      D807_proof_keyframes: { status: "verified", cart: box.proof_keyframe || null, schedule: sched.proof_keyframe || null, venue: venue.proof_keyframe || null, audited_at: nowIso },
      D808_timestamp_lockstep: { status: "verified", last_pulse_qc_at: box.audited_at || null, last_content_qc_at: sched.audited_at || null, last_full_qc_at: nowIso, last_qc_audited_at: box.audited_at || nowIso },
      D809_civic_provider_rules: { status: verifiedCivicRules ? "verified" : "search_exhausted_null", rules: verifiedCivicRules, value: verifiedCivicRules, source_tool: "venue_master_registry", audited_at: nowIso },
    };

    // 8. Compile Master Card
    const compiledCard = {
      id: eventId,
      event_id: eventId,
      Event_Num_Perm: eventNumPerm,
      Event_Num_Card: eventNumCard,
      event_archetype: archetype,
      archetype: archetype,
      title: cleanTitle,
      event_name: cleanTitle,
      artist: artist || null,
      lineup: (lineup && lineup.length > 0) ? lineup : null,
      venue: venue.venue_name,
      venue_name: venue.venue_name,
      venue_type: venue.venue_type || existing.venue_type || "standard",
      address: isLocationConfirmed ? (venue.full_address || venue.address) : null,
      full_address: isLocationConfirmed ? (venue.full_address || venue.address) : null,
      neighborhood: isLocationConfirmed ? venue.neighborhood : null,
      coordinates: isLocationConfirmed ? (normalizedCoordinates || venue.coordinates) : null,
      date: (heroDate && heroDate !== "none_available") ? heroDate : null,
      time: (heroStartTime && heroStartTime !== "none_available") ? heroStartTime : null,
      start_time: (heroStartTime && heroStartTime !== "none_available") ? heroStartTime : null,
      doors_time: (heroDoorsTime && heroDoorsTime !== "none_available") ? heroDoorsTime : null,
      end_time: (heroEndTime && heroEndTime !== "none_available") ? heroEndTime : null,
      startIso: (heroDate && heroDate !== "none_available" && /^\d{4}-\d{2}-\d{2}$/.test(heroDate))
        ? `${heroDate}T${formatIsoTime(heroStartTime && heroStartTime !== "none_available" ? heroStartTime : null, "19:00:00")}-07:00`
        : null,
      dateSchedule: (heroDate || isPerennial) ? dateSchedule : null,
      frequency: frequency,
      frequencyLabel: frequencyLabel,
      showings: showings,
      show_1: showings[0] || (heroDate && heroDate !== "none_available" ? { date: heroDate, start_time: heroStartTime } : null),
      show_2: showings[1] || null,
      show_3: showings[2] || null,
      category: (categories && categories.length > 0) ? categories[0] : null,
      categories: categories,
      categoryLabel: (categories && categories.length > 0 && categories[0]) ? categories[0].toUpperCase() : null,
      tags: (tags && tags.length > 0) ? tags : null,
      subTags: (subTags && subTags.length > 0) ? subTags : null,
      price: finalAllInPrice,
      price_base: tier1Base,
      price_fee: tier1Fee,
      price_tax: tier1Tax,
      price_read: tier1Read,
      price_calculated: tier1Calculated,
      price_delta: tier1Delta,
      price_all_in: finalAllInPrice,
      priceLabel: priceLabel,
      pricingType: isFree ? "free" : "paid",
      isFree: isFree,
      is_sold_out: isSoldOut ? true : (hasAuditedOperationalStatus ? false : null),
      isSoldOut: isSoldOut ? true : (hasAuditedOperationalStatus ? false : null),
      operational_status: operationalStatusValue,
      booking_protocol: verifiedBookingProtocol,
      ticket_url: ticketUrl,
      details_url: detailsUrl,
      links: (() => {
        const best = bestAvailableLink || "https://vancouver.ca";
        const bTier = (best === tier1Final) ? "tier1" : (best === tier2Final) ? "tier2" : (best === tier3Final) ? "tier3" : (best === tier4Final) ? "tier4" : "tier5";
        return {
          tier1_checkout: tier1Final,
          tier2_event_page: tier2Final,
          tier3_calendar: tier3Final,
          tier4_civic_destination: tier4Final,
          tier5_venue_home: tier5Final,
          best_available: best,
          best_tier: bTier,
        };
      })(),
      ticket_provider: box.ticket_provider || sched.ticket_provider || null,
      description: description,
      restrictions: resolvedRestrictions,
      transitInfo: isLocationConfirmed ? venue.transit_info : null,
      transit_info: isLocationConfirmed ? venue.transit_info : null,
      waypoints: isLocationConfirmed ? (edit.waypoints || venue.waypoints || []) : [],
      coffee_benchmark: resolvedCoffeeBenchmark,
      beer_benchmark: resolvedBeerBenchmark,
      cocktail_benchmark: resolvedCocktailBenchmark,
      meal_benchmark: resolvedMealBenchmark,
      concession_benchmark: isConfirmedFacility ? (venue.concession_benchmark || (venue.spend_benchmarks && venue.spend_benchmarks.concession) || null) : null,
      spend_benchmarks: resolvedSpendBenchmarks,
      drink_benchmark: (() => {
        const clean = (v) => (v && v !== "none_available" && v !== "not_applicable" && v !== "search_exhausted_null") ? v : null;
        const b = clean(resolvedBeerBenchmark);
        const c = clean(resolvedCocktailBenchmark);
        if (b && c) return `Beer ${b.replace(/\s*\(.*?\)/g, '')} • Cocktails ${c.replace(/\s*\(.*?\)/g, '')}`;
        return b ? `Beer ${b}` : (c ? `Cocktails ${c}` : null);
      })(),
      typical_item_spend: (() => {
        const clean = (v) => (v && typeof v === "string" && v !== "none_available" && v !== "not_applicable" && v !== "search_exhausted_null") ? v.trim() : null;
        const shortRange = (val) => val ? val.replace(/\s+CAD\b/gi, '').replace(/\s*\(.*?\)/g, '').trim() : null;
        const b = clean(resolvedBeerBenchmark);
        const c = clean(resolvedCocktailBenchmark);
        const cf = clean(resolvedCoffeeBenchmark);
        const m = clean(resolvedMealBenchmark);
        const parts = [];
        if (b) parts.push(`Beer ${shortRange(b)}`);
        if (c) parts.push(`Cocktails ${shortRange(c)}`);
        if (!b && !c && cf) parts.push(`Coffee/Drinks ${shortRange(cf)}`);
        else if (cf && parts.length < 2) parts.push(`Coffee ${shortRange(cf)}`);
        if (m && parts.length < 2) parts.push(`Food ${shortRange(m)}`);
        return parts.length > 0 ? parts.join(' • ') : null;
      })(),
      access_model: verifiedAccessModel,
      environment_type: verifiedEnvironmentType,
      weekly_hours: (isConfirmedFacility && venue.weekly_hours) ? venue.weekly_hours : null,
      venue_grounding: {
        is_grounded: isVenueDetailerGrounded,
        trust_weight: venueTrustWeight,
        source: venueSourceTool,
        last_grounded_at: venueAuditedAt
      },
      last_grounded_at: venueAuditedAt,
      access_parking: isConfirmedFacility ? (venue.access_parking || null) : null,
      access_seating: isConfirmedFacility ? (venue.access_seating || null) : null,
      payment_methods: paymentMethods,
      water_refill_station: waterRefillStation,
      step_free_entrance: stepFreeEntrance,
      elevator_lift: elevatorLift,
      accessible_washrooms: accessibleWashrooms,
      sensory_calibrations: sensoryCalibrations,
      hearing_loop: hearingLoop,
      service_animals: serviceAnimals,
      outside_food_policy: outsideFoodPolicy,
      coat_check: coatCheck,
      on_site_fnb: onSiteFnb,
      ...archetypeProfile,
      lifecycle_type: resolvedLifecycle,
      approval_status: isPerennial
        ? `Verified-${Object.keys(dimensionAudit).length}D`
        : hasAuditedBoxOffice
          ? (finalAllInPrice <= 50.0 ? `Verified-${Object.keys(dimensionAudit).length}D` : "Quarantine-Budget-Breach")
          : "Seed-Pending-Audit",
      budget_qualified_under_50: isPerennial ? true : (finalAllInPrice != null ? finalAllInPrice <= 50.0 : true),
      curator_notes: curatorInfo.effectiveNote || edit.curator_notes || box.curator_notes || existing.curator_notes || matchedVenue?.curatorNote || null,
      curator_instructions: curatorInfo.eventInstructionText || edit.curator_instructions || box.curator_instructions || existing.curator_instructions || matchedVenue?.curatorInstructions || null,
      proof_keyframes: {
        cart: (isPerennial && isFree) ? null : (box.proof_keyframe || null),
        schedule: sched.proof_keyframe || null,
        venue: venue.proof_keyframe || null,
      },
      dimension_audit: dimensionAudit,
      last_qc_audited_at: box.audited_at || nowIso,
      last_pulse_qc_at: box.audited_at || null,
      last_content_qc_at: sched.audited_at || null,
      last_full_qc_at: nowIso,
      ...(sched.candidate_tier1_url || existing.candidate_tier1_url ? {
        candidate_tier1_url: sched.candidate_tier1_url || existing.candidate_tier1_url,
        candidate_tier1_source: sched.candidate_tier1_source || existing.candidate_tier1_source,
        candidate_tier1_confidence: sched.candidate_tier1_confidence || existing.candidate_tier1_confidence,
        candidate_tier1_staged_at: sched.candidate_tier1_staged_at || existing.candidate_tier1_staged_at,
        candidate_tier1_triad_validation: sched.candidate_tier1_triad_validation || existing.candidate_tier1_triad_validation,
      } : {}),
      all_tiers: eligibleAllTiers.length > 0 ? eligibleAllTiers : undefined,
      tiers: eligibleAllTiers.length > 0
        ? eligibleAllTiers.map((t, tIdx) => {
          const tPrice = Number(t.price ?? t.price_all_in ?? t.price_read ?? 0);
          const tBase = t.price_base != null ? Number(t.price_base) : tPrice;
          const tFee = t.price_fee != null ? Number(t.price_fee) : 0;
          const tTax = t.price_tax != null ? Number(t.price_tax) : 0;
          const tRead = t.price_read != null ? Number(t.price_read) : tPrice;
          const tCalc = (tBase + tFee + tTax);
          const tDelta = Math.abs(tRead - tCalc);
          return {
            name: t.name || (tIdx === 0 ? (box.tier1_name || "General Admission") : `Tier ${tIdx + 1}`),
            price: tPrice,
            price_base: tBase,
            price_fee: tFee,
            price_tax: tTax,
            price_read: tRead,
            price_calculated: tCalc,
            price_delta: tDelta,
            label: tPrice === 0 ? "Free ($0)" : `$${tPrice.toFixed(2)} CAD`,
            isAvailable: t.is_available !== false && t.isAvailable !== false,
          };
        })
        : [
          {
            name: box.tier1_name || "General Admission",
            price: finalAllInPrice,
            price_base: tier1Base,
            price_fee: tier1Fee,
            price_tax: tier1Tax,
            price_read: tier1Read,
            price_calculated: tier1Calculated,
            price_delta: tier1Delta,
            label: priceLabel,
            isAvailable: !isSoldOut,
          },
          ...(tier2Name && (box.tier2_price_all_in != null || tier2Read != null)
            ? [
              {
                name: tier2Name,
                price: tier2Read ?? tier2Calculated,
                price_base: tier2Base ?? (tier2Read ?? tier2Calculated),
                price_fee: tier2Fee ?? 0,
                price_tax: tier2Tax ?? 0,
                price_read: tier2Read,
                price_calculated: tier2Calculated,
                price_delta: tier2Delta,
                label: `$${(tier2Read ?? tier2Calculated).toFixed(2)} CAD`,
                isAvailable: true,
              },
            ]
            : []),
          ...(tier3Name && (box.tier3_price_all_in != null || tier3Read != null)
            ? [
              {
                name: tier3Name,
                price: tier3Read ?? tier3Calculated,
                price_base: tier3Base ?? (tier3Read ?? tier3Calculated),
                price_fee: tier3Fee ?? 0,
                price_tax: tier3Tax ?? 0,
                price_read: tier3Read,
                price_calculated: tier3Calculated,
                price_delta: tier3Delta,
                label: `$${(tier3Read ?? tier3Calculated).toFixed(2)} CAD`,
                isAvailable: true,
              },
            ]
            : []),
        ],
    };

    // Candidate discovery at compilation time
    if (!compiledCard.candidate_tier1_url) {
      inspectCardForCandidateLink(compiledCard);
    }

    console.log(
      `⚡ Processing [${idx + 1}/${targetSeeds.length}]: ${compiledCard.title} (${compiledCard.venue}) [${eventId}]`
    );
    logCuratorInfo({
      eventId,
      title: compiledCard.title,
      venue: compiledCard.venue,
      existingCard: compiledCard,
      prefix: "   "
    });
    console.log(
      `   🏛️ Reconciled: "${compiledCard.title}" (${compiledCard.venue}) [${eventId}] | Total: ${compiledCard.priceLabel || "$0.00 CAD"}`
    );
    console.log(
      `   ✨ Title: "${compiledCard.title}" | Category: [${compiledCard.category}] | Artist: ${compiledCard.artist ? `"${compiledCard.artist}"` : "None (General/Recreation)"} | Age: [${compiledCard.restrictions}]`
    );
    if (compiledCard.description) {
      console.log(`   📝 Synopsis: "${compiledCard.description.replace(/[\r\n]+/g, ' ')}"`);
    }
    if (compiledCard.date || compiledCard.dateSchedule) {
      console.log(`   📅 Date: ${compiledCard.date || compiledCard.dateSchedule}`);
    }
    if (compiledCard.time || compiledCard.start_time || compiledCard.doors_time) {
      console.log(`   Showtime: ${compiledCard.time || compiledCard.start_time || compiledCard.doors_time}`);
    }
    console.log(
      `   💰 Price: ${compiledCard.priceLabel || "$0.00 CAD"} (Base: $${(compiledCard.price_base ?? 0).toFixed(2)}, Fees: $${(compiledCard.price_fee ?? 0).toFixed(2)})`
    );
    if (compiledCard.ticket_url) {
      console.log(`   🎯 URL: ${compiledCard.ticket_url}`);
    }
    console.log(`   Inventory: ${compiledCard.is_sold_out ? "SOLD OUT" : "AVAILABLE"}`);
    if (compiledCard.proof_keyframes?.cart) {
      console.log(`   Proof keyframe captured: ${compiledCard.proof_keyframes.cart}`);
    }
    console.log(`💾 Committed updated event (${eventId})`);

    // Check if card meets criteria to be published to active catalog:
    const hasActiveShowings = Array.isArray(compiledCard.showings) && compiledCard.showings.some((s) => s.status === "upcoming" || s.status === "active");
    const allShowingsConcluded = !isPerennial && Array.isArray(compiledCard.showings) && compiledCard.showings.length > 0 && compiledCard.showings.every((s) => s.status === "concluded");
    const isDatePast = !isPerennial && Boolean(compiledCard.date) && /^\d{4}-\d{2}-\d{2}$/.test(compiledCard.date) && compiledCard.date < todayIso;
    const isPastDate = !isPerennial && (allShowingsConcluded || (isDatePast && !hasActiveShowings));
    const hasValidDate = isPerennial || hasActiveShowings || (compiledCard.date && compiledCard.date !== "none_available" && compiledCard.date !== "Schedule Pending Verification" && compiledCard.dateSchedule !== "Schedule Pending Verification");
    const hasValidUrl = Boolean(compiledCard.ticket_url || compiledCard.details_url);
    const inMarket = compiledCard.dimension_audit?.D8_geo_jurisdiction?.in_market !== false;
    const isPriceVerified = isPerennial || (finalAllInPrice !== null && !isNaN(finalAllInPrice) && priceLabel !== "Pending Box Office QC");
    const hasCuratorAction = Boolean(curatorInfo.eventInstructionText || curatorInfo.eventCuratorNote || compiledCard.curator_notes || compiledCard.curator_instructions);
    const hasCuratorAppeal = Boolean(hasCuratorAction || curatorInfo.curatorAppeal || compiledCard.ai_curator_appeal || existing.ai_curator_appeal || seed.ai_curator_appeal);

    // Helper to route card directly to historical archive registry
    const archiveCard = (reason, reviewStatus, errorMsg) => {
      compiledCard.archiveReason = reason;
      compiledCard.reviewStatus = reviewStatus;
      if (errorMsg) compiledCard.audit_error = errorMsg;
      compiledCard.archivedAt = nowIso;
      delete compiledCard.quarantineReason;
      delete compiledCard._isFromQuarantine;
      archivedIds.add(eventId);
      const exArchivedIdx = archivedEventsList.findIndex((a) => (a.id || a.event_id) === eventId);
      if (exArchivedIdx >= 0) {
        archivedEventsList[exArchivedIdx] = compiledCard;
      } else {
        archivedEventsList.unshift(compiledCard);
      }
      console.log(`📦 [Compiler Outcome: ARCHIVED] "${compiledCard.title}" (${compiledCard.venue}) [${eventId}] | Reason: ${reason} | Detail: ${errorMsg || reviewStatus}`);
    };

    const isSyntheticTestFixture =
      eventId.startsWith("testvenue-") ||
      eventId.startsWith("van50-testy-canary-") ||
      /^(?:testy\b|testvenue\b)/i.test(compiledCard.title || '') ||
      /^(?:testy\b|testvenue\b)/i.test(compiledCard.venue || '');

    if (isSyntheticTestFixture) {
      console.log(`🧪 [Compiler Archive] Auto-archiving synthetic test fixture: "${compiledCard.title}" [${eventId}]`);
      archiveCard("synthetic_test_fixture", "archived_test_fixture", "Synthetic test harness fixture");
    } else if (
      /^(?:ticket[- ]?info|pricing|rates|admission[- ]?rates|box[- ]?office[- ]?info|standard[- ]?pricing|concession[- ]?menu|event|events)$/i.test((compiledCard.title || '').trim()) ||
      /\/(?:ticket-info|pricing|admission-rates|concession-menu)\b/i.test(compiledCard.details_url || compiledCard.source_url || '')
    ) {
      console.log(`🛡️ [Compiler Archive] Auto-archiving non-event pricing/policy or stub page: "${compiledCard.title}" [${eventId}]`);
      archiveCard("non_event_pricing_policy", "archived_non_event", "Detected venue pricing, admission policy, or empty placeholder stub page rather than a discrete cultural event");
    } else if (isPastDate) {
      console.log(`⏳ [Compiler Archive] Auto-archiving concluded past event: "${compiledCard.title}" [${eventId}] (${compiledCard.date || "concluded"})`);
      archiveCard("temporal_concluded_past", "archived_concluded", "All showings have concluded in the past");
    } else if (!inMarket) {
      console.log(`🗺️ [Compiler Archive] Auto-archiving out-of-market lead: "${compiledCard.title}" [${eventId}]`);
      archiveCard("out_of_market_jurisdiction", "dismissed_out_of_market", "Venue physical address falls outside Metro Vancouver geographic boundary");
    } else if (finalAllInPrice > 50.0 || box.status === "BUDGET_BREACH") {
      if (hasCuratorAppeal) {
        compiledCard.quarantineReason = "budget_breach_curator_appeal";
        compiledCard.reviewStatus = "pending_curator_review";
        quarantinedEvents.push(compiledCard);
      } else {
        console.log(`🏛️ [Compiler Archive] Auto-archiving over-budget event (> $50 CAD): "${compiledCard.title}" [${eventId}] ($${finalAllInPrice ? finalAllInPrice.toFixed(2) : "unknown"})`);
        archiveCard("budget_breach_over_50", "archived_overbudget", `Verified all-in ticket price ($${finalAllInPrice ? finalAllInPrice.toFixed(2) : "unknown"}) exceeds $50.00 CAD ceiling`);
      }
    } else if (box.status && box.status.startsWith("FATAL_")) {
      const boxFailedOrTicketUrl = box.failed_url || box.ticket_url;
      if (curatorOverrideUrl && box.status === "FATAL_DEAD_LINK" && boxFailedOrTicketUrl !== curatorOverrideUrl) {
        console.log(`🧑‍⚖️ [Compiler Arbitration] Event had FATAL_DEAD_LINK on old URL (${boxFailedOrTicketUrl}), but Curator provided replacement URL: ${curatorOverrideUrl}. Overriding dead link quarantine.`);
        compiledCard.ticket_url = curatorOverrideUrl;
        compiledCard.details_url = curatorOverrideUrl;
        delete compiledCard.quarantineReason;
        delete compiledCard.audit_error;
        const isFromQuarantine = Boolean(seed._isFromQuarantine || quarantinedMap.has(eventId));
        if (isFromQuarantine && !isPriceVerified) {
          compiledCard.quarantineReason = "unverified_box_office_pricing";
          compiledCard.reviewStatus = "pending_curator_review";
          quarantinedEvents.push(compiledCard);
        } else {
          if (isFromQuarantine) {
            console.log(`🎓 [Compiler Graduation] Event "${compiledCard.title}" [${eventId}] meets all criteria via Curator override! Graduating to active catalog!`);
            compiledCard.reviewStatus = "graduated";
            compiledCard.graduated_at = nowIso;
            delete compiledCard.quarantineReason;
            delete compiledCard._isFromQuarantine;
          }
          compiledEvents.push(compiledCard);
        }
      } else if (!hasCuratorAction && (box.status === "FATAL_MISMATCHED_ENTITY" || box.status === "FATAL_EMPTY_STUB" || box.status === "FATAL_MERCH_OR_PASS")) {
        console.log(`🗑️ [Compiler Archive] Auto-archiving fatal stub/mismatch lead: "${compiledCard.title}" [${eventId}] (${box.status})`);
        archiveCard("fatal_mismatched_stub", "archived_stub", box.error || box.status);
      } else {
        compiledCard.quarantineReason = box.status.toLowerCase();
        compiledCard.reviewStatus = hasCuratorAction ? "pending_curator_review" : "quarantined_fatal";
        compiledCard.audit_error = box.error || box.status;
        quarantinedEvents.push(compiledCard);
      }
    } else if (!hasValidDate) {
      compiledCard.quarantineReason = "missing_schedule_date";
      compiledCard.reviewStatus = hasCuratorAction ? "pending_curator_review" : "quarantined_schedule";
      quarantinedEvents.push(compiledCard);
    } else if (!inMarket) {
      compiledCard.quarantineReason = "out_of_market_jurisdiction";
      compiledCard.reviewStatus = "quarantined_geo";
      quarantinedEvents.push(compiledCard);
    } else if (!hasValidUrl) {
      compiledCard.quarantineReason = "missing_ticket_link";
      compiledCard.reviewStatus = hasCuratorAction ? "pending_curator_review" : "quarantined_link";
      quarantinedEvents.push(compiledCard);
    } else {
      const isFromQuarantine = Boolean(seed._isFromQuarantine || quarantinedMap.has(eventId));

      if (isFromQuarantine && !isPriceVerified) {
        compiledCard.quarantineReason = "unverified_box_office_pricing";
        compiledCard.reviewStatus = "pending_curator_review";
        quarantinedEvents.push(compiledCard);
      } else {
        // Pre-Publish Link Liveness & Soft-404 Check: Verify winning best_available_link before publishing to active catalog
        const shouldVerifyLiveUrl = Boolean(targetId || (targetIds && targetIds.length > 0) || uncompiledOnly || targetSeeds.length <= 30);
        const primaryPublishUrl = compiledCard.ticket_url || compiledCard.details_url || compiledCard.links?.best_available || null;
        let prePublishLinkBlocked = false;

        if (shouldVerifyLiveUrl && primaryPublishUrl) {
          try {
            const liveHealth = await scanSingleLinkHealth(primaryPublishUrl, compiledCard);
            const isDeadOrSoft404 = !liveHealth.healthy && (
              liveHealth.status === "DEGRADED_DEAD_LINK" ||
              liveHealth.status === "DEGRADED_EXPIRED" ||
              liveHealth.status === "DEGRADED_REDIRECT_TO_ROOT" ||
              liveHealth.status === "DEGRADED_SERVER_ERROR" ||
              liveHealth.status === "DEGRADED_TRUNCATED_TIER1_STUB"
            );
            if (isDeadOrSoft404) {
              const fallbackVenueUrl = calendarUrl || tier4Url || websiteUrl || null;
              let fallbackHealthy = false;
              if ((isPerennial || isFree) && fallbackVenueUrl && normalizeUrlForCompare(fallbackVenueUrl) !== normalizeUrlForCompare(primaryPublishUrl)) {
                const fbCheck = await scanSingleLinkHealth(fallbackVenueUrl, compiledCard);
                if (fbCheck.healthy || fbCheck.status === "HEALTHY_SPA_OR_WAF_SHELL") {
                  fallbackHealthy = true;
                  console.log(`   🔄 [Compiler Pre-Publish Link Heal] Primary link dead (${liveHealth.status}: ${primaryPublishUrl}) — down-stepping free/perennial card "${compiledCard.title}" to verified venue link: ${fallbackVenueUrl}`);
                  compiledCard.ticket_url = null;
                  compiledCard.details_url = fallbackVenueUrl;
                  if (compiledCard.links) {
                    compiledCard.links.tier1_checkout = null;
                    compiledCard.links.tier2_event_page = null;
                    compiledCard.links.best_available = fallbackVenueUrl;
                    compiledCard.links.best_available_tier = calendarUrl ? "Tier 3: Calendar" : (tier4Url ? "Tier 4: Civic Guide" : "Tier 5: Venue Home");
                  }
                  if (compiledCard.dimension_audit) {
                    compiledCard.dimension_audit.D101_tier1_checkout = "none_available";
                    compiledCard.dimension_audit.D102_tier2_event_page = "none_available";
                    compiledCard.dimension_audit.D106_best_available_link = fallbackVenueUrl;
                  }
                }
              }
              if (!fallbackHealthy) {
                console.log(`   🚫 [Compiler Pre-Publish Gate] Blocking dead/expired link on "${compiledCard.title}" [${eventId}]: ${primaryPublishUrl} -> ${liveHealth.status} (${liveHealth.reason})`);
                compiledCard.quarantineReason = "fatal_dead_link";
                compiledCard.reviewStatus = hasCuratorAction ? "pending_curator_review" : "quarantined_link";
                compiledCard.audit_error = `Pre-publish link check failed (${liveHealth.status}): ${liveHealth.reason}`;
                quarantinedEvents.push(compiledCard);
                prePublishLinkBlocked = true;
              }
            }
          } catch (err) {
            // Non-blocking on transient network error
          }
        }

        if (!prePublishLinkBlocked) {
          if (isFromQuarantine) {
            console.log(`🎓 [Compiler Graduation] Event "${compiledCard.title}" [${eventId}] meets all criteria! Graduating to active catalog!`);
            compiledCard.reviewStatus = "graduated";
            compiledCard.graduated_at = nowIso;
            delete compiledCard.quarantineReason;
            delete compiledCard._isFromQuarantine;
          }
          compiledEvents.push(compiledCard);
        }
      }
    }
    if (compiledEvents[compiledEvents.length - 1] === compiledCard) {
      console.log(`✅ [Compiler Outcome: PASSED] "${compiledCard.title}" (${compiledCard.venue}) [${eventId}] | Price: ${compiledCard.priceLabel || "$0.00 CAD"}`);
    } else if (quarantinedEvents[quarantinedEvents.length - 1] === compiledCard) {
      console.log(`🛡️ [Compiler Outcome: QUARANTINED] "${compiledCard.title}" (${compiledCard.venue}) [${eventId}] | Reason: ${compiledCard.quarantineReason || "verification_failed"} | Detail: ${compiledCard.audit_error || compiledCard.reviewStatus || "Quarantined for curator review"}`);
    }
  }

  // Persist compiled catalog
  const isSubset = !isAll && (targetId || (targetIds && targetIds.length > 0) || limit > 0 || offset > 0 || uncompiledOnly);
  let finalCatalog = [];

  if (isSubset) {
    // Merge compiled cards into existing catalog without deleting other cards
    finalCatalog = [...existingEvents];
    for (const card of compiledEvents) {
      const exIdx = finalCatalog.findIndex((e) => (e.id || e.event_id) === card.id);
      if (exIdx >= 0) {
        finalCatalog[exIdx] = card;
      } else {
        finalCatalog.push(card);
      }
    }
    for (const q of quarantinedEvents) {
      const qIdx = finalCatalog.findIndex((e) => (e.id || e.event_id) === q.id);
      if (qIdx >= 0) {
        finalCatalog.splice(qIdx, 1);
      }
    }
    console.log(`\n💾 Merged and updated ${compiledEvents.length} compiled card(s) in data/events.json (${finalCatalog.length} total active)`);
  } else {
    finalCatalog = compiledEvents;
    console.log(`\n💾 Saved ${finalCatalog.length} compiled active cards to data/events.json`);
  }

  // Filter out any permanently archived cards from finalCatalog
  finalCatalog = finalCatalog.filter((e) => !archivedIds.has(e.id || e.event_id));

  // Maintain Dual Numbering invariant: Event_Num_Perm (permanent) and Event_Num_Card (1..N active)
  finalCatalog.forEach((ev, idx) => {
    const cardNum = idx + 1;
    const numStr = String(cardNum).padStart(9, "0");
    if (!ev.Event_Num_Perm) {
      maxPermNum++;
      ev.Event_Num_Perm = `Event_Num_Perm_${String(maxPermNum).padStart(9, "0")}`;
    }
    ev.Event_Num_Card = `Event_Num_Card_${numStr}`;
    if (ev.dimension_audit) {
      if (ev.dimension_audit.D002_event_num_perm) ev.dimension_audit.D002_event_num_perm.value = ev.Event_Num_Perm;
      if (ev.dimension_audit.D003_event_num_card) ev.dimension_audit.D003_event_num_card.value = ev.Event_Num_Card;
    }
  });

  fs.writeFileSync(EVENTS_PATH, JSON.stringify(finalCatalog, null, 2), "utf-8");

  // Synchronize manual review queue:
  // 1. Evict graduated cards and permanently archived cards
  const compiledIds = new Set(compiledEvents.map((c) => c.id || c.event_id));
  let queue = loadJson(QUEUE_PATH, { metadata: {}, quarantinedEvents: [] });
  queue.quarantinedEvents = queue.quarantinedEvents || [];
  const prevQCount = queue.quarantinedEvents.length;
  queue.quarantinedEvents = queue.quarantinedEvents.filter((q) => {
    const qId = q.id || q.event_id;
    if (compiledIds.has(qId) || archivedIds.has(qId)) return false;
    return true;
  });
  const graduatedCount = prevQCount - queue.quarantinedEvents.length;
  if (graduatedCount > 0) {
    console.log(`🎓 [Compiler Graduation / Archive Purge] Evicted ${graduatedCount} graduated/archived card(s) from manual_review_queue.json!`);
  }

  // 2. Add or update disqualified cards (skipping permanently archived cards)
  if (quarantinedEvents.length > 0) {
    let addedCount = 0;
    for (const q of quarantinedEvents) {
      if (archivedIds.has(q.id || q.event_id)) continue;
      const exQIdx = queue.quarantinedEvents.findIndex((x) => (x.id || x.event_id) === q.id);
      if (exQIdx >= 0) {
        queue.quarantinedEvents[exQIdx] = q;
      } else {
        queue.quarantinedEvents.unshift(q);
      }
      addedCount++;
    }
    if (addedCount > 0) {
      console.log(`📥 Added/updated ${addedCount} disqualified cards in data/manual_review_queue.json`);
    }
  }
  queue.metadata.pendingCount = queue.quarantinedEvents.length;
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), "utf-8");

  // 3. Persist updated archived registry
  if (Array.isArray(archivedDoc)) {
    fs.writeFileSync(ARCHIVED_PATH, JSON.stringify(archivedEventsList, null, 2), "utf-8");
  } else if (archivedDoc && typeof archivedDoc === "object") {
    archivedDoc.archivedEvents = archivedEventsList;
    if (archivedDoc.metadata) {
      archivedDoc.metadata.archivedCount = archivedEventsList.length;
      archivedDoc.metadata.totalArchived = archivedEventsList.length;
      archivedDoc.metadata.updatedAt = nowIso;
    }
    fs.writeFileSync(ARCHIVED_PATH, JSON.stringify(archivedDoc, null, 2), "utf-8");
  }

  // 4. Prune permanently archived records from layer_schedules.json
  const currentSchedules = loadJson(SCHEDULES_PATH, []);
  if (Array.isArray(currentSchedules) && currentSchedules.length > 0) {
    const cleanedSchedules = currentSchedules.filter((s) => !archivedIds.has(s.id || s.event_id));
    if (cleanedSchedules.length !== currentSchedules.length) {
      fs.writeFileSync(SCHEDULES_PATH, JSON.stringify(cleanedSchedules, null, 2), "utf-8");
      console.log(`🧹 [Compiler Cleanup] Pruned ${currentSchedules.length - cleanedSchedules.length} archived item(s) from layer_schedules.json`);
    }
  }

  // Sync to js/data.js for instant browser preview
  const dataJsContent = `// Van50 — Vancouver Events & Outings (Strictly <= $50 CAD)
// AUTO-GENERATED by Van50 Compiler AI on ${nowIso}
// Single Reference Source Architecture • 0 Client-Side Scraping

const VANCOUVER_EVENTS = ${JSON.stringify(finalCatalog, null, 2)};

const MANUAL_REVIEW_QUEUE = ${JSON.stringify(queue.quarantinedEvents || [], null, 2)};

window.VAN50_EVENTS = VANCOUVER_EVENTS;
window.VANCOUVER_EVENTS = VANCOUVER_EVENTS;

// Regional Super-Clusters (Option B)
const NEIGHBORHOODS = [
  "Downtown, Gastown & Yaletown",
  "Mount Pleasant & South Vancouver",
  "Commercial Drive & East Vancouver",
  "Kitsilano, Point Grey & UBC",
  "Granville Island & False Creek",
  "North Shore, Burnaby & Metro"
];

// Days of the Week
const DAYS_OF_WEEK = [
  { id: "all", label: "All Days", icon: "🗓️" },
  { id: "mon", label: "Mon", full: "Monday" },
  { id: "tue", label: "Tue", full: "Tuesday" },
  { id: "wed", label: "Wed", full: "Wednesday" },
  { id: "thu", label: "Thu", full: "Thursday" },
  { id: "fri", label: "Fri", full: "Friday" },
  { id: "sat", label: "Sat", full: "Saturday" },
  { id: "sun", label: "Sun", full: "Sunday" }
];
`;
  fs.writeFileSync(DATA_JS_PATH, dataJsContent, "utf-8");
  console.log(`⚡ Synced master catalog to js/data.js with full VANCOUVER_EVENTS and MANUAL_REVIEW_QUEUE definitions.`);
  if (isAntigravityEngine()) {
    printAntigravityTimeoutSummary("Stage 4: Compiler AI Arbitrator");
  }
  console.log(`================================================================\n`);

  return {
    success: true,
    totalCompiled: compiledEvents.length,
    totalQuarantined: quarantinedEvents.length,
  };
}

// Allow CLI execution: `node ripper/compile_catalog.js`
if (process.argv[1] && process.argv[1].endsWith("compile_catalog.js")) {
  const args = process.argv.slice(2);
  let limit = 0;
  let offset = 0;
  let targetId = null;
  let targetIds = null;
  let isAll = false;
  let force = false;
  let uncompiledOnly = false;
  let incompleteOnly = false;
  let stale = null;
  let isQuarantine = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--all") {
      isAll = true;
      limit = 0;
      targetId = null;
      targetIds = null;
    } else if (args[i] === "--force") {
      force = true;
    } else if (args[i] === "--incomplete-only" || args[i] === "--incomplete") {
      incompleteOnly = true;
    } else if ((args[i] === "--stale" || args[i] === "--older-than") && args[i + 1]) {
      stale = args[++i];
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (args[i] === "--offset" && args[i + 1]) {
      offset = parseInt(args[++i], 10);
    } else if (args[i] === "--id" && args[i + 1]) {
      const rawId = args[++i];
      if (rawId.includes(",")) {
        targetIds = rawId.split(",").map((s) => s.trim()).filter(Boolean);
      } else {
        targetId = rawId;
      }
    } else if (args[i].startsWith("--id=")) {
      const rawId = args[i].split("=").slice(1).join("=");
      if (rawId.includes(",")) {
        targetIds = rawId.split(",").map((s) => s.trim()).filter(Boolean);
      } else {
        targetId = rawId;
      }
    } else if (args[i] === "--ids" && args[i + 1]) {
      targetIds = args[++i].split(",").map((s) => s.trim()).filter(Boolean);
    } else if (args[i].startsWith("--ids=")) {
      targetIds = args[i].split("=").slice(1).join("=").split(",").map((s) => s.trim()).filter(Boolean);
    } else if (args[i] === "--uncompiled-only" || args[i] === "--unverified-only") {
      uncompiledOnly = true;
    } else if (args[i] === "--quarantine" || args[i] === "--quarantined") {
      isQuarantine = true;
    }
  }

  compileCatalog({ limit, offset, id: targetId, ids: targetIds, all: isAll, force, uncompiledOnly, incompleteOnly, stale, quarantine: isQuarantine });
}
