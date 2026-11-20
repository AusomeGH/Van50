// Van50 — Official Google Maps JavaScript API Integration
// Lazy-loaded singleton Map View with resilient coordinate resolution, venue-grouped category emoji pins,
// price-tier SVG pills, multi-event shared InfoWindow, and Town Centre Quick-Jump controls.

var escapeHtml = (typeof window !== 'undefined' && typeof window.escapeHtml === 'function')
  ? window.escapeHtml
  : function (str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

var safeExternalUrl = (typeof window !== 'undefined' && typeof window.safeExternalUrl === 'function')
  ? window.safeExternalUrl
  : function (rawUrl) {
    if (rawUrl === null || rawUrl === undefined) return '#';
    const trimmed = String(rawUrl).trim();
    if (!trimmed || trimmed === '#' || trimmed === 'undefined' || trimmed === 'null') return '#';
    try {
      const baseOrigin = (typeof window !== 'undefined' && window.location && /^https?:\/\//i.test(window.location.origin))
        ? window.location.origin
        : 'https://ausomegh.github.io';
      const parsed = new URL(trimmed, baseOrigin);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return parsed.href;
      }
      return '#';
    } catch (_) {
      return '#';
    }
  };

if (typeof window !== 'undefined') {
  window.escapeHtml = escapeHtml;
  window.safeExternalUrl = safeExternalUrl;
  if (!window.VAN50_MAPS_KEY) {
    const metaMapsKey = (typeof document !== 'undefined')
      ? document.querySelector('meta[name="van50-maps-key"]')?.getAttribute('content')
      : null;
    window.VAN50_MAPS_KEY = (metaMapsKey && metaMapsKey.trim()) || 'AIzaSyAzpE5cht7VwkSO4t6g37PGr7tHzayctbg';
  }
}
const GOOGLE_MAPS_API_KEY = (typeof window !== 'undefined' && window.VAN50_MAPS_KEY) || 'YOUR_GOOGLE_MAPS_API_KEY';

const HOOD_COORDS = {
  'Downtown': { lat: 49.2827, lng: -123.1207 },
  'Gastown': { lat: 49.2833, lng: -123.1066 },
  'Chinatown': { lat: 49.2797, lng: -123.0998 },
  'Yaletown': { lat: 49.2756, lng: -123.1219 },
  'West End': { lat: 49.2869, lng: -123.1369 },
  'Stanley Park': { lat: 49.3017, lng: -123.1417 },
  'Mount Pleasant': { lat: 49.2628, lng: -123.1011 },
  'Main Street': { lat: 49.2546, lng: -123.1013 },
  'Commercial Drive': { lat: 49.2719, lng: -123.0695 },
  'East Van': { lat: 49.2750, lng: -123.0650 },
  'Hastings-Sunrise': { lat: 49.2812, lng: -123.0440 },
  'Kitsilano': { lat: 49.2684, lng: -123.1683 },
  'Point Grey': { lat: 49.2654, lng: -123.2045 },
  'UBC': { lat: 49.2606, lng: -123.2460 },
  'Fairview': { lat: 49.2636, lng: -123.1268 },
  'Granville Island': { lat: 49.2712, lng: -123.1340 },
  'Kerrisdale': { lat: 49.2341, lng: -123.1554 },
  'Marpole': { lat: 49.2104, lng: -123.1302 },
  'North Shore': { lat: 49.3125, lng: -123.0792 },
  'Burnaby': { lat: 49.2488, lng: -122.9805 },
  'Metrotown': { lat: 49.2276, lng: -123.0076 },
  'Metrotown & Deer Lake': { lat: 49.2276, lng: -123.0076 },
  'Deer Lake': { lat: 49.2349, lng: -122.9746 },
  'Brentwood': { lat: 49.2664, lng: -123.0016 },
  'Brentwood & North Burnaby': { lat: 49.2664, lng: -123.0016 },
  'Lougheed': { lat: 49.2485, lng: -122.8970 },
  'Lougheed & SFU': { lat: 49.2650, lng: -122.9120 },
  'SFU': { lat: 49.2781, lng: -122.9199 },
  'Edmonds': { lat: 49.2121, lng: -122.9592 },
  'Edmonds & South Burnaby': { lat: 49.2121, lng: -122.9592 },
  'New Westminster': { lat: 49.2057, lng: -122.9110 },
  'New West': { lat: 49.2057, lng: -122.9110 },
  'Downtown & Columbia St': { lat: 49.2016, lng: -122.9102 },
  'Uptown & Sapperton': { lat: 49.2160, lng: -122.9110 },
  'Sapperton': { lat: 49.2244, lng: -122.8895 },
  'Queensborough': { lat: 49.1886, lng: -122.9435 },
  'Richmond': { lat: 49.1666, lng: -123.1336 },
  'City Centre & Brighouse': { lat: 49.1666, lng: -123.1364 },
  'Steveston': { lat: 49.1251, lng: -123.1820 },
  'Steveston Village': { lat: 49.1251, lng: -123.1820 },
  'East Richmond & Ironwood': { lat: 49.1422, lng: -123.0965 },
  'Langley': { lat: 49.1044, lng: -122.6604 },
  'Langley City & Willowbrook': { lat: 49.1086, lng: -122.6587 },
  'Fort Langley': { lat: 49.1704, lng: -122.5795 },
  'Willoughby': { lat: 49.1419, lng: -122.6552 },
  'Willoughby & Walnut Grove': { lat: 49.1520, lng: -122.6420 },
  'Walnut Grove': { lat: 49.1642, lng: -122.6365 },
  'Murrayville & Aldergrove': { lat: 49.0850, lng: -122.5800 },
  'Aldergrove': { lat: 49.0575, lng: -122.4706 },
  'Surrey Central': { lat: 49.1896, lng: -122.8479 },
  'Surrey Central / Whalley': { lat: 49.1896, lng: -122.8479 },
  'City Centre': { lat: 49.1896, lng: -122.8479 },
  'Whalley': { lat: 49.1930, lng: -122.8450 },
  'Bridgeview': { lat: 49.2045, lng: -122.8640 },
  'Guildford': { lat: 49.1897, lng: -122.8012 },
  'Fleetwood': { lat: 49.1575, lng: -122.7905 },
  'Fraser Heights': { lat: 49.1936, lng: -122.7656 },
  'Newton': { lat: 49.1337, lng: -122.8467 },
  'Bear Creek': { lat: 49.1610, lng: -122.8410 },
  'Panorama': { lat: 49.1065, lng: -122.8360 },
  'Sullivan Heights': { lat: 49.1120, lng: -122.8010 },
  'Cloverdale': { lat: 49.1044, lng: -122.7303 },
  'Clayton': { lat: 49.1180, lng: -122.7050 },
  'South Surrey': { lat: 49.0401, lng: -122.8042 },
  'Grandview': { lat: 49.0458, lng: -122.7554 },
  'Crescent Beach': { lat: 49.0583, lng: -122.8778 }
};

if (typeof window !== 'undefined') {
  window.GOOGLE_MAPS_API_KEY = GOOGLE_MAPS_API_KEY;
  window.HOOD_COORDS = HOOD_COORDS;
}

let mapInstance = null;
let sharedInfoWindow = null;
let markersArray = [];
let userLocationMarker = null;
let locationStatusTimer = null;
let googleMapsScriptPromise = null;
let mapAuthFailed = false;
let latestFilteredEvents = [];

function getMapCanvasElement() {
  return document.getElementById('van50-map-canvas')
    || document.querySelector('div[aria-label="Interactive Google Map of Events"]')
    || document.getElementById('vancouver-map');
}

function updatePlottedCounterText(count) {
  const badge = document.getElementById('map-pin-count-badge')
    || document.querySelector('div[aria-label="Jump to City"] .map-pin-count-badge')
    || document.querySelector('div[aria-label="Jump to Area"] .map-pin-count-badge');
  if (badge) {
    badge.textContent = `${count} events plotted`;
  }
}

function renderMapDiagnosticMessage(title, detail) {
  const canvas = getMapCanvasElement();
  if (!canvas) return;
  canvas.innerHTML = `
    <div class="van50-map-diagnostic" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:380px;padding:32px 24px;text-align:center;background:#0f172a;color:#f8fafc;border-radius:12px;">
      <div style="font-size:2rem;margin-bottom:10px;">🗺️</div>
      <h3 style="font-family:var(--font-heading, sans-serif);font-size:1.15rem;font-weight:800;margin:0 0 8px 0;color:#ffffff;">
        ${escapeHtml(title || 'Google Map Configuration Required')}
      </h3>
      <p style="font-size:0.88rem;line-height:1.5;max-width:480px;color:#cbd5e1;margin:0;">
        ${escapeHtml(detail || 'Set window.VAN50_MAPS_KEY or GOOGLE_MAPS_API_KEY in js/map.js and authorize this domain in Google Cloud Console.')}
      </p>
    </div>
  `;
}

// Official Google Maps authentication failure hook
if (typeof window !== 'undefined') {
  window.gm_authFailure = function () {
    mapAuthFailed = true;
    renderMapDiagnosticMessage(
      'Google Maps API Authentication Restricted',
      'The configured Google Maps API key rejected this HTTP referrer or requires Maps JavaScript API activation in Google Cloud Console.'
    );
  };
}

/**
 * Dynamically injects the official Google Maps JS API script only when needed.
 */
function loadGoogleMapsScript() {
  if (typeof window !== 'undefined' && window.google && window.google.maps && typeof window.google.maps.Map === 'function') {
    return Promise.resolve(window.google.maps);
  }

  if (!GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY === 'YOUR_GOOGLE_MAPS_API_KEY' || String(GOOGLE_MAPS_API_KEY).trim() === '') {
    renderMapDiagnosticMessage(
      'Google Maps API Key Not Set',
      'Provide a valid key in window.VAN50_MAPS_KEY or const GOOGLE_MAPS_API_KEY in js/map.js to render the interactive map.'
    );
    return Promise.reject(new Error('Missing GOOGLE_MAPS_API_KEY'));
  }

  if (googleMapsScriptPromise) {
    return googleMapsScriptPromise;
  }

  googleMapsScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById('van50-google-maps-js');
    if (existingScript) {
      const timer = setInterval(() => {
        if (window.google && window.google.maps && typeof window.google.maps.Map === 'function') {
          clearInterval(timer);
          resolve(window.google.maps);
        }
      }, 50);
      setTimeout(() => {
        clearInterval(timer);
        if (window.google && window.google.maps && typeof window.google.maps.Map === 'function') {
          resolve(window.google.maps);
        } else {
          googleMapsScriptPromise = null;
          reject(new Error('Timed out waiting for Google Maps SDK'));
        }
      }, 12000);
      return;
    }

    const script = document.createElement('script');
    script.id = 'van50-google-maps-js';
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&v=weekly`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      if (window.google && window.google.maps && typeof window.google.maps.Map === 'function') {
        resolve(window.google.maps);
      } else {
        const poll = setInterval(() => {
          if (window.google && window.google.maps && typeof window.google.maps.Map === 'function') {
            clearInterval(poll);
            resolve(window.google.maps);
          }
        }, 40);
        setTimeout(() => {
          clearInterval(poll);
          if (window.google && window.google.maps && typeof window.google.maps.Map === 'function') {
            resolve(window.google.maps);
          } else {
            googleMapsScriptPromise = null;
            renderMapDiagnosticMessage(
              'Google Maps Failed to Initialize',
              'The Google Maps script loaded, but window.google.maps.Map was not initialized.'
            );
            reject(new Error('window.google.maps.Map unavailable'));
          }
        }, 5000);
      }
    };

    script.onerror = () => {
      googleMapsScriptPromise = null;
      renderMapDiagnosticMessage(
        'Unable to Reach Google Maps',
        'Could not load https://maps.googleapis.com/maps/api/js. Check your network connection or ad/content blocker.'
      );
      reject(new Error('Failed to load Google Maps script'));
    };

    document.head.appendChild(script);
  });

  return googleMapsScriptPromise;
}

/**
 * Resolves { lat, lng } for an event with resilient property checks and neighborhood fallbacks.
 */
function resolveEventCoords(event, index = 0) {
  const idx = typeof index === 'number' && !isNaN(index) ? index : 0;

  if (event && typeof event === 'object') {
    const rawLat = event.lat
      ?? event.latitude
      ?? event.coords?.[0]
      ?? event.coordinates?.[0]
      ?? event.location?.lat
      ?? event.venue?.lat
      ?? event.dimension_audit?.D403_coordinates?.value?.[0];

    const rawLng = event.lng
      ?? event.lon
      ?? event.longitude
      ?? event.coords?.[1]
      ?? event.coordinates?.[1]
      ?? event.location?.lng
      ?? event.venue?.lng
      ?? event.dimension_audit?.D403_coordinates?.value?.[1];

    const lat = parseFloat(rawLat);
    const lng = parseFloat(rawLng);

    const isOldPlaceholder = Math.abs(lat - 49.2827) < 0.00001 && Math.abs(lng - (-123.1207)) < 0.00001;
    if (!isNaN(lat) && !isNaN(lng) && !isOldPlaceholder) {
      return { lat, lng };
    }
  }

  // Fallback: match event.neighborhood / event.area / event.location / event.venue against HOOD_COORDS
  const searchStr = [
    event?.neighborhood,
    event?.area,
    typeof event?.location === 'string' ? event.location : '',
    typeof event?.venue === 'string' ? event.venue : (event?.venue_name || ''),
    event?.address || event?.full_address || ''
  ].filter(Boolean).join(' ').toLowerCase();

  let matchedBase = null;
  const hoodNames = Object.keys(HOOD_COORDS);
  for (let i = 0; i < hoodNames.length; i++) {
    const name = hoodNames[i];
    if (searchStr.includes(name.toLowerCase())) {
      matchedBase = HOOD_COORDS[name];
      break;
    }
  }

  if (!matchedBase) {
    matchedBase = HOOD_COORDS['Downtown'];
  }

  const latOffset = ((idx % 7) - 3) * 0.0012;
  const lngOffset = (((idx * 3) % 7) - 3) * 0.0015;

  return {
    lat: matchedBase.lat + latOffset,
    lng: matchedBase.lng + lngOffset
  };
}

function resolveEventCoordinates(event, index = 0) {
  const c = resolveEventCoords(event, index);
  return [c.lat, c.lng];
}

/**
 * Single Shared Semantic Category Color Palette (Cards + Map Pins + Map Legend)
 * High-contrast, colorblind-distinguishable hex values matching .event-card left borders.
 */
const CATEGORY_COLORS = {
  music: { id: 'music', label: 'Music', emoji: '🎸', color: '#7C3AED', filterId: 'music' },
  shows: { id: 'shows', label: 'Comedy & Stage', emoji: '🎤', color: '#DC2626', filterId: 'shows' },
  cinema: { id: 'cinema', label: 'Cinema', emoji: '🎬', color: '#2563EB', filterId: 'cinema' },
  outdoors: { id: 'outdoors', label: 'Outdoors', emoji: '🌲', color: '#15803D', filterId: 'outdoors' },
  arts: { id: 'arts', label: 'Arts', emoji: '🎭', color: '#DB2777', filterId: 'arts' },
  social: { id: 'social', label: 'Social & Games', emoji: '🧠', color: '#D97706', filterId: 'social' },
  markets: { id: 'markets', label: 'Markets', emoji: '🛍️', color: '#0D9488', filterId: 'markets' },
  festivals: { id: 'festivals', label: 'Festivals', emoji: '🎪', color: '#EA580C', filterId: 'festivals' },
  sports: { id: 'sports', label: 'Sports', emoji: '🏒', color: '#0284C7', filterId: 'sports' },
  mixed: { id: 'mixed', label: 'Mixed / Multi-Category Venue', emoji: '📍', color: '#334155', filterId: null }
};
const CATEGORY_LEGEND_ORDER = ['music', 'shows', 'cinema', 'outdoors', 'arts', 'social', 'markets', 'festivals', 'sports'];

if (typeof window !== 'undefined') {
  window.CATEGORY_COLORS = CATEGORY_COLORS;
}

const iconCache = new Map();
let mapLegendExpanded = (typeof window !== 'undefined') ? window.innerWidth >= 768 : true;
let mapLegendUserToggled = false;
let latestHasMixedVenues = false;

function resolveMapEventCategoryKey(event) {
  if (!event) return 'arts';
  if (typeof window !== 'undefined' && typeof window.getCardSemanticCategoryMeta === 'function') {
    const meta = window.getCardSemanticCategoryMeta(event);
    if (meta && meta.filterId && CATEGORY_COLORS[meta.filterId]) {
      return meta.filterId;
    }
  }
  const cat = String(event.category || event.primary_category || '').toLowerCase();
  const arch = String(event.event_archetype || event.archetype || '').toLowerCase();
  const tags = Array.isArray(event.subTags)
    ? event.subTags.join(' ').toLowerCase()
    : (Array.isArray(event.tags) ? event.tags.join(' ').toLowerCase() : String(event.tags || '').toLowerCase());
  const title = String(event.title || event.event_name || '').toLowerCase();
  const combined = `${cat} ${arch} ${tags} ${title}`;

  if (/\b(trivia|quiz|board-game|board game|bingo|social_gaming|chess|games)\b/.test(combined)) return 'social';
  if (cat === 'cinema' || arch === 'cinema' || /\b(cinema|film|movie|screening|35mm)\b/.test(combined)) return 'cinema';
  if (cat === 'shows' || /\b(comedy|stand-up|standup|improv|theatre|theater|burlesque|cabaret|opera)\b/.test(combined)) return 'shows';
  if (cat === 'music' || /\b(music|concert|band|jazz|dj|symphony|orchestra|gig|live-music)\b/.test(combined)) return 'music';
  if (cat === 'markets' || /\b(market|markets|bazaar)\b/.test(combined)) return 'markets';
  if (cat === 'sports' || arch === 'active_rec' || /\b(hockey|sport|sports|skating|golf|pitch & putt)\b/.test(combined)) return 'sports';
  if (cat === 'outdoors' || arch === 'civic_park' || /\b(outdoors|outdoor|park|seawall|garden|beach|nature|trail)\b/.test(combined)) return 'outdoors';
  if (cat === 'festivals' || arch === 'festival' || Boolean(event.isFestival)) return 'festivals';
  return 'arts';
}

function getEventCategoryColor(event) {
  const key = resolveMapEventCategoryKey(event);
  return (CATEGORY_COLORS[key] || CATEGORY_COLORS.arts).color;
}

/**
 * Determines Price-Tier colors for InfoWindow price badges.
 */
function getPriceTierColors(minPrice) {
  const p = parseFloat(minPrice);
  if (isNaN(p) || p <= 0) {
    return { bg: '#10B981', border: '#059669', text: '#FFFFFF', tierLabel: 'Free' };
  }
  if (p <= 25) {
    return { bg: '#0284C7', border: '#0369A1', text: '#FFFFFF', tierLabel: `$${p % 1 === 0 ? p.toFixed(0) : p.toFixed(2)}` };
  }
  return { bg: '#0D6E52', border: '#064E3B', text: '#FFFFFF', tierLabel: `$${p % 1 === 0 ? p.toFixed(0) : p.toFixed(2)}` };
}

function getEventNumericPrice(event) {
  const p = parseFloat(event?.price ?? event?.price_all_in ?? 0);
  if (event?.isFree || isNaN(p) || p <= 0) return 0;
  return p;
}

function formatEventPriceBadge(event) {
  if (event?.isSoldOut || event?.is_sold_out) return 'Sold Out';
  const p = getEventNumericPrice(event);
  if (p <= 0) return 'Free';
  return `$${p % 1 === 0 ? p.toFixed(0) : p.toFixed(2)}`;
}

/**
 * Cached SVG teardrop pin generator keyed by `${color}-${count}` (plus mixed flag).
 * - Single event (count === 1): Teardrop pin filled with category hex, 2px white stroke, subtle shadow, white center dot.
 * - Multi-event (count > 1): Same-category color or #334155 Dark Slate (with two-tone ring) + bold white numeric count.
 */
function createCategoryPinIcon(color, count = 1, isMixed = false, emoji = '📍') {
  const safeCount = Math.max(1, Number(count) || 1);
  const safeColor = color || '#334155';
  const safeEmoji = emoji || '📍';
  const cacheKey = `${safeColor}-${safeCount}-${isMixed ? 1 : 0}-${safeEmoji}`;

  if (iconCache.has(cacheKey)) {
    const cached = iconCache.get(cacheKey);
    if (window.google && window.google.maps) {
      return {
        url: cached.url,
        scaledSize: new window.google.maps.Size(cached.w, cached.h),
        anchor: new window.google.maps.Point(cached.anchorX, cached.anchorY)
      };
    }
    return cached;
  }

  const isMulti = safeCount > 1;
  const pinLabel = isMulti ? `${safeEmoji} ×${safeCount}` : safeEmoji;
  const w = isMulti ? Math.max(58, pinLabel.length * 8 + 18) : 36;
  const bodyH = 30;
  const h = bodyH + 8;
  const halfW = Math.round(w / 2);
  const rx = 14;

  const innerRingHtml = isMixed
    ? `<rect x="4" y="4" width="${w - 8}" height="${bodyH - 8}" rx="${rx - 2.5}" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="1.2" stroke-dasharray="3 2"/>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <ellipse cx="${halfW}" cy="${h - 1.5}" rx="${isMulti ? 9 : 6}" ry="2" fill="rgba(15,23,42,0.28)"/>
    <polygon points="${halfW - 6},${bodyH - 2} ${halfW + 6},${bodyH - 2} ${halfW},${bodyH + 6}" fill="#FFFFFF"/>
    <rect x="1.5" y="1.5" width="${w - 3}" height="${bodyH - 3}" rx="${rx}" fill="${safeColor}" stroke="#FFFFFF" stroke-width="2"/>
    <polygon points="${halfW - 4.5},${bodyH - 2.5} ${halfW + 4.5},${bodyH - 2.5} ${halfW},${bodyH + 4}" fill="${safeColor}"/>
    ${innerRingHtml}
    <text x="${halfW}" y="19.5" text-anchor="middle" fill="#FFFFFF" font-family="Plus Jakarta Sans, Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif" font-size="${isMulti ? '12.5' : '14'}" font-weight="800">${escapeHtml(pinLabel)}</text>
  </svg>`;

  const entry = {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    w,
    h,
    anchorX: halfW,
    anchorY: bodyH + 6
  };
  iconCache.set(cacheKey, entry);

  if (window.google && window.google.maps) {
    return {
      url: entry.url,
      scaledSize: new window.google.maps.Size(w, h),
      anchor: new window.google.maps.Point(halfW, bodyH + 6)
    };
  }
  return entry;
}

/**
 * Builds the multi-event InfoWindow HTML for a grouped venue marker.
 * Each mini-card gets a 3px colored left border matching its specific category color.
 */
function buildVenueGroupInfoWindowHtml(group) {
  const venueName = group.venueName || 'Metro Vancouver Venue';
  const neighborhood = group.neighborhood || 'Vancouver';
  const count = group.events.length;
  const gmapsQuery = encodeURIComponent(`${venueName} ${neighborhood} BC`);
  const gmapsUrl = safeExternalUrl(`https://www.google.com/maps/search/?api=1&query=${gmapsQuery}`);

  const itemsHtml = group.events.map((ev) => {
    const title = ev.title || ev.event_name || 'Event';
    const evId = ev.id || ev.event_id || '';
    const dayTime = ev.dateSchedule || ev.date_schedule || ev.date || 'Upcoming';
    const priceStr = formatEventPriceBadge(ev);
    const evPrice = getEventNumericPrice(ev);
    const tierColors = getPriceTierColors(evPrice);
    const catKey = resolveMapEventCategoryKey(ev);
    const catColor = (CATEGORY_COLORS[catKey] || CATEGORY_COLORS.arts).color;

    return `
      <div class="gmap-venue-iw-item" data-action="toggle-map-card" data-event-id="${escapeHtml(evId)}" role="button" tabindex="0" aria-expanded="false" style="border-left: 3px solid ${escapeHtml(catColor)};">
        <div class="gmap-venue-iw-item-header">
          <div class="gmap-venue-iw-item-top">
            <div class="gmap-venue-iw-item-title">${escapeHtml(title)}</div>
            <span class="gmap-iw-badge" style="background:${tierColors.bg};color:#ffffff;border:none;flex-shrink:0;white-space:nowrap;">
              ${escapeHtml(priceStr)}
            </span>
          </div>
          <div class="gmap-venue-iw-item-meta">
            <span class="gmap-venue-iw-item-date">${escapeHtml(dayTime)}</span>
            <span class="gmap-iw-expand-hint" aria-hidden="true">Details &amp; Tickets →</span>
          </div>
        </div>
        <div class="gmap-iw-expanded-card-mount" data-map-card-mount="${escapeHtml(evId)}" style="display:none;"></div>
      </div>
    `;
  }).join('');

  return `
    <div class="gmap-venue-iw">
      <div class="gmap-venue-iw-header">
        <h4 class="gmap-venue-iw-name">📍 ${escapeHtml(venueName)}</h4>
        <div class="gmap-venue-iw-sub">
          <span>${escapeHtml(neighborhood)}</span>
          <span>${Number(count) || 0} ${count === 1 ? 'event' : 'events'}</span>
        </div>
      </div>
      <div class="gmap-venue-iw-list">
        ${itemsHtml}
      </div>
      <div class="gmap-iw-actions">
        <a href="${escapeHtml(gmapsUrl)}" target="_blank" rel="noopener noreferrer" class="gmap-iw-btn-primary" style="width:100%;">
          🗺️ Open in Google Maps
        </a>
      </div>
    </div>
  `;
}

function collapseMapLegendOnMobile() {
  if (typeof window !== 'undefined' && window.innerWidth < 768 && mapLegendExpanded) {
    mapLegendExpanded = false;
    renderMapLegend(latestFilteredEvents, latestHasMixedVenues);
  }
}

function bindMapLegendEventIsolation(legendEl) {
  if (!legendEl || legendEl._van50Isolated) return;
  legendEl._van50Isolated = true;
  ['click', 'mousedown', 'pointerdown', 'touchstart', 'wheel'].forEach((evtName) => {
    legendEl.addEventListener(evtName, (e) => {
      e.stopPropagation();
    }, { passive: evtName === 'wheel' || evtName === 'touchstart' });
  });
}

function renderMapLegend(filteredEvents, hasMixedVenues) {
  const legendEl = document.getElementById('map-legend');
  if (!legendEl) return;
  bindMapLegendEventIsolation(legendEl);

  if (!mapLegendUserToggled && typeof window !== 'undefined') {
    mapLegendExpanded = window.innerWidth >= 768;
  }

  const activeCategory = (typeof window.getCurrentCategoryFilter === 'function')
    ? String(window.getCurrentCategoryFilter() || 'all')
    : 'all';

  // Count events per category across the active city/search/date pool so users can 1-tap switch categories
  const countPool = (Array.isArray(window._lastCategoryCountPool) && window._lastCategoryCountPool.length > 0)
    ? window._lastCategoryCountPool
    : (Array.isArray(filteredEvents) ? filteredEvents : []);

  const countsByCat = {};
  countPool.forEach((ev) => {
    const k = resolveMapEventCategoryKey(ev);
    countsByCat[k] = (countsByCat[k] || 0) + 1;
  });

  const visibleCats = CATEGORY_LEGEND_ORDER.filter(k => (countsByCat[k] || 0) > 0);
  const showMixedRow = Boolean(hasMixedVenues);
  const showUserLocRow = Boolean(userLocationMarker && typeof userLocationMarker.getMap === 'function' && userLocationMarker.getMap());

  const rowsHtml = visibleCats.map((k) => {
    const def = CATEGORY_COLORS[k];
    const count = countsByCat[k] || 0;
    const isSelected = activeCategory === def.filterId;
    const isDimmed = activeCategory !== 'all' && !isSelected;
    return `
      <button type="button" class="map-legend-item ${isSelected ? 'is-selected' : ''} ${isDimmed ? 'is-dimmed' : ''}" data-legend-cat="${escapeHtml(def.filterId)}" aria-pressed="${isSelected ? 'true' : 'false'}" title="Filter map by ${escapeHtml(def.label)}">
        <span class="map-legend-swatch" style="background:${escapeHtml(def.color)};"></span>
        <span class="map-legend-emoji" aria-hidden="true">${escapeHtml(def.emoji || '')}</span>
        <span class="map-legend-label">${escapeHtml(def.label)}</span>
        <span class="map-legend-count">(${Number(count)})</span>
      </button>
    `;
  }).join('');

  const footerItems = [];
  if (showMixedRow) {
    footerItems.push(`
      <div class="map-legend-static-row">
        <span class="map-legend-mixed-badge">3</span>
        <span class="map-legend-static-text">Dark Pin — Multi-category venue</span>
      </div>
    `);
  }
  if (showUserLocRow) {
    footerItems.push(`
      <div class="map-legend-static-row">
        <span class="map-legend-user-dot"></span>
        <span class="map-legend-static-text">Blue Halo — Your Location</span>
      </div>
    `);
  }

  legendEl.classList.toggle('is-expanded', mapLegendExpanded);
  legendEl.classList.toggle('is-collapsed', !mapLegendExpanded);

  legendEl.innerHTML = `
    <div class="map-legend-header">
      <button type="button" class="map-legend-toggle" aria-expanded="${mapLegendExpanded ? 'true' : 'false'}" aria-controls="map-legend-body">
        <span class="map-legend-dot-cluster" aria-hidden="true">
          <i style="background:#7C3AED"></i>
          <i style="background:#DC2626"></i>
          <i style="background:#15803D"></i>
        </span>
        <span class="map-legend-title">Legend</span>
        <span class="map-legend-chevron" aria-hidden="true">${mapLegendExpanded ? '▾' : '▸'}</span>
      </button>
      ${(mapLegendExpanded && activeCategory !== 'all') ? `<button type="button" class="map-legend-reset" data-legend-reset="1">Show All</button>` : ''}
    </div>
    ${mapLegendExpanded ? `
      <div class="map-legend-body" id="map-legend-body">
        <div class="map-legend-list" role="group" aria-label="Filter map by category">
          ${rowsHtml || '<div class="map-legend-empty">No pins in current view</div>'}
        </div>
        ${footerItems.length > 0 ? `<div class="map-legend-divider"></div><div class="map-legend-footer">${footerItems.join('')}</div>` : ''}
      </div>
    ` : ''}
  `;

  const toggleBtn = legendEl.querySelector('.map-legend-toggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mapLegendUserToggled = true;
      mapLegendExpanded = !mapLegendExpanded;
      renderMapLegend(latestFilteredEvents, latestHasMixedVenues);
    });
  }

  const resetBtn = legendEl.querySelector('.map-legend-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof window.filterByCategory === 'function') {
        window.filterByCategory('all');
      }
    });
  }

  legendEl.querySelectorAll('.map-legend-item[data-legend-cat]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const catId = btn.getAttribute('data-legend-cat');
      if (catId && typeof window.filterByCategory === 'function') {
        window.filterByCategory(catId);
      }
    });
  });
}

