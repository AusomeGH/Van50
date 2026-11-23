import dotenv from "dotenv";
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";
import { runHybridRipper, generateSlug } from "./hybrid_ripper.js";
import { runPostHarvestLinkUpgrader, inspectCardForCandidateLink } from "./link_upgrader.js";
import { scanCatalogLinkHealth } from "./link_health_scanner.js";
import { huntBatchTier1Links, runStep1BLinkUpgrader } from "./tier1_hunter.js";
import { logCuratorInfo, getCuratorInfo } from "./curator_display.js";
import {
  isAntigravityEngine,
  getAntigravityModel,
  formatLogTime,
  recordPipelineTimeoutEvent,
  printAntigravityTimeoutSummary,
  safeUpdateJsonFile,
  runWithConcurrency,
  createSemaphore,
} from "./agy_engine.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly load .env from ripper/ first, then fallback to root .env
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });
const ROOT_DIR = path.resolve(__dirname, "..");
const LEDGER_PATH = path.join(ROOT_DIR, "data", "scout_target_ledger.json");
const EVENTS_PATH = path.join(ROOT_DIR, "data", "events.json");
const QUEUE_PATH = path.join(ROOT_DIR, "data", "manual_review_queue.json");
const ARCHIVED_PATH = path.join(ROOT_DIR, "data", "archived_events.json");
const RULES_PATH = path.join(ROOT_DIR, "data", "curator_learned_rules.json");

/**
 * Returns Sets of known event IDs, URLs, and titles across all data stores
 * (active catalog, review queue, archived events, and learned blacklist rules)
 * to ensure Stage 1A actively seeks NEW uncataloged events and never re-scans
 * or re-discovers rejected or quarantined items.
 */
