// Van50 -- Application State Management, Multi-Filter Engine & UI Orchestration
// Strictly displays events under $50.00 CAD total out-of-pocket per person.

// 0. CORE TAXONOMY & CLUSTER CONSTANTS (Authoritative Defaults)
window.NEIGHBORHOODS = window.NEIGHBORHOODS || [
  "Downtown, Gastown & Yaletown",
  "Mount Pleasant & South Vancouver",
  "Commercial Drive & East Vancouver",
  "Kitsilano, Point Grey & UBC",
  "Granville Island & False Creek",
  "North Shore, Burnaby & Metro"
];

window.DAYS_OF_WEEK = window.DAYS_OF_WEEK || [
  { id: "all", label: "All Days", icon: "🗓️" },
  { id: "mon", label: "Mon", full: "Monday" },
  { id: "tue", label: "Tue", full: "Tuesday" },
  { id: "wed", label: "Wed", full: "Wednesday" },
  { id: "thu", label: "Thu", full: "Thursday" },
  { id: "fri", label: "Fri", full: "Friday" },
  { id: "sat", label: "Sat", full: "Saturday" },
  { id: "sun", label: "Sun", full: "Sunday" },
  { id: "daily", label: "Daily Spots", icon: "☀️" }
];

window.TIME_SLOTS = window.TIME_SLOTS || [
  { id: "all", label: "Any Time", icon: "⏰" },
  { id: "early-morning", label: "Early Morning", desc: "Before 12pm", icon: "🌅" },
  { id: "afternoon", label: "Afternoon", desc: "12pm – 5pm", icon: "☀️" },
  { id: "early-evening", label: "Early Evening", desc: "5pm – 8:30pm", icon: "🌆" },
  { id: "late-evening", label: "Late Evening", desc: "8:30pm+", icon: "🌙" }
];

window.CATEGORIES = window.CATEGORIES || [
  { id: "all", label: "All", icon: "✨" },
  { id: "free-public-access", label: "Free Public Access", icon: "🏛️" },
  { id: "music", label: "Music", icon: "🎵" },
  { id: "shows", label: "Comedy & Stage", icon: "🎭" },
  { id: "festivals", label: "Festivals", icon: "🎪" },
  { id: "markets", label: "Markets", icon: "🧺" },
  { id: "outdoors", label: "Outdoors", icon: "🌲" },
  { id: "cinema", label: "Cinema", icon: "🎬" },
  { id: "social", label: "Social & Arts", icon: "🎨" }
];

// Privacy-Preserving Anonymous Event Tracking (GoatCounter - 0 PII, Cookieless)
window.trackAnonymousEvent = function(path, title) {
  try {
    const cleanPath = (path || '').replace(/^\/+/, '').replace(/\//g, '-');
    if (window.goatcounter && typeof window.goatcounter.count === 'function') {
      window.goatcounter.count({
        path: cleanPath,
        title: title || cleanPath,
        event: true
      });
    }
  } catch (_) {
    // Fail silently - analytics must never degrade user experience
  }
};

const state = {
  minBudget: 0,
  maxBudget: 50,
  hideDaily: false,
  hideFestivalEvents: false,
  accessibleMode: false,
  accessibleOnly: false,
  category: 'all',
  frequency: 'all',
  dayOfWeek: 'all',
  timeSlot: 'all',
  selectedNeighborhoods: new Set(window.NEIGHBORHOODS),
  selectedTag: null,
  selectedVenue: null,
  searchQuery: '',
  savedEvents: new Set(),
  collapsedTimeGroups: new Set(),
  expiredCount: 0
};

// Global reference for roulette & map
window.currentFilteredEvents = [];
let ALL_EVENTS = (typeof window !== 'undefined' && (window.VAN50_EVENTS || window.VANCOUVER_EVENTS)) 
  ? (window.VAN50_EVENTS || window.VANCOUVER_EVENTS).map(normalizeActiveEvent) 
  : (typeof VAN50_EVENTS !== 'undefined' ? VAN50_EVENTS.map(normalizeActiveEvent) : []);

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  loadSavedState();
  initAccessibility();
  setupEventListeners();
  renderFestivalSpotlight();
  renderCategoryPills();
  renderDayPills();
  renderTimePills();
  renderNeighborhoodPills();
  renderFrequencyPills();
  updateSliderVisuals();
  applyFiltersAndRender();
  initVancouverMap();
  updateReviewQueueBadge();
  loadCentralReference();

  // Real-time minute interval: automatically remove cards as venue hours conclude and events end
  setInterval(() => {
    applyFiltersAndRender();
  }, 60000);
});

function resolveEventTiers(ev) {
  if (!ev) return [];
  const now = new Date();
  let rawList = [];

  if (Array.isArray(ev.ticket_tiers) && ev.ticket_tiers.length > 0) {
    rawList = ev.ticket_tiers;
  } else if (Array.isArray(ev.tiers) && ev.tiers.length > 0) {
    rawList = ev.tiers;
  } else {
    const syn = [];
    if (ev.tier_custom_name_1 && ev.tier_custom_name_1 !== 'null' && ev.tier_custom_price_1 != null && String(ev.tier_custom_price_1).toLowerCase() !== 'null') {
      syn.push({ name: ev.tier_custom_name_1, price: ev.tier_custom_price_1, status: ev.tier_custom_status_1 || null });
    }
    if (ev.price_adult != null && String(ev.price_adult).toLowerCase() !== 'null') {
      syn.push({ name: 'Adult', price: ev.price_adult });
    }
    if (ev.price_student != null && String(ev.price_student).toLowerCase() !== 'null') {
      syn.push({ name: 'Student', price: ev.price_student });
    }
    if (ev.price_member != null && String(ev.price_member).toLowerCase() !== 'null') {
      syn.push({ name: 'Member', price: ev.price_member });
    }
    if (ev.tier_custom_name_2 && ev.tier_custom_name_2 !== 'null' && ev.tier_custom_price_2 != null && String(ev.tier_custom_price_2).toLowerCase() !== 'null') {
      syn.push({ name: ev.tier_custom_name_2, price: ev.tier_custom_price_2, status: ev.tier_custom_status_2 || null });
    }
    if (ev.tier_custom_name_3 && ev.tier_custom_name_3 !== 'null' && ev.tier_custom_price_3 != null && String(ev.tier_custom_price_3).toLowerCase() !== 'null') {
      syn.push({ name: ev.tier_custom_name_3, price: ev.tier_custom_price_3, status: ev.tier_custom_status_3 || null });
    }
    if (ev.tier_custom_name_4 && ev.tier_custom_name_4 !== 'null' && ev.tier_custom_price_4 != null && String(ev.tier_custom_price_4).toLowerCase() !== 'null') {
      syn.push({ name: ev.tier_custom_name_4, price: ev.tier_custom_price_4, status: ev.tier_custom_status_4 || null });
    }
    if (ev.tier_custom_name_5 && ev.tier_custom_name_5 !== 'null' && ev.tier_custom_price_5 != null && String(ev.tier_custom_price_5).toLowerCase() !== 'null') {
      syn.push({ name: ev.tier_custom_name_5, price: ev.tier_custom_price_5, status: ev.tier_custom_status_5 || null });
    }
    if (syn.length === 0 && ev.pricing_all_in_cad && typeof ev.pricing_all_in_cad === 'object') {
      const p = ev.pricing_all_in_cad;
      if (p.regular != null && String(p.regular).toLowerCase() !== 'null') syn.push({ name: 'Adult', price: Number(p.regular) });
      if (p.senior != null && String(p.senior).toLowerCase() !== 'null') syn.push({ name: 'Senior (65+)', price: Number(p.senior) });
      if (p.student != null && String(p.student).toLowerCase() !== 'null') syn.push({ name: 'Student', price: Number(p.student) });
      if (p.member != null && String(p.member).toLowerCase() !== 'null') syn.push({ name: 'Member', price: Number(p.member) });
    }
    rawList = syn;
  }

  // Filter out any invalid or null tiers
  rawList = (rawList || []).filter(t => {
    if (!t) return false;
    const nameStr = String(t.name || '').trim().toLowerCase();
    if (!nameStr || nameStr === 'null' || nameStr === 'undefined') return false;
    if (t.price === null || t.price === undefined || String(t.price).toLowerCase() === 'null') return false;
    return !isNaN(Number(t.price));
  });

  if (rawList.length === 0) return [];

  return rawList.map(t => {
    const rawPrice = t.price !== undefined ? t.price : (t.total !== undefined ? t.total : 0);
    const pNum = Number(rawPrice) || 0;
    const nameStr = String(t.name || 'Admission').trim();
    let status = t.status ? String(t.status).toLowerCase().trim() : null;

    const lowerName = nameStr.toLowerCase();
    if (!status) {
      if (ev.is_sold_out || ev.isSoldOut || /sold\s*out|full|capacity/i.test(lowerName)) {
        status = 'sold_out';
      } else if (/presale\s*ended|early\s*bird\s*ended|ended|past|expired/i.test(lowerName)) {
        status = 'expired';
      } else if (/door\s*only|at\s*door|cash\s*at\s*door/i.test(lowerName)) {
        status = 'door_only';
      } else {
        status = 'available';
      }
    }

    if (t.available_until) {
      try {
        const untilDate = new Date(t.available_until);
        if (!isNaN(untilDate.getTime()) && untilDate < now && status === 'available') {
          status = 'expired';
        }
      } catch (_) {}
    }

    const isAvailable = (status === 'available');
    const isDoor = (status === 'door_only' || /door/i.test(lowerName));
    const isSoldOut = (status === 'sold_out');
    const isExpired = (status === 'expired');

    const cleanName = nameStr.replace(/\s*\((sold out|ended|door only|presale ended)\)/i, '').trim();
    const label = pNum === 0 ? 'Free ($0)' : `$${pNum.toFixed(2)} CAD`;

    return {
      name: cleanName || nameStr,
      rawName: nameStr,
      price: pNum,
      label,
      status,
      isAvailable,
      isDoor,
      isSoldOut,
      isExpired
    };
  });
}

function sanitizeMojibake(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/â€“/g, '–')
    .replace(/â€”/g, '—')
    .replace(/â€™/g, "'")
    .replace(/â€˜/g, "'")
    .replace(/â€œ/g, '"')
    .replace(/â€\x9d/g, '"')
    .replace(/â€ /g, '"')
    .replace(/â€¦/g, '…')
    .replace(/â„¢/g, '™')
    .replace(/â€¢/g, '•')
    .replace(/Ã˜/g, 'Ø')
    .replace(/Ã¸/g, 'ø')
    .replace(/Ã¤/g, 'ä')
    .replace(/Ã©/g, 'é')
    .replace(/Ã¨/g, 'è')
    .replace(/Ã¼/g, 'ü')
    .replace(/Ã±/g, 'ñ');
}

