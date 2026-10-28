// Unit tests for durable offline mutation queuing, ordered synchronization, and cached identity recovery

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', '..', 'web', 'scripts', 'offline.js'), 'utf8');

function createStorage() {
  const values = new Map();
  return {
    getItem: key => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

function loadOfflineService({ online = false, responseFor, localStorage = createStorage() } = {}) {
  const navigator = { onLine: online };
  const calls = [];
  let nextId = 0;
  const db = {
    async rpc(name, args) {
      calls.push({ method: 'rpc', function: name, args });
      return responseFor?.(name, 'rpc', args) || { data: null, error: null };
    },
    from(table) {
      const mutationQuery = (method, values) => {
        const match = {};
        const query = {
          eq(column, value) {
            match[column] = value;
            return query;
          },
          is(column, value) {
            match[column] = value;
            return query;
          },
          select() {
            return query;
          },
          then(resolve, reject) {
            calls.push({ method, table, values, match });
            return Promise.resolve(responseFor?.(table, method, values) || { data: null, error: null }).then(
              resolve,
              reject,
            );
          },
        };
        return query;
      };
      return {
        async insert(values) {
          calls.push({ method: 'insert', table, values });
          return responseFor?.(table, 'insert', values) || { error: null };
        },
        select() {
          return {
            eq: (_column, id) => ({
              maybeSingle: async () => responseFor?.(table, 'select', { id }) || { data: null, error: null },
            }),
          };
        },
        async upsert(values, options) {
          calls.push({ method: 'upsert', table, values, options });
          return responseFor?.(table, 'upsert', values) || { error: null };
        },
        update: values => mutationQuery('update', values),
        delete: () => mutationQuery('delete'),
      };
    },
  };
  const context = {
    console,
    crypto: { randomUUID: () => `id-${++nextId}` },
    Date,
    db,
    localStorage,
    navigator,
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { service: context.window.TripCashOffline, localStorage, navigator, calls };
}

test('offline mutations remain durable and sync their steps in order after reconnecting', async () => {
  const { service, navigator, calls } = loadOfflineService();
  const user = { id: 'user-1' };
  const mutation = {
    label: 'Create trip',
    steps: [
      { method: 'upsert-ignore', table: 'trips', values: { id: 'trip-1' } },
      { method: 'upsert-ignore', table: 'members', values: { id: 'member-1', trip_id: 'trip-1' } },
      { method: 'update', table: 'trips', values: { name: 'Edited offline' }, match: { id: 'trip-1' } },
    ],
  };

  assert.equal((await service.saveMutation(user, mutation)).status, 'queued');
  assert.equal(service.pendingCount(user.id), 1);
  assert.deepEqual(calls, []);

  navigator.onLine = true;
  const result = await service.sync(user);
  assert.deepEqual({ synced: result.synced, remaining: result.remaining }, { synced: 1, remaining: 0 });
  assert.deepEqual(
    calls.map(call => `${call.method}:${call.table}`),
    ['insert:trips', 'upsert:members', 'update:trips'],
  );
  assert.deepEqual(calls[2].match, { id: 'trip-1' });
  assert.equal(service.pendingCount(user.id), 0);
});

test('network failures queue a mutation instead of losing it', async () => {
  const { service } = loadOfflineService({
    online: true,
    responseFor: () => ({ error: { message: 'Load failed' } }),
  });
  const user = { id: 'user-2' };
  const result = await service.saveMutation(user, {
    label: 'Add expense',
    steps: [{ method: 'upsert-ignore', table: 'expenses', values: { id: 'expense-1' } }],
  });

  assert.equal(result.status, 'queued');
  assert.equal(service.pendingCount(user.id), 1);
});

test('transactional RPC mutations remain durable and replay once', async () => {
  const { service, navigator, calls } = loadOfflineService();
  const user = { id: 'user-rpc' };
  const step = {
    method: 'rpc',
    function: 'create_expense_with_splits',
    args: { p_expense: { id: 'expense-rpc' }, p_splits: [{ id: 'split-rpc' }] },
  };
  assert.equal((await service.saveMutation(user, { label: 'Add expense', steps: [step] })).status, 'queued');
  navigator.onLine = true;
  assert.equal((await service.sync(user)).synced, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ method: 'rpc', function: step.function, args: step.args }]);
});

test('a failed reconnect identifies the blocked mutation and a later retry preserves and syncs it', async () => {
  let shouldFail = true;
  const { service, navigator } = loadOfflineService({
    responseFor: () => (shouldFail ? { error: { message: 'Session unavailable' } } : { error: null }),
  });
  const user = { id: 'user-retry' };
  await service.saveMutation(user, {
    label: 'Create offline trip',
    steps: [{ method: 'upsert-ignore', table: 'trips', values: { id: 'trip-retry' } }],
  });

  navigator.onLine = true;
  const failed = await service.sync(user);
  assert.equal(failed.remaining, 1);
  assert.equal(failed.failedMutation.label, 'Create offline trip');
  assert.equal(service.pendingCount(user.id), 1);

  shouldFail = false;
  const retried = await service.sync(user);
  assert.deepEqual({ synced: retried.synced, remaining: retried.remaining }, { synced: 1, remaining: 0 });
  assert.equal(service.pendingCount(user.id), 0);
});

test('the last authenticated identity is available for an offline cold start', () => {
  const { service } = loadOfflineService();
  const user = { id: 'user-3', email: 'person@example.com', user_metadata: { display_name: 'Ana' } };
  service.cacheUser(user);
  const restored = JSON.parse(JSON.stringify(service.restoreUser()));
  assert.equal(restored.id, user.id);
  assert.equal(restored.user_metadata.display_name, 'Ana');
  assert.equal(restored.email, undefined);
  assert.ok(Number.isFinite(restored.savedAt));
  service.clearUser();
  assert.equal(service.restoreUser(), null);
});

test('a cached identity from the previous release migrates before expiring', () => {
  const localStorage = createStorage();
  localStorage.setItem(
    'tc-offline-user-v1',
    JSON.stringify({
      id: 'legacy-user',
      email: 'legacy@example.com',
      user_metadata: { display_name: 'Legacy traveller' },
    }),
  );
  const { service } = loadOfflineService({ localStorage });

  const restored = JSON.parse(JSON.stringify(service.restoreUser()));
  assert.equal(restored.id, 'legacy-user');
  assert.equal(restored.user_metadata.display_name, 'Legacy traveller');
  assert.equal(restored.email, undefined);
  assert.ok(Number.isFinite(restored.savedAt));
});

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function renameTrip(name) {
  return {
    label: 'Update trip',
    steps: [{ method: 'update', table: 'trips', values: { name }, match: { id: 'trip-1' } }],
  };
}

test('a new offline edit survives an earlier in-flight sync and a cold start', async () => {
  const started = deferred();
  const request = deferred();
  const { service, navigator, localStorage } = loadOfflineService({
    responseFor: () => {
      started.resolve();
      return request.promise;
    },
  });
  const user = { id: 'user-concurrent' };
  await service.saveMutation(user, renameTrip('First edit'));
  navigator.onLine = true;
  const syncing = service.sync(user);
  await started.promise;
  navigator.onLine = false;
  await service.saveMutation(user, renameTrip('Second edit'));
  assert.equal(service.pendingCount(user.id), 2);
  request.resolve({ error: null });
  assert.equal((await syncing).remaining, 1);

  const restarted = loadOfflineService({ online: true, localStorage });
  assert.equal(restarted.service.pendingCount(user.id), 1);
  assert.equal((await restarted.service.sync(user)).synced, 1);
  assert.equal(restarted.calls[0].values.name, 'Second edit');
  assert.equal(restarted.service.pendingCount(user.id), 0);
});

test('a newer online edit waits for the older offline edit and wins on the server', async () => {
  let remoteName = 'Original';
  const { service, navigator, calls } = loadOfflineService({
    responseFor: (_table, _method, values) => {
      remoteName = values.name;
      return { error: null };
    },
  });
  const user = { id: 'user-ordering' };
  await service.saveMutation(user, renameTrip('Older offline name'));
  navigator.onLine = true;
  assert.equal((await service.saveMutation(user, renameTrip('Latest online name'))).status, 'queued');
  assert.equal(calls.length, 0);
  assert.equal((await service.sync(user)).remaining, 0);
  assert.deepEqual(
    calls.map(call => call.values.name),
    ['Older offline name', 'Latest online name'],
  );
  assert.equal(remoteName, 'Latest online name');
});

test('edits added during a successful sync are drained in order without overlapping requests', async () => {
  const started = deferred();
  const request = deferred();
  const { service, navigator, calls } = loadOfflineService({
    responseFor: (_table, _method, values) => {
      if (values.name === 'First') {
        started.resolve();
        return request.promise;
      }
      return { error: null };
    },
  });
  const user = { id: 'user-drain' };
  await service.saveMutation(user, renameTrip('First'));
  navigator.onLine = true;
  const syncing = service.sync(user);
  const duplicateSync = service.sync(user);
  await started.promise;
  assert.equal((await service.saveMutation(user, renameTrip('Second'))).status, 'queued');
  assert.equal(calls.length, 1);
  request.resolve({ error: null });
  assert.equal((await syncing).synced, 2);
  assert.equal((await duplicateSync).synced, 2);
  assert.deepEqual(
    calls.map(call => call.values.name),
    ['First', 'Second'],
  );
  assert.equal(service.pendingCount(user.id), 0);
});

test('a slow online save cannot be overtaken by another online save', async () => {
  const started = deferred();
  const request = deferred();
  const { service, calls } = loadOfflineService({
    online: true,
    responseFor: (_table, _method, values) => {
      if (values.name === 'First') {
        started.resolve();
        return request.promise;
      }
      return { error: null };
    },
  });
  const user = { id: 'user-online' };
  const first = service.saveMutation(user, renameTrip('First'));
  await started.promise;
  assert.equal((await service.saveMutation(user, renameTrip('Second'))).status, 'queued');
  assert.equal(calls.length, 1);
  request.resolve({ error: null });
  assert.equal((await first).status, 'synced');
  assert.deepEqual(
    calls.map(call => call.values.name),
    ['First', 'Second'],
  );
});

test('partially synced multi-step changes resume after a cold start without replaying acknowledged steps', async () => {
  const { service, localStorage } = loadOfflineService({
    online: true,
    responseFor: table => (table === 'members' ? { error: { message: 'Network unavailable' } } : { error: null }),
  });
  const user = { id: 'user-partial' };
  assert.equal(
    (
      await service.saveMutation(user, {
        label: 'Create trip',
        steps: [
          { method: 'upsert-ignore', table: 'trips', values: { id: 'trip-partial' } },
          { method: 'upsert-ignore', table: 'members', values: { id: 'member-partial' } },
        ],
      })
    ).status,
    'queued',
  );
  const restarted = loadOfflineService({ online: true, localStorage });
  assert.equal((await restarted.service.sync(user)).synced, 1);
  assert.deepEqual(
    restarted.calls.map(call => call.table),
    ['members'],
  );
});

test('an immediately rejected online mutation stays an error and does not linger in the queue', async () => {
  const { service } = loadOfflineService({
    online: true,
    responseFor: () => ({ error: { message: 'Permission denied' } }),
  });
  const user = { id: 'user-denied' };
  assert.equal((await service.saveMutation(user, renameTrip('Rejected'))).status, 'error');
  assert.equal(service.pendingCount(user.id), 0);
});

test('a duplicate trip is acknowledged only when its ID is readable through the current account', async () => {
  let accessible = false;
  const { service, navigator } = loadOfflineService({
    responseFor: (_table, method, values) =>
      method === 'insert'
        ? { error: { code: '23505', message: 'Duplicate trip ID' } }
        : { data: accessible ? { id: values.id } : null, error: null },
  });
  const user = { id: 'user-duplicate' };
  await service.saveMutation(user, {
    label: 'Create trip',
    steps: [{ method: 'upsert-ignore', table: 'trips', values: { id: 'trip-retry' } }],
  });
  navigator.onLine = true;
  assert.equal((await service.sync(user)).remaining, 1);
  accessible = true;
  assert.equal((await service.sync(user)).synced, 1);
  assert.equal(service.pendingCount(user.id), 0);
});

test('syncing one account does not consume or block another account queue', async () => {
  const started = deferred();
  const request = deferred();
  const { service, navigator, calls } = loadOfflineService({
    responseFor: (_table, _method, values) => {
      if (values.name === 'Account A') {
        started.resolve();
        return request.promise;
      }
      return { error: null };
    },
  });
  const userA = { id: 'account-a' };
  const userB = { id: 'account-b' };
  await service.saveMutation(userA, renameTrip('Account A'));
  await service.saveMutation(userB, renameTrip('Account B'));
  navigator.onLine = true;
  const first = service.sync(userA);
  await started.promise;
  assert.equal((await service.sync(userB)).synced, 1);
  assert.equal(service.pendingCount(userA.id), 1);
  assert.equal(calls[1].values.name, 'Account B');
  request.resolve({ error: null });
  await first;
});

test('queued profile preferences restore the latest values for only their account', async () => {
  const { service } = loadOfflineService();
  const user = { id: 'profile-preferences' };
  const updatePreference = values =>
    service.saveMutation(user, {
      label: 'Update profile preference',
      steps: [{ method: 'update', table: 'profiles', values, match: { id: user.id } }],
    });

  await updatePreference({ home_currency: 'USD' });
  await updatePreference({ home_currency: 'CHF', default_split: 'exact' });
  await updatePreference({ theme_preference: 'dark' });

  assert.deepEqual(JSON.parse(JSON.stringify(service.pendingProfileValues(user.id))), {
    home_currency: 'CHF',
    default_split: 'exact',
    theme_preference: 'dark',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(service.pendingProfileValues('another-account'))), {});
});

test('offline deletes are durable and execute after reconnecting', async () => {
  const { service, navigator, calls } = loadOfflineService();
  const user = { id: 'delete-user' };
  const result = await service.saveMutation(user, {
    label: 'Delete expense',
    steps: [{ method: 'delete', table: 'expenses', match: { id: 'expense-delete' } }],
  });
  assert.equal(result.status, 'queued');
  navigator.onLine = true;
  assert.equal((await service.sync(user)).synced, 1);
  assert.deepEqual(calls[0], {
    method: 'delete',
    table: 'expenses',
    values: undefined,
    match: { id: 'expense-delete' },
  });
});

test('a conflicting remote edit stays queued for explicit review', async () => {
  const { service } = loadOfflineService({
    online: true,
    responseFor: (_table, method) =>
      method === 'select'
        ? { data: { id: 'trip-conflict', name: 'Remote name' }, error: null }
        : { data: [], error: null },
  });
  const user = { id: 'conflict-user' };
  const result = await service.saveMutation(user, {
    label: 'Update trip',
    steps: [
      {
        method: 'update',
        table: 'trips',
        values: { name: 'Offline name' },
        match: { id: 'trip-conflict' },
        expected: { name: 'Old name' },
      },
    ],
  });
  assert.equal(result.status, 'queued');
  assert.equal(service.pendingCount(user.id), 1);
});
