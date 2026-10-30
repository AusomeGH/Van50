import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const VENUES_PATH = path.join(ROOT_DIR, "data", "venues.json");
const INSTRUCTIONS_PATH = path.join(ROOT_DIR, "data", "curator_instructions.json");
const RULES_PATH = path.join(ROOT_DIR, "data", "curator_learned_rules.json");

let cachedVenues = null;
let cachedInstructions = null;
let cachedLearnedRules = null;

function loadVenues() {
  if (cachedVenues) return cachedVenues;
  try {
    if (fs.existsSync(VENUES_PATH)) {
      cachedVenues = JSON.parse(fs.readFileSync(VENUES_PATH, "utf-8"));
    }
  } catch (_) {
    cachedVenues = [];
  }
  return cachedVenues || [];
}

function loadInstructions() {
  if (cachedInstructions) return cachedInstructions;
  try {
    if (fs.existsSync(INSTRUCTIONS_PATH)) {
      const data = JSON.parse(fs.readFileSync(INSTRUCTIONS_PATH, "utf-8"));
      cachedInstructions = Array.isArray(data.instructions) ? data.instructions : [];
    }
  } catch (_) {
    cachedInstructions = [];
  }
  return cachedInstructions || [];
}

function loadLearnedRules() {
  if (cachedLearnedRules) return cachedLearnedRules;
  try {
    if (fs.existsSync(RULES_PATH)) {
      cachedLearnedRules = JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));
    }
  } catch (_) {
    cachedLearnedRules = {};
  }
  return cachedLearnedRules || {};
}

/**
 * Checks if a candidate URL is a valid event/venue destination (not a Google Maps shortlink, search page, or WAF-blocked .aspx)
 */
export function isEligibleCuratorUrl(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return false;
  if (/maps\.app\.goo\.gl|goo\.gl\/maps|google\.com\/maps|google\.com\/search|bing\.com/i.test(url)) return false;
  if (/vancouver\.ca\/.*\.aspx/i.test(url)) return false;
  if (/par3nearme\.com/i.test(url)) return false;
  return true;
}

/**
 * Extracts the first valid HTTP/HTTPS URL found in a text string
 */
