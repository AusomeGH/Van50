// Van50 — Interactive Google Maps JavaScript API Integration
// Quota-Protected Architecture:
//   • Strictly 1 Google Map instance load per user session (never destroyed or recreated on search/filter/view toggle)
//   • Strictly 0 Geocoding / Places API calls in the browser (static venue & Town Centre coordinate dictionary)
//   • Persistent marker pool & single shared google.maps.InfoWindow

const GOOGLE_MAPS_CONFIG = {
  apiKey: (typeof window !== 'undefined' && window.ENV && window.ENV.VITE_GOOGLE_MAPS_API_KEY)
    || 'AIzaSyAzpE5cht7VwkSO4t6g37PGr7tHzayctbg',
  defaultCenter: { lat: 49.145, lng: -122.825 }, // Default center for Surrey
  defaultZoom: 11,
  vancouverCenter: { lat: 49.2745, lng: -123.1165 },
  vancouverZoom: 12,
  metroCenter: { lat: 49.215, lng: -122.965 },
  metroZoom: 11
};

window.GOOGLE_MAPS_CONFIG = GOOGLE_MAPS_CONFIG;

// Hardcoded Town Centre & Area Quick-Jump Coordinates (0 Places/Geocoding API calls)
const MAP_JUMP_AREAS = {
  'whalley': {
    id: 'whalley',
    label: 'City Centre / Whalley',
    lat: 49.1896,
    lng: -122.8479,
    zoom: 13
  },
  'guildford': {
    id: 'guildford',
    label: 'Guildford',
    lat: 49.1897,
    lng: -122.8014,
    zoom: 13
  },
  'fleetwood': {
    id: 'fleetwood',
    label: 'Fleetwood',
    lat: 49.1578,
    lng: -122.7797,
    zoom: 13
  },
  'newton': {
    id: 'newton',
    label: 'Newton',
    lat: 49.1362,
    lng: -122.8468,
    zoom: 13
  },
  'cloverdale': {
    id: 'cloverdale',
    label: 'Cloverdale',
    lat: 49.1126,
    lng: -122.7352,
    zoom: 13
  },
  'south-surrey': {
    id: 'south-surrey',
    label: 'South Surrey / White Rock',
    lat: 49.0405,
    lng: -122.8055,
    zoom: 13
  },
  'surrey-all': {
    id: 'surrey-all',
    label: 'Surrey Overview',
    lat: 49.145,
    lng: -122.825,
    zoom: 11
  },
  'vancouver': {
    id: 'vancouver',
    label: 'Vancouver',
    lat: 49.2745,
    lng: -123.1165,
    zoom: 12
  }
};

window.MAP_JUMP_AREAS = MAP_JUMP_AREAS;