/**
 * Groups filteredEvents by venue / coordinate (rounded to 4 decimal places),
 * plots semantic category-colored SVG markers, updates the "X events plotted" counter
 * and Map Legend overlay, and fits bounds.
 */
function renderMapMarkers(filteredEvents, options = {}) {
  const eventsList = Array.isArray(filteredEvents)
    ? filteredEvents
    : (window.currentFilteredEvents && window.currentFilteredEvents.length > 0
      ? window.currentFilteredEvents
      : (window.VAN50_EVENTS || window.VANCOUVER_EVENTS || []));

  latestFilteredEvents = eventsList;
  updatePlottedCounterText(eventsList.length);

  if (!mapInstance || !window.google || !window.google.maps || mapAuthFailed) {
    renderMapLegend(eventsList, false);
    return;
  }

  // Clear existing markers
  for (let i = 0; i < markersArray.length; i++) {
    if (markersArray[i]) {
      markersArray[i].setMap(null);
    }
  }
  markersArray = [];

  if (!sharedInfoWindow) {
    sharedInfoWindow = new window.google.maps.InfoWindow({ maxWidth: 320 });
  }

  // Group events by coordinate (rounded to 4 decimal places) or normalized venue name
  const venueGroupsMap = new Map();
  const venueCoordsCache = new Map();

  eventsList.forEach((event, index) => {
    if (!event) return;
    const rawVenue = (typeof event.venue === 'string' ? event.venue : (event.venue_name || 'Vancouver Venue')).trim();
    const normVenueKey = rawVenue.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    let coords = venueCoordsCache.get(normVenueKey);
    if (!coords) {
      coords = resolveEventCoords(event, index);
      venueCoordsCache.set(normVenueKey, coords);
    }
    if (!coords || isNaN(coords.lat) || isNaN(coords.lng)) return;

    const coordKey = `${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`;
    let group = venueGroupsMap.get(coordKey);
    if (!group) {
      group = {
        coordKey,
        venueName: rawVenue,
        neighborhood: event.neighborhood || 'Vancouver',
        lat: coords.lat,
        lng: coords.lng,
        events: [],
        categoryKeys: new Set(),
        minPrice: Infinity
      };
      venueGroupsMap.set(coordKey, group);
    }

    group.events.push(event);
    group.categoryKeys.add(resolveMapEventCategoryKey(event));
    const evPrice = getEventNumericPrice(event);
    if (evPrice < group.minPrice) {
      group.minPrice = evPrice;
    }
  });

  const bounds = new window.google.maps.LatLngBounds();
  let hasMixedVenues = false;

  venueGroupsMap.forEach((group) => {
    const count = group.events.length;
    const isMixed = count > 1 && group.categoryKeys.size > 1;
    if (isMixed) hasMixedVenues = true;
    const primaryCatKey = Array.from(group.categoryKeys)[0] || 'arts';
    const primaryCatDef = CATEGORY_COLORS[primaryCatKey] || CATEGORY_COLORS.arts;
    const pinColor = isMixed ? CATEGORY_COLORS.mixed.color : primaryCatDef.color;
    const pinEmoji = isMixed ? CATEGORY_COLORS.mixed.emoji : primaryCatDef.emoji;
    const minPrice = group.minPrice === Infinity ? 0 : group.minPrice;
    const priceInfo = getPriceTierColors(minPrice);
    const icon = createCategoryPinIcon(pinColor, count, isMixed, pinEmoji);
    const position = { lat: group.lat, lng: group.lng };

    const marker = new window.google.maps.Marker({
      position,
      map: mapInstance,
      title: count > 1
        ? `${group.venueName} (${count} events • from ${priceInfo.tierLabel})`
        : `${group.events[0].title || 'Event'} @ ${group.venueName} (${priceInfo.tierLabel})`,
      icon,
      optimized: true
    });

    marker.addListener('click', () => {
      collapseMapLegendOnMobile();
      sharedInfoWindow.setContent(buildVenueGroupInfoWindowHtml(group));
      sharedInfoWindow.open({
        anchor: marker,
        map: mapInstance
      });
    });

    markersArray.push(marker);
    bounds.extend(position);
  });

  latestHasMixedVenues = hasMixedVenues;
  window.activeMapMarkers = markersArray;
  updatePlottedCounterText(eventsList.length);
  renderMapLegend(eventsList, hasMixedVenues);

  const activeRegion = String(options.region || window.van50SelectedRegion || 'all').toLowerCase();
  if (activeRegion === 'surrey') {
    mapInstance.panTo({ lat: 49.135, lng: -122.820 });
    mapInstance.setZoom(11);
  } else if (!options.skipFitBounds && markersArray.length > 0) {
    mapInstance.fitBounds(bounds);
    if (markersArray.length === 1) {
      mapInstance.setZoom(15);
    } else {
      window.google.maps.event.addListenerOnce(mapInstance, 'idle', () => {
        if (mapInstance.getZoom() > 15) {
          mapInstance.setZoom(15);
        }
      });
    }
  }
}