export function extractUrlFromText(text) {
  if (!text || typeof text !== "string") return null;
  // Ignore URLs when the curator note is complaining about a wrong link (e.g. "This link is for https://...")
  if (/\b(?:this\s+link\s+is\s+for|wrong\s+link|points\s+to\s+the\s+wrong)\b/i.test(text) && !/\b(?:use|should\s+be|try)\s+https?:\/\//i.test(text)) {
    return null;
  }
  const matches = text.match(/https?:\/\/[^\s"'<>\)]+/gi);
  if (!matches) return null;
  for (const raw of matches) {
    const url = raw.trim().replace(/[.,;:!?]+$/, "");
    if (isEligibleCuratorUrl(url)) return url;
  }
  return null;
}

/**
 * Extracts a candidate or replacement destination URL from a Curator instruction
 */
export function extractInstructedUrl(inst) {
  if (!inst || typeof inst !== "object") return null;

  // 1. Check explicitly extracted URL correction first
  if (inst.extractedCorrections?.url && isEligibleCuratorUrl(inst.extractedCorrections.url.trim())) {
    return inst.extractedCorrections.url.trim();
  }

  // 2. Check direct instruction / note text for embedded URL (e.g. "[DISAPPROVED] Bad link, use https://...")
  const textCandidates = [
    inst.instructionText,
    inst.curatorInstruction,
    inst.curatorNote,
    inst.curator_notes,
    inst.curator_instructions,
    inst.curatorAnnotation?.note,
    inst.curatorAnnotation?.curatorNote,
    inst.distilledRules?.curatorGuidance
  ];
  for (const txt of textCandidates) {
    const url = extractUrlFromText(txt);
    if (url) return url;
  }

  // 3. Only use calendarUrl in distilledRules if it is NOT merely a copy of inst.sourceUrl
  // (curator_server.py copies sourceUrl into distilledRules.calendarUrl even when no URL was typed by the curator)
  const calUrl = inst.distilledRules?.calendarUrl ? inst.distilledRules.calendarUrl.trim() : null;
  const srcUrl = inst.sourceUrl ? inst.sourceUrl.trim() : null;
  if (calUrl && calUrl !== srcUrl && isEligibleCuratorUrl(calUrl)) {
    return calUrl;
  }

  // Never fall back to inst.sourceUrl (which is the card's old/disapproved URL at the time of review)
  return null;
}

/**
 * Retrieves all relevant Curator information for a given event and venue
 */
export function getCuratorInfo({ eventId = "", title = "", venue = "", existingCard = null }) {
  const venues = loadVenues();
  const instructions = loadInstructions();
  const learnedRules = loadLearnedRules();

  const cleanTitle = (title || "").toLowerCase().trim();
  const cleanVenue = (venue || "").toLowerCase().trim();
  const cleanId = (eventId || "").toLowerCase().trim();

  const isGeneric = (str) => !str || ["unknown", "unknown venue", "vancouver venue", "venue", "event", "null"].includes(str);

  // 1. Check venues.json
  let matchedVenue = null;
  if (cleanVenue && !isGeneric(cleanVenue)) {
    matchedVenue = venues.find((v) => {
      const vName = (v.venue_name || v.name || "").toLowerCase().trim();
      return vName && (vName === cleanVenue || (cleanVenue.length >= 6 && (vName.includes(cleanVenue) || cleanVenue.includes(vName))));
    });
  }

  // 2. Check curator_instructions.json
  const matchedInstructions = instructions.filter((inst) => {
    const instId = (inst.eventId || "").toLowerCase().trim();
    const instTitle = (inst.eventTitle || "").toLowerCase().trim();
    const instVenue = (inst.venueName || "").toLowerCase().trim();

    if (cleanId && instId && cleanId === instId) return true;
    if (cleanTitle && instTitle && !isGeneric(cleanTitle) && (instTitle === cleanTitle || (cleanTitle.length >= 8 && instTitle.includes(cleanTitle)))) return true;
    // Venue-level instructions only match on venue name if the instruction does NOT specify an eventId or eventTitle
    if (!instId && !instTitle && cleanVenue && instVenue && !isGeneric(cleanVenue) && (instVenue === cleanVenue || (cleanVenue.length >= 8 && instVenue.includes(cleanVenue)))) return true;
    return false;
  });

  // Sort instructions: Exact event ID match first, then newest createdAt first
  matchedInstructions.sort((a, b) => {
    const aExact = cleanId && (a.eventId || "").toLowerCase().trim() === cleanId;
    const bExact = cleanId && (b.eventId || "").toLowerCase().trim() === cleanId;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });

  const venueInstructions = matchedVenue?.curatorInstructions || matchedVenue?.curatorNote || matchedVenue?.curatorGuidance || null;
  const venueLearnedRules = matchedVenue?.curatorLearnedRules || null;

  const eventInstruction = matchedInstructions.length > 0 ? matchedInstructions[0] : null;
  const eventInstructionText = eventInstruction?.instructionText || null;
  const eventCuratorNote = eventInstruction?.curatorNote || null;
  const eventGuidance = eventInstruction?.distilledRules?.curatorGuidance || null;
  const priceCeiling = eventInstruction?.distilledRules?.priceCeiling || null;
  const curatorStatus = eventInstruction?.status || (existingCard?.reviewStatus ? existingCard.reviewStatus : null);

  // Extract candidate destination URL from matched instructions
  let instructedUrl = null;
  for (const inst of matchedInstructions) {
    const candidate = extractInstructedUrl(inst);
    if (candidate) {
      instructedUrl = candidate;
      break;
    }
  }

  // Check learned venue calendar deep link from curator_learned_rules.json
  let learnedVenueUrl = null;
  const deepLinks = learnedRules.venue_calendar_deep_links || {};
  if (venue && deepLinks[venue]) {
    learnedVenueUrl = deepLinks[venue];
  } else if (matchedVenue?.venue_name && deepLinks[matchedVenue.venue_name]) {
    learnedVenueUrl = deepLinks[matchedVenue.venue_name];
  } else {
    const foundKey = Object.keys(deepLinks).find((k) => k.toLowerCase().trim() === cleanVenue || (cleanVenue.length >= 6 && k.toLowerCase().includes(cleanVenue)));
    if (foundKey) {
      learnedVenueUrl = deepLinks[foundKey];
    }
  }

  const venueCalendarUrl = (matchedVenue?.calendar_url || matchedVenue?.website_url || null);
  const effectiveUrl = instructedUrl || learnedVenueUrl || venueCalendarUrl || null;

  const curatorLock = Boolean(existingCard?.curator_lock || existingCard?.dimension_audit?.D806_curator_lock?.locked);
  const curatorAppeal = Boolean(existingCard?.ai_curator_appeal || existingCard?.dimension_audit?.D806_curator_lock?.ai_curator_appeal);

  const existingNotes = existingCard?.curator_notes || existingCard?.curator_instructions || existingCard?.curatorAnnotation?.note || null;
  const effectiveNote =
    eventInstructionText ||
    eventCuratorNote ||
    existingNotes ||
    venueInstructions ||
    null;

  const hasInfo = Boolean(
    venueInstructions ||
    venueLearnedRules ||
    eventInstructionText ||
    eventCuratorNote ||
    eventGuidance ||
    instructedUrl ||
    learnedVenueUrl ||
    existingNotes
  );

  return {
    hasInfo,
    curatorLock,
    curatorAppeal,
    curatorStatus,
    venueInstructions,
    venueLearnedRules,
    eventInstructionText,
    eventCuratorNote,
    eventGuidance,
    priceCeiling,
    instructedUrl,
    learnedVenueUrl,
    venueCalendarUrl,
    effectiveUrl,
    effectiveNote,
    existingCuratorNotes: existingNotes,
    matchedCount: matchedInstructions.length,
    matchedInstructions
  };
}

/**
 * Returns the highest-priority curator destination URL for an event
 */
export function getEffectiveCuratorUrl({ eventId = "", title = "", venue = "", existingCard = null }) {
  const info = getCuratorInfo({ eventId, title, venue, existingCard });
  return info.instructedUrl || info.learnedVenueUrl || null;
}

/**
 * Logs structured Curator information to stdout
 */
export function logCuratorInfo({ eventId = "", title = "", venue = "", existingCard = null, prefix = "   " }) {
  const info = getCuratorInfo({ eventId, title, venue, existingCard });

  console.log(`${prefix}🧑‍⚖️ CURATOR AUDIT INFORMATION:`);
  if (!info.hasInfo) {
    console.log(`${prefix}   • Status: Active Automated Pipeline Audit (Zero pending curator overrides)`);
    console.log(`${prefix}   • Curator Lock: ${info.curatorLock ? "LOCKED" : "UNLOCKED"} | Appeal Flag: ${info.curatorAppeal ? "FLAGGED" : "NONE"}`);
    return info;
  }

  if (info.curatorStatus) {
    console.log(`${prefix}   • Review Status: [${info.curatorStatus.toUpperCase()}] | Lock: ${info.curatorLock ? "LOCKED" : "UNLOCKED"}`);
  }
  if (info.instructedUrl) {
    console.log(`${prefix}   🎯 Curator Instructed Destination URL: ${info.instructedUrl}`);
  }
  if (info.learnedVenueUrl && info.learnedVenueUrl !== info.instructedUrl) {
    console.log(`${prefix}   🌐 Learned Venue Calendar URL: ${info.learnedVenueUrl}`);
  }
  if (info.venueInstructions) {
    console.log(`${prefix}   • Venue Curator Instruction: "${info.venueInstructions}"`);
  }
  if (info.eventInstructionText) {
    console.log(`${prefix}   • Event Curator Instruction: "${info.eventInstructionText}"`);
  }
  if (info.eventCuratorNote) {
    console.log(`${prefix}   • Curator Review Note: "${info.eventCuratorNote}"`);
  }
  if (info.eventGuidance) {
    console.log(`${prefix}   • Distilled Guidance: "${info.eventGuidance}"`);
  }
  if (info.priceCeiling != null) {
    console.log(`${prefix}   • Curator Price Ceiling: ≤ $${Number(info.priceCeiling).toFixed(2)} CAD`);
  }
  if (info.existingCuratorNotes) {
    console.log(`${prefix}   • Card Curator Notes: "${info.existingCuratorNotes}"`);
  }
  if (info.curatorAppeal) {
    console.log(`${prefix}   ⚠️ AI CURATOR APPEAL: Flagged for empirical discrepancy review`);
  }

  return info;
}
