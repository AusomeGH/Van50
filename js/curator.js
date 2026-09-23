// Van50 Curator Studio — Client Application Logic
// Orchestrates triage, sorting, field corrections, promotions to master, and algorithmic rule learning.

const state = {
  token: sessionStorage.getItem('van50_curator_token') || null,
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
  knownVenues: new Set(),
  currentScreenshotBase64: null,
  currentScreenshots: [],
  currentVenueScreenshots: [],
  learnedRules: null,
  activeRuleTab: 'venue_policy_rules',
  rulesSearchQuery: '',
  instructionsList: [],
  activeInstFilter: 'all',
  instructionsSearchQuery: ''
};

function initApp() {
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

async function checkAuthAndInitialize() {
  const loginModal = document.getElementById('login-modal-overlay');
  
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
        if (loginModal) loginModal.classList.remove('active');
        if (data.knownVenues) {
          state.knownVenues = new Set(data.knownVenues.map(v => v.toLowerCase()));
        }
        updateHeaderStats(data.pendingCount, data.rulesCount, data.masterCount, data.instructionsPendingCount || 0, data.discoveredVenuesCount || 0);
        loadQuarantineQueue();
        return;
      }
    }
  } catch (err) {
    console.warn('Could not verify curator status:', err);
  }

  // If token is invalid or expired
  sessionStorage.removeItem('van50_curator_token');
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
      sessionStorage.setItem('van50_curator_token', data.token);
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
  const currentToken = state.token || sessionStorage.getItem('van50_curator_token');
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
      state.quarantinedEvents = data.quarantinedEvents || [];
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
        state.archivedEvents = archData.archivedEvents || [];
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
  setT('pill-count-newsletter', newsletter);
  setT('pill-count-discovered-venues', discVenues);
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

  // Strict Budget Cap: Curator strictly triages candidates that may meet criteria; >$50 are completely filtered out
  let list = (state.quarantinedEvents || []).filter(e => !isOverBudget(e));

  // 1. Tab Filter
  if (state.activeFilter === 'unhandled') {
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
  if (r.includes('schedule') || r.includes('generic catalog index') || r.includes('without specific event slug')) {
    return '🔗 Venue calendar link (no direct show URL)';
  }
  if (r.includes('bare root homepage') || r.includes('bare root')) {
    return '🔗 Venue homepage (needs direct show link or as-is approval)';
  }
  if (r.includes('generic link') || r.includes('catalog index')) {
    return '🔗 General venue listing (not direct show page)';
  }
  if (r.includes('drift') || r.includes('price drift')) {
    return '⚠️ Price drift detected (source page differs from saved price)';
  }
  if (r.includes('paypal')) {
    return '💳 Direct PayPal checkout link (needs verification)';
  }
  if (r.includes('ticketweb') || r.includes('showpass') || r.includes('eventbrite') || r.includes('checkout pricing') || r.includes('cart')) {
    return '💳 Cart / checkout total unverified by automated scraper';
  }
  if (r.includes('unverified') || r.includes('could not dynamically verify') || r.includes('not confirmed')) {
    return '🔍 Live door/ticket price needs human confirmation';
  }

  const cleaned = reason.replace(/https?:\/\/[^\s]+/g, '').replace(/Autonomous Hunter [^.]+\./i, '').trim();
  return cleaned.length > 70 ? cleaned.slice(0, 67) + '...' : cleaned;
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
  confirmedItems.push(`<span>💰 <strong>Base Price:</strong> ${verifiedPrice} (${escapeHtml(ev.provider || 'Direct')})</span>`);
  
  if (ev.categoryLabel || ev.category) {
    confirmedItems.push(`<span>🏷️ <strong>Category:</strong> ${escapeHtml(ev.categoryLabel || ev.category)}</span>`);
  }
  
  if (ev.websiteUrl) {
    confirmedItems.push(`<span>🔗 <strong>Event Link:</strong> <a href="${escapeHtml(ev.websiteUrl)}" target="_blank" rel="noopener noreferrer" style="color: #38bdf8; text-decoration: underline;">Open Host Page ↗</a></span>`);
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

    return `
      <div class="curator-card ${isHandled ? 'curator-card-handled' : ''}" id="card-${ev.id}">
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
            ${isHandled ? `<span class="curator-badge-pill curator-badge-handled">🤖 AI Queued</span>` : ''}
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

        <!-- Prominent Instruction Banner (Displays User Instructions on Cards) -->
        ${(isHandled && ev.queuedInstruction) ? `
          <div class="curator-handled-box" style="background: rgba(168, 85, 247, 0.12); border: 1.5px solid rgba(168, 85, 247, 0.5); border-left: 5px solid #a855f7; border-radius: 8px; padding: 12px 14px; margin: 10px 0 14px 0;">
            <div class="curator-handled-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <strong style="color: #d8b4fe; font-size: 0.88rem; display: inline-flex; align-items: center; gap: 6px;">
                <span>🤖</span> Your AI Scraper Instruction:
              </strong>
              <span class="curator-handled-tag" style="background: rgba(168, 85, 247, 0.25); border: 1px solid rgba(168, 85, 247, 0.5); color: #f3e8ff; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">
                ${escapeHtml(
                  (ev.queuedInstruction.action === 'queue_and_approve' || ev.queuedInstruction.actionTaken === 'queue_and_approve')
                    ? '⚡ Approved & Training AI'
                    : (ev.queuedInstruction.action === 'queue_and_dismiss' || ev.queuedInstruction.actionTaken === 'queue_and_dismiss')
                      ? '🛑 Dismissed & Training AI'
                      : '📋 Held for AI Review'
                )}
              </span>
            </div>
            <div class="curator-handled-text" style="color: #ffffff; font-size: 0.95rem; font-weight: 500; line-height: 1.45; background: rgba(0, 0, 0, 0.3); padding: 8px 12px; border-radius: 6px; border-left: 3px solid #c084fc; margin-bottom: 8px;">
              “${escapeHtml(ev.queuedInstruction.instructionText || '')}”
            </div>
            ${renderCardScreenshotThumbnails(ev.queuedInstruction)}
            <div class="curator-handled-meta" style="font-size: 0.78rem; color: #cbd5e1; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">
              <span>🕒 Queued ${ev.queuedInstruction.createdAt ? new Date(ev.queuedInstruction.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'recently'}</span>
              ${ev.queuedInstruction.approvedPrice ? `<span style="color: #34d399; font-weight: 600;">💰 Target Price: $${Number(ev.queuedInstruction.approvedPrice).toFixed(2)} CAD</span>` : ''}
              <div style="margin-left: auto; display: flex; align-items: center; gap: 8px;">
                <button type="button" class="btn-curator btn-curator-success" onclick="approveQuarantinedEvent('${ev.id}')" style="padding: 4px 12px; font-size: 0.78rem; font-weight: 700; border-radius: 4px; box-shadow: 0 0 10px rgba(16, 185, 129, 0.35);" title="Immediately approve and publish this event to live catalog">✅ Approve &amp; Push Live</button>
                <button type="button" class="btn-curator-edit-inst" onclick="openAIInstructionModal('${ev.id}')" style="background: rgba(168, 85, 247, 0.18); border: 1px solid rgba(168, 85, 247, 0.45); color: #e9d5ff; border-radius: 4px; padding: 4px 10px; font-size: 0.75rem; font-weight: 600; cursor: pointer; transition: background 0.15s;" onmouseover="this.style.background='rgba(168, 85, 247, 0.35)'" onmouseout="this.style.background='rgba(168, 85, 247, 0.18)'">✏️ Edit / Add Proof</button>
              </div>
            </div>
          </div>
        ` : ''}

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
            ` : `
              <button 
                type="button" 
                class="btn-curator btn-curator-success" 
                onclick="approveQuarantinedEvent('${ev.id}')"
                title="Approve details as-is, promote directly to live catalog, and queue for AI learning"
              >
                ✅ Approve As-Is
              </button>

              <button 
                type="button" 
                class="btn-curator btn-curator-ai-approve" 
                onclick="openAIInstructionModal('${ev.id}', 'instruct')"
                title="Attach screenshot or notes for AI to review and update scrapers"
              >
                🤖 Instruct AI
              </button>

              <button 
                type="button" 
                class="btn-curator btn-curator-ghost" 
                style="color: #38bdf8; border-color: rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.08);"
                onclick="openAIInstructionModal('${ev.id}', 'screenshot')"
                title="Attach screenshot to extract all 7 live dimensions and align card"
              >
                📸 Verify Screenshot
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
            `}
          </div>

          <div>
            <a 
              href="${escapeHtml(ev.websiteUrl)}" 
              target="_blank" 
              rel="noopener noreferrer" 
              class="btn-curator btn-curator-ghost"
              title="Inspect live venue page in new tab"
            >
              🔗 Inspect Source Page ↗
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ==============================================================================
// 5. EVENT ACTIONS: APPROVE, REJECT, TEACH
// ==============================================================================

window.approveQuarantinedEvent = async function(eventId) {
  if (!state.token) return;
  const original = state.quarantinedEvents.find(e => e.id === eventId);
  if (!original) return;

  const priceInput = document.getElementById(`edit-price-${eventId}`);
  const labelInput = document.getElementById(`edit-label-${eventId}`);
  const categorySelect = document.getElementById(`edit-category-${eventId}`);
  const feeInput = document.getElementById(`edit-fee-${eventId}`);

  const price = parseFloat(priceInput ? priceInput.value : original.attemptedPrice || 0.0);
  if (isNaN(price) || price > 50.0) {
    showToast('Price must be a valid amount under or equal to $50.00 CAD.', 'error');
    return;
  }

  const dateInput = document.getElementById(`edit-date-${eventId}`);

  const payloadEvent = {
    ...original,
    price: price,
    priceLabel: labelInput ? labelInput.value.trim() : original.attemptedPriceLabel || `$${price.toFixed(2)} all-in`,
    pricingType: price === 0 ? 'free' : 'fixed',
    isFree: price === 0,
    category: categorySelect ? categorySelect.value : original.category || 'shows',
    dateSchedule: dateInput && dateInput.value.trim() ? dateInput.value.trim() : (original.dateSchedule || original.frequencyLabel || 'Upcoming'),
    feeBreakdown: feeInput ? feeInput.value.trim() : `Curator approved: $${price.toFixed(2)} CAD`,
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
      showToast(`✅ Approved '${original.title}' as-is! Queued for AI learning.`, 'success');
      state.quarantinedEvents = state.quarantinedEvents.filter(e => e.id !== eventId);
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
      showToast(`Event '${original.title}' moved to archive.`, 'info');
      state.quarantinedEvents = state.quarantinedEvents.filter(e => e.id !== eventId);
      updateFilterCounts();
      applyFiltersAndRender();
    } else {
      showToast(data.error || 'Failed to reject event', 'error');
    }
  } catch (err) {
    showToast('Server error while rejecting event', 'error');
  }
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

  // Configure modal presentation based on action mode
  if (mode === 'approve') {
    if (modalIcon) modalIcon.textContent = '✨';
    if (modalTitle) modalTitle.textContent = 'Approve & Instruct AI';
    if (modalDesc) modalDesc.textContent = "Approve this event into the master catalog and provide plain-English instructions so AI scrapers learn the verified pricing and venue pattern.";
    if (quickApprovalBox) quickApprovalBox.style.display = 'block';
    if (btnApprove) btnApprove.style.display = 'inline-flex';
    if (btnDismiss) btnDismiss.style.display = 'none';
  } else if (mode === 'dismiss') {
    if (modalIcon) modalIcon.textContent = '🛑';
    if (modalTitle) modalTitle.textContent = 'Dismiss & Instruct AI';
    if (modalDesc) modalDesc.textContent = "Dismiss and archive this event, and tell AI scrapers why so they permanently skip or adapt to this format on future crawls.";
    if (quickApprovalBox) quickApprovalBox.style.display = 'none';
    if (btnApprove) btnApprove.style.display = 'none';
    if (btnDismiss) btnDismiss.style.display = 'inline-flex';
  } else if (mode === 'screenshot') {
    if (modalIcon) modalIcon.textContent = '📸';
    if (modalTitle) modalTitle.textContent = 'Screenshot Proof & 7-Dimension Verifier';
    if (modalDesc) modalDesc.textContent = "Upload or paste (Ctrl+V) a screenshot to extract all 7 live dimensions (Schedule, Frequency, Category, Location, Price, Provider, Lineup) and align with this card.";
    if (quickApprovalBox) quickApprovalBox.style.display = 'block';
    if (btnApprove) btnApprove.style.display = 'inline-flex';
    if (btnDismiss) btnDismiss.style.display = 'none';
  } else {
    if (modalIcon) modalIcon.textContent = '🤖';
    if (modalTitle) modalTitle.textContent = 'Instruct AI Assistant';
    if (modalDesc) modalDesc.textContent = "Attach a screenshot or explain what to fix. Antigravity will update the crawlers and learn the pattern permanently.";
    if (quickApprovalBox) quickApprovalBox.style.display = 'block';
    if (btnApprove) btnApprove.style.display = 'inline-flex';
    if (btnDismiss) btnDismiss.style.display = 'none';
  }

  if (ev) {
    if (idField) idField.value = ev.id || '';
    if (venueField) venueField.value = ev.venue || '';
    if (titleField) titleField.value = ev.title || '';
    const website = ev.websiteUrl || ev.url || '';
    if (urlField) urlField.value = website;

    if (summaryTitle) summaryTitle.textContent = ev.title || 'Untitled Event';
    if (summaryVenue) summaryVenue.textContent = `${ev.venue || 'Unknown Venue'} • ${ev.neighborhood || 'Vancouver'} • Provider: ${ev.provider || 'Direct'}`;
    if (summaryLink) {
      summaryLink.href = website || '#';
      summaryLink.textContent = website ? `Source: ${website} ↗` : 'No direct URL';
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
  }

  // Prepopulate if previously dealt with / instruction already queued
  clearScreenshotPreview();
  if (ev && ev.queuedInstruction) {
    const q = ev.queuedInstruction;
    if (textField) textField.value = q.instructionText || '';
    if (q.approvedPrice && priceField) priceField.value = parseFloat(q.approvedPrice).toFixed(2);
    if (q.approvedCategory && catField) catField.value = q.approvedCategory;
    if (q.approvedDate && dateField) dateField.value = q.approvedDate;
    if (q.approvedVenue && venueApproveField) venueApproveField.value = q.approvedVenue;
    if (q.curatorNote && noteField) noteField.value = q.curatorNote;
    
    // Load screenshots (support both screenshotPaths array and single screenshotPath/screenshotBase64)
    const existingImgs = [];
    if (Array.isArray(q.screenshotPaths) && q.screenshotPaths.length > 0) {
      existingImgs.push(...q.screenshotPaths);
    } else if (q.screenshotPath) {
      existingImgs.push(q.screenshotPath);
    } else if (q.screenshotBase64) {
      existingImgs.push(q.screenshotBase64);
    }
    if (existingImgs.length > 0) {
      addScreenshotDataUrls(existingImgs);
    }
  } else if (textField) {
    textField.value = '';
    if (mode === 'dismiss') {
      textField.placeholder = "e.g.: 'This venue is private bookings only, or this is a multi-week course rather than a drop-in. Please ignore this section.'";
    } else if (mode === 'screenshot') {
      textField.placeholder = "e.g.: 'Attached screenshot proof showing verified door price, showtimes, and lineup.'";
    } else if (ev && isDrift(ev)) {
      textField.placeholder = `Explain the live drift, e.g.: 'The page now shows a price change. The scraper should look for the lowest general admission tier at...'`;
    } else {
      textField.placeholder = "e.g.: 'The scraper picked up the $65 VIP tier instead of the $25 General Admission ticket shown at the bottom of the page. Please target the GA price for this venue.'";
    }
  }

  modal.classList.add('active');
  setTimeout(() => {
    if (mode === 'screenshot') {
      document.getElementById('ai-screenshot-dropzone')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else if (textField) {
      textField.focus();
    }
  }, 100);
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
}

const LIVE_DIMENSION_KEYS = ['date', 'frequency', 'category', 'location', 'price', 'link', 'description'];

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

  // Reset all 7 dimension cards
  const defaults = {
    date: { val: 'No date detected', compare: 'Card: Pending Review' },
    frequency: { val: 'One-off Show', compare: 'Card: One-off Show' },
    category: { val: '🏷️ Event', compare: 'Card: Comedy & Shows' },
    location: { val: 'Venue unverified', compare: 'Card: Venue' },
    price: { val: '$0.00 CAD', compare: 'Card: $0.00' },
    link: { val: 'Direct / Box Office', compare: 'Card: Direct' },
    description: { val: 'No details extracted', compare: 'Card: Title' }
  };

  LIVE_DIMENSION_KEYS.forEach(k => {
    const cardEl = document.getElementById(`ai-dim-card-${k}`);
    const badgeEl = document.getElementById(`ai-dim-badge-${k}`);
    const valEl = document.getElementById(`ai-dim-val-${k}`);
    const compEl = document.getElementById(`ai-dim-compare-${k}`);
    if (cardEl) cardEl.className = 'curator-dimension-card';
    if (badgeEl) {
      badgeEl.textContent = 'Pending';
      badgeEl.className = 'dim-pill dim-pill-unconfirmed';
    }
    if (valEl) valEl.textContent = defaults[k]?.val || 'Pending';
    if (compEl) compEl.textContent = defaults[k]?.compare || '';
  });

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
  const priceInput = document.getElementById('ai-approve-price');
  const catInput = document.getElementById('ai-approve-category');
  const dateInput = document.getElementById('ai-approve-date');
  const venueInput = document.getElementById('ai-approve-venue');
  const noteInput = document.getElementById('ai-approve-note');

  const highlightedEls = [];

  // 1. Price
  if (priceInput && dims.price) {
    const p = dims.price.extracted !== null && dims.price.extracted !== undefined ? dims.price.extracted : dims.price.total;
    if (p !== null && p !== undefined && !isNaN(p)) {
      priceInput.value = parseFloat(p).toFixed(2);
      highlightedEls.push(priceInput);
    }
  }

  // 2. Category
  if (catInput && dims.category) {
    const targetCat = (dims.category.extracted || dims.category.detected || '').toLowerCase();
    for (let opt of catInput.options) {
      if (opt.value === targetCat || (targetCat && opt.value.includes(targetCat))) {
        catInput.value = opt.value;
        highlightedEls.push(catInput);
        break;
      }
    }
  }

  // 3. Date
  if (dateInput && dims.date) {
    const d = dims.date.extracted || dims.date.displayValue;
    if (d && d !== 'No date detected on screenshot' && d !== 'No specific date detected') {
      dateInput.value = d;
      highlightedEls.push(dateInput);
    }
  }

  // 4. Venue & Location
  if (venueInput && dims.location) {
    const v = dims.location.details?.venue || dims.location.extracted || dims.location.venue;
    if (v && v !== 'Venue unverified' && v !== 'Venue') {
      venueInput.value = v;
      highlightedEls.push(venueInput);
    }
  }

  // 5. Note / Fee breakdown & Lineup
  if (noteInput) {
    const notes = [];
    if (dims.price?.details?.breakdown) {
      notes.push(dims.price.details.breakdown);
    }
    if (dims.description?.details?.lineup) {
      notes.push(`Lineup: ${dims.description.details.lineup}`);
    }
    if (dims.description?.details?.agePolicy && dims.description.details.agePolicy.includes('19+')) {
      notes.push('Age: 19+ (Adult)');
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

  showToast('⚡ Applied all 7 extracted live dimensions to card!', 'success');
}

function applySingleDimension(dimKey, dims) {
  if (!dims || !dims[dimKey]) return;
  const dim = dims[dimKey];
  const priceInput = document.getElementById('ai-approve-price');
  const catInput = document.getElementById('ai-approve-category');
  const dateInput = document.getElementById('ai-approve-date');
  const venueInput = document.getElementById('ai-approve-venue');
  const noteInput = document.getElementById('ai-approve-note');

  let updatedEl = null;

  if (dimKey === 'date' && dateInput) {
    const d = dim.extracted || dim.displayValue;
    if (d) {
      dateInput.value = d;
      updatedEl = dateInput;
      showToast(`⚡ Applied extracted date: "${d}"`, 'success');
    }
  } else if (dimKey === 'frequency' && noteInput) {
    const f = dim.displayValue || dim.extracted;
    if (f) {
      noteInput.value = (noteInput.value ? noteInput.value + ' • ' : '') + `Recurrence: ${f}`;
      updatedEl = noteInput;
      showToast(`⚡ Applied frequency to audit notes!`, 'success');
    }
  } else if (dimKey === 'category' && catInput) {
    const c = (dim.extracted || dim.detected || '').toLowerCase();
    for (let opt of catInput.options) {
      if (opt.value === c || (c && opt.value.includes(c))) {
        catInput.value = opt.value;
        updatedEl = catInput;
        showToast(`⚡ Selected category: ${opt.textContent}`, 'success');
        break;
      }
    }
  } else if (dimKey === 'location' && venueInput) {
    const v = dim.details?.venue || dim.extracted || dim.venue;
    if (v) {
      venueInput.value = v;
      updatedEl = venueInput;
      showToast(`⚡ Applied venue: "${v}"`, 'success');
    }
  } else if (dimKey === 'price' && priceInput) {
    const p = dim.extracted !== null && dim.extracted !== undefined ? dim.extracted : dim.total;
    if (p !== null && !isNaN(p)) {
      priceInput.value = parseFloat(p).toFixed(2);
      updatedEl = priceInput;
      if (noteInput && dim.displayValue) {
        noteInput.value = dim.displayValue;
      }
      showToast(`⚡ Applied verified price $${parseFloat(p).toFixed(2)} CAD!`, 'success');
    }
  } else if (dimKey === 'link' && noteInput) {
    const prov = dim.displayValue || dim.extracted;
    if (prov) {
      noteInput.value = (noteInput.value ? noteInput.value + ' • ' : '') + `Provider: ${prov}`;
      updatedEl = noteInput;
      showToast(`⚡ Applied ticketing provider details!`, 'success');
    }
  } else if (dimKey === 'description' && noteInput) {
    const desc = dim.displayValue || dim.extracted;
    if (desc) {
      noteInput.value = desc;
      updatedEl = noteInput;
      showToast(`⚡ Applied lineup and restriction details!`, 'success');
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
            badge.textContent = '✓ 7/7 Dimensions Aligned';
            badge.style.background = 'rgba(16, 185, 129, 0.25)';
            badge.style.color = '#34d399';
          } else if (data.warnings && data.warnings.length > 0) {
            badge.textContent = '⚠️ Attention Needed';
            badge.style.background = 'rgba(245, 158, 11, 0.25)';
            badge.style.color = '#fbbf24';
          } else {
            badge.textContent = '✓ 7 Dimensions Extracted';
            badge.style.background = 'rgba(56, 189, 248, 0.25)';
            badge.style.color = '#38bdf8';
          }
        }

        // 2. Enable Master "Apply All Extracted Dimensions" button
        if (btnApplyAll) {
          btnApplyAll.style.display = 'inline-flex';
        }

        // 3. Render All 7 Dimensions in the Interactive Grid
        LIVE_DIMENSION_KEYS.forEach(k => {
          const dim = dims[k];
          if (!dim) return;

          const cardEl = document.getElementById(`ai-dim-card-${k}`);
          const badgeEl = document.getElementById(`ai-dim-badge-${k}`);
          const valEl = document.getElementById(`ai-dim-val-${k}`);
          const compEl = document.getElementById(`ai-dim-compare-${k}`);

          if (valEl) {
            valEl.textContent = dim.displayValue || dim.extracted || 'Not detected';
          }

          if (compEl) {
            const cardValStr = dim.cardValue || 'Pending Review';
            compEl.textContent = `Card: ${cardValStr}`;
          }

          if (badgeEl) {
            if (dim.isMatch) {
              badgeEl.textContent = '✓ Verified Match';
              badgeEl.className = 'dim-pill pill-confirmed';
            } else if (dim.status === 'discrepancy') {
              badgeEl.textContent = '⚠️ Discrepancy';
              badgeEl.className = 'dim-pill pill-discrepancy';
            } else if (dim.extracted) {
              badgeEl.textContent = '🔍 Extracted';
              badgeEl.className = 'dim-pill pill-inferred';
            } else {
              badgeEl.textContent = 'Unconfirmed';
              badgeEl.className = 'dim-pill pill-unconfirmed';
            }
          }

          if (cardEl) {
            if (dim.isMatch) {
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
          if (cardPrice !== null && shotPrice !== null && Math.abs(cardPrice - shotPrice) > 0.05) {
            discrepancyAlert.style.display = 'block';
            discrepancyAlert.innerHTML = `⚠️ <strong>Price Mismatch:</strong> Card has <strong>$${cardPrice.toFixed(2)}</strong>, but screenshot verified <strong>$${shotPrice.toFixed(2)} all-in</strong>. Click <em>⚡ Apply All Extracted Dimensions</em> to update.`;
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

        showToast('🔍 Extracted all 7 live dimensions from screenshot!', 'info');
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

  state.currentScreenshotBase64 = state.currentScreenshots[0] || null;

  if (prompt) prompt.style.display = 'none';
  if (container) container.style.display = 'block';
  if (countLabel) {
    const n = state.currentScreenshots.length;
    countLabel.textContent = `🖼️ ${n} Screenshot${n === 1 ? '' : 's'} Attached`;
  }

  if (gallery) {
    gallery.innerHTML = state.currentScreenshots.map((src, idx) => `
      <div class="ai-gallery-item" style="position: relative; width: 88px; height: 88px; border-radius: 6px; overflow: hidden; border: 1.5px solid rgba(168, 85, 247, 0.55); background: #0f172a; flex-shrink: 0; box-shadow: 0 2px 6px rgba(0,0,0,0.4);">
        <img src="${src}" alt="Screenshot #${idx + 1}" style="width: 100%; height: 100%; object-fit: cover; cursor: pointer;" onclick="window.open('${src}', '_blank')" title="Click to view full size">
        <button type="button" onclick="event.stopPropagation(); window.removeScreenshotByIndex(${idx});" title="Remove image" style="position: absolute; top: 3px; right: 3px; background: rgba(239, 68, 68, 0.9); color: #fff; border: none; border-radius: 50%; width: 22px; height: 22px; font-size: 12px; font-weight: bold; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; box-shadow: 0 1px 4px rgba(0,0,0,0.5);">✕</button>
        <div style="position: absolute; bottom: 3px; left: 3px; background: rgba(0,0,0,0.75); color: #e2e8f0; font-size: 10px; padding: 1px 5px; border-radius: 3px; font-weight: 600;">#${idx + 1}</div>
      </div>
    `).join('');
  }
}

window.removeScreenshotByIndex = function(index) {
  if (state.currentScreenshots && index >= 0 && index < state.currentScreenshots.length) {
    state.currentScreenshots.splice(index, 1);
    renderScreenshotGallery();
    showToast('Screenshot removed', 'info');
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
  for (const url of urls) {
    if (url && typeof url === 'string') {
      state.currentScreenshots.push(url);
      addedCount++;
    }
  }
  renderScreenshotGallery();
  if (addedCount > 0) {
    showToast(`🖼️ ${addedCount} screenshot${addedCount > 1 ? 's' : ''} added!`, 'info');
    if (state.currentScreenshots && state.currentScreenshots.length > 0) {
      triggerScreenshotVerification(state.currentScreenshots[0]);
    }
  }
}

function setScreenshotPreview(dataUrl) {
  if (!dataUrl) return;
  addScreenshotDataUrls([dataUrl]);
}

async function submitAIInstruction(action = 'queue_only') {
  if (!state.token) return;

  const textField = document.getElementById('ai-instruction-text');
  const instructionText = textField ? textField.value.trim() : '';
  if (!instructionText) {
    showToast('Please provide plain-English instructions for the AI Assistant', 'error');
    if (textField) textField.focus();
    return;
  }

  const eventId = document.getElementById('ai-inst-event-id')?.value || '';
  const eventTitle = document.getElementById('ai-inst-title')?.value || '';
  const venueName = document.getElementById('ai-inst-venue')?.value || '';
  const sourceUrl = document.getElementById('ai-inst-url')?.value || '';

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

  if (action === 'queue_and_approve' && (isNaN(approvedPrice) || approvedPrice < 0 || approvedPrice > 50.0)) {
    showToast('Price must be a valid number between $0.00 and $50.00 CAD to approve!', 'error');
    return;
  }

  const payload = {
    instructionText: instructionText,
    eventId: eventId,
    eventTitle: eventTitle,
    venueName: approvedVenue || venueName,
    sourceUrl: sourceUrl,
    screenshotBase64: state.currentScreenshots[0] || state.currentScreenshotBase64 || null,
    screenshotsBase64: state.currentScreenshots || [],
    action: action,
    approvedPrice: approvedPrice,
    approvedCategory: approvedCategory,
    approvedDate: approvedDate,
    approvedVenue: approvedVenue,
    curatorNote: curatorNote
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
      const successMsg = action === 'queue_and_approve'
        ? '✅ Approved as-is and queued for AI learning!'
        : (data.message || '🤖 Queued for AI Assistant review!');
      showToast(successMsg, 'success');
      const modal = document.getElementById('ai-instruction-modal');
      if (modal) modal.classList.remove('active');

      // Update in-memory quarantined event immediately so UI shows handled state
      const targetItem = state.quarantinedEvents.find(e => e.id === eventId);
      if (targetItem) {
        targetItem.dealtWith = true;
        const finalPaths = (data.screenshotPaths && data.screenshotPaths.length > 0)
          ? data.screenshotPaths
          : (data.screenshotPath ? [data.screenshotPath] : [...state.currentScreenshots]);
        targetItem.queuedInstruction = {
          instructionText: instructionText,
          eventId: eventId,
          eventTitle: eventTitle,
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
      }

      if (action === 'queue_and_approve' || action === 'queue_and_dismiss') {
        state.quarantinedEvents = state.quarantinedEvents.filter(e => e.id !== eventId);
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

  // Search Input
  const searchInput = document.getElementById('curator-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      state.searchQuery = searchInput.value.trim();
      applyFiltersAndRender();
    });
  }

  // AI Instruction Form & Modal Hooks
  const aiModal = document.getElementById('ai-instruction-modal');
  const cancelAiBtn = document.getElementById('btn-cancel-ai-inst');
  const btnCloseAiModal = document.getElementById('btn-close-ai-modal');

  const closeAiModal = () => {
    if (aiModal) aiModal.classList.remove('active');
    resetScreenshotAlignmentPanel();
  };

  if (cancelAiBtn) cancelAiBtn.addEventListener('click', closeAiModal);
  if (btnCloseAiModal) btnCloseAiModal.addEventListener('click', closeAiModal);
  if (aiModal) {
    aiModal.addEventListener('click', (e) => {
      if (e.target === aiModal) closeAiModal();
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


  const btnSubmitOnly = document.getElementById('btn-submit-ai-inst-only');
  if (btnSubmitOnly) {
    btnSubmitOnly.addEventListener('click', () => submitAIInstruction('queue_only'));
  }

  const btnSubmitAndApprove = document.getElementById('btn-submit-ai-inst-and-approve');
  if (btnSubmitAndApprove) {
    btnSubmitAndApprove.addEventListener('click', () => submitAIInstruction('queue_and_approve'));
  }

  const btnSubmitAndDismiss = document.getElementById('btn-submit-ai-inst-and-dismiss');
  if (btnSubmitAndDismiss) {
    btnSubmitAndDismiss.addEventListener('click', () => submitAIInstruction('queue_and_dismiss'));
  }

  // Screenshot Dropzone & File Input (Supports Multiple Screenshots)
  const dropzone = document.getElementById('ai-screenshot-dropzone');
  const fileInput = document.getElementById('ai-screenshot-file-input');
  const btnAddMore = document.getElementById('btn-add-more-screenshots');

  if (btnAddMore && fileInput) {
    btnAddMore.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  if (dropzone && fileInput) {
    dropzone.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      fileInput.click();
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
            ${isHandled ? `<span class="curator-badge-pill curator-badge-handled">🤖 AI Queued</span>` : ''}
          </div>
        </div>

        <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 10px 14px; margin: 12px 0; font-size: 0.85rem; color: var(--curator-text-muted);">
          <div><strong>Context / Sample Event:</strong> ${escapeHtml(v.sampleEvent || 'Detected via festival program')}</div>
          ${v.calendarUrl ? `<div style="margin-top: 4px;"><a href="${escapeHtml(v.calendarUrl)}" target="_blank" rel="noopener" style="color: #38bdf8; text-decoration: underline;">Open Discovered Webpage / Calendar ↗</a></div>` : ''}
        </div>

        <!-- Prominent Instruction Banner (Displays User Instructions on Discovered Venue Cards) -->
        ${(v.queuedInstruction) ? `
          <div class="curator-handled-box" style="background: rgba(168, 85, 247, 0.12); border: 1.5px solid rgba(168, 85, 247, 0.5); border-left: 5px solid #a855f7; border-radius: 8px; padding: 12px 14px; margin: 10px 0 14px 0;">
            <div class="curator-handled-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
              <strong style="color: #d8b4fe; font-size: 0.88rem; display: inline-flex; align-items: center; gap: 6px;">
                <span>🤖</span> Your AI Scraper Instruction:
              </strong>
              <span class="curator-handled-tag" style="background: rgba(168, 85, 247, 0.25); border: 1px solid rgba(168, 85, 247, 0.5); color: #f3e8ff; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem; font-weight: 600;">
                ${escapeHtml(
                  (v.queuedInstruction.action === 'queue_and_approve' || v.queuedInstruction.actionTaken === 'queue_and_approve')
                    ? '⚡ Enrolled & Training AI'
                    : (v.queuedInstruction.action === 'queue_and_dismiss' || v.queuedInstruction.actionTaken === 'queue_and_dismiss')
                      ? '🛑 Dismissed & Training AI'
                      : '📋 Held for AI Review'
                )}
              </span>
            </div>
            <div class="curator-handled-text" style="color: #ffffff; font-size: 0.95rem; font-weight: 500; line-height: 1.45; background: rgba(0, 0, 0, 0.3); padding: 8px 12px; border-radius: 6px; border-left: 3px solid #c084fc; margin-bottom: 8px;">
              “${escapeHtml(v.queuedInstruction.instructionText || '')}”
            </div>
            ${(v.curatorLearnedRules?.summary || v.queuedInstruction?.distilledRules?.summary || v.queuedInstruction?.aiLearnedSummary || v.policySummary) ? `
              <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 6px; padding: 6px 10px; margin-bottom: 8px; font-size: 0.82rem; color: #a7f3d0; display: flex; align-items: center; gap: 8px;">
                <span>🧠</span>
                <span><strong>AI Learned Policy:</strong> ${escapeHtml(v.curatorLearnedRules?.summary || v.queuedInstruction?.distilledRules?.summary || v.queuedInstruction?.aiLearnedSummary || v.policySummary)}</span>
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
              title="Instruct AI Assistant on how to crawl this venue with notes & screenshots"
            >
              🤖 Instruct AI
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
            <a 
              href="${escapeHtml(v.calendarUrl || v.websiteUrl || '#')}" 
              target="_blank" 
              rel="noopener noreferrer" 
              class="btn-curator btn-curator-ghost"
              title="Inspect venue website in new tab"
            >
              🔗 Inspect Venue Page ↗
            </a>
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

async function handleRestartAllAndClear() {
  const confirmed = confirm(
    "⚠️ RESTART ALL & CLEAR CACHES\n\n" +
    "This will perform a full master reset:\n" +
    "• Unlock any actively running or stuck automation syncs\n" +
    "• Purge all Service Worker and HTTP CacheStorage entries\n" +
    "• Unregister active Service Workers for a clean boot\n" +
    "• Reset transient local browser storage & filters\n" +
    "• Re-synchronize and re-verify the active catalog from disk\n\n" +
    "Are you sure you want to proceed?"
  );

  if (!confirmed) return;

  const btn = document.getElementById('btn-restart-system');
  const icon = document.getElementById('btn-restart-icon');
  const text = document.getElementById('btn-restart-text');

  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.7';
  }
  if (icon) icon.className = 'sync-spinning';
  if (text) text.textContent = 'Restarting & Clearing...';

  try {
    // 1. Tell server daemon to unlock automation, clear lock files, and resync catalog
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) {
      headers['Curator-Token'] = state.token;
    }
    const res = await fetch('/api/curator/system/restart-and-clear', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({})
    });
    
    // 2. Client-side: Purge all CacheStorage caches
    if ('caches' in window) {
      try {
        const cacheKeys = await caches.keys();
        await Promise.all(cacheKeys.map(k => caches.delete(k)));
        console.log('[CURATOR RESET] Cleared CacheStorage:', cacheKeys);
      } catch (err) {
        console.warn('[CURATOR RESET] CacheStorage clear warning:', err);
      }
    }

    // 3. Client-side: Unregister all Service Workers
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map(r => r.unregister()));
        console.log('[CURATOR RESET] Unregistered Service Workers:', registrations.length);
      } catch (err) {
        console.warn('[CURATOR RESET] ServiceWorker unregister warning:', err);
      }
    }

    // 4. Client-side: Clear sessionStorage
    try {
      sessionStorage.clear();
    } catch (_) {}

    // 5. Client-side: Reset transient filter localStorage (preserving curator auth session)
    try {
      const curToken = state.token || localStorage.getItem('van50_curator_token');
      const remember = localStorage.getItem('van50_curator_remember');
      localStorage.clear();
      if (curToken) localStorage.setItem('van50_curator_token', curToken);
      if (remember) localStorage.setItem('van50_curator_remember', remember);
    } catch (_) {}

    showToast('All systems restarted, caches purged, and catalog reloaded!', 'success');

    // 6. Reload page cleanly with cache-buster
    setTimeout(() => {
      window.location.href = window.location.pathname + '?_t=' + Date.now();
    }, 800);

  } catch (err) {
    console.error('[CURATOR RESET ERROR]', err);
    showToast('Reset completed locally; refreshing...', 'info');
    setTimeout(() => {
      window.location.href = window.location.pathname + '?_t=' + Date.now();
    }, 800);
  }
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
      showToast('Failed to load AI instructions', 'error');
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
    container.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--curator-text-muted);">No AI instructions found matching your filter.</div>`;
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

