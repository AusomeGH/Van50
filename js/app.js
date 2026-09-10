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
    const res = await fetch('data/events.json');
    if (res.ok) {
      const data = await res.json();
      if (data.events && Array.isArray(data.events)) {
        ALL_EVENTS = data.events;
        window.VANCOUVER_EVENTS = data.events;
        if (data.metadata && data.metadata.updatedAt) {
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
    const rqRes = await fetch('data/manual_review_queue.json');
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
  // Search input
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase().trim();
      applyFiltersAndRender();
    });
  }

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
// 3. CORE FILTERING ALGORITHM (WITH INTERNAL ENDED-EVENT TRACKER)
// ==============================================================================

function applyFiltersAndRender() {
  const now = new Date();
  let activeCatalog = [];
  let expiredCount = 0;

  // Requirement 4: Internal Tracker for Ended Events (Strictly Excluded)
  ALL_EVENTS.forEach(ev => {
    if (ev.isDaily || !ev.endIso) {
      activeCatalog.push(ev);
    } else if (new Date(ev.endIso) < now) {
      expiredCount++;
    } else {
      activeCatalog.push(ev);
    }
  });

  state.expiredCount = expiredCount;

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

    // 9. Smart Text Search Query with Stemming & Typo Tolerance (Requirement 6)
    if (state.searchQuery) {
      if (!matchesSmartSearch(ev, state.searchQuery)) return false;
    }

    return true;
  });

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
      ? ` <span style="font-size: 0.78rem; opacity: 0.7; margin-left: 8px;">(${state.expiredCount} ended event filtered)</span>` 
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
    if (filtered.length === 0 && state.searchQuery && state.category !== 'all') {
      const crossMatches = activeCatalog.filter(ev => matchesSmartSearch(ev, state.searchQuery)).length;
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
  if (docTok.includes(queryTok) || queryTok.includes(docTok)) return true;
  if (queryTok.length < 4 || docTok.length < 4) return false;
  if (Math.abs(queryTok.length - docTok.length) > 1) return false;

  let diffs = 0;
  let i = 0, j = 0;
  while (i < queryTok.length && j < docTok.length) {
    if (queryTok[i] !== docTok[j]) {
      diffs++;
      if (diffs > 1) return false;
      if (queryTok.length > docTok.length) { i++; continue; }
      if (queryTok.length < docTok.length) { j++; continue; }
    }
    i++;
    j++;
  }
  diffs += (queryTok.length - i) + (docTok.length - j);
  return diffs <= 1;
}

