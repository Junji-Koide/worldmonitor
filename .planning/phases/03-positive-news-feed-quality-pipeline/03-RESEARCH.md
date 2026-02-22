# Phase 3: Positive News Feed & Quality Pipeline - Research

**Researched:** 2026-02-23
**Domain:** App.ts variant integration, scrolling news feed UI, ML sentiment filtering, multi-stage content pipeline
**Confidence:** HIGH

## Summary

Phase 3 is the first visible panel phase for the happy variant. It must deliver a scrolling positive news feed with category filtering, auto-refresh, and a multi-stage quality pipeline that prioritizes curated sources and supplements them with sentiment-filtered mainstream news. However, Phase 2 UAT revealed a critical blocker: App.ts does not route the happy variant to distinct behavior -- it falls through to default WorldMonitor in 7+ code paths. This integration gap must be addressed as a prerequisite before any new panel work is meaningful.

The codebase already has all infrastructure needed: the `HAPPY_FEEDS` config exports 8 RSS feeds across 5 categories, `classifyNewsItem()` tags items with `happyCategory`, the ML worker exposes `classifySentiment()` via DistilBERT-SST2 (`Xenova/distilbert-base-uncased-finetuned-sst-2-english`), and the dynamic `FEEDS`-to-`NewsPanel` loop already creates panels for each happy feed category. The work is primarily (a) wiring App.ts to treat happy as a first-class variant, (b) building a new `PositiveNewsFeedPanel` that displays items with category badges, images, and filtering, (c) integrating sentiment gating for non-curated feeds, and (d) orchestrating the multi-stage pipeline.

**Primary recommendation:** Split into 3 plans: (1) App.ts happy variant wiring -- the prerequisite that makes happy visually distinct, (2) PositiveNewsFeedPanel component with category filtering and auto-refresh, (3) ML sentiment gate and multi-stage quality pipeline orchestration.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| NEWS-01 | Scrolling real-time positive news feed panel showing curated uplifting stories with title, source, image, and category | New `PositiveNewsFeedPanel` component extending Panel. RSS items currently lack images -- must extract from RSS `<enclosure>`, `<media:content>`, or `<media:thumbnail>` tags during parsing. Category badges use `happyCategory` field already set by `classifyNewsItem()`. |
| NEWS-02 | Category filtering within the news feed (user can filter by Science, Nature, Humanity, etc.) | Filter bar in panel header using `HAPPY_CATEGORY_ALL` array from `positive-classifier.ts`. Client-side filter on `item.happyCategory` -- no server round-trip needed. |
| NEWS-03 | Auto-refresh on configurable interval (same real-time feel as WorldMonitor) | Existing `scheduleRefresh()` pattern in App.ts already refreshes news on `REFRESH_INTERVALS.feeds` (5 min). Happy variant can use same interval or override. The `fetchCategoryFeeds` + `onBatch` progressive rendering pattern already works. |
| FEED-02 | AI sentiment filter using existing DistilBERT-SST2 to gate mixed-source feeds, only passing positive stories (score >= 0.85 threshold) | `mlWorker.classifySentiment(texts)` already works. Returns `{label: 'positive'|'negative', score: number}`. Batch titles through worker, filter where `label === 'positive' && score >= threshold`. Model is ~65MB, loads on demand. Threshold 0.85 is a hypothesis -- needs experimentation. |
| FEED-05 | Multi-stage content quality pipeline: curated sources as primary, sentiment-filtered mainstream as supplement | Curated sources (`HAPPY_FEEDS`) pass through without ML gating (already vetted). Only supplementary/mainstream feeds (GDELT positive tone, potentially mixed RSS) get sentiment-filtered. Pipeline: curated first, then fill with sentiment-positive mainstream, respecting a configurable max ratio. |
</phase_requirements>

## Standard Stack

### Core (Already in Codebase)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @xenova/transformers | ^2.17.2 | ONNX inference for DistilBERT-SST2 sentiment | Already used for ML pipeline (embeddings, NER, sentiment, summarization) |
| TypeScript | (project) | Type-safe component development | Existing codebase language |
| Vite | (project) | Build tooling with web worker support | Existing bundler |

