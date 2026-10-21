# PRD: Jugnu - Crowd-Sourced Women's Safety & Streetlight Map

**Version:** 1.0
**Builder:** Antigravity (autonomous AI coding agent)
**Launch city:** Mumbai, India (works anywhere OpenStreetMap has coverage)
**Platform:** Mobile-first web app, vanilla HTML/CSS/JavaScript, no build step

---

## 0. Agent Operating Rules (Read Before Writing Any Code)

1. Build the whole project from scratch in an empty folder. Follow the milestone order in Section 6.
2. **Stack is fixed:** plain HTML5, CSS3, and ES2020 JavaScript loaded with ordinary `<script>` tags (`data.js` first, then `app.js`). No React, no Tailwind, no bundler, no npm dependencies, no backend.
3. **Only three external resources are allowed:** Leaflet `1.9.4`, Lucide icons (pinned version), Google Fonts. Pin every CDN URL to an exact version. Never use `@latest`.
4. **Never ask the user a question or for permission at any point.** If something is ambiguous, pick the simplest option consistent with this document and record the decision in a "Design Decisions" section at the end of `LEARNING_GUIDE.md`.
5. **Zero emojis anywhere:** not in code, comments, UI text, markdown files, or commit messages. Use SVG icons only.
6. Every function gets a short plain-English comment (what it does, and why). The code will be read by a first-year student.
7. Use `"use strict"`, `const`/`let` only (no `var`), and small single-purpose functions.
8. All user-facing text is English, short, and calm. No exclamation-mark spam, no marketing tone.
9. Accessibility baseline: every icon-only button has an `aria-label`; visible `:focus-visible` outline (`2px solid #F59E0B`, `2px` offset); respect `prefers-reduced-motion` (disable pulses and slide animations); never rely on colour alone (every safety level always shows an icon and a text label).

---

## 1. What the App Is & How It Works

### 1.1 The Problem

Standard map apps (Google Maps, Apple Maps) optimise for the fastest route. They do not tell a woman walking alone whether a street is lit, isolated, or has been reported for harassment. Jugnu ("firefly" in Hindi) is a community-powered safety layer: women check real-time street safety before entering an area and report hazards in seconds to warn the next woman.

### 1.2 Core Principles

- **Glanceable:** safety level is visible from the colour, icon, and label of a pin without opening anything.
- **Fast to report:** a report takes under 10 seconds, mostly taps, minimal typing (the user is often walking).
- **Trust through community:** reports are verified or retired by other users ("Still True?").
- **One-hand use:** all primary actions sit in the bottom thumb zone.
- **No account, no sign-up:** everything is stored in the browser's `localStorage`.

### 1.3 App States

| State | What the user sees |
|---|---|
| Welcome | Live dark map behind a solid scrim, Welcome Sheet at the bottom. Dock and top bar hidden. |
| Browsing | Top bar (search + filter pills), full map with pins and zones, bottom dock. |
| Inspecting | A pin was tapped: Inspection Card slides up. |
| Reporting | An empty map spot was tapped (or the Report dock button pressed): target ring on the map plus Report Sheet. |
| Fake Call | Full-screen incoming-call screen above everything. |

Only one sheet or card may be open at a time. Opening one closes the others. `Escape` and the browser's back gesture (use `history.pushState` for sheets, optional) close the top-most overlay.

### 1.4 How the Live Map Works

- Library: **Leaflet.js `v1.9.4`**.
- Tiles: OpenStreetMap, `https://tile.openstreetmap.org/{z}/{x}/{y}.png`, `maxZoom: 19`. Attribution text "OpenStreetMap contributors" with a link to `https://www.openstreetmap.org/copyright` must stay visible.
- Initial view: centre `[19.0760, 72.8777]` (Mumbai), zoom `12`.
- Interactions: pan (drag), pinch-to-zoom, double-tap zoom, scroll-wheel zoom on desktop, search, and live GPS tracking.
- Create the map with `zoomControl: false`. On devices with `(pointer: fine)` show two custom 48px zoom buttons (plus / minus icons) on the right edge above the dock. Hide them on touch devices.
- Reports live in one `L.layerGroup` called `reportLayer`. Whenever data or filters change, call `reportLayer.clearLayers()` and re-render. Keep a `markersById` lookup object.