// Full-Spectrum Smart Search Engine (Stemming, Typos, Transit, Pricing, Category & Synonyms)
function matchesSmartSearch(ev, query) {
  if (!query) return true;
  const qTokens = normalizeSearchText(query).split(' ').filter(Boolean);
  if (qTokens.length === 0) return true;

  const venueAliasesStr = Array.isArray(ev.venueAliases) ? ev.venueAliases.join(' ') : (ev.venueAliases || '');
  const performersStr = Array.isArray(ev.performers) ? ev.performers.join(' ') : (ev.performers || '');
  const subTagsStr = Array.isArray(ev.subTags) ? ev.subTags.join(' ') : '';
  
  // Day names expansion
  const dayNames = {
    sun: 'sunday weekend',
    mon: 'monday weekday',
    tue: 'tuesday weekday',
    wed: 'wednesday midweek weekday',
    thu: 'thursday weekday',
    fri: 'friday weekend',
    sat: 'saturday weekend',
    daily: 'daily everyday anytime 7 days'
  };
  const daysStr = Array.isArray(ev.daysOfWeek) ? ev.daysOfWeek.map(d => dayNames[d] || d).join(' ') : '';

  // Contextual synonyms, landmarks, and cultural hubs
  let extraAliases = '';
  const vLower = (ev.venue || '').toLowerCase();
  const tLower = (ev.title || '').toLowerCase();
  const cLower = (ev.category || '').toLowerCase();

  if (vLower.includes('slice of life') || tLower.includes('slice of life')) {
    extraAliases += ' east van gallery maker printmaking linocut zine drawing figure clay pottery lego social commercial drive';
  } else if (vLower.includes('public disco') || tLower.includes('public disco')) {
    extraAliases += ' dance party block party djs electronic house music open air warehouse bentall outdoor plaza roving dance';
  } else if (vLower.includes('hand eye') || tLower.includes('hand eye')) {
    extraAliases += ' pottery ceramics open studio wheel throwing handbuilding clay clark drive';
  } else if (vLower.includes('cafe au clay') || tLower.includes('cafe au clay')) {
    extraAliases += ' pottery ceramics painting bisque mugs granville island false creek creative date';
  } else if (vLower.includes('basic inquiry') || tLower.includes('basic inquiry')) {
    extraAliases += ' life drawing figure drawing sketching model live model chinatown main st art';
  } else if (vLower.includes('2nd floor') || ev.id.includes('2nd-floor')) {
    extraAliases += ' water street cafe water st cafe gastown jazz supper club';
  } else if (vLower.includes('dr. sun yat-sen') || ev.id.includes('sun-yat-sen')) {
    extraAliases += ' chinese garden chinatown garden classical courtyard';
  } else if (vLower.includes('nat bailey')) {
    extraAliases += ' scotiabank field canadians baseball hillcrest park';
  } else if (vLower.includes('stanley park')) {
    extraAliases += ' seawall lost lagoon pitch putt';
  }

  // Category synonyms
  if (cLower === 'crafts') {
    extraAliases += ' craft crafts studio maker hands on tactile workshop drop in art create ceramics pottery drawing paint';
  } else if (cLower === 'music') {
    extraAliases += ' concert gig live band jazz soul indie rock dance electronic';
  } else if (cLower === 'shows') {
    extraAliases += ' comedy standup improv theatre performance show';
  } else if (cLower === 'cinema') {
    extraAliases += ' movie film screening matinee midnight cult art house';
  } else if (cLower === 'outdoors') {
    extraAliases += ' walk nature park seawall beach garden suspension bridge';
  } else if (cLower === 'activities') {
    extraAliases += ' active sports games boardgames trivia market';
  } else if (cLower === 'social') {
    extraAliases += ' party dance gathering social meetup lego';
  }

  const searchableContent = normalizeSearchText([
    ev.title,
    ev.venue,
    ev.address,
    ev.neighborhood,
    ev.description,
    ev.dateSchedule,
    ev.category,
    ev.categoryLabel,
    ev.transitInfo,
    ev.ticketProvider,
    ev.priceLabel,
    ev.isFree ? 'free $0 zero' : 'paid ticket',
    ev.artist,
    performersStr,
    subTagsStr,
    venueAliasesStr,
    daysStr,
    extraAliases
  ].filter(Boolean).join(' '));

  const docTokens = searchableContent.split(' ').filter(tok => tok.length > 1);
  const docStems = docTokens.map(stemWord);

  return qTokens.every(qTok => {
    // 1. Direct substring in full normalized content
    if (searchableContent.includes(qTok)) return true;
    // 2. Word stem matching (e.g. "ceramics" -> "ceramic", "paintings" -> "paint")
    const qStem = stemWord(qTok);
    if (docStems.includes(qStem)) return true;
    // 3. Typo tolerance matching (Levenshtein diff <= 1 for tokens >= 4 chars)
    return docTokens.some(dTok => isFuzzyTokenMatch(qTok, dTok));
  });
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

  // 1. Daily Spots
  if (ev.frequency === 'daily' || (ev.daysOfWeek && ev.daysOfWeek.includes('daily'))) {
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

  // 2. Weekly Recurring Events
  if (ev.frequency === 'weekly' || (ev.daysOfWeek && ev.daysOfWeek.length > 0 && !ev.daysOfWeek.includes('daily'))) {
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

  // 3. Monthly Recurring Events
  if (ev.frequency === 'monthly') {
    if (ev.startIso) {
      const start = new Date(ev.startIso);
      if (!isNaN(start.getTime()) && start >= today) {
        const fmt = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        return {
          type: 'monthly',
          label: 'Next Show',
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

  // 3b. Annual & Seasonal Festivals (e.g. Car Free Day, Khatsahlano, Shipyards Live)
  if (ev.frequency === 'annual' || ev.frequency === 'seasonal') {
    if (ev.startIso) {
      const start = new Date(ev.startIso);
      if (!isNaN(start.getTime())) {
        const fmt = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        return {
          type: 'seasonal',
          label: ev.frequency === 'annual' ? 'Annual Festival' : 'Seasonal Event',
          dates: fmt
        };
      }
    }
    return {
      type: 'seasonal',
      label: 'Festival Season',
      dates: ev.dateSchedule || 'Annual community event'
    };
  }

  // 4. One-off Events
  if (ev.startIso) {
    const start = new Date(ev.startIso);
    if (!isNaN(start.getTime())) {
      const fmt = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return {
        type: 'one-off',
        label: 'Event Date',
        dates: fmt
      };
    }
  }

  return null;
}

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

  grid.innerHTML = venueBannerHtml + events.map(ev => {
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
    const venueTotalCount = ALL_EVENTS.filter(e => e.venue === ev.venue).length;
    const isThisVenueSelected = state.selectedVenue === ev.venue;
    const venueOtherEventsBtnHtml = venueTotalCount > 1 ? `
      <button 
        type="button" 
        class="btn-venue-filter ${isThisVenueSelected ? 'active' : ''}" 
        onclick="filterByVenue('${(ev.venue || '').replace(/'/g, "\\'")}')" 
        title="${isThisVenueSelected ? 'Clear filter for ' + ev.venue : 'Show all ' + venueTotalCount + ' events at ' + ev.venue}"
      >
        🏛️ ${isThisVenueSelected ? 'Viewing this venue ✕' : 'Other events here (' + (venueTotalCount - 1) + ')'}
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
          <span>${ev.dateSchedule}</span>
        </div>

        ${nextDatesHtml}

        ${tiersHtml}

        <p class="card-desc">${ev.description}</p>

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
  }).join('');
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
        No saved outings yet.<br>Click 🤍 on any card to bookmark an outing.
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
        <button class="btn-remove-item" onclick="toggleSaveEvent('${ev.id}')" title="Remove from Itinerary">✕</button>
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
    alert('Your itinerary is currently empty. Save some outings first!');
    return;
  }

  let totalCost = 0;
  let text = `🌲 Van50 — Vancouver Outings Itinerary (Under $50 CAD)\n\n`;
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
      btn.textContent = '✅ Copied to Clipboard!';
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
  const badge = document.getElementById('review-queue-count');
  const items = (typeof MANUAL_REVIEW_QUEUE !== 'undefined') ? MANUAL_REVIEW_QUEUE : [];
  if (badge) {
    badge.textContent = items.length;
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

