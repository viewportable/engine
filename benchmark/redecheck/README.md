# ReDeCheck Benchmark

This benchmark measures the current Viewportable/Slice engine against the independently collected ISSTA 2017 ReDeCheck corpus.

## Ground truth

The corpus repository contains 26 archived responsive web pages.

The benchmark oracle comes from the manually classified ReDeCheck results archive, not from Viewportable heuristics. The archive groups true-positive reports into 33 distinct responsive layout failures (Distinct RLFs).

Sources and exact immutable commits are pinned in `sources.json`.

No archived third-party web pages are vendored into this repository. The benchmark downloads the external corpus into `.cache/redecheck/` when explicitly run.

## Why Distinct RLFs

ReDeCheck can emit multiple reports for the same underlying visual defect. Its authors manually grouped those reports under one Distinct RLF ID.

A single Distinct RLF can also have multiple ReDeCheck report classes. For example, CloudConvert RLF #1 is both an `Element Collision` report and a `Small-Range` report at 980px. Viewportable therefore models the oracle as `Distinct RLF -> reports[]`, not as one failure type per RLF.

Viewportable scores against the 33 distinct problems rather than the much larger number of raw ReDeCheck reports.

## Baseline classifications

The automatic baseline is intentionally conservative.

For every distinct RLF the benchmark emits one of:

- `candidate-match` - Slice emitted a rule compatible with at least one report attached to the Distinct RLF at a sampled width inside that report's oracle range;
- `missed` - Slice has a compatible current rule family, but emitted no compatible finding inside the oracle range;
- `unsupported` - current Slice has no corresponding detector family;
- `environment-error` - the archived page could not be scanned reliably.

A `candidate-match` is **not** automatically called a true detection because page + viewport range + rule family can still coincide with an unrelated issue. Candidate matches are the review queue.

## Current rule-family mapping

| ReDeCheck class | Current Slice mapping | Support |
| --- | --- | --- |
| Viewport Protrusion | `horizontal-overflow` | compatible |
| Element Collision | `fixed-element-collision` | partial, fixed elements only |
| Element Protrusion | none | unsupported |
| Small-Range | none | unsupported |
| Wrapping | none | unsupported |

Some Distinct RLFs carry more than one class, so these rows are detector-family mappings rather than mutually exclusive problem counts. This means the first baseline is expected to expose capability gaps. That is the point.

## Sampling

For each page, the runner samples:

- standard anchor widths;
- each true-positive range minimum;
- midpoint;
- maximum.

This guarantees at least one probe inside narrow oracle ranges such as 990-991px or 476-480px.

Boundary search is disabled for the baseline because the corpus already supplies expected ranges. We measure detector behavior first and keep exact-boundary search as a separate existing capability.

## Run

```bash
npm run benchmark:redecheck
```

The command:

1. downloads/checks out pinned external benchmark sources;
2. builds Slice;
3. generates the 33-RLF oracle;
4. serves the corpus locally;
5. scans every archived page;
6. writes JSON and Markdown summaries.

Outputs:

```text
.slice/benchmarks/redecheck/oracle.json
.slice/benchmarks/redecheck/results.json
.slice/benchmarks/redecheck/summary.md
.slice/benchmarks/redecheck/pages/*/results.json
```

## Benchmark principles

- Do not silently update source commits.
- Do not vendor the archived sites without explicit redistribution review.
- Do not count unsupported classes as misses.
- Do not count candidate matches as confirmed detections without identity/evidence review.
- Record scanner/environment failures separately from detector misses.
- Preserve raw per-page Slice results for later reclassification.
