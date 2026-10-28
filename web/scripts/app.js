// app.js — TripCash
// Relies on: db (supabase.js), auth.js loaded before this

// Mark native shells without changing the deployed website. WKWebView zooms the
// whole page when a small form control receives focus, so only iOS receives the
// locked viewport; Android keeps normal font and accessibility scaling.
function configureNativeShell() {
  const capacitor = window.Capacitor;
  const platform = capacitor?.getPlatform?.() || 'web';
  if (platform === 'web') return;

  document.documentElement.classList.add('native-shell', `native-${platform}`);
  const welcomeAction = document.getElementById('landing-primary-action');
  if (welcomeAction) welcomeAction.innerHTML = 'Continue to app <span>→</span>';
  if (platform !== 'ios') return;

  const viewport = document.querySelector('meta[name="viewport"]');
  viewport?.setAttribute(
    'content',
    'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
  );
}

configureNativeShell();

function runDeclarativeAction(element) {
  const { action, value, id, name, memberId, paypal, from, to, amount, section } = element.dataset;
  switch (action) {
    case 'open-landing-legal':
      return openLandingLegal(value);
    case 'close-landing-legal':
      return closeLandingLegal();
    case 'open-landing-screenshot':
      return openLandingScreenshot(element);
    case 'close-landing-screenshot':
      return closeLandingScreenshot();
    case 'zoom-landing-screenshot-in':
      return setLandingScreenshotZoom(1);
    case 'zoom-landing-screenshot-out':
      return setLandingScreenshotZoom(-1);
    case 'enter-web-app':
      return enterWebApp(value);
    case 'leave-web-app':
      return leaveWebApp();
    case 'switch-auth-tab':
      return switchAuthTab(value);
    case 'reset-registration':
      return resetRegistrationForm();
    case 'open-forgot-password':
      return openForgotPassword();
    case 'handle-guest-start':
      return handleGuestStart();
    case 'social-login':
      return startSocialLogin(value);
    case 'go-to-trips':
      return goToTrips();
    case 'sync-offline-now':
      return syncAfterReconnect();
    case 'review-offline-changes':
      return reviewOfflineChanges();
    case 'toggle-theme':
      return toggleTheme();
    case 'open-account-settings':
      return openAccountSettings(section);
    case 'handle-logout':
      return handleLogout();
    case 'open-modal':
      return openModal(value);
    case 'close-modal':
      return closeModal(value);
    case 'open-new-trip-modal':
      return openNewTripModal();
    case 'return-from-profile':
      return returnFromProfile();
    case 'open-analytics-view':
      return openAnalyticsView();
    case 'open-profile-view':
      return openProfileView();
    case 'switch-tab':
      return switchTab(value);
    case 'close-expense-screen':
      return window.closeExpenseScreen();
    case 'select-expense-category':
      return selectExpenseCategory(value);
    case 'set-split-type':
      return setSplitType(value);
    case 'delete-account':
      return deleteAccount();
    case 'export-account-data':
      return exportAccountData();
    case 'delete-account-data':
      return deleteAccountData();
    case 'cancel-password-recovery':
      return cancelPasswordRecovery();
    case 'resolve-confirm':
      return resolveConfirm(value === 'true');
    case 'open-trip':
      return openTrip(id);
    case 'copy-invite':
      return copyInvite(value);
    case 'rotate-invite':
      return rotateInvite();
    case 'open-add-expense-modal':
      return window.openAddExpenseModal();
    case 'open-expense-action-sheet':
      return window.openExpenseActionSheet?.();
    case 'open-receipt-picker':
      return window.openReceiptPicker?.();
    case 'open-edit-trip-modal':
      return openEditTripModal();
    case 'export-csv':
      return exportCSV();
    case 'open-end-trip-modal':
      return openEndTripModal();
    case 'delete-trip':
      return deleteTrip();
    case 'set-expense-filter':
      return setExpenseFilter(value);
    case 'delete-expense':
      return deleteExpense(id);
    case 'open-settle-day-modal':
      return openSettleDayModal(Number(value));
    case 'toggle-day-section':
      return toggleDaySection(element);
    case 'set-analytics-mode':
      return setAnalyticsMode(value);
    case 'add-member-from-contact':
      return addMemberFromContact(name);
    case 'add-member':
      return addMember();
    case 'delete-member':
      return deleteMember(id);
    case 'leave-trip':
      return leaveTrip();
    case 'edit-paypal-link':
      return editPaypalLink(memberId, paypal);
    case 'edit-member-name':
      return editMemberName(memberId, name);
    case 'open-payment-modal':
      return openPaymentModal(from, to, Number(amount));
    case 'delete-payment':
      return deletePayment(id);
    case 'focus-new-member':
      return document.getElementById('new-member-name')?.focus();
    case 'settle-all-balances':
      return settleAllBalances();
    case 'open-change-password':
      return openChangePassword();
    case 'toggle-profile-theme':
      toggleTheme();
      return renderProfileScreen();
    case 'select-emoji':
      return selectEmoji(value);
    case 'select-expense-payer':
      return selectExpensePayer(id);
    default:
      return undefined;
  }
}

document.addEventListener('click', event => {
  const element = event.target.closest?.('[data-action]');
  if (element) runDeclarativeAction(element);
});

document.addEventListener('keydown', event => {
  if (!['Enter', ' '].includes(event.key)) return;
  const element = event.target.closest?.('[data-action][role="button"]');
  if (!element) return;
  event.preventDefault();
  runDeclarativeAction(element);
});

document.addEventListener('change', event => {
  const element = event.target.closest?.('[data-change-action]');
  if (!element) return;
  switch (element.dataset.changeAction) {
    case 'update-expense-currency':
      updateExpenseCurrencyUI();
      renderSplitSection();
      break;
    case 'set-display-currency':
      setDisplayCurrency(element.value);
      break;
    case 'set-global-analytics-currency':
      setGlobalAnalyticsCurrency(element.value);
      break;
    case 'save-profile-preference':
      saveProfilePreference(element.dataset.key, element.value);
      break;
    case 'toggle-split-member':
      toggleSplitMember(element.dataset.id, element.checked);
      break;
  }
});

document.addEventListener('input', event => {
  if (event.target.closest?.('[data-input-action="update-split-remainder"]')) updateSplitRemainder();
});

// ─── State ────────────────────────────────────────────────────
let currentTrip = null; // full trip row
let currentMembers = []; // members rows (named people)
let currentExpenses = []; // all expenses for the trip
let currentSplits = []; // all expense_splits for the trip
let currentPayments = []; // all payments for the trip
let currentSettled = []; // settled day_numbers
let currentContacts = []; // user's saved contacts
let currentInviteToken = null;
let currentTab = 'overview';
let expenseFilter = 'all';
let analyticsMode = 'category';
let profileReturn = 'trips';
let loadedTrips = [];
let pendingTripTab = null;
let tripsLoadPromise = null;
let globalAnalyticsPromise = null;
let openingTripPromise = null;
let openingTripId = null;
let tripRouteIntentId = null;
let reconnectSyncPromise = null;
const tripViewCache = new Map();
const activityCache = new Map();
const activityLoadPromises = new Map();
const activityFetchedAt = new Map();
let modalScrollY = 0;
let selectedEmoji = '✈️';
let editingTripId = null;
let splitType = 'equal';
let expSplitChecked = {}; // equal split: member_id → boolean
let expenseCategoryManuallySelected = false;
let nativeKeyboardVisible = false;
let nativeKeyboardHeight = 0;
let nativeKeyboardInsetRule = null;
let nativeFormControlFocused = false;
let nativeFormBlurTimer = null;
let nativeKeyboardListenerSetupFailed = false;
let nativeRefreshGesture = null;
let nativeRefreshInFlight = false;
let nativePullToRefreshConfigured = false;

const NATIVE_REFRESH_THRESHOLD = 180;
const NATIVE_REFRESH_MIN_PULL_MS = 320;
const NATIVE_REFRESH_SCREENS = new Set(['trips', 'dashboard', 'global-analytics', 'profile']);

const EMOJIS = ['✈️', '🏖️', '🏔️', '🎉', '🚗', '🍕', '⛺', '🧳', '🎸', '🚢', '🌍', '🏕️', '🎡', '🎈', '🍻'];
const CURRENCY_SYMBOLS = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  CHF: '₣',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  JPY: '¥',
  AUD: 'A$',
  CAD: 'C$',
};
Object.assign(CURRENCY_SYMBOLS, { EUR: 'EUR ', USD: '$', GBP: 'GBP ', CHF: 'CHF ', ALL: 'ALL ' });
const SUPPORTED_CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP', 'ALL'];
const EXCHANGE_API_BASE = 'https://open.er-api.com/v6/latest';
const EXCHANGE_REQUEST_TIMEOUT_MS = 8000;
const EXCHANGE_RATE_STORAGE_KEY = 'tc-exchange-rates-v1';
const MAX_EXPENSE_AMOUNT = 99999999.99;
const MAX_TRIP_BUDGET = 9999999999.99;
const PUBLIC_APP_URL = 'https://tripcash.de/app';
const exchangeRateCache = {};
const displayCurrencyRates = {};
const fallbackExchangeRateKeys = new Set();

const CATEGORIES = {
  food: '🍔',
  drinks: '🍺',
  transport: '🚗',
  hotel: '🏨',
  activities: '🎭',
  other: '📦',
};
const CAT_COLORS = {
  food: '#14BBA6',
  drinks: '#22C55E',
  transport: '#3B82F6',
  hotel: '#8B5CF6',
  activities: '#F59E0B',
  other: '#64748B',
};
function categoryClass(category) {
  return Object.hasOwn(CAT_COLORS, category) ? `cat-${category}` : 'cat-other';
}
function renderExpenseCategoryIcon(category) {
  const icons = {
    food: '<path d="M7 3v8M11 3v8M7 7h4M9 11v10M15 3v7a3 3 0 0 0 3 3V3M18 13v8"/>',
    drinks: '<path d="M4 7h12v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4Z"/><path d="M16 9h2a3 3 0 0 1 0 6h-2M7 3v4M11 3v4"/>',
    transport:
      '<path d="M5 16h14l-1.5-7a3 3 0 0 0-3-2.4h-5a3 3 0 0 0-3 2.4Z"/><path d="M3 16h18v3H3zM6 19v2M18 19v2M7 12h.01M17 12h.01"/>',
    hotel: '<path d="M4 21V5h16v16M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01M10 21v-4h4v4"/>',
    activities:
      '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7Z"/>',
    other: '<path d="m4 7 8-4 8 4-8 4Z"/><path d="M4 7v10l8 4 8-4V7M12 11v10"/>',
  };
  return `<svg class="expense-category-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${icons[category] || icons.other}</svg>`;
}
const CAT_KEYWORDS = {
  food: [
    'food',
    'eat',
    'lunch',
    'dinner',
    'breakfast',
    'restaurant',
    'pizza',
    'burger',
    'groceries',
    'market',
    'snack',
    'ushqim',
    'dreke',
    'drek',
    'darka',
    'darke',
    'mengjes',
  ],
  drinks: [
    'drink',
    'bar',
    'beer',
    'wine',
    'coffee',
    'cafe',
    'cocktail',
    'kafe',
    'kafja',
    'uje',
    'uji',
    'pije',
    'birre',
    'vere',
    'koktej',
  ],
  transport: [
    'taxi',
    'uber',
    'bus',
    'train',
    'metro',
    'flight',
    'gas',
    'fuel',
    'car',
    'ferry',
    'rental',
    'taksi',
    'autobus',
    'tren',
    'naft',
    'nafte',
    'benzine',
    'karburant',
    'parking',
    'traget',
    'makine',
  ],
  hotel: [
    'hotel',
    'hostel',
    'airbnb',
    'accommodation',
    'room',
    'apartment',
    'lodging',
    'banesa',
    'banese',
    'apartament',
    'dhome',
    'fjetje',
    'kamping',
  ],
  activities: [
    'tour',
    'museum',
    'park',
    'show',
    'concert',
    'activity',
    'entry',
    'beach',
    'pool',
    'gym',
    'tur',
    'muze',
    'ekskursion',
    'koncert',
    'plazh',
    'hyrje',
    'aktivitet',
  ],
  other: ['qadra', 'qader', 'cadra', 'cader', 'ombrelle', 'sunbed', 'sunbeds', 'shezelong', 'shezelonge'],
};
const CATEGORY_PHRASES = [
  {
    category: 'hotel',
    phrases: ['cader kampingu', 'cadra kampingu', 'qader kampingu', 'qadra kampingu', 'camping tent'],
  },
  {
    category: 'transport',
    phrases: [
      'bilete treni',
      'bilete autobusi',
      'bilete avioni',
      'bilete trageti',
      'train ticket',
      'bus ticket',
      'flight ticket',
      'ferry ticket',
    ],
  },
  {
    category: 'activities',
    phrases: ['bilete muzeu', 'bilete koncerti', 'bilete hyrjeje', 'museum ticket', 'concert ticket', 'entry ticket'],
  },
];

function normalizeCurrency(currency) {
  return SUPPORTED_CURRENCIES.includes(currency) ? currency : 'EUR';
}

const PROFILE_PREFERENCE_FIELDS = {
  'tc-home-currency': 'home_currency',
  'tc-default-split': 'default_split',
  'tc-theme': 'theme_preference',
};

function normalizeProfilePreference(key, value) {
  if (key === 'tc-home-currency') return normalizeCurrency(value);
  if (key === 'tc-default-split') return ['equal', 'exact'].includes(value) ? value : 'equal';
  if (key === 'tc-theme') return ['system', 'light', 'dark'].includes(value) ? value : 'system';
  return null;
}

function localProfilePreferences() {
  return {
    home_currency: normalizeProfilePreference('tc-home-currency', localStorage.getItem('tc-home-currency')),
    default_split: normalizeProfilePreference('tc-default-split', localStorage.getItem('tc-default-split')),
    theme_preference: normalizeProfilePreference('tc-theme', localStorage.getItem('tc-theme')),
  };
}

function applyProfilePreferences(profile = window._currentProfile) {
  const local = localProfilePreferences();
  const pending = window.TripCashOffline?.pendingProfileValues(window._currentUser?.id) || {};
  const candidates = { ...local, ...(profile || {}), ...pending };
  const values = {
    home_currency: normalizeProfilePreference('tc-home-currency', candidates.home_currency),
    default_split: normalizeProfilePreference('tc-default-split', candidates.default_split),
    theme_preference: normalizeProfilePreference('tc-theme', candidates.theme_preference),
  };

  localStorage.setItem('tc-home-currency', values.home_currency);
  localStorage.setItem('tc-default-split', values.default_split);
  localStorage.setItem('tc-theme', values.theme_preference);
  splitType = values.default_split;
  applyTheme(values.theme_preference);
  if (profile) Object.assign(profile, values);
  return values;
}

function normalizeCategoryText(value) {
  return String(value || '')
    .toLocaleLowerCase('sq')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function suggestExpenseCategory(value) {
  const normalized = normalizeCategoryText(value);
  if (!normalized) return null;

  for (const rule of CATEGORY_PHRASES) {
    if (rule.phrases.some(phrase => normalized.includes(phrase))) return rule.category;
  }

  const words = new Set(normalized.split(/\s+/));
  for (const [category, keywords] of Object.entries(CAT_KEYWORDS)) {
    if (
      keywords.some(keyword =>
        keyword.includes(' ')
          ? normalized.includes(keyword)
          : [...words].some(word => word === keyword || (keyword.length >= 4 && word.startsWith(keyword))),
      )
    )
      return category;
  }
  return null;
}

function currencyOptions(selected) {
  const labels = {
    EUR: 'EUR - Euro',
    USD: 'USD - US dollar',
    CHF: 'CHF - Swiss franc',
    GBP: 'GBP - British pound',
    ALL: 'ALL - Albanian lek',
  };
  return SUPPORTED_CURRENCIES.map(
    c => `<option value="${c}"${c === selected ? ' selected' : ''}>${labels[c]}</option>`,
  ).join('');
}

function moneySymbol(currency) {
  return CURRENCY_SYMBOLS[normalizeCurrency(currency)] || `${esc(currency)} `;
}

function formatMoney(amount, currency) {
  const value = Number(amount) || 0;
  const locale = typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-GB';
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  return `${moneySymbol(currency)}${number}`;
}

function normalizePaypalLink(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (host !== 'paypal.me' && host !== 'www.paypal.me')) return null;
    return url.href;
  } catch (_) {
    return null;
  }
}

const GENERIC_TRIP_NAMES = new Set(['test', 'total', 'trip', 'new trip', 'untitled']);
function normalizeTripName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}
function isMeaningfulTripName(value) {
  const name = normalizeTripName(value);
  return name.length >= 3 && /[\p{L}\p{N}]/u.test(name) && !GENERIC_TRIP_NAMES.has(name.toLowerCase());
}
function displayTripName(value) {
  const name = normalizeTripName(value);
  return name || 'Untitled trip';
}