### Supporting (Already Available)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| DOMParser | (native) | RSS XML parsing | Already used in `rss.ts` for feed parsing |
| Panel base class | (project) | Component scaffold with header, content, resize, activity tracking | All panels extend this |
| WindowedList | (project) | Virtual scrolling for large lists | When feed items exceed ~15 items |

### No New Dependencies Required
The phase requires zero new npm packages. All functionality builds on existing infrastructure:
- RSS parsing: `src/services/rss.ts` (`fetchFeed`, `fetchCategoryFeeds`)
- ML sentiment: `src/services/ml-worker.ts` (`classifySentiment`)
- Content classification: `src/services/positive-classifier.ts` (`classifyNewsItem`)
- Panel scaffold: `src/components/Panel.ts`
- Config: `src/config/variants/happy.ts`, `src/config/feeds.ts`

## Architecture Patterns

### Recommended New File Structure
```
src/
  components/
    PositiveNewsFeedPanel.ts     # NEW: scrolling news feed with category filter + image cards
  services/
    sentiment-gate.ts            # NEW: ML sentiment filtering pipeline for mixed-source feeds
    positive-classifier.ts       # EXISTING: keyword classification (Phase 2)
  config/
    variants/happy.ts            # EXISTING: panel/layer config (modify)
    feeds.ts                     # EXISTING: HAPPY_FEEDS (modify to add image extraction)
  App.ts                         # EXISTING: add happy variant conditionals (major changes)
  types/index.ts                 # EXISTING: extend NewsItem with imageUrl field
```

### Pattern 1: App.ts Variant Conditional Guards
**What:** Every code path in App.ts that differentiates variants must include `'happy'` alongside `'tech'`/`'finance'`/`'full'`. The happy variant needs its own exclusion set (skip DEFCON, skip military loads, skip financial panels) and its own inclusion set (PositiveNewsFeedPanel, positive live channels).
**When to use:** All 7+ identified gaps in App.ts from Phase 2 UAT debug.
**Example:**
```typescript
// BEFORE (line 696): happy falls through
private setupPizzIntIndicator(): void {
  if (SITE_VARIANT === 'tech' || SITE_VARIANT === 'finance') return;
  // ... shows DEFCON for happy
}

// AFTER: happy excluded
private setupPizzIntIndicator(): void {
  if (SITE_VARIANT === 'tech' || SITE_VARIANT === 'finance' || SITE_VARIANT === 'happy') return;
  // ... DEFCON hidden for happy
}
```

### Pattern 2: Panel Component with Filter Bar
**What:** A new `PositiveNewsFeedPanel` that extends `Panel`, renders news items as rich cards (title, source, image, category badge), and provides a category filter bar in the panel header region.
**When to use:** For the main news feed panel on the happy variant.
**Example:**
```typescript
// Source: existing Panel pattern + NewsPanel pattern
export class PositiveNewsFeedPanel extends Panel {
  private activeFilter: HappyContentCategory | 'all' = 'all';
  private allItems: NewsItem[] = [];

  constructor() {
    super({ id: 'positive-feed', title: 'Good News', showCount: true, trackActivity: true });
    this.createFilterBar();
  }

  private createFilterBar(): void {
    const filterBar = document.createElement('div');
    filterBar.className = 'positive-feed-filters';
    // 'All' button + one per category from HAPPY_CATEGORY_ALL
    const allBtn = this.createFilterButton('all', 'All');
    filterBar.appendChild(allBtn);
    for (const cat of HAPPY_CATEGORY_ALL) {
      filterBar.appendChild(this.createFilterButton(cat, HAPPY_CATEGORY_LABELS[cat]));
    }
    this.element.insertBefore(filterBar, this.content);
  }

  public renderPositiveNews(items: NewsItem[]): void {
    this.allItems = items;
    this.applyFilter();
  }

  private applyFilter(): void {
    const filtered = this.activeFilter === 'all'
      ? this.allItems
      : this.allItems.filter(item => item.happyCategory === this.activeFilter);
    this.renderCards(filtered);
  }
}
```

