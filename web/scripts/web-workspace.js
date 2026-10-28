// Shared trip workspace. Existing data, mutation, and native shell flows stay in app.js.
(() => {
  if (window.Capacitor?.isNativePlatform?.() && !window.TripCashNativeRedesign) return;
  const dashboard = document.getElementById('screen-dashboard');
  const overview = document.getElementById('tab-overview');
  const expenses = document.getElementById('tab-expenses');
  const top = dashboard?.querySelector('.dash-top');
  if (!top || !overview || !expenses) return;

  const originalOverview = renderOverviewTab;
  const originalExpenses = renderExpensesTab;
  const originalSwitch = switchTab;
  const originalAnalytics = renderAnalyticsTab;
  const originalAddExpense = openAddExpenseModal;
  let composing = false;
  let settingsKey = '';
  let lastTripId;
  let selectedDay = null;
  let insightsOpen = false;
  let lastCurrentDay = null;
  let expandedPhoneDay = null;
  const back = top.querySelector('[data-action="go-to-trips"]');
  const name = document.getElementById('dash-trip-name');
  const day = document.getElementById('dash-day-badge');
  const structure = document.createElement('div');
  structure.className = 'web-trip-header';
  structure.innerHTML = `<div class="web-trip-header-primary"><div class="web-trip-breadcrumb"></div>
      <div class="web-trip-heading-group"><div class="web-trip-title-row"><h1></h1></div><div class="web-trip-day-subtitle"></div></div>
      <div class="web-trip-header-right"><div class="web-trip-meta"><span id="web-trip-currency"></span><span id="web-trip-members"></span></div>
        <details id="web-trip-overflow" class="web-disclosure web-trip-overflow"><summary aria-label="Trip actions" title="Trip actions">•••</summary><div class="web-dropdown"></div></details>
      </div>
    </div>`;
  structure.querySelector('.web-trip-breadcrumb').append(back);
  structure.querySelector('h1').append(name);
  structure.querySelector('.web-trip-day-subtitle').append(day);
  top.replaceChildren(structure);
  overview.hidden = true;
  const overviewButton = document.querySelector('#trip-bottom-nav [data-value="overview"]');
  if (overviewButton) overviewButton.hidden = true;
  const phoneTripView = () => window.matchMedia('(max-width: 760px)').matches;
  const headerRight = structure.querySelector('.web-trip-header-right');
  const tripMeta = structure.querySelector('.web-trip-meta');
  function restoreHeaderControls() {
    if (tripMeta.parentElement !== headerRight) headerRight.prepend(tripMeta);
  }
  const nav = document.getElementById('trip-bottom-nav');
  nav.setAttribute('role', 'tablist');
  nav.querySelectorAll('[data-tab]').forEach(button => {
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `tab-${button.dataset.tab}`);
  });
  for (const tab of ['expenses', 'analytics', 'members', 'activity']) {
    document.getElementById(`tab-${tab}`).setAttribute('role', 'tabpanel');
  }

  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }
  function updateHeader() {
    const trip = currentTrip;
    if (!trip || !window._currentUser) return;
    if (lastTripId !== trip.id) {
      structure.querySelectorAll('details[open]').forEach(disclosure => {
        disclosure.open = false;
      });
      lastTripId = trip.id;
      selectedDay = Math.max(1, Number(trip.current_day) || 1);
      expandedPhoneDay = selectedDay;
      insightsOpen = false;
      lastCurrentDay = Number(trip.current_day) || 1;
    } else if (lastCurrentDay !== Number(trip.current_day)) {
      if (selectedDay === lastCurrentDay) selectedDay = Number(trip.current_day);
      if (expandedPhoneDay === lastCurrentDay) expandedPhoneDay = Number(trip.current_day);
      lastCurrentDay = Number(trip.current_day);
    }
    setText(name, displayTripName(trip.name));
    setText(day, trip.status === 'ended' ? 'Ended' : `Day ${trip.current_day}`);
    day.classList.toggle('web-trip-ended', trip.status === 'ended');
    const people = currentMembers.map(member =>
      member.user_id === window._currentUser.id ? `${member.name} (you)` : member.name,
    );
    const memberHost = document.getElementById('web-trip-members');
    const avatarMarkup = currentMembers
      .slice(0, 4)
      .map(
        member =>
          `<span class="web-member-avatar" aria-hidden="true">${esc(
            String(member.name || '?')
              .trim()
              .split(/\s+/)
              .slice(0, 2)
              .map(word => word[0] || '')
              .join('')
              .toUpperCase(),
          )}</span>`,
      )
      .join('');
    memberHost.innerHTML = `${avatarMarkup ? `<span class="web-avatar-stack">${avatarMarkup}</span>` : ''}<span>${people.length ? esc(people.join(', ')) : 'No members yet'}</span>`;

    // The header owns the only trip display-currency control, including Analytics.
    const control = overview.querySelector('.currency-control');
    const currencyHost = document.getElementById('web-trip-currency');
    const existingSelect = currencyHost.querySelector('#display-currency');
    if (control) {
      if (existingSelect?.value === getDisplayCurrency()) control.remove();
      else currencyHost.replaceChildren(control);
    }
    dashboard.querySelectorAll('#tab-analytics .currency-control').forEach(element => element.remove());

    const overflow = document.getElementById('web-trip-overflow');
    const actionCard = overview.querySelector('.trip-action-buttons')?.closest('.card');
    const creator = trip.creator_id === window._currentUser.id;
    const nextSettingsKey = `${window._currentUser.id}:${trip.id}:${creator}:${trip.status}:${currentInviteToken || ''}`;
    if (settingsKey !== nextSettingsKey) {
      settingsKey = nextSettingsKey;
      overflow.open = false;
      const actions = [...(actionCard?.querySelectorAll('button') || [])].filter(
        button => button.dataset.action !== 'export-csv',
      );
      for (const button of actions) {
        if (button.dataset.action === 'open-end-trip-modal') button.classList.remove('btn-danger');
      }
      const menu = overflow.querySelector('.web-dropdown');
      const extra = document.createElement('div');
      extra.className = 'web-overflow-shortcuts';
      extra.innerHTML = `<button data-action="switch-tab" data-value="expenses">Expenses</button><button data-action="switch-tab" data-value="analytics">Analytics</button><button data-action="switch-tab" data-value="activity">Activity log</button>${creator && trip.status !== 'ended' && currentInviteToken ? `<button data-action="copy-invite" data-value="${esc(`${PUBLIC_APP_URL}?invite=${encodeURIComponent(currentInviteToken)}`)}">Copy invite link</button><button data-action="rotate-invite">Replace invite link</button>` : ''}<button data-action="export-csv">Export CSV</button>`;
      menu.replaceChildren(extra, ...actions);
    }
    actionCard?.remove();
    overview.querySelectorAll('[data-action="export-csv"]').forEach(button => button.remove());
    overview.querySelectorAll('.ended-actions').forEach(element => element.remove());
    overview.querySelector('.share-row')?.closest('.card')?.remove();
  }

  function updateSelectedTab() {
    nav.querySelectorAll('[data-tab]').forEach(button => {
      const selected = button.dataset.tab === currentTab;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  }

  const money = amount => esc(formatMoney(displayAmount(amount), getDisplayCurrency()));
  const tripMoney = amount => esc(formatMoney(amount, currentTrip.currency));
  const dayCount = () => Math.max(1, Number(currentTrip.current_day) || 1);
  const actualBalances = () =>
    currentExpenses.some(item => !currentSplits.some(split => split.expense_id === item.id)) ? null : calcBalances();
  function pendingCount() {
    return readOfflineQueue(window._currentUser?.id).filter(mutation =>
      (mutation.steps || []).some(
        step =>
          step?.values?.trip_id === currentTrip.id ||
          step?.args?.p_expense?.trip_id === currentTrip.id ||
          (step?.table === 'trips' && (step.values?.id === currentTrip.id || step.match?.id === currentTrip.id)) ||
          { members: currentMembers, expenses: currentExpenses, payments: currentPayments }[step?.table]?.some(
            row => row.id === step.match?.id,
          ),
      ),
    ).length;
  }
  function summaryCards() {
    const total = currentExpenses.reduce((sum, item) => sum + convertedExpenseAmount(item), 0);
    const budget = Number(currentTrip.budget) || 0;
    const remaining = budget - total;
    const percent = budget > 0 ? Math.min(100, Math.max(0, (total / budget) * 100)) : 0;
    const mine = currentMembers.filter(member => member.user_id === window._currentUser?.id);
    const balanceData = actualBalances();
    const net = mine.reduce((sum, member) => sum + (balanceData?.balances[member.id] || 0), 0);
    const mineIds = new Set(mine.map(member => member.id));
    const mySuggestions = (balanceData?.suggestions || []).filter(
      item => mineIds.has(item.from) || mineIds.has(item.to),
    );
    const payable = mySuggestions.find(
      item =>
        currentTrip.status !== 'ended' &&
        !currentSettled.includes(dayCount()) &&
        (currentTrip.creator_id === window._currentUser?.id || mineIds.has(item.from)),
    );
    const counterparty =
      mySuggestions[0] &&
      currentMembers.find(
        member => member.id === (mineIds.has(mySuggestions[0].from) ? mySuggestions[0].to : mySuggestions[0].from),
      );
    const payableFrom = payable && currentMembers.find(member => member.id === payable.from);
    const payableTo = payable && currentMembers.find(member => member.id === payable.to);
    const payableLabel =
      payable && payableFrom && payableTo
        ? mineIds.has(payable.from)
          ? `You owe ${esc(payableTo.name)}`
          : `${esc(payableFrom.name)} owes you`
        : '';
    const waiting = pendingCount();
    const balanceLabel =
      !mine.length || !balanceData
        ? 'Balance unavailable'
        : net > 0.005
          ? 'You are owed'
          : net < -0.005
            ? 'You owe'
            : 'All square';
    const balanceValue =
      !mine.length || !balanceData ? '—' : `${net > 0.005 ? '+' : net < -0.005 ? '−' : ''}${money(Math.abs(net))}`;
    return `<div class="web-workspace-cards"><section class="web-workspace-card web-spend-card"><div class="web-workspace-card-head"><span class="web-metric-label">Trip spend</span>${budget > 0 ? `<span>${money(budget)} budget</span>` : ''}</div><strong data-web-total>${money(total)}</strong>
      <p>${currentExpenses.length} expense${currentExpenses.length === 1 ? '' : 's'} · ${money(total / dayCount())} per day so far</p>
      ${
        budget > 0
          ? `<progress class="web-budget-track" max="100" value="${percent}" aria-label="Budget used">${Math.round(percent)}%</progress>
        <p>${Math.round((total / budget) * 100)}% of budget · ${remaining >= 0 ? `${money(remaining)} left` : `${money(-remaining)} over budget`}</p>`
          : '<p>No budget set</p>'
      }</section>
      <section class="web-workspace-card web-balance-card"><div class="web-workspace-card-head"><span class="web-metric-label">Your balance</span>${waiting ? `<span class="web-pending-pill"><span></span>incl. ${waiting} pending</span>` : `<span>${mySuggestions.length} open payment${mySuggestions.length === 1 ? '' : 's'}</span>`}</div>
      <strong class="${net > 0.005 ? 'is-positive' : net < -0.005 ? 'is-negative' : ''}" data-web-balance>${balanceValue}</strong><p>${balanceLabel}${counterparty ? ` · ${net >= 0 ? `${esc(counterparty.name)} owes you` : `you owe ${esc(counterparty.name)}`}` : ''}</p>
      ${payable ? `<div class="web-overview-suggestion"><span>${payableLabel}</span><b>${tripMoney(payable.amount)}</b><button class="btn btn-secondary btn-sm btn-auto" data-web-payment="${esc(payable.from)}:${esc(payable.to)}">Record payment</button></div>` : '<button class="btn btn-secondary btn-sm btn-auto" data-action="switch-tab" data-value="members">View members &amp; payments</button>'}</section></div>`;
  }
  function balancePanel() {
    const data = actualBalances();
    const creator = currentTrip.creator_id === window._currentUser?.id;
    const active = currentTrip.status !== 'ended';
    const chosen = selectedDay === 'whole' ? null : Number(selectedDay);
    const selectedExpenses = currentExpenses.filter(item => Number(item.day_number) === chosen);
    const canAdvance = creator && active && chosen === dayCount() && !currentSettled.includes(chosen);
    const skipEmptyDay = canAdvance && selectedExpenses.length === 0;
    const rows = !data
      ? '<p>Balances are updating. Open Members to review the split.</p>'
      : currentMembers
          .map(member => {
            const net = data.balances[member.id] || 0;
            const label = net > 0.005 ? 'is owed' : net < -0.005 ? 'owes' : 'settled';
            const paid = currentExpenses
              .filter(item => item.paid_by === member.id)
              .reduce((sum, item) => sum + convertedExpenseAmount(item), 0);
            return `<div class="web-balance-row"><span>${esc(member.name)}${member.user_id === window._currentUser?.id ? ' (you)' : ''}</span><strong class="${net > 0.005 ? 'is-positive' : net < -0.005 ? 'is-negative' : ''}">${net > 0.005 ? '+' : net < -0.005 ? '−' : ''}${money(Math.abs(net))}</strong><small>Paid ${tripMoney(paid)} · ${label}</small></div>`;
          })
          .join('');
    const suggestions = (data?.suggestions || [])
      .map(item => {
        const from = currentMembers.find(member => member.id === item.from);
        const to = currentMembers.find(member => member.id === item.to);
        if (!from || !to) return '';
        const canRecord =
          active && !currentSettled.includes(dayCount()) && (creator || from.user_id === window._currentUser?.id);
        const paypal = normalizePaypalLink(to.paypal_link);
        return `<div class="web-suggestion"><span>${esc(from.name)} → ${esc(to.name)}</span><strong>${tripMoney(item.amount)}</strong>
        <div>${canRecord ? `<button class="btn btn-secondary btn-sm btn-auto" data-web-payment="${esc(item.from)}:${esc(item.to)}">Record payment</button>` : ''}${paypal ? `<a href="${esc(paypal)}" target="_blank" rel="noopener noreferrer">Open PayPal</a>` : ''}</div></div>`;
      })
      .join('');
    const dayTotal = selectedExpenses.reduce((sum, item) => sum + convertedExpenseAmount(item), 0);
    return `<aside class="web-workspace-rail" aria-label="Trip summary and balances"><section class="web-rail-summary"><h2>Trip summary</h2>${summaryCards()}</section>${canAdvance ? `<section class="web-rail-card web-settle-card"><h2>${skipEmptyDay ? 'Skip' : 'Settle'} Day ${chosen}</h2><p>${skipEmptyDay ? `No expenses. Skip this day to open Day ${chosen + 1}.` : `${money(dayTotal)} · ${selectedExpenses.length} expenses. Locks this day and opens Day ${chosen + 1}. Balances stay trip-wide.`}</p><label for="web-settle-note">Note (optional)</label><input id="web-settle-note" maxlength="200" placeholder="${skipEmptyDay ? 'e.g. rest day' : 'e.g. paid cash at airport'}"><button class="btn btn-secondary btn-auto" data-web-${skipEmptyDay ? 'skip' : 'settle'}="${chosen}">${skipEmptyDay ? 'Skip' : 'Settle'} Day ${chosen}</button></section>` : ''}
      <section class="web-rail-card web-balances-card"><h2>Trip-wide balances</h2><p>Includes all days and recorded payments.</p>${rows || '<p>No members yet.</p>'}
      ${suggestions ? `<h3>Suggested payments</h3>${suggestions}` : data ? '<p>Everyone is square.</p>' : ''}</section></aside>`;
  }
  function decorateExpenseRows(list) {
    const mine = currentMembers.find(member => member.user_id === window._currentUser?.id);
    const memberNames = Object.fromEntries(currentMembers.map(member => [member.id, member.name]));
    const waitingIds = new Set(
      readOfflineQueue(window._currentUser?.id)
        .flatMap(mutation =>
          (mutation.steps || []).flatMap(step => {
            if (step?.function === 'create_expense_with_splits') return [step.args?.p_expense?.id];
            if (step?.table === 'expenses' && step?.values?.id) return [step.values.id];
            return [];
          }),
        )
        .filter(Boolean),
    );
    const filtered = currentExpenses.filter(item => {
      if (expenseFilter === 'all') return true;
      if (expenseFilter === 'mine') return item.paid_by === mine?.id || item.created_by === window._currentUser?.id;
      if (expenseFilter === 'unpaid') return !currentSettled.includes(item.day_number);
      return item.category === expenseFilter;
    });
    list.querySelectorAll('.day-section').forEach(section => {
      const number = Number(section.querySelector('.day-label')?.textContent?.match(/\d+/)?.[0]);
      const items = filtered.filter(item => Number(item.day_number) === number);
      section.querySelectorAll('.expense-card').forEach((row, index) => {
        const item = items[index];
        if (!item) return;
        const splits = currentSplits.filter(split => split.expense_id === item.id);
        const myShare = splits
          .filter(split => split.member_id === mine?.id)
          .reduce((sum, split) => sum + Number(split.share_amount || 0), 0);
        const myPaid = item.paid_by === mine?.id ? convertedExpenseAmount(item) : 0;
        const net = myPaid - myShare;
        const meta = row.querySelector('.exp-meta');
        if (meta)
          meta.textContent = `${memberNames[item.paid_by] || 'Unknown'} paid · ${item.split_type === 'exact' ? 'exact split' : `split ${splits.length || currentMembers.length} ways`}${item.note ? ` · ${item.note}` : ''}`;
        row.querySelector('.exp-note')?.remove();
        const status = row.querySelector('.expense-status');
        if (status && !currentSettled.includes(number)) {
          status.className = `expense-status ${net > 0.005 ? 'owed' : net < -0.005 ? 'owe' : 'neutral'}`;
          status.textContent =
            net > 0.005
              ? `Owed to you ${formatMoney(net, currentTrip.currency)}`
              : net < -0.005
                ? `You owe ${formatMoney(-net, currentTrip.currency)}`
                : 'No balance from this expense';
        }
        if (waitingIds.has(item.id)) {
          row.classList.add('web-expense-pending');
          const title = row.querySelector('.exp-title');
          title?.insertAdjacentHTML('afterend', '<span class="web-pending-pill"><span></span>Waiting to sync</span>');
        }
      });
    });
  }

  function phoneAddDay() {
    const openDays = Array.from({ length: dayCount() }, (_, index) => index + 1).filter(
      number => !currentSettled.includes(number),
    );
    return openDays.includes(expandedPhoneDay) ? expandedPhoneDay : openDays.at(-1) || null;
  }
  function makePhoneExpenseList(list) {
    const sourceSections = new Map(
      [...list.querySelectorAll('.day-section')].map(section => [
        Number(section.querySelector('.day-label')?.textContent?.match(/\d+/)?.[0]),
        section,
      ]),
    );
    const filterBar = list.querySelector('.expense-filter-row');
    const phoneList = document.createElement('div');
    phoneList.className = 'web-phone-expenses';
    phoneList.innerHTML = '';
    if (filterBar) phoneList.append(filterBar);
    for (let number = dayCount(); number >= 1; number--) {
      const source = sourceSections.get(number);
      const itemCount = source?.querySelectorAll('.expense-card').length || 0;
      const hasExpenses = currentExpenses.some(item => Number(item.day_number) === number);
      const total = source?.querySelector('.day-total')?.textContent || money(0);
      const settled = currentSettled.includes(number);
      const open = expandedPhoneDay === number;
      const section = document.createElement('section');
      section.className = `web-phone-day${settled ? ' is-settled' : ''}`;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'web-phone-day-toggle';
      button.dataset.webExpandDay = String(number);
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-controls', `web-phone-day-${number}`);
      button.innerHTML = `<span>Day ${number}${settled ? ' · Settled' : ''}<small>${itemCount} expense${itemCount === 1 ? '' : 's'}</small></span><strong>${total}</strong><span class="web-phone-day-chevron" aria-hidden="true">›</span>`;
      const body = document.createElement('div');
      body.id = `web-phone-day-${number}`;
      body.className = 'web-phone-day-body';
      body.hidden = !open;
      const rows = source?.querySelector('.day-body');
      if (rows?.childElementCount) body.append(...rows.children);
      else
        body.innerHTML =
          '<div class="web-phone-day-empty"><span aria-hidden="true">🧾</span><p>No expenses on this day.</p></div>';
      if (currentTrip.creator_id === window._currentUser?.id && currentTrip.status !== 'ended' && !settled) {
        if (hasExpenses)
          body.insertAdjacentHTML(
            'beforeend',
            `<div class="settle-day-row"><button class="btn btn-secondary btn-sm btn-auto" data-web-settle="${number}">Settle Day ${number}</button></div>`,
          );
        else if (number === dayCount())
          body.insertAdjacentHTML(
            'beforeend',
            `<div class="settle-day-row"><button class="btn btn-secondary btn-sm btn-auto" data-web-skip="${number}">Skip Day ${number}</button></div>`,
          );
      }
      section.append(button, body);
      phoneList.append(section);
    }
    list.replaceChildren(phoneList);
  }

  function compose() {
    if (composing || !currentTrip) return;
    composing = true;
    try {
      insightsOpen =
        (overview.querySelector('.web-trip-insights') || expenses.querySelector('.web-trip-insights'))?.open ??
        insightsOpen;
      restoreHeaderControls(); // The old renderer replaces Overview's children.
      // Call saved originals, not our wrappers: preserve validations, filters and locking.
      originalOverview();
      originalExpenses();
      const phone = phoneTripView();
      overview.hidden = true;
      if (overviewButton) overviewButton.hidden = true;
      updateHeader();
      if (selectedDay !== 'whole' && (!Number.isInteger(selectedDay) || selectedDay < 1 || selectedDay > dayCount()))
        selectedDay = dayCount();
      overview
        .querySelectorAll('[data-action="open-add-expense-modal"], .overview-actions')
        .forEach(element => element.remove());
      const expenseList = document.createElement('section');
      expenseList.id = 'web-workspace-expenses-list';
      expenseList.setAttribute('aria-label', 'Trip expenses');
      expenseList.append(...expenses.childNodes);
      expenseList.querySelectorAll('.trip-add-expense').forEach(button => button.remove());
      decorateExpenseRows(expenseList);
      if (!phone) {
        // The desktop feed is chronological: settled days remain read-only, but
        // their rows stay visible under their sticky date header.
        expenseList.querySelectorAll('.day-section.settled').forEach(section => {
          section.classList.remove('collapsed');
          section.querySelector('.day-body')?.removeAttribute('hidden');
        });
      }
      if (phone) makePhoneExpenseList(expenseList);
      const layout = document.createElement('div');
      layout.className = 'web-workspace-layout';
      const main = document.createElement('div');
      main.className = 'web-workspace-main';
      const chosen = phone ? phoneAddDay() : dayCount();
      main.innerHTML = '<div class="web-expense-feed-heading"><h2>Expenses</h2><span>Grouped by trip day</span></div>';
      main.append(expenseList);
      workspaceFab.hidden = !(currentTrip.status !== 'ended' && chosen && !currentSettled.includes(chosen));
      layout.append(main);
      if (!phone) layout.insertAdjacentHTML('beforeend', balancePanel());
      overview.replaceChildren();
      expenses.replaceChildren(layout);
      window.webExpense?.attach(main, {
        day: chosen,
        canAdd: chosen !== null && currentTrip.status !== 'ended' && !currentSettled.includes(chosen),
      });
      updateSelectedTab();
    } finally {
      composing = false;
    }
  }
  window.renderOverviewTab = compose;
  window.renderExpensesTab = compose;
  const originalSyncCurrentTripCache = window.syncCurrentTripCache;
  window.syncCurrentTripCache = function (...args) {
    const result = originalSyncCurrentTripCache(...args);
    if (document.body.dataset.screen === 'dashboard' && ['overview', 'expenses'].includes(currentTab)) compose();
    return result;
  };
  window.openAddExpenseModal = function (...args) {
    const result = originalAddExpense(...args);
    if (
      document.body.dataset.screen === 'expense' &&
      Number.isInteger(selectedDay) &&
      !currentSettled.includes(selectedDay)
    ) {
      document.getElementById('exp-day').value = selectedDay;
    }
    return result;
  };
  window.renderAnalyticsTab = function (...args) {
    const result = originalAnalytics(...args);
    dashboard.querySelectorAll('#tab-analytics .currency-control').forEach(element => element.remove());
    return result;
  };
  window.switchTab = function (tab) {
    if (!currentTrip) return originalSwitch(tab);
    const selected = tab === 'overview' && !phoneTripView() ? 'expenses' : tab;
    const result = originalSwitch(selected);
    if (selected !== 'expenses') compose();
    if (phoneTripView() && selected !== 'expenses') workspaceFab.hidden = true;
    updateSelectedTab();
    return result;
  };

  const expenseActionSheet = document.createElement('section');
  expenseActionSheet.id = 'expense-action-sheet';
  expenseActionSheet.hidden = true;
  expenseActionSheet.setAttribute('role', 'dialog');
  expenseActionSheet.setAttribute('aria-modal', 'true');
  expenseActionSheet.setAttribute('aria-labelledby', 'expense-action-sheet-title');
  expenseActionSheet.innerHTML = `<button class="expense-action-backdrop" data-action="close-expense-action-sheet" aria-label="Close add expense options"></button>
    <div class="expense-action-sheet-card"><div class="expense-action-sheet-head"><h2 id="expense-action-sheet-title">Add an expense</h2><button data-action="close-expense-action-sheet" aria-label="Close">✕</button></div>
      <button class="expense-action-option" data-action="open-receipt-picker"><span aria-hidden="true">📸</span><span><b>Scan receipt <small>AI</small></b><em>Choose or take a photo to prepare an expense</em></span></button>
      <button class="expense-action-option" data-action="open-add-expense-modal"><span aria-hidden="true">✏️</span><span><b>Manual entry</b><em>Add an expense yourself</em></span></button>
      <input id="receipt-photo-input" type="file" accept="image/*" hidden>
    </div>`;
  document.body.append(expenseActionSheet);
  const receiptReviewSheet = document.createElement('section');
  receiptReviewSheet.id = 'receipt-review-sheet';
  receiptReviewSheet.hidden = true;
  receiptReviewSheet.setAttribute('role', 'dialog');
  receiptReviewSheet.setAttribute('aria-modal', 'true');
  receiptReviewSheet.setAttribute('aria-labelledby', 'receipt-review-title');
  receiptReviewSheet.innerHTML = `<button class="receipt-review-backdrop" type="button" aria-label="Close receipt preview"></button>
    <div class="receipt-review-card"><div class="receipt-review-head"><h2 id="receipt-review-title">Receipt selected</h2><button type="button" data-receipt-action="cancel" aria-label="Close">✕</button></div>
      <div class="receipt-preview-frame"><img id="receipt-preview-image" alt="Selected receipt preview"><span id="receipt-preview-unavailable" hidden>Preview unavailable for this image</span><span class="receipt-photo-spinner" aria-hidden="true" hidden></span></div>
      <p id="receipt-preview-name" class="receipt-preview-name"></p>
      <p id="receipt-review-status" class="receipt-review-status" role="status">Preparing receipt locally…</p>
      <p id="receipt-review-copy" class="receipt-review-copy">This photo stays on your device until you choose what to do next.</p>
      <div class="receipt-review-actions"><button type="button" class="btn btn-primary" data-receipt-action="scan">Scan receipt</button><button type="button" class="btn btn-secondary" data-receipt-action="choose-another">Choose another</button><button type="button" class="btn btn-secondary" data-receipt-action="continue">Continue manually</button></div>
    </div>`;
  document.body.append(receiptReviewSheet);
  const workspaceFab = document.createElement('button');
  workspaceFab.id = 'web-workspace-fab';
  workspaceFab.className = 'web-expense-fab';
  workspaceFab.dataset.action = 'open-expense-action-sheet';
  workspaceFab.setAttribute('aria-label', 'Add expense');
  workspaceFab.innerHTML = '<span aria-hidden="true">＋</span><b>Add expense</b>';
  workspaceFab.hidden = true;
  dashboard.append(workspaceFab);
  let expenseActionReturnFocus = null;
  let receiptPreviewUrl = '';
  let receiptReviewReturnFocus = null;
  let receiptExpenseDraft = null;
  let receiptPreparationToken = 0;
  let receiptScanToken = 0;
  let receiptScanController = null;
  let nativeReceiptPickerOpen = false;
  let receiptPhotoHintTimer = null;
  const RECEIPT_PHOTO_HINT_DELAY_MS = 3000;
  const receiptInput = expenseActionSheet.querySelector('#receipt-photo-input');
  const receiptPreview = receiptReviewSheet.querySelector('#receipt-preview-image');
  const receiptPreviewUnavailable = receiptReviewSheet.querySelector('#receipt-preview-unavailable');
  const receiptPreviewName = receiptReviewSheet.querySelector('#receipt-preview-name');
  const receiptReviewStatus = receiptReviewSheet.querySelector('#receipt-review-status');
  const receiptReviewCopy = receiptReviewSheet.querySelector('#receipt-review-copy');
  const receiptReviewTitle = receiptReviewSheet.querySelector('#receipt-review-title');
  const receiptPhotoSpinner = receiptReviewSheet.querySelector('.receipt-photo-spinner');
  const receiptReviewScan = receiptReviewSheet.querySelector('[data-receipt-action="scan"]');
  const receiptReviewContinue = receiptReviewSheet.querySelector('[data-receipt-action="continue"]');
  const receiptReviewChooseAnother = receiptReviewSheet.querySelector('[data-receipt-action="choose-another"]');
  const MAX_RECEIPT_IMAGE_BYTES = 8 * 1024 * 1024;
  // Keep uploads small: large mobile uploads intermittently fail at the edge, and
  // OpenAI's high-detail mode scales receipts to about this size anyway.
  const MAX_RECEIPT_SCAN_EDGE = 1600;
  const RECEIPT_SCAN_TARGET_BYTES = 512 * 1024;
  const RECEIPT_SCAN_JPEG_QUALITY = 0.8;
  const RECEIPT_SCAN_RETRY_STATUSES = new Set([502, 503, 504]);
  const RECEIPT_SCAN_UNREACHABLE_MESSAGE =
    'Receipt scanning couldn’t reach the server. Try again, or continue manually.';
  const RECEIPT_SCAN_INCOMPLETE_MESSAGE = 'Receipt scanning could not be completed. Try again, or continue manually.';
  // Retry only quick gateway failures: the native request cannot be aborted, so a
  // retry after a slow failure could leave the user waiting for minutes.
  const RECEIPT_SCAN_RETRY_WITHIN_MS = 10000;
  const RECEIPT_IMAGE_EXTENSIONS = /\.(avif|heic|heif|jpe?g|png|webp)$/i;
  const SCANNABLE_RECEIPT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

  function clearReceiptPreview() {
    if (receiptPreviewUrl) URL.revokeObjectURL(receiptPreviewUrl);
    receiptPreviewUrl = '';
    receiptPreview.removeAttribute('src');
    receiptPreview.hidden = false;
    receiptPreviewUnavailable.hidden = true;
    receiptPreviewName.textContent = '';
    receiptReviewStatus.textContent = '';
    receiptReviewCopy.textContent = '';
    receiptReviewScan.textContent = 'Scan receipt';
    receiptReviewScan.disabled = false;
    receiptReviewContinue.disabled = false;
    receiptReviewChooseAnother.disabled = false;
    endReceiptPhotoLoading();
  }

  function endReceiptPhotoLoading() {
    clearTimeout(receiptPhotoHintTimer);
    receiptPhotoHintTimer = null;
    receiptReviewSheet.classList.remove('is-loading-photo');
    receiptPhotoSpinner.hidden = true;
    receiptReviewTitle.textContent = 'Receipt selected';
  }

  // Open the sheet before the native picker so it is already showing when the
  // picker closes. iOS can take several seconds to hand over a photo taken moments
  // ago (it finishes processing it first), and without this the screen looks idle.
  function showReceiptPhotoLoading() {
    const token = ++receiptPreparationToken;
    clearReceiptPreview();
    receiptExpenseDraft = null;
    receiptReviewReturnFocus = document.activeElement;
    receiptReviewSheet.classList.add('is-loading-photo');
    receiptReviewTitle.textContent = 'Receipt photo';
    receiptPreview.hidden = true;
    receiptPhotoSpinner.hidden = false;
    receiptReviewStatus.textContent = 'Waiting for your photo…';
    receiptReviewCopy.textContent = 'Choose or take a photo of the receipt.';
    receiptReviewScan.disabled = true;
    receiptReviewChooseAnother.disabled = true;
    receiptReviewContinue.disabled = false;
    receiptReviewSheet.hidden = false;
    document.body.classList.add('receipt-review-open');
    receiptPhotoHintTimer = setTimeout(() => {
      if (token !== receiptPreparationToken || receiptReviewSheet.hidden) return;
      receiptReviewCopy.textContent = 'New photos can take a few seconds to prepare.';
    }, RECEIPT_PHOTO_HINT_DELAY_MS);
    return token;
  }

  function showReceiptPhotoError(message) {
    endReceiptPhotoLoading();
    receiptPreview.hidden = true;
    receiptPreviewUnavailable.hidden = false;
    receiptReviewStatus.textContent = 'Photo could not be opened';
    receiptReviewCopy.textContent = message;
    receiptReviewScan.disabled = true;
    receiptReviewChooseAnother.disabled = false;
    receiptReviewContinue.disabled = false;
    receiptReviewChooseAnother.focus();
  }

  function closeReceiptReview({ restoreFocus = true, discardDraft = true } = {}) {
    if (receiptReviewSheet.hidden) return;
    receiptReviewSheet.hidden = true;
    document.body.classList.remove('receipt-review-open');
    clearReceiptPreview();
    if (discardDraft) {
      receiptPreparationToken += 1;
      receiptScanToken += 1;
      receiptScanController?.abort();
      receiptScanController = null;
      receiptExpenseDraft = null;
    }
    if (restoreFocus) receiptReviewReturnFocus?.focus?.();
    receiptReviewReturnFocus = null;
  }

  function isReceiptImage(file) {
    return Boolean(file && (file.type.startsWith('image/') || RECEIPT_IMAGE_EXTENSIONS.test(file.name)));
  }

  function receiptScanFilename(fileName) {
    return `${String(fileName || 'receipt').replace(/\.[^.]+$/, '') || 'receipt'}-scan.jpg`;
  }

  function receiptFileExtension(format) {
    const normalized = String(format || '').toLowerCase();
    if (normalized === 'png') return 'png';
    if (normalized === 'webp') return 'webp';
    return 'jpg';
  }

  function receiptMimeType(format, fallback = '') {
    const normalized = String(format || fallback || '').toLowerCase();
    if (normalized.includes('png')) return 'image/png';
    if (normalized.includes('webp')) return 'image/webp';
    return 'image/jpeg';
  }

  async function nativeReceiptFile() {
    const camera = window.Capacitor?.Plugins?.Camera;
    if (!camera?.getPhoto) throw new Error('Receipt photos need the latest TripCash app update.');
    const photo = await camera.getPhoto({
      quality: Math.round(RECEIPT_SCAN_JPEG_QUALITY * 100),
      allowEditing: false,
      resultType: 'uri',
      source: 'PROMPT',
      saveToGallery: false,
      width: MAX_RECEIPT_SCAN_EDGE,
      height: MAX_RECEIPT_SCAN_EDGE,
      correctOrientation: true,
      promptLabelHeader: 'Receipt photo',
      promptLabelPhoto: 'Choose from photos',
      promptLabelPicture: 'Take photo',
      promptLabelCancel: 'Cancel',
    });
    try {
      if (!photo?.webPath) throw new Error('The selected receipt photo could not be opened.');
      const response = await fetch(photo.webPath);
      if (!response.ok) throw new Error('The selected receipt photo could not be opened.');
      const blob = await response.blob();
      const extension = receiptFileExtension(photo.format || blob.type);
      const type = receiptMimeType(photo.format, blob.type);
      return new File([blob], `receipt-${Date.now()}.${extension}`, { type, lastModified: Date.now() });
    } finally {
      const filesystem = window.Capacitor?.Plugins?.Filesystem;
      if (photo?.path && filesystem?.deleteFile) {
        try {
          await filesystem.deleteFile({ path: photo.path });
        } catch (_) {
          /* best-effort cache cleanup */
        }
      }
    }
  }

  function receiptPickerWasCancelled(error) {
    return error?.code === 'OS-PLUG-CAMR-0006' || /cancel/i.test(String(error?.message || ''));
  }

  function loadReceiptImage(file) {
    return new Promise((resolve, reject) => {
      const imageUrl = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        URL.revokeObjectURL(imageUrl);
        resolve({ image, width, height });
      };
      image.onerror = () => {
        URL.revokeObjectURL(imageUrl);
        reject(new Error('Image preview is unavailable.'));
      };
      image.src = imageUrl;
    });
  }

  function canvasToJpeg(canvas) {
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', RECEIPT_SCAN_JPEG_QUALITY));
  }

  function receiptScanEndpoint() {
    return window.Capacitor?.isNativePlatform?.() ? 'https://tripcash.de/api/receipt-scan' : '/api/receipt-scan';
  }

  function receiptScanErrorMessage(error) {
    if (error?.name === 'AbortError') return 'Receipt scanning timed out. Try again, or continue manually.';
    const message = String(error?.message || '').trim();
    if (message === 'Confirmed account required.') {
      return 'Sign in with a verified email account to scan receipts, or continue manually.';
    }
    if (!message || /^(load failed|failed to fetch|network request failed)$/i.test(message)) {
      return 'Receipt scanning is temporarily unavailable. Check your connection, or continue manually.';
    }
    return message;
  }

  function parseReceiptScanResponse(data) {
    if (data && typeof data === 'object') return data;
    if (typeof data !== 'string') return null;
    const text = data.trim();
    if (!text || (!text.startsWith('{') && !text.startsWith('['))) return null;
    try {
      return JSON.parse(text);
    } catch (_) {
      return null;
    }
  }

  // One request. An unreadable gateway reply (Cloudflare's own error page instead
  // of our JSON) is flagged so the caller can retry it once.
  async function requestReceiptScanOnce(dataUrl, signal) {
    const authorization = `Bearer ${window._tcAccessToken || ''}`;
    const nativeHttp = window.Capacitor?.isNativePlatform?.() ? window.Capacitor?.Plugins?.CapacitorHttp : null;
    let status;
    let result;
    if (nativeHttp?.post) {
      const response = await nativeHttp.post({
        url: receiptScanEndpoint(),
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          Origin: 'capacitor://localhost',
        },
        data: { image: { dataUrl } },
        connectTimeout: 10000,
        readTimeout: 55000,
        // Parse the response ourselves so an HTML/plain-text gateway error can
        // never surface as a native JSON parser exception.
        responseType: 'text',
      });
      status = Number(response?.status) || 0;
      result = parseReceiptScanResponse(response?.data);
    } else {
      const response = await fetch(receiptScanEndpoint(), {
        method: 'POST',
        headers: { Authorization: authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: { dataUrl } }),
        signal,
      });
      status = response.status;
      result = await response.json().catch(() => null);
    }
    if (status >= 200 && status < 300 && result?.suggestions) return { result };
    if (result?.error) return { error: new Error(result.error) };
    // A success status without suggestions reached a server, just not usefully.
    if (status >= 200 && status < 300) return { error: new Error(RECEIPT_SCAN_INCOMPLETE_MESSAGE) };
    return {
      error: new Error(RECEIPT_SCAN_UNREACHABLE_MESSAGE),
      retry: RECEIPT_SCAN_RETRY_STATUSES.has(status),
    };
  }

  async function requestReceiptScan(dataUrl, signal) {
    const startedAt = Date.now();
    let attempt = await requestReceiptScanOnce(dataUrl, signal);
    if (attempt.retry && !signal?.aborted && Date.now() - startedAt < RECEIPT_SCAN_RETRY_WITHIN_MS) {
      await new Promise(resolve => setTimeout(resolve, 800));
      attempt = await requestReceiptScanOnce(dataUrl, signal);
    }
    if (attempt.error) throw attempt.error;
    return attempt.result;
  }

  function readReceiptAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Receipt could not be read.'));
      reader.onerror = () => reject(new Error('Receipt could not be read.'));
      reader.readAsDataURL(file);
    });
  }

  function formReceiptDraft(draft) {
    return {
      source: 'receipt',
      photo: { name: draft?.photo?.name || 'Receipt photo' },
      suggestions: draft?.suggestions || {},
    };
  }

  async function scanReceiptDraft() {
    const draft = receiptExpenseDraft;
    const file = draft?.scan?.file;
    if (!draft || !file) return;
    if (!SCANNABLE_RECEIPT_MIME_TYPES.has(file.type)) {
      receiptReviewStatus.textContent = 'Choose a JPG, PNG, or WebP photo to scan';
      receiptReviewCopy.textContent =
        'This image format cannot be sent securely for scanning. You can still continue manually.';
      return;
    }
    draft.status = 'scanning';
    receiptReviewStatus.textContent = 'Scanning receipt…';
    receiptReviewCopy.textContent = 'Reading the receipt securely. This does not create or save an expense.';
    receiptReviewScan.disabled = true;
    receiptReviewContinue.disabled = true;
    receiptReviewChooseAnother.disabled = true;
    const token = ++receiptScanToken;
    let controller = null;
    let timeout = null;
    try {
      const dataUrl = await readReceiptAsDataUrl(file);
      if (token !== receiptScanToken || draft !== receiptExpenseDraft || receiptReviewSheet.hidden) return;
      controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 25000);
      receiptScanController = controller;
      const result = await requestReceiptScan(dataUrl, controller.signal);
      if (draft !== receiptExpenseDraft || receiptReviewSheet.hidden) return;
      draft.suggestions = result.suggestions;
      draft.status = 'review-required';
      receiptReviewStatus.textContent = 'Receipt scanned';
      receiptReviewCopy.textContent = 'Review the suggested details before saving. Payer and split stay unchanged.';
      receiptReviewScan.textContent = 'Review suggested details';
      receiptReviewScan.disabled = false;
      receiptReviewContinue.disabled = false;
      receiptReviewChooseAnother.disabled = false;
      receiptReviewScan.focus();
    } catch (error) {
      if (draft !== receiptExpenseDraft || receiptReviewSheet.hidden) return;
      draft.status = 'ready-to-scan';
      receiptReviewStatus.textContent = 'Receipt could not be scanned';
      receiptReviewCopy.textContent = receiptScanErrorMessage(error);
      receiptReviewScan.disabled = false;
      receiptReviewContinue.disabled = false;
      receiptReviewChooseAnother.disabled = false;
      showToast(receiptReviewCopy.textContent, 'error');
    } finally {
      if (timeout) clearTimeout(timeout);
      if (receiptScanController === controller) receiptScanController = null;
    }
  }

  async function prepareReceiptForScan(file) {
    const imageData = await loadReceiptImage(file).catch(() => null);
    if (!imageData) return { file, prepared: false, width: null, height: null };
    const { image, width, height } = imageData;
    const scale = Math.min(1, MAX_RECEIPT_SCAN_EDGE / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const shouldCompress = scale < 1 || file.size > RECEIPT_SCAN_TARGET_BYTES;
    if (!shouldCompress) return { file, prepared: false, width, height };

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return { file, prepared: false, width, height };
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const blob = await canvasToJpeg(canvas);
    if (!blob || blob.size >= file.size) return { file, prepared: false, width, height };
    return {
      file: new File([blob], receiptScanFilename(file.name), { type: 'image/jpeg', lastModified: Date.now() }),
      prepared: true,
      width: targetWidth,
      height: targetHeight,
    };
  }

  async function showReceiptReview(file) {
    const token = ++receiptPreparationToken;
    receiptExpenseDraft = {
      source: 'receipt',
      status: 'preparing',
      photo: {
        name: file.name || 'Receipt photo',
        type: file.type || '',
        size: file.size || 0,
      },
      suggestions: {},
    };
    receiptReviewReturnFocus = receiptReviewReturnFocus || document.activeElement;
    endReceiptPhotoLoading();
    receiptPreview.hidden = false;
    receiptPreviewUnavailable.hidden = true;
    receiptPreviewUrl = URL.createObjectURL(file);
    receiptPreview.src = receiptPreviewUrl;
    receiptPreviewName.textContent = `${receiptExpenseDraft.photo.name} · ${Math.max(1, Math.ceil(receiptExpenseDraft.photo.size / 1024))} KB`;
    receiptReviewSheet.hidden = false;
    document.body.classList.add('receipt-review-open');
    receiptReviewStatus.textContent = 'Preparing receipt locally…';
    receiptReviewCopy.textContent = 'This photo stays on your device. Nothing is uploaded or saved.';
    receiptReviewContinue.disabled = true;
    receiptReviewChooseAnother.disabled = true;
    receiptReviewScan.disabled = true;
    const prepared = await prepareReceiptForScan(file);
    if (token !== receiptPreparationToken || receiptReviewSheet.hidden || !receiptExpenseDraft) return;
    receiptExpenseDraft.status = 'ready-to-scan';
    receiptExpenseDraft.scan = {
      file: prepared.file,
      mimeType: prepared.file.type || file.type || 'image/jpeg',
      size: prepared.file.size || file.size,
      width: prepared.width,
      height: prepared.height,
      prepared: prepared.prepared,
    };
    receiptReviewStatus.textContent = 'Ready to scan';
    receiptReviewCopy.textContent =
      'Tap Scan receipt to send this photo securely to OpenAI for one-time extraction. TripCash does not save the image.';
    receiptReviewContinue.disabled = false;
    receiptReviewChooseAnother.disabled = false;
    receiptReviewScan.disabled = false;
    receiptReviewScan.focus();
  }
  function closeExpenseActionSheet() {
    if (expenseActionSheet.hidden) return;
    expenseActionSheet.hidden = true;
    document.body.classList.remove('expense-action-sheet-open');
    expenseActionReturnFocus?.focus?.();
    expenseActionReturnFocus = null;
  }
  window.openExpenseActionSheet = function () {
    if (currentTrip?.status === 'ended') return;
    // Receipt scanning is native-only. On the web there is only one available
    // action, so skip the redundant mobile-style chooser and open the form.
    if (!window.Capacitor?.isNativePlatform?.()) {
      window.openAddExpenseModal?.();
      return;
    }
    expenseActionReturnFocus = document.activeElement;
    expenseActionSheet.hidden = false;
    document.body.classList.add('expense-action-sheet-open');
    expenseActionSheet.querySelector('[data-action="open-add-expense-modal"]')?.focus();
  };
  window.openReceiptPicker = async function () {
    closeExpenseActionSheet();
    receiptExpenseDraft = null;
    receiptInput.value = '';
    if (!window.Capacitor?.isNativePlatform?.()) {
      receiptInput.click();
      return;
    }
    if (nativeReceiptPickerOpen) return;
    nativeReceiptPickerOpen = true;
    const token = showReceiptPhotoLoading();
    // The user may close the sheet or continue manually while the photo loads.
    const stillWaiting = () => token === receiptPreparationToken && !receiptReviewSheet.hidden;
    try {
      const file = await nativeReceiptFile();
      if (!stillWaiting()) return;
      if (file.size > MAX_RECEIPT_IMAGE_BYTES) {
        showReceiptPhotoError('Choose a receipt image smaller than 8 MB.');
        return;
      }
      await showReceiptReview(file);
    } catch (error) {
      if (!stillWaiting()) return;
      if (receiptPickerWasCancelled(error)) closeReceiptReview();
      else showReceiptPhotoError(error?.message || 'Receipt photo could not be opened.');
    } finally {
      nativeReceiptPickerOpen = false;
    }
  };
  const originalOpenManualExpense = window.openAddExpenseModal;
  window.openAddExpenseModal = function (...args) {
    closeExpenseActionSheet();
    return originalOpenManualExpense(...args);
  };
  expenseActionSheet.addEventListener('click', event => {
    if (event.target.closest('[data-action="close-expense-action-sheet"]')) closeExpenseActionSheet();
  });
  receiptInput.addEventListener('change', event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!isReceiptImage(file)) {
      showToast('Choose a receipt image in JPG, PNG, WebP, HEIC, or AVIF format.', 'error');
      return;
    }
    if (file.size > MAX_RECEIPT_IMAGE_BYTES) {
      showToast('Choose a receipt image smaller than 8 MB.', 'error');
      return;
    }
    void showReceiptReview(file);
  });
  receiptPreview.addEventListener('error', () => {
    receiptPreview.hidden = true;
    receiptPreviewUnavailable.hidden = false;
  });
  receiptReviewSheet.addEventListener('click', event => {
    const action = event.target.closest('[data-receipt-action]')?.dataset.receiptAction;
    if (event.target === receiptReviewSheet.querySelector('.receipt-review-backdrop') || action === 'cancel') {
      closeReceiptReview();
    } else if (action === 'choose-another') {
      closeReceiptReview({ restoreFocus: false });
      void window.openReceiptPicker();
    } else if (action === 'continue') {
      const draft = receiptExpenseDraft;
      closeReceiptReview({ restoreFocus: false, discardDraft: !draft });
      receiptExpenseDraft = null;
      // Without a photo yet (still loading or failed), open a plain manual entry.
      if (draft) window.openAddExpenseModal({ receiptDraft: formReceiptDraft(draft) });
      else window.openAddExpenseModal();
    } else if (action === 'scan') {
      if (receiptExpenseDraft?.status === 'review-required') {
        const draft = receiptExpenseDraft;
        closeReceiptReview({ restoreFocus: false, discardDraft: false });
        receiptExpenseDraft = null;
        window.openAddExpenseModal({ receiptDraft: formReceiptDraft(draft) });
      } else {
        void scanReceiptDraft();
      }
    }
  });
  window.matchMedia('(max-width: 760px)').addEventListener('change', () => {
    if (currentTrip && document.body.dataset.screen === 'dashboard') window.switchTab(currentTab);
  });

  structure.addEventListener('click', event => {
    for (const disclosure of structure.querySelectorAll('details[open]')) {
      if (disclosure.id === 'web-trip-overflow' && event.target.closest('button[data-action]')) disclosure.open = false;
    }
  });
  document.addEventListener('click', event => {
    const phoneDay = event.target.closest('#tab-expenses [data-web-expand-day]');
    if (phoneDay) {
      const number = Number(phoneDay.dataset.webExpandDay);
      expandedPhoneDay = expandedPhoneDay === number ? null : number;
      compose();
      document.querySelector(`#tab-expenses [data-web-expand-day="${number}"]`)?.focus();
      return;
    }
    const settleButton = event.target.closest('#tab-expenses [data-web-settle], #tab-expenses [data-web-skip]');
    if (settleButton) {
      const skip = settleButton.hasAttribute('data-web-skip');
      const number = Number(skip ? settleButton.dataset.webSkip : settleButton.dataset.webSettle);
      if (
        currentTrip?.status !== 'ended' &&
        currentTrip.creator_id === window._currentUser?.id &&
        !currentSettled.includes(number)
      ) {
        const note = document.getElementById('web-settle-note')?.value || '';
        if (window.TripCashNativeRedesign || window.innerWidth <= 760) {
          openSettleDayModal(number, skip ? 'skip' : 'settle');
          document.getElementById('settle-note').value = note;
        } else {
          _settleDay = number;
          _settleMode = skip ? 'skip' : 'settle';
          document.getElementById('settle-note').value = note;
          confirmSettleDay(new Event('submit', { cancelable: true }));
        }
      }
      return;
    }
    const paymentButton = event.target.closest('#tab-expenses [data-web-payment]');
    if (paymentButton) {
      const [from, to] = paymentButton.dataset.webPayment.split(':');
      const suggestion = actualBalances()?.suggestions.find(item => item.from === from && item.to === to);
      const payer = currentMembers.find(member => member.id === from);
      if (
        suggestion &&
        currentTrip?.status !== 'ended' &&
        (currentTrip.creator_id === window._currentUser?.id || payer?.user_id === window._currentUser?.id)
      )
        openPaymentModal(from, to, suggestion.amount);
      return;
    }
    dashboard.querySelectorAll('#web-trip-overflow[open]').forEach(disclosure => {
      if (!disclosure.contains(event.target)) disclosure.open = false;
    });
  });
  dashboard.addEventListener(
    'toggle',
    event => {
      if (event.target.matches('.web-trip-insights')) insightsOpen = event.target.open;
    },
    true,
  );
  new MutationObserver(() => {
    if (document.body.dataset.screen === 'dashboard' && currentTab === 'expenses') compose();
  }).observe(document.getElementById('offline-sync-status'), { childList: true, attributes: true, subtree: true });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !expenseActionSheet.hidden) {
      event.preventDefault();
      closeExpenseActionSheet();
      return;
    }
    if (event.key === 'Escape' && !document.querySelector('.modal.open')) {
      structure.querySelectorAll('details[open]').forEach(disclosure => {
        disclosure.open = false;
        disclosure.querySelector('summary').focus();
      });
    }
    if (!event.target.closest('#trip-bottom-nav') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
      return;
    event.preventDefault();
    const tabs = [...nav.querySelectorAll('[data-tab]')].filter(button => !button.hidden);
    const index = tabs.indexOf(event.target.closest('[data-tab]'));
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    switchTab(tabs[next].dataset.tab);
    tabs[next].focus();
  });
  if (currentTrip && document.body.dataset.screen === 'dashboard') switchTab(currentTab);
})();