function formatTripDateRange(trip) {
  const format = value =>
    value
      ? new Date(`${value}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      : '';
  const start = format(trip?.start_date);
  const end = format(trip?.end_date);
  if (start && end) return `${start} – ${end}`;
  return start || end;
}

function formatTripDayLabel(trip, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trip?.start_date || '')) return `Day ${day}`;
  const date = new Date(`${trip.start_date}T12:00:00`);
  date.setDate(date.getDate() + Number(day) - 1);
  return `Day ${day} · ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parseMoneyInput(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(',', '.');
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return NaN;
  return Number(normalized);
}

function allocateRoundedSplits(total, weightedMembers) {
  const members = weightedMembers
    .map((item, index) => ({ ...item, index, weight: Number(item.weight) || 0 }))
    .filter(item => item.weight > 0);
  const totalWeight = members.reduce((sum, item) => sum + item.weight, 0);
  const totalCents = Math.round((Number(total) || 0) * 100);
  if (!members.length || totalWeight <= 0 || totalCents <= 0) return [];

  const allocated = members.map(item => {
    const rawCents = (totalCents * item.weight) / totalWeight;
    const cents = Math.floor(rawCents);
    return { ...item, cents, fraction: rawCents - cents };
  });
  let remaining = totalCents - allocated.reduce((sum, item) => sum + item.cents, 0);
  const remainderOrder = [...allocated].sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; remaining > 0; index += 1, remaining -= 1) {
    remainderOrder[index % remainderOrder.length].cents += 1;
  }

  return allocated
    .sort((a, b) => a.index - b.index)
    .map(item => ({ member_id: item.member_id, amount: item.cents / 100 }));
}

function getDisplayCurrency() {
  if (!currentTrip) return 'EUR';
  return normalizeCurrency(
    localStorage.getItem(`tc-display-currency-${currentTrip.id}`) ||
      localStorage.getItem('tc-home-currency') ||
      currentTrip.currency,
  );
}

async function setDisplayCurrency(currency) {
  if (!currentTrip) return;
  localStorage.setItem(`tc-display-currency-${currentTrip.id}`, normalizeCurrency(currency));
  await ensureDisplayRate();
  switchTab(currentTab);
}

function displayAmount(amount) {
  const tripCurrency = normalizeCurrency(currentTrip?.currency);
  const displayCurrency = getDisplayCurrency();
  const rate = tripCurrency === displayCurrency ? 1 : displayCurrencyRates[`${tripCurrency}-${displayCurrency}`] || 1;
  return roundMoney(amount * rate);
}

function renderDisplayCurrencyControl() {
  const selected = getDisplayCurrency();
  const compactOptions = SUPPORTED_CURRENCIES.map(
    currency => `<option value="${currency}"${currency === selected ? ' selected' : ''}>${currency}</option>`,
  ).join('');
  return `<div class="currency-control">
    <label for="display-currency">Show totals in</label>
    <select id="display-currency" data-change-action="set-display-currency">
      ${compactOptions}
    </select>
  </div>`;
}

function readStoredExchangeRates() {
  try {
    const value = JSON.parse(localStorage.getItem(EXCHANGE_RATE_STORAGE_KEY) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (_) {
    return {};
  }
}

function storedExchangeRate(key) {
  const entry = readStoredExchangeRates()[key];
  const rate = Number(entry?.rate);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

function storeExchangeRate(key, rate) {
  try {
    const stored = readStoredExchangeRates();
    stored[key] = { rate, updatedAt: new Date().toISOString() };
    localStorage.setItem(EXCHANGE_RATE_STORAGE_KEY, JSON.stringify(stored));
  } catch (_) {}
}

async function getExchangeRate(fromCurrency, toCurrency) {
  const from = normalizeCurrency(fromCurrency);
  const to = normalizeCurrency(toCurrency);
  if (from === to) return 1;
  const key = `${from}-${to}`;
  if (exchangeRateCache[key]) return exchangeRateCache[key];
  const fallbackRate = storedExchangeRate(key);
  if (navigator.onLine === false && fallbackRate) {
    exchangeRateCache[key] = fallbackRate;
    fallbackExchangeRateKeys.add(key);
    return fallbackRate;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EXCHANGE_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${EXCHANGE_API_BASE}/${encodeURIComponent(from)}`, { signal: controller.signal });
    if (!res.ok) throw new Error('Exchange rate service is unavailable.');
    const data = await res.json();
    const rate = Number(data?.rates?.[to]);
    if (!rate) throw new Error(`No exchange rate found for ${from} to ${to}.`);
    exchangeRateCache[key] = rate;
    fallbackExchangeRateKeys.delete(key);
    storeExchangeRate(key, rate);
    return rate;
  } catch (error) {
    if (!fallbackRate) {
      if (error?.name === 'AbortError') throw new Error('Exchange rate request timed out.', { cause: error });
      throw error;
    }
    exchangeRateCache[key] = fallbackRate;
    fallbackExchangeRateKeys.add(key);
    return fallbackRate;
  } finally {
    clearTimeout(timeout);
  }
}

async function ensureDisplayRate() {
  if (!currentTrip) return;
  const from = normalizeCurrency(currentTrip.currency);
  const to = getDisplayCurrency();
  if (from === to || displayCurrencyRates[`${from}-${to}`]) return;
  try {
    displayCurrencyRates[`${from}-${to}`] = await getExchangeRate(from, to);
  } catch (_) {
    localStorage.setItem(`tc-display-currency-${currentTrip.id}`, from);
    showToast('Could not load live exchange rate.', 'error');
  }
}

function originalExpenseAmount(exp) {
  return Number(exp.original_amount || exp.amount) || 0;
}

function originalExpenseCurrency(exp) {
  return normalizeCurrency(exp.currency || exp.original_currency || currentTrip?.currency);
}

function convertedExpenseAmount(exp) {
  return Number(exp.amount) || 0;
}

function renderExpenseAmount(exp) {
  const tripCurrency = normalizeCurrency(currentTrip.currency);
  const originalCurrency = originalExpenseCurrency(exp);
  const originalAmount = originalExpenseAmount(exp);
  const convertedAmount = convertedExpenseAmount(exp);
  if (originalCurrency === tripCurrency) return formatMoney(convertedAmount, tripCurrency);
  return `${formatMoney(originalAmount, originalCurrency)} <span class="exp-converted">${formatMoney(convertedAmount, tripCurrency)}</span>`;
}

// ─── Boot ─────────────────────────────────────────────────────
function onUserReady() {
  const user = window._currentUser;
  if (!user) return;

  applyProfilePreferences(window._currentProfile);
  restoreTripsCache();
  updateOfflineSyncControls();

  // Theme
  applyTheme(localStorage.getItem('tc-theme') || 'system');

  // Header user label — prefer display name from profile
  const labelEl = document.getElementById('header-user-label');
  if (labelEl) labelEl.textContent = window._currentProfile?.display_name || user.email || 'Guest';

  // Greeting
  const greetingEl = document.getElementById('trips-greeting');
  if (greetingEl) {
    const name = window._currentProfile?.display_name || user.email?.split('@')[0] || 'there';
    greetingEl.innerHTML = `<div><div class="greeting-title">Hello, <span>${esc(name)}</span></div><div class="greeting-sub">Where to next?</div></div>`;
  }

  // Guest banner
  const banner = document.getElementById('guest-banner');
  if (banner) banner.hidden = !isAnonymousAuthUser(user);

  // Route from URL
  const hash = location.hash.slice(1);
  const invite = new URLSearchParams(location.search).get('invite');

  if (invite) {
    handleInvite(invite);
  } else if (hash.startsWith('trip/')) {
    const id = hash.split('/')[1];
    openTrip(id);
  } else {
    showScreen('trips');
    loadTrips();
    resumePendingAccountDeletion(user);
  }
}

// ─── Routing ──────────────────────────────────────────────────
function goToTrips() {
  tripRouteIntentId = null;
  history.pushState(null, '', location.pathname);
  currentTrip = null;
  showScreen('trips');
  loadTrips();
}

function showScreen(name) {
  if (window._passwordRecoveryPending && !['auth', 'loading'].includes(name)) name = 'auth';
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${name}`)?.classList.add('active');
  document.body.dataset.screen = name;
  updateNativeStatusBar(name);
  updateBottomNav(name);
}

function isWebAppPath() {
  if (window.Capacitor?.isNativePlatform?.()) return false;
  return ['/app', '/app.html'].includes(location.pathname.replace(/\/$/, '') || '/');
}

function isWebLandingPath() {
  if (window.Capacitor?.isNativePlatform?.()) return false;
  return ['/', '/index.html'].includes(location.pathname);
}

function hasWebAuthIntent() {
  const query = new URLSearchParams(location.search);
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  return Boolean(
    query.get('invite') ||
    query.get('code') ||
    query.get('token_hash') ||
    query.get('type') ||
    hash.get('access_token') ||
    hash.get('refresh_token') ||
    hash.get('type'),
  );
}

function moveWebIntentToAppPath() {
  if (!isWebLandingPath() || !hasWebAuthIntent()) return;
  history.replaceState(null, '', `/app${location.search}${location.hash}`);
}

function enterWebApp(tab = 'login') {
  if (!window.Capacitor?.isNativePlatform?.() && !isWebAppPath()) {
    history.pushState(null, '', '/app');
  }
  if (window._currentUser) onUserReady();
  else openAuthMode(tab);
}

function leaveWebApp() {
  if (!window.Capacitor?.isNativePlatform?.() && isWebAppPath()) {
    history.replaceState(null, '', '/');
  }
  showScreen('welcome');
}

function openAuthMode(tab = 'login') {
  showScreen('auth');
  switchAuthTab(tab);
}

function handleNativeBackButton() {
  const activeElement = document.activeElement;
  const formControlFocused = activeElement?.matches?.('input, textarea, select, [contenteditable="true"]');
  if (nativeKeyboardVisible || nativeFormControlFocused || formControlFocused) {
    activeElement?.blur?.();
    window.Capacitor?.Plugins?.Keyboard?.hide();
    return;
  }

  // Legal information is displayed as an in-app dialog from Profile.  Close it
  // before considering screen navigation so Android Back never drops someone
  // out of Profile after reading a policy.
  const legalDialog = document.getElementById('landing-legal-dialog');
  if (legalDialog?.open) {
    closeLandingLegal();
    return;
  }

  const openModals = [...document.querySelectorAll('.modal.open')];
  const topModal = openModals.at(-1);
  if (topModal) {
    if (topModal.id === 'modal-new-password' && window._passwordRecoveryPending) return;
    if (topModal.id === 'modal-confirm') resolveConfirm(false);
    else closeModal(topModal.id);
    return;
  }

  if (window.webExpense?.isOpen?.()) {
    window.webExpense.closeSheet();
    return;
  }

  const screen = document.body.dataset.screen;
  if (screen === 'expense') {
    closeExpenseScreen();
    return;
  }
  if (screen === 'auth') {
    if (!window._passwordRecoveryPending) showScreen('welcome');
    return;
  }
  if (screen === 'dashboard') {
    goToTrips();
    return;
  }
  if (screen === 'profile') {
    returnFromProfile();
    return;
  }
  if (screen === 'global-analytics' || screen === 'not-found') {
    if (window._currentUser) goToTrips();
    else showScreen('welcome');
    return;
  }
  if (screen === 'loading') return;

  window.Capacitor?.Plugins?.App?.exitApp();
}

function reportNativeKeyboardError(error) {
  if (nativeKeyboardListenerSetupFailed) return;
  nativeKeyboardListenerSetupFailed = true;
  void error;
}

function keepFocusedControlVisible() {
  const control = document.activeElement;
  if (!control?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
  if (!control.closest('.modal.open, #web-expense-host, #screen-auth')) return;
  // On the sign-in screens, also reveal the form's button (Continue, Log in) when
  // it fits above the keyboard together with the field. On longer forms such as
  // Create account it does not, and scrolling to it would pin the field to the top.
  const authSubmit = control.closest('.modal.open')
    ? null
    : control.closest('#screen-auth form')?.querySelector('button[type="submit"]');
  try {
    if (authSubmit?.offsetParent) {
      const visibleHeight = (window.visualViewport?.height || window.innerHeight) - nativeKeyboardHeight - 24;
      const span = authSubmit.getBoundingClientRect().bottom - control.getBoundingClientRect().top;
      if (span <= visibleHeight) authSubmit.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
    }
    control.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
  } catch (error) {
    try {
      control.scrollIntoView(false);
    } catch (fallbackError) {
      reportNativeKeyboardError(fallbackError || error);
    }
  }
}

function setNativeKeyboardHeight(height) {
  const measured = Number(height);
  nativeKeyboardHeight = Number.isFinite(measured) && measured > 0 ? Math.round(measured) : 0;
  try {
    if (!nativeKeyboardInsetRule) {
      for (const sheet of document.styleSheets) {
        let rules;
        try {
          rules = sheet.cssRules;
        } catch (_) {
          continue;
        }
        const rule = Array.from(rules || []).find(
          candidate => candidate.selectorText === 'html.native-ios.native-keyboard-open',
        );
        if (rule) {
          nativeKeyboardInsetRule = rule;
          break;
        }
      }
    }
    nativeKeyboardInsetRule?.['style']?.setProperty('--native-keyboard-height', `${nativeKeyboardHeight}px`);
  } catch (error) {
    reportNativeKeyboardError(error);
  }
}

function setNativeKeyboardOpen(open, height = nativeKeyboardHeight) {
  nativeKeyboardVisible = open;
  setNativeKeyboardHeight(open ? height : 0);
  document.documentElement.classList.toggle('native-keyboard-open', open);
  if (open) {
    requestAnimationFrame(() => requestAnimationFrame(keepFocusedControlVisible));
    setTimeout(keepFocusedControlVisible, 300);
  }
}

function registerNativeKeyboardListener(eventName, handler) {
  try {
    const registration = window.Capacitor?.Plugins?.Keyboard?.addListener?.(eventName, handler);
    registration?.catch?.(reportNativeKeyboardError);
  } catch (error) {
    reportNativeKeyboardError(error);
  }
}

if (window.Capacitor?.isNativePlatform?.()) {
  window.visualViewport?.addEventListener?.('resize', keepFocusedControlVisible, { passive: true });
  document.addEventListener('focusin', event => {
    if (!event.target?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
    clearTimeout(nativeFormBlurTimer);
    nativeFormControlFocused = true;
    document.documentElement.classList.add('native-keyboard-open');
    requestAnimationFrame(keepFocusedControlVisible);
  });
  document.addEventListener('focusout', event => {
    if (!event.target?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
    clearTimeout(nativeFormBlurTimer);
    nativeFormBlurTimer = setTimeout(() => {
      nativeFormControlFocused = false;
      if (
        !document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]') &&
        !nativeKeyboardVisible
      ) {
        setNativeKeyboardOpen(false);
      }
    }, 350);
  });
}
if (window.Capacitor?.getPlatform?.() === 'ios') {
  registerNativeKeyboardListener('keyboardWillShow', info => setNativeKeyboardOpen(true, info?.keyboardHeight));
  registerNativeKeyboardListener('keyboardDidShow', info => setNativeKeyboardOpen(true, info?.keyboardHeight));
  registerNativeKeyboardListener('keyboardWillHide', () => setNativeKeyboardHeight(0));
  registerNativeKeyboardListener('keyboardDidHide', () => setNativeKeyboardOpen(false));
}
if (window.Capacitor?.getPlatform?.() === 'android') {
  window.Capacitor.Plugins.App?.addListener('backButton', handleNativeBackButton);
  registerNativeKeyboardListener('keyboardDidShow', () => setNativeKeyboardOpen(true));
  registerNativeKeyboardListener('keyboardDidHide', () => setNativeKeyboardOpen(false));
}

function updateBottomNav(screen) {
  const globalNav = document.getElementById('app-bottom-nav');
  const tripNav = document.getElementById('trip-bottom-nav');
  const signedIn = !!window._currentUser;
  const globalVisible = signedIn && ['trips', 'global-analytics', 'profile'].includes(screen);
  const tripVisible = signedIn && screen === 'dashboard' && !!currentTrip;
  if (globalNav) {
    globalNav.classList.toggle('visible', globalVisible);
    globalNav.hidden = !globalVisible;
  }
  if (tripNav) {
    tripNav.classList.toggle('visible', tripVisible);
    tripNav.hidden = !tripVisible;
  }

  const active =
    screen === 'profile' ? 'profile' : screen === 'trips' ? 'trips' : screen === 'global-analytics' ? 'analytics' : '';
  document
    .querySelectorAll('#app-bottom-nav button')
    .forEach(btn => btn.classList.toggle('active', btn.dataset.nav === active));
  document
    .querySelectorAll('#trip-bottom-nav button')
    .forEach(btn => btn.classList.toggle('active', btn.dataset.tab === currentTab));
}

async function openAnalyticsView() {
  tripRouteIntentId = null;
  currentTrip = null;
  showScreen('global-analytics');
  renderGlobalAnalyticsScreen();
  if (!loadedTrips.length && !tripsLoadPromise) {
    tripsLoadPromise = refreshTrips();
    try {
      await tripsLoadPromise;
    } finally {
      tripsLoadPromise = null;
    }
    if (document.body.dataset.screen === 'global-analytics') renderGlobalAnalyticsScreen();
  }
  refreshGlobalAnalyticsTotals();
}

function openProfileView() {
  tripRouteIntentId = null;
  profileReturn = document.body.dataset.screen === 'global-analytics' ? 'global-analytics' : 'trips';
  currentTrip = null;
  renderProfileScreen();
  showScreen('profile');
  void refreshAccountPreferences();
}

function returnFromProfile() {
  if (profileReturn === 'global-analytics') openAnalyticsView();
  else goToTrips();
}

window.addEventListener('popstate', () => {
  if (isWebLandingPath()) {
    currentTrip = null;
    showScreen('welcome');
    return;
  }
  if (isWebAppPath() && !window._currentUser) {
    openAuthMode('login');
    return;
  }
  const hash = location.hash.slice(1);
  if (!hash || hash === '') {
    tripRouteIntentId = null;
    currentTrip = null;
    showScreen('trips');
    loadTrips();
  } else if (hash.startsWith('trip/')) {
    openTrip(hash.split('/')[1]);
  }
});

// ─── Trips dashboard ──────────────────────────────────────────
function tripsCacheKey() {
  return window._currentUser?.id ? `tc-trip-list-cache-${window._currentUser.id}` : null;
}

const TRIP_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function restoreTripsCache() {
  const key = tripsCacheKey();
  if (!key || loadedTrips.length) return;
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (
      cached?.userId === window._currentUser?.id &&
      Array.isArray(cached.trips) &&
      Number.isFinite(cached.savedAt) &&
      Date.now() - cached.savedAt <= TRIP_CACHE_MAX_AGE_MS
    ) {
      loadedTrips = cached.trips;
    } else if (cached) {
      localStorage.removeItem(key);
    }
  } catch (_) {
    localStorage.removeItem(key);
  }
}

function persistTripsCache() {
  const key = tripsCacheKey();
  if (!key) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({
        userId: window._currentUser.id,
        savedAt: Date.now(),
        trips: loadedTrips,
      }),
    );
  } catch (_) {
    // A full storage area must never block the live trip list.
  }
}

function tripViewCacheKey(tripId) {
  return window._currentUser?.id ? `tc-trip-view-cache-${window._currentUser.id}-${tripId}` : null;
}

function restoreTripViewCache(tripId) {
  const key = tripViewCacheKey(tripId);
  if (!key) return null;
  try {
    const cached = JSON.parse(localStorage.getItem(key) || 'null');
    if (!cached?.trip || cached.trip.id !== tripId || !cached.role) {
      localStorage.removeItem(key);
      return null;
    }
    if (!Number.isFinite(cached.savedAt)) {
      cached.savedAt = Date.now();
      localStorage.setItem(key, JSON.stringify(cached));
    } else if (Date.now() - cached.savedAt > TRIP_CACHE_MAX_AGE_MS) {
      localStorage.removeItem(key);
      return null;
    }
    tripViewCache.set(tripId, cached);
    return cached;
  } catch (_) {
    localStorage.removeItem(key);
    return null;
  }
}

function persistTripViewCache(tripId) {
  const key = tripViewCacheKey(tripId);
  const cached = tripViewCache.get(tripId);
  if (!key || !cached) return;
  try {
    localStorage.setItem(key, JSON.stringify({ ...cached, savedAt: Date.now() }));
  } catch (_) {}
}

function clearUserTripCaches(userId) {
  if (!userId) return;
  const listKey = `tc-trip-list-cache-${userId}`;
  const viewPrefix = `tc-trip-view-cache-${userId}-`;
  const keys = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key === listKey || key?.startsWith(viewPrefix)) keys.push(key);
  }
  keys.forEach(key => localStorage.removeItem(key));
  loadedTrips = [];
  tripViewCache.clear();
}

function syncCurrentTripCache() {
  if (!currentTrip?.id) return;
  const existing = tripViewCache.get(currentTrip.id) || {};
  tripViewCache.set(currentTrip.id, {
    trip: currentTrip,
    members: currentMembers,
    expenses: currentExpenses,
    splits: currentSplits,
    settled: currentSettled,
    payments: currentPayments,
    contacts: currentContacts,
    role: existing.role || (currentTrip.creator_id === window._currentUser?.id ? 'creator' : 'member'),
  });
  persistTripViewCache(currentTrip.id);
}

function pendingOfflineChangeCount() {
  return window.TripCashOffline?.pendingCount(window._currentUser?.id) || 0;
}

function updateOfflineSyncControls({
  syncing = window.TripCashOffline?.isSyncing(window._currentUser?.id) || false,
  error = false,
} = {}) {
  const pending = pendingOfflineChangeCount();
  const status = document.getElementById('offline-sync-status');
  const button = document.getElementById('btn-sync-now');
  const review = document.getElementById('btn-review-sync');
  if (review) {
    review.hidden = !pending;
    review.disabled = syncing;
  }
  if (status) {
    status.hidden = !pending && !syncing;
    status.textContent = syncing
      ? `Syncing ${pending} change${pending === 1 ? '' : 's'}…`
      : `${pending} change${pending === 1 ? '' : 's'} pending`;
    status.classList.toggle('error', Boolean(error));
  }
  if (button) {
    button.hidden = !pending && !syncing;
    button.disabled = syncing;
    button.textContent = syncing ? 'Syncing…' : 'Sync now';
  }
}

async function saveOfflineCapableMutation(label, steps) {
  if (!window.TripCashOffline) {
    return { status: 'error', error: new Error('Offline storage is unavailable.') };
  }
  steps = steps.map(step => {
    if (step.method !== 'update' || step.expected) return step;
    const rows = { trips: currentTrip ? [currentTrip] : [], members: currentMembers };
    const row = rows[step.table]?.find(item => item.id === step.match?.id);
    if (!row) return step;
    const expected = Object.fromEntries(
      Object.keys(step.values)
        .filter(key => row[key] !== undefined)
        .map(key => [key, row[key]]),
    );
    return { ...step, expected };
  });
  const result = await window.TripCashOffline.saveMutation(window._currentUser, { label, steps });
  updateOfflineSyncControls();
  if (result.status === 'queued' && navigator.onLine !== false) {
    // Let the caller finish its optimistic UI/cache update before refreshing from the server.
    setTimeout(() => {
      if (navigator.onLine !== false && pendingOfflineChangeCount()) void syncAfterReconnect();
    }, 0);
  }
  return result;
}

async function ensureAuthenticatedSyncSession(user) {
  const current = await db.auth.getSession();
  if (current.error) throw current.error;
  if (current.data?.session?.user?.id === user.id) return current.data.session;
  const refreshed = await db.auth.refreshSession();
  if (refreshed.error) throw refreshed.error;
  if (refreshed.data?.session?.user?.id !== user.id) {
    throw new Error('Your session must be restored before offline changes can sync.');
  }
  return refreshed.data.session;
}

async function syncPendingOfflineChanges({ notify = false } = {}) {
  const pending = pendingOfflineChangeCount();
  if (!pending || navigator.onLine === false || !window._currentUser) {
    updateOfflineSyncControls();
    if (notify && pending && navigator.onLine === false) {
      showToast('Connect to the internet, then tap Sync now.', 'error');
    }
    return { synced: 0, remaining: pending };
  }
  updateOfflineSyncControls({ syncing: true });
  if (notify) showToast(`Syncing ${pending} offline change${pending === 1 ? '' : 's'}…`, 'info');
  let result;
  try {
    await ensureAuthenticatedSyncSession(window._currentUser);
    result = await window.TripCashOffline.sync(window._currentUser);
  } catch (error) {
    result = { synced: 0, remaining: pendingOfflineChangeCount(), error };
  }
  updateOfflineSyncControls({ error: Boolean(result.remaining) });
  if (result.remaining) {
    const failed = result.failedMutation?.label ? ` (${result.failedMutation.label})` : '';
    showToast(
      `${result.remaining} offline change${result.remaining === 1 ? '' : 's'} still need to sync${failed}. Tap Sync now to retry.`,
      'error',
    );
  } else if (result.synced && notify) {
    showToast(`${result.synced} offline change${result.synced === 1 ? '' : 's'} synced.`);
  }
  return result;
}

async function syncAfterReconnect() {
  if (reconnectSyncPromise || !window._currentUser) return reconnectSyncPromise;
  reconnectSyncPromise = (async () => {
    const activeTripId = currentTrip?.id;
    const result = await syncPendingOfflineChanges({ notify: true });
    if (result.remaining) return;
    if (activeTripId) await openTrip(activeTripId);
    else await loadTrips();
  })();
  try {
    return await reconnectSyncPromise;
  } finally {
    reconnectSyncPromise = null;
  }
}

window.addEventListener('online', () => {
  void syncAfterReconnect();
});

let accountPreferencesRefreshPromise = null;

async function refreshAccountPreferences() {
  const user = window._currentUser;
  if (!user?.id || navigator.onLine === false) return;
  if (accountPreferencesRefreshPromise) return accountPreferencesRefreshPromise;

  accountPreferencesRefreshPromise = (async () => {
    const { data, error } = await db
      .from('profiles')
      .select('home_currency, default_split, theme_preference')
      .eq('id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data || window._currentUser?.id !== user.id) return;

    const previous = localProfilePreferences();
    window._currentProfile = { ...(window._currentProfile || { id: user.id }), ...data };
    const current = applyProfilePreferences(window._currentProfile);
    cacheProfile(user, window._currentProfile);

    if (document.body.dataset.screen === 'profile') renderProfileScreen();
    if (document.body.dataset.screen === 'global-analytics' && previous.home_currency !== current.home_currency) {
      renderGlobalAnalyticsScreen();
      void refreshGlobalAnalyticsTotals();
    }
  })();

  try {
    await accountPreferencesRefreshPromise;
  } catch (_) {
    // A later focus, online event, or profile open retries the refresh.
  } finally {
    accountPreferencesRefreshPromise = null;
  }
}

async function refreshAfterForeground() {
  if (navigator.onLine === false || !window._currentUser) return;
  if (pendingOfflineChangeCount()) await syncAfterReconnect();
  await refreshAccountPreferences();
}

function nativeRefreshScrollContainer(screen = document.body.dataset.screen) {
  if (screen === 'dashboard' && document.body.classList.contains('native-redesign')) {
    return document.getElementById('screen-dashboard');
  }
  if (screen === 'dashboard') return document.querySelector('#screen-dashboard .dash-content');
  if (screen === 'profile') return document.getElementById('screen-profile');
  return document.scrollingElement || document.documentElement;
}

function nativeRefreshCanStart(event) {
  const screen = document.body.dataset.screen;
  if (!document.documentElement.classList.contains('native-ios')) return false;
  if (!window._currentUser || !NATIVE_REFRESH_SCREENS.has(screen)) return false;
  if (
    nativeRefreshInFlight ||
    document.querySelector('.modal.open') ||
    document.body.classList.contains('web-expense-open')
  )
    return false;
  if (nativeKeyboardVisible || nativeFormControlFocused) return false;
  if (event.target?.closest?.('input, textarea, select, button, a, [contenteditable="true"]')) return false;
  const container = nativeRefreshScrollContainer(screen);
  return Boolean(container);
}

function updateNativeRefreshIndicator(state) {
  const indicator = document.getElementById('native-refresh-indicator');
  const label = document.getElementById('native-refresh-label');
  if (!indicator || !label) return;
  indicator.hidden = state === 'hidden';
  indicator.classList.toggle('is-visible', ['pulling', 'ready', 'refreshing'].includes(state));
  indicator.classList.toggle('is-ready', state === 'ready');
  indicator.classList.toggle('is-refreshing', state === 'refreshing');
  label.textContent =
    state === 'refreshing' ? 'Refreshing…' : state === 'ready' ? 'Release to refresh' : 'Pull to refresh';
}

function resetNativeRefreshGesture() {
  nativeRefreshGesture = null;
  if (!nativeRefreshInFlight) updateNativeRefreshIndicator('hidden');
}

function handleNativeRefreshTouchStart(event) {
  if (event.touches?.length !== 1 || !nativeRefreshCanStart(event)) return;
  const touch = event.touches[0];
  nativeRefreshGesture = {
    startX: touch.clientX,
    startY: touch.clientY,
    startedAt: Number(event.timeStamp) || performance.now(),
    lastY: touch.clientY,
    ready: false,
    screen: document.body.dataset.screen,
  };
}

function handleNativeRefreshTouchMove(event) {
  if (!nativeRefreshGesture || event.touches?.length !== 1) return;
  const touch = event.touches[0];
  const deltaX = touch.clientX - nativeRefreshGesture.startX;
  const deltaY = touch.clientY - nativeRefreshGesture.startY;
  const movedUp = touch.clientY < nativeRefreshGesture.lastY - 8;
  nativeRefreshGesture.lastY = touch.clientY;
  if (
    document.body.dataset.screen !== nativeRefreshGesture.screen ||
    deltaY <= 0 ||
    movedUp ||
    Math.abs(deltaX) > deltaY * 0.6
  ) {
    resetNativeRefreshGesture();
    return;
  }
  if (deltaY < 90) return;
  const pullDuration = (Number(event.timeStamp) || performance.now()) - nativeRefreshGesture.startedAt;
  nativeRefreshGesture.ready = deltaY >= NATIVE_REFRESH_THRESHOLD && pullDuration >= NATIVE_REFRESH_MIN_PULL_MS;
  updateNativeRefreshIndicator(nativeRefreshGesture.ready ? 'ready' : 'pulling');
}

async function refreshCurrentNativeView() {
  if (navigator.onLine === false) {
    showToast('You are offline — saved data is already available.', 'info');
    return;
  }
  const syncResult = await syncPendingOfflineChanges();
  if (syncResult.remaining) return;

  const screen = document.body.dataset.screen;
  if (screen === 'dashboard' && currentTrip?.id) {
    await openTrip(currentTrip.id);
  } else if (screen === 'profile') {
    await refreshAccountPreferences();
    renderProfileScreen();
  } else {
    await refreshTrips();
    if (screen === 'global-analytics') {
      renderGlobalAnalyticsScreen();
      await refreshGlobalAnalyticsTotals();
    }
  }
  showToast('Up to date.');
}

async function performNativePullToRefresh() {
  if (nativeRefreshInFlight) return;
  nativeRefreshInFlight = true;
  updateNativeRefreshIndicator('refreshing');
  try {
    await refreshCurrentNativeView();
  } catch (_) {
    showDataError('Unable to refresh right now.');
  } finally {
    setTimeout(() => {
      nativeRefreshInFlight = false;
      updateNativeRefreshIndicator('hidden');
    }, 350);
  }
}

function handleNativeRefreshTouchEnd() {
  const shouldRefresh = nativeRefreshGesture?.ready === true;
  nativeRefreshGesture = null;
  if (shouldRefresh) void performNativePullToRefresh();
  else updateNativeRefreshIndicator('hidden');
}

function configureNativePullToRefresh() {
  if (nativePullToRefreshConfigured || !document.documentElement.classList.contains('native-ios')) return;
  nativePullToRefreshConfigured = true;
  document.addEventListener('touchstart', handleNativeRefreshTouchStart, { passive: true });
  document.addEventListener('touchmove', handleNativeRefreshTouchMove, { passive: true });
  document.addEventListener('touchend', handleNativeRefreshTouchEnd, { passive: true });
  document.addEventListener('touchcancel', resetNativeRefreshGesture, { passive: true });
}

window.addEventListener('focus', () => {
  void refreshAfterForeground();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refreshAfterForeground();
});

function updateLoadedTripExpenseSummary(amountDelta, category, countDelta) {
  const trip = loadedTrips.find(item => item.id === currentTrip?.id);
  if (!trip) return;
  const me = currentMembers.find(member => member.user_id === window._currentUser?.id);
  trip._total = Math.max(0, Number(trip._total || 0) + Number(amountDelta || 0));
  trip._myTotal = me
    ? currentExpenses
        .filter(expense => expense.paid_by === me.id)
        .reduce((sum, expense) => sum + convertedExpenseAmount(expense), 0)
    : 0;
  trip._expenseCount = Math.max(0, Number(trip._expenseCount || 0) + Number(countDelta || 0));
  trip._categories = trip._categories || {};
  trip._categories[category || 'other'] = Math.max(
    0,
    Number(trip._categories[category || 'other'] || 0) + Number(amountDelta || 0),
  );
  persistTripsCache();
}

async function loadTrips() {
  const user = window._currentUser;
  if (!user) return;

  showScreen('trips');
  updateOfflineSyncControls();
  if (loadedTrips.length) {
    renderTripsList(loadedTrips);
    renderDashboardStats(loadedTrips);
  } else {
    document.getElementById('trips-list').innerHTML = '<div class="empty-hint">Loading…</div>';
  }

  if (navigator.onLine === false) {
    if (!loadedTrips.length) {
      document.getElementById('trips-list').innerHTML =
        '<div class="empty-hint">No trips have been saved on this device yet.</div>';
    }
    return;
  }

  if (tripsLoadPromise) return tripsLoadPromise;
  tripsLoadPromise = (async () => {
    // New social accounts can receive a valid session just before their profile
    // row is ready. Wait for auth bootstrap before making protected trip reads.
    await profileInitializationPromise;
    if (window._currentUser?.id !== user.id) return;
    const syncResult = await syncPendingOfflineChanges();
    if (syncResult.remaining) return;
    return refreshTrips();
  })();
  try {
    return await tripsLoadPromise;
  } finally {
    tripsLoadPromise = null;
  }
}

async function refreshTrips() {
  const user = window._currentUser;
  if (!user) return;
  if (navigator.onLine === false || pendingOfflineChangeCount()) return;

  const cachedTrips = new Map(loadedTrips.map(trip => [trip.id, trip]));

  const { data: trips, error: tripsError } = await db
    .from('trips')
    .select('*')
    .order('created_at', { ascending: false });

  if (tripsError) {
    if (loadedTrips.length) showToast('Showing saved trips while the connection recovers.', 'error');
    else showDataError('Unable to load trips.');
    return;
  }

  loadedTrips = (trips || []).map(trip => {
    const cached = cachedTrips.get(trip.id);
    return cached
      ? {
          ...trip,
          _total: cached._total,
          _myTotal: cached._myTotal,
          _expenseCount: cached._expenseCount,
          _categories: cached._categories,
          _members: cached._members,
        }
      : trip;
  });
  renderTripsList(loadedTrips);
  renderDashboardStats(loadedTrips);

  if (loadedTrips.length) {
    const ids = loadedTrips.map(t => t.id);
    const [expenseTotals, memberCounts] = await Promise.all([
      db.from('expenses').select('trip_id,amount,category,paid_by').in('trip_id', ids),
      db.from('members').select('id,trip_id,user_id').in('trip_id', ids),
    ]);
    if (expenseTotals.error || memberCounts.error) {
      persistTripsCache();
      showToast('Trips loaded. Some totals are still updating.', 'error');
      return;
    }
    loadedTrips.forEach(t => {
      const tripExpenses = (expenseTotals.data || []).filter(e => e.trip_id === t.id);
      const myMemberIds = new Set(
        (memberCounts.data || [])
          .filter(member => member.trip_id === t.id && member.user_id === user.id)
          .map(member => member.id),
      );
      t._total = tripExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0);
      t._myTotal = tripExpenses
        .filter(expense => myMemberIds.has(expense.paid_by))
        .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
      t._expenseCount = tripExpenses.length;
      t._categories = tripExpenses.reduce((totals, expense) => {
        totals[expense.category || 'other'] = (totals[expense.category || 'other'] || 0) + Number(expense.amount || 0);
        return totals;
      }, {});
      t._members = (memberCounts.data || []).filter(m => m.trip_id === t.id).length;
    });
  }
  persistTripsCache();
  renderTripsList(loadedTrips);
  renderDashboardStats(loadedTrips);
  if (document.body.dataset.screen === 'global-analytics') renderGlobalAnalyticsScreen();
}

function renderDashboardStats(trips) {
  const active = trips.filter(t => t.status === 'active').length;
  const ended = trips.filter(t => t.status === 'ended').length;
  const fmt = n => (n === 0 ? '—' : String(n));
  document.getElementById('stat-total-trips').textContent = fmt(trips.length);
  document.getElementById('stat-active-trips').textContent = fmt(active);
  document.getElementById('stat-ended-trips').textContent = fmt(ended);
}

function renderTripsList(trips) {
  const el = document.getElementById('trips-list');
  if (!trips.length) {
    el.innerHTML = `<div class="empty-state"><span class="empty-icon">✈️</span><h3>No trips yet</h3><p>Create your first one and start splitting expenses.</p></div>`;
    return;
  }
  const cards = trips
    .map(t => {
      const badge =
        t.status === 'ended'
          ? '<span class="badge badge-ended">Ended</span>'
          : '<span class="badge badge-active">Active</span>';
      const isCreator = t.creator_id === window._currentUser?.id;
      const roleBadge = isCreator
        ? '<span class="badge badge-creator">Creator</span>'
        : '<span class="badge badge-member">Member</span>';
      return `<div class="trip-card" data-action="open-trip" data-id="${t.id}" role="button" tabindex="0">
      <div class="trip-emoji">${esc(t.emoji || '✈️')}</div>
      <div class="trip-info">
        <div class="trip-name">${esc(displayTripName(t.name))}</div>
        <div class="trip-meta"><span>${formatTripDateRange(t) || `Day ${t.current_day}`} · ${t._members || '—'} members</span>${roleBadge}</div>
      </div>
      <div class="trip-right"><strong>${formatMoney(t._total || 0, t.currency)}</strong>${badge}</div>
    </div>`;
    })
    .join('');
  el.innerHTML = `<div class="trip-cards-grid">${cards}</div>`;
}

function globalTripRate(trip, homeCurrency) {
  const from = normalizeCurrency(trip.currency);
  const to = normalizeCurrency(homeCurrency);
  if (from === to) return 1;
  return exchangeRateCache[`${from}-${to}`] || displayCurrencyRates[`${from}-${to}`] || null;
}

function setGlobalAnalyticsCurrency(currency) {
  void saveProfilePreference('tc-home-currency', currency, { silent: true });
  renderGlobalAnalyticsScreen();
  refreshGlobalAnalyticsTotals();
}

async function reviewOfflineChanges() {
  if (!pendingOfflineChangeCount() || navigator.onLine === false) {
    showToast('Connect to the internet to review pending changes.', 'error');
    return;
  }
  const user = window._currentUser;
  if (
    !(await appConfirm({
      title: 'Use the saved online version?',
      message:
        'This discards ALL changes still pending on this device and reloads the saved online data. Changes already synced remain saved. Cancel to keep your pending changes and retry later.',
      okText: 'Discard pending changes',
      danger: true,
    }))
  )
    return;
  if (window._currentUser?.id !== user?.id || window.TripCashOffline.isSyncing(user.id)) return;
  window.TripCashOffline.clearQueue(user.id);
  clearUserTripCaches(user.id);
  currentTrip = null;
  await ensureProfile(user);
  await loadTrips();
  updateOfflineSyncControls();
}

function globalTripPhase(trip) {
  if (trip.status === 'ended') return 'Ended';
  const start = /^\d{4}-\d{2}-\d{2}$/.test(trip.start_date || '') ? new Date(`${trip.start_date}T00:00:00`) : null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return start && start > today ? 'Upcoming' : 'Active';
}

function renderGlobalAnalyticsScreen() {
  const el = document.getElementById('global-analytics-content');
  if (!el) return;
  const currency = normalizeCurrency(localStorage.getItem('tc-home-currency') || 'EUR');

  if (!loadedTrips.length) {
    el.innerHTML = `<div class="section-heading"><div><span class="eyebrow">All trips</span><h1>Your travel spending</h1></div></div><div class="empty-state"><span class="empty-icon">📊</span><h3>No trip analytics yet</h3><p>Create a trip and add an expense to see your combined totals.</p></div>`;
    return;
  }

  const converted = loadedTrips.map(trip => {
    const rate = globalTripRate(trip, currency);
    return {
      trip,
      rate,
      total: rate == null ? null : roundMoney(Number(trip._total || 0) * rate),
      myTotal: rate == null || trip._myTotal == null ? null : roundMoney(Number(trip._myTotal || 0) * rate),
    };
  });
  const hasAllRates = converted.every(item => item.rate != null);
  const hasAllPersonalTotals = converted.every(item => item.myTotal != null);
  const combinedTotal = converted.reduce((sum, item) => sum + (item.total || 0), 0);
  const combinedMyTotal = converted.reduce((sum, item) => sum + (item.myTotal || 0), 0);
  const expenseCount = loadedTrips.reduce((sum, trip) => sum + Number(trip._expenseCount || 0), 0);
  const activeCount = loadedTrips.filter(trip => globalTripPhase(trip) === 'Active').length;

  const categoryTotals = {};
  if (hasAllRates) {
    converted.forEach(({ trip, rate }) =>
      Object.entries(trip._categories || {}).forEach(([category, amount]) => {
        categoryTotals[category] = (categoryTotals[category] || 0) + Number(amount || 0) * rate;
      }),
    );
  }
  const categoryRows = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const categoryList = categoryRows.length
    ? `<div class="category-list">${categoryRows
        .map(([category, amount]) => {
          const label = category === 'hotel' ? 'Stay' : category.charAt(0).toUpperCase() + category.slice(1);
          const pct = combinedTotal ? (amount / combinedTotal) * 100 : 0;
          return `<div class="category-list-row"><i class="${categoryClass(category)}">${CATEGORIES[category] || '📦'}</i><span>${esc(label)}</span><small>${pct.toFixed(0)}%</small><strong>${formatMoney(amount, currency)}</strong></div>`;
        })
        .join('')}</div>`
    : '<div class="empty-hint">Category totals will appear after currencies are updated.</div>';

  const tripRows = converted
    .sort((a, b) => (b.total ?? Number(b.trip._total || 0)) - (a.total ?? Number(a.trip._total || 0)))
    .map(
      ({ trip, total }) =>
        `<button class="global-trip-row" data-action="open-trip" data-id="${trip.id}"><span class="global-trip-emoji">${esc(trip.emoji || '✈️')}</span><span><b>${esc(displayTripName(trip.name))}</b><small>${globalTripPhase(trip)} · ${Number(trip._expenseCount || 0)} expenses</small></span><strong>${total == null ? formatMoney(trip._total || 0, trip.currency) : formatMoney(total, currency)}</strong><em>›</em></button>`,
    )
    .join('');

  el.innerHTML = `
    <div class="section-heading"><div><span class="eyebrow">All trips</span><h1>Your travel spending</h1></div><div class="currency-control"><label for="global-display-currency">Show totals in</label><select id="global-display-currency" data-change-action="set-global-analytics-currency">${currencyOptions(currency)}</select></div></div>
    <section class="overview-hero global-analytics-hero"><span>Spent across every trip</span><strong>${hasAllRates ? formatMoney(combinedTotal, currency) : 'Updating…'}</strong><div class="analytics-personal-total"><span>You spent</span><b>${hasAllRates && hasAllPersonalTotals ? formatMoney(combinedMyTotal, currency) : 'Updating…'}</b></div><small>${hasAllRates ? `${expenseCount} expense${expenseCount === 1 ? '' : 's'} combined in ${currency}` : 'Your saved totals are visible while exchange rates refresh'}</small></section>
    <div class="overview-grid global-overview-grid">
      <div class="ov-tile"><span class="ov-tile-icon">🧳</span><div class="ov-tile-label">All trips</div><div class="ov-tile-val">${loadedTrips.length}</div></div>
      <div class="ov-tile"><span class="ov-tile-icon">🟢</span><div class="ov-tile-label">Active</div><div class="ov-tile-val">${activeCount || '—'}</div></div>
      <div class="ov-tile"><span class="ov-tile-icon">🧾</span><div class="ov-tile-label">Expenses</div><div class="ov-tile-val">${expenseCount || '—'}</div></div>
    </div>
    <div class="global-analytics-grid">
      <section><div class="section-title">Combined category breakdown</div>${categoryList}</section>
      <section><div class="section-title">Trips</div><div class="global-trip-list">${tripRows}</div></section>
    </div>`;
}

async function refreshGlobalAnalyticsTotals() {
  if (globalAnalyticsPromise || !loadedTrips.length) return globalAnalyticsPromise;
  const homeCurrency = normalizeCurrency(localStorage.getItem('tc-home-currency') || 'EUR');
  const currencies = [
    ...new Set(loadedTrips.map(trip => normalizeCurrency(trip.currency)).filter(currency => currency !== homeCurrency)),
  ];
  if (!currencies.length) {
    renderGlobalAnalyticsScreen();
    return;
  }
  globalAnalyticsPromise = Promise.allSettled(
    currencies.map(async currency => {
      const rate = await getExchangeRate(currency, homeCurrency);
      displayCurrencyRates[`${currency}-${homeCurrency}`] = rate;
    }),
  );
  try {
    await globalAnalyticsPromise;
  } finally {
    globalAnalyticsPromise = null;
    if (document.body.dataset.screen === 'global-analytics') renderGlobalAnalyticsScreen();
  }
}

// ─── Open trip ────────────────────────────────────────────────
async function openTrip(tripId, { showLoader = false } = {}) {
  tripRouteIntentId = tripId;
  if (openingTripPromise && openingTripId === tripId) {
    const cachedTrip = tripViewCache.get(tripId) || restoreTripViewCache(tripId);
    if (cachedTrip) {
      activateCachedTrip(cachedTrip);
      location.hash = `trip/${tripId}`;
    }
    return openingTripPromise;
  }

  openingTripId = tripId;
  openingTripPromise = fetchAndOpenTrip(tripId, { showLoader });
  try {
    return await openingTripPromise;
  } finally {
    openingTripPromise = null;
    openingTripId = null;
  }
}

function activateCachedTrip(cachedTrip) {
  currentTrip = cachedTrip.trip;
  currentMembers = cachedTrip.members;
  currentExpenses = cachedTrip.expenses;
  currentSplits = cachedTrip.splits;
  currentSettled = cachedTrip.settled;
  currentPayments = cachedTrip.payments;
  currentContacts = cachedTrip.contacts;
  renderDashboard(cachedTrip.role);
}

async function fetchAndOpenTrip(tripId, { showLoader = true } = {}) {
  if (currentTrip?.id !== tripId) currentInviteToken = null;
  const cachedTrip = tripViewCache.get(tripId) || restoreTripViewCache(tripId);
  const canShowCachedTrip = currentTrip?.id === tripId;
  if (cachedTrip && !canShowCachedTrip) {
    activateCachedTrip(cachedTrip);
  } else if (canShowCachedTrip) {
    showScreen('dashboard');
    switchTab(pendingTripTab || currentTab);
  } else if (showLoader) {
    showScreen('loading');
  } else {
    // Keep a useful screen visible while the first visit to a trip is fetched.
    // This avoids flashing the native full-screen loader during tab navigation.
    showScreen('trips');
  }
  location.hash = `trip/${tripId}`;

  if (navigator.onLine === false) {
    if (!cachedTrip) showScreen('not-found');
    return;
  }

  try {
    const [tripRes, membersRes, expRes, settledRes, paymentsRes, contactsRes] = await Promise.all([
      db.from('trips').select('*').eq('id', tripId).single(),
      db.from('members').select('*').eq('trip_id', tripId),
      db.from('expenses').select('*').eq('trip_id', tripId).order('day_number').order('created_at'),
      db.from('settlements').select('day_number').eq('trip_id', tripId),
      db.from('payments').select('*').eq('trip_id', tripId),
      db.from('contacts').select('name').eq('owner_id', window._currentUser?.id).order('name'),
    ]);

    if (tripRes.error || !tripRes.data) {
      const accessDenied = ['PGRST116', '42501'].includes(tripRes.error?.code);
      if (cachedTrip && tripRes.error && !accessDenied) {
        showToast('Showing your recent trip data while the connection recovers.', 'error');
        return;
      }
      showScreen('not-found');
      return;
    }
    const refreshError = [membersRes, expRes, settledRes, paymentsRes, contactsRes].find(result => result.error)?.error;
    if (refreshError) {
      if (cachedTrip) {
        showToast('Showing your recent trip data while the connection recovers.', 'error');
        return;
      }
      throw refreshError;
    }

    // Load splits separately to avoid nested join issue
    const expIds = (expRes.data || []).map(e => e.id);
    let splitsData = [];
    if (expIds.length) {
      const { data: sd } = await db.from('expense_splits').select('*').in('expense_id', expIds);
      splitsData = sd || [];
    }

    const user = window._currentUser;
    if (!user) {
      showScreen('auth');
      return;
    }

    const { data: myMembership } = await db
      .from('trip_members')
      .select('role')
      .eq('trip_id', tripId)
      .eq('user_id', user.id)
      .maybeSingle();

    const isCreator = tripRes.data.creator_id === user.id;
    if (!isCreator && !myMembership) {
      showScreen('not-found');
      return;
    }

    const membersData = await ensureUserVisibleMember(tripId, membersRes.data || []);

    currentTrip = tripRes.data;
    currentMembers = membersData;
    currentExpenses = expRes.data || [];
    currentSplits = splitsData;
    currentSettled = (settledRes.data || []).map(s => s.day_number);
    currentPayments = paymentsRes.data || [];
    currentContacts = contactsRes.data || [];

    const role = isCreator ? 'creator' : myMembership?.role || 'member';
    if (isCreator && currentTrip.status === 'active') {
      const { data: invite } = await db.rpc('get_or_create_trip_invite', { p_trip_id: tripId }).maybeSingle();
      currentInviteToken = invite?.token || null;
    } else {
      currentInviteToken = null;
    }
    tripViewCache.set(tripId, {
      trip: currentTrip,
      members: currentMembers,
      expenses: currentExpenses,
      splits: currentSplits,
      settled: currentSettled,
      payments: currentPayments,
      contacts: currentContacts,
      role,
    });
    persistTripViewCache(tripId);
    if (tripRouteIntentId !== tripId) {
      currentTrip = null;
      return;
    }
    renderDashboard(role);

    // Live conversion is optional and must never hold the dashboard, tabs, or
    // persistent navigation behind the full-screen loader on a slow network.
    await ensureDisplayRate();
    if (currentTrip?.id === tripId && document.getElementById('screen-dashboard')?.classList.contains('active')) {
      switchTab(currentTab);
    }
  } catch (err) {
    if (cachedTrip) {
      showToast('Showing your recent trip data while the connection recovers.', 'error');
      return;
    }
    showScreen('not-found');
  }
}

function currentUserMemberName() {
  const user = window._currentUser;
  return window._currentProfile?.display_name || user?.email?.split('@')[0] || 'Guest';
}

async function ensureUserVisibleMember(tripId, members) {
  const user = window._currentUser;
  if (!user || members.some(m => m.user_id === user.id)) return members;

  const { data } = await db
    .from('members')
    .insert({
      trip_id: tripId,
      user_id: user.id,
      name: currentUserMemberName(),
    })
    .select()
    .single();

  if (data) return [...members, data];

  const { data: refreshed } = await db.from('members').select('*').eq('trip_id', tripId);
  return refreshed || members;
}

function renderDashboard(role) {
  const trip = currentTrip;

  document.getElementById('dash-trip-name').textContent = `${trip.emoji || '✈️'} ${displayTripName(trip.name)}`;
  document.getElementById('dash-day-badge').textContent = `Day ${trip.current_day}`;

  document.querySelectorAll('.creator-only').forEach(el => {
    el.hidden = role !== 'creator';
  });

  showScreen('dashboard');
  // A trip opens on its actionable content. The responsive workspace keeps the
  // summary visible without requiring a separate overview tab.
  const targetTab = pendingTripTab || 'expenses';
  pendingTripTab = null;
  switchTab(targetTab);
}

// ─── Tabs ──────────────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document
    .querySelectorAll('#trip-bottom-nav button')
    .forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));

  if (tab === 'overview') renderOverviewTab();
  if (tab === 'expenses') renderExpensesTab();
  if (tab === 'analytics') renderAnalyticsTab();
  if (tab === 'members') renderMembersTab();
  if (tab === 'activity') renderActivityTab();
  updateBottomNav('dashboard');
}

