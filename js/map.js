// Van50 — Leaflet Map Integration
// Plots verified Vancouver outings on dark-themed map with custom badges and direct booking popups.

let mapInstance = null;
let markersLayer = null;

function initVancouverMap() {
  const mapContainer = document.getElementById('vancouver-map');
  if (!mapContainer || typeof L === 'undefined') return;

  // Prevent double-initialization
  if (mapInstance) {
    mapInstance.invalidateSize();
    return mapInstance;
  }

  try {
    // Center on Downtown / False Creek / Mount Pleasant Vancouver
    mapInstance = L.map('vancouver-map', {
      center: [49.2745, -123.1165],
      zoom: 13,
      minZoom: 10,
      maxZoom: 18,
      zoomControl: true
    });

    // High-resolution OpenStreetMap tiles (100% Free, Zero API Key Required, No Watermarks)
    // Dark mode styling is applied seamlessly via CSS filter in css/components.css
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(mapInstance);

    markersLayer = L.layerGroup().addTo(mapInstance);
    window.vancouverMapInstance = mapInstance;

    // Re-plot when map container size changes
    window.addEventListener('resize', () => {
      if (mapInstance) mapInstance.invalidateSize();
    });

    return mapInstance;
  } catch (err) {
    console.error('Error initializing Vancouver map:', err);
    return null;
  }
}

function invalidateVancouverMap() {
  if (window.vancouverMapInstance) {
    try {
      window.vancouverMapInstance.invalidateSize();
    } catch (e) {}
  }
}

function updateMapMarkers(events) {
  // Ensure map is initialized
  if (!mapInstance || !markersLayer) {
    if (typeof L !== 'undefined' && document.getElementById('vancouver-map')) {
      initVancouverMap();
    }
    if (!mapInstance || !markersLayer) return;
  }

  markersLayer.clearLayers();
  const eventList = Array.isArray(events) ? events : [];
  if (eventList.length === 0) return;

  const bounds = [];

  eventList.forEach(ev => {
    if (!ev || !ev.coordinates || !Array.isArray(ev.coordinates) || ev.coordinates.length < 2) return;
    const lat = Number(ev.coordinates[0]);
    const lng = Number(ev.coordinates[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    bounds.push([lat, lng]);

    // Safe price text calculation
    let priceText = "Free";
    if (!ev.isFree) {
      if (typeof ev.price === 'number') {
        priceText = `$${ev.price.toFixed(ev.price % 1 === 0 ? 0 : 2)}`;
      } else if (ev.priceLabel) {
        priceText = String(ev.priceLabel).replace(/\s*all-in|\s*advance|\s*door/i, '');
      } else {
        priceText = "$";
      }
    }

    const categoryLabel = ev.categoryLabel || (ev.category ? ev.category.toUpperCase() : 'EVENT');

    // Custom HTML div marker with crisp typography & no raw OS emojis
    const customIcon = L.divIcon({
      className: 'custom-pin-wrapper',
      html: `
        <div class="custom-map-pin" title="${escapeHtml(ev.title || '')} (${escapeHtml(priceText)})">
          <span class="custom-pin-cat">${escapeHtml(categoryLabel.split(' ')[0])}</span>
          <span class="custom-pin-price">${escapeHtml(priceText)}</span>
        </div>
      `,
      iconSize: [84, 28],
      iconAnchor: [42, 14]
    });

    const marker = L.marker([lat, lng], { icon: customIcon });

    const venueName = ev.venue || 'Vancouver';
    const gmapsUrl = `https://www.google.com/maps?q=${lat},${lng}+(${encodeURIComponent(venueName)})`;
    const websiteUrl = ev.websiteUrl || '#';
    const priceDisplay = ev.priceLabel || priceText;
    const transitDisplay = ev.transitInfo || 'Transit accessible';
    const frequencyDisplay = ev.frequencyLabel || 'Vancouver Outing';

    // Modern popup content with clean inline SVGs
    const popupHtml = `
      <div class="popup-inner-box">
        <div class="popup-header-freq">
          ${escapeHtml(frequencyDisplay)}
        </div>
        <div class="popup-title">
          <a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer">
            ${escapeHtml(ev.title || 'Event')} ↗
          </a>
        </div>
        <div class="popup-venue">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; margin-right: 4px;"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
          ${escapeHtml(venueName)}
        </div>
        <div class="popup-price">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; margin-right: 4px;"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
          ${escapeHtml(priceDisplay)}
        </div>
        <div class="popup-transit">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -1px; margin-right: 4px;"><rect x="4" y="3" width="16" height="16" rx="2"></rect><path d="M4 11h16"></path><path d="M12 3v8"></path><circle cx="8" cy="15" r="1"></circle><circle cx="16" cy="15" r="1"></circle><path d="M8 19l-2 3"></path><path d="M16 19l2 3"></path></svg>
          ${escapeHtml(transitDisplay)}
        </div>
        <a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener noreferrer" class="popup-btn">
          Get Tickets / Details ↗
        </a>
        <a href="${escapeHtml(gmapsUrl)}" target="_blank" rel="noopener noreferrer" class="popup-gmaps-btn">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"></polygon><line x1="8" y1="2" x2="8" y2="18"></line><line x1="16" y1="6" x2="16" y2="22"></line></svg>
          Open in Google Maps ↗
        </a>
      </div>
    `;

    marker.bindPopup(popupHtml);
    markersLayer.addLayer(marker);
  });

  // Fit bounds if container is visible and markers exist
  const container = document.getElementById('vancouver-map');
  const isVisible = container && container.offsetWidth > 0 && container.offsetHeight > 0;

  if (bounds.length > 0 && isVisible) {
    try {
      mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    } catch (e) {
      // Graceful fallback
    }
  } else if (!isVisible && bounds.length > 0) {
    // Save pending bounds to fit once container becomes visible
    window._pendingMapBounds = bounds;
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

window.initVancouverMap = initVancouverMap;
window.updateMapMarkers = updateMapMarkers;
window.invalidateVancouverMap = invalidateVancouverMap;