/**
 * Initializes or refreshes the Google Map ONLY after #map-view-wrapper is visible.
 */
async function initVancouverMap() {
  const mapWrapper = document.getElementById('map-view-wrapper');
  const mapCanvas = getMapCanvasElement();
  if (!mapCanvas) return null;

  const isVisible = Boolean(
    (mapWrapper && mapWrapper.style.display !== 'none' && !mapWrapper.hidden) ||
    (mapCanvas.offsetWidth > 0 && mapCanvas.offsetHeight > 0)
  );
  if (!isVisible) {
    return null;
  }

  const activeEvents = (window.currentFilteredEvents && window.currentFilteredEvents.length > 0)
    ? window.currentFilteredEvents
    : (latestFilteredEvents.length > 0
      ? latestFilteredEvents
      : (window.VAN50_EVENTS || window.VANCOUVER_EVENTS || []));

  if (mapInstance && window.google && window.google.maps) {
    requestAnimationFrame(() => {
      window.google.maps.event.trigger(mapInstance, 'resize');
      renderMapMarkers(activeEvents);
    });
    return mapInstance;
  }

  try {
    await loadGoogleMapsScript();
    if (mapAuthFailed) return null;

    if (!mapInstance) {
      mapInstance = new window.google.maps.Map(mapCanvas, {
        center: { lat: 49.265, lng: -123.115 },
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
        padding: { bottom: 64 }
      });
      mapInstance.setOptions({ padding: { bottom: 64 } });

      sharedInfoWindow = new window.google.maps.InfoWindow({ maxWidth: 320 });

      mapInstance.addListener('click', () => {
        collapseMapLegendOnMobile();
        if (sharedInfoWindow) sharedInfoWindow.close();
      });

      mapInstance.addListener('dragstart', () => {
        collapseMapLegendOnMobile();
      });

      window.vancouverMapInstance = mapInstance;
      window.vancouverMapInfoWindow = sharedInfoWindow;
    }

    renderMapMarkers(activeEvents);
    return mapInstance;
  } catch (err) {
    console.warn('[Van50 Map] Map initialization warning:', err);
    return null;
  }
}