// Static Venue & Town Centre Coordinate Lookup Dictionary (0 Browser Geocoding Calls)
const STATIC_VENUE_COORDINATES = [
  // Surrey Venues & Town Centres
  { match: /surrey civic plaza|surrey central|city centre library|centre stage|surrey city hall|chuck bailey|whalley|holland park/i, coords: [49.1896, -122.8479] },
  { match: /bear creek park|surrey art gallery|surrey arts centre|surrey nature centre/i, coords: [49.1633, -122.8415] },
  { match: /bell performing arts centre|bell centre|sullivan heights/i, coords: [49.1165, -122.8231] },
  { match: /cloverdale fairgrounds|museum of surrey|bill reid millennium amphitheatre|cloverdale|stetson bowl|cloverdale agriplex/i, coords: [49.1126, -122.7352] },
  { match: /guildford town centre|guildford recreation|hjorth road|green timbers|guildford/i, coords: [49.1897, -122.8014] },
  { match: /fleetwood community centre|fleetwood park|surrey sport & leisure|fleetwood/i, coords: [49.1578, -122.7797] },
  { match: /newton cultural centre|newton arena|newton wave pool|newton seniors|newton/i, coords: [49.1362, -122.8468] },
  { match: /historic stewart farm|crescent beach|blackie spit/i, coords: [49.0609, -122.8596] },
  { match: /darts hill garden/i, coords: [49.0315, -122.7686] },
  { match: /south surrey|white rock|semiahmoo|softball city|grandview heights|redwoods golf/i, coords: [49.0405, -122.8055] },
  { match: /bridgeview|scott road|north surrey/i, coords: [49.2036, -122.8631] },

  // Major Vancouver & Metro Vancouver Venues
  { match: /rio theatre/i, coords: [49.2618, -123.0702] },
  { match: /fox cabaret/i, coords: [49.2639, -123.1014] },
  { match: /the cinematheque|cinematheque/i, coords: [49.2796, -123.1243] },
  { match: /viff centre|vancity theatre/i, coords: [49.2775, -123.1246] },
  { match: /the improv centre|granville island|waterfront theatre|performance works|revue stage|arts club/i, coords: [49.2713, -123.1340] },
  { match: /tightrope theatre/i, coords: [49.2636, -123.1008] },
  { match: /rickshaw theatre/i, coords: [49.2814, -123.0982] },
  { match: /hollywood theatre/i, coords: [49.2644, -123.1753] },
  { match: /commodore ballroom/i, coords: [49.2803, -123.1219] },
  { match: /vogue theatre/i, coords: [49.2795, -123.1228] },
  { match: /orpheum/i, coords: [49.2799, -123.1213] },
  { match: /queen elizabeth theatre|vancouver playhouse/i, coords: [49.2801, -123.1128] },
  { match: /chan centre|ubc|museum of anthropology|thunderbird|nitobe|beatty biodiversity/i, coords: [49.2696, -123.2554] },
  { match: /the cultch|york theatre/i, coords: [49.2759, -123.0695] },
  { match: /roundhouse community/i, coords: [49.2733, -123.1217] },
  { match: /stanley park/i, coords: [49.3017, -123.1417] },
  { match: /queen elizabeth park|bloedel conservatory|vandusen/i, coords: [49.2418, -123.1126] },
  { match: /celebrities nightclub|junction|davie/i, coords: [49.2794, -123.1299] },
  { match: /fortune sound club|chinatown|sun yat-sen/i, coords: [49.2796, -123.1005] },
  { match: /guilt & company|gastown|frankie's jazz/i, coords: [49.2838, -123.1088] },
  { match: /shipyards|lonsdale|polygon gallery|north vancouver|lynn canyon/i, coords: [49.3101, -123.0805] },
  { match: /burnaby|deer lake|metrotown|shadbolt/i, coords: [49.2366, -122.9693] },
  { match: /new westminster|anvil centre|massey theatre/i, coords: [49.2057, -122.9110] },
  { match: /richmond|steveston|gateway theatre/i, coords: [49.1666, -123.1336] },

  // Broad Neighborhood Fallbacks
  { match: /surrey/i, coords: [49.1450, -122.8250] },
  { match: /commercial drive|east van/i, coords: [49.2712, -123.0695] },
  { match: /mount pleasant|main st/i, coords: [49.2636, -123.1011] },
  { match: /kitsilano|point grey/i, coords: [49.2684, -123.1683] },
  { match: /downtown|yaletown|west end/i, coords: [49.2827, -123.1207] }
];

// Singleton state (1 Map Load per session)
let mapInstance = null;
let sharedInfoWindow = null;
let googleMapsLoaderPromise = null;
let mapInitPromise = null;
let activeMarkers = [];
const markerPool = new Map(); // Persistent cache of google.maps.Marker keyed by event ID
let latestFilteredEvents = [];
let hasPerformedInitialCameraFit = false;
let userHasLockedArea = false;

/**
 * Resolves [lat, lng] for an event without making any browser Geocoding API calls.
 * Priority:
 *   1. Explicit numeric ev.lat & ev.lng
 *   2. Explicit numeric ev.coordinates [lat, lng] (unless it's an uncalibrated placeholder)
 *   3. Nested dimension_audit.D403_coordinates.value
 *   4. Static Venue & Town Centre lookup dictionary match against venue / address / neighborhood
 *   5. Clean fallback (Surrey default [49.145, -122.825] if Surrey context, else Downtown Vancouver [49.2827, -123.1207])
 */
function resolveEventCoordinates(ev) {
  if (!ev) return [GOOGLE_MAPS_CONFIG.defaultCenter.lat, GOOGLE_MAPS_CONFIG.defaultCenter.lng];

  // 1. Explicit lat/lng properties
  const explicitLat = Number(ev.lat !== undefined ? ev.lat : ev.latitude);
  const explicitLng = Number(ev.lng !== undefined ? ev.lng : ev.longitude);
  if (Number.isFinite(explicitLat) && Number.isFinite(explicitLng) && Math.abs(explicitLat) > 1 && Math.abs(explicitLng) > 1) {
    return [explicitLat, explicitLng];
  }

  // 2. Explicit coordinates array [lat, lng]
  if (Array.isArray(ev.coordinates) && ev.coordinates.length >= 2) {
    const cLat = Number(ev.coordinates[0]);
    const cLng = Number(ev.coordinates[1]);
    const isGenericDefault = (Math.abs(cLat - 49.2827) < 0.00001 && Math.abs(cLng - (-123.1207)) < 0.00001);
    if (Number.isFinite(cLat) && Number.isFinite(cLng) && !isGenericDefault) {
      return [cLat, cLng];
    }
  }

  // 3. Check dimension_audit.D403_coordinates
  const d403 = ev.dimension_audit && ev.dimension_audit.D403_coordinates && ev.dimension_audit.D403_coordinates.value;
  if (Array.isArray(d403) && d403.length >= 2) {
    const dLat = Number(d403[0]);
    const dLng = Number(d403[1]);
    if (Number.isFinite(dLat) && Number.isFinite(dLng)) {
      return [dLat, dLng];
    }
  } else if (typeof d403 === 'string') {
    const m = d403.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
    if (m) {
      return [Number(m[1]), Number(m[2])];
    }
  }

  // 4. Static Venue & Town Centre Dictionary Lookup
  const searchBlob = `${ev.venue || ''} ${ev.venue_name || ''} ${ev.address || ''} ${ev.full_address || ''} ${ev.neighborhood || ''} ${ev.title || ''}`;
  for (let i = 0; i < STATIC_VENUE_COORDINATES.length; i++) {
    if (STATIC_VENUE_COORDINATES[i].match.test(searchBlob)) {
      return [...STATIC_VENUE_COORDINATES[i].coords];
    }
  }

  // 5. If generic coordinates [49.2827, -123.1207] were provided on the item, use them or fallback
  if (Array.isArray(ev.coordinates) && ev.coordinates.length >= 2) {
    const cLat = Number(ev.coordinates[0]);
    const cLng = Number(ev.coordinates[1]);
    if (Number.isFinite(cLat) && Number.isFinite(cLng)) {
      return [cLat, cLng];
    }
  }

  return [GOOGLE_MAPS_CONFIG.defaultCenter.lat, GOOGLE_MAPS_CONFIG.defaultCenter.lng];
}

window.resolveEventCoordinates = resolveEventCoordinates;

/**
 * Dynamically determines whether the active event feed is centered in Surrey or Vancouver.
 */
function getDynamicFeedCenter(events) {
  const list = Array.isArray(events) && events.length > 0 ? events : latestFilteredEvents;
  if (!Array.isArray(list) || list.length === 0) {
    return { center: GOOGLE_MAPS_CONFIG.defaultCenter, zoom: GOOGLE_MAPS_CONFIG.defaultZoom };
  }

  let surreyCount = 0;
  let validCount = 0;

  for (let i = 0; i < list.length; i++) {
    const coords = resolveEventCoordinates(list[i]);
    if (!coords) continue;
    validCount++;
    const [lat, lng] = coords;
    const blob = `${list[i].venue || ''} ${list[i].address || ''} ${list[i].neighborhood || ''}`.toLowerCase();
    if (blob.includes('surrey') || blob.includes('white rock') || blob.includes('cloverdale') || blob.includes('whalley') || blob.includes('guildford') || blob.includes('newton') || blob.includes('fleetwood') || (lat <= 49.22 && lng >= -122.92)) {
      surreyCount++;
    }
  }

  if (validCount === 0 || surreyCount / validCount >= 0.25) {
    return { center: GOOGLE_MAPS_CONFIG.defaultCenter, zoom: GOOGLE_MAPS_CONFIG.defaultZoom };
  }

  return { center: GOOGLE_MAPS_CONFIG.vancouverCenter, zoom: GOOGLE_MAPS_CONFIG.vancouverZoom };
}

/**
 * Loads the Google Maps JavaScript API script asynchronously ONCE per session.
 */
function loadGoogleMapsScript() {
  if (typeof window !== 'undefined' && window.google && window.google.maps && typeof window.google.maps.Map === 'function') {
    return Promise.resolve(window.google.maps);
  }

  if (googleMapsLoaderPromise) {
    return googleMapsLoaderPromise;
  }

  googleMapsLoaderPromise = new Promise((resolve, reject) => {
    const existingScript = document.getElementById('van50-google-maps-sdk');
    if (existingScript) {
      const checkInterval = setInterval(() => {
        if (window.google && window.google.maps && typeof window.google.maps.Map === 'function') {
          clearInterval(checkInterval);
          resolve(window.google.maps);
        }
      }, 50);
      setTimeout(() => clearInterval(checkInterval), 15000);
      return;
    }

    const callbackName = '__onVan50GoogleMapsLoaded';
    window[callbackName] = function () {
      if (window.google && window.google.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error('Google Maps SDK callback fired without window.google.maps'));
      }
    };

    const script = document.createElement('script');
    script.id = 'van50-google-maps-sdk';
    script.async = true;
    script.defer = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_CONFIG.apiKey)}&v=weekly&loading=async&callback=${callbackName}`;
    script.onerror = function () {
      googleMapsLoaderPromise = null;
      console.warn('[Van50 Map] Google Maps JS API could not be loaded (offline or blocked referrer).');
      reject(new Error('Failed to load Google Maps JS API script'));
    };

    document.head.appendChild(script);
  });

  return googleMapsLoaderPromise;
}

/**
 * Initializes the singleton google.maps.Map instance ONCE when the map view initializes.
 * Never destroys or recreates the map instance on search, filter, or tab switch.
 */
function initVancouverMap(forceInit = false) {
  const mapContainer = document.getElementById('vancouver-map');
  if (!mapContainer) return null;

  // Return existing singleton map instance immediately (0 extra map loads)
  if (mapInstance) {
    invalidateVancouverMap();
    return mapInstance;
  }

  // Only load Google Maps when the map view is actually visible or explicitly requested
  const mapWrapper = document.getElementById('map-view-wrapper');
  const isWrapperVisible = Boolean(
    forceInit ||
    (mapWrapper && (mapWrapper.classList.contains('active') || mapWrapper.style.display === 'block')) ||
    (mapContainer.offsetWidth > 0 && mapContainer.offsetHeight > 0)
  );

  if (!isWrapperVisible) {
    return null;
  }

  if (mapInitPromise) {
    return mapInstance;
  }

  mapInitPromise = loadGoogleMapsScript()
    .then((gmaps) => {
      if (mapInstance) return mapInstance;

      // Initialize with Surrey default center { lat: 49.145, lng: -122.825 }, zoom: 11
      mapInstance = new gmaps.Map(mapContainer, {
        center: GOOGLE_MAPS_CONFIG.defaultCenter,
        zoom: GOOGLE_MAPS_CONFIG.defaultZoom,
        minZoom: 9,
        maxZoom: 18,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
        gestureHandling: 'greedy',
        clickableIcons: false,
        styles: [
          {
            featureType: 'poi.business',
            stylers: [{ visibility: 'simplified' }]
          }
        ]
      });

      // Single shared InfoWindow instance reused across all markers
      sharedInfoWindow = new gmaps.InfoWindow({
        maxWidth: 320
      });

      // Close InfoWindow when clicking bare map canvas
      mapInstance.addListener('click', () => {
        if (sharedInfoWindow) {
          sharedInfoWindow.close();
        }
      });

      window.vancouverMapInstance = mapInstance;
      window.vancouverMapInfoWindow = sharedInfoWindow;

      // Render current filtered events on the newly created map instance
      const initialEvents = (latestFilteredEvents && latestFilteredEvents.length > 0)
        ? latestFilteredEvents
        : (window.currentFilteredEvents && window.currentFilteredEvents.length > 0
          ? window.currentFilteredEvents
          : (window.VAN50_EVENTS || window.VANCOUVER_EVENTS || []));

      updateMapMarkers(initialEvents, { isInitialLoad: true });

      return mapInstance;
    })
    .catch(() => {
      mapInitPromise = null;
      return null;
    });

  return mapInstance;
}

/**
 * Triggers a non-destructive layout resize on the existing singleton map instance.
 */
function invalidateVancouverMap() {
  if (!mapInstance || !window.google || !window.google.maps) return;
  try {
    window.google.maps.event.trigger(mapInstance, 'resize');
  } catch (_) {}
}

/**
 * Builds a crisp SVG data-URI pill marker showing the event's price badge.
 */
function createPriceMarkerIcon(priceText, isFree, isSoldOut) {
  const bgFill = isSoldOut ? '#475569' : (isFree ? '#059669' : '#0f172a');
  const strokeColor = isSoldOut ? '#94a3b8' : (isFree ? '#34d399' : '#0d9488');
  const textColor = '#ffffff';
  const label = String(priceText || '$').slice(0, 9);
  const width = Math.max(46, Math.min(82, label.length * 7 + 18));
  const height = 28;
  const halfW = Math.round(width / 2);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height + 6}" viewBox="0 0 ${width} ${height + 6}">
    <rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="12.5" fill="${bgFill}" stroke="${strokeColor}" stroke-width="2"/>
    <polygon points="${halfW - 5},${height - 2} ${halfW + 5},${height - 2} ${halfW},${height + 5}" fill="${strokeColor}"/>
    <text x="${halfW}" y="18" text-anchor="middle" fill="${textColor}" font-family="Plus Jakarta Sans, Arial, sans-serif" font-size="11.5" font-weight="800">${escapeHtml(label)}</text>
  </svg>`;

  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new window.google.maps.Size(width, height + 6),
    anchor: new window.google.maps.Point(halfW, height + 5)
  };
}

