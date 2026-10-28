// Browser end-to-end tests for landing, authentication, and CSP-safe interactions

const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/**', route => route.abort());
  await page.route('https://*.supabase.co/**', route => route.abort());
  await page.goto('/');
});

test('landing actions work without inline JavaScript', async ({ page }) => {
  await expect(page).toHaveTitle(/TripCash/);
  await page.getByRole('button', { name: 'Privacy' }).first().click();
  const legalDialog = page.locator('#landing-legal-dialog');
  await expect(legalDialog).toBeVisible();
  await expect(legalDialog).toContainText('Privacy Policy');
  await legalDialog.getByRole('button', { name: 'Close' }).click();
  await expect(legalDialog).not.toBeVisible();
});

test('landing theme control switches and persists light and dark modes', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('tc-theme', 'system');
    applyTheme('system');
  });
  const toggle = page.locator('#landing-theme-toggle');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.locator('body')).toHaveClass(/light/);
  await expect(toggle).toContainText('Light');
  await toggle.click();
  await expect(page.locator('body')).toHaveClass(/dark/);
  await expect(toggle).toContainText('Dark');
  await expect(page.locator('.landing-phone-shot')).toHaveAttribute(
    'src',
    'assets/screenshots/android/dark/tripcash-expenses.webp',
  );
  await expect(page.locator('.screenshot-card img').first()).toHaveAttribute(
    'src',
    'assets/screenshots/android/dark/tripcash-trips.webp',
  );
  await expect(page.locator('.screenshot-card img').last()).toHaveAttribute(
    'src',
    'assets/screenshots/android/dark/tripcash-trip-analytics.webp',
  );
  const darkTheme = await page.evaluate(() => ({
    preference: localStorage.getItem('tc-theme'),
    background: getComputedStyle(document.querySelector('.welcome-screen')).backgroundColor,
    heading: getComputedStyle(document.querySelector('.landing-hero h1')).color,
    themeColor: document.querySelector('meta[name="theme-color"]').content,
  }));
  expect(darkTheme).toEqual({
    preference: 'dark',
    background: 'rgb(7, 30, 28)',
    heading: 'rgb(247, 250, 249)',
    themeColor: '#071E1C',
  });
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/dark/);
  await expect(toggle).toContainText('Dark');
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(toggle).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Google Analytics stays unloaded until the visitor allows it and can be revoked', async ({ page }) => {
  let analyticsRequests = 0;
  await page.route('https://www.googletagmanager.com/gtag/js**', route => {
    analyticsRequests += 1;
    return route.fulfill({ contentType: 'application/javascript', body: '' });
  });
  await expect(page.getByRole('dialog', { name: 'Optional analytics' })).toBeVisible();
  expect(analyticsRequests).toBe(0);
  await page.getByRole('button', { name: 'Reject analytics' }).click();
  await expect(page.getByRole('dialog', { name: 'Optional analytics' })).not.toBeVisible();
  expect(analyticsRequests).toBe(0);
  await page.getByRole('button', { name: 'Cookie settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Analytics preferences' })).toBeVisible();
  await page.getByRole('button', { name: 'Allow analytics' }).click();
  await expect.poll(() => analyticsRequests).toBe(1);
  await expect(page.getByRole('dialog', { name: 'Analytics preferences' })).not.toBeVisible();
});

test('public welcome page has a calmer scale on desktop and phone without overflow', async ({ page }) => {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await page.evaluate(() => ({
      titleSize: parseFloat(getComputedStyle(document.querySelector('.landing-hero h1')).fontSize),
      sectionSize: parseFloat(getComputedStyle(document.querySelector('.landing-section-heading h2')).fontSize),
      buttonHeight: document.querySelector('.landing-primary').getBoundingClientRect().height,
      overflows: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(layout.titleSize).toBeLessThanOrEqual(width > 560 ? 74 : 48);
    expect(layout.sectionSize).toBeLessThanOrEqual(width > 560 ? 54 : 35);
    expect(layout.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(layout.overflows).toBe(false);
  }
});

test('money displays use locale grouping without changing input precision', async ({ page }) => {
  const amounts = await page.evaluate(() => ({
    eur: formatMoney(1234567.5, 'EUR'),
    gbp: formatMoney(1234567.5, 'GBP'),
    locale: navigator.language,
  }));
  const number = new Intl.NumberFormat(amounts.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(1234567.5);
  expect(amounts.eur).toBe(`EUR ${number}`);
  expect(amounts.gbp).toBe(`GBP ${number}`);
});

test('shared form messages and inputs stay readable and reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#contact-name').focus();
  await page.locator('#contact-email').focus();
  const contact = await page.locator('#contact-name').evaluate(element => {
    const input = getComputedStyle(element);
    const error = getComputedStyle(document.querySelector('.contact-field-error'));
    return {
      height: element.getBoundingClientRect().height,
      fontSize: parseFloat(input.fontSize),
      errorSize: parseFloat(error.fontSize),
    };
  });
  expect(contact.height).toBeGreaterThanOrEqual(44);
  expect(contact.fontSize).toBeGreaterThanOrEqual(16);
  expect(contact.errorSize).toBeGreaterThanOrEqual(16);
  await page.goto('/app');
  await page.getByRole('link', { name: 'Create account' }).click();
  const terms = await page.locator('#reg-terms').evaluate(element => ({
    checkboxHeight: element.getBoundingClientRect().height,
    labelHeight: element.closest('label').getBoundingClientRect().height,
  }));
  expect(terms.checkboxHeight).toBeLessThanOrEqual(24);
  expect(terms.labelHeight).toBeGreaterThanOrEqual(44);
});

test('screenshots open full-resolution images with working zoom and return focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const screenshots = page.locator('.screenshot-card');
  const dialog = page.locator('#landing-screenshot-dialog');
  await expect(screenshots).toHaveCount(6);
  await screenshots.nth(2).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('img')).toHaveAttribute('src', 'assets/screenshots/android/light/tripcash-expenses.webp');
  await expect(dialog.locator('img')).toHaveJSProperty('naturalWidth', 1080);
  await dialog.getByRole('button', { name: 'Zoom in' }).click();
  await expect(dialog).toHaveAttribute('data-zoom', '2');
  await expect(dialog.getByRole('status')).toHaveText('200%');
  const viewport = await dialog.locator('.screenshot-dialog-viewport').evaluate(element => ({
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }));
  expect(viewport.scrollWidth > viewport.clientWidth || viewport.scrollHeight > viewport.clientHeight).toBe(true);
  await dialog.getByRole('button', { name: 'Zoom in' }).click();
  await expect(dialog.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(screenshots.nth(2)).toBeFocused();
});

test('screenshot cards stay separate and within desktop, tablet, and phone widths', async ({ page }) => {
  for (const width of [1180, 800, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const section = page.locator('#screenshots');
    await section.scrollIntoViewIfNeeded();
    const heading = await section.locator('.landing-section-heading').boundingBox();
    const cards = await section.locator('.screenshot-tile').evaluateAll(elements =>
      elements.map(element => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      }),
    );
    expect(Math.min(...cards.map(card => card.top))).toBeGreaterThan(heading.y + heading.height + 16);
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        expect(
          cards[i].right <= cards[j].left + 1 ||
            cards[j].right <= cards[i].left + 1 ||
            cards[i].bottom <= cards[j].top + 1 ||
            cards[j].bottom <= cards[i].top + 1,
          `cards ${i} and ${j} overlap at ${width}px`,
        ).toBe(true);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('contact bot protection waits until the form approaches the viewport', async ({ page }) => {
  const turnstileUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  const initialRequests = await page.evaluate(
    url => performance.getEntriesByType('resource').filter(entry => entry.name.startsWith(url)).length,
    turnstileUrl,
  );
  expect(initialRequests).toBe(0);

  let requested = false;
  page.on('request', request => {
    if (request.url().startsWith(turnstileUrl)) requested = true;
  });
  await page.locator('#contact-turnstile').scrollIntoViewIfNeeded();
  await expect.poll(() => requested).toBe(true);
});

test('contact fields validate beside the input and remain one column', async ({ page }) => {
  await page.locator('#contact-name').focus();
  await page.locator('#contact-email').focus();
  await expect(page.locator('#contact-name-error')).toContainText('Enter your name');
  await expect(page.locator('#contact-name')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#contact-name').fill('Ana');
  await expect(page.locator('#contact-name-error')).toBeHidden();
  await page.locator('#contact-email').fill('not-an-email');
  await page.locator('#contact-subject').focus();
  await expect(page.locator('#contact-email-error')).toContainText('valid email');
  const columns = await page.evaluate(() => {
    const name = document.getElementById('contact-name').getBoundingClientRect();
    const email = document.getElementById('contact-email').getBoundingClientRect();
    return { sameLeft: Math.abs(name.left - email.left) < 2, stacked: email.top > name.bottom };
  });
  expect(columns).toEqual({ sameLeft: true, stacked: true });
});

test('contact failure never exposes raw server error text', async ({ page }) => {
  await page.route('**/api/contact', route =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Private upstream token failed"}' }),
  );
  await page.evaluate(() => {
    contactTurnstileWidget = 1;
    window.turnstile = { getResponse: () => 'test-token', reset: () => {} };
  });
  await page.locator('#contact-name').fill('Ana');
  await page.locator('#contact-email').fill('ana@example.test');
  await page.locator('#contact-subject').selectOption({ label: 'Feedback' });
  await page.locator('#contact-message').fill('Please help with my trip expenses.');
  await page.locator('#contact-consent').check();
  await page.locator('#contact-submit').click();
  await expect(page.locator('#contact-status')).toContainText('Message could not be sent');
  await expect(page.locator('#contact-status')).not.toContainText('Private upstream token');
});