function normalizeActiveEvent(item) {
  if (!item) return item;

  const price = (item.pricing_all_in_cad && item.pricing_all_in_cad.regular !== undefined && item.pricing_all_in_cad.regular !== null)
    ? Number(item.pricing_all_in_cad.regular)
    : Number(item.price || 0.0);

  const show1 = item.show_1 || {};
  const show2 = item.show_2 || {};
  const show3 = item.show_3 || {};

  let showings = Array.isArray(item.showings) ? item.showings : [];
  if (showings.length === 0) {
    showings = [show1, show2, show3].filter(s => s && s.date);
  }
  const confirmedDates = showings.length > 0
    ? showings.map(s => s.date).filter(Boolean)
    : [show1.date, show2.date, show3.date].filter(Boolean);

  const catRaw = (item.category || "shows").toLowerCase();
  const isFreePublic = catRaw.includes("public access") || catRaw.includes("free public") || catRaw === "free-public-access" || item.lifecycle_type === "perennial_drop_in" || item.lifecycleType === "perennial_drop_in";

  const evTitle = sanitizeMojibake(item.event_name || item.title || "Event");
  const hasFestivalAffiliation = Boolean(item.festival_affiliation && item.festival_affiliation !== "None" && item.festival_affiliation !== "");
  const isFest = Boolean(
    hasFestivalAffiliation ||
    catRaw.includes("festival") ||
    evTitle.toLowerCase().includes("viff") ||
    evTitle.toLowerCase().includes("festival") ||
    (Array.isArray(item.tags) && item.tags.some(t => String(t).toLowerCase().includes("festival") || String(t).toLowerCase().includes("viff")))
  );

  let dateSchedule = "Upcoming";
  const opHours = sanitizeMojibake(item.operating_hours || item.open_hours || item.hours || item.operatingHours || "");
  const wh = item.weekly_hours || item.weeklyHours || null;

  if (isFreePublic) {
    if (wh) {
      dateSchedule = "Visiting Hours (See 7-Day Schedule Below)";
    } else if (opHours) {
      dateSchedule = `Visiting Hours: ${opHours}`;
    } else if (show1.start_time && show1.end_time) {
      dateSchedule = `Open: ${show1.start_time} – ${show1.end_time}`;
    } else {
      dateSchedule = "Open Daily to the Public";
    }
  } else if (showings.length > 1) {
    const isFilm = (catRaw.includes("cinema") || catRaw.includes("film") || isFest);
    dateSchedule = isFilm ? `${showings.length} Screenings across Vancouver` : `${showings.length} Dates Scheduled`;
  } else if (show1.date) {
    const dObj = new Date(show1.date.length === 10 ? show1.date + 'T12:00:00' : show1.date);
    const dateLabel = !isNaN(dObj.getTime())
      ? dObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : show1.date;
    dateSchedule = dateLabel;
    if (show1.start_time) dateSchedule += ` at ${show1.start_time}`;
    if (confirmedDates.length > 1) {
      dateSchedule += ` (+${confirmedDates.length - 1} showings)`;
    }
  }

  // Multi-Category Taxonomy Resolution
  const tagsStr = (Array.isArray(item.tags) ? item.tags.join(" ") : String(item.tags || "")).toLowerCase();
  const titleLower = evTitle.toLowerCase();
  const venueLower = (item.venue_name || item.venue || "").toLowerCase();
  const descLower = (item.description || "").toLowerCase();
  const combinedContext = `${catRaw} ${tagsStr} ${titleLower} ${venueLower} ${descLower}`;

  const tagsArray = tagsStr.split(/\s+/).filter(Boolean);
  const isIndoorShow = tagsArray.some(t => ['comedy', 'improv', 'stand-up', 'theatre', 'opera', 'burlesque', 'music', 'live-music', 'concert'].includes(t)) && !/(pitch & putt|football|basketball)/i.test(titleLower);

  const isCinema = (
    catRaw.includes("cinema") ||
    tagsArray.some(t => ['cinema', 'film', 'movie', 'screening', 'film-screening'].includes(t)) ||
    venueLower.includes("cinematheque") ||
    venueLower.includes("fifth avenue cinema") ||
    /\b(screening|35mm|kwaidan|pulse|hello destroyer|past future|all the lovers in the night|silent movie|ski film)\b/i.test(titleLower) ||
    (titleLower.includes("viff") && !titleLower.includes("volunteer"))
  ) && !(tagsArray.includes("orchestral") && titleLower.includes("symphony") && !titleLower.includes("silent movie"))
    && !tagsArray.some(t => ['comedy', 'stand-up', 'burlesque', 'improv'].includes(t));

  const isOutdoors = !isIndoorShow && (
    catRaw.includes("outdoor") ||
    catRaw.includes("outdoors") ||
    catRaw.includes("sport") ||
    catRaw.includes("fitness") ||
    item.access_model === "open_public_space" ||
    tagsArray.some(t => ['outdoor', 'outdoors', 'sport', 'fitness', 'walk', 'nature', 'park', 'beach', 'seawall', 'trail', 'golf', 'pitch-putt', 'garden'].includes(t)) ||
    /\b(seawall|waterfront promenade|boardwalk|quarry gardens|pitch & putt|bloedel conservatory|vandusen|harvest days|apple festival|miniature train|thunderbird stadium|war memorial gym)\b/i.test(combinedContext) ||
    (/\b(stanley park|queen elizabeth park|dr\. sun yat-sen|canada place|the shipyards|granville island public market)\b/i.test(combinedContext) && !venueLower.includes("park theatre"))
  ) && !titleLower.includes("babes in canyon") && !titleLower.includes("croissant crawl");

  const isMusic = (
    catRaw.includes("music") ||
    /music|concert|band|jazz|orchestra|metal|punk|symphony|dj|dance-party|dance|disco|techno|house-music|house|electronic|vinyl|nightlife|club-night|hip-hop|r&b|funk/.test(tagsStr) ||
    /jazz|blues|orchestra|concert|metal|punk|symphony|strings|vso|dj|dance party|dance night|techno|disco|funk|synth-pop|electronic|house music|groove|indie rock|post-punk/.test(titleLower)
  );

  const isShows = (
    catRaw.includes("show") ||
    catRaw.includes("comedy") ||
    catRaw.includes("theatre") ||
    catRaw.includes("stage") ||
    /comedy|improv|stand-up|burlesque|theatre|opera|stage play/.test(combinedContext) ||
    (/cabaret|showcase/.test(combinedContext) && !/dance-party|dance party|dj|dance night|disco/.test(tagsStr + " " + titleLower))
  ) && !/dance party|dance-party|dance night/.test(titleLower + " " + tagsStr);

  const isMarkets = (
    catRaw.includes("market") ||
    /market|bazaar|croissant crawl/.test(combinedContext)
  );

  const isSocialArts = (
    catRaw.includes("art") ||
    catRaw.includes("social") ||
    catRaw.includes("culture") ||
    /art|social|culture|craft|trivia|board-game|gallery/.test(combinedContext) ||
    // Films shown in cultural, art-house, or archival series (e.g. Kwaidan, Pulse, VIFF, Cinematheque) belong to both Cinema and Social & Arts
    isCinema
  );

  // Build ev.categories array (multi-category assignment)
  const categories = [];
  if (isCinema && !categories.includes("cinema")) categories.push("cinema");
  if (isOutdoors && !categories.includes("outdoors")) categories.push("outdoors");
  if (isFreePublic && !categories.includes("free-public-access")) categories.push("free-public-access");
  if (isMusic && !categories.includes("music")) categories.push("music");
  if (isShows && !categories.includes("shows")) categories.push("shows");
  if (isMarkets && !categories.includes("markets")) categories.push("markets");
  if (isSocialArts && !categories.includes("social")) categories.push("social");
  if (isFest && !categories.includes("festivals")) categories.push("festivals");

  if (categories.length === 0) {
    categories.push(isFreePublic ? "free-public-access" : "shows");
  }

  // Determine primary category for badge display
  let cat = categories[0];
  if (isCinema) cat = "cinema";
  else if (isOutdoors && (catRaw.includes("sport") || item.access_model === "open_public_space")) cat = "outdoors";
  else if (isFreePublic) cat = "free-public-access";
  else if (isMusic) cat = "music";
  else if (isMarkets) cat = "markets";
  else if (isOutdoors) cat = "outdoors";
  else if (isShows) cat = "shows";
  else if (isSocialArts) cat = "social";

  // Calculate actual day-of-week codes (mon, tue, wed, etc.) - NEVER default to ['daily'] for timed events
  const DAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  let daysOfWeek = [];
  if (isFreePublic) {
    daysOfWeek = ["daily", "mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  } else {
    const daySet = new Set();
    confirmedDates.forEach(dStr => {
      const d = new Date(dStr.length === 10 ? dStr + 'T12:00:00' : dStr);
      if (!isNaN(d.getTime())) daySet.add(DAY_CODES[d.getDay()]);
    });
    if (item.days_open && typeof item.days_open === 'string') {
      item.days_open.split(/[,-]/).forEach(p => {
        const clean = p.trim().toLowerCase().slice(0, 3);
        if (DAY_CODES.includes(clean)) daySet.add(clean);
      });
    }
    daysOfWeek = Array.from(daySet);
    if (daysOfWeek.length === 0) {
      daysOfWeek = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    }
  }

  const finalPrice = isFreePublic ? 0.0 : price;

  const res = {
    id: item.event_id || item.id || `ev-${Math.random().toString(36).substring(2, 9)}`,
    title: evTitle,
    artist: item.artist || null,
    venue: item.venue_name || item.venue || "Vancouver Venue",
    address: item.full_address || item.address || "Vancouver, BC",
    neighborhood: item.neighborhood || "Vancouver",
    price: finalPrice,
    priceLabel: finalPrice === 0 ? "Free ($0)" : `$${finalPrice.toFixed(2)} CAD`,
    pricingType: finalPrice === 0 ? "free" : "paid",
    isFree: finalPrice === 0,
    frequency: isFreePublic ? "daily" : (confirmedDates.length > 1 ? "limited-run" : "one-off"),
    frequencyLabel: isFreePublic ? "Open Daily Drop-In" : (confirmedDates.length > 1 ? "Verified Multiple Showings" : "Single Showing"),
    daysOfWeek: daysOfWeek,
    timeSlots: isFreePublic ? ["early-morning", "afternoon", "early-evening"] : ["early-evening", "late-evening"],
    category: cat,
    categories: categories,
    categoryLabel: isFreePublic ? "Free Public Access" : (item.category || "Shows & Arts"),
    categoryIcon: isFreePublic ? "🏛️" : (cat === "outdoors" ? "🌊" : (cat === "music" ? "🎵" : (cat === "cinema" ? "🎬" : "🎭"))),
    subTags: Array.isArray(item.tags) ? item.tags : (item.subTags || []),
    dateSchedule: dateSchedule,
    startIso: (!isFreePublic && (showings[0]?.date || show1.date)) ? `${showings[0]?.date || show1.date}T${showings[0]?.start_time || show1.start_time || "19:00"}:00-07:00` : (item.startIso || null),
    endIso: (show1.date && show1.end_time) ? `${show1.date}T${show1.end_time}:00-07:00` : null,
    confirmedDates: confirmedDates,
    showings: showings,
    isSoldOut: Boolean(item.is_sold_out || item.isSoldOut),
    is_sold_out: Boolean(item.is_sold_out || item.isSoldOut),
    isFestival: isFest,
    festivalAffiliation: (hasFestivalAffiliation ? item.festival_affiliation : (isFest ? (item.festival_affiliation || "VIFF") : null)),
    websiteUrl: item.ticket_url || item.details_url || item.discovery_url || item.websiteUrl || "#",
    venueUrl: item.details_url || item.websiteUrl || "#",
    ticketProvider: item.ticket_provider || item.ticketProvider || (isFreePublic ? "Free Public Access" : "Direct"),
    rawProvider: item.ticket_provider || (isFreePublic ? "Free Public Access" : "Direct"),
    coordinates: [49.2827, -123.1207],
    transitInfo: "Transit accessible via TransLink SkyTrain / bus service",
    description: item.description || "",
    operatingHours: opHours || null,
    weekly_hours: wh,
    weeklyHours: wh,
    lifecycleType: item.lifecycle_type || item.lifecycleType || (isFreePublic ? "perennial_drop_in" : "time_bound_event"),
    checkoutVerification: {
      status: "verified_live",
      method: "gemini_fee_computation",
      verifiedTotal: price
    },
    repeatShowings: {
      show_1: show1,
      show_2: item.show_2,
      show_3: item.show_3
    },
    approvalStatus: item.approval_status || "Auto-Approved",
    curatorNotes: item.curator_notes || "",
    featured_exhibition: item.featured_exhibition || null,
    pricing_model: item.pricing_model || null,
    access_model: item.access_model || null,
    food_service_type: item.food_service_type || null,
    food_service_note: sanitizeMojibake(item.food_service_note || null),
    drink_benchmark: sanitizeMojibake(item.drink_benchmark || null),
    concession_benchmark: sanitizeMojibake(item.concession_benchmark || null),
    typical_item_spend: sanitizeMojibake(item.typical_item_spend || null),
    sample_cost_label: sanitizeMojibake(item.sample_cost_label || null),
    coffee_benchmark: sanitizeMojibake(item.coffee_benchmark || null),
    meal_benchmark: sanitizeMojibake(item.meal_benchmark || null),
    price_adult: item.price_adult !== undefined ? item.price_adult : null,
    price_student: item.price_student !== undefined ? item.price_student : null,
    price_member: item.price_member !== undefined ? item.price_member : null,
    tier_custom_name_1: item.tier_custom_name_1 || null,
    tier_custom_price_1: item.tier_custom_price_1 !== undefined && item.tier_custom_price_1 !== null ? Number(item.tier_custom_price_1) : null,
    tier_custom_name_2: item.tier_custom_name_2 || null,
    tier_custom_price_2: item.tier_custom_price_2 !== undefined && item.tier_custom_price_2 !== null ? Number(item.tier_custom_price_2) : null,
    tier_custom_name_3: item.tier_custom_name_3 || null,
    tier_custom_price_3: item.tier_custom_price_3 !== undefined && item.tier_custom_price_3 !== null ? Number(item.tier_custom_price_3) : null,
    tier_custom_name_4: item.tier_custom_name_4 || null,
    tier_custom_price_4: item.tier_custom_price_4 !== undefined && item.tier_custom_price_4 !== null ? Number(item.tier_custom_price_4) : null,
    tier_custom_name_5: item.tier_custom_name_5 || null,
    tier_custom_price_5: item.tier_custom_price_5 !== undefined && item.tier_custom_price_5 !== null ? Number(item.tier_custom_price_5) : null,
    ticket_tiers: Array.isArray(item.ticket_tiers) ? item.ticket_tiers : null
  };

  const tiers = resolveEventTiers(res);
  res.tiers = tiers;

  // Recalculate dynamic effective price if active available tiers exist
  if (!isFreePublic && tiers.length > 0) {
    const activeTiers = tiers.filter(t => t.isAvailable && t.price <= 50);
    if (activeTiers.length > 0 && !item.is_sold_out && !item.isSoldOut) {
      const minAvailable = Math.min(...activeTiers.map(t => t.price));
      res.price = minAvailable;
      res.priceLabel = minAvailable === 0 ? "Free ($0)" : `$${minAvailable.toFixed(2)} CAD`;
      res.isSoldOut = false;
      res.is_sold_out = false;
    } else {
      const allDone = tiers.every(t => t.isSoldOut || t.isExpired);
      if (allDone || item.is_sold_out || item.isSoldOut) {
        res.isSoldOut = true;
        res.is_sold_out = true;
        res.priceLabel = (tiers.some(t => t.isSoldOut) || item.is_sold_out || item.isSoldOut) ? "Sold Out" : "Presale Ended";
      }
    }
  }

  return res;
}

// Asynchronously load central reference data feed (data/events.json)
async function loadCentralReference() {
  let loadedEvents = null;
  let updatedAt = null;

  // 1. Load clean events.json
  try {
    const res = await fetch(`data/events.json?v=7.0.0&t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) {
      const text = await res.text();
      const cleanText = text.replace(/^\uFEFF/, '');
      const data = JSON.parse(cleanText);
      const rawList = Array.isArray(data) ? data : (data.events || []);
      if (rawList.length > 0) {
        loadedEvents = rawList.map(normalizeActiveEvent);
      }
      if (data.metadata && data.metadata.updatedAt) {
        updatedAt = data.metadata.updatedAt;
      }
    }
  } catch (err) {
    console.warn('Failed to parse data/events.json:', err);
  }

  // Robust fallback to offline embedded data.js (window.VAN50_EVENTS)
  if (!loadedEvents || loadedEvents.length === 0) {
    const fallbackList = (typeof window !== 'undefined' && (window.VAN50_EVENTS || window.VANCOUVER_EVENTS)) 
      || (typeof VAN50_EVENTS !== 'undefined' ? VAN50_EVENTS : null);
    if (Array.isArray(fallbackList) && fallbackList.length > 0) {
      loadedEvents = fallbackList.map(normalizeActiveEvent);
      console.log(`Using offline reference sheet (${loadedEvents.length} events).`);
    }
  }

  if (loadedEvents && loadedEvents.length > 0) {
    ALL_EVENTS = loadedEvents;
    window.VANCOUVER_EVENTS = loadedEvents;
    window.VAN50_EVENTS = loadedEvents;
    if (updatedAt) {
      state.updatedAt = updatedAt;
      showSyncTimestamp(updatedAt, loadedEvents.length);
    }
    renderFestivalSpotlight();
    applyFiltersAndRender();
  }

  // Also load venues.json to enrich venue calendar & details
  try {
    const vRes = await fetch(`data/venues.json?v=2.0.0&t=${Date.now()}`, { cache: 'no-store' });
    if (vRes.ok) {
      const vList = await vRes.json();
      if (Array.isArray(vList)) {
        window.VENUES = vList;
        window.VENUES_MASTER = vList;
      }
    }
  } catch (e) {}

  // Also load festivals.json
  try {
    const fRes = await fetch(`data/festivals.json?v=2.0.0&t=${Date.now()}`, { cache: 'no-store' });
    if (fRes.ok) {
      const fList = await fRes.json();
      if (Array.isArray(fList)) {
        window.FESTIVALS = fList;
      }
    }
  } catch (e) {}


  // Also load quarantined manual review queue
  try {
    const rqRes = await fetch('data/manual_review_queue.json?v=5.2.2');
    if (rqRes.ok) {
      const rqData = await rqRes.json();
      if (rqData.quarantinedEvents) {
        window.MANUAL_REVIEW_QUEUE = rqData.quarantinedEvents;
        updateReviewQueueBadge();
      }
    }
  } catch (err) {
    console.log('Using offline embedded review queue.');
  }
}


function showSyncTimestamp(isoStr, count) {
  const badge = document.getElementById('sync-status-badge');
  if (badge) badge.style.display = 'none';
  const badgeText = document.getElementById('sync-status-text');
  if (badgeText) badgeText.style.display = 'none';
}

// ==============================================================================
// 1. FILTER CONTROLS & DUAL SLIDER
// ==============================================================================

function setupEventListeners() {
  // Accessibility Mode Toggle
  const accessBtn = document.getElementById('accessibility-btn');
  if (accessBtn) {
    accessBtn.addEventListener('click', () => {
      toggleAccessibilityMode();
      window.trackAnonymousEvent('preference/accessible-mode', 'Toggle Accessible Mode');
    });
  }

  // Delegated listener for Outbound Ticket & Event Link clicks
  document.addEventListener('click', (e) => {
    const ctaBtn = e.target.closest('.btn-ticket-cta');
    if (ctaBtn) {
      const card = ctaBtn.closest('.event-card');
      const eventId = ctaBtn.dataset.eventId || (card ? card.id.replace(/^card-/, '') : null);
      const ev = eventId ? (window.currentActiveCatalog || ALL_EVENTS).find(item => item.id === eventId) : null;
      const eventTitle = ctaBtn.dataset.eventTitle || (ev ? ev.title : 'Event');
      const eventVenue = ctaBtn.dataset.eventVenue || (ev ? ev.venue : '');
      const label = eventVenue ? `${eventTitle} (${eventVenue})` : eventTitle;
      const pathKey = eventId ? `tickets/${eventId}` : 'tickets/external';
      window.trackAnonymousEvent(pathKey, `Tickets: ${label}`);
    }
  });

  // Search input & interactive controls
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('btn-clear-search');
  const tipsToggleBtn = document.getElementById('btn-search-tips-toggle');
  const tipsPopover = document.getElementById('search-tips-popover');
  const closeTipsBtn = document.getElementById('btn-close-tips');

  function updateClearBtnVisibility() {
    if (clearSearchBtn) {
      clearSearchBtn.style.display = (searchInput && searchInput.value.trim().length > 0) ? 'inline-flex' : 'none';
    }
  }

  if (searchInput) {
    const _urlParams = new URLSearchParams(window.location.search);
    const _qParam = _urlParams.get('search') || _urlParams.get('q');
    if (_qParam) {
      searchInput.value = _qParam;
      state.searchQuery = _qParam.trim();
      updateClearBtnVisibility();
    }

    const _catParam = _urlParams.get('category') || _urlParams.get('cat');
    if (_catParam) {
      state.category = _catParam.trim();
    }

    const _hideDailyParam = _urlParams.get('hideDaily') || _urlParams.get('showsOnly');
    if (_hideDailyParam === '1' || _hideDailyParam === 'true') {
      state.hideDaily = true;
      const hideDailyToggle = document.getElementById('hide-daily-toggle');
      if (hideDailyToggle) hideDailyToggle.checked = true;
    }

    if (_urlParams.has('expandTiers') || _urlParams.get('expandTiers') === '1') {
      setTimeout(() => {
        const p = document.querySelector('.price-box-interactive');
        if (p) p.click();
      }, 600);
    }

    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.trim();
      updateClearBtnVisibility();
      applyFiltersAndRender();
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      state.searchQuery = '';
      updateClearBtnVisibility();
      applyFiltersAndRender();
    });
  }

  if (tipsToggleBtn && tipsPopover) {
    tipsToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = tipsPopover.style.display !== 'none';
      if (isVisible) {
        tipsPopover.style.display = 'none';
        tipsToggleBtn.classList.remove('active');
        tipsToggleBtn.setAttribute('aria-expanded', 'false');
      } else {
        tipsPopover.style.display = 'block';
        tipsToggleBtn.classList.add('active');
        tipsToggleBtn.setAttribute('aria-expanded', 'true');
      }
    });
  }

  if (closeTipsBtn && tipsPopover && tipsToggleBtn) {
    closeTipsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      tipsPopover.style.display = 'none';
      tipsToggleBtn.classList.remove('active');
      tipsToggleBtn.setAttribute('aria-expanded', 'false');
    });
  }

  // Dismiss search tips on outside click
  document.addEventListener('click', (e) => {
    if (tipsPopover && tipsPopover.style.display !== 'none') {
      if (!tipsPopover.contains(e.target) && !tipsToggleBtn.contains(e.target)) {
        tipsPopover.style.display = 'none';
        if (tipsToggleBtn) {
          tipsToggleBtn.classList.remove('active');
          tipsToggleBtn.setAttribute('aria-expanded', 'false');
        }
      }
    }
  });

  // Global search sample applicator
  window.applySearchSample = function(sampleQuery) {
    if (searchInput) {
      searchInput.value = sampleQuery;
      searchInput.focus();
    }
    state.searchQuery = sampleQuery;
    updateClearBtnVisibility();
    if (tipsPopover) tipsPopover.style.display = 'none';
    if (tipsToggleBtn) {
      tipsToggleBtn.classList.remove('active');
      tipsToggleBtn.setAttribute('aria-expanded', 'false');
    }
    applyFiltersAndRender();
  };

  // Dual Spend Range Slider
  const minSlider = document.getElementById('min-spend-slider');
  const maxSlider = document.getElementById('max-spend-slider');

  if (minSlider && maxSlider) {
    minSlider.addEventListener('input', () => {
      let minVal = parseInt(minSlider.value);
      let maxVal = parseInt(maxSlider.value);
      if (minVal > maxVal) {
        minSlider.value = maxVal;
        minVal = maxVal;
      }
      state.minBudget = minVal;
      updateSliderVisuals();
      clearActiveQuickButtons();
      applyFiltersAndRender();
    });

    maxSlider.addEventListener('input', () => {
      let minVal = parseInt(minSlider.value);
      let maxVal = parseInt(maxSlider.value);
      if (maxVal < minVal) {
        maxSlider.value = minVal;
        maxVal = minVal;
      }
      state.maxBudget = maxVal;
      updateSliderVisuals();
      clearActiveQuickButtons();
      applyFiltersAndRender();
    });
  }

  // Quick Cost Presets (Free, Paid, All)
  const quickButtons = document.querySelectorAll('.cost-quick-btn');
  quickButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      quickButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const preset = btn.dataset.quick;

      if (preset === 'all') {
        state.minBudget = 0;
        state.maxBudget = 50;
      } else if (preset === 'free') {
        state.minBudget = 0;
        state.maxBudget = 0;
      } else if (preset === 'paid') {
        state.minBudget = 1;
        state.maxBudget = 50;
      }

      if (minSlider) minSlider.value = state.minBudget;
      if (maxSlider) maxSlider.value = state.maxBudget;
      updateSliderVisuals();
      applyFiltersAndRender();
    });
  });

  // Scheduled Only Toggle
  const hideDailyToggle = document.getElementById('hide-daily-toggle');
  if (hideDailyToggle) {
    hideDailyToggle.addEventListener('change', (e) => {
      state.hideDaily = e.target.checked;
      applyFiltersAndRender();
    });
  }

  // Wheelchair Accessible Only Toggle
  const chkAccessibleOnly = document.getElementById('chk-accessible-only');
  if (chkAccessibleOnly) {
    chkAccessibleOnly.addEventListener('change', (e) => {
      state.accessibleOnly = Boolean(e.target.checked);
      applyFiltersAndRender();
    });
  }

  // View Switcher (Cards vs Map)
  const viewCardsBtn = document.getElementById('view-cards-btn');
  const viewMapBtn = document.getElementById('view-map-btn');
  const eventsGrid = document.getElementById('events-grid');
  const mapWrapper = document.getElementById('map-view-wrapper');

  if (viewCardsBtn && viewMapBtn && eventsGrid && mapWrapper) {
    viewCardsBtn.addEventListener('click', () => {
      viewCardsBtn.classList.add('active');
      viewMapBtn.classList.remove('active');
      eventsGrid.style.display = 'grid';
      mapWrapper.style.display = 'none';
      mapWrapper.classList.remove('active');
    });

    viewMapBtn.addEventListener('click', () => {
      viewMapBtn.classList.add('active');
      viewCardsBtn.classList.remove('active');
      eventsGrid.style.display = 'none';
      mapWrapper.style.display = 'block';
      mapWrapper.classList.add('active');

      const getActiveEvents = () => {
        if (window.currentFilteredEvents && window.currentFilteredEvents.length > 0) {
          return window.currentFilteredEvents;
        }
        return ALL_EVENTS || [];
      };

      if (!window.vancouverMapInstance && typeof initVancouverMap === 'function') {
        initVancouverMap();
      }

      // Allow container to finish layout reflow before invalidating Leaflet size
      requestAnimationFrame(() => {
        setTimeout(() => {
          if (window.vancouverMapInstance) {
            window.vancouverMapInstance.invalidateSize();
          }
          if (typeof updateMapMarkers === 'function') {
            updateMapMarkers(getActiveEvents());
          }
          if (window._pendingMapBounds && window.vancouverMapInstance) {
            try {
              window.vancouverMapInstance.fitBounds(window._pendingMapBounds, { padding: [40, 40], maxZoom: 15 });
              window._pendingMapBounds = null;
            } catch (e) {}
          }
        }, 60);
      });
    });
  }

  // Neighborhood Toggle All
  const toggleAllNhBtn = document.getElementById('btn-toggle-all-neighborhoods');
  if (toggleAllNhBtn && typeof NEIGHBORHOODS !== 'undefined') {
    toggleAllNhBtn.addEventListener('click', () => {
      if (state.selectedNeighborhoods.size === NEIGHBORHOODS.length) {
        state.selectedNeighborhoods.clear();
        toggleAllNhBtn.textContent = 'Select All';
      } else {
        state.selectedNeighborhoods = new Set(NEIGHBORHOODS);
        toggleAllNhBtn.textContent = 'Deselect All';
      }
      renderNeighborhoodPills();
      applyFiltersAndRender();
    });
  }

  // Surprise Outing Roulette Handlers
  const openRouletteBtn = document.getElementById('roulette-btn');
  const closeRouletteBtn = document.getElementById('close-roulette-modal');
  const modal = document.getElementById('roulette-modal');

  if (openRouletteBtn && modal) {
    openRouletteBtn.addEventListener('click', () => {
      modal.classList.add('active');
      if (typeof window.initRouletteMachine === 'function') {
        window.initRouletteMachine();
      }
    });
  }

  if (closeRouletteBtn && modal) {
    closeRouletteBtn.addEventListener('click', () => {
      modal.classList.remove('active');
    });
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  }

  // More Filters Collapsible Toggle
  const toggleMoreBtn = document.getElementById('btn-toggle-more-filters');
  const morePanel = document.getElementById('more-filters-panel');
  if (toggleMoreBtn && morePanel) {
    toggleMoreBtn.addEventListener('click', () => {
      const isHidden = morePanel.style.display === 'none';
      if (isHidden) {
        morePanel.style.display = 'flex';
        morePanel.classList.add('active');
        toggleMoreBtn.classList.add('active');
        toggleMoreBtn.setAttribute('aria-expanded', 'true');
      } else {
        morePanel.style.display = 'none';
        morePanel.classList.remove('active');
        toggleMoreBtn.classList.remove('active');
        toggleMoreBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // Itinerary Drawer Handlers
  const itineraryBtn = document.getElementById('itinerary-btn');
  const closeItineraryBtn = document.getElementById('close-itinerary-btn');
  const drawer = document.getElementById('itinerary-drawer');
  const copyPlanBtn = document.getElementById('copy-plan-btn');

  if (itineraryBtn && drawer) {
    itineraryBtn.addEventListener('click', () => {
      drawer.classList.add('active');
      renderItinerary();
    });
  }

  if (closeItineraryBtn && drawer) {
    closeItineraryBtn.addEventListener('click', () => {
      drawer.classList.remove('active');
    });
  }

  if (copyPlanBtn) {
    copyPlanBtn.addEventListener('click', copyItineraryToClipboard);
  }

  // Manual Review Queue Modal Handlers
  const openReviewQueueBtn = document.getElementById('btn-open-review-queue');
  const closeReviewQueueBtn = document.getElementById('close-review-queue-btn');
  const reviewQueueModal = document.getElementById('review-queue-modal');

  if (openReviewQueueBtn && reviewQueueModal) {
    openReviewQueueBtn.addEventListener('click', () => {
      reviewQueueModal.classList.add('active');
      renderReviewQueueModal();
    });
  }

  if (closeReviewQueueBtn && reviewQueueModal) {
    closeReviewQueueBtn.addEventListener('click', () => {
      reviewQueueModal.classList.remove('active');
    });
  }

  if (reviewQueueModal) {
    reviewQueueModal.addEventListener('click', (e) => {
      if (e.target === reviewQueueModal) reviewQueueModal.classList.remove('active');
    });
  }

  // Price Feedback Modal Handlers (Crowdsourced Pricing Transparency)
  const priceModal = document.getElementById('price-feedback-modal');
  const closePriceModalBtn = document.getElementById('close-price-feedback-btn');
  const cancelPriceModalBtn = document.getElementById('btn-cancel-price-feedback');
  const priceFeedbackForm = document.getElementById('price-feedback-form');

  window.openPriceFeedbackModal = function(venueName) {
    if (!priceModal) return;
    const vName = (venueName || 'Selected Venue').trim();
    const venueInput = document.getElementById('price-feedback-venue-input');
    const venueDisplay = document.getElementById('price-feedback-venue-name');
    const pintInput = document.getElementById('price-feedback-pint');
    const cocktailInput = document.getElementById('price-feedback-cocktail');
    const allInCheck = document.getElementById('price-feedback-all-in');
    const noteInput = document.getElementById('price-feedback-note');
    const hpInput = document.getElementById('price-feedback-hp');
    const statusBox = document.getElementById('price-feedback-status');
    const submitBtn = document.getElementById('btn-submit-price-feedback');

    if (venueInput) venueInput.value = vName;
    if (venueDisplay) venueDisplay.textContent = vName;
    if (pintInput) pintInput.value = '';
    if (cocktailInput) cocktailInput.value = '';
    if (allInCheck) allInCheck.checked = false;
    if (noteInput) noteInput.value = '';
    if (hpInput) hpInput.value = '';
    if (statusBox) {
      statusBox.style.display = 'none';
      statusBox.textContent = '';
      statusBox.className = '';
    }
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Price Update';
    }

    priceModal.classList.add('active');
    setTimeout(() => {
      if (pintInput) pintInput.focus();
    }, 100);
  };

  window.closePriceFeedbackModal = function() {
    if (priceModal) priceModal.classList.remove('active');
  };

  if (closePriceModalBtn) {
    closePriceModalBtn.addEventListener('click', window.closePriceFeedbackModal);
  }
  if (cancelPriceModalBtn) {
    cancelPriceModalBtn.addEventListener('click', window.closePriceFeedbackModal);
  }
  if (priceModal) {
    priceModal.addEventListener('click', (e) => {
      if (e.target === priceModal) window.closePriceFeedbackModal();
    });
  }

  // Global delegation for click on .btn-suggest-price
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-suggest-price');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const vName = btn.getAttribute('data-suggest-venue') || '';
      window.openPriceFeedbackModal(vName);
    }
  });

  if (priceFeedbackForm) {
    priceFeedbackForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const venueInput = document.getElementById('price-feedback-venue-input');
      const pintInput = document.getElementById('price-feedback-pint');
      const cocktailInput = document.getElementById('price-feedback-cocktail');
      const allInCheck = document.getElementById('price-feedback-all-in');
      const noteInput = document.getElementById('price-feedback-note');
      const hpInput = document.getElementById('price-feedback-hp');
      const statusBox = document.getElementById('price-feedback-status');
      const submitBtn = document.getElementById('btn-submit-price-feedback');

      if (hpInput && hpInput.value.trim() !== '') {
        window.closePriceFeedbackModal();
        return;
      }

      const venueName = (venueInput ? venueInput.value : '').trim();
      const pintVal = pintInput && pintInput.value.trim() !== '' ? parseFloat(pintInput.value.trim()) : null;
      const cocktailVal = cocktailInput && cocktailInput.value.trim() !== '' ? parseFloat(cocktailInput.value.trim()) : null;
      const isAllIn = allInCheck ? allInCheck.checked : false;
      const note = noteInput ? noteInput.value.trim() : '';

      if (pintVal === null && cocktailVal === null) {
        if (statusBox) {
          statusBox.style.display = 'block';
          statusBox.style.background = 'rgba(239, 68, 68, 0.15)';
          statusBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
          statusBox.style.color = '#fca5a5';
          statusBox.textContent = 'Please enter at least one price (cheapest pint or cheapest cocktail/highball).';
        }
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
      }

      try {
        const res = await fetch('/api/suggest-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            venue_name: venueName,
            cheapest_pint_input: pintVal,
            cheapest_cocktail_input: cocktailVal,
            is_all_in: isAllIn,
            note: note,
            honeypot: hpInput ? hpInput.value : ''
          })
        });

        const data = await res.json();
        if (res.ok && data.success) {
          if (statusBox) {
            statusBox.style.display = 'block';
            statusBox.style.background = 'rgba(16, 185, 129, 0.15)';
            statusBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            statusBox.style.color = '#6ee7b7';
            statusBox.textContent = '✓ Thank you! Your price update has been received and will help calibrate Vancouver outing spend estimates.';
          }
          if (submitBtn) {
            submitBtn.textContent = '✓ Submitted';
          }
          setTimeout(() => {
            window.closePriceFeedbackModal();
          }, 1800);
        } else {
          if (statusBox) {
            statusBox.style.display = 'block';
            statusBox.style.background = 'rgba(239, 68, 68, 0.15)';
            statusBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
            statusBox.style.color = '#fca5a5';
            statusBox.textContent = data.error || 'Failed to submit price update. Please try again.';
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Price Update';
          }
        }
      } catch (err) {
        if (statusBox) {
          statusBox.style.display = 'block';
          statusBox.style.background = 'rgba(239, 68, 68, 0.15)';
          statusBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
          statusBox.style.color = '#fca5a5';
          statusBox.textContent = 'Network connection error. Please try again.';
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Price Update';
        }
      }
    });
  }
}


function updateSliderVisuals() {
  const readout = document.getElementById('spend-readout');
  const highlight = document.getElementById('dual-slider-highlight');
  
  if (readout) {
    if (state.minBudget === 0 && state.maxBudget === 0) {
      readout.textContent = "Free Outings ($0 CAD)";
    } else if (state.minBudget === 1 && state.maxBudget === 50) {
      readout.textContent = "Paid Outings ($1 — $50 CAD)";
    } else if (state.minBudget === 0 && state.maxBudget === 50) {
      readout.textContent = "$0 — $50 CAD (All)";
    } else if (state.minBudget === state.maxBudget) {
      readout.textContent = `$${state.minBudget} CAD`;
    } else {
      readout.textContent = `$${state.minBudget} — $${state.maxBudget} CAD`;
    }
  }

  if (highlight) {
    const leftPct = (state.minBudget / 50) * 100;
    const widthPct = ((state.maxBudget - state.minBudget) / 50) * 100;
    highlight.style.left = `${leftPct}%`;
    highlight.style.width = `${widthPct}%`;
  }
}

function clearActiveQuickButtons() {
  const quickButtons = document.querySelectorAll('.cost-quick-btn');
  const minSlider = document.getElementById('min-spend-slider');
  const maxSlider = document.getElementById('max-spend-slider');
  const minVal = minSlider ? parseInt(minSlider.value) : state.minBudget;
  const maxVal = maxSlider ? parseInt(maxSlider.value) : state.maxBudget;

  quickButtons.forEach(b => b.classList.remove('active'));

  if (minVal === 0 && maxVal === 0) {
    const freeBtn = document.getElementById('quick-cost-free');
    if (freeBtn) freeBtn.classList.add('active');
  } else if (minVal >= 1 && maxVal === 50) {
    const paidBtn = document.getElementById('quick-cost-paid');
    if (paidBtn) paidBtn.classList.add('active');
  } else if (minVal === 0 && maxVal === 50) {
    const allBtn = document.getElementById('quick-cost-all');
    if (allBtn) allBtn.classList.add('active');
  }
}

// ==============================================================================
// 1.5 FESTIVAL SPOTLIGHT & TOGGLE ENGINE
// ==============================================================================

function renderFestivalSpotlight() {
  const container = document.getElementById('festival-spotlight-container');
  if (!container) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  const activeFestivalEvents = (window.currentActiveCatalog || ALL_EVENTS).filter(e => e && !isEventInPast(e, now) && (
    (e.id && (e.id.startsWith('fest-') || e.id.startsWith('viff-') || e.id.includes('viff'))) ||
    e.isFestival ||
    Boolean(e.festivalAffiliation) ||
    Boolean(e.festival_affiliation) ||
    (e.subTags && e.subTags.some(t => t.toLowerCase().includes('festival') || t.toLowerCase().includes('viff'))) ||
    (e.title && (e.title.toLowerCase().includes('festival') || e.title.toLowerCase().includes('viff') || e.title.toLowerCase().includes('fringe'))) ||
    (Array.isArray(e.categories) && e.categories.includes('festivals'))
  ));

  const isHidden = state.hideFestivalEvents === true;
  const festCount = activeFestivalEvents.length;

  container.style.display = 'block';

  // Dynamic content based on current active / upcoming festival in Vancouver
  const isFringeActive = todayStr <= '2026-09-20';

  const badgeStatus = isHidden 
    ? '🎪 FESTIVALS HIDDEN' 
    : (isFringeActive ? '🎪 LIVE FESTIVAL SPOTLIGHT' : '🎪 UPCOMING FESTIVAL SPOTLIGHT');

  const datesBadge = isFringeActive ? 'Sept 10 – 20, 2026' : 'Sept 24 – Oct 04, 2026';
  const venueBadge = isFringeActive ? 'Granville Island & East Van' : 'VIFF Centre, The Cinematheque & Rio Theatre';
  const festTitle = isFringeActive ? 'Vancouver Fringe Festival 2026' : 'Vancouver International Film Festival (VIFF 2026)';
  
  const festBlurb = isFringeActive ? `
    <strong class="festival-dates-lead">📅 September 10 – 20, 2026:</strong> Vancouver's iconic uncurated independent theatre celebration is live across Granville Island and East Van! Individual show tickets are <strong>$15.00 – $18.00 CAD all-in</strong> ($12 – $15 artist base price + $3 ticketing fee; 100% of base profits go directly to artists). <strong>No festival membership is required</strong>—simply buy your show tickets and enjoy! <em>Note: Tickets are not sold at venue doors; purchase online or at the central Fringe Box Office.</em>
  ` : `
    <strong class="festival-dates-lead">📅 September 24 – October 4, 2026:</strong> Western Canada's premier celebration of world cinema, award-winning auteur features, and Cannes Grand Prix winners across VIFF Centre, The Cinematheque, and the Rio Theatre! Single festival screening tickets are <strong>$18.00 CAD + $2.00 VIFF society membership ($20.90 CAD all-in checkout)</strong>.
  `;

  const programLink = isFringeActive ? 'https://vancouverfringe.com/shows/' : 'https://viff.org';
  const programLabel = isFringeActive ? 'Official Fringe Program & Tickets ↗' : 'Official VIFF Program & Tickets ↗';
  const secondaryLink = isFringeActive ? 'https://www.vancouverfringe.com/how-to-fringe/' : 'https://thecinematheque.ca';
  const secondaryLabel = isFringeActive ? 'How to Fringe Guide ↗' : 'Cinematheque VIFF Screenings ↗';
  const countLabel = isFringeActive 
    ? `${festCount} Curated Fringe Productions in Van50` 
    : `${festCount || 3} Curated VIFF Feature Screenings under $50 CAD in Van50`;

  container.innerHTML = `
    <div class="festival-spotlight-card ${isHidden ? 'festival-muted festival-collapsed' : ''}">
      <div class="festival-spotlight-left">
        <div class="festival-badge-row">
          <span class="festival-status-badge">${badgeStatus}</span>
          <span class="festival-dates-badge">${datesBadge}</span>
          <span class="festival-venue-badge">${venueBadge}</span>
        </div>
        <h2 class="festival-spotlight-title">${festTitle} ${isHidden ? '<span class="festival-hidden-tag">(Events &amp; blurb hidden from listings &amp; map)</span>' : ''}</h2>
        ${!isHidden ? `
        <p class="festival-spotlight-blurb">
          ${festBlurb}
        </p>
        <div class="festival-links-row">
          <a href="${programLink}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="festival-link-primary" title="Browse full festival program on official site">
            ${programLabel}
          </a>
          <a href="${secondaryLink}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="festival-link-secondary" style="color: var(--accent-primary); text-decoration: underline; font-size: 0.85rem; margin-left: 8px;" title="${secondaryLabel}">
            ${secondaryLabel}
          </a>
          <span class="festival-stats-chip">${countLabel}</span>
        </div>
        ` : ''}
      </div>
      <div class="festival-spotlight-right">
        ${!isHidden ? `
        <button 
          type="button" 
          class="btn-festival-display ${state.category === 'festivals' ? 'active' : ''}" 
          id="btn-display-festival"
          onclick="displayFestivalEvents()"
          title="${state.category === 'festivals' ? 'Showing festival events. Click to show all outings' : 'Filter outings to display only festival events'}"
        >
          <span class="toggle-icon">${state.category === 'festivals' ? '✓' : '🎪'}</span>
          <span class="toggle-label">${state.category === 'festivals' ? `Showing Festival Events (${festCount || 3})` : `Display Festival Events (${festCount || 3})`}</span>
        </button>
        ` : ''}

        <button 
          type="button" 
          class="btn-festival-toggle ${isHidden ? 'fest-hidden' : ''}" 
          id="btn-toggle-festival"
          onclick="toggleHideFestivalEvents()"
          aria-pressed="${isHidden}"
          title="${isHidden ? 'Show festival events and blurb in listing and map' : 'Hide festival events and blurb from listing and map'}"
        >
          <span class="toggle-icon">${isHidden ? '👁️' : '🙈'}</span>
          <span class="toggle-label">${isHidden ? `Unhide Festival Events (${festCount || 3})` : 'Hide Festival Events'}</span>
        </button>
      </div>
    </div>
  `;
}

function displayFestivalEvents() {
  if (state.category === 'festivals') {
    state.category = 'all';
  } else {
    state.category = 'festivals';
    state.hideFestivalEvents = false;
  }
  renderCategoryPills();
  renderFestivalSpotlight();
  applyFiltersAndRender();
  if (typeof invalidateVancouverMap === 'function') {
    invalidateVancouverMap();
  }
  const target = document.getElementById('events-container') || document.getElementById('catalog-section');
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function toggleHideFestivalEvents() {
  state.hideFestivalEvents = !state.hideFestivalEvents;
  renderFestivalSpotlight();
  applyFiltersAndRender();
  if (typeof invalidateVancouverMap === 'function') {
    invalidateVancouverMap();
  }
}
window.displayFestivalEvents = displayFestivalEvents;
window.toggleHideFestivalEvents = toggleHideFestivalEvents;
window.renderFestivalSpotlight = renderFestivalSpotlight;

// ==============================================================================
// 2. RENDERING FILTER PILLS
// ==============================================================================

if (typeof CATEGORIES === 'undefined') {
  window.CATEGORIES = [
    { id: "all", label: "All", icon: "✨" },
    { id: "free-public-access", label: "Free Public Access", icon: "🏛️" },
    { id: "music", label: "Music", icon: "🎵" },
    { id: "shows", label: "Comedy & Stage", icon: "🎭" },
    { id: "festivals", label: "Festivals", icon: "🎪" },
    { id: "markets", label: "Markets", icon: "🧺" },
    { id: "outdoors", label: "Outdoors", icon: "🌲" },
    { id: "cinema", label: "Cinema", icon: "🎬" },
    { id: "social", label: "Social & Arts", icon: "🎨" }
  ];
}

function renderCategoryPills() {
  const container = document.getElementById('categories-bar');
  if (!container || typeof CATEGORIES === 'undefined') return;

  container.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const pill = document.createElement('button');
    pill.className = `category-pill ${state.category === cat.id ? 'active' : ''}`;
    pill.innerHTML = `<span>${cat.icon}</span> <span>${cat.label}</span>`;
    pill.setAttribute('data-goatcounter-click', 'category-' + cat.id);
    pill.setAttribute('data-goatcounter-title', 'Category: ' + cat.label);
    pill.setAttribute('data-goatcounter-no-session', '1');
    pill.addEventListener('click', () => {
      state.category = cat.id;
      if (cat.id && cat.id !== 'all') {
        window.trackAnonymousEvent('category/' + cat.id, 'Category: ' + cat.label);
      }
      renderCategoryPills();
      applyFiltersAndRender();
    });
    container.appendChild(pill);
  });
}

function filterByCategory(catId) {
  if (!catId || catId === 'all') {
    state.category = 'all';
  } else {
    state.category = (state.category === catId) ? 'all' : catId;
  }
  if (state.category !== 'all') {
    window.trackAnonymousEvent('category/' + state.category, 'Category: ' + state.category);
  }
  renderCategoryPills();
  applyFiltersAndRender();
  const resultsHeading = document.getElementById('results-heading');
  if (resultsHeading) {
    resultsHeading.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}
window.filterByCategory = filterByCategory;

function renderDayPills() {
  const container = document.getElementById('days-pills-wrap');
  if (!container || typeof DAYS_OF_WEEK === 'undefined') return;

  container.innerHTML = '';
  DAYS_OF_WEEK.forEach(day => {
    const pill = document.createElement('button');
    pill.className = `day-pill ${state.dayOfWeek === day.id ? 'active' : ''}`;
    pill.innerHTML = day.icon ? `<span>${day.icon}</span> <span>${day.label}</span>` : `<span>${day.label}</span>`;
    pill.title = day.full || day.label;
    pill.addEventListener('click', () => {
      state.dayOfWeek = day.id;
      renderDayPills();
      applyFiltersAndRender();
    });
    container.appendChild(pill);
  });
}

function renderTimePills() {
  const container = document.getElementById('time-pills-wrap');
  if (!container || typeof TIME_SLOTS === 'undefined') return;

  container.innerHTML = '';
  TIME_SLOTS.forEach(slot => {
    const pill = document.createElement('button');
    pill.className = `time-pill ${state.timeSlot === slot.id ? 'active' : ''}`;
    pill.innerHTML = `<span>${slot.icon}</span> <span>${slot.label}</span>`;
    if (slot.desc) pill.title = slot.desc;
    pill.addEventListener('click', () => {
      state.timeSlot = slot.id;
      renderTimePills();
      applyFiltersAndRender();
    });
    container.appendChild(pill);
  });
}

function renderNeighborhoodPills() {
  const container = document.getElementById('neighborhood-pills-wrap');
  if (!container || typeof NEIGHBORHOODS === 'undefined') return;

  container.innerHTML = '';
  NEIGHBORHOODS.forEach(nh => {
    const pill = document.createElement('button');
    const isSelected = state.selectedNeighborhoods.has(nh);
    pill.className = `nh-pill ${isSelected ? 'active' : ''}`;
    pill.innerHTML = `<span>${nh}</span>`;
    pill.addEventListener('click', () => {
      if (state.selectedNeighborhoods.has(nh)) {
        state.selectedNeighborhoods.delete(nh);
      } else {
        state.selectedNeighborhoods.add(nh);
        window.trackAnonymousEvent('neighborhood/' + nh.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 'Neighborhood: ' + nh);
      }
      renderNeighborhoodPills();
      applyFiltersAndRender();
    });
    container.appendChild(pill);
  });

  const toggleBtn = document.getElementById('btn-toggle-all-neighborhoods');
  if (toggleBtn) {
    toggleBtn.textContent = (state.selectedNeighborhoods.size === NEIGHBORHOODS.length) ? 'Deselect All' : 'Select All';
  }
}

function renderFrequencyPills() {
  const container = document.getElementById('frequency-pills-wrap');
  if (!container || typeof FREQUENCIES === 'undefined') return;

  container.innerHTML = '';
  FREQUENCIES.forEach(fq => {
    const pill = document.createElement('button');
    pill.className = `freq-filter-pill ${state.frequency === fq.id ? 'active' : ''}`;
    pill.innerHTML = `<span>${fq.icon}</span> <span>${fq.label}</span>`;
    pill.addEventListener('click', () => {
      state.frequency = fq.id;
      renderFrequencyPills();
      applyFiltersAndRender();
    });
    container.appendChild(pill);
  });
}

// Sub-tag click-to-filter helper with instant toggle-to-deselect
window.filterBySubTag = function(tag) {
  const norm = String(tag).toLowerCase().trim().replace(/^#/, '');
  if (state.selectedTag === norm) {
    // Already selected -> toggle off / deselect
    state.selectedTag = null;
  } else {
    // Activate tag
    state.selectedTag = norm;
  }
  applyFiltersAndRender();
};

window.clearSelectedTag = function() {
  state.selectedTag = null;
  applyFiltersAndRender();
};

// ==============================================================================
// 3. CORE FILTERING ALGORITHM (WITH INTERNAL ENDED & AWAITING TRACKER)
// ==============================================================================

/**
 * Detects whether an event is awaiting future schedule announcement or has concluded its seasonal run.
 * Such placeholder items are preserved in the central database but strictly excluded from user display.
 */
function isAwaitingSchedule(ev) {
  const text = `${ev.frequencyLabel || ''} ${ev.dateSchedule || ''} ${ev.description || ''}`.toLowerCase();
  const awaitingPhrases = [
    'awaiting schedule',
    'awaiting next announced',
    'awaiting next edition',
    'awaiting next',
    'awaiting 2027',
    'awaiting 2028',
    'series concluded',
    'season concluded',
    'concluded for the 2026',
    'concluded 2026 season',
    'ended event'
  ];
  if (awaitingPhrases.some(phrase => text.includes(phrase))) {
    return true;
  }
  // Non-recurring events lacking start date and confirmed dates are awaiting schedule
  if (!ev.isDaily && ev.frequency !== 'daily' && ev.frequency !== 'weekly' && ev.frequency !== 'monthly') {
    if (!ev.startIso && (!ev.confirmedDates || ev.confirmedDates.length === 0)) {
      return true;
    }
  }
  return false;
}

/**
 * Resolves the closing or end time for an event or venue for a given date (default today).
 * Accurately parses range closing times (e.g. "10:00 AM - 6:00 PM"), dusk/daylight hours,
 * explicit endIso timestamps, start times + standard event runtime (2.5 hours), and time slot bounds.
 * Returns: { hasEnded: boolean, closingMinutes: number, closingTimeStr: string }
 */
function getEventClosingTimeToday(ev, now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  // Check explicit cancellation / private buyout / closure exceptions
  if (Array.isArray(ev.cancelledDates) && ev.cancelledDates.includes(todayStr)) {
    return { hasEnded: true, closingMinutes: 0, closingTimeStr: 'Closed Today (Private Event)' };
  }

  // Open public space (parks, seawall, beaches, outdoor spaces) never show Closed unless dusk applies
  if (ev.access_model === 'open_public_space' || ev.accessModel === 'open_public_space') {
    return { hasEnded: false, closingMinutes: 24 * 60, closingTimeStr: 'Open 24/7 (Recommended Visiting Times)' };
  }

  const ds = ev.dateSchedule || '';
  const op = ev.operating_hours || ev.operatingHours || '';
  const nowHours = now.getHours();
  const nowMins = now.getMinutes();
  const currentMinutes = nowHours * 60 + nowMins;

  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const curKey = dayKeys[now.getDay()];

  // 1. Check weekly_hours / weeklyHours for today's explicit schedule
  const wh = ev.weekly_hours || ev.weeklyHours || (typeof ev.weekly_schedule === 'object' ? ev.weekly_schedule : null);
  if (wh && typeof wh === 'object') {
    const todayEntry = wh[curKey];
    if (!todayEntry || /closed/i.test(String(todayEntry).trim())) {
      return { hasEnded: true, closingMinutes: 0, closingTimeStr: 'Closed Today' };
    }
    const entryStr = String(todayEntry).trim();
    // Parse closing time from todayEntry (e.g. "10:00 AM – 4:00 PM", "9:00 AM – 9:00 PM")
    const timeMatch = entryStr.match(/[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i);
    if (timeMatch) {
      const rawTime = timeMatch[1].trim();
      const m = rawTime.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)/i);
      if (m) {
        let h = parseInt(m[1], 10);
        const min = m[2] ? parseInt(m[2], 10) : 0;
        const ampm = m[3].toUpperCase();
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        if (h < 5) h += 24;
        const closingMinutes = h * 60 + min;
        return {
          hasEnded: currentMinutes >= closingMinutes,
          closingMinutes,
          closingTimeStr: rawTime
        };
      }
    }
  }

  // 2. 24/7 venues never close
  if (ds.includes('24/7') || ds.toLowerCase().includes('open 24') || op.includes('24/7') || op.toLowerCase().includes('open 24')) {
    return { hasEnded: false, closingMinutes: 24 * 60, closingTimeStr: 'Open 24/7' };
  }

  // 3. Operating hours text & days_open check for today's closure
  const daysOpen = ev.days_open || ev.daysOpen || '';
  if (daysOpen) {
    const dLower = daysOpen.toLowerCase();
    const curDay = now.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    if (dLower === 'mon-sat' && curDay === 0) {
      return { hasEnded: true, closingMinutes: 0, closingTimeStr: 'Closed Today (Sundays)' };
    }
    if (dLower === 'wed-mon' && curDay === 2) {
      return { hasEnded: true, closingMinutes: 0, closingTimeStr: 'Closed Today (Tuesdays)' };
    }
    if (dLower === 'tue-sun' && curDay === 1) {
      return { hasEnded: true, closingMinutes: 0, closingTimeStr: 'Closed Today (Mondays)' };
    }
    if ((dLower.includes('sat-sun') || dLower.includes('saturday-sunday') || dLower.includes('saturdays, sundays')) && curDay !== 0 && curDay !== 6) {
      return { hasEnded: true, closingMinutes: 0, closingTimeStr: 'Closed Today (Weekend Only)' };
    }
  }

  if (op) {
    const curDayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
    const closedDayRegex = new RegExp(`(?:closed\\s+on\\s+${curDayShort}|closed\\s+${curDayShort}|${curDayShort}[a-z]*:\\s*closed|${curDayShort}[–-]\\w+\\s*closed)`, 'i');
    if (closedDayRegex.test(op)) {
      return { hasEnded: true, closingMinutes: 0, closingTimeStr: 'Closed Today' };
    }
    // Also parse range from operating_hours if not already parsed from weekly_hours
    const opRangeMatch = op.match(/[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i);
    if (opRangeMatch) {
      const rawTime = opRangeMatch[1].trim();
      const m = rawTime.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)/i);
      if (m) {
        let h = parseInt(m[1], 10);
        const min = m[2] ? parseInt(m[2], 10) : 0;
        const ampm = m[3].toUpperCase();
        if (ampm === 'PM' && h < 12) h += 12;
        if (ampm === 'AM' && h === 12) h = 0;
        if (h < 5) h += 24;
        const closingMinutes = h * 60 + min;
        return {
          hasEnded: currentMinutes >= closingMinutes,
          closingMinutes,
          closingTimeStr: rawTime
        };
      }
    }
  }

  // 4. Parse closing time range from dateSchedule (e.g. "10:00 AM - 6:00 PM", "6:00 AM - 10:00 PM")
  const rangeMatch = ds.match(/[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i);
  if (rangeMatch) {
    const rawTime = rangeMatch[1].trim();
    const timeMatch = rawTime.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)/i);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const ampm = timeMatch[3].toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      if (h < 5 && (ds.toLowerCase().includes('night') || ds.toLowerCase().includes('cabaret') || ds.toLowerCase().includes('pm'))) {
        h += 24;
      }
      const closingMinutes = h * 60 + m;
      return {
        hasEnded: currentMinutes >= closingMinutes,
        closingMinutes,
        closingTimeStr: rawTime
      };
    }
  }

  // 5. Daylight hours (parks, outdoor attractions) - dusk cutoff around 7:45 PM
  if (ds.toLowerCase().includes('daylight hours') || op.toLowerCase().includes('daylight hours')) {
    const duskMinutes = 19 * 60 + 45;
    return {
      hasEnded: currentMinutes >= duskMinutes,
      closingMinutes: duskMinutes,
      closingTimeStr: 'Dusk (7:45 PM)'
    };
  }

  // 6. Explicit endIso (if not end of year series placeholder)
  if (ev.endIso && !ev.endIso.includes('12-31') && !ev.endIso.includes('03-31') && !ev.endIso.includes('05-31')) {
    try {
      const endDt = new Date(ev.endIso);
      if (!isNaN(endDt.getTime())) {
        const year = now.getFullYear();
        const month = now.getMonth();
        const day = now.getDate();
        const todayStart = new Date(year, month, day, 0, 0, 0);
        const todayEnd = new Date(year, month, day + 1, 4, 0, 0);
        if (endDt >= todayStart && endDt <= todayEnd) {
          const hasEnded = now >= endDt;
          const timeStr = endDt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
          return {
            hasEnded,
            closingMinutes: endDt.getHours() * 60 + endDt.getMinutes(),
            closingTimeStr: timeStr
          };
        }
      }
    } catch (e) {}
  }

  // 7. Check showings for today (if specific showings exist)
  if (Array.isArray(ev.showings) && ev.showings.length > 0) {
    const todayShowings = ev.showings.filter(s => s && s.date === todayStr);
    if (todayShowings.length > 0) {
      let latestShowingEndMinutes = 0;
      let latestShowingStr = '';
      for (const s of todayShowings) {
        const endRaw = s.end_time || s.endTime;
        const startRaw = s.start_time || s.startTime;
        if (endRaw) {
          const parts = String(endRaw).split(':');
          let sh = parseInt(parts[0], 10);
          const sm = parts[1] ? parseInt(parts[1], 10) : 0;
          if (sh < 5) sh += 24;
          const totalM = sh * 60 + sm;
          if (totalM > latestShowingEndMinutes) {
            latestShowingEndMinutes = totalM;
            latestShowingStr = endRaw;
          }
        } else if (startRaw) {
          const parts = String(startRaw).split(':');
          let sh = parseInt(parts[0], 10);
          const sm = parts[1] ? parseInt(parts[1], 10) : 0;
          if (sh < 5) sh += 24;
          const totalM = sh * 60 + sm + 150; // + 2.5 hours runtime
          if (totalM > latestShowingEndMinutes) {
            latestShowingEndMinutes = totalM;
            latestShowingStr = `${startRaw} (+2.5h run)`;
          }
        }
      }
      if (latestShowingEndMinutes > 0) {
        return {
          hasEnded: currentMinutes >= latestShowingEndMinutes,
          closingMinutes: latestShowingEndMinutes,
          closingTimeStr: latestShowingStr
        };
      }
    }
  }

  // 8. Start time in dateSchedule or startIso + 2.5 hours runtime
  const startMatch = ds.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)/i);
  if (startMatch) {
    let sh = parseInt(startMatch[1], 10);
    const sm = startMatch[2] ? parseInt(startMatch[2], 10) : 0;
    const ampm = startMatch[3].toUpperCase();
    if (ampm === 'PM' && sh < 12) sh += 12;
    if (ampm === 'AM' && sh === 12) sh = 0;
    const endMinutes = sh * 60 + sm + 150; // + 2.5 hours
    return {
      hasEnded: currentMinutes >= endMinutes,
      closingMinutes: endMinutes,
      closingTimeStr: `${startMatch[0]} (+2.5h run)`
    };
  }

  if (ev.startIso) {
    try {
      const startDt = new Date(ev.startIso);
      if (!isNaN(startDt.getTime())) {
        const year = now.getFullYear();
        const month = now.getMonth();
        const day = now.getDate();
        if (startDt.getFullYear() === year && startDt.getMonth() === month && startDt.getDate() === day) {
          const endDt = new Date(startDt.getTime() + 150 * 60 * 1000);
          return {
            hasEnded: now >= endDt,
            closingMinutes: endDt.getHours() * 60 + endDt.getMinutes(),
            closingTimeStr: 'Show concluded'
          };
        }
      }
    } catch (e) {}
  }

  // 9. TimeSlot fallback
  const slots = ev.timeSlots || [];
  if (slots.length > 0) {
    if (slots.length === 1 && slots[0] === 'early-morning') {
      return { hasEnded: currentMinutes >= 12 * 60, closingMinutes: 12 * 60, closingTimeStr: '12:00 PM' };
    }
    if (slots.includes('afternoon') && !slots.includes('early-evening') && !slots.includes('late-evening')) {
      return { hasEnded: currentMinutes >= 17 * 60, closingMinutes: 17 * 60, closingTimeStr: '5:00 PM' };
    }
    if (slots.includes('early-evening') && !slots.includes('late-evening')) {
      return { hasEnded: currentMinutes >= 21 * 60, closingMinutes: 21 * 60, closingTimeStr: '9:00 PM' };
    }
  }

  // Default fallback: 11:59 PM
  return { hasEnded: false, closingMinutes: 24 * 60, closingTimeStr: 'Midnight' };
}

/**
 * Detects whether an event has passed or all confirmed dates have elapsed.
 * Daily, weekly, and monthly recurring outings (which run continuously) remain active,
 * while completed one-off events and past sessions are strictly excluded.
 */
function isEventInPast(ev, now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  // Check explicit off-season flag
  if (ev.isSeasonalOffSeason === true || ev.seasonConcluded === true) {
    return true;
  }

  // Check seasonal boundary (e.g. summer series ending Aug/Sep)
  if (ev.seasonEnd && String(ev.seasonEnd).slice(0, 10) < todayStr) {
    return true;
  }

  // Check explicit endIso across ALL event types (including weekly and recurring)
  if (ev.endIso) {
    const endDt = new Date(ev.endIso);
    if (!isNaN(endDt.getTime()) && endDt < now) {
      return true; // The entire multi-day run, recurring series, or seasonal edition has concluded
    }
  }
  // Perennial drop-in and Free Public Access spots never expire by date; only if explicitly marked closed
  if (ev.category === 'free-public-access' || ev.lifecycleType === 'perennial_drop_in' || ev.lifecycle_type === 'perennial_drop_in') {
    if (ev.isClosed === true || ev.isTemporarilyClosed === true) {
      return true;
    }
    return false;
  }

  const isRecurring = ev.isDaily || ev.frequency === 'daily' || ev.frequency === 'weekly' || ev.frequency === 'monthly';

  // 1. If specific confirmed dates list exists
  if (Array.isArray(ev.confirmedDates) && ev.confirmedDates.length > 0) {
    const futureDates = ev.confirmedDates.filter(d => String(d).slice(0, 10) > todayStr);
    const todayDates = ev.confirmedDates.filter(d => String(d).slice(0, 10) === todayStr);
    if (futureDates.length === 0) {
      if (todayDates.length === 0) {
        return true; // All confirmed dates are in the past
      }
      // Only today remains: if non-recurring, check if today's event has ended
      if (!isRecurring) {
        const closing = getEventClosingTimeToday(ev, now);
        if (closing.hasEnded) {
          return true;
        }
      }
    }
  }

  // 2. Non-recurring events (one-offs, limited run, festivals) startIso check
  if (!isRecurring) {
    if (ev.startIso) {
      const startDt = new Date(ev.startIso);
      if (!isNaN(startDt.getTime())) {
        const startDay = String(ev.startIso).slice(0, 10);
        if (startDay < todayStr) {
          return true;
        }
        if (startDay === todayStr) {
          const closing = getEventClosingTimeToday(ev, now);
          if (closing.hasEnded) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

function applyFiltersAndRender() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;
  let activeCatalog = [];
  let expiredCount = 0;

  // Requirement: Strictly exclude past events, awaiting-schedule items, and over-budget (> $50) from user display
  ALL_EVENTS.forEach(ev => {
    const p = parseFloat(ev.price || 0.0);
    if (isAwaitingSchedule(ev) || isEventInPast(ev, now) || p > 50.00) {
      expiredCount++;
    } else {
      activeCatalog.push(ev);
    }
  });

  state.expiredCount = expiredCount;
  window.currentActiveCatalog = activeCatalog;

  // Keep live sync counter in header aligned with active catalog
  const syncBadgeText = document.getElementById('sync-status-text');
  if (syncBadgeText && state.updatedAt) {
    showSyncTimestamp(state.updatedAt, activeCatalog.length);
  }

  const parsedSearch = state.searchQuery ? parseGoogleQuery(state.searchQuery) : null;

  const filtered = activeCatalog.filter(ev => {
    // Strict Budget Cap Guard (never display > $50.00 CAD to user under any circumstances)
    const p = parseFloat(ev.price || 0.0);
    if (p > 50.00) return false;

    // Venue Isolation Filter (Requirement 3: When clicking events at a venue, show all events at the venue)
    if (state.selectedVenue) {
      return ev.venue === state.selectedVenue;
    }

    // Festival Toggle Guard (Hide Festival Events toggle)
    if (state.hideFestivalEvents) {
      if ((ev.id && ev.id.startsWith('fest-')) || ev.isFestival || (ev.subTags && ev.subTags.includes('festival')) || (ev.title && ev.title.toLowerCase().includes('fringe'))) {
        return false;
      }
    }

    // Wheelchair Accessible Venues Filter
    if (state.accessibleOnly) {
      const access = typeof window.getVenueAccessibility === 'function' ? window.getVenueAccessibility(ev.venue) : null;
      if (!access || access.status === 'inaccessible') {
        return false;
      }
    }

    // 1. Strict Budget Cap & Slider Range (<= $50.00 CAD) with Dual-Tier Support
    const hasPaidTier = Array.isArray(ev.tiers) && ev.tiers.some(t => t.price > 0 && t.price <= 50);
    const hasFreeTier = ev.price === 0 || ev.isFree || ev.pricingType === 'free-option' || (Array.isArray(ev.tiers) && ev.tiers.some(t => t.price === 0));

    if (state.minBudget === 0 && state.maxBudget === 0) {
      // Free Outings ($0 CAD)
      if (!hasFreeTier) return false;
    } else if (state.minBudget === 1 && state.maxBudget === 50) {
      // Paid Outings ($1 — $50 CAD)
      if (ev.price <= 0 && !hasPaidTier) return false;
    } else {
      // Slider Range
      const effectiveMin = Array.isArray(ev.tiers) && ev.tiers.length > 0 ? Math.min(ev.price, ...ev.tiers.map(t => t.price)) : ev.price;
      const effectiveMax = hasPaidTier ? Math.max(ev.price, ...ev.tiers.map(t => t.price)) : ev.price;
      if (effectiveMax < state.minBudget || effectiveMin > state.maxBudget) return false;
    }

    // 2. Category Filter (Multi-category support)
    if (state.category !== 'all') {
      const evCats = (Array.isArray(ev.categories) && ev.categories.length > 0)
        ? ev.categories
        : [ev.category];
      const match = evCats.includes(state.category) ||
        (state.category === 'outdoors' && (
          evCats.includes('outdoors') ||
          evCats.includes('outdoor') ||
          evCats.includes('sports') ||
          evCats.includes('fitness') ||
          ev.access_model === 'open_public_space' ||
          (ev.categoryLabel && /outdoor|sport|fitness|park|walk|trail|golf|pitch/i.test(ev.categoryLabel)) ||
          (ev.subTags && ev.subTags.some(t => /outdoor|sport|fitness|walk|park|beach|seawall|garden|nature|golf|pitch/i.test(t))) ||
          /park|seawall|promenade|garden|beach|trail|canyon|quarry|pitch|putt|football|stadium|boardwalk|waterfront|harvest days|apple festival|miniature train/i.test(ev.venue || '') ||
          /park|seawall|promenade|garden|beach|trail|canyon|quarry|pitch|putt|football|stadium|boardwalk|walk|loop|train/i.test(ev.title || '')
        )) ||
        (state.category === 'cinema' && (
          evCats.includes('cinema') ||
          evCats.includes('film') ||
          evCats.includes('movie') ||
          (ev.subTags && ev.subTags.some(t => /cinema|film|movie|screening/i.test(t))) ||
          (/cinematheque|theatre|cinema|viff/i.test(ev.venue || '') && /film|screening|movie|viff|kwaidan|pulse|destroyer|ser querido|lovers in the night|jekyll|matchstick/i.test(ev.title || ''))
        )) ||
        (state.category === 'free-public-access' && (
          evCats.includes('free-public-access') ||
          evCats.includes('free public access') ||
          (ev.categoryLabel && ev.categoryLabel.toLowerCase().includes('public access')) ||
          (ev.subTags && ev.subTags.some(t => t.toLowerCase().includes('public-access') || t.toLowerCase().includes('drop-in') || t.toLowerCase().includes('free-access'))) ||
          ev.lifecycleType === 'perennial_drop_in'
        )) ||
        (state.category === 'markets' && (
          evCats.includes('markets') || 
          evCats.includes('market') || 
          (ev.subTags && ev.subTags.some(t => t.toLowerCase().includes('market'))) ||
          (ev.id && ev.id.includes('market')) ||
          (ev.title && ev.title.toLowerCase().includes('market'))
        )) ||
        (state.category === 'music' && (
          evCats.includes('music') ||
          evCats.includes('live-music') ||
          (ev.subTags && ev.subTags.some(t => /music|dj|dance-party|dance|concert|band|jazz|techno|electronic|house|disco|nightlife/i.test(t))) ||
          /dj|dance party|dance night|techno|house music|disco|electronic|concert|band/i.test(ev.title || '')
        )) ||
        (state.category === 'shows' && (
          (evCats.includes('stage') || evCats.includes('comedy') || evCats.includes('shows')) &&
          !/dance party|dance-party|dance night/i.test(ev.title + ' ' + (ev.subTags || []).join(' '))
        )) ||
        (state.category === 'festivals' && (
          evCats.includes('festivals') ||
          evCats.includes('festival') ||
          Boolean(ev.isFestival) ||
          Boolean(ev.festivalAffiliation) ||
          Boolean(ev.festival_affiliation) ||
          (ev.id && (ev.id.startsWith('fest-') || ev.id.startsWith('viff-') || ev.id.includes('viff'))) ||
          (ev.title && (ev.title.toLowerCase().includes('festival') || ev.title.toLowerCase().includes('fringe') || ev.title.toLowerCase().includes('viff'))) ||
          (ev.subTags && ev.subTags.some(t => t.toLowerCase().includes('festival') || t.toLowerCase().includes('viff')))
        )) ||
        (state.category === 'social' && (
          evCats.includes('crafts') || 
          evCats.includes('arts') || 
          evCats.includes('trivia') || 
          evCats.includes('activities') || 
          evCats.includes('social') ||
          evCats.includes('cinema') // Artistic & cultural cinema screenings are also in Social & Arts
        ));
      if (!match) return false;
    }

    // 3. Day of the Week Filter (Requirement 1)
    if (state.dayOfWeek !== 'all') {
      // Check if weekly_hours explicitly marks this day as Closed
      const wh = ev.weekly_hours || ev.weeklyHours;
      if (wh && typeof wh === 'object' && wh[state.dayOfWeek]) {
        if (/closed/i.test(String(wh[state.dayOfWeek]))) {
          return false;
        }
      }
      if (state.dayOfWeek === 'daily') {
        if (!ev.isDaily && ev.frequency !== 'daily' && (!ev.daysOfWeek || !ev.daysOfWeek.includes('daily')) && ev.category !== 'free-public-access') {
          return false;
        }
      } else {
        if (Array.isArray(ev.confirmedDates) && ev.confirmedDates.length > 0) {
          const DAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
          const hasMatchingConfirmed = ev.confirmedDates.some(dStr => {
            const d = new Date(dStr.length === 10 ? dStr + 'T12:00:00' : dStr);
            return !isNaN(d.getTime()) && DAY_CODES[d.getDay()] === state.dayOfWeek && dStr.slice(0, 10) >= todayStr;
          });
          if (!hasMatchingConfirmed && !ev.isDaily && ev.category !== 'free-public-access') {
            return false;
          }
        } else {
          const days = ev.daysOfWeek || [];
          if (!days.includes(state.dayOfWeek) && !ev.isDaily && ev.category !== 'free-public-access') {
            return false;
          }
        }
      }
    }

    // 4. Starting Time Filter (Requirement 9)
    if (state.timeSlot !== 'all') {
      const slots = ev.timeSlots || [];
      if (!slots.includes(state.timeSlot)) return false;
    }

    // 5. Recurrence Frequency Filter
    if (state.frequency !== 'all') {
      if (state.frequency === 'limited-run' || state.frequency === 'seasonal') {
        if (ev.frequency !== 'limited-run' && ev.frequency !== 'seasonal') return false;
      } else if (ev.frequency !== state.frequency) {
        return false;
      }
    }

    // 6. Multi-Select Neighborhood
    const allClustersCount = (window.NEIGHBORHOODS && window.NEIGHBORHOODS.length) || 6;
    if (state.selectedNeighborhoods.size === 0) {
      state.selectedNeighborhoods = new Set(window.NEIGHBORHOODS);
    } else if (state.selectedNeighborhoods.size < allClustersCount) {
      if (!state.selectedNeighborhoods.has(ev.neighborhood)) {
        return false;
      }
    }

    // 7. Shows & Special Events Only Toggle (Hides everyday drop-in spots and open-hours venues)
    if (state.hideDaily) {
      if (
        ev.lifecycleType === 'perennial_drop_in' ||
        ev.lifecycle_type === 'perennial_drop_in' ||
        ev.category === 'free-public-access' ||
        (ev.categoryLabel && ev.categoryLabel.toLowerCase().includes('public access')) ||
        (ev.frequency === 'daily' && !ev.showings?.length && !ev.startIso && ev.id !== 'guilt-and-co-live-jazz')
      ) {
        return false;
      }
    }

    // 8. Hashtag Filter (Click on hashtag to isolate cards with that tag; easily deselectable)
    if (state.selectedTag) {
      const hasTag = ev.subTags && ev.subTags.some(t => t.toLowerCase().replace(/^#/, '') === state.selectedTag);
      if (!hasTag) return false;
    }

    // 9. Classic Google-Style Search Engine (Quotes, Negative, OR, Field Filters, Typo Tolerance, Relevance)
    if (parsedSearch) {
      const [matched, score] = matchesGoogleSearch(ev, parsedSearch);
      if (!matched) return false;
      ev._searchScore = score;
    } else {
      ev._searchScore = 0;
    }

    return true;
  });

  // If search query is active, rank results by relevance score descending (Exact title matches on top)
  if (parsedSearch) {
    filtered.sort((a, b) => (b._searchScore || 0) - (a._searchScore || 0));
  }

  window.currentFilteredEvents = filtered;

  // Update More Filters active counter badge
  let secondaryFilterCount = 0;
  if (state.dayOfWeek !== 'all') secondaryFilterCount++;
  if (state.timeSlot !== 'all') secondaryFilterCount++;
  if (state.frequency !== 'all') secondaryFilterCount++;
  if (typeof NEIGHBORHOODS !== 'undefined' && state.selectedNeighborhoods.size > 0 && state.selectedNeighborhoods.size < NEIGHBORHOODS.length) {
    secondaryFilterCount++;
  }
  const moreCountBadge = document.getElementById('active-filters-count');
  if (moreCountBadge) {
    if (secondaryFilterCount > 0) {
      moreCountBadge.textContent = secondaryFilterCount;
      moreCountBadge.style.display = 'inline-block';
    } else {
      moreCountBadge.style.display = 'none';
    }
  }

  // Update Results Counter (with internal ended events tracker & active tag indicator)
  const countBar = document.getElementById('results-count');
  if (countBar) {
    const tagBadgeHtml = state.selectedTag ? `
      <div class="active-tag-pill" title="Filtered by #${state.selectedTag}. Click ✕ to clear.">
        <span class="tag-label">Tag:</span>
        <span>#${state.selectedTag}</span>
        <button type="button" class="btn-clear-tag" onclick="clearSelectedTag()" aria-label="Clear hashtag filter">✕</button>
      </div>
    ` : '';

    // Check for cross-category matches if current category yields 0
    let crossCategoryBannerHtml = '';
    if (filtered.length === 0 && parsedSearch && state.category !== 'all') {
      const crossMatches = activeCatalog.filter(ev => matchesGoogleSearch(ev, parsedSearch)[0]).length;
      if (crossMatches > 0) {
        crossCategoryBannerHtml = `
          <div style="margin-top: 8px;">
            <button type="button" class="btn-cross-category" onclick="resetCategoryForSearch()" style="cursor: pointer; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: 600;">
              Found ${crossMatches} match${crossMatches > 1 ? 'es' : ''} across all categories • View All ↗
            </button>
          </div>
        `;
      }
    }

    countBar.innerHTML = `
      <div class="results-count-text">
        Showing <strong>${filtered.length}</strong> active outings under $50 CAD
      </div>
      ${tagBadgeHtml}
      ${crossCategoryBannerHtml}
    `;
  }

  renderEventCards(filtered);

  // Update Map Markers if map exists
  if (typeof updateMapMarkers === 'function') {
    updateMapMarkers(filtered);
  }
}

// ==============================================================================
// 4. STANDARDIZED PRICING FORMATTING UTILITY (Requirement 7)
// ==============================================================================

function normalizeSearchText(str) {
  if (!str) return '';
  return String(str)
    .toLowerCase()
    .replace(/['’`]/g, '')            // frankie's -> frankies, lanalou's -> lanalous
    .replace(/&/g, ' and ')           // guilt & co -> guilt and co
    .replace(/[^\w\s]/g, ' ')         // remove punctuation
    .replace(/\s+/g, ' ')             // collapse multiple spaces
    .trim();
}

// Lightweight Stemmer for matching common suffixes (plurals, -ing, -ed, etc.)
function stemWord(word) {
  if (!word || word.length < 3) return word;
  let w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y';
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.endsWith('ing') && w.length > 5) {
    let base = w.slice(0, -3);
    if (base.endsWith(base[base.length - 1])) base = base.slice(0, -1);
    return base;
  }
  if (w.endsWith('ed') && w.length > 4) return w.slice(0, -2);
  if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) return w.slice(0, -1);
  return w;
}

