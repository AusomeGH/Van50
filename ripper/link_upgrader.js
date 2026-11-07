import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const LAYERS_DIR = path.join(DATA_DIR, "layers");
const SCHEDULES_PATH = path.join(LAYERS_DIR, "layer_schedules.json");
const EVENTS_PATH = path.join(DATA_DIR, "events.json");
const QUEUE_PATH = path.join(DATA_DIR, "manual_review_queue.json");
const VENUES_PATH = path.join(DATA_DIR, "venues.json");

/**
 * Whitelisted cultural event ticketing platforms
 */
export const TICKETING_PLATFORMS = [
  "showpass.com",
  "eventbrite.ca",
  "eventbrite.com",
  "ticketweb.ca",
  "universe.com",
  "vtixonline.com",
  "admitone.com",
  "theatrewire.com",
  "spektrix.com",
  "ovationtix.com",
  "dice.fm",
  "brownpapertickets.com",
  "eventive.org",
  "tickit.ca",
  "purchase.theimprovcentre.ca",
  "purchase.firehallartscentre.ca",
  "tickets.tightropetheatre.com",
  "tickets.thecinematheque.ca",
  "tickets.vanartgallery.bc.ca",
  "ticketing.thecultch.com",
  "zeffy.com",
  "exploretock.com",
  "gigpit.ca",
  "square.link",
  "zaui.net",
  "tockify.com",
  "sidedooraccess.com",
  "ticketscene.ca",
  "ticketmaster.ca",
  "ticketmaster.com",
  "riotheatretickets.ca",
  "bloomtickets.ca",
  "humanitix.com",
  "admitonelive.com",
  "tickets.admitone.com",
  "tickets.jflvancouver.com",
  "secure.vancouversymphony.ca",
  "tickets.ubc.ca",
  "ticketpro.ca",
  "ww2.ticketpro.ca",
  "ticketleader.ca"
];

/**
 * Blacklisted non-Metro-Vancouver regional identifiers
 */
export const BLACKLISTED_GEO_TOKENS = [
  "toronto", "calgary", "montreal", "victoria", "edmonton", "ottawa",
  "whistler", "kelowna", "kamloops", "seattle", "portland", "london",
  "new-york", "los-angeles", "chicago", "winnipeg", "halifax", "hamilton",
  "oshawa", "nanaimo", "penticton", "vernon", "campbell-river", "squamish",
  "abbotsford", "chilliwack", "mission", "pemberton", "gulf-islands",
  "salt-spring", "duncan", "courtenay", "comox", "tofino", "ukee"
];

/**
 * Common stopwords to exclude from title tokenization
 */
const STOP_WORDS = new Set([
  "the", "and", "with", "from", "for", "theatre", "theater", "presents",
  "production", "vancouver", "show", "live", "stage", "play", "season",
  "annual", "festival", "society", "company", "event", "tickets", "admission",
  "general", "advance", "door", "doors", "presents:", "hosted", "by", "at",
  "2024", "2025", "2026", "2027", "canada", "bc", "british", "columbia"
]);

/**
 * Month abbreviations for date string normalization
 */
const MONTH_NAMES = {
  "01": ["jan", "january"],
  "02": ["feb", "february"],
  "03": ["mar", "march"],
  "04": ["apr", "april"],
  "05": ["may"],
  "06": ["jun", "june"],
  "07": ["jul", "july"],
  "08": ["aug", "august"],
  "09": ["sep", "september"],
  "10": ["oct", "october"],
  "11": ["nov", "november"],
  "12": ["dec", "december"]
};

/**
 * Checks if a URL points to a whitelisted ticketing domain with a deep-link path
 */
