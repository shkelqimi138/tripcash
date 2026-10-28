// Browser regression tests for trip loading, durable offline work, and automatic/manual synchronization

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let nativeFixture;
function nativeBundleFixture() {
  if (nativeFixture) return nativeFixture;
  const root = path.resolve(__dirname, '../..');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'tripcash-native-e2e-'));
  fs.cpSync(path.join(root, 'web'), path.join(workspace, 'web'), { recursive: true });
  const client = 'node_modules/@supabase/supabase-js/dist/umd/supabase.js';
  fs.mkdirSync(path.dirname(path.join(workspace, client)), { recursive: true });
  fs.copyFileSync(path.join(root, client), path.join(workspace, client));
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/build-web.mjs'), '--native'], {
    cwd: workspace,
    env: { ...process.env, TRIPCASH_NATIVE_BUILD: '0' },
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr || 'Native fixture build failed');
  nativeFixture = { workspace, output: path.join(workspace, 'dist') };
  return nativeFixture;
}
test.afterAll(() => {
  if (nativeFixture) fs.rmSync(nativeFixture.workspace, { recursive: true, force: true });
});

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'traveller@example.test',
  aud: 'authenticated',
  role: 'authenticated',
  user_metadata: { display_name: 'Test Traveller' },
  app_metadata: { provider: 'email' },
};
const tripId = '00000000-0000-4000-8000-000000000002';
const memberId = '00000000-0000-4000-8000-000000000003';

async function openExpenseFromFab(page) {
  await page.locator('.web-expense-fab').click();
  const native = await page.evaluate(() => Boolean(window.Capacitor?.isNativePlatform?.()));
  if (native) {
    await expect(page.locator('#expense-action-sheet')).toBeVisible();
    await expect(page.locator('#web-workspace-fab')).toBeHidden();
    await page.locator('#expense-action-sheet [data-action="open-add-expense-modal"]').click();
  }
  await expect(page.locator('#web-expense-host')).toBeVisible();
  await expect(page.locator('#web-workspace-fab')).toBeHidden();
}

async function setupBackend(
  page,
  {
    holdTotals = false,
    legacyPreferences = null,
    holdTrips = false,
    holdExpenseSave = false,
    waitForTrips = true,
    rejectTripReads = false,
    firstLoginProfileDelay = 0,
    nativePlatform = null,
  } = {},
) {
  if (nativePlatform) {
    await page.addInitScript(platform => {
      window.Capacitor = { getPlatform: () => platform, isNativePlatform: () => true, Plugins: {} };
    }, nativePlatform);
  }
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = [
    Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: user.id, role: 'authenticated', exp: expiresAt })).toString('base64url'),
    'test-signature',
  ].join('.');
  const session = {
    access_token: token,
    refresh_token: 'test-refresh',
    token_type: 'bearer',
    expires_at: expiresAt,
    expires_in: 3600,
    user,
  };
  const backend = {
    offline: false,
    rejectWrites: false,
    writes: [],
    totalsRequested: 0,
    rows: {
      profiles: firstLoginProfileDelay
        ? []
        : [
            {
              id: user.id,
              display_name: 'Test Traveller',
              is_anonymous: false,
              home_currency: 'EUR',
              default_split: 'equal',
              theme_preference: 'system',
              preferences_initialized: false,
            },
          ],
      trips: [
        {
          id: tripId,
          name: 'Saved trip',
          creator_id: user.id,
          currency: 'EUR',
          emoji: '✈️',
          current_day: 1,
          status: 'active',
          created_at: '2026-09-01T12:00:00Z',
        },
      ],
      trip_members: [{ id: 'membership-1', trip_id: tripId, user_id: user.id, role: 'creator' }],
      members: [{ id: memberId, trip_id: tripId, user_id: user.id, name: 'Test Traveller' }],
      expenses: [],
      expense_splits: [],
      settlements: [],
      payments: [],
      contacts: [],
      activity_log: [],
    },
  };
  const totalsGate = new Promise(resolve => {
    backend.releaseTotals = resolve;
  });
  const tripsGate = new Promise(resolve => {
    backend.releaseTrips = resolve;
  });
  const expenseGate = new Promise(resolve => {
    backend.releaseExpenseSave = resolve;
  });
  backend.profileReady = !firstLoginProfileDelay;
  backend.tripReadBeforeProfileReady = false;
  await page.addInitScript(
    ({ session, legacyPreferences }) => {
      const key = 'sb-msnholvugsehlxkvzlxp-auth-token';
      // Seed both because Playwright does not guarantee ordering between separate
      // init scripts that install the mocked native runtime and auth fixture.
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(session));
      if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, JSON.stringify(session));
      if (legacyPreferences) {
        localStorage.setItem('tc-home-currency', legacyPreferences.homeCurrency);
        localStorage.setItem('tc-default-split', legacyPreferences.defaultSplit);
        localStorage.setItem('tc-theme', legacyPreferences.theme);
      }
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => sessionStorage.getItem('test-offline') !== 'true',
      });
    },
    { session, legacyPreferences },
  );
  await page.route('**/*', async route => {
    const host = new URL(route.request().url()).hostname;
    if (host === '127.0.0.1' || host.endsWith('.supabase.co')) return route.fallback();
    return route.abort();
  });
  await page.route('https://*.supabase.co/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (backend.offline) return route.abort('internetdisconnected');
    const reply = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/auth/v1/token') return reply(session);
    if (url.pathname === '/auth/v1/user') return reply(user);
    if (url.pathname === '/auth/v1/settings') return reply({ external: {} });
    if (url.pathname === '/rest/v1/rpc/get_or_create_trip_invite') {
      return reply({ token: '00000000-0000-4000-8000-000000000010', expires_at: '2026-10-01T00:00:00Z' });
    }
    if (url.pathname === '/rest/v1/rpc/rotate_trip_invite') {
      backend.inviteRotations = (backend.inviteRotations || 0) + 1;
      return reply({ token: '00000000-0000-4000-8000-000000000011', expires_at: '2026-10-02T00:00:00Z' });
    }
    if (url.pathname === '/rest/v1/rpc/create_expense_with_splits') {
      if (holdExpenseSave) await expenseGate;
      if (backend.rejectWrites) return reply({ message: 'Temporary save failure', code: 'TEST_UNAVAILABLE' }, 503);
      const payload = request.postDataJSON();
      backend.rows.expenses.push(payload.p_expense);
      backend.rows.expense_splits.push(...payload.p_splits);
      backend.writes.push({ function: 'create_expense_with_splits', payload });
      return reply(null);
    }
    const table = url.pathname.split('/rest/v1/')[1];
    if (!Object.hasOwn(backend.rows, table))
      throw new Error('Unexpected request: ' + request.method() + ' ' + url.pathname);
    if (request.method() === 'GET' && table === 'trips') {
      if (!backend.profileReady) {
        backend.tripReadBeforeProfileReady = true;
        return reply({ message: 'New account is still being prepared' }, 400);
      }
      if (holdTrips) await tripsGate;
      if (rejectTripReads) return reply({ message: 'Trip data unavailable' }, 400);
    }
    if (request.method() === 'GET' && table === 'profiles' && firstLoginProfileDelay && !backend.profileReady) {
      await new Promise(resolve => setTimeout(resolve, firstLoginProfileDelay));
      backend.profileReady = true;
    }
    if (request.method() !== 'GET' && backend.rejectWrites && table !== 'profiles') {
      return reply({ message: 'Temporary sync failure', code: 'TEST_UNAVAILABLE' }, 503);
    }
    const matches = row =>
      [...url.searchParams].every(([column, filter]) => {
        if (filter.startsWith('eq.')) return String(row[column]) === filter.slice(3);
        if (filter === 'is.null') return row[column] == null;
        if (filter.startsWith('in.(')) return filter.slice(4, -1).split(',').includes(String(row[column]));
        return true;
      });
    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      const rows = Array.isArray(payload) ? payload : [payload];
      for (const row of rows) {
        const existing = backend.rows[table].find(item => item.id && item.id === row.id);
        if (!existing) backend.rows[table].push({ ...row });
      }
      backend.writes.push({ table, method: 'POST', rows });
      return reply(null, 201);
    }
    if (request.method() === 'PATCH') {
      const payload = request.postDataJSON();
      const changed = backend.rows[table].filter(matches);
      changed.forEach(row => Object.assign(row, payload));
      backend.writes.push({ table, method: 'PATCH', payload });
      return reply(url.searchParams.has('select') ? changed : null);
    }
    if (request.method() === 'DELETE') {
      const deleted = backend.rows[table].filter(matches);
      backend.rows[table] = backend.rows[table].filter(row => !matches(row));
      return reply(deleted);
    }
    if (holdTotals && ['members', 'expenses'].includes(table) && url.searchParams.get('trip_id')?.startsWith('in.')) {
      backend.totalsRequested += 1;
      await totalsGate;
    }
    const rows = backend.rows[table].filter(matches);
    const single = request.headers().accept?.includes('vnd.pgrst.object');
    return reply(single ? rows[0] || null : rows);
  });
  if (nativePlatform) {
    const fixture = nativeBundleFixture();
    for (const [resource, contentType] of [
      ['app', 'text/html'],
      ['scripts/native-redesign.js', 'text/javascript'],
      ['styles/native-redesign.css', 'text/css'],
    ]) {
      const file = resource === 'app' ? 'index.html' : resource;
      await page.route(`http://127.0.0.1:4173/${resource}*`, route =>
        route.fulfill({
          contentType,
          body: fs.readFileSync(path.join(fixture.output, file)),
        }),
      );
    }
  }
  await page.goto('/app');
  await expect(page.locator('#screen-trips')).toHaveClass(/active/);
  if (waitForTrips) await expect(page.locator('.trip-card')).toContainText('Saved trip');
  return backend;
}

async function setConnectivity(page, backend, online) {
  backend.offline = !online;
  // Simulate WKWebView connectivity while keeping the bundled app files loadable on reload.
  await page.evaluate(online => {
    sessionStorage.setItem('test-offline', String(!online));
    window.dispatchEvent(new Event(online ? 'online' : 'offline'));
  }, online);
}

async function createOfflineTrip(page, name) {
  await page.getByRole('button', { name: '+ New trip', exact: true }).click();
  await page.locator('#trip-name').fill(name);
  await page.locator('#btn-create-trip').click();
  await expect(page.locator('#screen-dashboard')).toHaveClass(/active/);
  await expect(page.locator('#dash-trip-name')).toContainText(name);
}

async function returnToTrips(page) {
  await page.locator('#screen-dashboard [data-action="go-to-trips"]').click();
  await expect(page.locator('#screen-trips')).toHaveClass(/active/);
}

function seedWorkspaceExpenses(backend) {
  const expenses = [
    { id: '00000000-0000-4000-8000-000000000021', title: 'Guesthouse', amount: 60, category: 'hotel' },
    { id: '00000000-0000-4000-8000-000000000022', title: 'Dinner', amount: 40, category: 'food' },
  ].map(expense => ({
    ...expense,
    trip_id: tripId,
    currency: 'EUR',
    original_amount: expense.amount,
    paid_by: memberId,
    created_by: user.id,
    created_by_name: 'Test Traveller',
    day_number: 1,
    split_type: 'equal',
    exchange_rate: 1,
    created_at: '2026-09-01T13:00:00Z',
  }));
  backend.rows.trips[0].budget = 1000;
  backend.rows.expenses.push(...expenses);
  backend.rows.expense_splits.push(
    ...expenses.map((expense, index) => ({
      id: `workspace-split-${index}`,
      expense_id: expense.id,
      member_id: memberId,
      share_amount: expense.amount,
    })),
  );
}

async function openWorkspaceTripSettings(page) {
  await page.locator('#web-trip-overflow summary').click();
}

const RECEIPT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
  'base64',
);

test('web desktop navigation, trip switching, and account menu retain existing actions', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const backend = await setupBackend(page);
  await expect(page.locator('#web-topbar')).toBeVisible();
  await expect(page.locator('#app-bottom-nav')).toBeHidden();
  await expect(page.getByRole('button', { name: '+ New trip', exact: true })).toHaveCount(1);
  expect((await page.locator('.web-new-trip').boundingBox()).width).toBeLessThan(180);
  const second = { ...backend.rows.trips[0], id: '00000000-0000-4000-8000-000000000008', name: 'Second trip' };
  backend.rows.trips.push(second);
  backend.rows.trip_members.push({ id: 'membership-2', trip_id: second.id, user_id: user.id, role: 'creator' });
  await page.evaluate(() => loadTrips());
  await page.evaluate(id => openTrip(id), tripId);
  await expect(page.locator('#web-trip-name')).toHaveText('Saved trip');
  await page.locator('#web-trip-switcher summary').click();
  await page.locator('#web-trip-options').getByRole('button', { name: 'Second trip' }).click();
  await expect(page.locator('#web-trip-name')).toHaveText('Second trip');
  await expect(page.locator('#web-trip-switcher')).not.toHaveAttribute('open');
  await page.locator('.web-main-nav').getByRole('button', { name: 'Profile & settings' }).click();
  await expect(page.locator('#screen-profile')).toHaveClass(/active/);
  await expect(page.locator('.web-main-nav [data-nav="profile"]')).toHaveAttribute('aria-current', 'page');
  await page.locator('#web-account-menu summary').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#web-account-menu summary')).toBeFocused();
  await expect(page.locator('#web-account-menu')).not.toHaveAttribute('open');
  await page.locator('#web-account-menu summary').click();
  await page.locator('#web-account-menu').getByRole('button', { name: 'Account settings' }).click();
  await expect(page.locator('#modal-account')).toHaveClass(/open/);
});

