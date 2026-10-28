// Shared dashboard presentation. Data fetching and mutations stay in app.js.
(() => {
  if (window.Capacitor?.isNativePlatform?.() && !window.TripCashNativeRedesign) return;
  const list = document.getElementById('trips-list');
  if (!list) return;
  const summaries = new Map();
  let rendered = 0;
  let state = 'loading';
  let refreshing = 0;
  let lastKey = '';
  let selectedTripFilter = 'active';
  const keyFor = id => `${window._currentUser?.id || ''}:${id}`;
  const fingerprint = cache =>
    JSON.stringify([cache?.trip?.currency, cache?.members, cache?.expenses, cache?.splits, cache?.payments]);
  const detailsFor = trip => {
    const cache = tripViewCache.get(trip.id) || restoreTripViewCache(trip.id);
    return cache?.trip?.id === trip.id &&
      ['members', 'expenses', 'splits', 'payments'].every(field => Array.isArray(cache[field]))
      ? cache
      : null;
  };

  function savedSummary(trip, cache) {
    const summary = summaries.get(keyFor(trip.id));
    if (!summary || !cache || summary.fingerprint !== fingerprint(cache)) return null;
    // Aggregate refreshes can reveal stale detail without fetching more records.
    if (Number.isFinite(trip._total) && Math.abs(trip._total - summary.total) > 0.005) return null;
    if (Number.isFinite(trip._expenseCount) && trip._expenseCount !== cache.expenses.length) return null;
    return summary;
  }

  function captureBalance() {
    if (!currentTrip || !window._currentUser || !tripViewCache.has(currentTrip.id)) return;
    const cache = tripViewCache.get(currentTrip.id);
    const mine = currentMembers.filter(member => member.user_id === window._currentUser.id);
    if (
      !mine.length ||
      currentExpenses.some(expense => !currentSplits.some(split => split.expense_id === expense.id))
    ) {
      summaries.delete(keyFor(currentTrip.id));
      return;
    }
    const actual = calcBalances();
    summaries.set(keyFor(currentTrip.id), {
      fingerprint: fingerprint(cache),
      total: currentExpenses.reduce((sum, expense) => sum + convertedExpenseAmount(expense), 0),
      balance: mine.reduce((sum, member) => sum + (actual.balances[member.id] || 0), 0),
      suggestions: actual.suggestions.filter(item =>
        mine.some(member => member.id === item.from || member.id === item.to),
      ),
    });
  }
  for (const name of ['renderDashboard', 'syncCurrentTripCache']) {
    const original = window[name];
    window[name] = function (...args) {
      const result = original(...args);
      captureBalance();
      return result;
    };
  }

  function pendingFor(trip, cache, queue) {
    return queue.filter(mutation =>
      (Array.isArray(mutation?.steps) ? mutation.steps : []).some(step => {
        if (!step) return false;
        if (step.values?.trip_id === trip.id || step.args?.p_expense?.trip_id === trip.id) return true;
        if (step.table === 'trips' && (step.values?.id === trip.id || step.match?.id === trip.id)) return true;
        const rows = { members: cache?.members, expenses: cache?.expenses, payments: cache?.payments };
        return rows[step.table]?.some(row => row.id === step.match?.id) || false;
      }),
    ).length;
  }

  function moneyMarkup(amount, currency) {
    // Preserve the existing currency formatter; give long ISO prefixes less visual weight.
    return esc(formatMoney(amount, currency)).replace(/^([A-Z]{3}) /, '<span class="web-currency-label">$1</span> ');
  }
  function signedMoney(balance, currency) {
    return `${balance > 0.005 ? '+' : balance < -0.005 ? '−' : ''}${moneyMarkup(Math.abs(balance) < 0.005 ? 0 : Math.abs(balance), currency)}`;
  }
  function balanceClass(balance) {
    return balance > 0.005 ? 'is-positive' : balance < -0.005 ? 'is-negative' : '';
  }
  function balanceText(balance) {
    return balance > 0.005 ? 'you’re owed' : balance < -0.005 ? 'you owe' : 'all square';
  }
  function statusFor(trip) {
    if (trip.status === 'ended') return '<span class="web-trip-tag is-neutral">Ended</span>';
    // Calendar dates are local dates, not UTC instants.
    const start = /^\d{4}-\d{2}-\d{2}$/.test(trip.start_date || '') ? new Date(`${trip.start_date}T00:00:00`) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = start ? Math.round((start - today) / 86400000) : 0;
    return days > 0
      ? `<span class="web-trip-tag is-neutral">In ${days} day${days === 1 ? '' : 's'}</span>`
      : `<span class="web-trip-tag">Day ${esc(trip.current_day || 1)}</span>`;
  }
  function tripFilterFor(trip) {
    if (trip.status === 'ended') return 'ended';
    const start = /^\d{4}-\d{2}-\d{2}$/.test(trip.start_date || '') ? new Date(`${trip.start_date}T00:00:00`) : null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return start && start > today ? 'upcoming' : 'active';
  }
  function initials(name) {
    return String(name || '?')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(word => word[0] || '')
      .join('')
      .toUpperCase();
  }
  function pendingPill(count) {
    return count
      ? `<span class="web-pending-pill"><span></span>${count} change${count === 1 ? '' : 's'} waiting</span>`
      : '';
  }

  function tripCard(trip, queue) {
    const cache = detailsFor(trip);
    const summary = savedSummary(trip, cache);
    const totalKnown = Number.isFinite(trip._total);
    const budget = Number(trip.budget);
    const hasBudget = Number.isFinite(budget) && budget > 0;
    const pct = totalKnown && hasBudget ? Math.max(0, Math.min(100, (trip._total / budget) * 100)) : 0;
    const budgetNote = !hasBudget
      ? 'No budget'
      : !totalKnown
        ? `Budget ${esc(formatMoney(budget, trip.currency))}`
        : trip._total <= budget
          ? `of ${esc(formatMoney(budget, trip.currency))} · ${esc(formatMoney(budget - trip._total, trip.currency))} left`
          : `${esc(formatMoney(trip._total - budget, trip.currency))} over budget`;
    const latest = cache?.expenses
      ?.slice()
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0];
    const lastExpense = latest
      ? `Last saved: ${esc(latest.title)}`
      : trip._expenseCount === 0
        ? 'No expenses yet'
        : 'Open for latest expenses';
    const avatars =
      cache?.members
        ?.slice(0, 4)
        .map(
          member => `<span class="web-member-avatar" title="${esc(member.name)}">${esc(initials(member.name))}</span>`,
        )
        .join('') || '';
    const pending = pendingFor(trip, cache, queue);
    const memberCount = Number.isFinite(trip._members)
      ? `${trip._members} member${trip._members === 1 ? '' : 's'}`
      : 'Members updating';
    return `<div class="trip-card web-trip-card" data-action="open-trip" data-id="${esc(trip.id)}" role="button" tabindex="0">
      <div class="mobile-trip-row"><span class="mobile-trip-emoji" aria-hidden="true">${esc(trip.emoji || '✈️')}</span><span class="mobile-trip-copy"><strong>${esc(displayTripName(trip.name))}</strong><span>${esc(formatTripDateRange(trip) || 'Dates not set')} · ${memberCount}</span><span class="mobile-trip-status">${statusFor(trip)}${pendingPill(pending)}</span></span><span class="mobile-trip-amount"><strong>${totalKnown ? moneyMarkup(trip._total, trip.currency) : 'Updating…'}</strong><span>${summary ? `${signedMoney(summary.balance, trip.currency)} ${balanceText(summary.balance)}` : hasBudget ? budgetNote : 'Total spent'}</span></span><span class="mobile-trip-chevron" aria-hidden="true">›</span></div>
      <div class="web-trip-heading"><span class="native-trip-emoji" aria-hidden="true">${esc(trip.emoji || '✈️')}</span><div><h3>${esc(displayTripName(trip.name))}</h3><p>${esc(formatTripDateRange(trip) || 'Dates not set')} · ${memberCount}</p></div>${statusFor(trip)}</div>
      <div class="web-trip-metrics"><div><span class="web-metric-label">Spent</span><strong>${totalKnown ? moneyMarkup(trip._total, trip.currency) : '<span class="web-value-placeholder">Updating…</span>'}</strong>
        ${hasBudget ? `<progress class="web-budget-track" max="100" value="${pct}" aria-hidden="true"></progress>` : '<div class="web-budget-spacer"></div>'}<span class="web-metric-note">${budgetNote}</span></div>
        <div><span class="web-metric-label">${summary ? 'Saved balance' : 'Your balance'}</span><strong class="${summary ? balanceClass(summary.balance) : 'web-value-placeholder'}">${summary ? signedMoney(summary.balance, trip.currency) : '—'}</strong><div class="web-budget-spacer"></div><span class="web-metric-note">${summary ? balanceText(summary.balance) : 'Open to see balance'}</span></div></div>
      <div class="web-trip-footer">${avatars ? `<span class="web-avatar-stack" aria-label="Saved members">${avatars}</span>` : ''}<span class="web-last-expense">${lastExpense}</span>${pendingPill(pending)}</div>
    </div>`;
  }

  function endedRow(trip, queue) {
    const cache = detailsFor(trip);
    const summary = savedSummary(trip, cache);
    const pending = pendingFor(trip, cache, queue);
    return `<div class="trip-card web-ended-row" role="button" tabindex="0" data-action="open-trip" data-id="${esc(trip.id)}"><div class="mobile-trip-row"><span class="mobile-trip-emoji" aria-hidden="true">${esc(trip.emoji || '✈️')}</span><span class="mobile-trip-copy"><strong>${esc(displayTripName(trip.name))}</strong><span>${esc(formatTripDateRange(trip) || 'Dates not set')}</span><span class="mobile-trip-status"><span class="native-closed-stamp">✓ Trip closed</span>${pendingPill(pending)}</span></span><span class="mobile-trip-amount"><strong>${Number.isFinite(trip._total) ? moneyMarkup(trip._total, trip.currency) : 'Updating…'}</strong><span>${summary ? (Math.abs(summary.balance) < 0.005 ? 'All settled' : `${signedMoney(summary.balance, trip.currency)} ${balanceText(summary.balance)}`) : 'Total spent'}</span></span><span class="mobile-trip-chevron" aria-hidden="true">›</span></div><span class="native-trip-emoji" aria-hidden="true">${esc(trip.emoji || '✈️')}</span><div><h3>${esc(displayTripName(trip.name))}</h3><p>${esc(formatTripDateRange(trip) || 'Dates not set')} · ${Number.isFinite(trip._total) ? esc(formatMoney(trip._total, trip.currency)) + ' total' : 'Total updating'}</p></div><span class="native-closed-stamp">✓ Trip closed</span><span class="web-trip-tag ${summary ? balanceClass(summary.balance) : 'is-neutral'}">${summary ? (Math.abs(summary.balance) < 0.005 ? 'All settled' : signedMoney(summary.balance, trip.currency)) : 'Ended'}</span>${pendingPill(pending)}</div>`;
  }

  function render(trips = loadedTrips, nextState = state) {
    state = nextState;
    const queue = readOfflineQueue(window._currentUser?.id);
    const cacheKey = JSON.stringify([
      window._currentUser?.id,
      state,
      navigator.onLine,
      refreshing,
      trips,
      queue,
      trips.map(trip => [fingerprint(detailsFor(trip)), summaries.get(keyFor(trip.id))]),
    ]);
    if (cacheKey === lastKey && list.dataset.webDashboard) return;
    lastKey = cacheKey;
    list.dataset.webDashboard = state;
    let html = '';
    if (state === 'loading' && !trips.length) {
      html = `<div class="web-loading" role="status"><div class="trip-cards-grid web-trips-grid">${[1, 2].map(() => '<div class="web-skeleton-card" aria-hidden="true"><span></span><span></span><div></div></div>').join('')}</div><p>Loading your trips…</p></div>`;
    } else if (!trips.length) {
      const offline = navigator.onLine === false;
      const error = state === 'error';
      html = `<div class="web-empty-state"><span class="web-empty-mark web-brand-mark" aria-hidden="true"></span><h2>${error ? 'Your trips couldn’t load' : offline ? 'No trips saved on this device' : 'Where are you headed?'}</h2><p>${error ? 'Please check your connection and try again. Your existing trips have not been removed.' : offline ? 'Previously opened trips are available offline. You can also create a trip here; it will sync when you reconnect.' : 'Create a trip, add the people you’re travelling with, and TripCash keeps track of who paid and who owes what.'}</p><div>${error ? '<button class="btn btn-primary btn-auto" data-action="go-to-trips">Try again</button>' : '<button class="btn btn-primary btn-auto" data-action="open-new-trip-modal">Create a trip</button><button class="btn btn-secondary btn-auto" data-action="open-modal" data-value="modal-web-join">Join with invite link</button>'}</div></div>`;
    } else {
      const grouped = { active: [], upcoming: [], ended: [] };
      trips.forEach(trip => grouped[tripFilterFor(trip)].push(trip));
      const labels = { active: 'Active', upcoming: 'Upcoming', ended: 'Ended' };
      const empty = { active: 'No active trips right now.', upcoming: 'No upcoming trips.', ended: 'No ended trips.' };
      const selected = grouped[selectedTripFilter];
      const tabs = Object.keys(grouped)
        .map(
          filter =>
            `<button class="web-trip-tab" type="button" role="tab" data-trip-filter="${filter}" aria-selected="${filter === selectedTripFilter}" aria-controls="trips-list-panel">${labels[filter]} <span>${grouped[filter].length}</span></button>`,
        )
        .join('');
      const rows =
        selectedTripFilter === 'ended'
          ? `<div class="web-ended-list">${selected.map(trip => endedRow(trip, queue)).join('')}</div>`
          : `<div class="trip-cards-grid web-trips-grid">${selected.map(trip => tripCard(trip, queue)).join('')}</div>`;
      html = `<div class="web-trip-tabs" role="tablist" aria-label="Trip status">${tabs}</div><section id="trips-list-panel" class="web-dashboard-section${selectedTripFilter === 'ended' ? ' web-ended' : ''}" role="tabpanel">${selected.length ? rows : `<div class="web-no-active">${empty[selectedTripFilter]}</div>`}</section>`;
    }
    list.innerHTML = html;
  }

  const heading = document.createElement('div');
  heading.className = 'web-dashboard-heading';
  heading.innerHTML =
    '<div><p id="web-dashboard-date"></p><h1 id="web-dashboard-title"></h1></div><button class="btn btn-secondary btn-auto" data-action="open-modal" data-value="modal-web-join">Join with invite link</button>';
  document.getElementById('trips-greeting').before(heading);
  const banner = document.createElement('div');
  banner.className = 'web-dashboard-banner';
  banner.hidden = true;
  banner.innerHTML =
    '<span id="web-dashboard-notice" role="status"></span><button class="btn btn-auto" data-action="go-to-trips">Try again</button>';
  heading.before(banner);

  const originalList = renderTripsList;
  window.renderTripsList = function (trips) {
    if (!window._currentUser) return originalList(trips);
    rendered += 1;
    lastKey = '';
    render(trips, 'ready');
  };
  const originalRefresh = refreshTrips;
  window.refreshTrips = async function (...args) {
    const before = rendered;
    refreshing += 1;
    try {
      return await originalRefresh(...args);
    } finally {
      refreshing -= 1;
      if (window._currentUser && before === rendered && navigator.onLine !== false && !pendingOfflineChangeCount())
        render(loadedTrips, 'error');
      update();
    }
  };
  const originalLoad = loadTrips;
  window.loadTrips = async function (...args) {
    if (!loadedTrips.length) render([], 'loading');
    try {
      return await originalLoad(...args);
    } finally {
      if (window._currentUser && !loadedTrips.length && state === 'loading' && !refreshing)
        render([], navigator.onLine === false ? 'ready' : 'error');
      update();
    }
  };

  function update() {
    if (!window._currentUser) {
      summaries.clear();
      lastKey = '';
      return;
    }
    const now = new Date();
    const name = window._currentProfile?.display_name || window._currentUser.email?.split('@')[0] || 'traveller';
    const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening';
    document.getElementById('web-dashboard-date').textContent = now.toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
    document.getElementById('web-dashboard-title').textContent = `${greeting}, ${name.trim().split(/\s+/)[0]}`;
    const offline = navigator.onLine === false;
    const showNotice = offline || state === 'error';
    if (banner.hidden !== !showNotice) banner.hidden = !showNotice;
    document.getElementById('web-dashboard-notice').textContent = offline
      ? 'You’re offline. You’re seeing trips saved on this device — anything you change will sync automatically when you reconnect.'
      : 'Couldn’t refresh your trips. Showing saved data; check your connection and try again.';
    if (!list.dataset.webDashboard || list.textContent.trim() === 'Loading…') {
      lastKey = '';
      render(loadedTrips, 'loading');
    } else if (document.body.dataset.screen === 'trips') render();
  }
  const observer = new MutationObserver(update);
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });
  observer.observe(list, { childList: true });
  for (const id of ['offline-sync-status', 'header-user-label'])
    observer.observe(document.getElementById(id), {
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'class'],
    });
  window.addEventListener('online', update);
  window.addEventListener('offline', () => {
    if (!loadedTrips.length) render([], 'ready');
    update();
  });
  list.addEventListener('click', event => {
    const tab = event.target.closest('[data-trip-filter]');
    if (!tab || !list.contains(tab)) return;
    selectedTripFilter = tab.dataset.tripFilter;
    lastKey = '';
    render();
    list.querySelector(`[data-trip-filter="${selectedTripFilter}"]`)?.focus();
  });

  document.getElementById('form-web-join').addEventListener('submit', event => {
    event.preventDefault();
    const input = document.getElementById('web-invite-link');
    const error = document.getElementById('web-invite-error');
    let url;
    try {
      url = new URL(input.value.trim());
    } catch (_) {}
    const token = url?.searchParams.get('invite');
    if (
      !url ||
      url.protocol !== 'https:' ||
      !['tripcash.de', 'www.tripcash.de'].includes(url.hostname) ||
      !['/', '/app', '/app/', '/app.html'].includes(url.pathname) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token || '')
    ) {
      error.textContent = 'Paste a complete TripCash invite link.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    if (navigator.onLine === false) {
      error.textContent = 'Connect to the internet before joining a trip.';
      return;
    }
    error.textContent = '';
    input.removeAttribute('aria-invalid');
    closeModal('modal-web-join');
    void handleInvite(token);
  });
  // Accessibility belongs to this new web-only dialog, not the unchanged native modals.
  const joinModal = document.getElementById('modal-web-join');
  let joinOpen = false;
  let joinOpener;
  new MutationObserver(() => {
    const open = joinModal.classList.contains('open');
    if (open === joinOpen) return;
    joinOpen = open;
    if (open) {
      joinOpener = document.activeElement;
      document.getElementById('web-invite-link').focus();
    } else if (joinOpener?.isConnected) joinOpener.focus();
  }).observe(joinModal, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener(
    'keydown',
    event => {
      if (!joinModal.classList.contains('open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeModal('modal-web-join');
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...joinModal.querySelectorAll('button:not(:disabled), input:not(:disabled)')];
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    true,
  );
  update();
})();
