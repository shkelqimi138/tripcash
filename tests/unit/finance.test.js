// Unit tests for money parsing, split calculations, exports, and exchange-rate fallbacks

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const appSource = fs.readFileSync(path.join(root, 'web', 'scripts', 'app.js'), 'utf8');

function loadFinanceState({ members, expenses, splits, payments }) {
  const classList = {
    add() {},
    remove() {},
    toggle() {},
    contains() {
      return false;
    },
  };
  const storage = {
    getItem() {
      return null;
    },
    setItem() {},
    removeItem() {},
  };
  const context = vm.createContext({
    console,
    crypto: { randomUUID: () => 'test-id' },
    setTimeout,
    clearTimeout,
    Blob,
    URL,
    Headers,
    fetch: async () => ({ ok: true }),
    navigator: {},
    location: {
      hash: '',
      pathname: '/',
      search: '',
      protocol: 'https:',
      hostname: 'example.com',
      origin: 'https://example.com',
    },
    history: { pushState() {}, replaceState() {} },
    localStorage: storage,
    sessionStorage: storage,
    document: {
      body: { classList },
      addEventListener() {},
      querySelectorAll() {
        return [];
      },
      getElementById() {
        return null;
      },
    },
    window: {
      addEventListener() {},
      _currentUser: null,
      _currentProfile: null,
    },
  });

  vm.runInContext(appSource, context);
  const state = JSON.stringify({ members, expenses, splits, payments });
  vm.runInContext(
    `
    {
      const fixture = ${state};
      currentMembers = fixture.members;
      currentExpenses = fixture.expenses;
      currentSplits = fixture.splits;
      currentPayments = fixture.payments;
    }
  `,
    context,
  );

  return JSON.parse(vm.runInContext('JSON.stringify(calcBalances())', context));
}

test('equal split remainders cancel when three members each pay the same amount', () => {
  const members = ['one', 'two', 'three'].map(id => ({ id }));
  const expenses = members.map((member, index) => ({
    id: `expense-${index}`,
    paid_by: member.id,
    amount: 20,
    split_type: 'equal',
  }));
  const splits = expenses.flatMap(expense =>
    members.map((member, index) => ({
      expense_id: expense.id,
      member_id: member.id,
      share_amount: index < 2 ? 6.67 : 6.66,
    })),
  );
  const result = loadFinanceState({ members, expenses, splits, payments: [] });
  assert.deepEqual(result.suggestions, []);
  for (const balance of Object.values(result.balances)) assert.ok(Math.abs(balance) < 0.000001);
});

function allocate(total, weightedMembers) {
  const context = vm.createContext({
    console,
    setTimeout,
    clearTimeout,
    Blob,
    URL,
    Headers,
    navigator: {},
    location: {
      hash: '',
      pathname: '/',
      search: '',
      protocol: 'https:',
      hostname: 'example.com',
      origin: 'https://example.com',
    },
    history: { pushState() {}, replaceState() {} },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    sessionStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    document: {
      body: { classList: { toggle() {}, add() {}, remove() {} } },
      addEventListener() {},
      querySelectorAll() {
        return [];
      },
      getElementById() {
        return null;
      },
    },
    window: { addEventListener() {} },
  });
  vm.runInContext(appSource, context);
  context.total = total;
  context.weightedMembers = weightedMembers;
  return JSON.parse(vm.runInContext('JSON.stringify(allocateRoundedSplits(total, weightedMembers))', context));
}