test('trip and profile forms show inline errors on blur and clear them on correction', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => openNewTripModal());
  await expect(page.locator('#btn-create-trip')).toHaveText('Create trip');
  await page.locator('#trip-name').focus();
  await page.locator('#trip-budget').focus();
  await expect(page.locator('#trip-name-error')).toContainText('Enter a trip name');
  await page.locator('#trip-name').fill('Test');
  await page.locator('#trip-budget').focus();
  await expect(page.locator('#trip-name-error')).toContainText('descriptive trip name');
  await page.locator('#trip-name').fill('TRIP');
  await page.locator('#trip-budget').focus();
  await expect(page.locator('#trip-name-error')).toContainText('descriptive trip name');
  await page.locator('#trip-name').fill('Lisbon');
  await expect(page.locator('#trip-name-error')).toBeHidden();
  await page.locator('#trip-budget').fill('-10');
  await page.locator('#trip-end-date').focus();
  await expect(page.locator('#trip-budget-error')).toContainText('up to two decimals');
  await page.locator('#trip-budget').fill('10,50');
  await expect(page.locator('#trip-budget-error')).toBeHidden();
  await page.locator('#trip-start-date').fill('2026-10-10');
  await page.locator('#trip-end-date').fill('2026-10-01');
  await page.locator('#trip-budget').focus();
  await expect(page.locator('#trip-end-date-error')).toContainText('on or after');
  await page.locator('#trip-end-date').fill('2026-10-12');
  await expect(page.locator('#trip-end-date-error')).toBeHidden();
  await page.evaluate(() => closeModal('modal-new-trip'));
  await page.evaluate(() => openAccountSettings('profile'));
  await page.locator('#settings-name').focus();
  await page.locator('#settings-paypal').focus();
  await expect(page.locator('#settings-name-error')).toContainText('display name');
  await page.locator('#settings-name').fill('Ana');
  await expect(page.locator('#settings-name-error')).toBeHidden();
  await page.locator('#settings-paypal').fill('http://other.example/ana');
  await page.locator('#settings-name').focus();
  await expect(page.locator('#settings-paypal-error')).toContainText('https://paypal.me');
});

test('auth and account forms keep validation beside the field', async ({ page }) => {
  await page.goto('/app');
  await page.locator('#login-email').focus();
  await page.locator('#btn-login-continue').click();
  await expect(page.locator('#login-email-error')).toContainText('Enter your email address');
  await page.locator('#login-email').fill('traveller@example.com');
  await expect(page.locator('#login-email-error')).toBeHidden();

  await page.getByRole('link', { name: 'Create account' }).click();
  await page.locator('#reg-name').focus();
  await page.locator('#reg-email').focus();
  // Empty fields are only flagged on submit, so autofill cannot leave a stale error.
  await expect(page.locator('#reg-name-error')).toBeHidden();
  await page.locator('#reg-pass').fill('short');
  await page.locator('#reg-pass-confirm').focus();
  await expect(page.locator('#reg-pass-error')).toContainText('8+ characters');

  await page.evaluate(() => {
    window._currentUser = { id: 'account-user', email: 'traveller@example.com' };
    window._currentProfile = { display_name: 'Traveller', paypal_link: null };
    openAccountSettings('email');
  });
  await page.locator('#settings-new-email').fill('not-an-email');
  await page.locator('#settings-confirm-email').focus();
  await expect(page.locator('#settings-new-email-error')).toContainText('valid email address');
  await page.locator('#settings-new-email').fill('new@example.com');
  await expect(page.locator('#settings-new-email-error')).toBeHidden();
  await page.locator('#settings-confirm-email').fill('different@example.com');
  await page.locator('#settings-new-email').focus();
  await expect(page.locator('#settings-confirm-email-error')).toContainText('do not match');
  await page.locator('#settings-confirm-email').fill('new@example.com');
  await expect(page.locator('#settings-confirm-email-error')).toBeHidden();
  await page.locator('#settings-new-email').fill('newer@example.com');
  await expect(page.locator('#settings-confirm-email-error')).toContainText('do not match');

  await page.evaluate(() => openAccountSettings('data-delete'));
  await page.locator('#btn-delete-data').click();
  await expect(page.locator('#delete-data-email-error')).toContainText('exactly');
});

test('web entry and separate authentication screens remain interactive', async ({ page }) => {
  await page.getByRole('button', { name: /Continue on web/ }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator('#screen-auth')).toHaveClass(/active/);
  await expect(page.locator('#auth-login-start')).toBeVisible();
  await expect(page.locator('#auth-login')).toBeHidden();
  await page.getByRole('link', { name: 'Create account' }).click();
  await expect(page.locator('#form-register')).toBeVisible();
  await page.getByRole('button', { name: 'Back to login' }).click();
  await page.getByRole('link', { name: 'Continue as guest' }).dispatchEvent('click');
  await expect(page.locator('#auth-guest')).toBeVisible();
  await expect(page.locator('.auth-guest-details')).toContainText('No email or password');
  await expect(page.locator('.auth-guest-details')).toContainText('before changing devices');
  await expect(page.locator('#btn-guest')).toBeVisible();
  await page.getByRole('button', { name: 'Back to login' }).click();
  await expect(page.locator('#auth-login-start')).toBeVisible();
});

test('web login entry uses compact desktop and phone type without shrinking input controls', async ({ page }) => {
  await page.goto('/app');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const sizes = await page.evaluate(() => ({
      intro: parseFloat(getComputedStyle(document.querySelector('.auth-intro h1')).fontSize),
      title: parseFloat(getComputedStyle(document.querySelector('#auth-login-start .auth-mode-title')).fontSize),
      label: parseFloat(getComputedStyle(document.querySelector('#form-login-email label')).fontSize),
      input: parseFloat(getComputedStyle(document.querySelector('#login-email')).fontSize),
      inputHeight: document.querySelector('#login-email').getBoundingClientRect().height,
      buttonHeight: document.querySelector('#btn-login-continue').getBoundingClientRect().height,
      overflows: document.documentElement.scrollWidth > innerWidth,
    }));
    expect(sizes.intro).toBeLessThanOrEqual(68);
    expect(sizes.title).toBeLessThanOrEqual(24);
    expect(sizes.label).toBe(14);
    expect(sizes.input).toBeGreaterThanOrEqual(16);
    expect(sizes.inputHeight).toBeGreaterThanOrEqual(44);
    expect(sizes.buttonHeight).toBeGreaterThanOrEqual(44);
    expect(sizes.overflows).toBe(false);
  }
});

