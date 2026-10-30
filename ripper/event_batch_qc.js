import dotenv from "dotenv";
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";
import {
  SingleEventExtractionSchema,
  hydrateVenueDimensions,
  buildFullDimensions,
  normalizeDate,
  generateSlug,
  isValidDeepLink,
} from "./hybrid_ripper.js";
import { inspectCardForCandidateLink, isWhitelistedTicketingUrl, LOW_SALIENCE_WORDS } from "./link_upgrader.js";
import { scanSingleLinkHealth } from "./link_health_scanner.js";
import { huntTier1LinkForEvent } from "./tier1_hunter.js";
import { logCuratorInfo, getCuratorInfo } from "./curator_display.js";
import {
  isAntigravityEngine,
  callAntigravityBoxOfficeExtractor,
  getAntigravityModel,
  recordPipelineTimeoutEvent,
  printAntigravityTimeoutSummary,
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
const DATA_DIR = path.join(ROOT_DIR, "data");
const EVENTS_PATH = path.join(DATA_DIR, "events.json");
const VENUES_PATH = path.join(DATA_DIR, "venues.json");
const QUEUE_PATH = path.join(DATA_DIR, "manual_review_queue.json");
const PROOFS_DIR = path.join(DATA_DIR, "proof_keyframes");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const LEDGER_PATH = path.join(DATA_DIR, "scout_target_ledger.json");
const BENCHMARKS_PATH = path.join(DATA_DIR, "ai_runtime_benchmarks.json");

// Ensure directories exist
if (!fs.existsSync(PROOFS_DIR)) fs.mkdirSync(PROOFS_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

/**
 * Creates safety backup before starting batch operations
 */
function createSafetyBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `events_pre_stagehand_qc_${ts}.json`);
  if (fs.existsSync(EVENTS_PATH)) {
    fs.copyFileSync(EVENTS_PATH, backupPath);
    console.log(`🛡️ Safety backup created: ${path.basename(backupPath)}`);
  }
}

/**
 * Checks if a loaded page is a 404, soft-404, parked domain, or Rickroll
 */
export function checkPageDeadOr404(pageInfo) {
  const { title = "", text = "", url = "", httpStatus = 200 } = pageInfo;

  if (httpStatus >= 400) {
    return { isDead: true, reason: `HTTP ${httpStatus} error response` };
  }

  const lowerTitle = (title || "").toLowerCase();
  const lowerText = (text || "").toLowerCase();
  const lowerUrl = (url || "").toLowerCase();

  if (
    lowerUrl.endsWith("/404") ||
    lowerUrl.endsWith("/404/") ||
    lowerUrl.includes("/error/") ||
    lowerUrl.includes("/not-found") ||
    lowerUrl.includes("/page-not-found")
  ) {
    return { isDead: true, reason: "Redirected to explicit 404/not-found path" };
  }

  const deadTitlePhrases = [
    "404",
    "not found",
    "page not found",
    "event not found",
    "error 404",
    "oops",
    "410 gone",
    "access denied",
    "cannot be found",
    "does not exist",
    "doesn't exist"
  ];
  for (const phrase of deadTitlePhrases) {
    if (lowerTitle.includes(phrase)) {
      return { isDead: true, reason: `Page title indicates dead page: "${phrase}"` };
    }
  }

  const deadBodyPhrases = [
    "this page could not be found",
    "this page can’t be found",
    "this page cannot be found",
    "page doesn't exist",
    "page does not exist",
    "page that doesn't exist",
    "arrived here from a page that doesn't exist",
    "event not found",
    "cannot be located",
    "well, this is awkward",
    "domain has expired",
    "never gonna give you up",
    "rick astley",
    "the requested url was not found",
    "this page has moved or no longer exists",
    "sorry, we couldn't find that page",
    "sorry, the page you are looking for",
    "nothing found for this query",
    "suspended domain",
    "domain for sale",
    "buy this domain",
    "this event is no longer available"
  ];
  for (const phrase of deadBodyPhrases) {
    if (lowerText.includes(phrase)) {
      return { isDead: true, reason: `Page content contains dead indicator: "${phrase}"` };
    }
  }

  return { isDead: false, reason: null };
}

/**
 * Validates Gate 5: Checks if page content actually pertains to the target event
 * Uses Weighted Specificity (High-Salience distinctive tokens = 3x, Low-Salience calendar words = 1x)
 * and Multi-Entity Quorum Scoring (Title + Venue + Date + Commercial Anchors)
 */
export function checkEntityMatchesPage(expectedTitle, pageTitle, pageText, options = {}) {
  if (!expectedTitle || expectedTitle.trim().length === 0) {
    return { matches: true, reason: "No expected title to match" };
  }

  const stopWords = new Set([
    "the", "and", "with", "from", "for", "theatre", "theater", "presents",
    "production", "vancouver", "show", "live", "stage", "play", "season",
    "annual", "festival", "society", "company", "event", "tickets", "admission",
    "2024", "2025", "2026", "2027", "canada", "bc", "british", "columbia"
  ]);

  const rawTokens = expectedTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !stopWords.has(t));

  if (rawTokens.length === 0) {
    return { matches: true, reason: "No distinctive tokens in expected title" };
  }

  const haystack = `${pageTitle || ""} ${pageText || ""}`.toLowerCase();

  // 1. Title Token Salience Weighting
  let totalWeight = 0;
  let matchedWeight = 0;
  const highSalienceTokens = [];
  const matchedHighSalience = [];
  const matchedTokens = [];

  for (const t of rawTokens) {
    const isLowSalience = LOW_SALIENCE_WORDS.has(t);
    const weight = isLowSalience ? 1 : 3;
    totalWeight += weight;

    if (!isLowSalience) {
      highSalienceTokens.push(t);
    }

    if (haystack.includes(t)) {
      matchedWeight += weight;
      matchedTokens.push(t);
      if (!isLowSalience) {
        matchedHighSalience.push(t);
      }
    }
  }

  const titleScore = totalWeight > 0 ? matchedWeight / totalWeight : 0;
  // If distinctive high-salience tokens exist, at least one high-salience token MUST match
  const highSaliencePass = highSalienceTokens.length === 0 || matchedHighSalience.length >= 1;

  // 2. Venue Anchor Scoring
  let venueScore = 0;
  const venueQuery = options.venue || options.venueName || options.card?.venue || options.card?.venue_name || "";
  if (venueQuery) {
    const venueTokens = venueQuery
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !stopWords.has(t));
    const matchedVenue = venueTokens.filter((vt) => haystack.includes(vt));
    if (venueTokens.length > 0 && matchedVenue.length / venueTokens.length >= 0.5) {
      venueScore = 1.0;
    }
  }

  // 3. Date Anchor Scoring
  let dateScore = 0;
  const dateQuery = options.date || options.card?.date || "";
  if (dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)) {
    const [y, m, d] = dateQuery.split("-");
    const monthNames = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const mName = monthNames[parseInt(m, 10) - 1] || "";
    const dayNum = String(parseInt(d, 10));
    if (haystack.includes(dateQuery) || (mName && haystack.includes(mName) && haystack.includes(dayNum))) {
      dateScore = 1.0;
    }
  }

  // 4. Commercial / Admission Anchor Scoring
  let commercialScore = 0;
  if (/(\$|cad|ticket|admission|cover|sold out|at capacity|free admission|register|reserve|cart)/i.test(haystack)) {
    commercialScore = 1.0;
  }

  // Multi-Entity Confidence Calculation
  let confidence = 0;
  if (venueQuery && dateQuery) {
    confidence = (titleScore * 0.45) + (venueScore * 0.25) + (dateScore * 0.20) + (commercialScore * 0.10);
  } else if (venueQuery) {
    confidence = (titleScore * 0.55) + (venueScore * 0.30) + (commercialScore * 0.15);
  } else {
    confidence = (titleScore * 0.80) + (commercialScore * 0.20);
  }

  const passes = highSaliencePass && (
    (titleScore >= 0.65) ||
    (titleScore >= 0.35 && confidence >= 0.50)
  );

  return {
    matches: passes,
    confidence: Math.round(confidence * 100),
    titleScore: Math.round(titleScore * 100),
    matchedTokens,
    matchedHighSalience,
    totalTokens: rawTokens.length,
    reason: passes
      ? `Verified entity match (Confidence: ${Math.round(confidence * 100)}%, Title: ${Math.round(titleScore * 100)}%, Tokens: [${matchedTokens.join(", ")}])`
      : (highSalienceTokens.length > 0 && matchedHighSalience.length === 0)
      ? `Failed match: missing distinctive high-salience tokens [${highSalienceTokens.join(", ")}] (only matched low-salience [${matchedTokens.join(", ")}])`
      : `Failed match: title score ${Math.round(titleScore * 100)}% below threshold (none or insufficient tokens from [${rawTokens.join(", ")}])`,
  };
}

/**
 * Searches the page for direct external ticketing platform links or "Buy Tickets" buttons
 */