test('web tablet navigation fits without horizontal overflow', async ({ page }) => {
  await setupBackend(page);
  await page.evaluate(id => openTrip(id), tripId);
  for (const width of [834, 761, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('.web-main-nav')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('#app-bottom-nav')).toBeHidden();
  }
});

test('mobile web switches from global navigation to the two core trip tabs', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupBackend(page);
  await expect(page.locator('.web-main-nav')).toBeHidden();
  await expect(page.locator('#app-bottom-nav')).toBeVisible();
  await page.evaluate(id => openTrip(id), tripId);
  await expect(page.locator('#app-bottom-nav')).toBeHidden();
  await expect(page.locator('body > #trip-bottom-nav')).toBeVisible();
  await expect(page.locator('#trip-bottom-nav button:visible')).toHaveCount(2);
  await expect(page.locator('#trip-bottom-nav [data-value="members"] b')).toHaveText('Balances');
  const headerGeometry = await page.evaluate(() => {
    const back = document.querySelector('.web-trip-breadcrumb').getBoundingClientRect();
    const title = document.querySelector('.web-trip-title-row').getBoundingClientRect();
    const day = document.querySelector('.web-trip-day-subtitle').getBoundingClientRect();
    const overflow = document.querySelector('#web-trip-overflow').getBoundingClientRect();
    const controls = document.querySelector('.web-trip-header-right').getBoundingClientRect();
    const titleCenter = title.left + title.width / 2;
    // The title is centred in the space between Back and the controls, never under them.
    return {
      valid:
        back.right <= title.left &&
        title.right <= controls.left &&
        Math.abs(titleCenter - (back.right + controls.left) / 2) < 12 &&
        day.top >= title.bottom - 1 &&
        overflow.right <= window.innerWidth - 15,
      back: { left: back.left, right: back.right },
      titleCenter,
      titleBottom: title.bottom,
      dayTop: day.top,
      overflowRight: overflow.right,
      viewportWidth: window.innerWidth,
    };
  });
  expect(headerGeometry).toMatchObject({ valid: true });
  expect(
    await page.evaluate(() => {
      const currency = document.querySelector('#web-trip-currency').getBoundingClientRect();
      const overflow = document.querySelector('#web-trip-overflow').getBoundingClientRect();
      return currency.right <= overflow.left + 1;
    }),
  ).toBe(true);
  await expect(page.locator('#web-workspace-fab')).toBeVisible();
  await expect(page.locator('#tab-expenses')).toBeVisible();
  await expect(page.locator('#trip-bottom-nav [data-value="analytics"]')).toHaveCount(0);
  await expect(page.locator('#web-sync')).toBeVisible();
  await expect(page.locator('#screen-dashboard .mobile-shell-header')).toBeHidden();
  await page.locator('#trip-bottom-nav [data-value="expenses"]').click();
  await expect(page.locator('#tab-expenses')).toBeVisible();
  await page.locator('#trip-bottom-nav [data-value="members"]').click();
  await expect(page.locator('#tab-members')).toHaveClass(/active/);
  await expect(page.locator('#web-workspace-fab')).toBeHidden();
  await expect(page.locator('#tab-members .member-add-controls')).toHaveCount(1);
  await expect(page.locator('#tab-members .add-member-dashed')).toHaveCount(0);
  await expect(page.locator('#tab-members')).not.toContainText('Manage members');
  await page.locator('#trip-bottom-nav [data-value="expenses"]').click();
  await expect(page.locator('#web-workspace-fab')).toBeVisible();
  await page.locator('#trip-bottom-nav [data-value="members"]').click();
  await expect(page.locator('#web-workspace-fab')).toBeHidden();
  expect(
    await page
      .locator('#tab-members .member-avatar-42')
      .first()
      .evaluate(el => el.getBoundingClientRect().width),
  ).toBeLessThanOrEqual(34);
  expect(
    await page
      .locator('#tab-members .split-member-row strong')
      .first()
      .evaluate(el => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeLessThanOrEqual(13);
  await page.locator('#web-trip-overflow summary').click();
  expect(
    await page.locator('#web-trip-overflow .web-dropdown').evaluate(menu => {
      const rect = menu.getBoundingClientRect();
      const style = getComputedStyle(menu);
      return (
        rect.right <= window.innerWidth - 15 &&
        rect.left >= 0 &&
        style.overflowY === 'visible' &&
        menu.scrollHeight <= menu.clientHeight
      );
    }),
  ).toBe(true);
  await page.locator('#web-trip-overflow [data-value="analytics"]').click();
  await expect(page.locator('#tab-analytics')).toBeVisible();
  await expect(page.locator('#screen-global-analytics')).toBeHidden();
  await page.evaluate(() => goToTrips());
  await expect(page.locator('#app-bottom-nav')).toBeVisible();
  await expect(page.locator('#trip-bottom-nav')).toBeHidden();
  await page.locator('#app-bottom-nav [data-nav="analytics"]').click();
  await expect(page.locator('#screen-global-analytics')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a trip reopens immediately after Back while its background refresh is still pending', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupBackend(page);
  await page.evaluate(() => {
    let releaseRate;
    window.__releasePendingTripRate = () => releaseRate?.();
    ensureDisplayRate = () =>
      new Promise(resolve => {
        releaseRate = resolve;
      });
  });

  await page.locator('.web-trip-card').click();
  await expect(page.locator('#screen-dashboard')).toHaveClass(/active/);
  await page.locator('.web-trip-breadcrumb [data-action="go-to-trips"]').click();
  await expect(page.locator('#screen-trips')).toHaveClass(/active/);
  await page.locator('.web-trip-card').click();
  await expect(page.locator('#screen-dashboard')).toHaveClass(/active/);
  await page.evaluate(() => window.__releasePendingTripRate());
});

test('web theme menu uses saved preferences and offline sync controls are not duplicated', async ({ page }) => {
  const backend = await setupBackend(page);
  await page.evaluate(() => {
    localStorage.setItem('tc-theme', 'system');
    applyTheme('system');
  });
  await page.locator('#web-account-menu summary').click();
  await page.locator('#web-theme-choice').click();
  await expect(page.locator('body')).toHaveClass(/light/);
  await expect(page.locator('#web-theme-choice')).toHaveText('Theme: light');
  await setConnectivity(page, backend, false);
  await createOfflineTrip(page, 'Web offline trip');
  await expect(page.locator('#web-sync')).toHaveAttribute('data-state', 'offline');
  await expect(page.locator('#web-sync #offline-sync-status')).toContainText('pending');
  await expect(page.locator('#btn-sync-now')).toHaveCount(1);
  await expect(page.locator('#btn-review-sync')).toHaveCount(1);
});

test('native runtime retains the existing header, nav, and tokens', async ({ page }) => {
  await page.addInitScript(() => {
    window.Capacitor = { getPlatform: () => 'ios', isNativePlatform: () => true, Plugins: {} };
  });
  await setupBackend(page);
  await expect(page.locator('html')).toHaveClass(/native-shell/);
  await expect(page.locator('body')).not.toHaveClass(/web-redesign/);
  await expect(page.locator('#web-topbar')).toBeHidden();
  await expect(page.locator('#screen-trips .app-header')).toBeVisible();
  await page.evaluate(id => openTrip(id), tripId);
  await expect(page.locator('#trip-bottom-nav')).toBeVisible();
  await expect(page.locator('.dash-header #trip-bottom-nav')).toHaveCount(0);
  await expect(page.locator('#tab-expenses')).toHaveClass(/active/);
  await expect(page.locator('#trip-bottom-nav [data-value="expenses"]')).toBeVisible();
  await expect(page.locator('#trip-bottom-nav button:visible')).toHaveCount(2);
  expect(await page.locator('body').evaluate(el => getComputedStyle(el).getPropertyValue('--danger').trim())).toBe(
    '#F59E0B',
  );
});

test('stage 5 iOS native bundle keeps the redesigned trip flow and offline expense sheet', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const backend = await setupBackend(page, { nativePlatform: 'ios' });
  await expect(page.locator('html')).toHaveClass(/native-ios/);
  await expect(page.locator('body')).toHaveClass(/native-redesign/);
  await expect(page.locator('#web-topbar')).toHaveCount(0);
  await expect(page.locator('#screen-trips .app-header')).toBeVisible();
  await expect(page.locator('#screen-trips .app-header > [data-action="open-new-trip-modal"]')).toBeVisible();
  await page.evaluate(id => openTrip(id), tripId);
  await expect(page.locator('body > #trip-bottom-nav')).toBeVisible();
  await expect(page.locator('#app-bottom-nav')).toBeHidden();
  await expect(page.locator('#tab-expenses')).toBeVisible();
  await openExpenseFromFab(page);
  await expect(page.locator('#app-bottom-nav')).toBeHidden();
  await expect(page.locator('#trip-bottom-nav')).toBeHidden();
  await page.locator('#exp-title').focus();
  await expect(page.locator('html')).toHaveClass(/native-keyboard-open/);
  await expect(page.locator('#trip-bottom-nav')).toBeHidden();
  expect(await page.evaluate(() => nativeRefreshScrollContainer()?.id)).toBe('screen-dashboard');
  expect(await page.locator('#screen-dashboard').evaluate(el => getComputedStyle(el).overflowY)).toBe('auto');
  expect(await page.locator('#screen-dashboard .dash-content').evaluate(el => getComputedStyle(el).overflowY)).toBe(
    'visible',
  );
  expect(await page.locator('#web-expense-host').evaluate(el => el.parentElement === document.body)).toBe(true);
  await expect(page.locator('#btn-add-expense')).toBeInViewport();
  await page.setViewportSize({ width: 393, height: 500 }); // Keyboard-sized visible area.
  await expect(page.locator('#btn-add-expense')).toBeInViewport();
  expect(
    await page.evaluate(() => {
      const title = document.querySelector('.expense-title-group').getBoundingClientRect();
      const amount = document.querySelector('.expense-amount-card').getBoundingClientRect();
      const payer = document.querySelector('#exp-paid-by').getBoundingClientRect();
      const category = document.querySelector('.expense-category-group').getBoundingClientRect();
      return (
        amount.top >= title.bottom - 1 &&
        payer.top >= title.bottom - 1 &&
        category.top >= Math.max(amount.bottom, payer.bottom) - 1
      );
    }),
  ).toBe(true);
  await expect(page.locator('#exp-day')).toBeHidden();
  await expect(page.locator('#web-expense-split')).toBeHidden();
  expect(await page.evaluate(() => nativeRefreshCanStart({ target: document.body }))).toBe(false);
  await page.locator('#exp-title').fill('Airport transfer');
  await page.locator('#exp-amount').fill('24');
  await setConnectivity(page, backend, false);
  await page.locator('#btn-add-expense').click();
  await expect(page.locator('#web-expense-host')).toBeHidden();
  await expect(page.locator('#web-workspace-expenses-list .web-expense-pending')).toContainText('Waiting to sync');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => openProfileView());
  await expect(page.locator('.profile-title')).toBeVisible();
  expect(
    await page.locator('#profile-content').evaluate(el => parseFloat(getComputedStyle(el).paddingTop)),
  ).toBeGreaterThanOrEqual(20);
  await expect(page.locator('#screen-profile .settings-select-row select').first()).toHaveCSS('font-size', '16px');
  await page.evaluate(() => openAccountSettings('profile'));
  await page.locator('#settings-name').focus();
  await expect(page.locator('html')).toHaveClass(/native-keyboard-open/);
  await expect(page.locator('#modal-account .legal-links')).toBeHidden();
  await page.evaluate(() => {
    closeModal('modal-account');
    openChangePassword();
  });
  await expect(page.locator('#modal-new-password')).toHaveClass(/open/);
  expect(
    await page.locator('#auth-turnstile-reauth').evaluate(el => {
      const box = el.getBoundingClientRect();
      const form = el.closest('form').getBoundingClientRect();
      return box.left >= form.left && box.right <= form.right;
    }),
  ).toBe(true);
});

