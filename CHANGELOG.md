# Changelog

All notable changes to Viewportable Engine are documented here.

## Unreleased

### Added

- Structural base-vs-candidate comparison for sibling overlap and parent containment.
- Conservative cross-version node matching using authored IDs/test attributes with structural-path fallback.
- `--baseline-url` CLI mode with `.slice/structural-diff.json`; introduced changes fail the run while resolved-only changes remain non-failing evidence.
- Canonical sampled-width range aggregation for repeated structural relationship changes while preserving raw per-viewport evidence.
- Exact binary boundary refinement for introduced structural ranges with shared width-level probe caching and `--no-boundary` support.
- Conservative structural reparenting plus explicit-identity appearance/disappearance changes, integrated with canonical ranges and exact boundary refinement.
- GitHub Action structural compare mode via optional `baseline-url`, with dynamic report paths, compare-aware job summaries, artifact upload, and end-to-end Action smoke coverage.
- Canonical structural `findings[]` contract plus opt-in managed PR evidence comments that update in place and link back to the uploaded structural artifact.
- Opt-in managed `Viewportable Engine` Check Run on the PR head SHA, with deterministic update semantics, canonical finding summary, artifact/workflow details link, and Engine-to-Check conclusion mapping.
- GitHub App Installation V1 control-plane slice with signed webhook ingress, installation/repository/project synchronization, deterministic PR review identity, server-side installation-token authentication, and App-owned Check Run completion from Engine results.
- Public golden PR lifecycle proof in PR #44, showing an exact 350-499px regression caught while ordinary CI stayed green, followed by a fix verified through the same managed PR evidence lifecycle.



## 0.1.0-rc.1 - 2026-09-19

### Added

- Deterministic responsive scans across configured viewport widths.
- Stable machine-readable `.slice/results.json` reports and exit codes for clean, findings, and scanner/setup failure.
- Horizontal overflow detection with deepest-element evidence and root-cause grouping.
- Exact per-issue breakpoint search for horizontal overflow, fixed-element collisions, and fixed-content occlusions.
- Conservative CSS diagnosis for pixel `min-width` and uniquely attributable authored fixed pixel `width`.
- Fixed-element collision detection.
- Fixed-content occlusion detection using paint-order evidence.
- Application readiness gating with `--ready-selector`.
- `slice.config.json` project configuration with CLI-over-config precedence.
- Deterministic detector-specific suppressions that retain suppressed evidence in JSON.
- Composite GitHub Action with job summary, artifact upload, and the same scanner/report contract as the CLI.
- Demo and Responsively harnesses plus end-to-end CI coverage.
- Real-project Openings Golden Acceptance harness using the historical pre-fix regression and consecutive clean fixed runs.
- One-command RC preflight that composes deterministic, browser, demo, release-layout, and Openings golden gates.
- Tag-driven GitHub release workflow with release validation, composite-Action smoke, and an attached package tarball.

### Changed

- Repository references now point to `viewportable/engine`.
- Package metadata now declares repository, homepage, issue tracker, and AGPL licensing.
- npm package identity is fixed as `@viewportable/slice` while the executable remains `slice`.
- npm publication remains intentionally disabled with `"private": true` until release approval.
- Tagged releases require package-version/tag agreement and immutable GitHub Action references instead of `@main`.

### License

- GNU Affero General Public License v3.0 only (`AGPL-3.0-only`).