/**
 * Formats the price badge text for a marker and InfoWindow.
 */
function getEventPriceBadge(ev) {
  if (!ev) return 'Free';
  if (ev.isSoldOut || ev.is_sold_out) return 'Sold Out';
  if (ev.isFree || Number(ev.price) === 0) return 'Free';
  if (typeof ev.price === 'number' && Number.isFinite(ev.price)) {
    return `$${ev.price.toFixed(ev.price % 1 === 0 ? 0 : 2)}`;
  }
  if (ev.priceLabel) {
    return String(ev.priceLabel).replace(/\s*CAD|\s*all-in|\s*advance|\s*door/gi, '').trim();
  }
  return '≤ $50';
}

/**
 * Builds the HTML content for the shared google.maps.InfoWindow.
 */
function buildInfoWindowHtml(ev, sameVenueCount) {
  const title = ev.title || ev.event_name || 'Event';
  const venueName = ev.venue || ev.venue_name || 'Metro Vancouver Venue';
  const neighborhood = ev.neighborhood || '';
  const dateSchedule = ev.dateSchedule || ev.date_schedule || ev.date || 'Upcoming Showing';
  const priceBadge = getEventPriceBadge(ev);
  const fullPriceDisplay = (ev.isFree || Number(ev.price) === 0)
    ? 'Free ($0 CAD)'
    : (ev.priceLabel || `${priceBadge} CAD`);
  const isSoldOut = Boolean(ev.isSoldOut || ev.is_sold_out);
  const websiteUrl = ev.websiteUrl || ev.ticket_url || ev.details_url || '#';
  const [lat, lng] = resolveEventCoordinates(ev);
  const gmapsDirectionsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venueName}, ${ev.address || 'BC'}`)}`;
  const badgeClass = isSoldOut ? 'gmap-iw-badge sold-out' : (ev.isFree ? 'gmap-iw-badge free' : 'gmap-iw-badge paid');

  return `
    <div class="gmap-infowindow-card">
      <div class="gmap-iw-top-row">
        <span class="${badgeClass}">${escapeHtml(fullPriceDisplay)}</span>
        ${ev.categoryLabel ? `<span class="gmap-iw-cat">${escapeHtml(ev.categoryLabel)}</span>` : ''}
      </div>
      <h4 class="gmap-iw-title">
        <a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer">
          ${escapeHtml(title)} ↗
        </a>
      </h4>
      <div class="gmap-iw-meta">
        <div class="gmap-iw-venue">
          📍 <strong>${escapeHtml(venueName)}</strong>${neighborhood ? ` <span class="gmap-iw-hood">(${escapeHtml(neighborhood)})</span>` : ''}
        </div>
        <div class="gmap-iw-date">
          🗓️ ${escapeHtml(dateSchedule)}
        </div>
      </div>
      ${sameVenueCount > 1 ? `<div class="gmap-iw-co-events">✨ ${sameVenueCount} events at this venue match your filters</div>` : ''}
      <div class="gmap-iw-actions">
        <a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer" class="gmap-iw-btn-primary">
          Get Tickets / Details ↗
        </a>
        <a href="${escapeHtml(gmapsDirectionsUrl)}" target="_blank" rel="noopener noreferrer" class="gmap-iw-btn-secondary" title="Open directions in Google Maps (${lat.toFixed(4)}, ${lng.toFixed(4)})">
          Directions ↗
        </a>
      </div>
    </div>
  `;
}