test('native phone Trips use compact rows with travel emojis and closed labels', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const backend = await setupBackend(page, { nativePlatform: 'ios' });
  await expect(page.locator('.web-trip-card .mobile-trip-emoji')).toBeVisible();
  await expect(page.locator('.web-trip-card .mobile-trip-emoji')).toHaveText('✈️');
  expect(
    await page.locator('.web-trip-card .mobile-trip-copy > strong').evaluate(element => ({
      whiteSpace: getComputedStyle(element).whiteSpace,
      lineClamp: getComputedStyle(element).webkitLineClamp,
    })),
  ).toEqual({ whiteSpace: 'normal', lineClamp: '2' });
  await expect(page.locator('.web-trip-card .mobile-trip-status .web-trip-tag')).toBeVisible();
  const activeRow = await page
    .locator('.web-trip-card')
    .evaluate(el => ({ height: el.getBoundingClientRect().height, radius: getComputedStyle(el).borderRadius }));
  expect(activeRow.height).toBeLessThan(100);
  expect(activeRow.radius).toBe('0px');

  backend.rows.trips[0].status = 'ended';
  backend.rows.trips[0].emoji = '🏖️';
  await page.evaluate(() => loadTrips());
  await page.locator('[data-trip-filter="ended"]').click();
  const ended = page.locator('.web-ended-row');
  await expect(ended.locator('.mobile-trip-emoji')).toHaveText('🏖️');
  await expect(ended.locator('.mobile-trip-emoji')).toBeVisible();
  await expect(ended.locator('.mobile-trip-status .native-closed-stamp')).toHaveText('✓ Trip closed');
  await expect(ended.locator('.mobile-trip-status .native-closed-stamp')).toBeVisible();
  await expect(ended.locator('.web-trip-tag.is-neutral')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('#screen-trips .app-header > [data-action="open-new-trip-modal"]').click();
  await expect(page.locator('#app-bottom-nav')).toBeHidden();
  await page.locator('#trip-name').focus();
  await expect(page.locator('html')).toHaveClass(/native-keyboard-open/);
  await expect(page.locator('#btn-create-trip')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('phone Safari Trips match native compact rows and New trip stays within the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const backend = await setupBackend(page);
  await expect(page.locator('.web-trip-card .mobile-trip-emoji')).toBeVisible();
  await expect(page.locator('.web-trip-card .web-trip-heading')).toBeHidden();
  backend.rows.trips[0].status = 'ended';
  await page.evaluate(() => loadTrips());
  await page.locator('[data-trip-filter="ended"]').click();
  await expect(page.locator('.web-ended-row .mobile-trip-status .native-closed-stamp')).toBeVisible();
  await page.locator('#web-new-trip').click();
  await expect(page.locator('#modal-new-trip')).toHaveClass(/open/);
  await expect(page.locator('#btn-create-trip')).toBeInViewport();
  expect(await page.locator('#emoji-picker').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(
    await page
      .locator('#emoji-picker .emoji-btn')
      .first()
      .evaluate(el => el.getBoundingClientRect().width),
  ).toBeGreaterThanOrEqual(48);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('stage 5 Android native bundle closes the expense sheet before navigating back', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await setupBackend(page, { nativePlatform: 'android' });
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('#trip-bottom-nav [data-value="expenses"]').click();
  await openExpenseFromFab(page);
  await page.locator('#exp-title').focus();
  await page.evaluate(() => handleNativeBackButton());
  await expect(page.locator('#exp-title')).not.toBeFocused();
  await expect(page.locator('#web-expense-host')).toBeVisible();
  await page.waitForTimeout(400); // Native focus-out guard keeps Back from closing a sheet while the keyboard hides.
  await page.evaluate(() => handleNativeBackButton());
  await expect(page.locator('#web-expense-host')).toBeHidden();
  await expect(page.locator('#screen-dashboard')).toHaveClass(/active/);
  await openExpenseFromFab(page);
  await page.locator('#web-expense-host [data-action="close-expense-screen"]').click();
  await expect(page.locator('#web-expense-host')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('iOS popup moves above the keyboard before the WebView viewport resizes', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.locator('#screen-trips .app-header > [data-action="open-new-trip-modal"]').click();
  await page.locator('#trip-budget').focus();

  await expect(page.locator('html')).toHaveClass(/native-keyboard-open/);
  await page.evaluate(() => setNativeKeyboardOpen(true, 320));
  await expect(page.locator('html')).toHaveCSS('--native-keyboard-height', '320px');
  await expect
    .poll(() => page.locator('#modal-new-trip').evaluate(modal => Math.round(modal.getBoundingClientRect().bottom)))
    .toBe(532);
  expect(
    await page.locator('#trip-budget').evaluate(field => {
      const fieldRect = field.getBoundingClientRect();
      const sheetRect = field.closest('.modal-sheet').getBoundingClientRect();
      return fieldRect.top >= sheetRect.top && fieldRect.bottom <= sheetRect.bottom;
    }),
  ).toBe(true);
  await expect(page.locator('#modal-new-trip .modal-sheet')).toHaveCSS('overflow-y', 'auto');
});

async function openSignedOutNativeApp(page) {
  await page.addInitScript(() => {
    window.Capacitor = { getPlatform: () => 'ios', isNativePlatform: () => true, Plugins: {} };
  });
  await page.route('https://tripcash.de/native-captcha*', route =>
    route.fulfill({ contentType: 'text/html', body: '' }),
  );
  const fixture = nativeBundleFixture();
  for (const [resource, contentType] of [
    ['app', 'text/html'],
    ['scripts/native-redesign.js', 'text/javascript'],
    ['styles/native-redesign.css', 'text/css'],
  ]) {
    const file = resource === 'app' ? 'index.html' : resource;
    await page.route(`http://127.0.0.1:4173/${resource}*`, route =>
      route.fulfill({
        contentType,
        body: fs.readFileSync(path.join(fixture.output, file)),
      }),
    );
  }
  await page.goto('/app');
  await page.locator('#landing-primary-action').click();
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'auth');
  await expect(page.locator('body')).not.toHaveClass(/native-redesign/);
}

test('signed-out iOS screens keep the field and its button above the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await openSignedOutNativeApp(page);
  await page.locator('#login-email').focus();
  await page.evaluate(() => setNativeKeyboardOpen(true, 320));
  const keyboardTop = 852 - 320;
  await expect
    .poll(() =>
      page.locator('#btn-login-continue').evaluate(button => Math.round(button.getBoundingClientRect().bottom)),
    )
    .toBeLessThanOrEqual(keyboardTop);
  expect(await page.locator('#login-email').evaluate(field => field.getBoundingClientRect().top >= 0)).toBe(true);
});

test('signed-out iOS Create account keeps a top field in place instead of jumping to the button', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openSignedOutNativeApp(page);
  await page.getByRole('link', { name: 'Create account' }).click();
  await expect(page.locator('#form-register')).toBeVisible();
  const scroller = page.locator('#screen-auth');
  await page.locator('#reg-name').focus();
  const before = await page.locator('#reg-name').evaluate(field => Math.round(field.getBoundingClientRect().top));
  await page.evaluate(() => setNativeKeyboardOpen(true, 300));
  await page.waitForTimeout(400);
  // The button is too far below to fit with the field, so the field stays where it was.
  const after = await page.locator('#reg-name').evaluate(field => Math.round(field.getBoundingClientRect().top));
  expect(Math.abs(after - before)).toBeLessThanOrEqual(2);
  expect(
    await page.locator('#btn-register').evaluate(button => button.getBoundingClientRect().bottom > 667 - 300),
  ).toBe(true);
  expect(await scroller.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
});

test('signed-out iOS Reset password sheet moves above the keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await openSignedOutNativeApp(page);
  await page.evaluate(() => openForgotPassword());
  await expect(page.locator('#modal-forgot-password')).toHaveClass(/open/);
  await page.evaluate(() => setNativeKeyboardOpen(true, 320));
  await expect
    .poll(() =>
      page.locator('#modal-forgot-password').evaluate(modal => Math.round(modal.getBoundingClientRect().bottom)),
    )
    .toBe(532);
  expect(
    await page.locator('#forgot-email').evaluate(field => {
      const rect = field.getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= 532;
    }),
  ).toBe(true);
});

test('stage 5 native tablet still uses trip chips, bottom navigation, and an expense sheet', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1112 });
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.evaluate(id => openTrip(id), tripId);
  await expect(page.locator('#app-bottom-nav')).toBeVisible();
  await expect(page.locator('.dash-header #trip-bottom-nav')).toBeVisible();
  await openExpenseFromFab(page);
  await expect(page.locator('#web-expense-host')).toHaveAttribute('role', 'dialog');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('stage 6 native iPhone and iPad size matrix keeps navigation and expense entry within the viewport', async ({
  page,
}) => {
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.evaluate(id => openTrip(id), tripId);
  for (const [width, height] of [
    [390, 844], // iPhone portrait
    [744, 1133],
    [834, 1194],
    [1032, 1376], // iPad mini, 11-inch, 13-inch portrait
    [1133, 744],
    [1194, 834],
    [1376, 1032], // the same iPads in landscape
  ]) {
    await page.setViewportSize({ width, height });
    if (width <= 760) {
      await expect(page.locator('#app-bottom-nav')).toBeHidden();
      await expect(page.locator('body > #trip-bottom-nav')).toBeVisible();
    } else {
      await expect(page.locator('#app-bottom-nav')).toBeVisible();
      await expect(page.locator('.dash-header #trip-bottom-nav')).toBeVisible();
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `${width}×${height} workspace overflow`,
    ).toBe(true);
    await page.locator('#trip-bottom-nav [data-value="expenses"]').click();
    await openExpenseFromFab(page);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      `${width}×${height} sheet overflow`,
    ).toBe(true);
    await page.locator('#web-expense-host [data-action="close-expense-screen"]').click();
    await expect(page.locator('#web-expense-host')).toBeHidden();
  }
});

test('web workspace keeps a two-tab shell, compact overflow, summary rail, and a FAB', async ({ page }) => {
  const backend = await setupBackend(page);
  seedWorkspaceExpenses(backend);
  await page.evaluate(id => openTrip(id), tripId);
  await expect(page.locator('#tab-expenses')).toHaveClass(/active/);
  await expect(page.locator('#tab-overview')).toBeHidden();
  await expect(page.locator('#trip-bottom-nav button:visible')).toHaveCount(2);
  await expect(page.locator('#trip-bottom-nav [data-value="expenses"]')).toHaveClass(/active/);
  await expect(page.locator('[data-web-total]')).toHaveText('EUR 100.00');
  await expect(page.locator('.web-rail-summary')).toContainText('Trip summary');
  await expect(page.locator('#web-trip-overflow')).toContainText('•••');
  await expect(page.locator('#web-workspace-expenses-list .expense-card')).toHaveCount(2);
  await expect(page.locator('#screen-dashboard [data-action="open-add-expense-modal"]')).toHaveCount(0);
  await expect(page.locator('.web-expense-fab')).toBeVisible();
  await page.locator('.web-expense-fab').click();
  await expect(page.locator('#expense-action-sheet')).toBeHidden();
  await expect(page.locator('#web-expense-host')).toBeVisible();
  await expect(page.locator('#btn-add-expense')).toBeEnabled();
  await expect(page.locator('#display-currency')).toHaveCount(1);
  await page.locator('#web-expense-host [data-action="close-expense-screen"]').click();
  await page.locator('#web-trip-overflow summary').click();
  await expect(page.locator('#web-trip-overflow').getByRole('button', { name: 'Export CSV', exact: true })).toHaveCount(
    1,
  );
});

test('receipt selection remains local and hands off to manual expense entry', async ({ page }) => {
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.route('https://tripcash.de/api/receipt-scan', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        suggestions: { title: 'Dinner', amount: 24.5, currency: 'EUR', category: 'food', receiptDate: '2026-10-06' },
      }),
    }),
  );
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  const receiptInput = page.locator('#receipt-photo-input');
  await receiptInput.setInputFiles({
    name: 'dinner-receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  const review = page.locator('#receipt-review-sheet');
  await expect(review).toBeVisible();
  await expect(review).toContainText('dinner-receipt.png');
  await expect(review).toContainText('Ready to scan');
  await expect(review).toContainText('send this photo securely to OpenAI for one-time extraction');
  await review.getByRole('button', { name: 'Scan receipt' }).click();
  await expect(review).toContainText('Receipt scanned');
  await expect(review).toContainText('Payer and split stay unchanged');
  await review.getByRole('button', { name: 'Review suggested details' }).click();
  await expect(review).toBeHidden();
  await expect(page.locator('#web-expense-host')).toBeVisible();
  await expect(page.locator('#expense-receipt-draft-notice')).toContainText('Receipt details were suggested');
  await expect(page.locator('#exp-title')).toHaveValue('Dinner');
  await expect(page.locator('#exp-amount')).toHaveValue('24.5');
  await expect(page.locator('#exp-currency')).toHaveValue('EUR');
  await expect(page.locator('#exp-category')).toHaveValue('food');
  await expect(page.locator('#web-expense-split')).toHaveValue('equal');
  await page.locator('#web-expense-host [data-action="close-expense-screen"]').click();

  await page.locator('.web-expense-fab').click();
  await receiptInput.setInputFiles({
    name: 'dinner-receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(review).toContainText('Ready to scan');
  await review.getByRole('button', { name: 'Continue manually' }).click();
  await expect(review).toBeHidden();
  await expect(page.locator('#web-expense-host')).toBeVisible();
  await expect(page.locator('#expense-receipt-draft-notice')).toContainText('dinner-receipt.png is ready');
  await expect(page.locator('#exp-title')).toHaveValue('');
  await expect(page.locator('#exp-amount')).toHaveValue('');
  await page.locator('#web-expense-host [data-action="close-expense-screen"]').click();

  await page.evaluate(() =>
    window.openAddExpenseModal({
      receiptDraft: {
        source: 'receipt',
        photo: { name: 'bar-receipt.jpg' },
        suggestions: { title: 'Drinks at the bar', amount: 24.5, currency: 'USD', category: 'drinks' },
      },
    }),
  );
  await expect(page.locator('#expense-receipt-draft-notice')).toContainText('Receipt details were suggested');
  await expect(page.locator('#exp-title')).toHaveValue('Drinks at the bar');
  await expect(page.locator('#exp-amount')).toHaveValue('24.5');
  await expect(page.locator('#exp-currency')).toHaveValue('USD');
  await expect(page.locator('#exp-category')).toHaveValue('drinks');
  await expect(page.locator('#web-expense-split')).toHaveValue('equal');
});

test('native receipt action uses the Capacitor camera picker instead of a hidden file input', async ({ page }) => {
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.evaluate(() => {
    window.__cameraPickerCalls = 0;
    window.__deletedReceiptPaths = [];
    window.Capacitor.Plugins.Camera = {
      getPhoto: async () => {
        window.__cameraPickerCalls += 1;
        return {
          format: 'png',
          path: 'file:///private/cache/receipt.png',
          webPath:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
        };
      },
    };
    window.Capacitor.Plugins.Filesystem = {
      deleteFile: async options => {
        window.__deletedReceiptPaths.push(options.path);
      },
    };
  });
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  await page.locator('#expense-action-sheet [data-action="open-receipt-picker"]').click();
  await expect(page.locator('#receipt-review-sheet')).toBeVisible();
  await expect(page.locator('#web-workspace-fab')).toBeHidden();
  await expect(page.locator('#receipt-review-sheet')).toContainText('Ready to scan');
  expect(await page.evaluate(() => window.__cameraPickerCalls)).toBe(1);
  expect(await page.evaluate(() => window.__deletedReceiptPaths)).toEqual(['file:///private/cache/receipt.png']);
});

test('native receipt picker deletes its temporary file when the selected image cannot be opened', async ({ page }) => {
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.evaluate(() => {
    window.__deletedReceiptPaths = [];
    window.Capacitor.Plugins.Camera = {
      getPhoto: async () => ({
        format: 'png',
        path: 'file:///private/cache/broken.png',
        webPath: '/missing-native-receipt.png',
      }),
    };
    window.Capacitor.Plugins.Filesystem = {
      deleteFile: async options => {
        window.__deletedReceiptPaths.push(options.path);
      },
    };
  });
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  await page.locator('#expense-action-sheet [data-action="open-receipt-picker"]').click();
  const review = page.locator('#receipt-review-sheet');
  await expect(review).toContainText('Photo could not be opened');
  expect(await page.evaluate(() => window.__deletedReceiptPaths)).toEqual(['file:///private/cache/broken.png']);
});

async function openDeferredNativeReceiptPicker(page) {
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.evaluate(() => {
    window.Capacitor.Plugins.Camera = {
      getPhoto: () =>
        new Promise((resolve, reject) => {
          window.__resolvePhoto = resolve;
          window.__rejectPhoto = reject;
        }),
    };
  });
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  await page.locator('#expense-action-sheet [data-action="open-receipt-picker"]').click();
  return page.locator('#receipt-review-sheet');
}

const NATIVE_RECEIPT_PHOTO = {
  format: 'png',
  webPath:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
};

test('receipt sheet shows a loading state while iOS prepares a new photo', async ({ page }) => {
  const review = await openDeferredNativeReceiptPicker(page);
  // Visible as soon as the picker closes, before the photo arrives.
  await expect(review).toBeVisible();
  await expect(review.locator('#receipt-review-title')).toHaveText('Receipt photo');
  await expect(review.locator('.receipt-photo-spinner')).toBeVisible();
  await expect(review).toContainText('Waiting for your photo…');
  await expect(review.getByRole('button', { name: 'Scan receipt' })).toBeDisabled();
  await expect(review.getByRole('button', { name: 'Continue manually' })).toBeEnabled();
  await expect(review).toContainText('New photos can take a few seconds to prepare.', { timeout: 5000 });

  await page.evaluate(photo => window.__resolvePhoto(photo), NATIVE_RECEIPT_PHOTO);
  await expect(review).toContainText('Ready to scan');
  await expect(review.locator('#receipt-review-title')).toHaveText('Receipt selected');
  await expect(review.locator('.receipt-photo-spinner')).toBeHidden();
  await expect(review.getByRole('button', { name: 'Scan receipt' })).toBeEnabled();
});

test('cancelling the photo picker closes the loading receipt sheet', async ({ page }) => {
  const review = await openDeferredNativeReceiptPicker(page);
  await expect(review).toBeVisible();
  await page.evaluate(() =>
    window.__rejectPhoto(Object.assign(new Error('User cancelled photos app'), { code: 'OS-PLUG-CAMR-0006' })),
  );
  await expect(review).toBeHidden();
});

test('a photo that cannot be opened shows an error with Choose another', async ({ page }) => {
  const review = await openDeferredNativeReceiptPicker(page);
  await page.evaluate(() => window.__rejectPhoto(new Error('Error loading image')));
  await expect(review).toContainText('Photo could not be opened');
  await expect(review).toContainText('Error loading image');
  await expect(review.locator('.receipt-photo-spinner')).toBeHidden();
  await expect(review.getByRole('button', { name: 'Choose another' })).toBeEnabled();
  await expect(review.getByRole('button', { name: 'Continue manually' })).toBeEnabled();
  await expect(review.getByRole('button', { name: 'Scan receipt' })).toBeDisabled();
});

test('continuing manually while a photo loads opens a plain expense and ignores the late photo', async ({ page }) => {
  const review = await openDeferredNativeReceiptPicker(page);
  await review.getByRole('button', { name: 'Continue manually' }).click();
  await expect(review).toBeHidden();
  await expect(page.locator('#web-expense-host')).toBeVisible();
  await page.evaluate(photo => window.__resolvePhoto(photo), NATIVE_RECEIPT_PHOTO);
  await page.waitForTimeout(300);
  await expect(review).toBeHidden();
});

test('native receipt scanning uses Capacitor HTTP instead of WebView fetch', async ({ page }) => {
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.evaluate(() => {
    window.__nativeReceiptRequests = [];
    window.Capacitor.Plugins.Camera = {
      getPhoto: async () => ({
        format: 'png',
        webPath:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
      }),
    };
    window.Capacitor.Plugins.CapacitorHttp = {
      post: async options => {
        window.__nativeReceiptRequests.push(options);
        return {
          status: 200,
          data: {
            suggestions: { title: 'Cafe', amount: 8.5, currency: 'EUR', category: 'food', receiptDate: '2026-10-06' },
          },
        };
      },
    };
  });
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  await page.locator('#expense-action-sheet [data-action="open-receipt-picker"]').click();
  const review = page.locator('#receipt-review-sheet');
  await review.getByRole('button', { name: 'Scan receipt' }).click();
  await expect(review).toContainText('Receipt scanned');
  const request = await page.evaluate(() => window.__nativeReceiptRequests[0]);
  expect(request.url).toBe('https://tripcash.de/api/receipt-scan');
  expect(request.headers.Origin).toBe('capacitor://localhost');
  expect(request.data.image.dataUrl).toMatch(/^data:image\/png;base64,/);
  expect(request.responseType).toBe('text');
  expect(request.readTimeout).toBe(55000);
});

test('receipt scanner shows a useful recovery message when the native request cannot load', async ({ page }) => {
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.route('https://tripcash.de/api/receipt-scan', route => route.abort('failed'));
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  await page.locator('#receipt-photo-input').setInputFiles({
    name: 'offline-receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  const review = page.locator('#receipt-review-sheet');
  await review.getByRole('button', { name: 'Scan receipt' }).click();
  await expect(review).toContainText('Receipt scanning is temporarily unavailable');
  await expect(review.getByRole('button', { name: 'Continue manually' })).toBeEnabled();
});

test('receipt scanner hides a non-JSON native gateway error', async ({ page }) => {
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.evaluate(() => {
    window.__receiptAttempts = 0;
    window.Capacitor.Plugins.CapacitorHttp = {
      post: async () => {
        window.__receiptAttempts += 1;
        return { status: 502, data: 'The upstream service returned an invalid response.' };
      },
    };
  });
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  await page.locator('#receipt-photo-input').setInputFiles({
    name: 'invoice.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  const review = page.locator('#receipt-review-sheet');
  await review.getByRole('button', { name: 'Scan receipt' }).click();
  await expect(review).toContainText('Receipt scanning couldn’t reach the server. Try again, or continue manually.');
  // An unreadable gateway reply is retried exactly once.
  expect(await page.evaluate(() => window.__receiptAttempts)).toBe(2);
  await expect(review).not.toContainText('JSON Parse error');
  await expect(review).not.toContainText('upstream service');
  await expect(review.getByRole('button', { name: 'Continue manually' })).toBeEnabled();
});

test('receipt scanner retries one unreadable gateway reply and then succeeds', async ({ page }) => {
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.evaluate(() => {
    window.__receiptAttempts = 0;
    window.Capacitor.Plugins.CapacitorHttp = {
      post: async () => {
        window.__receiptAttempts += 1;
        return window.__receiptAttempts === 1
          ? { status: 502, data: '<html>Bad gateway</html>' }
          : {
              status: 200,
              data: '{"ok":true,"suggestions":{"title":"Bakery","amount":6.8,"currency":"EUR","category":"food","receiptDate":"2026-10-18"}}',
            };
      },
    };
  });
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  await page.locator('#receipt-photo-input').setInputFiles({
    name: 'bakery.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  const review = page.locator('#receipt-review-sheet');
  await review.getByRole('button', { name: 'Scan receipt' }).click();
  await expect(review).toContainText('Receipt scanned');
  expect(await page.evaluate(() => window.__receiptAttempts)).toBe(2);
});

test('receipt scanner never retries a readable server error', async ({ page }) => {
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.evaluate(() => {
    window.__receiptAttempts = 0;
    window.Capacitor.Plugins.CapacitorHttp = {
      post: async () => {
        window.__receiptAttempts += 1;
        return { status: 502, data: '{"error":"Receipt scanning model is unavailable."}' };
      },
    };
  });
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  await page.locator('#receipt-photo-input').setInputFiles({
    name: 'model.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  const review = page.locator('#receipt-review-sheet');
  await review.getByRole('button', { name: 'Scan receipt' }).click();
  await expect(review).toContainText('Receipt scanning model is unavailable.');
  expect(await page.evaluate(() => window.__receiptAttempts)).toBe(1);
});

test('receipt scanner does not retry a gateway failure that arrived slowly', async ({ page }) => {
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.evaluate(() => {
    window.__receiptAttempts = 0;
    const realNow = Date.now.bind(Date);
    window.Capacitor.Plugins.CapacitorHttp = {
      post: async () => {
        window.__receiptAttempts += 1;
        // Simulate a reply that took 11 seconds.
        const offset = 11000;
        Date.now = () => realNow() + offset;
        return { status: 502, data: '<html>Bad gateway</html>' };
      },
    };
  });
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  await page
    .locator('#receipt-photo-input')
    .setInputFiles({ name: 'slow.png', mimeType: 'image/png', buffer: RECEIPT_PNG });
  const review = page.locator('#receipt-review-sheet');
  await review.getByRole('button', { name: 'Scan receipt' }).click();
  await expect(review).toContainText('Receipt scanning couldn’t reach the server.');
  expect(await page.evaluate(() => window.__receiptAttempts)).toBe(1);
});

test('receipt scanner reports a success reply without suggestions as incomplete', async ({ page }) => {
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.evaluate(() => {
    window.__receiptAttempts = 0;
    window.Capacitor.Plugins.CapacitorHttp = {
      post: async () => {
        window.__receiptAttempts += 1;
        return { status: 200, data: '{"ok":true}' };
      },
    };
  });
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  await page
    .locator('#receipt-photo-input')
    .setInputFiles({ name: 'empty.png', mimeType: 'image/png', buffer: RECEIPT_PNG });
  const review = page.locator('#receipt-review-sheet');
  await review.getByRole('button', { name: 'Scan receipt' }).click();
  await expect(review).toContainText('Receipt scanning could not be completed. Try again, or continue manually.');
  await expect(review).not.toContainText('reach the server');
  expect(await page.evaluate(() => window.__receiptAttempts)).toBe(1);
});

test('large receipt photos are reduced to at most 1600 pixels before upload', async ({ page }) => {
  await setupBackend(page, { nativePlatform: 'ios' });
  await page.evaluate(() => {
    window.__receiptRequests = [];
    window.Capacitor.Plugins.CapacitorHttp = {
      post: async options => {
        window.__receiptRequests.push(options);
        return {
          status: 200,
          data: {
            suggestions: { title: 'Shop', amount: 5, currency: 'EUR', category: 'food', receiptDate: '2026-10-18' },
          },
        };
      },
    };
  });
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  // A 3000 x 1200 photo, built in the page so no fixture file is needed.
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 3000;
    canvas.height = 1200;
    const context = canvas.getContext('2d');
    context.fillStyle = '#f4f4f4';
    context.fillRect(0, 0, 3000, 1200);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.95));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'large.jpg', { type: 'image/jpeg' }));
    const input = document.getElementById('receipt-photo-input');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const review = page.locator('#receipt-review-sheet');
  await review.getByRole('button', { name: 'Scan receipt' }).click();
  await expect(review).toContainText('Receipt scanned');
  const size = await page.evaluate(
    () =>
      new Promise(resolve => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.src = window.__receiptRequests[0].data.image.dataUrl;
      }),
  );
  expect(size).toEqual({ width: 1600, height: 640 });
});

test('unclear and unsupported receipt photos fall back safely to manual entry', async ({ page }) => {
  await setupBackend(page, { nativePlatform: 'ios' });
  let scanRequests = 0;
  await page.route('https://tripcash.de/api/receipt-scan', route => {
    scanRequests += 1;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        suggestions: { title: null, amount: null, currency: null, category: null, receiptDate: null },
      }),
    });
  });
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  const receiptInput = page.locator('#receipt-photo-input');
  const review = page.locator('#receipt-review-sheet');
  await receiptInput.setInputFiles({
    name: 'unclear-receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await review.getByRole('button', { name: 'Scan receipt' }).click();
  await expect(review).toContainText('Receipt scanned');
  await review.getByRole('button', { name: 'Review suggested details' }).click();
  await expect(page.locator('#expense-receipt-draft-notice')).toContainText('Add the expense details manually');
  await expect(page.locator('#exp-title')).toHaveValue('');
  await expect(page.locator('#exp-amount')).toHaveValue('');
  await page.locator('#web-expense-host [data-action="close-expense-screen"]').click();

  await page.locator('.web-expense-fab').click();
  await receiptInput.setInputFiles({
    name: 'unsupported.heic',
    mimeType: 'image/heic',
    buffer: Buffer.from('not-an-image'),
  });
  await review.getByRole('button', { name: 'Scan receipt' }).click();
  await expect(review).toContainText('Choose a JPG, PNG, or WebP photo to scan');
  expect(scanRequests).toBe(1);
  await expect(review.getByRole('button', { name: 'Continue manually' })).toBeEnabled();
});

test('receipt suggestions preserve payer and exact splits and cannot bypass settled or duplicate checks', async ({
  page,
}) => {
  const backend = await setupBackend(page, { nativePlatform: 'ios' });
  seedWorkspaceExpenses(backend);
  const secondMember = '00000000-0000-4000-8000-000000000099';
  backend.rows.members.push({ id: secondMember, trip_id: tripId, user_id: null, name: 'Alex' });
  await page.evaluate(id => openTrip(id), tripId);
  await page.evaluate(() =>
    window.openAddExpenseModal({
      receiptDraft: {
        source: 'receipt',
        photo: { name: 'duplicate-dinner.jpg' },
        suggestions: { title: 'Dinner receipt', amount: 40, currency: 'EUR', category: 'food' },
      },
    }),
  );
  await expect(page.locator('#exp-paid-by')).toHaveValue(memberId);
  await expect(page.locator('#web-expense-split')).toHaveValue('equal');
  await page.locator('#web-expense-split').selectOption('exact');
  await expect(page.locator(`#split-${memberId}`)).toHaveValue('');
  await expect(page.locator(`#split-${memberId}`)).toHaveAttribute('placeholder', '0');
  await page.locator(`#split-${memberId}`).fill('20');
  await page.locator(`#split-${secondMember}`).fill('20');
  await expect(page.locator('#split-remainder')).toContainText('Totals match');

  await page.evaluate(() => {
    currentSettled = [1];
  });
  await page.locator('#btn-add-expense').click();
  await expect(page.locator('#exp-day-error')).toContainText('Pick an open day');
  expect(backend.writes.some(write => write.function === 'create_expense_with_splits')).toBe(false);

  await page.evaluate(() => {
    currentSettled = [];
  });
  await page.locator('#btn-add-expense').click();
  await expect(page.locator('#confirm-title')).toHaveText('Possible duplicate');
  await page.locator('#modal-confirm [data-action="resolve-confirm"][data-value="false"]').first().click();
  expect(backend.writes.some(write => write.function === 'create_expense_with_splits')).toBe(false);
  await expect(page.locator('#web-expense-split')).toHaveValue('exact');
});

test('closing a receipt review before its image is read never starts a scan request', async ({ page }) => {
  await page.addInitScript(() => {
    const BrowserFileReader = window.FileReader;
    window.FileReader = class DelayedFileReader extends BrowserFileReader {
      readAsDataURL(file) {
        setTimeout(() => super.readAsDataURL(file), 150);
      }
    };
  });
  await setupBackend(page, { nativePlatform: 'ios' });
  let scanRequests = 0;
  await page.route('https://tripcash.de/api/receipt-scan', route => {
    scanRequests += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ suggestions: {} }) });
  });
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('.web-expense-fab').click();
  await page.locator('#receipt-photo-input').setInputFiles({
    name: 'cancelled-receipt.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL8WQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  const review = page.locator('#receipt-review-sheet');
  await expect(review).toBeVisible();
  await review.getByRole('button', { name: 'Scan receipt' }).click();
  await review.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(review).toBeHidden();
  await page.waitForTimeout(250);
  expect(scanRequests).toBe(0);
});

test('web workspace refreshes preserved trip totals after filtering and optimistic expense deletion', async ({
  page,
}) => {
  const backend = await setupBackend(page);
  seedWorkspaceExpenses(backend);
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('#web-workspace-expenses-list [data-action="set-expense-filter"][data-value="food"]').click();
  await expect(page.locator('#web-workspace-expenses-list .expense-card')).toHaveCount(1);
  await expect(page.locator('[data-web-total]')).toHaveText('EUR 100.00');
  await setConnectivity(page, backend, false);
  await page.locator('#web-workspace-expenses-list [data-action="delete-expense"]').click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('[data-web-total]')).toHaveText('EUR 60.00');
  await expect(page.locator('.web-spend-card')).toContainText('1 expense');
  await expect(page.locator('#web-workspace-expenses-list')).toContainText('No expenses match this filter.');
  await page.locator('#web-workspace-expenses-list [data-action="set-expense-filter"][data-value="all"]').click();
  await expect(page.locator('#web-workspace-expenses-list')).toContainText('Guesthouse');
  await expect(page.locator('[data-web-total]')).toHaveText('EUR 60.00');
  await expect(page.locator('#display-currency')).toHaveCount(1);
});

