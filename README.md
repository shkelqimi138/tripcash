# TripCash

Group expense splitting for trips, on the web, iOS, and Android.

**Live app:** [tripcash.de](https://tripcash.de)

## Overview

TripCash records shared costs during a trip and tells the group who owes whom. A trip creator adds members by name, everyone logs expenses as the trip goes on, and the app calculates net balances and suggests the fewest transfers needed to settle up. The same web app runs in the browser and inside Capacitor wrappers for iOS and Android, and it keeps working offline.

## Features

- Trips with named members; members with accounts can join through an invite link
- Equal or exact-amount splits, with expenses grouped by trip day
- Net balances and simplified settlement suggestions
- Payment recording and PayPal.me links per member
- Day settlement, activity history, and CSV export
- Category breakdown and analytics across trips
- Multiple trip currencies with optional display-currency conversion
- AI-assisted receipt scanning that suggests expense details for review
- Offline mode: saved trips open without a connection and supported changes sync after reconnecting
- Email, Google, Apple, and guest sign-in; guests can upgrade without losing data
- Light and dark themes
- Account data controls, including in-app account deletion
- Admin dashboard protected by server-side authorization and multi-factor authentication

## Tech stack

| Area | Technology |
| --- | --- |
| Frontend | Vanilla JavaScript, HTML, CSS (no framework or bundler) |
| Backend | Supabase: Postgres, Auth, Row Level Security, SQL functions |
| Server endpoints | Cloudflare Pages Functions |
| Hosting | Cloudflare Pages |
| Native apps | Capacitor 8 (Swift Package Manager on iOS, Gradle on Android) |
| Email | Resend |
| Receipt scanning | OpenAI API |
| Testing | Node.js test runner, Playwright, local Supabase |
| Tooling | ESLint, Prettier, GitHub Actions, gitleaks |

## Project structure

```
web/
  pages/          HTML pages: app, landing, admin, legal, auth callback
  scripts/        Frontend logic: app, auth, offline sync, admin
  styles/         Stylesheets
  assets/         Icons, images, and landing-page screenshots
  public/         Cloudflare headers, manifest, and app association files
functions/        Cloudflare Pages Functions (contact, welcome, receipt scan, account closure)
supabase/
  sql/            Fresh-project schema, applied migrations, and seed data
  email-templates/
  config.toml     Local Supabase configuration for integration tests
scripts/          Build and helper scripts
tests/
  unit/           Isolated logic and API tests
  integration/    Auth, RLS, and database tests against local Supabase
  e2e/            Playwright browser tests
  release/        Packaging and security policy checks
ios/              Capacitor iOS project
android/          Capacitor Android project
assets/store/     Full-resolution store screenshots
docs/             Setup guides
```

## Getting started

### Prerequisites

- Node.js 22 (pinned in `.nvmrc` and `package.json` engines)
- For iOS: macOS with Xcode
- For Android: JDK 21 and the Android SDK
- For integration tests: Docker and the Supabase CLI

### Installation

```bash
git clone https://github.com/shkelqimi138/tripcash.git
cd tripcash
nvm use
npm ci
```

### Environment variables

The local web app and the test suites run without any environment variables. The variables in `.env.example` are used only by the Cloudflare Pages Functions in `functions/` and are documented there line by line. To run the functions locally with Wrangler, copy the file and fill in your own values:

```bash
cp .env.example .dev.vars
npx wrangler pages dev dist
```

The browser connects to Supabase with the public URL and anon key in `web/scripts/supabase.js`. The anon key is public by design; Row Level Security is the access boundary.

### Run

```bash
npm start
```

Open http://127.0.0.1:4173. This builds `dist/` and serves it with production-like security headers. The local build talks to the production Supabase project. To use your own backend, create a Supabase project, run `supabase/sql/schema.sql` in its SQL editor, and update the URL and anon key in `web/scripts/supabase.js`.

### Build

```bash
npm run build          # web build in dist/
npm run cap:sync:ios   # native build synced into the iOS project
npm run cap:sync:android
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Build and serve the web app at http://127.0.0.1:4173 |
| `npm run build` | Create the web build in `dist/` |
| `npm run build:native` | Create the native build in `dist/` |
| `npm run lint` | Run ESLint |
| `npm run format` | Format files with Prettier |
| `npm run format:check` | Check formatting |
| `npm run check` | Syntax-check all scripts and functions |
| `npm test` | Build, syntax-check, and run unit and release tests |
| `npm run test:integration` | Run database tests against local Supabase (requires Docker) |
| `npm run test:e2e` | Run Playwright browser tests |
| `npm run cap:sync:ios` | Sync the native build into the iOS project |
| `npm run cap:sync:android` | Sync the native build into the Android project |
| `npm run cap:open:ios` | Open the iOS project in Xcode |
| `npm run cap:open:android` | Open the Android project in Android Studio |
| `npm run android:build:debug` | Build a debug APK with Gradle |

## Deployment

- **Web and functions:** Cloudflare Pages with build command `npm run build`, output directory `dist`, and the `functions/` directory. Set the variables from `.env.example` as Pages environment variables. The admin pages are additionally protected by Cloudflare Access.
- **Database:** `supabase/sql/schema.sql` creates a fresh project and is destructive. `supabase/sql/migrations/` holds the history of changes already applied to production; see `supabase/README.md`.
- **iOS and Android:** run the matching `cap:sync` script, then archive and sign in Xcode or Android Studio.
- **CI:** GitHub Actions runs secret scanning, lint, formatting, unit, integration, and e2e tests, and an iOS sync check on pull requests and pushes to `main`.

## Roadmap

- Google Play and App Store releases
- Store native sign-in sessions in the iOS Keychain and Android Keystore

## License and author

Copyright 2026 Shkelqim Surkishi. All rights reserved. See [LICENSE](LICENSE).

Shkelqim Surkishi: [GitHub](https://github.com/shkelqimi138) | [Portfolio](https://www.shkelqim.me) | [LinkedIn](https://linkedin.com/in/shkelqimsurkishi)