function invalidateVancouverMap() {
  if (!mapInstance || !window.google || !window.google.maps) return;
  requestAnimationFrame(() => {
    try {
      window.google.maps.event.trigger(mapInstance, 'resize');
    } catch (_) { }
  });
}

function showMapLocationStatus(message) {
  const statusEl = document.getElementById('map-location-status');
  if (!statusEl) return;
  if (locationStatusTimer) {
    clearTimeout(locationStatusTimer);
    locationStatusTimer = null;
  }
  if (!message) {
    statusEl.hidden = true;
    statusEl.textContent = '';
    return;
  }
  statusEl.textContent = message;
  statusEl.hidden = false;
  locationStatusTimer = setTimeout(() => {
    statusEl.hidden = true;
    statusEl.textContent = '';
    locationStatusTimer = null;
  }, 5500);
}

function setLocateButtonsLoading(isLoading) {
  const floatBtn = document.getElementById('map-locate-me-btn');
  const pillBtn = document.getElementById('map-jump-near-me');
  if (floatBtn) {
    floatBtn.classList.toggle('is-locating', isLoading);
    floatBtn.disabled = isLoading;
    floatBtn.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  }
  if (pillBtn) {
    pillBtn.classList.toggle('is-locating', isLoading);
    pillBtn.disabled = isLoading;
    pillBtn.textContent = isLoading ? 'Locating…' : 'Near Me';
  }
}