// ─── Overview tab ─────────────────────────────────────────────
function renderOverviewTab() {
  const trip = currentTrip;
  const displayCurrency = getDisplayCurrency();
  const baseTotal = currentExpenses.reduce((s, e) => s + convertedExpenseAmount(e), 0);
  const total = displayAmount(baseTotal);
  const days = trip.current_day;
  const perDay = days > 0 ? total / days : 0;
  const el = document.getElementById('tab-overview');

  if (trip.status === 'ended') {
    el.innerHTML = renderEndedBanner(displayCurrency, total);
    return;
  }

  const isCreator = trip.creator_id === window._currentUser?.id;
  const inviteUrl = currentInviteToken ? `${PUBLIC_APP_URL}?invite=${encodeURIComponent(currentInviteToken)}` : '';
  const baseBudget = Number(trip.budget) || 0;
  const budget = baseBudget ? displayAmount(baseBudget) : 0;
  const remaining = budget ? Math.max(budget - total, 0) : 0;
  const spentPct = budget ? Math.min((total / budget) * 100, 100) : 0;
  const leftPct = budget ? Math.max(100 - spentPct, 0) : 0;

  const catList = renderCategoryList(displayCurrency);
  const dayChart = renderDaySpendingChart(displayCurrency);

  el.innerHTML = `
    ${renderDisplayCurrencyControl()}
    <section class="overview-hero trip-summary-card">
      <div class="trip-summary-top"><div><span>${formatTripDateRange(trip) || 'Total spent'}</span><strong>${formatMoney(total, displayCurrency)}</strong><small>${formatTripDateRange(trip) ? 'Total spent' : ''}</small></div><div class="trip-budget"><span>Budget</span><b>${budget ? formatMoney(budget, displayCurrency) : '—'}</b></div></div>
      <progress class="budget-track" max="100" value="${spentPct}">${spentPct}%</progress>
      <div class="budget-caption"><span>${budget ? `Remaining <b>${formatMoney(remaining, displayCurrency)}</b>` : 'Budget requires trip setup'}</span><b>${budget ? leftPct.toFixed(0) + '% left' : ''}</b></div>
    </section>
    ${renderAddExpenseAction('overview')}
    <div class="overview-grid">
      <div class="ov-tile"><span class="ov-tile-icon">📅</span><div class="ov-tile-label">Per day avg</div><div class="ov-tile-val">${formatMoney(perDay, displayCurrency)}</div></div>
      <div class="ov-tile"><span class="ov-tile-icon">🧾</span><div class="ov-tile-label">Expenses</div><div class="ov-tile-val">${currentExpenses.length || '—'}</div></div>
      <div class="ov-tile"><span class="ov-tile-icon">👥</span><div class="ov-tile-label">Members</div><div class="ov-tile-val">${currentMembers.length || '—'}</div></div>
    </div>
    <div class="overview-actions">
      <button data-action="switch-tab" data-value="expenses">All expenses <span>›</span></button>
      <button data-action="switch-tab" data-value="members">Members &amp; split <span>›</span></button>
    </div>
    ${
      isCreator
        ? `<div class="card">
      <div class="card-label">Invite link</div>
      <div class="share-row">
        <div class="share-input">${inviteUrl ? esc(inviteUrl) : 'Invite unavailable'}</div>
        <button class="btn-icon btn-sm" data-action="copy-invite" data-value="${esc(inviteUrl)}" ${inviteUrl ? '' : 'disabled'}>Copy</button>
      </div>
      <p class="invite-hint">This link expires after 30 days. <button class="link-button" data-action="rotate-invite">Replace link</button></p>
    </div>`
        : ''
    }
    <div class="section-block">
      <div class="section-title">Day by day</div>
      ${dayChart}
    </div>
    <div class="section-block"><div class="section-title">Spending by category</div>${catList}</div>
    ${isCreator ? renderTripActions() : ''}`;
}

