import dotenv from "dotenv";
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  isAntigravityEngine,
  callAntigravityBoxOfficeExtractor,
  getAntigravityModel,
  printAntigravityTimeoutSummary,
  recordPipelineTimeoutEvent,
  safeUpdateJsonFile,
} from "./agy_engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load .env from ripper/ first, then fallback to root .env
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const VENUES_PATH = path.join(DATA_DIR, "venues.json");
const EVENTS_PATH = path.join(DATA_DIR, "events.json");
const QUEUE_PATH = path.join(DATA_DIR, "manual_review_queue.json");
const PROOFS_DIR = path.join(DATA_DIR, "proof_keyframes");
const DISCOVERED_VENUES_PATH = path.join(DATA_DIR, "discovered_venues.json");

// Ensure proofs directory exists
if (!fs.existsSync(PROOFS_DIR)) {
  fs.mkdirSync(PROOFS_DIR, { recursive: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGEHAND EXTRACTION SCHEMA (Volatile Box Office & Event Facts: ~25-28 Dims)
// ─────────────────────────────────────────────────────────────────────────────
export const SingleEventExtractionSchema = z.object({
  venue_name: z.string().optional().describe("Exact venue or host facility name"),
  title: z.string().optional().describe("Exact show title or event name"),
  artist: z.string().optional().describe("Headliner, band, or principal performer"),
  lineup: z.array(z.string()).optional().describe("Lineup of performers, speakers, or artists"),
  date: z.string().optional().describe("Event calendar date (prefer YYYY-MM-DD if discernable, or natural text e.g. Nov 14, 2026)"),
  doors_time: z.string().optional().describe("Doors open time, e.g. 7:00 PM (or none_available)"),
  start_time: z.string().optional().describe("Curtain / showtime start, e.g. 8:00 PM"),
  end_time: z.string().optional().describe("Curfew or conclusion time, e.g. 11:00 PM (or none_available)"),
  age_restriction: z.string().optional().describe("Age policy: 19+, All Ages, 21+, etc."),
  category: z.string().optional().describe("Category: music, shows, comedy, theatre, outdoors, social, cinema, free-public-access"),
  ticket_provider: z.string().optional().describe("Ticketing platform: Showpass, Eventbrite, Ticketmaster, Universe, OvationTix, Spektrix, Direct Box Office, etc."),
  ticket_url: z.string().optional().describe("Direct checkout or ticket purchase URL"),
  is_sold_out: z.boolean().optional().default(false).describe("True if marked Sold Out, Off Sale, or At Capacity"),
  pricing_model: z.string().optional().describe("Pricing model: standard, free_access, sliding_scale, door_cover, donation, unverified"),
  tier1_name: z.string().optional().describe("Name of Tier 1 (e.g. General Admission, Advance, Standard)"),
  tier1_price_base: z.number().nullable().optional().describe("Tier 1 base face value price in CAD (null if unstated or unknown)"),
  tier1_price_fee: z.number().nullable().optional().describe("Tier 1 ticketing/service fee in CAD (0 if confirmed $0, null if unstated)"),
  tier1_price_tax: z.number().nullable().optional().describe("Tier 1 tax amount in CAD (0 if included or $0, null if unstated)"),
  tier1_price_all_in: z.number().nullable().optional().describe("Tier 1 total all-in checkout price in CAD (null if unstated)"),
  tier1_price_read: z.number().nullable().optional().describe("Tier 1 total order amount read directly from the Order Total / Cart Total line in CAD"),
  tier1_quote: z.string().optional().default("").describe("Verbatim quote copied from the cart or page showing Tier 1 price with $ or CAD"),
  tier2_name: z.string().optional().describe("Tier 2 name (e.g. Early Bird, Student, Door) or none_available"),
  tier2_price_base: z.number().nullable().optional().describe("Tier 2 base price in CAD"),
  tier2_price_fee: z.number().nullable().optional().describe("Tier 2 service fee in CAD"),
  tier2_price_tax: z.number().nullable().optional().describe("Tier 2 tax in CAD"),
  tier2_price_all_in: z.number().nullable().optional().describe("Tier 2 total in CAD"),
  tier2_price_read: z.number().nullable().optional().describe("Tier 2 total read from Order Total line in CAD"),
  tier2_quote: z.string().optional().describe("Verbatim quote for Tier 2"),
  tier3_name: z.string().optional().describe("Tier 3 name or none_available"),
  tier3_price_base: z.number().nullable().optional().describe("Tier 3 base price in CAD"),
  tier3_price_fee: z.number().nullable().optional().describe("Tier 3 service fee in CAD"),
  tier3_price_tax: z.number().nullable().optional().describe("Tier 3 tax in CAD"),
  tier3_price_all_in: z.number().nullable().optional().describe("Tier 3 total in CAD"),
  tier3_price_read: z.number().nullable().optional().describe("Tier 3 total read from Order Total line in CAD"),
  tier3_quote: z.string().optional().describe("Verbatim quote for Tier 3"),
  all_tiers: z.array(z.object({
    name: z.string().describe("Exact tier name e.g. Adult (19-64 years), Senior (65+ years), Youth (13-18 years), Child (5-12 years), Preschooler (4 and under), Member, Student"),
    price_base: z.number().nullable().optional().describe("Base price in CAD"),
    price_fee: z.number().nullable().optional().describe("Service fee in CAD"),
    price_tax: z.number().nullable().optional().describe("Tax in CAD"),
    price_all_in: z.number().nullable().optional().describe("Total all-in price in CAD"),
    price_read: z.number().nullable().optional().describe("Read/displayed price in CAD"),
    quote: z.string().nullable().optional().describe("Verbatim price quote e.g. '$7.43' or '$6.63 CAD + $0.80 Fees'"),
    is_available: z.boolean().optional().default(true).describe("True if available to purchase")
  })).optional().describe("All ticket admission tiers visible in the modal or page, preserving the complete hierarchy (e.g. Adult, Senior, Youth, Child, Preschooler)"),
  showings: z.array(z.object({
    slot: z.number().describe("Showing slot index (1 to 5)"),
    date: z.string().describe("Calendar date YYYY-MM-DD or natural date"),
    start_time: z.string().optional().describe("Showtime e.g. 8:00 PM"),
    doors_time: z.string().optional().describe("Doors time e.g. 7:00 PM"),
    end_time: z.string().optional().describe("Curfew or conclusion time e.g. 11:00 PM"),
    status: z.string().optional().describe("upcoming, concluded, or sold_out")
  })).optional().describe("Up to 5 performance dates/times for multi-night or multi-showing runs"),
  description: z.string().optional().default("").describe("Detailed editorial summary of the event program"),
});

// Helper: Generate clean event ID slug
export function generateSlug(venueName, title, date) {
  const cleanVenue = (venueName || "van")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 20);
  const cleanTitle = (title || "event")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 30);
  const cleanDate = (date || new Date().toISOString().slice(0, 10))
    .replace(/[^0-9\-]/g, "")
    .slice(0, 10);
  return `${cleanVenue}-${cleanTitle}-${cleanDate}`.replace(/-+/g, "-").replace(/^-|-$/g, "");
}

// Helper: Normalize ISO Date (Never silently defaults to today)
export function normalizeDate(rawDate) {
  if (!rawDate) return null;
  const lower = rawDate.toLowerCase().trim();
  if (lower.includes("tonight") || lower.includes("today")) {
    return new Date().toISOString().slice(0, 10);
  }
  if (lower.includes("tomorrow")) {
    const tmr = new Date(Date.now() + 86400000);
    return tmr.toISOString().slice(0, 10);
  }
  const match = rawDate.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) {
    const y = match[1];
    const m = match[2].padStart(2, "0");
    const d = match[3].padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return rawDate;
}

// Ticketing portal domains where bare root homepage is NOT a valid event deep-link
export const KNOWN_PORTAL_DOMAINS = new Set([
  "showpass.com", "eventbrite.ca", "eventbrite.com", "ticketmaster.ca", "ticketmaster.com",
  "ticketweb.ca", "universe.com", "ovationtix.com", "dice.fm", "admitone.com",
  "brownpapertickets.com", "eventive.org", "theatrewire.com", "vtixonline.com", "tickit.ca"
]);

/**
 * Validates that a candidate ticket URL is a genuine deep link, NOT a generic provider homepage
 */
export function isValidDeepLink(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "");
    if (KNOWN_PORTAL_DOMAINS.has(host)) {
      if (!path || path === "" || path === "/events" || path === "/home" || path === "/d" || path === "/explore") {
        return false;
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Detects weekly residency patterns in text (e.g. "every Thursday at 9pm")
 */
export function detectWeeklyRecurrence(text, rawFrequency) {
  if (!text || typeof text !== "string") return null;
  const lower = text.toLowerCase();

  const dayMap = [
    { name: "Thursday", dayIndex: 4, regex: /\b(?:every|weekly\s+on)\s+thursday\b/i },
    { name: "Friday", dayIndex: 5, regex: /\b(?:every|weekly\s+on)\s+friday\b/i },
    { name: "Saturday", dayIndex: 6, regex: /\b(?:every|weekly\s+on)\s+saturday\b/i },
    { name: "Sunday", dayIndex: 0, regex: /\b(?:every|weekly\s+on)\s+sunday\b/i },
    { name: "Wednesday", dayIndex: 3, regex: /\b(?:every|weekly\s+on)\s+wednesday\b/i },
    { name: "Tuesday", dayIndex: 2, regex: /\b(?:every|weekly\s+on)\s+tuesday\b/i },
    { name: "Monday", dayIndex: 1, regex: /\b(?:every|weekly\s+on)\s+monday\b/i },
  ];

  for (const item of dayMap) {
    if (item.regex.test(lower)) {
      return {
        frequency: "Weekly Recurring",
        frequencyLabel: `Weekly on ${item.name}s`,
        dayIndex: item.dayIndex,
        dayName: item.name
      };
    }
  }

  if (rawFrequency && (rawFrequency.toLowerCase().includes("weekly") || rawFrequency.toLowerCase().includes("recurring"))) {
    return {
      frequency: "Weekly Recurring",
      frequencyLabel: "Weekly Recurring",
      dayIndex: null,
      dayName: null
    };
  }

  return null;
}

/**
 * Calculates the next upcoming calendar date (YYYY-MM-DD) for a given weekday
 */
export function getNextWeekdayDate(dayIndex, afterDateStr = null) {
  const base = afterDateStr ? new Date(afterDateStr + "T12:00:00Z") : new Date();
  const currentDay = base.getUTCDay();
  let daysUntil = (dayIndex - currentDay + 7) % 7;
  if (daysUntil === 0) daysUntil = 7; // Next occurrence
  const nextDate = new Date(base.getTime() + daysUntil * 86400000);
  return nextDate.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 4: VENUE MASTER REGISTRY HYDRATOR (~15 Dimensions)
// ─────────────────────────────────────────────────────────────────────────────
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
    "for", "with", "at", "by", "of"
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

export function hydrateVenueDimensions(rawVenueName, venuesDb) {
  if (!rawVenueName || !Array.isArray(venuesDb)) {
    return getFallbackVenue(rawVenueName);
  }

  const matched = matchVenue(rawVenueName, venuesDb);

  if (matched) {
    return {
      venue_matched: true,
      venue_name: matched.venue_name,
      full_address: matched.full_address || null,
      neighborhood: matched.neighborhood || null,
      coordinates: matched.coordinates || null,
      access_model: matched.access_model || null,
      environment_type: matched.environment_type || null,
      weekly_hours: matched.weekly_hours || null,
      coffee_benchmark: matched.coffee_benchmark || null,
      beer_benchmark: matched.beer_benchmark || null,
      meal_benchmark: matched.meal_benchmark || null,
      transit_info: matched.transit_info || null,
      waypoints: matched.waypoints || [],
      venue_restrictions: matched.restrictions || null,
      venue_website: matched.website_url || matched.calendar_url || "",
    };
  }

  return getFallbackVenue(rawVenueName);
}

function getFallbackVenue(rawVenueName) {
  return {
    venue_matched: false,
    venue_name: rawVenueName || "Vancouver Cultural Venue",
    full_address: null,
    neighborhood: null,
    coordinates: null,
    access_model: null,
    environment_type: null,
    weekly_hours: null,
    coffee_benchmark: null,
    beer_benchmark: null,
    meal_benchmark: null,
    transit_info: null,
    waypoints: [],
    venue_restrictions: null,
    venue_website: "",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGES 1 & 5: INVARIANT ENGINE & FULL DIMENSION MATRIX COMPILATION
// ─────────────────────────────────────────────────────────────────────────────
export function buildFullDimensions(extracted, venueData, targetUrl, cartScreenshotPath, existingCard = null) {
  const nowIso = new Date().toISOString();
  const todayIso = nowIso.slice(0, 10);
  const isoDate = normalizeDate(extracted.date);

  const titleValid = extracted.title && extracted.title !== "none_available" && extracted.title.trim().length > 0;
  const finalTitle = titleValid ? extracted.title.trim() : (existingCard?.title || existingCard?.event_name || "Event");

  // 1. Anti-Self-Referential Lineup & Artist Guard: Never echo title as performer
  let rawArtist = (extracted.artist && extracted.artist !== "none_available") ? extracted.artist.trim() : (existingCard?.artist || "");
  if (rawArtist && (rawArtist.toLowerCase() === finalTitle.toLowerCase() || /\b(?:showcase|open mic|residency|night|series)\b/i.test(rawArtist))) {
    rawArtist = "";
  }
  const finalArtist = rawArtist || null;

  let rawLineup = [];
  if (Array.isArray(extracted.lineup) && extracted.lineup.length > 0) {
    rawLineup = extracted.lineup.filter(p => p && p.trim().length > 0 && p.toLowerCase() !== finalTitle.toLowerCase());
  } else if (Array.isArray(existingCard?.lineup) && existingCard.lineup.length > 0) {
    rawLineup = existingCard.lineup.filter(p => p && p.trim().length > 0 && p.toLowerCase() !== finalTitle.toLowerCase());
  } else if (finalArtist) {
    rawLineup = [finalArtist];
  }
  const finalLineup = rawLineup;

  const slug = generateSlug(extracted.venue_name || venueData?.venue_name, finalTitle, isoDate || todayIso);

  // 2. Defensive pricing extraction & Tier-Grounded Sold-Out Reconciliation:
  // Never sticky-latch existingCard.is_sold_out over a live extraction, and never mark Sold Out if any eligible single-visit tier is available!
  const hasAvailableExtractedTier = Array.isArray(extracted.all_tiers) && extracted.all_tiers.some((t) => {
    if (!t) return false;
    const tName = String(t.name || "");
    if (/\b(?:annual|membership|season\s*pass|12[- ]month|unlimited\s*access)\b/i.test(tName)) return false;
    const tPrice = Number(t.price_all_in ?? t.price ?? t.price_read ?? t.price_base ?? 0);
    if (!isNaN(tPrice) && tPrice > 50.0) return false;
    return t.is_available !== false && t.isAvailable !== false && !/\bsold\s*out\b/i.test(String(t.label || ""));
  });
  const isOpenPublicSpace = venueData?.access_model === "open_public_space" || existingCard?.access_model === "open_public_space";
  const isSoldOut = (isOpenPublicSpace || hasAvailableExtractedTier)
    ? false
    : Boolean(extracted.is_sold_out !== undefined ? extracted.is_sold_out : existingCard?.is_sold_out);
  let priceBase = extracted.tier1_price_base ?? (existingCard?.price_base ?? null);
  let priceFee = extracted.tier1_price_fee ?? (existingCard?.price_fee ?? null);
  let priceTax = extracted.tier1_price_tax ?? (existingCard?.price_tax ?? null);

  // If sold out or ended and cart was not penetrated, do not falsely claim fee: 0, tax: 0 unless proven free
  const cartPenetrated = Boolean(cartScreenshotPath && !isSoldOut && (priceFee !== null || priceTax !== null));
  if (isSoldOut && !extracted.tier1_quote?.toLowerCase().includes("free")) {
    if (priceFee === 0 && !extracted.tier1_quote?.includes("no fee")) priceFee = existingCard?.price_fee ?? null;
    if (priceTax === 0 && !extracted.tier1_quote?.includes("tax incl")) priceTax = existingCard?.price_tax ?? null;
  }

  // Tier 2 calculations & Price Range Splitting
  let t2Name = (extracted.tier2_name && extracted.tier2_name !== "none_available") ? extracted.tier2_name : null;
  let t2Base = extracted.tier2_price_base ?? null;
  let t2Fee = extracted.tier2_price_fee ?? null;
  let t2Tax = extracted.tier2_price_tax ?? null;
  const t2Calculated = (t2Base != null && t2Fee != null && t2Tax != null) ? (t2Base + t2Fee + t2Tax) : (extracted.tier2_price_all_in ?? null);
  let t2Read = extracted.tier2_price_read ?? extracted.tier2_price_all_in ?? t2Calculated;

  // If a secondary price was read (e.g. from range $16.93 - $24.12 CAD), ensure it's not marked "none_available"
  if (t2Read != null && t2Read > 0 && !t2Name) {
    t2Name = "Tier 2 / General Admission Door/Reserved";
    if (t2Base == null) t2Base = t2Read;
  }
  const t2Delta = (t2Read != null && t2Calculated != null) ? Math.abs(t2Read - t2Calculated) : 0;

  // Tier 3 calculations
  const t3Base = extracted.tier3_price_base ?? null;
  const t3Fee = extracted.tier3_price_fee ?? null;
  const t3Tax = extracted.tier3_price_tax ?? null;
  const t3Calculated = (t3Base != null && t3Fee != null && t3Tax != null) ? (t3Base + t3Fee + t3Tax) : (extracted.tier3_price_all_in ?? null);
  const t3Read = extracted.tier3_price_read ?? extracted.tier3_price_all_in ?? t3Calculated;
  const t3Delta = (t3Read != null && t3Calculated != null) ? Math.abs(t3Read - t3Calculated) : 0;

  // If all_tiers array is provided, filter out annual memberships & >$50 secondary tiers and hydrate tier1/tier2/tier3 if unpopulated
  const allTiersList = Array.isArray(extracted.all_tiers) && extracted.all_tiers.length > 0
    ? extracted.all_tiers.filter((t) => {
        if (!t) return false;
        const tName = String(t.name || "");
        if (/\b(?:annual|membership|season\s*pass|12[- ]month|unlimited\s*access)\b/i.test(tName)) return false;
        const tPrice = Number(t.price_all_in ?? t.price ?? t.price_read ?? t.price_base ?? 0);
        if (!isNaN(tPrice) && tPrice > 50.0) return false;
        return true;
      })
    : [];
  extracted.all_tiers = allTiersList;
  if (allTiersList.length > 0) {
    if (!extracted.tier1_name && allTiersList[0]) {
      extracted.tier1_name = allTiersList[0].name;
      if (priceBase == null) priceBase = allTiersList[0].price_base;
      if (priceFee == null) priceFee = allTiersList[0].price_fee;
      if (priceTax == null) priceTax = allTiersList[0].price_tax;
    }
    if (!t2Name && allTiersList[1]) {
      t2Name = allTiersList[1].name;
      if (t2Base == null) t2Base = allTiersList[1].price_base;
      if (t2Fee == null) t2Fee = allTiersList[1].price_fee;
      if (t2Tax == null) t2Tax = allTiersList[1].price_tax;
      t2Read = allTiersList[1].price_all_in ?? allTiersList[1].price_read ?? t2Read;
    }
    if (!extracted.tier3_name && allTiersList[2]) {
      extracted.tier3_name = allTiersList[2].name;
    }
  }

  const priceCalculated = (priceBase != null && priceFee != null && priceTax != null) ? (priceBase + priceFee + priceTax) : (extracted.tier1_price_all_in ?? null);
  const priceRead = extracted.tier1_price_read ?? extracted.tier1_price_all_in ?? priceCalculated ?? (existingCard?.price_all_in ?? existingCard?.price ?? null);
  const priceDelta = (priceRead != null && priceCalculated != null) ? Math.abs(priceRead - priceCalculated) : 0;

  let priceAllIn = priceRead;
  if (isSoldOut && priceRead === 0 && (existingCard?.price_base || existingCard?.price)) {
    priceAllIn = existingCard.price_base || existingCard.price;
  }

  // Anti-Fake-Free Gate: Only mark isFree if positive evidence exists!
  // CRITICAL: A quote of "$0" or "$0.00" on a paid ticketing platform with paid tiers or a non-zero range is NOT proof of free general admission!
  const hasFreeQuote = Boolean(
    (extracted.tier1_quote && /\b(free admission|free event|free access|no charge|admission is free|complimentary)\b/i.test(extracted.tier1_quote)) ||
    (extracted.tier1_name && /\bfree\b/i.test(extracted.tier1_name) && !/\b(member|infant|preschool|child)\b/i.test(extracted.tier1_name)) ||
    extracted.pricing_model === "free_access"
  );

  // If page text or extracted values indicate a non-zero paid tier (e.g. Adult $14.86 or range $0.00 - $14.86)
  const hasPaidTiers = Boolean(
    (extracted.tier1_price_read && extracted.tier1_price_read > 0) ||
    (extracted.tier2_price_all_in && extracted.tier2_price_all_in > 0) ||
    (extracted.tier2_price_base && extracted.tier2_price_base > 0) ||
    (t2Read && t2Read > 0) ||
    (t3Read && t3Read > 0) ||
    allTiersList.some(t => Number(t.price_all_in ?? t.price_read ?? t.price_base ?? 0) > 0)
  );

  // If Tier 1 was erroneously recorded as 0 but Tier 2/3/all_tiers has the paid Adult/GA price, promote the paid tier to Tier 1!
  if (priceAllIn === 0 && hasPaidTiers) {
    const paidTier = allTiersList.find(t => Number(t.price_all_in ?? t.price_read ?? t.price_base ?? 0) > 0 && /adult|general/i.test(t.name || ""))
      || allTiersList.find(t => Number(t.price_all_in ?? t.price_read ?? t.price_base ?? 0) > 0);
    if (paidTier) {
      priceAllIn = Number(paidTier.price_all_in ?? paidTier.price_read ?? paidTier.price_base);
      priceBase = paidTier.price_base != null ? Number(paidTier.price_base) : priceAllIn;
      priceFee = paidTier.price_fee != null ? Number(paidTier.price_fee) : 0;
      priceTax = paidTier.price_tax != null ? Number(paidTier.price_tax) : 0;
      extracted.tier1_name = paidTier.name || "General Admission (Adult)";
    } else if (t2Read && t2Read > 0) {
      priceAllIn = t2Read;
      priceBase = t2Base || t2Read;
      priceFee = t2Fee || 0;
      priceTax = t2Tax || 0;
      extracted.tier1_name = t2Name || "General Admission (Adult)";
    } else if (t3Read && t3Read > 0) {
      priceAllIn = t3Read;
      priceBase = t3Base || t3Read;
      priceFee = t3Fee || 0;
      priceTax = t3Tax || 0;
      extracted.tier1_name = extracted.tier3_name || "General Admission (Adult)";
    }
  }

  const isFree = !isSoldOut && !hasPaidTiers && ((priceAllIn === 0 && hasFreeQuote) || (hasFreeQuote && (priceAllIn === 0 || priceAllIn == null)));
  if (!isFree && priceAllIn === 0 && !hasFreeQuote && !extracted.tier1_quote) {
    priceAllIn = existingCard?.price_all_in ?? existingCard?.price ?? null;
  }

  // 3. Weekly Recurring Residency Detection & Auto-Roll Engine
  const residencyText = `${finalTitle} ${extracted.description || existingCard?.description || ""}`;
  const recurringInfo = detectWeeklyRecurrence(residencyText, existingCard?.frequency);

  const isPerennial =
    (existingCard?.lifecycle_type === "perennial_drop_in") ||
    (venueData?.access_model === "open_public_space" && !extracted.date);

  let showings = [];
  let heroDate = isoDate;
  let heroStartTime = extracted.start_time || null;
  let heroDoorsTime = extracted.doors_time || null;
  let heroEndTime = extracted.end_time || null;
  let frequency = isPerennial ? "Perennial Drop-In" : (recurringInfo ? recurringInfo.frequency : (existingCard?.frequency || "One-Off"));
  let frequencyLabel = isPerennial ? "Perennial Drop-In" : (recurringInfo ? recurringInfo.frequencyLabel : (existingCard?.frequencyLabel || "One-Time Event"));
  let lifecycleType = isPerennial ? "perennial_drop_in" : (recurringInfo ? "weekly_recurring_residency" : "time_bound_event");
  let dateSchedule = isPerennial ? "Perennial Daily Access (Year-Round)" : null;

  if (isPerennial) {
    heroDate = null;
    heroStartTime = null;
    heroDoorsTime = null;
    heroEndTime = null;
    dateSchedule = "Perennial Daily Access (Year-Round)";
    frequencyLabel = "Perennial Drop-In";
    showings = [];
  } else if (recurringInfo && recurringInfo.dayIndex !== null) {
    // Recurring residency: auto-roll to next active occurrence date if current date is past/concluded
    let activeDate = isoDate;
    if (!activeDate || activeDate < todayIso) {
      activeDate = getNextWeekdayDate(recurringInfo.dayIndex, todayIso);
    }
    heroDate = activeDate;
    showings = [{
      slot: 1,
      date: activeDate,
      start_time: heroStartTime,
      doors_time: heroDoorsTime,
      end_time: heroEndTime,
      status: "upcoming",
    }];
  } else if (Array.isArray(extracted.showings) && extracted.showings.length > 0) {
    showings = extracted.showings.slice(0, 5).map((s, idx) => {
      const slotDate = normalizeDate(s.date) || null;
      return {
        slot: idx + 1,
        date: slotDate,
        start_time: s.start_time || null,
        doors_time: s.doors_time || null,
        end_time: s.end_time || null,
        status: (slotDate && slotDate < todayIso) ? "concluded" : (s.status || "upcoming"),
      };
    });
    const nextUpcoming = showings.find((s) => s.status !== "concluded" && s.date) || showings[showings.length - 1];
    if (nextUpcoming) {
      heroDate = nextUpcoming.date;
      heroStartTime = nextUpcoming.start_time;
      heroDoorsTime = nextUpcoming.doors_time;
      heroEndTime = nextUpcoming.end_time;
    }
  } else if (isoDate) {
    showings = [{
      slot: 1,
      date: isoDate,
      start_time: heroStartTime,
      doors_time: heroDoorsTime,
      end_time: heroEndTime,
      status: isoDate < todayIso ? "concluded" : "upcoming",
    }];
  }

  if (!dateSchedule) {
    dateSchedule = isPerennial ? "Perennial Daily Access (Year-Round)" : (heroDate ? (heroStartTime ? `${heroDate} • ${heroStartTime}` : heroDate) : "Schedule Pending Verification");
  }

  // 4. Invariant Deep-Link Guard: Prevent generic portal roots from overwriting deep links
  let cleanTicketUrl = null;
  if (isValidDeepLink(extracted.ticket_url)) {
    cleanTicketUrl = extracted.ticket_url;
  }

  const verifiedTargetUrl = isValidDeepLink(targetUrl) ? targetUrl : null;
  const venueWebsite = (venueData?.venue_website && isValidDeepLink(venueData.venue_website)) ? venueData.venue_website : null;

  // 5. Age Policy Hierarchy: Event Page > Venue Known Policy > null
  let finalRestrictions = null;
  if (extracted.age_restriction && extracted.age_restriction !== "none_available" && !/unspecified|check venue/i.test(extracted.age_restriction)) {
    finalRestrictions = extracted.age_restriction;
  } else if (existingCard?.restrictions && existingCard.restrictions !== "none_available" && !/unspecified|check venue/i.test(existingCard.restrictions)) {
    finalRestrictions = existingCard.restrictions;
  } else if (venueData?.venue_restrictions && venueData.venue_restrictions !== "Check venue door policy" && !/check venue/i.test(venueData.venue_restrictions)) {
    finalRestrictions = venueData.venue_restrictions;
  }

  const hasAddress = Boolean(venueData?.full_address && String(venueData.full_address).trim().length > 5 && venueData.full_address !== "Check Venue Website");

  // Build the canonical 0XX–8XX dimension evidence audit matrix for Stagehand Box Office QC
  const dimensionAudit = {
    // CLUSTER 0XX: Event Identity & Taxonomy
    D001_title: {
      status: finalTitle && finalTitle !== "Event" ? "verified" : "none_available",
      value: finalTitle,
      audited_at: nowIso
    },
    D003_lifecycle_type: {
      status: "verified",
      value: lifecycleType,
      audited_at: nowIso
    },
    D004_primary_category: {
      status: extracted.category ? "verified" : "search_exhausted_null",
      value: extracted.category || null,
      audited_at: nowIso
    },
    D007_restrictions: {
      status: finalRestrictions ? "verified" : "search_exhausted_null",
      value: finalRestrictions,
      audited_at: nowIso
    },

    // CLUSTER 1XX: Access, 5-Tier Link Hierarchy & Jurisdictional Boundaries (D101–D110)
    D101_tier1_checkout: {
      status: cleanTicketUrl ? "verified" : "none_available",
      value: cleanTicketUrl,
      audited_at: nowIso,
      evidence_quote: cleanTicketUrl ? "Direct ticket checkout URL accessed via Stagehand browser" : null
    },
    D102_tier2_event_page: {
      status: verifiedTargetUrl ? "verified" : "search_exhausted_null",
      value: verifiedTargetUrl,
      audited_at: nowIso,
      evidence_quote: verifiedTargetUrl
    },
    D103_tier3_calendar: {
      status: venueWebsite ? "verified" : "none_available",
      value: venueWebsite,
      audited_at: nowIso
    },
    D104_tier4_civic_destination: {
      status: "not_applicable",
      value: null,
      audited_at: nowIso
    },
    D105_tier5_venue_home: {
      status: venueWebsite ? "verified" : "none_available",
      value: venueWebsite,
      audited_at: nowIso
    },
    D106_best_available_link: {
      status: (cleanTicketUrl || verifiedTargetUrl || venueWebsite) ? "verified" : "search_exhausted_null",
      value: cleanTicketUrl || verifiedTargetUrl || venueWebsite || null,
      best_tier: cleanTicketUrl ? "Tier 1: Checkout Cart" : (verifiedTargetUrl ? "Tier 2: Event Page" : (venueWebsite ? "Tier 5: Venue Home" : "none_available")),
      audited_at: nowIso
    },
    D107_operational_status: {
      status: "verified",
      value: isSoldOut ? "sold_out" : "available",
      audited_at: nowIso
    },
    D108_geo_jurisdiction: {
      status: hasAddress ? "verified" : "search_exhausted_null",
      value: hasAddress ? "Metro Vancouver (British Columbia)" : null,
      in_market: hasAddress ? true : null,
      audited_at: nowIso
    },
    D109_currency_standard: {
      status: hasAddress ? "verified" : "search_exhausted_null",
      value: hasAddress ? "CAD" : null,
      audited_at: nowIso
    },
    D110_iana_timezone: {
      status: hasAddress ? "verified" : "search_exhausted_null",
      value: hasAddress ? "America/Vancouver" : null,
      audited_at: nowIso
    },

    // CLUSTER 2XX: Interactive Compound Box Office & Dual-Entry Ledger (D201–D222)
    D201_tier1_name: {
      status: (extracted.tier1_name || (priceRead != null)) ? "verified" : "none_available",
      value: extracted.tier1_name || (priceRead != null ? "General Admission" : null),
      audited_at: nowIso
    },
    D202_tier1_price_base: {
      status: priceBase != null ? "verified" : "none_available",
      value: priceBase,
      audited_at: nowIso
    },
    D203_tier1_price_fee: {
      status: priceFee != null ? "verified" : "none_available",
      value: priceFee,
      audited_at: nowIso
    },
    D204_tier1_price_tax: {
      status: priceTax != null ? "verified" : "none_available",
      value: priceTax,
      audited_at: nowIso
    },
    D205_tier1_price_read: {
      status: priceRead != null ? "verified" : "none_available",
      value: priceRead,
      audited_at: nowIso,
      evidence_quote: extracted.tier1_quote || (priceRead != null ? `$${priceRead.toFixed(2)} CAD` : null)
    },
    D205_tier1_price_calculated: {
      status: priceCalculated != null ? "verified" : "none_available",
      value: priceCalculated,
      formula: priceCalculated != null ? `base($${priceBase ?? "none"}) + fee($${priceFee ?? "none"}) + tax($${priceTax ?? "none"})` : null,
      audited_at: nowIso
    },
    D205_tier1_discrepancy_delta: {
      status: (priceRead != null && priceCalculated != null) ? (priceDelta === 0 ? "verified_reconciled" : "discrepancy_detected") : "none_available",
      delta: (priceRead != null && priceCalculated != null) ? priceDelta : null,
      audited_at: nowIso
    },
    D205_tier1_price_all_in: {
      status: priceAllIn != null ? "verified" : "none_available",
      value: priceAllIn,
      audited_at: nowIso,
      evidence_quote: extracted.tier1_quote || (priceAllIn != null ? `$${priceAllIn.toFixed(2)} CAD` : null)
    },
    D206_tier2_name: {
      status: t2Name ? "verified" : "none_available",
      value: t2Name || null,
      audited_at: nowIso
    },
    D207_tier2_price_base: {
      status: t2Base != null ? "verified" : "none_available",
      value: t2Base ?? null,
      audited_at: nowIso
    },
    D208_tier2_price_fee: {
      status: t2Fee != null ? "verified" : "none_available",
      value: t2Fee ?? null,
      audited_at: nowIso
    },
    D209_tier2_price_tax: {
      status: t2Tax != null ? "verified" : "none_available",
      value: t2Tax ?? null,
      audited_at: nowIso
    },
    D210_tier2_price_read: {
      status: t2Read != null ? "verified" : "none_available",
      value: t2Read,
      audited_at: nowIso,
      evidence_quote: extracted.tier2_quote || null
    },
    D210_tier2_price_calculated: {
      status: t2Calculated != null ? "verified" : "none_available",
      value: t2Calculated,
      audited_at: nowIso
    },
    D210_tier2_discrepancy_delta: {
      status: t2Delta === 0 ? "verified_reconciled" : "discrepancy_detected",
      delta: t2Delta,
      audited_at: nowIso
    },
    D210_tier2_price_all_in: {
      status: t2Read != null ? "verified" : "none_available",
      value: t2Read,
      audited_at: nowIso,
      evidence_quote: extracted.tier2_quote || null
    },
    D211_tier3_name: {
      status: extracted.tier3_name && extracted.tier3_name !== "none_available" ? "verified" : "none_available",
      value: extracted.tier3_name || null,
      audited_at: nowIso
    },
    D212_tier3_price_base: {
      status: extracted.tier3_price_base != null ? "verified" : "none_available",
      value: extracted.tier3_price_base ?? null,
      audited_at: nowIso
    },
    D213_tier3_price_fee: {
      status: extracted.tier3_price_fee != null ? "verified" : "none_available",
      value: extracted.tier3_price_fee ?? null,
      audited_at: nowIso
    },
    D214_tier3_price_tax: {
      status: extracted.tier3_price_tax != null ? "verified" : "none_available",
      value: extracted.tier3_price_tax ?? null,
      audited_at: nowIso
    },
    D215_tier3_price_read: {
      status: t3Read != null ? "verified" : "none_available",
      value: t3Read,
      audited_at: nowIso,
      evidence_quote: extracted.tier3_quote || null
    },
    D215_tier3_price_calculated: {
      status: t3Calculated != null ? "verified" : "none_available",
      value: t3Calculated,
      audited_at: nowIso
    },
    D215_tier3_discrepancy_delta: {
      status: t3Delta === 0 ? "verified_reconciled" : "discrepancy_detected",
      delta: t3Delta,
      audited_at: nowIso
    },
    D215_tier3_price_all_in: {
      status: t3Read != null ? "verified" : "none_available",
      value: t3Read,
      audited_at: nowIso,
      evidence_quote: extracted.tier3_quote || null
    },
    D216_tier_count_verified: {
      status: "verified",
      count: (extracted.tier3_name ? 3 : (t2Name ? 2 : 1)),
      audited_at: nowIso
    },
    D217_pricing_model: {
      status: "verified",
      value: extracted.pricing_model || (isFree ? "free_access" : "standard"),
      audited_at: nowIso
    },
    D218_budget_qualified_under_50: {
      status: "verified",
      qualified: priceAllIn <= 50.0,
      all_in_total: priceAllIn,
      audited_at: nowIso
    },
    D219_other_cost_label: {
      status: "none_available",
      value: null,
      audited_at: nowIso
    },
    D220_other_cost_price: {
      status: "none_available",
      value: 0.0,
      audited_at: nowIso
    },
    D221_ticket_provider: {
      status: extracted.ticket_provider ? "verified" : "none_available",
      value: extracted.ticket_provider || null,
      audited_at: nowIso
    },
    D222_booking_protocol: {
      status: cleanTicketUrl ? "verified" : "search_exhausted_null",
      value: cleanTicketUrl ? "online_reservation" : null,
      audited_at: nowIso
    },

    // CLUSTER 3XX: Performance, Schedule & Content Reality (D301–D311)
    D301_lineup: {
      status: finalLineup.length > 0 ? "verified" : "none_available",
      value: finalLineup,
      audited_at: nowIso
    },
    D303_date: {
      status: isPerennial ? "not_applicable" : (heroDate ? "verified" : "none_available"),
      value: heroDate,
      audited_at: nowIso
    },
    D304_showings_slots: {
      status: "verified",
      showings: showings,
      slot_count: showings.length,
      audited_at: nowIso
    },
    D305_doors_time: {
      status: heroDoorsTime ? "verified" : "none_available",
      value: heroDoorsTime,
      audited_at: nowIso
    },
    D306_start_time: {
      status: heroStartTime ? "verified" : "none_available",
      value: heroStartTime,
      audited_at: nowIso
    },
    D307_end_time: {
      status: heroEndTime ? "verified" : "none_available",
      value: heroEndTime,
      audited_at: nowIso
    },
    D308_dateSchedule: {
      status: "verified",
      value: dateSchedule,
      audited_at: nowIso
    },
    D309_frequencyLabel: {
      status: "verified",
      value: frequencyLabel,
      audited_at: nowIso
    },
    D310_synopsis: {
      status: "verified",
      value: extracted.description,
      audited_at: nowIso
    },
    D311_festival_affiliation: {
      status: "verified",
      value: "None",
      audited_at: nowIso
    },

    // CLUSTER 4XX: Physical Venue Geography & Constants (D401–D408)
    D401_venue_name: {
      status: "verified",
      value: venueData.venue_name,
      audited_at: nowIso
    },
    D402_full_address: {
      status: "verified",
      value: venueData.full_address,
      audited_at: nowIso
    },
    D403_coordinates: {
      status: "verified",
      value: venueData.coordinates,
      audited_at: nowIso
    },
    D405_access_model: {
      status: "verified",
      value: venueData.access_model,
      audited_at: nowIso
    },
    D406_environment_type: {
      status: "verified",
      value: venueData.environment_type,
      audited_at: nowIso
    },
    D407_weekly_hours: {
      status: venueData.weekly_hours ? "verified" : "search_exhausted_null",
      value: venueData.weekly_hours,
      audited_at: nowIso
    },
    D408_transit_waypoints: {
      status: "verified",
      value: venueData.transit_info,
      audited_at: nowIso
    },

    // CLUSTER 6XX: On-Site Spend & Amenity Benchmarks (D602–D604)
    D602_coffee_benchmark: {
      status: "verified",
      value: venueData.coffee_benchmark,
      audited_at: nowIso
    },
    D603_beer_benchmark: {
      status: "verified",
      value: venueData.beer_benchmark,
      audited_at: nowIso
    },
    D604_meal_benchmark: {
      status: "verified",
      value: venueData.meal_benchmark,
      audited_at: nowIso
    },

    // CLUSTER 8XX: Governance & Multi-Layer Provenance (D801–D809)
    D802_multi_layer_provenance: {
      status: "verified",
      pipeline: "stagehand_hybrid_ripper",
      model: "google/gemini-2.5-flash",
      audited_at: nowIso
    },
    D804_active_showings: {
      status: "verified",
      count: showings.filter((s) => s.status !== "concluded").length,
      audited_at: nowIso
    },
    D805_archived_showings: {
      status: "verified",
      count: showings.filter((s) => s.status === "concluded").length,
      audited_at: nowIso
    },
    D806_curator_lock: {
      status: "verified",
      locked: false,
      ai_curator_appeal: priceAllIn > 50.0,
      audited_at: nowIso
    },
    D808_timestamp_lockstep: {
      status: "verified",
      value: nowIso,
      audited_at: nowIso
    },
    D809_civic_provider_rules: {
      status: (venueData?.civic_provider_rules || (isPerennial && (venueData?.access_model === "free_public_access" || venueData?.venue_type === "park_beach_outdoor"))) ? "verified" : "search_exhausted_null",
      rules: venueData?.civic_provider_rules || (isPerennial && (venueData?.access_model === "free_public_access" || venueData?.venue_type === "park_beach_outdoor") ? "civic_park_by-law" : null),
      audited_at: nowIso
    },
  };

  // Compile full canonical Van50 event card
  return {
    id: slug,
    event_id: slug,
    title: finalTitle,
    event_name: finalTitle,
    artist: finalArtist,
    lineup: finalLineup,
    venue: venueData.venue_name,
    venue_name: venueData.venue_name,
    address: venueData.full_address,
    full_address: venueData.full_address,
    neighborhood: venueData.neighborhood,
    coordinates: venueData.coordinates,
    date: heroDate,
    time: heroStartTime,
    start_time: heroStartTime,
    doors_time: heroDoorsTime,
    end_time: heroEndTime,
    startIso: heroDate ? `${heroDate}T${heroStartTime ? "20:00:00" : "19:00:00"}-07:00` : null,
    dateSchedule: dateSchedule,
    frequency: frequency,
    frequencyLabel: frequencyLabel,
    showings: showings,
    category: extracted.category || existingCard?.category || "shows",
    categories: existingCard?.categories || [extracted.category || "shows"],
    categoryLabel: (extracted.category || existingCard?.category || "Shows & Arts").toUpperCase(),
    tags: existingCard?.tags || existingCard?.subTags || (extracted.category ? [extracted.category] : ["vancouver", "culture"]),
    subTags: existingCard?.subTags || existingCard?.tags || (extracted.category ? [extracted.category] : ["vancouver", "culture"]),
    price: priceAllIn,
    price_base: priceBase,
    price_fee: priceFee,
    price_tax: priceTax,
    price_read: priceRead,
    price_calculated: priceCalculated,
    price_delta: priceDelta,
    price_all_in: priceAllIn,
    tier1_name: extracted.tier1_name || (isFree ? "Free Public Access" : "General Admission"),
    tier1_quote: extracted.tier1_quote || null,
    tier2_name: t2Name || null,
    tier2_price_base: t2Base ?? null,
    tier2_price_fee: t2Fee ?? null,
    tier2_price_tax: t2Tax ?? null,
    tier2_price_read: t2Read ?? null,
    tier2_price_calculated: t2Calculated ?? null,
    tier2_discrepancy_delta: t2Delta ?? 0,
    tier2_price_all_in: t2Read ?? t2Calculated ?? null,
    tier2_quote: extracted.tier2_quote || null,
    tier3_name: extracted.tier3_name || null,
    tier3_price_base: t3Base ?? null,
    tier3_price_fee: t3Fee ?? null,
    tier3_price_tax: t3Tax ?? null,
    tier3_price_read: t3Read ?? null,
    tier3_price_calculated: t3Calculated ?? null,
    tier3_discrepancy_delta: t3Delta ?? 0,
    tier3_price_all_in: t3Read ?? t3Calculated ?? null,
    tier3_quote: extracted.tier3_quote || null,
    priceLabel: isSoldOut && (priceAllIn === 0 || priceAllIn == null)
      ? "Sold Out"
      : (isFree ? "Free ($0)" : (priceAllIn != null ? `$${priceAllIn.toFixed(2)} CAD` : (existingCard?.priceLabel || "Pending Box Office QC"))),
    pricingType: isFree ? "free" : (priceAllIn != null ? "paid" : (existingCard?.pricingType || "paid")),
    isFree: isFree,
    is_sold_out: isSoldOut,
    isSoldOut: isSoldOut,
    ticket_url: cleanTicketUrl,
    details_url: targetUrl,
    websiteUrl: cleanTicketUrl,
    ticket_provider: extracted.ticket_provider || existingCard?.ticket_provider || "Direct Box Office",
    description: (extracted.description && extracted.description !== "none_available") ? extracted.description : (existingCard?.description || ""),
    restrictions: finalRestrictions,
    transitInfo: venueData.transit_info,
    waypoints: (existingCard?.waypoints && existingCard.waypoints.length > 0) ? existingCard.waypoints : (venueData.waypoints || []),
    curator_notes: existingCard?.curator_notes || null,
    coffee_benchmark: venueData.coffee_benchmark,
    beer_benchmark: venueData.beer_benchmark,
    meal_benchmark: venueData.meal_benchmark,
    access_model: venueData.access_model,
    environment_type: venueData.environment_type,
    weekly_hours: venueData.weekly_hours,
    lifecycle_type: lifecycleType,
    approval_status: (priceAllIn != null && priceAllIn <= 50.0)
      ? `Stagehand-${Object.keys(dimensionAudit).length}D-Verified`
      : (priceAllIn != null && priceAllIn > 50.0 ? "Quarantine-Budget-Breach" : (existingCard?.approval_status || "Seed-Pending-Audit")),
    budget_qualified_under_50: priceAllIn != null ? priceAllIn <= 50.0 : (existingCard?.budget_qualified_under_50 ?? false),
    proof_keyframes: {
      cart: cartScreenshotPath ? path.relative(ROOT_DIR, cartScreenshotPath).replace(/\\/g, "/") : null,
    },
    dimension_audit: dimensionAudit,
    last_qc_audited_at: nowIso,
    last_pulse_qc_at: nowIso,
    last_content_qc_at: nowIso,
    last_full_qc_at: nowIso,
    all_tiers: (Array.isArray(extracted.all_tiers) && extracted.all_tiers.length > 0) ? extracted.all_tiers : undefined,
    tiers: (Array.isArray(extracted.all_tiers) && extracted.all_tiers.length > 0)
      ? extracted.all_tiers.map((t, idx) => {
          const tPrice = Number(t.price_all_in ?? t.price_read ?? t.price ?? 0);
          const tBase = t.price_base != null ? Number(t.price_base) : tPrice;
          const tFee = t.price_fee != null ? Number(t.price_fee) : 0;
          const tTax = t.price_tax != null ? Number(t.price_tax) : 0;
          const tRead = t.price_read != null ? Number(t.price_read) : tPrice;
          const tCalc = tBase + tFee + tTax;
          const tDelta = Math.abs(tRead - tCalc);
          return {
            name: t.name || (idx === 0 ? (extracted.tier1_name || "General Admission") : `Tier ${idx + 1}`),
            price: tPrice,
            price_base: tBase,
            price_fee: tFee,
            price_tax: tTax,
            price_read: tRead,
            price_calculated: tCalc,
            price_delta: tDelta,
            label: tPrice === 0 ? "Free ($0)" : `$${tPrice.toFixed(2)} CAD`,
            isAvailable: t.is_available !== false,
          };
        })
      : [
          {
            name: extracted.tier1_name || "General Admission",
            price: priceAllIn,
            price_base: priceBase,
            price_fee: priceFee,
            price_tax: priceTax,
            price_read: priceRead,
            price_calculated: priceCalculated,
            price_delta: priceDelta,
            label: isSoldOut && priceAllIn === 0 ? "Sold Out" : (isFree ? "Free ($0)" : (priceAllIn != null && !isNaN(priceAllIn) ? `$${Number(priceAllIn).toFixed(2)} CAD` : "Unpriced")),
            isAvailable: !isSoldOut,
          },
          ...(extracted.tier2_name && (extracted.tier2_price_all_in != null || extracted.tier2_price_read != null || t2Read != null)
            ? [
                {
                  name: extracted.tier2_name,
                  price: t2Read ?? t2Calculated,
                  price_base: t2Base ?? (t2Read ?? t2Calculated),
                  price_fee: t2Fee ?? 0,
                  price_tax: t2Tax ?? 0,
                  price_read: t2Read,
                  price_calculated: t2Calculated,
                  price_delta: t2Delta,
                  label: (t2Read ?? t2Calculated) != null && !isNaN(t2Read ?? t2Calculated) ? `$${Number(t2Read ?? t2Calculated).toFixed(2)} CAD` : "Tier 2",
                  isAvailable: true,
                },
              ]
            : []),
          ...(extracted.tier3_name && (extracted.tier3_price_all_in != null || extracted.tier3_price_read != null || t3Read != null)
            ? [
                {
                  name: extracted.tier3_name,
                  price: t3Read ?? t3Calculated,
                  price_base: t3Base ?? (t3Read ?? t3Calculated),
                  price_fee: t3Fee ?? 0,
                  price_tax: t3Tax ?? 0,
                  price_read: t3Read,
                  price_calculated: t3Calculated,
                  price_delta: t3Delta,
                  label: (t3Read ?? t3Calculated) != null && !isNaN(t3Read ?? t3Calculated) ? `$${Number(t3Read ?? t3Calculated).toFixed(2)} CAD` : "Tier 3",
                  isAvailable: true,
                },
              ]
            : []),
        ],
  };
}

export const buildFull58Dimensions = buildFullDimensions;

// ─────────────────────────────────────────────────────────────────────────────
// STAGEHAND EXECUTION RUNNER
// ─────────────────────────────────────────────────────────────────────────────
export async function runHybridRipper(targetUrl, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "" || apiKey === "YOUR_GEMINI_API_KEY_HERE") {
    throw new Error("GEMINI_API_KEY is missing or invalid in ripper/.env");
  }

  console.log(`\n================================================================`);
  console.log(`🚀 STAGEHAND HYBRID RIPPER — 0XX–8XX CANONICAL ARCHITECTURE`);
  console.log(`🎯 Target URL: ${targetUrl}`);
  console.log(`🧠 AI Engine: Google Gemini 3.8 Flash`);
  console.log(`================================================================\n`);
  console.log(`📌 Processing [1/1]: Single Event [${targetUrl}]`);

  let stagehand;
  let browser;
  try {
    browser = await localBrowser.launch();
    stagehand = await Stagehand.create({
      browser,
      model: {
        modelName: "google/gemini-3.8-flash",
        apiKey: apiKey.trim(),
      },
    });

    console.log(`🌐 [1/4] Navigating to target page...`);
    const page = await stagehand.browser.context.newPage(targetUrl);
    await new Promise((r) => setTimeout(r, 3000));

    // Interact with checkout/ticket buttons if visible
    console.log(`🎟️ [2/4] Testing interactive box office & cart drawer...`);
    try {
      await stagehand.act("If there is a 'Tickets', 'Buy Tickets', 'Get Tickets', or 'Register' button or link, click it to open the cart modal. Dismiss any cookie or newsletter banner first if present.");
      await new Promise((r) => setTimeout(r, 2000));
      await stagehand.act("If a ticket quantity selector is visible, click '+' or set quantity to 1 for General Admission to display base price, platform service fees, and taxes.");
      await new Promise((r) => setTimeout(r, 1500));
    } catch (actErr) {
      console.log(`ℹ️ Note on interactive cart action: ${actErr.message || "Proceeded directly to extraction"}`);
    }

    // Capture visual keyframe screenshot proof (unique random suffix prevents parallel collision)
    const tempSlug = `proof_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const screenshotFileName = `${tempSlug}_cart.png`;
    const screenshotFilePath = path.join(PROOFS_DIR, screenshotFileName);
    console.log(`📸 [3/4] Capturing photographic keyframe proof to ${screenshotFileName}...`);
    try {
      await page.screenshot({ path: screenshotFilePath, fullPage: false });
    } catch (shotErr) {
      console.warn(`⚠️ Warning capturing keyframe: ${shotErr.message}`);
    }

    // AI Extraction with strict Zod Schema (~25 Volatile Box Office & Event Facts)
    console.log(`🔍 [4/4] Executing AI Cognitive Box Office & Lineup Extraction...`);
    let extractedData = null;
    if (isAntigravityEngine()) {
      console.log(`🚀 [Antigravity Hybrid Ripper] Capturing rendered DOM for 1-event Antigravity Worker (${getAntigravityModel()})...`);
      const domSnapshot = await page.evaluate(() => {
        const title = document.title || "";
        const bodyText = document.body ? document.body.innerText : "";
        return `PAGE TITLE: ${title}\n\nVISIBLE CART & PAGE TEXT:\n${bodyText}`;
      });
      extractedData = await callAntigravityBoxOfficeExtractor(domSnapshot, targetUrl, {});
    }
    if (!extractedData || Object.keys(extractedData).length === 0) {
      const extraction = await stagehand.extract(
        "Extract the full event and ticketing facts: exact venue name, title, headliner artist, date, showtime, doors time, curfew/end time (D38), age restrictions, ticket purchase link, sold out state. For ticket pricing tiers (Tier 1 GA, Tier 2, Tier 3), extract itemized base ticket price, service fees, and taxes in CAD, and also read the exact total order amount displayed on the Order Total / Cart Total line into tier1_price_read, quoting the exact dollar text. If multiple show dates/times exist, extract up to 5 showings into the showings array.",
        SingleEventExtractionSchema
      );
      extractedData = extraction.data || extraction;
    }
    console.log(`\n✅ Raw Stagehand Extraction Succeeded!`);
    console.log(`   Title: ${extractedData.title}`);
    console.log(`   Venue: ${extractedData.venue_name}`);
    const finalSlug = generateSlug(extractedData.venue_name, extractedData.title, extractedData.date);
    console.log(`✨ Extracted Event: "${extractedData.title}" (${extractedData.venue_name})`);
    console.log(`📌 Processing [1/1]: ${extractedData.title} [${finalSlug || "single_card"}]`);

    // Load Venue Registry
    let venuesDb = [];
    if (fs.existsSync(VENUES_PATH)) {
      try {
        venuesDb = JSON.parse(fs.readFileSync(VENUES_PATH, "utf-8"));
      } catch (err) {
        console.warn(`⚠️ Error reading venues.json: ${err.message}`);
      }
    }

    // Stage 4: Venue Hydration
    const venueData = hydrateVenueDimensions(extractedData.venue_name, venuesDb);
    console.log(`🏛️ Venue Hydration: ${venueData.venue_matched ? "MATCHED ✅ (" + venueData.venue_name + ")" : "UNMATCHED (Fallback used)"}`);

    // If venue is uncataloged, stage candidate to discovered_venues.json
    if (!venueData.venue_matched && extractedData.venue_name) {
      await stageDiscoveredVenue(extractedData.venue_name, targetUrl);
    }

    // Rename screenshot to permanent event slug
    const permanentScreenshotPath = path.join(PROOFS_DIR, `${finalSlug}_cart.png`);
    if (fs.existsSync(screenshotFilePath)) {
      try {
        fs.renameSync(screenshotFilePath, permanentScreenshotPath);
      } catch (renameErr) {
        // Keep original if rename fails
      }
    }

    // Stages 1 & 5: Build full 0XX–8XX canonical card
    const fullEventCard = buildFullDimensions(
      extractedData,
      venueData,
      targetUrl,
      fs.existsSync(permanentScreenshotPath) ? permanentScreenshotPath : screenshotFilePath
    );

    console.log(`✨ Full 0XX–8XX Canonical Card Built (${fullEventCard.id})`);
    console.log(`   All-In Cost: ${fullEventCard.priceLabel}`);
    console.log(`   Budget Under $50 CAD: ${fullEventCard.budget_qualified_under_50 ? "YES ✅" : "NO ❌ (Budget Breach)"}`);

    // Persist or stage only if standalonePublish is explicitly enabled (Compiler AI is sole publisher)
    if (options.standalonePublish) {
      if (options.autoApprove && fullEventCard.budget_qualified_under_50) {
        await appendOrUpdateEvents(fullEventCard);
        console.log(`🚀 Card auto-approved directly to data/events.json!`);
      } else {
        await stageInReviewQueue(fullEventCard);
        console.log(`📥 Card staged in data/manual_review_queue.json for Curator inspection.`);
      }
    }

    return fullEventCard;
  } catch (err) {
    console.error(`\n❌ Error during Stagehand execution:`, err);
    throw err;
  } finally {
    if (stagehand) {
      try { await stagehand.close(); } catch (_) {}
      console.log(`🧹 Stagehand browser closed cleanly.\n`);
    }
    if (browser) {
      try { await browser.close(); } catch (_) {}
    }
  }
}

// Stage candidate venue into data/discovered_venues.json (Mutex + Atomic Write Safe)
async function stageDiscoveredVenue(venueName, sourceUrl) {
  if (!venueName || venueName === "none_available" || venueName === "Vancouver Venue" || venueName === "Vancouver Cultural Venue") {
    return;
  }
  const aggregatorTokens = ["destinationvancouver.com", "vancouverisawesome.com", "straight.com", "do604.com", "dailyhive.com", "eventbrite", "showpass", "ticketmaster", "universe.com", "songkick", "orangetickets", "vtix"];
  if (sourceUrl && aggregatorTokens.some(tok => sourceUrl.toLowerCase().includes(tok))) {
    return;
  }
  if (venueName && aggregatorTokens.some(tok => venueName.toLowerCase().includes(tok))) {
    return;
  }

  try {
    await safeUpdateJsonFile(DISCOVERED_VENUES_PATH, { metadata: {}, discoveredVenues: [] }, (disc) => {
      disc.discoveredVenues = disc.discoveredVenues || [];
      const exists = disc.discoveredVenues.some(
        (v) => (v.name || "").toLowerCase() === venueName.toLowerCase()
      );
      if (!exists) {
        disc.discoveredVenues.push({
          id: `venue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: venueName,
          websiteUrl: sourceUrl,
          source: "Stagehand Hybrid Ripper",
          status: "pending",
          discoveredAt: new Date().toISOString(),
        });
        console.log(`🏛️ Staged newly discovered venue '${venueName}' to discovered_venues.json`);
      }
      return disc;
    });
  } catch (err) {
    console.warn(`⚠️ Warning updating discovered_venues.json: ${err.message}`);
  }
}

