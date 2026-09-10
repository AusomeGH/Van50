// Van50 — Leaflet Map Integration
// Plots verified Vancouver outings on dark-themed map with custom badges and direct booking popups.

let mapInstance = null;
let markersLayer = null;

function initVancouverMap() {
  const mapContainer = document.getElementById('vancouver-map');
  if (!mapContainer || typeof L === 'undefined') return;

  // Center on Downtown / False Creek / Mount Pleasant Vancouver
  mapInstance = L.map('vancouver-map', {
    center: [49.2745, -123.1165],
    zoom: 13,
    minZoom: 11,
    maxZoom: 18,
    zoomControl: true
  });

  // Dark-themed CartoDB Positron/Dark Matter tiles
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(mapInstance);

  markersLayer = L.layerGroup().addTo(mapInstance);
  window.vancouverMapInstance = mapInstance;

  // Re-plot when map container size changes
  window.addEventListener('resize', () => {
    if (mapInstance) mapInstance.invalidateSize();
  });
}

function invalidateVancouverMap() {
  if (window.vancouverMapInstance) {
    window.vancouverMapInstance.invalidateSize();
  }
}

function updateMapMarkers(events) {
  if (!mapInstance || !markersLayer) return;

  markersLayer.clearLayers();
  if (!events || events.length === 0) return;

  const bounds = [];

  events.forEach(ev => {
    if (!ev.coordinates || !Array.isArray(ev.coordinates) || ev.coordinates.length < 2) return;
    const [lat, lng] = ev.coordinates;
    bounds.push([lat, lng]);

    const priceText = ev.isFree ? "Free" : `$${ev.price.toFixed(ev.price % 1 === 0 ? 0 : 2)}`;

    // Custom HTML div marker
    const customIcon = L.divIcon({
      className: 'custom-pin-wrapper',
      html: `
        <div class="custom-map-pin">
          <span>${ev.categoryIcon || '📍'}</span>
          <span>${priceText}</span>
        </div>
      `,
      iconSize: [80, 30],
      iconAnchor: [40, 15]
    });

    const marker = L.marker([lat, lng], { icon: customIcon });

    const gmapsUrl = `https://www.google.com/maps?q=${lat},${lng}+(${encodeURIComponent(ev.venue || 'Vancouver')})`;

    // Popup content with direct link & Google Maps navigation
    const popupHtml = `
      <div class="popup-inner-box">
        <div style="font-size: 0.68rem; font-weight: 700; color: #a855f7; text-transform: uppercase; margin-bottom: 2px;">
          ${ev.frequencyLabel || 'Vancouver Event'}
        </div>
        <div class="popup-title">
          <a href="${ev.websiteUrl}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: underline; text-underline-offset: 2px;">
            ${ev.title} ↗
          </a>
        </div>
        <div class="popup-venue">📍 ${ev.venue}</div>
        <div class="popup-price">💰 ${ev.priceLabel}</div>
        <div style="font-size: 0.74rem; color: #94a3b8; margin-bottom: 8px;">
          🚇 ${ev.transitInfo || 'Transit accessible'}
        </div>
        <a href="${ev.websiteUrl}" target="_blank" rel="noopener noreferrer" class="popup-btn">
          Get Tickets / Details ↗
        </a>
        <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" class="popup-gmaps-btn">
          🗺️ Open in Google Maps ↗
        </a>
      </div>
    `;

    marker.bindPopup(popupHtml);
    markersLayer.addLayer(marker);
  });

  // Fit bounds if markers exist
  if (bounds.length > 0) {
    try {
      mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    } catch (e) {
      // Graceful fallback
    }
  }
}
