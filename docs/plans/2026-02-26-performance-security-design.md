# Performance & Security Improvement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve initial load speed and map interaction responsiveness while hardening security headers and rate limiting.

**Architecture:** Three parallel tracks — (1) reduce critical-path bundle size and prioritize API calls, (2) memoize map data filtering and reduce WebGL layer count, (3) add CSP, security headers, and shared rate limiting.

**Tech Stack:** Vite (build config), TypeScript (frontend), Vercel (deployment/headers), Deck.GL (map rendering)

---

## Task 1: Lazy-load ML Worker module

**Files:**
- Modify: `src/services/ml-worker.ts:10,88`

**Step 1: Convert static worker import to dynamic import**

Replace the static import on line 10:
```typescript
// BEFORE (line 10):
import MLWorkerClass from '@/workers/ml.worker?worker';

// AFTER: remove line 10 entirely
```

Then change worker instantiation (~line 88) to use dynamic import:
```typescript
// BEFORE (~line 88):
this.worker = new MLWorkerClass();

// AFTER:
const { default: MLWorkerClass } = await import('@/workers/ml.worker?worker');
this.worker = new MLWorkerClass();
```

**Step 2: Verify the build compiles**

Run: `cd /home/koide/projects/project-i/worldmonitor && npx tsc --noEmit`
Expected: No new type errors

**Step 3: Verify Vite build succeeds and chunks are preserved**

Run: `npm run build:japan 2>&1 | tail -20`
Expected: `transformers` and `onnxruntime` chunks still present but not referenced from main chunk entry

**Step 4: Commit**

```bash
git add src/services/ml-worker.ts
git commit -m "perf: lazy-load ML worker to defer 700KB+ WASM download"
```

---

## Task 2: Defer country GeoJSON preload

**Files:**
- Modify: `src/App.ts:387-388`
- Modify: `src/services/country-geometry.ts` (ensureLoaded pattern already exists)

**Step 1: Remove blocking preload from App.ts init**

```typescript
// BEFORE (App.ts lines 387-388):
await preloadCountryGeometry();
await this.loadAllData();

// AFTER:
preloadCountryGeometry(); // fire-and-forget, ensureLoaded() guards all consumers
await this.loadAllData();
```

**Step 2: Verify country-geometry.ts already guards with ensureLoaded()**

