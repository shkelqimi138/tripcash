// Landing page interactions for legal content, screenshots, and the protected contact form

const landingLegalCache = new Map();
const LEGAL_DOCUMENTS = {
  support: 'Help & support',
  privacy: 'Privacy Policy',
  terms: 'Terms of Use',
  'delete-account': 'Delete Your Account',
};
let landingLegalReturnFocus;
const TURNSTILE_BLOCKED_MESSAGE =
  'Bot protection couldn’t run. If you use an ad or privacy blocker, allow tripcash.de and challenges.cloudflare.com, then reload.';
const TRIPCASH_TURNSTILE_SITE_KEY = '0x4AAAAAAEm7OArk9r_5yrdA';
let contactTurnstileWidget;
let contactTurnstileFailed = false;
let turnstileApiPromise;
let contactTurnstilePromise;
const LEGAL_TAGS = new Set(['A', 'BR', 'H1', 'H2', 'HEADER', 'LI', 'OL', 'P', 'SPAN', 'STRONG', 'UL']);
const LEGAL_PAGE_PATHS = new Set(['/', '/index.html', ...Object.keys(LEGAL_DOCUMENTS).map(type => `/${type}.html`)]);

function sanitizeLegalNode(node) {
  if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
  if (node.nodeType !== Node.ELEMENT_NODE || !LEGAL_TAGS.has(node.tagName)) return document.createDocumentFragment();
  const safe = document.createElement(node.tagName.toLowerCase());
  const classes = [...node.classList].filter(name => /^[a-z0-9_-]+$/i.test(name));
  if (classes.length) safe.className = classes.join(' ');
  if (node.tagName === 'A') {
    try {
      const href = new URL(node.getAttribute('href') || '', location.origin);
      if (href.protocol === 'mailto:') {
        safe.href = href.href;
      } else if (href.origin === location.origin && LEGAL_PAGE_PATHS.has(href.pathname)) {
        safe.href = `${href.pathname}${href.hash}`;
      }
    } catch (_) {}
  }
  node.childNodes.forEach(child => safe.append(sanitizeLegalNode(child)));
  return safe;
}

function sanitizedLegalContent(legalPage) {
  const fragment = document.createDocumentFragment();
  legalPage.childNodes.forEach(child => fragment.append(sanitizeLegalNode(child)));
  return fragment;
}

function loadTurnstileApi() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (turnstileApiPromise) return turnstileApiPromise;
  turnstileApiPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.turnstile);
    script.onerror = () => {
      // Allow a later attempt to load again instead of reusing the failure.
      turnstileApiPromise = null;
      reject(new Error('Spam protection could not load.'));
    };
    document.head.append(script);
  });
  return turnstileApiPromise;
}

async function loadContactTurnstile() {
  if (window.Capacitor?.isNativePlatform?.() || !document.getElementById('contact-turnstile')) return;
  if (contactTurnstileWidget !== undefined) return;
  if (contactTurnstilePromise) return contactTurnstilePromise;
  contactTurnstilePromise = (async () => {
    try {
      await loadTurnstileApi();
      if (contactTurnstileWidget !== undefined) return;
      contactTurnstileWidget = window.turnstile.render('#contact-turnstile', {
        sitekey: TRIPCASH_TURNSTILE_SITE_KEY,
        action: 'contact',
        theme: 'auto',
        callback: () => {
          contactTurnstileFailed = false;
        },
        'error-callback': () => {
          contactTurnstileFailed = true;
          setContactStatus(TURNSTILE_BLOCKED_MESSAGE, true);
        },
        'unsupported-callback': () => {
          contactTurnstileFailed = true;
          setContactStatus(TURNSTILE_BLOCKED_MESSAGE, true);
        },
      });
    } catch (_) {
      contactTurnstileFailed = true;
      setContactStatus(TURNSTILE_BLOCKED_MESSAGE, true);
    }
  })().finally(() => {
    contactTurnstilePromise = null;
  });
  return contactTurnstilePromise;
}

function scheduleContactTurnstile() {
  const form = document.getElementById('landing-contact-form');
  const container = document.getElementById('contact-turnstile');
  if (!form || !container || window.Capacitor?.isNativePlatform?.()) return;
  let observer;
  const beginLoading = () => {
    observer?.disconnect();
    void loadContactTurnstile();
  };
  form.addEventListener('focusin', beginLoading, { once: true });
  if (!('IntersectionObserver' in window)) return beginLoading();
  observer = new IntersectionObserver(
    entries => {
      if (entries.some(entry => entry.isIntersecting)) beginLoading();
    },
    { rootMargin: '500px 0px' },
  );
  observer.observe(container);
}