function buildUserLocationMarkerIcon() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
    <circle cx="18" cy="18" r="16" fill="#2563EB" fill-opacity="0.22"/>
    <circle cx="18" cy="18" r="8.5" fill="#2563EB" stroke="#FFFFFF" stroke-width="3"/>
  </svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new window.google.maps.Size(36, 36),
    anchor: new window.google.maps.Point(18, 18)
  };
}

async function centerMapOnUserLocation() {
  const fallbackMsg = 'Location access is off — enable browser location to center near you.';
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    showMapLocationStatus(fallbackMsg);
    return;
  }

  setLocateButtonsLoading(true);
  showMapLocationStatus('');

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      setLocateButtonsLoading(false);
      const lat = pos && pos.coords ? pos.coords.latitude : NaN;
      const lng = pos && pos.coords ? pos.coords.longitude : NaN;
      if (isNaN(lat) || isNaN(lng)) {
        showMapLocationStatus(fallbackMsg);
        return;
      }

      if (!mapInstance) {
        await initVancouverMap();
      }
      if (!mapInstance || !window.google || !window.google.maps) return;

      const userPos = { lat, lng };
      mapInstance.panTo(userPos);
      mapInstance.setZoom(13);

      if (userLocationMarker) {
        userLocationMarker.setPosition(userPos);
        userLocationMarker.setMap(mapInstance);
      } else {
        userLocationMarker = new window.google.maps.Marker({
          position: userPos,
          map: mapInstance,
          title: 'Your current location',
          icon: buildUserLocationMarkerIcon(),
          zIndex: 999,
          clickable: false
        });
      }

      const allJumpButtons = document.querySelectorAll('#map-jump-pills button');
      const nearMeBtn = document.getElementById('map-jump-near-me');
      allJumpButtons.forEach((btn) => btn.classList.toggle('active', btn === nearMeBtn));
      renderMapLegend(latestFilteredEvents, latestHasMixedVenues);
    },
    () => {
      setLocateButtonsLoading(false);
      showMapLocationStatus(fallbackMsg);
    },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
  );
}

