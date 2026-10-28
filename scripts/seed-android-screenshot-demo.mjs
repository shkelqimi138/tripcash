// Utility for seeding deterministic TripCash demo data used in Android screenshots
const DEBUG_URL = 'http://127.0.0.1:9222/json';
const DEMO_USER_ID = '10000000-0000-4000-8000-000000000001';
const requestedScreen = process.argv[2] || 'trips';
const requestedTheme = ['light', 'dark'].includes(process.argv[3]) ? process.argv[3] : null;

const tripSpecs = [
  ['albanian-riviera', 'Albanian Riviera', 'ALL', 185000, '2027-07-01', '2027-07-06', 1, '🏖️', 'active'],
  ['swiss-alps', 'Swiss Alps', 'CHF', 2400, '2026-12-10', '2026-12-15', 1, '🏔️', 'active'],
  ['vienna-autumn', 'Vienna Autumn', 'EUR', 1900, '2026-10-01', '2026-10-07', 5, '🎡', 'active'],
  ['new-york-week', 'New York Week', 'USD', 3200, '2026-04-12', '2026-04-18', 7, '🌍', 'ended'],
  ['london-weekend', 'London Weekend', 'GBP', 1100, '2026-09-11', '2026-09-14', 4, '🎉', 'ended'],
  ['lake-como', 'Lake Como', 'EUR', 1600, '2026-07-18', '2026-07-23', 6, '🚢', 'ended'],
];

const memberNames = ['Alex Morgan', 'Maya Chen', 'Noah Williams', 'Sofia Rossi'];
const expenseTemplates = [
  ['Apartment', 'hotel', 320, 1],
  ['Airport transfer', 'transport', 74, 1],
  ['Groceries', 'food', 58, 1],
  ['Breakfast', 'food', 34, 2],
  ['Welcome dinner', 'food', 112, 2],
  ['Metro passes', 'transport', 42, 2],
  ['Coffee and pastries', 'drinks', 28, 3],
  ['Museum tickets', 'activities', 66, 3],
  ['Lunch by the square', 'food', 72, 3],
  ['Boat tickets', 'activities', 88, 4],
  ['Afternoon snacks', 'food', 31, 4],
  ['Taxi home', 'transport', 39, 4],
  ['Local market', 'food', 54, 5],
  ['Sunset cruise', 'activities', 138, 5],
  ['Farewell drinks', 'drinks', 46, 5],
];

function scaledAmount(currency, amount, index) {
  const scale = { ALL: 105, CHF: 0.92, EUR: 1, GBP: 0.86, USD: 1.08 }[currency];
  return Math.round(amount * scale * (1 + index * 0.04) * 100) / 100;
}