// 1-Typo tolerance Levenshtein check for search tokens >= 4 characters
function isFuzzyTokenMatch(queryTok, docTok) {
  if (queryTok === docTok) return true;
  // Prefix match if query token is long enough (e.g. ceramic -> ceramics)
  if (queryTok.length >= 4 && docTok.startsWith(queryTok)) return true;
  if (docTok.length >= 4 && queryTok.startsWith(docTok) && docTok.length >= queryTok.length - 1) return true;
  if (queryTok.length < 4 || docTok.length < 4 || Math.abs(queryTok.length - docTok.length) > 1) return false;

  let diffs = 0;
  let i = 0, j = 0;
  while (i < queryTok.length && j < docTok.length) {
    if (queryTok[i] !== docTok[j]) {
      diffs++;
      if (diffs > 1) return false;
      if (queryTok.length > docTok.length) { i++; continue; }
      else if (queryTok.length < docTok.length) { j++; continue; }
    }
    i++;
    j++;
  }
  if (i < queryTok.length || j < docTok.length) diffs++;
  return diffs <= 1;
}

// Classic Google Search Query Parser: Exact Phrases ("..."), Negative (-term), Boolean (OR), Field Operators (prefix:value)
function parseGoogleQuery(queryStr) {
  if (!queryStr) {
    return { exactPhrases: [], negativeTerms: [], fieldFilters: {}, orGroups: [], standardTokens: [] };
  }
  const q = String(queryStr).trim();
  const exactPhrases = [];

  // 1. Extract quoted exact phrases: "open mic", "life drawing"
  const quoteRegex = /"([^"]+)"/g;
  let match;
  while ((match = quoteRegex.exec(q)) !== null) {
    if (match[1] && match[1].trim()) {
      exactPhrases.push(match[1].toLowerCase().trim());
    }
  }
  const remaining = q.replace(/"[^"]+"/g, ' ');

  const negativeTerms = [];
  const fieldFilters = {};
  const orGroups = [];
  const standardTokens = [];

  const rawTokens = remaining.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < rawTokens.length) {
    const tok = rawTokens[i];

    // Check for field filter: prefix:value
    if (tok.includes(':') && !tok.startsWith('-')) {
      const colonIdx = tok.indexOf(':');
      const prefix = tok.slice(0, colonIdx).toLowerCase().trim();
      const val = tok.slice(colonIdx + 1).trim();
      if (prefix && val) {
        fieldFilters[prefix] = val;
      }
      i++;
      continue;
    }

    // Check for negative exclusion: -term
    if (tok.startsWith('-') && tok.length > 1) {
      negativeTerms.push(tok.slice(1).toLowerCase().trim());
      i++;
      continue;
    }

    // Check for boolean OR: tok OR next_tok
    if (i + 2 < rawTokens.length && rawTokens[i + 1].toUpperCase() === 'OR') {
      orGroups.push([tok.toLowerCase().trim(), rawTokens[i + 2].toLowerCase().trim()]);
      i += 3;
      continue;
    }

    if (tok.toUpperCase() === 'OR') {
      i++;
      continue;
    }

    standardTokens.push(tok.toLowerCase().trim());
    i++;
  }

  return {
    exactPhrases,
    negativeTerms,
    fieldFilters,
    orGroups,
    standardTokens
  };
}