test('web workspace refreshes summary days and keeps settled expense locks after an offline settlement', async ({
  page,
}) => {
  const backend = await setupBackend(page);
  seedWorkspaceExpenses(backend);
  await page.evaluate(id => openTrip(id), tripId);
  await setConnectivity(page, backend, false);
  await page.locator('#web-settle-note').fill('Paid cash at the airport');
  await page.locator('[data-web-settle="1"]').click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        readOfflineQueue(window._currentUser.id).some(mutation =>
          mutation.steps?.some(
            step => step.table === 'settlements' && step.values?.note === 'Paid cash at the airport',
          ),
        ),
      ),
    )
    .toBe(true);
  expect(backend.rows.settlements).toHaveLength(0); // still queued while offline
  await expect(page.locator('#dash-day-badge')).toHaveText('Day 2');
  await expect(page.locator('[data-web-total]')).toHaveText('EUR 100.00');
  await expect(page.locator('#web-workspace-expenses-list .day-section')).toHaveClass(/settled/);
  await expect(page.locator('#web-workspace-expenses-list .day-section [data-action="delete-expense"]')).toHaveCount(0);
  // Desktop keeps settled days readable in the sticky, chronological feed.
  await expect(page.locator('#web-workspace-expenses-list .day-body')).toBeVisible();
  await expect(page.locator('#web-workspace-expenses-list .expense-status')).toHaveText(['Settled', 'Settled']);
});