function renderAddExpenseAction(location = 'expenses') {
  if (!currentTrip || currentTrip.status === 'ended') return '';
  const text = location === 'overview' ? 'Add a trip expense' : 'Add expense';
  return `<button class="trip-add-expense" data-action="open-add-expense-modal"><span>＋</span><b>${text}</b><small>Equal or exact split</small></button>`;
}

function renderDaySpendingChart(currency) {
  const totals = {};
  currentExpenses.forEach(e => {
    totals[e.day_number] = (totals[e.day_number] || 0) + displayAmount(convertedExpenseAmount(e));
  });
  const days = Array.from({ length: Math.max(currentTrip?.current_day || 1, 1) }, (_, i) => i + 1);
  const max = Math.max(...days.map(d => totals[d] || 0), 1);
  return `<div class="day-spending-list">${days
    .map(day => {
      const amount = totals[day] || 0;
      const percentage = Math.max((amount / max) * 100, amount ? 5 : 0);
      return `<div class="day-spending-row"><span>Day ${day}</span><progress max="100" value="${percentage}">${percentage}%</progress><strong>${formatMoney(amount, currency)}</strong></div>`;
    })
    .join('')}</div>`;
}

function renderCategoryList(currency) {
  const total = displayAmount(currentExpenses.reduce((s, e) => s + convertedExpenseAmount(e), 0));
  const totals = {};
  currentExpenses.forEach(e => {
    totals[e.category] = (totals[e.category] || 0) + displayAmount(convertedExpenseAmount(e));
  });
  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<div class="empty-hint">No expenses yet.</div>';
  return `<div class="category-list">${rows
    .map(([cat, amount]) => {
      const label = cat === 'hotel' ? 'Stay' : cat.charAt(0).toUpperCase() + cat.slice(1);
      const pct = total ? (amount / total) * 100 : 0;
      return `<div class="category-list-row"><i class="${categoryClass(cat)}">${CATEGORIES[cat] || '•'}</i><span>${esc(label)}</span><small>${pct.toFixed(0)}%</small><strong>${formatMoney(amount, currency)}</strong></div>`;
    })
    .join('')}</div>`;
}

function renderTripActions({ ended = false } = {}) {
  return `<div class="card">
      <div class="section-title">Actions</div>
      <div class="trip-action-buttons">
        ${ended ? '' : '<button class="btn btn-secondary btn-auto btn-sm" data-action="open-edit-trip-modal">Edit trip</button>'}
        <button class="btn btn-secondary btn-auto btn-sm" data-action="export-csv">Export CSV</button>
        ${ended ? '' : '<button class="btn btn-danger btn-auto btn-sm" data-action="open-end-trip-modal">End trip</button>'}
        <button class="btn btn-danger btn-auto btn-sm" data-action="delete-trip">Delete trip</button>
      </div>
    </div>`;
}

function renderEndedBanner(currency, total) {
  const days = currentTrip.current_day;
  const members = currentMembers.length;
  const perPerson = members > 0 ? total / members : 0;
  const isCreator = currentTrip.creator_id === window._currentUser?.id;
  return `
    ${renderDisplayCurrencyControl()}
    <div class="ended-banner">
      <h3>🎉 Trip Complete</h3>
      <p class="ended-copy">This trip has been ended.</p>
      <div class="ended-grid">
        <div class="ended-tile"><div class="ended-tile-val">${formatMoney(total, currency)}</div><div class="ended-tile-label">Total</div></div>
        <div class="ended-tile"><div class="ended-tile-val">${formatMoney(perPerson, currency)}</div><div class="ended-tile-label">Per person</div></div>
        <div class="ended-tile"><div class="ended-tile-val">${days}</div><div class="ended-tile-label">Days</div></div>
        <div class="ended-tile"><div class="ended-tile-val">${currentExpenses.length}</div><div class="ended-tile-label">Expenses</div></div>
      </div>
      <div class="ended-actions">
        <button class="btn btn-secondary btn-auto btn-sm" data-action="export-csv">Export CSV</button>
      </div>
    </div>
    ${isCreator ? renderTripActions({ ended: true }) : ''}
    <div class="card">
      <div class="section-title">Spending by category</div>
      ${renderCategoryBars(currency)}
    </div>`;
}

function renderCategoryBars(currency) {
  const sym = moneySymbol(currency);
  const total = displayAmount(currentExpenses.reduce((s, e) => s + convertedExpenseAmount(e), 0));
  const catTotals = {};
  currentExpenses.forEach(e => {
    catTotals[e.category] = (catTotals[e.category] || 0) + displayAmount(convertedExpenseAmount(e));
  });
  const topCats = Object.entries(catTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (!topCats.length) return '<p class="empty-category-copy">No expenses yet.</p>';

  let acc = 0;
  const donutSegments = topCats
    .map(([cat, amt]) => {
      const pct = total > 0 ? (amt / total) * 100 : 0;
      const segment = `<circle class="donut-segment ${categoryClass(cat)}" cx="18" cy="18" r="15.9155" pathLength="100" stroke-dasharray="${pct.toFixed(2)} ${(100 - pct).toFixed(2)}" stroke-dashoffset="-${acc.toFixed(2)}"></circle>`;
      acc += pct;
      return segment;
    })
    .join('');

  const donut = `<div class="donut-outer">
    <svg class="donut-ring" viewBox="0 0 36 36" aria-hidden="true"><circle class="donut-base" cx="18" cy="18" r="15.9155"></circle>${donutSegments}</svg>
    <div class="donut-inner">
      <div class="donut-total">${sym}${total.toFixed(0)}</div>
      <div class="donut-sub">total</div>
    </div>
  </div>`;

  const bars = topCats
    .map(([cat, amt]) => {
      const pct = total > 0 ? ((amt / total) * 100).toFixed(1) : 0;
      const emoji = CATEGORIES[cat] || '📦';
      const label = cat === 'hotel' ? 'Stay' : cat.charAt(0).toUpperCase() + cat.slice(1);
      const catClass = categoryClass(cat);
      return `<div class="bar-row">
      <div class="bar-label-row">
        <span class="bar-cat-label"><span class="bar-cat-dot ${catClass}"></span><span class="bar-cat-emoji">${emoji}</span>${esc(label)}</span>
        <span class="bar-amt">${formatMoney(amt, currency)}<span class="bar-pct">${pct}%</span></span>
      </div>
      <progress class="bar-fill ${catClass}" max="100" value="${pct}">${pct}%</progress>
    </div>`;
    })
    .join('');

  return `<div class="cat-chart-layout">${donut}<div class="cat-bars">${bars}</div></div>`;
}

// ─── Expenses tab ──────────────────────────────────────────────
function renderExpensesTab() {
  const trip = currentTrip;
  const isCreator = trip.creator_id === window._currentUser?.id;
  const el = document.getElementById('tab-expenses');

  const me = currentMembers.find(m => m.user_id === window._currentUser?.id);
  const filters = [
    ['all', 'All'],
    ['mine', 'Mine'],
    ['unpaid', 'Unpaid'],
    ['hotel', 'Stay'],
    ['food', 'Food'],
    ['transport', 'Transport'],
  ];
  const filteredExpenses = currentExpenses.filter(e => {
    if (expenseFilter === 'all') return true;
    if (expenseFilter === 'mine') return e.paid_by === me?.id || e.created_by === window._currentUser?.id;
    if (expenseFilter === 'unpaid') return !currentSettled.includes(e.day_number);
    return e.category === expenseFilter;
  });

  if (!currentExpenses.length) {
    el.innerHTML = `${renderAddExpenseAction()}<div class="empty-state"><div class="empty-icon">💸</div><p>No expenses yet.</p></div>`;
    return;
  }

  const byDay = {};
  filteredExpenses.forEach(e => {
    if (!byDay[e.day_number]) byDay[e.day_number] = [];
    byDay[e.day_number].push(e);
  });

  const memberMap = {};
  currentMembers.forEach(m => {
    memberMap[m.id] = m.name;
  });

  const days = Object.keys(byDay)
    .map(Number)
    .sort((a, b) => a - b);

  const filterBar = `<div class="expense-filter-row">${filters
    .map(
      ([value, label]) =>
        `<button class="filter-chip${expenseFilter === value ? ' active' : ''}" data-action="set-expense-filter" data-value="${value}">${label}</button>`,
    )
    .join('')}</div>`;

  el.innerHTML =
    renderAddExpenseAction() +
    filterBar +
    (days.length
      ? days
          .map(day => {
            const exps = byDay[day];
            const dayTotal = exps.reduce((s, e) => s + convertedExpenseAmount(e), 0);
            const settled = currentSettled.includes(day);

            const expRows = exps
              .map(e => {
                const categoryIcon = renderExpenseCategoryIcon(e.category);
                const paidBy = memberMap[e.paid_by] || 'Unknown';
                const myMember = currentMembers.find(m => m.user_id === window._currentUser?.id);
                const splitRows = currentSplits.filter(s => s.expense_id === e.id);
                const mySplit = splitRows.find(s => s.member_id === myMember?.id);
                const status = settled
                  ? '<span class="expense-status neutral">Settled</span>'
                  : e.paid_by === myMember?.id
                    ? '<span class="expense-status owed">Owed to you</span>'
                    : mySplit
                      ? '<span class="expense-status owe">You owe</span>'
                      : '<span class="expense-status neutral">Not involved</span>';
                const del =
                  (isCreator || e.created_by === window._currentUser?.id) && trip.status !== 'ended' && !settled
                    ? `<button class="btn-del" data-action="delete-expense" data-id="${e.id}">✕</button>`
                    : '';
                return `<div class="expense-card">
        <div class="exp-cat ${categoryClass(e.category)}">${categoryIcon}</div>
        <div class="exp-info">
          <span class="exp-title">${esc(e.title)}</span>
          <span class="exp-meta">${esc(paidBy)} paid · split ${splitRows.length || currentMembers.length} ways</span>
          ${e.note ? `<span class="exp-note">${esc(e.note)}</span>` : ''}
        </div>
        <div class="exp-right">
          <span class="exp-amount">${renderExpenseAmount(e)}</span>
          ${status}
          ${del}
        </div>
      </div>`;
              })
              .join('');

            const settleBtn =
              isCreator && !settled && trip.status !== 'ended'
                ? `<div class="settle-day-row"><button class="btn btn-secondary btn-sm btn-auto" data-action="open-settle-day-modal" data-value="${day}">Settle Day ${day}</button></div>`
                : '';

            const settledBadge = settled ? '<span class="badge badge-settled settled-badge">Settled</span>' : '';

            const collapsedClass = settled ? ' collapsed' : '';
            const dayHdrClick = settled ? ' data-action="toggle-day-section" role="button" tabindex="0"' : '';
            const chevronHtml = settled ? '<span class="day-chevron">›</span>' : '';

            return `<div class="day-section${settled ? ' settled' : ''}${collapsedClass}">
      <div class="day-hdr"${dayHdrClick}>
        <span class="day-label">${formatTripDayLabel(trip, day)}</span>
        ${settledBadge}
        <span class="day-total">${formatMoney(dayTotal, trip.currency)}</span>
        ${chevronHtml}
      </div>
      <div class="day-body"${settled ? ' hidden' : ''}>${expRows}</div>
      ${settleBtn}
    </div>`;
          })
          .join('')
      : '<div class="empty-state"><div class="empty-icon">⌕</div><p>No expenses match this filter.</p></div>');
}

function setExpenseFilter(filter) {
  expenseFilter = filter;
  renderExpensesTab();
}

// ─── Analytics tab ────────────────────────────────────────────
function renderAnalyticsTab() {
  const el = document.getElementById('tab-analytics');
  const currency = getDisplayCurrency();
  const total = displayAmount(currentExpenses.reduce((sum, e) => sum + convertedExpenseAmount(e), 0));
  const budget = currentTrip.budget ? displayAmount(Number(currentTrip.budget)) : 0;
  const budgetRemaining = budget ? budget - total : 0;
  const average = total / Math.max(currentTrip.current_day || 1, 1);
  const me = currentMembers.find(m => m.user_id === window._currentUser?.id);
  const personallyPaid = me
    ? displayAmount(
        currentExpenses
          .filter(expense => expense.paid_by === me.id)
          .reduce((sum, expense) => sum + convertedExpenseAmount(expense), 0),
      )
    : 0;
  const { balances } = calcBalances();
  const myBalance = me ? displayAmount(balances[me.id] || 0) : 0;
  const chart = analyticsMode === 'category' ? renderCategoryBars(currency) : renderDaySpendingChart(currency);
  el.innerHTML = `
    <div class="section-heading"><div><span class="eyebrow">Trip insights</span><h2>Budget &amp; analytics</h2></div>${renderDisplayCurrencyControl()}</div>
    <div class="segmented-control">
      <button class="${analyticsMode === 'category' ? 'active' : ''}" data-action="set-analytics-mode" data-value="category">By category</button>
      <button class="${analyticsMode === 'day' ? 'active' : ''}" data-action="set-analytics-mode" data-value="day">By day</button>
    </div>
    <div class="analytics-grid">
      <div class="card analytics-chart"><div class="section-title">${analyticsMode === 'category' ? 'Category breakdown' : 'Daily spending'}</div>${chart}</div>
      <aside class="insight-stack">
        <div class="insight-card"><span>You spent</span><strong>${formatMoney(personallyPaid, currency)}</strong><small>Expenses paid by you</small></div>
        <div class="insight-card"><span>Average per day</span><strong>${formatMoney(average, currency)}</strong><small>${currentTrip.current_day} tracked day${currentTrip.current_day === 1 ? '' : 's'}</small></div>
        <div class="insight-card ${myBalance < 0 ? 'negative' : ''}"><span>Your balance</span><strong>${myBalance >= 0 ? '+' : '−'}${formatMoney(Math.abs(myBalance), currency)}</strong><small>${myBalance > 0.009 ? 'You get back' : myBalance < -0.009 ? 'You owe' : 'All settled'}</small></div>
        <div class="insight-card ${budget && budgetRemaining < 0 ? 'negative' : ''}"><span>${budget ? 'Budget remaining' : 'Total expenses'}</span><strong>${budget ? `${budgetRemaining < 0 ? '−' : ''}${formatMoney(Math.abs(budgetRemaining), currency)}` : currentExpenses.length}</strong><small>${budget ? `${formatMoney(total, currency)} of ${formatMoney(budget, currency)} spent` : `${formatMoney(total, currency)} spent together`}</small></div>
      </aside>
    </div>`;
}

function setAnalyticsMode(mode) {
  analyticsMode = mode;
  renderAnalyticsTab();
}

function calcBalances() {
  const net = {};
  currentMembers.forEach(m => {
    net[m.id] = 0;
  });

  currentExpenses.forEach(exp => {
    const splits = currentSplits.filter(s => s.expense_id === exp.id);
    if (!splits.length) return;
    const amount = convertedExpenseAmount(exp);
    net[exp.paid_by] = (net[exp.paid_by] || 0) + amount;
    if (exp.split_type === 'equal') {
      // Stored split rows must add up in cents, so a repeating share such as
      // 20 / 3 carries a remainder. Calculate equal balances at full precision
      // across the trip so that the same member is not charged that cent on
      // every expense merely because of row order.
      const equalShare = amount / splits.length;
      splits.forEach(s => {
        net[s.member_id] = (net[s.member_id] || 0) - equalShare;
      });
    } else {
      splits.forEach(s => {
        net[s.member_id] = (net[s.member_id] || 0) - parseFloat(s.share_amount);
      });
    }
  });

  currentPayments.forEach(p => {
    net[p.from_member] = (net[p.from_member] || 0) + parseFloat(p.amount);
    net[p.to_member] = (net[p.to_member] || 0) - parseFloat(p.amount);
  });

  // Greedy debt simplification
  const suggestions = [];
  const debtors = Object.entries(net)
    .filter(([, v]) => v < -0.005)
    .map(([id, v]) => ({ id, amt: -v }));
  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0.005)
    .map(([id, v]) => ({ id, amt: v }));
  debtors.sort((a, b) => b.amt - a.amt);
  creditors.sort((a, b) => b.amt - a.amt);

  let di = 0,
    ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const pay = Math.min(debtors[di].amt, creditors[ci].amt);
    suggestions.push({ from: debtors[di].id, to: creditors[ci].id, amount: parseFloat(pay.toFixed(2)) });
    debtors[di].amt -= pay;
    creditors[ci].amt -= pay;
    if (debtors[di].amt < 0.005) di++;
    if (creditors[ci].amt < 0.005) ci++;
  }

  return { balances: net, suggestions };
}