// Classic Google-Style Matcher with Stemming, Fuzzy Typo Tolerance, Field Filters & BM25 Relevance Scoring
function matchesGoogleSearch(ev, parsed) {
  const titleNorm = normalizeSearchText(ev.title || '');
  const venueNorm = normalizeSearchText(ev.venue || '');
  const descNorm = normalizeSearchText(ev.description || '');
  const artistNorm = normalizeSearchText(ev.artist || '');
  const orgNorm = normalizeSearchText(ev.organizer || '');
  const catNorm = normalizeSearchText(((Array.isArray(ev.categories) ? ev.categories.join(' ') : '') + ' ' + (ev.category || '')).trim());
  const catLabelNorm = normalizeSearchText(ev.categoryLabel || '');
  const addrNorm = normalizeSearchText(ev.address || '');
  const neighNorm = normalizeSearchText(ev.neighborhood || '');
  const tagsNorm = normalizeSearchText(Array.isArray(ev.subTags) ? ev.subTags.join(' ') : '');
  const venueAliasesNorm = normalizeSearchText(Array.isArray(ev.venueAliases) ? ev.venueAliases.join(' ') : '');
  const performersNorm = normalizeSearchText(Array.isArray(ev.performers) ? ev.performers.join(' ') : (ev.performers || ''));
  const daysList = Array.isArray(ev.daysOfWeek) ? ev.daysOfWeek.map(d => String(d).toLowerCase()) : [];
  const daysNorm = daysList.join(' ');

  // Contextual aliases & landmark associations
  let extraAliases = '';
  const vLower = (ev.venue || '').toLowerCase();
  const tLower = (ev.title || '').toLowerCase();
  const cLower = (ev.category || '').toLowerCase();

  if (vLower.includes('slice of life') || tLower.includes('slice of life')) {
    extraAliases += ' east van gallery maker social commercial drive';
    if (tLower.includes('clay')) {
      extraAliases += ' pottery ceramics handbuilding sculpting';
    } else if (tLower.includes('printmaking') || tLower.includes('craft')) {
      extraAliases += ' linocut zine printmaking stamp craft';
    } else if (tLower.includes('drawing')) {
      extraAliases += ' sketching figure live model life drawing';
    } else if (tLower.includes('lego')) {
      extraAliases += ' bricks building adult lego blocks';
    }
  } else if (vLower.includes('public disco') || tLower.includes('public disco')) {
    extraAliases += ' dance party block party djs electronic house music open air warehouse bentall outdoor plaza roving dance';
  } else if (vLower.includes('hand eye') || tLower.includes('hand eye')) {
    extraAliases += ' pottery ceramics open studio wheel throwing handbuilding clay clark drive';
  } else if (vLower.includes('cafe au clay') || tLower.includes('cafe au clay')) {
    extraAliases += ' pottery ceramics painting bisque mugs granville island false creek creative date';
  } else if (vLower.includes('basic inquiry') || tLower.includes('basic inquiry')) {
    extraAliases += ' life drawing figure drawing sketching model live model chinatown main st art';
  } else if (cLower === 'crafts') {
    extraAliases += ' craft crafts studio maker hands on tactile workshop drop in art';
  } else if (cLower === 'music') {
    extraAliases += ' concert gig live band jazz soul indie rock dance electronic';
  } else if (cLower === 'shows') {
    extraAliases += ' comedy standup improv theatre performance show';
  } else if (cLower === 'cinema') {
    extraAliases += ' movie film screening matinee midnight cult art house';
  }

  const customTiersNorm = [
    ev.tier_custom_name_1, ev.tier_custom_name_2, ev.tier_custom_name_3, ev.tier_custom_name_4, ev.tier_custom_name_5
  ].filter(Boolean).map(normalizeSearchText).join(' ');
  const tiersListNorm = Array.isArray(ev.tiers) ? ev.tiers.map(t => normalizeSearchText(t.name)).join(' ') : '';
  const access = typeof window.getVenueAccessibility === 'function' ? window.getVenueAccessibility(ev.venue) : null;
  const accessNorm = access ? normalizeSearchText(`${access.status} ${access.label} ${access.summary} ${access.entrance} ${access.seating} ${access.washroom} wheelchair accessibility disability accessible elevator step free`) : '';

  const allContent = `${titleNorm} ${venueNorm} ${descNorm} ${artistNorm} ${orgNorm} ${tagsNorm} ${catNorm} ${catLabelNorm} ${addrNorm} ${neighNorm} ${venueAliasesNorm} ${performersNorm} ${daysNorm} ${customTiersNorm} ${tiersListNorm} ${extraAliases} ${accessNorm}`;
  const docTokens = allContent.split(' ').filter(tok => tok.length > 0);
  const docStems = docTokens.map(stemWord);

  // 1. Negative Exclusions (-term)
  for (const neg of parsed.negativeTerms) {
    const negNorm = normalizeSearchText(neg);
    const negStem = stemWord(negNorm);
    if (allContent.includes(negNorm) || docStems.includes(negStem)) {
      return [false, 0];
    }
  }

  // 2. Field Filters (prefix:value)
  for (const [prefix, rawVal] of Object.entries(parsed.fieldFilters)) {
    const valNorm = normalizeSearchText(rawVal);
    const valStr = String(rawVal).toLowerCase().trim();

    if (prefix === 'venue' || prefix === 'v') {
      if (!venueNorm.includes(valNorm) && !venueAliasesNorm.includes(valNorm)) {
        return [false, 0];
      }
    } else if (prefix === 'cat' || prefix === 'category' || prefix === 'c') {
      if (!catNorm.includes(valNorm) && !catLabelNorm.includes(valNorm)) {
        return [false, 0];
      }
    } else if (prefix === 'area' || prefix === 'neighborhood' || prefix === 'near' || prefix === 'n') {
      if (!neighNorm.includes(valNorm) && !addrNorm.includes(valNorm)) {
        return [false, 0];
      }
    } else if (prefix === 'day' || prefix === 'd') {
      const dayMap = { fri: 'fri', friday: 'fri', sat: 'sat', saturday: 'sat', sun: 'sun', sunday: 'sun', mon: 'mon', monday: 'mon', tue: 'tue', tuesday: 'tue', wed: 'wed', wednesday: 'wed', thu: 'thu', thursday: 'thu' };
      const targetDay = dayMap[valNorm] || valNorm;
      if (targetDay === 'weekend') {
        if (!daysList.some(d => ['fri', 'sat', 'sun'].includes(d)) && !ev.isDaily) {
          return [false, 0];
        }
      } else if (!daysList.includes(targetDay) && !ev.isDaily) {
        return [false, 0];
      }
    } else if (prefix === 'price' || prefix === 'p') {
      const price = parseFloat(ev.price || 0.0);
      if (valStr === 'free' || valStr === '0') {
        if (price > 0) return [false, 0];
      } else if (valStr.startsWith('<=')) {
        const limit = parseFloat(valStr.slice(2));
        if (!isNaN(limit) && price > limit) return [false, 0];
      } else if (valStr.startsWith('<')) {
        const limit = parseFloat(valStr.slice(1));
        if (!isNaN(limit) && price >= limit) return [false, 0];
      } else if (valStr.startsWith('>=')) {
        const limit = parseFloat(valStr.slice(2));
        if (!isNaN(limit) && price < limit) return [false, 0];
      } else if (valStr.startsWith('>')) {
        const limit = parseFloat(valStr.slice(1));
        if (!isNaN(limit) && price <= limit) return [false, 0];
      } else {
        const limit = parseFloat(valStr);
        if (!isNaN(limit) && price > limit) return [false, 0];
      }
    } else if (prefix === 'org' || prefix === 'organizer') {
      if (!orgNorm.includes(valNorm)) {
        return [false, 0];
      }
    }
  }

  // 3. Exact Phrase Matching ("...")
  for (const phrase of parsed.exactPhrases) {
    const phraseNorm = normalizeSearchText(phrase);
    if (!allContent.includes(phraseNorm)) {
      return [false, 0];
    }
  }

  // 4. Boolean OR Groups
  for (const orGroup of parsed.orGroups) {
    let groupMatched = false;
    for (const opt of orGroup) {
      const optNorm = normalizeSearchText(opt);
      const optStem = stemWord(optNorm);
      if (allContent.includes(optNorm) || docStems.includes(optStem) || docTokens.some(dt => isFuzzyTokenMatch(optNorm, dt))) {
        groupMatched = true;
        break;
      }
    }
    if (!groupMatched) {
      return [false, 0];
    }
  }

  // 5. Standard Positive Tokens (must all match via substring, stem, or fuzzy typo tolerance)
  for (const tok of parsed.standardTokens) {
    const tokNorm = normalizeSearchText(tok);
    const tokStem = stemWord(tokNorm);
    const matched = allContent.includes(tokNorm) ||
                    docStems.includes(tokStem) ||
                    docTokens.some(dt => isFuzzyTokenMatch(tokNorm, dt));
    if (!matched) {
      return [false, 0];
    }
  }

  // 6. Calculate BM25-Style Relevance Score
  let score = 10;
  for (const phrase of parsed.exactPhrases) {
    const pNorm = normalizeSearchText(phrase);
    if (titleNorm.includes(pNorm)) score += 100;
    else if (venueNorm.includes(pNorm) || artistNorm.includes(pNorm) || orgNorm.includes(pNorm)) score += 50;
    else score += 20;
  }

  for (const tok of parsed.standardTokens) {
    const tNorm = normalizeSearchText(tok);
    const tStem = stemWord(tNorm);
    if (titleNorm.includes(tNorm) || titleNorm.includes(tStem)) {
      score += 40;
    } else if (artistNorm.includes(tNorm) || venueNorm.includes(tNorm) || orgNorm.includes(tNorm)) {
      score += 25;
    } else if (tagsNorm.includes(tNorm) || catNorm.includes(tNorm)) {
      score += 15;
    } else if (descNorm.includes(tNorm)) {
      score += 8;
    } else {
      score += 3;
    }
  }

  return [true, score];
}

