import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { localBrowser } from "@browserbasehq/stagehand";
import { isWhitelistedTicketingUrl, validateTriadMatch, tokenizeText, LOW_SALIENCE_WORDS, TICKETING_PLATFORMS } from "./link_upgrader.js";
import { scanSingleLinkHealth } from "./link_health_scanner.js";
import { getCuratorInfo } from "./curator_display.js";
import {
  safeUpdateJsonFile,
  runWithConcurrency,
  createSemaphore,
  isAntigravityEngine,
  callAntigravityLinkAuditor,
  printAntigravityTimeoutSummary,
} from "./agy_engine.js";

const step1bBrowserSemaphore = createSemaphore(2);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const EVENTS_PATH = path.join(DATA_DIR, "events.json");
const QUEUE_PATH = path.join(DATA_DIR, "manual_review_queue.json");
const ARCHIVED_PATH = path.join(DATA_DIR, "archived_events.json");
const RULES_PATH = path.join(DATA_DIR, "curator_learned_rules.json");
const SCHEDULES_PATH = path.join(DATA_DIR, "layers", "layer_schedules.json");
const BOX_OFFICE_PATH = path.join(DATA_DIR, "layers", "layer_box_office.json");

function sanitizeExtractedUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
  let cleaned = rawUrl.replace(/&amp;/gi, "&").trim();
  try {
    const u = new URL(cleaned);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(?:fbclid|gclid|mc_cid|mc_eid|utm_)/i.test(k)) {
        u.searchParams.delete(k);
      }
    }
    return u.toString();
  } catch (_) {
    return cleaned;
  }
}

/**
 * Common program/events subdirectories on venue domains
 */
const VENUE_PROGRAM_SUBPATHS = [
  "/adult-programs/",
  "/adult-programs",
  "/programs/",
  "/programs",
  "/nature-programs/",
  "/events/",
  "/events",
  "/shows/",
  "/shows",
  "/calendar/",
  "/calendar",
  "/whats-on/",
  "/whats-on",
  "/tickets/",
  "/tickets",
  "/workshops/",
  "/workshops",
  "/schedule/",
  "/schedule",
  "/exhibitions/",
  "/exhibitions"
];

/**
 * Regex to extract href and iframe attributes from HTML
 */
function extractLinksFromHtml(html, baseUrl, contextSnippet = "") {
  if (!html || typeof html !== "string") return [];
  const results = [];
  const seen = new Set();
  let baseOrigin = "";
  try {
    baseOrigin = new URL(baseUrl).origin;
  } catch (_) {}

  // 1. Matches <a ... href="..." ...>(.*?)<\/a>
  const aRegex = /<a\s+(?:[^>]*?\s+)?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = aRegex.exec(html)) !== null) {
    let raw = match[1].trim();
    const rawText = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (raw.startsWith("/") && baseOrigin) {
      raw = `${baseOrigin}${raw}`;
    }
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      raw = sanitizeExtractedUrl(raw);
      if (!seen.has(raw)) {
        seen.add(raw);
        results.push({ url: raw, anchorText: rawText, contextSnippet });
      }
    }
  }

  // 2. Matches <iframe ... src="..." ...>
  const iframeRegex = /<iframe\s+(?:[^>]*?\s+)?src=["']([^"']+)["']/gi;
  while ((match = iframeRegex.exec(html)) !== null) {
    let raw = match[1].trim();
    if (raw.startsWith("/") && baseOrigin) {
      raw = `${baseOrigin}${raw}`;
    }
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      raw = sanitizeExtractedUrl(raw);
      if (!seen.has(raw)) {
        seen.add(raw);
        results.push({ url: raw, anchorText: "iframe_embed", contextSnippet });
      }
    }
  }

  return results;
}

/**
 * Fast HTML fetcher with timeout
 */
async function fetchHtmlText(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Van50Tier1Hunter/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      },
      redirect: "follow"
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    return await resp.text();
  } catch (_) {
    clearTimeout(timer);
    return null;
  }
}

/**
 * Searches HTML text for title token presence (with Weighted Salience & Distinctive Quorum)
 */
function pageMentionsTitle(html, title) {
  if (!html || !title) return false;
  const tokens = tokenizeText(title);
  if (tokens.length === 0) return false;
  const lower = html.toLowerCase();
  const highSalienceTokens = tokens.filter((t) => !LOW_SALIENCE_WORDS.has(t));
  const matches = tokens.filter((t) => lower.includes(t));
  const highMatches = highSalienceTokens.filter((t) => lower.includes(t));

  // If distinctive high-salience tokens exist, at least one MUST match!
  if (highSalienceTokens.length > 0 && highMatches.length === 0) {
    return false;
  }

  return matches.length >= Math.min(2, tokens.length) || (matches.length / tokens.length >= 0.5);
}

/**
 * Dynamic Browser Ticket Button & Iframe Inspection (Fresh isolated instance per event)
 * Executes client-side JavaScript to resolve dynamic buttons, SPA links, and embedded ticketing iframes.
 */
