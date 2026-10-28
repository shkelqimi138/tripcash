// Offline identity and mutation queue service for durable local work and ordered Supabase synchronization

const TRIPCASH_OFFLINE_USER_KEY = 'tc-offline-user-v1';
const TRIPCASH_OFFLINE_QUEUE_PREFIX = 'tc-offline-queue-v1-';
const OFFLINE_IDENTITY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function offlineQueueKey(userId) {
  return userId ? `${TRIPCASH_OFFLINE_QUEUE_PREFIX}${userId}` : null;
}

function readOfflineQueue(userId) {
  const key = offlineQueueKey(userId);
  if (!key) return [];
  try {
    const queue = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(queue) ? queue : [];
  } catch (_) {
    return [];
  }
}

function writeOfflineQueue(userId, queue) {
  const key = offlineQueueKey(userId);
  if (!key) return;
  localStorage.setItem(key, JSON.stringify(queue));
}

function cacheOfflineUser(user) {
  if (!user?.id) return;
  try {
    localStorage.setItem(
      TRIPCASH_OFFLINE_USER_KEY,
      JSON.stringify({
        id: user.id,
        is_anonymous: Boolean(user.is_anonymous),
        user_metadata: { display_name: String(user.user_metadata?.display_name || '').slice(0, 80) },
        savedAt: Date.now(),
      }),
    );
  } catch (_) {}
}

function restoreOfflineUser() {
  try {
    const user = JSON.parse(localStorage.getItem(TRIPCASH_OFFLINE_USER_KEY) || 'null');
    if (!user?.id) {
      clearOfflineUser();
      return null;
    }
    if (!Number.isFinite(user.savedAt)) {
      cacheOfflineUser(user);
      return JSON.parse(localStorage.getItem(TRIPCASH_OFFLINE_USER_KEY) || 'null');
    }
    if (Date.now() - user.savedAt > OFFLINE_IDENTITY_MAX_AGE_MS) {
      clearOfflineUser();
      return null;
    }
    return user;
  } catch (_) {
    return null;
  }
}

function clearOfflineUser() {
  localStorage.removeItem(TRIPCASH_OFFLINE_USER_KEY);
}

function clearOfflineQueue(userId) {
  const key = offlineQueueKey(userId);
  if (key) localStorage.removeItem(key);
}

function pendingProfileValues(userId) {
  const values = {};
  for (const mutation of readOfflineQueue(userId)) {
    for (const step of mutation.steps || []) {
      if (step.table !== 'profiles' || step.method !== 'update') continue;
      if (step.match?.id && step.match.id !== userId) continue;
      Object.assign(values, step.values || {});
    }
  }
  return values;
}

function isConnectionFailure(error) {
  if (navigator.onLine === false) return true;
  const message = String(error?.message || error || '').toLowerCase();
  return ['failed to fetch', 'network', 'offline', 'load failed', 'internet connection'].some(fragment =>
    message.includes(fragment),
  );
}

function queueOfflineMutation(userId, mutation) {
  const queue = readOfflineQueue(userId);
  const queued = {
    ...mutation,
    id: mutation.id || crypto.randomUUID(),
    userId,
    createdAt: mutation.createdAt || new Date().toISOString(),
  };
  queue.push(queued);
  writeOfflineQueue(userId, queue);
  return queued;
}

async function executeOfflineStep(step) {
  let result;
  if (step.method === 'rpc') {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(step.function || '')) {
      throw new Error('Unsupported offline RPC name.');
    }
    result = await db.rpc(step.function, step.args || {});
  } else if (step.method === 'upsert-ignore') {
    if (step.table === 'trips') {
      // Trip SELECT rules look up the existing trip; an upsert checks them before
      // the new row exists. Insert normally, then verify an accessible ID on retry.
      result = await db.from('trips').insert(step.values);
      if (result.error?.code === '23505') {
        const existing = await db.from('trips').select('id').eq('id', step.values.id).maybeSingle();
        if (!existing.error && existing.data?.id === step.values.id) result = { error: null };
      }
    } else {
      result = await db.from(step.table).upsert(step.values, {
        onConflict: step.onConflict || 'id',
        ignoreDuplicates: true,
      });
    }
  } else if (step.method === 'update' || step.method === 'delete') {
    let query = step.method === 'delete' ? db.from(step.table).delete() : db.from(step.table).update(step.values);
    for (const [column, value] of Object.entries(step.match || {})) query = query.eq(column, value);
    for (const [column, value] of Object.entries(step.expected || {})) {
      query = value === null ? query.is(column, null) : query.eq(column, value);
    }
    if (step.expected) query = query.select('id');
    result = await query;
    if (!result.error && step.expected && !result.data?.length) {
      const latest = await db.from(step.table).select('*').eq('id', step.match.id).maybeSingle();
      if (latest.error) throw latest.error;
      // An acknowledged write may have lost its response; replay is safe when
      // the desired values already exist or the deleted row is already absent.
      const applied =
        step.method === 'delete'
          ? !latest.data
          : latest.data && Object.entries(step.values).every(([key, value]) => latest.data[key] === value);
      if (!applied)
        throw { code: 'SYNC_CONFLICT', message: 'This record changed on another device or is no longer editable.' };
    }
  } else {
    throw new Error(`Unsupported offline mutation method: ${step.method}`);
  }
  if (result?.error) throw result.error;
}

