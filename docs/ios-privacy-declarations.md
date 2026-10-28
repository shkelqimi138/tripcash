# TripCash iOS Privacy Declaration Draft

Technical review updated on 2026-09-09 for the current source following the accepted
TripCash 1.0 build 8 candidate. The data-type selections were owner-approved on
2026-09-06. This is the App Store Connect reference; it is not a substitute for legal
advice.

## Current data flows

TripCash uses Supabase Auth and Postgres for accounts and shared trip data,
Cloudflare Turnstile for bot protection, `open.er-api.com` for exchange rates, and
OpenAI only when a signed-in person explicitly chooses to scan a receipt. The scan
sends the selected receipt image through a protected Cloudflare endpoint; TripCash
does not store that image in the account or its storage in this version.
The iOS bundle contains Capacitor 8.5.1 with App, Browser, Filesystem, Keyboard,
Share, and Status Bar plugins. It contains no advertising, analytics, location,
device-contacts, camera, microphone, or photo-library SDK. TripCash stores
account-scoped trip and expense caches plus pending offline changes on the device so
work can be restored and synchronized after reconnecting.

Supabase authentication audit logs include the user ID, authentication action, IP
address, and user agent. Turnstile processes browser and network security signals
for bot detection but not form contents. TripCash does not use these services for
advertising or cross-app tracking.

## App Store Connect selections

Answer **Yes, data is collected** and select the following types. Unless a row says
otherwise, use **App Functionality**, **Linked to the User: Yes**, and **Used for
Tracking: No**.

| Category | Data type | Why TripCash uses it |
| --- | --- | --- |
| Contact Info | Name | Account display names, participant names, and saved contact names |
| Contact Info | Email Address | Authentication, confirmation, and recovery |
| Contact Info | Other User Contact Info | Optional PayPal.me contact links |
| Financial Info | Other Financial Info | Budgets, balances, shares, and settlement amounts |
| Purchases | Purchase History | User-entered trip expense records |
| User Content | Other User Content | Trip names, notes, categories, and other shared trip details |
| User Content | Photos or Videos | Receipt image selected for the optional Scan receipt feature |
| Identifiers | User ID | Supabase account and membership identifiers |
| Usage Data | Product Interaction | Linked authentication events and shared activity history |
| Diagnostics | Other Diagnostic Data | Unlinked browser/network security signals used for bot protection |

For **Other Diagnostic Data**, select **Linked to the User: No**, **App
Functionality**, and **Used for Tracking: No**. Cloudflare states that Turnstile's
signals are used only for bot detection and do not directly identify individuals.

Do not select advertising, analytics, precise or coarse location, device contacts,
audio, health, fitness, sensitive information, physical address,
phone number, payment-card information, credit information, device ID, search
history, or browsing history for the current build.

## Native privacy manifest

The bundled manifest currently declares no tracking, the listed data types, and
File Timestamp access reason `C617.1`, which is required by the Filesystem plugin.
The audit identified **Purchase History** as the only missing data type in the local
manifest. It was added after owner approval on 2026-09-06. That manifest-only
correction does not affect app behavior, but it must be included in a new archive
before any future public App Store submission.

## Owner approval reference

The owner approved the data-type selections on 2026-09-06, and Purchase History was
added to `PrivacyInfo.xcprivacy` and its automated test. Any future App Store Connect
confirmation is tracked only in the private release checklist.
