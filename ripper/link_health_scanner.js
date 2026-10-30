import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  isWhitelistedTicketingUrl,
  isTruncatedCheckoutUrl,
  isTruncatedEventPageUrl,
  isGenericDirectoryStub,
  classifyCheckoutLinkTier,
  TICKETING_PLATFORMS
} from "./link_upgrader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const EVENTS_PATH = path.join(DATA_DIR, "events.json");

/**
 * Common soft-404, expired, and closed-ticket markers found in HTML shells
 */
const EXPIRED_STRING_MARKERS = [
  "this event has ended",
  "sales have ended",
  "ticket sales are closed",
  "sales have closed",
  "this event is no longer available",
  "event has ended",
  "event has passed",
  "tickets are currently off-sale",
  "tickets are off-sale",
  "page not found",
  "404 - not found",
  "404 not found",
  "event not found",
  "we couldn't find that event",
  "no events scheduled",
  "registration closed",
  "activity not found",
  "this listing has expired"
];

/**
 * Static file asset extensions that should never be ticket URLs
 */
const STATIC_ASSET_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif",
  ".pdf", ".mp3", ".mp4", ".css", ".js", ".zip"
];

/**
 * Evaluates the health, degradation, and true tier classification of a single URL
 */
export async function scanSingleLinkHealth(url, eventCard = {}, options = {}) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    return {
      healthy: false,
      status: "MISSING_URL",
      detectedTier: "none",
      reason: "Missing or invalid HTTP/HTTPS URL",
      url: url || null,
      checkedAt: new Date().toISOString()
    };
  }

  const cleanUrl = url.trim();

  // Check 1: Static Asset Guard
  const urlLower = cleanUrl.toLowerCase().split("?")[0].split("#")[0];
  if (STATIC_ASSET_EXTENSIONS.some((ext) => urlLower.endsWith(ext))) {
    return {
      healthy: false,
      status: "STATIC_ASSET",
      detectedTier: "invalid",
      reason: `Points to static media asset file (${path.extname(urlLower)})`,
      url: cleanUrl,
      checkedAt: new Date().toISOString()
    };
  }

  // Check 2: Truncated Checkout Stub Guard (Missing Numeric Database IDs)
  if (isTruncatedCheckoutUrl(cleanUrl)) {
    return {
      healthy: false,
      status: "DEGRADED_TRUNCATED_TIER1_STUB",
      detectedTier: "tier1_stub",
      reason: "Ticketing platform checkout link missing required numeric database ID (e.g. Ticketweb/Eventbrite stub)",
      url: cleanUrl,
      checkedAt: new Date().toISOString()
    };
  }

  // Check 2B: Truncated Event Page / Tier 2 Stub Guard (Missing specific event slug)
  if (isTruncatedEventPageUrl(cleanUrl)) {
    return {
      healthy: false,
      status: "DEGRADED_TRUNCATED_TIER2_STUB",
      detectedTier: "tier2_stub",
      reason: "Event details link is a truncated directory stub lacking a specific event slug",
      url: cleanUrl,
      checkedAt: new Date().toISOString()
    };
  }

  // Check 3: Perennial Drop-In Flag (Free parks, beaches, public spaces, or walk-up drop-in attractions)
  const isPerennial =
    eventCard.lifecycle_type === "perennial_drop_in" ||
    eventCard.frequency === "Perennial Drop-In" ||
    eventCard.booking_protocol === "walk_up_only" ||
    eventCard.id === "van50-burnaby-central-railway-mini-train" ||
    (eventCard.isFree && !eventCard.date && (eventCard.venue || "").match(/park|beach|seawall|gallery|garden/i));

  // Check 4: Structural Path Checks (Anti-Organizer, Anti-Aggregator, Anti-Homepage)
  let parsed;
  try {
    parsed = new URL(cleanUrl);
  } catch (err) {
    return {
      healthy: false,
      status: "MALFORMED_URL",
      detectedTier: "invalid",
      reason: `Malformed URL structure: ${err.message}`,
      url: cleanUrl,
      checkedAt: new Date().toISOString()
    };
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const pName = parsed.pathname.toLowerCase().replace(/\/+$/, "");
  const hash = parsed.hash.toLowerCase();

  if (!isPerennial) {
    // Organizer profile detection
    if (pName.startsWith("/o/") || pName.startsWith("/organizer/") || pName.startsWith("/venue/")) {
      return {
        healthy: false,
        status: "FALSE_TIER1_ORGANIZER_PROFILE",
        detectedTier: "tier3",
        reason: "Points to platform organizer profile instead of discrete event cart",
        url: cleanUrl,
        checkedAt: new Date().toISOString()
      };
    }

    // Aggregator search/browse index or generic directory stub
    if (
      pName.startsWith("/d/") ||
      pName === "/events" ||
      pName === "/browse" ||
      pName === "/shows" ||
      pName === "/calendar" ||
      pName === "/schedule" ||
      (pName === "/tickets" && eventCard?.links?.best_tier === "tier1") ||
      isGenericDirectoryStub(cleanUrl)
    ) {
      return {
        healthy: false,
        status: "FALSE_TIER1_DIRECTORY",
        detectedTier: "tier3",
        reason: `Points to broad calendar/directory listing (${pName || "/"}) rather than specific event details page`,
        url: cleanUrl,
        checkedAt: new Date().toISOString()
      };
    }

    // Root venue homepage
    const isRoot = (!pName || pName === "" || pName === "/" || /^\/(home|index(\.html|\.php)?|en|default(\.aspx)?)$/i.test(pName)) && !hash;
    if (isRoot) {
      return {
        healthy: false,
        status: "FALSE_TIER1_HOMEPAGE",
        detectedTier: "tier5",
        reason: "Generic venue homepage; requires deep event page or checkout cart",
        url: cleanUrl,
        checkedAt: new Date().toISOString()
      };
    }
  }

  // Check 4: Fast HTTP Network Probe (Liveness, Redirect Drift & Soft-404)
  const timeoutMs = options.timeoutMs || 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(cleanUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Van50HealthScanner/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      redirect: "follow"
    });

    clearTimeout(timer);

    // Hard HTTP Failures
    if (resp.status === 404 || resp.status === 410) {
      return {
        healthy: false,
        status: "DEGRADED_DEAD_LINK",
        detectedTier: "none",
        httpStatus: resp.status,
        reason: `HTTP ${resp.status} Dead Link / Page Not Found`,
        url: cleanUrl,
        checkedAt: new Date().toISOString()
      };
    }

    if (resp.status >= 500) {
      return {
        healthy: false,
        status: "DEGRADED_SERVER_ERROR",
        detectedTier: "none",
        httpStatus: resp.status,
        reason: `HTTP ${resp.status} Remote Server Error`,
        url: cleanUrl,
        checkedAt: new Date().toISOString()
      };
    }

    const finalUrl = resp.url || cleanUrl;
    let finalParsed;
    try { finalParsed = new URL(finalUrl); } catch (_) { finalParsed = parsed; }
    const finalPath = finalParsed.pathname.replace(/\/+$/, "").toLowerCase();

    // Redirect Drift Detection (e.g. specific show slug redirected back to homepage /)
    if (pName.length > 2 && (finalPath === "" || finalPath === "/" || finalPath === "/home" || finalPath === "/listings/not-found")) {
      return {
        healthy: false,
        status: "DEGRADED_REDIRECT_TO_ROOT",
        detectedTier: "tier5",
        reason: `Specific event slug redirected to root venue homepage or not-found (${finalUrl})`,
        url: cleanUrl,
        finalUrl,
        checkedAt: new Date().toISOString()
      };
    }

    if (isPerennial) {
      const detectedTier = isWhitelistedTicketingUrl(finalUrl) ? "tier1" : "tier2";
      return {
        healthy: true,
        status: detectedTier === "tier1" ? "HEALTHY_TIER1" : "PERENNIAL_PASS",
        detectedTier,
        isPerennial: true,
        reason: detectedTier === "tier1"
          ? "Perennial drop-in with verified Tier 1 online ticketing checkout"
          : "Perennial public access; verified live Tier 2/4 destination page",
        url: cleanUrl,
        finalUrl,
        checkedAt: new Date().toISOString()
      };
    }

    // Inspect first 30KB of HTML body for soft-404 / closed-ticket markers
    let textChunk = "";
    try {
      const reader = resp.body.getReader();
      const { value } = await reader.read();
      if (value) {
        textChunk = new TextDecoder("utf-8").decode(value).toLowerCase();
      }
      reader.cancel();
    } catch (_) {
      // Body reading is best-effort
    }

    if (textChunk) {
      for (const marker of EXPIRED_STRING_MARKERS) {
        if (textChunk.includes(marker)) {
          return {
            healthy: false,
            status: "DEGRADED_EXPIRED",
            detectedTier: "expired",
            reason: `Live page contains event closure marker: "${marker}"`,
            url: cleanUrl,
            finalUrl,
            checkedAt: new Date().toISOString()
          };
        }
      }
    }

    // Determine actual tier classification
    const isWhitelistedT1 = isWhitelistedTicketingUrl(finalUrl) || isWhitelistedTicketingUrl(cleanUrl);
    if (isWhitelistedT1) {
      return {
        healthy: true,
        status: "HEALTHY_TIER1",
        detectedTier: "tier1",
        reason: "Active, verified Tier 1 checkout deep link on whitelisted ticketing platform",
        url: cleanUrl,
        finalUrl,
        checkedAt: new Date().toISOString()
      };
    }

    // Deep event details page on venue website
    if (pName.length > 2) {
      return {
        healthy: true,
        status: "HEALTHY_TIER2_CANDIDATE",
        detectedTier: "tier2",
        reason: "Valid, active Tier 2 event details subpage on venue website; eligible for Tier 1 hunting",
        url: cleanUrl,
        finalUrl,
        checkedAt: new Date().toISOString()
      };
    }

    return {
      healthy: false,
      status: "DEGRADED_UNCERTAIN",
      detectedTier: "tier3",
      reason: "Could not confirm discrete event instance",
      url: cleanUrl,
      finalUrl,
      checkedAt: new Date().toISOString()
    };
  } catch (netErr) {
    clearTimeout(timer);
    return {
      healthy: false,
      status: "DEGRADED_NETWORK_TIMEOUT",
      detectedTier: "none",
      reason: `Network probe failed: ${netErr.message || "Timeout"}`,
      url: cleanUrl,
      checkedAt: new Date().toISOString()
    };
  }
}

