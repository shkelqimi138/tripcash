// Regression tests for password-recovery routing and authentication state handling

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function storage() {
  const values = new Map();
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('password recovery is gated before normal signed-in routing', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'web', 'scripts', 'auth.js'), 'utf8');
  const localStorage = storage();
  const sessionStorage = storage();
  const screens = [];
  const modals = [];
  let userReadyCalls = 0;
  const cancelButton = { hidden: true, disabled: false };

  const context = {
    console,
    URLSearchParams,
    localStorage,
    sessionStorage,
    location: { hash: '', protocol: 'capacitor:', hostname: 'localhost', pathname: '/', search: '' },
    history: { replaceState() {} },
    window: {},
    document: {
      addEventListener() {},
      querySelector() {
        return { textContent: '' };
      },
      getElementById(id) {
        if (id === 'btn-cancel-password-recovery') return cancelButton;
        if (id === 'new-password') return { focus() {} };
        return null;
      },
    },
    db: {
      auth: {
        onAuthStateChange() {},
        refreshSession: async () => ({ data: { session: null } }),
        getSession: async () => ({ data: { session: null } }),
      },
    },
    showScreen: name => screens.push(name),
    moveWebIntentToAppPath() {},
    isWebLandingPath: () => false,
    openModal: id => modals.push(id),
    onUserReady: () => {
      userReadyCalls += 1;
    },
    setTimeout: fn => {
      fn();
      return 1;
    },
    setLoading() {},
    showToast() {},
    shake() {},
    closeModal() {},
    openAuthMode() {},
    appConfirm: async () => false,
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  context.ensureProfile = async () => {};

  await context.handleAuthSession('PASSWORD_RECOVERY', {
    access_token: 'temporary-recovery-token',
    user: { id: 'user-1', email: 'person@example.com', user_metadata: {} },
  });

  assert.equal(userReadyCalls, 0, 'normal dashboard routing must not run');
  assert.deepEqual(screens, ['auth']);
  assert.deepEqual(modals, ['modal-new-password']);
  assert.equal(localStorage.getItem('tc-password-recovery-pending'), 'true');
  assert.equal(context.window._passwordRecoveryPending, true);
  assert.equal(cancelButton.hidden, false);
});

test('saving a recovered password clears the recovery gate before Supabase emits user updates', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'web', 'scripts', 'auth.js'), 'utf8');
  const localStorage = storage();
  const sessionStorage = storage();
  localStorage.setItem('tc-password-recovery-pending', 'true');
  let pendingDuringUpdate = true;
  let userReadyCalls = 0;
  const closed = [];
  const elements = {
    'modal-new-password': { dataset: { passwordMode: 'recovery' } },
    'new-password': { value: 'Recovered123' },
    'new-password-confirm': { value: 'Recovered123' },
    'current-password': { value: '' },
    'form-new-password': { reset() {} },
    'btn-cancel-password-recovery': { hidden: false },
    'btn-close-new-password': { hidden: true },
  };
  const context = {
    console,
    URLSearchParams,
    localStorage,
    sessionStorage,
    navigator: { onLine: true },
    location: { hash: '', protocol: 'capacitor:', hostname: 'localhost', pathname: '/', search: '' },
    history: { replaceState() {} },
    window: { _currentUser: { id: 'user-1', email: 'person@example.com', user_metadata: {} } },
    document: {
      addEventListener() {},
      querySelector() {
        return null;
      },
      getElementById(id) {
        return elements[id] || null;
      },
    },
    db: {
      auth: {
        onAuthStateChange() {},
        getSession: async () => ({ data: { session: null } }),
        async updateUser() {
          pendingDuringUpdate = context.window._passwordRecoveryPending;
          return { error: null };
        },
      },
    },
    setTimeout() {
      return 1;
    },
    setLoading() {},
    showToast() {},
    shake() {},
    closeModal: id => closed.push(id),
    onUserReady: () => {
      userReadyCalls += 1;
    },
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  await context.handleNewPassword({ preventDefault() {} });

  assert.equal(pendingDuringUpdate, false);
  assert.equal(localStorage.getItem('tc-password-recovery-pending'), null);
  assert.deepEqual(closed, ['modal-new-password']);
  assert.equal(userReadyCalls, 1);
});