/**
 * Updates markers on the existing singleton mapInstance to match the filtered events list.
 * Strictly 0 Geocoding API calls and 0 new Map loads.
 */
function updateMapMarkers(events, options = {}) {
  const eventList = Array.isArray(events) ? events : [];
  latestFilteredEvents = eventList;

  // Update the pin count badge in the Jump to Area toolbar
  const countBadge = document.getElementById('map-pin-count-badge');
  if (countBadge) {
    countBadge.textContent = `${eventList.length} ${eventList.length === 1 ? 'outing' : 'outings'} plotted`;
  }

  // If the map hasn't been initialized yet (e.g., user is still in Cards view), just cache the events
  if (!mapInstance || !window.google || !window.google.maps) {
    const mapWrapper = document.getElementById('map-view-wrapper');
    if (mapWrapper && (mapWrapper.classList.contains('active') || mapWrapper.style.display === 'block')) {
      initVancouverMap(true);
    }
    return;
  }

  // Track co-located events at identical coordinates so pins don't completely hide one another
  const coordCounts = new Map();
  const coordTotals = new Map();

  eventList.forEach((ev) => {
    if (!ev) return;
    const [lat, lng] = resolveEventCoordinates(ev);
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    coordTotals.set(key, (coordTotals.get(key) || 0) + 1);
  });

  const nextActiveIds = new Set();
  const nextActiveMarkers = [];

  eventList.forEach((ev, idx) => {
    if (!ev) return;
    const evId = String(ev.id || ev.event_id || `ev-idx-${idx}`);
    nextActiveIds.add(evId);

    const [baseLat, baseLng] = resolveEventCoordinates(ev);
    const coordKey = `${baseLat.toFixed(4)},${baseLng.toFixed(4)}`;
    const seenIndex = coordCounts.get(coordKey) || 0;
    coordCounts.set(coordKey, seenIndex + 1);
    const totalAtSpot = coordTotals.get(coordKey) || 1;

    // Deterministic micro-offset (~18m radius spiral) when multiple events share the exact same venue
    let finalLat = baseLat;
    let finalLng = baseLng;
    if (seenIndex > 0) {
      const angle = (seenIndex * 137.5) * (Math.PI / 180);
      const radius = 0.00016 * Math.ceil(seenIndex / 6);
      finalLat = baseLat + radius * Math.cos(angle);
      finalLng = baseLng + radius * Math.sin(angle) * 1.4;
    }

    const priceText = getEventPriceBadge(ev);
    const isFree = Boolean(ev.isFree || Number(ev.price) === 0);
    const isSoldOut = Boolean(ev.isSoldOut || ev.is_sold_out);
    const iconConfig = createPriceMarkerIcon(priceText, isFree, isSoldOut);

    let marker = markerPool.get(evId);
    if (!marker) {
      marker = new window.google.maps.Marker({
        position: { lat: finalLat, lng: finalLng },
        map: mapInstance,
        title: `${ev.title || 'Event'} — ${ev.venue || ''} (${priceText})`,
        icon: iconConfig,
        optimized: true
      });

      marker.addListener('click', () => {
        if (!sharedInfoWindow) {
          sharedInfoWindow = new window.google.maps.InfoWindow({ maxWidth: 320 });
        }
        const currentEv = marker._van50Event || ev;
        const currentSameCount = marker._van50SameVenueCount || 1;
        sharedInfoWindow.setContent(buildInfoWindowHtml(currentEv, currentSameCount));
        sharedInfoWindow.open({
          anchor: marker,
          map: mapInstance
        });
      });

      markerPool.set(evId, marker);
    } else {
      marker.setPosition({ lat: finalLat, lng: finalLng });
      marker.setTitle(`${ev.title || 'Event'} — ${ev.venue || ''} (${priceText})`);
      marker.setIcon(iconConfig);
      if (marker.getMap() !== mapInstance) {
        marker.setMap(mapInstance);
      }
    }

    marker._van50Event = ev;
    marker._van50SameVenueCount = totalAtSpot;
    marker._van50EventId = evId;
    nextActiveMarkers.push(marker);
  });

  // Hide any previously active markers that are no longer in the filtered events list
  for (let i = 0; i < activeMarkers.length; i++) {
    const oldMarker = activeMarkers[i];
    if (oldMarker && !nextActiveIds.has(oldMarker._van50EventId)) {
      oldMarker.setMap(null);
    }
  }

  activeMarkers = nextActiveMarkers;
  window.activeMapMarkers = activeMarkers;

  // On first map open (if user hasn't manually clicked a Town Centre pill), center dynamically on active feed
  if ((options.isInitialLoad || !hasPerformedInitialCameraFit) && !userHasLockedArea && activeMarkers.length > 0) {
    hasPerformedInitialCameraFit = true;
    const feedTarget = getDynamicFeedCenter(eventList);
    mapInstance.setCenter(feedTarget.center);
    mapInstance.setZoom(feedTarget.zoom);
  }
}

