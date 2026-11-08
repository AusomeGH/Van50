// Van50 — Official Google Maps JavaScript API Integration
// Lazy-loaded singleton Map View with resilient coordinate resolution, venue-grouped category emoji pins,
// price-tier SVG pills, multi-event shared InfoWindow, and Town Centre Quick-Jump controls.

if (typeof window !== 'undefined' && !window.VAN50_MAPS_KEY) {
  window.VAN50_MAPS_KEY = 'AIzaSyAzpE5cht7VwkSO4t6g37PGr7tHzayctbg';
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
  'New Westminster': { lat: 49.2057, lng: -122.9110 },
  'Richmond': { lat: 49.1666, lng: -123.1336 },
  'Surrey Central': { lat: 49.1896, lng: -122.8479 },
  'City Centre': { lat: 49.1896, lng: -122.8479 },
  'Whalley': { lat: 49.1930, lng: -122.8450 },
  'Guildford': { lat: 49.1897, lng: -122.8012 },
  'Fleetwood': { lat: 49.1575, lng: -122.7905 },
  'Newton': { lat: 49.1337, lng: -122.8467 },
  'Cloverdale': { lat: 49.1044, lng: -122.7303 },
  'South Surrey': { lat: 49.0401, lng: -122.8042 }
};

if (typeof window !== 'undefined') {
  window.GOOGLE_MAPS_API_KEY = GOOGLE_MAPS_API_KEY;
  window.HOOD_COORDS = HOOD_COORDS;
}

let mapInstance = null;
let sharedInfoWindow = null;
let markersArray = [];
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
 * Maps an event's primary category / tags / title to its canonical category emoji:
 *   🎤 Comedy | 🎬 Indie Cinema | 🎸 Live Music | 🌲 Outdoors | 🧠 Trivia/Games |
 *   🎭 Arts/Theatre | 🏒 Sports | 🎪 Festivals | 📍 Default
 */
function getCategoryEmoji(event) {
  if (!event) return '📍';
  const cat = String(event.category || event.primary_category || '').toLowerCase();
  const arch = String(event.event_archetype || event.archetype || '').toLowerCase();
  const tags = Array.isArray(event.subTags)
    ? event.subTags.join(' ').toLowerCase()
    : (Array.isArray(event.tags) ? event.tags.join(' ').toLowerCase() : String(event.tags || '').toLowerCase());
  const title = String(event.title || event.event_name || '').toLowerCase();
  const combined = `${cat} ${arch} ${tags} ${title}`;

  if (/\b(trivia|quiz|board-game|board game|bingo|social_gaming|chess|games)\b/.test(combined)) return '🧠';
  if (/\b(comedy|stand-up|standup|improv|laugh)\b/.test(combined)) return '🎤';
  if (cat === 'cinema' || arch === 'cinema' || /\b(cinema|film|movie|screening|35mm)\b/.test(combined)) return '🎬';
  if (cat === 'music' || /\b(music|concert|band|jazz|dj|symphony|orchestra|gig|live-music)\b/.test(combined)) return '🎸';
  if (/\b(hockey|sport|sports|basketball|football|soccer|skating|golf|pitch & putt|active_rec)\b/.test(combined)) return '🏒';
  if (cat === 'outdoors' || arch === 'civic_park' || /\b(outdoors|outdoor|park|seawall|garden|beach|nature|trail)\b/.test(combined)) return '🌲';
  if (cat === 'festivals' || arch === 'festival' || Boolean(event.isFestival) || /\b(festival|diwali|fringe|viff|market|markets)\b/.test(combined)) return '🎪';
  if (cat === 'shows' || cat === 'social' || arch === 'live_stage' || arch === 'museum_gallery' || /\b(theatre|theater|arts|gallery|museum|exhibition|burlesque|cabaret|opera|dance)\b/.test(combined)) return '🎭';
  return '📍';
}

/**
 * Determines Price-Tier colors based on lowest price at the venue:
 *   $0 / Free : Emerald Green (#10B981, border #059669, text #FFFFFF)
 *   $1 - $25  : Sky Blue      (#0284C7, border #0369A1, text #FFFFFF)
 *   $26 - $50 : Deep Forest   (#0D6E52, border #064E3B, text #FFFFFF)
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
  return `$${p % 1 === 0 ? p.toFixed(0) : p.toFixed(2)} CAD`;
}

/**
 * Builds an SVG pill/circle marker icon displaying the Category Emoji (+ count if multiple events)
 * and colored by the venue's lowest price tier.
 */
