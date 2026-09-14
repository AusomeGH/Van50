// Van50 — Application State Management, Multi-Filter Engine & UI Orchestration
// Strictly displays events under $50.00 CAD total out-of-pocket per person.

const state = {
  minBudget: 0,
  maxBudget: 50,
  hideDaily: false,
  category: 'all',
  frequency: 'all',
  dayOfWeek: 'all',
  timeSlot: 'all',
  selectedNeighborhoods: new Set(typeof NEIGHBORHOODS !== 'undefined' ? NEIGHBORHOODS : []),
  selectedTag: null,
  selectedVenue: null,
  searchQuery: '',
  savedEvents: new Set(),
  collapsedTimeGroups: new Set(),
  expiredCount: 0
};

// Global reference for roulette & map
window.currentFilteredEvents = [];
let ALL_EVENTS = typeof VANCOUVER_EVENTS !== 'undefined' ? VANCOUVER_EVENTS : [];

// Initialize on DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  loadSavedState();
  setupEventListeners();
  renderCategoryPills();
  renderDayPills();
  renderTimePills();
  renderNeighborhoodPills();
  renderFrequencyPills();
  updateSliderVisuals();
  applyFiltersAndRender();
  initVancouverMap();
  updateReviewQueueBadge();
  loadCentralReference();
});

// Asynchronously load central reference data feed (data/events.json)
async function loadCentralReference() {
  try {
    const res = await fetch('data/events.json?v=5.1.0');
    if (res.ok) {
      const data = await res.json();
      if (data.events && Array.isArray(data.events)) {
        ALL_EVENTS = data.events;
        window.VANCOUVER_EVENTS = data.events;
        if (data.metadata && data.metadata.updatedAt) {
          state.updatedAt = data.metadata.updatedAt;
          showSyncTimestamp(data.metadata.updatedAt, data.events.length);
        }
        applyFiltersAndRender();
      }
    }
  } catch (err) {
    console.log('Using offline embedded reference sheet.');
  }

  // Also load quarantined manual review queue
  try {
    const rqRes = await fetch('data/manual_review_queue.json?v=5.1.0');
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
  const badgeText = document.getElementById('sync-status-text');
  if (!badgeText) return;
  try {
    const d = new Date(isoStr);
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    badgeText.textContent = `100% Live Checkout Verified • Auto-Synced (${count} Active Events • ${timeStr})`;
  } catch (e) {
    badgeText.textContent = `100% Live Checkout Verified • Auto-Synced (${count} Active Events)`;
  }
}

// ==============================================================================
// 1. FILTER CONTROLS & DUAL SLIDER
// ==============================================================================

function setupEventListeners() {
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
      mapWrapper.style.display = 'none';
    });

    viewMapBtn.addEventListener('click', () => {
      viewMapBtn.classList.add('active');
      viewCardsBtn.classList.remove('active');
      eventsGrid.style.display = 'none';
      mapWrapper.style.display = 'block';

      // Ensure Leaflet calculates real container size & renders dark tiles properly
      setTimeout(() => {
        if (window.vancouverMapInstance) {
          window.vancouverMapInstance.invalidateSize();
        } else if (typeof initVancouverMap === 'function') {
          initVancouverMap();
        }
        if (typeof updateMapMarkers === 'function') {
          updateMapMarkers(window.currentFilteredEvents || ALL_EVENTS || []);
        }
      }, 80);
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
  } else if (minVal >= 1 && maxVal === 50) {
    const paidBtn = document.getElementById('quick-cost-paid');
    if (paidBtn) paidBtn.classList.add('active');
  } else if (minVal === 0 && maxVal === 50) {
    const allBtn = document.getElementById('quick-cost-all');
    if (allBtn) allBtn.classList.add('active');
  }
}

// ==============================================================================
// 2. RENDERING FILTER PILLS
// ==============================================================================

