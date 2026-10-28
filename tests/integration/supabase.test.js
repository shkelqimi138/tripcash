// Integration tests for Supabase authentication, RLS, recovery, admin access, and deletion

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHmac, randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test, before } = require('node:test');
const { createClient } = require('@supabase/supabase-js');

const enabled = process.env.TRIPCASH_SUPABASE_INTEGRATION === '1';
const CAPTCHA_TEST_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';
const integrationTest = (name, fn) => test(name, { skip: !enabled }, fn);

let admin;
let anonymous;
let ownerClient;
let memberClient;
let owner;
let member;
let trip;
let ownerMember;
let joinedMember;
let apiUrl;
let anonKey;

function localSupabaseStatus() {
  return JSON.parse(
    execFileSync('supabase', ['status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }),
  );
}

function client(url, key) {
  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function requireData(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}

function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = secret.replace(/=+$/g, '').toUpperCase();
  let bits = '';
  for (const character of normalized) bits += alphabet.indexOf(character).toString(2).padStart(5, '0');
  const key = Buffer.from((bits.match(/.{8}/g) || []).map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(value).padStart(6, '0');
}

async function createConfirmedUser(email, password, name) {
  const data = requireData(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: name },
    }),
    `create ${name}`,
  );
  const signedInClient = client(apiUrl, anonKey);
  requireData(
    await signedInClient.auth.signInWithPassword({
      email,
      password,
      options: { captchaToken: CAPTCHA_TEST_TOKEN },
    }),
    `sign in ${name}`,
  );
  requireData(
    await signedInClient.from('profiles').insert({
      id: data.user.id,
      display_name: name,
      is_anonymous: false,
    }),
    `create ${name} profile`,
  );
  return { user: data.user, client: signedInClient };
}

before(async () => {
  if (!enabled) return;
  const status = localSupabaseStatus();
  apiUrl = status.API_URL;
  anonKey = status.ANON_KEY;
  admin = client(apiUrl, status.SERVICE_ROLE_KEY);
  anonymous = client(apiUrl, anonKey);

  const suffix = `${Date.now()}-${process.pid}`;
  const ownerAccount = await createConfirmedUser(`owner-${suffix}@example.test`, 'OwnerSecure123', 'Owner');
  const memberAccount = await createConfirmedUser(`member-${suffix}@example.test`, 'MemberSecure123', 'Member');
  owner = ownerAccount.user;
  ownerClient = ownerAccount.client;
  member = memberAccount.user;
  memberClient = memberAccount.client;
});

integrationTest('local Auth creates confirmed users with isolated profiles', async () => {
  const ownerProfile = requireData(
    await ownerClient.from('profiles').select('id, display_name, is_admin').eq('id', owner.id).single(),
    'read owner profile',
  );
  assert.deepEqual(ownerProfile, { id: owner.id, display_name: 'Owner', is_admin: false });

  const memberProfile = requireData(
    await memberClient.from('profiles').select('id, display_name').eq('id', member.id).single(),
    'read member profile',
  );
  assert.equal(memberProfile.display_name, 'Member');
});

integrationTest('profile preferences persist and reject unsupported values', async () => {
  requireData(
    await ownerClient
      .from('profiles')
      .update({
        home_currency: 'CHF',
        default_split: 'exact',
        theme_preference: 'dark',
      })
      .eq('id', owner.id),
    'update owner preferences',
  );

  const preferences = requireData(
    await ownerClient
      .from('profiles')
      .select('home_currency, default_split, theme_preference')
      .eq('id', owner.id)
      .single(),
    'read owner preferences',
  );
  assert.deepEqual(preferences, {
    home_currency: 'CHF',
    default_split: 'exact',
    theme_preference: 'dark',
  });

  const invalid = await ownerClient.from('profiles').update({ theme_preference: 'midnight' }).eq('id', owner.id);
  assert.ok(invalid.error, 'invalid preference values must be rejected');
});

integrationTest('welcome email claims are one-time and authenticated', async () => {
  assert.equal(requireData(await ownerClient.rpc('claim_welcome_email'), 'claim welcome email'), true);
  assert.equal(requireData(await ownerClient.rpc('claim_welcome_email'), 'reject duplicate welcome claim'), false);
  requireData(await ownerClient.rpc('complete_welcome_email'), 'complete welcome email');
  assert.equal(requireData(await ownerClient.rpc('claim_welcome_email'), 'reject sent welcome claim'), false);
  const anonymousClaim = await anonymous.rpc('claim_welcome_email');
  assert.ok(anonymousClaim.error, 'anonymous callers must not claim welcome email delivery');
});