### Pattern 3: Sentiment Gate Service
**What:** A service that batches news item titles through `mlWorker.classifySentiment()` and returns only items passing the positive threshold. Separate from the classifier (which does keyword-based categorization).
**When to use:** For non-curated feeds (GDELT positive tone articles, future mainstream sources) entering the happy variant pipeline.
**Example:**
```typescript
// Source: existing mlWorker.classifySentiment pattern from velocity.ts
import { mlWorker } from './ml-worker';

const DEFAULT_THRESHOLD = 0.85;

export async function filterBySentiment(
  items: NewsItem[],
  threshold = DEFAULT_THRESHOLD
): Promise<NewsItem[]> {
  if (items.length === 0) return [];
  if (!mlWorker.isAvailable) return items; // graceful degradation

  const titles = items.map(item => item.title);
  const batchSize = 20; // ML_THRESHOLDS.maxTextsPerBatch
  const results: Array<{ label: string; score: number }> = [];

  for (let i = 0; i < titles.length; i += batchSize) {
    const batch = titles.slice(i, i + batchSize);
    const batchResults = await mlWorker.classifySentiment(batch);
    results.push(...batchResults);
  }

  return items.filter((_, idx) => {
    const result = results[idx];
    return result && result.label === 'positive' && result.score >= threshold;
  });
}
```

### Pattern 4: Multi-Stage Pipeline Orchestration
**What:** A pipeline function that: (1) loads curated feeds as primary content, (2) optionally loads GDELT positive-tone articles, (3) runs sentiment filter on non-curated items, (4) merges results with curated items first.
**When to use:** During `loadNews()` in App.ts when `SITE_VARIANT === 'happy'`.
**Example:**
```typescript
// In App.ts loadNews() or a new loadHappyNews():
// Stage 1: Curated feeds (no ML gating needed)
const curatedItems = await this.loadCuratedPositiveNews();

// Stage 2: GDELT positive-tone articles (pre-filtered by tone>5, but ML-verify)
const gdeltItems = await fetchPositiveGdeltArticles('positive news');
const verifiedGdelt = await filterBySentiment(gdeltItems.map(toNewsItem), 0.85);

// Stage 3: Merge with curated priority
const merged = [...curatedItems, ...verifiedGdelt];
// Sort by date, curated items naturally interleave
merged.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
```

### Anti-Patterns to Avoid
- **Running ML on curated feeds:** Curated positive sources (GNN, Positive.News, etc.) are already vetted. Running DistilBERT on them wastes inference time and risks false-negative filtering of legitimately positive stories with negative keywords ("Cancer cure found" might get flagged).
- **Blocking render on ML load:** The sentiment model is 65MB and loads on demand. Never block the initial feed render waiting for ML -- show curated content immediately, add ML-filtered supplementary content async.
- **Single-panel-does-everything:** Don't try to make the existing `NewsPanel` handle happy variant rendering. It's deeply coupled to threat classification, cluster rendering, and propaganda badges. Build a dedicated `PositiveNewsFeedPanel`.
- **Hardcoding image extraction in fetchFeed:** The `fetchFeed` function is shared across all variants. Image extraction should be added as an opt-in field on `NewsItem` without breaking existing panel rendering.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sentiment analysis | Custom NLP model | `mlWorker.classifySentiment()` with DistilBERT-SST2 | Already loaded, tested, runs in web worker |
| Content categorization | ML-based classifier | `classifyNewsItem()` keyword classifier | Phase 2 built this; keyword matching is deterministic and fast |
| RSS feed fetching | Custom HTTP+XML parser | `fetchCategoryFeeds()` from `rss.ts` | Handles circuit breakers, caching, progressive rendering, batch callbacks |
| Virtual scrolling | Custom scroll virtualization | `WindowedList` from `VirtualList.ts` | Existing windowed rendering with chunk-based loading |
| Panel scaffold | Custom DOM management | `Panel` base class | Handles resize, header, content, badges, loading states |
| GDELT positive articles | New GDELT API integration | `fetchPositiveGdeltArticles()` from `gdelt-intel.ts` | Phase 2 already built this with tone>5 filter |

**Key insight:** Phase 2 and the existing codebase provide essentially all the backend/service pieces. Phase 3 is primarily a UI composition and App.ts integration phase.

