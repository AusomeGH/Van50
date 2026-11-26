// Van50 -- Application State Management, Multi-Filter Engine & UI Orchestration
// Strictly displays events under $50.00 CAD total out-of-pocket per person.

// ==============================================================================
// 0A. SHARED CLIENT-SIDE SECURITY PRIMITIVES (XSS Escaping, Safe URLs & Rate-Limit)
// ==============================================================================
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeExternalUrl(rawUrl) {
  if (typeof rawUrl !== 'string') return '#';
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed === '#') return '#';
  try {
    const baseOrigin = (typeof window !== 'undefined' && window.location && /^https?:$/i.test(window.location.protocol))
      ? window.location.origin
      : 'https://van50.local';
    const parsed = new URL(trimmed, baseOrigin);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.href;
    }
    return '#';
  } catch (_) {
    return '#';
  }
}

window.escapeHtml = escapeHtml;
window.safeExternalUrl = safeExternalUrl;

const FORM_SUBMISSION_COOLDOWN_MS = 30000;
const _formCooldownMemory = Object.create(null);

function getFormCooldownRemainingSec(formKey) {
  const now = Date.now();
  let lastTs = Number(_formCooldownMemory[formKey] || 0);
  try {
    const stored = Number(sessionStorage.getItem('van50_form_cooldown_' + formKey) || 0);
    if (stored > lastTs) lastTs = stored;
  } catch (_) { }
  if (!lastTs || now < lastTs) return 0;
  const elapsed = now - lastTs;
  if (elapsed >= FORM_SUBMISSION_COOLDOWN_MS) return 0;
  return Math.max(1, Math.ceil((FORM_SUBMISSION_COOLDOWN_MS - elapsed) / 1000));
}

function recordFormSubmissionTimestamp(formKey) {
  const now = Date.now();
  _formCooldownMemory[formKey] = now;
  try {
    sessionStorage.setItem('van50_form_cooldown_' + formKey, String(now));
  } catch (_) { }
}

function getVan50SubmissionsUrl() {
  if (typeof window !== 'undefined' && typeof window.VAN50_SUBMISSIONS_URL === 'string' && window.VAN50_SUBMISSIONS_URL.trim()) {
    return window.VAN50_SUBMISSIONS_URL.trim();
  }
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="van50-submissions-url"]');
    const val = meta ? (meta.getAttribute('content') || '').trim() : '';
    if (val) return val;
  }
  return '';
}

async function submitToGoogleAppsScript(payload) {
  const endpointUrl = getVan50SubmissionsUrl();
  if (!endpointUrl || !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/i.test(endpointUrl)) {
    return { configured: false, ok: false };
  }
  const enriched = {
    ...payload,
    page_url: (typeof window !== 'undefined' && window.location) ? window.location.href : ''
  };
  await fetch(endpointUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(enriched)
  });
  return { configured: true, ok: true };
}

function renderSafeMailtoStatus(containerEl, prefixText, mailtoHref) {
  if (!containerEl) return;
  containerEl.textContent = '';
  containerEl.appendChild(document.createTextNode(prefixText + ' '));
  if (typeof mailtoHref === 'string' && /^mailto:/i.test(mailtoHref)) {
    const linkEl = document.createElement('a');
    linkEl.href = mailtoHref;
    linkEl.textContent = 'Click to send via Email ↗';
    linkEl.style.cssText = 'color:#fff;font-weight:700;text-decoration:underline;margin-left:4px;';
    containerEl.appendChild(linkEl);
  }
}

// 0. CORE TAXONOMY & CLUSTER CONSTANTS (Authoritative Defaults)
window.VANCOUVER_NEIGHBORHOODS = window.VANCOUVER_NEIGHBORHOODS || [
  "Downtown, Gastown & Yaletown",
  "Mount Pleasant & South Vancouver",
  "Commercial Drive & East Vancouver",
  "Kitsilano, Point Grey & UBC",
  "Granville Island & False Creek",
  "North Shore, Burnaby & Metro"
];

window.SURREY_NEIGHBORHOODS = window.SURREY_NEIGHBORHOODS || [
  "Surrey Central / Whalley",
  "Guildford",
  "Fleetwood",
  "Newton",
  "Cloverdale",
  "South Surrey"
];

window.BURNABY_NEIGHBORHOODS = window.BURNABY_NEIGHBORHOODS || [
  "Metrotown & Deer Lake",
  "Brentwood & North Burnaby",
  "Lougheed & SFU",
  "Edmonds & South Burnaby"
];

window.RICHMOND_NEIGHBORHOODS = window.RICHMOND_NEIGHBORHOODS || [
  "City Centre & Brighouse",
  "Steveston Village",
  "East Richmond & Ironwood"
];

window.NEW_WEST_NEIGHBORHOODS = window.NEW_WEST_NEIGHBORHOODS || [
  "Downtown & Columbia St",
  "Uptown & Sapperton",
  "Queensborough"
];

window.LANGLEY_NEIGHBORHOODS = window.LANGLEY_NEIGHBORHOODS || [
  "Langley City & Willowbrook",
  "Fort Langley",
  "Willoughby & Walnut Grove",
  "Murrayville & Aldergrove"
];

window.REGION_META = {
  all: { key: "all", label: "All", icon: "🌲" },
  vancouver: { key: "vancouver", label: "Vancouver", icon: "🏙️" },
  surrey: { key: "surrey", label: "Surrey", icon: "🦌" },
  burnaby: { key: "burnaby", label: "Burnaby", icon: "🏔️" },
  richmond: { key: "richmond", label: "Richmond", icon: "🌊" },
  "new-west": { key: "new-west", label: "New West", icon: "⚓" },
  langley: { key: "langley", label: "Langley", icon: "🐎" }
};

window.normalizeRegionKey = function (raw) {
  const s = String(raw || 'all').trim().toLowerCase();
  if (s === 'vancouver' || s === 'van') return 'vancouver';
  if (s === 'surrey' || s === 'white rock') return 'surrey';
  if (s === 'burnaby') return 'burnaby';
  if (s === 'richmond') return 'richmond';
  if (s === 'new-west' || s === 'new west' || s === 'newwest' || s === 'new westminster' || s === 'new-westminster') return 'new-west';
  if (s === 'langley' || s === 'fort langley') return 'langley';
  return 'all';
};

window.SURREY_MACRO_GROUPS = window.SURREY_MACRO_GROUPS || [
  {
    id: "north-surrey",
    label: "🌲 North Surrey",
    towns: ["Surrey Central / Whalley", "Guildford", "Fleetwood"],
    aliases: ["Surrey Central", "Whalley", "City Centre", "Bridgeview", "Guildford", "Fleetwood", "Fraser Heights"]
  },
  {
    id: "mid-surrey",
    label: "🎭 Mid Surrey",
    towns: ["Newton"],
    aliases: ["Newton", "Bear Creek", "Panorama", "Sullivan Heights"]
  },
  {
    id: "south-surrey-cloverdale",
    label: "🌊 South Surrey & Cloverdale",
    towns: ["Cloverdale", "South Surrey"],
    aliases: ["Cloverdale", "Clayton", "South Surrey", "Grandview", "Crescent Beach"]
  }
];

window.NEIGHBORHOODS = [
  ...window.VANCOUVER_NEIGHBORHOODS,
  ...window.SURREY_NEIGHBORHOODS,
  ...window.BURNABY_NEIGHBORHOODS,
  ...window.RICHMOND_NEIGHBORHOODS,
  ...window.NEW_WEST_NEIGHBORHOODS,
  ...window.LANGLEY_NEIGHBORHOODS
];

window.DAYS_OF_WEEK = window.DAYS_OF_WEEK || [
  { id: "all", label: "All Days", icon: "🗓️" },
  { id: "mon", label: "Mon", full: "Monday" },
  { id: "tue", label: "Tue", full: "Tuesday" },
  { id: "wed", label: "Wed", full: "Wednesday" },
  { id: "thu", label: "Thu", full: "Thursday" },
  { id: "fri", label: "Fri", full: "Friday" },
  { id: "sat", label: "Sat", full: "Saturday" },
  { id: "sun", label: "Sun", full: "Sunday" }
];

window.CATEGORIES = [
  { id: "all", label: "All", shortLabel: "All", icon: "" },
  { id: "music", label: "Music", shortLabel: "Music", icon: "" },
  { id: "shows", label: "Comedy & Stage", shortLabel: "Comedy & Stage", icon: "" },
  { id: "cinema", label: "Cinema", shortLabel: "Cinema", icon: "" },
  { id: "outdoors", label: "Outdoors", shortLabel: "Outdoors", icon: "" },
  { id: "arts", label: "Arts & Galleries", shortLabel: "Arts", icon: "" },
  { id: "social", label: "Social & Games", shortLabel: "Social & Games", icon: "" },
  { id: "markets", label: "Markets", shortLabel: "Markets", icon: "" },
  { id: "festivals", label: "Festivals", shortLabel: "Festivals", icon: "" },
  { id: "sports", label: "Sports & Rec", shortLabel: "Sports", icon: "" },
  { id: "academic", label: "Academic & Talks", shortLabel: "Academic", icon: "" }
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
    label: "❄️ Winter & Holiday Season",
    icon: "❄️",
    datesLabel: "Nov 13 – Jan 3",
    startDate: "11-13",
    endDate: "01-03",
    shortDesc: "Vancouver Christmas Market, VanDusen Lights, Bright Nights, Surrey Tree Lighting, choral concerts & festive outings.",
    longDesc: "Explore Metro Vancouver's combined winter and holiday season (Nov 13 – Jan 3)—including the Vancouver Christmas Market, VanDusen Festival of Lights, Bright Nights, Surrey Tree Lighting, indie artisan markets, classical choral concerts, winter solstice celebrations, festive comedy, and seasonal theatre—all verified under $50 CAD.",
    venues: "Metro Vancouver Theatres, Markets, Parks & Botanical Gardens",
    keywords: "christmas xmas keithmas holiday winter festive yule nutcracker hanukkah solstice winter holiday season vancouver christmas market vandusen lights bright nights surrey tree lighting"
  },
  "winter-holiday-season": {
    id: "christmas",
    label: "❄️ Winter & Holiday Season",
    icon: "❄️",
    datesLabel: "Nov 13 – Jan 3",
    startDate: "11-13",
    endDate: "01-03",
    shortDesc: "Vancouver Christmas Market, VanDusen Lights, Bright Nights, Surrey Tree Lighting, choral concerts & festive outings.",
    longDesc: "Explore Metro Vancouver's combined winter and holiday season (Nov 13 – Jan 3)—including the Vancouver Christmas Market, VanDusen Festival of Lights, Bright Nights, Surrey Tree Lighting, indie artisan markets, classical choral concerts, winter solstice celebrations, festive comedy, and seasonal theatre—all verified under $50 CAD.",
    venues: "Metro Vancouver Theatres, Markets, Parks & Botanical Gardens",
    keywords: "christmas xmas keithmas holiday winter festive yule nutcracker hanukkah solstice winter holiday season vancouver christmas market vandusen lights bright nights surrey tree lighting"
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
  "vaisakhi": {
    id: "vaisakhi",
    label: "Vaisakhi",
    icon: "🌾",
    datesLabel: "Mid–Late April",
    startDate: "04-10",
    endDate: "04-26",
    shortDesc: "Vibrant Vaisakhi parades, South Asian music & dance stages, and community celebrations.",
    longDesc: "Experience Vancouver and Surrey's iconic Vaisakhi celebrations—among the largest outside India—featuring colourful Nagar Kirtan processions, free community stages, traditional folk music, and cultural festivities.",
    venues: "Sunset / Main Street (Punjabi Market) & Newton (Surrey)",
    keywords: "vaisakhi baisakhi nagar kirtan khalsa day punjabi"
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
  },
  "bear-creek-lights": {
    id: "bear-creek-lights",
    label: "Bear Creek Lights",
    icon: "✨",
    datesLabel: "Nov 1 – Nov 15",
    shortDesc: "Free illuminated nature walk & light installations through Bear Creek Park Gardens in Newton, Surrey.",
    longDesc: "Experience Bear Creek Park's magical autumn light festival in Newton, Surrey, featuring illuminated garden trails, glowing nature installations, and family-friendly evening walks (Free admission, timed tickets required).",
    venues: "Bear Creek Park (Newton, Surrey)",
    officialUrl: "https://www.surrey.ca/news-events/events/bear-creek-lights",
    officialLabel: "Official Bear Creek Lights Info ↗"
  },
  "surrey-fusion-festival": {
    id: "surrey-fusion-festival",
    label: "Surrey Fusion Festival",
    icon: "🌍",
    datesLabel: "3rd Weekend in July",
    shortDesc: "BC's largest free multicultural festival of music, food pavilions & culture at Holland Park.",
    longDesc: "Celebrate global music, dance, and culinary traditions across 50+ cultural pavilions and multiple outdoor concert stages at Holland Park in Surrey Central (Free admission).",
    venues: "Holland Park (Surrey Central)",
    officialUrl: "https://www.surreyfusionfestival.ca",
    officialLabel: "Official Fusion Festival Guide ↗"
  },
  "canada-cup-international-softball-championship": {
    id: "canada-cup-international-softball-championship",
    label: "Canada Cup International Softball Championship",
    icon: "🥎",
    datesLabel: "July",
    shortDesc: "World-class international women's fastpitch softball tournament at Softball City in South Surrey ($15 CAD).",
    longDesc: "Watch Olympic and national fastpitch softball teams from around the globe compete at Softball City in South Surrey, with single-day general admission passes under $50 CAD ($15 CAD).",
    venues: "Softball City (South Surrey)",
    officialUrl: "https://www.canadacup.com",
    officialLabel: "Official Canada Cup Schedule ↗"
  },
  "european-union-film-festival": {
    id: "european-union-film-festival",
    label: "European Union Film Festival (EUFF)",
    icon: "🎬",
    datesLabel: "Nov 13 – Nov 26, 2026",
    shortDesc: "Annual showcase of contemporary European cinema from EU member states at The Cinematheque ($15 CAD).",
    longDesc: "The Cinematheque presents the annual European Union Film Festival (EUFF), screening acclaimed contemporary feature films representing European Union member states in downtown Vancouver.",
    venues: "The Cinematheque (1131 Howe St, Vancouver)",
    officialUrl: "https://thecinematheque.ca/series/european-union-film-festival-2026",
    officialLabel: "Official EUFF Schedule ↗"
  },
  "lumiere-festival": {
    id: "lumiere-festival",
    label: "Lumière Festival",
    icon: "✨",
    datesLabel: "Nov 12 – Nov 16, 2026",
    shortDesc: "Free outdoor interactive light art installations, projections, and live performances across Downtown & the West End.",
    longDesc: "Lumière Festival illuminates Downtown Vancouver, the West End, Yaletown, and Gastown with free outdoor light art installations, interactive projection mapping, and open-air performances.",
    venues: "Vancouver Art Gallery Plaza, West End, Yaletown & Gastown",
    officialUrl: "https://www.lumiereyvr.com",
    officialLabel: "Official Lumière Map & Schedule ↗"
  }
};

// Privacy-Preserving Anonymous Event Tracking (GoatCounter - 0 PII, Cookieless)
window.trackAnonymousEvent = function (path, title) {
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

const ALL_CITY_REGIONS = ['vancouver', 'surrey', 'burnaby', 'richmond', 'new-west', 'langley'];

const state = {
  region: 'all',
  selectedRegions: new Set(),
  minBudget: 0,
  maxBudget: 50,
  hideDaily: false,
  hideFestivalEvents: false,
  festivalDetailsExpanded: false,
  anytimeBannerExpanded: false,
  expandedThemes: new Set(),
  selectedThemeFilter: null,
  excludedThemes: new Set(),
  accessibleMode: false,
  accessibleOnly: false,
  seniorDealsOnly: false,
  includeReligious: true,
  category: 'all',
  frequency: 'all',
  dayOfWeek: 'all',
  selectedDate: '',
  selectedTag: null,
  selectedVenue: null,
  searchQuery: '',
  savedEvents: new Set(),
  expandedSavedEvents: new Set(),
  expandedCardIds: new Set(),
  sharedPlanIds: null,
  collapsedTimeGroups: new Set(),
  expiredCount: 0,
  sortBy: 'date'
};
window.van50SelectedRegion = 'all';

function syncRegionStateString() {
  if (!state.selectedRegions || state.selectedRegions.size === 0 || state.selectedRegions.size >= ALL_CITY_REGIONS.length) {
    if (state.selectedRegions && state.selectedRegions.size >= ALL_CITY_REGIONS.length) {
      state.selectedRegions.clear();
    }
    state.region = 'all';
  } else {
    state.region = Array.from(state.selectedRegions).join(',');
  }
  window.van50SelectedRegion = state.region;
}

// Global reference for roulette & map
window.currentFilteredEvents = [];
let ALL_EVENTS = (typeof window !== 'undefined' && (window.VAN50_EVENTS || window.VANCOUVER_EVENTS))
  ? (window.VAN50_EVENTS || window.VANCOUVER_EVENTS).map(normalizeActiveEvent)
  : (typeof VAN50_EVENTS !== 'undefined' ? VAN50_EVENTS.map(normalizeActiveEvent) : (typeof VANCOUVER_EVENTS !== 'undefined' ? VANCOUVER_EVENTS.map(normalizeActiveEvent) : []));

const ALLOWED_URL_CATEGORIES = new Set([
  'all', 'music', 'shows', 'cinema', 'outdoors', 'arts',
  'social', 'trivia', 'markets', 'festivals', 'sports', 'academic', 'free-public-access'
]);
const ALLOWED_URL_DAYS = new Set(['all', 'daily', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const ALLOWED_URL_FREQUENCIES = new Set(['all', 'one-off', 'weekly', 'monthly', 'daily', 'limited-run', 'seasonal']);
const ALLOWED_URL_SORTS = new Set(['date', 'price', 'price-asc', 'price-desc', 'title']);

function sanitizeUrlEventIdToken(raw) {
  const cleaned = String(raw || '').trim().slice(0, 120);
  if (!cleaned || /[<>"'`\u0000-\u001F]/.test(cleaned)) return '';
  return cleaned;
}

function restoreFiltersFromUrlParams() {
  if (typeof window === 'undefined' || !window.location || !window.location.search) return;
  const params = new URLSearchParams(window.location.search);

  if (params.has('region')) {
    const rawReg = String(params.get('region') || '').trim();
    state.selectedRegions.clear();
    rawReg.split(',').forEach(part => {
      const regVal = window.normalizeRegionKey(part);
      if (regVal && regVal !== 'all') {
        state.selectedRegions.add(regVal);
      }
    });
    syncRegionStateString();
  }

  if (params.has('q')) {
    state.searchQuery = (params.get('q') || '').trim().slice(0, 200);
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = state.searchQuery;
    const clearSearchBtn = document.getElementById('btn-clear-search');
    if (clearSearchBtn) clearSearchBtn.style.display = state.searchQuery.length > 0 ? 'flex' : 'none';
  }

  if (params.has('cat')) {
    const catVal = (params.get('cat') || '').trim().toLowerCase().slice(0, 40);
    if (catVal && ALLOWED_URL_CATEGORIES.has(catVal)) {
      state.category = catVal;
    }
  }

  if (params.has('fest')) {
    const festVal = (params.get('fest') || '').trim().slice(0, 80);
    if (festVal && /^[a-z0-9:_-]+$/i.test(festVal)) {
      state.selectedThemeFilter = festVal;
    }
  }

  if (params.has('cost')) {
    const costVal = (params.get('cost') || '').trim().toLowerCase();
    if (costVal === 'free' || costVal === '0') {
      state.minBudget = 0;
      state.maxBudget = 0;
    } else if (costVal === 'under15') {
      state.minBudget = 0;
      state.maxBudget = 15;
    } else if (costVal === 'under25') {
      state.minBudget = 0;
      state.maxBudget = 25;
    } else if (costVal === 'under30') {
      state.minBudget = 0;
      state.maxBudget = 30;
    } else if (costVal === 'paid') {
      state.minBudget = 1;
      state.maxBudget = 50;
    } else if (costVal.includes('-')) {
      const parts = costVal.split('-').map(n => parseInt(n, 10));
      if (!isNaN(parts[0]) && !isNaN(parts[1])) {
        state.minBudget = Math.max(0, Math.min(50, parts[0]));
        state.maxBudget = Math.max(state.minBudget, Math.min(50, parts[1]));
      }
    } else {
      const numCost = parseInt(costVal, 10);
      if (!isNaN(numCost)) {
        state.minBudget = 0;
        state.maxBudget = Math.max(0, Math.min(50, numCost));
      }
    }
    const minSlider = document.getElementById('min-spend-slider');
    const maxSlider = document.getElementById('max-spend-slider');
    if (minSlider) minSlider.value = state.minBudget;
    if (maxSlider) maxSlider.value = state.maxBudget;
  }

  if (params.has('day')) {
    const dayVal = (params.get('day') || '').trim().toLowerCase().slice(0, 20);
    if (dayVal && ALLOWED_URL_DAYS.has(dayVal)) {
      state.dayOfWeek = dayVal;
    }
  }

  if (params.has('date')) {
    const dateVal = (params.get('date') || '').trim().toLowerCase().slice(0, 20);
    if (dateVal === 'weekend' || /^\d{4}-\d{2}-\d{2}$/.test(dateVal)) {
      state.selectedDate = dateVal;
    }
  }

  if (params.has('rec')) {
    const recVal = (params.get('rec') || '').trim().toLowerCase().slice(0, 30);
    if (recVal && ALLOWED_URL_FREQUENCIES.has(recVal)) {
      state.frequency = recVal;
    }
  }

  if (params.has('sort')) {
    const sortVal = (params.get('sort') || '').trim().toLowerCase().slice(0, 30);
    if (sortVal && ALLOWED_URL_SORTS.has(sortVal)) {
      state.sortBy = sortVal;
    }
  }

  if (params.get('religious') === '0' || params.get('religious') === 'false') {
    state.includeReligious = false;
  } else if (params.has('focus')) {
    const focusVal = (params.get('focus') || '').trim().toLowerCase();
    if (focusVal === 'general' || focusVal === 'secular' || focusVal === 'no-worship') {
      state.includeReligious = false;
    }
  }

  if (params.get('senior') === '1' || params.get('senior') === 'true') {
    state.seniorDealsOnly = true;
  }

  if (params.get('accessible') === '1' || params.get('accessible') === 'true') {
    state.accessibleOnly = true;
  }

  if (params.has('plan')) {
    const rawPlan = (params.get('plan') || '').trim().slice(0, 2000);
    const parsedIds = rawPlan
      .split(',')
      .slice(0, 50)
      .map(s => {
        try { return sanitizeUrlEventIdToken(decodeURIComponent(s.trim())); } catch (_) { return sanitizeUrlEventIdToken(s.trim()); }
      })
      .filter(Boolean);
    state.sharedPlanIds = parsedIds.length > 0 ? parsedIds : null;
  }
}

function syncFiltersToUrlParams() {
  if (typeof window === 'undefined' || !window.history || !window.history.replaceState) return;
  const params = new URLSearchParams(window.location.search);
  const hadRegionParam = params.has('region');

  ['region', 'q', 'cat', 'fest', 'cost', 'day', 'time', 'hood', 'neighborhood', 'rec', 'sort', 'focus', 'religious', 'senior', 'accessible', 'plan'].forEach(k => params.delete(k));

  if (Array.isArray(state.sharedPlanIds) && state.sharedPlanIds.length > 0) {
    params.set('plan', state.sharedPlanIds.map(id => encodeURIComponent(id)).join(','));
  }

  if (state.region && (state.region !== 'all' || hadRegionParam || window._userChangedRegion)) {
    params.set('region', state.region);
  }
  if (state.searchQuery && state.searchQuery.trim() !== '') {
    params.set('q', state.searchQuery.trim());
  }
  if (state.category && state.category !== 'all') {
    params.set('cat', state.category);
  }
  if (state.selectedThemeFilter) {
    params.set('fest', state.selectedThemeFilter);
  }
  if (state.minBudget > 0 || state.maxBudget < 50) {
    if (state.minBudget === 0 && state.maxBudget === 0) {
      params.set('cost', 'free');
    } else if (state.minBudget === 0 && state.maxBudget === 15) {
      params.set('cost', 'under15');
    } else if (state.minBudget === 0 && state.maxBudget === 25) {
      params.set('cost', 'under25');
    } else if (state.minBudget === 0 && state.maxBudget === 30) {
      params.set('cost', 'under30');
    } else if (state.minBudget === 1 && state.maxBudget === 50) {
      params.set('cost', 'paid');
    } else {
      params.set('cost', `${state.minBudget}-${state.maxBudget}`);
    }
  }
  if (state.dayOfWeek && state.dayOfWeek !== 'all') {
    params.set('day', state.dayOfWeek);
  }
  if (state.selectedDate) {
    params.set('date', state.selectedDate);
  }
  if (state.frequency && state.frequency !== 'all') {
    params.set('rec', state.frequency);
  }
  if (state.sortBy && state.sortBy !== 'date') {
    params.set('sort', state.sortBy);
  }
  if (state.includeReligious === false) {
    params.set('religious', '0');
  }
  if (state.seniorDealsOnly) {
    params.set('senior', '1');
  }
  if (state.accessibleOnly) {
    params.set('accessible', '1');
  }

  const queryStr = params.toString();
  const newUrl = window.location.pathname + (queryStr ? `?${queryStr}` : '') + (window.location.hash || '');
  const currentUrl = window.location.pathname + window.location.search + (window.location.hash || '');
  if (newUrl !== currentUrl) {
    window.history.replaceState(null, '', newUrl);
  }
}

function getActiveFiltersSummaryList() {
  const active = [];
  if (state.selectedRegions && state.selectedRegions.size > 0) {
    const labels = Array.from(state.selectedRegions).map(rk => {
      const rm = (window.REGION_META && window.REGION_META[rk]) || { icon: '📍', label: rk };
      return `${rm.icon} ${rm.label}`;
    });
    active.push(`Cities: ${labels.join(', ')}`);
  }
  if (state.searchQuery && state.searchQuery.trim() !== '') {
    active.push(`Search: "${state.searchQuery.trim()}"`);
  }
  if (state.category && state.category !== 'all') {
    const catObj = (typeof CATEGORIES !== 'undefined' ? CATEGORIES : []).find(c => c.id === state.category);
    active.push(`Category: ${catObj ? `${catObj.icon} ${catObj.label}` : state.category}`);
  }
  if (state.selectedThemeFilter) {
    const label = state.selectedThemeFilter.includes(':') ? state.selectedThemeFilter.split(':')[1] : state.selectedThemeFilter;
    active.push(`Festival / Theme: ${label}`);
  }
  if (state.excludedThemes && state.excludedThemes.size > 0) {
    const labels = Array.from(state.excludedThemes).map(k => k.includes(':') ? k.split(':')[1] : k);
    active.push(`Hidden Themes: ${labels.join(', ')}`);
  }
  if (state.hideFestivalEvents) {
    active.push('No Festival Events');
  }
  if (state.minBudget > 0 || state.maxBudget < 50) {
    if (state.minBudget === 0 && state.maxBudget === 0) {
      active.push('Cost: Free ($0)');
    } else {
      active.push(`Cost: $${state.minBudget} – $${state.maxBudget} CAD`);
    }
  }
  if (state.selectedDate) {
    active.push(`Date: ${state.selectedDate === 'weekend' ? 'This Weekend' : state.selectedDate}`);
  }
  if (state.dayOfWeek && state.dayOfWeek !== 'all') {
    const dayObj = (typeof DAYS_OF_WEEK !== 'undefined' ? DAYS_OF_WEEK : []).find(d => d.id === state.dayOfWeek);
    active.push(`Day: ${dayObj ? dayObj.label : state.dayOfWeek}`);
  }
  if (state.frequency && state.frequency !== 'all') {
    const freqObj = (typeof FREQUENCIES !== 'undefined' ? FREQUENCIES : []).find(f => f.id === state.frequency);
    active.push(`Recurrence: ${freqObj ? freqObj.label : state.frequency}`);
  }
  if (state.selectedTag) {
    active.push(`Tag: #${state.selectedTag}`);
  }
  if (state.selectedVenue) {
    active.push(`Venue: ${state.selectedVenue}`);
  }
  if (state.hideDaily) {
    active.push('Scheduled Events Only');
  }
  if (state.seniorDealsOnly) {
    active.push('Senior Deals & 55+');
  }
  if (state.accessibleOnly) {
    active.push('Step-Free / Accessible');
  }
  if (state.includeReligious === false) {
    active.push('No Religious Events');
  }
  if (state.sortBy && state.sortBy !== 'date') {
    active.push(`Sort: ${state.sortBy}`);
  }
  return active;
}

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  loadSavedState();
  initAccessibility();
  setupEventListeners();
  restoreFiltersFromUrlParams();
  renderRegionPills();
  renderRegionPills();
  renderFestivalSpotlight();
  renderCategoryPills();
  renderDayPills();
  renderFrequencyPills();
  clearActiveQuickButtons();
  if (typeof window.syncDrawerAccessToggles === 'function') window.syncDrawerAccessToggles();
  if (typeof window.syncStickyHeaderOffset === 'function') window.syncStickyHeaderOffset();
  updateSliderVisuals();
  applyFiltersAndRender();
  hydrateDeepLinksFromUrl();
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
        const rawUntil = String(t.available_until).trim();
        let untilDate;
        if (/^\d{4}-\d{2}-\d{2}$/.test(rawUntil)) {
          const [uy, um, ud] = rawUntil.split('-').map(Number);
          untilDate = new Date(uy, um - 1, ud, 23, 59, 59, 999);
        } else {
          untilDate = new Date(rawUntil);
        }
        if (!isNaN(untilDate.getTime()) && untilDate < now && status === 'available') {
          status = 'expired';
        }
      } catch (_) { }
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

  if (rawWh && typeof rawWh === 'object' && !Array.isArray(rawWh)) {
    const normalizedObj = {};
    days.forEach((d, idx) => {
      const full = fullDays[idx];
      const rawVal = rawWh[d] || rawWh[full] || rawWh[d.charAt(0).toUpperCase() + d.slice(1)] || rawWh[full.charAt(0).toUpperCase() + full.slice(1)];
      const formatted = rawVal ? formatScheduleText12h(sanitizeMojibake(String(rawVal).trim())) : 'Closed';
      normalizedObj[d] = formatted;
      normalizedObj[full] = formatted;
    });
    return normalizedObj;
  }
  const sourceStr = sanitizeMojibake(String(rawWh || (isDropIn ? fallbackScheduleStr : '') || '').trim());
  if (!sourceStr && !isDropIn) return null;

  // Guard: If no explicit weekly_hours was provided and fallbackScheduleStr is a specific calendar-date range
  // (e.g., "Sat Nov 21 & Sun Nov 22, 2026 • 12:00 PM – 8:00 PM" or "2026-11-21"), never misparse it as a recurring 7-day weekly facility schedule!
  if (!rawWh && sourceStr) {
    const hasSpecificCalendarDate = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i.test(sourceStr) ||
      /\b202\d-\d{2}-\d{2}\b/.test(sourceStr);
    if (hasSpecificCalendarDate && !/\b(?:weekly|every\s+(?:mon|tue|wed|thu|fri|sat|sun|day|week)|open\s+daily|year-round)\b/i.test(sourceStr)) {
      return null;
    }
  }

  const result = {};
  if (!sourceStr) {
    if (isDropIn) {
      days.forEach((d, idx) => { result[d] = 'Open Daily'; result[fullDays[idx]] = 'Open Daily'; });
      return result;
    }
    return null;
  }

  // Strip trailing non-hours bullets (e.g., "• Current Exhibition...", "• Drop-In Day Pass...", "• Free Farmhouse Tours...")
  let cleaned = formatScheduleText12h(
    sourceStr
      .replace(/\s*•\s*(?:Current Exhibition|Running through|Free First Fridays|Drop-In|Guided Flight|Single Drop-In|Free Gardens|Free Public|Free Shoreline|Free Farmhouse|Lit 9-Hole|Over 10km|Thursday Artist).*$/i, '')
      .trim()
  );

  // Check if it's a "Daily: X" or "Open Daily: X" pattern without day-specific exceptions
  const hasDayOverrideInParens = /\((?:[^)]*\b(?:closed|until)\b[^)]*)\)/i.test(cleaned);
  if (/^(?:open\s+)?daily\b/i.test(cleaned) && !/\b(?:mon|tue|wed|thu|fri|sat|sun)\b/i.test(cleaned.replace(/\s*\([^)]*\)/g, '')) && !hasDayOverrideInParens) {
    const val = cleaned
      .replace(/^(?:open\s+)?daily(?:\s+year-round)?\s*[:•-]?\s*/i, '')
      .replace(/\s*\([^)]*\)/g, '')
      .trim() || 'Open Daily';
    days.forEach((d, idx) => { result[d] = val; result[fullDays[idx]] = val; });
    return result;
  }

  // Check if it has "Plaza & Commons: Daily 10:00 AM - 8:00 PM..."
  const dailyMatch = cleaned.match(/\bDaily\s*[:•-]?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)\s*[-–—to]+\s*(?:\d{1,2}(?::\d{2})?\s*(?:AM|PM)|Dusk|Sunset|Midnight))/i);
  if (dailyMatch && !/\b(?:mon|tue|wed|thu|fri|sat|sun)\b/i.test(cleaned.replace(/\s*\([^)]*\)/g, '')) && !hasDayOverrideInParens) {
    const val = dailyMatch[1].trim();
    days.forEach((d, idx) => { result[d] = val; result[fullDays[idx]] = val; });
    return result;
  }

  // Only expand parenthetical notes into clauses when they are explicit day-closure or closing-time overrides
  // (e.g., "(Closed Mondays)", "(Fri/Sat until Midnight)", "(open until 8:00 PM on Thursdays)")
  const withoutParens = cleaned.replace(/\(([^)]*)\)/g, (m, inner) => {
    const trimmedInner = inner.trim();
    if (/^closed\b/i.test(trimmedInner) ||
      /^(?:mon|tue|wed|thu|fri|sat|sun)[a-z/&-]*\s+until\b/i.test(trimmedInner) ||
      /^(?:open\s+)?until\s+\d{1,2}(?::\d{2})?\s*(?:AM|PM|Midnight)\s+on\s+(?:mon|tue|wed|thu|fri|sat|sun)/i.test(trimmedInner)) {
      return '; ' + trimmedInner;
    }
    return '';
  });

  const clauses = withoutParens
    .split(/\s*[;•]\s*|\s*,\s*(?=(?:mon|tue|wed|thu|fri|sat|sun|daily|open\s+daily|closed)\b)/i)
    .map(c => c.trim())
    .filter(Boolean);

  const dayRegex = /\b(mondays?|mon|tuesdays?|tues?|wednesdays?|weds?|thursdays?|thurs?|thur?|fridays?|fri|saturdays?|sat|sundays?|sun)\b/gi;

  let matchedAny = false;
  for (const clause of clauses) {
    // Handle "Daily: 10:00 AM - 5:00 PM" as a base clause before day-specific overrides
    const dailyClauseMatch = clause.match(/^(?:open\s+)?daily(?:\s+year-round)?\s*[:•-]?\s*(.+)$/i);
    if (dailyClauseMatch) {
      const baseVal = dailyClauseMatch[1].trim();
      days.forEach((d, idx) => {
        result[d] = baseVal;
        result[fullDays[idx]] = baseVal;
      });
      matchedAny = true;
      continue;
    }

    // Handle "open until 8:00 PM on Thursdays"
    const openUntilOnMatch = clause.match(/^(?:open\s+)?until\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM|Midnight))\s+on\s+([a-z]+)$/i);
    if (openUntilOnMatch) {
      const dIdx = dayMap[openUntilOnMatch[2].toLowerCase()];
      if (dIdx !== undefined) {
        const prev = result[days[dIdx]] || '10:00 AM – 5:00 PM';
        const updated = prev.replace(/[-–—]\s*(?:\d{1,2}(?::\d{2})?\s*(?:AM|PM)|Midnight|Dusk)/i, `– ${openUntilOnMatch[1].trim()}`);
        result[days[dIdx]] = updated;
        result[fullDays[dIdx]] = updated;
        matchedAny = true;
      }
      continue;
    }

    // Handle "Fri/Sat until Midnight" or "Fri until 8:00 PM"
    const untilMatch = clause.match(/^((?:mon|tue|wed|thu|fri|sat|sun)[a-z/&,\s-]*?)\s+until\s+(\d{1,2}(?::\d{2})?\s*(?:AM|PM)|Midnight)$/i);
    if (untilMatch) {
      let m;
      dayRegex.lastIndex = 0;
      while ((m = dayRegex.exec(untilMatch[1])) !== null) {
        const dIdx = dayMap[m[1].toLowerCase()];
        if (dIdx !== undefined) {
          const prev = result[days[dIdx]] || '12:00 PM – 10:30 PM';
          const endLabel = /midnight/i.test(untilMatch[2]) ? '12:00 AM' : untilMatch[2].trim();
          const updated = prev.replace(/[-–—]\s*(?:\d{1,2}(?::\d{2})?\s*(?:AM|PM)|Midnight|Dusk)/i, `– ${endLabel}`);
          result[days[dIdx]] = updated;
          result[fullDays[dIdx]] = updated;
          matchedAny = true;
        }
      }
      continue;
    }

    // Handle "Closed Mondays" or "Closed Mon-Tue"
    const closedPrefix = clause.match(/^closed\s+(.+)$/i);
    let dayPart = '';
    let hoursPart = '';

    if (closedPrefix) {
      dayPart = closedPrefix[1];
      hoursPart = 'Closed';
    } else {
      // Match day specification before colon or time
      const colonIdx = clause.search(/:\s*(?=\d|Closed|Open|Sunrise|Dawn|By\s+Appointment)/i);
      if (colonIdx !== -1) {
        dayPart = clause.slice(0, colonIdx).trim();
        hoursPart = clause.slice(colonIdx + 1).trim();
      } else {
        const timeStart = clause.search(/\b(?:\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)|Closed|Open|Dawn|Sunrise|By\s+Appointment)\b/i);
        if (timeStart > 0) {
          dayPart = clause.slice(0, timeStart).trim();
          hoursPart = clause.slice(timeStart).trim();
        }
      }
    }

    if (!dayPart || !hoursPart) continue;
    hoursPart = hoursPart.replace(/^[:•-]\s*/, '').trim();

    // Parse ranges like "Mon-Wed", "Fri–Sun", "Wednesday, Friday–Sunday", "Tuesday to Sunday"
    const rangeTokens = dayPart.split(/\s*(?:,|&|\/|and)\s*/i);
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

/**
 * Orthogonal 3-Tier Seasonal & Cultural Sub-Tag Helper:
 * 1. Secular Festive: "holiday-lights", "holiday-market", "winter-festive", "cultural-festival"
 * 2. Sacred Music & Cultural Crossover: "sacred-music", "choral"
 * 3. Devotional / Liturgical: "faith-based", "religious-service"
 */
function inferHolidaySubTags(event) {
  if (!event || typeof event !== 'object') return [];
  const out = new Set();
  const explicitArr = [
    ...(Array.isArray(event.tags) ? event.tags : []),
    ...(Array.isArray(event.subTags) ? event.subTags : [])
  ];
  const existingSet = new Set(explicitArr.map(t => String(t || '').toLowerCase().trim()).filter(Boolean));
  for (const known of ['holiday-lights', 'holiday-market', 'winter-festive', 'cultural-festival', 'sacred-music', 'choral', 'faith-based', 'religious-service']) {
    if (existingSet.has(known)) out.add(known);
  }

  const titleStr = String(event.title || event.event_name || '').trim();
  const descStr = String(event.description || '').trim();
  const venueStr = String(event.venue || event.venue_name || '').trim();
  const titleDesc = `${titleStr} ${descStr}`;
  const titleDescVenue = `${titleDesc} ${venueStr}`;
  const holAff = String(event.holidayAffiliation || event.holiday_affiliation || '').toLowerCase().trim();

  const catSignals = [
    event.category,
    event.categoryLabel,
    ...(Array.isArray(event.categories) ? event.categories : [])
  ].filter(Boolean).join(' ').toLowerCase();
  const isMusicOrArts = /\b(music|live music|art|arts|theatre|theater|shows|stage|social|culture|classical|choral|concert|festivals?)\b/i.test(catSignals) ||
    /^(live_stage|festival)$/i.test(String(event.event_archetype || event.archetype || ''));

  // Exclude secular Fever "Candlelight Concert" / "Candlelight:" string quartets unless explicit worship terms exist
  const isSecularCandlelightConcert = /\bcandlelight(?:\s*:\s*|\s+concert|\s+tribute|\s+string|\s+quartet)/i.test(titleStr) &&
    !/\b(worship|mass|liturgy|sermon|christmas\s+eve\s+service|good\s+friday\s+service)\b/i.test(titleDesc);

  const explicitNotReligious = event.is_religious === false || event.isReligious === false;
  const explicitReligious = (event.is_religious === true || event.isReligious === true) && !/\b(messiah|cantata|lessons\s*(?:and|&)\s*carols|requiem|vespers)\b/i.test(titleStr);

  // Tier 3: Devotional / Liturgical ("faith-based", "religious-service")
  const matchesFaithRegex = !isSecularCandlelightConcert && (
    /\b(worship|mass|nativity|liturgy|sermon|prayer|candlelight\s+service|christmas\s+eve\s+service|good\s+friday\s+service)\b/i.test(titleDescVenue) ||
    /\b(worship\s*service|worship\s*night|liturgical|eucharist|holy\s*mass|christmas\s*mass|midnight\s*mass|bible\s*study|gospel\s*service|devotional\s*chanting|chanting,\s*singing,\s*and\s*prayer|taiz[eé]|shabbat\s*service|torah\s*service|synagogue\s*service|puja|kirtan|satsang|arti|aarti|jummah|tarawih|gurdwara\s*diwan|interfaith\s*service|church\s*fellowship)\b/i.test(titleDesc)
  );

  if (!explicitNotReligious && (explicitReligious || matchesFaithRegex)) {
    out.add('faith-based');
    if (/\b(service|worship|mass|liturgy|sermon|eucharist|puja|diwan|jummah)\b/i.test(titleDescVenue)) {
      out.add('religious-service');
    }
  }

  // Tier 2: Sacred Music & Cultural Crossover ("sacred-music", "choral")
  if (!out.has('faith-based')) {
    if (isMusicOrArts && /\b(messiah|choral|cantata|lessons\s*(?:and|&)\s*carols|choir|requiem|vespers)\b/i.test(titleDesc)) {
      out.add('sacred-music');
      if (/\b(choral|choir|lessons\s*(?:and|&)\s*carols|cantata|messiah|requiem|vespers)\b/i.test(titleDesc)) {
        out.add('choral');
      }
    }
  }

  // Tier 1: Secular Festive ("holiday-lights", "holiday-market", "winter-festive", "cultural-festival")
  if (/\b(festival\s+of\s+lights|bear\s+creek\s+lights|canyon\s+lights|bright\s+nights|lights\s+of\s+hope|lumi[eè]re|tree\s+lighting|light\s+walk|holiday\s+lights|winter\s+lights|lantern\s+festival)\b/i.test(titleDesc)) {
    out.add('holiday-lights');
  }
  if (/\b(christmas\s+market|holiday\s+market|winter\s+market|holiday\s+bazaar|winter\s+craft\s+market|holiday\s+craft)\b/i.test(titleDesc)) {
    out.add('holiday-market');
  }
  if (!out.has('faith-based') && (holAff === 'christmas' || holAff === 'winter-holiday-season' || holAff === 'new-years' ||
    /\b(santa|nutcracker|panto|pantomime|ugly\s+sweater|keithmas|krampus|gingerbread|winter\s+solstice|polar\s+bear\s+swim|holiday\s+comedy|holiday\s+trivia|yuletide)\b/i.test(titleDesc))) {
    out.add('winter-festive');
  }
  if (holAff === 'diwali' || holAff === 'vaisakhi' || holAff === 'lunar-new-year' || holAff === 'dia-de-los-muertos' ||
    /\b(diwali|vaisakhi|lunar\s+new\s+year|chinese\s+new\s+year|dia\s+de\s+los\s+muertos|day\s+of\s+the\s+dead|lion\s+dance)\b/i.test(titleDesc)) {
    out.add('cultural-festival');
  }

  return Array.from(out);
}
window.inferHolidaySubTags = inferHolidaySubTags;

function getCardSemanticCategoryMeta(ev) {
  if (!ev) return { label: 'Arts', themeKey: 'arts', filterId: 'arts' };
  const titleStr = String(ev.title || ev.event_name || '');
  const catLabel = String(ev.categoryLabel || ev.category || '');
  const cats = Array.isArray(ev.categories) ? ev.categories.map(c => String(c || '').toLowerCase()) : [String(ev.category || '').toLowerCase()];
  const subTagsStr = Array.isArray(ev.subTags) ? ev.subTags.join(' ') : '';
  const arch = String(ev.event_archetype || ev.archetype || '').toLowerCase();
  const combined = `${titleStr} ${catLabel} ${subTagsStr}`;

  if (cats.includes('academic')) {
    return { label: 'Academic', themeKey: 'academic', filterId: 'academic' };
  }
  if (cats.includes('trivia') || arch === 'social_gaming' || /\b(social\s*&\s*games|trivia\s*&\s*games|board\s*game|bingo|trivia|quiz|pinball|arcade)\b/i.test(combined)) {
    const isTrivia = /\b(trivia|quiz)\b/i.test(combined);
    return { label: isTrivia ? 'Trivia' : 'Games', themeKey: 'games', filterId: 'social' };
  }
  if (cats.includes('cinema') || cats.includes('movies') || arch === 'cinema' || /\bindie\s*cinema\b/i.test(catLabel)) {
    return { label: 'Cinema', themeKey: 'cinema', filterId: 'cinema' };
  }
  if (cats.includes('comedy') || /\b(comedy|stand-?up|improv)\b/i.test(`${titleStr} ${catLabel}`)) {
    return { label: 'Comedy', themeKey: 'comedy', filterId: 'shows' };
  }
  if (cats.includes('music') || /\b(live\s*music|concert|symphony|orchestra|choir|choral|jazz|dj|rave)\b/i.test(`${titleStr} ${catLabel}`)) {
    return { label: 'Music', themeKey: 'music', filterId: 'music' };
  }
  if (cats.includes('markets') || /\bmarket\b/i.test(catLabel) || /\b(holiday\s+market|christmas\s+market|winter\s+market|artisan\s+market|craft\s+market|farmers\s+market)\b/i.test(titleStr)) {
    return { label: 'Markets', themeKey: 'markets', filterId: 'markets' };
  }
  if (cats.includes('sports') || arch === 'active_rec' || /\b(sports?|golf|pitch\s*&\s*putt|skating|curling|hockey|baseball|soccer|bowling|roller)\b/i.test(combined)) {
    return { label: 'Sports', themeKey: 'sports', filterId: 'sports' };
  }
  if (cats.includes('outdoors') || arch === 'civic_park' || (cats.includes('free-public-access') && /\b(park|beach|seawall|garden|trail|canyon|quay|pier|promenade|plaza|island|lights|walk)\b/i.test(`${ev.venue || ''} ${titleStr}`))) {
    return { label: 'Outdoors', themeKey: 'outdoors', filterId: 'outdoors' };
  }
  if (cats.includes('theatre') || /\b(theatre|theater|play|musical|panto|pantomime|ballet|opera|cabaret|drag|burlesque|fringe)\b/i.test(combined)) {
    return { label: 'Theatre', themeKey: 'comedy', filterId: 'shows' };
  }
  if (cats.includes('shows') || arch === 'live_stage') {
    return { label: 'Stage', themeKey: 'comedy', filterId: 'shows' };
  }
  if (cats.includes('festivals') || arch === 'festival') {
    return { label: 'Festival', themeKey: 'festivals', filterId: 'festivals' };
  }
  if (cats.includes('arts') || cats.includes('culture') || arch === 'museum_gallery' || arch === 'workshop' || /\b(gallery|museum|exhibition|exhibit|workshop|art)\b/i.test(combined)) {
    return { label: 'Arts', themeKey: 'arts', filterId: 'arts' };
  }
  if (cats.includes('social') || cats.includes('activities')) {
    return { label: 'Social', themeKey: 'games', filterId: 'social' };
  }
  return { label: 'Arts', themeKey: 'arts', filterId: 'arts' };
}
window.getCardSemanticCategoryMeta = getCardSemanticCategoryMeta;
window.getCurrentCategoryFilter = () => (typeof state !== 'undefined' && state.category) ? state.category : 'all';

function getCompactRow2CategoryLabel(ev) {
  return getCardSemanticCategoryMeta(ev).label;
}
window.getCompactRow2CategoryLabel = getCompactRow2CategoryLabel;

function formatSmartRow2VenueMeta(ev, shortNeighborhood, row2TimeDisplay) {
  const venueRaw = String(ev && (ev.venue_name || ev.venue) || '').trim();
  const displayTitle = typeof formatCardDisplayTitle === 'function'
    ? String(formatCardDisplayTitle(ev ? ev.title : '', ev) || '')
    : String((ev && ev.title) || '');

  const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/^the\s+/i, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const titleNorm = norm(displayTitle);
  const venueNorm = norm(venueRaw);
  const nhNorm = norm(shortNeighborhood);

  const venueCore = venueNorm
    .replace(/\b(park|seawall|garden|gardens|botanical|beach|trail|canyon|plaza|theatre|theater|centre|center|community|arts|recreation|gallery|museum|hall|arena|stadium|vancouver|surrey)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const isVenueRedundant = !venueNorm ||
    titleNorm.includes(venueNorm) ||
    venueNorm.includes(titleNorm) ||
    (venueCore.length >= 4 && titleNorm.includes(venueCore));

  if (isVenueRedundant) {
    return `${shortNeighborhood} • ${row2TimeDisplay}`;
  }
  if (!shortNeighborhood || venueNorm === nhNorm || venueNorm.includes(nhNorm)) {
    return `${venueRaw} • ${row2TimeDisplay}`;
  }
  return `${venueRaw} (${shortNeighborhood}) • ${row2TimeDisplay}`;
}

function isAnytimeDropInEvent(ev) {
  if (!ev) return false;
  return Boolean(
    ev.isFreePublic ||
    ev.lifecycleType === 'perennial_drop_in' ||
    ev.lifecycle_type === 'perennial_drop_in' ||
    ev.access_model === 'open_public_space' ||
    ev.access_model === 'free_public_access' ||
    ((ev.isDaily || ev.frequency === 'daily') && (!Array.isArray(ev.showings) || ev.showings.length === 0) && !ev.startIso)
  );
}

function parseClockTimeToMinutes(rawStr) {
  if (!rawStr) return null;
  const str = String(rawStr).trim();
  const m12 = str.match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = m12[2] ? parseInt(m12[2], 10) : 0;
    const mer = m12[3].toUpperCase();
    if (mer === 'PM' && h < 12) h += 12;
    if (mer === 'AM' && h === 12) h = 0;
    return h * 60 + min;
  }
  const m24 = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m24) {
    const h = parseInt(m24[1], 10);
    const min = parseInt(m24[2], 10);
    if (h >= 0 && h < 24 && min >= 0 && min < 60 && !(h === 0 && min === 0)) {
      return h * 60 + min;
    }
  }
  return null;
}

function getEventSortMinuteOfDay(ev, targetDateObj) {
  if (!ev || isAnytimeDropInEvent(ev)) return 9999;
  const targetIso = (targetDateObj instanceof Date && !isNaN(targetDateObj.getTime()))
    ? `${targetDateObj.getFullYear()}-${String(targetDateObj.getMonth() + 1).padStart(2, '0')}-${String(targetDateObj.getDate()).padStart(2, '0')}`
    : null;

  if (Array.isArray(ev.showings) && ev.showings.length > 0) {
    const matched = (targetIso && ev.showings.find(s => s && s.date === targetIso)) || ev.showings[0];
    if (matched) {
      const mins = parseClockTimeToMinutes(matched.start_time || matched.time);
      if (mins !== null) return mins;
    }
  }
  if (ev.time) {
    const mins = parseClockTimeToMinutes(ev.time);
    if (mins !== null) return mins;
  }
  if (ev.startIso && String(ev.startIso).includes('T')) {
    const timePart = String(ev.startIso).split('T')[1]?.slice(0, 5);
    const mins = parseClockTimeToMinutes(timePart);
    if (mins !== null) return mins;
  }
  const sched = String(ev.dateSchedule || '');
  const schedMins = parseClockTimeToMinutes(sched);
  if (schedMins !== null) return schedMins;
  if (/morning/i.test(sched)) return 600;
  if (/afternoon|matinee/i.test(sched)) return 840;
  return 1140; // Default Evening (7:00 PM)
}

function getEventRow2TimeDisplay(ev, topDate, bucketKey) {
  if (!ev) return 'All Day';
  const isDropInSpot = Boolean(
    ev.isFreePublic ||
    ev.lifecycleType === 'perennial_drop_in' ||
    ev.lifecycle_type === 'perennial_drop_in' ||
    ev.access_model === 'open_public_space' ||
    ev.access_model === 'free_public_access' ||
    ev.frequency === 'daily'
  );

  // Locate matching showing for topDate.dateStr or earliest upcoming showing
  let rawStart = '';
  let rawEnd = '';
  if (Array.isArray(ev.showings) && ev.showings.length > 0) {
    const targetIso = topDate && topDate.dateStr ? topDate.dateStr : null;
    const matched = (targetIso && ev.showings.find(s => s && s.date === targetIso)) || ev.showings[0];
    if (matched) {
      rawStart = matched.start_time || matched.time || '';
      rawEnd = matched.end_time || '';
    }
  }
  if (!rawStart && ev.time && !/^(daily|varies|check|none_available|unknown|all day)$/i.test(String(ev.time).trim())) {
    rawStart = String(ev.time).trim();
  }
  if (!rawStart && ev.startIso && String(ev.startIso).includes('T')) {
    const timePart = String(ev.startIso).split('T')[1]?.slice(0, 5);
    if (timePart && timePart !== '00:00') rawStart = timePart;
  }

  let timeLabel = '';
  if (rawStart && !/^(none_available|unknown|tba|tbd|varies)$/i.test(rawStart)) {
    if (/all\s*day|24\s*hours|dawn/i.test(rawStart)) {
      timeLabel = 'All Day';
    } else {
      const fmtStart = typeof formatDisplayTime12h === 'function' ? formatDisplayTime12h(rawStart) : rawStart;
      if (isDropInSpot && rawEnd && !/^(none_available|unknown)$/i.test(rawEnd)) {
        const fmtEnd = typeof formatDisplayTime12h === 'function' ? formatDisplayTime12h(rawEnd) : rawEnd;
        timeLabel = (fmtStart && fmtEnd && fmtStart !== fmtEnd) ? `${fmtStart} – ${fmtEnd}` : (fmtStart || 'All Day');
      } else {
        timeLabel = fmtStart || (isDropInSpot ? 'All Day' : 'Evening');
      }
    }
  } else if (isDropInSpot) {
    timeLabel = 'All Day';
  } else {
    const schedStr = String(ev.dateSchedule || '');
    const clockMatch = schedStr.match(/\b(\d{1,2}(?::\d{2})?\s*(?:AM|PM))\b/i);
    if (clockMatch) {
      timeLabel = clockMatch[1].toUpperCase();
    } else if (/afternoon|matinee/i.test(schedStr)) {
      timeLabel = 'Afternoon';
    } else if (/morning/i.test(schedStr)) {
      timeLabel = 'Morning';
    } else {
      timeLabel = 'Evening';
    }
  }

  // Only include the date string on collapsed Row 2 when viewing an ungrouped list (!bucketKey)
  if (!bucketKey && topDate && topDate.badgeText) {
    return `${topDate.badgeText} • ${timeLabel}`;
  }
  return timeLabel;
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
  const isDropIn = item.lifecycle_type === "perennial_drop_in" || item.lifecycleType === "perennial_drop_in" || item.access_model === "open_public_space" || item.access_model === "free_public_access";
  const isFreePublic = price === 0 && (
    catRaw.includes("public access") ||
    catRaw.includes("free public") ||
    catRaw === "free-public-access" ||
    item.access_model === "open_public_space" ||
    item.access_model === "free_public_access" ||
    isDropIn
  );

  const evTitle = sanitizeMojibake(item.event_name || item.title || "Event");
  const rawFestivalAff = (item.festival_affiliation && item.festival_affiliation !== "None" && item.festival_affiliation !== "none_available")
    ? item.festival_affiliation
    : ((item.festivalAffiliation && item.festivalAffiliation !== "None" && item.festivalAffiliation !== "none_available") ? item.festivalAffiliation : null);
  const hasFestivalAffiliation = Boolean(rawFestivalAff);

  const rawHolidayAff = (() => {
    const explicit = item.holiday_affiliation || item.holidayAffiliation || (item.dimension_audit && (item.dimension_audit.D008_holiday_affiliation?.value || item.dimension_audit.D009_holiday_affiliation?.value));
    if (explicit && explicit !== "None" && explicit !== "none_available") {
      const normExp = String(explicit).toLowerCase().trim();
      return (normExp === "winter-holiday-season" || normExp === "winter-holidays") ? "christmas" : normExp;
    }
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
    if (/\b(?:vaisakhi|baisakhi|nagar kirtan)\b/i.test(checkText)) return "vaisakhi";
    if (/\b(?:canada day)\b/i.test(checkText)) return "canada-day";
    if (/\b(?:pride festival|vancouver pride|pride parade|queer pride)\b/i.test(checkText)) return "pride";
    if (inSeason("10-01", "11-03") && /\b(?:haunted|spooky|horror|slasher|thriller|costume|masquerade|zombie|vampire|vampyr|witch|witches|ghost|goth|gothic|occult|macabre|monster|pumpkin|fright|scream|creepy|murder mystery|deadly dinner|unexplained|paranormal|x[- ]files|yes files|seance|séance|rocky horror|nosferatu|frankenstein|dracula|evil dead|exorcist|dark cabaret|freak show)\b/i.test(checkText)) return "halloween";
    if (inSeason("10-15", "11-20") && /\b(?:festival of lights|rangoli|bhangra|bollywood|garba|dandiya|mehfil|diya)\b/i.test(checkText)) return "diwali";
    if (inSeason("11-15", "01-03") && /\b(?:holiday market|winter market|craft market|winter solstice|festive|ugly sweater|carol|carols|caroling|menorah|gingerbread|mistletoe|polar express|canyon lights|bright nights|winter wonderland|holiday special|holiday show|holiday concert|holiday party)\b/i.test(checkText)) return "christmas";
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
  const wh = parseWeeklyHoursTo7DayObject(rawWh, opHours || item.dateSchedule || item.date_schedule, isDropIn);

  const primaryShow = showings[0] || show1;

  if (isDropIn || isFreePublic) {
    if (item.dateSchedule && item.dateSchedule !== "Upcoming") {
      dateSchedule = formatScheduleText12h(sanitizeMojibake(item.dateSchedule));
    } else if (opHours) {
      dateSchedule = `Visiting Hours: ${formatScheduleText12h(opHours)}`;
    } else if (wh) {
      dateSchedule = isFreePublic ? "Open Daily to the Public" : "Daily Drop-In Hours";
    } else if (show1.start_time && show1.end_time && !/none_available/i.test(show1.start_time)) {
      dateSchedule = `Open: ${formatDisplayTime12h(show1.start_time)} – ${formatDisplayTime12h(show1.end_time)}`;
    } else {
      dateSchedule = isFreePublic ? "Open Daily to the Public" : "Daily Drop-In";
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

  // Multi-Category Taxonomy Resolution (Aligned with Canonical 258-Event Catalog)
  const tagsStr = (Array.isArray(item.tags) ? item.tags.join(" ") : String(item.tags || "")).toLowerCase();
  const subTagsStr = (Array.isArray(item.subTags || item.sub_tags) ? (item.subTags || item.sub_tags).join(" ") : "").toLowerCase();
  const titleLower = evTitle.toLowerCase();
  const venueLower = (item.venue_name || item.venue || "").toLowerCase();
  const descLower = (item.description || "").toLowerCase();
  const arch = String(item.event_archetype || item.archetype || "").toLowerCase();
  const combinedContext = `${catRaw} ${tagsStr} ${subTagsStr} ${titleLower} ${venueLower} ${descLower}`;

  // 1. Cinema (Movies / Film Screenings)
  const isLiveToFilmSymphony = /\bin concert live to film\b/i.test(titleLower);
  const isCinema = !isLiveToFilmSymphony && (
    arch === "cinema" ||
    catRaw === "cinema" ||
    venueLower.includes("cinematheque") ||
    venueLower.includes("viff centre") ||
    venueLower.includes("fifth avenue cinema") ||
    /\b(film screening|movie screening|documentary screening|screening of|35mm|16mm|short films|film festival|mountains on stage|last christian in bethlehem|house of r3nc0ng)\b/i.test(`${titleLower} ${descLower}`)
  ) && !/\b(comedy|stand-up|burlesque|improv|trivia)\b/i.test(titleLower);

  // 2. Sports & Active Rec
  const isProWrestling = /\b(pro wrestling|pandemonium pro)\b/i.test(combinedContext);
  const isSports = (
    arch === "active_rec" ||
    isProWrestling ||
    /\b(pitch & putt|pitch and putt|par-3|soccer championship|varsity basketball|thunderbirds basketball|tennis|recreation courts|ice skating)\b/i.test(combinedContext)
  );

  // 3. Outdoors & Parks
  const isOutdoorParkOrPromenade = /\b(seawall|waterfront promenade|boardwalk|quarry gardens|pitch & putt|bloedel conservatory|vandusen|queen elizabeth park|stanley park|sun yat-sen|canada place|the shipyards|siwash rock|rooftop garden|kitsilano beach)\b/i.test(`${titleLower} ${venueLower}`);
  const isOutdoors = !isProWrestling && !/\b(varsity basketball|thunderbirds basketball)\b/i.test(combinedContext) && (
    arch === "civic_park" ||
    isSports ||
    catRaw === "outdoors" ||
    item.access_model === "open_public_space" ||
    isOutdoorParkOrPromenade
  ) && !venueLower.includes("park theatre") && !venueLower.includes("2nd floor gastown");

  // 4. Markets & Craft Sales
  const isMarkets = (
    catRaw === "markets" ||
    /\b(public market|holiday market|winter market|art market|queer market|craft market|pottery, bake, quilt, knit sale|the ornament collection|granville island public market)\b/i.test(`${titleLower} ${descLower}`)
  );

  // 5. Trivia, Games & Social Gaming
  const isTriviaGames = (
    arch === "social_gaming" ||
    /\b(trivia|board game|pinball|arcade|karaoke|drawing from memory|video games edition)\b/i.test(`${titleLower} ${descLower}`)
  );

  // 6. Music (Concerts, Symphony/Orchestra, Bands, Jazz, Choir, DJ Dance Parties)
  const tierNamesStr = Array.isArray(item.all_tiers) ? item.all_tiers.map(t => t && t.name ? t.name : "").join(" ") : "";
  const isMusic = !isCinema && !isTriviaGames && (
    catRaw === "music" ||
    venueLower.includes("orpheum") ||
    venueLower.includes("pyatt hall") ||
    venueLower.includes("bell performing arts") ||
    venueLower.includes("commodore ballroom") ||
    venueLower.includes("rickshaw theatre") ||
    /\b(vancouver symphony orchestra|chamber players|chamber music|concert|live music|jazz|orchestra|symphony|string quartet|piano concerto|cello concerto|violin concerto|tribute band|nickelback tribute|depeche mode|pink floyd|crazy diamonds|city pop|east van opry|singer-songwriter|folk-pop|indie-folk|americana|guitar night|pipe organ|choir|singers|uzbek musical|sings ella|sings aretha|dance party|90s night|00s night|00s vs 10s|90s vs 00s|little ravers|no skips|pub jams|dj r3d|ruby haunt|tadhg nolan|emily scott robinson|michael bernard fitzgerald|audalei|john muirhead|hamza|steve dawson|songs we sing|guestlist cover)\b/i.test(`${titleLower} ${descLower} ${tierNamesStr}`)
  ) && !/\b(circus incognitus|christmas presence)\b/i.test(titleLower);

  // 7. Comedy
  const isComedy = !isCinema && (
    catRaw === "comedy" ||
    /\b(comedy|stand-up|stand up|comedian|improv|improvised|jokes please|sunday service|panto|one-woman show|drawing from memory|snowed in comedy|alistair ogden|nick colletti|jenny tian|susan rice|circus incognitus)\b/i.test(`${titleLower} ${descLower}`)
  );

  // 8. Stage / Theatre / Burlesque / Dance Performance (Comedy & Stage = 'shows')
  const isRemembranceOrService = /\b(remembrance day|granville island remembers|trans day of remembrance|sunday morning|candlelit contemplative|bible study|parent & tot|children’s group|good news cafe)\b/i.test(titleLower);
  const isShows = !isCinema && !isMusic && !isMarkets && !isOutdoors && !isRemembranceOrService && (
    isComedy ||
    isProWrestling ||
    catRaw === "shows" ||
    /\b(burlesque|theatre production|stage production|world premiere musical|original musical|ballet|swan lake|cuff live|justin mcelroy|travis holp|52 stories|son of a preacherman|christmas presence|mental|no apologies|michel\(le\)|wolf cull|for frances|circus incognitus)\b/i.test(`${titleLower} ${descLower}`)
  ) && !/\b(throne of glass trivia|karaoke)\b/i.test(titleLower);

  // 9. Arts, Galleries, Museums & Workshops
  const isArts = !isTriviaGames && (
    (arch === "museum_gallery" && !/\b(the shipyards|lonsdale quay)\b/i.test(titleLower)) ||
    arch === "workshop" ||
    catRaw === "arts" ||
    /\b(gallery|museum|exhibition|indigenous art|carving|poetry|comic maker|stitching circle|handcrafted|art-making|kids first|lind biennial|parallelogram|from the deep|st\. roch|gingerbread house|ballet)\b/i.test(`${titleLower} ${venueLower} ${descLower}`)
  ) && !/\b(bible study|good news cafe|parent & tot|ignite!|parent, pie and prayer|word is out|eat pray love)\b/i.test(titleLower);

  // 10. Social & Community
  const isSocialArts = (
    isArts ||
    isTriviaGames ||
    arch === "roving_series" ||
    isRemembranceOrService ||
    catRaw === "social" ||
    catRaw === "culture" ||
    isCinema ||
    /\b(social|community|workshop|meetup|meet-up|besties|climate talks|break the silence|advent season|lights of hope|concord christmas|breakfast or brunch with santa)\b/i.test(`${titleLower} ${descLower}`)
  );

  // Build ev.categories array (multi-category assignment)
  const categories = Array.isArray(item.categories) ? [...item.categories] : [];
  const addCat = (c) => { if (c && !categories.includes(c)) categories.push(c); };
  if (item.category) addCat(String(item.category).toLowerCase());
  if (isCinema) addCat("cinema");
  if (isMusic) addCat("music");
  if (isShows) addCat("shows");
  if (isComedy) addCat("comedy");
  if (isOutdoors) addCat("outdoors");
  if (isSports) addCat("sports");
  if (isMarkets) addCat("markets");
  if (isTriviaGames) addCat("trivia");
  if (isArts) addCat("arts");
  if (isSocialArts) addCat("social");
  if (isFest || isHoliday) addCat("festivals");
  if (isFreePublic) addCat("free-public-access");
  if (isLiveToFilmSymphony) addCat("cinema");
  if (/\b(circus incognitus|east van panto|for frances|let it be done|christmas presence)\b/i.test(titleLower)) addCat("music");

  // Determine primary category for badge display
  let cat = "social";
  if (isCinema) cat = "cinema";
  else if (isMarkets) cat = "markets";
  else if (isOutdoorParkOrPromenade && !/\b(vancouver art gallery|polygon gallery|contemporary art gallery|bill reid|pendulum gallery)\b/i.test(titleLower)) cat = "outdoors";
  else if (isSports && !isProWrestling) cat = "outdoors";
  else if (isMusic) cat = "music";
  else if (isShows) cat = "shows";
  else if (/\b(diwali downtown surrey|lumière festival|lumiere festival|33rd annual winter solstice|winter trout fest|concord christmas|lights of hope|breakfast or brunch with santa)\b/i.test(titleLower)) cat = "festivals";
  else if (isOutdoors) cat = "outdoors";
  else if (isSocialArts) cat = "social";
  else if (isFreePublic) cat = "free-public-access";

  if (!categories.includes(cat)) categories.unshift(cat);

  // Calculate actual day-of-week codes (mon, tue, wed, etc.) - NEVER default to ['daily'] for timed events
  const DAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  let daysOfWeek = [];
  if (isDropIn || isFreePublic) {
    if (wh && typeof wh === 'object') {
      const openDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter(d => {
        const val = String(wh[d] || '').trim();
        return val && !/^(?:closed|by\s+appointment)$/i.test(val);
      });
      daysOfWeek = openDays.length === 7 ? ["daily", ...openDays] : (openDays.length > 0 ? openDays : ["daily", "mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    } else if (Array.isArray(item.daysOfWeek) && item.daysOfWeek.length > 0) {
      daysOfWeek = [...item.daysOfWeek];
    } else {
      daysOfWeek = ["daily", "mon", "tue", "wed", "thu", "fri", "sat", "sun"];
    }
  } else {
    const daySet = new Set();
    if (Array.isArray(item.daysOfWeek) && item.daysOfWeek.length > 0) {
      item.daysOfWeek.forEach(d => {
        const clean = String(d).trim().toLowerCase().slice(0, 3);
        if (DAY_CODES.includes(clean)) daySet.add(clean);
      });
    }
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

  const finalPrice = price > 0 ? price : 0.0;

  // Canonical Festival Resolver: unifies overlapping festival names/aliases into a single canonical slug & label
  const resolveCanonicalFestival = (rawAff, titleStr, idStr) => {
    const combined = `${rawAff || ''} ${titleStr || ''} ${idStr || ''}`.trim();
    if (!rawAff && !/\b(?:lumi[eè]re\s*festival|diwali\s*(?:fest|in\s*surrey|downtown\s*surrey)|european\s*union\s*film\s*festival|vancouver\s*christmas\s*market|vandusen\s*festival\s*of\s*lights|bright\s*nights)\b/i.test(combined)) {
      return null;
    }
    const lower = String(rawAff || combined).toLowerCase();
    // Skip any festival currently pending curator approval or rejected in window.FESTIVALS
    if (Array.isArray(window.FESTIVALS)) {
      const pendingMatch = window.FESTIVALS.find(f => {
        if (!f || (f.status !== 'pending_curator_approval' && f.approvalStatus !== 'pending' && f.status !== 'rejected')) return false;
        const fn = String(f.festival_name || f.name || '').toLowerCase();
        return fn && lower.includes(fn);
      });
      if (pendingMatch) return null;
    }
    if (/\bdiwali\b/i.test(lower)) {
      return { slug: 'diwali-fest', label: 'Diwali Fest', fullLabel: 'Diwali Fest (Festival of Lights)', icon: '🪔' };
    }
    if (/\b(?:european\s*union\s*film\s*festival|euff)\b/i.test(lower)) {
      return { slug: 'european-union-film-festival', label: 'European Union Film Festival', fullLabel: 'European Union Film Festival (EUFF)', icon: '🎬' };
    }
    if (/\blumi[eè]re\s*festival\b/i.test(lower)) {
      return { slug: 'lumiere-festival', label: 'Lumière Festival', fullLabel: 'Lumière Festival', icon: '✨' };
    }
    if (/\bculture\s*days\b/i.test(lower)) {
      return { slug: 'bc-culture-days', label: 'BC Culture Days', fullLabel: 'BC Culture Days', icon: '🎨' };
    }
    if (/\bheart\s*of\s*the\s*city\b/i.test(lower)) {
      return { slug: 'downtown-eastside-heart-of-the-city-festival', label: 'DTES Heart of the City Festival', fullLabel: 'Downtown Eastside Heart of the City Festival', icon: '❤️' };
    }
    if (/\b(?:muertos|day\s*of\s*the\s*dead)\b/i.test(lower)) {
      return { slug: 'dia-de-los-muertos-festival-day-of-the-dead', label: 'Día de los Muertos Festival', fullLabel: 'Día de los Muertos Festival (Day of the Dead)', icon: '💀' };
    }
    if (/\bbear\s*creek\s*lights\b/i.test(lower)) {
      return { slug: 'bear-creek-lights', label: 'Bear Creek Lights', fullLabel: 'Bear Creek Lights', icon: '✨' };
    }
    // Single-venue winter holiday attractions roll directly into "❄️ Winter & Holiday Season" (holiday:christmas)
    if (/\b(?:surrey\s*tree\s*lighting|vancouver\s*christmas\s*market|vandusen\s*festival\s*of\s*lights|bright\s*nights)\b/i.test(lower)) {
      return null;
    }
    if (!rawAff) return null;
    const festShort = String(rawAff).replace(/\s*\(.*?\)\s*/g, '').trim();
    const festSlug = festShort.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const festIcon = /viff|film/i.test(rawAff) ? '🎬' : '🎪';
    return { slug: festSlug, label: festShort, fullLabel: rawAff, icon: festIcon };
  };

  // Build normalized subTags and structured Festival/Holiday theme badges
  const baseSubTags = Array.isArray(item.tags) ? [...item.tags] : (Array.isArray(item.subTags) ? [...item.subTags] : []);
  const themeBadges = [];
  const isMergedWinterAttraction = /\b(?:surrey\s*tree\s*lighting|vancouver\s*christmas\s*market|vandusen\s*festival\s*of\s*lights|bright\s*nights)\b/i.test(`${rawFestivalAff || ''} ${evTitle || ''}`);
  if (isMergedWinterAttraction && !rawHolidayAff) {
    rawHolidayAff = 'christmas';
  }
  const canonicalFest = resolveCanonicalFestival(rawFestivalAff, evTitle, item.id || item.event_id);
  if (canonicalFest) {
    themeBadges.push({
      key: `festival:${canonicalFest.slug}`,
      type: 'festival',
      id: canonicalFest.slug,
      label: canonicalFest.label,
      fullLabel: canonicalFest.fullLabel,
      icon: canonicalFest.icon
    });
    for (const t of ['festival', canonicalFest.slug, `festival:${canonicalFest.slug}`]) {
      if (t && !baseSubTags.some(x => String(x).toLowerCase() === t)) baseSubTags.push(t);
    }
  }
  if (rawHolidayAff) {
    // Unify holiday:diwali into festival:diwali-fest so Diwali events never split into two separate pills
    if (String(rawHolidayAff).toLowerCase() === 'diwali') {
      if (!themeBadges.some(b => b.key === 'festival:diwali-fest')) {
        themeBadges.push({
          key: 'festival:diwali-fest',
          type: 'festival',
          id: 'diwali-fest',
          label: 'Diwali Fest',
          fullLabel: 'Diwali Fest (Festival of Lights)',
          icon: '🪔'
        });
      }
      for (const t of ['festival', 'diwali-fest', 'festival:diwali-fest', 'holiday', 'diwali', 'holiday:diwali']) {
        if (t && !baseSubTags.some(x => String(x).toLowerCase() === t)) baseSubTags.push(t);
      }
    } else {
      const holMeta = (window.HOLIDAY_REGISTRY && window.HOLIDAY_REGISTRY[rawHolidayAff]) || {
        id: rawHolidayAff,
        label: rawHolidayAff.charAt(0).toUpperCase() + rawHolidayAff.slice(1),
        icon: '🎉',
        keywords: rawHolidayAff
      };
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
  }

  // Orthogonal 3-Tier Seasonal & Cultural Sub-Tag Inference (Secular Festive / Sacred Choral / Devotional Faith-Based)
  const inferredHolidayTags = inferHolidaySubTags({
    ...item,
    title: evTitle,
    venue: item.venue_name || item.venue || '',
    category: cat,
    categories: categories,
    holidayAffiliation: rawHolidayAff
  });
  for (const ht of inferredHolidayTags) {
    if (ht && !baseSubTags.some(x => String(x).toLowerCase() === ht)) baseSubTags.push(ht);
  }
  const isReligious = inferredHolidayTags.includes('faith-based') || inferredHolidayTags.includes('religious-service');
  if (isReligious) {
    for (const t of ['religious', 'spiritual', 'religious:religious']) {
      if (t && !baseSubTags.some(x => String(x).toLowerCase() === t)) baseSubTags.push(t);
    }
  }

  const rawHood = String(item.neighborhood || "").trim();
  const rawAddr = String(item.full_address || item.address || "").trim();
  const explicitMuniMatch = rawAddr.match(/,\s*(North Vancouver|West Vancouver|Burnaby|Richmond|Coquitlam|Port Coquitlam|Port Moody|New Westminster|Surrey|White Rock|Delta|Langley|Maple Ridge|Pitt Meadows|Vancouver)\s*,\s*BC\b/i);
  const explicitAddrCity = explicitMuniMatch ? explicitMuniMatch[1].replace(/\s+/g, " ").trim() : null;
  const locBlob = `${rawHood} ${rawAddr}`;
  const itemCityRaw = String(explicitAddrCity || item.city || "").trim();
  const isEastVanGrandview = /grandview[- ]woodland/i.test(rawHood) || /\bvancouver\b/i.test(rawAddr);

  let inferredCity = explicitAddrCity || "";
  if (!inferredCity) {
    if (/^(?:burnaby|richmond|new westminster|new west|langley|surrey|white rock)$/i.test(itemCityRaw)) {
      inferredCity = /^new west/i.test(itemCityRaw) ? "New Westminster" : (/^white rock$/i.test(itemCityRaw) ? "Surrey" : itemCityRaw);
    } else if (!isEastVanGrandview && /\b(langley|fort langley|willoughby|walnut grove|murrayville|brookswood|aldergrove)\b/i.test(locBlob)) {
      inferredCity = "Langley";
    } else if (!isEastVanGrandview && /\b(burnaby|metrotown|brentwood|lougheed|deer lake|edmonds|simon fraser|sfu)\b/i.test(locBlob)) {
      inferredCity = "Burnaby";
    } else if (!isEastVanGrandview && /\b(richmond|steveston|brighouse|lansdowne|ironwood|minoru|terra nova)\b/i.test(locBlob)) {
      inferredCity = "Richmond";
    } else if (!isEastVanGrandview && /\b(new westminster|new west|sapperton|queensborough)\b/i.test(locBlob)) {
      inferredCity = "New Westminster";
    } else if (!isEastVanGrandview && (String(item.region || "").toLowerCase() === "surrey" || /\b(surrey|whalley|guildford|fleetwood|fraser heights|newton|bear creek|panorama\s+ridge|sullivan heights|cloverdale|clayton|south surrey|grandview heights|crescent beach|bridgeview|white rock)\b/i.test(locBlob))) {
      inferredCity = "Surrey";
    } else {
      inferredCity = itemCityRaw || "Vancouver";
    }
  }
  const resolvedCity = inferredCity;
  const cityLowerNorm = resolvedCity.toLowerCase();
  let resolvedRegion = "Vancouver";
  if (cityLowerNorm === "surrey" || cityLowerNorm === "white rock") resolvedRegion = "Surrey";
  else if (cityLowerNorm === "burnaby") resolvedRegion = "Burnaby";
  else if (cityLowerNorm === "richmond") resolvedRegion = "Richmond";
  else if (cityLowerNorm === "new westminster" || cityLowerNorm === "new west") resolvedRegion = "New West";
  else if (cityLowerNorm === "langley") resolvedRegion = "Langley";

  const customPriceLabel = (item.priceLabel && typeof item.priceLabel === "string" && (
    (finalPrice === 0 && /free/i.test(item.priceLabel)) ||
    (finalPrice > 0 && item.priceLabel.includes(String(Math.floor(finalPrice))))
  )) ? sanitizeMojibake(item.priceLabel) : null;

  const res = {
    id: item.event_id || item.id || `ev-${Math.random().toString(36).substring(2, 9)}`,
    title: evTitle,
    artist: item.artist || null,
    venue: item.venue_name || item.venue || "Vancouver Venue",
    address: item.full_address || item.address || "Vancouver, BC",
    neighborhood: item.neighborhood || "Vancouver",
    city: resolvedCity,
    region: resolvedRegion,
    day: item.day || item.days_open || "Daily",
    time: item.time || item.start_time || null,
    recurrence: item.recurrence || item.frequency || item.frequencyLabel || "Recurring",
    url: item.url || item.ticket_url || item.details_url || item.discovery_url || item.websiteUrl || "#",
    price: finalPrice,
    priceLabel: customPriceLabel || (finalPrice === 0 ? "Free ($0)" : `$${finalPrice.toFixed(2)} CAD`),
    pricingType: finalPrice === 0 ? "free" : "paid",
    isFree: finalPrice === 0,
    frequency: (isDropIn || isFreePublic) ? "daily" : (confirmedDates.length > 1 ? "limited-run" : "one-off"),
    frequencyLabel: item.frequencyLabel || ((isDropIn || isFreePublic) ? (isFreePublic ? "Open Daily Drop-In" : "Daily Drop-In") : (confirmedDates.length > 1 ? "Verified Multiple Showings" : "Single Showing")),
    daysOfWeek: daysOfWeek,
    timeSlots: (isDropIn || isFreePublic) ? ["early-morning", "afternoon", "early-evening"] : ["early-evening", "late-evening"],
    category: cat,
    categories: categories,
    categoryLabel: isFreePublic ? "Free Public Access" : (item.categoryLabel || item.category || "Shows & Arts"),
    categoryIcon: isFreePublic ? "🏛️" : (cat === "outdoors" ? "🌊" : (cat === "music" ? "🎵" : (cat === "cinema" ? "🎬" : "🎭"))),
    tags: baseSubTags,
    subTags: baseSubTags,
    dateSchedule: dateSchedule,
    startIso: (!(isDropIn || isFreePublic) && (showings[0]?.date || show1.date || item.date))
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
    coordinates: (() => {
      if (typeof window !== 'undefined' && typeof window.resolveEventCoordinates === 'function') {
        return window.resolveEventCoordinates(item);
      }
      if (Array.isArray(item.coordinates) && item.coordinates.length >= 2) {
        return [Number(item.coordinates[0]), Number(item.coordinates[1])];
      }
      return [49.145, -122.825];
    })(),
    lat: (() => {
      if (typeof window !== 'undefined' && typeof window.resolveEventCoordinates === 'function') {
        return window.resolveEventCoordinates(item)[0];
      }
      return Array.isArray(item.coordinates) && item.coordinates.length >= 2 ? Number(item.coordinates[0]) : 49.145;
    })(),
    lng: (() => {
      if (typeof window !== 'undefined' && typeof window.resolveEventCoordinates === 'function') {
        return window.resolveEventCoordinates(item)[1];
      }
      return Array.isArray(item.coordinates) && item.coordinates.length >= 2 ? Number(item.coordinates[1]) : -122.825;
    })(),
    transitInfo: item.transit_info || item.transitInfo || (item.dimension_audit && item.dimension_audit.D408_transit_waypoints && item.dimension_audit.D408_transit_waypoints.value && item.dimension_audit.D408_transit_waypoints.value !== 'search_exhausted_null' ? item.dimension_audit.D408_transit_waypoints.value : "Transit accessible via TransLink SkyTrain / bus service"),
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
      if (concession && parts.length < 2 && (!coffee || shortRange(concession) !== shortRange(coffee))) parts.push(`Concessions ${shortRange(concession)}`);
      if (meal && parts.length < 2) parts.push(`Food ${shortRange(meal)}`);
      if (parts.length === 0 && otherCost) parts.push(otherCost);
      return parts.length > 0 ? parts.join(' • ') : ((item.concession_benchmark === "none_available" || item.on_site_fnb === "none_available" || (typeof item.on_site_fnb === "string" && /\b(?:no\s+(?:on[- ]?site|permanent|regular|commercial(?:\s+public)?)\s+(?:cafe|bar|concession|food|restaurant)|none\s+inside|prohibited\s+inside)\b/i.test(item.on_site_fnb))) ? "No on-site concessions" : null);
    })(),
    sample_cost_label: sanitizeMojibake(item.sample_cost_label || null),
    coffee_benchmark: sanitizeMojibake(item.coffee_benchmark || null),
    meal_benchmark: sanitizeMojibake(item.meal_benchmark || null),
    price_adult: item.price_adult !== undefined ? item.price_adult : null,
    price_student: item.price_student !== undefined ? item.price_student : null,
    price_member: item.price_member !== undefined ? item.price_member : null,
    seniorPrice: (item.seniorPrice !== undefined && item.seniorPrice !== null && item.seniorPrice !== '')
      ? Number(item.seniorPrice)
      : ((item.senior_price !== undefined && item.senior_price !== null && item.senior_price !== '')
        ? Number(item.senior_price)
        : ((item.price_senior !== undefined && item.price_senior !== null && item.price_senior !== '')
          ? Number(item.price_senior)
          : null)),
    seniorDiscountNote: sanitizeMojibake(item.seniorDiscountNote || item.senior_discount_note || ''),
    seniorFriendly: Boolean(item.seniorFriendly || item.senior_friendly),
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
      if (!customPriceLabel || minAvailable !== finalPrice) {
        res.priceLabel = minAvailable === 0 ? "Free ($0)" : `$${minAvailable.toFixed(2)} CAD`;
      }
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

// Asynchronously load central reference data feed (uses slim js/data.js by default to avoid redundant 14MB+ fetches)
async function loadCentralReference() {
  const urlParams = new URLSearchParams(window.location.search);
  const isCuratorParam = urlParams.get('curator') === '1';
  const forceFresh = urlParams.get('fresh') === '1';

  let loadedEvents = null;
  let updatedAt = null;

  // 1. Only fetch full data/events.json when js/data.js is unavailable or curator/fresh override is requested
  const needsEventsFetch = isCuratorParam || forceFresh || !Array.isArray(ALL_EVENTS) || ALL_EVENTS.length === 0;
  if (needsEventsFetch) {
    try {
      const res = await fetch(`data/events.json?v=8.1.2${forceFresh ? `&t=${Date.now()}` : ''}`, forceFresh ? { cache: 'no-store' } : {});
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
      window._activeCatalogCache = null;
      if (updatedAt) {
        state.updatedAt = updatedAt;
        showSyncTimestamp(updatedAt, loadedEvents.length);
      }
      window._festivalSpotlightSig = null;
      renderFestivalSpotlight();
      applyFiltersAndRender();
      hydrateDeepLinksFromUrl();
    }
  }

  // 2. Load lightweight festivals.json (re-renders spotlight only if pending/rejected status changes)
  try {
    const fRes = await fetch('data/festivals.json?v=8.1.2');
    if (fRes.ok) {
      const fList = await fRes.json();
      if (Array.isArray(fList)) {
        window.FESTIVALS = fList;
        window._festivalSpotlightSig = null;
        renderFestivalSpotlight();
      }
    }
  } catch (e) { }

  // 3. Curator-only payloads: only fetch venues.json (1MB+) and manual_review_queue.json when ?curator=1 is active
  if (isCuratorParam) {
    try {
      const vRes = await fetch(`data/venues.json?v=8.1.2&t=${Date.now()}`, { cache: 'no-store' });
      if (vRes.ok) {
        const vList = await vRes.json();
        if (Array.isArray(vList)) {
          window.VENUES = vList;
          window.VENUES_MASTER = vList;
        }
      }
    } catch (e) { }

    try {
      const rqRes = await fetch('data/manual_review_queue.json?v=8.1.2');
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
  // Accessibility Mode Toggle (Top Header: Step-Free / Accessible + Accessible Display Mode)
  const accessBtn = document.getElementById('accessibility-btn');
  if (accessBtn) {
    accessBtn.addEventListener('click', () => {
      toggleAccessibilityMode();
      state.accessibleOnly = Boolean(state.accessibleMode);
      applyFiltersAndRender();
      window.trackAnonymousEvent('preference/accessible-mode', 'Toggle Accessible Mode');
    });
  }

  // Delegated listener for Outbound Ticket & Event Link clicks + CSP-safe data-action dispatch
  function dispatchDataAction(actionEl, e) {
    if (!actionEl) return false;
    const action = actionEl.getAttribute('data-action');
    if (!action) return false;

    switch (action) {
      case 'cycle-theme-box':
        cycleThemeBoxState(actionEl.getAttribute('data-theme-key') || '', e);
        return true;
      case 'toggle-festival-spotlight':
        toggleFestivalDetailsDrawer();
        return true;
      case 'clear-selected-tag':
        clearSelectedTag();
        return true;
      case 'toggle-theme':
        toggleThemeFilter(actionEl.getAttribute('data-theme-key') || '', e);
        return true;
      case 'exclude-theme':
        toggleExcludeTheme(actionEl.getAttribute('data-theme-key') || '', e);
        return true;
      case 'reset-category-search':
        resetCategoryForSearch();
        return true;
      case 'clear-selected-venue':
        clearSelectedVenue();
        return true;
      case 'reset-all-filters':
        resetAllFilters();
        return true;
      case 'clear-date-filter':
        state.dayOfWeek = 'all';
        state.selectedDate = '';
        state.frequency = 'all';
        state.hideDaily = false;
        renderDayPills();
        renderFrequencyPills();
        if (typeof window.renderCalendarDatePicker === 'function') window.renderCalendarDatePicker();
        if (typeof window.syncTopQuickToggles === 'function') window.syncTopQuickToggles();
        applyFiltersAndRender();
        return true;
      case 'view-on-map':
        if (e) e.stopPropagation();
        if (typeof window.viewEventOnMap === 'function') {
          window.viewEventOnMap(actionEl.getAttribute('data-event-id') || '');
        }
        return true;
      case 'filter-category':
        if (e) e.stopPropagation();
        filterByCategory(actionEl.getAttribute('data-cat-id') || 'all');
        return true;
      case 'scroll-time-group':
        smoothScrollToTimeGroup(actionEl.getAttribute('data-group-id') || '', e);
        return true;
      case 'toggle-time-group':
        if (e) e.stopPropagation();
        toggleTimeGroup(actionEl.getAttribute('data-group-key') || '');
        return true;
      case 'toggle-anytime-banner':
        if (e) e.stopPropagation();
        state.anytimeBannerExpanded = !state.anytimeBannerExpanded;
        if (typeof renderEventCards === 'function' && Array.isArray(window.currentFilteredEvents)) {
          renderEventCards(window.currentFilteredEvents);
        } else {
          applyFiltersAndRender();
        }
        return true;
      case 'toggle-admission-tiers':
        toggleAdmissionTiers(
          actionEl.getAttribute('data-bucket-key') || '',
          actionEl.getAttribute('data-event-id') || '',
          e
        );
        return true;
      case 'filter-venue':
        if (e) e.stopPropagation();
        filterByVenue(actionEl.getAttribute('data-venue') || '');
        return true;
      case 'toggle-weekly-hours':
        window.toggleWeeklyHours(actionEl.getAttribute('data-event-id') || '', e, actionEl);
        return true;
      case 'toggle-showings':
        window.toggleShowings(actionEl.getAttribute('data-event-id') || '', e, actionEl);
        return true;
      case 'card-accordion':
        window.toggleMobileCardAccordion(actionEl.getAttribute('data-event-id') || '', e);
        return true;
      case 'open-access-modal':
        if (e) e.stopPropagation();
        if (typeof window.openAccessibilityModal === 'function') {
          window.openAccessibilityModal(actionEl.getAttribute('data-event-id') || '');
        }
        return true;
      case 'share-event':
        window.shareEvent(actionEl.getAttribute('data-event-id') || '', actionEl, e);
        return true;
      case 'copy-event-link':
        window.copyEventLinkOnly(actionEl.getAttribute('data-event-id') || '', actionEl, e);
        return true;
      case 'toggle-save-event':
        if (e) e.stopPropagation();
        window.toggleSaveEvent(actionEl.getAttribute('data-event-id') || '');
        return true;
      case 'toggle-saved-expand':
        window.toggleSavedCardExpand(actionEl.getAttribute('data-event-id') || '', e);
        return true;
      case 'toggle-map-card':
        if (typeof window.toggleMapInfoWindowCard === 'function') {
          window.toggleMapInfoWindowCard(actionEl, e);
        }
        return true;
      case 'save-shared-plan':
        window.saveSharedPlanToMyList(actionEl);
        return true;
      case 'clear-shared-plan':
        window.clearSharedPlanView();
        return true;
      case 'set-event-focus':
        window.setEventFocusFilter(actionEl.getAttribute('data-focus-mode') || 'all');
        return true;
      case 'dismiss-filter-chip':
        window.dismissSecondaryFilterChip(actionEl.getAttribute('data-chip-key') || '');
        return true;
      default:
        return false;
    }
  }

  document.addEventListener('click', (e) => {
    const blockedAnchor = e.target.closest('a[target="_blank"]');
    if (blockedAnchor && blockedAnchor.getAttribute('href') === '#') {
      e.preventDefault();
      return;
    }

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

    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      dispatchDataAction(actionEl, e);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const roleBtn = e.target.closest('[role="button"][data-action]');
    if (roleBtn && roleBtn === e.target) {
      e.preventDefault();
      dispatchDataAction(roleBtn, e);
    }
  });

  const resetTopBtn = document.getElementById('btn-reset-filters-top');
  if (resetTopBtn) {
    resetTopBtn.addEventListener('click', resetAllFilters);
  }
  const sharePlanBtnEl = document.getElementById('share-plan-btn');
  if (sharePlanBtnEl) {
    sharePlanBtnEl.addEventListener('click', () => {
      if (typeof window.shareOutingPlan === 'function') window.shareOutingPlan(sharePlanBtnEl);
    });
  }
  const copyPlanLinkBtnEl = document.getElementById('copy-plan-link-btn');
  if (copyPlanLinkBtnEl) {
    copyPlanLinkBtnEl.addEventListener('click', () => {
      if (typeof window.copyOutingPlanLinkOnly === 'function') window.copyOutingPlanLinkOnly(copyPlanLinkBtnEl);
    });
  }
  const clearPlanBtnEl = document.getElementById('clear-plan-btn');
  if (clearPlanBtnEl) {
    clearPlanBtnEl.addEventListener('click', () => {
      if (typeof window.clearSavedEvents === 'function') window.clearSavedEvents();
    });
  }

  // Search input & interactive controls
  const searchInput = document.getElementById('search-input');
  const clearSearchBtn = document.getElementById('btn-clear-search');
  const tipsToggleBtn = document.getElementById('btn-search-tips-toggle');
  const tipsPopover = document.getElementById('search-tips-popover');
  const closeTipsBtn = document.getElementById('btn-close-tips');

  function updateClearBtnVisibility() {
    const hasQuery = Boolean(searchInput && searchInput.value.trim().length > 0);
    if (clearSearchBtn) {
      clearSearchBtn.style.display = hasQuery ? 'inline-flex' : 'none';
    }
    const searchWrapperEl = searchInput ? searchInput.closest('.search-wrapper') : null;
    if (searchWrapperEl) {
      searchWrapperEl.classList.toggle('has-query', hasQuery);
    }
  }

  if (searchInput) {
    const _urlParams = new URLSearchParams(window.location.search);
    const _qParam = _urlParams.get('search') || _urlParams.get('q');
    if (_qParam) {
      const cleanQ = String(_qParam).trim().slice(0, 200);
      searchInput.value = cleanQ;
      state.searchQuery = cleanQ;
      updateClearBtnVisibility();
    }

    const _catParam = _urlParams.get('category') || _urlParams.get('cat');
    if (_catParam) {
      const cleanCat = String(_catParam).trim().toLowerCase().slice(0, 40);
      if (ALLOWED_URL_CATEGORIES.has(cleanCat)) {
        state.category = cleanCat;
      }
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

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.target.blur();
      }
    });

    searchInput.addEventListener('search', (e) => {
      state.searchQuery = e.target.value.trim();
      updateClearBtnVisibility();
      applyFiltersAndRender();
    });

    let _searchDebounceTimer = null;
    searchInput.addEventListener('input', (e) => {
      const nextQ = e.target.value.trim();
      state.searchQuery = nextQ;
      updateClearBtnVisibility();
      clearTimeout(_searchDebounceTimer);
      // Clearing search renders immediately; 1-char typing waits for 2nd char (or Enter) to avoid wasted full-catalog rebuilds
      if (nextQ.length === 0) {
        applyFiltersAndRender();
        return;
      }
      if (nextQ.length === 1 && !nextQ.startsWith('#') && !nextQ.startsWith('"')) {
        return;
      }
      _searchDebounceTimer = setTimeout(() => {
        applyFiltersAndRender();
      }, 220);
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
  window.applySearchSample = function (sampleQuery) {
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
    let _sliderDebounceTimer = null;
    const scheduleSliderFilterRender = () => {
      clearTimeout(_sliderDebounceTimer);
      _sliderDebounceTimer = setTimeout(() => {
        applyFiltersAndRender();
      }, 100);
    };
    const flushSliderFilterRender = () => {
      clearTimeout(_sliderDebounceTimer);
      applyFiltersAndRender();
    };

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
      scheduleSliderFilterRender();
    });
    minSlider.addEventListener('change', flushSliderFilterRender);

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
      scheduleSliderFilterRender();
    });
    maxSlider.addEventListener('change', flushSliderFilterRender);
  }

  // Quick Cost Presets (All <= $50, Free $0, Under $15, Under $30)
  const quickButtons = document.querySelectorAll('.cost-quick-btn');
  quickButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      quickButtons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-pressed', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
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
      } else if (preset === 'under30') {
        state.minBudget = 0;
        state.maxBudget = 30;
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
      if (typeof window.syncTopQuickToggles === 'function') window.syncTopQuickToggles();
      applyFiltersAndRender();
    });
  });

  // Top Quick-Bar Toggles (Outside Filter Dropdown: "Paid Only", "Free Only" & "Hide Anytime Drop-Ins")
  const topTogglePaid = document.getElementById('top-toggle-paid');
  if (topTogglePaid) {
    topTogglePaid.addEventListener('click', () => {
      const isPaidCurrentlyActive = state.minBudget >= 1 && state.maxBudget === 50;
      if (isPaidCurrentlyActive) {
        state.minBudget = 0;
        state.maxBudget = 50;
      } else {
        state.minBudget = 1;
        state.maxBudget = 50;
      }
      if (minSlider) minSlider.value = state.minBudget;
      if (maxSlider) maxSlider.value = state.maxBudget;
      updateSliderVisuals();
      if (typeof window.syncTopQuickToggles === 'function') window.syncTopQuickToggles();
      applyFiltersAndRender();
    });
  }

  const topToggleFree = document.getElementById('top-toggle-free');
  if (topToggleFree) {
    topToggleFree.addEventListener('click', () => {
      const isFreeCurrentlyActive = state.minBudget === 0 && state.maxBudget === 0;
      if (isFreeCurrentlyActive) {
        state.minBudget = 0;
        state.maxBudget = 50;
      } else {
        state.minBudget = 0;
        state.maxBudget = 0;
      }
      if (minSlider) minSlider.value = state.minBudget;
      if (maxSlider) maxSlider.value = state.maxBudget;
      updateSliderVisuals();
      if (typeof window.syncTopQuickToggles === 'function') window.syncTopQuickToggles();
      applyFiltersAndRender();
    });
  }

  const topToggleHideDaily = document.getElementById('top-toggle-hide-daily');
  if (topToggleHideDaily) {
    topToggleHideDaily.addEventListener('click', () => {
      state.hideDaily = !state.hideDaily;
      if (state.hideDaily && state.frequency === 'daily') {
        state.frequency = 'all';
        renderFrequencyPills();
      }
      if (typeof window.syncTopQuickToggles === 'function') window.syncTopQuickToggles();
      applyFiltersAndRender();
    });
  }

  // Legacy Scheduled Only Checkbox fallback (if present)
  const hideDailyToggle = document.getElementById('hide-daily-toggle');
  if (hideDailyToggle) {
    hideDailyToggle.addEventListener('change', (e) => {
      state.hideDaily = e.target.checked;
      if (typeof window.syncTopQuickToggles === 'function') window.syncTopQuickToggles();
      applyFiltersAndRender();
    });
  }

  // Drawer Discounts & 55+ and Event Preferences Toggles
  window.syncDrawerAccessToggles = function () {
    const seniorBtn = document.getElementById('toggle-senior-deals');
    if (seniorBtn) {
      const isSenior = Boolean(state.seniorDealsOnly);
      seniorBtn.classList.toggle('active', isSenior);
      seniorBtn.setAttribute('aria-pressed', isSenior ? 'true' : 'false');
    }
    const religiousBtn = document.getElementById('toggle-include-religious');
    if (religiousBtn) {
      const isIncluded = state.includeReligious !== false;
      religiousBtn.classList.toggle('active', isIncluded);
      religiousBtn.setAttribute('aria-pressed', isIncluded ? 'true' : 'false');
    }
  };

  const toggleSeniorDealsBtn = document.getElementById('toggle-senior-deals');
  if (toggleSeniorDealsBtn) {
    toggleSeniorDealsBtn.addEventListener('click', () => {
      state.seniorDealsOnly = !state.seniorDealsOnly;
      window.syncDrawerAccessToggles();
      applyFiltersAndRender();
    });
  }

  const toggleIncludeReligiousBtn = document.getElementById('toggle-include-religious');
  if (toggleIncludeReligiousBtn) {
    toggleIncludeReligiousBtn.addEventListener('click', () => {
      state.includeReligious = state.includeReligious === false ? true : false;
      window.syncDrawerAccessToggles();
      applyFiltersAndRender();
    });
  }

  // View Switcher (Cards vs Map) — Binds ALL view switcher buttons across PC & Mobile
  const eventsGrid = document.getElementById('events-grid');
  const mapWrapper = document.getElementById('map-view-wrapper');
  let currentView = 'cards';
  let pushedMapHistory = false;
  let lastCardsScrollY = 0;
  let isTopToolbarIntersecting = true;
  window._currentCatalogView = currentView;

  const mapSvgIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>';
  const desktopSplitMql = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 1024px)') : null;
  const finePointerMql = typeof window.matchMedia === 'function' ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;

  function isDesktopSplitViewport() {
    return desktopSplitMql ? desktopSplitMql.matches : (window.innerWidth >= 1024);
  }

  function syncTopMapToggleLabel(btn, isMap) {
    if (!btn) return;
    const isDesktop = isDesktopSplitViewport();
    if (isDesktop) {
      btn.innerHTML = `${mapSvgIcon}<span>Split Map</span>`;
      btn.setAttribute('aria-label', isMap ? 'Hide Split Map' : 'Open Split Map');
    } else {
      btn.innerHTML = isMap ? '<span>← List View</span>' : `${mapSvgIcon}<span>Map</span>`;
      btn.setAttribute('aria-label', isMap ? 'Return to List View' : 'Switch to Map view');
    }
    btn.classList.toggle('active', isMap);
    btn.setAttribute('aria-pressed', isMap ? 'true' : 'false');
  }

  function buildViewUrl(targetView) {
    try {
      const url = new URL(window.location.href);
      if (targetView === 'map') {
        url.searchParams.set('view', 'map');
      } else {
        url.searchParams.delete('view');
      }
      return url.pathname + url.search + url.hash;
    } catch (_) {
      return targetView === 'map' ? '?view=map' : window.location.pathname;
    }
  }

  window.updateFloatingMapReturnPill = function () {
    const floatingBtn = document.getElementById('mobile-view-toggle');
    if (!floatingBtn) return;
    if (currentView === 'map') {
      const count = Array.isArray(window._pendingMapFilteredEvents)
        ? window._pendingMapFilteredEvents.length
        : (document.querySelectorAll('#events-grid .event-card').length || 0);
      floatingBtn.hidden = false;
      floatingBtn.removeAttribute('hidden');
      floatingBtn.classList.remove('is-top-visible');
      floatingBtn.classList.add('is-map-return-pill', 'active');
      floatingBtn.setAttribute('aria-pressed', 'true');
      floatingBtn.setAttribute('aria-label', `Show Event List (${count})`);
      floatingBtn.innerHTML = `<span>← Show Event List (${count})</span>`;
    } else {
      floatingBtn.classList.remove('is-map-return-pill', 'active');
      floatingBtn.classList.toggle('is-top-visible', isTopToolbarIntersecting);
      floatingBtn.setAttribute('aria-pressed', 'false');
      floatingBtn.setAttribute('aria-label', 'Switch to Map view');
      floatingBtn.innerHTML = `${mapSvgIcon}<span>Map</span>`;
    }
  };

  window.setCatalogViewMode = function (mode, opts = {}) {
    if (!eventsGrid || !mapWrapper) return;
    const targetView = mode === 'map' ? 'map' : 'cards';
    const isMap = targetView === 'map';
    const isDesktopSplit = isDesktopSplitViewport();
    const fromPopState = Boolean(opts && opts.fromPopState);
    const skipHistory = Boolean(opts && opts.skipHistory);
    const mainContainer = document.querySelector('main.container');
    const workspaceSection = document.getElementById('events-workspace-section');

    // History Stack Management (synchronous inside user click handler for iOS Safari / Android Chrome swipe-back)
    if (isMap && currentView !== 'map') {
      lastCardsScrollY = window.scrollY || window.pageYOffset || 0;
      if (!fromPopState && !skipHistory && typeof history !== 'undefined' && typeof history.pushState === 'function') {
        try {
          history.pushState({ view: 'map' }, '', buildViewUrl('map'));
          pushedMapHistory = true;
        } catch (_) { }
      }
    } else if (!isMap && currentView === 'map') {
      if (!fromPopState && !skipHistory) {
        if (pushedMapHistory && typeof history !== 'undefined' && typeof history.back === 'function') {
          try {
            history.back();
            return;
          } catch (_) { }
        } else if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
          try {
            history.replaceState({ view: 'cards' }, '', buildViewUrl('cards'));
          } catch (_) { }
        }
      }
    }

    currentView = targetView;
    window._currentCatalogView = currentView;

    const allToggleButtons = document.querySelectorAll('[aria-label="View Switcher"] button, .view-switcher-btn, .inline-view-mode-btn, #mobile-view-toggle, #mobile-top-map-btn, [data-view], [data-switch-view]');
    allToggleButtons.forEach((btn) => {
      if (btn.id === 'mobile-view-toggle') {
        return; // Handled unconditionally by updateFloatingMapReturnPill()
      }
      if (btn.id === 'mobile-top-map-btn' || btn.getAttribute('data-view') === 'toggle') {
        syncTopMapToggleLabel(btn, isMap);
        return;
      }
      if (btn.hasAttribute('data-switch-view')) {
        return;
      }
      const btnMode = btn.getAttribute('data-view')
        || btn.getAttribute('data-view-mode')
        || (btn.id === 'view-map-btn' || /map/i.test(btn.textContent) ? 'map' : 'cards');
      const isBtnActive = btnMode === targetView;
      btn.classList.toggle('active', isBtnActive);
      btn.setAttribute('aria-pressed', isBtnActive ? 'true' : 'false');
    });

    if (!isMap) {
      if (mainContainer) mainContainer.classList.remove('is-split-map');
      if (workspaceSection) workspaceSection.classList.remove('is-split-map');
      eventsGrid.classList.remove('is-hidden');
      eventsGrid.removeAttribute('hidden');
      eventsGrid.style.setProperty('display', 'grid', 'important');
      mapWrapper.classList.remove('active');
      mapWrapper.classList.add('is-hidden');
      mapWrapper.setAttribute('hidden', '');
      mapWrapper.style.setProperty('display', 'none', 'important');
      if (typeof window.clearEventMarkerHighlightOnMap === 'function') {
        window.clearEventMarkerHighlightOnMap();
      }
    } else {
      if (isDesktopSplit) {
        if (mainContainer) mainContainer.classList.add('is-split-map');
        if (workspaceSection) workspaceSection.classList.add('is-split-map');
        eventsGrid.classList.remove('is-hidden');
        eventsGrid.removeAttribute('hidden');
        eventsGrid.style.setProperty('display', 'grid', 'important');
        mapWrapper.classList.remove('is-hidden');
        mapWrapper.removeAttribute('hidden');
        mapWrapper.classList.add('active');
        mapWrapper.style.setProperty('display', 'flex', 'important');
      } else {
        if (mainContainer) mainContainer.classList.remove('is-split-map');
        if (workspaceSection) workspaceSection.classList.remove('is-split-map');
        eventsGrid.classList.add('is-hidden');
        eventsGrid.setAttribute('hidden', '');
        eventsGrid.style.setProperty('display', 'none', 'important');
        mapWrapper.classList.remove('is-hidden');
        mapWrapper.removeAttribute('hidden');
        mapWrapper.classList.add('active');
        mapWrapper.style.setProperty('display', 'block', 'important');
      }

      if (typeof initVancouverMap === 'function') {
        initVancouverMap();
      }
      if (window._mapMarkersDirty && typeof updateMapMarkers === 'function' && Array.isArray(window._pendingMapFilteredEvents)) {
        window._mapMarkersDirty = false;
        updateMapMarkers(window._pendingMapFilteredEvents);
      }
      requestAnimationFrame(() => {
        if (typeof invalidateVancouverMap === 'function') {
          invalidateVancouverMap();
        }
      });
    }

    window.updateFloatingMapReturnPill();

    if (typeof window.updateScrollDateIndicator === 'function') {
      window.updateScrollDateIndicator();
    }
  };

  // Sync top Map / Split Map button label on initial load & across 1024px breakpoint resizes
  syncTopMapToggleLabel(document.getElementById('mobile-top-map-btn'), currentView === 'map');
  if (desktopSplitMql) {
    const handleDesktopSplitBreakpointChange = () => {
      syncTopMapToggleLabel(document.getElementById('mobile-top-map-btn'), currentView === 'map');
      if (currentView === 'map') {
        window.setCatalogViewMode('map', { skipHistory: true });
      }
    };
    if (typeof desktopSplitMql.addEventListener === 'function') {
      desktopSplitMql.addEventListener('change', handleDesktopSplitBreakpointChange);
    } else if (typeof desktopSplitMql.addListener === 'function') {
      desktopSplitMql.addListener(handleDesktopSplitBreakpointChange);
    }
  }

  // Desktop Card Hover -> Map Pin Highlight (only on fine-pointer hover devices when Split Map is active)
  if (eventsGrid) {
    let lastHoveredEventId = null;
    eventsGrid.addEventListener('mouseover', (e) => {
      if (currentView !== 'map' || !isDesktopSplitViewport()) return;
      if (finePointerMql && !finePointerMql.matches) return;
      const cardEl = e.target && typeof e.target.closest === 'function' ? e.target.closest('.event-card[data-event-id]') : null;
      const nextId = cardEl ? cardEl.getAttribute('data-event-id') : null;
      if (nextId === lastHoveredEventId) return;
      lastHoveredEventId = nextId;
      if (nextId && typeof window.highlightEventMarkerOnMap === 'function') {
        window.highlightEventMarkerOnMap(nextId);
      } else if (!nextId && typeof window.clearEventMarkerHighlightOnMap === 'function') {
        window.clearEventMarkerHighlightOnMap();
      }
    });
    eventsGrid.addEventListener('mouseleave', () => {
      if (!lastHoveredEventId) return;
      lastHoveredEventId = null;
      if (typeof window.clearEventMarkerHighlightOnMap === 'function') {
        window.clearEventMarkerHighlightOnMap();
      }
    });
  }

  window.bindAllViewSwitcherButtons = function () {
    const allButtons = document.querySelectorAll('[aria-label="View Switcher"] button, .view-switcher-btn, .inline-view-mode-btn, #mobile-view-toggle, #mobile-top-map-btn, [data-view], [data-switch-view]');
    allButtons.forEach((btn) => {
      if (btn._van50ViewSwitcherBound) return;
      btn._van50ViewSwitcherBound = true;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const explicitSwitch = btn.getAttribute('data-switch-view');
        if (explicitSwitch) {
          window.setCatalogViewMode(explicitSwitch === 'map' ? 'map' : 'cards');
          return;
        }
        if (btn.id === 'mobile-view-toggle' || btn.id === 'mobile-top-map-btn' || btn.getAttribute('data-view') === 'toggle') {
          window.setCatalogViewMode(currentView === 'map' ? 'cards' : 'map');
          return;
        }
        const targetMode = btn.getAttribute('data-view')
          || btn.getAttribute('data-view-mode')
          || (btn.id === 'view-map-btn' || /map/i.test(btn.textContent) ? 'map' : 'cards');
        window.setCatalogViewMode(targetMode);
      });
    });
  };

  window.bindAllViewSwitcherButtons();

  // Clicking the Van50 header logo while in Map Mode returns to Cards View
  const brandHomeLink = document.getElementById('brand-home-link');
  if (brandHomeLink && !brandHomeLink._van50MapReturnBound) {
    brandHomeLink._van50MapReturnBound = true;
    brandHomeLink.addEventListener('click', (e) => {
      if (currentView === 'map') {
        e.preventDefault();
        window.setCatalogViewMode('cards');
      }
    });
  }

  // Surprise Outing Roulette is wired via #btn-open-roulette in js/roulette.js

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

  // Mobile Swipe-Back History Guard for Overlays (Filters Drawer, Saved Events Drawer, Suggest / Report Modal) & Map View
  let _activeHistoryOverlay = null;
  let _isHandlingPopState = false;

  window.pushOverlayHistoryState = function (overlayName) {
    if (!overlayName || typeof history === 'undefined' || typeof history.pushState !== 'function') return;
    if (_activeHistoryOverlay === overlayName) return;
    _activeHistoryOverlay = overlayName;
    try {
      const currentHref = window.location.pathname + window.location.search + window.location.hash;
      history.pushState({ view: currentView, uiOverlay: overlayName }, '', currentHref);
    } catch (_) { }
  };

  window.popOverlayHistoryState = function (overlayName, fromPopState = false) {
    if (_activeHistoryOverlay === overlayName) {
      _activeHistoryOverlay = null;
      if (!fromPopState && !_isHandlingPopState && history.state && history.state.uiOverlay === overlayName) {
        try {
          history.back();
        } catch (_) { }
      }
    }
  };

  window.addEventListener('popstate', (e) => {
    if (_activeHistoryOverlay) {
      const closing = _activeHistoryOverlay;
      _isHandlingPopState = true;
      _activeHistoryOverlay = null;
      try {
        if (closing === 'filters' && typeof window.closeMobileFiltersSheet === 'function') {
          window.closeMobileFiltersSheet(true);
        } else if (closing === 'saved' && typeof window.closeItineraryDrawer === 'function') {
          window.closeItineraryDrawer(true);
        } else if (closing === 'suggest_report' && typeof window.closeSuggestReportModal === 'function') {
          window.closeSuggestReportModal(true);
        }
      } finally {
        _isHandlingPopState = false;
      }
      return;
    }

    const poppedView = e && e.state ? e.state.view : null;
    if (currentView === 'map' && poppedView !== 'map') {
      pushedMapHistory = false;
      window.setCatalogViewMode('cards', { fromPopState: true });
      try {
        window.scrollTo({ top: lastCardsScrollY, behavior: 'instant' });
      } catch (_) {
        window.scrollTo(0, lastCardsScrollY);
      }
    } else if (currentView === 'cards' && poppedView === 'map') {
      pushedMapHistory = true;
      window.setCatalogViewMode('map', { fromPopState: true });
    }
  });

  // View Event on Map Helper (switches to Map View / Desktop Split Map, pans/zooms to zoom 15, opens InfoWindow)
  window.viewEventOnMap = function (eventId) {
    if (!eventId) return;
    window.setCatalogViewMode('map');
    if (!isDesktopSplitViewport()) {
      const mapWrapperEl = document.getElementById('map-view-wrapper');
      if (mapWrapperEl) {
        mapWrapperEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
    setTimeout(() => {
      if (typeof window.focusEventOnMap === 'function') {
        window.focusEventOnMap(eventId);
      }
    }, 180);
  };

  // Deduplicate Floating Map Button via IntersectionObserver on Top Search/Filter Toolbar (ONLY in Cards View)
  const topSearchToolbar = document.getElementById('mobile-search-filter-bar');
  const floatingMapBtn = document.getElementById('mobile-view-toggle');
  if (topSearchToolbar && floatingMapBtn && typeof IntersectionObserver === 'function') {
    const mapBtnObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        isTopToolbarIntersecting = entry.isIntersecting;
        if (currentView === 'cards') {
          floatingMapBtn.classList.toggle('is-top-visible', entry.isIntersecting);
        } else {
          floatingMapBtn.classList.remove('is-top-visible');
          floatingMapBtn.hidden = false;
        }
      });
    }, { threshold: 0.05 });
    mapBtnObserver.observe(topSearchToolbar);
  }

  // Support direct landing on shared ?view=map URL (without pushing extra history)
  try {
    if (new URLSearchParams(window.location.search).get('view') === 'map') {
      pushedMapHistory = false;
      setTimeout(() => {
        window.setCatalogViewMode('map', { skipHistory: true });
      }, 0);
    }
  } catch (_) { }

  // Itinerary Drawer Handlers
  const itineraryBtn = document.getElementById('itinerary-btn');
  const closeItineraryBtn = document.getElementById('close-itinerary-btn');
  const drawer = document.getElementById('itinerary-drawer');
  const copyPlanBtn = document.getElementById('copy-plan-btn');

  window.openItineraryDrawer = function () {
    if (!drawer) return;
    drawer.classList.add('active');
    drawer.setAttribute('aria-hidden', 'false');
    drawer.removeAttribute('inert');
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';
    renderItinerary();
    window.pushOverlayHistoryState('saved');
  };

  window.closeItineraryDrawer = function (fromPopState = false) {
    if (!drawer) return;
    const wasOpen = drawer.classList.contains('active');
    drawer.classList.remove('active');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('inert', '');
    const filtersOpen = document.getElementById('mobile-filters-sheet')?.classList.contains('active');
    if (!filtersOpen) {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    if (wasOpen) window.popOverlayHistoryState('saved', fromPopState);
  };

  if (itineraryBtn && drawer) {
    itineraryBtn.addEventListener('click', () => window.openItineraryDrawer());
  }

  if (closeItineraryBtn && drawer) {
    closeItineraryBtn.addEventListener('click', () => window.closeItineraryDrawer(false));
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

  const mobileBreakpointMql = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 768px)') : null;

  window.syncSecondaryFiltersA11y = function () {
    if (!mobileFiltersSheet) return;
    const isOpen = mobileFiltersSheet.classList.contains('is-open');
    if (!isOpen) {
      mobileFiltersSheet.setAttribute('aria-hidden', 'true');
      mobileFiltersSheet.setAttribute('inert', '');
      mobileFiltersSheet.inert = true;
    } else {
      mobileFiltersSheet.removeAttribute('aria-hidden');
      mobileFiltersSheet.removeAttribute('inert');
      mobileFiltersSheet.inert = false;
    }
  };

  function positionDesktopFiltersPopover() {
    if (!mobileFiltersSheet || !mobileFilterTrigger) return;
    if (!isDesktopSplitViewport()) {
      mobileFiltersSheet.style.removeProperty('--desktop-filters-top');
      mobileFiltersSheet.style.removeProperty('--desktop-filters-left');
      return;
    }
    const rect = mobileFilterTrigger.getBoundingClientRect();
    const popoverWidth = Math.min(560, Math.round(window.innerWidth * 0.92));
    const top = Math.max(64, Math.min(Math.round(rect.bottom + 8), Math.max(64, window.innerHeight - 240)));
    const left = Math.max(16, Math.min(Math.round(rect.left), Math.max(16, window.innerWidth - popoverWidth - 16)));
    mobileFiltersSheet.style.setProperty('--desktop-filters-top', `${top}px`);
    mobileFiltersSheet.style.setProperty('--desktop-filters-left', `${left}px`);
  }

  window.openMobileFiltersSheet = function () {
    positionDesktopFiltersPopover();
    if (mobileFiltersSheet) mobileFiltersSheet.classList.add('is-open');
    if (mobileSheetBackdrop) mobileSheetBackdrop.classList.add('is-open');
    if (mobileFilterTrigger) mobileFilterTrigger.setAttribute('aria-expanded', 'true');
    if (morePanel) {
      morePanel.style.display = 'flex';
      morePanel.classList.add('active');
      if (toggleMoreBtn) {
        toggleMoreBtn.classList.add('active');
        toggleMoreBtn.setAttribute('aria-expanded', 'true');
      }
    }
    window.syncSecondaryFiltersA11y();
    window.pushOverlayHistoryState('filters');
  };

  window.closeMobileFiltersSheet = function (fromPopState = false) {
    const wasOpen = Boolean(mobileFiltersSheet && mobileFiltersSheet.classList.contains('is-open'));
    if (mobileFiltersSheet) mobileFiltersSheet.classList.remove('is-open');
    if (mobileSheetBackdrop) mobileSheetBackdrop.classList.remove('is-open');
    if (mobileFilterTrigger) mobileFilterTrigger.setAttribute('aria-expanded', 'false');
    window.syncSecondaryFiltersA11y();
    if (wasOpen) window.popOverlayHistoryState('filters', fromPopState);
  };

  function isTypingInFormField(target) {
    if (!target) return false;
    const tag = String(target.tagName || '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return Boolean(typeof target.closest === 'function' && target.closest('[contenteditable="true"], [contenteditable=""]'));
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (mobileFiltersSheet && mobileFiltersSheet.classList.contains('is-open')) {
        window.closeMobileFiltersSheet(false);
        return;
      }
      const drawerOpen = Boolean(drawer && drawer.classList.contains('active'));
      if (drawerOpen && typeof window.closeItineraryDrawer === 'function') {
        window.closeItineraryDrawer(false);
        return;
      }
      const srModal = document.getElementById('suggest-report-modal');
      const srOpen = Boolean(srModal && srModal.classList.contains('active'));
      if (srOpen) {
        if (typeof window.closeSuggestReportModal === 'function') {
          window.closeSuggestReportModal(false);
        }
        return;
      }
      if (!_activeHistoryOverlay && currentView === 'map') {
        if (typeof window.closeActiveMapInfoWindow === 'function' && window.closeActiveMapInfoWindow()) {
          return;
        }
        window.setCatalogViewMode('cards');
      }
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey || isTypingInFormField(e.target)) return;

    if (e.key === '/') {
      const searchEl = document.getElementById('search-input');
      if (searchEl) {
        e.preventDefault();
        searchEl.focus();
        if (typeof searchEl.select === 'function') searchEl.select();
      }
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      window.setCatalogViewMode(currentView === 'map' ? 'cards' : 'map');
    }
  });

  if (mobileBreakpointMql) {
    if (typeof mobileBreakpointMql.addEventListener === 'function') {
      mobileBreakpointMql.addEventListener('change', window.syncSecondaryFiltersA11y);
    } else if (typeof mobileBreakpointMql.addListener === 'function') {
      mobileBreakpointMql.addListener(window.syncSecondaryFiltersA11y);
    }
  }
  window.addEventListener('resize', () => {
    window.syncSecondaryFiltersA11y();
    if (mobileFiltersSheet && mobileFiltersSheet.classList.contains('is-open')) {
      positionDesktopFiltersPopover();
    }
  });
  window.syncSecondaryFiltersA11y();

  window._legacyOpenMobileFiltersSheet = window.openMobileFiltersSheet;

  window.resetSecondaryFilters = function () {
    state.selectedRegions.clear();
    syncRegionStateString();
    renderRegionPills();
    state.category = 'all'; state.selectedThemeFilter = null; if (state.excludedThemes) state.excludedThemes.clear(); state.hideFestivalEvents = false; renderCategoryPills(); renderFestivalSpotlight();
    state.minBudget = 0;
    state.maxBudget = 50;
    state.dayOfWeek = 'all';
    state.selectedDate = '';
    state.frequency = 'all';
    state.hideDaily = false;
    state.accessibleOnly = false;
    if (state.accessibleMode) setAccessibilityMode(false, false);
    state.seniorDealsOnly = false;
    state.includeReligious = true;
    if (minSlider) minSlider.value = 0;
    if (maxSlider) maxSlider.value = 50;
    if (hideDailyToggle) hideDailyToggle.checked = false;
    if (typeof window.syncDrawerAccessToggles === 'function') window.syncDrawerAccessToggles();
    if (typeof window.syncTopQuickToggles === 'function') window.syncTopQuickToggles();
    if (typeof window.renderCalendarDatePicker === 'function') window.renderCalendarDatePicker();
    renderDayPills();
    renderFrequencyPills();
    clearActiveQuickButtons();
    updateSliderVisuals();
    applyFiltersAndRender();
  };

  if (mobileFilterTrigger) {
    mobileFilterTrigger.addEventListener('click', () => {
      if (mobileFiltersSheet && mobileFiltersSheet.classList.contains('is-open')) {
        window.closeMobileFiltersSheet(false);
      } else {
        window.openMobileFiltersSheet();
      }
    });
  }
  if (mobileSheetCloseBtn) mobileSheetCloseBtn.addEventListener('click', () => window.closeMobileFiltersSheet(false));
  if (mobileSheetBackdrop) mobileSheetBackdrop.addEventListener('click', () => window.closeMobileFiltersSheet(false));
  if (mobileSheetApplyBtn) mobileSheetApplyBtn.addEventListener('click', () => window.closeMobileFiltersSheet(false));
  if (mobileSheetResetBtn) mobileSheetResetBtn.addEventListener('click', window.resetSecondaryFilters);

  // Curator Studio link (#btn-open-review-queue) navigates directly to curator-agy.html

  // Global delegation for .btn-suggest-price (routes to Unified Suggest / Report Modal in Price / Status mode)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-suggest-price');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const eventId = btn.getAttribute('data-event-id') || '';
      const vName = btn.getAttribute('data-suggest-venue') || '';
      if (typeof window.openSuggestReportModal === 'function') {
        window.openSuggestReportModal({ mode: 'price_status', eventId, venue: vName });
      }
    }
  });

  window.openPriceFeedbackModal = function (venueName, eventId = '') {
    if (typeof window.openSuggestReportModal === 'function') {
      window.openSuggestReportModal({ mode: 'price_status', eventId, venue: venueName || '' });
    }
  };

  window.closePriceFeedbackModal = function (fromPopState = false) {
    if (typeof window.closeSuggestReportModal === 'function') {
      window.closeSuggestReportModal(fromPopState);
    }
  };
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
  const minVal = state.minBudget;
  const maxVal = state.maxBudget;

  quickButtons.forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  });

  let activeBtn = null;
  if (minVal === 0 && maxVal === 0) {
    activeBtn = document.getElementById('quick-cost-free');
  } else if (minVal === 0 && maxVal === 15) {
    activeBtn = document.getElementById('quick-cost-15');
  } else if (minVal === 0 && maxVal === 30) {
    activeBtn = document.getElementById('quick-cost-30');
  } else if (minVal === 0 && maxVal === 50) {
    activeBtn = document.getElementById('quick-cost-all');
  }
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.setAttribute('aria-pressed', 'true');
  }
  if (typeof window.syncTopQuickToggles === 'function') {
    window.syncTopQuickToggles();
  }
}

window.syncTopQuickToggles = function () {
  const topPaidBtn = document.getElementById('top-toggle-paid');
  const topFreeBtn = document.getElementById('top-toggle-free');
  const topHideDailyBtn = document.getElementById('top-toggle-hide-daily');
  const isPaidOnly = state.minBudget >= 1 && state.maxBudget === 50;
  const isFreeOnly = state.minBudget === 0 && state.maxBudget === 0;
  if (topPaidBtn) {
    topPaidBtn.classList.toggle('active', isPaidOnly);
    topPaidBtn.setAttribute('aria-pressed', isPaidOnly ? 'true' : 'false');
  }
  if (topFreeBtn) {
    topFreeBtn.classList.toggle('active', isFreeOnly);
    topFreeBtn.setAttribute('aria-pressed', isFreeOnly ? 'true' : 'false');
  }
  if (topHideDailyBtn) {
    const isHideDaily = Boolean(state.hideDaily);
    topHideDailyBtn.classList.toggle('active', isHideDaily);
    topHideDailyBtn.setAttribute('aria-pressed', isHideDaily ? 'true' : 'false');
  }
  const legacyHideDailyChk = document.getElementById('hide-daily-toggle');
  if (legacyHideDailyChk) legacyHideDailyChk.checked = Boolean(state.hideDaily);

  // Sync the 5 mutually-exclusive Spend pills inside the Filters drawer as a single source of truth
  let activePreset = null;
  if (state.minBudget === 0 && state.maxBudget === 50) activePreset = 'all';
  else if (state.minBudget === 0 && state.maxBudget === 0) activePreset = 'free';
  else if (state.minBudget === 0 && state.maxBudget === 15) activePreset = 'under15';
  else if (state.minBudget === 0 && state.maxBudget === 30) activePreset = 'under30';
  else if (state.minBudget >= 1 && state.maxBudget === 50) activePreset = 'paid';

  document.querySelectorAll('.cost-quick-btn').forEach(b => {
    const isMatch = Boolean(activePreset && b.dataset.quick === activePreset);
    b.classList.toggle('active', isMatch);
    b.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
  });
};

// ==============================================================================
// 1.5 FESTIVAL & HOLIDAY SPOTLIGHT, TAG CHIPS & EXPANDABLE DETAILS ENGINE
// ==============================================================================

const MERGED_WINTER_ATTRACTION_KEYS = new Set([
  'holiday:winter-holiday-season',
  'holiday:winter-holidays',
  'festival:vancouver-christmas-market',
  'festival:vandusen-festival-of-lights',
  'festival:bright-nights',
  'festival:surrey-tree-lighting-festival-holiday-market'
]);

function eventMatchesThemeKey(ev, themeKey) {
  if (!ev || !themeKey) return false;
  let normalizedTargetKey = (themeKey === 'holiday:diwali') ? 'festival:diwali-fest' : themeKey;
  if (MERGED_WINTER_ATTRACTION_KEYS.has(normalizedTargetKey)) {
    normalizedTargetKey = 'holiday:christmas';
  }
  if (Array.isArray(ev.themeBadges) && ev.themeBadges.some(b => b.key === normalizedTargetKey || b.key === themeKey)) return true;
  const [type, slug] = String(normalizedTargetKey).split(':');
  if (type === 'religious' && (ev.isReligious || ev.is_religious)) return true;
  if (slug === 'diwali-fest' && (String(ev.holidayAffiliation || '').toLowerCase() === 'diwali' || /\bdiwali\b/i.test(String(ev.festivalAffiliation || '')))) return true;
  if (type === 'holiday' && ev.holidayAffiliation) {
    const evHol = String(ev.holidayAffiliation).toLowerCase();
    if (evHol === slug || (slug === 'christmas' && evHol === 'winter-holiday-season')) return true;
  }
  if (slug === 'christmas' && /\b(?:surrey\s*tree\s*lighting|vancouver\s*christmas\s*market|vandusen\s*festival\s*of\s*lights|bright\s*nights)\b/i.test(`${ev.festivalAffiliation || ''} ${ev.title || ''}`)) {
    return true;
  }
  if (type === 'festival' && ev.festivalAffiliation) {
    const fSlug = String(ev.festivalAffiliation).toLowerCase().replace(/\s*\(.*?\)\s*/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (fSlug === slug || fSlug.includes(slug) || slug.includes(fSlug)) return true;
  }
  if (Array.isArray(ev.subTags) && ev.subTags.some(t => String(t).toLowerCase() === normalizedTargetKey || String(t).toLowerCase() === slug)) return true;
  return false;
}

function getActiveThemeGroups(catalog) {
  const now = new Date();
  const groupsMap = new Map();
  (catalog || []).forEach(ev => {
    if (!ev || isEventInPast(ev, now) || isAwaitingSchedule(ev) || parseFloat(ev.price || 0) > 50) return;
    if (Array.isArray(ev.themeBadges)) {
      const seenKeysForEvent = new Set();
      ev.themeBadges.forEach(b => {
        // Option 1: Keep the top banner strictly for Festivals & Holidays; religious badges appear on cards only
        if (!b || b.type === 'religious') return;
        let canonicalKey = (b.key === 'holiday:diwali') ? 'festival:diwali-fest' : b.key;
        if (MERGED_WINTER_ATTRACTION_KEYS.has(canonicalKey)) {
          canonicalKey = 'holiday:christmas';
        }
        if (seenKeysForEvent.has(canonicalKey)) return;
        seenKeysForEvent.add(canonicalKey);
        if (!groupsMap.has(canonicalKey)) {
          const regMeta = (canonicalKey.startsWith('festival:') && window.FESTIVAL_REGISTRY)
            ? window.FESTIVAL_REGISTRY[canonicalKey.slice(9)]
            : (canonicalKey.startsWith('holiday:') && window.HOLIDAY_REGISTRY ? window.HOLIDAY_REGISTRY[canonicalKey.slice(8)] : null);
          groupsMap.set(canonicalKey, {
            ...b,
            key: canonicalKey,
            type: canonicalKey.split(':')[0] || b.type,
            id: canonicalKey.split(':')[1] || b.id,
            label: regMeta?.label || b.label,
            fullLabel: regMeta?.label || b.fullLabel || b.label,
            icon: regMeta?.icon || b.icon,
            count: 0
          });
        }
        groupsMap.get(canonicalKey).count++;
      });
    }
  });

  return Array.from(groupsMap.values());
}

// 8. Automate the Active Vancouver Festivals Banner (3-Tier Urgency Sort)
const THEME_DATE_WINDOWS = {
  'diwali': { startDate: '2026-11-05', endDate: '2026-11-15' },
  'diwali-fest': { startDate: '2026-11-05', endDate: '2026-11-15' },
  'european-union-film-festival': { startDate: '2026-11-13', endDate: '2026-11-26' },
  'lumiere-festival': { startDate: '2026-11-12', endDate: '2026-11-16' },
  'bear-creek-lights': { startDate: '2026-11-01', endDate: '2026-11-15' },
  'cloverdale-rodeo-country-fair': { startDate: '05-15', endDate: '05-18' },
  'surrey-fusion-festival': { startDate: '07-18', endDate: '07-19' },
  'canada-cup-international-softball-championship': { startDate: '07-03', endDate: '07-12' },
  'downtown-eastside-heart-of-the-city-festival': { startDate: '2026-10-30', endDate: '2026-11-08' },
  'christmas': { startDate: '11-13', endDate: '01-03' },
  'winter-holiday-season': { startDate: '11-13', endDate: '01-03' },
  'new-years': { startDate: '12-26', endDate: '01-03' },
  'lunar-new-year': { startDate: '01-25', endDate: '02-20' },
  'valentines-day': { startDate: '02-01', endDate: '02-15' },
  'st-patricks-day': { startDate: '03-10', endDate: '03-18' },
  'easter': { startDate: '03-25', endDate: '04-12' },
  'vaisakhi': { startDate: '04-10', endDate: '04-26' },
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
        urgencyBadge = 'Last Day';
        urgencyClass = 'tier-1-last-day';
      } else if (daysUntilEnd <= 2) {
        urgencyBadge = `Ends in ${daysUntilEnd}d`;
        urgencyClass = 'tier-1-ending-soon';
      } else {
        urgencyBadge = '';
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
  const themeGroups = getSortedActiveFestivals(baseCatalog, now); if (themeGroups.length === 0) { container.style.display = 'none'; return; } container.style.display = 'block'; if (false) {
    if (false) {

      if (themeGroups.length === 0) {
      }
      if (false) {
        container.style.display = 'none';
        return;
      }
    }
    if (false) {

    }
    container.style.display = 'block';
  }
  if (false) {
    container.style.display = 'none';
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

  const isExpanded = Boolean(state.festivalDetailsExpanded);
  const compactChipsHtml = themeGroups.map(g => {
    const meta = getThemeMetadata(g);
    const isSelected = state.selectedThemeFilter === g.key;
    const isExcluded = Boolean(state.excludedThemes && state.excludedThemes.has(g.key));
    const stateAttr = isSelected ? 'only' : (isExcluded ? 'excluded' : 'default');
    const stateBadgeHtml = isSelected
      ? `<span class="theme-state-pill state-only">Only</span>`
      : (isExcluded ? `<span class="theme-state-pill state-hidden">Hidden</span>` : '');
    const boxTitle = isSelected
      ? `Showing only ${meta.label} (${g.count}). Click again to hide from feed.`
      : (isExcluded
        ? `${meta.label} hidden from feed. Click again to reset and include with all outings.`
        : `Click to show only ${meta.label} (${g.count} outings)`);
    return `
      <button
        type="button"
        class="festival-compact-chip ${isSelected ? 'item-row-selected' : ''} ${isExcluded ? 'item-row-excluded' : ''}"
        data-theme-state="${stateAttr}"
        data-action="cycle-theme-box"
        data-theme-key="${escapeHtml(g.key)}"
        aria-pressed="${isSelected ? 'true' : (isExcluded ? 'mixed' : 'false')}"
        title="${escapeHtml(boxTitle)}"
      >
        <span class="festival-chip-name">${escapeHtml(meta.label)}</span>
        <span class="theme-item-count">${Number(g.count) || 0}</span>
        ${stateBadgeHtml}
      </button>
    `;
  }).join('');

  const activeItemsListHtml = (isExpanded && themeGroups.length > 0) ? `
    <div class="festival-active-items-list" role="group" aria-label="Active festivals and holidays">
      ${themeGroups.map(g => {
    const meta = getThemeMetadata(g);
    const isSelected = state.selectedThemeFilter === g.key;
    const isExcluded = Boolean(state.excludedThemes && state.excludedThemes.has(g.key));
    const stateAttr = isSelected ? 'only' : (isExcluded ? 'excluded' : 'default');
    const stateBadgeHtml = isSelected
      ? `<span class="theme-state-pill state-only">Showing Only</span>`
      : (isExcluded ? `<span class="theme-state-pill state-hidden">Hidden</span>` : '');
    const boxTitle = isSelected
      ? `Showing only ${meta.label} (${g.count}). Click again to hide from feed.`
      : (isExcluded
        ? `${meta.label} hidden from feed. Click again to reset and include with all outings.`
        : `Click to show only ${meta.label} (${g.count} outings)`);
    return `
          <button
            type="button"
            class="festival-theme-item-row festival-theme-box-btn ${isSelected ? 'item-row-selected' : ''} ${isExcluded ? 'item-row-excluded' : ''}"
            data-theme-state="${stateAttr}"
            data-action="cycle-theme-box"
            data-theme-key="${escapeHtml(g.key)}"
            aria-pressed="${isSelected ? 'true' : (isExcluded ? 'mixed' : 'false')}"
            title="${escapeHtml(boxTitle)}"
          >
            <div class="theme-box-top-row">
              <strong class="theme-item-name">${escapeHtml(meta.label)}</strong>
              <span class="theme-item-count">(${Number(g.count) || 0})</span>
            </div>
            <div class="theme-item-subrow">
              ${(g.urgencyBadge && !/live\s*now/i.test(g.urgencyBadge)) ? `<span class="festival-urgency-badge ${escapeHtml(g.urgencyClass || '')}">${escapeHtml(g.urgencyBadge)}</span>` : ''}
              ${meta.datesLabel ? `<span class="theme-item-dates-pill">${escapeHtml(meta.datesLabel)}</span>` : ''}
              ${stateBadgeHtml}
            </div>
            ${meta.shortDesc ? `<span class="theme-item-short-desc">${escapeHtml(meta.shortDesc)}</span>` : ''}
          </button>
        `;
  }).join('')}
    </div>
  ` : '';

  const activeThemeSummary = state.selectedThemeFilter
    ? (() => {
        const g = themeGroups.find(x => x.key === state.selectedThemeFilter);
        const m = g ? getThemeMetadata(g) : null;
        return m ? `<span class="festival-summary-active-pill">${escapeHtml(m.label)}</span>` : '';
      })()
    : '';

  container.innerHTML = `
    <div class="festival-spotlight-card festival-compact-banner ${isExpanded ? 'is-expanded' : 'is-collapsed'}">
      <div class="festival-spotlight-left">
        <button type="button" class="festival-summary-bar-btn" data-action="toggle-festival-spotlight" aria-expanded="${isExpanded ? 'true' : 'false'}" title="${isExpanded ? 'Collapse seasonal festivals & holidays' : 'Expand seasonal festivals & holidays'}">
          <span class="festival-summary-bar-left">
            <span class="festival-spotlight-title">Seasonal Festivals &amp; Holidays</span>
            <span class="festival-summary-count">(${Number(themeGroups.length)} active)</span>
            ${activeThemeSummary}
          </span>
          <span class="festival-toggle-chevron" aria-hidden="true">${isExpanded ? '▴' : '▾'}</span>
        </button>
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

function cycleThemeBoxState(themeKey, evObj) {
  if (evObj) {
    evObj.preventDefault();
    evObj.stopPropagation();
  }
  if (!themeKey) return;
  if (!state.excludedThemes) state.excludedThemes = new Set();
  const isSelected = state.selectedThemeFilter === themeKey;
  const isExcluded = state.excludedThemes.has(themeKey);

  if (!isSelected && !isExcluded) {
    // 1st click: Show ONLY events under this festival/holiday
    state.selectedThemeFilter = themeKey;
    state.excludedThemes.delete(themeKey);
    state.hideFestivalEvents = false;
  } else if (isSelected) {
    // 2nd click: Remove (exclude) this festival/holiday's events from the feed
    state.selectedThemeFilter = null;
    state.excludedThemes.add(themeKey);
  } else {
    // 3rd click: Reset so they are included with everything else
    state.excludedThemes.delete(themeKey);
    if (state.selectedThemeFilter === themeKey) {
      state.selectedThemeFilter = null;
    }
  }
  renderFestivalSpotlight();
  applyFiltersAndRender();
}
window.cycleThemeBoxState = cycleThemeBoxState;

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
    pill.innerHTML = `<span class="cat-pill-label">${escapeHtml(displayLabel)}</span>`;
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
  if (typeof renderQuickCategoryStrip === 'function') renderQuickCategoryStrip();
  if (true) {
  }
}

function closeItineraryDrawerIfOpen() {
  const drawer = document.getElementById('itinerary-drawer');
  if (drawer && drawer.classList.contains('active')) {
    drawer.classList.remove('active');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('inert', '');
    const filtersOpen = document.getElementById('mobile-filters-sheet')?.classList.contains('active');
    if (!filtersOpen) {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
  }
}

function filterByCategory(catId) {
  state.sharedPlanIds = null;
  closeItineraryDrawerIfOpen();
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

const QUICK_CATEGORY_ITEMS = [
  { id: 'all', label: 'All' },
  { id: 'music', label: 'Music' },
  { id: 'shows', label: 'Comedy & Stage' },
  { id: 'cinema', label: 'Cinema' },
  { id: 'outdoors', label: 'Outdoors' },
  { id: 'arts', label: 'Arts' },
  { id: 'social', label: 'Social & Games' },
  { id: 'markets', label: 'Markets' },
  { id: 'festivals', label: 'Festivals' },
  { id: 'sports', label: 'Sports' },
  { id: 'academic', label: 'Academic' }
];

function renderQuickCategoryStrip(poolOverride) {
  const strip = document.getElementById('quick-category-strip');
  if (!strip) return;
  const pool = Array.isArray(poolOverride)
    ? poolOverride
    : (Array.isArray(window._lastCategoryCountPool) ? window._lastCategoryCountPool : []);
  const hasPool = Array.isArray(poolOverride) || Array.isArray(window._lastCategoryCountPool);

  strip.innerHTML = '';

  QUICK_CATEGORY_ITEMS.forEach(item => {
    const btn = document.createElement('button');
    btn.type = 'button';
    const isActive = state.category === item.id;
    const count = hasPool
      ? (item.id === 'all'
        ? pool.length
        : pool.filter(ev => doesEventMatchCategory(ev, item.id)).length)
      : null;
    const isZero = hasPool && count === 0;
    btn.className = `quick-cat-pill ${isActive ? 'active' : ''}${isZero ? ' is-empty-cat' : ''}`;
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    if (count !== null) {
      btn.innerHTML = `<span class="quick-cat-label">${escapeHtml(item.label)}</span><span class="quick-cat-count">${Number(count) || 0}</span>`;
    } else {
      btn.textContent = item.label;
    }
    btn.addEventListener('click', () => {
      state.category = (item.id !== 'all' && state.category === item.id) ? 'all' : item.id;
      renderCategoryPills();
      applyFiltersAndRender();
    });
    strip.appendChild(btn);
  });
}
window.renderQuickCategoryStrip = renderQuickCategoryStrip;

function renderDayPills() {
  const container = document.getElementById('days-pills-wrap');
  if (!container || typeof DAYS_OF_WEEK === 'undefined') return;

  container.innerHTML = '';
  if (typeof renderQuickCategoryStrip === 'function') renderQuickCategoryStrip();
  DAYS_OF_WEEK.forEach(day => {
    const pill = document.createElement('button');
    pill.className = `day-pill ${state.dayOfWeek === day.id ? 'active' : ''}`;
    pill.innerHTML = day.icon ? `<span>${escapeHtml(day.icon)}</span> <span>${escapeHtml(day.label)}</span>` : `<span>${escapeHtml(day.label)}</span>`;
    pill.title = day.full || day.label;
    pill.addEventListener('click', () => {
      state.dayOfWeek = day.id;
      renderDayPills();
      applyFiltersAndRender();
    });
    container.appendChild(pill);
  });
}

function resolveCanonicalNeighborhoodCluster(nhStr, evCity) {
  const s = String(nhStr || "").trim().toLowerCase();
  const c = String(evCity || "").trim().toLowerCase();
  const isSurreyCity = c === "surrey" || c === "white rock";
  const isBurnabyCity = c === "burnaby";
  const isRichmondCity = c === "richmond";
  const isNewWestCity = c === "new westminster" || c === "new west" || c === "new-west";
  const isLangleyCity = c === "langley";

  // Dedicated Burnaby clusters
  if (isBurnabyCity || /\bburnaby\b|\bmetrotown\b|\bdeer lake\b|\bbrentwood\b|\blougheed\b|\bedmonds\b|\bsfu\b|\bsimon fraser\b/i.test(s)) {
    if (/brentwood|north burnaby|burnaby heights|capitol hill|willingdon|hastings/i.test(s)) return "Brentwood & North Burnaby";
    if (/lougheed|sfu|simon fraser|burnaby mountain|burquitlam|production way/i.test(s)) return "Lougheed & SFU";
    if (/edmonds|south burnaby|big bend|highgate|marine way|riverway/i.test(s)) return "Edmonds & South Burnaby";
    return "Metrotown & Deer Lake";
  }

  // Dedicated Richmond clusters
  if (isRichmondCity || /\brichmond\b|\bsteveston\b|\bbrighouse\b|\blansdowne\b|\bironwood\b|\bminoru\b|\bterra nova\b/i.test(s)) {
    if (/steveston|garry point|london landing|terra nova/i.test(s)) return "Steveston Village";
    if (/east richmond|ironwood|hamilton|cambie|bridgeport|riverport|silvercity/i.test(s)) return "East Richmond & Ironwood";
    return "City Centre & Brighouse";
  }

  // Dedicated New Westminster clusters
  if (isNewWestCity || /\bnew westminster\b|\bnew west\b|\bsapperton\b|\bqueensborough\b/i.test(s)) {
    if (/queensborough/i.test(s)) return "Queensborough";
    if (/uptown|sapperton|moody park|brow of the hill|massey|glenbrooke|queen'?s park/i.test(s)) return "Uptown & Sapperton";
    return "Downtown & Columbia St";
  }

  // Dedicated Langley clusters
  if (isLangleyCity || /\blangley\b|\bfort langley\b|\bwilloughby\b|\bwalnut grove\b|\bmurrayville\b|\baldergrove\b|\bwillowbrook\b/i.test(s)) {
    if (/fort langley/i.test(s)) return "Fort Langley";
    if (/willoughby|walnut grove|carvolth|yorkson/i.test(s)) return "Willoughby & Walnut Grove";
    if (/murrayville|aldergrove|brookswood|fernridge/i.test(s)) return "Murrayville & Aldergrove";
    return "Langley City & Willowbrook";
  }

  if (/^(?:north vancouver|west vancouver|coquitlam|port coquitlam|port moody|delta|maple ridge|pitt meadows)$/i.test(c)) {
    return "North Shore, Burnaby & Metro";
  }
  if (!s) return isSurreyCity ? "Surrey Central / Whalley" : "Downtown, Gastown & Yaletown";

  // Surrey 6 Town Centres (gated so Coquitlam "City Centre" or Deep Cove "Panorama" never map to Surrey)
  if (isSurreyCity || /surrey central|whalley|guildford|fleetwood|cloverdale|south surrey/i.test(s)) {
    if (/surrey central|whalley|city centre|bridgeview/i.test(s)) return "Surrey Central / Whalley";
    if (/guildford|fraser heights/i.test(s)) return "Guildford";
    if (/fleetwood/i.test(s)) return "Fleetwood";
    if (/newton|bear creek|panorama|sullivan heights/i.test(s)) return "Newton";
    if (/cloverdale|clayton/i.test(s)) return "Cloverdale";
    if (/south surrey|grandview|crescent beach|white rock/i.test(s)) return "South Surrey";
  }

  // Vancouver 6 Neighborhood Clusters
  if (/downtown|gastown|yaletown|chinatown|west end|coal harbour|crosstown|stanley park|davie|robson/i.test(s)) {
    return "Downtown, Gastown & Yaletown";
  }
  if (/mount pleasant|south vancouver|main st|cambie|riley park|marpole|oakridge|kerrisdale|sunset|fraser/i.test(s)) {
    return "Mount Pleasant & South Vancouver";
  }
  if (/commercial|east van|hastings|strathcona|grandview-woodland|renfrew|collingwood|killarney|trout lake/i.test(s)) {
    return "Commercial Drive & East Vancouver";
  }
  if (/kitsilano|point grey|ubc|jericho|spanish banks|dunbar|arbutus|shaughnessy|west side/i.test(s)) {
    return "Kitsilano, Point Grey & UBC";
  }
  if (/granville island|false creek|olympic village|fairview|south granville|senakw/i.test(s)) {
    return "Granville Island & False Creek";
  }
  if (/north shore|north van|west van|coquitlam|port moody|metro/i.test(s)) {
    return "North Shore, Burnaby & Metro";
  }
  return nhStr;
}

function eventMatchesNeighborhoodFilter(ev, selectedSet) {
  if (!selectedSet || selectedSet.size === 0) return true;
  const rawNh = String(ev.neighborhood || "").trim();
  if (selectedSet.has(rawNh)) return true;
  const canonical = resolveCanonicalNeighborhoodCluster(rawNh, ev.city || ev.region);
  if (selectedSet.has(canonical)) return true;
  return false;
}

function setRegionFilter(region) {
  const validRegion = window.normalizeRegionKey(region);
  if (validRegion === 'all') {
    state.selectedRegions.clear();
  } else {
    if (state.selectedRegions.has(validRegion)) {
      state.selectedRegions.delete(validRegion);
    } else {
      state.selectedRegions.add(validRegion);
    }
  }
  syncRegionStateString();
  window._userChangedRegion = true;

  renderRegionPills();
  applyFiltersAndRender();

  if (typeof window.panMapToRegion === 'function') {
    window.panMapToRegion(state.selectedRegions);
  }
}
window.setRegionFilter = setRegionFilter;

function renderRegionPills() {
  const bar = document.getElementById('region-filter-bar');
  if (!bar) return;
  const isAllActive = !state.selectedRegions || state.selectedRegions.size === 0;
  const pills = bar.querySelectorAll('.region-pill[data-region]');
  pills.forEach(btn => {
    const reg = (btn.getAttribute('data-region') || 'all').toLowerCase();
    const isActive = reg === 'all' ? isAllActive : state.selectedRegions.has(reg);
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    if (!btn._van50RegionBound) {
      btn._van50RegionBound = true;
      btn.addEventListener('click', () => {
        setRegionFilter(reg);
      });
    }
  });
}
window.renderRegionPills = renderRegionPills;

function renderNeighborhoodPills() {
  // Neighborhood filtering removed — geography is filtered strictly by City.
  return;
  const container = document.getElementById('neighborhood-pills-wrap');
  if (!container || typeof NEIGHBORHOODS === 'undefined') return;

  container.innerHTML = '';

  const vanList = window.VANCOUVER_NEIGHBORHOODS || [];
  const surreyList = window.SURREY_NEIGHBORHOODS || [];
  const macroGroups = window.SURREY_MACRO_GROUPS || [];

  // 1. Vancouver Neighborhoods Group
  const vanGroup = document.createElement('div');
  vanGroup.className = `nh-region-group ${(state.region && state.region !== 'all' && state.region !== 'vancouver') ? 'nh-dimmed-by-region' : ''}`;
  vanGroup.setAttribute('data-region-group', 'vancouver');

  const vanHeader = document.createElement('div');
  vanHeader.className = 'nh-group-label';
  vanHeader.textContent = '🏙️ Vancouver Neighborhoods';
  vanGroup.appendChild(vanHeader);

  vanList.forEach(nh => {
    const pill = document.createElement('button');
    pill.type = 'button';
    const isSelected = state.selectedNeighborhoods.has(nh);
    pill.className = `nh-pill ${isSelected ? 'active' : ''}`;
    pill.setAttribute('data-nh', nh);
    pill.setAttribute('data-nh-region', 'vancouver');
    pill.innerHTML = `<span>${escapeHtml(nh)}</span>`;
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
    vanGroup.appendChild(pill);
  });
  container.appendChild(vanGroup);

  // 2. Surrey Town Centres & Macro Quick-Select Group
  const surreyGroup = document.createElement('div');
  surreyGroup.className = `nh-region-group ${(state.region && state.region !== 'all' && state.region !== 'surrey') ? 'nh-dimmed-by-region' : ''}`;
  surreyGroup.setAttribute('data-region-group', 'surrey');

  const surreyHeader = document.createElement('div');
  surreyHeader.className = 'nh-group-label';
  surreyHeader.textContent = '🦌 Surrey Town Centres & Macro Areas';
  surreyGroup.appendChild(surreyHeader);

  // Surrey Macro Quick-Select Pills (North Surrey, Mid Surrey, South Surrey & Cloverdale)
  macroGroups.forEach(macro => {
    const macroBtn = document.createElement('button');
    macroBtn.type = 'button';
    const allMacroSelected = macro.towns.every(t => state.selectedNeighborhoods.has(t));
    const onlyMacroSelected = allMacroSelected && state.selectedNeighborhoods.size === macro.towns.length;
    macroBtn.className = `nh-pill nh-macro-pill ${onlyMacroSelected ? 'active' : ''}`;
    macroBtn.setAttribute('data-macro-id', macro.id);
    macroBtn.setAttribute('data-nh-region', 'surrey');
    macroBtn.title = `Filter to ${macro.aliases.join(', ')}`;
    macroBtn.innerHTML = `<span>${escapeHtml(macro.label)}</span>`;
    macroBtn.addEventListener('click', () => {
      if (onlyMacroSelected) {
        state.selectedNeighborhoods = new Set(window.NEIGHBORHOODS);
      } else {
        state.selectedNeighborhoods = new Set(macro.towns);
      }
      renderNeighborhoodPills();
      applyFiltersAndRender();
    });
    surreyGroup.appendChild(macroBtn);
  });

  // Surrey 6 Town Centre Pills
  surreyList.forEach(nh => {
    const pill = document.createElement('button');
    pill.type = 'button';
    const isSelected = state.selectedNeighborhoods.has(nh);
    const allSelected = state.selectedNeighborhoods.size === window.NEIGHBORHOODS.length;
    pill.className = `nh-pill ${isSelected ? 'active' : ''}`;
    pill.setAttribute('data-nh', nh);
    pill.setAttribute('data-nh-region', 'surrey');
    pill.innerHTML = `<span>${escapeHtml(nh)}</span>`;
    pill.addEventListener('click', () => {
      // If all neighborhoods were selected by default and user clicks a specific Surrey town centre, isolate that town centre (or toggle if already isolated)
      if (allSelected) {
        state.selectedNeighborhoods = new Set([nh]);
      } else if (state.selectedNeighborhoods.has(nh)) {
        state.selectedNeighborhoods.delete(nh);
        if (state.selectedNeighborhoods.size === 0) {
          state.selectedNeighborhoods = new Set(window.NEIGHBORHOODS);
        }
      } else {
        state.selectedNeighborhoods.add(nh);
      }
      window.trackAnonymousEvent('neighborhood/' + nh.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 'Neighborhood: ' + nh);
      renderNeighborhoodPills();
      applyFiltersAndRender();
    });
    surreyGroup.appendChild(pill);
  });
  container.appendChild(surreyGroup);

  // 3–6. Burnaby, Richmond, New West & Langley Neighborhood Groups
  const extraCityGroups = [
    { key: 'burnaby', title: '🏔️ Burnaby Neighborhoods', list: window.BURNABY_NEIGHBORHOODS || [] },
    { key: 'richmond', title: '🌊 Richmond Neighborhoods', list: window.RICHMOND_NEIGHBORHOODS || [] },
    { key: 'new-west', title: '⚓ New Westminster Neighborhoods', list: window.NEW_WEST_NEIGHBORHOODS || [] },
    { key: 'langley', title: '🐎 Langley Neighborhoods', list: window.LANGLEY_NEIGHBORHOODS || [] }
  ];
  extraCityGroups.forEach((cg) => {
    if (!cg.list.length) return;
    const grp = document.createElement('div');
    grp.className = `nh-region-group ${(state.region && state.region !== 'all' && state.region !== cg.key) ? 'nh-dimmed-by-region' : ''}`;
    grp.setAttribute('data-region-group', cg.key);

    const hdr = document.createElement('div');
    hdr.className = 'nh-group-label';
    hdr.textContent = cg.title;
    grp.appendChild(hdr);

    cg.list.forEach(nh => {
      const pill = document.createElement('button');
      pill.type = 'button';
      const isSelected = state.selectedNeighborhoods.has(nh);
      const allSelected = state.selectedNeighborhoods.size === window.NEIGHBORHOODS.length;
      pill.className = `nh-pill ${isSelected ? 'active' : ''}`;
      pill.setAttribute('data-nh', nh);
      pill.setAttribute('data-nh-region', cg.key);
      pill.innerHTML = `<span>${escapeHtml(nh)}</span>`;
      pill.addEventListener('click', () => {
        if (allSelected) {
          state.selectedNeighborhoods = new Set([nh]);
        } else if (state.selectedNeighborhoods.has(nh)) {
          state.selectedNeighborhoods.delete(nh);
          if (state.selectedNeighborhoods.size === 0) {
            state.selectedNeighborhoods = new Set(window.NEIGHBORHOODS);
          }
        } else {
          state.selectedNeighborhoods.add(nh);
        }
        window.trackAnonymousEvent('neighborhood/' + nh.toLowerCase().replace(/[^a-z0-9]+/g, '-'), 'Neighborhood: ' + nh);
        renderNeighborhoodPills();
        applyFiltersAndRender();
      });
      grp.appendChild(pill);
    });
    container.appendChild(grp);
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
    pill.innerHTML = `<span>${escapeHtml(fq.icon)}</span> <span>${escapeHtml(fq.label)}</span>`;
    pill.addEventListener('click', () => {
      state.frequency = (fq.id !== 'all' && state.frequency === fq.id) ? 'all' : fq.id;
      if (state.frequency === 'daily' && state.hideDaily) {
        state.hideDaily = false;
        const hideDailyToggle = document.getElementById('hide-daily-toggle');
        if (hideDailyToggle) hideDailyToggle.checked = false;
        if (typeof window.syncTopQuickToggles === 'function') window.syncTopQuickToggles();
      }
      renderFrequencyPills();
      applyFiltersAndRender();
    });
    container.appendChild(pill);
  });
}

window.setEventFocusFilter = function (focusMode) {
  if (focusMode === 'all' || focusMode === 'faith') {
    state.includeReligious = true;
  } else {
    state.includeReligious = false;
  }
  if (typeof window.syncDrawerAccessToggles === 'function') window.syncDrawerAccessToggles();
  applyFiltersAndRender();
};

// Sub-tag click-to-filter helper with instant toggle-to-deselect
window.filterBySubTag = function (tag) {
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

window.clearSelectedTag = function () {
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

  const isDropInCard = ev.lifecycle_type === 'perennial_drop_in' || ev.lifecycleType === 'perennial_drop_in' || ev.access_model === 'open_public_space' || ev.access_model === 'free_public_access' || Boolean(ev.weekly_hours || ev.weeklyHours);

  // PRIORITY 2: Check direct start time or startIso if event date is today (for non-drop-in time-bound events)
  if (!isDropInCard && (ev.date === todayStr || (ev.startIso && String(ev.startIso).slice(0, 10) === todayStr))) {
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
  if (!isDropInCard && ev.endIso && !ev.endIso.includes('12-31') && !ev.endIso.includes('03-31') && !ev.endIso.includes('05-31')) {
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
    } catch (e) { }
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

  const rawWh = ev.weekly_hours || ev.weeklyHours || (typeof ev.weekly_schedule === 'object' ? ev.weekly_schedule : null);
  const wh = (rawWh && typeof rawWh === 'object' && !Array.isArray(rawWh))
    ? parseWeeklyHoursTo7DayObject(rawWh, '', isDropInCard)
    : (rawWh || isDropInCard ? parseWeeklyHoursTo7DayObject(rawWh, ds || op, isDropInCard) : null);

  if (wh && typeof wh === 'object') {
    const todayEntry = wh[curKey] || wh[curFull];
    if (todayEntry && /closed|by\s+appointment/i.test(String(todayEntry).trim())) {
      return { hasEnded: true, closingMinutes: 0, closingTimeStr: 'Closed Today' };
    }
    if (todayEntry) {
      const entryStr = String(todayEntry).trim();
      if (/24\s*hours|24\/7/i.test(entryStr)) {
        return { hasEnded: false, closingMinutes: 24 * 60, closingTimeStr: 'Open 24/7' };
      }
      if (/[-–—to]+\s*(?:dusk|sunset)/i.test(entryStr)) {
        const duskMinutes = 19 * 60 + 45;
        return {
          hasEnded: currentMinutes >= duskMinutes,
          closingMinutes: duskMinutes,
          closingTimeStr: 'Dusk (7:45 PM)'
        };
      }
      const timeMatch = entryStr.match(/[-–—to]+\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)|Midnight)/i);
      if (timeMatch) {
        const rawTime = /midnight/i.test(timeMatch[1]) ? '12:00 AM' : timeMatch[1].trim();
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
    } catch (e) { }
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
  const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayIso = toIso(now);
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrowIso = toIso(tomorrow);
  const todayShort = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const todayDayCode = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];

  if (state.selectedDate) {
    if (state.selectedDate === 'weekend') {
      return '📅 This Weekend (Sat & Sun)';
    }
    if (state.selectedDate === todayIso) {
      return `📅 Today • ${todayShort}`;
    }
    if (state.selectedDate === tomorrowIso) {
      const tomShort = tomorrow.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return `📅 Tomorrow • ${tomShort}`;
    }
    const parsed = new Date(`${state.selectedDate}T12:00:00`);
    if (!isNaN(parsed.getTime())) {
      const nice = parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return `📅 ${nice}`;
    }
    return `📅 ${state.selectedDate}`;
  }
  if (!state.dayOfWeek || state.dayOfWeek === 'all') {
    return '📅 All Upcoming Outings';
  }
  if (state.dayOfWeek === todayDayCode) {
    return `📅 Today • ${todayShort}`;
  }
  if (state.dayOfWeek === 'daily') {
    return '📅 Daily Drop-In';
  }
  const dayDef = (typeof DAYS_OF_WEEK !== 'undefined' ? DAYS_OF_WEEK : []).find(d => d.id === state.dayOfWeek);
  const shortDay = dayDef ? dayDef.label : (state.dayOfWeek.charAt(0).toUpperCase() + state.dayOfWeek.slice(1));
  return `📅 Selected • ${shortDay}`;
}

function doesEventMatchCategory(ev, catId, hasFreeTierHint) {
  if (!catId || catId === 'all') return true;
  if (!ev) return false;
  const evCats = (Array.isArray(ev.categories) && ev.categories.length > 0)
    ? ev.categories
    : [ev.category];
  const hasFreeTier = typeof hasFreeTierHint === 'boolean'
    ? hasFreeTierHint
    : (ev.price === 0 || ev.isFree || ev.pricingType === 'free-option' || (Array.isArray(ev.tiers) && ev.tiers.some(t => t.price === 0 && !isAddonTier(t))));

  return Boolean(
    evCats.includes(catId) ||
    (catId === 'outdoors' && (
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
    (catId === 'cinema' && (
      evCats.includes('cinema') ||
      evCats.includes('film') ||
      evCats.includes('movie') ||
      (ev.subTags && ev.subTags.some(t => /cinema|film|movie|screening/i.test(t))) ||
      (/cinematheque|theatre|cinema|viff/i.test(ev.venue || '') && /film|screening|movie|viff|kwaidan|pulse|destroyer|ser querido|lovers in the night|jekyll|matchstick/i.test(ev.title || ''))
    )) ||
    (catId === 'free-public-access' && hasFreeTier && (
      evCats.includes('free-public-access') ||
      evCats.includes('free public access') ||
      (ev.categoryLabel && ev.categoryLabel.toLowerCase().includes('public access')) ||
      (ev.subTags && ev.subTags.some(t => t.toLowerCase().includes('public-access') || t.toLowerCase().includes('free-access'))) ||
      ev.access_model === 'open_public_space' ||
      ev.access_model === 'free_public_access' ||
      ev.lifecycleType === 'perennial_drop_in'
    )) ||
    (catId === 'markets' && (
      evCats.includes('markets') ||
      evCats.includes('market') ||
      (ev.subTags && ev.subTags.some(t => t.toLowerCase().includes('market'))) ||
      (ev.id && ev.id.includes('market')) ||
      (ev.title && ev.title.toLowerCase().includes('market'))
    )) ||
    (catId === 'music' && (
      evCats.includes('music') ||
      evCats.includes('live-music') ||
      (ev.subTags && ev.subTags.some(t => /music|dj|dance-party|dance|concert|band|jazz|techno|electronic|house|disco|nightlife/i.test(t))) ||
      /dj|dance party|dance night|techno|house music|disco|electronic|concert|band/i.test(ev.title || '')
    )) ||
    (catId === 'shows' && (
      (evCats.includes('stage') || evCats.includes('theatre') || evCats.includes('comedy') || evCats.includes('shows') || ev.event_archetype === 'live_stage') &&
      !evCats.includes('music') &&
      !/dance party|dance-party|dance night/i.test(ev.title + ' ' + (ev.subTags || []).join(' '))
    )) ||
    (catId === 'festivals' && (
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
    ((catId === 'social' || catId === 'trivia') && (
      evCats.includes('social') ||
      evCats.includes('trivia') ||
      evCats.includes('activities') ||
      ev.event_archetype === 'social_gaming' ||
      (ev.subTags && ev.subTags.some(t => /trivia|bingo|game|quiz|board|pinball|arcade|mixer/i.test(t))) ||
      /trivia|bingo|quiz|board game|pinball/i.test((ev.title || '') + ' ' + (ev.categoryLabel || ''))
    )) ||
    (catId === 'arts' && (
      evCats.includes('arts') ||
      evCats.includes('culture') ||
      evCats.includes('crafts') ||
      ev.event_archetype === 'museum_gallery' ||
      ev.event_archetype === 'workshop' ||
      (ev.subTags && ev.subTags.some(t => /art|gallery|museum|exhibit|craft|poetry|literary/i.test(t))) ||
      /art\b|gallery|museum|exhibit|studio|craft/i.test((ev.title || '') + ' ' + (ev.venue || '') + ' ' + (ev.categoryLabel || ''))
    )) ||
    (catId === 'sports' && (
      evCats.includes('sports') ||
      evCats.includes('fitness') ||
      ev.event_archetype === 'active_rec' ||
      (ev.subTags && ev.subTags.some(t => /sport|golf|pitch|putt|skate|roller|curling|hockey|baseball|soccer|run|fitness|bowling/i.test(t))) ||
      /sport|golf|pitch|putt|skate|roller|curling|hockey|baseball|soccer|stadium|coliseum|arena|bowling/i.test((ev.title || '') + ' ' + (ev.venue || '') + ' ' + (ev.categoryLabel || ''))
    ))
  );
}
window.doesEventMatchCategory = doesEventMatchCategory;

const SENIOR_DEAL_REGEX = /\b(senior|55\+|60\+|65\+|older adult|pensioner)\b/i;

function getEventSeniorPrice(ev) {
  if (!ev) return null;
  if (ev.seniorPrice !== undefined && ev.seniorPrice !== null && ev.seniorPrice !== '') {
    const sp = Number(ev.seniorPrice);
    if (Number.isFinite(sp) && sp >= 0 && sp <= 50) return sp;
  }
  const tiers = Array.isArray(ev.tiers) ? ev.tiers : [];
  const seniorTiers = tiers.filter(t => t && !t.isAddon && !isAddonTier(t) && !t.isSoldOut && !t.isExpired && SENIOR_DEAL_REGEX.test(String(t.name || '')) && Number.isFinite(Number(t.price)) && Number(t.price) >= 0 && Number(t.price) <= 50);
  if (seniorTiers.length > 0) {
    return Math.min(...seniorTiers.map(t => Number(t.price)));
  }
  return null;
}

function eventHasSeniorDeal(ev) {
  if (!ev) return false;
  if (ev.seniorPrice != null && Number.isFinite(Number(ev.seniorPrice))) return true;
  if (ev.seniorDiscountNote && String(ev.seniorDiscountNote).trim().length > 0) return true;
  if (ev.seniorFriendly === true) return true;
  if (getEventSeniorPrice(ev) !== null) return true;
  const tierNames = Array.isArray(ev.tiers) ? ev.tiers.map(t => t && t.name ? t.name : '').join(' ') : '';
  const combined = `${tierNames} ${ev.title || ''} ${ev.description || ''} ${ev.admissionPolicy || ''} ${ev.agePolicy || ''}`;
  return SENIOR_DEAL_REGEX.test(combined);
}

function applyFiltersAndRender() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;
  const cacheBucketKey = `${todayStr}:${now.getHours()}:${Math.floor(now.getMinutes() / 5)}`;
  let activeCatalog;
  let expiredCount;

  // Cache activeCatalog per 5-minute window and ALL_EVENTS identity to avoid re-scanning 550+ dates on every keystroke/slider tick
  if (
    window._activeCatalogCache &&
    window._activeCatalogCache.source === ALL_EVENTS &&
    window._activeCatalogCache.bucketKey === cacheBucketKey
  ) {
    activeCatalog = window._activeCatalogCache.activeCatalog;
    expiredCount = window._activeCatalogCache.expiredCount;
  } else {
    activeCatalog = [];
    expiredCount = 0;
    // Requirement: Strictly exclude past events, awaiting-schedule items, and over-budget (> $50) from user display
    ALL_EVENTS.forEach(ev => {
      const p = parseFloat(ev.price || 0.0);
      if (isAwaitingSchedule(ev) || isEventInPast(ev, now) || p > 50.00) {
        expiredCount++;
      } else {
        activeCatalog.push(ev);
      }
    });
    window._activeCatalogCache = {
      source: ALL_EVENTS,
      bucketKey: cacheBucketKey,
      activeCatalog,
      expiredCount
    };
    // Precompute O(1) venue counts map and reset compact card HTML cache when catalog/time bucket refreshes
    const venueMap = new Map();
    for (let i = 0; i < activeCatalog.length; i++) {
      const vName = activeCatalog[i].venue;
      if (vName) venueMap.set(vName, (venueMap.get(vName) || 0) + 1);
    }
    window._venueEventCountsMap = venueMap;
    window._compactCardHtmlCache = new Map();
    if (typeof window.scheduleIdleSearchIndexPrewarm === 'function') {
      window.scheduleIdleSearchIndexPrewarm(activeCatalog);
    }
  }

  state.expiredCount = expiredCount;
  window.currentActiveCatalog = activeCatalog;
  if (typeof pruneStaleSavedEvents === 'function') {
    pruneStaleSavedEvents(activeCatalog);
  }

  const spotlightSig = [
    activeCatalog.length,
    state.region || 'all',
    state.selectedThemeFilter || '',
    state.hideFestivalEvents ? '1' : '0',
    state.excludedThemes ? Array.from(state.excludedThemes).sort().join(',') : '',
    Array.isArray(window.FESTIVALS) ? window.FESTIVALS.length : 0
  ].join('|');
  if (window._festivalSpotlightSig !== spotlightSig) {
    window._festivalSpotlightSig = spotlightSig;
    renderFestivalSpotlight();
  }

  // Keep live sync counter in header aligned with active catalog
  const syncBadgeText = document.getElementById('sync-status-text');
  if (syncBadgeText && state.updatedAt) {
    showSyncTimestamp(state.updatedAt, activeCatalog.length);
  }

  const parsedSearch = state.searchQuery ? parseGoogleQuery(state.searchQuery) : null;
  const categoryCountPool = [];
  const hasSharedPlanFilter = Array.isArray(state.sharedPlanIds) && state.sharedPlanIds.length > 0;
  const sharedPlanOrderMap = hasSharedPlanFilter
    ? new Map(state.sharedPlanIds.map((id, idx) => [id, idx]))
    : null;

  const filtered = activeCatalog.filter(ev => {
    // Strict Budget Cap Guard (never display > $50.00 CAD to user under any circumstances)
    const p = parseFloat(ev.price || 0.0);
    if (p > 50.00) return false;

    // Shared Outing Plan Deep-Link Isolation (?plan=id1,id2,...)
    if (hasSharedPlanFilter) {
      const inPlan = sharedPlanOrderMap.has(ev.id);
      if (inPlan) categoryCountPool.push(ev);
      return inPlan;
    }

    // 0. Top-Level Multi-City Region Filter (all | vancouver | surrey | burnaby | richmond | new-west | langley)
    if (state.selectedRegions && state.selectedRegions.size > 0) {
      const evRegionKey = window.normalizeRegionKey(ev.region || ev.city || 'vancouver');
      if (!state.selectedRegions.has(evRegionKey)) return false;
    }

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

    // Senior Deals & 55+ Filter
    if (state.seniorDealsOnly) {
      if (!eventHasSeniorDeal(ev)) {
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

    // 2b. Calendar Date Picker is a jump-to-date control (does not filter out earlier/later dates)
    // so users can freely scroll before and after the selected date.

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

    // 5. Recurrence Frequency Filter
    if (state.frequency !== 'all') {
      if (state.frequency === 'limited-run' || state.frequency === 'seasonal') {
        if (ev.frequency !== 'limited-run' && ev.frequency !== 'seasonal') return false;
      } else if (ev.frequency !== state.frequency) {
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

    // 7b. Single Religious Events Toggle (when toggled OFF, hide religious/faith/sacred programming)
    if (state.includeReligious === false) {
      const focusTagSet = new Set([
        ...(Array.isArray(ev.tags) ? ev.tags : []),
        ...(Array.isArray(ev.subTags) ? ev.subTags : []),
        ...inferHolidaySubTags(ev)
      ].map(t => String(t || '').toLowerCase().trim()));
      const isFaithEvent = Boolean(ev.isReligious || ev.is_religious) || focusTagSet.has('faith-based') || focusTagSet.has('religious-service');
      const isSacredChoralEvent = focusTagSet.has('sacred-music') || focusTagSet.has('choral');
      if (isFaithEvent || isSacredChoralEvent) return false;
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

    // Passed all active Region, Search, Date/Day, Spend, and Secondary filters -> record for live category counts
    categoryCountPool.push(ev);

    // 2. Category Filter (Multi-category support)
    if (state.category !== 'all' && !doesEventMatchCategory(ev, state.category, hasFreeTier)) {
      return false;
    }

    return true;
  });

  window._lastCategoryCountPool = categoryCountPool;
  if (typeof renderQuickCategoryStrip === 'function') {
    renderQuickCategoryStrip(categoryCountPool);
  }

  // If search query is active, rank results by relevance score descending (Exact title matches on top)
  if (parsedSearch) {
    filtered.sort((a, b) => (b._searchScore || 0) - (a._searchScore || 0));
  }

  if (state.sortBy === 'price-asc' || state.sortBy === 'price') {
    filtered.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
  } else if (state.sortBy === 'price-desc') {
    filtered.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
  } else if (state.sortBy === 'title') {
    filtered.sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  }

  if (hasSharedPlanFilter && sharedPlanOrderMap) {
    filtered.sort((a, b) => (sharedPlanOrderMap.get(a.id) ?? 9999) - (sharedPlanOrderMap.get(b.id) ?? 9999));
  }

  window.currentFilteredEvents = filtered;
  syncFiltersToUrlParams();
  renderActiveFilterChips(filtered.length);
  renderSharedPlanBanner(hasSharedPlanFilter ? filtered : null);

  // Update More Filters active counter badge
  let secondaryFilterCount = 0;
  // Calendar date selection acts as a jump-to-date scroll, not a restrictive filter count
  if (state.dayOfWeek !== 'all') secondaryFilterCount++;
  if (state.frequency !== 'all') secondaryFilterCount++;
  if (state.hideDaily) secondaryFilterCount++;
  if (state.includeReligious === false) secondaryFilterCount++;
  if (state.seniorDealsOnly) secondaryFilterCount++;
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
    const safeSelectedTag = escapeHtml(state.selectedTag || '');
    const tagBadgeHtml = state.selectedTag ? `
      <div class="active-tag-pill" title="Filtered by #${safeSelectedTag}. Click ✕ to clear.">
        <span class="tag-label">Tag:</span>
        <span>#${safeSelectedTag}</span>
        <button type="button" class="btn-clear-tag" data-action="clear-selected-tag" aria-label="Clear hashtag filter">✕</button>
      </div>
    ` : '';

    const themeGroups = getActiveThemeGroups(activeCatalog);
    const activeThemeObj = state.selectedThemeFilter
      ? (themeGroups.find(g => g.key === state.selectedThemeFilter) || { key: state.selectedThemeFilter, label: state.selectedThemeFilter.split(':')[1] || state.selectedThemeFilter, icon: '🎉' })
      : null;

    const activeThemeDisplay = activeThemeObj
      ? (String(activeThemeObj.label || '').startsWith(activeThemeObj.icon || '___')
        ? activeThemeObj.label
        : `${activeThemeObj.icon || '🎉'} ${activeThemeObj.label}`.trim())
      : '';

    const themeFilterPillHtml = activeThemeObj ? `
      <div class="active-tag-pill" title="Filtered to ${escapeHtml(activeThemeObj.label)}. Click ✕ to clear.">
        <span class="tag-label">Theme:</span>
        <span>${escapeHtml(activeThemeDisplay)}</span>
        <button type="button" class="btn-clear-tag" data-action="toggle-theme" data-theme-key="${escapeHtml(activeThemeObj.key)}" aria-label="Clear theme filter">✕</button>
      </div>
    ` : '';

    const excludedPillsHtml = (state.excludedThemes && state.excludedThemes.size > 0)
      ? Array.from(state.excludedThemes).map(exKey => {
        const exObj = themeGroups.find(g => g.key === exKey) || { key: exKey, label: exKey.split(':')[1] || exKey };
        return `
            <div class="active-tag-pill excluded-tag-pill" title="Excluding ${escapeHtml(exObj.label)}. Click ✕ to restore.">
              <span class="tag-label">Hidden:</span>
              <span>🚫 ${escapeHtml(exObj.label)}</span>
              <button type="button" class="btn-clear-tag" data-action="exclude-theme" data-theme-key="${escapeHtml(exKey)}" aria-label="Restore ${escapeHtml(exObj.label)}">✕</button>
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
            <button type="button" class="btn-cross-category" data-action="reset-category-search" style="cursor: pointer; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: 600;">
              Found ${Number(crossMatches)} match${crossMatches > 1 ? 'es' : ''} across all categories • View All ↗
            </button>
          </div>
        `;
      }
    }

    const heroActiveCountEl = document.getElementById('hero-active-count');
    if (heroActiveCountEl) {
      heroActiveCountEl.innerHTML = `Showing <strong>${Number(filtered.length)}</strong> outings under $50`;
    }

    const hasResultsBadges = Boolean(tagBadgeHtml || themeFilterPillHtml || excludedPillsHtml || crossCategoryBannerHtml);
    countBar.classList.toggle('is-empty-mobile', !hasResultsBadges);

    const mapWrapperEl = document.getElementById('map-view-wrapper');
    const isMapCurrentlyActive = Boolean(mapWrapperEl && (mapWrapperEl.classList.contains('active') || mapWrapperEl.style.display === 'block'));
    countBar.innerHTML = `<div class="results-count-right-group" style="display: inline-flex; align-items: center; gap: 10px; margin-left: auto;">
        <div class="inline-view-switcher" role="group" aria-label="View Switcher">
          <button type="button" class="inline-view-mode-btn view-switcher-btn ${!isMapCurrentlyActive ? 'active' : ''}" data-view="cards" data-view-mode="cards" aria-pressed="${!isMapCurrentlyActive ? 'true' : 'false'}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg><span>Cards</span></button>
          <button type="button" class="inline-view-mode-btn view-switcher-btn ${isMapCurrentlyActive ? 'active' : ''}" data-view="map" data-view-mode="map" aria-pressed="${isMapCurrentlyActive ? 'true' : 'false'}"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg><span>Map</span></button>
        </div>
      </div>
      ${(tagBadgeHtml || themeFilterPillHtml || excludedPillsHtml) ? `<div style="display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap;">` : '<div style="display:none;">'}
        ${tagBadgeHtml}
        ${themeFilterPillHtml}
        ${excludedPillsHtml}
      </div>
      ${crossCategoryBannerHtml}
    `;
    if (typeof window.bindAllViewSwitcherButtons === 'function') {
      window.bindAllViewSwitcherButtons();
    }
  }

  renderEventCards(filtered);

  // Defer Map Marker rebuilds while Map View is hidden; sync immediately when Map View is active
  window._pendingMapFilteredEvents = filtered;
  if (typeof window.updateFloatingMapReturnPill === 'function') {
    window.updateFloatingMapReturnPill();
  }
  const mapWrapCheck = document.getElementById('map-view-wrapper');
  const isMapVisible = Boolean(mapWrapCheck && (mapWrapCheck.classList.contains('active') || mapWrapCheck.style.display === 'block'));
  if (isMapVisible && typeof updateMapMarkers === 'function') {
    window._mapMarkersDirty = false;
    updateMapMarkers(filtered);
  } else {
    window._mapMarkersDirty = true;
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
function getOrBuildEventSearchIndex(ev) {
  if (ev._searchIndex) return ev._searchIndex;

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

  ev._searchIndex = {
    titleNorm, venueNorm, descNorm, artistNorm, orgNorm,
    catNorm, catLabelNorm, addrNorm, neighNorm, tagsNorm,
    venueAliasesNorm, daysList, festivalNorm, holidayNorm,
    allContent, docTokens, docStems
  };
  return ev._searchIndex;
}

// Pre-warm search indexes in small idle chunks so the first keystroke pays 0ms indexing cost
window.scheduleIdleSearchIndexPrewarm = function (catalog) {
  if (!Array.isArray(catalog) || catalog.length === 0) return;
  if (window._searchIndexPrewarmSource === catalog) return;
  window._searchIndexPrewarmSource = catalog;
  let cursor = 0;
  const CHUNK_SIZE = 35;
  const runChunk = (deadline) => {
    if (window._searchIndexPrewarmSource !== catalog) return;
    let processed = 0;
    while (cursor < catalog.length && processed < CHUNK_SIZE) {
      if (deadline && typeof deadline.timeRemaining === 'function' && deadline.timeRemaining() < 4 && processed > 0) {
        break;
      }
      if (!catalog[cursor]._searchIndex) {
        getOrBuildEventSearchIndex(catalog[cursor]);
      }
      cursor++;
      processed++;
    }
    if (cursor < catalog.length) {
      if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(runChunk, { timeout: 1200 });
      } else {
        setTimeout(() => runChunk(null), 50);
      }
    }
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(runChunk, { timeout: 800 });
  } else {
    setTimeout(() => runChunk(null), 120);
  }
};

function matchesGoogleSearch(ev, parsed) {
  const {
    titleNorm, venueNorm, descNorm, artistNorm, orgNorm,
    catNorm, catLabelNorm, addrNorm, neighNorm, tagsNorm,
    venueAliasesNorm, daysList, festivalNorm, holidayNorm,
    allContent, docTokens, docStems
  } = getOrBuildEventSearchIndex(ev);

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
  state.sharedPlanIds = null;
  closeItineraryDrawerIfOpen();
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
    state.selectedTag = null;
    state.searchQuery = '';
    state.pricingType = 'all';
    state.includeReligious = true;
    state.seniorDealsOnly = false;
    if (state.activeFestivalId) state.activeFestivalId = null;

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    const btnClearSearch = document.getElementById('btn-clear-search');
    if (btnClearSearch) btnClearSearch.style.display = 'none';
    const chkSched = document.getElementById('chk-scheduled-only') || document.getElementById('hide-daily-toggle');
    if (chkSched) chkSched.checked = false;
    state.accessibleOnly = false;
    if (typeof window.syncDrawerAccessToggles === 'function') window.syncDrawerAccessToggles();

    renderCategoryPills();
    renderDayPills();
    renderNeighborhoodPills();
    renderFrequencyPills();
    clearActiveQuickButtons();
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
        return `Free – $${formatCompactDollarNum(combinedUpper)} all-in`;
      }
      if (baseMin === combinedUpper) {
        return `$${formatCompactDollarNum(baseMin)} all-in`;
      }
      return `$${formatCompactDollarNum(baseMin)} – $${formatCompactDollarNum(combinedUpper)} all-in`;
    }

    if (admissionTiers.length > 1) {
      const minP = Math.min(...admissionTiers.map(t => t.price));
      const maxP = Math.max(...admissionTiers.map(t => t.price));
      if (minP === maxP) {
        return minP === 0 ? 'Free ($0)' : `$${formatCompactDollarNum(minP)} all-in`;
      }
      if (minP === 0) {
        return `Free – $${formatCompactDollarNum(maxP)} all-in`;
      }
      return `$${formatCompactDollarNum(minP)} – $${formatCompactDollarNum(maxP)} all-in`;
    } else if (admissionTiers.length === 1) {
      const p = admissionTiers[0].price;
      return p === 0 ? 'Free ($0)' : `$${formatCompactDollarNum(p)} all-in`;
    }
  }

  // 4. If all advance tiers are unavailable, check door or sold out
  if (tiers.length > 0 && activeTiers.length === 0) {
    const doorTier = tiers.find(t => t.isDoor);
    if (doorTier) {
      return `$${formatCompactDollarNum(doorTier.price)} door`;
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
    return ev.price === 0 ? 'Free ($0)' : `$${formatCompactDollarNum(ev.price)} door`;
  }
  if (ev.pricingType === 'food-drink') {
    return `Free entry (~$${ev.price.toFixed(0)} food/drink)`;
  }
  // Platform ticket breakdown
  return `$${formatCompactDollarNum(ev.price)} all-in`;
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

window.toggleTimeGroup = function (groupKey) {
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

window.smoothScrollToTimeGroup = function (groupId, event) {
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

window.toggleWeeklyHours = function (eventId, event, triggerEl) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const refEl = triggerEl || (event && ((event.currentTarget && event.currentTarget.closest ? event.currentTarget : null) || (event.target && event.target.closest ? event.target : null)));
  const scopedRoot = (refEl && refEl.closest) ? refEl.closest('.card-weekly-hours-block') : null;
  const table = (scopedRoot && scopedRoot.querySelector('.weekly-hours-table')) || document.getElementById(`hours-table-${eventId}`);
  const btn = (scopedRoot && scopedRoot.querySelector('.btn-toggle-hours')) || document.getElementById(`btn-toggle-hours-${eventId}`);
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

window.toggleShowings = function (eventId, event, triggerEl) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const refEl = triggerEl || (event && ((event.currentTarget && event.currentTarget.closest ? event.currentTarget : null) || (event.target && event.target.closest ? event.target : null)));
  const scopedRoot = (refEl && refEl.closest) ? refEl.closest('.card-showings-block') : null;
  const el = (scopedRoot && (scopedRoot.querySelector('.collapsible-showings') || scopedRoot.querySelector('[id^="showings-table-"]') || scopedRoot.querySelector('[id^="showings-more-"]')))
    || document.getElementById(`showings-table-${eventId}`)
    || document.getElementById(`showings-more-${eventId}`);
  const btn = (scopedRoot && scopedRoot.querySelector('[id^="btn-toggle-showings-"]')) || document.getElementById(`btn-toggle-showings-${eventId}`);
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

window.toggleAdmissionTiers = function (bucketKey, eventId, event) {
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

  const safeSelectedVenue = escapeHtml(state.selectedVenue || '');
  const venueBannerHtml = state.selectedVenue ? `
    <div class="active-venue-banner" id="active-venue-banner" style="grid-column: 1 / -1;">
      <div class="venue-banner-content">
        <span class="venue-banner-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="vertical-align: -2px; margin-right: 4px;"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></span>
        <span>Showing all <strong>${Number(events.length)}</strong> verified events at <strong>${safeSelectedVenue}</strong></span>
      </div>
      <button type="button" class="btn-clear-venue" data-action="clear-selected-venue" aria-label="Clear venue filter">Clear Venue Filter ✕</button>
    </div>
  ` : '';

  if (events.length === 0) {
    const activeFilterList = getActiveFiltersSummaryList();
    const activePillsHtml = activeFilterList.length > 0
      ? `<div class="zero-results-active-filters" role="region" aria-label="Active Filters Applied">
           <div class="zero-results-filters-heading">Active Filters Currently Applied (${Number(activeFilterList.length)}):</div>
           <div class="zero-results-filter-pills">
             ${activeFilterList.map(f => `<span class="zero-results-filter-pill">${escapeHtml(f)}</span>`).join('')}
           </div>
         </div>`
      : `<div class="zero-results-active-filters"><span class="zero-results-filter-pill">No custom filters active</span></div>`;

    const hasNarrowDateFilter = Boolean(
      state.selectedDate ||
      (state.dayOfWeek && state.dayOfWeek !== 'all') ||
      (state.frequency && state.frequency !== 'all') ||
      state.hideDaily
    );

    grid.innerHTML = `
      ${venueBannerHtml}
      <div class="zero-results-recovery-card" role="status" aria-live="polite" style="grid-column: 1 / -1;">
        <div class="empty-icon-wrap" style="margin-bottom: 14px;">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.65; color: var(--accent-primary);" aria-hidden="true"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
        </div>
        <h3 class="zero-results-title">No Outings Match Your Current Filters</h3>
        <p class="zero-results-subtitle">
          0 outings under $50 CAD matched this exact filter combination. Review your active filters below or reset to browse all verified outings.
        </p>
        ${activePillsHtml}
        <div class="zero-results-actions">
          <button type="button" class="btn btn-roulette btn-reset-all-primary" id="btn-zero-results-reset" data-action="reset-all-filters">🔄 Reset All Filters</button>
          ${hasNarrowDateFilter ? `<button type="button" class="btn" id="btn-zero-results-all-dates" data-action="clear-date-filter" style="background: rgba(13, 148, 136, 0.14); border: 1px solid rgba(13, 148, 136, 0.42); color: var(--brand-primary); padding: 10px 18px; border-radius: var(--radius-md); font-weight: 700; cursor: pointer;">📅 Show All Upcoming Dates</button>` : ''}
          ${state.selectedVenue ? `<button type="button" class="btn" data-action="clear-selected-venue" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; padding: 10px 18px; border-radius: var(--radius-md); font-weight: 600; cursor: pointer;">Clear Venue Filter</button>` : ''}
        </div>
      </div>
    `;
    return;
  }

  // When viewing events for a specific venue (via "See events here"), keep the empty-state message if 0 events,
  // otherwise flow through the same sticky date-group pipeline below so users immediately see event dates.
  if (state.selectedVenue && events.length === 0) {
    grid.innerHTML = `
      ${venueBannerHtml}
      <div style="grid-column: 1 / -1; text-align: center; padding: 50px 20px; color: var(--text-secondary); background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);">
        <h3 style="color: var(--text-main); margin-bottom: 8px;">No Current Events Under $50 at ${safeSelectedVenue}</h3>
        <button type="button" class="btn btn-roulette" data-action="clear-selected-venue">Clear Venue Filter</button>
      </div>
    `;
    return;
  }

  if (events.length === 0) {
    grid.innerHTML = `
      ${venueBannerHtml}
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-secondary); background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);">
        <div class="empty-icon-wrap" style="margin-bottom: 14px;"><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.5; color: var(--accent-primary);"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div>
        <h3 style="font-family: var(--font-heading); font-size: 1.3rem; color: var(--text-main); margin-bottom: 8px;">No Outings Found Matching Filters</h3>
        <p style="font-size: 0.9rem; max-width: 440px; margin: 0 auto 18px;">
          Try selecting "All Days" or "Any Time", widening your spend slider, clearing active tags, or toggling off "Scheduled Events Only".
        </p>
        <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
          <button type="button" class="btn btn-roulette" data-action="reset-all-filters">Reset All Filters</button>
          <button type="button" class="btn" data-action="filter-category" data-cat-id="all" style="background: var(--price-low-bg); border: 1px solid var(--border-subtle); color: var(--price-low-fg); padding: 10px 18px; border-radius: var(--radius-md); font-weight: 600; cursor: pointer;">Show All Active Outings</button>
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

  const getOrdinalDay = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const fmtMonthDay = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtWeekday = (d) => d.toLocaleDateString('en-US', { weekday: 'short' });
  const fmtFull = (d) => `${d.toLocaleDateString('en-US', { weekday: 'long', month: 'short' })} ${getOrdinalDay(d.getDate())}`;

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

  const toIsoKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const getOrdinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const formatSingleDayHeading = (d) => {
    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
    const month = d.toLocaleDateString('en-US', { month: 'short' });
    return `${weekday} ${month} ${getOrdinal(d.getDate())}`;
  };
  const formatSingleDayShort = (d) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const todayIso = toIsoKey(today);
  const tomorrowIso = toIsoKey(tomorrow);
  const dayBucketsMap = new Map();
  const anytimeDropInsList = [];

  events.forEach(ev => {
    const { bucket, date } = getEventTimeBucket(ev, now);
    ev._computedNextDate = date;
    if (isAnytimeDropInEvent(ev)) {
      anytimeDropInsList.push(ev);
      return;
    }
    let targetDate = (date instanceof Date && !isNaN(date.getTime())) ? date : null;
    if (!targetDate) {
      if (bucket === 'today') targetDate = today;
      else if (bucket === 'tomorrow') targetDate = tomorrow;
    }
    const dayKey = targetDate ? toIsoKey(targetDate) : 'unscheduled';
    if (!dayBucketsMap.has(dayKey)) {
      dayBucketsMap.set(dayKey, { dayKey, dateObj: targetDate, list: [] });
    }
    dayBucketsMap.get(dayKey).list.push(ev);
  });

  // Sort within each day bucket chronologically by start time, then price
  const toDayFloorMs = (d) => (d instanceof Date && !isNaN(d.getTime()))
    ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    : 9999999999999;

  const sortBucketList = (list) => {
    list.sort((a, b) => {
      const aDay = toDayFloorMs(a._computedNextDate);
      const bDay = toDayFloorMs(b._computedNextDate);
      if (aDay !== bDay) return aDay - bDay;

      const aMins = getEventSortMinuteOfDay(a, a._computedNextDate);
      const bMins = getEventSortMinuteOfDay(b, b._computedNextDate);
      if (aMins !== bMins) return aMins - bMins;

      return (a.price || 0) - (b.price || 0);
    });
  };

  dayBucketsMap.forEach(entry => sortBucketList(entry.list));
  anytimeDropInsList.sort((a, b) => (a.price || 0) - (b.price || 0) || String(a.title || '').localeCompare(String(b.title || '')));

  const sortedDayEntries = Array.from(dayBucketsMap.values()).sort((a, b) => {
    if (a.dayKey === 'unscheduled') return 1;
    if (b.dayKey === 'unscheduled') return -1;
    return a.dayKey.localeCompare(b.dayKey);
  });

  // Render Anytime & Scenic Drop-Ins as a collapsed-by-default banner under Seasonal Festivals
  const anytimeBannerEl = document.getElementById('anytime-dropins-banner-container');
  if (anytimeBannerEl) {
    if (anytimeDropInsList.length > 0 && !state.hideDaily) {
      const isDropOpen = Boolean(state.anytimeBannerExpanded);
      const dropCardsHtml = isDropOpen
        ? `<div class="anytime-dropins-banner-cards events-grid-section" id="cards-grid-anytime-banner">
             ${anytimeDropInsList.map(ev => renderSingleEventCardHtml(ev, 'dropins')).join('')}
           </div>`
        : '';
      anytimeBannerEl.style.display = 'block';
      anytimeBannerEl.innerHTML = `
        <div class="festival-spotlight-card festival-compact-banner ${isDropOpen ? 'is-expanded' : 'is-collapsed'}">
          <div class="festival-spotlight-left">
            <button type="button" class="festival-summary-bar-btn" data-action="toggle-anytime-banner" aria-expanded="${isDropOpen ? 'true' : 'false'}" title="${isDropOpen ? 'Collapse anytime & scenic drop-ins' : 'Expand anytime & scenic drop-ins'}">
              <span class="festival-summary-bar-left">
                <span class="festival-spotlight-title">Anytime &amp; Scenic Drop-Ins</span>
                <span class="festival-summary-count">(${Number(anytimeDropInsList.length)} spot${anytimeDropInsList.length === 1 ? '' : 's'} • Open Daily)</span>
              </span>
              <span class="festival-toggle-chevron" aria-hidden="true">${isDropOpen ? '▴' : '▾'}</span>
            </button>
            ${dropCardsHtml}
          </div>
        </div>
      `;
    } else {
      anytimeBannerEl.style.display = 'none';
      anytimeBannerEl.innerHTML = '';
    }
  }

  const bucketMeta = [];

  sortedDayEntries.forEach(entry => {
    if (entry.dayKey === todayIso) {
      const todayShortDate = entry.dateObj
        ? `${entry.dateObj.toLocaleDateString('en-US', { month: 'short' })} ${getOrdinal(entry.dateObj.getDate())}`
        : todayLabel;
      bucketMeta.push({
        key: 'today',
        isoDate: todayIso,
        title: `Today • ${todayShortDate}`,
        shortTitle: 'Today',
        icon: '',
        range: '',
        list: entry.list
      });
    } else if (entry.dayKey === tomorrowIso) {
      const tomorrowShortDate = entry.dateObj
        ? `${entry.dateObj.toLocaleDateString('en-US', { month: 'short' })} ${getOrdinal(entry.dateObj.getDate())}`
        : tomorrowLabel;
      bucketMeta.push({
        key: 'tomorrow',
        isoDate: tomorrowIso,
        title: `Tomorrow • ${tomorrowShortDate}`,
        shortTitle: 'Tomorrow',
        icon: '',
        range: '',
        list: entry.list
      });
    } else if (entry.dateObj) {
      bucketMeta.push({
        key: `day-${entry.dayKey}`,
        isoDate: entry.dayKey,
        title: formatSingleDayHeading(entry.dateObj),
        shortTitle: formatSingleDayShort(entry.dateObj),
        icon: '',
        range: '',
        list: entry.list
      });
    } else {
      bucketMeta.push({
        key: 'upcoming',
        title: 'Upcoming Events',
        shortTitle: 'Upcoming',
        icon: '',
        range: '',
        list: entry.list
      });
    }
  });

  const activeBuckets = bucketMeta.filter(b => b.list.length > 0);

  // Date selection is handled via the Calendar Picker inside Filters; omit the redundant timeframe pill row
  const navBarHtml = '';

  // Incremental rendering queues with a global initial card budget (keeps initial DOM & search re-renders fast)
  const GLOBAL_INITIAL_CARD_BUDGET = 28;
  const SCROLL_BUCKET_BATCH = 24;
  let remainingInitialBudget = GLOBAL_INITIAL_CARD_BUDGET;
  window._pendingBucketQueues = {};
  if (window._van50BucketObserver) {
    try { window._van50BucketObserver.disconnect(); } catch (e) { }
    window._van50BucketObserver = null;
  }

  const renderBucketQueueItem = (entry, bucketKey) => {
    if (entry.type === 'subdivider') {
      return `<div class="anytime-dropins-subdivider" role="separator" aria-label="Anytime and Scenic Drop-Ins">
        <span class="anytime-subdivider-label">Anytime &amp; Scenic Drop-Ins (${Number(entry.count)})</span>
        <span class="anytime-subdivider-line" aria-hidden="true"></span>
      </div>`;
    }
    return renderSingleEventCardHtml(entry.ev, bucketKey);
  };

  window.appendNextBucketBatch = function (bucketKey, flushAll) {
    const queue = window._pendingBucketQueues && window._pendingBucketQueues[bucketKey];
    const gridEl = document.getElementById(`cards-grid-${bucketKey}`);
    if (!queue || !queue.length || !gridEl) return false;
    const sentinel = gridEl.querySelector(`.load-more-cards-sentinel[data-bucket-key="${bucketKey}"]`);
    const count = flushAll ? queue.length : SCROLL_BUCKET_BATCH;
    const slice = queue.splice(0, count);
    const html = slice.map(entry => renderBucketQueueItem(entry, bucketKey)).join('');
    if (sentinel) {
      sentinel.insertAdjacentHTML('beforebegin', html);
      const remainingCards = queue.filter(entry => entry.type === 'card').length;
      if (remainingCards === 0) {
        if (window._van50BucketObserver) window._van50BucketObserver.unobserve(sentinel);
        sentinel.remove();
        delete window._pendingBucketQueues[bucketKey];
      } else {
        const btn = sentinel.querySelector('.btn-load-more-cards');
        if (btn) btn.textContent = `Show more outings (${remainingCards} remaining)`;
      }
    } else {
      gridEl.insertAdjacentHTML('beforeend', html);
      if (queue.length === 0) delete window._pendingBucketQueues[bucketKey];
    }
    return true;
  };

  window.ensureEventCardRendered = function (eventId) {
    if (!eventId || document.getElementById(`card-${eventId}`)) return true;
    const queues = window._pendingBucketQueues || {};
    for (const [bKey, queue] of Object.entries(queues)) {
      if (queue.some(entry => entry.type === 'card' && entry.ev && entry.ev.id === eventId)) {
        window.appendNextBucketBatch(bKey, true);
        return Boolean(document.getElementById(`card-${eventId}`));
      }
    }
    return false;
  };

  // Render sections with dedicated sticky <section class="date-group"> wrappers for every day & Anytime Drop-Ins
  const sectionsHtml = activeBuckets.map(b => {
    const isCollapsed = Boolean(state.collapsedTimeGroups && state.collapsedTimeGroups.has(b.key));
    const scheduledItems = b.list.filter(ev => !isAnytimeDropInEvent(ev));
    const dropInItems = b.list.filter(ev => isAnytimeDropInEvent(ev));
    const splitDropInsSection = !isCollapsed && scheduledItems.length > 0 && dropInItems.length > 0;

    let cardsHtml = '';
    let dropInSectionHtml = '';

    if (!isCollapsed) {
      const primaryList = splitDropInsSection ? scheduledItems : b.list;
      const orderedItems = primaryList.map(ev => ({ type: 'card', ev }));

      const bucketTake = Math.min(orderedItems.length, Math.max(0, remainingInitialBudget));
      const initialSlice = orderedItems.slice(0, bucketTake);
      const remainingSlice = orderedItems.slice(bucketTake);
      const renderedCardsInSlice = initialSlice.length;
      remainingInitialBudget = Math.max(0, remainingInitialBudget - renderedCardsInSlice);
      cardsHtml = initialSlice.map(entry => renderBucketQueueItem(entry, b.key)).join('');

      if (remainingSlice.length > 0) {
        window._pendingBucketQueues[b.key] = remainingSlice;
        const remainingCards = remainingSlice.length;
        const safeKeyAttr = escapeHtml(b.key);
        cardsHtml += `<div class="load-more-cards-sentinel" data-bucket-key="${safeKeyAttr}" style="grid-column: 1 / -1; display: flex; justify-content: center; padding: 14px 0;">
          <button type="button" class="btn-load-more-cards" data-action="load-more-bucket" data-bucket-key="${safeKeyAttr}" style="padding: 9px 18px; border-radius: 999px; border: 1px solid var(--border-subtle); background: var(--bg-elevated); color: var(--text-primary); font-weight: 600; font-size: 0.85rem; cursor: pointer;">Show more outings (${Number(remainingCards)} remaining)</button>
        </div>`;
      }

      if (splitDropInsSection) {
        const dropKey = `${b.key}-dropins`;
        const dropCollapsed = Boolean(state.collapsedTimeGroups && state.collapsedTimeGroups.has(dropKey));
        const dropOrdered = dropInItems.map(ev => ({ type: 'card', ev }));
        const dropTake = dropCollapsed ? 0 : Math.min(dropOrdered.length, Math.max(8, remainingInitialBudget));
        const dropInitial = dropOrdered.slice(0, dropTake);
        const dropRemaining = dropOrdered.slice(dropTake);
        remainingInitialBudget = Math.max(0, remainingInitialBudget - dropInitial.length);
        let dropCardsHtml = dropInitial.map(entry => renderBucketQueueItem(entry, b.key)).join('');
        if (!dropCollapsed && dropRemaining.length > 0) {
          window._pendingBucketQueues[dropKey] = dropRemaining;
          const safeDropKeyAttr = escapeHtml(dropKey);
          dropCardsHtml += `<div class="load-more-cards-sentinel" data-bucket-key="${safeDropKeyAttr}" style="grid-column: 1 / -1; display: flex; justify-content: center; padding: 14px 0;">
            <button type="button" class="btn-load-more-cards" data-action="load-more-bucket" data-bucket-key="${safeDropKeyAttr}" style="padding: 9px 18px; border-radius: 999px; border: 1px solid var(--border-subtle); background: var(--bg-elevated); color: var(--text-primary); font-weight: 600; font-size: 0.85rem; cursor: pointer;">Show more drop-ins (${Number(dropRemaining.length)} remaining)</button>
          </div>`;
        }
        const safeDropKey = escapeHtml(dropKey);
        dropInSectionHtml = `
          <section class="events-time-group date-group date-group-dropins ${dropCollapsed ? 'collapsed' : ''}" id="group-${safeDropKey}" data-group-title="Anytime &amp; Scenic Drop-Ins" data-group-heading="Anytime &amp; Scenic Drop-Ins" data-group-range="Open Hours">
            <div class="time-group-header date-group-header" data-action="toggle-time-group" data-group-key="${safeDropKey}" role="button" tabindex="0" aria-expanded="${!dropCollapsed}" aria-controls="cards-grid-${safeDropKey}" title="Click to ${dropCollapsed ? 'expand' : 'collapse'} Anytime &amp; Scenic Drop-Ins">
              <div class="time-group-title-wrap">
                <h2 class="time-group-title">Anytime &amp; Scenic Drop-Ins</h2>
                <span class="time-group-date-range">Open Daily / Drop-In</span>
              </div>
              <div class="time-group-actions">
                <span class="time-group-count-badge">${Number(dropInItems.length)} spot${dropInItems.length === 1 ? '' : 's'}</span>
                <button class="btn-group-collapse-toggle" type="button" aria-expanded="${!dropCollapsed}" aria-label="${dropCollapsed ? 'Expand section' : 'Collapse section'}" data-action="toggle-time-group" data-group-key="${safeDropKey}">
                  <span class="toggle-icon">${dropCollapsed ? '▶' : '▼'}</span>
                  <span class="toggle-label">${dropCollapsed ? 'Expand' : 'Collapse'}</span>
                </button>
              </div>
            </div>
            ${dropCollapsed ? `
              <div class="time-group-collapsed-banner" data-action="toggle-time-group" data-group-key="${safeDropKey}" role="button" tabindex="0" title="Click to expand Anytime &amp; Scenic Drop-Ins">
                <span class="collapsed-banner-info"><strong>Anytime &amp; Scenic Drop-Ins</strong> is collapsed (${Number(dropInItems.length)} spot${dropInItems.length === 1 ? '' : 's'})</span>
                <span class="collapsed-banner-action">Click to expand outings ▾</span>
              </div>
            ` : `
              <div class="time-group-cards-grid events-grid-section" id="cards-grid-${safeDropKey}">
                ${dropCardsHtml}
              </div>
            `}
          </section>
        `;
      }
    }
    const safeKey = escapeHtml(b.key);
    const safeTitle = escapeHtml(b.title);
    const safeShortTitle = escapeHtml(b.shortTitle);
    const safeRange = escapeHtml(b.range);
    const safeIsoDate = escapeHtml(b.isoDate || '');
    const isDatePicked = Boolean(safeIsoDate && state.selectedDate === safeIsoDate);
    const displayCount = splitDropInsSection ? scheduledItems.length : b.list.length;
    const titleInnerHtml = (safeIsoDate && !safeRange)
      ? `<button type="button" class="date-group-pick-btn date-group-pick-title ${isDatePicked ? 'is-selected' : ''}" data-pick-date="${safeIsoDate}" title="Open calendar to jump to another date" aria-pressed="${isDatePicked ? 'true' : 'false'}">${safeTitle} <span class="date-pick-caret" aria-hidden="true">📅</span></button>`
      : safeTitle;
    const rangeHtml = safeRange
      ? (safeIsoDate
        ? `<button type="button" class="time-group-date-range date-group-pick-btn ${isDatePicked ? 'is-selected' : ''}" data-pick-date="${safeIsoDate}" title="Open calendar to jump to another date" aria-pressed="${isDatePicked ? 'true' : 'false'}">${safeRange} <span class="date-pick-caret" aria-hidden="true">📅</span></button>`
        : `<span class="time-group-date-range">${safeRange}</span>`)
      : '';
    return `
      <section class="events-time-group date-group ${isCollapsed ? 'collapsed' : ''}" id="group-${safeKey}" data-group-key="${safeKey}" data-iso-date="${safeIsoDate}" data-group-title="${safeShortTitle}" data-group-heading="${safeTitle}" data-group-range="${safeRange}">
        <div class="time-group-header date-group-header" data-action="toggle-time-group" data-group-key="${safeKey}" role="button" tabindex="0" aria-expanded="${!isCollapsed}" aria-controls="cards-grid-${safeKey}" title="Click to ${isCollapsed ? 'expand' : 'collapse'} ${safeTitle}">
          <div class="time-group-title-wrap">
            <span class="time-group-icon" style="display:none;"></span>
            <h2 class="time-group-title">${titleInnerHtml}</h2>
            ${rangeHtml}
          </div>
          <div class="time-group-actions">
            <span class="time-group-count-badge">${Number(displayCount)} event${displayCount === 1 ? '' : 's'}</span>
            <button class="btn-group-collapse-toggle" type="button" aria-expanded="${!isCollapsed}" aria-label="${isCollapsed ? 'Expand section' : 'Collapse section'}" data-action="toggle-time-group" data-group-key="${safeKey}">
              <span class="toggle-icon">${isCollapsed ? '▶' : '▼'}</span>
              <span class="toggle-label">${isCollapsed ? 'Expand' : 'Collapse'}</span>
            </button>
          </div>
        </div>
        ${isCollapsed ? `
          <div class="time-group-collapsed-banner" data-action="toggle-time-group" data-group-key="${safeKey}" role="button" tabindex="0" title="Click to expand ${safeTitle}">
            <span class="collapsed-banner-info"><strong>${safeTitle}</strong> is collapsed (${Number(b.list.length)} event${b.list.length === 1 ? '' : 's'})</span>
            <span class="collapsed-banner-action">Click to expand outings ▾</span>
          </div>
        ` : `
          <div class="time-group-cards-grid events-grid-section" id="cards-grid-${safeKey}">
            ${cardsHtml}
          </div>
        `}
      </section>
      ${dropInSectionHtml}
    `;
  }).join('');

  grid.innerHTML = venueBannerHtml + navBarHtml + sectionsHtml;

  // Bind click + IntersectionObserver auto-loading for incremental bucket sentinels
  const sentinels = grid.querySelectorAll('.load-more-cards-sentinel');
  if (sentinels.length > 0) {
    sentinels.forEach((sentinelEl) => {
      const btn = sentinelEl.querySelector('.btn-load-more-cards');
      if (btn) {
        btn.addEventListener('click', () => {
          const bk = btn.getAttribute('data-bucket-key');
          if (bk && typeof window.appendNextBucketBatch === 'function') {
            window.appendNextBucketBatch(bk, false);
          }
        });
      }
    });
    if (typeof IntersectionObserver !== 'undefined') {
      window._van50BucketObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const bk = entry.target.getAttribute('data-bucket-key');
            if (bk && typeof window.appendNextBucketBatch === 'function') {
              window.appendNextBucketBatch(bk, false);
            }
          }
        });
      }, { rootMargin: '650px 0px' });
      sentinels.forEach((s) => window._van50BucketObserver.observe(s));
    }
  }

  if (typeof window.updateScrollDateIndicator === 'function') window.updateScrollDateIndicator();
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
    } catch (e) { }
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
    } catch (e) { }
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

  const safeBucketKey = escapeHtml(bucketKey || 'list');
  const safeEvId = escapeHtml(ev.id || '');
  const drawerId = `tiers-drawer-${safeBucketKey}-${safeEvId}`;
  const hintId = `tier-hint-${safeBucketKey}-${safeEvId}`;

  const listItemsHtml = dedupedTiers.map(t => {
    const isAddon = Boolean(t.isAddon || isAddonTier(t));
    const valText = isAddon ? `+$${Number(t.price).toFixed(2)} CAD` : (t.label || (t.price === 0 ? 'Free ($0)' : `$${Number(t.price).toFixed(2)} CAD`));
    const isFreeVal = !isAddon && (t.price === 0 || String(valText).toLowerCase().includes('free'));

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
        <span class="tier-name">${escapeHtml(t.name)}</span>
        <span class="tier-dots-leader" aria-hidden="true"></span>
        <span class="tier-val ${isFreeVal ? 'tier-free' : ''}">${escapeHtml(valText)}</span>
        ${statusBadge}
      </li>
    `;
  }).join('');

  const html = `
    <div class="card-expanded-tiers" id="${drawerId}" style="display: none;" aria-hidden="true">
      <div class="expanded-tiers-header">
        <span>Admission Rates (${Number(dedupedTiers.length)} Tiers)</span>
        <button type="button" class="btn-close-tiers" data-action="toggle-admission-tiers" data-bucket-key="${safeBucketKey}" data-event-id="${safeEvId}" title="Close tiers breakdown" aria-label="Close tiers breakdown">✕</button>
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

function formatCompactDollarNum(n) {
  const num = Number(n || 0);
  if (!Number.isFinite(num) || num <= 0) return '0';
  return num % 1 === 0 ? num.toFixed(0) : num.toFixed(2);
}

function getCollapsedPricePillInfo(ev) {
  const isSoldOut = Boolean(ev && ev.isSoldOut);
  const rawTiers = Array.isArray(ev && ev.tiers) ? ev.tiers : [];
  const validTiers = rawTiers.filter(t => t && !t.isAddon && !isAddonTier(t) && !t.isSoldOut && !t.isExpired && Number.isFinite(Number(t.price)) && Number(t.price) >= 0 && Number(t.price) <= 50);
  const seniorPrice = getEventSeniorPrice(ev);
  const hasSeniorNote = Boolean(ev && ev.seniorDiscountNote && String(ev.seniorDiscountNote).trim().length > 0);
  const hasMultiTiers = validTiers.length > 1 || seniorPrice !== null || hasSeniorNote;

  // Dynamic Senior Card Pricing when Senior Deals & 55+ filter is active
  if (!isSoldOut && state.seniorDealsOnly && seniorPrice !== null) {
    if (seniorPrice <= 0) {
      return { text: 'Free (65+)', className: 'is-free is-senior-price', hasMultiTiers };
    }
    return {
      text: `$${formatCompactDollarNum(seniorPrice)} Senior`,
      className: 'is-senior-price is-low',
      hasMultiTiers
    };
  }

  if (isSoldOut) {
    return { text: 'Sold Out', className: 'is-sold-out', hasMultiTiers };
  }

  const basePrice = Number(ev && ev.price ? ev.price : 0);
  const isFree = Boolean(ev && (ev.isFree || basePrice <= 0));

  if (hasMultiTiers) {
    const prices = validTiers.length > 0 ? validTiers.map(t => Number(t.price)) : [basePrice];
    if (seniorPrice !== null) prices.push(seniorPrice);
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    if (minP <= 0) {
      return { text: 'Free • Tiers ▾', className: 'is-free has-tiers', hasMultiTiers: true };
    }
    if (maxP > minP) {
      return { text: `From $${formatCompactDollarNum(minP)} ▾`, className: `${minP <= 10 ? 'is-low' : 'is-std'} has-tiers`, hasMultiTiers: true };
    }
    return { text: `$${formatCompactDollarNum(minP)} • Tiers ▾`, className: `${minP <= 10 ? 'is-low' : 'is-std'} has-tiers`, hasMultiTiers: true };
  }

  if (isFree) {
    return { text: 'Free', className: 'is-free', hasMultiTiers: false };
  }
  return {
    text: `$${formatCompactDollarNum(basePrice)}`,
    className: basePrice <= 10 ? 'is-low' : 'is-std',
    hasMultiTiers: false
  };
}

function renderExpandedTierBadgesStrip(ev) {
  const rawTiers = (Array.isArray(ev && ev.tiers) && ev.tiers.length > 0) ? ev.tiers : resolveEventTiers(ev);
  const validTiers = (Array.isArray(rawTiers) ? rawTiers : []).filter(t => {
    if (!t || t.isAddon || isAddonTier(t)) return false;
    const n = String(t.name || '').trim().toLowerCase();
    if (!n || n === 'null' || n === 'undefined') return false;
    return Number.isFinite(Number(t.price)) && Number(t.price) >= 0 && Number(t.price) <= 50;
  });

  // De-duplicate tiers by normalized name + price
  const seen = new Set();
  const deduped = [];
  for (const t of validTiers) {
    const key = `${String(t.name || '').trim().toLowerCase()}_${Number(t.price)}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(t);
    }
  }

  const seniorPrice = getEventSeniorPrice(ev);
  const hasSeniorTierInList = deduped.some(t => SENIOR_DEAL_REGEX.test(String(t.name || '')));
  const seniorNote = (ev && ev.seniorDiscountNote && String(ev.seniorDiscountNote).trim()) ? String(ev.seniorDiscountNote).trim() : '';

  const badges = [];
  if (deduped.length > 1 || (deduped.length === 1 && (seniorPrice !== null || seniorNote))) {
    deduped.forEach(t => {
      const p = Number(t.price);
      const isSeniorTier = SENIOR_DEAL_REGEX.test(String(t.name || ''));
      const priceText = p <= 0 ? 'Free' : `$${formatCompactDollarNum(p)} All-In`;
      const soldSuffix = t.isSoldOut ? ' (Sold Out)' : '';
      badges.push(`<span class="card-tier-mini-badge ${isSeniorTier ? 'is-senior-tier' : ''} ${t.isSoldOut ? 'is-tier-soldout' : ''}">${escapeHtml(t.name)}: <strong>${escapeHtml(priceText)}</strong>${escapeHtml(soldSuffix)}</span>`);
    });
  }

  if (seniorPrice !== null && !hasSeniorTierInList) {
    const sText = seniorPrice <= 0 ? 'Free' : `$${formatCompactDollarNum(seniorPrice)} All-In`;
    badges.push(`<span class="card-tier-mini-badge is-senior-tier">Senior 65+: <strong>${escapeHtml(sText)}</strong></span>`);
  }

  if (seniorNote) {
    badges.push(`<span class="card-tier-mini-badge is-senior-tier is-senior-note">Senior Rate: <strong>${escapeHtml(seniorNote)}</strong></span>`);
  }

  if (badges.length === 0) return '';
  return `<div class="card-tier-badges-strip" aria-label="Ticket tiers and discounts">${badges.join('')}</div>`;
}

function renderSingleEventCardHtml(ev, bucketKey, options) {
  const forceFullBody = Boolean(options && options.forceFullBody);
  const isSavedDrawerCardEarly = bucketKey === 'saved-drawer';
  const isMapIwCardEarly = bucketKey === 'map-iw';
  const isPersistedExpandedEarly = !isSavedDrawerCardEarly && !isMapIwCardEarly && state.expandedCardIds && state.expandedCardIds.has(ev.id);

  // Fast compact card path (lazy-mounts .card-expandable-details on click; memoized per event+bucket for instant search)
  if (!forceFullBody && !isSavedDrawerCardEarly && !isMapIwCardEarly && !isPersistedExpandedEarly) {
    const isSavedC = Boolean(state.savedEvents && state.savedEvents.has(ev.id));
    const cacheKey = `${ev.id || ''}|${bucketKey || 'list'}|${ev.isSoldOut ? 1 : 0}|${state.seniorDealsOnly ? 1 : 0}|${isSavedC ? 1 : 0}`;
    if (window._compactCardHtmlCache && window._compactCardHtmlCache.has(cacheKey)) {
      return window._compactCardHtmlCache.get(cacheKey);
    }
    const isSoldOutC = Boolean(ev.isSoldOut);
    const pillInfoC = getCollapsedPricePillInfo(ev);
    const topDateC = formatCardTopDate(ev, bucketKey);
    const isHappeningNowC = isEventHappeningNow(ev, new Date());
    const scrollDayFullC = (topDateC && topDateC.dateObj instanceof Date && !isNaN(topDateC.dateObj.getTime()))
      ? topDateC.dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : (topDateC.badgeText || '');
    const cardTagSetC = new Set([
      ...(Array.isArray(ev.tags) ? ev.tags : []),
      ...(Array.isArray(ev.subTags) ? ev.subTags : []),
      ...inferHolidaySubTags(ev)
    ].map(t => String(t || '').toLowerCase().trim()));
    const isFaithCardC = cardTagSetC.has('faith-based') || cardTagSetC.has('religious-service');
    const isChoralCardC = !isFaithCardC && (cardTagSetC.has('sacred-music') || cardTagSetC.has('choral'));
    const row2ContextPillHtmlC = isFaithCardC
      ? '<span class="row2-context-pill">Faith-Based</span>'
      : (isChoralCardC ? '<span class="row2-context-pill">Choral</span>' : '');
    const shortNeighborhoodC = String(ev.neighborhood || ev.venue || 'Vancouver')
      .split(' / ')[0].split('/')[0].split(',')[0].split(' & ')[0].trim();
    const row2TimeDisplayC = getEventRow2TimeDisplay(ev, topDateC, bucketKey);
    const catMetaC = getCardSemanticCategoryMeta(ev);
    const row2VenueMetaTextC = formatSmartRow2VenueMeta(ev, shortNeighborhoodC, row2TimeDisplayC);
    const safeEventIdC = escapeHtml(ev.id || '');
    const safeDisplayTitleC = escapeHtml(formatCardDisplayTitle(ev.title, ev));
    const safeBucketAttrC = escapeHtml(bucketKey || 'list');
    const safeCatFilterIdC = escapeHtml(catMetaC.filterId || 'all');
    const safeCatLabelC = escapeHtml(catMetaC.label || '');
    const safeCatThemeKeyC = escapeHtml(catMetaC.themeKey || '');
    const compactHtml = `
      <article class="event-card ${isSoldOutC ? 'card-sold-out' : ''} ${isHappeningNowC ? 'card-happening-now' : ''}" id="card-${safeEventIdC}" data-cat-theme="${safeCatThemeKeyC}" data-scroll-date="${escapeHtml(topDateC.badgeText)}" data-scroll-day="${escapeHtml(scrollDayFullC)}" data-bucket-key="${safeBucketAttrC}" data-action="card-accordion" data-event-id="${safeEventIdC}">
        <div class="mobile-card-compact-header" tabindex="0" aria-expanded="false">
          <div class="mobile-card-row-1">
            <span class="mobile-card-title">${safeDisplayTitleC}</span>
            <div class="mobile-card-row-1-right">
              <button type="button" class="card-quick-save-btn ${isSavedC ? 'is-saved saved' : ''}" data-action="toggle-save-event" data-event-id="${safeEventIdC}" aria-pressed="${isSavedC ? 'true' : 'false'}" aria-label="${isSavedC ? 'Remove from Saved Events' : 'Save to Saved Events'}" title="${isSavedC ? 'Remove from Saved Events' : 'Save to Saved Events'}">${isSavedC ? '♥' : '♡'}</button>
              <span class="mobile-card-price-pill ${pillInfoC.className}">${escapeHtml(pillInfoC.text)}</span>
            </div>
          </div>
          <div class="mobile-card-row-2">
            <button type="button" class="row2-category-pill" data-action="filter-category" data-cat-id="${safeCatFilterIdC}" title="Click to filter by ${safeCatLabelC}">${safeCatLabelC}</button>
            ${row2ContextPillHtmlC}
            <span class="mobile-card-meta-text">${escapeHtml(row2VenueMetaTextC)}</span>
            <span class="mobile-card-chevron" aria-hidden="true">▾</span>
          </div>
        </div>
        <div class="card-expandable-details" data-lazy-body="1"></div>
      </article>
    `;
    if (window._compactCardHtmlCache) {
      window._compactCardHtmlCache.set(cacheKey, compactHtml);
    }
    return compactHtml;
  }

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
  const safeEventId = escapeHtml(ev.id || '');
  const safeVenueText = escapeHtml(ev.venue || '');
  const venueTotalCount = (window._venueEventCountsMap && window._venueEventCountsMap.has(ev.venue))
    ? window._venueEventCountsMap.get(ev.venue)
    : (window.currentActiveCatalog || ALL_EVENTS).filter(e => e.venue === ev.venue).length;
  const isThisVenueSelected = state.selectedVenue === ev.venue;
  const venueOtherEventsBtnHtml = venueTotalCount > 1 ? `
      <button 
        type="button" 
        class="btn-venue-filter ${isThisVenueSelected ? 'active' : ''}" 
        data-action="filter-venue"
        data-venue="${safeVenueText}"
        title="${isThisVenueSelected ? 'Clear filter for ' + safeVenueText : 'Show all ' + Number(venueTotalCount) + ' events at ' + safeVenueText}"
      >
        ${isThisVenueSelected ? 'Viewing this venue ✕' : 'See all ' + Number(venueTotalCount) + ' events here'}
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
              <strong class="artist-name">${escapeHtml(artistStr)}</strong>
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
        ${ev.buzzwords.map(bw => `<span class="card-buzzword-pill">${escapeHtml(bw)}</span>`).join('')}
      </div>
    ` : '';

  const filmReviewsHtml = ((ev.ratings && Array.isArray(ev.ratings) && ev.ratings.length > 0) || ev.reviewQuote) ? `
      <div class="card-film-reviews">
        ${(ev.ratings && ev.ratings.length > 0) ? `
          <div class="film-ratings-pills">
            ${ev.ratings.map(r => {
    const srcLower = (r.source || '').toLowerCase();
    const srcClass = srcLower.includes('rotten') ? 'rt' : (srcLower.includes('letterboxd') ? 'letterboxd' : 'imdb');
    return `<span class="film-rating-chip ${srcClass}" title="${escapeHtml(r.source)} rating">${escapeHtml(r.icon || '⭐')} ${escapeHtml(r.source)}: <strong>${escapeHtml(r.score)}</strong></span>`;
  }).join('')}
          </div>
        ` : ''}
        ${ev.reviewQuote ? `<p class="film-review-quote">“${escapeHtml(ev.reviewQuote)}”</p>` : ''}
      </div>
    ` : '';

  const contentAdvisoryHtml = ev.contentAdvisory ? `
      <div class="card-content-advisory-box" title="Audience content advisory">
        <span aria-hidden="true" style="flex-shrink: 0;">⚠️</span>
        <span>${escapeHtml(ev.contentAdvisory)}</span>
      </div>
    ` : '';

  // CTA button with Sold-Out handling (links to ticketing portal waitlist if sold out)
  const escapedTitle = escapeHtml(ev.title || '');
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
  const primaryTicketUrl = safeExternalUrl((matchedShowing && matchedShowing.ticket_url) ? matchedShowing.ticket_url : ev.websiteUrl);
  const safePrimaryTicketHref = escapeHtml(primaryTicketUrl);
  const safeWebsiteHref = escapeHtml(safeExternalUrl(ev.websiteUrl));
  const safeGmapsHref = escapeHtml(safeExternalUrl(gmapsUrl));
  const safeVenueUrlHref = venueUrl ? escapeHtml(safeExternalUrl(venueUrl)) : '';

  const escapedVenue = escapeHtml(ev.venue || '');
  const pillInfoFull = getCollapsedPricePillInfo(ev);
  const expandedTierBadgesHtml = renderExpandedTierBadgesStrip(ev);
  const primaryCtaLabel = pillInfoFull.hasMultiTiers ? 'View Ticket Tiers ↗' : 'Get Tickets / Info ↗';
  const ctaButtonHtml = isSoldOut ? `
      <a 
        href="${safePrimaryTicketHref}" 
        target="_blank" 
        rel="noopener noreferrer" 
        referrerpolicy="no-referrer"
        class="btn-ticket-cta sold-out"
        data-event-id="${safeEventId}"
        data-event-title="${escapedTitle}"
        data-event-venue="${escapedVenue}"
        data-goatcounter-click="tickets-${safeEventId}"
        data-goatcounter-title="Tickets: ${escapedTitle} (${escapedVenue})"
        data-goatcounter-no-session="1"
        aria-label="${escapedTitle} is sold out - check ticket portal or waitlist"
      >
        Sold Out (Waitlist) ↗
      </a>
    ` : `
      <a 
        href="${safePrimaryTicketHref}" 
        target="_blank" 
        rel="noopener noreferrer" 
        referrerpolicy="no-referrer"
        class="btn-ticket-cta"
        data-event-id="${safeEventId}"
        data-event-title="${escapedTitle}"
        data-event-venue="${escapedVenue}"
        data-goatcounter-click="tickets-${safeEventId}"
        data-goatcounter-title="Tickets: ${escapedTitle} (${escapedVenue})"
        data-goatcounter-no-session="1"
        aria-label="Get tickets for ${escapedTitle}"
      >
        ${primaryCtaLabel}
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
      preTaxNoteHtml = `<div class="price-pretax-note">Note: Displays ${escapeHtml(val)} pre-tax before checkout</div>`;
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
  const cardLifecycle = ev.lifecycleType || ev.lifecycle_type || '';
  const hasDiscreteShowings = Array.isArray(ev.showings) && ev.showings.length > 0;
  const isTimeBoundWithShowings = (
    cardLifecycle === 'time_bound_event' ||
    (hasDiscreteShowings && cardLifecycle !== 'perennial_drop_in')
  );
  const isDropInCard = !isTimeBoundWithShowings && (
    cardLifecycle === 'perennial_drop_in' ||
    ev.access_model === 'open_public_space' ||
    ev.access_model === 'free_public_access' ||
    ev.access_model === 'drop_in_paid' ||
    ev.isFreePublic
  );
  const rawWeeklyHoursSource = isTimeBoundWithShowings
    ? null
    : (ev.weekly_hours || ev.weeklyHours);
  const fallbackWeeklySource = isTimeBoundWithShowings
    ? ''
    : (ev.operatingHours || (isDropInCard ? ev.dateSchedule : ''));
  const wh = parseWeeklyHoursTo7DayObject(rawWeeklyHoursSource, fallbackWeeklySource, isDropInCard);
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
              <span class="day-col">${escapeHtml(d.label)}:</span>
              <span class="hours-col">${escapeHtml(hoursStr)}</span>
            </div>
          `;
      }).join('');

      weeklyHoursHtml = `
          <div class="card-weekly-hours-block" id="hours-block-${safeEventId}">
            <div class="weekly-hours-summary-row" data-action="toggle-weekly-hours" data-event-id="${safeEventId}" title="Click to view/hide 7-day schedule">
              <div class="wh-summary-left">
                <div class="wh-active-day-box">
                  <span class="wh-active-day-name">${escapeHtml(activeDayLabel)}:</span>
                  <span class="wh-active-hours-val">${escapeHtml(activeHours)}</span>
                </div>
              </div>
              <button type="button" class="btn-toggle-hours" id="btn-toggle-hours-${safeEventId}" aria-expanded="false" aria-label="Toggle weekly schedule">
                <span class="toggle-text">Full Week</span>
                <span class="wh-chevron">▾</span>
              </button>
            </div>
            <div class="weekly-hours-table collapsible-hours" id="hours-table-${safeEventId}" style="display: none;">
              ${rows}
            </div>
          </div>
        `;
    } else {
      // For venues or events with unique shows or limited days, display only the single active day/time without a dropdown
      if (activeHours && !activeHours.toLowerCase().includes('not listed') && !activeHours.toLowerCase().includes('check schedule')) {
        weeklyHoursHtml = `
            <div class="card-weekly-hours-block static-hours-block" id="hours-block-${safeEventId}">
              <div class="weekly-hours-summary-row static-schedule-row">
                <div class="wh-summary-left">
                  <div class="wh-active-day-box">
                    <span class="wh-active-day-name">${escapeHtml(activeDayLabel)}:</span>
                    <span class="wh-active-hours-val">${escapeHtml(activeHours)}</span>
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
      ? `Festival Screenings &amp; Locations (${Number(ev.showings.length)})`
      : `Upcoming Dates &amp; Times (${Number(ev.showings.length)})`;

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
      const showingGmapsHref = escapeHtml(safeExternalUrl(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venueLabel + ' ' + (addrLabel || 'Vancouver BC'))}`));
      const safeBookHref = escapeHtml(safeExternalUrl(s.ticket_url || ev.websiteUrl));
      const costText = (s.cost !== undefined && s.cost !== null) ? (Number(s.cost) === 0 ? 'Free' : `$${Number(s.cost).toFixed(2)}`) : '';
      const isSoldOutShowing = s.status === 'sold_out' || s.is_sold_out;
      const actionHtml = isSoldOutShowing
        ? `<a href="${safeBookHref}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="badge-showing-sold-out" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-decoration: none; display: inline-block; cursor: pointer;" title="Sold out — click to check ticket portal or waitlist">Sold Out ↗</a>`
        : `<a href="${safeBookHref}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="btn-showing-book" title="Direct ticket or info link for this date">
                ${costText ? `${escapeHtml(costText)} ↗` : 'Book ↗'}
              </a>`;

      return `
          <div class="showing-row ${isShowingToday ? 'showing-today' : ''}">
            <div class="showing-time-col">
              <span class="showing-date">${escapeHtml(dateLabel)}</span>
              <span class="showing-time">${escapeHtml(timeLabel)}</span>
            </div>
            <div class="showing-venue-col">
              <a href="${showingGmapsHref}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="showing-venue-link" title="Open ${escapeHtml(venueLabel)} in Google Maps">
                <strong>${escapeHtml(venueLabel)}</strong>
              </a>
              <span class="showing-address">${escapeHtml(addrLabel)}</span>
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
          <div class="card-showings-block" id="showings-block-${safeEventId}">
            <div class="showings-summary-row" data-action="toggle-showings" data-event-id="${safeEventId}" title="Click to view/hide all ${Number(activeShowings.length)} upcoming scheduled dates">
              <div class="wh-summary-left">
                <div class="wh-active-day-box">
                  <span class="wh-active-day-name">Next:</span>
                  <span class="wh-active-hours-val">${escapeHtml(primaryDateLabel + primaryTimeLabel)}</span>
                </div>
              </div>
              <button 
                type="button" 
                class="btn-toggle-showings btn-toggle-hours" 
                id="btn-toggle-showings-${safeEventId}" 
                aria-expanded="false" 
                data-count="${Number(activeShowings.length)}"
                aria-label="Toggle all ${Number(activeShowings.length)} upcoming showings for ${escapedTitle}"
              >
                <span class="toggle-text">All Dates (${Number(activeShowings.length)})</span>
                <span class="wh-chevron">▾</span>
              </button>
            </div>
            <div class="showings-table collapsible-showings" id="showings-table-${safeEventId}" style="display: none;">
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
            <span>Featured Waypoints &amp; Landmarks (${Number(ev.waypoints.length)})</span>
          </div>
          <div class="waypoints-box-list">
            ${ev.waypoints.map(wp => `
              <div class="waypoint-row">
                <strong class="waypoint-name">• ${escapeHtml(wp.name)}</strong>
                <span class="waypoint-desc">${escapeHtml(wp.desc)}</span>
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
    benchItems.push(`<span>Bar: <strong>${escapeHtml(ev.drink_benchmark)}</strong></span>`);
  }
  if (ev.concession_benchmark) {
    benchItems.push(`<span>Concessions: <strong>${escapeHtml(ev.concession_benchmark)}</strong></span>`);
  }
  if (ev.coffee_benchmark) {
    benchItems.push(`<span>Coffee: <strong>${escapeHtml(ev.coffee_benchmark)}</strong></span>`);
  }
  if (ev.food_service_note) {
    benchItems.push(`<span class="food-service-note"><em>${escapeHtml(ev.food_service_note)}</em></span>`);
  } else if (ev.meal_benchmark) {
    benchItems.push(`<span>Meal: <strong>${escapeHtml(ev.meal_benchmark)}</strong></span>`);
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
  const escapedVenueAttr = escapeHtml(venueNameStr);
  const suggestBtnHtml = `<button type="button" class="btn-suggest-price" data-event-id="${safeEventId}" data-suggest-venue="${escapedVenueAttr}" title="Report status or suggest updated prices for ${escapedVenueAttr}">Report / Price ✎</button>`;

  if (ev.typical_item_spend) {
    let spendTag = (ev.typical_item_spend === 'No on-site concessions') ? 'On-Site Concessions' : 'Expected Outing Spend';
    if (ev.typical_item_spend === 'No on-site concessions') { spendTag = 'On-Site Concessions'; } else if (ev.pricing_model === 'pay_per_item' || (ev.id && (ev.id.includes('croissant') || ev.id.includes('market')))) {
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
          <span class="spend-pill-label"><strong>${escapeHtml(spendTag)}:</strong> ${escapeHtml(ev.typical_item_spend)}</span>
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
  const scrollDayFull = (topDate && topDate.dateObj instanceof Date && !isNaN(topDate.dateObj.getTime()))
    ? topDate.dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    : (topDate.badgeText || '');

  const cardTagSet = new Set([
    ...(Array.isArray(ev.tags) ? ev.tags : []),
    ...(Array.isArray(ev.subTags) ? ev.subTags : []),
    ...inferHolidaySubTags(ev)
  ].map(t => String(t || '').toLowerCase().trim()));
  const isFaithCard = cardTagSet.has('faith-based') || cardTagSet.has('religious-service');
  const isChoralCard = !isFaithCard && (cardTagSet.has('sacred-music') || cardTagSet.has('choral'));
  const row2ContextPillHtml = isFaithCard
    ? '<span class="row2-context-pill">Faith-Based</span>'
    : (isChoralCard ? '<span class="row2-context-pill">Choral</span>' : '');
  const expandedContextSubBadgeHtml = isFaithCard
    ? '<span class="card-context-subbadge" title="Devotional or liturgical event">⛪ Faith-Based</span>'
    : (isChoralCard ? '<span class="card-context-subbadge" title="Classical choral or sacred music concert">🎼 Sacred Choral</span>' : '');
  const shortNeighborhood = String(ev.neighborhood || ev.venue || 'Vancouver')
    .split(' / ')[0]
    .split('/')[0]
    .split(',')[0]
    .split(' & ')[0]
    .trim();
  const row2TimeDisplay = getEventRow2TimeDisplay(ev, topDate, bucketKey);
  const catMeta = getCardSemanticCategoryMeta(ev);
  const row2VenueMetaText = formatSmartRow2VenueMeta(ev, shortNeighborhood, row2TimeDisplay);
  const isSavedDrawerCard = bucketKey === 'saved-drawer';
  const isMapIwCard = bucketKey === 'map-iw';
  const cardDomId = isSavedDrawerCard
    ? `saved-card-${safeEventId}`
    : (isMapIwCard ? `map-card-${safeEventId}` : `card-${safeEventId}`);
  const shareBtnDomId = isSavedDrawerCard
    ? `btn-share-saved-${safeEventId}`
    : (isMapIwCard ? `btn-share-map-${safeEventId}` : `btn-share-${safeEventId}`);
  const copyLinkBtnDomId = isSavedDrawerCard
    ? `btn-copy-link-saved-${safeEventId}`
    : (isMapIwCard ? `btn-copy-link-map-${safeEventId}` : `btn-copy-link-${safeEventId}`);
  const isPersistedExpanded = !isSavedDrawerCard && !isMapIwCard && state.expandedCardIds && state.expandedCardIds.has(ev.id);
  const extraCardClasses = isSavedDrawerCard
    ? 'saved-drawer-functional-card mobile-expanded desktop-expanded'
    : (isMapIwCard
      ? 'map-iw-functional-card mobile-expanded desktop-expanded'
      : (isPersistedExpanded ? 'mobile-expanded desktop-expanded' : ''));

  const safeDisplayTitle = escapeHtml(formatCardDisplayTitle(ev.title, ev));
  const safeBucketAttr = escapeHtml(bucketKey || 'list');
  const safeCatFilterId = escapeHtml(catMeta.filterId || 'all');
  const safeCatLabel = escapeHtml(catMeta.label || '');
  const safeCatThemeKey = escapeHtml(catMeta.themeKey || '');
  const safeFreqClass = String(freqClass || 'one-off').replace(/[^a-z0-9_-]/gi, '');
  const safeAccessStatus = ['accessible', 'partial', 'inaccessible'].includes(accessInfo.status) ? accessInfo.status : 'accessible';
  const safeAccessSvgHtml = (typeof window.renderAccessBadgeSvg === 'function')
    ? window.renderAccessBadgeSvg(safeAccessStatus, 20)
    : escapeHtml(accessInfo.badgeIcon || '♿');

  return `
      <article class="event-card ${isSoldOut ? 'card-sold-out' : ''} ${isHappeningNow ? 'card-happening-now' : ''} ${extraCardClasses}" id="${cardDomId}" data-cat-theme="${safeCatThemeKey}" data-scroll-date="${escapeHtml(topDate.badgeText)}" data-scroll-day="${escapeHtml(scrollDayFull)}" data-bucket-key="${safeBucketAttr}" ${(isSavedDrawerCard || isMapIwCard) ? '' : `data-action="card-accordion" data-event-id="${safeEventId}"`}>
        <!-- Mobile 2-Line Compact Header (<= 768px) -->
        <div class="mobile-card-compact-header" tabindex="0" aria-expanded="${isPersistedExpanded ? 'true' : 'false'}">
          <div class="mobile-card-row-1">
            <span class="mobile-card-title">${safeDisplayTitle}</span>
            <div class="mobile-card-row-1-right">
              ${(!isSavedDrawerCard && !isMapIwCard) ? `<button type="button" class="card-quick-save-btn ${isSaved ? 'is-saved saved' : ''}" data-action="toggle-save-event" data-event-id="${safeEventId}" aria-pressed="${isSaved ? 'true' : 'false'}" aria-label="${isSaved ? 'Remove from Saved Events' : 'Save to Saved Events'}" title="${isSaved ? 'Remove from Saved Events' : 'Save to Saved Events'}">${isSaved ? '♥' : '♡'}</button>` : ''}
              <span class="mobile-card-price-pill ${pillInfoFull.className}">${escapeHtml(pillInfoFull.text)}</span>
            </div>
          </div>
          <div class="mobile-card-row-2">
            <button type="button" class="row2-category-pill" data-action="filter-category" data-cat-id="${safeCatFilterId}" title="Click to filter by ${safeCatLabel}">${safeCatLabel}</button>
            ${row2ContextPillHtml}
            <span class="mobile-card-meta-text">${escapeHtml(row2VenueMetaText)}</span>
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
              <span>${escapeHtml(topDate.badgeText)}</span>
            </span>
            <button 
              type="button" 
              class="card-category-badge category-${safeCatFilterId}" 
              data-action="filter-category"
              data-cat-id="${safeCatFilterId}"
              title="Click to filter by ${safeCatLabel}"
              aria-label="Category: ${safeCatLabel}"
            >
              <span class="category-badge-text">${safeCatLabel}</span>
            </button>
            ${(Array.isArray(ev.themeBadges) && ev.themeBadges.length > 0) ? ev.themeBadges.map(tb => {
    const isSelected = state.selectedThemeFilter === tb.key;
    const showIcon = Boolean(tb.icon && !String(tb.label || '').startsWith(tb.icon));
    const safeTbKey = escapeHtml(tb.key || '');
    const safeTbLabel = escapeHtml(tb.label || '');
    return `
                <div class="card-theme-badge-pill ${isSelected ? 'active' : ''}">
                  <button
                    type="button"
                    class="card-theme-badge-main"
                    data-action="toggle-theme"
                    data-theme-key="${safeTbKey}"
                    title="${isSelected ? `Showing only ${safeTbLabel}. Click to clear` : `Click to filter by ${safeTbLabel}`}"
                  >
                    ${showIcon ? `<span>${escapeHtml(tb.icon)}</span>` : ''}
                    <span>${safeTbLabel}</span>
                  </button>
                  <button
                    type="button"
                    class="card-theme-badge-exclude"
                    data-action="exclude-theme"
                    data-theme-key="${safeTbKey}"
                    title="Filter out (hide) ${safeTbLabel} events"
                    aria-label="Hide ${safeTbLabel} events"
                  >✕</button>
                </div>
              `;
  }).join('') : ''}
            ${expandedContextSubBadgeHtml}
          </div>

          <!-- Top Right: Action Cluster (Accessibility, Share, Save) -->
          <div class="card-action-cluster">
            <!-- Accessibility Details Button -->
            <button 
              type="button" 
              class="btn-card-action btn-card-access ${safeAccessStatus}" 
              data-action="open-access-modal"
              data-event-id="${safeEventId}"
              title="${escapeHtml(accessInfo.label)} (${safeVenueText}) • Click for Google Maps accessibility details"
              aria-label="Accessibility information for ${safeVenueText}: ${escapeHtml(accessInfo.label)}"
            >
              <span class="access-btn-icon">${safeAccessSvgHtml}</span>
            </button>

            <!-- Share Event Button -->
            <button 
              type="button" 
              class="btn-card-action btn-card-share" 
              id="${shareBtnDomId}"
              data-action="share-event"
              data-event-id="${safeEventId}"
              title="Share event link & details"
              aria-label="Share ${escapedTitle}"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            </button>

            <!-- Save Outing Button -->
            <button 
              type="button"
              class="btn-card-action btn-save-card ${isSaved ? 'saved' : ''}" 
              data-action="toggle-save-event"
              data-event-id="${safeEventId}"
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
          <a href="${safeWebsiteHref}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="card-title-link" title="Get tickets & details for ${escapedTitle}">
            ${safeDisplayTitle}
          </a>
        </h2>
        
        <!-- Band / Artist Highlight Badge (Rendered strictly when multiple non-redundant music artists exist) -->
        ${featuringBoxHtml}

        <!-- Roving / Nomadic Series Organizer Badge -->
        ${ev.organizer ? `
          <div class="card-organizer-badge" title="Roving community event organized by ${escapeHtml(ev.organizer)}">
            <span class="organizer-icon"></span>
            <span class="organizer-label">Series:</span>
            <strong class="organizer-name">${escapeHtml(ev.organizer)}</strong>
            ${ev.editionVenue ? `<span class="edition-venue">(${escapeHtml(ev.editionVenue)})</span>` : ''}
          </div>
        ` : ''}

        <!-- Age, Admission & Access Policy Badges (QC Verified) -->
        ${(ev.agePolicy || ev.admissionPolicy || accessModelHtml) ? `
          <div class="card-policy-row">
            ${accessModelHtml}
            ${ev.agePolicy ? `<span class="policy-pill age-policy" title="${escapeHtml(ev.agePolicy)}">${escapeHtml(ev.agePolicy)}</span>` : ''}
            ${ev.admissionPolicy ? `<span class="policy-pill admission-policy" title="${escapeHtml(ev.admissionPolicy)}">${escapeHtml(ev.admissionPolicy)}</span>` : ''}
          </div>
        ` : ''}

        <!-- Roving Physical Host Note -->
        ${ev.rovingNote ? `
          <div class="card-roving-note"><em>${escapeHtml(ev.rovingNote)}</em></div>
        ` : ''}
        
        <!-- Venue Row: Direct Pinpoint Google Maps Directions + Official Venue Website + Venue Isolation Filter -->
        <div class="card-venue-row">
          <a href="${safeGmapsHref}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="venue-location-btn venue-location-link card-maps-link" title="Open ${safeVenueText} (${escapeHtml(ev.address || 'Vancouver')}) in Google Maps">
            <span class="venue-pin-icon" aria-label="Map location"><svg width="32" height="32" viewBox="0 0 24 24" fill="#ef4444" aria-hidden="true" style="color: #ef4444; flex-shrink: 0; vertical-align: middle; margin-right: 4px; filter: drop-shadow(0 2px 4px rgba(239, 68, 68, 0.55));"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg></span>
            <span class="venue-name">${safeVenueText}</span>
          </a>
          <div class="card-venue-actions-col">
            ${!isMapIwCard ? `
              <button type="button" class="btn-card-view-map" data-action="view-on-map" data-event-id="${safeEventId}" title="Locate ${safeVenueText} on the interactive map" aria-label="View ${safeVenueText} on Map">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>
                <span>View on Map</span>
              </button>
            ` : ''}
            ${safeVenueUrlHref ? `
              <a href="${safeVenueUrlHref}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="venue-website-link venue-link" title="Visit official website of ${safeVenueText}">
                <span class="website-label">Venue Site ↗</span>
              </a>
            ` : ''}
            ${venueOtherEventsBtnHtml}
          </div>
        </div>

        <!-- Schedule Row: Rendered strictly when NO weekly hours block and NO multi-showings block is present -->
        ${(!weeklyHoursHtml && !showingsHtml) ? `
          <div class="card-schedule-row">
            <span>${escapeHtml(formatScheduleText12h(ev.dateSchedule || ev.frequencyLabel || 'Check venue calendar'))}</span>
            ${(ev.frequencyLabel && !ev.isFreePublic) ? `<span class="card-meta-pill ${safeFreqClass}" style="margin-left: auto; font-size: 0.70rem; padding: 2px 6px;">${escapeHtml(ev.frequencyLabel)}</span>` : ''}
          </div>
        ` : ''}

        ${showingsHtml}

        ${waypointsHtml}

        ${weeklyHoursHtml}

        ${buzzwordsHtml}

        ${filmReviewsHtml}

        ${ev.description ? `<p class="card-desc">${escapeHtml(ev.description)}</p>` : ''}

        ${contentAdvisoryHtml}

        ${subtagsHtml}

        <!-- Card Pricing Section: Sub-details directly above green cost, footer locked at bottom -->
        <div class="card-pricing-block">
          ${subdetailsHtml}
          ${spendEstimatorHtml}
          ${expandedTierBadgesHtml}
          ${tiersInfo.html || ''}
          <div class="card-footer">
            <div class="price-box ${tiersInfo.hasTiers ? 'price-box-interactive' : ''}" 
                 ${tiersInfo.hasTiers ? `data-action="toggle-admission-tiers" data-bucket-key="${safeBucketAttr}" data-event-id="${safeEventId}" role="button" tabindex="0" aria-expanded="false" title="Click to view all ${Number(tiersInfo.count)} admission tiers"` : ''}>
              <div class="price-breakdown-row">
                <span class="price-main ${ev.isFree || ev.price === 0 ? 'free' : (Number(ev.price || 0) <= 25 ? 'is-low' : 'is-std')}">${escapeHtml(standardPrice)}</span>
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
  state.selectedRegions.clear();
  syncRegionStateString();
  state.sortBy = 'date';
  state.minBudget = 0;
  state.maxBudget = 50;
  state.category = 'all';
  state.frequency = 'all';
  state.dayOfWeek = 'all';
  state.hideDaily = false;
  state.hideFestivalEvents = false;
  state.selectedThemeFilter = null;
  if (state.excludedThemes) state.excludedThemes.clear();
  state.selectedTag = null;
  state.selectedVenue = null;
  state.searchQuery = '';
  state.includeReligious = true;
  state.sharedPlanIds = null;

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
  if (state.accessibleMode) setAccessibilityMode(false, false);
  state.seniorDealsOnly = false;
  if (typeof window.syncDrawerAccessToggles === 'function') window.syncDrawerAccessToggles();

  renderRegionPills();
  renderFestivalSpotlight();
  renderCategoryPills();
  renderDayPills();
  renderFrequencyPills();
  clearActiveQuickButtons();
  updateSliderVisuals();
  applyFiltersAndRender();
}

// ==============================================================================
// 6. ITINERARY DRAWER & STATE PERSISTENCE
// ==============================================================================

function getActiveSavedCatalog(catalogOverride) {
  if (Array.isArray(catalogOverride) && catalogOverride.length > 0) return catalogOverride;
  if (Array.isArray(window.currentActiveCatalog) && window.currentActiveCatalog.length > 0) return window.currentActiveCatalog;
  return Array.isArray(ALL_EVENTS) ? ALL_EVENTS : [];
}

function getActiveSavedEvents(catalogOverride) {
  const pool = getActiveSavedCatalog(catalogOverride);
  return pool.filter(ev => ev && state.savedEvents.has(ev.id));
}

function pruneStaleSavedEvents(catalogOverride) {
  const pool = getActiveSavedCatalog(catalogOverride);
  if (!pool.length || !state.savedEvents || state.savedEvents.size === 0) {
    updateItineraryBadge();
    return 0;
  }
  const activeIds = new Set(pool.map(ev => ev && ev.id).filter(Boolean));
  let removed = 0;
  Array.from(state.savedEvents).forEach(id => {
    if (!activeIds.has(id)) {
      state.savedEvents.delete(id);
      if (state.expandedSavedEvents) state.expandedSavedEvents.delete(id);
      removed++;
    }
  });
  if (removed > 0) {
    persistSavedState();
    updateItineraryBadge();
    renderItinerary();
  } else {
    updateItineraryBadge();
  }
  return removed;
}

function loadSavedState() {
  try {
    const raw = localStorage.getItem('van50_saved');
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        state.savedEvents = new Set(arr);
        pruneStaleSavedEvents();
      }
    }
  } catch (e) { }
}

function persistSavedState() {
  try {
    localStorage.setItem('van50_saved', JSON.stringify(Array.from(state.savedEvents)));
  } catch (e) { }
}

window.toggleSaveEvent = function (eventId) {
  const willBeSaved = !state.savedEvents.has(eventId);
  if (!willBeSaved) {
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

  // Sync save button visuals in-place across Card View, Saved Drawer, and Map InfoWindows without closing open Map popups
  if (window._compactCardHtmlCache && typeof window._compactCardHtmlCache.clear === 'function') {
    window._compactCardHtmlCache.clear();
  }
  document.querySelectorAll(`[data-action="toggle-save-event"][data-event-id="${CSS.escape(String(eventId))}"]`).forEach((btn) => {
    btn.classList.toggle('saved', willBeSaved);
    btn.classList.toggle('is-saved', willBeSaved);
    btn.setAttribute('aria-pressed', willBeSaved ? 'true' : 'false');
    btn.setAttribute('aria-label', willBeSaved ? 'Remove from Saved Events' : 'Save to Saved Events');
    btn.title = willBeSaved ? 'Remove from Saved Events' : 'Save to Saved Events';
    if (btn.classList.contains('card-quick-save-btn')) {
      btn.textContent = willBeSaved ? '♥' : '♡';
    }
  });

  const mapWrapperEl = document.getElementById('map-view-wrapper');
  const isMapActive = Boolean(mapWrapperEl && (mapWrapperEl.classList.contains('active') || mapWrapperEl.style.display === 'block' || mapWrapperEl.style.display === 'flex'));
  if (!isMapActive) {
    applyFiltersAndRender();
  }
};

function updateItineraryBadge() {
  const badge = document.getElementById('itinerary-count');
  const btn = document.getElementById('itinerary-btn');
  const count = getActiveSavedEvents().length;
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('has-saved', count > 0);
  }
  if (btn) {
    btn.classList.toggle('has-saved', count > 0);
  }
}

function renderItinerary() {
  const list = document.getElementById('itinerary-items-list');
  const totalEl = document.getElementById('itinerary-total-cost');
  const statusEl = document.getElementById('itinerary-budget-status');
  const sharePlanBtn = document.getElementById('share-plan-btn');
  const copyPlanLinkBtn = document.getElementById('copy-plan-link-btn');
  const clearPlanBtn = document.getElementById('clear-plan-btn');
  const savedList = getActiveSavedEvents();
  const currentSavedCount = savedList.length;
  if (sharePlanBtn) sharePlanBtn.style.display = currentSavedCount > 0 ? 'inline-flex' : 'none';
  if (copyPlanLinkBtn) copyPlanLinkBtn.style.display = currentSavedCount > 0 ? 'inline-flex' : 'none';
  if (clearPlanBtn) clearPlanBtn.style.display = currentSavedCount > 0 ? 'inline-flex' : 'none';
  if (!list || !totalEl) return;

  if (savedList.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; padding: 40px 10px; color: var(--text-muted); font-size: 0.86rem;">
        No saved events yet.<br>Click the heart icon on any card to save an outing.
      </div>
    `;
    totalEl.textContent = '$0';
    if (statusEl) statusEl.textContent = 'Add events to calculate';
    const emptyFill = document.getElementById('itinerary-budget-meter-fill');
    if (emptyFill) {
      emptyFill.style.width = '0%';
      emptyFill.style.background = '#10b981';
    }
    return;
  }

  if (!state.expandedSavedEvents) state.expandedSavedEvents = new Set();
  let totalCost = 0;
  list.innerHTML = savedList.map(ev => {
    totalCost += Number(ev.price) || 0;
    const isExpanded = state.expandedSavedEvents.has(ev.id);
    const expandedCardHtml = isExpanded
      ? `<div class="itinerary-expanded-card-wrap">${renderSingleEventCardHtml(ev, 'saved-drawer')}</div>`
      : '';
    const safeId = escapeHtml(ev.id || '');
    const safeTitle = escapeHtml(ev.title || '');
    const safeVenue = escapeHtml(ev.venue || '');
    const safePrice = escapeHtml(formatStandardPrice(ev));
    return `
      <div class="itinerary-item-card ${isExpanded ? 'is-expanded' : ''}" data-saved-event-id="${safeId}">
        <div class="itinerary-item-summary-row" role="button" tabindex="0" aria-expanded="${isExpanded}" data-action="toggle-saved-expand" data-event-id="${safeId}" title="${isExpanded ? 'Collapse card details' : 'Click to expand full event card'}">
          <div style="flex: 1; min-width: 0;">
            <div class="itinerary-item-title">${safeTitle}</div>
            <div style="font-size: 0.74rem; color: var(--text-secondary); margin-bottom: 4px;">${safeVenue}</div>
            <div class="itinerary-item-price">${safePrice}</div>
          </div>
          <div class="itinerary-item-controls">
            <span class="itinerary-expand-chevron" aria-hidden="true">${isExpanded ? '▴' : '▾'}</span>
            <button type="button" class="btn-remove-item" data-action="toggle-save-event" data-event-id="${safeId}" title="Remove from Saved Events" aria-label="Remove ${safeTitle} from Saved Events">✕</button>
          </div>
        </div>
        ${expandedCardHtml}
      </div>
    `;
  }).join('');

  totalEl.textContent = `$${formatCompactDollarNum(totalCost)}`;
  if (statusEl) {
    statusEl.innerHTML = totalCost <= 50.00
      ? `<span style="color: #0f766e; font-weight: 700;">$${formatCompactDollarNum(50 - totalCost)} remaining under $50 target</span>`
      : `<span style="color: #e11d48; font-weight: 700;">$${formatCompactDollarNum(totalCost - 50)} over $50 outing target</span>`;
    const meterFill = document.getElementById('itinerary-budget-meter-fill');
    if (meterFill) {
      const pct = Math.min(100, Math.max(0, (totalCost / 50) * 100));
      meterFill.style.width = `${pct}%`;
      meterFill.style.background = totalCost <= 50 ? '#10b981' : '#e11d48';
    }
  }
}

window.toggleSavedCardExpand = function (eventId, domEv) {
  if (domEv) {
    if (domEv.target && domEv.target.closest('.btn-remove-item')) return;
    domEv.preventDefault();
    domEv.stopPropagation();
  }
  if (!eventId) return;
  if (!state.expandedSavedEvents) state.expandedSavedEvents = new Set();
  if (state.expandedSavedEvents.has(eventId)) {
    state.expandedSavedEvents.delete(eventId);
  } else {
    state.expandedSavedEvents.add(eventId);
  }
  renderItinerary();
};

window.clearSavedEvents = function () {
  state.savedEvents.clear();
  if (state.expandedSavedEvents) state.expandedSavedEvents.clear();
  persistSavedState();
  updateItineraryBadge();
  renderItinerary();
  applyFiltersAndRender();
};

// ==============================================================================
// CONCISE EMOJI-FREE SHARING & URL DEEP-LINK ENGINE (?event= & ?plan=)
// ==============================================================================

function stripEmojisAndExtraSpaces(str) {
  return String(str || '')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCanonicalShareBaseUrl() {
  if (typeof window !== 'undefined' && window.location && /^https?:$/i.test(window.location.protocol)) {
    return `${window.location.origin}${window.location.pathname}`;
  }
  return 'https://ausomegh.github.io/Van50/';
}

function getShortShareNeighborhood(ev) {
  return stripEmojisAndExtraSpaces(
    String((ev && (ev.neighborhood || ev.city || ev.venue)) || 'Vancouver')
      .split(' / ')[0]
      .split('/')[0]
      .split(',')[0]
      .split(' & ')[0]
  ) || 'Vancouver';
}

function getConciseSharePriceLabel(ev) {
  if (!ev) return '$0 CAD';
  if (ev.isFree || Number(ev.price) === 0) return 'Free';
  const raw = stripEmojisAndExtraSpaces(formatStandardPrice(ev));
  return raw || `$${Number(ev.price || 0).toFixed(Number(ev.price || 0) % 1 === 0 ? 0 : 2)} CAD`;
}

function getConciseShareTimeDisplay(ev) {
  if (!ev) return 'Upcoming';
  const topDate = formatCardTopDate(ev);
  const row2Time = stripEmojisAndExtraSpaces(getEventRow2TimeDisplay(ev, topDate));
  const dateBadge = topDate && topDate.badgeText ? stripEmojisAndExtraSpaces(topDate.badgeText) : '';
  if (dateBadge && !/^(daily|open daily|anytime)$/i.test(dateBadge)) {
    if (row2Time && row2Time !== 'All Day' && !dateBadge.toLowerCase().includes(row2Time.toLowerCase())) {
      return `${dateBadge}, ${row2Time}`;
    }
    return dateBadge;
  }
  return row2Time || dateBadge || 'Daily';
}

async function copyTextSilently(text) {
  if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(textarea);
  return ok;
}

function flashButtonCopied(btnEl, label = 'Copied ✓', durationMs = 1800) {
  if (!btnEl) return;
  if (!btnEl.dataset.origHtml) {
    btnEl.dataset.origHtml = btnEl.innerHTML;
  }
  if (btnEl._copiedResetTimer) {
    clearTimeout(btnEl._copiedResetTimer);
  }
  btnEl.classList.add('is-copied-inline');
  btnEl.textContent = label;
  btnEl._copiedResetTimer = setTimeout(() => {
    if (btnEl.dataset.origHtml) {
      btnEl.innerHTML = btnEl.dataset.origHtml;
      delete btnEl.dataset.origHtml;
    }
    btnEl.classList.remove('is-copied-inline');
    btnEl._copiedResetTimer = null;
  }, durationMs);
}

function canInvokeNativeShareSheet(sharePayload) {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare === 'function') {
    try {
      return navigator.canShare(sharePayload);
    } catch (_) {
      return true;
    }
  }
  return true;
}

window.shareSingleEventConcise = async function (eventId, btnEl, domEv) {
  if (domEv) {
    domEv.preventDefault();
    domEv.stopPropagation();
  }
  const catalog = window.currentActiveCatalog || ALL_EVENTS || [];
  const ev = catalog.find(e => e.id === eventId) || ALL_EVENTS.find(e => e.id === eventId);
  if (!ev) return;

  const targetBtn = btnEl || document.getElementById(`btn-share-${eventId}`);
  const cleanTitle = stripEmojisAndExtraSpaces(ev.title);
  const priceLabel = getConciseSharePriceLabel(ev);
  const shortNeighborhood = getShortShareNeighborhood(ev);
  const timeDisplay = getConciseShareTimeDisplay(ev);
  const shareUrl = `${getCanonicalShareBaseUrl()}?event=${encodeURIComponent(ev.id)}`;
  const conciseLine = `${cleanTitle} — ${priceLabel} (${shortNeighborhood} • ${timeDisplay})`;
  const clipboardPayload = `${conciseLine}\n${shareUrl}`;

  const nativePayload = {
    title: cleanTitle,
    text: conciseLine,
    url: shareUrl
  };

  if (canInvokeNativeShareSheet(nativePayload)) {
    try {
      await navigator.share(nativePayload);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }

  try {
    await copyTextSilently(clipboardPayload);
    flashButtonCopied(targetBtn, 'Copied share link!', 2000);
    if (typeof showToast === 'function') showToast('Copied share link!', 'info');
  } catch (_) { }
};
window.shareEvent = window.shareSingleEventConcise;

window.copyEventLinkOnly = async function (eventId, btnEl, domEv) {
  if (domEv) {
    domEv.preventDefault();
    domEv.stopPropagation();
  }
  const ev = (window.currentActiveCatalog || ALL_EVENTS || []).find(e => e.id === eventId) || ALL_EVENTS.find(e => e.id === eventId);
  if (!ev) return;
  const targetBtn = btnEl || document.getElementById(`btn-copy-link-${eventId}`);
  const shareUrl = `${getCanonicalShareBaseUrl()}?event=${encodeURIComponent(ev.id)}`;
  try {
    await copyTextSilently(shareUrl);
    flashButtonCopied(targetBtn, 'Copied ✓', 1800);
  } catch (_) { }
};

function buildSavedPlanShareData() {
  const savedEvents = ALL_EVENTS.filter(ev => state.savedEvents.has(ev.id));
  if (savedEvents.length === 0) return null;
  const totalCost = savedEvents.reduce((sum, ev) => sum + (Number(ev.price) || 0), 0);
  const savedIds = savedEvents.map(ev => encodeURIComponent(ev.id));
  const planUrl = `${getCanonicalShareBaseUrl()}?plan=${savedIds.join(',')}`;

  const shownEvents = savedEvents.slice(0, 5);
  const bullets = shownEvents.map(ev => {
    const cleanTitle = stripEmojisAndExtraSpaces(ev.title);
    const priceLabel = getConciseSharePriceLabel(ev);
    const shortNeighborhood = getShortShareNeighborhood(ev);
    return `• ${cleanTitle} — ${priceLabel} (${shortNeighborhood})`;
  });
  if (savedEvents.length > 5) {
    bullets.push(`• +${savedEvents.length - 5} more`);
  }

  const headerLine = `Outing Plan ($${totalCost.toFixed(0)} CAD total):`;
  const conciseText = `${headerLine}\n${bullets.join('\n')}`;
  return {
    title: `Outing Plan ($${totalCost.toFixed(0)} CAD total)`,
    conciseText,
    clipboardText: `${conciseText}\n${planUrl}`,
    planUrl
  };
}

window.shareOutingPlan = async function (btnEl) {
  const planData = buildSavedPlanShareData();
  if (!planData) return;
  const targetBtn = btnEl || document.getElementById('share-plan-btn');

  const nativePayload = {
    title: planData.title,
    text: planData.conciseText,
    url: planData.planUrl
  };

  if (canInvokeNativeShareSheet(nativePayload)) {
    try {
      await navigator.share(nativePayload);
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }

  try {
    await copyTextSilently(planData.clipboardText);
    flashButtonCopied(targetBtn, 'Copied share link!', 2000);
    if (typeof showToast === 'function') showToast('Copied share link!', 'info');
  } catch (_) { }
};

window.copyOutingPlanLinkOnly = async function (btnEl) {
  const planData = buildSavedPlanShareData();
  if (!planData) return;
  const targetBtn = btnEl || document.getElementById('copy-plan-link-btn');
  try {
    await copyTextSilently(planData.planUrl);
    flashButtonCopied(targetBtn, 'Copied ✓', 1800);
  } catch (_) { }
};

function copyItineraryToClipboard() {
  window.copyOutingPlanLinkOnly(document.getElementById('copy-plan-link-btn') || document.getElementById('copy-plan-btn'));
}

function renderSharedPlanBanner(sharedEvents) {
  const banner = document.getElementById('shared-plan-banner');
  if (!banner) return;
  if (!Array.isArray(state.sharedPlanIds) || state.sharedPlanIds.length === 0) {
    banner.hidden = true;
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }
  const list = Array.isArray(sharedEvents) ? sharedEvents : [];
  const totalCost = list.reduce((sum, ev) => sum + (Number(ev.price) || 0), 0);
  const allAlreadySaved = list.length > 0 && list.every(ev => state.savedEvents.has(ev.id));
  banner.hidden = false;
  banner.style.display = 'flex';
  banner.innerHTML = `
    <div class="shared-plan-banner-info">
      <strong class="shared-plan-banner-title">Shared Outing Plan</strong>
      <span class="shared-plan-banner-meta">${Number(list.length)} ${list.length === 1 ? 'outing' : 'outings'} • <strong>$${totalCost.toFixed(2)} CAD</strong> combined total</span>
    </div>
    <div class="shared-plan-banner-actions">
      <button type="button" class="btn-shared-plan-save" data-action="save-shared-plan">${allAlreadySaved ? 'Saved in My List ✓' : 'Save Plan to My List'}</button>
      <button type="button" class="btn-shared-plan-clear" data-action="clear-shared-plan">Show All Outings</button>
    </div>
  `;
}

window.saveSharedPlanToMyList = function (btnEl) {
  if (!Array.isArray(state.sharedPlanIds) || state.sharedPlanIds.length === 0) return;
  const validIds = new Set(ALL_EVENTS.map(e => e.id));
  state.sharedPlanIds.forEach(id => {
    if (validIds.has(id)) state.savedEvents.add(id);
  });
  persistSavedState();
  updateItineraryBadge();
  renderItinerary();
  applyFiltersAndRender();
  if (btnEl) {
    btnEl.textContent = 'Saved in My List ✓';
  }
};

window.clearSharedPlanView = function () {
  state.sharedPlanIds = null;
  syncFiltersToUrlParams();
  applyFiltersAndRender();
};

function hydrateDeepLinksFromUrl() {
  if (typeof window === 'undefined' || !window.location || !window.location.search) return;
  const params = new URLSearchParams(window.location.search);

  // Hydrate ?event=<id> on initial load AND across async loadCentralReference() re-render
  if (params.has('event')) {
    const rawId = sanitizeUrlEventIdToken(params.get('event') || '');
    if (!rawId) return;
    const nowMs = Date.now();
    const isInitialHydration = window._hydratedDeepLinkEventId !== rawId;
    const withinHighlightWindow = Boolean(
      window._hydratedDeepLinkEventId === rawId &&
      window._hydratedDeepLinkAt &&
      (nowMs - window._hydratedDeepLinkAt) < 2000
    );
    if (!isInitialHydration && !withinHighlightWindow) return;

    const targetEv = (window.currentActiveCatalog || ALL_EVENTS || []).find(e => e.id === rawId)
      || (ALL_EVENTS || []).find(e => e.id === rawId);
    if (!targetEv) return;

    if (!state.expandedCardIds) state.expandedCardIds = new Set();
    state.expandedCardIds.add(targetEv.id);

    if (typeof window.ensureEventCardRendered === 'function') {
      window.ensureEventCardRendered(targetEv.id);
    }
    let cardEl = document.getElementById(`card-${targetEv.id}`);
    if (!cardEl && isInitialHydration) {
      // Clear conflicting filters so the target event is guaranteed visible
      state.sharedPlanIds = null;
      state.selectedRegions.clear();
      syncRegionStateString();
      state.minBudget = 0;
      state.maxBudget = 50;
      state.category = 'all';
      state.selectedThemeFilter = null;
      if (state.excludedThemes) state.excludedThemes.clear();
      state.hideFestivalEvents = false;
      state.hideDaily = false;
      state.accessibleOnly = false;
      state.seniorDealsOnly = false;
      state.includeReligious = true;
      state.dayOfWeek = 'all';
      state.frequency = 'all';
      state.selectedTag = null;
      state.selectedVenue = null;
      state.searchQuery = '';
      if (state.collapsedTimeGroups) state.collapsedTimeGroups.clear();
      if (typeof window.syncDrawerAccessToggles === 'function') window.syncDrawerAccessToggles();
      renderRegionPills();
      renderFestivalSpotlight();
      renderCategoryPills();
      renderDayPills();
      renderFrequencyPills();
      updateSliderVisuals();
      applyFiltersAndRender();
      cardEl = document.getElementById(`card-${targetEv.id}`);
    }

    if (cardEl) {
      if (isInitialHydration) {
        window._hydratedDeepLinkEventId = targetEv.id;
        window._hydratedDeepLinkAt = nowMs;
      }
      const remainingMs = Math.max(300, 2000 - (nowMs - (window._hydratedDeepLinkAt || nowMs)));
      cardEl.classList.add('mobile-expanded', 'desktop-expanded', 'deep-link-highlight');
      cardEl.style.boxShadow = '0 0 0 2px var(--brand-primary)';
      setTimeout(() => {
        const freshCard = document.getElementById(`card-${targetEv.id}`);
        if (freshCard) freshCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 60);
      if (window._deepLinkHighlightClearTimer) clearTimeout(window._deepLinkHighlightClearTimer);
      window._deepLinkHighlightClearTimer = setTimeout(() => {
        const freshCard = document.getElementById(`card-${targetEv.id}`);
        if (freshCard) {
          freshCard.classList.remove('deep-link-highlight');
          freshCard.style.boxShadow = '';
        }
      }, remainingMs);
    }
  }
}
window.hydrateDeepLinksFromUrl = hydrateDeepLinksFromUrl;

// ==============================================================================
// 7. MANUAL REVIEW QUARANTINE QUEUE LOGIC
// ==============================================================================

function updateReviewQueueBadge() {
  const container = document.getElementById('curator-footer-container');
  const curatorLink = document.getElementById('btn-open-review-queue');
  const badge = document.getElementById('review-queue-count');
  const items = (typeof MANUAL_REVIEW_QUEUE !== 'undefined') ? MANUAL_REVIEW_QUEUE : [];
  if (badge) {
    badge.textContent = items.length;
  }
  // Reveal curator portal button only if ?curator=1, ?curator=true, ?admin=1, or ?admin=true is present
  const urlParams = new URLSearchParams(window.location.search);
  const curatorVal = String(urlParams.get('curator') || '').toLowerCase();
  const adminVal = String(urlParams.get('admin') || '').toLowerCase();
  const hasExplicitCuratorParam = curatorVal === '1' || curatorVal === 'true' || adminVal === '1' || adminVal === 'true';
  const isCurator = hasExplicitCuratorParam || Boolean(sessionStorage.getItem('van50_curator_token'));
  document.body.classList.toggle('admin-mode-enabled', isCurator);
  if (container) {
    container.hidden = !hasExplicitCuratorParam;
    container.style.display = hasExplicitCuratorParam ? 'block' : 'none';
  }
  if (curatorLink) {
    curatorLink.hidden = !hasExplicitCuratorParam;
  }
  const headerPreviewBtn = document.getElementById('header-curator-preview-btn');
  if (headerPreviewBtn) {
    headerPreviewBtn.hidden = !hasExplicitCuratorParam;
    headerPreviewBtn.classList.toggle('is-curator-visible', hasExplicitCuratorParam);
    headerPreviewBtn.style.display = hasExplicitCuratorParam ? 'inline-flex' : 'none';
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
        <h4 style="color: var(--text-main); font-size: 1.1rem; margin-bottom: 6px;">All Events Live Verified</h4>
        <p style="font-size: 0.85rem;">There are currently zero events quarantined for manual review. All catalog items have confirmed live check-out pricing.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = items.map(q => `
    <div class="quarantined-card">
      <div class="quarantined-card-header">
        <div>
          <h3 class="quarantined-card-title">${escapeHtml(q.title)}</h3>
          <div class="quarantined-card-venue">📍 ${escapeHtml(q.venue)} (${escapeHtml(q.neighborhood || 'Vancouver')})</div>
        </div>
        <span class="quarantined-flag-badge">⚠️ QUARANTINED</span>
      </div>

      <div class="quarantined-reason-box">
        <strong>Reason Flagged:</strong> ${escapeHtml(q.flagReason)}
      </div>

      <div class="quarantined-meta-row">
        <div>
          <span style="color: var(--text-muted);">Attempted Price:</span>
          <span style="color: #f59e0b; font-weight: 700; margin-left: 4px;">${escapeHtml(q.attemptedPriceLabel)}</span>
          <span style="color: var(--text-muted); margin-left: 8px;">Provider: ${escapeHtml(q.provider)}</span>
        </div>
        <a 
          href="${escapeHtml(safeExternalUrl(q.websiteUrl))}" 
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
    if (isAccessible) state.accessibleOnly = true;
  } catch (e) { }
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
      label.textContent = state.accessibleMode ? 'Accessible Venues: ON' : 'Accessible Venues';
    }
  }

  try {
    localStorage.setItem('van50_accessible_mode', state.accessibleMode ? 'true' : 'false');
  } catch (e) { }

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
// UNIFIED, CONTEXT-AWARE "SUGGEST / REPORT" MODAL
// ==============================================================================

function setSuggestReportMode(mode) {
  const validModes = ['price_status', 'fix_details', 'suggest_event', 'general_note'];
  const activeMode = validModes.includes(mode) ? mode : 'suggest_event';
  const modeInput = document.getElementById('sr-mode-input');
  if (modeInput) modeInput.value = activeMode;

  document.querySelectorAll('.sr-mode-tab').forEach(tab => {
    const isMatch = tab.getAttribute('data-sr-mode') === activeMode;
    tab.classList.toggle('active', isMatch);
    tab.setAttribute('aria-selected', isMatch ? 'true' : 'false');
  });

  document.querySelectorAll('.sr-mode-panel').forEach(panel => {
    const isMatch = panel.getAttribute('data-sr-panel') === activeMode;
    panel.style.display = isMatch ? 'flex' : 'none';
  });

  const submitBtn = document.getElementById('btn-submit-suggest-report');
  if (submitBtn && !submitBtn.disabled) {
    const labels = {
      price_status: 'Submit Price / Status',
      fix_details: 'Submit Correction',
      suggest_event: 'Suggest Event',
      general_note: 'Send Note'
    };
    submitBtn.textContent = labels[activeMode] || 'Send Submission';
  }
}

function openSuggestReportModal(options = {}) {
  const modal = document.getElementById('suggest-report-modal');
  if (!modal) return;

  const opts = (typeof options === 'string') ? { mode: 'general_note', presetText: options } : (options || {});
  const form = document.getElementById('suggest-report-form');
  if (form) form.reset();

  modal.querySelectorAll('.sr-flag-pill').forEach(pill => {
    pill.classList.remove('active');
    pill.setAttribute('aria-pressed', 'false');
  });

  const ticketAllIn = document.getElementById('sr-ticket-all-in');
  if (ticketAllIn) ticketAllIn.checked = true;
  const drinkDetails = document.getElementById('sr-drink-details');
  if (drinkDetails) drinkDetails.open = false;

  let ev = null;
  if (opts.eventId) {
    const pool = (Array.isArray(window.currentActiveCatalog) && window.currentActiveCatalog.length > 0)
      ? window.currentActiveCatalog
      : (window.ALL_EVENTS || []);
    ev = pool.find(e => String(e.id || e.event_id) === String(opts.eventId)) || null;
  }

  const eventId = opts.eventId || (ev ? (ev.id || ev.event_id || '') : '');
  const eventTitle = opts.eventTitle || (ev ? (ev.title || ev.event_name || '') : '');
  const venue = opts.venue || (ev ? (ev.venue_name || ev.venue || ev.location || '') : '');
  const city = opts.city || (ev ? (ev.city || ev.region || 'Vancouver') : '');
  const listedPriceNum = ev ? Number(ev.price_all_in ?? ev.price ?? 0) : null;
  const listedPrice = opts.listedPrice || (ev ? (listedPriceNum === 0 ? 'Free ($0)' : `$${listedPriceNum.toFixed(2).replace(/\.00$/, '')}`) : '');

  const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
  setVal('sr-event-id', eventId);
  setVal('sr-event-title', eventTitle);
  setVal('sr-venue', venue);
  setVal('sr-city', city);
  setVal('sr-listed-price', listedPrice);
  setVal('sr-hp', '');

  const contextBanner = document.getElementById('sr-context-banner');
  const contextText = document.getElementById('sr-context-text');
  if (contextBanner && contextText) {
    if (eventTitle || venue) {
      const parts = [];
      if (eventTitle) parts.push(eventTitle);
      if (venue) parts.push(city ? `${venue} (${city})` : venue);
      if (listedPrice) parts.push(`Listed: ${listedPrice} All-In`);
      contextText.textContent = parts.join(' • ');
      contextBanner.style.display = 'flex';
    } else {
      contextText.textContent = '';
      contextBanner.style.display = 'none';
    }
  }

  const defaultMode = opts.mode || ((eventId || venue) ? 'price_status' : 'suggest_event');
  setSuggestReportMode(defaultMode);

  if (opts.presetText) {
    const targetInput = defaultMode === 'fix_details'
      ? document.getElementById('sr-fix-details')
      : document.getElementById('sr-general-message');
    if (targetInput) targetInput.value = opts.presetText;
  }

  const alertBox = document.getElementById('sr-status-alert');
  if (alertBox) {
    alertBox.style.display = 'none';
    alertBox.textContent = '';
  }
  const submitBtn = document.getElementById('btn-submit-suggest-report');
  if (submitBtn) submitBtn.disabled = false;
  setSuggestReportMode(defaultMode);

  modal.classList.add('active');
  modal.setAttribute('aria-hidden', 'false');
  modal.removeAttribute('inert');
  document.body.style.overflow = 'hidden';
  if (typeof window.pushOverlayHistoryState === 'function') {
    window.pushOverlayHistoryState('suggest_report');
  }
}

function closeSuggestReportModal(fromPopState = false) {
  const modal = document.getElementById('suggest-report-modal');
  if (!modal) return;
  const wasOpen = modal.classList.contains('active');
  modal.classList.remove('active');
  modal.setAttribute('aria-hidden', 'true');
  modal.setAttribute('inert', '');
  document.body.style.overflow = '';
  if (wasOpen && typeof window.popOverlayHistoryState === 'function') {
    window.popOverlayHistoryState('suggest_report', fromPopState);
  }
}

function openFeedbackModal(presetText = '', targetEventId = '') {
  openSuggestReportModal({
    mode: targetEventId ? 'fix_details' : 'suggest_event',
    eventId: targetEventId || '',
    presetText: presetText || ''
  });
}

function initSuggestReportModal() {
  const modal = document.getElementById('suggest-report-modal');
  const form = document.getElementById('suggest-report-form');
  const closeBtn = document.getElementById('close-suggest-report-btn');
  const cancelBtn = document.getElementById('btn-cancel-suggest-report');
  const navBtn = document.getElementById('feedback-nav-btn');
  const footerBtn = document.getElementById('feedback-footer-btn');

  if (navBtn) navBtn.addEventListener('click', () => openSuggestReportModal({ mode: 'suggest_event' }));
  if (footerBtn) footerBtn.addEventListener('click', () => openSuggestReportModal({ mode: 'suggest_event' }));
  document.querySelectorAll('[data-open-feedback]').forEach(el => {
    el.addEventListener('click', () => openSuggestReportModal({ mode: 'suggest_event' }));
  });

  if (closeBtn) closeBtn.addEventListener('click', () => closeSuggestReportModal(false));
  if (cancelBtn) cancelBtn.addEventListener('click', () => closeSuggestReportModal(false));
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeSuggestReportModal(false);
    });
    modal.querySelectorAll('.sr-mode-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        setSuggestReportMode(tab.getAttribute('data-sr-mode') || 'suggest_event');
      });
    });
    modal.querySelectorAll('.sr-flag-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        const nextState = !pill.classList.contains('active');
        pill.classList.toggle('active', nextState);
        pill.setAttribute('aria-pressed', nextState ? 'true' : 'false');
      });
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.classList.contains('active')) {
      closeSuggestReportModal(false);
    }
  });

  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const alertBox = document.getElementById('sr-status-alert');
    const submitBtn = document.getElementById('btn-submit-suggest-report');
    const hpVal = (document.getElementById('sr-hp')?.value || '').trim();
    if (hpVal !== '') {
      closeSuggestReportModal(false);
      return;
    }

    const showAlert = (msg, type = 'error') => {
      if (!alertBox) return;
      const styles = {
        error: ['rgba(239,68,68,0.15)', 'rgba(239,68,68,0.4)', '#ef4444'],
        warn: ['rgba(245,158,11,0.15)', 'rgba(245,158,11,0.4)', '#d97706'],
        success: ['rgba(16,185,129,0.15)', 'rgba(16,185,129,0.4)', '#059669']
      };
      const [bg, bd, fg] = styles[type] || styles.error;
      alertBox.style.display = 'block';
      alertBox.style.background = bg;
      alertBox.style.border = `1px solid ${bd}`;
      alertBox.style.color = fg;
      alertBox.textContent = msg;
    };

    const mode = document.getElementById('sr-mode-input')?.value || 'suggest_event';
    const cooldownKey = mode === 'price_status' ? 'price_feedback' : 'community_feedback';
    const cooldownSec = getFormCooldownRemainingSec(cooldownKey);
    if (cooldownSec > 0) {
      showAlert(`Please wait ${cooldownSec}s before sending another submission.`, 'warn');
      return;
    }

    const eventId = sanitizeUrlEventIdToken(document.getElementById('sr-event-id')?.value || '');
    const eventTitle = (document.getElementById('sr-event-title')?.value || '').trim().slice(0, 180);
    const venue = (document.getElementById('sr-venue')?.value || '').trim().slice(0, 160);
    const city = (document.getElementById('sr-city')?.value || '').trim().slice(0, 80);
    const listedPrice = (document.getElementById('sr-listed-price')?.value || '').trim().slice(0, 40);
    const pageUrl = (typeof window !== 'undefined' && window.location) ? window.location.href : '';

    const getActiveFlags = (panelId) => {
      const panel = document.getElementById(panelId);
      if (!panel) return [];
      return Array.from(panel.querySelectorAll('.sr-flag-pill.active')).map(p => p.getAttribute('data-sr-flag') || '').filter(Boolean);
    };

    let endpoint = '/api/feedback';
    let payload = null;

    if (mode === 'price_status') {
      const quickFlags = getActiveFlags('sr-panel-price_status');
      const parseNum = (id) => {
        const raw = (document.getElementById(id)?.value || '').trim();
        if (!raw) return null;
        const n = parseFloat(raw);
        return isNaN(n) ? null : n;
      };
      const ticketPrice = parseNum('sr-ticket-price');
      const seniorPrice = parseNum('sr-senior-price');
      const pintPrice = parseNum('sr-pint-price');
      const cocktailPrice = parseNum('sr-cocktail-price');
      const isAllIn = Boolean(document.getElementById('sr-ticket-all-in')?.checked);
      const drinkIsAllIn = Boolean(document.getElementById('sr-drink-all-in')?.checked);
      const note = (document.getElementById('sr-price-note')?.value || '').trim().slice(0, 250);

      if (quickFlags.length === 0 && ticketPrice === null && seniorPrice === null && pintPrice === null && cocktailPrice === null && !note) {
        showAlert('Tap at least one quick flag or enter a ticket, senior, or drink price.');
        return;
      }

      endpoint = '/api/suggest-price';
      payload = {
        type: 'price_update',
        venue_name: venue || eventTitle || 'Unspecified Venue',
        venue: venue || '',
        eventId,
        eventTitle,
        city,
        listedPrice,
        ticketPrice,
        seniorPrice,
        quickFlags,
        cheapest_pint_input: pintPrice,
        cheapest_cocktail_input: cocktailPrice,
        is_all_in: isAllIn,
        drink_is_all_in: drinkIsAllIn,
        note,
        pageUrl,
        page_url: pageUrl,
        honeypot: hpVal
      };
    } else if (mode === 'fix_details') {
      const quickFlags = getActiveFlags('sr-panel-fix_details');
      const details = (document.getElementById('sr-fix-details')?.value || '').trim().slice(0, 1000);
      if (quickFlags.length === 0 && !details) {
        showAlert('Select at least one issue flag or describe what needs fixing.');
        return;
      }
      const ctx = [eventTitle, venue ? `${venue}${city ? ` (${city})` : ''}` : ''].filter(Boolean).join(' • ');
      const lines = [
        ctx ? `Event: ${ctx}` : '',
        quickFlags.length ? `Flags: ${quickFlags.join(', ')}` : '',
        details ? `Details: ${details}` : ''
      ].filter(Boolean).join('\n');
      payload = {
        type: 'feedback',
        submission_type: 'correction',
        category: 'Fix Details',
        target_event_id: eventId,
        eventId,
        eventTitle,
        venue,
        city,
        listedPrice,
        message: `[Fix Details] ${lines}`,
        pageUrl,
        page_url: pageUrl,
        hp_field: hpVal
      };
    } else if (mode === 'suggest_event') {
      const name = (document.getElementById('sr-suggest-name')?.value || '').trim().slice(0, 160);
      const sCity = (document.getElementById('sr-suggest-city')?.value || 'Vancouver').trim();
      const sPrice = (document.getElementById('sr-suggest-price')?.value || '').trim();
      const sUrl = (document.getElementById('sr-suggest-url')?.value || '').trim().slice(0, 300);
      const sNotes = (document.getElementById('sr-suggest-notes')?.value || '').trim().slice(0, 1000);
      if (!name) {
        showAlert('Please enter the Event or Venue Name.');
        return;
      }
      const lines = [
        `Name: ${name}`,
        `City: ${sCity}`,
        sPrice ? `Approx. All-In Price: $${sPrice}` : '',
        sUrl ? `URL: ${sUrl}` : '',
        sNotes ? `Notes: ${sNotes}` : ''
      ].filter(Boolean).join('\n');
      payload = {
        type: 'feedback',
        submission_type: 'event_suggestion',
        category: 'Suggest Event',
        title: name,
        target_event_id: eventId,
        message: `[Suggest Event] ${lines}`,
        pageUrl,
        page_url: pageUrl,
        hp_field: hpVal
      };
    } else {
      const msg = (document.getElementById('sr-general-message')?.value || '').trim().slice(0, 2000);
      const email = (document.getElementById('sr-contact-email')?.value || '').trim().slice(0, 160);
      if (!msg) {
        showAlert('Please enter your message.');
        return;
      }
      const fullMsg = email ? `[General Note] ${msg}\nReply Email: ${email}` : `[General Note] ${msg}`;
      payload = {
        type: 'feedback',
        submission_type: 'general_comment',
        category: 'General Note',
        target_event_id: eventId,
        message: fullMsg,
        pageUrl,
        page_url: pageUrl,
        hp_field: hpVal
      };
    }

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting...';
    }

    const sendGoogleSheetFallback = async () => {
      try {
        const gsResult = await submitToGoogleAppsScript(payload);
        if (gsResult.configured && gsResult.ok) {
          recordFormSubmissionTimestamp(cooldownKey);
          showAlert('✓ Thank you! Your submission has been saved for Van50 review.', 'success');
          if (submitBtn) submitBtn.textContent = '✓ Submitted';
          setTimeout(() => closeSuggestReportModal(false), 1600);
          return;
        }
      } catch (_) { }
      showAlert('Submissions endpoint not yet connected. Check van50-submissions-url in index.html.', 'warn');
      if (submitBtn) {
        submitBtn.disabled = false;
        setSuggestReportMode(mode);
      }
    };

    const isLocalHost = typeof window !== 'undefined' && /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
    if (!isLocalHost && getVan50SubmissionsUrl()) {
      await sendGoogleSheetFallback();
      return;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.status === 404 || res.status === 405) {
        await sendGoogleSheetFallback();
        return;
      }
      const data = await res.json();
      if (res.ok && data.success) {
        recordFormSubmissionTimestamp(cooldownKey);
        showAlert('✓ ' + (data.message || 'Thank you! Your submission has been received.'), 'success');
        if (submitBtn) submitBtn.textContent = '✓ Submitted';
        setTimeout(() => closeSuggestReportModal(false), 1600);
      } else {
        showAlert('⚠️ ' + (data.error || 'Failed to submit. Please try again.'));
        if (submitBtn) {
          submitBtn.disabled = false;
          setSuggestReportMode(mode);
        }
      }
    } catch (_) {
      await sendGoogleSheetFallback();
    }
  });
}

window.openSuggestReportModal = openSuggestReportModal;
window.closeSuggestReportModal = closeSuggestReportModal;
window.setSuggestReportMode = setSuggestReportMode;
window.openFeedbackModal = openFeedbackModal;
window.reportEventIssue = function (eventId, eventTitle) {
  openSuggestReportModal({ mode: 'fix_details', eventId: eventId || '', eventTitle: eventTitle || '' });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initSuggestReportModal);
} else {
  initSuggestReportModal();
}


// ==============================================================================
// VAN50 MOBILE UI & UX REFACTOR HELPERS (Active Filter Chips & Card Accordion)
// ==============================================================================

function renderActiveFilterChips(filteredCount) {
  if (typeof window.syncTopQuickToggles === 'function') {
    window.syncTopQuickToggles();
  }
  const chipsContainer = document.getElementById('active-filter-chips');
  const mobileFilterTrigger = document.getElementById('mobile-filter-trigger');
  const mobileSheetApplyBtn = document.getElementById('mobile-sheet-apply-btn');

  if (mobileSheetApplyBtn && typeof filteredCount === 'number') {
    if (filteredCount === 0) {
      mobileSheetApplyBtn.textContent = '0 Matches — Adjust Filters';
      mobileSheetApplyBtn.classList.add('is-zero-matches');
    } else {
      mobileSheetApplyBtn.textContent = `Show ${filteredCount} Outing${filteredCount === 1 ? '' : 's'}`;
      mobileSheetApplyBtn.classList.remove('is-zero-matches');
    }
  }

  const chips = [];
  if (state.category && state.category !== 'all') {
    const cDef = (window.CATEGORIES || []).find(c => c.id === state.category) || QUICK_CATEGORY_ITEMS.find(c => c.id === state.category);
    chips.push({ key: 'category', label: cDef ? (cDef.shortLabel || cDef.label) : state.category });
  }
  if (state.selectedThemeFilter) {
    const meta = getThemeMetadata({
      key: state.selectedThemeFilter,
      id: String(state.selectedThemeFilter).split(':')[1] || state.selectedThemeFilter,
      type: String(state.selectedThemeFilter).split(':')[0] || 'festival'
    });
    const themeLabel = meta
      ? (String(meta.label || '').startsWith(meta.icon || '___') ? meta.label : `${meta.icon || ''} ${meta.label}`.trim())
      : state.selectedThemeFilter;
    chips.push({ key: 'theme', label: themeLabel });
  }
  if (state.excludedThemes && state.excludedThemes.size > 0) {
    Array.from(state.excludedThemes).forEach(tk => {
      const meta = getThemeMetadata({ key: tk, id: String(tk).split(':')[1] || tk, type: String(tk).split(':')[0] || 'festival' });
      chips.push({ key: 'exTheme:' + tk, label: 'Hide ' + (meta ? meta.label : tk) });
    });
  }

  // 1. Spend / Cost Filter
  if (state.minBudget !== 0 || state.maxBudget !== 50) {
    let costLabel = `$${state.minBudget}–$${state.maxBudget}`;
    if (state.minBudget === 0 && state.maxBudget === 0) costLabel = 'Free ($0)';
    else if (state.minBudget === 0 && state.maxBudget === 15) costLabel = 'Under $15';
    else if (state.minBudget === 0 && state.maxBudget === 25) costLabel = 'Under $25';
    else if (state.minBudget === 0 && state.maxBudget === 30) costLabel = 'Under $30';
    else if (state.minBudget >= 1 && state.maxBudget === 50) costLabel = 'Paid Only';
    chips.push({ key: 'cost', label: costLabel });
  }

  // 2. Selected Calendar Date & Day of the Week
  if (state.selectedDate) {
    let dateChipLabel = state.selectedDate === 'weekend' ? '📅 This Weekend' : `📅 ${state.selectedDate}`;
    if (state.selectedDate !== 'weekend') {
      const pd = new Date(`${state.selectedDate}T12:00:00`);
      if (!isNaN(pd.getTime())) {
        dateChipLabel = `📅 ${pd.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`;
      }
    }
    chips.push({ key: 'date', label: dateChipLabel });
  }
  if (state.dayOfWeek && state.dayOfWeek !== 'all') {
    const dayDef = (window.DAYS_OF_WEEK || []).find(d => d.id === state.dayOfWeek);
    chips.push({ key: 'day', label: dayDef ? dayDef.label : state.dayOfWeek });
  }

  // 5. Recurrence Frequency
  if (state.frequency && state.frequency !== 'all') {
    const freqDef = (typeof FREQUENCIES !== 'undefined' ? FREQUENCIES : []).find(f => f.id === state.frequency);
    chips.push({ key: 'frequency', label: freqDef ? freqDef.label : state.frequency });
  }

  // 6. Hide Anytime Drop-Ins
  if (state.hideDaily) {
    chips.push({ key: 'hideDaily', label: 'Hide Anytime Drop-Ins' });
  }

  // 7. Senior Deals & 55+
  if (state.seniorDealsOnly) {
    chips.push({ key: 'seniorDeals', label: 'Senior Deals & 55+' });
  }

  // 7b. Accessible Venues Only (Top Header Toggle)
  if (state.accessibleOnly) {
    chips.push({ key: 'accessibleOnly', label: 'Accessible Venues' });
  }

  // 8. Single Religious Events Toggle (when toggled OFF)
  if (state.includeReligious === false) {
    chips.push({ key: 'noReligious', label: 'No Religious Events' });
  }

  // Count filters located inside the Filters drawer (Category, Spend, Senior Deals & 55+, No Religious Events)
  const drawerKeys = new Set(['category', 'cost', 'seniorDeals', 'noReligious']);
  const drawerActiveCount = chips.filter(c => drawerKeys.has(c.key)).length;
  if (mobileFilterTrigger) {
    const labelText = drawerActiveCount > 0 ? `Filters (${drawerActiveCount})` : 'Filters';
    const triggerLabelEl = document.getElementById('mobile-filter-trigger-label') || mobileFilterTrigger.querySelector('span');
    if (triggerLabelEl) {
      triggerLabelEl.textContent = labelText;
    } else {
      mobileFilterTrigger.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="4" y1="6" x2="20" y2="6"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="10" y1="18" x2="14" y2="18"/></svg><span id="mobile-filter-trigger-label">${escapeHtml(labelText)}</span>`;
    }
    mobileFilterTrigger.classList.toggle('has-active-filters', drawerActiveCount > 0);
  }

  if (!chipsContainer) return;

  if (chips.length === 0) {
    chipsContainer.style.display = 'none';
    chipsContainer.innerHTML = '';
    return;
  }

  chipsContainer.style.display = 'flex';
  chipsContainer.innerHTML = chips.map(c => {
    const safeKeyAttr = escapeHtml(c.key);
    const safeLabel = escapeHtml(c.label);
    return `
      <button type="button" class="active-filter-chip" data-action="dismiss-filter-chip" data-chip-key="${safeKeyAttr}" title="Remove ${safeLabel} filter" aria-label="Remove ${safeLabel} filter">
        <span>${safeLabel}</span>
        <span class="chip-dismiss" aria-hidden="true">×</span>
      </button>
    `;
  }).join('');
}

window.dismissSecondaryFilterChip = function (chipKey) {
  if (!chipKey) return;
  if (chipKey === 'category') {
    state.category = 'all';
    renderCategoryPills();
  } else if (chipKey === 'theme') {
    state.selectedThemeFilter = null;
    renderFestivalSpotlight();
  } else if (chipKey.startsWith('exTheme:')) {
    const tk = chipKey.slice(8);
    if (state.excludedThemes) state.excludedThemes.delete(tk);
    renderFestivalSpotlight();
  } else if (chipKey === 'noReligious' || chipKey === 'eventFocus') {
    state.includeReligious = true;
    if (typeof window.syncDrawerAccessToggles === 'function') window.syncDrawerAccessToggles();
  }
  if (chipKey === 'cost') {
    state.minBudget = 0;
    state.maxBudget = 50;
    clearActiveQuickButtons();
    updateSliderVisuals();
  } else if (chipKey === 'date') {
    state.selectedDate = '';
    if (typeof window.renderCalendarDatePicker === 'function') window.renderCalendarDatePicker();
  } else if (chipKey === 'day') {
    state.dayOfWeek = 'all';
    renderDayPills();
  } else if (chipKey === 'frequency') {
    state.frequency = 'all';
    renderFrequencyPills();
  } else if (chipKey === 'hideDaily') {
    state.hideDaily = false;
    const hideDailyToggle = document.getElementById('hide-daily-toggle');
    if (hideDailyToggle) hideDailyToggle.checked = false;
    if (typeof window.syncTopQuickToggles === 'function') window.syncTopQuickToggles();
  } else if (chipKey === 'seniorDeals') {
    state.seniorDealsOnly = false;
    if (typeof window.syncDrawerAccessToggles === 'function') window.syncDrawerAccessToggles();
  } else if (chipKey === 'accessibleOnly') {
    state.accessibleOnly = false;
    if (state.accessibleMode) setAccessibilityMode(false, false);
    if (typeof window.syncDrawerAccessToggles === 'function') window.syncDrawerAccessToggles();
  }
  applyFiltersAndRender();
};

window.hydrateLazyEventCardBody = function (cardEl, eventId) {
  if (!cardEl) return;
  const detailsEl = cardEl.querySelector('.card-expandable-details[data-lazy-body="1"]');
  if (!detailsEl) return;
  const ev = (window.currentActiveCatalog || ALL_EVENTS).find(e => e.id === eventId)
    || (ALL_EVENTS || []).find(e => e.id === eventId);
  if (!ev) return;
  const bucketKey = cardEl.getAttribute('data-bucket-key') || 'list';
  const fullHtml = renderSingleEventCardHtml(ev, bucketKey, { forceFullBody: true });
  const tpl = document.createElement('template');
  tpl.innerHTML = fullHtml.trim();
  const renderedDetails = tpl.content.querySelector('.card-expandable-details');
  if (renderedDetails) {
    detailsEl.innerHTML = renderedDetails.innerHTML;
  }
  detailsEl.removeAttribute('data-lazy-body');
};

window.toggleMobileCardAccordion = function (eventId, evObj) {
  // Prevent accidental collapse when user is highlighting/selecting text inside the card
  if (typeof window !== 'undefined' && window.getSelection && window.getSelection().toString().length > 0) {
    return;
  }
  const cardEl = document.getElementById(`card-${eventId}`);
  if (!cardEl) return;
  if (evObj && evObj.target) {
    const interactiveEl = evObj.target.closest('a, button, input, select, textarea, label, [role="button"], .card-expanded-tiers, .collapsible-hours, .collapsible-showings, .price-box-interactive, .weekly-hours-summary-row, .showings-summary-row');
    if (interactiveEl && interactiveEl !== cardEl && !interactiveEl.classList.contains('mobile-card-compact-header')) {
      return;
    }
  }
  if (!state.expandedCardIds) state.expandedCardIds = new Set();
  const isDesktop = typeof window !== 'undefined' && window.innerWidth > 768;
  const expandClass = isDesktop ? 'desktop-expanded' : 'mobile-expanded';
  const willExpand = !cardEl.classList.contains(expandClass);
  if (willExpand) {
    window.hydrateLazyEventCardBody(cardEl, eventId);
  }
  const nowExpanded = cardEl.classList.toggle(expandClass);
  const compactHeader = cardEl.querySelector('.mobile-card-compact-header');
  if (compactHeader) {
    compactHeader.setAttribute('aria-expanded', nowExpanded ? 'true' : 'false');
  }
  if (nowExpanded) state.expandedCardIds.add(eventId);
  else state.expandedCardIds.delete(eventId);
};

// Keyboard accessibility (Enter / Space) on card primary toggle headers
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const headerEl = e.target && e.target.closest ? e.target.closest('.mobile-card-compact-header') : null;
  if (!headerEl || e.target !== headerEl) return;
  const cardEl = headerEl.closest('.event-card[data-event-id]');
  if (!cardEl) return;
  e.preventDefault();
  window.toggleMobileCardAccordion(cardEl.getAttribute('data-event-id') || '', null);
});

window.toggleMapInfoWindowCard = function (itemEl, evObj) {
  if (!itemEl) return;
  const isCurrentlyExpanded = itemEl.classList.contains('is-expanded');
  if (evObj && evObj.target) {
    const insideHeader = evObj.target.closest('.gmap-venue-iw-item-header');
    const interactiveEl = evObj.target.closest('a, button, input, label, .card-expanded-tiers, .collapsible-hours, .collapsible-showings, .price-box-interactive, .weekly-hours-summary-row, .showings-summary-row');
    if (interactiveEl && !insideHeader) {
      return;
    }
    if (isCurrentlyExpanded && !insideHeader && evObj.target.closest('.gmap-iw-expanded-card-mount')) {
      return;
    }
  }
  const eventId = itemEl.getAttribute('data-event-id') || '';
  const mountEl = itemEl.querySelector('.gmap-iw-expanded-card-mount');
  const hintEl = itemEl.querySelector('.gmap-iw-expand-hint');
  if (!mountEl) return;

  if (isCurrentlyExpanded) {
    itemEl.classList.remove('is-expanded');
    itemEl.setAttribute('aria-expanded', 'false');
    mountEl.style.display = 'none';
    if (hintEl) hintEl.textContent = 'Details & Tickets →';
    return;
  }

  if (!mountEl.dataset.hydrated) {
    const ev = (window.currentActiveCatalog || ALL_EVENTS).find(e => e.id === eventId)
      || (ALL_EVENTS || []).find(e => e.id === eventId);
    if (ev) {
      mountEl.innerHTML = renderSingleEventCardHtml(ev, 'map-iw', { forceFullBody: true });
      mountEl.dataset.hydrated = '1';
    }
  }
  itemEl.classList.add('is-expanded');
  itemEl.setAttribute('aria-expanded', 'true');
  mountEl.style.display = 'block';
  if (hintEl) hintEl.textContent = 'Shrink ▴';
};


// ==============================================================================
// STICKY SEARCH/FILTER BAR SCROLL SHADOW STATE
// ==============================================================================
window.updateScrollDateIndicator = function () {
  const stickyBar = document.getElementById('mobile-search-filter-bar');
  if (!stickyBar) return;
  const mapWrapperEl = document.getElementById('map-view-wrapper');
  const isMapActive = Boolean(mapWrapperEl && (mapWrapperEl.classList.contains('active') || mapWrapperEl.style.display === 'block'));
  const scrollY = window.scrollY || window.pageYOffset || 0;
  stickyBar.classList.toggle('is-scrolled', scrollY > 90 && !isMapActive);
};

let _lastStickyHeaderOffsetPx = null;
window.syncStickyHeaderOffset = function () {
  const searchBar = document.getElementById('mobile-search-filter-bar');
  const siteHeader = document.getElementById('main-header');
  let offset = 64;
  if (searchBar) {
    const barStyle = window.getComputedStyle(searchBar);
    const barTop = Math.max(0, parseFloat(barStyle.top) || 0);
    const barHeight = searchBar.getBoundingClientRect().height || 56;
    offset = Math.max(0, Math.floor(barTop + barHeight) - 1);
  } else if (siteHeader) {
    offset = Math.max(0, Math.floor(siteHeader.getBoundingClientRect().height || 64) - 1);
  }
  if (offset !== _lastStickyHeaderOffsetPx) {
    _lastStickyHeaderOffsetPx = offset;
    document.documentElement.style.setProperty('--sticky-header-offset', `${offset}px`);
  }
};

let _lastViewportWidth = window.innerWidth;
window.addEventListener('scroll', window.updateScrollDateIndicator, { passive: true });
window.addEventListener('resize', () => {
  // Ignore vertical-only resize events fired by iOS Safari's dynamic address bar mid-scroll
  const currentWidth = window.innerWidth;
  if (currentWidth !== _lastViewportWidth) {
    _lastViewportWidth = currentWidth;
    if (typeof window.syncStickyHeaderOffset === 'function') {
      window.syncStickyHeaderOffset();
    }
  }
  const mapWrapperEl = document.getElementById('map-view-wrapper');
  if (mapWrapperEl && mapWrapperEl.classList.contains('active') && typeof invalidateVancouverMap === 'function') {
    invalidateVancouverMap();
  }
}, { passive: true });

// ==============================================================================
// Interactive Calendar Date Picker (Inside Filters Drawer + Quick Results Trigger)
// ==============================================================================
(function initVan50CalendarPicker() {
  const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const now = new Date();
  let viewYear = now.getFullYear();
  let viewMonth = now.getMonth();

  function buildEventCountsByDate() {
    const counts = new Map();
    const list = (typeof ALL_EVENTS !== 'undefined' && Array.isArray(ALL_EVENTS)) ? ALL_EVENTS : [];
    const bump = (iso) => {
      if (!iso || iso.length < 10) return;
      const key = iso.slice(0, 10);
      counts.set(key, (counts.get(key) || 0) + 1);
    };
    for (const ev of list) {
      if (!ev) continue;
      if (ev.date) bump(String(ev.date));
      if (Array.isArray(ev.confirmedDates)) ev.confirmedDates.forEach(d => bump(String(d)));
      if (Array.isArray(ev.showings)) ev.showings.forEach(s => { if (s && s.date) bump(String(s.date)); });
    }
    return counts;
  }

  window.jumpToCalendarDate = function (val, opts = {}) {
    const closeSheet = opts.closeSheet !== false;
    if (closeSheet && typeof window.closeMobileFiltersSheet === 'function') {
      window.closeMobileFiltersSheet();
    }

    const doScroll = () => {
      const gridEl = document.getElementById('events-grid');
      if (!gridEl) return;
      const stickyOffset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-header-offset')) || 72;

      if (!val) {
        const topY = Math.max(0, gridEl.getBoundingClientRect().top + window.scrollY - stickyOffset - 8);
        window.scrollTo({ top: topY, behavior: 'smooth' });
        return;
      }

      // Resolve 'weekend' to Saturday (or Sunday if today is Sunday)
      let targetIso = val;
      if (val === 'weekend') {
        const todayNow = new Date();
        const dow = todayNow.getDay();
        const daysToSat = dow === 6 ? 0 : (dow === 0 ? 0 : (6 - dow));
        targetIso = toIso(new Date(todayNow.getFullYear(), todayNow.getMonth(), todayNow.getDate() + daysToSat));
      }

      const dateSections = Array.from(gridEl.querySelectorAll('section.date-group[data-iso-date]'))
        .filter(sec => /^\d{4}-\d{2}-\d{2}$/.test(sec.getAttribute('data-iso-date') || ''));
      if (dateSections.length === 0) return;

      let targetSec = dateSections.find(sec => sec.getAttribute('data-iso-date') === targetIso);
      if (!targetSec) {
        targetSec = dateSections.find(sec => (sec.getAttribute('data-iso-date') || '') >= targetIso)
          || dateSections[dateSections.length - 1];
      }
      if (!targetSec) return;

      const targetKey = targetSec.getAttribute('data-group-key');
      // If the jumped section was collapsed, expand it and re-locate it
      if (targetKey && state.collapsedTimeGroups && state.collapsedTimeGroups.has(targetKey)) {
        state.collapsedTimeGroups.delete(targetKey);
        if (typeof applyFiltersAndRender === 'function') applyFiltersAndRender();
        targetSec = document.getElementById(`group-${targetKey}`) || targetSec;
      }

      // Ensure the target date section (and the next one) has its cards rendered immediately
      const targetIdx = dateSections.indexOf(targetSec);
      const keysToHydrate = [targetKey];
      if (targetIdx >= 0 && dateSections[targetIdx + 1]) {
        keysToHydrate.push(dateSections[targetIdx + 1].getAttribute('data-group-key'));
      }
      keysToHydrate.forEach((bk) => {
        if (bk && typeof window.appendNextBucketBatch === 'function') {
          window.appendNextBucketBatch(bk, false);
        }
      });

      const scrollNow = () => {
        const freshSec = (targetKey && document.getElementById(`group-${targetKey}`)) || targetSec;
        if (!freshSec) return;
        const rect = freshSec.getBoundingClientRect();
        const targetY = Math.max(0, rect.top + window.scrollY - stickyOffset - 8);
        window.scrollTo({ top: targetY, behavior: 'smooth' });
        const hdr = freshSec.querySelector('.date-group-header');
        if (hdr) {
          hdr.classList.remove('date-jump-highlight');
          void hdr.offsetWidth;
          hdr.classList.add('date-jump-highlight');
          setTimeout(() => hdr.classList.remove('date-jump-highlight'), 1600);
        }
        if (typeof window.updateScrollDateIndicator === 'function') {
          setTimeout(() => window.updateScrollDateIndicator(), 350);
        }
      };

      requestAnimationFrame(scrollNow);
    };

    setTimeout(doScroll, closeSheet ? 140 : 40);
  };

  function setSelectedCalendarDate(val) {
    state.selectedDate = val || '';
    if (state.selectedDate) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(state.selectedDate)) {
        const pd = new Date(`${state.selectedDate}T12:00:00`);
        if (!isNaN(pd.getTime())) {
          viewYear = pd.getFullYear();
          viewMonth = pd.getMonth();
        }
      }
    }
    window.renderCalendarDatePicker();
    // Sync selected pill highlight across rendered date headers without filtering out other dates
    document.querySelectorAll('.date-group-pick-btn[data-pick-date]').forEach((btn) => {
      const isMatch = Boolean(state.selectedDate && btn.getAttribute('data-pick-date') === state.selectedDate);
      btn.classList.toggle('is-selected', isMatch);
      btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
    });
    if (typeof syncUrlWithFilters === 'function') syncUrlWithFilters();
    window.jumpToCalendarDate(state.selectedDate, { closeSheet: true });
  }

  window.renderCalendarDatePicker = function () {
    const grid = document.getElementById('calendar-days-grid');
    const monthLabel = document.getElementById('calendar-month-label');
    const summaryEl = document.getElementById('calendar-selected-summary');
    const dateInput = document.getElementById('calendar-date-input');
    const clearBtn = document.getElementById('calendar-clear-btn');
    if (!grid || !monthLabel) return;

    const today = new Date();
    const todayIso = toIso(today);
    const tomorrowIso = toIso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));

    // Sync Quick Presets
    const presetBtns = document.querySelectorAll('#date-quick-presets .date-preset-btn');
    presetBtns.forEach((btn) => {
      const p = btn.getAttribute('data-date-preset');
      let isActive = false;
      if (p === 'all') isActive = !state.selectedDate;
      else if (p === 'today') isActive = state.selectedDate === todayIso;
      else if (p === 'tomorrow') isActive = state.selectedDate === tomorrowIso;
      else if (p === 'weekend') isActive = state.selectedDate === 'weekend';
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    // Sync Summary, Native Input & Clear Button
    if (summaryEl) {
      if (!state.selectedDate) {
        summaryEl.textContent = 'All Upcoming Dates';
      } else if (state.selectedDate === 'weekend') {
        summaryEl.textContent = 'This Weekend (Sat & Sun)';
      } else {
        const pd = new Date(`${state.selectedDate}T12:00:00`);
        summaryEl.textContent = !isNaN(pd.getTime())
          ? pd.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
          : state.selectedDate;
      }
    }
    if (dateInput) {
      dateInput.min = todayIso;
      dateInput.value = /^\d{4}-\d{2}-\d{2}$/.test(state.selectedDate) ? state.selectedDate : '';
    }
    if (clearBtn) {
      clearBtn.style.display = state.selectedDate ? 'inline-flex' : 'none';
    }

    // Render Month Grid
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const startWeekday = firstOfMonth.getDay();
    monthLabel.textContent = firstOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    const countsByDate = buildEventCountsByDate();
    const cells = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push('<span class="calendar-day-spacer" aria-hidden="true"></span>');
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = iso === todayIso;
      const isSelected = state.selectedDate === iso;
      const isPast = iso < todayIso;
      const evCount = countsByDate.get(iso) || 0;
      const cls = [
        'calendar-day-btn',
        isToday ? 'is-today' : '',
        isSelected ? 'is-selected' : '',
        isPast ? 'is-past' : '',
        evCount > 0 ? 'has-events' : ''
      ].filter(Boolean).join(' ');
      const title = evCount > 0 ? `${iso} — ${evCount} scheduled event${evCount === 1 ? '' : 's'}` : iso;
      cells.push(`<button type="button" class="${cls}" data-cal-date="${iso}" title="${title}" aria-label="${title}" aria-pressed="${isSelected ? 'true' : 'false'}" ${isPast ? 'disabled' : ''}>${day}</button>`);
    }
    grid.innerHTML = cells.join('');
  };

  function bindCalendarControls() {
    document.getElementById('calendar-prev-month')?.addEventListener('click', () => {
      viewMonth--;
      if (viewMonth < 0) { viewMonth = 11; viewYear--; }
      window.renderCalendarDatePicker();
    });
    document.getElementById('calendar-next-month')?.addEventListener('click', () => {
      viewMonth++;
      if (viewMonth > 11) { viewMonth = 0; viewYear++; }
      window.renderCalendarDatePicker();
    });
    document.getElementById('calendar-days-grid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cal-date]');
      if (!btn || btn.disabled) return;
      const iso = btn.getAttribute('data-cal-date');
      setSelectedCalendarDate(state.selectedDate === iso ? '' : iso);
    });
    document.getElementById('date-quick-presets')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-date-preset]');
      if (!btn) return;
      const preset = btn.getAttribute('data-date-preset');
      const t = new Date();
      if (preset === 'all') setSelectedCalendarDate('');
      else if (preset === 'today') setSelectedCalendarDate(toIso(t));
      else if (preset === 'tomorrow') setSelectedCalendarDate(toIso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1)));
      else if (preset === 'weekend') setSelectedCalendarDate('weekend');
    });
    document.getElementById('calendar-date-input')?.addEventListener('change', (e) => {
      setSelectedCalendarDate(e.target.value || '');
    });
    document.getElementById('calendar-clear-btn')?.addEventListener('click', () => {
      setSelectedCalendarDate('');
    });
    // Clicking any date label on a feed group header opens the Calendar Picker prompt immediately on the 1st click
    document.addEventListener('click', (e) => {
      const pickBtn = e.target.closest('.date-group-pick-btn[data-pick-date]');
      if (pickBtn) {
        e.preventDefault();
        e.stopPropagation();
        const iso = pickBtn.getAttribute('data-pick-date');
        if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) {
          const pd = new Date(`${iso}T12:00:00`);
          if (!isNaN(pd.getTime())) {
            viewYear = pd.getFullYear();
            viewMonth = pd.getMonth();
            window.renderCalendarDatePicker();
          }
        }
        if (typeof window.openMobileFiltersSheet === 'function') {
          window.openMobileFiltersSheet();
          setTimeout(() => {
            document.getElementById('date-picker-drawer-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 120);
        }
        return;
      }
      const dateTrigger = e.target.closest('#dynamic-date-left');
      if (!dateTrigger) return;
      if (typeof window.openMobileFiltersSheet === 'function') {
        window.openMobileFiltersSheet();
        setTimeout(() => {
          document.getElementById('date-picker-drawer-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 120);
      }
    }, true);
    if (/^\d{4}-\d{2}-\d{2}$/.test(state.selectedDate || '')) {
      const pd = new Date(`${state.selectedDate}T12:00:00`);
      if (!isNaN(pd.getTime())) {
        viewYear = pd.getFullYear();
        viewMonth = pd.getMonth();
      }
    }
    window.renderCalendarDatePicker();
    // Re-render once catalog data finishes loading so event indicator dots populate
    setTimeout(() => {
      window.renderCalendarDatePicker();
      if (state.selectedDate && typeof window.jumpToCalendarDate === 'function') {
        window.jumpToCalendarDate(state.selectedDate, { closeSheet: false });
      }
    }, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindCalendarControls);
  } else {
    bindCalendarControls();
  }
})();
