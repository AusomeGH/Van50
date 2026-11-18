// Van50 — Surprise Outing Generator ("Surprise Me" Roulette)
// Randomly selects an outing from currently active filter parameters with spin animation.

const rouletteEscapeHtml = (str) => {
  if (typeof window !== 'undefined' && typeof window.escapeHtml === 'function') {
    return window.escapeHtml(str);
  }
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
};

const rouletteSafeExternalUrl = (rawUrl) => {
  if (typeof window !== 'undefined' && typeof window.safeExternalUrl === 'function') {
    return window.safeExternalUrl(rawUrl);
  }
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

document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('roulette-modal');
  const openBtn = document.getElementById('btn-open-roulette');
  const closeBtn = document.getElementById('close-roulette-modal');
  const spinBtn = document.getElementById('roulette-action-btn');
  const iconEl = document.getElementById('roulette-icon');
  const titleEl = document.getElementById('roulette-title');
  const descEl = document.getElementById('roulette-desc');

  if (!modal || !openBtn || !closeBtn || !spinBtn) return;

  // Open modal
  openBtn.addEventListener('click', () => {
    modal.classList.add('active'); modal.setAttribute('aria-hidden', 'false'); modal.removeAttribute('inert');
    resetRouletteView();
    if (window.trackAnonymousEvent) {
      window.trackAnonymousEvent('roulette/open', 'Open Roulette Modal');
    }
  });

  // Close modal
  closeBtn.addEventListener('click', () => {
    modal.classList.remove('active'); modal.setAttribute('aria-hidden', 'true'); modal.setAttribute('inert', '');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active'); modal.setAttribute('aria-hidden', 'true'); modal.setAttribute('inert', ''); modal.setAttribute('aria-hidden', 'true'); modal.setAttribute('inert', '');
    }
  });

  // Escape key closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      modal.classList.remove('active'); modal.setAttribute('aria-hidden', 'true'); modal.setAttribute('inert', ''); modal.setAttribute('aria-hidden', 'true'); modal.setAttribute('inert', '');
    }
  });

  function resetRouletteView() {
    iconEl.textContent = '🎲';
    iconEl.classList.remove('spinning');
    titleEl.textContent = 'Need Spontaneous Inspiration?';
    descEl.textContent = 'Hit spin to pick a random event from your active filters.';
    spinBtn.textContent = '✨ Spin for an Outing';
    spinBtn.disabled = false;
  }

  // Spin Roulette
  spinBtn.addEventListener('click', () => {
    const candidates = window.currentFilteredEvents && window.currentFilteredEvents.length > 0
      ? window.currentFilteredEvents
      : (typeof VANCOUVER_EVENTS !== 'undefined' ? VANCOUVER_EVENTS : []);

    if (window.trackAnonymousEvent) {
      window.trackAnonymousEvent('roulette/spin', 'Outing Roulette Spin');
    }

    if (candidates.length === 0) {
      titleEl.textContent = 'No Outings Match Your Filters';
      descEl.textContent = 'Try adjusting your spend range or neighborhood selection first.';
      return;
    }

    spinBtn.disabled = true;
    iconEl.classList.add('spinning');
    titleEl.textContent = 'Selecting Spontaneous Outing...';
    descEl.textContent = 'Exploring Vancouver comedy, music, indie cinema, and trails...';

    const icons = ['🎭', '🎬', '🌲', '🎙️', '🍻', '⚾', '🥟', '🏮', '🪩', '🎲'];
    let counter = 0;
    const interval = setInterval(() => {
      iconEl.textContent = icons[counter % icons.length];
      counter++;
    }, 90);

    setTimeout(() => {
      clearInterval(interval);
      iconEl.classList.remove('spinning');
      spinBtn.disabled = false;
      spinBtn.textContent = '🔄 Spin Again';

      // Pick random event
      const randomIndex = Math.floor(Math.random() * candidates.length);
      const chosen = candidates[randomIndex];

      iconEl.textContent = chosen.categoryIcon || '✨';
      titleEl.textContent = chosen.title || '';

      const escapedId = rouletteEscapeHtml(chosen.id || '');
      const escapedTitle = rouletteEscapeHtml(chosen.title || '');
      const escapedVenue = rouletteEscapeHtml(chosen.venue || '');
      const escapedNeighborhood = rouletteEscapeHtml(chosen.neighborhood || '');
      const escapedPriceLabel = rouletteEscapeHtml(chosen.priceLabel || '');
      const escapedDateSchedule = rouletteEscapeHtml(chosen.dateSchedule || '');
      const safeTicketUrl = rouletteEscapeHtml(rouletteSafeExternalUrl(chosen.websiteUrl));

      descEl.innerHTML = `
        <div style="margin-bottom: 8px;">
          <span style="color: var(--accent-secondary); font-weight: 600;">📍 ${escapedVenue}</span> • 
          <span style="color: var(--text-secondary);">${escapedNeighborhood}</span>
        </div>
        <div style="font-size: 0.92rem; font-weight: 700; color: var(--accent-primary); margin-bottom: 10px;">
          💰 ${escapedPriceLabel}
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 14px;">
          📅 ${escapedDateSchedule}
        </div>
        <div style="display: flex; gap: 8px; justify-content: center;">
          <a href="${safeTicketUrl}" target="_blank" rel="noopener noreferrer" class="btn-ticket-cta" data-event-id="${escapedId}" data-event-title="${escapedTitle}" data-event-venue="${escapedVenue}" data-goatcounter-click="tickets-${escapedId}" data-goatcounter-title="Tickets: ${escapedTitle} (${escapedVenue})" data-goatcounter-no-session="1" style="font-size: 0.82rem; padding: 7px 14px;">
            Get Tickets / Details ↗
          </a>
          <button type="button" class="btn btn-itinerary btn-roulette-save" data-event-id="${escapedId}" style="font-size: 0.82rem; padding: 7px 14px;">
            📌 Save
          </button>
        </div>
      `;

      const saveBtn = descEl.querySelector('.btn-roulette-save');
      if (saveBtn) {
        saveBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (typeof window.toggleSaveEvent === 'function' && chosen.id) {
            window.toggleSaveEvent(chosen.id);
          }
        });
      }
    }, 850);
  });
});