export function isWhitelistedTicketingUrl(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.startsWith("help.") || host.startsWith("support.") || host.startsWith("blog.") || host.startsWith("status.")) return false;
    if (host.includes("viff.org") && /\/whats-on\/[^/]+\/book\/[^/]+/i.test(u.pathname)) return true;
    if (host.includes("thecultch.com") && /EventInstanceId=|ChooseSeats\.aspx/i.test(u.search + u.pathname)) return true;
    const isPlatform = TICKETING_PLATFORMS.some((p) => host.includes(p));
    if (!isPlatform) return false;

    // Check for hash-based SPA deep routing (e.g. zaui.net/booking/web/#/default/activity/386)
    if (u.hash && u.hash.length > 5 && (u.hash.includes("/activity/") || u.hash.includes("/event/") || u.hash.includes("/booking/"))) {
      return true;
    }

    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    // Reject root landing pages or generic organizer/directory roots
    if (!path || path.length <= 2) return false;
    if (["/events", "/shows", "/tickets", "/schedule", "/o", "/d", "/home", "/browse", "/blog", "/help", "/about", "/login", "/signin", "/support", "/press", "/careers", "/legal", "/privacy"].includes(path)) {
      return false;
    }
    // Reject corporate/blog/support/organizer profile paths
    if (
      path.startsWith("/o/") ||
      path.startsWith("/organizer/") ||
      path.startsWith("/venue/") ||
      path.startsWith("/blog/") ||
      path.startsWith("/help/") ||
      path.startsWith("/hc/") ||
      path.startsWith("/about/") ||
      path.startsWith("/support/") ||
      path.startsWith("/login/") ||
      path.startsWith("/signin/") ||
      path.startsWith("/legal/")
    ) {
      return false;
    }

    // Eventbrite specific check: must be a valid event path /e/... and have digits in the ID
    if (host.includes("eventbrite")) {
      if (!path.startsWith("/e/")) return false;
      // Reject if it doesn't contain a numeric ID or ends in just '-tickets'
      if (!/\d{5,}/.test(path)) return false;
    }

    // Ticketweb specific check: must be an event path /event/... and contain a numeric ID
    if (host.includes("ticketweb")) {
      if (!path.startsWith("/event/")) return false;
      // Reject if it doesn't contain a numeric ID suffix (e.g. /14338414)
      if (!/\d{5,}/.test(path)) return false;
    }

    // Showpass specific check: must not be a bare platform directory
    if (host.includes("showpass")) {
      if (["/shows", "/events", "/season", "/venues", "/organizations"].includes(path)) return false;
    }

    // Reject empty shopping basket / account / login / donation utility endpoints (e.g. Agile ViewBasket.aspx, Spektrix /MyAccount)
    if (
      path.includes("viewbasket.aspx") ||
      path.endsWith("/myaccount") ||
      path.endsWith("/account") ||
      path.endsWith("/basket") ||
      path.endsWith("/cart") ||
      path.includes("/donate") ||
      path.includes("/membership")
    ) {
      return false;
    }

    // Agile Ticketing (tickets.thecinematheque.ca): must contain specific screening evtinfo= parameter
    if (host.includes("tickets.thecinematheque.ca")) {
      if (!(u.search || "").toLowerCase().includes("evtinfo=")) return false;
    }

    // VSO Tessitura TNEW (secure.vancouversymphony.ca): must be a numeric package/performance path (e.g. /7633/7634 or /7356)
    if (host.includes("secure.vancouversymphony.ca")) {
      if (!/^\/\d+(?:\/\d+)?$/i.test(path)) return false;
    }

    // UBC Chan Centre AudienceView (tickets.ubc.ca): must contain article_id= or seatSelect
    if (host.includes("tickets.ubc.ca")) {
      const fullQuery = `${path}${u.search}`.toLowerCase();
      if (!fullQuery.includes("article_id=") && !fullQuery.includes("seatselect") && !fullQuery.includes("loadarticle")) return false;
    }

    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Common event vocabulary words with low discriminative power
 */
