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
  { id: "all", label: "Any Time", icon: "" },
  { id: "early-morning", label: "Early Morning", desc: "Before 12pm", icon: "🌅" },
  { id: "afternoon", label: "Afternoon", desc: "12pm – 5pm", icon: "☀️" },
  { id: "early-evening", label: "Early Evening", desc: "5pm – 8:30pm", icon: "🌆" },
  { id: "late-evening", label: "Late Evening", desc: "8:30pm+", icon: "🌙" }
];

window.CATEGORIES = window.CATEGORIES || [
  { id: "all", label: "All", icon: "" },
  { id: "free-public-access", label: "Free Public Access", icon: "" },
  { id: "music", label: "Music", icon: "" },
  { id: "shows", label: "Comedy & Stage", icon: "" },
  { id: "festivals", label: "Festivals & Holidays", icon: "" },
  { id: "markets", label: "Markets", icon: "" },
  { id: "outdoors", label: "Outdoors", icon: "" },
  { id: "cinema", label: "Cinema", icon: "" },
  { id: "social", label: "Social & Arts", icon: "" }
];

window.HOLIDAY_REGISTRY = window.HOLIDAY_REGISTRY || {
  "halloween": {
    id: "halloween",
    label: "Halloween",
    icon: "🎃",
    datesLabel: "Oct 1 – Nov 2",
    shortDesc: "Spooky screenings, horror cinema, murder mysteries, and costume nights across Vancouver.",
    longDesc: "Celebrate Halloween season across Metro Vancouver with cult horror film screenings with live scores, improvised murder mysteries, paranormal comedy shows, and late-night costume parties—all verified under $50 CAD.",
    venues: "The Cinematheque, Fox Cabaret, The Improv Centre & Tightrope Theatre",
    keywords: "halloween hallowe'en spooky haunted costume party trick or treat horror vampyr vampire zombie ghost"
  },
  "diwali": {
    id: "diwali",
    label: "Diwali Festival of Lights",
    icon: "🪔",
    datesLabel: "Nov 5 – 15, 2026",
    shortDesc: "South Asian music, dance, rangoli art, and Festival of Lights community celebrations.",
    longDesc: "Experience the annual Diwali Festival of Lights across Metro Vancouver with classical and contemporary South Asian music, bhangra and kathak dance showcases, rangoli art installations, and vibrant community markets.",
    venues: "Roundhouse Community Centre & Surrey Civic Plaza",
    officialUrl: "https://www.diwalifest.ca",
    officialLabel: "Official Diwali Fest Schedule ↗",
    keywords: "diwali deepavali festival of lights mehfil rangoli south asian bhangra bollywood"
  },
  "christmas": {
    id: "christmas",
    label: "Winter Holidays & Christmas",
    icon: "🎄",
    datesLabel: "Nov 15 – Dec 30",
    shortDesc: "Festive light displays, winter craft markets, holiday concerts, and seasonal theatre.",
    longDesc: "Celebrate the winter holiday season across Metro Vancouver with botanical garden light displays, indie artisan craft markets, festive choir and jazz concerts, ugly sweater comedy nights, and holiday cinema under $50 CAD.",
    venues: "Metro Vancouver Theatres, Markets & Botanical Gardens",
    keywords: "christmas xmas keithmas holiday winter festive yule nutcracker hanukkah solstice"
  },
  "dia-de-los-muertos": {
    id: "dia-de-los-muertos",
    label: "Día de los Muertos (Day of the Dead)",
    icon: "💀",
    datesLabel: "Oct 31 – Nov 2",
    shortDesc: "Traditional Mexican markets, Catrinas processions, ofrendas, folkloric music, and art.",
    longDesc: "Honour loved ones during Día de los Muertos with community altars (ofrendas), twilight Catrinas processions, traditional Mexican artisan markets, mariachi music, and cultural performances across Granville Island and Gastown.",
    venues: "Granville Island & Gastown Historic District",
    officialUrl: "https://latincouver.ca",
    officialLabel: "Latincouver Event Guide ↗",
    keywords: "dia de los muertos day of the dead ofrenda calavera catrina"
  },
  "new-years": {
    id: "new-years",
    label: "New Year's Eve / Day",
    icon: "🎉",
    datesLabel: "Dec 31 – Jan 1",
    shortDesc: "New Year's Eve countdown parties, comedy galas, live music, and Polar Bear Swim.",
    longDesc: "Ring in the New Year with countdown dance parties, NYE stand-up comedy galas, live concerts, and Vancouver's iconic New Year's Day Polar Bear Swim at English Bay.",
    venues: "Downtown Vancouver, East Van & English Bay",
    keywords: "new years eve nye countdown midnight toast polar bear swim"
  },
  "lunar-new-year": {
    id: "lunar-new-year",
    label: "Lunar New Year",
    icon: "🧧",
    datesLabel: "Jan – Feb",
    shortDesc: "Chinatown lion dances, lantern installations, cultural markets, and festive performances.",
    longDesc: "Welcome the Lunar New Year across historic Chinatown and Metro Vancouver with traditional lion and dragon dances, lantern light installations, festive markets, and multidisciplinary cultural showcases.",
    venues: "Historic Chinatown, Dr. Sun Yat-Sen Garden & Metro Vancouver",
    keywords: "lunar new year chinese new year spring festival lion dance"
  },
  "thanksgiving": {
    id: "thanksgiving",
    label: "Thanksgiving",
    icon: "🦃",
    datesLabel: "Early October",
    shortDesc: "Autumn harvest markets, long-weekend outings, and seasonal comedy & music.",
    longDesc: "Enjoy Canadian Thanksgiving long-weekend outings across Metro Vancouver, featuring autumn harvest markets, scenic fall foliage strolls, and festive comedy and live music showcases.",
    venues: "Metro Vancouver Parks, Markets & Stages",
    keywords: "thanksgiving friendsgiving harvest"
  },
  "valentines-day": {
    id: "valentines-day",
    label: "Valentine's Day",
    icon: "💘",
    datesLabel: "Feb 1 – 15",
    shortDesc: "Date-night concerts, rom-com screenings, burlesque, and Galentine's comedy shows.",
    longDesc: "Celebrate Valentine's Day, Galentine's, or Anti-Valentine's across Vancouver with candlelit jazz, cult romance film screenings, burlesque cabarets, and relationship-themed improv and stand-up comedy.",
    venues: "Rio Theatre, Fox Cabaret, The Improv Centre & Local Lounges",
    keywords: "valentines day galentines romance date night"
  },
  "st-patricks-day": {
    id: "st-patricks-day",
    label: "St. Patrick's Day",
    icon: "☘️",
    datesLabel: "Mar 10 – 18",
    shortDesc: "Celtic live music, Irish dance, fiddle sessions, and St. Paddy's celebrations.",
    longDesc: "Raise a glass for St. Patrick's Day with high-energy Celtic folk bands, traditional Irish fiddle and céilí dancing, and festive live music nights across Vancouver.",
    venues: "Gastown, Commercial Drive & Downtown Stages",
    keywords: "st patricks day paddys irish celtic"
  },
  "easter": {
    id: "easter",
    label: "Easter & Spring",
    icon: "🐣",
    datesLabel: "Spring Long Weekend",
    shortDesc: "Spring garden blooms, artisan markets, and long-weekend cultural outings.",
    longDesc: "Enjoy the Easter and spring season across Metro Vancouver with botanical garden blooms, family-friendly park activities, spring artisan markets, and long-weekend live shows.",
    venues: "Metro Vancouver Gardens, Parks & Markets",
    keywords: "easter spring equinox"
  },
  "canada-day": {
    id: "canada-day",
    label: "Canada Day",
    icon: "🍁",
    datesLabel: "July 1",
    shortDesc: "Waterfront festivals, free outdoor concerts, and community celebrations.",
    longDesc: "Explore Canada Day community events across Canada Place, Granville Island, and local neighbourhood parks featuring free outdoor stages, multicultural performances, and waterfront celebrations.",
    venues: "Canada Place, Granville Island & Community Parks",
    keywords: "canada day july 1"
  },
  "pride": {
    id: "pride",
    label: "Pride Festival",
    icon: "🌈",
    datesLabel: "Late July – Early Aug",
    shortDesc: "Queer arts, drag showcases, parade celebrations, and community stages.",
    longDesc: "Celebrate Vancouver Pride with 2SLGBTQIA+ cabaret, drag showcases, queer film screenings, outdoor community stages, and parade festivities across the West End, Davie Village, and Downtown.",
    venues: "Davie Village, West End & Concord Pacific Place",
    keywords: "pride festival queer lgbtq drag"
  }
};

window.FESTIVAL_REGISTRY = window.FESTIVAL_REGISTRY || {
  "diwali-fest": {
    id: "diwali-fest",
    label: "Diwali Fest (Festival of Lights)",
    icon: "🪔",
    datesLabel: "Nov 5 – 15, 2026",
    shortDesc: "Free & low-cost South Asian music, dance, rangoli art, and community markets.",
    longDesc: "Celebrate the 22nd annual Diwali Fest (Festival of Lights) across Metro Vancouver! Experience classical and contemporary South Asian music, bhangra and kathak dance showcases, intimate Mehfil concerts, rangoli art installations, and vibrant community celebrations at Roundhouse Community Centre and Surrey Civic Plaza.",
    venues: "Roundhouse Community Centre & Surrey Civic Plaza",
    officialUrl: "https://www.diwalifest.ca",
    officialLabel: "Official Diwali Fest Schedule ↗"
  },
  "downtown-eastside-heart-of-the-city-festival": {
    id: "downtown-eastside-heart-of-the-city-festival",
    label: "DTES Heart of the City Festival",
    icon: "❤️",
    datesLabel: "Oct 30 – Nov 7, 2026",
    shortDesc: "100+ free & PWYC community concerts, theatre, poetry, and visual arts across the DTES.",
    longDesc: "Community-led multi-arts festival featuring over 100 free or pay-what-you-can concerts, readings, art displays, films, and theatre pieces celebrating the artists, history, and living culture of Vancouver's Downtown Eastside.",
    venues: "30+ Venues across Vancouver's Downtown Eastside",
    officialUrl: "https://www.heartofthecityfestival.com/",
    officialLabel: "Official Heart of the City Guide ↗"
  },
  "vancouver-fringe-festival": {
    id: "vancouver-fringe-festival",
    label: "Vancouver Fringe Festival",
    icon: "🎪",
    datesLabel: "Sept 10 – 20, 2026",
    shortDesc: "Uncurated indie theatre, comedy, and solo shows across Granville Island & East Van ($15–$18).",
    longDesc: "Vancouver's iconic uncurated independent theatre celebration across Granville Island and East Van! Individual show tickets are $15.00 – $18.00 CAD all-in, with 100% of base ticket proceeds going directly to performing artists.",
    venues: "Granville Island (Waterfront Theatre, Performance Works, Revue Stage) & East Van",
    officialUrl: "https://vancouverfringe.com/shows/",
    officialLabel: "Official Fringe Program ↗"
  },
  "vancouver-international-film-festival": {
    id: "vancouver-international-film-festival",
    label: "Vancouver International Film Festival (VIFF)",
    icon: "🎬",
    datesLabel: "Sept 24 – Oct 4, 2026",
    shortDesc: "World cinema, auteur premieres, and live-scored screenings across Vancouver.",
    longDesc: "Western Canada's premier celebration of world cinema, award-winning auteur features, and international film premieres across VIFF Centre, The Cinematheque, and the Rio Theatre.",
    venues: "VIFF Centre, The Cinematheque & Rio Theatre",
    officialUrl: "https://viff.org",
    officialLabel: "Official VIFF Program ↗"
  },
  "vancouver-writers-fest": {
    id: "vancouver-writers-fest",
    label: "Vancouver Writers Fest",
    icon: "📚",
    datesLabel: "Oct 19 – 25, 2026",
    shortDesc: "Acclaimed Canadian and international authors, poets, and literary conversations on Granville Island.",
    longDesc: "Premier annual literary festival bringing together acclaimed Canadian and international authors, poets, and thinkers for readings, panels, and conversations across Granville Island.",
    venues: "Granville Island Theatres",
    officialUrl: "https://writersfest.bc.ca/",
    officialLabel: "Official Writers Fest Schedule ↗"
  },
  "vancouver-horror-show-film-festival": {
    id: "vancouver-horror-show-film-festival",
    label: "Vancouver Horror Show Film Festival",
    icon: "🩸",
    datesLabel: "Oct 13 – 18, 2026",
    shortDesc: "Indie horror, thriller, sci-fi, and dark comedy features and shorts with filmmaker Q&As.",
    longDesc: "Vancouver's premier annual genre film festival showcasing international and Canadian horror, thriller, sci-fi, and dark comedy features and short films with filmmaker Q&As, table reads, and awards.",
    venues: "Cineplex International Village & Greta Bar YVR",
    officialUrl: "https://www.vancouverhorrorshow.com",
    officialLabel: "Official VHS Schedule ↗"
  }
};

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
  festivalDetailsExpanded: false,
  expandedThemes: new Set(),
  selectedThemeFilter: null,
  excludedThemes: new Set(),
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
  : (typeof VAN50_EVENTS !== 'undefined' ? VAN50_EVENTS.map(normalizeActiveEvent) : (typeof VANCOUVER_EVENTS !== 'undefined' ? VANCOUVER_EVENTS.map(normalizeActiveEvent) : []));

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
  if (typeof initVancouverMap === 'function') {
    initVancouverMap();
  }
  updateReviewQueueBadge();
  loadCentralReference();

  // Real-time minute interval: automatically remove cards as venue hours conclude and events end
  setInterval(() => {
    applyFiltersAndRender();
  }, 60000);
});

function isAddonTier(t) {
  if (!t) return false;
  if (typeof t === 'string') {
    const s = t.toLowerCase().trim();
    if (/comedy club|nightclub|jazz club|supper club|breakfast club|social club|country club/i.test(s)) return false;
    return /\b(rental|rentals|renting|add-on|addon|add on|caddy|tasting tent|tasting pass|skate rental|shoe rental|club rental|mat rental|coat check)\b/i.test(s);
  }
  if (t.isAddon === true || t.is_addon === true) return true;
  const name = String(t.name || t.tier_name || '').toLowerCase().trim();
  if (!name) return false;
  if (/comedy club|nightclub|jazz club|supper club|breakfast club|social club|country club/i.test(name)) return false;
  return /\b(rental|rentals|renting|add-on|addon|add on|caddy|tasting tent|tasting pass|skate rental|shoe rental|club rental|mat rental|coat check)\b/i.test(name);
}

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
      syn.push({ name: ev.tier_custom_name_1, price: ev.tier_custom_price_1, status: ev.tier_custom_status_1 || null, isAddon: Boolean(ev.tier_custom_is_addon_1 || isAddonTier(ev.tier_custom_name_1)) });
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
      syn.push({ name: ev.tier_custom_name_2, price: ev.tier_custom_price_2, status: ev.tier_custom_status_2 || null, isAddon: Boolean(ev.tier_custom_is_addon_2 || isAddonTier(ev.tier_custom_name_2)) });
    }
    if (ev.tier_custom_name_3 && ev.tier_custom_name_3 !== 'null' && ev.tier_custom_price_3 != null && String(ev.tier_custom_price_3).toLowerCase() !== 'null') {
      syn.push({ name: ev.tier_custom_name_3, price: ev.tier_custom_price_3, status: ev.tier_custom_status_3 || null, isAddon: Boolean(ev.tier_custom_is_addon_3 || isAddonTier(ev.tier_custom_name_3)) });
    }
    if (ev.tier_custom_name_4 && ev.tier_custom_name_4 !== 'null' && ev.tier_custom_price_4 != null && String(ev.tier_custom_price_4).toLowerCase() !== 'null') {
      syn.push({ name: ev.tier_custom_name_4, price: ev.tier_custom_price_4, status: ev.tier_custom_status_4 || null, isAddon: Boolean(ev.tier_custom_is_addon_4 || isAddonTier(ev.tier_custom_name_4)) });
    }
    if (ev.tier_custom_name_5 && ev.tier_custom_name_5 !== 'null' && ev.tier_custom_price_5 != null && String(ev.tier_custom_price_5).toLowerCase() !== 'null') {
      syn.push({ name: ev.tier_custom_name_5, price: ev.tier_custom_price_5, status: ev.tier_custom_status_5 || null, isAddon: Boolean(ev.tier_custom_is_addon_5 || isAddonTier(ev.tier_custom_name_5)) });
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
    const isAddon = Boolean(t.isAddon || t.is_addon || isAddonTier(t));

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
      isExpired,
      isAddon
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

function formatIsoTime(rawTime, defaultTime = "19:00:00") {
  if (!rawTime || typeof rawTime !== 'string' || /none_available|unknown/i.test(rawTime)) return defaultTime;
  const match = rawTime.trim().match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
  if (!match) return defaultTime;
  let h = parseInt(match[1], 10);
  const m = match[2] ? match[2] : "00";
  const ampm = (match[3] || "").toUpperCase();
  if (ampm === "PM" && h < 12) h += 12;
  if (ampm === "AM" && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m}:00`;
}

function formatDisplayTime12h(rawTime) {
  if (!rawTime || typeof rawTime !== 'string' || /none_available|not_applicable|unknown/i.test(rawTime)) return '';
  const trimmed = rawTime.trim();
  const singleMatch = trimmed.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(AM|PM|am|pm)?$/);
  if (singleMatch) {
    let h = parseInt(singleMatch[1], 10);
    const m = singleMatch[2] || "00";
    const mer = singleMatch[3] ? singleMatch[3].toUpperCase() : null;
    if (h > 24) return trimmed;
    if (mer) {
      if (mer === "PM" && h < 12) h += 12;
      if (mer === "AM" && h === 12) h = 0;
    }
    const period = h >= 12 && h < 24 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m} ${period}`;
  }
  return formatScheduleText12h(trimmed);
}

