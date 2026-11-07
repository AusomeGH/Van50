import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scanCatalogLinkHealth } from "./link_health_scanner.js";
import { huntBatchTier1Links } from "./tier1_hunter.js";
import { parseDurationMs, isEventStale, isScanIncomplete } from "./event_batch_qc.js";
import { logCuratorInfo, getCuratorInfo } from "./curator_display.js";
import {
  isAntigravityEngine,
  callAntigravityEnricher,
  getAntigravityModel,
  formatLogTime,
  printAntigravityTimeoutSummary,
  safeUpdateJsonFile,
  runWithConcurrency,
} from "./agy_engine.js";

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
 * Computes a SHA-1 content fingerprint of the semantic inputs for an event card.
 * Used to skip redundant LLM calls when an event's title, venue, description, and curator notes
 * have not changed since its last verified enrichment.
 */
export function computeEditorialInputFingerprint(inputs = {}) {
  const payload = JSON.stringify({
    title: String(inputs.title || "").trim(),
    venue: String(inputs.venue || "").trim(),
    description: String(inputs.description || "").trim(),
    category: String(inputs.category || "").trim(),
    lifecycle_type: String(inputs.lifecycle_type || "").trim(),
    restrictions: String(inputs.restrictions || "").trim(),
    curator_instruction: String(inputs.curator_instruction || "").trim(),
  });
  return crypto.createHash("sha1").update(payload).digest("hex");
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
  const isPerennialDropIn =
    extra.lifecycle_type === "perennial_drop_in" ||
    extra.is_perennial === true ||
    category === "free-public-access" ||
    extra.access_model === "open_public_space" ||
    extra.access_model === "free_public_access";

  // Perennial drop-in parks, markets, galleries, and recreation facilities must never be locked to live_stage, cinema, or roving_series
  const PERENNIAL_DISALLOWED_ARCHETYPES = new Set(["live_stage", "cinema", "roving_series"]);

  if (
    rawArchetype &&
    ["cinema", "live_stage", "workshop", "social_gaming", "civic_park", "museum_gallery", "active_rec", "roving_series", "festival"].includes(rawArchetype) &&
    !(isPerennialDropIn && PERENNIAL_DISALLOWED_ARCHETYPES.has(rawArchetype))
  ) {
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
  if (!isPerennialDropIn && /\b(?:pop-up|popup|secret location|roving|open mic|cypher|secret comedy|acoustic circle|street poetry)\b/i.test(combined)) {
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
  if (/\b(?:pitch & putt|pitch and putt|par-3|golf|tennis court|skate park|skatepark|climbing gym|recreation court|athletic court|velodrome|disc golf|aquatic centre|pool|rink)\b/i.test(combined)) {
    return "active_rec";
  }

  // 6. Cinema & Screenings (Archetype A: 710–719)
  if (!isPerennialDropIn && /\b(?:film|screening|movie|documentary|35mm|70mm|4k dcp|premiere|cinematheque|rio theatre|viff centre|theatrical screening|short films)\b/i.test(combined)) {
    return "cinema";
  }

  // 7. Civic Grounds, Parks & Public Waterfront (Archetype E: 750–759)
  if (/\b(?:seawall|park|garden|botanical|conservatory|promenade|public market|farmers market|shipyards|plaza|quay|pier|beach|trail|canyon|suspension bridge|bloedel|vandusen|queen elizabeth|sun yat-sen public|waterfront|granville island)\b/i.test(combined)) {
    if (isPerennialDropIn || !/\b(?:concert|comedy|show|theatre|play|festival)\b/i.test(title || "")) {
      return "civic_park";
    }
  }

  // 8. Museums, Galleries & Heritage Exhibits (Archetype F: 760–769)
  if (/\b(?:gallery|museum|exhibition|exhibit|contemporary art|visual arts|sculpture|roedde house|polygon|cag|pendulum|heritage|science world|aquarium|planetarium|anthropology|bill reid)\b/i.test(combined)) {
    if (isPerennialDropIn || (!/little mountain gallery/i.test(venue || "") && !/\b(?:comedy|stand-up|improv|showcase|theatre|concert)\b/i.test(title || ""))) {
      return "museum_gallery";
    }
  }

  // 9. Default Perennial Drop-In Fallback (Never live_stage for non-show perennials)
  if (isPerennialDropIn) {
    if (category === "arts" || category === "culture") return "museum_gallery";
    return "civic_park";
  }

  // 10. Live Stage, Comedy & Concerts (Archetype B: 720–729)
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
    case "cinema": {
      const mf = extra.matchedFestival || null;
      const descLower = (extra.description || "").toLowerCase();
      const combinedFmtText = `${t} ${descLower}`;
      const inferredFormat = /\b35\s*mm\b/i.test(combinedFmtText)
        ? "35mm Archival Film Print"
        : /\b16\s*mm\b/i.test(combinedFmtText)
          ? "16mm Archival Film Print"
          : /\b70\s*mm\b/i.test(combinedFmtText)
            ? "70mm Archival Film Print"
            : /\b4k\b/i.test(combinedFmtText)
              ? "4K DCP Digital Cinema"
              : null;
      let inferredLangSubs = extra.film_language_subtitles || null;
      if (!inferredLangSubs && extra.description) {
        const langMatch = extra.description.match(/\bin\s+([A-Z][a-z]+(?:\s*(?:,|and|&)\s*[A-Z][a-z]+)*)\s+with\s+English\s+subtitles\b/);
        if (langMatch) {
          inferredLangSubs = `${langMatch[1]} with English subtitles`;
        } else if (/\bwith\s+English\s+subtitles\b/i.test(extra.description)) {
          inferredLangSubs = "Subtitled in English";
        }
      }
      profile.film_runtime_minutes = extra.film_runtime_minutes || null;
      profile.film_language_subtitles = inferredLangSubs;
      profile.projection_format = inferredFormat || extra.projection_format || venueData?.projection_format || (v.includes("cinematheque") || v.includes("viff") || v.includes("rio theatre") ? "DCP Digital Cinema Projection" : null);
      profile.print_condition_notes = (/\b(?:35|16|70)\s*mm\b/i.test(combinedFmtText) ? "Archival celluloid film print screening" : null) || extra.print_condition_notes || null;
      profile.concession_alcohol = venueData?.concession_alcohol || extra.concession_alcohol || null;
      profile.festival_pass_rules = extra.festival_pass_rules || (mf ? `Official selection of ${mf.festival_name} — Single screening tickets & festival passes accepted` : null);
      profile.seat_reservation_type = venueData?.seat_reservation_type || extra.seat_reservation_type || null;
      break;
    }

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
 * Lineup & Artist Sanitizer (Strips recursive title/location echoes and suppresses fake lineups on perennials)
 */
export function extractCleanLineup(title, venue, rawArtist, rawLineup, options = {}) {
  if (options.isPerennial) {
    return { artist: null, lineup: [] };
  }
  const cleanT = (title || "").toLowerCase().replace(/\s*\([^)]*\)/g, "").trim();
  const cleanV = (venue || "").toLowerCase().replace(/\s*\([^)]*\)/g, "").trim();

  const isNonArtist = (name) => {
    if (!name || typeof name !== "string") return true;
    const n = name.trim().toLowerCase();
    if (n.length < 2) return true;
    if (/^(?:none|null|n\/a|none_available|not_applicable|tba|tbd|various|various artists|lineup tba|general admission|admission)$/i.test(n)) return true;
    if (n === cleanT || n === cleanV) return true;
    if (cleanT.length > 4 && (cleanT.includes(n) || n.includes(cleanT))) return true;
    if (cleanV.length > 4 && (cleanV.includes(n) || n.includes(cleanV))) return true;
    if (/\b(?:18-hole|pitch & putt|pitch and putt|round|general admission|admission|drop-in|drop in|market|seawall|tour|exhibition|gallery|park|beach|library|festival|open mic|conservatory|botanical|plaza|waterfront|promenade)\b/i.test(n)) return true;
    if (/\b(?:productions?\s+inc\.?|the\s+world\s+is\s+ours\s+productions?|modo[- ]live|timbre\s+concerts|livenation|live\s+nation|blueprint\s+events|this\s+is\s+blueprint)\b/i.test(n)) return true;
    if (/^(?:playhouse|playhouse\s+presents?|playhouse\s+pres\.?|for\s+real\s+fridays?)$/i.test(n)) return true;
    return false;
  };

  let artist = rawArtist && !isNonArtist(rawArtist) ? rawArtist.trim() : null;
  let lineup = Array.isArray(rawLineup) ? rawLineup.filter(p => !isNonArtist(p)).map(p => p.trim()) : [];

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
    /delivers an energetic evening of sharp punchlines|Patrons can expect dynamic comedic delivery/i.test(d) ||
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      }
    });
    if (!res.ok) return null;
    const html = await Promise.race([
      res.text(),
      new Promise((resolve) => setTimeout(() => resolve(null), 3500))
    ]);
    if (!html) return null;

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
  } finally {
    clearTimeout(timeout);
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
  if (s.length < 110 && /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?:st|nd|rd|th)?|\d{4})\b/i.test(s) && (/\b(?:vancouver|bc|gastown|commercial drive|granville island)\b/i.test(s) || (cleanV && s.includes(cleanV)))) {
    const hasNarrativeVerb = /\b(?:is|are|was|were|explores|delivers|presents|tells|follows|stars|celebrates|highlights|weaves|showcases|features|performs|blends|brings|shares|creates|builds|expect|compete|competes|catch|watch|witness|join|discover|returns|starring|featuring)\b/i.test(s);
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
IMPORTANT ANTI-LAZINESS RULE: Derive your classification, archetype, lifecycle, restrictions, and 2-sentence description strictly from the primary event title, venue, and live scraped page text below. Never echo generic placeholder categories or canned boilerplate.

Input Event:
- Title: "${eventCard.title || eventCard.event_name || ""}"
- Venue: "${eventCard.venue || eventCard.venue_name || ""}"
- Primary Event Page Text: "${eventCard.description || ""}"${curatorPrompt}

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
11. "is_religious": Boolean. Set true ONLY if the event's actual activity involves prayer, worship, liturgy, mass, devotional chanting, scripture, or a faith service. Never set true simply because a secular show is hosted in a church/temple hall or celebrates a secular holiday like Christmas or Diwali.

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

  const boxAuditedIds = new Set(
    (Array.isArray(boxOffices) ? boxOffices : [])
      .filter((b) => b && (b.id || b.event_id) && b.status !== "TIMEOUT_EXCEEDED" && b.status !== "AI_TIMEOUT" && b.status !== "EXECUTION_ERROR")
      .map((b) => String(b.id || b.event_id).toLowerCase())
  );
  const step1bAuditedIds = new Set(
    (Array.isArray(schedules) ? schedules : [])
      .filter((s) => s && (s.id || s.event_id) && Boolean(s.step1b_audited_at))
      .map((s) => String(s.id || s.event_id).toLowerCase())
  );

  // Strict Stage 3 Gate: Uncompiled seed/schedule events can NEVER skip Stage 1B or Stage 2 QC
  seeds.forEach((s) => {
    const sId = s.id || s.event_id;
    const sIdLower = String(sId || "").toLowerCase();
    if (sId && !existingIds.has(sId) && !archivedIds.has(sId) && step1bAuditedIds.has(sIdLower) && boxAuditedIds.has(sIdLower)) {
      sourcePool.push(s);
      existingIds.add(sId);
    }
  });

  schedules.forEach((sc) => {
    const scId = sc.id || sc.event_id;
    const scIdLower = String(scId || "").toLowerCase();
    if (scId && !existingIds.has(scId) && !archivedIds.has(scId) && Boolean(sc.step1b_audited_at) && boxAuditedIds.has(scIdLower)) {
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
  let resumeOffset = 0;
  const todayIso = new Date().toISOString().split("T")[0];
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
    } else if ((options.harvestedOnly || options.scope === "harvested") && !options.force && targets.length > 1) {
      const pending = targets.filter((s) => {
        const ex = existingMap.get(s.id || s.event_id);
        return !ex || isCorruptedOrStale(ex);
      });
      if (pending.length > 0 && pending.length < targets.length) {
        resumeOffset = targets.length - pending.length;
        console.log(`⏭️ [Stage 3 Enricher Resume] Skipping ${resumeOffset} newly harvested events already enriched in layer_editorial.json — resuming on ${pending.length} remaining events!`);
        targets = pending;
      }
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
  } else if (options.harvestedOnly || options.scope === "harvested") {
    // Target newly harvested uncompiled events from layer_schedules.json that completed Stage 2 QC
    const publishedIds = new Set(events.map((e) => String(e.id || e.event_id).toLowerCase()));
    const allHarvestedRaw = schedules.filter((s) => {
      const sId = String(s.id || s.event_id || "").toLowerCase();
      if (!sId || publishedIds.has(sId) || archivedIds.has(sId)) return false;
      const u = String(s.details_url || s.candidate_tier1_url || s.ticket_url || "").toLowerCase();
      if (/\/(support|donate|corporate-giving|patrons-circle|major-gifts)(\/|$)/i.test(u)) return false;
      if (s.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.date < todayIso && s.lifecycle_type !== "perennial_drop_in") {
        return false;
      }
      return Boolean(s.step1b_audited_at);
    });
    // Strict Stage 2 Gate: Never fall back to allHarvestedRaw; events must complete Stage 2 QC before Stage 3 Enrichment
    const quarantinedIds = new Set((quarantined || []).map((q) => String(q.id || q.event_id || "").toLowerCase()).filter(Boolean));
    const allHarvested = allHarvestedRaw.filter((s) => {
      const sId0 = String(s.id || s.event_id || "").toLowerCase();
      if (quarantinedIds.has(sId0) || !boxAuditedIds.has(sId0)) return false;
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


    const pendingEd = allHarvested.filter((s) => {
      const ex = existingMap.get(s.id || s.event_id);
      return !ex || isCorruptedOrStale(ex);
    });
    if (!options.force) {
      resumeOffset = allHarvested.length - pendingEd.length;
      if (resumeOffset > 0 && pendingEd.length > 0) {
        console.log(`⏭️ [Stage 3 Enricher Resume] Skipping ${resumeOffset} Stage 2-completed events already enriched in layer_editorial.json — continuing on ${pendingEd.length} remaining events!`);
      } else if (pendingEd.length === 0) {
        console.log(`✅ [Stage 3 Enricher] All ${allHarvested.length} Stage 2-completed events are already enriched in layer_editorial.json (0 pending).`);
      }
      targets = pendingEd;
    } else {
      targets = allHarvested;
    }
    if (offset > 0) {
      targets = targets.slice(offset);
    }
    if (limit > 0 && !(resumeOffset > 0 && limit >= resumeOffset + targets.length)) {
      targets = targets.slice(0, limit);
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
    const publishedIds = new Set(events.map((e) => String(e.id || e.event_id).toLowerCase()));
    const unenrichedSchedules = schedules
      .filter((s) => {
        const sId = String(s.id || s.event_id || "").toLowerCase();
        if (!sId || publishedIds.has(sId) || archivedIds.has(sId)) return false;
        const u = String(s.details_url || s.candidate_tier1_url || s.ticket_url || "").toLowerCase();
        if (/\/(support|donate|corporate-giving|patrons-circle|major-gifts)(\/|$)/i.test(u)) return false;
        if (s.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.date < todayIso && s.lifecycle_type !== "perennial_drop_in") {
          return false;
        }
        return true;
      })
      .filter(isUnenriched);

    const interleaved = [];
    const maxLen = Math.max(unenrichedActive.length, unenrichedQuarantine.length, unenrichedSeeds.length, unenrichedSchedules.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < unenrichedActive.length) interleaved.push(unenrichedActive[i]);
      if (i < unenrichedQuarantine.length) interleaved.push(unenrichedQuarantine[i]);
      if (i < unenrichedSeeds.length) interleaved.push(unenrichedSeeds[i]);
      if (i < unenrichedSchedules.length) interleaved.push(unenrichedSchedules[i]);
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

  // Pre-Enrichment Link Health & Tier 1 Hunter Pass (skip for harvested runs or cards already audited by Stage 1B)
  const unauditedHuntTargets = targets.filter((t) => !t.step1b_audited_at);
  if (!options.skipHunt && !(options.harvestedOnly || options.scope === "harvested") && unauditedHuntTargets.length > 0 && unauditedHuntTargets.length <= 40) {
    try {
      console.log(`\n⚡ [AI Enricher Pre-Flight] Checking link health across ${unauditedHuntTargets.length} targets...`);
      await scanCatalogLinkHealth(unauditedHuntTargets, { concurrency: 6 });
      const needsHunt = unauditedHuntTargets.filter((t) => t.needs_tier1_hunt);
      if (needsHunt.length > 0) {
        console.log(`🏹 [AI Enricher Pre-Flight] Running Tier 1 Hunter for ${needsHunt.length} degraded or lower-tier targets...`);
        await huntBatchTier1Links(needsHunt);
      }
    } catch (linkErr) {
      console.warn(`⚠️ Warning in pre-enrichment link check: ${linkErr.message}`);
    }
  }

  const requestedConcurrency = Number(options.concurrency || process.env.VAN50_ENRICHER_CONCURRENCY || 3);
  const concurrency = Math.max(1, Math.min(requestedConcurrency, targets.length || 1, 5));
  const displayTotal = resumeOffset + targets.length;
  console.log(`🎯 Targets Queued for Enrichment: ${displayTotal} events`);
  console.log(`⚡ Enricher Concurrency: ${concurrency} worker(s) (with SHA-1 input fingerprint caching & atomic per-card checkpointing)`);
  console.log(`📋 Enriching ${targets.length} events${resumeOffset > 0 ? ` (Resuming at #${resumeOffset + 1}/${displayTotal})` : ""}...\n`);
  let enrichedCount = 0;
  let cacheHitCount = 0;

  await runWithConcurrency(
    targets,
    concurrency,
    async (item, i, workerId) => {
      const eventId = item.id || item.event_id;
      const ev = eventsMap.get(eventId) || {};
      const sched = schedulesMap.get(eventId) || {};
      const box = boxOfficesMap.get(eventId) || {};
      const seed = seedsMap.get(eventId) || {};
      const existingEd = existingMap.get(eventId) || null;

      // Robust property resolution from all layers (prefer rich catalog data, fallback to descriptive seed)
      const GENERIC_TITLE_PATTERN = /^(?:general admission|admission|tickets|ticket checkout|tickets checkout|buy tickets|checkout|tickets on sale|showpass checkout|eventbrite checkout)$/i;
      let title = item.title || item.event_name || ev.title || ev.event_name || "";
      if (!title || GENERIC_TITLE_PATTERN.test(title.trim())) {
        title = seed.seed_title || item.seed_title || sched.title || box.title || title || "Cultural Event";
      }
      const venue = item.venue || item.venue_name || ev.venue || ev.venue_name || sched.venue || box.venue_name || seed.seed_venue || item.seed_venue || null;
      const venueObj = venue ? (venuesMap.get((venue || "").toLowerCase().trim()) || null) : null;
      const cleanLayerDesc = (d) => (d && !isCannedOrSyntheticDesc(d, title)) ? d : "";
      // Strict Stage 3 Isolation: Do NOT pull AI-generated descriptions or categories from Stage 2 (layer_box_office.json)
      let rawDesc = cleanLayerDesc(sched.description) || cleanLayerDesc(item.description) || cleanLayerDesc(ev.description) || "";
      let rawCategory = item.category || (Array.isArray(item.categories) ? item.categories[0] : null) || ev.category || sched.category || "";
      if (rawCategory && (rawCategory === "culture" || rawCategory === "shows") && !rawDesc && !venueObj) {
        rawCategory = "";
      }
      const rawArtist = item.artist || ev.artist || sched.artist || null;
      const rawLineup = (Array.isArray(item.lineup) && item.lineup.length > 0) ? item.lineup :
        (Array.isArray(ev.lineup) && ev.lineup.length > 0) ? ev.lineup :
          (Array.isArray(sched.lineup) && sched.lineup.length > 0) ? sched.lineup : [];
      const rawRestrictions = item.restrictions || ev.restrictions || sched.restrictions || box.restrictions || null;

      // Always prefer primary details_url / event page text for Stage 3 Editorial Enrichment
      const candidateUrl = item.details_url || sched.details_url || ev.details_url ||
        item.ticket_url || sched.ticket_url || box.ticket_url ||
        item.source_url || sched.source_url || ev.websiteUrl || seed.seed_url || "";

      if (candidateUrl && (!rawDesc || rawDesc.length < 180 || isCannedOrSyntheticDesc(rawDesc, title))) {
        try {
          const liveDesc = await fetchLivePageDescription(candidateUrl);
          if (liveDesc) {
            rawDesc = liveDesc;
            console.log(`   🌐 [Worker #${workerId + 1}] Fetched primary event page text (${liveDesc.slice(0, 60)}...)`);
          }
        } catch (_) { }
      }

      const displayIdx = resumeOffset + i + 1;
      console.log(`${formatLogTime()} ✍️ [Worker #${workerId + 1}] Processing [${displayIdx}/${displayTotal}]: ${title} (${venue}) [${eventId}]`);
      const curatorInfo = getCuratorInfo({ eventId, title, venue, existingCard: item });
      const activeCuratorNote = curatorInfo.effectiveNote || curatorInfo.eventInstructionText || curatorInfo.existingCuratorNotes;
      logCuratorInfo({ eventId, title, venue, existingCard: item, prefix: "   " });
      if (activeCuratorNote) {
        console.log(`   🧑‍⚖️ [Enricher AI] Taking Curator Note into account: "${activeCuratorNote}"`);
      }

      let aiResult = null;
      const inputLifecycle = item.lifecycle_type || ev.lifecycle_type || seed.lifecycle_type || null;
      const inputFingerprint = computeEditorialInputFingerprint({
        title,
        venue,
        description: rawDesc,
        category: rawCategory,
        lifecycle_type: inputLifecycle,
        restrictions: rawRestrictions,
        curator_instruction: activeCuratorNote,
      });

      const canReuseCachedEditorial = Boolean(
        !options.force &&
        existingEd &&
        !isCorruptedOrStale(existingEd) &&
        existingEd.input_fingerprint &&
        existingEd.input_fingerprint === inputFingerprint &&
        existingEd.description &&
        !isCannedOrSyntheticDesc(existingEd.description, title)
      );

      if (canReuseCachedEditorial) {
        cacheHitCount++;
        console.log(`   ⚡ [Editorial Cache Hit] Unchanged input fingerprint (${inputFingerprint.slice(0, 8)}) — reusing verified semantic enrichment for "${title}".`);
        aiResult = {
          clean_title: existingEd.clean_title,
          artist: existingEd.artist,
          lineup: existingEd.lineup,
          category: existingEd.category,
          event_archetype: existingEd.event_archetype || existingEd.archetype,
          lifecycle_type: existingEd.lifecycle_type,
          weekly_recurring_day: existingEd.weekly_recurring_day,
          description: existingEd.description,
          restrictions: existingEd.restrictions,
          holiday_affiliation: existingEd.holiday_affiliation,
          is_religious: existingEd.is_religious,
        };
      } else if (useAgy) {
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
      }

      const cleanTitle = aiResult?.clean_title || cleanEventTitle(title);
      const category = aiResult?.category || classifyCategory(cleanTitle, rawDesc, rawCategory, venueObj);
      const resolvedLifecycleType = (
        aiResult?.lifecycle_type &&
        ["time_bound_event", "weekly_recurring_residency", "perennial_drop_in"].includes(aiResult.lifecycle_type)
      )
        ? aiResult.lifecycle_type
        : inputLifecycle;
      const isPerennial = Boolean(
        resolvedLifecycleType === "perennial_drop_in" ||
        item.is_perennial ||
        ev.is_perennial ||
        venueObj?.access_model === "open_public_space" ||
        venueObj?.access_model === "free_public_access"
      );
      const candidateArtist = aiResult?.artist !== undefined ? aiResult.artist : rawArtist;
      const candidateLineup = Array.isArray(aiResult?.lineup) && aiResult.lineup.length > 0 ? aiResult.lineup : rawLineup;
      const cleanedLineup = extractCleanLineup(cleanTitle, venue, candidateArtist, candidateLineup, { isPerennial });
      const artist = isPerennial ? null : cleanedLineup.artist;
      const lineup = isPerennial ? [] : cleanedLineup.lineup;
      const restrictions = (venueObj?.restrictions && /19\+/i.test(venueObj.restrictions))
        ? venueObj.restrictions
        : (aiResult?.restrictions || (rawRestrictions && !/unspecified|check venue/i.test(rawRestrictions) ? rawRestrictions : null));
      const weeklyRecurringDay = isPerennial ? null : (aiResult?.weekly_recurring_day || null);
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
        lifecycle_type: resolvedLifecycleType,
        is_perennial: isPerennial,
        access_model: venueObj?.access_model || null,
      });
      const archetypeProfile = generateArchetypeProfile(archetype, cleanTitle, venue, category, venueObj, {
        description: rawDesc,
        lineup,
        artist
      });

      const hasHeroDate = Boolean(item.date || ev.date || sched.date || item.startIso || ev.startIso || sched.startIso);
      const resolvedFrequencyLabel = isPerennial
        ? "Weekly Drop-in"
        : (resolvedLifecycleType === "weekly_recurring_residency" && weeklyRecurringDay)
          ? `Weekly on ${weeklyRecurringDay}s`
          : (hasHeroDate ? (item.frequencyLabel || ev.frequencyLabel || "One-off") : null);
      const resolvedDateSchedule = (hasHeroDate || isPerennial) ? (item.dateSchedule || ev.dateSchedule || sched.dateSchedule || (item.start_time ? `Show ${item.start_time}` : null)) : null;

      const inferredHoliday = (() => {
        const CANONICAL_HOLIDAYS = new Set([
          "halloween",
          "dia-de-los-muertos",
          "diwali",
          "thanksgiving",
          "christmas",
          "new-years",
          "lunar-new-year",
          "valentines-day",
          "st-patricks-day",
          "easter",
          "canada-day",
          "pride",
        ]);
        const normalizeHolidayCandidate = (rawVal) => {
          if (!rawVal || typeof rawVal !== "string") return null;
          const v = rawVal.trim().toLowerCase().replace(/\s+/g, "-").replace(/['’]/g, "");
          if (v === "new-year" || v === "new-years-eve" || v === "new-years-day") return "new-years";
          return CANONICAL_HOLIDAYS.has(v) ? v : null;
        };
        const titleAndIdText = `${cleanTitle || ""} ${eventId || ""}`.toLowerCase();
        const fullText = `${cleanTitle || ""} ${eventId || ""} ${description || ""} ${rawDesc || ""}`.toLowerCase();
        const rawDate = item.date || ev.date || sched.date || null;
        const mmdd = (rawDate && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) ? rawDate.slice(5, 10) : null;
        const inSeason = (s, e) => {
          if (!mmdd) return false;
          return s <= e ? (mmdd >= s && mmdd <= e) : (mmdd >= s || mmdd <= e);
        };
        const validateHolidaySeason = (cand) => {
          if (!cand || !CANONICAL_HOLIDAYS.has(cand)) return null;
          // Guard against false-positive "new-years" on mid-January concerts or Jan 2+ shows that don't mention New Year in the title
          if (cand === "new-years") {
            const hasTitleNewYear = /\b(?:new\s*year'?s|nye|hogmanay|polar\s*bear\s*swim)\b/i.test(titleAndIdText);
            if (!hasTitleNewYear && (!mmdd || !inSeason("12-30", "01-01"))) return null;
          }
          return cand;
        };
        const aiCand = validateHolidaySeason(normalizeHolidayCandidate(aiResult?.holiday_affiliation));
        if (aiCand) return aiCand;
        const explicitCand = validateHolidaySeason(normalizeHolidayCandidate(item.holiday_affiliation || ev.holiday_affiliation || sched.holiday_affiliation));
        if (explicitCand) return explicitCand;
        if (/\b(?:diwali|deepavali|bandi\s*chhor)\b/i.test(fullText)) return "diwali";
        if (/\b(?:muertos|day\s*of\s*the\s*dead|ofrenda|calavera|catrina|sugar\s*skull)\b/i.test(fullText)) return "dia-de-los-muertos";
        if (/\b(?:halloween|hallowe'en|trick[- ]or[- ]treat|jack[- ]o'?[- ]lantern|samhain|boo[- ]?tylicious)\b/i.test(fullText)) return "halloween";
        if (/\b(?:christmas|xmas|keithmas|yule|yuletide|santa|krampus|nutcracker|hanukkah|chanukah|kwanzaa|scrooge|grinch)\b/i.test(fullText)) return "christmas";
        if (/\b(?:new\s*year'?s|nye|hogmanay|polar\s*bear\s*swim)\b/i.test(titleAndIdText) || (inSeason("12-30", "01-01") && /\b(?:new\s*year'?s|nye|hogmanay|polar\s*bear\s*swim)\b/i.test(fullText))) return "new-years";
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

      const inferredIsReligious = (() => {
        if (typeof aiResult?.is_religious === "boolean") return aiResult.is_religious;
        const contentText = `${cleanTitle || ""} ${description || ""} ${rawDesc || ""}`.toLowerCase();
        return /\b(?:prayer|prayers|worship\s*service|worship\s*night|liturgy|liturgical|eucharist|holy\s*mass|christmas\s*mass|midnight\s*mass|vespers|evensong|sermon|scripture|bible\s*study|gospel\s*service|devotional\s*chanting|chanting,\s*singing,\s*and\s*prayer|candlelit\s*contemplative|taiz[eé]|shabbat\s*service|torah\s*service|synagogue\s*service|puja|kirtan|satsang|arti|aarti|jummah|tarawih|gurdwara\s*diwan|interfaith\s*service|sacred\s*chant)\b/i.test(contentText);
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
        is_religious: inferredIsReligious,
        curator_instructions: curatorInfo.eventInstructionText || item.curator_instructions || null,
        curator_notes: activeCuratorNote || item.curator_notes || null,
        input_fingerprint: inputFingerprint,
        source_engine: canReuseCachedEditorial
          ? (existingEd.source_engine || "cached_editorial")
          : (aiResult ? (useAgy ? "antigravity_1event_worker" : "gemini_flash_cognitive") : "deterministic_cognitive_nlp"),
        enriched_at: canReuseCachedEditorial ? (existingEd.enriched_at || new Date().toISOString()) : new Date().toISOString(),
        audited_at: new Date().toISOString(),
        ...archetypeProfile
      };

      // Persist incrementally to layer_editorial.json via atomic mutex helper
      if (!options.dryRun) {
        await safeUpdateJsonFile(EDITORIAL_PATH, [], (layerArr) => {
          const list = Array.isArray(layerArr) ? layerArr : [];
          const exIdx = list.findIndex((e) => (e.id || e.event_id) === eventId);
          if (exIdx >= 0) {
            list[exIdx] = editorialEntry;
          } else {
            list.push(editorialEntry);
          }
          return list;
        });
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
      return editorialEntry;
    },
    { staggerMs: 400 }
  );

  console.log(`\n💾 Saved ${enrichedCount} enriched entries (${cacheHitCount} fingerprint cache hits) to data/layers/layer_editorial.json`);
  if (useAgy) {
    printAntigravityTimeoutSummary("Stage 3A: Semantic Enricher");
  }
  console.log(`================================================================\n`);

  // Stage 3 strictly writes to data/layers/layer_editorial.json (Layer Isolation D801).
  // Auto-publishing is only executed if explicitly requested via options.autoCompile = true.
  if (enrichedCount > 0 && options.autoCompile === true && !options.skipCompile && !options.dryRun) {
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
  let harvestedOnly = false;
  let skipHunt = false;
  let concurrency = undefined;

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
    } else if (args[i] === "--harvested" || args[i] === "--harvested-only") {
      harvestedOnly = true;
    } else if (args[i] === "--skip-hunt") {
      skipHunt = true;
    } else if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = parseInt(args[++i], 10);
    } else if (args[i].startsWith("--concurrency=")) {
      concurrency = parseInt(args[i].split("=")[1], 10);
    }
  }

  runEnricher({ limit, offset, id: targetId, all: isAll, force, unverifiedOnly, incompleteOnly, stale, quarantined: quarantinedOnly, harvestedOnly, skipHunt, concurrency }).then(() => process.exit(0)).catch((err) => {
    console.error(`❌ Enricher failed: ${err.message}`);
    process.exit(1);
  });
}