integrationTest('receipt scanning quota is atomic, account-scoped, and unavailable to anonymous callers', async () => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.equal(
      requireData(await ownerClient.rpc('consume_receipt_scan_quota'), `consume scanner quota ${attempt + 1}`),
      true,
    );
  }
  assert.equal(
    requireData(await ownerClient.rpc('consume_receipt_scan_quota'), 'reject scanner quota above limit'),
    false,
  );
  const anonymousQuota = await anonymous.rpc('consume_receipt_scan_quota');
  assert.ok(anonymousQuota.error, 'anonymous callers must not consume the scanner quota');
  const directRead = await ownerClient.from('receipt_scan_limits').select('*');
  assert.ok(directRead.error, 'authenticated callers must not read scanner quota rows directly');
  assert.equal(directRead.data, null);
});

integrationTest('RLS blocks strangers and expiring invitation tokens grant trip access', async () => {
  trip = {
    id: randomUUID(),
    name: 'Integration Trip',
    creator_id: owner.id,
    currency: 'EUR',
    emoji: 'plane',
  };
  requireData(await ownerClient.from('trips').insert(trip), 'create trip');

  requireData(
    await ownerClient.from('trip_members').insert({
      trip_id: trip.id,
      user_id: owner.id,
      role: 'creator',
    }),
    'create owner trip membership',
  );

  ownerMember = requireData(
    await ownerClient
      .from('members')
      .insert({
        trip_id: trip.id,
        user_id: owner.id,
        name: 'Owner',
      })
      .select()
      .single(),
    'create owner member',
  );

  const hiddenTrips = requireData(await memberClient.from('trips').select('id').eq('id', trip.id), 'query hidden trip');
  assert.deepEqual(hiddenTrips, []);

  const blockedMember = await memberClient.from('members').insert({
    trip_id: trip.id,
    user_id: member.id,
    name: 'Member',
  });
  assert.ok(blockedMember.error, 'RLS must reject member rows before invitation acceptance');

  const directJoin = await memberClient
    .from('trip_members')
    .insert({ trip_id: trip.id, user_id: member.id, role: 'member' });
  assert.ok(directJoin.error, 'direct membership insertion must be rejected');

  const invitation = requireData(
    await ownerClient.rpc('get_or_create_trip_invite', { p_trip_id: trip.id }).single(),
    'create invitation',
  );
  const preview = requireData(
    await anonymous.rpc('get_trip_preview', { p_invite_token: invitation.token }).single(),
    'read invitation preview',
  );
  assert.deepEqual(preview, { id: trip.id, name: 'Integration Trip', emoji: 'plane' });

  assert.equal(
    requireData(
      await memberClient.rpc('accept_trip_invite', { p_invite_token: invitation.token }),
      'accept invitation',
    ),
    trip.id,
  );

  joinedMember = requireData(
    await memberClient
      .from('members')
      .insert({
        trip_id: trip.id,
        user_id: member.id,
        name: 'Member',
      })
      .select()
      .single(),
    'create joined member',
  );

  const visibleTrip = requireData(
    await memberClient.from('trips').select('id, name').eq('id', trip.id).single(),
    'read joined trip',
  );
  assert.equal(visibleTrip.name, 'Integration Trip');
});