test('web workspace keeps display currency and refreshes its summary after saving an offline expense', async ({
  page,
}) => {
  const backend = await setupBackend(page);
  seedWorkspaceExpenses(backend);
  await page.evaluate(id => openTrip(id), tripId);
  await page.evaluate(() => {
    displayCurrencyRates['EUR-GBP'] = 0.5;
  });
  await page.locator('#display-currency').selectOption('GBP');
  await expect(page.locator('[data-web-total]')).toHaveText('GBP 50.00');
  await setConnectivity(page, backend, false);
  await openExpenseFromFab(page);
  await page.locator('#exp-title').fill('Airport taxi');
  await page.locator('#exp-amount').fill('30');
  await expect(page.locator('#btn-add-expense')).toBeEnabled();
  await page.locator('#btn-add-expense').click();
  await expect(page.locator('#tab-expenses')).toHaveClass(/active/);
  await expect(page.locator('[data-web-total]')).toHaveText('GBP 65.00');
  await expect(page.locator('.web-spend-card')).toContainText('3 expenses');
  await expect(page.locator('#web-workspace-expenses-list')).toContainText('Airport taxi');
  await expect(page.locator('#web-workspace-expenses-list .web-expense-pending')).toContainText('Waiting to sync');
  await expect(page.locator('#web-expense-feedback')).toContainText('Waiting to sync');
  await expect(page.locator('#display-currency')).toHaveValue('GBP');
  await expect(page.locator('#display-currency')).toHaveCount(1);
});

test('web expense quick-add validates exact shares and preserves the existing save path', async ({ page }) => {
  const backend = await setupBackend(page);
  const secondMember = '00000000-0000-4000-8000-000000000025';
  backend.rows.members.push({ id: secondMember, trip_id: tripId, user_id: null, name: 'Alex' });
  await page.evaluate(id => openTrip(id), tripId);
  await openExpenseFromFab(page);
  await expect(page.locator('#btn-add-expense')).toBeEnabled();
  await page.locator('#exp-amount').focus();
  await page.locator('#exp-title').focus();
  await expect(page.locator('#exp-amount-error')).toBeHidden();
  await page.locator('#btn-add-expense').click();
  await expect(page.locator('#exp-amount-error')).toContainText('greater than 0');
  await page.locator('#exp-title').fill('Museum tickets');
  await page.locator('#exp-amount').fill('30');
  await expect(page.locator('#exp-amount-error')).toBeHidden();
  await expect(page.locator('#exp-category')).toHaveValue('activities');
  await page.locator('#web-expense-split').selectOption('exact');
  await expect(page.locator('#web-expense-details')).toBeVisible();
  await expect(page.locator('#btn-add-expense')).toBeEnabled();
  await expect(page.locator('#split-error')).toContainText('must add up');
  await expect(page.locator('#split-remainder')).toContainText('Allocated');
  await page.locator(`#split-${memberId}`).fill('20');
  await page.locator(`#split-${secondMember}`).fill('10');
  await expect(page.locator('#btn-add-expense')).toBeEnabled();
  await page.locator('#btn-add-expense').click();
  await expect(page.locator('#web-expense-feedback')).toContainText('Saved Museum tickets');
  await expect(page.locator('#web-workspace-expenses-list')).toContainText('Museum tickets');
  expect(backend.writes.some(write => write.function === 'create_expense_with_splits')).toBe(true);
  const saved = backend.rows.expenses.find(expense => expense.title === 'Museum tickets');
  expect(saved.split_type).toBe('exact');
  expect(
    backend.rows.expense_splits.filter(split => split.expense_id === saved.id).map(split => split.share_amount),
  ).toEqual([20, 10]);
});

test('web expense quick-add retains duplicate confirmation and clears a failed save', async ({ page }) => {
  const backend = await setupBackend(page);
  seedWorkspaceExpenses(backend);
  await page.evaluate(id => openTrip(id), tripId);
  await openExpenseFromFab(page);
  await page.locator('#exp-title').fill('Another dinner');
  await page.locator('#exp-amount').fill('40');
  await page.locator('#btn-add-expense').click();
  await expect(page.locator('#modal-confirm')).toHaveClass(/open/);
  await expect(page.locator('#confirm-title')).toHaveText('Possible duplicate');
  await page.locator('#modal-confirm [data-action="resolve-confirm"][data-value="false"]').first().click();
  await expect(page.locator('#web-workspace-expenses-list .expense-card')).toHaveCount(2);
  await page.locator('#exp-amount').fill('41');
  backend.rejectWrites = true;
  await page.locator('#btn-add-expense').click();
  await expect(page.locator('#web-expense-feedback')).toContainText('Unable to save');
  await expect(page.locator('#web-workspace-expenses-list .expense-card')).toHaveCount(2);
});

test('web expense quick-add shows loading until the existing save completes', async ({ page }) => {
  const backend = await setupBackend(page, { holdExpenseSave: true });
  await page.evaluate(id => openTrip(id), tripId);
  await openExpenseFromFab(page);
  await page.locator('#exp-title').fill('Ferry');
  await page.locator('#exp-amount').fill('18');
  await page.locator('#btn-add-expense').click();
  await expect(page.locator('#btn-add-expense')).toHaveClass(/loading/);
  await expect(page.locator('#btn-add-expense')).toBeDisabled();
  backend.releaseExpenseSave();
  await expect(page.locator('#web-expense-feedback')).toContainText('Saved Ferry');
  await expect(page.locator('#btn-add-expense')).toBeEnabled(); // Empty form validates only when submitted.
});

