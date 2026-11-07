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
import { huntTier1LinkForEvent, resolveTicketTailorDirectCheckoutUrl, resolveViffActiveBookUrl, resolveVsoDirectCheckoutUrl, resolveArtsClubShowUrl } from "./tier1_hunter.js";
import { logCuratorInfo, getCuratorInfo } from "./curator_display.js";
import {
  isAntigravityEngine,
  callAntigravityBoxOfficeExtractor,
  getAntigravityModel,
  formatLogTime,
  recordPipelineTimeoutEvent,
  printAntigravityTimeoutSummary,
  safeUpdateJsonFile,
  runWithConcurrency,
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
 * Rotates `data/backups/` so each backup series (`events_`, `venues_`, `queue_`) retains
 * the `maxPerSeries` most recent snapshots (sorted by file modification time), preventing
 * unbounded disk bloat while preserving full rollback safety.
 */
export function rotateBackupDirectory(maxPerSeries = 10) {
  if (!fs.existsSync(BACKUP_DIR)) return { prunedCount: 0, freedMB: 0 };
  const seriesPrefixes = ["events_", "venues_", "queue_"];
  let prunedCount = 0;
  let freedBytes = 0;

  try {
    const entries = fs
      .readdirSync(BACKUP_DIR)
      .map((name) => {
        const fullPath = path.join(BACKUP_DIR, name);
        try {
          const stat = fs.statSync(fullPath);
          return stat.isFile() ? { name, fullPath, mtimeMs: stat.mtimeMs, size: stat.size } : null;
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);

    for (const prefix of seriesPrefixes) {
      const matching = entries
        .filter((e) => e.name.toLowerCase().startsWith(prefix))
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      if (matching.length > maxPerSeries) {
        const stale = matching.slice(maxPerSeries);
        for (const item of stale) {
          try {
            fs.unlinkSync(item.fullPath);
            prunedCount++;
            freedBytes += item.size;
          } catch (_) {}
        }
      }
    }
  } catch (err) {
    console.warn(`⚠️ [Backup Rotation] Warning pruning stale backups: ${err.message}`);
  }

  const freedMB = Number((freedBytes / (1024 * 1024)).toFixed(2));
  if (prunedCount > 0) {
    console.log(`🧹 [Backup Rotation] Pruned ${prunedCount} old backup snapshot(s) (${freedMB} MB freed), retaining latest ${maxPerSeries} per series.`);
  }
  return { prunedCount, freedMB };
}

/**
 * Creates safety backup before starting batch operations and rotates old snapshots
 */
function createSafetyBackup() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `events_pre_stagehand_qc_${ts}.json`);
  if (fs.existsSync(EVENTS_PATH)) {
    fs.copyFileSync(EVENTS_PATH, backupPath);
    console.log(`🛡️ Safety backup created: ${path.basename(backupPath)}`);
  }
  rotateBackupDirectory(10);
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
    lowerUrl.includes("/page-not-found") ||
    lowerUrl.includes("viewbasket.aspx") ||
    lowerUrl.endsWith("/myaccount") ||
    lowerUrl.includes("/myaccount?")
  ) {
    return { isDead: true, reason: "Redirected to explicit 404/not-found or empty cart/account utility path" };
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
    "this event is no longer available",
    "request unsuccessful. incapsula incident id",
    "your shopping basket is empty",
    "404 error - page not found"
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

  const urlSlugText = String(options.url || "")
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/i, " ")
    .replace(/[^a-z0-9\s]/g, " ");
  const haystack = `${pageTitle || ""} ${pageText || ""} ${urlSlugText}`.toLowerCase();

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
 * Searches the page (and embedded cross-origin iframes) for direct external ticketing platform links,
 * embedded checkout widgets, or "Buy Tickets" buttons.
 */
export async function findDirectTicketingUrl(page) {
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
    "tickit.ca",
    "zeffy.com",
    "exploretock.com",
    "weeztix.com",
    "tickets.tightropetheatre.com",
    "tickets.thecinematheque.ca",
    "purchase.theimprovcentre.ca",
    "tickets.vanartgallery.bc.ca",
    "ticketing.thecultch.com",
    "riotheatretickets.ca",
    "bloomtickets.ca",
    "humanitix.com",
    "admitonelive.com",
    "tickets.admitone.com",
    "tickets.jflvancouver.com",
    "secure.vancouversymphony.ca",
    "tickets.ubc.ca"
  ];

  const normalizeEmbeddedWidgetUrl = (rawUrl) => {
    if (!rawUrl || typeof rawUrl !== "string") return null;
    try {
      const u = new URL(rawUrl);
      // Convert Eventbrite embedded checkout iframe URL (tickets-external?eid=123) into standalone checkout/event page
      if (u.hostname.includes("eventbrite.") && u.pathname.includes("tickets-external")) {
        const eid = u.searchParams.get("eid");
        if (eid && /^\d+$/.test(eid)) {
          return `https://www.eventbrite.ca/e/${eid}`;
        }
      }
      return rawUrl;
    } catch (_) {
      return rawUrl;
    }
  };

  try {
    // 0. Check Playwright/Stagehand child frames first for cross-origin ticketing widgets
    if (typeof page.frames === "function") {
      const currentMainUrl = String((await page.url()) || "");
      if (!ticketDomains.some((d) => currentMainUrl.toLowerCase().includes(d))) {
        for (const frame of page.frames()) {
          try {
            const fUrl = frame.url() || "";
            if (fUrl && fUrl.startsWith("http") && fUrl !== currentMainUrl) {
              if (ticketDomains.some((d) => fUrl.toLowerCase().includes(d))) {
                const promoted = normalizeEmbeddedWidgetUrl(fUrl);
                const u = new URL(promoted);
                const p = u.pathname.replace(/\/+$/, "");
                if (p && p.length > 2 && p !== "/events" && p !== "/home") {
                  return {
                    href: promoted,
                    text: "embedded_cross_origin_iframe",
                    type: "embedded_ticketing_iframe"
                  };
                }
              }
            }
          } catch (_) { }
        }
      }
    }

    const candidate = await page.evaluate((domains) => {
      const currentHref = window.location.href;

      // If the current page is ALREADY on an official ticketing platform or direct checkout endpoint, stay on it!
      if (
        domains.some((d) => currentHref.toLowerCase().includes(d)) ||
        /viff\.org\/whats-on\/[^/]+\/book\/[a-z0-9_-]+/i.test(currentHref) ||
        /thecultch\.com\/ticket\/[^?]*\?(?:.*(?:EventInstanceId=|WebEventId=))/i.test(currentHref)
      ) {
        return null;
      }

      const anchors = Array.from(document.querySelectorAll("a[href]"));

      // Priority 0.5: Venue-hosted direct Tier 1 checkout links (VIFF /book/<hash> or The Cultch /ticket/?EventInstanceId=...)
      for (const a of anchors) {
        const href = a.href || "";
        if (!href || !href.startsWith("http") || href === currentHref || href.includes("#")) continue;
        if (
          /viff\.org\/whats-on\/[^/]+\/book\/[a-z0-9_-]+/i.test(href) ||
          /thecultch\.com\/ticket\/[^?]*\?(?:.*(?:EventInstanceId=|WebEventId=))/i.test(href)
        ) {
          return {
            href,
            text: (a.innerText || "Choose Seats / Book").trim(),
            type: "venue_direct_checkout_cart"
          };
        }
      }

      // Priority 1: External ticketing platform DEEP link
      for (const a of anchors) {
        const href = a.href || "";
        if (href && href.startsWith("http") && href !== currentHref && !href.includes("#")) {
          // Never traverse to global header/footer/nav cart or account links (e.g. ViewBasket.aspx, /MyAccount)
          if (a.closest("header, nav, footer")) continue;
          const lowerHref = href.toLowerCase();
          if (
            lowerHref.includes("viewbasket.aspx") ||
            lowerHref.includes("/myaccount") ||
            lowerHref.includes("/basket") ||
            lowerHref.includes("/cart") ||
            lowerHref.includes("/login") ||
            lowerHref.includes("/donate") ||
            lowerHref.includes("help.showpass.com") ||
            lowerHref.includes("support.") ||
            lowerHref.includes("/hc/en-us") ||
            // Agile Ticketing (tickets.thecinematheque.ca) blocks direct headless navigation with Imperva Incapsula WAF
            lowerHref.includes("tickets.thecinematheque.ca") ||
            // Do not traverse from physical Cinematheque film pages to watch.eventive.org virtual streaming portals
            (currentHref.toLowerCase().includes("thecinematheque.ca") && lowerHref.includes("eventive.org"))
          ) {
            continue;
          }
          if (domains.some((d) => lowerHref.includes(d))) {
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
            } catch (_) { }
          }
        }
      }

      // Priority 1.5: Embedded cross-origin ticketing <iframe src="..."> in DOM
      const iframes = Array.from(document.querySelectorAll("iframe[src], iframe[data-src]"));
      for (const ifr of iframes) {
        const rawSrc = ifr.src || ifr.getAttribute("data-src") || "";
        if (rawSrc && rawSrc.startsWith("http") && rawSrc !== currentHref) {
          if (domains.some((d) => rawSrc.toLowerCase().includes(d))) {
            return {
              href: rawSrc,
              text: "iframe_widget",
              type: "embedded_ticketing_iframe"
            };
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
          } catch (_) { }
        }
      }

      return null;
    }, ticketDomains);

    if (candidate && candidate.href) {
      candidate.href = normalizeEmbeddedWidgetUrl(candidate.href);
    }
    return candidate;
  } catch (_) {
    return null;
  }
}

/**
 * Multi-Frame DOM Text Aggregator (Iframe & Cross-Origin Fix)
 * Collects visible text from both the top-level document and any accessible child/cross-origin frames
 * so embedded ticketing widgets are never invisible when Stagehand's extension world fails on an iframe.
 * Auto-Dismiss Cookie Banners & Expand Collapsed Accordions / Showtime Popups
 * Prevents Anti-Laziness Bugs 1 & 4 where pricing or showtimes inside collapsed
 * Elementor / BDT accordions (.bdt-ep-accordion-content, details, etc.) or behind
 * CookieYes banners are missed by document.body.innerText and stagehand.extract().
 */
export async function expandAccordionsAndExtractHiddenContext(page) {
  try {
    return await page.evaluate(async () => {
      // 1. Auto-dismiss CookieYes / GDPR / consent banners blocking the viewport
      const cookieSelectors = [
        "#cky-btn-accept",
        ".cky-btn-accept",
        "[data-cky-tag='accept-button']",
        "#onetrust-accept-btn-handler",
        ".cc-btn.cc-allow",
        ".cc-compliance button",
        "button[aria-label*='Accept' i]",
      ];
      for (const sel of cookieSelectors) {
        const btn = document.querySelector(sel);
        if (btn && typeof btn.click === "function") {
          try { btn.click(); } catch (_) { }
        }
      }
      const allButtons = Array.from(document.querySelectorAll("button, a[role='button']"));
      for (const btn of allButtons) {
        const txt = (btn.innerText || btn.textContent || "").trim();
        if (/^(accept|accept all|allow all|i agree|got it)$/i.test(txt)) {
          try { btn.click(); } catch (_) { }
        }
      }

      // 2. Auto-expand collapsed <details>, Elementor hidden animations (.elementor-invisible), and accordion containers in-place
      document.querySelectorAll("details:not([open])").forEach((d) => {
        try { d.open = true; } catch (_) { }
      });
      document.querySelectorAll(".elementor-invisible").forEach((el) => {
        el.classList.remove("elementor-invisible");
        el.style.visibility = "visible";
        el.style.opacity = "1";
      });
      document.querySelectorAll(".bdt-ep-accordion-item, .bdt-accordion-item, .elementor-accordion-item").forEach((item) => {
        item.classList.add("bdt-open", "elementor-active", "active");
      });
      const hiddenAccordionPanels = document.querySelectorAll(
        ".bdt-ep-accordion-content, .bdt-accordion-content, .elementor-tab-content, .accordion-content, .accordion-body, [id*='accordion'] [hidden], #prices"
      );
      hiddenAccordionPanels.forEach((panel) => {
        panel.removeAttribute("hidden");
        panel.style.display = "block";
        panel.style.visibility = "visible";
        panel.style.height = "auto";
        panel.style.maxHeight = "none";
        panel.style.opacity = "1";
      });

      // 3. Collect full textContent from all accordion items, Elementor pricing blocks (#prices), and showtime popups
      const chunks = [];
      const accItems = document.querySelectorAll(
        ".bdt-ep-accordion-item, .bdt-accordion-item, .elementor-accordion-item, .event-instances, .elementor-location-popup, #prices, .elementor-widget-text-editor"
      );
      accItems.forEach((el) => {
        const clone = el.cloneNode(true);
        clone.querySelectorAll("style, script, svg").forEach((s) => s.remove());
        const raw = (clone.textContent || "").replace(/\s+/g, " ").trim();
        if (
          raw.length > 10 &&
          (el.id === "prices" || !el.classList.contains("elementor-widget-text-editor") || /\$\s*\d+|ticket|pricing|admission|section\s+[a-d]/i.test(raw)) &&
          !chunks.includes(raw)
        ) {
          chunks.push(raw);
        }
      });

      // 4. Also extract any direct Choose Seats / Spektrix instance links or iframe sources embedded in popups/page
      const chooseSeatLinks = Array.from(document.querySelectorAll("a.button-choose-seats, a[href*='EventInstanceId='], a[href*='WebEventId='], a[href*='ticketsearchcriteria.aspx?evtinfo='], iframe#SpektrixIFrame[src], iframe[src*='spektrix' i], iframe[src*='thecultch' i]"))
        .map((el) => {
          if (el.tagName && el.tagName.toLowerCase() === "iframe") {
            return `EMBEDDED TICKETING IFRAME SRC: ${el.src}`;
          }
          return `${(el.textContent || "Choose Seats").replace(/\s+/g, " ").trim()}: ${el.href}`;
        })
        .filter(Boolean);
      if (chooseSeatLinks.length > 0) {
        chunks.push(`DIRECT SHOWTIME SEAT LINKS:\n${chooseSeatLinks.slice(0, 8).join("\n")}`);
      }

      // 5. The Cinematheque Box Office Grounding: tickets.thecinematheque.ca (Agile Ticketing) is behind Imperva Incapsula WAF,
      // while standard screening ticket rates ($15 General 18+, $13 Senior 65+, $11 Student, $7 Film Club) are published on /about/visit.
      if (window.location.hostname.includes("thecinematheque.ca")) {
        try {
          const visitRes = await fetch("/about/visit");
          if (visitRes.ok) {
            const visitHtml = await visitRes.text();
            const doc = new DOMParser().parseFromString(visitHtml, "text/html");
            const visitText = (doc.querySelector("main") || doc.body)?.innerText || "";
            if (visitText.trim()) {
              chunks.push(`OFFICIAL VENUE BOX OFFICE TICKET RATES (/about/visit — MANDATORY: Always extract IN-PERSON theatrical screening dates, times, and ticket tiers [$15 General 18+, $13 Senior 65+, $11 Student] as Tier 1/2/3; NEVER use virtual/online stream offers [$12 Online Stream] or stream expiration dates [Nov 30 10:00 pm] as primary showings or Tier 1):\n${visitText.replace(/\s+/g, " ").trim().slice(0, 1500)}`);
            }
          }
        } catch (_) { }
      }

      // 6. VSO Tessitura (secure.vancouversymphony.ca) & UBC Chan Centre (tickets.ubc.ca) Grounding:
      // Auto-dismiss any red "An Error Has Occurred" SYOS modal and capture section price ranges, tier buttons, cart totals, and Additional Series Performances.
      if (window.location.hostname.includes("vancouversymphony.ca") || window.location.hostname.includes("tickets.ubc.ca")) {
        try {
          const closeBtns = Array.from(document.querySelectorAll("button, a[role='button'], .modal button")).filter(
            (b) => /^(close|dismiss|ok)$/i.test((b.innerText || b.textContent || "").trim())
          );
          closeBtns.forEach((b) => { try { b.click(); } catch (_) { } });
          const rawVsoEls = Array.from(
            document.querySelectorAll(
              ".tn-syos-section-list, .tn-ticket-type-list, .tn-cart, .tn-performance-list, [class*='syos' i], [class*='section' i], [class*='price' i], [class*='performance' i], main"
            )
          );
          const vsoBlocks = rawVsoEls
            .map((el) => (el.innerText || "").replace(/\s+/g, " ").trim())
            .filter((t) => t.length > 15 && /\$\s*\d+|orchestra|balcony|general admission|stx-|additional series performances/i.test(t));
          // Sort blocks with explicit dollar prices ($XX.XX) first so sidebar dates never push section prices out of the slice
          const uniqueVsoBlocks = Array.from(new Set(vsoBlocks)).sort((a, b) => {
            const aHasDollar = /\$\s*\d+/.test(a) ? 0 : 1;
            const bHasDollar = /\$\s*\d+/.test(b) ? 0 : 1;
            return aHasDollar - bHasDollar;
          });
          if (uniqueVsoBlocks.length > 0) {
            chunks.push(`VSO / CHAN CENTRE LIVE BOX OFFICE PRICING & SHOWINGS:\n${uniqueVsoBlocks.slice(0, 8).join("\n")}`);
          }
        } catch (_) { }
      }

      // 7. Vancouver Art Gallery (vanartgallery.bc.ca) Grounding:
      // Exhibition and guided tour subpages state "included with Gallery admission" or "Free for members or with Gallery admission"
      // and list "$0" for Youth (18 & Under) without repeating the Adult General Admission rate ($29.00 CAD) on every subpage.
      if (window.location.hostname.includes("vanartgallery.bc.ca")) {
        try {
          const bodyTxt = (document.body ? document.body.innerText : "").replace(/\s+/g, " ");
          if (/included\s+with\s+(?:gallery\s+)?admission|with\s+gallery\s+admission|general\s+admission/i.test(bodyTxt)) {
            chunks.push(
              `OFFICIAL VANCOUVER ART GALLERY BOX OFFICE ADMISSION RATES (vanartgallery.bc.ca/visit — MANDATORY: When an exhibition or tour states "included with Gallery admission" or "Free for members or with Gallery admission", Tier 1 MUST be Adult General Admission at $29.00 CAD; NEVER treat $0 Youth/Member as a free event for adults):\nGeneral Admission – Adult (19+): $29.00 | Youth (18 & Under): $0.00 (Free)`
            );
          }
        } catch (_) { }
      }

      return chunks.join("\n\n").slice(0, 6000);
    });
  } catch (_) {
    return "";
  }
}