integrationTest('offline trip creation and edits sync through real RLS in order without duplicates', async () => {
  const values = new Map();
  const localNavigator = { onLine: false };
  const context = vm.createContext({
    window: {},
    navigator: localNavigator,
    db: ownerClient,
    crypto: { randomUUID },
    localStorage: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    },
  });
  vm.runInContext(readFileSync(path.resolve(__dirname, '..', '..', 'web', 'scripts', 'offline.js'), 'utf8'), context);
  const service = context.window.TripCashOffline;
  const tripId = randomUUID();
  const memberId = randomUUID();
  const expenseId = randomUUID();
  assert.equal(
    (
      await service.saveMutation(owner, {
        label: 'Create trip',
        steps: [
          {
            method: 'upsert-ignore',
            table: 'trips',
            values: { id: tripId, name: 'Offline trip', creator_id: owner.id, currency: 'EUR' },
          },
          {
            method: 'upsert-ignore',
            table: 'trip_members',
            values: { id: randomUUID(), trip_id: tripId, user_id: owner.id, role: 'creator' },
          },
          {
            method: 'upsert-ignore',
            table: 'members',
            values: { id: memberId, trip_id: tripId, user_id: owner.id, name: 'Owner' },
          },
        ],
      })
    ).status,
    'queued',
  );
  await service.saveMutation(owner, {
    label: 'Add expense',
    steps: [
      {
        method: 'rpc',
        function: 'create_expense_with_splits',
        args: {
          p_expense: {
            id: expenseId,
            trip_id: tripId,
            paid_by: memberId,
            created_by: owner.id,
            created_by_name: 'Owner',
            title: 'Offline lunch',
            amount: 12,
            currency: 'EUR',
            original_amount: 12,
            exchange_rate: 1,
            day_number: 1,
            category: 'food',
            split_type: 'equal',
          },
          p_splits: [{ id: randomUUID(), expense_id: expenseId, member_id: memberId, share_amount: 12 }],
        },
      },
    ],
  });
  localNavigator.onLine = true;
  assert.equal(
    (
      await service.saveMutation(owner, {
        label: 'Update trip',
        steps: [{ method: 'update', table: 'trips', values: { name: 'Latest trip name' }, match: { id: tripId } }],
      })
    ).status,
    'queued',
  );
  const synced = await service.sync(owner);
  assert.equal(synced.error, null, synced.error?.message);
  assert.equal(synced.synced, 3);
  assert.equal(synced.remaining, 0);
  const saved = requireData(
    await ownerClient.from('trips').select('name').eq('id', tripId).single(),
    'read synced trip',
  );
  assert.equal(saved.name, 'Latest trip name');
  const expenses = requireData(
    await ownerClient.from('expenses').select('id,amount').eq('trip_id', tripId),
    'read synced expense',
  );
  assert.equal(expenses.length, 1);
  assert.equal(Number(expenses[0].amount), 12);

  const forbiddenExpenseId = randomUUID();
  const forbiddenInsert = await ownerClient.from('expenses').insert({
    id: forbiddenExpenseId,
    trip_id: tripId,
    paid_by: memberId,
    created_by: owner.id,
    created_by_name: 'Owner',
    title: 'Direct insert must fail',
    amount: 10,
    currency: 'EUR',
    original_amount: 10,
    exchange_rate: 1,
    day_number: 1,
    category: 'other',
    split_type: 'equal',
  });
  assert.ok(forbiddenInsert.error, 'authenticated clients must not insert expenses outside the atomic RPC');

  const invalidExpenseId = randomUUID();
  const invalidExpense = await ownerClient.rpc('create_expense_with_splits', {
    p_expense: {
      id: invalidExpenseId,
      trip_id: tripId,
      paid_by: memberId,
      created_by_name: 'Owner',
      title: 'Invalid split',
      amount: 10,
      currency: 'EUR',
      original_amount: 10,
      exchange_rate: 1,
      day_number: 1,
      category: 'other',
      split_type: 'equal',
    },
    p_splits: [{ id: randomUUID(), expense_id: invalidExpenseId, member_id: memberId, share_amount: 9 }],
  });
  assert.ok(invalidExpense.error, 'a split total that differs from the expense amount must fail');
  const rolledBackExpense = requireData(
    await ownerClient.from('expenses').select('id').eq('id', invalidExpenseId),
    'verify invalid expense rollback',
  );
  assert.equal(rolledBackExpense.length, 0);

  assert.equal((await service.sync(owner)).synced, 0);
  // Simulate a server-accepted insert whose acknowledgement was lost on the device.
  localNavigator.onLine = false;
  await service.saveMutation(owner, {
    label: 'Retry trip creation',
    steps: [
      {
        method: 'upsert-ignore',
        table: 'trips',
        values: { id: tripId, name: 'Offline trip', creator_id: owner.id, currency: 'EUR' },
      },
    ],
  });
  localNavigator.onLine = true;
  const replay = await service.sync(owner);
  assert.equal(replay.error, null, replay.error?.message);
  assert.equal(replay.synced, 1);
  const afterReplay = requireData(await ownerClient.from('trips').select('name').eq('id', tripId), 'read retried trip');
  assert.deepEqual(afterReplay, [{ name: 'Latest trip name' }]);
  const members = requireData(
    await ownerClient.from('members').select('id').eq('trip_id', tripId),
    'read synced members',
  );
  assert.deepEqual(members, [{ id: memberId }]);
});

integrationTest('password recovery token establishes a recovery session and changes the password', async () => {
  const link = requireData(
    await admin.auth.admin.generateLink({
      type: 'recovery',
      email: member.email,
    }),
    'generate password recovery link',
  );
  assert.ok(link.properties?.hashed_token, 'recovery link must contain a token hash');

  const recoveryClient = client(apiUrl, anonKey);
  requireData(
    await recoveryClient.auth.verifyOtp({
      type: 'recovery',
      token_hash: link.properties.hashed_token,
    }),
    'verify password recovery token',
  );
  requireData(await recoveryClient.auth.updateUser({ password: 'RecoveredSecure123' }), 'update recovered password');
  await recoveryClient.auth.signOut();

  const oldPassword = await client(apiUrl, anonKey).auth.signInWithPassword({
    email: member.email,
    password: 'MemberSecure123',
    options: { captchaToken: CAPTCHA_TEST_TOKEN },
  });
  assert.ok(oldPassword.error, 'old password must stop working');

  memberClient = client(apiUrl, anonKey);
  requireData(
    await memberClient.auth.signInWithPassword({
      email: member.email,
      password: 'RecoveredSecure123',
      options: { captchaToken: CAPTCHA_TEST_TOKEN },
    }),
    'sign in with recovered password',
  );
});

