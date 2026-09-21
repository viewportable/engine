# Design Backlog

This document preserves valuable future directions that are **not current roadmap commitments**.

Moving an item here means "remember and revisit with evidence", not "build next".

## Platform expansion

The committed React Native adapter spike is tracked in `ROADMAP.md`; only uncommitted platform directions belong here.


### Capacitor native verification

- Status: deferred
- Start with the ordinary browser/WebView path.
- Add native/simulator capture only for failures that cannot be reproduced through the web build, such as safe-area, keyboard, or WebView-specific behavior.

### Native iOS / Android adapters

- Status: research-needed
- Prefer XCUITest/accessibility and Android accessibility/UI automation primitives.
- Do not build proprietary device-control infrastructure.

## Analysis capabilities

The committed ReDeCheck-derived sequence (`element-protrusion`, small-range anomaly, wrapping) is tracked in `ROADMAP.md` and `docs/research/REDECHECK.md`.


### Structural base-vs-head comparison

- Status: candidate
- Compare two internal surface/relationship representations and report meaningful layout changes without requiring pixel baselines.

### Pixel/screenshot verification

- Status: deferred
- Candidate libraries: pixelmatch, ODiff.
- Only add after structural benchmark data identifies false-positive classes where visual verification materially improves precision.
- Must remain demand-driven and add zero screenshot cost when disabled.

### Accessibility adapter

- Status: candidate
- Reuse axe-core and platform accessibility semantics where possible.
- Viewportable should add visual-layout checks around accessibility, not attempt to become a replacement accessibility standard.

## Interchange and integration

### SARIF reporter

- Status: research-needed
- SARIF itself can represent results without source locations, but GitHub Code Scanning requires at least one location to display an alert.
- Use SARIF for findings with trustworthy source attribution.
- Keep GitHub Checks / Viewportable JSON / MCP as the natural path for runtime-only UI findings.
- Never fabricate source locations merely to satisfy Code Scanning.
- Research: `docs/research/SARIF_RUNTIME_UI.md`.

### MCP server

- Status: candidate
- Expose high-level tools such as `scan`, `compare`, `explain`, and `reproduce`.
- Use MCP input/output schemas rather than inventing a Viewportable-specific agent transport.

### Public API

- Status: deferred
- Stabilize semantic `ScanRequest` and `ScanResult` contracts before offering a network API.
- Internal Surface IR is explicitly not the public API.

### GitHub App

- Status: deferred
- The App should add orchestration, shared policy, managed configuration, or interaction that a plain GitHub Action cannot provide.
- User runners continue to provide compute.

## Performance

### Spatial index

- Status: research-needed
- Benchmark RBush or another spatial index when generic collision/proximity analysis makes pairwise geometry measurably expensive.
- Do not add it merely because it is theoretically better than O(n^2).

### Capability execution planner

- Status: candidate
- Union capability requirements across enabled analyzers.
- Capture each expensive evidence class once per render.
- Screenshot/ARIA/text-range capture remains lazy.

## Product surface

### Locale and pseudo-localization matrix

- Status: candidate
- Support browser locale, query params, cookies, headers, paths, storage, and authenticated state.
- Add pseudo-expansion and pseudo-RTL after deterministic layout findings are stable.

### Multi-page / changed-scope scanning

- Status: candidate
- Exact URLs, route lists, sitemap, constrained crawl, and changed-route impact mapping.
- Efficiency is part of product value, not only CI optimization.