export async function dynamicBrowserInspectTicketLink(url, title, date, venue) {
  if (!url || !url.startsWith("http")) return { success: false, reason: "Invalid target URL" };
  return step1bBrowserSemaphore.run(async () => {
    let browser = null;
    try {
      browser = await localBrowser.launch();
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await new Promise((r) => setTimeout(r, 2500));

      const extractedCandidates = await page.evaluate(() => {
        const candidates = [];
        const seen = new Set();

        // 1. Look for anchor elements with ticketing keywords or platform domains
        const anchors = Array.from(document.querySelectorAll("a[href]"));
        for (const a of anchors) {
          const href = a.href;
          const text = (a.innerText || "").trim().toLowerCase();
          const aria = (a.getAttribute("aria-label") || "").toLowerCase();
          const titleAttr = (a.getAttribute("title") || "").toLowerCase();
          const combined = `${text} ${aria} ${titleAttr}`;
          if (
            href.startsWith("http") &&
            !seen.has(href) &&
            (/\b(ticket|tickets|buy|purchase|register|book|seats|admission|rsvp)\b/i.test(combined) ||
             /\b(eventbrite|showpass|ticketweb|admitone|universe|vtix|spektrix|dice\.fm|ovationtix|zaui)\b/i.test(href))
          ) {
            seen.add(href);
            candidates.push({ url: href, text: combined, type: "anchor" });
          }
        }

        // 2. Look for buttons that store target URLs in attributes
        const buttons = Array.from(document.querySelectorAll("button, [role='button'], .btn, .button"));
        for (const b of buttons) {
          const text = (b.innerText || "").trim().toLowerCase();
          const dataUrl = b.getAttribute("data-url") || b.getAttribute("data-href") || b.getAttribute("data-link");
          if (dataUrl && dataUrl.startsWith("http") && !seen.has(dataUrl)) {
            seen.add(dataUrl);
            candidates.push({ url: dataUrl, text: text, type: "button_data_url" });
          }
        }

        // 3. Look for ticketing iframes
        const iframes = Array.from(document.querySelectorAll("iframe[src]"));
        for (const ifr of iframes) {
          const src = ifr.src;
          if (src && src.startsWith("http") && !seen.has(src)) {
            seen.add(src);
            candidates.push({ url: src, text: "iframe", type: "iframe" });
          }
        }

        return candidates;
      });

      // Test each extracted candidate against Triad Validation
      for (const cand of extractedCandidates) {
        if (isWhitelistedTicketingUrl(cand.url)) {
          const triad = validateTriadMatch(cand.url, date, title, venue, {
            inContext: true,
            anchorText: cand.text
          });
          if (triad.valid) {
            return { success: true, url: cand.url, method: `dynamic_browser_${cand.type}` };
          }
        }
      }

      return { success: false, reason: "No whitelisted ticketing cart found in rendered DOM" };
    } catch (err) {
      return { success: false, reason: `Browser inspection error: ${err.message}` };
    } finally {
      if (browser) {
        try { await browser.close(); } catch (_) {}
      }
    }
  });
}

/**
 * Autonomous Tier 1 Hunter: Dedicated to discovering and verifying direct checkout cart URLs
 */