// Backward-compatible wrapper
function matchesSmartSearch(ev, query) {
  if (!query) return true;
  const parsed = parseGoogleQuery(query);
  return matchesGoogleSearch(ev, parsed)[0];
}

// 1-Click Venue Isolation Action (Requirement: Unselect all other filters so all events at venue are shown)
function filterByVenue(venueName) {
  if (state.selectedVenue === venueName) {
    state.selectedVenue = null;
  } else {
    state.selectedVenue = venueName;
    // Unselect all other filters so all events at the venue are shown despite any active filters
    state.category = 'all';
    state.minBudget = 0;
    state.maxBudget = 50;
    state.hideDaily = false;
    state.frequency = 'all';
    state.dayOfWeek = 'all';
    state.timeSlot = 'all';
    state.selectedNeighborhoods = new Set(window.NEIGHBORHOODS || []);
    state.selectedTag = null;
    state.searchQuery = '';
    state.pricingType = 'all';
    if (state.activeFestivalId) state.activeFestivalId = null;

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    const btnClearSearch = document.getElementById('btn-clear-search');
    if (btnClearSearch) btnClearSearch.style.display = 'none';
    const minSlider = document.getElementById('min-spend-slider');
    const maxSlider = document.getElementById('max-spend-slider');
    if (minSlider) minSlider.value = 0;
    if (maxSlider) maxSlider.value = 50;
    const chkSched = document.getElementById('chk-scheduled-only') || document.getElementById('hide-daily-toggle');
    if (chkSched) chkSched.checked = false;
    state.accessibleOnly = false;
    const chkAccess = document.getElementById('chk-accessible-only');
    if (chkAccess) chkAccess.checked = false;

    renderCategoryPills();
    renderDayPills();
    renderTimePills();
    renderNeighborhoodPills();
    renderFrequencyPills();
    updateSliderVisuals();
  }
  applyFiltersAndRender();
  const banner = document.getElementById('active-venue-banner');
  if (banner) {
    banner.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function clearSelectedVenue() {
  state.selectedVenue = null;
  applyFiltersAndRender();
}

function resetCategoryForSearch() {
  state.category = 'all';
  renderCategoryPills();
  applyFiltersAndRender();
}

function resetAllFilters() {
  state.minBudget = 0;
  state.maxBudget = 50;
  state.hideDaily = false;
  state.category = 'all';
  state.frequency = 'all';
  state.dayOfWeek = 'all';
  state.timeSlot = 'all';
  state.selectedNeighborhoods = new Set(window.NEIGHBORHOODS);
  state.selectedTag = null;
  state.selectedVenue = null;
  state.searchQuery = '';
  
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  const minSlider = document.getElementById('min-spend-slider');
  const maxSlider = document.getElementById('max-spend-slider');
  if (minSlider) minSlider.value = 0;
  if (maxSlider) maxSlider.value = 50;
  
  renderCategoryPills();
  renderDayPills();
  renderTimePills();
  renderNeighborhoodPills();
  renderFrequencyPills();
  updateSliderVisuals();
  applyFiltersAndRender();
}

function formatStandardPrice(ev) {
  // 1. If explicitly sold out
  if (ev.isSoldOut || ev.is_sold_out) {
    if (ev.priceLabel && (ev.priceLabel.toLowerCase().includes('sold out') || ev.priceLabel.toLowerCase().includes('ended'))) {
      return ev.priceLabel;
    }
  }

  // 2. If explicit priceLabel exists on the event, prioritize it (normalize erroneous "$0.00 door")
  if (ev.priceLabel) {
    if (ev.priceLabel === '$0.00 door' || (ev.price === 0 && ev.priceLabel.includes('$0.00') && !ev.isFree)) {
      return 'Free ($0)';
    }
    if (ev.priceLabel.toLowerCase().includes('sold out') || ev.priceLabel.toLowerCase().includes('ended')) {
      return ev.priceLabel;
    }
    if (!ev.tiers || ev.tiers.length <= 1) {
      return ev.priceLabel;
    }
  }

  const tiers = Array.isArray(ev.tiers) ? ev.tiers : resolveEventTiers(ev);
  const activeTiers = tiers.filter(t => t.isAvailable && t.price <= 50);

  // 3. Multi-tier events always evaluate and display active tier range
  if (activeTiers.length > 1) {
    const minP = Math.min(...activeTiers.map(t => t.price));
    const maxP = Math.max(...activeTiers.map(t => t.price));
    if (minP === maxP) {
      return minP === 0 ? 'Free ($0)' : `$${minP.toFixed(2)} all-in`;
    }
    if (minP === 0) {
      return `Free – $${maxP.toFixed(2)} all-in`;
    }
    return `$${minP.toFixed(2)} – $${maxP.toFixed(2)} all-in`;
  } else if (activeTiers.length === 1) {
    const p = activeTiers[0].price;
    return p === 0 ? 'Free ($0)' : `$${p.toFixed(2)} all-in`;
  }

  // 4. If all advance tiers are unavailable, check door or sold out
  if (tiers.length > 0 && activeTiers.length === 0) {
    const doorTier = tiers.find(t => t.isDoor);
    if (doorTier) {
      return `$${doorTier.price.toFixed(2)} door`;
    }
    const hasSoldOut = tiers.some(t => t.isSoldOut);
    if (hasSoldOut) return 'Sold Out';
    const hasExpired = tiers.some(t => t.isExpired);
    if (hasExpired) return 'Presale Ended';
  }

  // 5. Strict Free Check: only if price is 0 AND no paid tiers exist
  if ((ev.isFree || ev.price === 0) && (!tiers || !tiers.some(t => t.price > 0 && t.isAvailable))) {
    return 'Free ($0)';
  }
  if (ev.pricingType === 'door') {
    return ev.price === 0 ? 'Free ($0)' : `$${ev.price.toFixed(2)} door`;
  }
  if (ev.pricingType === 'food-drink') {
    return `Free entry (~$${ev.price.toFixed(0)} food/drink)`;
  }
  // Platform ticket breakdown
  return `$${ev.price.toFixed(2)} all-in`;
}

// ==============================================================================
// 5. DYNAMIC RECURRING DATES ENGINE & EVENT CARD RENDERING
// ==============================================================================

function calculateNextTwoDates(ev) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const DAY_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

  // 1. Strict Evidence-Grounded Confirmed Dates First
  if (Array.isArray(ev.confirmedDates) && ev.confirmedDates.length > 0) {
    if (ev.confirmedDates.length > 0) {
      const validFuture = [];
      for (const dStr of ev.confirmedDates) {
        if (!dStr) continue;
        const parts = dStr.split('-');
        if (parts.length === 3) {
          const cand = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          if (cand.getTime() === today.getTime()) {
            const closing = getEventClosingTimeToday(ev, now);
            if (!closing.hasEnded) {
              validFuture.push(cand);
            }
          } else if (cand > today) {
            validFuture.push(cand);
          }
        }
      }
      if (validFuture.length > 0) {
        validFuture.sort((a, b) => a - b);
        const formatted = validFuture.slice(0, 2).map(d => {
          const isToday = d.getTime() === today.getTime();
          const isTomorrow = d.getTime() === (today.getTime() + 86400000);
          const prefix = isToday ? 'Today (' : (isTomorrow ? 'Tomorrow (' : '');
          const suffix = (isToday || isTomorrow) ? ')' : '';
          const str = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
          return `${prefix}${str}${suffix}`;
        });
        return {
          type: 'confirmed',
          label: formatted.length > 1 ? 'Confirmed Dates' : 'Confirmed Next Date',
          dates: formatted.join(' • ')
        };
      }
    }
    // Confirmed dates array provided but 0 future dates found
    if (ev.frequency === 'seasonal' || ev.frequency === 'limited-run' || ev.isRoving) {
      return {
        type: 'seasonal',
        label: 'Seasonal Schedule',
        dates: 'Seasonal / Awaiting Next Schedule'
      };
    }
  }

  // 3. Seasonal, Nomadic & Annual Festivals
  if (ev.frequency === 'seasonal' || ev.frequency === 'limited-run' || ev.frequency === 'annual' || ev.isRoving) {
    const sRaw = ev.startIso || ev.startDate || ev.start_date;
    if (sRaw) {
      const start = new Date(sRaw.length === 10 ? sRaw + 'T00:00:00' : sRaw);
      if (!isNaN(start.getTime())) {
        const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
        if (startDay.getTime() === today.getTime()) {
          const closing = getEventClosingTimeToday(ev, now);
          if (!closing.hasEnded) {
            const fmt = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
            return {
              type: 'seasonal',
              label: ev.frequency === 'limited-run' ? 'Confirmed Date' : 'Confirmed Festival Date',
              dates: `Today (${fmt})`
            };
          }
        } else if (startDay > today) {
          const fmt = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
          const endRaw = ev.endIso || ev.endDate || ev.end_date;
          const endFmt = endRaw ? new Date(endRaw.length === 10 ? endRaw + 'T00:00:00' : endRaw).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
          return {
            type: 'seasonal',
            label: ev.frequency === 'limited-run' ? 'Confirmed Run' : 'Confirmed Festival Date',
            dates: endFmt ? `${fmt} – ${endFmt}` : fmt
          };
        }
      }
    }
    return {
      type: 'seasonal',
      label: ev.frequency === 'limited-run' ? 'Schedule' : 'Seasonal Schedule',
      dates: ev.dateSchedule || 'Awaiting Next Scheduled Dates • Check Venue Calendar'
    };
  }

  // 4. Genuine Weekly Ongoing Residencies (STRICTLY when frequency === 'weekly' and NOT seasonal or roving)
  if (ev.frequency === 'weekly') {
    const targetDays = (ev.daysOfWeek || [])
      .map(d => DAY_MAP[d.toLowerCase()])
      .filter(d => d !== undefined);

    if (targetDays.length > 0) {
      const dates = [];
      for (let i = 0; i < 21; i++) {
        const candidate = new Date(today);
        candidate.setDate(candidate.getDate() + i);
        if (targetDays.includes(candidate.getDay())) {
          if (i === 0) {
            const closing = getEventClosingTimeToday(ev, now);
            if (closing.hasEnded) continue;
          }
          dates.push(candidate);
          if (dates.length === 2) break;
        }
      }
      if (dates.length > 0) {
        const formatted = dates.map(d => {
          const isToday = d.getTime() === today.getTime();
          const isTomorrow = d.getTime() === (today.getTime() + 86400000);
          const prefix = isToday ? 'Today (' : (isTomorrow ? 'Tomorrow (' : '');
          const suffix = (isToday || isTomorrow) ? ')' : '';
          const str = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
          return `${prefix}${str}${suffix}`;
        });
        return {
          type: 'weekly',
          label: 'Next 2 Dates',
          dates: formatted.join(' • ')
        };
      }
    }
  }

  // 5. Monthly Series
  if (ev.frequency === 'monthly') {
    if (ev.startIso) {
      const start = new Date(ev.startIso);
      if (!isNaN(start.getTime()) && start >= today) {
        const fmt = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        return {
          type: 'monthly',
          label: 'Next Confirmed Show',
          dates: fmt
        };
      }
    }
    return {
      type: 'monthly',
      label: 'Monthly Series',
      dates: ev.dateSchedule || 'Check venue calendar'
    };
  }

  // 6. One-off Events
  if (ev.startIso) {
    const start = new Date(ev.startIso);
    if (!isNaN(start.getTime())) {
      if (start >= today) {
        const isToday = start.toDateString() === today.toDateString();
        const fmt = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        return {
          type: 'one-off',
          label: 'Confirmed Date',
          dates: isToday ? `Today (${fmt})` : fmt
        };
      } else {
        return {
          type: 'concluded',
          label: 'Event Status',
          dates: 'Concluded'
        };
      }
    }
  }

  // 7. Daily Perennial Drop-In Invariants (Parks, Seawall, permanent galleries)
  if (ev.lifecycleType === 'perennial_drop_in' || ev.lifecycle_type === 'perennial_drop_in' || ev.access_model === 'open_public_space' || ev.isDaily) {
    const closing = getEventClosingTimeToday(ev, now);
    const startOffset = closing.hasEnded ? 1 : 0;
    const d1 = new Date(today);
    d1.setDate(d1.getDate() + startOffset);
    const d2 = new Date(today);
    d2.setDate(d2.getDate() + startOffset + 1);
    const fmt1 = d1.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const fmt2 = d2.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const pfx1 = startOffset === 0 ? 'Today' : 'Tomorrow';
    const pfx2 = startOffset === 0 ? 'Tomorrow' : d2.toLocaleDateString('en-US', { weekday: 'short' });
    return {
      type: 'daily',
      label: closing.hasEnded ? 'Open Daily (Closed for today)' : 'Open Daily',
      dates: `${pfx1} (${fmt1}) • ${pfx2} (${fmt2})`
    };
  }

  return null;
}

// ==============================================================================
// 6. TIME-HORIZON GROUPING ENGINE (Today, This Week, Next Week, Upcoming)
// Organized strictly with Mondays as the start of the week.
// ==============================================================================

function getEventTimeBucket(ev, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat

  // Monday-based week calculation:
  // In JS: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
  // Days since Monday: Mon->0, Tue->1, ..., Sun->6
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const thisWeekMonday = new Date(today);
  thisWeekMonday.setDate(today.getDate() - daysSinceMonday);
  thisWeekMonday.setHours(0, 0, 0, 0);

  const thisWeekSunday = new Date(thisWeekMonday);
  thisWeekSunday.setDate(thisWeekMonday.getDate() + 6);
  thisWeekSunday.setHours(23, 59, 59, 999);

  const nextWeekMonday = new Date(thisWeekMonday);
  nextWeekMonday.setDate(thisWeekMonday.getDate() + 7);
  nextWeekMonday.setHours(0, 0, 0, 0);

  const nextWeekSunday = new Date(nextWeekMonday);
  nextWeekSunday.setDate(nextWeekMonday.getDate() + 6);
  nextWeekSunday.setHours(23, 59, 59, 999);

  const DAY_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

  // 1. Confirmed dates array First
  if (Array.isArray(ev.confirmedDates) && ev.confirmedDates.length > 0) {
    const futureDates = [];
    for (const dStr of ev.confirmedDates) {
      if (!dStr) continue;
      const parts = dStr.split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        if (d.getTime() === today.getTime()) {
          const status = getEventClosingTimeToday(ev, now);
          if (!status.hasEnded) {
            futureDates.push(d);
          }
        } else if (d > today) {
          futureDates.push(d);
        }
      }
    }
    if (futureDates.length > 0) {
      futureDates.sort((a, b) => a - b);
      return categorizeDateBucket(futureDates[0], today, tomorrow, thisWeekSunday, nextWeekMonday, nextWeekSunday);
    }
  }

  // 2. Multi-day date ranges (active festival runs, seasonal programs, exhibitions)
  const startRaw = ev.startIso || ev.startDate || ev.start_date;
  const endRaw = ev.endIso || ev.endDate || ev.end_date;
  if (startRaw && endRaw) {
    const startDt = new Date(startRaw.length === 10 ? startRaw + 'T00:00:00' : startRaw);
    const endDt = new Date(endRaw.length === 10 ? endRaw + 'T23:59:59' : endRaw);
    if (!isNaN(startDt.getTime()) && !isNaN(endDt.getTime())) {
      const startDay = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate());
      const endDay = new Date(endDt.getFullYear(), endDt.getMonth(), endDt.getDate());
      if (today < startDay) {
        return categorizeDateBucket(startDay, today, tomorrow, thisWeekSunday, nextWeekMonday, nextWeekSunday);
      }
      if (today >= startDay && today <= endDay) {
        const targetDays = (Array.isArray(ev.daysOfWeek) && ev.daysOfWeek.length > 0)
          ? ev.daysOfWeek.map(d => DAY_MAP[String(d).toLowerCase()]).filter(d => d !== undefined)
          : [];
        const matchesToday = targetDays.length === 0 || targetDays.includes(today.getDay());
        if (matchesToday) {
          const status = getEventClosingTimeToday(ev, now);
          if (!status.hasEnded) {
            return { bucket: 'today', date: today };
          }
        }
        for (let offset = 1; offset <= 14; offset++) {
          const candidate = new Date(today);
          candidate.setDate(candidate.getDate() + offset);
          if (candidate > endDay) break;
          if (targetDays.length === 0 || targetDays.includes(candidate.getDay())) {
            return categorizeDateBucket(candidate, today, tomorrow, thisWeekSunday, nextWeekMonday, nextWeekSunday);
          }
        }
      }
    }
  }

  // 3. startIso / single date
  const singleDateRaw = ev.startIso || ev.startDate || ev.start_date;
  if (singleDateRaw) {
    const d = new Date(singleDateRaw.length === 10 ? singleDateRaw + 'T00:00:00' : singleDateRaw);
    if (!isNaN(d.getTime())) {
      const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const isDateCancelled = Array.isArray(ev.cancelledDates) && ev.cancelledDates.includes(dKey);
      if (!isDateCancelled) {
        if (startDay.getTime() === today.getTime()) {
          const status = getEventClosingTimeToday(ev, now);
          if (!status.hasEnded) {
            return categorizeDateBucket(startDay, today, tomorrow, thisWeekSunday, nextWeekMonday, nextWeekSunday);
          }
        } else if (startDay > today) {
          return categorizeDateBucket(startDay, today, tomorrow, thisWeekSunday, nextWeekMonday, nextWeekSunday);
        }
      }
    }
  }

  // 4. Weekly recurring programs
  if (ev.frequency === 'weekly' && Array.isArray(ev.daysOfWeek) && ev.daysOfWeek.length > 0) {
    const targetDays = ev.daysOfWeek
      .map(d => DAY_MAP[String(d).toLowerCase()])
      .filter(d => d !== undefined);
    if (targetDays.length > 0) {
      for (let offset = 0; offset < 28; offset++) {
        const candidate = new Date(today);
        candidate.setDate(candidate.getDate() + offset);
        const candKey = `${candidate.getFullYear()}-${String(candidate.getMonth() + 1).padStart(2, '0')}-${String(candidate.getDate()).padStart(2, '0')}`;
        if (Array.isArray(ev.cancelledDates) && ev.cancelledDates.includes(candKey)) {
          continue;
        }
        if (targetDays.includes(candidate.getDay())) {
          if (offset === 0) {
            const status = getEventClosingTimeToday(ev, now);
            if (status.hasEnded) {
              // Today's session has ended or is closed -> move to next occurrence!
              continue;
            }
          }
          return categorizeDateBucket(candidate, today, tomorrow, thisWeekSunday, nextWeekMonday, nextWeekSunday);
        }
      }
    }
  }

  // 5. Daily Perennial Drop-Ins (Parks, Seawall, permanent galleries with no future scheduled dates)
  if (ev.lifecycleType === 'perennial_drop_in' || ev.lifecycle_type === 'perennial_drop_in' || ev.access_model === 'open_public_space' || ev.isDaily) {
    const status = getEventClosingTimeToday(ev, now);
    if (!status.hasEnded) {
      return { bucket: 'today', date: today };
    }
    // When closed today or closing time has passed, find the next day the venue is actually open
    const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const wh = ev.weekly_hours || ev.weeklyHours;
    for (let offset = 1; offset <= 7; offset++) {
      const cand = new Date(today);
      cand.setDate(cand.getDate() + offset);
      const candKey = DAY_KEYS[cand.getDay()];
      if (wh && typeof wh === 'object') {
        const h = wh[candKey];
        if (!h || /closed/i.test(String(h))) {
          continue; // Venue is closed on this candidate day
        }
      }
      return categorizeDateBucket(cand, today, tomorrow, thisWeekSunday, nextWeekMonday, nextWeekSunday);
    }
    return { bucket: 'upcoming', date: null };
  }

  return { bucket: 'upcoming', date: null };
}