export const LOW_SALIENCE_WORDS = new Set([
  "halloween", "christmas", "holiday", "winter", "summer", "spring", "fall", "autumn",
  "market", "artisan", "craft", "fair", "pop", "party", "ball", "tribute", "annual",
  "edition", "night", "live", "comedy", "music", "concert", "tour", "festival", "show",
  "special", "sessions", "presents", "series", "friday", "saturday", "sunday",
  "monday", "tuesday", "wednesday", "thursday", "club", "improv", "volume",
  "screening", "premiere", "exhibition", "showcase", "gathering", "celebration",
  "international", "canada", "canadian", "vancouver", "art", "arts", "workshop",
  "class", "studio", "experience", "diwali", "matinee", "evening", "weekend", "garden", "park", "island", "museum", "centre", "center", "gallery", "hall", "room", "bar", "lounge"
]);

/**
 * Checks if a URL is a truncated checkout stub (missing database ID)
 */
export function isTruncatedCheckoutUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");

    if (host.includes("ticketweb") && path.startsWith("/event/") && !/\d{5,}/.test(path)) {
      return true;
    }
    if (host.includes("eventbrite") && path.startsWith("/e/") && !/\d{5,}/.test(path)) {
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Checks if a URL is a generic Tier 2/3 directory stub lacking a specific event slug
 */
export function isGenericDirectoryStub(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    if (!path || path === "" || path === "/") return true;
    const genericEndpoints = [
      "/events", "/shows", "/calendar", "/whats-on", "/schedule",
      "/tickets", "/programs", "/exhibitions", "/adult-programs",
      "/nature-programs", "/season", "/performances"
    ];
    // If path exactly matches or is just a single segment of generic directory without query params or sub-slug
    if (genericEndpoints.includes(path) && !u.search && (!u.hash || u.hash.length <= 1)) {
      return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Checks if a URL is a truncated or incomplete event page URL (Tier 2 stub lacking an event slug)
 */
export function isTruncatedEventPageUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    if (!path || path === "" || path === "/") return false; // Handled by homepage check

    // Check if the path ends immediately on a collection folder that requires a child slug
    const collectionFolders = [
      "/event", "/events",
      "/show", "/shows",
      "/whats-on", "/whatson",
      "/production", "/productions",
      "/exhibition", "/exhibitions",
      "/concert", "/concerts",
      "/performance", "/performances",
      "/program", "/programs",
      "/adult-programs", "/nature-programs",
      "/calendar", "/schedule", "/season"
    ];

    if (collectionFolders.includes(path) && !u.search && (!u.hash || u.hash.length <= 1)) {
      return true;
    }

    // Check for trailing incomplete hyphen or underscore stubs (e.g. /event/midnight-witch-)
    if (path.endsWith("-") || path.endsWith("_")) {
      return true;
    }

    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Classifies a URL into its check out link tier (Tier 1 Cart, Tier 2 Event Page, Tier 3 Calendar, Tier 4 Civic Guide, Tier 5 Homepage)
 * and detects truncated or degraded stubs for any check out tier.
 * (Note: Does not touch or modify ticket pricing tiers).
 */
export function classifyCheckoutLinkTier(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    return { tier: "none", valid: false, reason: "Missing or invalid HTTP/HTTPS URL" };
  }

  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");

    // 1. Tier 1 Checkout Cart / Ticket Instance
    if (isWhitelistedTicketingUrl(url)) {
      if (isTruncatedCheckoutUrl(url)) {
        return {
          tier: "tier1_stub",
          valid: false,
          degraded: true,
          reason: "Truncated Tier 1 checkout cart link (missing numeric database ID)"
        };
      }
      return { tier: "tier1", valid: true, reason: "Verified Tier 1 checkout cart deep link" };
    }

    // Ticketing platform domain but failed whitelisting (e.g. truncated Ticketweb / Eventbrite stub)
    const isPlatformHost = TICKETING_PLATFORMS.some((p) => host.includes(p));
    if (isPlatformHost) {
      if (isTruncatedCheckoutUrl(url)) {
        return {
          tier: "tier1_stub",
          valid: false,
          degraded: true,
          reason: "Truncated Tier 1 ticketing platform stub (missing required database event ID)"
        };
      }
      if (isGenericDirectoryStub(url) || path === "" || path === "/") {
        return {
          tier: "tier3",
          valid: false,
          degraded: true,
          reason: "Generic platform directory rather than specific checkout cart"
        };
      }
    }

    // 2. Check for Truncated Tier 2 Event Page Stub
    if (isTruncatedEventPageUrl(url) || isGenericDirectoryStub(url)) {
      return {
        tier: "tier2_stub",
        valid: false,
        degraded: true,
        reason: `Truncated Tier 2 event details link (${path || "/"}) lacking specific event slug`
      };
    }

    // 3. Tier 4 Civic Guides & Aggregators (Do604, Georgia Straight, etc.)
    const civicDomains = ["do604.com", "straight.com", "destinationvancouver.com", "miss604.com", "vancouverisawesome.com"];
    if (civicDomains.some((cd) => host.includes(cd))) {
      if (path === "" || path === "/" || path === "/events" || path === "/listings") {
        return {
          tier: "tier4_stub",
          valid: false,
          degraded: true,
          reason: "Generic civic aggregator index lacking specific event slug"
        };
      }
      return { tier: "tier4", valid: true, reason: "Tier 4 civic discovery guide listing" };
    }

    // 4. Tier 5 Venue Homepage
    const isRoot = (!path || path === "" || path === "/" || /^\/(home|index(\.html|\.php)?|en|default(\.aspx)?)$/i.test(path)) && (!u.hash || u.hash.length <= 1);
    if (isRoot) {
      return { tier: "tier5", valid: true, reason: "Tier 5 venue homepage" };
    }

    // 5. Tier 2 Dedicated Event Subpage
    if (path.length > 2) {
      return { tier: "tier2", valid: true, reason: "Tier 2 dedicated event details subpage" };
    }

    return { tier: "tier3", valid: true, reason: "Tier 3 venue calendar / directory listing" };
  } catch (err) {
    return { tier: "invalid", valid: false, reason: `Malformed URL: ${err.message}` };
  }
}

/**
 * Tokenizes a string into clean lowercase tokens excluding stopwords
 */
export function tokenizeText(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP_WORDS.has(t));
}