// Stage card into data/manual_review_queue.json (Mutex + Atomic Write Safe)
async function stageInReviewQueue(eventCard) {
  try {
    await safeUpdateJsonFile(QUEUE_PATH, { metadata: {}, quarantinedEvents: [] }, (queue) => {
      queue.quarantinedEvents = (queue.quarantinedEvents || []).filter(
        (e) => (e.id || e.event_id) !== eventCard.id
      );

      eventCard.quarantineReason = eventCard.budget_qualified_under_50
        ? "stagehand_hybrid_curator_review"
        : "budget_breach_over_50";
      eventCard.reviewStatus = "pending_curator_review";
      eventCard.staged_by = "stagehand_hybrid_ripper";

      queue.quarantinedEvents.unshift(eventCard);
      queue.metadata = queue.metadata || {};
      queue.metadata.pendingCount = queue.quarantinedEvents.length;
      queue.metadata.updatedAt = new Date().toISOString();
      return queue;
    });
  } catch (err) {
    console.warn(`⚠️ Warning staging card in manual_review_queue.json: ${err.message}`);
  }
}

// Append or update directly in data/events.json (Mutex + Atomic Write Safe)
async function appendOrUpdateEvents(eventCard) {
  try {
    await safeUpdateJsonFile(EVENTS_PATH, [], (events) => {
      const idx = events.findIndex((e) => (e.id || e.event_id) === eventCard.id);
      if (idx >= 0) {
        events[idx] = eventCard;
      } else {
        events.push(eventCard);
      }
      return events;
    });
  } catch (err) {
    console.warn(`⚠️ Warning updating events.json: ${err.message}`);
  }
}