/**
 * Pans and zooms to a city when a Jump to City button is clicked.
 */
async function jumpToMapArea(areaNameOrBtn, explicitLat, explicitLng, explicitZoom) {
  let targetCoords = null;
  let targetZoom = !isNaN(parseInt(explicitZoom, 10)) ? parseInt(explicitZoom, 10) : 12;
  let clickedBtn = null;

  if (areaNameOrBtn && typeof areaNameOrBtn === 'object' && areaNameOrBtn.nodeType === 1) {
    clickedBtn = areaNameOrBtn;
    const attrArea = clickedBtn.getAttribute('data-area') || clickedBtn.textContent.trim();
    if (attrArea === 'near-me') {
      centerMapOnUserLocation();
      return;
    }
    if (attrArea === 'fit-bounds') {
      document.querySelectorAll('#map-jump-pills button').forEach(b => b.classList.toggle('active', b === clickedBtn));
      fitActiveMapMarkers();
      return;
    }
    const attrLat = parseFloat(clickedBtn.getAttribute('data-lat'));
    const attrLng = parseFloat(clickedBtn.getAttribute('data-lng'));
    const attrZoom = parseInt(clickedBtn.getAttribute('data-zoom'), 10);
    if (!isNaN(attrZoom)) {
      targetZoom = attrZoom;
    } else if (attrArea === 'South Surrey') {
      targetZoom = 13;
    }
    if (!isNaN(attrLat) && !isNaN(attrLng)) {
      targetCoords = { lat: attrLat, lng: attrLng };
    } else if (HOOD_COORDS[attrArea]) {
      targetCoords = HOOD_COORDS[attrArea];
    }
  } else if (typeof areaNameOrBtn === 'string') {
    const key = areaNameOrBtn.trim();
    if (key === 'near-me') {
      centerMapOnUserLocation();
      return;
    }
    if (key === 'fit-bounds') {
      fitActiveMapMarkers();
      return;
    }
    if (key === 'South Surrey' && isNaN(parseInt(explicitZoom, 10))) {
      targetZoom = 13;
    }
    if (!isNaN(parseFloat(explicitLat)) && !isNaN(parseFloat(explicitLng))) {
      targetCoords = { lat: parseFloat(explicitLat), lng: parseFloat(explicitLng) };
    } else if (HOOD_COORDS[key]) {
      targetCoords = HOOD_COORDS[key];
    } else {
      const matchedKey = Object.keys(HOOD_COORDS).find(k => k.toLowerCase() === key.toLowerCase() || key.toLowerCase().includes(k.toLowerCase()));
      if (matchedKey) targetCoords = HOOD_COORDS[matchedKey];
    }
    clickedBtn = document.querySelector(`#map-jump-pills button[data-area="${key}"]`);
    if (clickedBtn && isNaN(parseInt(explicitZoom, 10))) {
      const btnZoom = parseInt(clickedBtn.getAttribute('data-zoom'), 10);
      if (!isNaN(btnZoom)) targetZoom = btnZoom;
    }
  }

  if (!targetCoords) return;

  const allJumpButtons = document.querySelectorAll('#map-jump-pills button');
  allJumpButtons.forEach((btn) => {
    btn.classList.toggle('active', btn === clickedBtn);
  });

  if (!mapInstance) {
    await initVancouverMap();
  }

  if (mapInstance && window.google && window.google.maps) {
    mapInstance.panTo({ lat: targetCoords.lat, lng: targetCoords.lng });
    mapInstance.setZoom(targetZoom);
  }
}

