// Van50 — Surprise Outing Generator ("Surprise Me" Roulette)
// Randomly selects an outing from currently active filter parameters with spin animation.

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
    modal.classList.add('active');
    resetRouletteView();
  });

  // Close modal
  closeBtn.addEventListener('click', () => {
    modal.classList.remove('active');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });

  // Escape key closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) {
      modal.classList.remove('active');
    }
  });

  function resetRouletteView() {
    iconEl.textContent = '🎲';
    iconEl.classList.remove('spinning');
    titleEl.textContent = 'Need Spontaneous Inspiration?';
    descEl.innerHTML = 'Hit spin to pick a random event from your active filters.';
    spinBtn.textContent = '✨ Spin for an Outing';
    spinBtn.disabled = false;
  }

  // Spin Roulette
  spinBtn.addEventListener('click', () => {
    const candidates = window.currentFilteredEvents && window.currentFilteredEvents.length > 0
      ? window.currentFilteredEvents
      : (typeof VANCOUVER_EVENTS !== 'undefined' ? VANCOUVER_EVENTS : []);

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
      titleEl.textContent = chosen.title;
      
      descEl.innerHTML = `
        <div style="margin-bottom: 8px;">
          <span style="color: var(--accent-secondary); font-weight: 600;">📍 ${chosen.venue}</span> • 
          <span style="color: var(--text-secondary);">${chosen.neighborhood}</span>
        </div>
        <div style="font-size: 0.92rem; font-weight: 700; color: var(--accent-primary); margin-bottom: 10px;">
          💰 ${chosen.priceLabel}
        </div>
        <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 14px;">
          📅 ${chosen.dateSchedule}
        </div>
        <div style="display: flex; gap: 8px; justify-content: center;">
          <a href="${chosen.websiteUrl}" target="_blank" rel="noopener noreferrer" class="btn-ticket-cta" style="font-size: 0.82rem; padding: 7px 14px;">
            Get Tickets / Details ↗
          </a>
          <button class="btn btn-itinerary" onclick="toggleSaveEvent('${chosen.id}')" style="font-size: 0.82rem; padding: 7px 14px;">
            📌 Save
          </button>
        </div>
      `;
    }, 850);
  });
});