export async function findDirectTicketingUrl(page) {
  try {
    const candidate = await page.evaluate(() => {
      const ticketDomains = [
        "ovationtix.com",
        "showpass.com",
        "eventbrite.ca",
        "eventbrite.com",
        "ticketmaster.ca",
        "ticketmaster.com",
        "spektrix.com",
        "universe.com",
        "theatrewire.com",
        "ticketweb.ca",
        "admitone.com",
        "dice.fm",
        "brownpapertickets.com",
        "eventive.org",
        "vtixonline.com",
        "tickit.ca"
      ];

      const currentHref = window.location.href;

      // If the current page is ALREADY on an official ticketing platform, stay on it!
      if (ticketDomains.some((d) => currentHref.toLowerCase().includes(d))) {
        return null;
      }

      const anchors = Array.from(document.querySelectorAll("a[href]"));

      // Priority 1: External ticketing platform DEEP link
      for (const a of anchors) {
        const href = a.href || "";
        if (href && href.startsWith("http") && href !== currentHref && !href.includes("#")) {
          if (ticketDomains.some((d) => href.toLowerCase().includes(d))) {
            try {
              const u = new URL(href);
              const path = u.pathname.replace(/\/+$/, "");
              // Reject root landing pages or generic directories
              if (path && path.length > 2 && path !== "/events" && path !== "/home") {
                return {
                  href,
                  text: (a.innerText || "").trim(),
                  type: "external_ticketing_portal"
                };
              }
            } catch (_) {}
          }
        }
      }

      // Priority 2: Anchor with prominent "Buy Tickets" / "Get Tickets" text pointing to different path
      for (const a of anchors) {
        const text = (a.innerText || "").trim().toLowerCase();
        const href = a.href || "";
        if (
          href &&
          href.startsWith("http") &&
          href !== currentHref &&
          !href.includes("#") &&
          (text === "buy tickets" ||
           text === "get tickets" ||
           text === "purchase tickets" ||
           text === "book tickets" ||
           text === "book now" ||
           text === "tickets")
        ) {
          try {
            const u = new URL(href);
            const path = u.pathname.replace(/\/+$/, "");
            if (path && path.length > 2) {
              return {
                href,
                text: (a.innerText || "").trim(),
                type: "ticket_button_link"
              };
            }
          } catch (_) {}
        }
      }

      return null;
    });

    return candidate;
  } catch (_) {
    return null;
  }
}

/**
 * Attempts self-healing recovery when initial target URL is dead or mismatched
 */