function makeTrip(spec, tripIndex) {
  const [slug, name, currency, budget, start_date, end_date, current_day, emoji, status] = spec;
  const id = `20000000-0000-4000-8000-${String(tripIndex + 1).padStart(12, '0')}`;
  const members = memberNames.map((memberName, memberIndex) => ({
    id: `30000000-${String(tripIndex + 1).padStart(4, '0')}-4000-8000-${String(memberIndex + 1).padStart(12, '0')}`,
    trip_id: id,
    user_id: memberIndex === 0 ? DEMO_USER_ID : null,
    name: memberName,
    paypal_link: memberIndex === 2 ? 'https://paypal.me/noahdemo' : null,
  }));
  const expenses = expenseTemplates.map(([title, category, baseAmount, day], expenseIndex) => {
    const amount = scaledAmount(currency, baseAmount, tripIndex);
    return {
      id: `40000000-${String(tripIndex + 1).padStart(4, '0')}-4000-8000-${String(expenseIndex + 1).padStart(12, '0')}`,
      trip_id: id,
      title,
      amount,
      currency,
      original_amount: amount,
      exchange_rate: 1,
      paid_by: members[expenseIndex % members.length].id,
      created_by: DEMO_USER_ID,
      created_by_name: 'Alex Morgan',
      day_number: day,
      category,
      split_type: 'equal',
      note: null,
      created_at: new Date(Date.UTC(2026, 9, 5 - day, 18 - expenseIndex)).toISOString(),
    };
  });
  const splits = expenses.flatMap(expense => {
    const share = Math.round((expense.amount / members.length) * 100) / 100;
    return members.map((member, memberIndex) => ({
      id: `${expense.id.slice(0, -1)}${memberIndex + 1}`,
      expense_id: expense.id,
      member_id: member.id,
      share_amount:
        memberIndex === members.length - 1
          ? Math.round((expense.amount - share * (members.length - 1)) * 100) / 100
          : share,
    }));
  });
  const total = Math.round(expenses.reduce((sum, expense) => sum + expense.amount, 0) * 100) / 100;
  const categories = expenses.reduce((totals, expense) => {
    totals[expense.category] = Math.round(((totals[expense.category] || 0) + expense.amount) * 100) / 100;
    return totals;
  }, {});
  const trip = {
    id,
    slug,
    name,
    creator_id: DEMO_USER_ID,
    currency,
    budget,
    start_date,
    end_date,
    current_day,
    emoji,
    status,
    created_at: `${start_date}T08:00:00.000Z`,
    _total: total,
    _myTotal: Math.round((total / members.length) * 100) / 100,
    _categories: categories,
    _expenseCount: expenses.length,
    _members: members.length,
  };
  const payments =
    status === 'ended'
      ? [
          {
            id: `50000000-0000-4000-8000-${String(tripIndex + 1).padStart(12, '0')}`,
            trip_id: id,
            from_member: members[1].id,
            to_member: members[0].id,
            amount: Math.round(total * 0.08 * 100) / 100,
            note: 'Final balance',
            day_number: current_day,
            paid_at: `${end_date}T18:00:00.000Z`,
          },
        ]
      : [];
  return {
    trip,
    members,
    expenses,
    splits,
    settled: status === 'ended' ? [1, 2, 3, 4, 5] : [],
    payments,
    contacts: [],
    role: 'creator',
  };
}

const views = tripSpecs.map(makeTrip);
const payload = {
  user: {
    id: DEMO_USER_ID,
    email: 'demo@tripcash.test',
    is_anonymous: false,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { display_name: 'Alex Morgan' },
    identities: [{ provider: 'email' }],
  },
  profile: {
    id: DEMO_USER_ID,
    display_name: 'Alex Morgan',
    paypal_link: null,
    home_currency: 'EUR',
    default_split: 'equal',
    theme_preference: 'system',
    is_anonymous: false,
  },
  views,
};

const targets = await (await fetch(DEBUG_URL)).json();
const page = targets.find(target => target.type === 'page' && target.url.startsWith('https://localhost/'));
if (!page?.webSocketDebuggerUrl) throw new Error('TripCash Android WebView is not available on port 9222.');

