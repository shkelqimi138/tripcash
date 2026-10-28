// Optional web-only Google Analytics. Never load it until the visitor chooses Allow.

const ANALYTICS_MEASUREMENT_ID = 'G-XMXSK9YW0E';
const ANALYTICS_CONSENT_KEY = 'tripcash-analytics-consent-v1';
const analyticsIsNative = Boolean(window.Capacitor?.isNativePlatform?.());
const analyticsIsPublicWebsite = !analyticsIsNative && document.body?.dataset.screen !== 'auth';

window[`ga-disable-${ANALYTICS_MEASUREMENT_ID}`] = true;

function analyticsPreference() {
  try {
    return localStorage.getItem(ANALYTICS_CONSENT_KEY);
  } catch (_) {
    return null;
  }
}

function saveAnalyticsPreference(value) {
  try {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, value);
  } catch (_) {}
}

function deleteAnalyticsCookies() {
  const expires = 'expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax';
  const domains = location.hostname.endsWith('.tripcash.de') ? ['', '; domain=.tripcash.de'] : [''];
  for (const cookie of document.cookie.split(';')) {
    const name = cookie.split('=')[0]?.trim();
    if (!name || (!name.startsWith('_ga') && !name.startsWith('_gid'))) continue;
    for (const domain of domains) document.cookie = `${name}=; ${expires}${domain}`;
  }
}

function loadGoogleAnalytics() {
  if (analyticsIsNative || window.__tripcashAnalyticsLoaded) return;
  window.__tripcashAnalyticsLoaded = true;
  window[`ga-disable-${ANALYTICS_MEASUREMENT_ID}`] = false;
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag() {
      window.dataLayer.push(arguments);
    };
  window.gtag('js', new Date());
  window.gtag('config', ANALYTICS_MEASUREMENT_ID, {
    allow_ad_personalization_signals: false,
    allow_google_signals: false,
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ANALYTICS_MEASUREMENT_ID)}`;
  script.onerror = () => {
    window.__tripcashAnalyticsLoaded = false;
  };
  document.head.append(script);
}

function trackTripCashEvent(name, parameters = {}) {
  if (analyticsIsNative || analyticsPreference() !== 'accepted' || typeof window.gtag !== 'function') return;
  window.gtag('event', name, parameters);
}

window.trackTripCashEvent = trackTripCashEvent;

function removeAnalyticsBanner() {
  document.getElementById('analytics-consent')?.remove();
}

function showAnalyticsBanner({ preferences = false } = {}) {
  if (analyticsIsNative || document.getElementById('analytics-consent')) return;
  const preference = analyticsPreference();
  const banner = document.createElement('section');
  banner.id = 'analytics-consent';
  banner.className = 'analytics-consent';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-modal', 'false');
  banner.setAttribute('aria-labelledby', 'analytics-consent-title');
  banner.innerHTML = `
    <div class="analytics-consent-copy">
      <h2 id="analytics-consent-title">${preferences ? 'Analytics preferences' : 'Optional analytics'}</h2>
      <p>TripCash uses Google Analytics only if you allow it, to understand how the public website is used. It is not needed to use TripCash and is never used for advertising.</p>
      <a href="/privacy.html">Read the Privacy Policy</a>
    </div>
    <div class="analytics-consent-actions">
      <button type="button" class="analytics-consent-reject" data-analytics-consent="rejected">Reject analytics</button>
      <button type="button" class="analytics-consent-accept" data-analytics-consent="accepted">Allow analytics</button>
    </div>`;
  if (preference) banner.dataset.preference = preference;
  document.body.append(banner);
}

function applyAnalyticsChoice(choice) {
  saveAnalyticsPreference(choice);
  if (choice === 'accepted') {
    loadGoogleAnalytics();
  } else {
    window[`ga-disable-${ANALYTICS_MEASUREMENT_ID}`] = true;
    deleteAnalyticsCookies();
  }
  removeAnalyticsBanner();
}

document.addEventListener('click', event => {
  const choice = event.target.closest?.('[data-analytics-consent]')?.dataset.analyticsConsent;
  if (choice === 'accepted' || choice === 'rejected') {
    applyAnalyticsChoice(choice);
    return;
  }
  if (event.target.closest?.('[data-analytics-preferences]')) {
    showAnalyticsBanner({ preferences: true });
    return;
  }
  const cta = event.target.closest?.('#landing-primary-action, .landing-final button');
  if (cta) trackTripCashEvent('cta_click', { cta_location: cta.id ? 'hero' : 'final' });
});

if (analyticsIsPublicWebsite) {
  if (analyticsPreference() === 'accepted') loadGoogleAnalytics();
  else if (!analyticsPreference()) showAnalyticsBanner();
}