test('mobile web expense sheet opens, traps Escape, and keeps an offline expense pending', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const backend = await setupBackend(page);
  await page.evaluate(id => openTrip(id), tripId);
  await expect(page.locator('#web-expense-host')).toBeHidden();
  await page.locator('#trip-bottom-nav [data-value="expenses"]').click();
  await openExpenseFromFab(page);
  await expect(page.locator('#web-expense-host')).toHaveAttribute('role', 'dialog');
  expect(await page.locator('#web-expense-host').evaluate(el => el.parentElement === document.body)).toBe(true);
  await expect(page.locator('#app-bottom-nav')).toBeHidden();
  await expect(page.locator('#btn-add-expense')).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 568 });
  expect(
    await page.locator('#web-expense-host .expense-page').evaluate(el => el.getBoundingClientRect().height),
  ).toBeLessThan(460);
  await expect(page.locator('#btn-add-expense')).toBeInViewport();
  const backgroundScroll = await page.evaluate(() => [
    document.scrollingElement.scrollTop,
    document.querySelector('.web-workspace-main').scrollTop,
  ]);
  await expect(page.locator('#exp-title')).not.toBeFocused();
  await page.locator('#web-expense-host .web-expense-more').click();
  await expect(page.locator('#exp-day')).toBeVisible();
  await expect(page.locator('#web-expense-split')).toBeVisible();
  await page.locator('#form-add-expense').hover();
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.locator('#form-add-expense').evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => [
      document.scrollingElement.scrollTop,
      document.querySelector('.web-workspace-main').scrollTop,
    ]),
  ).toEqual(backgroundScroll);
  await page.keyboard.press('Escape');
  await expect(page.locator('#web-expense-host')).toBeHidden();
  await openExpenseFromFab(page);
  await page.locator('#exp-title').fill('Bus fare');
  await page.locator('#exp-amount').fill('12');
  await setConnectivity(page, backend, false);
  await page.locator('#btn-add-expense').click();
  await expect(page.locator('#web-expense-host')).toBeHidden();
  await expect(page.locator('#web-workspace-expenses-list .web-expense-pending')).toContainText('Waiting to sync');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('phone expenses use compact day accordions and a half-height quick form', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  const backend = await setupBackend(page);
  backend.rows.trips[0].current_day = 2;
  seedWorkspaceExpenses(backend);
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('#trip-bottom-nav [data-value="expenses"]').click();
  await expect(page.locator('#web-trip-currency')).toBeVisible();
  await expect(page.locator('#web-trip-overflow')).toBeVisible();
  await expect(page.locator('[data-web-expand-day="2"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-web-expand-day="1"]')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('[data-web-expand-day="1"]').click();
  await expect(page.locator('[data-web-expand-day="1"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-web-expand-day="2"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#web-phone-day-1 .expense-card')).toHaveCount(2);
  const fonts = await page.evaluate(() => ({
    title: parseFloat(getComputedStyle(document.querySelector('#web-phone-day-1 .exp-title')).fontSize),
    meta: parseFloat(getComputedStyle(document.querySelector('#web-phone-day-1 .exp-meta')).fontSize),
  }));
  expect(fonts.title).toBeGreaterThanOrEqual(13);
  expect(fonts.title).toBeLessThanOrEqual(14);
  expect(fonts.meta).toBeGreaterThanOrEqual(11);
  await expect(page.locator('[data-web-settle="1"]')).toBeVisible();
  await expect(page.locator('[data-web-settle="2"]')).toHaveCount(0);
  await expect(page.locator('[data-web-skip="2"]')).toHaveText('Skip Day 2');
  await expect(page.locator('#web-phone-day-2 .web-phone-day-empty')).toContainText('No expenses on this day.');
  expect(
    await page.locator('.expense-filter-row').evaluate(el => parseFloat(getComputedStyle(el).paddingRight)),
  ).toBeGreaterThanOrEqual(16);
  expect(
    await page.locator('#web-workspace-expenses-list').evaluate(el => parseFloat(getComputedStyle(el).paddingBottom)),
  ).toBeGreaterThanOrEqual(100);
  await openExpenseFromFab(page);
  await expect(page.locator('#trip-bottom-nav')).toBeHidden();
  await expect(page.locator('#exp-day')).toHaveValue('1');
  await expect(page.locator('#exp-day')).toBeHidden();
  await expect(page.locator('#web-expense-host .web-expense-brief')).toHaveText('Day 1 · Equal split');
  expect(
    await page.locator('#web-expense-host .expense-page').evaluate(el => el.getBoundingClientRect().height),
  ).toBeLessThan(530);
  await page.locator('#web-expense-host .web-expense-more').click();
  await expect(page.locator('#exp-day')).toBeVisible();
  await expect(page.locator('#web-expense-split')).toBeVisible();
  await page.locator('#exp-day').selectOption('2');
  await expect(page.locator('#web-expense-host .web-expense-brief')).toHaveText('Day 2 · Equal split');
  await page.locator('#web-expense-host [data-action="close-expense-screen"]').click();
  await expect(page.locator('#trip-bottom-nav')).toBeVisible();
  await page.locator('[data-web-expand-day="1"]').click();
  await openExpenseFromFab(page);
  await expect(page.locator('#exp-day')).toHaveValue('2');
});

test('web expense entry fits light and dark desktop, tablet, and mobile-browser widths', async ({ page }) => {
  await setupBackend(page);
  await page.evaluate(id => openTrip(id), tripId);
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => {
      document.body.classList.toggle('light', theme === 'light');
      document.body.classList.toggle('dark', theme === 'dark');
    }, theme);
    for (const width of [1280, 834, 761, 760, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await openExpenseFromFab(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.keyboard.press('Escape');
    }
  }
});

test('web workspace invite disclosure preserves copy, expiry, and confirmed link replacement', async ({ page }) => {
  const backend = await setupBackend(page);
  await page.evaluate(id => openTrip(id), tripId);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async value => {
          window.workspaceCopiedInvite = value;
        },
      },
    });
  });
  await page.locator('#web-trip-overflow summary').click();
  await page.locator('#web-trip-overflow [data-action="copy-invite"]').click();
  await expect
    .poll(() => page.evaluate(() => window.workspaceCopiedInvite))
    .toContain('00000000-0000-4000-8000-000000000010');
  if ((await page.locator('#web-trip-overflow').getAttribute('open')) === null) {
    await page.locator('#web-trip-overflow summary').click();
  }
  await page.locator('#web-trip-overflow [data-action="rotate-invite"]').click();
  await expect(page.locator('#confirm-title')).toHaveText('Replace invite link?');
  await page.locator('#confirm-ok').click();
  await expect.poll(() => backend.inviteRotations || 0).toBe(1);
  await page.locator('#web-trip-overflow summary').click();
  await expect(page.locator('#web-trip-overflow [data-action="export-csv"]')).toBeVisible();
  await expect(page.locator('#tab-expenses')).toHaveClass(/active/);
});

test('web workspace offline creation keeps an unavailable invite disabled instead of inventing a link', async ({
  page,
}) => {
  const backend = await setupBackend(page);
  await setConnectivity(page, backend, false);
  await createOfflineTrip(page, 'Offline workspace');
  await page.locator('#web-trip-overflow summary').click();
  await expect(page.locator('#web-trip-overflow [data-action="copy-invite"]')).toHaveCount(0);
  await expect(page.locator('.web-expense-fab')).toBeVisible();
});

test('web workspace respects creator, member, and ended-trip actions', async ({ page }) => {
  const backend = await setupBackend(page);
  await page.evaluate(id => openTrip(id), tripId);
  await openWorkspaceTripSettings(page);
  for (const action of ['open-edit-trip-modal', 'open-end-trip-modal', 'delete-trip']) {
    await expect(page.locator(`#web-trip-overflow [data-action="${action}"]`)).toBeVisible();
  }
  await page.locator('#web-trip-overflow summary').click();
  backend.rows.trips[0].creator_id = '00000000-0000-4000-8000-000000000099';
  backend.rows.trip_members[0].role = 'member';
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('#web-trip-overflow summary').click();
  await expect(page.locator('#web-trip-overflow [data-action="open-edit-trip-modal"]')).toHaveCount(0);
  await expect(page.locator('#web-trip-overflow [data-action="copy-invite"]')).toHaveCount(0);
  await expect(page.locator('#web-trip-overflow [data-action="export-csv"]')).toBeVisible();
  backend.rows.trips[0].creator_id = user.id;
  backend.rows.trips[0].status = 'ended';
  backend.rows.trip_members[0].role = 'creator';
  await page.evaluate(id => openTrip(id), tripId);
  await expect(page.locator('#screen-dashboard [data-action="open-add-expense-modal"]')).toHaveCount(0);
  await expect(page.locator('#web-expense-host')).toBeHidden();
  await openWorkspaceTripSettings(page);
  await expect(page.locator('#web-trip-overflow [data-action="open-edit-trip-modal"]')).toHaveCount(0);
  await expect(page.locator('#web-trip-overflow [data-action="open-end-trip-modal"]')).toHaveCount(0);
  await expect(page.locator('#web-trip-overflow [data-action="delete-trip"]')).toBeVisible();
  await expect(page.locator('#web-trip-overflow [data-action="export-csv"]')).toHaveCount(1);
  backend.rows.trips[0].creator_id = '00000000-0000-4000-8000-000000000099';
  backend.rows.trip_members[0].role = 'member';
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('#web-trip-overflow summary').click();
  await expect(page.locator('#web-trip-overflow [data-action="export-csv"]')).toBeVisible();
});