### 1.5 How Safety Zones Work

Every visible report is drawn as **two things**: a 120 m radius coloured circle and a custom centre pin.

| Level | `status` value | Colour | Icon (Lucide) | Meaning |
|---|---|---|---|---|
| Safe & Well-Lit | `safe` | `#10B981` | shield-check | Working streetlights, active crowd, open 24/7 shops or pharmacies, police or guard presence |
| Caution / Dim | `caution` | `#F59E0B` | triangle-alert | Flickering or dim lights, isolated after 10 PM, stray dogs, no shops nearby |
| Unsafe / Avoid | `unsafe` | `#F43F5E` | shield-alert | Pitch dark, broken streetlights, harassment or stalking reported, unsafe isolated lane |

Rendering rules:

- Circle: `L.circle([lat, lng], { radius: 120, color: levelColor, weight: 2, opacity: 0.9, fillColor: levelColor, fillOpacity: 0.18, interactive: false, className: "zone zone-" + status })`. Radius is in real metres, so the zone scales with zoom. `interactive: false` lets taps pass through to the map and the pin.
- Glow: in CSS, `.zone-safe`, `.zone-caution`, `.zone-unsafe` each get `filter: drop-shadow(0 0 8px rgba(R,G,B,0.65))` using that level's RGB. Use SVG rendering (do not set `preferCanvas`), because `className` and CSS filters require SVG paths.
- Draw order: add all `safe` circles first, then `caution`, then `unsafe`, so red zones are never hidden under green ones.
- Pin: `L.marker([lat, lng], { icon: buildPinIcon(status, dim) })` where the icon is an `L.divIcon` containing a teardrop-shaped inline SVG (40 x 48 px, anchor at the tip) filled with the level colour, a white inner glyph (inline SVG paths copied from the Lucide icon), and a CSS-animated pulse ring behind it. The pulse is stronger and faster on `unsafe`, slow on `caution`, and absent on `safe`. Do not rely on `lucide.createIcons()` for marker HTML; use inline SVG string constants kept in an `ICON_SVG` object in `app.js`.
- **Stale reports:** if a report is older than 14 days AND has fewer than 3 confirmations, render the pin at `opacity: 0.55`, the circle fill at `0.09`, and show "Needs re-confirmation" in the Inspection Card.
- Marker tap calls `L.DomEvent.stopPropagation(e)` and opens the Inspection Card, so it never starts a new report.

### 1.6 How Reporting an Incident Works (Step by Step)