async function openLandingLegal(type) {
  if (!Object.prototype.hasOwnProperty.call(LEGAL_DOCUMENTS, type)) return;
  const dialog = document.getElementById('landing-legal-dialog');
  const content = document.getElementById('landing-legal-content');
  const title = document.getElementById('landing-legal-title');
  if (!dialog || !content || !title) return;
  if (!dialog.open) {
    landingLegalReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  title.textContent = LEGAL_DOCUMENTS[type];
  content.innerHTML = '<p>Loading…</p>';
  if (!dialog.open) dialog.showModal();
  try {
    let legalTemplate = landingLegalCache.get(type);
    if (!legalTemplate) {
      const response = await fetch(`${type}.html`, { cache: 'no-store', headers: { Accept: 'text/html' } });
      if (!response.ok) throw new Error('Document unavailable');
      const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
      const legalPage = parsed.querySelector('.legal-page');
      if (!legalPage) throw new Error('Document unavailable');
      legalTemplate = document.createElement('template');
      legalTemplate.content.append(sanitizedLegalContent(legalPage));
      landingLegalCache.set(type, legalTemplate);
    }
    content.replaceChildren(legalTemplate.content.cloneNode(true));
    content.scrollTop = 0;
  } catch (_) {
    content.innerHTML = '<p>The document could not be loaded right now. Please close this window and try again.</p>';
  }
}

function closeLandingLegal() {
  document.getElementById('landing-legal-dialog')?.close();
}

const LANDING_SCREENSHOT_VIEWS = new Set(['trips', 'upcoming', 'expenses', 'balances', 'analytics', 'trip-analytics']);
let landingScreenshotReturnFocus;

function openLandingScreenshot(button) {
  if (window.Capacitor?.isNativePlatform?.() || !LANDING_SCREENSHOT_VIEWS.has(button.dataset.view)) return;
  const dialog = document.getElementById('landing-screenshot-dialog');
  const image = document.getElementById('landing-screenshot-image');
  if (!dialog || !image) return;
  landingScreenshotReturnFocus = button;
  document.getElementById('landing-screenshot-title').textContent =
    button.closest('figure')?.querySelector('figcaption b')?.textContent || 'TripCash screenshot';
  const preview = button.querySelector('img');
  image.alt = preview?.alt || 'TripCash app screenshot';
  image.dataset.fallback = preview?.src || '';
  image.dataset.themeImage = '';
  image.dataset.lightSrc = preview?.dataset.lightSrc || '';
  image.dataset.darkSrc = preview?.dataset.darkSrc || '';
  image.src = document.body.classList.contains('dark') ? image.dataset.darkSrc : image.dataset.lightSrc;
  dialog.dataset.zoom = '1';
  updateLandingScreenshotZoomControls();
  dialog.showModal();
  document.querySelector('.screenshot-dialog-close')?.focus();
}

function closeLandingScreenshot() {
  document.getElementById('landing-screenshot-dialog')?.close();
}

function updateLandingScreenshotZoomControls() {
  const dialog = document.getElementById('landing-screenshot-dialog');
  if (!dialog) return;
  const zoom = Number(dialog.dataset.zoom) || 1;
  document.getElementById('landing-screenshot-zoom').textContent = `${zoom * 100}%`;
  dialog.querySelector('[data-action="zoom-landing-screenshot-out"]').disabled = zoom === 1;
  dialog.querySelector('[data-action="zoom-landing-screenshot-in"]').disabled = zoom === 3;
}

function setLandingScreenshotZoom(direction) {
  const dialog = document.getElementById('landing-screenshot-dialog');
  if (!dialog?.open) return;
  dialog.dataset.zoom = String(Math.max(1, Math.min(3, (Number(dialog.dataset.zoom) || 1) + direction)));
  updateLandingScreenshotZoomControls();
}

function setContactStatus(message, isError = false) {
  const status = document.getElementById('contact-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', isError);
}

let contactValidator;
let contactSubmitting = false;

function setupContactValidation(form) {
  const ids = ['contact-name', 'contact-email', 'contact-subject', 'contact-message', 'contact-consent'];
  const touched = new Set();
  const fields = new Map();
  for (const id of ids) {
    const input = document.getElementById(id);
    const group = input.closest('.contact-field, .contact-consent');
    const error = document.createElement('p');
    error.id = `${id}-error`;
    error.className = 'contact-field-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    if (id === 'contact-consent') group.after(error);
    else group.append(error);
    input.setAttribute('aria-describedby', error.id);
    fields.set(id, { input, group, error });
  }
  const captchaError = document.createElement('p');
  captchaError.id = 'contact-turnstile-error';
  captchaError.className = 'contact-field-error';
  captchaError.setAttribute('role', 'alert');
  captchaError.hidden = true;
  document.getElementById('contact-turnstile').after(captchaError);

  function messageFor(id) {
    const input = fields.get(id).input;
    if (id === 'contact-name') return input.value.trim() ? '' : 'Enter your name.';
    if (id === 'contact-email')
      return !input.value.trim() ? 'Enter your email.' : input.validity.valid ? '' : 'Enter a valid email address.';
    if (id === 'contact-subject') return input.value ? '' : 'Choose a topic.';
    if (id === 'contact-message') return input.value.trim().length >= 10 ? '' : 'Write at least 10 characters.';
    if (id === 'contact-consent') return input.checked ? '' : 'Please agree so we can reply to your message.';
    return '';
  }
  function render(id) {
    const field = fields.get(id);
    const message = messageFor(id);
    const shown = touched.has(id) && !!message;
    field.error.textContent = shown ? `⚠ ${message}` : '';
    field.error.hidden = !shown;
    field.group.classList.toggle('has-error', shown);
    field.input.setAttribute('aria-invalid', String(shown));
    return message;
  }
  form.addEventListener('focusout', event => {
    if (!fields.has(event.target.id)) return;
    touched.add(event.target.id);
    render(event.target.id);
  });
  form.addEventListener('input', event => {
    if (fields.has(event.target.id) && touched.has(event.target.id)) render(event.target.id);
  });
  form.addEventListener('change', event => {
    if (!fields.has(event.target.id)) return;
    touched.add(event.target.id);
    render(event.target.id);
  });
  return {
    validateAll() {
      ids.forEach(id => touched.add(id));
      const invalid = ids.find(id => render(id));
      ids.forEach(render);
      if (invalid) fields.get(invalid).input.focus();
      return !invalid;
    },
    setCaptchaError(message) {
      captchaError.textContent = message ? `⚠ ${message}` : '';
      captchaError.hidden = !message;
    },
    clear() {
      touched.clear();
      ids.forEach(render);
      captchaError.textContent = '';
      captchaError.hidden = true;
    },
  };
}

async function submitLandingContact(event) {
  event.preventDefault();
  if (contactSubmitting) return;
  const form = event.currentTarget;
  const submit = document.getElementById('contact-submit');
  if (!contactValidator?.validateAll()) return;
  if (
    !window.turnstile ||
    contactTurnstileWidget === undefined ||
    !window.turnstile.getResponse(contactTurnstileWidget)
  ) {
    contactValidator.setCaptchaError(
      contactTurnstileFailed ? TURNSTILE_BLOCKED_MESSAGE : 'Complete the spam-protection check.',
    );
    return;
  }
  contactValidator.setCaptchaError('');
  const data = Object.fromEntries(new FormData(form).entries());
  contactSubmitting = true;
  submit.disabled = true;
  submit.classList.add('loading');
  submit.setAttribute('aria-busy', 'true');
  setContactStatus('Sending message…');
  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const error = new Error('Contact request failed');
      error.status = response.status;
      throw error;
    }
    form.reset();
    contactValidator.clear();
    document.getElementById('contact-opened-at').value = String(Date.now());
    document.getElementById('contact-character-count').textContent = '0';
    window.trackTripCashEvent?.('contact_submit_success', { contact_topic: data.subject });
    setContactStatus('Message sent. We will reply as soon as possible.');
  } catch (error) {
    setContactStatus(
      error.status === 429
        ? 'Too many messages right now. Please wait and try again.'
        : 'Message could not be sent. Please try again or email support@tripcash.de.',
      true,
    );
  } finally {
    if (window.turnstile && contactTurnstileWidget !== undefined) window.turnstile.reset(contactTurnstileWidget);
    submit.disabled = false;
    submit.classList.remove('loading');
    submit.removeAttribute('aria-busy');
    contactSubmitting = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('landing-contact-form');
  const message = document.getElementById('contact-message');
  const openedAt = document.getElementById('contact-opened-at');
  if (openedAt) openedAt.value = String(Date.now());
  if (form) contactValidator = setupContactValidation(form);
  scheduleContactTurnstile();
  form?.addEventListener('submit', submitLandingContact);
  message?.addEventListener('input', () => {
    const count = document.getElementById('contact-character-count');
    if (count) count.textContent = String(message.value.length);
  });
  document.getElementById('landing-legal-dialog')?.addEventListener('click', event => {
    if (event.target === event.currentTarget) closeLandingLegal();
  });
  document.getElementById('landing-legal-dialog')?.addEventListener('close', () => {
    landingLegalReturnFocus?.focus?.();
    landingLegalReturnFocus = null;
  });
  document.getElementById('landing-legal-content')?.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const href = new URL(link.href, location.href);
    if (href.pathname === '/' || href.pathname === '/index.html') {
      event.preventDefault();
      closeLandingLegal();
      return;
    }
    const documentType = Object.keys(LEGAL_DOCUMENTS).find(type => href.pathname === `/${type}.html`);
    if (!documentType) return;
    event.preventDefault();
    void openLandingLegal(documentType);
  });
  const screenshotDialog = document.getElementById('landing-screenshot-dialog');
  screenshotDialog?.addEventListener('click', event => {
    if (event.target === screenshotDialog) closeLandingScreenshot();
  });
  screenshotDialog?.addEventListener('close', () => {
    const image = document.getElementById('landing-screenshot-image');
    if (image) {
      image.dataset.fallback = '';
      delete image.dataset.themeImage;
      delete image.dataset.lightSrc;
      delete image.dataset.darkSrc;
      image.removeAttribute('src');
    }
    landingScreenshotReturnFocus?.focus();
    landingScreenshotReturnFocus = null;
  });
  document.getElementById('landing-screenshot-image')?.addEventListener('error', event => {
    const image = event.currentTarget;
    if (image.dataset.fallback && image.src !== image.dataset.fallback) image.src = image.dataset.fallback;
  });
});
