# Overnight session — 2026-09-04 → 05 (branch `experimental`)

Autonomous improvement pass while Karel sleeps. Goal: spend the remaining weekly
budget on launch-relevant improvements; resolve open TODOs; document as I go.
Baseline at start: type-check clean, 1453 unit tests green (notation 884, playback
79, web 257, api 220, admin 13).

Each entry: **what** → **why it matters** → **verification**.

## 1. Generative round-trip suite for the notation model — 2 persistence bugs fixed

- **What:** `packages/notation/tests/model/util/RoundTrip.test.ts` — a seeded
  generator builds random valid scores (all 11 meters, all 17 clefs, keys −7..7
  with modes, dotted values, triplets, ties, mid-bar clef/key changes, tempo
  marks, barlines, every selectable instrument) and asserts three paths give
  the same score back, 150 seeds each: JSON save/load (what the API stores),
  MusicXML export→import (exact, and the importer must not warn about our own
  files), MIDI export→import (sounding events, meters, tempo marks).
- **Bugs it found (fixed in the same commit):**
  1. *Instrument swapped on reload.* `ScoreDeserializer` resolved the instrument
     by General MIDI program before its name; 17 of the 51 selectable
     instruments share a program with an earlier-registered one (bass
     clarinet→clarinet, French horn→horn in C, alto flute→dizi flute,
     violoncello→cello, euphonium→baritone horn, contrabassoon→bassoon, …).
     Since transposition is per instrument, a French-horn score sounded a fifth
     off after every save. Name now decides; program only for foreign files.
  2. *Key mode lost.* A mode-only key change (C major → A minor, same fifths)
     carried into later bars via `lastKey` but was "redundant" for drawing and
     serialization, so the inherited mode vanished on reload. Redundancy checks
     and the serializer's change detection now include the mode.
- **Verification:** notation suite 1338/1338 green, model coverage gate (100%)
  holds, eslint clean. Commit `f44e912`.
- **Known, documented non-losses:** MIDI import keeps at most one tempo mark
  per bar (a mid-bar change in a bar that already had one at its downbeat is
  dropped) and cannot rebuild trailing all-rest bars — inherent to MIDI, the
  test encodes both.

## 2. `/pricing` route (master-todo #18)

- **What:** pricing section extracted to `PricingSection.tsx` (shared with the
  landing page), new `/pricing` route with metadata + canonical, offers +
  FAQPage JSON-LD, an 8-question pricing FAQ (`pricing/faq.ts`, single source
  for page and structured data), closing CTA; footer + landing nav link,
  sitemap entry, middleware allowlist.
- **Why:** a linkable, indexable pricing page is table stakes at launch (ads,
  search, "how much is it?" replies); the landing hides the ladder in beta
  mode and the route inherits that switch, so it is safe to ship now.
- **Verification:** type-check/lint clean, new `e2e/pricing.spec.ts` (2 tests)
  green. Fixed along the way: the mocked e2e suite depended on the developer's
  `.env.development` (beta mode on → landing spec red locally); the Playwright
  web server now pins `NEXT_PUBLIC_BETA_MODE=false`.

## 3. GDPR "Download my data" (master-todo #14)

- **What:** `lib/AccountExport.ts` — `ZipWriter` (stored-entry zip, UTF-8
  names, CRC-32) + `AccountExport` (profile.json, settings.json,
  scores/index.json, every score as `.musicxml` and `.json`, README). Settings →
  Account → "Your data" section; privacy policy names the path.
- **Why:** the policy promises portability; the product offered nothing at
  account level. Client-side build reuses existing endpoints — no API change,
  no server zip pipeline, MusicXML conversion runs on the same exporter the
  editor uses (and the round-trip suite from §1 now guards).
- **Verification:** 6 unit tests (zip verified through the independent
  `MxlArchive` reader + CRC reference vector), settings e2e asserts a real
  download; 12/12 affected e2e green.

## 4. Signup CAPTCHA — Cloudflare Turnstile (master-todo #15, launch blocker)

- **What:** API installs better-auth's official `captcha` plugin
  (`auth/captcha-config.ts`) on `/sign-up/email` when `TURNSTILE_SECRET_KEY`
  is set; production boot warns when it isn't. Web renders a `Turnstile`
  widget on the signup form when `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set,
  disables submit until solved, sends the token as `x-captcha-response`,
  remounts the widget after a rejected attempt (tokens are single-use).
  Privacy policy lists Cloudflare as a processor; env examples + production
  secret runbook updated.
- **Why:** the end-of-beta runbook calls this a blocker for the BETA_MODE
  flip: without approval, signup is an open faucet with e-mail sending.
  Scope kept to signup only (sign-in and reset are rate-limited and would
  need the widget on their forms too) — extend `CAPTCHA_ENDPOINTS` with the
  pages if that changes.
- **Remaining for Karel (config only):** create the Turnstile widget
  (managed mode, domain solkey.io), set the two keys, sign up once for real.
- **Verification:** api + web type-check/lint clean; 4 new API unit tests
  (plugin installed/omitted, production warning), 2 web component tests
  (widget lifecycle), auth e2e green with no site key (widget absent).

## 5. Runbook hygiene (end-of-beta launch)

- The runbook still described the pre-relaunch catalogue (Composer $8 /
  Studio $18, four products, beta tier "300 credits = 5 min"). Corrected to
  the 2026-07 relaunch: Songwriter/Studio/Arranger monthly+yearly, three
  minute packs, `order.paid`/`order.refunded` webhooks, pack env vars, beta
  tier 1800 credits (30 min — which, as now noted there, out-gives
  Songwriter, so grandfathering beta users means they never need to pay).
  Checklist rows updated for the CAPTCHA, data export and the error-tracking
  state (web half exists, API half doesn't).