/**
 * Validates whether a candidate link matches the target event across:
 * 1. Ticketing platform whitelist & non-generic deep link path
 * 2. Geo-boundary sanity (no non-Vancouver cities in URL slug)
 * 3. Title token overlap with slug / URL path (Weighted Salience: 3x distinctive, 1x common calendar words)
 * 4. Temporal / Date alignment
 */
export function validateTriadMatch(candidateUrl, eventDate, eventTitle, eventVenue, contextInfo = null) {
  if (!isWhitelistedTicketingUrl(candidateUrl)) {
    return { valid: false, reason: "Not a whitelisted ticketing platform deep link" };
  }

  if (isTruncatedCheckoutUrl(candidateUrl)) {
    return { valid: false, reason: "Candidate URL is a truncated checkout stub (missing numeric database ID)" };
  }

  if (isGenericDirectoryStub(candidateUrl)) {
    return { valid: false, reason: "Candidate URL is a generic directory stub lacking an event slug" };
  }

  let u;
  try {
    u = new URL(candidateUrl);
  } catch (_) {
    return { valid: false, reason: "Malformed candidate URL" };
  }

  // Include pathname, search, AND hash routing in the path tokens
  const pathAndSearch = `${u.pathname} ${u.search} ${u.hash}`.toLowerCase();
  const slugTokens = pathAndSearch.replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(Boolean);

  // Check 1: Blacklisted Geo Boundary
  for (const blacklisted of BLACKLISTED_GEO_TOKENS) {
    if (slugTokens.includes(blacklisted)) {
      return {
        valid: false,
        reason: `Candidate URL contains blacklisted non-Vancouver market token: "${blacklisted}"`
      };
    }
  }

  // Check 2: Title & Entity Token Overlap (Weighted Salience Quorum)
  const titleTokens = tokenizeText(eventTitle);
  if (titleTokens.length > 0) {
    const highSalienceTokens = titleTokens.filter((t) => !LOW_SALIENCE_WORDS.has(t));
    const matchedTokens = titleTokens.filter((t) => slugTokens.includes(t) || pathAndSearch.includes(t));
    const matchedHighSalience = highSalienceTokens.filter((t) => slugTokens.includes(t) || pathAndSearch.includes(t));

    // Weighted scoring: high-salience distinctive words = 3x, common calendar words = 1x
    let totalWeight = 0;
    let matchedWeight = 0;
    for (const t of titleTokens) {
      const w = LOW_SALIENCE_WORDS.has(t) ? 1 : 3;
      totalWeight += w;
      if (slugTokens.includes(t) || pathAndSearch.includes(t)) {
        matchedWeight += w;
      }
    }
    const weightedRatio = totalWeight > 0 ? matchedWeight / totalWeight : 0;

    // Distinctive Quorum: If distinctive high-salience tokens exist, at least one high-salience token MUST match!
    const hasHighSaliencePass = highSalienceTokens.length === 0 || matchedHighSalience.length >= 1;

    let passesTitle = hasHighSaliencePass && (
      (titleTokens.length <= 2 && matchedTokens.length >= 1) ||
      (weightedRatio >= 0.40) ||
      (matchedTokens.length >= 2 && weightedRatio >= 0.30)
    );

    // Numeric / UUID Box Office Carts (e.g. VSO Tessitura secure.vancouversymphony.ca/7633/7634, Chan Centre tickets.ubc.ca/?article_id=UUID, Van Art Gallery Blackbaud UUID)
    const hostLower = u.hostname.toLowerCase();
    if (
      !passesTitle &&
      (hostLower.includes("secure.vancouversymphony.ca") ||
        hostLower.includes("tickets.ubc.ca") ||
        hostLower.includes("tickets.vanartgallery.bc.ca")) &&
      isWhitelistedTicketingUrl(candidateUrl)
    ) {
      passesTitle = true;
    }

    // In-Context Section Match: If the URL was extracted directly from an HTML container/button for this event
    // NEVER allow generic multi-tenant ticketing portals (Eventbrite, Showpass, TicketWeb, Universe, Dice) to bypass slug title matching via inContext!
    if (!passesTitle && contextInfo?.inContext) {
      const host = u.hostname.toLowerCase();
      const isMultiTenantPortal = /(?:eventbrite\.|showpass\.com|ticketweb\.|universe\.com|dice\.fm|admitone\.com|ticketmaster\.|humanitix\.com|bloomtickets\.ca|riotheatretickets\.ca|vtixonline\.com|zaui\.net|ovationtix\.com|spektrix\.com|tickettailor\.com)/i.test(host);
      if (!isMultiTenantPortal) {
        const venueTokens = tokenizeText(eventVenue);
        const isVenueSubdomain = venueTokens.some((vt) => host.includes(vt));
        const anchorText = (contextInfo.anchorText || "").toLowerCase();
        const sectionText = (contextInfo.sectionText || "").toLowerCase();
        const textMatchesTitle = highSalienceTokens.length > 0
          ? highSalienceTokens.some((t) => anchorText.includes(t) || sectionText.includes(t))
          : titleTokens.some((t) => anchorText.includes(t) || sectionText.includes(t));

        if ((isVenueSubdomain || textMatchesTitle) && isWhitelistedTicketingUrl(candidateUrl)) {
          passesTitle = true;
        }
      }
    }

    if (!passesTitle) {
      return {
        valid: false,
        reason: (highSalienceTokens.length > 0 && matchedHighSalience.length === 0)
          ? `Title token overlap failed: missing distinctive high-salience tokens [${highSalienceTokens.join(", ")}] (only matched low-salience words in URL)`
          : `Title token overlap failed: insufficient tokens from [${titleTokens.join(", ")}] matched URL slug (${Math.round(weightedRatio * 100)}% weighted match)`
      };
    }
  }

  // Check 3: Temporal / Date Match (Anti-Recurrence & Anti-Stale-Edition)
  if (eventDate && /^\d{4}-\d{2}-\d{2}/.test(eventDate)) {
    const [year, month, day] = eventDate.split("-");
    const monthTokens = MONTH_NAMES[month] || [];

    // If the candidate URL explicitly contains a DIFFERENT 4-digit year (e.g. 2024 or 2025 when event is 2026), reject it!
    const yearMatches = pathAndSearch.match(/\b(202[0-9])\b/g);
    if (yearMatches && yearMatches.length > 0) {
      if (!yearMatches.includes(year)) {
        return {
          valid: false,
          reason: `Year mismatch: Event is in ${year}, but candidate URL contains [${yearMatches.join(", ")}]`
        };
      }
    }

    // Check if day or month appears in slug
    const hasMonth = monthTokens.some((m) => pathAndSearch.includes(m)) || pathAndSearch.includes(`-${month}-`);
    const dayPadded = day.padStart(2, "0");
    const hasDay = slugTokens.includes(day) || slugTokens.includes(dayPadded);

    // If candidate has date tokens, verify they do not conflict
    // If slug has an explicit month from another month, reject it
    for (const [mNum, mAliases] of Object.entries(MONTH_NAMES)) {
      if (mNum !== month) {
        for (const alias of mAliases) {
          // If alias appears with a hyphen e.g. "-nov-" or "-december-"
          if (pathAndSearch.includes(`-${alias}-`) || pathAndSearch.includes(`/${alias}/`)) {
            return {
              valid: false,
              reason: `Month mismatch: Event is in month ${month} (${monthTokens[0]}), but candidate URL specifies "${alias}"`
            };
          }
        }
      }
    }
  }

  return {
    valid: true,
    confidence: "high",
    reason: "Passed whitelisted platform check, geo boundary check, title overlap, and date alignment"
  };
}