export async function recoverEventUrl(page, targetUrl, eventCard, venuesDb) {
  console.log(`🔄 [Self-Healing] Attempting recovery for "${eventCard.title || eventCard.event_name}"...`);

  // 0. Try Curator Instructed URL or Learned Venue URL first! (Rule 2E: Curator Rules Supreme)
  const curatorInfo = getCuratorInfo({
    eventId: eventCard.id || eventCard.event_id,
    title: eventCard.title || eventCard.event_name,
    venue: eventCard.venue || eventCard.venue_name,
    existingCard: eventCard
  });

  const curatorCandidateUrls = [
    curatorInfo.instructedUrl,
    curatorInfo.learnedVenueUrl,
  ].filter((u) => u && isValidDeepLink(u) && u !== targetUrl);

  for (const cUrl of curatorCandidateUrls) {
    console.log(`🧑‍⚖️ [Self-Healing] Testing Curator Instructed / Learned URL: ${cUrl}`);
    try {
      await page.goto(cUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await new Promise((r) => setTimeout(r, 2000));
      const pageInfo = await page.evaluate(() => ({
        title: document.title || "",
        text: document.body ? document.body.innerText : "",
        url: window.location.href
      }));
      const deadCheck = checkPageDeadOr404(pageInfo);
      if (!deadCheck.isDead) {
        console.log(`✅ [Self-Healing] Successfully recovered event page via Curator URL: ${cUrl}`);
        return { success: true, recoveredUrl: cUrl };
      }
    } catch (e) {
      console.log(`⚠️ [Self-Healing] Note on Curator URL probe ${cUrl}: ${e.message}`);
    }
  }

  // 1. Try alternate URLs already attached to the card
  const altUrls = [
    eventCard.details_url,
    eventCard.websiteUrl,
    eventCard.discovery_url
  ].filter((u) => u && u.startsWith("http") && u !== targetUrl && u !== "#");

  for (const altUrl of altUrls) {
    console.log(`🔄 [Self-Healing] Testing card alternate URL: ${altUrl}`);
    try {
      await page.goto(altUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await new Promise((r) => setTimeout(r, 2000));
      const pageInfo = await page.evaluate(() => ({
        title: document.title || "",
        text: document.body ? document.body.innerText : "",
        url: window.location.href
      }));
      const deadCheck = checkPageDeadOr404(pageInfo);
      const entityCheck = checkEntityMatchesPage(eventCard.title || eventCard.event_name, pageInfo.title, pageInfo.text, {
        venue: eventCard.venue || eventCard.venue_name,
        date: eventCard.date,
        card: eventCard
      });
      if (!deadCheck.isDead && entityCheck.matches) {
        console.log(`✅ [Self-Healing] Success via card alternate URL: ${altUrl}`);
        return { success: true, recoveredUrl: altUrl };
      }
    } catch (_) {}
  }

  // 2. Discover origin domain from targetUrl or venuesDb
  let origin = null;
  try {
    origin = new URL(targetUrl).origin;
  } catch (_) {}

  if (!origin) {
    const vName = (eventCard.venue || eventCard.venue_name || "").toLowerCase();
    const matchedVenue = (venuesDb || []).find((v) => (v.name || v.venue_name || "").toLowerCase().includes(vName));
    if (matchedVenue?.website_url) {
      try { origin = new URL(matchedVenue.website_url).origin; } catch (_) {}
    }
  }

  if (!origin) {
    return { success: false, reason: "No origin domain discernable for venue" };
  }

  // 3. Scan common show and calendar directory endpoints on the venue domain
  const candidatePaths = [
    "/shows/",
    "/shows",
    "/season/",
    "/events/",
    "/calendar/",
    "/tickets/",
    "/whats-on/"
  ];

  const targetTitle = eventCard.title || eventCard.event_name || "";

  for (const p of candidatePaths) {
    const dirUrl = `${origin}${p}`;
    console.log(`🔄 [Self-Healing] Scanning venue directory: ${dirUrl}`);
    try {
      await page.goto(dirUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await new Promise((r) => setTimeout(r, 2500));

      const dirInfo = await page.evaluate(() => ({
        title: document.title || "",
        text: document.body ? document.body.innerText : "",
        url: window.location.href
      }));

      if (checkPageDeadOr404(dirInfo).isDead) {
        continue;
      }

      // Find links matching the event title tokens (Weighted Salience & Distinctive Quorum)
      const candidateLinks = await page.evaluate((expectedTitle, lowSalienceArray) => {
        const lowSalienceSet = new Set(lowSalienceArray || []);
        const stopWords = new Set([
          "the", "and", "with", "from", "for", "theatre", "theater", "presents",
          "production", "vancouver", "show", "live", "stage", "play", "season",
          "annual", "festival", "society", "company", "event", "tickets", "admission",
          "2024", "2025", "2026", "2027", "canada", "bc"
        ]);
        const tokens = (expectedTitle || "")
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((t) => t.length >= 3 && !stopWords.has(t));

        if (tokens.length === 0) return [];

        const highSalienceTokens = tokens.filter((t) => !lowSalienceSet.has(t));

        const anchors = Array.from(document.querySelectorAll("a[href]"));
        const results = [];
        for (const a of anchors) {
          const href = a.href || "";
          if (!href.startsWith("http") || href.includes("#")) continue;

          const text = (a.innerText || "").trim().toLowerCase();
          const titleAttr = (a.getAttribute("title") || "").toLowerCase();
          const hrefLower = href.toLowerCase();
          const combined = `${text} ${titleAttr} ${hrefLower}`;

          const matched = tokens.filter((t) => combined.includes(t));
          const matchedHighSalience = highSalienceTokens.filter((t) => combined.includes(t));

          // Weighted Scoring: High-salience distinctive = 3x, Low-salience common = 1x
          let totalWeight = 0;
          let matchedWeight = 0;
          for (const t of tokens) {
            const w = lowSalienceSet.has(t) ? 1 : 3;
            totalWeight += w;
            if (combined.includes(t)) {
              matchedWeight += w;
            }
          }
          const weightedRatio = totalWeight > 0 ? matchedWeight / totalWeight : 0;
          const hasDistinctivePass = highSalienceTokens.length === 0 || matchedHighSalience.length >= 1;

          // Require distinctive high-salience pass and quorum threshold (prevent single low-salience words matching)
          if (hasDistinctivePass && (
            (tokens.length <= 2 && matched.length >= 1) ||
            (weightedRatio >= 0.40) ||
            (matched.length >= 2 && weightedRatio >= 0.30)
          )) {
            results.push({
              href,
              text: a.innerText.trim(),
              weightedScore: Math.round(weightedRatio * 100),
              matchedCount: matched.length,
              matchedTokens: matched,
              matchedHighSalience
            });
          }
        }

        results.sort((a, b) => b.weightedScore - a.weightedScore || b.matchedCount - a.matchedCount);
        return results;
      }, targetTitle, Array.from(LOW_SALIENCE_WORDS));

      if (candidateLinks && candidateLinks.length > 0) {
        const bestCandidate = candidateLinks[0];
        console.log(`🔄 [Self-Healing] Found matching link on ${dirUrl}: ${bestCandidate.href} (${bestCandidate.text}) [Score: ${bestCandidate.weightedScore}%, Tokens: ${bestCandidate.matchedTokens.join(", ")}]`);

        await page.goto(bestCandidate.href, { waitUntil: "domcontentloaded", timeout: 25000 });
        await new Promise((r) => setTimeout(r, 2500));

        const recoveredInfo = await page.evaluate(() => ({
          title: document.title || "",
          text: document.body ? document.body.innerText : "",
          url: window.location.href
        }));

        const recoveredDead = checkPageDeadOr404(recoveredInfo);
        const recoveredEntity = checkEntityMatchesPage(targetTitle, recoveredInfo.title, recoveredInfo.text, {
          venue: eventCard.venue || eventCard.venue_name,
          date: eventCard.date,
          card: eventCard
        });

        if (!recoveredDead.isDead && recoveredEntity.matches) {
          console.log(`✅ [Self-Healing] Successfully recovered event page: ${bestCandidate.href}`);
          return { success: true, recoveredUrl: bestCandidate.href };
        }
      }
    } catch (dirErr) {
      console.log(`ℹ️ [Self-Healing] Directory probe note for ${dirUrl}: ${dirErr.message}`);
    }
  }

  return { success: false, reason: "Self-healing exhausted all venue directory paths" };
}

/**
 * Audit a single event card via Stagehand interactive browser
 */
async function auditSingleEventCard(eventCard, venuesDb, apiKey) {
  const eventId = eventCard.id || eventCard.event_id;

  // Rule 1.1 & 1.2: Stagehand Live Box Office QC runs exclusively on paid / ticketed events.
  // Open public spaces (parks, seawalls, plazas, waterfronts) and free drop-in perennials bypass Stagehand cart clicking.
  if (!isTicketedOrPaidEvent(eventCard)) {
    console.log(`🌳 [Open Public Space / Free Drop-In] Bypassing Stagehand checkout cart penetration for "${eventCard.title || eventCard.event_name}" (${eventId}) — grounded via Google Maps / Venue Detailer.`);
    const venueNameQuery = eventCard.venue || eventCard.venue_name;
    const venueData = hydrateVenueDimensions(venueNameQuery, venuesDb);
    const cleanUrl = eventCard.ticket_url || eventCard.details_url || eventCard.websiteUrl || venueData.website_url || "";
    const extractedFree = {
      title: eventCard.title || eventCard.event_name || "Open Public Space",
      venue_name: eventCard.venue || eventCard.venue_name || venueData.name || "",
      date: eventCard.date || eventCard.dateSchedule || "Perennial Daily Access",
      start_time: eventCard.start_time || eventCard.time || "Open Daily",
      tier1_name: "Free Public Access",
      tier1_price_base: 0,
      tier1_price_fee: 0,
      tier1_price_tax: 0,
      tier1_price_all_in: 0,
      is_sold_out: false,
      ticket_url: cleanUrl,
    };
    const fullUpdatedCard = buildFullDimensions(
      extractedFree,
      venueData,
      cleanUrl,
      null,
      eventCard
    );
    fullUpdatedCard.id = eventId;
    fullUpdatedCard.event_id = eventId;
    return {
      success: true,
      eventId,
      status: "VERIFIED_FREE_PUBLIC_ACCESS",
      card: fullUpdatedCard,
      durationSec: 0,
    };
  }

  // Epistemic Precedence Hierarchy (Rule 2E: Boundary & Identity - Curator Rules Supreme)
  const curatorInfo = getCuratorInfo({
    eventId,
    title: eventCard.title || eventCard.event_name,
    venue: eventCard.venue || eventCard.venue_name,
    existingCard: eventCard
  });
  const activeCuratorNote = curatorInfo.effectiveNote || curatorInfo.eventInstructionText || curatorInfo.existingCuratorNotes;
  if (activeCuratorNote) {
    console.log(`🧑‍⚖️ [Stagehand QC AI] Active Curator Note to consider: "${activeCuratorNote}"`);
  }

  // Stagehand AI Pre-Flight: Check link health and run Tier 1 Hunter AI if missing or degraded
  try {
    if (curatorInfo.instructedUrl && isValidDeepLink(curatorInfo.instructedUrl)) {
      if (eventCard.ticket_url !== curatorInfo.instructedUrl) {
        console.log(`🧑‍⚖️ [Curator Precedence] Applying curator instructed destination URL: ${curatorInfo.instructedUrl}`);
        eventCard.ticket_url = curatorInfo.instructedUrl;
        eventCard.candidate_tier1_url = curatorInfo.instructedUrl;
      }
    }

    const probeUrl = eventCard.candidate_tier1_url || eventCard.ticket_url || eventCard.details_url;
    const health = await scanSingleLinkHealth(probeUrl, eventCard);
    if (!eventCard.candidate_tier1_url && (!health.healthy || health.detectedTier !== "tier1")) {
      console.log(`🏹 [Stagehand Pre-Flight] Link requires hunt (${health.status}: ${health.reason}). Launching Tier 1 Hunter AI...`);
      const huntRes = await huntTier1LinkForEvent(eventCard);
      if (huntRes.success) {
        console.log(`🎯 [Stagehand Pre-Flight] Tier 1 Hunter succeeded! Staged checkout cart: ${eventCard.candidate_tier1_url || eventCard.ticket_url}`);
      }
    } else if (!eventCard.candidate_tier1_url && !isWhitelistedTicketingUrl(eventCard.ticket_url)) {
      const candidateResult = inspectCardForCandidateLink(eventCard);
      if (candidateResult.staged) {
        console.log(`🎯 [Pre-Audit Sniff] Staged candidate Tier 1 checkout link: ${eventCard.candidate_tier1_url}`);
      }
    }
  } catch (preErr) {
    console.warn(`⚠️ Warning in Stagehand pre-flight link check: ${preErr.message}`);
  }

  let targetUrl = eventCard.ticket_url || eventCard.details_url || eventCard.websiteUrl || eventCard.discovery_url;
  const candidateUrl = eventCard.candidate_tier1_url;
  let candidateVerified = false;

  if (!targetUrl || !targetUrl.startsWith("http") || targetUrl === "#") {
    return {
      success: false,
      eventId,
      status: "SKIPPED_NO_URL",
      error: "Missing resolvable HTTP/HTTPS destination URL",
      card: eventCard,
    };
  }

  console.log(`\n================================================================`);
  console.log(`⚡ AUDITING: ${eventCard.title || eventCard.event_name}`);
  console.log(`🏛️ Venue: ${eventCard.venue || eventCard.venue_name}`);
  console.log(`🎯 URL: ${targetUrl}`);
  console.log(`================================================================`);

  let stagehand;
  let browser;
  const startTime = Date.now();

  try {
    browser = await localBrowser.launch();
    stagehand = await Stagehand.create({
      browser,
      model: {
        modelName: "google/gemini-3.8-flash",
        apiKey: apiKey.trim(),
      },
    });

    let page = null;

    // Stagehand Verification Gate: Probe candidate Tier 1 checkout URL if staged
    if (candidateUrl && candidateUrl.startsWith("http") && candidateUrl !== targetUrl) {
      console.log(`🎯 [Stagehand Gate] Probing staged candidate Tier 1 checkout lead first: ${candidateUrl}`);
      try {
        const candidatePage = await stagehand.browser.context.newPage(candidateUrl);
        await new Promise((r) => setTimeout(r, 3500));

        const candInfo = await candidatePage.evaluate(() => ({
          title: document.title || "",
          text: document.body ? document.body.innerText : "",
          url: window.location.href,
        }));

        const candDead = checkPageDeadOr404(candInfo);
        const candEntity = checkEntityMatchesPage(eventCard.title || eventCard.event_name, candInfo.title, candInfo.text, {
          venue: eventCard.venue || eventCard.venue_name,
          date: eventCard.date,
          card: eventCard
        });

        if (!candDead.isDead && candEntity.matches) {
          console.log(`✅ [Stagehand Gate] Candidate Tier 1 URL verified on live page! Grounded match confirmed.`);
          targetUrl = candidateUrl;
          page = candidatePage;
          candidateVerified = true;
        } else {
          console.warn(`⚠️ [Stagehand Gate] Candidate Tier 1 URL rejected: ${candDead.isDead ? candDead.reason : candEntity.reason}. Discarding lead and falling back to Tier 2/3.`);
          eventCard.candidate_tier1_rejected_reason = candDead.isDead ? candDead.reason : candEntity.reason;
          await candidatePage.close().catch(() => {});
        }
      } catch (candErr) {
        console.warn(`⚠️ [Stagehand Gate] Note testing candidate lead: ${candErr.message}. Falling back.`);
      }
    }

    if (!page) {
      console.log(`🌐 [1/4] Navigating to destination page: ${targetUrl}...`);
      page = await stagehand.browser.context.newPage(targetUrl);
      await new Promise((r) => setTimeout(r, 3500));
    }

    // Dealbreaker Gate 4 & Gate 5 Initial Evaluation
    let pageInfo = await page.evaluate(() => {
      let ldJson = null;
      try {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const s of scripts) {
          const raw = s.innerText || s.textContent || "";
          if (raw.includes("Event")) {
            const parsed = JSON.parse(raw);
            if (parsed["@type"] === "Event") { ldJson = parsed; break; }
            if (Array.isArray(parsed["@graph"])) {
              const evItem = parsed["@graph"].find((x) => x["@type"] === "Event");
              if (evItem) { ldJson = evItem; break; }
            }
          }
        }
      } catch (_) {}
      return {
        title: document.title || "",
        text: document.body ? document.body.innerText : "",
        url: window.location.href,
        ldJson,
      };
    });

    let deadCheck = checkPageDeadOr404(pageInfo);
    let entityCheck = checkEntityMatchesPage(eventCard.title || eventCard.event_name, pageInfo.title, pageInfo.text, {
      venue: eventCard.venue || eventCard.venue_name,
      date: eventCard.date,
      card: eventCard
    });

    // If initial page is dead or fails entity matching, attempt self-healing recovery!
    if (deadCheck.isDead || !entityCheck.matches) {
      console.warn(`⚠️ Initial validation issue: ${deadCheck.isDead ? deadCheck.reason : entityCheck.reason}`);
      const recovery = await recoverEventUrl(page, targetUrl, eventCard, venuesDb);
      if (recovery.success && recovery.recoveredUrl) {
        targetUrl = recovery.recoveredUrl;
        pageInfo = await page.evaluate(() => ({
          title: document.title || "",
          text: document.body ? document.body.innerText : "",
          url: window.location.href,
        }));
        deadCheck = checkPageDeadOr404(pageInfo);
        entityCheck = checkEntityMatchesPage(eventCard.title || eventCard.event_name, pageInfo.title, pageInfo.text, {
          venue: eventCard.venue || eventCard.venue_name,
          date: eventCard.date,
          card: eventCard
        });
      } else {
        const poisonedUrls = Array.from(new Set([...(eventCard.dead_urls || []), targetUrl].filter(Boolean)));
        const failedCard = {
          ...eventCard,
          ticket_url: null,
          failed_url: targetUrl,
          dead_urls: poisonedUrls,
          last_qc_audited_at: new Date().toISOString(),
        };
        if (deadCheck.isDead) {
          console.warn(`❌ Fatal Gate 4 Breach: Link is dead or 404 (${deadCheck.reason}). Self-healing failed.`);
          return {
            success: false,
            eventId,
            status: "FATAL_DEAD_LINK",
            error: deadCheck.reason,
            card: failedCard,
          };
        }
        if (!entityCheck.matches) {
          console.warn(`❌ Fatal Gate 5 Breach: Page content does not match target event (${entityCheck.reason}).`);
          return {
            success: false,
            eventId,
            status: "FATAL_MISMATCHED_ENTITY",
            error: entityCheck.reason,
            card: failedCard,
          };
        }
      }
    }

    // Direct Ticketing Button & External Portal Traversal
    const ticketingTarget = await findDirectTicketingUrl(page);
    let checkoutUrl = targetUrl;
    if (ticketingTarget && ticketingTarget.href && ticketingTarget.href !== page.url()) {
      console.log(`🎟️ Traversed to ticketing checkout portal: ${ticketingTarget.href} (${ticketingTarget.type})`);
      checkoutUrl = ticketingTarget.href;
      try {
        await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        await new Promise((r) => setTimeout(r, 3500));
      } catch (navErr) {
        console.warn(`⚠️ Note navigating to ticketing portal: ${navErr.message}`);
      }
    }

    // [2/4] Interactive Box Office Drawer Penetration
    console.log(`🎟️ [2/4] Interacting with ticket / cart modal...`);
    try {
      const hasInteractiveButtons = await page.evaluate(() => {
        const text = (document.body ? document.body.innerText : "").toLowerCase();
        return (
          text.includes("ticket") ||
          text.includes("register") ||
          text.includes("book now") ||
          text.includes("buy") ||
          text.includes("admission") ||
          text.includes("cart") ||
          text.includes("regular") ||
          text.includes("general admission")
        );
      });

      if (hasInteractiveButtons) {
        await Promise.race([
          stagehand.act(
            "If there is a 'Tickets', 'Buy Tickets', 'Get Tickets', or 'Register' button, click it to open the cart modal. Dismiss any cookie banners first if present."
          ),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Cart button act timeout")), 12000))
        ]).catch((e) => console.log(`ℹ️ [Act 1] ${e.message}`));

        await new Promise((r) => setTimeout(r, 2000));

        // Act 1.5 (Intermediate Date / Time Slot Picker Navigation):
        // If an intermediate "Select a Date", "Choose a Date", or calendar day/time list is displayed,
        // click the first available date or matching event date button to navigate to the ticket tier drawer!
        try {
          const dateModalVisible = await page.evaluate(() => {
            const bodyText = (document.body ? document.body.innerText : "").toLowerCase();
            return (
              bodyText.includes("select a date") ||
              bodyText.includes("choose a date") ||
              bodyText.includes("select date") ||
              bodyText.includes("select time") ||
              bodyText.includes("choose a time")
            );
          });

          if (dateModalVisible) {
            console.log(`📅 [Act 1.5 - Date Picker] Intermediate date selection list detected. Selecting date...`);
            // DOM-level click for Showpass / dialog cards first for speed and reliability
            const clickedDom = await page.evaluate(() => {
              const cards = Array.from(document.querySelectorAll('[role="dialog"] button, [role="dialog"] [class*="card"], [class*="modal"] button, [class*="drawer"] button, .chakra-modal__body button, [class*="date-item"]'));
              for (const c of cards) {
                const txt = (c.innerText || "").toLowerCase();
                if (txt.includes("2026") || txt.includes("oct") || txt.includes("nov") || txt.includes("dec") || txt.includes("am") || txt.includes("pm") || txt.includes("starts")) {
                  c.click();
                  return true;
                }
              }
              return false;
            });

            if (!clickedDom) {
              await Promise.race([
                stagehand.act(
                  "If 'Select a Date' or a date list is shown, click on the first available date option or card to reveal the ticket tiers."
                ),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Date selector act timeout")), 10000))
              ]).catch((e) => console.log(`ℹ️ [Act 1.5 - Date Picker] ${e.message}`));
            }

            await new Promise((r) => setTimeout(r, 2000));
          }
        } catch (dateErr) {
          console.log(`ℹ️ [Act 1.5 Note] ${dateErr.message}`);
        }

        await Promise.race([
          stagehand.act(
            "If a ticket quantity selector is visible, click '+' or set quantity to 1 for Adult / General Admission / Regular ticket to reveal base price, platform service fees, and taxes."
          ),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Quantity selector act timeout")), 10000))
        ]).catch((e) => console.log(`ℹ️ [Act 2] ${e.message}`));

        await new Promise((r) => setTimeout(r, 1500));
      } else {
        console.log(`ℹ️ No interactive ticketing buttons detected on page. Proceeding to direct extraction.`);
      }
    } catch (actErr) {
      console.log(`ℹ️ Note on interactive cart action: ${actErr.message || "Proceeded directly"}`);
    }

    // [3/4] Photographic Proof Keyframe Capture
    const screenshotFileName = `${eventId}_cart.png`;
    const screenshotFilePath = path.join(PROOFS_DIR, screenshotFileName);
    console.log(`📸 [3/4] Capturing photographic cart keyframe: ${screenshotFileName}...`);
    try {
      await page.screenshot({ path: screenshotFilePath, fullPage: false });
    } catch (shotErr) {
      console.warn(`⚠️ Warning capturing keyframe: ${shotErr.message}`);
    }

    // [4/4] AI Extraction of Volatile Facts
    console.log(`🔍 [4/4] Extracting live box office pricing, fees, and schedule...`);
    // Ensure all tiers in scrollable modals (e.g. Showpass) are hydrated
    try {
      await page.evaluate(() => {
        const modals = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="drawer"], .chakra-modal__body');
        modals.forEach((m) => {
          if (m.scrollHeight > m.clientHeight) {
            m.scrollTop = m.scrollHeight;
          }
        });
      });
      await new Promise((r) => setTimeout(r, 600));
      await page.evaluate(() => {
        const modals = document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="drawer"], .chakra-modal__body');
        modals.forEach((m) => {
          m.scrollTop = 0;
        });
      });
    } catch (_) {}

    const curatorGuidancePrompt = activeCuratorNote
      ? `\n🧑‍⚖️ MANDATORY CURATOR NOTE & USER GUIDANCE TO CONSIDER:\n"${activeCuratorNote}"\n(You MUST prioritize and take this curator guidance into account! E.g. respect requested ticket tiers, student/door rates, doors/curtain times, or dates.)\n`
      : "";

    let extracted = {};
    if (isAntigravityEngine()) {
      console.log(`🚀 [Antigravity Box Office Mode] Capturing rendered DOM & cart modal text for 1-event Antigravity Worker (${getAntigravityModel()})...`);
      const domSnapshot = await page.evaluate(() => {
        const title = document.title || "";
        const bodyText = document.body ? document.body.innerText : "";
        return `PAGE TITLE: ${title}\n\nVISIBLE CART & PAGE TEXT:\n${bodyText}`;
      });
      const agyData = await callAntigravityBoxOfficeExtractor(domSnapshot, checkoutUrl || targetUrl, {
        ...eventCard,
        curator_notes: activeCuratorNote || eventCard.curator_notes,
      });
      if (agyData && typeof agyData === "object") {
        extracted = agyData;
      }
    }

    if (!extracted || Object.keys(extracted).length === 0) {
      try {
        const extraction = await stagehand.extract(
          "Extract the full event and ticketing facts: exact venue name, title, headliner artist, date, showtime, doors time, curfew/end time (D38), age restrictions, ticket purchase link, sold out state.\n" +
          curatorGuidancePrompt +
          "IMPORTANT TICKET TIERS & PRICING RULES:\n" +
          "- Extract single-event / single-visit admission tiers visible in the modal or page into the all_tiers array: Adult (19-64 years), Senior (65+ years), Youth (13-18 years), Child (5-12 years), Preschooler (4 and under), Student, etc. with exact name, base price, fees, taxes, and all-in total in CAD.\n" +
          "- DO NOT extract annual memberships, 12-month passes, season subscriptions, or donation upsells as ticket tiers.\n" +
          "- Tier 1 MUST be the standard Adult / General Admission single-visit ticket tier (e.g. Adult 19-64 years or BC Resident General Admission). If an event offers a free preschooler ($0), child/youth ($0), or member tier alongside a paid Adult ticket (e.g. $14.86 or $29.00 CAD), do NOT record the $0 tier as General Admission! You must record the paid Adult / General Admission price as Tier 1.\n" +
          "- Also populate tier1, tier2, and tier3 with the primary single-visit tiers <= $50.00 CAD (e.g. tier1 = Adult, tier2 = Senior/Student, tier3 = Youth/Child).\n" +
          "- CRITICAL SOLD-OUT RULE: Set is_sold_out: false whenever at least one single-visit admission tier (e.g. General Admission, Regular, or Student) is available for purchase in the checkout modal. Do NOT set is_sold_out: true merely because a single early-bird/VIP tier is sold out, or because 'Sold Out' appears on a sidebar/related event listing.\n" +
          "- If multiple show dates/times exist, extract up to 5 showings into the showings array.",
          SingleEventExtractionSchema
        );
        extracted = extraction.data || extraction || {};
      } catch (extErr) {
        console.warn(`⚠️ [Stagehand Extract Fallback] Stagehand extension world / frame extraction error (${extErr.message}). Falling back to direct DOM + Gemini Box Office Extractor...`);
        try {
          const domSnapshot = await page.evaluate(() => {
            const title = document.title || "";
            const bodyText = document.body ? document.body.innerText : "";
            return `PAGE TITLE: ${title}\n\nVISIBLE CART & PAGE TEXT:\n${bodyText}`;
          });
          const fallbackData = await callAntigravityBoxOfficeExtractor(domSnapshot, checkoutUrl || targetUrl, {
            ...eventCard,
            curator_notes: activeCuratorNote || eventCard.curator_notes,
          });
          if (fallbackData && typeof fallbackData === "object") {
            extracted = fallbackData;
          }
        } catch (fbErr) {
          console.warn(`⚠️ [Stagehand Extract Fallback] DOM fallback note: ${fbErr.message}`);
        }
      }
    }

    // Hydrate from structured application/ld+json if present on page
    if (pageInfo?.ldJson) {
      const ld = pageInfo.ldJson;
      if (ld.startDate && (!extracted.date || extracted.date === "Perennial Daily Access")) {
        const m = String(ld.startDate).match(/^(\d{4}-\d{2}-\d{2})/);
        if (m) extracted.date = m[1];
        const tMatch = String(ld.startDate).match(/T(\d{2}:\d{2})/);
        if (tMatch && !extracted.start_time) extracted.start_time = tMatch[1];
      }
      if (ld.offers) {
        const offersList = Array.isArray(ld.offers) ? ld.offers : [ld.offers];
        const availableOffer = offersList.find((o) => o && (!o.availability || !String(o.availability).includes("SoldOut"))) || offersList[0];
        if (availableOffer && availableOffer.price !== undefined && extracted.tier1_price_base == null) {
          extracted.tier1_price_base = parseFloat(availableOffer.price) || 0;
        } else if (availableOffer && availableOffer.lowPrice !== undefined && extracted.tier1_price_base == null) {
          extracted.tier1_price_base = parseFloat(availableOffer.lowPrice) || 0;
        }
        const allOffersSoldOut = offersList.length > 0 && offersList.every((o) => o && o.availability && String(o.availability).includes("SoldOut"));
        const hasAvailableTierInCart = Array.isArray(extracted.all_tiers) && extracted.all_tiers.some((t) => t && t.is_available !== false && t.isAvailable !== false);
        if (allOffersSoldOut && !hasAvailableTierInCart) {
          extracted.is_sold_out = true;
        }
      }
    }

    // Gate 5: Entity Reality Check with fallback to existing card data
    if (!extracted.title || extracted.title.trim().length === 0) {
      extracted.title = eventCard.title || eventCard.event_name || "";
    }
    if (!extracted.title || extracted.title.trim().length === 0) {
      console.warn(`❌ Fatal Gate 5 Breach: Extracted title is blank or missing.`);
      return {
        success: false,
        eventId,
        status: "FATAL_EMPTY_ENTITY",
        error: "Extracted event title is blank or missing",
        card: eventCard,
      };
    }

    // If extracted ticket_url was missing, relative, or a generic portal root, use verified checkoutUrl or targetUrl
    if (!isValidDeepLink(extracted.ticket_url)) {
      extracted.ticket_url = isValidDeepLink(checkoutUrl) ? checkoutUrl : (isValidDeepLink(targetUrl) ? targetUrl : eventCard.ticket_url);
    }

    // Fallbacks for date and venue from existing catalog card if unstated on page
    if (!extracted.venue_name || extracted.venue_name.trim().length === 0) {
      extracted.venue_name = eventCard.venue || eventCard.venue_name || "";
    }
    if (!extracted.date || extracted.date.trim().length === 0) {
      extracted.date = eventCard.date || eventCard.dateSchedule || "Perennial Daily Access";
    }

    // Stage 4: Venue Constants Hydration from venues.json
    const venueNameQuery = extracted.venue_name || eventCard.venue || eventCard.venue_name;
    const venueData = hydrateVenueDimensions(venueNameQuery, venuesDb);

    // Stages 1 & 5: Invariant Engine & Dimension Matrix Compilation
    const fullUpdatedCard = buildFullDimensions(
      extracted,
      venueData,
      checkoutUrl || targetUrl,
      fs.existsSync(screenshotFilePath) ? screenshotFilePath : null,
      eventCard
    );

    // If candidate Tier 1 was verified on live page, promote checkout link officially
    if (candidateVerified) {
      fullUpdatedCard.ticket_url = targetUrl;
      if (!fullUpdatedCard.links) fullUpdatedCard.links = {};
      fullUpdatedCard.links.tier1_checkout = targetUrl;
      fullUpdatedCard.links.best_available = targetUrl;
      fullUpdatedCard.links.best_tier = "tier1";
      fullUpdatedCard.candidate_tier1_verified = true;
      fullUpdatedCard.candidate_tier1_promoted_at = new Date().toISOString();
      delete fullUpdatedCard.candidate_tier1_url;
      console.log(`🚀 [Stagehand Gate] Officially promoted candidate Tier 1 checkout URL to live card: ${targetUrl}`);
    } else if (eventCard.candidate_tier1_rejected_reason) {
      delete fullUpdatedCard.candidate_tier1_url;
      fullUpdatedCard.candidate_tier1_rejected = true;
      fullUpdatedCard.candidate_tier1_rejected_reason = eventCard.candidate_tier1_rejected_reason;
    }

    // Preserve original event ID and curator notes
    fullUpdatedCard.id = eventId;
    fullUpdatedCard.event_id = eventId;
    if (activeCuratorNote) {
      fullUpdatedCard.curator_notes = activeCuratorNote;
      fullUpdatedCard.curator_instructions = curatorInfo.eventInstructionText || eventCard.curator_instructions || activeCuratorNote;
    }

    const durationSec = Math.round((Date.now() - startTime) / 1000);
    console.log(`✅ Audit Completed in ${durationSec}s:`);
    const logBase = fullUpdatedCard.price_base != null ? fullUpdatedCard.price_base : (fullUpdatedCard.price != null ? fullUpdatedCard.price : 0);
    const logFee = fullUpdatedCard.price_fee != null ? fullUpdatedCard.price_fee : 0;
    console.log(`   Price: ${fullUpdatedCard.priceLabel} (Base: $${logBase}, Fees: $${logFee})`);
    console.log(`   Budget Under $50 CAD: ${fullUpdatedCard.budget_qualified_under_50 ? "PASS ✅" : "BREACH ❌"}`);
    console.log(`   Inventory: ${fullUpdatedCard.is_sold_out ? "SOLD OUT ⚠️" : "AVAILABLE 🎟️"}`);
    console.log(`   Date: ${fullUpdatedCard.date || fullUpdatedCard.dateSchedule || "N/A"}`);
    if (fullUpdatedCard.time || fullUpdatedCard.doors_time) {
      console.log(`   Showtime: ${fullUpdatedCard.time || fullUpdatedCard.doors_time}`);
    }
    if (fullUpdatedCard.description) {
      console.log(`   📝 Description: "${fullUpdatedCard.description.replace(/\n+/g, ' ').trim()}"`);
    }
    if (fs.existsSync(screenshotFilePath)) {
      console.log(`   Proof keyframe captured: ${screenshotFileName}`);
    }

    return {
      success: true,
      eventId,
      status: fullUpdatedCard.budget_qualified_under_50 ? "VERIFIED_PASS" : "BUDGET_BREACH",
      card: fullUpdatedCard,
      durationSec,
    };
  } catch (err) {
    const durationSec = Math.round((Date.now() - startTime) / 1000);
    const isTimeoutErr = /timeout|timed out|etimedout/i.test(err.message || "");
    recordPipelineTimeoutEvent({
      eventId,
      eventTitle: eventCard.title || eventCard.event_name || eventId,
      stage: "Stage 2: Stagehand Live Cart QC",
      model: isAntigravityEngine() ? getAntigravityModel() : "google/gemini-3.8-flash",
      elapsedSec: durationSec,
      timeoutLimitSec: 60,
      isTimeout: isTimeoutErr,
      cause: isTimeoutErr
        ? `Browser / Stagehand navigation or modal timeout (${err.message})`
        : `Stagehand execution error (${err.message})`,
    });
    console.error(`❌ Error during event audit: ${err.message}`);
    return {
      success: false,
      eventId,
      status: isTimeoutErr ? "AI_TIMEOUT" : "EXECUTION_ERROR",
      error: err.message,
      card: eventCard,
    };
  } finally {
    if (stagehand) {
      try {
        await stagehand.close();
      } catch (_) {}
    }
    if (browser) {
      try {
        await browser.close();
      } catch (_) {}
    }
    console.log(`🧹 Session closed cleanly.`);
  }
}

