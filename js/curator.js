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
    instructions: 0
  },
  currentScreenshotBase64: null
};

document.addEventListener('DOMContentLoaded', () => {
  setupCuratorEventListeners();
  checkAuthAndInitialize();
});

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
    const res = await fetch('/api/curator/status', {
      headers: { 'Curator-Token': state.token }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated) {
        if (loginModal) loginModal.classList.remove('active');
        updateHeaderStats(data.pendingCount, data.rulesCount, data.masterCount, data.instructionsPendingCount || 0);
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

  try {
    const res = await fetch('/api/curator/queue', {
      headers: { 'Curator-Token': state.token }
    });
    if (res.ok) {
      const data = await res.json();
      state.quarantinedEvents = data.quarantinedEvents || [];
    } else if (res.status === 401 || res.status === 403) {
      handleLogout();
      return;
    }

    try {
      const archRes = await fetch('/api/curator/archived', {
        headers: { 'Curator-Token': state.token }
      });
      if (archRes.ok) {
        const archData = await archRes.json();
        state.archivedEvents = archData.archivedEvents || [];
      }
    } catch (e) {
      console.warn('Could not fetch archived events:', e);
    }

    updateFilterCounts();
    applyFiltersAndRender();
  } catch (err) {
    showToast('Failed to load quarantine queue', 'error');
  }
}

function updateHeaderStats(pending, rules, master, instructions = 0) {
  state.stats.pending = pending;
  state.stats.rules = rules;
  state.stats.master = master;
  state.stats.instructions = instructions;

  const elP = document.getElementById('stat-pending-count');
  const elR = document.getElementById('stat-rules-count');
  const elM = document.getElementById('stat-master-count');
  const elI = document.getElementById('stat-instructions-count');
  if (elP) elP.textContent = pending;
  if (elR) elR.textContent = rules;
  if (elM) elM.textContent = master;
  if (elI) elI.textContent = instructions;
}

function isDrift(item) {
  const r = (item.quarantineReason || item.flagReason || '').toLowerCase();
  return Boolean(item.isDrift) || r.includes('drift') || r.includes('re-quarantined');
}

function updateFilterCounts() {
  const all = state.quarantinedEvents;
  const unhandled = all.filter(e => !e.dealtWith).length;
  const handled = all.filter(e => Boolean(e.dealtWith)).length;
  const drift = all.filter(e => isDrift(e)).length;
  const overbudget = all.filter(e => isOverBudget(e)).length;
  const unverified = all.filter(e => isUnverifiedCart(e)).length;
  const brokenlink = all.filter(e => isBrokenLink(e)).length;
  const course = all.filter(e => isCourse(e)).length;
  const autobudget = (state.archivedEvents || []).filter(e => e.reviewStatus === 'denied_auto_budget').length;

  const setT = (id, count) => {
    const el = document.getElementById(id);
    if (el) el.textContent = count;
  };
  setT('pill-count-all', all.length);
  setT('pill-count-unhandled', unhandled);
  setT('pill-count-handled', handled);
  setT('pill-count-drift', drift);
  setT('pill-count-overbudget', overbudget);
  setT('pill-count-unverified', unverified);
  setT('pill-count-brokenlink', brokenlink);
  setT('pill-count-course', course);
  setT('pill-count-autobudget', autobudget);

  const statP = document.getElementById('stat-pending-count');
  if (statP) statP.textContent = all.length;
}

// Classification Helpers for Triage Filtering
function isOverBudget(item) {
  const r = (item.flagReason || '').toLowerCase();
  const p = parseFloat(item.attemptedPrice || 0.0);
  return p > 50.0 || r.includes('exceeds') || r.includes('cap') || r.includes('strictly exceeds');
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
  let list = [];

  if (state.activeFilter === 'autobudget') {
    list = [...(state.archivedEvents || []).filter(e => e.reviewStatus === 'denied_auto_budget')];
  } else {
    list = [...state.quarantinedEvents];
    // 1. Tab Filter
    if (state.activeFilter === 'unhandled') {
      list = list.filter(e => !e.dealtWith);
    } else if (state.activeFilter === 'handled') {
      list = list.filter(e => Boolean(e.dealtWith));
    } else if (state.activeFilter === 'drift') {
      list = list.filter(e => isDrift(e));
    } else if (state.activeFilter === 'overbudget') {
      list = list.filter(e => isOverBudget(e));
    } else if (state.activeFilter === 'unverified') {
      list = list.filter(e => isUnverifiedCart(e));
    } else if (state.activeFilter === 'brokenlink') {
      list = list.filter(e => isBrokenLink(e));
    } else if (state.activeFilter === 'course') {
      list = list.filter(e => isCourse(e));
    }
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
    if (state.activeFilter === 'autobudget') {
      statusText.innerHTML = `Showing <strong>${list.length}</strong> auto-denied over-budget events (archived)`;
    } else {
      statusText.innerHTML = `Showing <strong>${list.length}</strong> of ${state.quarantinedEvents.length} quarantined items`;
    }
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

function generateCuratorDiagnostics(ev) {
  const attemptedPrice = parseFloat(ev.attemptedPrice || ev.price || 0.0);
  const isBudgetExceeded = attemptedPrice > 50.0;
  const isAutoDenied = ev.reviewStatus === 'denied_auto_budget';
  const hasDrift = isDrift(ev);
  const reason = ev.quarantineReason || ev.flagReason || ev.archivedReason || 'Live checkout could not be verified automatically';

  const confirmedItems = [];
  confirmedItems.push(`<span>📍 <strong>Venue:</strong> ${escapeHtml(ev.venue || 'Known Venue')}${ev.neighborhood ? ' (' + escapeHtml(ev.neighborhood) + ')' : ''}</span>`);
  
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
  if (hasDrift) {
    issuesItems.push(`<span>⚠️ <strong>Audit Drift:</strong> Detected pricing or schedule changed from previous baseline</span>`);
  }
  if (reason) {
    issuesItems.push(`<span>⚠️ <strong>Quarantine Reason:</strong> ${escapeHtml(reason)}</span>`);
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
          <span>⚠️ Issues / Needs Review</span>
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
    const isOverBudget = state.activeFilter === 'overbudget';
    container.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; background: var(--curator-surface); border: 1px solid var(--curator-border); border-radius: 12px;">
        <div style="font-size: 2.5rem; margin-bottom: 12px;">${isOverBudget ? '🛡️' : '🎉'}</div>
        <h3 style="font-family: var(--font-heading); font-size: 1.25rem; color: #fff; margin-bottom: 6px;">
          ${isOverBudget ? 'Zero Over-Budget Events in Quarantine' : 'No Quarantined Items Found'}
        </h3>
        <p style="font-size: 0.88rem; color: var(--curator-text-muted); max-width: 520px; margin: 0 auto; line-height: 1.5;">
          ${isOverBudget 
            ? 'All events exceeding $50.00 CAD are automatically intercepted, auto-denied, and archived directly into <code>data/archived_events.json</code> with zero curator manual review required. Click the <strong>🛡️ Auto-Denied &gt; $50</strong> tab to inspect archived listings.' 
            : 'All events matching this filter are verified or cleared.'}
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

    return `
      <div class="curator-card ${isHandled ? 'curator-card-handled' : ''}" id="card-${ev.id}">
        <!-- Top Title & Metadata -->
        <div class="curator-card-top">
          <div>
            <h3 class="curator-card-title">${escapeHtml(ev.title)}</h3>
            <div class="curator-card-meta">
              <span>📍 <strong>${escapeHtml(ev.venue)}</strong></span>
              <span>🏘️ ${escapeHtml(ev.neighborhood || 'Vancouver')}</span>
              <span>🎫 Provider: ${escapeHtml(ev.provider || 'Direct')}</span>
              <span>🕒 ${isAutoDenied ? 'Archived' : 'Flagged'}: ${flagDateStr}</span>
            </div>
          </div>
          <div style="display: flex; gap: 6px; align-items: flex-start; flex-wrap: wrap;">
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
        </div>

        <!-- Diagnostics Grid: Confirmed Details vs. Issues / Needs Review -->
        ${diagnosticsHtml}

        <!-- Dealt-With / AI Queued Instruction Box -->
        ${isHandled && ev.queuedInstruction ? `
          <div class="curator-handled-box">
            <div class="curator-handled-header">
              <strong><span>🤖</span> AI Scraper Instruction Queued</strong>
              <span class="curator-handled-tag">${escapeHtml(ev.queuedInstruction.action === 'queue_and_approve' ? '⚡ Queue & Auto-Approve' : '📋 Queue for Training')}</span>
            </div>
            <div class="curator-handled-text">"${escapeHtml(ev.queuedInstruction.instructionText || '')}"</div>
            <div class="curator-handled-meta">
              <span>🕒 Queued ${ev.queuedInstruction.createdAt ? new Date(ev.queuedInstruction.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'recently'}</span>
              ${ev.queuedInstruction.hasScreenshot ? '<span>🖼️ Includes Screenshot</span>' : ''}
              ${ev.queuedInstruction.approvedPrice ? `<span>💰 Proposed: $${Number(ev.queuedInstruction.approvedPrice).toFixed(2)} CAD</span>` : ''}
            </div>
          </div>
        ` : ''}

        <!-- Flag Reason Alert / Drift Alert -->
        ${hasDrift ? `
          <div class="curator-drift-alert-box">
            <span style="font-size: 1.25rem;">⚠️</span>
            <div>
              <strong>Audit Drift Alert:</strong> ${escapeHtml(ev.quarantineReason || ev.flagReason || 'Material price drift detected on live page')}
            </div>
          </div>
        ` : `
          <div class="curator-flag-reason-box" style="${(isBudgetExceeded || isAutoDenied) ? 'background: rgba(239, 68, 68, 0.1); border-color: rgba(239, 68, 68, 0.3); color: #fca5a5;' : ''}">
            <span class="curator-flag-icon">${(isBudgetExceeded || isAutoDenied) ? '🛡️' : '⚠️'}</span>
            <div>
              <strong>${isAutoDenied ? 'Policy Denial Reason:' : 'Quarantine Reason:'}</strong> ${escapeHtml(ev.archivedReason || ev.flagReason || 'Live checkout could not be verified')}
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
                title="Promote this verified event to the live master catalog"
              >
                ✅ Approve & Ingest to Master
              </button>

              <button 
                type="button" 
                class="btn-curator btn-curator-danger" 
                onclick="rejectQuarantinedEvent('${ev.id}')"
                title="Permanently dismiss and archive this event"
              >
                🚫 Dismiss & Archive
              </button>

              <button 
                type="button" 
                class="btn-curator btn-curator-purple" 
                onclick="openAIInstructionModal('${ev.id}')"
                title="${isHandled ? 'Edit queued AI instruction or add screenshots' : 'Instruct AI in plain English and attach screenshots to update scrapers'}"
              >
                ${isHandled ? '✏️ Edit AI Instruction' : '💬 Instruct AI'}
              </button>
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

  const payloadEvent = {
    ...original,
    price: price,
    priceLabel: labelInput ? labelInput.value.trim() : original.attemptedPriceLabel || `$${price.toFixed(2)} all-in`,
    pricingType: price === 0 ? 'free' : 'fixed',
    isFree: price === 0,
    category: categorySelect ? categorySelect.value : original.category || 'shows',
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
      showToast(`Approved '${original.title}'! Added to master catalog.`, 'success');
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

  if (!confirm(`Are you sure you want to dismiss and archive '${original.title}'?`)) {
    return;
  }

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

window.openAIInstructionModal = function(eventId) {
  const ev = (state.quarantinedEvents || []).find(e => e.id === eventId) || (state.archivedEvents || []).find(e => e.id === eventId);
  const modal = document.getElementById('ai-instruction-modal');
  if (!modal) return;

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

    const attPrice = parseFloat(ev.attemptedPrice || ev.price || 0);
    if (priceField) priceField.value = (attPrice <= 50.0 && attPrice > 0) ? attPrice.toFixed(2) : '25.00';
    if (catField) catField.value = ev.category || 'shows';
    if (noteField) {
      if (isDrift(ev)) {
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
    if (q.curatorNote && noteField) noteField.value = q.curatorNote;
    if (q.screenshotBase64) setScreenshotPreview(q.screenshotBase64);
  } else if (textField) {
    textField.value = '';
    if (ev && isDrift(ev)) {
      textField.placeholder = `Explain the live drift, e.g.: 'The page now shows a price change. The scraper should look for the lowest general admission tier at...'`;
    } else {
      textField.placeholder = "e.g.: 'The scraper picked up the $65 VIP tier instead of the $25 General Admission ticket shown at the bottom of the page. Please target the GA price for this venue.'";
    }
  }

  modal.classList.add('active');
  setTimeout(() => {
    if (textField) textField.focus();
  }, 100);
};

function clearScreenshotPreview() {
  state.currentScreenshotBase64 = null;
  const prompt = document.getElementById('ai-dropzone-prompt');
  const container = document.getElementById('ai-screenshot-preview-container');
  const img = document.getElementById('ai-screenshot-preview-img');
  const fileInput = document.getElementById('ai-screenshot-file-input');
  if (prompt) prompt.style.display = 'block';
  if (container) container.style.display = 'none';
  if (img) img.src = '';
  if (fileInput) fileInput.value = '';
}

function setScreenshotPreview(dataUrl) {
  state.currentScreenshotBase64 = dataUrl;
  const prompt = document.getElementById('ai-dropzone-prompt');
  const container = document.getElementById('ai-screenshot-preview-container');
  const img = document.getElementById('ai-screenshot-preview-img');
  if (prompt) prompt.style.display = 'none';
  if (container) container.style.display = 'block';
  if (img) img.src = dataUrl;
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

  const approvedPrice = parseFloat(document.getElementById('ai-approve-price')?.value || 0);
  const approvedCategory = document.getElementById('ai-approve-category')?.value || 'shows';
  const curatorNote = document.getElementById('ai-approve-note')?.value || instructionText;

  if (action === 'queue_and_approve' && (isNaN(approvedPrice) || approvedPrice < 0 || approvedPrice > 50.0)) {
    showToast('Price must be a valid number between $0.00 and $50.00 CAD to approve!', 'error');
    return;
  }

  const payload = {
    instructionText: instructionText,
    eventId: eventId,
    eventTitle: eventTitle,
    venueName: venueName,
    sourceUrl: sourceUrl,
    screenshotBase64: state.currentScreenshotBase64,
    action: action,
    approvedPrice: approvedPrice,
    approvedCategory: approvedCategory,
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
      showToast(data.message || 'Queued for AI Assistant!', 'success');
      const modal = document.getElementById('ai-instruction-modal');
      if (modal) modal.classList.remove('active');

      // Update in-memory quarantined event immediately so UI shows handled state
      const targetItem = state.quarantinedEvents.find(e => e.id === eventId);
      if (targetItem) {
        targetItem.dealtWith = true;
        targetItem.queuedInstruction = {
          instructionText: instructionText,
          eventId: eventId,
          eventTitle: eventTitle,
          venueName: venueName,
          sourceUrl: sourceUrl,
          screenshotBase64: state.currentScreenshotBase64,
          hasScreenshot: Boolean(state.currentScreenshotBase64),
          action: action,
          approvedPrice: approvedPrice,
          approvedCategory: approvedCategory,
          curatorNote: curatorNote,
          createdAt: new Date().toISOString()
        };
      }

      if (action === 'queue_and_approve') {
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
  };

  if (cancelAiBtn) cancelAiBtn.addEventListener('click', closeAiModal);
  if (btnCloseAiModal) btnCloseAiModal.addEventListener('click', closeAiModal);
  if (aiModal) {
    aiModal.addEventListener('click', (e) => {
      if (e.target === aiModal) closeAiModal();
    });
  }

  const btnSubmitOnly = document.getElementById('btn-submit-ai-inst-only');
  if (btnSubmitOnly) {
    btnSubmitOnly.addEventListener('click', () => submitAIInstruction('queue_only'));
  }

  const btnSubmitAndApprove = document.getElementById('btn-submit-ai-inst-and-approve');
  if (btnSubmitAndApprove) {
    btnSubmitAndApprove.addEventListener('click', () => submitAIInstruction('queue_and_approve'));
  }

  // Screenshot Dropzone & File Input
  const dropzone = document.getElementById('ai-screenshot-dropzone');
  const fileInput = document.getElementById('ai-screenshot-file-input');
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', (e) => {
      if (e.target.id === 'btn-remove-screenshot') return;
      fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          setScreenshotPreview(evt.target.result);
          showToast('🖼️ Screenshot image selected!', 'info');
        };
        reader.readAsDataURL(file);
      }
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (evt) => {
          setScreenshotPreview(evt.target.result);
          showToast('🖼️ Screenshot dropped!', 'info');
        };
        reader.readAsDataURL(file);
      }
    });
  }

  const removeScreenshotBtn = document.getElementById('btn-remove-screenshot');
  if (removeScreenshotBtn) {
    removeScreenshotBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clearScreenshotPreview();
      showToast('Screenshot removed', 'info');
    });
  }

  // Global Clipboard Paste Listener for Screenshots (Ctrl+V)
  window.addEventListener('paste', (e) => {
    const modal = document.getElementById('ai-instruction-modal');
    if (!modal || !modal.classList.contains('active')) return;

    const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const blob = items[i].getAsFile();
        if (blob) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            setScreenshotPreview(evt.target.result);
            showToast('📋 Screenshot pasted from clipboard!', 'info');
          };
          reader.readAsDataURL(blob);
          e.preventDefault();
          break;
        }
      }
    }
  });
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