const expression = `(async () => {
  const payload = ${JSON.stringify(payload)};
  window._tcAccessToken = null;
  window._currentUser = payload.user;
  window._currentProfile = payload.profile;
  loadedTrips = payload.views.map(view => view.trip);
  currentTrip = null;
  currentMembers = [];
  currentExpenses = [];
  currentSplits = [];
  currentPayments = [];
  currentSettled = [];
  currentContacts = [];
  tripViewCache.clear();
  payload.views.forEach(view => tripViewCache.set(view.trip.id, view));
  cacheOfflineUser(payload.user);
  cacheProfile(payload.user, payload.profile);
  localStorage.setItem('tc-home-currency', payload.profile.home_currency);
  localStorage.setItem('tc-default-split', payload.profile.default_split);
  displayCurrencyRates['ALL-EUR'] = 0.0102;
  displayCurrencyRates['CHF-EUR'] = 1.05;
  displayCurrencyRates['GBP-EUR'] = 1.16;
  displayCurrencyRates['USD-EUR'] = 0.92;
  localStorage.removeItem('tc-offline-queue-v1-' + payload.user.id);
  persistTripsCache();
  payload.views.forEach(view => persistTripViewCache(view.trip.id));
  window.__tripCashDemoMode = true;
  window.__tripCashLiveShowToast ||= window.showToast;
  window.showToast = () => {};
  const toast = document.getElementById('toast');
  if (toast) {
    toast.className = 'toast';
    toast.textContent = '';
  }
  window.__tripCashLiveLoadTrips ||= window.loadTrips;
  window.__tripCashLiveRefreshTrips ||= window.refreshTrips;
  window.__tripCashLiveOpenTrip ||= window.openTrip;
  window.loadTrips = async () => {
    renderTripsList(loadedTrips);
    renderDashboardStats(loadedTrips);
    return loadedTrips;
  };
  window.refreshTrips = window.loadTrips;
  window.openTrip = async tripId => {
    const cached = tripViewCache.get(tripId) || restoreTripViewCache(tripId);
    if (!cached) {
      showScreen('not-found');
      return null;
    }
    currentTrip = cached.trip;
    currentMembers = cached.members;
    currentExpenses = cached.expenses;
    currentSplits = cached.splits;
    currentSettled = cached.settled;
    currentPayments = cached.payments;
    currentContacts = cached.contacts;
    location.hash = 'trip/' + tripId;
    renderDashboard(cached.role);
    return cached;
  };
  const guestBanner = document.getElementById('guest-banner');
  if (guestBanner) guestBanner.hidden = true;
  const requestedTheme = ${JSON.stringify(requestedTheme)};
  if (requestedTheme) {
    localStorage.setItem('tc-theme', requestedTheme);
    window._currentProfile.theme_preference = requestedTheme;
    applyTheme(requestedTheme);
  }
  refreshProfileIdentity(payload.user);
  renderTripsList(loadedTrips);
  renderDashboardStats(loadedTrips);
  const requestedScreen = ${JSON.stringify(requestedScreen)};
  if (requestedScreen === 'profile') {
    renderProfileScreen();
    showScreen('profile');
  } else if (requestedScreen === 'analytics') {
    renderGlobalAnalyticsScreen();
    showScreen('global-analytics');
  } else if (requestedScreen === 'expenses' || requestedScreen === 'balances') {
    const vienna = payload.views.find(view => view.trip.slug === 'vienna-autumn');
    await window.openTrip(vienna.trip.id);
    switchTab(requestedScreen === 'balances' ? 'members' : 'expenses');
  } else {
    showScreen('trips');
    document.querySelector('[data-trip-filter="' + (requestedScreen === 'upcoming' ? 'upcoming' : 'active') + '"]')?.click();
  }
  const profileSelect = document.querySelector('#screen-profile .settings-select-row select');
  const appearanceValue = document.querySelector('#screen-profile [data-action="toggle-profile-theme"] > em');
  return {
    trips: loadedTrips.length,
    expenses: payload.views.reduce((sum, view) => sum + view.expenses.length, 0),
    profileSelectFont: profileSelect ? getComputedStyle(profileSelect).fontSize : null,
    appearanceFont: appearanceValue ? getComputedStyle(appearanceValue).fontSize : null,
  };
})()`;

await new Promise((resolve, reject) => {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const timer = setTimeout(() => reject(new Error('Timed out while seeding the Android WebView.')), 10000);
  socket.addEventListener('open', () =>
    socket.send(
      JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }),
    ),
  );
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    if (response.id !== 1) return;
    clearTimeout(timer);
    socket.close();
    if (response.error || response.result?.exceptionDetails) {
      reject(new Error(JSON.stringify(response.error || response.result.exceptionDetails)));
      return;
    }
    console.log(JSON.stringify(response.result.result.value));
    resolve();
  });
  socket.addEventListener('error', () => {
    clearTimeout(timer);
    reject(new Error('Could not connect to the Android WebView debugger.'));
  });
});