// ─── Members tab ──────────────────────────────────────────────
function renderMembersTab() {
  const trip = currentTrip;
  const isCreator = trip.creator_id === window._currentUser?.id;
  const el = document.getElementById('tab-members');

  const alreadyAdded = new Set(currentMembers.map(m => m.name.trim().toLocaleLowerCase()));
  const availableContacts = currentContacts.filter(c => !alreadyAdded.has(c.name.trim().toLocaleLowerCase()));

  const quickAdd =
    isCreator && trip.status !== 'ended' && availableContacts.length
      ? `<div class="contacts-section">
        <div class="contacts-label">Quick add</div>
        <div class="contacts-chips">
          ${availableContacts
            .map(
              c =>
                `<button class="contact-chip" data-name="${esc(c.name)}" data-action="add-member-from-contact">${esc(c.name)}</button>`,
            )
            .join('')}
        </div>
      </div>`
      : '';

  const addRow =
    isCreator && trip.status !== 'ended'
      ? `<div class="add-row member-add-row">
        <input type="text" id="new-member-name" placeholder="Member name…" maxlength="40" autocomplete="off">
        <button class="btn btn-secondary btn-sm btn-auto" data-action="add-member">Add</button>
      </div>`
      : '';

  const memberActions = m => {
    const isYou = m.user_id === window._currentUser?.id;
    const del =
      isCreator && trip.status !== 'ended' && !m.user_id
        ? `<button class="btn btn-danger btn-sm btn-auto" data-action="delete-member" data-id="${m.id}">Remove</button>`
        : '';
    const leave =
      !isCreator && isYou
        ? '<button class="btn btn-danger btn-sm btn-auto" data-action="leave-trip">Leave</button>'
        : '';
    const paypalUrl = normalizePaypalLink(m.paypal_link);
    const paypal = paypalUrl
      ? `<a class="paypal-link" href="${esc(paypalUrl)}" target="_blank" rel="noopener noreferrer">Open PayPal</a>`
      : '';
    const editPaypal =
      paypalUrl && trip.status !== 'ended' && ((isCreator && !m.user_id) || isYou)
        ? `<button class="btn btn-secondary btn-sm btn-auto" title="Edit PayPal link" data-member-id="${m.id}" data-paypal="${esc(m.paypal_link || '')}" data-action="edit-paypal-link">PayPal</button>`
        : '';
    const editName =
      trip.status !== 'ended' && isYou
        ? `<button class="btn btn-secondary btn-sm btn-auto" title="Edit name" data-member-id="${m.id}" data-name="${esc(m.name)}" data-action="edit-member-name">Edit name</button>`
        : '';
    const controls = `${paypal}${editName}${editPaypal}${del}${leave}`;
    return controls ? `<div class="member-row-actions split-member-actions">${controls}</div>` : '';
  };

  const { balances, suggestions } = calcBalances();
  const memberMap = Object.fromEntries(currentMembers.map(m => [m.id, m]));
  const settlementRowsFor = memberId =>
    suggestions
      .filter(s => s.from === memberId)
      .map(s => {
        const from = memberMap[s.from],
          to = memberMap[s.to];
        if (!from || !to) return '';
        const canRecordPayment = trip.status !== 'ended' && (isCreator || from.user_id === window._currentUser?.id);
        const paypalUrl = normalizePaypalLink(to.paypal_link);
        return `<div class="member-settlement-action" data-balance-member="${esc(from.id)}"><span>Pay ${esc(to.name)}</span><strong>${formatMoney(s.amount, currentTrip.currency)}</strong><div>${canRecordPayment ? `<button class="btn btn-secondary btn-sm btn-auto" data-action="open-payment-modal" data-from="${s.from}" data-to="${s.to}" data-amount="${s.amount}">Record payment</button>` : ''}${paypalUrl ? `<a class="paypal-link" href="${esc(paypalUrl)}" target="_blank" rel="noopener noreferrer">Open PayPal</a>` : ''}</div></div>`;
      })
      .join('');
  const paidRows = currentMembers
    .map(m => {
      const memberExpenses = currentExpenses.filter(e => e.paid_by === m.id);
      const paid = memberExpenses.reduce((sum, e) => sum + convertedExpenseAmount(e), 0);
      const net = balances[m.id] || 0;
      const pill =
        net > 0.005
          ? `Gets back ${formatMoney(net, currentTrip.currency)}`
          : net < -0.005
            ? `Owes ${formatMoney(Math.abs(net), currentTrip.currency)}`
            : 'Settled';
      const memberSettlements = settlementRowsFor(m.id);
      return `<details class="member-balance-item split-member-row" data-member-id="${esc(m.id)}"><summary>${memberAvatar(m.name, 42)}<span class="member-balance-copy"><strong>${esc(m.name)}${m.user_id === window._currentUser?.id ? ' · you' : ''}</strong><small>Paid ${memberExpenses.length} expense${memberExpenses.length === 1 ? '' : 's'} · ${formatMoney(paid, currentTrip.currency)}</small></span><span class="member-balance-pill ${net > 0.005 ? 'is-owed' : net < -0.005 ? 'is-owe' : 'is-square'}">${pill}</span><span class="member-balance-chevron" aria-hidden="true">›</span></summary><div class="member-balance-details">${memberSettlements}${memberActions(m) || '<span class="member-balance-note">No payment actions</span>'}</div></details>`;
    })
    .join('');
  const paymentRows = currentPayments
    .map(payment => {
      const from = memberMap[payment.from_member]?.name || '?';
      const to = memberMap[payment.to_member]?.name || '?';
      const canDeletePayment =
        isCreator && trip.status !== 'ended' && !currentSettled.includes(Number(payment.day_number));
      const remove = canDeletePayment
        ? `<button class="btn-del" data-action="delete-payment" data-id="${payment.id}" aria-label="Delete payment">✕</button>`
        : '';
      return `<div class="suggestion-row"><span class="sugg-text">${esc(from)} paid ${esc(to)} <span class="sugg-amount">${formatMoney(payment.amount, currentTrip.currency)}</span>${payment.note ? ` · ${esc(payment.note)}` : ''}</span>${remove}</div>`;
    })
    .join('');
  const fairShare = currentMembers.length
    ? currentExpenses.reduce((sum, e) => sum + convertedExpenseAmount(e), 0) / currentMembers.length
    : 0;
  const memberAddControls =
    quickAdd || addRow
      ? `<section class="member-add-controls" aria-label="Add members">${quickAdd}${addRow}</section>`
      : '';
  el.innerHTML = `<div class="section-heading"><div><span class="eyebrow">Group expenses</span><h2>Members &amp; split</h2></div></div>
    ${memberAddControls}
    <div class="members-layout"><div>
      <div class="balance-section-heading"><span>Members &amp; balances</span><small>Average spend ${formatMoney(fairShare, currentTrip.currency)} each</small></div>
      <div class="member-balance-list">${paidRows || '<p class="empty-hint">No members yet.</p>'}</div>
      ${suggestions.length ? (isCreator ? '<button class="settle-all-button" data-action="settle-all-balances">Settle all balances</button>' : '') : '<div class="all-settled-card">✓ Everyone is settled up</div>'}
      ${paymentRows ? `<div class="card"><div class="card-label">Recorded payments</div>${paymentRows}</div>` : ''}
    </div></div>`;
}

async function settleAllBalances() {
  if (currentTrip?.status === 'ended') {
    showToast('Ended trips are read-only.', 'error');
    return;
  }
  const { suggestions } = calcBalances();
  if (!suggestions.length) {
    showToast('Everyone is already settled.');
    return;
  }
  const ok = await appConfirm({
    title: 'Settle all balances?',
    message: 'This records every suggested transfer as paid.',
    okText: 'Settle Up',
  });
  if (!ok) return;
  const rows = suggestions.map(s => ({
    trip_id: currentTrip.id,
    from_member: s.from,
    to_member: s.to,
    amount: s.amount,
    note: 'Settle Up',
    day_number: currentTrip.current_day,
  }));
  const { error } = await db.from('payments').insert(rows);
  if (error) {
    showDataError('Unable to settle all balances.');
    return;
  }
  const { data } = await db.from('payments').select('*').eq('trip_id', currentTrip.id);
  currentPayments = data || currentPayments;
  syncCurrentTripCache();
  renderMembersTab();
  showToast('Balances settled.');
}