export function getExistingCatalogLookup() {
  const activeIds = new Set();
  const activeUrls = new Set();
  const activeTitles = new Set();
  const quarantinedIds = new Set();
  const quarantinedUrls = new Set();
  const archivedIds = new Set();
  const archivedUrls = new Set();
  const blacklistPatterns = [];

  const normalizeUrl = (u) => {
    try {
      return String(u).split("?")[0].split("#")[0].replace(/\/$/, "").toLowerCase().trim();
    } catch (_) {
      return "";
    }
  };

  // 1. Active Catalog (events.json)
  try {
    if (fs.existsSync(EVENTS_PATH)) {
      const events = JSON.parse(fs.readFileSync(EVENTS_PATH, "utf-8"));
      for (const e of events) {
        if (e.id) activeIds.add(String(e.id).toLowerCase());
        if (e.event_id) activeIds.add(String(e.event_id).toLowerCase());
        [e.ticket_url, e.details_url, e.source_url].filter(Boolean).forEach((u) => {
          const nu = normalizeUrl(u);
          if (nu) activeUrls.add(nu);
        });
        if (e.title) activeTitles.add(e.title.toLowerCase().trim());
        if (e.event_name) activeTitles.add(e.event_name.toLowerCase().trim());
      }
    }
  } catch (err) {
    console.warn(`[WARN] Could not load events.json for duplicate suppression: ${err.message}`);
  }

  // 2. Manual Review Queue (manual_review_queue.json)
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      const qData = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
      const qList = Array.isArray(qData.quarantinedEvents) ? qData.quarantinedEvents : [];
      for (const q of qList) {
        if (q.id) quarantinedIds.add(String(q.id).toLowerCase());
        if (q.event_id) quarantinedIds.add(String(q.event_id).toLowerCase());
        [q.ticket_url, q.details_url, q.source_url, q.candidate_tier1_url].filter(Boolean).forEach((u) => {
          const nu = normalizeUrl(u);
          if (nu) quarantinedUrls.add(nu);
        });
      }
    }
  } catch (err) {
    console.warn(`[WARN] Could not load manual_review_queue.json for duplicate suppression: ${err.message}`);
  }

  // 3. Permanently Archived / Disqualified Events (archived_events.json)
  try {
    if (fs.existsSync(ARCHIVED_PATH)) {
      const aData = JSON.parse(fs.readFileSync(ARCHIVED_PATH, "utf-8"));
      const aList = Array.isArray(aData) ? aData : (aData.archivedEvents || []);
      for (const a of aList) {
        if (a.id) archivedIds.add(String(a.id).toLowerCase());
        if (a.event_id) archivedIds.add(String(a.event_id).toLowerCase());
        [a.ticket_url, a.details_url, a.source_url, a.websiteUrl].filter(Boolean).forEach((u) => {
          const nu = normalizeUrl(u);
          if (nu) archivedUrls.add(nu);
        });
      }
    }
  } catch (err) {
    console.warn(`[WARN] Could not load archived_events.json for duplicate suppression: ${err.message}`);
  }

  // 4. Curator Learned Rules & Blacklist Patterns (curator_learned_rules.json)
  const recurringBlacklistStems = new Set();
  const stripTrailingDateSuffix = (rawId) =>
    String(rawId || "").toLowerCase().trim().replace(/-(?:202\d-\d{2}-\d{2}|202\d\d{4}|\d{1,2})$/, "");
  try {
    if (fs.existsSync(RULES_PATH)) {
      const rData = JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));
      (rData.archived_event_ids || []).forEach((id) => archivedIds.add(String(id).toLowerCase()));
      (rData.recurring_blacklist_stems || []).forEach((stem) => {
        const cleanStem = stripTrailingDateSuffix(stem);
        if (cleanStem.length >= 8) recurringBlacklistStems.add(cleanStem);
      });
      (rData.course_blacklist_patterns || []).forEach((p) => {
        if (p) blacklistPatterns.push(String(p).toLowerCase().trim());
      });
    }
  } catch (err) {
    console.warn(`[WARN] Could not load curator_learned_rules.json for duplicate suppression: ${err.message}`);
  }

  // 5. Already Harvested Schedule Layer (data/layers/layer_schedules.json)
  const scheduledIds = new Set();
  const scheduledUrls = new Set();
  const SCHEDULES_LAYER_PATH = path.join(ROOT_DIR, "data", "layers", "layer_schedules.json");
  try {
    if (fs.existsSync(SCHEDULES_LAYER_PATH)) {
      const sData = JSON.parse(fs.readFileSync(SCHEDULES_LAYER_PATH, "utf-8"));
      const sList = Array.isArray(sData) ? sData : Object.values(sData || {});
      for (const s of sList) {
        if (s.id) scheduledIds.add(String(s.id).toLowerCase());
        if (s.event_id) scheduledIds.add(String(s.event_id).toLowerCase());
        [s.source_url, s.details_url, s.ticket_url].filter(Boolean).forEach((u) => {
          const nu = normalizeUrl(u);
          if (nu) scheduledUrls.add(nu);
        });
      }
    }
  } catch (err) {
    console.warn(`[WARN] Could not load layer_schedules.json for duplicate suppression: ${err.message}`);
  }

  const isNonEventPolicyPage = (title, url, detailsUrl) => {
    const rawTitle = (title || "").toLowerCase().trim();
    if ([
      "event", "events", "search_exhausted_null", "quarantine_fatal", "page not found", "error 404", "404 not found",
      "503 service unavailable", "502 bad gateway", "504 gateway timeout", "403 forbidden",
      "granville island directory", "events & programs", "events & organizations", "community events calendar",
      "vancouver events calendar", "plan your visit", "schools and groups", "become a member", "submit an event",
      "list your event", "list your event - 604 now",
      "event booking guide", "filming in the city", "choose seats", "select seats", "find tickets", "buy tickets",
      "get tickets", "book tickets", "tickets", "be a sponsor", "sponsorship", "trophies", "transportation division",
      "surrey fire services"
    ].includes(rawTitle)) {
      return true;
    }
    if (/^(?:discover\s+events\s+in\s+|things\s+to\s+do\s+in\s+|free\s+holiday\s+events\s+in\s+|toy\s+drives\s+around\s+|upcoming\s+holiday\s+events\s+at\s+|victoria\s+festivals\s+and\s+events|vancouver['’]s\s+best\s+|vancouver\s+history\s+and\s+culture|vancouver\s+rainy\s+day\s+activities|list\s+your\s+event\b)/i.test(rawTitle)) {
      return true;
    }
    if (/\b(?:503\s+service\s+unavailable|502\s+bad\s+gateway|closed\s+for\s+a?\s*private\s+(?:party|event|function|buyout)|birthday\s+part(?:y|ies)|court\s+rental|private\s+(?:youth\s+|adult\s+)?tutoring|bus\s+trip\b|(?:mfa|ma|phd|ph\.d\.|thesis|dissertation)\s+defen[cs]e|supplemental\s+application|(?:virtual|online)\s+info(?:rmation)?\s+session|information\s+sessions?:|(?:sca|campus|admissions?|program|faculty|department)\s+open\s+house|greta\s+bar\s+yy[cz]|page\s+not\s+found|error\s+404|cefa\s+(?:early\s+learning|morgan\s+crossing|panorama|campbell\s+heights|cloverdale|sullivan\s+ridge|south\s+surrey)|graduation(?:\s+ceremony)?|convocation(?:\s+ceremony)?|commencement\s+ceremony|coll(?:e|a)ge\s+grad(?:uation)?|season\s+memberships?|season\s+pass(?:es)?|annual\s+pass(?:es)?|exhibition\s+catalogue|school\s+boundaries|roster\s+(?:202\d[-–]\d{2}|regular\s+season)|(?:@|at)\s+(?:abbotsford\s+pilots|mission\s+city\s+outlaws|chilliwack\s+jets)|settlement\s+services\s+for\s+newcomers|student\s+food\s+pantry|peer\s+wellness\s+information\s+booth|sfu\s+livewhale\s+calendar|tuition\s+estimator|educationplannerbc|applying\s+to\s+kpu|why\s+choose\s+kpu|kpu\s+registration|find\s+your\s+classroom|exam\s+review|naloxone\s+training\s+session\s+for\s+students|registration\s+101\s+information\s+session|canadian\s+taxes\s+for\s+international\s+students)\b/i.test(rawTitle)) {
      return true;
    }
    if (/\bwebinar\b/i.test(rawTitle) && !/\b(?:in[- ]person|hybrid)\b/i.test(rawTitle)) {
      return true;
    }
    if (/^(?:ticket[- ]?info|pricing|rates|admission[- ]?rates|box[- ]?office[- ]?info|standard[- ]?pricing|concession[- ]?menu)$/i.test(rawTitle)) {
      return true;
    }
    if (/\b(?:ticket\s+polic(?:y|ies)|single[- ]game\s+tickets|special\s+ticket\s+offers|general\s+ticketing(?:\s*&\s*show\s*access)?)\b/i.test(rawTitle)) {
      return true;
    }
    const checkUrls = [url, detailsUrl].filter(Boolean).map((u) => normalizeUrl(u));
    for (const cu of checkUrls) {
      if (/\.(?:pdf|jpg|jpeg|png|webp|gif|svg|mp4|zip)(\?|$)/i.test(cu)) return true;
      if (/\/wp-content\/uploads\//i.test(cu)) return true;
      if (/\.aspx(\?|$)/i.test(cu) && !/chooseseats\.aspx|ticketsearchcriteria\.aspx\?evtinfo=/i.test(cu)) return true;
      if (/allevents\.in\/pages\/|flohockey\.tv|flosports\.tv|showpass\.com\/(?:m|discover|cities|explore|o|s)(?:\/|$)/i.test(cu)) return true;
      if (/\/stats\/(?:roster|standings|leaders|player|game-center|schedule)(?:\/|$)/i.test(cu)) return true;
      if (/\/(?:season-pass|annual-pass|membership-pass)(?:[-/]|$)/i.test(cu)) return true;
      if (/eventbrite\.(?:ca|com)\/(?:b|d|ttd|l|o|cc)\//i.test(cu)) return true;
      if (/thecinematheque\.ca\/films\/(?:director\/|20(?:1\d|2[0-5])\/)/i.test(cu)) return true;
      if (/vancouversbestplaces\.com\/(?:best-places|on-a-rainy-day|events-calendar)(?:\/|$)|victoriasbestplaces\.com/i.test(cu)) return true;
      if (/miss604\.com\/202\d\/|604now\.com\/list-events/i.test(cu)) return true;
      if (/admitone\.com\/events\/(?:cobble-hill|victoria|nanaimo|kelowna|kamloops|calgary|edmonton|toronto|seattle)(?:\/|$)/i.test(cu)) return true;
      if (/admitone\.com\/events\/[^/]+(?:$|\/(?:community|pro)(?:\/[a-z0-9_-]+)?$)/i.test(cu)) return true;
      if (/gretabar\.com\/(?:toronto|calgary|edmonton)\b/i.test(cu)) return true;
      if (/\/(?:[a-z0-9-]*-)?(?:coll(?:e|a)ge-grad|graduation-ceremony|convocation)(?:\/|$)/i.test(cu)) return true;
      if (/events\.sfu\.ca\/livewhale(?:\/|$)|kpu\.ca\/(?:tuitionestimator|apply|admission(?:\/|$)|why-choose-kpu|registration(?:\/|$)|current-students\/find-your-classroom|climatebookclub|learningcentres\/events\/workshops\/)|surreylibraries\.ca\/events\/settlement-services-newcomers/i.test(cu)) return true;
      if (/\/(?:directory|library-archives|past-exhibitions|student-exhibitions|permanent-exhibitions|new-installations|collections|conservation|curatorial|sourcebooks|museum-shop|acquisitions-donations|moa-donors|indigenous-access|group-bookings|moa-access-pass|school-programs|public-programs|plan-your-visit|schools-and-groups|submit-event|list-events|event-booking-guide|filming-in-the-city|become-a-member|private-party|private-event|city-government|city-departments|public-safety|gallery-publications|exhibition-catalogues|who-we-are|be-a-sponsor|sponsor|sponsorship|trophies|season-memberships)(\/|$)/i.test(cu)) return true;
      if (/\/(?:ticket-info|ticket-policies|pricing|admission-rates|concession-menu|support|corporate-giving|patrons-circle|major-gifts|tickets\/single-game-tickets|tickets\/special-offers|tickets\/season-tickets|tickets\/mini-plans|tickets\/group-tickets|series\/|education\/|scholarship|scholarships)\b/i.test(cu)) return true;
      if (cu.endsWith("/ticket-info") || cu.endsWith("/ticket-policies") || cu.endsWith("/pricing") || cu.endsWith("/rates") || cu.endsWith("/concession-menu") || cu.includes("vancouversymphony.ca/series") || cu.includes("artsclub.com/education")) return true;
    }
    return false;
  };

  const getUrlSuppressionReason = (u, opts = {}) => {
    if (!u) return "Empty URL";
    const nu = normalizeUrl(u);
    if (!nu) return "Invalid URL";
    if (archivedUrls.has(nu)) return "Permanently Archived / Disqualified Event";
    for (const pat of blacklistPatterns) {
      if (pat && (nu.includes(pat) || (pat.startsWith("http") && nu === normalizeUrl(pat)))) {
        return `Blacklisted Pattern: "${pat}"`;
      }
    }
    if (activeUrls.has(nu)) return "Already Published in Active Catalog";
    if (quarantinedUrls.has(nu)) return "Already Staged in Manual Review Queue";
    if (!opts.ignoreScheduled && scheduledUrls.has(nu)) return "Already Harvested in Stage 1A Schedule Layer";
    if (isNonEventPolicyPage("", u, "")) return "Non-Event Pricing / Policy Page Pattern";
    return null;
  };

  const isUrlSuppressed = (u, opts = {}) => Boolean(getUrlSuppressionReason(u, opts));

  const knownIds = new Set([...activeIds, ...quarantinedIds, ...archivedIds, ...scheduledIds]);
  const knownUrls = new Set([...activeUrls, ...quarantinedUrls, ...archivedUrls, ...scheduledUrls]);
  const knownTitles = activeTitles;

  return {
    activeIds,
    activeUrls,
    activeTitles,
    quarantinedIds,
    quarantinedUrls,
    archivedIds,
    archivedUrls,
    recurringBlacklistStems,
    scheduledIds,
    scheduledUrls,
    blacklistPatterns,
    knownIds,
    knownUrls,
    knownTitles,
    isUrlSuppressed,
    getUrlSuppressionReason,
    isNonEventPolicyPage,
  };
}

const STAGE1A_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SOURCE_HEALTH_PATH = path.join(ROOT_DIR, "data", "layers", "source_health_report.json");

const HARD_REJECT_URL_RE = /\/(?:login|signup|sign-?in|register|cart|basket|viewbasket|myaccount|account|privacy|terms|contact|about|who-we-are|donate|donations?|ticket-donations?|support|corporate-giving|patrons-circle|major-gifts|gift-cards?|vouchers?|faq|volunteer|volunteering|membership|season-memberships?|season-pass(?:es)?|annual-pass(?:es)?|membership-pass(?:es)?|all-access-pass(?:es)?|stats\/(?:roster|standings|leaders|player|game-center|schedule|team)|merchandise|merch|shop|store|ticket-info|tickets-info|ticketinfo|ticket-policies|pricing|admission-rates|rates|concession-menu|menus?|rentals?|private-events?|book-for-private|health-and-safety|house-rules|protocols|press|careers|jobs|staff|board|sponsors?|be-a-sponsor|sponsorship|scholarships?|trophies|gallery-publications|exhibition-catalogues|city-government|city-departments|public-safety|services-and-payments|sport-hosting|things-to-do|eat-drink|events\/purchase|submit|virtual-tour|crime-prevention|bike-valet|past-events|archive|category|tag|author|wp-content\/uploads|accessibility|directions|parking|series|education)\b|web\.archive\.org|ticket-donation|donation-program/i;

const DIRECT_TICKETING_RE = /(?:eventbrite\.(?:ca|com)\/e\/|ticketweb\.ca\/event\/|universe\.com\/events\/|purchase\.theimprovcentre\.ca\/ChooseSeats|vtixonline\.com\/|admitone\.com\/events\/[^/]+\/(?:pro|community)\/[^/]+\/[^/]+\/[^/]+|riotheatretickets\.ca\/events\/|bloomtickets\.ca\/event\/|humanitix\.com\/|eventive\.org\/|dice\.fm\/event\/|simpletix\.(?:ca|com)\/e\/|tickettailor\.com\/events\/|showpass\.com\/(?!o\/|s\/|m\/|discover|search|login|signup|cart|checkout|about|terms|privacy|organizations|cities|venues|explore|sell|pricing|contact|support|help|faq|blog|app|download|features|resources|partners)[a-z0-9-]{3,}|EventInstanceId=\d+|WebEventId=[A-Za-z0-9_-]+)/i;

const DATE_SLUG_OR_ID_RE = /(?:202[6-9]-\d{2}-\d{2}|\/(?:events?|shows?|listings\/events)\/\d{3,}(?:\/|$))/i;
const DATE_BADGE_RE = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b|\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i;
const GENERIC_EVENT_PATH_RE = /\/(?:events?|shows?|films?|tickets?|schedule|performances?|screenings?|chooseseats|production|whats-on|whatson|season|concert|exhibition|program)\b/i;

async function recordSourceHealth(url, status, detail = "") {
  try {
    await safeUpdateJsonFile(SOURCE_HEALTH_PATH, {}, (report) => {
      const obj = (report && typeof report === "object" && !Array.isArray(report)) ? report : {};
      obj[url] = {
        url,
        status,
        detail: String(detail || "").slice(0, 140),
        checked_at: new Date().toISOString(),
      };
      return obj;
    });
  } catch (_) {
    // Non-fatal telemetry write
  }
}

function extractJsonLdEventsFromHtml(html, baseUrl) {
  const events = [];
  if (!html || typeof html !== "string") return events;
  const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  const collect = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(collect);
      return;
    }
    if (Array.isArray(node["@graph"])) {
      node["@graph"].forEach(collect);
    }
    const rawType = Array.isArray(node["@type"]) ? node["@type"].join(" ") : String(node["@type"] || "");
    if (/\b(?:Event|MusicEvent|TheaterEvent|ComedyEvent|Festival|ExhibitionEvent|SocialEvent|SportsEvent|DanceEvent|ScreeningEvent|VisualArtsEvent|LiteraryEvent)\b/i.test(rawType)) {
      let evUrl = node.url || (node.offers && !Array.isArray(node.offers) ? node.offers.url : null) || null;
      if (evUrl && baseUrl) {
        try { evUrl = new URL(evUrl, baseUrl).href.split("#")[0]; } catch (_) { evUrl = null; }
      }
      const loc = Array.isArray(node.location) ? node.location[0] : node.location;
      const venueName = typeof loc === "string" ? loc : (loc && loc.name ? String(loc.name) : "");
      const addrObj = loc && loc.address ? loc.address : null;
      const addressStr = typeof addrObj === "string"
        ? addrObj
        : (addrObj ? [addrObj.streetAddress, addrObj.addressLocality, addrObj.addressRegion].filter(Boolean).join(", ") : "");
      const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
      const offerUrl = offers && offers.url ? String(offers.url) : null;
      events.push({
        url: evUrl,
        name: node.name ? String(node.name).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "",
        startDate: node.startDate ? String(node.startDate).trim() : "",
        endDate: node.endDate ? String(node.endDate).trim() : "",
        venue: venueName.trim(),
        address: addressStr.trim(),
        city: addrObj && addrObj.addressLocality ? String(addrObj.addressLocality).trim() : "",
        description: node.description ? String(node.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400) : "",
        ticketUrl: offerUrl,
      });
    }
  };
  while ((m = scriptRe.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      collect(parsed);
    } catch (_) {
      // Ignore malformed JSON-LD blocks
    }
  }
  return events;
}

function scoreAndFilterCandidateEntries(entries, calendarUrl) {
  const calNorm = (calendarUrl || "").split("?")[0].split("#")[0].replace(/\/$/, "");
  const scoredMap = new Map();

  for (const entry of entries) {
    const rawHref = String(entry.href || "").trim();
    if (!rawHref || !rawHref.startsWith("http")) continue;
    if (HARD_REJECT_URL_RE.test(rawHref)) continue;

    const hrefNorm = rawHref.split("?")[0].split("#")[0].replace(/\/$/, "");
    if (hrefNorm === calNorm) continue;

    let urlObj;
    try {
      urlObj = new URL(hrefNorm);
    } catch (_) {
      continue;
    }
    const p = urlObj.pathname.replace(/\/$/, "").toLowerCase();
    if (["", "/events", "/shows", "/tickets", "/schedule", "/calendar", "/listings", "/whats-on", "/whatson", "/season", "/programs", "/exhibitions", "/ticket-info", "/pricing", "/rates"].includes(p)) {
      continue;
    }
    if (p.endsWith("/ticket-info") || p.endsWith("/pricing") || p.endsWith("/admission-rates") || p.endsWith("/concession-menu")) {
      continue;
    }
    if (/thecinematheque\.ca\/films\/(?:director\/|20(?:1\d|2[0-5])\/)/i.test(hrefNorm)) continue;
    if (/vancouversbestplaces\.com\/(?:best-places|on-a-rainy-day|events-calendar)(?:\/|$)|victoriasbestplaces\.com/i.test(hrefNorm)) continue;
    if (/miss604\.com\/202\d\/|604now\.com\/list-events/i.test(hrefNorm)) continue;
    if (/eventbrite\.(?:ca|com)\/(?:b|d|ttd|l|o|cc)\//i.test(hrefNorm)) continue;
    if (/admitone\.com\/events\/(?:cobble-hill|victoria|nanaimo|kelowna|kamloops|calgary|edmonton|toronto|seattle)(?:\/|$)/i.test(hrefNorm)) continue;
    if (/admitone\.com\/events\/[^/]+(?:$|\/(?:community|pro)(?:\/[a-z0-9_-]+)?$)/i.test(hrefNorm)) continue;
    if (/\.(?:pdf|jpg|jpeg|png|gif|svg|webp|ics|zip)$/i.test(p)) continue;

    const label = String(entry.label || "").trim();
    if (/^(?:home|about|contact|events|calendar|tickets|schedule|menu|search|skip to|more|read more|view all|log in|sign in|subscribe|donate|shop|races)$/i.test(label) && !entry.fromJsonLd && !DIRECT_TICKETING_RE.test(rawHref)) {
      continue;
    }

    let score = 0;
    if (entry.fromJsonLd) score = Math.max(score, 100);
    if (DIRECT_TICKETING_RE.test(rawHref)) score = Math.max(score, 80);
    if (DATE_SLUG_OR_ID_RE.test(rawHref)) score = Math.max(score, 60);
    if (entry.hasDateEvidence || DATE_BADGE_RE.test(label)) score = Math.max(score, 40);
    if (score === 0 && GENERIC_EVENT_PATH_RE.test(rawHref)) score = 10;

    if (score === 0) continue;

    const finalUrl = DIRECT_TICKETING_RE.test(rawHref) && /EventInstanceId=|WebEventId=/i.test(rawHref) ? rawHref.split("#")[0] : hrefNorm;
    const prev = scoredMap.get(finalUrl);
    if (!prev || score > prev.score) {
      scoredMap.set(finalUrl, { url: finalUrl, score });
    }
  }

  let ranked = Array.from(scoredMap.values()).sort((a, b) => b.score - a.score);
  // When high-confidence event links (>= 40) exist, drop low-signal generic path-only (+10) noise
  const highConf = ranked.filter((x) => x.score >= 40);
  if (highConf.length > 0) {
    ranked = highConf;
  }
  return ranked.map((x) => x.url);
}

/**
 * Wide-Scan Calendar Link Extractor (HTTP-First Hybrid with Targeted SPA Fallback)
 * 1. Fast parallel-safe HTTP pre-flight health check (<1s) skips dead/404/403/429/DNS sources without launching Chromium.
 * 2. Extracts schema.org/Event JSON-LD + main-body links with deterministic priority scoring.
 * 3. Falls back to headless Chromium ONLY when an HTTP-200 source is a JS-rendered SPA returning 0 HTTP candidates.
 */
export async function harvestCalendarLinks(calendarUrl) {
  if (!calendarUrl || calendarUrl === "all" || !calendarUrl.startsWith("http")) {
    calendarUrl = "https://theimprovcentre.ca/shows/";
  }
  console.log(`\n📅 HARVESTING CALENDAR LINKS from: ${calendarUrl}`);

  // 1. Fast HTTP Pre-Flight Health Check + Lightweight HTML/JSON-LD Extraction
  let httpOk = false;
  let httpFinalUrl = calendarUrl;
  try {
    const httpStart = Date.now();
    const res = await fetch(calendarUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(7000),
      headers: {
        "User-Agent": STAGE1A_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const httpMs = Date.now() - httpStart;
    httpFinalUrl = res.url || calendarUrl;

    if (!res.ok) {
      const bucket = [403, 406, 429].includes(res.status) ? "waf_or_ratelimit" : `http_${res.status}`;
      console.log(`🩺 [Stage 1A Health] HTTP ${res.status} (${bucket}, ${httpMs}ms) on ${calendarUrl} — skipping Chromium launch.`);
      await recordSourceHealth(calendarUrl, bucket, `HTTP ${res.status}`);
      return [];
    }

    httpOk = true;
    const html = await res.text();
    const rawEntries = [];

    // Tier 1: schema.org/Event JSON-LD items
    const jsonLdEvents = extractJsonLdEventsFromHtml(html, httpFinalUrl);
    for (const je of jsonLdEvents) {
      if (je.url) {
        rawEntries.push({ href: je.url, label: je.name, fromJsonLd: true, hasDateEvidence: Boolean(je.startDate) });
      }
    }

    // Tier 2–4: Strip header/nav/footer/script/style chrome before extracting <a> links
    const strippedBody = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(?:header|nav|footer)\b[^>]*>[\s\S]*?<\/(?:header|nav|footer)>/gi, " ");
    const aRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = aRe.exec(strippedBody)) !== null) {
      let href = m[1].trim();
      const label = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      try {
        href = new URL(href, httpFinalUrl).href;
      } catch (_) {
        continue;
      }
      rawEntries.push({ href, label, fromJsonLd: false, hasDateEvidence: DATE_BADGE_RE.test(label) });
    }

    const httpLinks = scoreAndFilterCandidateEntries(rawEntries, httpFinalUrl);
    await recordSourceHealth(calendarUrl, "http_200_ok", `links=${httpLinks.length} jsonLd=${jsonLdEvents.length} (${httpMs}ms)`);
    if (httpLinks.length > 0) {
      console.log(`⚡ [Stage 1A HTTP-First] Discovered ${httpLinks.length} prioritized event candidate links in ${httpMs}ms (JSON-LD: ${jsonLdEvents.length}, Chromium bypassed).`);
      return httpLinks;
    }
    console.log(`🔄 [Stage 1A SPA Fallback] HTTP 200 (${httpMs}ms) returned 0 static links on ${calendarUrl} — launching targeted Chromium fallback...`);
  } catch (httpErr) {
    console.log(`🩺 [Stage 1A Health] Network/DNS error (${httpErr.message.slice(0, 80)}) on ${calendarUrl} — skipping Chromium launch.`);
    await recordSourceHealth(calendarUrl, "network_or_dns_err", httpErr.message);
    return [];
  }

  if (!httpOk) return [];

  // 2. Targeted SPA Chromium Fallback (only reached for HTTP-200 JS-rendered calendars)
  const apiKey = process.env.GEMINI_API_KEY || "";
  let browser;
  let stagehand;

  try {
    browser = await localBrowser.launch({ headless: true, args: ["--mute-audio"] });
    stagehand = await Stagehand.create({
      browser,
      model: {
        modelName: "google/gemini-3.8-flash",
        apiKey: apiKey.trim(),
      },
    });
    const page = await stagehand.browser.context.newPage(httpFinalUrl);
    await new Promise((r) => setTimeout(r, 2000)); // Tighter SPA hydration window

    await page.evaluate(async () => {
      window.scrollBy(0, 1200);
      await new Promise((r) => setTimeout(r, 800));
    });

    const domEntries = await page.evaluate(() => {
      const dateBadgeRegex = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b|\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i;
      const out = [];
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        if (a.closest("nav, header, footer")) continue;
        const href = a.href;
        if (!href || !href.startsWith("http")) continue;
        const cardContainer = a.closest('article, [class*="event"], [class*="show"], [class*="card"], [class*="performance"], [class*="listing"], [class*="program"], [class*="production"]');
        const label = (a.innerText || a.textContent || "").trim();
        const containerText = cardContainer ? (cardContainer.innerText || cardContainer.textContent || "") : "";
        const hasTimeTag = cardContainer ? Boolean(cardContainer.querySelector("time, [datetime], [class*='date'], [class*='time']")) : false;
        out.push({
          href,
          label: label.slice(0, 120),
          fromJsonLd: false,
          hasDateEvidence: hasTimeTag || dateBadgeRegex.test(containerText) || dateBadgeRegex.test(label),
        });
      }
      return out;
    });

    const links = scoreAndFilterCandidateEntries(domEntries, httpFinalUrl);
    console.log(`🎯 Discovered ${links.length} distinct event candidate links on SPA calendar.`);
    return links;
  } catch (err) {
    console.error(`⚠️ Error harvesting SPA calendar links: ${err.message}`);
    return [];
  } finally {
    if (stagehand) {
      try {
        await stagehand.close();
      } catch (_) { }
    }
    if (browser) {
      try {
        await browser.close();
      } catch (_) { }
    }
  }
}