test('auth forms keep email across modes and expose accessible password controls', async ({ page }) => {
  await page.goto('/app');
  await page.locator('#login-email').fill('traveller@example.test');
  await page.locator('#login-email').press('Enter');
  await expect(page.locator('#login-pass')).toBeFocused();
  await page.locator('#login-pass').fill('sample-password');
  await page.locator('[data-password-toggle="login-pass"]').click();
  await expect(page.locator('#login-pass')).toHaveAttribute('type', 'text');
  await expect(page.locator('[data-password-toggle="login-pass"]')).toHaveAttribute('aria-label', 'Hide password');
  await page.getByRole('button', { name: 'Back to email' }).click();
  await page.getByRole('link', { name: 'Create account' }).click();
  await expect(page.locator('#reg-email')).toHaveValue('traveller@example.test');
  await expect(page.locator('#auth-register')).toBeVisible();
  await page.locator('#reg-email').fill('new@example.test');
  await page.locator('#reg-email').press('Enter');
  await expect(page.locator('#reg-pass')).toBeFocused();
  await page.getByRole('button', { name: 'Back to login' }).click();
  await expect(page.locator('#login-email')).toHaveValue('new@example.test');
  await expect(page.locator('#login-pass')).toHaveValue('sample-password');
});

test('email-code login is optional and sends only after explicit confirmation', async ({ page }) => {
  await page.goto('/app');
  await page.clock.install();
  await page.evaluate(() => {
    window.loginCodeCalls = [];
    getAuthCaptchaToken = async () => 'test-token';
    resetAuthTurnstile = () => {};
    db.auth.signInWithOtp = async credentials => {
      window.loginCodeCalls.push(credentials);
      return { data: {}, error: null };
    };
  });
  await page.locator('#login-email').fill('traveller@example.test');
  await page.locator('#btn-login-continue').click();
  await expect(page.locator('#auth-login')).toBeVisible();
  await page.getByRole('button', { name: 'Log in with email code instead' }).click();
  await expect(page.locator('#auth-login-code')).toBeVisible();
  await expect(page.locator('#login-code-email-preview')).toHaveText('traveller@example.test');
  expect(await page.evaluate(() => window.loginCodeCalls.length)).toBe(0);

  await page.getByRole('button', { name: 'Send email code' }).click();
  await expect(page.locator('#login-code-request-status')).toContainText('six-digit code');
  await expect(page.locator('#form-login-code-verify')).toBeVisible();
  await expect(page.locator('#login-code-countdown')).toHaveText('Resend in 60 seconds');
  await expect(page.locator('#btn-resend-login-code')).toBeHidden();
  const request = await page.evaluate(() => window.loginCodeCalls[0]);
  expect(request.email).toBe('traveller@example.test');
  expect(request.options.shouldCreateUser).toBe(false);
  expect(request.options.captchaToken).toBe('test-token');

  await page.clock.runFor(60_000);
  await expect(page.locator('#btn-resend-login-code')).toBeVisible();
  await page.getByRole('button', { name: 'Resend code' }).click();
  await expect(page.locator('#login-code-request-status')).toContainText('A new email');
  expect(await page.evaluate(() => window.loginCodeCalls.length)).toBe(2);

  await page.getByRole('button', { name: 'Back to password login' }).click();
  await expect(page.locator('#auth-login')).toBeVisible();
  await expect(page.locator('#login-email')).toHaveValue('traveller@example.test');
});

test('email code accepts compact or hyphenated input and verifies the six raw digits', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/app');
  await page.evaluate(() => {
    getAuthCaptchaToken = async () => 'test-token';
    resetAuthTurnstile = () => {};
    db.auth.signInWithOtp = async () => ({ data: {}, error: null });
    window.verifyCodeCalls = [];
    db.auth.verifyOtp = async credentials => {
      window.verifyCodeCalls.push(credentials);
      return { data: { session: { access_token: 'session-token' } }, error: null };
    };
  });
  await page.locator('#login-email').fill('traveller@example.test');
  await page.locator('#btn-login-continue').click();
  await page.getByRole('button', { name: 'Log in with email code instead' }).click();
  await page.getByRole('button', { name: 'Send email code' }).click();

  await page.locator('#login-code').fill('123456');
  await expect(page.locator('#login-code')).toHaveValue('123-456');
  await expect(page.locator('.login-code-boxes span')).toHaveText(['1', '2', '3', '4', '5', '6']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.getByRole('button', { name: 'Verify and log in' }).click();
  const verification = await page.evaluate(() => window.verifyCodeCalls[0]);
  expect(verification).toEqual({ email: 'traveller@example.test', token: '123456', type: 'email' });
});

test('email code shows safe errors for incomplete and rejected codes', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    getAuthCaptchaToken = async () => 'test-token';
    resetAuthTurnstile = () => {};
    db.auth.signInWithOtp = async () => ({ data: {}, error: null });
    db.auth.verifyOtp = async () => ({
      data: { session: null },
      error: { message: 'Token has expired or is invalid' },
    });
  });
  await page.locator('#login-email').fill('traveller@example.test');
  await page.locator('#btn-login-continue').click();
  await page.getByRole('button', { name: 'Log in with email code instead' }).click();
  await page.getByRole('button', { name: 'Send email code' }).click();

  await page.locator('#login-code').fill('123');
  await page.getByRole('button', { name: 'Verify and log in' }).click();
  await expect(page.locator('#login-code-error')).toContainText('Enter all six digits');
  await page.locator('#login-code').fill('123-456');
  await page.getByRole('button', { name: 'Verify and log in' }).click();
  await expect(page.locator('#login-code-error')).toContainText('expired');
});

test('signup rejects an all-numeric password even when it is eight characters long', async ({ page }) => {
  await page.goto('/app');
  await page.getByRole('link', { name: 'Create account' }).click();
  await page.locator('#reg-name').fill('Test Traveller');
  await page.locator('#reg-email').fill('traveller@example.test');
  await page.locator('#reg-pass').fill('12345678');
  await page.locator('#reg-pass-confirm').fill('12345678');
  await page.locator('#reg-terms').check();
  await page.locator('#btn-register').click();
  await expect(page.locator('#reg-pass-error')).toContainText('with a letter and number');
  await expect(page.locator('#reg-pass')).toHaveAttribute('aria-invalid', 'true');
});

test('auth entry places social options before email and keeps touch controls usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  const positions = await page.evaluate(() =>
    [
      '#social-login .social-login-buttons',
      '.auth-divider',
      '#login-email',
      '#btn-login-continue',
      '.auth-entry-actions',
    ].map(selector => document.querySelector(selector).getBoundingClientRect().top),
  );
  expect(positions).toEqual([...positions].sort((a, b) => a - b));
  for (const selector of ['#login-email', '#btn-login-continue', '.auth-entry-actions a']) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box.height, selector).toBeGreaterThanOrEqual(44);
  }
});

test('auth bot protection waits for user interaction without shifting the form', async ({ page }) => {
  const turnstileUrl = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  let requests = 0;
  page.on('request', request => {
    if (request.url().startsWith(turnstileUrl)) requests += 1;
  });
  await page.goto('/app');
  await page.waitForTimeout(250);
  expect(requests).toBe(0);

  const before = await page.locator('#btn-login-continue').boundingBox();
  await page.locator('#login-email').focus();
  await expect.poll(() => requests).toBe(1);
  const after = await page.locator('#btn-login-continue').boundingBox();
  expect(Math.abs(after.y - before.y)).toBeLessThan(1);
});