function renderProfileScreen() {
  const user = window._currentUser;
  const profile = window._currentProfile || {};
  const isGuestAccount =
    typeof isAnonymousAuthUser === 'function' ? isAnonymousAuthUser(user) : Boolean(user?.is_anonymous);
  // Browser rendering stays platform-neutral; only the iOS app labels Apple identities.
  const nativeAppleAccount =
    isAppleAccount(user) &&
    Boolean(window.Capacitor?.isNativePlatform?.()) &&
    window.Capacitor?.getPlatform?.() === 'ios';
  const hasEmailAccount = Boolean(user?.email);
  const accountLabel =
    user?.email || (nativeAppleAccount ? 'Apple account' : isGuestAccount ? 'Guest account' : 'Signed-in account');
  const name = profile.display_name || user?.email?.split('@')[0] || 'Traveller';
  const initials = name
    .split(/\s+/)
    .map(part => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const theme = localStorage.getItem('tc-theme') || 'system';
  const homeCurrency = normalizeCurrency(localStorage.getItem('tc-home-currency') || 'EUR');
  const savedDefaultSplit = localStorage.getItem('tc-default-split');
  const defaultSplit = ['equal', 'exact'].includes(savedDefaultSplit) ? savedDefaultSplit : 'equal';
  const passwordControl =
    user?.email && typeof userHasPasswordIdentity === 'function' && userHasPasswordIdentity(user)
      ? '<button data-action="open-change-password"><span><b>Change password</b><small>Update your account password</small></span><em>›</em></button>'
      : '';
  const emailControl = hasEmailAccount
    ? '<button data-action="open-account-settings" data-section="email"><span><b>Change email</b><small>Confirm a new sign-in email</small></span><em>›</em></button>'
    : '';
  const deleteDataControl = hasEmailAccount
    ? '<button data-action="open-account-settings" data-section="data-delete"><span><b>Delete my data</b><small>Keep the login but remove eligible personal data</small></span><em>›</em></button>'
    : '';
  const deleteAccountControl =
    user && !isGuestAccount
      ? '<button data-action="open-account-settings" data-section="account-delete"><span><b>Delete account</b><small>Confirm permanent account closure</small></span><em>›</em></button>'
      : '';
  document.getElementById('profile-content').innerHTML = `
    <h1 class="profile-title">Profile</h1>
    <section class="profile-identity"><div class="profile-avatar">${esc(initials)}</div><div><h1>${esc(name)}</h1><p>${esc(accountLabel)}</p></div><button class="profile-edit" data-action="open-account-settings">Edit</button></section>
    <div class="profile-grid">
      <section class="settings-group" data-profile-section="personal"><h2>Personal</h2>
        <button data-action="open-account-settings" data-section="profile"><span><b>Personal details</b><small>Name and PayPal link</small></span><em>›</em></button>
      </section>
      <section class="settings-group" data-profile-section="preferences"><h2>Preferences</h2>
        <label class="settings-select-row"><span><b>Home currency</b></span><select data-change-action="save-profile-preference" data-key="tc-home-currency">${currencyOptions(homeCurrency)}</select></label>
        <label class="settings-select-row"><span><b>Default split</b></span><select data-change-action="save-profile-preference" data-key="tc-default-split"><option value="equal"${defaultSplit === 'equal' ? ' selected' : ''}>Equally</option><option value="exact"${defaultSplit === 'exact' ? ' selected' : ''}>Exact amounts</option></select></label>
        <button data-action="toggle-profile-theme"><span><b>Appearance</b><small>Light, dark or system</small></span><em>${esc(theme)}</em></button>
      </section>
      ${emailControl || passwordControl ? `<section class="settings-group" data-profile-section="security"><h2>Security</h2>${emailControl}${passwordControl}</section>` : ''}
      <section class="settings-group" data-profile-section="support-legal"><h2>Support &amp; Legal</h2>
        <button data-action="open-landing-legal" data-value="support"><span><b>Help &amp; support</b></span><em>›</em></button>
        <button data-action="open-landing-legal" data-value="privacy"><span><b>Privacy policy</b></span><em>›</em></button>
        <button data-action="open-landing-legal" data-value="terms"><span><b>Terms of use</b></span><em>›</em></button>
        <a href="https://tripcash.de/" target="_blank" rel="noopener noreferrer"><span><b>Visit our website</b></span><em>›</em></a>
      </section>
      <section class="settings-group" data-profile-section="account-actions"><h2>Account actions</h2>
        <button id="btn-export-account" data-action="export-account-data"><span><b>Export my data</b><small>Download a portable account copy</small></span><em>›</em></button>
        ${currentTrip ? '<button data-action="export-csv"><span><b>Export trip data</b><small>Download the current trip as CSV</small></span><em>›</em></button>' : ''}
        ${deleteDataControl}
        <button data-action="handle-logout"><span><b>Log out</b></span><em>›</em></button>
        ${deleteAccountControl}
      </section>
    </div>
  `;
}

async function saveProfilePreference(key, value, { silent = false } = {}) {
  const field = PROFILE_PREFERENCE_FIELDS[key];
  if (!field) return;
  const normalized = normalizeProfilePreference(key, value);
  const previous = localStorage.getItem(key);

  localStorage.setItem(key, normalized);
  if (key === 'tc-default-split') splitType = normalized;
  if (key === 'tc-theme') applyTheme(normalized);
  if (window._currentProfile) {
    window._currentProfile[field] = normalized;
    cacheProfile(window._currentUser, window._currentProfile);
  }

  if (!window._currentUser) {
    if (!silent) showToast('Preference saved on this device.');
    return;
  }

  const result = await saveOfflineCapableMutation('Update profile preference', [
    {
      method: 'update',
      table: 'profiles',
      values: { [field]: normalized, preferences_initialized: true },
      match: { id: window._currentUser.id },
    },
  ]);
  if (result.status === 'error') {
    const restored = normalizeProfilePreference(key, previous);
    localStorage.setItem(key, restored);
    if (key === 'tc-default-split') splitType = restored;
    if (key === 'tc-theme') applyTheme(restored);
    if (window._currentProfile) {
      window._currentProfile[field] = restored;
      cacheProfile(window._currentUser, window._currentProfile);
    }
    showDataError('Unable to save preference.');
    return;
  }
  if (!silent) {
    showToast(
      result.status === 'queued' ? 'Preference saved offline — it will sync automatically.' : 'Preference saved.',
    );
  }
}

// ─── Activity tab ─────────────────────────────────────────────
async function renderActivityTab() {
  const el = document.getElementById('tab-activity');
  const tripId = currentTrip.id;
  const cached = activityCache.get(tripId);
  if (cached) renderActivityLogs(el, cached);
  else el.innerHTML = '<div class="empty-hint">Loading recent activity…</div>';
  if (cached && Date.now() - (activityFetchedAt.get(tripId) || 0) < 30000) return;

  if (!activityLoadPromises.has(tripId)) {
    activityLoadPromises.set(
      tripId,
      db.from('activity_log').select('*').eq('trip_id', tripId).order('created_at', { ascending: false }).limit(100),
    );
  }
  const { data: logs } = await activityLoadPromises.get(tripId);
  activityLoadPromises.delete(tripId);
  activityCache.set(tripId, logs || []);
  activityFetchedAt.set(tripId, Date.now());
  if (currentTrip?.id === tripId && currentTab === 'activity') renderActivityLogs(el, logs || []);
}

function renderActivityLogs(el, logs) {
  if (!logs || !logs.length) {
    el.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div><p>No activity yet.</p></div>';
    return;
  }

  el.innerHTML = `<div class="card">${logs
    .map(l => {
      const ts = relativeTime(new Date(l.created_at));
      return `<div class="activity-item">
      <div class="activity-dot"></div>
      <div>
        <div class="activity-desc">${esc(l.description)}</div>
        <div class="activity-time">${ts}</div>
      </div>
    </div>`;
    })
    .join('')}</div>`;
}

function relativeTime(date) {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── New trip modal ────────────────────────────────────────────
function openNewTripModal() {
  editingTripId = null;
  selectedEmoji = '✈️';
  document.getElementById('trip-name').value = '';
  document.getElementById('trip-budget').value = '';
  document.getElementById('trip-start-date').value = '';
  document.getElementById('trip-end-date').value = '';
  const currencyEl = document.getElementById('trip-currency');
  if (currencyEl) {
    currencyEl.value = normalizeCurrency(localStorage.getItem('tc-home-currency') || 'EUR');
    currencyEl.disabled = false;
  }
  document.getElementById('trip-modal-title').textContent = 'New trip';
  document.getElementById('btn-create-trip').textContent = 'Create trip';
  inlineFormValidators.get('form-new-trip')?.clear();
  renderEmojiPicker();
  openModal('modal-new-trip');
}

function openEditTripModal() {
  if (!currentTrip || currentTrip.status === 'ended' || currentTrip.creator_id !== window._currentUser?.id) return;
  editingTripId = currentTrip.id;
  selectedEmoji = currentTrip.emoji || '✈️';
  document.getElementById('trip-name').value = currentTrip.name || '';
  document.getElementById('trip-budget').value = currentTrip.budget ?? '';
  document.getElementById('trip-start-date').value = currentTrip.start_date || '';
  document.getElementById('trip-end-date').value = currentTrip.end_date || '';
  const currencyEl = document.getElementById('trip-currency');
  if (currencyEl) {
    currencyEl.value = normalizeCurrency(currentTrip.currency);
    currencyEl.disabled = true;
  }
  document.getElementById('trip-modal-title').textContent = 'Edit trip';
  document.getElementById('btn-create-trip').textContent = 'Save changes';
  inlineFormValidators.get('form-new-trip')?.clear();
  renderEmojiPicker();
  openModal('modal-new-trip');
}

function renderEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;
  picker.innerHTML = EMOJIS.map(
    e =>
      `<button type="button" class="emoji-btn${e === selectedEmoji ? ' selected' : ''}" data-action="select-emoji" data-value="${e}" aria-label="Use ${e} trip emoji" aria-pressed="${e === selectedEmoji}">${e}</button>`,
  ).join('');
}

function selectEmoji(e) {
  selectedEmoji = e;
  renderEmojiPicker();
}

const inlineFormValidators = new Map();

function attachInlineFormValidation(formId, fieldIds, messageFor) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.noValidate = true;
  const touched = new Set();
  const errors = new Map();
  for (const id of fieldIds) {
    const input = document.getElementById(id);
    const group = input?.closest('.form-group');
    if (!input || !group) continue;
    const error = document.createElement('p');
    error.id = `${id}-error`;
    error.className = 'form-inline-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    group.append(error);
    input.setAttribute(
      'aria-describedby',
      [input.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '),
    );
    errors.set(id, { input, group, error });
  }
  function render(id) {
    const field = errors.get(id);
    if (!field) return '';
    const message = messageFor(id);
    const shown = touched.has(id) && !!message;
    field.error.textContent = shown ? `⚠ ${message}` : '';
    field.error.hidden = !shown;
    field.group.classList.toggle('has-error', shown);
    field.input.setAttribute('aria-invalid', String(shown));
    return message;
  }
  function update(event) {
    const id = event.target.id;
    if (errors.has(id)) render(id);
    if (formId === 'form-new-trip' && id === 'trip-start-date' && touched.has('trip-end-date')) render('trip-end-date');
    if (formId === 'form-change-email' && id === 'settings-new-email' && touched.has('settings-confirm-email'))
      render('settings-confirm-email');
  }
  form.addEventListener('focusout', event => {
    if (event.relatedTarget?.closest?.('.modal-close')) return;
    if (errors.has(event.target.id)) {
      touched.add(event.target.id);
      render(event.target.id);
    }
  });
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  const validator = {
    validateAll() {
      fieldIds.forEach(id => touched.add(id));
      const invalid = fieldIds.find(id => render(id));
      fieldIds.forEach(render);
      if (invalid) errors.get(invalid)?.input.focus();
      return !invalid;
    },
    clear() {
      touched.clear();
      fieldIds.forEach(render);
    },
  };
  inlineFormValidators.set(formId, validator);
}

function tripFieldMessage(id) {
  if (id === 'trip-name') {
    const value = normalizeTripName(document.getElementById(id).value);
    if (!value) return 'Enter a trip name.';
    return isMeaningfulTripName(value) ? '' : 'Use at least 3 characters and a descriptive trip name.';
  }
  if (id === 'trip-budget') {
    const value = document.getElementById(id).value.trim();
    if (!value) return '';
    const amount = parseMoneyInput(value);
    return !/^\d+(?:[.,]\d{1,2})?$/.test(value) || !Number.isFinite(amount) || amount < 0 || amount > MAX_TRIP_BUDGET
      ? 'Enter a budget from 0 to 9,999,999,999.99, with up to two decimals.'
      : '';
  }
  if (id === 'trip-end-date') {
    const start = document.getElementById('trip-start-date').value;
    const end = document.getElementById(id).value;
    return start && end && end < start ? 'End date must be on or after the start date.' : '';
  }
  return '';
}

function profileFieldMessage(id) {
  if (id === 'settings-name') return document.getElementById(id).value.trim() ? '' : 'Enter a display name.';
  if (id === 'settings-paypal') {
    const value = document.getElementById(id).value.trim();
    return value && !normalizePaypalLink(value) ? 'Use a secure https://paypal.me/ link.' : '';
  }
  return '';
}

function changeEmailFieldMessage(id) {
  const current = String(window._currentUser?.email || '')
    .trim()
    .toLowerCase();
  const next = document.getElementById('settings-new-email')?.value.trim().toLowerCase() || '';
  const confirmation = document.getElementById('settings-confirm-email')?.value.trim().toLowerCase() || '';
  if (id === 'settings-new-email') {
    const input = document.getElementById(id);
    if (!next) return 'Enter a new email address.';
    if (!input.validity.valid) return 'Enter a valid email address.';
    return next === current ? 'Enter a different email address.' : '';
  }
  if (id === 'settings-confirm-email') {
    if (!confirmation) return 'Confirm your new email address.';
    if (confirmation !== next) return 'Email addresses do not match.';
  }
  return '';
}

const actionFieldErrors = new Map();

function setActionFieldError(inputId, message = '') {
  const input = document.getElementById(inputId);
  const group = input?.closest('.form-group');
  if (!input || !group) return;
  let error = actionFieldErrors.get(inputId);
  if (!error) {
    error = document.createElement('p');
    error.id = `${inputId}-error`;
    error.className = 'form-inline-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    group.append(error);
    input.setAttribute(
      'aria-describedby',
      [input.getAttribute('aria-describedby'), error.id].filter(Boolean).join(' '),
    );
    actionFieldErrors.set(inputId, error);
    input.addEventListener('input', () => setActionFieldError(inputId));
  }
  error.textContent = message ? `⚠ ${message}` : '';
  error.hidden = !message;
  group.classList.toggle('has-error', !!message);
  input.setAttribute('aria-invalid', String(!!message));
}

async function createTrip(e) {
  e.preventDefault();
  if (inlineFormValidators.get('form-new-trip')?.validateAll() === false) return;
  const name = normalizeTripName(document.getElementById('trip-name').value);
  const currency = normalizeCurrency(document.getElementById('trip-currency')?.value || 'EUR');
  const budgetValue = document.getElementById('trip-budget').value.trim();
  const budget = budgetValue === '' ? null : parseMoneyInput(budgetValue);
  const startDate = document.getElementById('trip-start-date').value || null;
  const endDate = document.getElementById('trip-end-date').value || null;
  if (!isMeaningfulTripName(name)) {
    shake(document.getElementById('trip-name'));
    return;
  }
  if (budget !== null && (!Number.isFinite(budget) || budget < 0 || budget > MAX_TRIP_BUDGET)) {
    showToast('Enter a valid budget within the supported range.', 'error');
    shake(document.getElementById('trip-budget'));
    return;
  }
  if (startDate && endDate && endDate < startDate) {
    shake(document.getElementById('trip-end-date'));
    showToast('End date must be on or after the start date.', 'error');
    return;
  }

  const user = window._currentUser;
  if (!user) {
    showToast('Session expired. Please log in again.', 'error');
    showScreen('auth');
    return;
  }

  setLoading('btn-create-trip', true);

  if (editingTripId) {
    const updates = {
      name,
      emoji: selectedEmoji,
      budget,
      start_date: startDate,
      end_date: endDate,
    };
    const result = await saveOfflineCapableMutation('Update trip', [
      {
        method: 'update',
        table: 'trips',
        values: updates,
        match: { id: editingTripId },
      },
    ]);
    setLoading('btn-create-trip', false);
    if (result.status === 'error') {
      showDataError('Unable to update this trip.');
      return;
    }

    Object.assign(currentTrip, updates);
    const cached = loadedTrips.find(trip => trip.id === editingTripId);
    if (cached) Object.assign(cached, updates);
    persistTripsCache();
    syncCurrentTripCache();
    document.getElementById('dash-trip-name').textContent =
      `${currentTrip.emoji || '✈️'} ${displayTripName(currentTrip.name)}`;
    closeModal('modal-new-trip');
    switchTab(currentTab);
    showToast(result.status === 'queued' ? 'Trip updated offline — it will sync automatically.' : 'Trip updated');
    editingTripId = null;
    return;
  }

  const tripId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const now = new Date().toISOString();
  const trip = {
    id: tripId,
    name,
    currency,
    emoji: selectedEmoji,
    budget,
    start_date: startDate,
    end_date: endDate,
    creator_id: user.id,
    current_day: 1,
    status: 'active',
    created_at: now,
  };
  const membership = {
    id: crypto.randomUUID(),
    trip_id: tripId,
    user_id: user.id,
    role: 'creator',
    joined_at: now,
  };
  const member = {
    id: memberId,
    trip_id: tripId,
    user_id: user.id,
    name: currentUserMemberName(),
    paypal_link: window._currentProfile?.paypal_link || null,
    created_at: now,
  };
  const result = await saveOfflineCapableMutation('Create trip', [
    { method: 'upsert-ignore', table: 'trips', values: trip },
    { method: 'upsert-ignore', table: 'trip_members', values: membership },
    { method: 'upsert-ignore', table: 'members', values: member },
  ]);
  setLoading('btn-create-trip', false);

  if (result.status === 'error') {
    showDataError('Unable to create this trip.');
    return;
  }

  loadedTrips.unshift({ ...trip, _total: 0, _myTotal: 0, _expenseCount: 0, _categories: {}, _members: 1 });
  persistTripsCache();
  tripViewCache.set(tripId, {
    trip,
    members: [member],
    expenses: [],
    splits: [],
    settled: [],
    payments: [],
    contacts: currentContacts,
    role: 'creator',
  });
  persistTripViewCache(tripId);

  closeModal('modal-new-trip');
  showToast(result.status === 'queued' ? 'Trip created offline — it will sync automatically.' : 'Trip created!');
  openTrip(tripId);
}

// ─── Add expense screen ────────────────────────────────────────
function normalizeReceiptExpenseDraft(expenseDraft) {
  const receiptDraft = expenseDraft?.receiptDraft || expenseDraft;
  if (receiptDraft?.source !== 'receipt') return null;
  const suggestions =
    receiptDraft.suggestions && typeof receiptDraft.suggestions === 'object' ? receiptDraft.suggestions : {};
  const title = typeof suggestions.title === 'string' ? suggestions.title.trim().slice(0, 80) : '';
  const amount = Number(suggestions.amount);
  const currency = SUPPORTED_CURRENCIES.includes(suggestions.currency) ? suggestions.currency : '';
  const category = Object.hasOwn(CATEGORIES, suggestions.category) ? suggestions.category : '';
  const photoName =
    typeof receiptDraft.photo?.name === 'string' ? receiptDraft.photo.name.trim().slice(0, 120) : 'Receipt photo';
  return {
    photoName,
    suggestions: {
      title,
      amount: Number.isFinite(amount) && amount > 0 && amount <= MAX_EXPENSE_AMOUNT ? amount : null,
      currency,
      category,
    },
  };
}

function applyReceiptExpenseDraft(expenseDraft) {
  const notice = document.getElementById('expense-receipt-draft-notice');
  const draft = normalizeReceiptExpenseDraft(expenseDraft);
  if (!draft) {
    if (notice) {
      notice.hidden = true;
      notice.textContent = '';
    }
    return;
  }

  const { title, amount, currency, category } = draft.suggestions;
  if (title) document.getElementById('exp-title').value = title;
  if (amount !== null) document.getElementById('exp-amount').value = String(amount);
  if (currency) document.getElementById('exp-currency').value = currency;
  if (category) selectExpenseCategory(category, { manual: false });
  updateExpenseCurrencyUI();
  updateSplitRemainder();

  if (notice) {
    const hasSuggestions = Boolean(title || amount !== null || currency || category);
    notice.textContent = hasSuggestions
      ? 'Receipt details were suggested. Check them before saving — payer and split are unchanged.'
      : `${draft.photoName} is ready. Add the expense details manually; the photo is not stored.`;
    notice.hidden = false;
  }
}

function openAddExpenseModal(expenseDraft = null) {
  if (!currentTrip) {
    showToast('Open a trip before adding an expense.', 'error');
    return;
  }
  if (currentTrip.status === 'ended') {
    showToast('Ended trips are view-only.', 'error');
    return;
  }
  if (!currentMembers.length) {
    showToast('Add at least one member first.', 'error');
    return;
  }
  const savedSplit = localStorage.getItem('tc-default-split');
  splitType = ['equal', 'exact'].includes(savedSplit) ? savedSplit : 'equal';
  expSplitChecked = {};
  expenseCategoryManuallySelected = false;
  currentMembers.forEach(m => {
    expSplitChecked[m.id] = true;
  });

  document.getElementById('exp-title').value = '';
  document.getElementById('exp-amount').value = '';
  document.getElementById('exp-note').value = '';
  const currencyEl = document.getElementById('exp-currency');
  if (currencyEl) currencyEl.value = normalizeCurrency(currentTrip.currency);
  document.getElementById('exp-paid-by').innerHTML = currentMembers
    .map(m => `<option value="${m.id}">${esc(m.name)}</option>`)
    .join('');
  selectExpenseCategory('other', { manual: false });
  renderExpensePayerChips();
  updateExpenseCurrencyUI();
  document.getElementById('exp-day').value = currentTrip.current_day;
  document.getElementById('exp-day').max = currentTrip.current_day;

  setSplitType(splitType);
  applyReceiptExpenseDraft(expenseDraft);
  showScreen('expense');
}

function closeExpenseScreen(destination = currentTab) {
  if (!currentTrip) {
    goToTrips();
    return;
  }
  showScreen('dashboard');
  switchTab(destination === 'overview' ? 'overview' : 'expenses');
}

function selectExpenseCategory(category, { manual = true } = {}) {
  const select = document.getElementById('exp-category');
  if (select) select.value = category;
  document
    .querySelectorAll('#expense-category-grid button')
    .forEach(btn => btn.classList.toggle('active', btn.dataset.category === category));
  if (manual) expenseCategoryManuallySelected = true;
}

function selectExpensePayer(memberId) {
  const select = document.getElementById('exp-paid-by');
  if (select) select.value = memberId;
  renderExpensePayerChips();
}

function renderExpensePayerChips() {
  const el = document.getElementById('expense-payer-chips');
  const selected = document.getElementById('exp-paid-by')?.value;
  if (!el) return;
  el.innerHTML = currentMembers
    .map(
      m =>
        `<button type="button" class="${m.id === selected ? 'active' : ''}" data-action="select-expense-payer" data-id="${m.id}">${esc(m.name)}${m.user_id === window._currentUser?.id ? ' · you' : ''}</button>`,
    )
    .join('');
}

function updateExpenseCurrencyUI() {
  const currency = document.getElementById('exp-currency')?.value || currentTrip?.currency || 'EUR';
  const symbol = document.getElementById('exp-currency-symbol');
  if (symbol) symbol.textContent = moneySymbol(currency).trim();
}

function setSplitType(type) {
  splitType = ['equal', 'exact'].includes(type) ? type : 'equal';
  document.querySelectorAll('.split-type-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  renderSplitSection();
}

function renderSplitSection() {
  const container = document.getElementById('split-section');
  if (!container) return;

  if (splitType === 'equal') {
    const checks = currentMembers
      .map(
        m => `<label class="split-member-card${expSplitChecked[m.id] ? ' active' : ''}">
      <input type="checkbox" ${expSplitChecked[m.id] ? 'checked' : ''} data-change-action="toggle-split-member" data-id="${m.id}">
      ${neutralMemberAvatar(m)}<span class="split-member-name">${esc(m.name)}</span>
    </label>`,
      )
      .join('');
    container.innerHTML = `<div class="split-equal-grid">${checks}</div><div class="split-remainder" id="split-remainder" aria-live="polite"></div>`;
  } else {
    const unit = normalizeCurrency(document.getElementById('exp-currency')?.value || currentTrip.currency);
    const rows = currentMembers
      .map(
        m =>
          `<div class="split-person-row">
        <span class="split-person-name">${esc(m.name)}</span>
        <input type="text" inputmode="decimal" pattern="[0-9]+([.,][0-9]{1,2})?" autocomplete="off" class="split-person-input" id="split-${m.id}"
               value="" placeholder="0"
               data-input-action="update-split-remainder">
        <span class="split-person-unit">${unit}</span>
      </div>`,
      )
      .join('');
    container.innerHTML = `<div class="split-other-grid">${rows}</div>
      <div class="split-remainder" id="split-remainder" aria-live="polite"></div>`;
  }
  updateSplitRemainder();
}

function toggleSplitMember(id, checked) {
  expSplitChecked[id] = checked;
  renderSplitSection();
}

function updateSplitRemainder() {
  const remEl = document.getElementById('split-remainder');
  if (!remEl) return;
  const amount = parseMoneyInput(document.getElementById('exp-amount')?.value) || 0;
  const currency = document.getElementById('exp-currency')?.value || currentTrip.currency;

  if (splitType === 'exact') {
    const total = currentMembers.reduce(
      (s, m) => s + (parseMoneyInput(document.getElementById(`split-${m.id}`)?.value) || 0),
      0,
    );
    const diff = amount - total;
    const status =
      diff > 0.005
        ? `${formatMoney(diff, currency)} remaining`
        : diff < -0.005
          ? `${formatMoney(Math.abs(diff), currency)} over`
          : 'Totals match ✓';
    remEl.textContent = `Allocated ${formatMoney(total, currency)} of ${formatMoney(amount, currency)} · ${status}`;
    remEl.className = `split-remainder${Math.abs(diff) > 0.005 ? ' error' : ''}`;
  } else {
    const count = currentMembers.filter(member => expSplitChecked[member.id]).length;
    remEl.textContent = `${formatMoney(amount, currency)} split equally between ${count} ${count === 1 ? 'person' : 'people'}`;
    remEl.className = `split-remainder${count ? '' : ' error'}`;
  }
}

// Auto-categorize by title keywords
document.addEventListener('input', e => {
  if (e.target?.id === 'exp-title') {
    const suggestedCategory = expenseCategoryManuallySelected ? null : suggestExpenseCategory(e.target.value);
    if (!expenseCategoryManuallySelected) selectExpenseCategory(suggestedCategory || 'other', { manual: false });
  }
  if (e.target?.id === 'exp-amount') updateSplitRemainder();
});

let expenseSaveInProgress = false;
async function addExpense(e) {
  e.preventDefault();
  if (expenseSaveInProgress) return;
  if (!currentTrip || currentTrip.status === 'ended') {
    showToast('Ended trips are view-only.', 'error');
    return;
  }
  const title = document.getElementById('exp-title').value.trim();
  const originalAmount = parseMoneyInput(document.getElementById('exp-amount').value);
  const expenseCurrency = normalizeCurrency(document.getElementById('exp-currency')?.value || currentTrip.currency);
  const tripCurrency = normalizeCurrency(currentTrip.currency);
  const paidBy = document.getElementById('exp-paid-by').value;
  const category = document.getElementById('exp-category').value;
  const day = parseInt(document.getElementById('exp-day').value) || currentTrip.current_day;
  const note = document.getElementById('exp-note').value.trim();

  if (!title) {
    shake(document.getElementById('exp-title'));
    return;
  }
  if (!originalAmount || originalAmount <= 0 || originalAmount > MAX_EXPENSE_AMOUNT) {
    shake(document.getElementById('exp-amount'));
    showToast('Enter a valid expense amount within the supported range.', 'error');
    return;
  }
  if (!paidBy) {
    showToast('Select who paid.', 'error');
    return;
  }
  if (day < 1 || day > currentTrip.current_day) {
    shake(document.getElementById('exp-day'));
    showToast(`Choose a trip day from 1 to ${currentTrip.current_day}.`, 'error');
    return;
  }
  if (currentSettled.includes(day)) {
    shake(document.getElementById('exp-day'));
    showToast(`Day ${day} is settled and cannot be changed.`, 'error');
    return;
  }

  expenseSaveInProgress = true;
  setLoading('btn-add-expense', true);
  try {
    let exchangeRate = 1;
    try {
      exchangeRate = await getExchangeRate(expenseCurrency, tripCurrency);
    } catch (err) {
      showToast(err.message || 'Could not load exchange rate.', 'error');
      return;
    }
    if (fallbackExchangeRateKeys.has(`${expenseCurrency}-${tripCurrency}`)) {
      showToast('Using the last saved exchange rate while the live service is unavailable.', 'info');
    }
    const amount = roundMoney(originalAmount * exchangeRate);
    if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_EXPENSE_AMOUNT) {
      showToast('The converted expense amount is outside the supported range.', 'error');
      return;
    }

    const splits = buildConvertedSplits(originalAmount, amount);
    if (!splits) return;

    if (
      hasSameAmountExpense(originalAmount, expenseCurrency, day) &&
      !(await confirmDuplicateExpense(originalAmount, expenseCurrency, day))
    )
      return;

    const user = window._currentUser;
    const addedByName = window._currentProfile?.display_name || user?.email || 'Guest';
    const expenseId = crypto.randomUUID();
    const now = new Date().toISOString();
    const exp = {
      id: expenseId,
      trip_id: currentTrip.id,
      title,
      amount,
      paid_by: paidBy,
      currency: expenseCurrency,
      original_amount: originalAmount,
      exchange_rate: exchangeRate,
      rate_date: now,
      day_number: day,
      category,
      split_type: splitType,
      note: note || null,
      created_by: user?.id || null,
      created_by_name: addedByName,
      created_at: now,
    };
    const splitRows = splits.map(split => ({
      id: crypto.randomUUID(),
      expense_id: expenseId,
      member_id: split.member_id,
      share_amount: split.amount,
    }));

    const result = await saveOfflineCapableMutation('Add expense', [
      {
        method: 'rpc',
        function: 'create_expense_with_splits',
        args: { p_expense: exp, p_splits: splitRows },
      },
    ]);
    if (result.status === 'error') {
      showDataError('Unable to save this expense.');
      return;
    }

    currentExpenses.push(exp);
    currentSplits.push(...splitRows);
    updateLoadedTripExpenseSummary(exp.amount, exp.category, 1);
    syncCurrentTripCache();

    showToast(result.status === 'queued' ? 'Expense added offline — it will sync automatically.' : 'Expense added');
    if (result.status === 'synced') activityCache.delete(currentTrip.id);
    closeExpenseScreen('expenses');
  } finally {
    expenseSaveInProgress = false;
    setLoading('btn-add-expense', false);
    window.webExpense?.refreshValidation?.();
  }
}

function hasSameAmountExpense(amount, currency, day) {
  return currentExpenses.some(
    e =>
      Number(e.day_number) === Number(day) &&
      originalExpenseCurrency(e) === normalizeCurrency(currency) &&
      Math.abs(originalExpenseAmount(e) - amount) < 0.005,
  );
}

function confirmDuplicateExpense(amount, currency, day) {
  return appConfirm({
    title: 'Possible duplicate',
    message: `Day ${day} already has an expense for ${formatMoney(amount, currency)}. Add it again?`,
    okText: 'Add again',
  });
}

function buildConvertedSplits(originalAmount, convertedAmount) {
  const sym = moneySymbol(document.getElementById('exp-currency')?.value || currentTrip.currency);

  if (splitType === 'equal') {
    const selected = currentMembers.filter(m => expSplitChecked[m.id]);
    if (!selected.length) {
      showToast('Select at least one member.', 'error');
      return null;
    }
    return allocateRoundedSplits(
      convertedAmount,
      selected.map(m => ({ member_id: m.id, weight: 1 })),
    );
  }

  if (splitType === 'exact') {
    const splits = currentMembers
      .map(m => ({
        member_id: m.id,
        amount: parseMoneyInput(document.getElementById(`split-${m.id}`)?.value || '0'),
      }))
      .filter(s => s.amount > 0);
    const total = splits.reduce((s, x) => s + x.amount, 0);
    if (Math.abs(total - originalAmount) > 0.02) {
      showToast(`Splits total ${sym}${total.toFixed(2)} != ${sym}${originalAmount.toFixed(2)}.`, 'error');
      return null;
    }
    return allocateRoundedSplits(
      convertedAmount,
      splits.map(s => ({ member_id: s.member_id, weight: s.amount })),
    );
  }

  return [];
}

// ─── Delete expense ────────────────────────────────────────────
async function deleteExpense(id) {
  if (
    !(await appConfirm({
      title: 'Delete expense?',
      message: 'This expense and its splits will be removed.',
      okText: 'Delete',
      danger: true,
    }))
  )
    return;
  const deletedExpense = currentExpenses.find(e => e.id === id);
  const { error } = await saveOfflineCapableMutation('Delete expense', [
    {
      method: 'delete',
      table: 'expenses',
      match: { id },
      expected: deletedExpense ? { amount: deletedExpense.amount, day_number: deletedExpense.day_number } : {},
    },
  ]);
  if (error) {
    showDataError('Unable to delete this expense.');
    return;
  }
  currentExpenses = currentExpenses.filter(e => e.id !== id);
  currentSplits = currentSplits.filter(s => s.expense_id !== id);
  if (deletedExpense)
    updateLoadedTripExpenseSummary(-convertedExpenseAmount(deletedExpense), deletedExpense.category, -1);
  syncCurrentTripCache();
  showToast('Expense deleted');
  renderExpensesTab();
}

// ─── Members CRUD ──────────────────────────────────────────────
async function addMember() {
  const nameEl = document.getElementById('new-member-name');
  const name = nameEl?.value.trim();
  if (!name) {
    shake(nameEl);
    return;
  }
  if (currentMembers.some(member => member.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) {
    shake(nameEl);
    showToast(`${name} is already in this trip.`, 'error');
    return;
  }

  const member = {
    id: crypto.randomUUID(),
    trip_id: currentTrip.id,
    user_id: null,
    name,
    paypal_link: null,
    created_at: new Date().toISOString(),
  };
  const result = await saveOfflineCapableMutation('Add member', [
    { method: 'upsert-ignore', table: 'members', values: member },
    {
      method: 'upsert-ignore',
      table: 'contacts',
      values: { owner_id: window._currentUser.id, name },
      onConflict: 'owner_id,name',
    },
  ]);
  if (result.status === 'error') {
    showDataError('Unable to add this member.');
    return;
  }
  currentMembers.push(member);
  syncCurrentTripCache();
  expSplitChecked[member.id] = true;
  nameEl.value = '';
  if (!currentContacts.find(contact => contact.name === name)) {
    currentContacts.push({ name });
    currentContacts.sort((a, b) => a.name.localeCompare(b.name));
  }
  renderMembersTab();
  showToast(result.status === 'queued' ? `${name} added offline — it will sync automatically.` : `${name} added`);
  if (result.status === 'synced') activityCache.delete(currentTrip.id);
}

async function addMemberFromContact(name) {
  if (currentMembers.some(member => member.name.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase())) {
    showToast(`${name} is already in this trip.`, 'error');
    return;
  }
  const member = {
    id: crypto.randomUUID(),
    trip_id: currentTrip.id,
    user_id: null,
    name,
    paypal_link: null,
    created_at: new Date().toISOString(),
  };
  const result = await saveOfflineCapableMutation('Add member', [
    { method: 'upsert-ignore', table: 'members', values: member },
  ]);
  if (result.status === 'error') {
    showDataError('Unable to add this member.');
    return;
  }
  currentMembers.push(member);
  syncCurrentTripCache();
  expSplitChecked[member.id] = true;
  renderMembersTab();
  showToast(result.status === 'queued' ? `${name} added offline — it will sync automatically.` : `${name} added`);
  if (result.status === 'synced') activityCache.delete(currentTrip.id);
}

async function deleteMember(id) {
  const m = currentMembers.find(m => m.id === id);
  if (!m || m.user_id) return;
  if (
    !(await appConfirm({
      title: 'Remove member?',
      message: `Remove ${m?.name || 'this member'} from this trip?`,
      okText: 'Remove',
      danger: true,
    }))
  )
    return;
  if (
    currentExpenses.some(e => e.paid_by === id) ||
    currentSplits.some(s => s.member_id === id) ||
    currentPayments.some(p => p.from_member === id || p.to_member === id)
  ) {
    showToast('This member still has expenses, splits or payments.', 'error');
    return;
  }
  const { error } = await saveOfflineCapableMutation('Remove member', [
    { method: 'delete', table: 'members', match: { id }, expected: { name: m.name, user_id: null } },
  ]);
  if (error) {
    if (error.code === '23503') {
      showToast(`Can't remove ${m?.name || 'member'} — they have expenses or payments on this trip.`, 'error');
    } else {
      showDataError('Unable to remove this member.');
    }
    return;
  }
  currentMembers = currentMembers.filter(m => m.id !== id);
  syncCurrentTripCache();
  delete expSplitChecked[id];
  renderMembersTab();
  showToast('Member removed');
}

let memberEditState = null;

function editMemberName(memberId, current) {
  const m = currentMembers.find(m => m.id === memberId);
  if (!m || m.user_id !== window._currentUser?.id) return;
  openMemberEditModal('name', memberId, current || m.name);
}

function editPaypalLink(memberId, current) {
  const m = currentMembers.find(m => m.id === memberId);
  const isCreator = currentTrip.creator_id === window._currentUser?.id;
  const isYou = m?.user_id === window._currentUser?.id;
  if (!isCreator && !isYou) return;
  openMemberEditModal('paypal', memberId, current || m?.paypal_link || '');
}

function openMemberEditModal(type, memberId, value) {
  memberEditState = { type, memberId };
  const title = document.getElementById('member-edit-title');
  const label = document.getElementById('member-edit-label');
  const input = document.getElementById('member-edit-value');

  title.textContent = type === 'name' ? 'Edit your name' : 'Edit PayPal link';
  label.textContent = type === 'name' ? 'Your name' : 'PayPal.me link';
  input.placeholder = type === 'name' ? 'Your name' : 'https://paypal.me/yourname';
  input.required = type === 'name';
  input.type = type === 'paypal' ? 'url' : 'text';
  input.maxLength = type === 'paypal' ? 255 : 40;
  input.value = value || '';
  openModal('modal-member-edit');
  setTimeout(() => input.focus(), 50);
}

async function saveMemberEdit(e) {
  e.preventDefault();
  if (!memberEditState) return;
  const { type, memberId } = memberEditState;
  const m = currentMembers.find(m => m.id === memberId);
  if (!m) return;

  const input = document.getElementById('member-edit-value');
  const value = input.value.trim();

  if (type === 'name') {
    if (m.user_id !== window._currentUser?.id || !value) return;
    const result = await saveOfflineCapableMutation('Update member name', [
      { method: 'update', table: 'members', values: { name: value }, match: { id: memberId } },
      { method: 'update', table: 'profiles', values: { display_name: value }, match: { id: window._currentUser.id } },
    ]);
    if (result.status === 'error') {
      showDataError('Unable to update this name.');
      return;
    }
    m.name = value;
    if (window._currentProfile) {
      window._currentProfile.display_name = value;
      cacheProfile(window._currentUser, window._currentProfile);
    }
    showToast(result.status === 'queued' ? 'Name updated offline — it will sync automatically.' : 'Name updated');
  } else {
    const isCreator = currentTrip.creator_id === window._currentUser?.id;
    const isYou = m.user_id === window._currentUser?.id;
    if (!isCreator && !isYou) return;
    const paypalLink = normalizePaypalLink(value);
    if (value && !paypalLink) {
      shake(input);
      showToast('Use a valid https://paypal.me/ link.', 'error');
      return;
    }
    const result = await saveOfflineCapableMutation('Update PayPal link', [
      { method: 'update', table: 'members', values: { paypal_link: paypalLink }, match: { id: memberId } },
    ]);
    if (result.status === 'error') {
      showDataError('Unable to update this PayPal link.');
      return;
    }
    m.paypal_link = paypalLink;
    showToast(
      result.status === 'queued' ? 'PayPal link updated offline — it will sync automatically.' : 'PayPal link updated',
    );
  }

  syncCurrentTripCache();
  closeModal('modal-member-edit');
  memberEditState = null;
  renderMembersTab();
}

// ─── Settle day modal ──────────────────────────────────────────
async function leaveTrip() {
  const user = window._currentUser;
  const member = currentMembers.find(m => m.user_id === user?.id);
  if (!user || !member) return;

  const { balances } = calcBalances();
  if (Math.abs(balances[member.id] || 0) > 0.009) {
    showToast("You can't leave with an unpaid balance.", 'error');
    return;
  }
  if (
    !(await appConfirm({
      title: 'Leave trip?',
      message: 'You will lose access to this trip.',
      okText: 'Leave',
      danger: true,
    }))
  )
    return;

  const { error } = await db.rpc('leave_trip', { p_trip_id: currentTrip.id });
  if (error) {
    showDataError('Unable to leave this trip. Make sure your balance is settled.');
    return;
  }

  const leftTripId = currentTrip.id;
  tripViewCache.delete(leftTripId);
  localStorage.removeItem(tripViewCacheKey(leftTripId));
  showToast('Left trip');
  goToTrips();
}

let _settleDay = null;
let _settleMode = 'settle';
function openSettleDayModal(day, mode = 'settle') {
  _settleDay = day;
  _settleMode = mode === 'skip' ? 'skip' : 'settle';
  const lbl = document.getElementById('settle-day-label');
  if (lbl) lbl.textContent = `${_settleMode === 'skip' ? 'Skip' : 'Settle'} Day ${day}`;
  const description = document.getElementById('settle-day-description');
  if (description)
    description.textContent =
      _settleMode === 'skip'
        ? `Skip this empty day and open Day ${day + 1}. This can't be undone.`
        : `Mark this day as settled. Balances are frozen for the day. This can't be undone.`;
  const submit = document.getElementById('btn-settle-day');
  if (submit) submit.textContent = _settleMode === 'skip' ? 'Skip day' : 'Settle day';
  const noteEl = document.getElementById('settle-note');
  if (noteEl) noteEl.value = '';
  openModal('modal-settle-day');
}

async function confirmSettleDay(e) {
  e.preventDefault();
  if (_settleDay === null) return;
  if (currentSettled.includes(_settleDay)) {
    closeModal('modal-settle-day');
    showToast(`Day ${_settleDay} is already settled.`, 'error');
    return;
  }
  const note = document.getElementById('settle-note')?.value.trim();
  const settledDay = _settleDay;
  const skipped = _settleMode === 'skip';
  const newDay = settledDay >= currentTrip.current_day ? currentTrip.current_day + 1 : null;
  const steps = [
    {
      method: 'upsert-ignore',
      table: 'settlements',
      values: {
        id: crypto.randomUUID(),
        trip_id: currentTrip.id,
        day_number: settledDay,
        note: note || null,
        settled_at: new Date().toISOString(),
      },
      onConflict: 'trip_id,day_number',
    },
  ];
  if (newDay) {
    steps.push({ method: 'update', table: 'trips', values: { current_day: newDay }, match: { id: currentTrip.id } });
  }

  setLoading('btn-settle-day', true);
  const result = await saveOfflineCapableMutation(skipped ? 'Skip trip day' : 'Settle trip day', steps);
  setLoading('btn-settle-day', false);

  if (result.status === 'error') {
    showDataError('Unable to settle this day.');
    return;
  }

  currentSettled.push(settledDay);
  syncCurrentTripCache();

  // Advance current_day so new expenses default to the next day
  if (newDay) {
    currentTrip.current_day = newDay;
    syncCurrentTripCache();
    const badge = document.getElementById('dash-day-badge');
    if (badge) badge.textContent = `Day ${newDay}`;
  }

  closeModal('modal-settle-day');
  const action = skipped ? 'skipped' : 'settled';
  showToast(
    result.status === 'queued'
      ? `Day ${settledDay} ${action} offline — it will sync automatically.`
      : `Day ${settledDay} ${action}!`,
  );
  if (result.status === 'synced') activityCache.delete(currentTrip.id);
  renderExpensesTab();
}

function toggleDaySection(hdrEl) {
  const section = hdrEl.closest('.day-section');
  const body = section?.querySelector('.day-body');
  const settle = section?.querySelector('.settle-day-row');
  if (!body) return;
  const collapsed = section.classList.toggle('collapsed');
  body.hidden = collapsed;
  if (settle) settle.hidden = collapsed;
}

// ─── End trip modal ────────────────────────────────────────────
function openEndTripModal() {
  openModal('modal-end-trip');
}

async function confirmEndTrip(e) {
  e.preventDefault();
  const { balances } = calcBalances();
  const hasOutstanding = Object.values(balances).some(v => Math.abs(v) > 0.009);
  if (hasOutstanding) {
    closeModal('modal-end-trip');
    showToast('Settle all balances before ending the trip.', 'error');
    switchTab('members');
    return;
  }

  setLoading('btn-end-trip', true);
  const result = await saveOfflineCapableMutation('End trip', [
    { method: 'update', table: 'trips', values: { status: 'ended' }, match: { id: currentTrip.id } },
  ]);
  setLoading('btn-end-trip', false);

  if (result.status === 'error') {
    showDataError('Unable to end this trip.');
    return;
  }
  currentTrip.status = 'ended';
  const loadedTrip = loadedTrips.find(trip => trip.id === currentTrip.id);
  if (loadedTrip) loadedTrip.status = 'ended';
  persistTripsCache();
  syncCurrentTripCache();
  closeModal('modal-end-trip');
  showToast(result.status === 'queued' ? 'Trip ended offline — it will sync automatically.' : 'Trip ended');
  if (result.status === 'synced') activityCache.delete(currentTrip.id);
  renderDashboard('creator');
}

// ─── Payment modal ─────────────────────────────────────────────
async function deleteTrip() {
  if (currentTrip.creator_id !== window._currentUser?.id) return;
  const ok = await appConfirm({
    title: 'Delete trip?',
    message: 'This permanently deletes the trip, members, expenses, splits, payments, and settlements.',
    okText: 'Delete trip',
    danger: true,
  });
  if (!ok) return;

  const deletedTripId = currentTrip.id;
  const result = await saveOfflineCapableMutation('Delete trip', [
    {
      method: 'delete',
      table: 'trips',
      match: { id: deletedTripId },
      expected: { creator_id: currentTrip.creator_id, name: currentTrip.name, status: currentTrip.status },
    },
  ]);
  const { error } = result;
  if (error) {
    showDataError('Unable to delete this trip.');
    return;
  }
  loadedTrips = loadedTrips.filter(trip => trip.id !== deletedTripId);
  persistTripsCache();
  tripViewCache.delete(deletedTripId);
  localStorage.removeItem(tripViewCacheKey(deletedTripId));
  showToast(result.status === 'queued' ? 'Trip deleted offline — it will sync automatically.' : 'Trip deleted');
  goToTrips();
}

let _payFrom = null,
  _payTo = null,
  _payAmt = 0;
function openPaymentModal(fromId, toId, amount) {
  if (currentTrip?.status === 'ended') {
    showToast('Ended trips are read-only.', 'error');
    return;
  }
  const fromMember = currentMembers.find(m => m.id === fromId);
  const isCreator = currentTrip.creator_id === window._currentUser?.id;
  if (!fromMember || (!isCreator && fromMember.user_id !== window._currentUser?.id)) {
    showToast('Only the payer or trip creator can record this payment.', 'error');
    return;
  }
  _payFrom = fromId;
  _payTo = toId;
  _payAmt = amount;
  const from = currentMembers.find(m => m.id === fromId)?.name || '?';
  const to = currentMembers.find(m => m.id === toId)?.name || '?';
  const desc = document.getElementById('payment-desc');
  if (desc) desc.textContent = `${from} → ${to}: ${formatMoney(amount, currentTrip.currency)}`;
  const amtEl = document.getElementById('payment-amount');
  if (amtEl) {
    amtEl.value = amount.toFixed(2);
    amtEl.max = amount.toFixed(2);
  }
  const noteEl = document.getElementById('payment-note');
  if (noteEl) noteEl.value = '';
  openModal('modal-payment');
}

async function confirmPayment(e) {
  e.preventDefault();
  if (currentTrip?.status === 'ended' || currentSettled.includes(Number(currentTrip?.current_day))) {
    showToast('Payments cannot be added to an ended or settled day.', 'error');
    return;
  }
  const amount = parseMoneyInput(document.getElementById('payment-amount').value);
  const note = document.getElementById('payment-note').value.trim();
  if (!amount || amount <= 0 || amount > MAX_EXPENSE_AMOUNT) {
    shake(document.getElementById('payment-amount'));
    showToast('Enter a valid payment amount within the supported range.', 'error');
    return;
  }
  if (!_payFrom || !_payTo || _payFrom === _payTo || amount > _payAmt + 0.005) {
    shake(document.getElementById('payment-amount'));
    showToast(`Payment cannot exceed ${formatMoney(_payAmt, currentTrip.currency)}.`, 'error');
    return;
  }

  setLoading('btn-record-payment', true);
  const payment = {
    id: crypto.randomUUID(),
    trip_id: currentTrip.id,
    from_member: _payFrom,
    to_member: _payTo,
    amount,
    note: note || null,
    day_number: currentTrip.current_day,
    paid_at: new Date().toISOString(),
  };
  const result = await saveOfflineCapableMutation('Record payment', [
    { method: 'upsert-ignore', table: 'payments', values: payment },
  ]);
  setLoading('btn-record-payment', false);

  if (result.status === 'error') {
    showDataError('Unable to record this payment.');
    return;
  }

  currentPayments.push(payment);
  syncCurrentTripCache();
  closeModal('modal-payment');
  showToast(result.status === 'queued' ? 'Payment recorded offline — it will sync automatically.' : 'Payment recorded');
  if (result.status === 'synced') activityCache.delete(currentTrip.id);
  renderMembersTab();
}

async function deletePayment(id) {
  const payment = currentPayments.find(item => item.id === id);
  const isCreator = currentTrip?.creator_id === window._currentUser?.id;
  if (
    !payment ||
    !isCreator ||
    currentTrip?.status === 'ended' ||
    currentSettled.includes(Number(payment.day_number))
  ) {
    showToast('This payment cannot be removed.', 'error');
    return;
  }
  if (
    !(await appConfirm({
      title: 'Delete payment?',
      message: 'This payment record will be removed.',
      okText: 'Delete',
      danger: true,
    }))
  )
    return;
  const { error } = await saveOfflineCapableMutation('Delete payment', [
    {
      method: 'delete',
      table: 'payments',
      match: { id },
      expected: { amount: payment.amount, day_number: payment.day_number },
    },
  ]);
  if (error) {
    showDataError('Unable to delete this payment.');
    return;
  }
  currentPayments = currentPayments.filter(p => p.id !== id);
  syncCurrentTripCache();
  renderMembersTab();
  showToast('Payment removed');
}

// ─── Account settings modal ────────────────────────────────────
function openAccountSettings(section) {
  const user = window._currentUser;
  const profile = window._currentProfile;
  const nameEl = document.getElementById('settings-name');
  const payEl = document.getElementById('settings-paypal');
  const emailEl = document.getElementById('settings-email');
  const currentEmailEl = document.getElementById('settings-current-email');
  const deleteEmailEl = document.getElementById('delete-account-email');
  const deleteEmailGroup = document.getElementById('delete-account-email-group');
  const appleDeleteConfirmation = document.getElementById('delete-account-apple-confirmation');
  const deleteDataEmailEl = document.getElementById('delete-data-email');
  const requestedSection = ['profile', 'email', 'data-delete', 'account-delete'].includes(section)
    ? section
    : 'profile';
  const panelIds = {
    profile: 'settings-profile',
    email: 'settings-security',
    'data-delete': 'settings-data-delete',
    'account-delete': 'settings-close',
  };
  const titles = {
    profile: 'Personal details',
    email: 'Change email',
    'data-delete': 'Delete my data',
    'account-delete': 'Delete account',
  };
  if (nameEl) nameEl.value = profile?.display_name || '';
  if (payEl) payEl.value = profile?.paypal_link || '';
  inlineFormValidators.get('form-account')?.clear();
  inlineFormValidators.get('form-change-email')?.clear();
  setActionFieldError('delete-data-email');
  setActionFieldError('delete-account-email');
  if (emailEl) emailEl.value = user?.email || '(guest)';
  if (currentEmailEl) currentEmailEl.value = user?.email || '';
  if (deleteEmailEl) deleteEmailEl.value = '';
  if (deleteDataEmailEl) deleteDataEmailEl.value = '';
  const appleAccount = isAppleAccount(user);
  if (deleteEmailGroup) deleteEmailGroup.hidden = appleAccount;
  if (appleDeleteConfirmation) appleDeleteConfirmation.hidden = !appleAccount;
  Object.values(panelIds).forEach(id => {
    const panel = document.getElementById(id);
    if (panel) panel.hidden = id !== panelIds[requestedSection];
  });
  const modalTitle = document.getElementById('account-modal-title');
  if (modalTitle) modalTitle.textContent = titles[requestedSection];
  document.getElementById('form-change-email')?.reset();
  if (currentEmailEl) currentEmailEl.value = user?.email || '';
  openModal('modal-account');
  const modalSheet = document.querySelector('#modal-account .modal-sheet');
  if (modalSheet) modalSheet.scrollTop = 0;
  const sectionTargets = {
    profile: 'settings-name',
    email: 'settings-new-email',
    'data-delete': 'delete-data-email',
    'account-delete': appleAccount ? 'btn-delete-account' : 'delete-account-email',
  };
  const target = document.getElementById(sectionTargets[requestedSection]);
  if (target)
    requestAnimationFrame(() => {
      target.focus({ preventScroll: true });
    });
}

async function changeAccountEmail(event) {
  event.preventDefault();
  if (inlineFormValidators.get('form-change-email')?.validateAll() === false) return;
  const currentEmail = String(window._currentUser?.email || '')
    .trim()
    .toLowerCase();
  const newEmail = document.getElementById('settings-new-email')?.value.trim().toLowerCase() || '';
  const confirmation = document.getElementById('settings-confirm-email')?.value.trim().toLowerCase() || '';
  if (!currentEmail || !newEmail || newEmail === currentEmail || newEmail !== confirmation) return;

  setLoading('btn-change-email', true);
  const redirectTo = nativeOrWebAuthRedirect();
  const { error } = await db.auth.updateUser(
    { email: newEmail },
    redirectTo ? { emailRedirectTo: redirectTo } : undefined,
  );
  setLoading('btn-change-email', false);
  if (error) {
    showToast(friendlyAuthError(error.message), 'error');
    return;
  }
  document.getElementById('form-change-email')?.reset();
  inlineFormValidators.get('form-change-email')?.clear();
  const currentEmailEl = document.getElementById('settings-current-email');
  if (currentEmailEl) currentEmailEl.value = currentEmail;
  showToast('Check both email inboxes to confirm the change.');
}

async function exportAccountData() {
  const user = window._currentUser;
  if (!user?.id) return;
  setLoading('btn-export-account', true);
  const queries = await Promise.all([
    db
      .from('profiles')
      .select(
        'id,display_name,username,avatar_url,paypal_link,home_currency,default_split,theme_preference,is_anonymous,created_at',
      )
      .eq('id', user.id)
      .maybeSingle(),
    db.from('contacts').select('*').eq('owner_id', user.id),
    db.from('trips').select('*').eq('creator_id', user.id),
    db.from('trip_members').select('*').eq('user_id', user.id),
    db.from('members').select('*').eq('user_id', user.id),
    db.from('expenses').select('*').eq('created_by', user.id),
    db.from('activity_log').select('*').eq('user_id', user.id),
  ]);
  setLoading('btn-export-account', false);
  if (queries.some(result => result.error)) {
    showDataError('Unable to export your account data.');
    return;
  }
  const [profile, contacts, createdTrips, memberships, memberRecords, createdExpenses, activity] = queries;
  const payload = {
    exported_at: new Date().toISOString(),
    account: { id: user.id, email: user.email || null, created_at: user.created_at || null },
    profile: profile.data,
    contacts: contacts.data || [],
    created_trips: createdTrips.data || [],
    trip_memberships: memberships.data || [],
    linked_member_records: memberRecords.data || [],
    created_expenses: createdExpenses.data || [],
    activity: activity.data || [],
  };
  await downloadAccountExport(JSON.stringify(payload, null, 2));
}

async function downloadAccountExport(contents) {
  const filename = `tripcash-account-data-${new Date().toISOString().slice(0, 10)}.json`;
  const capacitor = window.Capacitor;
  if (capacitor?.isNativePlatform?.()) {
    try {
      const file = await capacitor.Plugins.Filesystem.writeFile({
        path: filename,
        data: contents,
        directory: 'CACHE',
        encoding: 'utf8',
      });
      await capacitor.Plugins.Share.share({
        title: 'TripCash account data',
        files: [file.uri],
        dialogTitle: 'Save or share your data',
      });
      showToast('Account data ready to save or share');
    } catch (_) {
      showToast('Could not export your account data.', 'error');
    }
    return;
  }
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast('Account data exported');
}

async function deleteAccountData() {
  const accountEmail = String(window._currentUser?.email || '')
    .trim()
    .toLowerCase();
  const confirmationEmail = document.getElementById('delete-data-email')?.value.trim().toLowerCase() || '';
  if (!accountEmail || confirmationEmail !== accountEmail) {
    setActionFieldError('delete-data-email', 'Enter your account email exactly to confirm data deletion.');
    return;
  }
  setActionFieldError('delete-data-email');
  const confirmed = await appConfirm({
    title: 'Delete your personal data?',
    message:
      'Your profile details, contacts, memberships, and personal attribution will be removed. Your sign-in account will remain so you can start fresh. This cannot be undone.',
    okText: 'Delete my data',
    danger: true,
  });
  if (!confirmed) return;
  setLoading('btn-delete-data', true);
  const { error } = await db.rpc('delete_current_user_data');
  setLoading('btn-delete-data', false);
  if (error) {
    showDataError('Unable to delete your personal data.');
    return;
  }
  window.TripCashOffline?.clearQueue(window._currentUser.id);
  clearUserTripCaches(window._currentUser.id);
  localStorage.removeItem(`${PROFILE_CACHE_PREFIX}${window._currentUser.id}`);
  showToast('Your personal data was deleted.');
  location.reload();
}

async function saveAccountSettings(e) {
  e.preventDefault();
  if (inlineFormValidators.get('form-account')?.validateAll() === false) return;
  const name = document.getElementById('settings-name').value.trim();
  const paypal = document.getElementById('settings-paypal').value.trim();
  if (!name) {
    shake(document.getElementById('settings-name'));
    return;
  }
  const paypalLink = normalizePaypalLink(paypal);
  if (paypal && !paypalLink) {
    shake(document.getElementById('settings-paypal'));
    showToast('Use a valid https://paypal.me/ link.', 'error');
    return;
  }

  setLoading('btn-save-account', true);
  const result = await saveOfflineCapableMutation('Update account settings', [
    {
      method: 'update',
      table: 'profiles',
      values: { display_name: name, paypal_link: paypalLink },
      match: { id: window._currentUser.id },
    },
  ]);
  setLoading('btn-save-account', false);

  if (result.status === 'error') {
    showDataError('Unable to save account settings.');
    return;
  }

  if (window._currentProfile) {
    window._currentProfile.display_name = name;
    window._currentProfile.paypal_link = paypalLink;
    cacheProfile(window._currentUser, window._currentProfile);
  }
  const labelEl = document.getElementById('header-user-label');
  if (labelEl) labelEl.textContent = name;
  closeModal('modal-account');
  showToast(result.status === 'queued' ? 'Settings saved offline — they will sync automatically.' : 'Settings saved');
}

function appleIdentitySubject(user) {
  const identity = Array.isArray(user?.identities) ? user.identities.find(item => item?.provider === 'apple') : null;
  return identity?.identity_data?.sub || identity?.provider_id || identity?.id || null;
}

function isAppleAccount(user) {
  return Boolean(appleIdentitySubject(user));
}

function identityTokenSubject(identityToken) {
  try {
    const parts = String(identityToken || '').split('.');
    if (parts.length !== 3) return null;
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    return typeof payload?.sub === 'string' ? payload.sub : null;
  } catch (_) {
    return null;
  }
}

async function requestAppleDeletionAuthorization() {
  const appleSubject = appleIdentitySubject(window._currentUser);
  const isNativeIOS = window.Capacitor?.isNativePlatform?.() && window.Capacitor?.getPlatform?.() === 'ios';
  if (!appleSubject || !isNativeIOS) return { authorizationCode: null, cancelled: false };

  const plugin = window.Capacitor?.Plugins?.AppleReauth;
  if (!plugin?.requestAuthorization) throw new Error('Apple confirmation is unavailable.');
  const result = await plugin.requestAuthorization();
  if (result?.cancelled) return { authorizationCode: null, cancelled: true };

  const authorizationCode = String(result?.authorizationCode || '');
  const confirmedSubject = identityTokenSubject(result?.identityToken);
  if (!/^[\w.-]{1,2048}$/.test(authorizationCode) || !confirmedSubject || confirmedSubject !== appleSubject) {
    throw new Error('Apple account confirmation did not match this TripCash account.');
  }
  return { authorizationCode, cancelled: false };
}

function parseAccountClosureResponse(data) {
  if (data && typeof data === 'object') return data;
  if (typeof data !== 'string') return {};
  const text = data.trim();
  if (!text || (!text.startsWith('{') && !text.startsWith('['))) return {};
  try {
    return JSON.parse(text);
  } catch (_) {
    return {};
  }
}

// Used when the reply has no readable error, e.g. a gateway page instead of our JSON.
function accountClosureFallbackError(status) {
  return [502, 503, 504].includes(status)
    ? 'TripCash couldn’t finish deleting your account right now. Please try again in a few minutes. If it keeps happening, contact support@tripcash.de.'
    : 'Unable to delete this account right now. Please try again.';
}

async function requestAccountClosure(data) {
  const authorization = `Bearer ${window._tcAccessToken || ''}`;
  const nativeHttp = window.Capacitor?.isNativePlatform?.() ? window.Capacitor?.Plugins?.CapacitorHttp : null;
  if (nativeHttp?.post) {
    let response;
    try {
      response = await nativeHttp.post({
        url: 'https://tripcash.de/api/account-closure',
        headers: {
          Authorization: authorization,
          'Content-Type': 'application/json',
          Origin: 'capacitor://localhost',
        },
        data,
        connectTimeout: 10000,
        readTimeout: 30000,
        responseType: 'text',
      });
    } catch (error) {
      const code = String(error?.code || '')
        .replace(/[^A-Za-z0-9_.-]/g, '')
        .slice(0, 40);
      return {
        ok: false,
        status: 0,
        data: { error: `The iPhone could not contact the account service${code ? ` (${code})` : ''}.` },
      };
    }
    const status = Number(response?.status) || 0;
    const result = parseAccountClosureResponse(response?.data);
    return {
      ok: status >= 200 && status < 300,
      status,
      data:
        Object.keys(result).length || (status >= 200 && status < 300)
          ? result
          : { error: accountClosureFallbackError(status) },
    };
  }

  const endpoint = window.Capacitor?.isNativePlatform?.()
    ? 'https://tripcash.de/api/account-closure'
    : '/api/account-closure';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const result = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    data: response.ok || result?.error ? result : { ...result, error: accountClosureFallbackError(response.status) },
  };
}

async function deleteAccount() {
  const userId = window._currentUser?.id;
  const appleAccount = isAppleAccount(window._currentUser);
  const accountEmail = String(window._currentUser?.email || '')
    .trim()
    .toLowerCase();
  const confirmationEmail = appleAccount
    ? ''
    : document.getElementById('delete-account-email')?.value.trim().toLowerCase() || '';
  if (!appleAccount && (!accountEmail || confirmationEmail !== accountEmail)) {
    setActionFieldError('delete-account-email', 'Enter your account email exactly to confirm deletion.');
    return;
  }
  setActionFieldError('delete-account-email');
  const confirmed = await appConfirm({
    title: 'Delete account?',
    message: 'This permanently deletes your account and personal data. This cannot be undone.',
    okText: 'Delete permanently',
    danger: true,
  });
  if (!confirmed) return;

  // Apple confirmation only enables automatic revocation. If it is unavailable,
  // the server falls back to requiring a recent TripCash sign-in.
  let appleAuthorization;
  try {
    appleAuthorization = await requestAppleDeletionAuthorization();
  } catch (_) {
    appleAuthorization = { authorizationCode: null, cancelled: false };
  }
  if (appleAuthorization.cancelled) {
    showToast('Account deletion cancelled.');
    return;
  }

  setLoading('btn-delete-account', true);
  let response = null;
  try {
    response = await requestAccountClosure({
      ...(confirmationEmail ? { confirmationEmail } : {}),
      ...(appleAuthorization.authorizationCode ? { appleAuthorizationCode: appleAuthorization.authorizationCode } : {}),
    });
  } catch (_) {
    response = null;
  }

  const closure = response?.data || {};
  if (!response?.ok) {
    setLoading('btn-delete-account', false);
    if (closure.code === 'reauthentication_required') {
      await requireSignInBeforeDeletion(userId);
      return;
    }
    showDataError(closure.error || 'Unable to delete this account.');
    return;
  }

  if (closure.manualAppleRevocationRequired) {
    await appConfirm({
      title: 'One Apple step remains',
      message:
        'Your TripCash account is deleted. To revoke the remaining Apple authorization, open Settings → your name → Sign-In & Security → Sign in with Apple, then remove TripCash.',
      okText: 'Understood',
    });
  }

  await db.auth.signOut({ scope: 'local' });
  window.TripCashOffline?.clearUser();
  window.TripCashOffline?.clearQueue(userId);
  clearUserTripCaches(userId);
  localStorage.removeItem(`${PROFILE_CACHE_PREFIX}${userId}`);
  window._tcAccessToken = null;
  window._currentUser = null;
  window._currentProfile = null;
  location.replace(location.pathname);
}

// Deletion needs a sign-in from the last hour. Social sessions refresh
// silently and never update last_sign_in_at, so send the user back through
// their provider and reopen deletion once they return.
const PENDING_ACCOUNT_DELETE_KEY = 'pending_account_delete';

async function requireSignInBeforeDeletion(userId) {
  const signInAgain = await appConfirm({
    title: 'Sign in again to delete',
    message:
      'For your security, sign in again (with Google, Apple, or your password). Account deletion will reopen right after.',
    okText: 'Sign in again',
  });
  if (!signInAgain) return;
  try {
    sessionStorage.setItem(PENDING_ACCOUNT_DELETE_KEY, userId);
  } catch (_) {
    /* Resume is a convenience only. */
  }
  await db.auth.signOut({ scope: 'local' });
  window._tcAccessToken = null;
  window._currentUser = null;
  window._currentProfile = null;
  location.replace(location.pathname);
}

function resumePendingAccountDeletion(user) {
  let pendingUserId = null;
  try {
    pendingUserId = sessionStorage.getItem(PENDING_ACCOUNT_DELETE_KEY);
    sessionStorage.removeItem(PENDING_ACCOUNT_DELETE_KEY);
  } catch (_) {
    return false;
  }
  if (!pendingUserId || pendingUserId !== user?.id) return false;
  openAccountSettings('account-delete');
  return true;
}

// ─── Invite flow ───────────────────────────────────────────────
async function handleInvite(tripId) {
  const user = window._currentUser;
  if (!user) return;

  const { data: acceptedTripId, error } = await db.rpc('accept_trip_invite', { p_invite_token: tripId });
  if (error || !acceptedTripId) {
    sessionStorage.removeItem('pending_invite');
    showScreen('not-found');
    return;
  }

  await ensureUserVisibleMember(acceptedTripId, []);

  history.replaceState(null, '', location.pathname + `#trip/${acceptedTripId}`);
  sessionStorage.removeItem('pending_invite');
  openTrip(acceptedTripId);
}

async function rotateInvite() {
  if (!currentTrip || currentTrip.creator_id !== window._currentUser?.id) return;
  const confirmed = await appConfirm({
    title: 'Replace invite link?',
    message: 'The current link will stop working immediately.',
    okText: 'Replace link',
    danger: true,
  });
  if (!confirmed) return;
  const { data, error } = await db.rpc('rotate_trip_invite', { p_trip_id: currentTrip.id }).maybeSingle();
  if (error || !data?.token) {
    showDataError('Unable to replace the invite link.');
    return;
  }
  currentInviteToken = data.token;
  renderOverviewTab();
  showToast('Invite link replaced.');
}

// ─── CSV export ────────────────────────────────────────────────
async function exportCSV() {
  const trip = currentTrip;
  const mMap = {};
  currentMembers.forEach(m => {
    mMap[m.id] = m.name;
  });

  const rows = [
    [
      'Day',
      'Title',
      'Category',
      'Original amount',
      'Original currency',
      'Trip amount',
      'Trip currency',
      'Rate',
      'Rate date',
      'Paid by',
      'Added by',
      'Split type',
      'Note',
    ],
    ...currentExpenses.map(e => [
      e.day_number,
      e.title,
      e.category,
      originalExpenseAmount(e).toFixed(2),
      originalExpenseCurrency(e),
      convertedExpenseAmount(e).toFixed(2),
      trip.currency,
      Number(e.exchange_rate || 1).toFixed(6),
      e.rate_date || e.created_at || '',
      mMap[e.paid_by] || '',
      e.created_by_name || '',
      e.split_type,
      e.note || '',
    ]),
  ];

  const csv = rows.map(r => r.map(csvCell).join(',')).join('\n');
  const filename = `${trip.name.replace(/[^a-z0-9._-]+/gi, '_')}_expenses.csv`;
  const capacitor = window.Capacitor;

  if (capacitor?.isNativePlatform?.()) {
    try {
      const file = await capacitor.Plugins.Filesystem.writeFile({
        path: filename,
        data: csv,
        directory: 'CACHE',
        encoding: 'utf8',
      });
      await capacitor.Plugins.Share.share({
        title: `${trip.name} expenses`,
        files: [file.uri],
        dialogTitle: 'Export trip CSV',
      });
      showToast('CSV ready to save or share');
    } catch (error) {
      showToast('Could not export the CSV.', 'error');
    }
    return;
  }

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('CSV exported');
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\t\r\n]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

// ─── Invite copy ───────────────────────────────────────────────
function copyInvite(url) {
  navigator.clipboard
    ?.writeText(url)
    .then(() => showToast('Link copied!'))
    .catch(() => showToast('Copy failed — copy the URL manually.', 'error'));
}

// ─── Theme ────────────────────────────────────────────────────
const themeMedia =
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)')
    : { matches: true, addEventListener: null };