Read `src/services/country-geometry.ts` and confirm that every public function calls `await ensureLoaded()` before accessing `loadedGeoJson`. The lazy singleton pattern should already handle this.

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/App.ts
git commit -m "perf: defer country GeoJSON preload to unblock initial data loading"
```

---

## Task 3: Prioritize API request loading

**Files:**
- Modify: `src/App.ts` — `loadAllData()` method (~lines 3023-3082)

**Step 1: Restructure loadAllData() into 3 priority tiers**

Replace the flat task array + single `Promise.allSettled()` with:

```typescript
private async loadAllData(): Promise<void> {
  const runGuarded = async (name: string, fn: () => Promise<void>): Promise<void> => {
    if (this.inFlight.has(name)) return;
    this.inFlight.add(name);
    try { await fn(); }
    catch (e) { console.error(`[App] ${name} failed:`, e); }
    finally { this.inFlight.delete(name); }
  };

  // P1: Critical — news, markets, intelligence signals
  const p1: Array<{ name: string; task: Promise<void> }> = [
    { name: 'news', task: runGuarded('news', () => this.loadNews()) },
    { name: 'markets', task: runGuarded('markets', () => this.loadMarkets()) },
  ];
  // Add intelligence signals to P1 if applicable
  if (SITE_VARIANT === 'full' || SITE_VARIANT === 'japan') {
    p1.push({ name: 'intel', task: runGuarded('intel', () => this.loadIntelligenceSignals()) });
  }

  // P2: Important — disasters, military, infrastructure
  const p2: Array<{ name: string; task: Promise<void> }> = [
    { name: 'predictions', task: runGuarded('predictions', () => this.loadPredictions()) },
    { name: 'fred', task: runGuarded('fred', () => this.loadFredData()) },
    { name: 'oil', task: runGuarded('oil', () => this.loadOilAnalytics()) },
  ];
  if ((SITE_VARIANT === 'full' || SITE_VARIANT === 'japan') && this.mapLayers.natural) {
    p2.push({ name: 'natural', task: runGuarded('natural', () => this.loadNatural()) });
  }
  if (this.mapLayers.weather) {
    p2.push({ name: 'weather', task: runGuarded('weather', () => this.loadWeatherAlerts()) });
  }

  // P3: Low priority — remaining feeds
  const p3: Array<{ name: string; task: Promise<void> }> = [
    { name: 'pizzint', task: runGuarded('pizzint', () => this.loadPizzInt()) },
    { name: 'spending', task: runGuarded('spending', () => this.loadGovernmentSpending()) },
  ];
  // ... (add remaining layer-dependent tasks: ais, cables, flights, cyber, techEvents, firms)

  // Launch P1 immediately
  const p1Promise = Promise.allSettled(p1.map(t => t.task));

  // Launch P2 after P1 settles or 500ms (whichever is first)
  const p2Trigger = Promise.race([p1Promise, new Promise(r => setTimeout(r, 500))]);
  const p2Promise = p2Trigger.then(() => Promise.allSettled(p2.map(t => t.task)));

  // Launch P3 after P2 settles or 1500ms from start
  const p3Trigger = Promise.race([p2Promise, new Promise(r => setTimeout(r, 1500))]);
  const p3Promise = p3Trigger.then(() => Promise.allSettled(p3.map(t => t.task)));

  // Wait for all tiers
  await Promise.allSettled([p1Promise, p2Promise, p3Promise]);

  // Log failures
  // ... (reuse existing failure logging pattern)

  this.updateSearchIndex();
}
```

**Step 2: Preserve all existing conditional task additions**

Move all the `if (this.mapLayers.X)` conditional tasks from the original flat array into P2 or P3 as appropriate. The existing `SITE_VARIANT` checks must be preserved exactly.

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/App.ts
git commit -m "perf: prioritize API requests into 3 tiers for faster first paint"
```

---

## Task 4: Memoize filterByTime() results in DeckGLMap

**Files:**
- Modify: `src/components/DeckGLMap.ts` (~lines 516-526, 921-931)

**Step 1: Add memoization cache to DeckGLMap class**

Add private fields to the class:

```typescript
private _timeFilterCache = new Map<string, { timeRange: string; dataVersion: number; result: unknown[] }>();
private _dataVersions = new Map<string, number>();
```

Add a method to track data changes:

```typescript
private bumpDataVersion(key: string): void {
  this._dataVersions.set(key, (this._dataVersions.get(key) ?? 0) + 1);
}
```

Call `bumpDataVersion('earthquakes')` etc. wherever new data is set (e.g., after API responses).

**Step 2: Create memoized filter wrapper**

```typescript
private filterByTimeCached<T>(
  key: string,
  items: T[],
  getTime: (item: T) => Date | string | number | undefined | null
): T[] {
  const dataVer = this._dataVersions.get(key) ?? 0;
  const cached = this._timeFilterCache.get(key);
  if (cached && cached.timeRange === this.state.timeRange && cached.dataVersion === dataVer) {
    return cached.result as T[];
  }
  const result = this.filterByTime(items, getTime);
  this._timeFilterCache.set(key, { timeRange: this.state.timeRange, dataVersion: dataVer, result });
  return result;
}
```

**Step 3: Replace filterByTime calls in buildLayers()**