/**
 * Multi-Frame DOM Text Aggregator (Iframe, Accordion & Cross-Origin Fix)
 * Collects visible text from both the top-level document, expanded accordions/popups,
 * and any accessible child/cross-origin frames (via Stagehand 4.2.1 page.snapshot({ includeIframes: true }))
 * so embedded ticketing widgets (e.g. SpektrixIFrame, Showpass, Eventbrite) and
 * collapsed Ticket Info accordions are never invisible.
 */
export async function collectAllFramesText(page, extraContextText = "") {
  const sections = [];
  const accordionText = await expandAccordionsAndExtractHiddenContext(page);
  try {
    const mainSnap = await page.evaluate(() => {
      const title = document.title || "";
      if (!document.body) return { title, text: "" };
      // Prune global header/nav/footer/cookie/newsletter boilerplate on a cloned DOM or via targeted text filtering
      // while preserving all main content, modals, dialogs, and checkout widgets.
      const mainContainer = document.querySelector("main, [role='main'], #main, #content, .main-content");
      const modals = Array.from(
        document.querySelectorAll("[role='dialog'], [aria-modal='true'], .modal.show, .modal.in, [class*='checkout' i], [class*='ticket' i], [class*='cart' i]")
      )
        .map((el) => (el.innerText || "").trim())
        .filter((t) => t.length > 15);
      let rawBodyText = "";
      if (mainContainer && (mainContainer.innerText || "").trim().length > 150) {
        rawBodyText = [mainContainer.innerText, ...modals].join("\n\n");
      } else {
        const clone = document.body.cloneNode(true);
        clone
          .querySelectorAll("header, nav, footer, [role='navigation'], [role='contentinfo'], [class*='cookie' i], [id*='cookie' i], [class*='newsletter' i]")
          .forEach((el) => el.remove());
        const clonedText = (clone.innerText || "").trim();
        rawBodyText = clonedText.length > 100 ? clonedText : document.body.innerText || "";
      }
      return { title, text: rawBodyText };
    });
    sections.push(`PAGE TITLE: ${mainSnap.title}`);
    if (accordionText && accordionText.trim().length > 0) {
      sections.push(`\n--- HIGH-SIGNAL EXPANDED ACCORDION & BOX OFFICE PRICING CONTEXT ---\n${accordionText.trim()}`);
    }
    if (extraContextText && extraContextText.trim().length > 0 && extraContextText.trim() !== accordionText.trim()) {
      sections.push(`\n--- PARENT EVENT PAGE ACCORDION & PRICING CONTEXT ---\n${extraContextText.trim()}`);
    }
    sections.push(`\nVISIBLE CART & PAGE TEXT:\n${mainSnap.text}`);
  } catch (_) {
    if (accordionText && accordionText.trim().length > 0) {
      sections.push(`\n--- EXPANDED ACCORDION & SHOWTIME DRAWER TEXT ---\n${accordionText.trim()}`);
    }
  }

  // Stagehand 4.2.1 CDP Multi-Frame Accessibility Snapshot (captures cross-origin iframes like <iframe id="SpektrixIFrame">)
  if (typeof page.snapshot === "function") {
    try {
      const hasIframe = await page.evaluate(() => document.querySelectorAll("iframe").length > 0).catch(() => false);
      if (hasIframe) {
        const cdpSnap = await Promise.race([
          page.snapshot({ includeIframes: true }),
          new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
        ]);
        if (cdpSnap && cdpSnap.formattedTree && cdpSnap.formattedTree.trim().length > 20) {
          sections.push(`\n--- MULTI-FRAME CDP ACCESSIBILITY TREE (INCLUDING CROSS-ORIGIN IFRAMES) ---\n${cdpSnap.formattedTree.trim().slice(0, 8000)}`);
        }
      }
    } catch (_) { }
  }

  if (typeof page.frames === "function") {
    const mainFrame = typeof page.mainFrame === "function" ? page.mainFrame() : null;
    for (const frame of page.frames()) {
      if (mainFrame && frame === mainFrame) continue;
      try {
        const fUrl = frame.url() || "";
        if (!fUrl || fUrl === "about:blank") continue;
        const fText = await frame.evaluate(() => (document.body ? document.body.innerText : ""));
        if (fText && fText.trim().length > 20) {
          sections.push(`\n--- EMBEDDED IFRAME [${fUrl}] ---\n${fText.trim()}`);
        }
      } catch (_) { }
    }
  }
  return sections.join("\n").slice(0, 18000);
}

/**
 * LLM Grounded Web-Search Recovery for Degraded or Tier 3+ Links
 * Triggered when Stagehand fails liveness/entity checks OR when the best link Stagehand has is Tier 3 (calendar) or lower.
 */