/**
 * High-speed parallel scanner across an array of event cards
 */
export async function scanCatalogLinkHealth(eventsList, options = {}) {
  const events = Array.isArray(eventsList) ? eventsList : [];
  const concurrency = options.concurrency || 8;
  const results = [];

  let healthyTier1Count = 0;
  let falseTier1Count = 0;
  let degradedCount = 0;
  let needsHuntCount = 0;
  let perennialCount = 0;

  console.log(`\n================================================================`);
  console.log(`⚡ HIGH-SPEED LINK HEALTH & DEGRADATION SCANNER`);
  console.log(`📊 Total Items to Scan: ${events.length} events (Concurrency: ${concurrency})`);
  console.log(`================================================================\n`);

  for (let i = 0; i < events.length; i += concurrency) {
    const chunk = events.slice(i, i + concurrency);
    const chunkPromises = chunk.map(async (card) => {
      const bestUrl = card.candidate_tier1_url || card.ticket_url || card.details_url || card.websiteUrl || card.source_url;
      const scan = await scanSingleLinkHealth(bestUrl, card, options);

      // Attach diagnostic metadata to card in memory
      card.link_health = scan;
      card.link_health_checked_at = scan.checkedAt;

      // Evaluation logic: Does this card need a Tier 1 Hunt?
      const claimedTier1 = (card.links?.best_tier === "tier1") || (card.best_tier && card.best_tier.toLowerCase().includes("tier 1"));
      const isPerennial = scan.isPerennial;

      if (isPerennial) {
        perennialCount++;
      } else if (scan.healthy && scan.detectedTier === "tier1") {
        healthyTier1Count++;
      } else {
        if (claimedTier1 && scan.detectedTier !== "tier1") {
          falseTier1Count++;
          card.needs_tier1_hunt = true;
          card.link_degraded = true;
          card.link_degraded_reason = scan.reason;
        } else if (!scan.healthy) {
          degradedCount++;
          card.needs_tier1_hunt = true;
          card.link_degraded = true;
          card.link_degraded_reason = scan.reason;
        } else if (scan.detectedTier === "tier2" || scan.detectedTier === "tier3" || scan.detectedTier === "tier5") {
          card.needs_tier1_hunt = true;
        }
        needsHuntCount++;
      }

      return {
        id: card.id || card.event_id,
        title: card.title || card.event_name,
        url: bestUrl,
        scan,
        needsHunt: Boolean(card.needs_tier1_hunt)
      };
    });

    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }

  console.log(`================================================================`);
  console.log(`🏁 LINK HEALTH SWEEP COMPLETE:`);
  console.log(`   Total Scanned:      ${events.length}`);
  console.log(`   Healthy Tier 1s:    ${healthyTier1Count} ✅`);
  console.log(`   Perennial Drop-ins: ${perennialCount} 🌳`);
  console.log(`   False Tier 1s:      ${falseTier1Count} ⚠️`);
  console.log(`   Degraded / Rot:     ${degradedCount} ❌`);
  console.log(`   Queued for Hunt:    ${needsHuntCount} 🎯`);
  console.log(`================================================================\n`);

  return {
    total: events.length,
    healthyTier1Count,
    perennialCount,
    falseTier1Count,
    degradedCount,
    needsHuntCount,
    results
  };
}

// Standalone CLI runner
if (process.argv[1] && process.argv[1].endsWith("link_health_scanner.js")) {
  let events = [];
  try {
    if (fs.existsSync(EVENTS_PATH)) {
      events = JSON.parse(fs.readFileSync(EVENTS_PATH, "utf-8"));
    }
  } catch (e) {
    console.error(`Failed to read events.json: ${e.message}`);
    process.exit(1);
  }

  scanCatalogLinkHealth(events)
    .then((stats) => {
      console.log(`Scan completed in standalone mode. ${stats.needsHuntCount} cards flagged.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Scanner error: ${err.message}`);
      process.exit(1);
    });
}
