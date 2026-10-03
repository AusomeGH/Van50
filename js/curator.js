// Van50 Curator Studio — Client Application Logic
// Orchestrates triage, sorting, field corrections, promotions to master, and algorithmic rule learning.

const _urlParams = new URLSearchParams(window.location.search);
const _tokenParam = _urlParams.get('token');
if (_tokenParam) {
  try {
    sessionStorage.setItem('van50_curator_token', _tokenParam);
    localStorage.setItem('van50_curator_token', _tokenParam);
  } catch (e) {}
}

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
    discoveredVenues: 0
  },
  discoveredVenues: [],
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
        try { sessionStorage.setItem('van50_curator_token', state.token); } catch (_) {}
        try { localStorage.setItem('van50_curator_token', state.token); } catch (_) {}
        if (loginModal) loginModal.classList.remove('active');
        if (data.knownVenues) {
          state.knownVenues = new Set(data.knownVenues.map(v => v.toLowerCase()));
        }
        updateHeaderStats(data.pendingCount, data.rulesCount, data.masterCount, data.instructionsPendingCount || 0, data.discoveredVenuesCount || 0);
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
      try { sessionStorage.setItem('van50_curator_token', data.token); } catch (_) {}
      try { localStorage.setItem('van50_curator_token', data.token); } catch (_) {}
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
    try {
      const instRes = await fetch(`/api/curator/instructions?_t=${t}`, {
        headers: { 'Curator-Token': state.token },
        cache: 'no-store'
      });
      if (instRes.ok) {
        const instData = await instRes.json();
        const instructions = instData.instructions || [];
        const instMap = new Map();
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

    // Fetch Holidays Registry
    try {
      const holRes = await fetch(`/api/curator/holidays?_t=${t}`, {
        headers: { 'Curator-Token': state.token },
        cache: 'no-store'
      });
      if (holRes.ok) {
        const holData = await holRes.json();
        state.pendingHolidays = holData.pendingHolidays || [];
        state.approvedHolidays = holData.approvedHolidays || [];
      }
    } catch (e) {
      console.warn('Could not fetch holiday registry:', e);
    }

    updateFilterCounts();
    applyFiltersAndRender();
  } catch (err) {
    showToast('Failed to load quarantine queue', 'error');
  }
}