/**
 * Duration & Staleness Helpers
 */
export function parseDurationMs(str) {
  if (!str) return null;
  const match = String(str).trim().match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|m|mo|mon|month|months)$/i);
  if (!match) return null;
  const val = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit.startsWith("h")) return val * 3600 * 1000;
  if (unit.startsWith("d")) return val * 24 * 3600 * 1000;
  if (unit.startsWith("w")) return val * 7 * 24 * 3600 * 1000;
  if (unit.startsWith("m")) return val * 30 * 24 * 3600 * 1000;
  return null;
}

export function isEventStale(e, durationMs, now = Date.now()) {
  const ts = e.last_pulse_qc_at || e.last_content_qc_at || e.last_full_qc_at || e.last_qc_audited_at || e.audited_at || e.enriched_at;
  if (!ts) return true; // never scanned = infinitely stale
  const t = new Date(ts).getTime();
  if (isNaN(t)) return true;
  return (now - t) >= durationMs;
}

export function isVerifiedApprovalStatus(status) {
  if (!status || typeof status !== "string") return false;
  const s = status.trim();
  return /^(Stagehand-\d+D-Verified|Verified-\d+D|Stagehand-Verified|Verified|Curator-Approved)$/i.test(s) || (s.includes("Verified") && !s.includes("Quarantine"));
}

