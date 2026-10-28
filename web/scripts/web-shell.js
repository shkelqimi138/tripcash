// Presentation-only web navigation. Native builds omit this file and its markup.
(() => {
  if (window.Capacitor?.isNativePlatform?.() || document.documentElement.classList.contains('native-shell')) return;
  const bar = document.getElementById('web-topbar');
  if (!bar) return;
  const globalNav = document.getElementById('app-bottom-nav');
  const tripNav = document.getElementById('trip-bottom-nav');
  const tripHeader = document.querySelector('#screen-dashboard .dash-header');
  const phoneLayout = window.matchMedia('(max-width: 760px)');
  function placeTripNav() {
    if (!tripNav || !tripHeader) return;
    if (phoneLayout.matches) document.body.append(tripNav);
    else tripHeader.append(tripNav);
  }
  placeTripNav();
  phoneLayout.addEventListener('change', placeTripNav);
  const byId = id => document.getElementById(id);
  const setText = (id, text) => {
    const el = byId(id);
    if (el.textContent !== text) el.textContent = text;
  };
  // Move, rather than duplicate, the existing synchronization controls.
  for (const id of ['offline-sync-status', 'btn-sync-now', 'btn-review-sync']) {
    const control = byId(id);
    if (control) byId('web-sync').append(control);
  }
  byId('btn-review-sync')?.setAttribute('aria-label', 'Review pending changes');
  if (byId('btn-review-sync')) byId('btn-review-sync').textContent = 'Review';
  let switcherKey = '';

  function update() {
    const screen = document.body.dataset.screen;
    const visible =
      !!window._currentUser && ['trips', 'dashboard', 'global-analytics', 'profile', 'expense'].includes(screen);
    bar.hidden = !visible;
    document.body.classList.toggle('web-redesign', visible);
    if (!visible) {
      bar.querySelectorAll('details[open]').forEach(el => {
        el.open = false;
      });
      return;
    }
    const active = screen === 'profile' ? 'profile' : screen === 'global-analytics' ? 'analytics' : 'trips';
    bar.querySelectorAll('.web-main-nav [data-nav]').forEach(btn => {
      if (btn.dataset.nav === active) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    });
    // A phone trip has its own bottom navigation; the global bar belongs to the
    // Trips list, all-trips Analytics, and Profile only.
    if (globalNav) {
      const showGlobal = ['trips', 'global-analytics', 'profile'].includes(screen);
      if (globalNav.hidden !== !showGlobal) globalNav.hidden = !showGlobal;
      globalNav.classList.toggle('visible', showGlobal);
      globalNav
        .querySelectorAll('[data-nav]')
        .forEach(btn => btn.classList.toggle('active', btn.dataset.nav === active));
    }
    byId('web-new-trip').hidden = screen !== 'trips';
    const name = window._currentProfile?.display_name || window._currentUser.email || 'Guest';
    setText('web-account-name', name);
    setText(
      'web-avatar',
      name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(word => word[0])
        .join('')
        .toUpperCase() || 'TC',
    );
    setText('web-theme-choice', `Theme: ${localStorage.getItem('tc-theme') || 'system'}`);

    const inTrip = !!currentTrip && ['dashboard', 'expense'].includes(screen);
    byId('web-trip-switcher').hidden = !inTrip;
    if (inTrip) {
      setText('web-trip-name', displayTripName(currentTrip.name));
      const trips = loadedTrips.filter(trip => trip.status === 'active' || trip.id === currentTrip.id);
      if (!trips.some(trip => trip.id === currentTrip.id)) trips.unshift(currentTrip);
      const key = JSON.stringify(trips.map(trip => [trip.id, trip.name, trip.id === currentTrip.id]));
      if (key !== switcherKey) {
        switcherKey = key;
        const buttons = trips.map(trip => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.action = 'open-trip';
          button.dataset.id = trip.id;
          button.textContent = displayTripName(trip.name);
          if (trip.id === currentTrip.id) button.setAttribute('aria-current', 'true');
          return button;
        });
        byId('web-trip-options').replaceChildren(...buttons);
      }
    }

    const pending = pendingOfflineChangeCount();
    const syncing = window.TripCashOffline?.isSyncing(window._currentUser.id) || false;
    const offline = navigator.onLine === false;
    const error = !!byId('offline-sync-status')?.classList.contains('error') && pending > 0;
    const state = offline ? 'offline' : syncing ? 'syncing' : error ? 'error' : pending ? 'pending' : 'synced';
    byId('web-sync').dataset.state = state;
    setText('web-sync-label', offline ? 'Offline' : 'Synced');
    byId('web-sync-label').hidden = !offline && (pending > 0 || syncing);
    byId('web-sync').title = state === 'synced' ? 'No device changes are waiting to sync.' : '';
  }

  const observer = new MutationObserver(update);
  observer.observe(document.body, { attributes: true, attributeFilter: ['data-screen', 'class'] });
  if (globalNav) observer.observe(globalNav, { attributes: true, attributeFilter: ['hidden', 'class'] });
  for (const id of ['offline-sync-status', 'btn-sync-now', 'header-user-label', 'dash-trip-name', 'trips-list']) {
    const target = byId(id);
    if (target)
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['hidden', 'class', 'disabled'],
      });
  }
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  document.addEventListener('click', event => {
    bar.querySelectorAll('details[open]').forEach(disclosure => {
      if (!disclosure.contains(event.target) || event.target.closest('button[data-action]')) disclosure.open = false;
    });
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    bar.querySelectorAll('details[open]').forEach(disclosure => {
      disclosure.open = false;
      disclosure.querySelector('summary').focus();
    });
  });
  update();
})();
