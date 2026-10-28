// Shared expense presentation of the existing form and mutation path.
(() => {
  if (window.Capacitor?.isNativePlatform?.() && !window.TripCashNativeRedesign) return;
  const source = document.getElementById('screen-expense');
  const page = source?.querySelector('.expense-page');
  const form = document.getElementById('form-add-expense');
  if (!page || !form) return;
  form.noValidate = true; // Use the visible inline validation instead of browser popovers.

  const host = document.createElement('section');
  host.id = 'web-expense-host';
  host.hidden = true;
  host.setAttribute('aria-label', 'Add expense');
  host.innerHTML = '<div class="web-expense-backdrop"></div>';
  host.append(page); // Preserve the original form node and all existing listeners.
  source.append(host); // Keep the form discoverable while app.js registers its submit listener.
  const header = page.querySelector('.modal-hdr');
  header.querySelector('.modal-title').textContent = 'Add an expense';
  header.querySelector('.modal-close').setAttribute('aria-label', 'Close add expense');

  const dayInput = document.getElementById('exp-day');
  const daySelect = document.createElement('select');
  daySelect.id = dayInput.id;
  daySelect.required = true;
  dayInput.replaceWith(daySelect);
  const category = document.getElementById('exp-category');
  const payer = document.getElementById('exp-paid-by');
  for (const select of [category, payer]) {
    select.classList.remove('visually-hidden');
    select.removeAttribute('aria-hidden');
    select.removeAttribute('tabindex');
    select.required = true;
  }
  const splitChoice = document.createElement('div');
  splitChoice.className = 'web-expense-split-choice form-group';
  splitChoice.innerHTML =
    '<label for="web-expense-split">Split</label><select id="web-expense-split"><option value="equal">Equal</option><option value="exact">Exact</option></select>';
  const detailRows = form.querySelector('.expense-detail-rows');
  const dayGroup = detailRows.querySelector('.form-group:first-child');
  detailRows.after(splitChoice);
  const brief = document.createElement('p');
  brief.className = 'web-expense-brief';
  splitChoice.after(brief);
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'web-expense-more';
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-controls', 'web-expense-details');
  more.textContent = 'More details · split members and note';
  brief.after(more);
  const details = document.createElement('div');
  details.id = 'web-expense-details';
  details.hidden = true;
  details.append(form.querySelector('.expense-split-group'), form.querySelector('.expense-note-group'));
  more.after(details);
  const fieldGroups = {
    'exp-amount': form.querySelector('.expense-amount-card'),
    'exp-title': form.querySelector('.expense-title-group'),
    'exp-category': form.querySelector('.expense-category-group'),
    'exp-day': form.querySelector('.expense-detail-rows .form-group:first-child'),
    'exp-paid-by': form.querySelector('.expense-detail-rows .form-group:last-child'),
    split: form.querySelector('.expense-split-group'),
  };
  const fieldErrors = Object.fromEntries(
    Object.entries(fieldGroups).map(([key, group]) => {
      const error = document.createElement('p');
      error.className = 'web-expense-field-error';
      error.id = `${key}-error`;
      error.setAttribute('role', 'alert');
      error.hidden = true;
      group.append(error);
      const control = document.getElementById(key);
      if (control) control.setAttribute('aria-describedby', error.id);
      return [key, error];
    }),
  );
  const feedback = document.createElement('p');
  feedback.className = 'web-expense-feedback';
  feedback.id = 'web-expense-feedback';
  feedback.setAttribute('role', 'status');
  feedback.hidden = true;
  header.after(feedback);
  const save = document.getElementById('btn-add-expense');
  save.textContent = 'Add expense';
  const footer = document.createElement('div');
  footer.className = 'web-expense-footer';
  page.append(footer);
  let inlineMain = null;
  let tripId = null;
  let selectedDay = null;
  let canAdd = false;
  let sheetOpen = false;
  let previousFocus = null;
  let submitting = false;
  let savedFeedback = null;
  const touched = new Set();
  const edited = new Set();
  const phoneLayout = window.matchMedia('(max-width: 760px)');
  function compactMode() {
    return phoneLayout.matches;
  }
  function updateBrief() {
    brief.textContent = `Day ${daySelect.value || '—'} · ${splitType === 'exact' ? 'Exact' : 'Equal'} split`;
  }
  function placeAdvancedFields() {
    if (compactMode()) {
      details.prepend(dayGroup, splitChoice);
    } else {
      detailRows.prepend(dayGroup);
      detailRows.after(splitChoice);
    }
    updateBrief();
  }

  function showFeedback(message, tone = 'ok') {
    feedback.textContent = message;
    feedback.dataset.tone = tone;
    feedback.hidden = !message;
  }
  function setDetails(open) {
    details.hidden = !open;
    more.setAttribute('aria-expanded', String(open));
    more.textContent = compactMode()
      ? open
        ? 'Fewer details'
        : 'Change day, split or add note'
      : open
        ? 'Fewer details'
        : 'More details · split members and note';
    document.body.classList.toggle('web-expense-expanded', sheetOpen && open);
  }
  function refreshDayOptions() {
    if (!currentTrip) return;
    const before = daySelect.value;
    const openDays = Array.from({ length: Number(currentTrip.current_day) || 1 }, (_, index) => index + 1).filter(
      number => !currentSettled.includes(number),
    );
    daySelect.replaceChildren(
      ...openDays.map(number => {
        const option = document.createElement('option');
        option.value = String(number);
        option.textContent = `Day ${number}`;
        return option;
      }),
    );
    daySelect.value = openDays.includes(Number(before)) ? before : String(selectedDay || openDays.at(-1) || '');
    updateBrief();
  }
  function useCurrentPayer() {
    const mine = currentMembers.find(member => member.user_id === window._currentUser?.id);
    if (mine) payer.value = mine.id;
  }
  function resetForm(...args) {
    if (!currentTrip || !canAdd) return;
    originalOpen(...args);
    showScreen('dashboard');
    placeAdvancedFields();
    refreshDayOptions();
    if (selectedDay) daySelect.value = String(selectedDay);
    useCurrentPayer();
    document.getElementById('web-expense-split').value = splitType;
    updateBrief();
    setDetails(splitType === 'exact');
    touched.clear();
    edited.clear();
    updateValidation();
  }
  function amountValue() {
    return parseMoneyInput(document.getElementById('exp-amount').value);
  }
  function validationKey(target) {
    return target.id.startsWith('split-') || target.id === 'web-expense-split' ? 'split' : target.id;
  }
  function fieldError(key) {
    if (!canAdd || !currentTrip || !currentMembers.length) return '';
    if (key === 'exp-title')
      return document.getElementById('exp-title').value.trim() ? '' : 'Enter what this expense was for.';
    const amount = amountValue();
    if (key === 'exp-amount')
      return !Number.isFinite(amount) || amount <= 0
        ? 'Enter an amount greater than 0.'
        : amount > MAX_EXPENSE_AMOUNT
          ? 'Enter a smaller amount.'
          : '';
    if (key === 'exp-category') return category.value ? '' : 'Choose a category.';
    if (key === 'exp-paid-by') return payer.value ? '' : 'Choose who paid.';
    const day = Number(daySelect.value);
    if (key === 'exp-day')
      return !day || currentSettled.includes(day) || day > Number(currentTrip.current_day)
        ? 'Pick an open day within this trip.'
        : '';
    if (key === 'split' && splitType === 'equal')
      return currentMembers.some(member => expSplitChecked[member.id])
        ? ''
        : 'Choose at least one person to share this expense.';
    if (key === 'split' && splitType === 'exact') {
      const shares = currentMembers.map(member =>
        parseMoneyInput(document.getElementById(`split-${member.id}`)?.value || '0'),
      );
      if (
        shares.some(share => !Number.isFinite(share) || share < 0) ||
        Math.abs(shares.reduce((sum, share) => sum + share, 0) - amount) > 0.02
      ) {
        return 'The split must add up to the expense amount.';
      }
    }
    return '';
  }
  function updateValidation() {
    const active = !!currentTrip && canAdd && !!currentMembers.length;
    const errors = Object.keys(fieldErrors).map(key => [key, fieldError(key)]);
    save.disabled = !active || save.classList.contains('loading');
    for (const [key, message] of errors) {
      const error = fieldErrors[key];
      const shown = touched.has(key) && !!message;
      error.textContent = shown ? `⚠ ${message}` : '';
      error.hidden = !shown;
      const control = document.getElementById(key);
      if (control) control.setAttribute('aria-invalid', String(shown));
      fieldGroups[key].classList.toggle('has-error', shown);
    }
  }
  function closeSheet() {
    sheetOpen = false;
    document.body.classList.remove('web-expense-open');
    document.body.classList.remove('web-expense-expanded');
    document.documentElement.classList.remove('web-expense-open');
    host.removeAttribute('role');
    host.removeAttribute('aria-modal');
    if (save.parentElement === footer) {
      save.removeAttribute('form');
      form.append(save);
    }
    if (inlineMain?.isConnected && host.parentElement === document.body) {
      inlineMain.insertBefore(host, inlineMain.querySelector('#web-workspace-expenses-list'));
    }
    host.hidden = true;
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  }
  function openSheet() {
    sheetOpen = true;
    showFeedback('');
    previousFocus = document.activeElement;
    document.body.append(host); // Escape the scrolling workspace and its stacking contexts.
    host.hidden = false;
    save.setAttribute('form', form.id);
    footer.append(save); // Keep the submit action outside the scrollable form.
    document.body.classList.add('web-expense-open');
    document.body.classList.toggle('web-expense-expanded', !details.hidden);
    document.documentElement.classList.add('web-expense-open');
    host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true');
    header.querySelector('.modal-close').focus(); // Don't summon the keyboard before the user picks a field.
  }

  const originalOpen = window.openAddExpenseModal;
  const originalClose = window.closeExpenseScreen;
  const originalToast = window.showToast;
  window.openAddExpenseModal = function (...args) {
    if (!canAdd) {
      if (!currentTrip || currentTrip.status === 'ended' || !currentMembers.length) return originalOpen(...args);
      if (!canAdd) {
        showToast('Select an open trip day before adding an expense.', 'error');
        return;
      }
    }
    resetForm(...args);
    openSheet();
  };
  window.closeExpenseScreen = function (...args) {
    closeSheet();
    const result = originalClose(...args);
    submitting = false;
    if (savedFeedback) {
      const { message, tone } = savedFeedback;
      savedFeedback = null;
      resetForm();
      showFeedback(message, tone);
    }
    return result;
  };
  window.showToast = function (message, type = 'ok') {
    if (submitting && (message === 'Expense added' || message.startsWith('Expense added offline'))) {
      const title = document.getElementById('exp-title').value.trim();
      savedFeedback = {
        message:
          message === 'Expense added' ? `Saved ${title}.` : `Saved ${title} offline. Waiting to sync automatically.`,
        tone: message === 'Expense added' ? 'ok' : 'pending',
      };
    } else if (submitting && type === 'error') {
      showFeedback(message, 'error');
      submitting = false;
    }
    return originalToast(message, type);
  };

  window.webExpense = {
    isOpen: () => sheetOpen,
    closeSheet,
    refreshValidation: updateValidation,
    attach(main, state) {
      selectedDay = state.day;
      canAdd = state.canAdd;
      const changedTrip = tripId !== currentTrip?.id;
      tripId = currentTrip?.id;
      inlineMain = main;
      if (!sheetOpen) main.insertBefore(host, main.querySelector('#web-workspace-expenses-list'));
      host.hidden = !canAdd || !sheetOpen;
      if (!canAdd) closeSheet();
      if (canAdd) {
        if (changedTrip || !payer.options.length) resetForm();
        else {
          refreshDayOptions();
          if (!sheetOpen && selectedDay) daySelect.value = String(selectedDay);
          updateBrief();
          updateValidation();
        }
      }
    },
  };
  form.addEventListener('input', event => {
    if (event.target.id === 'exp-title' || event.target.id === 'exp-amount' || event.target.id.startsWith('split-')) {
      edited.add(validationKey(event.target));
      showFeedback('');
      updateValidation();
    }
  });
  form.addEventListener('focusout', event => {
    if (event.relatedTarget?.closest?.('[data-action="close-expense-screen"]')) return;
    const key = validationKey(event.target);
    if (fieldErrors[key] && (key !== 'exp-amount' || edited.has(key))) {
      touched.add(key);
      updateValidation();
    }
  });
  form.addEventListener('change', event => {
    if (event.target === category) selectExpenseCategory(category.value, { manual: true });
    if (event.target.id === 'web-expense-split') {
      setSplitType(event.target.value);
      if (event.target.value === 'exact') setDetails(true);
    }
    if (event.target === daySelect || event.target.id === 'web-expense-split') updateBrief();
    if (event.target.id === 'exp-currency' && splitType === 'exact') updateSplitRemainder();
    const key = validationKey(event.target);
    if (fieldErrors[key]) touched.add(key);
    updateValidation();
  });
  form.addEventListener('click', event => {
    if (event.target.closest('.split-type-btn')) {
      document.getElementById('web-expense-split').value = event.target.closest('.split-type-btn').dataset.type;
      touched.add('split');
      queueMicrotask(updateValidation);
    }
  });
  function blockInvalidSubmit(event) {
    const errors = Object.keys(fieldErrors)
      .map(key => [key, fieldError(key)])
      .filter(([, message]) => !!message);
    if (!errors.length) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    errors.forEach(([key]) => touched.add(key));
    updateValidation();
    document.getElementById(errors[0][0])?.focus({ preventScroll: true });
    return true;
  }
  save.addEventListener(
    'click',
    event => {
      blockInvalidSubmit(event);
    },
    true,
  );
  form.addEventListener(
    'submit',
    event => {
      if (blockInvalidSubmit(event)) return;
      submitting = true;
      showFeedback('');
      updateValidation();
    },
    true,
  );
  more.addEventListener('click', () => setDetails(details.hidden));
  phoneLayout.addEventListener('change', () => {
    placeAdvancedFields();
    setDetails(!details.hidden);
  });
  placeAdvancedFields();
  host.querySelector('.web-expense-backdrop').addEventListener('click', () => {
    if (sheetOpen) closeSheet();
  });
  document.addEventListener(
    'keydown',
    event => {
      if (!sheetOpen || document.querySelector('.modal.open')) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [
        ...host.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
        ),
      ].filter(element => element.getClientRects().length);
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) {
        event.preventDefault();
        focusable.at(-1).focus();
      } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
        event.preventDefault();
        focusable[0].focus();
      }
    },
    true,
  );
  if (currentTrip && document.body.dataset.screen === 'dashboard') renderExpensesTab();
})();