test('login stays disabled during CAPTCHA and reports a privacy-safe credentials error', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    window.loginCalls = 0;
    getAuthCaptchaToken = () =>
      new Promise(resolve => {
        window.releaseLoginCaptcha = resolve;
      });
    resetAuthTurnstile = () => {};
    db.auth.signInWithPassword = async () => {
      window.loginCalls += 1;
      return { error: { message: 'Invalid login credentials' } };
    };
  });
  await page.locator('#login-email').fill('unknown@example.test');
  await page.locator('#btn-login-continue').click();
  await page.locator('#login-pass').fill('wrong-password');
  await page.locator('#btn-login').click();
  await expect(page.locator('#btn-login')).toBeDisabled();
  await expect(page.locator('#btn-login')).toHaveClass(/loading/);
  await page.evaluate(() =>
    document.getElementById('form-login').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await page.evaluate(() => window.releaseLoginCaptcha('test-token'));
  await expect(page.locator('#toast')).toContainText('That email or password is not right');
  expect(await page.evaluate(() => window.loginCalls)).toBe(1);
  await expect(page.locator('#btn-login')).toBeEnabled();
});

test('signup cannot send a second request while CAPTCHA is pending', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    window.signupCalls = 0;
    getAuthCaptchaToken = () =>
      new Promise(resolve => {
        window.releaseSignupCaptcha = resolve;
      });
    resetAuthTurnstile = () => {};
    db.auth.signUp = async () => {
      window.signupCalls += 1;
      return { data: { user: { id: 'new-user' }, session: null }, error: null };
    };
  });
  await page.getByRole('link', { name: 'Create account' }).click();
  await page.locator('#reg-name').fill('Test Traveller');
  await page.locator('#reg-email').fill('new@example.test');
  await page.locator('#reg-pass').fill('abcdefgh1');
  await page.locator('#reg-pass-confirm').fill('abcdefgh1');
  await page.locator('#reg-terms').check();
  await page.locator('#btn-register').click();
  await expect(page.locator('#btn-register')).toBeDisabled();
  await page.evaluate(() =>
    document.getElementById('form-register').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
  await page.evaluate(() => window.releaseSignupCaptcha('test-token'));
  await expect(page.locator('#register-confirmation')).toBeVisible();
  expect(await page.evaluate(() => window.signupCalls)).toBe(1);
});

test('password reset gives the same confirmation without revealing an account', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    getAuthCaptchaToken = async () => 'test-token';
    resetAuthTurnstile = () => {};
    db.auth.resetPasswordForEmail = async () => ({ error: null });
  });
  await page.locator('#login-email').fill('someone@example.test');
  await page.locator('#btn-login-continue').click();
  await page.locator('.auth-forgot').click();
  await expect(page.locator('#forgot-email')).toHaveValue('someone@example.test');
  await page.locator('#btn-forgot-password').click();
  await expect(page.locator('#toast')).toContainText('If an account exists for this email');
});

test('password reset hides account-existence errors returned by the provider', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    getAuthCaptchaToken = async () => 'test-token';
    resetAuthTurnstile = () => {};
    db.auth.resetPasswordForEmail = async () => ({ error: { code: 'user_not_found', message: 'User not found' } });
  });
  await page.locator('#login-email').fill('unknown@example.test');
  await page.locator('#btn-login-continue').click();
  await page.locator('.auth-forgot').click();
  await page.locator('#forgot-email').fill('unknown@example.test');
  await page.locator('#btn-forgot-password').click();
  await expect(page.locator('#toast')).toContainText('If an account exists for this email');
  await expect(page.locator('#toast')).not.toContainText('not found');
});

test('registration offers confirmation by six-digit code', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    getAuthCaptchaToken = async () => 'test-token';
    resetAuthTurnstile = () => {};
    db.auth.signUp = async credentials => {
      window._testSignupRedirect = credentials.options.emailRedirectTo;
      return { data: { user: { id: 'new-user' }, session: null }, error: null };
    };
  });
  await page.getByRole('link', { name: 'Create account' }).click();
  await page.locator('#reg-name').fill('Test Traveller');
  await page.locator('#reg-email').fill('new@example.com');
  await page.locator('#reg-pass').fill('abcdefgh1');
  await page.locator('#reg-pass-confirm').fill('abcdefgh1');
  await page.locator('#reg-terms').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.locator('#register-confirmation')).toBeVisible();
  await expect(page.locator('#form-register')).toBeHidden();
  await expect(page.locator('#register-code-email-preview')).toHaveText('new@example.com');
  await expect(page.locator('#register-confirmation')).not.toContainText('confirmation link');
  await expect(page.locator('#register-code')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Go to login' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use another email' })).toBeVisible();
  await page.getByRole('button', { name: 'Go to login' }).click();
  await expect(page.locator('#login-email')).toHaveValue('new@example.com');
  expect(await page.evaluate(() => window._testSignupRedirect)).toBeUndefined(); // Local origin has no production redirect.
});

test('signup code formats, verifies, and resends without creating another account', async ({ page }) => {
  await page.goto('/app');
  await page.clock.install();
  await page.evaluate(() => {
    getAuthCaptchaToken = async () => 'test-token';
    resetAuthTurnstile = () => {};
    db.auth.signUp = async () => ({ data: { user: { id: 'new-user' }, session: null }, error: null });
    window.signupVerifyCalls = [];
    window.signupResendCalls = [];
    db.auth.verifyOtp = async credentials => {
      window.signupVerifyCalls.push(credentials);
      return { data: { session: { access_token: 'signup-session' } }, error: null };
    };
    db.auth.resend = async credentials => {
      window.signupResendCalls.push(credentials);
      return { data: {}, error: null };
    };
  });
  await page.getByRole('link', { name: 'Create account' }).click();
  await page.locator('#reg-name').fill('Test Traveller');
  await page.locator('#reg-email').fill('new@example.test');
  await page.locator('#reg-pass').fill('abcdefgh1');
  await page.locator('#reg-pass-confirm').fill('abcdefgh1');
  await page.locator('#reg-terms').check();
  await page.locator('#btn-register').click();

  await page.clock.runFor(60_000);
  await expect(page.locator('#btn-resend-register-code')).toBeVisible();
  await page.locator('#btn-resend-register-code').click();
  const resend = await page.evaluate(() => window.signupResendCalls[0]);
  expect(resend.type).toBe('signup');
  expect(resend.email).toBe('new@example.test');
  expect(resend.options.captchaToken).toBe('test-token');

  await page.locator('#register-code').fill('654321');
  await expect(page.locator('#register-code')).toHaveValue('654-321');
  await expect(page.locator('.signup-code-boxes span')).toHaveText(['6', '5', '4', '3', '2', '1']);
  await page.locator('#btn-verify-register-code').click();
  expect(await page.evaluate(() => window.signupVerifyCalls[0])).toEqual({
    email: 'new@example.test',
    token: '654321',
    type: 'signup',
  });
});

test('confirmed signup shows a clear one-time signed-in message', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    history.replaceState(null, '', '/app?intent=signup&code=verified-once');
    showSignupConfirmationIfNeeded({ email_confirmed_at: '2026-09-20T00:00:00Z' });
  });

  const confirmation = page.locator('#modal-email-confirmed');
  await expect(confirmation).toHaveClass(/open/);
  await expect(confirmation).toContainText('Email confirmed');
  await expect(confirmation).toContainText('You’re signed in');
  await expect(page).toHaveURL(/\/app$/);
  await confirmation.getByRole('button', { name: 'Continue to TripCash' }).click();
  await expect(confirmation).not.toHaveClass(/open/);
});