Replace lines 921-931:
```typescript
// BEFORE:
const filteredEarthquakes = this.filterByTime(this.earthquakes, (eq) => eq.occurredAt);
// ... (11 calls)

// AFTER:
const filteredEarthquakes = this.filterByTimeCached('earthquakes', this.earthquakes, (eq) => eq.occurredAt);
const filteredNaturalEvents = this.filterByTimeCached('naturalEvents', this.naturalEvents, (event) => event.date);
const filteredWeatherAlerts = this.filterByTimeCached('weatherAlerts', this.weatherAlerts, (alert) => alert.onset);
const filteredOutages = this.filterByTimeCached('outages', this.outages, (outage) => outage.pubDate);
const filteredCableAdvisories = this.filterByTimeCached('cableAdvisories', this.cableAdvisories, (advisory) => advisory.reported);
const filteredFlightDelays = this.filterByTimeCached('flightDelays', this.flightDelays, (delay) => delay.updatedAt);
const filteredMilitaryFlights = this.filterByTimeCached('militaryFlights', this.militaryFlights, (flight) => flight.lastSeen);
const filteredMilitaryVessels = this.filterByTimeCached('militaryVessels', this.militaryVessels, (vessel) => vessel.lastAisUpdate);
// clusters and ucdp same pattern
```

**Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/components/DeckGLMap.ts
git commit -m "perf: memoize filterByTime results to eliminate redundant array scans during pan/zoom"
```

---

## Task 5: Early zoom-level bailout in buildLayers()

**Files:**
- Modify: `src/components/DeckGLMap.ts` — `buildLayers()` (~lines 933-1150)

**Step 1: Move zoom checks before data filtering**

Wrap filter+layer groups so data isn't processed for invisible layers:

```typescript
// BEFORE (conceptual):
const filteredEarthquakes = this.filterByTimeCached('earthquakes', ...);
// ... more filters ...
if (mapLayers.natural && filteredEarthquakes.length > 0) {
  layers.push(this.createEarthquakesLayer(filteredEarthquakes));
}

// AFTER: Skip filtering entirely when zoom is too low
let filteredEarthquakes: typeof this.earthquakes = [];
let filteredNaturalEvents: typeof this.naturalEvents = [];
if (mapLayers.natural && this.isLayerVisible('natural')) {
  filteredEarthquakes = this.filterByTimeCached('earthquakes', this.earthquakes, (eq) => eq.occurredAt);
  filteredNaturalEvents = this.filterByTimeCached('naturalEvents', this.naturalEvents, (event) => event.date);
}
```

Apply the same pattern for all zoom-gated layer groups (bases, nuclear, irradiators, spaceports, economic, datacenters).

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/DeckGLMap.ts
git commit -m "perf: skip data filtering for zoom-hidden layers in buildLayers"
```

---

## Task 6: Conditional ghost layer creation

**Files:**
- Modify: `src/components/DeckGLMap.ts` — ghost layer calls in `buildLayers()` (~lines 955, 961, 992, 1013, 1019)

**Step 1: Skip ghost layers when zoom < layer minZoom**

Ghost layers are already inside `if (mapLayers.X)` checks. The optimization is to also skip them when zoom is very low (no point having hit detection for tiny dots):

```typescript
// Add helper
private shouldCreateGhostLayer(layerKey?: keyof MapLayers): boolean {
  const zoom = this.maplibreMap?.getZoom() || 2;
  return zoom >= 3; // Ghost layers only useful at zoom 3+
}
```

Wrap each ghost layer push:
```typescript
// BEFORE:
layers.push(this.createGhostLayer('earthquakes-layer', filteredEarthquakes, ...));

// AFTER:
if (this.shouldCreateGhostLayer()) {
  layers.push(this.createGhostLayer('earthquakes-layer', filteredEarthquakes, ...));
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/DeckGLMap.ts
git commit -m "perf: skip ghost layer creation at low zoom levels"
```

---

## Task 7: Add security headers to vercel.json

**Files:**
- Modify: `vercel.json`

**Step 1: Add security headers for all routes**

Add a new headers entry at the end of the `headers` array:

```json
{
  "source": "/(.*)",
  "headers": [
    { "key": "X-Content-Type-Options", "value": "nosniff" },
    { "key": "X-Frame-Options", "value": "DENY" },
    { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
    { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=()" }
  ]
}
```

**Step 2: Add CSP in report-only mode**