function buildVenueGroupMarkerIcon(pinLabel, colors, isMulti) {
  const width = isMulti ? Math.max(54, pinLabel.length * 8 + 18) : 36;
  const height = 30;
  const halfW = Math.round(width / 2);
  const rx = 14;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 6}" viewBox="0 0 ${width} ${height + 6}">
    <rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="${rx}" fill="${colors.bg}" stroke="${colors.border}" stroke-width="2"/>
    <polygon points="${halfW - 5},${height - 2} ${halfW + 5},${height - 2} ${halfW},${height + 5}" fill="${colors.border}"/>
    <text x="${halfW}" y="19.5" text-anchor="middle" fill="${colors.text}" font-family="Plus Jakarta Sans, Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif" font-size="12.5" font-weight="800">${escapeHtml(pinLabel)}</text>
  </svg>`;

  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new window.google.maps.Size(width, height + 6),
    anchor: new window.google.maps.Point(halfW, height + 5)
  };
}

/**
 * Builds the multi-event InfoWindow HTML for a grouped venue marker.
 */
function buildVenueGroupInfoWindowHtml(group) {
  const venueName = group.venueName || 'Metro Vancouver Venue';
  const neighborhood = group.neighborhood || 'Vancouver';
  const count = group.events.length;
  const gmapsQuery = encodeURIComponent(`${venueName} ${neighborhood} BC`);
  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${gmapsQuery}`;

  const itemsHtml = group.events.map((ev) => {
    const emoji = getCategoryEmoji(ev);
    const title = ev.title || ev.event_name || 'Event';
    const dayTime = ev.dateSchedule || ev.date_schedule || ev.date || 'Upcoming';
    const priceStr = formatEventPriceBadge(ev);
    const evPrice = getEventNumericPrice(ev);
    const tierColors = getPriceTierColors(evPrice);
    const ticketUrl = ev.websiteUrl || ev.ticket_url || ev.details_url || '#';

    return `
      <div class="gmap-venue-iw-item">
        <div class="gmap-venue-iw-item-top">
          <div class="gmap-venue-iw-item-title">
            <span>${emoji}</span>
            <a href="${escapeHtml(ticketUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>
          </div>
          <span class="gmap-iw-badge" style="background:${tierColors.bg};color:#ffffff;border:none;flex-shrink:0;">
            ${escapeHtml(priceStr)}
          </span>
        </div>
        <div class="gmap-venue-iw-item-meta">
          <span>🗓️ ${escapeHtml(dayTime)}</span>
          <a href="${escapeHtml(ticketUrl)}" target="_blank" rel="noopener noreferrer" class="gmap-venue-iw-ticket-link">
            Tickets / Details ↗
          </a>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div class="gmap-venue-iw">
      <div class="gmap-venue-iw-header">
        <h4 class="gmap-venue-iw-name">📍 ${escapeHtml(venueName)}</h4>
        <div class="gmap-venue-iw-sub">
          <span>${escapeHtml(neighborhood)}</span>
          <span>${count} ${count === 1 ? 'event' : 'events'}</span>
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

/**
 * Groups filteredEvents by venue / coordinate (rounded to 4 decimal places),
 * plots category-emoji + price-tier SVG markers, updates the "X events plotted" counter,
 * and fits bounds.
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
    sharedInfoWindow = new window.google.maps.InfoWindow({ maxWidth: 330 });
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
        minPrice: Infinity
      };
      venueGroupsMap.set(coordKey, group);
    }

    group.events.push(event);
    const evPrice = getEventNumericPrice(event);
    if (evPrice < group.minPrice) {
      group.minPrice = evPrice;
    }
  });

  const bounds = new window.google.maps.LatLngBounds();

  venueGroupsMap.forEach((group) => {
    const count = group.events.length;
    const primaryEmoji = getCategoryEmoji(group.events[0]);
    const pinLabel = count > 1 ? `${primaryEmoji} ×${count}` : primaryEmoji;
    const minPrice = group.minPrice === Infinity ? 0 : group.minPrice;
    const colors = getPriceTierColors(minPrice);
    const icon = buildVenueGroupMarkerIcon(pinLabel, colors, count > 1);
    const position = { lat: group.lat, lng: group.lng };

    const marker = new window.google.maps.Marker({
      position,
      map: mapInstance,
      title: count > 1
        ? `${group.venueName} (${count} events • from ${colors.tierLabel})`
        : `${group.events[0].title || 'Event'} @ ${group.venueName} (${colors.tierLabel})`,
      icon,
      optimized: true
    });

    marker.addListener('click', () => {
      sharedInfoWindow.setContent(buildVenueGroupInfoWindowHtml(group));
      sharedInfoWindow.open({
        anchor: marker,
        map: mapInstance
      });
    });

    markersArray.push(marker);
    bounds.extend(position);
  });

  window.activeMapMarkers = markersArray;
  updatePlottedCounterText(eventsList.length);

  if (!options.skipFitBounds && markersArray.length > 0) {
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
        clickableIcons: false
      });

      sharedInfoWindow = new window.google.maps.InfoWindow({ maxWidth: 330 });

      mapInstance.addListener('click', () => {
        if (sharedInfoWindow) sharedInfoWindow.close();
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
    } catch (_) {}
  });
}

/**
 * Pans and zooms to a neighborhood or Town Centre when a Jump to Area button is clicked.
 */
async function jumpToMapArea(areaNameOrBtn, explicitLat, explicitLng) {
  let targetCoords = null;
  let clickedBtn = null;

  if (areaNameOrBtn && typeof areaNameOrBtn === 'object' && areaNameOrBtn.nodeType === 1) {
    clickedBtn = areaNameOrBtn;
    const attrArea = clickedBtn.getAttribute('data-area') || clickedBtn.textContent.trim();
    if (attrArea === 'fit-bounds') {
      document.querySelectorAll('div[aria-label="Town Centre Quick Jump"] button').forEach(b => b.classList.toggle('active', b === clickedBtn));
      fitActiveMapMarkers();
      return;
    }
    const attrLat = parseFloat(clickedBtn.getAttribute('data-lat'));
    const attrLng = parseFloat(clickedBtn.getAttribute('data-lng'));
    if (!isNaN(attrLat) && !isNaN(attrLng)) {
      targetCoords = { lat: attrLat, lng: attrLng };
    } else if (HOOD_COORDS[attrArea]) {
      targetCoords = HOOD_COORDS[attrArea];
    }
  } else if (typeof areaNameOrBtn === 'string') {
    const key = areaNameOrBtn.trim();
    if (key === 'fit-bounds') {
      fitActiveMapMarkers();
      return;
    }
    if (!isNaN(parseFloat(explicitLat)) && !isNaN(parseFloat(explicitLng))) {
      targetCoords = { lat: parseFloat(explicitLat), lng: parseFloat(explicitLng) };
    } else if (HOOD_COORDS[key]) {
      targetCoords = HOOD_COORDS[key];
    } else {
      const matchedKey = Object.keys(HOOD_COORDS).find(k => k.toLowerCase() === key.toLowerCase() || key.toLowerCase().includes(k.toLowerCase()));
      if (matchedKey) targetCoords = HOOD_COORDS[matchedKey];
    }
    clickedBtn = document.querySelector(`div[aria-label="Town Centre Quick Jump"] button[data-area="${key}"]`);
  }

  if (!targetCoords) return;

  const allJumpButtons = document.querySelectorAll('div[aria-label="Town Centre Quick Jump"] button');
  allJumpButtons.forEach((btn) => {
    btn.classList.toggle('active', btn === clickedBtn);
  });

  if (!mapInstance) {
    await initVancouverMap();
  }

  if (mapInstance && window.google && window.google.maps) {
    mapInstance.panTo({ lat: targetCoords.lat, lng: targetCoords.lng });
    mapInstance.setZoom(14);
  }
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
  const jumpContainer = document.querySelector('div[aria-label="Town Centre Quick Jump"]');
  if (!jumpContainer) return;
  const buttons = jumpContainer.querySelectorAll('button');
  buttons.forEach((btn) => {
    if (btn._van50JumpBound) return;
    btn._van50JumpBound = true;
    btn.addEventListener('click', () => {
      jumpToMapArea(btn);
    });
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindTownCentreJumpButtons);
  } else {
    bindTownCentreJumpButtons();
  }
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

if (typeof window !== 'undefined') {
  window.loadGoogleMapsScript = loadGoogleMapsScript;
  window.resolveEventCoords = resolveEventCoords;
  window.resolveEventCoordinates = resolveEventCoordinates;
  window.getCategoryEmoji = getCategoryEmoji;
  window.renderMapMarkers = renderMapMarkers;
  window.renderGoogleMapMarkers = renderMapMarkers;
  window.updateMapMarkers = renderMapMarkers;
  window.initVancouverMap = initVancouverMap;
  window.invalidateVancouverMap = invalidateVancouverMap;
  window.jumpToMapArea = jumpToMapArea;
  window.fitActiveMapMarkers = fitActiveMapMarkers;
}