function applyTheme(preference = 'system') {
  const resolved = preference === 'system' ? (themeMedia.matches ? 'light' : 'dark') : preference;

  document.body.classList.toggle('light', resolved === 'light');
  document.body.classList.toggle('dark', resolved === 'dark');
  document.documentElement?.classList.toggle('theme-light', resolved === 'light');
  document.documentElement?.classList.toggle('theme-dark', resolved === 'dark');

  const statusBar = window.Capacitor?.Plugins?.StatusBar;
  if (statusBar && window.Capacitor?.isNativePlatform?.()) {
    updateNativeStatusBar(document.body.dataset.screen, resolved);
  }

  const labels = { system: ['◐', 'Theme: system'], light: ['☀', 'Theme: light'], dark: ['☾', 'Theme: dark'] };
  const [icon, label] = labels[preference] || labels.system;
  const btn = document.getElementById('btn-theme');
  if (btn) {
    btn.textContent = icon;
    btn.title = `${label}. Click to change.`;
    btn.setAttribute('aria-label', btn.title);
  }
  const landingToggle = document.getElementById('landing-theme-toggle');
  if (landingToggle) {
    landingToggle.querySelector('span').textContent = icon;
    landingToggle.querySelector('b').textContent = label
      .replace('Theme: ', '')
      .replace(/^./, character => character.toUpperCase());
    landingToggle.setAttribute('aria-label', `${label}. Change color theme.`);
  }
  const webThemeChoice = document.getElementById('web-theme-choice');
  if (webThemeChoice) webThemeChoice.textContent = label;
  const themeColor = document.querySelector?.('meta[name="theme-color"]');
  if (themeColor) themeColor.content = resolved === 'dark' ? '#071E1C' : '#F6FAF9';
  if (!document.documentElement?.classList?.contains?.('native-shell')) {
    document.querySelectorAll?.('[data-theme-image]')?.forEach(image => {
      const source = resolved === 'dark' ? image.dataset.darkSrc : image.dataset.lightSrc;
      if (source && image.getAttribute('src') !== source) image.src = source;
    });
  }
}