function renderCategoryPills() {
  const container = document.getElementById('categories-bar');
  if (!container || typeof CATEGORIES === 'undefined') return;

  container.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const pill = document.createElement('button');
    pill.className = `category-pill ${state.category === cat.id ? 'active' : ''}`;
    pill.innerHTML = `<span>${cat.icon}</span> <span>${cat.label}</span>`;
    pill.addEventListener('click', () => {
      state.category = cat.id;
      renderCategoryPills();
      applyFiltersAndRender();
    });
    container.appendChild(pill);
  });
}

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
    pill.innerHTML = `<span>${slot.icon}</span> <span>${slot.label}</span>`;
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
    pill.innerHTML = `<span>📍</span> <span>${nh}</span>`;
    pill.addEventListener('click', () => {
      if (state.selectedNeighborhoods.has(nh)) {
        state.selectedNeighborhoods.delete(nh);
      } else {
        state.selectedNeighborhoods.add(nh);
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
 * Detects whether an event has passed or all confirmed dates have elapsed.
 * Daily, weekly, and monthly recurring outings (which run continuously) remain active.
 */
function isEventInPast(ev, now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const todayStr = `${year}-${month}-${day}`;

  // If specific confirmed dates list exists (e.g. seasonal pop-ups / series sessions)
  if (Array.isArray(ev.confirmedDates) && ev.confirmedDates.length > 0) {
    const hasUpcoming = ev.confirmedDates.some(d => String(d).slice(0, 10) >= todayStr);
    if (!hasUpcoming) {
      return true;
    }
  }

  // Daily, weekly, and monthly recurring programs run continuously
  const isRecurring = ev.isDaily || ev.frequency === 'daily' || ev.frequency === 'weekly' || ev.frequency === 'monthly';

  if (!isRecurring) {
    if (ev.endIso) {
      const endDt = new Date(ev.endIso);
      if (!isNaN(endDt.getTime()) && endDt < now) {
        return true;
      }
    }
    if (ev.startIso) {
      const startDt = new Date(ev.startIso);
      if (!isNaN(startDt.getTime())) {
        const startDay = String(ev.startIso).slice(0, 10);
        if (startDay < todayStr && startDt < now) {
          return true;
        }
      }
    }
  }

  return false;
}

function applyFiltersAndRender() {
  const now = new Date();
  let activeCatalog = [];
  let expiredCount = 0;

  // Requirement: Strictly exclude past events & awaiting-schedule items from user display
  ALL_EVENTS.forEach(ev => {
    if (isAwaitingSchedule(ev) || isEventInPast(ev, now)) {
      expiredCount++;
    } else {
      activeCatalog.push(ev);
    }
  });

  state.expiredCount = expiredCount;
  window.currentActiveCatalog = activeCatalog;

  // Keep live sync counter in header aligned with active catalog
  const syncBadgeText = document.getElementById('sync-status-text');
  if (syncBadgeText && state.updatedAt) {
    showSyncTimestamp(state.updatedAt, activeCatalog.length);
  }

  const parsedSearch = state.searchQuery ? parseGoogleQuery(state.searchQuery) : null;

  const filtered = activeCatalog.filter(ev => {
    // Venue Isolation Filter (Requirement 7)
    if (state.selectedVenue && ev.venue !== state.selectedVenue) return false;

    // 1. Strict Budget Cap & Slider Range (<= $50.00 CAD)
    if (state.minBudget === 0 && state.maxBudget === 0) {
      if (ev.price > 0) return false;
    } else if (state.minBudget === 1 && state.maxBudget === 50) {
      if (ev.price <= 0) return false;
    } else {
      if (ev.price < state.minBudget || ev.price > state.maxBudget) return false;
    }

    // 2. Category Filter (Requirement 5: Split Cinema & Museums/Arts)
    if (state.category !== 'all' && ev.category !== state.category) return false;

    // 3. Day of the Week Filter (Requirement 1)
    if (state.dayOfWeek !== 'all') {
      if (state.dayOfWeek === 'daily') {
        if (!ev.isDaily && ev.frequency !== 'daily' && (!ev.daysOfWeek || !ev.daysOfWeek.includes('daily'))) {
          return false;
        }
      } else {
        const days = ev.daysOfWeek || [];
        if (!days.includes(state.dayOfWeek) && !ev.isDaily) {
          return false;
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
    if (state.selectedNeighborhoods.size > 0 && !state.selectedNeighborhoods.has(ev.neighborhood)) {
      return false;
    }

    // 7. Ticketed Events Only Toggle (Hides free unticketed public spots and everyday walks)
    if (state.hideDaily) {
      if (ev.ticketProvider === 'Free Public Access' || (ev.isDaily && ev.isFree)) {
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

  // Update Results Counter (with internal ended events tracker & active tag indicator)
  const countBar = document.getElementById('results-count');
  if (countBar) {
    const expiredNote = state.expiredCount > 0 
      ? ` <span style="font-size: 0.78rem; opacity: 0.7; margin-left: 8px;">(${state.expiredCount} past & concluded events filtered)</span>` 
      : '';

    const tagBadgeHtml = state.selectedTag ? `
      <div class="active-tag-pill" title="Filtered by #${state.selectedTag}. Click ✕ to clear.">
        <span class="tag-label">Tag:</span>
        <span>#${state.selectedTag}</span>
        <button type="button" class="btn-clear-tag" onclick="clearSelectedTag()" aria-label="Clear hashtag filter">✕</button>
      </div>
    ` : '';

    // Check for cross-category matches if current category yields 0
    let crossCategoryBannerHtml = '';
    if (filtered.length === 0 && parsedSearch && state.category !== 'all') {
      const crossMatches = activeCatalog.filter(ev => matchesGoogleSearch(ev, parsedSearch)[0]).length;
      if (crossMatches > 0) {
        crossCategoryBannerHtml = `
          <div style="margin-top: 8px;">
            <button type="button" class="btn-cross-category" onclick="resetCategoryForSearch()" style="cursor: pointer; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; padding: 4px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: 600;">
              🔍 Found ${crossMatches} match${crossMatches > 1 ? 'es' : ''} across all categories • View All ↗
            </button>
          </div>
        `;
      }
    }

    countBar.innerHTML = `
      <div class="results-count-text">
        Showing <strong>${filtered.length}</strong> active outings under $50 CAD${expiredNote}
      </div>
      ${tagBadgeHtml}
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
  const catNorm = normalizeSearchText(ev.category || '');
  const catLabelNorm = normalizeSearchText(ev.categoryLabel || '');
  const addrNorm = normalizeSearchText(ev.address || '');
  const neighNorm = normalizeSearchText(ev.neighborhood || '');
  const tagsNorm = normalizeSearchText(Array.isArray(ev.subTags) ? ev.subTags.join(' ') : '');
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

  const allContent = `${titleNorm} ${venueNorm} ${descNorm} ${artistNorm} ${orgNorm} ${tagsNorm} ${catNorm} ${catLabelNorm} ${addrNorm} ${neighNorm} ${venueAliasesNorm} ${performersNorm} ${daysNorm} ${extraAliases}`;
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

// 1-Click Venue Isolation Action (Requirement 7)
function filterByVenue(venueName) {
  if (state.selectedVenue === venueName) {
    state.selectedVenue = null;
  } else {
    state.selectedVenue = venueName;
    state.category = 'all'; // Switch to 'all' so user sees complete multi-program lineup
    renderCategoryPills();
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
  state.category = 'all';
  state.frequency = 'all';
  state.dayOfWeek = 'all';
  state.timeSlot = 'all';
  state.selectedNeighborhoods = new Set(typeof NEIGHBORHOODS !== 'undefined' ? NEIGHBORHOODS : []);
  state.selectedTag = null;
  state.selectedVenue = null;
  state.searchQuery = '';
  
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';
  const minSlider = document.getElementById('min-spend-slider');
  const maxSlider = document.getElementById('max-spend-slider');
  if (minSlider) minSlider.value = 0;
  if (maxSlider) maxSlider.value = 50;
  
  renderCategoryPills();
  renderDayPills();
  renderTimePills();
  renderNeighborhoodPills();
  renderFrequencyPills();
  updateSliderVisuals();
  applyFiltersAndRender();
}

function formatStandardPrice(ev) {
  // 1. If explicit priceLabel exists on the event, prioritize it (carries adult rate with concession note)
  if (ev.priceLabel) {
    return ev.priceLabel;
  }
  // 2. Multi-tier events always evaluate and display tier range first
  if (ev.tiers && ev.tiers.length > 1) {
    const minP = Math.min(...ev.tiers.map(t => t.price));
    const maxP = Math.max(...ev.tiers.map(t => t.price));
    if (minP === maxP) {
      return minP === 0 ? 'Free ($0)' : `$${minP.toFixed(2)} all-in`;
    }
    if (minP === 0) {
      return `Free – $${maxP.toFixed(2)} all-in`;
    }
    return `$${minP.toFixed(2)} – $${maxP.toFixed(2)} all-in`;
  }
  // 3. Strict Free Check: only if price is 0 AND no paid tiers exist
  if ((ev.isFree || ev.price === 0) && (!ev.tiers || !ev.tiers.some(t => t.price > 0))) {
    return 'Free ($0)';
  }
  if (ev.pricingType === 'door') {
    return `$${ev.price.toFixed(2)} door`;
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

  // 1. Daily Invariants (Stanley Park Seawall, Lynn Canyon, Public Markets, etc.)
  if (ev.isDaily || ev.frequency === 'daily' || (ev.daysOfWeek && ev.daysOfWeek.includes('daily'))) {
    const d1 = new Date(today);
    const d2 = new Date(today);
    d2.setDate(d2.getDate() + 1);
    const fmt1 = d1.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const fmt2 = d2.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    return {
      type: 'daily',
      label: 'Open Daily',
      dates: `Today (${fmt1}) • Tomorrow (${fmt2})`
    };
  }

  // 2. Strict Evidence-Grounded Confirmed Dates
  if (Array.isArray(ev.confirmedDates)) {
    if (ev.confirmedDates.length > 0) {
      const validFuture = [];
      for (const dStr of ev.confirmedDates) {
        if (!dStr) continue;
        const parts = dStr.split('-');
        if (parts.length === 3) {
          const cand = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          if (cand >= today) {
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
    if (ev.startIso) {
      const start = new Date(ev.startIso);
      if (!isNaN(start.getTime()) && start >= today) {
        const isToday = start.toDateString() === today.toDateString();
        const fmt = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        return {
          type: 'seasonal',
          label: 'Confirmed Festival Date',
          dates: isToday ? `Today (${fmt})` : fmt
        };
      }
    }
    return {
      type: 'seasonal',
      label: 'Seasonal Schedule',
      dates: 'Seasonal / Awaiting Next Schedule'
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

  // 1. Daily Invariants: open every day -> "today"
  if (ev.isDaily || ev.frequency === 'daily' || (ev.daysOfWeek && ev.daysOfWeek.includes('daily'))) {
    return { bucket: 'today', date: today };
  }

  // 2. Confirmed dates array
  if (Array.isArray(ev.confirmedDates) && ev.confirmedDates.length > 0) {
    const futureDates = [];
    for (const dStr of ev.confirmedDates) {
      if (!dStr) continue;
      const parts = dStr.split('-');
      if (parts.length === 3) {
        const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        if (d >= today) {
          futureDates.push(d);
        }
      }
    }
    if (futureDates.length > 0) {
      futureDates.sort((a, b) => a - b);
      return categorizeDateBucket(futureDates[0], today, tomorrow, thisWeekSunday, nextWeekMonday, nextWeekSunday);
    }
  }

  // 3. startIso
  if (ev.startIso) {
    const d = new Date(ev.startIso);
    if (!isNaN(d.getTime())) {
      const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      if (startDay >= today) {
        return categorizeDateBucket(startDay, today, tomorrow, thisWeekSunday, nextWeekMonday, nextWeekSunday);
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
        if (targetDays.includes(candidate.getDay())) {
          return categorizeDateBucket(candidate, today, tomorrow, thisWeekSunday, nextWeekMonday, nextWeekSunday);
        }
      }
    }
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

function renderEventCards(events) {
  const grid = document.getElementById('events-grid');
  if (!grid) return;

  const venueBannerHtml = state.selectedVenue ? `
    <div class="active-venue-banner" id="active-venue-banner" style="grid-column: 1 / -1;">
      <div class="venue-banner-content">
        <span class="venue-banner-icon">🏛️</span>
        <span>Showing all <strong>${events.length}</strong> verified events at <strong>${state.selectedVenue}</strong></span>
      </div>
      <button type="button" class="btn-clear-venue" onclick="clearSelectedVenue()" aria-label="Clear venue filter">Clear Venue Filter ✕</button>
    </div>
  ` : '';

  if (events.length === 0) {
    grid.innerHTML = `
      ${venueBannerHtml}
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-secondary); background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg);">
        <div style="font-size: 2.5rem; margin-bottom: 12px;">🌲🔍</div>
        <h3 style="font-family: var(--font-heading); font-size: 1.3rem; color: #fff; margin-bottom: 8px;">No Outings Found Matching Filters</h3>
        <p style="font-size: 0.9rem; max-width: 440px; margin: 0 auto 18px;">
          Try selecting "All Days" or "Any Time", widening your spend slider, clearing active tags, or toggling off "Ticketed events only".
        </p>
        <button class="btn btn-roulette" onclick="resetAllFilters()">Reset All Filters</button>
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
    { key: 'today', title: "Today's Events", shortTitle: "Today", icon: '⚡', range: todayLabel, list: buckets.today },
    { key: 'tomorrow', title: "Tomorrow's Events", shortTitle: "Tomorrow", icon: '🌅', range: tomorrowLabel, list: buckets.tomorrow },
    { key: 'this_week', title: "This Week's Events", shortTitle: "This Week", icon: '🗓️', range: thisWeekLabel, list: buckets.this_week },
    { key: 'next_week', title: "Next Week's Events", shortTitle: "Next Week", icon: '📅', range: nextWeekLabel, list: buckets.next_week },
    { key: 'upcoming', title: "Upcoming & Future Events", shortTitle: "Upcoming", icon: '🔮', range: upcomingLabel, list: buckets.upcoming }
  ];

  const activeBuckets = bucketMeta.filter(b => b.list.length > 0);

  // Quick navigation anchor bar (rendered if 2 or more buckets have items)
  let navBarHtml = '';
  if (activeBuckets.length > 1) {
    navBarHtml = `
      <nav class="time-nav-bar" aria-label="Jump to event timeframes">
        ${activeBuckets.map(b => `
          <a href="#group-${b.key}" class="time-nav-pill" onclick="smoothScrollToTimeGroup('group-${b.key}', event)">
            <span>${b.icon} ${b.shortTitle}</span>
            <span class="time-nav-count">${b.list.length}</span>
          </a>
        `).join('')}
      </nav>
    `;
  }

  // Render sections
  const sectionsHtml = activeBuckets.map(b => {
    const isCollapsed = Boolean(state.collapsedTimeGroups && state.collapsedTimeGroups.has(b.key));
    const cardsHtml = b.list.map(ev => renderSingleEventCardHtml(ev)).join('');
    return `
      <section class="events-time-group ${isCollapsed ? 'collapsed' : ''}" id="group-${b.key}">
        <div class="time-group-header" onclick="toggleTimeGroup('${b.key}')" role="button" tabindex="0" aria-expanded="${!isCollapsed}" aria-controls="cards-grid-${b.key}" title="Click to ${isCollapsed ? 'expand' : 'collapse'} ${b.title}">
          <div class="time-group-title-wrap">
            <span class="time-group-icon">${b.icon}</span>
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
            <span class="collapsed-banner-info">${b.icon} <strong>${b.title}</strong> is collapsed (${b.list.length} event${b.list.length === 1 ? '' : 's'})</span>
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

  grid.innerHTML = venueBannerHtml + navBarHtml + sectionsHtml;
}

function renderSingleEventCardHtml(ev) {
    const isSaved = state.savedEvents.has(ev.id);
    const freqClass = (ev.frequency || 'one-off').toLowerCase();
    const isSoldOut = Boolean(ev.isSoldOut);
    const standardPrice = formatStandardPrice(ev);
    
    // Hyperlinks & Direct Pinpoint Navigation Target (Google Maps coordinates)
    const venueUrl = ev.venueUrl || (typeof VENUE_URLS !== 'undefined' ? VENUE_URLS[ev.venue] : null) || ('https://www.google.com/search?q=' + encodeURIComponent((ev.venue || '') + ' Vancouver'));
    const hasCoords = ev.coordinates && Array.isArray(ev.coordinates) && ev.coordinates.length >= 2;
    const gmapsUrl = hasCoords 
      ? `https://www.google.com/maps?q=${ev.coordinates[0]},${ev.coordinates[1]}+(${encodeURIComponent(ev.venue || 'Vancouver')})`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((ev.venue || '') + ', ' + (ev.address || 'Vancouver BC'))}`;

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
        🏛️ ${isThisVenueSelected ? 'Viewing this venue ✕' : 'See all ' + venueTotalCount + ' events here'}
      </button>
    ` : '';
    
    // Dynamic Next-Two-Dates calculation
    const nextDates = calculateNextTwoDates(ev);
    const nextDatesHtml = nextDates ? `
      <div class="card-next-dates-box" title="Upcoming confirmed dates">
        <span class="next-dates-badge">⚡ ${nextDates.label}:</span>
        <span class="next-dates-text">${nextDates.dates}</span>
      </div>
    ` : '';

    // Multi-tier compact chip summary
    const tiersHtml = (ev.tiers && ev.tiers.length > 1) ? `
      <div class="card-tiers-box">
        <span class="tier-chip-summary">Tiers:</span>
        <div class="card-tiers-pills">
          ${ev.tiers.map(t => `
            <span class="tier-pill">
              <span class="tier-name">${t.name}:</span>
              <span class="tier-price">${t.label}</span>
            </span>
          `).join('')}
        </div>
      </div>
    ` : '';

    // Sub-tags chips with active state & click-to-deselect (capped to top 3 for clean display)
    let subtagsHtml = '';
    if (ev.subTags && ev.subTags.length > 0) {
      const displayedTags = ev.subTags.slice(0, 3);
      const remainingCount = ev.subTags.length - 3;
      subtagsHtml = `
        <div class="card-subtags-row">
          ${displayedTags.map(tag => {
            const norm = tag.toLowerCase().replace(/^#/, '');
            const isActive = state.selectedTag === norm;
            return `
              <button 
                type="button" 
                class="subtag-chip ${isActive ? 'active' : ''}" 
                onclick="filterBySubTag('${norm}')" 
                title="${isActive ? 'Click to deselect #' + norm : 'Filter outings by #' + norm}"
                aria-pressed="${isActive}"
              >
                #${norm}${isActive ? ' <span class="chip-deselect" aria-hidden="true">✕</span>' : ''}
              </button>
            `;
          }).join('')}
          ${remainingCount > 0 ? `
            <span class="subtag-chip" style="opacity: 0.6; cursor: default;" title="${ev.subTags.slice(3).join(', ')}">+${remainingCount}</span>
          ` : ''}
        </div>
      `;
    }

    // CTA button with Sold-Out handling (links to ticketing portal waitlist if sold out)
    const ctaButtonHtml = isSoldOut ? `
      <a 
        href="${ev.websiteUrl}" 
        target="_blank" 
        rel="noopener noreferrer" 
        class="btn-ticket-cta sold-out"
        aria-label="${ev.title} is sold out - check ticket portal or waitlist"
      >
        Sold Out (Waitlist) ↗
      </a>
    ` : `
      <a 
        href="${ev.websiteUrl}" 
        target="_blank" 
        rel="noopener noreferrer" 
        class="btn-ticket-cta"
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

    const popoverHtml = tooltipText ? `
      <span class="price-info-popover" title="${tooltipText.replace(/"/g, '&quot;')}" aria-label="Fee breakdown details">?</span>
    ` : '';

    return `
      <article class="event-card ${isSoldOut ? 'card-sold-out' : ''}" id="card-${ev.id}">
        ${isSoldOut ? '<div class="sold-out-ribbon">SOLD OUT</div>' : ''}

        <!-- Top Bar: Clean Meta (Recurrence + Neighborhood) + Save Button -->
        <div class="card-top-bar">
          <div class="card-top-meta">
            <span class="card-meta-pill ${freqClass}">
              <span>${ev.categoryIcon || '✨'}</span>
              <span>${ev.frequencyLabel || 'Outing'}</span>
            </span>
            <span class="card-meta-dot">•</span>
            <span class="card-meta-neighborhood">📍 ${ev.neighborhood}</span>
          </div>

          <button 
            class="btn-save-card ${isSaved ? 'saved' : ''}" 
            onclick="toggleSaveEvent('${ev.id}')" 
            aria-label="${isSaved ? 'Remove from Saved' : 'Save Outing'}"
            title="${isSaved ? 'Remove from Saved' : 'Save Outing'}"
          >
            ${isSaved ? '❤️' : '🤍'}
          </button>
        </div>

        <!-- Event Details: Clickable Title Link -->
        <h2 class="card-title">
          <a href="${ev.websiteUrl}" target="_blank" rel="noopener noreferrer" class="card-title-link" title="Get tickets & details for ${ev.title}">
            ${ev.title}
          </a>
        </h2>
        
        <!-- Band / Artist Highlight Badge (if present) -->
        ${(ev.artist || ev.performers) ? `
          <div class="card-artist-badge" title="Featured band / artist lineup">
            <span class="artist-icon">🎵</span>
            <span class="artist-label">Featuring:</span>
            <strong class="artist-name">${ev.artist || (Array.isArray(ev.performers) ? ev.performers.join(', ') : ev.performers)}</strong>
          </div>
        ` : ''}

        <!-- Roving / Nomadic Series Organizer Badge -->
        ${ev.organizer ? `
          <div class="card-organizer-badge" title="Roving community event organized by ${ev.organizer}">
            <span class="organizer-icon">🏛️</span>
            <span class="organizer-label">Roving Series:</span>
            <strong class="organizer-name">${ev.organizer}</strong>
            ${ev.editionVenue ? `<span class="edition-venue">(${ev.editionVenue})</span>` : ''}
          </div>
        ` : ''}

        <!-- Age & Admission Policy Badges (QC Verified) -->
        ${(ev.agePolicy || ev.admissionPolicy) ? `
          <div class="card-policy-row">
            ${ev.agePolicy ? `<span class="policy-pill age-policy" title="${ev.agePolicy}">🛡️ ${ev.agePolicy}</span>` : ''}
            ${ev.admissionPolicy ? `<span class="policy-pill admission-policy" title="${ev.admissionPolicy}">🎟️ ${ev.admissionPolicy}</span>` : ''}
          </div>
        ` : ''}

        <!-- Roving Physical Host Note -->
        ${ev.rovingNote ? `
          <div class="card-roving-note">📍 <em>${ev.rovingNote}</em></div>
        ` : ''}
        
        <!-- Venue Row: Direct Pinpoint Google Maps Directions + Official Venue Website + Venue Isolation Filter -->
        <div class="card-venue-row">
          <a href="${gmapsUrl}" target="_blank" rel="noopener noreferrer" class="venue-location-btn venue-location-link card-maps-link" title="Open ${ev.venue} (${ev.address || 'Vancouver'}) in Google Maps for directions">
            <span class="venue-pin-icon">📍</span>
            <span class="venue-name">${ev.venue} (Directions)</span>
          </a>
          ${venueUrl ? `
            <a href="${venueUrl}" target="_blank" rel="noopener noreferrer" class="venue-website-link venue-link" title="Visit official website of ${ev.venue}">
              <span class="website-icon">🌐</span> Venue Site ↗
            </a>
          ` : ''}
          ${venueOtherEventsBtnHtml}
        </div>

        <!-- Schedule Row & Dynamic Next Dates -->
        <div class="card-schedule-row">
          <span>📅</span>
          <span>${ev.dateSchedule || ev.frequencyLabel || 'Check venue calendar'}</span>
        </div>

        ${nextDatesHtml}

        ${tiersHtml}

        <p class="card-desc">${ev.description || ('Live music and performance at ' + ev.venue)}</p>

        ${subtagsHtml}

        <!-- Card Footer: Standardized Checkout Price & Direct Ticket CTA -->
        <div class="card-footer">
          <div class="price-box">
            <div class="price-breakdown-row">
              <span class="price-main ${ev.isFree ? 'free' : ''}">${standardPrice}</span>
              ${popoverHtml}
            </div>
            ${preTaxNoteHtml}
            <span class="price-provider-tag" title="${tooltipText ? 'Live Checkout Verified • ' + tooltipText.replace(/"/g, '&quot;') : 'Live Verified'}">
              ✓ ${ev.ticketProvider}
            </span>
          </div>

          ${ctaButtonHtml}
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
  state.selectedNeighborhoods = new Set(typeof NEIGHBORHOODS !== 'undefined' ? NEIGHBORHOODS : []);
  state.hideDaily = false;
  state.selectedTag = null;
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
          <div style="font-size: 0.74rem; color: var(--text-secondary); margin-bottom: 4px;">📍 ${ev.venue}</div>
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
  let text = `🌲 Van50 — My Saved Vancouver Outings (Under $50 CAD)\n\n`;
  savedList.forEach((ev, i) => {
    totalCost += ev.price;
    text += `${i + 1}. ${ev.title}\n`;
    text += `   📍 Venue: ${ev.venue} (${ev.neighborhood})\n`;
    text += `   📅 When: ${ev.dateSchedule}\n`;
    text += `   💰 Cost: ${formatStandardPrice(ev)}\n`;
    text += `   🎟️ Direct Tickets / Details: ${ev.websiteUrl}\n\n`;
  });
  text += `--------------------------------------------------\n`;
  text += `TOTAL ESTIMATED OUT-OF-POCKET: $${totalCost.toFixed(2)} CAD\n`;
  text += `Generated with Van50 (https://van50.ca)\n`;

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
          class="btn btn-roulette" 
          style="padding: 4px 12px; font-size: 0.76rem; border-radius: var(--radius-sm);"
        >
          Inspect Venue Page ↗
        </a>
      </div>
    </div>
  `).join('');
}

