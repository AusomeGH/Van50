// Van50 — Official Google Maps JavaScript API Integration
// Lazy-loaded singleton Map View with resilient coordinate resolution, custom SVG price pins,
// shared InfoWindow, and Town Centre Quick-Jump controls (1 map load per session, 0 Geocoding calls).

const GOOGLE_MAPS_API_KEY = 'AIzaSyAzpE5cht7VwkSO4t6g37PGr7tHzayctbg';

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

window.GOOGLE_MAPS_API_KEY = GOOGLE_MAPS_API_KEY;
window.HOOD_COORDS = HOOD_COORDS;

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
    <div class="van50-map-diagnostic" style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;min-height:360px;padding:32px 24px;text-align:center;background:#0f172a;color:#f8fafc;border-radius:12px;">
      <div style="font-size:2rem;margin-bottom:10px;">🗺️</div>
      <h3 style="font-family:var(--font-heading, sans-serif);font-size:1.15rem;font-weight:800;margin:0 0 8px 0;color:#ffffff;">
        ${escapeHtml(title || 'Google Map Unavailable')}
      </h3>
      <p style="font-size:0.88rem;line-height:1.5;max-width:460px;color:#cbd5e1;margin:0;">
        ${escapeHtml(detail || 'Verify that the Google Maps JavaScript API is enabled and the current domain is authorized in Google Cloud Console.')}
      </p>
    </div>
  `;
}

// Official Google Maps authentication failure hook
window.gm_authFailure = function () {
  mapAuthFailed = true;
  renderMapDiagnosticMessage(
    'Google Maps API Authentication Restricted',
    'The configured Google Maps API key rejected this origin or requires Maps JavaScript API activation in Google Cloud Console.'
  );
};

/**
 * Dynamically injects the official Google Maps JS API script only when needed.
 */
function loadGoogleMapsScript() {
  if (window.google && window.google.maps && typeof window.google.maps.Map === 'function') {
    return Promise.resolve(window.google.maps);
  }

  if (!GOOGLE_MAPS_API_KEY || String(GOOGLE_MAPS_API_KEY).trim() === '') {
    renderMapDiagnosticMessage(
      'Google Maps API Key Missing',
      'Set GOOGLE_MAPS_API_KEY in js/map.js to enable the interactive event map.'
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
              'The Google Maps script loaded, but window.google.maps.Map was not available.'
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
        'Could not load https://maps.googleapis.com/maps/api/js. Check your network connection or content blocker.'
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

    // Check if explicit numeric coordinates exist (and aren't the old hardcoded 49.2827, -123.1207 placeholder)
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

// Legacy compatibility wrapper returning [lat, lng]
function resolveEventCoordinates(event, index = 0) {
  const c = resolveEventCoords(event, index);
  return [c.lat, c.lng];
}

/**
 * Formats price badge text and selects color tier:
 *   $0 / Free -> Emerald #10B981
 *   <= $25    -> Sky #0284C7
 *   $26-$50   -> Forest #0D6E52
 */
function getMarkerPriceVisuals(event) {
  const numPrice = parseFloat(event?.price ?? event?.price_all_in ?? 0);
  const isFree = Boolean(event?.isFree || isNaN(numPrice) || numPrice <= 0);
  let label = 'Free';
  let bgColor = '#10B981'; // Emerald for Free / $0

  if (!isFree) {
    label = `$${numPrice % 1 === 0 ? numPrice.toFixed(0) : numPrice.toFixed(2)}`;
    if (numPrice <= 25) {
      bgColor = '#0284C7'; // Sky for <= $25
    } else {
      bgColor = '#0D6E52'; // Forest for $26-$50
    }
  }

  return { label, bgColor, isFree, numPrice: isNaN(numPrice) ? 0 : numPrice };
}

function buildMarkerSvgIcon(label, bgColor) {
  const safeText = String(label || 'Free').slice(0, 8);
  const width = Math.max(46, Math.min(78, safeText.length * 7 + 18));
  const height = 26;
  const halfW = Math.round(width / 2);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 6}" viewBox="0 0 ${width} ${height + 6}">
    <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="12" fill="${bgColor}" stroke="#ffffff" stroke-width="1.8"/>
    <polygon points="${halfW - 5},${height - 1} ${halfW + 5},${height - 1} ${halfW},${height + 5}" fill="${bgColor}"/>
    <text x="${halfW}" y="17.5" text-anchor="middle" fill="#ffffff" font-family="Plus Jakarta Sans, Arial, sans-serif" font-size="11.5" font-weight="800">${escapeHtml(safeText)}</text>
  </svg>`;

  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new window.google.maps.Size(width, height + 6),
    anchor: new window.google.maps.Point(halfW, height + 5)
  };
}

