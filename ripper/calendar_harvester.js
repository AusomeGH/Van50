import dotenv from "dotenv";
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";
import { runHybridRipper } from "./hybrid_ripper.js";
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
  try {
    if (fs.existsSync(RULES_PATH)) {
      const rData = JSON.parse(fs.readFileSync(RULES_PATH, "utf-8"));
      (rData.archived_event_ids || []).forEach((id) => archivedIds.add(String(id).toLowerCase()));
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
    if (["event", "events", "search_exhausted_null", "quarantine_fatal", "page not found", "error 404", "404 not found", "granville island directory", "events & programs", "community events calendar", "vancouver events calendar", "plan your visit", "schools and groups", "become a member", "submit an event", "event booking guide", "filming in the city"].includes(rawTitle)) {
      return true;
    }
    if (/\b(?:closed\s+for\s+a?\s*private\s+(?:party|event|function|buyout)|greta\s+bar\s+yy[cz]|page\s+not\s+found|error\s+404)\b/i.test(rawTitle)) {
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
      if (/\.pdf(\?|$)/i.test(cu)) return true;
      if (/eventbrite\.(?:ca|com)\/(?:d|ttd|l|o|cc)\//i.test(cu)) return true;
      if (/gretabar\.com\/(?:toronto|calgary|edmonton)\b/i.test(cu)) return true;
      if (/\/(?:directory|library-archives|past-exhibitions|student-exhibitions|permanent-exhibitions|new-installations|collections|conservation|curatorial|sourcebooks|museum-shop|acquisitions-donations|moa-donors|indigenous-access|group-bookings|moa-access-pass|school-programs|public-programs|plan-your-visit|schools-and-groups|submit-event|event-booking-guide|filming-in-the-city|become-a-member|private-party|private-event)(\/|$)/i.test(cu)) return true;
      if (/\/(?:ticket-info|ticket-policies|pricing|admission-rates|concession-menu|support|corporate-giving|patrons-circle|major-gifts|tickets\/single-game-tickets|tickets\/special-offers|tickets\/season-tickets|tickets\/mini-plans|tickets\/group-tickets|series\/|education\/)\b/i.test(cu)) return true;
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

/**
 * Wide-Scan Calendar Link Extractor
 * Navigates to a venue calendar page and harvests discrete event deep links.
 */
export async function harvestCalendarLinks(calendarUrl) {
  if (!calendarUrl || calendarUrl === "all" || !calendarUrl.startsWith("http")) {
    calendarUrl = "https://theimprovcentre.ca/shows/";
  }
  console.log(`\n📅 HARVESTING CALENDAR LINKS from: ${calendarUrl}`);
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
    const page = await stagehand.browser.context.newPage(calendarUrl);
    await new Promise((r) => setTimeout(r, 4000)); // Allow dynamic calendar hydration

    // Auto-scroll to trigger lazy-loaded cards
    await page.evaluate(async () => {
      window.scrollBy(0, 1000);
      await new Promise((r) => setTimeout(r, 1000));
      window.scrollBy(0, 1000);
    });
    await new Promise((r) => setTimeout(r, 1500));

    // Extract event deep links using both DOM structural inspection (event cards, date badges, CTA buttons) and platform URL rules
    const links = await page.evaluate((origin, calendarUrl) => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const eventRegex = /\/(?:events?|shows?|films?|tickets?|schedule|performances?|screenings?|chooseseats|production|whats-on|whatson|season|concert|exhibition|program)\b/i;
      const ignoreRegex = /\/(?:login|signup|cart|basket|viewbasket|myaccount|account|privacy|terms|contact|about|donate|donations?|ticket-donations?|support|corporate-giving|patrons-circle|major-gifts|gift-cards?|vouchers?|faq|volunteer|membership|merchandise|merch|shop|ticket-info|tickets-info|ticketinfo|ticket-policies|pricing|admission-rates|rates|concession-menu|menus?|rentals?|private-events?|health-and-safety|house-rules|protocols|press|careers|staff|board|sponsors|accessibility|directions|parking|series|education)\b/i;
      const ctaTextRegex = /\b(?:buy\s+tickets?|get\s+tickets?|book\s+now|tickets?|reserve|more\s+info|event\s+details|view\s+event|view\s+show|learn\s+more|select\s+date)\b/i;
      const dateBadgeRegex = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}\b|\b\d{1,2}:\d{2}\s*(?:am|pm)\b/i;

      const candidates = new Set();
      const calNorm = (calendarUrl || '').replace(/\/$/, "");

      for (const a of anchors) {
        const href = a.href;
        if (!href || !href.startsWith("http")) continue;
        if (ignoreRegex.test(href)) continue;
        if (href.includes("ticket-donation") || href.includes("donation-program")) continue;

        const hrefNorm = href.split("?")[0].split("#")[0].replace(/\/$/, "");
        if (hrefNorm === calNorm) continue;

        // Skip generic root/directory index navigation paths that are not discrete events
        let urlObj = null;
        try {
          urlObj = new URL(hrefNorm);
          const p = urlObj.pathname.replace(/\/$/, "").toLowerCase();
          if (["", "/events", "/shows", "/tickets", "/schedule", "/calendar", "/listings", "/whats-on", "/whatson", "/season", "/programs", "/exhibitions", "/ticket-info", "/pricing", "/rates"].includes(p)) {
            continue;
          }
          if (p.endsWith("/ticket-info") || p.endsWith("/pricing") || p.endsWith("/admission-rates") || p.endsWith("/concession-menu")) {
            continue;
          }
        } catch (_) {
          continue;
        }

        // Skip Showpass non-event organizer/utility links
        if (href.includes("showpass.com/")) {
          try {
            const spPath = new URL(href).pathname.replace(/^\/|\/$/g, "");
            const firstSeg = spPath.split("/")[0].toLowerCase();
            if (["o", "s", "search", "login", "signup", "cart", "checkout", "about", "terms", "privacy", "organizations", "cities", "venues", "explore", "sell", "pricing", "contact", "support", "help", "faq", "blog", "app", "download", "features", "resources", "partners"].includes(firstSeg)) {
              continue;
            }
          } catch (_) { }
        }

        // 1. Known Ticketing Platform Deep Links
        let isCandidate = false;
        if (
          href.includes("eventbrite.ca/e/") ||
          href.includes("eventbrite.com/e/") ||
          href.includes("ticketweb.ca/event/") ||
          href.includes("universe.com/events/") ||
          href.includes("purchase.theimprovcentre.ca/ChooseSeats") ||
          href.includes("vtixonline.com/") ||
          href.includes("admitone.com/") ||
          href.includes("riotheatretickets.ca/events/") ||
          href.includes("bloomtickets.ca/event/") ||
          href.includes("humanitix.com/") ||
          href.includes("eventive.org/") ||
          href.includes("dice.fm/event/")
        ) {
          isCandidate = true;
        } else if (href.includes("showpass.com/")) {
          isCandidate = true;
        } else if (
          eventRegex.test(href) ||
          href.includes("/shows/") ||
          href.includes("/events/")
        ) {
          isCandidate = true;
        } else {
          // 2. DOM Structural Inspection (Catches clean event URLs that don't have "/events/" in their path, e.g. /whats-on/hamlet or /2026/show-slug)
          const isSameOrigin = urlObj && urlObj.origin === origin;
          const pathSegments = urlObj ? urlObj.pathname.replace(/^\/|\/$/g, "").split("/").filter(Boolean) : [];
          const inHeaderOrFooterNav = Boolean(a.closest("nav, header, footer"));

          if (!inHeaderOrFooterNav && isSameOrigin && pathSegments.length >= 1) {
            const cardContainer = a.closest('article, [class*="event"], [class*="show"], [class*="card"], [class*="performance"], [class*="listing"], [class*="program"], [class*="production"]');
            const linkText = (a.innerText || a.textContent || "").trim();
            const containerText = cardContainer ? (cardContainer.innerText || cardContainer.textContent || "") : "";
            const hasTimeTag = cardContainer ? Boolean(cardContainer.querySelector("time, [datetime], [class*='date'], [class*='time']")) : false;
            const hasDateEvidence = hasTimeTag || dateBadgeRegex.test(containerText);

            if (cardContainer && (hasDateEvidence || ctaTextRegex.test(linkText))) {
              isCandidate = true;
            }
          }
        }

        if (isCandidate) {
          candidates.add(href.split("?")[0].split("#")[0]);
        }
      }
      return Array.from(candidates);
    }, new URL(calendarUrl).origin, calendarUrl);

    console.log(`🎯 Discovered ${links.length} distinct event candidate links on calendar.`);
    return links;
  } catch (err) {
    console.error(`⚠️ Error harvesting calendar links: ${err.message}`);
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
        // Discrete execution per event with fresh context, bounded by browser semaphore
        const card = await step1aBrowserSemaphore.run(() => runHybridRipper(targetUrl, { autoApprove, fromHarvester: true }));
        const evDate = card.date || card.dateSchedule || "TBD";
        const evTime = card.time || card.doors_time || "";
        const evVenue = card.venue || card.venue_name || "Vancouver Venue";

        const cardIdNorm = (card.id || "").toLowerCase();
        const todayIsoNow = new Date().toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
        if (card.lifecycle_type !== "perennial_drop_in") {
          const isoShowings = Array.isArray(card.showings) ? card.showings.filter((sh) => sh && sh.date && /^\d{4}-\d{2}-\d{2}$/.test(sh.date)) : [];
          const hasUpcomingShowing = isoShowings.some((sh) => sh.date >= todayIsoNow);
          const rawDateStr = String(card.date || card.dateSchedule || "");
          const isoMatch = rawDateStr.match(/\b(202\d-\d{2}-\d{2})\b/);
          const extractedIso = isoMatch ? isoMatch[1] : null;
          if ((extractedIso && extractedIso < todayIsoNow && !hasUpcomingShowing) || (isoShowings.length > 0 && !hasUpcomingShowing)) {
            console.log(`🛡️ [Past Event Suppressed] "${card.title}" (${extractedIso || rawDateStr}) has already concluded (< ${todayIsoNow}). Suppressing from layer_schedules.json.`);
            results.push({ url: targetUrl, success: false, isNew: false, error: "Concluded past event" });
            return;
          }
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

        // Check if card is already archived or quarantined
        if (lookup.archivedIds.has(cardIdNorm)) {
          console.log(`🛡️ [Archived Event Suppressed] "${card.title}" [${card.id}] is permanently archived/disqualified. Suppressing from layer_schedules.json.`);
          results.push({
            url: targetUrl,
            success: false,
            isNew: false,
            error: "Permanently archived event",
          });
          return;
        }

        const isAlreadyInCatalog = lookup.knownIds.has(cardIdNorm) ||
          (card.ticket_url && lookup.knownUrls.has(card.ticket_url.split("?")[0].split("#")[0].replace(/\/$/, "").toLowerCase())) ||
          (card.title && lookup.knownTitles.has(card.title.toLowerCase().trim()) && card.date);

        if (isAlreadyInCatalog) {
          console.log(`ℹ️ [Catalog Match] "${card.title}" (${card.id}) already cataloged in data/events.json — continuing scan for new events...`);
        } else {
          console.log(`✨ HARVESTED EVENT: "${card.title}" | Date: ${evDate} | Time: ${evTime || "TBD"} | Venue: ${evVenue} | Price: ${card.priceLabel || "$0"} | URL: ${card.ticket_url || targetUrl || ""} [${card.id}]`);
        }
        logCuratorInfo({ eventId: card.id, title: card.title, venue: evVenue, existingCard: card, prefix: "   " });

        // Persist entry to layer_schedules.json atomically via mutex
        try {
          const resolvedCity = card.city || options.city || inferFeedCity({ venue_name: evVenue, url: targetUrl });
          await safeUpdateJsonFile(SCHEDULES_PATH, [], (schedules) => {
            const existingIdx = schedules.findIndex((s) => (s.id || s.event_id) === card.id);
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
              schedules[existingIdx] = schedEntry;
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
export function inferFeedCity(item = {}) {
  const explicit = String(item.city || item.region || "").trim().toLowerCase();
  if (explicit === "surrey") return "Surrey";
  if (explicit === "vancouver") return "Vancouver";
  const blob = `${item.venue_name || ""} ${item.name || ""} ${item.neighborhood || ""} ${item.full_address || ""} ${item.address || ""} ${item.url || ""} ${item.calendar_url || ""} ${item.website_url || ""}`.toLowerCase();
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
    "kpu.ca", "r/surreybc", "vancouverfc", "businessinsurrey"
  ];
  if (surreyTokens.some((tok) => blob.includes(tok))) return "Surrey";
  return "Vancouver";
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

  const rawCity = String(options.city || "all").trim().toLowerCase();
  const cityScope = (rawCity === "vancouver" || rawCity === "surrey") ? rawCity : "all";

  const seenUrls = new Set();
  const allFeeds = [];
  for (const v of venues) {
    const curatorInfo = getCuratorInfo({ venue: v.venue_name });
    const url = (curatorInfo.learnedVenueUrl || curatorInfo.instructedUrl || v.calendar_url || v.website_url || "").trim();
    if (url && url.startsWith("http") && !seenUrls.has(url)) {
      seenUrls.add(url);
      allFeeds.push({
        name: v.venue_name || "Venue",
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
    { name: "Firehall Arts Centre", url: "https://www.firehallartscentre.ca/on-stage/", city: "Vancouver" },
    { name: "The Improv Centre", url: "https://theimprovcentre.ca/shows/", city: "Vancouver" }
  ];
  for (const s of seedFeeds) {
    if (!seenUrls.has(s.url)) {
      seenUrls.add(s.url);
      allFeeds.push(s);
    }
  }

  // Include verified regional & Vancouver discovery sources
  try {
    if (fs.existsSync(DISCOVERY_SOURCES_PATH)) {
      const discRaw = JSON.parse(fs.readFileSync(DISCOVERY_SOURCES_PATH, "utf-8"));
      const discSources = Array.isArray(discRaw) ? discRaw : (discRaw.sources || []);
      for (const s of discSources) {
        if (s.id === "testy-canary-feed" || s.type === "canary_test_feed") continue;
        const u = (s.eventsUrl || s.calendarUrl || s.url || "").trim();
        if (u && u.startsWith("http") && !u.includes("127.0.0.1") && !seenUrls.has(u)) {
          seenUrls.add(u);
          allFeeds.push({
            name: s.name || s.id || "Discovery Source",
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
        const u = (s.url || "").trim();
        if (u && u.startsWith("http") && !seenUrls.has(u)) {
          seenUrls.add(u);
          allFeeds.push({
            name: s.name || "Surrey Source",
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

  allFeeds.sort((a, b) => scoreFeedPriority(b) - scoreFeedPriority(a));

  // Filter feeds by requested single city ("vancouver" | "surrey") or keep all ("all")
  const feeds = cityScope === "all"
    ? allFeeds
    : allFeeds.filter((f) => String(f.city || "Vancouver").toLowerCase() === cityScope);

  const maxTotalEvents = (options.maxEvents !== undefined && options.maxEvents !== null) ? Number(options.maxEvents) : 0;
  const isResume = Boolean(options.resume);
  const CHECKPOINT_PATH = path.join(ROOT_DIR, "data", "layers", "harvester_checkpoint.json");

  let completedFeedUrls = new Set();
  let startFeedIndex = 0;
  let priorEventsHarvested = 0;

  if (isResume && fs.existsSync(CHECKPOINT_PATH)) {
    try {
      const cp = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf-8"));
      const rawCompleted = Array.isArray(cp.completed_feed_urls) ? cp.completed_feed_urls : [];
      const feedUrlSet = new Set(feeds.map((f) => f.url));
      const matchingCompleted = rawCompleted.filter((u) => feedUrlSet.has(u));
      // Only treat as already 100% completed if every feed in the current scope was already scanned
      if (matchingCompleted.length < feeds.length) {
        rawCompleted.forEach((u) => completedFeedUrls.add(u));
        const firstUnscannedIdx = feeds.findIndex((f) => !completedFeedUrls.has(f.url));
        startFeedIndex = firstUnscannedIdx >= 0 ? firstUnscannedIdx : 0;
        priorEventsHarvested = Number(cp.events_harvested_in_run) || 0;
      }
    } catch (cpErr) {
      console.warn(`[WARN] Could not read harvester_checkpoint.json: ${cpErr.message}`);
    }
  }

  let totalHarvestedEvents = 0;
  const cityLabel = cityScope === "vancouver"
    ? "🏙️ VANCOUVER ONLY"
    : cityScope === "surrey"
      ? "🦌 SURREY ONLY"
      : "🌲 ALL METRO (VANCOUVER + SURREY)";

  console.log(`\n================================================================`);
  console.log(`🌐 STEP 1A CALENDAR HARVESTER — [${cityLabel}]${isResume ? " (RESUMING FROM CHECKPOINT)" : ""}`);
  console.log(`📊 Prioritized ${feeds.length} source feeds for ${cityLabel} (from ${allFeeds.length} total registered sources)`);
  if (isResume && completedFeedUrls.size > 0) {
    const scannedInScope = feeds.filter((f) => completedFeedUrls.has(f.url)).length;
    console.log(`⏩ [Resume Mode] Skipping ${scannedInScope} completed feeds — next unscanned is Feed [${startFeedIndex + 1}/${feeds.length}]: ${feeds[startFeedIndex]?.name || "Next Feed"}`);
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
    if (isResume && completedFeedUrls.has(feed.url)) {
      continue;
    }

    if (maxTotalEvents > 0 && totalHarvestedEvents >= maxTotalEvents) {
      console.log(`\n🎯 REACHED TARGET LIMIT: Successfully harvested ${totalHarvestedEvents}/${maxTotalEvents} discrete events.`);
      break;
    }

    const needed = maxTotalEvents > 0 ? (maxTotalEvents - totalHarvestedEvents) : 0;

    // Persist checkpoint as we begin this feed so stopping mid-feed resumes right here
    try {
      await safeUpdateJsonFile(CHECKPOINT_PATH, {}, (cp) => ({
        ...cp,
        status: "running",
        city_scope: cityScope,
        total_feeds: feeds.length,
        completed_feeds_count: completedFeedUrls.size,
        resume_from_index: i,
        resume_from_feed_number: i + 1,
        last_feed_name: feed.name,
        last_feed_url: feed.url,
        last_feed_city: feed.city,
        completed_feed_urls: Array.from(completedFeedUrls),
        events_harvested_in_run: priorEventsHarvested + totalHarvestedEvents,
        updated_at: new Date().toISOString(),
      }));
    } catch (_) { }

    console.log(`\n────────────────────────────────────────────────────────────────`);
    console.log(`${formatLogTime()} 🏛️ [${i + 1}/${feeds.length}] [${feed.city}] Source Feed: ${feed.name}`);
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

      // Mark feed completed if we weren't halted early by maxTotalEvents cap
      if (!(maxTotalEvents > 0 && totalHarvestedEvents >= maxTotalEvents)) {
        completedFeedUrls.add(feed.url);
      }
      const nextIdx = (maxTotalEvents > 0 && totalHarvestedEvents >= maxTotalEvents) ? i : Math.min(feeds.length - 1, i + 1);
      try {
        await safeUpdateJsonFile(CHECKPOINT_PATH, {}, (cp) => ({
          ...cp,
          status: (i === feeds.length - 1 && !(maxTotalEvents > 0 && totalHarvestedEvents >= maxTotalEvents)) ? "completed" : "paused",
          city_scope: cityScope,
          total_feeds: feeds.length,
          completed_feeds_count: (i === feeds.length - 1 && !(maxTotalEvents > 0 && totalHarvestedEvents >= maxTotalEvents)) ? feeds.length : completedFeedUrls.size,
          resume_from_index: nextIdx,
          resume_from_feed_number: nextIdx + 1,
          last_feed_name: feeds[nextIdx]?.name || feed.name,
          last_feed_url: feeds[nextIdx]?.url || feed.url,
          last_feed_city: feeds[nextIdx]?.city || feed.city,
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
  const isBatchTarget =
    !normTarget ||
    normTarget === "all" ||
    normTarget === "all:resume" ||
    normTarget === "vancouver" ||
    normTarget === "vancouver:resume" ||
    normTarget === "all:vancouver" ||
    normTarget === "all:vancouver:resume" ||
    normTarget === "surrey" ||
    normTarget === "surrey:resume" ||
    normTarget === "all:surrey" ||
    normTarget === "all:surrey:resume";

  if (isBatchTarget) {
    const isResumeTarget = normTarget.endsWith(":resume") || isResumeCli;
    let resolvedCity = cliCity || "all";
    if (normTarget.includes("vancouver")) resolvedCity = "vancouver";
    else if (normTarget.includes("surrey")) resolvedCity = "surrey";

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
