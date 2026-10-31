import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scanCatalogLinkHealth } from "./link_health_scanner.js";
import { huntBatchTier1Links } from "./tier1_hunter.js";
import { parseDurationMs, isEventStale, isScanIncomplete } from "./event_batch_qc.js";
import { logCuratorInfo, getCuratorInfo } from "./curator_display.js";
import { isAntigravityEngine, callAntigravityEnricher, getAntigravityModel, printAntigravityTimeoutSummary } from "./agy_engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const LAYERS_DIR = path.join(DATA_DIR, "layers");
const SEEDS_PATH = path.join(LAYERS_DIR, "seeds.json");
const SCHEDULES_PATH = path.join(LAYERS_DIR, "layer_schedules.json");
const BOX_OFFICE_PATH = path.join(LAYERS_DIR, "layer_box_office.json");
const EDITORIAL_PATH = path.join(LAYERS_DIR, "layer_editorial.json");
const EVENTS_PATH = path.join(DATA_DIR, "events.json");
const VENUES_PATH = path.join(DATA_DIR, "venues.json");
const QUEUE_PATH = path.join(DATA_DIR, "manual_review_queue.json");

// Ensure layer directory exists
if (!fs.existsSync(LAYERS_DIR)) fs.mkdirSync(LAYERS_DIR, { recursive: true });

function loadJson(filePath, fallback = []) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.warn(`⚠️ Warning reading ${path.basename(filePath)}: ${err.message}`);
    return fallback;
  }
}

/**
 * Heuristic & RegEx String Cleaner (Title Cruft Removal)
 */
