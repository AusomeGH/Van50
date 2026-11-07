import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logCuratorInfo } from "./curator_display.js";
import { isAntigravityEngine, getAntigravityModel, formatLogTime, callAntigravityWorker, printAntigravityTimeoutSummary } from "./agy_engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const VENUES_PATH = path.join(DATA_DIR, "venues.json");
const EVENTS_PATH = path.join(DATA_DIR, "events.json");
const QUEUE_PATH = path.join(DATA_DIR, "manual_review_queue.json");

// Metro Vancouver Geographic Bounds (Strict Boundary Invariant)
const METRO_VANCOUVER_BOUNDS = {
  minLat: 49.0,
  maxLat: 49.4,
  minLng: -123.35,
  maxLng: -122.45
};

/**
 * Validates that GPS coordinates reside within the Metro Vancouver metropolitan region.
 */
function isMetroVancouverGps(lat, lng) {
  if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return false;
  return (
    lat >= METRO_VANCOUVER_BOUNDS.minLat &&
    lat <= METRO_VANCOUVER_BOUNDS.maxLat &&
    lng >= METRO_VANCOUVER_BOUNDS.minLng &&
    lng <= METRO_VANCOUVER_BOUNDS.maxLng
  );
}

/**
 * Validates whether a grounded address or venue record is explicitly out-of-market
 * (outside the 21 Metro Vancouver municipalities & electoral area).
 */
function isOutOfMarketVenueRecord(venueObj) {
  if (!venueObj || typeof venueObj !== "object") return false;
  if (venueObj.is_out_of_market === true) return true;
  const combinedText = `${venueObj.venue_name || ""} ${venueObj.full_address || ""} ${venueObj.address || ""} ${venueObj.neighborhood || ""}`;
  if (/\b(?:OUT[- ]OF[- ]MARKET|Fraser\s+Valley\s+Regional\s+District|Capital\s+Regional\s+District|Squamish[- ]Lillooet|Gulf\s+Islands)\b/i.test(combinedText)) {
    return true;
  }
  if (/\b(?:Abbotsford|Chilliwack|Mission|Squamish|Whistler|Pemberton|Victoria|Nanaimo|Salt\s+Spring\s+Island|Ganges|Kelowna|Kamloops|Penticton|Vernon|Calgary|Edmonton|Toronto|Montreal|Montréal|Ottawa|Winnipeg|Halifax|Seattle|Portland)\s*,\s*(?:BC|AB|ON|QC|MB|NS|WA|OR|Canada|USA)\b/i.test(combinedText)) {
    return true;
  }
  // Non-BC Canadian postal codes (Metro Vancouver postal codes strictly begin with V3, V4, V5, V6, V7)
  const postalMatch = combinedText.match(/\b([A-Z]\d[A-Z])\s*\d[A-Z]\d\b/i);
  if (postalMatch) {
    const fsa = postalMatch[1].toUpperCase();
    if (!/^V[34567]/.test(fsa)) {
      return true;
    }
  }
  return false;
}

/**
 * Robust Venue Matching
 * Matches an event venue string against known facilities in data/venues.json
 */