test('fresh signup confirmation survives a callback that loses its intent parameter', async ({ page }) => {
  await page.goto('/app?code=verified-once');
  await page.evaluate(() => {
    const now = new Date().toISOString();
    history.replaceState(null, '', '/app'); // Supabase removes the PKCE code first.
    showSignupConfirmationIfNeeded({ created_at: now, email_confirmed_at: now });
  });

  const confirmation = page.locator('#modal-email-confirmed');
  await expect(confirmation).toHaveClass(/open/);
  await expect(confirmation).toContainText('You’re signed in');
  await expect(page).toHaveURL(/\/app$/);
  await confirmation.getByRole('button', { name: 'Continue to TripCash' }).click();
  const repeated = await page.evaluate(() => {
    const now = new Date().toISOString();
    return showSignupConfirmationIfNeeded({ created_at: now, email_confirmed_at: now });
  });
  expect(repeated).toBe(false);
  await expect(confirmation).not.toHaveClass(/open/);
});

test('an older account callback is not mistaken for a new signup', async ({ page }) => {
  await page.goto('/app?code=another-callback');
  const showedConfirmation = await page.evaluate(() => {
    history.replaceState(null, '', '/app');
    return showSignupConfirmationIfNeeded({
      created_at: '2026-01-01T00:00:00Z',
      email_confirmed_at: new Date().toISOString(),
    });
  });

  expect(showedConfirmation).toBe(false);
  await expect(page.locator('#modal-email-confirmed')).not.toHaveClass(/open/);
});

test('registration explains an existing or pending account instead of a generic auth failure', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    getAuthCaptchaToken = async () => 'test-token';
    resetAuthTurnstile = () => {};
    db.auth.signUp = async () => ({ data: null, error: { message: 'User already registered' } });
  });
  await page.getByRole('link', { name: 'Create account' }).click();
  await page.locator('#reg-name').fill('Test Traveller');
  await page.locator('#reg-email').fill('existing@example.com');
  await page.locator('#reg-pass').fill('StrongPassword12');
  await page.locator('#reg-pass-confirm').fill('StrongPassword12');
  await page.locator('#reg-terms').check();
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page.locator('#register-feedback')).toBeVisible();
  await expect(page.locator('#register-feedback')).toBeFocused();
  await expect(page.locator('#form-register')).toBeVisible();
  await expect(page.locator('#register-feedback-title')).toHaveText('Signup needs attention');
  await expect(page.locator('#register-status')).toContainText(
    'may already have an account or be awaiting confirmation',
  );
  await expect(page.locator('#register-status')).not.toContainText('Authentication failed');
});

test('profile visibly exposes account lifecycle controls and opens the requested section', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    window._currentUser = {
      id: 'profile-user',
      email: 'traveller@example.com',
      app_metadata: { providers: ['email'] },
    };
    window._currentProfile = { display_name: 'Test Traveller', paypal_link: '' };
    renderProfileScreen();
    showScreen('profile');
  });

  const profile = page.locator('#profile-content');
  await expect(page.locator('#screen-profile > .profile-header')).toBeHidden();
  await expect(profile.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();
  await expect(profile.locator('.settings-group')).toHaveCount(5);
  await expect(profile.locator('.settings-group > h2')).toHaveText([
    'Personal',
    'Preferences',
    'Security',
    'Support & Legal',
    'Account actions',
  ]);
  await expect(profile.getByRole('button', { name: /Change email/ })).toBeVisible();
  await expect(profile.getByRole('button', { name: /Export my data/ })).toBeVisible();
  await expect(profile.getByRole('button', { name: /Delete my data/ })).toBeVisible();
  await expect(profile.getByRole('button', { name: /Delete account/ })).toBeVisible();
  await expect(profile.getByRole('button', { name: 'Help & support' })).toBeVisible();
  await expect(profile.getByRole('link', { name: 'Privacy policy' })).toHaveCount(0);

  await profile.getByRole('button', { name: 'Privacy policy' }).click();
  const legalDialog = page.locator('#landing-legal-dialog');
  await expect(legalDialog).toBeVisible();
  await expect(legalDialog.locator('#landing-legal-title')).toHaveText('Privacy Policy');
  await legalDialog.getByRole('button', { name: 'Close' }).click();
  await expect(legalDialog).not.toBeVisible();
  await expect(profile.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();

  await profile.getByRole('button', { name: 'Help & support' }).click();
  await expect(legalDialog.locator('a[href="mailto:support@tripcash.de"]')).toBeVisible();
  await legalDialog.getByRole('link', { name: 'account-deletion request page' }).click();
  await expect(legalDialog.locator('#landing-legal-title')).toHaveText('Delete Your Account');
  await legalDialog.getByRole('button', { name: 'Close' }).click();
  await expect(legalDialog).not.toBeVisible();
  await expect(profile.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible();

  await profile.locator('[data-section="email"]').click();
  await expect(page.locator('#modal-account')).toHaveClass(/open/);
  await expect(page.locator('#account-modal-title')).toHaveText('Change email');
  await expect(page.locator('#settings-profile')).toBeHidden();
  await expect(page.locator('#settings-security')).toBeVisible();
  await expect(page.locator('#settings-data-delete')).toBeHidden();
  await expect(page.locator('#settings-close')).toBeHidden();
  await expect(page.locator('#settings-new-email')).toBeFocused();

  await page.locator('#modal-account [data-action="close-modal"]').click();
  await profile.locator('[data-section="data-delete"]').click();
  await expect(page.locator('#account-modal-title')).toHaveText('Delete my data');
  await expect(page.locator('#settings-profile')).toBeHidden();
  await expect(page.locator('#settings-security')).toBeHidden();
  await expect(page.locator('#settings-data-delete')).toBeVisible();
  await expect(page.locator('#settings-close')).toBeHidden();
  await expect(page.locator('#delete-data-email')).toBeFocused();

  await page.locator('#modal-account [data-action="close-modal"]').click();
  await profile.locator('[data-section="account-delete"]').click();
  await expect(page.locator('#account-modal-title')).toHaveText('Delete account');
  await expect(page.locator('#settings-profile')).toBeHidden();
  await expect(page.locator('#settings-security')).toBeHidden();
  await expect(page.locator('#settings-data-delete')).toBeHidden();
  await expect(page.locator('#settings-close')).toBeVisible();
  await expect(page.locator('#delete-account-email')).toBeFocused();

  await page.locator('#modal-account [data-action="close-modal"]').click();
  await profile.locator('[data-section="profile"]').click();
  await expect(page.locator('#account-modal-title')).toHaveText('Personal details');
  await expect(page.locator('#settings-profile')).toBeVisible();
  await expect(page.locator('#settings-security')).toBeHidden();
  await expect(page.locator('#settings-data-delete')).toBeHidden();
  await expect(page.locator('#settings-close')).toBeHidden();
  await expect(page.locator('#settings-name')).toBeFocused();
});

test('native account deletion uses Capacitor HTTP with authentication and origin', async ({ page }) => {
  await page.goto('/app');
  const result = await page.evaluate(async () => {
    window._tcAccessToken = 'native-access-token';
    window.__nativeAccountClosureRequests = [];
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: {
        CapacitorHttp: {
          post: async options => {
            window.__nativeAccountClosureRequests.push(options);
            return { status: 200, data: JSON.stringify({ deleted: true }) };
          },
        },
      },
    };
    const response = await requestAccountClosure({ confirmationEmail: 'traveller@example.com' });
    return { response, request: window.__nativeAccountClosureRequests[0] };
  });

  expect(result.response).toEqual({ ok: true, status: 200, data: { deleted: true } });
  expect(result.request.url).toBe('https://tripcash.de/api/account-closure');
  expect(result.request.headers.Authorization).toBe('Bearer native-access-token');
  expect(result.request.headers.Origin).toBe('capacitor://localhost');
  expect(result.request.data).toEqual({ confirmationEmail: 'traveller@example.com' });
  expect(result.request.responseType).toBe('text');
});