integrationTest('admin RPC rejects ordinary users and returns data only for an admin', async () => {
  const denied = await memberClient.rpc('admin_stats');
  assert.ok(denied.error, 'ordinary users must not access admin statistics');
  assert.match(denied.error.message, /Access denied/i);

  requireData(await admin.from('profiles').update({ is_admin: true }).eq('id', owner.id), 'promote local test admin');
  const withoutMfa = await ownerClient.rpc('admin_stats');
  assert.ok(withoutMfa.error, 'admin statistics must require MFA');
  assert.match(withoutMfa.error.message, /Multi-factor authentication required/i);

  const enrollment = requireData(
    await ownerClient.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Integration test' }),
    'enroll admin MFA',
  );
  requireData(
    await ownerClient.auth.mfa.challengeAndVerify({ factorId: enrollment.id, code: totp(enrollment.totp.secret) }),
    'verify admin MFA',
  );
  const stats = requireData(await ownerClient.rpc('admin_stats'), 'read admin statistics');
  assert.ok(Array.isArray(stats.trips));
  assert.ok(Array.isArray(stats.profiles));
  assert.ok(stats.trips.some(candidate => candidate.id === trip.id));
  assert.ok(stats.profiles.every(profile => !('paypal_link' in profile) && !('is_admin' in profile)));
  assert.ok(stats.trips.every(candidate => !('creator_id' in candidate) && !('budget' in candidate)));
});

integrationTest('personal-data deletion anonymizes records while preserving the Auth account', async () => {
  const suffix = `${Date.now()}-${randomUUID()}`;
  const account = await createConfirmedUser(`fresh-${suffix}@example.test`, 'FreshSecure123', 'Fresh User');
  const personalTrip = requireData(
    await admin.from('trips').insert({ name: 'Personal trip', currency: 'EUR' }).select().single(),
    'create personal trip fixture',
  );
  requireData(
    await admin.from('trips').update({ creator_id: account.user.id }).eq('id', personalTrip.id),
    'assign personal trip fixture',
  );
  requireData(
    await admin.from('contacts').insert({ owner_id: account.user.id, name: 'Private contact' }),
    'create private contact fixture',
  );

  requireData(await account.client.rpc('delete_current_user_data'), 'delete personal data');

  const retainedAuth = requireData(await admin.auth.admin.getUserById(account.user.id), 'verify Auth account remains');
  assert.equal(retainedAuth.user.id, account.user.id);
  const profile = requireData(
    await admin
      .from('profiles')
      .select('display_name,username,paypal_link,home_currency,default_split,theme_preference')
      .eq('id', account.user.id)
      .single(),
    'read reset profile',
  );
  assert.deepEqual(profile, {
    display_name: 'TripCash user',
    username: null,
    paypal_link: null,
    home_currency: 'EUR',
    default_split: 'equal',
    theme_preference: 'system',
  });
  const tripAfterDeletion = requireData(
    await admin.from('trips').select('creator_id,status').eq('id', personalTrip.id).single(),
    'read anonymized trip',
  );
  assert.deepEqual(tripAfterDeletion, { creator_id: null, status: 'ended' });
  const contacts = requireData(
    await admin.from('contacts').select('id').eq('owner_id', account.user.id),
    'check deleted contacts',
  );
  assert.equal(contacts.length, 0);
});

integrationTest('account deletion removes Auth identity and anonymizes retained member data', async () => {
  const denied = await memberClient.rpc('delete_user_by_id', { p_user_id: member.id });
  assert.ok(denied.error, 'ordinary authenticated users must not execute account deletion');
  requireData(await admin.rpc('delete_user_by_id', { p_user_id: member.id }), 'delete member account');

  const deletedAuthUser = await admin.auth.admin.getUserById(member.id);
  assert.ok(deletedAuthUser.error || !deletedAuthUser.data?.user, 'Auth user must be deleted');

  const retainedMember = requireData(
    await admin.from('members').select('id, user_id, name, paypal_link').eq('id', joinedMember.id).single(),
    'read anonymized member',
  );
  assert.equal(retainedMember.user_id, null);
  assert.equal(retainedMember.name, 'Deleted user');
  assert.equal(retainedMember.paypal_link, null);

  const ownerStillExists = requireData(await admin.auth.admin.getUserById(owner.id), 'verify unrelated owner survives');
  assert.equal(ownerStillExists.user.id, owner.id);
  assert.equal(ownerMember.user_id, owner.id);
});