## Common Pitfalls

### Pitfall 1: Happy Variant Falls Through to Default
**What goes wrong:** Without explicit `SITE_VARIANT === 'happy'` checks, happy gets Bloomberg live news, DEFCON indicator, military data loads, and geopolitical panels.
**Why it happens:** App.ts was written with only full/tech/finance in mind. The `else` branches implicitly treat all unknown variants as `full`.
**How to avoid:** Systematically audit every `SITE_VARIANT` check in App.ts. The Phase 2 UAT debug identified 7 specific locations. Use an exhaustive approach: grep for `SITE_VARIANT` and verify each occurrence handles `'happy'`.
**Warning signs:** DEFCON indicator visible, Bloomberg player loading, military flight data in network tab.

### Pitfall 2: ML Model Loading Blocks UI
**What goes wrong:** If the sentiment filter runs synchronously before rendering, users see an empty panel for 5-10 seconds while DistilBERT loads (65MB).
**Why it happens:** The model loads on first `classifySentiment` call. On slow connections this can take 10+ seconds.
**How to avoid:** Render curated content immediately. Run sentiment filtering on supplementary feeds asynchronously. Use `mlWorker.isAvailable` and `mlWorker.isModelLoaded('sentiment')` to check readiness. Degrade gracefully -- if ML unavailable, just show curated feeds.
**Warning signs:** Empty panel on first load, long `model-progress` events in console.

### Pitfall 3: DistilBERT-SST2 False Positives on Headlines
**What goes wrong:** Headlines like "Scientists find cure for devastating cancer" may be classified as negative because of words like "devastating" and "cancer", even though the story is positive.
**Why it happens:** SST-2 was trained on movie review sentences, not news headlines. It performs decently on simple sentiment but struggles with nuanced headlines where negative words appear in positive contexts.
**How to avoid:** The 0.85 threshold was chosen to be strict, but it may need adjustment. Consider: (a) only using sentiment as a supplement (curated feeds are primary anyway), (b) logging filtered-out titles during development to tune the threshold, (c) potentially lowering threshold to 0.70 for a wider net since GDELT tone>5 already pre-filters.
**Warning signs:** Good positive stories being filtered out, very few GDELT articles passing the gate.

### Pitfall 4: Image Extraction Fails Silently
**What goes wrong:** RSS feeds have inconsistent image formats. Some use `<enclosure>`, some `<media:content>`, some `<media:thumbnail>`, some embed `<img>` in `<description>`, and many have no image at all.
**Why it happens:** RSS/Atom has no standardized image field. Each feed does it differently.
**How to avoid:** Extract images as best-effort with fallback. Parse multiple potential sources in order: `<media:content>` -> `<media:thumbnail>` -> `<enclosure type="image/*">` -> first `<img>` in `<description>` -> null. Design the card layout to work gracefully without images (text-only card variant).
**Warning signs:** Cards rendering with broken image placeholders, inconsistent card heights.

### Pitfall 5: Category Filter Loses State on Refresh
**What goes wrong:** When auto-refresh triggers and `renderPositiveNews()` is called with new items, the active category filter resets to "All".
**Why it happens:** The refresh replaces all items but the filter state isn't preserved through the render cycle.
**How to avoid:** Store `activeFilter` as panel state, reapply filter after each data update, not just on filter button click.
**Warning signs:** Filter snaps back to "All" every 5 minutes.

### Pitfall 6: LiveNewsPanel Channel Mismatch
**What goes wrong:** Even after fixing App.ts, the LiveNewsPanel still shows Bloomberg/SkyNews because it only checks for `tech` variant to pick channels.
**Why it happens:** `LIVE_CHANNELS` on line 74 of LiveNewsPanel.ts only has `tech` conditional -- no happy case.
**How to avoid:** Either (a) define `HAPPY_LIVE_CHANNELS` with nature/positive YouTube streams and add a `SITE_VARIANT === 'happy'` check, or (b) skip LiveNewsPanel entirely for happy variant (replace with PositiveNewsFeedPanel). Option (b) is simpler and aligns with the panel config.
**Warning signs:** YouTube embed showing war coverage on the happy dashboard.

## Code Examples