test('native account deletion preserves a server error and hides non-JSON gateway text', async ({ page }) => {
  await page.goto('/app');
  const results = await page.evaluate(async () => {
    window.Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'ios',
      Plugins: { CapacitorHttp: { post: async () => ({ status: 401, data: '{"error":"Please sign in again."}' }) } },
    };
    const serverError = await requestAccountClosure({});
    window.Capacitor.Plugins.CapacitorHttp.post = async () => ({ status: 502, data: 'The upstream service failed.' });
    const gatewayError = await requestAccountClosure({});
    return { serverError, gatewayError };
  });

  expect(results.serverError).toEqual({ ok: false, status: 401, data: { error: 'Please sign in again.' } });
  expect(results.gatewayError).toEqual({
    ok: false,
    status: 502,
    data: {
      error:
        'TripCash couldn’t finish deleting your account right now. Please try again in a few minutes. If it keeps happening, contact support@tripcash.de.',
    },
  });
});

test('web account deletion explains an unreadable gateway error', async ({ page }) => {
  await page.route('**/api/account-closure', route =>
    route.fulfill({
      status: 502,
      contentType: 'text/html',
      body: '<html><body>Bad gateway</body></html>',
    }),
  );
  await page.goto('/app');
  const gateway = await page.evaluate(() => requestAccountClosure({}));
  expect(gateway).toEqual({
    ok: false,
    status: 502,
    data: {
      error:
        'TripCash couldn’t finish deleting your account right now. Please try again in a few minutes. If it keeps happening, contact support@tripcash.de.',
    },
  });
});

test('login password error clears after silent autofill and is not shown on blur', async ({ page }) => {
  await page.goto('/app');
  await page.locator('#login-email').fill('traveller@example.com');
  await page.locator('#btn-login-continue').click();
  await page.locator('#login-pass').focus();
  await page.locator('#login-email').focus();
  await expect(page.locator('#login-pass-error')).toBeHidden();

  await page.evaluate(() => {
    getAuthCaptchaToken = async () => '';
  });
  await page.locator('#btn-login').click();
  await expect(page.locator('#login-pass-error')).toContainText('Enter your password');

  // Password managers can fill the field without an input event; the autofill
  // animation is the only signal.
  await page.evaluate(() => {
    const input = document.getElementById('login-pass');
    input.value = 'autofilled-secret';
    input.dispatchEvent(new AnimationEvent('animationstart', { animationName: 'tc-autofill', bubbles: true }));
  });
  await expect(page.locator('#login-pass-error')).toBeHidden();
});