async function loadExchangeRate({ storedRates = {}, online = true, fetchImpl }) {
  const values = new Map([['tc-exchange-rates-v1', JSON.stringify(storedRates)]]);
  const storage = {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  const context = vm.createContext({
    console,
    crypto: { randomUUID: () => 'test-id' },
    setTimeout,
    clearTimeout,
    AbortController,
    Blob,
    URL,
    Headers,
    fetch: fetchImpl,
    navigator: { onLine: online },
    location: {
      hash: '',
      pathname: '/',
      search: '',
      protocol: 'https:',
      hostname: 'example.com',
      origin: 'https://example.com',
    },
    history: { pushState() {}, replaceState() {} },
    localStorage: storage,
    sessionStorage: storage,
    document: {
      body: {
        classList: {
          add() {},
          remove() {},
          toggle() {},
          contains() {
            return false;
          },
        },
      },
      addEventListener() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getElementById() {
        return null;
      },
    },
    window: { addEventListener() {}, _currentUser: null, _currentProfile: null },
  });
  vm.runInContext(appSource, context);
  const rate = await vm.runInContext("getExchangeRate('USD', 'EUR')", context);
  return { rate, stored: JSON.parse(values.get('tc-exchange-rates-v1') || '{}') };
}

test('money parsing accepts dot and comma decimals without rounding', () => {
  const source = appSource.match(/function parseMoneyInput\(value\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, 'parseMoneyInput is missing');
  const parseMoneyInput = vm.runInNewContext(`(${source})`);

  assert.equal(parseMoneyInput('12.65'), 12.65);
  assert.equal(parseMoneyInput('12,65'), 12.65);
  assert.equal(parseMoneyInput('0,01'), 0.01);
  assert.ok(Number.isNaN(parseMoneyInput('12.6.5')));
  assert.ok(Number.isNaN(parseMoneyInput('12,6,5')));
});

test('CSV cells neutralize spreadsheet formulas and escape quotes', () => {
  const source = appSource.match(/function csvCell\(value\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, 'csvCell is missing');
  const csvCell = vm.runInNewContext(`(${source})`);

  assert.equal(csvCell('Dinner'), '"Dinner"');
  assert.equal(csvCell('=HYPERLINK("https://evil.example")'), '"\'=HYPERLINK(""https://evil.example"")"');
  assert.equal(csvCell('\t+1+1'), '"\'\t+1+1"');
  assert.equal(csvCell('-12'), '"\'-12"');
});

test('native CSV export writes a file and opens the iOS share sheet', async () => {
  const writes = [];
  const shares = [];
  const classList = {
    add() {},
    remove() {},
    toggle() {},
    contains() {
      return false;
    },
  };
  const context = vm.createContext({
    console,
    crypto: { randomUUID: () => 'test-id' },
    setTimeout,
    clearTimeout,
    Blob,
    URL,
    Headers,
    fetch: async () => ({ ok: true }),
    navigator: { onLine: true },
    location: {
      hash: '',
      pathname: '/',
      search: '',
      protocol: 'capacitor:',
      hostname: 'localhost',
      origin: 'capacitor://localhost',
    },
    history: { pushState() {}, replaceState() {} },
    localStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    sessionStorage: {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
    document: {
      documentElement: { classList },
      body: { classList, dataset: {}, appendChild() {} },
      addEventListener() {},
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      getElementById() {
        return null;
      },
      createElement() {
        return { className: '', classList, remove() {} };
      },
    },
    window: { addEventListener() {}, _currentUser: null, _currentProfile: null, scrollY: 0 },
  });
  vm.runInContext(appSource, context);
  context.window.Capacitor = {
    isNativePlatform: () => true,
    Plugins: {
      Filesystem: {
        async writeFile(options) {
          writes.push(options);
          return { uri: 'file:///tmp/trip.csv' };
        },
      },
      Share: {
        async share(options) {
          shares.push(options);
        },
      },
    },
  };
  vm.runInContext(
    `
    currentTrip = { id: 'trip-1', name: 'Rome Trip', currency: 'EUR' };
    currentMembers = [];
    currentExpenses = [];
    showToast = () => {};
  `,
    context,
  );

  await vm.runInContext('exportCSV()', context);
  assert.equal(writes[0].path, 'Rome_Trip_expenses.csv');
  assert.match(writes[0].data, /^"Day","Title","Category"/);
  assert.deepEqual(Array.from(shares[0].files), ['file:///tmp/trip.csv']);
});

test('rounded split allocation always equals the expense total', () => {
  const splits = allocate(10, [
    { member_id: 'a', weight: 1 },
    { member_id: 'b', weight: 1 },
    { member_id: 'c', weight: 1 },
  ]);

  assert.deepEqual(splits, [
    { member_id: 'a', amount: 3.34 },
    { member_id: 'b', amount: 3.33 },
    { member_id: 'c', amount: 3.33 },
  ]);
  assert.equal(
    splits.reduce((sum, split) => sum + split.amount, 0),
    10,
  );
});

test('weighted converted splits preserve the converted total', () => {
  const splits = allocate(8.57, [
    { member_id: 'a', weight: 50 },
    { member_id: 'b', weight: 30 },
    { member_id: 'c', weight: 20 },
  ]);

  assert.equal(Math.round(splits.reduce((sum, split) => sum + split.amount, 0) * 100), 857);
});

test('live exchange rates are persisted for later offline use', async () => {
  const result = await loadExchangeRate({
    fetchImpl: async () => ({ ok: true, json: async () => ({ rates: { EUR: 0.91 } }) }),
  });

  assert.equal(result.rate, 0.91);
  assert.equal(result.stored['USD-EUR'].rate, 0.91);
  assert.match(result.stored['USD-EUR'].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('stored exchange rates keep conversion available when offline', async () => {
  const result = await loadExchangeRate({
    online: false,
    storedRates: { 'USD-EUR': { rate: 0.89, updatedAt: '2026-09-01T00:00:00.000Z' } },
    fetchImpl: async () => {
      throw new Error('fetch should not run offline');
    },
  });

  assert.equal(result.rate, 0.89);
});

test('stored exchange rates are used when the live service fails', async () => {
  const result = await loadExchangeRate({
    storedRates: { 'USD-EUR': { rate: 0.88, updatedAt: '2026-09-01T00:00:00.000Z' } },
    fetchImpl: async () => {
      throw new Error('service unavailable');
    },
  });

  assert.equal(result.rate, 0.88);
});

test('equal expense creates correct balances and settlements', () => {
  const result = loadFinanceState({
    members: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    expenses: [{ id: 'e1', paid_by: 'a', amount: 90 }],
    splits: [
      { expense_id: 'e1', member_id: 'a', share_amount: 30 },
      { expense_id: 'e1', member_id: 'b', share_amount: 30 },
      { expense_id: 'e1', member_id: 'c', share_amount: 30 },
    ],
    payments: [],
  });

  assert.deepEqual(result.balances, { a: 60, b: -30, c: -30 });
  assert.deepEqual(result.suggestions, [
    { from: 'b', to: 'a', amount: 30 },
    { from: 'c', to: 'a', amount: 30 },
  ]);
});

test('recorded payment reduces outstanding balances', () => {
  const result = loadFinanceState({
    members: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    expenses: [{ id: 'e1', paid_by: 'a', amount: 90 }],
    splits: [
      { expense_id: 'e1', member_id: 'a', share_amount: 30 },
      { expense_id: 'e1', member_id: 'b', share_amount: 30 },
      { expense_id: 'e1', member_id: 'c', share_amount: 30 },
    ],
    payments: [{ from_member: 'b', to_member: 'a', amount: 10 }],
  });

  assert.deepEqual(result.balances, { a: 50, b: -20, c: -30 });
  assert.equal(
    result.suggestions.reduce((sum, item) => sum + item.amount, 0),
    50,
  );
});

test('expenses without split rows do not affect balances', () => {
  const result = loadFinanceState({
    members: [{ id: 'a' }, { id: 'b' }],
    expenses: [{ id: 'incomplete', paid_by: 'a', amount: 500 }],
    splits: [],
    payments: [],
  });

  assert.deepEqual(result.balances, { a: 0, b: 0 });
  assert.deepEqual(result.suggestions, []);
});

test('suggested transfers settle every balance within one cent', () => {
  const result = loadFinanceState({
    members: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    expenses: [
      { id: 'e1', paid_by: 'a', amount: 120 },
      { id: 'e2', paid_by: 'd', amount: 40 },
    ],
    splits: [
      { expense_id: 'e1', member_id: 'a', share_amount: 30 },
      { expense_id: 'e1', member_id: 'b', share_amount: 30 },
      { expense_id: 'e1', member_id: 'c', share_amount: 30 },
      { expense_id: 'e1', member_id: 'd', share_amount: 30 },
      { expense_id: 'e2', member_id: 'a', share_amount: 10 },
      { expense_id: 'e2', member_id: 'b', share_amount: 10 },
      { expense_id: 'e2', member_id: 'c', share_amount: 10 },
      { expense_id: 'e2', member_id: 'd', share_amount: 10 },
    ],
    payments: [],
  });

  const settled = { ...result.balances };
  for (const payment of result.suggestions) {
    settled[payment.from] += payment.amount;
    settled[payment.to] -= payment.amount;
  }
  for (const balance of Object.values(settled)) {
    assert.ok(Math.abs(balance) < 0.01);
  }
});