1. The user taps any exact spot on the map (or presses the **Report** dock button, which drops the target at the user's GPS position if known, otherwise at the map centre).
2. A **target ring** (amber `L.divIcon`, 56px ring with a small centre dot, gentle pulse) appears at that point. The map pans so the target sits in the upper 30% of the screen, visible above the sheet.
3. The **Report Sheet** slides up (max height `72dvh`, content scrolls inside the sheet if the screen is short).
4. The sheet shows, top to bottom:
   - Drag handle (visual, 40 x 4 px, `#27272A`).
   - Title "Report this street" (22px).
   - Area row: map-pin icon plus the street name. Fetch it with Nominatim reverse geocoding: `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=LAT&lon=LNG`. While loading show "Finding street name...". On failure show "Pinned location (19.0760, 72.8777)" using 4 decimals. Store the result as `areaName`. Make at most one reverse call per target placement. If the user moves the target again, wait until they stop tapping for 800 ms.
   - Label "How does this spot feel?" (15px, `#A1A1AA`).
   - **Safety Level selector:** 3 equal columns (Safe, Caution, Unsafe), each 54px tall, icon (18px) above a 14px semibold label. Selected state: border and icon in level colour plus tinted background `rgba(level, 0.14)`. Nothing is preselected.
   - **Condition chips** (multi-select, 48px tall, 14px or 15px medium weight, each with a Lucide icon). The chip set changes with the selected level, and changing the level clears selected chips:
     - Safe: `Streetlights working`, `Crowd around`, `Shops open late`, `Police / guard nearby`, `CCTV visible`, `Pharmacy open 24x7`
     - Caution: `Dim / flickering lights`, `Isolated after 10 PM`, `Stray dogs`, `No shops nearby`, `Blocked footpath`, `Poor visibility at turn`
     - Unsafe: `Pitch dark`, `Broken streetlights`, `Harassment reported`, `Stalking reported`, `Isolated lane`, `Drunk groups`
   - **Landmark note** (optional single-line input, 54px tall, 16px, max 140 characters, placeholder `Landmark, e.g. Behind Metro Pillar 142`) with a live character counter (13px).
   - **Publish** button: 54px tall, full width, 16px semibold, amber `#F59E0B` background with `#09090B` text, send icon. Disabled (40% opacity) until a Safety Level is selected.
5. On Publish: build a `SafetyReport` (Section 3), call `store.add()`, close the sheet, remove the target ring, re-render the map (the new pin plays a 300 ms drop-in animation), pan to it, and show the toast "Report published. Thank you for keeping others safe."
6. The reporter's own report starts with `confirmations: 1`, and the reporter is recorded as having voted on it (they cannot confirm their own report).

### 1.7 How Community Verification ("Still True?") Works

Tapping an existing pin opens the **Inspection Card** (bottom card, not full height) showing:

- Area name (20px bold) and a level badge (icon + label in level colour).
- Condition chips (read-only) and the landmark note (15px, `#F4F4F5`).
- "Reported 3 hours ago" plus the exact local time and date below it (13px, `#A1A1AA`).
- A **Night / Day badge:** moon icon with "Night report" if `isNightReport` is true, sun icon with "Day report" otherwise. Night means the report was logged between 7 PM and 6 AM local time.
- Trust line: "Confirmed by N women". If `confirmations >= 5`, also show a "Community verified" badge (badge-check icon).
- Two 54px buttons side by side:
  - **Confirm Still True (+1):** increments `confirmations`, updates the card in place, toast "Thanks. Confirmation added." Afterwards the button becomes disabled and reads "You confirmed" with a check icon.
  - **Mark Resolved:** increments `resolvedCount` (for example, the streetlight was fixed), toast "Thanks. Marked as resolved (n of 3)." When `resolvedCount` reaches **3**, the report is hidden from the map permanently (soft-removed) and the toast reads "Enough women confirmed this is resolved. Report removed."
- Anti-abuse: each browser can cast one vote per report (either confirm or resolve). Track this in `localStorage` key `jugnu_votes` as `{ [reportId]: "confirm" | "resolve" }`. After voting, both buttons are disabled and the chosen one shows its done state.
- Close with the X button (48px target), tapping the scrim, tapping empty map, or swiping the card down.

### 1.8 How Search & Filtering Work

**Search**
- Search input in the top bar, 52px tall, 16px text, search icon on the left, clear (X) button when non-empty.
- API: `https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&countrycodes=in&viewbox=72.75,19.35,73.05,18.85&q=` plus `encodeURIComponent(query)`. The viewbox only biases results toward Mumbai; it does not restrict them.
- Search runs **only when the user submits** (Enter key or tapping the search icon). Do NOT search while typing. Nominatim's usage policy forbids autocomplete-style requests.
- Use `AbortController` to cancel an in-flight request when a new search starts.
- Results appear in a dropdown under the input (up to 5 rows, each at least 56px tall, name in 15px `#F4F4F5` using the first two comma-separated parts of `display_name`, remainder in 13px `#A1A1AA`). Tapping a row calls `map.flyTo([lat, lon], 16, { duration: 1.5 })` and shows a temporary amber ring marker that fades after 6 seconds.
- States: "Searching..." (with a spinner icon), "No places found. Try a nearby station or college.", and on network error the toast "Search failed. Check your internet connection."

**Filter pills** (horizontally scrollable row under the search bar, scrollbar hidden, each pill 48px tall, icon + 14px or 15px medium label):

| Pill label | `data-filter` | Shows |
|---|---|---|
| All Reports | `all` | everything not resolved-away |
| Unsafe Only | `unsafe` | `status === "unsafe"` |
| Caution | `caution` | `status === "caution"` |
| Safe Zones | `safe` | `status === "safe"` |
| Nighttime Reports Only | `night` | `isNightReport === true` |

Exactly one pill is active at a time. Active pill: amber `#F59E0B` background, `#09090B` text. Inactive: `#1C1C21` background, `#27272A` 1px border, `#F4F4F5` text. Changing a filter re-renders the map immediately (no page reload) and closes any open card.

### 1.9 How Emergency Tools Work

**Live GPS Locate** (dock button)
- Uses `navigator.geolocation.watchPosition` with `{ enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }`. Do not request location on page load; only after the user taps Locate or SOS (so the permission prompt has context).
- Draws a **pulsing blue location dot** (`L.divIcon`, 18px `#3B82F6` core, 3px white border, CSS pulse ring) plus a faint accuracy circle (`L.circle`, `interactive: false`, capped at 150 m radius for display). Both update on every position change.
- The first fix calls `map.flyTo(latlng, 17)`. Later taps on Locate re-centre on the latest position.
- Errors: permission denied toast "Location is blocked. Allow location in your browser settings to use this."; unavailable or timeout toast "Could not get your location. Move to an open area and try again."
- Geolocation requires a secure context. It works on `http://localhost` and `https://` only (see Section 4 run notes).

**One-Tap WhatsApp SOS** (dock button, red)
1. Use the cached latest position if `watchPosition` already has one; otherwise call `getCurrentPosition` (timeout 8 s).
2. Build the Maps link: `https://www.google.com/maps?q=LAT,LNG` (6 decimals).
3. Build the message: `EMERGENCY: I do not feel safe. Please call me or come to my location now. My live location: <link> (sent from Jugnu)`
4. Open `https://wa.me/?text=` plus `encodeURIComponent(message)`. With no phone number in the URL, WhatsApp opens its contact picker so the user chooses family or friends.
5. If a cached position existed, call `window.open(url, "_blank")` synchronously inside the click handler (avoids popup blockers). If position had to be fetched asynchronously, use `window.location.href = url` instead.
6. If location cannot be obtained at all, still open WhatsApp with the message without a link: "EMERGENCY: I do not feel safe. Please call me now. (sent from Jugnu, location unavailable)".
7. No confirmation dialog (this is one tap by design). Separate the SOS button visually from neighbours (red icon, 8px extra margin) to reduce accidental presses.

**Fake Incoming Call ("Exit Call")** (dock button)
1. On tap, create/resume a Web Audio `AudioContext` (the tap counts as the required user gesture) and show the toast "Call arriving in 3 seconds". Ignore further taps while the timer is pending.
2. After `setTimeout(..., 3000)`, show the full-screen call screen (`z-index` above everything, solid `#09090B` background, safe-area padding).
3. Ringing layout: small "mobile" label (15px), caller name **"Papa"** (34px, `Plus Jakarta Sans` 700), status "Calling..." (16px, `#A1A1AA`), a 120px circular avatar (`#1C1C21` surface, Lucide `user` icon 56px), and at the bottom two 72px circular buttons with 15px labels: **Decline** (red `#F43F5E`, phone-off icon) and **Answer** (green `#10B981`, phone icon).
4. Ringtone: Web Audio oscillators at 440 Hz and 480 Hz (gain 0.15), 1.5 s on / 2 s off, looping, plus `navigator.vibrate([800, 400, 800])` where supported. No audio files. Stop sound and vibration on answer, decline, or end.
5. **Answer:** status becomes a live timer `00:00` (updated every 1000 ms with `setInterval`, formatted `mm:ss`, tabular numerals). Show three decorative toggle buttons (Mute, Keypad, Speaker; 56px circles with icons; they only toggle a visual active state) and a red End button (phone-off icon).
6. **Decline or End:** stop everything, clear intervals/timeouts, hide the call screen, return to the map exactly as it was.

### 1.10 Cross-Cutting Behaviour

- **Toast:** single toast element at the top, below the safe area, `#1C1C21` surface, `#27272A` border, 15px text, auto-hides after 3.5 s, `role="status"`, `aria-live="polite"`.
- **Empty filter result:** if the active filter shows zero pins, show the toast "No reports match this filter here."
- **Welcome dismissal:** tapping "Open Live Safety Map" hides the Welcome Sheet and stores `jugnu_onboarded = "1"` in `localStorage`. On later visits skip the Welcome Sheet entirely.
- **Reset for demo/viva:** loading the page with `?reset=1` clears all `jugnu_*` keys and re-seeds the data.

### 1.11 Out of Scope (Do Not Build)

User accounts, a backend or database server, real-time sync between users, push notifications, photo uploads, routing or directions, multilingual UI, and payments.

---

## 2. Human-Crafted Native Mobile UI Standards (Strictly No "AI Look")

The result must look like a real utility app made by a human designer (think Uber or Apple Maps), not a generated template.

### 2.1 Design Tokens (define as CSS custom properties in `:root`)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#09090B` | App background, call screen, map backdrop |
| `--sheet` | `#121215` | Bottom sheet and card surface |
| `--surface` | `#1C1C21` | Chips, pills, inputs, inner cards |
| `--border` | `#27272A` | All 1px borders |
| `--text` | `#F4F4F5` | Primary text |
| `--text-muted` | `#A1A1AA` | Timestamps, secondary labels |
| `--accent` | `#F59E0B` | Brand accent, primary buttons, active pills |
| `--safe` | `#10B981` | Safe level |
| `--caution` | `#F59E0B` | Caution level |
| `--unsafe` | `#F43F5E` | Unsafe level |
| `--you` | `#3B82F6` | User location dot only |
| `--radius` | `16px` | "rounded-2xl" for buttons, chips, inputs, cards |
| `--radius-sheet` | `24px 24px 0 0` | Sheet top corners |

Note: caution and the brand accent share amber on purpose. This is why a safety level is always shown with an icon and a text label, never colour alone.

### 2.2 Typography (Ban Tiny Fonts)

Load via Google Fonts: `https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap`. Add `preconnect` links for `fonts.googleapis.com` and `fonts.gstatic.com`. Fallback stack: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

| Element | Font | Size | Weight |
|---|---|---|---|
| Sheet and card headings | Plus Jakarta Sans | `20px` to `22px` | 700, letter-spacing `-0.02em` |
| Primary buttons (Publish, Open Live Safety Map, Confirm, Resolve) | Plus Jakarta Sans | min `16px` (`1rem`) | 600 |
| Search input, note input | Inter | min `16px` (`1rem`) | 600 for typed text is not required; use 500 |
| Filter pills, condition chips, level labels, user notes | Inter | `14px` to `15px` | 500 |
| Timestamps, counters, dock labels, secondary labels | Inter | min `13px` | 400 to 500, colour `#A1A1AA` |
| Body copy | Inter | `15px` to `16px` | 400, line-height 1.5 |

**Hard rule:** no `font-size` below `13px` anywhere in `styles.css`, and never `10px` or `12px` for any interactive text. This includes Leaflet's attribution control (override it to `13px`). Add a CSS comment above the type scale stating this rule.

### 2.3 Zero Emojis, SVG Icons Only

- Forbidden: any emoji or pictograph (for example the siren, pin, green circle, or shield emoji) in HTML, CSS (`content:`), JS strings, comments, markdown, and commit messages.
- Use **Lucide** loaded from a pinned CDN build (use a recent pinned version of the UMD bundle at `https://unpkg.com/lucide@<VERSION>/dist/umd/lucide.min.js`, version 0.400.0 or newer). Write icons as `<i data-lucide="icon-name"></i>` and call `lucide.createIcons()` after first render and after every dynamic render of chips, pills, sheets, and results.
- Stroke width `2px` (Lucide default). Set in CSS: `svg.lucide { stroke-width: 2; }`. Icon sizes: 20px in buttons and pills, 24px in the dock, 18px in level selector, 56px in the call avatar.
- Suggested icon names: `shield-check`, `shield-alert`, `triangle-alert`, `layers`, `moon`, `sun`, `search`, `x`, `map-pin`, `locate-fixed`, `plus`, `minus`, `phone-incoming`, `phone`, `phone-off`, `siren`, `send`, `check`, `badge-check`, `user`, `lightbulb`, `lightbulb-off`, `users`, `store`, `dog`, `cctv`, `pill`, `eye-off`, `footprints`, `mic-off`, `grid-3x3`, `volume-2`, `loader-circle`.
- Add a dev check at the end of `app.js` init: after `createIcons()`, `console.warn` for any remaining `<i data-lucide>` element that was not replaced.

### 2.4 Solid Dark Surfaces (No Cheesy AI Gradients)

- Forbidden: gradients of any kind on UI surfaces (especially purple/pink/neon), blurred background blobs, glassmorphism/`backdrop-filter`, glow-for-decoration, and stock "hero" illustrations.
- Allowed: flat solid fills from the token table, `1px solid #27272A` borders, subtle drop shadows for elevation (`0 8px 24px rgba(0,0,0,0.5)`), and the functional safety-zone glow in Section 1.5.
- The scrim behind sheets is a flat `rgba(0,0,0,0.55)`.

### 2.5 Dark-Mode Map Tiles

```css
.leaflet-tile {
  filter: invert(100%) hue-rotate(180deg) brightness(93%) contrast(90%);
}
.leaflet-container { background: #09090B; }
```

Apply the filter to `.leaflet-tile` **only**. Do not filter `.leaflet-container`, panes, markers, or overlays, so safety pins and zones stay bright and un-inverted.

### 2.6 Mobile-First Ergonomics

- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, `<meta name="theme-color" content="#09090B">`, and `color-scheme: dark`.
- Lock the page: `html, body { height: 100vh; height: 100dvh; overflow: hidden; overscroll-behavior: none; margin: 0; background: var(--bg); }`. The page itself never scrolls; only the Report Sheet content and filter-pill row may scroll internally.
- `#map { position: absolute; inset: 0; z-index: 0; isolation: isolate; }` so Leaflet's internal z-indexes cannot overlap the UI.
- Z-index scale: map `0`, top bar `1000`, scrim `1100`, sheets and cards `1200`, welcome sheet `1300`, toast `1400`, call screen `2000`.
- Safe areas: pad top bar and dock with `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.
- **Touch targets:** every button, chip, pill, and input is `48px` to `54px` tall with `border-radius: 16px`. Primary actions are `54px`. Icon-only buttons are at least `48 x 48px`. Minimum 8px gap between adjacent targets.
- Primary actions live in the bottom third of the screen (dock and sheet buttons).
- Leaflet attribution moves above the dock: `.leaflet-bottom { bottom: calc(var(--dock-h) + env(safe-area-inset-bottom)); }`.

### 2.7 Component Specifications

**Top bar:** fixed at the top, transparent container (the map shows through), `12px` side padding. Search field and filter pills each have solid `#1C1C21` backgrounds with a `1px #27272A` border and a drop shadow so they read clearly on the map.

**Bottom thumb dock:** fixed at the bottom, `#121215` surface with a `1px` top border, `--dock-h: 76px`, four equal buttons, each an icon (24px) over a 13px label:
1. **Locate** (locate-fixed)
2. **Report** (plus; the primary button, with an amber `#F59E0B` rounded-2xl icon container, dark icon)
3. **Exit Call** (phone-incoming)
4. **SOS** (siren; red `#F43F5E` icon and label)

**Welcome / Entry Bottom Sheet:** on first open, the live dark map fills the screen behind a flat scrim, and the sheet sits at the bottom:
- Wordmark row: shield-check icon in an amber rounded square plus **Jugnu** (22px, 800). Tagline (16px): "Know the street before you step onto it."
- One short paragraph (15px): "Check how safe a street feels right now, and warn other women in seconds."
- **The 3 colour codes**, each a row with a 40px rounded-xl icon tile in the level colour, title (16px semibold) and one-line description (14px muted):
  - shield-check, green: "Safe and well-lit. Working lights, people around, open shops, guards."
  - triangle-alert, amber: "Caution. Dim lights, isolated at night, stray dogs, no shops."
  - shield-alert, red: "Unsafe. Pitch dark, broken lights, harassment reported."
- **Open Live Safety Map** button: `54px` tall, full width, amber `#F59E0B` background, `#09090B` text, 16px, 600.

**Motion:** sheet slide `transform: translateY(100%)` to `0` over `280ms cubic-bezier(0.32, 0.72, 0, 1)`; scrim fades over 200ms; toast fades over 150ms. All disabled under `prefers-reduced-motion: reduce`.

### 2.8 UI Self-Check (agent must run before each commit)

1. No emoji: run `grep -rnP "[\x{1F300}-\x{1FAFF}\x{2600}-\x{27BF}]" index.html styles.css data.js app.js LEARNING_GUIDE.md` and it must print nothing.
2. No `font-size` under `13px`, no `gradient(` in `styles.css`, no `backdrop-filter`.
3. Layout verified at 360 x 640 and 390 x 844: nothing overflows horizontally, the page never scrolls, all targets at least 48px.

---

## 3. Data Structure & Pre-Seeded Mumbai Dataset

### 3.1 `SafetyReport` Schema

```json
{
  "id": "r_lx3k9a2f",
  "lat": 19.1290,
  "lng": 72.8370,
  "status": "caution",
  "tags": ["Dim / flickering lights", "Isolated after 10 PM"],
  "note": "Behind Metro Pillar 142",
  "areaName": "Veera Desai Road, Andheri West",
  "timestamp": 1760000000000,
  "isNightReport": true,
  "confirmations": 6,
  "resolvedCount": 0
}
```

| Field | Type | Rules |
|---|---|---|
| `id` | string | Unique. New reports: `"r_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)`. |
| `lat`, `lng` | number | Decimal degrees, stored with 6 decimals. Must be finite and within valid ranges. |
| `status` | string | Exactly `"safe"`, `"caution"`, or `"unsafe"`. |
| `tags` | string[] | 0 to 6 labels from the chip vocabulary in 1.6. |
| `note` | string | 0 to 140 characters, trimmed. Render with `textContent` (never `innerHTML`) to prevent injection. |
| `areaName` | string | Street or locality, from reverse geocode or fallback text. |
| `timestamp` | number | Epoch milliseconds of when it was reported. |
| `isNightReport` | boolean | Derived once at creation: local hour `>= 19` or `< 6`. Never trusts user input. |
| `confirmations` | number | Integer `>= 0`. New reports start at `1`. |
| `resolvedCount` | number | Integer `>= 0`. When it reaches `3` the report is no longer returned by the store. |

### 3.2 Storage Keys (all in `localStorage`)

| Key | Content |
|---|---|
| `jugnu_reports_v1` | JSON array of `SafetyReport` |
| `jugnu_votes` | JSON object `{ reportId: "confirm" or "resolve" }` |
| `jugnu_onboarded` | `"1"` once the Welcome Sheet was dismissed |

Wrap every `JSON.parse` in `try/catch`. On corrupted or missing data, fall back to the seed data. If `localStorage` throws (private mode), keep data in memory and continue without crashing.

### 3.3 Pre-Seeded Dataset (10 Reports)

If `jugnu_reports_v1` does not exist, write these on first run. Coordinates are approximate points on the named streets. Timestamps are generated at seed time as `daysAgo` days before today at the given local clock time; if that moment is in the future, subtract one more day. `isNightReport` is computed from the resulting timestamp using the same function as new reports.

| # | areaName | lat | lng | status | tags | note | confirm. | resolved | daysAgo, time |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Veera Desai Road near Azad Nagar Metro, Andheri West | 19.1290 | 72.8370 | caution | Dim / flickering lights; Isolated after 10 PM | Stretch behind the metro pillars gets dim once shops pull shutters. Two lights flicker. | 6 | 0 | 1, 22:15 |
| 2 | Dadar TT Circle, near Tilak Bridge | 19.0190 | 72.8440 | safe | Streetlights working; Crowd around; Police / guard nearby | Busy junction with a traffic police booth at the circle. Tea stalls stay open. | 14 | 0 | 1, 08:45 |
| 3 | Carter Road Promenade, Bandra West | 19.0693 | 72.8226 | safe | Streetlights working; Crowd around; Shops open late | Joggers and families around till late. Cafes and ice-cream stalls open. | 11 | 0 | 5, 21:10 |
| 4 | Kurla Station Skywalk Exit, Kurla West | 19.0652 | 72.8790 | unsafe | Broken streetlights; Isolated lane | Skywalk exit toward the bus depot has two dead lights. Hawkers leave by 9 PM. | 9 | 1 | 2, 21:45 |
| 5 | IIT Bombay Main Gate, Powai | 19.1334 | 72.9133 | safe | Police / guard nearby; Streetlights working; CCTV visible | Guard cabin at the gate and an auto stand with drivers present. | 8 | 0 | 4, 16:30 |
| 6 | Marine Drive Promenade, near Churchgate | 18.9430 | 72.8235 | safe | Streetlights working; Crowd around; Police / guard nearby | Police van parked near the steps. Lit and busy past midnight. | 13 | 0 | 2, 20:50 |
| 7 | Station Service Lane, Borivali West | 19.2297 | 72.8561 | unsafe | Pitch dark; Stalking reported; Isolated lane | No lights behind the station parking. One woman reported being followed to the main road. | 7 | 0 | 1, 22:50 |
| 8 | College Lane near Mithibai College, Vile Parle West | 19.1056 | 72.8372 | caution | Stray dogs; No shops nearby | Lane behind the college canteen. Stray dogs gather after classes. Shops shut by 8 PM. | 5 | 0 | 4, 16:40 |
| 9 | Senapati Bapat Marg Subway, Lower Parel | 18.9935 | 72.8315 | unsafe | Broken streetlights; Pitch dark | Pedestrian subway stretch has three lamps out and no staff on duty. | 7 | 0 | 3, 23:30 |
| 10 | Thane Station Skywalk, Thane West | 19.1863 | 72.9748 | caution | Dim / flickering lights; Poor visibility at turn | Skywalk stairs toward Gokhale Road: half the lights flicker. Crowd thins after 11 PM. | 4 | 0 | 2, 23:05 |

Mix: 4 safe, 3 caution, 3 unsafe. Every filter pill must show at least one pin on first launch. The "Nighttime Reports Only" filter must show at least 6.

---

## 4. Clean Modular File Structure

```
jugnu/
  index.html
  styles.css
  data.js
  app.js
  LEARNING_GUIDE.md
```

### 4.1 `index.html`

Viewport-locked semantic layout. Head: meta tags from 2.6, title "Jugnu - Women's Safety Map", Google Fonts, Leaflet CSS, `styles.css`. Body (in order): `<div id="map">`, `<header class="top-bar">`, `<div id="scrim">`, sections, `<nav class="dock">`, `<div id="toast">`, call screen. Scripts at the end of body: Leaflet JS, Lucide JS, `data.js`, `app.js`.

DOM contract:
- Map container: `#map`
- Search: `#search-form`, `#search-input`, `#search-clear`, `#search-results`
- Filter pills: `#filter-bar`, `button.pill[data-filter="all|unsafe|caution|safe|night"]`
- Scrim: `#scrim`
- Welcome sheet: `#welcome-sheet`, `#btn-open-map`
- Inspect card: `#inspect-card`, `#inspect-area`, `#inspect-badge`, `#inspect-tags`, `#inspect-note`, `#inspect-time`, `#inspect-daynight`, `#inspect-trust`, `#btn-confirm`, `#btn-resolve`, `#btn-close-inspect`
- Report sheet: `#report-sheet`, `#report-area`, `[data-status="safe|caution|unsafe"]` inside `#status-options`, `#chip-group`, `#note-input`, `#note-count`, `#btn-publish`, `#btn-close-report`
- Dock buttons: `#btn-locate`, `#btn-report`, `#btn-exit-call`, `#btn-sos`
- Zoom buttons: `#btn-zoom-in`, `#btn-zoom-out`
- Toast: `#toast`
- Fake call: `#call-screen`, `#call-name`, `#call-status`, `#btn-answer`, `#btn-decline`, `#btn-end-call`, `#call-controls`

### 4.2 `styles.css`

- Section order: custom properties and font variables; reset; type scale; layout; top bar and pills; dock; sheets and cards; chips and buttons; call screen; toast; Leaflet overrides; animations.
- Dark tile filter exactly as in 2.5.
- Marker styles: `.jugnu-pin` (drop-in animation), `.pin-pulse` (CSS keyframes ring behind the pin, per-level speed), `.zone-safe/.zone-caution/.zone-unsafe` glow, `.target-ring`, `.user-dot` with `.user-dot-pulse`, `.search-ring`.
- Smooth bottom-sheet transitions driven by `.is-open` class.
- `@media (prefers-reduced-motion: reduce)` block removing animations/transitions.
- Hide default Leaflet zoom control and show custom zoom buttons only under `@media (pointer: fine)`.

### 4.3 `data.js`

Global class `SafetyStore`.

### 4.4 `app.js`

Application controller.

### 4.5 `LEARNING_GUIDE.md`

Viva preparation and architecture guide for 1st-year computer engineering student.