function formatScheduleText12h(str) {
  if (!str || typeof str !== 'string') return str || '';
  return str.replace(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(\s*(?:AM|PM|am|pm))?\b/g, (full, hh, mm, mer) => {
    let h = parseInt(hh, 10);
    const m = mm;
    const merUpper = mer ? mer.trim().toUpperCase() : null;
    if (merUpper) {
      if (merUpper === "PM" && h < 12) h += 12;
      if (merUpper === "AM" && h === 12) h = 0;
    }
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m} ${period}`;
  });
}

function parseWeeklyHoursTo7DayObject(rawWh, fallbackScheduleStr, isDropIn) {
  if (rawWh && typeof rawWh === 'object' && !Array.isArray(rawWh)) {
    return rawWh;
  }
  const sourceStr = sanitizeMojibake(String(rawWh || (isDropIn ? fallbackScheduleStr : '') || '').trim());
  if (!sourceStr && !isDropIn) return null;

  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const fullDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const dayMap = {
    mon: 0, monday: 0, mondays: 0,
    tue: 1, tues: 1, tuesday: 1, tuesdays: 1,
    wed: 2, weds: 2, wednesday: 2, wednesdays: 2,
    thu: 3, thur: 3, thurs: 3, thursday: 3, thursdays: 3,
    fri: 4, friday: 4, fridays: 4,
    sat: 5, saturday: 5, saturdays: 5,
    sun: 6, sunday: 6, sundays: 6
  };

  const result = {};
  if (!sourceStr) {
    if (isDropIn) {
      days.forEach((d, idx) => { result[d] = 'Open Daily'; result[fullDays[idx]] = 'Open Daily'; });
      return result;
    }
    return null;
  }

  // Strip parenthetical commentary that confuses day splitters unless it only has "Closed ..."
  let cleaned = sourceStr.replace(/\s*•\s*(?:Current Exhibition|Running through|Free First Fridays).*$/i, '').trim();

  // Check if it's a "Daily: X" or "Open Daily: X" pattern
  if (/^(?:open\s+)?daily\b/i.test(cleaned) && !/\b(?:mon|tue|wed|thu|fri|sat|sun)\b/i.test(cleaned.replace(/\s*\([^)]*\)/g, ''))) {
    const val = cleaned
      .replace(/^(?:open\s+)?daily(?:\s+year-round)?\s*[:•-]?\s*/i, '')
      .replace(/\s*\([^)]*\)/g, '')
      .trim() || 'Open Daily';
    days.forEach((d, idx) => { result[d] = val; result[fullDays[idx]] = val; });
    return result;
  }

  // Check if it has "Plaza & Commons: Daily 10:00 AM - 8:00 PM..."
  const dailyMatch = cleaned.match(/\bDaily\s*[:•-]?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)\s*[-–—to]+\s*(?:\d{1,2}(?::\d{2})?\s*(?:AM|PM)|Dusk|Sunset))/i);
  if (dailyMatch && !/\b(?:mon|tue|wed|thu|fri|sat|sun)\b/i.test(cleaned.replace(/\s*\([^)]*\)/g, ''))) {
    const val = dailyMatch[1].trim();
    days.forEach((d, idx) => { result[d] = val; result[fullDays[idx]] = val; });
    return result;
  }

  // Split into clauses by ; or • or , when followed by a day name or Closed
  const withoutParens = cleaned.replace(/\(([^)]*)\)/g, (m, inner) => {
    if (/\b(closed|until|mon|tue|wed|thu|fri|sat|sun)\b/i.test(inner)) {
      return '; ' + inner;
    }
    return '';
  });

  const clauses = withoutParens
    .split(/\s*[;•]\s*|\s*,\s*(?=(?:mon|tue|wed|thu|fri|sat|sun|daily|closed)\b)/i)
    .map(c => c.trim())
    .filter(Boolean);

  const dayRegex = /\b(mondays?|mon|tuesdays?|tues?|wednesdays?|weds?|thursdays?|thurs?|thur?|fridays?|fri|saturdays?|sat|sundays?|sun)\b/gi;

  let matchedAny = false;
  for (const clause of clauses) {
    // Handle "Closed Mondays" or "Closed Mon-Tue"
    const closedPrefix = clause.match(/^closed\s+(.+)$/i);
    let dayPart = '';
    let hoursPart = '';

    if (closedPrefix) {
      dayPart = closedPrefix[1];
      hoursPart = 'Closed';
    } else if (/^(?:fri|thu|wed|tue|mon|sat|sun)[a-z]*\s+until\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i.test(clause)) {
      const untilM = clause.match(/^([a-z]+)\s+until\s+(.+)$/i);
      if (untilM) {
        const dIdx = dayMap[untilM[1].toLowerCase()];
        if (dIdx !== undefined) {
          const prev = result[days[dIdx]] || '10:00 AM - 5:00 PM';
          const updated = prev.replace(/[-–—]\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)/i, `– ${untilM[2].trim()}`);
          result[days[dIdx]] = updated;
          result[fullDays[dIdx]] = updated;
          matchedAny = true;
        }
      }
      continue;
    } else {
      // Match day specification before colon or time
      const colonIdx = clause.search(/:\s*(?=\d|Closed|Open|Sunrise|Dawn)/i);
      if (colonIdx !== -1) {
        dayPart = clause.slice(0, colonIdx).trim();
        hoursPart = clause.slice(colonIdx + 1).trim();
      } else {
        const timeStart = clause.search(/\b(?:\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)|Closed|Open)\b/);
        if (timeStart > 0) {
          dayPart = clause.slice(0, timeStart).trim();
          hoursPart = clause.slice(timeStart).trim();
        }
      }
    }

    if (!dayPart || !hoursPart) continue;
    hoursPart = hoursPart.replace(/^[:•-]\s*/, '').trim();

    // Parse ranges like "Mon-Wed", "Fri–Sun", "Wednesday, Friday–Sunday", "Tuesday to Sunday"
    const rangeTokens = dayPart.split(/\s*(?:,|&|and)\s*/i);
    for (const tok of rangeTokens) {
      const rangeM = tok.match(/\b(mondays?|mon|tuesdays?|tues?|wednesdays?|weds?|thursdays?|thurs?|thur?|fridays?|fri|saturdays?|sat|sundays?|sun)\s*(?:[-–—]|to)\s*(mondays?|mon|tuesdays?|tues?|wednesdays?|weds?|thursdays?|thurs?|thur?|fridays?|fri|saturdays?|sat|sundays?|sun)\b/i);
      if (rangeM) {
        const startIdx = dayMap[rangeM[1].toLowerCase()];
        const endIdx = dayMap[rangeM[2].toLowerCase()];
        if (startIdx !== undefined && endIdx !== undefined) {
          let i = startIdx;
          while (true) {
            result[days[i]] = hoursPart;
            result[fullDays[i]] = hoursPart;
            matchedAny = true;
            if (i === endIdx) break;
            i = (i + 1) % 7;
          }
        }
      } else {
        let m;
        dayRegex.lastIndex = 0;
        while ((m = dayRegex.exec(tok)) !== null) {
          const idx = dayMap[m[1].toLowerCase()];
          if (idx !== undefined) {
            result[days[idx]] = hoursPart;
            result[fullDays[idx]] = hoursPart;
            matchedAny = true;
          }
        }
      }
    }
  }

  if (matchedAny) {
    days.forEach((d, idx) => {
      if (!result[d]) {
        result[d] = 'Closed';
        result[fullDays[idx]] = 'Closed';
      }
    });
    return result;
  }

  if (isDropIn) {
    const cleanFallback = cleaned.replace(/\s*\([^)]*\)/g, '').trim() || 'Open Daily';
    days.forEach((d, idx) => {
      result[d] = cleanFallback;
      result[fullDays[idx]] = cleanFallback;
    });
    return result;
  }

  return null;
}

function normalizeActiveEvent(item) {
  if (!item) return item;

  const price = (item.pricing_all_in_cad && item.pricing_all_in_cad.regular !== undefined && item.pricing_all_in_cad.regular !== null)
    ? Number(item.pricing_all_in_cad.regular)
    : Number(item.price || 0.0);

  let showings = Array.isArray(item.showings) ? item.showings : [];
  const show1 = item.show_1 || showings[0] || {};
  const show2 = item.show_2 || showings[1] || {};
  const show3 = item.show_3 || showings[2] || {};

  if (showings.length === 0) {
    showings = [show1, show2, show3].filter(s => s && s.date);
  }
  const confirmedDates = showings.length > 0
    ? showings.map(s => s.date).filter(Boolean)
    : [show1.date, show2.date, show3.date].filter(Boolean);

  const catRaw = (item.category || "shows").toLowerCase();
  const isFreePublic = catRaw.includes("public access") || catRaw.includes("free public") || catRaw === "free-public-access" || item.lifecycle_type === "perennial_drop_in" || item.lifecycleType === "perennial_drop_in";

  const evTitle = sanitizeMojibake(item.event_name || item.title || "Event");
  const rawFestivalAff = (item.festival_affiliation && item.festival_affiliation !== "None" && item.festival_affiliation !== "none_available")
    ? item.festival_affiliation
    : ((item.festivalAffiliation && item.festivalAffiliation !== "None" && item.festivalAffiliation !== "none_available") ? item.festivalAffiliation : null);
  const hasFestivalAffiliation = Boolean(rawFestivalAff);

  const rawHolidayAff = (() => {
    const explicit = item.holiday_affiliation || item.holidayAffiliation || (item.dimension_audit && (item.dimension_audit.D008_holiday_affiliation?.value || item.dimension_audit.D009_holiday_affiliation?.value));
    if (explicit && explicit !== "None" && explicit !== "none_available") return String(explicit).toLowerCase().trim();
    const checkText = `${evTitle} ${(Array.isArray(item.tags) ? item.tags.join(" ") : "")} ${item.description || ""}`.toLowerCase();
    const primaryDateStr = confirmedDates[0] || item.date || null;
    const eventMmdd = (primaryDateStr && /^\d{4}-\d{2}-\d{2}$/.test(primaryDateStr)) ? primaryDateStr.slice(5, 10) : null;
    const inSeason = (startMmdd, endMmdd) => {
      if (!eventMmdd) return false;
      if (startMmdd <= endMmdd) return eventMmdd >= startMmdd && eventMmdd <= endMmdd;
      return eventMmdd >= startMmdd || eventMmdd <= endMmdd;
    };
    if (/\b(?:diwali|deepavali|bandi\s*chhor)\b/i.test(checkText)) return "diwali";
    if (/\b(?:muertos|day of the dead|ofrenda|calavera|catrina|sugar skull)\b/i.test(checkText)) return "dia-de-los-muertos";
    if (/\b(?:halloween|hallowe'en|trick[- ]or[- ]treat|jack[- ]o'?[- ]lantern|samhain|boo[- ]?tylicious)\b/i.test(checkText)) return "halloween";
    if (/\b(?:christmas|xmas|keithmas|yule|yuletide|santa|krampus|nutcracker|hanukkah|chanukah|kwanzaa|scrooge|grinch)\b/i.test(checkText)) return "christmas";
    if (/\b(?:new year'?s|nye|hogmanay|polar bear swim)\b/i.test(checkText)) return "new-years";
    if (/\b(?:lunar new year|chinese new year|spring festival|tet festival)\b/i.test(checkText)) return "lunar-new-year";
    if (/\b(?:thanksgiving|friendsgiving)\b/i.test(checkText)) return "thanksgiving";
    if (/\b(?:valentine'?s|galentine'?s|anti[- ]valentine)\b/i.test(checkText)) return "valentines-day";
    if (/\b(?:st\.?\s*patrick'?s|st\.?\s*paddy'?s|paddy'?s day)\b/i.test(checkText)) return "st-patricks-day";
    if (/\b(?:easter|egg hunt|good friday|ostara)\b/i.test(checkText)) return "easter";
    if (/\b(?:canada day)\b/i.test(checkText)) return "canada-day";
    if (/\b(?:pride festival|vancouver pride|pride parade|queer pride)\b/i.test(checkText)) return "pride";
    if (inSeason("10-01", "11-03") && /\b(?:haunted|spooky|horror|slasher|thriller|costume|masquerade|zombie|vampire|vampyr|witch|witches|ghost|goth|gothic|occult|macabre|monster|pumpkin|fright|scream|creepy|murder mystery|deadly dinner|unexplained|paranormal|x[- ]files|yes files|seance|séance|rocky horror|nosferatu|frankenstein|dracula|evil dead|exorcist|dark cabaret|freak show)\b/i.test(checkText)) return "halloween";
    if (inSeason("10-15", "11-20") && /\b(?:festival of lights|rangoli|bhangra|bollywood|garba|dandiya|mehfil|diya)\b/i.test(checkText)) return "diwali";
    if (inSeason("11-12", "12-30") && /\b(?:holiday market|winter market|craft market|winter solstice|festive|ugly sweater|carol|carols|caroling|menorah|gingerbread|mistletoe|polar express|canyon lights|bright nights|winter wonderland|holiday special|holiday show|holiday concert|holiday party)\b/i.test(checkText)) return "christmas";
    return null;
  })();
  const hasHolidayAffiliation = Boolean(rawHolidayAff);

  const isFest = Boolean(
    hasFestivalAffiliation ||
    item.event_archetype === "festival" ||
    item.archetype === "festival" ||
    catRaw.includes("festival") ||
    /\b(viff|diwali|fringe)\b/i.test(evTitle) ||
    (Array.isArray(item.tags) && item.tags.some(t => /\b(festival|viff|diwali|fringe)\b/i.test(String(t))))
  );
  const isHoliday = hasHolidayAffiliation;

  let dateSchedule = "Upcoming";
  const opHours = sanitizeMojibake(item.operating_hours || item.open_hours || item.hours || item.operatingHours || "");
  const rawWh = item.weekly_hours || item.weeklyHours || null;
  const wh = parseWeeklyHoursTo7DayObject(rawWh, opHours || item.dateSchedule || item.date_schedule, isFreePublic);

  const primaryShow = showings[0] || show1;

  if (isFreePublic) {
    if (wh) {
      dateSchedule = "Open Daily to the Public";
    } else if (opHours) {
      dateSchedule = `Visiting Hours: ${formatScheduleText12h(opHours)}`;
    } else if (show1.start_time && show1.end_time && !/none_available/i.test(show1.start_time)) {
      dateSchedule = `Open: ${formatDisplayTime12h(show1.start_time)} – ${formatDisplayTime12h(show1.end_time)}`;
    } else {
      dateSchedule = "Open Daily to the Public";
    }
  } else if (showings.length > 1) {
    const isFilm = (catRaw.includes("cinema") || catRaw.includes("film") || isFest);
    dateSchedule = isFilm ? `${showings.length} Screenings across Vancouver` : `${showings.length} Dates Scheduled`;
  } else if (primaryShow && primaryShow.date) {
    const dObj = new Date(primaryShow.date.length === 10 ? primaryShow.date + 'T12:00:00' : primaryShow.date);
    const dateLabel = !isNaN(dObj.getTime())
      ? dObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : primaryShow.date;
    dateSchedule = dateLabel;
    const sTime = primaryShow.start_time || item.start_time || item.time;
    if (sTime && !/none_available/i.test(sTime)) {
      dateSchedule += ` at ${formatDisplayTime12h(sTime)}`;
    }
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
  if ((isFest || isHoliday) && !categories.includes("festivals")) categories.push("festivals");

  if (categories.length === 0) {
    categories.push(isFreePublic ? "free-public-access" : "shows");
  }

  // Determine primary category for badge display
  let cat = categories[0];
  if (isCinema) cat = "cinema";
  else if (isOutdoors && (catRaw.includes("sport") || (item.access_model === "open_public_space" && !isSocialArts && !isMarkets && !isFest && !isMusic))) cat = "outdoors";
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

  // Build normalized subTags and structured Festival/Holiday theme badges
  const baseSubTags = Array.isArray(item.tags) ? [...item.tags] : (Array.isArray(item.subTags) ? [...item.subTags] : []);
  const themeBadges = [];
  if (rawFestivalAff) {
    const festShort = String(rawFestivalAff).replace(/\s*\(.*?\)\s*/g, '').trim();
    const festSlug = festShort.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const festIcon = /diwali/i.test(rawFestivalAff) ? '🪔' : (/viff|film/i.test(rawFestivalAff) ? '🎬' : '🎪');
    themeBadges.push({
      key: `festival:${festSlug}`,
      type: 'festival',
      id: festSlug,
      label: festShort,
      fullLabel: rawFestivalAff,
      icon: festIcon
    });
    for (const t of ['festival', festSlug, `festival:${festSlug}`]) {
      if (t && !baseSubTags.some(x => String(x).toLowerCase() === t)) baseSubTags.push(t);
    }
  }
  if (rawHolidayAff) {
    const holMeta = (window.HOLIDAY_REGISTRY && window.HOLIDAY_REGISTRY[rawHolidayAff]) || {
      id: rawHolidayAff,
      label: rawHolidayAff.charAt(0).toUpperCase() + rawHolidayAff.slice(1),
      icon: '🎉',
      keywords: rawHolidayAff
    };
    // Avoid duplicate badge if Diwali Fest is already added as festival:diwali-fest, but still tag both
    const alreadyCoveredByFestival = themeBadges.some(b => b.id.includes(rawHolidayAff) || rawHolidayAff.includes(b.id));
    if (!alreadyCoveredByFestival) {
      themeBadges.push({
        key: `holiday:${rawHolidayAff}`,
        type: 'holiday',
        id: rawHolidayAff,
        label: holMeta.label,
        fullLabel: holMeta.label,
        icon: holMeta.icon
      });
    }
    for (const t of ['holiday', rawHolidayAff, `holiday:${rawHolidayAff}`]) {
      if (t && !baseSubTags.some(x => String(x).toLowerCase() === t)) baseSubTags.push(t);
    }
  }

  // Option 1: Content-based Religious / Spiritual detection (never triggered by church/temple venue building alone)
  const isReligious = (() => {
    if (item.is_religious === true || item.isReligious === true) return true;
    if (item.is_religious === false || item.isReligious === false) return false;
    const contentText = `${evTitle} ${(Array.isArray(item.tags) ? item.tags.join(" ") : "")} ${item.description || ""}`.toLowerCase();
    return /\b(?:prayer|prayers|worship\s*service|worship\s*night|liturgy|liturgical|eucharist|holy\s*mass|christmas\s*mass|midnight\s*mass|vespers|evensong|sermon|scripture|bible\s*study|gospel\s*service|devotional\s*chanting|chanting,\s*singing,\s*and\s*prayer|candlelit\s*contemplative|taiz[eé]|shabbat\s*service|torah\s*service|synagogue\s*service|puja|kirtan|satsang|arti|aarti|jummah|tarawih|gurdwara\s*diwan|interfaith\s*service|sacred\s*chant)\b/i.test(contentText);
  })();
  if (isReligious) {
    themeBadges.push({
      key: 'religious:religious',
      type: 'religious',
      id: 'religious',
      label: 'Religious / Spiritual',
      fullLabel: 'Religious / Spiritual',
      icon: '🕯️'
    });
    for (const t of ['religious', 'spiritual', 'religious:religious']) {
      if (t && !baseSubTags.some(x => String(x).toLowerCase() === t)) baseSubTags.push(t);
    }
  }

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
    subTags: baseSubTags,
    dateSchedule: dateSchedule,
    startIso: (!isFreePublic && (showings[0]?.date || show1.date || item.date))
      ? `${showings[0]?.date || show1.date || item.date}T${formatIsoTime(showings[0]?.start_time || show1.start_time || item.start_time || item.time, "19:00:00")}-07:00`
      : (item.startIso || null),
    endIso: (() => {
      const lastShow = (showings && showings.length > 0) ? showings[showings.length - 1] : show1;
      const lDate = lastShow?.date || item.date || show1.date;
      const rawEnd = lastShow?.end_time || show1.end_time || item.end_time;
      if (lDate && rawEnd && !/none_available|unknown/i.test(rawEnd)) {
        return `${lDate}T${formatIsoTime(rawEnd, "22:00:00")}-07:00`;
      }
      if (lDate) {
        const rawStart = lastShow?.start_time || show1.start_time || item.start_time || item.time;
        const startIsoStr = `${lDate}T${formatIsoTime(rawStart, "19:00:00")}-07:00`;
        const dt = new Date(startIsoStr);
        if (!isNaN(dt.getTime())) {
          return new Date(dt.getTime() + 150 * 60 * 1000).toISOString().replace('Z', '-07:00');
        }
      }
      return null;
    })(),
    confirmedDates: confirmedDates,
    showings: showings,
    isSoldOut: Boolean(item.is_sold_out || item.isSoldOut),
    is_sold_out: Boolean(item.is_sold_out || item.isSoldOut),
    isFestival: isFest,
    isHoliday: isHoliday,
    isFestivalOrHoliday: Boolean(isFest || isHoliday),
    festivalAffiliation: rawFestivalAff || null,
    holidayAffiliation: rawHolidayAff || null,
    isReligious: isReligious,
    themeBadges: themeBadges,
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
    drink_benchmark: (() => {
      if (item.drink_benchmark && item.drink_benchmark !== "none_available" && item.drink_benchmark !== "not_applicable") {
        return sanitizeMojibake(item.drink_benchmark);
      }
      const beer = item.beer_benchmark || (item.spend_benchmarks && item.spend_benchmarks.beer) || null;
      const cocktail = item.cocktail_benchmark || (item.spend_benchmarks && item.spend_benchmarks.cocktail) || null;
      const validBeer = (beer && beer !== "none_available" && beer !== "not_applicable" && beer !== "search_exhausted_null") ? sanitizeMojibake(beer) : null;
      const validCocktail = (cocktail && cocktail !== "none_available" && cocktail !== "not_applicable" && cocktail !== "search_exhausted_null") ? sanitizeMojibake(cocktail) : null;
      if (validBeer && validCocktail) return `Beer ${validBeer.replace(/\s*\(.*?\)/g, '')} • Cocktails ${validCocktail.replace(/\s*\(.*?\)/g, '')}`;
      if (validBeer) return `Beer ${validBeer}`;
      if (validCocktail) return `Cocktails ${validCocktail}`;
      return null;
    })(),
    concession_benchmark: sanitizeMojibake(item.concession_benchmark || null),
    beer_benchmark: (() => {
      const v = item.beer_benchmark || (item.spend_benchmarks && item.spend_benchmarks.beer) || null;
      return (v && v !== "none_available" && v !== "not_applicable" && v !== "search_exhausted_null") ? sanitizeMojibake(v) : null;
    })(),
    cocktail_benchmark: (() => {
      const v = item.cocktail_benchmark || (item.spend_benchmarks && item.spend_benchmarks.cocktail) || null;
      return (v && v !== "none_available" && v !== "not_applicable" && v !== "search_exhausted_null") ? sanitizeMojibake(v) : null;
    })(),
    spend_benchmarks: item.spend_benchmarks || null,
    typical_item_spend: (() => {
      if (item.typical_item_spend && item.typical_item_spend !== "none_available" && item.typical_item_spend !== "Uncalibrated") {
        return sanitizeMojibake(item.typical_item_spend);
      }
      const cleanVal = (raw) => {
        if (!raw || typeof raw !== "string") return null;
        const trimmed = raw.trim();
        if (!trimmed || trimmed === "none_available" || trimmed === "not_applicable" || trimmed === "search_exhausted_null") return null;
        return sanitizeMojibake(trimmed);
      };
      const shortRange = (val) => val ? val.replace(/\s+CAD\b/gi, '').replace(/\s*\(.*?\)/g, '').trim() : null;
      const beer = cleanVal(item.beer_benchmark || (item.spend_benchmarks && item.spend_benchmarks.beer));
      const cocktail = cleanVal(item.cocktail_benchmark || (item.spend_benchmarks && item.spend_benchmarks.cocktail));
      const coffee = cleanVal(item.coffee_benchmark || (item.spend_benchmarks && item.spend_benchmarks.coffee));
      const meal = cleanVal(item.meal_benchmark || (item.spend_benchmarks && item.spend_benchmarks.meal));
      const concession = cleanVal(item.concession_benchmark || (item.spend_benchmarks && item.spend_benchmarks.concession));
      const otherCost = (item.other_cost_label && item.other_cost_label !== "none_available" && Number(item.other_cost_price) > 0)
        ? `$${Number(item.other_cost_price).toFixed(2)} (${item.other_cost_label.replace(/^Optional\s+/i, '')})`
        : null;
      const parts = [];
      if (beer) parts.push(`Beer ${shortRange(beer)}`);
      if (cocktail) parts.push(`Cocktails ${shortRange(cocktail)}`);
      if (!beer && !cocktail && coffee) parts.push(`Coffee/Drinks ${shortRange(coffee)}`);
      else if (coffee && parts.length < 2) parts.push(`Coffee ${shortRange(coffee)}`);
      if (concession && parts.length < 2) parts.push(`Concessions ${shortRange(concession)}`);
      if (meal && parts.length < 2) parts.push(`Food ${shortRange(meal)}`);
      if (parts.length === 0 && otherCost) parts.push(otherCost);
      return parts.length > 0 ? parts.join(' • ') : null;
    })(),
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
    ticket_tiers: Array.isArray(item.ticket_tiers) ? item.ticket_tiers : null,
    tiers: Array.isArray(item.tiers) ? item.tiers : null
  };

  const tiers = resolveEventTiers(res);
  res.tiers = tiers;

  // Recalculate dynamic effective price if active available tiers exist (excluding add-ons)
  if (!isFreePublic && tiers.length > 0) {
    const admissionTiers = tiers.filter(t => t.isAvailable && t.price <= 50 && !t.isAddon && !isAddonTier(t));
    const activeTiers = admissionTiers.length > 0 ? admissionTiers : tiers.filter(t => t.isAvailable && t.price <= 50);
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
      } else if (preset === 'under15') {
        state.minBudget = 0;
        state.maxBudget = 15;
      } else if (preset === 'under25') {
        state.minBudget = 0;
        state.maxBudget = 25;
      } else if (preset === 'under50') {
        state.minBudget = 0;
        state.maxBudget = 50;
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
      const mobileViewToggle = document.getElementById('mobile-view-toggle');
      if (mobileViewToggle) mobileViewToggle.innerHTML = '🗺️ Map';
      mapWrapper.style.display = 'none';
      mapWrapper.classList.remove('active');
    });

    viewMapBtn.addEventListener('click', () => {
      viewMapBtn.classList.add('active');
      viewCardsBtn.classList.remove('active');
      eventsGrid.style.display = 'none';
      const mobileViewToggle = document.getElementById('mobile-view-toggle');
      if (mobileViewToggle) mobileViewToggle.innerHTML = '📋 List';
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

  // Mobile Bottom Sheet (Secondary Filters) & Floating Map/List Toggle Handlers
  const mobileFilterTrigger = document.getElementById('mobile-filter-trigger');
  const mobileFiltersSheet = document.getElementById('mobile-filters-sheet');
  const mobileSheetBackdrop = document.getElementById('mobile-sheet-backdrop');
  const mobileSheetCloseBtn = document.getElementById('mobile-sheet-close-btn');
  const mobileSheetResetBtn = document.getElementById('mobile-sheet-reset-btn');
  const mobileSheetApplyBtn = document.getElementById('mobile-sheet-apply-btn');
  const mobileViewToggle = document.getElementById('mobile-view-toggle');

  window.openMobileFiltersSheet = function() {
    if (mobileFiltersSheet) mobileFiltersSheet.classList.add('is-open');
    if (mobileSheetBackdrop) mobileSheetBackdrop.classList.add('is-open');
    if (mobileFilterTrigger) mobileFilterTrigger.setAttribute('aria-expanded', 'true');
  };

  window.closeMobileFiltersSheet = function() {
    if (mobileFiltersSheet) mobileFiltersSheet.classList.remove('is-open');
    if (mobileSheetBackdrop) mobileSheetBackdrop.classList.remove('is-open');
    if (mobileFilterTrigger) mobileFilterTrigger.setAttribute('aria-expanded', 'false');
  };

  window.resetSecondaryFilters = function() { state.category = 'all'; state.selectedThemeFilter = null; if (state.excludedThemes) state.excludedThemes.clear(); state.hideFestivalEvents = false; renderCategoryPills(); renderFestivalSpotlight();
    state.minBudget = 0;
    state.maxBudget = 50;
    state.dayOfWeek = 'all';
    state.timeSlot = 'all';
    state.frequency = 'all';
    state.selectedNeighborhoods = new Set(window.NEIGHBORHOODS || []);
    state.hideDaily = false;
    state.accessibleOnly = false;
    if (minSlider) minSlider.value = 0;
    if (maxSlider) maxSlider.value = 50;
    if (hideDailyToggle) hideDailyToggle.checked = false;
    if (chkAccessibleOnly) chkAccessibleOnly.checked = false;
    renderDayPills();
    renderTimePills();
    renderNeighborhoodPills();
    renderFrequencyPills();
    clearActiveQuickButtons();
    updateSliderVisuals();
    applyFiltersAndRender();
  };

  if (mobileFilterTrigger) {
    mobileFilterTrigger.addEventListener('click', () => {
      if (mobileFiltersSheet && mobileFiltersSheet.classList.contains('is-open')) {
        window.closeMobileFiltersSheet();
      } else {
        window.openMobileFiltersSheet();
      }
    });
  }
  if (mobileSheetCloseBtn) mobileSheetCloseBtn.addEventListener('click', window.closeMobileFiltersSheet);
  if (mobileSheetBackdrop) mobileSheetBackdrop.addEventListener('click', window.closeMobileFiltersSheet);
  if (mobileSheetApplyBtn) mobileSheetApplyBtn.addEventListener('click', window.closeMobileFiltersSheet);
  if (mobileSheetResetBtn) mobileSheetResetBtn.addEventListener('click', window.resetSecondaryFilters);

  if (mobileViewToggle && viewCardsBtn && viewMapBtn && mapWrapper) {
    mobileViewToggle.addEventListener('click', () => {
      const isMapActive = mapWrapper.classList.contains('active') || mapWrapper.style.display === 'block';
      if (isMapActive) {
        viewCardsBtn.click();
      } else {
        viewMapBtn.click();
      }
    });
  }
  if (false) {
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
  } else if (minVal === 0 && maxVal === 15) {
    const u15Btn = document.getElementById('quick-cost-15');
    if (u15Btn) u15Btn.classList.add('active');
  } else if (minVal === 0 && maxVal === 25) {
    const u25Btn = document.getElementById('quick-cost-25');
    if (u25Btn) u25Btn.classList.add('active');
  } else if (minVal >= 1 && maxVal === 50) {
    const paidBtn = document.getElementById('quick-cost-paid');
    if (paidBtn) paidBtn.classList.add('active');
  } else if (minVal === 0 && maxVal === 50) {
    const allBtn = document.getElementById('quick-cost-all');
    if (allBtn) allBtn.classList.add('active');
  }
}

// ==============================================================================
// 1.5 FESTIVAL & HOLIDAY SPOTLIGHT, TAG CHIPS & EXPANDABLE DETAILS ENGINE
// ==============================================================================

function eventMatchesThemeKey(ev, themeKey) {
  if (!ev || !themeKey) return false;
  if (Array.isArray(ev.themeBadges) && ev.themeBadges.some(b => b.key === themeKey)) return true;
  const [type, slug] = String(themeKey).split(':');
  if (type === 'religious' && (ev.isReligious || ev.is_religious)) return true;
  if (type === 'holiday' && ev.holidayAffiliation && String(ev.holidayAffiliation).toLowerCase() === slug) return true;
  if (type === 'festival' && ev.festivalAffiliation) {
    const fSlug = String(ev.festivalAffiliation).toLowerCase().replace(/\s*\(.*?\)\s*/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (fSlug === slug || fSlug.includes(slug)) return true;
  }
  if (Array.isArray(ev.subTags) && ev.subTags.some(t => String(t).toLowerCase() === themeKey || String(t).toLowerCase() === slug)) return true;
  return false;
}

function getActiveThemeGroups(catalog) {
  const now = new Date();
  const groupsMap = new Map();
  (catalog || []).forEach(ev => {
    if (!ev || isEventInPast(ev, now) || isAwaitingSchedule(ev) || parseFloat(ev.price || 0) > 50) return;
    if (Array.isArray(ev.themeBadges)) {
      ev.themeBadges.forEach(b => {
        // Option 1: Keep the top banner strictly for Festivals & Holidays; religious badges appear on cards only
        if (!b || b.type === 'religious') return;
        if (!groupsMap.has(b.key)) {
          groupsMap.set(b.key, { ...b, count: 0 });
        }
        groupsMap.get(b.key).count++;
      });
    }
  });
  return Array.from(groupsMap.values());
}

// 8. Automate the Active Vancouver Festivals Banner (3-Tier Urgency Sort)
const THEME_DATE_WINDOWS = {
  'diwali': { startDate: '2026-11-05', endDate: '2026-11-15' },
  'diwali-fest': { startDate: '2026-11-05', endDate: '2026-11-15' },
  'downtown-eastside-heart-of-the-city-festival': { startDate: '2026-10-30', endDate: '2026-11-08' },
  'christmas': { startDate: '11-15', endDate: '12-30' },
  'new-years': { startDate: '12-26', endDate: '01-02' },
  'lunar-new-year': { startDate: '01-25', endDate: '02-20' },
  'valentines-day': { startDate: '02-01', endDate: '02-15' },
  'st-patricks-day': { startDate: '03-10', endDate: '03-18' },
  'easter': { startDate: '03-25', endDate: '04-12' },
  'canada-day': { startDate: '06-28', endDate: '07-02' },
  'pride': { startDate: '07-24', endDate: '08-05' },
  'vancouver-fringe-festival': { startDate: '09-10', endDate: '09-20' },
  'vancouver-international-film-festival': { startDate: '09-24', endDate: '10-04' },
  'thanksgiving': { startDate: '10-01', endDate: '10-14' },
  'vancouver-horror-show-film-festival': { startDate: '10-13', endDate: '10-18' },
  'vancouver-writers-fest': { startDate: '10-19', endDate: '10-25' },
  'halloween': { startDate: '10-01', endDate: '11-02' },
  'dia-de-los-muertos': { startDate: '10-31', endDate: '11-02' }
};

function parseFestivalDateWindow(g, meta, matchingEvents, today) {
  const currentYear = today.getFullYear();
  const rawId = String(g.id || '').toLowerCase();
  const win = (meta && meta.startDate && meta.endDate)
    ? { startDate: meta.startDate, endDate: meta.endDate }
    : THEME_DATE_WINDOWS[rawId];

  if (win && win.startDate && win.endDate) {
    const isRecurringStart = /^\d{2}-\d{2}$/.test(win.startDate);
    const isRecurringEnd = /^\d{2}-\d{2}$/.test(win.endDate);
    const startStr = isRecurringStart ? `${currentYear}-${win.startDate}` : win.startDate;
    const endStr = isRecurringEnd ? `${currentYear}-${win.endDate}` : win.endDate;

    let start = new Date(`${startStr}T00:00:00`);
    let end = new Date(`${endStr}T23:59:59`);

    if (isRecurringStart && isRecurringEnd && end < start) {
      if (today.getMonth() === 0) {
        start = new Date(`${currentYear - 1}-${win.startDate}T00:00:00`);
      } else {
        end = new Date(`${currentYear + 1}-${win.endDate}T23:59:59`);
      }
    }

    if (isRecurringStart && isRecurringEnd && end < today) {
      start = new Date(`${currentYear + 1}-${win.startDate}T00:00:00`);
      const endYear = win.endDate < win.startDate ? currentYear + 2 : currentYear + 1;
      end = new Date(`${endYear}-${win.endDate}T23:59:59`);
    }
    return { start, end };
  }

  const validDates = [];
  (matchingEvents || []).forEach(ev => {
    const candidates = [];
    if (ev.startDate) candidates.push(ev.startDate);
    if (ev.endDate) candidates.push(ev.endDate);
    if (ev.date) candidates.push(ev.date);
    if (Array.isArray(ev.confirmedDates)) candidates.push(...ev.confirmedDates);
    if (Array.isArray(ev.showings)) ev.showings.forEach(s => { if (s && s.date) candidates.push(s.date); });
    candidates.forEach(dStr => {
      const iso = String(dStr || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) validDates.push(iso);
    });
  });

  if (validDates.length > 0) {
    validDates.sort();
    return {
      start: new Date(`${validDates[0]}T00:00:00`),
      end: new Date(`${validDates[validDates.length - 1]}T23:59:59`)
    };
  }
  return null;
}

function getSortedActiveFestivals(catalog, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const rawGroups = getActiveThemeGroups(catalog);
  const evaluated = [];

  rawGroups.forEach(g => {
    if (!g || !g.count || g.count <= 0) return;
    const meta = getThemeMetadata(g);
    const matchingEvents = (catalog || []).filter(ev => ev && !isEventInPast(ev, now) && !isAwaitingSchedule(ev) && parseFloat(ev.price || 0) <= 50 && eventMatchesThemeKey(ev, g.key));
    const parsedWindow = parseFestivalDateWindow(g, meta, matchingEvents, today);
    if (!parsedWindow || isNaN(parsedWindow.start.getTime()) || isNaN(parsedWindow.end.getTime())) return;

    const startMidnight = new Date(parsedWindow.start.getFullYear(), parsedWindow.start.getMonth(), parsedWindow.start.getDate(), 0, 0, 0, 0);
    const endMidnight = new Date(parsedWindow.end.getFullYear(), parsedWindow.end.getMonth(), parsedWindow.end.getDate(), 0, 0, 0, 0);

    const daysUntilStart = Math.round((startMidnight.getTime() - today.getTime()) / 86400000);
    const daysUntilEnd = Math.round((endMidnight.getTime() - today.getTime()) / 86400000);
    const durationDays = Math.max(1, Math.round((endMidnight.getTime() - startMidnight.getTime()) / 86400000) + 1);

    let tier = 3;
    let urgencyBadge = '';
    let urgencyClass = '';

    if (today >= startMidnight && today <= parsedWindow.end) {
      tier = 1;
      if (daysUntilEnd === 0) {
        urgencyBadge = '🔥 Last Day!';
        urgencyClass = 'tier-1-last-day';
      } else if (daysUntilEnd <= 2) {
        urgencyBadge = `⏳ Ends in ${daysUntilEnd}d`;
        urgencyClass = 'tier-1-ending-soon';
      } else {
        urgencyBadge = '🟢 Live Now';
        urgencyClass = 'tier-1-live';
      }
    } else if (daysUntilStart > 0 && daysUntilStart <= 21) {
      tier = 2;
      urgencyClass = 'tier-2-upcoming';
      if (daysUntilStart === 1) {
        urgencyBadge = '⚡ Tomorrow';
      } else {
        urgencyBadge = `📅 In ${daysUntilStart}d`;
      }
    }

    if (tier === 1 || tier === 2) {
      evaluated.push({
        ...g,
        meta,
        tier,
        daysUntilStart,
        daysUntilEnd,
        durationDays,
        urgencyBadge,
        urgencyClass
      });
    }
  });

  evaluated.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.tier === 1) {
      if (a.daysUntilEnd !== b.daysUntilEnd) return a.daysUntilEnd - b.daysUntilEnd;
      if (a.durationDays !== b.durationDays) return a.durationDays - b.durationDays;
      return (b.count || 0) - (a.count || 0);
    }
    return a.daysUntilStart - b.daysUntilStart;
  });

  return evaluated;
}
window.getSortedActiveFestivals = getSortedActiveFestivals;

function _unusedThemeGroupsSentinel() {
}

function getThemeMetadata(g) {
  if (!g) return { label: 'Seasonal Celebration', datesLabel: 'Upcoming', shortDesc: 'Curated seasonal events under $50 CAD.', longDesc: 'Explore verified festival and holiday events across Metro Vancouver under $50 CAD.', venues: 'Metro Vancouver' };
  const rawId = String(g.id || '').toLowerCase();
  if (g.type === 'festival' && window.FESTIVAL_REGISTRY) {
    const exact = window.FESTIVAL_REGISTRY[rawId] || Object.values(window.FESTIVAL_REGISTRY).find(f => rawId.includes(f.id) || f.id.includes(rawId));
    if (exact) return exact;
  }
  if (g.type === 'holiday' && window.HOLIDAY_REGISTRY) {
    const exact = window.HOLIDAY_REGISTRY[rawId] || Object.values(window.HOLIDAY_REGISTRY).find(h => rawId.includes(h.id) || h.id.includes(rawId));
    if (exact) return exact;
  }
  if (window.HOLIDAY_REGISTRY && window.HOLIDAY_REGISTRY[rawId]) return window.HOLIDAY_REGISTRY[rawId];
  if (window.FESTIVAL_REGISTRY && window.FESTIVAL_REGISTRY[rawId]) return window.FESTIVAL_REGISTRY[rawId];
  return {
    id: rawId,
    label: g.fullLabel || g.label || 'Festival & Holiday',
    icon: g.icon || '🎉',
    datesLabel: 'Current Season',
    shortDesc: `Verified ${g.fullLabel || g.label} events across Metro Vancouver under $50 CAD.`,
    longDesc: `Explore curated ${g.fullLabel || g.label} performances, screenings, and cultural gatherings across Metro Vancouver—all verified under $50 CAD all-in.`,
    venues: 'Metro Vancouver Venues'
  };
}

function renderFestivalSpotlight() {
  const container = document.getElementById('festival-spotlight-container');
  if (!container) return;

  const now = new Date();
  const baseCatalog = (Array.isArray(window.currentActiveCatalog) && window.currentActiveCatalog.length > 0) ? window.currentActiveCatalog : ALL_EVENTS;
  const activeFestivalAndHolidayEvents = baseCatalog.filter(e => e && !isEventInPast(e, now) && !isAwaitingSchedule(e) && parseFloat(e.price || 0) <= 50 && (
    e.isFestivalOrHoliday ||
    e.isFestival ||
    e.isHoliday ||
    Boolean(e.festivalAffiliation) ||
    Boolean(e.holidayAffiliation) ||
    (Array.isArray(e.categories) && e.categories.includes('festivals'))
  ));

  const isHidden = state.hideFestivalEvents === true;
  const festCount = activeFestivalAndHolidayEvents.length;
  const themeGroups = getSortedActiveFestivals(baseCatalog, now); if (themeGroups.length === 0) { container.style.display = 'none'; return; } container.style.display = 'block'; if (false) { if (false) {

  if (themeGroups.length === 0) {
    }
  if (false) { container.style.display = 'none';
    return;
  }
  }
  if (false) {

  }
  container.style.display = 'block';
    }
  if (false) { container.style.display = 'none';
    return;
  }
  container.style.display = 'block';

  const hasFestivals = themeGroups.some(g => g.type === 'festival');
  const hasHolidays = themeGroups.some(g => g.type === 'holiday');

  let bannerTitle = 'Current Festivals and Holidays';
  if (themeGroups.length === 1) {
    bannerTitle = hasFestivals ? 'Current Festival' : 'Current Holiday';
  } else if (hasFestivals && !hasHolidays) {
    bannerTitle = 'Current Festivals';
  } else if (!hasFestivals && hasHolidays) {
    bannerTitle = 'Current Holidays';
  }

  const activeItemsListHtml = themeGroups.length > 0 ? `
    <div class="festival-active-items-list" role="region" aria-label="Active festivals and holidays">
      ${themeGroups.map(g => {
        const meta = getThemeMetadata(g);
        const isSelected = state.selectedThemeFilter === g.key;
        const isExcluded = state.excludedThemes && state.excludedThemes.has(g.key);
        const isItemExpanded = state.expandedThemes && state.expandedThemes.has(g.key);
        return `
          <div class="festival-theme-item-row ${isSelected ? 'item-row-selected' : ''} ${isExcluded ? 'item-row-excluded' : ''}">
            <button
              type="button"
              class="theme-item-name-toggle ${isItemExpanded ? 'expanded' : ''}"
              onclick="toggleThemeItemExpand('${g.key}', event)"
              aria-expanded="${isItemExpanded}"
              title="${isItemExpanded ? 'Hide description' : 'Click to expand description'}"
            >
              <strong class="theme-item-name">${meta.label}</strong>
              <span class="theme-item-chevron">${isItemExpanded ? '▴' : '▾'}</span>
            </button>
            <div class="theme-item-subrow">
              ${g.urgencyBadge ? `<span class="festival-urgency-badge ${g.urgencyClass || ''}">${g.urgencyBadge}</span>` : ''}
              ${meta.datesLabel ? `<span class="theme-item-dates-pill">${meta.datesLabel}</span>` : ''}
              <div class="festival-theme-item-actions">
                <button
                  type="button"
                  class="btn-theme-item-include ${isSelected ? 'active' : ''}"
                  onclick="toggleThemeFilter('${g.key}', event)"
                  title="${isSelected ? `Showing only ${meta.label} events. Click to show all outings` : `Filter catalog to show only ${meta.label} events (${g.count})`}"
                >${isSelected ? `✓ Included (${g.count})` : `Include (${g.count})`}</button>
                <button
                  type="button"
                  class="btn-theme-item-exclude ${isExcluded ? 'active' : ''}"
                  onclick="toggleExcludeTheme('${g.key}', event)"
                  title="${isExcluded ? `Currently excluded. Click to restore ${meta.label} events` : `Exclude (hide) ${meta.label} events from listings & map`}"
                >${isExcluded ? '👁️ Excluded' : '✕ Exclude'}</button>
              </div>
            </div>
            ${isItemExpanded ? `
              <div class="festival-theme-item-drawer">
                <p class="theme-item-short-desc">${meta.shortDesc}</p>
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  ` : '';

  container.innerHTML = `
    <div class="festival-spotlight-card festival-compact-banner">
      <div class="festival-spotlight-left">
        <div class="festival-compact-header-row">
          <h2 class="festival-spotlight-title">${bannerTitle}</h2>
        </div>
        ${activeItemsListHtml}
      </div>
    </div>
  `;
}

function toggleThemeItemExpand(themeKey, evObj) {
  if (evObj) {
    evObj.preventDefault();
    evObj.stopPropagation();
  }
  if (!themeKey) return;
  if (!state.expandedThemes) state.expandedThemes = new Set();
  if (state.expandedThemes.has(themeKey)) {
    state.expandedThemes.delete(themeKey);
  } else {
    state.expandedThemes.add(themeKey);
  }
  renderFestivalSpotlight();
}

function toggleFestivalDetailsDrawer() {
  state.festivalDetailsExpanded = !state.festivalDetailsExpanded;
  renderFestivalSpotlight();
}

function toggleThemeFilter(themeKey, evObj) {
  if (evObj) {
    evObj.preventDefault();
    evObj.stopPropagation();
  }
  if (!themeKey) return;
  if (state.excludedThemes && state.excludedThemes.has(themeKey)) {
    state.excludedThemes.delete(themeKey);
  }
  if (state.selectedThemeFilter === themeKey) {
    state.selectedThemeFilter = null;
  } else {
    state.selectedThemeFilter = themeKey;
    state.hideFestivalEvents = false;
  }
  renderFestivalSpotlight();
  applyFiltersAndRender();
}

function toggleExcludeTheme(themeKey, evObj) {
  if (evObj) {
    evObj.preventDefault();
    evObj.stopPropagation();
  }
  if (!themeKey) return;
  if (!state.excludedThemes) state.excludedThemes = new Set();
  if (state.excludedThemes.has(themeKey)) {
    state.excludedThemes.delete(themeKey);
  } else {
    state.excludedThemes.add(themeKey);
    if (state.selectedThemeFilter === themeKey) {
      state.selectedThemeFilter = null;
    }
  }
  renderFestivalSpotlight();
  applyFiltersAndRender();
}

function clearThemeFilters() {
  state.selectedThemeFilter = null;
  if (state.excludedThemes) state.excludedThemes.clear();
  state.hideFestivalEvents = false;
  renderFestivalSpotlight();
  applyFiltersAndRender();
}

function displayFestivalEvents() {
  state.selectedThemeFilter = null;
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
  if (state.hideFestivalEvents) {
    state.selectedThemeFilter = null;
    if (state.category === 'festivals') {
      state.category = 'all';
      renderCategoryPills();
    }
  }
  renderFestivalSpotlight();
  applyFiltersAndRender();
  if (typeof invalidateVancouverMap === 'function') {
    invalidateVancouverMap();
  }
}
window.displayFestivalEvents = displayFestivalEvents;
window.toggleHideFestivalEvents = toggleHideFestivalEvents;
window.toggleFestivalDetailsDrawer = toggleFestivalDetailsDrawer;
window.toggleThemeItemExpand = toggleThemeItemExpand;
window.toggleThemeFilter = toggleThemeFilter;
window.toggleExcludeTheme = toggleExcludeTheme;
window.clearThemeFilters = clearThemeFilters;
window.renderFestivalSpotlight = renderFestivalSpotlight;

// ==============================================================================
// 2. RENDERING FILTER PILLS
// ==============================================================================

if (typeof CATEGORIES === 'undefined') {
  window.CATEGORIES = [
    { id: "all", label: "All", shortLabel: "All", icon: "" },
    { id: "music", label: "Music", shortLabel: "Music", icon: "" },
    { id: "shows", label: "Comedy & Stage", shortLabel: "Comedy & Stage", icon: "" },
    { id: "outdoors", label: "Outdoors", shortLabel: "Outdoors", icon: "" },
    { id: "cinema", label: "Cinema", shortLabel: "Cinema", icon: "" },
    { id: "social", label: "Social & Arts", shortLabel: "Social & Arts", icon: "" },
    { id: "festivals", label: "Festivals", shortLabel: "Festivals", icon: "" },
    { id: "markets", label: "Markets", shortLabel: "Markets", icon: "" },
    { id: "free-public-access", label: "Free Public Access", shortLabel: "Free Access", icon: "" }
  ];
}

function renderCategoryPills() {
  const container = document.getElementById('categories-bar');
  if (!container || typeof CATEGORIES === 'undefined') return;

  const PRIMARY_VISIBLE_COUNT = 5;
  const extraCategories = CATEGORIES.slice(PRIMARY_VISIBLE_COUNT);
  const activeInExtra = extraCategories.some(c => c.id === state.category);
  const isExpanded = Boolean(state.categoriesExpanded || activeInExtra);

  container.className = `categories-bar categories-grid ${isExpanded ? 'expanded' : 'collapsed'}`;
  container.innerHTML = '';

  CATEGORIES.forEach((cat, idx) => {
    const isExtra = idx >= PRIMARY_VISIBLE_COUNT;
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `category-pill ${state.category === cat.id ? 'active' : ''}${isExtra ? ' category-pill-extra' : ''}`;
    const displayLabel = cat.shortLabel || (cat.label === 'Free Public Access' ? 'Free Access' : cat.label);
    pill.innerHTML = `<span class="cat-pill-label">${displayLabel}</span>`;
    pill.title = cat.label;
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

  if (extraCategories.length > 0) {
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = `category-grid-toggle ${isExpanded ? 'expanded' : ''}`;
    toggleBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    toggleBtn.innerHTML = isExpanded
      ? `<span class="cat-pill-label">Fewer Types</span><span class="cat-toggle-chevron" aria-hidden="true">▴</span>`
      : `<span class="cat-pill-label">More Types (+${extraCategories.length})</span><span class="cat-toggle-chevron" aria-hidden="true">▾</span>`;
    toggleBtn.addEventListener('click', () => {
      state.categoriesExpanded = !isExpanded;
      renderCategoryPills();
    });
    container.appendChild(toggleBtn);
  }
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
    pill.innerHTML = slot.icon ? `<span>${slot.icon}</span> <span>${slot.label}</span>` : `<span>${slot.label}</span>`;
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

  // PRIORITY 1: Check showings for today (scheduled ticketed performances, comedy shows, concerts)
  if (Array.isArray(ev.showings) && ev.showings.length > 0) {
    const todayShowings = ev.showings.filter(s => s && s.date === todayStr);
    if (todayShowings.length > 0) {
      let latestShowingEndMinutes = 0;
      let latestShowingStr = '';
      for (const s of todayShowings) {
        const endRaw = s.end_time || s.endTime;
        const startRaw = s.start_time || s.startTime;
        if (endRaw && typeof endRaw === 'string' && !/none_available|unknown/i.test(endRaw)) {
          const match = endRaw.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
          if (match) {
            let sh = parseInt(match[1], 10);
            const sm = match[2] ? parseInt(match[2], 10) : 0;
            const ampm = (match[3] || '').toUpperCase();
            if (ampm === 'PM' && sh < 12) sh += 12;
            if (ampm === 'AM' && sh === 12) sh = 0;
            if (sh < 5) sh += 24;
            const totalM = sh * 60 + sm;
            if (totalM > latestShowingEndMinutes) {
              latestShowingEndMinutes = totalM;
              latestShowingStr = endRaw;
            }
          }
        } else if (startRaw && typeof startRaw === 'string' && !/none_available|unknown/i.test(startRaw)) {
          const match = startRaw.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
          if (match) {
            let sh = parseInt(match[1], 10);
            const sm = match[2] ? parseInt(match[2], 10) : 0;
            const ampm = (match[3] || '').toUpperCase();
            if (ampm === 'PM' && sh < 12) sh += 12;
            if (ampm === 'AM' && sh === 12) sh = 0;
            if (sh < 5) sh += 24;
            const totalM = sh * 60 + sm + 150; // + 2.5 hours runtime
            if (totalM > latestShowingEndMinutes) {
              latestShowingEndMinutes = totalM;
              latestShowingStr = `${startRaw} (+2.5h run)`;
            }
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

  // PRIORITY 2: Check direct start time or startIso if event date is today
  if (ev.date === todayStr || (ev.startIso && String(ev.startIso).slice(0, 10) === todayStr)) {
    const rawTime = ev.start_time || ev.time;
    if (rawTime && typeof rawTime === 'string' && !/none_available|unknown/i.test(rawTime)) {
      const match = rawTime.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
      if (match) {
        let sh = parseInt(match[1], 10);
        const sm = match[2] ? parseInt(match[2], 10) : 0;
        const ampm = (match[3] || '').toUpperCase();
        if (ampm === 'PM' && sh < 12) sh += 12;
        if (ampm === 'AM' && sh === 12) sh = 0;
        if (sh < 5) sh += 24;
        const endMinutes = sh * 60 + sm + 150; // + 2.5 hours runtime
        return {
          hasEnded: currentMinutes >= endMinutes,
          closingMinutes: endMinutes,
          closingTimeStr: `${match[0]} (+2.5h run)`
        };
      }
    }
  }

  // 2. 24/7 venues never close
  if (ds.includes('24/7') || ds.toLowerCase().includes('open 24') || op.includes('24/7') || op.toLowerCase().includes('open 24')) {
    return { hasEnded: false, closingMinutes: 24 * 60, closingTimeStr: 'Open 24/7' };
  }

  // 3. Daylight hours (parks, outdoor attractions) - dusk cutoff around 7:45 PM
  if (ds.toLowerCase().includes('daylight hours') || op.toLowerCase().includes('daylight hours')) {
    const duskMinutes = 19 * 60 + 45;
    return {
      hasEnded: currentMinutes >= duskMinutes,
      closingMinutes: duskMinutes,
      closingTimeStr: 'Dusk (7:45 PM)'
    };
  }

  // 4. Explicit endIso (if not end of year series placeholder)
  if (ev.endIso && !ev.endIso.includes('12-31') && !ev.endIso.includes('03-31') && !ev.endIso.includes('05-31')) {
    try {
      const endDt = new Date(ev.endIso);
      if (!isNaN(endDt.getTime())) {
        const todayStart = new Date(year, now.getMonth(), now.getDate(), 0, 0, 0);
        const todayEnd = new Date(year, now.getMonth(), now.getDate() + 1, 4, 0, 0);
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

  // 5. Operating hours text & days_open check for today's closure
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

  // 6. Check weekly_hours / weeklyHours for today's explicit schedule (for drop-in / perennial venues)
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const fullDayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const curKey = dayKeys[now.getDay()];
  const curFull = fullDayKeys[now.getDay()];

  const wh = ev.weekly_hours || ev.weeklyHours || (typeof ev.weekly_schedule === 'object' ? ev.weekly_schedule : null);
  if (wh && typeof wh === 'object') {
    const todayEntry = wh[curKey] || wh[curFull];
    if (todayEntry && /closed/i.test(String(todayEntry).trim())) {
      return { hasEnded: true, closingMinutes: 0, closingTimeStr: 'Closed Today' };
    }
    if (todayEntry) {
      const entryStr = String(todayEntry).trim();
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
  }

  if (op) {
    const curDayShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][now.getDay()];
    const closedDayRegex = new RegExp(`(?:closed\\s+on\\s+${curDayShort}|closed\\s+${curDayShort}|${curDayShort}[a-z]*:\\s*closed|${curDayShort}[–-]\\w+\\s*closed)`, 'i');
    if (closedDayRegex.test(op)) {
      return { hasEnded: true, closingMinutes: 0, closingTimeStr: 'Closed Today' };
    }
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

  // 7. Parse closing time range from dateSchedule (e.g. "10:00 AM - 6:00 PM")
  const rangeMatch = ds.match(/[-–—]\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm))/i);
  if (rangeMatch) {
    const rawTime = rangeMatch[1].trim();
    const timeMatch = rawTime.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
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

  // 8. Start time in dateSchedule + 2.5 hours runtime
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

  // Default fallback: 11:59 PM (Midnight)
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
      // Guard: Do not expire if event has future confirmed showings
      if (Array.isArray(ev.confirmedDates) && ev.confirmedDates.some(d => String(d).slice(0, 10) >= todayStr)) {
        // Future showing remains, do not expire
      } else {
        return true; // The entire multi-day run, recurring series, or seasonal edition has concluded
      }
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

/**
 * Resolves the start time of an event in minutes from midnight for today.
 */
function getEventStartTimeToday(ev, now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  // 1. Showings for today
  if (Array.isArray(ev.showings) && ev.showings.length > 0) {
    const todayShowings = ev.showings.filter(s => s && s.date === todayStr);
    if (todayShowings.length > 0) {
      for (const s of todayShowings) {
        const raw = s.start_time || s.startTime;
        if (raw) {
          const parts = String(raw).split(':');
          let h = parseInt(parts[0], 10);
          const m = parts[1] ? parseInt(parts[1], 10) : 0;
          if (String(raw).toUpperCase().includes('PM') && h < 12) h += 12;
          if (String(raw).toUpperCase().includes('AM') && h === 12) h = 0;
          return h * 60 + m;
        }
      }
    }
  }

  // 2. Direct start_time or time field
  const rawTime = ev.start_time || ev.time;
  if (rawTime) {
    const match = String(rawTime).match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?/i);
    if (match) {
      let h = parseInt(match[1], 10);
      const m = match[2] ? parseInt(match[2], 10) : 0;
      const ampm = (match[3] || '').toUpperCase();
      if (ampm === 'PM' && h < 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    }
  }

  // 3. startIso
  if (ev.startIso) {
    try {
      const dt = new Date(ev.startIso);
      if (!isNaN(dt.getTime())) {
        return dt.getHours() * 60 + dt.getMinutes();
      }
    } catch (e) {}
  }

  // 4. Time from dateSchedule or operating_hours
  const ds = ev.dateSchedule || ev.operating_hours || '';
  const matchDs = ds.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i);
  if (matchDs) {
    let h = parseInt(matchDs[1], 10);
    const m = matchDs[2] ? parseInt(matchDs[2], 10) : 0;
    const ampm = matchDs[3].toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return h * 60 + m;
  }

  return null;
}

/**
 * Determines whether an event is actively underway at this exact moment.
 * Returns true if:
 * 1. Event is happening today and has not concluded.
 * 2. Current local time is between its start time and closing time.
 */
function isEventHappeningNow(ev, now = new Date()) {
  if (isEventInPast(ev, now)) return false;

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  // Check if today is an active date for this event
  const isToday = (
    ev.date === todayStr ||
    (Array.isArray(ev.confirmedDates) && ev.confirmedDates.some(d => String(d).slice(0, 10) === todayStr)) ||
    (Array.isArray(ev.showings) && ev.showings.some(s => s && s.date === todayStr)) ||
    ev.isDaily || ev.frequency === 'daily' ||
    ev.category === 'free-public-access' ||
    ev.lifecycleType === 'perennial_drop_in' ||
    ev.lifecycle_type === 'perennial_drop_in'
  );

  if (!isToday) return false;

  const closing = getEventClosingTimeToday(ev, now);
  if (closing.hasEnded) return false;

  const startMinutes = getEventStartTimeToday(ev, now);
  if (startMinutes !== null) {
    return currentMinutes >= startMinutes && currentMinutes < closing.closingMinutes;
  }

  // Open-access or drop-in venues with daily hours: happening now if within daylight or operating bounds
  return currentMinutes < closing.closingMinutes && currentMinutes >= 8 * 60; // default after 8 AM
}

function getReactiveDateHeaderLabel(now = new Date()) {
  const todayShort = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const todayDayCode = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
  if (!state.dayOfWeek || state.dayOfWeek === 'all') {
    return `Today • ${todayShort}`;
  }
  if (state.dayOfWeek === todayDayCode) {
    return `Today • ${todayShort}`;
  }
  if (state.dayOfWeek === 'daily') {
    return 'Daily Drop-In';
  }
  const dayDef = (typeof DAYS_OF_WEEK !== 'undefined' ? DAYS_OF_WEEK : []).find(d => d.id === state.dayOfWeek);
  const shortDay = dayDef ? dayDef.label : (state.dayOfWeek.charAt(0).toUpperCase() + state.dayOfWeek.slice(1));
  return `Selected • ${shortDay}`;
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
  window.currentActiveCatalog = activeCatalog; renderFestivalSpotlight();

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

    // Festival & Holiday Toggle Guard (Hide Festival & Holiday Events toggle)
    if (state.hideFestivalEvents) {
      if (
        (ev.id && ev.id.startsWith('fest-')) ||
        ev.isFestivalOrHoliday ||
        ev.isFestival ||
        ev.isHoliday ||
        Boolean(ev.festivalAffiliation) ||
        Boolean(ev.holidayAffiliation) ||
        (ev.subTags && ev.subTags.some(t => t === 'festival' || t === 'holiday')) ||
        (ev.title && ev.title.toLowerCase().includes('fringe'))
      ) {
        return false;
      }
    }

    // Specific Excluded Festival / Holiday Themes
    if (state.excludedThemes && state.excludedThemes.size > 0) {
      for (const excludedKey of state.excludedThemes) {
        if (eventMatchesThemeKey(ev, excludedKey)) {
          return false;
        }
      }
    }

    // Specific Highlighted Festival / Holiday Theme Filter
    if (state.selectedThemeFilter) {
      if (!eventMatchesThemeKey(ev, state.selectedThemeFilter)) {
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
    const hasFreeTier = ev.price === 0 || ev.isFree || ev.pricingType === 'free-option' || (Array.isArray(ev.tiers) && ev.tiers.some(t => t.price === 0 && !isAddonTier(t)));

    if (state.minBudget === 0 && state.maxBudget === 0) {
      // Free Outings ($0 CAD)
      if (!hasFreeTier) return false;
    } else if (state.minBudget === 1 && state.maxBudget === 50) {
      // Paid Outings ($1 — $50 CAD)
      if (ev.price <= 0 && !hasPaidTier) return false;
    } else {
      // Slider Range: Add-ons must never define the minimum entry floor
      const admissionTiers = Array.isArray(ev.tiers) ? ev.tiers.filter(t => !t.isAddon && !isAddonTier(t)) : [];
      const addonTiers = Array.isArray(ev.tiers) ? ev.tiers.filter(t => t.isAddon || isAddonTier(t)) : [];
      const maxAddon = addonTiers.length > 0 ? Math.max(...addonTiers.map(t => Number(t.price) || 0)) : 0;

      const effectiveMin = (ev.price !== undefined && ev.price !== null)
        ? (admissionTiers.length > 0 ? Math.min(ev.price, ...admissionTiers.map(t => t.price)) : ev.price)
        : (admissionTiers.length > 0 ? Math.min(...admissionTiers.map(t => t.price)) : (ev.price || 0));

      const effectiveMax = (hasPaidTier || (ev.price && ev.price > 0))
        ? Math.max(ev.price || 0, ...(admissionTiers.length > 0 ? admissionTiers.map(t => t.price) : [ev.price || 0])) + maxAddon
        : 0;

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
          ev.event_archetype === 'festival' ||
          ev.archetype === 'festival' ||
          Boolean(ev.isFestivalOrHoliday) ||
          Boolean(ev.isFestival) ||
          Boolean(ev.isHoliday) ||
          Boolean(ev.festivalAffiliation) ||
          Boolean(ev.festival_affiliation) ||
          Boolean(ev.holidayAffiliation) ||
          Boolean(ev.holiday_affiliation) ||
          (ev.id && (ev.id.startsWith('fest-') || ev.id.startsWith('viff-') || ev.id.includes('viff') || ev.id.includes('diwali'))) ||
          (ev.title && (ev.title.toLowerCase().includes('festival') || ev.title.toLowerCase().includes('fringe') || ev.title.toLowerCase().includes('viff') || ev.title.toLowerCase().includes('diwali'))) ||
          (ev.subTags && ev.subTags.some(t => t.toLowerCase().includes('festival') || t.toLowerCase().includes('holiday') || t.toLowerCase().includes('viff') || t.toLowerCase().includes('diwali')))
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
      const isDropInCard = (
      (ev.lifecycleType || ev.lifecycle_type) === 'perennial_drop_in' ||
      ev.access_model === 'open_public_space' ||
      ev.access_model === 'free_public_access' ||
      ev.access_model === 'drop_in_paid' ||
      ev.isFreePublic
    );
    const wh = parseWeeklyHoursTo7DayObject(ev.weekly_hours || ev.weeklyHours, ev.operatingHours || ev.dateSchedule, isDropInCard);
      if (wh && typeof wh === 'object') {
        const fullDayMap = {
          sun: 'sunday', mon: 'monday', tue: 'tuesday', wed: 'wednesday',
          thu: 'thursday', fri: 'friday', sat: 'saturday'
        };
        const dayVal = wh[state.dayOfWeek] || wh[fullDayMap[state.dayOfWeek]];
        if (dayVal && /closed/i.test(String(dayVal))) {
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
  renderActiveFilterChips(filtered.length);

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

  // Update Results Counter (with internal ended events tracker & active tag/theme indicator)
  const countBar = document.getElementById('results-count');
  if (countBar) {
    const tagBadgeHtml = state.selectedTag ? `
      <div class="active-tag-pill" title="Filtered by #${state.selectedTag}. Click ✕ to clear.">
        <span class="tag-label">Tag:</span>
        <span>#${state.selectedTag}</span>
        <button type="button" class="btn-clear-tag" onclick="clearSelectedTag()" aria-label="Clear hashtag filter">✕</button>
      </div>
    ` : '';

    const themeGroups = getActiveThemeGroups(activeCatalog);
    const activeThemeObj = state.selectedThemeFilter
      ? (themeGroups.find(g => g.key === state.selectedThemeFilter) || { key: state.selectedThemeFilter, label: state.selectedThemeFilter.split(':')[1] || state.selectedThemeFilter, icon: '🎉' })
      : null;

    const themeFilterPillHtml = activeThemeObj ? `
      <div class="active-tag-pill" title="Filtered to ${activeThemeObj.label}. Click ✕ to clear.">
        <span class="tag-label">Theme:</span>
        <span>${activeThemeObj.icon || '🎉'} ${activeThemeObj.label}</span>
        <button type="button" class="btn-clear-tag" onclick="toggleThemeFilter('${activeThemeObj.key}')" aria-label="Clear theme filter">✕</button>
      </div>
    ` : '';

    const excludedPillsHtml = (state.excludedThemes && state.excludedThemes.size > 0)
      ? Array.from(state.excludedThemes).map(exKey => {
          const exObj = themeGroups.find(g => g.key === exKey) || { key: exKey, label: exKey.split(':')[1] || exKey };
          return `
            <div class="active-tag-pill excluded-tag-pill" title="Excluding ${exObj.label}. Click ✕ to restore.">
              <span class="tag-label">Hidden:</span>
              <span>🚫 ${exObj.label}</span>
              <button type="button" class="btn-clear-tag" onclick="toggleExcludeTheme('${exKey}', event)" aria-label="Restore ${exObj.label}">✕</button>
            </div>
          `;
        }).join('')
      : '';

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

    const reactiveDateText = getReactiveDateHeaderLabel(now);
    countBar.innerHTML = `<div class="dynamic-date-left" id="dynamic-date-left"><span class="dynamic-date-label" id="dynamic-date-label">${reactiveDateText}</span></div>
      <div class="results-count-text">
        Showing <strong>${filtered.length}</strong> outings under $50
      </div>
      ${(tagBadgeHtml || themeFilterPillHtml || excludedPillsHtml) ? `<div style="display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap;">` : '<div style="display:none;">'}
        ${tagBadgeHtml}
        ${themeFilterPillHtml}
        ${excludedPillsHtml}
      </div>
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
  const allRawTags = (Array.isArray(ev.subTags) ? ev.subTags : []).concat(Array.isArray(ev.tags) ? ev.tags : []);
  const tagsNorm = normalizeSearchText([...new Set(allRawTags)].join(' '));
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

  const festivalNorm = normalizeSearchText(ev.festivalAffiliation || '');
  const holId = ev.holidayAffiliation ? String(ev.holidayAffiliation).toLowerCase().trim() : '';
  const holMeta = (holId && window.HOLIDAY_REGISTRY && window.HOLIDAY_REGISTRY[holId]) ? window.HOLIDAY_REGISTRY[holId] : null;
  const holidayNorm = normalizeSearchText(`${holId} ${holMeta ? `${holMeta.label} ${holMeta.keywords || ''}` : ''} ${ev.isHoliday ? 'holiday' : ''} ${ev.isFestival ? 'festival' : ''}`);

  const allContent = `${titleNorm} ${venueNorm} ${descNorm} ${artistNorm} ${orgNorm} ${tagsNorm} ${catNorm} ${catLabelNorm} ${addrNorm} ${neighNorm} ${venueAliasesNorm} ${performersNorm} ${daysNorm} ${customTiersNorm} ${tiersListNorm} ${extraAliases} ${accessNorm} ${festivalNorm} ${holidayNorm}`;
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
    } else if (prefix === 'holiday' || prefix === 'h') {
      if (valNorm === 'any' || valNorm === 'all' || valNorm === 'true') {
        if (!ev.isHoliday && !ev.holidayAffiliation) return [false, 0];
      } else if (!holidayNorm.includes(valNorm) && !tagsNorm.includes(valNorm)) {
        return [false, 0];
      }
    } else if (prefix === 'festival' || prefix === 'fest' || prefix === 'f') {
      if (valNorm === 'any' || valNorm === 'all' || valNorm === 'true') {
        if (!ev.isFestival && !ev.festivalAffiliation) return [false, 0];
      } else if (!festivalNorm.includes(valNorm) && !tagsNorm.includes(valNorm) && !titleNorm.includes(valNorm)) {
        return [false, 0];
      }
    } else if (prefix === 'tag' || prefix === 't') {
      if (!tagsNorm.includes(valNorm) && !holidayNorm.includes(valNorm) && !festivalNorm.includes(valNorm)) {
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
  state.hideFestivalEvents = false;
  state.selectedThemeFilter = null;
  if (state.excludedThemes) state.excludedThemes.clear();
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
  
  renderFestivalSpotlight();
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
  if (activeTiers.length > 0) {
    const admissionTiers = activeTiers.filter(t => !t.isAddon && !isAddonTier(t));
    const addonTiers = activeTiers.filter(t => t.isAddon || isAddonTier(t));

    // Optional Add-on Handling: Add-ons must never define the minimum entry floor.
    // Floor = Minimum Base Admission Price; Ceiling = Base Admission + Optional Add-On
    if (addonTiers.length > 0) {
      const baseMin = (ev.price !== undefined && ev.price !== null && ev.price > 0)
        ? ev.price
        : (admissionTiers.length > 0 ? Math.min(...admissionTiers.map(t => t.price)) : 0);
      const baseMax = admissionTiers.length > 0
        ? Math.max(...admissionTiers.map(t => t.price), (ev.price || 0))
        : (ev.price || 0);
      const maxAddon = Math.max(...addonTiers.map(t => t.price));
      const combinedUpper = baseMax + maxAddon;

      if (baseMin === 0 && combinedUpper === 0) {
        return 'Free ($0)';
      }
      if (baseMin === 0) {
        return `Free – $${combinedUpper.toFixed(2)} all-in`;
      }
      if (baseMin === combinedUpper) {
        return `$${baseMin.toFixed(2)} all-in`;
      }
      return `$${baseMin.toFixed(2)} – $${combinedUpper.toFixed(2)} all-in`;
    }

    if (admissionTiers.length > 1) {
      const minP = Math.min(...admissionTiers.map(t => t.price));
      const maxP = Math.max(...admissionTiers.map(t => t.price));
      if (minP === maxP) {
        return minP === 0 ? 'Free ($0)' : `$${minP.toFixed(2)} all-in`;
      }
      if (minP === 0) {
        return `Free – $${maxP.toFixed(2)} all-in`;
      }
      return `$${minP.toFixed(2)} – $${maxP.toFixed(2)} all-in`;
    } else if (admissionTiers.length === 1) {
      const p = admissionTiers[0].price;
      return p === 0 ? 'Free ($0)' : `$${p.toFixed(2)} all-in`;
    }
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
    const FULL_DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const isDropInCard = (
      (ev.lifecycleType || ev.lifecycle_type) === 'perennial_drop_in' ||
      ev.access_model === 'open_public_space' ||
      ev.access_model === 'free_public_access' ||
      ev.access_model === 'drop_in_paid' ||
      ev.isFreePublic
    );
    const wh = parseWeeklyHoursTo7DayObject(ev.weekly_hours || ev.weeklyHours, ev.operatingHours || ev.dateSchedule, isDropInCard);
    for (let offset = 1; offset <= 7; offset++) {
      const cand = new Date(today);
      cand.setDate(cand.getDate() + offset);
      const candDay = cand.getDay();
      const candKey = DAY_KEYS[candDay];
      const candFull = FULL_DAY_KEYS[candDay];
      if (wh && typeof wh === 'object') {
        const h = wh[candKey] || wh[candFull];
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
  const el = document.getElementById(`showings-table-${eventId}`) || document.getElementById(`showings-more-${eventId}`);
  const btn = document.getElementById(`btn-toggle-showings-${eventId}`);
  if (!el) return;
  const isHidden = (el.style.display === 'none' || el.style.display === '');
  if (isHidden) {
    el.style.display = 'flex';
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
    { key: 'today', title: "Today's Events", shortTitle: "Today", icon: '', range: todayLabel, list: buckets.today },
    { key: 'tomorrow', title: "Tomorrow's Events", shortTitle: "Tomorrow", icon: '', range: tomorrowLabel, list: buckets.tomorrow },
    { key: 'this_week', title: "This Week's Events", shortTitle: "This Week", icon: '', range: thisWeekLabel, list: buckets.this_week },
    { key: 'next_week', title: "Next Week's Events", shortTitle: "Next Week", icon: '', range: nextWeekLabel, list: buckets.next_week },
    { key: 'upcoming', title: "Upcoming & Future Events", shortTitle: "Upcoming", icon: '', range: upcomingLabel, list: buckets.upcoming }
  ];

  const activeBuckets = bucketMeta.filter(b => b.list.length > 0);

  // Quick navigation anchor bar (rendered if 2 or more buckets have items)
  let navBarHtml = '';
  if (activeBuckets.length > 1) {
    navBarHtml = `
      <nav class="time-nav-bar" aria-label="Jump to event timeframes">
        ${activeBuckets.map(b => `
          <a href="#group-${b.key}" class="time-nav-pill" onclick="smoothScrollToTimeGroup('group-${b.key}', event)">
            <span>${b.shortTitle}</span>
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
      <section class="events-time-group ${isCollapsed ? 'collapsed' : ''}" id="group-${b.key}" data-group-title="${b.shortTitle}" data-group-heading="${b.title}" data-group-range="${b.range}">
        <div class="time-group-header" onclick="toggleTimeGroup('${b.key}')" role="button" tabindex="0" aria-expanded="${!isCollapsed}" aria-controls="cards-grid-${b.key}" title="Click to ${isCollapsed ? 'expand' : 'collapse'} ${b.title}">
          <div class="time-group-title-wrap">
            <span class="time-group-icon" style="display:none;"></span>
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
            <span class="collapsed-banner-info"><strong>${b.title}</strong> is collapsed (${b.list.length} event${b.list.length === 1 ? '' : 's'})</span>
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

  grid.innerHTML = venueBannerHtml + navBarHtml + sectionsHtml; if (typeof window.updateScrollDateIndicator === 'function') window.updateScrollDateIndicator();
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
    const FULL_DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const isDropInCard = (
      (ev.lifecycleType || ev.lifecycle_type) === 'perennial_drop_in' ||
      ev.access_model === 'open_public_space' ||
      ev.access_model === 'free_public_access' ||
      ev.access_model === 'drop_in_paid' ||
      ev.isFreePublic
    );
    const wh = parseWeeklyHoursTo7DayObject(ev.weekly_hours || ev.weeklyHours, ev.operatingHours || ev.dateSchedule, isDropInCard);
    for (let offset = 1; offset <= 7; offset++) {
      const cand = new Date(today);
      cand.setDate(cand.getDate() + offset);
      const candDay = cand.getDay();
      const candKey = DAY_KEYS[candDay];
      const candFull = FULL_DAY_KEYS[candDay];
      if (wh && typeof wh === 'object') {
        const h = wh[candKey] || wh[candFull];
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

  // If there is only one tier or all tiers have the same price, do not render expandable tiers (unless an add-on is present)
  const uniquePrices = new Set(tiers.map(t => Number(t.price)));
  if (tiers.length <= 1 || (uniquePrices.size <= 1 && !tiers.some(t => isAddonTier(t)))) {
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
    const isAddon = Boolean(t.isAddon || isAddonTier(t));
    const valText = isAddon ? `+$${Number(t.price).toFixed(2)} CAD` : (t.label || (t.price === 0 ? 'Free ($0)' : `$${Number(t.price).toFixed(2)} CAD`));
    const isFreeVal = !isAddon && (t.price === 0 || valText.toLowerCase().includes('free'));

    let statusClass = isAddon ? 'tier-addon-item' : '';
    let statusBadge = '';

    if (isAddon) {
      statusBadge = '<span class="tier-status-pill badge-addon" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); font-size: 0.68rem; padding: 2px 6px; border-radius: 4px; margin-left: 6px; font-weight: 600;">Optional Add-On</span>';
    } else if (t.isSoldOut) {
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
    const isDropInCard = (
      (ev.lifecycleType || ev.lifecycle_type) === 'perennial_drop_in' ||
      ev.access_model === 'open_public_space' ||
      ev.access_model === 'free_public_access' ||
      ev.access_model === 'drop_in_paid' ||
      ev.isFreePublic
    );
    const wh = parseWeeklyHoursTo7DayObject(ev.weekly_hours || ev.weeklyHours, ev.operatingHours || ev.dateSchedule, isDropInCard);
    if (wh && typeof wh === 'object') {
      const dayOrder = [
        { k: 'mon', full: 'monday', label: 'Monday' },
        { k: 'tue', full: 'tuesday', label: 'Tuesday' },
        { k: 'wed', full: 'wednesday', label: 'Wednesday' },
        { k: 'thu', full: 'thursday', label: 'Thursday' },
        { k: 'fri', full: 'friday', label: 'Friday' },
        { k: 'sat', full: 'saturday', label: 'Saturday' },
        { k: 'sun', full: 'sunday', label: 'Sunday' }
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
      const curFull = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][curDayNum];
      const activeDayLabel = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][curDayNum];
      const cleanHoursStr = (str) => formatScheduleText12h((str || '').replace(/\s*\([^)]*\)/g, '').trim());
      const activeHours = cleanHoursStr(wh[curKey] || wh[curFull] || 'Check schedule');

      // Determine if venue is a consistent facility offering consistent operations across days (e.g. Pitch & Putt, museums, galleries, parks)
      // Venues with unique shows different days (e.g. live music, comedy, unique performances)
      // or fewer than 4 operating days must NOT render a 7-day dropdown.
      const validDays = Object.entries(wh).filter(([k, v]) => {
        const val = String(v || '').toLowerCase();
        return val && !val.includes('not listed') && !val.includes('closed');
      });

      const isLiveOrPerformance = (
        ev.category === 'live_music' || 
        ev.category === 'Live Music' || 
        ev.category === 'comedy' || 
        ev.category === 'Comedy & Shows' ||
        (ev.lifecycleType || ev.lifecycle_type) === 'one_time' ||
        (Array.isArray(ev.performers) && ev.performers.length > 0)
      );

      const isPerennialOrFacility = (
        (ev.lifecycleType || ev.lifecycle_type) === 'perennial_drop_in' ||
        ev.access_model === 'open_public_space' ||
        ev.access_model === 'sports_facility' ||
        ev.access_model === 'fenced_facility' ||
        ev.category === 'free-public-access' ||
        ev.category === 'outdoors' ||
        ev.category === 'Sports & Fitness' ||
        (ev.categories && (ev.categories.includes('outdoors') || ev.categories.includes('free-public-access')))
      );

      const isConsistentFacility = (
        !isLiveOrPerformance &&
        validDays.length >= 4 &&
        isPerennialOrFacility
      );

      if (isConsistentFacility || isDropInCard) {
        const rows = dayOrder.map(d => {
          const hoursStr = cleanHoursStr(wh[d.k] || wh[d.full] || 'Hours not listed');
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
      } else {
        // For venues or events with unique shows or limited days, display only the single active day/time without a dropdown
        if (activeHours && !activeHours.toLowerCase().includes('not listed') && !activeHours.toLowerCase().includes('check schedule')) {
          weeklyHoursHtml = `
            <div class="card-weekly-hours-block static-hours-block" id="hours-block-${ev.id}">
              <div class="weekly-hours-summary-row static-schedule-row">
                <div class="wh-summary-left">
                  <div class="wh-active-day-box">
                    <span class="wh-active-day-name">${activeDayLabel}:</span>
                    <span class="wh-active-hours-val">${activeHours}</span>
                  </div>
                </div>
              </div>
            </div>
          `;
        }
      }
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
      const activeShowings = (Array.isArray(ev.showings) ? ev.showings : []).filter(s => s && s.status !== 'concluded' && (!s.date || s.date >= curTodayStr));

      const renderShowingRow = (s) => {
        const dStr = s.date || '';
        const dObj = new Date(dStr.length === 10 ? dStr + 'T12:00:00' : dStr);
        const dateLabel = !isNaN(dObj.getTime())
          ? dObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          : dStr;
        const isShowingToday = (dStr === curTodayStr);
        const timeLabel = formatDisplayTime12h(s.start_time || '');
        const venueLabel = s.venue_name || s.venue || ev.venue || ev.venue_name || 'Vancouver Venue';
        const addrLabel = s.full_address || s.neighborhood || ev.address || ev.neighborhood || '';
        const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueLabel + ' ' + (addrLabel || 'Vancouver BC'))}`;
        const bookUrl = s.ticket_url || ev.websiteUrl;
        const costText = (s.cost !== undefined && s.cost !== null) ? (Number(s.cost) === 0 ? 'Free' : `$${Number(s.cost).toFixed(2)}`) : '';
        const isSoldOut = s.status === 'sold_out' || s.is_sold_out;
        const actionHtml = isSoldOut
          ? `<a href="${bookUrl}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="badge-showing-sold-out" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-decoration: none; display: inline-block; cursor: pointer;" title="Sold out — click to check ticket portal or waitlist">Sold Out ↗</a>`
          : `<a href="${bookUrl}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="btn-showing-book" title="Direct ticket or info link for this date">
                ${costText ? `${costText} ↗` : 'Book ↗'}
              </a>`;

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
              ${actionHtml}
            </div>
          </div>
        `;
      };

      if (activeShowings.length > 1) {
        const todayIdx = activeShowings.findIndex(s => s && s.date === curTodayStr);
        const primaryIdx = todayIdx >= 0 ? todayIdx : 0;
        const primaryShowing = activeShowings[primaryIdx] || {};

        const dStr = primaryShowing.date || '';
        const dObj = new Date(dStr.length === 10 ? dStr + 'T12:00:00' : dStr);
        const primaryDateLabel = !isNaN(dObj.getTime())
          ? dObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
          : dStr;
        const primaryTimeLabel = primaryShowing.start_time ? ` at ${formatDisplayTime12h(primaryShowing.start_time)}` : '';

        const allRowsHtml = activeShowings.map(renderShowingRow).join('');

        showingsHtml = `
          <div class="card-showings-block" id="showings-block-${ev.id}">
            <div class="showings-summary-row" onclick="toggleShowings('${ev.id}', event)" title="Click to view/hide all ${activeShowings.length} upcoming scheduled dates">
              <div class="wh-summary-left">
                <div class="wh-active-day-box">
                  <span class="wh-active-day-name">Next:</span>
                  <span class="wh-active-hours-val">${primaryDateLabel}${primaryTimeLabel}</span>
                </div>
              </div>
              <button 
                type="button" 
                class="btn-toggle-showings btn-toggle-hours" 
                id="btn-toggle-showings-${ev.id}" 
                aria-expanded="false" 
                data-count="${activeShowings.length}"
                aria-label="Toggle all ${activeShowings.length} upcoming showings for ${ev.title}"
              >
                <span class="toggle-text">All Dates (${activeShowings.length})</span>
                <span class="wh-chevron">▾</span>
              </button>
            </div>
            <div class="showings-table collapsible-showings" id="showings-table-${ev.id}" style="display: none;">
              ${allRowsHtml}
            </div>
          </div>
        `;
      }
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
    const isHappeningNow = isEventHappeningNow(ev, new Date());

    return `
      <article class="event-card ${isSoldOut ? 'card-sold-out' : ''} ${isHappeningNow ? 'card-happening-now' : ''}" id="card-${ev.id}" data-scroll-date="${topDate.badgeText}" data-bucket-key="${bucketKey}" onclick="toggleMobileCardAccordion('${ev.id}', event)">
        <!-- Mobile 2-Line Compact Header (<= 768px) -->
        <div class="mobile-card-compact-header">
          <div class="mobile-card-row-1">
            <span class="mobile-card-title">${formatCardDisplayTitle(ev.title, ev)}</span>
            <span class="mobile-card-price-pill ${isSoldOut ? 'is-sold-out' : (ev.isFree || ev.price === 0 ? 'is-free' : '')}">${isSoldOut ? 'Sold Out' : ((ev.isFree || ev.price === 0) ? 'Free' : `$${Number(ev.price || 0).toFixed(Number(ev.price || 0) % 1 === 0 ? 0 : 2)}`)}</span>
          </div>
          <div class="mobile-card-row-2">
            <span class="mobile-card-meta-text">📍 ${(ev.neighborhood || ev.venue || 'Vancouver').split(',')[0]} • ${topDate.badgeText} • ${(() => {
              const pCat = (Array.isArray(ev.categories) && ev.categories.length > 0) ? ev.categories[0] : (ev.category || 'Outing');
              const cDef = (typeof CATEGORIES !== 'undefined') ? CATEGORIES.find(c => c.id === pCat) : null;
              return cDef ? (cDef.shortLabel || cDef.label) : (ev.categoryLabel || pCat);
            })()}</span>
            <span class="mobile-card-chevron" aria-hidden="true">▾</span>
          </div>
        </div>
        <div class="card-expandable-details">
        ${isHappeningNow ? `
          <div class="happening-now-ribbon" title="This outing is actively underway right now!">
            <span class="live-pulse-dot" aria-hidden="true"></span>
            <span>Now</span>
          </div>
        ` : ''}
        ${isSoldOut ? '<div class="sold-out-ribbon">SOLD OUT</div>' : ''}

        <!-- Unified Single Header: Date & Category Badges on Left, Action Cluster on Right -->
        <div class="card-top-bar">
          <div class="header-badges-left">
            <span class="card-date-badge ${topDate.isToday ? 'badge-today' : topDate.isTomorrow ? 'badge-tomorrow' : ''}">
              <span>${topDate.badgeText}</span>
            </span>
            ${(() => {
              const primaryCat = (Array.isArray(ev.categories) && ev.categories.length > 0)

                ? (ev.categories.includes('outdoors') && (ev.lifecycleType === 'perennial_drop_in' || ev.accessModel === 'open_public_space')
                    ? 'outdoors'
                    : (ev.categories.includes('free-public-access') && ev.category === 'free-public-access'
                        ? 'free-public-access'
                        : ev.categories[0]))
                : (ev.category || 'misc');
              const catDef = (typeof CATEGORIES !== 'undefined') ? CATEGORIES.find(c => c.id === primaryCat) : null;
              const label = catDef ? catDef.label : (primaryCat === ev.category ? (ev.categoryLabel || primaryCat) : primaryCat);
              return `
                <button 
                  type="button" 
                  class="card-category-badge category-${primaryCat}" 
                  onclick="filterByCategory('${primaryCat}')" 
                  title="Click to filter by ${label}"
                  aria-label="Category: ${label}"
                >
                  <span class="category-badge-icon" aria-hidden="true" style="display:none;"></span>
                  <span class="category-badge-text">${label}</span>
                </button>
              `;
            })()}
            ${(Array.isArray(ev.themeBadges) && ev.themeBadges.length > 0) ? ev.themeBadges.map(tb => {
              const isSelected = state.selectedThemeFilter === tb.key;
              return `
                <div class="card-theme-badge-pill ${isSelected ? 'active' : ''}">
                  <button
                    type="button"
                    class="card-theme-badge-main"
                    onclick="toggleThemeFilter('${tb.key}', event)"
                    title="${isSelected ? `Showing only ${tb.label}. Click to clear` : `Click to filter by ${tb.label}`}"
                  >
                    <span>${tb.icon}</span>
                    <span>${tb.label}</span>
                  </button>
                  <button
                    type="button"
                    class="card-theme-badge-exclude"
                    onclick="toggleExcludeTheme('${tb.key}', event)"
                    title="Filter out (hide) ${tb.label} events"
                    aria-label="Hide ${tb.label} events"
                  >✕</button>
                </div>
              `;
            }).join('') : ''}
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
          <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="venue-location-btn venue-location-link card-maps-link" title="Open ${ev.venue} (${ev.address || 'Vancouver'}) in Google Maps">
            <span class="venue-pin-icon" aria-label="Map location"><svg width="32" height="32" viewBox="0 0 24 24" fill="#ef4444" aria-hidden="true" style="color: #ef4444; flex-shrink: 0; vertical-align: middle; margin-right: 4px; filter: drop-shadow(0 2px 4px rgba(239, 68, 68, 0.55));"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></span>
            <span class="venue-name">${ev.venue}</span>
          </a>
          ${(venueUrl || venueOtherEventsBtnHtml) ? `
            <div class="card-venue-actions-col">
              ${venueUrl ? `
                <a href="${venueUrl}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="venue-website-link venue-link" title="Visit official website of ${ev.venue}">
                  <span class="website-label">Venue Site ↗</span>
                </a>
              ` : ''}
              ${venueOtherEventsBtnHtml}
            </div>
          ` : ''}
        </div>

        <!-- Schedule Row: Rendered strictly when NO weekly hours block and NO multi-showings block is present -->
        ${(!weeklyHoursHtml && !showingsHtml) ? `
          <div class="card-schedule-row">
            <span>${formatScheduleText12h(ev.dateSchedule || ev.frequencyLabel || 'Check venue calendar')}</span>
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
  state.hideFestivalEvents = false;
  state.selectedThemeFilter = null;
  if (state.excludedThemes) state.excludedThemes.clear();
  state.selectedTag = null;
  state.selectedVenue = null;
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

  renderFestivalSpotlight();
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
  document.body.classList.toggle('admin-mode-enabled', isCurator);
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

// ==============================================================================
// COMMUNITY FEEDBACK & QUARANTINED SUGGESTIONS MODAL (SINGLE OPEN-ENDED FORM)
// ==============================================================================

function openFeedbackModal(presetText = '', targetEventId = '') {
  const modal = document.getElementById('feedback-modal');
  if (!modal) return;

  const messageInput = document.getElementById('feedback-message');
  const targetIdInput = document.getElementById('feedback-target-event-id');
  const alertBox = document.getElementById('feedback-alert');

  if (messageInput && presetText) {
    messageInput.value = presetText;
  }
  if (targetIdInput) {
    targetIdInput.value = targetEventId || '';
  }
  if (alertBox) {
    alertBox.style.display = 'none';
    alertBox.textContent = '';
  }

  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  if (messageInput) {
    messageInput.focus();
    if (presetText) {
      // Place cursor at the end of the prefilled text
      messageInput.setSelectionRange(messageInput.value.length, messageInput.value.length);
    }
  }
}

function closeFeedbackModal() {
  const modal = document.getElementById('feedback-modal');
  if (!modal) return;
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  const form = document.getElementById('community-feedback-form');
  if (form) form.reset();
  const alertBox = document.getElementById('feedback-alert');
  if (alertBox) {
    alertBox.style.display = 'none';
    alertBox.textContent = '';
  }
}

function initCommunityFeedbackModal() {
  const navBtn = document.getElementById('feedback-nav-btn');
  const footerBtn = document.getElementById('feedback-footer-btn');
  const closeBtn = document.getElementById('close-feedback-btn');
  const cancelBtn = document.getElementById('btn-cancel-feedback');
  const modal = document.getElementById('feedback-modal');
  const form = document.getElementById('community-feedback-form');

  if (navBtn) navBtn.addEventListener('click', () => openFeedbackModal());
  if (footerBtn) footerBtn.addEventListener('click', () => openFeedbackModal());
  if (closeBtn) closeBtn.addEventListener('click', closeFeedbackModal);
  if (cancelBtn) cancelBtn.addEventListener('click', closeFeedbackModal);

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeFeedbackModal();
    });
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-submit-feedback');
      const alertBox = document.getElementById('feedback-alert');
      const messageInput = document.getElementById('feedback-message');
      const targetIdInput = document.getElementById('feedback-target-event-id');
      const hpInput = document.getElementById('feedback-hp');

      const message = messageInput?.value?.trim() || '';
      if (!message) {
        if (alertBox) {
          alertBox.style.display = 'block';
          alertBox.style.background = 'rgba(239, 68, 68, 0.15)';
          alertBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
          alertBox.style.color = '#f87171';
          alertBox.textContent = 'Please enter your message or suggestion.';
        }
        return;
      }

      const payload = {
        message: message,
        target_event_id: targetIdInput?.value || '',
        hp_field: hpInput?.value || ''
      };

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';
      }

      try {
        const res = await fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (res.ok && data.success) {
          if (alertBox) {
            alertBox.style.display = 'block';
            alertBox.style.background = 'rgba(16, 185, 129, 0.15)';
            alertBox.style.border = '1px solid rgba(16, 185, 129, 0.4)';
            alertBox.style.color = '#34d399';
            alertBox.textContent = '✓ ' + (data.message || 'Thank you! Your feedback has been sent for review.');
          }
          form.reset();
          setTimeout(() => {
            closeFeedbackModal();
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.textContent = 'Send Feedback';
            }
          }, 1800);
        } else {
          if (alertBox) {
            alertBox.style.display = 'block';
            alertBox.style.background = 'rgba(239, 68, 68, 0.15)';
            alertBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
            alertBox.style.color = '#f87171';
            alertBox.textContent = '⚠️ ' + (data.error || 'Failed to submit feedback.');
          }
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send Feedback';
          }
        }
      } catch (err) {
        if (alertBox) {
          alertBox.style.display = 'block';
          alertBox.style.background = 'rgba(239, 68, 68, 0.15)';
          alertBox.style.border = '1px solid rgba(239, 68, 68, 0.4)';
          alertBox.style.color = '#f87171';
          alertBox.textContent = 'Network error. Please try again.';
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Send Feedback';
        }
      }
    });
  }
}

// Global hook for event cards to trigger "Report Issue"
window.reportEventIssue = function(eventId, eventTitle) {
  openFeedbackModal(eventTitle ? `Regarding "${eventTitle}": ` : '', eventId);
};

// Initialize after DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initCommunityFeedbackModal);
} else {
  initCommunityFeedbackModal();
}


// ==============================================================================
// VAN50 MOBILE UI & UX REFACTOR HELPERS (Active Filter Chips & Card Accordion)
// ==============================================================================

function renderActiveFilterChips(filteredCount) {
  const chipsContainer = document.getElementById('active-filter-chips');
  const mobileFilterTrigger = document.getElementById('mobile-filter-trigger');
  const mobileSheetApplyBtn = document.getElementById('mobile-sheet-apply-btn');

  if (mobileSheetApplyBtn && typeof filteredCount === 'number') {
    mobileSheetApplyBtn.textContent = `Show ${filteredCount} Outing${filteredCount === 1 ? '' : 's'}`;
  }

  const chips = []; if (state.category && state.category !== 'all') { const cDef = (window.CATEGORIES || []).find(c => c.id === state.category); chips.push({ key: 'category', label: cDef ? (cDef.shortLabel || cDef.label) : state.category }); } if (state.selectedThemeFilter) { const meta = getThemeMetadata({ key: state.selectedThemeFilter, id: String(state.selectedThemeFilter).split(':')[1] || state.selectedThemeFilter, type: String(state.selectedThemeFilter).split(':')[0] || 'festival' }); chips.push({ key: 'theme', label: meta ? meta.label : state.selectedThemeFilter }); } if (state.excludedThemes && state.excludedThemes.size > 0) { Array.from(state.excludedThemes).forEach(tk => { const meta = getThemeMetadata({ key: tk, id: String(tk).split(':')[1] || tk, type: String(tk).split(':')[0] || 'festival' }); chips.push({ key: 'exTheme:' + tk, label: 'Hide ' + (meta ? meta.label : tk) }); }); }

  // 1. Spend / Cost Filter
  if (state.minBudget !== 0 || state.maxBudget !== 50) {
    let costLabel = `$${state.minBudget}–$${state.maxBudget}`;
    if (state.minBudget === 0 && state.maxBudget === 0) costLabel = 'Free';
    else if (state.minBudget === 0 && state.maxBudget === 15) costLabel = '≤ $15';
    else if (state.minBudget === 0 && state.maxBudget === 25) costLabel = '≤ $25';
    else if (state.minBudget >= 1 && state.maxBudget === 50) costLabel = 'Paid';
    chips.push({ key: 'cost', label: costLabel });
  }

  // 2. Day of the Week
  if (state.dayOfWeek && state.dayOfWeek !== 'all') {
    const dayDef = (window.DAYS_OF_WEEK || []).find(d => d.id === state.dayOfWeek);
    chips.push({ key: 'day', label: dayDef ? dayDef.label : state.dayOfWeek });
  }

  // 3. Starting Time
  if (state.timeSlot && state.timeSlot !== 'all') {
    const slotDef = (window.TIME_SLOTS || []).find(s => s.id === state.timeSlot);
    chips.push({ key: 'time', label: slotDef ? slotDef.label : state.timeSlot });
  }

  // 4. Neighborhoods
  const allNh = window.NEIGHBORHOODS || [];
  if (state.selectedNeighborhoods && state.selectedNeighborhoods.size > 0 && state.selectedNeighborhoods.size < allNh.length) {
    Array.from(state.selectedNeighborhoods).forEach(nh => {
      const shortNh = String(nh).split(',')[0].split('&')[0].trim();
      chips.push({ key: 'nh:' + nh, label: shortNh });
    });
  }

  // 5. Recurrence Frequency
  if (state.frequency && state.frequency !== 'all') {
    const freqDef = (typeof FREQUENCIES !== 'undefined' ? FREQUENCIES : []).find(f => f.id === state.frequency);
    chips.push({ key: 'frequency', label: freqDef ? freqDef.label : state.frequency });
  }

  // 6. Hide Daily Drop-In Spots
  if (state.hideDaily) {
    chips.push({ key: 'hideDaily', label: 'Scheduled Only' });
  }

  // 7. Accessible Venues Only
  if (state.accessibleOnly) {
    chips.push({ key: 'accessibleOnly', label: '♿ Accessible' });
  }

  const activeCount = chips.length;
  if (mobileFilterTrigger) {
    mobileFilterTrigger.textContent = activeCount > 0 ? `⚙️ Filters (${activeCount})` : '⚙️ Filters';
    mobileFilterTrigger.classList.toggle('has-active-filters', activeCount > 0);
  }

  if (!chipsContainer) return;
  if (chips.length === 0) {
    chipsContainer.style.display = 'none';
    chipsContainer.innerHTML = '';
    return;
  }

  chipsContainer.style.display = 'flex';
  chipsContainer.innerHTML = chips.map(c => {
    const safeKey = String(c.key).replace(/'/g, "\\'");
    return `
      <button type="button" class="active-filter-chip" onclick="dismissSecondaryFilterChip('${safeKey}')" title="Remove ${c.label} filter" aria-label="Remove ${c.label} filter">
        <span>${c.label}</span>
        <span class="chip-dismiss" aria-hidden="true">×</span>
      </button>
    `;
  }).join('');
}

window.dismissSecondaryFilterChip = function(chipKey) {
  if (!chipKey) return; if (chipKey === 'category') { state.category = 'all'; renderCategoryPills(); } else if (chipKey === 'theme') { state.selectedThemeFilter = null; renderFestivalSpotlight(); } else if (chipKey.startsWith('exTheme:')) { const tk = chipKey.slice(8); if (state.excludedThemes) state.excludedThemes.delete(tk); renderFestivalSpotlight(); }
  if (chipKey === 'cost') {
    state.minBudget = 0;
    state.maxBudget = 50;
    const minSlider = document.getElementById('min-spend-slider');
    const maxSlider = document.getElementById('max-spend-slider');
    if (minSlider) minSlider.value = 0;
    if (maxSlider) maxSlider.value = 50;
    clearActiveQuickButtons();
    updateSliderVisuals();
  } else if (chipKey === 'day') {
    state.dayOfWeek = 'all';
    renderDayPills();
  } else if (chipKey === 'time') {
    state.timeSlot = 'all';
    renderTimePills();
  } else if (chipKey.startsWith('nh:')) {
    const targetNh = chipKey.slice(3);
    state.selectedNeighborhoods.delete(targetNh);
    if (state.selectedNeighborhoods.size === 0) {
      state.selectedNeighborhoods = new Set(window.NEIGHBORHOODS || []);
    }
    renderNeighborhoodPills();
  } else if (chipKey === 'frequency') {
    state.frequency = 'all';
    renderFrequencyPills();
  } else if (chipKey === 'hideDaily') {
    state.hideDaily = false;
    const hideDailyToggle = document.getElementById('hide-daily-toggle');
    if (hideDailyToggle) hideDailyToggle.checked = false;
  } else if (chipKey === 'accessibleOnly') {
    state.accessibleOnly = false;
    const chkAccess = document.getElementById('chk-accessible-only');
    if (chkAccess) chkAccess.checked = false;
  }
  applyFiltersAndRender();
};

window.toggleMobileCardAccordion = function(eventId, evObj) {
  if (typeof window !== 'undefined' && window.innerWidth > 768) return;
  if (evObj && evObj.target) {
    // Allow direct clicks on links/buttons inside expanded details without collapsing the card
    const interactiveEl = evObj.target.closest('a, button, input, label, .card-expanded-tiers, .collapsible-hours, .collapsible-showings');
    const insideCompactHeader = evObj.target.closest('.mobile-card-compact-header');
    if (interactiveEl && !insideCompactHeader) {
      return;
    }
  }
  const cardEl = document.getElementById(`card-${eventId}`);
  if (!cardEl) return;
  cardEl.classList.toggle('mobile-expanded');
};


// ==============================================================================
// STICKY SEARCH/FILTER BAR & LIVE SCROLLED DATE INDICATOR
// ==============================================================================
window.updateScrollDateIndicator = function() {
  const stickyBar = document.getElementById('mobile-search-filter-bar');
  const scrollDateBar = document.getElementById('scroll-date-bar');
  const scrollDateTitle = document.getElementById('scroll-date-title');
  const scrollDateRange = document.getElementById('scroll-date-range');
  if (!stickyBar || !scrollDateBar || !scrollDateTitle) return;

  const scrollY = window.scrollY || window.pageYOffset || 0;
  const isScrolled = scrollY > 110;
  stickyBar.classList.toggle('is-scrolled', isScrolled);

  if (!isScrolled) {
    scrollDateBar.style.display = 'none';
    return;
  }

  const barRect = stickyBar.getBoundingClientRect();
  const probeY = Math.max(barRect.bottom + 18, 76);

  const cards = document.querySelectorAll('.event-card[data-scroll-date]');
  let activeCard = null;
  for (let i = 0; i < cards.length; i++) {
    const r = cards[i].getBoundingClientRect();
    if (r.bottom >= probeY && r.top <= window.innerHeight) {
      activeCard = cards[i];
      break;
    }
  }

  let titleDisplay = '';
  let rangeDisplay = '';
  if (activeCard) {
    const cardDate = activeCard.getAttribute('data-scroll-date') || '';
    const parentGroup = activeCard.closest('.events-time-group');
    const groupHeading = parentGroup ? (parentGroup.getAttribute('data-group-heading') || parentGroup.getAttribute('data-group-title') || '') : '';
    const groupRange = parentGroup ? (parentGroup.getAttribute('data-group-range') || '') : '';

    titleDisplay = groupHeading || cardDate;
    if (cardDate && !cardDate.toLowerCase().startsWith('today') && !cardDate.toLowerCase().startsWith('tomorrow')) {
      rangeDisplay = cardDate;
    } else {
      rangeDisplay = groupRange || cardDate;
    }
  }

  if (!titleDisplay) {
    const groups = document.querySelectorAll('.events-time-group');
    for (let i = 0; i < groups.length; i++) {
      const r = groups[i].getBoundingClientRect();
      if (r.bottom >= probeY) {
        titleDisplay = groups[i].getAttribute('data-group-heading') || groups[i].getAttribute('data-group-title') || '';
        rangeDisplay = groups[i].getAttribute('data-group-range') || '';
        break;
      }
    }
  }

  if (state.dayOfWeek && state.dayOfWeek !== 'all') {
    const reactiveStr = getReactiveDateHeaderLabel(new Date());
    const parts = reactiveStr.split('•').map(s => s.trim());
    titleDisplay = parts[0] || reactiveStr;
    rangeDisplay = parts[1] || '';
  }

  if (titleDisplay) {
    scrollDateTitle.textContent = titleDisplay;
    if (scrollDateRange) {
      const showRange = rangeDisplay && rangeDisplay.toLowerCase() !== titleDisplay.toLowerCase();
      scrollDateRange.textContent = showRange ? rangeDisplay : '';
      scrollDateRange.style.display = showRange ? 'inline-flex' : 'none';
    }
    scrollDateBar.style.display = 'flex';
  } else {
    scrollDateBar.style.display = 'none';
  }
};

window.addEventListener('scroll', window.updateScrollDateIndicator, { passive: true });
window.addEventListener('resize', window.updateScrollDateIndicator, { passive: true });