export async function llmGroundedWebSearchTierUpgrade(page, currentUrl, eventCard, apiKey) {
  const title = (eventCard.title || eventCard.event_name || "").trim();
  const venue = (eventCard.venue || eventCard.venue_name || "").trim();
  if (!title) return { upgraded: false, reason: "Missing event title" };

  console.log(`🌐🔍 [LLM Grounded Web-Search] Hunting for Tier 1/2 upgrade for "${title}" at "${venue}" (current: ${currentUrl || "none"})...`);

  const candidateUrls = [];
  const seen = new Set([currentUrl, ...(eventCard.dead_urls || [])].filter(Boolean));
  const addCandidate = (u, source) => {
    if (!u || typeof u !== "string" || !u.startsWith("http")) return;
    const clean = u.trim().replace(/&amp;/gi, "&");
    if (seen.has(clean) || !isValidDeepLink(clean)) return;
    if (/vancouver\.ca\/.*\.aspx/i.test(clean)) return; // Rule 2.3 WAF evasion
    seen.add(clean);
    candidateUrls.push({ url: clean, source });
  };

  // 1. Run Gemini with Google Search Grounding (`googleSearch` tool) if valid API key is available
  if (apiKey && apiKey.startsWith("AIzaSy")) {
    try {
      const searchPrompt = `Find the official direct ticket checkout URL (Tier 1: Showpass, Eventbrite, Ticketmaster, TicketWeb, Universe, Spektrix, VTix, AdmitOne) or the dedicated single-event details page (Tier 2) for this Metro Vancouver event:
Event Title: "${title}"
Venue: "${venue}"
Date: "${eventCard.date || "2026"}"
Current (insufficient) URL: "${currentUrl || ""}"

Do NOT return a generic venue homepage or general /calendar or /events directory index. Return ONLY a JSON object:
{
  "tier1_checkout_url": "https://... or null",
  "tier2_event_page_url": "https://... or null",
  "candidates": ["https://..."]
}`;

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.trim()}`;
      const res = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: searchPrompt }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.1 }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const parts = data?.candidates?.[0]?.content?.parts || [];
        const rawText = parts.map((p) => p.text || "").join("\n");
        const firstBrace = rawText.indexOf("{");
        const lastBrace = rawText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            const parsed = JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
            addCandidate(parsed.tier1_checkout_url, "gemini_google_search_tier1");
            addCandidate(parsed.tier2_event_page_url, "gemini_google_search_tier2");
            if (Array.isArray(parsed.candidates)) {
              parsed.candidates.forEach((c) => addCandidate(c, "gemini_google_search_candidate"));
            }
          } catch (_) { }
        }
        // Also extract any grounded web chunk URIs returned in groundingMetadata
        const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
        for (const ch of chunks) {
          if (ch?.web?.uri) addCandidate(ch.web.uri, "gemini_grounding_chunk");
        }
      }
    } catch (gErr) {
      console.warn(`⚠️ [LLM Grounded Web-Search] Gemini search note: ${gErr.message}`);
    }
  }

  // 2. Also run Tier 1 Hunter (which performs Hop 1–3 including DuckDuckGo HTML search)
  try {
    const huntRes = await huntTier1LinkForEvent(eventCard, { useDynamicBrowser: false });
    if (huntRes.success && huntRes.tier1Url) {
      addCandidate(huntRes.tier1Url, `tier1_hunter_${huntRes.method || "auto"}`);
    }
    if (huntRes.tier2Url) {
      addCandidate(huntRes.tier2Url, "tier1_hunter_tier2");
    }
  } catch (_) { }

  // Prioritize whitelisted Tier 1 checkout domains first, then Tier 2 deep event pages
  candidateUrls.sort((a, b) => {
    const aT1 = isWhitelistedTicketingUrl(a.url) ? 1 : 0;
    const bT1 = isWhitelistedTicketingUrl(b.url) ? 1 : 0;
    return bT1 - aT1;
  });

  // 3. Probe candidates in the live Stagehand browser and verify liveness + strict entity match + tier upgrade
  for (const cand of candidateUrls.slice(0, 5)) {
    try {
      const health = await scanSingleLinkHealth(cand.url, eventCard);
      if (!health.healthy && (health.status === "FALSE_TIER1_DIRECTORY" || health.status === "FALSE_TIER1_HOMEPAGE" || health.status === "DEGRADED_DEAD_LINK")) {
        continue;
      }
      if (health.detectedTier !== "tier1" && health.detectedTier !== "tier2") {
        continue;
      }

      console.log(`🧪 [LLM Grounded Web-Search] Probing candidate (${health.detectedTier} via ${cand.source}): ${cand.url}`);
      await page.goto(cand.url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await new Promise((r) => setTimeout(r, 2500));

      const probeInfo = await page.evaluate(() => ({
        title: document.title || "",
        text: document.body ? document.body.innerText : "",
        url: window.location.href,
      }));

      const dead = checkPageDeadOr404(probeInfo);
      const entity = checkEntityMatchesPage(title, probeInfo.title, probeInfo.text, {
        venue,
        date: eventCard.date,
        card: eventCard,
        url: probeInfo.url || cand.url,
      });

      if (!dead.isDead && entity.matches) {
        console.log(`✅ [LLM Grounded Web-Search] Upgraded to verified ${health.detectedTier.toUpperCase()} URL: ${cand.url} (${entity.reason})`);
        return {
          upgraded: true,
          upgradedUrl: cand.url,
          detectedTier: health.detectedTier,
          source: cand.source,
          pageInfo: probeInfo,
        };
      }
    } catch (_) { }
  }

  return { upgraded: false, reason: "No higher-tier verified candidate found via grounded web search" };
}

/**
 * Attempts self-healing recovery when initial target URL is dead or mismatched
 */
export async function recoverEventUrl(page, targetUrl, eventCard, venuesDb) {
  console.log(`🔄 [Self-Healing] Attempting recovery for "${eventCard.title || eventCard.event_name}"...`);

  // 0. Try Curator event-specific Instructed URL first! (Rule 2E: Curator Rules Supreme)
  // Note: Do NOT return curatorInfo.learnedVenueUrl (venue calendar index) before testing eventCard.details_url!
  const curatorInfo = getCuratorInfo({
    eventId: eventCard.id || eventCard.event_id,
    title: eventCard.title || eventCard.event_name,
    venue: eventCard.venue || eventCard.venue_name,
    existingCard: eventCard
  });

  const curatorCandidateUrls = [
    curatorInfo.instructedUrl,
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
        card: eventCard,
        url: pageInfo.url || altUrl,
      });
      if (!deadCheck.isDead && entityCheck.matches) {
        console.log(`✅ [Self-Healing] Success via card alternate URL: ${altUrl}`);
        return { success: true, recoveredUrl: altUrl };
      }
    } catch (_) { }
  }

  // 2. Discover origin domain from targetUrl or venuesDb
  let origin = null;
  try {
    origin = new URL(targetUrl).origin;
  } catch (_) { }

  if (!origin) {
    const vName = (eventCard.venue || eventCard.venue_name || "").toLowerCase();
    const matchedVenue = (venuesDb || []).find((v) => (v.name || v.venue_name || "").toLowerCase().includes(vName));
    if (matchedVenue?.website_url) {
      try { origin = new URL(matchedVenue.website_url).origin; } catch (_) { }
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
          card: eventCard,
          url: recoveredInfo.url || bestCandidate.href,
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
async function safeCloseBrowserSession(ref) {
  if (!ref) return;
  const sh = ref.stagehand;
  const br = ref.browser;
  ref.stagehand = null;
  ref.browser = null;
  if (sh) {
    try {
      await Promise.race([
        sh.close(),
        new Promise((r) => setTimeout(r, 3500))
      ]);
    } catch (_) { }
  }
  if (br) {
    try {
      await Promise.race([
        br.close(),
        new Promise((r) => setTimeout(r, 3500))
      ]);
    } catch (_) { }
  }
}

/**
 * Event-driven DOM readiness & hydration poller.
 * Replaces fixed blind setTimeout sleeps by polling every 200ms after a short minimum paint delay (`minWaitMs`),
 * resolving as soon as the page's visible text and interactive cart/price controls have hydrated and stabilized
 * across two consecutive polls, while preserving `maxWaitMs` as the full ceiling for slow client-side SPAs.
 */
export async function waitForDomReady(page, options = {}) {
  if (!page) return;
  const maxWaitMs = options.maxWaitMs ?? 3500;
  const minWaitMs = options.minWaitMs ?? 450;
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  const minTextLength = options.minTextLength ?? 160;
  const startMs = Date.now();

  if (minWaitMs > 0) {
    await new Promise((r) => setTimeout(r, Math.min(minWaitMs, maxWaitMs)));
  }

  let prevSnapshotKey = null;
  let stableTicks = 0;

  while (Date.now() - startMs < maxWaitMs) {
    try {
      const state = await page.evaluate(() => {
        const readyState = document.readyState;
        const bodyText = document.body ? document.body.innerText || "" : "";
        const textLen = bodyText.trim().length;
        const hasLoadingSpinner = Boolean(
          document.querySelector(
            '[aria-busy="true"], .loading, .spinner, [class*="skeleton" i], [class*="loading-spinner" i]'
          )
        );
        const controlCount = document.querySelectorAll(
          'button, a[href], select, input, [role="button"], [role="dialog"], iframe'
        ).length;
        const hasCommercialSignal = /(\$\s*\d+|ticket|admission|buy|book|select|sold out|free)/i.test(bodyText);
        return {
          readyState,
          textLen,
          hasLoadingSpinner,
          controlCount,
          hasCommercialSignal,
        };
      });

      const snapshotKey = `${state.readyState}:${state.textLen}:${state.controlCount}`;
      const isHydratedEnough =
        (state.readyState === "complete" || state.readyState === "interactive") &&
        !state.hasLoadingSpinner &&
        state.textLen >= minTextLength &&
        (state.hasCommercialSignal || state.controlCount >= 5);

      if (isHydratedEnough && snapshotKey === prevSnapshotKey) {
        stableTicks++;
        if (stableTicks >= 1) {
          return;
        }
      } else {
        stableTicks = 0;
      }
      prevSnapshotKey = snapshotKey;
    } catch (_) {
      // Navigation or execution context transition in progress; continue polling up to maxWaitMs
      stableTicks = 0;
    }

    const remainingMs = maxWaitMs - (Date.now() - startMs);
    if (remainingMs <= 0) break;
    await new Promise((r) => setTimeout(r, Math.min(pollIntervalMs, remainingMs)));
  }
}

/**
 * Interleaves target events by hostname so concurrent Stagehand workers do not hit the same
 * venue or ticketing domain at the exact same instant.
 */
function interleaveTargetsByDomain(targets) {
  if (!Array.isArray(targets) || targets.length <= 2) return targets;
  const buckets = new Map();
  for (const item of targets) {
    const rawUrl = item?.candidate_tier1_url || item?.ticket_url || item?.details_url || item?.websiteUrl || "";
    let host = "unknown";
    try {
      host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    } catch (_) {
      host = String(item?.venue || item?.venue_name || "unknown").toLowerCase().trim();
    }
    if (!buckets.has(host)) buckets.set(host, []);
    buckets.get(host).push(item);
  }
  const interleaved = [];
  const queues = Array.from(buckets.values());
  let added = true;
  while (added) {
    added = false;
    for (const q of queues) {
      if (q.length > 0) {
        interleaved.push(q.shift());
        added = true;
      }
    }
  }
  return interleaved;
}

async function auditSingleEventCard(eventCard, venuesDb, apiKey, sessionRef = null) {
  const eventId = eventCard.id || eventCard.event_id;

  // Rule 1.1 & 1.2 + Anti-Laziness Safety Rails 1 & 2:
  // Stagehand browser bypass is strictly restricted to Venue-Registry Grounded Open Public Spaces (`open_public_space` / `free_public_access` in venues.json)
  // that have ZERO specific calendar dates, ZERO showtimes, ZERO paid prices, and ZERO ticketing portal URLs.
  if (!isTicketedOrPaidEvent(eventCard, venuesDb)) {
    console.log(`🌳 [Venue-Grounded Open Public Space] Bypassing Stagehand checkout cart penetration for "${eventCard.title || eventCard.event_name}" (${eventId}) — verified open_public_space / free_public_access in venues.json.`);
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
    const health = await Promise.race([
      scanSingleLinkHealth(probeUrl, eventCard),
      new Promise((resolve) => setTimeout(() => resolve({ healthy: false, status: "HEALTH_TIMEOUT", reason: "Pre-flight health check timed out (8s)" }), 8000))
    ]);
    // Only launch pre-flight Tier 1 Hunter if the link is unhealthy or if Stage 1B hasn't already audited it
    if (!eventCard.candidate_tier1_url && (!health.healthy || (!eventCard.step1b_audited_at && health.detectedTier !== "tier1"))) {
      console.log(`🏹 [Stagehand Pre-Flight] Link requires hunt (${health.status}: ${health.reason}). Launching Tier 1 Hunter AI...`);
      const huntRes = await Promise.race([
        huntTier1LinkForEvent(eventCard, { useDynamicBrowser: false }),
        new Promise((resolve) => setTimeout(() => resolve({ success: false, reason: "Pre-flight hunt timeout (15s)" }), 15000))
      ]);
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
  let candidateUrl = eventCard.candidate_tier1_url;
  let candidateVerified = false;

  // Upgrade Tightrope Theatre / Ticket Tailor series or modal widget URLs directly to Step 2 Ticket Selection URLs
  for (const urlToUpgrade of [candidateUrl, targetUrl].filter(Boolean)) {
    if (/tightropetheatre\.com\/events\/|tickettailor\.com\/events\//i.test(urlToUpgrade)) {
      const ttUp = await resolveTicketTailorDirectCheckoutUrl(urlToUpgrade, eventCard);
      if (ttUp && ttUp.directCheckoutUrl) {
        console.log(`🎟️ [Ticket Tailor Direct Checkout] Upgraded ${urlToUpgrade} -> ${ttUp.directCheckoutUrl}`);
        targetUrl = ttUp.directCheckoutUrl;
        candidateUrl = ttUp.directCheckoutUrl;
        eventCard.ticket_url = ttUp.directCheckoutUrl;
        eventCard.candidate_tier1_url = ttUp.directCheckoutUrl;
        if (!eventCard.details_url || eventCard.details_url.includes("select-date")) {
          eventCard.details_url = ttUp.seriesEventUrl;
        }
        break;
      }
    }
    if (/viff\.org\/whats-on\//i.test(urlToUpgrade)) {
      const viffUp = await resolveViffActiveBookUrl(urlToUpgrade, eventCard);
      if (viffUp && viffUp.directCheckoutUrl) {
        if (viffUp.wasRefreshed) {
          console.log(`🎬 [VIFF Active Screening Upgrade] Refreshed concluded/parent VIFF link ${urlToUpgrade} -> ${viffUp.directCheckoutUrl}`);
        }
        targetUrl = viffUp.directCheckoutUrl;
        candidateUrl = viffUp.directCheckoutUrl;
        eventCard.ticket_url = viffUp.directCheckoutUrl;
        eventCard.candidate_tier1_url = viffUp.directCheckoutUrl;
        eventCard.details_url = viffUp.seriesEventUrl;
        break;
      }
    }
    if (/vancouversymphony\.ca\/(?:event|series)\//i.test(urlToUpgrade)) {
      const vsoUp = await resolveVsoDirectCheckoutUrl(urlToUpgrade, eventCard);
      if (vsoUp && vsoUp.directCheckoutUrl) {
        console.log(`🎻 [VSO Tessitura Direct Checkout] Upgraded ${urlToUpgrade} -> ${vsoUp.directCheckoutUrl}`);
        targetUrl = vsoUp.directCheckoutUrl;
        candidateUrl = vsoUp.directCheckoutUrl;
        eventCard.ticket_url = vsoUp.directCheckoutUrl;
        eventCard.candidate_tier1_url = vsoUp.directCheckoutUrl;
        eventCard.details_url = vsoUp.seriesEventUrl;
        break;
      }
    }
  }

  let preservedViffBookUrl = null;
  for (const u of [candidateUrl, targetUrl].filter(Boolean)) {
    if (
      /^https?:\/\/(?:www\.)?viff\.org\/whats-on\/[^/]+\/book\/[^/]+/i.test(String(u)) ||
      /^https?:\/\/tickets\.thecinematheque\.ca\/.*evtinfo=/i.test(String(u)) ||
      /^https?:\/\/secure\.vancouversymphony\.ca\/\d+/i.test(String(u)) ||
      /^https?:\/\/tickets\.ubc\.ca\/online\//i.test(String(u))
    ) {
      preservedViffBookUrl = u;
      break;
    }
  }

  // Agile Ticketing (tickets.thecinematheque.ca) serves an Imperva Incapsula WAF challenge to headless browsers;
  // navigate Stagehand directly to the verified thecinematheque.ca/films/... page while preserving the evtinfo= checkout URL.
  if (
    targetUrl &&
    targetUrl.toLowerCase().includes("tickets.thecinematheque.ca") &&
    eventCard.details_url &&
    eventCard.details_url.toLowerCase().includes("thecinematheque.ca/")
  ) {
    targetUrl = eventCard.details_url;
    candidateUrl = null;
  }

  // VSO Tessitura (secure.vancouversymphony.ca/<prodId>/<perfId>): Append ?z=0 on initial navigation so Tessitura
  // server-renders the full event title, Available Sections, and Adult/Senior/Student/Child pricing without relying on
  // the client-side SYOS XHR (/api/syos/GetInitData) that Imperva reese84 blocks on cold headless loads.
  if (targetUrl && /^https?:\/\/secure\.vancouversymphony\.ca\/\d+\/\d+\/?$/i.test(targetUrl)) {
    targetUrl = targetUrl.replace(/\/+$/, "") + "?z=0";
  }
  if (candidateUrl && /^https?:\/\/secure\.vancouversymphony\.ca\/\d+\/\d+\/?$/i.test(candidateUrl)) {
    candidateUrl = candidateUrl.replace(/\/+$/, "") + "?z=0";
  }

  // Arts Club Show Slug Resolver (Patch E): Upgrade generic https://artsclub.com/shows/ to the dedicated show page
  if (targetUrl && /^https?:\/\/(?:www\.)?artsclub\.com\/shows\/?(?:[#?].*)?$/i.test(targetUrl)) {
    const acResolved = await resolveArtsClubShowUrl(targetUrl, eventCard);
    if (acResolved && acResolved.directShowUrl) {
      console.log(`🎭 [Arts Club Show Resolver] Upgraded generic index ${targetUrl} -> ${acResolved.directShowUrl}`);
      targetUrl = acResolved.directShowUrl;
      eventCard.ticket_url = acResolved.directShowUrl;
      eventCard.details_url = acResolved.directShowUrl;
    }
  }

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
    browser = await localBrowser.launch({ headless: true, args: ["--mute-audio"] });
    if (sessionRef) sessionRef.browser = browser;
    stagehand = await Stagehand.create({
      browser,
      model: {
        modelName: "google/gemini-3.8-flash",
        apiKey: apiKey.trim(),
      },
    });
    if (sessionRef) sessionRef.stagehand = stagehand;

    let page = null;

    // Stagehand Verification Gate: Probe candidate Tier 1 checkout URL if staged
    if (candidateUrl && candidateUrl.startsWith("http") && candidateUrl !== targetUrl) {
      console.log(`🎯 [Stagehand Gate] Probing staged candidate Tier 1 checkout lead first: ${candidateUrl}`);
      try {
        const candidatePage = await stagehand.browser.context.newPage(candidateUrl);
        await waitForDomReady(candidatePage, { maxWaitMs: 3500, minWaitMs: 450 });

        const candInfo = await candidatePage.evaluate(() => ({
          title: document.title || "",
          text: document.body ? document.body.innerText : "",
          url: window.location.href,
        }));

        const candDead = checkPageDeadOr404(candInfo);
        const candEntity = checkEntityMatchesPage(eventCard.title || eventCard.event_name, candInfo.title, candInfo.text, {
          venue: eventCard.venue || eventCard.venue_name,
          date: eventCard.date,
          card: eventCard,
          url: candInfo.url || candidateUrl,
        });

        if (!candDead.isDead && candEntity.matches) {
          console.log(`✅ [Stagehand Gate] Candidate Tier 1 URL verified on live page! Grounded match confirmed.`);
          targetUrl = candidateUrl;
          page = candidatePage;
          candidateVerified = true;
        } else {
          console.warn(`⚠️ [Stagehand Gate] Candidate Tier 1 URL rejected: ${candDead.isDead ? candDead.reason : candEntity.reason}. Discarding lead and falling back to Tier 2/3.`);
          eventCard.candidate_tier1_rejected_reason = candDead.isDead ? candDead.reason : candEntity.reason;
          await candidatePage.close().catch(() => { });
        }
      } catch (candErr) {
        console.warn(`⚠️ [Stagehand Gate] Note testing candidate lead: ${candErr.message}. Falling back.`);
      }
    }

    if (!page) {
      console.log(`🌐 [1/4] Navigating to destination page: ${targetUrl}...`);
      page = await stagehand.browser.context.newPage(targetUrl);
      await waitForDomReady(page, { maxWaitMs: 3500, minWaitMs: 450 });
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
      } catch (_) { }
      const bodyTextLen = (document.body ? document.body.innerText : "").trim().length;
      const hasHardInterstitial = Boolean(
        document.querySelector(
          'iframe[src*="captcha-delivery.com"], iframe[src*="datadome"], script[src*="captcha-delivery.com"], script[src*="datadome"], #cf-challenge-running, #challenge-running, #px-captcha'
        )
      );
      const hasPassiveTurnstileOrRecaptcha = Boolean(
        document.querySelector(
          'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], iframe[src*="hcaptcha"], iframe[src*="recaptcha"]'
        )
      );
      const hasAntiBotChallenge = hasHardInterstitial || (hasPassiveTurnstileOrRecaptcha && bodyTextLen < 250);
      return {
        title: document.title || "",
        text: document.body ? document.body.innerText : "",
        url: window.location.href,
        ldJson,
        hasAntiBotChallenge,
      };
    });

    let deadCheck = checkPageDeadOr404(pageInfo);
    const trimmedTitle = String(pageInfo.title || "").trim();
    const trimmedBodyText = String(pageInfo.text || "").trim();
    const isAntiBotBlocked =
      Boolean(pageInfo.hasAntiBotChallenge) ||
      /^(?:just a moment|attention required|access denied|access blocked|pardon our interruption|ra\.co|security check)/i.test(trimmedTitle) ||
      /performing security verification|verify you are human|enable js and disable any ad blocker|please verify you are a human|unusual activity from your network|datadome/i.test(trimmedBodyText) ||
      (/ra\.co\/events\/\d+/i.test(targetUrl) && trimmedBodyText.length < 80);

    if (isAntiBotBlocked) {
      console.warn(`🛑 [Anti-Bot Gate] Target URL ${targetUrl} presented a security verification challenge ("${pageInfo.title}"). Stopping without bypassing or poisoning URL.`);
      return {
        success: false,
        eventId,
        status: "ANTIBOT_CHALLENGE_BLOCKED",
        error: "Target page gated by anti-bot security verification challenge",
        card: {
          ...eventCard,
          quarantineReason: "antibot_challenge_blocked",
          quarantine_reason: "antibot_challenge_blocked",
          last_qc_audited_at: new Date().toISOString(),
        },
      };
    }
    let entityCheck = checkEntityMatchesPage(eventCard.title || eventCard.event_name, pageInfo.title, pageInfo.text, {
      venue: eventCard.venue || eventCard.venue_name,
      date: eventCard.date,
      card: eventCard,
      url: pageInfo.url || targetUrl,
    });

    // If initial page is dead or fails entity matching, attempt self-healing recovery (+ LLM Grounded Web-Search fallback)!
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
          card: eventCard,
          url: pageInfo.url || targetUrl,
        });
      }

      // If local directory self-healing still failed, trigger LLM Grounded Web-Search Recovery!
      if (deadCheck.isDead || !entityCheck.matches) {
        const llmRecovery = await llmGroundedWebSearchTierUpgrade(page, targetUrl, eventCard, apiKey);
        if (llmRecovery.upgraded && llmRecovery.upgradedUrl) {
          targetUrl = llmRecovery.upgradedUrl;
          pageInfo = llmRecovery.pageInfo || await page.evaluate(() => ({
            title: document.title || "",
            text: document.body ? document.body.innerText : "",
            url: window.location.href,
          }));
          deadCheck = checkPageDeadOr404(pageInfo);
          entityCheck = checkEntityMatchesPage(eventCard.title || eventCard.event_name, pageInfo.title, pageInfo.text, {
            venue: eventCard.venue || eventCard.venue_name,
            date: eventCard.date,
            card: eventCard,
            url: pageInfo.url || targetUrl,
          });
          if (llmRecovery.detectedTier === "tier1") {
            candidateVerified = true;
          }
        }
      }

      if (deadCheck.isDead || !entityCheck.matches) {
        const poisonedUrls = Array.from(new Set([...(eventCard.dead_urls || []), targetUrl].filter(Boolean)));
        const failedCard = {
          ...eventCard,
          ticket_url: null,
          failed_url: targetUrl,
          dead_urls: poisonedUrls,
          last_qc_audited_at: new Date().toISOString(),
        };
        if (deadCheck.isDead) {
          console.warn(`❌ Fatal Gate 4 Breach: Link is dead or 404 (${deadCheck.reason}). Self-healing & LLM search failed.`);
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

    // Pre-navigation Accordion & Cookie Hygiene: Expand collapsed accordions (e.g. The Cultch "Ticket Info")
    // on the initial event page BEFORE following external/secondary links so parent-page pricing is never lost!
    const parentAccordionContext = await expandAccordionsAndExtractHiddenContext(page);

    // Direct Ticketing Button, Cross-Origin Iframe & External Portal Traversal
    const ticketingTarget = await findDirectTicketingUrl(page);
    let checkoutUrl = targetUrl;
    const currentLivePageUrl = (await page.url().catch(() => "")) || pageInfo?.url || targetUrl;
    if (
      ticketingTarget &&
      ticketingTarget.href &&
      ticketingTarget.href !== currentLivePageUrl
    ) {
      console.log(`🎟️ Traversed to ticketing checkout portal: ${ticketingTarget.href} (${ticketingTarget.type})`);
      const previousUrl = currentLivePageUrl;
      checkoutUrl = ticketingTarget.href;
      try {
        await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        await waitForDomReady(page, { maxWaitMs: 3500, minWaitMs: 450 });
        await expandAccordionsAndExtractHiddenContext(page);

        // Pre-Modal Entity & Liveness Guard on traversed ticketing portal
        const portalInfo = await page.evaluate(() => ({
          title: document.title || "",
          text: document.body ? document.body.innerText : "",
          url: window.location.href,
        }));
        const portalDead = checkPageDeadOr404(portalInfo);
        const portalEntity = checkEntityMatchesPage(
          eventCard.title || eventCard.event_name,
          portalInfo.title,
          portalInfo.text,
          {
            venue: eventCard.venue || eventCard.venue_name,
            date: eventCard.date,
            card: eventCard,
            url: portalInfo.url || checkoutUrl,
          }
        );

        if (portalDead.isDead || !portalEntity.matches) {
          console.warn(
            `⚠️ [Portal Traversal Guard] Traversed link ${checkoutUrl} failed verification (${portalDead.isDead ? portalDead.reason : portalEntity.reason}). Reverting to verified event page: ${previousUrl}`
          );
          checkoutUrl = targetUrl;
          await page.goto(previousUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
          await waitForDomReady(page, { maxWaitMs: 2500, minWaitMs: 350 });
          await expandAccordionsAndExtractHiddenContext(page);
        } else {
          pageInfo = { ...pageInfo, ...portalInfo };
        }
      } catch (navErr) {
        console.warn(`⚠️ Note navigating to ticketing portal: ${navErr.message}`);
        checkoutUrl = targetUrl;
      }
    }

    // Hybrid Tier-3 Gate: If the best URL Stagehand has after button/iframe traversal is still Tier 3 (calendar/directory) or lower,
    // trigger LLM Grounded Web-Search Recovery to track down a Tier 1 checkout cart or Tier 2 dedicated event page!
    try {
      const currentLinkHealth = await scanSingleLinkHealth(checkoutUrl, eventCard);
      const isTier3OrLower =
        !isWhitelistedTicketingUrl(checkoutUrl) &&
        (currentLinkHealth.detectedTier === "tier3" ||
          currentLinkHealth.detectedTier === "tier4" ||
          currentLinkHealth.detectedTier === "tier5" ||
          currentLinkHealth.status === "FALSE_TIER1_DIRECTORY" ||
          currentLinkHealth.status === "FALSE_TIER1_HOMEPAGE");

      if (isTier3OrLower) {
        console.log(`🏹 [Hybrid Tier-3 Recovery Gate] Best Stagehand URL is capped at ${currentLinkHealth.detectedTier.toUpperCase()} (${checkoutUrl}). Triggering LLM Grounded Web-Search...`);
        const preSearchUrl = (await page.url().catch(() => "")) || checkoutUrl;
        const tierUpgrade = await llmGroundedWebSearchTierUpgrade(page, checkoutUrl, eventCard, apiKey);
        if (tierUpgrade.upgraded && tierUpgrade.upgradedUrl) {
          targetUrl = tierUpgrade.upgradedUrl;
          checkoutUrl = tierUpgrade.upgradedUrl;
          pageInfo = tierUpgrade.pageInfo || pageInfo;
          if (tierUpgrade.detectedTier === "tier1") {
            candidateVerified = true;
          }
          // If upgraded to a Tier 2 event page, check if that page has a direct Tier 1 button/iframe
          if (tierUpgrade.detectedTier === "tier2") {
            const subTicketing = await findDirectTicketingUrl(page);
            const postUpgradePageUrl = (await page.url().catch(() => "")) || checkoutUrl;
            if (subTicketing && subTicketing.href && subTicketing.href !== postUpgradePageUrl) {
              console.log(`🎟️ [Hybrid Tier-3 Recovery Gate] Found Tier 1 portal on upgraded Tier 2 page: ${subTicketing.href}`);
              await page.goto(subTicketing.href, { waitUntil: "domcontentloaded", timeout: 25000 });
              await waitForDomReady(page, { maxWaitMs: 3000, minWaitMs: 450 });
              checkoutUrl = subTicketing.href;
              candidateVerified = true;
            }
          }
        } else {
          const afterSearchUrl = (await page.url().catch(() => "")) || "";
          if (afterSearchUrl && afterSearchUrl !== preSearchUrl) {
            await page.goto(preSearchUrl, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => { });
          }
        }
      }
    } catch (t3Err) {
      console.warn(`⚠️ [Hybrid Tier-3 Recovery Gate] Note: ${t3Err.message}`);
    }

    // [2/4] Interactive Box Office Drawer Penetration (with Safety Rail 3: Non-Cart Walk-Up / Perennial Gate)
    console.log(`🎟️ [2/4] Evaluating page for interactive ticket / cart modal...`);
    try {
      const cartDomInspection = await page.evaluate(() => {
        const text = (document.body ? document.body.innerText : "").toLowerCase();
        const currentUrl = window.location.href.toLowerCase();
        const isKnownTicketPlatform = /showpass\.|eventbrite\.|ticketmaster\.|spektrix\.|universe\.|ticketweb\.|admitone\.|admitonelive\.|riotheatretickets\.|bloomtickets\.|humanitix\.|jflvancouver\.|secure\.vancouversymphony\.ca|tickets\.ubc\.ca|dice\.fm|ovationtix\.|vtixonline\.|tickit\.ca|zeffy\.|exploretock\.|weeztix\./i.test(currentUrl);

        // Check actual interactive elements (buttons, links, inputs, selects, dialogs) for cart/checkout triggers
        const clickables = Array.from(document.querySelectorAll('button, a[href], [role="button"], input[type="button"], input[type="submit"]'));
        const hasActionableTicketTrigger = clickables.some((el) => {
          const label = `${el.innerText || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("title") || ""} ${el.value || ""}`.trim().toLowerCase();
          if (!label || label.length > 80) return false;
          return /\b(buy\s*tickets?|buy\s*now|find\s*tickets?|get\s*tickets?|purchase\s*tickets?|book\s*tickets?|book\s*now|select\s*a?\s*date|add\s*to\s*cart|checkout|register\s*now|reserve\s*spot|tickets?\s*checkout)\b/i.test(label);
        });

        const hasQuantityControls = Boolean(
          document.querySelector('input[type="number"], select[name*="ticket" i], select[name*="qty" i], button[aria-label*="increase" i], button[aria-label*="plus" i], button[aria-label*="add" i], [class*="quantity" i], [class*="ticket-tier" i]')
        );

        const hasTicketingIframe = Array.from(document.querySelectorAll("iframe[src]")).some((ifr) =>
          /showpass|eventbrite|ticketmaster|spektrix|universe|ticketweb|admitone|admitonelive|riotheatretickets|bloomtickets|humanitix|ovationtix|vtix|tickit|zeffy|tock|weeztix/i.test(ifr.src || "")
        );

        const isStaticWalkUpOrPerennial =
          !isKnownTicketPlatform &&
          !hasActionableTicketTrigger &&
          !hasQuantityControls &&
          !hasTicketingIframe &&
          (/\b(walk[- ]?up|first[- ]come|no\s+reservations?|pay\s+at\s+the\s+door|at\s+the\s+gate|pitch\s*(?:&|and)\s*putt|daily\s+admission|general\s+admission\s+rates)\b/i.test(text) ||
            !text.includes("cart"));

        const isAlreadyOnDirectCartPage =
          /\/whats-on\/[^/]+\/book\/|\/ticket\/.*[?&](?:eventinstanceid|webeventid)=|chooseseats\.aspx|\/checkout\/|secure\.vancouversymphony\.ca\/\d+|tickets\.ubc\.ca\/online\//i.test(currentUrl);

        const isCinemathequeFilmPage = currentUrl.includes("thecinematheque.ca/");

        return {
          hasInteractiveCart: !isCinemathequeFilmPage && Boolean(isKnownTicketPlatform || isAlreadyOnDirectCartPage || hasActionableTicketTrigger || hasQuantityControls || hasTicketingIframe),
          isAlreadyOnDirectCartPage,
          hasQuantityControls,
          isStaticWalkUpOrPerennial: isCinemathequeFilmPage || isStaticWalkUpOrPerennial,
        };
      });

      if (cartDomInspection.hasInteractiveCart) {
        await expandAccordionsAndExtractHiddenContext(page);
        // Skip Act 1 ("Buy Tickets" modal trigger) if we are already on a direct checkout cart or quantity controls are already rendered
        if (!cartDomInspection.isAlreadyOnDirectCartPage && !cartDomInspection.hasQuantityControls) {
          const clickedBuyViaDom = await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button, a[href], [role="button"]')).filter((b) => !b.disabled && b.offsetParent !== null);
            for (const b of btns) {
              const t = (b.innerText || b.getAttribute("aria-label") || "").trim().toLowerCase();
              if (/^(buy\s*now|find\s*tickets?|buy\s*tickets?|get\s*tickets?|book\s*tickets?|choose\s*seats)$/i.test(t)) {
                b.click();
                return true;
              }
            }
            return false;
          }).catch(() => false);

          if (!clickedBuyViaDom) {
            await Promise.race([
              stagehand.act(
                "If there is a 'Tickets', 'Buy Now', 'Find Tickets', 'Buy Tickets', 'Get Tickets', 'Book Your Seats', or 'Register' button, click it to open the cart modal. Dismiss any cookie banners first if present."
              ),
              new Promise((_, reject) => setTimeout(() => reject(new Error("Cart button act timeout")), 12000))
            ]).catch((e) => console.log(`ℹ️ [Act 1] ${e.message}`));
          }

          await waitForDomReady(page, { maxWaitMs: 2000, minWaitMs: 350 });
        } else {
          console.log(`⚡ [Act 1 Bypass] Already on direct checkout cart or quantity controls visible — advancing directly to seat/quantity selection.`);
        }

        // Act 1.5 (Intermediate Date / Time Slot Picker Navigation):
        // If an intermediate "Select a Date", "Choose a Date", or calendar day/time list is displayed,
        // click the first available date or matching event date button to navigate to the ticket tier drawer!
        // Act 1.5 (Intermediate Date / Time Slot Picker & "Choose Seats" Drawer Navigation):
        // If an intermediate "Select a Date", "Choose a Date", "Tickets & Showtimes", or "Choose Seats" list is displayed,
        // click the first available date or "CHOOSE SEATS" button to penetrate to the ticket tier drawer!
        try {
          const dateModalVisible = await page.evaluate(() => {
            const bodyText = (document.body ? document.body.innerText : "").toLowerCase();
            return (
              bodyText.includes("select a date") ||
              bodyText.includes("choose a date") ||
              bodyText.includes("select date") ||
              bodyText.includes("select time") ||
              bodyText.includes("choose a time") ||
              bodyText.includes("tickets & showtimes") ||
              bodyText.includes("choose seats") ||
              bodyText.includes("select seats")
            );
          });

          if (dateModalVisible) {
            console.log(`📅 [Act 1.5 - Date / Seat Picker] Intermediate date or seat selection list detected. Selecting slot...`);
            // DOM-level click for Showpass / Cultch "CHOOSE SEATS" / dialog cards first for speed and reliability
            const clickedDom = await page.evaluate(() => {
              const chooseSeatBtn = document.querySelector("a.button-choose-seats, a[href*='EventInstanceId='], a[href*='WebEventId=']");
              if (chooseSeatBtn && chooseSeatBtn.href) {
                chooseSeatBtn.click();
                return true;
              }
              const cards = Array.from(document.querySelectorAll('[role="dialog"] button, [role="dialog"] a, [role="dialog"] [class*="card"], [class*="modal"] button, [class*="modal"] a, [class*="drawer"] button, .chakra-modal__body button, [class*="date-item"], .event-row a'));
              for (const c of cards) {
                const txt = (c.innerText || "").toLowerCase();
                if (txt.includes("choose seats") || txt.includes("select seats") || txt.includes("2026") || txt.includes("2027") || txt.includes("oct") || txt.includes("nov") || txt.includes("dec") || txt.includes("jan") || txt.includes("feb") || txt.includes("am") || txt.includes("pm") || txt.includes("starts")) {
                  c.click();
                  return true;
                }
              }
              return false;
            });

            if (!clickedDom) {
              await Promise.race([
                stagehand.act(
                  "If 'Select a Date', 'Tickets & Showtimes', or 'Choose Seats' is shown, click on the first available 'Choose Seats' or date option to reveal the ticket tiers."
                ),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Date selector act timeout")), 10000))
              ]).catch((e) => console.log(`ℹ️ [Act 1.5 - Date Picker] ${e.message}`));
            }

            await waitForDomReady(page, { maxWaitMs: 2000, minWaitMs: 350 });
          }
        } catch (dateErr) {
          console.log(`ℹ️ [Act 1.5 Note] ${dateErr.message}`);
        }
        // Act 2 (Ticket Quantity Increment & VSO Tessitura / Chan Centre Handling):
        // On VSO Tessitura (secure.vancouversymphony.ca), the React SYOS ("Choose Your Own Seat") XHR (/api/syos/GetInitData)
        // is frequently blocked by Imperva reese84 in headless mode (showing "An error has occurred"), WHEREAS the SSR
        // Best-Available mode (?z=0 / "Purchase Best Available Seating") renders all section prices and radio buttons server-side!
        if ((checkoutUrl || targetUrl || "").toLowerCase().includes("vancouversymphony.ca")) {
          // Wait up to 5s for initial hydration or SYOS error indicator
          for (let poll = 0; poll < 5; poll++) {
            const vsoState = await page.evaluate(() => {
              const txt = document.body ? document.body.innerText : "";
              const hasDollar = /\$\s*\d+(?:\.\d{2})?/.test(txt) && !/\$0\.00/.test(txt.replace(/\$0\.00[\s\S]*?(?=\$\d)/, ""));
              const hasZoneRadios = document.querySelectorAll("input.tn-ticket-selector__input-zone").length > 0;
              const hasSyosError = /an\s+error\s+has\s+occurred/i.test(txt);
              const hasQtySelect = Array.from(document.querySelectorAll("select")).some((s) => {
                const opts = Array.from(s.options).map((o) => (o.textContent || o.value || "").trim());
                return opts.includes("0") && opts.includes("1") && opts.includes("2");
              });
              return { hasDollar, hasZoneRadios, hasSyosError, hasQtySelect };
            }).catch(() => ({}));
            if (vsoState.hasZoneRadios || vsoState.hasQtySelect || vsoState.hasSyosError) break;
            await new Promise((r) => setTimeout(r, 1000));
          }

          // If SYOS failed ("An error has occurred") or no section prices/dropdowns are visible yet, switch to SSR ?z=0 mode!
          const needsBestAvailFallback = await page.evaluate(() => {
            const hasZoneRadios = document.querySelectorAll("input.tn-ticket-selector__input-zone").length > 0;
            const hasQtySelect = Array.from(document.querySelectorAll("select")).some((s) => {
              const opts = Array.from(s.options).map((o) => (o.textContent || o.value || "").trim());
              return opts.includes("0") && opts.includes("1") && opts.includes("2");
            });
            if (hasZoneRadios || hasQtySelect) return null;
            const bestAvailLink = document.querySelector("a.tn-ticketing-mode-change__anchor[href*='z=0']");
            if (bestAvailLink && bestAvailLink.href) return bestAvailLink.href;
            if (/^https?:\/\/secure\.vancouversymphony\.ca\/\d+\/\d+\/?$/i.test(window.location.href)) {
              return window.location.href.replace(/\/+$/, "") + "?z=0";
            }
            return null;
          }).catch(() => null);

          if (needsBestAvailFallback) {
            console.log(`🎻 [VSO Tessitura SSR Mode] Switching from SYOS map to server-rendered section & tier pricing: ${needsBestAvailFallback}`);
            await page.goto(needsBestAvailFallback, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
            await waitForDomReady(page, { maxWaitMs: 3000, minWaitMs: 450 });
          }
        }

        // Try fast deterministic DOM click on '+' / quantity control or VSO <select> / section selector first,
        // then fall back to Stagehand act ONLY if no DOM control was triggered and we are not on a VSO SYOS section range page.
        const incrementedViaDom = await page.evaluate(() => {
          const host = window.location.hostname.toLowerCase();

          // A. VSO Tessitura TNEW (secure.vancouversymphony.ca) specialized handler:
          if (host.includes("vancouversymphony.ca")) {
            // 1. Dismiss any accidental "An Error Has Occurred" SYOS modal first
            const closeBtns = Array.from(document.querySelectorAll("button, a[role='button'], .modal button")).filter(
              (b) => /^(close|dismiss|ok)$/i.test((b.innerText || b.textContent || "").trim())
            );
            closeBtns.forEach((b) => { try { b.click(); } catch (_) { } });

            // 2. Check for VSO ?z=0 "Available Sections" radio buttons (input.tn-ticket-selector__input-zone)
            // Select the lowest-priced eligible section (<= $50.00 CAD if available, otherwise lowest overall) to reveal exact Adult/Senior/Student/Child base + fee breakdown!
            const zoneRadios = Array.from(document.querySelectorAll("input.tn-ticket-selector__input-zone")).filter((r) => !r.disabled);
            if (zoneRadios.length > 0) {
              let bestRadio = zoneRadios[zoneRadios.length - 1];
              let bestMinPrice = Infinity;
              for (const r of zoneRadios) {
                const labelText = (r.closest("label")?.innerText || r.parentElement?.innerText || "").trim();
                const priceMatches = Array.from(labelText.matchAll(/\$\s*(\d+(?:\.\d{2})?)/g)).map((m) => parseFloat(m[1]));
                if (priceMatches.length > 0) {
                  const minP = Math.min(...priceMatches);
                  if (minP < bestMinPrice) {
                    bestMinPrice = minP;
                    bestRadio = r;
                  }
                }
              }
              if (bestRadio) {
                bestRadio.click();
                bestRadio.dispatchEvent(new Event("change", { bubbles: true }));
                const container = document.querySelector(".tn-ticket-selector__pricetype-selector, .tn-ticket-selector__zone-selector");
                if (container && typeof container.scrollIntoView === "function") {
                  container.scrollIntoView({ behavior: "instant", block: "center" });
                }
                return "vso_zone_radio_selected";
              }
            }

            // 3. Check for General Admission <select> quantity dropdown (e.g. Pyatt Hall /7633/7634)
            // Ignore the left-sidebar "Select Another Date" dropdown (which has date strings in option text)
            const selects = Array.from(document.querySelectorAll("select")).filter((s) => !s.disabled && s.offsetParent !== null);
            for (const sel of selects) {
              const optValues = Array.from(sel.options).map((o) => (o.textContent || o.value || "").trim());
              const isNumericQtyDropdown = optValues.includes("0") && optValues.includes("1") && optValues.includes("2");
              if (isNumericQtyDropdown) {
                const oneOpt = Array.from(sel.options).find((o) => (o.textContent || "").trim() === "1" || o.value === "1");
                if (oneOpt) {
                  sel.value = oneOpt.value;
                  sel.dispatchEvent(new Event("input", { bubbles: true }));
                  sel.dispatchEvent(new Event("change", { bubbles: true }));
                  const submitBtns = Array.from(
                    document.querySelectorAll("button[type='submit'], input[type='submit'], .tn-btn-submit, button")
                  ).filter((b) => !b.disabled && b.offsetParent !== null);
                  const addBtn = submitBtns.find((b) =>
                    /\b(add\s*to\s*cart|continue|next|order|submit|proceed|buy)\b/i.test(
                      `${b.innerText || ""} ${b.value || ""} ${b.getAttribute("aria-label") || ""}`
                    )
                  );
                  if (addBtn) {
                    addBtn.click();
                  }
                  return "vso_ga_select_submitted";
                }
              }
            }

            // 4. Check for Reserved Seating "Select a section"
            const bodyText = (document.body ? document.body.innerText : "");
            if (/select\s+a\s+section|front\s+orchestra|back\s+orchestra|front\s+balcony|back\s+balcony|available\s+sections/i.test(bodyText)) {
              const hasVisibleDollarPrices = /\$\s*\d+(?:\.\d{2})?/.test(bodyText);
              if (!hasVisibleDollarPrices) {
                const secBtns = Array.from(document.querySelectorAll("button, a[role='button'], .tn-syos-section-list a, .tn-syos-section-list button")).filter(
                  (b) => /orchestra|balcony|main|section|general/i.test(b.innerText || "") && !/best\s+available/i.test(b.innerText || "")
                );
                if (secBtns.length > 0) {
                  secBtns[0].click();
                  return "vso_section_drilled";
                }
              }
              return "vso_section_ranges_visible";
            }
          }

          // B. Standard '+' / Increment button selectors
          const plusSelectors = [
            "button[aria-label*='plus' i]",
            "button[aria-label*='increase' i]",
            "button[aria-label*='add' i]",
            "button[title*='increase' i]",
            "button[title*='plus' i]",
            "button[class*='increment' i]",
            "button[class*='plus' i]",
          ];
          for (const sel of plusSelectors) {
            const btns = Array.from(document.querySelectorAll(sel)).filter((b) => !b.disabled && b.offsetParent !== null);
            if (btns.length > 0) {
              btns[0].click();
              return true;
            }
          }
          // Fallback: buttons whose visible text is literally "+" (e.g. VIFF /book/ stepper controls)
          const allBtns = Array.from(document.querySelectorAll("button, [role='button']")).filter((b) => !b.disabled && b.offsetParent !== null);
          for (const b of allBtns) {
            const t = (b.innerText || b.textContent || "").trim();
            if (t === "+" || t === "＋") {
              b.click();
              return true;
            }
          }
          return false;
        }).catch(() => false);

        if (incrementedViaDom === "vso_ga_select_submitted") {
          console.log(`🎻 [Act 2 - VSO GA Dropdown] Selected quantity 1 and submitted to Tessitura cart summary.`);
          await waitForDomReady(page, { maxWaitMs: 2500, minWaitMs: 400 });
        } else if (incrementedViaDom === "vso_zone_radio_selected") {
          console.log(`🎻 [Act 2 - VSO SSR Zone Selected] Selected lowest-priced Available Section radio button to reveal Adult/Senior/Student/Child base + fee breakdown.`);
          await waitForDomReady(page, { maxWaitMs: 2000, minWaitMs: 350 });
        } else if (incrementedViaDom === "vso_section_ranges_visible" || incrementedViaDom === "vso_section_drilled") {
          console.log(`🎻 [Act 2 - VSO Section Pricing] Preserving live Tessitura section prices without triggering SYOS error modal (${incrementedViaDom}).`);
          await waitForDomReady(page, { maxWaitMs: 1500, minWaitMs: 300 });
        } else if (!incrementedViaDom) {
          await Promise.race([
            stagehand.act(
              "If a ticket quantity selector is visible, click '+' or set quantity to 1 for Adult / General Admission / Regular ticket to reveal base price, platform service fees, and taxes."
            ),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Quantity selector act timeout")), 10000))
          ]).catch((e) => console.log(`ℹ️ [Act 2] ${e.message}`));
          await waitForDomReady(page, { maxWaitMs: 1500, minWaitMs: 300 });
        } else {
          console.log(`➕ [Act 2 - DOM Quantity Stepper] Incremented first ticket tier quantity to 1 via DOM control.`);
          await waitForDomReady(page, { maxWaitMs: 1500, minWaitMs: 300 });
        }
      } else {
        await expandAccordionsAndExtractHiddenContext(page);
        console.log(`🛡️ [Safety Rail 3: Non-Cart Admission Page] No interactive checkout cart widget or button detected in rendered DOM. Bypassing Act 1/Act 2 clicks, but enforcing live keyframe capture & admission rate extraction.`);
      }
    } catch (actErr) {
      console.log(`ℹ️ Note on interactive cart action: ${actErr.message || "Proceeded directly"}`);
    }

    // [3/4] Photographic Proof Keyframe Capture
    const screenshotFileName = `${eventId}_cart.png`;
    const screenshotFilePath = path.join(PROOFS_DIR, screenshotFileName);
    console.log(`📸 [3/4] Capturing photographic cart keyframe: ${screenshotFileName}...`);
    try {
      await page.evaluate(() => {
        const showtimesEl =
          document.querySelector(".tn-ticket-selector__pricetype-selector, .tn-ticket-selector__zone-selector, .tn-syos-section-list, .tn-ticket-type-list, .tn-cart, [class*='syos-section' i], .film-showtimes, .showtimes, #tickets, .ticket-prices, [class*='showtime' i]") ||
          Array.from(document.querySelectorAll("h2, h3, h4")).find((h) => /choose\s+your\s+own\s+seat|select\s+a\s+section|available\s+sections/i.test(h.innerText || ""));
        if (showtimesEl && typeof showtimesEl.scrollIntoView === "function") {
          showtimesEl.scrollIntoView({ behavior: "instant", block: "center" });
        }
      }).catch(() => {});
      await page.screenshot({ path: screenshotFilePath, fullPage: false });
    } catch (shotErr) {
      console.warn(`⚠️ Warning capturing keyframe: ${shotErr.message}`);
    }

    // [4/4] AI Extraction of Volatile Facts
    console.log(`🔍 [4/4] Extracting live box office pricing, fees, and schedule...`);
    const postActionAccordionContext = await expandAccordionsAndExtractHiddenContext(page);
    const combinedAccordionContext = [parentAccordionContext, postActionAccordionContext]
      .filter((s) => s && s.trim().length > 0)
      .filter((s, idx, arr) => arr.indexOf(s) === idx)
      .join("\n\n");

    // Inject parent/expanded accordion context into DOM before stagehand.extract so Stagehand's accessibility tree sees it even if a drawer or redirect hid the parent page
    if (combinedAccordionContext.length > 0) {
      await page.evaluate((ctxText) => {
        let holder = document.getElementById("van50-expanded-accordion-context");
        if (!holder) {
          holder = document.createElement("section");
          holder.id = "van50-expanded-accordion-context";
          holder.setAttribute("aria-label", "Expanded Event Ticket Info and Showtimes");
          holder.style.cssText = "padding:8px;font-size:12px;color:#111;background:#fff;";
          if (document.body) document.body.appendChild(holder);
        }
        holder.innerText = `EXPANDED EVENT TICKET INFO & SHOWTIMES:\n${ctxText}`;
      }, combinedAccordionContext).catch(() => { });
    }

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
    } catch (_) { }

    const curatorGuidancePrompt = activeCuratorNote
      ? `\n🧑‍⚖️ MANDATORY CURATOR NOTE & USER GUIDANCE TO CONSIDER:\n"${activeCuratorNote}"\n(You MUST prioritize and take this curator guidance into account! E.g. respect requested ticket tiers, student/door rates, doors/curtain times, or dates.)\n`
      : "";

    let extracted = {};
    // Strict Epistemic Blindfold: Only pass identity anchors (id, title, venue) and curator_notes to Stage 2 AI — NEVER prior-stage prices, fees, or descriptions!
    const blindfoldedIdentity = {
      id: eventId,
      event_id: eventId,
      title: eventCard.title || eventCard.seed_title || eventCard.event_name || "",
      venue: eventCard.venue || eventCard.venue_name || eventCard.seed_venue || "",
      curator_notes: activeCuratorNote || eventCard.curator_notes || null,
    };
    if (isAntigravityEngine()) {
      console.log(`🚀 [Antigravity Box Office Mode] Capturing rendered DOM, cart modal & iframe text for 1-event Antigravity Worker (${getAntigravityModel()})...`);
      const domSnapshot = await collectAllFramesText(page, typeof combinedAccordionContext !== "undefined" ? combinedAccordionContext : "");
      const agyData = await callAntigravityBoxOfficeExtractor(domSnapshot, checkoutUrl || targetUrl, blindfoldedIdentity);
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
          "- Extract single-event / single-visit admission tiers visible in the modal, page, or EXPANDED EVENT TICKET INFO section into the all_tiers array: Adult (19-64 years), Section C / Section B / Section A reserved seats, Senior (65+ years), Youth (13-18 years), Child (5-12 years), Preschooler (4 and under), Student, etc. with exact name, base price, fees, taxes, and all-in total in CAD.\n" +
          "- DO NOT extract annual memberships, 12-month passes, season subscriptions, or donation upsells (e.g. 'All donations above $25 will receive a tax receipt') as ticket tiers.\n" +
          "- Tier 1 MUST be the lowest-priced standard Adult / General Admission / Section C single-visit ticket tier <= $50.00 CAD. If an event offers a free preschooler ($0), child/youth ($0), or member tier alongside a paid Adult ticket (e.g. $14.86 or $29.00 CAD), do NOT record the $0 tier as General Admission! You must record the paid Adult / General Admission price as Tier 1.\n" +
          "- Also populate tier1, tier2, and tier3 with the primary single-visit tiers <= $50.00 CAD (e.g. tier1 = Section C / Adult, tier2 = Section B / Senior / Student, tier3 = Youth/Child).\n" +
          "- CRITICAL SOLD-OUT RULE: Set is_sold_out: false whenever at least one single-visit admission tier (e.g. General Admission, Regular, Section C/B, or Student) is available for purchase in the checkout modal. Do NOT set is_sold_out: true merely because a single early-bird/VIP tier is sold out, or because 'Sold Out' appears on a sidebar/related event listing.\n" +
          "- If multiple show dates/times exist, extract up to 5 showings into the showings array.",
          SingleEventExtractionSchema
        );
        extracted = extraction.data || extraction || {};
      } catch (extErr) {
        console.warn(`⚠️ [Stagehand Extract Fallback] Stagehand extension world / cross-origin iframe error (${extErr.message}). Falling back to multi-frame DOM + Box Office Extractor...`);
        try {
          const domSnapshot = await collectAllFramesText(page, typeof combinedAccordionContext !== "undefined" ? combinedAccordionContext : "");
          const fallbackData = await callAntigravityBoxOfficeExtractor(domSnapshot, checkoutUrl || targetUrl, blindfoldedIdentity);
          if (fallbackData && typeof fallbackData === "object") {
            extracted = fallbackData;
          }
        } catch (fbErr) {
          console.warn(`⚠️ [Stagehand Extract Fallback] Multi-frame DOM fallback note: ${fbErr.message}`);
        }
      }
    }

    // Deterministic Accordion Price Table Recovery:
    // If LLM extraction returned null pricing despite explicit single-ticket prices in combinedAccordionContext or live page text
    // (e.g. "Section C: $35 | Section B: $49" or "Back Balcony $32.00 to $70.00" or "General Admission – Adult, 19+: $25.27 + service charge"),
    // recover the verified tiers directly from the expanded accordion & page text!
    const hasAnyExtractedTierPrice =
      Array.isArray(extracted.all_tiers) &&
      extracted.all_tiers.some((t) => t && (t.price_all_in != null || t.price_base != null || t.price != null));
    const liveBodyTextForRecovery = await page.evaluate(() => (document.body ? document.body.innerText : "")).catch(() => "");
    const combinedPriceRecoverySource = [combinedAccordionContext, liveBodyTextForRecovery].filter(Boolean).join("\n\n");
    if (
      extracted.tier1_price_base == null &&
      extracted.tier1_price_all_in == null &&
      !hasAnyExtractedTierPrice &&
      combinedPriceRecoverySource.length > 0
    ) {
      const recoveredTiers = [];
      const tierPatterns = [
        { re: /\b(Section\s+[A-D]\+?)\s*:\s*\$\s*(\d+(?:\.\d{2})?)/gi, labelFn: (m) => `${m[1]} Reserved` },
        { re: /\b(Front\s+Orchestra|Back\s+Orchestra|Front\s+Balcony|Back\s+Balcony|Dress\s+Circle|Upper\s+Circle)\s+\$\s*(\d+(?:\.\d{2})?)\s+to\s+\$\s*\d+(?:\.\d{2})?/gi, labelFn: (m) => `${m[1].trim()} (Starting Floor)` },
        { re: /\b(Adult|Senior|Student|Child(?:\s*\([^)]+\))?)\s+\$\s*(\d+(?:\.\d{2})?)\s*ticket\s*\+\s*\$\s*(\d+(?:\.\d{2})?)\s*fees\s+\$\s*(\d+(?:\.\d{2})?)/gi, labelFn: (m) => m[1].trim(), feeIdx: 3, allInIdx: 4 },
        { re: /\bSTX-(Adult|Senior|Stud(?:e)?nt|Child)\s*\$\s*(\d+(?:\.\d{2})?)/gi, labelFn: (m) => m[1].replace(/Studnt/i, "Student") },
        { re: /\b(General\s+Admission(?:\s*[–-]\s*Adult\s*\(?19\+\)?)?|Adult(?:\s*\(?19\+\)?)?)\s*:\s*\$\s*(\d+(?:\.\d{2})?)/gi, labelFn: (m) => m[1].trim() },
        { re: /\b(Tickets\s+from|Starting\s+at)\s+\$\s*(\d+(?:\.\d{2})?)/gi, labelFn: () => "Standard Admission (Starting Floor)" },
        { re: /\b(\d{1,2}:\d{2}\s*(?:AM|PM)\s+(?:Matinee|Evening))\s*:\s*\$\s*(\d+(?:\.\d{2})?)/gi, labelFn: (m) => m[1].trim() },
      ];
      for (const { re, labelFn, feeIdx, allInIdx } of tierPatterns) {
        let match;
        while ((match = re.exec(combinedPriceRecoverySource)) !== null) {
          const priceVal = parseFloat(match[2]);
          const feeVal = feeIdx && match[feeIdx] ? parseFloat(match[feeIdx]) : 0;
          const allInVal = allInIdx && match[allInIdx] ? parseFloat(match[allInIdx]) : priceVal;
          const nameVal = labelFn(match);
          if (!isNaN(priceVal) && priceVal > 0 && !recoveredTiers.some((t) => t.name === nameVal && t.price_all_in === allInVal)) {
            recoveredTiers.push({
              name: nameVal,
              price_base: priceVal,
              price_fee: feeVal,
              price_tax: 0,
              price_read: allInVal,
              price_all_in: allInVal,
              is_available: true,
              quote: match[0].trim(),
            });
          }
        }
      }
      if (recoveredTiers.length > 0) {
        recoveredTiers.sort((a, b) => a.price_all_in - b.price_all_in);
        const under50 = recoveredTiers.filter((t) => t.price_all_in <= 50.0);
        const primaryTiers = under50.length > 0 ? under50 : recoveredTiers;
        console.log(`🪗 [Accordion Price Recovery] Recovered ${recoveredTiers.length} ticket tier(s) from expanded accordion: ${primaryTiers.map((t) => `${t.name} ($${t.price_all_in.toFixed(2)})`).join(", ")}`);
        extracted.tier1_name = primaryTiers[0].name;
        extracted.tier1_price_base = primaryTiers[0].price_base;
        extracted.tier1_price_read = primaryTiers[0].price_read;
        extracted.tier1_price_all_in = primaryTiers[0].price_all_in;
        extracted.tier1_quote = primaryTiers[0].quote;
        if (primaryTiers[1]) {
          extracted.tier2_name = primaryTiers[1].name;
          extracted.tier2_price_base = primaryTiers[1].price_base;
          extracted.tier2_price_read = primaryTiers[1].price_read;
          extracted.tier2_price_all_in = primaryTiers[1].price_all_in;
          extracted.tier2_quote = primaryTiers[1].quote;
        }
        if (under50.length > 0) {
          extracted.all_tiers = under50;
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

    // Gate 5: Strict Entity-Match Gate Before Writing (Post-Extraction Verification)
    const expectedEventTitle = (eventCard.title || eventCard.event_name || "").trim();
    const isGenericExtractedTitle = (str) => {
      if (!str || typeof str !== "string") return true;
      const s = str.trim();
      return s.length < 3 || /^(?:season\s*pass|annual\s*pass|membership|buy\s*tickets|get\s*tickets|tickets|general\s*admission|admission|exhibits\s+and\s+experiences|cultural\s+event|event|checkout|cart)$/i.test(s);
    };

    // If Stagehand extracted a generic button/pass label (e.g. "Season Pass", "Buy Tickets"), restore expected title
    if (isGenericExtractedTitle(extracted.title) && expectedEventTitle) {
      console.log(`🛡️ [Pre-Write Entity Gate] Suppressing generic extracted button/pass title ("${extracted.title || "empty"}") -> preserving "${expectedEventTitle}"`);
      extracted.title = expectedEventTitle;
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

    // Verify that the final post-interaction DOM + extracted payload still matches the expected target entity
    if (expectedEventTitle) {
      const finalDomState = await page.evaluate(() => ({
        title: document.title || "",
        text: document.body ? document.body.innerText : "",
      })).catch(() => ({ title: pageInfo?.title || "", text: pageInfo?.text || "" }));

      const postExtractionEntityCheck = checkEntityMatchesPage(
        expectedEventTitle,
        `${finalDomState.title} ${extracted.title || ""}`,
        `${finalDomState.text} ${extracted.description || ""}`,
        {
          venue: extracted.venue_name || eventCard.venue || eventCard.venue_name,
          date: extracted.date || eventCard.date,
          card: eventCard,
          url: checkoutUrl || targetUrl,
        }
      );

      // Also check if extracted.title itself is a completely different event title (zero token overlap with expectedEventTitle)
      const extractedVsExpectedCheck = checkEntityMatchesPage(
        expectedEventTitle,
        extracted.title,
        `${extracted.title} ${extracted.artist || ""} ${(extracted.lineup || []).join(" ")}`,
        {
          venue: extracted.venue_name || eventCard.venue || eventCard.venue_name,
          date: extracted.date || eventCard.date,
          card: eventCard,
        }
      );

      if (!postExtractionEntityCheck.matches) {
        console.warn(`❌ [Pre-Write Strict Entity Gate] Fatal Gate 5 Breach before write: Post-extraction page/cart does not match "${expectedEventTitle}" (${postExtractionEntityCheck.reason}). Refusing to write to layer_box_office.json.`);
        const poisonedUrls = Array.from(new Set([...(eventCard.dead_urls || []), checkoutUrl, targetUrl].filter(Boolean)));
        return {
          success: false,
          eventId,
          status: "FATAL_MISMATCHED_ENTITY",
          error: `Pre-write entity verification failed: ${postExtractionEntityCheck.reason}`,
          card: {
            ...eventCard,
            ticket_url: null,
            failed_url: checkoutUrl || targetUrl,
            dead_urls: poisonedUrls,
            last_qc_audited_at: new Date().toISOString(),
          },
        };
      }

      // If page matched (e.g. multi-event venue page) but Stagehand latched onto a different show's title on the page, preserve expected title
      if (!extractedVsExpectedCheck.matches && extracted.title.toLowerCase().trim() !== expectedEventTitle.toLowerCase().trim()) {
        console.warn(`⚠️ [Pre-Write Strict Entity Gate] Extracted title "${extracted.title}" diverged from expected "${expectedEventTitle}" (${extractedVsExpectedCheck.reason}). Locking title to expected card identity.`);
        extracted.title = expectedEventTitle;
      }
    }

    // If extracted ticket_url was missing, relative, a generic portal root, or downgraded a Tier 1 /book/ or /checkout/ link to a Tier 2 overview page, preserve the verified Tier 1 checkoutUrl!
    const bestLiveCheckoutUrl = isValidDeepLink(checkoutUrl) ? checkoutUrl : (isValidDeepLink(targetUrl) ? targetUrl : eventCard.ticket_url);
    const isLiveCheckoutTier1 = Boolean(
      bestLiveCheckoutUrl &&
      (isWhitelistedTicketingUrl(bestLiveCheckoutUrl) ||
        /\/book\/|\/checkout\/|\/ticket\/|EventInstanceId=|WebEventId=|ChooseSeats/i.test(bestLiveCheckoutUrl))
    );
    const isExtractedTier1 = Boolean(
      isValidDeepLink(extracted.ticket_url) &&
      (isWhitelistedTicketingUrl(extracted.ticket_url) ||
        /\/book\/|\/checkout\/|\/ticket\/|EventInstanceId=|WebEventId=|ChooseSeats/i.test(extracted.ticket_url))
    );
    if (!isValidDeepLink(extracted.ticket_url) || (isLiveCheckoutTier1 && !isExtractedTier1)) {
      extracted.ticket_url = bestLiveCheckoutUrl;
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
    if (candidateVerified || preservedViffBookUrl) {
      const promotedUrl = preservedViffBookUrl || targetUrl;
      fullUpdatedCard.ticket_url = promotedUrl;
      if (!fullUpdatedCard.links) fullUpdatedCard.links = {};
      fullUpdatedCard.links.tier1_checkout = promotedUrl;
      fullUpdatedCard.links.best_available = promotedUrl;
      fullUpdatedCard.links.best_tier = "tier1";
      fullUpdatedCard.candidate_tier1_verified = true;
      fullUpdatedCard.candidate_tier1_promoted_at = new Date().toISOString();
      delete fullUpdatedCard.candidate_tier1_url;
      console.log(`🚀 [Stagehand Gate] Officially promoted candidate Tier 1 checkout URL to live card: ${promotedUrl}`);
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
    const hasVerifiedNumericPrice = fullUpdatedCard.price_all_in != null || Boolean(fullUpdatedCard.isFree);
    const isActualBudgetBreach = fullUpdatedCard.price_all_in != null && fullUpdatedCard.price_all_in > 50.0;
    const auditStatus = isActualBudgetBreach
      ? "BUDGET_BREACH"
      : (hasVerifiedNumericPrice && fullUpdatedCard.budget_qualified_under_50 ? "VERIFIED_PASS" : "UNVERIFIED_PRICING");

    console.log(`✅ Audit Completed in ${durationSec}s:`);
    const logBase = fullUpdatedCard.price_base != null ? fullUpdatedCard.price_base : (fullUpdatedCard.price != null ? fullUpdatedCard.price : "N/A");
    const logFee = fullUpdatedCard.price_fee != null ? fullUpdatedCard.price_fee : 0;
    const logTax = fullUpdatedCard.price_tax != null ? fullUpdatedCard.price_tax : 0;
    console.log(`   Price: ${fullUpdatedCard.priceLabel} (Base: $${logBase}, Fees: $${logFee}, Tax: $${logTax})`);
    if (fullUpdatedCard.tier1_name) {
      console.log(`   Tier 1: ${fullUpdatedCard.tier1_name}`);
    }
    if (fullUpdatedCard.ticket_provider) {
      console.log(`   Provider: ${fullUpdatedCard.ticket_provider}`);
    }
    console.log(
      `   Budget Under $50 CAD: ${auditStatus === "VERIFIED_PASS"
        ? "PASS ✅"
        : (auditStatus === "BUDGET_BREACH" ? "BREACH ❌ (> $50 CAD)" : "UNVERIFIED ⚠️ (Price not found on page)")
      }`
    );
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
      success: auditStatus === "VERIFIED_PASS",
      eventId,
      status: auditStatus,
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
    await safeCloseBrowserSession(sessionRef || { stagehand, browser });
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

let _cachedVenuesDbForBypass = null;
function getCachedVenuesDb() {
  if (_cachedVenuesDbForBypass) return _cachedVenuesDbForBypass;
  try {
    if (fs.existsSync(VENUES_PATH)) {
      _cachedVenuesDbForBypass = JSON.parse(fs.readFileSync(VENUES_PATH, "utf-8"));
      return _cachedVenuesDbForBypass;
    }
  } catch (_) { }
  return [];
}

/**
 * Determines if an event requires live Stagehand browser inspection (Anti-Laziness Safety Rails 1 & 2).
 * An event can ONLY bypass Stagehand browser launch if:
 * 1. It has ZERO specific calendar dates (YYYY-MM-DD), ZERO specific showtimes (HH:MM AM/PM), ZERO paid price (> $0), and ZERO whitelisted ticketing URLs.
 * 2. Its physical venue is authoritatively grounded in `data/venues.json` with `access_model === "open_public_space"` or `"free_public_access"`.
 * An AI enricher or scraper stamping `perennial_drop_in` or `isFree: true` on an ungrounded or time-bound event can NEVER trigger a bypass.
 */
export function isTicketedOrPaidEvent(e, venuesList = null) {
  if (!e) return false;

  // Safety Rail 2: Automatic Disqualification if ANY calendar date, showtime, paid price, or ticketing portal URL exists
  const rawDate = String(e.date || e.startIso || "").trim();
  const hasIsoDate = /\b202\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/.test(rawDate);
  const hasActiveDatedShowings = Array.isArray(e.showings) && e.showings.some((s) => s && /\b202\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])\b/.test(String(s.date || "")));
  const rawTime = String(e.start_time || e.time || e.doors_time || "").trim();
  const hasSpecificShowtime = /\b\d{1,2}:\d{2}\s*(?:AM|PM)?\b/i.test(rawTime) && !/open\s*daily|perennial|24\s*hours/i.test(rawTime);
  const numericPrice = Number(e.price ?? e.price_all_in ?? e.price_base ?? 0);
  const hasNonZeroPrice = !isNaN(numericPrice) && numericPrice > 0;

  const candidateUrls = [
    e.candidate_tier1_url,
    e.ticket_url,
    e.details_url,
    e.links?.tier1_checkout,
    e.links?.best_available,
  ].filter((u) => u && typeof u === "string");
  const hasTicketingPortal = candidateUrls.some((u) => isWhitelistedTicketingUrl(u));

  if (hasIsoDate || hasActiveDatedShowings || hasSpecificShowtime || hasNonZeroPrice || hasTicketingPortal) {
    return true;
  }

  // Safety Rail 1: Venue-Registry Grounded Whitelist Only
  const venuesDb = Array.isArray(venuesList) && venuesList.length > 0 ? venuesList : getCachedVenuesDb();
  const vQuery = (e.venue || e.venue_name || e.seed_venue || "").toLowerCase().replace(/\s*\([^)]*\)/g, "").trim();
  const matchedVenue = vQuery
    ? venuesDb.find((v) => {
      const vName = (v.venue_name || v.name || "").toLowerCase().replace(/\s*\([^)]*\)/g, "").trim();
      return vName && (vName === vQuery || (vName.length > 6 && (vQuery.includes(vName) || vName.includes(vQuery))));
    })
    : null;

  const venueAccessModel = matchedVenue?.access_model || null;
  const isVenueGroundedFreePublicSpace =
    venueAccessModel === "open_public_space" ||
    venueAccessModel === "free_public_access";

  if (isVenueGroundedFreePublicSpace) {
    return false;
  }

  // Default: Force through Stagehand browser inspection (never trust ungrounded card-level flags)
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
    } catch (e) { }
  }

  // Load manual review queue
  let queue = { metadata: {}, quarantinedEvents: [] };
  if (fs.existsSync(QUEUE_PATH)) {
    try {
      queue = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
    } catch (e) { }
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
  } catch (_) { }
  try {
    if (fs.existsSync(RULES_PATH)) {
      const rData = JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));
      (rData.archived_event_ids || []).forEach((id) => archivedIds.add(String(id).toLowerCase()));
      (rData.course_blacklist_patterns || []).forEach((p) => {
        if (p) blacklistPatterns.push(String(p).toLowerCase().trim());
      });
    }
  } catch (_) { }

  const SCHEDULES_PATH = path.join(DATA_DIR, "layers", "layer_schedules.json");
  const SEEDS_PATH = path.join(DATA_DIR, "layers", "seeds.json");
  let schedules = [];
  try { if (fs.existsSync(SCHEDULES_PATH)) schedules = JSON.parse(fs.readFileSync(SCHEDULES_PATH, "utf-8")); } catch (_) { }
  let seeds = [];
  try { if (fs.existsSync(SEEDS_PATH)) seeds = JSON.parse(fs.readFileSync(SEEDS_PATH, "utf-8")); } catch (_) { }

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
  // Strict Stage 2 Gate: Uncompiled schedule/seed events can ONLY enter Stage 2 if they completed Stage 1B (step1b_audited_at)
  const step1bDoneIds = new Set();
  schedules.forEach((sEv) => {
    const sId = String(sEv.id || sEv.event_id || "").toLowerCase();
    if (sId && Boolean(sEv.step1b_audited_at)) {
      step1bDoneIds.add(sId);
      if (!activeIds.has(sId) && !archivedIds.has(sId)) {
        combinedPool.push(sEv);
        activeIds.add(sId);
      } else {
        const existing = combinedPool.find((c) => String(c.id || c.event_id || "").toLowerCase() === sId);
        if (existing) {
          if (sEv.candidate_tier1_url && !existing.candidate_tier1_url) {
            existing.candidate_tier1_url = sEv.candidate_tier1_url;
          }
          if (sEv.ticket_url && isWhitelistedTicketingUrl(sEv.ticket_url) && !isWhitelistedTicketingUrl(existing.ticket_url)) {
            existing.ticket_url = sEv.ticket_url;
          }
        }
      }
    }
  });
  seeds.forEach((seedEv) => {
    const sId = String(seedEv.id || seedEv.event_id || "").toLowerCase();
    if (sId && !activeIds.has(sId) && !archivedIds.has(sId) && step1bDoneIds.has(sId)) {
      combinedPool.push(seedEv);
      activeIds.add(sId);
    }
  });

  // Filter Target Events
  let targets = [...combinedPool];
  let resumeOffset = 0;
  const todayIso = new Date().toISOString().split("T")[0];
  const hasSpecificId = Boolean(options.id || options.ids);

  const BOX_OFFICE_LAYER_PATH = path.join(DATA_DIR, "layers", "layer_box_office.json");
  const boxAuditedIds = new Set();
  try {
    if (fs.existsSync(BOX_OFFICE_LAYER_PATH)) {
      const bData = JSON.parse(fs.readFileSync(BOX_OFFICE_LAYER_PATH, "utf-8"));
      (Array.isArray(bData) ? bData : []).forEach((b) => {
        const bid = String(b.id || b.event_id || "").toLowerCase();
        if (bid && b.status !== "TIMEOUT_EXCEEDED" && b.status !== "AI_TIMEOUT" && b.status !== "EXECUTION_ERROR") {
          boxAuditedIds.add(bid);
        }
      });
    }
  } catch (_) { }

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
    if ((options.harvestedOnly || options.scope === "harvested") && !options.force && targets.length > 1) {
      const pending = targets.filter((s) => !boxAuditedIds.has(String(s.id || s.event_id || "").toLowerCase()));
      if (pending.length > 0 && pending.length < targets.length) {
        resumeOffset = targets.length - pending.length;
        console.log(`⏭️ [Stage 2 QC Resume] Skipping ${resumeOffset} newly harvested events already verified in layer_box_office.json — resuming on ${pending.length} remaining events!`);
        targets = pending;
      }
    }
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
    } else if (options.harvestedOnly || options.scope === "harvested") {
      // Target newly harvested uncompiled events from layer_schedules.json that completed Stage 1B (matching getUncompiledHarvestedEvents)
      const quarantinedIds = new Set((queue.quarantinedEvents || []).map((q) => String(q.id || q.event_id || "").toLowerCase()).filter(Boolean));
      const publishedIds = new Set(events.map((e) => String(e.id || e.event_id).toLowerCase()));
      const allHarvestedRaw = schedules.filter((s) => {
        const sId = String(s.id || s.event_id || "").toLowerCase();
        if (!sId || publishedIds.has(sId) || archivedIds.has(sId)) return false;
        const u = String(s.details_url || s.candidate_tier1_url || s.ticket_url || "").toLowerCase();
        if (/\/(support|donate|corporate-giving|patrons-circle|major-gifts)(\/|$)/i.test(u)) return false;
        if (s.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.date < todayIso && s.lifecycle_type !== "perennial_drop_in") {
          return false;
        }
        return true;
      }).filter(isTicketedOrPaidEvent);

      const allHarvested = allHarvestedRaw.filter((s) => {
        const sId0 = String(s.id || s.event_id || "").toLowerCase();
        if (quarantinedIds.has(sId0) || !s.step1b_audited_at) return false;
        const u0 = String(s.details_url || s.candidate_tier1_url || s.ticket_url || "").toLowerCase();
        if (!u0 || /\.pdf(\?|$)/i.test(u0)) return false;
        const rawTitle0 = String(s.title || s.event_name || "").trim().toLowerCase();
        if (!rawTitle0 || ["event", "events", "search_exhausted_null", "quarantine_fatal", "page not found", "error 404"].includes(rawTitle0)) return false;
        if (s.lifecycle_type !== "perennial_drop_in") {
          const isoShowings = Array.isArray(s.showings) ? s.showings.filter((sh) => sh && sh.date && /^\d{4}-\d{2}-\d{2}$/.test(sh.date)) : [];
          const hasUpcomingShowing = isoShowings.some((sh) => sh.date >= todayIso);
          const rawDateStr = String(s.date || s.dateSchedule || "");
          const isoMatch = rawDateStr.match(/\b(202\d-\d{2}-\d{2})\b/);
          const extractedIso = isoMatch ? isoMatch[1] : null;
          if (extractedIso && extractedIso < todayIso && !hasUpcomingShowing) return false;
          if (isoShowings.length > 0 && !hasUpcomingShowing) return false;
        }
        return true;
      });

      const pendingQC = allHarvested.filter((s) => !boxAuditedIds.has(String(s.id || s.event_id || "").toLowerCase()));
      if (!options.force) {
        resumeOffset = allHarvested.length - pendingQC.length;
        if (resumeOffset > 0 && pendingQC.length > 0) {
          console.log(`⏭️ [Stage 2 QC Resume] Skipping ${resumeOffset} Stage 1B-completed events already verified in layer_box_office.json — continuing on ${pendingQC.length} remaining events!`);
        } else if (pendingQC.length === 0) {
          console.log(`✅ [Stage 2 QC] All ${allHarvested.length} Stage 1B-completed events are already verified in layer_box_office.json (0 pending).`);
        }
        targets = pendingQC;
      } else {
        targets = allHarvested;
      }
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
    if ((options.harvestedOnly || options.scope === "harvested") && resumeOffset > 0 && limit >= resumeOffset + targets.length) {
      // Keep all remaining targets when limit was set to full harvested count
    } else {
      targets = targets.slice(0, limit);
    }
  }

  const requestedConcurrency = Number(options.concurrency || process.env.VAN50_QC_CONCURRENCY || 2);
  const concurrency = Math.max(1, Math.min(requestedConcurrency, targets.length || 1, 3));
  if (concurrency > 1 && targets.length > 2) {
    targets = interleaveTargetsByDomain(targets);
  }

  const displayTotal = resumeOffset + targets.length;
  console.log(`\n================================================================`);
  console.log(`🚀 STAGEHAND BATCH QC ENGINE — 0XX–8XX CANONICAL ARCHITECTURE`);
  console.log(`📊 Catalog Size: ${events.length} events`);
  console.log(`🎯 Targets Queued for Audit: ${displayTotal} events${resumeOffset > 0 ? ` (${resumeOffset} already verified, ${targets.length} remaining)` : ""}`);
  console.log(`⚡ Browser Concurrency: ${concurrency} isolated worker(s) (domain-interleaved)`);
  console.log(`================================================================\n`);

  if (options.dryRun) {
    console.log(`🔎 DRY RUN MODE — Target Queue Preview:`);
    targets.forEach((t, i) => {
      console.log(`[#${resumeOffset + i + 1}] ${t.id || t.event_id} | ${t.venue || t.venue_name} | ${t.title || t.event_name}`);
      console.log(`    URL: ${t.ticket_url || t.details_url || t.websiteUrl}`);
    });
    return;
  }

  const overallStart = Date.now();
  const boxOfficeLayerPath = path.join(DATA_DIR, "layers", "layer_box_office.json");

  const auditResults = await runWithConcurrency(
    targets,
    concurrency,
    async (target, i, workerId) => {
      const displayIdx = resumeOffset + i + 1;
      console.log(`\n────────────────────────────────────────────────────────────────`);
      console.log(`${formatLogTime()} 📌 [Worker #${workerId + 1}] Processing [${displayIdx}/${displayTotal}]: ${target.title || target.event_name} [${target.id || target.event_id}]`);
      logCuratorInfo({
        eventId: target.id || target.event_id,
        title: target.title || target.event_name,
        venue: target.venue || target.venue_name,
        existingCard: target,
        prefix: "   "
      });
      console.log(`────────────────────────────────────────────────────────────────`);

      // Watchdog: Max 90s per event card to prevent stalled web pages, with guaranteed browser teardown
      let result;
      const timeoutMs = 90000;
      let timeoutHandle;
      const sessionRef = { stagehand: null, browser: null };
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`Event audit timed out after ${timeoutMs / 1000}s`)), timeoutMs);
      });

      try {
        result = await Promise.race([
          auditSingleEventCard(target, venuesDb, apiKey, sessionRef),
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
        await safeCloseBrowserSession(sessionRef);
      }

      // Persist to Layer Store (layer_box_office.json) atomically with mutex lock
      // In accordance with the Single Publisher architecture, only Compiler AI publishes to data/events.json and graduates/evicts from manual_review_queue.json!
      if (fs.existsSync(path.dirname(boxOfficeLayerPath))) {
        const isTimeoutOrError = result.status === "TIMEOUT_EXCEEDED" || result.status === "AI_TIMEOUT" || result.status === "EXECUTION_ERROR";
        const allTiersArr = isTimeoutOrError ? [] : (result.card.tiers || result.card.all_tiers || []);
        const t2Obj = allTiersArr.length >= 2 ? allTiersArr[1] : null;
        const t3Obj = allTiersArr.length >= 3 ? allTiersArr[2] : null;
        const boxEntry = {
          id: result.eventId,
          status: result.status,
          success: Boolean(result.success),
          venue_name: isTimeoutOrError ? (target.venue_name || target.venue || null) : (result.card.venue_name || result.card.venue || target.venue_name || target.venue),
          title: isTimeoutOrError ? (target.title || null) : (result.card.title || target.title),
          date: isTimeoutOrError ? null : (result.card.date || result.card.showings?.[0]?.date || null),
          doors_time: isTimeoutOrError ? null : (result.card.doors_time || null),
          start_time: isTimeoutOrError ? null : (result.card.start_time || result.card.time || null),
          end_time: isTimeoutOrError ? null : (result.card.end_time || null),
          tier1_name: isTimeoutOrError ? null : (result.card.tier1_name || result.card.dimension_audit?.D201_tier1_name?.value || (allTiersArr[0]?.name) || null),
          tier1_price_base: isTimeoutOrError ? null : (result.card.price_base ?? allTiersArr[0]?.price_base ?? null),
          tier1_price_fee: isTimeoutOrError ? null : (result.card.price_fee ?? allTiersArr[0]?.price_fee ?? null),
          tier1_price_tax: isTimeoutOrError ? null : (result.card.price_tax ?? allTiersArr[0]?.price_tax ?? null),
          tier1_price_read: isTimeoutOrError ? null : (result.card.price_read ?? allTiersArr[0]?.price_read ?? null),
          tier1_price_calculated: isTimeoutOrError ? null : (result.card.price_calculated ?? allTiersArr[0]?.price_calculated ?? null),
          tier1_discrepancy_delta: isTimeoutOrError ? 0 : (result.card.price_delta ?? 0),
          tier1_price_all_in: isTimeoutOrError ? null : (result.card.price_all_in ?? allTiersArr[0]?.price_all_in ?? null),
          tier1_quote: isTimeoutOrError ? null : (result.card.tier1_quote || result.card.dimension_audit?.D205_tier1_price_read?.evidence_quote || null),
          tier2_name: isTimeoutOrError ? null : (result.card.tier2_name || result.card.dimension_audit?.D206_tier2_name?.value || t2Obj?.name || null),
          tier2_price_base: isTimeoutOrError ? null : (result.card.tier2_price_base ?? result.card.dimension_audit?.D207_tier2_price_base?.value ?? t2Obj?.price_base ?? null),
          tier2_price_fee: isTimeoutOrError ? null : (result.card.tier2_price_fee ?? result.card.dimension_audit?.D208_tier2_price_fee?.value ?? t2Obj?.price_fee ?? null),
          tier2_price_tax: isTimeoutOrError ? null : (result.card.tier2_price_tax ?? result.card.dimension_audit?.D209_tier2_price_tax?.value ?? t2Obj?.price_tax ?? null),
          tier2_price_read: isTimeoutOrError ? null : (result.card.tier2_price_read ?? result.card.dimension_audit?.D210_tier2_price_read?.value ?? t2Obj?.price_read ?? null),
          tier2_price_calculated: isTimeoutOrError ? null : (result.card.tier2_price_calculated ?? result.card.dimension_audit?.D210_tier2_price_calculated?.value ?? t2Obj?.price_calculated ?? null),
          tier2_discrepancy_delta: isTimeoutOrError ? 0 : (result.card.tier2_discrepancy_delta ?? result.card.dimension_audit?.D210_tier2_discrepancy_delta?.delta ?? 0),
          tier2_price_all_in: isTimeoutOrError ? null : (result.card.tier2_price_all_in ?? result.card.dimension_audit?.D210_tier2_price_all_in?.value ?? t2Obj?.price_all_in ?? null),
          tier2_quote: isTimeoutOrError ? null : (result.card.tier2_quote || result.card.dimension_audit?.D210_tier2_price_read?.evidence_quote || t2Obj?.evidence_quote || null),
          tier3_name: isTimeoutOrError ? null : (result.card.tier3_name || result.card.dimension_audit?.D211_tier3_name?.value || t3Obj?.name || null),
          tier3_price_base: isTimeoutOrError ? null : (result.card.tier3_price_base ?? result.card.dimension_audit?.D212_tier3_price_base?.value ?? t3Obj?.price_base ?? null),
          tier3_price_fee: isTimeoutOrError ? null : (result.card.tier3_price_fee ?? result.card.dimension_audit?.D213_tier3_price_fee?.value ?? t3Obj?.price_fee ?? null),
          tier3_price_tax: isTimeoutOrError ? null : (result.card.tier3_price_tax ?? result.card.dimension_audit?.D214_tier3_price_tax?.value ?? t3Obj?.price_tax ?? null),
          tier3_price_read: isTimeoutOrError ? null : (result.card.tier3_price_read ?? result.card.dimension_audit?.D215_tier3_price_read?.value ?? t3Obj?.price_read ?? null),
          tier3_price_calculated: isTimeoutOrError ? null : (result.card.tier3_price_calculated ?? result.card.dimension_audit?.D215_tier3_price_calculated?.value ?? t3Obj?.price_calculated ?? null),
          tier3_discrepancy_delta: isTimeoutOrError ? 0 : (result.card.tier3_discrepancy_delta ?? result.card.dimension_audit?.D215_tier3_discrepancy_delta?.delta ?? 0),
          tier3_price_all_in: isTimeoutOrError ? null : (result.card.tier3_price_all_in ?? result.card.dimension_audit?.D215_tier3_price_all_in?.value ?? t3Obj?.price_all_in ?? null),
          tier3_quote: isTimeoutOrError ? null : (result.card.tier3_quote || result.card.dimension_audit?.D215_tier3_price_read?.evidence_quote || t3Obj?.evidence_quote || null),
          all_tiers: allTiersArr,
          is_sold_out: isTimeoutOrError ? false : Boolean(result.card.is_sold_out),
          ticket_provider: isTimeoutOrError ? null : (result.card.ticket_provider || null),
          ticket_url: (result.status && result.status.startsWith("FATAL_")) ? null : (isTimeoutOrError ? null : (result.card.ticket_url || null)),
          failed_url: result.card.failed_url || null,
          dead_urls: Array.isArray(result.card.dead_urls) ? result.card.dead_urls : [],
          proof_keyframe: isTimeoutOrError ? null : (result.card.proof_keyframes?.cart || result.card.proof_keyframe || null),
          showings: (!isTimeoutOrError && Array.isArray(result.card.showings) && result.card.showings.length > 0) ? result.card.showings : [],
          restrictions: isTimeoutOrError ? null : (result.card.restrictions || null),
          audited_at: new Date().toISOString(),
          error: result.error || null,
          quarantine_reason:
            result.card.quarantineReason ||
            result.card.quarantine_reason ||
            (result.status === "ANTIBOT_CHALLENGE_BLOCKED"
              ? "antibot_challenge_blocked"
              : result.status === "BUDGET_BREACH"
                ? "budget_breach_over_50"
                : result.status === "UNVERIFIED_PRICING"
                  ? "unverified_box_office_pricing"
                  : result.status?.startsWith("FATAL_")
                    ? result.status.toLowerCase()
                    : null),
        };
        await safeUpdateJsonFile(boxOfficeLayerPath, [], (boxLayerRaw) => {
          const boxLayer = Array.isArray(boxLayerRaw) ? boxLayerRaw : [];
          const bIdx = boxLayer.findIndex((b) => (b.id || b.event_id) === result.eventId);
          if (bIdx >= 0) {
            boxLayer[bIdx] = boxEntry;
          } else {
            boxLayer.push(boxEntry);
          }
          return boxLayer;
        });
        console.log(`💾 Persisted box office audit (${result.eventId} [${result.status}]) to layer_box_office.json [Awaiting Compiler publication]`);
        console.log(`Committed updated event (${result.eventId})`);
      }

      // Record progress in ledger atomically
      await recordLedgerEntry(result);

      return result;
    },
    { staggerMs: 1200 }
  );

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

  if (auditResults.length > 0 && !options.skipCompile && !options.dryRun) {
    try {
      const auditedIds = auditResults.map((r) => r.eventId).filter(Boolean);
      if (auditedIds.length > 0) {
        console.log(`⚡ [Auto-Publish] Compiling & publishing ${auditedIds.length} QC-audited event(s) to master catalog...`);
        const { compileCatalog } = await import("./compile_catalog.js");
        await compileCatalog({ ids: auditedIds });
      }
    } catch (compErr) {
      console.warn(`⚠️ [Auto-Publish] Compiler invocation warning: ${compErr.message}`);
    }
  }

  return auditResults;
}

async function recordLedgerEntry(result) {
  try {
    await safeUpdateJsonFile(LEDGER_PATH, [], (raw) => {
      let ledger = Array.isArray(raw) ? raw : (raw?.entries || []);
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
      return ledger;
    });
  } catch (e) { }
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
  } catch (e) { }
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
    else if (args[i] === "--harvested" || args[i] === "--harvested-only") {
      options.harvestedOnly = true;
      options.unverifiedOnly = false;
    }
    else if (args[i] === "--concurrency" && args[i + 1]) {
      options.concurrency = parseInt(args[++i], 10);
    }
    else if (args[i].startsWith("--concurrency=")) {
      options.concurrency = parseInt(args[i].split("=")[1], 10);
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