/**
 * Pans and fits map bounds when the top-level Region filter changes (single city, multi-city, or 'all').
 */
async function panMapToRegion(region) {
  let regionList = [];
  if (region instanceof Set) {
    regionList = Array.from(region).map(r => String(r || '').toLowerCase()).filter(r => r && r !== 'all');
  } else if (Array.isArray(region)) {
    regionList = region.map(r => String(r || '').toLowerCase()).filter(r => r && r !== 'all');
  } else {
    regionList = String(region || 'all').toLowerCase().split(',').map(s => s.trim()).filter(r => r && r !== 'all');
  }

  if (!mapInstance) {
    const mapWrapper = document.getElementById('map-view-wrapper');
    const isMapVisible = Boolean(mapWrapper && (mapWrapper.classList.contains('active') || mapWrapper.style.display === 'block'));
    if (!isMapVisible) return;
    await initVancouverMap();
  }
  if (!mapInstance || !window.google || !window.google.maps) return;

  if (regionList.length === 1) {
    const norm = regionList[0];
    if (norm === 'surrey') {
      mapInstance.panTo({ lat: 49.135, lng: -122.820 });
      mapInstance.setZoom(11);
      return;
    } else if (norm === 'vancouver') {
      mapInstance.panTo({ lat: 49.265, lng: -123.120 });
      mapInstance.setZoom(12);
      return;
    } else if (norm === 'burnaby') {
      mapInstance.panTo({ lat: 49.2488, lng: -122.9805 });
      mapInstance.setZoom(12);
      return;
    } else if (norm === 'richmond') {
      mapInstance.panTo({ lat: 49.1666, lng: -123.1336 });
      mapInstance.setZoom(12);
      return;
    } else if (norm === 'new-west' || norm === 'new west' || norm === 'new westminster') {
      mapInstance.panTo({ lat: 49.2057, lng: -122.9110 });
      mapInstance.setZoom(13);
      return;
    } else if (norm === 'langley') {
      mapInstance.panTo({ lat: 49.1180, lng: -122.6350 });
      mapInstance.setZoom(11);
      return;
    }
  }

  fitActiveMapMarkers();
}