function acknowledgeOfflineMutation(userId, mutationId) {
  const latest = readOfflineQueue(userId);
  writeOfflineQueue(
    userId,
    latest.filter(item => item.id !== mutationId),
  );
}

async function executeOfflineMutation(mutation) {
  const steps = mutation.steps || [];
  for (let index = mutation.nextStep || 0; index < steps.length; index += 1) {
    await executeOfflineStep(steps[index]);
    mutation.nextStep = index + 1;
    const latest = readOfflineQueue(mutation.userId);
    const pending = latest.find(item => item.id === mutation.id);
    if (pending) {
      pending.nextStep = mutation.nextStep;
      writeOfflineQueue(mutation.userId, latest);
    }
  }
}

async function saveOrQueueOfflineMutation(user, mutation) {
  if (!user?.id) return { status: 'error', error: new Error('No signed-in user is available.') };
  const alreadyPending = readOfflineQueue(user.id).length > 0 || offlineQueueSyncPromises.has(user.id);
  let queued;
  try {
    // Persist before sending so a slow request cannot be overtaken by a newer edit.
    queued = queueOfflineMutation(user.id, mutation);
  } catch (error) {
    return { status: 'error', error };
  }
  if (navigator.onLine === false || alreadyPending) return { status: 'queued' };

  const result = await syncOfflineQueue(user);
  if (!readOfflineQueue(user.id).some(item => item.id === queued.id)) return { status: 'synced' };
  if (
    result.failedMutation?.id === queued.id &&
    !result.failedMutation.nextStep &&
    result.error?.code !== 'SYNC_CONFLICT' &&
    !isConnectionFailure(result.error)
  ) {
    // An immediately rejected online save must remain an error in the form.
    // Partially applied and previously queued changes stay durable for a retry.
    acknowledgeOfflineMutation(user.id, queued.id);
    return { status: 'error', error: result.error };
  }
  return { status: 'queued' };
}

const offlineQueueSyncPromises = new Map();

async function syncOfflineQueue(user) {
  if (!user?.id || navigator.onLine === false) {
    return { synced: 0, remaining: user?.id ? readOfflineQueue(user.id).length : 0 };
  }
  if (offlineQueueSyncPromises.has(user.id)) return offlineQueueSyncPromises.get(user.id);

  const syncPromise = Promise.resolve().then(async () => {
    let synced = 0;
    let error = null;
    let failedMutation = null;

    while (navigator.onLine !== false) {
      const mutation = readOfflineQueue(user.id)[0];
      if (!mutation) break;
      try {
        await executeOfflineMutation(mutation);
        acknowledgeOfflineMutation(user.id, mutation.id);
        synced += 1;
      } catch (syncError) {
        error = syncError;
        failedMutation = mutation;
        break;
      }
    }

    return { synced, remaining: readOfflineQueue(user.id).length, error, failedMutation };
  });
  offlineQueueSyncPromises.set(user.id, syncPromise);

  try {
    return await syncPromise;
  } finally {
    offlineQueueSyncPromises.delete(user.id);
  }
}

window.TripCashOffline = {
  cacheUser: cacheOfflineUser,
  restoreUser: restoreOfflineUser,
  clearUser: clearOfflineUser,
  clearQueue: clearOfflineQueue,
  pendingCount: userId => readOfflineQueue(userId).length,
  pendingProfileValues,
  isSyncing: userId => offlineQueueSyncPromises.has(userId),
  saveMutation: saveOrQueueOfflineMutation,
  sync: syncOfflineQueue,
};
