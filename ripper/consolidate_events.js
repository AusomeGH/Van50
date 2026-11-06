import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const LAYERS_DIR = path.join(DATA_DIR, "layers");

const EVENTS_PATH = path.join(DATA_DIR, "events.json");
const DATA_JS_PATH = path.join(ROOT_DIR, "js", "data.js");
const QUEUE_PATH = path.join(DATA_DIR, "manual_review_queue.json");
const ARCHIVED_PATH = path.join(DATA_DIR, "archived_events.json");
const LEARNED_RULES_PATH = path.join(DATA_DIR, "curator_learned_rules.json");
const LAYER_SCHEDULES_PATH = path.join(LAYERS_DIR, "layer_schedules.json");
const LAYER_BOX_OFFICE_PATH = path.join(LAYERS_DIR, "layer_box_office.json");
const LAYER_EDITORIAL_PATH = path.join(LAYERS_DIR, "layer_editorial.json");

const AGGREGATOR_DOMAINS = [
  "songkick.com",
  "do604.com",
  "bandsintown.com",
  "allevents.in",
  "evvnt.com",
  "straight.com",
  "dailyhive.com",
  "vancouverisawesome.com",
];

const TIER1_CHECKOUT_DOMAINS = [
  "showpass.com",
  "eventbrite.ca",
  "eventbrite.com",
  "ticketmaster.ca",
  "ticketmaster.com",
  "ticketweb.ca",
  "universe.com",
  "admitone.com",
  "dice.fm",
  "spektrix.com",
  "tickets.thecultch.com",
  "tickets.tightropetheatre.com",
  "tickets.vancouverfringe.com",
  "viff.org",
  "thecinematheque.ca",
  "riotheatre.ca",
  "theimprovcentre.ca",
  "foxcabaret.com",
  "rickshawtheatre.com",
  "biltmorecabaret.com",
  "hollywoodtheatre.ca",
  "chancentre.com",
  "vancouversymphony.ca",
  "earlymusic.bc.ca",
  "vtixonline.com",
  "tickit.ca",
  "zeffy.com",
  "humanitix.com",
  "simpletix.com",
  "brownpapertickets.com",
  "strangerthanparadiserecords.com",
  "riotheatretickets.ca",
  "bloomtickets.ca",
  "admitonelive.com",
  "tickets.admitone.com",
  "tickets.jflvancouver.com",
];

/**
 * Normalizes a venue name into a canonical venue family key so sub-rooms and
 * common aliases of the same physical complex match cleanly.
 */
export function canonicalizeVenueKey(rawVenue) {
  if (!rawVenue || typeof rawVenue !== "string") return "";
  let v = rawVenue
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/\([^)]*\)/g, " ") // Strip parenthetical room names e.g. "(Seymour Atrium)", "(The Cultch)"
    .replace(/^the\s+/i, "");

  // Canonicalize known multi-room complexes and common aliases
  if (/\b(?:viff\s*centre|vancity\s*theatre|viff)\b/.test(v)) return "viff-centre";
  if (/\b(?:fox\s*cabaret|fox\s*projection\s*room)\b/.test(v)) return "fox-cabaret";
  if (/\b(?:rio\s*theatre)\b/.test(v)) return "rio-theatre";
  if (/\b(?:tightrope\s*(?:impro\s*)?theatre)\b/.test(v)) return "tightrope-theatre";
  if (/\b(?:the\s*cultch|cultch|historic\s*theatre|york\s*theatre|vancity\s*culture\s*lab)\b/.test(v)) {
    return "the-cultch";
  }
  if (/\b(?:improv\s*centre)\b/.test(v)) return "improv-centre";
  if (/\b(?:little\s*mountain\s*gallery)\b/.test(v)) return "little-mountain-gallery";
  if (/\b(?:rickshaw\s*theatre)\b/.test(v)) return "rickshaw-theatre";
  if (/\b(?:hollywood\s*theatre)\b/.test(v)) return "hollywood-theatre";
  if (/\b(?:biltmore\s*cabaret)\b/.test(v)) return "biltmore-cabaret";
  if (/\b(?:commodore\s*ballroom)\b/.test(v)) return "commodore-ballroom";
  if (/\b(?:vogue\s*theatre)\b/.test(v)) return "vogue-theatre";
  if (/\b(?:orpheum\s*(?:theatre|annex)?)\b/.test(v)) {
    return v.includes("annex") ? "orpheum-annex" : "orpheum-theatre";
  }
  if (/\b(?:chan\s*centre)\b/.test(v)) return "chan-centre";
  if (/\b(?:cinematheque)\b/.test(v)) return "the-cinematheque";

  return v
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normalizes an event title into a canonical identity key by stripping venue prefixes,
 * presenter boilerplate, and trailing opener/location suffixes.
 */