function buildInfoWindowContent(event, priceVisuals) {
  const title = event?.title || event?.event_name || 'Vancouver Outing';
  const venue = (typeof event?.venue === 'string' ? event.venue : event?.venue_name) || 'Metro Vancouver Venue';
  const neighborhood = event?.neighborhood || 'Vancouver';
  const dayTime = event?.dateSchedule || event?.date_schedule || event?.date || 'Upcoming';
  const ticketUrl = event?.websiteUrl || event?.ticket_url || event?.details_url || '#';
  const priceBadgeText = priceVisuals.isFree
    ? 'Free ($0 CAD)'
    : (event?.priceLabel || `${priceVisuals.label} CAD`);
  const gmapsQuery = encodeURIComponent(`${venue} ${neighborhood} BC`);
  const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${gmapsQuery}`;

  return `
    <div class="gmap-infowindow-card">
      <div class="gmap-iw-top-row">
        <span class="gmap-iw-badge" style="background:${priceVisuals.bgColor};color:#ffffff;border:none;">
          ${escapeHtml(priceBadgeText)}
        </span>
        ${event?.categoryLabel ? `<span class="gmap-iw-cat">${escapeHtml(event.categoryLabel)}</span>` : ''}
      </div>
      <h4 class="gmap-iw-title">
        <a href="${escapeHtml(ticketUrl)}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(title)} ↗
        </a>
      </h4>
      <div class="gmap-iw-meta">
        <div class="gmap-iw-venue">
          📍 <strong>${escapeHtml(venue)}</strong> <span class="gmap-iw-hood">• ${escapeHtml(neighborhood)}</span>
        </div>
        <div class="gmap-iw-date">
          🗓️ ${escapeHtml(dayTime)}
        </div>
      </div>
      <div class="gmap-iw-actions">
        <a href="${escapeHtml(ticketUrl)}" target="_blank" rel="noopener noreferrer" class="gmap-iw-btn-primary">
          Tickets / Details ↗
        </a>
        <a href="${escapeHtml(gmapsUrl)}" target="_blank" rel="noopener noreferrer" class="gmap-iw-btn-secondary">
          🗺️ Open in Google Maps
        </a>
      </div>
    </div>
  `;
}

/**
 * Plots markers on the active Google Map instance, opens shared InfoWindow on click,
 * fits bounds, and updates the "X events plotted" counter.
 */
function renderGoogleMapMarkers(filteredEvents, options = {}) {
  const eventsList = Array.isArray(filteredEvents)
    ? filteredEvents
    : (window.currentFilteredEvents && window.currentFilteredEvents.length > 0
      ? window.currentFilteredEvents
      : (window.VAN50_EVENTS || window.VANCOUVER_EVENTS || []));

  latestFilteredEvents = eventsList;

  // If map is not yet instantiated, keep the cached events list ready for when Map View opens
  if (!mapInstance || !window.google || !window.google.maps || mapAuthFailed) {
    updatePlottedCounterText(eventsList.length);
    return;
  }

  // 1. Clear existing markers
  for (let i = 0; i < markersArray.length; i++) {
    if (markersArray[i]) {
      markersArray[i].setMap(null);
    }
  }
  markersArray = [];

  if (!sharedInfoWindow) {
    sharedInfoWindow = new window.google.maps.InfoWindow({ maxWidth: 320 });
  }

  const bounds = new window.google.maps.LatLngBounds();
  const seenCoordsCount = new Map();

  // 2. Plot a marker for every filtered event
  eventsList.forEach((event, index) => {
    if (!event) return;
    const baseCoords = resolveEventCoords(event, index);
    if (!baseCoords || isNaN(baseCoords.lat) || isNaN(baseCoords.lng)) return;

    // Prevent identical-venue markers from stacking on top of the exact same pixel
    const coordKey = `${baseCoords.lat.toFixed(4)},${baseCoords.lng.toFixed(4)}`;
    const dupIdx = seenCoordsCount.get(coordKey) || 0;
    seenCoordsCount.set(coordKey, dupIdx + 1);

    let finalLat = baseCoords.lat;
    let finalLng = baseCoords.lng;
    if (dupIdx > 0) {
      const angle = (dupIdx * 137.5) * (Math.PI / 180);
      const radius = 0.00022 * Math.ceil(dupIdx / 6);
      finalLat = baseCoords.lat + radius * Math.cos(angle);
      finalLng = baseCoords.lng + radius * Math.sin(angle) * 1.35;
    }

    const position = { lat: finalLat, lng: finalLng };
    const priceVisuals = getMarkerPriceVisuals(event);
    const icon = buildMarkerSvgIcon(priceVisuals.label, priceVisuals.bgColor);

    const marker = new window.google.maps.Marker({
      position,
      map: mapInstance,
      title: `${event.title || event.event_name || 'Event'} (${priceVisuals.label})`,
      icon,
      optimized: true
    });

    marker.addListener('click', () => {
      sharedInfoWindow.setContent(buildInfoWindowContent(event, priceVisuals));
      sharedInfoWindow.open({
        anchor: marker,
        map: mapInstance
      });
    });

    markersArray.push(marker);
    bounds.extend(position);
  });

  window.activeMapMarkers = markersArray;

  // 3. Update "X events plotted" counter
  updatePlottedCounterText(markersArray.length);

  // 4. Fit bounds across plotted markers (unless caller suppressed camera movement)
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

  // Do NOT initialize while the map container is still display: none on page load
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

  // If map instance already exists, trigger resize inside requestAnimationFrame and re-render markers
  if (mapInstance && window.google && window.google.maps) {
    requestAnimationFrame(() => {
      window.google.maps.event.trigger(mapInstance, 'resize');
      renderGoogleMapMarkers(activeEvents);
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

      sharedInfoWindow = new window.google.maps.InfoWindow({ maxWidth: 320 });

      mapInstance.addListener('click', () => {
        if (sharedInfoWindow) sharedInfoWindow.close();
      });

      window.vancouverMapInstance = mapInstance;
      window.vancouverMapInfoWindow = sharedInfoWindow;
    }

    renderGoogleMapMarkers(activeEvents);
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

  // Toggle .active state on Town Centre Quick Jump buttons
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

window.loadGoogleMapsScript = loadGoogleMapsScript;
window.resolveEventCoords = resolveEventCoords;
window.resolveEventCoordinates = resolveEventCoordinates;
window.renderGoogleMapMarkers = renderGoogleMapMarkers;
window.updateMapMarkers = renderGoogleMapMarkers;
window.initVancouverMap = initVancouverMap;
window.invalidateVancouverMap = invalidateVancouverMap;
window.jumpToMapArea = jumpToMapArea;
window.fitActiveMapMarkers = fitActiveMapMarkers;