export function cleanEventTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== "string") return "Cultural Performance";
  let title = rawTitle.trim();

  // Strip button text & promotional headers
  const artifacts = [
    /^(?:BUY TICKETS|GET TICKETS|ON SALE NOW|ON SALE DEC \d+|REGISTER NOW|DON'T MISS|PRESENTS|ANNOUNCING)[\s:•\-_]*/i,
    /[\s:•\-_]*(?:MoreInfo→|More Info|Buy Tickets|Get Tickets|Read More|Tickets on Sale).*$/i,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}\b/gi,
    /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi,
    /\b\d{1,2}(?::\d{2})?\s*(?:AM|PM)\b/gi,
    /^[•\-_|–—\s]+|[•\-_|–—\s]+$/g
  ];

  for (const regex of artifacts) {
    title = title.replace(regex, " ").trim();
  }

  // De-duplicate whitespace
  title = title.replace(/\s{2,}/g, " ").trim();

  // If title is in ALL CAPS shouting (and > 4 chars), convert to clean Title Case
  if (title.length > 4 && title === title.toUpperCase() && /[A-Z]/.test(title)) {
    title = title.toLowerCase().replace(/(?:^|\s|[(\[-])[a-z]/g, (c) => c.toUpperCase());
  }

  return title.length > 2 ? title : rawTitle.trim();
}

/**
 * Approved Category Taxonomy Mapping (Aligns with Van50 Canonical Categories)
 */
export function classifyCategory(title, description, rawCategory, venueData) {
  const combined = `${title || ""} ${description || ""} ${rawCategory || ""} ${venueData?.description || ""} ${venueData?.venue_name || ""}`.toLowerCase();

  // 1. Outdoors & Recreation / Parks / Sports
  if (/\b(?:pitch & putt|pitch and putt|golf|par-3|par 3|seawall|beach|park|garden|botanical|trail|hike|hiking|outdoor|outdoors|canyon|recreation|pitch|putt|viewing deck)\b/i.test(combined)) {
    return "outdoors";
  }
  // 2. Comedy
  if (/\b(?:comedy|standup|stand-up|improv|sketch comedy|laugh|jokes|roast)\b/i.test(combined)) {
    return "comedy";
  }
  // 3. Shows, Theatre, Concerts & Live Performance
  if (/\b(?:theatre|theater|play|drama|musical|stage play|monologue|broadway|fringe|concert|band|orchestra|jazz|choir|symphony|acoustic|live music|dj set|indie rock|punk|folk|tribute band|recital|cabaret|film|cinema|screening|movie|documentary)\b/i.test(combined)) {
    return "shows";
  }
  // 4. Visual Arts & Galleries
  if (/\b(?:art|gallery|exhibition|sculpture|painting|ceramics|visual arts|photography|crafts)\b/i.test(combined)) {
    return "arts";
  }
  // 5. Free Public Access
  if (/\b(?:free public access|public access|open courtyard|public market|daily access)\b/i.test(combined)) {
    return "free-public-access";
  }
  // 6. Culture & Heritage
  if (/\b(?:lecture|talk|workshop|walking tour|community|cultural|poetry|storytelling|author|heritage|museum)\b/i.test(combined)) {
    return "culture";
  }

  if (venueData?.description && ["outdoors", "shows", "arts", "culture", "comedy", "free-public-access"].includes(venueData.description)) {
    return venueData.description;
  }

  return null;
}

/**
 * Cultural Archetype Classifier (Aligns with Van50 Archetype Taxonomy)
 * Maps each event into one of 9 canonical archetypes:
 * cinema, live_stage, workshop, social_gaming, civic_park, museum_gallery, active_rec, roving_series, festival
 */
export function classifyArchetype(title, category, venue, rawArchetype, extra = {}) {
  if (rawArchetype && ["cinema", "live_stage", "workshop", "social_gaming", "civic_park", "museum_gallery", "active_rec", "roving_series", "festival"].includes(rawArchetype)) {
    return rawArchetype;
  }

  const combined = `${title || ""} ${category || ""} ${venue || ""} ${extra.description || ""}`.toLowerCase();

  // 1. Participatory Workshops & Classes (Archetype C: 730–739)
  if (/\b(?:workshop|masterclass|class\b|panel|pottery|glazing|firing studio|hands-on|learn to|linocut|painting class|art clinic|makerspace)\b/i.test(title || "") ||
    (/\b(?:workshop|masterclass|linocut|pottery)\b/i.test(combined))) {
    return "workshop";
  }

  // 2. Multi-Venue Festivals & Cultural Celebrations (Archetype I: 790–799)
  if (/\b(?:festival|fest\b|diwali|fringe|doxa|apple festival|jazz fest|vanjazz|pride festival|film festival|viff|celebration|biennale)\b/i.test(`${title || ""} ${extra.festival_affiliation || ""}`)) {
    return "festival";
  }

  // 3. Roving Collectives & Secret Pop-ups (Archetype H: 780–789)
  if (/\b(?:pop-up|popup|secret location|roving|open mic|cypher|secret comedy|acoustic circle|street poetry)\b/i.test(combined)) {
    return "roving_series";
  }

  // 4. Participatory Socials & Gaming (Archetype D: 740–749)
  if (
    /\b(?:board game|boardgame|tabletop|trivia|quiz|chess|pinball|arcade|pizzeria ludica|game night|card game|puzzle)\b/i.test(`${title || ""} ${venue || ""}`) ||
    (category !== "comedy" && !/little mountain gallery/i.test(venue || "") && /\b(?:board game|boardgame|tabletop|chess|pinball|arcade|pizzeria ludica|game night)\b/i.test(combined))
  ) {
    return "social_gaming";
  }

  // 5. Active Recreation & Sports Facilities (Archetype G: 770–779)
  if (/\b(?:pitch & putt|pitch and putt|par-3|golf|tennis court|skate park|climbing gym|recreation court|athletic court)\b/i.test(combined)) {
    return "active_rec";
  }

  // 6. Cinema & Screenings (Archetype A: 710–719)
  if (/\b(?:film|screening|movie|documentary|35mm|70mm|4k dcp|premiere|cinematheque|rio theatre|viff centre|theatrical screening|short films)\b/i.test(combined)) {
    return "cinema";
  }

  // 7. Civic Grounds, Parks & Public Waterfront (Archetype E: 750–759)
  if (/\b(?:seawall|park|garden|botanical|conservatory|promenade|public market|bloedel|vandusen|queen elizabeth|sun yat-sen public|waterfront)\b/i.test(combined)) {
    if (!/\b(?:concert|comedy|show|theatre|play|festival)\b/i.test(title || "")) {
      return "civic_park";
    }
  }

  // 8. Museums, Galleries & Heritage Exhibits (Archetype F: 760–769)
  if (/\b(?:gallery|museum|exhibition|exhibit|contemporary art|visual arts|sculpture|roedde house|polygon|cag|pendulum)\b/i.test(combined)) {
    if (!/little mountain gallery/i.test(venue || "") && !/\b(?:comedy|stand-up|improv|showcase|theatre|concert)\b/i.test(title || "")) {
      return "museum_gallery";
    }
  }

  // 9. Live Stage, Comedy & Concerts (Archetype B: 720–729)
  if (/\b(?:theatre|theater|play|drama|musical|stage|comedy|standup|stand-up|improv|concert|music|band|orchestra|jazz|recital|cabaret|burlesque|show|performance)\b/i.test(combined)) {
    return "live_stage";
  }

  // When evidence is missing or AI/scraper fails, return null instead of a synthetic default
  return null;
}

/**
 * Generates rich, archetype-conditioned Cluster 7XX profile dimensions and on-site amenities
 */
export function generateArchetypeProfile(archetype, title, venue, category, venueData = {}, extra = {}) {
  const t = (title || "").toLowerCase();
  const v = (venue || "").toLowerCase();

  const profile = {
    event_archetype: archetype,
    // Universal 5XX Accessibility standard values - strictly grounded from venueData or extra
    step_free_entrance: venueData?.step_free_entrance || extra.step_free_entrance || null,
    elevator_lift: venueData?.elevator_lift || extra.elevator_lift || null,
    accessible_washrooms: venueData?.accessible_washrooms || extra.accessible_washrooms || null,
    sensory_calibrations: venueData?.sensory_calibrations || extra.sensory_calibrations || null,
    hearing_loop: venueData?.hearing_loop || extra.hearing_loop || null,
    service_animals: venueData?.service_animals || extra.service_animals || null,
    // Universal 6XX Payment & Water standard values - strictly grounded from venueData or extra
    payment_methods: venueData?.payment_methods || extra.payment_methods || null,
    water_refill_station: venueData?.water_refill_station || extra.water_refill_station || null,
    outside_food_policy: venueData?.outside_food_policy || extra.outside_food_policy || null,
    coat_check: venueData?.coat_check || extra.coat_check || null
  };

  switch (archetype) {
    case "cinema":
      profile.film_runtime_minutes = extra.film_runtime_minutes || null;
      profile.film_language_subtitles = extra.film_language_subtitles || null;
      profile.projection_format = extra.projection_format || (t.includes("35mm") ? "35mm Archival Film Print" : (t.includes("4k") ? "4K DCP Digital Cinema" : null));
      profile.print_condition_notes = extra.print_condition_notes || (t.includes("35mm") ? "Archival theatrical print from permanent cultural preservation collection" : null);
      profile.concession_alcohol = venueData?.concession_alcohol || extra.concession_alcohol || null;
      profile.festival_pass_rules = extra.festival_pass_rules || null;
      profile.seat_reservation_type = extra.seat_reservation_type || null;
      break;

    case "live_stage":
      profile.stage_seating_layout = venueData?.stage_seating_layout || extra.stage_seating_layout || null;
      profile.intermission_details = extra.intermission_details || null;
      profile.sound_curfew_time = extra.sound_curfew_time || null;
      profile.earplug_availability = extra.earplug_availability || null;
      profile.stage_sightlines = venueData?.stage_sightlines || extra.stage_sightlines || null;
      break;

    case "workshop":
      profile.materials_provided = extra.materials_provided || null;
      profile.take_home_outcome = extra.take_home_outcome || null;
      profile.workshop_capacity_cap = extra.workshop_capacity_cap || null;
      profile.registration_cutoff = extra.registration_cutoff || null;
      profile.prerequisite_skill_level = extra.prerequisite_skill_level || null;
      profile.instructor_credentials = extra.instructor_credentials || null;
      break;

    case "social_gaming":
      profile.table_cover_fee = extra.table_cover_fee || null;
      profile.minimum_fnb_spend = extra.minimum_fnb_spend || null;
      profile.table_time_limit = extra.table_time_limit || null;
      profile.game_library_size = extra.game_library_size || null;
      profile.rules_teacher_present = extra.rules_teacher_present || null;
      profile.tournament_prizes = extra.tournament_prizes || null;
      break;

    case "civic_park":
      profile.trail_terrain_surface = venueData?.trail_terrain_surface || extra.trail_terrain_surface || null;
      profile.pet_leash_policy = venueData?.pet_leash_policy || extra.pet_leash_policy || null;
      profile.seasonal_washrooms = venueData?.seasonal_washrooms || extra.seasonal_washrooms || null;
      profile.equipment_rentals = extra.equipment_rentals || null;
      profile.picnic_shelter_rules = extra.picnic_shelter_rules || null;
      break;

    case "museum_gallery":
      profile.exhibition_run_dates = extra.exhibition_run_dates || null;
      profile.special_exhibit_surcharge = extra.special_exhibit_surcharge || null;
      profile.docent_tour_schedule = extra.docent_tour_schedule || null;
      profile.bag_check_rules = venueData?.bag_check_rules || extra.bag_check_rules || null;
      break;

    case "active_rec":
      profile.digital_waiver_required = extra.digital_waiver_required || null;
      profile.required_safety_gear = extra.required_safety_gear || null;
      profile.locker_availability = venueData?.locker_availability || extra.locker_availability || null;
      profile.physical_intensity_level = extra.physical_intensity_level || null;
      profile.rainout_policy = venueData?.rainout_policy || extra.rainout_policy || null;
      break;

    case "roving_series":
      profile.location_reveal_protocol = extra.location_reveal_protocol || null;
      profile.byo_seating_policy = extra.byo_seating_policy || null;
      profile.open_mic_signup_protocol = extra.open_mic_signup_protocol || null;
      profile.organizer_channel = extra.organizer_channel || null;
      break;

    case "festival": {
      const mf = extra.matchedFestival || null;
      profile.festival_hub_directory = extra.festival_hub_directory || (mf && (mf.schedule_url || mf.website_url)) || null;
      profile.festival_pass_type = extra.festival_pass_type || (mf ? (mf.pricing_model === "free_access" || mf.price === 0 ? "Free Public Festival Admission (No Pass Required)" : `Single Event Tickets & Festival Passes ($${Number(mf.price || 0).toFixed(2)} CAD)`) : null);
      profile.rush_seating_rules = extra.rush_seating_rules || (mf ? (mf.access_model === "open_public_space" ? "Open public plaza/venue access — arrive early for front-row stage viewing" : "Standby rush line opens 15–30 mins prior to showtime subject to capacity") : null);
      profile.central_box_office = extra.central_box_office || (mf && (mf.location || mf.website_url)) || null;
      profile.volunteer_ticket_exchange = extra.volunteer_ticket_exchange || (mf ? `Official ${mf.festival_name} Volunteer & Community Access Program` : null);
      break;
    }

    default:
      break;
  }

  return profile;
}

/**
 * Lineup & Artist Sanitizer (Strips recursive title/location echoes)
 */
export function extractCleanLineup(title, venue, rawArtist, rawLineup) {
  const cleanT = (title || "").toLowerCase();
  const cleanV = (venue || "").toLowerCase();

  const isNonArtist = (name) => {
    if (!name || typeof name !== "string") return true;
    const n = name.trim().toLowerCase();
    if (n === cleanT || n === cleanV) return true;
    if (/\b(?:18-hole|pitch & putt|pitch and putt|round|general admission|admission|drop-in|drop in|market|seawall|tour|exhibition|gallery|park|beach|library|festival|open mic)\b/i.test(n)) return true;
    return false;
  };

  let artist = rawArtist && !isNonArtist(rawArtist) ? rawArtist.trim() : null;
  let lineup = Array.isArray(rawLineup) ? rawLineup.filter(p => !isNonArtist(p)) : [];

  return { artist, lineup };
}

/**
 * Unescapes standard HTML entities
 */
function unescapeHtml(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Checks whether an existing description is canned, synthetic, or a generic placeholder
 */
export function isCannedOrSyntheticDesc(desc, title) {
  if (!desc || typeof desc !== "string") return true;
  const d = desc.trim();
  if (d.length < 25) return true;
  if (title && (d.match(new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')) || []).length >= 2) return true;
  return (
    d.includes("Presented live at") ||
    d.includes("Cultural Event at") ||
    d.includes("Experience it live at") ||
    d.includes("under $50 CAD") ||
    d.includes("An authentic community cultural experience") ||
    d.includes("beloved grassroots comedy club") ||
    d.includes("sharpest emerging stand-ups") ||
    d.includes("Catch Vancouver's sharpest") ||
    d.includes("intimate room under $50 CAD") ||
    d.includes("drinks available under $50 CAD") ||
    d.includes("licensed concession treats, and an authentic film lover's atmosphere") ||
    d.includes("takes the stage at") ||
    d.includes("delivers an energetic night of live stand-up, clever punchlines, and spontaneous humor to") ||
    d.includes("delivers an engaging live cultural experience hosted at") ||
    /Located at (?:The )?[A-Za-z0-9\s]+(?:\.|$)/i.test(d) ||
    /MODO-LIVE (?:Presents|present)/i.test(d) ||
    /Book tickets for .*? at /i.test(d) ||
    /Tickets checkout page for/i.test(d) ||
    /hosted at The Cultch/i.test(d) ||
    /hosted at (?:The )?[A-Za-z0-9\s]+(?:\.|$)/i.test(d) ||
    /\bin the Raccoon Room at\b/i.test(d) ||
    /\bon the Salazar Stage at\b/i.test(d) ||
    /explore permanent collections|delivers an engaging live cultural performance|an authentic artistic showcase curated for memorable patron enjoyment|an accessible cultural destination welcoming visitors|experience it live at/i.test(d) ||
    /Audiences can expect (?:an engaging, dynamic performance|sharp punchlines, spirited crowd banter|witty punchlines, spirited trivia)/i.test(d) ||
    /Seasoned improvisers spin unexpected audience prompts into high-energy/i.test(d) ||
    /The production explores engaging themes with sharp dialogue, compelling character dynamics/i.test(d) ||
    /The performance features dynamic live instrumentation, rich melodic textures/i.test(d) ||
    /The exhibition highlights distinctive artistic vision, nuanced craftsmanship/i.test(d) ||
    /^(?:tickets?\s+(?:on\s+sale|available|checkout)|find\s+event\s+and\s+ticket\s+information|click\s+here\s+for\s+tickets)/i.test(d)
  );
}

/**
 * Distinguishes whether an item is a specific show/performance vs a venue/attraction outing
 */
export function isSpecificShowOrPerformance(title, category, venue, lifecycleType, extra = {}) {
  const t = (title || "").toLowerCase();
  const v = (venue || "").toLowerCase();
  const cat = (category || "").toLowerCase();
  const life = (lifecycleType || "").toLowerCase();

  // 1. Explicit Attraction / Venue Outings (where the venue IS the outing)
  if (t.includes("pitch & putt") || t.includes("pitch and putt") || t.includes("par-3") || t.includes("par 3")) return false;
  if (t.includes("seawall") || v.includes("seawall")) return false;
  if (t.includes("public market") || t.includes("farmers market")) return false;
  if (t.includes("ticket info") || t.includes("box office info") || t.includes("membership info")) return false;
  if (t.includes("beach") || t.includes("trail") || t.includes("canyon") || t.includes("park") || t.includes("garden") || t.includes("conservatory")) {
    if (!t.includes("comedy") && !t.includes("concert") && !t.includes("show") && !t.includes("screening") && !t.includes("festival") && !t.includes("play")) {
      return false;
    }
  }

  // Pure venue drops-ins (where title mirrors venue name without specific show/time)
  if (life === "perennial_drop_in" || life === "perennial") {
    if (!extra.time && !t.includes("show") && !t.includes("comedy") && !t.includes("concert") && !t.includes("play") && !t.includes("screening") && !t.includes("movie") && !t.includes("exhibition")) {
      return false;
    }
  }
  if (t === v || t.replace(/\s*\([^)]*\)/g, "").trim() === v.replace(/\s*\([^)]*\)/g, "").trim()) {
    return false;
  }

  // 2. Specific Show / Performance Indicators
  if (["comedy", "shows", "theatre", "music", "film", "nightlife"].includes(cat)) return true;
  if (/\b(?:comedy|standup|stand-up|improv|showcase|concert|recital|orchestra|jazz|choir|play|drama|theatre|theater|screening|movie|film|trivia|cabaret|burlesque|stripocalypse|drag|variety|open mic|headline|catnip|exhibition|exhibit)\b/i.test(t)) {
    return true;
  }
  if (extra.artist || (Array.isArray(extra.lineup) && extra.lineup.length > 0)) return true;
  if (extra.time && /\d{1,2}:\d{2}\s*(?:AM|PM)/i.test(extra.time)) return true;

  return false;
}

/**
 * Lightweight, non-blocking fetcher for live page descriptions (meta description, og:description, JSON-LD)
 */
export async function fetchLivePageDescription(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) return null;
  // Ignore bare aggregator index URLs
  if (/eventbrite\.[a-z]+\/d\//i.test(url) || /admitone\.com\/events\/?$/i.test(url) || /showpass\.com\/?$/i.test(url)) return null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const html = await res.text();

    // 1. Meta Description (name or property)
    const metaRegexes = [
      /<meta[^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["'](?:description|og:description|twitter:description)["']/i
    ];
    for (const rx of metaRegexes) {
      const match = html.match(rx);
      if (match && match[1] && match[1].trim().length > 25) {
        const val = unescapeHtml(match[1].trim());
        if (/^(?:find|buy|get|book)\s+tickets\s+for\b/i.test(val) && /\bshowing at\b/i.test(val)) continue;
        return val;
      }
    }

    // 2. JSON-LD schema.org description
    const jsonLdRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let jsonMatch;
    while ((jsonMatch = jsonLdRegex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (item && typeof item.description === "string" && item.description.trim().length > 25) {
            return unescapeHtml(item.description.trim());
          }
        }
      } catch (_) { }
    }
  } catch (_) {
    // Network failure or timeout: silently fail back to deterministic synthesis
  }
  return null;
}

/**
 * Radical Sanitizer: Removes venue logistics, room placements, rental model disclaimers,
 * and accessibility notices to isolate the authentic show/event description.
 */
export function cleanShowDescription(rawText, title, venue, isSpecificShow = false) {
  if (!rawText || typeof rawText !== "string") return "";
  let text = unescapeHtml(rawText);

  // Strip HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  if (isSpecificShow) {
    // 1. Cut off accessibility sections completely (everything after Accessibility heading)
    text = text.replace(/(?:^|\r?\n|\.\s+)(?:Accessibility|ACCESSIBILITY)\b[\s\S]*$/i, ".");

    // 2. Cut off "About the venue", "About [Venue]", "Getting here", "Directions & Parking", "Venue Info"
    text = text.replace(/(?:^|\r?\n|\.\s+)(?:About\s+(?:the\s+)?venue|About\s+(?:the\s+)?theatre|Getting\s+Here|Directions\s+&\s+Parking|Venue\s+Information|About\s+us)\b[\s\S]*$/i, ".");

    // 3. Strip room / stage placements
    text = text.replace(/(?:this show|the performance|this event)?\s*(?:will be|is)\s+presented (?:in|on) the\s+[^.\n]+(?:\.|$)/gi, "");
    text = text.replace(/,?\s*(?:in|on) the (?:raccoon room|salazar stage|studio theatre|main stage|second floor|main floor)[^.\n]*(?:\.|$)/gi, ".");

    // 4. Strip rental / producer / contact disclaimers (strictly within single lines)
    text = text.replace(/(?:this show|this event|this performance)\s+(?:is|was)\s+produced (?:and curated\s+)?under a rental model[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/independent of\s+[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/(?:if you have\s+)?(?:questions? or comments?|for inquiries|questions\?)[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/(?:contact|email)\s+(?:the\s+)?(?:producer|organizer|promoter|host)[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g, "");

    // 5. Strip promoter / presentation headers (e.g. "MODO-LIVE Presents...", "Timbre Concerts presents...", etc.)
    text = text.replace(/^(?:[A-Z0-9\-–—,\s&]+(?:presents?|presenting|presents:?))\s*/i, "");
    text = text.replace(/(?:^|\.\s+)(?:[A-Z0-9\-–—,\s&]+(?:presents?|presenting|presents:?))\s+/gi, ".");

    // 6. Strip leading "Join us at [Venue] for" -> "Join us for"
    text = text.replace(/(?:join\s+us|welcome)\s+(?:at|to)\s+(?:the\s+)?[^,.\n]+\s+for\s+/gi, "Join us for ");

    // 7. Strip trailing "Located at [Venue]." or "Held at [Venue]." or "Hosted at [Venue]."
    text = text.replace(/(?:^|\.\s+)(?:located|held|hosted|taking place)\s+(?:at|in)\s+[^.\n]+(?:\.|$)/gi, ".");

    // 8. Strip venue address and room notices
    const cleanV = venue ? venue.replace(/\s*\([^)]*\)/g, "").trim() : "";
    const venueVariants = [venue, cleanV].filter(Boolean);
    for (const v of venueVariants) {
      const vEsc = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Strip "at [Venue]" or "in [Venue]"
      text = text.replace(new RegExp(`,?\\s*(?:taking place|held|hosted|presented|live)?\\s*(?:at|in)\\s+${vEsc}[^.\\n]*(?:\\.|$)`, 'gi'), ".");
      // Strip "[Venue] is [an intimate venue / located ...]"
      text = text.replace(new RegExp(`(?:^|\\.\\s+)${vEsc}\\s+(?:is|was|has been|features|offers|provides|serves|remains|welcomes)\\s+[^.\\n]*(?:\\.|$)`, 'gi'), ".");
    }
    text = text.replace(/,?\s*(?:at|in)\s+\d{1,5}\s+[A-Za-z0-9\s]+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Way|Drive|Dr)[,.]?/gi, ".");
    text = text.replace(/please note that the venue[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/the front entrance has[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/there['’]s a powered lift[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/the venue has \w+ (?:private )?washrooms[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/we encourage patrons requiring wheelchair[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/wheelchair accessible seating is available[^.\n]*(?:\.|$)/gi, "");

    // 9. Strip bar / concession / drink amenities (since this is a show, not a bar review)
    text = text.replace(/(?:^|\.\s+)(?:a\s+)?(?:full\s+)?(?:licensed\s+)?bar\s+(?:is\s+)?available[^.\n]*(?:\.|$)/gi, ".");
    text = text.replace(/(?:^|\.\s+)(?:drinks?|concessions?|snacks?|beverages?|cocktails?|beer and wine)\s+(?:are\s+)?available[^.\n]*(?:\.|$)/gi, ".");
    text = text.replace(/(?:^|\.\s+)(?:our\s+)?bar\s+(?:opens?|service)[^.\n]*(?:\.|$)/gi, ".");
    text = text.replace(/(?:^|\.\s+)enjoy\s+(?:drinks?|craft beer|beverages?)[^.\n]*(?:\.|$)/gi, ".");

    // 10. Strip transactional / time / sales boilerplate
    text = text.replace(/doors open at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/show starts at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/please arrive\s+\d+[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/tickets? (?:are|on sale|available|starting at)[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/all sales are final[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/no refunds[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/subscribe to[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/follow us on[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/visit (?:our website|www\.)[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/click here to[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/check out our website[^.\n]*(?:\.|$)/gi, "");
    text = text.replace(/(?:for more info(?:rmation)?|more info).*?(?:\.|$)/gi, "");
    text = text.replace(/upcoming (?:concerts|shows|events).*?(?:\.|$)/gi, "");
  } else {
    // General attraction cleaning
    text = text.replace(/Tickets? (?:are|on sale|available|starting at).*?(?:\.|$)/gi, "");
    text = text.replace(/Visit (?:our website|www\.).*?(?:\.|$)/gi, "");
    text = text.replace(/Doors open at.*?(?:\.|$)/gi, "");
    text = text.replace(/Show starts at.*?(?:\.|$)/gi, "");
    text = text.replace(/Please note.*?(?:\.|$)/gi, "");
    text = text.replace(/Click here to.*?(?:\.|$)/gi, "");
    text = text.replace(/Follow us on.*?(?:\.|$)/gi, "");
    text = text.replace(/Presented by.*?(?:\.|$)/gi, "");
    text = text.replace(/All sales are final.*?(?:\.|$)/gi, "");
    text = text.replace(/Subscribe to.*?(?:\.|$)/gi, "");
    text = text.replace(/No refunds.*?(?:\.|$)/gi, "");
  }

  // Normalize whitespace
  text = text.replace(/\s{2,}/g, " ").trim();
  return text;
}

/**
 * Detects whether a sentence is primarily about the venue, room, amenities, or logistics
 * rather than the show/event content.
 */
export function isVenueOrAmenitySentence(sentence, venue) {
  if (!sentence || typeof sentence !== "string") return false;
  const s = sentence.toLowerCase().trim();
  const cleanV = (venue || "").toLowerCase().replace(/\s*\([^)]*\)/g, "").trim();

  // Bar, drinks, and food amenities
  if (/\b(?:concession|bar service|drink menu|craft beer|cocktails?|liquor|food and drink|refreshments?|beverages?|licensed bar|bar is open)\b/i.test(s)) return true;

  // Venue facilities, architectural history, room capacity
  if (/\b(?:intimate room|intimate theatre|stage lighting|air conditioning|seating capacity|century-old|historic building|heritage building|historic venue|intimate 80-seat|facility|washrooms?|powered lift|front entrance|wheelchair accessible)\b/i.test(s)) return true;

  // Venue location, transit, and parking
  if (/\b(?:parking is available|street parking|transit accessible|skytrain station|located in the heart of|situated in|conveniently located|located at|held at|hosted at)\b/i.test(s)) return true;

  // Venue self-promotional sentences ("The Cultch is...", "Little Mountain Gallery offers...", "About the venue...")
  if (cleanV && cleanV.length > 3) {
    const vEsc = cleanV.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`^(?:the\\s+)?${vEsc}\\s+(?:is|was|has been|features|offers|provides|serves|remains|welcomes|proudly)\\b`, 'i').test(s)) return true;
    if (new RegExp(`\\b(?:about|welcome to|visit)\\s+(?:the\\s+)?${vEsc}\\b`, 'i').test(s)) return true;
    if (new RegExp(`\\b(?:at|in)\\s+(?:the\\s+)?${vEsc}[,.]?$`, 'i').test(s)) return true;
  }

  // Generic venue promotional plugs & ticketing search snippets
  if (/\b(?:experience it live at|takes the stage at|presented live at|cultural event at|book tickets for .*? at)\b/i.test(s)) return true;
  if (/^(?:find|buy|get|book)\s+tickets\s+for\b/i.test(s) && /\bshowing at\b/i.test(s)) return true;
  if (/^tickets?\s+(?:checkout\s+page\s+for|on\s+sale\s+for|available\s+for)\b/i.test(s)) return true;

  // Date/day/city concatenation without narrative content (e.g. "Friday, December 11th 2026 Fox Cabaret Vancouver, BC.")
  if (/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?:st|nd|rd|th)?|\d{4})\b/i.test(s) && (/\b(?:vancouver|bc|gastown|commercial drive|granville island)\b/i.test(s) || (cleanV && s.includes(cleanV)))) {
    const hasNarrativeVerb = /\b(?:is|are|was|were|explores|delivers|presents|tells|follows|stars|celebrates|highlights|weaves|showcases|features|performs|blends|brings|shares|creates|builds)\b/i.test(s);
    if (!hasNarrativeVerb) return true;
  }

  return false;
}

/**
 * Patron-Centered 2-Sentence Synopsis Generator
 * For specific shows, synthesizes copy focused purely on the show/performance itself, not the venue.
 */
export function generatePatronSynopsis(title, venue, rawDesc, category, venueData, extraContext = {}) {
  const isShow = extraContext.isSpecificShow !== undefined
    ? extraContext.isSpecificShow
    : isSpecificShowOrPerformance(title, category, venue, extraContext.lifecycle_type, extraContext);

  const tLower = (title || "").toLowerCase();
  const vLower = (venue || "").toLowerCase();
  const artistName = extraContext.artist || (Array.isArray(extraContext.lineup) && extraContext.lineup.length > 0 ? extraContext.lineup[0] : null);
  const cleanTitle = title || "Cultural Performance";
  const cleanVenue = venue || "Metro Vancouver";

  const isTrivialTitleVenueEcho = (text) => {
    if (!text) return true;
    const normalize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const tNorm = normalize(title);
    const vNorm = normalize(venue);
    let sNorm = normalize(text);

    if (tNorm) sNorm = sNorm.replace(new RegExp(tNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
    if (vNorm) sNorm = sNorm.replace(new RegExp(vNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), ' ');
    sNorm = sNorm.replace(/\b(?:at|in|presented by|comedy|performance|show|event|live|the|a|an|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, ' ').replace(/\s+/g, ' ').trim();
    return sNorm.length < 15;
  };

  // When no raw description text exists from the live page, do not fabricate synthetic blurbs
  if (!rawDesc || rawDesc.trim().length === 0) {
    return null;
  }

  // 1. If descriptive raw text is present and meaningful, sanitize and distill it
  const isCanned = isCannedOrSyntheticDesc(rawDesc, title);
  if (rawDesc && rawDesc.length > 35 && !isCanned) {
    const cleaned = cleanShowDescription(rawDesc, title, venue, isShow);
    // Protect abbreviations and honorifics (St., Dr., Mr., etc.) from false sentence splits
    const protectedText = cleaned.replace(/\b(St|Dr|Mr|Mrs|Ms|vs|e\.g|i\.e)\.\s+/g, "$1___DOT___ ");
    const sentences = protectedText
      .split(/(?<=[.!?])\s+/)
      .map(s => {
        let clean = s.replace(/___DOT___/g, ".").trim().replace(/^[,;:\-\s]+/, "").replace(/[,;:\-\s]+$/, "");
        // Clean trailing dangling prepositions resulting from venue stripping (e.g. "... at St." or "... at.")
        clean = clean.replace(/,?\s*(?:at|in|on|with|w\/|by|for|to|of)\s+[^.\n]{0,8}[.!?]?$/i, ".");
        if (clean.length > 0) {
          clean = clean.charAt(0).toUpperCase() + clean.slice(1);
          if (!/[.!?]$/.test(clean)) clean += ".";
        }
        return clean;
      })
      .filter(s => {
        if (s.length < 25) return false;
        if (/subscribe|newsletter|ticketing fee|refund policy|buy tickets|accessibility|washrooms?|powered lift|more info|upcoming concerts|find event and ticket information/i.test(s)) return false;
        if (isTrivialTitleVenueEcho(s)) return false;
        if (isShow && isVenueOrAmenitySentence(s, venue)) return false;
        return true;
      });

    // If the leading sentence is just a calendar/time banner (e.g. "Live stand-up comedy every Thursday at 9pm in Gastown."),
    // and subsequent sentences provide deeper show/artist content, prioritize the show content sentences!
    let pool = sentences;
    if (sentences.length > 2 && /^(?:live\s+\w+\s+comedy\s+every|every\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i.test(sentences[0])) {
      pool = sentences.slice(1);
    }

    if (pool.length >= 2) {
      return `${pool[0]} ${pool[1]}`.trim();
    } else if (pool.length === 1 && pool[0].length >= 25) {
      // Honest Absence Protocol: Return the verified factual sentence as-is rather than stitching canned regex filler prose
      return pool[0].trim();
    }
  }

  // Under the Honest Absence Protocol, if no factual show description exists, return null
  return null;
}

/**
 * Call Gemini Flash API for Cognitive Enrichment
 * Safely guards against invalid/non-AI Studio tokens to avoid 404 spam.
 */
async function callGeminiEnricher(eventCard, apiKey) {
  // Only execute if apiKey is a real Google AI Studio key (starts with "AIzaSy")
  if (!apiKey || !apiKey.startsWith("AIzaSy")) return null;

  const curatorPrompt = eventCard.curator_instruction
    ? `\n- MANDATORY CURATOR GUIDANCE TO CONSIDER: "${eventCard.curator_instruction}" (You MUST take this into account for title, artist, category, or description!)\n`
    : "";

  const prompt = `You are the Van50 Cultural AI Enricher for Metro Vancouver cultural events under $50 CAD.
Clean and enrich this event record according to our high-fidelity publishing standards.

Input Event:
- Title: "${eventCard.title || eventCard.event_name || ""}"
- Venue: "${eventCard.venue || eventCard.venue_name || ""}"
- Raw Description: "${eventCard.description || ""}"
- Raw Category: "${eventCard.category || ""}"
- Existing Restrictions: "${eventCard.restrictions || ""}"${curatorPrompt}

Requirements:
1. "clean_title": Strip out all promotional artifacts, dates, times, buttons ("Tickets On Sale", "Apr 4", "MoreInfo->"), and capitalization shouting.
2. "artist": Extract the lead artist, band, performer, or speaker name (or null if general).
3. "lineup": Array of performer names if present (or []).
4. "category": Strictly one of ["shows", "comedy", "arts", "outdoors", "culture", "free-public-access"].
5. "event_archetype": Strictly one of ["cinema", "live_stage", "workshop", "social_gaming", "civic_park", "museum_gallery", "active_rec", "roving_series", "festival"] based on true semantic comprehension of the event.
6. "lifecycle_type": Strictly one of ["time_bound_event", "weekly_recurring_residency", "perennial_drop_in"].
7. "weekly_recurring_day": If lifecycle_type is "weekly_recurring_residency", the day name ("Monday".."Sunday"), else null.
8. "description": Exactly 2 evocative sentences written for patrons based strictly on real facts. CRITICAL MANDATE: When the event is a specific show/event (comedy, concert, play, screening, performance, etc.), the description MUST be about the show itself (comedic style, jokes, music genre, plot, themes, performance) and NOT about the venue, room, bar, or venue history. Only describe the venue/grounds when the event is an outdoor park, beach, garden, or perennial drop-in venue visit.
9. "restrictions": "All Ages", "19+ w/ ID", "16+", or "All Ages / Family Friendly".
10. "holiday_affiliation": Generously infer if the event fits the theme, genre, vibe, or celebration of an upcoming holiday within its seasonal window. Strictly one of ["halloween", "dia-de-los-muertos", "diwali", "thanksgiving", "christmas", "new-years", "lunar-new-year", "valentines-day", "st-patricks-day", "easter", "canada-day", "pride"] or null.

Respond ONLY with a valid JSON object matching these keys.`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey.trim()}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      })
    });

    if (!res.ok) {
      console.warn(`[GEMINI API] HTTP ${res.status}: ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      return JSON.parse(text);
    }
  } catch (err) {
    console.warn(`[GEMINI API ERROR] ${err.message}`);
  }
  return null;
}

/**
 * Main Standalone Enricher Runner
 */
export async function runEnricher(options = {}) {
  const limit = options.limit !== undefined ? options.limit : 20;
  const offset = options.offset !== undefined ? parseInt(options.offset, 10) : 0;
  const targetId = options.id || (Array.isArray(options.ids) ? options.ids.join(",") : options.ids) || null;
  const rawApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const apiKey = rawApiKey.startsWith("AIzaSy") ? rawApiKey : "";
  const useAgy = options.engine === "antigravity" || isAntigravityEngine();

  console.log(`\n================================================================`);
  console.log(`✍️ AI SEMANTIC ENRICHER PIPELINE`);
  console.log(`📊 Mode: ${targetId ? `Single ID (${targetId})` : options.all ? "All Catalog Events" : offset > 0 ? `Range (#${offset + 1}–#${offset + limit})` : limit === 0 ? "All Catalog Events" : `Batch (Limit: ${limit})`}`);
  console.log(`🤖 Cognitive Engine: ${useAgy ? `Antigravity 1-Event Worker Loop (${getAntigravityModel()})` : (apiKey ? "Google Gemini Flash API Active" : "Deterministic Cognitive NLP Engine (Zero External API Dependency)")}`);
  console.log(`================================================================\n`);

  const events = loadJson(EVENTS_PATH, []);
  const queueData = loadJson(QUEUE_PATH, { metadata: {}, quarantinedEvents: [] });
  const quarantined = Array.isArray(queueData.quarantinedEvents) ? queueData.quarantinedEvents : [];
  const seeds = loadJson(SEEDS_PATH, []);
  const schedules = loadJson(SCHEDULES_PATH, []);
  const boxOffices = loadJson(BOX_OFFICE_PATH, []);
  const venues = loadJson(VENUES_PATH, []);

  // Build hydration maps for rich, multi-layer factual extraction
  const eventsMap = new Map();
  events.forEach((e) => eventsMap.set(e.id || e.event_id, e));
  quarantined.forEach((q) => eventsMap.set(q.id || q.event_id, q));

  const schedulesMap = new Map();
  schedules.forEach((s) => schedulesMap.set(s.id || s.event_id, s));

  const boxOfficesMap = new Map();
  boxOffices.forEach((b) => boxOfficesMap.set(b.id || b.event_id, b));

  const seedsMap = new Map();
  seeds.forEach((s) => seedsMap.set(s.id || s.event_id, s));

  const venuesMap = new Map();
  venues.forEach((v) => {
    if (v.id) venuesMap.set(v.id.toLowerCase().trim(), v);
    if (v.venue_id) venuesMap.set(v.venue_id.toLowerCase().trim(), v);
    if (v.venue_name) venuesMap.set(v.venue_name.toLowerCase().trim(), v);
    if (v.name) venuesMap.set(v.name.toLowerCase().trim(), v);
  });

  // Determine source pool:
  // Combined pool: active events + quarantined events + uncompiled non-archived seeds
  const archivedDoc = loadJson(path.join(DATA_DIR, "archived_events.json"), { archivedEvents: [] });
  const archivedList = Array.isArray(archivedDoc) ? archivedDoc : (archivedDoc.archivedEvents || []);
  const learnedRules = loadJson(path.join(DATA_DIR, "curator_learned_rules.json"), {});
  const archivedIds = new Set([
    ...archivedList.map((a) => a.id || a.event_id),
    ...(Array.isArray(learnedRules.archived_event_ids) ? learnedRules.archived_event_ids : []),
  ].filter(Boolean));

  const sourcePool = [...events];
  const existingIds = new Set(events.map((e) => e.id || e.event_id));

  // Include quarantined events so their editorial content is fine-tuned
  quarantined.forEach((q) => {
    const qId = q.id || q.event_id;
    if (qId && !existingIds.has(qId) && !archivedIds.has(qId)) {
      q._isFromQuarantine = true;
      sourcePool.push(q);
      existingIds.add(qId);
    }
  });

  seeds.forEach((s) => {
    const sId = s.id || s.event_id;
    if (sId && !existingIds.has(sId) && !archivedIds.has(sId)) {
      sourcePool.push(s);
      existingIds.add(sId);
    }
  });

  schedules.forEach((sc) => {
    const scId = sc.id || sc.event_id;
    if (scId && !existingIds.has(scId) && !archivedIds.has(scId)) {
      sourcePool.push(sc);
      existingIds.add(scId);
    }
  });

  let editorialLayer = loadJson(EDITORIAL_PATH, []);
  const existingMap = new Map();
  editorialLayer.forEach((e) => existingMap.set(e.id || e.event_id, e));

  // Identify corrupted, placeholder or un-enriched entries
  const isCorruptedOrStale = (entry) => {
    if (!entry) return true;
    if (!entry.clean_title || entry.clean_title === "Cultural Event" || entry.clean_title === "Cultural Performance") return true;
    if (/^(?:general admission|admission|tickets|ticket checkout|tickets on sale|buy tickets)$/i.test((entry.clean_title || "").trim())) return true;
    if (!entry.source_engine || entry.source_engine === "heuristic_rules" || entry.source_engine === "unverified") return true;
    if (typeof entry.description === "string" && (
      isCannedOrSyntheticDesc(entry.description, entry.clean_title) ||
      entry.description.includes("Cultural Event at Metro Vancouver") ||
      entry.description.includes("A cultural exhibition and artistic showcase featuring") ||
      entry.description.includes("Designed for accessible cultural enjoyment under $50 CAD")
    )) return true;
    if (!entry.category || !entry.description) return true;
    return false;
  };

  // Determine targets
  let targets = [];
  if (targetId) {
    const cleanIds = String(targetId).split(",").map(x => x.trim()).filter(Boolean);
    const poolMap = new Map();
    sourcePool.forEach((s) => {
      const sid = s.id || s.event_id;
      if (sid && !poolMap.has(sid)) poolMap.set(sid, s);
    });
    targets = cleanIds.map((id) => poolMap.get(id)).filter(Boolean);
    if (targets.length === 0) {
      console.warn(`⚠️ Target event with ID "${targetId}" not found in catalog.`);
    }
  } else if (options.quarantine || options.quarantined || options.quarantinedOnly) {
    // Target quarantined events from manual review queue
    targets = quarantined.map((q) => {
      q._isFromQuarantine = true;
      return q;
    });
    if (offset > 0 || limit > 0) {
      targets = targets.slice(offset, limit > 0 ? offset + limit : undefined);
    }
  } else if (options.all || options.force) {
    // Force scan through all events (even those already run through)
    targets = [...sourcePool];
    if (offset > 0 || limit > 0) {
      targets = targets.slice(offset, limit > 0 ? offset + limit : undefined);
    }
  } else if (options.incompleteOnly) {
    // Target all events that haven't undergone all scans or are missing editorial enrichment
    targets = sourcePool.filter((s) => {
      const id = s.id || s.event_id;
      const existing = existingMap.get(id);
      return !existing || isCorruptedOrStale(existing) || isScanIncomplete(s);
    });
    if (offset > 0 || limit > 0) {
      targets = targets.slice(offset, limit > 0 ? offset + limit : undefined);
    }
  } else if (options.stale || options.olderThan) {
    // Target events that haven't been scanned in 24 hours, 1 week, etc.
    const durationMs = parseDurationMs(options.stale || options.olderThan);
    if (durationMs !== null) {
      targets = sourcePool.filter((s) => {
        const id = s.id || s.event_id;
        const existing = existingMap.get(id);
        const checkTarget = existing || s;
        return isEventStale(checkTarget, durationMs);
      });
    }
    if (offset > 0 || limit > 0) {
      targets = targets.slice(offset, limit > 0 ? offset + limit : undefined);
    }
  } else if (options.unverifiedOnly && !options.force) {
    const isUnenriched = (s) => {
      const id = s.id || s.event_id;
      const existing = existingMap.get(id);
      return !existing || isCorruptedOrStale(existing);
    };

    const unenrichedActive = events.filter(isUnenriched);
    const unenrichedQuarantine = quarantined.filter((q) => {
      q._isFromQuarantine = true;
      return isUnenriched(q);
    });
    const unenrichedSeeds = seeds
      .filter((s) => {
        const sId = s.id || s.event_id;
        return !existingIds.has(sId) && !archivedIds.has(sId);
      })
      .filter(isUnenriched);

    const interleaved = [];
    const maxLen = Math.max(unenrichedActive.length, unenrichedQuarantine.length, unenrichedSeeds.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < unenrichedActive.length) interleaved.push(unenrichedActive[i]);
      if (i < unenrichedQuarantine.length) interleaved.push(unenrichedQuarantine[i]);
      if (i < unenrichedSeeds.length) interleaved.push(unenrichedSeeds[i]);
    }
    targets = interleaved;
    if (offset > 0 || limit > 0) {
      targets = targets.slice(offset, limit > 0 ? offset + limit : undefined);
    }
  } else if (offset > 0 || limit > 0) {
    targets = sourcePool.slice(offset, limit > 0 ? offset + limit : undefined);
  } else {
    targets = [...sourcePool];
  }

  if (targets.length === 0) {
    console.log(`✅ All ${sourcePool.length} events have clean, verified editorial enrichment in layer_editorial.json!`);
    return { success: true, count: 0 };
  }

  // Pre-Enrichment Link Health & Tier 1 Hunter Pass
  if (!options.skipHunt) {
    try {
      console.log(`\n⚡ [AI Enricher Pre-Flight] Checking link health across ${targets.length} targets...`);
      await scanCatalogLinkHealth(targets, { concurrency: 6 });
      const needsHunt = targets.filter((t) => t.needs_tier1_hunt);
      if (needsHunt.length > 0) {
        console.log(`🏹 [AI Enricher Pre-Flight] Running Tier 1 Hunter for ${needsHunt.length} degraded or lower-tier targets...`);
        await huntBatchTier1Links(needsHunt);
      }
    } catch (linkErr) {
      console.warn(`⚠️ Warning in pre-enrichment link check: ${linkErr.message}`);
    }
  }

  console.log(`📋 Enriching ${targets.length} events...\n`);
  const nowIso = new Date().toISOString();
  let enrichedCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const item = targets[i];
    const eventId = item.id || item.event_id;
    const ev = eventsMap.get(eventId) || {};
    const sched = schedulesMap.get(eventId) || {};
    const box = boxOfficesMap.get(eventId) || {};
    const seed = seedsMap.get(eventId) || {};

    // Robust property resolution from all layers (prefer rich catalog data, fallback to descriptive seed)
    const GENERIC_TITLE_PATTERN = /^(?:general admission|admission|tickets|ticket checkout|tickets checkout|buy tickets|checkout|tickets on sale|showpass checkout|eventbrite checkout)$/i;
    let title = item.title || item.event_name || ev.title || ev.event_name || "";
    if (!title || GENERIC_TITLE_PATTERN.test(title.trim())) {
      title = seed.seed_title || item.seed_title || sched.title || box.title || title || "Cultural Event";
    }
    const venue = item.venue || item.venue_name || ev.venue || ev.venue_name || sched.venue || box.venue_name || seed.seed_venue || item.seed_venue || null;
    const venueObj = venue ? (venuesMap.get((venue || "").toLowerCase().trim()) || null) : null;
    let rawDesc = item.description || ev.description || sched.description || box.description || "";
    if (isCannedOrSyntheticDesc(rawDesc, title)) {
      rawDesc = "";
    }
    let rawCategory = item.category || (Array.isArray(item.categories) ? item.categories[0] : null) || ev.category || sched.category || box.category || "";
    if (rawCategory && (rawCategory === "culture" || rawCategory === "shows") && !rawDesc && !venueObj) {
      rawCategory = "";
    }
    const rawArtist = item.artist || ev.artist || sched.artist || box.artist || null;
    const rawLineup = (Array.isArray(item.lineup) && item.lineup.length > 0) ? item.lineup :
      (Array.isArray(ev.lineup) && ev.lineup.length > 0) ? ev.lineup :
        (Array.isArray(sched.lineup) && sched.lineup.length > 0) ? sched.lineup :
          (Array.isArray(box.lineup) && box.lineup.length > 0) ? box.lineup : [];
    const rawRestrictions = item.restrictions || ev.restrictions || sched.restrictions || box.restrictions || null;

    // Attempt live page inspection if description is missing or canned
    const candidateUrl = item.ticket_url || item.details_url || item.source_url ||
      ev.ticket_url || ev.details_url || ev.websiteUrl ||
      sched.ticket_url || sched.details_url || sched.source_url ||
      box.ticket_url || seed.seed_url || "";

    if (candidateUrl && (!rawDesc || isCannedOrSyntheticDesc(rawDesc, title))) {
      try {
        const liveDesc = await fetchLivePageDescription(candidateUrl);
        if (liveDesc) {
          rawDesc = liveDesc;
          console.log(`   🌐 Fetched live page description (${liveDesc.slice(0, 60)}...)`);
        }
      } catch (_) { }
    }

    console.log(`✍️ Processing [${i + 1}/${targets.length}]: ${title} (${venue}) [${eventId}]`);
    const curatorInfo = getCuratorInfo({ eventId, title, venue, existingCard: item });
    const activeCuratorNote = curatorInfo.effectiveNote || curatorInfo.eventInstructionText || curatorInfo.existingCuratorNotes;
    logCuratorInfo({ eventId, title, venue, existingCard: item, prefix: "   " });
    if (activeCuratorNote) {
      console.log(`   🧑‍⚖️ [Enricher AI] Taking Curator Note into account: "${activeCuratorNote}"`);
    }

    let aiResult = null;
    const inputLifecycle = item.lifecycle_type || ev.lifecycle_type || seed.lifecycle_type || null;
    if (useAgy) {
      aiResult = await callAntigravityEnricher({
        id: eventId,
        title,
        venue,
        description: rawDesc,
        category: rawCategory,
        lifecycle_type: inputLifecycle,
        restrictions: rawRestrictions,
        curator_instruction: activeCuratorNote
      });
      if (!aiResult) {
        console.warn(`   ⚠️ [Enricher] Antigravity AI worker timed out or failed for "${title}" [${eventId}] — using deterministic NLP fallback.`);
      }
    } else if (apiKey) {
      aiResult = await callGeminiEnricher({
        title,
        venue,
        description: rawDesc,
        category: rawCategory,
        lifecycle_type: inputLifecycle,
        restrictions: rawRestrictions,
        curator_instruction: activeCuratorNote
      }, apiKey);
    } else {
      // Natural cognitive pacing for deterministic NLP and live telemetry stream
      await new Promise((resolve) => setTimeout(resolve, 800));
    }

    const cleanTitle = aiResult?.clean_title || cleanEventTitle(title);
    const category = aiResult?.category || classifyCategory(cleanTitle, rawDesc, rawCategory, venueObj);
    const cleanedLineup = extractCleanLineup(cleanTitle, venue, rawArtist, rawLineup);
    const artist = aiResult?.artist !== undefined ? aiResult.artist : cleanedLineup.artist;
    const lineup = Array.isArray(aiResult?.lineup) && aiResult.lineup.length > 0 ? aiResult.lineup : cleanedLineup.lineup;
    const restrictions = (venueObj?.restrictions && /19\+/i.test(venueObj.restrictions))
      ? venueObj.restrictions
      : (aiResult?.restrictions || (rawRestrictions && !/unspecified|check venue/i.test(rawRestrictions) ? rawRestrictions : null));
    const resolvedLifecycleType = (
      aiResult?.lifecycle_type &&
      ["time_bound_event", "weekly_recurring_residency", "perennial_drop_in"].includes(aiResult.lifecycle_type)
    )
      ? aiResult.lifecycle_type
      : inputLifecycle;
    const weeklyRecurringDay = aiResult?.weekly_recurring_day || null;
    const isShow = isSpecificShowOrPerformance(cleanTitle, category, venue, resolvedLifecycleType, {
      artist,
      lineup,
      time: item.time || ev.time || sched.start_time
    });
    const description = aiResult?.description || generatePatronSynopsis(cleanTitle, venue, rawDesc, category, venueObj, {
      artist,
      lineup,
      restrictions,
      isSpecificShow: isShow,
      lifecycle_type: resolvedLifecycleType
    });

    const VALID_ARCHETYPES = ["cinema", "live_stage", "workshop", "social_gaming", "civic_park", "museum_gallery", "active_rec", "roving_series", "festival"];
    const aiArchetype = (aiResult?.event_archetype && VALID_ARCHETYPES.includes(aiResult.event_archetype))
      ? aiResult.event_archetype
      : null;
    const seedArchetype = (seed.event_archetype && seed.event_archetype !== "unknown") ? seed.event_archetype : null;
    const itemArchetype = (item.event_archetype && item.event_archetype !== "unknown") ? item.event_archetype : null;
    const rawArchetype = aiArchetype || seedArchetype || (rawDesc ? itemArchetype : null);
    const archetype = classifyArchetype(cleanTitle, category, venue, rawArchetype, {
      description: rawDesc,
      lifecycle_type: resolvedLifecycleType
    });
    const archetypeProfile = generateArchetypeProfile(archetype, cleanTitle, venue, category, venueObj, {
      description: rawDesc,
      lineup,
      artist
    });

    const hasHeroDate = Boolean(item.date || ev.date || sched.date || item.startIso || ev.startIso || sched.startIso);
    const isPerennial = (resolvedLifecycleType === "perennial_drop_in" || item.is_perennial || ev.is_perennial);
    const resolvedFrequencyLabel = isPerennial
      ? "Weekly Drop-in"
      : (resolvedLifecycleType === "weekly_recurring_residency" && weeklyRecurringDay)
        ? `Weekly on ${weeklyRecurringDay}s`
        : (hasHeroDate ? (item.frequencyLabel || ev.frequencyLabel || "One-off") : null);
    const resolvedDateSchedule = (hasHeroDate || isPerennial) ? (item.dateSchedule || ev.dateSchedule || sched.dateSchedule || (item.start_time ? `Show ${item.start_time}` : null)) : null;

    const inferredHoliday = (() => {
      if (aiResult?.holiday_affiliation && aiResult.holiday_affiliation !== "None" && aiResult.holiday_affiliation !== "null") {
        return aiResult.holiday_affiliation;
      }
      const explicit = item.holiday_affiliation || ev.holiday_affiliation || sched.holiday_affiliation;
      if (explicit && explicit !== "None" && explicit !== "none_available") return explicit;
      const fullText = `${cleanTitle || ""} ${eventId || ""} ${description || ""} ${rawDesc || ""}`.toLowerCase();
      const rawDate = item.date || ev.date || sched.date || null;
      const mmdd = (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) ? rawDate.slice(5, 10) : null;
      const inSeason = (s, e) => {
        if (!mmdd) return false;
        return s <= e ? (mmdd >= s && mmdd <= e) : (mmdd >= s || mmdd <= e);
      };
      if (/\b(?:diwali|deepavali|bandi\s*chhor)\b/i.test(fullText)) return "diwali";
      if (/\b(?:muertos|day\s*of\s*the\s*dead|ofrenda|calavera|catrina|sugar\s*skull)\b/i.test(fullText)) return "dia-de-los-muertos";
      if (/\b(?:halloween|hallowe'en|trick[- ]or[- ]treat|jack[- ]o'?[- ]lantern|samhain|boo[- ]?tylicious)\b/i.test(fullText)) return "halloween";
      if (/\b(?:christmas|xmas|keithmas|yule|yuletide|santa|krampus|nutcracker|hanukkah|chanukah|kwanzaa|scrooge|grinch)\b/i.test(fullText)) return "christmas";
      if (/\b(?:new\s*year'?s|nye|hogmanay|polar\s*bear\s*swim)\b/i.test(fullText)) return "new-years";
      if (/\b(?:lunar\s*new\s*year|chinese\s*new\s*year|spring\s*festival|tet\s*festival)\b/i.test(fullText)) return "lunar-new-year";
      if (/\b(?:thanksgiving|friendsgiving)\b/i.test(fullText)) return "thanksgiving";
      if (/\b(?:valentine'?s|galentine'?s|anti[- ]valentine)\b/i.test(fullText)) return "valentines-day";
      if (/\b(?:st\.?\s*patrick'?s|st\.?\s*paddy'?s|paddy'?s\s*day)\b/i.test(fullText)) return "st-patricks-day";
      if (/\b(?:easter|egg\s*hunt|good\s*friday|ostara)\b/i.test(fullText)) return "easter";
      if (/\b(?:canada\s*day)\b/i.test(fullText)) return "canada-day";
      if (/\b(?:pride\s*festival|vancouver\s*pride|pride\s*parade|queer\s*pride)\b/i.test(fullText)) return "pride";
      if (inSeason("10-01", "11-03") && /\b(?:haunted|spooky|horror|slasher|thriller|costume|masquerade|zombie|vampire|vampyr|witch|witches|ghost|goth|gothic|occult|macabre|monster|pumpkin|fright|scream|creepy|murder\s*mystery|deadly\s*dinner|unexplained|paranormal|x[- ]files|yes\s*files|seance|séance|rocky\s*horror|nosferatu|frankenstein|dracula|evil\s*dead|exorcist|dark\s*cabaret|freak\s*show)\b/i.test(fullText)) return "halloween";
      if (inSeason("10-15", "11-20") && /\b(?:festival\s*of\s*lights|rangoli|bhangra|bollywood|garba|dandiya|mehfil|diya)\b/i.test(fullText)) return "diwali";
      if (inSeason("11-12", "12-30") && /\b(?:holiday\s*market|winter\s*market|craft\s*market|winter\s*solstice|festive|ugly\s*sweater|carol|carols|caroling|menorah|gingerbread|mistletoe|polar\s*express|canyon\s*lights|bright\s*nights|winter\s*wonderland|holiday\s*special|holiday\s*show|holiday\s*concert|holiday\s*party)\b/i.test(fullText)) return "christmas";
      return undefined;
    })();

    const editorialEntry = {
      id: eventId,
      event_id: eventId,
      clean_title: cleanTitle,
      artist: artist,
      lineup: lineup,
      category: category,
      categories: category ? [category] : [],
      event_archetype: archetype,
      archetype: archetype,
      lifecycle_type: resolvedLifecycleType || undefined,
      weekly_recurring_day: weeklyRecurringDay || undefined,
      description: description,
      restrictions: restrictions,
      frequencyLabel: resolvedFrequencyLabel,
      dateSchedule: resolvedDateSchedule,
      holiday_affiliation: inferredHoliday,
      curator_instructions: curatorInfo.eventInstructionText || item.curator_instructions || null,
      curator_notes: activeCuratorNote || item.curator_notes || null,
      source_engine: aiResult ? (useAgy ? "antigravity_1event_worker" : "gemini_flash_cognitive") : "deterministic_cognitive_nlp",
      enriched_at: nowIso,
      audited_at: nowIso,
      ...archetypeProfile
    };

    // Update editorial layer
    const exIdx = editorialLayer.findIndex((e) => (e.id || e.event_id) === eventId);
    if (exIdx >= 0) {
      editorialLayer[exIdx] = editorialEntry;
    } else {
      editorialLayer.push(editorialEntry);
    }

    enrichedCount++;
    console.log(`   ✨ Title: "${cleanTitle}" | Category: [${category}] | Archetype: [${archetype}] | Artist: ${artist ? `"${artist}"` : "None (General/Recreation)"} | Age: [${restrictions}]`);
    console.log(`   📝 Synopsis: "${description ? description.replace(/[\r\n]+/g, ' ') : 'null'}"`);
    console.log(`   💳 Payment: ${archetypeProfile.payment_methods} | 💧 Water: ${archetypeProfile.water_refill_station}`);
    if (editorialEntry.dateSchedule) console.log(`   📅 Date: ${editorialEntry.dateSchedule}`);
    if (item.time || ev.time || sched.start_time) console.log(`   Showtime: ${item.time || ev.time || sched.start_time}`);
    const priceStr = ev.priceLabel || (ev.price != null ? `$${Number(ev.price).toFixed(2)} CAD` : "Unpriced");
    console.log(`   💰 Price: ${priceStr}`);
    console.log(`💾 Committed updated event (${eventId})`);
  }

  fs.writeFileSync(EDITORIAL_PATH, JSON.stringify(editorialLayer, null, 2), "utf-8");
  console.log(`\n💾 Saved ${enrichedCount} enriched entries to data/layers/layer_editorial.json`);
  if (useAgy) {
    printAntigravityTimeoutSummary("Stage 3A: Semantic Enricher");
  }
  console.log(`================================================================\n`);

  if (enrichedCount > 0 && !options.skipCompile && !options.dryRun) {
    try {
      const enrichedIds = targets.map((t) => t.id || t.event_id).filter(Boolean);
      if (enrichedIds.length > 0) {
        console.log(`⚡ [Auto-Publish] Compiling & publishing ${enrichedIds.length} enriched event(s) to master catalog...`);
        const { compileCatalog } = await import("./compile_catalog.js");
        await compileCatalog({ ids: enrichedIds });
      }
    } catch (compErr) {
      console.warn(`⚠️ [Auto-Publish] Compiler invocation warning: ${compErr.message}`);
    }
  }

  return { success: true, count: enrichedCount };
}

// Direct CLI execution
if (process.argv[1] && process.argv[1].endsWith("enricher.js")) {
  const args = process.argv.slice(2);
  let limit = 20;
  let offset = 0;
  let targetId = null;
  let isAll = false;
  let force = false;
  let unverifiedOnly = false;
  let incompleteOnly = false;
  let stale = null;
  let quarantinedOnly = false;
  let skipHunt = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--all") {
      isAll = true;
      limit = 0;
    } else if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (args[i].startsWith("--limit=")) {
      limit = parseInt(args[i].split("=")[1], 10);
    } else if (args[i] === "--offset" && args[i + 1]) {
      offset = parseInt(args[++i], 10);
    } else if (args[i].startsWith("--offset=")) {
      offset = parseInt(args[i].split("=")[1], 10);
    } else if ((args[i] === "--id" || args[i] === "--ids") && args[i + 1]) {
      targetId = args[++i];
    } else if (args[i].startsWith("--id=") || args[i].startsWith("--ids=")) {
      targetId = args[i].split("=").slice(1).join("=");
    } else if (args[i] === "--force") {
      force = true;
    } else if (args[i] === "--incomplete-only" || args[i] === "--incomplete") {
      incompleteOnly = true;
    } else if ((args[i] === "--stale" || args[i] === "--older-than") && args[i + 1]) {
      stale = args[++i];
    } else if (args[i] === "--unverified-only") {
      unverifiedOnly = true;
    } else if (args[i] === "--quarantine" || args[i] === "--quarantined") {
      quarantinedOnly = true;
    } else if (args[i] === "--skip-hunt") {
      skipHunt = true;
    }
  }

  runEnricher({ limit, offset, id: targetId, all: isAll, force, unverifiedOnly, incompleteOnly, stale, quarantined: quarantinedOnly, skipHunt }).then(() => process.exit(0)).catch((err) => {
    console.error(`❌ Enricher failed: ${err.message}`);
    process.exit(1);
  });
}