function categorizeDateBucket(d, today, tomorrow, thisWeekSunday, nextWeekMonday, nextWeekSunday) {
  const dTime = d.getTime();
  const todayTime = today.getTime();
  const tomorrowTime = tomorrow.getTime();

  if (dTime === todayTime) {
    return { bucket: 'today', date: d };
  } else if (dTime === tomorrowTime) {
    return { bucket: 'tomorrow', date: d };
  } else if (dTime > tomorrowTime && dTime <= thisWeekSunday.getTime()) {
    return { bucket: 'this_week', date: d };
  } else if (dTime >= nextWeekMonday.getTime() && dTime <= nextWeekSunday.getTime()) {
    return { bucket: 'next_week', date: d };
  } else {
    return { bucket: 'upcoming', date: d };
  }
}

window.toggleTimeGroup = function(groupKey) {
  if (!state.collapsedTimeGroups) {
    state.collapsedTimeGroups = new Set();
  }
  if (state.collapsedTimeGroups.has(groupKey)) {
    state.collapsedTimeGroups.delete(groupKey);
  } else {
    state.collapsedTimeGroups.add(groupKey);
  }
  applyFiltersAndRender();
};

window.smoothScrollToTimeGroup = function(groupId, event) {
  if (event) event.preventDefault();
  const key = groupId.replace(/^group-/, '');
  if (state.collapsedTimeGroups && state.collapsedTimeGroups.has(key)) {
    state.collapsedTimeGroups.delete(key);
    applyFiltersAndRender();
  }
  setTimeout(() => {
    const el = document.getElementById(groupId);
    if (el) {
      const yOffset = -70;
      const y = el.getBoundingClientRect().top + window.pageYOffset + yOffset;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  }, 20);
};

window.toggleWeeklyHours = function(eventId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const table = document.getElementById(`hours-table-${eventId}`);
  const btn = document.getElementById(`btn-toggle-hours-${eventId}`);
  if (!table) return;
  const isHidden = (table.style.display === 'none' || table.style.display === '');
  if (isHidden) {
    table.style.display = 'block';
    if (btn) {
      btn.classList.add('expanded');
      btn.setAttribute('aria-expanded', 'true');
      const textSpan = btn.querySelector('.toggle-text');
      const chevSpan = btn.querySelector('.wh-chevron');
      if (textSpan) textSpan.textContent = 'Hide Week';
      if (chevSpan) chevSpan.textContent = '▴';
    }
  } else {
    table.style.display = 'none';
    if (btn) {
      btn.classList.remove('expanded');
      btn.setAttribute('aria-expanded', 'false');
      const textSpan = btn.querySelector('.toggle-text');
      const chevSpan = btn.querySelector('.wh-chevron');
      if (textSpan) textSpan.textContent = 'Full Week';
      if (chevSpan) chevSpan.textContent = '▾';
    }
  }
};

window.toggleShowings = function(eventId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const el = document.getElementById(`showings-more-${eventId}`);
  const btn = document.getElementById(`btn-toggle-showings-${eventId}`);
  if (!el) return;
  const isHidden = (el.style.display === 'none' || el.style.display === '');
  if (isHidden) {
    el.style.display = 'block';
    if (btn) {
      btn.classList.add('expanded');
      btn.setAttribute('aria-expanded', 'true');
      const textSpan = btn.querySelector('.toggle-text');
      const chevSpan = btn.querySelector('.wh-chevron') || btn.querySelector('.showings-chevron');
      if (textSpan) textSpan.textContent = 'Hide Dates';
      if (chevSpan) chevSpan.textContent = '▴';
    }
  } else {
    el.style.display = 'none';
    if (btn) {
      btn.classList.remove('expanded');
      btn.setAttribute('aria-expanded', 'false');
      const textSpan = btn.querySelector('.toggle-text');
      const chevSpan = btn.querySelector('.wh-chevron') || btn.querySelector('.showings-chevron');
      const totalCount = btn.getAttribute('data-count') || '';
      if (textSpan) textSpan.textContent = totalCount ? `All Dates (${totalCount})` : 'All Dates & Times';
      if (chevSpan) chevSpan.textContent = '▾';
    }
  }
};

window.toggleAdmissionTiers = function(bucketKey, eventId, event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const drawer = document.getElementById(`tiers-drawer-${bucketKey}-${eventId}`);
  const hint = document.getElementById(`tier-hint-${bucketKey}-${eventId}`);
  if (!drawer) return;
  const isHidden = (drawer.style.display === 'none' || drawer.style.display === '');
  if (isHidden) {
    drawer.style.display = 'block';
    drawer.setAttribute('aria-hidden', 'false');
    if (hint) {
      hint.textContent = 'Hide ▴';
      hint.classList.add('active');
    }
  } else {
    drawer.style.display = 'none';
    drawer.setAttribute('aria-hidden', 'true');
    if (hint) {
      hint.textContent = 'Tiers ▾';
      hint.classList.remove('active');
    }
  }
};

function renderEventCards(events) {
  const grid = document.getElementById('events-grid');
  if (!grid) return;

  const venueBannerHtml = state.selectedVenue ? `
    <div class="active-venue-banner" id="active-venue-banner" style="grid-column: 1 / -1;">
      <div class="venue-banner-content">
        <span class="venue-banner-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -2px; margin-right: 4px;"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></span>
        <span>Showing all <strong>${events.length}</strong> verified events at <strong>${state.selectedVenue}</strong></span>
      </div>
      <button type="button" class="btn-clear-venue" onclick="clearSelectedVenue()" aria-label="Clear venue filter">Clear Venue Filter ✕</button>
    </div>
  ` : '';

  // When viewing events for a specific venue (via "See events here"), do away with Today/Tomorrow/Next Week labels
  if (state.selectedVenue) {
    if (events.length === 0) {
      grid.innerHTML = `
        ${venueBannerHtml}
        <div style="grid-column: 1 / -1; text-align: center; padding: 50px 20px; color: var(--text-secondary); background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);">
          <h3 style="color: #fff; margin-bottom: 8px;">No Current Events Under $50 at ${state.selectedVenue}</h3>
          <button class="btn btn-roulette" onclick="clearSelectedVenue()">Clear Venue Filter</button>
        </div>
      `;
      return;
    }
    const cardsHtml = events.map(ev => renderSingleEventCardHtml(ev)).join('');
    grid.innerHTML = `
      ${venueBannerHtml}
      <div class="venue-events-unified-grid" style="grid-column: 1 / -1; display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px; margin-top: 14px;">
        ${cardsHtml}
      </div>
    `;
    return;
  }

  if (events.length === 0) {
    grid.innerHTML = `
      ${venueBannerHtml}
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-secondary); background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);">
        <div class="empty-icon-wrap" style="margin-bottom: 14px;"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; color: var(--accent-primary);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div>
        <h3 style="font-family: var(--font-heading); font-size: 1.3rem; color: #fff; margin-bottom: 8px;">No Outings Found Matching Filters</h3>
        <p style="font-size: 0.9rem; max-width: 440px; margin: 0 auto 18px;">
          Try selecting "All Days" or "Any Time", widening your spend slider, clearing active tags, or toggling off "Scheduled Events Only".
        </p>
        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <button class="btn btn-roulette" onclick="resetAllFilters()">Reset All Filters</button>
          <button type="button" class="btn" onclick="filterByCategory('all')" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; padding: 10px 18px; border-radius: var(--radius-md); font-weight: 600; cursor: pointer;">Show All Active Outings</button>
        </div>
      </div>
    `;
    return;
  }

  // Partition events into 5 time buckets: Today, Tomorrow, This Week, Next Week, Upcoming
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  const dayOfWeek = today.getDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const thisWeekMonday = new Date(today);
  thisWeekMonday.setDate(today.getDate() - daysSinceMonday);

  const thisWeekSunday = new Date(thisWeekMonday);
  thisWeekSunday.setDate(thisWeekMonday.getDate() + 6);

  const nextWeekMonday = new Date(thisWeekMonday);
  nextWeekMonday.setDate(thisWeekMonday.getDate() + 7);

  const nextWeekSunday = new Date(nextWeekMonday);
  nextWeekSunday.setDate(nextWeekMonday.getDate() + 6);

  const fmtMonthDay = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtWeekday = (d) => d.toLocaleDateString('en-US', { weekday: 'short' });
  const fmtFull = (d) => d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  const todayLabel = fmtFull(today);
  const tomorrowLabel = fmtFull(tomorrow);
  
  // This Week label: after tomorrow through this week's Sunday
  let thisWeekLabel;
  const dayAfterTomorrow = new Date(tomorrow);
  dayAfterTomorrow.setDate(tomorrow.getDate() + 1);
  if (dayAfterTomorrow > thisWeekSunday) {
    thisWeekLabel = `Ending ${fmtMonthDay(thisWeekSunday)}`;
  } else if (dayAfterTomorrow.getTime() === thisWeekSunday.getTime()) {
    thisWeekLabel = `${fmtWeekday(thisWeekSunday)}, ${fmtMonthDay(thisWeekSunday)}`;
  } else {
    thisWeekLabel = `${fmtWeekday(dayAfterTomorrow)} – Sun, ${fmtMonthDay(dayAfterTomorrow)} – ${fmtMonthDay(thisWeekSunday)}`;
  }

  // Next Week label
  let nextWeekLabel;
  if (tomorrow.getTime() === nextWeekMonday.getTime()) {
    const nextWeekTuesday = new Date(nextWeekMonday);
    nextWeekTuesday.setDate(nextWeekMonday.getDate() + 1);
    nextWeekLabel = `Tue – Sun, ${fmtMonthDay(nextWeekTuesday)} – ${fmtMonthDay(nextWeekSunday)}`;
  } else {
    nextWeekLabel = `Mon – Sun, ${fmtMonthDay(nextWeekMonday)} – ${fmtMonthDay(nextWeekSunday)}`;
  }
  
  const beyondDate = new Date(nextWeekSunday);
  beyondDate.setDate(beyondDate.getDate() + 1);
  const upcomingLabel = `Starting ${fmtMonthDay(beyondDate)} & Beyond`;

  const buckets = {
    today: [],
    tomorrow: [],
    this_week: [],
    next_week: [],
    upcoming: []
  };

  events.forEach(ev => {
    const { bucket, date } = getEventTimeBucket(ev, now);
    ev._computedNextDate = date;
    buckets[bucket].push(ev);
  });

  // Sort within buckets chronologically by next occurrence date, then scheduled time
  Object.keys(buckets).forEach(k => {
    buckets[k].sort((a, b) => {
      const aTime = a._computedNextDate ? a._computedNextDate.getTime() : 9999999999999;
      const bTime = b._computedNextDate ? b._computedNextDate.getTime() : 9999999999999;
      if (aTime !== bTime) return aTime - bTime;
      if (a.isDaily && !b.isDaily) return 1;
      if (!a.isDaily && b.isDaily) return -1;
      return (a.price || 0) - (b.price || 0);
    });
  });

  const bucketMeta = [
    { key: 'today', title: "Today's Events", shortTitle: "Today", icon: '⚡', range: todayLabel, list: buckets.today },
    { key: 'tomorrow', title: "Tomorrow's Events", shortTitle: "Tomorrow", icon: '🌅', range: tomorrowLabel, list: buckets.tomorrow },
    { key: 'this_week', title: "This Week's Events", shortTitle: "This Week", icon: '🗓️', range: thisWeekLabel, list: buckets.this_week },
    { key: 'next_week', title: "Next Week's Events", shortTitle: "Next Week", icon: '📅', range: nextWeekLabel, list: buckets.next_week },
    { key: 'upcoming', title: "Upcoming & Future Events", shortTitle: "Upcoming", icon: '🔮', range: upcomingLabel, list: buckets.upcoming }
  ];

  const activeBuckets = bucketMeta.filter(b => b.list.length > 0);

  // Quick navigation anchor bar (rendered if 2 or more buckets have items)
  let navBarHtml = '';
  if (activeBuckets.length > 1) {
    navBarHtml = `
      <nav class="time-nav-bar" aria-label="Jump to event timeframes">
        ${activeBuckets.map(b => `
          <a href="#group-${b.key}" class="time-nav-pill" onclick="smoothScrollToTimeGroup('group-${b.key}', event)">
            <span>${b.icon} ${b.shortTitle}</span>
            <span class="time-nav-count">${b.list.length}</span>
          </a>
        `).join('')}
      </nav>
    `;
  }

  // Render sections
  const sectionsHtml = activeBuckets.map(b => {
    const isCollapsed = Boolean(state.collapsedTimeGroups && state.collapsedTimeGroups.has(b.key));
    const cardsHtml = b.list.map(ev => renderSingleEventCardHtml(ev, b.key)).join('');
    return `
      <section class="events-time-group ${isCollapsed ? 'collapsed' : ''}" id="group-${b.key}">
        <div class="time-group-header" onclick="toggleTimeGroup('${b.key}')" role="button" tabindex="0" aria-expanded="${!isCollapsed}" aria-controls="cards-grid-${b.key}" title="Click to ${isCollapsed ? 'expand' : 'collapse'} ${b.title}">
          <div class="time-group-title-wrap">
            <span class="time-group-icon">${b.icon}</span>
            <h2 class="time-group-title">${b.title}</h2>
            <span class="time-group-date-range">${b.range}</span>
          </div>
          <div class="time-group-actions">
            <span class="time-group-count-badge">${b.list.length} event${b.list.length === 1 ? '' : 's'}</span>
            <button class="btn-group-collapse-toggle" type="button" aria-expanded="${!isCollapsed}" aria-label="${isCollapsed ? 'Expand section' : 'Collapse section'}" onclick="event.stopPropagation(); toggleTimeGroup('${b.key}')">
              <span class="toggle-icon">${isCollapsed ? '▶' : '▼'}</span>
              <span class="toggle-label">${isCollapsed ? 'Expand' : 'Collapse'}</span>
            </button>
          </div>
        </div>
        ${isCollapsed ? `
          <div class="time-group-collapsed-banner" onclick="toggleTimeGroup('${b.key}')" role="button" tabindex="0" title="Click to expand ${b.title}">
            <span class="collapsed-banner-info">${b.icon} <strong>${b.title}</strong> is collapsed (${b.list.length} event${b.list.length === 1 ? '' : 's'})</span>
            <span class="collapsed-banner-action">Click to expand outings ▾</span>
          </div>
        ` : `
          <div class="time-group-cards-grid" id="cards-grid-${b.key}">
            ${cardsHtml}
          </div>
        `}
      </section>
    `;
  }).join('');

  grid.innerHTML = venueBannerHtml + navBarHtml + sectionsHtml;
}

function formatCardTopDate(ev, bucketKey) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const toIsoDateStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  if (bucketKey === 'tomorrow') {
    const monthDay = tomorrow.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { badgeText: `Tomorrow, ${monthDay}`, isTomorrow: true, icon: '', dateObj: tomorrow, dateStr: toIsoDateStr(tomorrow) };
  }
  if (bucketKey === 'today') {
    const monthDay = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { badgeText: `Today, ${monthDay}`, isToday: true, icon: '', dateObj: today, dateStr: toIsoDateStr(today) };
  }

  // 1. Confirmed dates array First
  if (Array.isArray(ev.confirmedDates) && ev.confirmedDates.length > 0) {
    const valid = ev.confirmedDates
      .map(dStr => {
        if (!dStr) return null;
        const parts = dStr.split('-');
        if (parts.length !== 3) return null;
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      })
      .filter(d => {
        if (!d) return false;
        if (d.getTime() === today.getTime()) {
          const status = getEventClosingTimeToday(ev, now);
          return !status.hasEnded;
        }
        return d > today;
      })
      .sort((a, b) => a - b);

    if (valid.length > 0) {
      const nextDate = valid[0];
      const isToday = nextDate.getTime() === today.getTime();
      const isTomorrow = nextDate.getTime() === tomorrow.getTime();
      const monthDay = nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const weekday = nextDate.toLocaleDateString('en-US', { weekday: 'short' });

      if (isToday) {
        return { badgeText: `Today, ${monthDay}`, isToday: true, icon: '', dateObj: nextDate, dateStr: toIsoDateStr(nextDate) };
      } else if (isTomorrow) {
        return { badgeText: `Tomorrow, ${monthDay}`, isTomorrow: true, icon: '', dateObj: nextDate, dateStr: toIsoDateStr(nextDate) };
      } else {
        return { badgeText: `${weekday}, ${monthDay}`, isFuture: true, icon: '', dateObj: nextDate, dateStr: toIsoDateStr(nextDate) };
      }
    }
  }

  // 2. Multi-day date ranges (active festival runs, seasonal programs, exhibitions)
  const startRaw = ev.startIso || ev.startDate || ev.start_date;
  const endRaw = ev.endIso || ev.endDate || ev.end_date;
  if (startRaw && endRaw) {
    try {
      const startDt = new Date(startRaw.length === 10 ? startRaw + 'T00:00:00' : startRaw);
      const endDt = new Date(endRaw.length === 10 ? endRaw + 'T23:59:59' : endRaw);
      const startZero = new Date(startDt.getFullYear(), startDt.getMonth(), startDt.getDate());
      const endZero = new Date(endDt.getFullYear(), endDt.getMonth(), endDt.getDate());

      // If festival starts in the future, it is upcoming on startZero
      if (today < startZero) {
        const isTomorrow = startZero.getTime() === tomorrow.getTime();
        const monthDay = startZero.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const weekday = startZero.toLocaleDateString('en-US', { weekday: 'short' });
        if (isTomorrow) {
          return { badgeText: `Tomorrow, ${monthDay}`, isTomorrow: true, icon: '', dateObj: startZero };
        } else {
          return { badgeText: `${weekday}, ${monthDay}`, isFuture: true, icon: '', dateObj: startZero };
        }
      }

      if (today >= startZero && today <= endZero) {
        const DAY_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
        const curDay = today.getDay();
        const hasDaysOfWeek = Array.isArray(ev.daysOfWeek) && ev.daysOfWeek.length > 0;
        const matchesToday = !hasDaysOfWeek || ev.daysOfWeek.some(dow => DAY_MAP[dow.toLowerCase()] === curDay);

        if (matchesToday) {
          const status = getEventClosingTimeToday(ev, now);
          if (!status.hasEnded) {
            const monthDay = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return { badgeText: `Today, ${monthDay}`, isToday: true, icon: '', dateObj: today };
          }
        }
        if (tomorrow <= endZero) {
          const tomDay = tomorrow.getDay();
          const matchesTomorrow = !hasDaysOfWeek || ev.daysOfWeek.some(dow => DAY_MAP[dow.toLowerCase()] === tomDay);
          if (matchesTomorrow) {
            const monthDay = tomorrow.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return { badgeText: `Tomorrow, ${monthDay}`, isTomorrow: true, icon: '', dateObj: tomorrow };
          }
        }
      }
    } catch (e) {}
  }

  // 3. startIso / single date
  const singleDateRaw = ev.startIso || ev.startDate || ev.start_date;
  if (singleDateRaw) {
    try {
      const d = new Date(singleDateRaw.length === 10 ? singleDateRaw + 'T00:00:00' : singleDateRaw);
      const dZero = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const dKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const isDateCancelled = Array.isArray(ev.cancelledDates) && ev.cancelledDates.includes(dKey);
      if (!isDateCancelled) {
        if (dZero.getTime() === today.getTime()) {
          const status = getEventClosingTimeToday(ev, now);
          if (!status.hasEnded) {
            const monthDay = dZero.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return { badgeText: `Today, ${monthDay}`, isToday: true, icon: '', dateObj: today };
          }
        } else if (dZero > today) {
          const isTomorrow = dZero.getTime() === tomorrow.getTime();
          const monthDay = dZero.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const weekday = dZero.toLocaleDateString('en-US', { weekday: 'short' });

          if (isTomorrow) {
            return { badgeText: `Tomorrow, ${monthDay}`, isTomorrow: true, icon: '', dateObj: dZero };
          } else {
            return { badgeText: `${weekday}, ${monthDay}`, isFuture: true, icon: '', dateObj: dZero };
          }
        }
      }
    } catch (e) {}
  }

  // 4. daysOfWeek recurring
  if (Array.isArray(ev.daysOfWeek) && ev.daysOfWeek.length > 0 && !ev.daysOfWeek.includes('daily')) {
    const DAY_MAP = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
    const curDay = today.getDay();
    let minDaysAhead = 999;
    for (const dow of ev.daysOfWeek) {
      const targetDay = DAY_MAP[dow.toLowerCase()];
      if (targetDay !== undefined) {
        let diff = (targetDay - curDay + 7) % 7;
        const candDate = new Date(today);
        candDate.setDate(candDate.getDate() + diff);
        const candKey = `${candDate.getFullYear()}-${String(candDate.getMonth() + 1).padStart(2, '0')}-${String(candDate.getDate()).padStart(2, '0')}`;
        if (Array.isArray(ev.cancelledDates) && ev.cancelledDates.includes(candKey)) {
          diff += 7;
        } else if (diff === 0) {
          const status = getEventClosingTimeToday(ev, now);
          if (status.hasEnded) {
            diff = 7;
          }
        }
        if (diff < minDaysAhead) minDaysAhead = diff;
      }
    }
    if (minDaysAhead !== 999) {
      const nextDate = new Date(today);
      nextDate.setDate(nextDate.getDate() + minDaysAhead);
      const isToday = minDaysAhead === 0;
      const isTomorrow = minDaysAhead === 1;
      const monthDay = nextDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const weekday = nextDate.toLocaleDateString('en-US', { weekday: 'short' });

      if (isToday) {
        return { badgeText: `Today, ${monthDay}`, isToday: true, icon: '', dateObj: nextDate };
      } else if (isTomorrow) {
        return { badgeText: `Tomorrow, ${monthDay}`, isTomorrow: true, icon: '', dateObj: nextDate };
      } else {
        return { badgeText: `${weekday}, ${monthDay}`, isFuture: true, icon: '', dateObj: nextDate };
      }
    }
  }

  // 5. Daily Perennial Drop-In fallback (strictly for drop-ins with no future specific start date)
  if (ev.lifecycleType === 'perennial_drop_in' || ev.lifecycle_type === 'perennial_drop_in' || ev.access_model === 'open_public_space' || ev.isDaily) {
    const status = getEventClosingTimeToday(ev, now);
    if (!status.hasEnded) {
      const monthDay = today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return {
        badgeText: `Today, ${monthDay}`,
        isToday: true,
        icon: '',
        dateObj: today
      };
    }
    // Closed for today -> find next open day
    const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const wh = ev.weekly_hours || ev.weeklyHours;
    for (let offset = 1; offset <= 7; offset++) {
      const cand = new Date(today);
      cand.setDate(cand.getDate() + offset);
      const candKey = DAY_KEYS[cand.getDay()];
      if (wh && typeof wh === 'object') {
        const h = wh[candKey];
        if (!h || /closed/i.test(String(h))) {
          continue;
        }
      }
      const isTomorrow = offset === 1;
      const monthDay = cand.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const weekday = cand.toLocaleDateString('en-US', { weekday: 'short' });
      if (isTomorrow) {
        return { badgeText: `Tomorrow, ${monthDay}`, isTomorrow: true, closedToday: true, icon: '', dateObj: cand };
      } else {
        return { badgeText: `${weekday}, ${monthDay}`, isFuture: true, closedToday: true, icon: '', dateObj: cand };
      }
    }
    return {
      badgeText: 'Check Schedule',
      icon: '',
      dateObj: today
    };
  }

  return {
    badgeText: `${ev.dateSchedule || ev.frequencyLabel || 'Upcoming'}`,
    icon: ''
  };
}