export function isTicketedOrPaidEvent(e) {
  if (!e) return false;
  // Open public spaces (parks, seawalls, beaches, plazas) and free public access drop-ins do not have interactive checkout carts
  if (e.access_model === "open_public_space" || e.access_model === "free_public_access") {
    return false;
  }
  const url = String(e.candidate_tier1_url || e.ticket_url || e.links?.tier1_checkout || "").toLowerCase();
  const hasTicketingPortal = isWhitelistedTicketingUrl(url);
  if (e.lifecycle_type === "perennial_drop_in" && !hasTicketingPortal && (e.isFree || e.price === 0 || e.pricingType === "free")) {
    return false;
  }
  return true;
}

export function isScanIncomplete(e) {
  if (!isTicketedOrPaidEvent(e)) return false;
  // 1. Missing Stagehand Live Cart QC / proof keyframe / pulse qc timestamp
  const missingCart = !e.proof_keyframes?.cart || !e.last_pulse_qc_at || !isVerifiedApprovalStatus(e.approval_status);
  // 2. Missing Editorial Enrichment (no description, or placeholder title, or unverified)
  const missingEditorial = !e.description || (!e.artist && !e.lineup) || e.title === "Cultural Event" || !e.last_content_qc_at;
  // 3. Missing Schedule Harvester verification
  const missingSchedule = !e.dateSchedule && !e.date && (!e.showings || e.showings.length === 0);
  // 4. Missing Compiler publishing
  const missingFullQC = !e.last_full_qc_at;

  return missingCart || missingEditorial || missingSchedule || missingFullQC;
}