function fitActiveMapMarkers() {
  if (!mapInstance || !window.google || !window.google.maps || markersArray.length === 0) return;
  const bounds = new window.google.maps.LatLngBounds();
  markersArray.forEach((m) => {
    const pos = m.getPosition();
    if (pos) bounds.extend(pos);
  });
  mapInstance.fitBounds(bounds);
  if (markersArray.length === 1) {
    mapInstance.setZoom(15);
  }
}

function bindTownCentreJumpButtons() {
  const jumpContainer = document.getElementById('map-jump-pills') || document.querySelector('div[aria-label="City Quick Jump"]');
  if (jumpContainer) {
    const buttons = jumpContainer.querySelectorAll('button');
    buttons.forEach((btn) => {
      if (btn._van50JumpBound) return;
      btn._van50JumpBound = true;
      btn.addEventListener('click', () => {
        jumpToMapArea(btn);
      });
    });
  }
  const locateBtn = document.getElementById('map-locate-me-btn');
  if (locateBtn && !locateBtn._van50LocateBound) {
    locateBtn._van50LocateBound = true;
    locateBtn.addEventListener('click', () => {
      centerMapOnUserLocation();
    });
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindTownCentreJumpButtons);
  } else {
    bindTownCentreJumpButtons();
  }
}

if (typeof window !== 'undefined') {
  window.loadGoogleMapsScript = loadGoogleMapsScript;
  window.resolveEventCoords = resolveEventCoords;
  window.resolveEventCoordinates = resolveEventCoordinates;
  window.createCategoryPinIcon = createCategoryPinIcon;
  window.getEventCategoryColor = getEventCategoryColor;
  window.renderMapLegend = renderMapLegend;
  window.renderMapMarkers = renderMapMarkers;
  window.renderGoogleMapMarkers = renderMapMarkers;
  window.updateMapMarkers = renderMapMarkers;
  window.initVancouverMap = initVancouverMap;
  window.invalidateVancouverMap = invalidateVancouverMap;
  window.jumpToMapArea = jumpToMapArea;
  window.centerMapOnUserLocation = centerMapOnUserLocation;
  window.panMapToRegion = panMapToRegion;
  window.fitActiveMapMarkers = fitActiveMapMarkers;
}
