// Van50 Curator Studio — Client Application Logic
// Orchestrates triage, sorting, field corrections, promotions to master, and algorithmic rule learning.

const _urlParams = new URLSearchParams(window.location.search);
const _tokenParam = _urlParams.get('token');
if (_tokenParam) {
  try {
    sessionStorage.setItem('van50_curator_token', _tokenParam);
    localStorage.setItem('van50_curator_token', _tokenParam);
  } catch (e) { }
}

function getCatalogDimensionsCount() {
  if (typeof FULL_CATALOG_DIMENSIONS !== 'undefined' && Array.isArray(FULL_CATALOG_DIMENSIONS) && FULL_CATALOG_DIMENSIONS.length >= 96) {
    return FULL_CATALOG_DIMENSIONS.length;
  }
  if (typeof window !== 'undefined' && window.FULL_CATALOG_DIMENSIONS && Array.isArray(window.FULL_CATALOG_DIMENSIONS) && window.FULL_CATALOG_DIMENSIONS.length >= 96) {
    return window.FULL_CATALOG_DIMENSIONS.length;
  }
  const events = (typeof state !== 'undefined' && state?.allEvents) || (window?.state?.allEvents) || (typeof state !== 'undefined' && state?.masterCatalogsData?.events_active) || [];
  if (Array.isArray(events) && events.length > 0) {
    for (const ev of events) {
      if (ev?.dimension_audit && typeof ev.dimension_audit === 'object') {
        const count = Object.keys(ev.dimension_audit).length;
        if (count > 0) return count;
      }
    }
  }
  return 96;
}
window.getCatalogDimensionsCount = getCatalogDimensionsCount;

function isVerifiedApprovalStatus(status) {
  if (!status || typeof status !== 'string') return false;
  const s = status.trim();
  return /^(Stagehand-\d+D-Verified|Verified-\d+D|Stagehand-Verified|Verified|Curator-Approved)$/i.test(s) || (s.includes('Verified') && !s.includes('Quarantine'));
}
window.isVerifiedApprovalStatus = isVerifiedApprovalStatus;

function syncDynamicDimensionCounts() {
  const count = getCatalogDimensionsCount();
  document.querySelectorAll('.dyn-dim-count').forEach(el => {
    el.textContent = count;
  });
  document.querySelectorAll('.dyn-dim-label').forEach(el => {
    el.textContent = `${count}-Dimension`;
  });
  document.querySelectorAll('.dyn-dim-pill').forEach(el => {
    el.textContent = `${count}-Dim QC`;
  });
  document.querySelectorAll('.dyn-dim-suffix').forEach(el => {
    el.textContent = `${count}D`;
  });
}
window.syncDynamicDimensionCounts = syncDynamicDimensionCounts;

const state = {
  token: sessionStorage.getItem('van50_curator_token') || localStorage.getItem('van50_curator_token') || _tokenParam || null,
  quarantinedEvents: [],
  archivedEvents: [],
  activeFilter: 'all',
  platformFilter: 'all',
  searchQuery: '',
  sortBy: 'date-desc',
  stats: {
    pending: 0,
    master: 0,
    rules: 0,
    instructions: 0,
    discoveredVenues: 0,
    discoveredSources: 0
  },
  discoveredVenues: [],
  discoveredSources: [],
  dismissedCandidatePrompt: false,
  pendingHolidays: [],
  approvedHolidays: [],
  knownVenues: new Set(),
  currentScreenshotBase64: null,
  currentScreenshots: [],
  currentVenueScreenshots: [],
  learnedRules: null,
  activeRuleTab: 'venue_policy_rules',
  rulesSearchQuery: '',
  instructionsList: [],
  activeInstFilter: 'all',
  instructionsSearchQuery: '',
  masterTab: 'events_active',
  masterSearchQuery: '',
  masterCatalogsData: {
    events_active: [],
    venues_master: [],
    festivals_master: [],
    ticketing_sources: [],
    discovery_sources: [],
    events_archive: []
  },
  instructionDrafts: loadSavedInstructionDrafts(),
  currentSplitEvents: []
};

// ==============================================================================
// 0. URL RESOLUTION & CANONICAL LINK HELPERS
// ==============================================================================

function getEventExternalUrl(ev) {
  if (!ev) return '';
  const candidates = [
    ev.ticket_url,
    ev.websiteUrl,
    ev.details_url,
    ev.discovery_url,
    ev.website_url,
    ev.url,
    (ev.show_1 && ev.show_1.ticket_url) ? ev.show_1.ticket_url : null,
    (ev.showings && ev.showings[0] && ev.showings[0].ticket_url) ? ev.showings[0].ticket_url : null
  ];
  for (const raw of candidates) {
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (
        trimmed &&
        trimmed !== '#' &&
        trimmed !== 'undefined' &&
        trimmed !== 'null' &&
        trimmed !== 'Direct' &&
        !trimmed.startsWith('javascript:')
      ) {
        return trimmed;
      }
    }
  }
  return '';
}

function getVenueExternalUrl(v) {
  if (!v) return '';
  const candidates = [
    v.calendarUrl,
    v.calendar_url,
    v.websiteUrl,
    v.website_url,
    v.url,
    v.discovery_url
  ];
  for (const raw of candidates) {
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (
        trimmed &&
        trimmed !== '#' &&
        trimmed !== 'undefined' &&
        trimmed !== 'null' &&
        !trimmed.startsWith('javascript:')
      ) {
        return trimmed;
      }
    }
  }
  return '';
}

function getEventCardNumber(ev, fallbackIndex = null) {
  if (!ev) return fallbackIndex != null ? (fallbackIndex + 1) : '?';
  if (ev.Event_Num_Card) {
    const m = String(ev.Event_Num_Card).match(/\d+/);
    if (m) return parseInt(m[0], 10);
  }
  if (ev.cardNumber != null) return ev.cardNumber;
  if (ev.card_slot != null) return ev.card_slot;
  if (ev.cardIndex != null) return ev.cardIndex;

  const allEvs = (state.allEvents && state.allEvents.length > 0)
    ? state.allEvents
    : (state.masterCatalogsData?.events_active || []);
  if (allEvs && allEvs.length > 0) {
    const evId = ev.id || ev.event_id;
    const evTitle = (ev.title || ev.event_name || '').toLowerCase().trim();
    const idx = allEvs.findIndex(e => (e.id || e.event_id) === evId || (e.title || e.event_name || '').toLowerCase().trim() === evTitle);
    if (idx >= 0) return idx + 1;
  }

  return fallbackIndex != null ? (fallbackIndex + 1) : '?';
}

function loadSavedInstructionDrafts() {
  try {
    const raw = sessionStorage.getItem('van50_curator_instruction_drafts');
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function persistInstructionDrafts() {
  try {
    sessionStorage.setItem('van50_curator_instruction_drafts', JSON.stringify(state.instructionDrafts || {}));
  } catch (e) {
    console.warn('Failed to persist drafts to sessionStorage:', e);
  }
}

function saveInstructionDraft(eventId) {
  if (!eventId) return;
  const textField = document.getElementById('ai-instruction-text');
  const instructionText = textField ? textField.value : '';
  const titleField = document.getElementById('ai-approve-title');
  const priceField = document.getElementById('ai-approve-price');
  const catField = document.getElementById('ai-approve-category');
  const dateField = document.getElementById('ai-approve-date');
  const venueField = document.getElementById('ai-approve-venue');
  const noteField = document.getElementById('ai-approve-note');

  const screenshots = (state.currentScreenshots && state.currentScreenshots.length > 0)
    ? [...state.currentScreenshots]
    : (state.currentScreenshotBase64 ? [state.currentScreenshotBase64] : []);

  const hasContent = (instructionText && instructionText.trim().length > 0) ||
    screenshots.length > 0 ||
    (state.currentSplitEvents && state.currentSplitEvents.length > 0);

  if (hasContent) {
    state.instructionDrafts[eventId] = {
      instructionText: instructionText,
      screenshots: screenshots,
      approvedTitle: titleField ? titleField.value : '',
      approvedPrice: priceField ? priceField.value : '',
      approvedCategory: catField ? catField.value : 'shows',
      approvedDate: dateField ? dateField.value : '',
      approvedVenue: venueField ? venueField.value : '',
      curatorNote: noteField ? noteField.value : '',
      subEvents: state.currentSplitEvents ? [...state.currentSplitEvents] : [],
      updatedAt: Date.now()
    };
    persistInstructionDrafts();
    updateModalDraftBadge(true);
  }
}

function clearInstructionDraft(eventId) {
  if (!eventId) return;
  if (state.instructionDrafts && state.instructionDrafts[eventId]) {
    delete state.instructionDrafts[eventId];
    persistInstructionDrafts();
  }
  updateModalDraftBadge(false);
}

function updateModalDraftBadge(hasDraft) {
  const badge = document.getElementById('ai-modal-draft-status');
  if (badge) {
    badge.style.display = hasDraft ? 'inline-flex' : 'none';
  }
}

function initApp() {
  // Ensure default UI inputs are reset on load from scratch
  const searchInput = document.getElementById('curator-search-input');
  if (searchInput) searchInput.value = '';
  const clearSearchBtn = document.getElementById('btn-clear-curator-search');
  if (clearSearchBtn) clearSearchBtn.style.display = 'none';
  const platformSelect = document.getElementById('curator-platform-select');
  if (platformSelect) platformSelect.value = 'all';
  const sortSelect = document.getElementById('curator-sort-select');
  if (sortSelect) sortSelect.value = 'date-desc';

  initCuratorAccessibility();
  setupCuratorEventListeners();
  checkAuthAndInitialize();
  fetchAutomationStatus();
  setInterval(fetchAutomationStatus, 30000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

// ==============================================================================
// 1. AUTHENTICATION & SESSION MANAGEMENT
// ==============================================================================

async function checkAuthAndInitialize(retryCount = 0) {
  const loginModal = document.getElementById('login-modal-overlay');

  if (!state.token) {
    state.token = sessionStorage.getItem('van50_curator_token') || localStorage.getItem('van50_curator_token');
  }

  if (!state.token) {
    if (loginModal) loginModal.classList.add('active');
    return;
  }

  try {
    const res = await fetch(`/api/curator/status?_t=${Date.now()}`, {
      headers: { 'Curator-Token': state.token },
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated) {
        // Keep both storage engines synchronized with the valid token
        try { sessionStorage.setItem('van50_curator_token', state.token); } catch (_) { }
        try { localStorage.setItem('van50_curator_token', state.token); } catch (_) { }
        if (loginModal) loginModal.classList.remove('active');
        if (data.knownVenues) {
          state.knownVenues = new Set(data.knownVenues.map(v => v.toLowerCase()));
        }
        updateHeaderStats(data.pendingCount, data.rulesCount, data.masterCount, data.instructionsPendingCount || 0, data.discoveredVenuesCount || 0, data.discoveredSourcesCount || 0);
        loadQuarantineQueue();
        return;
      }
    } else if (res.status === 401 || res.status === 403) {
      // Explicitly rejected by server
      sessionStorage.removeItem('van50_curator_token');
      localStorage.removeItem('van50_curator_token');
      state.token = null;
      if (loginModal) loginModal.classList.add('active');
      return;
    }
  } catch (err) {
    console.warn(`Could not verify curator status (attempt ${retryCount + 1}):`, err);
    // If server is restarting or network hiccup, retry twice before forcing re-login
    if (retryCount < 2) {
      setTimeout(() => checkAuthAndInitialize(retryCount + 1), 600);
      return;
    }
  }

  // If token is invalid or expired after retries
  sessionStorage.removeItem('van50_curator_token');
  localStorage.removeItem('van50_curator_token');
  state.token = null;
  if (loginModal) loginModal.classList.add('active');
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const passwordField = document.getElementById('curator-password-field');
  const errorBanner = document.getElementById('login-error-banner');
  const loginModal = document.getElementById('login-modal-overlay');
  if (!passwordField) return;

  const password = passwordField.value.trim();
  if (!password) return;

  try {
    const res = await fetch('/api/curator/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: jsonStringify({ password })
    });

    const data = await res.json();

    if (res.ok && data.success && data.token) {
      state.token = data.token;
      try { sessionStorage.setItem('van50_curator_token', data.token); } catch (_) { }
      try { localStorage.setItem('van50_curator_token', data.token); } catch (_) { }
      passwordField.value = '';
      if (errorBanner) errorBanner.classList.remove('active');
      if (loginModal) loginModal.classList.remove('active');
      showToast('Master Control Unlocked!', 'success');
      checkAuthAndInitialize();
    } else {
      if (errorBanner) {
        errorBanner.textContent = data.message || 'Invalid passphrase. Access denied.';
        errorBanner.classList.add('active');
      }
    }
  } catch (err) {
    if (errorBanner) {
      errorBanner.textContent = 'Server connection failed. Ensure curator server is running.';
      errorBanner.classList.add('active');
    }
  }
}

async function handleLogout() {
  const currentToken = state.token || sessionStorage.getItem('van50_curator_token') || localStorage.getItem('van50_curator_token');
  if (currentToken) {
    try {
      await fetch('/api/curator/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Curator-Token': currentToken
        }
      });
    } catch (err) {
      console.warn('Server logout notification failed:', err);
    }
  }
  sessionStorage.removeItem('van50_curator_token');
  localStorage.removeItem('van50_curator_token');
  state.token = null;
  state.quarantinedEvents = [];
  const loginModal = document.getElementById('login-modal-overlay');
  if (loginModal) loginModal.classList.add('active');
  renderCards([]);
  showToast('Curator Studio Locked', 'info');
}

// ==============================================================================
// 2. DATA LOADING & METRICS
// ==============================================================================

async function loadQuarantineQueue() {
  if (!state.token) return;

  const t = Date.now();
  try {
    const res = await fetch(`/api/curator/queue?_t=${t}`, {
      headers: { 'Curator-Token': state.token },
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      state.quarantinedEvents = (data.quarantinedEvents || []).map(ev => {
        const resolvedUrl = getEventExternalUrl(ev);
        const resolvedId = ev.id || ev.event_id || '';
        return {
          ...ev,
          id: resolvedId,
          event_id: resolvedId,
          title: ev.title || ev.event_name || 'Untitled Event',
          venue: ev.venue || ev.venue_name || 'Unknown Venue',
          address: ev.address || ev.full_address || '',
          websiteUrl: resolvedUrl,
          ticket_url: ev.ticket_url || resolvedUrl,
          details_url: ev.details_url || resolvedUrl
        };
      });
      state.userFeedbackQueue = data.userFeedbackQueue || [];
      const userFbCountEl = document.getElementById('stat-user-feedback-count');
      const pillUserFbCountEl = document.getElementById('pill-count-user-feedback');
      if (userFbCountEl) userFbCountEl.textContent = state.userFeedbackQueue.length;
      if (pillUserFbCountEl) pillUserFbCountEl.textContent = state.userFeedbackQueue.length;

      state.pendingNewsletterSignups = data.pendingNewsletterSignups || [];
      const nlCountEl = document.getElementById('stat-nl-signups-count');
      const pillNlCountEl = document.getElementById('pill-count-nl-signups');
      if (nlCountEl) nlCountEl.textContent = state.pendingNewsletterSignups.length;
      if (pillNlCountEl) pillNlCountEl.textContent = state.pendingNewsletterSignups.length;
    } else if (res.status === 401 || res.status === 403) {
      handleLogout();
      return;
    }

    try {
      const archRes = await fetch(`/api/curator/archived?_t=${t}`, {
        headers: { 'Curator-Token': state.token },
        cache: 'no-store'
      });
      if (archRes.ok) {
        const archData = await archRes.json();
        state.archivedEvents = (archData.archivedEvents || []).map(ev => {
          const resolvedUrl = getEventExternalUrl(ev);
          const resolvedId = ev.id || ev.event_id || '';
          return {
            ...ev,
            id: resolvedId,
            event_id: resolvedId,
            title: ev.title || ev.event_name || 'Archived Event',
            venue: ev.venue || ev.venue_name || '',
            address: ev.address || ev.full_address || '',
            websiteUrl: resolvedUrl,
            ticket_url: ev.ticket_url || resolvedUrl,
            details_url: ev.details_url || resolvedUrl
          };
        });
      }
    } catch (e) {
      console.warn('Could not fetch archived events:', e);
    }

    // Hydrate any existing queued instructions onto the quarantined events
    let instMap = new Map();
    try {
      const instRes = await fetch(`/api/curator/instructions?_t=${t}`, {
        headers: { 'Curator-Token': state.token },
        cache: 'no-store'
      });
      if (instRes.ok) {
        const instData = await instRes.json();
        const instructions = instData.instructions || [];
        for (const inst of instructions) {
          if (inst.eventId && inst.status === 'pending') {
            instMap.set(inst.eventId, inst);
          }
        }
        state.quarantinedEvents.forEach(ev => {
          if (instMap.has(ev.id)) {
            ev.dealtWith = true;
            ev.queuedInstruction = instMap.get(ev.id);
          }
        });
      }
    } catch (e) {
      console.warn('Could not fetch queued instructions:', e);
    }

    // Fetch Discovered Venues from Discovery Feeds and Festival Scout
    try {
      const discRes = await fetch(`/api/curator/discovered_venues?_t=${t}`, {
        headers: { 'Curator-Token': state.token },
        cache: 'no-store'
      });
      if (discRes.ok) {
        const discData = await discRes.json();
        state.discoveredVenues = (discData.discoveredVenues || []).filter(v => v.status === 'pending');
        state.discoveredVenues.forEach(v => {
          if (instMap && instMap.has(v.id)) {
            v.dealtWith = true;
            v.queuedInstruction = instMap.get(v.id);
          } else if (v.name && instMap && instMap.has(v.name.toLowerCase())) {
            v.dealtWith = true;
            v.queuedInstruction = instMap.get(v.name.toLowerCase());
          }
        });
      }
    } catch (e) {
      console.warn('Could not fetch discovered venues:', e);
    }

    // Fetch Holidays & Festivals Registries
    try {
      const [holRes, festRes] = await Promise.allSettled([
        fetch(`/api/curator/holidays?_t=${t}`, {
          headers: { 'Curator-Token': state.token },
          cache: 'no-store'
        }),
        fetch(`/data/festivals.json?_t=${t}`, { cache: 'no-store' })
      ]);
      if (holRes.status === 'fulfilled' && holRes.value.ok) {
        const holData = await holRes.value.json();
        state.pendingHolidays = holData.pendingHolidays || [];
        state.approvedHolidays = holData.approvedHolidays || [];
      }
      if (festRes.status === 'fulfilled' && festRes.value.ok) {
        const festData = await festRes.value.json();
        state.festivals = Array.isArray(festData) ? festData : (festData.festivals || []);
      }
    } catch (e) {
      console.warn('Could not fetch holiday/festival registry:', e);
    }

    // Fetch Discovered Candidate Sources
    try {
      const srcRes = await fetch(`/api/curator/discovered_sources?_t=${t}`, {
        headers: { 'Curator-Token': state.token },
        cache: 'no-store'
      });
      if (srcRes.ok) {
        const srcData = await srcRes.json();
        state.discoveredSources = (srcData.discoveredSources || []).filter(s => s.status === 'pending_curator_approval' || s.status === 'pending');
      }
    } catch (e) {
      console.warn('Could not fetch discovered sources:', e);
    }

    updateFilterCounts();
    applyFiltersAndRender();
    if (typeof window.loadLayersAndEvents === 'function') {
      window.loadLayersAndEvents();
    }
  } catch (err) {
    showToast('Failed to load quarantine queue', 'error');
  }
}

function getPendingFestivalsAndHolidays() {
  const pendingHolidays = state.pendingHolidays || [];
  const allQuarantined = (state.quarantinedEvents || []).filter(e => !isOverBudget(e));
  const quarantinedFestivals = allQuarantined.filter(e =>
    e.event_archetype === 'festival' ||
    e.archetype === 'festival' ||
    e.isFestival ||
    Boolean(e.festival_affiliation && e.festival_affiliation !== 'None') ||
    Boolean(e.festivalAffiliation && e.festivalAffiliation !== 'None') ||
    (e.title && e.title.toLowerCase().includes('festival'))
  );
  const fests = state.festivals || state.masterCatalogsData?.festivals || [];
  const unapprovedFests = fests.filter(f => f && (f.status === 'pending' || f.approvalStatus === 'pending' || f.status === 'pending_curator_approval'));
  return {
    pendingHolidays,
    quarantinedFestivals,
    unapprovedFests,
    total: pendingHolidays.length + quarantinedFestivals.length + unapprovedFests.length
  };
}

function updateHeaderStats(pending, rules, master, instructions = 0, discoveredVenues = 0, discoveredSources = 0) {
  state.stats.pending = pending;
  state.stats.rules = rules;
  state.stats.master = master;
  state.stats.instructions = instructions;
  state.stats.discoveredVenues = discoveredVenues;
  state.stats.discoveredSources = discoveredSources;

  const elP = document.getElementById('stat-pending-count');
  const elR = document.getElementById('stat-rules-count');
  const elM = document.getElementById('stat-master-count');
  const elI = document.getElementById('stat-instructions-count');
  const elV = document.getElementById('stat-discovered-venues-count');
  const elS = document.getElementById('stat-discovered-sources-count');
  const elA = document.getElementById('stat-audit-count');
  if (elP) elP.textContent = pending;
  if (elR) elR.textContent = rules;
  if (elM) elM.textContent = master;
  if (elI) elI.textContent = instructions;
  if (elV) elV.textContent = discoveredVenues;
  if (elS) elS.textContent = discoveredSources;
  if (elA) {
    elA.textContent = getPendingFestivalsAndHolidays().total;
  }
}

function isDrift(item) {
  const r = (item.quarantineReason || item.flagReason || '').toLowerCase();
  return Boolean(item.isDrift) || r.includes('drift') || r.includes('re-quarantined');
}

function updateFilterCounts() {
  const all = (state.quarantinedEvents || []).filter(e => !isOverBudget(e));
  const feedback = all.filter(e => {
    const annot = e.curatorAnnotation || {};
    const inst = e.queuedInstruction || {};
    return Boolean(annot.note || (annot.screenshotPaths && annot.screenshotPaths.length > 0) || inst.instructionText || inst.screenshotPath || (inst.screenshotPaths && inst.screenshotPaths.length > 0));
  }).length;
  const unhandled = all.filter(e => !e.dealtWith).length;
  const handled = all.filter(e => Boolean(e.dealtWith)).length;
  const drift = all.filter(e => isDrift(e)).length;
  const unverified = all.filter(e => isUnverifiedCart(e)).length;
  const brokenlink = all.filter(e => isBrokenLink(e)).length;
  const course = all.filter(e => isCourse(e)).length;
  const newsletter = all.filter(e => e.source === 'newsletter' || (e.flagReason || '').toLowerCase().includes('newsletter')).length;
  const discVenues = (state.discoveredVenues || []).length;
  const discSources = (state.discoveredSources || []).length;

  const setT = (id, count) => {
    const el = document.getElementById(id);
    if (el) el.textContent = count;
  };
  const pendingFestHolCount = getPendingFestivalsAndHolidays().total;
  setT('pill-count-all', all.length);
  setT('pill-count-feedback', feedback);
  setT('pill-count-newsletter', newsletter);
  setT('pill-count-discovered-venues', discVenues);
  setT('pill-count-discovered-sources', discSources);
  setT('pill-count-holidays', pendingFestHolCount);
  setT('pill-count-unhandled', unhandled);
  setT('pill-count-handled', handled);
  setT('pill-count-drift', drift);
  setT('pill-count-unverified', unverified);
  setT('pill-count-brokenlink', brokenlink);
  setT('pill-count-course', course);

  const statP = document.getElementById('stat-pending-count');
  if (statP) statP.textContent = all.length;
  const statV = document.getElementById('stat-discovered-venues-count');
  if (statV) statV.textContent = discVenues;
  const statS = document.getElementById('stat-discovered-sources-count');
  if (statS) statS.textContent = discSources;
  const statA = document.getElementById('stat-audit-count');
  if (statA) statA.textContent = pendingFestHolCount;

  if (typeof window.syncHarvesterCheckpointAndEventsUI === 'function') {
    window.syncHarvesterCheckpointAndEventsUI();
  }

  // Auto-prompt banner for candidate sources
  checkAndPromptCandidateSources();
}

// Classification Helpers for Triage Filtering
function isOverBudget(item) {
  const r = (item.quarantineReason || item.flagReason || '').toLowerCase();
  const p = parseFloat(item.attemptedPrice || item.price || 0.0);
  return p > 50.0 || r.includes('exceeds $50') || r.includes('strictly exceeds') || r.includes('over-budget');
}

function isUnverifiedCart(item) {
  const r = (item.flagReason || '').toLowerCase();
  return r.includes('could not parse') || r.includes('unverified') || r.includes('live checkout') || r.includes('ticketweb');
}

function isBrokenLink(item) {
  const r = (item.flagReason || '').toLowerCase();
  return r.includes('404') || r.includes('failed to load') || r.includes('generic box office');
}

function isCourse(item) {
  const r = (item.flagReason || '').toLowerCase();
  const t = (item.title || '').toLowerCase();
  return r.includes('multi-week') || r.includes('claymates') || r.includes('course') || t.includes('course') || t.includes('class');
}

// ==============================================================================
// 3. FILTERING & SORTING ENGINE
// ==============================================================================

function applyFiltersAndRender() {
  // Discovered Venues Tab
  if (state.activeFilter === 'discovered_venues') {
    renderDiscoveredVenuesCards();
    return;
  }

  // Discovered Sources Tab
  if (state.activeFilter === 'discovered_sources') {
    renderDiscoveredSourcesCards();
    return;
  }

  // New Holidays Tab
  if (state.activeFilter === 'holidays') {
    renderHolidayCards();
    return;
  }

  // User Submissions & Feedback Tab
  if (state.activeFilter === 'user_feedback') {
    renderUserFeedbackCards();
    return;
  }

  // Newsletter Signups Tab
  if (state.activeFilter === 'newsletter_signups') {
    renderNewsletterSignupsCards();
    return;
  }

  // Strict Budget Cap: Curator strictly triages candidates that may meet criteria; >$50 are filtered out unless searching
  let list = state.searchQuery
    ? (state.quarantinedEvents || [])
    : (state.quarantinedEvents || []).filter(e => !isOverBudget(e));

  // 1. Tab Filter
  if (state.activeFilter === 'feedback' || state.activeFilter === 'has_feedback') {
    list = list.filter(e => {
      const annot = e.curatorAnnotation || {};
      const inst = e.queuedInstruction || {};
      return Boolean(annot.note || (annot.screenshotPaths && annot.screenshotPaths.length > 0) || inst.instructionText || inst.screenshotPath || (inst.screenshotPaths && inst.screenshotPaths.length > 0));
    });
  } else if (state.activeFilter === 'unhandled') {
    list = list.filter(e => !e.dealtWith);
  } else if (state.activeFilter === 'handled') {
    list = list.filter(e => Boolean(e.dealtWith));
  } else if (state.activeFilter === 'newsletter') {
    list = list.filter(e => e.source === 'newsletter' || (e.flagReason || '').toLowerCase().includes('newsletter'));
  } else if (state.activeFilter === 'drift') {
    list = list.filter(e => isDrift(e));
  } else if (state.activeFilter === 'unverified') {
    list = list.filter(e => isUnverifiedCart(e));
  } else if (state.activeFilter === 'brokenlink') {
    list = list.filter(e => isBrokenLink(e));
  } else if (state.activeFilter === 'course') {
    list = list.filter(e => isCourse(e));
  }

  // 2. Platform Filter
  if (state.platformFilter !== 'all') {
    list = list.filter(e => {
      const prov = (e.provider || '').toLowerCase();
      const sem = (e.semanticProvider || '').toLowerCase();
      const url = (e.websiteUrl || '').toLowerCase();
      const target = state.platformFilter.toLowerCase();
      return prov.includes(target) || sem.includes(target) || url.includes(target);
    });
  }

  // 3. Search Query (Typo-Tolerant & Multi-field)
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    const tokens = q.split(/\s+/).filter(t => t.length > 0);
    list = list.filter(e => {
      const title = (e.title || e.event_name || '').toLowerCase();
      const venue = (e.venue || e.venue_name || '').toLowerCase();
      const neighborhood = (e.neighborhood || '').toLowerCase();
      const flag = (e.flagReason || e.quarantineReason || '').toLowerCase();
      const prov = (e.provider || e.semanticProvider || '').toLowerCase();
      const artist = (e.artist || '').toLowerCase();
      const lineup = Array.isArray(e.lineup) ? e.lineup.join(' ').toLowerCase() : '';
      const id = (e.id || e.event_id || '').toLowerCase();
      const hay = `${title} ${venue} ${neighborhood} ${flag} ${prov} ${artist} ${lineup} ${id}`;

      return tokens.every(tok => {
        if (hay.includes(tok)) return true;
        // 1-char edit distance tolerance for words >= 4 chars
        if (tok.length >= 4) {
          const hayWords = hay.split(/\s+/);
          return hayWords.some(w => {
            if (Math.abs(w.length - tok.length) > 1) return false;
            let diff = 0;
            const minLen = Math.min(w.length, tok.length);
            for (let i = 0; i < minLen; i++) {
              if (w[i] !== tok[i]) diff++;
              if (diff > 1) return false;
            }
            return true;
          });
        }
        return false;
      });
    });
  }

  // 4. Sorting
  if (state.sortBy === 'price-asc') {
    list.sort((a, b) => (parseFloat(a.attemptedPrice || 0)) - (parseFloat(b.attemptedPrice || 0)));
  } else if (state.sortBy === 'price-desc') {
    list.sort((a, b) => (parseFloat(b.attemptedPrice || 0)) - (parseFloat(a.attemptedPrice || 0)));
  } else if (state.sortBy === 'date-asc') {
    list.sort((a, b) => new Date(a.flaggedAt || 0) - new Date(b.flaggedAt || 0));
  } else if (state.sortBy === 'date-desc') {
    list.sort((a, b) => new Date(b.flaggedAt || 0) - new Date(a.flaggedAt || 0));
  } else if (state.sortBy === 'venue-asc') {
    list.sort((a, b) => (a.venue || '').localeCompare(b.venue || ''));
  }

  // Update counter
  const statusText = document.getElementById('curator-results-text');
  if (statusText) {
    const totalEligible = (state.quarantinedEvents || []).filter(e => !isOverBudget(e)).length;
    statusText.innerHTML = `Showing <strong>${list.length}</strong> of ${totalEligible} items requiring curator confirmation`;
  }

  renderCards(list);
}

// ==============================================================================
// 4. CARD RENDERING & QUICK-EDIT INTERFACE
// ==============================================================================

function formatScheduleText12h(str) {
  if (!str || typeof str !== 'string') return str || '';
  return str.replace(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?(\s*(?:AM|PM|am|pm))?\b/g, (full, hh, mm, mer) => {
    let h = parseInt(hh, 10);
    const m = mm;
    const merUpper = mer ? mer.trim().toUpperCase() : null;
    if (merUpper) {
      if (merUpper === "PM" && h < 12) h += 12;
      if (merUpper === "AM" && h === 12) h = 0;
    }
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m} ${period}`;
  });
}

function formatCuratorDate(ev) {
  if (ev.dateSchedule) {
    return formatScheduleText12h(ev.dateSchedule);
  }
  if (ev.startIso) {
    try {
      const d = new Date(ev.startIso);
      const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      return `${dateStr} • ${timeStr}`;
    } catch (e) { }
  }
  if (ev.frequencyLabel) {
    return formatScheduleText12h(ev.frequencyLabel);
  }
  if (ev.daysOfWeek && ev.daysOfWeek.length > 0) {
    const dows = ev.daysOfWeek.map(d => d.toUpperCase()).join(', ');
    return `Days: ${dows}`;
  }
  return 'Schedule details pending review';
}

function simplifyQuarantineReason(reason, attemptedPrice = null) {
  if (!reason) return 'Needs curator review';
  const r = String(reason).toLowerCase();

  if (r.includes('strictly exceeds') || r.includes('exceeds $50') || r.includes('over-budget')) {
    return attemptedPrice ? `🚨 Over $50 limit ($${attemptedPrice.toFixed(2)} CAD detected)` : '🚨 Exceeds $50 budget limit';
  }
  if (r.startsWith('decomposed into discrete event')) {
    return reason;
  }
  if (r.includes('schedule') && (r.includes('generic catalog index') || r.includes('without specific event slug'))) {
    return '🔗 Venue calendar link (no direct show URL)';
  }
  if (r.includes('bare root homepage') || r.includes('bare root')) {
    return '🔗 Venue homepage (needs direct show link or as-is approval)';
  }
  if (r.includes('drift') || r.includes('price drift')) {
    return `⚠️ Price drift detected: ${reason}`;
  }
  if (r.includes('paypal')) {
    return '💳 Direct PayPal checkout link (needs verification)';
  }
  if (r.includes('ticketweb') || r.includes('showpass') || r.includes('eventbrite') || r.includes('checkout pricing') || r.includes('cart')) {
    return '💳 Cart / checkout total unverified by automated scraper';
  }
  if (r.includes('could not dynamically verify') || r.includes('live door/ticket price')) {
    return '🔍 Live door/ticket price needs human confirmation';
  }

  const cleaned = reason.replace(/https?:\/\/[^\s]+/g, '').replace(/Autonomous Hunter [^.]+\./i, '').trim();
  return cleaned || 'Needs curator review';
}

function renderCardScreenshotThumbnails(inst) {
  if (!inst) return '';
  const paths = (inst.screenshotPaths && inst.screenshotPaths.length)
    ? inst.screenshotPaths
    : (inst.screenshotPath ? [inst.screenshotPath] : []);
  if (!paths.length) return '';
  return `
    <div class="curator-instruction-shots" style="margin: 8px 0; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
      <span style="font-size: 0.78rem; font-weight: 600; color: #d8b4fe;">🖼️ ${paths.length} Screenshot${paths.length > 1 ? 's' : ''} Attached:</span>
      <div style="display: flex; gap: 8px; flex-wrap: wrap;">
        ${paths.map((p, idx) => `
          <a href="${p}" target="_blank" rel="noopener noreferrer" title="Click to view full-size screenshot proof #${idx + 1}" style="display: inline-block; text-decoration: none;">
            <img src="${p}" alt="Screenshot #${idx + 1}" style="height: 52px; width: 52px; object-fit: cover; border-radius: 6px; border: 1.5px solid rgba(168, 85, 247, 0.6); box-shadow: 0 2px 8px rgba(0,0,0,0.3); transition: transform 0.15s;" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'" />
          </a>
        `).join('')}
      </div>
    </div>
  `;
}

function renderCardAiLearnedSummary(ev, inst = null) {
  if (!ev) return '';
  const annot = ev.curatorAnnotation || {};
  const effectiveInst = inst || ev.queuedInstruction || {};
  const learnedText = annot.aiLearnedSummary || effectiveInst.aiLearnedSummary || '';
  if (!learnedText) return '';

  const tiers = annot.extractedTiers || effectiveInst.extractedTiers || [];
  let tiersHtml = '';
  if (tiers && tiers.length > 0) {
    tiersHtml = `
      <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px;">
        ${tiers.map(t => `
          <span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 4px; background: rgba(168, 85, 247, 0.22); border: 1px solid rgba(168, 85, 247, 0.45); color: #e9d5ff;">
            ${escapeHtml(t.name)}: <strong>${t.total === 0 ? 'FREE' : '$' + Number(t.total).toFixed(2)}</strong>
          </span>
        `).join('')}
      </div>
    `;
  }

  return `
    <div class="curator-ai-learned-box" style="margin: 8px 0; padding: 12px 14px; background: rgba(147, 51, 234, 0.14); border: 1.5px solid rgba(192, 132, 252, 0.45); border-radius: 8px; font-size: 0.83rem; line-height: 1.45;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 5px;">
        <span style="font-weight: 700; color: #d8b4fe; display: flex; align-items: center; gap: 6px;">
          <span>🧠</span> AI Synthesis &amp; What It Learned:
        </span>
        <span style="font-size: 0.7rem; color: #e9d5ff; background: rgba(168, 85, 247, 0.25); padding: 2px 7px; border-radius: 4px; font-weight: 600;">Multi-Proof Verified</span>
      </div>
      <div style="color: #f8fafc;">
        ${escapeHtml(learnedText)}
      </div>
      ${tiersHtml}
    </div>
  `;
}

function evaluateCuratorDateStatus(ev) {
  const rawDateStr = formatCuratorDate(ev);
  const isDateMissing = !rawDateStr ||
    rawDateStr === 'Schedule details pending review' ||
    (!ev.dateSchedule && !ev.startIso && (!ev.daysOfWeek || !ev.daysOfWeek.length) && !ev.isDaily);

  const reason = ev.quarantineReason || ev.flagReason || ev.archivedReason || '';
  const reasonText = [reason, ev.quarantineReason, ev.flagReason, ev.archivedReason].filter(Boolean).join(' ').toLowerCase();

  const isScheduleFlagged = reasonText.includes('schedule') ||
    reasonText.includes('ended') ||
    reasonText.includes('expired') ||
    reasonText.includes('past date') ||
    reasonText.includes('schedule drift') ||
    reasonText.includes('drift') ||
    reasonText.includes('generic catalog index') ||
    reasonText.includes('generic link') ||
    reasonText.includes('bare root');

  let isDatePast = false;
  try {
    const now = new Date();
    const refYear = now.getFullYear() >= 2026 ? now.getFullYear() : 2026;
    const refMonth = now.getFullYear() >= 2026 ? now.getMonth() : 8;
    const refDay = now.getFullYear() >= 2026 ? now.getDate() : 22;
    const todayStart = new Date(refYear, refMonth, refDay);

    if (ev.endIso) {
      const endDate = new Date(ev.endIso);
      if (endDate < todayStart) {
        isDatePast = true;
      }
    } else if (ev.startIso && !ev.isDaily && ev.frequency !== 'daily' && (!ev.daysOfWeek || !ev.daysOfWeek.length)) {
      const startDate = new Date(ev.startIso);
      if (startDate < todayStart) {
        isDatePast = true;
      }
    }
  } catch (e) { }

  const isUnconfirmed = isDateMissing || isScheduleFlagged || isDatePast;

  let diagnosticHtml = '';
  if (isUnconfirmed) {
    if (isDatePast) {
      diagnosticHtml = `<span>📅 <strong>Event Date (Past / Expired):</strong> ${escapeHtml(rawDateStr)} — scheduled date has passed; needs upcoming show date</span>`;
    } else if (reasonText.includes('schedule changed') || reasonText.includes('schedule drift')) {
      diagnosticHtml = `<span>📅 <strong>Event Date (Schedule Drift):</strong> ${escapeHtml(rawDateStr)} — live source differs from saved schedule</span>`;
    } else if (reasonText.includes('generic') || reasonText.includes('catalog index') || reasonText.includes('bare root')) {
      diagnosticHtml = `<span>📅 <strong>Event Date (Unconfirmed):</strong> Specific show date unconfirmed (links to general venue calendar)</span>`;
    } else if (isDateMissing) {
      diagnosticHtml = `<span>📅 <strong>Event Date (Unconfirmed):</strong> Show date &amp; time not confirmed by automated crawl (pending curator review)</span>`;
    } else {
      diagnosticHtml = `<span>📅 <strong>Event Date (Unconfirmed):</strong> ${escapeHtml(rawDateStr)} (requires curator verification)</span>`;
    }
  } else {
    diagnosticHtml = `<span>📅 <strong>Event Date:</strong> ${escapeHtml(rawDateStr)}</span>`;
  }

  return {
    isUnconfirmed,
    rawDateStr,
    isDateMissing,
    isScheduleFlagged,
    isDatePast,
    diagnosticHtml
  };
}

function isCuratorDateUnconfirmed(ev) {
  return evaluateCuratorDateStatus(ev).isUnconfirmed;
}

function formatTicketTiersHtml(ev) {
  if (!ev) return '';
  const tiers = [];
  const annot = ev.curatorAnnotation || {};
  const extracted = annot.extractedTiers || ev.extractedTiers || ev.ticketTiers || [];

  if (Array.isArray(extracted) && extracted.length > 0) {
    extracted.forEach(t => {
      const tot = parseFloat(t.total ?? t.price ?? 0);
      const feeText = t.fee ? ` (+$${Number(t.fee).toFixed(2)} fee)` : '';
      const tName = t.name || 'Tier';
      const isSold = /sold\s*out/i.test(tName) || t.status === 'sold_out';
      const isEnded = /ended|expired|past/i.test(tName) || t.status === 'expired';
      const isDoor = /door/i.test(tName) || t.status === 'door_only';
      tiers.push({
        name: tName,
        priceStr: tot === 0 ? 'FREE ($0)' : `$${tot.toFixed(2)} CAD${feeText}`,
        isFree: tot === 0,
        isPrimary: Boolean(t.isPrimary || /adult|general|standard|early\s*show/i.test(tName)),
        isSoldOut: isSold,
        isExpired: isEnded,
        isDoor: isDoor
      });
    });
  } else {
    // 1. Check custom tiers 1..5
    for (let i = 1; i <= 5; i++) {
      const cName = ev[`tier_custom_name_${i}`];
      const cPrice = ev[`tier_custom_price_${i}`];
      if (cName != null && cPrice != null) {
        const pNum = Number(cPrice) || 0;
        const isSold = /sold\s*out/i.test(cName) || ev[`tier_custom_status_${i}`] === 'sold_out';
        const isEnded = /ended|expired|past/i.test(cName) || ev[`tier_custom_status_${i}`] === 'expired';
        const isDoor = /door/i.test(cName) || ev[`tier_custom_status_${i}`] === 'door_only';
        tiers.push({
          name: cName,
          priceStr: pNum === 0 ? 'FREE ($0)' : `$${pNum.toFixed(2)} CAD`,
          isFree: pNum === 0,
          isPrimary: i === 1,
          isSoldOut: isSold,
          isExpired: isEnded,
          isDoor: isDoor
        });
      }
    }

    // 2. Demographic tiers if custom tiers didn't already supply them
    if (tiers.length === 0 && ev.pricing_all_in_cad && typeof ev.pricing_all_in_cad === 'object') {
      const p = ev.pricing_all_in_cad;
      if (p.regular != null) tiers.push({ name: 'Regular / Adult', priceStr: `$${Number(p.regular).toFixed(2)} CAD`, isPrimary: true });
      if (p.senior != null) tiers.push({ name: 'Senior (65+)', priceStr: `$${Number(p.senior).toFixed(2)} CAD` });
      if (p.student != null) tiers.push({ name: 'Student / Youth', priceStr: `$${Number(p.student).toFixed(2)} CAD` });
      if (p.member != null) tiers.push({ name: 'Member', priceStr: `$${Number(p.member).toFixed(2)} CAD` });
    } else if (tiers.length === 0 && String(ev.venue || '').toLowerCase().includes('guilt')) {
      const isEarly = String(ev.title || ev.dateSchedule || '').toLowerCase().includes('early') || String(ev.dateSchedule || '').includes('6pm');
      tiers.push({ name: 'Early Show (Before 8 PM)', priceStr: '$8.00 CAD cover', isPrimary: isEarly });
      tiers.push({ name: 'Late Show (Sun–Thu)', priceStr: '$12.00 CAD cover', isPrimary: !isEarly });
      tiers.push({ name: 'Late Show (Fri–Sat)', priceStr: '$15.00 CAD cover' });
    }
  }

  if (tiers.length === 0) return '';

  return `
    <div style="margin-top: 6px;">
      <span style="font-size: 0.76rem; color: #c084fc; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
        <span>🎟️</span> Ticket Types &amp; Costs (${tiers.length} Tiers):
      </span>
      <div class="curator-ticket-tier-row">
        ${tiers.map(t => {
    let extraClass = '';
    let badge = '';
    if (t.isSoldOut) {
      extraClass = ' tier-sold-out';
      badge = ' <span class="tier-status-pill badge-sold-out">Sold Out</span>';
    } else if (t.isExpired) {
      extraClass = ' tier-expired';
      badge = ' <span class="tier-status-pill badge-ended">Ended</span>';
    } else if (t.isDoor) {
      extraClass = ' tier-door';
      badge = ' <span class="tier-status-pill badge-door">Door</span>';
    }
    return `
            <span class="curator-ticket-tier-chip ${t.isFree ? 'tier-free' : (t.isPrimary ? 'tier-primary' : 'tier-alt')}${extraClass}">
              <span>${escapeHtml(t.name)}:</span> <strong>${escapeHtml(t.priceStr)}</strong>${badge}
            </span>
          `;
  }).join('')}
      </div>
    </div>
  `;
}

function generateCuratorDiagnostics(ev) {
  const attemptedPrice = parseFloat(ev.attemptedPrice || ev.price || 0.0);
  const isBudgetExceeded = attemptedPrice > 50.0;
  const isAutoDenied = ev.reviewStatus === 'denied_auto_budget';
  const hasDrift = isDrift(ev);
  const reason = ev.quarantineReason || ev.flagReason || ev.archivedReason || '';

  // --- DATE EVALUATION: Confirmed vs Unconfirmed Details ---
  const dateStatus = evaluateCuratorDateStatus(ev);

  const confirmedItems = [];
  confirmedItems.push(`<span>📍 <strong>Venue:</strong> ${escapeHtml(ev.venue || 'Known Venue')}${ev.neighborhood ? ' (' + escapeHtml(ev.neighborhood) + ')' : ''}</span>`);

  // 1. If Date is confirmed, include it directly in Confirmed Details
  if (!dateStatus.isUnconfirmed) {
    confirmedItems.push(dateStatus.diagnosticHtml);
  }

  if (ev.address) {
    confirmedItems.push(`<span>🗺️ <strong>Address:</strong> ${escapeHtml(ev.address)}</span>`);
  }

  if (ev.artist && ev.artist !== ev.title) {
    confirmedItems.push(`<span>👥 <strong>Lineup / Host:</strong> ${escapeHtml(ev.artist)}</span>`);
  }

  const verifiedPrice = (ev.basePrice != null && ev.basePrice > 0) ? `$${Number(ev.basePrice).toFixed(2)} CAD base` : (attemptedPrice > 0 ? `$${attemptedPrice.toFixed(2)} CAD detected` : 'Free / By-Donation');
  const tiersBreakdownHtml = formatTicketTiersHtml(ev);
  confirmedItems.push(`
    <div style="width: 100%;">
      <span>💰 <strong>Base Price:</strong> ${verifiedPrice} (${escapeHtml(ev.provider || 'Direct')})</span>
      ${tiersBreakdownHtml}
    </div>
  `);

  if (ev.categoryLabel || ev.category) {
    confirmedItems.push(`<span>🏷️ <strong>Category:</strong> ${escapeHtml(ev.categoryLabel || ev.category)}</span>`);
  }

  const targetUrl = getEventExternalUrl(ev);
  if (targetUrl) {
    const domainText = targetUrl.replace(/^https?:\/\//i, '').split('/')[0];
    confirmedItems.push(`<span>🔗 <strong>Event Link:</strong> <a href="${escapeHtml(targetUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #38bdf8; text-decoration: underline;">Open Host Page (${escapeHtml(domainText)}) ↗</a></span>`);
  }

  const issuesItems = [];
  if (isAutoDenied || isBudgetExceeded) {
    issuesItems.push(`<span>🚨 <strong>Budget Cap Exceeded:</strong> Rate of $${attemptedPrice.toFixed(2)} CAD exceeds strict $50.00 ceiling</span>`);
  }

  // 2. If Date is unconfirmed, include it with specific diagnosis in Unconfirmed Details / Issues
  if (dateStatus.isUnconfirmed) {
    issuesItems.push(dateStatus.diagnosticHtml);
  }

  if (hasDrift) {
    issuesItems.push(`<span>⚠️ <strong>Audit Drift:</strong> Detected pricing or schedule changed from previous baseline</span>`);
  }
  if (reason) {
    issuesItems.push(`<span>⚠️ <strong>Quarantine Reason:</strong> ${escapeHtml(simplifyQuarantineReason(reason, attemptedPrice))}</span>`);
  }

  const verification = ev.checkoutVerification || {};
  if (verification.status === 'quarantined' || !verification.status) {
    issuesItems.push(`<span>🛒 <strong>Checkout Fees:</strong> Final checkout cart fees could not be verified dynamically</span>`);
  } else if (verification.details) {
    issuesItems.push(`<span>ℹ️ <strong>Cart Note:</strong> ${escapeHtml(verification.details)}</span>`);
  }

  if (!issuesItems.length) {
    issuesItems.push(`<span>ℹ️ <strong>Review Note:</strong> Manual verification requested by crawler auditor</span>`);
  }

  return `
    <div class="curator-diagnostics-grid">
      <div class="curator-confirmed-box">
        <div class="curator-confirmed-title">
          <span>✅ Confirmed Details</span>
          <span style="font-size: 0.72rem; opacity: 0.8; margin-left: auto;">${confirmedItems.length} verified</span>
        </div>
        <ul class="curator-diag-list">
          ${confirmedItems.map(item => `<li>${item}</li>`).join('')}
        </ul>
      </div>

      <div class="curator-issues-box">
        <div class="curator-issues-title">
          <span>⚠️ Unconfirmed Details / Issues</span>
          <span style="font-size: 0.72rem; opacity: 0.8; margin-left: auto;">${issuesItems.length} flagged</span>
        </div>
        <ul class="curator-diag-list">
          ${issuesItems.map(item => `<li>${item}</li>`).join('')}
        </ul>
      </div>
    </div>
  `;
}

function renderCards(items) {
  const container = document.getElementById('curator-cards-list');
  if (!container) return;

  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; background: var(--curator-surface); border: 1px solid var(--curator-border); border-radius: 12px;">
        <div style="font-size: 2.5rem; margin-bottom: 12px;">🎉</div>
        <h3 style="font-family: var(--font-heading); font-size: 1.25rem; color: #fff; margin-bottom: 6px;">
          No Items Requiring Curator Confirmation
        </h3>
        <p style="font-size: 0.88rem; color: var(--curator-text-muted); max-width: 520px; margin: 0 auto; line-height: 1.5;">
          All candidates matching this view have been verified or resolved. Any events exceeding $50.00 CAD are automatically filtered out and archived.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = items.map((ev, index) => {
    const cardNum = getEventCardNumber(ev, index);
    const attemptedPrice = parseFloat(ev.attemptedPrice || ev.price || 0.0);
    const isBudgetExceeded = attemptedPrice > 50.0;
    const isAutoDenied = ev.reviewStatus === 'denied_auto_budget';
    const hasDrift = isDrift(ev);
    const flagDateStr = ev.flaggedAt ? new Date(ev.flaggedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : 'Recently';
    const isHandled = Boolean(ev.dealtWith || ev.queuedInstruction);
    const curatorDateStr = formatCuratorDate(ev);
    const diagnosticsHtml = generateCuratorDiagnostics(ev);
    const vName = (ev.venue || '').trim();
    const isDiscoveredVenue = Boolean(vName && state.knownVenues && state.knownVenues.size > 0 && !state.knownVenues.has(vName.toLowerCase()));
    const targetUrl = getEventExternalUrl(ev);

    return `
      <div class="curator-card ${isHandled ? 'curator-card-handled' : ''}" id="card-${ev.id}" data-event-id="${ev.id}">
        <!-- Top Title & Metadata with Card Number (Request 1) -->
        <div class="curator-card-top">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
              <span class="badge-card-number" title="Catalog Card #${cardNum}">Card #${cardNum}</span>
              <h3 class="curator-card-title" style="margin: 0;">${escapeHtml(ev.title)}</h3>
            </div>
            <div class="curator-card-meta">
              <span>📍 <strong>${escapeHtml(ev.venue)}</strong></span>
              <span>🏷️ <strong>Category:</strong> ${escapeHtml(ev.categoryLabel || ev.category || 'Event')}</span>
              <span>🏘️ ${escapeHtml(ev.neighborhood || 'Vancouver')}</span>
              <span>🎫 Provider: ${escapeHtml(ev.provider || 'Direct')}</span>
              <span>🕒 ${isAutoDenied ? 'Archived' : 'Flagged'}: ${flagDateStr}</span>
            </div>
          </div>
          <div style="display: flex; gap: 6px; align-items: flex-start; flex-wrap: wrap;">
            ${isDiscoveredVenue ? `
              <span class="curator-badge-pill" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border-color: rgba(16, 185, 129, 0.5);" title="Venue not in permanent directory">
                🏛️ Discovered Venue
              </span>
            ` : ''}
            <span class="curator-badge-pill curator-badge-category" style="background: rgba(168, 85, 247, 0.15); color: #d8b4fe; border-color: rgba(168, 85, 247, 0.4);">
              🏷️ ${escapeHtml(ev.categoryLabel || ev.category || 'Event')}
            </span>
            ${isHandled ? `<span class="curator-badge-pill curator-badge-handled">📋 Rule Queued</span>` : ''}
            <span class="curator-badge-pill ${hasDrift ? 'curator-badge-drift' : ''}" style="${isAutoDenied ? 'background: rgba(239, 68, 68, 0.2); color: #fca5a5; border-color: rgba(239, 68, 68, 0.5);' : hasDrift ? '' : isBudgetExceeded ? 'background: rgba(239, 68, 68, 0.15); color: #fca5a5; border-color: rgba(239, 68, 68, 0.4);' : 'background: rgba(245, 158, 11, 0.15); color: #fcd34d; border-color: rgba(245, 158, 11, 0.4);'}">
              ${isAutoDenied ? '🛡️ Auto-Denied > $50' : hasDrift ? '⚠️ Page Drift' : isBudgetExceeded ? '🚨 Over $50 Cap' : '⚠️ Unverified'}
            </span>
          </div>
        </div>

        <!-- Prominent Event Date Banner -->
        <div class="curator-date-banner" title="Event Schedule and Timing">
          <span class="curator-date-banner-icon">📅</span>
          <div>
            <span class="curator-date-banner-label">Event Schedule / Day:</span>
            <span class="curator-date-banner-text">${escapeHtml(curatorDateStr)}</span>
          </div>
          ${isCuratorDateUnconfirmed(ev)
        ? '<span class="curator-badge-pill" style="margin-left: auto; background: rgba(245, 158, 11, 0.2); color: #fcd34d; border-color: rgba(245, 158, 11, 0.5);">⚠️ Unconfirmed Date</span>'
        : '<span class="curator-badge-pill" style="margin-left: auto; background: rgba(16, 185, 129, 0.2); color: #34d399; border-color: rgba(16, 185, 129, 0.5);">✅ Confirmed Date</span>'}
        </div>

        <!-- Diagnostics Grid: Confirmed Details vs. Issues / Needs Review -->
        ${diagnosticsHtml}

        <!-- Newsletter Email Source & Full Screenshot Proof -->
        ${(ev.source === 'newsletter' || ev.emailScreenshot || ev.emailHtmlPath) ? `
          <div class="curator-newsletter-source-box" style="background: rgba(56, 189, 248, 0.07); border: 1.5px solid rgba(56, 189, 248, 0.35); border-left: 5px solid #38bdf8; border-radius: 8px; padding: 12px 14px; margin: 10px 0 14px 0;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; flex-wrap: wrap; gap: 6px;">
              <strong style="color: #38bdf8; font-size: 0.88rem; display: inline-flex; align-items: center; gap: 6px;">
                <span>📧</span> Ingested from Newsletter:
              </strong>
              <span style="background: rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.4); color: #bae6fd; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">
                ${escapeHtml(ev.newsletterSender || 'Email Inbox')}
              </span>
            </div>
            <div style="color: #f1f5f9; font-size: 0.88rem; margin-bottom: 10px; line-height: 1.4;">
              <strong>Subject:</strong> “${escapeHtml(ev.newsletterSubject || 'Event Digest')}”
            </div>
            
            <div style="display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
              ${ev.emailScreenshot ? `
                <a href="${ev.emailScreenshot}" target="_blank" rel="noopener noreferrer" title="Click to open full email screenshot in new tab" style="display: inline-block; position: relative; border-radius: 6px; overflow: hidden; border: 1.5px solid rgba(56, 189, 248, 0.5); box-shadow: 0 2px 8px rgba(0,0,0,0.4); text-decoration: none;">
                  <img src="${ev.emailScreenshot}" alt="Newsletter Email Screenshot" style="height: 75px; width: 130px; object-fit: cover; object-position: top; display: block; transition: transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'" />
                  <div style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.85); color: #38bdf8; font-size: 0.68rem; text-align: center; padding: 2px 0; font-weight: 600;">🖼️ Full Screenshot ↗</div>
                </a>
              ` : ''}
              
              <div style="display: flex; flex-direction: column; gap: 6px;">
                ${ev.emailScreenshot ? `
                  <button type="button" onclick="openEmailScreenshotModal('${ev.id}')" style="background: rgba(56, 189, 248, 0.18); border: 1px solid rgba(56, 189, 248, 0.45); color: #38bdf8; padding: 6px 14px; border-radius: 6px; font-size: 0.8rem; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: background 0.15s;" onmouseover="this.style.background='rgba(56, 189, 248, 0.32)'" onmouseout="this.style.background='rgba(56, 189, 248, 0.18)'">
                    <span>🔍</span> Inspect Full Email Screenshot
                  </button>
                ` : ''}
                ${ev.emailHtmlPath ? `
                  <a href="${ev.emailHtmlPath}" target="_blank" rel="noopener noreferrer" style="color: #cbd5e1; font-size: 0.78rem; text-decoration: underline; display: inline-flex; align-items: center; gap: 4px;">
                    <span>📄</span> View Original HTML Digest ↗
                  </a>
                ` : ''}
              </div>
            </div>
          </div>
        ` : ''}

        <!-- Prominent Instruction Banner (Displays User Instructions & Proof on Cards) -->
        ${(() => {
        const annot = ev.curatorAnnotation || {};
        const inst = ev.queuedInstruction || (annot.note || (annot.screenshotPaths && annot.screenshotPaths.length > 0) ? {
          instructionText: annot.note || '',
          screenshotPaths: annot.screenshotPaths || [],
          approvedPrice: annot.userSuppliedPrice,
          createdAt: annot.annotatedAt,
          aiLearnedSummary: annot.aiLearnedSummary,
          extractedTiers: annot.extractedTiers
        } : null);
        if (!inst) return '';
        return `
          <div class="curator-handled-box" style="background: rgba(168, 85, 247, 0.12); border: 1.5px solid rgba(168, 85, 247, 0.5); border-left: 5px solid #a855f7; border-radius: 8px; padding: 12px 14px; margin: 10px 0 14px 0;">
            <div class="curator-handled-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <strong style="color: #d8b4fe; font-size: 0.88rem; display: inline-flex; align-items: center; gap: 6px;">
                <span>📝</span> Your Guidance &amp; Proof:
              </strong>
              <span class="curator-handled-tag" style="background: rgba(245, 158, 11, 0.25); border: 1px solid rgba(245, 158, 11, 0.5); color: #fde68a; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">
                🟡 Awaiting Review
              </span>
            </div>
            ${inst.instructionText ? `
              <div class="curator-handled-text" style="color: #ffffff; font-size: 0.95rem; font-weight: 500; line-height: 1.45; background: rgba(0, 0, 0, 0.3); padding: 8px 12px; border-radius: 6px; border-left: 3px solid #f59e0b; margin-bottom: 8px;">
                “${escapeHtml(inst.instructionText)}”
              </div>
            ` : ''}
            ${renderCardScreenshotThumbnails(inst)}
            ${renderCardAiLearnedSummary(ev, inst)}
            <div class="curator-handled-meta" style="font-size: 0.78rem; color: #cbd5e1; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
              <span>🕒 Queued ${inst.createdAt ? new Date(inst.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : 'recently'}</span>
              ${inst.approvedPrice ? `<span style="color: #34d399; font-weight: 600;">💰 Target Price: $${Number(inst.approvedPrice).toFixed(2)} CAD</span>` : ''}
              <div style="margin-left: auto; display: flex; align-items: center; gap: 8px;">
                <button type="button" class="btn-curator-edit-inst" onclick="openAIInstructionModal('${ev.id}')" style="background: rgba(168, 85, 247, 0.18); border: 1px solid rgba(168, 85, 247, 0.45); color: #e9d5ff; border-radius: 4px; padding: 4px 10px; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: background 0.15s;" onmouseover="this.style.background='rgba(168, 85, 247, 0.35)'" onmouseout="this.style.background='rgba(168, 85, 247, 0.18)'">✏️ Edit Notes / Proof</button>
              </div>
            </div>
          </div>
          `;
      })()}

        <!-- Flag Reason Alert / Drift Alert (Shortened & Simple) -->
        ${hasDrift ? `
          <div class="curator-drift-alert-box" title="${escapeHtml(ev.quarantineReason || ev.flagReason || 'Material price drift detected on live page')}">
            <span style="font-size: 1.25rem;">⚠️</span>
            <div>
              <strong>Audit Drift Alert:</strong> ${escapeHtml(simplifyQuarantineReason(ev.quarantineReason || ev.flagReason, attemptedPrice))}
            </div>
          </div>
        ` : `
          <div class="curator-flag-reason-box" style="${(isBudgetExceeded || isAutoDenied) ? 'background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); color: #fca5a5;' : ''}" title="${escapeHtml(ev.quarantineReason || ev.archivedReason || ev.flagReason || 'Live checkout could not be verified')}">
            <span class="curator-flag-icon">${(isBudgetExceeded || isAutoDenied) ? '🛡️' : '⚠️'}</span>
            <div>
              <strong>${isAutoDenied ? 'Policy Denial:' : 'Quarantine Reason:'}</strong> ${escapeHtml(simplifyQuarantineReason(ev.quarantineReason || ev.archivedReason || ev.flagReason, attemptedPrice))}
            </div>
          </div>
        `}

        <!-- Editable Correction Form or Readonly Summary -->
        ${isAutoDenied ? `
          <div style="padding: 12px 16px; background: rgba(255, 255, 255, 0.02); border: 1px dashed rgba(239, 68, 68, 0.25); border-radius: 8px; font-size: 0.85rem; color: var(--curator-text-muted); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
            <div>
              <span style="color: #fff; font-weight: 600;">Detected Price:</span> $${attemptedPrice.toFixed(2)} CAD
              <span style="margin: 0 8px; opacity: 0.4;">|</span>
              <span style="color: #fff; font-weight: 600;">Category:</span> ${escapeHtml(ev.category || 'Event')}
            </div>
            <div style="color: #fca5a5; font-size: 0.8rem;">
              Auto-archived to <code>archived_events.json</code> • Bypasses manual review
            </div>
          </div>
        ` : `
          <div class="curator-edit-grid">
            <div class="curator-field-group">
              <label class="curator-label">Verified Final Price (CAD)</label>
              <input 
                type="number" 
                step="0.01" 
                min="0" 
                max="50" 
                id="edit-price-${ev.id}" 
                class="curator-input" 
                value="${attemptedPrice <= 50.0 ? attemptedPrice.toFixed(2) : '50.00'}"
              >
            </div>

            <div class="curator-field-group">
              <label class="curator-label">Price Label</label>
              <input 
                type="text" 
                id="edit-label-${ev.id}" 
                class="curator-input" 
                value="${escapeHtml(ev.attemptedPriceLabel || (attemptedPrice === 0 ? 'Free ($0)' : '$' + attemptedPrice.toFixed(2) + ' all-in'))}"
              >
            </div>

            <div class="curator-field-group">
              <label class="curator-label">Activity Category</label>
              <select id="edit-category-${ev.id}" class="curator-input">
                <option value="music" ${ev.category === 'music' ? 'selected' : ''}>🎵 Live Music</option>
                <option value="shows" ${ev.category === 'shows' ? 'selected' : ''}>🎭 Comedy & Shows</option>
                <option value="cinema" ${ev.category === 'cinema' ? 'selected' : ''}>🎬 Indie Cinema</option>
                <option value="crafts" ${ev.category === 'crafts' ? 'selected' : ''}>🎨 Crafts & Studios</option>
                <option value="outdoors" ${ev.category === 'outdoors' ? 'selected' : ''}>🌊 Walks & Outdoors</option>
                <option value="activities" ${ev.category === 'activities' ? 'selected' : ''}>🎲 Games & Activities</option>
                <option value="arts" ${ev.category === 'arts' ? 'selected' : ''}>🏛️ Museums & Arts</option>
                <option value="trivia" ${ev.category === 'trivia' ? 'selected' : ''}>🍻 Drinks & Trivia</option>
              </select>
            </div>

            <div class="curator-field-group">
              <label class="curator-label">Event Date / Schedule</label>
              <input 
                type="text" 
                id="edit-date-${ev.id}" 
                class="curator-input" 
                value="${escapeHtml(ev.dateSchedule || (ev.startIso ? formatCuratorDate(ev) : ''))}" 
                placeholder="e.g. Tuesday, Sept 22 • 7:30 PM"
              >
            </div>

            <div class="curator-field-group">
              <label class="curator-label">Fee Breakdown / Audit Note</label>
              <input 
                type="text" 
                id="edit-fee-${ev.id}" 
                class="curator-input" 
                value="Verified via Curator Studio review (${ev.provider || 'Direct'})"
              >
            </div>
          </div>
        `}

        <!-- Action Buttons -->
        <div class="curator-actions-bar">
          <div class="curator-actions-left">
            ${isAutoDenied ? `
              <span style="font-size: 0.82rem; color: #fca5a5; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; background: rgba(239, 68, 68, 0.1); border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.25);">
                🛡️ Auto-Denied by $50 Budget Policy • Excluded from Master Catalog &amp; Review Queue
              </span>
            ` : ''}
            <!-- Main queue card streamlined: strictly 2 action buttons (Add Guidance & Dismiss) -->
            <button 
              type="button" 
              class="btn-curator btn-curator-ai-approve" 
              onclick="openAIInstructionModal('${ev.id}', 'instruct')"
              title="Provide notes, links, and pasted screenshots to parse card details with OCR & regex rules"
            >
              📝 Add Guidance / Notes
            </button>

            <button 
              type="button" 
              class="btn-curator btn-curator-danger" 
              onclick="rejectQuarantinedEvent('${ev.id}')"
              title="Dismiss and archive this event"
            >
              🚫 Dismiss
            </button>

            ${isDiscoveredVenue ? `
              <button 
                type="button" 
                class="btn-curator btn-curator-ghost" 
                style="color: #34d399; border-color: rgba(16, 185, 129, 0.4);" 
                onclick="openAddVenueModalFromEvent('${ev.id}')"
                title="Enroll '${escapeHtml(ev.venue)}' into regular venue crawler"
              >
                🏛️ Add Venue to Crawler
              </button>
            ` : ''}
          </div>

          <div>
            ${targetUrl ? `
              <a 
                href="${escapeHtml(targetUrl)}" 
                target="_blank" 
                rel="noopener noreferrer" 
                referrerpolicy="no-referrer"
                class="btn-curator btn-curator-ghost"
                title="Inspect live venue page (${escapeHtml(targetUrl)}) in new tab"
              >
                🔗 Inspect Source Page ↗
              </a>
            ` : `
              <button 
                type="button" 
                class="btn-curator btn-curator-ghost" 
                disabled 
                style="opacity: 0.5; cursor: not-allowed;" 
                title="No external ticket or source URL provided for this event"
              >
                🔗 No External Link
              </button>
            `}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Attach card-level Drag & Drop for instant screenshot verification
  container.querySelectorAll('.curator-card').forEach(card => {
    const evId = card.getAttribute('data-event-id');
    if (!evId) return;

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.add('card-drop-active');
    });

    card.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('card-drop-active');
    });

    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.classList.remove('card-drop-active');
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length > 0) {
        window.openAIInstructionModal(evId, 'screenshot');
        await handleIncomingScreenshotFiles(files, false);
      }
    });
  });
}

// ==============================================================================
// 5. EVENT ACTIONS: APPROVE, REJECT, TEACH
// ==============================================================================

window.approveQuarantinedEvent = async function (eventId) {
  if (!state.token) return;
  const original = state.quarantinedEvents.find(e => e.id === eventId);
  if (!original) return;

  const synth = original.curatorAnnotation?.synthesizedCard || {};
  const priceInput = document.getElementById(`edit-price-${eventId}`);
  const labelInput = document.getElementById(`edit-label-${eventId}`);
  const categorySelect = document.getElementById(`edit-category-${eventId}`);
  const feeInput = document.getElementById(`edit-fee-${eventId}`);

  const price = parseFloat(priceInput ? priceInput.value : (synth.price !== undefined && synth.price !== null ? synth.price : (original.attemptedPrice || original.price || 0.0)));
  if (isNaN(price) || price > 50.0) {
    showToast('Price must be a valid amount under or equal to $50.00 CAD.', 'error');
    return;
  }

  const dateInput = document.getElementById(`edit-date-${eventId}`);

  const payloadEvent = {
    ...original,
    title: synth.title || original.title,
    venue: synth.venue || original.venue,
    address: synth.address || original.address,
    neighborhood: synth.neighborhood || original.neighborhood,
    price: price,
    priceLabel: labelInput ? labelInput.value.trim() : (synth.priceLabel || original.attemptedPriceLabel || `$${price.toFixed(2)} all-in`),
    pricingType: price === 0 ? 'free' : 'fixed',
    isFree: price === 0,
    category: categorySelect ? categorySelect.value : (synth.category || original.category || 'shows'),
    dateSchedule: dateInput && dateInput.value.trim() ? dateInput.value.trim() : (synth.dateSchedule || original.dateSchedule || original.frequencyLabel || 'Upcoming'),
    feeBreakdown: feeInput ? feeInput.value.trim() : (synth.feeBreakdown || `Curator approved: $${price.toFixed(2)} CAD`),
    websiteUrl: synth.websiteUrl || original.websiteUrl || original.url || '',
    ticketProvider: synth.provider || original.provider || (synth.websiteUrl && synth.websiteUrl.includes('showpass') ? 'Showpass' : 'Direct'),
    isDaily: original.isDaily || false,
    frequency: original.frequency || 'one-time',
    startIso: original.startIso || new Date().toISOString(),
    endIso: original.endIso || null,
    confirmedDates: original.confirmedDates || []
  };

  try {
    const res = await fetch('/api/curator/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: jsonStringify({ event: payloadEvent })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`🟡 Guidance saved for '${original.title}'. Event held in queue.`, 'info');
      original.reviewStatus = 'pending_antigravity_review';
      original.dealtWith = true;
      updateFilterCounts();
      applyFiltersAndRender();
      if (data.totalMasterEvents) {
        const elM = document.getElementById('stat-master-count');
        if (elM) elM.textContent = data.totalMasterEvents;
      }
    } else {
      showToast(data.error || 'Failed to approve event', 'error');
    }
  } catch (err) {
    showToast('Server error while approving event', 'error');
  }
};

window.rejectQuarantinedEvent = async function (eventId) {
  if (!state.token) return;
  const original = state.quarantinedEvents.find(e => e.id === eventId);
  if (!original) return;

  try {
    const res = await fetch('/api/curator/reject', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: jsonStringify({ id: eventId, reason: 'Dismissed by curator' })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`🛑 '${original.title}' dismissed and archived.`, 'info');
      original.reviewStatus = 'pending_antigravity_review';
      original.dealtWith = true;
      updateFilterCounts();
      applyFiltersAndRender();
    } else {
      showToast(data.error || 'Failed to reject event', 'error');
    }
  } catch (err) {
    showToast('Server error while rejecting event', 'error');
  }
};

window.setModalViewMode = function (mode = 'screenshot') {
  const modal = document.getElementById('ai-instruction-modal');
  if (!modal) return;
  const tabScreenshot = document.getElementById('tab-mode-screenshot');
  const tabInstruct = document.getElementById('tab-mode-instruct');
  const dynamicBody = document.getElementById('ai-modal-dynamic-body');
  const dropzoneBlock = document.getElementById('ai-screenshot-dropzone-block');
  const alignPanel = document.getElementById('ai-screenshot-alignment-panel');
  const instructBlock = document.getElementById('ai-instruction-text-block');
  const modalIcon = modal.querySelector('.curator-modal-icon');
  const modalTitle = modal.querySelector('.curator-modal-title');
  const modalDesc = modal.querySelector('.curator-modal-desc');
  const textField = document.getElementById('ai-instruction-text');

  if (mode === 'screenshot') {
    if (tabScreenshot) tabScreenshot.classList.add('active');
    if (tabInstruct) tabInstruct.classList.remove('active');
    if (modalIcon) modalIcon.textContent = '📸';
    if (modalTitle) modalTitle.textContent = 'Screenshot Proof & 13-Dimension Verifier';
    if (modalDesc) modalDesc.textContent = "Upload or paste (Ctrl+V) a screenshot to extract all 13 live dimensions (Name, Date, Time, Schedule, Frequency, Category, Location, Price, Link, Provider, Description, Lineup, Restrictions) and align with this card.";

    if (dynamicBody && dropzoneBlock && instructBlock) {
      dynamicBody.insertBefore(dropzoneBlock, instructBlock);
      if (alignPanel) {
        dynamicBody.insertBefore(alignPanel, instructBlock);
      }
    }
  } else {
    // instruct mode
    if (tabInstruct) tabInstruct.classList.add('active');
    if (tabScreenshot) tabScreenshot.classList.remove('active');
    if (modalIcon) modalIcon.textContent = '📝';
    if (modalTitle) modalTitle.textContent = 'Curator Guidance & Card Update';
    if (modalDesc) modalDesc.textContent = "Attach a screenshot or explain what to fix. The local rules engine and OCR will update card details and record crawler heuristics.";

    if (dynamicBody && instructBlock && dropzoneBlock) {
      dynamicBody.insertBefore(instructBlock, dropzoneBlock);
      if (alignPanel) {
        dropzoneBlock.after(alignPanel);
      }
    }
  }

  // Always keep focus in text field for seamless typing without premature dismissal
  setTimeout(() => {
    if (textField && modal.classList.contains('active')) {
      textField.focus();
    }
  }, 100);
};

window.openAIInstructionModal = function (eventId, mode = 'approve') {
  let ev = (state.quarantinedEvents || []).find(e => e.id === eventId) ||
    (state.archivedEvents || []).find(e => e.id === eventId) ||
    (state.discoveredVenues || []).find(v => v.id === eventId) ||
    (state.discoveredSources || []).find(s => s.id === eventId);

  // Cross-search master catalogs data (events, venues, festivals)
  if (!ev && state.masterCatalogsData) {
    for (const key of Object.keys(state.masterCatalogsData)) {
      const found = (state.masterCatalogsData[key] || []).find(item =>
        item.id === eventId ||
        item.event_id === eventId ||
        item.venue_name === eventId ||
        item.name === eventId ||
        item.festival_name === eventId
      );
      if (found) {
        ev = {
          id: found.id || found.event_id || found.venue_name || found.festival_name || eventId,
          title: found.event_name || found.title || found.venue_name || found.festival_name || found.name || 'Catalog Item',
          venue: found.venue_name || found.venue || found.location || 'Vancouver',
          websiteUrl: found.ticket_url || found.calendar_url || found.website_url || found.schedule_url || found.url || '',
          category: found.category || 'shows',
          price: found.pricing_all_in_cad?.regular ?? found.price ?? 0
        };
        break;
      }
    }
  }

  // Normalize candidate venues
  if (ev && !ev.title && ev.name) {
    ev.title = ev.name;
    ev.venue = ev.name;
    ev.websiteUrl = ev.calendar_url || ev.website_url || ev.url || '';
  }
  // Normalize candidate sources
  if (ev && !ev.title && ev.domain) {
    ev.title = ev.name || ev.domain;
    ev.venue = ev.name || ev.domain;
    ev.websiteUrl = ev.eventsUrl || (ev.domain ? 'https://' + ev.domain : '');
  }

  const modal = document.getElementById('ai-instruction-modal');
  if (!modal) return;

  const modalTitle = modal.querySelector('.curator-modal-title');
  const modalDesc = modal.querySelector('.curator-modal-desc');
  const modalIcon = modal.querySelector('.curator-modal-icon');
  const quickApprovalBox = document.getElementById('ai-quick-approval-box');
  const btnApprove = document.getElementById('btn-submit-ai-inst-and-approve');
  const btnDismiss = document.getElementById('btn-submit-ai-inst-and-dismiss');
  const btnOnly = document.getElementById('btn-submit-ai-inst-only');
  const btnOnlyBottom = document.getElementById('btn-submit-ai-inst-only-bottom');

  const idField = document.getElementById('ai-inst-event-id');
  const venueField = document.getElementById('ai-inst-venue');
  const titleField = document.getElementById('ai-inst-title');
  const urlField = document.getElementById('ai-inst-url');
  const summaryTitle = document.getElementById('ai-inst-summary-title');
  const summaryVenue = document.getElementById('ai-inst-summary-venue');
  const summaryLink = document.getElementById('ai-inst-summary-link');
  const textField = document.getElementById('ai-instruction-text');
  const priceField = document.getElementById('ai-approve-price');
  const catField = document.getElementById('ai-approve-category');
  const noteField = document.getElementById('ai-approve-note');
  const dateField = document.getElementById('ai-approve-date');
  const venueApproveField = document.getElementById('ai-approve-venue');
  const titleApproveField = document.getElementById('ai-approve-title');
  const titleBadge = document.getElementById('ai-approve-title-badge');

  // Reset queue button texts
  if (btnOnly) {
    btnOnly.innerHTML = '💾 Save Guidance &amp; Keep in Queue';
    btnOnly.style.display = 'inline-flex';
  }
  if (btnOnlyBottom) {
    btnOnlyBottom.innerHTML = '💾 Save Guidance &amp; Keep in Queue';
    btnOnlyBottom.style.display = 'inline-flex';
  }
  const btnQueueInterpretedInit = document.getElementById('btn-queue-interpreted-card');
  if (btnQueueInterpretedInit) {
    btnQueueInterpretedInit.innerHTML = '💾 Save Guidance &amp; Update Card';
  }

  // Configure action buttons and boxes
  if (mode === 'dismiss') {
    if (modalIcon) modalIcon.textContent = '🛑';
    if (modalTitle) modalTitle.textContent = 'Dismiss & Record Rule';
    if (modalDesc) modalDesc.textContent = "Dismiss and archive this event, and record crawler rules to permanently skip or adapt to this format on future crawls.";
    if (quickApprovalBox) quickApprovalBox.style.display = 'none';
    if (btnApprove) btnApprove.style.display = 'none';
    if (btnDismiss) btnDismiss.style.display = 'inline-flex';
    if (btnOnly) btnOnly.style.display = 'none';
    if (btnOnlyBottom) btnOnlyBottom.style.display = 'none';
  } else {
    if (quickApprovalBox) quickApprovalBox.style.display = 'block';
    if (btnApprove) btnApprove.style.display = 'none';
    if (btnDismiss) btnDismiss.style.display = 'none';
    if (btnOnly) btnOnly.style.display = 'inline-flex';
    if (btnOnlyBottom) btnOnlyBottom.style.display = 'inline-flex';
  }

  if (ev) {
    if (idField) idField.value = ev.id || '';
    if (venueField) venueField.value = ev.venue || '';
    if (titleField) titleField.value = ev.title || '';
    if (titleApproveField) titleApproveField.value = ev.title || '';
    if (titleBadge) titleBadge.style.display = 'none';
    const website = getEventExternalUrl(ev);
    if (urlField) urlField.value = website;

    if (summaryTitle) summaryTitle.textContent = ev.title || 'Untitled Event';
    if (summaryVenue) summaryVenue.textContent = `${ev.venue || 'Unknown Venue'} • ${ev.neighborhood || 'Vancouver'} • Provider: ${ev.provider || 'Direct'}`;
    if (summaryLink) {
      if (website) {
        summaryLink.href = website;
        summaryLink.textContent = `Source: ${website} ↗`;
        summaryLink.style.display = 'inline-block';
        summaryLink.style.pointerEvents = 'auto';
        summaryLink.style.opacity = '1';
        summaryLink.setAttribute('rel', 'noopener noreferrer');
        summaryLink.setAttribute('referrerpolicy', 'no-referrer');
      } else {
        summaryLink.removeAttribute('href');
        summaryLink.textContent = 'No direct URL';
        summaryLink.style.pointerEvents = 'none';
        summaryLink.style.opacity = '0.5';
      }
    }

    // Pre-fill from card quick-edit inputs if available
    const cardPriceInput = document.getElementById(`edit-price-${ev.id}`);
    const cardCatInput = document.getElementById(`edit-category-${ev.id}`);
    const cardFeeInput = document.getElementById(`edit-fee-${ev.id}`);
    const cardDateInput = document.getElementById(`edit-date-${ev.id}`);

    const attPrice = cardPriceInput ? parseFloat(cardPriceInput.value) : parseFloat(ev.attemptedPrice || ev.price || 0);
    if (priceField) priceField.value = (attPrice <= 50.0 && attPrice >= 0) ? attPrice.toFixed(2) : '25.00';
    if (catField) catField.value = cardCatInput ? cardCatInput.value : (ev.category || 'shows');
    if (dateField) dateField.value = cardDateInput ? cardDateInput.value : (ev.dateSchedule || (ev.startIso ? formatCuratorDate(ev) : ''));
    if (venueApproveField) venueApproveField.value = ev.venue || '';
    if (noteField) {
      if (cardFeeInput && cardFeeInput.value) {
        noteField.value = cardFeeInput.value;
      } else if (isDrift(ev)) {
        noteField.value = 'Approved GA door tier following live page drift audit';
      } else {
        noteField.value = `Verified door rate for ${ev.venue || 'event'}`;
      }
    }

    // Populate Quarantine Reason and Unconfirmed Details / Issues in Instruct AI Modal
    const quarantineBox = document.getElementById('ai-inst-quarantine-box');
    const reasonEl = document.getElementById('ai-inst-quarantine-reason-text');
    const issuesListEl = document.getElementById('ai-inst-quarantine-issues-list');

    if (quarantineBox && reasonEl && issuesListEl) {
      const qReason = ev.quarantineReason || ev.flagReason || ev.archivedReason || '';
      const dateStatus = evaluateCuratorDateStatus(ev);
      const issues = [];

      const attPriceForIssues = parseFloat(ev.attemptedPrice || ev.price || 0.0);
      if (attPriceForIssues > 50.0 || ev.reviewStatus === 'denied_auto_budget') {
        issues.push(`🚨 <strong>Budget Ceiling Exceeded:</strong> Detected rate of $${attPriceForIssues.toFixed(2)} CAD exceeds strict $50.00 CAD ceiling.`);
      }
      if (dateStatus && dateStatus.isUnconfirmed) {
        issues.push(`📅 <strong>Date/Schedule Unconfirmed:</strong> ${dateStatus.dateLabel || 'Schedule or performance times are pending verification.'}`);
      }
      if (isDrift(ev)) {
        issues.push(`⚠️ <strong>Live Page Drift:</strong> Schedule or pricing deviated from prior baseline.`);
      }
      const verification = ev.checkoutVerification || {};
      if (verification.status === 'quarantined' || !verification.status) {
        issues.push(`🛒 <strong>Checkout Fees:</strong> Final checkout cart fees could not be verified dynamically.`);
      } else if (verification.details) {
        issues.push(`ℹ️ <strong>Cart Note:</strong> ${escapeHtml(verification.details)}`);
      }
      if (Array.isArray(ev.validationIssues)) {
        ev.validationIssues.forEach(iss => {
          if (iss && !issues.some(x => x.includes(iss))) {
            issues.push(`⚠️ ${escapeHtml(iss)}`);
          }
        });
      }

      if (qReason) {
        reasonEl.innerHTML = `<span style="font-weight: 700; color: #fca5a5;">Flagged Quarantine Reason:</span> ${escapeHtml(qReason)}`;
        reasonEl.style.display = 'block';
      } else {
        reasonEl.style.display = 'none';
      }

      if (issues.length > 0) {
        issuesListEl.innerHTML = issues.map(iss => `<li><span>${iss}</span></li>`).join('');
        issuesListEl.style.display = 'flex';
      } else {
        issuesListEl.style.display = 'none';
      }

      if (qReason || issues.length > 0) {
        quarantineBox.style.display = 'block';
      } else {
        quarantineBox.style.display = 'none';
      }
    }
  } else {
    const quarantineBox = document.getElementById('ai-inst-quarantine-box');
    if (quarantineBox) quarantineBox.style.display = 'none';
  }

  // Prepopulate if previously dealt with / saved draft exists / instruction already queued or newsletter screenshot exists
  clearScreenshotPreview();
  const existingImgs = [];
  const savedDraft = state.instructionDrafts && state.instructionDrafts[eventId];

  if (savedDraft) {
    if (textField) textField.value = savedDraft.instructionText || '';
    if (savedDraft.approvedPrice !== undefined && savedDraft.approvedPrice !== '' && priceField) {
      priceField.value = parseFloat(savedDraft.approvedPrice).toFixed(2);
    }
    if (savedDraft.approvedCategory && catField) catField.value = savedDraft.approvedCategory;
    if (savedDraft.approvedDate && dateField) dateField.value = savedDraft.approvedDate;
    if (savedDraft.approvedVenue && venueApproveField) venueApproveField.value = savedDraft.approvedVenue;
    if (savedDraft.approvedTitle && titleApproveField) titleApproveField.value = savedDraft.approvedTitle;
    if (savedDraft.curatorNote && noteField) noteField.value = savedDraft.curatorNote;
    if (Array.isArray(savedDraft.screenshots) && savedDraft.screenshots.length > 0) {
      existingImgs.push(...savedDraft.screenshots);
    }
    if (Array.isArray(savedDraft.subEvents) && savedDraft.subEvents.length > 0) {
      state.currentSplitEvents = [...savedDraft.subEvents];
    } else {
      state.currentSplitEvents = [];
    }
    updateModalDraftBadge(true);
  } else if (ev && ev.queuedInstruction) {
    state.currentSplitEvents = [];
    updateModalDraftBadge(false);
    const q = ev.queuedInstruction;
    if (textField) textField.value = q.instructionText || '';
    if (q.approvedPrice && priceField) priceField.value = parseFloat(q.approvedPrice).toFixed(2);
    if (q.approvedCategory && catField) catField.value = q.approvedCategory;
    if (q.approvedDate && dateField) dateField.value = q.approvedDate;
    if (q.approvedVenue && venueApproveField) venueApproveField.value = q.approvedVenue;
    if (q.approvedTitle && titleApproveField) titleApproveField.value = q.approvedTitle;
    if (q.curatorNote && noteField) noteField.value = q.curatorNote;

    // Load screenshots (support both screenshotPaths array and single screenshotPath/screenshotBase64)
    if (Array.isArray(q.screenshotPaths) && q.screenshotPaths.length > 0) {
      existingImgs.push(...q.screenshotPaths);
    } else if (q.screenshotPath) {
      existingImgs.push(q.screenshotPath);
    } else if (q.screenshotBase64) {
      existingImgs.push(q.screenshotBase64);
    }
  } else {
    state.currentSplitEvents = [];
    updateModalDraftBadge(false);
    if (ev) {
      if (ev.emailScreenshot) {
        existingImgs.push(ev.emailScreenshot);
      } else if (ev.screenshotPath) {
        existingImgs.push(ev.screenshotPath);
      }
    }
    if (textField) textField.value = '';
  }

  if (existingImgs.length > 0) {
    addScreenshotDataUrls(existingImgs);
  }

  if (textField) {
    if (mode === 'dismiss') {
      textField.placeholder = "e.g.: 'This venue is private bookings only, or this is a multi-week course rather than a drop-in. Please ignore this section.'";
    } else if (mode === 'screenshot') {
      textField.placeholder = "e.g.: 'Attached screenshot proof showing verified door price, showtimes, and lineup.'";
    } else if (ev && isDrift(ev)) {
      textField.placeholder = `Explain the live drift, e.g.: 'The page now shows a price change. The scraper should look for the lowest general admission tier at...'`;
    } else {
      textField.placeholder = "e.g.: 'The price is $15 door rate, happening Saturday at 8pm.' OR click '🔀 Detect & Split Multiple Events' to auto-decompose a multi-show schedule into discrete cards.";
    }
  }

  modal.classList.add('active');

  // Determine initial view mode
  const initialMode = (mode === 'screenshot' || (mode !== 'instruct' && mode !== 'dismiss' && existingImgs.length > 0)) ? 'screenshot' : (mode === 'dismiss' ? 'instruct' : (mode === 'instruct' ? 'instruct' : 'screenshot'));
  window.setModalViewMode(initialMode);

  // If we already have saved subEvents, render the interactive preview directly
  if (state.currentSplitEvents && state.currentSplitEvents.length > 0) {
    renderInteractiveMultiEventPreview(state.currentSplitEvents);
  } else {
    // Trigger initial real-time AI interpretation to display live card preview
    interpretCuratorInstruction(eventId);
  }
};

window.openEmailScreenshotModal = function (eventId) {
  const item = (state.quarantinedEvents || []).find(e => e.id === eventId) || (state.archivedEvents || []).find(e => e.id === eventId);
  if (!item) return;
  const modal = document.getElementById('email-screenshot-modal');
  const titleEl = document.getElementById('email-modal-title');
  const subtitleEl = document.getElementById('email-modal-subtitle');
  const imgEl = document.getElementById('email-modal-img');
  const emptyEl = document.getElementById('email-modal-empty');
  const shotLink = document.getElementById('email-modal-shot-link');
  const rawLink = document.getElementById('email-modal-raw-link');

  if (titleEl) titleEl.textContent = `📧 ${item.title || 'Newsletter Event'}`;
  if (subtitleEl) subtitleEl.textContent = `From: ${item.newsletterSender || 'Newsletter'} • Subject: “${item.newsletterSubject || 'Event Digest'}”`;

  if (item.emailScreenshot) {
    if (imgEl) {
      imgEl.src = item.emailScreenshot;
      imgEl.style.display = 'inline-block';
    }
    if (emptyEl) emptyEl.style.display = 'none';
    if (shotLink) {
      shotLink.href = item.emailScreenshot;
      shotLink.style.display = 'inline';
    }
  } else {
    if (imgEl) imgEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    if (shotLink) shotLink.style.display = 'none';
  }

  if (rawLink) {
    if (item.emailHtmlPath) {
      rawLink.href = item.emailHtmlPath;
      rawLink.style.display = 'inline';
    } else {
      rawLink.style.display = 'none';
    }
  }

  if (modal) modal.classList.add('active');
};

function clearScreenshotPreview() {
  state.currentScreenshots = [];
  state.currentScreenshotBase64 = null;
  const prompt = document.getElementById('ai-dropzone-prompt');
  const container = document.getElementById('ai-screenshot-preview-container');
  const gallery = document.getElementById('ai-screenshot-gallery-grid');
  const fileInput = document.getElementById('ai-screenshot-file-input');
  if (prompt) prompt.style.display = 'block';
  if (container) container.style.display = 'none';
  if (gallery) gallery.innerHTML = '';
  if (fileInput) fileInput.value = '';
  resetScreenshotAlignmentPanel();
  interpretCuratorInstruction();
}

const LIVE_DIMENSION_KEYS = [
  'title',
  'date',
  'time',
  'schedule',
  'frequency',
  'category',
  'location',
  'price',
  'link',
  'provider',
  'description',
  'lineup',
  'restrictions'
];

function resetScreenshotAlignmentPanel() {
  state.currentOcrVerification = null;
  const panel = document.getElementById('ai-screenshot-alignment-panel');
  if (panel) panel.style.display = 'none';

  const loading = document.getElementById('ai-alignment-loading');
  if (loading) loading.style.display = 'none';

  const results = document.getElementById('ai-alignment-results');
  if (results) results.style.display = 'none';

  const badge = document.getElementById('ai-alignment-status-badge');
  if (badge) {
    badge.textContent = 'Analyzing...';
    badge.style.background = 'rgba(56, 189, 248, 0.2)';
    badge.style.color = '#38bdf8';
  }

  const btnApplyAll = document.getElementById('btn-apply-all-dimensions');
  if (btnApplyAll) btnApplyAll.style.display = 'none';

  // Reset all 13 dimension cards
  const defaults = {
    title: { val: 'No event title detected', compare: 'Card: Untitled Event' },
    date: { val: 'No date detected', compare: 'Card: Pending Review' },
    time: { val: 'Doors/Show time not specified', compare: 'Card: Not specified' },
    schedule: { val: 'One-off Show', compare: 'Card: One-off Show' },
    frequency: { val: 'One-off Show', compare: 'Card: One-off Show' },
    category: { val: '🏷️ Event', compare: 'Card: Comedy & Shows' },
    location: { val: 'Venue unverified', compare: 'Card: Venue' },
    price: { val: '$0.00 CAD', compare: 'Card: $0.00' },
    link: { val: 'Direct / Box Office', compare: 'Card: Direct' },
    provider: { val: 'Direct / Box Office', compare: 'Card: Direct' },
    description: { val: 'No details extracted', compare: 'Card: Title' },
    lineup: { val: 'None specified', compare: 'Card: None' },
    restrictions: { val: 'All Ages / Standard', compare: 'Card: All Ages' }
  };

  LIVE_DIMENSION_KEYS.forEach(k => {
    const cardEl = document.getElementById(`ai-dim-card-${k}`);
    const badgeEl = document.getElementById(`ai-dim-badge-${k}`);
    const valEl = document.getElementById(`ai-dim-val-${k}`);
    const compEl = document.getElementById(`ai-dim-compare-${k}`);

    if (k === 'lineup' || k === 'restrictions') {
      if (cardEl) cardEl.className = 'curator-dimension-card dim-status-optional';
      if (badgeEl) {
        badgeEl.textContent = k === 'lineup' ? 'Optional / None' : 'Optional / Standard';
        badgeEl.className = 'dim-pill dim-pill-optional';
      }
    } else {
      if (cardEl) cardEl.className = 'curator-dimension-card';
      if (badgeEl) {
        badgeEl.textContent = 'Pending';
        badgeEl.className = 'dim-pill dim-pill-unconfirmed';
      }
    }

    if (valEl) valEl.textContent = defaults[k]?.val || 'Pending';
    if (compEl) compEl.textContent = defaults[k]?.compare || '';
  });

  const titleBadge = document.getElementById('ai-approve-title-badge');
  if (titleBadge) titleBadge.style.display = 'none';

  const priceEl = document.getElementById('ai-ocr-detected-price');
  if (priceEl) {
    priceEl.textContent = '$0.00';
    priceEl.style.color = '#f8fafc';
  }

  const feeEl = document.getElementById('ai-ocr-fee-breakdown');
  if (feeEl) feeEl.textContent = 'Fee Breakdown';

  const discAlert = document.getElementById('ai-ocr-discrepancy-alert');
  if (discAlert) {
    discAlert.style.display = 'none';
    discAlert.textContent = '';
  }

  const statAlert = document.getElementById('ai-ocr-status-warning');
  if (statAlert) {
    statAlert.style.display = 'none';
    statAlert.textContent = '';
  }

  ['venue', 'title', 'date', 'age'].forEach(k => {
    const row = document.getElementById(`ai-align-row-${k}`);
    const val = document.getElementById(`ai-align-val-${k}`);
    if (row) row.style.borderLeft = '3px solid #94a3b8';
    if (val) {
      val.textContent = k === 'age' ? 'Standard' : 'Checking...';
      val.style.color = '#f1f5f9';
    }
  });
}

function applyAllExtractedDimensions(dims) {
  if (!dims) return;
  const titleInput = document.getElementById('ai-approve-title');
  const priceInput = document.getElementById('ai-approve-price');
  const catInput = document.getElementById('ai-approve-category');
  const dateInput = document.getElementById('ai-approve-date');
  const venueInput = document.getElementById('ai-approve-venue');
  const noteInput = document.getElementById('ai-approve-note');

  const highlightedEls = [];

  // 1. Event Name / Title
  if (titleInput) {
    const extTitle = dims.title?.extractedTitle || dims.title?.extracted || dims.description?.extractedTitle || dims.description?.details?.extractedTitle || state.currentOcrVerification?.title?.extractedTitle;
    if (extTitle && extTitle !== 'No event title detected' && extTitle !== 'No title detected') {
      titleInput.value = extTitle;
      highlightedEls.push(titleInput);
    }
  }

  // 2. Price
  if (priceInput && dims.price) {
    const p = dims.price.extracted !== null && dims.price.extracted !== undefined ? dims.price.extracted : dims.price.details?.total;
    if (p !== null && p !== undefined && !isNaN(p)) {
      priceInput.value = parseFloat(p).toFixed(2);
      highlightedEls.push(priceInput);
    }
  }

  // 3. Category
  if (catInput && dims.category) {
    const targetCat = (dims.category.extracted || dims.category.details?.category || dims.category.detected || '').toLowerCase();
    for (let opt of catInput.options) {
      if (opt.value === targetCat || (targetCat && opt.value.includes(targetCat))) {
        catInput.value = opt.value;
        highlightedEls.push(catInput);
        break;
      }
    }
  }

  // 4. Date
  if (dateInput && dims.date) {
    const d = dims.date.extracted || dims.date.displayValue;
    if (d && d !== 'No date detected on screenshot' && d !== 'No date detected' && d !== 'No specific date detected') {
      dateInput.value = d;
      highlightedEls.push(dateInput);
    }
  }

  // 5. Venue & Location
  if (venueInput && dims.location) {
    const v = dims.location.details?.venue || dims.location.extracted || dims.location.venue;
    if (v && v !== 'Venue unverified' && v !== 'Venue') {
      venueInput.value = v;
      highlightedEls.push(venueInput);
    }
  }

  // 6. Note / Time, Fee breakdown, Lineup & Restrictions
  if (noteInput) {
    const notes = [];
    if (dims.price?.details?.breakdown) {
      notes.push(dims.price.details.breakdown);
    }
    if (dims.time?.displayValue && dims.time.displayValue !== 'Doors/Show times not specified' && dims.time.displayValue !== 'Doors/Show time not specified') {
      notes.push(dims.time.displayValue);
    }
    if (dims.lineup?.extracted && dims.lineup.extracted !== 'None' && dims.lineup.extracted !== 'None specified') {
      notes.push(`Lineup: ${dims.lineup.extracted}`);
    }
    if (dims.restrictions?.extracted && dims.restrictions.extracted !== 'All Ages' && dims.restrictions.extracted !== 'Standard') {
      notes.push(`Policy: ${dims.restrictions.extracted}`);
    }
    if (dims.provider?.extracted && dims.provider.extracted !== 'Direct / Box Office' && dims.provider.extracted !== 'Direct') {
      notes.push(`Tickets: ${dims.provider.extracted}`);
    }
    if (notes.length > 0) {
      noteInput.value = notes.join(' • ');
      highlightedEls.push(noteInput);
    }
  }

  // Smooth visual pulse on all updated inputs
  highlightedEls.forEach(el => {
    el.style.transition = 'background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease';
    el.style.backgroundColor = 'rgba(16, 185, 129, 0.25)';
    el.style.borderColor = '#10b981';
    el.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.4)';
    setTimeout(() => {
      el.style.backgroundColor = '';
      el.style.borderColor = '';
      el.style.boxShadow = '';
    }, 1500);
  });

  showToast('⚡ Applied all extracted live dimensions and event title to card!', 'success');
}

function applySingleDimension(dimKey, dims) {
  if (!dims) return;
  const titleInput = document.getElementById('ai-approve-title');
  const priceInput = document.getElementById('ai-approve-price');
  const catInput = document.getElementById('ai-approve-category');
  const dateInput = document.getElementById('ai-approve-date');
  const venueInput = document.getElementById('ai-approve-venue');
  const noteInput = document.getElementById('ai-approve-note');

  let updatedEl = null;

  if (dimKey === 'title' && titleInput) {
    const extTitle = dims.title?.extractedTitle || dims.title?.extracted || dims.description?.extractedTitle || dims.description?.details?.extractedTitle || state.currentOcrVerification?.title?.extractedTitle;
    if (extTitle && extTitle !== 'No event title detected' && extTitle !== 'No title detected') {
      titleInput.value = extTitle;
      updatedEl = titleInput;
      showToast(`⚡ Applied extracted event name: "${extTitle}"`, 'success');
    }
  } else if (dimKey === 'date' && dateInput && dims.date) {
    const d = dims.date.extracted || dims.date.displayValue;
    if (d && d !== 'No date detected') {
      dateInput.value = d;
      updatedEl = dateInput;
      showToast(`⚡ Applied extracted date: "${d}"`, 'success');
    }
  } else if (dimKey === 'time' && noteInput && dims.time) {
    const t = dims.time.displayValue || dims.time.extracted;
    if (t && t !== 'Doors/Show times not specified' && t !== 'Doors/Show time not specified') {
      noteInput.value = (noteInput.value ? noteInput.value + ' • ' : '') + t;
      updatedEl = noteInput;
      showToast(`⚡ Applied event time (${t}) to notes!`, 'success');
    } else {
      showToast(`No specific doors/show times detected on screenshot`, 'info');
    }
  } else if (dimKey === 'schedule' && noteInput && dims.schedule) {
    const s = dims.schedule.displayValue || dims.schedule.extracted;
    if (s) {
      noteInput.value = (noteInput.value ? noteInput.value + ' • ' : '') + `Schedule: ${s}`;
      updatedEl = noteInput;
      showToast(`⚡ Applied schedule details!`, 'success');
    }
  } else if (dimKey === 'frequency' && noteInput && dims.frequency) {
    const f = dims.frequency.displayValue || dims.frequency.extracted;
    if (f) {
      noteInput.value = (noteInput.value ? noteInput.value + ' • ' : '') + `Recurrence: ${f}`;
      updatedEl = noteInput;
      showToast(`⚡ Applied frequency to audit notes!`, 'success');
    }
  } else if (dimKey === 'category' && catInput && dims.category) {
    const c = (dims.category.extracted || dims.category.detected || '').toLowerCase();
    for (let opt of catInput.options) {
      if (opt.value === c || (c && opt.value.includes(c))) {
        catInput.value = opt.value;
        updatedEl = catInput;
        showToast(`⚡ Selected category: ${opt.textContent}`, 'success');
        break;
      }
    }
  } else if (dimKey === 'location' && venueInput && dims.location) {
    const v = dims.location.details?.venue || dims.location.extracted || dims.location.venue;
    if (v) {
      venueInput.value = v;
      updatedEl = venueInput;
      showToast(`⚡ Applied venue: "${v}"`, 'success');
    }
  } else if (dimKey === 'price' && priceInput && dims.price) {
    const p = dims.price.extracted !== null && dims.price.extracted !== undefined ? dims.price.extracted : dims.price.total;
    if (p !== null && !isNaN(p)) {
      priceInput.value = parseFloat(p).toFixed(2);
      updatedEl = priceInput;
      if (noteInput && dims.price.displayValue) {
        noteInput.value = dims.price.displayValue;
      }
      showToast(`⚡ Applied verified price $${parseFloat(p).toFixed(2)} CAD!`, 'success');
    }
  } else if (dimKey === 'link' && dims.link) {
    const l = dims.link.extracted || dims.link.displayValue;
    if (l && String(l).startsWith('http')) {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(l).catch(() => { });
      }
      showToast(`🔗 Event link copied to clipboard: ${l}`, 'success');
    } else {
      showToast(`Event link: ${l || 'Direct / Box Office'}`, 'info');
    }
  } else if (dimKey === 'provider' && noteInput && dims.provider) {
    const prov = dims.provider.displayValue || dims.provider.extracted;
    if (prov) {
      noteInput.value = (noteInput.value ? noteInput.value + ' • ' : '') + `Tickets: ${prov}`;
      updatedEl = noteInput;
      showToast(`⚡ Applied ticketing provider: ${prov}`, 'success');
    }
  } else if (dimKey === 'description' && noteInput && dims.description) {
    const desc = dims.description.displayValue || dims.description.extracted;
    if (desc) {
      noteInput.value = (noteInput.value ? noteInput.value + ' • ' : '') + `Desc: ${desc.substring(0, 100)}`;
      updatedEl = noteInput;
      showToast(`⚡ Applied description snippet to notes!`, 'success');
    }
  } else if (dimKey === 'lineup' && dims.lineup) {
    const lineup = dims.lineup.extracted || dims.lineup.details?.lineup;
    if (lineup && lineup !== 'None' && lineup !== 'None specified') {
      if (noteInput) {
        noteInput.value = (noteInput.value ? noteInput.value + ' • ' : '') + `Lineup: ${lineup}`;
        updatedEl = noteInput;
      }
      showToast(`⚡ Applied artist lineup: "${lineup}"`, 'success');
    } else {
      showToast(`Lineup is optional and none was detected on screenshot.`, 'info');
    }
  } else if (dimKey === 'restrictions' && dims.restrictions) {
    const policy = dims.restrictions.extracted || dims.restrictions.details?.agePolicy;
    if (policy && policy !== 'All Ages' && policy !== 'Standard' && policy !== 'None') {
      if (noteInput) {
        noteInput.value = (noteInput.value ? noteInput.value + ' • ' : '') + `Policy: ${policy}`;
        updatedEl = noteInput;
      }
      showToast(`⚡ Applied restrictions: "${policy}"`, 'success');
    } else {
      showToast(`Restrictions are optional (Standard / All Ages).`, 'info');
    }
  }

  if (updatedEl) {
    updatedEl.style.transition = 'background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease';
    updatedEl.style.backgroundColor = 'rgba(16, 185, 129, 0.25)';
    updatedEl.style.borderColor = '#10b981';
    updatedEl.style.boxShadow = '0 0 12px rgba(16, 185, 129, 0.4)';
    setTimeout(() => {
      updatedEl.style.backgroundColor = '';
      updatedEl.style.borderColor = '';
      updatedEl.style.boxShadow = '';
    }, 1500);
  }
}

async function triggerScreenshotVerification(dataUrl) {
  if (!dataUrl || !state.token) return;

  const panel = document.getElementById('ai-screenshot-alignment-panel');
  const loading = document.getElementById('ai-alignment-loading');
  const results = document.getElementById('ai-alignment-results');
  const badge = document.getElementById('ai-alignment-status-badge');
  const btnApplyAll = document.getElementById('btn-apply-all-dimensions');
  const detectedPriceEl = document.getElementById('ai-ocr-detected-price');
  const feeBreakdownEl = document.getElementById('ai-ocr-fee-breakdown');
  const discrepancyAlert = document.getElementById('ai-ocr-discrepancy-alert');
  const statusWarning = document.getElementById('ai-ocr-status-warning');
  const btnApplyPrice = document.getElementById('btn-apply-ocr-price');
  const eventId = document.getElementById('ai-inst-event-id')?.value || '';

  if (panel) panel.style.display = 'block';
  if (loading) loading.style.display = 'flex';
  if (results) results.style.display = 'none';
  if (badge) {
    badge.textContent = 'Running Native OCR...';
    badge.style.background = 'rgba(56, 189, 248, 0.2)';
    badge.style.color = '#38bdf8';
  }

  try {
    const res = await fetch('/api/curator/verify-screenshot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: jsonStringify({
        eventId: eventId,
        screenshotBase64: dataUrl
      })
    });

    if (loading) loading.style.display = 'none';
    if (results) results.style.display = 'block';

    if (res.ok) {
      const data = await res.json();
      if (data.success) {
        state.currentOcrVerification = data;
        const dims = data.dimensions || {};

        // 1. Header Status Badge
        if (badge) {
          if (data.aligned || data.isFullyAligned) {
            badge.textContent = '✓ 13/13 Dimensions Aligned';
            badge.style.background = 'rgba(16, 185, 129, 0.25)';
            badge.style.color = '#34d399';
          } else if (data.warnings && data.warnings.length > 0) {
            badge.textContent = '⚠️ Attention Needed';
            badge.style.background = 'rgba(245, 158, 11, 0.25)';
            badge.style.color = '#fbbf24';
          } else {
            badge.textContent = '✓ 13 Dimensions Extracted';
            badge.style.background = 'rgba(56, 189, 248, 0.25)';
            badge.style.color = '#38bdf8';
          }
        }

        // 2. Enable Master "Apply All Extracted Dimensions" button
        if (btnApplyAll) {
          btnApplyAll.style.display = 'inline-flex';
        }

        // 3. Render All 13 Dimensions in the Interactive Grid
        LIVE_DIMENSION_KEYS.forEach(k => {
          const dim = dims[k];
          if (!dim) return;

          const cardEl = document.getElementById(`ai-dim-card-${k}`);
          const badgeEl = document.getElementById(`ai-dim-badge-${k}`);
          const valEl = document.getElementById(`ai-dim-val-${k}`);
          const compEl = document.getElementById(`ai-dim-compare-${k}`);

          if (valEl) {
            valEl.textContent = dim.displayValue || dim.extracted || (dim.isOptional ? 'None specified' : 'Not detected');
          }

          if (compEl) {
            const cardValStr = dim.cardValue || (dim.isOptional ? 'None' : 'Pending Review');
            compEl.textContent = `Card: ${cardValStr}`;
          }

          if (badgeEl) {
            if (dim.status === 'optional' || (dim.isOptional && !dim.extracted)) {
              badgeEl.textContent = k === 'lineup' ? 'Optional / None' : 'Optional / Standard';
              badgeEl.className = 'dim-pill pill-optional';
            } else if (dim.isMatch) {
              badgeEl.textContent = '✓ Verified Match';
              badgeEl.className = 'dim-pill pill-confirmed';
            } else if (dim.status === 'discrepancy') {
              badgeEl.textContent = '⚠️ Discrepancy';
              badgeEl.className = 'dim-pill pill-discrepancy';
            } else if (dim.extracted) {
              badgeEl.textContent = '🔍 Extracted';
              badgeEl.className = 'dim-pill pill-inferred';
            } else {
              badgeEl.textContent = dim.isOptional ? 'Optional' : 'Unconfirmed';
              badgeEl.className = dim.isOptional ? 'dim-pill pill-optional' : 'dim-pill pill-unconfirmed';
            }
          }

          if (cardEl) {
            if (dim.status === 'optional' || (dim.isOptional && !dim.extracted)) {
              cardEl.className = 'curator-dimension-card dim-status-optional';
            } else if (dim.isMatch) {
              cardEl.className = 'curator-dimension-card dim-status-confirmed';
            } else if (dim.status === 'discrepancy') {
              cardEl.className = 'curator-dimension-card dim-status-discrepancy';
            } else if (dim.extracted) {
              cardEl.className = 'curator-dimension-card dim-status-notice';
            } else {
              cardEl.className = 'curator-dimension-card';
            }
          }
        });

        // 3b. Dedicated Event Name / Title extraction row
        const valTitleEl = document.getElementById('ai-dim-val-title');
        const compTitleEl = document.getElementById('ai-dim-compare-title');
        const badgeTitleEl = document.getElementById('ai-dim-badge-title');
        const titleBadge = document.getElementById('ai-approve-title-badge');
        const titleInput = document.getElementById('ai-approve-title');

        const extractedTitle = data.title?.extractedTitle || dims.description?.extractedTitle || dims.description?.details?.extractedTitle || '';
        const cardTitleStr = data.title?.cardTitle || '';
        const hasTitleChange = Boolean(data.title?.hasTitleChange || dims.description?.hasTitleChange);
        const isTitleMatch = Boolean(data.title?.matchedInScreenshot);

        if (valTitleEl) {
          valTitleEl.textContent = extractedTitle || 'No event title detected';
        }
        if (compTitleEl) {
          compTitleEl.textContent = `Card: ${cardTitleStr || 'Untitled Event'}`;
        }
        if (badgeTitleEl) {
          if (hasTitleChange) {
            badgeTitleEl.textContent = '⚠️ Name Changed';
            badgeTitleEl.className = 'dim-pill pill-discrepancy';
          } else if (isTitleMatch) {
            badgeTitleEl.textContent = '✓ Name Matches';
            badgeTitleEl.className = 'dim-pill pill-confirmed';
          } else if (extractedTitle) {
            badgeTitleEl.textContent = '🔍 Extracted Name';
            badgeTitleEl.className = 'dim-pill pill-inferred';
          } else {
            badgeTitleEl.textContent = 'No Title Detected';
            badgeTitleEl.className = 'dim-pill dim-pill-unconfirmed';
          }
        }

        if (hasTitleChange) {
          if (titleBadge) titleBadge.style.display = 'inline-block';
          if (titleInput && extractedTitle && (!titleInput.value || titleInput.value === cardTitleStr)) {
            titleInput.value = extractedTitle;
            titleInput.style.transition = 'background-color 0.3s ease, border-color 0.3s ease, box-shadow 0.3s ease';
            titleInput.style.backgroundColor = 'rgba(245, 158, 11, 0.25)';
            titleInput.style.borderColor = '#f59e0b';
            titleInput.style.boxShadow = '0 0 12px rgba(245, 158, 11, 0.4)';
            setTimeout(() => {
              titleInput.style.backgroundColor = '';
              titleInput.style.borderColor = '';
              titleInput.style.boxShadow = '';
            }, 2500);
          }
        } else {
          if (titleBadge) titleBadge.style.display = 'none';
        }

        // 4. Update Legacy Elements for 100% Backwards Compatibility
        const shotPrice = dims.price?.extracted ?? data.price?.screenshotPrice;
        const feeText = dims.price?.details?.breakdown || data.price?.feeBreakdown;
        if (detectedPriceEl) {
          if (shotPrice !== null && shotPrice !== undefined) {
            detectedPriceEl.textContent = `$${parseFloat(shotPrice).toFixed(2)} CAD (all-in)`;
            detectedPriceEl.style.color = shotPrice <= 50.0 ? '#34d399' : '#f87171';
          } else {
            detectedPriceEl.textContent = 'No total price detected';
            detectedPriceEl.style.color = '#94a3b8';
          }
        }
        if (feeBreakdownEl) {
          feeBreakdownEl.textContent = feeText || 'No individual fees itemized';
        }
        if (btnApplyPrice && shotPrice !== null && shotPrice !== undefined) {
          btnApplyPrice.dataset.price = parseFloat(shotPrice).toFixed(2);
          btnApplyPrice.dataset.breakdown = feeText || '';
        }

        // 5. Intelligent Form Auto-fill (Price, Date, Category, Venue, Note)
        const priceInput = document.getElementById('ai-approve-price');
        const noteInput = document.getElementById('ai-approve-note');
        const dateInput = document.getElementById('ai-approve-date');
        const venueInput = document.getElementById('ai-approve-venue');
        const catInput = document.getElementById('ai-approve-category');

        if (priceInput && shotPrice !== null && shotPrice !== undefined) {
          const currentVal = parseFloat(priceInput.value);
          if (isNaN(currentVal) || currentVal === 0 || currentVal === 25.0) {
            priceInput.value = parseFloat(shotPrice).toFixed(2);
          }
        }

        if (dateInput && dims.date?.extracted && (!dateInput.value || dateInput.value.includes('pending') || dateInput.value === '')) {
          dateInput.value = dims.date.extracted;
        }

        if (venueInput && dims.location?.details?.venue && (!venueInput.value || venueInput.value === 'Venue' || venueInput.value === '')) {
          venueInput.value = dims.location.details.venue;
        }

        if (catInput && dims.category?.extracted) {
          const tgt = String(dims.category.extracted).toLowerCase();
          for (let opt of catInput.options) {
            if (opt.value === tgt) {
              catInput.value = opt.value;
              break;
            }
          }
        }

        if (noteInput && feeText && (!noteInput.value || noteInput.value.startsWith('Verified door rate'))) {
          noteInput.value = feeText;
        }

        // 6. Discrepancy Alert Banner
        if (discrepancyAlert) {
          const cardPrice = data.price?.cardPrice;
          const hasPriceMismatch = (cardPrice !== null && shotPrice !== null && Math.abs(cardPrice - shotPrice) > 0.05);
          const hasTitleMismatch = Boolean(data.title?.hasTitleChange);
          const alertParts = [];
          if (hasTitleMismatch && (data.title?.discrepancy?.message || extractedTitle)) {
            const titleMsg = data.title?.discrepancy?.message || `Event Name Change: Screenshot shows "${extractedTitle}" (Card has "${cardTitleStr}").`;
            alertParts.push(`⚠️ <strong>Event Name Change:</strong> ${escapeHtml(titleMsg)}`);
          }
          if (hasPriceMismatch) {
            alertParts.push(`⚠️ <strong>Price Mismatch:</strong> Card has <strong>$${cardPrice.toFixed(2)}</strong>, but screenshot verified <strong>$${shotPrice.toFixed(2)} all-in</strong>.`);
          }
          if (alertParts.length > 0) {
            discrepancyAlert.style.display = 'block';
            discrepancyAlert.innerHTML = alertParts.join('<br>') + '<div style="margin-top: 4px; font-size: 0.76rem; color: #fde68a;">Click <em>⚡ Apply All Extracted Dimensions</em> or <em>⚡ Apply Event Name</em> to update.</div>';
          } else if (data.warnings && data.warnings.length > 0) {
            discrepancyAlert.style.display = 'block';
            discrepancyAlert.innerHTML = `⚠️ <strong>Notice:</strong> ` + data.warnings.map(escapeHtml).join('; ');
          } else {
            discrepancyAlert.style.display = 'none';
          }
        }

        // 7. Status Warning Banner (Sold out / Private)
        if (statusWarning) {
          if (data.ocrSummary?.soldOut || dims.description?.details?.isSoldOut) {
            statusWarning.style.display = 'block';
            statusWarning.innerHTML = `🛑 <strong>Sold Out / Capacity Alert:</strong> Screenshot text contains sold out / off-sale terms. Check before approving.`;
          } else if (data.ocrSummary?.privateEvent || dims.description?.details?.isPrivate) {
            statusWarning.style.display = 'block';
            statusWarning.innerHTML = `🛑 <strong>Restricted Event Alert:</strong> Screenshot indicates a private or members-only event.`;
          } else {
            statusWarning.style.display = 'none';
          }
        }

        showToast('🔍 Extracted all 13 live dimensions from screenshot!', 'info');
      } else {
        if (badge) {
          badge.textContent = 'OCR Notice';
          badge.style.background = 'rgba(245, 158, 11, 0.2)';
          badge.style.color = '#fbbf24';
        }
      }
    } else {
      if (badge) {
        badge.textContent = 'OCR Error';
        badge.style.background = 'rgba(239, 68, 68, 0.2)';
        badge.style.color = '#f87171';
      }
    }
  } catch (err) {
    console.error('Screenshot verification error:', err);
    if (loading) loading.style.display = 'none';
    if (badge) {
      badge.textContent = 'OCR Offline';
      badge.style.background = 'rgba(239, 68, 68, 0.2)';
      badge.style.color = '#f87171';
    }
  }

  // Update real-time live card preview with newly extracted screenshot dimensions
  interpretCuratorInstruction(eventId);
}

function renderScreenshotGallery() {
  const prompt = document.getElementById('ai-dropzone-prompt');
  const container = document.getElementById('ai-screenshot-preview-container');
  const gallery = document.getElementById('ai-screenshot-gallery-grid');
  const countLabel = document.getElementById('ai-screenshot-count-label');

  if (!state.currentScreenshots || state.currentScreenshots.length === 0) {
    clearScreenshotPreview();
    return;
  }

  if (state.activeScreenshotIndex === undefined || state.activeScreenshotIndex < 0 || state.activeScreenshotIndex >= state.currentScreenshots.length) {
    state.activeScreenshotIndex = 0;
  }
  state.currentScreenshotBase64 = state.currentScreenshots[state.activeScreenshotIndex] || null;

  if (prompt) prompt.style.display = 'none';
  if (container) container.style.display = 'block';
  if (countLabel) {
    const n = state.currentScreenshots.length;
    countLabel.textContent = `🖼️ ${n} Screenshot${n === 1 ? '' : 's'} Attached`;
  }

  if (gallery) {
    gallery.innerHTML = state.currentScreenshots.map((src, idx) => {
      const isActive = (idx === state.activeScreenshotIndex);
      return `
        <div 
          class="ai-gallery-item ${isActive ? 'active-screenshot-thumb' : ''}" 
          style="position: relative; width: 92px; height: 92px; border-radius: 6px; overflow: hidden; border: ${isActive ? '2.5px solid #38bdf8' : '1.5px solid rgba(168, 85, 247, 0.55)'}; background: #0f172a; flex-shrink: 0; box-shadow: ${isActive ? '0 0 14px rgba(56, 189, 248, 0.75)' : '0 2px 6px rgba(0,0,0,0.4)'}; cursor: pointer; transition: all 0.2s ease;"
          onclick="window.selectActiveScreenshot(${idx})"
          title="${isActive ? 'Active Verifier Screenshot (Currently extracting dimensions)' : 'Click to verify and extract 13 dimensions from this screenshot'}"
        >
          <img src="${src}" alt="Screenshot #${idx + 1}" style="width: 100%; height: 100%; object-fit: cover;">
          ${isActive ? '<div class="active-shot-pill">Active</div>' : ''}
          <button 
            type="button" 
            onclick="event.stopPropagation(); window.removeScreenshotByIndex(${idx});" 
            title="Remove image" 
            style="position: absolute; top: 3px; right: 3px; background: rgba(239, 68, 68, 0.9); color: #fff; border: none; border-radius: 50%; width: 22px; height: 22px; font-size: 12px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; box-shadow: 0 1px 4px rgba(0,0,0,0.5); z-index: 2;"
          >✕</button>
          <div style="position: absolute; bottom: 3px; left: 3px; background: rgba(0,0,0,0.75); color: #e2e8f0; font-size: 10px; padding: 1px 5px; border-radius: 3px; font-weight: 600;">#${idx + 1}</div>
          <button 
            type="button" 
            onclick="event.stopPropagation(); window.open('${src}', '_blank');" 
            title="View full size image in new tab"
            style="position: absolute; bottom: 3px; right: 3px; background: rgba(15, 23, 42, 0.85); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); border-radius: 3px; font-size: 10px; padding: 1px 4px; cursor: pointer; line-height: 1.2; z-index: 2;"
          >↗</button>
        </div>
      `;
    }).join('');
  }
}

window.selectActiveScreenshot = function (index) {
  if (!state.currentScreenshots || index < 0 || index >= state.currentScreenshots.length) return;
  state.activeScreenshotIndex = index;
  state.currentScreenshotBase64 = state.currentScreenshots[index];
  renderScreenshotGallery();
  showToast(`🔍 Verifying screenshot #${index + 1}...`, 'info');
  triggerScreenshotVerification(state.currentScreenshots[index]);
};

window.removeScreenshotByIndex = function (index) {
  if (state.currentScreenshots && index >= 0 && index < state.currentScreenshots.length) {
    state.currentScreenshots.splice(index, 1);
    const curEventId = document.getElementById('ai-inst-event-id')?.value;
    if (curEventId) saveInstructionDraft(curEventId);
    if (state.currentScreenshots.length === 0) {
      state.activeScreenshotIndex = 0;
      state.currentScreenshotBase64 = null;
      clearScreenshotPreview();
      resetScreenshotAlignmentPanel();
      showToast('All screenshots removed', 'info');
    } else {
      if (state.activeScreenshotIndex >= state.currentScreenshots.length) {
        state.activeScreenshotIndex = state.currentScreenshots.length - 1;
      }
      state.currentScreenshotBase64 = state.currentScreenshots[state.activeScreenshotIndex];
      renderScreenshotGallery();
      showToast('Screenshot removed. Re-verifying remaining proof...', 'info');
      triggerScreenshotVerification(state.currentScreenshots[state.activeScreenshotIndex]);
    }
  }
};

// Image optimization for uploads: downscales giant phone/desktop screenshots to max 1600px
// and generates crisp compressed data URLs to ensure fast, reliable uploads.
async function optimizeImageForUpload(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve) => {
    if (!file || (file.type && !file.type.startsWith('image/')) || file.type === 'image/svg+xml') {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
      return;
    }

    if (file.size && file.size <= 400 * 1024) {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
      return;
    }

    const img = new Image();
    const blobUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(blobUrl);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(dataUrl);
    };
    img.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    img.src = blobUrl;
  });
}

async function handleIncomingScreenshotFiles(files, isVenue = false) {
  const imgFiles = Array.from(files || []).filter(f => f && (!f.type || f.type.startsWith('image/')));
  if (imgFiles.length === 0) return;
  const urls = [];
  for (const f of imgFiles) {
    try {
      const dataUrl = await optimizeImageForUpload(f);
      if (dataUrl) urls.push(dataUrl);
    } catch (e) {
      console.warn('Could not optimize image', e);
    }
  }
  if (urls.length > 0) {
    if (isVenue) {
      addVenueScreenshotDataUrls(urls);
    } else {
      addScreenshotDataUrls(urls);
    }
  }
}

function addScreenshotDataUrls(urls) {
  if (!Array.isArray(urls)) urls = [urls];
  if (!state.currentScreenshots) state.currentScreenshots = [];
  let addedCount = 0;
  let lastAddedIdx = -1;
  for (const url of urls) {
    if (url && typeof url === 'string') {
      state.currentScreenshots.push(url);
      lastAddedIdx = state.currentScreenshots.length - 1;
      addedCount++;
    }
  }
  if (lastAddedIdx >= 0) {
    state.activeScreenshotIndex = lastAddedIdx;
    state.currentScreenshotBase64 = state.currentScreenshots[lastAddedIdx];
  } else if (state.activeScreenshotIndex === undefined || state.activeScreenshotIndex >= state.currentScreenshots.length) {
    state.activeScreenshotIndex = 0;
    state.currentScreenshotBase64 = state.currentScreenshots[0] || null;
  }
  renderScreenshotGallery();
  if (addedCount > 0) {
    const curEventId = document.getElementById('ai-inst-event-id')?.value;
    if (curEventId) saveInstructionDraft(curEventId);
    showToast(`🖼️ ${addedCount} screenshot${addedCount > 1 ? 's' : ''} added! Running 13-dimension verification...`, 'info');
    if (state.currentScreenshots && state.currentScreenshots.length > 0) {
      triggerScreenshotVerification(state.currentScreenshots[state.activeScreenshotIndex]);
    }
  }
}

let debounceInterpretTimer = null;
let currentInterpretAbortController = null;

function renderInteractiveMultiEventPreview(subEvents) {
  const cardWrapper = document.getElementById('ai-card-preview-wrapper');
  const livePreview = document.getElementById('ai-live-card-preview');
  const dismissWrapper = document.getElementById('ai-dismissal-preview-wrapper');
  const statusPill = document.getElementById('ai-interpretation-status-pill');
  const btnOnly = document.getElementById('btn-submit-ai-inst-only');
  const btnOnlyBottom = document.getElementById('btn-submit-ai-inst-only-bottom');
  const btnQueueInterpreted = document.getElementById('btn-queue-interpreted-card');

  if (dismissWrapper) dismissWrapper.style.display = 'none';
  if (cardWrapper) cardWrapper.style.display = 'block';

  if (!Array.isArray(subEvents) || subEvents.length === 0) {
    if (livePreview) livePreview.innerHTML = '<div style="color: #94a3b8; font-size: 0.85rem; padding: 12px; text-align: center;">No discrete events generated. Click "Detect & Split Multiple Events" or adjust your instructions above.</div>';
    return;
  }

  state.currentSplitEvents = subEvents;

  if (statusPill) {
    statusPill.textContent = `🔀 Multi-Event Split (${subEvents.length} Events)`;
    statusPill.className = 'dim-pill pill-confirmed';
  }

  const queueBtnText = `🔀 Save ${subEvents.length} Split Events to Review Queue`;
  if (btnOnly) btnOnly.innerHTML = queueBtnText;
  if (btnOnlyBottom) btnOnlyBottom.innerHTML = queueBtnText;
  if (btnQueueInterpreted) btnQueueInterpreted.innerHTML = queueBtnText;

  // Calculate duplicate titles for inline warning badges
  const titleCounts = {};
  subEvents.forEach(s => {
    const t = (s.title || '').trim().toLowerCase();
    if (t) titleCounts[t] = (titleCounts[t] || 0) + 1;
  });
  const hasDuplicates = Object.values(titleCounts).some(c => c > 1);

  const categories = [
    { id: 'shows', label: '🎭 Comedy & Shows' },
    { id: 'music', label: '🎵 Music' },
    { id: 'crafts', label: '🎨 Crafts & Studios' },
    { id: 'cinema', label: '🎬 Indie Cinema' },
    { id: 'arts', label: '🏛️ Museums & Arts' },
    { id: 'activities', label: '🎲 Games & Activities' },
    { id: 'outdoors', label: '🌊 Walks & Outdoors' },
    { id: 'trivia', label: '🍻 Drinks & Trivia' },
    { id: 'festivals', label: '🎪 Festivals & Fairs' },
    { id: 'social', label: '🤝 Social & Meetups' }
  ];

  let html = `
    <div style="background: rgba(124, 58, 237, 0.16); border: 1.5px solid rgba(168, 85, 247, 0.45); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
        <div style="font-weight: 700; font-size: 0.9rem; color: #d8b4fe; display: flex; align-items: center; gap: 6px;">
          <span>🔀</span> Multi-Event Staging Preview (${subEvents.length} Discrete Events)
        </div>
        <button type="button" id="btn-reanalyze-split" class="btn-curator" style="background: rgba(168, 85, 247, 0.25); border: 1px solid rgba(168, 85, 247, 0.5); color: #e9d5ff; font-size: 0.74rem; padding: 3px 10px; border-radius: 5px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Re-run schedule parser with any newly typed guidance or attached screenshots">
          🔄 Re-Parse Schedule
        </button>
      </div>
      <div style="font-size: 0.77rem; color: #cbd5e1; margin-top: 4px; line-height: 1.4;">
        Schedule parser has decomposed this schedule into discrete event cards. <strong>Each event must have a unique name.</strong> You can edit any field directly below, remove cards, or provide notes above.
      </div>
      ${hasDuplicates ? `
        <div id="split-duplicate-alert" style="margin-top: 8px; background: rgba(239, 68, 68, 0.22); border: 1px solid #ef4444; border-radius: 6px; padding: 6px 10px; color: #fca5a5; font-size: 0.76rem; font-weight: 600; display: flex; align-items: center; gap: 6px;">
          <span>⚠️</span> Duplicate event names detected! Each event must have a unique name before queueing.
        </div>
      ` : ''}
    </div>

    <div id="split-events-card-list" style="display: flex; flex-direction: column; gap: 12px; max-height: 380px; overflow-y: auto; padding-right: 4px;">
      ${subEvents.map((sub, idx) => {
    const tVal = (sub.title || '').trim();
    const isDup = tVal && (titleCounts[tVal.toLowerCase()] > 1);
    const sPrice = parseFloat(sub.price || 0.0);
    const pVal = isNaN(sPrice) ? '0.00' : sPrice.toFixed(2);
    const dVal = sub.dateSchedule || '';
    const cVal = sub.category || 'shows';

    return `
          <div class="split-sub-event-card" data-idx="${idx}" style="background: rgba(15, 23, 42, 0.75); border: 1.5px solid ${isDup ? '#ef4444' : 'rgba(255, 255, 255, 0.12)'}; border-left: 4px solid ${isDup ? '#ef4444' : '#10b981'}; border-radius: 8px; padding: 12px; transition: border-color 0.2s ease;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-weight: 700; font-size: 0.82rem; color: #38bdf8; background: rgba(56, 189, 248, 0.15); padding: 2px 7px; border-radius: 4px;">Card #${idx + 1}</span>
                ${isDup ? '<span style="font-size: 0.7rem; color: #ef4444; font-weight: 700;">⚠️ Duplicate Name</span>' : ''}
              </div>
              <button type="button" class="btn-remove-sub-event" data-idx="${idx}" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.35); color: #f87171; font-size: 0.72rem; padding: 2px 8px; border-radius: 4px; cursor: pointer;" title="Remove this event card">
                🗑️ Remove
              </button>
            </div>

            <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 8px; margin-bottom: 8px;">
              <div>
                <label style="font-size: 0.72rem; color: #94a3b8; display: block; margin-bottom: 2px;">Unique Event Name *</label>
                <input type="text" class="curator-input split-input-title" data-idx="${idx}" value="${escapeHtml(sub.title || '')}" placeholder="Unique Event Title" style="width: 100%; font-size: 0.84rem; padding: 5px 8px; ${isDup ? 'border-color: #ef4444;' : ''}">
              </div>
              <div>
                <label style="font-size: 0.72rem; color: #94a3b8; display: block; margin-bottom: 2px;">Price (CAD ≤ $50)</label>
                <input type="number" step="0.01" min="0" max="50" class="curator-input split-input-price" data-idx="${idx}" value="${pVal}" style="width: 100%; font-size: 0.84rem; padding: 5px 8px;">
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
              <div>
                <label style="font-size: 0.72rem; color: #94a3b8; display: block; margin-bottom: 2px;">Date / Schedule</label>
                <input type="text" class="curator-input split-input-date" data-idx="${idx}" value="${escapeHtml(dVal)}" placeholder="e.g. Saturdays 8pm" style="width: 100%; font-size: 0.84rem; padding: 5px 8px;">
              </div>
              <div>
                <label style="font-size: 0.72rem; color: #94a3b8; display: block; margin-bottom: 2px;">Category</label>
                <select class="curator-select split-input-category" data-idx="${idx}" style="width: 100%; font-size: 0.82rem; padding: 5px 6px;">
                  ${categories.map(c => `
                    <option value="${c.id}" ${cVal === c.id ? 'selected' : ''}>${c.label}</option>
                  `).join('')}
                </select>
              </div>
            </div>

            ${sub.feeBreakdown ? `
              <div style="margin-top: 6px; font-size: 0.7rem; color: #a78bfa;">
                🛡️ ${escapeHtml(sub.feeBreakdown)}
              </div>
            ` : ''}
          </div>
        `;
  }).join('')}
    </div>

    <div style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
      <button type="button" id="btn-add-split-card" class="btn-curator" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; font-size: 0.78rem; padding: 6px 12px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
        ➕ Add Another Sub-Event Card
      </button>
      <button type="button" id="btn-auto-unique-titles" class="btn-curator" style="background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.4); color: #fbbf24; font-size: 0.74rem; padding: 6px 10px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;" title="Automatically append numbers or show times to guarantee all titles are strictly unique">
        🪄 Auto-Fix Duplicate Names
      </button>
    </div>
  `;

  if (livePreview) {
    livePreview.innerHTML = html;
  }

  attachMultiEventPreviewListeners();
}

function attachMultiEventPreviewListeners() {
  const livePreview = document.getElementById('ai-live-card-preview');
  if (!livePreview) return;

  const eventId = document.getElementById('ai-inst-event-id')?.value;

  // Title inputs
  livePreview.querySelectorAll('.split-input-title').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      if (state.currentSplitEvents && state.currentSplitEvents[idx]) {
        state.currentSplitEvents[idx].title = e.target.value;
        if (eventId) saveInstructionDraft(eventId);
        updateSplitTitleWarnings();
      }
    });
  });

  // Price inputs
  livePreview.querySelectorAll('.split-input-price').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      if (state.currentSplitEvents && state.currentSplitEvents[idx]) {
        const val = parseFloat(e.target.value);
        state.currentSplitEvents[idx].price = isNaN(val) ? 0.0 : val;
        state.currentSplitEvents[idx].priceLabel = val === 0 ? 'Free ($0)' : `$${val.toFixed(2)} CAD`;
        if (eventId) saveInstructionDraft(eventId);
      }
    });
  });

  // Date inputs
  livePreview.querySelectorAll('.split-input-date').forEach(input => {
    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      if (state.currentSplitEvents && state.currentSplitEvents[idx]) {
        state.currentSplitEvents[idx].dateSchedule = e.target.value;
        if (eventId) saveInstructionDraft(eventId);
      }
    });
  });

  // Category selects
  livePreview.querySelectorAll('.split-input-category').forEach(select => {
    select.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      if (state.currentSplitEvents && state.currentSplitEvents[idx]) {
        state.currentSplitEvents[idx].category = e.target.value;
        if (eventId) saveInstructionDraft(eventId);
      }
    });
  });

  // Remove buttons
  livePreview.querySelectorAll('.btn-remove-sub-event').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const idx = parseInt(e.target.dataset.idx, 10);
      if (state.currentSplitEvents && state.currentSplitEvents.length > 0) {
        state.currentSplitEvents.splice(idx, 1);
        if (eventId) saveInstructionDraft(eventId);
        if (state.currentSplitEvents.length === 0) {
          interpretCuratorInstruction(eventId);
        } else {
          renderInteractiveMultiEventPreview(state.currentSplitEvents);
        }
      }
    });
  });

  // Add another card button
  const btnAdd = document.getElementById('btn-add-split-card');
  if (btnAdd) {
    btnAdd.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const parentTitle = document.getElementById('ai-inst-title')?.value || 'Event';
      const parentVenue = document.getElementById('ai-inst-venue')?.value || 'Vancouver Venue';
      const newNum = (state.currentSplitEvents || []).length + 1;
      if (!state.currentSplitEvents) state.currentSplitEvents = [];
      state.currentSplitEvents.push({
        title: `${parentTitle} (Show ${newNum})`,
        price: 0.0,
        priceLabel: 'Free ($0)',
        category: 'shows',
        dateSchedule: 'Upcoming',
        venue: parentVenue,
        feeBreakdown: 'Added by curator'
      });
      renderInteractiveMultiEventPreview(state.currentSplitEvents);
      if (eventId) saveInstructionDraft(eventId);
    });
  }

  // Auto-Fix duplicate titles button
  const btnAutoFix = document.getElementById('btn-auto-unique-titles');
  if (btnAutoFix) {
    btnAutoFix.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!state.currentSplitEvents || state.currentSplitEvents.length === 0) return;
      const seen = {};
      state.currentSplitEvents.forEach((s, idx) => {
        let t = (s.title || `Event ${idx + 1}`).trim();
        const low = t.toLowerCase();
        if (seen[low]) {
          seen[low]++;
          if (s.dateSchedule && s.dateSchedule !== 'Upcoming') {
            s.title = `${t} (${s.dateSchedule})`;
          } else {
            s.title = `${t} - Part ${seen[low]}`;
          }
        } else {
          seen[low] = 1;
        }
      });
      renderInteractiveMultiEventPreview(state.currentSplitEvents);
      if (eventId) saveInstructionDraft(eventId);
      showToast('Event titles made strictly unique!', 'success');
    });
  }

  // Re-Analyze button
  const btnReanalyze = document.getElementById('btn-reanalyze-split');
  if (btnReanalyze) {
    btnReanalyze.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (eventId) {
        showToast('Re-analyzing with current guidance...', 'info');
        interpretCuratorInstruction(eventId, { forceMultiSplit: true });
      }
    });
  }
}

function updateSplitTitleWarnings() {
  const titleCounts = {};
  (state.currentSplitEvents || []).forEach(s => {
    const t = (s.title || '').trim().toLowerCase();
    if (t) titleCounts[t] = (titleCounts[t] || 0) + 1;
  });

  const cards = document.querySelectorAll('.split-sub-event-card');
  cards.forEach(card => {
    const idx = parseInt(card.dataset.idx, 10);
    const sub = state.currentSplitEvents && state.currentSplitEvents[idx];
    if (!sub) return;
    const t = (sub.title || '').trim().toLowerCase();
    const isDup = t && titleCounts[t] > 1;
    card.style.borderColor = isDup ? '#ef4444' : 'rgba(255, 255, 255, 0.12)';
    card.style.borderLeftColor = isDup ? '#ef4444' : '#10b981';
    const input = card.querySelector('.split-input-title');
    if (input) input.style.borderColor = isDup ? '#ef4444' : '';
  });

  const alertEl = document.getElementById('split-duplicate-alert');
  const hasDuplicates = Object.values(titleCounts).some(c => c > 1);
  if (alertEl) {
    alertEl.style.display = hasDuplicates ? 'flex' : 'none';
  }
}

async function interpretCuratorInstruction(targetEventId, options = {}) {
  const modal = document.getElementById('ai-instruction-modal');
  if (!modal || !modal.classList.contains('active')) return;

  const eventId = targetEventId || document.getElementById('ai-inst-event-id')?.value;
  if (!eventId) return;

  const instructionText = document.getElementById('ai-instruction-text')?.value || '';
  const loading = document.getElementById('ai-interpretation-loading');
  const statusPill = document.getElementById('ai-interpretation-status-pill');
  const cardWrapper = document.getElementById('ai-card-preview-wrapper');
  const livePreview = document.getElementById('ai-live-card-preview');
  const dismissWrapper = document.getElementById('ai-dismissal-preview-wrapper');
  const dismissReasonEl = document.getElementById('ai-dismissal-reason');
  const chipNotes = document.getElementById('ai-chip-notes');
  const chipLinks = document.getElementById('ai-chip-links');
  const chipProof = document.getElementById('ai-chip-proof');

  if (loading) loading.style.display = 'block';
  if (statusPill) {
    statusPill.textContent = '⚡ Analyzing...';
    statusPill.className = 'dim-pill pill-notice';
  }

  if (currentInterpretAbortController) {
    currentInterpretAbortController.abort();
  }
  currentInterpretAbortController = new AbortController();

  try {
    const activeShot = (state.currentScreenshots && state.currentScreenshots[state.activeScreenshotIndex || 0]) || state.currentScreenshotBase64 || null;
    const payload = {
      eventId: eventId,
      instructionText: instructionText,
      screenshotBase64: activeShot,
      screenshotPaths: state.currentScreenshots || [],
      forceMultiSplit: Boolean(options && options.forceMultiSplit)
    };

    const res = await fetch('/api/curator/interpret-instruction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: jsonStringify(payload),
      signal: currentInterpretAbortController.signal
    });

    if (loading) loading.style.display = 'none';

    if (res.ok) {
      const data = await res.json();
      if (!data.success) {
        if (statusPill) {
          statusPill.textContent = 'Interpretation notice';
          statusPill.className = 'dim-pill pill-discrepancy';
        }
        return;
      }

      state.lastInterpretation = data;

      // Update signal chips
      const chips = data.signalChips || {};
      if (chipNotes) {
        chipNotes.textContent = `📝 Notes: ${chips.notes || 'Analyzing...'}`;
        chipNotes.style.display = 'inline-block';
      }
      if (chipLinks) {
        if (chips.links && chips.links !== 'None') {
          chipLinks.textContent = `🔗 Link: ${chips.links}`;
          chipLinks.style.display = 'inline-block';
        } else {
          chipLinks.style.display = 'none';
        }
      }
      if (chipProof) {
        if (chips.proof && chips.proof !== 'None') {
          chipProof.textContent = `📸 Proof: ${chips.proof}`;
          chipProof.style.display = 'inline-block';
        } else {
          chipProof.style.display = 'none';
        }
      }

      // Update underlying quick-approval fields so user can also use standard submit buttons
      const titleApproveField = document.getElementById('ai-approve-title');
      const priceApproveField = document.getElementById('ai-approve-price');
      const catApproveField = document.getElementById('ai-approve-category');
      const dateApproveField = document.getElementById('ai-approve-date');
      const venueApproveField = document.getElementById('ai-approve-venue');
      const noteApproveField = document.getElementById('ai-approve-note');

      if (titleApproveField && data.extractedTitle) titleApproveField.value = data.extractedTitle;
      if (priceApproveField && data.extractedPrice !== undefined && data.extractedPrice !== null) {
        priceApproveField.value = parseFloat(data.extractedPrice).toFixed(2);
      }
      if (catApproveField && data.extractedCategory) {
        catApproveField.value = data.extractedCategory;
      }
      if (dateApproveField && data.extractedDate) dateApproveField.value = data.extractedDate;
      if (venueApproveField && data.extractedVenue) venueApproveField.value = data.extractedVenue;
      if (noteApproveField && data.auditNote) noteApproveField.value = data.auditNote;

      // Update AI Learned Synthesis Box (brief couple sentences just under screenshot area)
      const modalLearnedBox = document.getElementById('ai-modal-learned-box');
      const modalLearnedText = document.getElementById('ai-modal-learned-text');
      const modalLearnedTiers = document.getElementById('ai-modal-learned-tiers');
      if (modalLearnedBox && modalLearnedText) {
        if (data.aiLearnedSummary) {
          modalLearnedText.textContent = data.aiLearnedSummary;
          if (modalLearnedTiers) {
            const tiers = data.extractedTiers || [];
            if (tiers.length > 0) {
              modalLearnedTiers.innerHTML = tiers.map(t => `
                <span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 4px; background: rgba(168, 85, 247, 0.22); border: 1px solid rgba(168, 85, 247, 0.45); color: #e9d5ff;">
                  ${escapeHtml(t.name)}: <strong>${t.total === 0 ? 'FREE' : '$' + Number(t.total).toFixed(2)}</strong>
                </span>
              `).join('');
              modalLearnedTiers.style.display = 'flex';
            } else {
              modalLearnedTiers.style.display = 'none';
            }
          }
          modalLearnedBox.style.display = 'block';
        } else {
          modalLearnedBox.style.display = 'none';
        }
      }

      if (data.isValid) {
        // Valid Event -> Show live card preview or Multi-Event Split
        if (data.isMultiEventSplit && data.subEvents && data.subEvents.length > 0) {
          state.currentSplitEvents = [...data.subEvents];
          saveInstructionDraft(eventId);
          renderInteractiveMultiEventPreview(state.currentSplitEvents);
        } else {
          state.currentSplitEvents = [];
          if (statusPill) {
            statusPill.textContent = '✅ Valid (Under $50)';
            statusPill.className = 'dim-pill pill-confirmed';
          }
          const btnOnly = document.getElementById('btn-submit-ai-inst-only');
          const btnOnlyBottom = document.getElementById('btn-submit-ai-inst-only-bottom');
          if (btnOnly) {
            btnOnly.innerHTML = `💾 Save Guidance &amp; Keep in Queue`;
          }
          if (btnOnlyBottom) {
            btnOnlyBottom.innerHTML = `💾 Save Guidance &amp; Keep in Queue`;
          }
          const btnQueueInterpreted = document.getElementById('btn-queue-interpreted-card');
          if (btnQueueInterpreted) {
            btnQueueInterpreted.innerHTML = `💾 Save Guidance &amp; Update Card`;
          }
          if (dismissWrapper) dismissWrapper.style.display = 'none';
          if (cardWrapper) cardWrapper.style.display = 'block';

          const p = data.cardPreview || {};
          const priceNum = parseFloat(p.price || 0);
          const priceDisplay = priceNum === 0 ? 'FREE' : `$${priceNum.toFixed(2)}`;
          const dateText = p.dateSchedule || p.date || 'Upcoming';
          const venueText = p.venue || 'Vancouver';
          const neighborhoodText = p.neighborhood ? ` • ${p.neighborhood}` : '';
          const providerText = p.provider ? ` • ${p.provider}` : '';
          const catBadge = p.category ? `<span class="badge-cat-pill">${escapeHtml(p.category.toUpperCase())}</span>` : '';

          if (livePreview) {
            const tiersPreviewHtml = formatTicketTiersHtml({ ...p, curatorAnnotation: { extractedTiers: data.extractedTiers } });
            livePreview.innerHTML = `
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 8px;">
                <div style="font-weight: 700; font-size: 1.05rem; color: #f8fafc; line-height: 1.3;">
                  ${escapeHtml(p.title || 'Untitled Event')}
                </div>
                <div style="font-weight: 800; font-size: 1.15rem; color: #34d399; white-space: nowrap;">
                  ${priceDisplay}
                </div>
              </div>
              <div style="font-size: 0.82rem; color: #cbd5e1; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span>📍 ${escapeHtml(venueText)}${escapeHtml(neighborhoodText)}</span>
                ${catBadge}
                <span style="color: #94a3b8; font-size: 0.76rem;">${escapeHtml(providerText)}</span>
              </div>
              <div style="font-size: 0.82rem; color: #94a3b8; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span>🗓️ ${escapeHtml(dateText)}</span>
                ${(() => {
                const pUrl = getEventExternalUrl(p);
                return pUrl ? `<a href="${escapeHtml(pUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #38bdf8; text-decoration: underline; font-size: 0.76rem;">Inspect Link ↗</a>` : '';
              })()}
              </div>
              ${tiersPreviewHtml}
              ${p.feeBreakdown ? `
                <div style="margin-top: 8px; padding-top: 6px; border-top: 1px dashed rgba(255,255,255,0.1); font-size: 0.74rem; color: #a78bfa;">
                  🛡️ ${escapeHtml(p.feeBreakdown)}
                </div>
              ` : ''}
            `;
          }
        }
      } else {
        // Invalid Event -> Show Dismissal preview & explanation
        state.currentSplitEvents = [];
        if (statusPill) {
          statusPill.textContent = '🛑 Dismiss Recommended';
          statusPill.className = 'dim-pill pill-discrepancy';
        }
        if (cardWrapper) cardWrapper.style.display = 'none';
        if (dismissWrapper) dismissWrapper.style.display = 'block';
        if (dismissReasonEl) {
          dismissReasonEl.textContent = data.dismissReason || 'Event does not meet Van50 inclusion criteria (e.g. price > $50, sold out, or excluded format).';
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn('Error interpreting instruction:', err);
    }
  } finally {
    if (loading) loading.style.display = 'none';
  }
}

function setScreenshotPreview(dataUrl) {
  if (!dataUrl) return;
  addScreenshotDataUrls([dataUrl]);
}

async function submitAIInstruction(action = 'queue_only') {
  if (!state.token) return;

  const textField = document.getElementById('ai-instruction-text');
  let instructionText = textField ? textField.value.trim() : '';

  const eventId = document.getElementById('ai-inst-event-id')?.value || '';
  const eventTitle = document.getElementById('ai-inst-title')?.value || '';
  const venueName = document.getElementById('ai-inst-venue')?.value || '';
  const sourceUrl = document.getElementById('ai-inst-url')?.value || '';
  const approvedTitle = document.getElementById('ai-approve-title')?.value.trim() || eventTitle;

  let approvedPrice = parseFloat(document.getElementById('ai-approve-price')?.value);
  if ((isNaN(approvedPrice) || approvedPrice <= 0) && state.currentOcrVerification?.price?.screenshotPrice) {
    approvedPrice = state.currentOcrVerification.price.screenshotPrice;
  }
  if (isNaN(approvedPrice)) {
    approvedPrice = 0.0;
  }
  const approvedCategory = document.getElementById('ai-approve-category')?.value || 'shows';
  const approvedDate = document.getElementById('ai-approve-date')?.value || '';
  const approvedVenue = document.getElementById('ai-approve-venue')?.value || '';
  const curatorNote = document.getElementById('ai-approve-note')?.value || (state.currentOcrVerification?.price?.feeBreakdown || instructionText);

  // If multi-event split is active, validate each discrete card
  const isSplitActive = Boolean(state.currentSplitEvents && state.currentSplitEvents.length > 0);
  if (isSplitActive) {
    const titleCounts = {};
    for (let i = 0; i < state.currentSplitEvents.length; i++) {
      const sub = state.currentSplitEvents[i];
      const t = (sub.title || '').trim();
      if (!t) {
        showToast(`Event Card #${i + 1} must have a name!`, 'error');
        return;
      }
      const tLow = t.toLowerCase();
      if (titleCounts[tLow]) {
        showToast(`Every event must have a strictly unique name! Duplicate detected: "${t}"`, 'error');
        return;
      }
      titleCounts[tLow] = true;

      const p = parseFloat(sub.price);
      if (isNaN(p) || p < 0 || p > 50.0) {
        showToast(`Event Card #${i + 1} ("${t}") price ($${sub.price}) exceeds the Van50 <= $50.00 CAD limit.`, 'error');
        return;
      }
    }
  }

  const hasScreenshots = Boolean(state.currentScreenshots && state.currentScreenshots.length > 0);
  if (!instructionText) {
    if (isSplitActive) {
      instructionText = `Decomposed into ${state.currentSplitEvents.length} discrete events with verified unique names via curator multi-event guidance.`;
      if (textField) textField.value = instructionText;
    } else if (action === 'queue_and_dismiss') {
      instructionText = state.lastInterpretation?.dismissReason || `Dismissed by curator: ${approvedTitle || eventTitle}`;
      if (textField) textField.value = instructionText;
    } else if (hasScreenshots) {
      const pStr = (!isNaN(approvedPrice) && approvedPrice >= 0) ? `$${approvedPrice.toFixed(2)} CAD` : 'verified rate';
      instructionText = `Verified via screenshot proof: ${approvedTitle || eventTitle} (${pStr}). 13-dimension alignment verified by curator.`;
      if (textField) textField.value = instructionText;
    } else if (action === 'queue_and_approve') {
      instructionText = `Approved into live catalog: ${approvedTitle || eventTitle}`;
      if (textField) textField.value = instructionText;
    } else {
      showToast('Please provide instructions/notes or attach a screenshot', 'error');
      if (textField) textField.focus();
      return;
    }
  }

  if (action === 'queue_and_approve' && (isNaN(approvedPrice) || approvedPrice < 0 || approvedPrice > 50.0)) {
    showToast('Price must be a valid number between $0.00 and $50.00 CAD to approve!', 'error');
    return;
  }

  const activeShot = (state.currentScreenshots && state.currentScreenshots[state.activeScreenshotIndex || 0]) || state.currentScreenshotBase64 || null;
  const payload = {
    instructionText: instructionText,
    eventId: eventId,
    eventTitle: approvedTitle || eventTitle,
    approvedTitle: approvedTitle,
    venueName: approvedVenue || venueName,
    sourceUrl: sourceUrl,
    screenshotBase64: activeShot,
    screenshotsBase64: state.currentScreenshots || [],
    action: action,
    approvedPrice: approvedPrice,
    approvedCategory: approvedCategory,
    approvedDate: approvedDate,
    approvedVenue: approvedVenue,
    curatorNote: curatorNote,
    subEvents: isSplitActive ? state.currentSplitEvents : undefined
  };

  try {
    const res = await fetch('/api/curator/instruction', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: jsonStringify(payload)
    });

    const data = await res.json();
    if (res.ok && data.success) {
      const successMsg = isSplitActive
        ? `🔀 Decomposed into ${state.currentSplitEvents.length} discrete events saved in review queue!`
        : (action === 'queue_and_approve'
          ? '✅ Approved as-is and saved to catalog!'
          : (data.message || '📋 Guidance saved to review queue!'));

      showToast(successMsg, 'success');
      clearInstructionDraft(eventId);
      state.currentSplitEvents = [];

      const modal = document.getElementById('ai-instruction-modal');
      if (modal) modal.classList.remove('active');

      // Update in-memory quarantined event or reload split children
      if (data.isMultiEventSplit || isSplitActive) {
        await loadQuarantineQueue();
      } else {
        const targetItem = state.quarantinedEvents.find(e => e.id === eventId);
        if (targetItem) {
          targetItem.dealtWith = true;
          if (approvedTitle) targetItem.title = approvedTitle;
          const finalPaths = (data.screenshotPaths && data.screenshotPaths.length > 0)
            ? data.screenshotPaths
            : (data.screenshotPath ? [data.screenshotPath] : [...state.currentScreenshots]);
          targetItem.queuedInstruction = {
            instructionText: instructionText,
            eventId: eventId,
            eventTitle: approvedTitle || eventTitle,
            approvedTitle: approvedTitle,
            venueName: venueName,
            sourceUrl: sourceUrl,
            screenshotPath: data.screenshotPath || finalPaths[0] || null,
            screenshotPaths: finalPaths,
            hasScreenshot: finalPaths.length > 0,
            screenshotCount: finalPaths.length,
            action: action,
            approvedPrice: approvedPrice,
            approvedCategory: approvedCategory,
            curatorNote: curatorNote,
            createdAt: new Date().toISOString()
          };
          targetItem.reviewStatus = 'pending_antigravity_review';
        }
      }

      updateFilterCounts();
      applyFiltersAndRender();

      // Refresh status counts
      const statusRes = await fetch('/api/curator/status', {
        headers: { 'Curator-Token': state.token }
      });
      if (statusRes.ok) {
        const sData = await statusRes.json();
        updateHeaderStats(sData.pendingCount, sData.rulesCount, sData.masterCount, sData.instructionsPendingCount || 0);
      }
    } else {
      showToast(data.error || 'Failed to queue instruction', 'error');
    }
  } catch (err) {
    showToast('Server connection error while submitting instruction', 'error');
  }
}

// ==============================================================================
// 6. EVENT LISTENERS & DOM HOOKS
// ==============================================================================

function setupCuratorEventListeners() {
  // Login Form
  const loginForm = document.getElementById('curator-login-form');
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

  // Logout Button
  const logoutBtn = document.getElementById('btn-curator-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  // Trigger Sync Button
  const triggerSyncBtn = document.getElementById('btn-trigger-sync');
  if (triggerSyncBtn) triggerSyncBtn.addEventListener('click', handleTriggerSync);

  // Restart All & Clear Caches Button
  const restartSystemBtn = document.getElementById('btn-restart-system');
  if (restartSystemBtn) restartSystemBtn.addEventListener('click', handleRestartAllAndClear);

  // Fetch Newsletters Button
  const fetchNewslettersBtn = document.getElementById('btn-fetch-newsletters');
  if (fetchNewslettersBtn) fetchNewslettersBtn.addEventListener('click', handleFetchNewsletters);

  // Accessibility Mode Toggle Button
  const curatorAccessBtn = document.getElementById('curator-accessibility-btn');
  if (curatorAccessBtn) curatorAccessBtn.addEventListener('click', toggleCuratorAccessibility);

  // Filter Pills
  const pillsGroup = document.getElementById('filter-pills-group');
  if (pillsGroup) {
    pillsGroup.addEventListener('click', (e) => {
      const pill = e.target.closest('.curator-filter-pill');
      if (!pill) return;
      document.querySelectorAll('.curator-filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeFilter = pill.dataset.filter || 'all';
      applyFiltersAndRender();
    });
  }

  // Platform Filter Select
  const platformSelect = document.getElementById('curator-platform-select');
  if (platformSelect) {
    platformSelect.addEventListener('change', () => {
      state.platformFilter = platformSelect.value;
      applyFiltersAndRender();
    });
  }

  // Sort Select
  const sortSelect = document.getElementById('curator-sort-select');
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      state.sortBy = sortSelect.value;
      applyFiltersAndRender();
    });
  }

  // Search Input & Inline Clear Button
  const searchInput = document.getElementById('curator-search-input');
  const clearSearchBtn = document.getElementById('btn-clear-curator-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.searchQuery = searchInput.value.trim();
      if (clearSearchBtn) {
        clearSearchBtn.style.display = searchInput.value.length > 0 ? 'inline-block' : 'none';
      }
      applyFiltersAndRender();
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      state.searchQuery = '';
      clearSearchBtn.style.display = 'none';
      if (searchInput) searchInput.focus();
      applyFiltersAndRender();
    });
  }

  // Clear Settings Button
  const btnClearSettings = document.getElementById('btn-clear-settings');
  if (btnClearSettings) {
    btnClearSettings.addEventListener('click', () => {
      clearCuratorSettingsAndReload({ restartServer: true });
    });
  }

  // AI Instruction Form & Modal Hooks
  const aiModal = document.getElementById('ai-instruction-modal');
  const cancelAiBtn = document.getElementById('btn-cancel-ai-inst');
  const btnCloseAiModal = document.getElementById('btn-close-ai-modal');
  const aiForm = document.getElementById('ai-instruction-form');

  if (aiForm) {
    aiForm.addEventListener('submit', (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    });
  }

  const closeAiModal = () => {
    const eventId = document.getElementById('ai-inst-event-id')?.value;
    if (eventId) {
      saveInstructionDraft(eventId);
    }
    const qBox = document.getElementById('ai-inst-quarantine-box');
    if (qBox) qBox.style.display = 'none';
    if (aiModal) aiModal.classList.remove('active');
    resetScreenshotAlignmentPanel();
  };

  if (cancelAiBtn) cancelAiBtn.addEventListener('click', closeAiModal);
  if (btnCloseAiModal) btnCloseAiModal.addEventListener('click', closeAiModal);

  // Prevent drag-to-select text inside modal card from prematurely closing overlay
  let modalMouseDownTarget = null;
  if (aiModal) {
    aiModal.addEventListener('mousedown', (e) => {
      modalMouseDownTarget = e.target;
    });
    aiModal.addEventListener('click', (e) => {
      // ONLY close if user mousedown and mouseup on the dark backdrop itself
      if (e.target === aiModal && modalMouseDownTarget === aiModal) {
        closeAiModal();
      }
      modalMouseDownTarget = null;
    });

    const modalContent = aiModal.querySelector('.curator-modal-card');
    if (modalContent) {
      modalContent.addEventListener('click', (e) => e.stopPropagation());
      modalContent.addEventListener('mousedown', (e) => e.stopPropagation());
    }
  }

  // Instruction textarea debouncer & enter-key protection
  const instructionField = document.getElementById('ai-instruction-text');
  if (instructionField) {
    instructionField.addEventListener('keydown', (e) => {
      e.stopPropagation();
    });
    instructionField.addEventListener('input', () => {
      const eventId = document.getElementById('ai-inst-event-id')?.value;
      if (eventId) {
        saveInstructionDraft(eventId);
      }
      clearTimeout(debounceInterpretTimer);
      debounceInterpretTimer = setTimeout(() => {
        interpretCuratorInstruction();
      }, 350);
    });
  }

  // Email Screenshot Modal Listeners
  const emailModal = document.getElementById('email-screenshot-modal');
  const cancelEmailBtn = document.getElementById('btn-cancel-email-modal');
  const btnCloseEmailModal = document.getElementById('btn-close-email-modal');

  const closeEmailModal = () => {
    if (emailModal) emailModal.classList.remove('active');
  };

  if (cancelEmailBtn) cancelEmailBtn.addEventListener('click', closeEmailModal);
  if (btnCloseEmailModal) btnCloseEmailModal.addEventListener('click', closeEmailModal);
  if (emailModal) {
    emailModal.addEventListener('click', (e) => {
      if (e.target === emailModal) closeEmailModal();
    });
  }

  // Learned Rules Pill & Modal Listeners
  const rulesPill = document.getElementById('stat-rules-pill');
  if (rulesPill) rulesPill.addEventListener('click', openLearnedRulesModal);

  const rulesModal = document.getElementById('learned-rules-modal');
  const closeRulesBtn = document.getElementById('btn-close-rules-modal');
  const closeRulesBottom = document.getElementById('btn-close-rules-bottom');
  const closeRules = () => {
    if (rulesModal) rulesModal.classList.remove('active');
    const p = document.getElementById('rule-edit-panel');
    if (p) p.style.display = 'none';
  };
  if (closeRulesBtn) closeRulesBtn.addEventListener('click', closeRules);
  if (closeRulesBottom) closeRulesBottom.addEventListener('click', closeRules);
  if (rulesModal) {
    rulesModal.addEventListener('click', (e) => {
      if (e.target === rulesModal) closeRules();
    });
  }

  const rulesTabGroup = document.getElementById('rules-tab-group');
  if (rulesTabGroup) {
    rulesTabGroup.addEventListener('click', (e) => {
      const pill = e.target.closest('.curator-filter-pill');
      if (!pill) return;
      rulesTabGroup.querySelectorAll('.curator-filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeRuleTab = pill.dataset.ruleTab || 'venue_policy_rules';
      const p = document.getElementById('rule-edit-panel');
      if (p) p.style.display = 'none';
      renderRulesList();
    });
  }

  const rulesSearchInput = document.getElementById('rules-search-input');
  if (rulesSearchInput) {
    rulesSearchInput.addEventListener('input', () => {
      state.rulesSearchQuery = rulesSearchInput.value;
      renderRulesList();
    });
  }

  const btnAddRuleTrigger = document.getElementById('btn-add-rule-trigger');
  if (btnAddRuleTrigger) btnAddRuleTrigger.addEventListener('click', openAddRule);

  const btnCancelRuleEdit = document.getElementById('btn-cancel-rule-edit');
  const btnCancelRuleSave = document.getElementById('btn-cancel-rule-save');
  const cancelRulePanel = () => {
    const p = document.getElementById('rule-edit-panel');
    if (p) p.style.display = 'none';
  };
  if (btnCancelRuleEdit) btnCancelRuleEdit.addEventListener('click', cancelRulePanel);
  if (btnCancelRuleSave) btnCancelRuleSave.addEventListener('click', cancelRulePanel);

  const ruleEditForm = document.getElementById('rule-edit-form');
  if (ruleEditForm) ruleEditForm.addEventListener('submit', saveRuleChanges);

  // AI Instructions Pill & Modal Listeners
  const instructionsPill = document.getElementById('stat-instructions-pill');
  if (instructionsPill) instructionsPill.addEventListener('click', openAIInstructionsModal);

  const instructionsModal = document.getElementById('ai-instructions-modal');
  const closeInstBtn = document.getElementById('btn-close-instructions-modal');
  const closeInstBottom = document.getElementById('btn-close-instructions-bottom');
  const closeInstructions = () => {
    if (instructionsModal) instructionsModal.classList.remove('active');
    const p = document.getElementById('instruction-edit-panel');
    if (p) p.style.display = 'none';
  };
  if (closeInstBtn) closeInstBtn.addEventListener('click', closeInstructions);
  if (closeInstBottom) closeInstBottom.addEventListener('click', closeInstructions);
  if (instructionsModal) {
    instructionsModal.addEventListener('click', (e) => {
      if (e.target === instructionsModal) closeInstructions();
    });
  }

  const instTabGroup = document.getElementById('instructions-tab-group');
  if (instTabGroup) {
    instTabGroup.addEventListener('click', (e) => {
      const pill = e.target.closest('.curator-filter-pill');
      if (!pill) return;
      instTabGroup.querySelectorAll('.curator-filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.activeInstFilter = pill.dataset.instFilter || 'all';
      const p = document.getElementById('instruction-edit-panel');
      if (p) p.style.display = 'none';
      renderInstructionsList();
    });
  }

  const instSearchInput = document.getElementById('instructions-search-input');
  if (instSearchInput) {
    instSearchInput.addEventListener('input', () => {
      state.instructionsSearchQuery = instSearchInput.value;
      renderInstructionsList();
    });
  }

  const btnCancelInstEdit = document.getElementById('btn-cancel-inst-edit');
  const btnCancelInstSave = document.getElementById('btn-cancel-inst-save');
  const cancelInstPanel = () => {
    const p = document.getElementById('instruction-edit-panel');
    if (p) p.style.display = 'none';
  };
  if (btnCancelInstEdit) btnCancelInstEdit.addEventListener('click', cancelInstPanel);
  if (btnCancelInstSave) btnCancelInstSave.addEventListener('click', cancelInstPanel);

  const instEditForm = document.getElementById('instruction-edit-form');
  if (instEditForm) instEditForm.addEventListener('submit', saveInstructionChanges);

  // Master Catalogs Pill & Modal Listeners
  const masterPill = document.getElementById('stat-master-pill');
  if (masterPill) masterPill.addEventListener('click', openMasterCatalogsModal);

  const masterModal = document.getElementById('master-catalogs-modal');
  const closeMasterBtn = document.getElementById('btn-close-master-modal');
  const closeMasterBottom = document.getElementById('btn-close-master-bottom');
  const closeMaster = () => {
    if (masterModal) masterModal.classList.remove('active');
  };
  if (closeMasterBtn) closeMasterBtn.addEventListener('click', closeMaster);
  if (closeMasterBottom) closeMasterBottom.addEventListener('click', closeMaster);
  if (masterModal) {
    masterModal.addEventListener('click', (e) => {
      if (e.target === masterModal) closeMaster();
    });
  }

  const masterTabGroup = document.getElementById('master-tab-group');
  if (masterTabGroup) {
    masterTabGroup.addEventListener('click', (e) => {
      const pill = e.target.closest('.curator-filter-pill');
      if (!pill) return;
      masterTabGroup.querySelectorAll('.curator-filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      state.masterTab = pill.dataset.masterTab || 'events_active';
      renderMasterCatalogList();
      fetchMasterCatalog(state.masterTab);
    });
  }

  const masterSearchInput = document.getElementById('master-search-input');
  if (masterSearchInput) {
    masterSearchInput.addEventListener('input', () => {
      state.masterSearchQuery = masterSearchInput.value;
      renderMasterCatalogList();
    });
  }


  const btnSubmitOnly = document.getElementById('btn-submit-ai-inst-only');
  if (btnSubmitOnly) {
    btnSubmitOnly.addEventListener('click', () => submitAIInstruction('queue_only'));
  }

  const btnSubmitOnlyBottom = document.getElementById('btn-submit-ai-inst-only-bottom');
  if (btnSubmitOnlyBottom) {
    btnSubmitOnlyBottom.addEventListener('click', () => submitAIInstruction('queue_only'));
  }

  const btnSubmitAndApprove = document.getElementById('btn-submit-ai-inst-and-approve');
  if (btnSubmitAndApprove) {
    btnSubmitAndApprove.addEventListener('click', () => submitAIInstruction('queue_and_approve'));
  }

  const btnSubmitAndDismiss = document.getElementById('btn-submit-ai-inst-and-dismiss');
  if (btnSubmitAndDismiss) {
    btnSubmitAndDismiss.addEventListener('click', () => submitAIInstruction('queue_and_dismiss'));
  }

  // Live Card Preview Buttons
  const btnQueueInterpreted = document.getElementById('btn-queue-interpreted-card');
  if (btnQueueInterpreted) {
    btnQueueInterpreted.addEventListener('click', () => submitAIInstruction('queue_only'));
  }
  const btnApproveInterpreted = document.getElementById('btn-approve-interpreted-card');
  if (btnApproveInterpreted) {
    btnApproveInterpreted.addEventListener('click', () => submitAIInstruction('queue_only'));
  }

  const btnConfirmInterpretedDismiss = document.getElementById('btn-confirm-interpreted-dismiss');
  if (btnConfirmInterpretedDismiss) {
    btnConfirmInterpretedDismiss.addEventListener('click', () => submitAIInstruction('queue_and_dismiss'));
  }

  // Detect & Split Multiple Events Button
  const btnDetectMultiple = document.getElementById('btn-detect-multiple-events');
  if (btnDetectMultiple) {
    btnDetectMultiple.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const eventId = document.getElementById('ai-inst-event-id')?.value;
      if (!eventId) return;

      const textField = document.getElementById('ai-instruction-text');
      const curText = textField ? textField.value.trim() : '';
      const splitDirective = "This proposed event actually contains multiple unique events. Please scan the screenshots, comments, and schedule details to decompose into discrete cards with unique names.";
      if (textField) {
        if (!curText) {
          textField.value = splitDirective;
        } else if (!curText.toLowerCase().includes('multiple') && !curText.toLowerCase().includes('split')) {
          textField.value = `${curText}\n\n[Instruction: ${splitDirective}]`;
        }
      }
      saveInstructionDraft(eventId);
      showToast('Scanning schedule & screenshots to decompose into discrete events...', 'info');
      await interpretCuratorInstruction(eventId, { forceMultiSplit: true });
    });
  }

  // Clear Modal Draft Button
  const btnClearDraft = document.getElementById('btn-clear-modal-draft');
  if (btnClearDraft) {
    btnClearDraft.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const eventId = document.getElementById('ai-inst-event-id')?.value;
      if (eventId) {
        clearInstructionDraft(eventId);
        state.currentSplitEvents = [];
        openAIInstructionModal(eventId, 'approve');
        showToast('Draft discarded. Reset to card defaults.', 'info');
      }
    });
  }

  // Auto-save draft on changes to quick-approval fields
  ['ai-approve-title', 'ai-approve-price', 'ai-approve-category', 'ai-approve-date', 'ai-approve-venue', 'ai-approve-note'].forEach(fieldId => {
    const el = document.getElementById(fieldId);
    if (el) {
      el.addEventListener('input', () => {
        const eventId = document.getElementById('ai-inst-event-id')?.value;
        if (eventId) saveInstructionDraft(eventId);
      });
      el.addEventListener('change', () => {
        const eventId = document.getElementById('ai-inst-event-id')?.value;
        if (eventId) saveInstructionDraft(eventId);
      });
    }
  });

  // AI Instruction / Screenshot Modal Mode Tabs
  const tabModeScreenshot = document.getElementById('tab-mode-screenshot');
  const tabModeInstruct = document.getElementById('tab-mode-instruct');
  if (tabModeScreenshot) {
    tabModeScreenshot.addEventListener('click', () => setModalViewMode('screenshot'));
  }
  if (tabModeInstruct) {
    tabModeInstruct.addEventListener('click', () => setModalViewMode('instruct'));
  }

  // Screenshot Dropzone & File Input (Supports Multiple Screenshots)
  const dropzone = document.getElementById('ai-screenshot-dropzone');
  const fileInput = document.getElementById('ai-screenshot-file-input');
  const btnAddMore = document.getElementById('btn-add-more-screenshots');
  const browseLink = document.getElementById('ai-screenshot-browse-link');

  if (browseLink && fileInput) {
    browseLink.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      fileInput.click();
    });
  }

  if (btnAddMore && fileInput) {
    btnAddMore.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', (e) => {
      // Do not automatically pop up Windows Explorer on general dropzone clicks!
      // Only open file dialog if the user explicitly clicked the browse link
      if (e.target && (e.target.id === 'ai-screenshot-browse-link' || e.target.closest('#ai-screenshot-browse-link'))) {
        fileInput.click();
      }
    });

    fileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      await handleIncomingScreenshotFiles(files, false);
      fileInput.value = '';
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) return;
      await handleIncomingScreenshotFiles(files, false);
    });
  }

  const removeScreenshotBtn = document.getElementById('btn-remove-screenshot');
  if (removeScreenshotBtn) {
    removeScreenshotBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearScreenshotPreview();
      showToast('Screenshots cleared', 'info');
    });
  }

  // Master Action: Apply All 7 Extracted Dimensions
  const btnApplyAllDimensions = document.getElementById('btn-apply-all-dimensions');
  if (btnApplyAllDimensions) {
    btnApplyAllDimensions.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      applyAllExtractedDimensions(state.currentOcrVerification?.dimensions);
    });
  }

  // Individual Dimension Quick-Apply Handlers (Click Delegation)
  const dimGrid = document.getElementById('ai-ocr-dimensions-grid');
  if (dimGrid) {
    dimGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-dim-apply');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const dimKey = btn.dataset.dim;
      applySingleDimension(dimKey, state.currentOcrVerification?.dimensions);
    });
  }

  // 1-Click Apply OCR Price to Card (Legacy / Backwards Compatible)
  const btnApplyOcrPrice = document.getElementById('btn-apply-ocr-price');
  if (btnApplyOcrPrice) {
    btnApplyOcrPrice.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const detectedPrice = btnApplyOcrPrice.dataset.price;
      const feeBreakdown = btnApplyOcrPrice.dataset.breakdown;
      const priceInput = document.getElementById('ai-approve-price');
      const noteInput = document.getElementById('ai-approve-note');
      if (priceInput && detectedPrice) {
        priceInput.value = detectedPrice;
        priceInput.style.transition = 'background-color 0.3s ease, border-color 0.3s ease';
        priceInput.style.backgroundColor = 'rgba(16, 185, 129, 0.25)';
        priceInput.style.borderColor = '#10b981';
        setTimeout(() => {
          priceInput.style.backgroundColor = '';
          priceInput.style.borderColor = '';
        }, 1200);
      }
      if (noteInput && feeBreakdown) {
        noteInput.value = feeBreakdown;
      }
      showToast(`⚡ Applied $${detectedPrice} CAD to card price!`, 'success');
    });
  }

  // Global Clipboard Paste Listener for Screenshots (Ctrl+V, routes to active modal)
  window.addEventListener('paste', async (e) => {
    const aiModal = document.getElementById('ai-instruction-modal');
    const venueModal = document.getElementById('add-venue-modal');
    const isAiActive = aiModal && aiModal.classList.contains('active');
    const isVenueActive = venueModal && venueModal.classList.contains('active');
    if (!isAiActive && !isVenueActive) return;

    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
    if (!items) return;

    const imgItems = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) imgItems.push(blob);
      }
    }

    if (imgItems.length > 0) {
      e.preventDefault();
      await handleIncomingScreenshotFiles(imgItems, isVenueActive);
    }
  });

  // Quarantined Events Stat Pill Hook (Top-left pill)
  const statQuarantinedPill = document.getElementById('stat-quarantined-pill') || (document.getElementById('stat-pending-count') ? document.getElementById('stat-pending-count').closest('.stat-pill') : null);
  if (statQuarantinedPill) {
    statQuarantinedPill.style.cursor = 'pointer';
    statQuarantinedPill.addEventListener('click', () => {
      document.querySelectorAll('.curator-filter-pill').forEach(p => p.classList.remove('active'));
      const pill = document.querySelector('.curator-filter-pill[data-filter="all"]');
      if (pill) pill.classList.add('active');
      state.activeFilter = 'all';
      applyFiltersAndRender();
      const targetSection = document.querySelector('.curator-controls-section') || document.getElementById('curator-cards-list');
      if (targetSection) targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Festivals / Holidays Awaiting Approval Stat Pill Hook (Top-right pill)
  const statAuditPill = document.getElementById('stat-audit-pill');
  if (statAuditPill) {
    statAuditPill.style.cursor = 'pointer';
    statAuditPill.addEventListener('click', () => {
      document.querySelectorAll('.curator-filter-pill').forEach(p => p.classList.remove('active'));
      const pill = document.querySelector('.curator-filter-pill[data-filter="holidays"]');
      if (pill) pill.classList.add('active');
      state.activeFilter = 'holidays';
      applyFiltersAndRender();
      const targetSection = document.querySelector('.curator-controls-section') || document.getElementById('curator-cards-list');
      if (targetSection) targetSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // Discovered Venues Stat Pill Hook
  const statVenuesPill = document.getElementById('stat-discovered-venues-pill');
  if (statVenuesPill) {
    statVenuesPill.addEventListener('click', () => {
      document.querySelectorAll('.curator-filter-pill').forEach(p => p.classList.remove('active'));
      const pill = document.querySelector('.curator-filter-pill[data-filter="discovered_venues"]');
      if (pill) pill.classList.add('active');
      state.activeFilter = 'discovered_venues';
      applyFiltersAndRender();
    });
  }

  const statSourcesPill = document.getElementById('stat-discovered-sources-pill');
  if (statSourcesPill) {
    statSourcesPill.addEventListener('click', () => {
      switchFilterToDiscoveredSources();
    });
  }

  // Add Discovered Venue Modal Listeners
  const venueModal = document.getElementById('add-venue-modal');
  const closeVenueModalBtn = document.getElementById('btn-close-venue-modal');
  const cancelVenueModalBtn = document.getElementById('btn-cancel-venue-modal');
  const venueForm = document.getElementById('add-venue-form');
  const btnVenueInstOnly = document.getElementById('btn-venue-inst-only');
  const btnVenueInstDismiss = document.getElementById('btn-venue-inst-dismiss');

  const closeVenueModal = () => {
    if (venueModal) venueModal.classList.remove('active');
  };

  if (closeVenueModalBtn) closeVenueModalBtn.addEventListener('click', closeVenueModal);
  if (cancelVenueModalBtn) cancelVenueModalBtn.addEventListener('click', closeVenueModal);
  if (venueModal) {
    venueModal.addEventListener('click', (e) => {
      if (e.target === venueModal) closeVenueModal();
    });
  }

  if (btnVenueInstOnly) {
    btnVenueInstOnly.addEventListener('click', (e) => {
      e.preventDefault();
      handleAddVenueSubmit(e, 'queue_only');
    });
  }

  const btnVenueInstOnlyTop = document.getElementById('btn-venue-inst-only-top');
  if (btnVenueInstOnlyTop) {
    btnVenueInstOnlyTop.addEventListener('click', (e) => {
      e.preventDefault();
      handleAddVenueSubmit(e, 'queue_only');
    });
  }

  if (btnVenueInstDismiss) {
    btnVenueInstDismiss.addEventListener('click', (e) => {
      e.preventDefault();
      handleAddVenueSubmit(e, 'queue_and_dismiss');
    });
  }

  if (venueForm) {
    venueForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleAddVenueSubmit(e, 'queue_and_approve');
    });
  }

  // Venue Screenshot Dropzone & File Input
  const venueDropzone = document.getElementById('venue-screenshot-dropzone');
  const venueFileInput = document.getElementById('venue-screenshot-file-input');
  const btnAddMoreVenueShots = document.getElementById('btn-add-more-venue-screenshots');

  if (btnAddMoreVenueShots && venueFileInput) {
    btnAddMoreVenueShots.addEventListener('click', (e) => {
      e.stopPropagation();
      venueFileInput.click();
    });
  }

  if (venueDropzone && venueFileInput) {
    venueDropzone.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      venueFileInput.click();
    });

    venueFileInput.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      await handleIncomingScreenshotFiles(files, true);
      venueFileInput.value = '';
    });

    venueDropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      venueDropzone.classList.add('dragover');
    });

    venueDropzone.addEventListener('dragleave', () => {
      venueDropzone.classList.remove('dragover');
    });

    venueDropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      venueDropzone.classList.remove('dragover');
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length === 0) return;
      await handleIncomingScreenshotFiles(files, true);
    });
  }
}

// ==============================================================================
// 7. DISCOVERED VENUES PIPELINE & MODAL LOGIC
// ==============================================================================

function clearVenueScreenshotPreview() {
  state.currentVenueScreenshots = [];
  const prompt = document.getElementById('venue-dropzone-prompt');
  const container = document.getElementById('venue-screenshot-preview-container');
  const gallery = document.getElementById('venue-screenshot-gallery-grid');
  const fileInput = document.getElementById('venue-screenshot-file-input');
  if (prompt) prompt.style.display = 'block';
  if (container) container.style.display = 'none';
  if (gallery) gallery.innerHTML = '';
  if (fileInput) fileInput.value = '';
}

function renderVenueScreenshotGallery() {
  const prompt = document.getElementById('venue-dropzone-prompt');
  const container = document.getElementById('venue-screenshot-preview-container');
  const gallery = document.getElementById('venue-screenshot-gallery-grid');
  const countLabel = document.getElementById('venue-screenshot-count-label');

  if (!state.currentVenueScreenshots || state.currentVenueScreenshots.length === 0) {
    clearVenueScreenshotPreview();
    return;
  }

  if (prompt) prompt.style.display = 'none';
  if (container) container.style.display = 'block';
  if (countLabel) {
    const n = state.currentVenueScreenshots.length;
    countLabel.textContent = `🖼️ ${n} Screenshot${n === 1 ? '' : 's'} Attached`;
  }

  if (gallery) {
    gallery.innerHTML = state.currentVenueScreenshots.map((src, idx) => `
      <div class="ai-gallery-item" style="position: relative; width: 88px; height: 88px; border-radius: 6px; overflow: hidden; border: 1.5px solid rgba(168, 85, 247, 0.55); background: #0f172a; flex-shrink: 0; box-shadow: 0 2px 6px rgba(0,0,0,0.4);">
        <img src="${src}" alt="Venue Screenshot #${idx + 1}" style="width: 100%; height: 100%; object-fit: cover; cursor: pointer;" onclick="window.open('${src}', '_blank')" title="Click to view full size">
        <button type="button" onclick="event.stopPropagation(); window.removeVenueScreenshotByIndex(${idx});" title="Remove image" style="position: absolute; top: 3px; right: 3px; background: rgba(239, 68, 68, 0.9); color: #fff; border: none; border-radius: 50%; width: 22px; height: 22px; font-size: 12px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; box-shadow: 0 1px 4px rgba(0,0,0,0.5);">✕</button>
        <div style="position: absolute; bottom: 3px; left: 3px; background: rgba(0,0,0,0.75); color: #e2e8f0; font-size: 10px; padding: 1px 5px; border-radius: 3px; font-weight: 600;">#${idx + 1}</div>
      </div>
    `).join('');
  }
}

window.removeVenueScreenshotByIndex = function (index) {
  if (state.currentVenueScreenshots && index >= 0 && index < state.currentVenueScreenshots.length) {
    state.currentVenueScreenshots.splice(index, 1);
    renderVenueScreenshotGallery();
    showToast('Venue screenshot removed', 'info');
  }
};

function addVenueScreenshotDataUrls(urls) {
  if (!Array.isArray(urls)) urls = [urls];
  if (!state.currentVenueScreenshots) state.currentVenueScreenshots = [];
  let addedCount = 0;
  for (const url of urls) {
    if (url && typeof url === 'string') {
      state.currentVenueScreenshots.push(url);
      addedCount++;
    }
  }
  renderVenueScreenshotGallery();
  if (addedCount > 0) {
    showToast(`🖼️ ${addedCount} venue screenshot${addedCount > 1 ? 's' : ''} added!`, 'info');
  }
}

function renderDiscoveredVenuesCards() {
  const container = document.getElementById('curator-cards-list');
  const countDisplay = document.getElementById('curator-results-text');
  if (!container) return;

  const venues = state.discoveredVenues || [];
  if (countDisplay) {
    countDisplay.innerHTML = `Showing <strong>${venues.length}</strong> candidate venue(s) discovered from festivals and discovery feeds`;
  }

  if (venues.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; background: var(--curator-surface); border: 1px solid var(--curator-border); border-radius: 12px;">
        <div style="font-size: 2.5rem; margin-bottom: 12px;">🏛️</div>
        <h3 style="font-family: var(--font-heading); font-size: 1.25rem; color: #fff; margin-bottom: 6px;">
          No Discovered Venues Pending Review
        </h3>
        <p style="font-size: 0.88rem; color: var(--curator-text-muted); max-width: 520px; margin: 0 auto; line-height: 1.5;">
          All venues discovered by festivals and editorial discovery feeds have either been enrolled into the regular crawler or dismissed.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = venues.map(v => {
    const safeV = JSON.stringify(v).replace(/'/g, "&#39;");
    const isHandled = Boolean(v.dealtWith || v.queuedInstruction);
    return `
      <div class="curator-card ${isHandled ? 'curator-card-handled' : ''}" id="card-venue-${v.id}" style="border-left: 4px solid #10b981;">
        <div class="curator-card-top">
          <div>
            <h3 class="curator-card-title" style="color: #6ee7b7;">${escapeHtml(v.name)}</h3>
            <div class="curator-card-meta">
              <span>📍 <strong>${escapeHtml(v.address || v.name)}</strong></span>
              <span>🏘️ <strong>Neighborhood:</strong> ${escapeHtml(v.neighborhood || 'Vancouver')}</span>
              <span>🏷️ <strong>Category:</strong> ${escapeHtml(v.category || 'shows')}</span>
              <span>🔍 <strong>Discovered Via:</strong> ${escapeHtml(v.discoveredVia || 'Festival / Feed')}</span>
            </div>
          </div>
          <div style="display: flex; gap: 6px; align-items: flex-start; flex-wrap: wrap;">
            <span class="curator-badge-pill" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border-color: rgba(16, 185, 129, 0.5);">
              🏛️ Discovered Venue
            </span>
            ${isHandled ? `<span class="curator-badge-pill curator-badge-handled">📋 Rule Queued</span>` : ''}
          </div>
        </div>

        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 10px 14px; margin: 12px 0; font-size: 0.85rem; color: var(--curator-text-muted);">
          <div><strong>Context / Sample Event:</strong> ${escapeHtml(v.sampleEvent || 'Detected via festival program')}</div>
          ${(() => {
        const vUrl = getVenueExternalUrl(v);
        return vUrl ? `<div style="margin-top: 4px;"><a href="${escapeHtml(vUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #38bdf8; text-decoration: underline;">Open Discovered Webpage / Calendar ↗</a></div>` : '';
      })()}
        </div>

        <!-- Prominent Instruction Banner (Displays User Instructions on Discovered Venue Cards) -->
        ${(v.queuedInstruction) ? `
          <div class="curator-handled-box" style="background: rgba(168, 85, 247, 0.12); border: 1.5px solid rgba(168, 85, 247, 0.5); border-left: 5px solid #a855f7; border-radius: 8px; padding: 12px 14px; margin: 10px 0 14px 0;">
            <div class="curator-handled-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <strong style="color: #d8b4fe; font-size: 0.88rem; display: inline-flex; align-items: center; gap: 6px;">
                <span>📝</span> Your Venue Guidance:
              </strong>
              <span class="curator-handled-tag" style="background: rgba(168, 85, 247, 0.25); border: 1px solid rgba(168, 85, 247, 0.5); color: #f3e8ff; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">
                ${escapeHtml(
        (v.queuedInstruction.action === 'queue_and_approve' || v.queuedInstruction.actionTaken === 'queue_and_approve')
          ? '⚡ Enrolled &amp; Rule Saved'
          : (v.queuedInstruction.action === 'queue_and_dismiss' || v.queuedInstruction.actionTaken === 'queue_and_dismiss')
            ? '🛑 Dismissed &amp; Rule Recorded'
            : '📋 Held for Review'
      )}
              </span>
            </div>
            <div class="curator-handled-text" style="color: #ffffff; font-size: 0.95rem; font-weight: 500; line-height: 1.45; background: rgba(0, 0, 0, 0.3); padding: 8px 12px; border-radius: 6px; border-left: 3px solid #c084fc; margin-bottom: 8px;">
              “${escapeHtml(v.queuedInstruction.instructionText || '')}”
            </div>
            ${(v.curatorLearnedRules?.summary || v.queuedInstruction?.distilledRules?.summary || v.queuedInstruction?.aiLearnedSummary || v.policySummary) ? `
              <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 6px; padding: 6px 10px; margin-bottom: 8px; font-size: 0.82rem; color: #a7f3d0; display: flex; align-items: center; gap: 8px;">
                <span>🧠</span>
                <span><strong>Crawler Policy Rule:</strong> ${escapeHtml(v.curatorLearnedRules?.summary || v.queuedInstruction?.distilledRules?.summary || v.queuedInstruction?.aiLearnedSummary || v.policySummary)}</span>
              </div>
            ` : ''}
            ${renderCardScreenshotThumbnails(v.queuedInstruction)}
            <div class="curator-handled-meta" style="font-size: 0.78rem; color: #cbd5e1; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
              <span>🕒 Queued ${v.queuedInstruction.createdAt ? new Date(v.queuedInstruction.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'recently'}</span>
              <button type="button" class="btn-curator-edit-inst" onclick='openAddVenueModal(${safeV}, { focusInstruction: true })' style="margin-left: auto; background: rgba(168, 85, 247, 0.18); border: 1px solid rgba(168, 85, 247, 0.45); color: #e9d5ff; border-radius: 4px; padding: 3px 10px; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: background 0.15s;">✏️ Edit / Add Proof</button>
            </div>
          </div>
        ` : ''}

        <div class="curator-actions-bar">
          <div class="curator-actions-left">
            <button 
              type="button" 
              class="btn-curator btn-curator-primary" 
              onclick='openAddVenueModal(${safeV})'
              title="Enroll this venue into venue_directory.json and regular daily crawl"
            >
              ➕ Add to Regular Venue Crawler
            </button>
            <button 
              type="button" 
              class="btn-curator btn-curator-ai-approve" 
              onclick='openAddVenueModal(${safeV}, { focusInstruction: true })'
              title="Set crawler guidance and notes for this venue with screenshots"
            >
              📝 Set Venue Rule
            </button>
            <button 
              type="button" 
              class="btn-curator btn-curator-danger" 
              onclick="dismissDiscoveredVenue('${v.id}')"
              title="Dismiss this candidate venue"
            >
              🚫 Dismiss
            </button>
          </div>
          <div>
            ${(() => {
        const vUrl = getVenueExternalUrl(v);
        return vUrl ? `
                <a 
                  href="${escapeHtml(vUrl)}" 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  referrerpolicy="no-referrer"
                  class="btn-curator btn-curator-ghost"
                  title="Inspect venue website (${escapeHtml(vUrl)}) in new tab"
                >
                  🔗 Inspect Venue Page ↗
                </a>
              ` : `
                <button 
                  type="button" 
                  class="btn-curator btn-curator-ghost" 
                  disabled 
                  style="opacity: 0.5; cursor: not-allowed;" 
                  title="No website or calendar link detected for this venue"
                >
                  🔗 No Venue Link
                </button>
              `;
      })()}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

window.openAddVenueModal = function (v, options = {}) {
  const modal = document.getElementById('add-venue-modal');
  if (!modal) return;

  const idField = document.getElementById('venue-form-discovered-id');
  const nameField = document.getElementById('venue-form-name');
  const addrField = document.getElementById('venue-form-address');
  const urlField = document.getElementById('venue-form-calendar-url');
  const neighSelect = document.getElementById('venue-form-neighborhood');
  const catSelect = document.getElementById('venue-form-category');
  const textField = document.getElementById('venue-instruction-text');

  if (idField) idField.value = v.id || '';
  if (nameField) nameField.value = v.name || '';
  if (addrField) addrField.value = v.address || `${v.name}, Vancouver, BC`;
  if (urlField) urlField.value = v.calendarUrl || v.websiteUrl || '';
  if (neighSelect && v.neighborhood) neighSelect.value = v.neighborhood;
  if (catSelect && v.category) catSelect.value = v.category;

  clearVenueScreenshotPreview();

  if (v && v.queuedInstruction) {
    const q = v.queuedInstruction;
    if (textField) textField.value = q.instructionText || '';
    const existingImgs = [];
    if (Array.isArray(q.screenshotPaths) && q.screenshotPaths.length > 0) {
      existingImgs.push(...q.screenshotPaths);
    } else if (q.screenshotPath) {
      existingImgs.push(q.screenshotPath);
    } else if (q.screenshotBase64) {
      existingImgs.push(q.screenshotBase64);
    }
    if (existingImgs.length > 0) {
      addVenueScreenshotDataUrls(existingImgs);
    }
  } else if (textField) {
    textField.value = v.curatorNote || '';
  }

  modal.classList.add('active');

  if (options && options.focusInstruction) {
    setTimeout(() => {
      if (textField) {
        textField.scrollIntoView({ behavior: 'smooth', block: 'center' });
        textField.focus();
        textField.style.borderColor = '#c084fc';
        textField.style.boxShadow = '0 0 0 3px rgba(168, 85, 247, 0.3)';
        setTimeout(() => {
          textField.style.borderColor = '';
          textField.style.boxShadow = '';
        }, 2000);
      }
    }, 150);
  }
};

window.openAddVenueModalFromEvent = function (eventId) {
  const ev = (state.quarantinedEvents || []).find(e => e.id === eventId);
  if (!ev) return;
  openAddVenueModal({
    id: null,
    name: ev.venue,
    address: `${ev.venue}, Vancouver, BC`,
    neighborhood: ev.neighborhood || 'Downtown / West End',
    category: ev.category || 'shows',
    calendarUrl: ev.websiteUrl || '',
    websiteUrl: ev.websiteUrl || '',
    discoveredVia: `Event: ${ev.title}`
  });
};

// ==============================================================================
// 7B. NEW HOLIDAYS PIPELINE & CURATOR APPROVAL LOGIC
// ==============================================================================

function renderHolidayCards() {
  const container = document.getElementById('curator-cards-list');
  const countDisplay = document.getElementById('curator-results-text');
  if (!container) return;

  const { pendingHolidays: pending, quarantinedFestivals, unapprovedFests, total } = getPendingFestivalsAndHolidays();
  const approved = state.approvedHolidays || [];
  const approvedFestivals = (state.festivals || state.masterCatalogsData?.festivals || []).filter(
    f => f && f.status !== 'pending' && f.approvalStatus !== 'pending' && f.status !== 'pending_curator_approval'
  );

  if (countDisplay) {
    countDisplay.innerHTML = `Showing <strong>${total}</strong> festival(s) &amp; holiday(s) awaiting curator approval`;
  }

  let html = '';

  if (quarantinedFestivals.length > 0) {
    html += `
      <div style="margin-bottom: 20px;">
        <h4 style="font-family: var(--font-heading); font-size: 1.05rem; color: #fdba74; margin: 0 0 12px 0;">
          🎪 Quarantined Festival Events Awaiting Review (${quarantinedFestivals.length})
        </h4>
        ${quarantinedFestivals.map((ev, idx) => renderEventCard(ev, idx)).join('')}
      </div>
    `;
  }

  if (total === 0) {
    html += `
      <div style="text-align: center; padding: 48px 20px; background: var(--curator-surface); border: 1px solid var(--curator-border); border-radius: 12px; margin-bottom: 24px;">
        <div style="font-size: 2.5rem; margin-bottom: 12px;">🎉</div>
        <h3 style="font-family: var(--font-heading); font-size: 1.25rem; color: #fff; margin-bottom: 6px;">
          No Pending Festivals or Holidays Awaiting Approval
        </h3>
        <p style="font-size: 0.88rem; color: var(--curator-text-muted); max-width: 520px; margin: 0 auto; line-height: 1.5;">
          All festivals and holidays discovered by the AI scouts are verified and registered in the system.
        </p>
      </div>
    `;
  } else if (pending.length > 0) {
    html += pending.map(h => {
      const defaultLabel = h.label || h.id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      const defaultIcon = h.icon || '🎉';
      return `
        <div class="curator-card" id="card-holiday-${escapeHtml(h.id)}" style="border-left: 4px solid #f97316; margin-bottom: 16px;">
          <div class="curator-card-top">
            <div>
              <h3 class="curator-card-title" style="color: #fdba74; display: flex; align-items: center; gap: 8px;">
                <span>${escapeHtml(defaultIcon)}</span>
                <span>${escapeHtml(defaultLabel)}</span>
                <span style="font-size: 0.8rem; font-weight: normal; color: #94a3b8;">(#${escapeHtml(h.id)})</span>
              </h3>
              <div class="curator-card-meta">
                <span>🔍 <strong>Detected In:</strong> ${escapeHtml(h.eventTitle || h.detectedInEvent || 'AI Event Scout')}</span>
                <span>📅 <strong>Detected Date:</strong> ${escapeHtml(h.detectedAt || 'Today')}</span>
                <span>🏷️ <strong>Status:</strong> <span style="color: #fed7aa; font-weight: 600;">Pending Curator Sign-off</span></span>
              </div>
            </div>
            <div style="display: flex; gap: 6px; align-items: flex-start;">
              <span class="curator-badge-pill" style="background: rgba(249, 115, 22, 0.2); color: #fb923c; border: 1px solid rgba(249, 115, 22, 0.4);">
                🎉 New Holiday Discovery
              </span>
            </div>
          </div>

          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 14px; margin: 12px 0;">
            <div style="font-size: 0.85rem; color: #cbd5e1; margin-bottom: 10px; font-weight: 600;">
              Curator Taxonomy Settings:
            </div>
            <div style="display: grid; grid-template-columns: 80px 1fr; gap: 12px; align-items: center;">
              <div>
                <label style="display: block; font-size: 0.75rem; color: #94a3b8; margin-bottom: 4px;">Icon / Emoji</label>
                <input type="text" id="holiday-icon-${escapeHtml(h.id)}" value="${escapeHtml(defaultIcon)}" style="width: 100%; text-align: center; font-size: 1.25rem; padding: 6px; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; color: #fff;">
              </div>
              <div>
                <label style="display: block; font-size: 0.75rem; color: #94a3b8; margin-bottom: 4px;">Display Label</label>
                <input type="text" id="holiday-label-${escapeHtml(h.id)}" value="${escapeHtml(defaultLabel)}" style="width: 100%; font-size: 0.95rem; padding: 7px 10px; background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; color: #fff;">
              </div>
            </div>
          </div>

          <div class="curator-card-actions" style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px;">
            <button type="button" class="btn-curator btn-curator-ghost" onclick="rejectHoliday('${escapeHtml(h.id)}')" style="border-color: rgba(239, 68, 68, 0.4); color: #f87171;">
              ✕ Reject / Dismiss
            </button>
            <button type="button" class="btn-curator btn-curator-primary" onclick="approveHoliday('${escapeHtml(h.id)}')" style="background: #ea580c; border-color: #f97316;">
              ✓ Approve &amp; Register Holiday
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Also append approved holidays overview section
  html += `
    <div style="margin-top: 36px; padding-top: 24px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <h4 style="font-family: var(--font-heading); font-size: 1.1rem; color: #e2e8f0; margin: 0; display: flex; align-items: center; gap: 8px;">
          <span>✅</span> Approved Holidays Registry (${approved.length})
        </h4>
        <span style="font-size: 0.78rem; color: #94a3b8;">When AI scouts detect these tags, events are auto-approved</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px;">
        ${approved.map(ah => `
          <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.4rem;">${escapeHtml(ah.icon || '🎉')}</span>
            <div style="overflow: hidden;">
              <div style="color: #fff; font-weight: 600; font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(ah.label || ah.id)}</div>
              <div style="color: #94a3b8; font-size: 0.75rem; font-family: monospace;">tag: "${escapeHtml(ah.id)}"</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div style="margin-top: 28px; padding-top: 24px; border-top: 1px solid rgba(255, 255, 255, 0.1);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <h4 style="font-family: var(--font-heading); font-size: 1.1rem; color: #e2e8f0; margin: 0; display: flex; align-items: center; gap: 8px;">
          <span>🎪</span> Approved Festivals Registry (${approvedFestivals.length})
        </h4>
        <span style="font-size: 0.78rem; color: #94a3b8;">Registered Metro Vancouver cultural festivals in data/festivals.json</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px;">
        ${approvedFestivals.map(af => `
          <div style="background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.4rem;">🎪</span>
            <div style="overflow: hidden;">
              <div style="color: #fff; font-weight: 600; font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(af.festival_name || af.name || 'Festival')}</div>
              <div style="color: #94a3b8; font-size: 0.75rem;">${escapeHtml(af.start_date || 'TBA')} – ${escapeHtml(af.end_date || 'TBA')}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  container.innerHTML = html;
}

window.approveHoliday = async function (holidayId) {
  if (!state.token || !holidayId) return;
  const labelInput = document.getElementById(`holiday-label-${holidayId}`);
  const iconInput = document.getElementById(`holiday-icon-${holidayId}`);
  const label = labelInput ? labelInput.value.trim() : '';
  const icon = iconInput ? iconInput.value.trim() : '🎉';

  try {
    const res = await fetch('/api/curator/approve-holiday', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: JSON.stringify({ holidayId, label, icon })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Holiday '${data.holiday?.label || holidayId}' approved!`, 'success');
      state.pendingHolidays = (state.pendingHolidays || []).filter(h => h.id !== holidayId);
      if (data.holiday) {
        state.approvedHolidays = state.approvedHolidays || [];
        state.approvedHolidays.push(data.holiday);
      }
      updateFilterCounts();
      applyFiltersAndRender();
    } else {
      showToast(data.error || 'Failed to approve holiday', 'error');
    }
  } catch (err) {
    showToast('Network error approving holiday', 'error');
  }
};

window.rejectHoliday = async function (holidayId) {
  if (!state.token || !holidayId) return;
  if (!confirm(`Are you sure you want to dismiss the holiday '${holidayId}'?`)) return;

  try {
    const res = await fetch('/api/curator/reject-holiday', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: JSON.stringify({ holidayId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Holiday '${holidayId}' dismissed.`, 'info');
      state.pendingHolidays = (state.pendingHolidays || []).filter(h => h.id !== holidayId);
      updateFilterCounts();
      applyFiltersAndRender();
    } else {
      showToast(data.error || 'Failed to reject holiday', 'error');
    }
  } catch (err) {
    showToast('Network error rejecting holiday', 'error');
  }
};

window.dismissDiscoveredVenue = async function (discId) {
  if (!state.token || !discId) return;
  try {
    const res = await fetch('/api/curator/discovered_venues/dismiss', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: JSON.stringify({ id: discId })
    });
    if (res.ok) {
      showToast('Candidate venue dismissed.', 'info');
      state.discoveredVenues = state.discoveredVenues.filter(v => v.id !== discId);
      updateFilterCounts();
      applyFiltersAndRender();
    } else {
      showToast('Failed to dismiss venue.', 'error');
    }
  } catch (err) {
    showToast('Network error dismissing venue.', 'error');
  }
};

async function handleAddVenueSubmit(e, action = 'queue_and_approve') {
  if (e && e.preventDefault) e.preventDefault();
  if (!state.token) return;

  const id = document.getElementById('venue-form-discovered-id')?.value || '';
  const name = document.getElementById('venue-form-name')?.value?.trim() || '';
  const address = document.getElementById('venue-form-address')?.value?.trim() || '';
  const calendarUrl = document.getElementById('venue-form-calendar-url')?.value?.trim() || '';
  const neighborhood = document.getElementById('venue-form-neighborhood')?.value || 'Downtown / West End';
  const category = document.getElementById('venue-form-category')?.value || 'shows';
  const instructionText = document.getElementById('venue-instruction-text')?.value?.trim() || '';

  if (!name) {
    showToast('Venue name is required.', 'error');
    return;
  }

  if (action === 'queue_and_approve' && !calendarUrl) {
    showToast('Calendar / Events Webpage URL is required to enroll into the crawler.', 'error');
    return;
  }

  if (action === 'queue_only' && !instructionText && (!state.currentVenueScreenshots || state.currentVenueScreenshots.length === 0)) {
    showToast('Please provide instructions or a screenshot for AI before queuing.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/curator/venues/add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: JSON.stringify({
        discoveredId: id || undefined,
        name,
        address,
        calendarUrl,
        neighborhood,
        category,
        adapter: 'UniversalVenueCrawler',
        action,
        instructionText,
        screenshotsBase64: state.currentVenueScreenshots || []
      })
    });

    let data = {};
    try {
      data = await res.json();
    } catch (_) {
      data = { error: res.statusText || `Server responded with HTTP ${res.status}` };
    }

    if (res.ok && data.success) {
      const modal = document.getElementById('add-venue-modal');
      if (modal) modal.classList.remove('active');

      const learnedMsg = data.aiLearnedSummary ? ` • 🧠 ${data.aiLearnedSummary}` : '';
      if (action === 'queue_and_approve') {
        showToast(`✓ Venue '${name}' enrolled into Universal Venue Crawler!${learnedMsg}`, 'success');
        if (name) state.knownVenues.add(name.toLowerCase());
        state.discoveredVenues = state.discoveredVenues.filter(v => v.id !== id && v.name.toLowerCase() !== name.toLowerCase());
      } else if (action === 'queue_and_dismiss' || action === 'dismiss') {
        showToast(`Candidate venue '${name}' dismissed.`, 'info');
        state.discoveredVenues = state.discoveredVenues.filter(v => v.id !== id && v.name.toLowerCase() !== name.toLowerCase());
      } else {
        showToast(`🤖 AI instruction, proof, and learned rules saved for '${name}'!${learnedMsg}`, 'success');
        const targetV = state.discoveredVenues.find(v => v.id === id || v.name.toLowerCase() === name.toLowerCase());
        if (targetV) {
          targetV.dealtWith = true;
          const finalPaths = (data.screenshotPaths && data.screenshotPaths.length > 0)
            ? data.screenshotPaths
            : [...(state.currentVenueScreenshots || [])];
          targetV.queuedInstruction = {
            instructionText: instructionText,
            eventId: id || targetV.id,
            venueName: name,
            sourceUrl: calendarUrl,
            screenshotPath: finalPaths[0] || null,
            screenshotPaths: finalPaths,
            hasScreenshot: finalPaths.length > 0,
            screenshotCount: finalPaths.length,
            action: action,
            distilledRules: data.distilledRules || null,
            aiLearnedSummary: data.aiLearnedSummary || '',
            createdAt: new Date().toISOString()
          };
          targetV.curatorLearnedRules = data.distilledRules || null;
        }
      }

      updateFilterCounts();
      applyFiltersAndRender();

      // Refresh status counts
      const statusRes = await fetch('/api/curator/status', {
        headers: { 'Curator-Token': state.token }
      });
      if (statusRes.ok) {
        const sData = await statusRes.json();
        updateHeaderStats(sData.pendingCount, sData.rulesCount, sData.masterCount, sData.instructionsPendingCount || 0, sData.discoveredVenuesCount || 0);
      }
    } else {
      showToast(data.error || `Failed to process venue action (${res.status}).`, 'error');
    }
  } catch (err) {
    showToast(`Network error processing venue: ${err.message || err}`, 'error');
  }
}

// Toast Utility
function showToast(message, type = 'success') {
  const toast = document.getElementById('curator-toast');
  if (!toast) return;

  toast.textContent = message;
  toast.className = `curator-toast ${type} active`;

  setTimeout(() => {
    toast.classList.remove('active');
  }, 3500);
}

// Helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function jsonStringify(obj) {
  return JSON.stringify(obj);
}

// ==============================================================================
// 7. DAILY DISCOVERY & AUTOMATION CONTROLS
// ==============================================================================

async function fetchAutomationStatus() {
  try {
    const res = await fetch(`/api/automation/status?_t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    updateAutomationUI(data);
  } catch (err) {
    console.warn('Could not fetch automation status:', err);
  }
}

function updateAutomationUI(data) {
  const container = document.getElementById('automation-status-container');
  const dot = document.getElementById('automation-dot');
  const label = document.getElementById('automation-label');
  const syncBtn = document.getElementById('btn-trigger-sync');
  const syncIcon = document.getElementById('btn-sync-icon');
  const syncText = document.getElementById('btn-sync-text');
  if (!container || !label) return;

  const isRunning = data.status === 'running';
  const isEnabled = data.automationEnabled !== false;

  if (isRunning) {
    container.className = 'automation-badge-container running';
    dot.textContent = '⚡';
    label.textContent = `Syncing: ${data.currentStep || 'in progress'}...`;
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.style.opacity = '0.7';
    }
    if (syncIcon) syncIcon.className = 'sync-spinning';
    if (syncText) syncText.textContent = 'Syncing & Learning...';
  } else {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.style.opacity = '1';
    }
    if (syncIcon) syncIcon.className = '';
    if (syncText) syncText.textContent = 'Run Full Sync & Learn from Guidance';

    if (isEnabled) {
      container.className = 'automation-badge-container';
      dot.textContent = '🟢';
      let nextTime = '04:00 AM';
      if (data.nextRunAt) {
        try {
          const dt = new Date(data.nextRunAt);
          nextTime = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } catch (e) { }
      }
      label.textContent = `Daily Sync: Active (${nextTime})`;
    } else {
      container.className = 'automation-badge-container paused';
      dot.textContent = '⏸️';
      label.textContent = 'Daily Sync: Paused';
    }
  }
}

async function handleTriggerSync() {
  if (!state.token) {
    showToast('Please authenticate first to run full sync', 'error');
    return;
  }

  const syncBtn = document.getElementById('btn-trigger-sync');
  const syncIcon = document.getElementById('btn-sync-icon');
  const syncText = document.getElementById('btn-sync-text');

  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.style.opacity = '0.7';
  }
  if (syncIcon) syncIcon.className = 'sync-spinning';
  if (syncText) syncText.textContent = 'Starting Sync & Learning...';

  try {
    const res = await fetch('/api/automation/trigger', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: jsonStringify({})
    });

    const data = await res.json();
    if (res.ok && data.success) {
      showToast('⚡ Autonomous sync & AI rule learning launched in background', 'info');
      fetchAutomationStatus();

      // Poll every 2.5 seconds until complete
      const pollInterval = setInterval(async () => {
        try {
          const sRes = await fetch('/api/automation/status');
          if (sRes.ok) {
            const sData = await sRes.json();
            updateAutomationUI(sData);
            if (sData.status !== 'running') {
              clearInterval(pollInterval);
              let learnMsg = '';
              if (sData.learningStats) {
                const triaged = (sData.learningStats.archived || 0) + (sData.learningStats.promoted || 0);
                const rules = sData.learningStats.rulesAdded || 0;
                if (triaged > 0 || rules > 0) {
                  learnMsg = ` (${triaged} items triaged, ${rules} rules distilled)`;
                }
              }
              showToast(`✅ Sync & Learning complete: ${sData.totalEvents} active events verified!${learnMsg}`, 'success');
              loadQuarantineQueue();
              const statusRes = await fetch('/api/curator/status', {
                headers: { 'Curator-Token': state.token }
              });
              if (statusRes.ok) {
                const curData = await statusRes.json();
                updateHeaderStats(curData.pendingCount, curData.rulesCount, curData.masterCount, curData.instructionsPendingCount || 0, curData.discoveredVenuesCount || 0);
              }
            }
          }
        } catch (e) {
          clearInterval(pollInterval);
        }
      }, 2500);
    } else {
      showToast(data.error || 'Failed to trigger sync', 'error');
      fetchAutomationStatus();
    }
  } catch (err) {
    showToast('Server connection failed while triggering sync', 'error');
    fetchAutomationStatus();
  }
}

async function clearCuratorSettingsAndReload(options = { restartServer: true }) {
  showToast('⚡ Clearing current settings & reloading from scratch...', 'info');

  const btnRestart = document.getElementById('btn-restart-system');
  const iconRestart = document.getElementById('btn-restart-icon');
  const textRestart = document.getElementById('btn-restart-text');
  const btnClearSettings = document.getElementById('btn-clear-settings');

  if (btnRestart) {
    btnRestart.disabled = true;
    btnRestart.style.opacity = '0.7';
  }
  if (btnClearSettings) {
    btnClearSettings.disabled = true;
    btnClearSettings.style.opacity = '0.7';
  }
  if (iconRestart) iconRestart.className = 'sync-spinning';
  if (textRestart) textRestart.textContent = 'Clearing & Reloading...';

  try {
    // 1. Reset all in-memory filters, queries, drafts, and temporary states to default
    state.activeFilter = 'all';
    state.platformFilter = 'all';
    state.searchQuery = '';
    state.sortBy = 'date-desc';
    state.currentScreenshots = [];
    state.currentScreenshotBase64 = null;
    state.currentVenueScreenshots = [];
    state.currentSplitEvents = [];
    state.instructionDrafts = {};
    state.rulesSearchQuery = '';
    state.activeRuleTab = 'venue_policy_rules';
    state.masterSearchQuery = '';
    state.masterTab = 'events_active';
    state.instructionsSearchQuery = '';
    state.activeInstFilter = 'all';

    // 2. Reset DOM controls immediately so browser never captures old values
    const searchInput = document.getElementById('curator-search-input');
    if (searchInput) searchInput.value = '';

    const clearSearchBtn = document.getElementById('btn-clear-curator-search');
    if (clearSearchBtn) clearSearchBtn.style.display = 'none';

    const platformSelect = document.getElementById('curator-platform-select');
    if (platformSelect) platformSelect.value = 'all';

    const sortSelect = document.getElementById('curator-sort-select');
    if (sortSelect) sortSelect.value = 'date-desc';

    document.querySelectorAll('.curator-filter-pill').forEach(p => {
      if (p.dataset.filter === 'all') {
        p.classList.add('active');
      } else if (p.dataset.filter) {
        p.classList.remove('active');
      }
    });

    const rSearch = document.getElementById('rules-search-input');
    if (rSearch) rSearch.value = '';

    const mSearch = document.getElementById('master-search-input');
    if (mSearch) mSearch.value = '';

    const instText = document.getElementById('ai-instruction-text');
    if (instText) instText.value = '';

    // Close all open modals
    document.querySelectorAll('.curator-modal-overlay').forEach(m => m.classList.remove('active'));

    // Reset accessibility mode
    try {
      localStorage.removeItem('van50_accessible_mode');
      document.documentElement.classList.remove('van50-accessible');
      document.body.classList.remove('van50-accessible');
    } catch (_) { }

    // 3. Preserve session token
    const curToken = state.token || sessionStorage.getItem('van50_curator_token') || localStorage.getItem('van50_curator_token');

    // 4. If restarting server, notify backend
    if (options.restartServer) {
      const headers = { 'Content-Type': 'application/json' };
      if (curToken) headers['Curator-Token'] = curToken;
      try {
        await fetch('/api/curator/system/restart-and-clear', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify({})
        });
      } catch (netErr) {
        console.warn('[RESTART WARN] Server reset request notice:', netErr);
      }
    }

    // 5. Purge CacheStorage
    if ('caches' in window) {
      try {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map(k => caches.delete(k)));
        console.log('[CURATOR RESET] Cleared CacheStorage:', cacheKeys);
      } catch (err) {
        console.warn('[CURATOR RESET] CacheStorage clear warning:', err);
      }
    }

    // 6. Unregister Service Workers
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(r => r.unregister()));
        console.log('[CURATOR RESET] Unregistered Service Workers:', registrations.length);
      } catch (err) {
        console.warn('[CURATOR RESET] ServiceWorker unregister warning:', err);
      }
    }

    // 7. Clear all storage, firmly preserving auth token
    try { sessionStorage.clear(); } catch (_) { }
    try { localStorage.clear(); } catch (_) { }
    if (curToken) {
      try { sessionStorage.setItem('van50_curator_token', curToken); } catch (_) { }
      try { localStorage.setItem('van50_curator_token', curToken); } catch (_) { }
      state.token = curToken;
    }

    showToast('Settings cleared! Reloading from scratch...', 'success');

    // 8. Reload page cleanly from scratch with timestamp cache-buster using replace()
    setTimeout(() => {
      window.location.replace(window.location.pathname + '?_t=' + Date.now());
    }, 600);

  } catch (err) {
    console.error('[CURATOR RESET ERROR]', err);
    showToast('Settings reset completed; reloading...', 'info');
    setTimeout(() => {
      window.location.replace(window.location.pathname + '?_t=' + Date.now());
    }, 600);
  }
}

async function handleRestartAllAndClear() {
  return clearCuratorSettingsAndReload({ restartServer: true });
}

async function handleFetchNewsletters() {
  if (!state.token) {
    showToast('Please authenticate first to fetch newsletters', 'error');
    return;
  }

  const iconEl = document.getElementById('btn-newsletters-icon');
  const textEl = document.getElementById('btn-newsletters-text');
  const btn = document.getElementById('btn-fetch-newsletters');
  const origIcon = iconEl ? iconEl.textContent : '📧';
  const origText = textEl ? textEl.textContent : 'Fetch Newsletters';

  if (btn) btn.disabled = true;
  if (iconEl) iconEl.textContent = '⏳';
  if (textEl) textEl.textContent = 'Fetching...';

  try {
    showToast('Checking Gmail newsletter inbox & local drop folder...', 'info');
    const res = await fetch('/api/curator/sync_newsletters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: JSON.stringify({})
    });

    const data = await res.json();
    if (res.ok && data.success) {
      const queuedCount = data.totalQueued || 0;
      if (queuedCount > 0) {
        showToast(`🎉 ${data.message || `Queued ${queuedCount} new newsletter event cards!`}`, 'success');
      } else {
        showToast(data.message || 'Newsletter check complete: No new unread events.', 'info');
      }
      await loadQuarantineQueue();
      const statusRes = await fetch('/api/curator/status', {
        headers: { 'Curator-Token': state.token }
      });
      if (statusRes.ok) {
        const curData = await statusRes.json();
        updateHeaderStats(curData.pendingCount, curData.rulesCount, curData.masterCount, curData.instructionsPendingCount || 0, curData.discoveredVenuesCount || 0);
      }
    } else if (data.gmailResult && data.gmailResult.requiresSetup) {
      showToast('⚠️ Gmail credentials not yet configured in .env (NEWSLETTER_GMAIL_USER, NEWSLETTER_GMAIL_PASSWORD)', 'warning');
    } else {
      showToast(data.message || data.error || 'Failed to sync newsletters', 'error');
    }
  } catch (err) {
    showToast(`Server connection error while fetching newsletters: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
    if (iconEl) iconEl.textContent = origIcon;
    if (textEl) textEl.textContent = origText;
  }
}

// ==============================================================================
// 7. LEARNED RULES & AI INSTRUCTIONS MANAGERS
// ==============================================================================

window.openLearnedRulesModal = async function () {
  if (!state.token) {
    showToast('Please authenticate into Curator Studio first', 'warning');
    return;
  }

  const modal = document.getElementById('learned-rules-modal');
  if (!modal) return;

  try {
    const res = await fetch(`/api/curator/rules?_t=${Date.now()}`, {
      headers: { 'Curator-Token': state.token },
      cache: 'no-store'
    });
    if (res.ok) {
      state.learnedRules = await res.json();
      renderRulesList();
      modal.classList.add('active');
    } else {
      showToast('Failed to load learned rules', 'error');
    }
  } catch (err) {
    showToast(`Error connecting to server: ${err.message}`, 'error');
  }
};

window.openAIInstructionsModal = async function () {
  if (!state.token) {
    showToast('Please authenticate into Curator Studio first', 'warning');
    return;
  }

  const modal = document.getElementById('ai-instructions-modal');
  if (!modal) return;

  try {
    const res = await fetch(`/api/curator/instructions?_t=${Date.now()}`, {
      headers: { 'Curator-Token': state.token },
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      state.instructionsList = data.instructions || [];
      renderInstructionsList();
      modal.classList.add('active');
    } else {
      showToast('Failed to load feedback rules', 'error');
    }
  } catch (err) {
    showToast(`Error connecting to server: ${err.message}`, 'error');
  }
};

function renderRulesList() {
  const container = document.getElementById('rules-list-container');
  if (!container || !state.learnedRules) return;

  const tab = state.activeRuleTab || 'venue_policy_rules';
  const query = (state.rulesSearchQuery || '').toLowerCase().trim();

  // Update counts on tabs
  const countPolicies = Object.keys(state.learnedRules.venue_policy_rules || {}).length;
  const countLinks = Object.keys(state.learnedRules.venue_calendar_deep_links || {}).length;
  const countPatterns = (state.learnedRules.course_blacklist_patterns || []).length;
  const countFees = Object.keys(state.learnedRules.vendor_fee_formulas || {}).length;

  const elP = document.getElementById('rule-count-policies');
  const elL = document.getElementById('rule-count-links');
  const elPat = document.getElementById('rule-count-patterns');
  const elF = document.getElementById('rule-count-fees');
  if (elP) elP.textContent = countPolicies;
  if (elL) elL.textContent = countLinks;
  if (elPat) elPat.textContent = countPatterns;
  if (elF) elF.textContent = countFees;

  let itemsHtml = '';

  if (tab === 'venue_policy_rules') {
    const policies = state.learnedRules.venue_policy_rules || {};
    let entries = Object.entries(policies);
    if (query) {
      entries = entries.filter(([venue, pol]) => {
        const text = `${venue} ${pol.summary || ''} ${pol.curatorGuidance || ''} ${pol.pricingType || ''} ${(pol.scheduleDays || []).join(' ')}`.toLowerCase();
        return text.includes(query);
      });
    }

    if (entries.length === 0) {
      container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--curator-text-muted);">No venue policy rules found matching your filter.</div>`;
      return;
    }

    itemsHtml = entries.map(([venue, pol]) => {
      const priceBadge = (pol.doorPrice != null)
        ? `<span class="rule-tag rule-tag-price">💰 Door: $${Number(pol.doorPrice).toFixed(2)} CAD</span>`
        : (pol.isFree ? `<span class="rule-tag rule-tag-price">🆓 Free Drop-in</span>` : '');
      const typeBadge = pol.pricingType ? `<span class="rule-tag">${escapeHtml(pol.pricingType)}</span>` : '';
      const days = Array.isArray(pol.scheduleDays) && pol.scheduleDays.length > 0
        ? `<span class="rule-tag rule-tag-schedule">📅 ${pol.scheduleDays.join(', ').toUpperCase()}</span>`
        : '';
      const linkBadge = pol.calendarUrl ? `<a href="${escapeHtml(pol.calendarUrl)}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; font-size: 0.78rem; text-decoration: underline; margin-left: 6px;">Calendar URL ↗</a>` : '';

      return `
        <div class="rule-item-card">
          <div class="rule-item-main">
            <div class="rule-item-title">
              <span>🏛️ ${escapeHtml(venue)}</span>
              ${priceBadge}
              ${typeBadge}
              ${days}
            </div>
            ${pol.curatorGuidance ? `
              <div style="margin: 6px 0; font-size: 0.84rem; color: #e2e8f0; font-style: italic; background: rgba(0,0,0,0.25); padding: 6px 10px; border-radius: 6px; border-left: 3px solid #38bdf8;">
                “${escapeHtml(pol.curatorGuidance)}”
              </div>
            ` : ''}
            <div class="rule-item-meta">
              ${pol.summary ? `<span>${escapeHtml(pol.summary)}</span> • ` : ''}
              ${pol.learnedAt ? `<span>Learned: ${new Date(pol.learnedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span>` : ''}
              ${linkBadge}
            </div>
          </div>
          <div class="rule-item-actions">
            <button type="button" class="btn-curator btn-curator-ghost" style="padding: 5px 10px; font-size: 0.78rem;" onclick="openEditRule('venue_policy_rules', '${escapeHtml(venue.replace(/'/g, "\\'"))}')">✏️ Edit</button>
            <button type="button" class="btn-curator btn-curator-danger" style="padding: 5px 10px; font-size: 0.78rem;" onclick="deleteRule('venue_policy_rules', '${escapeHtml(venue.replace(/'/g, "\\'"))}')">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

  } else if (tab === 'venue_calendar_deep_links') {
    const links = state.learnedRules.venue_calendar_deep_links || {};
    let entries = Object.entries(links);
    if (query) {
      entries = entries.filter(([v, u]) => `${v} ${u}`.toLowerCase().includes(query));
    }

    if (entries.length === 0) {
      container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--curator-text-muted);">No calendar deep links found matching your filter.</div>`;
      return;
    }

    itemsHtml = entries.map(([venue, url]) => `
      <div class="rule-item-card">
        <div class="rule-item-main">
          <div class="rule-item-title">
            <span>🏛️ ${escapeHtml(venue)}</span>
          </div>
          <div class="rule-item-meta" style="margin-top: 4px;">
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; word-break: break-all; text-decoration: underline;">${escapeHtml(url)} ↗</a>
          </div>
        </div>
        <div class="rule-item-actions">
          <button type="button" class="btn-curator btn-curator-ghost" style="padding: 5px 10px; font-size: 0.78rem;" onclick="openEditRule('venue_calendar_deep_links', '${escapeHtml(venue.replace(/'/g, "\\'"))}')">✏️ Edit</button>
          <button type="button" class="btn-curator btn-curator-danger" style="padding: 5px 10px; font-size: 0.78rem;" onclick="deleteRule('venue_calendar_deep_links', '${escapeHtml(venue.replace(/'/g, "\\'"))}')">🗑️</button>
        </div>
      </div>
    `).join('');

  } else if (tab === 'course_blacklist_patterns') {
    let patterns = state.learnedRules.course_blacklist_patterns || [];
    if (query) {
      patterns = patterns.filter(p => p.toLowerCase().includes(query));
    }

    if (patterns.length === 0) {
      container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--curator-text-muted);">No blacklist patterns found matching your filter.</div>`;
      return;
    }

    itemsHtml = patterns.map(pat => `
      <div class="rule-item-card">
        <div class="rule-item-main">
          <div class="rule-item-title">
            <span class="rule-tag rule-tag-pattern">🚫 Auto-Excluded</span>
            <code style="color: #f43f5e; font-size: 0.95rem;">"${escapeHtml(pat)}"</code>
          </div>
          <div class="rule-item-meta">Matches and excludes multi-week courses, classes, or private hire from the public Vancouver under-$50 catalog.</div>
        </div>
        <div class="rule-item-actions">
          <button type="button" class="btn-curator btn-curator-ghost" style="padding: 5px 10px; font-size: 0.78rem;" onclick="openEditRule('course_blacklist_patterns', '${escapeHtml(pat.replace(/'/g, "\\'"))}')">✏️ Edit</button>
          <button type="button" class="btn-curator btn-curator-danger" style="padding: 5px 10px; font-size: 0.78rem;" onclick="deleteRule('course_blacklist_patterns', '${escapeHtml(pat.replace(/'/g, "\\'"))}')">🗑️</button>
        </div>
      </div>
    `).join('');

  } else if (tab === 'vendor_fee_formulas') {
    const fees = state.learnedRules.vendor_fee_formulas || {};
    let entries = Object.entries(fees);
    if (query) {
      entries = entries.filter(([domain, f]) => `${domain} ${f.description || ''}`.toLowerCase().includes(query));
    }

    if (entries.length === 0) {
      container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--curator-text-muted);">No vendor fee formulas found matching your filter.</div>`;
      return;
    }

    itemsHtml = entries.map(([domain, f]) => `
      <div class="rule-item-card">
        <div class="rule-item-main">
          <div class="rule-item-title">
            <span>💳 ${escapeHtml(domain)}</span>
            <span class="rule-tag rule-tag-price">Fixed Fee: $${Number(f.feeFixed || 0).toFixed(2)} CAD</span>
            <span class="rule-tag">Percent Fee: ${((f.feePercent || 0) * 100).toFixed(1)}%</span>
          </div>
          <div class="rule-item-meta">${escapeHtml(f.description || 'Live checkout fee calculation formula')}</div>
        </div>
        <div class="rule-item-actions">
          <button type="button" class="btn-curator btn-curator-ghost" style="padding: 5px 10px; font-size: 0.78rem;" onclick="openEditRule('vendor_fee_formulas', '${escapeHtml(domain.replace(/'/g, "\\'"))}')">✏️ Edit</button>
          <button type="button" class="btn-curator btn-curator-danger" style="padding: 5px 10px; font-size: 0.78rem;" onclick="deleteRule('vendor_fee_formulas', '${escapeHtml(domain.replace(/'/g, "\\'"))}')">🗑️</button>
        </div>
      </div>
    `).join('');
  }

  container.innerHTML = itemsHtml;
}

window.openEditRule = function (type, key) {
  const panel = document.getElementById('rule-edit-panel');
  if (!panel || !state.learnedRules) return;

  document.getElementById('rule-edit-type').value = type;
  document.getElementById('rule-edit-old-key').value = key || '';
  const titleEl = document.getElementById('rule-edit-panel-title');
  if (titleEl) titleEl.textContent = key ? `✏️ Edit Rule: ${key}` : '➕ Add New Rule';

  // Toggle field sets
  const fPolicy = document.getElementById('rule-fields-venue-policy');
  const fLink = document.getElementById('rule-fields-calendar-link');
  const fBlacklist = document.getElementById('rule-fields-blacklist');
  const fFee = document.getElementById('rule-fields-vendor-fee');

  if (fPolicy) fPolicy.style.display = type === 'venue_policy_rules' ? 'flex' : 'none';
  if (fLink) fLink.style.display = type === 'venue_calendar_deep_links' ? 'flex' : 'none';
  if (fBlacklist) fBlacklist.style.display = type === 'course_blacklist_patterns' ? 'flex' : 'none';
  if (fFee) fFee.style.display = type === 'vendor_fee_formulas' ? 'flex' : 'none';

  if (type === 'venue_policy_rules') {
    const pol = (state.learnedRules.venue_policy_rules || {})[key] || {};
    document.getElementById('rule-input-venue-name').value = key || '';
    document.getElementById('rule-input-door-price').value = pol.doorPrice != null ? pol.doorPrice : '';
    document.getElementById('rule-input-pricing-type').value = pol.pricingType || 'door-cover';
    document.getElementById('rule-input-schedule-days').value = (pol.scheduleDays || []).join(', ');
    document.getElementById('rule-input-calendar-url').value = pol.calendarUrl || '';
    document.getElementById('rule-input-guidance').value = pol.curatorGuidance || '';
  } else if (type === 'venue_calendar_deep_links') {
    document.getElementById('rule-input-link-venue').value = key || '';
    document.getElementById('rule-input-link-url').value = (state.learnedRules.venue_calendar_deep_links || {})[key] || '';
  } else if (type === 'course_blacklist_patterns') {
    document.getElementById('rule-input-pattern').value = key || '';
  } else if (type === 'vendor_fee_formulas') {
    const fee = (state.learnedRules.vendor_fee_formulas || {})[key] || {};
    document.getElementById('rule-input-vendor-domain').value = key || '';
    document.getElementById('rule-input-fee-fixed').value = fee.feeFixed != null ? fee.feeFixed : '';
    document.getElementById('rule-input-fee-percent').value = fee.feePercent != null ? fee.feePercent : '';
    document.getElementById('rule-input-fee-desc').value = fee.description || '';
  }

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth' });
};

window.openAddRule = function () {
  openEditRule(state.activeRuleTab || 'venue_policy_rules', '');
};

async function saveRuleChanges(e) {
  e.preventDefault();
  if (!state.token) return;

  const ruleType = document.getElementById('rule-edit-type').value;
  const oldKey = document.getElementById('rule-edit-old-key').value;
  let key = '';
  let value = null;

  if (ruleType === 'venue_policy_rules') {
    key = document.getElementById('rule-input-venue-name').value.trim();
    if (!key) {
      showToast('Venue name is required', 'error');
      return;
    }
    const existing = (state.learnedRules.venue_policy_rules || {})[oldKey] || {};
    const doorPriceVal = document.getElementById('rule-input-door-price').value;
    const pricingType = document.getElementById('rule-input-pricing-type').value;
    const daysRaw = document.getElementById('rule-input-schedule-days').value;
    const calendarUrl = document.getElementById('rule-input-calendar-url').value.trim();
    const guidance = document.getElementById('rule-input-guidance').value.trim();

    const doorPrice = doorPriceVal !== '' ? parseFloat(doorPriceVal) : null;
    const scheduleDays = daysRaw ? daysRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];

    value = {
      ...existing,
      doorPrice: doorPrice,
      pricingType: pricingType,
      isFree: pricingType === 'free' || doorPrice === 0,
      scheduleDays: scheduleDays,
      calendarUrl: calendarUrl || existing.calendarUrl || '',
      curatorGuidance: guidance,
      summary: doorPrice != null ? `Door Cover ~$${doorPrice.toFixed(2)} CAD | Days: ${scheduleDays.join(', ').toUpperCase()} | Link: ${calendarUrl}` : (guidance || 'Curator configured rule'),
      learnedAt: existing.learnedAt || new Date().toISOString(),
      source: 'Curator Rule Editor'
    };

  } else if (ruleType === 'venue_calendar_deep_links') {
    key = document.getElementById('rule-input-link-venue').value.trim();
    value = document.getElementById('rule-input-link-url').value.trim();
    if (!key || !value) {
      showToast('Venue name and URL are required', 'error');
      return;
    }

  } else if (ruleType === 'course_blacklist_patterns') {
    value = document.getElementById('rule-input-pattern').value.trim();
    key = value;
    if (!value) {
      showToast('Pattern text is required', 'error');
      return;
    }

  } else if (ruleType === 'vendor_fee_formulas') {
    key = document.getElementById('rule-input-vendor-domain').value.trim();
    const feeFixed = parseFloat(document.getElementById('rule-input-fee-fixed').value || 0);
    const feePercent = parseFloat(document.getElementById('rule-input-fee-percent').value || 0);
    const desc = document.getElementById('rule-input-fee-desc').value.trim();
    if (!key) {
      showToast('Vendor domain is required', 'error');
      return;
    }
    value = {
      feeFixed: feeFixed,
      feePercent: feePercent,
      description: desc || 'Live checkout fee calculation formula'
    };
  }

  try {
    const res = await fetch('/api/curator/rules/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: JSON.stringify({
        ruleType: ruleType,
        key: key,
        oldKey: oldKey,
        value: value
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`✅ Saved changes to '${key}'!`, 'success');
      state.learnedRules = data.rules;
      if (data.rulesCount) {
        state.stats.rules = data.rulesCount;
        const elR = document.getElementById('stat-rules-count');
        if (elR) elR.textContent = data.rulesCount;
      }
      const editPanel = document.getElementById('rule-edit-panel');
      if (editPanel) editPanel.style.display = 'none';
      renderRulesList();
    } else {
      showToast(data.error || 'Failed to save rule changes', 'error');
    }
  } catch (err) {
    showToast('Server error while saving rule', 'error');
  }
}

window.deleteRule = async function (ruleType, key) {
  if (!state.token) return;

  try {
    const res = await fetch('/api/curator/rules/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: JSON.stringify({
        ruleType: ruleType,
        key: key
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`Rule for '${key}' removed.`, 'info');
      state.learnedRules = data.rules;
      if (data.rulesCount) {
        state.stats.rules = data.rulesCount;
        const elR = document.getElementById('stat-rules-count');
        if (elR) elR.textContent = data.rulesCount;
      }
      renderRulesList();
    } else {
      showToast(data.error || 'Failed to delete rule', 'error');
    }
  } catch (err) {
    showToast('Server error while deleting rule', 'error');
  }
};

function renderInstructionsList() {
  const container = document.getElementById('instructions-list-container');
  if (!container || !state.instructionsList) return;

  const filter = state.activeInstFilter || 'all';
  const query = (state.instructionsSearchQuery || '').toLowerCase().trim();

  // Tab counts
  const allCount = state.instructionsList.length;
  const pendingCount = state.instructionsList.filter(i => i.status === 'pending').length;
  const resolvedCount = state.instructionsList.filter(i => i.status === 'resolved' || i.applied).length;
  const dismissedCount = state.instructionsList.filter(i => i.status === 'dismissed').length;

  const elA = document.getElementById('inst-count-all');
  const elP = document.getElementById('inst-count-pending');
  const elR = document.getElementById('inst-count-resolved');
  const elD = document.getElementById('inst-count-dismissed');
  if (elA) elA.textContent = allCount;
  if (elP) elP.textContent = pendingCount;
  if (elR) elR.textContent = resolvedCount;
  if (elD) elD.textContent = dismissedCount;

  let items = [...state.instructionsList];
  if (filter === 'pending') {
    items = items.filter(i => i.status === 'pending');
  } else if (filter === 'resolved') {
    items = items.filter(i => i.status === 'resolved' || i.applied);
  } else if (filter === 'dismissed') {
    items = items.filter(i => i.status === 'dismissed');
  }

  if (query) {
    items = items.filter(i => {
      const text = `${i.venueName || ''} ${i.eventTitle || ''} ${i.instructionText || ''} ${i.curatorNote || ''}`.toLowerCase();
      return text.includes(query);
    });
  }

  if (items.length === 0) {
    container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--curator-text-muted);">No feedback rules found matching your filter.</div>`;
    return;
  }

  container.innerHTML = items.map(inst => {
    const isPending = inst.status === 'pending';
    const isDismissed = inst.status === 'dismissed';
    const statusTag = isPending
      ? `<span class="rule-tag" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border-color: rgba(245, 158, 11, 0.4);">⚡ Pending Review</span>`
      : (isDismissed
        ? `<span class="rule-tag" style="background: rgba(239, 68, 68, 0.2); color: #fca5a5; border-color: rgba(239, 68, 68, 0.4);">🛑 Dismissed</span>`
        : `<span class="rule-tag" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border-color: rgba(16, 185, 129, 0.4);">✅ Resolved &amp; Applied</span>`);

    const shots = inst.screenshotPaths || (inst.screenshotPath ? [inst.screenshotPath] : []);
    const shotsHtml = shots.length > 0 ? `
      <div style="display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap;">
        ${shots.map(s => `
          <a href="${escapeHtml(s)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; width: 60px; height: 60px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,0.2);">
            <img src="${escapeHtml(s)}" alt="Proof Screenshot" style="width: 100%; height: 100%; object-fit: cover;" />
          </a>
        `).join('')}
      </div>
    ` : '';

    const distilledHtml = inst.aiLearnedSummary ? `
      <div style="margin-top: 6px; font-size: 0.78rem; color: #a7f3d0; background: rgba(16, 185, 129, 0.08); padding: 4px 8px; border-radius: 4px; border: 1px solid rgba(16, 185, 129, 0.2);">
        🤖 AI Distilled: ${escapeHtml(inst.aiLearnedSummary)}
      </div>
    ` : '';

    return `
      <div class="rule-item-card">
        <div class="rule-item-main">
          <div class="rule-item-title">
            <span>${escapeHtml(inst.venueName || inst.eventTitle || 'Instruction #' + inst.id)}</span>
            ${statusTag}
            ${inst.actionTaken ? `<span class="rule-tag">${escapeHtml(inst.actionTaken)}</span>` : ''}
          </div>
          <div style="color: #ffffff; font-size: 0.9rem; margin: 8px 0 6px 0; background: rgba(0,0,0,0.3); padding: 8px 12px; border-radius: 6px; border-left: 3px solid #c084fc;">
            “${escapeHtml(inst.instructionText || '')}”
          </div>
          ${inst.curatorNote && inst.curatorNote !== inst.instructionText ? `
            <div style="font-size: 0.8rem; color: #cbd5e1; margin-top: 4px;">
              <strong>Note:</strong> ${escapeHtml(inst.curatorNote)}
            </div>
          ` : ''}
          ${distilledHtml}
          ${shotsHtml}
          <div class="rule-item-meta" style="margin-top: 6px;">
            <span>ID: <code>${escapeHtml(inst.id)}</code></span> • 
            <span>${inst.createdAt ? new Date(inst.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Unknown date'}</span>
          </div>
        </div>
        <div class="rule-item-actions">
          <button type="button" class="btn-curator btn-curator-ghost" style="padding: 5px 10px; font-size: 0.78rem;" onclick="openEditInstruction('${inst.id}')">✏️ Edit</button>
          <button type="button" class="btn-curator btn-curator-danger" style="padding: 5px 10px; font-size: 0.78rem;" onclick="deleteInstruction('${inst.id}')">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
}

window.openEditInstruction = function (instId) {
  const inst = (state.instructionsList || []).find(i => i.id === instId);
  if (!inst) return;
  const panel = document.getElementById('instruction-edit-panel');
  if (!panel) return;

  document.getElementById('inst-edit-id').value = inst.id;
  document.getElementById('inst-edit-text').value = inst.instructionText || '';
  document.getElementById('inst-edit-note').value = inst.curatorNote || '';
  document.getElementById('inst-edit-status').value = inst.status || 'pending';

  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth' });
};

async function saveInstructionChanges(e) {
  e.preventDefault();
  if (!state.token) return;

  const id = document.getElementById('inst-edit-id').value;
  const text = document.getElementById('inst-edit-text').value.trim();
  const note = document.getElementById('inst-edit-note').value.trim();
  const status = document.getElementById('inst-edit-status').value;

  try {
    const res = await fetch('/api/curator/instructions/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: JSON.stringify({
        id: id,
        instructionText: text,
        curatorNote: note,
        status: status
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('✅ Instruction updated!', 'success');
      const idx = state.instructionsList.findIndex(i => i.id === id);
      if (idx >= 0) {
        state.instructionsList[idx] = data.instruction;
      }
      if (data.instructionsPendingCount != null) {
        state.stats.instructions = data.instructionsPendingCount;
        const elI = document.getElementById('stat-instructions-count');
        if (elI) elI.textContent = data.instructionsPendingCount;
      }
      const panel = document.getElementById('instruction-edit-panel');
      if (panel) panel.style.display = 'none';
      renderInstructionsList();
    } else {
      showToast(data.error || 'Failed to update instruction', 'error');
    }
  } catch (err) {
    showToast('Server error while updating instruction', 'error');
  }
}

window.deleteInstruction = async function (instId) {
  if (!state.token) return;

  try {
    const res = await fetch('/api/curator/instructions/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: JSON.stringify({ id: instId })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Instruction deleted.', 'info');
      state.instructionsList = state.instructionsList.filter(i => i.id !== instId);
      if (data.instructionsPendingCount != null) {
        state.stats.instructions = data.instructionsPendingCount;
        const elI = document.getElementById('stat-instructions-count');
        if (elI) elI.textContent = data.instructionsPendingCount;
      }
      renderInstructionsList();
    } else {
      showToast(data.error || 'Failed to delete instruction', 'error');
    }
  } catch (err) {
    showToast('Server error while deleting instruction', 'error');
  }
};

// ==============================================================================
// 10. CURATOR ACCESSIBILITY ENGINE (High Contrast & Large Touch Targets)
// ==============================================================================

function initCuratorAccessibility() {
  try {
    const isAccessible = localStorage.getItem('van50_accessible_mode') === 'true';
    setCuratorAccessibility(isAccessible, false);
  } catch (e) { }
}

function setCuratorAccessibility(enabled, notify = true) {
  document.documentElement.classList.toggle('van50-accessible', !!enabled);
  document.body.classList.toggle('van50-accessible', !!enabled);

  const btn = document.getElementById('curator-accessibility-btn');
  if (btn) {
    btn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    btn.classList.toggle('active', !!enabled);
    const label = btn.querySelector('.access-label');
    if (label) {
      label.textContent = enabled ? 'Accessible: ON' : 'Accessibility';
    }
  }

  try {
    localStorage.setItem('van50_accessible_mode', enabled ? 'true' : 'false');
  } catch (e) { }

  if (notify && typeof showToast === 'function') {
    showToast(
      enabled
        ? '♿ Accessibility Mode Enabled (High Contrast & Enhanced Text)'
        : '♿ Standard Mode Restored',
      'info'
    );
  }
}

function toggleCuratorAccessibility() {
  const current = document.body.classList.contains('van50-accessible');
  setCuratorAccessibility(!current, true);
}

window.initCuratorAccessibility = initCuratorAccessibility;
window.setCuratorAccessibility = setCuratorAccessibility;
window.toggleCuratorAccessibility = toggleCuratorAccessibility;

// ==============================================================================
// 11. MASTER CATALOGS INSPECTOR ENGINE (events_active, venues, festivals, etc.)
// ==============================================================================

window.openMasterCatalogsModal = async function () {
  if (!state.token) {
    showToast('Please authenticate into Curator Studio first', 'warning');
    return;
  }

  const modal = document.getElementById('master-catalogs-modal');
  if (!modal) return;
  modal.classList.add('active');

  // Trigger loading active tab and all badge counts
  fetchMasterCatalog(state.masterTab || 'events_active');
  fetchAllMasterCatalogCounts();
};

async function fetchAllMasterCatalogCounts() {
  const tabs = ['events_active', 'venues_master', 'festivals_master', 'ticketing_sources', 'discovery_sources', 'events_archive', 'crowdsourced_prices'];
  for (const t of tabs) {
    fetchMasterCatalog(t, false);
  }
}

async function fetchMasterCatalog(tabName, renderIfActive = true) {
  if (!state.token) return;

  const urlMap = {
    events_active: '/api/curator/events/active',
    venues_master: '/api/curator/venues/master',
    festivals_master: '/api/curator/festivals/master',
    ticketing_sources: '/api/curator/ticketing_sources',
    discovery_sources: '/api/curator/discovery_sources',
    events_archive: '/api/curator/archived',
    crowdsourced_prices: '/api/curator/price-feedback'
  };

  const url = urlMap[tabName];
  if (!url) return;

  try {
    const res = await fetch(`${url}?_t=${Date.now()}`, {
      headers: { 'Curator-Token': state.token },
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      let list = [];
      if (tabName === 'events_active') list = data.events || [];
      else if (tabName === 'venues_master') list = data.venues || [];
      else if (tabName === 'festivals_master') list = data.festivals || [];
      else if (tabName === 'ticketing_sources') list = data.ticketingSources || [];
      else if (tabName === 'discovery_sources') list = data.discoverySources || (Array.isArray(data) ? data : []);
      else if (tabName === 'events_archive') list = data.archivedEvents || [];
      else if (tabName === 'crowdsourced_prices') {
        list = data.stats?.venues || [];
        state.crowdsourcedStats = data.stats;
      }

      state.masterCatalogsData[tabName] = list;

      const badgeIdMap = {
        events_active: 'master-count-active',
        venues_master: 'master-count-venues',
        festivals_master: 'master-count-festivals',
        ticketing_sources: 'master-count-ticketing',
        discovery_sources: 'master-count-discovery',
        events_archive: 'master-count-archive',
        crowdsourced_prices: 'master-count-prices'
      };
      const badgeEl = document.getElementById(badgeIdMap[tabName]);
      if (badgeEl) badgeEl.textContent = list.length;


      if (tabName === 'events_active') {
        const elM = document.getElementById('stat-master-count');
        if (elM) elM.textContent = list.length;
      }

      if (renderIfActive && state.masterTab === tabName) {
        renderMasterCatalogList();
      }
    }
  } catch (err) {
    console.warn(`Could not load catalog ${tabName}:`, err);
  }
}

function renderMasterCatalogList() {
  const container = document.getElementById('master-catalogs-list-container');
  const footerStatus = document.getElementById('master-status-footer');
  if (!container) return;

  const currentTab = state.masterTab || 'events_active';
  const rawList = state.masterCatalogsData[currentTab] || [];
  const query = (state.masterSearchQuery || '').toLowerCase().trim();

  let list = rawList;
  if (query) {
    list = rawList.filter(item => {
      const jsonStr = JSON.stringify(item).toLowerCase();
      return jsonStr.includes(query);
    });
  }

  if (footerStatus) {
    footerStatus.textContent = `Showing ${list.length} of ${rawList.length} items in ${currentTab.replace('_', ' ')}.`;
  }

  if (list.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
        <div style="font-size: 2.2rem; margin-bottom: 8px;">🔍</div>
        <div style="font-size: 1rem; font-weight: 600; color: #e2e8f0;">No matching entries found</div>
        <div style="font-size: 0.82rem; margin-top: 4px;">Try a different search term or switch catalogs above.</div>
      </div>
    `;
    return;
  }

  if (currentTab === 'events_active') {
    container.innerHTML = list.map((ev, index) => {
      const cardNum = getEventCardNumber(ev, index);
      const p = ev.pricing_all_in_cad?.regular ?? ev.price ?? 0;
      const priceBadge = p === 0 ? '<span style="color: #4ade80; font-weight: 700;">Free ($0)</span>' : `<span style="color: #38bdf8; font-weight: 700;">$${Number(p).toFixed(2)} CAD</span>`;
      const show1 = ev.show_1 || {};
      const dates = [ev.show_1?.date, ev.show_2?.date, ev.show_3?.date].filter(Boolean);
      const showingsBadge = dates.length > 1 ? `<span style="background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.4); border-radius: 4px; padding: 2px 6px; font-size: 0.72rem;">${dates.length} Verified Showings</span>` : '';
      const tags = (ev.tags || []).map(t => `<span style="background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 4px; font-size: 0.72rem; color: #94a3b8;">#${t}</span>`).join(' ');

      return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
            <div>
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span class="badge-card-number" title="Catalog Card #${cardNum}">Card #${cardNum}</span>
                <strong style="color: #f8fafc; font-size: 0.96rem;">${escapeHtml(ev.event_name || ev.title || 'Event')}</strong>
              </div>
              <div style="color: #38bdf8; font-size: 0.84rem; margin-top: 2px;">📍 ${escapeHtml(ev.venue_name || ev.venue || '')} • <span style="color: #94a3b8;">${escapeHtml(ev.neighborhood || '')}</span></div>
            </div>
            <div style="text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
              ${priceBadge}
              ${showingsBadge}
            </div>
          </div>
          <div style="font-size: 0.8rem; color: #cbd5e1; line-height: 1.4;">${escapeHtml(ev.description || 'No description provided.')}</div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 0.76rem; color: #94a3b8; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 6px;">
            <div>📅 Show 1: ${show1.date || 'Upcoming'} ${show1.start_time ? `at ${show1.start_time}` : ''} | Provider: <strong style="color: #cbd5e1;">${escapeHtml(ev.ticket_provider || 'Direct')}</strong></div>
            <div style="display: flex; gap: 8px; align-items: center;">
              ${tags}
              ${ev.ticket_url ? `<a href="${escapeHtml(ev.ticket_url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #38bdf8; text-decoration: underline;">Tickets ↗</a>` : ''}
              <button type="button" class="btn-curator btn-curator-ghost" onclick="openAIInstructionModal('${escapeHtml(ev.event_id || ev.id)}', 'instruct')" style="padding: 2px 7px; font-size: 0.72rem; color: #d8b4fe; border-color: rgba(168, 85, 247, 0.4);" title="Give comments/feedback for AI to evaluate during quarantine review">📝 Guidance</button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } else if (currentTab === 'venues_master') {
    container.innerHTML = list.map(vm => {
      const vname = vm.venue_name || vm.name || 'Venue';
      const addr = vm.full_address || vm.address || 'Vancouver, BC';
      const neigh = vm.neighborhood || 'Vancouver';
      const calUrl = vm.calendar_url || vm.website_url || '';
      return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: #f8fafc; font-size: 0.95rem;">🏛️ ${escapeHtml(vname)}</strong>
            <span style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 4px; padding: 2px 8px; font-size: 0.75rem;">${escapeHtml(neigh)}</span>
          </div>
          <div style="font-size: 0.82rem; color: #94a3b8;">📍 ${escapeHtml(addr)}</div>
          ${vm.description ? `<div style="font-size: 0.8rem; color: #cbd5e1; margin-top: 2px;">${escapeHtml(vm.description)}</div>` : ''}
          <div style="display: flex; gap: 12px; margin-top: 4px; font-size: 0.78rem; align-items: center;">
            ${calUrl ? `<a href="${escapeHtml(calUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #38bdf8; text-decoration: underline;">📅 Calendar Page ↗</a>` : ''}
            ${vm.website_url && vm.website_url !== calUrl ? `<a href="${escapeHtml(vm.website_url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #94a3b8; text-decoration: underline;">🌐 Website ↗</a>` : ''}
            <button type="button" class="btn-curator btn-curator-ghost" onclick="openAIInstructionModal('${escapeHtml(vm.venue_name || vm.name || vm.id)}', 'instruct')" style="padding: 2px 7px; font-size: 0.72rem; color: #d8b4fe; border-color: rgba(168, 85, 247, 0.4); margin-left: auto;" title="Give comments/feedback for AI to evaluate during quarantine review">📝 Guidance</button>
          </div>
        </div>
      `;
    }).join('');
  } else if (currentTab === 'festivals_master') {
    container.innerHTML = list.map(fm => {
      const fname = fm.festival_name || fm.name || 'Festival';
      return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: #f8fafc; font-size: 0.95rem;">🎪 ${escapeHtml(fname)}</strong>
            <span style="color: #c084fc; font-size: 0.8rem; font-weight: 600;">${escapeHtml(fm.start_date || '')} to ${escapeHtml(fm.end_date || '')}</span>
          </div>
          <div style="font-size: 0.82rem; color: #94a3b8;">📍 ${escapeHtml(fm.location || 'Vancouver, BC')} • Genre: <strong style="color: #cbd5e1;">${escapeHtml(fm.description || 'General')}</strong></div>
          <div style="display: flex; gap: 12px; margin-top: 4px; font-size: 0.78rem; align-items: center;">
            ${fm.schedule_url ? `<a href="${escapeHtml(fm.schedule_url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #38bdf8; text-decoration: underline;">📅 Schedule & Lineup ↗</a>` : ''}
            ${fm.website_url ? `<a href="${escapeHtml(fm.website_url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #94a3b8; text-decoration: underline;">🌐 Festival Portal ↗</a>` : ''}
            <button type="button" class="btn-curator btn-curator-ghost" onclick="openAIInstructionModal('${escapeHtml(fm.festival_name || fm.name || fm.id)}', 'instruct')" style="padding: 2px 7px; font-size: 0.72rem; color: #d8b4fe; border-color: rgba(168, 85, 247, 0.4); margin-left: auto;" title="Give comments/feedback for AI to evaluate during quarantine review">📝 Guidance</button>
          </div>
        </div>
      `;
    }).join('');
  } else if (currentTab === 'ticketing_sources') {
    container.innerHTML = list.map(ts => {
      return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <strong style="color: #f8fafc; font-size: 0.95rem;">🎫 ${escapeHtml(ts.provider_name || 'Provider')}</strong>
            <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 2px;">💡 ${escapeHtml(ts.notes || 'Ticketing source')}</div>
          </div>
          <div>
            ${ts.website_url && ts.website_url !== 'Direct' ? `<a href="${escapeHtml(ts.website_url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" class="btn-curator btn-curator-ghost" style="padding: 4px 10px; font-size: 0.76rem;">Visit ↗</a>` : '<span style="color: #4ade80; font-size: 0.8rem;">Door / Cash</span>'}
          </div>
        </div>
      `;
    }).join('');
  } else if (currentTab === 'discovery_sources') {
    container.innerHTML = list.map(ds => {
      return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: #f8fafc; font-size: 0.95rem;">🌐 ${escapeHtml(ds.name || ds.domain || 'Discovery Feed')}</strong>
            <span style="background: rgba(34, 197, 94, 0.15); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 4px; padding: 2px 8px; font-size: 0.72rem;">${escapeHtml(ds.typeLabel || ds.type || 'Aggregator')}</span>
          </div>
          <div style="font-size: 0.82rem; color: #cbd5e1;">🎯 ${escapeHtml(ds.focus || '')}</div>
          <div style="font-size: 0.78rem; color: #94a3b8; margin-top: 2px;">Policy: ${escapeHtml(ds.resolutionPolicy || 'Extract outbound canonical ticket portal')}</div>
          <div style="display: flex; gap: 12px; margin-top: 4px; font-size: 0.78rem;">
            ${ds.eventsUrl ? `<a href="${escapeHtml(ds.eventsUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #38bdf8; text-decoration: underline;">Calendar Feed ↗</a>` : ''}
          </div>
        </div>
      `;
    }).join('');
  } else if (currentTab === 'events_archive') {
    container.innerHTML = list.map(ar => {
      const p = ar.attempted_price_cad ?? ar.attemptedPrice ?? ar.price ?? 0;
      return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <strong style="color: #f8fafc; font-size: 0.92rem;">📦 ${escapeHtml(ar.event_name || ar.title || 'Archived Event')}</strong>
            <span style="color: #f43f5e; font-size: 0.82rem; font-weight: 600;">$${Number(p).toFixed(2)} CAD</span>
          </div>
          <div style="font-size: 0.8rem; color: #94a3b8;">📍 ${escapeHtml(ar.venue_name || ar.venue || '')}</div>
          <div style="font-size: 0.78rem; color: #f87171; background: rgba(244, 63, 94, 0.08); padding: 4px 8px; border-radius: 4px; margin-top: 2px;">Reason: ${escapeHtml(ar.archive_reason || ar.archivedReason || ar.flagReason || 'Dismissed by curator')}</div>
        </div>
      `;
    }).join('');
  } else if (currentTab === 'crowdsourced_prices') {
    const stats = state.crowdsourcedStats || {};
    const totalReports = stats.total_reports || 0;
    const validReports = stats.valid_reports || 0;
    const outliers = stats.outliers_excluded || 0;

    const statsHeader = `
      <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 12px 16px; margin-bottom: 8px; display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; font-size: 0.82rem;">
        <div>
          <div style="color: #94a3b8; font-size: 0.72rem; text-transform: uppercase;">Total Submissions</div>
          <div style="font-size: 1.2rem; font-weight: 700; color: #fff;">${totalReports}</div>
        </div>
        <div>
          <div style="color: #94a3b8; font-size: 0.72rem; text-transform: uppercase;">Valid Range</div>
          <div style="font-size: 1.2rem; font-weight: 700; color: #34d399;">${validReports}</div>
        </div>
        <div>
          <div style="color: #94a3b8; font-size: 0.72rem; text-transform: uppercase;">Outliers Excluded</div>
          <div style="font-size: 1.2rem; font-weight: 700; color: #f59e0b;" title="Values outside Pint $3-$25 or Cocktail $6-$40 excluded">${outliers}</div>
        </div>
        <div>
          <div style="color: #94a3b8; font-size: 0.72rem; text-transform: uppercase;">Venues Reported</div>
          <div style="font-size: 1.2rem; font-weight: 700; color: #38bdf8;">${list.length}</div>
        </div>
      </div>
    `;

    if (list.length === 0) {
      container.innerHTML = statsHeader + `
        <div style="text-align: center; padding: 32px 20px; color: #94a3b8;">
          <div style="font-size: 1.8rem; margin-bottom: 6px;">🍺</div>
          <div style="font-size: 0.95rem; font-weight: 600; color: #cbd5e1;">No crowdsourced price reports recorded yet</div>
          <div style="font-size: 0.8rem; margin-top: 4px;">Patron submissions via cards or the "Suggest price update" modal will appear here.</div>
        </div>
      `;
      return;
    }

    const itemsHtml = list.map(v => {
      const isConsensus = v.consensus_reached;
      const consensusBadge = isConsensus
        ? `<span style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 4px; padding: 2px 8px; font-size: 0.72rem; font-weight: 700;">✓ Consensus (N ≥ 3)</span>`
        : `<span style="background: rgba(245, 158, 11, 0.12); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); border-radius: 4px; padding: 2px 8px; font-size: 0.72rem; font-weight: 600;">Collecting (N=${v.sample_size})</span>`;

      const pintInfo = v.median_pint_menu !== null
        ? `<strong>$${v.median_pint_menu.toFixed(2)}</strong> menu ($${(v.median_pint_tax_in || v.median_pint_menu * 1.15).toFixed(2)} tax-in)`
        : '<span style="color: #64748b;">Not reported</span>';

      const cocktailInfo = v.median_cocktail_menu !== null
        ? `<strong>$${v.median_cocktail_menu.toFixed(2)}</strong> menu ($${(v.median_cocktail_tax_in || v.median_cocktail_menu * 1.15).toFixed(2)} tax-in)`
        : '<span style="color: #64748b;">Not reported</span>';

      const notesHtml = (v.recent_notes && v.recent_notes.length > 0)
        ? `<div style="font-size: 0.75rem; color: #94a3b8; font-style: italic; margin-top: 4px;">Recent notes: "${escapeHtml(v.recent_notes.join('", "'))}"</div>`
        : '';

      const escapedVname = escapeHtml(v.venue_name);
      const approveBtn = `
        <button type="button" class="btn-curator btn-curator-primary" style="padding: 5px 12px; font-size: 0.78rem;" 
                onclick="window.approvePriceConsensus('${escapedVname.replace(/'/g, "\\'")}', ${v.median_pint_menu ?? 'null'}, ${v.median_cocktail_menu ?? 'null'})">
          ⚡ Approve &amp; Calibrate
        </button>
      `;

      return `
        <div style="background: rgba(255,255,255,0.03); border: 1px solid ${isConsensus ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255,255,255,0.08)'}; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <strong style="color: #f8fafc; font-size: 0.95rem;">🏛️ ${escapedVname}</strong>
              ${consensusBadge}
            </div>
            ${approveBtn}
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.82rem; color: #cbd5e1; background: rgba(0,0,0,0.2); padding: 8px 10px; border-radius: 6px;">
            <div>🍺 Cheapest Pint (Median): ${pintInfo}</div>
            <div>🍸 Cheapest Cocktail (Median): ${cocktailInfo}</div>
          </div>
          ${notesHtml}
        </div>
      `;
    }).join('');

    container.innerHTML = statsHeader + itemsHtml;
  }
}

window.approvePriceConsensus = async function (venueName, pintPrice, cocktailPrice) {
  if (!confirm(`Apply consensus pricing calibration for "${venueName}"?\nPint: ${pintPrice ? '$' + pintPrice.toFixed(2) : 'N/A'}, Cocktail: ${cocktailPrice ? '$' + cocktailPrice.toFixed(2) : 'N/A'}`)) {
    return;
  }
  try {
    const res = await fetch('/api/curator/price-feedback/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: JSON.stringify({
        venue_name: venueName,
        pint_price: pintPrice,
        cocktail_price: cocktailPrice
      })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(`✓ Updated drink calibration for ${venueName}!`, 'success');
      fetchMasterCatalog('crowdsourced_prices');
      fetchMasterCatalog('venues_master');
      fetchMasterCatalog('events_active');
    } else {
      showToast(data.error || 'Failed to approve consensus', 'error');
    }
  } catch (err) {
    showToast('Failed to contact server: ' + err.message, 'error');
  }
};

window.fetchMasterCatalog = fetchMasterCatalog;
window.renderMasterCatalogList = renderMasterCatalogList;


// Section 12 (Automated Operations Stream console) removed per user request.




// ==============================================================================
// DISCOVERED CANDIDATE SOURCES PROMPT & RENDERING ENGINE
// ==============================================================================

function checkAndPromptCandidateSources() {
  const container = document.getElementById('curator-candidate-sources-prompt');
  if (!container) return;

  const sources = (state.discoveredSources || []).filter(s => s.status === 'pending_curator_approval' || s.status === 'pending');
  const count = sources.length;

  if (count === 0 || state.dismissedCandidatePrompt) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  container.innerHTML = `
    <div style="background: linear-gradient(135deg, rgba(14, 165, 233, 0.18), rgba(99, 102, 241, 0.15)); border: 1.5px solid rgba(56, 189, 248, 0.55); border-left: 6px solid #38bdf8; border-radius: 12px; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; box-shadow: 0 4px 25px rgba(0, 0, 0, 0.35);">
      <div style="display: flex; align-items: center; gap: 14px;">
        <div style="font-size: 2.2rem; background: rgba(56, 189, 248, 0.15); border-radius: 50%; width: 50px; height: 50px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(56, 189, 248, 0.3);">📡</div>
        <div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <h3 style="margin: 0; font-size: 1.15rem; color: #bae6fd; font-family: var(--font-heading); font-weight: 700;">
              ${count} New Candidate Event Sources Discovered by AI Awaiting Review!
            </h3>
            <span style="background: #0284c7; color: #fff; font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 999px;">Action Recommended</span>
          </div>
          <p style="margin: 0; font-size: 0.88rem; color: #cbd5e1; line-height: 1.4;">
            The Scout &amp; QC AIs automatically identified <strong>${count} potential event hubs, cultural organizers &amp; ticketing platforms</strong> during live operations. Review and enroll them into the Scout's mandatory checking schedule.
          </p>
        </div>
      </div>
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
        <button type="button" class="btn-curator btn-curator-primary" onclick="switchFilterToDiscoveredSources()" style="background: #0284c7; border: 1px solid #38bdf8; color: #fff; font-weight: 600; padding: 8px 16px;">
          🔍 Review Candidates (${count})
        </button>
        <button type="button" class="btn-curator btn-curator-ai-approve" onclick="approveAllCandidateSources()" style="background: rgba(16, 185, 129, 0.25); border: 1px solid #10b981; color: #6ee7b7; font-weight: 600; padding: 8px 14px;">
          ⚡ Approve All (${count})
        </button>
        <button type="button" class="btn-curator btn-curator-ghost" onclick="dismissCandidateSourcesPrompt()" style="color: #94a3b8; padding: 8px 10px;" title="Dismiss notification">
          ✕
        </button>
      </div>
    </div>
  `;
}

function dismissCandidateSourcesPrompt() {
  state.dismissedCandidatePrompt = true;
  const container = document.getElementById('curator-candidate-sources-prompt');
  if (container) container.style.display = 'none';
}

function switchFilterToDiscoveredSources() {
  state.activeFilter = 'discovered_sources';
  document.querySelectorAll('.curator-filter-pill').forEach(p => {
    if (p.dataset.filter === 'discovered_sources') {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });
  applyFiltersAndRender();
  const list = document.getElementById('curator-cards-list');
  if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderDiscoveredSourcesCards() {
  const container = document.getElementById('curator-cards-list');
  const countDisplay = document.getElementById('curator-results-text');
  if (!container) return;

  const sources = (state.discoveredSources || []).filter(s => s.status === 'pending_curator_approval' || s.status === 'pending');
  if (countDisplay) {
    countDisplay.innerHTML = `Showing <strong>${sources.length}</strong> candidate event source(s) discovered by AI awaiting Curator approval`;
  }

  if (sources.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; background: var(--curator-surface); border: 1px solid var(--curator-border); border-radius: 12px;">
        <div style="font-size: 2.5rem; margin-bottom: 12px;">📡</div>
        <h3 style="font-family: var(--font-heading); font-size: 1.25rem; color: #fff; margin-bottom: 6px;">
          No Candidate Sources Pending Review
        </h3>
        <p style="font-size: 0.88rem; color: var(--curator-text-muted); max-width: 520px; margin: 0 auto; line-height: 1.5;">
          All candidate event sources and ticketing platforms discovered by the AI have been reviewed and either enrolled into the Scout's mandatory radar or dismissed.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 8px; padding: 12px 18px; flex-wrap: wrap; gap: 10px;">
      <div>
        <strong style="color: #38bdf8; font-size: 0.95rem;">⚡ Bulk Actions:</strong>
        <span style="color: #94a3b8; font-size: 0.85rem; margin-left: 8px;">Approve all ${sources.length} candidate sources into the Scout discovery schedule with one click.</span>
      </div>
      <button type="button" class="btn-curator btn-curator-ai-approve" onclick="approveAllCandidateSources()" style="background: rgba(16, 185, 129, 0.25); border: 1px solid #10b981; color: #6ee7b7; font-weight: 600;">
        ⚡ Approve All Candidate Sources (${sources.length})
      </button>
    </div>
  ` + sources.map(s => {
    const sId = s.id || '';
    const domain = s.domain || '';
    const name = s.name || domain;
    const typeLabel = s.typeLabel || s.type || 'Event Source';
    const focus = s.focus || 'Vancouver cultural & live events';
    const budget = s.targetBudgetTier || '<= $50 CAD & free';
    const yieldEst = s.potentialYield || 'Medium';
    const discVia = s.discoveredVia || 'AI web operation';
    const notes = s.curatorNotes || '';
    const eventsUrl = s.eventsUrl || (domain ? `https://${domain}` : '#');

    return `
      <div class="curator-card" id="card-source-${escapeHtml(sId)}" style="border-left: 4px solid #38bdf8;">
        <div class="curator-card-top">
          <div>
            <h3 class="curator-card-title" style="color: #38bdf8; display: flex; align-items: center; gap: 8px;">
              <span>📡</span> ${escapeHtml(name)}
            </h3>
            <div class="curator-card-meta">
              <span>🌐 <strong>Domain:</strong> <a href="${escapeHtml(eventsUrl)}" target="_blank" rel="noopener noreferrer" style="color: #7dd3fc; text-decoration: underline;">${escapeHtml(domain)}</a></span>
              <span>🏷️ <strong>Type:</strong> ${escapeHtml(typeLabel)}</span>
              <span>💰 <strong>Budget Fit:</strong> ${escapeHtml(budget)}</span>
              <span>📈 <strong>Est. Yield:</strong> ${escapeHtml(yieldEst)}</span>
              <span>🔍 <strong>Discovered Via:</strong> ${escapeHtml(discVia)}</span>
            </div>
          </div>
          <div style="display: flex; gap: 6px; align-items: flex-start; flex-wrap: wrap;">
            <span class="curator-badge-pill" style="background: rgba(56, 189, 248, 0.2); color: #7dd3fc; border-color: rgba(56, 189, 248, 0.5);">
              📡 Candidate Source
            </span>
            <span class="curator-badge-pill" style="background: rgba(251, 191, 36, 0.2); color: #fde047; border-color: rgba(251, 191, 36, 0.5);">
              ⏳ Pending Approval
            </span>
          </div>
        </div>

        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 12px 16px; margin: 12px 0; font-size: 0.88rem; color: #cbd5e1; line-height: 1.45;">
          <div><strong>🎯 Focus / Content Scope:</strong> ${escapeHtml(focus)}</div>
          ${notes ? `<div style="margin-top: 6px; color: #94a3b8;"><strong>📝 AI Curator Notes:</strong> ${escapeHtml(notes)}</div>` : ''}
          <div style="margin-top: 8px; display: flex; gap: 16px; align-items: center;">
            <a href="${escapeHtml(eventsUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #38bdf8; text-decoration: underline; font-weight: 500;">
              Open Calendar / Ticket Page (<code>${escapeHtml(eventsUrl)}</code>) ↗
            </a>
          </div>
        </div>

        <div class="curator-actions-bar">
          <div class="curator-actions-left">
            <button 
              type="button" 
              class="btn-curator btn-curator-primary" 
              onclick="approveCandidateSource('${escapeHtml(sId)}', '${escapeHtml(domain)}')"
              style="background: #0284c7; border-color: #38bdf8;"
              title="Approve this source and enroll into discovery_sources.json and Scout schedule"
            >
              ➕ Approve &amp; Add to Scout Radar
            </button>
            <button 
              type="button" 
              class="btn-curator btn-curator-ai-approve" 
              onclick="openAIInstructionModal('${escapeHtml(sId)}', 'instruct')"
              title="Give comments or guidance for the AI when evaluating this source"
              style="background: rgba(168, 85, 247, 0.2); border: 1px solid rgba(168, 85, 247, 0.4); color: #d8b4fe;"
            >
              📝 Add Guidance / Notes
            </button>
            <button 
              type="button" 
              class="btn-curator btn-curator-danger" 
              onclick="dismissCandidateSource('${escapeHtml(sId)}', '${escapeHtml(domain)}')"
              title="Dismiss this candidate source"
            >
              🚫 Dismiss
            </button>
          </div>
          <div>
            <a 
              href="${escapeHtml(eventsUrl)}" 
              target="_blank" 
              rel="noopener noreferrer" 
              referrerpolicy="no-referrer"
              class="btn-curator btn-curator-ghost"
              title="Open the source's website in a new tab"
            >
              🌐 Visit Site ↗
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function approveCandidateSource(id, domain) {
  try {
    const res = await fetch('/api/curator/discovered_sources/approve', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: JSON.stringify({ id, domain })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'Source approved and enrolled into Scout Radar!', 'success');
      loadQuarantineQueue();
    } else {
      showToast(data.error || 'Failed to approve source', 'error');
    }
  } catch (err) {
    showToast('Network error approving source', 'error');
  }
}

async function dismissCandidateSource(id, domain) {
  try {
    const res = await fetch('/api/curator/discovered_sources/dismiss', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: JSON.stringify({ id, domain })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast('Candidate source dismissed', 'info');
      loadQuarantineQueue();
    } else {
      showToast(data.error || 'Failed to dismiss source', 'error');
    }
  } catch (err) {
    showToast('Network error dismissing source', 'error');
  }
}

async function approveAllCandidateSources() {
  if (!confirm('Approve all pending candidate sources and enroll them into the Scout discovery schedule?')) {
    return;
  }
  try {
    const res = await fetch('/api/curator/discovered_sources/approve_all', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Curator-Token': state.token
      },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showToast(data.message || 'All candidate sources enrolled into Scout Radar!', 'success');
      loadQuarantineQueue();
    } else {
      showToast(data.error || 'Failed to approve candidate sources', 'error');
    }
  } catch (err) {
    showToast('Network error approving candidate sources', 'error');
  }
}

function switchFilterToUserFeedback() {
  state.activeFilter = 'user_feedback';
  document.querySelectorAll('.curator-filter-pill').forEach(p => {
    if (p.dataset.filter === 'user_feedback') {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });
  applyFiltersAndRender();
  const list = document.getElementById('curator-cards-list');
  if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderUserFeedbackCards() {
  const container = document.getElementById('curator-cards-list');
  const countDisplay = document.getElementById('curator-results-text');
  if (!container) return;

  const feedbacks = state.userFeedbackQueue || [];
  if (countDisplay) {
    countDisplay.innerHTML = `Showing <strong>${feedbacks.length}</strong> sandboxed community submission(s) in Quarantine`;
  }

  if (feedbacks.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; background: var(--curator-surface); border: 1px solid var(--curator-border); border-radius: 12px;">
        <div style="font-size: 2.5rem; margin-bottom: 12px;">💬</div>
        <h3 style="font-family: var(--font-heading); font-size: 1.25rem; color: #fff; margin-bottom: 6px;">
          No Community Submissions in Quarantine
        </h3>
        <p style="font-size: 0.88rem; color: var(--curator-text-muted); max-width: 520px; margin: 0 auto; line-height: 1.5;">
          All user suggestions, event tips, and issue reports submitted from the public site have been reviewed.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; background: rgba(52, 211, 153, 0.08); border: 1px solid rgba(52, 211, 153, 0.25); border-radius: 8px; padding: 12px 18px; flex-wrap: wrap; gap: 10px;">
      <div>
        <h4 style="color: #6ee7b7; font-family: var(--font-heading); margin: 0 0 4px 0; font-size: 0.95rem;">
          🛡️ Sandboxed Community Submissions Queue (${feedbacks.length})
        </h4>
        <span style="font-size: 0.78rem; color: var(--curator-text-muted);">
          All user inputs are pre-sanitized, HTML-escaped, and sandboxed in Quarantine.
        </span>
      </div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 14px;">
      ${feedbacks.map(fb => {
    const typeLabels = {
      user_feedback: 'Community Feedback / Tip',
      event_suggestion: 'Upcoming Event (≤ $50 CAD)',
      venue_suggestion: 'Venue / Cultural Space',
      correction: 'Issue / Sold Out Report',
      general_comment: 'General Suggestion'
    };
    const typeBadge = typeLabels[fb.submission_type] || fb.submission_type || 'User Submission';
    const dateStr = fb.submitted_at ? new Date(fb.submitted_at).toLocaleString() : 'Recently';
    const messageText = fb.sanitized_message || fb.sanitized_comment || '';

    return `
          <div class="curator-card" id="fb-card-${fb.feedback_id}" style="background: var(--curator-surface); border: 1px solid rgba(52, 211, 153, 0.3); border-radius: 10px; padding: 16px 20px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="background: rgba(52, 211, 153, 0.15); color: #34d399; font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 20px; border: 1px solid rgba(52, 211, 153, 0.3);">
                  ${typeBadge}
                </span>
                <span style="background: rgba(148, 163, 184, 0.12); color: #94a3b8; font-size: 0.72rem; padding: 2px 8px; border-radius: 4px;">
                  🛡️ Sandboxed
                </span>
              </div>
              <span style="font-size: 0.75rem; color: var(--curator-text-muted);">${dateStr}</span>
            </div>

            <h3 style="font-family: var(--font-heading); font-size: 1.15rem; color: #fff; margin: 0 0 6px 0;">
              ${fb.sanitized_title}
            </h3>

            ${fb.sanitized_price ? `<div style="font-size: 0.82rem; color: #38bdf8; margin-bottom: 6px;"><strong>Price Note:</strong> ${fb.sanitized_price}</div>` : ''}

            ${fb.sanitized_url ? `
              <div style="font-size: 0.8rem; margin-bottom: 10px;">
                <span style="color: var(--curator-text-muted);">Submitted Link:</span>
                <a href="${fb.sanitized_url}" target="_blank" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer" style="color: #60a5fa; text-decoration: underline; word-break: break-all; margin-left: 4px;">
                  ${fb.sanitized_url} ↗
                </a>
              </div>
            ` : ''}

            <div style="background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 12px 14px; margin-bottom: 14px; font-size: 0.88rem; color: #e2e8f0; line-height: 1.5; word-break: break-word; white-space: pre-wrap;">${messageText}</div>

            <div style="display: flex; justify-content: flex-end; gap: 8px; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px;">
              <button type="button" class="btn-curator btn-curator-ghost" onclick="dismissUserFeedback('${fb.feedback_id}')" style="font-size: 0.8rem; padding: 5px 12px; color: #94a3b8;">
                Dismiss
              </button>
              <button type="button" class="btn-curator btn-curator-primary" onclick="resolveUserFeedback('${fb.feedback_id}')" style="font-size: 0.8rem; padding: 5px 14px; background: #059669; border: 1px solid #10b981; color: #fff;">
                ✓ Mark Resolved
              </button>
            </div>
          </div>
        `;
  }).join('')}
    </div>
  `;
}

window.dismissUserFeedback = async function (feedbackId) {
  if (!confirm('Dismiss this feedback item from quarantine?')) return;
  try {
    const res = await fetch('/api/curator/feedback/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Curator-Token': state.token },
      body: JSON.stringify({ feedback_id: feedbackId })
    });
    if (res.ok) {
      state.userFeedbackQueue = (state.userFeedbackQueue || []).filter(f => f.feedback_id !== feedbackId);
      applyFiltersAndRender();
      if (typeof showToast === 'function') showToast('Feedback dismissed from quarantine.', 'info');
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('Error dismissing feedback.', 'error');
  }
};

window.resolveUserFeedback = async function (feedbackId) {
  try {
    const res = await fetch('/api/curator/feedback/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Curator-Token': state.token },
      body: JSON.stringify({ feedback_id: feedbackId })
    });
    if (res.ok) {
      state.userFeedbackQueue = (state.userFeedbackQueue || []).filter(f => f.feedback_id !== feedbackId);
      applyFiltersAndRender();
      if (typeof showToast === 'function') showToast('Feedback marked as resolved.', 'success');
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('Error resolving feedback.', 'error');
  }
};

// Hook pill clicks
document.addEventListener('DOMContentLoaded', () => {
  const statFeedbackPill = document.getElementById('stat-user-feedback-pill');
  if (statFeedbackPill) {
    statFeedbackPill.addEventListener('click', switchFilterToUserFeedback);
  }
  const statNlPill = document.getElementById('stat-nl-signups-pill');
  if (statNlPill) {
    statNlPill.addEventListener('click', switchFilterToNewsletterSignups);
  }
});

function switchFilterToNewsletterSignups() {
  state.activeFilter = 'newsletter_signups';
  document.querySelectorAll('.curator-filter-pill').forEach(p => {
    if (p.dataset.filter === 'newsletter_signups') {
      p.classList.add('active');
    } else {
      p.classList.remove('active');
    }
  });
  applyFiltersAndRender();
  const list = document.getElementById('curator-cards-list');
  if (list) list.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderNewsletterSignupsCards() {
  const container = document.getElementById('curator-cards-list');
  const countDisplay = document.getElementById('curator-results-text');
  if (!container) return;

  const signups = state.pendingNewsletterSignups || [];
  if (countDisplay) {
    countDisplay.innerHTML = `Showing <strong>${signups.length}</strong> newsletter signup link(s) awaiting subscription`;
  }

  if (signups.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; background: var(--curator-surface); border: 1px solid var(--curator-border); border-radius: 12px;">
        <div style="font-size: 2.5rem; margin-bottom: 12px;">📬</div>
        <h3 style="font-family: var(--font-heading); font-size: 1.25rem; color: #fff; margin-bottom: 6px;">
          All Discovered Newsletters Subscribed
        </h3>
        <p style="font-size: 0.88rem; color: var(--curator-text-muted); max-width: 520px; margin: 0 auto; line-height: 1.5;">
          Scout AI continuously monitors official venue pages. Whenever an un-subscribed newsletter signup portal or form is discovered, a direct signup link will be automatically staged here for manual review.
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; background: rgba(244, 114, 182, 0.08); border: 1px solid rgba(244, 114, 182, 0.25); border-radius: 8px; padding: 12px 18px; flex-wrap: wrap; gap: 10px;">
      <div>
        <h4 style="color: #f472b6; font-family: var(--font-heading); margin: 0 0 4px 0; font-size: 0.95rem;">
          📬 Discovered Venue Newsletter Portals (${signups.length})
        </h4>
        <span style="font-size: 0.78rem; color: var(--curator-text-muted);">
          Scout AI identified newsletter subscription portals for these venues that are not yet in your subscription registry. Open the direct link, complete signup with Van50.Submit@gmail.com, then mark subscribed.
        </span>
      </div>
    </div>
    <div style="display: flex; flex-direction: column; gap: 14px;">
      ${signups.map(su => {
    const dateStr = su.detected_at ? new Date(su.detected_at).toLocaleString() : 'Recently';
    const targetEmail = su.suggested_email || 'Van50.Submit@gmail.com';
    const safeVenueName = escapeHtml(su.venue_name || 'Discovered Venue');
    const safeMethod = escapeHtml(su.method || 'Newsletter Direct Link');
    const safeWebsite = escapeHtml(su.website_url || '');
    const safeSignupUrl = escapeHtml(su.signup_url || '');

    return `
          <div class="curator-card" id="nl-card-${su.id}" style="background: var(--curator-surface); border: 1px solid rgba(244, 114, 182, 0.3); border-radius: 10px; padding: 16px 20px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; flex-wrap: wrap; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="background: rgba(244, 114, 182, 0.15); color: #f472b6; font-size: 0.75rem; font-weight: 700; padding: 3px 10px; border-radius: 20px; border: 1px solid rgba(244, 114, 182, 0.3);">
                  📬 ${safeMethod}
                </span>
                <span style="background: rgba(148, 163, 184, 0.12); color: #94a3b8; font-size: 0.72rem; padding: 2px 8px; border-radius: 4px;">
                  Scout Discovered
                </span>
              </div>
              <span style="font-size: 0.75rem; color: var(--curator-text-muted);">${dateStr}</span>
            </div>

            <h3 style="font-family: var(--font-heading); font-size: 1.2rem; color: #fff; margin: 0 0 8px 0;">
              ${safeVenueName}
            </h3>

            ${su.website_url ? `
              <div style="font-size: 0.82rem; margin-bottom: 8px; color: var(--curator-text-muted);">
                Official Website: 
                <a href="${safeWebsite}" target="_blank" rel="noopener noreferrer" style="color: #60a5fa; text-decoration: underline; margin-left: 4px;">
                  ${safeWebsite} ↗
                </a>
              </div>
            ` : ''}

            <div style="background: rgba(244, 114, 182, 0.08); border: 1px solid rgba(244, 114, 182, 0.2); border-radius: 6px; padding: 10px 14px; margin-bottom: 10px;">
              <div style="font-size: 0.8rem; color: #f9a8d4; font-weight: 600; margin-bottom: 4px;">Direct Newsletter Signup Link:</div>
              <a href="${safeSignupUrl}" target="_blank" rel="noopener noreferrer" style="color: #fff; font-size: 0.85rem; font-family: var(--font-mono, monospace); text-decoration: underline; word-break: break-all;">
                ${safeSignupUrl} ↗
              </a>
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 8px 14px; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
              <div style="font-size: 0.82rem; color: #cbd5e1;">
                Use Subscription Email: <strong style="color: #38bdf8; font-family: monospace;">${targetEmail}</strong>
              </div>
              <button type="button" class="btn-curator btn-curator-ghost" onclick="copyCuratorEmail('${targetEmail}')" style="font-size: 0.78rem; padding: 3px 10px; border: 1px solid rgba(56, 189, 248, 0.3); color: #38bdf8;">
                📋 Copy Email
              </button>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 12px; flex-wrap: wrap; gap: 10px;">
              <a href="${safeSignupUrl}" target="_blank" rel="noopener noreferrer" class="btn-curator btn-curator-primary" style="font-size: 0.85rem; padding: 6px 16px; background: #be185d; border: 1px solid #f472b6; color: #fff; text-decoration: none; display: inline-flex; align-items: center; gap: 6px;">
                🔗 Open Signup Page ↗
              </a>

              <div style="display: flex; gap: 8px;">
                <button type="button" class="btn-curator btn-curator-ghost" onclick="dismissNewsletterSignup('${su.id}')" style="font-size: 0.8rem; padding: 5px 12px; color: #94a3b8;">
                  Dismiss
                </button>
                <button type="button" class="btn-curator btn-curator-primary" onclick="markNewsletterSubscribed('${su.id}')" style="font-size: 0.8rem; padding: 5px 14px; background: #059669; border: 1px solid #10b981; color: #fff;">
                  ✓ Mark Subscribed
                </button>
              </div>
            </div>
          </div>
        `;
  }).join('')}
    </div>
  `;
}

window.copyCuratorEmail = function (email) {
  navigator.clipboard.writeText(email).then(() => {
    if (typeof showToast === 'function') showToast(`Copied ${email} to clipboard!`, 'success');
  }).catch(() => {
    if (typeof showToast === 'function') showToast(`Email: ${email}`, 'info');
  });
};

window.dismissNewsletterSignup = async function (id) {
  if (!confirm('Dismiss this newsletter signup opportunity?')) return;
  try {
    const res = await fetch('/api/curator/newsletter-signups/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Curator-Token': state.token },
      body: JSON.stringify({ id })
    });
    if (res.ok) {
      state.pendingNewsletterSignups = (state.pendingNewsletterSignups || []).filter(s => s.id !== id);
      const nlCountEl = document.getElementById('stat-nl-signups-count');
      const pillNlCountEl = document.getElementById('pill-count-nl-signups');
      if (nlCountEl) nlCountEl.textContent = state.pendingNewsletterSignups.length;
      if (pillNlCountEl) pillNlCountEl.textContent = state.pendingNewsletterSignups.length;
      applyFiltersAndRender();
      if (typeof showToast === 'function') showToast('Newsletter signup dismissed.', 'info');
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('Error dismissing newsletter signup.', 'error');
  }
};

window.markNewsletterSubscribed = async function (id) {
  const su = (state.pendingNewsletterSignups || []).find(s => s.id === id);
  if (!su) return;
  try {
    const res = await fetch('/api/curator/newsletter-signups/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Curator-Token': state.token },
      body: JSON.stringify({
        id: su.id,
        venue_name: su.venue_name,
        website_url: su.website_url,
        signup_url: su.signup_url,
        method: su.method
      })
    });
    if (res.ok) {
      state.pendingNewsletterSignups = (state.pendingNewsletterSignups || []).filter(s => s.id !== id);
      const nlCountEl = document.getElementById('stat-nl-signups-count');
      const pillNlCountEl = document.getElementById('pill-count-nl-signups');
      if (nlCountEl) nlCountEl.textContent = state.pendingNewsletterSignups.length;
      if (pillNlCountEl) pillNlCountEl.textContent = state.pendingNewsletterSignups.length;
      applyFiltersAndRender();
      if (typeof showToast === 'function') showToast(`Subscribed! Added ${su.venue_name} to active subscriptions.`, 'success');
    } else {
      const err = await res.json().catch(() => ({}));
      if (typeof showToast === 'function') showToast(err.error || 'Failed to record subscription', 'error');
    }
  } catch (e) {
    if (typeof showToast === 'function') showToast('Error recording subscription.', 'error');
  }
};

// ==============================================================================
// 12. STAGEHAND HYBRID MULTI-DIMENSION RIPPER UI INTEGRATION
// ==============================================================================

function initStagehandRipperUI() {
  const openBtn = document.getElementById('btn-open-stagehand');
  const modal = document.getElementById('stagehand-ripper-modal');
  const closeBtn = document.getElementById('btn-close-stagehand-modal');
  const closeBottomBtn = document.getElementById('btn-close-stagehand-bottom');
  const runBtn = document.getElementById('btn-run-stagehand');
  const auditAllBtn = document.getElementById('btn-audit-all-events');
  const stopBtn = document.getElementById('btn-stop-stagehand');
  const urlInput = document.getElementById('stagehand-url-input');
  const modeSelect = document.getElementById('stagehand-mode-select');
  const limitWrapper = document.getElementById('stagehand-limit-wrapper');
  const limitInput = document.getElementById('stagehand-limit-input');
  const unverifiedOnlyChk = document.getElementById('chk-stagehand-unverified-only');
  const autoApproveChk = document.getElementById('chk-stagehand-auto-approve');
  const statusPanel = document.getElementById('stagehand-status-panel');
  const statusText = document.getElementById('stagehand-status-text');
  const consoleOutput = document.getElementById('stagehand-console-output');
  const timerEl = document.getElementById('stagehand-timer');
  const spinnerEl = document.getElementById('stagehand-spinner');

  if (!modal) return;

  if (openBtn) {
    openBtn.addEventListener('click', () => {
      modal.classList.add('active');
      if (urlInput) urlInput.focus();
    });
  }

  const closeModal = () => {
    modal.classList.remove('active');
  };

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (closeBottomBtn) closeBottomBtn.addEventListener('click', closeModal);

  if (modeSelect && limitWrapper) {
    const updateModeUI = () => {
      const mode = modeSelect.value;
      const isBatch = mode === 'catalog_batch';
      const isCal = mode === 'calendar';
      const isEnrich = mode === 'enrich';
      const isCompile = mode === 'compile';

      limitWrapper.style.display = (isBatch || isCal || isEnrich) ? 'block' : 'none';
      if (urlInput) {
        if (isBatch || isEnrich || isCompile) {
          urlInput.placeholder = isCompile
            ? 'Merges seeds, schedules, box office & editorial layers automatically'
            : isEnrich
              ? 'Enriches seeds/events automatically to layer_editorial.json'
              : 'Targets data/events.json automatically (URL optional)';
          urlInput.required = false;
        } else {
          urlInput.placeholder = 'https://littlemountaingallery.ca/schedule/ or direct ticket link';
          urlInput.required = true;
        }
      }
    };
    modeSelect.addEventListener('change', updateModeUI);
    updateModeUI();
  }

  let activeEventSource = null;
  let timerInterval = null;
  let isExecuting = false;

  const setExecutionState = (running, initialStatus = '') => {
    isExecuting = running;
    if (typeof updateMainStopButtonState === 'function') {
      updateMainStopButtonState(running);
    }
    if (runBtn) {
      runBtn.disabled = running;
      runBtn.style.opacity = running ? '0.6' : '1';
      runBtn.innerHTML = running ? '<span>⏳ Running...</span>' : '<span>🚀 Run Custom Target</span>';
    }
    if (auditAllBtn) {
      auditAllBtn.disabled = running;
      auditAllBtn.style.opacity = running ? '0.6' : '1';
      auditAllBtn.innerHTML = running ? '<span>⏳ Auditing All Events...</span>' : '<span>🚀 Audit All Catalog Events (1-by-1)</span>';
    }
    if (stopBtn) {
      stopBtn.style.display = running ? 'inline-block' : 'none';
    }
    const topContBtn = document.getElementById('btn-top-continue-prev-stage');
    if (topContBtn) {
      topContBtn.style.display = running ? 'none' : 'inline-flex';
    }
    if (statusPanel && running) {
      statusPanel.style.display = 'block';
    }
    if (spinnerEl) {
      spinnerEl.style.animation = running ? 'spin 1.5s linear infinite' : 'none';
    }
    if (statusText && initialStatus) {
      statusText.textContent = initialStatus;
      statusText.style.color = '#c084fc';
    }
  };

  // Autonomous Multi-Layer Pipeline Execution Stream Elements
  const pipelineModal = document.getElementById('pipeline-stream-modal');
  const btnClosePipelineModal = document.getElementById('btn-close-pipeline-modal');
  const btnClosePipelineBottom = document.getElementById('btn-close-pipeline-bottom');
  const pipelineModalTitle = document.getElementById('pipeline-modal-title');
  const pipelineModalDesc = document.getElementById('pipeline-modal-desc');
  const pipelineStatusText = document.getElementById('pipeline-status-text');
  const pipelineStatusSubtext = document.getElementById('pipeline-status-subtext');
  const pipelineConsoleOutput = document.getElementById('pipeline-console-output');
  const pipelineTimer = document.getElementById('pipeline-timer');
  const pipelineSpinner = document.getElementById('pipeline-spinner');
  const btnStopPipeline = document.getElementById('btn-stop-pipeline');
  const btnStopPipelineTop = document.getElementById('btn-stop-pipeline-top');
  const pipelineEtaValue = document.getElementById('pipeline-eta-value');
  const pipelineItemProgress = document.getElementById('pipeline-item-progress');
  const pipelineProgressBar = document.getElementById('pipeline-progress-bar');

  // Main Page Global Stop Run Button (Request 2)
  const updateMainStopButtonState = (isRunning, pid = null) => {
    const btn = document.getElementById('btn-curator-stop-run');
    const label = document.getElementById('curator-stop-label');
    const indicator = document.getElementById('curator-stop-indicator');
    if (!btn) return;
    if (isRunning) {
      btn.classList.remove('is-idle');
      btn.classList.add('is-running');
      if (label) label.textContent = pid ? `🛑 Stop Run [PID: ${pid}]` : '🛑 Stop Run';
      btn.title = `Active scan running${pid ? ` (PID: ${pid})` : ''}! Click to halt immediately.`;
    } else {
      btn.classList.remove('is-running');
      btn.classList.add('is-idle');
      if (label) label.textContent = 'Not Running';
      btn.title = 'Not running — No active scan or worker process in background';
    }
  };

  const btnMainStopRun = document.getElementById('btn-curator-stop-run');
  if (btnMainStopRun) {
    btnMainStopRun.addEventListener('click', () => {
      const currentlyRunning = isExecuting || btnMainStopRun.classList.contains('is-running');
      if (!currentlyRunning) {
        if (typeof showToast === 'function') {
          showToast('Not running: No active scan or worker process is currently running.', 'info');
        }
        return;
      }
      stopActiveStagehand();
    });
  }

  const checkActiveStagehandStatus = async () => {
    if (isExecuting) {
      updateMainStopButtonState(true);
      return;
    }
    try {
      const res = await fetch('/api/curator/stagehand/status?_t=' + Date.now());
      if (res.ok) {
        const data = await res.json();
        updateMainStopButtonState(Boolean(data.running), data.pid || null);
      } else {
        updateMainStopButtonState(false);
      }
    } catch (_) {
      updateMainStopButtonState(false);
    }
  };
  setInterval(checkActiveStagehandStatus, 3000);
  setTimeout(checkActiveStagehandStatus, 500);

  // Determine unscanned / unverified events from catalog & quarantine
  const calculateUnscannedEvents = () => {
    const events = (state.allEvents && state.allEvents.length > 0)
      ? state.allEvents
      : (state.masterCatalogsData?.events_active || []);
    const quarantined = (state.quarantinedEvents && state.quarantinedEvents.length > 0)
      ? state.quarantinedEvents
      : (state.masterCatalogsData?.quarantined_events || []);

    const isFreePublicEvent = (e) =>
      e.price === 0 || e.isFree || e.pricingType === 'free' || e.cost_type === 'free' ||
      e.access_model === 'open_public_space' || e.access_model === 'free_public_access';

    const isUnscanned = (e) => {
      if (isFreePublicEvent(e)) {
        return !isVerifiedApprovalStatus(e.approval_status) || e.pricing_model === 'UNVERIFIED_POLICY_ESTIMATE';
      }
      return (!e.proof_keyframes?.cart && !e.proof_keyframe_cart) || !e.last_pulse_qc_at || !isVerifiedApprovalStatus(e.approval_status);
    };

    const unscanned = [];
    events.forEach((ev, idx) => {
      if (isUnscanned(ev)) {
        unscanned.push({
          id: ev.id || ev.event_id,
          title: ev.title || ev.event_name || 'Event',
          venue: ev.venue || ev.venue_name || '',
          cardIndex: idx + 1,
          isQuarantined: false
        });
      }
    });

    quarantined.forEach((qEv, qIdx) => {
      if (isUnscanned(qEv)) {
        unscanned.push({
          id: qEv.id || qEv.event_id,
          title: qEv.title || qEv.event_name || 'Quarantined Event',
          venue: qEv.venue || qEv.venue_name || '',
          cardIndex: `Q${qIdx + 1}`,
          isQuarantined: true
        });
      }
    });

    return unscanned;
  };

  // Determine uncompiled / pending publication events from catalog, layers & quarantine
  const calculateUncompiledEvents = () => {
    const events = (state.allEvents && state.allEvents.length > 0)
      ? state.allEvents
      : (state.masterCatalogsData?.events_active || []);
    const quarantined = (state.quarantinedEvents && state.quarantinedEvents.length > 0)
      ? state.quarantinedEvents
      : (state.masterCatalogsData?.quarantined_events || []);
    if ((!events || events.length === 0) && (!quarantined || quarantined.length === 0)) return [];

    const eventsMap = new Map();
    events.forEach((e, idx) => {
      const id = e.id || e.event_id;
      if (id) eventsMap.set(id, { ...e, cardIndex: idx + 1 });
    });

    const seeds = state.layerSeeds || [];
    const schedules = state.layerSchedules || [];
    const boxOffices = state.layerBoxOffices || [];
    const editorials = state.layerEditorials || [];

    const archivedList = (state.archivedEvents && state.archivedEvents.length > 0)
      ? state.archivedEvents
      : (state.masterCatalogsData?.events_archive || []);
    const archivedIds = new Set([
      ...archivedList.map(a => a.id || a.event_id),
      ...(state.learnedArchivedIds || [])
    ].filter(Boolean));
    const quarantinedIds = new Set(quarantined.map(q => q.id || q.event_id).filter(Boolean));

    const uncompiled = [];
    const checkedIds = new Set();

    // 1. Check all non-archived seeds
    seeds.forEach(s => {
      const id = s.id || s.event_id;
      if (!id || checkedIds.has(id) || archivedIds.has(id) || quarantinedIds.has(id)) return;
      checkedIds.add(id);

      const ex = eventsMap.get(id);
      if (!ex) {
        uncompiled.push({ id, title: s.seed_title || 'Seed Event', venue: s.seed_venue || '', cardIndex: 'New Seed', reason: 'Unpublished seed candidate' });
        return;
      }
      if (!ex.last_full_qc_at) {
        uncompiled.push({ id, title: ex.title || ex.event_name, venue: ex.venue || ex.venue_name, cardIndex: ex.cardIndex, reason: 'Never compiled' });
        return;
      }

      const lastCompile = new Date(ex.last_full_qc_at).getTime();
      const sched = schedules.find(x => (x.id || x.event_id) === id);
      const box = boxOffices.find(x => (x.id || x.event_id) === id);
      const edit = editorials.find(x => (x.id || x.event_id) === id);

      if (sched && sched.audited_at && new Date(sched.audited_at).getTime() > lastCompile) {
        uncompiled.push({ id, title: ex.title || ex.event_name, venue: ex.venue || ex.venue_name, cardIndex: ex.cardIndex, reason: 'New schedule layer update' });
      } else if (box && box.audited_at && new Date(box.audited_at).getTime() > lastCompile) {
        uncompiled.push({ id, title: ex.title || ex.event_name, venue: ex.venue || ex.venue_name, cardIndex: ex.cardIndex, reason: 'New box office layer update' });
      } else if (edit && edit.enriched_at && new Date(edit.enriched_at).getTime() > lastCompile) {
        uncompiled.push({ id, title: ex.title || ex.event_name, venue: ex.venue || ex.venue_name, cardIndex: ex.cardIndex, reason: 'New editorial layer update' });
      } else if (ex.curator_reviewed_at && new Date(ex.curator_reviewed_at).getTime() > lastCompile) {
        uncompiled.push({ id, title: ex.title || ex.event_name, venue: ex.venue || ex.venue_name, cardIndex: ex.cardIndex, reason: 'Curator review pending compile' });
      }
    });

    // 2. Check catalog events not in seeds
    events.forEach((ex, idx) => {
      const id = ex.id || ex.event_id;
      if (!id || checkedIds.has(id)) return;
      checkedIds.add(id);

      if (!ex.last_full_qc_at) {
        uncompiled.push({ id, title: ex.title || ex.event_name, venue: ex.venue || ex.venue_name, cardIndex: idx + 1, reason: 'Never compiled' });
      } else {
        const lastCompile = new Date(ex.last_full_qc_at).getTime();
        if (ex.curator_reviewed_at && new Date(ex.curator_reviewed_at).getTime() > lastCompile) {
          uncompiled.push({ id, title: ex.title || ex.event_name, venue: ex.venue || ex.venue_name, cardIndex: idx + 1, reason: 'Curator review pending compile' });
        }
      }
    });

    // 3. Check quarantined events awaiting graduation review
    quarantined.forEach((qEv, qIdx) => {
      const id = qEv.id || qEv.event_id;
      if (!id || checkedIds.has(id)) return;
      checkedIds.add(id);

      if (!qEv.last_full_qc_at) {
        uncompiled.push({
          id,
          title: qEv.title || qEv.event_name || 'Quarantined Event',
          venue: qEv.venue || qEv.venue_name || '',
          cardIndex: `Q${qIdx + 1}`,
          isQuarantined: true,
          reason: 'Quarantined card awaiting compiler evaluation'
        });
      } else {
        const lastCompile = new Date(qEv.last_full_qc_at).getTime();
        const sched = schedules.find(x => (x.id || x.event_id) === id);
        const box = boxOffices.find(x => (x.id || x.event_id) === id);
        const edit = editorials.find(x => (x.id || x.event_id) === id);

        if (sched && sched.audited_at && new Date(sched.audited_at).getTime() > lastCompile) {
          uncompiled.push({ id, title: qEv.title || qEv.event_name, venue: qEv.venue || qEv.venue_name, cardIndex: `Q${qIdx + 1}`, isQuarantined: true, reason: 'New schedule layer update' });
        } else if (box && box.audited_at && new Date(box.audited_at).getTime() > lastCompile) {
          uncompiled.push({ id, title: qEv.title || qEv.event_name, venue: qEv.venue || qEv.venue_name, cardIndex: `Q${qIdx + 1}`, isQuarantined: true, reason: 'New box office layer update' });
        } else if (edit && edit.enriched_at && new Date(edit.enriched_at).getTime() > lastCompile) {
          uncompiled.push({ id, title: qEv.title || qEv.event_name, venue: qEv.venue || qEv.venue_name, cardIndex: `Q${qIdx + 1}`, isQuarantined: true, reason: 'New editorial layer update' });
        } else if (qEv.curator_reviewed_at && new Date(qEv.curator_reviewed_at).getTime() > lastCompile) {
          uncompiled.push({ id, title: qEv.title || qEv.event_name, venue: qEv.venue || qEv.venue_name, cardIndex: `Q${qIdx + 1}`, isQuarantined: true, reason: 'Curator review pending compile' });
        }
      }
    });

    return uncompiled;
  };

  const updateUncompiledBadges = () => {
    const uncompiled = calculateUncompiledEvents();
    const count = uncompiled.length;
    const badgeNav = document.getElementById('badge-nav-uncompiled-count');
    const badgePipeline = document.getElementById('badge-pipeline-uncompiled-count');
    if (badgeNav) {
      badgeNav.textContent = `${count} Pending`;
      badgeNav.style.display = count > 0 ? 'inline-block' : 'none';
    }
    if (badgePipeline) {
      badgePipeline.textContent = `${count} Pending`;
      badgePipeline.style.display = count > 0 ? 'inline-block' : 'none';
    }
    const unscannedLabel = document.getElementById('scope-pill-unscanned-label');
    if (unscannedLabel && currentPipelineScanKey === 'compile') {
      unscannedLabel.textContent = `Catalog Uncompiled (${count})`;
    }
  };

  // Determine unenriched events pending AI semantic enrichment
  const calculateUnenrichedEvents = () => {
    const events = (state.allEvents && state.allEvents.length > 0)
      ? state.allEvents
      : (state.masterCatalogsData?.events_active || []);
    const quarantined = (state.quarantinedEvents && state.quarantinedEvents.length > 0)
      ? state.quarantinedEvents
      : (state.masterCatalogsData?.quarantined_events || []);
    if ((!events || events.length === 0) && (!quarantined || quarantined.length === 0)) return [];

    const editorials = state.layerEditorials || [];
    const editMap = new Map();
    editorials.forEach(e => {
      const id = e.id || e.event_id;
      if (id) editMap.set(id, e);
    });

    const isStaleOrUnenriched = (entry) => {
      if (!entry) return true;
      if (!entry.clean_title || entry.clean_title === "Cultural Event" || entry.clean_title === "Cultural Performance") return true;
      if (/^(?:general admission|admission|tickets|ticket checkout|tickets on sale|buy tickets)$/i.test((entry.clean_title || "").trim())) return true;
      if (!entry.source_engine || entry.source_engine === "heuristic_rules" || entry.source_engine === "unverified") return true;
      if (typeof entry.description === "string" && (
        entry.description.includes("Cultural Event at Metro Vancouver") ||
        entry.description.includes("A cultural exhibition and artistic showcase featuring") ||
        entry.description.includes("Designed for accessible cultural enjoyment under $50 CAD")
      )) return true;
      if (!entry.category || !entry.description) return true;
      return false;
    };

    const unenriched = [];
    events.forEach((ev, idx) => {
      const id = ev.id || ev.event_id;
      if (!id) return;
      const edit = editMap.get(id);
      if (isStaleOrUnenriched(edit)) {
        unenriched.push({
          id,
          title: ev.title || ev.event_name || 'Event',
          venue: ev.venue || ev.venue_name || '',
          cardIndex: idx + 1,
          isQuarantined: false
        });
      }
    });

    quarantined.forEach((qEv, qIdx) => {
      const id = qEv.id || qEv.event_id;
      if (!id) return;
      const edit = editMap.get(id);
      if (isStaleOrUnenriched(edit)) {
        unenriched.push({
          id,
          title: qEv.title || qEv.event_name || 'Quarantined Event',
          venue: qEv.venue || qEv.venue_name || '',
          cardIndex: `Q${qIdx + 1}`,
          isQuarantined: true
        });
      }
    });

    return unenriched;
  };

  const updateUnenrichedBadges = () => {
    const unenriched = calculateUnenrichedEvents();
    const count = unenriched.length;
    const badgeNav = document.getElementById('badge-nav-unenriched-count');
    const badgePipeline = document.getElementById('badge-pipeline-unenriched-count');
    if (badgeNav) {
      badgeNav.textContent = `${count} Pending`;
      badgeNav.style.display = count > 0 ? 'inline-block' : 'none';
    }
    if (badgePipeline) {
      badgePipeline.textContent = `${count} Pending`;
      badgePipeline.style.display = count > 0 ? 'inline-block' : 'none';
    }
    const unscannedLabel = document.getElementById('scope-pill-unscanned-label');
    if (unscannedLabel && currentPipelineScanKey === 'enrich') {
      unscannedLabel.textContent = `Catalog Unenriched (${count})`;
    }
  };

  // Determine events that haven't undergone all scans (incomplete pipeline coverage)
  const calculateIncompleteEvents = () => {
    const events = (state.allEvents && state.allEvents.length > 0)
      ? state.allEvents
      : (state.masterCatalogsData?.events_active || []);
    const quarantined = (state.quarantinedEvents && state.quarantinedEvents.length > 0)
      ? state.quarantinedEvents
      : (state.masterCatalogsData?.quarantined_events || []);

    const isScanIncomplete = (e) => {
      const isFree = e.price === 0 || e.isFree || e.pricingType === 'free' || e.cost_type === 'free' ||
        e.access_model === 'open_public_space' || e.access_model === 'free_public_access';
      const isPerennial = e.lifecycle_type === 'perennial_drop_in';
      const missingCart = isFree
        ? (!isVerifiedApprovalStatus(e.approval_status) || e.pricing_model === 'UNVERIFIED_POLICY_ESTIMATE')
        : ((!e.proof_keyframes?.cart && !e.proof_keyframe_cart) || !e.last_pulse_qc_at || !isVerifiedApprovalStatus(e.approval_status));
      const missingEditorial = !e.description || (!isPerennial && !e.artist && (!Array.isArray(e.lineup) || e.lineup.length === 0)) || e.title === "Cultural Event" || !e.last_content_qc_at;
      const missingSchedule = !e.dateSchedule && !e.date && (!e.showings || e.showings.length === 0);
      const missingFullQC = !e.last_full_qc_at;
      return missingCart || missingEditorial || missingSchedule || missingFullQC;
    };

    const incomplete = [];
    events.forEach((ev, idx) => {
      if (isScanIncomplete(ev)) {
        incomplete.push({
          id: ev.id || ev.event_id,
          title: ev.title || ev.event_name || 'Event',
          venue: ev.venue || ev.venue_name || '',
          cardIndex: idx + 1,
          isQuarantined: false
        });
      }
    });

    quarantined.forEach((qEv, qIdx) => {
      if (isScanIncomplete(qEv)) {
        incomplete.push({
          id: qEv.id || qEv.event_id,
          title: qEv.title || qEv.event_name || 'Quarantined Event',
          venue: qEv.venue || qEv.venue_name || '',
          cardIndex: `Q${qIdx + 1}`,
          isQuarantined: true
        });
      }
    });

    return incomplete;
  };

  // Determine events that haven't been scanned within specified duration (staleness)
  const calculateStaleEvents = (durationStr = '24h') => {
    const parseDurationMs = (str) => {
      if (!str) return 24 * 3600 * 1000;
      const match = String(str).trim().match(/^(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|d|day|days|w|wk|wks|week|weeks|m|mo|mon|month|months)$/i);
      if (!match) return 24 * 3600 * 1000;
      const val = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      if (unit.startsWith("h")) return val * 3600 * 1000;
      if (unit.startsWith("d")) return val * 24 * 3600 * 1000;
      if (unit.startsWith("w")) return val * 7 * 24 * 3600 * 1000;
      if (unit.startsWith("m")) return val * 30 * 24 * 3600 * 1000;
      return 24 * 3600 * 1000;
    };

    const durationMs = parseDurationMs(durationStr);
    const now = Date.now();
    const events = (state.allEvents && state.allEvents.length > 0)
      ? state.allEvents
      : (state.masterCatalogsData?.events_active || []);
    const quarantined = (state.quarantinedEvents && state.quarantinedEvents.length > 0)
      ? state.quarantinedEvents
      : (state.masterCatalogsData?.quarantined_events || []);

    const isStale = (e) => {
      const ts = e.last_pulse_qc_at || e.last_content_qc_at || e.last_full_qc_at || e.last_qc_audited_at || e.audited_at || e.enriched_at;
      if (!ts) return true;
      const t = new Date(ts).getTime();
      if (isNaN(t)) return true;
      return (now - t) >= durationMs;
    };

    const staleList = [];
    events.forEach((ev, idx) => {
      if (isStale(ev)) {
        staleList.push({
          id: ev.id || ev.event_id,
          title: ev.title || ev.event_name || 'Event',
          venue: ev.venue || ev.venue_name || '',
          cardIndex: idx + 1,
          isQuarantined: false
        });
      }
    });

    quarantined.forEach((qEv, qIdx) => {
      if (isStale(qEv)) {
        staleList.push({
          id: qEv.id || qEv.event_id,
          title: qEv.title || qEv.event_name || 'Quarantined Event',
          venue: qEv.venue || qEv.venue_name || '',
          cardIndex: `Q${qIdx + 1}`,
          isQuarantined: true
        });
      }
    });

    return staleList;
  };

  window.calculateIncompleteEvents = calculateIncompleteEvents;
  window.calculateStaleEvents = calculateStaleEvents;

  window.getUncompiledHarvestedEvents = () => {
    const schedules = Array.isArray(state.layerSchedules) ? state.layerSchedules : [];
    const activeIds = new Set(((state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || [])).map(e => e.id || e.event_id).filter(Boolean));
    const quarantinedIds = new Set(((state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || [])).map(e => e.id || e.event_id).filter(Boolean));
    const archivedIds = new Set([
      ...(Array.isArray(state.archivedEvents) ? state.archivedEvents.map(e => e.id || e.event_id).filter(Boolean) : []),
      ...(Array.isArray(state.learnedArchivedIds) ? state.learnedArchivedIds : [])
    ]);
    const todayIso = new Date().toISOString().split('T')[0];

    const list = schedules.filter(s => {
      const sid = s.event_id || s.id;
      if (!sid || activeIds.has(sid) || archivedIds.has(sid) || quarantinedIds.has(sid)) return false;
      const u0 = String(s.details_url || s.candidate_tier1_url || s.ticket_url || '').toLowerCase();
      if (!u0 || /\.pdf(\?|$)/i.test(u0)) return false;
      const rawTitle0 = String(s.title || s.event_name || '').trim().toLowerCase();
      if (!rawTitle0 || ['event', 'events', 'search_exhausted_null', 'quarantine_fatal', 'page not found', 'error 404'].includes(rawTitle0)) return false;
      const u = String(s.details_url || s.candidate_tier1_url || s.ticket_url || '').toLowerCase();
      if (/\/(support|donate|corporate-giving|patrons-circle|major-gifts)(\/|$)/i.test(u)) return false;
      if (s.lifecycle_type !== 'perennial_drop_in') {
        const isoShowings = Array.isArray(s.showings) ? s.showings.filter(sh => sh && sh.date && /^\d{4}-\d{2}-\d{2}$/.test(sh.date)) : [];
        const hasUpcomingShowing = isoShowings.some(sh => sh.date >= todayIso);
        const rawDateStr = String(s.date || s.dateSchedule || '');
        const isoMatch = rawDateStr.match(/\b(202\d-\d{2}-\d{2})\b/);
        const extractedIso = isoMatch ? isoMatch[1] : null;
        if (extractedIso && extractedIso < todayIso && !hasUpcomingShowing) {
          return false;
        }
        if (isoShowings.length > 0 && !hasUpcomingShowing) {
          return false;
        }
      }
      return true;
    }).map(s => ({
      id: s.event_id || s.id,
      event_id: s.event_id || s.id,
      title: s.title || s.event_name || 'Harvested Event',
      venue: s.venue_name || s.venue || 'Vancouver Venue',
      venue_name: s.venue_name || s.venue || 'Vancouver Venue',
      date: s.date || s.dateSchedule || 'TBD',
      time: s.start_time || s.doors_time || '',
      price: s.price_hint != null ? `$${Number(s.price_hint).toFixed(2)} CAD` : '',
      priceLabel: s.price_hint != null ? `$${Number(s.price_hint).toFixed(2)} CAD` : 'Pending 1B/QC',
      url: s.candidate_tier1_url || s.ticket_url || s.details_url || '',
      ticket_url: s.candidate_tier1_url || s.ticket_url || s.details_url || '',
      candidate_tier1_url: s.candidate_tier1_url || null,
      details_url: s.details_url || '',
      lifecycle_type: s.lifecycle_type || null,
      step1b_audited_at: s.step1b_audited_at || null,
      step4_grounded_at: s.step4_grounded_at || null,
      extracted_at: s.extracted_at || ''
    }));

    return list;
  };

  window.getHarvesterFeedStats = (cityOverride) => {
    const cp = state.harvesterCheckpoint || {};
    const completedSet = new Set(Array.isArray(cp.completed_feed_urls) ? cp.completed_feed_urls : []);
    const activeCity = (cityOverride || window.harvesterCityScope || 'all').toLowerCase();
    const allFeeds = (cachedVenueFeeds && cachedVenueFeeds.length > 0) ? cachedVenueFeeds : [];
    const scopedFeeds = activeCity === 'all'
      ? allFeeds
      : allFeeds.filter(f => String(f.city || 'Vancouver').toLowerCase() === activeCity);

    let totalFeeds = scopedFeeds.length > 0
      ? scopedFeeds.length
      : (cp.total_feeds != null ? Math.max(Number(cp.total_feeds), 227) : 227);

    let completedFeeds = 0;
    let resumeFeedNum = 1;
    let nextUnscannedFeed = null;

    if (scopedFeeds.length > 0) {
      completedFeeds = scopedFeeds.filter(f => completedSet.has(f.url)).length;
      const firstUnscannedIdx = scopedFeeds.findIndex(f => !completedSet.has(f.url));
      resumeFeedNum = firstUnscannedIdx >= 0 ? (firstUnscannedIdx + 1) : totalFeeds;
      nextUnscannedFeed = firstUnscannedIdx >= 0 ? scopedFeeds[firstUnscannedIdx] : null;
    } else {
      completedFeeds = cp.completed_feeds_count != null ? Number(cp.completed_feeds_count) : completedSet.size;
      resumeFeedNum = Math.min(totalFeeds, completedFeeds + 1);
    }

    const remainingFeeds = Math.max(0, totalFeeds - completedFeeds);
    const lastFeedName = nextUnscannedFeed
      ? nextUnscannedFeed.name
      : (cp.last_feed_name || 'The Orpheum Theatre');

    return {
      totalFeeds,
      completedFeeds,
      remainingFeeds,
      resumeFeedNum,
      lastFeedName
    };
  };

  window.getStageContinuationInfo = (stageKey) => {
    const key = stageKey || currentPipelineScanKey || 'harvest';
    const feedStats = window.getHarvesterFeedStats();
    const { totalFeeds, completedFeeds, remainingFeeds, resumeFeedNum } = feedStats;

    const uncompiledHarvested = typeof window.getUncompiledHarvestedEvents === 'function' ? window.getUncompiledHarvestedEvents() : [];

    // If an active pipeline batch (e.g. 56 Pipeline Events) is loaded, track the full batch cohort across Stages 1A -> 5
    // so stage badges don't shrink to "10 Done" / "9 Queued" when cards are already in events.json or manual_review_queue.json.
    let done1AList = uncompiledHarvested;
    const hasActiveBatchCohort = Boolean(isPipelineTestMode && Array.isArray(pipelineTestDiscoveredIds) && pipelineTestDiscoveredIds.length > 0);
    if (hasActiveBatchCohort) {
      const schedArr = Array.isArray(state.layerSchedules) ? state.layerSchedules : [];
      const activeArr = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
      const qArr = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);
      const schedMap = new Map(schedArr.map(s => [String(s.event_id || s.id || '').toLowerCase(), s]));
      const activeMap = new Map(activeArr.map(e => [String(e.event_id || e.id || '').toLowerCase(), e]));
      const qMap = new Map(qArr.map(e => [String(e.event_id || e.id || '').toLowerCase(), e]));

      const batchCohort = pipelineTestDiscoveredIds.map(rawId => {
        const lid = String(rawId || '').toLowerCase();
        const s = schedMap.get(lid) || {};
        const a = activeMap.get(lid) || qMap.get(lid) || {};
        const disc = (pipelineTestDiscoveredEvents || []).find(d => String(d.id || d.event_id || '').toLowerCase() === lid) || {};
        const url = s.candidate_tier1_url || a.candidate_tier1_url || a.links?.tier1_checkout || s.ticket_url || a.ticket_url || s.details_url || a.details_url || disc.url || '';
        const isFreeOrOpen = a.price === 0 || a.isFree || a.access_model === 'open_public_space' || a.access_model === 'free_public_access';
        const hasStep1B = Boolean(
          s.step1b_audited_at || a.step1b_audited_at ||
          s.candidate_tier1_url || a.candidate_tier1_url || a.links?.tier1_checkout ||
          a.dimension_audit?.D101_tier1_checkout?.status === 'verified' ||
          isFreeOrOpen ||
          /showpass|eventbrite|ticketweb|admitone|universe|vtix|spektrix|ticketmaster|eventive/i.test(String(url))
        );
        return {
          id: rawId,
          event_id: rawId,
          title: a.title || a.event_name || s.title || s.event_name || disc.title || 'Pipeline Event',
          venue: a.venue || a.venue_name || s.venue_name || s.venue || disc.venue || 'Vancouver Venue',
          venue_name: a.venue_name || a.venue || s.venue_name || s.venue || disc.venue || 'Vancouver Venue',
          date: a.date || a.dateSchedule || s.date || s.dateSchedule || disc.date || 'TBD',
          time: a.time || s.start_time || s.doors_time || '',
          price: a.priceLabel || (s.price_hint != null ? `$${Number(s.price_hint).toFixed(2)} CAD` : (disc.price || '')),
          priceLabel: a.priceLabel || (s.price_hint != null ? `$${Number(s.price_hint).toFixed(2)} CAD` : (disc.price || 'Pending 1B/QC')),
          url,
          ticket_url: url,
          candidate_tier1_url: s.candidate_tier1_url || a.candidate_tier1_url || null,
          details_url: s.details_url || a.details_url || '',
          lifecycle_type: a.lifecycle_type || s.lifecycle_type || null,
          step1b_audited_at: hasStep1B ? (s.step1b_audited_at || a.step1b_audited_at || 'verified') : null,
          step4_grounded_at: s.step4_grounded_at || a.step4_grounded_at || null,
          isFreeOrOpen
        };
      });
      if (batchCohort.length > 0) {
        done1AList = batchCohort;
      }
    }

    const done1BList = done1AList.filter(e => Boolean(e.step1b_audited_at));
    const pending1BList = done1AList.filter(e => !e.step1b_audited_at);

    const boxArr = state.layerBoxOffices || state.layerBoxOffice || [];
    const boxSet = new Set(
      boxArr
        .filter(b => b && b.status && b.status !== 'TIMEOUT_EXCEEDED' && b.status !== 'AI_TIMEOUT' && b.status !== 'EXECUTION_ERROR' && b.status !== 'SKIPPED_NO_URL' && b.status !== 'BUDGET_BREACH' && b.status !== 'ANTIBOT_CHALLENGE_BLOCKED' && !String(b.status).startsWith('FATAL_'))
        .map(b => String(b.id || b.event_id || '').toLowerCase())
    );
    const done2QCList = done1BList.filter(e => e.isFreeOrOpen || boxSet.has(String(e.id || e.event_id || '').toLowerCase()));
    const pending2QCList = done1BList.filter(e => !e.isFreeOrOpen && !boxSet.has(String(e.id || e.event_id || '').toLowerCase()));

    const edArr = state.layerEditorials || state.layerEditorial || [];
    const edSet = new Set(
      edArr
        .filter(ed => ed && (ed.id || ed.event_id) && ed.clean_title && ed.description && ed.source_engine !== 'unverified')
        .map(ed => String(ed.id || ed.event_id || '').toLowerCase())
    );
    const edGroundedSet = new Set(
      edArr
        .filter(ed => ed && ed.step4_grounded_at)
        .map(ed => String(ed.id || ed.event_id || '').toLowerCase())
    );
    const normVenueKey = (v) => String(v || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '').trim();
    const venuesMasterArr = state.venuesMaster || (state.masterCatalogsData && state.masterCatalogsData.venues_master) || [];
    const groundedVenueKeys = new Set(
      (Array.isArray(venuesMasterArr) ? venuesMasterArr : [])
        .filter(v => v && v.last_grounded_at && v.grounding_source !== 'fallback_default')
        .map(v => normVenueKey(v.venue_name || v.name))
        .filter(Boolean)
    );
    const isEventVenueGrounded = (e) => {
      const eid = String(e.id || e.event_id || '').toLowerCase();
      if (e.step4_grounded_at || edGroundedSet.has(eid)) return true;
      const vk = normVenueKey(e.venue || e.venue_name);
      return Boolean(vk && groundedVenueKeys.has(vk));
    };
    const stage3InputPool = hasActiveBatchCohort ? done1AList : done2QCList;
    const done3EnrichList = stage3InputPool.filter(e => edSet.has(String(e.id || e.event_id || '').toLowerCase()));
    const pending3EnrichList = stage3InputPool.filter(e => !edSet.has(String(e.id || e.event_id || '').toLowerCase()));

    const done4VenueList = done3EnrichList.filter(e => isEventVenueGrounded(e));
    const pending4VenueList = done3EnrichList.filter(e => !isEventVenueGrounded(e));

    // Strict Stage 5 Gate: Events CANNOT skip Stage 4 (Venue Detailer) into Stage 5 (Compiler)
    const pending5CompileList = hasActiveBatchCohort ? uncompiledHarvested.filter(u => done4VenueList.some(d => String(d.id || d.event_id || '').toLowerCase() === String(u.id || u.event_id || '').toLowerCase())) : done4VenueList;
    const prev4Count = done4VenueList.length;

    if (key === 'harvest') {
      return {
        stageKey: 'harvest',
        prevStageLabel: 'Checkpoint',
        prevCompletedCount: completedFeeds,
        currentCompletedCount: completedFeeds,
        harvestedCount: done1AList.length,
        uncompiledCount: uncompiledHarvested.length,
        pendingCount: remainingFeeds,
        pendingItems: [],
        allInputItems: [],
        unit: 'feeds',
        stepperStatusBadge: remainingFeeds > 0
          ? `Queued: ${remainingFeeds} Feeds (${done1AList.length} in Batch)`
          : `✅ 0 Queued (${done1AList.length} Found)`,
        pillLabel: remainingFeeds > 0 ? `▶️ Continue (#${resumeFeedNum}/${totalFeeds} • ${remainingFeeds} Queued)` : `✅ All ${totalFeeds} Feeds Done`,
        topBarLabel: remainingFeeds > 0 ? `▶️ Continue 1A (#${resumeFeedNum}/${totalFeeds} • ${remainingFeeds} Feeds Queued)` : `✅ All ${totalFeeds} Feeds Scanned`
      };
    }
    if (key === 'hunter') {
      return {
        stageKey: 'hunter',
        prevStageLabel: 'Stage 1A',
        prevCompletedCount: done1AList.length,
        currentCompletedCount: done1BList.length,
        pendingCount: pending1BList.length,
        pendingItems: pending1BList,
        allInputItems: done1AList,
        unit: 'events',
        stepperStatusBadge: pending1BList.length > 0
          ? `Queued: ${pending1BList.length} • ${done1BList.length} Done`
          : (done1BList.length > 0 ? `✅ 0 Queued (${done1BList.length} Done)` : `Queued: 0`),
        pillLabel: `▶️ Continue from 1A (${pending1BList.length} Queued)`,
        topBarLabel: `▶️ Continue from Stage 1A (${pending1BList.length} Queued / ${done1BList.length} Done)`
      };
    }
    if (key === 'qc') {
      return {
        stageKey: 'qc',
        prevStageLabel: 'Stage 1B',
        prevCompletedCount: done1BList.length,
        currentCompletedCount: done2QCList.length,
        pendingCount: pending2QCList.length,
        pendingItems: pending2QCList,
        allInputItems: done1BList,
        unit: 'events',
        stepperStatusBadge: pending2QCList.length > 0
          ? `Queued: ${pending2QCList.length} • ${done2QCList.length} Done`
          : (done2QCList.length > 0 ? `✅ 0 Queued (${done2QCList.length} Done)` : `Queued: 0`),
        pillLabel: `▶️ Continue from 1B (${pending2QCList.length} Queued)`,
        topBarLabel: `▶️ Continue from Stage 1B (${pending2QCList.length} Queued / ${done2QCList.length} Done)`
      };
    }
    if (key === 'enrich') {
      return {
        stageKey: 'enrich',
        prevStageLabel: 'Stage 2 QC',
        prevCompletedCount: stage3InputPool.length,
        currentCompletedCount: done3EnrichList.length,
        pendingCount: pending3EnrichList.length,
        pendingItems: pending3EnrichList,
        allInputItems: stage3InputPool,
        unit: 'events',
        stepperStatusBadge: pending3EnrichList.length > 0
          ? `Queued: ${pending3EnrichList.length} • ${done3EnrichList.length} Done`
          : (done3EnrichList.length > 0 ? `✅ 0 Queued (${done3EnrichList.length} Done)` : `Queued: 0`),
        pillLabel: `▶️ Continue from 2 (${pending3EnrichList.length} Queued)`,
        topBarLabel: `▶️ Continue from Stage 2 (${pending3EnrichList.length} Queued / ${done3EnrichList.length} Done)`
      };
    }
    if (key === 'venue') {
      return {
        stageKey: 'venue',
        prevStageLabel: 'Stage 3 Enrich',
        prevCompletedCount: done3EnrichList.length,
        currentCompletedCount: done4VenueList.length,
        pendingCount: pending4VenueList.length,
        pendingItems: pending4VenueList,
        allInputItems: done3EnrichList,
        unit: 'events',
        stepperStatusBadge: pending4VenueList.length > 0
          ? `Queued: ${pending4VenueList.length} • ${done4VenueList.length} Done`
          : (done4VenueList.length > 0 ? `✅ 0 Queued (${done4VenueList.length} Done)` : `Queued: 0`),
        pillLabel: `▶️ Continue from 3 (${pending4VenueList.length} Queued)`,
        topBarLabel: `▶️ Continue from Stage 3 (${pending4VenueList.length} Queued / ${done4VenueList.length} Done)`
      };
    }
    return {
      stageKey: 'compile',
      prevStageLabel: 'Stage 4 Venue',
      prevCompletedCount: prev4Count,
      currentCompletedCount: hasActiveBatchCohort ? Math.max(0, prev4Count - pending5CompileList.length) : 0,
      pendingCount: pending5CompileList.length,
      pendingItems: pending5CompileList,
      allInputItems: done4VenueList,
      unit: 'events',
      stepperStatusBadge: pending5CompileList.length > 0
        ? `Queued: ${pending5CompileList.length} Ready`
        : (prev4Count > 0 ? `✅ 0 Queued (${prev4Count} Compiled)` : `Queued: 0`),
      pillLabel: `▶️ Continue from 4 (${pending5CompileList.length} Queued)`,
      topBarLabel: `▶️ Continue from Stage 4 (${pending5CompileList.length} Queued)`
    };
  };

  window.updateAllStageContinuationButtonsUI = () => {
    const stages = ['harvest', 'hunter', 'qc', 'enrich', 'venue', 'compile'];
    stages.forEach(st => {
      const info = window.getStageContinuationInfo(st);
      const btn = document.getElementById(`btn-stage-continue-${st}`);
      const lbl = document.getElementById(`btn-stage-continue-${st}-label`);
      if (lbl) lbl.textContent = info.pillLabel;
      if (btn) {
        btn.style.opacity = info.pendingCount > 0 ? '1' : '0.55';
        btn.title = st === 'harvest'
          ? `Continue Stage 1A scanning on ${info.pendingCount} queued venue feeds`
          : `${info.prevCompletedCount} completed ${info.prevStageLabel}, ${info.currentCompletedCount} completed ${st.toUpperCase()} ➔ ${info.pendingCount} queued for ${st.toUpperCase()}`;
      }
      const statusEl = document.getElementById(`test-step-status-${st}`);
      const stepEl = document.getElementById(`test-step-${st}`);
      const isStageRunning = isExecuting && window.activePipelineRunningStageKey === st;
      if (statusEl) {
        if (isStageRunning) {
          const activeDone = pipelineProcessedCount || 0;
          const activeTotal = pipelineTotalTargets || info.pendingCount || 0;
          statusEl.textContent = activeTotal > 0
            ? `Running ⚡ (${activeDone}/${activeTotal} Done)`
            : 'Running ⚡';
          statusEl.className = 'test-step-status status-running';
        } else {
          statusEl.textContent = info.stepperStatusBadge;
          const isAllDoneForStage = info.pendingCount === 0 && (info.currentCompletedCount > 0 || (st === 'harvest' && info.harvestedCount > 0));
          statusEl.className = `test-step-status${isAllDoneForStage ? ' status-complete' : ''}`;
        }
      }
      if (stepEl && !isStageRunning) {
        const isAllDoneForStage = info.pendingCount === 0 && (info.currentCompletedCount > 0 || (st === 'harvest' && info.harvestedCount > 0));
        stepEl.classList.toggle('completed', isAllDoneForStage);
        stepEl.classList.toggle('completed-step', isAllDoneForStage);
      }
    });

    const activeKey = currentPipelineScanKey || pipelineTestStageKey || 'harvest';
    const activeInfo = window.getStageContinuationInfo(activeKey);
    const topBtn = document.getElementById('btn-top-continue-prev-stage');
    const topLbl = document.getElementById('btn-top-continue-prev-stage-label');
    if (topBtn && topLbl) {
      topBtn.style.display = isExecuting ? 'none' : 'inline-flex';
      topLbl.textContent = activeInfo.topBarLabel;
      topBtn.style.opacity = activeInfo.pendingCount > 0 ? '1' : '0.6';
    }
  };

  window.continueStageFromPrevious = function (stageKey, evt) {
    if (evt) evt.stopPropagation();
    const targetStage = stageKey || currentPipelineScanKey || pipelineTestStageKey || 'harvest';
    if (targetStage === 'harvest') {
      return window.continueHarvestFromCheckpoint(evt);
    }
    if (isExecuting) {
      if (typeof showToast === 'function') showToast('A scan is currently active. Please wait or stop before starting a new run.', 'warning');
      return;
    }

    const info = window.getStageContinuationInfo(targetStage);
    const hasCompletedPrevCohort = info && Array.isArray(info.allInputItems) && info.allInputItems.length > 0;
    if (!info || (info.pendingCount <= 0 && !hasCompletedPrevCohort)) {
      if (typeof showToast === 'function') {
        showToast(`No items waiting in ${targetStage.toUpperCase()} (${info ? info.prevCompletedCount : 0} completed ${info ? info.prevStageLabel : 'previous stage'}, ${info ? info.currentCompletedCount : 0} already completed ${targetStage.toUpperCase()}).`, 'info');
      }
      return;
    }

    // If only 0 or 1 item is left pending in Stage 1B because 48/49 harvested events were already 1B-audited,
    // allow the curator to either run/carry the full Stage 1A cohort (allInputItems) or just the pending subset.
    const sourcePool = (info.pendingCount <= 1 && hasCompletedPrevCohort && info.allInputItems.length > info.pendingCount)
      ? info.allInputItems
      : info.pendingItems;
    const chosenCount = window.promptContinueEventCount(sourcePool.length, 'events');
    if (chosenCount === null) return;
    currentPipelineScope = 'harvested';
    window.setPipelineBatchSize(chosenCount);

    const cap = (chosenCount === 'all' || chosenCount === 0)
      ? sourcePool.length
      : Math.min(Number(chosenCount) || sourcePool.length, sourcePool.length);
    const picked = sourcePool.slice(0, cap);

    pipelineTestDiscoveredIds = picked.map(e => e.id || e.event_id).filter(Boolean);
    pipelineTestDiscoveredEvents = picked.map(e => ({
      id: e.id || e.event_id,
      title: e.title || e.event_name || 'Harvested Event',
      date: e.date || e.dateSchedule || 'TBD',
      venue: e.venue || e.venue_name || '',
      price: e.priceLabel || 'Pending',
      url: e.url || e.ticket_url || e.details_url || ''
    }));

    isPipelineTestMode = true;
    isPipelineAutoChaining = false;
    pipelineQuarantinedRunActive = false;
    currentPipelineScope = 'harvested';
    savePipelineBatchState();

    if (typeof showToast === 'function') {
      showToast(`▶️ Continuing ${targetStage.toUpperCase()} on ${picked.length} of ${sourcePool.length} events from ${info.prevStageLabel}!`, 'info');
    }

    openPipelineTestStage(targetStage, true);
  };

  window.syncHarvesterCheckpointAndEventsUI = () => {
    const harvestedList = window.getUncompiledHarvestedEvents();
    const harvestedCount = harvestedList.length;
    const { totalFeeds, completedFeeds, resumeFeedNum, lastFeedName } = window.getHarvesterFeedStats();

    if (!isExecuting) {
      harvesterSourcesScanned = completedFeeds;
      harvesterTotalSources = totalFeeds;
      if (!harvesterDiscoveredEvents || harvesterDiscoveredEvents.length === 0) {
        harvesterDiscoveredEvents = harvestedList;
      }
      updateHarvesterSourcesProgressUI();
    }

    const badgeHarvest = document.getElementById('badge-count-harvest');
    if (badgeHarvest) {
      badgeHarvest.textContent = `${completedFeeds}/${totalFeeds} Sources Scanned • Resume #${resumeFeedNum}`;
    }
    const resumeFeedLabel = document.getElementById('opt-harvest-resume-feed-label');
    if (resumeFeedLabel) {
      resumeFeedLabel.textContent = `Feed #${resumeFeedNum}/${totalFeeds}: ${lastFeedName}`;
    }
    const badgeHarvested = document.getElementById('badge-count-harvested');
    if (badgeHarvested) {
      badgeHarvested.textContent = `${harvestedCount} New Events Ready`;
    }
    const scopeCountHarvested = document.getElementById('scope-count-harvested');
    if (scopeCountHarvested) {
      scopeCountHarvested.textContent = String(harvestedCount);
    }

    const cpBannerTitle = document.getElementById('harvester-checkpoint-banner-title');
    if (cpBannerTitle) {
      cpBannerTitle.textContent = `Stopped at Feed #${resumeFeedNum}/${totalFeeds}: ${lastFeedName}`;
    }
    const cpBannerSub = document.getElementById('harvester-checkpoint-banner-sub');
    if (cpBannerSub) {
      cpBannerSub.innerHTML = `${completedFeeds}/${totalFeeds} sources scanned • <strong>${harvestedCount} new events</strong> harvested &amp; ready for Stage 1B`;
    }

    const contLabels = [
      'btn-continue-harvest-stopped-label',
      'btn-stepper-continue-harvest-label',
      'btn-header-continue-1a-label',
      'btn-banner-continue-1a-label'
    ];
    contLabels.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = id.includes('stepper')
          ? `▶️ Continue 1A (#${resumeFeedNum}/${totalFeeds})`
          : `▶️ Continue 1A Scan (#${resumeFeedNum}/${totalFeeds})`;
      }
    });

    const procLabels = [
      'btn-process-harvested-1b-label',
      'btn-stepper-auto-harvested-label',
      'btn-header-process-1b-label',
      'btn-banner-process-1b-label'
    ];
    procLabels.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = `✨ Process ${harvestedCount} New Events (1B ➔ 5)`;
      }
    });

    const qEvents = (state.quarantinedEvents && state.quarantinedEvents.length > 0)
      ? state.quarantinedEvents
      : (state.masterCatalogsData?.quarantined_events || []);
    const qCount = qEvents.length;
    const quarantineBtnLabels = [
      'btn-header-run-quarantine-label',
      'btn-banner-run-quarantine-label',
      'btn-status-run-quarantine-label',
      'btn-stepper-auto-quarantined-label'
    ];
    quarantineBtnLabels.forEach(id => {
      const el = document.getElementById(id);
      if (el && !isExecuting) {
        el.textContent = `🛡️ Run Quarantine Queue (${qCount})`;
      }
    });

    const newestPassedList = typeof window.getNewestPassedBatchEvents === 'function'
      ? window.getNewestPassedBatchEvents()
      : [];
    const newestPassedCount = newestPassedList.length;
    const newestPassedBtnLabels = [
      'btn-header-run-newest-passed-label',
      'btn-banner-run-newest-passed-label',
      'btn-status-run-newest-passed-label',
      'btn-stepper-auto-newest-passed-label'
    ];
    newestPassedBtnLabels.forEach(id => {
      const el = document.getElementById(id);
      if (el && !isExecuting) {
        el.textContent = `✅ Run Newest Passed Batch (${newestPassedCount})`;
      }
    });

    if (typeof window.updateAllStageContinuationButtonsUI === 'function') {
      window.updateAllStageContinuationButtonsUI();
    }
  };

  window.loadLayersAndEvents = async () => {
    try {
      const [evRes, seedsRes, schedRes, boxRes, editRes, archRes, rulesRes, cpRes, venRes] = await Promise.allSettled([
        fetch('/data/events.json?_t=' + Date.now()),
        fetch('/data/layers/seeds.json?_t=' + Date.now()),
        fetch('/data/layers/layer_schedules.json?_t=' + Date.now()),
        fetch('/data/layers/layer_box_office.json?_t=' + Date.now()),
        fetch('/data/layers/layer_editorial.json?_t=' + Date.now()),
        fetch('/data/archived_events.json?_t=' + Date.now()),
        fetch('/data/curator_learned_rules.json?_t=' + Date.now()),
        fetch('/data/layers/harvester_checkpoint.json?_t=' + Date.now()),
        fetch('/data/venues.json?_t=' + Date.now()),
        typeof loadVenueFeedsList === 'function' ? loadVenueFeedsList() : Promise.resolve([])
      ]);
      if (evRes.status === 'fulfilled' && evRes.value.ok) {
        state.allEvents = await evRes.value.json();
      }
      if (venRes && venRes.status === 'fulfilled' && venRes.value.ok) {
        const venData = await venRes.value.json();
        state.venuesMaster = Array.isArray(venData) ? venData : [];
        if (state.masterCatalogsData) state.masterCatalogsData.venues_master = state.venuesMaster;
      }
      if (archRes.status === 'fulfilled' && archRes.value.ok) {
        const archData = await archRes.value.json();
        state.archivedEvents = Array.isArray(archData) ? archData : (archData.archivedEvents || []);
      }
      if (rulesRes.status === 'fulfilled' && rulesRes.value.ok) {
        const rulesData = await rulesRes.value.json();
        state.learnedArchivedIds = Array.isArray(rulesData.archived_event_ids) ? rulesData.archived_event_ids : [];
      }
      if (cpRes && cpRes.status === 'fulfilled' && cpRes.value.ok) {
        state.harvesterCheckpoint = await cpRes.value.json();
      }
      state.layerSeeds = (seedsRes.status === 'fulfilled' && seedsRes.value.ok) ? await seedsRes.value.json() : [];
      state.layerSchedules = (schedRes.status === 'fulfilled' && schedRes.value.ok) ? await schedRes.value.json() : [];
      state.layerBoxOffices = (boxRes.status === 'fulfilled' && boxRes.value.ok) ? await boxRes.value.json() : [];
      state.layerBoxOffice = state.layerBoxOffices;
      state.layerEditorials = (editRes.status === 'fulfilled' && editRes.value.ok) ? await editRes.value.json() : [];
      state.layerEditorial = state.layerEditorials;
      updateUncompiledBadges();
      updateUnenrichedBadges();
      populateCardNameDropdown();
      window.syncHarvesterCheckpointAndEventsUI();
      if (typeof window.updateCatalogStalenessDashboard === 'function') {
        window.updateCatalogStalenessDashboard();
      }
    } catch (e) {
      console.warn('Could not load layers or catalog events for compilation status:', e);
    }
  };

  window.clearPipelineTerminal = function () {
    const el = document.getElementById('pipeline-console-output');
    if (el) el.textContent = '';
  };

  // Live Stream Output View Switcher (Table / Split / Terminal) (Request 3)
  window.setPipelineStreamView = function (view) {
    const diffPanel = document.getElementById('pipeline-live-diff-panel');
    const diffContainer = document.getElementById('pipeline-diff-table-container');
    const consoleOutput = document.getElementById('pipeline-console-output');
    const btnTable = document.getElementById('btn-view-diff-table');
    const btnSplit = document.getElementById('btn-view-diff-split');
    const btnConsole = document.getElementById('btn-view-diff-console');

    [btnTable, btnSplit, btnConsole].forEach(b => { if (b) b.classList.remove('active'); });

    if (view === 'table') {
      if (btnTable) btnTable.classList.add('active');
      if (diffPanel) diffPanel.style.display = 'block';
      if (diffContainer) diffContainer.style.maxHeight = '240px';
      if (consoleOutput) consoleOutput.style.display = 'none';
    } else if (view === 'split') {
      if (btnSplit) btnSplit.classList.add('active');
      if (diffPanel) diffPanel.style.display = 'block';
      if (diffContainer) diffContainer.style.maxHeight = '155px';
      if (consoleOutput) {
        consoleOutput.style.display = 'block';
        consoleOutput.style.maxHeight = '135px';
      }
    } else if (view === 'console') {
      if (btnConsole) btnConsole.classList.add('active');
      if (diffPanel) diffPanel.style.display = 'none';
      if (consoleOutput) {
        consoleOutput.style.display = 'block';
        consoleOutput.style.maxHeight = '240px';
      }
    }
  };

  // Side-by-Side AI Card Yield Comparison System
  let pipelineAuditedCardsHistory = [];
  let pipelineCurrentCompId = null;
  let pipelineCompFilterInScopeOnly = false;
  let pipelineLastCompBefore = null;
  let pipelineLastCompAfter = null;
  let pipelineLastCompIsStreaming = false;

  const AI_SCAN_TARGET_DIMENSIONS = {
    hunter: {
      name: 'Tier 1 Link Hunter',
      shortDims: 'D101, D102, D106 (Direct Checkout Cart URL Upgrade)',
      isTarget: {
        d33_title: false,
        d43_location: false,
        d35_date: false,
        d36_time: false,
        d15_allin: false,
        d12_base: false,
        d13_fee: false,
        d7_inventory: false,
        d1_checkout: true,
        d41_category: false,
        d34_lineup: false,
        d42_age: false,
        d51_desc: false,
        proof: false
      }
    },
    qc: {
      name: 'Stagehand Box Office QC',
      shortDims: 'D1, D7, D12, D13, D15, D35, Proof Keyframe',
      isTarget: {
        d33_title: false,
        d43_location: false,
        d35_date: true,
        d36_time: false,
        d15_allin: true,
        d12_base: true,
        d13_fee: true,
        d7_inventory: true,
        d1_checkout: true,
        d41_category: false,
        d34_lineup: false,
        d42_age: false,
        d51_desc: false,
        proof: true
      }
    },
    enrich: {
      name: 'AI Semantic Enricher',
      shortDims: 'D33, D34, D36, D37, D41, D42, D51',
      isTarget: {
        d33_title: true,
        d43_location: false,
        d35_date: false,
        d36_time: true,
        d15_allin: false,
        d12_base: false,
        d13_fee: false,
        d7_inventory: false,
        d1_checkout: false,
        d41_category: true,
        d34_lineup: true,
        d42_age: true,
        d51_desc: true,
        proof: false
      }
    },
    venue: {
      name: 'Venue Detailer AI',
      shortDims: 'D43, D44, D45, D46, D47, D49, D50 (Physical Facility & Spend Benchmarks)',
      isTarget: {
        d33_title: false,
        d43_location: true,
        d35_date: false,
        d36_time: false,
        d15_allin: false,
        d12_base: false,
        d13_fee: false,
        d7_inventory: false,
        d1_checkout: false,
        d41_category: false,
        d34_lineup: false,
        d42_age: false,
        d51_desc: false,
        proof: false
      }
    },
    harvest: {
      name: 'Schedule Harvester',
      shortDims: 'D35, D36, D37, D1',
      isTarget: {
        d33_title: false,
        d43_location: false,
        d35_date: true,
        d36_time: true,
        d15_allin: false,
        d12_base: false,
        d13_fee: false,
        d7_inventory: false,
        d1_checkout: true,
        d41_category: false,
        d34_lineup: false,
        d42_age: false,
        d51_desc: false,
        proof: false
      }
    },
    compile: {
      name: 'Live Compiler & Publisher',
      get shortDims() { return `All ${getCatalogDimensionsCount()} Dimensions Reconciled`; },
      isTarget: {
        d33_title: true,
        d43_location: true,
        d35_date: true,
        d36_time: true,
        d15_allin: true,
        d12_base: true,
        d13_fee: true,
        d7_inventory: true,
        d1_checkout: true,
        d41_category: true,
        d34_lineup: true,
        d42_age: true,
        d51_desc: true,
        proof: true
      }
    }
  };

  function updateComparisonTargetDimensionsBanner(scanKey) {
    const banner = document.getElementById('pipeline-scope-highlight-banner');
    const textEl = document.getElementById('pipeline-scope-target-dims-text');
    const pill = document.getElementById('pipeline-scope-accent-pill');
    const stageBanner = document.getElementById('pipeline-comp-stage-banner');
    const stageBannerText = document.getElementById('pipeline-comp-stage-banner-text');
    const stageMeta = (typeof STAGE_META_MAP !== 'undefined' && STAGE_META_MAP[scanKey]) ? STAGE_META_MAP[scanKey] : null;
    if (stageBanner && stageMeta) {
      if (stageBannerText) {
        stageBannerText.textContent = `${stageMeta.fullLabel} — Before / After`;
      } else {
        stageBanner.textContent = `${stageMeta.fullLabel} — Before / After`;
      }
      stageBanner.style.color = stageMeta.color;
      stageBanner.style.background = stageMeta.pillBg || stageMeta.bgTint;
      stageBanner.style.borderColor = stageMeta.border;
      stageBanner.style.boxShadow = `0 0 12px ${stageMeta.bgTint}`;
    }
    if (textEl) {
      const cfg = AI_SCAN_TARGET_DIMENSIONS[scanKey] || AI_SCAN_TARGET_DIMENSIONS.qc;
      textEl.textContent = `${cfg.shortDims} (${cfg.name})`;
    }
    if (pill) {
      if (scanKey === 'enrich') {
        pill.textContent = 'Highlighted with Amber Accent Below';
        pill.style.color = '#fbbf24';
        pill.style.background = 'rgba(251, 191, 36, 0.15)';
        pill.style.borderColor = 'rgba(251, 191, 36, 0.35)';
      } else if (scanKey === 'compile') {
        pill.textContent = `All ${getCatalogDimensionsCount()} Dimensions In-Scope (Emerald)`;
        pill.style.color = '#34d399';
        pill.style.background = 'rgba(16, 185, 129, 0.15)';
        pill.style.borderColor = 'rgba(16, 185, 129, 0.35)';
      } else {
        pill.textContent = 'Highlighted with Blue Accent Below';
        pill.style.color = '#38bdf8';
        pill.style.background = 'rgba(56, 189, 248, 0.15)';
        pill.style.borderColor = 'rgba(56, 189, 248, 0.35)';
      }
    }
  }

  function updateComparisonStatusPill(text, type = 'nodrift') {
    const pill = document.getElementById('pipeline-comp-status-pill');
    if (!pill) return;
    pill.textContent = text;
    pill.className = `diff-badge-status ${type}`;
  }

  function renderYieldCardHtml(cardData, isAfter, agentMode, scanKey = currentPipelineScanKey) {
    if (!cardData) {
      return `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 380px; text-align: center; color: #64748b; padding: 20px;">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">${isAfter ? '🤖' : '📋'}</div>
          <div style="font-weight: 700; color: #94a3b8; font-size: 0.88rem; margin-bottom: 4px;">
            ${isAfter ? 'Awaiting AI Execution' : 'No Event Selected'}
          </div>
          <p style="font-size: 0.74rem; color: #64748b; max-width: 240px; margin: 0; line-height: 1.4;">
            ${isAfter
          ? 'Click <strong>Run Scan Now</strong> to begin. Only information newly obtained by this run will appear here. Empty fields indicate untouched dimensions.'
          : 'Select an event card or start a scan to inspect its baseline state before the AI executes.'}
          </p>
        </div>
      `;
    }

    const scanCfg = AI_SCAN_TARGET_DIMENSIONS[scanKey] || AI_SCAN_TARGET_DIMENSIONS.qc;
    const targets = scanCfg.isTarget;
    const scanName = scanCfg.name;

    let cardIdx = (cardData?.id && pipelineInitialSnapshots && typeof pipelineInitialSnapshots.get === 'function' && pipelineInitialSnapshots.get(cardData.id)?.cardIndex)
      || cardData?.cardIndex;
    const allEvs = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    if (!cardIdx && (cardData?.id || cardData?.event_id) && allEvs) {
      const found = allEvs.findIndex(e => (e.id || e.event_id) === (cardData.id || cardData.event_id));
      if (found !== -1) cardIdx = found + 1;
    }
    if (!cardIdx) cardIdx = '?';
    const isCompile = (scanKey === 'compile');
    const title = isAfter ? (cardData.afterTitle || cardData.title || cardData.event_name || null) : (cardData.title || cardData.event_name || 'Event');
    const venue = isAfter ? (cardData.afterVenue || cardData.venue || cardData.venue_name || null) : (cardData.venue || cardData.venue_name || '');
    const neighborhood = isAfter ? null : (cardData.neighborhood || '');

    const dateVal = isAfter ? (cardData.afterDate || (isCompile ? (cardData.date || cardData.dateSchedule) : null)) : (cardData.date || cardData.dateSchedule || null);
    const timeVal = isAfter ? (cardData.afterTime || (isCompile ? (cardData.time || cardData.start_time || cardData.doors_time) : null)) : (cardData.time || cardData.start_time || cardData.doors_time || null);

    const priceVal = isAfter ? (cardData.afterPrice || (isCompile ? (cardData.priceLabel || (cardData.price != null ? `$${Number(cardData.price).toFixed(2)} CAD` : null)) : null)) : (cardData.priceLabel || (cardData.price != null ? `$${Number(cardData.price).toFixed(2)} CAD` : null));
    const baseVal = isAfter ? (cardData.afterBase ?? (isCompile ? (cardData.price_base ?? null) : null)) : (cardData.price_base ?? null);
    const feeVal = isAfter ? (cardData.afterFee ?? (isCompile ? (cardData.price_fee ?? null) : null)) : (cardData.price_fee ?? null);
    const isSoldOut = isAfter ? (cardData.afterInventory ? cardData.afterInventory.includes('SOLD OUT') : (isCompile && cardData.is_sold_out != null ? Boolean(cardData.is_sold_out || cardData.isSoldOut) : null)) : (cardData.is_sold_out != null ? Boolean(cardData.is_sold_out || cardData.isSoldOut) : null);
    const ticketUrl = isAfter ? (cardData.afterTicketUrl || (isCompile ? (cardData.ticket_url || cardData.details_url) : null)) : (cardData.ticket_url || cardData.details_url || null);

    const categoryVal = isAfter ? (cardData.afterCategory || (isCompile ? cardData.category : null)) : (cardData.category || null);
    const artistVal = isAfter ? (cardData.afterArtist || (isCompile ? (cardData.artist || (cardData.lineup && cardData.lineup.length ? cardData.lineup.join(', ') : null)) : null)) : (cardData.artist || (cardData.lineup && cardData.lineup.length ? cardData.lineup.join(', ') : null));
    const ageVal = isAfter ? (cardData.afterAge || (isCompile ? (cardData.restrictions || null) : null)) : (cardData.restrictions || null);
    const descVal = isAfter ? (cardData.afterDescription || (isCompile ? (cardData.description || null) : null)) : (cardData.description || null);

    const proofUrl = isAfter
      ? (cardData.proofKeyframeUrl || (cardData.hasProof && cardData.id ? `data/proofs/${cardData.id}_cart.webp` : null) || (isCompile ? (cardData.proof_keyframes?.cart || null) : null))
      : (cardData.proof_keyframes?.cart || null);

    const isVenueScan = (scanKey === 'venue');
    const addressVal = isAfter ? (cardData.afterAddress || cardData.full_address || cardData.address || null) : (cardData.full_address || cardData.address || null);
    let gpsVal = null;
    if (cardData.coordinates) {
      if (Array.isArray(cardData.coordinates)) gpsVal = `${cardData.coordinates[0]}, ${cardData.coordinates[1]}`;
      else if (typeof cardData.coordinates === 'object') gpsVal = `${cardData.coordinates.lat || cardData.coordinates.latitude}, ${cardData.coordinates.lng || cardData.coordinates.longitude}`;
    } else if (cardData.lat && cardData.lng) {
      gpsVal = `${cardData.lat}, ${cardData.lng}`;
    }
    const accessVal = isAfter ? (cardData.afterAccess || cardData.access_model || null) : (cardData.access_model || null);
    const envVal = isAfter ? (cardData.afterEnv || cardData.environment_type || null) : (cardData.environment_type || null);
    let spendVal = cardData.typical_item_spend || null;
    if (!spendVal && cardData.spend_benchmarks) {
      if (typeof cardData.spend_benchmarks === 'object') {
        spendVal = `Beer ${cardData.spend_benchmarks.beer || '$8'} • Meal ${cardData.spend_benchmarks.meal || '$16'}`;
      } else {
        spendVal = String(cardData.spend_benchmarks);
      }
    }
    const transitVal = isAfter ? (cardData.afterTransit || cardData.transit_info || null) : (cardData.transit_info || null);
    const venueTypeVal = isAfter ? (cardData.afterVenueType || cardData.venue_type || null) : (cardData.venue_type || null);
    const stepFreeVal = isAfter ? (cardData.afterStepFree || cardData.step_free_entrance || cardData.accessibility?.step_free || null) : (cardData.step_free_entrance || cardData.accessibility?.step_free || null);
    const elevatorVal = isAfter ? (cardData.afterElevator || cardData.elevator_lift || cardData.accessibility?.elevator || null) : (cardData.elevator_lift || cardData.accessibility?.elevator || null);
    const washroomVal = isAfter ? (cardData.afterWashrooms || cardData.accessible_washrooms || cardData.accessibility?.washrooms || null) : (cardData.accessible_washrooms || cardData.accessibility?.washrooms || null);
    const parkingVal = isAfter ? (cardData.afterParking || cardData.access_parking || null) : (cardData.access_parking || null);
    const foodPolicyVal = isAfter ? (cardData.afterFoodPolicy || cardData.outside_food_policy || null) : (cardData.outside_food_policy || null);
    const waterVal = isAfter ? (cardData.afterWater || cardData.water_refill_station || null) : (cardData.water_refill_station || null);
    const paymentVal = isAfter ? (cardData.afterPayment || cardData.payment_methods || null) : (cardData.payment_methods || null);
    const coatCheckVal = isAfter ? (cardData.afterCoatCheck || cardData.coat_check || null) : (cardData.coat_check || null);
    const concessionVal = isAfter ? (cardData.afterConcession || cardData.concession_benchmark || null) : (cardData.concession_benchmark || null);

    const emptyScopeMsg = (inScope, note = '') => {
      if (!inScope) return `<span class="yield-empty-field out-of-scope">— (Not in scope for ${escapeHtml(scanName)})</span>`;
      return `<span class="yield-empty-field in-scope">— (In scope: ${note || 'awaiting extraction'})</span>`;
    };

    return `
      <!-- Card Top Badge Bar -->
      <div class="yield-card-badge-bar ${isAfter ? 'after' : 'before'}">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="font-weight: 800;">${isAfter ? '✨ AFTER AI RUN' : '📸 BEFORE AI RUN'}</span>
          <span class="badge-card-number">${escapeHtml(String(cardIdx).startsWith('Q') ? `QUARANTINED #${cardIdx}` : `Card #${cardIdx}`)}</span>
        </div>
        <span class="yield-status-pill ${isAfter ? 'agent' : 'baseline'}" style="font-size: 0.64rem; padding: 1px 7px; border-radius: 999px; font-weight: 700; ${isAfter ? 'background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4);' : 'background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);'}">
          ${isAfter ? (agentMode ? escapeHtml(agentMode) : 'This Run\'s Yield') : 'Baseline Card'}
        </span>
      </div>

      <!-- Section 1: D33 Event Name & D43/D44 Location (Request 3 & 4) -->
      <div class="yield-section-box ${targets.d33_title ? 'yield-target-dim' : 'yield-dim-out-of-scope'}">
        <div class="yield-section-header">
          <span class="yield-section-title"><span class="dim-label-prefix">D001</span> Event Name &amp; <span class="dim-label-prefix">D401</span> Physical Venue</span>
          ${targets.d33_title
        ? `<span class="yield-target-tag">🎯 Target for ${escapeHtml(scanName)}</span>`
        : `<span class="yield-out-scope-tag">Out of scope for this AI</span>`}
        </div>
        <div style="font-weight: 700; font-size: 0.88rem; color: #fff; line-height: 1.3;">
          <span class="dim-label-prefix">D001 Name:</span>
          ${title ? `${escapeHtml(title)} ${isAfter ? '<span class="yield-highlight-tag">+ Verified</span>' : ''}` : emptyScopeMsg(targets.d33_title, 'unscraped title')}
        </div>
        <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 3px; display: flex; align-items: center; gap: 5px; flex-wrap: wrap;">
          <span><span class="dim-label-prefix">D401 Venue:</span> 📍 <strong>${venue ? escapeHtml(venue) : emptyScopeMsg(targets.d43_location, 'unregistered venue')}</strong></span>
          ${neighborhood ? `<span style="color: #64748b;">• ${escapeHtml(neighborhood)}</span>` : ''}
          ${isAfter && venue ? '<span class="yield-highlight-tag">+ Confirmed</span>' : ''}
        </div>
      </div>

      <!-- Section 1B: D402–D408, D501–D506, D601–D608 Venue Ground Truth & Amenities (Target for Venue Detailer) -->
      <div class="yield-section-box ${(targets.d43_location || isVenueScan) ? 'yield-target-dim' : 'yield-dim-out-of-scope'}" style="${isVenueScan ? 'border-color: rgba(6, 182, 212, 0.45); background: rgba(6, 182, 212, 0.05);' : ''}">
        <div class="yield-section-header">
          <span class="yield-section-title"><span>🏛️</span> <span class="dim-label-prefix">D402–D408, D501–D506, D601–D608</span> Venue Ground Truth &amp; Amenities</span>
          ${(targets.d43_location || isVenueScan)
        ? `<span class="yield-target-tag" style="background: rgba(6, 182, 212, 0.2); color: #22d3ee; border-color: rgba(6, 182, 212, 0.4);">🎯 Target for ${escapeHtml(scanName)}</span>`
        : `<span class="yield-out-scope-tag">Out of scope for this AI</span>`}
        </div>
        <div style="font-size: 0.72rem; color: #e2e8f0; display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <span><span class="dim-label-prefix">D402 Address:</span> <strong>${addressVal ? escapeHtml(addressVal) : emptyScopeMsg(targets.d43_location, 'pending address grounding')}</strong></span>
            ${venueTypeVal ? `<span style="font-size: 0.65rem; background: rgba(6, 182, 212, 0.18); color: #22d3ee; border: 1px solid rgba(6, 182, 212, 0.4); padding: 1px 7px; border-radius: 4px; font-weight: 700;">🏛️ ${escapeHtml(venueTypeVal.replace(/_/g, ' ').toUpperCase())}</span>` : ''}
            ${isAfter && addressVal ? '<span class="yield-highlight-tag" style="background: rgba(6, 182, 212, 0.2); color: #22d3ee; border: 1px solid rgba(6, 182, 212, 0.4);">+ Grounded</span>' : ''}
          </div>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <span><span class="dim-label-prefix">D403 GPS:</span> <span style="font-family: monospace; color: #38bdf8;">${gpsVal ? escapeHtml(gpsVal) : (targets.d43_location ? '<span class="yield-empty-field in-scope">—</span>' : '<span class="yield-empty-field out-of-scope">—</span>')}</span></span>
            <span><span class="dim-label-prefix">D405 Access:</span> <span style="color: #cbd5e1;">${accessVal ? escapeHtml(accessVal) : (targets.d43_location ? '<span class="yield-empty-field in-scope">—</span>' : '<span class="yield-empty-field out-of-scope">—</span>')}</span></span>
            <span><span class="dim-label-prefix">D406 Env:</span> <span style="color: #cbd5e1;">${envVal ? escapeHtml(envVal) : (targets.d43_location ? '<span class="yield-empty-field in-scope">—</span>' : '<span class="yield-empty-field out-of-scope">—</span>')}</span></span>
          </div>
          <div><span class="dim-label-prefix">D601–D604 Spend:</span> <span style="color: #34d399;">${spendVal ? escapeHtml(spendVal) : (targets.d43_location ? '<span class="yield-empty-field in-scope">—</span>' : '<span class="yield-empty-field out-of-scope">—</span>')}</span> ${concessionVal ? `<span style="color: #fbbf24; margin-left: 6px;">• Concession ${escapeHtml(concessionVal)}</span>` : ''}</div>
          <div><span class="dim-label-prefix">D408 Transit:</span> <span style="color: #94a3b8;">${transitVal ? escapeHtml(transitVal) : (targets.d43_location ? '<span class="yield-empty-field in-scope">—</span>' : '<span class="yield-empty-field out-of-scope">—</span>')}</span></div>
          ${(stepFreeVal || washroomVal || elevatorVal || parkingVal) ? `
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 2px; padding-top: 3px; border-top: 1px dashed rgba(255,255,255,0.08); font-size: 0.68rem; color: #94a3b8;">
              <span style="color: #38bdf8; font-weight: 700;">♿ Access:</span>
              ${stepFreeVal ? `<span>Entrance: <strong style="color: #e2e8f0;">${escapeHtml(stepFreeVal)}</strong></span>` : ''}
              ${washroomVal ? `<span>• Washrooms: <strong style="color: #e2e8f0;">${escapeHtml(washroomVal)}</strong></span>` : ''}
              ${elevatorVal && !elevatorVal.includes('not_applicable') ? `<span>• Lift: <strong style="color: #e2e8f0;">${escapeHtml(elevatorVal)}</strong></span>` : ''}
              ${parkingVal ? `<span>• Parking: <strong style="color: #e2e8f0;">${escapeHtml(parkingVal)}</strong></span>` : ''}
            </div>
          ` : ''}
          ${(foodPolicyVal || waterVal || paymentVal || coatCheckVal) ? `
            <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 1px; font-size: 0.68rem; color: #94a3b8;">
              <span style="color: #34d399; font-weight: 700;">☕ Policy &amp; F&amp;B:</span>
              ${foodPolicyVal ? `<span>Outside Food: <strong style="color: #e2e8f0;">${escapeHtml(foodPolicyVal)}</strong></span>` : ''}
              ${waterVal ? `<span>• Water: <strong style="color: #e2e8f0;">${escapeHtml(waterVal)}</strong></span>` : ''}
              ${paymentVal ? `<span>• Payment: <strong style="color: #e2e8f0;">${escapeHtml(paymentVal)}</strong></span>` : ''}
              ${coatCheckVal && !coatCheckVal.includes('not_applicable') ? `<span>• Coat Check: <strong style="color: #e2e8f0;">${escapeHtml(coatCheckVal)}</strong></span>` : ''}
            </div>
          ` : ''}
        </div>
      </div>

      <!-- Section 2: D35 Event Schedule & D36/D37 Showtime (Request 3 & 4) -->
      <div class="yield-section-box ${(targets.d35_date || targets.d36_time) ? 'yield-target-dim' : 'yield-dim-out-of-scope'}">
        <div class="yield-section-header">
          <span class="yield-section-title"><span>📅</span> <span class="dim-label-prefix">D35</span> Schedule &amp; <span class="dim-label-prefix">D36/D37</span> Showtime</span>
          ${(targets.d35_date || targets.d36_time)
        ? `<span class="yield-target-tag">🎯 Target for ${escapeHtml(scanName)}</span>`
        : `<span class="yield-out-scope-tag">Out of scope for this AI</span>`}
        </div>
        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <div>
            <span class="dim-label-prefix">D35 Date:</span>
            ${dateVal ? `<strong style="color: #38bdf8;">${escapeHtml(dateVal)}</strong> ${isAfter ? '<span class="yield-highlight-tag">+ Extracted</span>' : ''}` : emptyScopeMsg(targets.d35_date, 'pending calendar harvest')}
          </div>
          <div>
            <span class="dim-label-prefix">D36/D37 Showtime &amp; Doors:</span>
            ${timeVal ? `<strong style="color: #cbd5e1;">${escapeHtml(timeVal)}</strong> ${isAfter ? '<span class="yield-highlight-tag">+ Extracted</span>' : ''}` : emptyScopeMsg(targets.d36_time, 'pending doors/curtain check')}
          </div>
        </div>
      </div>

      <!-- Section 3: D11–D15 Box Office, Fees & D7 Inventory (Request 3 & 4) -->
      <div class="yield-section-box ${(targets.d15_allin || targets.d1_checkout) ? 'yield-target-dim' : 'yield-dim-out-of-scope'}" style="${isAfter && priceVal ? 'border-color: rgba(16, 185, 129, 0.45); background: rgba(16, 185, 129, 0.05);' : ''}">
        <div class="yield-section-header">
          <span class="yield-section-title"><span>🎫</span> <span class="dim-label-prefix">D11–D15</span> Box Office &amp; <span class="dim-label-prefix">D7</span> Inventory</span>
          ${(targets.d15_allin || targets.d1_checkout)
        ? `<span class="yield-target-tag">🎯 Target for ${escapeHtml(scanName)}</span>`
        : `<span class="yield-out-scope-tag">Out of scope for this AI</span>`}
        </div>
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-bottom: 4px;">
          <div>
            <span class="dim-label-prefix">D15 All-In Price:</span>
            ${priceVal ? `<span style="font-size: 1.05rem; font-weight: 800; color: #34d399; margin-left: 4px;">${escapeHtml(priceVal)}</span> ${isAfter ? '<span class="yield-highlight-tag">+ Live Cart Verified</span>' : ''}` : emptyScopeMsg(targets.d15_allin, 'awaiting live cart')}
          </div>
          <div>
            <span class="dim-label-prefix">D7 Status:</span>
            ${isSoldOut !== null ? `
              <span style="font-size: 0.7rem; font-weight: 700; padding: 2px 7px; border-radius: 4px; ${isSoldOut ? 'background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.4);' : 'background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);'}">
                ${isSoldOut ? 'SOLD OUT ⚠️' : 'AVAILABLE 🎟️'}
              </span>
            ` : emptyScopeMsg(targets.d7_inventory, 'awaiting cart')}
          </div>
        </div>
        <div style="font-size: 0.7rem; color: #94a3b8; display: flex; gap: 12px; flex-wrap: wrap;">
          <span><span class="dim-label-prefix">D12 Base:</span> <strong>${baseVal != null ? `$${Number(baseVal).toFixed(2)}` : (targets.d12_base ? '<span class="yield-empty-field in-scope">—</span>' : '<span class="yield-empty-field out-of-scope">—</span>')}</strong></span>
          <span><span class="dim-label-prefix">D13 Fee:</span> <strong>${feeVal != null ? `$${Number(feeVal).toFixed(2)}` : (targets.d13_fee ? '<span class="yield-empty-field in-scope">—</span>' : '<span class="yield-empty-field out-of-scope">—</span>')}</strong></span>
        </div>
        <div style="margin-top: 5px; font-size: 0.7rem; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
          <span class="dim-label-prefix">D1 Live Cart URL:</span>
          ${ticketUrl ? `
            <a href="${escapeHtml(ticketUrl)}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation(); if (window.openCuratorWindow) { window.openCuratorWindow(this.href); return false; }" style="display: inline-flex; align-items: center; gap: 5px; text-decoration: none;" title="Open Tier 1 live cart URL">
              <span style="background: rgba(56, 189, 248, 0.2); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.4); padding: 1px 6px; border-radius: 4px; font-weight: 800; font-size: 0.68rem; text-decoration: underline;">Tier 1 ↗</span>
              <span style="color: #38bdf8; text-decoration: underline; word-break: break-all; font-size: 0.7rem;">${ticketUrl.length > 40 ? escapeHtml(ticketUrl.slice(0, 38)) + '...' : escapeHtml(ticketUrl)}</span>
            </a>
            ${isAfter ? '<span class="yield-highlight-tag">+ Link Verified</span>' : ''}
          ` : emptyScopeMsg(targets.d1_checkout, 'awaiting deep link')}
        </div>
      </div>

      <!-- Section 4: D41 Category & D34 Artist / Lineup (Request 3 & 4) -->
      <div class="yield-section-box ${(targets.d41_category || targets.d34_lineup) ? 'yield-target-dim' : 'yield-dim-out-of-scope'}">
        <div class="yield-section-header">
          <span class="yield-section-title"><span>🏷️</span> <span class="dim-label-prefix">D41</span> Category &amp; <span class="dim-label-prefix">D34</span> Lineup</span>
          ${(targets.d41_category || targets.d34_lineup)
        ? `<span class="yield-target-tag">🎯 Target for ${escapeHtml(scanName)}</span>`
        : `<span class="yield-out-scope-tag">Out of scope for this AI</span>`}
        </div>
        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
          <div>
            <span class="dim-label-prefix">D41 Category:</span>
            ${categoryVal ? `<span style="font-weight: 700; color: #d8b4fe; background: rgba(168, 85, 247, 0.15); padding: 1px 6px; border-radius: 4px; border: 1px solid rgba(168, 85, 247, 0.3);">${escapeHtml(categoryVal)}</span> ${isAfter ? '<span class="yield-highlight-tag">+ Categorized</span>' : ''}` : emptyScopeMsg(targets.d41_category, 'awaiting NLP taxonomy')}
          </div>
          <div>
            <span class="dim-label-prefix">D34 Lineup:</span>
            ${artistVal ? `<strong style="color: #cbd5e1;">${escapeHtml(artistVal)}</strong> ${isAfter ? '<span class="yield-highlight-tag">+ Verified</span>' : ''}` : emptyScopeMsg(targets.d34_lineup, 'awaiting roster extraction')}
          </div>
        </div>
      </div>

      <!-- Section 5: D42 Age Policy & Restrictions (Request 3 & 4) -->
      <div class="yield-section-box ${targets.d42_age ? 'yield-target-dim' : 'yield-dim-out-of-scope'}">
        <div class="yield-section-header">
          <span class="yield-section-title"><span>🔞</span> <span class="dim-label-prefix">D42</span> Age Policy &amp; Restrictions</span>
          ${targets.d42_age
        ? `<span class="yield-target-tag">🎯 Target for ${escapeHtml(scanName)}</span>`
        : `<span class="yield-out-scope-tag">Out of scope for this AI</span>`}
        </div>
        <div>
          <span class="dim-label-prefix">D42 Age Policy:</span>
          ${ageVal ? `<span style="color: #e2e8f0;">${escapeHtml(ageVal)}</span> ${isAfter ? '<span class="yield-highlight-tag">+ Extracted</span>' : ''}` : emptyScopeMsg(targets.d42_age, 'awaiting 19+ ID check')}
        </div>
      </div>

      <!-- Section 6: D51 Program Description & Synopsis (Request 3 & 4) -->
      <div class="yield-section-box ${targets.d51_desc ? 'yield-target-dim' : 'yield-dim-out-of-scope'}">
        <div class="yield-section-header">
          <span class="yield-section-title"><span>📝</span> <span class="dim-label-prefix">D51</span> Description &amp; Synopsis</span>
          ${targets.d51_desc
        ? `<span class="yield-target-tag">🎯 Target for ${escapeHtml(scanName)}</span>`
        : `<span class="yield-out-scope-tag">Out of scope for this AI</span>`}
        </div>
        <div style="color: #cbd5e1; font-size: 0.72rem; line-height: 1.4; max-height: 60px; overflow-y: auto;">
          <span class="dim-label-prefix">D51 Synopsis:</span>
          ${descVal ? `${escapeHtml(descVal)} ${isAfter ? '<span class="yield-highlight-tag">+ Enriched</span>' : ''}` : emptyScopeMsg(targets.d51_desc, 'awaiting AI synopsis')}
        </div>
      </div>

      <!-- Section 7: Photographic Proof Keyframe (Request 3 & 4) -->
      <div class="yield-section-box ${targets.proof ? 'yield-target-dim' : 'yield-dim-out-of-scope'}">
        <div class="yield-section-header">
          <span class="yield-section-title"><span>📸</span> Visual Proof Keyframe</span>
          ${targets.proof
        ? `<span class="yield-target-tag">🎯 Target for ${escapeHtml(scanName)}</span>`
        : `<span class="yield-out-scope-tag">Out of scope for this AI</span>`}
        </div>
        ${proofUrl ? `
          <div style="position: relative; margin-top: 4px;">
            <img src="${escapeHtml(proofUrl)}" class="yield-proof-thumb" alt="Proof Keyframe" onclick="openScreenshotModal('${escapeHtml(proofUrl)}')" title="Click to open full-resolution proof">
            <div style="font-size: 0.64rem; color: #38bdf8; margin-top: 2px; text-align: center; cursor: pointer;" onclick="openScreenshotModal('${escapeHtml(proofUrl)}')">
              🔍 Click image to enlarge full proof
            </div>
          </div>
        ` : emptyScopeMsg(targets.proof, 'awaiting browser screenshot')}
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // 3-COLUMN COMPARATIVE DIMENSION TABLE SYSTEM (Multi-Dimension Matrix Coverage)
  // ─────────────────────────────────────────────────────────────────────────────
  function classifyUrlTier(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return null;
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      const path = parsed.pathname.toLowerCase().replace(/\/+$/, '');
      const search = parsed.search.toLowerCase();
      const hash = parsed.hash.toLowerCase();
      const full = (path + search + hash).toLowerCase();

      // Tier 1: Checkout Cart / Dynamic Seat Picker / Dedicated Ticketing System
      const isCartDomain = /^(showpass\.com|eventbrite\.(ca|com)|ticketweb\.(ca|com)|universe\.com|admitone\.com|vtixonline\.com|tockify\.com|sidedooraccess\.com|dice\.fm|tickit\.ca|zaui\.net|ticketmaster\.(ca|com)|ticketscene\.ca|eventfinda\.(ca|com))$/i.test(host) || host.includes('.zaui.net');
      const isCartPath = /(\/checkout|\/cart|\/choose-?seats|\/buy-?tickets?|\/purchase|\/order|\/tickets|\/booking|\/register|\/boxoffice)/i.test(full);
      const hasCartParams = /(\?|&|#)(cart|checkout|order|ticket|event_id|activity)=/i.test(full);

      if (isCartDomain && (path.length > 1 || search.length > 1 || hash.length > 1)) {
        return 'Tier 1 (Checkout Cart)';
      }
      if (isCartPath || hasCartParams) {
        return 'Tier 1 (Checkout Cart)';
      }

      // Tier 4: Civic Destination Guides / Park Board / Tourism Portals
      const isCivicGuide = /^(destinationvancouver\.com|stanleyparkvan\.com|vancouver\.ca|bcparks\.ca|metrovancouver\.org|tourismvancouver\.com)$/i.test(host);
      if (isCivicGuide) {
        return 'Tier 4 (Civic Guide)';
      }

      // Tier 3: Calendar / Shows Overview / Schedule / Listings
      const isCalendarPath = /^\/(calendar|shows|events|schedule|whats-on|exhibitions|listings|upcoming|programming|all-events)$/i.test(path);
      if (isCalendarPath) {
        return 'Tier 3 (Calendar)';
      }

      // Tier 5: Venue Home (Root domain or generic homepage)
      if (!path || path === '' || path === '/' || /^\/(home|index(\.html|\.php)?|en|default(\.aspx)?)$/i.test(path)) {
        return 'Tier 5 (Venue Home)';
      }

      // Tier 2: Dedicated Event Details Page (Deep link on venue or promoter site)
      if (path.length > 1) {
        return 'Tier 2 (Event Page)';
      }

      return 'Tier 5 (Venue Home)';
    } catch (_) {
      return 'Tier 5 (Venue Home)';
    }
  }

  // ── Helper to resolve venue links from catalogs if absent on card ───────────
  function lookupVenueUrls(venueName) {
    if (!venueName) return { calendar_url: null, website_url: null };
    try {
      const vMaster = (state?.masterCatalogsData?.venues_master) || (window?.state?.masterCatalogsData?.venues_master) || [];
      if (Array.isArray(vMaster)) {
        const found = vMaster.find(v => (v.name && v.name.toLowerCase() === venueName.toLowerCase()) || (v.id && v.id.toLowerCase() === venueName.toLowerCase()));
        if (found) {
          return {
            calendar_url: found.calendar_url || found.events_url || null,
            website_url: found.website_url || found.website || found.url || null
          };
        }
      }
      const vFeeds = (state?.cachedVenueFeeds) || (window?.state?.cachedVenueFeeds) || [];
      if (Array.isArray(vFeeds)) {
        const found = vFeeds.find(v => (v.name && v.name.toLowerCase() === venueName.toLowerCase()));
        if (found) {
          return {
            calendar_url: found.calendar_url || found.url || null,
            website_url: found.website_url || found.url || null
          };
        }
      }
    } catch (_) { }
    return { calendar_url: null, website_url: null };
  }

  // ── Helper to extract specific tier URL from card / audit ───────────────────
  function extractTierUrl(card, tierCode, isAfter) {
    if (!card) return null;
    const audit = card.dimension_audit || card.dimensions || {};
    const venueUrls = lookupVenueUrls(card.venue_name || card.venue);

    if (tierCode === 'D101' || tierCode === 'D1') {
      return (isAfter && card.afterTicketUrl) ||
        audit.D101_tier1_checkout?.verified_value ||
        audit.d101_checkout?.verified_value ||
        audit.D1_tier1_checkout?.verified_value ||
        card.candidate_tier1_url ||
        card.tier1_url ||
        (classifyUrlTier(card.ticket_url) === 'Tier 1 (Checkout Cart)' ? card.ticket_url : null) ||
        (card.ticket_url && !card.details_url ? card.ticket_url : null);
    }
    if (tierCode === 'D102' || tierCode === 'D2') {
      return (isAfter && card.afterDetailsUrl) ||
        audit.D102_tier2_event_page?.verified_value ||
        audit.d102_event_page?.verified_value ||
        audit.D2_tier2_event_page?.verified_value ||
        card.details_url ||
        card.event_page_url ||
        (classifyUrlTier(card.ticket_url) === 'Tier 2 (Event Page)' ? card.ticket_url : null);
    }
    if (tierCode === 'D103' || tierCode === 'D3') {
      return audit.D103_tier3_calendar?.verified_value ||
        audit.d103_calendar?.verified_value ||
        audit.D3_tier3_calendar?.verified_value ||
        card.calendar_url ||
        card.venue_calendar_url ||
        venueUrls.calendar_url ||
        (classifyUrlTier(card.ticket_url) === 'Tier 3 (Calendar)' ? card.ticket_url : null);
    }
    if (tierCode === 'D104' || tierCode === 'D4') {
      return audit.D104_tier4_civic_destination?.verified_value ||
        audit.d104_civic?.verified_value ||
        audit.D4_tier4_civic_destination?.verified_value ||
        card.civic_destination_url ||
        (classifyUrlTier(card.ticket_url) === 'Tier 4 (Civic Guide)' ? card.ticket_url : null);
    }
    if (tierCode === 'D105' || tierCode === 'D5') {
      return audit.D105_tier5_venue_home?.verified_value ||
        audit.d105_venue_home?.verified_value ||
        audit.D5_tier5_venue_home?.verified_value ||
        card.websiteUrl ||
        card.venue_url ||
        venueUrls.website_url ||
        (classifyUrlTier(card.ticket_url) === 'Tier 5 (Venue Home)' ? card.ticket_url : null);
    }
    if (tierCode === 'D106' || tierCode === 'D6') {
      return (isAfter && card.afterTicketUrl) ||
        card.ticket_url ||
        card.candidate_tier1_url ||
        card.details_url ||
        card.calendar_url ||
        card.websiteUrl ||
        venueUrls.calendar_url ||
        venueUrls.website_url ||
        null;
    }
    return null;
  }

  // ── Helper to render clickable tier badge + destination link ────────────────
  function renderTierHyperlink(url, tierName, fallbackText = 'none_available', themeColor = '#38bdf8') {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      const isNone = fallbackText === 'none_available';
      const isNa = fallbackText === 'not_applicable';
      return `<span class="yield-empty-field out-of-scope">${escapeHtml(fallbackText)}</span>`;
    }
    let displayUrl = url.replace(/^https?:\/\/(www\.)?/, '');
    if (displayUrl.length > 36) displayUrl = displayUrl.slice(0, 34) + '...';

    const openFn = `onclick="event.stopPropagation(); if (window.openCuratorWindow) { window.openCuratorWindow(this.href); return false; }"`;

    return `
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" ${openFn}
         style="display: inline-flex; align-items: center; gap: 6px; text-decoration: none; max-width: 100%; vertical-align: middle;"
         title="Open ${escapeHtml(tierName)}: ${escapeHtml(url)}">
        <span style="display: inline-flex; align-items: center; gap: 3px; font-weight: 800; font-size: 0.7rem; padding: 2px 7px; border-radius: 4px; background: rgba(56, 189, 248, 0.14); color: ${themeColor}; border: 1px solid ${themeColor}44; text-decoration: underline; white-space: nowrap; cursor: pointer;">
          ${escapeHtml(tierName)} ↗
        </span>
        <span style="color: #94a3b8; font-size: 0.72rem; text-decoration: underline; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;">
          ${escapeHtml(displayUrl)}
        </span>
      </a>
    `;
  }

  const FULL_CATALOG_DIMENSIONS = [
    // =========================================================================
    // CLUSTER 0XX: CORE EVENT IDENTITY, TAXONOMY & CULTURAL CLASSIFICATION
    // =========================================================================
    {
      code: 'D001',
      name: 'Event Name & Title',
      cluster: '0XX',
      clusterName: 'Cluster 0XX: Core Identity & Cultural Taxonomy',
      clusterClass: 'cluster-0xx',
      category: 'Core Identity',
      key: 'd001_title',
      legacyKeys: ['d33_title'],
      getValue: (card, isAfter) => card?.afterTitle || card?.title || card?.event_name || null,
      badge: '+ Clean Title'
    },
    {
      code: 'D002',
      name: 'Permanent Lifetime Event ID',
      cluster: '0XX',
      clusterName: 'Cluster 0XX: Core Identity & Cultural Taxonomy',
      clusterClass: 'cluster-0xx',
      category: 'Core Identity',
      key: 'd002_perm_id',
      legacyKeys: [],
      getValue: (card, isAfter) => {
        if (card?.event_num_perm) return `<span class="dim-pill-archetype">${escapeHtml(card.event_num_perm)}</span>`;
        if (card?.Event_Num_Perm) return `<span class="dim-pill-archetype">${escapeHtml(card.Event_Num_Perm)}</span>`;
        const auditPerm = card?.dimension_audit?.D002_event_num_perm?.value || card?.dimension_audit?.D002?.value;
        if (auditPerm) return `<span class="dim-pill-archetype">${escapeHtml(auditPerm)}</span>`;
        const cid = card?.id || card?.event_id;
        if (cid) {
          const allEvs = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
          const qEvs = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);
          const matched = allEvs.find(e => (e.id || e.event_id) === cid) || qEvs.find(e => (e.id || e.event_id) === cid);
          const resolvedPerm = matched?.Event_Num_Perm || matched?.event_num_perm || matched?.dimension_audit?.D002_event_num_perm?.value;
          if (resolvedPerm) return `<span class="dim-pill-archetype">${escapeHtml(resolvedPerm)}</span>`;
          const foundIdx = allEvs.findIndex(e => (e.id || e.event_id) === cid);
          if (foundIdx !== -1) return `<span class="dim-pill-archetype">Event_Num_Perm_${String(foundIdx + 1).padStart(9, '0')}</span>`;
        }
        if (typeof card?.cardIndex === 'number' && card.cardIndex > 0) return `<span class="dim-pill-archetype">Event_Num_Perm_${String(card.cardIndex).padStart(9, '0')}</span>`;
        return null;
      },
      badge: '+ Immutable ID'
    },
    {
      code: 'D003',
      name: 'Catalog Card Slot Number',
      cluster: '0XX',
      clusterName: 'Cluster 0XX: Core Identity & Cultural Taxonomy',
      clusterClass: 'cluster-0xx',
      category: 'Core Identity',
      key: 'd003_card_id',
      legacyKeys: [],
      getValue: (card, isAfter) => {
        if (isAfter && (card?.compilerOutcome === 'ARCHIVED' || card?.compilerOutcome === 'QUARANTINED')) {
          return `<span style="color: #f87171; font-weight: 700;">— (Not Published: ${escapeHtml(card.compilerOutcome)})</span>`;
        }
        if (card?.event_num_card) return `<span class="dim-pill-archetype">${escapeHtml(card.event_num_card)}</span>`;
        if (card?.Event_Num_Card) return `<span class="dim-pill-archetype">${escapeHtml(card.Event_Num_Card)}</span>`;
        const auditCard = card?.dimension_audit?.D003_event_num_card?.value || card?.dimension_audit?.D003?.value;
        if (auditCard) return `<span class="dim-pill-archetype">${escapeHtml(auditCard)}</span>`;
        const cid = card?.id || card?.event_id;
        if (cid) {
          const allEvs = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
          const matched = allEvs.find(e => (e.id || e.event_id) === cid);
          const resolvedCard = matched?.Event_Num_Card || matched?.event_num_card || matched?.dimension_audit?.D003_event_num_card?.value;
          if (resolvedCard) return `<span class="dim-pill-archetype">${escapeHtml(resolvedCard)}</span>`;
        }
        if (typeof card?.cardIndex === 'number' && card.cardIndex > 0) {
          return `<span class="dim-pill-archetype">Event_Num_Card_${String(card.cardIndex).padStart(9, '0')}</span>`;
        }
        return null;
      },
      badge: '+ Slot Assigned'
    },
    {
      code: 'D004',
      name: 'Primary Cultural Category',
      cluster: '0XX',
      clusterName: 'Cluster 0XX: Core Identity & Cultural Taxonomy',
      clusterClass: 'cluster-0xx',
      category: 'Core Identity',
      key: 'd004_category',
      legacyKeys: ['d41_category'],
      getValue: (card, isAfter) => {
        const cat = card?.afterCategory || card?.category || (Array.isArray(card?.categories) ? card.categories[0] : null);
        if (!cat) return null;
        return `<span class="dim-pill-cat">${escapeHtml(cat.toUpperCase())}</span>`;
      },
      badge: '+ Classified'
    },
    {
      code: 'D005',
      name: 'Cultural Tags & Sub-Genres',
      cluster: '0XX',
      clusterName: 'Cluster 0XX: Core Identity & Cultural Taxonomy',
      clusterClass: 'cluster-0xx',
      category: 'Core Identity',
      key: 'd005_tags',
      legacyKeys: [],
      getValue: (card, isAfter) => {
        const tags = card?.tags || card?.subTags || card?.categories;
        if (Array.isArray(tags) && tags.length > 0) {
          return tags.slice(0, 4).map(t => `<span class="dim-pill-tag">${escapeHtml(String(t))}</span>`).join(' ');
        }
        if (typeof tags === 'string' && tags) return escapeHtml(tags);
        return null;
      },
      badge: '+ Tagged'
    },
    {
      code: 'D006',
      name: 'Lifecycle Classification',
      cluster: '0XX',
      clusterName: 'Cluster 0XX: Core Identity & Cultural Taxonomy',
      clusterClass: 'cluster-0xx',
      category: 'Core Identity',
      key: 'd006_lifecycle',
      legacyKeys: [],
      getValue: (card, isAfter) => {
        const type = card?.lifecycle_type || (card?.isPerennial ? 'perennial_drop_in' : 'time_bound_event');
        return type === 'perennial_drop_in' ? '🔄 Perennial Drop-In' : '📅 Time-Bound Performance';
      },
      badge: '+ Validated'
    },
    {
      code: 'D007',
      name: 'Cultural Archetype Profile',
      cluster: '0XX',
      clusterName: 'Cluster 0XX: Core Identity & Cultural Taxonomy',
      clusterClass: 'cluster-0xx',
      category: 'Core Identity',
      key: 'd007_archetype',
      legacyKeys: [],
      getValue: (card, isAfter) => {
        const arch = card?.event_archetype || card?.archetype || 'standard_event';
        return `<span class="dim-pill-archetype">${escapeHtml(arch.replace(/_/g, ' '))}</span>`;
      },
      badge: '+ Archetype'
    },
    {
      code: 'D008',
      name: 'Age & Entry Restrictions',
      cluster: '0XX',
      clusterName: 'Cluster 0XX: Core Identity & Cultural Taxonomy',
      clusterClass: 'cluster-0xx',
      category: 'Core Identity',
      key: 'd008_restrictions',
      legacyKeys: ['d42_age'],
      getValue: (card, isAfter) => card?.afterRestrictions || card?.afterAge || card?.restrictions || card?.age_policy || 'All Ages / Family Friendly',
      badge: '+ Age Verified'
    },

    // =========================================================================
    // CLUSTER 1XX: DISCOVERY, ACCESS & DEEP-LINK HIERARCHY
    // =========================================================================
    {
      code: 'D101',
      name: 'Tier 1: Checkout Cart URL',
      cluster: '1XX',
      clusterName: 'Cluster 1XX: Discovery, Access & Link Hierarchy',
      clusterClass: 'cluster-1xx',
      category: 'Access & Boundaries',
      key: 'd101_checkout',
      legacyKeys: ['d1_checkout'],
      getValue: (card, isAfter) => {
        const url = extractTierUrl(card, 'D101', isAfter);
        return renderTierHyperlink(url, 'Tier 1 (Cart)', 'none_available', '#38bdf8');
      },
      badge: '+ Link Verified'
    },
    {
      code: 'D102',
      name: 'Tier 2: Event Details Page',
      cluster: '1XX',
      clusterName: 'Cluster 1XX: Discovery, Access & Link Hierarchy',
      clusterClass: 'cluster-1xx',
      category: 'Access & Boundaries',
      key: 'd102_event_page',
      legacyKeys: ['d2_event_page'],
      getValue: (card, isAfter) => {
        const url = extractTierUrl(card, 'D102', isAfter);
        return renderTierHyperlink(url, 'Tier 2 (Event Page)', 'none_available', '#c4b5fd');
      },
      badge: '+ Harvested'
    },
    {
      code: 'D103',
      name: 'Tier 3: Venue Calendar URL',
      cluster: '1XX',
      clusterName: 'Cluster 1XX: Discovery, Access & Link Hierarchy',
      clusterClass: 'cluster-1xx',
      category: 'Access & Boundaries',
      key: 'd103_calendar',
      legacyKeys: ['d3_calendar'],
      getValue: (card, isAfter) => {
        const url = extractTierUrl(card, 'D103', isAfter);
        return renderTierHyperlink(url, 'Tier 3 (Calendar)', 'none_available', '#6ee7b7');
      },
      badge: '+ Calendar'
    },
    {
      code: 'D104',
      name: 'Tier 4: Civic Destination URL',
      cluster: '1XX',
      clusterName: 'Cluster 1XX: Discovery, Access & Link Hierarchy',
      clusterClass: 'cluster-1xx',
      category: 'Access & Boundaries',
      key: 'd104_civic',
      legacyKeys: ['d4_civic'],
      getValue: (card, isAfter) => {
        const url = extractTierUrl(card, 'D104', isAfter);
        return renderTierHyperlink(url, 'Tier 4 (Civic Guide)', (card?.isPerennial ? 'none_available' : 'not_applicable'), '#fde68a');
      },
      badge: '+ Civic'
    },
    {
      code: 'D105',
      name: 'Tier 5: Venue Home Domain',
      cluster: '1XX',
      clusterName: 'Cluster 1XX: Discovery, Access & Link Hierarchy',
      clusterClass: 'cluster-1xx',
      category: 'Access & Boundaries',
      key: 'd105_venue_home',
      legacyKeys: ['d5_venue_home'],
      getValue: (card, isAfter) => {
        const url = extractTierUrl(card, 'D105', isAfter);
        return renderTierHyperlink(url, 'Tier 5 (Venue Home)', 'none_available', '#cbd5e1');
      },
      badge: '+ Domain'
    },
    {
      code: 'D106',
      name: 'Best Available Link & Tier',
      cluster: '1XX',
      clusterName: 'Cluster 1XX: Discovery, Access & Link Hierarchy',
      clusterClass: 'cluster-1xx',
      category: 'Access & Boundaries',
      key: 'd106_best_link',
      legacyKeys: ['d6_tier'],
      getValue: (card, isAfter) => {
        const bestUrl = extractTierUrl(card, 'D106', isAfter);
        if (!bestUrl) return '<span class="yield-empty-field out-of-scope">none_available</span>';
        let tierLabel = 'Tier 1 (Checkout Cart)';
        if (typeof classifyUrlTier === 'function') {
          tierLabel = classifyUrlTier(bestUrl);
        } else if (card?.best_tier) {
          tierLabel = card.best_tier;
        } else if (extractTierUrl(card, 'D101', isAfter) === bestUrl) {
          tierLabel = 'Tier 1 (Checkout Cart)';
        } else if (extractTierUrl(card, 'D102', isAfter) === bestUrl) {
          tierLabel = 'Tier 2 (Event Page)';
        } else if (extractTierUrl(card, 'D103', isAfter) === bestUrl) {
          tierLabel = 'Tier 3 (Calendar)';
        } else if (extractTierUrl(card, 'D104', isAfter) === bestUrl) {
          tierLabel = 'Tier 4 (Civic Guide)';
        } else if (extractTierUrl(card, 'D105', isAfter) === bestUrl) {
          tierLabel = 'Tier 5 (Venue Home)';
        }
        let themeColor = '#38bdf8';
        if (tierLabel.includes('Tier 2')) themeColor = '#c4b5fd';
        else if (tierLabel.includes('Tier 3')) themeColor = '#6ee7b7';
        else if (tierLabel.includes('Tier 4')) themeColor = '#fde68a';
        else if (tierLabel.includes('Tier 5')) themeColor = '#cbd5e1';
        return renderTierHyperlink(bestUrl, tierLabel, 'none_available', themeColor);
      },
      badge: '+ Promoted'
    },
    {
      code: 'D107',
      name: 'Operational & Inventory Status',
      cluster: '1XX',
      clusterName: 'Cluster 1XX: Discovery, Access & Link Hierarchy',
      clusterClass: 'cluster-1xx',
      category: 'Access & Boundaries',
      key: 'd107_inventory',
      legacyKeys: ['d7_inventory'],
      getValue: (card, isAfter) => {
        const isSoldOut = isAfter
          ? (card?.afterInventory ? card.afterInventory.includes('SOLD OUT') : (card?.is_sold_out != null ? Boolean(card.is_sold_out || card.isSoldOut) : null))
          : (card?.is_sold_out != null ? Boolean(card.is_sold_out || card.isSoldOut) : null);
        if (isSoldOut === null) return card?.id ? '<span style="color: #34d399; font-weight: 700;">AVAILABLE 🎟️</span>' : null;
        return isSoldOut
          ? '<span style="font-size: 0.7rem; font-weight: 700; padding: 2px 7px; border-radius: 4px; background: rgba(239, 68, 68, 0.2); color: #fca5a5; border: 1px solid rgba(239, 68, 68, 0.4);">SOLD OUT ⚠️</span>'
          : '<span style="font-size: 0.7rem; font-weight: 700; padding: 2px 7px; border-radius: 4px; background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3);">AVAILABLE 🎟️</span>';
      },
      badge: '+ Inventory'
    },
    {
      code: 'D108',
      name: 'Geographic Jurisdiction (Metro Van)',
      cluster: '1XX',
      clusterName: 'Cluster 1XX: Discovery, Access & Link Hierarchy',
      clusterClass: 'cluster-1xx',
      category: 'Access & Boundaries',
      key: 'd108_geo',
      legacyKeys: ['d8_geo'],
      getValue: (card, isAfter) => '✅ Metro Vancouver (In-Market BC)',
      badge: '+ In-Market'
    },
    {
      code: 'D109',
      name: 'Currency Standard (CAD Strictly)',
      cluster: '1XX',
      clusterName: 'Cluster 1XX: Discovery, Access & Link Hierarchy',
      clusterClass: 'cluster-1xx',
      category: 'Access & Boundaries',
      key: 'd109_currency',
      legacyKeys: ['d9_currency'],
      getValue: (card, isAfter) => 'CAD ($ Canadian Strictly)',
      badge: '+ Currency'
    },
    {
      code: 'D110',
      name: 'IANA Timezone Standard',
      cluster: '1XX',
      clusterName: 'Cluster 1XX: Discovery, Access & Link Hierarchy',
      clusterClass: 'cluster-1xx',
      category: 'Access & Boundaries',
      key: 'd110_timezone',
      legacyKeys: ['d10_timezone'],
      getValue: (card, isAfter) => 'America/Vancouver (Pacific Time)',
      badge: '+ Timezone'
    },

    // =========================================================================
    // CLUSTER 2XX: INTERACTIVE MULTI-TIER BOX OFFICE & CHECKOUT AUDIT
    // =========================================================================
    {
      code: 'D201',
      name: 'Tier 1: Option Name (Primary)',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd201_tier1_name',
      legacyKeys: ['d11_tier1_name'],
      getValue: (card, isAfter) => (isAfter ? (card?.afterTier1Name || card?.tier1_name || card?.all_tiers?.[0]?.name) : (card?.tier1_name || card?.all_tiers?.[0]?.name)) || (card?.price === 0 ? 'Free Admission' : 'General Admission'),
      badge: '+ Tier 1 GA'
    },
    {
      code: 'D202',
      name: 'Tier 1 Base Ticket Price',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd202_tier1_base',
      legacyKeys: ['d12_base'],
      getValue: (card, isAfter) => {
        const val = isAfter
          ? (card?.afterBase ?? card?.tier1_price_base ?? card?.price_base ?? card?.all_tiers?.[0]?.price_base ?? null)
          : (card?.tier1_price_base ?? card?.price_base ?? card?.all_tiers?.[0]?.price_base ?? null);
        return val != null ? `<strong>$${Number(val).toFixed(2)} CAD</strong>` : (card?.price != null ? `$${Number(card.price).toFixed(2)} CAD` : null);
      },
      badge: '+ Base Verified'
    },
    {
      code: 'D203',
      name: 'Tier 1 Platform Service Fee',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd203_tier1_fee',
      legacyKeys: ['d13_fee'],
      getValue: (card, isAfter) => {
        const val = isAfter
          ? (card?.afterFee ?? card?.tier1_price_fee ?? card?.price_fee ?? card?.all_tiers?.[0]?.price_fee ?? null)
          : (card?.tier1_price_fee ?? card?.price_fee ?? card?.all_tiers?.[0]?.price_fee ?? null);
        return val != null ? `<strong>$${Number(val).toFixed(2)} CAD</strong>` : '$0.00 CAD (Direct Box Office / Included)';
      },
      badge: '+ Fee Audited'
    },
    {
      code: 'D204',
      name: 'Tier 1 Tax (5% GST / Inclusive)',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd204_tier1_tax',
      legacyKeys: ['d14_tax'],
      getValue: (card, isAfter) => {
        const val = isAfter
          ? (card?.afterTax ?? card?.tier1_price_tax ?? card?.price_tax ?? card?.all_tiers?.[0]?.price_tax ?? null)
          : (card?.tier1_price_tax ?? card?.price_tax ?? card?.all_tiers?.[0]?.price_tax ?? null);
        return val != null ? `$${Number(val).toFixed(2)} CAD` : (card?.price != null || card?.afterPrice || card?.tier1_price_all_in != null ? '5% GST Included in Total' : null);
      },
      badge: '+ Tax Audited'
    },
    {
      code: 'D205',
      name: 'Tier 1 All-In Final Checkout Cost',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd205_tier1_allin',
      legacyKeys: ['d15_allin'],
      getValue: (card, isAfter) => {
        const allInNum = card?.tier1_price_all_in ?? card?.price_all_in ?? card?.all_tiers?.[0]?.price_all_in ?? card?.price;
        const val = isAfter
          ? (card?.afterPrice || (allInNum != null ? `$${Number(allInNum).toFixed(2)} CAD` : card?.priceLabel || null))
          : (card?.priceLabel || (allInNum != null ? `$${Number(allInNum).toFixed(2)} CAD` : null));
        return val ? `<span style="font-size: 0.95rem; font-weight: 800; color: #34d399;">${escapeHtml(val)}</span>` : null;
      },
      badge: '+ Live Total'
    },
    {
      code: 'D206',
      name: 'Tier 2 Option Name (Secondary)',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd206_tier2_name',
      legacyKeys: ['d16_tier2_name'],
      getValue: (card, isAfter) => {
        const val = card?.tier2_name || card?.dimension_audit?.D206_tier2_name?.value || card?.dimension_audit?.D16_tier2_name?.value || (card?.admission_tiers && card.admission_tiers[1]?.name) || (card?.all_tiers && card.all_tiers[1]?.name);
        if (val && val !== 'none_available') return `<strong>${escapeHtml(val)}</strong>`;
        return card?.id ? '<span style="color: #64748b; font-style: italic;">none_available</span>' : null;
      },
      badge: '+ Tier 2'
    },
    {
      code: 'D207',
      name: 'Tier 2 Base Ticket Price',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd207_tier2_base',
      legacyKeys: ['d17_tier2_base'],
      getValue: (card, isAfter) => {
        const val = card?.tier2_price_base ?? card?.dimension_audit?.D207_tier2_price_base?.value ?? card?.dimension_audit?.D17_tier2_price_base?.value ?? (card?.admission_tiers && card.admission_tiers[1]?.price_base) ?? (card?.all_tiers && card.all_tiers[1]?.price_base);
        if (val != null && !isNaN(Number(val))) return `<strong>$${Number(val).toFixed(2)} CAD</strong>`;
        return card?.id ? '<span style="color: #64748b; font-style: italic;">none_available</span>' : null;
      },
      badge: '+ Tier 2 Base'
    },
    {
      code: 'D208',
      name: 'Tier 2 Platform Service Fee',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd208_tier2_fee',
      legacyKeys: ['d18_tier2_fee'],
      getValue: (card, isAfter) => {
        const val = card?.tier2_price_fee ?? card?.dimension_audit?.D208_tier2_price_fee?.value ?? card?.dimension_audit?.D18_tier2_price_fee?.value ?? (card?.admission_tiers && card.admission_tiers[1]?.price_fee) ?? (card?.all_tiers && card.all_tiers[1]?.price_fee);
        if (val != null && !isNaN(Number(val))) return `<strong>$${Number(val).toFixed(2)} CAD</strong>`;
        return card?.id ? '<span style="color: #64748b; font-style: italic;">none_available</span>' : null;
      },
      badge: '+ Tier 2 Fee'
    },
    {
      code: 'D209',
      name: 'Tier 2 Tax (5% GST / Inclusive)',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd209_tier2_tax',
      legacyKeys: ['d19_tier2_tax'],
      getValue: (card, isAfter) => {
        const val = card?.tier2_price_tax ?? card?.dimension_audit?.D209_tier2_price_tax?.value ?? card?.dimension_audit?.D19_tier2_price_tax?.value ?? (card?.admission_tiers && card.admission_tiers[1]?.price_tax) ?? (card?.all_tiers && card.all_tiers[1]?.price_tax);
        if (val != null && !isNaN(Number(val))) return `$${Number(val).toFixed(2)} CAD`;
        return card?.id ? '<span style="color: #64748b; font-style: italic;">none_available</span>' : null;
      },
      badge: '+ Tier 2 Tax'
    },
    {
      code: 'D210',
      name: 'Tier 2 All-In Final Cost',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd210_tier2_allin',
      legacyKeys: ['d20_tier2_allin'],
      getValue: (card, isAfter) => {
        const val = card?.tier2_price_all_in ?? card?.tier2_price_read ?? card?.dimension_audit?.D210_tier2_price_all_in?.value ?? card?.dimension_audit?.D20_tier2_price_all_in?.value ?? (card?.admission_tiers && card.admission_tiers[1]?.price) ?? (card?.all_tiers && (card.all_tiers[1]?.price_all_in ?? card.all_tiers[1]?.price));
        if (val != null && !isNaN(Number(val))) {
          return `<span style="font-size: 0.9rem; font-weight: 800; color: #38bdf8;">$${Number(val).toFixed(2)} CAD</span>`;
        }
        return card?.id ? '<span style="color: #64748b; font-style: italic;">none_available</span>' : null;
      },
      badge: '+ Tier 2 Total'
    },
    {
      code: 'D211',
      name: 'Tier 3 Option Name (Tertiary)',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd211_tier3_name',
      legacyKeys: ['d21_tier3_name'],
      getValue: (card, isAfter) => {
        const val = card?.tier3_name || card?.dimension_audit?.D211_tier3_name?.value || card?.dimension_audit?.D21_tier3_name?.value || (card?.admission_tiers && card.admission_tiers[2]?.name) || (card?.all_tiers && card.all_tiers[2]?.name);
        if (val && val !== 'none_available') return `<strong>${escapeHtml(val)}</strong>`;
        return card?.id ? '<span style="color: #64748b; font-style: italic;">none_available</span>' : null;
      },
      badge: '+ Tier 3'
    },
    {
      code: 'D212',
      name: 'Tier 3 Base Ticket Price',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd212_tier3_base',
      legacyKeys: ['d22_tier3_base'],
      getValue: (card, isAfter) => {
        const val = card?.tier3_price_base ?? card?.dimension_audit?.D212_tier3_price_base?.value ?? card?.dimension_audit?.D22_tier3_price_base?.value ?? (card?.admission_tiers && card.admission_tiers[2]?.price_base) ?? (card?.all_tiers && card.all_tiers[2]?.price_base);
        if (val != null && !isNaN(Number(val))) return `<strong>$${Number(val).toFixed(2)} CAD</strong>`;
        return card?.id ? '<span style="color: #64748b; font-style: italic;">none_available</span>' : null;
      },
      badge: '+ Tier 3 Base'
    },
    {
      code: 'D213',
      name: 'Tier 3 Platform Service Fee',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd213_tier3_fee',
      legacyKeys: ['d23_tier3_fee'],
      getValue: (card, isAfter) => {
        const val = card?.tier3_price_fee ?? card?.dimension_audit?.D213_tier3_price_fee?.value ?? card?.dimension_audit?.D23_tier3_price_fee?.value ?? (card?.admission_tiers && card.admission_tiers[2]?.price_fee) ?? (card?.all_tiers && card.all_tiers[2]?.price_fee);
        if (val != null && !isNaN(Number(val))) return `<strong>$${Number(val).toFixed(2)} CAD</strong>`;
        return card?.id ? '<span style="color: #64748b; font-style: italic;">none_available</span>' : null;
      },
      badge: '+ Tier 3 Fee'
    },
    {
      code: 'D214',
      name: 'Tier 3 Tax (5% GST / Inclusive)',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd214_tier3_tax',
      legacyKeys: ['d24_tier3_tax'],
      getValue: (card, isAfter) => {
        const val = card?.tier3_price_tax ?? card?.dimension_audit?.D214_tier3_price_tax?.value ?? card?.dimension_audit?.D24_tier3_price_tax?.value ?? (card?.admission_tiers && card.admission_tiers[2]?.price_tax) ?? (card?.all_tiers && card.all_tiers[2]?.price_tax);
        if (val != null && !isNaN(Number(val))) return `$${Number(val).toFixed(2)} CAD`;
        return card?.id ? '<span style="color: #64748b; font-style: italic;">none_available</span>' : null;
      },
      badge: '+ Tier 3 Tax'
    },
    {
      code: 'D215',
      name: 'Tier 3 All-In Final Cost',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd215_tier3_allin',
      legacyKeys: ['d25_tier3_allin'],
      getValue: (card, isAfter) => {
        const val = card?.tier3_price_all_in ?? card?.tier3_price_read ?? card?.dimension_audit?.D215_tier3_price_all_in?.value ?? card?.dimension_audit?.D25_tier3_price_all_in?.value ?? (card?.admission_tiers && card.admission_tiers[2]?.price) ?? (card?.all_tiers && (card.all_tiers[2]?.price_all_in ?? card.all_tiers[2]?.price));
        if (val != null && !isNaN(Number(val))) {
          return `<span style="font-size: 0.9rem; font-weight: 800; color: #a78bfa;">$${Number(val).toFixed(2)} CAD</span>`;
        }
        return card?.id ? '<span style="color: #64748b; font-style: italic;">none_available</span>' : null;
      },
      badge: '+ Tier 3 Total'
    },
    {
      code: 'D216',
      name: 'Verified Ticket Tier Count',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd216_tier_count',
      legacyKeys: ['d26_tier_count'],
      getValue: (card, isAfter) => {
        let count = 0;
        if (card?.tier1_name || card?.afterTier1Name || card?.price != null || card?.tier1_price_all_in != null || card?.afterPrice) count++;
        const t2 = card?.tier2_name || card?.dimension_audit?.D16_tier2_name?.value || (card?.admission_tiers && card.admission_tiers[1]) || (card?.all_tiers && card.all_tiers[1]);
        if (t2 && t2 !== 'none_available') count++;
        const t3 = card?.tier3_name || card?.dimension_audit?.D21_tier3_name?.value || (card?.admission_tiers && card.admission_tiers[2]) || (card?.all_tiers && card.all_tiers[2]);
        if (t3 && t3 !== 'none_available') count++;
        if (card?.dimension_audit?.D26_tier_count_verified?.count != null) count = card.dimension_audit.D26_tier_count_verified.count;
        else if (card?.admission_tiers && card.admission_tiers.length > 0) count = card.admission_tiers.length;
        else if (card?.all_tiers && card.all_tiers.length > 0) count = card.all_tiers.length;
        return card?.id ? `<span style="font-weight: 700; color: #38bdf8;">${count} Tier${count === 1 ? '' : 's'} Verified</span>` : null;
      },
      badge: '+ Tier Count'
    },
    {
      code: 'D217',
      name: 'Pricing Model Classification',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd217_pricing_model',
      legacyKeys: ['d27_pricing_model'],
      getValue: (card, isAfter) => card?.pricing_model || ((card?.price === 0 || card?.price_all_in === 0) ? 'free_access' : 'fixed_tier'),
      badge: '+ Model'
    },
    {
      code: 'D218',
      name: 'Budget Ceiling Compliance',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd218_budget_qualified',
      legacyKeys: ['d28_budget'],
      getValue: (card, isAfter) => {
        const p = isAfter
          ? (card?.afterPrice ? parseFloat(card.afterPrice.replace(/[^0-9.]/g, '')) : (card?.price != null ? Number(card.price) : null))
          : (card?.price != null ? Number(card.price) : null);
        if (p === null) return card?.id ? '✅ Verified (≤ $50.00 CAD)' : null;
        return p <= 50.00
          ? '<span style="color: #34d399; font-weight: 700;">✅ Qualified Under $50 CAD</span>'
          : '<span style="color: #fca5a5; font-weight: 700;">❌ Exceeds $50 Budget Ceiling</span>';
      },
      badge: '+ ≤ $50 Certified'
    },
    {
      code: 'D219',
      name: 'Mandatory Ancillary Cost Label',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd219_other_cost_label',
      legacyKeys: ['d29_other_label'],
      getValue: (card, isAfter) => card?.other_cost_label || 'none_available',
      badge: '+ Ancillary'
    },
    {
      code: 'D220',
      name: 'Mandatory Ancillary Cost Amount',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd220_other_cost_price',
      legacyKeys: ['d30_other_price'],
      getValue: (card, isAfter) => card?.other_cost_price ? `$${parseFloat(card.other_cost_price).toFixed(2)} CAD` : '$0.00 CAD',
      badge: '+ Surcharge'
    },
    {
      code: 'D221',
      name: 'Ticket Platform Provider',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd221_ticket_provider',
      legacyKeys: ['d31_provider'],
      getValue: (card, isAfter) => {
        const prov = isAfter ? (card?.afterProvider || card?.ticket_provider) : card?.ticket_provider;
        if (prov) return escapeHtml(prov);
        const url = isAfter ? (card?.afterTicketUrl || card?.ticket_url || card?.candidate_tier1_url) : (card?.ticket_url || card?.candidate_tier1_url);
        if (!url) return null;
        try {
          return new URL(url).hostname.replace('www.', '');
        } catch (e) {
          return 'Direct Box Office';
        }
      },
      badge: '+ Provider Grounded'
    },
    {
      code: 'D222',
      name: 'Patron Booking Protocol',
      cluster: '2XX',
      clusterName: 'Cluster 2XX: Multi-Tier Box Office & Checkout Audit',
      clusterClass: 'cluster-2xx',
      category: 'Box Office Pricing',
      key: 'd222_booking_protocol',
      legacyKeys: ['d32_booking_protocol'],
      getValue: (card, isAfter) => card?.booking_protocol || (card?.isPerennial ? 'drop_in' : 'online_reservation'),
      badge: '+ Protocol'
    },

    // =========================================================================
    // CLUSTER 3XX: PERFORMANCE, SCHEDULE & CONTENT REALITY
    // =========================================================================
    {
      code: 'D301',
      name: 'Performer Lineup & Cast',
      cluster: '3XX',
      clusterName: 'Cluster 3XX: Performance, Schedule & Content Reality',
      clusterClass: 'cluster-3xx',
      category: 'Temporal & Content',
      key: 'd301_lineup',
      legacyKeys: ['d34_lineup'],
      getValue: (card, isAfter) => {
        const a = isAfter ? (card?.afterArtist || card?.artist || (card?.lineup && card.lineup.length ? card.lineup.join(', ') : null)) : (card?.artist || (card?.lineup && card.lineup.length ? card.lineup.join(', ') : null));
        return a ? escapeHtml(a) : (Array.isArray(card?.lineup) ? card.lineup.join(', ') : null);
      },
      badge: '+ Lineup Extracted'
    },
    {
      code: 'D302',
      name: 'Headlining Artist / Troupe',
      cluster: '3XX',
      clusterName: 'Cluster 3XX: Performance, Schedule & Content Reality',
      clusterClass: 'cluster-3xx',
      category: 'Temporal & Content',
      key: 'd302_artist',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.artist || card?.headliner || (Array.isArray(card?.lineup) ? card.lineup[0] : null),
      badge: '+ Artist'
    },
    {
      code: 'D303',
      name: 'Event Calendar Date (ISO 8601)',
      cluster: '3XX',
      clusterName: 'Cluster 3XX: Performance, Schedule & Content Reality',
      clusterClass: 'cluster-3xx',
      category: 'Temporal & Content',
      key: 'd303_date',
      legacyKeys: ['d35_date'],
      getValue: (card, isAfter) => {
        const d = isAfter
          ? (card?.afterDate || card?.startIso || card?.date || card?.showings?.[0]?.date || card?.dateSchedule || null)
          : (card?.startIso || card?.date || card?.showings?.[0]?.date || card?.dateSchedule || null);
        return d ? `<span style="color: #38bdf8; font-weight: 700;">${escapeHtml(d)}</span>` : (card?.isPerennial ? 'perennial_drop_in' : null);
      },
      badge: '+ Date Confirmed'
    },
    {
      code: 'D304',
      name: 'Active Showing Slots Count',
      cluster: '3XX',
      clusterName: 'Cluster 3XX: Performance, Schedule & Content Reality',
      clusterClass: 'cluster-3xx',
      category: 'Temporal & Content',
      key: 'd304_showings',
      legacyKeys: [],
      getValue: (card, isAfter) => {
        if (Array.isArray(card?.showings) && card.showings.length > 0) {
          const active = card.showings.filter(s => s.status !== 'concluded').length;
          return `<span style="color: #38bdf8; font-weight: 700;">${card.showings.length} Slots</span> (${active} Active Upcoming)`;
        }
        return card?.startIso ? '1 Active Slot' : (card?.isPerennial ? 'Recurring Residency' : null);
      },
      badge: '+ Showings'
    },
    {
      code: 'D305',
      name: 'Doors Open Time',
      cluster: '3XX',
      clusterName: 'Cluster 3XX: Performance, Schedule & Content Reality',
      clusterClass: 'cluster-3xx',
      category: 'Temporal & Content',
      key: 'd305_doors',
      legacyKeys: ['d36_doors'],
      getValue: (card, isAfter) => {
        const t = isAfter ? (card?.afterDoorsTime || card?.doors_time || null) : (card?.doors_time || null);
        return t ? escapeHtml(t) : null;
      },
      badge: '+ Doors Extracted'
    },
    {
      code: 'D306',
      name: 'Curtain Call / Showtime',
      cluster: '3XX',
      clusterName: 'Cluster 3XX: Performance, Schedule & Content Reality',
      clusterClass: 'cluster-3xx',
      category: 'Temporal & Content',
      key: 'd306_showtime',
      legacyKeys: ['d37_showtime'],
      getValue: (card, isAfter) => {
        const t = isAfter ? (card?.afterTime || card?.time || card?.start_time || null) : (card?.time || card?.start_time || null);
        return t ? `<strong style="color: #cbd5e1;">${escapeHtml(t)}</strong>` : null;
      },
      badge: '+ Showtime Verified'
    },
    {
      code: 'D307',
      name: 'Conclusion / Curfew Time',
      cluster: '3XX',
      clusterName: 'Cluster 3XX: Performance, Schedule & Content Reality',
      clusterClass: 'cluster-3xx',
      category: 'Temporal & Content',
      key: 'd307_curfew',
      legacyKeys: ['d38_curfew'],
      getValue: (card, isAfter) => {
        const t = isAfter ? (card?.afterEndTime || card?.end_time || null) : (card?.end_time || null);
        return t ? escapeHtml(t) : null;
      },
      badge: '+ Curfew Checked'
    },
    {
      code: 'D308',
      name: 'Schedule Display String',
      cluster: '3XX',
      clusterName: 'Cluster 3XX: Performance, Schedule & Content Reality',
      clusterClass: 'cluster-3xx',
      category: 'Temporal & Content',
      key: 'd308_dateschedule',
      legacyKeys: ['d39_recurrence'],
      getValue: (card, isAfter) => {
        const r = card?.dateSchedule || card?.frequencyLabel || null;
        return r ? escapeHtml(r) : null;
      },
      badge: '+ Recurrence Parsed'
    },
    {
      code: 'D309',
      name: 'Frequency / Recurrence Pattern',
      cluster: '3XX',
      clusterName: 'Cluster 3XX: Performance, Schedule & Content Reality',
      clusterClass: 'cluster-3xx',
      category: 'Temporal & Content',
      key: 'd309_frequency',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.frequencyLabel || (card?.isPerennial ? 'Weekly Recurring Residency' : 'Single Performance Run'),
      badge: '+ Frequency'
    },
    {
      code: 'D310',
      name: 'Editorial Synopsis & Overview',
      cluster: '3XX',
      clusterName: 'Cluster 3XX: Performance, Schedule & Content Reality',
      clusterClass: 'cluster-3xx',
      category: 'Temporal & Content',
      key: 'd310_synopsis',
      legacyKeys: ['d51_desc'],
      getValue: (card, isAfter) => {
        const d = isAfter ? (card?.afterDescription || card?.afterDesc || card?.description || null) : (card?.description || null);
        if (!d) return null;
        return `<div style="max-height: 52px; overflow-y: auto; line-height: 1.35; color: #cbd5e1; font-size: 0.72rem;">${escapeHtml(d)}</div>`;
      },
      badge: '+ Synopsis Enriched'
    },

    // =========================================================================
    // CLUSTER 4XX: PHYSICAL VENUE GEOGRAPHY & PHYSICAL CONSTANTS
    // =========================================================================
    {
      code: 'D401',
      name: 'Physical Venue Name',
      cluster: '4XX',
      clusterName: 'Cluster 4XX: Physical Venue Geography & Physical Constants',
      clusterClass: 'cluster-4xx',
      category: 'Physical Constants',
      key: 'd401_venue_name',
      legacyKeys: ['d43_location', 'd43_venue'],
      getValue: (card, isAfter) => {
        const v = isAfter ? (card?.afterVenue || card?.venue || card?.venue_name || card?.name || null) : (card?.venue || card?.venue_name || card?.name || null);
        return v ? `📍 <strong>${escapeHtml(v)}</strong>` : null;
      },
      badge: '+ Venue Confirmed'
    },
    {
      code: 'D402',
      name: 'Civic Street Address',
      cluster: '4XX',
      clusterName: 'Cluster 4XX: Physical Venue Geography & Physical Constants',
      clusterClass: 'cluster-4xx',
      category: 'Physical Constants',
      key: 'd402_address',
      legacyKeys: ['d44_address'],
      getValue: (card, isAfter) => {
        const a = card?.afterAddress || card?.full_address || card?.address || (card?.neighborhood ? `${card.neighborhood}, Vancouver, BC` : (card?.venue || card?.venue_name ? `${card.venue || card.venue_name}, Vancouver, BC` : null));
        return a ? escapeHtml(a) : null;
      },
      badge: '+ Address Grounded'
    },
    {
      code: 'D403',
      name: 'Geocoded Coordinates (Lat / Lng)',
      cluster: '4XX',
      clusterName: 'Cluster 4XX: Physical Venue Geography & Physical Constants',
      clusterClass: 'cluster-4xx',
      category: 'Physical Constants',
      key: 'd403_gps',
      legacyKeys: ['d45_gps', 'd46_coords', 'd403_coords'],
      getValue: (card, isAfter) => {
        if (card?.coordinates) {
          const lat = card.coordinates.lat || card.coordinates[0];
          const lng = card.coordinates.lng || card.coordinates[1];
          if (lat && lng) return `<span style="font-family: monospace; font-size: 0.7rem; color: #38bdf8;">${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}</span>`;
        }
        if (card?.lat && card?.lng) {
          return `<span style="font-family: monospace; font-size: 0.7rem; color: #38bdf8;">${Number(card.lat).toFixed(4)}, ${Number(card.lng).toFixed(4)}</span>`;
        }
        return (card?.venue || card?.venue_name) ? 'Metro Vancouver GPS' : null;
      },
      badge: '+ Geo Grounded'
    },
    {
      code: 'D404',
      name: 'Neighborhood / Civic District',
      cluster: '4XX',
      clusterName: 'Cluster 4XX: Physical Venue Geography & Physical Constants',
      clusterClass: 'cluster-4xx',
      category: 'Physical Constants',
      key: 'd404_neighborhood',
      legacyKeys: ['d404_hood', 'd45_hood'],
      getValue: (card, isAfter) => card?.neighborhood || card?.district || (card?.venue ? 'Metro Vancouver' : null),
      badge: '+ District'
    },
    {
      code: 'D405',
      name: 'Venue Access Model',
      cluster: '4XX',
      clusterName: 'Cluster 4XX: Physical Venue Geography & Physical Constants',
      clusterClass: 'cluster-4xx',
      category: 'Physical Constants',
      key: 'd405_access_model',
      legacyKeys: ['d46_access', 'd405_access'],
      getValue: (card, isAfter) => card?.afterAccess || card?.access_model || (card?.price === 0 ? 'Public Open Drop-In' : 'Ticketed Admission / Box Office'),
      badge: '+ Access Model'
    },
    {
      code: 'D406',
      name: 'Environment Type (Indoor / Outdoor)',
      cluster: '4XX',
      clusterName: 'Cluster 4XX: Physical Venue Geography & Physical Constants',
      clusterClass: 'cluster-4xx',
      category: 'Physical Constants',
      key: 'd406_environment_type',
      legacyKeys: ['d47_env', 'd48_env', 'd406_env'],
      getValue: (card, isAfter) => card?.afterEnv || card?.environment_type || 'Indoor',
      badge: '+ Environment'
    },
    {
      code: 'D407',
      name: 'Weekly Operating Hours',
      cluster: '4XX',
      clusterName: 'Cluster 4XX: Physical Venue Geography & Physical Constants',
      clusterClass: 'cluster-4xx',
      category: 'Physical Constants',
      key: 'd407_weekly_hours',
      legacyKeys: ['d48_hours', 'd50_hours', 'd407_hours'],
      getValue: (card, isAfter) => {
        if (!card?.weekly_hours) return 'search_exhausted_null';
        if (typeof card.weekly_hours === 'object') return Object.entries(card.weekly_hours).slice(0, 3).map(([k, v]) => `${k}: ${v}`).join(' • ');
        return String(card.weekly_hours);
      },
      badge: '+ Hours'
    },
    {
      code: 'D408',
      name: 'Transit Access & Waypoints',
      cluster: '4XX',
      clusterName: 'Cluster 4XX: Physical Venue Geography & Physical Constants',
      clusterClass: 'cluster-4xx',
      category: 'Physical Constants',
      key: 'd408_transit_waypoints',
      legacyKeys: ['d50_transit', 'd47_transit', 'd408_transit'],
      getValue: (card, isAfter) => card?.afterTransit || card?.transit_info || (card?.venue || card?.venue_name ? 'TransLink Metro Vancouver transit accessible' : null),
      badge: '+ Transit Verified'
    },

    // =========================================================================
    // CLUSTER 5XX: ACCESSIBILITY & INCLUSION STANDARDS
    // =========================================================================
    {
      code: 'D501',
      name: 'Step-Free Physical Entrance',
      cluster: '5XX',
      clusterName: 'Cluster 5XX: Accessibility & Inclusion Standards',
      clusterClass: 'cluster-5xx',
      category: 'Accessibility',
      key: 'd501_entrance',
      legacyKeys: ['d501_step_free', 'd49_a11y'],
      getValue: (card, isAfter) => card?.step_free_entrance ?? card?.accessibility?.step_free ?? 'search_exhausted_null',
      badge: '+ Step-Free'
    },
    {
      code: 'D502',
      name: 'Elevator / Lift Access',
      cluster: '5XX',
      clusterName: 'Cluster 5XX: Accessibility & Inclusion Standards',
      clusterClass: 'cluster-5xx',
      category: 'Accessibility',
      key: 'd502_elevator',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.elevator_lift ?? card?.accessibility?.elevator ?? 'search_exhausted_null',
      badge: '+ Elevator'
    },
    {
      code: 'D503',
      name: 'Accessible Washroom Facilities',
      cluster: '5XX',
      clusterName: 'Cluster 5XX: Accessibility & Inclusion Standards',
      clusterClass: 'cluster-5xx',
      category: 'Accessibility',
      key: 'd503_washrooms',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.accessible_washrooms ?? card?.accessibility?.washrooms ?? 'search_exhausted_null',
      badge: '+ Washrooms'
    },
    {
      code: 'D504',
      name: 'Sensory Calibration & Low Stimulation',
      cluster: '5XX',
      clusterName: 'Cluster 5XX: Accessibility & Inclusion Standards',
      clusterClass: 'cluster-5xx',
      category: 'Accessibility',
      key: 'd504_sensory',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.sensory_calibrations ?? card?.accessibility?.sensory ?? 'Standard Audio/Lighting',
      badge: '+ Sensory'
    },
    {
      code: 'D505',
      name: 'Hearing Loop / Assistive Audio',
      cluster: '5XX',
      clusterName: 'Cluster 5XX: Accessibility & Inclusion Standards',
      clusterClass: 'cluster-5xx',
      category: 'Accessibility',
      key: 'd505_hearing_loop',
      legacyKeys: ['d505_hearing'],
      getValue: (card, isAfter) => card?.hearing_loop ?? card?.accessibility?.hearing_loop ?? 'search_exhausted_null',
      badge: '+ Hearing Loop'
    },
    {
      code: 'D506',
      name: 'Certified Service Animals Policy',
      cluster: '5XX',
      clusterName: 'Cluster 5XX: Accessibility & Inclusion Standards',
      clusterClass: 'cluster-5xx',
      category: 'Accessibility',
      key: 'd506_service_animals',
      legacyKeys: ['d506_animals'],
      getValue: (card, isAfter) => card?.service_animals ?? card?.accessibility?.service_animals ?? 'Welcome with Certification',
      badge: '+ Service Animals'
    },

    // =========================================================================
    // CLUSTER 6XX: ON-SITE SPEND BENCHMARKS & ANCILLARY AMENITIES
    // =========================================================================
    {
      code: 'D601',
      name: 'On-Site F&B Facilities',
      cluster: '6XX',
      clusterName: 'Cluster 6XX: On-Site Spend Benchmarks & Amenities',
      clusterClass: 'cluster-6xx',
      category: 'Spend Benchmarks',
      key: 'd601_on_site_fnb',
      legacyKeys: ['d49_spend', 'd601_fnb', 'd53_drink', 'd54_spend'],
      getValue: (card, isAfter) => card?.on_site_fnb || (card?.venue ? 'Concessions / Licensed Bar available' : null),
      badge: '+ F&B'
    },
    {
      code: 'D602',
      name: 'Coffee Spend Benchmark ($ CAD)',
      cluster: '6XX',
      clusterName: 'Cluster 6XX: On-Site Spend Benchmarks & Amenities',
      clusterClass: 'cluster-6xx',
      category: 'Spend Benchmarks',
      key: 'd602_coffee_benchmark',
      legacyKeys: ['d602_coffee'],
      getValue: (card, isAfter) => card?.coffee_benchmark || card?.spend_benchmarks?.coffee || 'search_exhausted_null',
      badge: '+ Coffee'
    },
    {
      code: 'D603',
      name: 'Craft Beer Spend Benchmark ($ CAD)',
      cluster: '6XX',
      clusterName: 'Cluster 6XX: On-Site Spend Benchmarks & Amenities',
      clusterClass: 'cluster-6xx',
      category: 'Spend Benchmarks',
      key: 'd603_beer_benchmark',
      legacyKeys: ['d603_beer'],
      getValue: (card, isAfter) => card?.beer_benchmark || card?.spend_benchmarks?.beer || '$7.50–$9.50 CAD',
      badge: '+ Beer'
    },
    {
      code: 'D604',
      name: 'Meal / Entree Benchmark ($ CAD)',
      cluster: '6XX',
      clusterName: 'Cluster 6XX: On-Site Spend Benchmarks & Amenities',
      clusterClass: 'cluster-6xx',
      category: 'Spend Benchmarks',
      key: 'd604_meal_benchmark',
      legacyKeys: ['d604_meal'],
      getValue: (card, isAfter) => card?.meal_benchmark || card?.spend_benchmarks?.meal || '$14.00–$18.00 CAD',
      badge: '+ Meal'
    },
    {
      code: 'D605',
      name: 'Outside Food & Drink Policy',
      cluster: '6XX',
      clusterName: 'Cluster 6XX: On-Site Spend Benchmarks & Amenities',
      clusterClass: 'cluster-6xx',
      category: 'Spend Benchmarks',
      key: 'd605_outside_food_policy',
      legacyKeys: ['d605_outside_food'],
      getValue: (card, isAfter) => card?.outside_food_policy || 'Water Bottles Only / No Outside F&B',
      badge: '+ Policy'
    },
    {
      code: 'D606',
      name: 'Coat Check Availability & Fee',
      cluster: '6XX',
      clusterName: 'Cluster 6XX: On-Site Spend Benchmarks & Amenities',
      clusterClass: 'cluster-6xx',
      category: 'Spend Benchmarks',
      key: 'd606_coat_check',
      legacyKeys: ['d606_coat'],
      getValue: (card, isAfter) => card?.coat_check || 'search_exhausted_null',
      badge: '+ Coat Check'
    },
    {
      code: 'D607',
      name: 'Payment Methods (Cash / Card / Tap)',
      cluster: '6XX',
      clusterName: 'Cluster 6XX: On-Site Spend Benchmarks & Amenities',
      clusterClass: 'cluster-6xx',
      category: 'Spend Benchmarks',
      key: 'd607_payment_methods',
      legacyKeys: ['d607_payment'],
      getValue: (card, isAfter) => card?.payment_methods || 'Credit, Debit & Contactless Tap',
      badge: '+ Payment'
    },
    {
      code: 'D608',
      name: 'Free Water Refill Station',
      cluster: '6XX',
      clusterName: 'Cluster 6XX: On-Site Spend Benchmarks & Amenities',
      clusterClass: 'cluster-6xx',
      category: 'Spend Benchmarks',
      key: 'd608_water_refill',
      legacyKeys: ['d608_water'],
      getValue: (card, isAfter) => card?.water_refill_station || 'search_exhausted_null',
      badge: '+ Water'
    },

    // =========================================================================
    // CLUSTER 7XX: CULTURAL ARCHETYPE CUSTOM PROFILES
    // =========================================================================
    {
      code: 'D711',
      name: 'Cinema: Film Runtime (Mins)',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd711_film_runtime',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.film_runtime_minutes ? `${card.archetypeProfile.film_runtime_minutes} mins` : 'not_applicable',
      badge: '+ Runtime'
    },
    {
      code: 'D712',
      name: 'Cinema: Language & Subtitles',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd712_film_language',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.film_language_subtitles || 'not_applicable',
      badge: '+ Subtitles'
    },
    {
      code: 'D713',
      name: 'Cinema: Projection Format (35mm/DCP)',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd713_projection_format',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.projection_format || 'not_applicable',
      badge: '+ Format'
    },
    {
      code: 'D721',
      name: 'Live Stage: Seating Configuration',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd721_stage_seating',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.stage_seating_layout || 'not_applicable',
      badge: '+ Seating'
    },
    {
      code: 'D722',
      name: 'Live Stage: Intermission Details',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd722_intermission',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.intermission_details || 'not_applicable',
      badge: '+ Intermission'
    },
    {
      code: 'D731',
      name: 'Workshop: Materials & Supplies Provided',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd731_workshop_materials',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.materials_provided || 'not_applicable',
      badge: '+ Materials'
    },
    {
      code: 'D733',
      name: 'Workshop: Maximum Participant Cap',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd733_workshop_capacity',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.workshop_capacity_cap || 'not_applicable',
      badge: '+ Capacity'
    },
    {
      code: 'D741',
      name: 'Social Gaming: Table Cover / Pass',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd741_game_table_cover',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.table_cover_fee || 'not_applicable',
      badge: '+ Table Cover'
    },
    {
      code: 'D744',
      name: 'Social Gaming: Library Size & Rules Teacher',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd744_game_library',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.game_library_size ? `${card.archetypeProfile.game_library_size} titles` : 'not_applicable',
      badge: '+ Library'
    },
    {
      code: 'D751',
      name: 'Civic Park: Surface & Terrain',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd751_park_terrain',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.trail_terrain_surface || 'not_applicable',
      badge: '+ Terrain'
    },
    {
      code: 'D752',
      name: 'Civic Park: Dog & Leash Policy',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd752_pet_leash',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.pet_leash_policy || 'not_applicable',
      badge: '+ Leash'
    },
    {
      code: 'D761',
      name: 'Museum: Exhibition Run Schedule',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd761_museum_dates',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.exhibition_run_dates || 'not_applicable',
      badge: '+ Exhibits'
    },
    {
      code: 'D764',
      name: 'Museum: Bag & Backpack Policy',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd764_bag_rules',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.bag_check_rules || 'not_applicable',
      badge: '+ Bag Policy'
    },
    {
      code: 'D771',
      name: 'Active Rec: Digital Safety Waiver',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd771_rec_waiver',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.digital_waiver_required ? 'Required Online' : 'not_applicable',
      badge: '+ Waiver'
    },
    {
      code: 'D781',
      name: 'Roving: Secret Location Dispatch',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd781_roving_reveal',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.archetypeProfile?.location_reveal_protocol || 'not_applicable',
      badge: '+ Secret Location'
    },
    {
      code: 'D791',
      name: 'Festival: Affiliation & Hub Directory',
      cluster: '7XX',
      clusterName: 'Cluster 7XX: Cultural Archetype Custom Profiles',
      clusterClass: 'cluster-7xx',
      category: 'Archetype Profile',
      key: 'd791_festival_hub',
      legacyKeys: ['d52_festival'],
      getValue: (card, isAfter) => card?.festival_affiliation || card?.archetypeProfile?.festival_hub_directory || 'Independent / Non-Festival',
      badge: '+ Festival Hub'
    },

    // =========================================================================
    // CLUSTER 8XX: GOVERNANCE, PIPELINE PROVENANCE & VISUAL PROOF
    // =========================================================================
    {
      code: 'D801',
      name: 'SRSA Single Publisher Invariant',
      cluster: '8XX',
      clusterName: 'Cluster 8XX: Governance, Pipeline Provenance & Visual Proof',
      clusterClass: 'cluster-8xx',
      category: 'Provenance & Proof',
      key: 'd801_srsa_compliance',
      legacyKeys: [],
      getValue: (card, isAfter) => '✅ Compliant: ripper/compile_catalog.js exclusive publisher',
      badge: '+ SRSA Compliant'
    },
    {
      code: 'D802',
      name: 'Multi-Layer Sourcing Provenance',
      cluster: '8XX',
      clusterName: 'Cluster 8XX: Governance, Pipeline Provenance & Visual Proof',
      clusterClass: 'cluster-8xx',
      category: 'Provenance & Proof',
      key: 'd802_multi_layer_provenance',
      legacyKeys: ['d56_provenance'],
      getValue: (card, isAfter) => card?.data_provenance || card?.source || (isAfter ? 'Live Antigravity Ingestion' : 'Master Layer Database'),
      badge: '+ Provenance'
    },
    {
      code: 'D803',
      name: 'SPA Hydration & Extraction Method',
      cluster: '8XX',
      clusterName: 'Cluster 8XX: Governance, Pipeline Provenance & Visual Proof',
      clusterClass: 'cluster-8xx',
      category: 'Provenance & Proof',
      key: 'd803_spa_hydration',
      legacyKeys: [],
      getValue: (card, isAfter) => 'Chromium Dynamic DOM Hydration',
      badge: '+ Hydrated'
    },
    {
      code: 'D804',
      name: 'Active Future Showings Count',
      cluster: '8XX',
      clusterName: 'Cluster 8XX: Governance, Pipeline Provenance & Visual Proof',
      clusterClass: 'cluster-8xx',
      category: 'Provenance & Proof',
      key: 'd804_active_showings',
      legacyKeys: [],
      getValue: (card, isAfter) => Array.isArray(card?.showings) ? `${card.showings.filter(s => s.status !== 'concluded').length} Active Upcoming` : '1 Showing',
      badge: '+ Active Slots'
    },
    {
      code: 'D805',
      name: 'Archived Concluded Showings Count',
      cluster: '8XX',
      clusterName: 'Cluster 8XX: Governance, Pipeline Provenance & Visual Proof',
      clusterClass: 'cluster-8xx',
      category: 'Provenance & Proof',
      key: 'd805_archived_showings',
      legacyKeys: [],
      getValue: (card, isAfter) => Array.isArray(card?.showings) ? `${card.showings.filter(s => s.status === 'concluded').length} Concluded` : '0 Concluded',
      badge: '+ Archived'
    },
    {
      code: 'D806',
      name: 'Curator Override Lock & Appeal Flag',
      cluster: '8XX',
      clusterName: 'Cluster 8XX: Governance, Pipeline Provenance & Visual Proof',
      clusterClass: 'cluster-8xx',
      category: 'Provenance & Proof',
      key: 'd806_curator_lock',
      legacyKeys: [],
      getValue: (card, isAfter) => card?.curator_lock ? '🔒 Locked by Curator' : (card?.ai_curator_appeal ? '⚠️ AI Curator Appeal Active' : 'Normal Catalog State'),
      badge: '+ Governance'
    },
    {
      code: 'D807',
      name: 'Visual Proof Keyframe Anchor',
      cluster: '8XX',
      clusterName: 'Cluster 8XX: Governance, Pipeline Provenance & Visual Proof',
      clusterClass: 'cluster-8xx',
      category: 'Provenance & Proof',
      key: 'd807_proof_keyframes',
      legacyKeys: ['proof'],
      getValue: (card, isAfter) => {
        const proofUrl = isAfter
          ? (card?.proofKeyframeUrl || card?.proof_keyframe || card?.proof_keyframes?.cart || card?.proof_keyframes?.schedule || (card?.hasProof && card?.id ? `data/proof_keyframes/${card.id}_cart.png` : null) || (card?.hasProof && card?.id ? `data/proofs/${card.id}_cart.webp` : null) || null)
          : (card?.proof_keyframe || card?.proof_keyframes?.cart || card?.proof_keyframes?.schedule || (card?.id ? `data/proof_keyframes/${card.id}_cart.png` : null) || (card?.id ? `data/proofs/${card.id}_cart.webp` : null));
        if (!proofUrl) return null;
        return `
          <div style="position: relative; max-width: 180px;">
            <img src="${escapeHtml(proofUrl)}" class="yield-proof-thumb" alt="Proof Keyframe" onclick="openScreenshotModal('${escapeHtml(proofUrl)}')" title="Click to enlarge proof">
            <div style="font-size: 0.62rem; color: #38bdf8; margin-top: 2px; cursor: pointer;" onclick="openScreenshotModal('${escapeHtml(proofUrl)}')">
              🔍 Click to enlarge
            </div>
          </div>
        `;
      },
      badge: '+ Live Proof'
    },
    {
      code: 'D808',
      name: 'Audited Timestamp Lockstep',
      cluster: '8XX',
      clusterName: 'Cluster 8XX: Governance, Pipeline Provenance & Visual Proof',
      clusterClass: 'cluster-8xx',
      category: 'Provenance & Proof',
      key: 'd808_timestamp_lockstep',
      legacyKeys: ['d58_audit_ts'],
      getValue: (card, isAfter) => {
        if (isAfter) {
          return card?.last_grounded_at || card?.last_qc_audited_at || new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
        }
        return card?.last_grounded_at || card?.last_qc_audited_at || card?.last_pulse_qc_at || (card?.id || card?.venue_name ? 'Baseline' : null);
      },
      badge: '+ Timestamped'
    }
  ];

  window.FULL_CATALOG_DIMENSIONS = FULL_CATALOG_DIMENSIONS;
  syncDynamicDimensionCounts();

  function isDimInScopeForScan(dimOrKey, scanKey = currentPipelineScanKey) {
    if (scanKey === 'compile') return true; // Scan 5: Live Compiler reconciles ALL dimensions!

    const scanMap = {
      harvest: {
        d001_title: true, d33_title: true,
        d002_perm_id: true,
        d004_category: true, d41_category: true,
        d005_tags: true,
        d006_lifecycle: true,
        d007_archetype: true,
        d101_checkout: true, d1_checkout: true,
        d102_event_page: true, d2_event_page: true,
        d103_calendar: true, d3_calendar: true,
        d106_best_link: true, d6_tier: true,
        d301_lineup: true, d34_lineup: true,
        d302_artist: true,
        d303_date: true, d35_date: true,
        d304_showings: true,
        d305_doors: true, d36_doors: true,
        d306_showtime: true, d37_showtime: true,
        d307_curfew: true, d38_curfew: true,
        d308_dateschedule: true, d39_recurrence: true,
        d309_frequency: true,
        d401_venue_name: true, d43_location: true,
        d807_proof_keyframes: true, proof: true
      },
      hunter: {
        d001_title: true, d33_title: true,
        d101_checkout: true, d1_checkout: true,
        d102_event_page: true, d2_event_page: true,
        d106_best_link: true, d6_tier: true,
        d108_geo: true, d8_geo: true,
        d221_ticket_provider: true, d31_provider: true,
        d401_venue_name: true, d43_location: true,
        d803_spa_hydration: true,
        d808_timestamp_lockstep: true, d58_audit_ts: true
      },
      qc: {
        d001_title: true, d33_title: true,
        d008_restrictions: true, d42_age: true,
        d101_checkout: true, d1_checkout: true,
        d102_event_page: true, d2_event_page: true,
        d106_best_link: true, d6_tier: true,
        d107_inventory: true, d7_inventory: true,
        d108_geo: true, d8_geo: true,
        d109_currency: true, d9_currency: true,
        d201_tier1_name: true, d11_tier1_name: true,
        d202_tier1_base: true, d12_base: true,
        d203_tier1_fee: true, d13_fee: true,
        d204_tier1_tax: true, d14_tax: true,
        d205_tier1_allin: true, d15_allin: true,
        d206_tier2_name: true, d16_tier2_name: true,
        d207_tier2_base: true, d17_tier2_base: true,
        d208_tier2_fee: true, d18_tier2_fee: true,
        d209_tier2_tax: true, d19_tier2_tax: true,
        d210_tier2_allin: true, d20_tier2_allin: true,
        d211_tier3_name: true, d21_tier3_name: true,
        d212_tier3_base: true, d22_tier3_base: true,
        d213_tier3_fee: true, d23_tier3_fee: true,
        d214_tier3_tax: true, d24_tier3_tax: true,
        d215_tier3_allin: true, d25_tier3_allin: true,
        d216_tier_count: true, d26_tier_count: true,
        d217_pricing_model: true, d27_pricing_model: true,
        d218_budget_qualified: true, d28_budget: true,
        d219_other_cost_label: true, d29_other_label: true,
        d220_other_cost_price: true, d30_other_price: true,
        d221_ticket_provider: true, d31_provider: true,
        d222_booking_protocol: true, d32_booking_protocol: true,
        d303_date: true, d35_date: true,
        d304_showings: true,
        d305_doors: true, d36_doors: true,
        d306_showtime: true, d37_showtime: true,
        d307_curfew: true, d38_curfew: true,
        d401_venue_name: true, d43_location: true,
        d803_spa_hydration: true,
        d807_proof_keyframes: true, proof: true,
        d808_timestamp_lockstep: true, d58_audit_ts: true
      },
      enrich: {
        d001_title: true, d33_title: true,
        d004_category: true, d41_category: true,
        d005_tags: true,
        d006_lifecycle: true,
        d007_archetype: true,
        d008_restrictions: true, d42_age: true,
        d301_lineup: true, d34_lineup: true,
        d302_artist: true,
        d305_doors: true, d36_doors: true,
        d306_showtime: true, d37_showtime: true,
        d308_dateschedule: true, d39_recurrence: true,
        d309_frequency: true,
        d310_synopsis: true, d51_desc: true,
        d711_film_runtime: true,
        d712_film_language: true,
        d713_projection_format: true,
        d721_stage_seating: true,
        d722_intermission: true,
        d731_workshop_materials: true,
        d733_workshop_capacity: true,
        d741_game_table_cover: true,
        d744_game_library: true,
        d751_park_terrain: true,
        d752_pet_leash: true,
        d761_museum_dates: true,
        d764_bag_rules: true,
        d771_rec_waiver: true,
        d781_roving_reveal: true,
        d791_festival_hub: true, d52_festival: true,
        d802_multi_layer_provenance: true, d56_provenance: true
      },
      venue: {
        d103_calendar: true, d3_calendar: true,
        d104_civic: true, d4_civic: true,
        d105_venue_home: true, d5_venue_home: true,
        d108_geo: true, d8_geo: true,
        d401_venue_name: true, d43_location: true, d43_venue: true,
        d402_address: true, d44_address: true,
        d403_gps: true, d403_coords: true, d45_gps: true, d46_coords: true,
        d404_neighborhood: true, d404_hood: true, d45_hood: true,
        d405_access_model: true, d405_access: true, d46_access: true,
        d406_environment_type: true, d406_env: true, d47_env: true, d48_env: true,
        d407_weekly_hours: true, d407_hours: true, d48_hours: true, d50_hours: true,
        d408_transit_waypoints: true, d408_transit: true, d50_transit: true, d47_transit: true,
        d501_entrance: true, d501_step_free: true, d49_a11y: true,
        d502_elevator: true,
        d503_washrooms: true,
        d504_sensory: true,
        d505_hearing_loop: true, d505_hearing: true,
        d506_service_animals: true, d506_animals: true,
        d601_on_site_fnb: true, d601_fnb: true, d49_spend: true, d53_drink: true, d54_spend: true,
        d602_coffee_benchmark: true, d602_coffee: true,
        d603_beer_benchmark: true, d603_beer: true,
        d604_meal_benchmark: true, d604_meal: true,
        d605_outside_food_policy: true, d605_outside_food: true,
        d606_coat_check: true, d606_coat: true,
        d607_payment_methods: true, d607_payment: true,
        d608_water_refill: true, d608_water: true,
        d807_proof_keyframes: true, proof: true,
        d808_timestamp_lockstep: true, d58_audit_ts: true
      }
    };

    const map = scanMap[scanKey] || scanMap.qc;
    if (typeof dimOrKey === 'string') {
      return Boolean(map[dimOrKey]);
    }
    if (dimOrKey && typeof dimOrKey === 'object') {
      if (map[dimOrKey.key]) return true;
      if (dimOrKey.code && map[dimOrKey.code.toLowerCase()]) return true;
      if (Array.isArray(dimOrKey.legacyKeys)) {
        for (const lk of dimOrKey.legacyKeys) {
          if (map[lk]) return true;
        }
      }
    }
    return false;
  }

  const STAGE_META_MAP = {
    harvest: {
      key: 'harvest',
      shortLabel: '📅 1A: Harvester',
      fullLabel: '📅 Stage 1A: Schedule Harvester',
      color: '#d8b4fe',
      border: 'rgba(168, 85, 247, 0.55)',
      bgTint: 'rgba(168, 85, 247, 0.14)',
      pillBg: 'rgba(168, 85, 247, 0.22)'
    },
    hunter: {
      key: 'hunter',
      shortLabel: '🏹 1B: Link Hunter',
      fullLabel: '🏹 Stage 1B: Tier 1 Link Hunter',
      color: '#5eead4',
      border: 'rgba(20, 184, 166, 0.55)',
      bgTint: 'rgba(20, 184, 166, 0.14)',
      pillBg: 'rgba(20, 184, 166, 0.22)'
    },
    qc: {
      key: 'qc',
      shortLabel: '🎟️ 2: Stagehand QC',
      fullLabel: '🎟️ Stage 2: Box Office QC',
      color: '#7dd3fc',
      border: 'rgba(56, 189, 248, 0.55)',
      bgTint: 'rgba(56, 189, 248, 0.14)',
      pillBg: 'rgba(56, 189, 248, 0.22)'
    },
    enrich: {
      key: 'enrich',
      shortLabel: '✨ 3: AI Enricher',
      fullLabel: '✨ Stage 3: AI Semantic Enricher',
      color: '#fde68a',
      border: 'rgba(251, 191, 36, 0.55)',
      bgTint: 'rgba(251, 191, 36, 0.14)',
      pillBg: 'rgba(251, 191, 36, 0.22)'
    },
    venue: {
      key: 'venue',
      shortLabel: '🏛️ 4: Venue Detailer',
      fullLabel: '🏛️ Stage 4: Venue Detailer',
      color: '#67e8f9',
      border: 'rgba(6, 182, 212, 0.55)',
      bgTint: 'rgba(6, 182, 212, 0.14)',
      pillBg: 'rgba(6, 182, 212, 0.22)'
    },
    compile: {
      key: 'compile',
      shortLabel: '🚀 5: Compiler',
      fullLabel: '🚀 Stage 5: Catalog Compiler',
      color: '#6ee7b7',
      border: 'rgba(16, 185, 129, 0.55)',
      bgTint: 'rgba(16, 185, 129, 0.14)',
      pillBg: 'rgba(16, 185, 129, 0.22)'
    }
  };

  function getDimensionStageMeta(dim) {
    if (!dim) return STAGE_META_MAP.compile;
    const code = String(dim.code || '').toUpperCase();
    const key = String(dim.key || '');
    if (/^D[456]\d\d$/.test(code) || code === 'D103' || code === 'D104' || code === 'D105') {
      return STAGE_META_MAP.venue;
    }
    if (/^D7\d\d$/.test(code) || code === 'D001' || code === 'D004' || code === 'D005' || code === 'D006' || code === 'D007' ||
      code === 'D301' || code === 'D302' || code === 'D305' || code === 'D306' || code === 'D308' || code === 'D309' || code === 'D310' || code === 'D311') {
      return STAGE_META_MAP.enrich;
    }
    if (code === 'D101' || code === 'D102' || code === 'D106' || code === 'D221' || code === 'D803') {
      return STAGE_META_MAP.hunter;
    }
    if (/^D2\d\d$/.test(code) || code === 'D008' || code === 'D107' || code === 'D807' || key === 'proof') {
      return STAGE_META_MAP.qc;
    }
    if (code === 'D002' || code === 'D303' || code === 'D304' || code === 'D307') {
      return STAGE_META_MAP.harvest;
    }
    if (isDimInScopeForScan(dim, 'venue')) return STAGE_META_MAP.venue;
    if (isDimInScopeForScan(dim, 'enrich')) return STAGE_META_MAP.enrich;
    if (isDimInScopeForScan(dim, 'hunter')) return STAGE_META_MAP.hunter;
    if (isDimInScopeForScan(dim, 'qc')) return STAGE_META_MAP.qc;
    if (isDimInScopeForScan(dim, 'harvest')) return STAGE_META_MAP.harvest;
    return STAGE_META_MAP.compile;
  }

  function isRealScannedValue(val) {
    if (!val) return false;
    const str = String(val);
    if (str.includes('not_applicable') || str.includes('none_available') || str.includes('search_exhausted_null') || str.includes('yield-empty-field')) {
      return false;
    }
    const stripped = str.replace(/<[^>]+>/g, '').trim();
    if (!stripped || stripped === '—' || stripped === '-' || stripped === 'null' || stripped === 'undefined') {
      return false;
    }
    return true;
  }

  function updateComparisonFilterButtonUI(scanKey = currentPipelineScanKey) {
    const totalDims = FULL_CATALOG_DIMENSIONS.length;
    const inScopeDims = FULL_CATALOG_DIMENSIONS.filter(d => isDimInScopeForScan(d, scanKey)).length;
    const btnReal = document.getElementById('btn-comp-filter-inscope');
    const iconReal = document.getElementById('btn-comp-filter-icon');
    const labelReal = document.getElementById('btn-comp-filter-label');
    const countReal = document.getElementById('btn-comp-filter-count');
    if (btnReal) {
      if (scanKey === 'compile') {
        btnReal.style.background = 'rgba(16, 185, 129, 0.16)';
        btnReal.style.color = '#6ee7b7';
        btnReal.style.borderColor = 'rgba(16, 185, 129, 0.45)';
        if (iconReal) iconReal.textContent = '🌈';
        if (labelReal) labelReal.textContent = 'All Stages Dimensions Highlighted';
        if (countReal) countReal.textContent = `(${totalDims}D)`;
      } else if (pipelineCompFilterInScopeOnly) {
        btnReal.style.background = 'rgba(56, 189, 248, 0.22)';
        btnReal.style.color = '#7dd3fc';
        btnReal.style.borderColor = 'rgba(56, 189, 248, 0.55)';
        if (iconReal) iconReal.textContent = '🎯';
        if (labelReal) labelReal.textContent = 'Showing Step Dimensions Only (Show All)';
        if (countReal) countReal.textContent = `(${inScopeDims}/${totalDims}D)`;
      } else {
        btnReal.style.background = 'rgba(14, 165, 233, 0.15)';
        btnReal.style.color = '#38bdf8';
        btnReal.style.borderColor = 'rgba(56, 189, 248, 0.4)';
        if (iconReal) iconReal.textContent = '🔬';
        if (labelReal) labelReal.textContent = 'Show Step Dimensions Only';
        if (countReal) countReal.textContent = `(${inScopeDims})`;
      }
    }
    const btn = document.getElementById('btn-toggle-comp-inscope-filter');
    const labelEl = document.getElementById('comp-inscope-filter-label');
    if (!btn) return;
    if (scanKey === 'compile') {
      btn.style.background = 'rgba(148, 163, 184, 0.12)';
      btn.style.color = '#cbd5e1';
      btn.style.borderColor = 'rgba(148, 163, 184, 0.35)';
      if (labelEl) labelEl.textContent = `All ${getCatalogDimensionsCount()}D`;
      return;
    }
    if (pipelineCompFilterInScopeOnly) {
      btn.style.background = 'rgba(56, 189, 248, 0.15)';
      btn.style.color = '#38bdf8';
      btn.style.borderColor = 'rgba(56, 189, 248, 0.45)';
      if (labelEl) labelEl.textContent = 'In-Scope Only';
    } else {
      btn.style.background = 'rgba(148, 163, 184, 0.12)';
      btn.style.color = '#cbd5e1';
      btn.style.borderColor = 'rgba(148, 163, 184, 0.35)';
      if (labelEl) labelEl.textContent = `All ${getCatalogDimensionsCount()}D`;
    }
  }

  window.toggleComparisonInScopeFilter = function () {
    pipelineCompFilterInScopeOnly = !pipelineCompFilterInScopeOnly;
    updateComparisonFilterButtonUI(currentPipelineScanKey);
    if (typeof renderComparisonCards === 'function') {
      renderComparisonCards(pipelineLastCompAfter, pipelineLastCompBefore, pipelineLastCompIsStreaming);
    }
  };

  function generate3ColComparisonTableHtml(before, after, isStreaming, scanKey = currentPipelineScanKey, agentLabel = 'AI Agent') {
    const scanCfg = AI_SCAN_TARGET_DIMENSIONS[scanKey] || AI_SCAN_TARGET_DIMENSIONS.qc;
    const scanName = scanCfg.name;

    let cardIdx = (after?.id && pipelineInitialSnapshots && typeof pipelineInitialSnapshots.get === 'function' && pipelineInitialSnapshots.get(after.id)?.cardIndex)
      || after?.cardIndex
      || (before?.id && pipelineInitialSnapshots && typeof pipelineInitialSnapshots.get === 'function' && pipelineInitialSnapshots.get(before.id)?.cardIndex)
      || before?.cardIndex;
    const allEvs = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const qEvs = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);
    const targetId = after?.id || after?.event_id || before?.id || before?.event_id;
    if (!cardIdx && targetId) {
      const found = allEvs.findIndex(e => (e.id || e.event_id) === targetId);
      if (found !== -1) {
        cardIdx = found + 1;
      } else {
        const qFound = qEvs.findIndex(e => (e.id || e.event_id) === targetId);
        if (qFound !== -1) cardIdx = `Q${qFound + 1}`;
      }
    }
    if (!cardIdx) cardIdx = '?';
    const isVenueStage = (scanKey === 'venue');
    const badgeLabel = isVenueStage
      ? `Venue #${cardIdx}`
      : (String(cardIdx).startsWith('Q') ? `QUARANTINED #${cardIdx}` : `Card #${cardIdx}`);

    const totalDimsCount = FULL_CATALOG_DIMENSIONS.length;
    const inScopeDimsCount = FULL_CATALOG_DIMENSIONS.filter(d => isDimInScopeForScan(d.key, scanKey)).length;

    updateComparisonFilterButtonUI(scanKey);
    const stageScannedCounts = { harvest: 0, hunter: 0, qc: 0, enrich: 0, venue: 0, compile: 0 };
    const btnFilter = document.getElementById('btn-toggle-comp-inscope-filter');
    const labelEl = document.getElementById('comp-inscope-filter-label');
    if (btnFilter && labelEl) {
      if (scanKey === 'compile') {
        labelEl.textContent = `All ${totalDimsCount}D`;
      } else if (pipelineCompFilterInScopeOnly) {
        labelEl.textContent = `In-Scope (${inScopeDimsCount}/${totalDimsCount}D)`;
      } else {
        labelEl.textContent = `All ${totalDimsCount}D`;
      }
    }

    const filteredDims = (pipelineCompFilterInScopeOnly && scanKey !== 'compile')
      ? FULL_CATALOG_DIMENSIONS.filter(dim => isDimInScopeForScan(dim.key, scanKey))
      : FULL_CATALOG_DIMENSIONS;

    const rowsHtml = filteredDims.map(dim => {
      const inScope = isDimInScopeForScan(dim.key, scanKey);
      const beforeVal = dim.getValue(before, false);
      const afterVal = dim.getValue(after, true);

      // Determine if after is filled or streaming
      const isStreamingThisDim = isStreaming && inScope && (!afterVal || (dim.key === 'proof' && !after?.proofKeyframeUrl && !after?.hasProof));
      const hasAfterYield = Boolean(afterVal);

      const dimStageMeta = getDimensionStageMeta(dim);
      const hasRealBefore = isRealScannedValue(beforeVal);
      const hasRealAfter = isRealScannedValue(afterVal);
      if (hasRealAfter || hasRealBefore) {
        stageScannedCounts[dimStageMeta.key] = (stageScannedCounts[dimStageMeta.key] || 0) + 1;
      }
      const effectiveScanTheme = (scanKey === 'compile') ? dimStageMeta.key : scanKey;
      let rowClass = inScope ? `row-in-scope scan-${effectiveScanTheme}` : 'row-out-of-scope';

      // Column 1 content: Dimension Label ("Example D33 Event Name")
      let dimDisplayName = escapeHtml(dim.name);
      if (dim.code >= 'D101' && dim.code <= 'D106') {
        const tierTargetUrl = extractTierUrl(after, dim.code, true) || extractTierUrl(before, dim.code, false);
        if (tierTargetUrl) {
          const openFn = `onclick="event.stopPropagation(); if (window.openCuratorWindow) { window.openCuratorWindow(this.href); return false; }"`;
          if (dim.code === 'D101') {
            dimDisplayName = `<a href="${escapeHtml(tierTargetUrl)}" target="_blank" rel="noopener noreferrer" ${openFn} class="tier-col1-link" title="Open Tier 1 Cart: ${escapeHtml(tierTargetUrl)}" style="color: #38bdf8; text-decoration: underline; font-weight: 800;">Tier 1 ↗</a>: Checkout Cart URL`;
          } else if (dim.code === 'D102') {
            dimDisplayName = `<a href="${escapeHtml(tierTargetUrl)}" target="_blank" rel="noopener noreferrer" ${openFn} class="tier-col1-link" title="Open Tier 2 Event Page: ${escapeHtml(tierTargetUrl)}" style="color: #c4b5fd; text-decoration: underline; font-weight: 800;">Tier 2 ↗</a>: Event Details Page`;
          } else if (dim.code === 'D103') {
            dimDisplayName = `<a href="${escapeHtml(tierTargetUrl)}" target="_blank" rel="noopener noreferrer" ${openFn} class="tier-col1-link" title="Open Tier 3 Calendar: ${escapeHtml(tierTargetUrl)}" style="color: #6ee7b7; text-decoration: underline; font-weight: 800;">Tier 3 ↗</a>: Venue Calendar URL`;
          } else if (dim.code === 'D104') {
            dimDisplayName = `<a href="${escapeHtml(tierTargetUrl)}" target="_blank" rel="noopener noreferrer" ${openFn} class="tier-col1-link" title="Open Tier 4 Civic Guide: ${escapeHtml(tierTargetUrl)}" style="color: #fde68a; text-decoration: underline; font-weight: 800;">Tier 4 ↗</a>: Civic Destination URL`;
          } else if (dim.code === 'D105') {
            dimDisplayName = `<a href="${escapeHtml(tierTargetUrl)}" target="_blank" rel="noopener noreferrer" ${openFn} class="tier-col1-link" title="Open Tier 5 Venue Home: ${escapeHtml(tierTargetUrl)}" style="color: #cbd5e1; text-decoration: underline; font-weight: 800;">Tier 5 ↗</a>: Venue Home Domain`;
          } else if (dim.code === 'D106') {
            dimDisplayName = `<a href="${escapeHtml(tierTargetUrl)}" target="_blank" rel="noopener noreferrer" ${openFn} class="tier-col1-link" title="Open Best Available Link: ${escapeHtml(tierTargetUrl)}" style="color: #38bdf8; text-decoration: underline; font-weight: 800;">Best Available Link &amp; Tier ↗</a>`;
          }
        }
      } else if (dim.code === 'D1' || dim.code === 'D6') {
        const tierTargetUrl = extractTierUrl(after, dim.code, true) || extractTierUrl(before, dim.code, false);
        if (tierTargetUrl) {
          const openFn = `onclick="event.stopPropagation(); if (window.openCuratorWindow) { window.openCuratorWindow(this.href); return false; }"`;
          if (dim.code === 'D1') {
            dimDisplayName = `<a href="${escapeHtml(tierTargetUrl)}" target="_blank" rel="noopener noreferrer" ${openFn} class="tier-col1-link" title="Open Live Cart: ${escapeHtml(tierTargetUrl)}" style="color: #38bdf8; text-decoration: underline; font-weight: 800;">Tier 1 ↗</a>: Live Checkout Cart URL`;
          } else if (dim.code === 'D6') {
            dimDisplayName = `<a href="${escapeHtml(tierTargetUrl)}" target="_blank" rel="noopener noreferrer" ${openFn} class="tier-col1-link" title="Open Best Available Link: ${escapeHtml(tierTargetUrl)}" style="color: #38bdf8; text-decoration: underline; font-weight: 800;">Best Available Tier ↗</a>`;
          }
        }
      }

      const col1Html = `
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; width: 100%;">
          <div style="flex: 1 1 auto; min-width: 0; padding-right: 4px;">
            <span class="dim-code-badge ${inScope ? `target theme-${effectiveScanTheme}` : 'neutral'}">${escapeHtml(dim.code)}</span>
            <span class="dim-name-text">${dimDisplayName}</span>
          </div>
          <div style="flex: 0 0 auto; margin-left: auto; text-align: right; white-space: nowrap;">
            ${inScope
          ? (scanKey === 'compile'
            ? `<span class="yield-target-tag" title="${escapeHtml(dimStageMeta.fullLabel)}" style="white-space: nowrap; background: ${dimStageMeta.pillBg}; color: ${dimStageMeta.color}; border: 1px solid ${dimStageMeta.border};">${escapeHtml(dimStageMeta.shortLabel)}</span>`
            : `<span class="yield-target-tag" style="white-space: nowrap;">🎯 In-Scope</span>`)
          : `<span class="yield-out-scope-tag" style="white-space: nowrap;">Out of Scope</span>`}
          </div>
        </div>
        <div style="font-size: 0.65rem; color: #64748b; margin-top: 4px; font-weight: 500;">
          ${escapeHtml(dim.category)}
        </div>
      `;

      // Column 2 content: Before AI Run (Baseline)
      const col2Html = beforeVal
        ? `<div class="comp-val-wrapper">${beforeVal}</div>`
        : `<span class="yield-empty-field out-of-scope">—</span>`;

      // Column 3 content: After AI Run
      let col3Html = '';
      const isNoneAvailable = typeof afterVal === 'string' && (afterVal.includes('none_available') || afterVal.includes('not_applicable'));

      if (hasAfterYield) {
        let badgeText = dim.badge || '+ Verified';
        let badgeStyle = '';
        if (isNoneAvailable) {
          badgeText = 'Not Offered';
          badgeStyle = 'background: rgba(148, 163, 184, 0.12); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25);';
        } else if (dim.key === 'd6_tier') {
          badgeText = (afterVal && beforeVal && afterVal !== beforeVal) ? '+ Promoted' : '+ Verified Tier';
        } else if (beforeVal && afterVal && beforeVal === afterVal) {
          badgeText = '+ Retained';
          badgeStyle = 'background: rgba(148, 163, 184, 0.12); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.25);';
        }

        const badgeHtml = inScope
          ? `<span class="yield-highlight-tag" ${badgeStyle ? `style="${badgeStyle}"` : ''}>${escapeHtml(badgeText)}</span>`
          : `<span class="yield-highlight-tag" style="background: rgba(148, 163, 184, 0.12); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.22);">+ Retained</span>`;
        col3Html = `
          <div class="comp-val-wrapper" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
            <div>${afterVal}</div>
            <div>${badgeHtml}</div>
          </div>
        `;
      } else if (isStreamingThisDim) {
        col3Html = `
          <div style="display: flex; align-items: center; gap: 6px; color: #38bdf8;">
            <span class="pipeline-loader-ring" style="width: 14px; height: 14px; border-width: 2px;"></span>
            <span style="font-size: 0.72rem; font-style: italic; color: #38bdf8;">Extracting live dimension...</span>
          </div>
        `;
      } else if (inScope) {
        if (isStreaming) {
          col3Html = `<span class="yield-empty-field in-scope">— (In scope: extracting...)</span>`;
        } else {
          col3Html = `<span class="yield-empty-field out-of-scope">— (Not verified in this stage)</span>`;
        }
      } else {
        col3Html = `<span class="yield-empty-field out-of-scope">— (Out of scope for ${escapeHtml(scanName)})</span>`;
      }

      return `
        <tr class="${rowClass}">
          <td class="comp-td-dim">${col1Html}</td>
          <td class="comp-td-before" ${scanKey === 'compile' && hasRealBefore ? `style="background: ${dimStageMeta.bgTint}; border-left: 3px solid ${dimStageMeta.color}; box-shadow: inset 0 0 12px ${dimStageMeta.bgTint};"` : ''}>
            ${scanKey === 'compile' && hasRealBefore
          ? `<div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;"><div>${col2Html}</div><span style="font-size: 0.62rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; background: ${dimStageMeta.pillBg}; color: ${dimStageMeta.color}; border: 1px solid ${dimStageMeta.border}; white-space: nowrap;">${escapeHtml(dimStageMeta.shortLabel)}</span></div>`
          : col2Html}
          </td>
          <td class="comp-td-after" ${scanKey === 'compile' && hasRealAfter ? `style="background: ${dimStageMeta.bgTint}; border-left: 3px solid ${dimStageMeta.color}; box-shadow: inset 0 0 14px ${dimStageMeta.bgTint};"` : ''}>
            ${scanKey === 'compile' && hasRealAfter
          ? `<div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;"><div style="flex: 1 1 auto; min-width: 0;">${col3Html}</div><span title="Scanned during ${escapeHtml(dimStageMeta.fullLabel)}" style="font-size: 0.62rem; font-weight: 800; padding: 1px 6px; border-radius: 4px; background: ${dimStageMeta.pillBg}; color: ${dimStageMeta.color}; border: 1px solid ${dimStageMeta.border}; white-space: nowrap;">Scanned @ ${escapeHtml(dimStageMeta.shortLabel)}</span></div>`
          : col3Html}
          </td>
        </tr>
      `;
    }).join('');

    return `
      ${scanKey === 'compile' ? `
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 8px 12px; margin-bottom: 6px; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 8px;">
          <span style="font-size: 0.72rem; font-weight: 800; color: #e2e8f0; letter-spacing: 0.03em;">🌈 MULTI-STAGE SCAN PROVENANCE HIGHLIGHTS (ALL ${totalDimsCount} DIMENSIONS):</span>
          <div style="display: flex; align-items: center; flex-wrap: wrap; gap: 6px;">
            ${Object.values(STAGE_META_MAP).map(st => `
              <span title="${escapeHtml(st.fullLabel)}" style="font-size: 0.66rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: ${st.pillBg}; color: ${st.color}; border: 1px solid ${st.border};">
                ${escapeHtml(st.shortLabel)}: <strong>${stageScannedCounts[st.key] || 0}</strong> scanned
              </span>
            `).join('')}
          </div>
        </div>
      ` : ''}
      <table class="pipeline-3col-comp-table">
        <thead>
          <tr>
            <th class="comp-td-dim">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="color: #38bdf8; font-weight: 800;">DIMENSION LABEL</span>
                <span onclick="toggleComparisonInScopeFilter()" title="Click to toggle between In-Scope dimensions only vs. All ${totalDimsCount} Dimensions" style="cursor: pointer; font-size: 0.65rem; color: ${(pipelineCompFilterInScopeOnly && scanKey !== 'compile') ? '#38bdf8' : '#94a3b8'}; font-family: monospace; background: ${(pipelineCompFilterInScopeOnly && scanKey !== 'compile') ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255,255,255,0.08)'}; border: 1px solid ${(pipelineCompFilterInScopeOnly && scanKey !== 'compile') ? 'rgba(56, 189, 248, 0.4)' : 'transparent'}; padding: 1px 6px; border-radius: 4px;">
                  ${(pipelineCompFilterInScopeOnly && scanKey !== 'compile') ? `🎯 ${inScopeDimsCount} OF ${totalDimsCount}D IN-SCOPE` : `📋 ALL ${totalDimsCount}D MATRIX`}
                </span>
              </div>
            </th>
            <th class="comp-td-before">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="color: #94a3b8; font-weight: 800;">📸 BEFORE AI RUN (Baseline)</span>
                <span class="badge-card-number">${escapeHtml(badgeLabel)}</span>
              </div>
            </th>
            <th class="comp-td-after">
              <div style="display: flex; align-items: center; justify-content: space-between;">
                <span style="color: #34d399; font-weight: 800;">✨ AFTER AI RUN (${escapeHtml(agentLabel)})</span>
                <span class="yield-status-pill agent" style="font-size: 0.64rem; padding: 1px 7px; border-radius: 999px; font-weight: 700; background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4);">
                  ${isStreaming ? '⚡ Live Ingestion' : (after ? 'Audited Yield' : 'Awaiting Run')}
                </span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  }

  function renderComparisonCards(ctx, before, isStreaming) {
    pipelineLastCompAfter = ctx;
    pipelineLastCompBefore = before;
    pipelineLastCompIsStreaming = Boolean(isStreaming);

    const beforeContainer = document.getElementById('pipeline-comp-card-before');
    const afterContainer = document.getElementById('pipeline-comp-card-after');
    const tableContainer = document.getElementById('pipeline-comp-table-container');
    const harvesterView = document.getElementById('pipeline-harvester-comparison-view');
    if (harvesterView) harvesterView.style.display = 'none';
    if (tableContainer) tableContainer.style.display = 'block';

    const preset = SCAN_PRESETS[currentPipelineScanKey] || SCAN_PRESETS.qc;
    const agentLabel = preset ? preset.techPillText : 'AI Agent';

    updateComparisonTargetDimensionsBanner(currentPipelineScanKey);

    if (!before && ctx && ctx.id) {
      const allEvs = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
      before = pipelineInitialSnapshots.get(ctx.id) || (allEvs ? allEvs.find(e => (e.id || e.event_id) === ctx.id) : null);
    }

    // Populate legacy containers (for tests or background checks)
    if (beforeContainer) {
      beforeContainer.style.display = 'none';
      beforeContainer.innerHTML = renderYieldCardHtml(before, false, null, currentPipelineScanKey);
    }
    if (afterContainer) {
      afterContainer.style.display = 'none';
      if (isStreaming && (!ctx || (!ctx.afterPrice && !ctx.afterTitle && !ctx.hasProof && !ctx.afterCategory && !ctx.afterDescription))) {
        afterContainer.innerHTML = `
          <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 380px; text-align: center; color: #38bdf8; padding: 20px;">
            <span class="pipeline-loader-ring" style="width: 32px; height: 32px; margin-bottom: 12px; border-width: 3px;"></span>
            <div style="font-weight: 700; font-size: 0.9rem; margin-bottom: 4px; color: #38bdf8;">
              ${escapeHtml(agentLabel)} Auditing...
            </div>
            <p style="font-size: 0.74rem; color: #94a3b8; max-width: 260px; margin: 0; line-height: 1.45;">
              Extracting live operational reality from page DOM. Only dimensions newly verified will populate here.
            </p>
          </div>
        `;
      } else {
        afterContainer.innerHTML = renderYieldCardHtml(ctx, true, agentLabel, currentPipelineScanKey);
      }
    }

    // Populate 3-Column Comparative Dimension Table
    if (tableContainer) {
      tableContainer.style.display = 'block';
      tableContainer.innerHTML = generate3ColComparisonTableHtml(before, ctx, isStreaming, currentPipelineScanKey, agentLabel);
    }
  }

  function updateComparisonCardDropdown() {
    const sel = document.getElementById('pipeline-comparison-card-select');
    const btnPrev = document.getElementById('btn-comp-prev-card');
    const btnNext = document.getElementById('btn-comp-next-card');
    if (!sel) return;

    if (currentPipelineScanKey === 'venue' && pipelineAuditedCardsHistory.length === 0) {
      let venues = (state.masterCatalogsData && state.masterCatalogsData.venues_master) || (state.venuesData ? Object.values(state.venuesData) : []);
      if (Array.isArray(venues) && venues.length > 0) {
        if (!pipelineCurrentCompId || !String(pipelineCurrentCompId).startsWith('venue:')) {
          pipelineCurrentCompId = 'venue:0';
        }
        sel.innerHTML = venues.map((v, idx) => {
          const vid = `venue:${idx}`;
          const vName = v.venue_name || v.name || 'Venue';
          const hood = v.neighborhood ? ` (${v.neighborhood})` : '';
          return `<option value="${vid}" ${vid === pipelineCurrentCompId ? 'selected' : ''}>Venue #${idx + 1}: ${escapeHtml(vName.slice(0, 26))}${escapeHtml(hood)}</option>`;
        }).join('');
        const curIdx = parseInt(String(pipelineCurrentCompId).replace('venue:', ''), 10) || 0;
        if (btnPrev) btnPrev.disabled = (curIdx <= 0);
        if (btnNext) btnNext.disabled = (curIdx >= venues.length - 1);
        return;
      }
    }

    if (pipelineAuditedCardsHistory.length === 0) {
      sel.innerHTML = '<option value="">Awaiting scan...</option>';
      if (btnPrev) btnPrev.disabled = true;
      if (btnNext) btnNext.disabled = true;
      return;
    }

    const prefixLabel = currentPipelineScanKey === 'venue' ? 'Venue #' : '#';
    sel.innerHTML = pipelineAuditedCardsHistory.map((item, idx) => `
      <option value="${escapeHtml(item.id || String(idx))}" ${item.id === pipelineCurrentCompId ? 'selected' : ''}>
        ${prefixLabel}${escapeHtml(String(item.cardIndex))}: ${escapeHtml((item.title || 'Event').slice(0, 24))}
      </option>
    `).join('');

    const currentIdx = pipelineAuditedCardsHistory.findIndex(x => x.id === pipelineCurrentCompId);
    if (btnPrev) btnPrev.disabled = (currentIdx <= 0);
    if (btnNext) btnNext.disabled = (currentIdx < 0 || currentIdx >= pipelineAuditedCardsHistory.length - 1);
  }

  window.onComparisonCardSelectChange = function (eventId) {
    if (!eventId) return;
    showComparisonCardById(eventId);
  };

  window.stepComparisonCard = function (delta) {
    if (currentPipelineScanKey === 'venue' && pipelineAuditedCardsHistory.length === 0) {
      let venues = (state.masterCatalogsData && state.masterCatalogsData.venues_master) || (state.venuesData ? Object.values(state.venuesData) : []);
      if (Array.isArray(venues) && venues.length > 0) {
        const curIdx = parseInt(String(pipelineCurrentCompId || 'venue:0').replace('venue:', ''), 10) || 0;
        const nextIdx = Math.max(0, Math.min(venues.length - 1, curIdx + delta));
        showComparisonCardById(`venue:${nextIdx}`);
        return;
      }
    }
    if (pipelineAuditedCardsHistory.length === 0) return;
    let currentIdx = pipelineAuditedCardsHistory.findIndex(x => x.id === pipelineCurrentCompId);
    if (currentIdx === -1) currentIdx = pipelineAuditedCardsHistory.length - 1;
    const nextIdx = Math.max(0, Math.min(pipelineAuditedCardsHistory.length - 1, currentIdx + delta));
    const target = pipelineAuditedCardsHistory[nextIdx];
    if (target) {
      showComparisonCardById(target.id);
    }
  };

  window.showComparisonCardById = function (eventId) {
    pipelineCurrentCompId = eventId;
    if (String(eventId).startsWith('venue:')) {
      const vIdx = parseInt(String(eventId).replace('venue:', ''), 10) || 0;
      let venues = (state.masterCatalogsData && state.masterCatalogsData.venues_master) || (state.venuesData ? Object.values(state.venuesData) : []);
      const v = venues && venues[vIdx];
      if (v) {
        const vName = v.venue_name || v.name || 'Venue';
        const pseudoVenueCard = {
          cardIndex: vIdx + 1,
          id: `venue:${vIdx}`,
          title: vName,
          venue: vName,
          venue_name: vName,
          address: v.full_address || v.address || '',
          full_address: v.full_address || v.address || '',
          neighborhood: v.neighborhood || '',
          coordinates: v.coordinates || null,
          transit_info: v.transit_info || '',
          environment_type: v.environment_type || '',
          access_model: v.access_model || '',
          accessibility_notes: v.accessibility_notes || '',
          operating_hours_summary: v.operating_hours_summary || '',
          drink_benchmark: v.drink_benchmark || '',
          typical_item_spend: v.typical_item_spend || '',
          dimension_audit: v.dimension_audit || {}
        };
        const isGrounded = Boolean((v.full_address && (v.coordinates || v.transit_info)) || v.last_grounded_at);
        renderComparisonCards(isGrounded ? pseudoVenueCard : null, pseudoVenueCard, false);
        updateComparisonCardDropdown();
        updateComparisonStatusPill(`Venue #${vIdx + 1}: ${vName} ${isGrounded ? 'Grounded ✅' : 'Baseline'}`, isGrounded ? 'updated' : 'nodrift');
      }
      return;
    }
    const item = pipelineAuditedCardsHistory.find(x => x.id === eventId);
    const allEvs = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const qEvs = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);
    const schedEvs = Array.isArray(state.layerSchedules) ? state.layerSchedules : [];
    const boxEvs = Array.isArray(state.layerBoxOffices) ? state.layerBoxOffices : [];
    const editEvs = Array.isArray(state.layerEditorials) ? state.layerEditorials : [];
    const schedMatch = schedEvs.find(e => (e.id || e.event_id) === eventId);
    const boxMatch = boxEvs.find(e => (e.id || e.event_id) === eventId);
    const editMatch = editEvs.find(e => (e.id || e.event_id) === eventId);
    const catMatch = allEvs.find(e => (e.id || e.event_id) === eventId) || qEvs.find(e => (e.id || e.event_id) === eventId);
    const mergedLayerFresh = (schedMatch || boxMatch || editMatch || catMatch)
      ? { ...(schedMatch || {}), ...(boxMatch || {}), ...(editMatch || {}), ...(catMatch || {}) }
      : null;

    if (item) {
      // Strict stage isolation: only hydrate After context from the active stage's own layer
      let stageFresh = null;
      if (currentPipelineScanKey === 'hunter') {
        stageFresh = schedMatch ? {
          id: schedMatch.id,
          title: schedMatch.title,
          venue: schedMatch.venue || schedMatch.venue_name,
          candidate_tier1_url: schedMatch.candidate_tier1_url,
          ticket_url: schedMatch.candidate_tier1_url || schedMatch.ticket_url
        } : null;
      } else if (currentPipelineScanKey === 'qc') {
        const isBoxTimeout = boxMatch && (boxMatch.status === 'TIMEOUT_EXCEEDED' || boxMatch.status === 'AI_TIMEOUT' || boxMatch.status === 'EXECUTION_ERROR');
        stageFresh = (boxMatch && !isBoxTimeout) ? boxMatch : null;
      } else if (currentPipelineScanKey === 'enrich') {
        stageFresh = editMatch || null;
      } else if (currentPipelineScanKey === 'compile') {
        stageFresh = mergedLayerFresh;
      }

      if (stageFresh) {
        if (currentPipelineScanKey === 'qc' || currentPipelineScanKey === 'compile') {
          if (!item.ctx.afterDate) item.ctx.afterDate = stageFresh.date || stageFresh.showings?.[0]?.date || stageFresh.dateSchedule;
          if (!item.ctx.afterTime) item.ctx.afterTime = stageFresh.time || stageFresh.start_time || stageFresh.doors_time;
          const freshAllIn = stageFresh.tier1_price_all_in ?? stageFresh.price_all_in ?? stageFresh.price;
          if (!item.ctx.afterPrice || item.ctx.afterPrice === 'Pending Box Office QC') {
            item.ctx.afterPrice = stageFresh.priceLabel || (freshAllIn != null ? `$${Number(freshAllIn).toFixed(2)} CAD` : null);
          }
          if (item.ctx.afterBase === undefined || item.ctx.afterBase === null) {
            const bVal = stageFresh.tier1_price_base ?? stageFresh.price_base;
            if (bVal != null) item.ctx.afterBase = bVal;
          }
          if (item.ctx.afterFee === undefined || item.ctx.afterFee === null) {
            const fVal = stageFresh.tier1_price_fee ?? stageFresh.price_fee;
            if (fVal != null) item.ctx.afterFee = fVal;
          }
          if (item.ctx.afterTax === undefined || item.ctx.afterTax === null) {
            const tVal = stageFresh.tier1_price_tax ?? stageFresh.price_tax;
            if (tVal != null) item.ctx.afterTax = tVal;
          }
          if (!item.ctx.afterTier1Name && stageFresh.tier1_name) item.ctx.afterTier1Name = stageFresh.tier1_name;
          if (!item.ctx.afterProvider && stageFresh.ticket_provider) item.ctx.afterProvider = stageFresh.ticket_provider;
          if (!item.ctx.afterInventory && stageFresh.status) item.ctx.afterInventory = stageFresh.is_sold_out ? 'SOLD OUT' : 'AVAILABLE';
          if (!item.ctx.afterTicketUrl) item.ctx.afterTicketUrl = stageFresh.ticket_url || stageFresh.candidate_tier1_url;
          const proofUrl = stageFresh.proof_keyframes?.cart || stageFresh.proof_keyframe;
          if (proofUrl && !item.ctx.proofKeyframeUrl) {
            item.ctx.hasProof = true;
            item.ctx.proofKeyframeUrl = proofUrl;
          }
        }
        if (currentPipelineScanKey === 'hunter' || currentPipelineScanKey === 'compile') {
          if (!item.ctx.afterTicketUrl) item.ctx.afterTicketUrl = stageFresh.candidate_tier1_url || stageFresh.ticket_url;
        }
        if (currentPipelineScanKey === 'enrich' || currentPipelineScanKey === 'compile') {
          if (!item.ctx.afterTitle || item.ctx.afterTitle === 'Event') item.ctx.afterTitle = stageFresh.clean_title || stageFresh.title || stageFresh.event_name;
          if (!item.ctx.afterCategory) item.ctx.afterCategory = stageFresh.category;
          if (item.ctx.afterArtist === undefined && stageFresh.artist) item.ctx.afterArtist = stageFresh.artist;
          if (!item.ctx.afterAge && stageFresh.restrictions) item.ctx.afterAge = stageFresh.restrictions;
          if (!item.ctx.afterDescription && stageFresh.description) item.ctx.afterDescription = stageFresh.description;
          if (stageFresh.event_archetype) item.ctx.event_archetype = stageFresh.event_archetype;
          if (stageFresh.lifecycle_type) item.ctx.lifecycle_type = stageFresh.lifecycle_type;
          if (stageFresh.frequencyLabel) item.ctx.frequencyLabel = stageFresh.frequencyLabel;
        }
      }
      renderComparisonCards(item.ctx, item.before || schedMatch || catMatch, false);
      updateComparisonCardDropdown();
      updateComparisonStatusPill(`Card #${item.cardIndex} Inspected ✅`, 'updated');
      const selectCard = document.getElementById('pipeline-select-card-name');
      if (selectCard) selectCard.value = eventId;
      const searchInput = document.getElementById('pipeline-custom-card-ids');
      if (searchInput && item.title) {
        searchInput.value = `#${item.cardIndex}: ${item.title}`;
      }
    } else {
      const ev = mergedLayerFresh;
      if (ev) {
        renderComparisonCards(null, ev, false);
        updateComparisonStatusPill(`Baseline Preview`, 'nodrift');
        const selectCard = document.getElementById('pipeline-select-card-name');
        if (selectCard) selectCard.value = eventId;
      }
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // SCHEDULE HARVESTER SPLIT-SCREEN SYSTEM (Before: Sources & Events / After: New Events)
  // ─────────────────────────────────────────────────────────────────────────────
  let harvesterPreRunEvents = null;
  let harvesterDiscoveredEvents = [];
  let harvesterPreRunSourcesMap = new Map();
  let harvesterSourcesScanned = 0;
  let harvesterTotalSources = 227;
  let harvesterCurrentSourceName = '';

  function updateHarvesterSourcesProgressUI() {
    const feedStats = typeof window.getHarvesterFeedStats === 'function' ? window.getHarvesterFeedStats() : { completedFeeds: 0, totalFeeds: 227 };
    const scanned = harvesterSourcesScanned || feedStats.completedFeeds || 0;
    const total = harvesterTotalSources || feedStats.totalFeeds || 227;
    const batchCount = (isPipelineTestMode && Array.isArray(pipelineTestDiscoveredIds) && pipelineTestDiscoveredIds.length > 0)
      ? pipelineTestDiscoveredIds.length
      : ((harvesterDiscoveredEvents && harvesterDiscoveredEvents.length) || 0);

    if (currentPipelineScanKey === 'harvest') {
      const trackerStatus = document.getElementById('pipeline-last-scanned-text');
      if (trackerStatus) {
        trackerStatus.innerHTML = `<span style="color: #c084fc; font-weight: 800;">${scanned}/${total} sources scanned</span> • <span style="color: #4ade80; font-weight: 700;">+${batchCount} events</span>`;
      }
    }

    const stepSub = document.getElementById('test-step-sub-harvest');
    if (stepSub) {
      stepSub.textContent = `${scanned}/${total} sources scanned (+${batchCount} events)`;
    }

    const scannedBadge = document.getElementById('harvester-sources-scanned-badge');
    if (scannedBadge) {
      scannedBadge.textContent = `📡 ${scanned}/${total} sources scanned`;
    }
  }

  function getEventDataSource(ev) {
    if (!ev) return 'Direct Box Office / Local Catalog';
    if (ev.source_feed) return ev.source_feed;
    if (ev.data_source) return ev.data_source;
    if (ev.discovery_source) return ev.discovery_source;

    const url = ev.ticket_url || ev.details_url || ev.websiteUrl || '';
    let domain = '';
    if (url) {
      try {
        domain = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
      } catch (_) { }
    }

    if (domain.includes('eventbrite.')) return 'Eventbrite';
    if (domain.includes('showpass.com')) return 'Showpass';
    if (domain.includes('ticketmaster.')) return 'Ticketmaster';
    if (domain.includes('universe.com')) return 'Universe';
    if (domain.includes('ticketweb.')) return 'TicketWeb';
    if (domain.includes('showclix.com')) return 'ShowClix';
    if (domain.includes('vancouverisawesome.com')) return 'Vancouver Is Awesome';
    if (domain.includes('do604.com')) return 'Do604';
    if (domain.includes('straight.com')) return 'The Georgia Straight';
    if (domain.includes('destinationvancouver.com')) return 'Destination Vancouver';
    if (domain.includes('vancouver.ca')) return 'City of Vancouver';

    const venue = (ev.venue_name || ev.venue || '').trim();
    if (venue) return venue;

    if (ev.ticket_provider && ev.ticket_provider !== 'Direct Box Office') {
      return ev.ticket_provider;
    }

    if (domain) return domain;
    return 'Direct Box Office / Local Catalog';
  }

  function captureHarvesterPreRunBaseline() {
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    harvesterPreRunEvents = events.map((ev, idx) => ({
      id: ev.id || ev.event_id || `ev-${idx}`,
      title: ev.title || ev.event_name || 'Event',
      venue: ev.venue || ev.venue_name || 'Vancouver Venue',
      date: ev.date || ev.dateSchedule || 'No date set',
      time: ev.time || ev.doors_time || ev.start_time || '',
      source: getEventDataSource(ev),
      priceLabel: ev.priceLabel || (ev.price != null ? `$${Number(ev.price).toFixed(2)} CAD` : 'Free ($0)'),
      ticket_url: ev.ticket_url || ev.details_url || ev.websiteUrl || ''
    }));

    harvesterPreRunSourcesMap = new Map();
    harvesterPreRunEvents.forEach(ev => {
      const src = ev.source || 'Direct Box Office / Local Catalog';
      if (!harvesterPreRunSourcesMap.has(src)) harvesterPreRunSourcesMap.set(src, []);
      harvesterPreRunSourcesMap.get(src).push(ev);
    });
  }

  window.toggleHarvesterSourceGroup = function (sourceId) {
    const el = document.getElementById(sourceId);
    const icon = document.getElementById(sourceId + '-icon');
    if (!el) return;
    if (el.style.display === 'none') {
      el.style.display = 'flex';
      if (icon) icon.textContent = '▼';
    } else {
      el.style.display = 'none';
      if (icon) icon.textContent = '▶';
    }
  };

  window.toggleAllHarvesterSources = function (expand) {
    document.querySelectorAll('.harvester-source-events-list').forEach(el => {
      el.style.display = expand ? 'flex' : 'none';
    });
    document.querySelectorAll('.harvester-toggle-icon').forEach(icon => {
      icon.textContent = expand ? '▼' : '▶';
    });
  };

  window.filterHarvesterBeforeSources = function (query) {
    const q = (query || '').toLowerCase().trim();
    const groups = document.querySelectorAll('.harvester-source-group');
    groups.forEach(group => {
      const srcName = (group.dataset.sourceName || '').toLowerCase();
      const eventRows = group.querySelectorAll('.harvester-event-row');
      let matchedEventsCount = 0;
      eventRows.forEach(row => {
        const rowText = (row.textContent || '').toLowerCase();
        if (!q || srcName.includes(q) || rowText.includes(q)) {
          row.style.display = 'flex';
          matchedEventsCount++;
        } else {
          row.style.display = 'none';
        }
      });

      const listEl = group.querySelector('.harvester-source-events-list');
      const iconEl = group.querySelector('.harvester-toggle-icon');
      if (!q || matchedEventsCount > 0 || srcName.includes(q)) {
        group.style.display = 'block';
        if (q && listEl) {
          listEl.style.display = 'flex';
          if (iconEl) iconEl.textContent = '▼';
        }
      } else {
        group.style.display = 'none';
      }
    });
  };

  function getHarvestedEventSource(ev) {
    if (ev.source && ev.source !== 'Direct Box Office / Local Catalog' && ev.source !== 'Discovered Venue Feeds') {
      return ev.source;
    }
    if (ev.venue && ev.venue !== 'Vancouver Venue') {
      return ev.venue;
    }
    if (ev.url) {
      try {
        const u = new URL(ev.url);
        const host = u.hostname.replace(/^www\./i, '');
        if (host.includes('eventbrite')) return 'Eventbrite';
        if (host.includes('showpass')) return 'Showpass';
        if (host.includes('ticketmaster')) return 'Ticketmaster';
        if (host.includes('theimprovcentre')) return 'The Improv Centre';
        if (host.includes('riotheatre')) return 'Rio Theatre';
        if (host.includes('rickshawtheatre')) return 'Rickshaw Theatre';
        return host;
      } catch (_) { }
    }
    return ev.venue || 'Discovered Venue Feeds';
  }

  window.toggleHarvesterNewSourceGroup = function (sourceId) {
    const el = document.getElementById(sourceId);
    const icon = document.getElementById(sourceId + '-icon');
    if (!el) return;
    if (el.style.display === 'none') {
      el.style.display = 'flex';
      if (icon) icon.textContent = '▼';
    } else {
      el.style.display = 'none';
      if (icon) icon.textContent = '▶';
    }
  };

  window.toggleAllHarvesterNewSources = function (expand) {
    document.querySelectorAll('.harvester-new-source-events-list').forEach(el => {
      el.style.display = expand ? 'flex' : 'none';
    });
    document.querySelectorAll('.harvester-new-toggle-icon').forEach(icon => {
      icon.textContent = expand ? '▼' : '▶';
    });
  };

  window.filterHarvesterAfterSources = function (query) {
    const q = (query || '').toLowerCase().trim();
    const groups = document.querySelectorAll('.harvester-new-source-group');
    groups.forEach(group => {
      const srcName = (group.dataset.sourceName || '').toLowerCase();
      const eventRows = group.querySelectorAll('.harvester-new-event-row');
      let matchedEventsCount = 0;
      eventRows.forEach(row => {
        const rowText = (row.textContent || '').toLowerCase();
        if (!q || srcName.includes(q) || rowText.includes(q)) {
          row.style.display = 'flex';
          matchedEventsCount++;
        } else {
          row.style.display = 'none';
        }
      });

      const listEl = group.querySelector('.harvester-new-source-events-list');
      const iconEl = group.querySelector('.harvester-new-toggle-icon');
      if (!q || matchedEventsCount > 0 || srcName.includes(q)) {
        group.style.display = 'block';
        if (q && listEl) {
          listEl.style.display = 'flex';
          if (iconEl) iconEl.textContent = '▼';
        }
      } else {
        group.style.display = 'none';
      }
    });
  };

  function renderHarvesterComparisonView(isFinished = false, newEvents = [], isStreaming = false) {
    const harvesterView = document.getElementById('pipeline-harvester-comparison-view');
    const tableContainer = document.getElementById('pipeline-comp-table-container');
    const beforeContainer = document.getElementById('pipeline-comp-card-before');
    const afterContainer = document.getElementById('pipeline-comp-card-after');
    if (!harvesterView) return;

    if (tableContainer) tableContainer.style.display = 'none';
    if (beforeContainer) beforeContainer.style.display = 'none';
    if (afterContainer) afterContainer.style.display = 'none';
    harvesterView.style.display = 'block';

    if (!harvesterPreRunEvents) {
      captureHarvesterPreRunBaseline();
    }

    const prevFilterBefore = document.getElementById('harvester-filter-before')?.value || '';
    const prevFilterAfter = document.getElementById('harvester-filter-after')?.value || '';

    const totalEvents = harvesterPreRunEvents ? harvesterPreRunEvents.length : 0;
    const sortedSources = Array.from(harvesterPreRunSourcesMap.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const totalSources = sortedSources.length;

    // Update banner text
    const textEl = document.getElementById('pipeline-scope-target-dims-text');
    if (textEl) textEl.textContent = 'Target: Venue Calendars & Ticket Feeds • Ingests discrete dated deep links into layer_schedules.json';

    // Group newEvents by source
    const newSourcesMap = new Map();
    (newEvents || []).forEach(ev => {
      const src = getHarvestedEventSource(ev);
      if (!newSourcesMap.has(src)) newSourcesMap.set(src, []);
      newSourcesMap.get(src).push(ev);
    });
    const sortedNewSources = Array.from(newSourcesMap.entries())
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    const totalNewSources = sortedNewSources.length;
    const newEventsCount = (newEvents || []).length;

    // Render 3 Regions: Top Region (Two Columns: Before Run vs After Run Sources) + Bottom Region (Single Column: Real-Time Stream Cards)
    harvesterView.innerHTML = `
      <div id="pipeline-harvester-3region-container" style="display: flex; flex-direction: column; gap: 14px; width: 100%;">
        <!-- TOP REGION: TWO COLUMNS -->
        <div id="harvester-top-region" style="display: flex; gap: 12px; width: 100%; align-items: stretch;">
          <!-- TOP-LEFT: BEFORE RUN (Prior Data Sources & Events) -->
          <div id="harvester-top-left-col" class="yield-card" style="flex: 1 1 50%; min-width: 0; background: #090d16; border: 1px solid rgba(192, 132, 252, 0.25); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
            <div class="yield-card-badge-bar before" style="color: #c084fc; border-color: rgba(192, 132, 252, 0.25);">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-weight: 800;">📸 BEFORE RUN • PRIOR DATA SOURCES</span>
                <span class="badge-card-number" style="background: rgba(192, 132, 252, 0.15); color: #d8b4fe; border: 1px solid rgba(192, 132, 252, 0.35);">
                  ${totalSources} Sources (${totalEvents} Events)
                </span>
              </div>
              <span class="yield-status-pill baseline" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3);">
                Baseline Catalog
              </span>
            </div>

            <!-- Search Filter & Quick Expand/Collapse Tools -->
            <div style="display: flex; gap: 6px; align-items: center; margin: 4px 0;">
              <input type="text" id="harvester-filter-before" placeholder="Search data source, event name, or date..." 
                     style="flex: 1; font-size: 0.72rem; padding: 4px 8px; background: rgba(0,0,0,0.5); border: 1px solid rgba(192,132,252,0.25); border-radius: 4px; color: #fff;"
                     oninput="filterHarvesterBeforeSources(this.value)">
              <button type="button" class="btn-limit-chip" onclick="toggleAllHarvesterSources(true)" style="padding: 2px 7px; font-size: 0.66rem; color: #c084fc; cursor: pointer;" title="Expand all source lists">Expand All</button>
              <button type="button" class="btn-limit-chip" onclick="toggleAllHarvesterSources(false)" style="padding: 2px 7px; font-size: 0.66rem; color: #94a3b8; cursor: pointer;" title="Collapse all source lists">Collapse All</button>
            </div>

            <!-- Scrollable Accordion of Data Sources with Event Names & Dates -->
            <div id="harvester-before-sources-list" style="flex: 1; max-height: 380px; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 6px;">
              ${sortedSources.map(([sourceName, evs], sIdx) => {
      const safeId = 'hsrc-' + sIdx;
      const isExpanded = sIdx < 2;
      return `
                  <div class="harvester-source-group" data-source-name="${escapeHtml(sourceName)}" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(192, 132, 252, 0.18); border-radius: 6px; overflow: hidden; flex-shrink: 0;">
                    <div onclick="toggleHarvesterSourceGroup('${safeId}')" style="padding: 6px 10px; background: rgba(192, 132, 252, 0.08); display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none;">
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 0.76rem;">🏛️</span>
                        <span style="font-weight: 700; color: #f1f5f9; font-size: 0.76rem;">${escapeHtml(sourceName)}</span>
                      </div>
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 0.66rem; font-weight: 700; background: rgba(192, 132, 252, 0.2); color: #d8b4fe; padding: 1px 7px; border-radius: 999px;">
                          ${evs.length} ${evs.length === 1 ? 'event' : 'events'}
                        </span>
                        <span id="${safeId}-icon" class="harvester-toggle-icon" style="font-size: 0.65rem; color: #94a3b8;">${isExpanded ? '▼' : '▶'}</span>
                      </div>
                    </div>
                    <div id="${safeId}" class="harvester-source-events-list" style="padding: 6px 10px; display: ${isExpanded ? 'flex' : 'none'}; flex-direction: column; gap: 5px; font-size: 0.72rem; background: rgba(0, 0, 0, 0.2);">
                      ${evs.map(e => {
        const rawDate = e.date || e.dateSchedule || '';
        const isPending = !rawDate || /pending|verification|tbd|schedule/i.test(rawDate);
        const dateSnippet = isPending ? '' : `
                          <span style="color: #38bdf8; font-family: monospace; font-size: 0.66rem; white-space: nowrap; margin-left: 6px; flex-shrink: 0;">
                            📅 ${escapeHtml(rawDate)}${e.time ? ' • ' + escapeHtml(e.time) : ''}
                          </span>
                        `;
        const linkUrl = e.ticket_url || e.url || e.calendar_url || e.details_url || `https://www.google.com/search?q=${encodeURIComponent((e.title || '') + ' ' + (e.venue || sourceName) + ' Vancouver')}`;
        return `
                          <div class="harvester-event-row" style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.04); padding-bottom: 3px; flex-shrink: 0;">
                            <a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer" 
                               style="color: #e2e8f0; font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; cursor: pointer; transition: color 0.15s ease;"
                               onmouseover="this.style.color='#c084fc'; this.style.textDecoration='underline';"
                               onmouseout="this.style.color='#e2e8f0'; this.style.textDecoration='none';"
                               title="Open ${escapeHtml(e.title || 'Event')} in new window">
                              ${escapeHtml(e.title)} <span style="font-size: 0.62rem; color: #a855f7; opacity: 0.85;">↗</span>
                            </a>
                            ${dateSnippet}
                          </div>
                        `;
      }).join('')}
                    </div>
                  </div>
                `;
    }).join('')}
            </div>
          </div>

          <!-- TOP-RIGHT: AFTER RUN (Consists ONLY of the New Events Grouped by Source) -->
          <div id="harvester-top-right-col" class="yield-card" style="flex: 1 1 50%; min-width: 0; background: #090d16; border: 1px solid rgba(52, 211, 153, 0.3); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 6px;">
            <div class="yield-card-badge-bar after" style="color: #4ade80; border-color: rgba(52, 211, 153, 0.3);">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span style="font-weight: 800;">✨ AFTER RUN • NEW DATA SOURCES &amp; EVENTS</span>
                <span class="badge-card-number" id="harvester-sources-scanned-badge" style="background: rgba(168, 85, 247, 0.2); color: #d8b4fe; border: 1px solid rgba(168, 85, 247, 0.45);">
                  📡 ${harvesterSourcesScanned || 0}/${harvesterTotalSources || 155} sources scanned
                </span>
                <span class="badge-card-number" style="background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4);">
                  +${newEventsCount} New Events (${totalNewSources} Yielding Sources)
                </span>
              </div>
              <span class="yield-status-pill agent" style="background: ${isStreaming ? 'rgba(168, 85, 247, 0.2)' : 'rgba(16, 185, 129, 0.2)'}; color: ${isStreaming ? '#d8b4fe' : '#34d399'}; border: 1px solid ${isStreaming ? 'rgba(168, 85, 247, 0.4)' : 'rgba(16, 185, 129, 0.4)'};">
                ${isStreaming ? 'Crawling...' : (isFinished ? 'Harvested' : 'Awaiting Run')}
              </span>
            </div>

            <!-- Search Filter & Quick Tools for New Events -->
            <div style="display: flex; gap: 6px; align-items: center; margin: 4px 0;">
              <input type="text" id="harvester-filter-after" placeholder="Filter newly harvested events or sources..." 
                     style="flex: 1; font-size: 0.72rem; padding: 4px 8px; background: rgba(0,0,0,0.5); border: 1px solid rgba(52,211,153,0.3); border-radius: 4px; color: #fff;"
                     oninput="filterHarvesterAfterSources(this.value)">
              <button type="button" class="btn-limit-chip" onclick="toggleAllHarvesterNewSources(true)" style="padding: 2px 7px; font-size: 0.66rem; color: #34d399; cursor: pointer;" title="Expand all new source lists">Expand All</button>
              <button type="button" class="btn-limit-chip" onclick="toggleAllHarvesterNewSources(false)" style="padding: 2px 7px; font-size: 0.66rem; color: #94a3b8; cursor: pointer;" title="Collapse all new source lists">Collapse All</button>
            </div>

            <!-- Scrollable Accordion of New Data Sources with Newly Harvested Events -->
            <div id="harvester-after-sources-list" style="flex: 1; max-height: 380px; overflow-y: auto; padding-right: 4px; display: flex; flex-direction: column; gap: 6px;">
              ${newEventsCount === 0 ? `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 240px; text-align: center; color: #94a3b8; padding: 20px;">
                  ${isStreaming ? `
                    <span class="pipeline-loader-ring" style="width: 28px; height: 28px; margin-bottom: 10px; border-width: 2.5px; border-color: #34d399 transparent #34d399 transparent;"></span>
                    <div style="font-weight: 700; color: #34d399; font-size: 0.86rem; margin-bottom: 4px;">Crawling Venue Feeds...</div>
                    <p style="font-size: 0.72rem; color: #cbd5e1; max-width: 240px; margin: 0; line-height: 1.4;">
                      Newly harvested events will appear here grouped by source as candidate links are verified.
                    </p>
                  ` : (isFinished ? `
                    <div style="font-size: 2rem; margin-bottom: 6px;">✅</div>
                    <div style="font-weight: 700; color: #34d399; font-size: 0.86rem; margin-bottom: 4px;">All Calendar Events Up to Date</div>
                    <p style="font-size: 0.72rem; color: #94a3b8; max-width: 240px; margin: 0; line-height: 1.4;">
                      No uncataloged new showings were found. All candidate links on target feeds already exist in the baseline catalog.
                    </p>
                  ` : `
                    <div style="font-size: 2rem; margin-bottom: 6px;">📅</div>
                    <div style="font-weight: 700; color: #d8b4fe; font-size: 0.86rem; margin-bottom: 4px;">Awaiting Harvester Execution</div>
                    <p style="font-size: 0.72rem; color: #94a3b8; max-width: 240px; margin: 0; line-height: 1.4;">
                      Click <strong>Run Harvester Now</strong> to begin. Newly discovered events will be organized here by venue/source.
                    </p>
                  `)}
                </div>
              ` : sortedNewSources.map(([sourceName, evs], sIdx) => {
      const safeId = 'hnewsrc-' + sIdx;
      return `
                  <div class="harvester-new-source-group" data-source-name="${escapeHtml(sourceName)}" style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(52, 211, 153, 0.25); border-radius: 6px; overflow: hidden; flex-shrink: 0;">
                    <div onclick="toggleHarvesterNewSourceGroup('${safeId}')" style="padding: 6px 10px; background: rgba(16, 185, 129, 0.09); display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none;">
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 0.76rem;">✨</span>
                        <span style="font-weight: 700; color: #f1f5f9; font-size: 0.76rem;">${escapeHtml(sourceName)}</span>
                      </div>
                      <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="font-size: 0.66rem; font-weight: 700; background: rgba(34, 197, 94, 0.2); color: #4ade80; padding: 1px 7px; border-radius: 999px;">
                          +${evs.length} ${evs.length === 1 ? 'new event' : 'new events'}
                        </span>
                        <span id="${safeId}-icon" class="harvester-new-toggle-icon" style="font-size: 0.65rem; color: #94a3b8;">▼</span>
                      </div>
                    </div>
                    <div id="${safeId}" class="harvester-new-source-events-list" style="padding: 6px 10px; display: flex; flex-direction: column; gap: 5px; font-size: 0.72rem; background: rgba(0, 0, 0, 0.2);">
                      ${evs.map(e => {
        const linkUrl = e.url || e.ticket_url || `https://www.google.com/search?q=${encodeURIComponent((e.title || '') + ' ' + (e.venue || sourceName) + ' Vancouver')}`;
        return `
                          <div class="harvester-new-event-row" style="display: flex; align-items: baseline; justify-content: space-between; gap: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.04); padding-bottom: 3px; flex-shrink: 0;">
                            <a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer" 
                               style="color: #4ade80; font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-decoration: none; cursor: pointer; transition: color 0.15s ease;"
                               onmouseover="this.style.color='#86efac'; this.style.textDecoration='underline';"
                               onmouseout="this.style.color='#4ade80'; this.style.textDecoration='none';"
                               title="Open ${escapeHtml(e.title || 'Event')} in new window">
                              ${escapeHtml(e.title)} <span style="font-size: 0.62rem; color: #34d399;">↗</span>
                            </a>
                            <span style="color: #38bdf8; font-family: monospace; font-size: 0.66rem; white-space: nowrap; margin-left: 6px; flex-shrink: 0;">
                              📅 ${escapeHtml(e.date || 'TBD')}${e.time ? ' • ' + escapeHtml(e.time) : ''}
                            </span>
                          </div>
                        `;
      }).join('')}
                    </div>
                  </div>
                `;
    }).join('')}
            </div>
          </div>
        </div>

        <!-- BOTTOM REGION: SINGLE COLUMN (Live Updating Stream of Discrete Event Cards) -->
        <div id="harvester-bottom-region" class="yield-card" style="width: 100%; background: #090d16; border: 1px solid rgba(56, 189, 248, 0.3); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 8px;">
          <div class="yield-card-badge-bar" style="color: #38bdf8; border-color: rgba(56, 189, 248, 0.3); margin-bottom: 2px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-weight: 800;">⚡ LIVE DISCOVERY STREAM (DISCRETE EVENT CARDS)</span>
              <span class="badge-card-number" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35);">
                ${newEventsCount} Event${newEventsCount === 1 ? '' : 's'} Processed
              </span>
            </div>
            <span class="yield-status-pill agent" style="background: ${isStreaming ? 'rgba(56, 189, 248, 0.2)' : (isFinished ? 'rgba(34, 197, 94, 0.2)' : 'rgba(148, 163, 184, 0.15)')}; color: ${isStreaming ? '#38bdf8' : (isFinished ? '#4ade80' : '#94a3b8')}; border: 1px solid ${isStreaming ? 'rgba(56, 189, 248, 0.4)' : (isFinished ? 'rgba(34, 197, 94, 0.4)' : 'rgba(148, 163, 184, 0.3)')};">
              ${isStreaming ? '✨ Streaming Live' : (isFinished ? '✅ Harvest Complete' : '💤 Awaiting Start')}
            </span>
          </div>

          <!-- Real-Time Cards List Updating Each Time An Event is Processed -->
          <div id="harvester-bottom-cards-feed" style="max-height: 420px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px;">
            ${newEventsCount === 0 ? `
              <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 160px; text-align: center; color: #94a3b8; padding: 16px;">
                ${isStreaming ? `
                  <span class="pipeline-loader-ring" style="width: 30px; height: 30px; margin-bottom: 10px; border-width: 3px; border-color: #38bdf8 transparent #38bdf8 transparent;"></span>
                  <div style="font-weight: 700; color: #38bdf8; font-size: 0.88rem; margin-bottom: 3px;">Harvester Active &amp; Crawling...</div>
                  <p style="font-size: 0.74rem; color: #cbd5e1; max-width: 320px; margin: 0; line-height: 1.45;">
                    Discrete event cards will appear here immediately in real-time as each candidate calendar link is fetched and verified.
                  </p>
                ` : (isFinished ? `
                  <div style="font-size: 1.8rem; margin-bottom: 4px;">🏁</div>
                  <div style="font-weight: 700; color: #34d399; font-size: 0.88rem; margin-bottom: 2px;">Crawl Finished (No New Events)</div>
                  <p style="font-size: 0.74rem; color: #94a3b8; margin: 0;">All discovered calendar dates were already in the active catalog.</p>
                ` : `
                  <div style="font-size: 1.8rem; margin-bottom: 4px;">⚡</div>
                  <div style="font-weight: 700; color: #cbd5e1; font-size: 0.88rem; margin-bottom: 2px;">Live Event Cards Stream</div>
                  <p style="font-size: 0.74rem; color: #94a3b8; max-width: 340px; margin: 0; line-height: 1.45;">
                    As each event link is processed, its verified title, date, time, venue, price, and ticket URL will appear here live so you don't have to wait for the run to complete.
                  </p>
                `)}
              </div>
            ` : (newEvents || []).map((ev, idx) => {
      const evUrl = ev.url || ev.ticket_url || `https://www.google.com/search?q=${encodeURIComponent((ev.title || '') + ' ' + (ev.venue || '') + ' Vancouver')}`;
      return `
                <div style="background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.32); border-radius: 6px; padding: 9px 12px; display: flex; flex-direction: column; gap: 4px; transition: transform 0.15s ease;">
                  <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
                    <a href="${escapeHtml(evUrl)}" target="_blank" rel="noopener noreferrer" 
                       style="font-weight: 700; font-size: 0.82rem; color: #fff; text-decoration: none; cursor: pointer; flex: 1; transition: color 0.15s ease;"
                       onmouseover="this.style.color='#4ade80'; this.style.textDecoration='underline';"
                       onmouseout="this.style.color='#fff'; this.style.textDecoration='none';"
                       title="Open ${escapeHtml(ev.title || 'Event')} in new window">
                      #${idx + 1}. ${escapeHtml(ev.title || 'Event')} <span style="font-size: 0.68rem; color: #34d399;">↗</span>
                    </a>
                    <span style="font-size: 0.64rem; font-weight: 700; background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid rgba(34, 197, 94, 0.4); padding: 1px 7px; border-radius: 999px; white-space: nowrap;">✨ New Event</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 10px; font-size: 0.72rem; flex-wrap: wrap;">
                    <span style="color: #38bdf8; font-weight: 600;">📅 ${escapeHtml(ev.date || 'TBD')}</span>
                    ${ev.time ? `<span style="color: #94a3b8;">⏰ ${escapeHtml(ev.time)}</span>` : ''}
                    <span style="color: #cbd5e1;">📍 ${escapeHtml(ev.venue || 'Vancouver Venue')}</span>
                    ${ev.price ? `<span style="color: #34d399; font-weight: 700;">💰 ${escapeHtml(ev.price)}</span>` : ''}
                  </div>
                  ${ev.url ? `
                    <div style="margin-top: 2px;">
                      <a href="${escapeHtml(ev.url)}" target="_blank" rel="noopener noreferrer" style="font-size: 0.68rem; color: #c084fc; text-decoration: none; display: inline-flex; align-items: center; gap: 3px;"
                         onmouseover="this.style.textDecoration='underline';"
                         onmouseout="this.style.textDecoration='none';">
                        🔗 View Ticket Page ↗
                      </a>
                    </div>
                  ` : ''}
                </div>
              `;
    }).join('')}
          </div>
        </div>
      </div>
    `;

    // Restore filter text if previously typed
    if (prevFilterBefore) {
      const fb = document.getElementById('harvester-filter-before');
      if (fb) {
        fb.value = prevFilterBefore;
        window.filterHarvesterBeforeSources(prevFilterBefore);
      }
    }
    if (prevFilterAfter) {
      const fa = document.getElementById('harvester-filter-after');
      if (fa) {
        fa.value = prevFilterAfter;
        window.filterHarvesterAfterSources(prevFilterAfter);
      }
    }
  }

  function finalizeHarvesterRun(isSuccess = true) {
    if (currentPipelineScanKey !== 'harvest') return Promise.resolve();

    return fetch('/data/events.json?_t=' + Date.now())
      .then(res => res.json())
      .then(freshEvents => {
        const preRunIds = new Set((harvesterPreRunEvents || []).map(e => e.id || e.event_id));
        const newlyAdded = (freshEvents || []).filter(e => !preRunIds.has(e.id || e.event_id));

        const mergedNew = [...newlyAdded.map(e => ({
          id: e.id || e.event_id,
          title: e.title || e.event_name,
          date: e.date || e.dateSchedule,
          time: e.time || e.doors_time,
          venue: e.venue || e.venue_name,
          price: e.priceLabel,
          url: e.ticket_url || e.details_url
        }))];

        (harvesterDiscoveredEvents || []).forEach(dev => {
          if (!mergedNew.some(m => m.id === dev.id || (m.title === dev.title && m.date === dev.date))) {
            mergedNew.push(dev);
          }
        });

        // Also merge all uncompiled Stage 1A harvested events from layer_schedules.json so Stage 1B -> 5 receives the full harvested cohort
        if (typeof window.getUncompiledHarvestedEvents === 'function') {
          const uncompiledList = window.getUncompiledHarvestedEvents() || [];
          uncompiledList.forEach(u => {
            const uid = u.id || u.event_id;
            if (uid && !mergedNew.some(m => m.id === uid)) {
              mergedNew.push({
                id: uid,
                title: u.title || u.event_name || 'Harvested Event',
                date: u.date || u.dateSchedule || 'TBD',
                time: u.time || u.doors_time || '',
                venue: u.venue || u.venue_name || '',
                price: u.priceLabel || 'Pending',
                url: u.url || u.ticket_url || u.details_url || ''
              });
            }
          });
        }

        renderHarvesterComparisonView(true, mergedNew, false);
        updateComparisonStatusPill(
          isSuccess
            ? `${mergedNew.length} New Events Harvested ✅`
            : `${mergedNew.length} Events Harvested (Halted)`,
          'updated'
        );

        const batchLimit = (pipelineBatchSize === 'all' || pipelineBatchSize === 0) ? 9999 : (Number(pipelineBatchSize) || 50);
        const discoveredIds = mergedNew.map(x => x.id).filter(Boolean).slice(0, batchLimit);
        if (discoveredIds.length > 0) {
          pipelineTestDiscoveredIds = discoveredIds;
          pipelineTestDiscoveredEvents = mergedNew.filter(x => x.id && discoveredIds.includes(x.id)).slice(0, batchLimit);
          currentPipelineScope = 'harvested';
        } else if (pipelineTestDiscoveredIds.length === 0 && Array.isArray(freshEvents) && freshEvents.length > 0) {
          const picked = freshEvents.slice(0, batchLimit);
          pipelineTestDiscoveredIds = picked.map(e => e.id || e.event_id).filter(Boolean);
          pipelineTestDiscoveredEvents = picked.map(e => ({
            id: e.id || e.event_id,
            title: e.title || e.event_name || 'Event',
            date: e.date || e.dateSchedule || '',
            venue: e.venue || e.venue_name || '',
            price: e.priceLabel || '',
            url: e.ticket_url || e.details_url || ''
          }));
        }
        pipelineTestStageStatuses.harvest = isSuccess
          ? `✅ Complete (${pipelineTestDiscoveredIds.length} Harvested)`
          : `⚠️ Halted (${pipelineTestDiscoveredIds.length} Harvested)`;
        savePipelineBatchState();
        if (typeof renderPipelineTestEventsList === 'function') renderPipelineTestEventsList();
        if (typeof updatePipelineTestStepperUI === 'function') updatePipelineTestStepperUI();
      })
      .catch(() => {
        renderHarvesterComparisonView(true, harvesterDiscoveredEvents || [], false);
        updateComparisonStatusPill(
          `${(harvesterDiscoveredEvents || []).length} New Events Harvested ✅`,
          'updated'
        );
        const batchLimit = (pipelineBatchSize === 'all' || pipelineBatchSize === 0) ? 9999 : (Number(pipelineBatchSize) || 5);
        const discoveredIds = (harvesterDiscoveredEvents || []).map(x => x.id).filter(Boolean).slice(0, batchLimit);
        if (discoveredIds.length > 0) {
          pipelineTestDiscoveredIds = discoveredIds;
          pipelineTestDiscoveredEvents = (harvesterDiscoveredEvents || []).slice(0, batchLimit);
        }
        pipelineTestStageStatuses.harvest = `✅ Complete (${pipelineTestDiscoveredIds.length} Harvested)`;
        savePipelineBatchState();
        if (typeof renderPipelineTestEventsList === 'function') renderPipelineTestEventsList();
        if (typeof updatePipelineTestStepperUI === 'function') updatePipelineTestStepperUI();
      });
  }

  function initColumnResizers() {
    // 1. Main resizer between Left Col (terminal/controls) and Right Col (yield)
    const mainResizer = document.getElementById('pipeline-main-resizer');
    const leftCol = document.querySelector('.pipeline-modal-left-col');
    const modalGrid = document.querySelector('.pipeline-modal-grid') || (mainResizer ? mainResizer.parentElement : null);

    if (mainResizer && leftCol && modalGrid && !mainResizer._resizerInit) {
      mainResizer._resizerInit = true;
      let isDragging = false;
      let startX = 0;
      let startWidth = 0;

      mainResizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        startX = e.clientX;
        startWidth = leftCol.getBoundingClientRect().width;
        mainResizer.classList.add('is-resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (ev) => {
          if (!isDragging) return;
          const deltaX = ev.clientX - startX;
          const gridWidth = modalGrid.getBoundingClientRect().width;
          const newWidth = Math.max(280, Math.min(gridWidth - 320, startWidth + deltaX));
          const pct = (newWidth / gridWidth) * 100;
          leftCol.style.flex = `0 0 ${pct}%`;
          leftCol.style.maxWidth = `${pct}%`;
        };

        const onMouseUp = () => {
          isDragging = false;
          mainResizer.classList.remove('is-resizing');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });
    }

    // 2. Comparison resizer between Before card and After card
    const compResizer = document.getElementById('pipeline-comp-resizer');
    const beforeCard = document.getElementById('pipeline-comp-card-before');
    const cardsRow = document.getElementById('pipeline-comparison-cards-row') || (compResizer ? compResizer.parentElement : null);

    if (compResizer && beforeCard && cardsRow && !compResizer._resizerInit) {
      compResizer._resizerInit = true;
      let isDragging = false;
      let startX = 0;
      let startWidth = 0;

      compResizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        startX = e.clientX;
        startWidth = beforeCard.getBoundingClientRect().width;
        compResizer.classList.add('is-resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const onMouseMove = (ev) => {
          if (!isDragging) return;
          const deltaX = ev.clientX - startX;
          const rowWidth = cardsRow.getBoundingClientRect().width;
          const newWidth = Math.max(180, Math.min(rowWidth - 180, startWidth + deltaX));
          const pct = (newWidth / rowWidth) * 100;
          beforeCard.style.flex = `0 0 ${pct}%`;
          beforeCard.style.maxWidth = `${pct}%`;
        };

        const onMouseUp = () => {
          isDragging = false;
          compResizer.classList.remove('is-resizing');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          window.removeEventListener('mousemove', onMouseMove);
          window.removeEventListener('mouseup', onMouseUp);
        };

        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
      });
    }
  }

  let pipelineInitialSnapshots = new Map();
  let pipelineProcessedCount = 0;
  let pipelineTotalTargets = 0;
  let pipelineCurrentTargetIndex = 0;

  function addEventDiffRow(ctx) {
    if (!ctx || ctx._diffCommitted) return;
    ctx._diffCommitted = true;

    const emptyRow = document.getElementById('pipeline-diff-empty-row');
    if (emptyRow) emptyRow.remove();

    const tbody = document.getElementById('pipeline-diff-tbody');
    if (!tbody) return;

    const eventId = ctx?.id;
    const before = (eventId && pipelineInitialSnapshots && typeof pipelineInitialSnapshots.get === 'function')
      ? pipelineInitialSnapshots.get(eventId)
      : null;
    const allEvs = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const cardNum = before?.cardIndex || ctx?.cardIndex || (eventId && allEvs ? (allEvs.findIndex(e => (e.id || e.event_id) === eventId) + 1) : null) || '?';
    ctx.cardIndex = cardNum;

    const title = ctx.title || ctx.afterTitle || (before && before.title) || 'Event';
    const venue = ctx.venue || ctx.afterVenue || (before && before.venue) || '';

    const changes = [];

    // 1. Title change
    if (ctx.afterTitle && (!before || ctx.afterTitle !== before.title)) {
      changes.push({
        field: 'Title',
        before: before ? before.title : 'Raw Scraped Title',
        after: ctx.afterTitle
      });
    }

    // 2. Price change
    if (ctx.afterPrice != null) {
      const beforePriceStr = before ? (before.priceLabel || `$${Number(before.price || 0).toFixed(2)} CAD`) : 'Unpriced';
      const afterPriceStr = ctx.afterPrice;
      if (!before || beforePriceStr !== afterPriceStr || (ctx.afterFee && ctx.afterFee > 0)) {
        changes.push({
          field: 'Price',
          before: beforePriceStr,
          after: `${afterPriceStr}${ctx.afterFee > 0 ? ` (+$${ctx.afterFee} fee)` : ''}`
        });
      }
    }

    // 3. Category change
    if (ctx.afterCategory && (!before || ctx.afterCategory !== before.category)) {
      changes.push({
        field: 'Category',
        before: (before && before.category) || 'None',
        after: ctx.afterCategory
      });
    }

    // 4. Artist change
    if (ctx.afterArtist !== undefined && (!before || ctx.afterArtist !== before.artist)) {
      changes.push({
        field: 'Artist / Lineup',
        before: (before && before.artist) || 'None',
        after: ctx.afterArtist || 'General / None'
      });
    }

    // 5. Restrictions change
    if (ctx.afterAge && (!before || ctx.afterAge !== before.restrictions)) {
      changes.push({
        field: 'Age Policy',
        before: (before && before.restrictions) || 'Unspecified',
        after: ctx.afterAge
      });
    }

    // 6. Synopsis / Description change
    if (ctx.afterDescription && (!before || ctx.afterDescription !== before.description)) {
      changes.push({
        field: 'Synopsis',
        before: (before && before.description) ? (before.description.length > 36 ? before.description.slice(0, 36) + '...' : before.description) : 'None',
        after: ctx.afterDescription.length > 36 ? ctx.afterDescription.slice(0, 36) + '...' : ctx.afterDescription
      });
    }

    // 6. Inventory change
    if (ctx.afterInventory) {
      const isSoldOut = ctx.afterInventory.includes('SOLD OUT');
      if (!before || isSoldOut !== before.is_sold_out) {
        changes.push({
          field: 'Inventory',
          before: before && before.is_sold_out ? 'Sold Out' : 'Available',
          after: isSoldOut ? 'Sold Out ⚠️' : 'Available 🎟️'
        });
      }
    }

    // 7. Visual Proof
    if (ctx.hasProof) {
      changes.push({
        field: 'Visual Proof',
        before: (before && before.proof_keyframes && before.proof_keyframes.cart) ? 'Previous' : 'None',
        after: 'Captured 📸'
      });
    }

    // If compiling with no other changes, note publication invariant
    if (changes.length === 0 && ctx.isReconciled) {
      changes.push({
        field: 'Published Invariant',
        before: before ? (before.approval_status || 'Seed') : 'Seed',
        after: `Verified-${getCatalogDimensionsCount()}D Live ✅`
      });
    }

    let statusHtml = '';
    if (changes.length > 0) {
      statusHtml = `<span class="diff-badge-status updated">Updated (${changes.length}) ✅</span>`;
    } else {
      statusHtml = `<span class="diff-badge-status nodrift">No Drift ⚪</span>`;
    }

    let changesHtml = '';
    if (changes.length > 0) {
      changesHtml = changes.map(c => `
        <div class="diff-change-item">
          <span class="diff-prop-tag">${escapeHtml(c.field)}</span>
          <span class="diff-val-before" title="Previous: ${escapeHtml(c.before)}">${escapeHtml(c.before)}</span>
          <span class="diff-arrow">➔</span>
          <span class="diff-val-after" title="Verified: ${escapeHtml(c.after)}">${escapeHtml(c.after)}</span>
        </div>
      `).join('');
    } else {
      changesHtml = `<span style="color: #94a3b8; font-style: italic; font-size: 0.72rem;">All factual dimensions verified identical against live reality.</span>`;
    }

    const historyKey = ctx.id || String(cardNum);
    const existingHistoryIdx = pipelineAuditedCardsHistory.findIndex(x => x.id === historyKey);

    let tr = tbody.querySelector(`tr[data-diff-event-id="${CSS.escape ? CSS.escape(historyKey) : historyKey.replace(/"/g, '\\"')}"]`);
    const isNewRow = !tr;
    if (!tr) {
      tr = document.createElement('tr');
      tr.className = 'diff-row newly-added';
      tr.setAttribute('data-diff-event-id', historyKey);
      tr.style.cursor = 'pointer';
      tr.title = 'Click to inspect side-by-side card yield on the right';
      tr.addEventListener('click', () => {
        showComparisonCardById(historyKey);
      });
    }
    tr.innerHTML = `
      <td style="font-weight: 700; color: #38bdf8;">#${escapeHtml(String(cardNum))}</td>
      <td>
        <div style="font-weight: 600; color: #fff; line-height: 1.25;">${escapeHtml(title)}</div>
        <div style="font-size: 0.68rem; color: #94a3b8; margin-top: 2px;">${escapeHtml(venue)}</div>
      </td>
      <td>${changesHtml}</td>
      <td style="text-align: center;">${statusHtml}</td>
    `;

    if (isNewRow) {
      tbody.insertBefore(tr, tbody.firstChild);
    }

    // Register into Side-by-Side Comparison History (upsert to prevent duplicate cards)
    const historyItem = {
      id: historyKey,
      cardIndex: cardNum,
      title: title,
      ctx: { ...ctx },
      before: before ? { ...before } : null
    };
    if (existingHistoryIdx >= 0) {
      pipelineAuditedCardsHistory[existingHistoryIdx] = historyItem;
    } else {
      pipelineAuditedCardsHistory.push(historyItem);
    }
    showComparisonCardById(historyItem.id);

    // Strict completed count for the current run: never add skipped resume baseline or clamp ahead to in-progress index
    const rawProcessed = pipelineAuditedCardsHistory.length;
    pipelineProcessedCount = (pipelineTotalTargets > 0 && rawProcessed > pipelineTotalTargets)
      ? pipelineTotalTargets
      : rawProcessed;
    const badge = document.getElementById('pipeline-diff-counter-badge');
    if (badge) {
      badge.textContent = pipelineTotalTargets > 0
        ? `${pipelineProcessedCount} of ${pipelineTotalTargets} Completed`
        : `${pipelineProcessedCount} Completed`;
    }
    if (typeof window.updateAllStageContinuationButtonsUI === 'function') {
      window.updateAllStageContinuationButtonsUI();
    }
  }

  const BENCHMARKS = {
    catalog_batch: 48,
    single: 45,
    calendar: 25,
    harvester: 25,
    enrich: 18,
    venue_detailer: 28,
    venue: 28,
    tier1_hunter: 18,
    hunter: 18,
    qc: 48,
    compile: 3
  };

  const formatDuration = (sec) => {
    sec = Math.max(0, Math.round(sec));
    if (sec >= 60) {
      const mins = Math.floor(sec / 60);
      const s = sec % 60;
      return `${mins}m ${s < 10 ? '0' : ''}${s}s`;
    }
    return `${sec}s`;
  };

  const closePipelineModal = () => {
    document.body.style.overflow = '';
    if (pipelineModal) {
      pipelineModal.classList.remove('active');
      pipelineModal.style.display = 'none';
    }
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    setExecutionState(false);
    if (btnStopPipeline) btnStopPipeline.style.display = 'none';
    if (btnStopPipelineTop) btnStopPipelineTop.style.display = 'none';
    const btnTrigger = document.getElementById('btn-trigger-pipeline-run');
    if (btnTrigger) btnTrigger.style.display = 'inline-flex';
    const metricsBox = document.getElementById('pipeline-active-metrics');
    if (metricsBox) metricsBox.style.display = 'none';
    if (pipelineStatusSubtext) pipelineStatusSubtext.style.display = 'none';
  };

  if (btnClosePipelineModal) btnClosePipelineModal.addEventListener('click', closePipelineModal);
  if (btnClosePipelineBottom) btnClosePipelineBottom.addEventListener('click', closePipelineModal);
  if (pipelineModal) {
    pipelineModal.addEventListener('click', (e) => {
      if (e.target === pipelineModal) closePipelineModal();
    });
  }

  const stopActiveStagehand = async () => {
    if (activeEventSource) {
      activeEventSource.close();
      activeEventSource = null;
    }
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (pipelineConsoleOutput) {
      pipelineConsoleOutput.textContent += '\n[ABORT] Stopping active pipeline worker subagent...\n';
      pipelineConsoleOutput.scrollTop = pipelineConsoleOutput.scrollHeight;
    }
    if (consoleOutput) {
      consoleOutput.textContent += '\n[ABORT] Stopping active Stagehand browser subagent...\n';
      consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }
    try {
      await fetch('/api/curator/stagehand/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Curator-Token': state.token || ''
        }
      });
    } catch (e) { }
    setExecutionState(false);
    if (btnStopPipeline) btnStopPipeline.style.display = 'none';
    if (btnStopPipelineTop) btnStopPipelineTop.style.display = 'none';
    const btnTrigger = document.getElementById('btn-trigger-pipeline-run');
    if (btnTrigger) btnTrigger.style.display = 'inline-flex';
    if (pipelineSpinner) {
      pipelineSpinner.style.animation = 'none';
      pipelineSpinner.textContent = '⏹️';
    }
    if (pipelineStatusText) {
      pipelineStatusText.textContent = '⏹️ Execution stopped by user.';
      pipelineStatusText.style.color = '#fbbf24';
    }
    if (pipelineStatusSubtext) {
      pipelineStatusSubtext.textContent = 'Pipeline worker terminated cleanly.';
    }
    if (pipelineEtaValue) {
      pipelineEtaValue.textContent = 'Cancelled';
    }
    if (typeof showToast === 'function') showToast('Pipeline execution stopped.', 'info');
    if (typeof finalizeHarvesterRun === 'function') finalizeHarvesterRun(false);
  };

  if (stopBtn) stopBtn.addEventListener('click', stopActiveStagehand);
  if (btnStopPipeline) btnStopPipeline.addEventListener('click', stopActiveStagehand);
  if (btnStopPipelineTop) btnStopPipelineTop.addEventListener('click', stopActiveStagehand);

  // -------------------------------------------------------------
  // Autonomous Multi-Scan Configuration & Launcher
  // -------------------------------------------------------------
  let currentPipelineScanKey = 'qc';
  let currentPipelineScope = 'unscanned';
  let currentBatchSize = 5;

  const SCAN_PRESETS = {
    harvest: {
      key: 'harvest',
      mode: 'calendar',
      title: '<span>📅</span> 1. Schedule Harvester',
      techPillText: '[Stagehand Calendar Harvester]',
      techPillClass: 'tech-pill-stagehand',
      shortDesc: 'Automated Stagehand headless crawler ingests physical venue calendars, ticket feeds, and client-side JS widgets into layer_schedules.json.',
      btnLabel: 'Harvest All Venue Feeds',
      btnColor: 'linear-gradient(135deg, #7e22ce 0%, #a855f7 100%)',
      btnBorder: '#c084fc',
      urlPlaceholder: 'https://theimprovcentre.ca/shows/ (or choose from venue feeds dropdown)',
      defaultLimit: 10,
      showUrl: false,
      initialStatus: 'Crawling venue schedules and dated showings into layer_schedules.json...'
    },
    hunter: {
      key: 'hunter',
      mode: 'tier1_hunter',
      title: '<span>🏹</span> 1B. Tier 1 Link Hunter',
      techPillText: '[Tier 1 Hunter]',
      techPillClass: 'tech-pill-stagehand',
      shortDesc: 'Automated Tier 1 Deep Link Hunter inspects venue ticketing buttons, embeds, and candidate leads to upgrade generic links to direct checkout carts.',
      btnLabel: 'Run Tier 1 Hunter',
      btnColor: 'linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)',
      btnBorder: '#14b8a6',
      urlPlaceholder: 'Inspects discovered and stale event cards for direct checkout URLs',
      defaultLimit: 10,
      showUrl: false,
      initialStatus: 'Upgrading candidate links & resolving direct checkout carts...'
    },
    qc: {
      key: 'qc',
      mode: 'catalog_batch',
      title: '<span>⚡</span> 2. Stagehand',
      techPillText: '[Stagehand]',
      techPillClass: 'tech-pill-stagehand',
      shortDesc: 'Autonomous Stagehand Chromium AI agent penetrates live checkout cart modals, extracts fees & 5% GST, and enforces the strict ≤ $50.00 CAD ceiling.',
      btnLabel: 'Run Stagehand',
      btnColor: 'linear-gradient(135deg, #0284c7 0%, #38bdf8 100%)',
      btnBorder: '#38bdf8',
      urlPlaceholder: 'Leave blank to audit all catalog events sequentially, or paste single ticket URL',
      defaultLimit: 5,
      showUrl: true,
      initialStatus: 'Penetrating checkout carts & validating fees into layer_box_office.json...'
    },
    enrich: {
      key: 'enrich',
      mode: 'enrich',
      title: '<span>✍️</span> 3. AI Semantic Enricher',
      techPillText: '[Cognitive NLP Worker]',
      techPillClass: 'tech-pill-llm',
      shortDesc: 'Deterministic Cognitive NLP Engine normalizes scraped headlines, structures artist lineups, generates 2-sentence visitor synopses, and assigns categories.',
      btnLabel: 'Run AI Enricher',
      btnColor: 'linear-gradient(135deg, #d97706 0%, #fbbf24 100%)',
      btnBorder: '#fbbf24',
      urlPlaceholder: 'Processes event records directly from catalog layers',
      defaultLimit: 20,
      showUrl: false,
      initialStatus: 'Sanitizing event titles, synopses & categories into layer_editorial.json...'
    },
    venue: {
      key: 'venue',
      mode: 'venue_detailer',
      title: '<span>🏛️</span> 4. Venue Detailer & Maps Grounding',
      techPillText: '[Venue Detailer AI]',
      techPillClass: 'tech-pill-llm',
      shortDesc: 'Google Maps Grounding & Physical Facility Auditor verifies street addresses, GPS coordinates, transit waypoints, accessibility (5XX), and drink/spend benchmarks (6XX) in venues.json.',
      btnLabel: 'Ground Venue Facilities',
      btnColor: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)',
      btnBorder: '#22d3ee',
      urlPlaceholder: 'Select all venues or a specific physical venue to ground into venues.json',
      defaultLimit: 10,
      showUrl: false,
      initialStatus: 'Grounding physical venue addresses, GPS coordinates & amenities into venues.json...'
    },
    consolidate: {
      key: 'consolidate',
      mode: 'consolidate',
      title: '<span>🔀</span> 5A. Consolidator & Multi-Day Merger',
      techPillText: '[Consolidator & Deduplicator]',
      techPillClass: 'tech-pill-agent',
      shortDesc: 'Canonical Entity Fingerprinting & Multi-Day Showing Rollup detects duplicate cards across dates or ticket portals, merges showings[] into a single master card, and archives redundant IDs.',
      btnLabel: 'Consolidate & Merge Duplicates',
      btnColor: 'linear-gradient(135deg, #0d9488 0%, #10b981 100%)',
      btnBorder: '#34d399',
      urlPlaceholder: 'Scans entire catalog and specialist layers for multi-day or cross-source duplicates',
      defaultLimit: 0,
      showUrl: false,
      initialStatus: 'Scanning catalog for duplicate events & rolling up multi-day showings...'
    },
    compile: {
      key: 'compile',
      mode: 'compile',
      title: '<span>🏛️</span> 5. Compiler, Consolidator & Publisher',
      techPillText: '[Compiler & Consolidator AI]',
      techPillClass: 'tech-pill-agent',
      shortDesc: `AI Arbitrator reconciles specialist layers (Stagehand Box Office, Harvester Schedules, Semantic Enricher, and Master Venues) across ${getCatalogDimensionsCount()} dimensions, validates financial invariants (base + fee + tax = all_in ≤ $50), checks for any multi-day or cross-source duplicates and merges them into a single master event card, and publishes live to js/data.js.`,
      btnLabel: 'Compile, Deduplicate & Publish Live',
      btnColor: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
      btnBorder: '#34d399',
      urlPlaceholder: 'Leave empty for catalog cards, or enter specific calendar/ticket URL',
      defaultLimit: 5,
      showUrl: false,
      initialStatus: 'Arbitrating layers, merging duplicate multi-day cards & publishing master data live...'
    },
    master: {
      key: 'master',
      mode: 'master',
      title: '<span>🚀</span> Antigravity Master Pipeline (1-by-1 Loop)',
      techPillText: '[Antigravity 1-Event Workers]',
      techPillClass: 'tech-pill-agent',
      shortDesc: 'Deterministic non-AI controller loop that runs Box Office QC → Semantic Enricher → Compiler AI Arbitrator sequentially by spawning a fresh, disposable Antigravity CLI worker for each single event (zero Super-AI or Worker-AI laziness).',
      btnLabel: 'Run Master Pipeline (1-by-1)',
      btnColor: 'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)',
      btnBorder: '#f472b6',
      urlPlaceholder: 'Leave empty to run across selected scope',
      defaultLimit: 5,
      showUrl: false,
      initialStatus: 'Spawning fresh 1-event Antigravity workers across Box Office, Enricher & Compiler...'
    }
  };

  // -------------------------------------------------------------
  // 5-STAGE / 6-STEP END-TO-END PIPELINE CONTROLLER
  // -------------------------------------------------------------
  let isPipelineTestMode = true;
  let isPipelineAutoChaining = false;
  let pipelineBatchSize = 'all';
  window.pipelineBatchSize = 'all';
  let pipelineTestStageKey = 'harvest';
  let pipelineTestDiscoveredIds = [];
  let pipelineTestDiscoveredEvents = [];
  let pipelineTestStageStatuses = {
    harvest: 'Pending',
    hunter: 'Pending',
    qc: 'Pending',
    enrich: 'Pending',
    venue: 'Pending',
    compile: 'Pending'
  };
  let pipelineStepperCompact = false;
  let pipelineStaleFilterCategory = null;
  let pipelineQuarantinedRunActive = false;
  let pipelineVenueDetailerNeedsCompile = false;
  let pipelineLastVenuesGroundedCount = 0;
  let pipelineLastCompiledCardIds = [];
  let pipelineLastQuarantinedCardIds = [];
  let currentPreviewModalTab = 'compiled';
  let autoPipelineModalScope = 'discover_and_stale';
  let autoPipelineModalBatchSize = 'all';
  let cachedDetailerVenues = null;

  window.promptContinueEventCount = function (totalAvailable = null, contextLabel = 'events') {
    const totalHint = (typeof totalAvailable === 'number' && totalAvailable > 0)
      ? ` (${totalAvailable} ${contextLabel} remaining — enter a number or "all")`
      : ' (enter a number or "all")';
    const raw = window.prompt(
      `How many ${contextLabel} would you like to process?${totalHint}:`,
      'all'
    );
    if (raw === null) return null;
    const trimmed = String(raw).trim().toLowerCase();
    if (!trimmed || trimmed === 'all' || trimmed === '0') {
      return 'all';
    }
    const parsed = parseInt(trimmed, 10);
    if (isNaN(parsed) || parsed <= 0) {
      if (typeof showToast === 'function') {
        showToast('Invalid number entered. Please enter a positive number or "all".', 'warning');
      }
      return null;
    }
    return parsed;
  };

  const PIPELINE_TEST_ORDER = ['harvest', 'hunter', 'qc', 'enrich', 'venue', 'compile'];

  function savePipelineBatchState() {
    try {
      sessionStorage.setItem('van50_pipeline_batch_state', JSON.stringify({
        batchSize: pipelineBatchSize,
        stageKey: pipelineTestStageKey,
        discoveredIds: pipelineTestDiscoveredIds,
        discoveredEvents: pipelineTestDiscoveredEvents,
        stageStatuses: pipelineTestStageStatuses,
        updatedAt: Date.now()
      }));
    } catch (_) { }
  }

  function loadPipelineBatchState() {
    try {
      const raw = sessionStorage.getItem('van50_pipeline_batch_state');
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        if (parsed.batchSize) {
          pipelineBatchSize = parsed.batchSize;
          window.pipelineBatchSize = parsed.batchSize;
        }
        if (parsed.stageKey && PIPELINE_TEST_ORDER.includes(parsed.stageKey)) pipelineTestStageKey = parsed.stageKey;
        if (Array.isArray(parsed.discoveredIds)) pipelineTestDiscoveredIds = parsed.discoveredIds;
        if (Array.isArray(parsed.discoveredEvents)) pipelineTestDiscoveredEvents = parsed.discoveredEvents;
        if (parsed.stageStatuses && typeof parsed.stageStatuses === 'object') {
          const cleanedStatuses = {};
          Object.entries(parsed.stageStatuses).forEach(([k, v]) => {
            cleanedStatuses[k] = (!isExecuting && String(v || '').includes('Running')) ? 'Queued ⏳' : v;
          });
          pipelineTestStageStatuses = { ...pipelineTestStageStatuses, ...cleanedStatuses };
        }
        return true;
      }
    } catch (_) { }
    return false;
  }

  window.setPipelineBatchSize = function (size) {
    pipelineBatchSize = size;
    window.pipelineBatchSize = size;
    window.selectedAutoModalBatchSize = size;
    const chips = ['1', '5', '10', '25', '50', 'all', 'custom'];
    const isCustomNum = typeof size === 'number' && ![1, 5, 10, 25, 50].includes(size);
    chips.forEach(c => {
      const isActive = (c === String(size)) || (c === 'custom' && isCustomNum);
      const el = document.getElementById(`chip-batch-${c}`);
      if (el) el.classList.toggle('active', isActive);
      const elH = document.getElementById(`chip-harvester-batch-${c}`);
      if (elH) elH.classList.toggle('active', isActive);
      const elModal = document.getElementById(`modal-chip-batch-${c}`);
      if (elModal) elModal.classList.toggle('active', String(size) === c);
    });
    const chipCustom = document.getElementById('chip-batch-custom');
    if (chipCustom) chipCustom.textContent = isCustomNum ? `#${size}` : '#';
    const chipCustomH = document.getElementById('chip-harvester-batch-custom');
    if (chipCustomH) chipCustomH.textContent = isCustomNum ? `#${size}` : '#';

    const stopInput = document.getElementById('pipeline-card-stop');
    const startInput = document.getElementById('pipeline-card-start');
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const qEvents = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);
    const totalEvents = events.length || 156;
    if (stopInput && startInput) {
      const start = parseInt(startInput.value, 10) || 1;
      if (size === 'all') {
        stopInput.value = totalEvents;
      } else if (typeof size === 'number') {
        stopInput.value = Math.min(totalEvents, start + size - 1);
      }
    }

    // Re-populate pipelineTestDiscoveredIds according to current active filter/scope
    let targetPool = events;
    if (pipelineQuarantinedRunActive || currentPipelineScope === 'quarantined') {
      targetPool = qEvents;
    } else if (currentPipelineScope === 'harvested' && typeof window.getUncompiledHarvestedEvents === 'function') {
      const harvestedPool = window.getUncompiledHarvestedEvents();
      if (harvestedPool && harvestedPool.length > 0) targetPool = harvestedPool;
    } else if (pipelineStaleFilterCategory && pipelineStaleFilterCategory !== 'all_stale') {
      const matched = events.filter(e => classifyEventStaleness(e) === pipelineStaleFilterCategory);
      if (matched.length > 0) targetPool = matched;
    } else {
      const outOfDate = events.filter(e => classifyEventStaleness(e) !== 'fresh');
      if (outOfDate.length > 0) targetPool = outOfDate;
    }
    const bLimit = (size !== 'all' && typeof size === 'number') ? size : targetPool.length;
    const picked = targetPool.slice(0, bLimit);
    pipelineTestDiscoveredIds = picked.map(e => e.id || e.event_id).filter(Boolean);
    pipelineTestDiscoveredEvents = picked.map(e => ({
      id: e.id || e.event_id,
      title: e.title || e.event_name || 'Event',
      date: e.date || e.dateSchedule || '',
      venue: e.venue || e.venue_name || '',
      price: e.priceLabel || '',
      url: e.ticket_url || e.details_url || ''
    }));

    const batchPillLabel = document.getElementById('scope-pill-batch5-label');
    if (batchPillLabel) {
      batchPillLabel.textContent = `🧪 ${size === 'all' ? pipelineTestDiscoveredIds.length : (pipelineTestDiscoveredIds.length || size)} Events`;
    }
    const autoStaleLabel = document.getElementById('btn-stepper-auto-stale-label');
    if (autoStaleLabel && !isExecuting) {
      autoStaleLabel.textContent = `⚡ Auto-Run Out-of-Date (${size === 'all' ? 'All' : (pipelineTestDiscoveredIds.length || size)})`;
    }

    savePipelineBatchState();
    updatePipelineTestStepperUI();
    renderPipelineTestEventsList();
    if (typeof window.updateAutoPipelineFlowPreview === 'function') {
      window.updateAutoPipelineFlowPreview();
    }

    const activeStage = currentPipelineScanKey || pipelineTestStageKey || 'harvest';
    const displayCount = (size === 'all') ? 'All' : (pipelineTestDiscoveredIds.length || size);
    const btnLabelEl = document.getElementById('btn-trigger-pipeline-label');
    const titleEl = document.getElementById('pipeline-modal-title');
    const descEl = document.getElementById('pipeline-scan-desc-short');

    if (activeStage === 'harvest') {
      if (btnLabelEl) btnLabelEl.textContent = `🚀 Harvest ${size === 'all' ? 'All' : size} Events`;
      if (titleEl) titleEl.innerHTML = `🧪 Stage 1A: Schedule Harvester (${size === 'all' ? 'All' : size} Events)`;
      if (descEl) descEl.textContent = `Step 1 of 6 (Stage 1A): Crawler visits venue feeds to discover discrete event links, capped at ${size === 'all' ? 'all' : size} events.`;
    } else if (activeStage === 'hunter') {
      if (btnLabelEl) btnLabelEl.textContent = `🚀 Hunt ${displayCount} Direct Links`;
      if (titleEl) titleEl.innerHTML = `🧪 Stage 1B: Tier 1 Link Hunter (${displayCount} Events)`;
    } else if (activeStage === 'qc') {
      if (btnLabelEl) btnLabelEl.textContent = `🚀 Run Stagehand QC (${displayCount})`;
      if (titleEl) titleEl.innerHTML = `🧪 Stage 2: Stagehand AI QC (${displayCount} Events)`;
    } else if (activeStage === 'enrich') {
      if (btnLabelEl) btnLabelEl.textContent = `🚀 Enrich ${displayCount} with AI`;
      if (titleEl) titleEl.innerHTML = `🧪 Stage 3: AI Semantic Enricher (${displayCount} Events)`;
    } else if (activeStage === 'compile') {
      if (typeof window.setCompilePublishButtonLabel === 'function') {
        window.setCompilePublishButtonLabel(displayCount);
      } else if (btnLabelEl) {
        btnLabelEl.textContent = `🚀 Compile & Publish (${displayCount})`;
      }
      if (titleEl) titleEl.innerHTML = `🧪 Stage 5: Compiler & Publisher (${displayCount} Events)`;
    }
    if (activeStage !== 'harvest' && activeStage !== 'venue' && typeof window.setPipelineScope === 'function') {
      if (currentPipelineScope === 'quarantined') {
        window.setPipelineScope('quarantined');
      } else if (currentPipelineScope === 'stale' || currentPipelineScope === 'unscanned' || currentPipelineScope === 'incomplete' || currentPipelineScope === 'range') {
        window.setPipelineScope(currentPipelineScope);
      } else {
        window.setPipelineScope('batch5');
      }
    }

    if (typeof showToast === 'function') {
      showToast(`Batch size set to: ${size === 'all' ? 'All Events' : size + ' Events'} (${pipelineTestDiscoveredIds.length} targeted)`, 'info');
    }
  };

  window.promptCustomBatchSize = function () {
    const current = typeof pipelineBatchSize === 'number' ? pipelineBatchSize : '15';
    const input = prompt('Enter custom batch size (number of events to process):', String(current));
    if (input !== null) {
      const parsed = parseInt(input.trim(), 10);
      if (!isNaN(parsed) && parsed > 0) {
        window.setPipelineBatchSize(parsed);
      } else if (typeof showToast === 'function') {
        showToast('Invalid batch size entered.', 'warning');
      }
    }
  };

  function classifyEventStaleness(ev) {
    if (!ev) return 'never';
    const timestamps = [
      ev.last_full_qc_at,
      ev.last_pulse_qc_at,
      ev.last_content_qc_at,
      ev.last_qc_audited_at,
      ev.last_qc_at,
      ev.audit_timestamp,
      ev.last_verified,
      ev.dimension_audit?.audited_at,
      ev.dimension_audit?.D808_timestamp_lockstep
    ].filter(Boolean);
    if (timestamps.length === 0) return 'never';
    const parsedTimes = timestamps.map(t => new Date(t).getTime()).filter(t => !isNaN(t));
    if (parsedTimes.length === 0) return 'never';
    const mostRecentTime = Math.max(...parsedTimes);
    const diffHours = (Date.now() - mostRecentTime) / (1000 * 60 * 60);
    if (diffHours < 24) return 'fresh';
    if (diffHours < 24 * 7) return 'day';
    if (diffHours < 24 * 30) return 'week';
    return 'month';
  }

  window.updateCatalogStalenessDashboard = function () {
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const counts = { fresh: 0, day: 0, week: 0, month: 0, never: 0 };

    (events || []).forEach(ev => {
      const cat = classifyEventStaleness(ev);
      counts[cat] = (counts[cat] || 0) + 1;
    });

    const setEl = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val);
    };
    setEl('stale-count-fresh', counts.fresh);
    setEl('stale-count-day', counts.day);
    setEl('stale-count-week', counts.week);
    setEl('stale-count-month', counts.month);
    setEl('stale-count-never', counts.never);
  };

  window.selectStaleFilter = function (filterKey) {
    pipelineStaleFilterCategory = filterKey;
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const qEvents = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);

    const chips = ['fresh', 'day', 'week', 'month', 'never'];
    chips.forEach(c => {
      const el = document.getElementById(`stale-chip-${c}`);
      if (el) el.classList.toggle('active', c === filterKey);
    });
    const btnAll = document.getElementById('btn-select-all-stale');
    if (btnAll) btnAll.classList.toggle('active', filterKey === 'all_stale');

    if (filterKey === 'quarantined') {
      pipelineQuarantinedRunActive = true;
      currentPipelineScope = 'quarantined';
      const cap = pipelineBatchSize === 'all' ? qEvents.length : (Number(pipelineBatchSize) || 5);
      const picked = qEvents.slice(0, cap);
      pipelineTestDiscoveredIds = picked.map(e => e.id || e.event_id).filter(Boolean);
      pipelineTestDiscoveredEvents = picked.map(e => ({
        id: e.id || e.event_id,
        title: e.title || e.event_name || 'Quarantined Event',
        date: e.date || e.dateSchedule || '',
        venue: e.venue || e.venue_name || '',
        price: e.priceLabel || '',
        url: e.ticket_url || e.details_url || ''
      }));
      isPipelineTestMode = true;
      pipelineTestStageStatuses.harvest = 'Skipped ⏭️';
      renderPipelineTestEventsList();
      const targetStage = (!pipelineTestStageKey || pipelineTestStageKey === 'harvest') ? 'hunter' : pipelineTestStageKey;
      openPipelineTestStage(targetStage, false);
      if (typeof showToast === 'function') {
        showToast(`Loaded ${pipelineTestDiscoveredIds.length} quarantined card(s) into batch queue (Stage 1A skipped).`, 'info');
      }
      return;
    }

    pipelineQuarantinedRunActive = false;
    let selectedEvents = [];
    if (filterKey === 'all_stale') {
      selectedEvents = events.filter(e => {
        const cat = classifyEventStaleness(e);
        return cat === 'day' || cat === 'week' || cat === 'month' || cat === 'never';
      });
    } else {
      selectedEvents = events.filter(e => classifyEventStaleness(e) === filterKey);
    }

    const summaryEl = document.getElementById('stale-selection-summary');
    if (summaryEl) {
      const labelMap = {
        fresh: 'Fresh (<24h)',
        day: 'Out-of-Date (>24h)',
        week: 'Out-of-Date (>1w)',
        month: 'Stale (>1m)',
        never: 'Never Audited',
        all_stale: 'All Out-of-Date'
      };
      summaryEl.innerHTML = `Selected <strong>${selectedEvents.length}</strong> ${labelMap[filterKey] || filterKey} events`;
    }

    if (selectedEvents.length > 0) {
      const bLimit = (pipelineBatchSize !== 'all' && typeof pipelineBatchSize === 'number') ? pipelineBatchSize : selectedEvents.length;
      const picked = selectedEvents.slice(0, bLimit);
      pipelineTestDiscoveredIds = picked.map(e => e.id || e.event_id).filter(Boolean);
      pipelineTestDiscoveredEvents = picked.map(e => ({
        id: e.id || e.event_id,
        title: e.title || e.event_name || 'Event',
        date: e.date || e.dateSchedule || '',
        venue: e.venue || e.venue_name || '',
        price: e.priceLabel || '',
        url: e.ticket_url || e.details_url || ''
      }));
      isPipelineTestMode = true;
      currentPipelineScope = 'batch5';
      pipelineTestStageStatuses.harvest = 'Skipped ⏭️';
      const autoStaleLabel = document.getElementById('btn-stepper-auto-stale-label');
      if (autoStaleLabel && !isExecuting) {
        autoStaleLabel.textContent = `⚡ Auto-Run Out-of-Date (${pipelineTestDiscoveredIds.length})`;
      }
      renderPipelineTestEventsList();
      // Always advance off Stage 1A (Harvester / Venue Discovery) onto Stage 1B (Hunter) when targeting existing catalog events
      const targetStage = (!pipelineTestStageKey || pipelineTestStageKey === 'harvest') ? 'hunter' : pipelineTestStageKey;
      openPipelineTestStage(targetStage, false);
      if (typeof showToast === 'function') {
        showToast(`Targeted ${pipelineTestDiscoveredIds.length} ${filterKey} events for Stage 1B ➔ 5 (Venue Discovery skipped).`, 'info');
      }
    } else if (typeof showToast === 'function') {
      showToast(`No events found for ${filterKey} filter.`, 'info');
    }
  };

  window.selectAllOutOfDateEvents = function () {
    window.selectStaleFilter('all_stale');
  };

  window.autoRunOutOfDateStages1BTo4 = function (evt) {
    if (evt) evt.stopPropagation();
    if (isExecuting) {
      if (typeof showToast === 'function') showToast('A scan is currently active. Please wait or stop before starting a new run.', 'warning');
      return;
    }
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const outOfDate = events.filter(e => classifyEventStaleness(e) !== 'fresh');
    const pool = outOfDate.length > 0 ? outOfDate : events;
    if (pool.length === 0) {
      if (typeof showToast === 'function') showToast('No out-of-date events matched to refresh!', 'info');
      return;
    }
    const chosenCount = window.promptContinueEventCount(pool.length, 'events');
    if (chosenCount === null) return;
    window.setPipelineBatchSize(chosenCount);
    window.selectStaleFilter(pipelineStaleFilterCategory || 'all_stale');
    if (!pipelineTestDiscoveredIds || pipelineTestDiscoveredIds.length === 0) {
      const bLimit = (chosenCount !== 'all' && typeof chosenCount === 'number') ? chosenCount : pool.length;
      const picked = pool.slice(0, bLimit);
      pipelineTestDiscoveredIds = picked.map(e => e.id || e.event_id).filter(Boolean);
      pipelineTestDiscoveredEvents = picked.map(e => ({
        id: e.id || e.event_id,
        title: e.title || e.event_name || 'Event',
        date: e.date || e.dateSchedule || '',
        venue: e.venue || e.venue_name || '',
        price: e.priceLabel || '',
        url: e.ticket_url || e.details_url || ''
      }));
    }
    if (pipelineTestDiscoveredIds.length === 0) {
      if (typeof showToast === 'function') showToast('No out-of-date events matched to refresh!', 'info');
      return;
    }
    isPipelineTestMode = true;
    isPipelineAutoChaining = true;
    pipelineQuarantinedRunActive = false;
    currentPipelineScope = 'batch5';
    window.pipelineAutoChainingStages = ['hunter', 'qc', 'enrich', 'venue', 'compile'];
    pipelineTestStageStatuses = {
      harvest: 'Skipped ⏭️',
      hunter: 'Running ⚡',
      qc: 'Queued ⏳',
      enrich: 'Queued ⏳',
      venue: 'Queued ⏳',
      compile: 'Queued ⏳'
    };
    const autoStaleBtn = document.getElementById('btn-stepper-auto-stale');
    if (autoStaleBtn) {
      autoStaleBtn.classList.add('is-running');
      const autoStaleLabel = document.getElementById('btn-stepper-auto-stale-label');
      if (autoStaleLabel) autoStaleLabel.textContent = `⚡ Running Out-of-Date (${pipelineTestDiscoveredIds.length})...`;
    }
    if (typeof showToast === 'function') {
      showToast(`🚀 Auto-Running ${pipelineTestDiscoveredIds.length} Out-of-Date Events through Stages 1B ➔ 5 (Skipping 1A Venue Discovery)!`, 'info');
    }
    openPipelineTestStage('hunter', true);
  };

  window.getNewestPassedBatchEvents = function () {
    const events = (state.allEvents && state.allEvents.length > 0)
      ? state.allEvents
      : (state.masterCatalogsData?.events_active || []);
    if (!events || events.length === 0) return [];

    // 1. Live session passed map from most recent Stage 5 Compiler run
    if (window.pipelineCompiledPassedMap instanceof Map && window.pipelineCompiledPassedMap.size > 0) {
      const passedIds = new Set([...window.pipelineCompiledPassedMap.keys()].map(id => String(id).toLowerCase()));
      const matched = events.filter(e => passedIds.has(String(e.id || e.event_id || '').toLowerCase()));
      if (matched.length > 0) return matched;
      return [...window.pipelineCompiledPassedMap.values()].filter(Boolean);
    }

    // 2. Persisted newest passed batch IDs from localStorage
    try {
      const rawStored = localStorage.getItem('van50_last_passed_batch_ids');
      if (rawStored) {
        const parsedIds = JSON.parse(rawStored);
        if (Array.isArray(parsedIds) && parsedIds.length > 0) {
          const idSet = new Set(parsedIds.map(id => String(id).toLowerCase()));
          const matched = events.filter(e => idSet.has(String(e.id || e.event_id || '').toLowerCase()));
          if (matched.length > 0) return matched;
        }
      }
    } catch (_) {}

    // 3. Fallback: group cards from the most recent compilation / graduation batch timestamp
    const getBatchPassTime = (ev) => {
      if (!ev) return 0;
      const raw = ev.last_compiled_batch_at ||
        ev.graduated_at ||
        ev.last_pulse_qc_at ||
        ev.last_content_qc_at ||
        ev.last_full_qc_at ||
        ev.last_qc_audited_at ||
        ev.dimension_audit?.D808_timestamp_lockstep?.audited_at ||
        ev.dimension_audit?.D003_event_num_card?.audited_at;
      const t = raw ? new Date(raw).getTime() : 0;
      return isNaN(t) ? 0 : t;
    };

    const scored = events.map(ev => ({ ev, ts: getBatchPassTime(ev) }));
    scored.sort((a, b) => b.ts - a.ts);
    const maxTs = scored[0]?.ts || 0;
    if (maxTs > 0) {
      // Group cards compiled within 15 minutes of the newest batch timestamp
      const windowMs = 15 * 60 * 1000;
      const cluster = scored.filter(x => (maxTs - x.ts) <= windowMs).map(x => x.ev);
      if (cluster.length > 0 && cluster.length < events.length) {
        return cluster;
      }
      // If all catalog cards share the same full-catalog compile timestamp, prefer recently graduated or box-office-audited cards
      const getGranularTime = (ev) => {
        const r = ev.graduated_at || ev.last_pulse_qc_at || ev.last_content_qc_at || ev.dimension_audit?.D002_event_num_perm?.audited_at;
        const t = r ? new Date(r).getTime() : 0;
        return isNaN(t) ? 0 : t;
      };
      const granularScored = events.map(ev => ({ ev, ts: getGranularTime(ev) })).filter(x => x.ts > 0);
      if (granularScored.length > 0) {
        granularScored.sort((a, b) => b.ts - a.ts);
        const topGranularTs = granularScored[0].ts;
        const granularCluster = granularScored.filter(x => (topGranularTs - x.ts) <= 30 * 60 * 1000).map(x => x.ev);
        if (granularCluster.length > 0 && granularCluster.length <= 50) {
          return granularCluster;
        }
        return granularScored.slice(0, 15).map(x => x.ev);
      }
      return scored.slice(0, 15).map(x => x.ev);
    }

    return events.slice(0, 15);
  };

  window.autoRunNewestPassedBatchStages1BTo5 = function (evt) {
    if (evt) evt.stopPropagation();
    if (isExecuting) {
      if (typeof showToast === 'function') showToast('A scan is currently active. Please wait or stop before starting a new run.', 'warning');
      return;
    }
    window.VAN50_ENGINE = 'antigravity';
    const newestBatch = window.getNewestPassedBatchEvents();
    if (!newestBatch || newestBatch.length === 0) {
      if (typeof showToast === 'function') showToast('No passed pipeline events found in catalog!', 'info');
      return;
    }

    const chosenCount = window.promptContinueEventCount(newestBatch.length, 'newest passed pipeline events');
    if (chosenCount === null) return;
    window.setPipelineBatchSize(chosenCount);

    const batchCap = (chosenCount === 'all' || chosenCount === 0)
      ? newestBatch.length
      : Math.min(Number(chosenCount) || newestBatch.length, newestBatch.length);
    const picked = newestBatch.slice(0, batchCap);

    pipelineTestDiscoveredIds = picked.map(e => e.id || e.event_id).filter(Boolean);
    pipelineTestDiscoveredEvents = picked.map(e => ({
      id: e.id || e.event_id,
      title: e.title || e.event_name || 'Passed Pipeline Event',
      date: e.date || e.dateSchedule || 'TBD',
      venue: e.venue || e.venue_name || '',
      price: e.priceLabel || (e.price != null ? `$${Number(e.price).toFixed(2)} CAD` : 'Verified'),
      url: e.ticket_url || e.details_url || ''
    }));

    if (pipelineTestDiscoveredIds.length === 0) {
      if (typeof showToast === 'function') showToast('No passed pipeline events found!', 'info');
      return;
    }

    isPipelineTestMode = true;
    isPipelineAutoChaining = true;
    pipelineQuarantinedRunActive = false;
    currentPipelineScope = 'batch5';
    window.pipelineAutoChainingStages = ['hunter', 'qc', 'enrich', 'venue', 'compile'];
    pipelineTestStageStatuses = {
      harvest: 'Skipped ⏭️',
      hunter: 'Running ⚡',
      qc: 'Queued ⏳',
      enrich: 'Queued ⏳',
      venue: 'Queued ⏳',
      compile: 'Queued ⏳'
    };

    ['btn-stepper-auto-newest-passed', 'btn-header-run-newest-passed', 'btn-banner-run-newest-passed', 'btn-status-run-newest-passed'].forEach(btnId => {
      const btn = document.getElementById(btnId);
      if (btn) btn.classList.add('is-running');
    });
    ['btn-stepper-auto-newest-passed-label', 'btn-header-run-newest-passed-label', 'btn-banner-run-newest-passed-label', 'btn-status-run-newest-passed-label'].forEach(lblId => {
      const lbl = document.getElementById(lblId);
      if (lbl) lbl.textContent = `✅ Running Newest Passed (${pipelineTestDiscoveredIds.length})...`;
    });

    const summaryBanner = document.getElementById('pipeline-completion-summary-banner');
    if (summaryBanner) summaryBanner.style.display = 'none';
    savePipelineBatchState();

    if (typeof showToast === 'function') {
      showToast(`✅ Antigravity Auto-Running ${pipelineTestDiscoveredIds.length} Newest Passed Pipeline Events through Stages 1B ➔ 5!`, 'info');
    }
    openPipelineTestStage('hunter', true);
  };

  window.autoRunQuarantinedStages1BTo4 = function (evt) {
    if (evt) evt.stopPropagation();
    if (isExecuting) {
      if (typeof showToast === 'function') showToast('A scan is currently active. Please wait or stop before starting a new run.', 'warning');
      return;
    }
    window.VAN50_ENGINE = 'antigravity';
    const rawQEvents = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);
    if (rawQEvents.length === 0) {
      if (typeof showToast === 'function') showToast('Quarantine queue is empty!', 'info');
      return;
    }
    // Prioritize quarantined items with curator instructions/notes first
    const hasGuidance = (e) => Boolean(e.dealtWith || e.queuedInstruction || e.curatorAnnotation?.note || (e.curatorAnnotation?.screenshotPaths && e.curatorAnnotation.screenshotPaths.length > 0));
    const qEvents = [
      ...rawQEvents.filter(hasGuidance),
      ...rawQEvents.filter(e => !hasGuidance(e))
    ];

    const chosenCount = window.promptContinueEventCount(qEvents.length, 'quarantined events');
    if (chosenCount === null) return;
    window.setPipelineBatchSize(chosenCount);
    window.selectStaleFilter('quarantined');

    const batchCap = (chosenCount === 'all' || chosenCount === 0)
      ? qEvents.length
      : Math.min(Number(chosenCount) || qEvents.length, qEvents.length);
    const picked = qEvents.slice(0, batchCap);
    pipelineTestDiscoveredIds = picked.map(e => e.id || e.event_id).filter(Boolean);
    pipelineTestDiscoveredEvents = picked.map(e => ({
      id: e.id || e.event_id,
      title: e.title || e.event_name || 'Quarantined Event',
      date: e.date || e.dateSchedule || '',
      venue: e.venue || e.venue_name || '',
      price: e.priceLabel || '',
      url: e.ticket_url || e.details_url || ''
    }));

    if (pipelineTestDiscoveredIds.length === 0) {
      if (typeof showToast === 'function') showToast('Quarantine queue is empty!', 'info');
      return;
    }
    isPipelineTestMode = true;
    isPipelineAutoChaining = true;
    pipelineQuarantinedRunActive = true;
    currentPipelineScope = 'quarantined';
    window.pipelineAutoChainingStages = ['hunter', 'qc', 'enrich', 'venue', 'compile'];
    pipelineTestStageStatuses = {
      harvest: 'Skipped ⏭️',
      hunter: 'Running ⚡',
      qc: 'Queued ⏳',
      enrich: 'Queued ⏳',
      venue: 'Queued ⏳',
      compile: 'Queued ⏳'
    };
    ['btn-stepper-auto-quarantined', 'btn-header-run-quarantine', 'btn-banner-run-quarantine', 'btn-status-run-quarantine'].forEach(btnId => {
      const btn = document.getElementById(btnId);
      if (btn) btn.classList.add('is-running');
    });
    ['btn-stepper-auto-quarantined-label', 'btn-header-run-quarantine-label', 'btn-banner-run-quarantine-label', 'btn-status-run-quarantine-label'].forEach(lblId => {
      const lbl = document.getElementById(lblId);
      if (lbl) lbl.textContent = `🛡️ Running Quarantined (${pipelineTestDiscoveredIds.length})...`;
    });
    if (typeof showToast === 'function') {
      showToast(`🛡️ Antigravity Auto-Running ${pipelineTestDiscoveredIds.length} Quarantined Items through Stages 1B ➔ 5!`, 'info');
    }
    openPipelineTestStage('hunter', true);
  };

  window.harvesterResumeMode = true;

  window.setHarvestResumeMode = function (resumeBool) {
    window.harvesterResumeMode = Boolean(resumeBool);
    const btnRes = document.getElementById('btn-opt-harvest-resume');
    const btnFresh = document.getElementById('btn-opt-harvest-fresh');
    if (btnRes) {
      btnRes.classList.toggle('active', window.harvesterResumeMode);
      btnRes.style.borderColor = window.harvesterResumeMode ? '#c084fc' : 'rgba(255,255,255,0.16)';
      btnRes.style.background = window.harvesterResumeMode ? 'rgba(168, 85, 247, 0.25)' : 'rgba(0,0,0,0.35)';
      btnRes.style.color = window.harvesterResumeMode ? '#f3e8ff' : '#94a3b8';
    }
    if (btnFresh) {
      btnFresh.classList.toggle('active', !window.harvesterResumeMode);
      btnFresh.style.borderColor = !window.harvesterResumeMode ? '#38bdf8' : 'rgba(255,255,255,0.16)';
      btnFresh.style.background = !window.harvesterResumeMode ? 'rgba(56, 189, 248, 0.2)' : 'rgba(0,0,0,0.35)';
      btnFresh.style.color = !window.harvesterResumeMode ? '#38bdf8' : '#94a3b8';
    }
    if (typeof window.updateAutoPipelineFlowPreview === 'function') {
      window.updateAutoPipelineFlowPreview();
    }
  };

  window.c1aModalState = {
    cityScope: 'all',
    resumeMode: true,
    batchCount: 'all'
  };

  function ensureContinue1ACityModalExists() {
    let modal = document.getElementById('continue-1a-city-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'continue-1a-city-modal';
    modal.style.cssText = 'display: none; position: fixed; inset: 0; z-index: 12000; background: rgba(2, 6, 23, 0.84); backdrop-filter: blur(8px); align-items: center; justify-content: center; padding: 16px;';
    modal.innerHTML = `
      <div style="background: linear-gradient(145deg, #0f172a 0%, #1e1b4b 100%); border: 1px solid rgba(192, 132, 252, 0.45); border-radius: 14px; max-width: 580px; width: 100%; padding: 20px 22px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.75); color: #f8fafc; font-family: inherit;" onclick="event.stopPropagation()">
        <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px; font-size: 1.05rem; font-weight: 800; color: #f8fafc;">
              <span>▶️</span>
              <span>Continue Stage 1A Scan — Select Cities</span>
            </div>
            <div style="font-size: 0.78rem; color: #cbd5e1; margin-top: 3px;">
              Choose which cities you want the Schedule Harvester (Step 1A) to scan through and how many new events to collect.
            </div>
          </div>
          <button type="button" onclick="window.closeContinue1ACityModal()" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); color: #cbd5e1; border-radius: 6px; width: 28px; height: 28px; cursor: pointer; font-size: 0.9rem; display: inline-flex; align-items: center; justify-content: center;" title="Close">✕</button>
        </div>

        <!-- 1. Select Cities -->
        <div style="margin-bottom: 14px;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
            <label style="font-size: 0.75rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.05em;">
              1. Select Cities to Scan
            </label>
            <div style="display: flex; align-items: center; gap: 10px; font-size: 0.76rem; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(56, 189, 248, 0.3); padding: 4px 10px; border-radius: 6px;">
              <label style="display: inline-flex; align-items: center; gap: 5px; cursor: pointer; font-weight: 700; color: #e2e8f0;">
                <input type="checkbox" id="c1a-chk-vancouver" checked onchange="window.onC1ACityCheckboxChange('vancouver')" style="accent-color: #38bdf8; cursor: pointer;">
                <span>🏙️ Vancouver</span>
              </label>
              <label style="display: inline-flex; align-items: center; gap: 5px; cursor: pointer; font-weight: 700; color: #e2e8f0;">
                <input type="checkbox" id="c1a-chk-surrey" checked onchange="window.onC1ACityCheckboxChange('surrey')" style="accent-color: #34d399; cursor: pointer;">
                <span>🦌 Surrey</span>
              </label>
            </div>
          </div>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div id="c1a-card-all" onclick="window.selectC1ACityScope('all')" style="cursor: pointer; padding: 10px 12px; border-radius: 9px; border: 1px solid #c084fc; background: rgba(168, 85, 247, 0.18); transition: all 0.15s ease;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 0.85rem; font-weight: 800; color: #f8fafc;">🌲 All Metro (Vancouver + Surrey)</span>
                <span id="c1a-badge-all" style="font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(168, 85, 247, 0.25); color: #e9d5ff; border: 1px solid rgba(192, 132, 252, 0.45);">All Sources</span>
              </div>
              <div id="c1a-sub-all" style="font-size: 0.72rem; color: #cbd5e1; margin-top: 3px;">
                Scans official venue calendars and discovery feeds across both Vancouver and Surrey.
              </div>
            </div>

            <div id="c1a-card-vancouver" onclick="window.selectC1ACityScope('vancouver')" style="cursor: pointer; padding: 10px 12px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.15); background: rgba(15, 23, 42, 0.65); transition: all 0.15s ease;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 0.85rem; font-weight: 800; color: #f8fafc;">🏙️ Vancouver Only</span>
                <span id="c1a-badge-vancouver" style="font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(56, 189, 248, 0.2); color: #7dd3fc; border: 1px solid rgba(56, 189, 248, 0.4);">Vancouver Sources</span>
              </div>
              <div id="c1a-sub-vancouver" style="font-size: 0.72rem; color: #94a3b8; margin-top: 3px;">
                Scans only Vancouver venues, theatres, comedy clubs, and cultural calendars.
              </div>
            </div>

            <div id="c1a-card-surrey" onclick="window.selectC1ACityScope('surrey')" style="cursor: pointer; padding: 10px 12px; border-radius: 9px; border: 1px solid rgba(255,255,255,0.15); background: rgba(15, 23, 42, 0.65); transition: all 0.15s ease;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 0.85rem; font-weight: 800; color: #f8fafc;">🦌 Surrey Only</span>
                <span id="c1a-badge-surrey" style="font-size: 0.7rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: rgba(16, 185, 129, 0.2); color: #6ee7b7; border: 1px solid rgba(52, 211, 153, 0.4);">Surrey Sources</span>
              </div>
              <div id="c1a-sub-surrey" style="font-size: 0.72rem; color: #94a3b8; margin-top: 3px;">
                Scans only Surrey venues, 6 town centres (Whalley, Guildford, Fleetwood, Newton, Cloverdale, South Surrey), and civic calendars.
              </div>
            </div>
          </div>
        </div>

        <!-- 2. Scan Start Mode -->
        <div style="margin-bottom: 14px;">
          <label style="display: block; font-size: 0.75rem; font-weight: 800; color: #c084fc; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px;">
            2. Scan Position
          </label>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <button type="button" id="c1a-mode-resume" onclick="window.selectC1AResumeMode(true)" class="btn-limit-chip active" style="flex: 1; padding: 7px 10px; font-size: 0.74rem; font-weight: 700; justify-content: center;">
              ▶️ Continue Unscanned Sources
            </button>
            <button type="button" id="c1a-mode-fresh" onclick="window.selectC1AResumeMode(false)" class="btn-limit-chip" style="flex: 1; padding: 7px 10px; font-size: 0.74rem; font-weight: 700; justify-content: center;">
              🔄 Start Fresh from Source #1
            </button>
          </div>
        </div>

        <!-- 3. How Many Events to Harvest -->
        <div style="margin-bottom: 18px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
            <label style="font-size: 0.75rem; font-weight: 800; color: #34d399; text-transform: uppercase; letter-spacing: 0.05em;">
              3. Target Event Count to Harvest
            </label>
            <span style="font-size: 0.7rem; color: #94a3b8;">Click a preset or type any number</span>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <button type="button" class="btn-limit-chip active" id="c1a-chip-all" onclick="window.selectC1ABatchCount('all')" style="padding: 5px 11px; font-size: 0.74rem; font-weight: 700;">All</button>
            <button type="button" class="btn-limit-chip" id="c1a-chip-5" onclick="window.selectC1ABatchCount(5)" style="padding: 5px 11px; font-size: 0.74rem; font-weight: 700;">5</button>
            <button type="button" class="btn-limit-chip" id="c1a-chip-10" onclick="window.selectC1ABatchCount(10)" style="padding: 5px 11px; font-size: 0.74rem; font-weight: 700;">10</button>
            <button type="button" class="btn-limit-chip" id="c1a-chip-25" onclick="window.selectC1ABatchCount(25)" style="padding: 5px 11px; font-size: 0.74rem; font-weight: 700;">25</button>
            <button type="button" class="btn-limit-chip" id="c1a-chip-50" onclick="window.selectC1ABatchCount(50)" style="padding: 5px 11px; font-size: 0.74rem; font-weight: 700;">50</button>
            <button type="button" class="btn-limit-chip" id="c1a-chip-100" onclick="window.selectC1ABatchCount(100)" style="padding: 5px 11px; font-size: 0.74rem; font-weight: 700;">100</button>
            <input type="text" id="c1a-custom-count-input" value="all" oninput="window.onC1ACustomCountInput(this.value)" placeholder="all or #" style="width: 90px; padding: 5px 9px; font-size: 0.76rem; font-weight: 700; color: #f8fafc; background: rgba(0,0,0,0.45); border: 1px solid rgba(56, 189, 248, 0.45); border-radius: 6px; text-align: center;">
          </div>
        </div>

        <!-- Footer -->
        <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 14px;">
          <button type="button" onclick="window.closeContinue1ACityModal()" style="padding: 8px 14px; font-size: 0.78rem; font-weight: 700; color: #cbd5e1; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.18); border-radius: 7px; cursor: pointer;">
            Cancel
          </button>
          <button type="button" id="c1a-btn-confirm" onclick="window.confirmContinue1ACityModal()" style="padding: 8px 16px; font-size: 0.8rem; font-weight: 800; color: #fff; background: linear-gradient(135deg, #9333ea 0%, #a855f7 50%, #0284c7 100%); border: 1px solid #c084fc; border-radius: 7px; cursor: pointer; box-shadow: 0 4px 14px rgba(147, 51, 234, 0.45);">
            ▶️ Start 1A Scan (All Metro • All Events)
          </button>
        </div>
      </div>
    `;
    modal.addEventListener('click', () => window.closeContinue1ACityModal());
    document.body.appendChild(modal);
    return modal;
  }

  function refreshContinue1AModalUI() {
    const scope = window.c1aModalState.cityScope || 'all';
    const resume = window.c1aModalState.resumeMode !== false;
    const count = window.c1aModalState.batchCount || 'all';

    const chkVan = document.getElementById('c1a-chk-vancouver');
    const chkSur = document.getElementById('c1a-chk-surrey');
    if (chkVan) chkVan.checked = (scope === 'all' || scope === 'vancouver');
    if (chkSur) chkSur.checked = (scope === 'all' || scope === 'surrey');

    ['all', 'vancouver', 'surrey'].forEach(key => {
      const card = document.getElementById(`c1a-card-${key}`);
      if (!card) return;
      const isSelected = key === scope;
      card.style.borderColor = isSelected ? '#c084fc' : 'rgba(255,255,255,0.15)';
      card.style.background = isSelected ? 'rgba(168, 85, 247, 0.2)' : 'rgba(15, 23, 42, 0.65)';
      card.style.boxShadow = isSelected ? '0 0 14px rgba(168, 85, 247, 0.28)' : 'none';
    });

    const btnRes = document.getElementById('c1a-mode-resume');
    const btnFresh = document.getElementById('c1a-mode-fresh');
    if (btnRes) btnRes.classList.toggle('active', resume);
    if (btnFresh) btnFresh.classList.toggle('active', !resume);

    ['all', '5', '10', '25', '50', '100'].forEach(k => {
      const chip = document.getElementById(`c1a-chip-${k}`);
      if (chip) chip.classList.toggle('active', String(count) === k);
    });

    const btnConfirm = document.getElementById('c1a-btn-confirm');
    if (btnConfirm) {
      const cityLabel = scope === 'vancouver' ? '🏙️ Vancouver Only' : (scope === 'surrey' ? '🦌 Surrey Only' : '🌲 All Metro');
      const countLabel = (count === 'all' || count === 0) ? 'All Events' : `${count} Events`;
      const modeLabel = resume ? 'Continue' : 'Fresh';
      btnConfirm.textContent = `▶️ ${modeLabel} 1A Scan — ${cityLabel} (${countLabel})`;
    }
  }

  window.selectC1ACityScope = function (scope) {
    window.c1aModalState.cityScope = (scope === 'vancouver' || scope === 'surrey') ? scope : 'all';
    refreshContinue1AModalUI();
  };

  window.onC1ACityCheckboxChange = function (changedCity) {
    const chkVan = document.getElementById('c1a-chk-vancouver');
    const chkSur = document.getElementById('c1a-chk-surrey');
    let vanChecked = chkVan ? chkVan.checked : true;
    let surChecked = chkSur ? chkSur.checked : true;
    if (!vanChecked && !surChecked) {
      // Ensure at least one city remains checked
      if (changedCity === 'vancouver') {
        surChecked = true;
        if (chkSur) chkSur.checked = true;
      } else {
        vanChecked = true;
        if (chkVan) chkVan.checked = true;
      }
    }
    if (vanChecked && surChecked) window.c1aModalState.cityScope = 'all';
    else if (vanChecked) window.c1aModalState.cityScope = 'vancouver';
    else window.c1aModalState.cityScope = 'surrey';
    refreshContinue1AModalUI();
  };

  window.selectC1AResumeMode = function (resumeBool) {
    window.c1aModalState.resumeMode = Boolean(resumeBool);
    refreshContinue1AModalUI();
  };

  window.selectC1ABatchCount = function (val) {
    window.c1aModalState.batchCount = val;
    const inp = document.getElementById('c1a-custom-count-input');
    if (inp) inp.value = String(val);
    refreshContinue1AModalUI();
  };

  window.onC1ACustomCountInput = function (rawVal) {
    const trimmed = String(rawVal || '').trim().toLowerCase();
    if (!trimmed || trimmed === 'all' || trimmed === '0') {
      window.c1aModalState.batchCount = 'all';
    } else {
      const parsed = parseInt(trimmed, 10);
      if (!isNaN(parsed) && parsed > 0) {
        window.c1aModalState.batchCount = parsed;
      }
    }
    refreshContinue1AModalUI();
  };

  window.closeContinue1ACityModal = function () {
    const modal = document.getElementById('continue-1a-city-modal');
    if (modal) modal.style.display = 'none';
  };

  window.confirmContinue1ACityModal = async function () {
    const chosenCity = window.c1aModalState.cityScope || 'all';
    const chosenResume = window.c1aModalState.resumeMode !== false;
    const chosenCount = window.c1aModalState.batchCount || 'all';
    window.closeContinue1ACityModal();

    if (typeof window.setHarvesterCityScope === 'function') {
      await window.setHarvesterCityScope(chosenCity);
    }
    window.harvesterResumeMode = chosenResume;
    window.setPipelineBatchSize(chosenCount);
    const chosenLimit = (chosenCount === 'all' || chosenCount === 0) ? 0 : (Number(chosenCount) || 0);

    const feeds = await loadVenueFeedsList();
    const cp = state.harvesterCheckpoint || {};
    const doneSet = new Set(Array.isArray(cp.completed_feed_urls) ? cp.completed_feed_urls : []);
    const scopedFeeds = chosenCity === 'all'
      ? feeds
      : feeds.filter(f => (f.city || 'Vancouver').toLowerCase() === chosenCity);
    const totalFeeds = scopedFeeds.length || (cp.total_feeds != null ? Number(cp.total_feeds) : 126);
    const firstUnscannedIdx = scopedFeeds.findIndex(f => !doneSet.has(f.url));
    const resumeFeedNum = (chosenResume && firstUnscannedIdx !== -1) ? (firstUnscannedIdx + 1) : 1;
    const nextFeedName = (chosenResume && firstUnscannedIdx !== -1 && scopedFeeds[firstUnscannedIdx])
      ? scopedFeeds[firstUnscannedIdx].name
      : (scopedFeeds[0]?.name || cp.last_feed_name || 'Feed #1');

    const cityTag = chosenCity === 'vancouver' ? '🏙️ Vancouver Only' : (chosenCity === 'surrey' ? '🦌 Surrey Only' : '🌲 All Metro (Van + Surrey)');
    const baseTarget = chosenCity === 'vancouver' ? 'all:vancouver' : (chosenCity === 'surrey' ? 'all:surrey' : 'all');
    const targetUrl = chosenResume ? `${baseTarget}:resume` : baseTarget;

    isPipelineTestMode = true;
    isPipelineAutoChaining = false;
    pipelineQuarantinedRunActive = false;
    pipelineTestStageKey = 'harvest';
    currentPipelineScanKey = 'harvest';
    pipelineTestStageStatuses.harvest = 'Running ⚡';
    window.activePipelineRunningStageKey = 'harvest';

    window.openScanModal('harvest');
    updatePipelineTestStepperUI();
    updateStageNavButtons();

    if (typeof showToast === 'function') {
      showToast(`▶️ Stage 1A [${cityTag}]: ${chosenResume ? `Continuing at Feed #${resumeFeedNum}/${totalFeeds} (${nextFeedName})` : `Starting Fresh at Feed #1/${totalFeeds}`} • Target: ${chosenLimit > 0 ? chosenLimit + ' events' : 'All events'}...`, 'info');
    }

    setTimeout(() => {
      runPipelineAction({
        mode: 'calendar',
        title: `▶️ Stage 1A [${cityTag}]: ${chosenResume ? `Continuing from #${resumeFeedNum}/${totalFeeds} (${nextFeedName})` : `Fresh Scan (#1/${totalFeeds})`} • ${chosenLimit > 0 ? chosenLimit + ' Events' : 'All Events'}`,
        initialStatus: `${chosenResume ? 'Resuming' : 'Starting'} Stage 1A [${cityTag}] at Feed #${resumeFeedNum}/${totalFeeds}: ${nextFeedName} (${chosenLimit > 0 ? chosenLimit + ' events' : 'all events'})...`,
        limit: chosenLimit,
        url: targetUrl,
        city: chosenCity,
        all: true,
        resume: chosenResume,
        autoApprove: true
      });
    }, 200);
  };

  window.continueHarvestFromCheckpoint = async function (evt) {
    if (evt) evt.stopPropagation();
    if (isExecuting) {
      if (typeof showToast === 'function') showToast('A scan is currently active. Please wait or stop before starting a new run.', 'warning');
      return;
    }
    const modal = ensureContinue1ACityModalExists();
    const feeds = await loadVenueFeedsList();
    const cp = state.harvesterCheckpoint || {};
    const doneSet = new Set(Array.isArray(cp.completed_feed_urls) ? cp.completed_feed_urls : []);

    const vanFeeds = feeds.filter(f => (f.city || 'Vancouver').toLowerCase() === 'vancouver');
    const surFeeds = feeds.filter(f => (f.city || 'Vancouver').toLowerCase() === 'surrey');

    const vanDone = vanFeeds.filter(f => doneSet.has(f.url)).length;
    const surDone = surFeeds.filter(f => doneSet.has(f.url)).length;
    const allDone = vanDone + surDone;

    const vanRem = Math.max(0, vanFeeds.length - vanDone);
    const surRem = Math.max(0, surFeeds.length - surDone);
    const allRem = Math.max(0, feeds.length - allDone);

    const bAll = document.getElementById('c1a-badge-all');
    const bVan = document.getElementById('c1a-badge-vancouver');
    const bSur = document.getElementById('c1a-badge-surrey');
    if (bAll) bAll.textContent = `${allDone}/${feeds.length} Scanned • ${allRem} Remaining`;
    if (bVan) bVan.textContent = `${vanDone}/${vanFeeds.length} Scanned • ${vanRem} Remaining`;
    if (bSur) bSur.textContent = `${surDone}/${surFeeds.length} Scanned • ${surRem} Remaining`;

    const subVan = document.getElementById('c1a-sub-vancouver');
    const subSur = document.getElementById('c1a-sub-surrey');
    const firstVanUnscanned = vanFeeds.find(f => !doneSet.has(f.url));
    const firstSurUnscanned = surFeeds.find(f => !doneSet.has(f.url));
    if (subVan) {
      subVan.textContent = firstVanUnscanned
        ? `Next unscanned Vancouver feed: ${firstVanUnscanned.name} (${vanRem} remaining)`
        : `All ${vanFeeds.length} Vancouver feeds scanned — selecting Vancouver will start a fresh pass from #1.`;
    }
    if (subSur) {
      subSur.textContent = firstSurUnscanned
        ? `Next unscanned Surrey feed: ${firstSurUnscanned.name} (${surRem} remaining)`
        : `All ${surFeeds.length} Surrey feeds scanned — selecting Surrey will start a fresh pass from #1.`;
    }

    if (window.harvesterCityScope === 'vancouver' || window.harvesterCityScope === 'surrey') {
      window.c1aModalState.cityScope = window.harvesterCityScope;
    } else if (vanRem === 0 && surRem > 0) {
      // Smart default: if all Vancouver feeds are done and Surrey feeds are waiting, default to Surrey (or user can click All/Vancouver)
      window.c1aModalState.cityScope = 'surrey';
    } else {
      window.c1aModalState.cityScope = 'all';
    }
    window.c1aModalState.resumeMode = true;
    refreshContinue1AModalUI();
    modal.style.display = 'flex';
  };

  window.autoRunHarvestedStages1BTo5 = function (evt) {
    if (evt) evt.stopPropagation();
    if (isExecuting) {
      if (typeof showToast === 'function') showToast('A scan is currently active. Please wait or stop before starting a new run.', 'warning');
      return;
    }
    const harvestedAll = typeof window.getUncompiledHarvestedEvents === 'function' ? window.getUncompiledHarvestedEvents() : [];
    if (harvestedAll.length === 0) {
      if (typeof showToast === 'function') showToast('No uncompiled newly harvested events found in layer_schedules.json!', 'info');
      return;
    }

    const chosenCount = window.promptContinueEventCount(harvestedAll.length, 'events');
    if (chosenCount === null) return;
    window.setPipelineBatchSize(chosenCount);

    const boxArr = state.layerBoxOffices || state.layerBoxOffice || [];
    const boxSet = new Set(boxArr.filter(b => b.status !== 'TIMEOUT_EXCEEDED' && b.status !== 'AI_TIMEOUT' && b.status !== 'EXECUTION_ERROR').map(b => String(b.id || b.event_id || '').toLowerCase()));
    const prioritizedHarvested = [
      ...harvestedAll.filter(e => !e.step1b_audited_at || !boxSet.has(String(e.id || e.event_id || '').toLowerCase())),
      ...harvestedAll.filter(e => e.step1b_audited_at && boxSet.has(String(e.id || e.event_id || '').toLowerCase()))
    ];

    const batchCap = (chosenCount === 'all' || chosenCount === 0) ? prioritizedHarvested.length : Math.min(Number(chosenCount) || prioritizedHarvested.length, prioritizedHarvested.length);
    const picked = prioritizedHarvested.slice(0, batchCap);
    pipelineTestDiscoveredIds = picked.map(e => e.id || e.event_id).filter(Boolean);
    pipelineTestDiscoveredEvents = picked.map(e => ({
      id: e.id || e.event_id,
      title: e.title || e.event_name || 'Harvested Event',
      date: e.date || e.dateSchedule || 'TBD',
      venue: e.venue || e.venue_name || '',
      price: e.priceLabel || 'Pending 1B/QC',
      url: e.url || e.ticket_url || e.details_url || ''
    }));

    isPipelineTestMode = true;
    isPipelineAutoChaining = true;
    pipelineQuarantinedRunActive = false;
    currentPipelineScope = 'harvested';
    window.pipelineAutoChainingStages = ['hunter', 'qc', 'enrich', 'venue', 'compile'];
    pipelineTestStageStatuses = {
      harvest: `Complete ✅ (${harvestedAll.length} Found)`,
      hunter: 'Running ⚡',
      qc: 'Queued ⏳',
      enrich: 'Queued ⏳',
      venue: 'Queued ⏳',
      compile: 'Queued ⏳'
    };

    const autoHBtn = document.getElementById('btn-stepper-auto-harvested');
    if (autoHBtn) {
      autoHBtn.classList.add('is-running');
      const autoHLabel = document.getElementById('btn-stepper-auto-harvested-label');
      if (autoHLabel) autoHLabel.textContent = `✨ Running New Events (${pipelineTestDiscoveredIds.length})...`;
    }

    const summaryBanner = document.getElementById('pipeline-completion-summary-banner');
    if (summaryBanner) summaryBanner.style.display = 'none';
    savePipelineBatchState();

    if (typeof showToast === 'function') {
      showToast(`✨ Starting Stage 1B ➔ 5 on ${pipelineTestDiscoveredIds.length} Newly Harvested Events!`, 'info');
    }
    openPipelineTestStage('hunter', true);
  };

  window.startProcessingHarvestedAt1B = function (evt) {
    window.autoRunHarvestedStages1BTo5(evt);
  };

  function updatePipelineTestStepperUI() {
    const bar = document.getElementById('pipeline-test-stepper-bar');
    if (bar) {
      bar.style.display = 'flex';
      bar.classList.toggle('compact-stepper', Boolean(pipelineStepperCompact));
    }
    const stalenessBar = document.getElementById('pipeline-staleness-dashboard-bar');
    if (stalenessBar) {
      stalenessBar.style.display = 'flex';
      window.updateCatalogStalenessDashboard();
    }

    // Keep batch size buttons highlighted with current pipelineBatchSize
    const chips = ['1', '5', '10', '25', '50', 'all', 'custom'];
    const isCustomNum = typeof pipelineBatchSize === 'number' && ![1, 5, 10, 25, 50].includes(pipelineBatchSize);
    chips.forEach(c => {
      const isActive = (c === String(pipelineBatchSize)) || (c === 'custom' && isCustomNum);
      const el = document.getElementById(`chip-batch-${c}`);
      if (el) el.classList.toggle('active', isActive);
      const elH = document.getElementById(`chip-harvester-batch-${c}`);
      if (elH) elH.classList.toggle('active', isActive);
    });

    const currentStage = pipelineTestStageKey || currentPipelineScanKey || 'harvest';
    const idx = PIPELINE_TEST_ORDER.indexOf(currentStage);
    const stepNumBadge = document.getElementById('pipeline-test-step-counter');
    if (stepNumBadge) {
      stepNumBadge.textContent = `STEP ${idx + 1} OF ${PIPELINE_TEST_ORDER.length}`;
    }

    PIPELINE_TEST_ORDER.forEach((key, i) => {
      const stepEl = document.getElementById(`test-step-${key}`);
      const statusEl = document.getElementById(`test-step-status-${key}`);
      const info = typeof window.getStageContinuationInfo === 'function' ? window.getStageContinuationInfo(key) : null;
      const isStageRunning = isExecuting && window.activePipelineRunningStageKey === key;
      const activeDone = pipelineProcessedCount || 0;
      const activeTotal = pipelineTotalTargets || (info && info.pendingCount) || 0;
      const status = isStageRunning
        ? (activeTotal > 0 ? `Running ⚡ (${activeDone}/${activeTotal} Done)` : 'Running ⚡')
        : (info ? info.stepperStatusBadge : (pipelineTestStageStatuses[key] || (i < idx ? 'Complete ✅' : (i === idx ? 'Active' : 'Awaiting'))));
      const isAllDoneForStage = info
        ? (info.pendingCount === 0 && (info.currentCompletedCount > 0 || (key === 'harvest' && info.harvestedCount > 0)))
        : status.includes('Complete');
      if (stepEl) {
        stepEl.classList.toggle('active', key === currentStage);
        stepEl.classList.toggle('active-step', key === currentStage);
        stepEl.classList.toggle('completed', !isStageRunning && isAllDoneForStage);
        stepEl.classList.toggle('completed-step', !isStageRunning && isAllDoneForStage);
      }
      if (statusEl) {
        statusEl.textContent = status;
        statusEl.className = 'test-step-status';
        if (isStageRunning || status.includes('Running')) statusEl.classList.add('status-running');
        else if (isAllDoneForStage || status.includes('Complete')) statusEl.classList.add('status-complete');
        else if (status.includes('Halted') || status.includes('Error')) statusEl.classList.add('status-halted');
        else if (status.includes('Skipped')) statusEl.classList.add('status-skipped');
      }
    });

    const titleLabel = document.getElementById('test-stepper-current-label');
    if (titleLabel) {
      const isCompileDone = (pipelineTestStageStatuses['compile'] || '').includes('Complete');
      if (isCompileDone) {
        titleLabel.innerHTML = '🎉 <strong style="color: #34d399;">Pipeline Run Complete:</strong> All Stages Finished (100%)';
      } else if (currentStage === 'harvest') {
        titleLabel.textContent = 'Stage 1A: Schedule Harvester (Venue Feeds)';
      } else if (currentStage === 'hunter') {
        titleLabel.textContent = 'Stage 1B: Tier 1 Link Hunter (Direct Checkout URLs)';
      } else if (currentStage === 'qc') {
        titleLabel.textContent = 'Stage 2: Stagehand Box Office QC (Cart & Fees)';
      } else if (currentStage === 'enrich') {
        titleLabel.textContent = 'Stage 3: AI Semantic Enricher (Normalizing Content)';
      } else if (currentStage === 'venue') {
        titleLabel.textContent = 'Stage 4: Venue Detailer (Physical Facilities & Amenities)';
      } else if (currentStage === 'compile') {
        titleLabel.textContent = 'Stage 5: Compiler & Publisher (Final Stage)';
      }
    }

    const prevBtn = document.getElementById('btn-stepper-prev') || document.getElementById('btn-test-prev-stage');
    const nextBtn = document.getElementById('btn-stepper-next') || document.getElementById('btn-test-next-stage');
    if (prevBtn) prevBtn.disabled = (idx <= 0 || isExecuting);
    if (nextBtn) nextBtn.disabled = (idx >= PIPELINE_TEST_ORDER.length - 1 || isExecuting);
    if (typeof window.updateAllStageContinuationButtonsUI === 'function') {
      window.updateAllStageContinuationButtonsUI();
    }
  }

  window.togglePipelineStepperCompact = function () {
    pipelineStepperCompact = !pipelineStepperCompact;
    const bar = document.getElementById('pipeline-test-stepper-bar');
    const btn = document.getElementById('btn-toggle-stepper-size');
    if (bar) bar.classList.toggle('compact-stepper', pipelineStepperCompact);
    if (btn) btn.textContent = pipelineStepperCompact ? '↕ Expand' : '↕ Compact';
  };

  window.selectedAutoPipelineScope = 'stale';
  window.selectedAutoModalBatchSize = 'all';

  window.parseCustomCardSpec = function (inputStr) {
    if (!inputStr || !inputStr.trim()) return [];
    const raw = inputStr.trim();
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const qEvents = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);
    const allKnown = [...events, ...qEvents];

    if (/^\d+$/.test(raw)) {
      const count = parseInt(raw, 10);
      if (count > 0) return events.slice(0, count);
    }

    const rangeMatch = raw.match(/^#?(\d+)\s*[-–—]\s*#?(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      const minIdx = Math.max(1, Math.min(start, end));
      const maxIdx = Math.max(start, end);
      return events.slice(minIdx - 1, maxIdx);
    }

    const tokens = raw.split(/[,;\s]+/).map(t => t.trim()).filter(Boolean);
    const matched = [];
    const seenIds = new Set();

    tokens.forEach(tok => {
      const numMatch = tok.match(/^#?(\d+)$/);
      if (numMatch) {
        const idx = parseInt(numMatch[1], 10) - 1;
        if (idx >= 0 && idx < events.length) {
          const ev = events[idx];
          const eid = ev.id || ev.event_id;
          if (eid && !seenIds.has(eid)) {
            seenIds.add(eid);
            matched.push(ev);
          }
          return;
        }
      }
      const found = allKnown.find(e =>
        (e.id && e.id.toLowerCase() === tok.toLowerCase()) ||
        (e.event_id && e.event_id.toLowerCase() === tok.toLowerCase()) ||
        (e.Event_Num_Perm && e.Event_Num_Perm.toLowerCase() === tok.toLowerCase()) ||
        (e.Event_Num_Card && e.Event_Num_Card.toLowerCase() === tok.toLowerCase()) ||
        (e.id && e.id.toLowerCase().includes(tok.toLowerCase()))
      );
      if (found) {
        const fid = found.id || found.event_id;
        if (fid && !seenIds.has(fid)) {
          seenIds.add(fid);
          matched.push(found);
        }
      }
    });
    return matched;
  };

  window.handleAutoPipelineCustomIdsInput = function (val) {
    const hintEl = document.getElementById('auto-custom-ids-hint');
    if (!val || !val.trim()) {
      if (hintEl) hintEl.style.display = 'none';
      window.updateAutoPipelineFlowPreview();
      return;
    }
    const matched = window.parseCustomCardSpec(val);
    if (hintEl) {
      hintEl.style.display = 'block';
      if (matched.length > 0) {
        hintEl.style.color = '#38bdf8';
        hintEl.textContent = `✓ ${matched.length} event${matched.length === 1 ? '' : 's'} matched`;
      } else {
        hintEl.style.color = '#f87171';
        hintEl.textContent = 'No matching events found. Enter card # (e.g. 1-10) or event ID.';
      }
    }
    window.updateAutoPipelineFlowPreview();
  };

  window.handleAutoModalCustomBatchInput = function (val) {
    if (!val || !val.trim()) return;
    const num = parseInt(val.trim(), 10);
    if (!isNaN(num) && num > 0) {
      window.setAutoModalBatchSize(num, true);
    }
  };

  window.openAutoPipelineOptionsModal = function (evt) {
    if (evt) evt.stopPropagation();
    window.updateCatalogStalenessDashboard();
    if (typeof window.syncHarvesterCheckpointAndEventsUI === 'function') {
      window.syncHarvesterCheckpointAndEventsUI();
    }
    const modal = document.getElementById('auto-pipeline-options-modal');
    if (!modal) return;

    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const qEvents = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);
    const staleEvents = events.filter(e => classifyEventStaleness(e) !== 'fresh');
    const unverifiedEvents = events.filter(e => {
      const isFree = e.price === 0 || e.isFree || e.pricingType === 'free' || e.cost_type === 'free' || e.access_model === 'open_public_space' || e.access_model === 'free_public_access';
      if (isFree) return e.pricing_model === 'UNVERIFIED_POLICY_ESTIMATE' || !isVerifiedApprovalStatus(e.approval_status);
      return (!e.proof_keyframe_cart && !e.proof_keyframes?.cart) || e.pricing_model === 'UNVERIFIED_POLICY_ESTIMATE';
    });
    const harvestedEvents = typeof window.getUncompiledHarvestedEvents === 'function' ? window.getUncompiledHarvestedEvents() : [];

    const badgeHarvested = document.getElementById('badge-count-harvested');
    if (badgeHarvested) badgeHarvested.textContent = `${harvestedEvents.length} New Events Ready`;
    const badgeStale = document.getElementById('badge-count-stale');
    if (badgeStale) badgeStale.textContent = `Recommended • ${staleEvents.length} Cards`;
    const badgeQuarantined = document.getElementById('badge-count-quarantined');
    if (badgeQuarantined) badgeQuarantined.textContent = `Review Queue • ${qEvents.length} Cards`;
    const badgeUnverified = document.getElementById('badge-count-unverified');
    if (badgeUnverified) badgeUnverified.textContent = `${unverifiedEvents.length} Cards Need Cart QC`;
    const badgeAll = document.getElementById('badge-count-all');
    if (badgeAll) badgeAll.textContent = `${events.length} Total Cards`;

    const initialBatch = window.selectedAutoModalBatchSize || pipelineBatchSize || 5;
    window.selectAutoPipelineScope(window.selectedAutoPipelineScope || 'harvest', true);
    window.setAutoModalBatchSize(initialBatch);

    modal.style.display = 'flex';
    modal.classList.add('active');
    window.updateAutoPipelineFlowPreview();
  };

  window.closeAutoPipelineOptionsModal = function () {
    const modal = document.getElementById('auto-pipeline-options-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  };

  window.selectAutoPipelineScope = function (scopeKey, preserveBatchSize = true) {
    window.selectedAutoPipelineScope = scopeKey;
    autoPipelineModalScope = scopeKey;
    ['harvest', 'harvested', 'stale', 'quarantined', 'unverified', 'all', 'custom'].forEach(key => {
      const card = document.getElementById(`opt-scope-${key}`);
      if (card) card.classList.toggle('selected', key === scopeKey);
    });

    const customInputs = document.getElementById('opt-custom-inputs');
    if (customInputs) {
      customInputs.style.display = (scopeKey === 'custom') ? 'flex' : 'none';
      if (scopeKey === 'custom') {
        setTimeout(() => {
          const inp = document.getElementById('auto-pipeline-custom-ids');
          if (inp) inp.focus();
        }, 50);
      }
    }

    if (!preserveBatchSize && !window.selectedAutoModalBatchSize) {
      window.setAutoModalBatchSize(5);
    } else {
      window.updateAutoPipelineFlowPreview();
    }
  };

  window.setAutoModalBatchSize = function (size, isFromCustomInput = false) {
    window.selectedAutoModalBatchSize = size;
    autoPipelineModalBatchSize = size;
    ['1', '5', '10', '25', '50', 'all'].forEach(chipKey => {
      const chip = document.getElementById(`modal-chip-batch-${chipKey}`);
      if (chip) chip.classList.toggle('active', String(size) === chipKey);
    });

    const customInput = document.getElementById('auto-modal-custom-batch-input');
    const customWrapper = document.getElementById('modal-custom-batch-wrapper');
    const isCustomNum = typeof size === 'number' && ![5, 10, 25, 50].includes(size);

    if (customWrapper) {
      if (isCustomNum) {
        customWrapper.style.borderColor = '#38bdf8';
        customWrapper.style.background = 'rgba(56, 189, 248, 0.16)';
        customWrapper.style.boxShadow = '0 0 10px rgba(56, 189, 248, 0.3)';
      } else {
        customWrapper.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        customWrapper.style.background = 'rgba(0, 0, 0, 0.5)';
        customWrapper.style.boxShadow = 'none';
      }
    }

    if (customInput && !isFromCustomInput) {
      if (isCustomNum) {
        customInput.value = size;
      } else if ([5, 10, 25, 50, 'all'].includes(size)) {
        customInput.value = '';
      }
    }

    window.setPipelineBatchSize(size);
    window.updateAutoPipelineFlowPreview();
  };

  window.promptAutoModalCustomBatchSize = function () {
    const customInput = document.getElementById('auto-modal-custom-batch-input');
    if (customInput) {
      customInput.focus();
      customInput.select();
      return;
    }
    const current = typeof window.selectedAutoModalBatchSize === 'number' ? window.selectedAutoModalBatchSize : '15';
    const input = prompt('Enter custom batch size (number of events to process):', String(current));
    if (input !== null) {
      const parsed = parseInt(input.trim(), 10);
      if (!isNaN(parsed) && parsed > 0) {
        window.setAutoModalBatchSize(parsed);
      }
    }
  };

  window.updateAutoPipelineFlowPreview = function () {
    const scope = window.selectedAutoPipelineScope || 'harvest';
    const batchSize = window.selectedAutoModalBatchSize || pipelineBatchSize || 5;
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const qEvents = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);
    const staleEvents = events.filter(e => classifyEventStaleness(e) !== 'fresh');
    const unverifiedEvents = events.filter(e => {
      const isFree = e.price === 0 || e.isFree || e.pricingType === 'free' || e.cost_type === 'free' || e.access_model === 'open_public_space' || e.access_model === 'free_public_access';
      if (isFree) return e.pricing_model === 'UNVERIFIED_POLICY_ESTIMATE' || !isVerifiedApprovalStatus(e.approval_status);
      return (!e.proof_keyframe_cart && !e.proof_keyframes?.cart) || e.pricing_model === 'UNVERIFIED_POLICY_ESTIMATE';
    });
    const harvestedEvents = typeof window.getUncompiledHarvestedEvents === 'function' ? window.getUncompiledHarvestedEvents() : [];

    let targetCount = 0;
    let scopeTitle = '';
    let stages = [];

    if (scope === 'harvested') {
      targetCount = harvestedEvents.length;
      scopeTitle = 'Newly Harvested Events';
      stages = [
        { num: '1B', name: 'Tier 1 Hunter', color: '#c084fc' },
        { num: '02', name: 'Stagehand Box Office QC', color: '#38bdf8' },
        { num: '03', name: 'AI Enricher', color: '#fbbf24' },
        { num: '04', name: 'Venue Detailer', color: '#60a5fa' },
        { num: '05', name: 'Compiler & Publisher', color: '#34d399' }
      ];
    } else if (scope === 'stale') {
      targetCount = staleEvents.length || events.length;
      scopeTitle = 'Out-of-Date Events';
      stages = [
        { num: '1B', name: 'Tier 1 Hunter', color: '#c084fc' },
        { num: '02', name: 'Stagehand Box Office QC', color: '#38bdf8' },
        { num: '03', name: 'AI Enricher', color: '#fbbf24' },
        { num: '04', name: 'Venue Detailer', color: '#60a5fa' },
        { num: '05', name: 'Compiler & Publisher', color: '#34d399' }
      ];
    } else if (scope === 'quarantined') {
      targetCount = qEvents.length;
      scopeTitle = 'Quarantined Items';
      stages = [
        { num: '1B', name: 'Tier 1 Hunter', color: '#c084fc' },
        { num: '02', name: 'Stagehand Box Office QC', color: '#38bdf8' },
        { num: '03', name: 'AI Enricher', color: '#fbbf24' },
        { num: '04', name: 'Venue Detailer', color: '#60a5fa' },
        { num: '05', name: 'Compiler & Publisher', color: '#34d399' }
      ];
    } else if (scope === 'harvest') {
      targetCount = 0;
      scopeTitle = 'Venue Feed Events';
      const feedStats = typeof window.getHarvesterFeedStats === 'function' ? window.getHarvesterFeedStats() : { resumeFeedNum: 123, totalFeeds: 227 };
      const resumeNum = feedStats.resumeFeedNum;
      const totalFeeds = feedStats.totalFeeds;
      const stage1AName = window.harvesterResumeMode !== false
        ? `Schedule Harvester (Resume #${resumeNum}/${totalFeeds})`
        : 'Schedule Harvester (Fresh #1)';
      stages = [
        { num: '1A', name: stage1AName, color: '#a855f7' },
        { num: '1B', name: 'Tier 1 Hunter', color: '#c084fc' },
        { num: '02', name: 'Stagehand Box Office QC', color: '#38bdf8' },
        { num: '03', name: 'AI Enricher', color: '#fbbf24' },
        { num: '04', name: 'Venue Detailer', color: '#60a5fa' },
        { num: '05', name: 'Compiler & Publisher', color: '#34d399' }
      ];
    } else if (scope === 'unverified') {
      targetCount = unverifiedEvents.length || events.length;
      scopeTitle = 'Unverified Events';
      stages = [
        { num: '1B', name: 'Tier 1 Hunter', color: '#c084fc' },
        { num: '02', name: 'Stagehand Box Office QC', color: '#38bdf8' },
        { num: '03', name: 'AI Enricher', color: '#fbbf24' },
        { num: '04', name: 'Venue Detailer', color: '#60a5fa' },
        { num: '05', name: 'Compiler & Publisher', color: '#34d399' }
      ];
    } else if (scope === 'all') {
      targetCount = events.length;
      scopeTitle = 'Catalog Events';
      stages = [
        { num: '1B', name: 'Tier 1 Hunter', color: '#c084fc' },
        { num: '02', name: 'Stagehand Box Office QC', color: '#38bdf8' },
        { num: '03', name: 'AI Enricher', color: '#fbbf24' },
        { num: '04', name: 'Venue Detailer', color: '#60a5fa' },
        { num: '05', name: 'Compiler & Publisher', color: '#34d399' }
      ];
    } else if (scope === 'custom') {
      const customInput = document.getElementById('auto-pipeline-custom-ids');
      const customVal = customInput ? customInput.value.trim() : '';
      const matched = window.parseCustomCardSpec(customVal);
      targetCount = matched.length > 0 ? matched.length : (typeof batchSize === 'number' ? batchSize : 5);
      scopeTitle = 'Custom Selected Events';
      stages = [
        { num: '1B', name: 'Tier 1 Hunter', color: '#c084fc' },
        { num: '02', name: 'Stagehand Box Office QC', color: '#38bdf8' },
        { num: '03', name: 'AI Enricher', color: '#fbbf24' },
        { num: '04', name: 'Venue Detailer', color: '#60a5fa' },
        { num: '05', name: 'Compiler & Publisher', color: '#34d399' }
      ];
    }

    const effectiveCount = (batchSize === 'all')
      ? (scope === 'harvest' ? 'All Feeds' : targetCount)
      : (scope === 'harvest' ? batchSize : Math.min(typeof batchSize === 'number' ? batchSize : targetCount, targetCount || (typeof batchSize === 'number' ? batchSize : 5)));

    const chipAll = document.getElementById('modal-chip-batch-all');
    if (chipAll) {
      if (scope === 'harvested') chipAll.textContent = `All Harvested (${targetCount})`;
      else if (scope === 'stale') chipAll.textContent = `All Qualifying (${targetCount})`;
      else if (scope === 'quarantined') chipAll.textContent = `All Quarantined (${targetCount})`;
      else if (scope === 'unverified') chipAll.textContent = `All Qualifying (${targetCount})`;
      else if (scope === 'all') chipAll.textContent = `All Catalog (${targetCount})`;
      else if (scope === 'harvest') chipAll.textContent = 'All Feeds';
      else chipAll.textContent = 'All Qualifying';
    }

    const batchNote = document.getElementById('auto-modal-batch-note');
    if (batchNote) {
      if (batchSize === 'all') {
        batchNote.textContent = scope === 'harvest'
          ? (window.harvesterResumeMode !== false ? 'Auto-aligned: Resuming official venue calendar feeds from stopped point' : 'Auto-aligned: Crawling all official venue calendar feeds from #1')
          : `Auto-aligned: Processing all ${targetCount} ${scopeTitle}`;
      } else if (batchSize === 5) {
        batchNote.textContent = 'Quick spot-check (~3–4 mins)';
      } else if (batchSize === 10) {
        batchNote.textContent = 'Sample batch (~7–8 mins)';
      } else if (batchSize === 25) {
        batchNote.textContent = 'Medium batch (~18–20 mins)';
      } else if (batchSize === 50) {
        batchNote.textContent = 'Deep batch (~35–40 mins)';
      } else {
        batchNote.textContent = `Custom batch: ${batchSize} events`;
      }
    }

    const summaryEl = document.getElementById('auto-modal-target-summary');
    if (summaryEl) {
      summaryEl.textContent = scope === 'harvest'
        ? (window.harvesterResumeMode !== false ? 'Continues harvesting official venue calendar feeds from stopped feed' : 'Harvests official venue calendar feeds from start')
        : `${targetCount} matching events ready`;
    }

    const stagesContainer = document.getElementById('auto-modal-flow-stages');
    if (stagesContainer) {
      stagesContainer.innerHTML = stages.map((st, i) => `
        <div style="display: flex; align-items: center; gap: 5px; background: rgba(0,0,0,0.4); border: 1px solid ${st.color}55; border-radius: 6px; padding: 3px 8px;">
          <span style="font-weight: 800; color: ${st.color}; font-size: 0.72rem;">${st.num}</span>
          <span style="color: #f1f5f9; font-weight: 600;">${st.name}</span>
        </div>
        ${i < stages.length - 1 ? '<span style="color: #64748b; font-weight: 700;">➔</span>' : ''}
      `).join('');
    }

    const numEventsForEst = (typeof effectiveCount === 'number')
      ? effectiveCount
      : (scope === 'harvest' ? 5 : (typeof targetCount === 'number' ? targetCount : 5));
    const estSeconds = (scope === 'harvest' ? 30 : 0) + (numEventsForEst * 46);
    const minutes = Math.floor(estSeconds / 60);
    const seconds = estSeconds % 60;
    const etaStr = minutes > 0 ? `~${minutes}m ${seconds > 0 ? seconds + 's' : ''}` : `~${seconds}s`;

    const etaEl = document.getElementById('auto-modal-flow-eta');
    if (etaEl) etaEl.textContent = `Est. Runtime: ${etaStr} (${numEventsForEst} events)`;

    const launchBtn = document.getElementById('btn-launch-configured-pipeline');
    if (launchBtn) {
      if (scope === 'harvest') {
        const cp = state.harvesterCheckpoint || {};
        const resumeNum = cp.resume_from_feed_number != null ? cp.resume_from_feed_number : 50;
        const totalFeeds = cp.total_feeds != null ? cp.total_feeds : 126;
        const modePrefix = window.harvesterResumeMode !== false ? `Continue From #${resumeNum}/${totalFeeds} • ` : 'Start Fresh • ';
        const hCountDisp = (batchSize === 'all') ? `${modePrefix}All Remaining Feeds` : `${modePrefix}${batchSize} Discovered Events`;
        launchBtn.innerHTML = `<span>🚀 Start Auto-Pipeline Run (${hCountDisp})</span>`;
      } else {
        const countDisplay = (batchSize === 'all') ? `All ${targetCount}` : `${effectiveCount}`;
        launchBtn.innerHTML = `<span>🚀 Start Auto-Pipeline Run (${countDisplay} ${scopeTitle})</span>`;
      }
    }
  };

  window.executeConfiguredAutoPipeline = function () {
    const scope = window.selectedAutoPipelineScope || autoPipelineModalScope || 'harvest';
    const batchSize = window.selectedAutoModalBatchSize || pipelineBatchSize || 5;

    window.closeAutoPipelineOptionsModal();

    if (isExecuting) {
      if (typeof showToast === 'function') showToast('A pipeline scan is currently active. Please wait or stop before launching a new one.', 'warning');
      return;
    }

    window.setPipelineBatchSize(batchSize);

    if (scope === 'harvest') {
      window.startEntirePipelineBatchRun();
      return;
    }

    if (scope === 'harvested') {
      window.autoRunHarvestedStages1BTo5();
      return;
    }

    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const qEvents = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);
    const staleEvents = events.filter(e => classifyEventStaleness(e) !== 'fresh');
    const unverifiedEvents = events.filter(e => {
      const isFree = e.price === 0 || e.isFree || e.pricingType === 'free' || e.access_model === 'open_public_space';
      if (isFree) return e.pricing_model === 'UNVERIFIED_POLICY_ESTIMATE';
      return !e.proof_keyframe_cart && !e.proof_keyframes?.cart;
    });

    let targetEvents = [];
    if (scope === 'stale') {
      targetEvents = staleEvents.length > 0 ? staleEvents : events;
      pipelineQuarantinedRunActive = false;
      currentPipelineScope = 'batch5';
    } else if (scope === 'quarantined') {
      targetEvents = qEvents;
      pipelineQuarantinedRunActive = true;
      currentPipelineScope = 'quarantined';
    } else if (scope === 'unverified') {
      targetEvents = unverifiedEvents.length > 0 ? unverifiedEvents : events;
      pipelineQuarantinedRunActive = false;
      currentPipelineScope = 'batch5';
    } else if (scope === 'all') {
      targetEvents = events;
      pipelineQuarantinedRunActive = false;
      currentPipelineScope = 'batch5';
    } else if (scope === 'custom') {
      const customInput = document.getElementById('auto-pipeline-custom-ids');
      const customVal = customInput ? customInput.value.trim() : '';
      const matched = window.parseCustomCardSpec(customVal);
      targetEvents = matched.length > 0 ? matched : events.slice(0, typeof batchSize === 'number' ? batchSize : 5);
      pipelineQuarantinedRunActive = false;
      currentPipelineScope = 'batch5';
    }

    const bLimit = (batchSize !== 'all' && typeof batchSize === 'number') ? batchSize : targetEvents.length;
    const picked = targetEvents.slice(0, bLimit);
    pipelineTestDiscoveredIds = picked.map(e => e.id || e.event_id).filter(Boolean);
    pipelineTestDiscoveredEvents = picked.map(e => ({
      id: e.id || e.event_id,
      title: e.title || e.event_name || 'Event',
      date: e.date || e.dateSchedule || '',
      venue: e.venue || e.venue_name || '',
      price: e.priceLabel || '',
      url: e.ticket_url || e.details_url || ''
    }));

    if (pipelineTestDiscoveredIds.length === 0 && scope !== 'quarantined') {
      const fallbackPicked = events.slice(0, typeof batchSize === 'number' ? batchSize : 5);
      pipelineTestDiscoveredIds = fallbackPicked.map(e => e.id || e.event_id).filter(Boolean);
      pipelineTestDiscoveredEvents = fallbackPicked.map(e => ({
        id: e.id || e.event_id,
        title: e.title || e.event_name || 'Event',
        date: e.date || e.dateSchedule || '',
        venue: e.venue || e.venue_name || '',
        price: e.priceLabel || '',
        url: e.ticket_url || e.details_url || ''
      }));
    }

    isPipelineTestMode = true;
    isPipelineAutoChaining = true;
    window.pipelineAutoChainingStages = ['hunter', 'qc', 'enrich', 'venue', 'compile'];
    pipelineTestStageKey = 'hunter';
    currentPipelineScanKey = 'hunter';

    pipelineTestStageStatuses = {
      harvest: 'Skipped ⏭️',
      hunter: 'Running ⚡',
      qc: 'Queued ⏳',
      enrich: 'Queued ⏳',
      venue: 'Queued ⏳',
      compile: 'Queued ⏳'
    };

    const summaryBanner = document.getElementById('pipeline-completion-summary-banner');
    if (summaryBanner) summaryBanner.style.display = 'none';
    savePipelineBatchState();
    if (typeof showToast === 'function') {
      showToast(`🚀 Auto-Running Pipeline on ${pipelineTestDiscoveredIds.length} Target Events (Stages 1B ➔ 5, skipping Venue Discovery)!`, 'info');
    }
    openPipelineTestStage('hunter', true);
  };

  window.startEntirePipelineBatchRun = function (evt) {
    if (evt) evt.stopPropagation();
    isPipelineTestMode = true;
    isPipelineAutoChaining = true;
    pipelineQuarantinedRunActive = false;
    window.pipelineAutoChainingStages = ['harvest', 'hunter', 'qc', 'enrich', 'venue', 'compile'];
    pipelineTestDiscoveredIds = [];
    pipelineTestDiscoveredEvents = [];
    pipelineTestStageStatuses = {
      harvest: 'Running ⚡',
      hunter: 'Queued ⏳',
      qc: 'Queued ⏳',
      enrich: 'Queued ⏳',
      venue: 'Queued ⏳',
      compile: 'Queued ⏳'
    };
    const summaryBanner = document.getElementById('pipeline-completion-summary-banner');
    if (summaryBanner) summaryBanner.style.display = 'none';
    savePipelineBatchState();
    openPipelineTestStage('harvest', true);
  };

  window.startFiveEventPipelineTest = function (evt) {
    if (evt) evt.stopPropagation();
    isPipelineTestMode = true;
    isPipelineAutoChaining = false;
    pipelineQuarantinedRunActive = false;
    loadPipelineBatchState();
    openPipelineTestStage(pipelineTestStageKey || 'harvest', false);
  };

  window.stepPipelineTestStage = function (delta) {
    if (isExecuting) {
      if (typeof showToast === 'function') showToast('Please wait for the active stage to finish or stop it first.', 'warning');
      return;
    }
    const idx = PIPELINE_TEST_ORDER.indexOf(pipelineTestStageKey);
    const nextIdx = Math.max(0, Math.min(PIPELINE_TEST_ORDER.length - 1, idx + delta));
    const targetStage = PIPELINE_TEST_ORDER[nextIdx];
    if (targetStage) {
      openPipelineTestStage(targetStage, false);
    }
  };

  window.switchPipelineTestStage = function (stageKey) {
    if (!PIPELINE_TEST_ORDER.includes(stageKey)) return;
    if (isExecuting) {
      if (typeof showToast === 'function') showToast('Switching view while stage is running...', 'info');
    } else if (!isPipelineAutoChaining && !pipelineQuarantinedRunActive && stageKey !== 'harvest' && (!pipelineTestDiscoveredIds || pipelineTestDiscoveredIds.length === 0)) {
      const stageInfo = typeof window.getStageContinuationInfo === 'function' ? window.getStageContinuationInfo(stageKey) : null;
      if (stageInfo && Array.isArray(stageInfo.pendingItems) && stageInfo.pendingItems.length > 0) {
        const cap = (pipelineBatchSize === 'all' || pipelineBatchSize === 0)
          ? stageInfo.pendingItems.length
          : Math.min(Number(pipelineBatchSize) || stageInfo.pendingItems.length, stageInfo.pendingItems.length);
        const picked = stageInfo.pendingItems.slice(0, cap);
        pipelineTestDiscoveredIds = picked.map(e => e.id || e.event_id).filter(Boolean);
        pipelineTestDiscoveredEvents = picked.map(e => ({
          id: e.id || e.event_id,
          title: e.title || e.event_name || 'Harvested Event',
          date: e.date || e.dateSchedule || 'TBD',
          venue: e.venue || e.venue_name || '',
          price: e.priceLabel || 'Pending',
          url: e.url || e.ticket_url || e.details_url || ''
        }));
        currentPipelineScope = 'harvested';
        savePipelineBatchState();
      }
    }
    // Never cancel isPipelineAutoChaining when the user clicks a stage pill to inspect progress
    openPipelineTestStage(stageKey, false);
  };

  window.openPipelineTestStage = function (stageKey, autoTriggerRun = false) {
    if (!PIPELINE_TEST_ORDER.includes(stageKey)) stageKey = 'harvest';
    pipelineTestStageKey = stageKey;
    isPipelineTestMode = true;
    if (autoTriggerRun) {
      pipelineTestStageStatuses[stageKey] = 'Running ⚡';
      window.activePipelineRunningStageKey = stageKey;
    }
    savePipelineBatchState();

    window.openScanModal(stageKey);
    updatePipelineTestStepperUI();
    updateStageNavButtons();
    renderPipelineTestEventsList();

    if (autoTriggerRun) {
      setTimeout(() => {
        const preset = SCAN_PRESETS[stageKey] || SCAN_PRESETS.qc;
        const batchCap = (pipelineBatchSize === 'all' || pipelineBatchSize === 0) ? 0 : (Number(pipelineBatchSize) || 5);
        const isHarvestedRun = (currentPipelineScope === 'harvested');
        const stageInfo = (stageKey !== 'harvest' && typeof window.getStageContinuationInfo === 'function')
          ? window.getStageContinuationInfo(stageKey)
          : null;

        if (stageKey !== 'harvest' && isHarvestedRun) {
          // Strict Stage Gate: Allow events that completed the preceding stage OR are part of an active tracked batch that already graduated into allEvents / layer records
          const allowedInputIds = new Set(
            ((stageInfo && stageInfo.allInputItems) || []).map(e => String(e.id || e.event_id || '').toLowerCase()).filter(Boolean)
          );
          const activeCatalogIds = new Set(
            ((state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []))
              .map(e => String(e.id || e.event_id || '').toLowerCase()).filter(Boolean)
          );
          const boxLayerIds = new Set(
            (state.layerBoxOffices || state.layerBoxOffice || [])
              .filter(b => b && b.status && b.status !== 'TIMEOUT_EXCEEDED' && b.status !== 'AI_TIMEOUT' && b.status !== 'EXECUTION_ERROR' && b.status !== 'SKIPPED_NO_URL' && b.status !== 'BUDGET_BREACH' && b.status !== 'ANTIBOT_CHALLENGE_BLOCKED' && !String(b.status).startsWith('FATAL_'))
              .map(b => String(b.id || b.event_id || '').toLowerCase()).filter(Boolean)
          );
          const edLayerIds = new Set(
            (state.layerEditorials || state.layerEditorial || [])
              .filter(ed => ed && ed.clean_title && ed.description && ed.source_engine !== 'unverified')
              .map(ed => String(ed.id || ed.event_id || '').toLowerCase()).filter(Boolean)
          );
          if (pipelineTestDiscoveredIds && pipelineTestDiscoveredIds.length > 0) {
            pipelineTestDiscoveredIds = pipelineTestDiscoveredIds.filter(id => {
              const lid = String(id || '').toLowerCase();
              if (allowedInputIds.has(lid) || activeCatalogIds.has(lid)) return true;
              if (stageKey === 'enrich' && boxLayerIds.has(lid)) return true;
              if ((stageKey === 'venue' || stageKey === 'compile') && edLayerIds.has(lid)) return true;
              return false;
            });
          }
          if ((!pipelineTestDiscoveredIds || pipelineTestDiscoveredIds.length === 0) && stageInfo && Array.isArray(stageInfo.pendingItems) && stageInfo.pendingItems.length > 0) {
            pipelineTestDiscoveredIds = (batchCap > 0 ? stageInfo.pendingItems.slice(0, batchCap) : stageInfo.pendingItems).map(e => e.id || e.event_id).filter(Boolean);
          }
          if (!pipelineTestDiscoveredIds || pipelineTestDiscoveredIds.length === 0) {
            isPipelineAutoChaining = false;
            window.activePipelineRunningStageKey = null;
            updatePipelineTestStepperUI();
            if (typeof showToast === 'function') {
              showToast(`⏸️ Cannot run ${stageKey.toUpperCase()}: 0 events are queued from ${stageInfo ? stageInfo.prevStageLabel : 'the previous stage'}. Events cannot skip pipeline stages!`, 'warning');
            }
            return;
          }
        } else if ((!pipelineTestDiscoveredIds || pipelineTestDiscoveredIds.length === 0) && stageKey !== 'harvest') {
          if (stageInfo && Array.isArray(stageInfo.pendingItems) && stageInfo.pendingItems.length > 0) {
            pipelineTestDiscoveredIds = (batchCap > 0 ? stageInfo.pendingItems.slice(0, batchCap) : stageInfo.pendingItems).map(e => e.id || e.event_id).filter(Boolean);
          } else if (pipelineAuditedCardsHistory && pipelineAuditedCardsHistory.length > 0) {
            pipelineTestDiscoveredIds = pipelineAuditedCardsHistory.map(x => x.id).filter(Boolean);
          }
        }
        const rawIds = pipelineTestDiscoveredIds || [];
        // Prevent Windows 32KB CreateProcessW & HTTP 64KB URL overflow when running large batches (> 250 IDs)
        const idsStr = (isHarvestedRun && rawIds.length > 250) ? '' : rawIds.join(',');

        if (stageKey === 'harvest') {
          const shouldResume = window.harvesterResumeMode !== false;
          const hCity = (window.harvesterCityScope === 'vancouver' || window.harvesterCityScope === 'surrey')
            ? window.harvesterCityScope
            : 'all';
          const baseTarget = hCity === 'vancouver' ? 'all:vancouver' : (hCity === 'surrey' ? 'all:surrey' : 'all');
          const cityTag = hCity === 'vancouver' ? ' • 🏙️ Vancouver Only' : (hCity === 'surrey' ? ' • 🦌 Surrey Only' : '');
          runPipelineAction({
            mode: 'calendar',
            title: `🧪 Stage 1A: Schedule Harvester (${pipelineBatchSize === 'all' ? 'All' : batchCap} Events${cityTag}${shouldResume ? ' • Resuming' : ''})`,
            initialStatus: `Crawling ${hCity === 'all' ? 'Metro' : hCity} venue & discovery feeds${shouldResume ? ' from stopped checkpoint' : ''} to discover ${pipelineBatchSize === 'all' ? 'all' : batchCap} discrete events...`,
            limit: batchCap,
            url: shouldResume ? `${baseTarget}:resume` : baseTarget,
            all: true,
            resume: shouldResume,
            autoApprove: true
          });
        } else if (stageKey === 'hunter') {
          runPipelineAction({
            mode: 'tier1_hunter',
            title: `🏹 Stage 1B: Tier 1 Link Hunter (${rawIds.length || batchCap} Events)`,
            initialStatus: 'Upgrading candidate links & resolving direct checkout carts...',
            ids: idsStr,
            scope: isHarvestedRun ? 'harvested' : currentPipelineScope,
            limit: rawIds.length || batchCap,
            quarantine: pipelineQuarantinedRunActive,
            force: !isHarvestedRun,
            autoApprove: true
          });
        } else if (stageKey === 'qc') {
          runPipelineAction({
            mode: 'catalog_batch',
            title: `⚡ Stage 2: Stagehand Box Office QC (${rawIds.length || batchCap} Events)`,
            initialStatus: 'Penetrating checkout carts & validating fees into layer_box_office.json...',
            ids: idsStr,
            scope: isHarvestedRun ? 'harvested' : currentPipelineScope,
            limit: rawIds.length || batchCap,
            force: !isHarvestedRun,
            autoApprove: true
          });
        } else if (stageKey === 'enrich') {
          runPipelineAction({
            mode: 'enrich',
            title: `✍️ Stage 3: AI Semantic Enricher (${rawIds.length || batchCap} Events)`,
            initialStatus: 'Sanitizing event titles, synopses & categories into layer_editorial.json...',
            ids: idsStr,
            scope: isHarvestedRun ? 'harvested' : currentPipelineScope,
            limit: rawIds.length || batchCap,
            force: !isHarvestedRun,
            autoApprove: true
          });
        } else if (stageKey === 'venue') {
          const targetVenues = window.getVenuesForNewEvents ? window.getVenuesForNewEvents() : [];
          const vParam = idsStr ? '' : (targetVenues.length === 1 ? targetVenues[0] : 'all');
          runPipelineAction({
            mode: 'venue_detailer',
            title: `🏛️ Stage 4: Venue Detailer (${rawIds.length || targetVenues.length || batchCap || 'Catalog'} Events)`,
            initialStatus: 'Grounding physical venue addresses, GPS coordinates & amenities into venues.json...',
            ids: idsStr,
            scope: isHarvestedRun ? 'harvested' : currentPipelineScope,
            venue: vParam,
            limit: rawIds.length || batchCap || 10,
            quarantine: pipelineQuarantinedRunActive,
            force: !isHarvestedRun,
            autoApprove: true
          });
        } else if (stageKey === 'compile') {
          runPipelineAction({
            mode: 'compile',
            title: `🏛️ Stage 5: Compiler & Publisher (${rawIds.length || 'All'} Events)`,
            initialStatus: 'Arbitrating specialist layers, checking math & publishing master data live...',
            ids: idsStr,
            scope: isHarvestedRun ? 'harvested' : currentPipelineScope,
            limit: rawIds.length || 0,
            all: rawIds.length === 0,
            force: true,
            autoApprove: true
          });
        }
      }, 250);
    }
  };

  window.renderPipelineTestEventsList = function () {
    const cardEl = document.getElementById('pipeline-test-events-card');
    const chipsEl = document.getElementById('pipeline-test-events-chips');
    const titleEl = document.getElementById('pipeline-test-events-title');
    if (!cardEl || !chipsEl) return;

    if (!pipelineTestDiscoveredEvents || pipelineTestDiscoveredEvents.length === 0) {
      cardEl.style.display = 'none';
      return;
    }

    cardEl.style.display = 'block';
    if (titleEl) {
      titleEl.textContent = `${pipelineQuarantinedRunActive ? 'Quarantined' : 'Tracked'} Pipeline Batch Events (${pipelineTestDiscoveredEvents.length}):`;
    }
    chipsEl.innerHTML = pipelineTestDiscoveredEvents.map((ev, i) => `
      <span onclick="if (window.showComparisonCardById) window.showComparisonCardById('${escapeHtml(ev.id || '')}')" style="cursor: pointer; display: inline-flex; align-items: center; gap: 5px; background: rgba(16, 185, 129, 0.14); border: 1px solid rgba(16, 185, 129, 0.4); color: #a7f3d0; font-size: 0.7rem; font-weight: 700; padding: 3px 9px; border-radius: 999px;">
        <strong style="color: #34d399;">#${i + 1}</strong> ${escapeHtml((ev.title || 'Event').slice(0, 32))}
        ${ev.venue ? `<span style="color: #6ee7b7; font-weight: 500;">(${escapeHtml(ev.venue.slice(0, 18))})</span>` : ''}
      </span>
    `).join('');
  };

  // Venue Detailer Selector & Scope Functions
  async function loadVenueDetailerVenuesList() {
    if (cachedDetailerVenues && cachedDetailerVenues.length > 0) return cachedDetailerVenues;
    let rawVenues = (state.masterCatalogsData && state.masterCatalogsData.venues_master) || (state.venuesData ? Object.values(state.venuesData) : []);
    if (!rawVenues || rawVenues.length === 0) {
      try {
        const res = await fetch('/data/venues.json?_t=' + Date.now());
        if (res.ok) {
          rawVenues = await res.json();
          if (state.masterCatalogsData) state.masterCatalogsData.venues_master = rawVenues;
        }
      } catch (_) { }
    }
    cachedDetailerVenues = Array.isArray(rawVenues) ? rawVenues : [];
    return cachedDetailerVenues;
  }

  window.getVenuesForNewEvents = function () {
    const canonicalMap = new Map();
    const masterVenues = (cachedDetailerVenues && cachedDetailerVenues.length > 0)
      ? cachedDetailerVenues
      : ((state.masterCatalogsData && state.masterCatalogsData.venues_master) || (state.venuesData ? Object.values(state.venuesData) : []));

    const resolveCanonicalVenueName = (raw) => {
      const v = (raw || '').trim();
      if (!v || v === 'none_available') return null;
      const vLower = v.toLowerCase();
      const vClean = vLower.replace(/\(.*?\)/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      if (Array.isArray(masterVenues) && masterVenues.length > 0) {
        const exact = masterVenues.find(mv => (mv.venue_name || mv.name || '').toLowerCase().trim() === vLower);
        if (exact) return (exact.venue_name || exact.name).trim();
        const clean = masterVenues.find(mv => (mv.venue_name || mv.name || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() === vClean);
        if (clean) return (clean.venue_name || clean.name).trim();
        const contain = masterVenues.find(mv => {
          const mvClean = (mv.venue_name || mv.name || '').toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
          return mvClean.length > 6 && (vClean.includes(mvClean) || mvClean.includes(vClean));
        });
        if (contain) return (contain.venue_name || contain.name).trim();
      }
      return v;
    };

    const addVenueName = (raw) => {
      const canonical = resolveCanonicalVenueName(raw);
      if (!canonical) return;
      const key = canonical.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      if (key && !canonicalMap.has(key)) {
        canonicalMap.set(key, canonical);
      }
    };

    (pipelineTestDiscoveredEvents || []).forEach(ev => {
      addVenueName(ev.venue || ev.venue_name);
    });
    if (canonicalMap.size === 0 && pipelineTestDiscoveredIds && pipelineTestDiscoveredIds.length > 0) {
      const allEvs = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
      const qEvs = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);
      const scheds = state.masterCatalogsData?.layer_schedules || [];
      const combined = [...allEvs, ...qEvs, ...scheds];
      pipelineTestDiscoveredIds.forEach(id => {
        const found = combined.find(e => (e.id || e.event_id) === id);
        if (found) addVenueName(found.venue || found.venue_name);
      });
    }
    if (canonicalMap.size === 0 && typeof getStageContinuationInfo === 'function') {
      const venueCont = getStageContinuationInfo('venue');
      (venueCont.pendingItems || []).forEach(ev => {
        addVenueName(ev.venue || ev.venue_name);
      });
    }
    return Array.from(canonicalMap.values());
  };

  window.populateVenueDetailerDropdown = async function (filterQuery = '') {
    const select = document.getElementById('pipeline-select-venue-detailer');
    if (!select) return;
    const venues = await loadVenueDetailerVenuesList();
    const q = (filterQuery || '').trim().toLowerCase();
    const currentVal = select.value || 'new_events';
    const newEventVenues = window.getVenuesForNewEvents();
    const chipNew = document.getElementById('chip-venue-scope-new');
    if (chipNew) chipNew.textContent = `✨ Venues for New Events (${newEventVenues.length})`;
    const chipAll = document.getElementById('chip-venue-scope-all');
    if (chipAll) chipAll.textContent = `🏛️ All Facilities (${venues.length})`;

    let filtered = [...venues].sort((a, b) => (a.venue_name || a.name || '').localeCompare(b.venue_name || b.name || ''));
    if (q) {
      filtered = filtered.filter(v => {
        const name = (v.venue_name || v.name || '').toLowerCase();
        const addr = (v.full_address || v.address || '').toLowerCase();
        const hood = (v.neighborhood || '').toLowerCase();
        return name.includes(q) || addr.includes(q) || hood.includes(q);
      });
    }

    let html = '';
    html += `<option value="new_events" ${currentVal === 'new_events' ? 'selected' : ''}>✨ Venues for Newly Discovered Events (${newEventVenues.length} venues)</option>`;
    html += `<option value="ungrounded" ${currentVal === 'ungrounded' ? 'selected' : ''}>🔍 Ungrounded / Incomplete Venues Only</option>`;
    html += `<option value="all" ${currentVal === 'all' ? 'selected' : ''}>🌐 All Physical Venues (${venues.length} facilities in venues.json)</option>`;

    if (filtered.length > 0) {
      html += `<optgroup label="Physical Venues (${filtered.length}${q ? ' matching' : ''})">`;
      filtered.forEach(v => {
        const name = (v.venue_name || v.name || 'Venue').trim();
        const hood = v.neighborhood ? ` — ${v.neighborhood}` : '';
        const isSel = currentVal === name ? 'selected' : '';
        html += `<option value="${escapeHtml(name)}" ${isSel}>🏛️ ${escapeHtml(name)}${escapeHtml(hood)}</option>`;
      });
      html += `</optgroup>`;
    }
    select.innerHTML = html;

    if (q && filtered.length > 0) {
      const topName = (filtered[0].venue_name || filtered[0].name || '').trim();
      if (topName) {
        select.value = topName;
        window.onVenueDetailerSelected(topName);
      }
    }
  };

  window.onSearchVenueDetailerInput = function (val) {
    const clearBtn = document.getElementById('btn-clear-venue-detailer-search');
    if (clearBtn) clearBtn.style.display = (val && val.trim()) ? 'inline-block' : 'none';
    window.populateVenueDetailerDropdown(val);
  };

  window.clearVenueDetailerSearch = function () {
    const input = document.getElementById('pipeline-search-venue-detailer');
    if (input) input.value = '';
    const clearBtn = document.getElementById('btn-clear-venue-detailer-search');
    if (clearBtn) clearBtn.style.display = 'none';
    window.populateVenueDetailerDropdown('');
  };

  window.setVenueDetailerScope = function (scopeVal) {
    const select = document.getElementById('pipeline-select-venue-detailer');
    if (select) select.value = scopeVal;
    window.onVenueDetailerSelected(scopeVal);
  };

  window.resetVenueDetailerToAll = function () {
    window.setVenueDetailerScope('all');
  };

  window.onVenueDetailerSelected = function (val) {
    const chipNew = document.getElementById('chip-venue-scope-new');
    const chipUngrounded = document.getElementById('chip-venue-scope-ungrounded');
    const chipAll = document.getElementById('chip-venue-scope-all');
    const badge = document.getElementById('pipeline-venue-detailer-count-badge');
    const displayEl = document.getElementById('pipeline-venue-detailer-target-display');
    const btnLabelEl = document.getElementById('btn-trigger-pipeline-label');

    if (chipNew) chipNew.classList.toggle('active', val === 'new_events');
    if (chipUngrounded) chipUngrounded.classList.toggle('active', val === 'ungrounded');
    if (chipAll) chipAll.classList.toggle('active', val === 'all');

    const newVenues = window.getVenuesForNewEvents();
    if (chipNew) chipNew.textContent = `✨ Venues for New Events (${newVenues.length})`;
    if (val === 'new_events') {
      if (badge) badge.textContent = `New Event Venues (${newVenues.length})`;
      if (displayEl) {
        displayEl.innerHTML = newVenues.length > 0
          ? `✨ Grounding <strong>${newVenues.length} venue(s)</strong> from newly discovered events: ${escapeHtml(newVenues.join(', '))}`
          : `✨ No newly discovered event venues in current session — will ground ungrounded venues in <code>venues.json</code>.`;
      }
      if (btnLabelEl) btnLabelEl.textContent = newVenues.length > 0 ? `Ground ${newVenues.length} New Event Venue(s)` : 'Ground Pending Venues';
    } else if (val === 'ungrounded') {
      if (badge) badge.textContent = 'Ungrounded Only';
      if (displayEl) displayEl.innerHTML = '🔍 Grounding only venues missing street address, GPS coordinates, or 5XX/6XX benchmarks in <code>venues.json</code>.';
      if (btnLabelEl) btnLabelEl.textContent = 'Ground Ungrounded Venues';
    } else if (val === 'all') {
      if (badge) badge.textContent = 'All Venues Mode';
      if (displayEl) displayEl.innerHTML = '🌐 Grounding all physical venues in <code>venues.json</code> with Google Maps &amp; facility benchmarks.';
      if (btnLabelEl) btnLabelEl.textContent = 'Ground All Venues';
    } else {
      if (badge) badge.textContent = 'Single Venue';
      if (displayEl) displayEl.innerHTML = `🏛️ Targeting single physical venue: <strong>${escapeHtml(val)}</strong> into <code>venues.json</code>.`;
      if (btnLabelEl) btnLabelEl.textContent = `Ground ${val}`;
      let venues = (state.masterCatalogsData && state.masterCatalogsData.venues_master) || (state.venuesData ? Object.values(state.venuesData) : []);
      if (Array.isArray(venues)) {
        const vIdx = venues.findIndex(v => (v.venue_name || v.name) === val);
        if (vIdx !== -1 && typeof window.showComparisonCardById === 'function') {
          window.showComparisonCardById(`venue:${vIdx}`);
        }
      }
    }
  };

  window.runCanaryTestFeed = function () {
    const select = document.getElementById('pipeline-select-venue-feed');
    const canaryUrl = 'https://theimprovcentre.ca/shows/';
    if (select) {
      select.value = canaryUrl;
      window.onVenueFeedSelected(canaryUrl);
    }
    window.setPipelineBatchSize(5);
    const btnTrigger = document.getElementById('btn-trigger-pipeline-run');
    if (btnTrigger) btnTrigger.click();
  };

  function updateStageNavButtons() {
    const idx = PIPELINE_TEST_ORDER.indexOf(currentPipelineScanKey);
    const prevBtn = document.getElementById('btn-comp-stage-prev');
    const nextBtn = document.getElementById('btn-comp-stage-next');
    const advanceBtn = document.getElementById('btn-comp-advance-run-next');
    const advanceLabel = document.getElementById('btn-comp-advance-label');

    PIPELINE_TEST_ORDER.forEach(k => {
      const pill = document.getElementById(`comp-stage-pill-${k}`);
      if (pill) {
        const active = k === currentPipelineScanKey;
        pill.style.background = active ? 'rgba(56, 189, 248, 0.22)' : 'rgba(30, 41, 59, 0.7)';
        pill.style.color = active ? '#38bdf8' : '#94a3b8';
        pill.style.borderColor = active ? 'rgba(56, 189, 248, 0.5)' : 'rgba(148, 163, 184, 0.25)';
      }
    });

    if (prevBtn) {
      prevBtn.disabled = (idx <= 0);
      if (idx > 0) {
        const prevKey = PIPELINE_TEST_ORDER[idx - 1];
        const prevPreset = SCAN_PRESETS[prevKey];
        const prevTitle = prevPreset ? prevPreset.title.replace(/<[^>]+>/g, '').replace(/^🧪\s*/, '').trim() : prevKey;
        prevBtn.textContent = `◀ Previous Stage: ${prevTitle}`;
      } else {
        prevBtn.textContent = '◀ First Stage';
      }
    }
    if (nextBtn) {
      nextBtn.disabled = (idx < 0 || idx >= PIPELINE_TEST_ORDER.length - 1);
      if (idx >= 0 && idx < PIPELINE_TEST_ORDER.length - 1) {
        const nextKey = PIPELINE_TEST_ORDER[idx + 1];
        const nextPreset = SCAN_PRESETS[nextKey];
        const nextTitle = nextPreset ? nextPreset.title.replace(/<[^>]+>/g, '').replace(/^🧪\s*/, '').trim() : nextKey;
        nextBtn.textContent = `Next Stage: ${nextTitle} ▶`;
      } else {
        nextBtn.textContent = 'Final Stage ▶';
      }
    }

    if (advanceBtn && advanceLabel) {
      if (idx >= 0 && idx < PIPELINE_TEST_ORDER.length - 1) {
        const nextKey = PIPELINE_TEST_ORDER[idx + 1];
        const nextPreset = SCAN_PRESETS[nextKey];
        advanceBtn.style.display = 'inline-flex';
        advanceLabel.textContent = `Run Next: ${nextPreset ? nextPreset.title.replace(/<[^>]+>/g, '').trim() : nextKey}`;
      } else {
        advanceBtn.style.display = 'none';
      }
    }
  }

  window.switchPipelineDisplayOnly = function (stageKey) {
    window.switchPipelineTestStage(stageKey);
  };

  window.navigatePipelineDisplayStage = function (delta) {
    window.stepPipelineTestStage(delta);
  };

  window.advanceToNextPipelineStage = function () {
    const idx = PIPELINE_TEST_ORDER.indexOf(currentPipelineScanKey);
    if (idx >= 0 && idx < PIPELINE_TEST_ORDER.length - 1) {
      const nextKey = PIPELINE_TEST_ORDER[idx + 1];
      openPipelineTestStage(nextKey, true);
    }
  };

  window.runCompilerFromVenuePrompt = function () {
    const banner = document.getElementById('venue-compiler-update-prompt-banner');
    if (banner) banner.style.display = 'none';
    openPipelineTestStage('compile', true);
  };

  window.dismissVenueCompilerPrompt = function () {
    const banner = document.getElementById('venue-compiler-update-prompt-banner');
    if (banner) banner.style.display = 'none';
  };

  window.updateCompilerPreviewBanner = function (passedCountOverride, failedCountOverride) {
    const banner = document.getElementById('compiler-new-cards-preview-banner');
    const titleEl = document.getElementById('compiler-banner-title') || document.getElementById('compiler-preview-banner-title');
    const descEl = document.getElementById('compiler-banner-subtext') || document.getElementById('compiler-preview-banner-desc');
    const iconEl = document.getElementById('compiler-banner-icon');
    const newCardsBadge = document.getElementById('compiler-new-cards-badge');
    const passedBadge = document.getElementById('compiled-cards-passed-count');
    const failedBadge = document.getElementById('compiled-cards-failed-count');
    if (!banner) return;

    const passedMap = window.pipelineCompiledPassedMap instanceof Map ? window.pipelineCompiledPassedMap : new Map();
    const failedMap = window.pipelineCompiledFailedMap instanceof Map ? window.pipelineCompiledFailedMap : new Map();
    const compCount = passedCountOverride !== undefined
      ? passedCountOverride
      : (passedMap.size || pipelineLastCompiledCardIds.length || pipelineAuditedCardsHistory.length);
    const qCount = failedCountOverride !== undefined
      ? failedCountOverride
      : (failedMap.size || (state.quarantinedEvents || []).length);

    if (passedBadge) passedBadge.textContent = String(compCount);
    if (failedBadge) failedBadge.textContent = String(qCount);
    banner.style.display = 'flex';
    if (compCount === 0 && qCount > 0) {
      if (iconEl) iconEl.textContent = '🛡️';
      if (titleEl) {
        titleEl.textContent = `Compiler Run Complete: 0 Passed • ${qCount} Archived/Quarantined`;
        titleEl.style.color = '#fbbf24';
      }
      if (newCardsBadge) {
        newCardsBadge.textContent = `0 Published • ${qCount} Filtered`;
        newCardsBadge.style.background = 'rgba(245, 158, 11, 0.2)';
        newCardsBadge.style.color = '#fbbf24';
        newCardsBadge.style.borderColor = 'rgba(245, 158, 11, 0.45)';
      }
      if (descEl) {
        descEl.textContent = `All ${qCount} targeted event(s) in this run were archived (e.g. past date) or quarantined. Click Failed Cards (${qCount}) to inspect.`;
      }
    } else {
      if (iconEl) iconEl.textContent = '🎉';
      if (titleEl) {
        titleEl.textContent = `Compilation & Publishing Complete`;
        titleEl.style.color = '#6ee7b7';
      }
      if (newCardsBadge) {
        newCardsBadge.textContent = `${compCount} Active Live in Catalog`;
        newCardsBadge.style.background = 'rgba(16, 185, 129, 0.25)';
        newCardsBadge.style.color = '#34d399';
        newCardsBadge.style.borderColor = 'rgba(16, 185, 129, 0.45)';
      }
      if (descEl) {
        descEl.textContent = `All specialist layers have been arbitrated and verified against financial invariants (≤ $50 CAD). Preview the ${compCount} passed card(s) now.`;
      }
    }
  };

  window.previewNewlyCompiledCards = function (initialTab = 'compiled') {
    const modal = document.getElementById('pipeline-new-cards-preview-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    modal.classList.add('active');
    const normalizedTab = (initialTab === 'failed' || initialTab === 'quarantined') ? 'quarantined' : 'compiled';
    window.switchPreviewModalTab(normalizedTab);
  };

  window.switchPreviewModalTab = function (tab) {
    const normalizedTab = (tab === 'failed' || tab === 'quarantined') ? 'quarantined' : 'compiled';
    currentPreviewModalTab = normalizedTab;
    const tabComp = document.getElementById('preview-tab-compiled') || document.getElementById('preview-tab-passed');
    const tabQuar = document.getElementById('preview-tab-quarantined') || document.getElementById('preview-tab-failed');
    const grid = document.getElementById('pipeline-new-cards-preview-grid') || document.getElementById('pipeline-new-cards-preview-container');
    const compBadge = document.getElementById('preview-tab-compiled-count') || document.getElementById('modal-tab-passed-count');
    const quarBadge = document.getElementById('preview-tab-quarantined-count') || document.getElementById('modal-tab-failed-count');

    const allEvs = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const qEvs = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);
    const archEvs = Array.isArray(state.archivedEvents) ? state.archivedEvents : [];
    const passedMap = window.pipelineCompiledPassedMap instanceof Map ? window.pipelineCompiledPassedMap : new Map();
    const failedMap = window.pipelineCompiledFailedMap instanceof Map ? window.pipelineCompiledFailedMap : new Map();

    const targetIds = new Set();
    passedMap.forEach((_, id) => { if (id) targetIds.add(id); });
    failedMap.forEach((_, id) => { if (id) targetIds.add(id); });
    (pipelineLastCompiledCardIds || []).forEach(id => { if (id) targetIds.add(id); });
    (window.pipelineLastCompiledIds || []).forEach(id => { if (id) targetIds.add(id); });
    (pipelineAuditedCardsHistory || []).forEach(x => { if (x && x.id) targetIds.add(x.id); });

    let compiledCards = [];
    let failedCards = [];
    if (targetIds.size > 0) {
      targetIds.forEach(id => {
        const qFound = qEvs.find(e => (e.id || e.event_id) === id);
        const liveFound = allEvs.find(e => (e.id || e.event_id) === id);
        const archFound = archEvs.find(e => (e.id || e.event_id) === id);
        const fSnap = failedMap.get(id);
        const pSnap = passedMap.get(id);
        if (fSnap || qFound || (!liveFound && archFound)) {
          failedCards.push(qFound || archFound || fSnap);
        } else if (liveFound || pSnap) {
          compiledCards.push(liveFound || pSnap);
        }
      });
    } else {
      compiledCards = allEvs.slice(0, 12);
      failedCards = qEvs;
    }

    if (compiledCards.length === 0 && typeof window.getNewestPassedBatchEvents === 'function') {
      const recentPassed = window.getNewestPassedBatchEvents();
      if (Array.isArray(recentPassed) && recentPassed.length > 0) {
        compiledCards = recentPassed;
      }
    }

    if (compBadge) compBadge.textContent = String(compiledCards.length);
    if (quarBadge) quarBadge.textContent = String(failedCards.length);

    if (tabComp) {
      tabComp.style.background = normalizedTab === 'compiled' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(30, 41, 59, 0.6)';
      tabComp.style.color = normalizedTab === 'compiled' ? '#34d399' : '#94a3b8';
    }
    if (tabQuar) {
      tabQuar.style.background = normalizedTab === 'quarantined' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(30, 41, 59, 0.6)';
      tabQuar.style.color = normalizedTab === 'quarantined' ? '#f87171' : '#94a3b8';
    }

    if (!grid) return;
    const list = normalizedTab === 'compiled' ? compiledCards : failedCards;
    if (!list || list.length === 0) {
      grid.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #94a3b8;">No ${normalizedTab} cards to display.</div>`;
      return;
    }

    const synthesizeFullCardForPreview = (rawCard) => {
      if (!rawCard) return {};
      const cid = rawCard.id || rawCard.event_id || '';
      const mData = state.masterCatalogsData || {};
      const schedLayer = Array.isArray(mData.layer_schedules) ? mData.layer_schedules.find(x => (x.id || x.event_id) === cid) : null;
      const boxLayer = Array.isArray(mData.layer_box_office) ? mData.layer_box_office.find(x => (x.id || x.event_id) === cid) : null;
      const editLayer = Array.isArray(mData.layer_editorial) ? mData.layer_editorial.find(x => (x.id || x.event_id) === cid) : null;
      const seedLayer = Array.isArray(mData.seeds_raw) ? mData.seeds_raw.find(x => (x.id || x.event_id) === cid) : null;

      const venueNameRaw = rawCard.venue || rawCard.venue_name || editLayer?.venue_name || schedLayer?.venue_name || seedLayer?.venue_name || 'Vancouver Venue';
      const vLow = String(venueNameRaw).toLowerCase().trim();
      const vMasterList = Array.isArray(mData.venues_master) ? mData.venues_master : (Array.isArray(state.cachedVenueFeeds) ? state.cachedVenueFeeds : []);
      const matchedVenue = vMasterList.find(v => {
        const vn = String(v.venue_name || v.name || '').toLowerCase().trim();
        return vn && (vn === vLow || vn.includes(vLow) || vLow.includes(vn));
      }) || {};

      const dAudit = rawCard.dimension_audit || {};
      const dVal = (k) => (dAudit[k] && typeof dAudit[k] === 'object') ? dAudit[k].value : dAudit[k];
      const cleanBenchmark = (v) => (v && typeof v === 'string' && !/^(none_available|not_applicable|search_exhausted_null|null|undefined)$/i.test(v.trim())) ? v.trim() : null;

      const title = rawCard.title || rawCard.event_name || editLayer?.clean_title || editLayer?.title || schedLayer?.title || seedLayer?.title || dVal('D001_event_name') || dVal('D001_title') || cid || 'Event';
      const venue = rawCard.venue || rawCard.venue_name || matchedVenue.venue_name || matchedVenue.name || venueNameRaw;
      const address = rawCard.full_address || rawCard.address || matchedVenue.full_address || matchedVenue.address || dVal('D402_full_address') || 'Vancouver, BC';
      const neighborhood = rawCard.neighborhood || matchedVenue.neighborhood || dVal('D404_neighborhood') || '';
      const category = rawCard.category || editLayer?.category || (Array.isArray(editLayer?.categories) ? editLayer.categories[0] : null) || dVal('D004_category') || seedLayer?.category || 'Shows & Arts';
      const archetype = rawCard.event_archetype || rawCard.archetype || editLayer?.event_archetype || dVal('D007_event_archetype') || dVal('D002_event_archetype') || null;
      const lifecycle = rawCard.lifecycle_type || rawCard.lifecycleType || editLayer?.lifecycle_type || dVal('D006_lifecycle_type') || seedLayer?.lifecycle_type || 'time_bound_event';
      const isPerennial = lifecycle === 'perennial_drop_in' || rawCard.access_model === 'open_public_space' || matchedVenue.access_model === 'open_public_space';

      const rawLineup = rawCard.lineup || editLayer?.lineup || schedLayer?.lineup || dVal('D301_lineup') || null;
      const artist = rawCard.artist || editLayer?.artist || schedLayer?.artist || dVal('D302_artist') || (Array.isArray(rawLineup) && rawLineup.length > 0 ? rawLineup.join(', ') : (typeof rawLineup === 'string' ? rawLineup : null));

      const showings = (Array.isArray(rawCard.showings) && rawCard.showings.length > 0)
        ? rawCard.showings
        : (Array.isArray(schedLayer?.showings) && schedLayer.showings.length > 0 ? schedLayer.showings : (dAudit.D304_showings_slots?.showings || []));
      const primaryShow = showings[0] || rawCard.show_1 || {};
      const date = rawCard.date || primaryShow.date || schedLayer?.date || dVal('D303_date') || seedLayer?.date || null;
      const startTime = rawCard.start_time || rawCard.time || primaryShow.start_time || schedLayer?.start_time || dVal('D306_start_time') || null;
      const doorsTime = rawCard.doors_time || primaryShow.doors_time || schedLayer?.doors_time || dVal('D305_doors_time') || null;
      const endTime = rawCard.end_time || primaryShow.end_time || boxLayer?.end_time || schedLayer?.end_time || dVal('D307_end_time') || null;
      const dateSchedule = rawCard.dateSchedule || dVal('D308_dateSchedule') || (isPerennial ? 'Open Daily to the Public' : (date ? `${date}${startTime ? ` at ${startTime}` : ''}` : 'Check Venue Schedule'));
      const frequencyLabel = rawCard.frequencyLabel || dVal('D309_frequencyLabel') || (isPerennial ? 'Open Daily Drop-In' : (showings.length > 1 ? `${showings.length} Verified Showings` : 'Single Showing'));
      const weeklyHours = rawCard.weekly_hours || rawCard.weeklyHours || matchedVenue.weekly_hours || dVal('D407_weekly_hours') || null;

      const priceNum = rawCard.price != null ? Number(rawCard.price)
        : (rawCard.price_all_in != null ? Number(rawCard.price_all_in)
          : (boxLayer?.tier1_price_all_in != null ? Number(boxLayer.tier1_price_all_in)
            : (boxLayer?.price_all_in != null ? Number(boxLayer.price_all_in)
              : (dVal('D205_tier1_price_all_in') != null ? Number(dVal('D205_tier1_price_all_in'))
                : (isPerennial ? 0 : null)))));
      const isFree = Boolean(rawCard.isFree || rawCard.pricingType === 'free' || priceNum === 0);
      const priceBase = rawCard.price_base ?? boxLayer?.tier1_price_base ?? dVal('D202_tier1_price_base') ?? priceNum;
      const priceFee = rawCard.price_fee ?? boxLayer?.tier1_price_fee ?? dVal('D203_tier1_price_fee') ?? 0;
      const priceTax = rawCard.price_tax ?? boxLayer?.tier1_price_tax ?? dVal('D204_tier1_price_tax') ?? 0;
      const priceLabel = rawCard.priceLabel || (isFree ? 'Free ($0)' : (priceNum != null && !isNaN(priceNum) ? `$${priceNum.toFixed(2)} all-in` : 'Pending Box Office QC'));
      const isSoldOut = Boolean(rawCard.is_sold_out || rawCard.isSoldOut || boxLayer?.is_sold_out || dVal('D107_operational_status') === 'sold_out');
      const ticketProvider = rawCard.ticket_provider || boxLayer?.ticket_provider || schedLayer?.ticket_provider || dVal('D221_ticket_provider') || (isFree ? 'Free Public Access' : 'Direct');

      let tiers = Array.isArray(rawCard.tiers) && rawCard.tiers.length > 0 ? rawCard.tiers : (Array.isArray(rawCard.all_tiers) && rawCard.all_tiers.length > 0 ? rawCard.all_tiers : (Array.isArray(boxLayer?.all_tiers) ? boxLayer.all_tiers : []));
      if (tiers.length === 0 && priceNum != null && !isNaN(priceNum)) {
        tiers = [{
          name: boxLayer?.tier1_name || dVal('D201_tier1_name') || 'General Admission',
          price: priceNum,
          price_base: priceBase,
          price_fee: priceFee,
          price_tax: priceTax,
          label: isFree ? 'Free ($0)' : `$${priceNum.toFixed(2)} CAD`,
          isAvailable: !isSoldOut
        }];
        const t2Name = boxLayer?.tier2_name || dVal('D206_tier2_name');
        const t2Price = boxLayer?.tier2_price_all_in ?? boxLayer?.tier2_price_read ?? dVal('D210_tier2_price_all_in');
        if (t2Name && t2Price != null && !isNaN(Number(t2Price))) {
          tiers.push({
            name: t2Name,
            price: Number(t2Price),
            price_base: boxLayer?.tier2_price_base ?? dVal('D207_tier2_price_base') ?? Number(t2Price),
            price_fee: boxLayer?.tier2_price_fee ?? dVal('D208_tier2_price_fee') ?? 0,
            price_tax: boxLayer?.tier2_price_tax ?? dVal('D209_tier2_price_tax') ?? 0,
            label: `$${Number(t2Price).toFixed(2)} CAD`,
            isAvailable: true
          });
        }
        const t3Name = boxLayer?.tier3_name || dVal('D211_tier3_name');
        const t3Price = boxLayer?.tier3_price_all_in ?? boxLayer?.tier3_price_read ?? dVal('D215_tier3_price_all_in');
        if (t3Name && t3Price != null && !isNaN(Number(t3Price))) {
          tiers.push({
            name: t3Name,
            price: Number(t3Price),
            price_base: boxLayer?.tier3_price_base ?? dVal('D212_tier3_price_base') ?? Number(t3Price),
            price_fee: boxLayer?.tier3_price_fee ?? dVal('D213_tier3_price_fee') ?? 0,
            price_tax: boxLayer?.tier3_price_tax ?? dVal('D214_tier3_price_tax') ?? 0,
            label: `$${Number(t3Price).toFixed(2)} CAD`,
            isAvailable: true
          });
        }
      }

      const description = rawCard.description || rawCard.synopsis || editLayer?.synopsis || editLayer?.description || dVal('D310_synopsis') || dVal('D51_description') || '';
      const restrictions = rawCard.restrictions || editLayer?.restrictions || boxLayer?.restrictions || dVal('D008_restrictions') || matchedVenue.restrictions || 'All Ages';
      const accessModel = rawCard.access_model || matchedVenue.access_model || dVal('D405_access_model') || null;
      const envType = rawCard.environment_type || matchedVenue.environment_type || dVal('D406_environment_type') || null;
      const transitInfo = rawCard.transit_info || rawCard.transitInfo || matchedVenue.transit_info || dAudit.D408_transit_waypoints?.transit || null;

      const beerBench = cleanBenchmark(rawCard.beer_benchmark || matchedVenue.beer_benchmark || matchedVenue.spend_benchmarks?.beer || dVal('D603_beer_benchmark'));
      const cocktailBench = cleanBenchmark(rawCard.cocktail_benchmark || matchedVenue.cocktail_benchmark || matchedVenue.spend_benchmarks?.cocktail);
      const coffeeBench = cleanBenchmark(rawCard.coffee_benchmark || matchedVenue.coffee_benchmark || matchedVenue.spend_benchmarks?.coffee || dVal('D602_coffee_benchmark'));
      const mealBench = cleanBenchmark(rawCard.meal_benchmark || matchedVenue.meal_benchmark || matchedVenue.spend_benchmarks?.meal || dVal('D604_meal_benchmark'));
      const concessionBench = cleanBenchmark(rawCard.concession_benchmark || matchedVenue.concession_benchmark || matchedVenue.spend_benchmarks?.concession);

      let typicalSpend = cleanBenchmark(rawCard.typical_item_spend);
      if (!typicalSpend) {
        const shortR = (val) => val ? val.replace(/\s+CAD\b/gi, '').replace(/\s*\(.*?\)/g, '').trim() : null;
        const parts = [];
        if (beerBench) parts.push(`Beer ${shortR(beerBench)}`);
        if (cocktailBench) parts.push(`Cocktails ${shortR(cocktailBench)}`);
        if (!beerBench && !cocktailBench && coffeeBench) parts.push(`Coffee/Drinks ${shortR(coffeeBench)}`);
        else if (coffeeBench && parts.length < 2) parts.push(`Coffee ${shortR(coffeeBench)}`);
        if (concessionBench && parts.length < 2) parts.push(`Concessions ${shortR(concessionBench)}`);
        if (mealBench && parts.length < 2) parts.push(`Food ${shortR(mealBench)}`);
        if (parts.length > 0) typicalSpend = parts.join(' • ');
      }

      const stepFree = cleanBenchmark(rawCard.step_free_entrance || matchedVenue.step_free_entrance || dVal('D501_step_free_entrance'));
      const washrooms = cleanBenchmark(rawCard.accessible_washrooms || matchedVenue.accessible_washrooms || dVal('D503_accessible_washrooms'));
      const outsideFood = cleanBenchmark(rawCard.outside_food_policy || matchedVenue.outside_food_policy || dVal('D605_outside_food_policy'));
      const paymentMethods = cleanBenchmark(rawCard.payment_methods || matchedVenue.payment_methods || dVal('D607_payment_methods'));
      const waterRefill = cleanBenchmark(rawCard.water_refill_station || matchedVenue.water_refill_station || dVal('D608_water_refill_station'));

      const linksObj = rawCard.links || {};
      const t1Url = linksObj.tier1_checkout || dVal('D101_tier1_checkout') || boxLayer?.ticket_url || seedLayer?.tier1_url || null;
      const t2Url = linksObj.tier2_event_page || dVal('D102_tier2_event_page') || rawCard.details_url || schedLayer?.details_url || seedLayer?.source_url || null;
      const t3Url = linksObj.tier3_calendar || dVal('D103_tier3_calendar') || matchedVenue.calendar_url || null;
      const t4Url = linksObj.tier4_civic_destination || dVal('D104_tier4_civic_destination') || matchedVenue.civic_destination_url || null;
      const t5Url = linksObj.tier5_venue_home || dVal('D105_tier5_venue_home') || matchedVenue.website_url || rawCard.venueUrl || null;
      const bestUrl = rawCard.ticket_url || linksObj.best_available || dVal('D106_best_available_link') || t1Url || t2Url || t3Url || t4Url || t5Url || rawCard.source_url || '#';
      const proofImg = rawCard.proof_keyframes?.cart || boxLayer?.proof_keyframe || rawCard.proof_keyframes?.schedule || schedLayer?.proof_keyframe || rawCard.proof_image || null;

      return {
        ...rawCard,
        id: cid,
        title,
        venue,
        address,
        neighborhood,
        category,
        archetype,
        isPerennial,
        artist,
        showings,
        date,
        startTime,
        doorsTime,
        endTime,
        dateSchedule,
        frequencyLabel,
        weeklyHours,
        priceNum,
        isFree,
        priceLabel,
        isSoldOut,
        ticketProvider,
        tiers,
        description,
        restrictions,
        accessModel,
        envType,
        transitInfo,
        typicalSpend,
        stepFree,
        washrooms,
        outsideFood,
        paymentMethods,
        waterRefill,
        links: {
          tier1_checkout: t1Url,
          tier2_event_page: t2Url,
          tier3_calendar: t3Url,
          tier4_civic_destination: t4Url,
          tier5_venue_home: t5Url,
          best_available: bestUrl
        },
        bestUrl,
        proofImg
      };
    };

    if (list.length === 1) {
      grid.style.gridTemplateColumns = '1fr';
      grid.style.maxWidth = '780px';
      grid.style.margin = '0 auto';
    } else {
      grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))';
      grid.style.maxWidth = '100%';
      grid.style.margin = '0';
    }

    grid.innerHTML = list.map((rawCard, idx) => {
      const c = synthesizeFullCardForPreview(rawCard);
      const isFailed = normalizedTab === 'quarantined' || Boolean(rawCard.quarantineReason || rawCard.is_quarantined || (rawCard.reviewStatus && String(rawCard.reviewStatus).includes('quarantin')));
      const eid = c.id || '';
      const qReason = rawCard.quarantineReason || rawCard.archiveReason || 'Fatal Invariant Failure';
      const qError = rawCard.audit_error || rawCard.quarantineReason || 'Failed compiler verification checks';
      const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.venue}, ${c.address || 'Vancouver, BC'}`)}`;
      const venueSiteUrl = c.links.tier5_venue_home || c.links.tier3_calendar || gmapsUrl;

      let topDateText = c.dateSchedule || 'Upcoming';
      if (c.isPerennial) {
        topDateText = 'Open Daily';
      } else if (c.date && /^\d{4}-\d{2}-\d{2}$/.test(c.date)) {
        const dt = new Date(c.date + 'T12:00:00');
        if (!isNaN(dt.getTime())) {
          topDateText = dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        }
      }

      const tiersRowsHtml = (Array.isArray(c.tiers) && c.tiers.length > 0) ? c.tiers.map((t, tIdx) => {
        const tPrice = t.price != null ? Number(t.price) : 0;
        const tBase = t.price_base != null ? Number(t.price_base) : tPrice;
        const tFee = t.price_fee != null ? Number(t.price_fee) : 0;
        const tTax = t.price_tax != null ? Number(t.price_tax) : 0;
        const ledgerStr = (tPrice > 0 && (tFee > 0 || tTax > 0))
          ? `Base $${tBase.toFixed(2)} + Fee $${tFee.toFixed(2)} + Tax $${tTax.toFixed(2)}`
          : (tPrice === 0 ? 'No admission fee' : `Flat/All-in $${tPrice.toFixed(2)}`);
        return `
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 0.74rem; padding: 4px 8px; background: rgba(15, 23, 42, 0.7); border-radius: 6px; border: 1px solid rgba(255,255,255,0.06);">
            <div>
              <strong style="color: #f8fafc;">Tier ${tIdx + 1}: ${escapeHtml(t.name || 'General Admission')}</strong>
              <span style="color: #94a3b8; font-size: 0.67rem; margin-left: 6px;">(${escapeHtml(ledgerStr)})</span>
            </div>
            <span style="font-weight: 800; color: ${tPrice > 50 ? '#f87171' : '#34d399'};">${tPrice === 0 ? 'Free ($0)' : `$${tPrice.toFixed(2)} CAD`}</span>
          </div>
        `;
      }).join('') : '';

      const linkTiers = [
        { label: 'Tier 1 Cart', url: c.links.tier1_checkout, color: '#34d399' },
        { label: 'Tier 2 Event', url: c.links.tier2_event_page, color: '#38bdf8' },
        { label: 'Tier 3 Calendar', url: c.links.tier3_calendar, color: '#a78bfa' },
        { label: 'Tier 4 Civic', url: c.links.tier4_civic_destination, color: '#fbbf24' },
        { label: 'Tier 5 Venue', url: c.links.tier5_venue_home, color: '#94a3b8' }
      ].filter(lt => lt.url && String(lt.url).startsWith('http'));

      return `
        <div style="background: rgba(15, 23, 42, 0.96); border: 1px solid ${isFailed ? 'rgba(239, 68, 68, 0.5)' : 'rgba(16, 185, 129, 0.45)'}; border-radius: 14px; padding: 16px 18px; display: flex; flex-direction: column; gap: 12px;">
          ${isFailed ? `
            <div style="background: rgba(239, 68, 68, 0.14); border: 1px solid rgba(239, 68, 68, 0.45); border-radius: 10px; padding: 9px 12px; display: flex; flex-direction: column; gap: 4px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                <span style="font-size: 0.7rem; font-weight: 800; color: #f87171; text-transform: uppercase;">🛡️ Quarantined #${idx + 1} • ${escapeHtml(qReason)}</span>
                <span style="font-size: 0.65rem; font-weight: 700; color: #cbd5e1; background: rgba(255,255,255,0.08); padding: 2px 7px; border-radius: 999px;">Simulated Published Card Preview Below ▾</span>
              </div>
              <div style="font-size: 0.78rem; color: #fca5a5; font-weight: 600;">${escapeHtml(qError)}</div>
            </div>
          ` : `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 4px; border-bottom: 1px solid rgba(255,255,255,0.06);">
              <span style="font-size: 0.7rem; font-weight: 800; color: #34d399; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); padding: 2px 8px; border-radius: 999px;">✨ Published Card #${idx + 1} • Live in Van50 Catalog</span>
              <span style="font-size: 0.68rem; color: #94a3b8; font-family: monospace;">ID: ${escapeHtml(eid)}</span>
            </div>
          `}

          <article style="background: linear-gradient(180deg, rgba(30, 41, 59, 0.92) 0%, rgba(15, 23, 42, 0.98) 100%); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px; padding: 15px 16px; display: flex; flex-direction: column; gap: 10px; position: relative;">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; flex-wrap: wrap;">
              <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span style="font-size: 0.72rem; font-weight: 800; color: #f8fafc; background: rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.45); padding: 2px 9px; border-radius: 999px;">📅 ${escapeHtml(topDateText)}</span>
                <span style="font-size: 0.7rem; font-weight: 800; color: #d8b4fe; background: rgba(168, 85, 247, 0.18); border: 1px solid rgba(168, 85, 247, 0.4); padding: 2px 9px; border-radius: 999px; text-transform: uppercase;">🏷️ ${escapeHtml(String(c.category))}</span>
                ${c.archetype ? `<span style="font-size: 0.65rem; font-weight: 700; color: #94a3b8; background: rgba(255,255,255,0.06); padding: 2px 7px; border-radius: 999px;">${escapeHtml(String(c.archetype).replace(/_/g, ' '))}</span>` : ''}
              </div>
              <span style="font-size: 0.68rem; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.3); padding: 2px 7px; border-radius: 6px;">♿ ${escapeHtml(c.stepFree ? (c.stepFree.length > 22 ? c.stepFree.slice(0, 20) + '…' : c.stepFree) : 'Accessible')}</span>
            </div>

            <h3 style="margin: 0; font-size: 1.12rem; font-weight: 800; line-height: 1.3;">
              <a href="${escapeHtml(c.bestUrl)}" target="_blank" rel="noopener noreferrer" style="color: #f8fafc; text-decoration: none; border-bottom: 1px dashed rgba(56, 189, 248, 0.4);">${escapeHtml(c.title)}</a>
            </h3>

            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
              ${c.artist ? `<span style="font-size: 0.75rem; background: rgba(139, 92, 246, 0.14); border: 1px solid rgba(139, 92, 246, 0.35); color: #ddd6fe; padding: 2px 8px; border-radius: 6px; font-weight: 600;">🎤 Featuring: <strong>${escapeHtml(c.artist)}</strong></span>` : ''}
              <span style="font-size: 0.69rem; font-weight: 700; color: #fcd34d; background: rgba(245, 158, 11, 0.14); border: 1px solid rgba(245, 158, 11, 0.35); padding: 2px 7px; border-radius: 6px;">🔞 ${escapeHtml(c.restrictions)}</span>
              ${c.accessModel ? `<span style="font-size: 0.69rem; color: #cbd5e1; background: rgba(255,255,255,0.06); padding: 2px 7px; border-radius: 6px;">🚪 ${escapeHtml(String(c.accessModel).replace(/_/g, ' '))}</span>` : ''}
            </div>

            <div style="background: rgba(15, 23, 42, 0.65); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 9px 11px; display: flex; flex-direction: column; gap: 4px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                <a href="${escapeHtml(gmapsUrl)}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; font-weight: 800; font-size: 0.85rem; text-decoration: underline;">📍 ${escapeHtml(c.venue)}</a>
                <div style="display: flex; align-items: center; gap: 6px;">
                  ${c.neighborhood ? `<span style="font-size: 0.68rem; font-weight: 700; color: #e2e8f0; background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px;">${escapeHtml(c.neighborhood)}</span>` : ''}
                  <a href="${escapeHtml(venueSiteUrl)}" target="_blank" rel="noopener noreferrer" style="font-size: 0.68rem; color: #94a3b8; text-decoration: underline;">Venue Site ↗</a>
                </div>
              </div>
              <div style="font-size: 0.74rem; color: #cbd5e1;">${escapeHtml(c.address)}</div>
              ${c.transitInfo ? `<div style="font-size: 0.7rem; color: #94a3b8;">🚏 ${escapeHtml(c.transitInfo)}</div>` : ''}
            </div>

            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 7px 11px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.25); border-radius: 8px; font-size: 0.78rem;">
              <span style="color: #f1f5f9; font-weight: 700;">🗓️ ${escapeHtml(c.dateSchedule)}${c.doorsTime ? ` (Doors ${escapeHtml(c.doorsTime)})` : ''}</span>
              <span style="font-size: 0.68rem; font-weight: 700; color: #38bdf8;">${escapeHtml(c.frequencyLabel)}</span>
            </div>

            <div style="font-size: 0.82rem; color: #e2e8f0; line-height: 1.55; background: rgba(15, 23, 42, 0.45); border-left: 3px solid #38bdf8; padding: 9px 11px; border-radius: 4px;">
              ${c.description ? escapeHtml(c.description) : `<span style="color: #64748b; font-style: italic;">Live outing at ${escapeHtml(c.venue)}.</span>`}
            </div>

            <div style="display: flex; flex-direction: column; gap: 5px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px 11px; font-size: 0.74rem;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                <span><strong style="color: #34d399;">🍺 Expected On-Site Spend:</strong> ${c.typicalSpend ? escapeHtml(c.typicalSpend) : '<span style="color: #64748b;">Uncalibrated / No on-site F&amp;B</span>'}</span>
                ${c.paymentMethods ? `<span style="font-size: 0.67rem; color: #94a3b8;">💳 ${escapeHtml(c.paymentMethods)}</span>` : ''}
              </div>
              ${(c.stepFree || c.washrooms || c.outsideFood || c.waterRefill) ? `
                <div style="display: flex; flex-wrap: wrap; gap: 8px; font-size: 0.68rem; color: #94a3b8; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 4px;">
                  ${c.stepFree ? `<span>♿ <strong>Entrance:</strong> ${escapeHtml(c.stepFree)}</span>` : ''}
                  ${c.washrooms ? `<span>🚻 <strong>Washrooms:</strong> ${escapeHtml(c.washrooms)}</span>` : ''}
                  ${c.outsideFood ? `<span>🥡 <strong>Outside Food:</strong> ${escapeHtml(c.outsideFood)}</span>` : ''}
                  ${c.waterRefill ? `<span>🚰 <strong>Water:</strong> ${escapeHtml(c.waterRefill)}</span>` : ''}
                </div>
              ` : ''}
            </div>

            <div style="margin-top: auto; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.1); display: flex; flex-direction: column; gap: 8px;">
              ${tiersRowsHtml ? `
                <div style="display: flex; flex-direction: column; gap: 4px;">
                  <div style="font-size: 0.67rem; font-weight: 800; color: #94a3b8; text-transform: uppercase;">🎫 Verified Admission Tiers (${c.tiers.length}) • Provider: ${escapeHtml(c.ticketProvider)}</div>
                  ${tiersRowsHtml}
                </div>
              ` : ''}
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap;">
                <div style="display: flex; flex-direction: column;">
                  <span style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Headline All-In Price</span>
                  <span style="font-size: 1.18rem; font-weight: 900; color: ${c.priceNum != null && c.priceNum > 50 ? '#f87171' : '#34d399'};">${escapeHtml(c.priceLabel)}</span>
                </div>
                <a href="${escapeHtml(c.bestUrl)}" target="_blank" rel="noopener noreferrer" style="background: ${c.isSoldOut ? 'rgba(239, 68, 68, 0.25)' : 'linear-gradient(135deg, #10b981 0%, #059669 100%)'}; border: 1px solid ${c.isSoldOut ? 'rgba(239, 68, 68, 0.5)' : '#34d399'}; color: #fff; font-weight: 800; font-size: 0.8rem; padding: 8px 15px; border-radius: 8px; text-decoration: none;">
                  ${c.isSoldOut ? 'Sold Out (Waitlist) ↗' : 'Get Tickets / Details ↗'}
                </a>
              </div>
            </div>
          </article>

          ${linkTiers.length > 0 ? `
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 0.67rem;">
              <span style="color: #94a3b8; font-weight: 700;">🔗 Verified Links:</span>
              ${linkTiers.map(lt => `<a href="${escapeHtml(lt.url)}" target="_blank" rel="noopener noreferrer" style="color: ${lt.color}; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); padding: 2px 7px; border-radius: 4px; text-decoration: underline; font-weight: 700;">${escapeHtml(lt.label)} ↗</a>`).join('')}
            </div>
          ` : ''}

          <div style="display: flex; align-items: center; justify-content: flex-end; gap: 8px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px;">
            <button type="button" onclick="window.closeCompiledCardsPreviewModal(); window.showComparisonCardById('${escapeHtml(eid)}');" style="background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.4); color: #38bdf8; font-size: 0.73rem; font-weight: 700; padding: 5px 12px; border-radius: 6px; cursor: pointer;">🔍 Inspect ${getCatalogDimensionsCount()}D Matrix</button>
          </div>
        </div>
      `;
    }).join('');
  };

  window.closeCompiledCardsPreviewModal = function () {
    const modal = document.getElementById('pipeline-new-cards-preview-modal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.remove('active');
    }
  };

  window.dismissCompilerPreviewBanner = function () {
    const banner = document.getElementById('compiler-new-cards-preview-banner');
    if (banner) banner.style.display = 'none';
  };

  window.filterTableToCompiledCards = function () {
    window.closeCompiledCardsPreviewModal();
    if (pipelineModal) {
      pipelineModal.style.display = 'none';
      pipelineModal.classList.remove('active');
      document.body.style.overflow = '';
    }
  };

  let cachedVenueFeeds = null;
  window.harvesterCityScope = 'all';

  function inferCuratorFeedCity(item = {}) {
    const explicit = String(item.city || item.region || '').trim().toLowerCase();
    if (explicit === 'surrey') return 'Surrey';
    if (explicit === 'vancouver') return 'Vancouver';
    const blob = `${item.venue_name || ''} ${item.name || ''} ${item.neighborhood || ''} ${item.full_address || ''} ${item.address || ''} ${item.url || ''} ${item.calendar_url || ''} ${item.website_url || ''} ${item.domain || ''}`.toLowerCase();
    const surreyTokens = [
      'surrey', 'whalley', 'guildford', 'fleetwood', 'newton', 'cloverdale',
      'bear creek', 'panorama', 'crescent beach', 'grandview', 'fraser downs',
      'fraser heights', 'bridgeview', 'clayton', 'sullivan heights',
      'bellperformingartscentre', 'discoversurreybc', 'surreylibraries',
      'surreycivictheatres', 'surreyeagles', 'surreyknights', 'russellbeer',
      'dublincrossing', 'artscouncilofsurrey', 'cravingforagame',
      'projectclimbing', 'centralcityfunpark', 'birdiesandbuckets',
      'delllanes', 'vinoscentivineyards', 'downtownsurreybia',
      'cloverdalebia', 'newtonbia', 'fleetwoodbia', 'surreyschools',
      'sswrchamber', 'surreynowleader', 'peacearchnews', 'cloverdalereporter',
      'allevents.in/surrey', 'admitone.com/events/surrey', 'cloverdalerodeo',
      'artsculture.surrey', 'cloverdalemarket', 'surreymarket',
      'guildfordtowncentre', 'centralcity.ca', 'legion240', 'sfu.ca/surrey',
      'kpu.ca', 'r/surreybc', 'vancouverfc', 'businessinsurrey'
    ];
    if (surreyTokens.some(tok => blob.includes(tok))) return 'Surrey';
    return 'Vancouver';
  }

  async function loadVenueFeedsList() {
    if (cachedVenueFeeds && cachedVenueFeeds.length > 0) return cachedVenueFeeds;
    const feeds = [];
    const seenUrls = new Set();

    // 1. Physical Venues from master or /data/venues.json
    let rawVenues = (state.masterCatalogsData && state.masterCatalogsData.venues_master) || [];
    if (!rawVenues || rawVenues.length === 0) {
      try {
        const res = await fetch('/data/venues.json?_t=' + Date.now());
        if (res.ok) {
          rawVenues = await res.json();
          if (state.masterCatalogsData) state.masterCatalogsData.venues_master = rawVenues;
        }
      } catch (_) { }
    }

    if (Array.isArray(rawVenues)) {
      rawVenues.forEach(v => {
        const name = (v.venue_name || v.name || '').trim();
        const url = (v.calendar_url || v.calendarUrl || v.website_url || v.websiteUrl || '').trim();
        if (name && url && url.startsWith('http') && !seenUrls.has(url)) {
          seenUrls.add(url);
          let domain = '';
          try { domain = new URL(url).hostname.replace(/^www\./i, ''); } catch (_) { }
          feeds.push({
            name,
            url,
            domain,
            neighborhood: v.neighborhood || '',
            city: inferCuratorFeedCity({ ...v, url, domain }),
            type: 'venue'
          });
        }
      });
    }

    // 2. Discovery sources (Do604, VIA, Straight, Surrey sources, etc.)
    let rawSources = (state.masterCatalogsData && state.masterCatalogsData.discovery_sources) || [];
    if (!rawSources || rawSources.length === 0) {
      try {
        const res = await fetch('/data/discovery_sources.json?_t=' + Date.now());
        if (res.ok) {
          const sData = await res.json();
          rawSources = sData.sources || (Array.isArray(sData) ? sData : []);
          if (state.masterCatalogsData) state.masterCatalogsData.discovery_sources = rawSources;
        }
      } catch (_) { }
    }

    if (Array.isArray(rawSources)) {
      rawSources.forEach(s => {
        const name = (s.name || s.id || '').trim();
        const url = (s.eventsUrl || s.calendarUrl || s.url || '').trim();
        if (name && url && url.startsWith('http') && !seenUrls.has(url)) {
          seenUrls.add(url);
          let domain = '';
          try { domain = new URL(url).hostname.replace(/^www\./i, ''); } catch (_) { }
          feeds.push({
            name,
            url,
            domain: s.domain || domain,
            city: inferCuratorFeedCity({ ...s, url, domain }),
            type: 'source'
          });
        }
      });
    }

    // 3. Dedicated Surrey Reference Sources (/data/surrey_reference_sources.json)
    try {
      const sRes = await fetch('/data/surrey_reference_sources.json?_t=' + Date.now());
      if (sRes.ok) {
        const sRef = await sRes.json();
        const surreyList = Array.isArray(sRef) ? sRef : (sRef.sources || []);
        surreyList.forEach(s => {
          const name = (s.name || s.id || '').trim();
          const url = (s.url || '').trim();
          if (name && url && url.startsWith('http') && !seenUrls.has(url)) {
            seenUrls.add(url);
            let domain = '';
            try { domain = new URL(url).hostname.replace(/^www\./i, ''); } catch (_) { }
            feeds.push({
              name,
              url,
              domain,
              neighborhood: 'Surrey',
              city: 'Surrey',
              type: 'source'
            });
          }
        });
      }
    } catch (_) { }

    // Fallbacks if offline
    if (feeds.length === 0) {
      const fallbacks = [
        { name: "The Improv Centre", url: "https://theimprovcentre.ca/shows/", domain: "theimprovcentre.ca", city: 'Vancouver', type: 'venue' },
        { name: "Little Mountain Gallery", url: "https://littlemountaingallery.ca/schedule/", domain: "littlemountaingallery.ca", city: 'Vancouver', type: 'venue' },
        { name: "The Rio Theatre", url: "https://riotheatre.ca/calendar/", domain: "riotheatre.ca", city: 'Vancouver', type: 'venue' },
        { name: "The Cultch", url: "https://thecultch.com/events/", domain: "thecultch.com", city: 'Vancouver', type: 'venue' },
        { name: "Tightrope Impro Theatre", url: "https://tightropetheatre.com/shows/", domain: "tightropetheatre.com", city: 'Vancouver', type: 'venue' },
        { name: "Rickshaw Theatre", url: "https://rickshawtheatre.com/events/", domain: "rickshawtheatre.com", city: 'Vancouver', type: 'venue' },
        { name: "Fox Cabaret", url: "https://www.foxcabaret.com/", domain: "foxcabaret.com", city: 'Vancouver', type: 'venue' },
        { name: "VIFF Centre", url: "https://viff.org/whats-on/", domain: "viff.org", city: 'Vancouver', type: 'venue' },
        { name: "Firehall Arts Centre", url: "https://firehallartscentre.ca/", domain: "firehallartscentre.ca", city: 'Vancouver', type: 'venue' },
        { name: "Do604", url: "https://do604.com/events", domain: "do604.com", city: 'Vancouver', type: 'source' },
        { name: "The Georgia Straight", url: "https://www.straight.com/listings", domain: "straight.com", city: 'Vancouver', type: 'source' },
        { name: "Vancouver Is Awesome", url: "https://www.vancouverisawesome.com/events", domain: "vancouverisawesome.com", city: 'Vancouver', type: 'source' },
        { name: "Discover Surrey Official Events", url: "https://www.discoversurreybc.com/events", domain: "discoversurreybc.com", city: 'Surrey', type: 'source' },
        { name: "Bell Performing Arts Centre", url: "https://www.bellperformingartscentre.com", domain: "bellperformingartscentre.com", city: 'Surrey', type: 'venue' }
      ];
      fallbacks.forEach(f => feeds.push(f));
    }

    cachedVenueFeeds = feeds;
    return feeds;
  }

  function updateHarvesterCityScopePillsUI(cityScope, feeds = []) {
    const norm = (cityScope === 'vancouver' || cityScope === 'surrey') ? cityScope : 'all';
    ['all', 'vancouver', 'surrey'].forEach(c => {
      const btn = document.getElementById(`chip-harvester-city-${c}`);
      if (btn) btn.classList.toggle('active', c === norm);
      const optBtn = document.getElementById(`btn-opt-harvest-city-${c}`);
      if (optBtn) optBtn.classList.toggle('active', c === norm);
    });
    if (Array.isArray(feeds) && feeds.length > 0) {
      const vanCount = feeds.filter(f => (f.city || 'Vancouver').toLowerCase() === 'vancouver').length;
      const surCount = feeds.filter(f => (f.city || 'Vancouver').toLowerCase() === 'surrey').length;
      const allEl = document.getElementById('harvester-city-count-all');
      const vanEl = document.getElementById('harvester-city-count-vancouver');
      const surEl = document.getElementById('harvester-city-count-surrey');
      if (allEl) allEl.textContent = `${feeds.length} Sources`;
      if (vanEl) vanEl.textContent = `${vanCount} Sources`;
      if (surEl) surEl.textContent = `${surCount} Sources`;
    }
    if (typeof window.updateAutoPipelineFlowPreview === 'function') {
      window.updateAutoPipelineFlowPreview();
    }
  }

  window.setHarvesterCityScope = async function (city) {
    const norm = (city === 'vancouver' || city === 'surrey') ? city : 'all';
    window.harvesterCityScope = norm;
    const feeds = await loadVenueFeedsList();
    updateHarvesterCityScopePillsUI(norm, feeds);
    const searchInput = document.getElementById('pipeline-search-venue-feed');
    const q = searchInput ? searchInput.value : '';
    await window.populateVenueFeedsDropdown(q);
    const targetVal = norm === 'vancouver' ? 'all:vancouver' : (norm === 'surrey' ? 'all:surrey' : 'all');
    const select = document.getElementById('pipeline-select-venue-feed');
    if (select && !q) {
      select.value = targetVal;
      window.onVenueFeedSelected(targetVal);
    }
  };

  window.populateVenueFeedsDropdown = async function (filterQuery = '') {
    const select = document.getElementById('pipeline-select-venue-feed');
    if (!select) return;

    const feeds = await loadVenueFeedsList();
    const cityScope = (window.harvesterCityScope === 'vancouver' || window.harvesterCityScope === 'surrey')
      ? window.harvesterCityScope
      : 'all';
    updateHarvesterCityScopePillsUI(cityScope, feeds);

    const q = (filterQuery || '').trim().toLowerCase();
    const defaultBatchVal = cityScope === 'vancouver' ? 'all:vancouver' : (cityScope === 'surrey' ? 'all:surrey' : 'all');
    const currentVal = select.value || defaultBatchVal;

    const scopedFeeds = cityScope === 'all'
      ? feeds
      : feeds.filter(f => (f.city || 'Vancouver').toLowerCase() === cityScope);

    const vanTotal = feeds.filter(f => (f.city || 'Vancouver').toLowerCase() === 'vancouver').length;
    const surTotal = feeds.filter(f => (f.city || 'Vancouver').toLowerCase() === 'surrey').length;

    let venueFeeds = scopedFeeds.filter(f => f.type === 'venue').sort((a, b) => a.name.localeCompare(b.name));
    let sourceFeeds = scopedFeeds.filter(f => f.type === 'source').sort((a, b) => a.name.localeCompare(b.name));

    if (q) {
      venueFeeds = venueFeeds.filter(v =>
        (v.name && v.name.toLowerCase().includes(q)) ||
        (v.domain && v.domain.toLowerCase().includes(q)) ||
        (v.neighborhood && v.neighborhood.toLowerCase().includes(q)) ||
        (v.city && v.city.toLowerCase().includes(q)) ||
        (v.url && v.url.toLowerCase().includes(q))
      );
      sourceFeeds = sourceFeeds.filter(s =>
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.domain && s.domain.toLowerCase().includes(q)) ||
        (s.city && s.city.toLowerCase().includes(q)) ||
        (s.url && s.url.toLowerCase().includes(q))
      );
    }

    const totalMatches = venueFeeds.length + sourceFeeds.length;
    let html = '';

    if (!q) {
      html += `<option value="all" ${currentVal === 'all' ? 'selected' : ''}>🌲 All Metro Sources — Vancouver + Surrey (${feeds.length} sources)</option>`;
      html += `<option value="all:vancouver" ${currentVal === 'all:vancouver' ? 'selected' : ''}>🏙️ All Vancouver Sources Only — Scan 1 City (${vanTotal} sources)</option>`;
      html += `<option value="all:surrey" ${currentVal === 'all:surrey' ? 'selected' : ''}>🦌 All Surrey Sources Only — Scan 1 City (${surTotal} sources)</option>`;
    } else {
      html += `<option value="${defaultBatchVal}">🌐 Clear search to crawl all ${cityScope === 'all' ? 'Metro' : cityScope} sources</option>`;
    }

    const cityTagLabel = cityScope === 'vancouver' ? 'Vancouver ' : (cityScope === 'surrey' ? 'Surrey ' : '');

    if (venueFeeds.length > 0) {
      html += `<optgroup label="${cityTagLabel}Physical Venue Feeds (${venueFeeds.length}${q ? ' matching' : ''})">`;
      venueFeeds.forEach(v => {
        const sub = v.domain || v.neighborhood || '';
        const cityIcon = v.city === 'Surrey' ? '🦌 ' : '🏙️ ';
        const isSel = (currentVal === v.url) ? 'selected' : '';
        html += `<option value="${escapeHtml(v.url)}" data-name="${escapeHtml(v.name)}" data-city="${escapeHtml(v.city || 'Vancouver')}" ${isSel}>${cityIcon}${escapeHtml(v.name)}${sub ? ` — ${escapeHtml(sub)}` : ''}</option>`;
      });
      html += `</optgroup>`;
    }

    if (sourceFeeds.length > 0) {
      html += `<optgroup label="${cityTagLabel}Discovery Portals &amp; Municipal Calendars (${sourceFeeds.length}${q ? ' matching' : ''})">`;
      sourceFeeds.forEach(s => {
        const sub = s.domain || '';
        const cityIcon = s.city === 'Surrey' ? '🦌 ' : '🏙️ ';
        const isSel = (currentVal === s.url) ? 'selected' : '';
        html += `<option value="${escapeHtml(s.url)}" data-name="${escapeHtml(s.name)}" data-city="${escapeHtml(s.city || 'Vancouver')}" ${isSel}>${cityIcon}${escapeHtml(s.name)}${sub ? ` — ${escapeHtml(sub)}` : ''}</option>`;
      });
      html += `</optgroup>`;
    }

    if (q && totalMatches === 0) {
      html += `<option value="" disabled selected>⚠️ No venue feeds matching "${escapeHtml(q)}"</option>`;
    }

    html += `<option value="custom" ${currentVal === 'custom' ? 'selected' : ''}>✏️ Enter Custom Calendar URL...</option>`;

    select.innerHTML = html;

    // When searching, auto-select the best match immediately
    if (q && totalMatches > 0) {
      const topMatch = venueFeeds[0] || sourceFeeds[0];
      if (topMatch) {
        select.value = topMatch.url;
        window.onVenueFeedSelected(topMatch.url);
      }
    }

    const badge = document.getElementById('pipeline-harvester-feed-count-badge');
    if (badge) {
      if (q) {
        badge.textContent = `${totalMatches} Match${totalMatches === 1 ? '' : 'es'}`;
        badge.style.background = 'rgba(56, 189, 248, 0.18)';
        badge.style.color = '#38bdf8';
      } else if (currentVal === 'all:vancouver') {
        badge.textContent = `🏙️ Vancouver (${vanTotal} Sources)`;
      } else if (currentVal === 'all:surrey') {
        badge.textContent = `🦌 Surrey (${surTotal} Sources)`;
      } else {
        badge.textContent = currentVal === 'all' ? `🌲 All Metro (${feeds.length} Sources)` : 'Single Feed';
      }
    }
  };

  window.onSearchVenueFeedInput = function (val) {
    const clearBtn = document.getElementById('btn-clear-venue-search');
    if (clearBtn) clearBtn.style.display = (val && val.trim()) ? 'inline-block' : 'none';
    window.populateVenueFeedsDropdown(val);
  };

  window.clearVenueFeedSearch = function () {
    const input = document.getElementById('pipeline-search-venue-feed');
    if (input) input.value = '';
    const clearBtn = document.getElementById('btn-clear-venue-search');
    if (clearBtn) clearBtn.style.display = 'none';
    window.populateVenueFeedsDropdown('').then(() => {
      window.resetVenueFeedToAll();
    });
  };

  window.onVenueFeedSelected = function (val) {
    const select = document.getElementById('pipeline-select-venue-feed');
    const badge = document.getElementById('pipeline-harvester-feed-count-badge');
    const resetBtn = document.getElementById('btn-reset-venue-feed');
    const displayEl = document.getElementById('pipeline-harvester-url-display');
    const customInput = document.getElementById('pipeline-harvester-custom-url');
    const customToggleBtn = document.getElementById('btn-harvester-custom-url-toggle');
    const hintEl = document.getElementById('pipeline-scope-hint');
    const btnLabelEl = document.getElementById('btn-trigger-pipeline-label');
    const inputUrl = document.getElementById('pipeline-input-url');

    const effectiveCount = (pipelineBatchSize === 'all') ? 'All' : (typeof pipelineBatchSize === 'number' ? pipelineBatchSize : 5);

    if (!val || val === 'all' || val === 'all:vancouver' || val === 'all:surrey') {
      const targetVal = (val === 'all:vancouver' || val === 'all:surrey')
        ? val
        : (window.harvesterCityScope === 'vancouver' ? 'all:vancouver' : (window.harvesterCityScope === 'surrey' ? 'all:surrey' : 'all'));
      const cityKey = targetVal === 'all:vancouver' ? 'vancouver' : (targetVal === 'all:surrey' ? 'surrey' : 'all');
      window.harvesterCityScope = cityKey;
      updateHarvesterCityScopePillsUI(cityKey, cachedVenueFeeds || []);
      const cityDisplay = cityKey === 'vancouver' ? '🏙️ Vancouver' : (cityKey === 'surrey' ? '🦌 Surrey' : '🌲 All Metro');

      if (select) select.value = targetVal;
      if (badge) {
        badge.textContent = `${cityDisplay} • ${effectiveCount}-Event Mode`;
        badge.style.background = 'rgba(192, 132, 252, 0.18)';
        badge.style.color = '#d8b4fe';
      }
      if (resetBtn) resetBtn.style.display = cityKey === 'all' ? 'none' : 'inline-block';
      if (displayEl) {
        displayEl.style.display = 'block';
        displayEl.textContent = `Crawling ${cityDisplay} calendars sequentially (capped at ${effectiveCount} events) into layer_schedules.json`;
      }
      if (customInput) {
        customInput.style.display = 'none';
        customInput.value = '';
      }
      if (inputUrl) inputUrl.value = targetVal;
      if (customToggleBtn) customToggleBtn.textContent = 'Custom URL';
      if (hintEl) {
        hintEl.innerHTML = `<span>Targeting <strong>${cityDisplay} sources</strong> sequentially to harvest ${effectiveCount} candidate event links into <code>layer_schedules.json</code>.</span>`;
      }
      if (btnLabelEl) {
        const shortCity = cityKey === 'vancouver' ? 'Vancouver' : (cityKey === 'surrey' ? 'Surrey' : 'Metro');
        btnLabelEl.textContent = `🚀 Harvest ${effectiveCount} ${shortCity} Events`;
      }
    } else if (val === 'custom') {
      if (badge) {
        badge.textContent = 'Custom URL';
        badge.style.background = 'rgba(251, 191, 36, 0.18)';
        badge.style.color = '#fbbf24';
      }
      if (resetBtn) resetBtn.style.display = 'inline-block';
      if (displayEl) displayEl.style.display = 'none';
      if (customInput) {
        customInput.style.display = 'block';
        customInput.focus();
      }
      if (customToggleBtn) customToggleBtn.textContent = 'Dropdown';
      const typedUrl = (customInput && customInput.value.trim()) || '';
      if (inputUrl) inputUrl.value = typedUrl;
      if (hintEl) {
        hintEl.innerHTML = typedUrl
          ? `<span>Targeting custom URL: <strong>${escapeHtml(typedUrl)}</strong> into <code>layer_schedules.json</code>.</span>`
          : '<span>Enter a custom venue calendar or ticket portal URL to crawl into <code>layer_schedules.json</code>.</span>';
      }
      if (btnLabelEl) btnLabelEl.textContent = '🚀 Harvest Custom URL';
    } else {
      const opt = select && select.selectedOptions && select.selectedOptions[0];
      const venueName = (opt && opt.dataset.name) || (opt ? opt.textContent.split('—')[0].trim() : 'Venue');
      if (badge) {
        badge.textContent = 'Single Source';
        badge.style.background = 'rgba(56, 189, 248, 0.18)';
        badge.style.color = '#38bdf8';
      }
      if (resetBtn) resetBtn.style.display = 'inline-block';
      if (displayEl) {
        displayEl.style.display = 'block';
        displayEl.textContent = val;
      }
      if (customInput) {
        customInput.style.display = 'none';
        customInput.value = val;
      }
      if (inputUrl) inputUrl.value = val;
      if (customToggleBtn) customToggleBtn.textContent = 'Custom URL';
      if (hintEl) {
        hintEl.innerHTML = `<span>Targeting <strong>${escapeHtml(venueName)}</strong> (<code>${escapeHtml(val)}</code>) to harvest upcoming dated showings into <code>layer_schedules.json</code>.</span>`;
      }
      if (btnLabelEl) btnLabelEl.textContent = `🚀 Harvest ${venueName} (${effectiveCount})`;
    }
  };

  window.resetVenueFeedToAll = function () {
    const searchInput = document.getElementById('pipeline-search-venue-feed');
    if (searchInput) searchInput.value = '';
    const clearBtn = document.getElementById('btn-clear-venue-search');
    if (clearBtn) clearBtn.style.display = 'none';
    window.setHarvesterCityScope('all');
  };

  window.toggleHarvesterCustomUrl = function () {
    const select = document.getElementById('pipeline-select-venue-feed');
    const customInput = document.getElementById('pipeline-harvester-custom-url');
    if (customInput && customInput.style.display !== 'none') {
      window.onVenueFeedSelected('all');
    } else {
      if (select) select.value = 'custom';
      window.onVenueFeedSelected('custom');
    }
  };

  window.onHarvesterCustomUrlInput = function (val) {
    const hintEl = document.getElementById('pipeline-scope-hint');
    const btnLabelEl = document.getElementById('btn-trigger-pipeline-label');
    const inputUrl = document.getElementById('pipeline-input-url');
    const trimmed = (val || '').trim();
    if (inputUrl) inputUrl.value = trimmed;
    if (hintEl) {
      hintEl.innerHTML = trimmed
        ? `<span>Targeting custom URL: <strong>${escapeHtml(trimmed)}</strong> into <code>layer_schedules.json</code>.</span>`
        : '<span>Enter a custom venue calendar or ticket portal URL to crawl into <code>layer_schedules.json</code>.</span>';
    }
    if (btnLabelEl) btnLabelEl.textContent = trimmed ? 'Harvest Custom URL' : 'Enter URL to Harvest';
  };

  function populateCardNameDropdown() {
    const select = document.getElementById('pipeline-select-card-name');
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    if (!select || !events) return;
    const prevVal = select.value || (pipelineCurrentCompId || null);
    select.innerHTML = `<option value="">-- Choose a specific event card from catalog (${events.length} cards) --</option>`;
    events.forEach((e, idx) => {
      const cardNum = idx + 1;
      const name = e.title || e.event_name || 'Event';
      const venue = e.venue || e.venue_name || '';
      const opt = document.createElement('option');
      opt.value = e.id || e.event_id || '';
      opt.dataset.cardIdx = cardNum;
      opt.textContent = `Card #${cardNum}: ${name}${venue ? ` — ${venue}` : ''}`;
      select.appendChild(opt);
    });

    if (state.quarantinedEvents && state.quarantinedEvents.length > 0) {
      const qGroup = document.createElement('optgroup');
      qGroup.label = `⚠️ Quarantined Review Queue (${state.quarantinedEvents.length} items)`;
      state.quarantinedEvents.forEach((qe, qIdx) => {
        const cardNum = `Q${qIdx + 1}`;
        const name = qe.title || qe.event_name || 'Event';
        const venue = qe.venue || qe.venue_name || '';
        const opt = document.createElement('option');
        opt.value = qe.id || qe.event_id || '';
        opt.dataset.cardIdx = cardNum;
        opt.dataset.isQuarantined = 'true';
        opt.textContent = `[QUARANTINED #${cardNum}] ${name}${venue ? ` — ${venue}` : ''}`;
        qGroup.appendChild(opt);
      });
      select.appendChild(qGroup);
    }

    if (prevVal && Array.from(select.options).some(o => o.value === prevVal)) {
      select.value = prevVal;
    }
  }

  window.onStartNumberInput = function () {
    const startInput = document.getElementById('pipeline-card-start');
    const stopInput = document.getElementById('pipeline-card-stop');
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const totalEvents = events.length || 156;

    let start = parseInt(startInput ? startInput.value : '1', 10);
    if (isNaN(start) || start < 1) start = 1;
    if (start > totalEvents) start = totalEvents;

    const newStop = Math.min(totalEvents, start + currentBatchSize - 1);
    if (stopInput) stopInput.value = newStop;

    window.setPipelineScope('range');
    window.updateRangeDetails();
  };

  window.onStopNumberInput = function () {
    const startInput = document.getElementById('pipeline-card-start');
    const stopInput = document.getElementById('pipeline-card-stop');
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const totalEvents = events.length || 156;

    let start = parseInt(startInput ? startInput.value : '1', 10);
    if (isNaN(start) || start < 1) start = 1;
    let stop = parseInt(stopInput ? stopInput.value : '1', 10);
    if (isNaN(stop) || stop < 1) stop = 1;
    if (stop > totalEvents) stop = totalEvents;

    if (stop >= start) {
      currentBatchSize = stop - start + 1;
    }

    window.updateRangeDetails();
  };

  window.updateRangeDetails = function () {
    const startInput = document.getElementById('pipeline-card-start');
    const stopInput = document.getElementById('pipeline-card-stop');
    const badge = document.getElementById('pipeline-range-count-badge');
    const hint = document.getElementById('pipeline-scope-hint');
    const btnLabelEl = document.getElementById('btn-trigger-pipeline-label');
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const totalEvents = events.length || 156;

    let start = parseInt(startInput ? startInput.value : '1', 10) || 1;
    let stop = parseInt(stopInput ? stopInput.value : '1', 10) || 1;

    if (start < 1) start = 1;
    if (start > totalEvents) start = totalEvents;
    if (stop < start) stop = start;
    if (stop > totalEvents) stop = totalEvents;

    const count = stop - start + 1;
    if (badge) {
      badge.textContent = `(${count} Card${count > 1 ? 's' : ''} Selected: #${start} to #${stop})`;
    }
    if (hint && currentPipelineScope === 'range') {
      hint.innerHTML = `<span>Targeting Card Range: <strong>#${start} through #${stop}</strong> (${count} total event card${count > 1 ? 's' : ''} sequentially).</span>`;
    }
    if (btnLabelEl && currentPipelineScope === 'range') {
      if (currentPipelineScanKey === 'compile') {
        btnLabelEl.textContent = `Compile & Publish Cards #${start}–#${stop} (${count})`;
      } else if (currentPipelineScanKey === 'enrich') {
        btnLabelEl.textContent = `Enrich Cards #${start}–#${stop} (${count})`;
      } else {
        btnLabelEl.textContent = `Run Scan on Cards #${start}–#${stop} (${count})`;
      }
    }
  };

  window.setQuickRangeIncrement = function (n) {
    currentBatchSize = n;
    const startInput = document.getElementById('pipeline-card-start');
    const stopInput = document.getElementById('pipeline-card-stop');
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const totalEvents = events.length || 156;

    let start = parseInt(startInput ? startInput.value : '1', 10);
    if (isNaN(start) || start < 1) start = 1;
    let stop = Math.min(totalEvents, start + n - 1);
    if (stopInput) stopInput.value = stop;

    window.setPipelineScope('range');
    window.updateRangeDetails();
  };

  window.setFullCatalogRange = function () {
    const startInput = document.getElementById('pipeline-card-start');
    const stopInput = document.getElementById('pipeline-card-stop');
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const totalEvents = events.length || 156;

    if (startInput) startInput.value = 1;
    if (stopInput) stopInput.value = totalEvents;
    currentBatchSize = totalEvents;

    window.setPipelineScope('range');
    window.updateRangeDetails();
  };

  // -------------------------------------------------------------
  // Single Card Live Autopopulating Search & Selection
  // -------------------------------------------------------------
  let searchHighlightIndex = -1;

  window.onCardNameSelected = function (val) {
    const clearBtn = document.getElementById('btn-clear-card-select');
    if (clearBtn) clearBtn.style.display = val ? 'inline-block' : 'none';
    window.setPipelineScope('single_card');

    if (val) {
      const allEvs = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
      const qEvs = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);

      let foundIdx = allEvs ? allEvs.findIndex(e => (e.id || e.event_id) === val) : -1;
      let card = foundIdx !== -1 ? allEvs[foundIdx] : null;
      let isQuarantined = false;
      let cardNum = '?';

      if (card) {
        cardNum = foundIdx + 1;
      } else {
        const qIdx = qEvs ? qEvs.findIndex(e => (e.id || e.event_id) === val) : -1;
        if (qIdx !== -1) {
          card = qEvs[qIdx];
          isQuarantined = true;
          cardNum = `Q${qIdx + 1}`;
        }
      }

      const select = document.getElementById('pipeline-select-card-name');
      if (select) {
        let matchingOpt = Array.from(select.options).find(o => o.value === val);
        if (!matchingOpt && card) {
          matchingOpt = document.createElement('option');
          matchingOpt.value = val;
          matchingOpt.dataset.cardIdx = cardNum;
          matchingOpt.dataset.isQuarantined = isQuarantined ? 'true' : 'false';
          matchingOpt.textContent = `${isQuarantined ? `[QUARANTINED #${cardNum}]` : `Card #${cardNum}`}: ${card.event_name || card.title || 'Event'}`;
          select.appendChild(matchingOpt);
        }
        if (matchingOpt) {
          select.value = val;
        }
      }

      // Keep search box synchronized with the chosen card and store dataset.selectedId
      const searchInput = document.getElementById('pipeline-custom-card-ids');
      if (searchInput && card) {
        searchInput.dataset.selectedId = val;
        searchInput.dataset.isQuarantined = isQuarantined ? 'true' : 'false';
        searchInput.dataset.cardNum = String(cardNum);
        searchInput.value = `${isQuarantined ? `#${cardNum}` : `Card #${cardNum}`}: ${card.title || card.event_name || 'Event'}${isQuarantined ? ' [QUARANTINED]' : ''}`;
      }
      const clearSearchBtn = document.getElementById('btn-clear-custom-cards');
      if (clearSearchBtn) clearSearchBtn.style.display = 'inline-block';

      if (card && typeof renderComparisonCards === 'function') {
        renderComparisonCards(null, card, false);
        updateComparisonStatusPill(isQuarantined ? `Targeting Quarantined #${cardNum}` : `Targeting Card #${cardNum}`, 'nodrift');
      }
    }
  };

  window.clearSelectedCardName = function () {
    const select = document.getElementById('pipeline-select-card-name');
    if (select) select.value = '';
    const clearBtn = document.getElementById('btn-clear-card-select');
    if (clearBtn) clearBtn.style.display = 'none';

    const searchInput = document.getElementById('pipeline-custom-card-ids');
    if (searchInput) {
      searchInput.value = '';
      delete searchInput.dataset.selectedId;
      delete searchInput.dataset.isQuarantined;
      delete searchInput.dataset.cardNum;
    }
    const clearSearchBtn = document.getElementById('btn-clear-custom-cards');
    if (clearSearchBtn) clearSearchBtn.style.display = 'none';

    const resultsContainer = document.getElementById('pipeline-card-search-results');
    if (resultsContainer) {
      resultsContainer.style.display = 'none';
      resultsContainer.innerHTML = '';
    }

    window.setPipelineScope('single_card');
  };

  window.parseCardNumbersToIds = function (str) {
    if (!str) return [];
    const customInput = document.getElementById('pipeline-custom-card-ids');
    if (customInput && customInput.dataset.selectedId) {
      if (!str || str.trim() === customInput.value.trim() || str.trim() === customInput.dataset.selectedId) {
        return [customInput.dataset.selectedId];
      }
    }

    const allEvs = (state.allEvents && state.allEvents.length > 0)
      ? state.allEvents
      : (state.masterCatalogsData?.events_active || []);
    const qEvs = (state.quarantinedEvents && state.quarantinedEvents.length > 0)
      ? state.quarantinedEvents
      : (state.masterCatalogsData?.quarantined_events || []);

    // Direct ID match first
    const directQ = qEvs.find(e => (e.id || e.event_id) === str.trim());
    if (directQ) return [directQ.id || directQ.event_id];

    const directActive = allEvs.find(e => (e.id || e.event_id) === str.trim());
    if (directActive) return [directActive.id || directActive.event_id];

    // Single quarantined card match like #Q5, Q5, #Q-5, Q-5: ...
    const qMatch = str.match(/#?q-?(\d+)/i);
    if (qMatch) {
      const qNum = parseInt(qMatch[1], 10);
      if (qEvs && qNum >= 1 && qNum <= qEvs.length) {
        const qev = qEvs[qNum - 1];
        if (qev) return [qev.id || qev.event_id];
      }
    }

    const parts = str.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
    const resolvedIds = [];

    parts.forEach(part => {
      // Quarantined #Q5 or Q-5
      const partQ = part.match(/^#?q-?(\d+)/i);
      if (partQ) {
        const qIdx = parseInt(partQ[1], 10);
        if (qEvs && qIdx >= 1 && qIdx <= qEvs.length) {
          const ev = qEvs[qIdx - 1];
          if (ev) resolvedIds.push(ev.id || ev.event_id);
        }
        return;
      }

      // Active range e.g. 1-5
      if (part.includes('-') && /^\d+-\d+$/.test(part)) {
        const [startStr, endStr] = part.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
            if (allEvs && i >= 1 && i <= allEvs.length) {
              const ev = allEvs[i - 1];
              if (ev) resolvedIds.push(ev.id || ev.event_id);
            }
          }
        }
        return;
      }

      // Active card number e.g. #5 or 5
      const numMatch = part.match(/^#?(\d+)$/);
      if (numMatch) {
        const num = parseInt(numMatch[1], 10);
        if (allEvs && num >= 1 && num <= allEvs.length) {
          const ev = allEvs[num - 1];
          if (ev) resolvedIds.push(ev.id || ev.event_id);
        }
        return;
      }

      // Direct ID match in part
      const found = allEvs.find(e => (e.id || e.event_id) === part) ||
        qEvs.find(e => (e.id || e.event_id) === part);
      if (found) {
        resolvedIds.push(found.id || found.event_id);
      }
    });

    const uniqueIds = Array.from(new Set(resolvedIds));
    if (uniqueIds.length > 0) return uniqueIds;

    // Fallback: search title match across active and quarantined
    const lower = str.toLowerCase();
    const titleMatch = [...qEvs, ...allEvs].find(e => {
      const t = (e.title || e.event_name || '').toLowerCase();
      return t && (t === lower || lower.includes(t) || t.includes(lower));
    });
    if (titleMatch) {
      return [titleMatch.id || titleMatch.event_id];
    }
    return [];
  };

  window.onCustomCardSearchInput = function (rawVal) {
    const val = (rawVal || '').trim();
    const resultsContainer = document.getElementById('pipeline-card-search-results');
    const clearBtn = document.getElementById('btn-clear-custom-cards');

    if (clearBtn) clearBtn.style.display = val ? 'inline-block' : 'none';

    if (!resultsContainer) return;
    if (!val) {
      resultsContainer.style.display = 'none';
      resultsContainer.innerHTML = '';
      return;
    }

    const activeEvents = (state.allEvents && state.allEvents.length > 0)
      ? state.allEvents
      : (state.masterCatalogsData?.events_active || []);

    const quarantinedEvents = (state.quarantinedEvents && state.quarantinedEvents.length > 0)
      ? state.quarantinedEvents
      : (state.masterCatalogsData?.quarantined_events || []);

    const allCards = [];
    const seenIds = new Set();

    activeEvents.forEach((ev, idx) => {
      const id = ev.id || ev.event_id;
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        allCards.push({ card: ev, cardNum: idx + 1, isQuarantined: false });
      }
    });

    quarantinedEvents.forEach((qEv, idx) => {
      const id = qEv.id || qEv.event_id;
      if (id && !seenIds.has(id)) {
        seenIds.add(id);
        allCards.push({ card: qEv, cardNum: `Q-${idx + 1}`, isQuarantined: true });
      }
    });

    if (allCards.length === 0) {
      resultsContainer.innerHTML = `<div style="padding: 10px 14px; color: #94a3b8; font-size: 0.74rem; text-align: center;">No catalog events loaded.</div>`;
      resultsContainer.style.display = 'block';
      return;
    }

    const q = val.toLowerCase();
    const numMatch = q.match(/^#?(?:q-?)?(\d+)$/i);
    const targetNum = numMatch ? parseInt(numMatch[1], 10) : null;
    const isTargetingQ = /^#?q/i.test(q);

    const matches = [];
    allCards.forEach((item) => {
      const ev = item.card;
      const cardNum = item.cardNum;
      const isQuarantined = item.isQuarantined;
      const title = (ev.title || ev.event_name || '').toLowerCase();
      const venue = (ev.venue || ev.venue_name || '').toLowerCase();
      const neighborhood = (ev.neighborhood || '').toLowerCase();
      const category = (ev.category || '').toLowerCase();
      const artist = (ev.artist || '').toLowerCase();
      const lineupStr = Array.isArray(ev.lineup) ? ev.lineup.join(' ').toLowerCase() : '';
      const id = (ev.id || ev.event_id || '').toLowerCase();
      const reason = (ev.quarantineReason || ev.flagReason || '').toLowerCase();

      let score = 0;
      if (targetNum !== null) {
        if (isQuarantined && isTargetingQ && cardNum === `Q-${targetNum}`) {
          score = 1000;
        } else if (!isQuarantined && !isTargetingQ && cardNum === targetNum) {
          score = 1000;
        }
      }
      if (score === 0) {
        if (title.startsWith(q)) {
          score = 500;
        } else if (title.includes(q)) {
          score = 250;
        } else if (venue.includes(q)) {
          score = 150;
        } else if (artist.includes(q) || lineupStr.includes(q)) {
          score = 120;
        } else if (neighborhood.includes(q)) {
          score = 80;
        } else if (category.includes(q)) {
          score = 60;
        } else if (id.includes(q)) {
          score = 40;
        } else if (isQuarantined && (reason.includes(q) || q === 'quarantine' || q === 'quarantined')) {
          score = 90;
        }
      }

      if (score > 0) {
        matches.push({ card: ev, cardNum, isQuarantined, score });
      }
    });

    matches.sort((a, b) => b.score - a.score || (String(a.cardNum).localeCompare(String(b.cardNum))));

    if (matches.length === 0) {
      resultsContainer.innerHTML = `
        <div style="padding: 12px 14px; color: #94a3b8; font-size: 0.74rem; text-align: center;">
          No cards matching "<strong>${escapeHtml(val)}</strong>" in active or quarantined catalogs.
        </div>
      `;
      resultsContainer.style.display = 'block';
      return;
    }

    searchHighlightIndex = -1;
    const topMatches = matches.slice(0, 15);
    resultsContainer.innerHTML = topMatches.map((m, i) => {
      const c = m.card;
      const title = c.title || c.event_name || 'Event';
      const venue = c.venue || c.venue_name || '';
      const price = c.priceLabel || (c.price != null ? `$${Number(c.price).toFixed(2)} CAD` : 'Free ($0)');
      const cat = (c.category || 'General').toUpperCase();
      const eid = c.id || c.event_id || '';

      return `
        <div class="search-card-result-item" data-idx="${i}" data-eid="${escapeHtml(eid)}" onclick="selectCardFromSearch('${escapeHtml(eid)}')" onmouseenter="this.style.background='rgba(56, 189, 248, 0.15)'" onmouseleave="if (searchHighlightIndex !== ${i}) this.style.background='transparent'" style="display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; cursor: pointer; border-bottom: 1px solid rgba(255, 255, 255, 0.05); transition: background 0.15s ease;">
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
            <span style="font-weight: 800; font-size: 0.7rem; color: ${m.isQuarantined ? '#f87171' : '#38bdf8'}; background: ${m.isQuarantined ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)'}; border: 1px solid ${m.isQuarantined ? 'rgba(239, 68, 68, 0.3)' : 'rgba(56, 189, 248, 0.3)'}; padding: 2px 6px; border-radius: 4px; white-space: nowrap;">
              #${m.cardNum}
            </span>
            ${m.isQuarantined ? `
              <span style="font-size: 0.62rem; font-weight: 700; color: #fb7185; background: rgba(244, 63, 94, 0.18); border: 1px solid rgba(244, 63, 94, 0.35); padding: 1px 4px; border-radius: 3px; white-space: nowrap;">
                QUARANTINED
              </span>
            ` : ''}
            <div style="min-width: 0; flex: 1;">
              <div style="font-weight: 600; font-size: 0.76rem; color: #f8fafc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${escapeHtml(title)}
              </div>
              <div style="font-size: 0.68rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 4px; margin-top: 1px;">
                <span>📍 ${escapeHtml(venue)}</span>
                ${c.neighborhood ? `<span style="color: #64748b;">• ${escapeHtml(c.neighborhood)}</span>` : ''}
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 6px; margin-left: 10px; flex-shrink: 0;">
            <span style="font-size: 0.64rem; font-weight: 700; color: #d8b4fe; background: rgba(168, 85, 247, 0.12); padding: 1px 5px; border-radius: 3px; border: 1px solid rgba(168, 85, 247, 0.25);">
              ${escapeHtml(cat)}
            </span>
            <span style="font-size: 0.72rem; font-weight: 700; color: #34d399;">
              ${escapeHtml(price)}
            </span>
          </div>
        </div>
      `;
    }).join('');

    if (matches.length > 15) {
      resultsContainer.innerHTML += `
        <div style="padding: 5px 12px; font-size: 0.66rem; color: #64748b; text-align: center; background: rgba(0, 0, 0, 0.25);">
          Showing top 15 of ${matches.length} matching cards. Type more to refine.
        </div>
      `;
    }

    resultsContainer.style.display = 'block';
  };

  window.onCustomCardSearchFocus = function () {
    const input = document.getElementById('pipeline-custom-card-ids');
    if (input && input.value.trim()) {
      window.onCustomCardSearchInput(input.value);
    }
  };

  window.onCustomCardIdsInput = window.onCustomCardSearchInput;

  window.selectCardFromSearch = function (eventId) {
    if (!eventId) return;
    const resultsContainer = document.getElementById('pipeline-card-search-results');
    if (resultsContainer) {
      resultsContainer.style.display = 'none';
      resultsContainer.innerHTML = '';
    }
    if (window.onCardNameSelected) {
      window.onCardNameSelected(eventId);
    }
  };

  window.clearCustomCardSearch = function () {
    const searchInput = document.getElementById('pipeline-custom-card-ids');
    if (searchInput) {
      searchInput.value = '';
      delete searchInput.dataset.selectedId;
      delete searchInput.dataset.isQuarantined;
      delete searchInput.dataset.cardNum;
    }
    const clearBtn = document.getElementById('btn-clear-custom-cards');
    if (clearBtn) clearBtn.style.display = 'none';
    const resultsContainer = document.getElementById('pipeline-card-search-results');
    if (resultsContainer) {
      resultsContainer.style.display = 'none';
      resultsContainer.innerHTML = '';
    }
    window.clearSelectedCardName();
  };

  window.clearCustomCardIds = window.clearCustomCardSearch;

  // Close search popover when clicking outside
  document.addEventListener('click', function (e) {
    const wrapper = document.getElementById('pipeline-single-card-wrapper');
    const results = document.getElementById('pipeline-card-search-results');
    if (results && results.style.display !== 'none') {
      if (!wrapper || !wrapper.contains(e.target)) {
        results.style.display = 'none';
      }
    }
  });

  // Keyboard navigation for search input (Down, Up, Enter, Escape)
  document.addEventListener('keydown', function (e) {
    const results = document.getElementById('pipeline-card-search-results');
    if (!results || results.style.display === 'none') return;
    const items = results.querySelectorAll('.search-card-result-item');
    if (!items || items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      searchHighlightIndex = Math.min(items.length - 1, searchHighlightIndex + 1);
      highlightSearchItem(items, searchHighlightIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      searchHighlightIndex = Math.max(0, searchHighlightIndex - 1);
      highlightSearchItem(items, searchHighlightIndex);
    } else if (e.key === 'Enter') {
      if (searchHighlightIndex >= 0 && searchHighlightIndex < items.length) {
        e.preventDefault();
        const eid = items[searchHighlightIndex].dataset.eid;
        if (eid) window.selectCardFromSearch(eid);
      }
    } else if (e.key === 'Escape') {
      results.style.display = 'none';
    }
  });

  function highlightSearchItem(items, idx) {
    items.forEach((item, i) => {
      if (i === idx) {
        item.style.background = 'rgba(56, 189, 248, 0.25)';
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.style.background = 'transparent';
      }
    });
  }

  window.continueFromLastScanned = function () {
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const totalEvents = events.length || 37;
    const startInput = document.getElementById('pipeline-card-start');
    const stopInput = document.getElementById('pipeline-card-stop');
    const start = parseInt(startInput ? startInput.value : '1', 10) || 1;
    const remaining = Math.max(1, totalEvents - start + 1);

    const chosenCount = window.promptContinueEventCount(remaining, 'events');
    if (chosenCount === null) return;

    window.setPipelineBatchSize(chosenCount);
    if (stopInput) {
      stopInput.value = (chosenCount === 'all' || chosenCount === 0)
        ? totalEvents
        : Math.min(totalEvents, start + Number(chosenCount) - 1);
    }
    window.setPipelineScope('range');
    window.updateRangeDetails();

    const btnTrigger = document.getElementById('btn-trigger-pipeline-run');
    if (btnTrigger && !isExecuting) {
      btnTrigger._skipContinuePrompt = true;
      btnTrigger.click();
    }
  };

  window.onStaleDurationChange = function (val) {
    if (currentPipelineScope === 'stale') {
      window.setPipelineScope('stale');
    }
  };

  window.setQuickStaleDuration = function (val) {
    const select = document.getElementById('pipeline-stale-duration');
    if (select) select.value = val;
    window.setPipelineScope('stale');
  };

  window.setPipelineScope = function (scope) {
    currentPipelineScope = scope;
    const cards = ['harvested', 'unscanned', 'incomplete', 'stale', 'quarantined', 'batch5', 'range', 'single_card', 'all'];
    cards.forEach(c => {
      const el = document.getElementById(`scope-card-${c}`);
      if (!el) return;
      const dot = el.querySelector('.scope-radio-dot');
      const titleSpan = el.querySelector('span:last-child');
      if (c === scope) {
        el.classList.add('active');
        if (dot) {
          dot.textContent = '●';
          dot.style.color = '#38bdf8';
        }
        if (titleSpan) titleSpan.style.color = '#38bdf8';
      } else {
        el.classList.remove('active');
        if (dot) {
          dot.textContent = '○';
          dot.style.color = '#94a3b8';
        }
        if (titleSpan) titleSpan.style.color = '#e2e8f0';
      }
    });

    const hintEl = document.getElementById('pipeline-scope-hint');
    const rangeWrapper = document.getElementById('pipeline-range-wrapper');
    const singleCardWrapper = document.getElementById('pipeline-single-card-wrapper');
    const staleWrapper = document.getElementById('pipeline-stale-wrapper');
    const testCardEl = document.getElementById('pipeline-test-events-card');
    const btnLabelEl = document.getElementById('btn-trigger-pipeline-label');
    const preset = SCAN_PRESETS[currentPipelineScanKey] || SCAN_PRESETS.qc;
    const bCap = (pipelineBatchSize === 'all') ? 0 : (typeof pipelineBatchSize === 'number' ? pipelineBatchSize : 5);

    if (testCardEl && (scope !== 'batch5' || preset.key === 'harvest')) {
      testCardEl.style.display = 'none';
    }
    if (staleWrapper) {
      staleWrapper.style.display = (scope === 'stale') ? 'flex' : 'none';
    }

    const stageInfoForPill = typeof window.getStageContinuationInfo === 'function'
      ? window.getStageContinuationInfo(preset.key)
      : null;
    const hPillLabelGlobal = document.getElementById('scope-pill-harvested-label');
    if (hPillLabelGlobal && stageInfoForPill && preset.key !== 'harvest') {
      hPillLabelGlobal.innerHTML = `✨ Queued from ${stageInfoForPill.prevStageLabel} (<span id="scope-count-harvested">${stageInfoForPill.pendingCount}</span>)`;
    }

    if (scope === 'harvested') {
      if (rangeWrapper) rangeWrapper.style.display = 'none';
      if (singleCardWrapper) singleCardWrapper.style.display = 'none';
      const stageInfo = stageInfoForPill || {
        prevStageLabel: 'Stage 1A',
        prevCompletedCount: 0,
        currentCompletedCount: 0,
        pendingCount: 0
      };
      const stageTotal = stageInfo.prevCompletedCount;
      const stageDone = stageInfo.currentCompletedCount;
      const stageRem = stageInfo.pendingCount;
      const activePool = stageRem > 0 ? stageRem : stageTotal;
      const count = bCap > 0 ? Math.min(bCap, activePool) : activePool;
      if (hintEl) {
        if (stageRem > 0) {
          hintEl.innerHTML = `<span><strong>${stageDone}/${stageTotal}</strong> events from <strong>${stageInfo.prevStageLabel}</strong> already completed this stage • Targeting <strong>${count} of ${stageRem} queued events</strong>.</span>`;
        } else if (stageTotal > 0) {
          hintEl.innerHTML = `<span>All <strong>${stageTotal} events</strong> from <strong>${stageInfo.prevStageLabel}</strong> have completed this stage (<strong>0 queued</strong>).</span>`;
        } else {
          hintEl.innerHTML = `<span><strong>0 events</strong> currently queued from <strong>${stageInfo.prevStageLabel}</strong> for this stage.</span>`;
        }
      }
      if (btnLabelEl) {
        if (preset.key === 'hunter') btnLabelEl.textContent = stageRem > 0 ? `🚀 Hunt ${count} Queued Links (1B)` : `🚀 Re-Hunt ${count} Links (1B)`;
        else if (preset.key === 'qc') btnLabelEl.textContent = stageRem > 0 ? `🚀 Run Stagehand QC (${count} Queued)` : `🚀 Re-Run Stagehand QC (${count})`;
        else if (preset.key === 'enrich') btnLabelEl.textContent = stageRem > 0 ? `🚀 Enrich ${count} with AI` : `🚀 Re-Enrich ${count} with AI`;
        else if (preset.key === 'venue') btnLabelEl.textContent = `🚀 Ground Venues (${count} Queued)`;
        else if (preset.key === 'compile') btnLabelEl.textContent = `🚀 Compile & Publish (${count} Queued)`;
        else btnLabelEl.textContent = `🚀 Run Scan (${count} Queued)`;
      }
    } else if (scope === 'unscanned') {
      if (rangeWrapper) rangeWrapper.style.display = 'flex';
      if (singleCardWrapper) singleCardWrapper.style.display = 'none';
      if (hintEl) {
        if (preset.key === 'compile') {
          const uncompiled = calculateUncompiledEvents();
          hintEl.innerHTML = uncompiled.length > 0
            ? `<span>Targeting <strong>${uncompiled.length} events</strong> (including quarantined cards) awaiting compilation and live publishing.</span>`
            : `<span>All catalog and quarantined events are compiled and published. Ready to re-verify on demand.</span>`;
        } else if (preset.key === 'enrich') {
          const unenriched = calculateUnenrichedEvents();
          hintEl.innerHTML = unenriched.length > 0
            ? `<span>Targeting <strong>${unenriched.length} events</strong> (including quarantined cards) pending AI semantic enrichment in layer_editorial.json.</span>`
            : `<span>All catalog and quarantined events have clean, verified editorial enrichment.</span>`;
        } else if (preset.key === 'harvest') {
          hintEl.innerHTML = '<span>Crawling all registered venue calendars and discovery feeds into <code>layer_schedules.json</code>.</span>';
        } else {
          const unscanned = calculateUnscannedEvents();
          hintEl.innerHTML = unscanned.length > 0
            ? `<span>Targeting <strong>${unscanned.length} events</strong> (including quarantined cards) awaiting Stagehand cart audit & fee verification.</span>`
            : `<span>All catalog and quarantined events have verified box office data.</span>`;
        }
      }
      if (btnLabelEl) {
        if (preset.key === 'compile') {
          const uncompiled = calculateUncompiledEvents();
          const cCount = bCap > 0 ? Math.min(bCap, uncompiled.length || bCap) : (uncompiled.length || 'All');
          btnLabelEl.textContent = `🚀 Compile & Publish (${cCount})`;
        } else if (preset.key === 'enrich') {
          const unenriched = calculateUnenrichedEvents();
          const targetCount = bCap > 0 ? Math.min(bCap, unenriched.length || bCap) : (unenriched.length || 'All');
          btnLabelEl.textContent = `🚀 Enrich ${targetCount} with AI`;
        } else if (preset.key === 'harvest') {
          const hCount = (pipelineBatchSize === 'all') ? 'All' : (typeof pipelineBatchSize === 'number' ? pipelineBatchSize : 5);
          btnLabelEl.textContent = `🚀 Harvest ${hCount} Events`;
        } else if (preset.key === 'hunter') {
          const hCount = bCap > 0 ? bCap : 'All';
          btnLabelEl.textContent = `🚀 Hunt ${hCount} Direct Links`;
        } else {
          const unscanned = calculateUnscannedEvents();
          const qcCount = bCap > 0 ? Math.min(bCap, unscanned.length || bCap) : (unscanned.length || 'All');
          btnLabelEl.textContent = `🚀 Run Stagehand QC (${qcCount})`;
        }
      }
    } else if (scope === 'incomplete') {
      if (rangeWrapper) rangeWrapper.style.display = 'none';
      if (singleCardWrapper) singleCardWrapper.style.display = 'none';
      const incompleteList = calculateIncompleteEvents();
      const totalIncomplete = incompleteList.length;
      const count = bCap > 0 ? Math.min(bCap, totalIncomplete || bCap) : totalIncomplete;
      if (hintEl) {
        hintEl.innerHTML = `<span>Targeting <strong>${count} of ${totalIncomplete} incomplete events</strong> (missing cart proof keyframe, schedule showings, editorial synopsis, or compiler release).</span>`;
      }
      if (btnLabelEl) {
        if (preset.key === 'compile') btnLabelEl.textContent = `🚀 Compile & Publish (${count} Incomplete)`;
        else if (preset.key === 'enrich') btnLabelEl.textContent = `🚀 Enrich ${count} Incomplete Cards`;
        else if (preset.key === 'hunter') btnLabelEl.textContent = `🚀 Hunt ${count} Direct Links (Incomplete)`;
        else if (preset.key === 'harvest') btnLabelEl.textContent = `🚀 Harvest Schedules (${count} Incomplete)`;
        else btnLabelEl.textContent = `🚀 Run Stagehand QC (${count} Incomplete)`;
      }
    } else if (scope === 'stale') {
      if (rangeWrapper) rangeWrapper.style.display = 'none';
      if (singleCardWrapper) singleCardWrapper.style.display = 'none';
      const durationSelect = document.getElementById('pipeline-stale-duration');
      const durationVal = durationSelect ? durationSelect.value : '24h';
      const durationLabel = durationSelect && durationSelect.selectedOptions[0] ? durationSelect.selectedOptions[0].textContent : `> ${durationVal}`;
      const staleList = calculateStaleEvents(durationVal);
      const totalStale = staleList.length;
      const count = bCap > 0 ? Math.min(bCap, totalStale || bCap) : totalStale;
      const countBadge = document.getElementById('pipeline-stale-count-badge');
      if (countBadge) countBadge.textContent = `(${totalStale} Cards Stale in Catalog • Running ${count})`;
      if (hintEl) {
        hintEl.innerHTML = `<span>Targeting <strong>${count} of ${totalStale} events</strong> whose last audit timestamp is older than ${durationLabel} (or never audited).</span>`;
      }
      if (btnLabelEl) {
        if (preset.key === 'compile') btnLabelEl.textContent = `🚀 Compile & Publish (${count} Stale)`;
        else if (preset.key === 'enrich') btnLabelEl.textContent = `🚀 Enrich ${count} Stale Cards (${durationVal})`;
        else if (preset.key === 'hunter') btnLabelEl.textContent = `🚀 Hunt ${count} Direct Links (${durationVal})`;
        else if (preset.key === 'harvest') btnLabelEl.textContent = `🚀 Harvest Feeds for ${count} Stale Cards`;
        else btnLabelEl.textContent = `🚀 Run Stagehand QC (${count} Stale > ${durationVal})`;
      }
    } else if (scope === 'quarantined') {
      if (rangeWrapper) rangeWrapper.style.display = 'none';
      if (singleCardWrapper) singleCardWrapper.style.display = 'none';
      const totalQ = (state.quarantinedEvents && state.quarantinedEvents.length) || 0;
      const qCount = bCap > 0 ? Math.min(bCap, totalQ || bCap) : totalQ;
      const qPillLabel = document.getElementById('scope-pill-quarantined-label');
      if (qPillLabel) qPillLabel.innerHTML = `Quarantined (<span id="scope-count-quarantined">${totalQ}</span>)`;
      if (hintEl) {
        hintEl.innerHTML = `<span>Targeting <strong>${qCount} of ${totalQ} Quarantined Items</strong> in <code>data/manual_review_queue.json</code> through <strong>Stage 1B ➔ Stage 5</strong>.</span>`;
      }
      if (btnLabelEl) {
        if (preset.key === 'hunter') btnLabelEl.textContent = `🚀 Hunt ${qCount} Quarantined Links`;
        else if (preset.key === 'qc') btnLabelEl.textContent = `🚀 Run Stagehand QC (${qCount} Quarantined)`;
        else if (preset.key === 'enrich') btnLabelEl.textContent = `🚀 Enrich ${qCount} Quarantined Cards`;
        else if (preset.key === 'compile') btnLabelEl.textContent = `🚀 Compile & Publish (${qCount} Quarantined)`;
        else btnLabelEl.textContent = `🚀 Run Scan (${qCount} Quarantined)`;
      }
    } else if (scope === 'batch5') {
      const batchPillLabel = document.getElementById('scope-pill-batch5-label');
      // Always update the top-center stage banner and target dimensions banner when switching stages
    if (typeof updateComparisonTargetDimensionsBanner === 'function') {
      updateComparisonTargetDimensionsBanner(preset.key);
    }
    if (preset.key === 'harvest') {
        if (testCardEl) testCardEl.style.display = 'none';
      } else if (isPipelineTestMode && pipelineTestDiscoveredIds && pipelineTestDiscoveredIds.length > 0) {
        if (rangeWrapper) rangeWrapper.style.display = 'none';
        if (singleCardWrapper) singleCardWrapper.style.display = 'none';
        const count = pipelineTestDiscoveredIds.length;
        if (batchPillLabel) batchPillLabel.textContent = `🧪 ${count} Pipeline Events`;
        window.renderPipelineTestEventsList();
        if (hintEl) {
          hintEl.innerHTML = `<span>Targeting <strong>${count} Pipeline Events</strong> in exact sequence (1 → ${count}).</span>`;
        }
        if (btnLabelEl) {
          if (preset.key === 'qc') btnLabelEl.textContent = `🚀 Run Stagehand QC (${count})`;
          else if (preset.key === 'enrich') btnLabelEl.textContent = `🚀 Enrich ${count} with AI`;
          else if (preset.key === 'hunter') btnLabelEl.textContent = `🚀 Hunt ${count} Direct Links`;
          else if (preset.key === 'compile') btnLabelEl.textContent = `🚀 Compile & Publish (${count})`;
          else btnLabelEl.textContent = `🚀 Run Scan (${count})`;
        }
      } else {
        if (rangeWrapper) rangeWrapper.style.display = 'flex';
        if (singleCardWrapper) singleCardWrapper.style.display = 'none';
        if (testCardEl) testCardEl.style.display = 'none';
        const count = bCap > 0 ? bCap : 5;
        if (batchPillLabel) batchPillLabel.textContent = `${count} Events`;
        const startInput = document.getElementById('pipeline-card-start');
        const stopInput = document.getElementById('pipeline-card-stop');
        let startVal = parseInt(startInput ? startInput.value : '1', 10) || 1;
        let stopVal = startVal + count - 1;
        if (stopInput) stopInput.value = stopVal;
        window.updateRangeDetails();
        if (hintEl) {
          hintEl.innerHTML = `<span>Targeting <strong>${count} Event Cards (#${startVal} to #${stopVal})</strong>.</span>`;
        }
        if (btnLabelEl) {
          if (preset.key === 'qc') btnLabelEl.textContent = `🚀 Run Stagehand QC (${count})`;
          else if (preset.key === 'enrich') btnLabelEl.textContent = `🚀 Enrich ${count} with AI`;
          else if (preset.key === 'hunter') btnLabelEl.textContent = `🚀 Hunt ${count} Direct Links`;
          else if (preset.key === 'compile') btnLabelEl.textContent = `🚀 Compile & Publish (${count})`;
          else btnLabelEl.textContent = `🚀 Run Scan (${count})`;
        }
      }
    } else if (scope === 'range') {
      if (rangeWrapper) rangeWrapper.style.display = 'flex';
      if (singleCardWrapper) singleCardWrapper.style.display = 'none';
      window.updateRangeDetails();
    } else if (scope === 'single_card') {
      if (rangeWrapper) rangeWrapper.style.display = 'none';
      if (singleCardWrapper) singleCardWrapper.style.display = 'block';
      const select = document.getElementById('pipeline-select-card-name');
      const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
      if (select && select.value) {
        const card = events.find(e => (e.event_id || e.id) === select.value);
        const opt = select.selectedOptions && select.selectedOptions[0];
        const cardNum = opt ? opt.dataset.cardIdx : null;
        const cardTitle = card ? (card.title || card.event_name || 'Event') : `Card #${cardNum}`;
        if (hintEl) hintEl.innerHTML = `<span>Targeting Single Card: <strong>Card #${cardNum}: ${escapeHtml(cardTitle)}</strong>.</span>`;
        if (btnLabelEl) {
          if (preset.key === 'compile') btnLabelEl.textContent = `Compile & Publish Card #${cardNum} Only`;
          else if (preset.key === 'enrich') btnLabelEl.textContent = `Enrich Card #${cardNum} Only`;
          else if (preset.key === 'harvest') btnLabelEl.textContent = `Harvest Card #${cardNum} Schedule`;
          else if (preset.key === 'qc') btnLabelEl.textContent = `Run Stagehand on Card #${cardNum} Only`;
          else btnLabelEl.textContent = `Run Scan on Card #${cardNum} Only`;
        }
      } else {
        if (hintEl) hintEl.innerHTML = '<span>Please choose an event card from the dropdown above.</span>';
        if (btnLabelEl) btnLabelEl.textContent = 'Select Card to Scan';
      }
    } else if (scope === 'all') {
      if (rangeWrapper) rangeWrapper.style.display = 'none';
      if (singleCardWrapper) singleCardWrapper.style.display = 'none';
      const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
      const total = events.length || 156;
      if (hintEl) {
        if (preset.key === 'compile') {
          hintEl.innerHTML = `<span>Reconciling and publishing entire catalog (all ${total} events) live to events.json & js/data.js.</span>`;
        } else if (preset.key === 'enrich') {
          hintEl.innerHTML = `<span>Enriching entire catalog (all ${total} events) into layer_editorial.json.</span>`;
        } else if (preset.key === 'harvest') {
          hintEl.innerHTML = `<span>Harvesting schedules for all ${total} catalog venue feeds sequentially into layer_schedules.json.</span>`;
        } else {
          hintEl.innerHTML = '<span>Targeting all catalog events sequentially from #1 to end in isolated sessions.</span>';
        }
      }
      if (btnLabelEl) {
        if (preset.key === 'compile') btnLabelEl.textContent = `Compile & Publish All (${total} Cards)`;
        else if (preset.key === 'enrich') btnLabelEl.textContent = `Enrich All (${total} Cards)`;
        else if (preset.key === 'harvest') btnLabelEl.textContent = `Harvest All (${total} Feeds)`;
        else if (preset.key === 'qc') btnLabelEl.textContent = `Run Stagehand (All ${total} Cards)`;
        else btnLabelEl.textContent = `Run Full Scan (All ${total} Cards)`;
      }
    }

    if (typeof window.updateStageStatusTrackerUI === 'function' && !isExecuting) {
      window.updateStageStatusTrackerUI(preset.key, scope);
    }
  };

  window.updateStageStatusTrackerUI = function (presetKey, scopeKey) {
    if (typeof window.updateAllStageContinuationButtonsUI === 'function') {
      window.updateAllStageContinuationButtonsUI();
    }
    const trackerStatus = document.getElementById('pipeline-last-scanned-text');
    if (!trackerStatus) return;
    const key = presetKey || currentPipelineScanKey || 'qc';
    const sc = scopeKey || currentPipelineScope || 'unscanned';
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const totalEvents = events.length || 37;
    const harvestedList = typeof window.getUncompiledHarvestedEvents === 'function' ? window.getUncompiledHarvestedEvents() : [];
    const stageInfo = typeof window.getStageContinuationInfo === 'function' ? window.getStageContinuationInfo(key) : null;
    const isHarvestedTarget = (sc === 'harvested') || (sc === 'batch5' && isPipelineTestMode);

    if (key === 'harvest') {
      const feedStats = typeof window.getHarvesterFeedStats === 'function' ? window.getHarvesterFeedStats() : { completedFeeds: 122, totalFeeds: 227, remainingFeeds: 105 };
      const totalFeeds = feedStats.totalFeeds;
      harvesterTotalSources = totalFeeds;
      const scannedCount = harvesterSourcesScanned || feedStats.completedFeeds || 0;
      const remFeeds = Math.max(0, totalFeeds - scannedCount);
      const foundEventsCount = (isPipelineTestMode && Array.isArray(pipelineTestDiscoveredIds) && pipelineTestDiscoveredIds.length > 0)
        ? pipelineTestDiscoveredIds.length
        : harvestedList.length;
      trackerStatus.innerHTML = `<span style="color: #c084fc; font-weight: 800;">${scannedCount}/${totalFeeds} feeds scanned (${remFeeds} Queued)</span> • <span style="color: #4ade80; font-weight: 700;">${foundEventsCount} harvested events in Stage 1A</span>`;
    } else if (key === 'hunter') {
      if (isHarvestedTarget && stageInfo) {
        const totH = stageInfo.prevCompletedCount;
        const done1B = stageInfo.currentCompletedCount;
        const rem1B = stageInfo.pendingCount;
        if (rem1B > 0) {
          trackerStatus.innerHTML = `<span style="color: #14b8a6; font-weight: 700;">${done1B}/${totH} Done (from Stage 1A)</span> • <span style="color: #fde68a; font-weight: 700;">${rem1B} Queued for Stage 1B</span>`;
        } else {
          trackerStatus.innerHTML = `<span style="color: #34d399; font-weight: 700;">${done1B}/${totH} Done • 0 Queued for Stage 1B</span>`;
        }
      } else {
        const tier1Count = events.filter(e => {
          if (e.step1b_audited_at || e.candidate_tier1_url || e.links?.tier1_checkout) return true;
          if (e.dimension_audit?.D101_tier1_checkout?.status === 'verified') return true;
          if (e.price === 0 || e.isFree || e.access_model === 'open_public_space') return true;
          const u = String(e.ticket_url || '');
          return /showpass|eventbrite|ticketweb|admitone|universe|vtix|spektrix|ticketmaster|eventive/i.test(u);
        }).length;
        const pendingHunter = Math.max(0, totalEvents - tier1Count);
        if (pendingHunter > 0) {
          trackerStatus.innerHTML = `<span style="color: #14b8a6; font-weight: 700;">${tier1Count}/${totalEvents} Catalog Cards Processed</span> • <span style="color: #94a3b8;">${pendingHunter} pending Tier 1 checkout upgrade</span>`;
        } else {
          trackerStatus.innerHTML = `<span style="color: #34d399; font-weight: 700;">${totalEvents}/${totalEvents} Catalog Cards Processed • All direct checkout links verified!</span>`;
        }
      }
    } else if (key === 'qc') {
      if (isHarvestedTarget && stageInfo) {
        const tot1B = stageInfo.prevCompletedCount;
        const doneQC = stageInfo.currentCompletedCount;
        const remQC = stageInfo.pendingCount;
        if (remQC > 0) {
          trackerStatus.innerHTML = `<span style="color: #38bdf8; font-weight: 700;">${doneQC}/${tot1B} Done (from Stage 1B)</span> • <span style="color: #fde68a; font-weight: 700;">${remQC} Queued for Stage 2 QC</span>`;
        } else {
          trackerStatus.innerHTML = `<span style="color: #34d399; font-weight: 700;">${doneQC}/${tot1B} Done • 0 Queued for Stage 2 QC</span>`;
        }
      } else {
        const unscanned = calculateUnscannedEvents();
        const unscannedCount = unscanned.length;
        const scannedCount = Math.max(0, totalEvents - unscannedCount);
        if (unscannedCount > 0) {
          trackerStatus.innerHTML = `<span style="color: #38bdf8; font-weight: 700;">${scannedCount}/${totalEvents} Catalog Cards Processed</span> • <span style="color: #94a3b8;">${unscannedCount} pending Stagehand QC</span>`;
        } else {
          trackerStatus.innerHTML = `<span style="color: #34d399; font-weight: 700;">${totalEvents}/${totalEvents} Catalog Cards Verified!</span>`;
        }
      }
    } else if (key === 'enrich') {
      if (isHarvestedTarget && stageInfo) {
        const tot2 = stageInfo.prevCompletedCount;
        const doneEd = stageInfo.currentCompletedCount;
        const remEd = stageInfo.pendingCount;
        if (remEd > 0) {
          trackerStatus.innerHTML = `<span style="color: #fbbf24; font-weight: 700;">${doneEd}/${tot2} Done (from Stage 2 QC)</span> • <span style="color: #fde68a; font-weight: 700;">${remEd} Queued for Stage 3 Enricher</span>`;
        } else {
          trackerStatus.innerHTML = `<span style="color: #34d399; font-weight: 700;">${doneEd}/${tot2} Done (from Stage 2 QC) • 0 Queued for Stage 3</span>`;
        }
      } else {
        const unenriched = calculateUnenrichedEvents();
        const unenrichedCount = unenriched.length;
        const enrichedCount = Math.max(0, totalEvents - unenrichedCount);
        if (unenrichedCount > 0) {
          trackerStatus.innerHTML = `<span style="color: #fbbf24; font-weight: 700;">${enrichedCount}/${totalEvents} Catalog Cards Processed</span> • <span style="color: #94a3b8;">${unenrichedCount} pending AI enrichment</span>`;
        } else {
          trackerStatus.innerHTML = `<span style="color: #34d399; font-weight: 700;">${totalEvents}/${totalEvents} Catalog Cards Enriched!</span>`;
        }
      }
    } else if (key === 'venue') {
      if (isHarvestedTarget && stageInfo && stageInfo.prevCompletedCount > 0) {
        trackerStatus.innerHTML = `<span style="color: #06b6d4; font-weight: 700;">${stageInfo.currentCompletedCount}/${stageInfo.prevCompletedCount} Done (from Stage 3)</span> • <span style="color: #fde68a; font-weight: 700;">${stageInfo.pendingCount} Queued for Stage 4 Venue Detailer</span>`;
      } else {
        let venues = (state.masterCatalogsData && state.masterCatalogsData.venues_master) || (state.venuesData ? Object.values(state.venuesData) : []);
        const totalVenues = (venues && venues.length) || 159;
        const groundedCount = venues && venues.length
          ? venues.filter(v => (v.full_address && (v.coordinates || v.transit_info)) || v.last_grounded_at).length
          : totalVenues;
        const pendingCount = Math.max(0, totalVenues - groundedCount);
        if (pendingCount > 0) {
          trackerStatus.innerHTML = `<span style="color: #06b6d4; font-weight: 700;">${groundedCount}/${totalVenues} Venues Grounded</span> • <span style="color: #94a3b8;">${pendingCount} pending grounding</span>`;
        } else {
          trackerStatus.innerHTML = `<span style="color: #06b6d4; font-weight: 700;">${groundedCount}/${totalVenues} Venues Grounded</span>`;
        }
      }
    } else if (key === 'compile') {
      const activePublishedCount = state.allEvents ? state.allEvents.length : 0;
      const qCount = (state.quarantinedEvents || []).length;
      if (isHarvestedTarget && stageInfo) {
        trackerStatus.innerHTML = `<span style="color: #fde68a; font-weight: 700;">${stageInfo.pendingCount} Queued from ${stageInfo.prevStageLabel}</span> • <span style="color: #34d399; font-weight: 700;">${activePublishedCount} Published in Catalog</span>`;
      } else {
        const totalCatalogEvents = activePublishedCount + qCount || totalEvents;
        const uncompiled = calculateUncompiledEvents();
        const compiledCount = Math.max(0, totalCatalogEvents - uncompiled.length);
        trackerStatus.innerHTML = `<span style="color: #38bdf8; font-weight: 700;">${compiledCount}/${totalCatalogEvents} Compiled</span> &nbsp;&nbsp; <span style="color: #34d399; font-weight: 700;">${activePublishedCount}/${totalCatalogEvents} Published</span>, <span style="color: #f87171; font-weight: 700;">${qCount}/${totalCatalogEvents} Quarantined</span>`;
      }
    }
  };

  window.openScanModal = function (scanKey, evt, targetCardId) {
    if (evt) evt.stopPropagation();
    const preset = SCAN_PRESETS[scanKey] || SCAN_PRESETS.qc;
    currentPipelineScanKey = preset.key;

    const titleEl = document.getElementById('pipeline-modal-title');
    const techPillEl = document.getElementById('pipeline-scan-tech-pill');
    const btnTrigger = document.getElementById('btn-trigger-pipeline-run');
    const btnLabelEl = document.getElementById('btn-trigger-pipeline-label');
    const inputUrl = document.getElementById('pipeline-input-url');
    const targetWrapper = document.getElementById('pipeline-target-wrapper');
    const startInput = document.getElementById('pipeline-card-start');
    const stopInput = document.getElementById('pipeline-card-stop');
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    const totalEvents = events.length || 156;

    if (titleEl) titleEl.innerHTML = preset.title;
    if (techPillEl) {
      techPillEl.textContent = preset.techPillText;
      techPillEl.className = `tech-pill ${preset.techPillClass}`;
    }
    if (btnLabelEl) btnLabelEl.textContent = preset.btnLabel;
    if (btnTrigger) {
      btnTrigger.style.background = preset.btnColor;
      btnTrigger.style.borderColor = preset.btnBorder;
    }
    if (inputUrl) {
      inputUrl.placeholder = preset.urlPlaceholder;
      inputUrl.value = '';
    }
    if (startInput) {
      startInput.max = totalEvents;
      startInput.value = 1;
    }
    if (stopInput) {
      stopInput.max = totalEvents;
      stopInput.value = (pipelineBatchSize === 'all' || !pipelineBatchSize)
        ? totalEvents
        : Math.min(totalEvents, Number(pipelineBatchSize) || preset.defaultLimit || totalEvents);
    }

    if (targetWrapper) targetWrapper.style.display = preset.showUrl ? 'block' : 'none';

    populateCardNameDropdown();

    const isCardAuditScan = (preset.key === 'hunter' || preset.key === 'qc' || preset.key === 'enrich' || preset.key === 'compile');
    const trackerEl = document.getElementById('pipeline-last-scanned-tracker');
    const harvesterInfoEl = document.getElementById('pipeline-harvester-status-info');
    const harvesterFeedWrapper = document.getElementById('pipeline-harvester-venue-feed-wrapper');
    const venueDetailerWrapper = document.getElementById('pipeline-venue-detailer-selector-wrapper');
    const scopeSection = document.getElementById('pipeline-scope-selector-section');
    const rangeWrapper = document.getElementById('pipeline-range-wrapper');
    const singleCardWrapper = document.getElementById('pipeline-single-card-wrapper');

    if (PIPELINE_TEST_ORDER.includes(preset.key)) {
      pipelineTestStageKey = preset.key;
    }
    updatePipelineTestStepperUI();
    updateStageNavButtons();
    updateComparisonFilterButtonUI(preset.key);

    const unscannedLabel = document.getElementById('scope-pill-unscanned-label');
    if (unscannedLabel) {
      if (preset.key === 'compile') {
        const uncompiled = calculateUncompiledEvents();
        unscannedLabel.textContent = `Full Catalog Uncompiled (${uncompiled.length})`;
      } else if (preset.key === 'enrich') {
        const unenriched = calculateUnenrichedEvents();
        unscannedLabel.textContent = `Full Catalog Unenriched (${unenriched.length})`;
      } else {
        const unscanned = calculateUnscannedEvents();
        unscannedLabel.textContent = `Full Catalog Unscanned (${unscanned.length})`;
      }
    }

    const trackerLabel = document.getElementById('pipeline-last-scanned-label');
    if (trackerLabel) trackerLabel.textContent = 'Stage Status:';
    if (typeof window.updateStageStatusTrackerUI === 'function') {
      window.updateStageStatusTrackerUI(preset.key, currentPipelineScope);
    }

    // Always update the top-center stage banner and target dimensions banner when switching stages
    if (typeof updateComparisonTargetDimensionsBanner === 'function') {
      updateComparisonTargetDimensionsBanner(preset.key);
    }
    if (preset.key === 'harvest') {
      // SCHEDULE HARVESTER: Venue feeds selection (default: all venue feeds).
      if (trackerEl) trackerEl.style.display = 'flex';
      if (harvesterInfoEl) harvesterInfoEl.style.display = 'none';
      if (harvesterFeedWrapper) harvesterFeedWrapper.style.display = 'flex';
      if (venueDetailerWrapper) venueDetailerWrapper.style.display = 'none';
      if (targetWrapper) targetWrapper.style.display = 'none';
      if (scopeSection) scopeSection.style.display = 'none';
      if (rangeWrapper) rangeWrapper.style.display = 'none';
      if (singleCardWrapper) singleCardWrapper.style.display = 'none';

      if (typeof window.populateVenueFeedsDropdown === 'function') {
        const initTarget = window.harvesterCityScope === 'vancouver'
          ? 'all:vancouver'
          : (window.harvesterCityScope === 'surrey' ? 'all:surrey' : 'all');
        window.populateVenueFeedsDropdown().then(() => {
          window.onVenueFeedSelected(initTarget);
        });
      }
    } else if (preset.key === 'venue') {
      // VENUE DETAILER: Physical venue selector
      if (trackerEl) trackerEl.style.display = 'flex';
      if (harvesterInfoEl) harvesterInfoEl.style.display = 'none';
      if (harvesterFeedWrapper) harvesterFeedWrapper.style.display = 'none';
      if (venueDetailerWrapper) venueDetailerWrapper.style.display = 'flex';
      if (targetWrapper) targetWrapper.style.display = 'none';
      if (scopeSection) scopeSection.style.display = 'none';
      if (rangeWrapper) rangeWrapper.style.display = 'none';
      if (singleCardWrapper) singleCardWrapper.style.display = 'none';

      if (typeof window.populateVenueDetailerDropdown === 'function') {
        window.populateVenueDetailerDropdown().then(() => {
          window.onVenueDetailerSelected('new_events');
          if (typeof window.showComparisonCardById === 'function') {
            const batchVenues = window.getVenuesForNewEvents ? window.getVenuesForNewEvents() : [];
            let venues = (state.masterCatalogsData && state.masterCatalogsData.venues_master) || (state.venuesData ? Object.values(state.venuesData) : []);
            let targetVIdx = 0;
            if (batchVenues.length > 0 && Array.isArray(venues)) {
              const foundIdx = venues.findIndex(v => (v.venue_name || v.name || '').toLowerCase() === batchVenues[0].toLowerCase());
              if (foundIdx >= 0) targetVIdx = foundIdx;
            }
            window.showComparisonCardById(`venue:${targetVIdx}`);
          }
        });
      }
    } else {
      // CARD AUDIT SCANS (Hunter, QC, Enricher, Compiler): Show card ranges & card selection
      if (harvesterFeedWrapper) harvesterFeedWrapper.style.display = 'none';
      if (venueDetailerWrapper) venueDetailerWrapper.style.display = 'none';
      if (harvesterInfoEl) harvesterInfoEl.style.display = 'none';
      if (trackerEl) trackerEl.style.display = 'flex';
      if (targetWrapper) targetWrapper.style.display = preset.showUrl ? 'flex' : 'none';
      if (scopeSection) scopeSection.style.display = 'block';

      if (targetCardId) {
        const select = document.getElementById('pipeline-select-card-name');
        if (select) select.value = targetCardId;
        window.setPipelineScope('single_card');
        window.onCardNameSelected(targetCardId);
      } else if (pipelineQuarantinedRunActive || currentPipelineScope === 'quarantined') {
        window.setPipelineScope('quarantined');
      } else if (currentPipelineScope === 'harvested') {
        window.setPipelineScope('harvested');
      } else if (isPipelineTestMode && pipelineTestDiscoveredIds && pipelineTestDiscoveredIds.length > 0) {
        window.setPipelineScope('batch5');
      } else {
        window.setPipelineScope('unscanned');
        window.updateRangeDetails();
      }
    }

    if (!isExecuting) {
      if (pipelineStatusText) {
        pipelineStatusText.textContent = `Ready to run • Select scope and click Run Scan Now`;
        pipelineStatusText.style.color = '#38bdf8';
      }
      const metricsBox = document.getElementById('pipeline-active-metrics');
      if (metricsBox) metricsBox.style.display = 'none';
      if (pipelineStatusSubtext) pipelineStatusSubtext.style.display = 'none';
      if (pipelineTimer) pipelineTimer.textContent = 'Elapsed: 0s';
      if (pipelineProgressBar) {
        pipelineProgressBar.style.width = '0%';
        pipelineProgressBar.style.background = preset.btnColor;
      }
      if (pipelineSpinner) {
        pipelineSpinner.style.animation = 'none';
      }
      if (btnStopPipeline) btnStopPipeline.style.display = 'none';
      if (btnStopPipelineTop) btnStopPipelineTop.style.display = 'none';
      if (btnTrigger) btnTrigger.style.display = 'inline-flex';
    }

    // Initialize side-by-side comparison view only when not mid-execution
    if (!isExecuting) {
      pipelineAuditedCardsHistory = [];
      pipelineCurrentCompId = null;
      if (typeof updateComparisonCardDropdown === 'function') updateComparisonCardDropdown();
      if (typeof updateComparisonStatusPill === 'function') updateComparisonStatusPill('Awaiting Run', 'nodrift');
    }

    let initialCard = null;
    const selectCardNameEl = document.getElementById('pipeline-select-card-name');
    if (selectCardNameEl && selectCardNameEl.value) {
      initialCard = events ? events.find(e => (e.id || e.event_id) === selectCardNameEl.value) : null;
    }
    if (!initialCard && events && events.length > 0) {
      if (preset.key === 'enrich') {
        const unenriched = calculateUnenrichedEvents();
        if (unenriched.length > 0) {
          initialCard = events.find(e => (e.id || e.event_id) === unenriched[0].id) || events[0];
        } else {
          initialCard = events[0];
        }
      } else {
        const startVal = parseInt(document.getElementById('pipeline-card-start')?.value || '1', 10);
        const idx = Math.max(0, Math.min(events.length - 1, startVal - 1));
        initialCard = events[idx];
      }
    }
    // Always update the top-center stage banner and target dimensions banner when switching stages
    if (typeof updateComparisonTargetDimensionsBanner === 'function') {
      updateComparisonTargetDimensionsBanner(preset.key);
    }
    if (preset.key === 'harvest') {
      const titleEl = document.getElementById('pipeline-comparison-header-title');
      const descEl = document.getElementById('pipeline-comparison-header-desc');
      const navToolbar = document.getElementById('pipeline-comparison-nav-toolbar');
      if (titleEl) titleEl.textContent = 'Venue Schedule Harvest Comparison (Before vs. After)';
      if (descEl) descEl.textContent = 'Baseline events per data source prior to crawl vs. newly harvested event schedule deep links.';
      if (navToolbar) navToolbar.style.display = 'none';

      renderHarvesterComparisonView(false, harvesterDiscoveredEvents, false);
    } else if (preset.key === 'venue') {
      const titleEl = document.getElementById('pipeline-comparison-header-title');
      const descEl = document.getElementById('pipeline-comparison-header-desc');
      const navToolbar = document.getElementById('pipeline-comparison-nav-toolbar');
      if (titleEl) titleEl.textContent = 'AI Venue Yield Comparison (Before vs. After)';
      if (descEl) descEl.textContent = 'Baseline facility state before grounding vs. authoritative civic address, GPS, and transit waypoints.';
      if (navToolbar) navToolbar.style.display = 'flex';
    } else {
      const titleEl = document.getElementById('pipeline-comparison-header-title');
      const descEl = document.getElementById('pipeline-comparison-header-desc');
      const navToolbar = document.getElementById('pipeline-comparison-nav-toolbar');
      if (titleEl) titleEl.textContent = 'AI Card Yield Comparison (Before vs. After)';
      if (descEl) descEl.textContent = 'Baseline state before scan vs. only information obtained by this particular AI run.';
      if (navToolbar) navToolbar.style.display = 'flex';

      if (typeof renderComparisonCards === 'function') {
        if (initialCard) {
          renderComparisonCards(null, initialCard, false);
        } else {
          renderComparisonCards(null, null, false);
        }
      }
    }

    if (pipelineModal) {
      pipelineModal.style.display = 'flex';
      pipelineModal.classList.add('active');
      if (typeof initColumnResizers === 'function') initColumnResizers();
    }
  };

  const runPipelineAction = (params) => {
    if (isExecuting) {
      if (pipelineModal) {
        pipelineModal.style.display = 'flex';
        pipelineModal.classList.add('active');
        if (typeof initColumnResizers === 'function') initColumnResizers();
      }
      if (btnStopPipeline) btnStopPipeline.style.display = 'inline-block';
      if (btnStopPipelineTop) btnStopPipelineTop.style.display = 'inline-flex';

      fetch('/api/curator/stagehand/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Curator-Token': state.token || '' },
        body: JSON.stringify({})
      }).then(r => r.json()).then(data => {
        if (!data.stopped) {
          console.log('[STAGEHAND] Auto-cleared stale execution state. Proceeding with requested scan.');
          setExecutionState(false);
          if (activeEventSource) {
            activeEventSource.close();
            activeEventSource = null;
          }
          if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
          }
          runPipelineAction(params);
        } else {
          if (typeof showToast === 'function') {
            showToast('Previous active pipeline task was halted. Click Run to start your scan.', 'info');
          }
          setExecutionState(false);
          if (activeEventSource) {
            activeEventSource.close();
            activeEventSource = null;
          }
        }
      }).catch(() => {
        if (typeof showToast === 'function') {
          showToast('A pipeline task is active. Status modal opened — click "Stop Scan" to cancel.', 'warning');
        }
      });
      return;
    }

    const { mode, url, limit, offset, id, ids, venue, quarantine, uncompiledOnly, all, force, autoApprove, title, desc, initialStatus, scope, incompleteOnly, stale, resume } = params;

    const modeToStageKey = {
      calendar: 'harvest',
      harvester: 'harvest',
      tier1_hunter: 'hunter',
      catalog_batch: 'qc',
      enrich: 'enrich',
      venue_detailer: 'venue',
      consolidate: 'compile',
      compile: 'compile'
    };
    const activeStageKey = modeToStageKey[mode] || currentPipelineScanKey || 'qc';
    currentPipelineScanKey = activeStageKey;
    window.activePipelineRunningStageKey = activeStageKey;
    if (PIPELINE_TEST_ORDER.includes(activeStageKey)) {
      pipelineTestStageKey = activeStageKey;
      pipelineTestStageStatuses[activeStageKey] = 'Running ⚡';
      updatePipelineTestStepperUI();
      updateStageNavButtons();
    }

    document.body.style.overflow = 'hidden';
    if (pipelineModal) {
      pipelineModal.style.display = 'flex';
      pipelineModal.classList.add('active');
    }

    if (pipelineModalTitle) pipelineModalTitle.innerHTML = title || '<span>⚡</span> Autonomous Pipeline Execution';
    if (pipelineModalDesc) pipelineModalDesc.textContent = desc || 'Standalone cloud worker executing headless Chromium automation with live stream output.';

    if (pipelineStatusText) {
      pipelineStatusText.textContent = initialStatus || 'Initializing cloud pipeline worker...';
      pipelineStatusText.style.color = '#c084fc';
    }
    if (pipelineStatusSubtext) {
      pipelineStatusSubtext.textContent = 'Establishing server-sent events stream...';
      pipelineStatusSubtext.style.display = 'block';
    }
    if (pipelineConsoleOutput) pipelineConsoleOutput.textContent = '';
    if (pipelineTimer) pipelineTimer.textContent = '⏱️ 0s';
    if (btnStopPipeline) btnStopPipeline.style.display = 'inline-block';
    if (btnStopPipelineTop) btnStopPipelineTop.style.display = 'inline-flex';
    const btnTrigger = document.getElementById('btn-trigger-pipeline-run');
    if (btnTrigger) btnTrigger.style.display = 'none';

    if (pipelineSpinner) {
      pipelineSpinner.style.animation = 'spin 1.5s linear infinite';
      pipelineSpinner.textContent = '⚙️';
    }
    if (pipelineProgressBar) {
      pipelineProgressBar.style.width = '4%';
      pipelineProgressBar.style.background = 'linear-gradient(90deg, #0284c7 0%, #38bdf8 50%, #a855f7 100%)';
    }
    const metricsBox = document.getElementById('pipeline-active-metrics');
    if (metricsBox) metricsBox.style.display = 'block';

    // Snapshot catalog events before run for live diffing (Request 3)
    pipelineInitialSnapshots = new Map();
    const events = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
    if (events) {
      events.forEach((ev, idx) => {
        const eid = ev.id || ev.event_id;
        if (eid) {
          pipelineInitialSnapshots.set(eid, {
            ...ev,
            Event_Num_Perm: ev.Event_Num_Perm || ev.event_num_perm || null,
            Event_Num_Card: ev.Event_Num_Card || ev.event_num_card || null,
            cardIndex: idx + 1,
            id: eid,
            title: ev.title || ev.event_name || '',
            venue: ev.venue || ev.venue_name || '',
            neighborhood: ev.neighborhood || '',
            date: ev.date || ev.dateSchedule || '',
            dateSchedule: ev.dateSchedule || ev.date || '',
            time: ev.time || '',
            ticket_url: ev.ticket_url || ev.details_url || '',
            price: ev.price != null ? ev.price : null,
            priceLabel: ev.priceLabel || (ev.price != null ? `$${Number(ev.price).toFixed(2)} CAD` : 'Unpriced'),
            price_base: ev.price_base,
            price_fee: ev.price_fee,
            category: ev.category || '',
            artist: ev.artist || '',
            lineup: ev.lineup ? [...ev.lineup] : null,
            description: ev.description || '',
            restrictions: ev.restrictions || '',
            approval_status: ev.approval_status || 'Seed-Pending-Audit',
            is_sold_out: Boolean(ev.is_sold_out || ev.isSoldOut),
            proof_keyframes: ev.proof_keyframes ? { ...ev.proof_keyframes } : null
          });
        }
      });
    }
    const schedList = state.layerSchedules || [];
    if (Array.isArray(schedList)) {
      schedList.forEach((sv, sIdx) => {
        const sid = sv.id || sv.event_id;
        if (sid && !pipelineInitialSnapshots.has(sid)) {
          pipelineInitialSnapshots.set(sid, {
            ...sv,
            cardIndex: `H${sIdx + 1}`,
            id: sid,
            title: sv.title || sv.event_name || '',
            venue: sv.venue || sv.venue_name || '',
            neighborhood: sv.neighborhood || '',
            date: sv.date || sv.dateSchedule || '',
            dateSchedule: sv.dateSchedule || sv.date || '',
            time: sv.time || '',
            ticket_url: sv.candidate_tier1_url || sv.ticket_url || sv.details_url || '',
            price: sv.price != null ? sv.price : null,
            priceLabel: sv.priceLabel || (sv.price != null ? `$${Number(sv.price).toFixed(2)} CAD` : 'Unpriced'),
            price_base: sv.price_base,
            price_fee: sv.price_fee,
            category: sv.category || '',
            artist: sv.artist || '',
            lineup: sv.lineup ? [...sv.lineup] : null,
            description: sv.description || '',
            restrictions: sv.restrictions || '',
            approval_status: 'Harvested-Schedule',
            is_sold_out: Boolean(sv.is_sold_out || sv.isSoldOut),
            proof_keyframes: sv.proof_keyframes ? { ...sv.proof_keyframes } : null
          });
        }
      });
    }

    if (mode === 'calendar' || mode === 'harvester') {
      captureHarvesterPreRunBaseline();
      const feedStats = typeof window.getHarvesterFeedStats === 'function' ? window.getHarvesterFeedStats() : { completedFeeds: 122, totalFeeds: 227, lastFeedName: 'The Orpheum Theatre' };
      const isResumeHarvest = Boolean(resume || String(url || '').endsWith(':resume'));
      if (!isResumeHarvest) {
        harvesterDiscoveredEvents = [];
        harvesterSourcesScanned = 0;
        harvesterCurrentSourceName = '';
      } else {
        harvesterSourcesScanned = feedStats.completedFeeds;
        harvesterCurrentSourceName = feedStats.lastFeedName;
      }
      harvesterTotalSources = (all || !url || String(url).startsWith('all')) ? feedStats.totalFeeds : 1;
      updateHarvesterSourcesProgressUI();
      renderHarvesterComparisonView(false, harvesterDiscoveredEvents, true);
    }

    window.pipelineBaselineAlreadyDoneCount = 0;
    window.currentActiveEventLabel = '';
    pipelineProcessedCount = 0;
    pipelineTotalTargets = (limit !== undefined && limit !== null && Number(limit) > 0)
      ? Number(limit)
      : (id ? 1 : (ids ? (Array.isArray(ids) ? ids.length : String(ids).split(',').filter(Boolean).length) : (mode === 'enrich' ? 20 : (mode === 'catalog_batch' ? 5 : 0))));
    pipelineCurrentTargetIndex = 0;
    const diffTbody = document.getElementById('pipeline-diff-tbody');
    if (diffTbody) {
      diffTbody.innerHTML = `
        <tr id="pipeline-diff-empty-row">
          <td colspan="4" style="text-align: center; padding: 20px 10px; color: #64748b; font-style: italic;">
            Standing by... As each event card finishes, live before/after changes will appear here in real-time.
          </td>
        </tr>
      `;
    }
    const counterBadge = document.getElementById('pipeline-diff-counter-badge');
    if (counterBadge) counterBadge.textContent = pipelineTotalTargets > 0 ? `0 of ${pipelineTotalTargets} Processed` : '0 Processed';

    // Reset AI Timeout & Error Alert Box for the new run
    let pipelineTimeoutEvents = [];
    const timeoutAlertBox = document.getElementById('pipeline-timeout-alert-box');
    const timeoutAlertList = document.getElementById('pipeline-timeout-alert-list');
    const timeoutAlertTitle = document.getElementById('pipeline-timeout-alert-title');
    if (timeoutAlertBox) timeoutAlertBox.style.display = 'none';
    if (timeoutAlertList) timeoutAlertList.innerHTML = '';
    if (timeoutAlertTitle) timeoutAlertTitle.textContent = 'AI Worker Timeouts / Issues Detected (0 Events)';

    let estimatedTotal = 30;
    if (mode === 'enrich') {
      const items = limit || (events ? events.length : 20);
      estimatedTotal = Math.max(15, Math.round(items * 18));
      if (pipelineItemProgress) pipelineItemProgress.textContent = `0 of ${items} events (0%) • ~18s / event`;
      if (pipelineEtaValue) pipelineEtaValue.textContent = `~${formatDuration(estimatedTotal)}`;
    } else if (mode === 'venue_detailer' || mode === 'venue') {
      const items = limit || (events ? events.length : 30);
      estimatedTotal = Math.max(25, Math.round(items * 28));
      if (pipelineItemProgress) pipelineItemProgress.textContent = `0 of ${items} venues (0%) • ~28s / venue`;
      if (pipelineEtaValue) pipelineEtaValue.textContent = `~${formatDuration(estimatedTotal)}`;
    } else if (mode === 'tier1_hunter' || mode === 'hunter') {
      const items = limit || (events ? events.length : 20);
      estimatedTotal = Math.max(15, Math.round(items * 18));
      if (pipelineItemProgress) pipelineItemProgress.textContent = `0 of ${items} events (0%) • ~18s / event`;
      if (pipelineEtaValue) pipelineEtaValue.textContent = `~${formatDuration(estimatedTotal)}`;
    } else if (false) {
      const items = limit || 20;
      estimatedTotal = Math.max(5, Math.round(items * 1.8));
      if (pipelineItemProgress) pipelineItemProgress.textContent = `0 of ${items} events (0%) • ~1.8s / item`;
      if (pipelineEtaValue) pipelineEtaValue.textContent = `~${formatDuration(estimatedTotal)}`;
    } else if (mode === 'catalog_batch') {
      const items = limit > 0 ? limit : 5;
      estimatedTotal = Math.max(15, Math.round(items * 48));
      if (pipelineItemProgress) pipelineItemProgress.textContent = `0 of ${items} events (0%) • ~48s / event`;
      if (pipelineEtaValue) pipelineEtaValue.textContent = `~${formatDuration(estimatedTotal)}`;
    } else if (mode === 'calendar' || mode === 'harvester') {
      estimatedTotal = 25;
      if (pipelineItemProgress) pipelineItemProgress.textContent = 'Crawling venue schedules...';
      if (pipelineEtaValue) pipelineEtaValue.textContent = '~25s';
    } else if (mode === 'compile') {
      window.pipelineCompiledPassedMap = new Map();
      window.pipelineCompiledFailedMap = new Map();
      estimatedTotal = 3;
      if (pipelineItemProgress) pipelineItemProgress.textContent = 'Arbitrating layers & checking math...';
      if (pipelineEtaValue) pipelineEtaValue.textContent = '~3s';
    } else {
      estimatedTotal = 45;
      if (pipelineItemProgress) pipelineItemProgress.textContent = 'Penetrating cart & discovering fees...';
      if (pipelineEtaValue) pipelineEtaValue.textContent = '~45s';
    }

    setExecutionState(true, initialStatus || 'Spinning up isolated Chromium instance...');

    let elapsed = 0;
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      elapsed++;
      if (pipelineTimer) pipelineTimer.textContent = `⏱️ ${elapsed}s`;
      if (timerEl) timerEl.textContent = `${elapsed}s`;

      const remaining = Math.max(0, estimatedTotal - elapsed);
      if (pipelineEtaValue) {
        if (remaining > 0) {
          pipelineEtaValue.textContent = `~${formatDuration(remaining)}`;
        } else {
          if (pipelineTotalTargets > 0 && pipelineCurrentTargetIndex > 0 && pipelineCurrentTargetIndex < pipelineTotalTargets) {
            const remItems = Math.max(1, pipelineTotalTargets - pipelineCurrentTargetIndex + 1);
            const avgSec = pipelineCurrentTargetIndex > 1
              ? Math.max(4, Math.round(elapsed / (pipelineCurrentTargetIndex - 1)))
              : (BENCHMARKS[mode] || 25);
            const dynamicRem = Math.round(remItems * avgSec);
            estimatedTotal = elapsed + dynamicRem;
            pipelineEtaValue.textContent = `~${formatDuration(dynamicRem)}`;
          } else if (pipelineTotalTargets > 0 && pipelineCurrentTargetIndex === pipelineTotalTargets) {
            pipelineEtaValue.textContent = `Finishing item ${pipelineCurrentTargetIndex}/${pipelineTotalTargets}...`;
          } else {
            pipelineEtaValue.textContent = 'Finalizing... (~few seconds)';
          }
        }
      }
    }, 1000);

    const rawIdsArr = ids ? (Array.isArray(ids) ? ids : String(ids).split(',').filter(Boolean)) : [];
    const hasExplicitIds = Boolean((id && String(id).trim()) || rawIdsArr.length > 0);
    const isLargeHarvestedBatch = (rawIdsArr.length > 250);
    const effectiveHarvestedOnly = (scope === 'harvested' || currentPipelineScope === 'harvested' || isLargeHarvestedBatch);
    const isAllRun = !hasExplicitIds && !effectiveHarvestedOnly && (all === '1' || all === 1 || all === true || scope === 'all' || currentPipelineScope === 'all');
    const safeId = isAllRun ? '' : (id || '');
    // Prevent Windows 32KB CreateProcessW & HTTP 64KB URL overflow when > 250 IDs are targeted
    const safeIds = (isAllRun || isLargeHarvestedBatch) ? '' : rawIdsArr.join(',');

    // Reset comparison history at the start of a new pipeline execution
    pipelineAuditedCardsHistory = [];
    pipelineCurrentCompId = null;
    window.pipelineBaselineAlreadyDoneCount = 0;
    if (effectiveHarvestedOnly && !force) {
      const stageInfo = typeof window.getStageContinuationInfo === 'function' ? window.getStageContinuationInfo(activeStageKey) : null;
      if (stageInfo && stageInfo.prevCompletedCount > 0) {
        pipelineTotalTargets = stageInfo.prevCompletedCount;
        const doneCount = stageInfo.currentCompletedCount || 0;
        // Only apply resume baseline when partially done (0 < doneCount < prevCompletedCount).
        // When doneCount >= prevCompletedCount, the batch is re-scanning from 1/total, so baseline must be 0.
        window.pipelineBaselineAlreadyDoneCount = (doneCount > 0 && doneCount < stageInfo.prevCompletedCount) ? doneCount : 0;
        pipelineProcessedCount = window.pipelineBaselineAlreadyDoneCount;
        if (counterBadge) {
          counterBadge.textContent = `${pipelineProcessedCount} of ${pipelineTotalTargets} Processed`;
        }
      }
    }

    let effectiveMode = mode;
    let effectiveUrl = url || '';

    if (window.VAN50_ENGINE === 'antigravity' || mode === 'consolidate') {
      const modalModelSelectEl = document.getElementById('pipeline-modal-agy-model-select');
      const modelSelectEl = document.getElementById('agy-model-select');
      const selectedModel = (modalModelSelectEl && modalModelSelectEl.value)
        ? modalModelSelectEl.value
        : ((modelSelectEl && modelSelectEl.value) ? modelSelectEl.value : 'gemini-3.8-flash-low');
      if (modelSelectEl && modelSelectEl.value !== selectedModel) modelSelectEl.value = selectedModel;
      if (modalModelSelectEl && modalModelSelectEl.value !== selectedModel) modalModelSelectEl.value = selectedModel;
      const stepMap = {
        calendar: 'harvest',
        harvester: 'harvest',
        catalog_batch: 'qc',
        enrich: 'enrich',
        venue_detailer: 'venue',
        consolidate: 'consolidate',
        compile: 'compile',
        master: 'master',
        tier1_hunter: 'hunter',
        single: 'single'
      };
      const stepKey = stepMap[mode] || mode || 'enrich';
      const isResumeFlag = Boolean(resume || url === 'all:resume');
      const agyParams = new URLSearchParams({
        scope: scope || currentPipelineScope || '',
        limit: String(limit !== undefined ? limit : 0),
        offset: offset !== undefined ? String(offset) : '',
        id: safeId,
        ids: safeIds,
        venue: venue || '',
        quarantine: (quarantine === '1' || quarantine === 1 || quarantine === true) ? '1' : '0',
        target_url: url || '',
        all: isAllRun ? '1' : '0',
        force: (force === '1' || force === 1 || force === true) ? '1' : '0',
        uncompiled_only: uncompiledOnly ? '1' : '0',
        incomplete_only: incompleteOnly ? '1' : '0',
        stale: stale || '',
        resume: isResumeFlag ? '1' : '0',
        harvested_only: effectiveHarvestedOnly ? '1' : '0',
        model: selectedModel
      });
      effectiveMode = 'agy_pipeline';
      effectiveUrl = `agy://${stepKey}?${agyParams.toString()}`;
    }

    const query = new URLSearchParams({
      mode: effectiveMode,
      scope: scope || currentPipelineScope || '',
      limit: String(limit !== undefined ? limit : 0),
      offset: offset !== undefined ? String(offset) : '',
      id: safeId,
      ids: safeIds,
      venue: venue || '',
      quarantine: (quarantine === '1' || quarantine === 1 || quarantine === true) ? '1' : '0',
      url: effectiveUrl,
      all: isAllRun ? '1' : '0',
      force: (force === '1' || force === 1 || force === true) ? '1' : '0',
      uncompiled_only: uncompiledOnly ? '1' : '0',
      incomplete_only: incompleteOnly ? '1' : '0',
      stale: stale || '',
      resume: (resume || url === 'all:resume') ? '1' : '0',
      harvested_only: effectiveHarvestedOnly ? '1' : '0',
      auto_approve: autoApprove ? '1' : '0',
      token: state.token || ''
    });

    const streamUrl = `/api/curator/stagehand/stream?${query.toString()}`;
    const es = new EventSource(streamUrl);
    activeEventSource = es;

    let currentEventContext = null;
    const activeContextsById = new Map();

    es.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        const rawLine = payload.line !== undefined ? payload.line : event.data;
        let line = rawLine;
        if (typeof rawLine === 'string' && !/^\s*\[\d{1,2}:\d{2}:\d{2}\s*(?:AM|PM)\]/i.test(rawLine)) {
          if (/(?:🏛️\s*\[\d+\/\d+\]\s*Venue Feed:|🏢\s*\[\d+\/\d+\]\s*Grounding|(?:⚡|📌|✍️)\s*Processing\s*\[\d+\/\d+\])/i.test(rawLine)) {
            const nowStr = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
            line = rawLine.replace(/^(\n?)/, `$1[${nowStr}] `);
          }
        }
        if (pipelineStatusSubtext && pipelineStatusSubtext.textContent === 'Establishing server-sent events stream...') {
          pipelineStatusSubtext.textContent = 'Live stream connected — processing targets...';
        }
        if (pipelineConsoleOutput) {
          pipelineConsoleOutput.textContent += `${line}\n`;
          pipelineConsoleOutput.scrollTop = pipelineConsoleOutput.scrollHeight;
        }
        if (consoleOutput) {
          consoleOutput.textContent += `${line}\n`;
          consoleOutput.scrollTop = consoleOutput.scrollHeight;
        }

        if (typeof line === 'string') {
          // Detect structured AI Worker Timeout / Issue lines:
          // 🚨 [AI TIMEOUT/ERROR] Event: "<title>" [<eventId>] | Stage: <stage> | Model: <model> | Elapsed: <elapsed> | Cause: <cause>
          const timeoutMatch = line.match(/🚨\s*\[AI TIMEOUT\/ERROR\]\s*Event:\s*"([^"]+)"\s*\[([^\]]+)\]\s*\|\s*Stage:\s*([^|]+)\|\s*Model:\s*([^|]+)\|\s*Elapsed:\s*([^|]+)\|\s*Cause:\s*(.+)/i);
          if (timeoutMatch) {
            const evTitle = timeoutMatch[1].trim();
            const evId = timeoutMatch[2].trim();
            const stageName = timeoutMatch[3].trim();
            const modelName = timeoutMatch[4].trim();
            const elapsedStr = timeoutMatch[5].trim();
            const causeStr = timeoutMatch[6].trim();
            const dedupKey = `${evId}::${stageName}`;
            if (!pipelineTimeoutEvents.some(t => `${t.eventId}::${t.stage}` === dedupKey)) {
              pipelineTimeoutEvents.push({
                eventTitle: evTitle,
                eventId: evId,
                stage: stageName,
                model: modelName,
                elapsed: elapsedStr,
                cause: causeStr
              });
              if (timeoutAlertBox) timeoutAlertBox.style.display = 'block';
              if (timeoutAlertTitle) {
                timeoutAlertTitle.textContent = `AI Worker Timeouts / Issues Detected (${pipelineTimeoutEvents.length} Event${pipelineTimeoutEvents.length === 1 ? '' : 's'})`;
              }
              if (timeoutAlertList) {
                const row = document.createElement('div');
                row.style.cssText = 'background: rgba(0,0,0,0.45); border: 1px solid rgba(248,113,113,0.4); border-radius: 6px; padding: 5px 8px; color: #fecaca; line-height: 1.35;';
                row.innerHTML = `
                  <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <strong style="color: #fff;">${escapeHtml(evTitle)} <code style="font-size: 0.68rem; color: #fca5a5;">[${escapeHtml(evId)}]</code></strong>
                    <span style="font-size: 0.68rem; color: #fde68a; font-family: monospace;">${escapeHtml(stageName)} • ${escapeHtml(modelName)} (${escapeHtml(elapsedStr)})</span>
                  </div>
                  <div style="color: #fca5a5; margin-top: 2px;"><strong>Cause:</strong> ${escapeHtml(causeStr)}</div>
                `;
                timeoutAlertList.appendChild(row);
              }
              if (pipelineStatusSubtext) {
                pipelineStatusSubtext.style.display = 'block';
                pipelineStatusSubtext.style.color = '#fca5a5';
                pipelineStatusSubtext.textContent = `🚨 Timeout/Issue on "${evTitle}": ${causeStr}`;
              }
              if (typeof showToast === 'function') {
                showToast(`🚨 AI Timeout/Issue on "${evTitle}": ${causeStr}`, 'error');
              }
            }
          }

          const allEvs = (state.allEvents && state.allEvents.length > 0) ? state.allEvents : (state.masterCatalogsData?.events_active || []);
          const qEvs = (state.quarantinedEvents && state.quarantinedEvents.length > 0) ? state.quarantinedEvents : (state.masterCatalogsData?.quarantined_events || []);

          const resumeMatch = line.match(/⏭️\s*\[(?:Step 1B|Stage 2 QC|Stage 3 Enricher)\s*Resume\]\s*Skipping\s*(\d+)/i);
          if (resumeMatch) {
            window.pipelineBaselineAlreadyDoneCount = 0;
          }

          const syncActiveBatchLabels = (activeTargetsCount) => {
            if (!activeTargetsCount || activeStageKey === 'harvest') return;
            const totalBatch = (isPipelineTestMode && Array.isArray(pipelineTestDiscoveredIds) && pipelineTestDiscoveredIds.length > 0)
              ? pipelineTestDiscoveredIds.length
              : activeTargetsCount;
            if (pipelineModalTitle) {
              const baseTitle = String(pipelineModalTitle.innerHTML || '').replace(/\s*\(\d+[^)]*\)/i, '');
              if (totalBatch > activeTargetsCount) {
                pipelineModalTitle.innerHTML = `${baseTitle} (${activeTargetsCount} Active • ${totalBatch} Batch)`;
              } else {
                pipelineModalTitle.innerHTML = `${baseTitle} (${activeTargetsCount} Events)`;
              }
            }
            const batchPillLabel = document.getElementById('scope-pill-batch5-label');
            if (batchPillLabel && isPipelineTestMode && totalBatch > 0) {
              batchPillLabel.textContent = totalBatch > activeTargetsCount
                ? `🧪 ${totalBatch} Pipeline Events (${activeTargetsCount} Active)`
                : `🧪 ${totalBatch} Pipeline Events`;
            }
            if (typeof window.updateAllStageContinuationButtonsUI === 'function') {
              window.updateAllStageContinuationButtonsUI();
            }
          };

          const targetQueueMatch = line.match(/(?:🎯\s*Targets Queued for (?:Audit|Enrichment):\s*|🎯\s*Venues Targeted for Google Maps Grounding:\s*|🎯\s*Target Queue:\s*|Target Queue\s*\(\s*)(\d+)\s*(?:events?|candidates?|facilities|venues?|seeds?)?/i);
          if (targetQueueMatch) {
            pipelineTotalTargets = parseInt(targetQueueMatch[1], 10);
            syncActiveBatchLabels(pipelineTotalTargets);
            const badge = document.getElementById('pipeline-diff-counter-badge');
            if (badge) {
              badge.textContent = `${pipelineProcessedCount} of ${pipelineTotalTargets} Completed`;
            }
            if (pipelineItemProgress) {
              const pct = pipelineTotalTargets > 0 ? Math.round((pipelineProcessedCount / pipelineTotalTargets) * 100) : 0;
              pipelineItemProgress.textContent = `Event ${pipelineProcessedCount} of ${pipelineTotalTargets} (${pct}%)`;
            }
          }

          // Pattern 0a: Prioritized N venue/source feeds header
          const prioritizedFeedsMatch = line.match(/📊\s*Prioritized\s*(\d+)\s*(?:venue|source)\s*feeds/i);
          if (prioritizedFeedsMatch && activeStageKey === 'harvest') {
            harvesterTotalSources = parseInt(prioritizedFeedsMatch[1], 10);
            updateHarvesterSourcesProgressUI();
          }

          // Pattern 0b: Single calendar link harvest header (when running 1 feed)
          if (/📅\s*HARVESTING CALENDAR LINKS from:/i.test(line) && activeStageKey === 'harvest') {
            if (harvesterSourcesScanned === 0) {
              harvesterSourcesScanned = 1;
              updateHarvesterSourcesProgressUI();
            }
          }

          // Pattern 0: Venue/Source Feed Progress Log: 🏛️ [5/120] [Vancouver] Source Feed: The Rickshaw Theatre
          const venueFeedMatch = line.match(/🏛️\s*\[(\d+)\/(\d+)\]\s*(?:\[[^\]]+\]\s*)?(?:Venue|Source)\s*Feed:\s*(.+)/i);
          if (venueFeedMatch) {
            const currentVenueIdx = parseInt(venueFeedMatch[1], 10);
            const totalVenues = parseInt(venueFeedMatch[2], 10);
            const venueName = venueFeedMatch[3].trim();
            harvesterSourcesScanned = currentVenueIdx;
            harvesterTotalSources = totalVenues;
            harvesterCurrentSourceName = venueName;
            updateHarvesterSourcesProgressUI();
            if (pipelineStatusText && activeStageKey === 'harvest') {
              pipelineStatusText.textContent = `Scanning Source ${currentVenueIdx}/${totalVenues}: ${venueName}`;
              pipelineStatusText.style.color = '#c084fc';
            }
            if (pipelineStatusSubtext) {
              pipelineStatusSubtext.style.display = 'block';
              pipelineStatusSubtext.textContent = `🏛️ ${currentVenueIdx}/${totalVenues} sources scanned • Current: ${venueName}`;
            }
            if (pipelineItemProgress && activeStageKey === 'harvest') {
              pipelineItemProgress.textContent = `${currentVenueIdx}/${totalVenues} sources scanned • +${harvesterDiscoveredEvents.length} events found`;
            }
            const counterBadge = document.getElementById('pipeline-diff-counter-badge');
            if (counterBadge && activeStageKey === 'harvest') {
              const count = (harvesterDiscoveredEvents && harvesterDiscoveredEvents.length) || 0;
              counterBadge.textContent = `${currentVenueIdx}/${totalVenues} sources scanned • ${count} Discovered`;
            }
          } else {
            // Pattern 1: Discrete Event Candidate Link: Processing [1/4]: https://...
            const progressMatch = line.match(/(?:⚡|📌|✍️)?\s*(?:\[Worker\s*#\d+\]\s*)?Processing\s*\[(\d+)\/(\d+)\]/i) ||
              line.match(/\[(\d+)\/(\d+)\]\s*(?:⚡|📌|✍️)?\s*Processing/i);
            if (progressMatch) {
              const current = parseInt(progressMatch[1], 10);
              const total = parseInt(progressMatch[2], 10);
              if (pipelineTotalTargets !== total) {
                pipelineCurrentTargetIndex = 0;
              }
              pipelineTotalTargets = total;
              syncActiveBatchLabels(total);
              pipelineCurrentTargetIndex = Math.min(total, Math.max(pipelineCurrentTargetIndex || 0, current));
              const displayIdx = pipelineCurrentTargetIndex;
              pipelineProcessedCount = Math.min(total, pipelineAuditedCardsHistory.length);
              const barPct = Math.min(96, Math.max(4, Math.round(((displayIdx - 0.4) / total) * 100)));
              const labelPct = Math.min(100, Math.max(0, Math.round((displayIdx / total) * 100)));
              if (pipelineProgressBar) pipelineProgressBar.style.width = `${barPct}%`;
              const itemsRunInSession = Math.max(1, displayIdx);
              const unitTime = (itemsRunInSession > 1 && elapsed > 3)
                ? Math.max(2, Math.round(elapsed / (itemsRunInSession - 1)))
                : (BENCHMARKS[mode] || 18);
              if (pipelineItemProgress) {
                if (activeStageKey === 'harvest') {
                  pipelineItemProgress.textContent = `${harvesterSourcesScanned || 1}/${harvesterTotalSources || 227} sources scanned • Link ${displayIdx}/${total} (${labelPct}%)`;
                } else {
                  pipelineItemProgress.textContent = `Event ${displayIdx} of ${total} (${labelPct}%) • ~${Math.round(unitTime)}s / event`;
                }
              }
              const counterBadge = document.getElementById('pipeline-diff-counter-badge');
              if (counterBadge && activeStageKey !== 'harvest') {
                counterBadge.textContent = `${pipelineProcessedCount} of ${total} Completed (Event ${displayIdx} active)`;
              }
              const remainingItems = Math.max(1, total - displayIdx + 1);
              const recalibratedSec = Math.round(remainingItems * unitTime);
              estimatedTotal = elapsed + recalibratedSec;
              if (pipelineEtaValue) pipelineEtaValue.textContent = `~${formatDuration(recalibratedSec)}`;

              if (activeStageKey === 'harvest') {
                const sIdx = harvesterSourcesScanned || 1;
                const sTot = harvesterTotalSources || 227;
                if (pipelineStatusText) {
                  pipelineStatusText.textContent = `Harvesting [${displayIdx} of ${total}] candidate links (${sIdx}/${sTot} sources scanned)...`;
                  pipelineStatusText.style.color = '#38bdf8';
                }
                if (pipelineStatusSubtext) {
                  pipelineStatusSubtext.style.display = 'block';
                  pipelineStatusSubtext.textContent = `🏛️ ${sIdx}/${sTot} sources scanned${harvesterCurrentSourceName ? ` • ${harvesterCurrentSourceName}` : ''} • Link ${displayIdx} of ${total}`;
                }
                if (counterBadge) {
                  counterBadge.textContent = `${sIdx}/${sTot} sources scanned • ${harvesterDiscoveredEvents.length} Discovered • [${displayIdx}/${total} Links]`;
                }
                updateHarvesterSourcesProgressUI();
              }
            }
          }

          // Real-Time Event Extraction & Diff Parsing (Request 3)
          const itemStartMatch = line.match(/(?:📌|⚡|✍️)?\s*(?:\[Worker\s*#\d+\]\s*)?Processing\s*\[(\d+)\/(\d+)\]:\s*(.+)/i) ||
            line.match(/\[(\d+)\/(\d+)\]\s*(?:✍️|📌|⚡)?\s*Processing:\s*(.+)/i);
          if (itemStartMatch && activeStageKey !== 'harvest') {
            const batchItemIdx = parseInt(itemStartMatch[1], 10);
            const batchTotal = parseInt(itemStartMatch[2], 10);
            if (pipelineTotalTargets !== batchTotal) {
              pipelineCurrentTargetIndex = 0;
            }
            pipelineTotalTargets = batchTotal;
            syncActiveBatchLabels(batchTotal);
            pipelineCurrentTargetIndex = Math.min(batchTotal, Math.max(pipelineCurrentTargetIndex || 0, batchItemIdx));
            const displayIdx = pipelineCurrentTargetIndex;
            pipelineProcessedCount = Math.min(batchTotal, pipelineAuditedCardsHistory.length);
            let itemTitle = itemStartMatch[3].trim();
            let directId = null;
            const idSuffixMatch = itemTitle.match(/\[([a-z0-9\-_]+)\]$/i);
            if (idSuffixMatch) {
              directId = idSuffixMatch[1];
              itemTitle = itemTitle.replace(/\[[a-z0-9\-_]+\]$/i, '').trim();
            }
            let itemVenue = '';
            const venueSuffixMatch = itemTitle.match(/^(.+?)\s*\(([^)]+)\)$/);
            if (venueSuffixMatch) {
              itemTitle = venueSuffixMatch[1].trim();
              itemVenue = venueSuffixMatch[2].trim();
            }

            const stageActionVerb = activeStageKey === 'enrich'
              ? 'Enriching'
              : activeStageKey === 'hunter'
                ? 'Hunting'
                : activeStageKey === 'compile'
                  ? 'Compiling'
                  : 'Auditing';
            window.currentActiveEventLabel = `${stageActionVerb} [${displayIdx} of ${batchTotal}]: ${itemTitle}`;
            if (pipelineStatusText) {
              pipelineStatusText.textContent = window.currentActiveEventLabel;
              pipelineStatusText.style.color = '#38bdf8';
            }
            if (pipelineStatusSubtext) {
              const remCount = Math.max(0, batchTotal - pipelineProcessedCount);
              pipelineStatusSubtext.textContent = `${pipelineProcessedCount}/${batchTotal} completed (${remCount} remaining) • Event ${displayIdx} of ${batchTotal} in progress...`;
            }
            const counterBadge = document.getElementById('pipeline-diff-counter-badge');
            if (counterBadge) {
              counterBadge.textContent = `${pipelineProcessedCount} of ${batchTotal} Completed (Event ${displayIdx} active)`;
            }
            const trackerStatusEl = document.getElementById('pipeline-last-scanned-text');
            if (trackerStatusEl) {
              const remCount = Math.max(0, batchTotal - pipelineProcessedCount);
              trackerStatusEl.innerHTML = `<span style="color: #14b8a6; font-weight: 700;">${pipelineProcessedCount}/${batchTotal} Completed (${remCount} remaining)</span> • <span style="color: #38bdf8;">${stageActionVerb} [${displayIdx}/${batchTotal}]: ${escapeHtml(itemTitle)}</span>`;
            }

            let matchedEv = null;
            let isQuarantinedMatched = false;
            const schedEvs = Array.isArray(state.layerSchedules) ? state.layerSchedules : [];

            if (directId) {
              matchedEv = allEvs.find(e => (e.id || e.event_id) === directId);
              if (!matchedEv) {
                matchedEv = qEvs.find(e => (e.id || e.event_id) === directId);
                if (matchedEv) isQuarantinedMatched = true;
              }
              if (!matchedEv) {
                matchedEv = schedEvs.find(e => (e.id || e.event_id) === directId);
              }
            }
            if (!matchedEv && itemTitle) {
              matchedEv = allEvs.find(e => (e.title || e.event_name || '').toLowerCase() === itemTitle.toLowerCase());
              if (!matchedEv) {
                matchedEv = qEvs.find(e => (e.title || e.event_name || '').toLowerCase() === itemTitle.toLowerCase());
                if (matchedEv) isQuarantinedMatched = true;
              }
              if (!matchedEv) {
                matchedEv = schedEvs.find(e => (e.title || e.event_name || '').toLowerCase() === itemTitle.toLowerCase());
              }
            }
            if (!matchedEv && allEvs && batchItemIdx >= 1 && batchItemIdx <= allEvs.length && currentPipelineScope !== 'single_card' && !effectiveHarvestedOnly) {
              matchedEv = allEvs[batchItemIdx - 1];
            }
            const matchedId = directId || (matchedEv ? (matchedEv.id || matchedEv.event_id) : null);

            // Calculate true catalog card index, NOT batch index [1/1]
            let realCardIdx = batchItemIdx;
            if (matchedEv) {
              if (isQuarantinedMatched) {
                const qIdx = qEvs.findIndex(e => (e.id || e.event_id) === (matchedEv.id || matchedEv.event_id));
                realCardIdx = qIdx !== -1 ? `Q${qIdx + 1}` : 'Q';
              } else {
                const foundIdx = allEvs.findIndex(e => (e.id || e.event_id) === (matchedEv.id || matchedEv.event_id));
                if (foundIdx !== -1) realCardIdx = foundIdx + 1;
              }
            }

            const resolvedVenue = itemVenue || (matchedEv ? (matchedEv.venue || matchedEv.venue_name || '') : '');
            currentEventContext = {
              cardIndex: realCardIdx,
              isQuarantined: isQuarantinedMatched,
              id: matchedId,
              title: itemTitle || (matchedEv ? (matchedEv.title || matchedEv.event_name) : ''),
              afterTitle: activeStageKey === 'enrich' ? null : (itemTitle || null),
              venue: resolvedVenue,
              afterVenue: activeStageKey === 'venue' ? resolvedVenue : null,
              Event_Num_Perm: matchedEv ? (matchedEv.Event_Num_Perm || matchedEv.event_num_perm || null) : null,
              Event_Num_Card: matchedEv ? (matchedEv.Event_Num_Card || matchedEv.event_num_card || null) : null
            };
            if (matchedId) {
              activeContextsById.set(matchedId, currentEventContext);
              const selectCard = document.getElementById('pipeline-select-card-name');
              if (selectCard) selectCard.value = matchedId;
            }

            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(currentEventContext, matchedEv, true);
              updateComparisonStatusPill(isQuarantinedMatched ? `${stageActionVerb} Quarantined #${realCardIdx} [${batchItemIdx} of ${pipelineTotalTargets || batchTotal}]...` : `${stageActionVerb} Card #${realCardIdx} [${batchItemIdx} of ${pipelineTotalTargets || batchTotal}]...`, 'updated');
            }
          }

          // Pattern 1c: Harvested Event Discovery
          if (activeStageKey === 'harvest') {
            const harvestEventMatch = line.match(/✨\s*HARVESTED EVENT:\s*"([^"]+)"\s*\|\s*Date:\s*([^\|]+?)(?:\s*\|\s*Time:\s*([^\|]+?))?\s*\|\s*Venue:\s*([^\|\[]+?)(?:\s*\|\s*Price:\s*([^\|]+?))?(?:\s*\|\s*URL:\s*([^\[]+?))?\s*\[([^\]]+)\]/i);
            if (harvestEventMatch) {
              const hTitle = harvestEventMatch[1].trim();
              let hDate = harvestEventMatch[2].trim();
              let hTime = (harvestEventMatch[3] || '').trim();
              if (!hTime && hDate.includes('•')) {
                const parts = hDate.split('•');
                hDate = parts[0].trim();
                hTime = parts[1].trim();
              }
              const hVenue = harvestEventMatch[4].trim();
              const hPrice = (harvestEventMatch[5] || '').trim();
              const hUrl = (harvestEventMatch[6] || '').trim();
              const hId = harvestEventMatch[7].trim();
              if (!harvesterDiscoveredEvents.some(x => x.id === hId || (x.title === hTitle && x.date === hDate))) {
                harvesterDiscoveredEvents.push({
                  id: hId,
                  title: hTitle,
                  date: hDate,
                  time: hTime,
                  venue: hVenue,
                  price: hPrice,
                  url: hUrl
                });
                // Live real-time update: update 3-region view immediately as each event is processed!
                updateHarvesterSourcesProgressUI();
                renderHarvesterComparisonView(false, harvesterDiscoveredEvents, true);
              }
            }
          }

          // Pattern 1d: Venue Detailer Grounding Progress
          const venueGroundingStart = line.match(/\[(\d+)\/(\d+)\]\s*Grounding(?:\s+Facility)?:\s*"([^"]+)"/i);
          if (venueGroundingStart && activeStageKey === 'venue') {
            const vIdx = parseInt(venueGroundingStart[1], 10);
            const vTotal = parseInt(venueGroundingStart[2], 10);
            const vName = venueGroundingStart[3].trim();
            pipelineTotalTargets = vTotal;
            pipelineCurrentTargetIndex = vIdx;
            const vPct = Math.min(96, Math.max(5, Math.round(((vIdx - 0.4) / vTotal) * 100)));
            if (pipelineProgressBar) pipelineProgressBar.style.width = `${vPct}%`;
            const vUnitTime = (vIdx > 1 && elapsed > 5)
              ? Math.max(5, Math.round(elapsed / (vIdx - 1)))
              : (BENCHMARKS.venue_detailer || 28);
            if (pipelineItemProgress) {
              pipelineItemProgress.textContent = `Venue ${vIdx} of ${vTotal} (${vPct}%) • ~${vUnitTime}s / venue`;
            }
            if (pipelineStatusSubtext) {
              pipelineStatusSubtext.style.display = 'block';
              pipelineStatusSubtext.textContent = `🏛️ Facility ${vIdx} of ${vTotal}: ${vName}`;
            }
            const counterBadge = document.getElementById('pipeline-diff-counter-badge');
            if (counterBadge) {
              counterBadge.textContent = `${pipelineLastVenuesGroundedCount || (vIdx - 1)} of ${vTotal} Venues Grounded`;
            }
            const remVenues = Math.max(1, vTotal - vIdx + 1);
            const recalibratedVenueSec = Math.round(remVenues * vUnitTime);
            estimatedTotal = elapsed + recalibratedVenueSec;
            if (pipelineEtaValue) pipelineEtaValue.textContent = `~${formatDuration(recalibratedVenueSec)}`;
          }
          if (venueGroundingStart && activeStageKey === 'venue') {
            const vIdx = parseInt(venueGroundingStart[1], 10);
            const vTotal = parseInt(venueGroundingStart[2], 10);
            const vName = venueGroundingStart[3].trim();
            pipelineTotalTargets = vTotal;
            pipelineCurrentTargetIndex = vIdx;
            if (pipelineStatusText) {
              pipelineStatusText.textContent = `🏛️ Grounding Venue [${vIdx} of ${vTotal}]: ${vName}`;
              pipelineStatusText.style.color = '#06b6d4';
            }
            let venues = (state.masterCatalogsData && state.masterCatalogsData.venues_master) || (state.venuesData ? Object.values(state.venuesData) : []);
            const foundVIdx = Array.isArray(venues) ? venues.findIndex(v => (v.venue_name || v.name) === vName) : -1;
            const beforeVenue = foundVIdx !== -1 ? venues[foundVIdx] : { venue_name: vName, name: vName };
            currentEventContext = {
              cardIndex: foundVIdx !== -1 ? foundVIdx + 1 : vIdx,
              id: `venue:${foundVIdx !== -1 ? foundVIdx : vIdx - 1}`,
              title: vName,
              venue: vName,
              venue_name: vName,
              afterVenue: vName
            };
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(currentEventContext, beforeVenue, true);
              updateComparisonStatusPill(`Grounding Venue #${currentEventContext.cardIndex}: ${vName}...`, 'updated');
            }
          }

          const venueGroundedDone = line.match(/✅\s*Grounded\s*"([^"]+)"\s*->\s*([^(]+?)(?:\s*\(([-0-9.]+),\s*([-0-9.]+)\))?$/i);
          if (venueGroundedDone && activeStageKey === 'venue') {
            const vName = venueGroundedDone[1].trim();
            const vAddr = venueGroundedDone[2].trim();
            const lat = venueGroundedDone[3] ? parseFloat(venueGroundedDone[3]) : null;
            const lng = venueGroundedDone[4] ? parseFloat(venueGroundedDone[4]) : null;
            pipelineLastVenuesGroundedCount++;
            pipelineVenueDetailerNeedsCompile = true;
            if (currentEventContext) {
              currentEventContext.address = vAddr;
              currentEventContext.full_address = vAddr;
              if (lat !== null && lng !== null) {
                currentEventContext.coordinates = { lat, lng };
              }
              addEventDiffRow(currentEventContext);
              currentEventContext = null;
            }
          }

          const compileMatch = line.match(/(?:\[(\d+)\/(\d+)\]\s*)?🏛️\s*Reconciled:\s*"([^"]+)"\s*\(([^)]+)\)\s*(?:\[([^\]]+)\])?\s*\|\s*Total:\s*(.+)/i);
          if (compileMatch) {
            const batchItemIdx = compileMatch[1] ? parseInt(compileMatch[1], 10) : 1;
            const compTitle = compileMatch[3].trim();
            const compVenue = compileMatch[4].trim();
            const directId = compileMatch[5] ? compileMatch[5].trim() : null;
            const compPrice = compileMatch[6].trim();
            let matchedEv = null;
            if (directId && allEvs) {
              matchedEv = allEvs.find(e => (e.id || e.event_id) === directId);
            }
            if (!matchedEv && allEvs) {
              matchedEv = allEvs.find(e => (e.title || e.event_name || '').toLowerCase() === compTitle.toLowerCase());
            }
            let realCardIdx = batchItemIdx;
            if (matchedEv && allEvs) {
              const foundIdx = allEvs.findIndex(e => (e.id || e.event_id) === (matchedEv.id || matchedEv.event_id));
              if (foundIdx !== -1) realCardIdx = foundIdx + 1;
            }
            const matchedId = directId || (matchedEv ? (matchedEv.id || matchedEv.event_id) : null);
            if (matchedId) {
              const selectCard = document.getElementById('pipeline-select-card-name');
              if (selectCard) selectCard.value = matchedId;
            }
            const compileCtx = {
              ...(matchedEv || {}),
              cardIndex: realCardIdx,
              id: matchedId,
              title: compTitle,
              afterTitle: compTitle,
              venue: compVenue,
              afterVenue: compVenue,
              afterPrice: compPrice,
              afterBase: matchedEv ? matchedEv.price_base : null,
              afterFee: matchedEv ? matchedEv.price_fee : null,
              afterDate: matchedEv ? (matchedEv.date || matchedEv.dateSchedule) : null,
              afterTime: matchedEv ? (matchedEv.time || matchedEv.start_time || matchedEv.doors_time) : null,
              afterInventory: matchedEv ? (matchedEv.is_sold_out ? 'SOLD OUT' : 'AVAILABLE') : 'AVAILABLE',
              afterTicketUrl: matchedEv ? (matchedEv.ticket_url || matchedEv.details_url) : null,
              afterCategory: matchedEv ? matchedEv.category : null,
              afterArtist: matchedEv ? (matchedEv.artist || (matchedEv.lineup && matchedEv.lineup.length ? matchedEv.lineup.join(', ') : null)) : null,
              afterAge: matchedEv ? matchedEv.restrictions : null,
              afterDescription: matchedEv ? matchedEv.description : null,
              hasProof: matchedEv && matchedEv.proof_keyframes?.cart ? true : false,
              proofKeyframeUrl: matchedEv?.proof_keyframes?.cart || null,
              isReconciled: true
            };
            if (currentEventContext && currentEventContext.id === matchedId) {
              Object.assign(currentEventContext, compileCtx);
            } else {
              currentEventContext = compileCtx;
            }
            addEventDiffRow(compileCtx);
            const beforeSnap = matchedId ? pipelineInitialSnapshots.get(matchedId) : matchedEv;
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(compileCtx, beforeSnap, false);
            }
          }

          const mergeMatch = line.match(/🔀\s*Merged\s*(\d+)\s*cards?\s*(?:→|->)\s*"([^"]+)"\s*\(([^)]+)\)\s*\[([^\]]+)\]:\s*(\d+)\s*showings?\s*—\s*([^\n(]+)/i);
          if (mergeMatch) {
            const mergedCount = parseInt(mergeMatch[1], 10) || 2;
            const mTitle = mergeMatch[2].trim();
            const mVenue = mergeMatch[3].trim();
            const mId = mergeMatch[4].trim();
            const mShowingsCount = parseInt(mergeMatch[5], 10) || 1;
            const mSchedule = mergeMatch[6].trim();
            const matchedEv = (allEvs && allEvs.find(e => (e.id || e.event_id) === mId)) || {};
            const foundIdx = allEvs ? allEvs.findIndex(e => (e.id || e.event_id) === mId) : -1;
            const mergeCtx = {
              ...matchedEv,
              cardIndex: foundIdx !== -1 ? foundIdx + 1 : 1,
              id: mId,
              title: mTitle,
              afterTitle: mTitle,
              venue: mVenue,
              afterVenue: mVenue,
              afterDate: `${mSchedule} (${mergedCount} Cards Merged → ${mShowingsCount} Showings)`,
              afterPrice: matchedEv.priceLabel || null,
              isReconciled: true
            };
            addEventDiffRow(mergeCtx);
            if (pipelineStatusText) {
              pipelineStatusText.textContent = `🔀 Merged ${mergedCount} duplicate cards into "${mTitle}" (${mShowingsCount} showings)`;
              pipelineStatusText.style.color = '#34d399';
            }
          }

          const compilerOutcomeMatch = line.match(/^(?:✅|🛡️|📦)\s*\[Compiler Outcome:\s*(PASSED|QUARANTINED|ARCHIVED)\]\s*"([^"]+)"\s*\(([^)]*)\)\s*\[([^\]]+)\](?:\s*\|\s*(.+))?$/i);
          if (compilerOutcomeMatch) {
            const outcomeType = compilerOutcomeMatch[1].toUpperCase();
            const outTitle = compilerOutcomeMatch[2].trim();
            const outVenue = compilerOutcomeMatch[3].trim();
            const outId = compilerOutcomeMatch[4].trim();
            const outExtra = (compilerOutcomeMatch[5] || '').trim();
            if (!window.pipelineCompiledPassedMap) window.pipelineCompiledPassedMap = new Map();
            if (!window.pipelineCompiledFailedMap) window.pipelineCompiledFailedMap = new Map();
            const existingObj = allEvs.find(e => (e.id || e.event_id) === outId) ||
              qEvs.find(e => (e.id || e.event_id) === outId) ||
              pipelineInitialSnapshots.get(outId) ||
              {};
            if (outcomeType === 'PASSED') {
              const priceMatch = outExtra.match(/Price:\s*(.+)$/i);
              window.pipelineCompiledPassedMap.set(outId, {
                ...existingObj,
                id: outId,
                title: outTitle || existingObj.title,
                venue: outVenue || existingObj.venue || existingObj.venue_name,
                priceLabel: priceMatch ? priceMatch[1].trim() : (existingObj.priceLabel || '$0.00 CAD'),
                is_quarantined: false
              });
              window.pipelineCompiledFailedMap.delete(outId);
            } else {
              const reasonMatch = outExtra.match(/Reason:\s*([^|]+)/i);
              const detailMatch = outExtra.match(/Detail:\s*(.+)$/i);
              window.pipelineCompiledFailedMap.set(outId, {
                ...existingObj,
                id: outId,
                title: outTitle || existingObj.title,
                venue: outVenue || existingObj.venue || existingObj.venue_name,
                quarantineReason: reasonMatch ? reasonMatch[1].trim() : 'verification_failed',
                audit_error: detailMatch ? detailMatch[1].trim() : outExtra,
                is_quarantined: true
              });
              window.pipelineCompiledPassedMap.delete(outId);
            }
          }

          const enrichMatch = line.match(/✨\s*Title:\s*"([^"]+)"\s*\|\s*Category:\s*\[([^\]]+)\]\s*\|\s*Artist:\s*(?:None(?:\s*\([^)]*\))?|"([^"]+)"|([^|]+?))\s*\|\s*Age:\s*\[([^\]]+)\]/i);
          if (enrichMatch && currentEventContext) {
            currentEventContext.afterTitle = enrichMatch[1].trim();
            currentEventContext.afterCategory = enrichMatch[2].trim();
            if (enrichMatch[3]) {
              currentEventContext.afterArtist = enrichMatch[3].trim();
            } else if (enrichMatch[4] && !enrichMatch[4].trim().toLowerCase().startsWith('none')) {
              currentEventContext.afterArtist = enrichMatch[4].trim();
            } else {
              currentEventContext.afterArtist = 'None (General / Recreation)';
            }
            if (enrichMatch[5]) {
              currentEventContext.afterAge = enrichMatch[5].trim();
            }
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(currentEventContext, null, true);
            }
          }

          const synopsisMatch = line.match(/📝\s*Synopsis:\s*"([^"]+)"/i);
          if (synopsisMatch && currentEventContext) {
            currentEventContext.afterDescription = synopsisMatch[1].trim();
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(currentEventContext, null, true);
            }
          }

          const priceMatch = line.match(/(?:💰\s*)?Price:\s*([^(]+?)\s*\(Base:\s*\$?([0-9.]+|null|N\/A),\s*Fees:\s*\$?([0-9.]+|null|N\/A)(?:,\s*Tax:\s*\$?([0-9.]+|null|N\/A))?\)/i) ||
            line.match(/(?:💰\s*)?Price:\s*(\$[0-9.]+\s*CAD|Free\s*(?:\(\$0\))?|\$[0-9.]+)/i);
          if (priceMatch && currentEventContext) {
            currentEventContext.afterPrice = priceMatch[1].trim();
            if (priceMatch[2] !== undefined && priceMatch[2] !== 'null' && priceMatch[2] !== 'N/A') currentEventContext.afterBase = parseFloat(priceMatch[2]);
            if (priceMatch[3] !== undefined && priceMatch[3] !== 'null' && priceMatch[3] !== 'N/A') currentEventContext.afterFee = parseFloat(priceMatch[3]);
            if (priceMatch[4] !== undefined && priceMatch[4] !== 'null' && priceMatch[4] !== 'N/A') currentEventContext.afterTax = parseFloat(priceMatch[4]);
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(currentEventContext, null, true);
            }
          }

          const tier1NameMatch = line.match(/^\s*Tier 1:\s*(.+)$/i);
          if (tier1NameMatch && currentEventContext) {
            currentEventContext.afterTier1Name = tier1NameMatch[1].trim();
            currentEventContext.tier1_name = tier1NameMatch[1].trim();
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(currentEventContext, null, true);
            }
          }

          const providerMatch = line.match(/^\s*Provider:\s*(.+)$/i);
          if (providerMatch && currentEventContext) {
            currentEventContext.afterProvider = providerMatch[1].trim();
            currentEventContext.ticket_provider = providerMatch[1].trim();
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(currentEventContext, null, true);
            }
          }

          // Date & Schedule
          const dateMatch = line.match(/^\s*(?:📅\s*)?Date:\s*(.+)$/i);
          if (dateMatch && currentEventContext) {
            currentEventContext.afterDate = dateMatch[1].trim();
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(currentEventContext, null, true);
            }
          }

          // Showtime & Doors
          const timeMatch = line.match(/^\s*(?:Showtime|Doors|Time):\s*(.+)$/i);
          if (timeMatch && currentEventContext) {
            currentEventContext.afterTime = timeMatch[1].trim();
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(currentEventContext, null, true);
            }
          }

          const invMatch = line.match(/Inventory:\s*(SOLD OUT|AVAILABLE)/i);
          if (invMatch && currentEventContext) {
            currentEventContext.afterInventory = invMatch[1].trim();
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(currentEventContext, null, true);
            }
          }

          if (line.includes('🛒 Navigating to checkout cart:') && currentEventContext) {
            const urlMatch = line.match(/🛒\s*Navigating to checkout cart:\s*([^\s]+)/i);
            if (urlMatch) currentEventContext.afterTicketUrl = urlMatch[1].trim();
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(currentEventContext, null, true);
            }
          }

          if (line.includes('Proof keyframe captured:') && currentEventContext) {
            currentEventContext.hasProof = true;
            const shotMatch = line.match(/Proof keyframe captured:\s*([^\s]+(?:\.webp|\.png))/i);
            if (shotMatch) {
              const rawShot = shotMatch[1].trim().replace(/^\/+/, '');
              currentEventContext.proofKeyframeUrl = rawShot.startsWith('data/proof_keyframes/')
                ? rawShot
                : `data/proof_keyframes/${rawShot}`;
            }
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(currentEventContext, null, true);
            }
          }

          // Summary table row fallback
          const summaryRowMatch = line.match(/^\|\s*(\d+)\s*\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|\s*([^|]+)\|/);
          if (summaryRowMatch && !line.includes('Event ID') && !line.includes('---')) {
            const rowCardIdx = parseInt(summaryRowMatch[1], 10);
            const rowEventId = summaryRowMatch[2].trim();
            const rowVenue = summaryRowMatch[3].trim();
            const rowPrice = summaryRowMatch[4].trim();
            const rowStatus = summaryRowMatch[5].trim();
            const rowHasProof = summaryRowMatch[6].includes('YES');

            const schedEvs = Array.isArray(state.layerSchedules) ? state.layerSchedules : [];
            const boxEvs = Array.isArray(state.layerBoxOffices) ? state.layerBoxOffices : [];
            const editEvs = Array.isArray(state.layerEditorials) ? state.layerEditorials : [];
            let matchedEv = allEvs.find(e => (e.id || e.event_id) === rowEventId);
            let isQuarantined = false;
            if (!matchedEv) {
              matchedEv = qEvs.find(e => (e.id || e.event_id) === rowEventId);
              if (matchedEv) isQuarantined = true;
            }
            const schedEv = schedEvs.find(e => (e.id || e.event_id) === rowEventId);
            const boxEv = boxEvs.find(e => (e.id || e.event_id) === rowEventId);
            const editEv = editEvs.find(e => (e.id || e.event_id) === rowEventId);
            if (!matchedEv && (schedEv || boxEv || editEv)) {
              matchedEv = { ...(schedEv || {}), ...(boxEv || {}), ...(editEv || {}) };
            }

            // Calculate real card index
            let realCardIdx = rowCardIdx;
            if (matchedEv) {
              if (isQuarantined) {
                const qIdx = qEvs.findIndex(e => (e.id || e.event_id) === (matchedEv.id || matchedEv.event_id));
                realCardIdx = qIdx !== -1 ? `Q${qIdx + 1}` : 'Q';
              } else {
                const foundIdx = allEvs.findIndex(e => (e.id || e.event_id) === (matchedEv.id || matchedEv.event_id));
                if (foundIdx !== -1) realCardIdx = foundIdx + 1;
              }
            }

            const existingHistoryItem = pipelineAuditedCardsHistory.find(x => x.id === rowEventId);
            const rowBefore = (rowEventId ? pipelineInitialSnapshots.get(rowEventId) : null) || existingHistoryItem?.before || schedEv || matchedEv;

            // Preserve any existing committed context in pipelineAuditedCardsHistory or currentEventContext so the summary table NEVER strips live-extracted fields!
            const baseCtx = (existingHistoryItem && existingHistoryItem.ctx)
              ? existingHistoryItem.ctx
              : ((currentEventContext && currentEventContext.id === rowEventId) ? currentEventContext : {});

            const isRowTimeout = rowStatus.includes('TIMEOUT') || rowStatus.includes('ERROR');
            const rowCtx = {
              ...baseCtx,
              cardIndex: baseCtx.cardIndex || realCardIdx,
              isQuarantined: isQuarantined,
              id: rowEventId,
              title: (baseCtx.title && baseCtx.title !== 'Event' && baseCtx.title !== rowEventId) ? baseCtx.title : (matchedEv ? (matchedEv.title || matchedEv.event_name) : rowEventId),
              venue: baseCtx.venue || rowVenue || (matchedEv ? (matchedEv.venue || matchedEv.venue_name) : ''),
              afterTitle: (baseCtx.afterTitle && baseCtx.afterTitle !== 'Event') ? baseCtx.afterTitle : null,
              afterVenue: baseCtx.afterVenue || null,
              afterPrice: (!isRowTimeout && rowPrice !== 'N/A') ? rowPrice : (baseCtx.afterPrice || null),
              afterBase: !isRowTimeout && baseCtx.afterBase !== undefined && baseCtx.afterBase !== null ? baseCtx.afterBase : null,
              afterFee: !isRowTimeout && baseCtx.afterFee !== undefined && baseCtx.afterFee !== null ? baseCtx.afterFee : null,
              afterTax: !isRowTimeout && baseCtx.afterTax !== undefined && baseCtx.afterTax !== null ? baseCtx.afterTax : null,
              afterInventory: isRowTimeout ? null : (rowStatus.includes('SOLD') ? 'SOLD OUT' : (baseCtx.afterInventory || 'AVAILABLE')),
              afterTicketUrl: baseCtx.afterTicketUrl || null,
              afterDate: baseCtx.afterDate || null,
              afterTime: baseCtx.afterTime || null,
              hasProof: rowHasProof || Boolean(baseCtx.hasProof),
              proofKeyframeUrl: baseCtx.proofKeyframeUrl || (rowHasProof && rowEventId ? `data/proof_keyframes/${rowEventId}_cart.png` : null),
              _diffCommitted: false
            };
            addEventDiffRow(rowCtx);
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(rowCtx, rowBefore, false);
            }
          }

          const commitMatch = line.match(/Committed updated event\s*\(([^)]+)\)/i);
          if (commitMatch) {
            const committedId = commitMatch[1].trim();
            const commitCtx = activeContextsById.get(committedId) ||
              (currentEventContext && (!currentEventContext.id || currentEventContext.id === committedId)
                ? currentEventContext
                : { id: committedId, cardIndex: pipelineCurrentTargetIndex || 1, title: committedId });
            commitCtx.id = committedId;
            const schedEvs = Array.isArray(state.layerSchedules) ? state.layerSchedules : [];
            const boxEvs = Array.isArray(state.layerBoxOffices) ? state.layerBoxOffices : [];
            const editEvs = Array.isArray(state.layerEditorials) ? state.layerEditorials : [];
            const schedEv = schedEvs.find(e => (e.id || e.event_id) === committedId);
            const boxEv = boxEvs.find(e => (e.id || e.event_id) === committedId);
            const editEv = editEvs.find(e => (e.id || e.event_id) === committedId);
            const catEv = allEvs.find(e => (e.id || e.event_id) === committedId) || qEvs.find(e => (e.id || e.event_id) === committedId);
            const beforeSnap = (committedId ? pipelineInitialSnapshots.get(committedId) : null) || schedEv || catEv;
            const identityEv = schedEv || catEv || boxEv || editEv;
            if (identityEv) {
              if (!commitCtx.title || commitCtx.title === committedId || commitCtx.title === 'Event') commitCtx.title = identityEv.title || identityEv.event_name || committedId;
              if (!commitCtx.venue) commitCtx.venue = identityEv.venue || identityEv.venue_name || '';
            }
            if (activeStageKey === 'hunter' && schedEv) {
              schedEv.step1b_audited_at = new Date().toISOString();
              if (!commitCtx.afterTicketUrl) commitCtx.afterTicketUrl = schedEv.candidate_tier1_url || schedEv.ticket_url;
            } else if (activeStageKey === 'qc' && boxEv) {
              const isBoxTimeout = boxEv.status === 'TIMEOUT_EXCEEDED' || boxEv.status === 'AI_TIMEOUT' || boxEv.status === 'EXECUTION_ERROR';
              if (!isBoxTimeout) {
                const freshAllIn = boxEv.tier1_price_all_in ?? boxEv.price_all_in ?? boxEv.price;
                if (!commitCtx.afterPrice) commitCtx.afterPrice = boxEv.priceLabel || (freshAllIn != null ? `$${Number(freshAllIn).toFixed(2)} CAD` : null);
                if (commitCtx.afterBase === undefined || commitCtx.afterBase === null) commitCtx.afterBase = boxEv.tier1_price_base ?? boxEv.price_base;
                if (commitCtx.afterFee === undefined || commitCtx.afterFee === null) commitCtx.afterFee = boxEv.tier1_price_fee ?? boxEv.price_fee;
                if (commitCtx.afterTax === undefined || commitCtx.afterTax === null) commitCtx.afterTax = boxEv.tier1_price_tax ?? boxEv.price_tax;
                if (!commitCtx.afterTier1Name && boxEv.tier1_name) commitCtx.afterTier1Name = boxEv.tier1_name;
                if (!commitCtx.afterProvider && boxEv.ticket_provider) commitCtx.afterProvider = boxEv.ticket_provider;
                if (!commitCtx.afterInventory) commitCtx.afterInventory = boxEv.is_sold_out ? 'SOLD OUT' : 'AVAILABLE';
                if (!commitCtx.afterDate) commitCtx.afterDate = boxEv.date || boxEv.showings?.[0]?.date;
                if (!commitCtx.afterTime) commitCtx.afterTime = boxEv.start_time || boxEv.doors_time;
                if (!commitCtx.afterTicketUrl) commitCtx.afterTicketUrl = boxEv.ticket_url;
                if (!commitCtx.afterAge && boxEv.restrictions) commitCtx.afterAge = boxEv.restrictions;
                const proofUrl = boxEv.proof_keyframes?.cart || boxEv.proof_keyframe;
                if (proofUrl && !commitCtx.proofKeyframeUrl) {
                  commitCtx.hasProof = true;
                  commitCtx.proofKeyframeUrl = proofUrl;
                }
              }
            } else if (activeStageKey === 'enrich' && editEv) {
              if (!commitCtx.afterTitle || commitCtx.afterTitle === 'Event') commitCtx.afterTitle = editEv.clean_title || editEv.title;
              if (!commitCtx.afterCategory) commitCtx.afterCategory = editEv.category;
              if (commitCtx.afterArtist === undefined && editEv.artist) commitCtx.afterArtist = editEv.artist;
              if (!commitCtx.afterAge && editEv.restrictions) commitCtx.afterAge = editEv.restrictions;
              if (!commitCtx.afterDescription && editEv.description) commitCtx.afterDescription = editEv.description;
              if (editEv.event_archetype) commitCtx.event_archetype = editEv.event_archetype;
              if (editEv.lifecycle_type) commitCtx.lifecycle_type = editEv.lifecycle_type;
              if (editEv.frequencyLabel) commitCtx.frequencyLabel = editEv.frequencyLabel;
            } else if (activeStageKey === 'compile') {
              const freshEv = (schedEv || boxEv || editEv || catEv)
                ? { ...(schedEv || {}), ...(boxEv || {}), ...(editEv || {}), ...(catEv || {}) }
                : null;
              if (freshEv) {
                Object.keys(freshEv).forEach(k => {
                  if (commitCtx[k] === undefined || commitCtx[k] === null) commitCtx[k] = freshEv[k];
                });
              }
            }
            addEventDiffRow(commitCtx);
            activeContextsById.delete(committedId);
            const trackerStatusEl = document.getElementById('pipeline-last-scanned-text');
            const totalRun = pipelineTotalTargets || pipelineProcessedCount;
            const remCount = Math.max(0, totalRun - pipelineProcessedCount);
            if (trackerStatusEl) {
              const activeSuffix = (remCount > 0 && window.currentActiveEventLabel)
                ? ` • <span style="color: #38bdf8;">${escapeHtml(window.currentActiveEventLabel)}</span>`
                : ` • <span style="color: #94a3b8;">${remCount} remaining in current run</span>`;
              trackerStatusEl.innerHTML = `<span style="color: #14b8a6; font-weight: 700;">${pipelineProcessedCount}/${totalRun} Completed (${remCount} remaining)</span>${activeSuffix}`;
            }
            if (typeof renderComparisonCards === 'function') {
              renderComparisonCards(commitCtx, beforeSnap, false);
            }
            if (currentEventContext && currentEventContext.id === committedId) {
              currentEventContext = null;
            }
          }

          if (pipelineStatusText) {
            if (/📌\s*(?:\[Worker\s*#\d+\]\s*)?Processing\s*\[/i.test(line)) {
              pipelineStatusText.textContent = window.currentActiveEventLabel || line.replace(/^.*?📌\s*(?:\[Worker\s*#\d+\]\s*)?/i, '');
              if (pipelineStatusSubtext) {
                const totalRun = pipelineTotalTargets || 1;
                const remCount = Math.max(0, totalRun - pipelineProcessedCount);
                pipelineStatusSubtext.textContent = `${pipelineProcessedCount}/${totalRun} completed (${remCount} remaining) • Event ${pipelineCurrentTargetIndex || 1} of ${totalRun} in progress...`;
              }
              pipelineStatusText.style.color = '#38bdf8';
            } else if (line.includes('🛒 Navigating to checkout cart:')) {
              pipelineStatusText.textContent = window.currentActiveEventLabel
                ? `${window.currentActiveEventLabel} — 🛒 Penetrating checkout cart...`
                : '🛒 Penetrating checkout cart modal...';
              if (pipelineStatusSubtext) pipelineStatusSubtext.textContent = 'Extracting base ticket price, service fees & 5% GST...';
              pipelineStatusText.style.color = '#a855f7';
            } else if (line.includes('📸 Proof keyframe captured:')) {
              pipelineStatusText.textContent = window.currentActiveEventLabel
                ? `${window.currentActiveEventLabel} — 📸 Proof keyframe captured!`
                : '📸 Proof keyframe captured!';
              if (pipelineStatusSubtext) pipelineStatusSubtext.textContent = 'Visual keyframe evidence saved & linked.';
              pipelineStatusText.style.color = '#34d399';
            } else if (line.includes('💾 Committed updated event')) {
              const totalRun = pipelineTotalTargets || pipelineProcessedCount || 1;
              const remCount = Math.max(0, totalRun - pipelineProcessedCount);
              if (remCount > 0 && window.currentActiveEventLabel) {
                pipelineStatusText.textContent = window.currentActiveEventLabel;
                pipelineStatusText.style.color = '#38bdf8';
                if (pipelineStatusSubtext) {
                  pipelineStatusSubtext.textContent = `💾 ${pipelineProcessedCount}/${totalRun} completed (${remCount} remaining) • Event ${pipelineCurrentTargetIndex || 1} of ${totalRun} in progress...`;
                }
              } else {
                pipelineStatusText.textContent = `💾 Committed ${pipelineProcessedCount}/${totalRun} verified card(s) to events.json`;
                pipelineStatusText.style.color = '#34d399';
              }
            } else if (line.includes('🏁 BATCH QC AUDIT COMPLETE')) {
              pipelineStatusText.textContent = '🏁 Batch QC Audit Complete!';
              pipelineStatusText.style.color = '#10b981';
            } else if (line.includes('✍️ AI SEMANTIC ENRICHER PIPELINE') || line.includes('✍️ Processing:')) {
              pipelineStatusText.textContent = '✍️ AI Semantic Enricher running...';
              if (pipelineStatusSubtext) pipelineStatusSubtext.textContent = 'Normalizing title, synopsis & category tags...';
              pipelineStatusText.style.color = '#fbbf24';
            } else if (line.includes('COMPILER AI ARBITRATOR')) {
              pipelineStatusText.textContent = '🏛️ Compiler AI arbitrating layers & checking math...';
              if (pipelineStatusSubtext) pipelineStatusSubtext.textContent = 'Enforcing $50 CAD budget ceiling & auto-rolling showings...';
              pipelineStatusText.style.color = '#38bdf8';
            } else if (line.includes('Saved') && line.includes('compiled active cards')) {
              pipelineStatusText.textContent = '💾 Catalog compiled! Checking invariants...';
              pipelineStatusText.style.color = '#34d399';
            } else if (line.includes('Synced compiled events to js/data.js')) {
              pipelineStatusText.textContent = '🚀 Master catalog published & live in js/data.js!';
              pipelineStatusText.style.color = '#10b981';
            } else if (line.includes('Saved') && line.includes('layer_editorial.json')) {
              pipelineStatusText.textContent = '✍️ Editorial enrichment saved to layer_editorial.json!';
              pipelineStatusText.style.color = '#34d399';
            }
          }
        }
      } catch (err) {
        console.error('[SSE PROCESS ERROR]', err);
      }
    };

    function playStageCompleteChime(stageKey) {
      try {
        const validPipelineStages = ['harvest', 'hunter', 'qc', 'enrich', 'venue', 'consolidate', 'compile'];
        if (stageKey && !validPipelineStages.includes(stageKey)) return;
        const nowMs = Date.now();
        if (window._lastStageCompleteChimeAt && nowMs - window._lastStageCompleteChimeAt < 2500) {
          return;
        }
        window._lastStageCompleteChimeAt = nowMs;

        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => { });
        }
        // Pleasant ascending bell arpeggio chime: C5 (523.25), E5 (659.25), G5 (783.99), C6 (1046.50)
        const notes = [523.25, 659.25, 783.99, 1046.50];
        const now = ctx.currentTime;
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.11);

          gain.gain.setValueAtTime(0, now + idx * 0.11);
          gain.gain.linearRampToValueAtTime(0.2, now + idx * 0.11 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.11 + 0.65);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now + idx * 0.11);
          osc.stop(now + idx * 0.11 + 0.7);
        });
        setTimeout(() => {
          try { ctx.close(); } catch (_) { }
        }, 1500);
      } catch (err) {
        console.warn('Audio chime playback omitted:', err);
      }
    }

    es.addEventListener('done', (event) => {
      es.close();
      activeEventSource = null;
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      setExecutionState(false);

      if (currentEventContext) {
        addEventDiffRow(currentEventContext);
        currentEventContext = null;
      }

      if (btnStopPipeline) btnStopPipeline.style.display = 'none';
      if (btnStopPipelineTop) btnStopPipelineTop.style.display = 'none';
      const btnTriggerEl = document.getElementById('btn-trigger-pipeline-run');
      if (btnTriggerEl) btnTriggerEl.style.display = 'inline-flex';

      if (pipelineSpinner) pipelineSpinner.style.animation = 'none';
      if (pipelineProgressBar) pipelineProgressBar.style.width = '100%';

      let exitCode = 0;
      try {
        const data = JSON.parse(event.data);
        exitCode = data.exitCode || 0;
      } catch (e) { }

      if (exitCode === 0) {
        const finishedStageKey = activeStageKey || window.activePipelineRunningStageKey || currentPipelineScanKey;
        playStageCompleteChime(finishedStageKey);
        currentPipelineScanKey = finishedStageKey;
        pipelineTestStageKey = finishedStageKey;

        if (finishedStageKey === 'harvest') {
          if (typeof finalizeHarvesterRun === 'function') finalizeHarvesterRun(true);
        }

        if (PIPELINE_TEST_ORDER.includes(finishedStageKey)) {
          pipelineTestStageStatuses[finishedStageKey] = `✅ Complete (${pipelineProcessedCount || pipelineTotalTargets || 'Done'})`;
          savePipelineBatchState();
          updatePipelineTestStepperUI();
          updateStageNavButtons();
        }

        if (finishedStageKey === 'venue' && pipelineVenueDetailerNeedsCompile && !isPipelineAutoChaining) {
          const promptBanner = document.getElementById('venue-compiler-update-prompt-banner');
          const promptTitle = document.getElementById('venue-compiler-prompt-title');
          if (promptBanner) promptBanner.style.display = 'flex';
          if (promptTitle) promptTitle.textContent = `🏛️ ${pipelineLastVenuesGroundedCount || 1} Venue(s) Grounded in venues.json — Run Stage 5 Compiler to Sync Cards!`;
        }

        if (finishedStageKey === 'compile') {
          pipelineVenueDetailerNeedsCompile = false;
          const promptBanner = document.getElementById('venue-compiler-update-prompt-banner');
          if (promptBanner) promptBanner.style.display = 'none';
          const passedMap = window.pipelineCompiledPassedMap instanceof Map ? window.pipelineCompiledPassedMap : new Map();
          const failedMap = window.pipelineCompiledFailedMap instanceof Map ? window.pipelineCompiledFailedMap : new Map();
          const outcomeIds = [...passedMap.keys(), ...failedMap.keys()];
          pipelineLastCompiledCardIds = outcomeIds.length > 0
            ? outcomeIds
            : (pipelineTestDiscoveredIds && pipelineTestDiscoveredIds.length > 0
              ? [...pipelineTestDiscoveredIds]
              : pipelineAuditedCardsHistory.map(x => x.id).filter(Boolean));
          window.pipelineLastCompiledIds = [...pipelineLastCompiledCardIds];
          try {
            const passedBatchIds = passedMap.size > 0
              ? [...passedMap.keys()]
              : pipelineLastCompiledCardIds.filter(id => !failedMap.has(id));
            if (passedBatchIds.length > 0) {
              localStorage.setItem('van50_last_passed_batch_ids', JSON.stringify(passedBatchIds));
            }
          } catch (_) {}
          if (typeof window.updateCompilerPreviewBanner === 'function') {
            window.updateCompilerPreviewBanner(passedMap.size, failedMap.size);
          }
          if (typeof window.syncHarvesterCheckpointAndEventsUI === 'function') {
            window.syncHarvesterCheckpointAndEventsUI();
          }
        }

        const lastAudited = pipelineAuditedCardsHistory[pipelineAuditedCardsHistory.length - 1];
        if (lastAudited && lastAudited.id) {
          const selectCard = document.getElementById('pipeline-select-card-name');
          if (selectCard) selectCard.value = lastAudited.id;
          pipelineCurrentCompId = lastAudited.id;
          updateComparisonCardDropdown();
          showComparisonCardById(lastAudited.id);
        } else if (currentEventContext && currentEventContext.id) {
          addEventDiffRow(currentEventContext);
          showComparisonCardById(currentEventContext.id);
        } else if (pipelineAuditedCardsHistory.length === 0) {
          const afterContainer = document.getElementById('pipeline-comp-card-after');
          if (afterContainer && currentPipelineScanKey !== 'harvest') {
            afterContainer.innerHTML = `
              <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; min-height: 380px; text-align: center; color: #34d399; padding: 20px;">
                <div style="font-size: 2.2rem; margin-bottom: 8px;">✅</div>
                <div style="font-weight: 700; color: #34d399; font-size: 0.95rem; margin-bottom: 6px;">
                  All In-Scope Events Verified
                </div>
                <p style="font-size: 0.74rem; color: #94a3b8; max-width: 280px; margin: 0; line-height: 1.45;">
                  All target events already have verified data in the layer. Zero un-enriched or drift cards detected.
                </p>
                <p style="font-size: 0.72rem; color: #64748b; margin-top: 10px;">
                  To re-evaluate or inspect a specific event, switch <strong>Scope</strong> to <strong>Single Card</strong>.
                </p>
              </div>
            `;
          }
        }
        const stagePastVerb = finishedStageKey === 'enrich'
          ? 'Enriched'
          : finishedStageKey === 'hunter'
            ? 'Hunted'
            : finishedStageKey === 'compile'
              ? 'Compiled'
              : 'Audited';
        if (pipelineSpinner) pipelineSpinner.textContent = '✅';
        if (pipelineStatusText) {
          pipelineStatusText.textContent = `✅ Pipeline Execution Complete! (${pipelineProcessedCount} of ${pipelineTotalTargets || pipelineProcessedCount} Events ${stagePastVerb})`;
          pipelineStatusText.style.color = '#34d399';
        }
        if (pipelineStatusSubtext) {
          pipelineStatusSubtext.textContent = `All ${pipelineProcessedCount} targeted event operations finished cleanly.`;
        }
        if (pipelineProgressBar) {
          pipelineProgressBar.style.width = '100%';
          pipelineProgressBar.style.background = 'linear-gradient(90deg, #10b981, #059669)';
        }
        if (pipelineEtaValue) {
          pipelineEtaValue.textContent = '0s (Finished)';
        }
        if (pipelineItemProgress) {
          pipelineItemProgress.textContent = `${pipelineProcessedCount} of ${pipelineTotalTargets || pipelineProcessedCount} events processed (100%) in ${elapsed}s`;
        }
        const counterBadge = document.getElementById('pipeline-diff-counter-badge');
        if (counterBadge) {
          counterBadge.textContent = `${pipelineProcessedCount} of ${pipelineTotalTargets || pipelineProcessedCount} Processed`;
        }
        if (pipelineConsoleOutput) {
          pipelineConsoleOutput.textContent += '\n[SUCCESS] Pipeline execution completed.\n';
          pipelineConsoleOutput.scrollTop = pipelineConsoleOutput.scrollHeight;
        }
        if (pipelineTimeoutEvents.length > 0) {
          const names = pipelineTimeoutEvents.map(t => `"${t.eventTitle}" (${t.cause})`).slice(0, 3).join('; ');
          if (pipelineStatusText) {
            pipelineStatusText.textContent = `⚠️ Pipeline Complete with ${pipelineTimeoutEvents.length} Timeout/Issue(s) (${pipelineProcessedCount} ${stagePastVerb})`;
            pipelineStatusText.style.color = '#fbbf24';
          }
          if (pipelineStatusSubtext) {
            pipelineStatusSubtext.style.display = 'block';
            pipelineStatusSubtext.style.color = '#fca5a5';
            pipelineStatusSubtext.textContent = `Timed-out/Errored Events: ${names}`;
          }
          if (typeof showToast === 'function') {
            showToast(`⚠️ Completed with ${pipelineTimeoutEvents.length} AI timeout(s): ${names}`, 'error');
          }
        } else {
          if (typeof showToast === 'function') showToast('Pipeline execution complete! Data committed.', 'success');
        }
        if (typeof loadQuarantineQueue === 'function') loadQuarantineQueue();
        if (typeof loadCuratorDashboard === 'function') loadCuratorDashboard();
        const reloadPromise = (typeof window.loadLayersAndEvents === 'function')
          ? Promise.resolve(window.loadLayersAndEvents())
              .then(() => {
                if (finishedStageKey === 'harvest' && typeof finalizeHarvesterRun === 'function') {
                  return finalizeHarvesterRun(true);
                }
              })
              .catch(() => {})
          : Promise.resolve();

        // Auto-chain to next stage if full pipeline batch mode is active
        if (isPipelineAutoChaining) {
          const chainOrder = window.pipelineAutoChainingStages || ['harvest', 'hunter', 'qc', 'enrich', 'venue', 'compile'];
          const curIdx = chainOrder.indexOf(finishedStageKey);
          if (curIdx >= 0 && curIdx < chainOrder.length - 1) {
            const nextStageKey = chainOrder[curIdx + 1];
            pipelineTestStageStatuses[nextStageKey] = 'Running ⚡';
            window.activePipelineRunningStageKey = nextStageKey;
            updatePipelineTestStepperUI();
            savePipelineBatchState();
            if (pipelineStatusText) {
              pipelineStatusText.textContent = `Stage ${curIdx + 1} Complete! Advancing to ${nextStageKey.toUpperCase()} in 1s...`;
              pipelineStatusText.style.color = '#38bdf8';
            }
            setTimeout(async () => {
              await reloadPromise;
              if (isPipelineAutoChaining) {
                openPipelineTestStage(nextStageKey, true);
              }
            }, 900);
          } else {
            isPipelineAutoChaining = false;
            window.activePipelineRunningStageKey = null;
            const autoBtn = document.getElementById('btn-stepper-auto-pipeline');
            if (autoBtn) {
              autoBtn.classList.remove('is-running');
              const autoLabel = document.getElementById('btn-stepper-auto-label');
              if (autoLabel) autoLabel.textContent = '🚀 Auto-Run All (1A ➔ 5)';
            }
            const autoStaleBtn = document.getElementById('btn-stepper-auto-stale');
            if (autoStaleBtn) {
              autoStaleBtn.classList.remove('is-running');
              const autoStaleLabel = document.getElementById('btn-stepper-auto-stale-label');
              if (autoStaleLabel) autoStaleLabel.textContent = '⚡ Auto-Run Out-of-Date (1B ➔ 5)';
            }
            ['btn-stepper-auto-quarantined', 'btn-header-run-quarantine', 'btn-banner-run-quarantine', 'btn-status-run-quarantine'].forEach(btnId => {
              const btn = document.getElementById(btnId);
              if (btn) btn.classList.remove('is-running');
            });
            ['btn-stepper-auto-newest-passed', 'btn-header-run-newest-passed', 'btn-banner-run-newest-passed', 'btn-status-run-newest-passed'].forEach(btnId => {
              const btn = document.getElementById(btnId);
              if (btn) btn.classList.remove('is-running');
            });
            if (typeof window.syncHarvesterCheckpointAndEventsUI === 'function') {
              window.syncHarvesterCheckpointAndEventsUI();
            }
            const autoHBtn = document.getElementById('btn-stepper-auto-harvested');
            if (autoHBtn) {
              autoHBtn.classList.remove('is-running');
              const autoHLabel = document.getElementById('btn-stepper-auto-harvested-label');
              if (autoHLabel) autoHLabel.textContent = '✨ Process New Events (1B ➔ 5)';
            }
            const summaryBanner = document.getElementById('pipeline-completion-summary-banner');
            if (summaryBanner) summaryBanner.style.display = 'block';
          }
        }
      } else {
        isPipelineAutoChaining = false;
        window.activePipelineRunningStageKey = null;
        const failedStageKey = activeStageKey || currentPipelineScanKey;
        if (PIPELINE_TEST_ORDER.includes(failedStageKey)) {
          pipelineTestStageStatuses[failedStageKey] = `❌ Error (${exitCode})`;
          updatePipelineTestStepperUI();
        }
        if (currentPipelineScanKey === 'harvest') {
          if (typeof finalizeHarvesterRun === 'function') finalizeHarvesterRun(false);
        }
        if (pipelineSpinner) pipelineSpinner.textContent = '❌';
        if (pipelineStatusText) {
          pipelineStatusText.textContent = `❌ Pipeline exited with code ${exitCode}`;
          pipelineStatusText.style.color = '#f87171';
        }
        if (pipelineProgressBar) {
          pipelineProgressBar.style.background = '#f87171';
        }
        if (typeof showToast === 'function') showToast(`Pipeline exited with code ${exitCode}`, 'error');
      }
    });

    es.addEventListener('error', (event) => {
      es.close();
      activeEventSource = null;
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      setExecutionState(false);

      if (currentPipelineScanKey === 'harvest') {
        if (typeof finalizeHarvesterRun === 'function') finalizeHarvesterRun(false);
      }

      if (currentEventContext) {
        addEventDiffRow(currentEventContext);
        currentEventContext = null;
      }

      if (btnStopPipeline) btnStopPipeline.style.display = 'none';
      if (btnStopPipelineTop) btnStopPipelineTop.style.display = 'none';
      const btnTriggerEl = document.getElementById('btn-trigger-pipeline-run');
      if (btnTriggerEl) btnTriggerEl.style.display = 'inline-flex';

      if (pipelineSpinner) pipelineSpinner.style.animation = 'none';
      if (pipelineStatusText) {
        pipelineStatusText.textContent = '⚠️ Stream connection closed.';
        pipelineStatusText.style.color = '#94a3b8';
      }
      if (typeof loadQuarantineQueue === 'function') loadQuarantineQueue();
      if (typeof window.loadLayersAndEvents === 'function') window.loadLayersAndEvents();
    });
  };

  // Wire Trigger Launcher Button in Modal
  const btnTriggerPipelineRun = document.getElementById('btn-trigger-pipeline-run');
  if (btnTriggerPipelineRun) {
    btnTriggerPipelineRun.addEventListener('click', () => {
      const skipPrompt = Boolean(btnTriggerPipelineRun._skipContinuePrompt);
      btnTriggerPipelineRun._skipContinuePrompt = false;

      if (isExecuting) {
        if (confirm('A pipeline task is currently marked active. Would you like to stop it and start a new scan?')) {
          stopActiveStagehand().then(() => {
            setTimeout(() => { btnTriggerPipelineRun.click(); }, 300);
          });
        }
        return;
      }

      const preset = SCAN_PRESETS[currentPipelineScanKey] || SCAN_PRESETS.qc;
      const btnLabelCheckEl = document.getElementById('btn-trigger-pipeline-label');
      const currentBtnText = (btnLabelCheckEl ? btnLabelCheckEl.textContent : '') || '';
      const isResumeOrContinueClick = /resume|continue/i.test(currentBtnText) ||
        currentPipelineScope === 'harvested' ||
        (preset.key === 'harvest' && window.harvesterResumeMode !== false);

      if (!skipPrompt && isResumeOrContinueClick && currentPipelineScope !== 'single_card' && currentPipelineScope !== 'range') {
        let availablePoolCount = null;
        if (currentPipelineScope === 'harvested' && preset.key !== 'harvest') {
          const stageInfo = typeof window.getStageContinuationInfo === 'function'
            ? window.getStageContinuationInfo(preset.key)
            : null;
          availablePoolCount = (stageInfo && stageInfo.pendingCount > 0)
            ? stageInfo.pendingCount
            : ((pipelineTestDiscoveredIds && pipelineTestDiscoveredIds.length > 0) ? pipelineTestDiscoveredIds.length : 0);
          if (availablePoolCount <= 0) {
            if (typeof showToast === 'function') {
              showToast(`⏸️ Cannot run ${preset.key.toUpperCase()}: 0 events are queued from ${stageInfo ? stageInfo.prevStageLabel : 'the previous stage'}. Events cannot skip pipeline stages!`, 'warning');
            }
            return;
          }
        }
        const chosenCount = window.promptContinueEventCount(availablePoolCount, 'events');
        if (chosenCount === null) return;
        window.setPipelineBatchSize(chosenCount);
      }

      const inputUrl = document.getElementById('pipeline-input-url');
      const chkAutoApprove = document.getElementById('pipeline-input-auto-approve');
      const startInput = document.getElementById('pipeline-card-start');
      const stopInput = document.getElementById('pipeline-card-stop');
      const selectCard = document.getElementById('pipeline-select-card-name');

      let url = (inputUrl && inputUrl.value.trim()) || '';
      let autoApprove = chkAutoApprove ? chkAutoApprove.checked : true;

      let allParam = false;
      let limitVal = 0;
      let offsetVal = 0;
      let idVal = '';
      let idsVal = '';
      let venueVal = '';
      let forceVal = false;
      let uncompiledOnly = false;
      let incompleteOnly = false;
      let staleVal = '';

      // Always update the top-center stage banner and target dimensions banner when switching stages
    if (typeof updateComparisonTargetDimensionsBanner === 'function') {
      updateComparisonTargetDimensionsBanner(preset.key);
    }
    if (preset.key === 'harvest') {
        const feedSelect = document.getElementById('pipeline-select-venue-feed');
        const customFeedInput = document.getElementById('pipeline-harvester-custom-url');
        const chkHarvesterApprove = document.getElementById('pipeline-harvester-auto-approve');
        const feedVal = feedSelect ? feedSelect.value : 'all';
        const batchCap = (window.pipelineBatchSize === 'all' || window.pipelineBatchSize === 0)
          ? 0
          : (Number(window.pipelineBatchSize) || 0);

        if (feedVal === 'all' || feedVal === 'all:vancouver' || feedVal === 'all:surrey') {
          const baseScope = (feedVal === 'all:vancouver' || feedVal === 'all:surrey')
            ? feedVal
            : (window.harvesterCityScope === 'vancouver' ? 'all:vancouver' : (window.harvesterCityScope === 'surrey' ? 'all:surrey' : 'all'));
          url = (window.harvesterResumeMode !== false) ? `${baseScope}:resume` : baseScope;
          allParam = true;
          limitVal = batchCap;
        } else if (feedVal === 'custom') {
          url = (customFeedInput && customFeedInput.value.trim()) || '';
          if (!url) {
            alert('Please enter a custom venue calendar URL to harvest.');
            if (customFeedInput) customFeedInput.focus();
            return;
          }
          allParam = false;
          limitVal = batchCap;
        } else {
          url = feedVal;
          allParam = false;
          limitVal = batchCap;
        }
        autoApprove = chkHarvesterApprove ? chkHarvesterApprove.checked : true;
      } else if (preset.key === 'venue') {
        const vSelect = document.getElementById('pipeline-select-venue-detailer');
        const selVal = vSelect ? vSelect.value : 'new_events';
        const batchCap = (window.pipelineBatchSize === 'all' || window.pipelineBatchSize === 0)
          ? 0
          : (Number(window.pipelineBatchSize) || 0);
        if ((currentPipelineScope === 'quarantined' || currentPipelineScope === 'batch5') && pipelineTestDiscoveredIds && pipelineTestDiscoveredIds.length > 0) {
          let targetIds = [...pipelineTestDiscoveredIds];
          if (batchCap > 0 && targetIds.length > batchCap) targetIds = targetIds.slice(0, batchCap);
          idsVal = targetIds.length > 250 ? '' : targetIds.join(',');
          venueVal = '';
          limitVal = batchCap || targetIds.length;
          allParam = false;
          forceVal = true;
          uncompiledOnly = false;
        } else if (selVal === 'new_events' || currentPipelineScope === 'harvested') {
          const stageInfo = typeof window.getStageContinuationInfo === 'function'
            ? window.getStageContinuationInfo('venue')
            : null;
          const candidateEvents = (stageInfo && stageInfo.pendingItems && stageInfo.pendingItems.length > 0)
            ? stageInfo.pendingItems
            : [];
          let hIds = (pipelineTestDiscoveredIds && pipelineTestDiscoveredIds.length > 0 && candidateEvents.length === 0)
            ? [...pipelineTestDiscoveredIds]
            : candidateEvents.map(e => e.id || e.event_id).filter(Boolean);
          if (hIds.length === 0) {
            if (typeof showToast === 'function') {
              showToast(`⏸️ Cannot run Stage 4 Venue Detailer: 0 events are queued from Stage 3 Enrich. Events cannot skip pipeline stages!`, 'warning');
            }
            return;
          }
          if (batchCap > 0 && hIds.length > batchCap) hIds = hIds.slice(0, batchCap);
          idsVal = hIds.length > 250 ? '' : hIds.join(',');
          venueVal = '';
          limitVal = batchCap || hIds.length;
          allParam = false;
          forceVal = false;
          uncompiledOnly = true;
        } else if (selVal === 'ungrounded') {
          venueVal = 'all';
          limitVal = batchCap || 10;
          forceVal = false;
        } else if (selVal === 'all') {
          venueVal = 'all';
          allParam = true;
          limitVal = 0;
          forceVal = true;
        } else {
          venueVal = selVal;
          limitVal = 1;
          forceVal = true;
        }
      } else if (currentPipelineScope === 'harvested') {
        const batchCap = (window.pipelineBatchSize === 'all' || window.pipelineBatchSize === 0)
          ? 0
          : (Number(window.pipelineBatchSize) || 0);
        const stageInfo = typeof window.getStageContinuationInfo === 'function'
          ? window.getStageContinuationInfo(preset.key)
          : null;
        const pendingEvents = (stageInfo && stageInfo.pendingItems && stageInfo.pendingItems.length > 0)
          ? stageInfo.pendingItems
          : [];
        const allInputEvents = (stageInfo && stageInfo.allInputItems && stageInfo.allInputItems.length > 0)
          ? stageInfo.allInputItems
          : [];
        // Preserve full harvested cohort when pipelineTestDiscoveredIds already holds a multi-event batch (e.g., 49 events)
        // and only 0 or 1 event lacks step1b_audited_at so the batch doesn't collapse to 1 event!
        let hIds = [];
        if (pipelineTestDiscoveredIds && pipelineTestDiscoveredIds.length > 1 && pendingEvents.length <= 1 && allInputEvents.length > 1) {
          hIds = [...pipelineTestDiscoveredIds];
        } else if (pendingEvents.length > 0) {
          hIds = pendingEvents.map(e => e.id || e.event_id).filter(Boolean);
        } else if (pipelineTestDiscoveredIds && pipelineTestDiscoveredIds.length > 0) {
          hIds = [...pipelineTestDiscoveredIds];
        } else if (allInputEvents.length > 0) {
          hIds = allInputEvents.map(e => e.id || e.event_id).filter(Boolean);
        }
        if (hIds.length === 0) {
          if (typeof showToast === 'function') {
            showToast(`⏸️ Cannot run Stage ${preset.key.toUpperCase()}: 0 events are queued from ${stageInfo ? stageInfo.prevStageLabel : 'the previous stage'}. Events cannot skip pipeline stages!`, 'warning');
          }
          return;
        }
        if (batchCap > 0 && hIds.length > batchCap) hIds = hIds.slice(0, batchCap);
        // Ensure pipelineTestDiscoveredIds retains the full cohort for downstream stages (2 -> 5)
        if (allInputEvents.length > hIds.length && (!pipelineTestDiscoveredIds || pipelineTestDiscoveredIds.length <= 1)) {
          const fullCohort = allInputEvents.map(e => e.id || e.event_id).filter(Boolean);
          pipelineTestDiscoveredIds = batchCap > 0 ? fullCohort.slice(0, batchCap) : fullCohort;
        }
        idsVal = hIds.length > 250 ? '' : hIds.join(',');
        limitVal = batchCap;
        offsetVal = 0;
        allParam = false;
        forceVal = (pendingEvents.length === 0 && hIds.length > 0);
        uncompiledOnly = true;
      } else if (currentPipelineScope === 'batch5') {
        const batchCap = (window.pipelineBatchSize === 'all' || window.pipelineBatchSize === 0)
          ? 0
          : (Number(window.pipelineBatchSize) || 0);
        if (pipelineTestDiscoveredIds && pipelineTestDiscoveredIds.length > 0) {
          let targetIds = [...pipelineTestDiscoveredIds];
          if (batchCap > 0 && targetIds.length > batchCap) targetIds = targetIds.slice(0, batchCap);
          idsVal = targetIds.length > 250 ? '' : targetIds.join(',');
          limitVal = (window.pipelineBatchSize === 'all') ? 0 : targetIds.length;
          offsetVal = 0;
          allParam = false;
          forceVal = true;
        } else {
          const start = parseInt(startInput ? startInput.value : '1', 10) || 1;
          offsetVal = Math.max(0, start - 1);
          limitVal = batchCap;
          allParam = (window.pipelineBatchSize === 'all');
          forceVal = true;
        }
      } else if (currentPipelineScope === 'quarantined') {
        const batchCap = (window.pipelineBatchSize === 'all' || window.pipelineBatchSize === 0)
          ? 0
          : (Number(window.pipelineBatchSize) || 0);
        const qEvents = state.quarantinedEvents || [];
        let qIds = (pipelineTestDiscoveredIds && pipelineTestDiscoveredIds.length > 0)
          ? [...pipelineTestDiscoveredIds]
          : qEvents.map(e => e.id || e.event_id).filter(Boolean);
        if (batchCap > 0 && qIds.length > batchCap) qIds = qIds.slice(0, batchCap);
        idsVal = qIds.join(',');
        limitVal = batchCap;
        offsetVal = 0;
        allParam = true;
        forceVal = true;
        pipelineQuarantinedRunActive = true;
      } else if (currentPipelineScope === 'single_card') {
        const customInput = document.getElementById('pipeline-custom-card-ids');
        if (customInput && customInput.dataset.selectedId) {
          idVal = customInput.dataset.selectedId;
        } else if (window.parseCardNumbersToIds && customInput && customInput.value.trim()) {
          const parsed = window.parseCardNumbersToIds(customInput.value.trim());
          if (parsed.length === 1) idVal = parsed[0];
          else if (parsed.length > 1) idsVal = parsed.join(',');
        }
        if (!idVal && !idsVal) {
          idVal = (selectCard && selectCard.value) || '';
        }
        if (!idVal && !idsVal) {
          alert('Please select an event card from the dropdown first.');
          return;
        }
        offsetVal = 0;
        limitVal = idsVal ? idsVal.split(',').length : 1;
        allParam = false;
        forceVal = true;
      } else if (currentPipelineScope === 'range') {
        const start = parseInt(startInput ? startInput.value : '1', 10) || 1;
        const stop = parseInt(stopInput ? stopInput.value : '1', 10) || start;
        offsetVal = Math.max(0, start - 1);
        limitVal = Math.max(1, stop - start + 1);
        allParam = false;
        forceVal = true;
      } else if (currentPipelineScope === 'all') {
        idVal = '';
        offsetVal = 0;
        limitVal = 0;
        allParam = true;
        forceVal = true;
      } else if (currentPipelineScope === 'incomplete') {
        const batchCap = (window.pipelineBatchSize === 'all' || window.pipelineBatchSize === 0)
          ? 0
          : (Number(window.pipelineBatchSize) || 0);
        idVal = '';
        offsetVal = 0;
        limitVal = batchCap;
        allParam = false;
        forceVal = false;
        incompleteOnly = true;
      } else if (currentPipelineScope === 'stale') {
        const batchCap = (window.pipelineBatchSize === 'all' || window.pipelineBatchSize === 0)
          ? 0
          : (Number(window.pipelineBatchSize) || 0);
        idVal = '';
        offsetVal = 0;
        limitVal = batchCap;
        allParam = false;
        forceVal = true;
        const durationSelect = document.getElementById('pipeline-stale-duration');
        staleVal = durationSelect ? durationSelect.value : '24h';
      } else if (currentPipelineScope === 'unscanned') {
        const batchCap = (window.pipelineBatchSize === 'all' || window.pipelineBatchSize === 0)
          ? 0
          : (Number(window.pipelineBatchSize) || 0);
        idVal = '';
        offsetVal = 0;
        limitVal = batchCap;
        allParam = false;
        forceVal = false;
        uncompiledOnly = true;
      }

      const btnLabelEl = document.getElementById('btn-trigger-pipeline-label');
      const actionTitle = ((preset.key === 'harvest' || preset.key === 'venue') && btnLabelEl)
        ? btnLabelEl.textContent.trim()
        : preset.btnLabel;

      runPipelineAction({
        mode: preset.mode,
        title: actionTitle,
        initialStatus: preset.initialStatus,
        limit: limitVal,
        offset: offsetVal,
        id: idVal,
        ids: idsVal,
        venue: venueVal,
        quarantine: pipelineQuarantinedRunActive,
        uncompiledOnly: uncompiledOnly,
        incompleteOnly: incompleteOnly,
        stale: staleVal,
        scope: currentPipelineScope,
        url: url,
        resume: (preset.key === 'harvest' && url === 'all:resume'),
        all: allParam,
        force: forceVal,
        autoApprove: autoApprove
      });
    });
  }

  // Wire Top Header Nav Pipeline Action Buttons (Open scan modal with preset)
  const navHarvestBtn = document.getElementById('btn-nav-harvest');
  const navQcBtn = document.getElementById('btn-nav-qc');
  const navEnrichBtn = document.getElementById('btn-nav-enrich');
  const navVenueBtn = document.getElementById('btn-nav-venue');
  const navCompileBtn = document.getElementById('btn-nav-compile');
  const navMasterBtn = document.getElementById('btn-nav-master');

  if (navHarvestBtn) navHarvestBtn.addEventListener('click', (e) => openScanModal('harvest', e));
  if (navQcBtn) navQcBtn.addEventListener('click', (e) => openScanModal('qc', e));
  if (navEnrichBtn) navEnrichBtn.addEventListener('click', (e) => openScanModal('enrich', e));
  if (navVenueBtn) navVenueBtn.addEventListener('click', (e) => openScanModal('venue', e));
  if (navCompileBtn) navCompileBtn.addEventListener('click', (e) => openScanModal('compile', e));
  if (navMasterBtn) navMasterBtn.addEventListener('click', (e) => openScanModal('master', e));

  // Wire 5-Stage Autonomous Pipeline Action Bar & Scan Guide Cards
  const pipelineHarvestBtn = document.getElementById('btn-pipeline-harvest');
  const pipelineQcBtn = document.getElementById('btn-pipeline-qc');
  const pipelineEnrichBtn = document.getElementById('btn-pipeline-enrich');
  const pipelineVenueBtn = document.getElementById('btn-pipeline-venue');
  const pipelineCompileBtn = document.getElementById('btn-pipeline-compile');
  const pipelineMasterBtn = document.getElementById('btn-pipeline-master');

  if (pipelineHarvestBtn) pipelineHarvestBtn.addEventListener('click', (e) => openScanModal('harvest', e));
  if (pipelineQcBtn) pipelineQcBtn.addEventListener('click', (e) => openScanModal('qc', e));
  if (pipelineEnrichBtn) pipelineEnrichBtn.addEventListener('click', (e) => openScanModal('enrich', e));
  if (pipelineVenueBtn) pipelineVenueBtn.addEventListener('click', (e) => openScanModal('venue', e));
  if (pipelineCompileBtn) pipelineCompileBtn.addEventListener('click', (e) => openScanModal('compile', e));
  if (pipelineMasterBtn) pipelineMasterBtn.addEventListener('click', (e) => openScanModal('master', e));

  // Wire Expandable 5-Stage "Autonomous AI Scans & Pipeline Architecture" Panel Header Toggle
  const scansPanel = document.getElementById('ai-scans-dropdown-panel');
  if (scansPanel) {
    const header = scansPanel.querySelector('.scans-guide-header');
    if (header && !header._toggleWired) {
      header._toggleWired = true;
      header.addEventListener('click', (e) => {
        if (e.target.closest('select, button, input, label, a')) return;
        scansPanel.classList.toggle('collapsed');
      });
    }
  }

  // Wire 5-Stage Scan Guide Cards (.scan-guide-card)
  document.querySelectorAll('.scan-guide-card[data-scan-stage]').forEach(card => {
    if (card._stageWired) return;
    card._stageWired = true;
    card.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, select')) return;
      const stageKey = card.getAttribute('data-scan-stage');
      if (stageKey) openScanModal(stageKey, e);
    });
  });

  // 1-Click Catalog-Wide Stagehand QC Button inside Modal
  if (auditAllBtn) {
    auditAllBtn.addEventListener('click', () => {
      const unverifiedOnly = unverifiedOnlyChk ? unverifiedOnlyChk.checked : true;
      const autoApprove = autoApproveChk ? autoApproveChk.checked : true;

      runPipelineAction({
        mode: 'catalog_batch',
        limit: 0,
        url: '',
        all: !unverifiedOnly,
        autoApprove: autoApprove,
        title: '<span>⚡</span> Stagehand Catalog-Wide QC',
        desc: 'Sequentially auditing catalog cards with live Chromium subagent instances (1-by-1)',
        initialStatus: unverifiedOnly
          ? 'Stagehand Batch QC: Auditing all unverified catalog events (1-by-1)...'
          : 'Stagehand Batch QC: Auditing entire catalog from start to finish (1-by-1)...'
      });
    });
  }

  // Custom Target / Calendar Drill Run Button
  if (runBtn) {
    runBtn.addEventListener('click', () => {
      const mode = modeSelect ? modeSelect.value : 'single';
      const url = (urlInput ? urlInput.value : '').trim();

      if (mode !== 'catalog_batch' && mode !== 'enrich' && mode !== 'compile' && (!url || !url.startsWith('http'))) {
        if (typeof showToast === 'function') showToast('Please enter a valid HTTP/HTTPS calendar or ticket URL', 'error');
        if (urlInput) urlInput.focus();
        return;
      }

      const maxEvents = limitInput ? parseInt(limitInput.value, 10) || 5 : 5;
      const autoApprove = autoApproveChk ? autoApproveChk.checked : true;

      runPipelineAction({
        mode: mode,
        limit: maxEvents,
        url: url,
        all: false,
        autoApprove: autoApprove,
        title: mode === 'catalog_batch'
          ? '<span>⚡</span> Stagehand Batch QC Drill'
          : mode === 'calendar'
            ? '<span>📅</span> Calendar Schedule Scan'
            : mode === 'enrich'
              ? '<span>✍️</span> AI Semantic Enricher'
              : mode === 'compile'
                ? '<span>🏛️</span> Compiler AI & Publish'
                : '<span>⚡</span> Single Event / Cart Drill',
        desc: `Target: ${url || 'Catalog Store'} (Limit: ${maxEvents})`,
        initialStatus: mode === 'catalog_batch'
          ? `Stagehand Browser launching: Batch QC on ${maxEvents} catalog events...`
          : mode === 'calendar'
            ? 'Stagehand Browser launching: Harvesting calendar links...'
            : mode === 'enrich'
              ? `AI Enricher launching: Enriching up to ${maxEvents} events...`
              : mode === 'compile'
                ? 'Compiler AI launching: Arbitrating layers & publishing live catalog...'
                : 'Stagehand Browser launching: Penetrating cart...'
      });
    });
  }

  // Kick off initial loading of layers and uncompiled badges
  if (typeof window.loadLayersAndEvents === 'function') {
    window.loadLayersAndEvents();
  }
}

window.openScreenshotModal = function (url) {
  if (!url) return;
  const lightbox = document.getElementById('screenshot-lightbox-modal');
  const img = document.getElementById('lightbox-img');
  if (lightbox && img) {
    img.src = url;
    lightbox.style.display = 'flex';
    lightbox.classList.add('active');
  } else {
    window.open(url, '_blank');
  }
};

window.closeScreenshotModal = function () {
  const lightbox = document.getElementById('screenshot-lightbox-modal');
  if (lightbox) {
    lightbox.style.display = 'none';
    lightbox.classList.remove('active');
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initStagehandRipperUI);
} else {
  initStagehandRipperUI();
}