// Native-only shell adapter for the shared mobile presentation.
(() => {
  if (!window.Capacitor?.isNativePlatform?.()) return;
  window.TripCashNativeRedesign = true;

  const trips = document.getElementById('screen-trips');
  const tripsHeader = trips?.querySelector('.app-header');
  const dashboardHeader = document.querySelector('#screen-dashboard .dash-header');
  const tripNav = document.getElementById('trip-bottom-nav');
  const globalNav = document.getElementById('app-bottom-nav');
  if (!tripsHeader || !dashboardHeader || !tripNav || !globalNav) return;

  const phoneLayout = window.matchMedia('(max-width: 760px)');
  function placeTripNav() {
    if (phoneLayout.matches) document.body.append(tripNav);
    else dashboardHeader.append(tripNav); // Preserve the existing iPad chip layout.
    if (document.body.dataset.screen === 'dashboard') window.updateBottomNav('dashboard');
  }
  const newTrip = trips.querySelector('.trips-section-actions [data-action="open-new-trip-modal"]');
  if (newTrip) tripsHeader.append(newTrip);

  // Keep the existing offline controls reachable after hiding the old section row.
  const syncRow = document.createElement('div');
  syncRow.className = 'native-sync-row';
  for (const id of ['offline-sync-status', 'btn-sync-now', 'btn-review-sync']) {
    const control = document.getElementById(id);
    if (control) syncRow.append(control);
  }
  tripsHeader.after(syncRow);
  function updateSync() {
    const hidden = ![...syncRow.children].some(control => !control.hidden);
    if (syncRow.hidden !== hidden) syncRow.hidden = hidden;
  }
  new MutationObserver(updateSync).observe(syncRow, {
    attributes: true,
    attributeFilter: ['hidden', 'class'],
    subtree: true,
    childList: true,
  });

  const originalUpdateBottomNav = window.updateBottomNav;
  window.updateBottomNav = function (screen) {
    originalUpdateBottomNav(screen);
    if (!phoneLayout.matches && screen === 'dashboard' && currentTrip && window._currentUser) {
      globalNav.hidden = false;
      globalNav.classList.add('visible');
      globalNav
        .querySelectorAll('[data-nav]')
        .forEach(button => button.classList.toggle('active', button.dataset.nav === 'trips'));
    }
  };
  placeTripNav();
  phoneLayout.addEventListener('change', placeTripNav);

  function update() {
    const screen = document.body.dataset.screen;
    const visible = !!window._currentUser && ['trips', 'dashboard', 'global-analytics', 'profile'].includes(screen);
    document.body.classList.toggle('web-redesign', visible);
    document.body.classList.toggle('native-redesign', visible);
    if (visible) window.updateBottomNav(screen);
    updateSync();
  }
  new MutationObserver(update).observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });
  update();
})();