Add to the same entry:

```json
{
  "key": "Content-Security-Policy-Report-Only",
  "value": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.vercel-insights.com https://browser.sentry-cdn.com; connect-src 'self' https://*.worldmonitor.app https://*.koide.io https://us.i.posthog.com https://us-assets.i.posthog.com https://*.sentry.io https://*.upstash.io https://basemaps.cartocdn.com https://api.maptiler.com wss://*.worldmonitor.app; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; worker-src 'self' blob:; child-src blob:"
}
```

**Step 3: Validate JSON syntax**

Run: `cd /home/koide/projects/project-i/worldmonitor && node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('OK')"`
Expected: `OK`

**Step 4: Commit**

```bash
git add vercel.json
git commit -m "security: add CSP (report-only), X-Frame-Options, and security headers"
```

---

## Task 8: Create shared rate limiting module

**Files:**
- Create: `api/_rate-limit.js`
- Modify: `api/rss-proxy.js` (~line 248, handler start)
- Modify: `api/register-interest.js` (~lines 9-22, replace inline rate limit)

**Step 1: Create api/_rate-limit.js**

```javascript
/** @type {Map<string, { windowStart: number; count: number }>} */
const rateLimitMap = new Map();

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.windowStart > 120_000) rateLimitMap.delete(key);
  }
}

/**
 * @param {string} ip
 * @param {{ limit?: number; windowMs?: number }} opts
 * @returns {{ limited: boolean; remaining: number; retryAfter: number }}
 */
export function checkRateLimit(ip, { limit = 60, windowMs = 60_000 } = {}) {
  cleanup();
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.windowStart > windowMs) {
    rateLimitMap.set(ip, { windowStart: now, count: 1 });
    return { limited: false, remaining: limit - 1, retryAfter: 0 };
  }

  entry.count += 1;
  const limited = entry.count > limit;
  const remaining = Math.max(0, limit - entry.count);
  const retryAfter = limited ? Math.ceil((entry.windowStart + windowMs - now) / 1000) : 0;
  return { limited, remaining, retryAfter };
}

/**
 * @param {Request} request
 * @returns {string}
 */
export function getClientIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}
```

**Step 2: Add rate limiting to rss-proxy.js handler**

At the top of the handler function (~line 248), before CORS handling:

```javascript
import { checkRateLimit, getClientIp } from './_rate-limit.js';

// Inside handler, before CORS:
const ip = getClientIp(request);
const { limited, retryAfter } = checkRateLimit(ip, { limit: 60, windowMs: 60_000 });
if (limited) {
  return new Response(JSON.stringify({ error: 'Too many requests' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfter) },
  });
}
```

**Step 3: Refactor register-interest.js to use shared module**

Replace the inline `rateLimitMap`/`isRateLimited` (lines 9-22) with:

```javascript
import { checkRateLimit, getClientIp } from './_rate-limit.js';

// In handler, replace isRateLimited(ip) with:
const ip = getClientIp(request);
const { limited } = checkRateLimit(ip, { limit: 5, windowMs: 60 * 60 * 1000 });
if (limited) {
  return new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 });
}
```

**Step 4: Verify no syntax errors**

Run: `node -c api/_rate-limit.js && node -c api/rss-proxy.js && node -c api/register-interest.js`
Expected: No errors

**Step 5: Commit**

```bash
git add api/_rate-limit.js api/rss-proxy.js api/register-interest.js
git commit -m "security: add shared rate limiting module and protect RSS proxy endpoint"
```

---

## Implementation Order & Dependencies

```
Task 1 (ML lazy-load)          ─┐
Task 2 (GeoJSON defer)          ├─ Independent, can run in parallel
Task 7 (Security headers)       │
Task 8 (Rate limiting)         ─┘
Task 3 (API prioritization)     ─ Depends on Task 2 (same file area)
Task 4 (filterByTime memoize)  ─┐
Task 5 (Zoom bailout)           ├─ Same file, run sequentially
Task 6 (Ghost layers)          ─┘
```