/**
 * Stages a candidate Tier 1 checkout URL onto an event card without modifying ticket_url
 */
export function stageCandidateTier1Link(eventCard, candidateUrl, source = "in_dom_container_button", confidence = "high") {
  const triad = validateTriadMatch(
    candidateUrl,
    eventCard.date || eventCard.startIso,
    eventCard.title || eventCard.event_name,
    eventCard.venue || eventCard.venue_name
  );

  if (!triad.valid) {
    return {
      staged: false,
      reason: triad.reason
    };
  }

  // Attach metadata as a staged candidate lead — NEVER overwrite ticket_url directly!
  eventCard.candidate_tier1_url = candidateUrl;
  eventCard.candidate_tier1_source = source;
  eventCard.candidate_tier1_confidence = confidence;
  eventCard.candidate_tier1_staged_at = new Date().toISOString();
  eventCard.candidate_tier1_triad_validation = {
    valid: true,
    checked_at: new Date().toISOString(),
    reason: triad.reason
  };

  return {
    staged: true,
    candidateUrl,
    confidence
  };
}

/**
 * Searches an event's related links and discovery metadata for valid candidate Tier 1 links
 */
export function inspectCardForCandidateLink(eventCard) {
  // If event already has a verified Tier 1 link, no candidate staging needed
  if (isWhitelistedTicketingUrl(eventCard.ticket_url)) {
    return { alreadyTier1: true };
  }

  // Check alternative links already attached to the card
  const candidatesToProbe = [
    eventCard.details_url,
    eventCard.websiteUrl,
    eventCard.discovery_url,
    eventCard.source_url
  ].filter((u) => u && typeof u === "string" && u.startsWith("http") && u !== eventCard.ticket_url);

  for (const alt of candidatesToProbe) {
    const res = stageCandidateTier1Link(eventCard, alt, "card_alternate_link", "high");
    if (res.staged) {
      return { staged: true, candidateUrl: alt, source: "card_alternate_link" };
    }
  }

  return { staged: false };
}