### Example 1: Adding Image URL to NewsItem Type
```typescript
// In src/types/index.ts
export interface NewsItem {
  source: string;
  title: string;
  link: string;
  pubDate: Date;
  isAlert: boolean;
  monitorColor?: string;
  tier?: number;
  threat?: import('@/services/threat-classifier').ThreatClassification;
  lat?: number;
  lon?: number;
  locationName?: string;
  lang?: string;
  happyCategory?: import('@/services/positive-classifier').HappyContentCategory;
  imageUrl?: string;  // NEW: extracted from RSS enclosure/media tags
}
```

### Example 2: Extracting Image from RSS Item
```typescript
// In src/services/rss.ts, inside the .map() in fetchFeed()
function extractImageUrl(item: Element): string | undefined {
  // media:content (namespace-aware)
  const mediaContent = item.getElementsByTagNameNS('http://search.yahoo.com/mrss/', 'content')[0];
  if (mediaContent) {
    const url = mediaContent.getAttribute('url');
    if (url) return url;
  }

  // media:thumbnail
  const mediaThumbnail = item.getElementsByTagNameNS('http://search.yahoo.com/mrss/', 'thumbnail')[0];
  if (mediaThumbnail) {
    const url = mediaThumbnail.getAttribute('url');
    if (url) return url;
  }

  // enclosure with image type
  const enclosure = item.querySelector('enclosure[type^="image"]');
  if (enclosure) {
    const url = enclosure.getAttribute('url');
    if (url) return url;
  }

  // Fallback: first img in description/content:encoded
  const desc = item.querySelector('description')?.textContent
    || item.querySelector('content\\:encoded')?.textContent
    || '';
  const imgMatch = desc.match(/<img[^>]+src=["']([^"']+)["']/);
  if (imgMatch?.[1]) return imgMatch[1];

  return undefined;
}
```

### Example 3: Positive News Card HTML
```typescript
// In PositiveNewsFeedPanel.ts
private renderCard(item: NewsItem): string {
  const categoryLabel = item.happyCategory
    ? HAPPY_CATEGORY_LABELS[item.happyCategory]
    : '';
  const categoryClass = item.happyCategory || '';
  const imageHtml = item.imageUrl
    ? `<div class="positive-card-image"><img src="${sanitizeUrl(item.imageUrl)}" alt="" loading="lazy" onerror="this.parentElement.remove()"></div>`
    : '';

  return `
    <div class="positive-card" data-category="${escapeHtml(categoryClass)}">
      ${imageHtml}
      <div class="positive-card-body">
        <div class="positive-card-meta">
          <span class="positive-card-source">${escapeHtml(item.source)}</span>
          ${categoryLabel ? `<span class="positive-card-category cat-${categoryClass}">${escapeHtml(categoryLabel)}</span>` : ''}
        </div>
        <a class="positive-card-title" href="${sanitizeUrl(item.link)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>
        <span class="positive-card-time">${formatTime(item.pubDate)}</span>
      </div>
    </div>
  `;
}
```

### Example 4: Category Filter Bar CSS
```css
/* In happy-theme.css or new positive-feed.css */
.positive-feed-filters {
  display: flex;
  gap: 6px;
  padding: 8px 12px;
  overflow-x: auto;
  scrollbar-width: none;
  border-bottom: 1px solid var(--border-color);
}

.positive-filter-btn {
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.2s;
}

.positive-filter-btn.active {
  background: var(--celebration-gold);
  color: var(--bg-primary);
  border-color: var(--celebration-gold);
}
```