/**
 * Main Batch Runner
 */
export async function runEventBatchQC(options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "" || apiKey === "YOUR_GEMINI_API_KEY_HERE") {
    throw new Error("GEMINI_API_KEY is missing or invalid in ripper/.env");
  }

  createSafetyBackup();

  // Load events
  let events = [];
  if (fs.existsSync(EVENTS_PATH)) {
    try {
      events = JSON.parse(fs.readFileSync(EVENTS_PATH, "utf-8"));
    } catch (e) {
      throw new Error(`Failed to load data/events.json: ${e.message}`);
    }
  }

  // Load venues
  let venuesDb = [];
  if (fs.existsSync(VENUES_PATH)) {
    try {
      venuesDb = JSON.parse(fs.readFileSync(VENUES_PATH, "utf-8"));
    } catch (e) {}
  }

  // Load manual review queue
  let queue = { metadata: {}, quarantinedEvents: [] };
  if (fs.existsSync(QUEUE_PATH)) {
    try {
      queue = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
    } catch (e) {}
  }
  queue.quarantinedEvents = queue.quarantinedEvents || [];

  const ARCHIVED_PATH = path.join(DATA_DIR, "archived_events.json");
  const RULES_PATH = path.join(DATA_DIR, "curator_learned_rules.json");
  const archivedIds = new Set();
  const blacklistPatterns = [];
  try {
    if (fs.existsSync(ARCHIVED_PATH)) {
      const aData = JSON.parse(fs.readFileSync(ARCHIVED_PATH, "utf-8"));
      const aList = Array.isArray(aData) ? aData : (aData.archivedEvents || []);
      aList.forEach((a) => {
        if (a.id) archivedIds.add(String(a.id).toLowerCase());
        if (a.event_id) archivedIds.add(String(a.event_id).toLowerCase());
      });
    }
  } catch (_) {}
  try {
    if (fs.existsSync(RULES_PATH)) {
      const rData = JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));
      (rData.archived_event_ids || []).forEach((id) => archivedIds.add(String(id).toLowerCase()));
      (rData.course_blacklist_patterns || []).forEach((p) => {
        if (p) blacklistPatterns.push(String(p).toLowerCase().trim());
      });
    }
  } catch (_) {}

  const SCHEDULES_PATH = path.join(DATA_DIR, "layers", "layer_schedules.json");
  const SEEDS_PATH = path.join(DATA_DIR, "layers", "seeds.json");
  let schedules = [];
  try { if (fs.existsSync(SCHEDULES_PATH)) schedules = JSON.parse(fs.readFileSync(SCHEDULES_PATH, "utf-8")); } catch (_) {}
  let seeds = [];
  try { if (fs.existsSync(SEEDS_PATH)) seeds = JSON.parse(fs.readFileSync(SEEDS_PATH, "utf-8")); } catch (_) {}

  // Combined source pool: active events + quarantined events + layer_schedules + seeds (excluding permanently archived items)
  const combinedPool = events.filter((e) => !archivedIds.has(String(e.id || e.event_id).toLowerCase()));
  const activeIds = new Set(events.map((e) => String(e.id || e.event_id).toLowerCase()));
  queue.quarantinedEvents.forEach((qEv) => {
    const qId = String(qEv.id || qEv.event_id || "").toLowerCase();
    if (qId && !activeIds.has(qId) && !archivedIds.has(qId)) {
      qEv._isFromQuarantine = true;
      combinedPool.push(qEv);
      activeIds.add(qId);
    }
  });
  schedules.forEach((sEv) => {
    const sId = String(sEv.id || sEv.event_id || "").toLowerCase();
    if (sId && !activeIds.has(sId) && !archivedIds.has(sId)) {
      combinedPool.push(sEv);
      activeIds.add(sId);
    }
  });
  seeds.forEach((seedEv) => {
    const sId = String(seedEv.id || seedEv.event_id || "").toLowerCase();
    if (sId && !activeIds.has(sId) && !archivedIds.has(sId)) {
      combinedPool.push(seedEv);
      activeIds.add(sId);
    }
  });

  // Filter Target Events
  let targets = [...combinedPool];
  const hasSpecificId = Boolean(options.id || options.ids);

  if (hasSpecificId) {
    const rawIds = options.ids
      ? (Array.isArray(options.ids) ? options.ids : String(options.ids).split(","))
      : String(options.id).split(",");
    const cleanIds = rawIds.map((s) => s.trim()).filter(Boolean);
    const poolMap = new Map();
    combinedPool.forEach((e) => {
      const eid = e.id || e.event_id;
      if (eid && !poolMap.has(eid)) poolMap.set(eid, e);
    });
    targets = cleanIds.map((id) => poolMap.get(id)).filter(Boolean);
  } else {
    if (options.venue) {
      const vQuery = options.venue.toLowerCase();
      targets = targets.filter((e) => (e.venue || e.venue_name || "").toLowerCase().includes(vQuery));
    }

    if (options.quarantine || options.quarantined) {
      // User explicitly requested to scan quarantined events from manual review queue
      targets = queue.quarantinedEvents.map((q) => {
        q._isFromQuarantine = true;
        return q;
      });
    } else if (options.all || options.force) {
      // User explicitly requested to scan through ALL events (even those already run through)
      targets = [...combinedPool];
    } else if (options.incompleteOnly) {
      // User requested all events that haven't undergone all the scans
      targets = combinedPool.filter(isScanIncomplete);
    } else if (options.stale || options.olderThan) {
      // User requested all events that haven't been scanned in 24 hours, 1 week, etc.
      const durationMs = parseDurationMs(options.stale || options.olderThan);
      if (durationMs !== null) {
        targets = combinedPool.filter((e) => isEventStale(e, durationMs));
      } else {
        console.warn(`⚠️ Unrecognized duration format: "${options.stale || options.olderThan}". Supported formats: 24h, 48h, 7d, 1w, 30d, 1m.`);
      }
    } else if (options.unverifiedOnly !== false) {
      // Prioritize events that don't have a proof keyframe or pulse qc timestamp
      const isUnverified = (e) => {
        const isFree = e.price === 0 || e.isFree || e.pricingType === "free" || e.access_model === "open_public_space";
        const hasPulse = Boolean(e.last_pulse_qc_at || e.last_full_qc_at || e.last_qc_audited_at);
        const isApproved = isVerifiedApprovalStatus(e.approval_status);
        const hasProof = isFree ? true : Boolean(e.proof_keyframes?.cart || e.proof_keyframe);
        return !hasPulse || !isApproved || !hasProof;
      };

      const unverifiedActive = events.filter((e) => !archivedIds.has(String(e.id || e.event_id).toLowerCase()) && isUnverified(e));
      
      const isQuarantineScan = Boolean(options.quarantine || options.quarantined || options.scope === "quarantined");
      if (isQuarantineScan) {
        const unverifiedQuarantine = queue.quarantinedEvents
          .filter((q) => {
            const qId = String(q.id || q.event_id || "").toLowerCase();
            if (activeIds.has(qId) || archivedIds.has(qId)) return false;
            // Skip cards that have already fatally failed unless force is explicitly passed
            if (!options.force && (q.reviewStatus === "quarantined_stub" || q.reviewStatus === "quarantined_fatal" || q.reviewStatus === "quarantined_expired" || q.reviewStatus === "quarantined_geo")) {
              return false;
            }
            return isUnverified(q);
          })
          .map((q) => {
            q._isFromQuarantine = true;
            return q;
          });
        targets = unverifiedQuarantine;
      } else {
        targets = unverifiedActive;
      }
    }

    // Stagehand Live Cart QC only runs on paid / ticketed events (free public parks & drop-in spaces are grounded via Google Maps / Venue Detailer)
    targets = targets.filter(isTicketedOrPaidEvent);

    // Offset only applies when paginating a sequential scan across catalog, NOT when targeting specific event ID(s)
    if (options.offset) {
      targets = targets.slice(options.offset);
    }
  }

  const limit = options.limit !== undefined ? options.limit : (options.all ? 0 : 5);
  if (limit > 0 && !hasSpecificId) {
    targets = targets.slice(0, limit);
  }

  console.log(`\n================================================================`);
  console.log(`🚀 STAGEHAND BATCH QC ENGINE — 0XX–8XX CANONICAL ARCHITECTURE`);
  console.log(`📊 Catalog Size: ${events.length} events`);
  console.log(`🎯 Targets Queued for Audit: ${targets.length} events`);
  console.log(`================================================================\n`);

  if (options.dryRun) {
    console.log(`🔎 DRY RUN MODE — Target Queue Preview:`);
    targets.forEach((t, i) => {
      console.log(`[#${i + 1}] ${t.id || t.event_id} | ${t.venue || t.venue_name} | ${t.title || t.event_name}`);
      console.log(`    URL: ${t.ticket_url || t.details_url || t.websiteUrl}`);
    });
    return;
  }

  const auditResults = [];
  const overallStart = Date.now();

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    console.log(`\n────────────────────────────────────────────────────────────────`);
    console.log(`📌 Processing [${i + 1}/${targets.length}]: ${target.title || target.event_name} [${target.id || target.event_id}]`);
    logCuratorInfo({
      eventId: target.id || target.event_id,
      title: target.title || target.event_name,
      venue: target.venue || target.venue_name,
      existingCard: target,
      prefix: "   "
    });
    console.log(`────────────────────────────────────────────────────────────────`);

    // Watchdog: Max 90s per event card to prevent stalled web pages
    let result;
    const timeoutMs = 90000;
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`Event audit timed out after ${timeoutMs / 1000}s`)), timeoutMs);
    });

    try {
      result = await Promise.race([
        auditSingleEventCard(target, venuesDb, apiKey),
        timeoutPromise,
      ]);
    } catch (raceErr) {
      console.warn(`⏰ Watchdog timeout on event (${target.id || target.event_id}): ${raceErr.message}`);
      result = {
        success: false,
        eventId: target.id || target.event_id,
        status: "TIMEOUT_EXCEEDED",
        error: raceErr.message,
        card: target,
      };
    } finally {
      clearTimeout(timeoutHandle);
    }
    auditResults.push(result);

    // Persist to Layer Store (layer_box_office.json)
    // In accordance with the Single Publisher architecture, only Compiler AI publishes to data/events.json and graduates/evicts from manual_review_queue.json!
    const boxOfficeLayerPath = path.join(DATA_DIR, "layers", "layer_box_office.json");
    if (fs.existsSync(path.dirname(boxOfficeLayerPath))) {
      let boxLayer = [];
      try { boxLayer = JSON.parse(fs.readFileSync(boxOfficeLayerPath, "utf-8")); } catch (_) {}
      const boxEntry = {
        id: result.eventId,
        status: result.status,
        success: Boolean(result.success),
        venue_name: result.card.venue_name || result.card.venue,
        title: result.card.title,
        doors_time: result.card.doors_time || null,
        start_time: result.card.start_time || null,
        end_time: result.card.end_time || null,
        tier1_name: result.card.tier1_name || result.card.dimension_audit?.D201_tier1_name?.value || "General Admission",
        tier1_price_base: result.card.price_base ?? null,
        tier1_price_fee: result.card.price_fee ?? null,
        tier1_price_tax: result.card.price_tax ?? null,
        tier1_price_read: result.card.price_read ?? null,
        tier1_price_calculated: result.card.price_calculated ?? null,
        tier1_discrepancy_delta: result.card.price_delta ?? 0,
        tier1_price_all_in: result.card.price_all_in ?? null,
        tier1_quote: result.card.tier1_quote || result.card.dimension_audit?.D205_tier1_price_read?.evidence_quote || null,
        tier2_name: result.card.tier2_name || result.card.dimension_audit?.D206_tier2_name?.value || null,
        tier2_price_base: result.card.tier2_price_base ?? result.card.dimension_audit?.D207_tier2_price_base?.value ?? null,
        tier2_price_fee: result.card.tier2_price_fee ?? result.card.dimension_audit?.D208_tier2_price_fee?.value ?? null,
        tier2_price_tax: result.card.tier2_price_tax ?? result.card.dimension_audit?.D209_tier2_price_tax?.value ?? null,
        tier2_price_read: result.card.tier2_price_read ?? result.card.dimension_audit?.D210_tier2_price_read?.value ?? null,
        tier2_price_calculated: result.card.tier2_price_calculated ?? result.card.dimension_audit?.D210_tier2_price_calculated?.value ?? null,
        tier2_discrepancy_delta: result.card.tier2_discrepancy_delta ?? result.card.dimension_audit?.D210_tier2_discrepancy_delta?.delta ?? 0,
        tier2_price_all_in: result.card.tier2_price_all_in ?? result.card.dimension_audit?.D210_tier2_price_all_in?.value ?? null,
        tier2_quote: result.card.tier2_quote || result.card.dimension_audit?.D210_tier2_price_read?.evidence_quote || null,
        tier3_name: result.card.tier3_name || result.card.dimension_audit?.D211_tier3_name?.value || null,
        tier3_price_base: result.card.tier3_price_base ?? result.card.dimension_audit?.D212_tier3_price_base?.value ?? null,
        tier3_price_fee: result.card.tier3_price_fee ?? result.card.dimension_audit?.D213_tier3_price_fee?.value ?? null,
        tier3_price_tax: result.card.tier3_price_tax ?? result.card.dimension_audit?.D214_tier3_price_tax?.value ?? null,
        tier3_price_read: result.card.tier3_price_read ?? result.card.dimension_audit?.D215_tier3_price_read?.value ?? null,
        tier3_price_calculated: result.card.tier3_price_calculated ?? result.card.dimension_audit?.D215_tier3_price_calculated?.value ?? null,
        tier3_discrepancy_delta: result.card.tier3_discrepancy_delta ?? result.card.dimension_audit?.D215_tier3_discrepancy_delta?.delta ?? 0,
        tier3_price_all_in: result.card.tier3_price_all_in ?? result.card.dimension_audit?.D215_tier3_price_all_in?.value ?? null,
        tier3_quote: result.card.tier3_quote || result.card.dimension_audit?.D215_tier3_price_read?.evidence_quote || null,
        all_tiers: result.card.tiers || result.card.all_tiers || [],
        is_sold_out: Boolean(result.card.is_sold_out),
        ticket_provider: result.card.ticket_provider || null,
        ticket_url: (result.status && result.status.startsWith("FATAL_")) ? null : (result.card.ticket_url || null),
        failed_url: result.card.failed_url || null,
        dead_urls: Array.isArray(result.card.dead_urls) ? result.card.dead_urls : [],
        proof_keyframe: result.card.proof_keyframes?.cart || null,
        showings: result.card.showings || [],
        description: result.card.description || result.card.dimension_audit?.D310_synopsis?.value || null,
        artist: result.card.artist || null,
        lineup: Array.isArray(result.card.lineup) ? result.card.lineup : [],
        category: result.card.category || null,
        restrictions: result.card.restrictions || null,
        audited_at: new Date().toISOString(),
        error: result.error || null,
        quarantine_reason: result.card.quarantineReason || (result.status === "BUDGET_BREACH" ? "budget_breach_over_50" : (result.status?.startsWith("FATAL_") ? result.status.toLowerCase() : null)),
      };
      const bIdx = boxLayer.findIndex((b) => (b.id || b.event_id) === result.eventId);
      if (bIdx >= 0) { boxLayer[bIdx] = boxEntry; } else { boxLayer.push(boxEntry); }
      fs.writeFileSync(boxOfficeLayerPath, JSON.stringify(boxLayer, null, 2), "utf-8");
      console.log(`💾 Persisted box office audit (${result.eventId} [${result.status}]) to layer_box_office.json [Awaiting Compiler publication]`);
      console.log(`Committed updated event (${result.eventId})`);
    }

    // Record progress in ledger
    recordLedgerEntry(result);

    // Brief cooldown between isolated browser instances
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 2500));
    }
  }

  const totalDuration = Math.round((Date.now() - overallStart) / 1000);
  recordBenchmark(targets.length, totalDuration);

  // Print Final Summary Table
  console.log(`\n================================================================`);
  console.log(`🏁 BATCH QC AUDIT COMPLETE — ${auditResults.length} Events Processed in ${totalDuration}s`);
  console.log(`================================================================`);
  console.log(`| # | Event ID | Venue | Verified Price | Status | Proof Keyframe |`);
  console.log(`|---|----------|-------|----------------|--------|----------------|`);
  auditResults.forEach((r, idx) => {
    const card = r.card || {};
    const keyframe = card.proof_keyframes?.cart ? "YES 📸" : "NO ❌";
    console.log(
      `| ${idx + 1} | ${r.eventId} | ${card.venue || card.venue_name || "N/A"} | ${card.priceLabel || "N/A"} | ${r.status} | ${keyframe} |`
    );
  });
  console.log(`================================================================\n`);
  printAntigravityTimeoutSummary("Stage 2: Stagehand Box Office QC");

  return auditResults;
}