test('web workspace exposes Analytics and Activity from the overflow and stays responsive', async ({ page }) => {
  await setupBackend(page);
  await page.evaluate(id => openTrip(id), tripId);
  for (const tab of ['analytics', 'activity']) {
    await page.locator('#web-trip-overflow summary').click();
    await page.locator(`#web-trip-overflow [data-value="${tab}"]`).click();
    await expect(page.locator(`#tab-${tab}`)).toHaveClass(/active/);
  }
  await page.locator('#trip-bottom-nav [data-value="expenses"]').click();
  await expect(page.locator('#tab-expenses')).toHaveClass(/active/);
  for (const width of [1440, 834, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(page.locator('#trip-bottom-nav')).toBeVisible();
    await expect(page.locator('#web-trip-overflow summary')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width === 390)
      expect(await page.locator('.dash-header').evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(360);
  }
  await page.evaluate(() => applyTheme('dark'));
  await expect(page.locator('body')).not.toHaveClass(/light/);
  await openExpenseFromFab(page);
  await expect(page.locator('#web-expense-host')).toBeVisible();
  await page.locator('#web-expense-host [data-action="close-expense-screen"]').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await returnToTrips(page);
  await expect(page.locator('#web-trip-overflow')).toHaveCount(1);
});

test('web workspace groups the full expense feed under read-only sticky day sections', async ({ page }) => {
  const backend = await setupBackend(page);
  seedWorkspaceExpenses(backend);
  backend.rows.trips[0].current_day = 3;
  backend.rows.trips[0].start_date = '2026-09-20';
  backend.rows.settlements.push({ trip_id: tripId, day_number: 1 });
  backend.rows.expenses.push({
    ...backend.rows.expenses[0],
    id: 'workspace-day-two',
    title: 'Train fare',
    day_number: 2,
    amount: 20,
    original_amount: 20,
    split_type: 'exact',
  });
  backend.rows.expense_splits.push({
    id: 'workspace-day-two-split',
    expense_id: 'workspace-day-two',
    member_id: memberId,
    share_amount: 20,
  });
  await page.evaluate(id => openTrip(id), tripId);
  await expect(page.locator('#web-workspace-expenses-list .expense-card:visible')).toHaveCount(3);
  await expect(page.locator('#web-expense-host')).toBeHidden();
  await expect(page.locator('#web-workspace-expenses-list .day-hdr')).toHaveCount(2);
  await expect(page.locator('#web-workspace-expenses-list .day-label').first()).toHaveText('Day 1 · Sep 20');
  await expect(page.locator('#web-workspace-expenses-list .expense-category-icon')).toHaveCount(3);
  await expect(
    page.locator('#web-workspace-expenses-list .day-section.settled [data-action="delete-expense"]'),
  ).toHaveCount(0);
  await expect(page.locator('#web-workspace-expenses-list')).toContainText('Train fare');
  await expect(
    page.locator('#web-workspace-expenses-list .expense-card .exp-meta').filter({ hasText: 'exact split' }),
  ).toHaveCount(1);
  await expect(page.locator('.web-expense-fab')).toBeVisible();
});

test('web workspace trip-wide balances and suggested payment use existing split calculation', async ({ page }) => {
  const backend = await setupBackend(page);
  seedWorkspaceExpenses(backend);
  const otherId = '00000000-0000-4000-8000-000000000024';
  backend.rows.members[0].paypal_link = 'https://paypal.me/testtraveller';
  backend.rows.members.push({ id: otherId, trip_id: tripId, name: 'Maya' });
  backend.rows.expense_splits.forEach(split => {
    split.share_amount /= 2;
  });
  backend.rows.expense_splits.push(
    ...backend.rows.expenses.map((expense, index) => ({
      id: `workspace-maya-${index}`,
      expense_id: expense.id,
      member_id: otherId,
      share_amount: expense.amount / 2,
    })),
  );
  await page.evaluate(id => openTrip(id), tripId);
  await expect(page.locator('[data-web-balance]')).toHaveText('+EUR 50.00');
  await expect(page.locator('.web-balances-card')).toContainText('Maya');
  await expect(page.locator('.web-balances-card')).toContainText('EUR 50.00');
  await expect(page.locator('.web-suggestion')).toContainText('Maya → Test Traveller');
  await expect(page.locator('.web-suggestion a')).toHaveAttribute('href', 'https://paypal.me/testtraveller');
  await expect(page.locator('.web-suggestion a')).toHaveText('Open PayPal');
  await page.evaluate(() => switchTab('members'));
  const linkedMember = page.locator(`.member-balance-item[data-member-id="${memberId}"]`);
  const unlinkedMember = page.locator(`.member-balance-item[data-member-id="${otherId}"]`);
  await expect(linkedMember.locator('a.paypal-link')).toHaveText('Open PayPal');
  await expect(
    unlinkedMember.locator('.member-row-actions a.paypal-link, .member-row-actions [data-action="edit-paypal-link"]'),
  ).toHaveCount(0);
  await expect(page.locator('.member-balance-pill')).toHaveCount(2);
  await page.evaluate(() => applyTheme('dark'));
  const darkBalanceColors = await linkedMember.evaluate(row => ({
    name: getComputedStyle(row.querySelector('.member-balance-copy strong')).color,
    owed: getComputedStyle(row.querySelector('.member-balance-pill')).color,
  }));
  expect(darkBalanceColors.name).toBe('rgb(247, 250, 249)');
  expect(darkBalanceColors.owed).toBe('rgb(79, 209, 203)');
  await page.evaluate(() => switchTab('expenses'));
  await expect(page.locator('#web-workspace-expenses-list .expense-status')).toHaveText([
    'Owed to you EUR 30.00',
    'Owed to you EUR 20.00',
  ]);
  await page.locator('.web-balance-card [data-web-payment]').click();
  await expect(page.locator('#modal-payment')).toHaveClass(/open/);
  await expect(page.locator('#payment-amount')).toHaveValue('50.00');
  await page.locator('#modal-payment [data-action="close-modal"]').first().click();
  await page.evaluate(
    ({ from, to }) => {
      currentPayments.push({
        id: 'workspace-recorded-payment',
        trip_id: currentTrip.id,
        from_member: from,
        to_member: to,
        amount: 50,
        day_number: 1,
      });
      syncCurrentTripCache();
    },
    { from: otherId, to: memberId },
  );
  await expect(page.locator('[data-web-balance]')).toHaveText('EUR 0.00');
  await expect(page.locator('.web-balances-card')).toContainText('Everyone is square');
  await expect(page.locator('[data-web-payment]')).toHaveCount(0);
});

test('mobile web settles through the existing note modal and has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const backend = await setupBackend(page);
  seedWorkspaceExpenses(backend);
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('#trip-bottom-nav [data-value="expenses"]').click();
  await expect(page.locator('.web-balances-card')).toBeHidden();
  await page.locator('[data-web-settle="1"]').click();
  await expect(page.locator('#modal-settle-day')).toHaveClass(/open/);
  await page.locator('#settle-note').fill('Paid cash');
  await page.locator('#btn-settle-day').click();
  await expect(page.locator('[data-web-expand-day="2"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-web-settle="1"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('phone web trip header keeps the title clear of the currency and menu controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupBackend(page);
  await page.evaluate(id => openTrip(id), tripId);
  await expect(page.locator('.web-trip-title-row h1')).toBeVisible();
  const layout = await page.evaluate(() => {
    const title = document.querySelector('.web-trip-title-row h1').getBoundingClientRect();
    const right = document.querySelector('.web-trip-header-right').getBoundingClientRect();
    const back = document.querySelector('.web-trip-breadcrumb').getBoundingClientRect();
    return {
      titleLeft: title.left,
      titleRight: title.right,
      rightLeft: right.left,
      backRight: back.right,
      titleWidth: title.width,
    };
  });
  expect(layout.titleRight).toBeLessThanOrEqual(layout.rightLeft);
  expect(layout.titleLeft).toBeGreaterThanOrEqual(layout.backRight);
  expect(layout.titleWidth).toBeGreaterThan(80);
  await expect(page.locator('#web-trip-currency select')).toHaveCSS('font-size', '16px');
});

test('tablet Skip Day note field uses the standard padded input style', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await setupBackend(page);
  await page.evaluate(id => openTrip(id), tripId);
  const note = page.locator('#web-settle-note');
  await expect(note).toBeVisible();
  await expect(note).toHaveCSS('padding-left', '12px');
  await expect(note).toHaveCSS('font-size', '16px');
  expect(
    await note.evaluate(input => {
      const field = input.getBoundingClientRect();
      const card = input.closest('.web-settle-card').getBoundingClientRect();
      return field.left >= card.left && field.right <= card.right && field.height >= 44;
    }),
  ).toBe(true);
});

test('a cached profile older than seven days is discarded, and a fresh one keeps no timestamp', async ({ page }) => {
  await setupBackend(page);
  const result = await page.evaluate(() => {
    const user = { id: 'cache-user', email: 'cache@example.test', user_metadata: {} };
    const key = 'tc-profile-cache-cache-user';
    const profile = {
      id: user.id,
      display_name: 'Old Name',
      paypal_link: 'https://paypal.me/old',
      home_currency: 'EUR',
      default_split: 'equal',
      theme_preference: 'system',
    };
    localStorage.setItem(key, JSON.stringify({ ...profile, savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }));
    restoreCachedProfile(user);
    const expired = { removed: localStorage.getItem(key) === null, name: window._currentProfile.display_name };
    localStorage.setItem(key, JSON.stringify({ ...profile, savedAt: Date.now() - 60 * 1000 }));
    restoreCachedProfile(user);
    const fresh = {
      kept: localStorage.getItem(key) !== null,
      name: window._currentProfile.display_name,
      leaked: 'savedAt' in window._currentProfile,
    };
    cacheProfile(user, { display_name: 'New Name' });
    const written = Number.isFinite(JSON.parse(localStorage.getItem(key)).savedAt);
    return { expired, fresh, written };
  });
  expect(result).toEqual({
    expired: { removed: true, name: 'cache' },
    fresh: { kept: true, name: 'Old Name', leaked: false },
    written: true,
  });
});

test('mobile web does not offer Skip Day when a filter hides current-day expenses', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const backend = await setupBackend(page);
  seedWorkspaceExpenses(backend);
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('#trip-bottom-nav [data-value="expenses"]').click();
  await page.getByRole('button', { name: 'Transport', exact: true }).click();
  await expect(page.locator('[data-web-skip="1"]')).toHaveCount(0);
  await expect(page.locator('[data-web-settle="1"]')).toBeVisible();
});

test('mobile web can skip the current empty day', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const backend = await setupBackend(page);
  backend.rows.trips[0].current_day = 2;
  seedWorkspaceExpenses(backend);
  await page.evaluate(id => openTrip(id), tripId);
  await page.locator('#trip-bottom-nav [data-value="expenses"]').click();
  await page.locator('[data-web-skip="2"]').click();
  await expect(page.locator('#settle-day-label')).toHaveText('Skip Day 2');
  await expect(page.locator('#settle-day-description')).toContainText('open Day 3');
  await expect(page.locator('#btn-settle-day')).toHaveText('Skip day');
  await page.locator('#btn-settle-day').click();
  await expect(page.locator('[data-web-expand-day="3"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-web-skip="2"]')).toHaveCount(0);
});

test('trip cards appear before slow expense and member totals finish', async ({ page }) => {
  const backend = await setupBackend(page, { holdTotals: true });
  try {
    await expect.poll(() => backend.totalsRequested).toBe(2);
    await expect(page.locator('.trip-card')).toContainText('Saved trip');
    await expect(page.locator('.web-trip-metrics')).toContainText('Updating…');
    await expect(page.locator('.web-trip-metrics')).toContainText('Open to see balance');
    await expect(page.getByRole('button', { name: '+ New trip', exact: true })).toBeEnabled();
  } finally {
    backend.releaseTotals();
  }
});

test('web dashboard separates active and ended trips and handles budgets honestly', async ({ page }) => {
  const backend = await setupBackend(page);
  Object.assign(backend.rows.trips[0], { budget: 20, name: 'A <safe> trip' });
  backend.rows.expenses.push({ id: 'expense-total', trip_id: tripId, amount: 30, paid_by: memberId });
  backend.rows.trips.push({ ...backend.rows.trips[0], id: 'ended-trip', name: 'Ended trip', status: 'ended' });
  await page.evaluate(() => loadTrips());
  await expect(page.locator('.web-trip-card h3')).toHaveText('A <safe> trip');
  await expect(page.locator('.web-trip-card')).toContainText('EUR 10.00 over budget');
  await expect(page.locator('.web-trip-card')).toContainText('Open to see balance');
  await expect(page.locator('[data-trip-filter="active"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.web-ended-row')).toHaveCount(0);
  await page.locator('[data-trip-filter="ended"]').click();
  await expect(page.locator('.web-ended-row')).toContainText('Ended trip');
  await expect(page.locator('.web-trip-card .native-trip-emoji')).toBeHidden();
  await expect(page.locator('.web-ended-row > .native-closed-stamp')).toBeHidden();
  await expect(page.locator('#screen-trips .stats-row')).toBeHidden();
  await expect(page.locator('.web-suggested')).toHaveCount(0);
  backend.rows.trips[0].name = 'Total';
  await page.evaluate(() => loadTrips());
  await page.locator('[data-trip-filter="active"]').click();
  await expect(page.locator('.web-trip-card h3')).toHaveText('Total');
  backend.rows.trips[0].name = 'DE';
  await page.evaluate(() => loadTrips());
  await expect(page.locator('.web-trip-card h3')).toHaveText('DE');
  Object.assign(backend.rows.trips[0], { budget: null, start_date: '2099-01-01' });
  await page.evaluate(() => loadTrips());
  await page.locator('[data-trip-filter="upcoming"]').click();
  await expect(page.locator('.web-trip-card')).toContainText('No budget');
  await expect(page.locator('.web-trip-tag').first()).toContainText('In ');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#web-new-trip')).toBeVisible();
});

test('web dashboard has distinct first-loading and genuinely empty states', async ({ page }) => {
  const backend = await setupBackend(page, { holdTrips: true, waitForTrips: false });
  try {
    await expect(page.locator('.web-skeleton-card')).toHaveCount(2);
    await expect(page.locator('#trips-list')).toContainText('Loading your trips…');
    backend.rows.trips = [];
  } finally {
    backend.releaseTrips();
  }
  await expect(page.locator('.web-empty-state')).toContainText('Where are you headed?');
  await page.getByRole('button', { name: 'Create a trip', exact: true }).click();
  await expect(page.locator('#modal-new-trip')).toHaveClass(/open/);
});

test('web dashboard keeps skeletons while existing synchronization is stalled', async ({ page }) => {
  await setupBackend(page);
  await expect.poll(() => page.evaluate(() => tripsLoadPromise === null)).toBe(true);
  await page.evaluate(() => {
    loadedTrips = [];
    window._originalDashboardSync = syncPendingOfflineChanges;
    syncPendingOfflineChanges = () =>
      new Promise(resolve => {
        window._finishDashboardSync = resolve;
      });
    void loadTrips();
  });
  await expect(page.locator('.web-skeleton-card')).toHaveCount(2);
  await expect(page.locator('#trips-list')).toContainText('Loading your trips…');
  await page.evaluate(() => {
    syncPendingOfflineChanges = window._originalDashboardSync;
    window._finishDashboardSync({ remaining: 0 });
  });
  await expect(page.locator('.web-trip-card')).toContainText('Saved trip');
});

test('web dashboard does not mistake first-load failures for an empty account', async ({ page }) => {
  await setupBackend(page, { rejectTripReads: true, waitForTrips: false });
  await expect(page.locator('.web-empty-state')).toContainText('Your trips couldn’t load');
  await expect(page.locator('.web-skeleton-card')).toHaveCount(0);
  await expect(page.locator('.web-empty-state')).not.toContainText('Where are you headed?');
  await expect(page.locator('.web-dashboard-banner')).toContainText('Couldn’t refresh');
});

test('new social accounts finish profile setup before the first trip load', async ({ page }) => {
  const backend = await setupBackend(page, { firstLoginProfileDelay: 150, waitForTrips: false });
  await expect.poll(() => backend.rows.profiles.length).toBe(1);
  expect(backend.tripReadBeforeProfileReady).toBe(false);
  await expect(page.locator('.web-trip-card')).toContainText('Saved trip');
  expect(backend.rows.profiles).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: user.id, display_name: 'Test Traveller' })]),
  );
  await expect(page.locator('.web-dashboard-banner')).toBeHidden();
});