const step1aBrowserSemaphore = createSemaphore(
  Number(process.env.VAN50_STEP1A_CONCURRENCY) || 2
);

/**
 * Bounded Parallel Queue Runner: Runs Stagehand Hybrid Ripper with isolated sessions
 * Guarantees zero context bleed, serialized atomic file writes, and deterministic completion.
 */
export async function runCalendarBatch(calendarUrl, options = {}) {
  if (!calendarUrl || calendarUrl === "all" || !calendarUrl.startsWith("http")) {
    calendarUrl = "https://theimprovcentre.ca/shows/";
  }
  const maxEvents = (options.maxEvents !== undefined && options.maxEvents !== null) ? Number(options.maxEvents) : 0;
  const autoApprove = options.autoApprove || false;
  const allowOverviewFallback = options.allowOverviewFallback ?? false;
  const requestedConcurrency = options.concurrency || Number(process.env.VAN50_STEP1A_CONCURRENCY) || 2;
  const concurrency = maxEvents > 0 ? Math.max(1, Math.min(requestedConcurrency, maxEvents)) : Math.max(1, requestedConcurrency);

  console.log(`\n================================================================`);
  console.log(`🚀 STAGEHAND HYBRID CALENDAR BATCH RUNNER (Concurrency: ${concurrency})`);
  console.log(`🎯 Calendar URL: ${calendarUrl}`);
  console.log(`📊 Limit: ${maxEvents > 0 ? `Up to ${maxEvents} events` : 'Unconstrained (harvest all discovered candidate links)'}`);
  console.log(`================================================================\n`);

  const eventLinks = await step1aBrowserSemaphore.run(() => harvestCalendarLinks(calendarUrl));
  if (!eventLinks.length) {
    if (allowOverviewFallback) {
      console.log(`⚠️ No discrete event links detected. Falling back to single-page direct rip...`);
      const card = await step1aBrowserSemaphore.run(() => runHybridRipper(calendarUrl, { autoApprove }));
      if (card && card.title && (card.date || card.dateSchedule)) {
        const evDate = card.date || card.dateSchedule || "TBD";
        const evTime = card.time || card.doors_time || "";
        const evVenue = card.venue || card.venue_name || "Vancouver Venue";
        console.log(`✨ HARVESTED EVENT: "${card.title}" | Date: ${evDate} | Time: ${evTime || "TBD"} | Venue: ${evVenue} | Price: ${card.priceLabel || "$0"} | URL: ${card.ticket_url || calendarUrl || ""} [${card.id}]`);

        // Persist entry to layer_schedules.json atomically via mutex
        const SCHEDULES_PATH = path.join(ROOT_DIR, "data", "layers", "layer_schedules.json");
        try {
          await safeUpdateJsonFile(SCHEDULES_PATH, [], (schedules) => {
            const existingIdx = schedules.findIndex((s) => (s.id || s.event_id) === card.id);
            const schedEntry = {
              id: card.id,
              event_id: card.id,
              title: card.title,
              venue: evVenue,
              date: card.date,
              dateSchedule: card.dateSchedule || card.date,
              time: card.time,
              ticket_url: card.ticket_url || null,
              details_url: card.details_url || calendarUrl || null,
              source_url: calendarUrl,
              description: card.description || null,
              artist: card.artist || null,
              lineup: Array.isArray(card.lineup) ? card.lineup : [],
              category: card.category || null,
              restrictions: card.restrictions || null,
              price: card.price != null ? card.price : null,
              price_base: card.price_base != null ? card.price_base : null,
              price_fee: card.price_fee != null ? card.price_fee : null,
              price_all_in: card.price_all_in != null ? card.price_all_in : null,
              showings: card.showings || [],
              audited_at: new Date().toISOString()
            };
            inspectCardForCandidateLink(schedEntry);
            if (existingIdx !== -1) {
              schedules[existingIdx] = schedEntry;
            } else {
              schedules.push(schedEntry);
            }
            return schedules;
          });
        } catch (saveErr) {
          console.warn(`[WARN] Could not update layer_schedules.json: ${saveErr.message}`);
        }

        return [{
          url: calendarUrl,
          success: true,
          title: card.title,
          date: evDate,
          time: evTime,
          venue: evVenue,
          price: card.priceLabel,
          under50: card.budget_qualified_under_50,
          slug: card.id,
        }];
      }
    } else {
      console.log(`⚠️ No discrete event candidate links discovered on ${calendarUrl}. Skipping feed.`);
    }
    return [];
  }

  const lookup = getExistingCatalogLookup();
  const suppressedLinks = [];
  const freshLinks = [];
  for (const u of eventLinks) {
    const reason = lookup.getUrlSuppressionReason(u);
    if (reason) {
      suppressedLinks.push({ url: u, reason });
    } else {
      freshLinks.push(u);
    }
  }

  console.log(`🔍 Catalog Cross-Reference: ${eventLinks.length} event links discovered (${freshLinks.length} new uncataloged, ${suppressedLinks.length} suppressed/known).`);
  if (suppressedLinks.length > 0) {
    suppressedLinks.forEach(({ url, reason }) => {
      console.log(`   🛡️ [Suppressed Known/Rejected Link] ${url} (${reason})`);
    });
  }

  if (freshLinks.length === 0 && !options.includeExisting) {
    console.log(`ℹ️ [Catalog Match] All ${eventLinks.length} event links on ${calendarUrl} are already active, quarantined, or archived.`);
    if (options.isAllVenuesBatch) {
      console.log(`⏩ Moving to next feed to seek new uncataloged events...`);
    }
    return [];
  }

  // Target exclusively fresh uncataloged links when seeking new events
  const targetCandidates = freshLinks.length > 0 ? freshLinks : (options.includeExisting ? eventLinks : []);
  if (targetCandidates.length === 0) {
    console.log(`ℹ️ No target links to process for this feed. Skipping.`);
    return [];
  }
  const targets = (maxEvents > 0) ? targetCandidates.slice(0, maxEvents) : targetCandidates;
  console.log(`\n📋 Target Queue (${targets.length} NEW uncataloged events${maxEvents > 0 ? `, capped at limit ${maxEvents}` : ' — natural yield'}, concurrency ${concurrency}):`);
  targets.forEach((url, i) => {
    console.log(`   [#${i + 1}] ${url} ✨ (NEW)`);
  });

  const results = [];
  let harvestedNewCount = 0;
  const startTime = Date.now();
  const SCHEDULES_PATH = path.join(ROOT_DIR, "data", "layers", "layer_schedules.json");

  await runWithConcurrency(
    targets,
    concurrency,
    async (targetUrl, i) => {
      if (maxEvents > 0 && harvestedNewCount >= maxEvents) {
        return;
      }

      console.log(`\n────────────────────────────────────────────────────────────────`);
      console.log(`${formatLogTime()} ⚡ Processing [${i + 1}/${targets.length}]: ${targetUrl}`);
      console.log(`────────────────────────────────────────────────────────────────`);

      const itemStartMs = Date.now();
      try {
        // Lightweight HTTP/JSON-LD Pre-Screen (<1s): skip dead 404/410 links and fast-path valid schema.org/Event pages without booting Chromium/LLM
        let card = null;
        try {
          const preRes = await fetch(targetUrl, {
            redirect: "follow",
            signal: AbortSignal.timeout(6000),
            headers: { "User-Agent": STAGE1A_UA, "Accept": "text/html,application/xhtml+xml" },
          });
          if (preRes.status === 404 || preRes.status === 410) {
            console.log(`🩺 [Stage 1A Pre-Screen] Dead link HTTP ${preRes.status} (${targetUrl}) — skipping browser rip.`);
            results.push({ url: targetUrl, success: false, isNew: false, error: `Dead link HTTP ${preRes.status}` });
            return;
          }
          if (preRes.ok) {
            const preHtml = await preRes.text();
            const ldList = extractJsonLdEventsFromHtml(preHtml, preRes.url || targetUrl);
            const todayIsoFast = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
            const validLd = ldList.find((ev) => {
              const rawStart = String(ev.startDate || "").trim();
              if (!ev.name || !ev.venue || !rawStart || /^(?:online|virtual)\b/i.test(ev.venue)) return false;
              let localIso = null;
              if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(rawStart)) {
                const dt = new Date(rawStart);
                if (!Number.isNaN(dt.getTime())) {
                  localIso = dt.toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
                }
              } else {
                const m = rawStart.match(/^(\d{4}-\d{2}-\d{2})/);
                if (m) localIso = m[1];
              }
              return Boolean(localIso && localIso >= todayIsoFast);
            });
            if (validLd) {
              const rawStart = String(validLd.startDate || "").trim();
              let localIso = null;
              let fastTime = "";
              if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(rawStart)) {
                const dt = new Date(rawStart);
                localIso = dt.toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
                if (/T\d{2}:\d{2}/.test(rawStart)) {
                  fastTime = dt.toLocaleTimeString("en-US", { timeZone: "America/Vancouver", hour: "numeric", minute: "2-digit", hour12: true });
                }
              } else {
                const isoM = rawStart.match(/^(\d{4}-\d{2}-\d{2})/);
                localIso = isoM ? isoM[1] : null;
                const timeM = rawStart.match(/T(\d{2}):(\d{2})/);
                if (timeM) {
                  const hh = Number(timeM[1]);
                  const mm = timeM[2];
                  const ampm = hh >= 12 ? "PM" : "AM";
                  const h12 = hh % 12 === 0 ? 12 : hh % 12;
                  fastTime = `${h12}:${mm} ${ampm}`;
                }
              }
              const fastId = generateSlug(validLd.venue, validLd.name, localIso);
              card = {
                id: fastId,
                title: validLd.name,
                venue: validLd.venue,
                venue_name: validLd.venue,
                address: validLd.address || null,
                city: validLd.city || null,
                date: localIso,
                dateSchedule: localIso,
                time: fastTime || null,
                ticket_url: validLd.ticketUrl || null,
                details_url: preRes.url || targetUrl,
                description: validLd.description || null,
                price: null,
                priceLabel: "Pending Box Office QC",
                showings: [{ date: localIso, time: fastTime || null, status: "upcoming" }],
                lifecycle_type: "time_bound_event",
              };
              console.log(`⚡ [Stage 1A JSON-LD Fast-Path] Extracted "${card.title}" @ ${card.venue} (${card.date}${fastTime ? ` ${fastTime}` : ""}) in ${Date.now() - itemStartMs}ms — bypassed Chromium/LLM!`);
            }
          }
        } catch (_) {
          // Non-fatal pre-screen error; fall through to Stagehand Hybrid Ripper
        }

        if (!card) {
          // Discrete execution per event with fresh context, bounded by browser semaphore
          card = await step1aBrowserSemaphore.run(() => runHybridRipper(targetUrl, { autoApprove, fromHarvester: true }));
        }
        const evDate = card.date || card.dateSchedule || "TBD";
        const evTime = card.time || card.doors_time || "";
        const evVenue = card.venue || card.venue_name || "Vancouver Venue";

        const cardIdNorm = (card.id || "").toLowerCase();
        const todayIsoNow = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
        const currentYearMonthNow = todayIsoNow.slice(0, 7);
        const monthMapNow = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
        if (card.lifecycle_type !== "perennial_drop_in") {
          const allShowings = Array.isArray(card.showings) ? card.showings : [];
          const isoShowings = allShowings.filter((sh) => sh && sh.date && /^\d{4}-\d{2}-\d{2}$/.test(sh.date));
          const hasUpcomingShowing = isoShowings.some((sh) => sh.date >= todayIsoNow);
          const rawDateStr = String(card.date || card.dateSchedule || "").trim();
          const isoMatch = rawDateStr.match(/\b(202\d-\d{2}-\d{2})\b/);
          const extractedIso = isoMatch ? isoMatch[1] : null;
          const ymMatch = rawDateStr.match(/^(20\d{2})[-/](0[1-9]|1[0-2]|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i);
          const extractedYm = ymMatch ? `${ymMatch[1]}-${monthMapNow[ymMatch[2].toLowerCase().slice(0, 3)] || ymMatch[2]}` : null;
          const isPre2026YearOnly = /^20(?:1\d|2[0-5])\b/.test(rawDateStr);
          const allSlotsConcluded = allShowings.length > 0 && allShowings.every((sh) => sh && sh.status === "concluded");
          const isMissingDateNonPerennial = !hasUpcomingShowing && (rawDateStr === "none_available" || rawDateStr === "");

          // Normalize non-ISO dates (e.g. "November 19" or "Nov 19, 2026") to strict YYYY-MM-DD
          let normalizedIsoDate = extractedIso;
          if (!normalizedIsoDate && hasUpcomingShowing) {
            const nextSh = isoShowings.filter((sh) => sh.date >= todayIsoNow).sort((a, b) => a.date.localeCompare(b.date))[0];
            if (nextSh) normalizedIsoDate = nextSh.date;
          }
          if (!normalizedIsoDate && rawDateStr) {
            const mdMatch = rawDateStr.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(202\d))?\b/i);
            if (mdMatch) {
              const mm = monthMapNow[mdMatch[1].toLowerCase().slice(0, 3)];
              const dd = String(mdMatch[2]).padStart(2, "0");
              let yyyy = mdMatch[3] || todayIsoNow.slice(0, 4);
              let candidate = `${yyyy}-${mm}-${dd}`;
              if (!mdMatch[3] && candidate < todayIsoNow) {
                candidate = `${Number(yyyy) + 1}-${mm}-${dd}`;
              }
              normalizedIsoDate = candidate;
            }
          }
          if (normalizedIsoDate && /^\d{4}-\d{2}-\d{2}$/.test(normalizedIsoDate)) {
            card.date = normalizedIsoDate;
            if (card.id && /-(?:202\d-\d{2}-\d{2}|\d{1,2})$/.test(card.id)) {
              card.id = card.id.replace(/-(?:202\d-\d{2}-\d{2}|\d{1,2})$/, `-${normalizedIsoDate}`);
            }
          }

          if (
            (normalizedIsoDate && normalizedIsoDate < todayIsoNow && !hasUpcomingShowing) ||
            (isoShowings.length > 0 && !hasUpcomingShowing) ||
            (!hasUpcomingShowing && extractedYm && extractedYm < currentYearMonthNow) ||
            (!hasUpcomingShowing && isPre2026YearOnly) ||
            (!hasUpcomingShowing && allSlotsConcluded) ||
            isMissingDateNonPerennial ||
            (!normalizedIsoDate && !hasUpcomingShowing)
          ) {
            console.log(`🛡️ [Past / Unscheduled / Non-ISO Date Suppressed] "${card.title}" (${normalizedIsoDate || rawDateStr || "none_available"}) lacks a valid upcoming YYYY-MM-DD date (>= ${todayIsoNow}). Suppressing from layer_schedules.json.`);
            results.push({ url: targetUrl, success: false, isNew: false, error: "Concluded, unscheduled, or non-ISO date event" });
            return;
          }
        }

        // Gate 3 Budget Ceiling on Harvest: Reject events already verified > $50.00 CAD single-visit floor
        const harvestedAllIn = Number(card.price_all_in ?? card.price ?? NaN);
        if (!Number.isNaN(harvestedAllIn) && harvestedAllIn > 50 && card.budget_qualified_under_50 === false) {
          console.log(`🛡️ [Gate 3 Budget Ceiling] Suppressing "${card.title}" ($${harvestedAllIn.toFixed(2)} CAD > $50.00 cap) from layer_schedules.json.`);
          results.push({ url: targetUrl, success: false, isNew: false, error: `Budget breach > $50 CAD ($${harvestedAllIn})` });
          return;
        }

        // Check if discovered card is a non-event pricing or admission policy page
        if (lookup.isNonEventPolicyPage(card.title, targetUrl, card.details_url)) {
          console.log(`🛡️ [Non-Event Policy Page Suppressed] "${card.title}" (${targetUrl}) detected as venue pricing/policy page. Suppressing from layer_schedules.json.`);
          results.push({
            url: targetUrl,
            success: false,
            isNew: false,
            error: "Non-event pricing policy page",
          });
          return;
        }

        // Gate 3 Physical Venue & Metro Vancouver Geofence Invariant: Reject raw street addresses, aggregators, placeholder venues, and out-of-market cities
        const cleanVenueStr = String(evVenue || "").trim();
        const geoCheckBlob = `${cleanVenueStr} ${card.address || ""} ${card.full_address || ""} ${card.city || ""} ${card.location || ""} ${targetUrl || ""} ${card.title || ""} ${(card.description || "").slice(0, 300)}`;
        if (
          !cleanVenueStr ||
          /^(?:none_available|search_exhausted_null|quarantine_fatal|online|virtual|zoom|teams|flohockey|flosports|[eé]v[eè]nement\s+en\s+ligne|vancouver|metro\s+vancouver|surrey|burnaby|richmond|victoria|604\s*now|miss604|do604|daily\s*hive|admitone|eventbrite|showpass|vancouver['’]s\s+best\s+places|vancouver\s+rainy\s+day\s+activities)$/i.test(cleanVenueStr) ||
          /^(?:online|virtual)(?:\s*[,(/-]|\s*$)/i.test(cleanVenueStr) ||
          /^(?:various\s+venues|multiple\s+venues)\b/i.test(cleanVenueStr) ||
          /\b(?:flohockey|flosports|online\s+broadcast|online\s+via|via\s+zoom|zoom\s+(?:meeting|webinar)|microsoft\s+teams|google\s+meet|virtual\s+(?:event|session|only))\b/i.test(cleanVenueStr) ||
          /^\d+\s+[A-Za-z0-9\s,.]+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Rd|Road|Way|Hwy|Highway)\b/i.test(cleanVenueStr) ||
          /\b(?:cobble\s+hill|cobblestone\s+pub|capital\s+ballroom|mcpherson\s+playhouse|sea\s+to\s+sky\s+gondola|brackendale|squamish|whistler|chilliwack|abbotsford|nanaimo|kelowna|victoriasbestplaces)\b/i.test(geoCheckBlob) ||
          /\bclosed\s+off\s+(?:specifically\s+)?for\b/i.test(geoCheckBlob)
        ) {
          console.log(`🛡️ [Gate 3 Venue / Geofence Invariant] Suppressing "${card.title}" — invalid/non-physical or out-of-market venue "${cleanVenueStr}" (${targetUrl}).`);
          results.push({
            url: targetUrl,
            success: false,
            isNew: false,
            error: `Gate 3 non-physical, aggregator, or out-of-market venue: ${cleanVenueStr}`,
          });
          return;
        }

        // Check if card is already archived or matches a recurring blacklisted stem
        const cardStemNorm = cardIdNorm.replace(/-(?:202\d-\d{2}-\d{2}|202\d\d{4}|\d{1,2})$/, "");
        const cardIdNoThe = cardIdNorm.replace(/^the-/, "");
        const cardIdWithThe = cardIdNorm.startsWith("the-") ? cardIdNorm : `the-${cardIdNorm}`;
        if (
          lookup.archivedIds.has(cardIdNorm) ||
          lookup.archivedIds.has(cardIdNoThe) ||
          lookup.archivedIds.has(cardIdWithThe) ||
          (lookup.recurringBlacklistStems && lookup.recurringBlacklistStems.has(cardStemNorm))
        ) {
          console.log(`🛡️ [Archived Event Suppressed] "${card.title}" [${card.id}] is permanently archived/disqualified. Suppressing from layer_schedules.json.`);
          results.push({
            url: targetUrl,
            success: false,
            isNew: false,
            error: "Permanently archived event",
          });
          return;
        }

        const normTicketUrlKey = card.ticket_url ? card.ticket_url.split("?")[0].split("#")[0].replace(/\/$/, "").toLowerCase() : null;
        const isAlreadyInCatalog =
          lookup.knownIds.has(cardIdNorm) ||
          lookup.knownIds.has(cardIdNoThe) ||
          lookup.knownIds.has(cardIdWithThe) ||
          (normTicketUrlKey && lookup.knownUrls.has(normTicketUrlKey)) ||
          (card.title && lookup.knownTitles.has(card.title.toLowerCase().trim()) && card.date);

        if (isAlreadyInCatalog) {
          console.log(`ℹ️ [Catalog Match] "${card.title}" (${card.id}) already cataloged — skipping duplicate write to layer_schedules.json.`);
          results.push({
            url: targetUrl,
            success: false,
            isNew: false,
            error: "Already cataloged duplicate",
          });
          return;
        } else {
          console.log(`✨ HARVESTED EVENT: "${card.title}" | Date: ${evDate} | Time: ${evTime || "TBD"} | Venue: ${evVenue} | Price: ${card.priceLabel || "$0"} | URL: ${card.ticket_url || targetUrl || ""} [${card.id}]`);
        }
        logCuratorInfo({ eventId: card.id, title: card.title, venue: evVenue, existingCard: card, prefix: "   " });

        // Persist entry to layer_schedules.json atomically via mutex
        try {
          const resolvedCity = card.city || options.city || inferFeedCity({ venue_name: evVenue, url: targetUrl });
          await safeUpdateJsonFile(SCHEDULES_PATH, [], (schedules) => {
            const normTitleKey = (t) => String(t || "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
            let existingIdx = schedules.findIndex((s) => (s.id || s.event_id) === card.id);
            if (existingIdx === -1 && card.title && card.date) {
              const tKey = normTitleKey(card.title);
              existingIdx = schedules.findIndex((s) => normTitleKey(s.title) === tKey && s.date === card.date);
            }
            const schedEntry = {
              id: card.id,
              event_id: card.id,
              title: card.title,
              venue: evVenue,
              city: resolvedCity,
              region: resolvedCity,
              date: card.date,
              dateSchedule: card.dateSchedule || card.date,
              time: card.time,
              ticket_url: card.ticket_url || null,
              details_url: card.details_url || targetUrl || null,
              source_url: targetUrl,
              description: card.description || null,
              artist: card.artist || null,
              lineup: Array.isArray(card.lineup) ? card.lineup : [],
              category: card.category || null,
              restrictions: card.restrictions || null,
              price: card.price != null ? card.price : null,
              price_base: card.price_base != null ? card.price_base : null,
              price_fee: card.price_fee != null ? card.price_fee : null,
              price_all_in: card.price_all_in != null ? card.price_all_in : null,
              showings: card.showings || [],
              audited_at: new Date().toISOString()
            };
            inspectCardForCandidateLink(schedEntry);
            if (existingIdx !== -1) {
              const prev = schedules[existingIdx];
              const scoreEntry = (rec) =>
                (rec.time && rec.time !== "none_available" && rec.time !== "TBA" ? 2 : 0) +
                (rec.price != null ? 2 : 0) +
                (rec.ticket_url && !/(?:calendar|events\.html|events\/?)$/i.test(rec.ticket_url) ? 3 : 0);
              if ((prev.id || prev.event_id) === card.id || scoreEntry(schedEntry) >= scoreEntry(prev)) {
                schedules[existingIdx] = schedEntry;
              }
            } else {
              schedules.push(schedEntry);
            }
            return schedules;
          });
        } catch (saveErr) {
          console.warn(`[WARN] Could not update layer_schedules.json: ${saveErr.message}`);
        }

        if (!isAlreadyInCatalog) {
          harvestedNewCount++;
        }

        results.push({
          url: targetUrl,
          success: true,
          isNew: !isAlreadyInCatalog,
          title: card.title,
          date: evDate,
          time: evTime,
          venue: evVenue,
          price: card.priceLabel,
          under50: card.budget_qualified_under_50,
          slug: card.id,
        });

        if (maxEvents > 0 && harvestedNewCount >= maxEvents) {
          console.log(`\n🎯 REACHED TARGET CAP: Harvested ${harvestedNewCount} NEW events.`);
        }
      } catch (err) {
        const isTimeoutErr = /timeout|timed out|etimedout/i.test(err.message || "");
        recordPipelineTimeoutEvent({
          eventId: targetUrl,
          eventTitle: targetUrl,
          stage: "Stage 1A: Schedule Harvester",
          model: isAntigravityEngine() ? getAntigravityModel() : "google/gemini-3.8-flash",
          elapsedSec: Math.round((Date.now() - itemStartMs) / 1000),
          timeoutLimitSec: 60,
          isTimeout: isTimeoutErr,
          cause: isTimeoutErr
            ? `Calendar harvester navigation or AI extraction timed out (${err.message})`
            : `Calendar harvester error (${err.message})`,
        });
        console.error(`❌ Failed processing ${targetUrl}: ${err.message}`);
        results.push({
          url: targetUrl,
          success: false,
          isNew: false,
          error: err.message,
        });
      }

      // Gentle backoff per worker between fresh browser instances
      await new Promise((r) => setTimeout(r, 1200));
    },
    {
      staggerMs: 850,
      shouldStop: () => maxEvents > 0 && harvestedNewCount >= maxEvents,
    }
  );

  // STEP 1B: Automatically trigger distinct High-Fidelity Link Tier Upgrader & Hunter pass (unless deferred by All-Feeds batch)
  if (!options.isAllVenuesBatch && options.autoRun1B) {
    try {
      console.log(`\n================================================================`);
      console.log(`⚡ STEP 1A (Calendar Harvest) COMPLETED (${results.length} events processed).`);
      console.log(`🚀 AUTOMATICALLY TRIGGERING STEP 1B (High-Fidelity Link Tier Upgrader)...`);
      console.log(`================================================================`);
      await runStep1BLinkUpgrader(results, options);
    } catch (hunterErr) {
      console.warn(`⚠️ Warning in Step 1B Link Tier Upgrader pass: ${hunterErr.message}`);
    }
  }

  const durationSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n================================================================`);
  console.log(`🏁 BATCH COMPLETED in ${durationSec}s`);
  console.log(`   Total Processed: ${results.length}`);
  console.log(`   Succeeded: ${results.filter((r) => r.success).length}`);
  console.log(`   Failed: ${results.filter((r) => !r.success).length}`);
  printAntigravityTimeoutSummary("Stage 1A: Schedule Harvester");
  console.log(`================================================================\n`);

  return results;
}

/**
 * Infers city ("Surrey" | "Vancouver") from a venue or source record.
 */
const VALID_HARVESTER_CITIES = new Set(["vancouver", "surrey", "burnaby", "richmond", "new-west", "langley"]);

function normalizeHarvesterCityKey(raw = "all") {
  const s = String(raw || "all").trim().toLowerCase();
  if (s === "vancouver" || s === "van") return "vancouver";
  if (s === "surrey" || s === "white rock") return "surrey";
  if (s === "burnaby") return "burnaby";
  if (s === "richmond") return "richmond";
  if (s === "new-west" || s === "new west" || s === "newwest" || s === "new westminster" || s === "new-westminster") return "new-west";
  if (s === "langley" || s === "fort langley" || s === "city of langley" || s === "township of langley") return "langley";
  return "all";
}

export function inferFeedCity(item = {}) {
  const explicit = normalizeHarvesterCityKey(item.region || item.city || "");
  if (explicit === "surrey") return "Surrey";
  if (explicit === "burnaby") return "Burnaby";
  if (explicit === "richmond") return "Richmond";
  if (explicit === "new-west") return "New West";
  if (explicit === "langley") return "Langley";
  if (explicit === "vancouver") return "Vancouver";
  const blob = `${item.venue_name || ""} ${item.name || ""} ${item.neighborhood || ""} ${item.full_address || ""} ${item.address || ""} ${item.url || ""} ${item.calendar_url || ""} ${item.website_url || ""}`.toLowerCase();
  if (/\b(langley|fort langley|willoughby|walnut grove|murrayville|brookswood|aldergrove|bezartshub|langleyeventscentre|canadianflight|salishanculturalcentre|farmcountrybrewing|campbeer|tradingpostbrewing|fiveroadsbrewing|deadfrog|brookswoodbrewing|smugglers-trail|localitybrewing|fraservalleycider|festinalente|langleyrivermen|langleytrappers|langleyrams|vancouverbandits)\b/i.test(blob)) {
    return "Langley";
  }
  if (/\b(burnaby|metrotown|brentwood|lougheed|deer lake|edmonds|shadboltcentre|michaeljfoxtheatre|burnabyvillagemuseum|burnabyartgallery|nikkeiplace|deerlakegallery|gibson\.sfu|dageraadbrewing|studiobrewing|admiralpub|greatbearpub|scandinaviancentre|burnabysymphony|burnabylakers|burnabysteelers|athletics\.sfu|northroadbia)\b/i.test(blob)) {
    return "Burnaby";
  }
  if (/\b(richmond|steveston|brighouse|lansdowne|ironwood|minoru|gatewaytheatre|richmondartgallery|richmondartscoalition|lipontplace|richmondoval|stevestonheritage|gulfofgeorgiacannery|roca\.ca|londonfarm|swingoutrichmond|bbco\.ca|monkey9brewing|ohares\.pub|buckandear|countryvines|luluislandwinery|richmondsockeyes|sharingfarm|urbanbounty|sfam\.ca)\b/i.test(blob)) {
    return "Richmond";
  }
  if (/\b(new westminster|new west|sapperton|queensborough|anvilcentre|anviltheatre|masseytheatre|vagabondplayers|royalcitymusicaltheatre|douglascollege|artsnewwest|fraserriverdiscovery|nwheritage|rivermarket|bullystudios|moodswingbar|raincitygames|steelandoak|abcbrewing|georgieslocal|paddlewheelerpub|salmonbellies|douglasroyals)\b/i.test(blob)) {
    return "New West";
  }
  const surreyTokens = [
    "surrey", "whalley", "guildford", "fleetwood", "newton", "cloverdale",
    "bear creek", "panorama", "crescent beach", "grandview", "fraser downs",
    "fraser heights", "bridgeview", "clayton", "sullivan heights",
    "bellperformingartscentre", "discoversurreybc", "surreylibraries",
    "surreycivictheatres", "surreyeagles", "surreyknights", "russellbeer",
    "dublincrossing", "artscouncilofsurrey", "cravingforagame",
    "projectclimbing", "centralcityfunpark", "birdiesandbuckets",
    "delllanes", "vinoscentivineyards", "downtownsurreybia",
    "cloverdalebia", "newtonbia", "fleetwoodbia", "surreyschools",
    "sswrchamber", "surreynowleader", "peacearchnews", "cloverdalereporter",
    "allevents.in/surrey", "admitone.com/events/surrey", "cloverdalerodeo",
    "artsculture.surrey", "cloverdalemarket", "surreymarket",
    "guildfordtowncentre", "centralcity.ca", "legion240", "sfu.ca/surrey",
    "kpu.ca", "r/surreybc", "vancouverfc", "businessinsurrey",
    "galint.gg", "pataka-esports", "salaamevents.com/ramadanfest",
    "wakeupmusicfestival", "rango-ki-holi", "surreyfestival",
    "surreyvaisakhiparade", "partyfortheplanet", "5xfest",
    "purchase.surrey.ca", "cloverdale-ae", "alexhouse.net",
    "carfree.ca/city/surrey", "surreypride", "surreyfest",
    "surreycanadaday", "fvdedinthepark", "canadacup.com",
    "fvhrs.org", "surreyfusionfestival", "naijafoodfest",
    "bchra.ca", "bcvintagetruckmuseum", "surreygreekfoodfest",
    "penmar.ca", "newvisionmusicsociety", "folkstaracademy",
    "dartshill.ca", "isaff.ca", "worldfolkfestival",
    "cougarcreekhouseofhorrors", "bctrains.com", "bearcreektickets",
    "diwalifest.ca", "surreytreelighting", "noelfestival"
  ];
  if (surreyTokens.some((tok) => blob.includes(tok))) return "Surrey";
  return "Vancouver";
}

function normalizeCrawlerFeedUrl(u = "") {
  return String(u || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?/, "")
    .replace(/\/+$/, "");
}

function isExcludedCrawlerFeedUrl(u = "") {
  const s = String(u || "").trim();
  if (!s || !s.startsWith("http")) return true;
  // Test fixtures, permanently closed venues, and social/forum login walls
  if (/127\.0\.0\.1|localhost|example\.com|testcellar|anzaclub\.org|instagram\.com|reddit\.com|facebook\.com|tiktok\.com/i.test(s)) {
    return true;
  }
  // Unfiltered national/global ticketing root homepages (keep venue/city-scoped subpaths)
  if (/^https?:\/\/(?:www\.)?(?:showpass|ticketweb|tickettailor|universe|vtixonline|zeffy|humanitix|orangetickets|eventbrite)\.(?:com|ca)\/?$/i.test(s)) {
    return true;
  }
  // High-noise school district, student-admin, and community-centre rental/rec portals
  if (/champlainheightscc\.ca|vanrec\.ca\/?$|surreyschools\.ca|kpu\.ca\/events|sfu\.ca\/surrey|ams\.ubc\.ca\/student-life\/events/i.test(s)) {
    return true;
  }
  // Static perennial parks, beaches, pitch-and-putts, and destination guides (grounded via venue_detailer.js, not event calendars)
  if (/parks-recreation\/parks\/|pitch-putt|pitch-and-putt|\/roofgarden|\/ubc-rose-garden|\/listings\/kitsilano-beach-park|\/listings\/queen-elizabeth-park|\/listings\/stanley-park|destinationvancouver\.com\/(?:activities\/free-and-nearly-free|things-to-do\/?$|inspirations\/golf\/)|^https?:\/\/(?:www\.)?(?:dartshill\.ca|vandusengarden\.org|ecologycentre\.ca)\/?$/i.test(s)) {
    return true;
  }
  return false;
}

/**
 * All Venue Feeds Harvester: Iterates through registered venue feeds from venues.json
 * and discovery/reference sources, supporting single-city scanning (Vancouver or Surrey) or All Metro.
 */
export async function runAllVenueFeedsBatch(options = {}) {
  const VENUES_PATH = path.join(ROOT_DIR, "data", "venues.json");
  const DISCOVERY_SOURCES_PATH = path.join(ROOT_DIR, "data", "discovery_sources.json");
  const SURREY_SOURCES_PATH = path.join(ROOT_DIR, "data", "surrey_reference_sources.json");
  let venues = [];
  try {
    if (fs.existsSync(VENUES_PATH)) {
      venues = JSON.parse(fs.readFileSync(VENUES_PATH, "utf-8"));
    }
  } catch (err) {
    console.warn(`[WARN] Could not read venues.json: ${err.message}`);
  }

  const cityScope = normalizeHarvesterCityKey(options.city || "all");

  const seenUrls = new Set();
  const allFeeds = [];
  for (const v of venues) {
    if (v.is_test_canary) continue;
    // Skip perennial drop-in parks/beaches/open public spaces (handled by venue_detailer.js, not calendar_harvester.js)
    if (v.access_model === "open_public_space" || v.lifecycle_type === "perennial_drop_in") continue;
    const vName = (v.venue_name || v.name || "").trim();
    if (!vName) continue;
    const curatorInfo = getCuratorInfo({ venue: vName });
    // Use venue-level learned calendar link or venue calendar/website URL (never single-event instructedUrl)
    const url = (curatorInfo.learnedVenueUrl || v.calendar_url || v.calendarUrl || v.website_url || v.websiteUrl || "").trim();
    const norm = normalizeCrawlerFeedUrl(url);
    if (!isExcludedCrawlerFeedUrl(url) && norm && !seenUrls.has(norm)) {
      seenUrls.add(norm);
      allFeeds.push({
        name: vName,
        url,
        city: inferFeedCity({ ...v, url })
      });
    }
  }

  // Include primary high-yield performing arts seeds if not present
  const seedFeeds = [
    { name: "Little Mountain Gallery", url: "https://www.showpass.com/o/little-mountain-gallery/", city: "Vancouver" },
    { name: "The Rio Theatre", url: "https://riotheatre.ca/calendar/", city: "Vancouver" },
    { name: "The Cultch", url: "https://thecultch.com/whats-on/", city: "Vancouver" },
    { name: "Tightrope Impro Theatre", url: "https://tightropetheatre.com/shows", city: "Vancouver" },
    { name: "The Rickshaw Theatre", url: "https://rickshawtheatre.com/events/", city: "Vancouver" },
    { name: "The Fox Cabaret", url: "https://www.foxcabaret.com/calendar", city: "Vancouver" },
    { name: "VIFF Centre", url: "https://viff.org/whats-on/", city: "Vancouver" },
    { name: "Firehall Arts Centre", url: "https://www.firehallartscentre.ca/whats-on/", city: "Vancouver" },
    { name: "The Improv Centre", url: "https://theimprovcentre.ca/shows/", city: "Vancouver" }
  ];
  for (const s of seedFeeds) {
    const norm = normalizeCrawlerFeedUrl(s.url);
    if (!isExcludedCrawlerFeedUrl(s.url) && norm && !seenUrls.has(norm)) {
      seenUrls.add(norm);
      allFeeds.push(s);
    }
  }

  // Include verified regional & Vancouver discovery sources
  try {
    if (fs.existsSync(DISCOVERY_SOURCES_PATH)) {
      const discRaw = JSON.parse(fs.readFileSync(DISCOVERY_SOURCES_PATH, "utf-8"));
      const discSources = Array.isArray(discRaw) ? discRaw : (discRaw.sources || []);
      for (const s of discSources) {
        if (s.id === "testy-canary-feed" || s.type === "canary_test_feed" || s.is_test_canary) continue;
        if (["waf_blocked", "timeout_unreachable", "inactive", "disabled"].includes(String(s.status || "").toLowerCase())) continue;
        const sName = (s.name || s.id || "").trim();
        const u = (s.eventsUrl || s.calendarUrl || s.url || "").trim();
        const norm = normalizeCrawlerFeedUrl(u);
        if (sName && !isExcludedCrawlerFeedUrl(u) && norm && !seenUrls.has(norm)) {
          seenUrls.add(norm);
          allFeeds.push({
            name: sName,
            url: u,
            city: inferFeedCity({ ...s, url: u })
          });
        }
      }
    }
  } catch (dErr) {
    console.warn(`[WARN] Could not read discovery_sources.json: ${dErr.message}`);
  }

  // Include verified Surrey reference sources
  try {
    if (fs.existsSync(SURREY_SOURCES_PATH)) {
      const surreyRef = JSON.parse(fs.readFileSync(SURREY_SOURCES_PATH, "utf-8"));
      const surreySources = Array.isArray(surreyRef) ? surreyRef : (surreyRef.sources || []);
      for (const s of surreySources) {
        if (s.is_test_canary) continue;
        const sName = (s.name || s.id || "").trim();
        const u = (s.url || "").trim();
        const norm = normalizeCrawlerFeedUrl(u);
        if (sName && !isExcludedCrawlerFeedUrl(u) && norm && !seenUrls.has(norm)) {
          seenUrls.add(norm);
          allFeeds.push({
            name: sName,
            url: u,
            city: "Surrey"
          });
        }
      }
    }
  } catch (sErr) {
    console.warn(`[WARN] Could not read surrey_reference_sources.json: ${sErr.message}`);
  }

  function scoreFeedPriority(feed) {
    let score = 0;
    const u = (feed.url || "").toLowerCase();
    const n = (feed.name || "").toLowerCase();

    // Active ticketing platforms with individual show links
    if (u.includes("showpass.com") || u.includes("eventive.org") || u.includes("ticketweb.ca")) score += 100;

    // Dedicated cultural & live performance venues
    if (u.includes("littlemountaingallery.ca") || n.includes("little mountain")) score += 95;
    if (u.includes("riotheatre.ca") || n.includes("rio theatre")) score += 90;
    if (u.includes("thecultch.com") || n.includes("cultch")) score += 85;
    if (u.includes("tightropetheatre.com") || n.includes("tightrope")) score += 80;
    if (u.includes("rickshawtheatre.com") || n.includes("rickshaw")) score += 80;
    if (u.includes("foxcabaret.com") || n.includes("fox cabaret")) score += 75;
    if (u.includes("biltmorecabaret.com") || n.includes("biltmore")) score += 75;
    if (u.includes("viff.org") || n.includes("viff")) score += 70;
    if (u.includes("firehallartscentre.ca") || n.includes("firehall")) score += 70;
    if (u.includes("bellperformingartscentre.com") || u.includes("surrey-civic-theatres") || u.includes("discoversurreybc.com")) score += 85;

    // Explicit calendar / schedule / show paths
    if (u.includes("/schedule") || u.includes("/calendar") || u.includes("/whats-on") || u.includes("/shows") || u.includes("/events")) score += 40;

    // Performing arts name indicators
    if (/theatre|gallery|comedy|improv|music|club|centre|cabaret|cinema|hall/i.test(n)) score += 25;

    // Deprioritize outdoor parks, municipal libraries, general gardens
    if (/park|beach|trail|seawall|garden|greenhouse|conservatory|library/i.test(n)) score -= 60;
    if (u.includes("destinationvancouver.com") || u.includes("ecologycentre.ca") || u.includes("vpl.ca") || u.includes("vancouver.ca/parks")) score -= 70;

    return score;
  }

  // Drop redundant bare root homepages (e.g. riotheatre.ca/) when a dedicated subpath feed exists for the same host (e.g. riotheatre.ca/calendar/)
  const hostsWithSubpath = new Set();
  for (const f of allFeeds) {
    try {
      const uo = new URL(f.url);
      const host = uo.hostname.replace(/^www\./, "").toLowerCase();
      if (uo.pathname && uo.pathname !== "/") {
        hostsWithSubpath.add(host);
      }
    } catch { }
  }
  const dedupedFeeds = allFeeds.filter((f) => {
    try {
      const uo = new URL(f.url);
      const host = uo.hostname.replace(/^www\./, "").toLowerCase();
      const isBareRoot = !uo.pathname || uo.pathname === "/";
      if (isBareRoot && hostsWithSubpath.has(host)) return false;
    } catch { }
    return true;
  });
  allFeeds.length = 0;
  allFeeds.push(...dedupedFeeds);

  allFeeds.sort((a, b) => (scoreFeedPriority(b) - scoreFeedPriority(a)) || String(a.name || "").localeCompare(String(b.name || "")));

  // Filter feeds by requested single city ("vancouver" | "surrey" | "burnaby" | "richmond" | "new-west" | "langley") or keep all ("all")
  const feeds = cityScope === "all"
    ? allFeeds
    : allFeeds.filter((f) => normalizeHarvesterCityKey(f.city || "Vancouver") === cityScope);

  const maxTotalEvents = (options.maxEvents !== undefined && options.maxEvents !== null) ? Number(options.maxEvents) : 0;
  const isResume = Boolean(options.resume);
  const CHECKPOINT_PATH = path.join(ROOT_DIR, "data", "layers", "harvester_checkpoint.json");

  let completedFeedUrls = new Set();
  let completedNormUrls = new Set();
  let startFeedIndex = 0;
  let priorEventsHarvested = 0;

  if (fs.existsSync(CHECKPOINT_PATH)) {
    try {
      const cp = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf-8"));
      const rawCompleted = Array.isArray(cp.completed_feed_urls) ? cp.completed_feed_urls : [];
      const scopeNormSet = new Set(feeds.map((f) => normalizeCrawlerFeedUrl(f.url)).filter(Boolean));
      if (isResume) {
        const matchingCompletedCount = feeds.filter((f) => {
          const nf = normalizeCrawlerFeedUrl(f.url);
          return nf && rawCompleted.some((u) => normalizeCrawlerFeedUrl(u) === nf);
        }).length;
        // Only treat as already 100% completed if every feed in the current scope was already scanned
        if (matchingCompletedCount < feeds.length) {
          rawCompleted.forEach((u) => {
            completedFeedUrls.add(u);
            const nu = normalizeCrawlerFeedUrl(u);
            if (nu) completedNormUrls.add(nu);
          });
          const firstUnscannedIdx = feeds.findIndex((f) => !completedNormUrls.has(normalizeCrawlerFeedUrl(f.url)));
          startFeedIndex = firstUnscannedIdx >= 0 ? firstUnscannedIdx : 0;
          priorEventsHarvested = Number(cp.events_harvested_in_run) || 0;
        } else if (cityScope !== "all") {
          // Preserve other city's completed URLs when restarting a completed single-city scope
          rawCompleted.forEach((u) => {
            const nu = normalizeCrawlerFeedUrl(u);
            if (nu && !scopeNormSet.has(nu)) {
              completedFeedUrls.add(u);
              completedNormUrls.add(nu);
            }
          });
        }
      } else if (cityScope !== "all") {
        // Fresh pass on a single city: clear only this city's URLs while preserving other city's progress
        rawCompleted.forEach((u) => {
          const nu = normalizeCrawlerFeedUrl(u);
          if (nu && !scopeNormSet.has(nu)) {
            completedFeedUrls.add(u);
            completedNormUrls.add(nu);
          }
        });
      }
    } catch (cpErr) {
      console.warn(`[WARN] Could not read harvester_checkpoint.json: ${cpErr.message}`);
    }
  }

  let totalHarvestedEvents = 0;
  const CITY_LABELS = {
    vancouver: "🏙️ VANCOUVER ONLY",
    surrey: "🦌 SURREY ONLY",
    burnaby: "🏔️ BURNABY ONLY",
    richmond: "🌊 RICHMOND ONLY",
    "new-west": "⚓ NEW WEST ONLY",
    langley: "🐎 LANGLEY ONLY",
    all: "🌲 ALL METRO (6 CITIES)"
  };
  const cityLabel = CITY_LABELS[cityScope] || CITY_LABELS.all;

  const initialScannedInScope = feeds.filter((f) => completedNormUrls.has(normalizeCrawlerFeedUrl(f.url))).length;
  console.log(`\n================================================================`);
  console.log(`🌐 STEP 1A CALENDAR HARVESTER — [${cityLabel}]${isResume ? " (RESUMING FROM CHECKPOINT)" : ""}`);
  console.log(`📊 Prioritized ${feeds.length} source feeds for ${cityLabel} (from ${allFeeds.length} total registered sources)`);
  if (isResume && initialScannedInScope > 0) {
    console.log(`⏩ [Resume Mode] ${initialScannedInScope}/${feeds.length} feeds already scanned — continuing at Source #${Math.min(feeds.length, initialScannedInScope + 1)}/${feeds.length}: ${feeds[startFeedIndex]?.name || "Next Feed"}`);
  }
  if (maxTotalEvents > 0) {
    console.log(`🎯 Target Event Cap: Exactly ${maxTotalEvents} events total across feeds`);
  } else {
    console.log(`🎯 Scope: Unconstrained full catalog crawl for ${cityLabel}`);
  }
  console.log(`================================================================\n`);

  const allResults = [];

  for (let i = 0; i < feeds.length; i++) {
    const feed = feeds[i];
    const normFeedUrl = normalizeCrawlerFeedUrl(feed.url);
    if (isResume && normFeedUrl && completedNormUrls.has(normFeedUrl)) {
      continue;
    }

    if (maxTotalEvents > 0 && totalHarvestedEvents >= maxTotalEvents) {
      console.log(`\n🎯 REACHED TARGET LIMIT: Successfully harvested ${totalHarvestedEvents}/${maxTotalEvents} discrete events.`);
      break;
    }

    const needed = maxTotalEvents > 0 ? (maxTotalEvents - totalHarvestedEvents) : 0;
    const scannedInScopeBefore = feeds.filter((f) => completedNormUrls.has(normalizeCrawlerFeedUrl(f.url))).length;
    const activeSourceNum = Math.min(feeds.length, scannedInScopeBefore + 1);

    // Persist checkpoint as we begin this feed so stopping mid-feed resumes right here
    try {
      await safeUpdateJsonFile(CHECKPOINT_PATH, {}, (cp) => ({
        ...cp,
        status: "running",
        city_scope: cityScope,
        total_feeds: feeds.length,
        completed_feeds_count: scannedInScopeBefore,
        resume_from_index: i,
        resume_from_feed_number: activeSourceNum,
        last_feed_name: feed.name,
        last_feed_url: feed.url,
        last_feed_city: feed.city,
        completed_feed_urls: Array.from(completedFeedUrls),
        events_harvested_in_run: priorEventsHarvested + totalHarvestedEvents,
        updated_at: new Date().toISOString(),
      }));
    } catch (_) { }

    console.log(`\n────────────────────────────────────────────────────────────────`);
    console.log(`${formatLogTime()} 🏛️ [${activeSourceNum}/${feeds.length}] [${feed.city}] Source Feed: ${feed.name}`);
    console.log(`🎯 URL: ${feed.url}`);
    logCuratorInfo({ venue: feed.name, prefix: "   " });
    if (maxTotalEvents > 0) {
      console.log(`📊 Progress: ${totalHarvestedEvents}/${maxTotalEvents} events harvested (${needed} more needed)`);
    }
    console.log(`────────────────────────────────────────────────────────────────`);

    try {
      const res = await runCalendarBatch(feed.url, { ...options, city: feed.city, maxEvents: needed, allowOverviewFallback: false, isAllVenuesBatch: true });
      const succeededNew = Array.isArray(res) ? res.filter((r) => r && r.success && r.isNew).length : 0;
      const succeededTotal = Array.isArray(res) ? res.filter((r) => r && r.success).length : 0;
      totalHarvestedEvents += succeededNew;
      allResults.push({ venue: feed.name, city: feed.city, url: feed.url, results: res, harvestedCount: succeededNew, totalProcessed: succeededTotal });
      if (succeededNew > 0) {
        console.log(`✨ [Feed Yield] Harvested ${succeededNew} NEW event(s) from ${feed.name} [${feed.city}] (${totalHarvestedEvents}/${maxTotalEvents} total target collected).`);
      }

      const hitCapOnFeed = maxTotalEvents > 0 && totalHarvestedEvents >= maxTotalEvents;
      // Mark feed completed if we weren't halted early by maxTotalEvents cap
      if (!hitCapOnFeed) {
        completedFeedUrls.add(feed.url);
        if (normFeedUrl) completedNormUrls.add(normFeedUrl);
      }
      const scannedInScopeAfter = feeds.filter((f) => completedNormUrls.has(normalizeCrawlerFeedUrl(f.url))).length;
      if (!hitCapOnFeed) {
        console.log(`✅ [Source Completed] ${scannedInScopeAfter}/${feeds.length} sources scanned (${feed.name})`);
      }
      const nextUnscannedIdx = hitCapOnFeed
        ? i
        : feeds.findIndex((f) => !completedNormUrls.has(normalizeCrawlerFeedUrl(f.url)));
      const isScopeComplete = nextUnscannedIdx === -1 && scannedInScopeAfter >= feeds.length;
      const resolvedNextIdx = nextUnscannedIdx >= 0 ? nextUnscannedIdx : 0;
      const resolvedResumeNum = isScopeComplete ? 1 : Math.min(feeds.length, scannedInScopeAfter + 1);
      try {
        await safeUpdateJsonFile(CHECKPOINT_PATH, {}, (cp) => ({
          ...cp,
          status: isScopeComplete ? "completed" : "paused",
          city_scope: cityScope,
          total_feeds: feeds.length,
          completed_feeds_count: scannedInScopeAfter,
          resume_from_index: resolvedNextIdx,
          resume_from_feed_number: resolvedResumeNum,
          last_feed_name: feeds[resolvedNextIdx]?.name || feed.name,
          last_feed_url: feeds[resolvedNextIdx]?.url || feed.url,
          last_feed_city: feeds[resolvedNextIdx]?.city || feed.city,
          completed_feed_urls: Array.from(completedFeedUrls),
          events_harvested_in_run: priorEventsHarvested + totalHarvestedEvents,
          updated_at: new Date().toISOString(),
        }));
      } catch (_) { }
    } catch (feedErr) {
      console.error(`❌ Error harvesting feed ${feed.name}: ${feedErr.message}`);
    }

    if (maxTotalEvents > 0 && totalHarvestedEvents >= maxTotalEvents) {
      console.log(`\n🎯 REACHED TARGET LIMIT: Successfully harvested ${totalHarvestedEvents}/${maxTotalEvents} NEW discrete events.`);
      break;
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  // STEP 1B: Automatically trigger distinct High-Fidelity Link Tier Upgrader & Hunter pass across all feeds (only when explicitly requested)
  if (options.autoRun1B) {
    try {
      console.log(`\n================================================================`);
      console.log(`⚡ STEP 1A (All Feeds Harvest — ${cityLabel}) COMPLETED (${totalHarvestedEvents} events discovered).`);
      console.log(`🚀 AUTOMATICALLY TRIGGERING STEP 1B (High-Fidelity Link Tier Upgrader)...`);
      console.log(`================================================================`);
      const allDiscovered = allResults.flatMap((r) => r.results || []);
      await runStep1BLinkUpgrader(allDiscovered, options);
    } catch (hunterErr) {
      console.warn(`⚠️ Warning in Step 1B Link Tier Upgrader pass: ${hunterErr.message}`);
    }
  }

  return allResults;
}

// CLI Entrypoint
if (process.argv[1] && process.argv[1].endsWith("calendar_harvester.js")) {
  const cliArgs = process.argv.slice(2);
  const isResumeCli = cliArgs.includes("--resume");
  let cliCity = null;
  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];
    if (arg.startsWith("--city=")) {
      cliCity = arg.split("=")[1]?.trim().toLowerCase() || null;
    } else if (arg === "--city" && cliArgs[i + 1]) {
      cliCity = cliArgs[i + 1].trim().toLowerCase();
    }
  }

  const positional = cliArgs.filter((a, idx) => !a.startsWith("--") && (idx === 0 || cliArgs[idx - 1] !== "--city"));
  const targetCal = (positional[0] || "").trim();
  const rawMax = positional[1];
  const max = (rawMax !== undefined && rawMax !== "") ? parseInt(rawMax, 10) : 0;

  const normTarget = targetCal.toLowerCase();
  const strippedTarget = normTarget.replace(/^all:/, "").replace(/:resume$/, "");
  const isBatchTarget =
    !normTarget ||
    normTarget === "all" ||
    normTarget === "all:resume" ||
    VALID_HARVESTER_CITIES.has(strippedTarget);

  if (isBatchTarget) {
    const isResumeTarget = normTarget.endsWith(":resume") || isResumeCli;
    let resolvedCity = normalizeHarvesterCityKey(cliCity || "all");
    if (VALID_HARVESTER_CITIES.has(strippedTarget)) {
      resolvedCity = strippedTarget;
    }

    runAllVenueFeedsBatch({ maxEvents: max, resume: isResumeTarget, city: resolvedCity })
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(`💥 All Feeds Harvester Error: ${err.message}`);
        process.exit(1);
      });
  } else {
    runCalendarBatch(targetCal, { maxEvents: max, resume: isResumeCli, city: cliCity })
      .then(() => process.exit(0))
      .catch((err) => {
        console.error(`💥 Batch Harvester Error: ${err.message}`);
        process.exit(1);
      });
  }
}