function recordLedgerEntry(result) {
  let ledger = [];
  if (fs.existsSync(LEDGER_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf-8"));
      ledger = Array.isArray(raw) ? raw : (raw.entries || []);
    } catch (e) {}
  }
  ledger.unshift({
    timestamp: new Date().toISOString(),
    event_id: result.eventId,
    target_name: result.card?.title || result.eventId,
    target_type: "event_qc",
    status: result.status,
    success: result.success,
    duration_seconds: result.durationSec || 0,
  });
  if (ledger.length > 500) ledger = ledger.slice(0, 500);
  try {
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2), "utf-8");
  } catch (e) {}
}

function recordBenchmark(count, durationSec) {
  if (!fs.existsSync(BENCHMARKS_PATH)) return;
  try {
    const bench = JSON.parse(fs.readFileSync(BENCHMARKS_PATH, "utf-8"));
    const qc = bench.workflows?.qc_ai || {};
    qc.totalRuns = (qc.totalRuns || 0) + 1;
    qc.lastRun = {
      timestamp: new Date().toISOString(),
      durationSeconds: durationSec,
      durationFormatted: `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`,
      itemsProcessed: count,
      notes: "Stagehand 0XX–8XX Canonical Live Cart QC Batch",
    };
    qc.history = qc.history || [];
    qc.history.unshift({
      timestamp: new Date().toISOString(),
      durationSeconds: durationSec,
      durationFormatted: `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`,
      itemsProcessed: count,
    });
    if (qc.history.length > 50) qc.history = qc.history.slice(0, 50);
    bench.workflows = bench.workflows || {};
    bench.workflows.qc_ai = qc;
    fs.writeFileSync(BENCHMARKS_PATH, JSON.stringify(bench, null, 2), "utf-8");
  } catch (e) {}
}