export function canonicalizeTitleKey(rawTitle, rawVenue = "") {
  if (!rawTitle || typeof rawTitle !== "string") return "";
  let t = rawTitle
    .toLowerCase()
    .trim()
    .replace(/&/g, " and ")
    .replace(/['’‘`]/g, "")
    .replace(/[–—]/g, "-");

  // Strip leading venue prefix e.g. "The Rio Theatre: ..." or "VIFF Centre - ..."
  const cleanVenue = (rawVenue || "")
    .toLowerCase()
    .replace(/^the\s+/i, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
  if (cleanVenue && cleanVenue.length > 3) {
    const escapedV = cleanVenue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`^(?:the\\s+)?${escapedV}\\s*[:\\-–—]\\s*`, "i"), "");
  }

  // Strip common presenter prefixes
  t = t.replace(/^(?:live\s+nation\s+presents|mr\.?\s*enk\s+presents|timbre\s+concerts\s+presents|rickshaw\s+presents|fox\s+cabaret\s+presents|rio\s+theatre\s+presents)\s*[:\-]?\s*/i, "");

  // Strip trailing ": Live at the Rio Theatre" / "Live at Fox Cabaret" / "at The Pearl"
  t = t.replace(/\s*[:\-]?\s*\blive\s+at\s+(?:the\s+)?[a-z0-9\s]+$/i, "");
  if (cleanVenue && cleanVenue.length > 3) {
    const escapedV = cleanVenue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\s+(?:at|@)\\s+(?:the\\s+)?${escapedV}$`, "i"), "");
  }

  // Strip trailing opener/support clauses ("with Francis Baptiste", "w/ ...", "feat. ...", "ft. ...")
  // Only strip if the preceding headliner portion is at least 4 characters long
  const openerMatch = t.match(/^(.{4,}?)\s+(?:with|w\/|feat\.?|featuring|ft\.?|plus\s+special\s+guests|and\s+special\s+guests)\s+.+$/i);
  if (openerMatch && openerMatch[1]) {
    t = openerMatch[1].trim();
  }

  // Normalize whitespace and punctuation
  return t
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normalizes a ticket URL for exact checkout deduplication (ignoring query params, hashes, trailing slashes).
 * Returns null if the URL is a generic venue calendar or homepage rather than an event-specific deep link.
 */
export function normalizeSpecificTicketUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.startsWith("http")) return null;
  try {
    const u = new URL(rawUrl.trim());
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const cleanPath = u.pathname.replace(/\/+$/, "").toLowerCase();
    if (!cleanPath || cleanPath === "" || cleanPath.length < 4) return null;

    // Exclude generic calendar/listing paths that multiple distinct events might share
    if (
      /^\/(?:events|calendar|schedule|shows|whats-on|tickets|box-office|films|program|lineup|home|about|visit|d|ca--vancouver)$/i.test(
        cleanPath
      )
    ) {
      return null;
    }
    // VIFF /book/ links are per-showing checkout links, so don't use URL alone as the cross-event key
    // (they are grouped by canonicalVenue + canonicalTitle instead)
    return `${host}${cleanPath}`;
  } catch (_) {
    return null;
  }
}

/**
 * Converts a 12h or 24h time string ("7:20 PM", "19:20") into minutes since midnight for chronological sorting.
 */
function parseTimeToMinutes(rawTime) {
  if (!rawTime || typeof rawTime !== "string") return 19 * 60; // Default 7:00 PM
  const m = rawTime.trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM)?$/i);
  if (!m) return 19 * 60;
  let hh = parseInt(m[1], 10);
  const mm = parseInt(m[2] || "0", 10);
  const mer = (m[3] || "").toUpperCase();
  if (mer === "PM" && hh < 12) hh += 12;
  if (mer === "AM" && hh === 12) hh = 0;
  return hh * 60 + mm;
}

/**
 * Scores a candidate card so the consolidator elects the highest-fidelity Master Card.
 */
export function scoreMasterCandidate(card) {
  let score = 0;
  const id = String(card.id || card.event_id || "");
  const url = String(
    card.ticket_url || card.candidate_tier1_url || card.websiteUrl || card.url || ""
  ).toLowerCase();
  const title = String(card.title || card.event_name || "");

  // 1. Prefer official Tier 1 checkout links over aggregators
  if (AGGREGATOR_DOMAINS.some((d) => url.includes(d))) {
    score -= 100;
  } else if (TIER1_CHECKOUT_DOMAINS.some((d) => url.includes(d))) {
    score += 60;
  }

  // 2. Prefer permanent / curator-approved / legacy IDs (e.g. van50-*, eb-*) over date-stamped harvest slugs
  if (card.approval_status === "Curator-Approved" || card.curator_lock) {
    score += 80;
  }
  if (/^(?:van50-|eb-)/i.test(id)) {
    score += 45;
  }
  if (!/-\d{4}-\d{2}-\d{2}$/.test(id)) {
    score += 20;
  }

  // 3. Prefer cards with verified checkout proof keyframes
  if (card.proof_keyframes?.cart || card.proof_keyframe) {
    score += 30;
  }

  // 4. Prefer cards with more verified showings already populated
  const showingsCount = Array.isArray(card.showings) ? card.showings.length : 0;
  score += Math.min(25, showingsCount * 5);

  // 5. Prefer fuller titles (e.g. "Miesha & The Spanks with Francis Baptiste" over "Miesha and the Spanks")
  if (/\b(?:with|feat\.?|featuring)\b/i.test(title)) {
    score += 15;
  }

  // 6. Prefer cards with earlier date if tied (so multi-day runs anchor on the opening date)
  const dStr = String(card.date || card.show_1?.date || "9999-99-99");
  if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) {
    // Earlier dates get a slight tie-breaker bonus
    const daysFrom2026 = (new Date(dStr + "T12:00:00Z").getTime() - new Date("2026-01-01T12:00:00Z").getTime()) / 86400000;
    if (!isNaN(daysFrom2026)) {
      score -= Math.round(daysFrom2026 * 0.01 * 100) / 100;
    }
  }

  return score;
}

/**
 * Extracts all individual showing slots from an event card.
 */
function extractShowingsFromCard(card) {
  const results = [];
  const cardUrl = card.ticket_url || card.candidate_tier1_url || card.websiteUrl || card.url || null;
  const isCardUrlAggregator = cardUrl && AGGREGATOR_DOMAINS.some((d) => cardUrl.toLowerCase().includes(d));

  if (Array.isArray(card.showings) && card.showings.length > 0) {
    for (const s of card.showings) {
      if (!s || !s.date || s.date === "none_available") continue;
      results.push({
        date: String(s.date).trim(),
        start_time: s.start_time || s.time || card.start_time || card.time || "7:00 PM",
        doors_time: s.doors_time || card.doors_time || null,
        end_time: s.end_time || card.end_time || null,
        status: s.status || (card.is_sold_out ? "sold_out" : "upcoming"),
        ticket_url: s.ticket_url || (!isCardUrlAggregator ? cardUrl : null),
      });
    }
  }

  for (const key of ["show_1", "show_2", "show_3"]) {
    const s = card[key];
    if (s && typeof s === "object" && s.date && s.date !== "none_available" && s.date !== "Upcoming") {
      results.push({
        date: String(s.date).trim(),
        start_time: s.start_time || s.time || card.start_time || card.time || "7:00 PM",
        doors_time: s.doors_time || card.doors_time || null,
        end_time: s.end_time || card.end_time || null,
        status: s.status || (card.is_sold_out ? "sold_out" : "upcoming"),
        ticket_url: s.ticket_url || (!isCardUrlAggregator ? cardUrl : null),
      });
    }
  }

  const topDate = card.date || card.dimension_audit?.D303_date?.value;
  if (topDate && typeof topDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(topDate.trim())) {
    results.push({
      date: topDate.trim(),
      start_time: card.start_time || card.time || card.dimension_audit?.D306_start_time?.value || "7:00 PM",
      doors_time: card.doors_time || card.dimension_audit?.D305_doors_time?.value || null,
      end_time: card.end_time || card.dimension_audit?.D307_end_time?.value || null,
      status: card.is_sold_out ? "sold_out" : "upcoming",
      ticket_url: !isCardUrlAggregator ? cardUrl : null,
    });
  }

  return results;
}

/**
 * Formats a clean human-readable multi-date schedule string from sorted showings.
 */
function buildConsolidatedDateSchedule(showings, fallbackSchedule) {
  if (!Array.isArray(showings) || showings.length === 0) return fallbackSchedule || "Upcoming";
  if (showings.length === 1) {
    const s = showings[0];
    const t = s.start_time && s.start_time !== "none_available" ? ` • ${s.start_time}` : "";
    return `${s.date}${t}`;
  }

  const uniqueDates = [...new Set(showings.map((s) => s.date))];
  const formattedDates = uniqueDates.map((d) => {
    const dt = new Date(d.length === 10 ? `${d}T12:00:00` : d);
    if (!isNaN(dt.getTime())) {
      return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }
    return d;
  });

  if (formattedDates.length === 1) {
    return `${uniqueDates[0]} (${showings.length} Showings)`;
  }
  if (formattedDates.length === 2) {
    return `${formattedDates[0]} & ${formattedDates[1]} (${showings.length} Showings)`;
  }
  if (formattedDates.length <= 4) {
    const last = formattedDates[formattedDates.length - 1];
    const rest = formattedDates.slice(0, -1).join(", ");
    return `${rest} & ${last} (${showings.length} Showings)`;
  }
  return `${formattedDates[0]} – ${formattedDates[formattedDates.length - 1]} (${showings.length} Showings)`;
}

/**
 * Merges a cluster of duplicate event cards into a single Master Card with unified showings[].
 */
export function mergeDuplicateCluster(cluster) {
  const sorted = [...cluster].sort((a, b) => scoreMasterCandidate(b) - scoreMasterCandidate(a));
  const master = JSON.parse(JSON.stringify(sorted[0]));
  const secondaries = sorted.slice(1);
  const retiredIds = secondaries.map((c) => c.id || c.event_id).filter(Boolean);

  // 1. Collect and deduplicate all showings across the entire cluster
  const rawShowings = [];
  for (const card of sorted) {
    rawShowings.push(...extractShowingsFromCard(card));
  }

  const showingMap = new Map();
  for (const s of rawShowings) {
    const normDate = s.date;
    const normMin = parseTimeToMinutes(s.start_time);
    const sDoorsMin = s.doors_time ? parseTimeToMinutes(s.doors_time) : null;
    // Group showings on the same date within 60 minutes of each other, or where one card's start_time is the other card's doors_time
    let matchedKey = null;
    for (const [k, existing] of showingMap.entries()) {
      if (existing.date !== normDate) continue;
      const exDoorsMin = existing.doors_time ? parseTimeToMinutes(existing.doors_time) : null;
      if (
        Math.abs(existing._minutes - normMin) <= 60 ||
        (exDoorsMin !== null && Math.abs(exDoorsMin - normMin) <= 15) ||
        (sDoorsMin !== null && Math.abs(existing._minutes - sDoorsMin) <= 15)
      ) {
        matchedKey = k;
        break;
      }
    }
    if (!matchedKey) {
      const key = `${normDate}::${normMin}`;
      showingMap.set(key, {
        ...s,
        _minutes: normMin,
      });
    } else {
      const existing = showingMap.get(matchedKey);
      if ((!existing.end_time || existing.end_time === "none_available") && s.end_time && s.end_time !== "none_available") {
        existing.end_time = s.end_time;
      }
      if ((!existing.doors_time || existing.doors_time === "none_available") && s.doors_time && s.doors_time !== "none_available") {
        existing.doors_time = s.doors_time;
      }
      if (!existing.ticket_url && s.ticket_url) {
        existing.ticket_url = s.ticket_url;
      }
    }
  }

  const mergedShowings = [...showingMap.values()]
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a._minutes - b._minutes;
    })
    .map((s, idx) => {
      const clean = {
        slot: idx + 1,
        date: s.date,
        start_time: s.start_time || "7:00 PM",
        doors_time: s.doors_time && s.doors_time !== "none_available" ? s.doors_time : null,
        end_time: s.end_time && s.end_time !== "none_available" ? s.end_time : null,
        status: s.status || "upcoming",
      };
      if (s.ticket_url) clean.ticket_url = s.ticket_url;
      return clean;
    });

  if (mergedShowings.length > 0) {
    const primaryShowing = mergedShowings[0];
    master.date = primaryShowing.date;
    master.time = primaryShowing.start_time;
    master.start_time = primaryShowing.start_time;
    if (primaryShowing.doors_time) master.doors_time = primaryShowing.doors_time;
    if (primaryShowing.end_time) master.end_time = primaryShowing.end_time;

    master.showings = mergedShowings;
    master.show_1 = mergedShowings[0] || null;
    master.show_2 = mergedShowings[1] || null;
    master.show_3 = mergedShowings[2] || null;

    const newSchedule = buildConsolidatedDateSchedule(mergedShowings, master.dateSchedule);
    master.dateSchedule = newSchedule;

    if (mergedShowings.length > 1) {
      const uniqueDatesCount = new Set(mergedShowings.map((s) => s.date)).size;
      if (!master.frequencyLabel || master.frequencyLabel === "One-Time Event") {
        master.frequencyLabel =
          uniqueDatesCount > 1
            ? `Multi-Date Run (${mergedShowings.length} Showings)`
            : `Multiple Showings (${mergedShowings.length} Slots)`;
      }
    }
  }

  // 2. Backfill any missing editorial/lineup/description fields from secondary cards
  for (const sec of secondaries) {
    if ((!master.description || master.description.length < 40) && sec.description && sec.description.length > (master.description || "").length) {
      master.description = sec.description;
    }
    if ((!master.artist || master.artist === "none_available") && sec.artist && sec.artist !== "none_available") {
      master.artist = sec.artist;
    }
    if ((!Array.isArray(master.lineup) || master.lineup.length === 0) && Array.isArray(sec.lineup) && sec.lineup.length > 0) {
      master.lineup = sec.lineup;
    }
    // If master has a shorter title without the opener and secondary has "with ..." on the same night, prefer the fuller title
    const secTitle = String(sec.title || sec.event_name || "");
    const masTitle = String(master.title || master.event_name || "");
    if (secTitle.length > masTitle.length && /\b(?:with|feat\.?|featuring)\b/i.test(secTitle) && !/\b(?:with|feat\.?|featuring)\b/i.test(masTitle)) {
      master.title = secTitle;
      master.event_name = secTitle;
    }
  }

  // 3. Synchronize Canonical 0XX–8XX dimension_audit fields on the master card
  if (master.dimension_audit && typeof master.dimension_audit === "object") {
    const nowIso = new Date().toISOString();
    const da = master.dimension_audit;
    if (da.D001_title && master.title) {
      da.D001_title.value = master.title;
    }
    if (da.D303_date && master.date) {
      da.D303_date.status = "verified";
      da.D303_date.value = master.date;
      da.D303_date.audited_at = nowIso;
    }
    if (da.D304_showings_slots && mergedShowings.length > 0) {
      da.D304_showings_slots = {
        status: "verified",
        slot_count: mergedShowings.length,
        showings: mergedShowings,
        source_tool: "consolidator_stage",
        audited_at: nowIso,
      };
    }
    if (da.D306_start_time && master.start_time) {
      da.D306_start_time.status = "verified";
      da.D306_start_time.value = master.start_time;
      da.D306_start_time.audited_at = nowIso;
    }
    if (da.D308_dateSchedule && master.dateSchedule) {
      da.D308_dateSchedule.status = "verified";
      da.D308_dateSchedule.value = master.dateSchedule;
      da.D308_dateSchedule.audited_at = nowIso;
    }
    if (da.D309_frequencyLabel && master.frequencyLabel) {
      da.D309_frequencyLabel.status = "verified";
      da.D309_frequencyLabel.value = master.frequencyLabel;
      da.D309_frequencyLabel.audited_at = nowIso;
    }
    if (da.D804_active_showings && mergedShowings.length > 0) {
      da.D804_active_showings = {
        status: "verified",
        count: mergedShowings.length,
        source_tool: "consolidator_stage",
        audited_at: nowIso,
      };
    }
  }

  // Record provenance of merged IDs
  const existingMerged = Array.isArray(master.merged_from_ids) ? master.merged_from_ids : [];
  master.merged_from_ids = [...new Set([...existingMerged, ...retiredIds])];

  return {
    master,
    retiredIds,
    retiredCards: secondaries,
  };
}

/**
 * Core Catalog Deduplication & Consolidation Engine.
 * Checks an array of event cards for any multi-day or same-day duplicates and merges them into single cards.
 */
export function consolidateCatalogCards(cards, options = {}) {
  if (!Array.isArray(cards) || cards.length === 0) {
    return {
      consolidatedCards: cards || [],
      mergedGroups: [],
      retiredIds: [],
      retiredCards: [],
    };
  }

  // Union-Find to group cards that match by:
  // Rule 1: Exact same (canonicalVenue, canonicalTitle) across any dates
  // Rule 2: Exact same specific ticket checkout URL (excluding generic venue calendars/homepages)
  // Rule 3: Same (canonicalVenue, date) where one canonicalTitle starts with the other (opener variant)
  const n = cards.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) parent[rootJ] = rootI;
  };

  const meta = cards.map((c, idx) => {
    const venueRaw = c.venue_name || c.venue || "";
    const titleRaw = c.title || c.event_name || "";
    const venueKey = canonicalizeVenueKey(venueRaw);
    const titleKey = canonicalizeTitleKey(titleRaw, venueRaw);
    const urlKey = normalizeSpecificTicketUrl(c.ticket_url || c.candidate_tier1_url || c.websiteUrl || c.url);
    const dates = new Set(extractShowingsFromCard(c).map((s) => s.date));
    if (c.date && /^\d{4}-\d{2}-\d{2}$/.test(c.date)) dates.add(c.date);
    return { idx, venueKey, titleKey, urlKey, dates };
  });

  // Index by (venueKey, titleKey)
  const venueTitleMap = new Map();
  // Index by specific ticket URL
  const urlMap = new Map();

  for (let i = 0; i < n; i++) {
    const m = meta[i];
    if (m.venueKey && m.titleKey && m.titleKey.length >= 3) {
      const vtKey = `${m.venueKey}::${m.titleKey}`;
      if (venueTitleMap.has(vtKey)) {
        union(venueTitleMap.get(vtKey), i);
      } else {
        venueTitleMap.set(vtKey, i);
      }
    }
    if (m.urlKey) {
      if (urlMap.has(m.urlKey)) {
        // Only merge by URL if canonicalTitle is also similar or same venue (prevents merging two distinct shows sharing a generic box-office page)
        const otherIdx = urlMap.get(m.urlKey);
        const otherMeta = meta[otherIdx];
        if (
          otherMeta.titleKey === m.titleKey ||
          otherMeta.titleKey.includes(m.titleKey) ||
          m.titleKey.includes(otherMeta.titleKey)
        ) {
          union(otherIdx, i);
        }
      } else {
        urlMap.set(m.urlKey, i);
      }
    }
  }

  // Rule 3: Same (venueKey, overlapping date) where one titleKey is a prefix of the other (at least 6 chars)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (find(i) === find(j)) continue;
      const a = meta[i];
      const b = meta[j];
      if (!a.venueKey || a.venueKey !== b.venueKey) continue;
      if (!a.titleKey || !b.titleKey || a.titleKey.length < 6 || b.titleKey.length < 6) continue;

      let sharesDate = false;
      for (const d of a.dates) {
        if (b.dates.has(d)) {
          sharesDate = true;
          break;
        }
      }
      if (!sharesDate) continue;

      if (a.titleKey.startsWith(b.titleKey + "-") || b.titleKey.startsWith(a.titleKey + "-")) {
        union(i, j);
      }
    }
  }

  // Group by connected component
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(cards[i]);
  }

  const consolidatedCards = [];
  const mergedGroups = [];
  const retiredIds = [];
  const retiredCards = [];

  for (const cluster of groups.values()) {
    if (cluster.length === 1) {
      consolidatedCards.push(cluster[0]);
    } else {
      const { master, retiredIds: rIds, retiredCards: rCards } = mergeDuplicateCluster(cluster);
      consolidatedCards.push(master);
      retiredIds.push(...rIds);
      retiredCards.push(...rCards);
      mergedGroups.push({
        masterId: master.id || master.event_id,
        masterTitle: master.title || master.event_name,
        venue: master.venue_name || master.venue,
        retiredIds: rIds,
        totalShowings: Array.isArray(master.showings) ? master.showings.length : 1,
        dateSchedule: master.dateSchedule,
      });
    }
  }

  return {
    consolidatedCards,
    mergedGroups,
    retiredIds,
    retiredCards,
  };
}

/**
 * Persists retired duplicate IDs into archived_events.json and curator_learned_rules.json
 * so Stage 1A (Harvester) never re-creates separate cards for them.
 */
export function archiveRetiredDuplicates(retiredCards, mergedGroups) {
  if (!Array.isArray(retiredCards) || retiredCards.length === 0) return;

  const masterLookup = new Map();
  for (const g of mergedGroups || []) {
    for (const rid of g.retiredIds || []) {
      masterLookup.set(rid, g.masterId);
    }
  }

  // 1. Update data/archived_events.json
  try {
    let archDb = { metadata: {}, archivedEvents: [] };
    if (fs.existsSync(ARCHIVED_PATH)) {
      const raw = JSON.parse(fs.readFileSync(ARCHIVED_PATH, "utf8"));
      if (Array.isArray(raw)) {
        archDb = { metadata: {}, archivedEvents: raw };
      } else if (raw && typeof raw === "object") {
        archDb = raw;
        archDb.archivedEvents = Array.isArray(raw.archivedEvents) ? raw.archivedEvents : [];
      }
    }
    const existingIds = new Set(archDb.archivedEvents.map((e) => e.id || e.event_id));
    const nowIso = new Date().toISOString();

    for (const c of retiredCards) {
      const cid = c.id || c.event_id;
      if (!cid || existingIds.has(cid)) continue;
      const intoMaster = masterLookup.get(cid) || "master_card";
      archDb.archivedEvents.push({
        id: cid,
        event_id: cid,
        title: c.title || c.event_name || cid,
        venue: c.venue_name || c.venue || "",
        date: c.date || null,
        price: c.price ?? 0,
        websiteUrl: c.ticket_url || c.websiteUrl || "",
        archiveReason: "merged_duplicate_event",
        flagReason: `Merged into consolidated multi-date/master card '${intoMaster}'`,
        mergedIntoId: intoMaster,
        archivedAt: nowIso,
      });
      existingIds.add(cid);
    }
    archDb.metadata = archDb.metadata || {};
    archDb.metadata.totalArchived = archDb.archivedEvents.length;
    archDb.metadata.updatedAt = nowIso;
    fs.writeFileSync(ARCHIVED_PATH, JSON.stringify(archDb, null, 2), "utf8");
  } catch (err) {
    console.warn(`⚠️ Could not update archived_events.json: ${err.message}`);
  }

  // 2. Update data/curator_learned_rules.json (archived_event_ids)
  try {
    if (fs.existsSync(LEARNED_RULES_PATH)) {
      const rules = JSON.parse(fs.readFileSync(LEARNED_RULES_PATH, "utf8"));
      const archList = Array.isArray(rules.archived_event_ids) ? rules.archived_event_ids : [];
      const archSet = new Set(archList);
      for (const c of retiredCards) {
        const cid = c.id || c.event_id;
        if (cid) archSet.add(cid);
      }
      rules.archived_event_ids = [...archSet];
      fs.writeFileSync(LEARNED_RULES_PATH, JSON.stringify(rules, null, 2), "utf8");
    }
  } catch (err) {
    console.warn(`⚠️ Could not update curator_learned_rules.json: ${err.message}`);
  }
}

/**
 * Also consolidates duplicate entries in layer_schedules.json and cleans retired IDs
 * from layer_box_office.json, layer_editorial.json, and manual_review_queue.json.
 */
export function consolidatePipelineLayers(extraRetiredIds = [], activeConsolidatedCards = []) {
  const retiredSet = new Set(extraRetiredIds);

  // 1. Consolidate layer_schedules.json
  if (fs.existsSync(LAYER_SCHEDULES_PATH)) {
    try {
      const schedRaw = JSON.parse(fs.readFileSync(LAYER_SCHEDULES_PATH, "utf8"));
      if (Array.isArray(schedRaw) && schedRaw.length > 0) {
        const { consolidatedCards: consolidatedSched, retiredIds: schedRetired } = consolidateCatalogCards(schedRaw);
        for (const id of schedRetired) retiredSet.add(id);
        const filteredSched = consolidatedSched.filter((s) => !retiredSet.has(s.id || s.event_id));
        if (filteredSched.length !== schedRaw.length) {
          fs.writeFileSync(LAYER_SCHEDULES_PATH, JSON.stringify(filteredSched, null, 2), "utf8");
          console.log(
            `🧹 [Layer Schedules] Consolidated ${schedRaw.length} -> ${filteredSched.length} schedule records.`
          );
        }
      }
    } catch (err) {
      console.warn(`⚠️ Could not consolidate layer_schedules.json: ${err.message}`);
    }
  }

  // 2. Prune retired duplicate IDs from layer_box_office.json & layer_editorial.json
  for (const [label, layerPath] of [
    ["Layer Box Office", LAYER_BOX_OFFICE_PATH],
    ["Layer Editorial", LAYER_EDITORIAL_PATH],
  ]) {
    if (fs.existsSync(layerPath) && retiredSet.size > 0) {
      try {
        const arr = JSON.parse(fs.readFileSync(layerPath, "utf8"));
        if (Array.isArray(arr)) {
          const filtered = arr.filter((x) => !retiredSet.has(x.id || x.event_id));
          if (filtered.length !== arr.length) {
            fs.writeFileSync(layerPath, JSON.stringify(filtered, null, 2), "utf8");
            console.log(`🧹 [${label}] Removed ${arr.length - filtered.length} merged duplicate layer records.`);
          }
        }
      } catch (err) {
        console.warn(`⚠️ Could not prune ${label}: ${err.message}`);
      }
    }
  }

  // 3. Evict quarantined items in manual_review_queue.json that duplicate an active card or were retired
  if (fs.existsSync(QUEUE_PATH)) {
    try {
      const qDb = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
      const qList = Array.isArray(qDb.quarantinedEvents) ? qDb.quarantinedEvents : [];
      if (qList.length > 0) {
        const activeVTKeys = new Set();
        const activeIds = new Set();
        for (const c of activeConsolidatedCards) {
          const cid = c.id || c.event_id;
          if (cid) activeIds.add(cid);
          const vk = canonicalizeVenueKey(c.venue_name || c.venue || "");
          const tk = canonicalizeTitleKey(c.title || c.event_name || "", c.venue_name || c.venue || "");
          if (vk && tk) activeVTKeys.add(`${vk}::${tk}`);
        }

        const keptQ = [];
        let evictedFromQ = 0;
        for (const q of qList) {
          const qid = q.id || q.event_id;
          const vk = canonicalizeVenueKey(q.venue_name || q.venue || "");
          const tk = canonicalizeTitleKey(q.title || q.event_name || "", q.venue_name || q.venue || "");
          const vtKey = vk && tk ? `${vk}::${tk}` : null;
          if (retiredSet.has(qid) || activeIds.has(qid) || (vtKey && activeVTKeys.has(vtKey))) {
            evictedFromQ++;
            retiredSet.add(qid);
          } else {
            keptQ.push(q);
          }
        }

        if (evictedFromQ > 0) {
          qDb.quarantinedEvents = keptQ;
          qDb.metadata = qDb.metadata || {};
          qDb.metadata.pendingCount = keptQ.length;
          qDb.metadata.updatedAt = new Date().toISOString();
          fs.writeFileSync(QUEUE_PATH, JSON.stringify(qDb, null, 2), "utf8");
          console.log(
            `🧹 [Quarantine Queue] Evicted ${evictedFromQ} quarantined duplicate(s) already represented in active catalog.`
          );
        }
      }
    } catch (err) {
      console.warn(`⚠️ Could not deduplicate manual_review_queue.json: ${err.message}`);
    }
  }
}

/**
 * Standalone & Pipeline Stage Execution: Consolidates all duplicates across layers and data/events.json.
 */
export async function runConsolidationStage(options = {}) {
  console.log(`\n================================================================`);
  console.log(`🔗 VAN50 EVENT CONSOLIDATION & MULTI-DAY DEDUPLICATOR STAGE`);
  console.log(`================================================================`);

  if (!fs.existsSync(EVENTS_PATH)) {
    console.log(`⚠️ No events.json found at ${EVENTS_PATH}.`);
    return { mergedCount: 0, finalCount: 0 };
  }

  const rawEvents = JSON.parse(fs.readFileSync(EVENTS_PATH, "utf8"));
  const initialCount = Array.isArray(rawEvents) ? rawEvents.length : 0;
  console.log(`🎯 Target Queue: ${initialCount} events inspected for multi-day & same-night duplicates`);

  const { consolidatedCards, mergedGroups, retiredIds, retiredCards } = consolidateCatalogCards(rawEvents, options);

  if (mergedGroups.length === 0) {
    console.log(`✅ Zero duplicate event cards found across ${initialCount} active events.`);
    consolidatePipelineLayers([], consolidatedCards);
  } else {
    let idx = 0;
    for (const g of mergedGroups) {
      idx++;
      console.log(
        `📌 Processing [${idx}/${mergedGroups.length}]: Merged ${g.retiredIds.length + 1} cards for "${g.masterTitle}" @ ${g.venue} -> Master [${g.masterId}] (${g.totalShowings} showings: ${g.dateSchedule})`
      );
      console.log(
        `   🔀 Merged ${g.retiredIds.length + 1} cards → "${g.masterTitle}" (${g.venue}) [${g.masterId}]: ${g.totalShowings} showings — ${g.dateSchedule} (retired: ${g.retiredIds.join(", ")})`
      );
      console.log(`💾 Committed updated event (${g.masterId})`);
    }

    // Re-sequence Event_Num_Card (Event_Num_Card_000000001..N)
    consolidatedCards.forEach((card, i) => {
      const numStr = String(i + 1).padStart(9, "0");
      card.Event_Num_Card = `Event_Num_Card_${numStr}`;
      if (card.dimension_audit && card.dimension_audit.D003_event_num_card) {
        card.dimension_audit.D003_event_num_card.value = card.Event_Num_Card;
      }
    });

    fs.writeFileSync(EVENTS_PATH, JSON.stringify(consolidatedCards, null, 2), "utf8");
    console.log(
      `\n💾 Saved ${consolidatedCards.length} consolidated active cards to data/events.json (merged ${retiredIds.length} duplicate card(s) across ${mergedGroups.length} event run(s)).`
    );

    archiveRetiredDuplicates(retiredCards, mergedGroups);
    consolidatePipelineLayers(retiredIds, consolidatedCards);
  }

  try {
    const nowIso = new Date().toISOString();
    const qDb = fs.existsSync(QUEUE_PATH) ? JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8")) : { quarantinedEvents: [] };
    const dataJsContent = `// Van50 — Vancouver Events & Outings (Strictly <= $50 CAD)
// AUTO-GENERATED by Van50 Compiler & Consolidator AI on ${nowIso}
// Single Reference Source Architecture • 0 Client-Side Scraping

const VANCOUVER_EVENTS = ${JSON.stringify(consolidatedCards, null, 2)};

const MANUAL_REVIEW_QUEUE = ${JSON.stringify(qDb.quarantinedEvents || [], null, 2)};

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
    fs.writeFileSync(DATA_JS_PATH, dataJsContent, "utf8");
    console.log(`🚀 Synced compiled events to js/data.js`);
  } catch (err) {
    console.warn(`⚠️ Could not sync js/data.js: ${err.message}`);
  }

  return {
    mergedCount: retiredIds.length,
    mergedGroupsCount: mergedGroups.length,
    finalCount: consolidatedCards.length,
    mergedGroups,
  };
}

// CLI Entrypoint
if (process.argv[1] && process.argv[1].endsWith("consolidate_events.js")) {
  runConsolidationStage()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`💥 Consolidator failed: ${err.message}`);
      process.exit(1);
    });
}
