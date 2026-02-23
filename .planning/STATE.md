# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-22)

**Core value:** Every piece of content on the dashboard makes the viewer feel genuinely better about humanity
**Current focus:** Phase 4 in progress - Global Map & Positive Events (1/3 plans done)

## Current Position

Phase: 4 of 9 (Global Map & Positive Events)
Plan: 1 of 3 in current phase (04-01 complete)
Status: In Progress
Last activity: 2026-02-23 -- Completed 04-01-PLAN.md (Map Layer Config & Happy Variant Toggles)

Progress: [#########.] 91%

## Performance Metrics

**Velocity:**
- Total plans completed: 10
- Average duration: 15 min
- Total execution time: 2.4 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 3 | 120 min | 40 min |
| 02 | 3 | 7 min | 2 min |
| 03 | 3 | 9 min | 3 min |
| 04 | 1 | 4 min | 4 min |

**Recent Trend:**
- Last 5 plans: 1m, 3m, 3m, 3m, 4m
- Trend: Phase 4 started -- consistent pace

*Updated after each plan completion*
| Phase 04 P01 | 4 | 2 tasks | 9 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Roadmap]: Curated feeds before ML filtering -- research confirms sentiment false positives (sarcasm, ironic headlines) make ML-only gating unreliable. Curated sources are primary, ML is supplement.
- [Roadmap]: Only 2 new npm deps needed (papaparse, canvas-confetti) -- everything else uses existing infrastructure.
- [Roadmap]: WHO GHO API may be deprecated -- use World Bank as primary for health indicators to de-risk.
- [01-01]: Favicon paths handled via regex replacement in htmlVariantPlugin -- single index.html source of truth.
- [01-01]: Google Fonts loaded unconditionally (minimal overhead, CSS scoping prevents visual impact on non-happy variants).
- [01-01]: Hostname-based variant detection extended to all variants (tech, finance, happy) in inline script.
- [01-02]: Semantic colors use celebration/nature metaphors: gold=critical, sage=growth, blue=hope, pink=kindness.
- [01-02]: Dark mode uses deep navy (#1A2332) base, never pure black.
- [01-02]: --panel-radius introduced as CSS variable (14px) for downstream panel rounding in Plan 03.
- [01-03]: CSS @layer base introduced to control cascade -- happy-theme overrides sit outside @layer so they always win over :root defaults.
- [01-03]: data-variant attribute set on <html> from SITE_VARIANT enables pure-CSS variant scoping without runtime JS.
- [01-03]: Self-hosted MapLibre style JSONs with CARTO CDN tile sources -- pattern for per-variant basemaps.
- [02-01]: 8 feeds from 4 verified positive sources (GNN, Positive.News, Reasons to be Cheerful, Optimist Daily) -- unverified sources excluded.
- [02-01]: GDELT tone_filter appended server-side to query string, sort param replaces hardcoded 'date' -- backward compatible with empty defaults.
- [02-01]: Existing fetchGdeltArticles() passes empty toneFilter/sort to satisfy generated type requirements without changing behavior.
- [02-02]: Priority-ordered keyword tuples (Array<[string, category]>) guarantee evaluation order -- specific keywords checked before generic.
- [02-02]: Default category is 'humanity-kindness' for curated positive sources that don't match any keyword.
- [02-02]: Source-based pre-mapping for GNN category feeds (fast path) before keyword scan (slow path).
- [02-03]: In-place for..of mutation in loadNewsCategory() since items array already referenced by closures.
- [02-03]: Classification after fetchCategoryFeeds completes (not in onBatch callback) -- final render uses complete set.
- [03-01]: Additive-only guards -- all changes use SITE_VARIANT !== 'happy' to avoid touching full/tech/finance paths.
- [03-01]: Natural map layer kept for happy variant (earthquakes informational, not geopolitical).
- [03-01]: InsightsPanel available for all variants since it adapts to available data.
- [03-01]: Defense-in-depth for LiveNewsPanel: both panel creation gating AND empty channels array.
- [03-02]: CSS variable names in plan were hypothetical -- mapped to actual happy theme vars (--yellow for gold, --green for sage, --semantic-info for hope-blue, --red for kindness-pink).
- [03-02]: Category badge colors: science=blue, nature=green, kindness=pink, innovation=gold, climate=#2d9a4e, culture=#8b5cf6.
- [03-02]: extractImageUrl uses 4-strategy fallback with try/catch per strategy -- never throws, always returns undefined on failure.
- [03-03]: GdeltArticle field mapping: article.date (not seenDate), article.image (not socialImage) -- adapted to actual API shape.
- [03-03]: Two-phase render: curated RSS renders immediately, GDELT+ML supplements async -- never blocks UX on ML.
- [03-03]: happyAllItems accumulator: reset at loadNews() start, concat in loadNewsCategory(), consumed in pipeline.
- [04-01]: Happy variant layer toggles use hardcoded English labels (no i18n keys yet, consistent with Phase 3 pattern).
- [04-01]: Legend colors: green for positive, gold for breakthrough, light green for kindness, orange for natural (matches happy theme warm palette).

### Pending Todos

None yet.

### Blockers/Concerns

- MEDIUM risk: Sentiment threshold (0.85) now implemented with localStorage override ('positive-threshold') -- still needs experimentation.
- LOW risk: Positive.News RSS added in 02-01 (URL verified). Future Crunch excluded (unverified RSS URL).
- LOW risk: @huggingface/transformers v4 preview dropped Feb 2026 -- do NOT use, stick with existing v2/v3 stable.

## Session Continuity

Last session: 2026-02-23
Stopped at: Completed 04-01-PLAN.md (Map Layer Config & Happy Variant Toggles)
Resume file: .planning/phases/04-global-map-positive-events/04-01-SUMMARY.md