// CLI Execution Entrypoint
if (process.argv[1] && process.argv[1].endsWith("event_batch_qc.js")) {
  const args = process.argv.slice(2);
  const options = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) options.limit = parseInt(args[++i], 10);
    else if (args[i] === "--offset" && args[i + 1]) options.offset = parseInt(args[++i], 10);
    else if ((args[i] === "--id" || args[i] === "--ids") && args[i + 1]) options.id = args[++i];
    else if (args[i].startsWith("--id=") || args[i].startsWith("--ids=")) options.id = args[i].split("=").slice(1).join("=");
    else if (args[i] === "--venue" && args[i + 1]) options.venue = args[++i];
    else if (args[i] === "--all") {
      options.all = true;
      options.unverifiedOnly = false;
      if (options.limit === undefined) options.limit = 0;
    }
    else if (args[i] === "--force") {
      options.force = true;
      options.unverifiedOnly = false;
    }
    else if (args[i] === "--incomplete-only" || args[i] === "--incomplete") {
      options.incompleteOnly = true;
      options.unverifiedOnly = false;
    }
    else if ((args[i] === "--stale" || args[i] === "--older-than") && args[i + 1]) {
      options.stale = args[++i];
      options.unverifiedOnly = false;
    }
    else if (args[i] === "--quarantine" || args[i] === "--quarantined") {
      options.quarantine = true;
      options.unverifiedOnly = false;
    }
    else if (args[i] === "--dry-run") options.dryRun = true;
  }

  runEventBatchQC(options)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(`💥 Batch QC Aborted: ${err.message}`);
      process.exit(1);
    });
}