test('web offline dashboard keeps saved trips, attributes pending changes, and syncs cleanly', async ({ page }) => {
  const backend = await setupBackend(page);
  await setConnectivity(page, backend, false);
  await createOfflineTrip(page, 'Queued dashboard trip');
  await returnToTrips(page);
  await expect(page.locator('.web-dashboard-banner')).toContainText('You’re offline');
  await expect(page.locator('.web-trip-card').filter({ hasText: 'Queued dashboard trip' })).toContainText(
    '1 change waiting',
  );
  await expect(
    page.locator('.web-trip-card').filter({ hasText: 'Saved trip' }).locator('.web-pending-pill'),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.web-trip-card').filter({ hasText: 'Queued dashboard trip' })).toContainText(
    '1 change waiting',
  );
  await setConnectivity(page, backend, true);
  await expect(page.locator('.web-pending-pill')).toHaveCount(0);
  await expect(page.locator('.web-dashboard-banner')).toBeHidden();
});

test('web offline dashboard explains when this device has no saved trips', async ({ page }) => {
  const backend = await setupBackend(page);
  await setConnectivity(page, backend, false);
  await page.evaluate(() => {
    clearUserTripCaches(window._currentUser.id);
    void loadTrips();
  });
  await expect(page.locator('.web-empty-state')).toContainText('No trips saved on this device');
  await expect(page.locator('.web-dashboard-banner')).toContainText('You’re offline');
  await expect(page.locator('.web-skeleton-card')).toHaveCount(0);
});

test('web dashboard keeps cached cards visible when a refresh fails', async ({ page }) => {
  await setupBackend(page);
  await expect.poll(() => page.evaluate(() => tripsLoadPromise === null)).toBe(true);
  await page.route('**/rest/v1/trips?*', route =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Trip data unavailable' }),
    }),
  );
  await page.evaluate(() => loadTrips());
  await expect(page.locator('.web-trip-card')).toContainText('Saved trip');
  await expect(page.locator('.web-dashboard-banner')).toContainText('Showing saved data');
});

test('web dashboard keeps settlement suggestions inside the relevant trip overview', async ({ page }) => {
  const backend = await setupBackend(page);
  const other = { id: 'other-member', trip_id: tripId, user_id: null, name: 'Maya' };
  backend.rows.members.push(other);
  backend.rows.expenses.push({
    id: 'split-expense',
    trip_id: tripId,
    title: 'Shared lunch',
    amount: 100,
    paid_by: memberId,
    day_number: 1,
    category: 'food',
    created_at: '2026-09-27T12:00:00Z',
  });
  backend.rows.expense_splits.push(
    { id: 'split-self', expense_id: 'split-expense', member_id: memberId, share_amount: 50 },
    { id: 'split-other', expense_id: 'split-expense', member_id: other.id, share_amount: 50 },
  );
  await page.evaluate(() => loadTrips());
  await expect(page.locator('.web-trip-card')).toContainText('Open to see balance');
  await page.evaluate(id => openTrip(id), tripId);
  await returnToTrips(page);
  await expect(page.locator('.web-trip-card')).toContainText('+EUR 50.00');
  await expect(page.locator('.web-trip-card')).toContainText('Saved balance');
  await expect(page.locator('.web-trip-card')).toContainText('Last saved: Shared lunch');
  await expect(page.locator('.web-suggested')).toHaveCount(0);
  await expect(page.getByText('Amounts are rechecked')).toHaveCount(0);
  await page.evaluate(id => openTrip(id), tripId);
  await expect(page.locator('.web-overview-suggestion')).toContainText('Maya owes you');
  await expect(page.locator('.web-overview-suggestion')).toContainText('EUR 50.00');
  await page.locator('.web-overview-suggestion').getByRole('button', { name: 'Record payment' }).click();
  await expect(page.locator('#modal-payment')).toHaveClass(/open/);
  await page.locator('#modal-payment [data-action="close-modal"]').click();
  await page.evaluate(
    ({ from, to }) => {
      currentPayments.push({
        id: 'new-payment',
        trip_id: currentTrip.id,
        from_member: from,
        to_member: to,
        amount: 50,
      });
      syncCurrentTripCache();
      renderOverviewTab();
    },
    { from: other.id, to: memberId },
  );
  await expect(page.locator('.web-overview-suggestion')).toHaveCount(0);
  await returnToTrips(page);
  await expect(page.locator('.web-trip-card')).toContainText('all square');
});

test('web invite dialog rejects foreign links and passes approved tokens to existing flow', async ({ page }) => {
  await setupBackend(page);
  let acceptedToken;
  await page.route('**/rest/v1/rpc/accept_trip_invite', route => {
    acceptedToken = route.request().postDataJSON().p_invite_token;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(tripId) });
  });
  await page.locator('.web-dashboard-heading').getByRole('button', { name: 'Join with invite link' }).click();
  await expect(page.locator('#modal-web-join')).toHaveClass(/open/);
  await expect(page.locator('#web-invite-link')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#modal-web-join .modal-close')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#form-web-join [type="submit"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.web-dashboard-heading button')).toBeFocused();
  await page.locator('.web-dashboard-heading button').click();
  await page.locator('#web-invite-link').fill(`https://tripcash.de.evil.test/app?invite=${tripId}`);
  await page.locator('#form-web-join').getByRole('button', { name: 'Join trip', exact: true }).click();
  await expect(page.locator('#web-invite-error')).toContainText('complete TripCash invite');
  expect(acceptedToken).toBeUndefined();
  await page.locator('#web-invite-link').fill(`https://tripcash.de/app?invite=${tripId}`);
  await page.locator('#form-web-join').getByRole('button', { name: 'Join trip', exact: true }).click();
  await expect.poll(() => acceptedToken).toBe(tripId);
  await expect(page.locator('#screen-dashboard')).toHaveClass(/active/);
});

test('profile preferences persist on the account and reload from the server', async ({ page }) => {
  const backend = await setupBackend(page);
  await page.locator('[data-action="open-profile-view"]').first().click();
  await expect(page.locator('#screen-profile')).toHaveClass(/active/);

  await page.locator('[data-key="tc-home-currency"]').selectOption('CHF');
  await page.locator('[data-key="tc-default-split"]').selectOption('exact');
  await page.locator('[data-action="toggle-profile-theme"]').click();

  await expect
    .poll(() => backend.rows.profiles[0])
    .toMatchObject({
      home_currency: 'CHF',
      default_split: 'exact',
      theme_preference: 'light',
    });
  await page.evaluate(() => {
    localStorage.setItem('tc-home-currency', 'USD');
    localStorage.setItem('tc-default-split', 'equal');
    localStorage.setItem('tc-theme', 'dark');
  });
  await page.reload();
  await page.locator('[data-action="open-profile-view"]').first().click();

  await expect(page.locator('[data-key="tc-home-currency"]')).toHaveValue('CHF');
  await expect(page.locator('[data-key="tc-default-split"]')).toHaveValue('exact');
  await expect(page.locator('[data-action="toggle-profile-theme"] em')).toHaveText('light');
});

test('profile preferences refresh when another device changes them', async ({ page }) => {
  const backend = await setupBackend(page);
  await page.locator('[data-action="open-profile-view"]').first().click();
  await expect(page.locator('[data-key="tc-home-currency"]')).toHaveValue('EUR');
  // Finish the first profile read before simulating a second device's update.
  await page.evaluate(() => refreshAccountPreferences());

  Object.assign(backend.rows.profiles[0], {
    home_currency: 'GBP',
    default_split: 'exact',
    theme_preference: 'dark',
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));

  await expect(page.locator('[data-key="tc-home-currency"]')).toHaveValue('GBP');
  await expect(page.locator('[data-key="tc-default-split"]')).toHaveValue('exact');
  await expect(page.locator('[data-action="toggle-profile-theme"] em')).toHaveText('dark');
});

test('the first upgraded launch migrates existing device preferences to the account', async ({ page }) => {
  const backend = await setupBackend(page, {
    legacyPreferences: { homeCurrency: 'GBP', defaultSplit: 'exact', theme: 'dark' },
  });

  await expect
    .poll(() => backend.rows.profiles[0])
    .toMatchObject({
      home_currency: 'GBP',
      default_split: 'exact',
      theme_preference: 'dark',
    });
});

test('a remote edit blocks an offline overwrite until pending changes are reviewed', async ({ page }) => {
  const backend = await setupBackend(page);
  await page.evaluate(id => openTrip(id), tripId);
  await setConnectivity(page, backend, false);
  await openWorkspaceTripSettings(page);
  await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
  await page.locator('#trip-name').fill('Offline name');
  await page.locator('#btn-create-trip').click();
  backend.rows.trips[0].name = 'Changed on another device';
  await returnToTrips(page);
  await setConnectivity(page, backend, true);
  await expect(page.locator('#offline-sync-status')).toHaveText('1 change pending');
  expect(backend.rows.trips[0].name).toBe('Changed on another device');
  await page.locator('#btn-review-sync').click();
  await page.locator('#confirm-ok').click();
  await expect(page.locator('.trip-card')).toContainText('Changed on another device');
  await expect(page.locator('#offline-sync-status')).toBeHidden();
});

test('offline member deletion survives reload and syncs on reconnect', async ({ page }) => {
  const backend = await setupBackend(page);
  const extra = { id: '00000000-0000-4000-8000-000000000009', trip_id: tripId, name: 'Demo friend', user_id: null };
  backend.rows.members.push(extra);
  await page.evaluate(id => openTrip(id), tripId);
  await setConnectivity(page, backend, false);
  await page.evaluate(id => {
    void deleteMember(id);
  }, extra.id);
  await page.locator('#confirm-ok').click();
  await expect.poll(() => page.evaluate(() => currentMembers.length)).toBe(1);
  await page.reload();
  await expect.poll(() => page.evaluate(() => currentMembers.length)).toBe(1);
  await setConnectivity(page, backend, true);
  await expect.poll(() => backend.rows.members.length).toBe(1);
});

test('offline trip deletion removes the cached trip and syncs its cascade on reconnect', async ({ page }) => {
  const backend = await setupBackend(page);
  await page.evaluate(id => openTrip(id), tripId);
  await setConnectivity(page, backend, false);
  await page.evaluate(() => {
    void deleteTrip();
  });
  await page.locator('#confirm-ok').click();
  await expect(page.locator('.trip-card')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.trip-card')).toHaveCount(0);
  await setConnectivity(page, backend, true);
  await expect.poll(() => backend.rows.trips.length).toBe(0);
});

test('offline creation and editing survive reload, then automatically sync without duplicates', async ({ page }) => {
  const backend = await setupBackend(page);
  await setConnectivity(page, backend, false);
  await createOfflineTrip(page, 'Offline weekend');
  await openWorkspaceTripSettings(page);
  await page.getByRole('button', { name: 'Edit trip', exact: true }).click();
  await page.locator('#trip-name').fill('Edited offline weekend');
  await page.locator('#btn-create-trip').click();
  await expect(page.locator('#dash-trip-name')).toContainText('Edited offline weekend');
  await page.reload();
  await expect(page.locator('#dash-trip-name')).toContainText('Edited offline weekend');
  await returnToTrips(page);
  await expect(page.locator('#offline-sync-status')).toHaveText('2 changes pending');
  await page.getByRole('button', { name: 'Sync now', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('Connect to the internet');
  expect(backend.rows.trips).toHaveLength(1);

  await setConnectivity(page, backend, true);
  await expect.poll(() => backend.rows.trips.some(trip => trip.name === 'Edited offline weekend')).toBe(true);
  await expect(page.locator('#offline-sync-status')).toBeHidden();
  await expect(page.locator('#btn-sync-now')).toBeHidden();
  await page.reload();
  await expect(page.locator('.trip-card').filter({ hasText: 'Edited offline weekend' })).toHaveCount(1);
  expect(backend.rows.trips).toHaveLength(2);
  const created = backend.rows.trips.find(trip => trip.name === 'Edited offline weekend');
  expect(backend.rows.members.filter(member => member.trip_id === created.id)).toHaveLength(1);
});

test('a failed automatic sync keeps pending work and Sync now retries successfully', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const backend = await setupBackend(page);
  await setConnectivity(page, backend, false);
  await createOfflineTrip(page, 'Retry weekend');
  await returnToTrips(page);
  backend.rejectWrites = true;
  await setConnectivity(page, backend, true);
  await expect(page.locator('#toast')).toContainText('still need to sync');
  await expect(page.locator('#offline-sync-status')).toHaveText('1 change pending');
  const sync = page.getByRole('button', { name: 'Sync now', exact: true });
  await expect(sync).toBeEnabled();
  const box = await sync.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(backend.rows.trips).toHaveLength(1);
  backend.rejectWrites = false;
  await sync.click();
  await expect.poll(() => backend.rows.trips.some(trip => trip.name === 'Retry weekend')).toBe(true);
  await expect(page.locator('#offline-sync-status')).toBeHidden();
  await expect(page.locator('#btn-sync-now')).toBeHidden();
  expect(backend.rows.trips).toHaveLength(2);
});