function updateNativeStatusBar(screen = document.body.dataset.screen, theme) {
  const statusBar = window.Capacitor?.Plugins?.StatusBar;
  if (!statusBar || !window.Capacitor?.isNativePlatform?.()) return;

  const resolved = theme || (document.body.classList.contains('light') ? 'light' : 'dark');
  const usesLightBackground = screen === 'welcome' || resolved === 'light';
  statusBar.setStyle({ style: usesLightBackground ? 'LIGHT' : 'DARK' }).catch(() => {});
  statusBar.setBackgroundColor({ color: usesLightBackground ? '#FAFAFA' : '#091F1E' }).catch(() => {});
}

function toggleTheme() {
  const current = localStorage.getItem('tc-theme') || 'system';
  const next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
  void saveProfilePreference('tc-theme', next, { silent: true });
  showToast(`Theme: ${next}`);
}

themeMedia.addEventListener?.('change', () => {
  if ((localStorage.getItem('tc-theme') || 'system') === 'system') applyTheme('system');
});

if (document.body?.classList) applyTheme(localStorage.getItem('tc-theme') || 'system');

// ─── Modal helpers ─────────────────────────────────────────────
function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  if (!document.querySelector('.modal.open')) {
    modalScrollY = window.scrollY;
    document.body.classList.add('modal-open');
  }
  m.classList.add('open');
  m.addEventListener('click', _onBackdropClick);
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove('open');
  m.removeEventListener('click', _onBackdropClick);
  if (!document.querySelector('.modal.open')) {
    document.body.classList.remove('modal-open');
    window.scrollTo(0, modalScrollY);
  }
}
function _onBackdropClick(e) {
  if (e.target !== e.currentTarget) return;
  if (e.currentTarget.id === 'modal-new-password' && window._passwordRecoveryPending) return;
  if (e.currentTarget.id === 'modal-confirm') {
    resolveConfirm(false);
    return;
  }
  closeModal(e.currentTarget.id);
}

let confirmResolver = null;

function appConfirm({ title, message, okText = 'OK', danger = false }) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  const ok = document.getElementById('confirm-ok');
  ok.textContent = okText;
  ok.className = danger ? 'btn btn-danger' : 'btn btn-primary';
  openModal('modal-confirm');

  return new Promise(resolve => {
    confirmResolver = resolve;
  });
}

function resolveConfirm(value) {
  closeModal('modal-confirm');
  if (confirmResolver) confirmResolver(value);
  confirmResolver = null;
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('modal-confirm')?.classList.contains('open')) {
      resolveConfirm(false);
      return;
    }
    document.querySelectorAll('.modal.open').forEach(m => closeModal(m.id));
  }
});

// ─── UI helpers ───────────────────────────────────────────────
function showToast(msg, type = 'ok') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._tid);
  // Longer messages stay up longer so they can be read: 2.8 s, plus ~45 ms per
  // character beyond 40, up to 7 s.
  const duration = Math.min(7000, 2800 + Math.max(0, String(msg).length - 40) * 45);
  t._tid = setTimeout(() => t.classList.remove('show'), duration);
}

function showDataError(message = 'Unable to complete that action.') {
  showToast(message, 'error');
}

function setLoading(id, on) {
  const btn = document.getElementById(id);
  if (!btn) return;
  btn.disabled = on;
  btn.classList.toggle('loading', on);
}

function shake(el) {
  if (!el) return;
  el.classList.remove('shake');
  void el.offsetWidth;
  el.classList.add('shake');
  el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function memberAvatar(name, size = 34) {
  const initial = (name || '?')[0].toUpperCase();
  const variant = (initial.charCodeAt(0) % 8) + 1;
  const avatarSize = [34, 42].includes(size) ? size : 34;
  return `<div class="member-avatar member-avatar-${avatarSize} member-avatar-color-${variant}">${esc(initial)}</div>`;
}

function neutralMemberAvatar(member) {
  const key = String(member?.id || member?.name || '?');
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  const variant = (hash % 6) + 1;
  return `<span class="neutral-member-avatar avatar-variant-${variant}" aria-hidden="true">
    <svg viewBox="0 0 24 24" focusable="false">
      <circle class="avatar-head" cx="12" cy="8.25" r="3.25"></circle>
      <path class="avatar-body" d="M5.5 19c.55-4.05 2.75-6.1 6.5-6.1s5.95 2.05 6.5 6.1"></path>
    </svg>
  </span>`;
}

// ─── DOM ready wiring ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  configureNativePullToRefresh();
  attachInlineFormValidation('form-new-trip', ['trip-name', 'trip-budget', 'trip-end-date'], tripFieldMessage);
  attachInlineFormValidation('form-account', ['settings-name', 'settings-paypal'], profileFieldMessage);
  attachInlineFormValidation(
    'form-change-email',
    ['settings-new-email', 'settings-confirm-email'],
    changeEmailFieldMessage,
  );
  document.getElementById('form-new-trip')?.addEventListener('submit', createTrip);
  document.getElementById('form-add-expense')?.addEventListener('submit', addExpense);
  document.getElementById('form-settle-day')?.addEventListener('submit', confirmSettleDay);
  document.getElementById('form-end-trip')?.addEventListener('submit', confirmEndTrip);
  document.getElementById('form-payment')?.addEventListener('submit', confirmPayment);
  document.getElementById('form-account')?.addEventListener('submit', saveAccountSettings);
  document.getElementById('form-change-email')?.addEventListener('submit', changeAccountEmail);
  document.getElementById('form-member-edit')?.addEventListener('submit', saveMemberEdit);
  document.getElementById('exp-amount')?.addEventListener('input', () => {
    if (splitType === 'exact') updateSplitRemainder();
  });
});