function formatCardDisplayTitle(rawTitle, ev) {
  if (!rawTitle) return '';
  let t = rawTitle.trim();

  // Identify Fringe productions
  const isFringe = Boolean(
    (ev && ev.id && ev.id.includes('fringe')) ||
    (ev && ev.subTags && ev.subTags.some(tag => tag.toLowerCase().includes('fringe'))) ||
    (ev && ev.organizer && ev.organizer.toLowerCase().includes('fringe')) ||
    (ev && ev.ticketProvider && ev.ticketProvider.toLowerCase().includes('fringe')) ||
    t.toLowerCase().includes('fringe')
  );

  if (isFringe) {
    if (ev && ev.rawTitle) {
      t = ev.rawTitle.trim();
    } else {
      // Strip any verbose or legacy prefixes: "Vancouver Fringe Festival:", "Vancouver Fringe:", "FRINGE:", "Fringe:"
      t = t.replace(/^vancouver fringe festival:\s*/i, '')
           .replace(/^vancouver fringe:\s*/i, '')
           .replace(/^fringe:\s*/i, '');
      // Strip redundant trailing venue if present (e.g. "at Waterfront Theatre")
      if (ev && ev.venue) {
        const venueRegex = new RegExp(`\\s+at\\s+${ev.venue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        t = t.replace(venueRegex, '');
      }
    }
    // Clean, short title-case label
    return `Fringe: ${t}`;
  }
  return t;
}

function getTierMeta(name, price) {
  const n = (name || '').toLowerCase();
  let className = '';

  if (n.includes('student') || n.includes('under 30') || n.includes('under-30') || n.includes('under 35') || n.includes('ubc')) {
    className = 'tier-student';
  } else if (n.includes('member') || n.includes('patron')) {
    className = 'tier-member';
  } else if (n.includes('senior') || n.includes('concession') || n.includes('65+') || n.includes('alumni') || n.includes('staff')) {
    className = 'tier-senior';
  } else if (n.includes('youth') || n.includes('teen')) {
    className = 'tier-youth';
  } else if (n.includes('child') || n.includes('preschool') || n.includes('kid')) {
    className = 'tier-child';
  } else if (n.includes('adult') || n.includes('general') || n.includes('standard')) {
    className = 'tier-adult';
  } else if (n.includes('advance') || n.includes('early bird')) {
    className = 'tier-advance';
  } else if (n.includes('door') || n.includes('rush')) {
    className = 'tier-door';
  } else if (n.includes('free') || n.includes('courtyard') || n.includes('public')) {
    className = 'tier-free-access';
  }

  return { className };
}

function renderAdmissionTiersHtml(ev, bucketKey) {
  let rawTiers = (Array.isArray(ev.tiers) && ev.tiers.length > 0) ? ev.tiers : resolveEventTiers(ev);
  if (!Array.isArray(rawTiers)) return { hasTiers: false, html: '' };

  const tiers = rawTiers.filter(t => {
    if (!t) return false;
    const nameStr = String(t.name || '').trim().toLowerCase();
    if (!nameStr || nameStr === 'null' || nameStr === 'undefined') return false;
    if (t.price === null || t.price === undefined || String(t.price).toLowerCase() === 'null') return false;
    return !isNaN(Number(t.price));
  });

  // If there is only one tier or all tiers have the same price, do not render expandable tiers
  const uniquePrices = new Set(tiers.map(t => Number(t.price)));
  if (tiers.length <= 1 || uniquePrices.size <= 1) {
    return { hasTiers: false, html: '' };
  }

  // De-duplicate tiers with identical names and prices
  const seen = new Set();
  const dedupedTiers = [];
  for (const t of tiers) {
    const key = `${(t.name || '').trim().toLowerCase()}_${Number(t.price)}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedupedTiers.push(t);
    }
  }

  if (dedupedTiers.length <= 1) {
    return { hasTiers: false, html: '' };
  }

  const drawerId = `tiers-drawer-${bucketKey}-${ev.id}`;
  const hintId = `tier-hint-${bucketKey}-${ev.id}`;

  const listItemsHtml = dedupedTiers.map(t => {
    const valText = t.label || (t.price === 0 ? 'Free ($0)' : `$${Number(t.price).toFixed(2)} CAD`);
    const isFreeVal = t.price === 0 || valText.toLowerCase().includes('free');

    let statusClass = '';
    let statusBadge = '';

    if (t.isSoldOut) {
      statusClass = 'tier-sold-out';
      statusBadge = '<span class="tier-status-pill badge-sold-out">Sold Out</span>';
    } else if (t.isExpired) {
      statusClass = 'tier-expired';
      statusBadge = '<span class="tier-status-pill badge-ended">Ended</span>';
    } else if (t.isDoor && !t.isAvailable) {
      statusClass = 'tier-door-only';
      statusBadge = '<span class="tier-status-pill badge-door">Door</span>';
    }

    return `
      <li class="expanded-tier-item ${statusClass}">
        <span class="tier-name">${t.name}</span>
        <span class="tier-dots-leader" aria-hidden="true"></span>
        <span class="tier-val ${isFreeVal ? 'tier-free' : ''}">${valText}</span>
        ${statusBadge}
      </li>
    `;
  }).join('');

  const html = `
    <div class="card-expanded-tiers" id="${drawerId}" style="display: none;" aria-hidden="true">
      <div class="expanded-tiers-header">
        <span>Admission Rates (${dedupedTiers.length} Tiers)</span>
        <button type="button" class="btn-close-tiers" onclick="toggleAdmissionTiers('${bucketKey}', '${ev.id}', event)" title="Close tiers breakdown" aria-label="Close tiers breakdown">✕</button>
      </div>
      <ul class="expanded-tiers-list">
        ${listItemsHtml}
      </ul>
    </div>
  `;

  return {
    hasTiers: true,
    html: html,
    drawerId: drawerId,
    hintId: hintId,
    count: dedupedTiers.length
  };
}

function renderSingleEventCardHtml(ev, bucketKey) {
    const isSaved = state.savedEvents.has(ev.id);
    const freqClass = (ev.frequency || 'one-off').toLowerCase();
    const isSoldOut = Boolean(ev.isSoldOut);
    const standardPrice = formatStandardPrice(ev);
    const topDate = formatCardTopDate(ev, bucketKey);
    
    // Hyperlinks & Direct Pinpoint Navigation Target (Google Maps coordinates)
    let venueUrl = ev.venueUrl;
    if (!venueUrl || /ra\.co\/events\/\d+/i.test(venueUrl) || /residentadvisor\.net\/events\/\d+/i.test(venueUrl)) {
      venueUrl = (typeof VENUE_URLS !== 'undefined' ? (VENUE_URLS[ev.venue] || VENUE_URLS[ev.venue.replace(/^(The\s+)/i, '')]) : null) || ev.raVenueUrl || null;
    }
    if (!venueUrl) {
      venueUrl = (typeof VENUE_URLS !== 'undefined' ? VENUE_URLS[ev.venue] : null) || ('https://www.google.com/search?q=' + encodeURIComponent((ev.venue || '') + ' Vancouver'));
    }
    const venueNameClean = (ev.venue || '').trim();
    const addressClean = (ev.address || '').trim();
    let placeQuery = venueNameClean;
    if (addressClean) {
      if (!addressClean.toLowerCase().includes(venueNameClean.toLowerCase())) {
        placeQuery = `${venueNameClean}, ${addressClean}`;
      } else {
        placeQuery = addressClean;
      }
    } else {
      placeQuery = `${venueNameClean}, Vancouver, BC`;
    }
    const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(placeQuery)}`;

    // Venue Event Count & Filter Button (Requirement 7)
    const venueTotalCount = (window.currentActiveCatalog || ALL_EVENTS).filter(e => e.venue === ev.venue).length;
    const isThisVenueSelected = state.selectedVenue === ev.venue;
    const venueOtherEventsBtnHtml = venueTotalCount > 1 ? `
      <button 
        type="button" 
        class="btn-venue-filter ${isThisVenueSelected ? 'active' : ''}" 
        onclick="filterByVenue('${(ev.venue || '').replace(/'/g, "\\'")}')" 
        title="${isThisVenueSelected ? 'Clear filter for ' + ev.venue : 'Show all ' + venueTotalCount + ' events at ' + ev.venue}"
      >
        ${isThisVenueSelected ? 'Viewing this venue ✕' : 'See all ' + venueTotalCount + ' events here'}
      </button>
    ` : '';
    
    // Featuring Box Filtering (Requirement 7: Keep only if event has multiple music artists not redundant with title)
    let featuringBoxHtml = '';
    const isMusic = ev.category === 'music' || (Array.isArray(ev.categories) && ev.categories.includes('music'));
    if (isMusic && (ev.artist || ev.performers)) {
      const rawPerformers = ev.performers || ev.artist || '';
      const performersList = Array.isArray(rawPerformers)
        ? rawPerformers
        : String(rawPerformers).split(/,\s*|\s+&\s+|\s+with\s+/i);
      const validArtists = performersList.map(a => a.trim()).filter(a => a.length > 1);

      if (validArtists.length >= 2) {
        const titleLower = (ev.title || '').toLowerCase();
        const isRedundantWithTitle = validArtists.every(a => titleLower.includes(a.toLowerCase()));
        if (!isRedundantWithTitle) {
          const artistStr = Array.isArray(ev.performers) ? ev.performers.join(', ') : (ev.artist || ev.performers);
          featuringBoxHtml = `
            <div class="card-artist-badge" title="Featured band / artist lineup">
              <span class="artist-icon"></span>
              <span class="artist-label">Featuring:</span>
              <strong class="artist-name">${artistStr}</strong>
            </div>
          `;
        }
      }
    }

    // Sub-tags chips (Hidden per user specification)
    let subtagsHtml = '';

    // Film Buzzwords, Topic Tags & Critical Reviews
    const buzzwordsHtml = (ev.buzzwords && Array.isArray(ev.buzzwords) && ev.buzzwords.length > 0) ? `
      <div class="card-buzzwords-row" title="Genre topics & non-spoiler themes">
        ${ev.buzzwords.map(bw => `<span class="card-buzzword-pill">${bw}</span>`).join('')}
      </div>
    ` : '';

    const filmReviewsHtml = ((ev.ratings && Array.isArray(ev.ratings) && ev.ratings.length > 0) || ev.reviewQuote) ? `
      <div class="card-film-reviews">
        ${(ev.ratings && ev.ratings.length > 0) ? `
          <div class="film-ratings-pills">
            ${ev.ratings.map(r => {
              const srcLower = (r.source || '').toLowerCase();
              const srcClass = srcLower.includes('rotten') ? 'rt' : (srcLower.includes('letterboxd') ? 'letterboxd' : 'imdb');
              return `<span class="film-rating-chip ${srcClass}" title="${r.source} rating">${r.icon || '⭐'} ${r.source}: <strong>${r.score}</strong></span>`;
            }).join('')}
          </div>
        ` : ''}
        ${ev.reviewQuote ? `<p class="film-review-quote">“${ev.reviewQuote}”</p>` : ''}
      </div>
    ` : '';

    const contentAdvisoryHtml = ev.contentAdvisory ? `
      <div class="card-content-advisory-box" title="Audience content advisory">
        <span aria-hidden="true" style="flex-shrink: 0;">⚠️</span>
        <span>${ev.contentAdvisory}</span>
      </div>
    ` : '';

    // CTA button with Sold-Out handling (links to ticketing portal waitlist if sold out)
    const escapedTitle = (ev.title || '').replace(/"/g, '&quot;');
    // Resolve date-specific instance ticket URL (tied directly to specific event occurrence date)
    const targetDateStr = (topDate && topDate.dateStr) || (ev._computedNextDate ? `${ev._computedNextDate.getFullYear()}-${String(ev._computedNextDate.getMonth() + 1).padStart(2, '0')}-${String(ev._computedNextDate.getDate()).padStart(2, '0')}` : null);
    let matchedShowing = null;
    if (targetDateStr && Array.isArray(ev.showings)) {
      matchedShowing = ev.showings.find(s => s && s.date === targetDateStr && s.ticket_url);
    }
    if (!matchedShowing && targetDateStr && ev.repeatShowings) {
      matchedShowing = [ev.repeatShowings.show_1, ev.repeatShowings.show_2, ev.repeatShowings.show_3]
        .find(s => s && s.date === targetDateStr && s.ticket_url);
    }
    const primaryTicketUrl = (matchedShowing && matchedShowing.ticket_url) ? matchedShowing.ticket_url : ev.websiteUrl;

    const escapedVenue = (ev.venue || '').replace(/"/g, '&quot;');
    const ctaButtonHtml = isSoldOut ? `
      <a 
        href="${primaryTicketUrl}" 
        target="_blank" 
        rel="noopener noreferrer" 
        referrerpolicy="no-referrer"
        class="btn-ticket-cta sold-out"
        data-event-id="${ev.id}"
        data-event-title="${escapedTitle}"
        data-event-venue="${escapedVenue}"
        data-goatcounter-click="tickets-${ev.id}"
        data-goatcounter-title="Tickets: ${escapedTitle} (${escapedVenue})"
        data-goatcounter-no-session="1"
        aria-label="${ev.title} is sold out - check ticket portal or waitlist"
      >
        Sold Out (Waitlist) ↗
      </a>
    ` : `
      <a 
        href="${primaryTicketUrl}" 
        target="_blank" 
        rel="noopener noreferrer" 
        referrerpolicy="no-referrer"
        class="btn-ticket-cta"
        data-event-id="${ev.id}"
        data-event-title="${escapedTitle}"
        data-event-venue="${escapedVenue}"
        data-goatcounter-click="tickets-${ev.id}"
        data-goatcounter-title="Tickets: ${escapedTitle} (${escapedVenue})"
        data-goatcounter-no-session="1"
        aria-label="Get tickets for ${ev.title}"
      >
        Get Tickets / Details ↗
      </a>
    `;

    // Pricing Verification Popover & Pre-tax Sticker Breakdown
    const verification = ev.checkoutVerification || {};
    const breakdownText = verification.feeBreakdown || '';
    const detailsText = verification.details || '';
    const tooltipText = [breakdownText, detailsText].filter(Boolean).join(' • ');

    let preTaxNoteHtml = '';
    if (detailsText && detailsText.includes('pre-tax')) {
      const match = detailsText.match(/displays pre-tax sticker prices \(([^)]+)\)/i) || 
                    detailsText.match(/displays \$?([0-9\.]+) pre-tax/i);
      if (match) {
        const val = match[1].startsWith('$') || match[1].includes(':') ? match[1] : `$${match[1]}`;
        preTaxNoteHtml = `<div class="price-pretax-note">Note: Displays ${val} pre-tax before checkout</div>`;
      } else {
        preTaxNoteHtml = `<div class="price-pretax-note">Note: Displays pre-tax sticker price before checkout</div>`;
      }
    }


    // Pricing Model badge (shown cleanly without emojis or duplicate spend text)
    let pricingModelHtml = '';
    if (ev.pricing_model && ev.pricing_model !== 'free_access' && ev.pricing_model !== 'flat_ticket') {
      const MODEL_LABELS = {
        'pay_per_item': { label: 'Pay Per Item', class: 'model-item' },
        'donation': { label: 'By Donation / PWYC', class: 'model-donation' },
        'ticket_plus_pay_per_item': { label: 'Ticket + Pay Per Item', class: 'model-combo' }
      };
      const pm = MODEL_LABELS[ev.pricing_model];
      if (pm) {
        pricingModelHtml = `
          <div class="card-pricing-model-row">
            <span class="pricing-model-pill ${pm.class}">
              <strong>${pm.label}</strong>
            </span>
          </div>
        `;
      }
    }

    // Access Model badge (Removed per user request; "Free Public Access" is already displayed in the top-right category badge)
    let accessModelHtml = '';

    // Structured Weekly Hours (Each day on its own line, starting with Monday)
    let weeklyHoursHtml = '';
    const wh = ev.weekly_hours || ev.weeklyHours;
    if (wh && typeof wh === 'object') {
      const dayOrder = [
        { k: 'mon', label: 'Monday' },
        { k: 'tue', label: 'Tuesday' },
        { k: 'wed', label: 'Wednesday' },
        { k: 'thu', label: 'Thursday' },
        { k: 'fri', label: 'Friday' },
        { k: 'sat', label: 'Saturday' },
        { k: 'sun', label: 'Sunday' }
      ];

      // Contextual Day Resolution: Never display "Today (Thursday)" on tomorrow's/future cards
      const nowD = new Date();
      let targetDate = nowD;
      if (bucketKey === 'tomorrow' || (topDate && topDate.isTomorrow)) {
        targetDate = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate() + 1);
      } else if (bucketKey === 'today' || (topDate && topDate.isToday)) {
        targetDate = new Date(nowD.getFullYear(), nowD.getMonth(), nowD.getDate());
      } else if (topDate && topDate.dateObj) {
        targetDate = topDate.dateObj;
      }

      const curDayNum = targetDate.getDay();
      const curKey = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][curDayNum];
      const activeDayLabel = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][curDayNum];
      const cleanHoursStr = (str) => (str || '').replace(/\s*\([^)]*\)/g, '').trim();
      const activeHours = cleanHoursStr(wh[curKey] || 'Check schedule');

      const rows = dayOrder.map(d => {
        const hoursStr = cleanHoursStr(wh[d.k] || 'Hours not listed');
        const isCurrentDay = (d.k === curKey);
        return `
          <div class="weekly-hour-day-row ${isCurrentDay ? 'current-day' : ''}">
            <span class="day-col">${d.label}:</span>
            <span class="hours-col">${hoursStr}</span>
          </div>
        `;
      }).join('');

      weeklyHoursHtml = `
        <div class="card-weekly-hours-block" id="hours-block-${ev.id}">
          <div class="weekly-hours-summary-row" onclick="toggleWeeklyHours('${ev.id}', event)" title="Click to view/hide 7-day schedule">
            <div class="wh-summary-left">
              <div class="wh-active-day-box">
                <span class="wh-active-day-name">${activeDayLabel}:</span>
                <span class="wh-active-hours-val">${activeHours}</span>
              </div>
            </div>
            <button type="button" class="btn-toggle-hours" id="btn-toggle-hours-${ev.id}" aria-expanded="false" aria-label="Toggle weekly schedule">
              <span class="toggle-text">Full Week</span>
              <span class="wh-chevron">▾</span>
            </button>
          </div>
          <div class="weekly-hours-table collapsible-hours" id="hours-table-${ev.id}" style="display: none;">
            ${rows}
          </div>
        </div>
      `;
    }

    // Multi-Location Screenings / Upcoming Showings Block
    let showingsHtml = '';
    if (Array.isArray(ev.showings) && ev.showings.length > 1) {
      const isFilmFestival = (ev.category === 'cinema' || ev.isFestival || (ev.subTags && ev.subTags.includes('festival')));
      const sectionTitle = isFilmFestival 
        ? `Festival Screenings &amp; Locations (${ev.showings.length})`
        : `Upcoming Dates &amp; Times (${ev.showings.length})`;

      const nowD = new Date();
      const curTodayStr = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(nowD.getDate()).padStart(2, '0')}`;

      const renderShowingRow = (s) => {
        const dStr = s.date || '';
        const dObj = new Date(dStr.length === 10 ? dStr + 'T12:00:00' : dStr);
        const dateLabel = !isNaN(dObj.getTime())
          ? dObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          : dStr;
        const isShowingToday = (dStr === curTodayStr);
        const timeLabel = s.start_time || '';
        const venueLabel = s.venue_name || s.venue || ev.venue || ev.venue_name || 'Vancouver Venue';
        const addrLabel = s.full_address || s.neighborhood || ev.address || ev.neighborhood || '';
        const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueLabel + ' ' + (addrLabel || 'Vancouver BC'))}`;
        const bookUrl = s.ticket_url || ev.websiteUrl;
        const costText = (s.cost !== undefined && s.cost !== null) ? (Number(s.cost) === 0 ? 'Free' : `$${Number(s.cost).toFixed(2)}`) : '';
        return `
          <div class="showing-row ${isShowingToday ? 'showing-today' : ''}">
            <div class="showing-time-col">
              <span class="showing-date">${dateLabel}</span>
              <span class="showing-time">${timeLabel}</span>
            </div>
            <div class="showing-venue-col">
              <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="showing-venue-link" title="Open ${venueLabel} in Google Maps">
                <strong>${venueLabel}</strong>
              </a>
              <span class="showing-address">${addrLabel}</span>
            </div>
            <div class="showing-action-col">
              <a href="${bookUrl}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="btn-showing-book" title="Direct ticket or info link for this date">
                ${costText ? `${costText} ↗` : 'Book ↗'}
              </a>
            </div>
          </div>
        `;
      };

      const todayIdx = ev.showings.findIndex(s => s && s.date === curTodayStr);
      const primaryIdx = todayIdx >= 0 ? todayIdx : 0;
      const primaryShowing = ev.showings[primaryIdx];
      const remainingShowings = ev.showings.filter((_, idx) => idx !== primaryIdx);

      const primaryRowHtml = renderShowingRow(primaryShowing);
      const remainingRowsHtml = remainingShowings.map(renderShowingRow).join('');

      showingsHtml = `
        <div class="card-showings-block" id="showings-block-${ev.id}">
          <div class="showings-table">
            ${primaryRowHtml}
            ${remainingShowings.length > 0 ? `
              <div class="showings-collapsible" id="showings-more-${ev.id}" style="display: none;">
                ${remainingRowsHtml}
              </div>
              <div class="showings-toggle-row">
                <button 
                  type="button" 
                  class="btn-toggle-showings btn-toggle-hours" 
                  id="btn-toggle-showings-${ev.id}" 
                  onclick="toggleShowings('${ev.id}', event)" 
                  aria-expanded="false" 
                  data-count="${ev.showings.length}"
                  aria-label="Toggle all showings for ${ev.title}"
                >
                  <span class="toggle-text">All Dates (${ev.showings.length})</span>
                  <span class="wh-chevron">▾</span>
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    // Waypoints for consolidated hub attractions (e.g. Stanley Park)
    let waypointsHtml = '';
    if (Array.isArray(ev.waypoints) && ev.waypoints.length > 0) {
      waypointsHtml = `
        <div class="card-waypoints-box">
          <div class="waypoints-box-header">
            <span>Featured Waypoints & Landmarks (${ev.waypoints.length})</span>
          </div>
          <div class="waypoints-box-list">
            ${ev.waypoints.map(wp => `
              <div class="waypoint-row">
                <strong class="waypoint-name">• ${wp.name}</strong>
                <span class="waypoint-desc">${wp.desc}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }

    // Venue-Accurate Spending Benchmarks & On-Site Food/Beverage Reality
    let benchmarkHtml = '';
    const benchItems = [];
    if (ev.drink_benchmark) {
      benchItems.push(`<span>Bar: <strong>${ev.drink_benchmark}</strong></span>`);
    }
    if (ev.concession_benchmark) {
      benchItems.push(`<span>Concessions: <strong>${ev.concession_benchmark}</strong></span>`);
    }
    if (ev.coffee_benchmark) {
      benchItems.push(`<span>Coffee: <strong>${ev.coffee_benchmark}</strong></span>`);
    }
    if (ev.food_service_note) {
      benchItems.push(`<span class="food-service-note"><em>${ev.food_service_note}</em></span>`);
    } else if (ev.meal_benchmark) {
      benchItems.push(`<span>Meal: <strong>${ev.meal_benchmark}</strong></span>`);
    }

    if (benchItems.length > 0) {
      benchmarkHtml = `
        <div class="card-benchmarks-row" title="Venue food & drink pricing benchmarks">
          <span class="benchmark-label">On-Site &amp; Area Cost:</span>
          ${benchItems.join('<span class="benchmark-sep">•</span>')}
        </div>
      `;
    }

    // Option A: Outing Spend Estimator Pill (Direct Out-of-Pocket Transparency)
    let spendEstimatorHtml = '';
    const venueNameStr = ev.venue_name || ev.venue || ev.location || '';
    const escapedVenueAttr = venueNameStr.replace(/"/g, '&quot;');
    const suggestBtnHtml = `<button type="button" class="btn-suggest-price" data-suggest-venue="${escapedVenueAttr}" title="Suggest updated drink or item prices for ${escapedVenueAttr}">Suggest price ✎</button>`;

    if (ev.typical_item_spend) {
      let spendTag = 'Expected Outing Spend';
      if (ev.pricing_model === 'pay_per_item' || (ev.id && (ev.id.includes('croissant') || ev.id.includes('market')))) {
        spendTag = 'Typical Item Spend';
      } else if (ev.drink_benchmark) {
        spendTag = 'In-Venue Drink Spend';
      } else if (ev.concession_benchmark) {
        spendTag = 'Concession Spend';
      } else if (ev.isFree) {
        spendTag = 'Typical Out-of-Pocket';
      }

      spendEstimatorHtml = `
        <div class="card-spend-estimator-pill" title="Estimated out-of-pocket cost for purchases at this outing">
          <span class="spend-pill-label"><strong>${spendTag}:</strong> ${ev.typical_item_spend}</span>
          ${suggestBtnHtml}
        </div>
      `;
    } else {
      spendEstimatorHtml = `
        <div class="card-spend-estimator-pill card-spend-uncalibrated" title="Help calibrate drinks and purchases at this venue">
          <span class="spend-pill-label"><strong>Drink / Item Spend:</strong> Uncalibrated</span>
          ${suggestBtnHtml}
        </div>
      `;
    }


    // Pricing sub-details: Pre-tax notices and pricing models (Admission tiers expand from bottom-left cost range)
    const tiersInfo = renderAdmissionTiersHtml(ev, bucketKey);
    const hasPreTax = Boolean(preTaxNoteHtml);
    const subdetailsHtml = (pricingModelHtml || hasPreTax) ? `
      <div class="card-price-subdetails">
        ${pricingModelHtml}
        ${preTaxNoteHtml}
      </div>
    ` : '';

    const accessInfo = typeof window.getVenueAccessibility === 'function' 
      ? window.getVenueAccessibility(ev.venue) 
      : { status: 'accessible', label: 'Wheelchair Accessible', badgeIcon: '♿', summary: 'Ground-floor street level entrance.' };

    return `
      <article class="event-card ${isSoldOut ? 'card-sold-out' : ''}" id="card-${ev.id}">
        ${isSoldOut ? '<div class="sold-out-ribbon">SOLD OUT</div>' : ''}

        <!-- Unified Single Header: Date & Category Badges on Left, Action Cluster on Right -->
        <div class="card-top-bar">
          <div class="header-badges-left">
            <span class="card-date-badge ${topDate.isToday ? 'badge-today' : topDate.isTomorrow ? 'badge-tomorrow' : ''}">
              <span>${topDate.badgeText}</span>
            </span>
            ${(() => {
              const hasDropInBadge = Boolean(weeklyHoursHtml || ev.isFreePublic || (ev.frequencyLabel && ev.frequencyLabel.toLowerCase().includes('drop-in')));
              const catsToShow = (Array.isArray(ev.categories) && ev.categories.length > 0)
                ? (ev.categories.includes('cinema') && ev.categories.includes('social')
                    ? ['cinema', 'social']
                    : (hasDropInBadge && ev.categories.includes('outdoors')
                        ? ['outdoors']
                        : (ev.categories.includes('outdoors') && ev.categories.includes('free-public-access')
                            ? ['outdoors']
                            : [ev.categories[0]])))
                : [ev.category || 'misc'];
              return catsToShow.map(catId => {
                const catDef = (typeof CATEGORIES !== 'undefined') ? CATEGORIES.find(c => c.id === catId) : null;
                const label = catDef ? catDef.label : (catId === ev.category ? (ev.categoryLabel || catId) : catId);
                return `
                  <button 
                    type="button" 
                    class="card-category-badge category-${catId}" 
                    onclick="filterByCategory('${catId}')" 
                    title="Click to filter by ${label}"
                    aria-label="Category: ${label}"
                  >
                    <span class="category-badge-text">${label}</span>
                  </button>
                `;
              }).join('');
            })()}
            ${(weeklyHoursHtml || ev.isFreePublic || (ev.frequencyLabel && ev.frequencyLabel.toLowerCase().includes('drop-in'))) ? `
              <span class="card-category-badge badge-dropin" title="Daily Drop-In (No booking or reservation required)">
                <span class="category-badge-text">Daily Drop-In</span>
              </span>
            ` : ''}
          </div>

          <!-- Top Right: Action Cluster (Accessibility, Share, Save) -->
          <div class="card-action-cluster">
            <!-- Accessibility Details Button -->
            <button 
              type="button" 
              class="btn-card-action btn-card-access ${accessInfo.status}" 
              onclick="openAccessibilityModal('${ev.id}')"
              title="${accessInfo.label} (${ev.venue}) • Click for Google Maps accessibility details"
              aria-label="Accessibility information for ${ev.venue}: ${accessInfo.label}"
            >
              <span class="access-btn-icon">${accessInfo.badgeSvg || (window.renderAccessBadgeSvg ? window.renderAccessBadgeSvg(accessInfo.status, 20) : accessInfo.badgeIcon)}</span>
            </button>

            <!-- Share Event Button -->
            <button 
              type="button" 
              class="btn-card-action btn-card-share" 
              id="btn-share-${ev.id}"
              onclick="shareEvent('${ev.id}')" 
              title="Share event details & link"
              aria-label="Share ${escapedTitle}"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            </button>

            <!-- Save Outing Button -->
            <button 
              type="button"
              class="btn-card-action btn-save-card ${isSaved ? 'saved' : ''}" 
              onclick="toggleSaveEvent('${ev.id}')" 
              aria-label="${isSaved ? 'Remove from Saved' : 'Save Outing'}"
              title="${isSaved ? 'Remove from Saved' : 'Save Outing'}"
            >
              ${isSaved 
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="#f43f5e" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>' 
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>'}
            </button>
          </div>
        </div>

        <!-- Event Details: Clickable Title Link (Always shortened to FRINGE: for Fringe shows) -->
        <h2 class="card-title">
          <a href="${ev.websiteUrl}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="card-title-link" title="Get tickets & details for ${ev.title}">
            ${formatCardDisplayTitle(ev.title, ev)}
          </a>
        </h2>
        
        <!-- Band / Artist Highlight Badge (Rendered strictly when multiple non-redundant music artists exist) -->
        ${featuringBoxHtml}

        <!-- Roving / Nomadic Series Organizer Badge -->
        ${ev.organizer ? `
          <div class="card-organizer-badge" title="Roving community event organized by ${ev.organizer}">
            <span class="organizer-icon"></span>
            <span class="organizer-label">Series:</span>
            <strong class="organizer-name">${ev.organizer}</strong>
            ${ev.editionVenue ? `<span class="edition-venue">(${ev.editionVenue})</span>` : ''}
          </div>
        ` : ''}

        <!-- Age, Admission & Access Policy Badges (QC Verified) -->
        ${(ev.agePolicy || ev.admissionPolicy || accessModelHtml) ? `
          <div class="card-policy-row">
            ${accessModelHtml}
            ${ev.agePolicy ? `<span class="policy-pill age-policy" title="${ev.agePolicy}">${ev.agePolicy}</span>` : ''}
            ${ev.admissionPolicy ? `<span class="policy-pill admission-policy" title="${ev.admissionPolicy}">${ev.admissionPolicy}</span>` : ''}
          </div>
        ` : ''}

        <!-- Roving Physical Host Note -->
        ${ev.rovingNote ? `
          <div class="card-roving-note"><em>${ev.rovingNote}</em></div>
        ` : ''}
        
        <!-- Venue Row: Direct Pinpoint Google Maps Directions + Official Venue Website + Venue Isolation Filter -->
        <div class="card-venue-row">
          <div class="card-venue-primary-row">
            <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="venue-location-btn venue-location-link card-maps-link" title="Open ${ev.venue} (${ev.address || 'Vancouver'}) in Google Maps">
              <span class="venue-pin-icon" aria-label="Map location"><svg width="32" height="32" viewBox="0 0 24 24" fill="#ef4444" aria-hidden="true" style="color: #ef4444; flex-shrink: 0; vertical-align: middle; margin-right: 4px; filter: drop-shadow(0 2px 4px rgba(239, 68, 68, 0.55));"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></span>
              <span class="venue-name">${ev.venue}</span>
            </a>
            ${venueUrl ? `
              <a href="${venueUrl}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="venue-website-link venue-link" title="Visit official website of ${ev.venue}">
                <span class="website-label">Venue Site ↗</span>
              </a>
            ` : ''}
          </div>
          ${venueOtherEventsBtnHtml}
        </div>

        <!-- Schedule Row: Rendered strictly when NO weekly hours block and NO multi-showings block is present -->
        ${(!weeklyHoursHtml && !showingsHtml) ? `
          <div class="card-schedule-row">
            <span>${ev.dateSchedule || ev.frequencyLabel || 'Check venue calendar'}</span>
            ${(ev.frequencyLabel && !ev.isFreePublic) ? `<span class="card-meta-pill ${freqClass}" style="margin-left: auto; font-size: 0.70rem; padding: 2px 6px;">${ev.frequencyLabel}</span>` : ''}
          </div>
        ` : ''}

        ${showingsHtml}

        ${waypointsHtml}

        ${weeklyHoursHtml}

        ${buzzwordsHtml}

        ${filmReviewsHtml}

        <p class="card-desc">${ev.description || ('Live music and performance at ' + ev.venue)}</p>

        ${contentAdvisoryHtml}

        ${subtagsHtml}

        <!-- Card Pricing Section: Sub-details directly above green cost, footer locked at bottom -->
        <div class="card-pricing-block">
          ${subdetailsHtml}
          ${spendEstimatorHtml}
          ${tiersInfo.html || ''}
          <div class="card-footer">
            <div class="price-box ${tiersInfo.hasTiers ? 'price-box-interactive' : ''}" 
                 ${tiersInfo.hasTiers ? `onclick="toggleAdmissionTiers('${bucketKey}', '${ev.id}', event)" role="button" tabindex="0" aria-expanded="false" title="Click to view all ${tiersInfo.count} admission tiers"` : ''}>
              <div class="price-breakdown-row">
                <span class="price-main ${ev.isFree ? 'free' : ''}">${standardPrice}</span>
                ${tiersInfo.hasTiers ? `<span class="price-tiers-toggle-hint" id="${tiersInfo.hintId}">Tiers ▾</span>` : ''}
              </div>
            </div>

            ${ctaButtonHtml}
          </div>
        </div>
      </article>
    `;
}

function resetAllFilters() {
  state.minBudget = 0;
  state.maxBudget = 50;
  state.category = 'all';
  state.frequency = 'all';
  state.dayOfWeek = 'all';
  state.timeSlot = 'all';
  state.selectedNeighborhoods = new Set(window.NEIGHBORHOODS);
  state.hideDaily = false;
  state.selectedTag = null;
  state.searchQuery = '';

  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  const clearSearchBtn = document.getElementById('btn-clear-search');
  if (clearSearchBtn) clearSearchBtn.style.display = 'none';
  const tipsPopover = document.getElementById('search-tips-popover');
  if (tipsPopover) tipsPopover.style.display = 'none';
  const tipsToggleBtn = document.getElementById('btn-search-tips-toggle');
  if (tipsToggleBtn) {
    tipsToggleBtn.classList.remove('active');
    tipsToggleBtn.setAttribute('aria-expanded', 'false');
  }

  const minSlider = document.getElementById('min-spend-slider');
  const maxSlider = document.getElementById('max-spend-slider');
  if (minSlider) minSlider.value = 0;
  if (maxSlider) maxSlider.value = 50;

  const hideDailyToggle = document.getElementById('hide-daily-toggle');
  if (hideDailyToggle) hideDailyToggle.checked = false;

  state.accessibleOnly = false;
  const chkAccess = document.getElementById('chk-accessible-only');
  if (chkAccess) chkAccess.checked = false;

  renderCategoryPills();
  renderDayPills();
  renderTimePills();
  renderNeighborhoodPills();
  renderFrequencyPills();
  clearActiveQuickButtons();
  updateSliderVisuals();
  applyFiltersAndRender();
}

// ==============================================================================
// 6. ITINERARY DRAWER & STATE PERSISTENCE
// ==============================================================================

function loadSavedState() {
  try {
    const raw = localStorage.getItem('van50_saved');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        state.savedEvents = new Set(arr);
        updateItineraryBadge();
      }
    }
  } catch (e) {}
}

function persistSavedState() {
  try {
    localStorage.setItem('van50_saved', JSON.stringify(Array.from(state.savedEvents)));
  } catch (e) {}
}

window.toggleSaveEvent = function(eventId) {
  if (state.savedEvents.has(eventId)) {
    state.savedEvents.delete(eventId);
  } else {
    state.savedEvents.add(eventId);
    const ev = (window.currentActiveCatalog || ALL_EVENTS).find(e => e.id === eventId);
    if (ev) {
      const label = ev.venue ? `${ev.title} (${ev.venue})` : ev.title;
      window.trackAnonymousEvent('save/' + eventId, 'Saved: ' + label);
    }
  }
  persistSavedState();
  updateItineraryBadge();
  renderItinerary();
  applyFiltersAndRender();
};

function updateItineraryBadge() {
  const badge = document.getElementById('itinerary-count');
  if (badge) {
    badge.textContent = state.savedEvents.size;
  }
}

function renderItinerary() {
  const list = document.getElementById('itinerary-items-list');
  const totalEl = document.getElementById('itinerary-total-cost');
  const statusEl = document.getElementById('itinerary-budget-status');
  if (!list || !totalEl) return;

  const savedList = ALL_EVENTS.filter(ev => state.savedEvents.has(ev.id));

  if (savedList.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: 40px 10px; color: var(--text-muted); font-size: 0.86rem;">
        No saved events yet.<br>Click 🤍 on any card to save an event.
      </div>
    `;
    totalEl.textContent = '$0.00 CAD';
    if (statusEl) statusEl.textContent = 'Add events to calculate';
    return;
  }

  let totalCost = 0;
  list.innerHTML = savedList.map(ev => {
    totalCost += ev.price;
    return `
      <div class="itinerary-item-card">
        <div style="flex: 1;">
          <div class="itinerary-item-title">${ev.title}</div>
          <div style="font-size: 0.74rem; color: var(--text-secondary); margin-bottom: 4px;">${ev.venue}</div>
          <div class="itinerary-item-price">${formatStandardPrice(ev)}</div>
        </div>
        <button class="btn-remove-item" onclick="toggleSaveEvent('${ev.id}')" title="Remove from Saved Events">✕</button>
      </div>
    `;
  }).join('');

  totalEl.textContent = `$${totalCost.toFixed(2)} CAD`;
  if (statusEl) {
    statusEl.innerHTML = totalCost <= 50.00 
      ? `<span style="color: var(--accent-primary); font-weight: 700;">Within $50 Budget!</span>`
      : `<span style="color: var(--accent-rose); font-weight: 700;">Exceeds $50 Budget</span>`;
  }
}

function copyItineraryToClipboard() {
  const savedList = ALL_EVENTS.filter(ev => state.savedEvents.has(ev.id));
  if (savedList.length === 0) {
    alert('Your saved events list is currently empty. Bookmark some outings first using the heart icon on any card!');
    return;
  }

  let totalCost = 0;
  let text = `Van50 — My Saved Vancouver Outings (Under $50 CAD)\n\n`;
  savedList.forEach((ev, i) => {
    totalCost += ev.price;
    text += `${i + 1}. ${ev.title}\n`;
    text += `   Venue: ${ev.venue} (${ev.neighborhood})\n`;
    text += `   When: ${ev.dateSchedule}\n`;
    text += `   Cost: ${formatStandardPrice(ev)}\n`;
    text += `   Direct Tickets / Details: ${ev.websiteUrl}\n\n`;
  });
  text += `--------------------------------------------------\n`;
  text += `TOTAL ESTIMATED OUT-OF-POCKET: $${totalCost.toFixed(2)} CAD\n`;
  text += `Generated with Van50 (https://ausomegh.github.io/Van50/)\n`;

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('copy-plan-btn');
    if (btn) {
      const original = btn.textContent;
      btn.textContent = '✅ Copied Saved Events to Clipboard!';
      setTimeout(() => { btn.textContent = original; }, 2200);
    }
  }).catch(() => {
    alert('Unable to copy automatically. Please select text manually.');
  });
}