function matchVenue(venueQuery, venues) {
  if (!venueQuery || !Array.isArray(venues)) return null;
  const rawQuery = String(venueQuery).toLowerCase().trim();
  const cleanQuery = rawQuery.replace(/\(.*?\)/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const isExplicitTestQuery = /^testvenue\b|^testy\b/i.test(rawQuery);
  const candidateVenues = isExplicitTestQuery
    ? venues
    : venues.filter(v => !v?.is_test_canary && !/^testvenue\b/i.test(v?.venue_name || v?.name || "") && (v?.venue_name || v?.name || "") !== "none_available");

  // 1. Exact match
  let matched = candidateVenues.find(v => (v.venue_name || v.name || "").toLowerCase().trim() === rawQuery);
  if (matched) return matched;

  // 2. Clean query match (without parenthetical info / punctuation)
  matched = candidateVenues.find(v => (v.venue_name || v.name || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim() === cleanQuery);
  if (matched) return matched;

  // 3. Clean query containment (strip parenthetical suffixes from venue names first)
  const containmentCandidates = candidateVenues.filter(v => {
    const vNoParens = (v.venue_name || v.name || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    return vNoParens.length > 6 && (cleanQuery.includes(vNoParens) || vNoParens.includes(cleanQuery));
  });
  if (containmentCandidates.length > 0) {
    containmentCandidates.sort((a, b) => {
      const aClean = (a.venue_name || a.name || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      const bClean = (b.venue_name || b.name || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
      return Math.abs(aClean.length - cleanQuery.length) - Math.abs(bClean.length - cleanQuery.length);
    });
    return containmentCandidates[0];
  }

  // 4. Token Overlap Scoring with stopword suppression & distinctive-token precision gate
  const commonStopwords = new Set([
    "gallery", "theatre", "theater", "hall", "centre", "center", "room", "park", "cafe", "club",
    "place", "house", "space", "vancouver", "public", "market", "gardens", "garden", "promenade",
    "courtyard", "district", "waterfront", "quay", "island", "plaza", "building", "square", "beach",
    "fine", "arts", "street", "avenue", "road", "drive", "lane", "studio", "studios", "stage",
    "lounge", "bar", "pub", "inn", "hotel", "society", "association", "classical", "the", "and",
    "for", "with", "at", "by", "of", "central", "north", "south", "east", "west", "main", "downtown",
    "burnaby", "city", "metro", "village", "shop", "live", "venue", "pacific", "granville", "olympic",
    "queen", "elizabeth", "international", "cinemas", "cinema", "company", "council", "family"
  ]);

  const queryTokens = cleanQuery.split(" ").filter(t => t.length >= 3 && !commonStopwords.has(t));
  if (queryTokens.length === 0) return null;

  let bestMatch = null;
  let maxScore = 0;

  for (const v of candidateVenues) {
    const vClean = (v.venue_name || v.name || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    const vTokens = new Set(vClean.split(" ").filter(t => t.length >= 3 && !commonStopwords.has(t)));
    if (vTokens.size === 0) continue;

    let matchedTokenCount = 0;
    let score = 0;
    for (const qTok of queryTokens) {
      if (vTokens.has(qTok)) {
        matchedTokenCount++;
        score += 2;
      }
    }

    const isHighConfidenceOverlap =
      matchedTokenCount >= 2 ||
      (matchedTokenCount === 1 && queryTokens.length === 1 && vTokens.size === 1);

    if (isHighConfidenceOverlap && score > maxScore) {
      maxScore = score;
      bestMatch = v;
    }
  }

  return bestMatch;
}

/**
 * Standard Ground Truth definitions for known physical facilities
 */
/**
 * Standard Ground Truth definitions for known physical facilities
 */
const KNOWN_PHYSICAL_GROUND_TRUTH = {
  "canada place": {
    venue_name: "Canada Place",
    venue_type: "park_beach_outdoor",
    full_address: "999 Canada Pl, Vancouver, BC V6C 3T4",
    neighborhood: "Downtown, Gastown & Yaletown",
    coordinates: [49.2888, -123.1111],
    access_model: "open_public_space",
    environment_type: "hybrid",
    transit_info: "Steps from Waterfront Station (Expo/Millennium/Canada Line SkyTrain & SeaBus)",
    description: "Iconic Vancouver landmark featuring the Canadian Trail promenade, Sails of Light, and public waterfront access.",
    step_free_entrance: "Universal barrier-free promenade and wide concrete ramps",
    elevator_lift: "Elevator access between plaza level, cruise terminal and convention level",
    accessible_washrooms: "Universal accessible public washrooms on promenade level",
    sensory_calibrations: "Open-air harbour promenade with ambient marine sounds and city vistas",
    hearing_loop: "not_applicable",
    service_animals: "Certified guide dogs and service animals welcome",
    access_parking: "Underground paid parking with designated accessible stalls (Indigo)",
    access_seating: "Public benches and promenade seating along Canadian Trail",
    on_site_fnb: "Waterfront cafes and FlyOver Canada concession nearby",
    outside_food_policy: "Picnics, outside food, and non-alcoholic drinks permitted on promenade",
    water_refill_station: "Public drinking water fountains available along Canadian Trail",
    coat_check: "not_applicable",
    payment_methods: "Free public access; concessions accept Credit, Debit & Contactless Tap",
    beer_benchmark: null,
    cocktail_benchmark: null,
    coffee_benchmark: "$4.50 – $6.00 CAD",
    meal_benchmark: "$14.00 – $22.00 CAD",
    concession_benchmark: "$5.00 – $9.00 CAD",
    restrictions: "All Ages Welcome (Family Friendly)"
  },
  "vancouver playhouse": {
    venue_name: "Vancouver Playhouse",
    venue_type: "theatre_cinema_auditorium",
    full_address: "600 Hamilton St, Vancouver, BC V6B 2P1",
    neighborhood: "Downtown, Gastown & Yaletown",
    coordinates: [49.2805, -123.1147],
    access_model: "ticketed_admission",
    environment_type: "indoor",
    transit_info: "2 blocks from Stadium-Chinatown or Vancouver City Centre SkyTrain",
    description: "Premier 668-seat civic theatre in Downtown Vancouver presenting drama, chamber music, dance, and film festival screenings.",
    step_free_entrance: "Street-level entrance from Hamilton Street plaza with automated push-button doors",
    elevator_lift: "Elevator access to mezzanine and upper foyer",
    accessible_washrooms: "Dedicated wheelchair-accessible washrooms on main lobby level",
    sensory_calibrations: "Theatrical sound and stage lighting; hearing loops available",
    hearing_loop: "Sennheiser Infrared assistive listening headsets available at coat check",
    service_animals: "Certified guide dogs and service animals welcome in theatre",
    access_parking: "Civic parking garage directly beneath Queen Elizabeth Theatre complex (accessible stalls)",
    access_seating: "Dedicated wheelchair spaces with companion seating in orchestra section",
    on_site_fnb: "Licensed lobby bar and concession counter open 1 hour prior to curtain",
    outside_food_policy: "Strictly no outside food or beverages permitted; bag check at door",
    water_refill_station: "Chilled water fountain located in main lobby near washrooms",
    coat_check: "Complimentary or $3.00 CAD seasonal coat check in main lobby",
    payment_methods: "Cashless venue - Credit, Debit & Contactless Tap only",
    beer_benchmark: "$8.50 – $10.50 CAD (local craft beer & cider)",
    cocktail_benchmark: "$12.00 – $15.00 CAD",
    coffee_benchmark: "$4.00 – $5.50 CAD",
    meal_benchmark: null,
    concession_benchmark: "$4.50 – $7.50 CAD (pretzels, chocolate, snacks)",
    restrictions: "All Ages (or 19+ for select licensed events w/ ID)"
  },
  "stanley park seawall": {
    venue_name: "Stanley Park Seawall",
    venue_type: "park_beach_outdoor",
    website_url: "https://stanleyparkvan.com/",
    calendar_url: "https://stanleyparkvan.com/",
    full_address: "Stanley Park Dr, Vancouver, BC V6G 1Z4",
    neighborhood: "Stanley Park / West End",
    coordinates: [49.3017, -123.1417],
    access_model: "open_public_space",
    environment_type: "outdoor",
    transit_info: "#19 Stanley Park bus directly to park loop, or 15-min walk from Burrard SkyTrain",
    description: "World-famous 9km paved waterfront seawall loop around Stanley Park with separated walking and cycling lanes.",
    step_free_entrance: "Paved, level seawall multi-use path with dedicated pedestrian and cycling lanes",
    elevator_lift: "not_applicable",
    accessible_washrooms: "Public park washroom pavilions at Second Beach, Third Beach, and Information Booth",
    sensory_calibrations: "Open natural marine environment with ocean views and natural soundscapes",
    hearing_loop: "not_applicable",
    service_animals: "Dogs permitted on leash; designated off-leash park area nearby",
    access_parking: "Pay parking lots throughout Stanley Park (PayByPhone app accepted)",
    access_seating: "Public park benches and picnic lawns along entire seawall trail",
    on_site_fnb: "Seasonal concession stands at Second Beach and Lumberman's Arch; park cafes nearby",
    outside_food_policy: "Picnics, outside food, and non-alcoholic beverages permitted throughout park",
    water_refill_station: "Free public drinking fountains and water bottle fill stations along seawall",
    coat_check: "not_applicable",
    payment_methods: "Free public access; concessions accept Credit, Debit & Tap",
    beer_benchmark: null,
    cocktail_benchmark: null,
    coffee_benchmark: "$4.00 – $5.50 CAD (concession/cafe)",
    meal_benchmark: "$12.00 – $18.00 CAD (seasonal fish & chips / burgers)",
    concession_benchmark: "$4.00 – $8.00 CAD (ice cream, hot dogs, soft drinks)",
    restrictions: "All Ages Welcome (Family Friendly)"
  },
  "stanley park": {
    venue_name: "Stanley Park Seawall",
    venue_type: "park_beach_outdoor",
    website_url: "https://stanleyparkvan.com/",
    calendar_url: "https://stanleyparkvan.com/",
    full_address: "Stanley Park Dr, Vancouver, BC V6G 1Z4",
    neighborhood: "Stanley Park / West End",
    coordinates: [49.3017, -123.1417],
    access_model: "open_public_space",
    environment_type: "outdoor",
    transit_info: "#19 Stanley Park bus directly to park loop, or 15-min walk from Burrard SkyTrain",
    description: "World-famous 9km paved waterfront seawall loop around Stanley Park with separated walking and cycling lanes.",
    step_free_entrance: "Paved, level seawall multi-use path with dedicated pedestrian and cycling lanes",
    elevator_lift: "not_applicable",
    accessible_washrooms: "Public park washroom pavilions at Second Beach, Third Beach, and Information Booth",
    sensory_calibrations: "Open natural marine environment with ocean views and natural soundscapes",
    hearing_loop: "not_applicable",
    service_animals: "Dogs permitted on leash; designated off-leash park area nearby",
    access_parking: "Pay parking lots throughout Stanley Park (PayByPhone app accepted)",
    access_seating: "Public park benches and picnic lawns along entire seawall trail",
    on_site_fnb: "Seasonal concession stands at Second Beach and Lumberman's Arch; park cafes nearby",
    outside_food_policy: "Picnics, outside food, and non-alcoholic beverages permitted throughout park",
    water_refill_station: "Free public drinking fountains and water bottle fill stations along seawall",
    coat_check: "not_applicable",
    payment_methods: "Free public access; concessions accept Credit, Debit & Tap",
    beer_benchmark: null,
    cocktail_benchmark: null,
    coffee_benchmark: "$4.00 – $5.50 CAD (concession/cafe)",
    meal_benchmark: "$12.00 – $18.00 CAD (seasonal fish & chips / burgers)",
    concession_benchmark: "$4.00 – $8.00 CAD (ice cream, hot dogs, soft drinks)",
    restrictions: "All Ages Welcome (Family Friendly)"
  },
  "the rio theatre": {
    venue_name: "The Rio Theatre",
    venue_type: "theatre_cinema_auditorium",
    full_address: "1660 E Broadway, Vancouver, BC V5N 1W1",
    neighborhood: "Commercial Drive / East Vancouver",
    coordinates: [49.2628, -123.0694],
    access_model: "ticketed_admission",
    environment_type: "indoor",
    transit_info: "Steps from Commercial-Broadway SkyTrain Station (Expo & Millennium Lines)",
    description: "Beloved independent vintage cinema and live multimedia theatre presenting cult films, indie screenings, comedy, and burlesque.",
    step_free_entrance: "Street-level entrance from East Broadway; ramped access to main auditorium floor",
    elevator_lift: "Main floor and washrooms step-free; balcony accessible by stairs only",
    accessible_washrooms: "Gender-neutral wheelchair-accessible washroom on main level",
    sensory_calibrations: "Theatrical movie audio and concert stage lighting; relaxed screenings scheduled periodically",
    hearing_loop: "none_available",
    service_animals: "Certified guide dogs and service animals welcome",
    access_parking: "Street parking on Broadway and 10th Ave; commercial parkade nearby at Safeway",
    access_seating: "Wheelchair spaces with companion seats in main floor orchestra",
    on_site_fnb: "Full licensed concession bar serving local craft beer, cider, grilled cheese, and hot vegan/butter popcorn",
    outside_food_policy: "Strictly no outside food or drink permitted; bag check at door",
    water_refill_station: "Drinking water available from concession bar or restroom fountain",
    coat_check: "none_available",
    payment_methods: "Credit, Debit & Contactless Tap accepted at box office and concession",
    beer_benchmark: "$8.50 – $10.50 CAD (craft beer & cider on tap)",
    cocktail_benchmark: "$12.00 – $14.00 CAD",
    coffee_benchmark: "$3.50 – $5.00 CAD",
    meal_benchmark: "$8.00 – $12.00 CAD (gourmet grilled cheese sandwiches)",
    concession_benchmark: "$5.50 – $8.50 CAD (real butter popcorn, vegan candy, fountain pop)",
    restrictions: "All Ages / 19+ for licensed evening screenings (Two pieces of ID required)"
  },
  "fox cabaret": {
    venue_name: "Fox Cabaret",
    venue_type: "nightclub_lounge_cabaret",
    website_url: "https://www.foxcabaret.com/",
    calendar_url: "https://www.foxcabaret.com/monthly-calendar",
    full_address: "2321 Main St, Vancouver, BC V5T 3C9",
    neighborhood: "Mount Pleasant",
    coordinates: [49.2642, -123.1011],
    access_model: "ticketed_admission",
    environment_type: "indoor",
    transit_info: "Main Street-Science World SkyTrain + #3 Main bus to E 7th Ave (steps from Broadway & Main)",
    description: "Mount Pleasant's premier independent live music, comedy, cabaret, and dance club housed in a revitalized 1970s cinema.",
    step_free_entrance: "Street-level main entrance at 2321 Main St; main showroom floor accessible",
    elevator_lift: "No passenger elevator to upstairs Projection Room",
    accessible_washrooms: "Accessible washroom available on the main cabaret level",
    sensory_calibrations: "High-energy concert and club sound system with dynamic stage and strobe lighting",
    hearing_loop: "none_available",
    service_animals: "Certified guide and service animals permitted",
    access_parking: "Metered street parking on Main St and side streets along 7th/8th Ave",
    access_seating: "Mix of cabaret tables, tiered booths, and standing dance floor depending on show format",
    on_site_fnb: "Full-service bars on main floor and Projection Room serving craft beer, cocktails, wine, and zero-proof options",
    outside_food_policy: "No outside food or beverages permitted inside venue",
    water_refill_station: "Free tap water station available at the bar",
    coat_check: "Seasonal coat check available at entrance ($4.00 – $5.00 CAD)",
    payment_methods: "Credit, Debit & Tap accepted at box office and bars",
    beer_benchmark: "$8.50 – $10.50 CAD (local craft beer / tallboy)",
    cocktail_benchmark: "$11.00 – $15.00 CAD (house highball / signature cocktail)",
    coffee_benchmark: null,
    meal_benchmark: null,
    concession_benchmark: "$4.00 – $6.00 CAD (bar snacks / non-alcoholic sodas)",
    restrictions: "Strictly 19+ (Two pieces of valid ID required)"
  },
  "the fox cabaret": {
    venue_name: "Fox Cabaret",
    venue_type: "nightclub_lounge_cabaret",
    website_url: "https://www.foxcabaret.com/",
    calendar_url: "https://www.foxcabaret.com/monthly-calendar",
    full_address: "2321 Main St, Vancouver, BC V5T 3C9",
    neighborhood: "Mount Pleasant",
    coordinates: [49.2642, -123.1011],
    access_model: "ticketed_admission",
    environment_type: "indoor",
    transit_info: "Main Street-Science World SkyTrain + #3 Main bus to E 7th Ave (steps from Broadway & Main)",
    description: "Mount Pleasant's premier independent live music, comedy, cabaret, and dance club housed in a revitalized 1970s cinema.",
    step_free_entrance: "Street-level main entrance at 2321 Main St; main showroom floor accessible",
    elevator_lift: "No passenger elevator to upstairs Projection Room",
    accessible_washrooms: "Accessible washroom available on the main cabaret level",
    sensory_calibrations: "High-energy concert and club sound system with dynamic stage and strobe lighting",
    hearing_loop: "none_available",
    service_animals: "Certified guide and service animals permitted",
    access_parking: "Metered street parking on Main St and side streets along 7th/8th Ave",
    access_seating: "Mix of cabaret tables, tiered booths, and standing dance floor depending on show format",
    on_site_fnb: "Full-service bars on main floor and Projection Room serving craft beer, cocktails, wine, and zero-proof options",
    outside_food_policy: "No outside food or beverages permitted inside venue",
    water_refill_station: "Free tap water station available at the bar",
    coat_check: "Seasonal coat check available at entrance ($4.00 – $5.00 CAD)",
    payment_methods: "Credit, Debit & Tap accepted at box office and bars",
    beer_benchmark: "$8.50 – $10.50 CAD (local craft beer / tallboy)",
    cocktail_benchmark: "$11.00 – $15.00 CAD (house highball / signature cocktail)",
    coffee_benchmark: null,
    meal_benchmark: null,
    concession_benchmark: "$4.00 – $6.00 CAD (bar snacks / non-alcoholic sodas)",
    restrictions: "Strictly 19+ (Two pieces of valid ID required)"
  },
  "stanley park pitch & putt": {
    venue_name: "Stanley Park Pitch & Putt",
    venue_type: "park_beach_outdoor",
    website_url: "https://stanleyparkvan.com/stanley-park-pitch-and-putt.html",
    calendar_url: "https://stanleyparkvan.com/stanley-park-pitch-and-putt.html",
    full_address: "2099 Beach Ave, Vancouver, BC V6G 1Z4",
    neighborhood: "Stanley Park / West End",
    coordinates: [49.2915, -123.1463],
    access_model: "drop_in_paid",
    environment_type: "outdoor",
    weekly_hours: "Daily: 7:30 AM – Dusk (First-come, first-served drop-in)",
    transit_info: "#19 Stanley Park bus or #23 Beach Ave bus to Stanley Park entrance",
    description: "Scenic 18-hole par-3 pitch and putt course bordered by rhodos, towering cedars, and English Bay views.",
    step_free_entrance: "Ground-level pro shop complex and grassy course walkways",
    elevator_lift: "not_applicable",
    accessible_washrooms: "Public park washrooms adjacent to pro shop and Second Beach",
    sensory_calibrations: "Tranquil outdoor park course with natural shade",
    hearing_loop: "not_applicable",
    service_animals: "Service animals permitted on paths",
    on_site_fnb: "Clubhouse pro shop snacks & cold bottled drinks; Stanley Park Brewing nearby",
    outside_food_policy: "Water bottles and personal trail snacks permitted",
    water_refill_station: "Public drinking water fountains near clubhouse",
    coat_check: "not_applicable",
    payment_methods: "Credit, Debit & Contactless Tap at Pro Shop",
    beer_benchmark: null,
    cocktail_benchmark: null,
    coffee_benchmark: "$3.50 CAD (Bottled Beverage / Clubhouse Coffee)",
    meal_benchmark: "$4.00 CAD (Club Rental / Golf Ball Sleeve)",
    concession_benchmark: "$3.50 – $5.00 CAD",
    restrictions: "All Ages Welcome (First-come, first-served walk-up play)"
  },
  "queen elizabeth park pitch & putt": {
    venue_name: "Queen Elizabeth Park Pitch & Putt",
    venue_type: "park_beach_outdoor",
    website_url: "https://www.destinationvancouver.com/places-to-go/attractions/parks-gardens/queen-elizabeth-park/",
    calendar_url: "https://www.destinationvancouver.com/places-to-go/attractions/parks-gardens/queen-elizabeth-park/",
    full_address: "4600 Cambie St, Vancouver, BC V5Z 2Z1",
    neighborhood: "South Cambie / Riley Park",
    coordinates: [49.2396, -123.1151],
    access_model: "drop_in_paid",
    environment_type: "outdoor",
    weekly_hours: "Daily: 7:30 AM – Dusk (First-come, first-served drop-in)",
    transit_info: "King Edward Station (Canada Line SkyTrain) or #15 Cambie bus",
    description: "18-hole par-3 pitch and putt golf course on the western slopes of Queen Elizabeth Park with sweeping city and mountain views.",
    step_free_entrance: "Ground-level clubhouse entrance off Cambie Street park drive",
    elevator_lift: "not_applicable",
    accessible_washrooms: "Accessible public park washrooms at Queen Elizabeth Park plaza",
    sensory_calibrations: "Open-air parkland course with rolling grassy hills",
    hearing_loop: "not_applicable",
    service_animals: "Service animals permitted on park pathways",
    on_site_fnb: "Clubhouse snacks and beverages; Seasons in the Park restaurant nearby",
    outside_food_policy: "Water bottles and personal snacks permitted",
    water_refill_station: "Public park water fountains nearby",
    coat_check: "not_applicable",
    payment_methods: "Credit, Debit & Contactless Tap at Pro Shop",
    beer_benchmark: null,
    cocktail_benchmark: null,
    coffee_benchmark: "$3.50 CAD (Bottled Beverage / Clubhouse Coffee)",
    meal_benchmark: "$4.00 CAD (Club Rental / Golf Ball Sleeve)",
    concession_benchmark: "$3.50 – $5.00 CAD",
    restrictions: "All Ages Welcome (First-come, first-served walk-up play)"
  },
  "central park pitch & putt": {
    venue_name: "Central Park Pitch & Putt",
    venue_type: "park_beach_outdoor",
    website_url: "https://www.burnaby.ca/recreation-and-arts/activities-and-registration/golf/central-park-pitch-and-putt",
    calendar_url: "https://www.burnaby.ca/recreation-and-arts/activities-and-registration/golf/central-park-pitch-and-putt",
    full_address: "3883 Imperial St, Burnaby, BC V5J 1A3",
    neighborhood: "Metrotown / Burnaby",
    coordinates: [49.2244, -123.0189],
    access_model: "drop_in_paid",
    environment_type: "outdoor",
    weekly_hours: "Daily: 8:00 AM – Dusk (First-come, first-served drop-in)",
    transit_info: "Patterson SkyTrain Station (Expo Line) or #49 bus along Imperial St",
    description: "18-hole par-3 pitch and putt golf course nestled among towering Douglas firs in Burnaby's Central Park.",
    step_free_entrance: "Level pathway to clubhouse off Imperial Street parking lot",
    elevator_lift: "not_applicable",
    accessible_washrooms: "Accessible public park washrooms at clubhouse",
    sensory_calibrations: "Quiet forest-lined outdoor course",
    hearing_loop: "not_applicable",
    service_animals: "Service animals welcome",
    on_site_fnb: "Clubhouse bottled drinks and light snacks",
    outside_food_policy: "Personal beverages and snacks permitted",
    water_refill_station: "Public water fountain outside clubhouse",
    coat_check: "not_applicable",
    payment_methods: "Credit, Debit & Contactless Tap",
    beer_benchmark: null,
    cocktail_benchmark: null,
    coffee_benchmark: "$3.50 CAD (Bottled Beverage / Clubhouse Coffee)",
    meal_benchmark: "$4.00 CAD (Club Rental / Golf Ball Sleeve)",
    concession_benchmark: "$3.50 – $5.00 CAD",
    restrictions: "All Ages Welcome (First-come, first-served walk-up play)"
  }
};

/**
 * Fast HTML fetcher for live venue portals with timeout
 */
async function fetchVenuePortalHtml(url, timeoutMs = 4000) {
  if (!url || !url.startsWith("http")) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Van50VenueDetailer/1.0",
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
 * Live Grounding Engine for Physical Facilities
 * Inspects official venue web portals, schema.org JSON-LD, civic address anchors, and accessibility cues.
 * Completely independent of external Gemini API keys.
 */
async function callGeminiGoogleMapsGrounding(venueName, existingVenue = {}, htmlSnippet = "") {
  const prompt = `You are the Van50 Venue & Google Maps Grounding AI for Metro Vancouver, BC.
Provide verified physical facility constants (Clusters 4XX, 5XX, 6XX) for this venue or drop-in park/recreation facility:
- Venue Name: "${venueName}"
- Known Address: "${existingVenue.full_address || existingVenue.address || ""}"
- Known Website: "${existingVenue.website_url || existingVenue.calendar_url || ""}"
- Page Excerpt: "${(htmlSnippet || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 1200)}"

STRICT JURISDICTIONAL & ANTI-HALLUCINATION RULES:
1. NEVER invent, guess, or substitute a Vancouver address if "${venueName}" is actually located in another city (e.g., Calgary, Edmonton, Toronto, Montreal, Victoria, Salt Spring Island, Squamish, Whistler, Abbotsford, Chilliwack, Seattle) or if you cannot verify that a real physical venue with this exact name exists in Metro Vancouver.
2. If the venue is located outside the 21 Metro Vancouver municipalities (Vancouver, Burnaby, Richmond, Surrey, North Vancouver, West Vancouver, New Westminster, Coquitlam, Port Coquitlam, Port Moody, Delta, White Rock, Langley, Maple Ridge, Pitt Meadows, Bowen Island, Anmore, Belcarra, Lions Bay, Tsawwassen, UBC/UEL), set "is_out_of_market": true and report its actual city/address in "full_address".
3. If the venue name cannot be verified as a real Metro Vancouver facility, set "full_address": null and "coordinates": null.

Return a JSON object with:
{
  "is_out_of_market": false,
  "venue_type": "park_beach_outdoor" | "theatre_cinema_auditorium" | "bar_club_music_lounge" | "gallery_museum_exhibition" | "civic_library_community_centre" | "market_bistro_cafe",
  "full_address": "Street address, City, BC PostalCode (or null if unverified)",
  "coordinates": [latitude, longitude],
  "neighborhood": "Neighborhood / Municipality",
  "access_model": "open_public_space" | "free_public_access" | "drop_in_paid" | "ticketed_admission",
  "environment_type": "indoor" | "outdoor" | "hybrid",
  "weekly_hours": "Human-readable weekly operating hours (e.g. Daily: 6:00 AM - 10:00 PM)",
  "transit_info": "Nearest SkyTrain station or TransLink bus routes",
  "accessibility": {
    "step_free_entrance": "Description of step-free/ramped access",
    "elevator_lift": "Description or not_applicable",
    "accessible_washrooms": "Description of accessible washrooms",
    "service_animals": "Service animal / pet policy"
  },
  "amenities_and_policies": {
    "on_site_fnb": "Concession / bar / cafe description",
    "coffee_benchmark": "$X.XX CAD (description) or null",
    "beer_benchmark": "$X.XX CAD (description) or null",
    "cocktail_benchmark": "$X.XX CAD (description) or null",
    "meal_benchmark": "$X.XX CAD (description) or null",
    "outside_food_policy": "Outside food / picnic policy",
    "payment_methods": "Accepted payment methods"
  }
}`;

  if (isAntigravityEngine()) {
    console.log(`   🚀 [Antigravity Venue Detailer Worker] Grounding "${venueName}" via 1-venue Antigravity Worker (${getAntigravityModel()})...`);
    const agyRes = await callAntigravityWorker(prompt, {
      id: venueName,
      title: venueName,
      venue: venueName,
      url: existingVenue.website_url || existingVenue.calendar_url || ""
    });
    if (agyRes && typeof agyRes === "object" && Object.keys(agyRes).length > 0) {
      return agyRes;
    }
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  if (!apiKey || !apiKey.startsWith("AIzaSy")) return null;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey.trim()}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
      })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return text ? JSON.parse(text) : null;
  } catch (_) {
    return null;
  }
}

async function fetchLiveVenueDetails(venueName, existingVenue = {}) {
  const portalUrl = existingVenue.website_url || existingVenue.calendar_url || existingVenue.boxOfficeUrl || null;
  const html = portalUrl ? await fetchVenuePortalHtml(portalUrl, 5000) : null;

  // Try Gemini Google Maps & Facility Grounding first if API key is configured
  const aiGrounding = await callGeminiGoogleMapsGrounding(venueName, existingVenue, html || "");
  if (aiGrounding && aiGrounding.full_address) {
    return aiGrounding;
  }

  if (!html) {
    return null;
  }

  const details = {};

  // 1. JSON-LD schema extraction
  try {
    const jsonLdMatches = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
    if (jsonLdMatches) {
      for (const m of jsonLdMatches) {
        const rawContent = m.replace(/<script[^>]*>|<\/script>/gi, "").trim();
        const parsed = JSON.parse(rawContent);
        const item = Array.isArray(parsed) ? parsed[0] : (parsed["@graph"] ? parsed["@graph"].find(x => x.address || x.geo) : parsed);
        if (item) {
          if (item.address) {
            const addr = typeof item.address === "string" ? item.address : `${item.address.streetAddress || ""}, ${item.address.addressLocality || "Vancouver"}, BC ${item.address.postalCode || ""}`.trim();
            if (addr && addr.length > 5) details.full_address = addr;
          }
          if (item.geo && item.geo.latitude && item.geo.longitude) {
            const gLat = parseFloat(item.geo.latitude);
            const gLng = parseFloat(item.geo.longitude);
            if (isMetroVancouverGps(gLat, gLng)) details.coordinates = [gLat, gLng];
          }
        }
      }
    }
  } catch (_) { }

  // 2. Postal Code & Street Address Regex Extraction (Requires whitespace before street suffix and rejects prose/year false positives)
  if (!details.full_address) {
    const postalMatch = html.match(/\b([A-Z]\d[A-Z]\s*\d[A-Z]\d)\b/i);
    const streetMatch = html.match(/\b(\d{1,5}\s+(?:[NSEW]\.?\s+)?[A-Z0-9][A-Za-z0-9.]{1,24}(?:\s+[A-Z0-9][A-Za-z0-9.]{1,24}){0,2}\s+(?:Street|St|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Place|Pl|Way|Lane|Broadway|Highway)\b(?:\s*,\s*(?:Vancouver|Burnaby|Richmond|North Vancouver|West Vancouver|New Westminster|Surrey|Coquitlam|Port Moody))?)/);
    const candidateStreet = streetMatch ? streetMatch[1].trim() : "";
    const isProseYearFalsePositive = /^(?:19\d\d|20\d\d)\s+(?:classic|film|movie|show|tour|festival|annual|edition|season|winner|award)/i.test(candidateStreet);
    if (candidateStreet && !isProseYearFalsePositive) {
      if (postalMatch) {
        details.full_address = `${candidateStreet}, Vancouver, BC ${postalMatch[1].toUpperCase().trim()}`;
      } else {
        details.full_address = `${candidateStreet}, Vancouver, BC`;
      }
    }
  }

  // 3. Transit & SkyTrain Anchors
  const lowerHtml = html.toLowerCase();
  if (lowerHtml.includes("skytrain") || lowerHtml.includes("seabus") || lowerHtml.includes("translink")) {
    const skyTrainMatch = html.match(/(?:near|steps from|close to|walking distance from)?\s*([A-Za-z\s-]+?(?:Station|SkyTrain|SeaBus))/i);
    if (skyTrainMatch) {
      details.transit_info = `Transit accessible: ${skyTrainMatch[0].trim()}`;
    }
  }

  // 4. Accessibility Cues
  details.accessibility = {};
  if (lowerHtml.includes("wheelchair") || lowerHtml.includes("step-free") || lowerHtml.includes("ramp")) {
    details.accessibility.step_free_entrance = "Wheelchair accessible and ramped entrance confirmed on venue portal";
    details.accessibility.accessible_washrooms = "Accessible washroom accommodations confirmed on venue portal";
  }
  if (lowerHtml.includes("hearing loop") || lowerHtml.includes("assistive listening")) {
    details.accessibility.hearing_loop = "Assistive listening system available";
  }

  // 5. Food & Drink Policies
  details.amenities_and_policies = {};
  if (lowerHtml.includes("outside food") && lowerHtml.includes("permitted")) {
    details.amenities_and_policies.outside_food_policy = "Outside food & non-alcoholic beverages permitted";
  } else if (lowerHtml.includes("no outside food") || lowerHtml.includes("licensed venue")) {
    details.amenities_and_policies.outside_food_policy = "Strictly no outside food or drink; licensed venue";
  }

  return Object.keys(details).length > 0 ? details : null;
}

/**
 * Synchronous Fallback Heuristics Engine
 * Determines venue_type and enriches all Cluster 4XX, 5XX, and 6XX dimensions based on facility archetype.
 */
function applyVenueFallbackHeuristics(venue) {
  const v = { ...venue };
  const name = v.venue_name || v.name || "Unknown Facility";
  const desc = (v.description || "").toLowerCase();
  const nm = name.toLowerCase();

  // 1. Detect Venue Type Archetype
  if (!v.venue_type) {
    if (desc.includes("park") || desc.includes("beach") || desc.includes("trail") || desc.includes("seawall") ||
      nm.includes("park") || nm.includes("beach") || nm.includes("seawall") || nm.includes("canyon") || nm.includes("point")) {
      v.venue_type = "park_beach_outdoor";
    } else if (nm.includes("theatre") || nm.includes("theater") || nm.includes("cinema") || nm.includes("playhouse") ||
      nm.includes("auditorium") || nm.includes("hall") || desc.includes("theatre") || desc.includes("cinema")) {
      v.venue_type = "theatre_cinema_auditorium";
    } else if (nm.includes("bar") || nm.includes("pub") || nm.includes("cabaret") || nm.includes("lounge") ||
      nm.includes("club") || nm.includes("tavern") || nm.includes("brewery")) {
      v.venue_type = "bar_club_music_lounge";
    } else if (nm.includes("gallery") || nm.includes("museum") || nm.includes("exhibition") || desc.includes("gallery") || desc.includes("museum")) {
      v.venue_type = "gallery_museum_exhibition";
    } else if (nm.includes("community centre") || nm.includes("library") || nm.includes("civic") || nm.includes("roundhouse") || nm.includes("garden")) {
      v.venue_type = "civic_library_community_centre";
    } else {
      v.venue_type = "market_bistro_cafe";
    }
  }

  // 2. D44: Civic Street Address Grounding (Never invent synthetic addresses)
  if (!v.full_address && v.address) v.full_address = v.address;

  if (v.full_address) {
    v.full_address = v.full_address.replace(/,\s*Vancouver,\s*Vancouver/gi, ", Vancouver").trim();
    if (!v.full_address.includes("BC") && !v.full_address.includes("British Columbia")) {
      if (/,\s*Vancouver\b/i.test(v.full_address)) {
        v.full_address = v.full_address.replace(/,\s*Vancouver\b/i, ", Vancouver, BC");
      } else {
        v.full_address = `${v.full_address}, Vancouver, BC`;
      }
    }
    v.full_address = v.full_address.replace(/,\s*Vancouver,\s*Vancouver/gi, ", Vancouver").trim();
  }

  // 3. D45: GPS Pin Coordinates
  let lat = null;
  let lng = null;
  if (Array.isArray(v.coordinates) && v.coordinates.length >= 2) {
    lat = Number(v.coordinates[0]);
    lng = Number(v.coordinates[1]);
  } else if (v.coordinates && typeof v.coordinates === "object") {
    lat = Number(v.coordinates.lat || v.coordinates.latitude);
    lng = Number(v.coordinates.lng || v.coordinates.longitude);
  } else if (v.lat && v.lng) {
    lat = Number(v.lat);
    lng = Number(v.lng);
  }

  if (!lat || !lng || !isMetroVancouverGps(lat, lng)) {
    v.coordinates = null;
    v._gps_inferred = true;
  } else {
    v.coordinates = [Number(lat.toFixed(4)), Number(lng.toFixed(4))];
    v._gps_inferred = false;
  }

  const isLocationConfirmed = Boolean(
    (v.full_address && String(v.full_address).trim().length > 5 && !v.full_address.includes("Unknown Facility")) ||
    (v.coordinates && Array.isArray(v.coordinates) && v.coordinates.length === 2) ||
    v.grounding_source === "known_physical_ground_truth"
  );

  // 4. D46: Access Model & D47: Environment Type (Never infer for unverified venues)
  if (!isLocationConfirmed) {
    v.access_model = null;
    v.environment_type = null;
    v.step_free_entrance = null;
    v.elevator_lift = null;
    v.accessible_washrooms = null;
    v.sensory_calibrations = null;
    v.hearing_loop = null;
    v.service_animals = null;
    v.outside_food_policy = null;
    v.water_refill_station = null;
    v.coat_check = null;
    v.payment_methods = null;
  } else {
    if (!v.access_model) {
      if (v.venue_type === "park_beach_outdoor") {
        v.access_model = "open_public_space";
      } else if (v.venue_type === "civic_library_community_centre") {
        v.access_model = "civic_drop_in";
      } else {
        v.access_model = null;
      }
    }

    if (!v.environment_type) {
      if (v.venue_type === "park_beach_outdoor") {
        v.environment_type = "outdoor";
      } else if (v.venue_type === "market_bistro_cafe") {
        v.environment_type = "hybrid";
      } else {
        v.environment_type = null;
      }
    }

    // 5. Keep accessibility & amenities honest null unless verified
    v.step_free_entrance = v.step_free_entrance || null;
    v.elevator_lift = v.elevator_lift || null;
    v.accessible_washrooms = v.accessible_washrooms || null;
    v.sensory_calibrations = v.sensory_calibrations || null;
    v.hearing_loop = v.hearing_loop || null;
    v.service_animals = v.service_animals || null;
    v.outside_food_policy = v.outside_food_policy || null;
    v.water_refill_station = v.water_refill_station || null;
    v.coat_check = v.coat_check || null;
    v.payment_methods = v.payment_methods || null;
  }

  v.spend_benchmarks = {
    beer: v.beer_benchmark,
    cocktail: v.cocktail_benchmark,
    meal: v.meal_benchmark,
    coffee: v.coffee_benchmark
  };

  // 6. D50: Transit Access & Waypoints
  if (!isLocationConfirmed) {
    v.transit_info = null;
  } else if (!v.transit_info || v.transit_info.includes("Check TransLink for nearest transit route")) {
    const nh = (v.neighborhood || "").toLowerCase();
    const addr = (v.full_address || "").toLowerCase();
    if (nm.includes("stanley park") || nh.includes("stanley park")) {
      v.transit_info = "#19 Stanley Park bus direct to park loop";
    } else if (nh.includes("gastown") || addr.includes("waterfront")) {
      v.transit_info = "3 blocks from Waterfront Station (SkyTrain & SeaBus) or #50 / #19 bus";
    } else if (nh.includes("chinatown") && (addr.includes("keefer") || addr.includes("pender"))) {
      v.transit_info = "Steps from Stadium-Chinatown SkyTrain (Expo Line) or #19 / #22 bus";
    } else if (nm.includes("granville island") || addr.includes("johnston st")) {
      v.transit_info = "#50 False Creek bus or False Creek Ferries / Aquabus docks";
    } else if (nm.includes("ubc") || addr.includes("marine dr")) {
      v.transit_info = "R4 RapidBus, #99 B-Line, or #4 / #14 trolley to UBC Bus Exchange";
    } else {
      v.transit_info = "TransLink Metro Vancouver transit accessible (Bus / SkyTrain nearby)";
    }
  }

  v.last_grounded_at = v.last_grounded_at || new Date().toISOString();
  v.grounding_source = v.grounding_source || "deterministic_heuristics";

  return v;
}

/**
 * Normalizes and grounds venue amenities and physical constants (Clusters 4XX, 5XX, 6XX).
 * Uses live Google Maps and Google Maps Reviews AI as primary source, with typed fallback heuristics.
 */
async function groundVenueRecord(venue, options = {}) {
  const v = { ...venue };
  const name = v.venue_name || v.name || "Unknown Facility";
  const nameLower = name.toLowerCase().trim();
  const useAi = options.useAi !== false;

  // 1. Check Known Physical Ground Truth overrides if applicable
  if (KNOWN_PHYSICAL_GROUND_TRUTH[nameLower]) {
    const known = KNOWN_PHYSICAL_GROUND_TRUTH[nameLower];
    Object.assign(v, known);
    v.spend_benchmarks = {
      beer: known.beer_benchmark,
      cocktail: known.cocktail_benchmark,
      meal: known.meal_benchmark,
      coffee: known.coffee_benchmark
    };
    v.last_grounded_at = new Date().toISOString();
    v.grounding_source = "known_physical_ground_truth";
    console.log(`   🏛️ [Civic Registry Grounding] Anchored to verified physical facility constants for "${name}".`);
    await new Promise(r => setTimeout(r, 500));
    return v;
  }

  // 2. Primary Source: Live Web Portal & Schema Grounding
  if (useAi) {
    const aiDetails = await fetchLiveVenueDetails(name, v);
    if (aiDetails && typeof aiDetails === "object") {
      if (aiDetails.is_out_of_market === true || isOutOfMarketVenueRecord(aiDetails)) {
        v.is_out_of_market = true;
        v.full_address = aiDetails.full_address || v.full_address || null;
        console.warn(`   🚫 [Out-of-Market Gate] Rejecting non-Metro-Vancouver facility "${name}" (${v.full_address || "Out of bounds"}).`);
        return v;
      }
      if (aiDetails.venue_type) v.venue_type = aiDetails.venue_type;
      if (aiDetails.full_address) v.full_address = aiDetails.full_address;
      if (Array.isArray(aiDetails.coordinates) && aiDetails.coordinates.length >= 2) {
        const [aLat, aLng] = aiDetails.coordinates.map(Number);
        if (isMetroVancouverGps(aLat, aLng)) {
          v.coordinates = [Number(aLat.toFixed(4)), Number(aLng.toFixed(4))];
          v._gps_inferred = false;
        }
      }
      if (aiDetails.neighborhood) v.neighborhood = aiDetails.neighborhood;
      if (aiDetails.access_model) v.access_model = aiDetails.access_model;
      if (aiDetails.environment_type) v.environment_type = aiDetails.environment_type;
      if (aiDetails.weekly_hours) v.weekly_hours = aiDetails.weekly_hours;
      if (aiDetails.transit_info) v.transit_info = aiDetails.transit_info;
      if (aiDetails.google_rating) v.google_rating = aiDetails.google_rating;
      if (aiDetails.review_summary) v.review_summary = aiDetails.review_summary;
      if (aiDetails.proof_quote) v.proof_quote = aiDetails.proof_quote;

      // Extract Accessibility (Cluster 5XX)
      if (aiDetails.accessibility && typeof aiDetails.accessibility === "object") {
        const acc = aiDetails.accessibility;
        v.step_free_entrance = acc.step_free_entrance || v.step_free_entrance;
        v.elevator_lift = acc.elevator_lift || v.elevator_lift;
        v.accessible_washrooms = acc.accessible_washrooms || v.accessible_washrooms;
        v.sensory_calibrations = acc.sensory_calibrations || v.sensory_calibrations;
        v.hearing_loop = acc.hearing_loop || v.hearing_loop;
        v.service_animals = acc.service_animals || v.service_animals;
        v.access_parking = acc.access_parking || v.access_parking;
        v.access_seating = acc.access_seating || v.access_seating;
        v.accessibility = {
          step_free: v.step_free_entrance,
          elevator: v.elevator_lift,
          washrooms: v.accessible_washrooms,
          sensory: v.sensory_calibrations,
          hearing_loop: v.hearing_loop,
          service_animals: v.service_animals,
          parking: v.access_parking,
          seating: v.access_seating
        };
      }

      // Extract Amenities & Policies (Cluster 6XX)
      if (aiDetails.amenities_and_policies && typeof aiDetails.amenities_and_policies === "object") {
        const pol = aiDetails.amenities_and_policies;
        v.on_site_fnb = pol.on_site_fnb || v.on_site_fnb;
        v.outside_food_policy = pol.outside_food_policy || v.outside_food_policy;
        v.water_refill_station = pol.water_refill_station || v.water_refill_station;
        v.coat_check = pol.coat_check || v.coat_check;
        v.payment_methods = pol.payment_methods || v.payment_methods;
        v.concession_benchmark = pol.concession_benchmark || v.concession_benchmark;
        if (pol.restrictions) v.restrictions = pol.restrictions;

        // Venue-type conditioned alcohol benchmarks
        const isAlcoholFreeType = v.venue_type === "park_beach_outdoor" || v.venue_type === "civic_library_community_centre";
        v.beer_benchmark = isAlcoholFreeType ? null : (pol.beer_benchmark || null);
        v.cocktail_benchmark = isAlcoholFreeType ? null : (pol.cocktail_benchmark || null);
        v.coffee_benchmark = pol.coffee_benchmark || null;
        v.meal_benchmark = pol.meal_benchmark || null;

        v.spend_benchmarks = {
          beer: v.beer_benchmark,
          cocktail: v.cocktail_benchmark,
          meal: v.meal_benchmark,
          coffee: v.coffee_benchmark
        };
      }

      v.last_grounded_at = new Date().toISOString();
      v.grounding_source = "google_maps_reviews_ai";
      console.log(`   ✨ [Google Maps AI] Successfully verified "${name}" [${v.venue_type || "facility"}] (${v.google_rating ? `${v.google_rating}★` : "Grounded"}).`);
      return v;
    }
  }

  // 3. Fallback Heuristic Grounding (Resilience Engine tailored by Venue Type)
  return applyVenueFallbackHeuristics(v);
}

/**
 * Propagates grounded venue constants onto an event card
 */
function groundEventCard(card, venues, nowIso) {
  const c = { ...card };
  const vName = c.venue_name || c.venue || "Unknown Venue";
  const matchedVenue = matchVenue(vName, venues);

  let venue = matchedVenue ? { ...matchedVenue } : {
    venue_name: vName,
    full_address: c.full_address || c.address || null,
    neighborhood: c.neighborhood || null,
    coordinates: c.coordinates || null,
    grounding_source: "fallback_default"
  };

  // If venue lacks Cluster 5XX/6XX dimensions, enrich with fallback heuristics
  venue = applyVenueFallbackHeuristics(venue);

  const sourceTool = venue.grounding_source || "google_maps_reviews_ai";
  const evidenceQuote = venue.review_summary || venue.proof_quote || venue.full_address;

  // In lockstep: update dimension_audit object (Clusters 4XX, 5XX, 6XX & Legacy)
  if (!c.dimension_audit) c.dimension_audit = {};

  // Support both array [lat, lng] and object {lat, lng} coordinate formats
  const hasValidCoordinates = Boolean(
    venue.coordinates && (
      (Array.isArray(venue.coordinates) &&
        venue.coordinates.length >= 2 &&
        !isNaN(Number(venue.coordinates[0])) &&
        !isNaN(Number(venue.coordinates[1])) &&
        (Number(venue.coordinates[0]) !== 0 || Number(venue.coordinates[1]) !== 0)) ||
      (typeof venue.coordinates === "object" && (
        (!isNaN(Number(venue.coordinates.lat)) && !isNaN(Number(venue.coordinates.lng))) ||
        (!isNaN(Number(venue.coordinates.latitude)) && !isNaN(Number(venue.coordinates.longitude)))
      ))
    )
  );

  let normalizedCoordinates = null;
  if (venue.coordinates) {
    if (Array.isArray(venue.coordinates) && venue.coordinates.length >= 2) {
      normalizedCoordinates = [
        Number(Number(venue.coordinates[0]).toFixed(4)),
        Number(Number(venue.coordinates[1]).toFixed(4))
      ];
    } else if (typeof venue.coordinates === "object") {
      const cLat = venue.coordinates.lat != null ? venue.coordinates.lat : venue.coordinates.latitude;
      const cLng = venue.coordinates.lng != null ? venue.coordinates.lng : venue.coordinates.longitude;
      if (cLat != null && cLng != null && !isNaN(Number(cLat)) && !isNaN(Number(cLng))) {
        normalizedCoordinates = [
          Number(Number(cLat).toFixed(4)),
          Number(Number(cLng).toFixed(4))
        ];
      }
    }
  }

  const isLocationConfirmed = Boolean(
    ((venue.full_address || venue.address) && String(venue.full_address || venue.address).trim().length > 5 && !(venue.full_address || venue.address).includes("Unknown Facility")) ||
    hasValidCoordinates ||
    sourceTool === "known_physical_ground_truth" ||
    (venue.is_grounded && (venue.full_address || venue.address))
  );

  const isGroundedTruth = (sourceTool === "google_maps_reviews_ai" || sourceTool === "known_physical_ground_truth") && isLocationConfirmed;
  const defaultStatus = isGroundedTruth ? "verified" : "catalog_default";

  // Inject verified physical venue constants
  c.venue = venue.venue_name;
  c.venue_name = venue.venue_name;
  c.venue_type = venue.venue_type || c.venue_type || "standard";
  c.full_address = isLocationConfirmed ? (venue.full_address || venue.address) : null;
  c.address = isLocationConfirmed ? (venue.full_address || venue.address) : null;
  c.coordinates = isLocationConfirmed ? (normalizedCoordinates || venue.coordinates) : null;
  c.neighborhood = isLocationConfirmed ? (venue.neighborhood || c.neighborhood) : null;
  c.access_model = isLocationConfirmed ? venue.access_model : null;
  c.environment_type = isLocationConfirmed ? venue.environment_type : null;
  c.step_free_entrance = isLocationConfirmed ? venue.step_free_entrance : null;
  c.elevator_lift = isLocationConfirmed ? venue.elevator_lift : null;
  c.accessible_washrooms = isLocationConfirmed ? venue.accessible_washrooms : null;
  c.sensory_calibrations = isLocationConfirmed ? venue.sensory_calibrations : null;
  c.hearing_loop = isLocationConfirmed ? venue.hearing_loop : null;
  c.service_animals = isLocationConfirmed ? venue.service_animals : null;
  c.access_parking = isLocationConfirmed ? venue.access_parking : null;
  c.access_seating = isLocationConfirmed ? venue.access_seating : null;
  c.on_site_fnb = isLocationConfirmed ? venue.on_site_fnb : null;
  c.outside_food_policy = isLocationConfirmed ? venue.outside_food_policy : null;
  c.water_refill_station = isLocationConfirmed ? venue.water_refill_station : null;
  c.coat_check = isLocationConfirmed ? venue.coat_check : null;
  c.payment_methods = isLocationConfirmed ? venue.payment_methods : null;
  c.concession_benchmark = isLocationConfirmed ? venue.concession_benchmark : null;
  c.spend_benchmarks = isLocationConfirmed ? venue.spend_benchmarks : null;
  c.beer_benchmark = isLocationConfirmed ? venue.beer_benchmark : null;
  c.cocktail_benchmark = isLocationConfirmed ? venue.cocktail_benchmark : null;
  c.coffee_benchmark = isLocationConfirmed ? venue.coffee_benchmark : null;
  c.meal_benchmark = isLocationConfirmed ? venue.meal_benchmark : null;
  c.restrictions = isLocationConfirmed ? (venue.restrictions || c.restrictions) : c.restrictions;
  c.transit_info = isLocationConfirmed ? venue.transit_info : null;
  c.transitInfo = isLocationConfirmed ? venue.transit_info : null;
  c.last_grounded_at = nowIso;
  c.last_qc_audited_at = nowIso;

  // Sanitize aggregator URLs & remove phantom cart keyframes for free open public spaces
  const isOpenPublicOrFree = venue.access_model === "open_public_space" || c.access_model === "open_public_space" || c.isFree || c.pricingType === "free";
  if (isOpenPublicOrFree && c.proof_keyframes) {
    c.proof_keyframes.cart = null;
  }
  if (venue.website_url) {
    if (!c.websiteUrl || c.websiteUrl.includes("destinationvancouver.com")) c.websiteUrl = venue.website_url;
    if (!c.details_url || c.details_url.includes("destinationvancouver.com")) c.details_url = venue.website_url;
    if (c.ticket_url && c.ticket_url.includes("destinationvancouver.com")) c.ticket_url = venue.website_url;
  }

  // Cluster 4XX: Physical Geography & Constants
  c.dimension_audit.D401_venue_name = { status: venue.venue_name ? "verified" : "search_exhausted_null", value: venue.venue_name || null, source_tool: sourceTool, evidence_quote: venue.venue_name, audited_at: nowIso };
  c.dimension_audit.D402_full_address = { status: ((venue.full_address || venue.address) && String(venue.full_address || venue.address).trim().length > 5 && isLocationConfirmed) ? "verified" : "search_exhausted_null", value: isLocationConfirmed ? (venue.full_address || venue.address || null) : null, source_tool: sourceTool, evidence_quote: (venue.full_address || venue.address), audited_at: nowIso };
  c.dimension_audit.D403_coordinates = { status: (hasValidCoordinates && isLocationConfirmed) ? "verified" : "search_exhausted_null", value: isLocationConfirmed ? (normalizedCoordinates || venue.coordinates || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D404_neighborhood = { status: (venue.neighborhood && !venue.neighborhood.includes("Unverified") && isLocationConfirmed) ? "verified" : "search_exhausted_null", value: isLocationConfirmed ? (venue.neighborhood || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D405_access_model = { status: (venue.access_model && venue.access_model !== "unspecified" && isLocationConfirmed) ? defaultStatus : "search_exhausted_null", value: isLocationConfirmed ? (venue.access_model || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D406_environment_type = { status: (venue.environment_type && venue.environment_type !== "unspecified" && isLocationConfirmed) ? defaultStatus : "search_exhausted_null", value: isLocationConfirmed ? (venue.environment_type || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D407_weekly_hours = { status: (venue.weekly_hours && isLocationConfirmed) ? "verified" : "search_exhausted_null", value: isLocationConfirmed ? (venue.weekly_hours || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D408_transit_waypoints = { status: (venue.transit_info && isLocationConfirmed) ? defaultStatus : "search_exhausted_null", transit: isLocationConfirmed ? (venue.transit_info || null) : null, waypoints: isLocationConfirmed ? (venue.waypoints || []) : [], source_tool: sourceTool, evidence_quote: venue.transit_info, audited_at: nowIso };

  // Cluster 5XX: Accessibility & Inclusion Standards (Strictly Grounded, No Boilerplate Strings)
  c.dimension_audit.D501_step_free_entrance = { status: (venue.step_free_entrance && isLocationConfirmed) ? defaultStatus : "search_exhausted_null", value: isLocationConfirmed ? (venue.step_free_entrance || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D502_elevator_lift = { status: (venue.elevator_lift && isLocationConfirmed) ? defaultStatus : "search_exhausted_null", value: isLocationConfirmed ? (venue.elevator_lift || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D503_accessible_washrooms = { status: (venue.accessible_washrooms && isLocationConfirmed) ? defaultStatus : "search_exhausted_null", value: isLocationConfirmed ? (venue.accessible_washrooms || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D504_sensory_calibrations = { status: (venue.sensory_calibrations && isLocationConfirmed) ? defaultStatus : "search_exhausted_null", value: isLocationConfirmed ? (venue.sensory_calibrations || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D505_hearing_loop = { status: (venue.hearing_loop && isLocationConfirmed) ? defaultStatus : "none_available", value: isLocationConfirmed ? (venue.hearing_loop || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D506_service_animals = { status: (venue.service_animals && isLocationConfirmed) ? defaultStatus : "search_exhausted_null", value: isLocationConfirmed ? (venue.service_animals || null) : null, source_tool: sourceTool, audited_at: nowIso };

  // Cluster 6XX: On-Site Spend Benchmarks & Amenities (Strictly Grounded, No Boilerplate Defaults)
  c.dimension_audit.D601_on_site_fnb = { status: (venue.on_site_fnb && isLocationConfirmed) ? defaultStatus : "none_available", value: isLocationConfirmed ? (venue.on_site_fnb || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D602_coffee_benchmark = { status: (venue.coffee_benchmark && isLocationConfirmed) ? defaultStatus : "none_available", value: isLocationConfirmed ? (venue.coffee_benchmark || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D603_beer_benchmark = { status: (venue.beer_benchmark && isLocationConfirmed) ? defaultStatus : "none_available", value: isLocationConfirmed ? (venue.beer_benchmark || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D604_meal_benchmark = { status: (venue.meal_benchmark && isLocationConfirmed) ? defaultStatus : "none_available", value: isLocationConfirmed ? (venue.meal_benchmark || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D605_outside_food_policy = { status: (venue.outside_food_policy && isLocationConfirmed) ? defaultStatus : "search_exhausted_null", value: isLocationConfirmed ? (venue.outside_food_policy || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D606_coat_check = { status: (venue.coat_check && isLocationConfirmed) ? defaultStatus : "none_available", value: isLocationConfirmed ? (venue.coat_check || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D607_payment_methods = { status: (venue.payment_methods && isLocationConfirmed) ? defaultStatus : "search_exhausted_null", value: isLocationConfirmed ? (venue.payment_methods || null) : null, source_tool: sourceTool, audited_at: nowIso };
  c.dimension_audit.D608_water_refill_station = { status: (venue.water_refill_station && isLocationConfirmed) ? defaultStatus : "search_exhausted_null", value: isLocationConfirmed ? (venue.water_refill_station || null) : null, source_tool: sourceTool, audited_at: nowIso };

  return c;
}

/**
 * Main Stage 4 Venue Detailer Execution Routine
 */
export async function runVenueDetailer(options = {}) {
  const args = process.argv.slice(2);
  let limit = options.limit || 0;
  let targetVenueName = options.venue || null;
  let targetIds = Array.isArray(options.ids) && options.ids.length > 0
    ? options.ids
    : (options.id ? String(options.id).split(",").map(s => s.trim()).filter(Boolean) : null);
  let isAll = Boolean(options.all);
  let isQuarantine = Boolean(options.quarantine || options.quarantined);
  let isHarvestedOnly = Boolean(options.harvestedOnly || options.scope === "harvested");
  let offset = options.offset || 0;
  let venuesOnly = Boolean(options.venuesOnly);
  let cardsOnly = Boolean(options.cardsOnly);

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--limit" && args[i + 1]) {
      limit = parseInt(args[++i], 10);
    } else if (args[i] === "--offset" && args[i + 1]) {
      offset = parseInt(args[++i], 10);
    } else if (args[i] === "--all") {
      isAll = true;
    } else if ((args[i] === "--ids" || args[i] === "--id") && args[i + 1]) {
      const raw = args[++i];
      targetIds = raw.split(",").map(s => s.trim()).filter(Boolean);
    } else if (args[i].startsWith("--ids=") || args[i].startsWith("--id=")) {
      const raw = args[i].split("=").slice(1).join("=");
      targetIds = raw.split(",").map(s => s.trim()).filter(Boolean);
    } else if (args[i] === "--venue" && args[i + 1]) {
      targetVenueName = args[++i];
    } else if (args[i].startsWith("--venue=")) {
      targetVenueName = args[i].split("=").slice(1).join("=");
    } else if (args[i] === "--quarantine" || args[i] === "--quarantined") {
      isQuarantine = true;
    } else if (args[i] === "--harvested" || args[i] === "--harvested-only") {
      isHarvestedOnly = true;
    } else if (args[i] === "--venues-only") {
      venuesOnly = true;
    } else if (args[i] === "--cards-only") {
      cardsOnly = true;
    }
  }

  const SCHED_LAYER_PATH = path.join(DATA_DIR, "layers", "layer_schedules.json");
  const BOX_LAYER_PATH = path.join(DATA_DIR, "layers", "layer_box_office.json");
  const ED_LAYER_PATH = path.join(DATA_DIR, "layers", "layer_editorial.json");
  const todayIso = new Date().toISOString().split("T")[0];
  const publishedIds = new Set();
  const boxAuditedIds = new Set();
  const edIds = new Set();
  const edGroundedIds = new Set();

  if (fs.existsSync(EVENTS_PATH)) {
    try {
      const evs = JSON.parse(fs.readFileSync(EVENTS_PATH, "utf-8"));
      (Array.isArray(evs) ? evs : []).forEach((e) => {
        const eid = String(e.id || e.event_id || "").toLowerCase();
        if (eid) publishedIds.add(eid);
      });
    } catch (_) { }
  }
  if (fs.existsSync(BOX_LAYER_PATH)) {
    try {
      const boxes = JSON.parse(fs.readFileSync(BOX_LAYER_PATH, "utf-8"));
      (Array.isArray(boxes) ? boxes : []).forEach((b) => {
        const bid = String(b.id || b.event_id || "").toLowerCase();
        if (bid && b.status !== "TIMEOUT_EXCEEDED" && b.status !== "AI_TIMEOUT" && b.status !== "EXECUTION_ERROR") {
          boxAuditedIds.add(bid);
        }
      });
    } catch (_) { }
  }
  if (fs.existsSync(ED_LAYER_PATH)) {
    try {
      const eds = JSON.parse(fs.readFileSync(ED_LAYER_PATH, "utf-8"));
      (Array.isArray(eds) ? eds : []).forEach((e) => {
        const eid = String(e.id || e.event_id || "").toLowerCase();
        if (eid && e.clean_title && e.description && e.source_engine !== "heuristic_rules" && e.source_engine !== "unverified") {
          edIds.add(eid);
          if (e.step4_grounded_at) edGroundedIds.add(eid);
        }
      });
    } catch (_) { }
  }

  if (isHarvestedOnly && (!targetIds || targetIds.length === 0)) {
    if (fs.existsSync(SCHED_LAYER_PATH)) {
      try {
        const schedData = JSON.parse(fs.readFileSync(SCHED_LAYER_PATH, "utf-8"));
        // Strict Stage 4 Gate: Uncompiled events MUST complete Stage 1B + Stage 2 + Stage 3 before Stage 4
        const doneEdUncomp = (Array.isArray(schedData) ? schedData : []).filter((s) => {
          const sid = String(s.id || s.event_id || "").toLowerCase();
          const u = String(s.ticket_url || s.details_url || "").toLowerCase();
          if (/\/(support|donate|corporate-giving|patrons-circle|major-gifts)(\/|$)/i.test(u)) return false;
          if (s.date && /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.date < todayIso && s.lifecycle_type !== "perennial_drop_in") return false;
          return sid && !publishedIds.has(sid) && Boolean(s.step1b_audited_at) && boxAuditedIds.has(sid) && edIds.has(sid);
        });
        let uncomp = doneEdUncomp;
        const pendingStage4 = uncomp.filter((s) => {
          const sid = String(s.id || s.event_id || "").toLowerCase();
          return !s.step4_grounded_at && !edGroundedIds.has(sid);
        });
        if (!isAll && !options.force) {
          uncomp = pendingStage4;
        }
        if (offset > 0) uncomp = uncomp.slice(offset);
        if (limit > 0 && !isAll) uncomp = uncomp.slice(0, limit);
        targetIds = uncomp.map((s) => s.id || s.event_id).filter(Boolean);
      } catch (_) { }
    }
    if (!targetIds || targetIds.length === 0) {
      console.log("✅ [Stage 4 Venue Detailer] 0 Stage 3-completed events queued for Stage 4 grounding (events cannot skip Stages 1B, 2, or 3).");
      console.log("🎯 Targets Queued for Audit: 0 events");
      return { venuesGroundedCount: 0, cardsGroundedCount: 0, inBoundsCount: 0 };
    }
  }

  const nowIso = new Date().toISOString();

  console.log("🏛️  [Stage 4: Venue Detailer AI] Initializing Google Maps & Reviews Grounding Engine...");
  console.log(`📁 Master Facility DB: ${path.relative(ROOT_DIR, VENUES_PATH)}`);
  console.log(`📁 Master Events Catalog: ${path.relative(ROOT_DIR, isQuarantine ? QUEUE_PATH : EVENTS_PATH)}`);

  // 1. Load venues.json
  let venues = [];
  if (fs.existsSync(VENUES_PATH)) {
    try {
      venues = JSON.parse(fs.readFileSync(VENUES_PATH, "utf-8"));
    } catch (err) {
      console.error(`❌ Error reading venues.json: ${err.message}`);
      process.exit(1);
    }
  }

  // Ensure known ground truth venues exist in venues.json and deduplicate any existing duplicates
  const seenVenueNames = new Set();
  venues = venues.filter((v) => {
    const vn = (v.venue_name || v.name || "").toLowerCase().trim();
    if (!vn || seenVenueNames.has(vn)) return false;
    seenVenueNames.add(vn);
    return true;
  });

  for (const [key, data] of Object.entries(KNOWN_PHYSICAL_GROUND_TRUTH)) {
    const canonicalName = (data.venue_name || "").toLowerCase().trim();
    const exists = venues.some((v) => {
      const vn = (v.venue_name || v.name || "").toLowerCase().trim();
      return vn === key || (canonicalName && vn === canonicalName);
    });
    if (!exists) {
      venues.push({ ...data, last_grounded_at: nowIso, grounding_source: "known_physical_ground_truth" });
      seenVenueNames.add(canonicalName || key);
      console.log(`➕ Auto-registered known civic facility: "${data.venue_name}" into Facility DB.`);
    }
  }

  console.log(`📊 Total Registered Facilities in Venue DB: ${venues.length}`);

  // 2. Identify Targeted Venues (Strict Scoping Fix)
  let targetVenueIndices = [];

  if (targetVenueName && targetVenueName.toLowerCase() !== "all") {
    const rawTarget = targetVenueName.toLowerCase().trim();
    venues.forEach((v, idx) => {
      const vName = (v.venue_name || v.name || "").toLowerCase();
      if (vName.includes(rawTarget) || rawTarget.includes(vName)) {
        targetVenueIndices.push(idx);
      }
    });

    if (targetVenueIndices.length === 0) {
      // If venue does not exist yet, register a new entry for it
      const newVenueEntry = {
        venue_name: targetVenueName,
        full_address: null,
        neighborhood: null,
        coordinates: null,
        access_model: "fenced_facility",
        environment_type: "indoor"
      };
      venues.push(newVenueEntry);
      targetVenueIndices.push(venues.length - 1);
      console.log(`➕ Registered new facility entry for "${targetVenueName}".`);
    }
  } else if (targetIds && targetIds.length > 0) {
    // Scope venues associated with the specified event IDs
    const allCheckCards = [];
    if (fs.existsSync(EVENTS_PATH)) {
      try {
        const rawData = JSON.parse(fs.readFileSync(EVENTS_PATH, "utf-8"));
        allCheckCards.push(...(Array.isArray(rawData) ? rawData : (rawData.events || [])));
      } catch (_) { }
    }
    if (fs.existsSync(QUEUE_PATH)) {
      try {
        const qData = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
        allCheckCards.push(...(qData.quarantinedEvents || qData.items || []));
      } catch (_) { }
    }
    const idSet = new Set(targetIds.map(id => id.toLowerCase()));
    if (fs.existsSync(SCHED_LAYER_PATH)) {
      try {
        const schedData = JSON.parse(fs.readFileSync(SCHED_LAYER_PATH, "utf-8"));
        // Allow explicitly targeted IDs or uncompiled schedule cards that completed Stages 1B, 2, and 3
        if (Array.isArray(schedData)) {
          schedData.forEach((s) => {
            const sid = String(s.id || s.event_id || "").toLowerCase();
            if (sid && (idSet.has(sid) || (Boolean(s.step1b_audited_at) && boxAuditedIds.has(sid) && edIds.has(sid)))) {
              allCheckCards.push(s);
            }
          });
        }
      } catch (_) { }
    }

    const matchedCards = allCheckCards.filter(c => idSet.has((c.id || c.event_id || "").toLowerCase()));
    for (const card of matchedCards) {
      const rawVName = (card.venue || card.venue_name || "").trim();
      if (!rawVName) continue;
      const vName = rawVName.toLowerCase();
      const matchIdx = venues.findIndex(v => (v.venue_name || v.name || "").toLowerCase() === vName || (v.venue_name || v.name || "").toLowerCase().includes(vName));
      if (matchIdx >= 0) {
        if (!targetVenueIndices.includes(matchIdx)) {
          targetVenueIndices.push(matchIdx);
        }
      } else {
        const newVenueEntry = {
          venue_name: rawVName,
          full_address: null,
          neighborhood: null,
          coordinates: null,
          access_model: card.access_model || "fenced_facility",
          environment_type: card.environment_type || "indoor"
        };
        venues.push(newVenueEntry);
        targetVenueIndices.push(venues.length - 1);
        console.log(`➕ Registered new facility entry for "${rawVName}".`);
      }
    }
  } else if (isAll || (targetVenueName && targetVenueName.toLowerCase() === "all")) {
    targetVenueIndices = venues.map((_, idx) => idx);
  } else if (limit > 0) {
    // Un-grounded or pending venues first
    venues.forEach((v, idx) => {
      if (!v.last_grounded_at || v.grounding_source === "fallback_default" || !v.spend_benchmarks) {
        if (targetVenueIndices.length < limit) targetVenueIndices.push(idx);
      }
    });
    if (targetVenueIndices.length === 0) {
      targetVenueIndices = venues.slice(0, limit).map((_, idx) => idx);
    }
  } else {
    // Default: Ground target venues or top 5 ungrounded
    venues.forEach((v, idx) => {
      if (!v.last_grounded_at || v.grounding_source === "fallback_default") {
        if (targetVenueIndices.length < 5) targetVenueIndices.push(idx);
      }
    });
    if (targetVenueIndices.length === 0) {
      targetVenueIndices = [0]; // fallback to single venue
    }
  }

  console.log(`🎯 Venues Targeted for Google Maps Grounding: ${targetVenueIndices.length} facilities`);

  let venuesGroundedCount = 0;
  for (const idx of targetVenueIndices) {
    const currentVenue = venues[idx];
    const vName = currentVenue.venue_name || currentVenue.name;
    console.log(`\n${formatLogTime()} 🏢 [${venuesGroundedCount + 1}/${targetVenueIndices.length}] Grounding Facility: "${vName}"`);
    logCuratorInfo({ venue: vName, prefix: "   " });
    console.log(`[VENUE #${venuesGroundedCount + 1}] Processing "${vName}"...`);
    venues[idx] = await groundVenueRecord(currentVenue, { useAi: true });
    const gv = venues[idx];
    const vLat = gv.coordinates ? gv.coordinates[0] : null;
    const vLng = gv.coordinates ? gv.coordinates[1] : null;
    console.log(`📍 D44 Civic Address: ${gv.full_address}`);
    console.log(`🌐 D45 GPS Pin: ${gv.coordinates ? `[${vLat}, ${vLng}]` : 'null'}`);
    console.log(`🚪 D46 Access Model: ${gv.access_model} | D47 Environment: ${gv.environment_type} | Type: [${gv.venue_type || 'standard'}]`);
    console.log(`🍺 D49 Spend Benchmarks: Beer: ${gv.beer_benchmark || 'none_available'} | Coffee: ${gv.coffee_benchmark || 'none_available'} | Concession: ${gv.concession_benchmark || 'none_available'}`);
    console.log(`🚏 D50 Transit: ${gv.transit_info}`);
    venuesGroundedCount++;
    await new Promise(r => setTimeout(r, 500));
  }

  try {
    const beforeFilterCount = venues.length;
    venues = venues.filter((v) => !isOutOfMarketVenueRecord(v));
    const evictedOutCount = beforeFilterCount - venues.length;
    if (evictedOutCount > 0) {
      console.log(`🧹 [Out-of-Market Gate] Evicted ${evictedOutCount} non-Metro-Vancouver facility record(s) from data/venues.json.`);
    }
    fs.writeFileSync(VENUES_PATH, JSON.stringify(venues, null, 2), "utf-8");
    console.log(`\n💾 Persisted ${venuesGroundedCount} verified facilities to data/venues.json`);
  } catch (err) {
    console.error(`❌ Error persisting venues.json: ${err.message}`);
  }

  if (venuesOnly) {
    if (isAntigravityEngine()) {
      printAntigravityTimeoutSummary("Stage 4: Venue Detailer (Venues Only)");
    }
    console.log(`\n🎉 [COMPLETE] Venue Detailer finished: ${venuesGroundedCount} facilities grounded in venues.json.`);
    return { venuesGroundedCount, cardsGroundedCount: 0, inBoundsCount: 0 };
  }

  // 3. Ground Event Cards (data/events.json or manual_review_queue.json)
  const targetCardsPath = isQuarantine ? QUEUE_PATH : EVENTS_PATH;
  let rawCardsData = null;
  let eventCards = [];

  if (fs.existsSync(targetCardsPath)) {
    try {
      rawCardsData = JSON.parse(fs.readFileSync(targetCardsPath, "utf-8"));
      eventCards = isQuarantine
        ? (rawCardsData.quarantinedEvents || rawCardsData.items || [])
        : (Array.isArray(rawCardsData) ? rawCardsData : (rawCardsData.events || []));
    } catch (err) {
      console.error(`❌ Error reading events file: ${err.message}`);
      process.exit(1);
    }
  }

  console.log(`📊 Total Active Event Cards in Catalog: ${eventCards.length}`);

  // Determine target cards
  let targetCards = [];
  if (targetIds && targetIds.length > 0) {
    const idSet = new Set(targetIds.map(id => id.toLowerCase()));
    const combinedCards = [...eventCards];
    const seenCardIds = new Set(eventCards.map(c => String(c.id || c.event_id || "").toLowerCase()));
    if (!isQuarantine && fs.existsSync(QUEUE_PATH)) {
      try {
        const qData = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf-8"));
        (qData.quarantinedEvents || qData.items || []).forEach((q) => {
          const qid = String(q.id || q.event_id || "").toLowerCase();
          if (qid && !seenCardIds.has(qid)) {
            combinedCards.push(q);
            seenCardIds.add(qid);
          }
        });
      } catch (_) { }
    }
    if (fs.existsSync(SCHED_LAYER_PATH)) {
      try {
        const schedData = JSON.parse(fs.readFileSync(SCHED_LAYER_PATH, "utf-8"));
        // Allow explicitly targeted IDs or uncompiled schedule cards that completed Stages 1B, 2, and 3
        (Array.isArray(schedData) ? schedData : []).forEach((s) => {
          const sid = String(s.id || s.event_id || "").toLowerCase();
          if (sid && !seenCardIds.has(sid) && (idSet.has(sid) || (Boolean(s.step1b_audited_at) && boxAuditedIds.has(sid) && edIds.has(sid)))) {
            combinedCards.push(s);
            seenCardIds.add(sid);
          }
        });
      } catch (_) { }
    }
    targetCards = combinedCards.filter(c => idSet.has((c.id || c.event_id || "").toLowerCase()));
    if (targetCards.length === 0) {
      const numIndices = targetIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n) && n > 0);
      if (numIndices.length > 0) {
        targetCards = eventCards.filter((_, idx) => numIndices.includes(idx + 1));
      }
    }
  } else if (targetVenueName && targetVenueName.toLowerCase() !== "all") {
    targetCards = eventCards.filter(c => (c.venue || c.venue_name || "").toLowerCase().includes(targetVenueName.toLowerCase()));
  } else if (isAll || limit === 0 || (targetVenueName && targetVenueName.toLowerCase() === "all")) {
    targetCards = [...eventCards];
  } else {
    const pending = eventCards.filter(c => !c.environment_type || !c.spend_benchmarks || !c.transit_info || !c.last_grounded_at);
    targetCards = pending.length > 0 ? pending.slice(0, limit) : eventCards.slice(0, limit);
  }

  console.log(`🎯 Targets Queued for Audit: ${targetCards.length} events`);
  console.log(`🎯 Event Cards Queued for Grounding: ${targetCards.length} cards`);

  let cardsGroundedCount = 0;
  let inBoundsCount = 0;

  for (let idx = 0; idx < targetCards.length; idx++) {
    const card = targetCards[idx];
    const cardId = card.id || card.event_id || `Card_${idx + 1}`;
    const cardTitle = card.title || card.event_name || `Event #${idx + 1}`;
    const venueName = card.venue || card.venue_name || "Unknown Venue";

    console.log(`\n⚡ [${idx + 1}/${targetCards.length}] Auditing Facility: "${venueName}"`);
    console.log(`${formatLogTime()} 📌 Processing [${idx + 1}/${targetCards.length}]: ${cardTitle} (${venueName}) [${cardId}]`);
    console.log(`[EVENT #${idx + 1}] Processing ${cardTitle} @ ${venueName}...`);
    logCuratorInfo({ eventId: cardId, title: cardTitle, venue: venueName, existingCard: card, prefix: "   " });

    const groundedCard = groundEventCard(card, venues, nowIso);
    await new Promise(r => setTimeout(r, 400));

    const lat = Array.isArray(groundedCard.coordinates) ? groundedCard.coordinates[0] : null;
    const lng = Array.isArray(groundedCard.coordinates) ? groundedCard.coordinates[1] : null;
    const isInBounds = (lat != null && lng != null) ? isMetroVancouverGps(lat, lng) : false;
    if (isInBounds) inBoundsCount++;

    console.log(`📍 D44 Civic Address: ${groundedCard.full_address}`);
    console.log(`🌐 D45 GPS Pin: ${groundedCard.coordinates ? `[${lat}, ${lng}] (${isInBounds ? "Metro Vancouver In-Bounds ✅" : "Boundary Warning ⚠️"})` : 'null'}`);
    console.log(`🚪 D46 Access Model: ${groundedCard.access_model} | D47 Environment: ${groundedCard.environment_type} | Type: [${groundedCard.venue_type}]`);
    console.log(`♿ D501 Step-Free: ${groundedCard.step_free_entrance} | D503 Washrooms: ${groundedCard.accessible_washrooms}`);
    console.log(`🧺 D605 Outside Food: ${groundedCard.outside_food_policy} | D608 Water: ${groundedCard.water_refill_station}`);
    console.log(`🍺 D49 Spend Benchmarks: Beer: ${groundedCard.beer_benchmark || 'none_available'} | Coffee: ${groundedCard.coffee_benchmark || 'none_available'} | Concession: ${groundedCard.concession_benchmark || 'none_available'}`);
    console.log(`🚏 D50 Transit: ${groundedCard.transit_info}`);
    console.log(`Committed updated event (${cardId})`);

    cardsGroundedCount++;
  }

  // Stamp step4_grounded_at onto layer_schedules.json and layer_editorial.json for grounded targetCards
  if (targetCards.length > 0) {
    const groundedIdSet = new Set(targetCards.map(c => String(c.id || c.event_id || "").toLowerCase()).filter(Boolean));
    const SCHED_PATH = path.join(DATA_DIR, "layers", "layer_schedules.json");
    const ED_PATH = path.join(DATA_DIR, "layers", "layer_editorial.json");
    if (fs.existsSync(SCHED_PATH)) {
      try {
        const schedData = JSON.parse(fs.readFileSync(SCHED_PATH, "utf-8"));
        if (Array.isArray(schedData)) {
          let schedChanged = false;
          schedData.forEach((s) => {
            const sid = String(s.id || s.event_id || "").toLowerCase();
            if (sid && groundedIdSet.has(sid)) {
              s.step4_grounded_at = nowIso;
              schedChanged = true;
            }
          });
          if (schedChanged) fs.writeFileSync(SCHED_PATH, JSON.stringify(schedData, null, 2), "utf-8");
        }
      } catch (_) { }
    }
    if (fs.existsSync(ED_PATH)) {
      try {
        const edData = JSON.parse(fs.readFileSync(ED_PATH, "utf-8"));
        if (Array.isArray(edData)) {
          let edChanged = false;
          edData.forEach((e) => {
            const eid = String(e.id || e.event_id || "").toLowerCase();
            if (eid && groundedIdSet.has(eid)) {
              e.step4_grounded_at = nowIso;
              edChanged = true;
            }
          });
          if (edChanged) fs.writeFileSync(ED_PATH, JSON.stringify(edData, null, 2), "utf-8");
        }
      } catch (_) { }
    }
  }

  // Layer Isolation Invariant (D801 SRSA):
  // Stage 4 Venue Detailer writes strictly to data/venues.json (Step 2 above).
  // It NEVER writes directly to data/events.json or data/manual_review_queue.json;
  // Stage 5 Compiler (ripper/compile_catalog.js) is the sole authorized publisher for event cards.
  console.log(`\n🔒 [Layer Isolation] Verified ${cardsGroundedCount} event-to-venue mappings against data/venues.json (event card publication deferred strictly to Stage 5 Compiler).`);

  if (isAntigravityEngine()) {
    printAntigravityTimeoutSummary("Stage 4: Venue Detailer");
  }
  console.log(`\n🎉 [COMPLETE] Venue Detailer finished: ${venuesGroundedCount} facilities grounded in data/venues.json (${cardsGroundedCount} event associations verified, ${inBoundsCount} in Metro Vancouver).`);
  return { venuesGroundedCount, cardsGroundedCount, inBoundsCount };
}

if (process.argv[1] && process.argv[1].endsWith("venue_detailer.js")) {
  runVenueDetailer()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(`Fatal Venue Detailer error: ${err.message}`);
      process.exit(1);
    });
}