export async function huntTier1LinkForEvent(eventCard, options = {}) {
  const title = eventCard.title || eventCard.event_name || "";
  const date = eventCard.date || eventCard.startIso || "";
  const venue = eventCard.venue || eventCard.venue_name || "";

  // Epistemic Precedence Hierarchy (Rule 2E: Curator Rules Supreme)
  const curatorInfo = getCuratorInfo({
    eventId: eventCard.id || eventCard.event_id,
    title,
    venue,
    existingCard: eventCard
  });

  let currentBestUrl = eventCard.ticket_url || eventCard.details_url || eventCard.websiteUrl || eventCard.source_url || "";
  const activeCuratorNote = curatorInfo.effectiveNote || curatorInfo.eventInstructionText || curatorInfo.existingCuratorNotes;
  if (activeCuratorNote) {
    console.log(`🧑‍⚖️ [Tier 1 Hunter] Active Curator Note to consider: "${activeCuratorNote}"`);
  }
  if (curatorInfo.instructedUrl) {
    console.log(`🎯 [Tier 1 Hunter] Prioritizing Curator instructed destination URL (Rule 2E): ${curatorInfo.instructedUrl}`);
    currentBestUrl = curatorInfo.instructedUrl;
  }

  console.log(`\n🏹 [Tier 1 Hunter AI] Initiating hunt for "${title}" at "${venue}"...`);
  console.log(`   Inherited Highest Available URL: ${currentBestUrl || "(None)"}`);

  if (!title) {
    return { success: false, reason: "Missing event title to hunt" };
  }

  // Guard: Free Perennial Drop-Ins do not have single-date Eventbrite/Showpass concert carts
  const isFreePerennial =
    eventCard.lifecycle_type === "perennial_drop_in" &&
    (eventCard.isFree === true || eventCard.price === 0 || eventCard.priceLabel === "Free ($0)");

  if (isFreePerennial) {
    if (eventCard.candidate_tier1_url && /eventbrite\.|showpass\.|ticketweb\./i.test(eventCard.candidate_tier1_url)) {
      console.log(`🧹 [Tier 1 Hunter AI] Clearing unrelated concert candidate_tier1_url from free perennial drop-in: ${eventCard.candidate_tier1_url}`);
      delete eventCard.candidate_tier1_url;
      delete eventCard.candidate_tier1_source;
      delete eventCard.candidate_tier1_staged_at;
    }
    console.log(`🌳 [Tier 1 Hunter AI] "${title}" is a free perennial drop-in; skipping external box-office cart traversal.`);
    return {
      success: false,
      isFreePerennial: true,
      reason: "Free perennial drop-in; naturally capped at Tier 2/3/4 facility page"
    };
  }

  // Always verify liveness of currentBestUrl first (Poison-Pill Dead URL Guard)
  if (currentBestUrl && currentBestUrl.startsWith("http")) {
    const health = await scanSingleLinkHealth(currentBestUrl, eventCard);
    if (health.healthy && health.detectedTier === "tier1" && isWhitelistedTicketingUrl(currentBestUrl)) {
      console.log(`✅ [Tier 1 Hunter AI] Current link is already a healthy, verified Tier 1 cart: ${currentBestUrl}`);
      return {
        success: true,
        alreadyTier1: true,
        tier1Url: currentBestUrl,
        method: "existing_verified"
      };
    }
    if (!health.healthy && (health.status === "DEGRADED_DEAD_LINK" || health.status === "DEGRADED_EXPIRED" || health.status === "DEGRADED_REDIRECT_TO_ROOT" || health.status === "DEGRADED_TRUNCATED_TIER1_STUB")) {
      console.warn(`⚠️ [Tier 1 Hunter AI] Current URL (${currentBestUrl}) failed liveness check (${health.status}: ${health.reason}). Poisoning dead link and hunting for replacement!`);
      eventCard.dead_urls = Array.from(new Set([...(eventCard.dead_urls || []), currentBestUrl]));
      if (eventCard.ticket_url === currentBestUrl) eventCard.ticket_url = null;
      if (eventCard.candidate_tier1_url === currentBestUrl) eventCard.candidate_tier1_url = null;
      const fallbackStart = [eventCard.details_url, eventCard.websiteUrl, eventCard.source_url].find(
        (u) => u && typeof u === "string" && u.startsWith("http") && !eventCard.dead_urls.includes(u)
      );
      currentBestUrl = fallbackStart || "";
    }
  }

  let discoveredTier1 = null;
  let discoveredTier2 = null;
  let discoveryMethod = null;

  // ─────────────────────────────────────────────────────────────────────────────
  // HOP 1: In-Page Traversal on Current Best URL
  // ─────────────────────────────────────────────────────────────────────────────
  if (currentBestUrl && currentBestUrl.startsWith("http")) {
    console.log(`🔍 [Hop 1] Probing current destination page for embedded tickets/widgets: ${currentBestUrl}`);
    const pageHtml = await fetchHtmlText(currentBestUrl);

    if (pageHtml) {
      const extractedLinks = extractLinksFromHtml(pageHtml, currentBestUrl);

      // Check extracted links for whitelisted ticketing deep links
      for (const item of extractedLinks) {
        if (isWhitelistedTicketingUrl(item.url)) {
          const triad = validateTriadMatch(item.url, date, title, venue, {
            inContext: true,
            anchorText: item.anchorText,
            sectionText: item.contextSnippet
          });
          if (triad.valid) {
            discoveredTier1 = item.url;
            discoveredTier2 = currentBestUrl;
            discoveryMethod = "in_page_anchor_traversal";
            console.log(`🎯 [Hop 1 Success] Found direct ticketing cart: ${item.url} (${triad.reason})`);
            break;
          }
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HOP 2: Venue Subpage Traversal (Checking Program & Event Directories)
  // ─────────────────────────────────────────────────────────────────────────────
  if (!discoveredTier1 && currentBestUrl && currentBestUrl.startsWith("http")) {
    let origin = "";
    try { origin = new URL(currentBestUrl).origin; } catch (_) {}

    if (origin) {
      console.log(`🔍 [Hop 2] Scanning venue program and event subdirectories on ${origin}...`);

      for (const subpath of VENUE_PROGRAM_SUBPATHS) {
        const subUrl = `${origin}${subpath}`;
        const subHtml = await fetchHtmlText(subUrl);
        if (!subHtml) continue;

        // Check if this subpage mentions the target event title
        if (pageMentionsTitle(subHtml, title)) {
          console.log(`📖 [Hop 2 Match] Subpage "${subUrl}" contains event title! Inspecting section for booking links...`);
          discoveredTier2 = subUrl;

          // Scope extraction specifically to the section surrounding the event title
          const lowerHtml = subHtml.toLowerCase();
          const titleTokens = tokenizeText(title);
          let bestIdx = -1;
          for (const tok of titleTokens) {
            const idx = lowerHtml.indexOf(tok);
            if (idx !== -1) {
              bestIdx = idx;
              break;
            }
          }

          let sectionSlice = subHtml;
          if (bestIdx !== -1) {
            const start = Math.max(0, bestIdx - 300);
            const end = Math.min(subHtml.length, bestIdx + 2500);
            sectionSlice = subHtml.slice(start, end);
          }

          // Search scoped section first!
          const sectionLinks = extractLinksFromHtml(sectionSlice, subUrl, sectionSlice);
          for (const item of sectionLinks) {
            if (isWhitelistedTicketingUrl(item.url)) {
              const triad = validateTriadMatch(item.url, date, title, venue, {
                inContext: true,
                anchorText: item.anchorText,
                sectionText: sectionSlice
              });
              if (triad.valid) {
                discoveredTier1 = item.url;
                discoveryMethod = "venue_subpage_section_extraction";
                console.log(`🎯 [Hop 2 Success] Found direct ticketing cart in event section: ${item.url}`);
                break;
              }
            }
          }

          // If not in slice, check whole page links
          if (!discoveredTier1) {
            const allSubLinks = extractLinksFromHtml(subHtml, subUrl, subHtml);
            for (const item of allSubLinks) {
              if (isWhitelistedTicketingUrl(item.url)) {
                const triad = validateTriadMatch(item.url, date, title, venue, {
                  inContext: true,
                  anchorText: item.anchorText,
                  sectionText: subHtml
                });
                if (triad.valid) {
                  discoveredTier1 = item.url;
                  discoveryMethod = "venue_subpage_extraction";
                  console.log(`🎯 [Hop 2 Success] Found direct ticketing cart on subpage: ${item.url}`);
                  break;
                }
              }
            }
          }

          if (discoveredTier1) break;
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HOP 2.5: Dynamic Isolated Browser Button & Iframe Inspection
  // ─────────────────────────────────────────────────────────────────────────────
  if (!discoveredTier1 && currentBestUrl && currentBestUrl.startsWith("http") && options.useDynamicBrowser !== false) {
    console.log(`🌐 [Hop 2.5] Launching isolated browser inspection on ${currentBestUrl}...`);
    const dynRes = await dynamicBrowserInspectTicketLink(currentBestUrl, title, date, venue);
    if (dynRes.success) {
      discoveredTier1 = dynRes.url;
      discoveryMethod = dynRes.method;
      console.log(`🎯 [Hop 2.5 Success] Discovered ticketing cart via isolated browser: ${dynRes.url}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HOP 3: Grounded Venue Domain & Platform Discovery (DuckDuckGo / Open Search)
  // ─────────────────────────────────────────────────────────────────────────────
  if (!discoveredTier1) {
    console.log(`🔍 [Hop 3] Fallback to targeted domain query for "${title}" "${venue}"...`);
    let domain = "";
    try { domain = new URL(currentBestUrl).hostname.replace(/^www\./, ""); } catch (_) {}

    const searchQueries = [
      domain ? `https://html.duckduckgo.com/html/?q=site%3A${encodeURIComponent(domain)}+${encodeURIComponent(title)}` : null,
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(`${title} ${venue} vancouver tickets register`)}`
    ].filter(Boolean);

    for (const sUrl of searchQueries) {
      const sHtml = await fetchHtmlText(sUrl, 9000);
      if (!sHtml) continue;

      const candidateLinks = extractLinksFromHtml(sHtml, sUrl)
        .filter((u) => u && typeof u === "string" && !u.includes("duckduckgo.com") && u.startsWith("http"));

      for (const cand of candidateLinks) {
        if (isWhitelistedTicketingUrl(cand)) {
          const triad = validateTriadMatch(cand, date, title, venue);
          if (triad.valid) {
            discoveredTier1 = cand;
            discoveryMethod = "grounded_search_query";
            console.log(`🎯 [Hop 3 Success] Discovered ticketing cart via search: ${cand}`);
            break;
          }
        }
      }
      if (discoveredTier1) break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HOP 4: Live Verification & Atomic Staging
  // ─────────────────────────────────────────────────────────────────────────────
  if (discoveredTier1) {
    const health = await scanSingleLinkHealth(discoveredTier1, eventCard);
    if (!health.healthy && health.status.startsWith("DEGRADED")) {
      console.warn(`⚠️ [Tier 1 Hunter AI] Candidate link ${discoveredTier1} degraded: ${health.reason}`);
      return {
        success: false,
        reason: `Discovered link failed health check: ${health.reason}`
      };
    }

    // Attach candidate Tier 1 to event card
    eventCard.candidate_tier1_url = discoveredTier1;
    eventCard.candidate_tier1_source = discoveryMethod;
    eventCard.candidate_tier1_staged_at = new Date().toISOString();
    eventCard.ticket_url = discoveredTier1;

    if (!eventCard.links) eventCard.links = {};
    eventCard.links.tier1_checkout = discoveredTier1;
    eventCard.links.best_available = discoveredTier1;
    eventCard.links.best_tier = "tier1";

    if (discoveredTier2) {
      eventCard.details_url = discoveredTier2;
      eventCard.links.tier2_event_page = discoveredTier2;
    }

    if (!eventCard.dimension_audit) eventCard.dimension_audit = {};
    eventCard.dimension_audit.D101_tier1_checkout = {
      status: "verified",
      value: discoveredTier1,
      source_tool: "tier1_hunter_ai",
      audited_at: new Date().toISOString()
    };
    if (discoveredTier2) {
      eventCard.dimension_audit.D102_tier2_event_page = {
        status: "verified",
        value: discoveredTier2,
        source_tool: "tier1_hunter_ai",
        audited_at: new Date().toISOString()
      };
    }
    eventCard.dimension_audit.D106_best_available_link = {
      status: "verified",
      value: discoveredTier1,
      best_tier: "Tier 1: Checkout Cart",
      source_tool: "tier1_hunter_ai",
      audited_at: new Date().toISOString()
    };

    console.log(`🚀 [Tier 1 Hunter AI] Successfully upgraded link!`);
    console.log(`   Tier 1 Cart:  ${discoveredTier1}`);
    console.log(`   Tier 2 Event: ${discoveredTier2 || "(Unchanged)"}`);

    return {
      success: true,
      tier1Url: discoveredTier1,
      tier2Url: discoveredTier2,
      method: discoveryMethod
    };
  }

  console.log(`ℹ️ [Tier 1 Hunter AI] No verified Tier 1 cart found for "${title}". Retaining Tier 2/3 info links.`);
  return {
    success: false,
    reason: "No whitelisted ticketing cart discovered matching event triad"
  };
}

/**
 * Probes HTTP status and redirects for all link tiers on a single card for AI Link Auditor diagnostics
 */
async function probeEventLinksDiagnostics(card) {
  const fields = {
    ticket_url: card.ticket_url || null,
    details_url: card.details_url || null,
    candidate_tier1_url: card.candidate_tier1_url || null,
    tier1_checkout: card.links?.tier1_checkout || null,
    tier2_event_page: card.links?.tier2_event_page || null,
    tier3_calendar: card.links?.tier3_calendar || null,
    tier4_civic_destination: card.links?.tier4_civic_destination || null,
    tier5_venue_home: card.links?.tier5_venue_home || null,
  };
  const uniqueUrls = [...new Set(Object.values(fields).filter((u) => u && typeof u === "string" && u.startsWith("http")))];
  const probes = {};
  for (const u of uniqueUrls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);
    try {
      const resp = await fetch(u, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });
      clearTimeout(timer);
      probes[u] = {
        httpStatus: resp.status,
        finalUrl: resp.url || u,
        redirected: Boolean(resp.url && resp.url.replace(/\/+$/, "") !== u.replace(/\/+$/, "")),
        isWhitelistedTier1: isWhitelistedTicketingUrl(resp.url || u),
      };
    } catch (err) {
      clearTimeout(timer);
      probes[u] = {
        httpStatus: "FETCH_ERROR",
        error: err.message,
      };
    }
  }
  return { fields, probes };
}

/**
 * Batch Hunter across multiple cards (Bounded Parallel Execution)
 */
export async function huntBatchTier1Links(cardsList, options = {}) {
  if (cardsList && !Array.isArray(cardsList) && typeof cardsList === "object") {
    return runStep1BLinkUpgrader(null, cardsList);
  }
  const cards = Array.isArray(cardsList) ? cardsList : [];
  const useAgy = options.useAgy || isAntigravityEngine();
  const concurrency = options.concurrency || Number(process.env.VAN50_STEP1B_CONCURRENCY) || (useAgy ? 4 : 3);
  console.log(`\n================================================================`);
  console.log(`🏹 TIER 1 HUNTER AI BATCH RUNNER (Concurrency: ${Math.min(concurrency, Math.max(1, cards.length))}${useAgy ? " | 1-Event Isolated AI Instances Enabled" : ""})`);
  console.log(`🎯 Evaluating ${cards.length} cards...`);
  console.log(`================================================================\n`);

  let upgradedCount = 0;
  let aiAuditedCount = 0;

  const results = await runWithConcurrency(
    cards,
    concurrency,
    async (card, i) => {
      const eventId = card.id || card.event_id || card.slug || `event-${i + 1}`;
      const title = card.title || card.event_name || "Event";
      console.log(`📌 Processing [${i + 1}/${cards.length}]: ${title} [${eventId}]`);
      console.log(`🎯 URL: ${card.candidate_tier1_url || card.ticket_url || card.details_url}`);
      const res = await huntTier1LinkForEvent(card, options);
      if (res.success && !res.alreadyTier1) {
        upgradedCount++;
      }

      let aiAudit = null;
      if (useAgy) {
        const diag = await probeEventLinksDiagnostics(card);
        aiAudit = await callAntigravityLinkAuditor(card, diag);
        if (aiAudit) {
          aiAuditedCount++;
          if (aiAudit.ticket_url && aiAudit.ticket_url.startsWith("http")) {
            card.ticket_url = aiAudit.ticket_url;
          }
          if (aiAudit.details_url && aiAudit.details_url.startsWith("http")) {
            card.details_url = aiAudit.details_url;
          }
          if (!card.links) card.links = {};
          if (aiAudit.tier1_checkout !== undefined) {
            card.links.tier1_checkout = aiAudit.tier1_checkout || null;
            if (aiAudit.tier1_checkout && aiAudit.tier1_checkout.startsWith("http")) {
              card.candidate_tier1_url = aiAudit.tier1_checkout;
            } else if (aiAudit.tier1_checkout === null) {
              delete card.candidate_tier1_url;
            }
          }
          if (aiAudit.tier2_event_page !== undefined) card.links.tier2_event_page = aiAudit.tier2_event_page || null;
          if (aiAudit.tier3_calendar !== undefined) card.links.tier3_calendar = aiAudit.tier3_calendar || null;
          if (aiAudit.tier4_civic_destination !== undefined) card.links.tier4_civic_destination = aiAudit.tier4_civic_destination || null;
          if (aiAudit.tier5_venue_home !== undefined) card.links.tier5_venue_home = aiAudit.tier5_venue_home || null;
          if (aiAudit.best_tier) card.links.best_tier = aiAudit.best_tier;
          card._aiLinkAudit = aiAudit;
          console.log(`   🤖 [1-Event AI Link Audit] ${eventId}: changed=${Boolean(aiAudit.changed)} | best_tier=${aiAudit.best_tier} | reason="${aiAudit.audit_reason || ""}"`);
        }
      }

      console.log(`Committed updated event (${eventId})`);
      await new Promise((r) => setTimeout(r, 400));
      return { id: eventId, ...res, aiAudit };
    },
    { staggerMs: 350 }
  );

  if (useAgy) {
    printAntigravityTimeoutSummary("Stage 1B: 1-Event Link Auditor");
  }

  console.log(`\n================================================================`);
  console.log(`🏁 TIER 1 HUNTER BATCH COMPLETE:`);
  console.log(`   Total Evaluated: ${cards.length}`);
  console.log(`   Newly Upgraded:  ${upgradedCount}`);
  if (useAgy) {
    console.log(`   1-Event AI Audited: ${aiAuditedCount}/${cards.length}`);
  }
  console.log(`================================================================\n`);

  return { total: cards.length, upgradedCount, aiAuditedCount, results };
}

/**
 * Step 1B: High-Fidelity Link Tier Upgrader & Hunter
 * Distinct task executed automatically immediately after Step 1A Schedule Harvester.
 * Evaluates discovered events using bounded parallel workers with isolated browser instances and atomic file mutexes.
 */
export async function runStep1BLinkUpgrader(discoveredCards = null, options = {}) {
  const concurrency = options.concurrency || Number(process.env.VAN50_STEP1B_CONCURRENCY) || 3;
  console.log(`\n================================================================`);
  console.log(`🏹 STEP 1B: HIGH-FIDELITY LINK TIER UPGRADER & HUNTER (Concurrency: ${concurrency})`);
  console.log(`🛡️ Model: Bounded Parallel Workers + Isolated Browser per Event (Zero Context Bleed)`);
  console.log(`================================================================\n`);

  const archivedIds = new Set();
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
    }
  } catch (_) {}

  let schedules = [];
  if (fs.existsSync(SCHEDULES_PATH)) {
    try {
      schedules = await safeUpdateJsonFile(SCHEDULES_PATH, [], (schedList) => {
        return schedList.filter((s) => !archivedIds.has(String(s.id || s.event_id || "").toLowerCase()));
      });
    } catch (e) {
      console.warn(`⚠️ Error reading layer_schedules.json: ${e.message}`);
    }
  }

  // Determine target cards: either passed directly from Step 1A, from quarantine, or loaded from layer_schedules.json / events.json
  let targets = [];
  const requestedIds = Array.isArray(options.ids) && options.ids.length > 0
    ? options.ids
    : (options.id ? String(options.id).split(",").map((x) => x.trim()).filter(Boolean) : []);

  if (Array.isArray(discoveredCards) && discoveredCards.length > 0) {
    const discoveredIds = new Set(discoveredCards.map((c) => c.id || c.event_id || c.slug).filter(Boolean));
    targets = schedules.filter((s) => discoveredIds.has(s.id || s.event_id));
    if (targets.length === 0) targets = discoveredCards;
  } else if (requestedIds.length > 0) {
    const reqSet = new Set(requestedIds.map((x) => String(x).toLowerCase()));
    const combined = [...schedules];
    const seen = new Set(schedules.map((s) => String(s.id || s.event_id || "").toLowerCase()));
    if (fs.existsSync(EVENTS_PATH)) {
      try {
        const evs = JSON.parse(fs.readFileSync(EVENTS_PATH, "utf-8"));
        for (const e of (Array.isArray(evs) ? evs : [])) {
          const eid = String(e.id || e.event_id || "").toLowerCase();
          if (eid && !seen.has(eid)) { combined.push(e); seen.add(eid); }
        }
      } catch (_) {}
    }
    if (fs.existsSync(QUEUE_PATH)) {
      try {
        const q = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
        for (const e of (q.quarantinedEvents || [])) {
          const eid = String(e.id || e.event_id || "").toLowerCase();
          if (eid && !seen.has(eid)) { combined.push(e); seen.add(eid); }
        }
      } catch (_) {}
    }
    targets = combined.filter((c) => reqSet.has(String(c.id || c.event_id || c.slug || "").toLowerCase()));
  } else if (options.quarantine || options.quarantined) {
    let queue = { quarantinedEvents: [] };
    if (fs.existsSync(QUEUE_PATH)) {
      try { queue = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8")); } catch (_) {}
    }
    targets = queue.quarantinedEvents || [];
  } else if (options.all) {
    targets = [...schedules];
  } else {
    targets = schedules.filter((s) => !isWhitelistedTicketingUrl(s.ticket_url) || !s.candidate_tier1_url);
  }

  // Filter out any permanently archived or blacklisted cards when not explicitly targeting requested IDs
  if (requestedIds.length === 0) {
    targets = targets.filter((card) => {
      const cid = String(card.id || card.event_id || card.slug || "").toLowerCase();
      return !archivedIds.has(cid);
    });
  }

  if (options.limit && options.limit > 0 && !options.all && requestedIds.length === 0) {
    targets = targets.slice(0, options.limit);
  }

  if (targets.length === 0) {
    console.log(`ℹ️ [Step 1B] Zero discovered events in queue awaiting Tier 1 upgrade.`);
    return { total: 0, upgradedCount: 0, alreadyTier1Count: 0, retainedTier2Count: 0 };
  }

  console.log(`🎯 Target Queue: ${targets.length} event(s) awaiting Tier 1 elevation (Concurrency: ${Math.min(concurrency, targets.length)})`);

  let upgradedCount = 0;
  let alreadyTier1Count = 0;
  let retainedTier2Count = 0;

  await runWithConcurrency(
    targets,
    concurrency,
    async (card, i) => {
      const eventId = card.id || card.event_id || card.slug;
      const title = card.title || card.event_name || "Event";
      console.log(`\n─── [${i + 1}/${targets.length}] Step 1B Audit: "${title}" (${eventId}) ───`);
      console.log(`📌 Processing [${i + 1}/${targets.length}]: ${title} [${eventId}]`);
      console.log(`🎯 URL: ${card.candidate_tier1_url || card.ticket_url || card.details_url}`);

      if (isWhitelistedTicketingUrl(card.ticket_url) && !card.needs_tier1_hunt && !options.force && !options.quarantine) {
        const existingHealth = await scanSingleLinkHealth(card.ticket_url, card);
        if (existingHealth.healthy && existingHealth.detectedTier === "tier1") {
          console.log(`   ✅ Already verified healthy Tier 1 checkout cart: ${card.ticket_url}`);
          alreadyTier1Count++;
          console.log(`Committed updated event (${eventId})`);
          return;
        } else {
          console.warn(`   ⚠️ Existing Tier 1 URL failed live health check (${existingHealth.status}: ${existingHealth.reason}). Poisoning dead link and re-hunting!`);
          card.dead_urls = Array.from(new Set([...(card.dead_urls || []), card.ticket_url]));
          card.ticket_url = null;
          card.candidate_tier1_url = null;
        }
      }

      const huntResult = await huntTier1LinkForEvent(card, { useDynamicBrowser: true, ...options });
      if (huntResult.success && !huntResult.alreadyTier1) {
        upgradedCount++;
        console.log(`   🚀 Promoted to Tier 1 checkout: ${huntResult.tier1Url} [via ${huntResult.method}]`);
        console.log(`🎯 URL: ${huntResult.tier1Url}`);
      } else if (huntResult.alreadyTier1) {
        alreadyTier1Count++;
      } else {
        retainedTier2Count++;
        console.log(`   ℹ️ Retained verified Tier 2 event page: ${card.ticket_url || card.details_url || "(None - dead link poisoned)"}`);
      }

      console.log(`Committed updated event (${eventId})`);

      // Atomically update or insert entry in layer_schedules.json via mutex
      try {
        await safeUpdateJsonFile(SCHEDULES_PATH, [], (schedList) => {
          const sIdx = schedList.findIndex((s) => (s.id || s.event_id) === eventId);
          if (sIdx !== -1) {
            schedList[sIdx].ticket_url = card.ticket_url;
            if (Array.isArray(card.dead_urls) && card.dead_urls.length > 0) {
              schedList[sIdx].dead_urls = Array.from(new Set([...(schedList[sIdx].dead_urls || []), ...card.dead_urls]));
            }
            if (card.candidate_tier1_url) schedList[sIdx].candidate_tier1_url = card.candidate_tier1_url;
            else if (card.ticket_url === null) schedList[sIdx].candidate_tier1_url = null;
            if (card.candidate_tier1_source) schedList[sIdx].candidate_tier1_source = card.candidate_tier1_source;
            if (card.candidate_tier1_staged_at) schedList[sIdx].candidate_tier1_staged_at = card.candidate_tier1_staged_at;
            if (card.links) schedList[sIdx].links = card.links;
            schedList[sIdx].step1b_audited_at = new Date().toISOString();
          } else {
            schedList.push({
              id: eventId,
              event_id: eventId,
              title: card.title || card.event_name,
              venue_name: card.venue || card.venue_name,
              ticket_url: card.ticket_url,
              details_url: card.details_url,
              dead_urls: card.dead_urls || [],
              candidate_tier1_url: card.candidate_tier1_url || null,
              candidate_tier1_source: card.candidate_tier1_source || null,
              candidate_tier1_staged_at: card.candidate_tier1_staged_at || null,
              links: card.links || null,
              step1b_audited_at: new Date().toISOString(),
              audited_at: new Date().toISOString(),
              source_tool: "tier1_hunter_ai",
            });
          }
          return schedList;
        });
      } catch (err) {
        console.warn(`⚠️ Warning updating layer_schedules.json for ${eventId}: ${err.message}`);
      }

      // Also atomically sync to manual_review_queue.json if card is quarantined
      if (fs.existsSync(QUEUE_PATH)) {
        try {
          await safeUpdateJsonFile(QUEUE_PATH, { metadata: {}, quarantinedEvents: [] }, (qData) => {
            const qIdx = (qData.quarantinedEvents || []).findIndex((q) => (q.id || q.event_id) === eventId);
            if (qIdx !== -1) {
              if (card.ticket_url) qData.quarantinedEvents[qIdx].ticket_url = card.ticket_url;
              if (card.details_url) qData.quarantinedEvents[qIdx].details_url = card.details_url;
              if (card.candidate_tier1_url) qData.quarantinedEvents[qIdx].candidate_tier1_url = card.candidate_tier1_url;
              if (card.candidate_tier1_source) qData.quarantinedEvents[qIdx].candidate_tier1_source = card.candidate_tier1_source;
              if (card.candidate_tier1_staged_at) qData.quarantinedEvents[qIdx].candidate_tier1_staged_at = card.candidate_tier1_staged_at;
              if (card.links) qData.quarantinedEvents[qIdx].links = card.links;
              if (card.dimension_audit) {
                qData.quarantinedEvents[qIdx].dimension_audit = {
                  ...(qData.quarantinedEvents[qIdx].dimension_audit || {}),
                  ...card.dimension_audit,
                };
              }
            }
            return qData;
          });
        } catch (_) {}
      }

      // Brief backoff per worker
      await new Promise((r) => setTimeout(r, 400));
    },
    { staggerMs: 350 }
  );

  console.log(`💾 Successfully committed Step 1B results to data/layers/layer_schedules.json`);

  console.log(`\n================================================================`);
  console.log(`🏁 STEP 1B LINK TIER UPGRADER COMPLETE:`);
  console.log(`   Total Processed:           ${targets.length}`);
  console.log(`   Elevated to Tier 1 Cart:   ${upgradedCount}`);
  console.log(`   Already Tier 1:            ${alreadyTier1Count}`);
  console.log(`   Retained as Tier 2 Page:   ${retainedTier2Count}`);
  console.log(`================================================================\n`);

  return {
    total: targets.length,
    upgradedCount,
    alreadyTier1Count,
    retainedTier2Count,
  };
}

// Standalone CLI runner
if (process.argv[1] && process.argv[1].endsWith("tier1_hunter.js")) {
  let events = [];
  try {
    if (fs.existsSync(EVENTS_PATH)) {
      events = JSON.parse(fs.readFileSync(EVENTS_PATH, "utf-8"));
    }
  } catch (e) {
    console.error(`Failed to read events.json: ${e.message}`);
    process.exit(1);
  }

  let queue = { metadata: {}, quarantinedEvents: [] };
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      queue = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
    }
  } catch (e) {
    console.warn(`Failed to read manual_review_queue.json: ${e.message}`);
  }
  queue.quarantinedEvents = queue.quarantinedEvents || [];

  const combinedPool = [...events];
  const activeIds = new Set(events.map((e) => e.id || e.event_id));
  queue.quarantinedEvents.forEach((qEv) => {
    const qId = qEv.id || qEv.event_id;
    if (qId && !activeIds.has(qId)) {
      qEv._isFromQuarantine = true;
      combinedPool.push(qEv);
    }
  });

  const args = process.argv.slice(2);
  let targetIds = [];
  let limit = 0;
  let staleVal = null;
  let isAll = false;
  let isQuarantine = false;
  let isActiveOnly = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--id" && args[i + 1]) {
      const rawId = args[i + 1].trim();
      targetIds = rawId.includes(",") ? rawId.split(",").map((x) => x.trim()).filter(Boolean) : [rawId];
      i++;
    } else if (a === "--ids" && args[i + 1]) {
      targetIds = args[i + 1].split(",").map((x) => x.trim()).filter(Boolean);
      i++;
    } else if (a === "--limit" && args[i + 1]) {
      limit = parseInt(args[i + 1], 10) || 0;
      i++;
    } else if (a === "--stale" && args[i + 1]) {
      staleVal = args[i + 1].trim();
      i++;
    } else if (a === "--all") {
      isAll = true;
    } else if (a === "--active-only" || a === "--active") {
      isActiveOnly = true;
    } else if (a === "--quarantine" || a === "--quarantined") {
      isQuarantine = true;
    } else if (!a.startsWith("--") && !targetIds.length) {
      targetIds = [a.trim()];
    }
  }

  let targetCards = isActiveOnly ? events : combinedPool;
  if (isQuarantine && !targetIds.length) {
    targetCards = queue.quarantinedEvents;
  } else if (targetIds.length > 0) {
    const targetSet = new Set(targetIds);
    targetCards = combinedPool.filter((e) => targetSet.has(e.id || e.event_id));
    // If some target IDs are also in layer_schedules.json but not in combinedPool:
    if (fs.existsSync(SCHEDULES_PATH)) {
      try {
        const schedules = JSON.parse(fs.readFileSync(SCHEDULES_PATH, "utf-8"));
        const foundIds = new Set(targetCards.map((e) => e.id || e.event_id));
        schedules.forEach((s) => {
          const sid = s.id || s.event_id;
          if (sid && targetSet.has(sid) && !foundIds.has(sid)) {
            targetCards.push(s);
            foundIds.add(sid);
          }
        });
      } catch (_) {}
    }
  } else if (staleVal) {
    const parseDurationMs = (str) => {
      const match = String(str).trim().match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|m|mo|mon|month|months)$/i);
      if (!match) return 24 * 3600 * 1000;
      const val = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      if (unit.startsWith("h")) return val * 3600 * 1000;
      if (unit.startsWith("d")) return val * 24 * 3600 * 1000;
      if (unit.startsWith("w")) return val * 7 * 24 * 3600 * 1000;
      if (unit.startsWith("m")) return val * 30 * 24 * 3600 * 1000;
      return 24 * 3600 * 1000;
    };
    const durMs = parseDurationMs(staleVal);
    const now = Date.now();
    targetCards = events.filter((e) => {
      const ts = e.last_pulse_qc_at || e.last_content_qc_at || e.last_full_qc_at || e.last_qc_audited_at || e.audited_at || e.enriched_at;
      if (!ts) return true;
      const t = new Date(ts).getTime();
      return isNaN(t) || (now - t) >= durMs;
    });
  }

  if (limit > 0 && !isAll) {
    targetCards = targetCards.slice(0, limit);
  }

  console.log(`🎯 Targets Queued for Audit: ${targetCards.length} events`);

  huntBatchTier1Links(targetCards, { useAgy: isAntigravityEngine() })
    .then(async (stats) => {
      // 1. Sync upgraded leads to manual_review_queue.json if any were quarantined
      try {
        if (fs.existsSync(QUEUE_PATH)) {
          let qUpdated = false;
          await safeUpdateJsonFile(QUEUE_PATH, { metadata: {}, quarantinedEvents: [] }, (qData) => {
            for (const card of targetCards) {
              const cid = card.id || card.event_id;
              const qIdx = (qData.quarantinedEvents || []).findIndex((q) => (q.id || q.event_id) === cid);
              if (qIdx >= 0) {
                if (card.candidate_tier1_url) qData.quarantinedEvents[qIdx].candidate_tier1_url = card.candidate_tier1_url;
                if (card.ticket_url) qData.quarantinedEvents[qIdx].ticket_url = card.ticket_url;
                if (card.details_url) qData.quarantinedEvents[qIdx].details_url = card.details_url;
                if (card.links) qData.quarantinedEvents[qIdx].links = card.links;
                if (card.dimension_audit) {
                  qData.quarantinedEvents[qIdx].dimension_audit = {
                    ...(qData.quarantinedEvents[qIdx].dimension_audit || {}),
                    ...card.dimension_audit,
                  };
                }
                qUpdated = true;
              }
            }
            return qData;
          });
          if (qUpdated) {
            console.log(`💾 Synced upgraded link(s) to data/manual_review_queue.json`);
          }
        }
      } catch (qErr) {
        console.warn(`⚠️ Warning syncing to manual_review_queue.json: ${qErr.message}`);
      }

      // 2. Sync to layer_schedules.json & layer_box_office.json
      if (stats.upgradedCount > 0 || isAntigravityEngine() || isQuarantine) {
        try {
          if (fs.existsSync(SCHEDULES_PATH)) {
            let schedUpdated = false;
            await safeUpdateJsonFile(SCHEDULES_PATH, [], (schedules) => {
              for (const card of targetCards) {
                const cid = card.id || card.event_id;
                const sIdx = schedules.findIndex((s) => (s.id || s.event_id) === cid);
                if (sIdx >= 0) {
                  if (card.candidate_tier1_url !== undefined) schedules[sIdx].candidate_tier1_url = card.candidate_tier1_url;
                  if (card.ticket_url) schedules[sIdx].ticket_url = card.ticket_url;
                  if (card.details_url) schedules[sIdx].details_url = card.details_url;
                  if (card.links) schedules[sIdx].links = card.links;
                  if (card.links?.best_tier) schedules[sIdx].best_tier = card.links.best_tier;
                  schedUpdated = true;
                } else if (sIdx === -1 && (card.candidate_tier1_url || card.ticket_url)) {
                  schedules.push({
                    id: cid,
                    event_id: cid,
                    title: card.title || card.event_name,
                    venue_name: card.venue || card.venue_name,
                    ticket_url: card.ticket_url,
                    details_url: card.details_url,
                    candidate_tier1_url: card.candidate_tier1_url || null,
                    links: card.links,
                    audited_at: new Date().toISOString(),
                    source_tool: "tier1_hunter_ai",
                  });
                  schedUpdated = true;
                }
              }
              return schedules;
            });
            if (schedUpdated) {
              console.log(`💾 Synced audited link hierarchy to layer_schedules.json [Awaiting Compiler publication]`);
            }
          }
          if (fs.existsSync(BOX_OFFICE_PATH)) {
            let boxUpdated = false;
            await safeUpdateJsonFile(BOX_OFFICE_PATH, [], (boxEntries) => {
              for (const card of targetCards) {
                const cid = card.id || card.event_id;
                const bIdx = boxEntries.findIndex((b) => (b.id || b.event_id) === cid);
                if (bIdx >= 0) {
                  if (card.ticket_url) boxEntries[bIdx].ticket_url = card.ticket_url;
                  if (card.details_url) boxEntries[bIdx].details_url = card.details_url;
                  if (card.candidate_tier1_url !== undefined) boxEntries[bIdx].candidate_tier1_url = card.candidate_tier1_url;
                  boxUpdated = true;
                }
              }
              return boxEntries;
            });
            if (boxUpdated) {
              console.log(`💾 Synced audited ticket_url / details_url to layer_box_office.json`);
            }
          }
        } catch (_) {}
      }
      printAntigravityTimeoutSummary();
      process.exit(0);
    })
    .catch((err) => {
      console.error(`Tier 1 Hunter error: ${err.message}`);
      process.exit(1);
    });
}