/**
 * Pans and zooms the existing Google Map instance to a hardcoded Surrey Town Centre or Metro area.
 * Zero Places API or Geocoding API calls.
 */
function jumpToMapArea(areaKey) {
  const area = MAP_JUMP_AREAS[areaKey];
  if (!area) return;

  userHasLockedArea = true;

  // Highlight active jump pill
  const pills = document.querySelectorAll('.map-jump-pill');
  pills.forEach((btn) => {
    if (btn.getAttribute('data-area') === areaKey) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  if (!mapInstance) {
    initVancouverMap(true);
    loadGoogleMapsScript().then(() => {
      if (mapInstance) {
        mapInstance.panTo({ lat: area.lat, lng: area.lng });
        mapInstance.setZoom(area.zoom || 13);
      }
    }).catch(() => {});
    return;
  }

  mapInstance.panTo({ lat: area.lat, lng: area.lng });
  mapInstance.setZoom(area.zoom || 13);
}

/**
 * Fits the map viewport to all currently active filtered markers.
 */
function fitActiveMapMarkers() {
  if (!mapInstance || !window.google || !window.google.maps || activeMarkers.length === 0) return;

  const pills = document.querySelectorAll('.map-jump-pill');
  pills.forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-area') === 'fit-bounds');
  });

  const bounds = new window.google.maps.LatLngBounds();
  activeMarkers.forEach((m) => {
    const pos = m.getPosition();
    if (pos) bounds.extend(pos);
  });

  mapInstance.fitBounds(bounds, 48);
  window.google.maps.event.addListenerOnce(mapInstance, 'idle', () => {
    if (mapInstance.getZoom() > 15) {
      mapInstance.setZoom(15);
    }
  });
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

window.initVancouverMap = initVancouverMap;
window.updateMapMarkers = updateMapMarkers;
window.invalidateVancouverMap = invalidateVancouverMap;
window.jumpToMapArea = jumpToMapArea;
window.fitActiveMapMarkers = fitActiveMapMarkers;