function updateHeaderStats(pending, rules, master, instructions = 0, discoveredVenues = 0) {
  state.stats.pending = pending;
  state.stats.rules = rules;
  state.stats.master = master;
  state.stats.instructions = instructions;
  state.stats.discoveredVenues = discoveredVenues;

  const elP = document.getElementById('stat-pending-count');
  const elR = document.getElementById('stat-rules-count');
  const elM = document.getElementById('stat-master-count');
  const elI = document.getElementById('stat-instructions-count');
  const elV = document.getElementById('stat-discovered-venues-count');
  if (elP) elP.textContent = pending;
  if (elR) elR.textContent = rules;
  if (elM) elM.textContent = master;
  if (elI) elI.textContent = instructions;
  if (elV) elV.textContent = discoveredVenues;
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

  const setT = (id, count) => {
    const el = document.getElementById(id);
    if (el) el.textContent = count;
  };
  setT('pill-count-all', all.length);
  setT('pill-count-feedback', feedback);
  setT('pill-count-newsletter', newsletter);
  setT('pill-count-discovered-venues', discVenues);
  setT('pill-count-holidays', (state.pendingHolidays || []).length);
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

  // New Holidays Tab
  if (state.activeFilter === 'holidays') {
    renderHolidayCards();
    return;
  }

  // Strict Budget Cap: Curator strictly triages candidates that may meet criteria; >$50 are completely filtered out
  let list = (state.quarantinedEvents || []).filter(e => !isOverBudget(e));

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

  // 3. Search Query
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    list = list.filter(e => {
      return (
        (e.title || '').toLowerCase().includes(q) ||
        (e.venue || '').toLowerCase().includes(q) ||
        (e.neighborhood || '').toLowerCase().includes(q) ||
        (e.flagReason || '').toLowerCase().includes(q) ||
        (e.provider || '').toLowerCase().includes(q)
      );
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

function formatCuratorDate(ev) {
  if (ev.dateSchedule) {
    return ev.dateSchedule;
  }
  if (ev.startIso) {
    try {
      const d = new Date(ev.startIso);
      const dateStr = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return `${dateStr} • ${timeStr}`;
    } catch (e) {}
  }
  if (ev.frequencyLabel) {
    return ev.frequencyLabel;
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
          <a href="${p}" target="_blank" rel="noopener noreferrer" title="Click to view full-size screenshot proof #${idx+1}" style="display: inline-block; text-decoration: none;">
            <img src="${p}" alt="Screenshot #${idx+1}" style="height: 52px; width: 52px; object-fit: cover; border-radius: 6px; border: 1.5px solid rgba(168, 85, 247, 0.6); box-shadow: 0 2px 8px rgba(0,0,0,0.3); transition: transform 0.15s;" onmouseover="this.style.transform='scale(1.08)'" onmouseout="this.style.transform='scale(1)'" />
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
  } catch (e) {}

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

  container.innerHTML = items.map(ev => {
    const attemptedPrice = parseFloat(ev.attemptedPrice || ev.price || 0.0);
    const isBudgetExceeded = attemptedPrice > 50.0;
    const isAutoDenied = ev.reviewStatus === 'denied_auto_budget';
    const hasDrift = isDrift(ev);
    const flagDateStr = ev.flaggedAt ? new Date(ev.flaggedAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Recently';
    const isHandled = Boolean(ev.dealtWith || ev.queuedInstruction);
    const curatorDateStr = formatCuratorDate(ev);
    const diagnosticsHtml = generateCuratorDiagnostics(ev);
    const vName = (ev.venue || '').trim();
    const isDiscoveredVenue = Boolean(vName && state.knownVenues && state.knownVenues.size > 0 && !state.knownVenues.has(vName.toLowerCase()));
    const targetUrl = getEventExternalUrl(ev);

    return `
      <div class="curator-card ${isHandled ? 'curator-card-handled' : ''}" id="card-${ev.id}" data-event-id="${ev.id}">
        <!-- Top Title & Metadata -->
        <div class="curator-card-top">
          <div>
            <h3 class="curator-card-title">${escapeHtml(ev.title)}</h3>
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
              <span>🕒 Queued ${inst.createdAt ? new Date(inst.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'recently'}</span>
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

window.approveQuarantinedEvent = async function(eventId) {
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

window.rejectQuarantinedEvent = async function(eventId) {
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

window.setModalViewMode = function(mode = 'screenshot') {
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

window.openAIInstructionModal = function(eventId, mode = 'approve') {
  const ev = (state.quarantinedEvents || []).find(e => e.id === eventId) || (state.archivedEvents || []).find(e => e.id === eventId);
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

window.openEmailScreenshotModal = function(eventId) {
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
        navigator.clipboard.writeText(l).catch(() => {});
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

window.selectActiveScreenshot = function(index) {
  if (!state.currentScreenshots || index < 0 || index >= state.currentScreenshots.length) return;
  state.activeScreenshotIndex = index;
  state.currentScreenshotBase64 = state.currentScreenshots[index];
  renderScreenshotGallery();
  showToast(`🔍 Verifying screenshot #${index + 1}...`, 'info');
  triggerScreenshotVerification(state.currentScreenshots[index]);
};

window.removeScreenshotByIndex = function(index) {
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

window.removeVenueScreenshotByIndex = function(index) {
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

window.openAddVenueModal = function(v, options = {}) {
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

window.openAddVenueModalFromEvent = function(eventId) {
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

  const pending = state.pendingHolidays || [];
  const approved = state.approvedHolidays || [];

  if (countDisplay) {
    countDisplay.innerHTML = `Showing <strong>${pending.length}</strong> candidate holiday(s) discovered by AI awaiting curator approval`;
  }

  let html = '';

  if (pending.length === 0) {
    html += `
      <div style="text-align: center; padding: 48px 20px; background: var(--curator-surface); border: 1px solid var(--curator-border); border-radius: 12px; margin-bottom: 24px;">
        <div style="font-size: 2.5rem; margin-bottom: 12px;">🎉</div>
        <h3 style="font-family: var(--font-heading); font-size: 1.25rem; color: #fff; margin-bottom: 6px;">
          No Pending Holidays Awaiting Review
        </h3>
        <p style="font-size: 0.88rem; color: var(--curator-text-muted); max-width: 520px; margin: 0 auto; line-height: 1.5;">
          All holidays discovered by the AI scouts are verified and registered in the system.
        </p>
      </div>
    `;
  } else {
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
  `;

  container.innerHTML = html;
}

window.approveHoliday = async function(holidayId) {
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

window.rejectHoliday = async function(holidayId) {
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

window.dismissDiscoveredVenue = async function(discId) {
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
        } catch (e) {}
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
    } catch (_) {}

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
    try { sessionStorage.clear(); } catch (_) {}
    try { localStorage.clear(); } catch (_) {}
    if (curToken) {
      try { sessionStorage.setItem('van50_curator_token', curToken); } catch (_) {}
      try { localStorage.setItem('van50_curator_token', curToken); } catch (_) {}
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

window.openLearnedRulesModal = async function() {
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

window.openAIInstructionsModal = async function() {
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

window.openEditRule = function(type, key) {
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

window.openAddRule = function() {
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

window.deleteRule = async function(ruleType, key) {
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

window.openEditInstruction = function(instId) {
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

window.deleteInstruction = async function(instId) {
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
  } catch (e) {}
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
  } catch (e) {}

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

window.openMasterCatalogsModal = async function() {
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
    container.innerHTML = list.map(ev => {
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
              <strong style="color: #f8fafc; font-size: 0.96rem;">${escapeHtml(ev.event_name || ev.title || 'Event')}</strong>
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
            <div style="display: flex; gap: 8px;">
              ${tags}
              ${ev.ticket_url ? `<a href="${escapeHtml(ev.ticket_url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #38bdf8; text-decoration: underline;">Tickets ↗</a>` : ''}
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
          <div style="display: flex; gap: 12px; margin-top: 4px; font-size: 0.78rem;">
            ${calUrl ? `<a href="${escapeHtml(calUrl)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #38bdf8; text-decoration: underline;">📅 Calendar Page ↗</a>` : ''}
            ${vm.website_url && vm.website_url !== calUrl ? `<a href="${escapeHtml(vm.website_url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #94a3b8; text-decoration: underline;">🌐 Website ↗</a>` : ''}
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
          <div style="display: flex; gap: 12px; margin-top: 4px; font-size: 0.78rem;">
            ${fm.schedule_url ? `<a href="${escapeHtml(fm.schedule_url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #38bdf8; text-decoration: underline;">📅 Schedule & Lineup ↗</a>` : ''}
            ${fm.website_url ? `<a href="${escapeHtml(fm.website_url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" style="color: #94a3b8; text-decoration: underline;">🌐 Festival Portal ↗</a>` : ''}
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

window.approvePriceConsensus = async function(venueName, pintPrice, cocktailPrice) {
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