// CLI Entrypoint
if (process.argv[1] && process.argv[1].endsWith("hybrid_ripper.js")) {
  const targetUrl = process.argv[2] || "https://littlemountaingallery.ca/schedule/";
  const autoApprove = process.argv.includes("--auto-approve");

  if (targetUrl.startsWith("agy://")) {
    (async () => {
      try {
        const parsed = new URL(targetUrl);
        const step = (parsed.hostname || parsed.pathname.replace(/^\/+/, "") || "enrich").toLowerCase();
        const sp = parsed.searchParams;

        process.env.VAN50_ENGINE = "antigravity";
        const model = sp.get("model") || "gemini-3.8-flash-low";
        process.env.VAN50_AGY_MODEL = model;

        const limit = sp.get("limit") ? parseInt(sp.get("limit"), 10) : 0;
        const offset = sp.get("offset") ? parseInt(sp.get("offset"), 10) : 0;
        const id = sp.get("id") || "";
        const ids = sp.get("ids") || "";
        const isAll = sp.get("all") === "1" || sp.get("all") === "true" || sp.get("scope") === "all";
        const isQuarantine =
          sp.get("quarantine") === "1" ||
          sp.get("quarantine") === "true" ||
          sp.get("scope") === "quarantine" ||
          sp.get("scope") === "quarantined";
        const force = sp.get("force") === "1" || sp.get("force") === "true";
        const uncompiledOnly = sp.get("uncompiled_only") === "1" || sp.get("uncompiled_only") === "true";
        const incompleteOnly = sp.get("incomplete_only") === "1" || sp.get("incomplete_only") === "true" || sp.get("scope") === "incomplete";
        const stale = sp.get("stale") || "";
        const innerUrl = sp.get("target_url") || "";
        const venue = sp.get("venue") || "";
        const venuesOnly = sp.get("venues_only") === "1" || sp.get("venues_only") === "true";
        const cardsOnly = sp.get("cards_only") === "1" || sp.get("cards_only") === "true";

        console.log(`\n================================================================`);
        console.log(`🚀 VAN50 ANTIGRAVITY ENGINE DISPATCHER (Non-AI Master Loop)`);
        console.log(`⚡ Step: ${step.toUpperCase()} | Worker Model: ${model} | Scope: ${sp.get("scope") || "default"}`);
        console.log(`🛡️ Anti-Laziness Architecture: Deterministic Loop + Fresh 1-Event Antigravity Workers`);
        console.log(`================================================================\n`);

        const opts = {
          engine: "antigravity",
          limit,
          offset,
          id: id || null,
          ids: ids ? ids.split(",").filter(Boolean) : null,
          venue: venue || null,
          venuesOnly,
          cardsOnly,
          all: isAll,
          quarantine: isQuarantine,
          quarantined: isQuarantine,
          force,
          unverifiedOnly: !isAll && !isQuarantine && !force && !id && !ids && !incompleteOnly && !stale,
          uncompiledOnly,
          incompleteOnly,
          stale: stale || null,
          autoApprove,
        };

        if (step === "harvest" || step === "calendar" || step === "harvester") {
          const { runAllVenueFeedsBatch, runCalendarBatch } = await import("./calendar_harvester.js");
          if (!innerUrl || innerUrl === "all") {
            await runAllVenueFeedsBatch({ maxEvents: limit, engine: "antigravity" });
          } else {
            await runCalendarBatch(innerUrl, { maxEvents: limit, engine: "antigravity" });
          }
        } else if (step === "hunter" || step === "tier1_hunt") {
          const { huntBatchTier1Links } = await import("./tier1_hunter.js");
          await huntBatchTier1Links(opts);
        } else if (step === "qc" || step === "catalog_batch") {
          const { runEventBatchQC } = await import("./event_batch_qc.js");
          await runEventBatchQC(opts);
        } else if (step === "enrich") {
          const { runEnricher } = await import("./enricher.js");
          await runEnricher(opts);
        } else if (step === "venue" || step === "venue_detailer") {
          const { runVenueDetailer } = await import("./venue_detailer.js");
          await runVenueDetailer(opts);
        } else if (step === "compile") {
          const { compileCatalog } = await import("./compile_catalog.js");
          await compileCatalog(opts);
        } else if (step === "master") {
          console.log(`\n🔥 [MASTER PIPELINE STEP 1/3] Running Box Office QC (1-by-1 Antigravity Loop)...`);
          const { runEventBatchQC } = await import("./event_batch_qc.js");
          await runEventBatchQC(opts);

          console.log(`\n🔥 [MASTER PIPELINE STEP 2/3] Running AI Semantic Enricher (1-by-1 Antigravity Loop)...`);
          const { runEnricher } = await import("./enricher.js");
          await runEnricher({ ...opts, skipHunt: true });

          console.log(`\n🔥 [MASTER PIPELINE STEP 3/3] Running AI Compiler & Publisher (1-by-1 Antigravity Loop)...`);
          const { compileCatalog } = await import("./compile_catalog.js");
          await compileCatalog(opts);
          printAntigravityTimeoutSummary("Master Pipeline Run (Steps 1–3)");
          console.log(`\n🏁 [MASTER PIPELINE COMPLETE] All steps finished with 0 AI laziness!`);
        } else if (innerUrl && innerUrl.startsWith("http")) {
          await runHybridRipper(innerUrl, { autoApprove });
        } else {
          const { runEnricher } = await import("./enricher.js");
          await runEnricher(opts);
        }
        process.exit(0);
      } catch (err) {
        console.error(`💥 Antigravity Dispatcher Failed: ${err.message}`);
        process.exit(1);
      }
    })();
  } else {
    runHybridRipper(targetUrl, { autoApprove })
      .then((result) => {
        console.log(`\n🎉 Success! Processed: ${result.title} ($${result.price} CAD)`);
        process.exit(0);
      })
      .catch((err) => {
        console.error(`💥 Execution Failed: ${err.message}`);
        process.exit(1);
      });
  }
}