// ==============================================================================
// 7. MANUAL REVIEW QUARANTINE QUEUE LOGIC
// ==============================================================================

function updateReviewQueueBadge() {
  const container = document.getElementById('curator-footer-container');
  const badge = document.getElementById('review-queue-count');
  const items = (typeof MANUAL_REVIEW_QUEUE !== 'undefined') ? MANUAL_REVIEW_QUEUE : [];
  if (badge) {
    badge.textContent = items.length;
  }
  // Reveal curator portal button only if ?curator=true, ?admin=true, or active curator session
  const urlParams = new URLSearchParams(window.location.search);
  const isCurator = urlParams.has('curator') || urlParams.has('admin') || Boolean(sessionStorage.getItem('van50_curator_token'));
  if (container) {
    container.style.display = isCurator ? 'block' : 'none';
  }
}

function renderReviewQueueModal() {
  const list = document.getElementById('review-queue-items-list');
  if (!list) return;

  const items = (typeof MANUAL_REVIEW_QUEUE !== 'undefined') ? MANUAL_REVIEW_QUEUE : [];
  if (items.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: var(--text-secondary);">
        <div style="font-size: 2.2rem; margin-bottom: 8px;">✅</div>
        <h4 style="color: #fff; font-size: 1.1rem; margin-bottom: 6px;">All Events Live Verified</h4>
        <p style="font-size: 0.85rem;">There are currently zero events quarantined for manual review. All catalog items have confirmed live check-out pricing.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = items.map(q => `
    <div class="quarantined-card">
      <div class="quarantined-card-header">
        <div>
          <h3 class="quarantined-card-title">${q.title}</h3>
          <div class="quarantined-card-venue">📍 ${q.venue} (${q.neighborhood || 'Vancouver'})</div>
        </div>
        <span class="quarantined-flag-badge">⚠️ QUARANTINED</span>
      </div>

      <div class="quarantined-reason-box">
        <strong>Reason Flagged:</strong> ${q.flagReason}
      </div>

      <div class="quarantined-meta-row">
        <div>
          <span style="color: var(--text-muted);">Attempted Price:</span>
          <span style="color: #f59e0b; font-weight: 700; margin-left: 4px;">${q.attemptedPriceLabel}</span>
          <span style="color: var(--text-muted); margin-left: 8px;">Provider: ${q.provider}</span>
        </div>
        <a 
          href="${q.websiteUrl}" 
          target="_blank" 
          rel="noopener noreferrer" 
          referrerpolicy="no-referrer" 
          class="btn btn-roulette" 
          style="padding: 4px 12px; font-size: 0.76rem; border-radius: var(--radius-sm);"
        >
          Inspect Venue Page ↗
        </a>
      </div>
    </div>
  `).join('');
}

// ==============================================================================
// 12. ACCESSIBILITY MODE ENGINE (WCAG AAA High Contrast & Enhanced Legibility)
// ==============================================================================

function initAccessibility() {
  try {
    const isAccessible = localStorage.getItem('van50_accessible_mode') === 'true';
    setAccessibilityMode(isAccessible, false);
  } catch (e) {}
}

function setAccessibilityMode(enabled, notify = true) {
  state.accessibleMode = !!enabled;
  document.documentElement.classList.toggle('van50-accessible', state.accessibleMode);
  document.body.classList.toggle('van50-accessible', state.accessibleMode);

  const btn = document.getElementById('accessibility-btn');
  if (btn) {
    btn.setAttribute('aria-pressed', state.accessibleMode ? 'true' : 'false');
    btn.classList.toggle('active', state.accessibleMode);
    const label = btn.querySelector('.access-label');
    if (label) {
      label.textContent = state.accessibleMode ? 'Accessible: ON' : 'Accessibility';
    }
  }

  try {
    localStorage.setItem('van50_accessible_mode', state.accessibleMode ? 'true' : 'false');
  } catch (e) {}

  if (notify && typeof showToast === 'function') {
    showToast(
      state.accessibleMode 
        ? '♿ Accessible Mode Enabled (High Contrast, Enhanced Text & 48px Touch Targets)' 
        : '♿ Standard Display Mode Restored',
      'info'
    );
  }
}

function toggleAccessibilityMode() {
  setAccessibilityMode(!state.accessibleMode, true);
}

window.initAccessibility = initAccessibility;
window.setAccessibilityMode = setAccessibilityMode;
window.toggleAccessibilityMode = toggleAccessibilityMode;