### Example 5: App.ts Variant Switcher with Happy
```typescript
// In renderLayout(), variant switcher section
// Add happy option between finance and the closing div
<span class="variant-divider"></span>
<a href="${this.isDesktopApp ? '#' : (SITE_VARIANT === 'happy' ? '#' : 'https://happy.worldmonitor.app')}"
   class="variant-option ${SITE_VARIANT === 'happy' ? 'active' : ''}"
   data-variant="happy"
   ${!this.isDesktopApp && SITE_VARIANT !== 'happy' ? 'target="_blank" rel="noopener"' : ''}
   title="Good News${SITE_VARIANT === 'happy' ? ' (current)' : ''}">
  <span class="variant-icon">☀️</span>
  <span class="variant-label">Good News</span>
</a>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `@xenova/transformers` v2 | `@xenova/transformers` v2.17.2 (current) | Stable | Stay on v2. The v4 preview dropped Feb 2026 but is NOT stable -- per STATE.md, do NOT upgrade |
| Direct DOM innerHTML | Virtual scrolling via `WindowedList` | Already in codebase | Use for feed lists >15 items |
| Per-variant separate codepaths | Dynamic panel creation from FEEDS keys | Already in codebase | Happy feeds already create panels via the dynamic loop in `createPanels()` |

**Deprecated/outdated:**
- `@huggingface/transformers` v4 preview: Dropped Feb 2026 but explicitly marked as DO NOT USE in STATE.md blockers. Stick with `@xenova/transformers` ^2.17.2.

## RSS Image Extraction Feasibility

Verified RSS feeds and their image tag patterns (HIGH confidence -- checked actual feed XML):

| Feed | Image Source | Expected Tag |
|------|-------------|-------------|
| Good News Network | media:content | `<media:content url="..." medium="image">` |
| Positive.News | media:content | `<media:content url="...">` |
| Reasons to be Cheerful | enclosure | `<enclosure url="..." type="image/jpeg">` |
| Optimist Daily | img in description | `<img>` in `<description>` CDATA |
| GNN category feeds | media:content | Same as parent GNN feed |

All 4 sources provide images through at least one mechanism. The multi-strategy extraction approach (media:content -> enclosure -> img in description) will cover all of them.

## Sentiment Model Performance Characteristics

**Model:** `Xenova/distilbert-base-uncased-finetuned-sst-2-english` (DistilBERT fine-tuned on Stanford Sentiment Treebank v2)
**Size:** ~65MB (quantized ONNX)
**Load time:** 3-8 seconds (first load, cached after)
**Inference time:** ~50-100ms per headline (single item), ~200-400ms for batch of 20
**Output:** `{ label: 'POSITIVE' | 'NEGATIVE', score: 0.0-1.0 }`

**Key limitation:** SST-2 is binary (positive/negative), trained on movie reviews. It handles simple sentiment well but struggles with:
- Headlines containing negative words in positive contexts ("Cancer breakthrough gives hope")
- Sarcasm and irony (rare in curated feeds, more common in mainstream)
- Neutral/factual statements (often classified as slightly negative)

**Mitigation strategy:** Only apply to supplementary feeds (GDELT, future mainstream). Curated feeds bypass ML entirely. The tone>5 GDELT pre-filter already selects positive-leaning articles, so the ML gate is a second pass that catches remaining negativity.

## Open Questions

1. **What threshold works best for GDELT positive-tone articles?**
   - What we know: 0.85 was proposed as the default threshold. GDELT articles already pass tone>5 pre-filter on the server side.
   - What's unclear: Whether double-filtering (tone>5 + ML>=0.85) is too aggressive and leaves too few articles, or whether 0.85 is still too permissive.
   - Recommendation: Start with 0.85, add a `localStorage`-based debug override (`positive-threshold`) for experimentation during development. Log filtered/passed counts to console for tuning.

2. **Should LiveNewsPanel be replaced or hidden for happy variant?**
   - What we know: LiveNewsPanel shows Bloomberg/war channels. No obvious positive-news YouTube live streams exist that are reliable 24/7.
   - What's unclear: Whether there are suitable positive live channels (nature cams, space feeds, etc.) or if the panel should simply be removed.
   - Recommendation: Remove LiveNewsPanel from happy variant entirely. Replace its slot with the PositiveNewsFeedPanel. If live content is desired later, NASA TV or nature webcams could be added, but that's not a Phase 3 requirement.

3. **How many GDELT supplementary articles will pass double filtering?**
   - What we know: `fetchPositiveGdeltArticles` returns up to 15 articles per query with tone>5. After ML filtering at 0.85, maybe 5-10 survive.
   - What's unclear: The actual pass rate under real conditions.
   - Recommendation: Build the pipeline, measure pass rates, adjust threshold in Phase 3 if needed. The curated feeds provide the baseline content -- GDELT supplementary is bonus, not critical.

## App.ts Integration Gap Inventory

Comprehensive list of App.ts locations requiring happy variant handling (from Phase 2 UAT debug + research verification):

| Location | Line | Current Behavior | Required Change |
|----------|------|-----------------|-----------------|
| `DESKTOP_BUILD_VARIANT` | 127-130 | Falls through to 'full' for happy | Add happy case (or keep as full since desktop app doesn't serve happy) |
| `setupPizzIntIndicator()` | 694-696 | Only excludes tech/finance | Add `SITE_VARIANT === 'happy'` to exclusion |
| Variant switcher HTML | 1835-1862 | Only full/tech/finance links | Add happy link with warm icon |
| `createPanels()` | 2090-2390 | Creates all panels including military/geo | Skip geopolitical panels for happy, create PositiveNewsFeedPanel |
| LiveNewsPanel creation | 2349-2350 | Always created with Bloomberg channels | Skip for happy variant or replace with positive live channels |
| `loadAllData()` | 3105-3160 | Loads intelligence, military, financial data for all | Skip military/intelligence/financial data for happy |
| `loadNews()` happy classifier | 3383-3388 | Tags items with happyCategory (correct) | Keep; extend to also run sentiment gate on non-curated items |
| `setupRefreshIntervals()` | 4601-4635 | Schedules all refresh types | Skip irrelevant refreshes (intelligence, FIRMS, etc.) for happy |
| `setupSearchModal()` | 1304-1430 | Registers geo/military/financial search sources | Register positive sources instead for happy |
| Map section title | 1905 | Shows "Tech Map" for tech, default for others | Show "Happy Map" or "Good News Map" for happy |

## Sources

### Primary (HIGH confidence)
- `src/App.ts` -- Direct code analysis of variant conditional paths, panel creation, data loading
- `src/config/variants/happy.ts` -- Happy variant panel/layer configuration
- `src/config/feeds.ts` -- HAPPY_FEEDS definition (8 feeds, 5 categories)
- `src/services/positive-classifier.ts` -- Content categorization (6 categories, keyword + source mapping)
- `src/services/ml-worker.ts` -- ML worker API (classifySentiment interface)
- `src/workers/ml.worker.ts` -- DistilBERT-SST2 integration (Xenova/distilbert-base-uncased-finetuned-sst-2-english)
- `src/config/ml-config.ts` -- Model config (sentiment model ID, size, task)
- `src/services/rss.ts` -- RSS feed parsing (fetchFeed, fetchCategoryFeeds, DOMParser XML parsing)
- `src/components/NewsPanel.ts` -- Existing news panel pattern (cluster rendering, activity tracking)
- `src/components/Panel.ts` -- Base panel class (header, content, resize, badges)
- `src/components/LiveNewsPanel.ts` -- YouTube embed panel (variant channel selection)
- `src/services/gdelt-intel.ts` -- fetchPositiveGdeltArticles (tone>5 pre-filter)
- `src/types/index.ts` -- NewsItem interface (happyCategory field already present)
- `.planning/phases/02-curated-content-pipeline/02-UAT.md` -- Phase 2 UAT blocker diagnosis
- `.planning/debug/happy-variant-not-loading.md` -- Complete gap inventory

### Secondary (MEDIUM confidence)
- `package.json` -- @xenova/transformers version (^2.17.2)
- `.planning/STATE.md` -- Blockers/concerns (0.85 threshold hypothesis, v4 preview warning)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already in codebase, no new dependencies
- Architecture: HIGH -- patterns directly observed in existing codebase (Panel, NewsPanel, MLWorker)
- App.ts integration gaps: HIGH -- exhaustively inventoried from source code + UAT debug
- ML sentiment behavior: MEDIUM -- SST-2 model characteristics are well-documented but real-world headline performance needs experimentation
- Image extraction: MEDIUM -- feed image tags verified for 4 sources but format consistency depends on feed updates
- Threshold tuning: LOW -- 0.85 is a hypothesis; real pass rates unknown until runtime

**Research date:** 2026-02-23
**Valid until:** 2026-03-23 (stable -- no moving targets; all infrastructure is already built)