/**
 * Post-Harvest Link Upgrader Pass:
 * Evaluates harvested schedules in layer_schedules.json and events.json.
 * Discovers and stages candidate_tier1_url leads without modifying active checkout links.
 */
export async function runPostHarvestLinkUpgrader(options = {}) {
  console.log(`\n================================================================`);
  console.log(`🔗 POST-HARVEST AUTOMATIC LINK TIER UPGRADER`);
  console.log(`🛡️ Model: Staged Candidate Leads (Zero Blind Overwrites)`);
  console.log(`================================================================\n`);

  let schedules = [];
  if (fs.existsSync(SCHEDULES_PATH)) {
    try {
      schedules = JSON.parse(fs.readFileSync(SCHEDULES_PATH, "utf-8"));
    } catch (err) {
      console.warn(`⚠️ Error reading layer_schedules.json: ${err.message}`);
    }
  }

  let events = [];
  if (fs.existsSync(EVENTS_PATH)) {
    try {
      events = JSON.parse(fs.readFileSync(EVENTS_PATH, "utf-8"));
    } catch (err) {
      console.warn(`⚠️ Error reading events.json: ${err.message}`);
    }
  }

  let stagedCount = 0;
  let alreadyTier1Count = 0;
  let evaluatedCount = 0;

  // Process layer_schedules.json
  for (const sched of schedules) {
    evaluatedCount++;
    if (isWhitelistedTicketingUrl(sched.ticket_url) || isWhitelistedTicketingUrl(sched.source_url)) {
      alreadyTier1Count++;
      continue;
    }

    const check = inspectCardForCandidateLink(sched);
    if (check.staged) {
      stagedCount++;
      console.log(`🎯 Staged Candidate T1 Lead: "${sched.title}" -> ${sched.candidate_tier1_url}`);
    }
  }

  // Also cross-reference against events.json
  if (!options.scheduleOnly) {
    for (const ev of events) {
      if (isWhitelistedTicketingUrl(ev.ticket_url)) {
        alreadyTier1Count++;
        continue;
      }
      evaluatedCount++;
      const check = inspectCardForCandidateLink(ev);
      if (check.staged) {
        stagedCount++;
        console.log(`🎯 Staged Candidate T1 Lead: "${ev.title || ev.event_name}" -> ${ev.candidate_tier1_url}`);
      }
    }
  }

  // Persist updates to layer_schedules.json
  // In accordance with Single Publisher architecture, only Compiler AI publishes to data/events.json!
  if (stagedCount > 0) {
    try {
      fs.writeFileSync(SCHEDULES_PATH, JSON.stringify(schedules, null, 2), "utf-8");
      console.log(`💾 Saved ${stagedCount} newly staged candidate leads to layer_schedules.json [Awaiting Compiler publication].`);
    } catch (saveErr) {
      console.error(`❌ Error saving candidate leads: ${saveErr.message}`);
    }
  }

  console.log(`\n================================================================`);
  console.log(`🏁 LINK UPGRADER COMPLETED:`);
  console.log(`   Total Evaluated: ${evaluatedCount}`);
  console.log(`   Already Tier 1:  ${alreadyTier1Count}`);
  console.log(`   Newly Staged:    ${stagedCount}`);
  console.log(`   Zero unverified links promoted to live catalog.`);
  console.log(`================================================================\n`);

  return {
    evaluatedCount,
    alreadyTier1Count,
    stagedCount
  };
}

// CLI Entrypoint
if (process.argv[1] && process.argv[1].endsWith("link_upgrader.js")) {
  runPostHarvestLinkUpgrader()
    .then((stats) => {
      console.log(`🎉 Done! ${stats.stagedCount} candidate leads staged.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(`💥 Upgrader Error: ${err.message}`);
      process.exit(1);
    });
}