test('blocked bot protection tells the user how to fix it', async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', route =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.turnstile = {
      // Fire twice, as Turnstile does when it retries automatically.
      render: (_, options) => {
        setTimeout(() => { options['error-callback']?.(); options['error-callback']?.(); }, 0);
        return 'widget';
      },
      getResponse: () => '',
      reset: () => {},
      remove: () => {},
    };`,
    }),
  );
  await page.goto('/app');
  await page.locator('#login-email').fill('traveller@example.com');
  await page.locator('#btn-login-continue').click();
  await page.locator('#login-pass').fill('a-password');
  await page.locator('#btn-login').click();
  // The fix stays on screen under the check instead of in a brief toast, once.
  const note = page.locator('#auth-turnstile-login .auth-turnstile-error');
  await expect(note).toHaveCount(1);
  await expect(note).toContainText(
    'If you use an ad or privacy blocker, allow tripcash.de and challenges.cloudflare.com',
  );
  await expect(page.locator('#toast')).toContainText('See the note on the form');
  await page.waitForTimeout(3200);
  await expect(note).toBeVisible();
});

test('stale social session is sent to sign in again and deletion reopens afterwards', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    window._currentUser = {
      id: 'google-user',
      email: 'traveller@gmail.com',
      app_metadata: { provider: 'google', providers: ['google'] },
      identities: [{ provider: 'google', identity_data: { sub: 'google-sub' } }],
    };
    window._currentProfile = { display_name: 'Google Traveller', paypal_link: '' };
    window.appConfirm = async () => true;
    window.requestAccountClosure = async () => ({
      ok: false,
      status: 403,
      data: { error: 'Sign in again before deleting your account.', code: 'reauthentication_required' },
    });
    db.auth.signOut = async options => {
      sessionStorage.setItem('test-sign-out-scope', options?.scope || '');
    };
    openAccountSettings('account-delete');
    document.getElementById('delete-account-email').value = 'traveller@gmail.com';
  });

  await Promise.all([
    page.waitForEvent('load'),
    page.evaluate(() => {
      void deleteAccount();
    }),
  ]);
  expect(
    await page.evaluate(() => ({
      pending: sessionStorage.getItem('pending_account_delete'),
      signOutScope: sessionStorage.getItem('test-sign-out-scope'),
    })),
  ).toEqual({ pending: 'google-user', signOutScope: 'local' });

  const resumed = await page.evaluate(() => {
    window._currentUser = { id: 'google-user', email: 'traveller@gmail.com', identities: [{ provider: 'google' }] };
    return {
      resumed: resumePendingAccountDeletion(window._currentUser),
      pending: sessionStorage.getItem('pending_account_delete'),
    };
  });
  expect(resumed).toEqual({ resumed: true, pending: null });
  await expect(page.locator('#account-modal-title')).toHaveText('Delete account');
  await expect(page.locator('#settings-close')).toBeVisible();
});

test('pending deletion never reopens for a different account', async ({ page }) => {
  await page.goto('/app');
  const result = await page.evaluate(() => {
    sessionStorage.setItem('pending_account_delete', 'google-user');
    return {
      resumed: resumePendingAccountDeletion({ id: 'someone-else' }),
      pending: sessionStorage.getItem('pending_account_delete'),
    };
  });
  expect(result).toEqual({ resumed: false, pending: null });
  await expect(page.locator('#modal-account')).not.toBeVisible();
});

test('Apple accounts delete without typing their relay email on the web', async ({ page }) => {
  await page.goto('/app');
  const request = await page.evaluate(async () => {
    window._currentUser = {
      id: 'apple-user',
      email: 'x7k2p9@privaterelay.appleid.com',
      identities: [{ provider: 'apple', identity_data: { sub: 'apple-subject' } }],
    };
    window._currentProfile = { display_name: 'Apple Traveller', paypal_link: '' };
    openAccountSettings('account-delete');
    window.appConfirm = async () => true;
    window.__closureRequests = [];
    window.requestAccountClosure = async data => {
      window.__closureRequests.push(data);
      return { ok: false, status: 502, data: { error: 'Stop before sign-out.' } };
    };
    await deleteAccount();
    return {
      emailFieldHidden: document.getElementById('delete-account-email-group').hidden,
      appleNoteHidden: document.getElementById('delete-account-apple-confirmation').hidden,
      body: window.__closureRequests[0],
    };
  });
  expect(request).toEqual({ emailFieldHidden: true, appleNoteHidden: false, body: {} });
});

test('profile settings use full-width grouped rows in light and dark modes', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    window._currentUser = {
      id: 'profile-visual-user',
      email: 'traveller@example.com',
      app_metadata: { providers: ['email'] },
    };
    window._currentProfile = { display_name: 'Test Traveller', paypal_link: '' };
    renderProfileScreen();
    showScreen('profile');
  });

  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => applyTheme(value), theme);
    for (const width of [390, 900]) {
      await page.setViewportSize({ width, height: 844 });
      const layout = await page.locator('#profile-content').evaluate(content => {
        const grid = content.querySelector('.profile-grid');
        const groups = [...grid.querySelectorAll('.settings-group')];
        const rows = [
          ...grid.querySelectorAll(
            '.settings-group > button, .settings-group > a, .settings-select-row, .settings-static-row',
          ),
        ];
        return {
          contentWidth: content.getBoundingClientRect().width,
          gridWidth: grid.getBoundingClientRect().width,
          groupWidths: groups.map(group => group.getBoundingClientRect().width),
          rowHeights: rows.map(row => row.getBoundingClientRect().height),
          bottomPadding: parseFloat(getComputedStyle(content).paddingBottom),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(layout.overflow).toBe(false);
      expect(layout.contentWidth).toBeLessThanOrEqual(760);
      expect(layout.groupWidths.every(value => Math.abs(value - layout.gridWidth) < 1)).toBe(true);
      expect(Math.min(...layout.rowHeights)).toBeGreaterThanOrEqual(56);
      expect(layout.bottomPadding).toBeGreaterThanOrEqual(112);
    }
  }
  const colors = await page.evaluate(() => ({
    normal: getComputedStyle(document.querySelector('[data-action="handle-logout"]')).color,
    destructive: getComputedStyle(document.querySelector('[data-section="account-delete"]')).color,
  }));
  expect(colors.destructive).not.toBe(colors.normal);
});

test('profile omits version details and hides unavailable guest actions', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    window.Capacitor = {
      getPlatform: () => 'ios',
      Plugins: { App: { getInfo: async () => ({ version: '1.0.1', build: '1' }) } },
    };
    window._currentUser = {
      id: 'native-profile-user',
      email: 'traveller@example.com',
      app_metadata: { providers: ['email'] },
    };
    window._currentProfile = { display_name: 'Test Traveller', paypal_link: '' };
    renderProfileScreen();
    showScreen('profile');
  });
  await expect(page.locator('#profile-version-value')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Visit our website' })).toHaveAttribute('href', 'https://tripcash.de/');

  await page.evaluate(() => {
    window.Capacitor = { getPlatform: () => 'web', Plugins: {} };
    window._currentUser = { id: 'guest-profile-user', is_anonymous: true, app_metadata: {} };
    window._currentProfile = { display_name: 'Guest Traveller', paypal_link: '' };
    currentTrip = null;
    renderProfileScreen();
  });
  await expect(page.locator('[data-profile-section="security"]')).toHaveCount(0);
  await expect(page.locator('[data-section="data-delete"], [data-section="account-delete"]')).toHaveCount(0);
  await expect(page.locator('[data-action="export-csv"]')).toHaveCount(0);
  await expect(page.locator('#profile-content [data-action="handle-logout"]')).toBeVisible();
  await expect(page.locator('#profile-version-value')).toHaveCount(0);
});

test('logout requires explicit confirmation before ending the session', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    window._currentUser = { id: 'logout-user', email: 'traveller@example.com', app_metadata: { providers: ['email'] } };
    window._currentProfile = { display_name: 'Test Traveller', paypal_link: '' };
    window.logoutCalls = 0;
    db.auth.signOut = async () => {
      window.logoutCalls += 1;
      return { error: null };
    };
    renderProfileScreen();
    showScreen('profile');
  });

  const logout = page.locator('#profile-content [data-action="handle-logout"]');
  await logout.click();
  await expect(page.locator('#confirm-title')).toHaveText('Log out?');
  await expect(page.locator('#confirm-message')).toHaveText('Are you sure you want to log out?');
  expect(await page.evaluate(() => window.logoutCalls)).toBe(0);
  await page.locator('#modal-confirm [data-action="resolve-confirm"][data-value="false"]').first().click();
  expect(await page.evaluate(() => window.logoutCalls)).toBe(0);

  await logout.click();
  await page.locator('#confirm-ok').click();
  await expect.poll(() => page.evaluate(() => window.logoutCalls)).toBe(1);
});

test('desktop web analytics keeps one clear page title below the main navigation', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    window._currentUser = { id: 'analytics-user', email: 'traveller@example.com' };
    loadedTrips = [
      {
        id: 'active-trip',
        name: 'Active Trip',
        status: 'active',
        start_date: '2020-01-01',
        currency: 'EUR',
        _total: 10,
        _expenseCount: 1,
      },
      {
        id: 'upcoming-trip',
        name: 'Upcoming Trip',
        status: 'active',
        start_date: '2999-01-01',
        currency: 'EUR',
        _total: 20,
        _expenseCount: 0,
      },
      {
        id: 'ended-trip',
        name: 'Ended Trip',
        status: 'ended',
        start_date: '2019-01-01',
        currency: 'EUR',
        _total: 30,
        _expenseCount: 1,
      },
    ];
    renderGlobalAnalyticsScreen();
    showScreen('global-analytics');
  });

  const analytics = page.locator('#screen-global-analytics');
  await expect(analytics.locator('.global-analytics-header')).toBeHidden();
  await expect(analytics.getByRole('heading', { name: 'Your travel spending' })).toBeVisible();
  await expect(analytics.locator('.ov-tile').filter({ hasText: 'Active' }).locator('.ov-tile-val')).toHaveText('1');
  await expect(analytics.locator('.global-trip-row').filter({ hasText: 'Upcoming Trip' })).toContainText(
    'Upcoming · 0 expenses',
  );
});

test('native iOS pull-to-refresh accepts a harder pull anywhere without ordinary-scroll refreshes', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.Capacitor = { getPlatform: () => 'ios', isNativePlatform: () => true, Plugins: {} };
    configureNativeShell();
    window._currentUser = { id: 'refresh-user', email: 'refresh@example.com' };
    window._currentProfile = { display_name: 'Refresh Traveller' };
    window.__nativeRefreshCalls = 0;
    syncPendingOfflineChanges = async () => ({ synced: 0, remaining: 0 });
    refreshTrips = async () => {
      window.__nativeRefreshCalls += 1;
    };
    showScreen('trips');
    configureNativePullToRefresh();
    document.body.style.minHeight = '2000px';
    window.scrollTo(0, 100);
    handleNativeRefreshTouchStart({
      target: document.body,
      timeStamp: 1000,
      touches: [{ clientX: 20, clientY: 300 }],
    });
    handleNativeRefreshTouchMove({
      timeStamp: 1350,
      touches: [{ clientX: 22, clientY: 440 }],
    });
  });

  await expect(page.locator('html')).toHaveClass(/native-ios/);
  await expect(page.locator('#native-refresh-indicator')).not.toHaveClass(/is-ready/);
  await page.evaluate(() => handleNativeRefreshTouchEnd());
  await expect.poll(() => page.evaluate(() => window.__nativeRefreshCalls)).toBe(0);

  await page.evaluate(() => {
    handleNativeRefreshTouchStart({
      target: document.body,
      timeStamp: 2000,
      touches: [{ clientX: 20, clientY: 300 }],
    });
    handleNativeRefreshTouchMove({
      timeStamp: 2360,
      touches: [{ clientX: 22, clientY: 500 }],
    });
  });

  await expect(page.locator('#native-refresh-indicator')).toHaveClass(/is-ready/);
  await expect(page.locator('#native-refresh-label')).toHaveText('Release to refresh');

  await page.evaluate(() => handleNativeRefreshTouchEnd());
  await expect.poll(() => page.evaluate(() => window.__nativeRefreshCalls)).toBe(1);
  await expect(page.locator('#toast')).toContainText('Up to date');
});

test('long messages wrap inside a phone screen and stay up long enough to read', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  await page.evaluate(() =>
    showToast('Unable to use this address. If you already have an account, log in or reset its password.', 'error'),
  );
  const toast = page.locator('#toast');
  await expect(toast).toHaveClass(/show/);
  const box = await toast.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(16);
  expect(box.x + box.width).toBeLessThanOrEqual(390 - 16);
  expect(box.height).toBeGreaterThan(40);
  // Still showing after the old 2.8 s limit, gone by the 7 s cap.
  await page.waitForTimeout(3500);
  await expect(toast).toHaveClass(/show/);
  await expect(toast).not.toHaveClass(/show/, { timeout: 4000 });

  await page.evaluate(() => showToast('Saved.', 'ok'));
  const short = await page.locator('#toast').boundingBox();
  expect(short.height).toBeLessThan(44);
});

test('login Back button sits in line with the logo and reads Back', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app');
  const back = page.locator('.auth-back');
  await expect(back).toBeVisible();
  await expect(back).toContainText('Back');
  await expect(back).toHaveAccessibleName('Back');
  const [backBox, logoBox] = await Promise.all([
    back.boundingBox(),
    page.locator('.auth-card .auth-logo').boundingBox(),
  ]);
  // The chevron (after the button's 8 px padding) lines up with the logo's left edge.
  expect(Math.abs(backBox.x + 8 - logoBox.x)).toBeLessThanOrEqual(2);
  expect(backBox.y + backBox.height).toBeLessThanOrEqual(logoBox.y + 1);
  expect(backBox.height).toBeGreaterThanOrEqual(44);
});

test('direct app entry starts with an accessible, stable authentication layout', async ({ page }) => {
  await page.goto('/app');
  await expect(page.locator('body')).toHaveAttribute('data-screen', 'auth');
  await expect(page.getByRole('main')).toBeVisible();
  await expect(page.locator('#auth-turnstile-login')).toBeAttached();
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.locator('#auth-turnstile-login')).toHaveCSS('min-height', '65px');
});

test('authentication remains vertically scrollable on a short phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 520 });
  await page.goto('/app');
  await page.getByRole('link', { name: 'Create account' }).click();

  const layout = await page.locator('#screen-auth').evaluate(screen => ({
    clientHeight: screen.clientHeight,
    scrollHeight: screen.scrollHeight,
    overflowY: getComputedStyle(screen).overflowY,
  }));
  expect(layout.overflowY).toBe('auto');
  expect(layout.scrollHeight).toBeGreaterThan(layout.clientHeight);

  await page.locator('#screen-auth').evaluate(screen => {
    screen.scrollTop = screen.scrollHeight;
  });
  await expect(page.locator('#btn-register')).toBeInViewport();
});

test('configured social providers appear for login and stay hidden in guest mode', async ({ page }) => {
  await page.route('https://*.supabase.co/auth/v1/settings', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ external: { apple: true, google: true } }),
    }),
  );
  await page.reload();
  await page.getByRole('button', { name: /Continue on web/ }).click();
  await expect(page.getByRole('button', { name: 'Continue with Apple' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  // Social sign-in shows an age and Terms notice under its buttons instead of a checkbox.
  const notice = page.locator('#social-login .social-terms-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('By continuing with Apple or Google, you confirm that you are at least 16');
  await expect(page.locator('#social-terms')).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const buttons = document.querySelector('#social-login .social-login-buttons');
      const text = document.getElementById('social-terms-notice');
      return Boolean(buttons.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING);
    }),
  ).toBe(true);
  await page.getByRole('link', { name: 'Continue as guest' }).dispatchEvent('click');
  await expect(page.locator('#social-login')).toBeHidden();
});

test('Apple accounts without a visible email are not classified as guests', async ({ page }) => {
  await page.goto('/app');
  const classification = await page.evaluate(() => ({
    apple: isAnonymousAuthUser({
      id: 'apple-user',
      email: null,
      is_anonymous: false,
      app_metadata: { provider: 'apple' },
      identities: [{ provider: 'apple' }],
    }),
    guest: isAnonymousAuthUser({
      id: 'guest-user',
      email: null,
      is_anonymous: true,
      app_metadata: { provider: 'anonymous' },
      identities: [],
    }),
  }));

  expect(classification).toEqual({ apple: false, guest: true });

  await page.evaluate(() => {
    window._currentUser = {
      id: 'apple-user',
      email: null,
      is_anonymous: false,
      app_metadata: { provider: 'apple', providers: ['apple'] },
      identities: [{ provider: 'apple', identity_data: { sub: 'apple-subject' } }],
    };
    window._currentProfile = { id: 'apple-user', display_name: 'Apple Traveller', is_anonymous: false };
    renderProfileScreen();
  });
  // Browser-mode rendering remains platform-neutral; the native iOS runtime
  // labels the same identity as an Apple account.
  await expect(page.locator('.profile-identity p')).toHaveText('Signed-in account');
  await expect(page.locator('[data-section="account-delete"]')).toHaveCount(1);
});

test('guest upgrade does not reveal whether the email belongs to an account', async ({ page }) => {
  await page.evaluate(() => {
    db.auth.updateUser = async () => ({
      error: { code: 'email_exists', message: 'User already registered' },
    });
    openModal('modal-guest-upgrade');
  });

  await page.locator('#upgrade-name').fill('Test Traveller');
  await page.locator('#upgrade-email').fill('existing@example.com');
  await page.getByRole('button', { name: 'Send verification email' }).click();

  await expect(page.locator('#toast')).toContainText(
    'Unable to use this address. If you already have an account, log in or reset its password.',
  );
});

test('admin page requires its own sign-in even when the app is signed in', async ({ page }) => {
  await page.evaluate(() => {
    // An app session under the app's default storage key must not reach the admin page.
    sessionStorage.setItem('sb-msnholvugsehlxkvzlxp-auth-token', JSON.stringify({ access_token: 'app-session' }));
  });
  await page.goto('/admin.html');

  await expect(page.getByRole('heading', { name: 'Admin sign-in' })).toBeVisible();
  await expect(page.locator('#admin-login-email')).toBeVisible();
  await expect(page.locator('#admin-login-password')).toBeVisible();
  await expect(page.locator('#admin-logout')).toBeHidden();
  // Turnstile is blocked in tests, so the page explains how to recover.
  await expect(page.locator('#admin-login-error')).toContainText('allow tripcash.de and challenges.cloudflare.com');

  await page.locator('#admin-login-submit').click();
  await expect(page.locator('#admin-login-error')).toHaveText('Enter the admin email and password.');
  await page.locator('#admin-login-email').fill('admin@example.com');
  await page.locator('#admin-login-password').fill('not-a-real-password');
  await page.locator('#admin-login-submit').click();
  await expect(page.locator('#admin-login-error')).toHaveText('Complete the bot-protection check first.');
  expect(await page.evaluate(() => sessionStorage.getItem('tripcash-admin-auth'))).toBeNull();
});

test('admin inactivity sign-out returns to the admin sign-in with a reason', async ({ page }) => {
  await page.goto('/admin.html');
  await expect(page.getByRole('heading', { name: 'Admin sign-in' })).toBeVisible();
  await page.evaluate(() => expireAdminSession());
  await expect(page.locator('#admin-login-message')).toHaveText(
    'You were signed out after 15 minutes without activity.',
  );
  await expect(page.locator('#admin-logout')).toBeHidden();
});

test('admin authenticator setup presents a polished QR and accessible code entry flow', async ({ page }) => {
  await page.goto('/admin.html');
  await page.evaluate(() => {
    pendingAdminFactorId = 'test-factor';
    const qr =
      'data:image/svg+xml;utf-8,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"%3E%3Crect width="10" height="10"/%3E%3C/svg%3E';
    renderAdminMfaCodeForm(
      'Scan the QR code with your authenticator app, then enter the code it shows.',
      qr,
      'JBSWY3DPEHPK3PXP',
    );
  });

  await expect(page.getByRole('heading', { name: 'Connect your authenticator' })).toBeVisible();
  await expect(page.getByRole('img', { name: /QR code for TripCash Admin/ })).toBeVisible();
  await expect(page.getByText('Open your authenticator app')).toBeVisible();
  await expect(page.getByText('Can’t scan the QR code?')).toBeVisible();
  const code = page.locator('#admin-mfa-code');
  await expect(code).toHaveAttribute('placeholder', '123 456');
  await code.fill('123456');
  await expect(code).toHaveValue('123 456');

  const presentation = await page.evaluate(() => {
    const frame = getComputedStyle(document.querySelector('.admin-mfa-qr-frame'));
    const input = document.getElementById('admin-mfa-code');
    return {
      qrBackground: frame.backgroundColor,
      inputHeight: input.getBoundingClientRect().height,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(presentation.qrBackground).toBe('rgb(255, 255, 255)');
  expect(presentation.inputHeight).toBeGreaterThanOrEqual(48);
  expect(presentation.horizontalOverflow).toBe(false);
});
