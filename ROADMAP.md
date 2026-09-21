# Standalone v0.1 Roadmap

Slice v0.1 is a deterministic responsive QA CLI for coding agents. Desktop UI, Viewportable integration, Figma, screenshot diffing, AI visual judgment, multi-page crawling, and generic flow-overlap detection remain explicitly out of scope for v0.1.

## Release finish line

v0.1.0 is done when Slice can be installed, configured, run locally or in CI, produce stable actionable findings on real applications, distinguish product findings from scanner/setup failures, and reproduce its release-candidate results deterministically.

## Phase 1 - Per-issue boundaries - Complete

- Stable issue identity across adjacent sampled widths.
- Independent exact transition search per issue.
- Supported issue types:
  - `horizontal-overflow`
  - `fixed-element-collision`
  - `fixed-content-occlusion`
- Regression coverage for overlapping issue ranges where an existing issue must not hide a new one.

Merged as `b4607a2`.

## Phase 2 - Config and suppressions - Complete

- Automatic `slice.config.json` loading.
- Explicit `--config` path.
- CLI-over-config precedence.
- Exact detector-specific suppressions.
- Suppressed findings remain available in `viewports[].suppressedIssues`.
- Suppressed findings do not affect active status, boundary search, or exit code 1.

Merged as `cf63583`.

## Phase 3 - Deterministic diagnosis expansion - Complete for v0.1

- Pixel `min-width` diagnosis.
- Authored fixed pixel `width` diagnosis.
- Unique stylesheet source attribution required for fixed-width claims.
- Ambiguous or inaccessible source attribution does not produce a guessed cause.

Merged as `96f469c`.

Further flex/grid and `white-space: nowrap` diagnosis rules are deferred until they can meet the same attribution standard.

## Phase 4 - GitHub Action - Complete

- Composite action using the same CLI and report schema.
- Job summary.
- `.slice/results.json` artifact upload.
- Exit-code preservation.
- Copy-ready workflow with `cancel-in-progress: true`.
- End-to-end CI smoke using `uses: ./`.

Merged as `6b719cf`.

## Phase 5 - Package and release hygiene - RC preparation complete

Completed:

- Repository references moved to `viewportable/slice`.
- Repository/homepage/bugs package metadata.
- Explicit `AGPL-3.0-only` license.
- Full `LICENSE` file.
- `CHANGELOG.md` for v0.1.0.
- npm package identity fixed as `@viewportable/slice`.
- CLI binary remains `slice`.
- Accidental npm publication blocked with `"private": true` until release.
- Openings Golden Acceptance harness prepared around the real historical regression.
- One-command `preflight:rc` release gate.
- Release-layout validation for package identity and composite Action runtime files.
- Tagged release validation that requires immutable Action references.
- Tag-driven GitHub Release workflow with full verification and a package inspection artifact.
- npm publishing remains explicitly out of the RC workflow.

Completed for the first RC:

- Local `preflight:rc` and Openings Golden Acceptance passed on 2026-09-19.
- Package version bumped to `0.1.0-rc.1`.
- Release-facing Action examples pinned to `viewportable/slice@v0.1.0-rc.1`.
- RC changelog finalized.

Remaining:

- Merge the RC preparation commit after CI is green.
- Validate the exact tag contract on the release commit.
- Tag `v0.1.0-rc.1` only after the release commit is green.

npm scope ownership/permissions are required only before a future npm publication, not for the GitHub RC.

## Phase 6 - Real-project acceptance - Complete

Accepted on 2026-09-19 against Openings HEAD `d15848c681b4ce348b34a4ef5849ba5d1308d58a`.

- Historical broken state reproduced the known fixed-content occlusion only from 768px through 819px.
- Exact issue boundaries were reported at 768px and 819px.
- Current Openings was clean across the full golden width matrix.
- Two consecutive fixed-state reports were identical apart from `timestamp` and `summary.durationMs`.
- Full `npm run preflight:rc` completed with `RC READY`.

## Historical v0.1 exclusions

These items document what was intentionally outside the v0.1 release scope. They are not the current future-work queue; current uncommitted engine directions live in [docs/DESIGN_BACKLOG.md](docs/DESIGN_BACKLOG.md).

- Electron/Desktop viewport board.
- Viewportable product integration.
- Figma overlay/reference comparison.
- Screenshot or visual-regression diffing.
- AI-based issue detection or diagnosis.
- MCP/agent orchestration beyond consuming the existing CLI/JSON contract.
- Multi-page crawling.
- Generic overlapping-flow-element detection.


## Post-v0.1 engine direction

Slice is expected to evolve into the Viewportable engine. Future capability work should follow the modular, capability-driven architecture in [docs/ENGINE_ARCHITECTURE.md](docs/ENGINE_ARCHITECTURE.md): disabled capabilities should add approximately zero runtime cost, expensive browser evidence should be captured at most once per viewport and shared, and detector modules should remain simple TypeScript units rather than a heavy plugin framework.

Initial responsive-layout research is tracked in [docs/research/REDECHECK.md](docs/research/REDECHECK.md). ReDeCheck's Responsive Layout Graph, small-range anomaly detection, wrapping/protrusion models, regression graph comparison, and independent failure corpus are research inputs rather than runtime dependencies.

The first post-v0.1 implementation slice is the platform-neutral `SurfaceSnapshot` and composable detector contract. It must preserve current findings and default runtime characteristics while creating a clean adapter boundary between browser capture and analysis. Platform adapter direction is documented in [docs/PLATFORM_ADAPTERS.md](docs/PLATFORM_ADAPTERS.md).

The first post-v0.1 research sequence is:

1. benchmark current Slice against the independently collected ReDeCheck corpus;
2. measure concrete capability gaps before extending the model;
3. prototype the smallest useful relationship-interval representation;
4. add element protrusion, small-range anomaly, and wrapping detectors one at a time;
5. keep screenshot/pixel verification optional until structural evidence shows where it reduces false positives enough to justify its cost.


After the structural web model proves itself, run a deliberately small React Native adapter spike: normalize one simulator-rendered screen into `SurfaceSnapshot` and prove that an existing shared geometry detector can find a real layout defect without algorithm changes. Capacitor should reuse the browser path first because its UI remains WebView-based.


## Documentation and contract architecture

The architecture knowledge model is now explicit:

- `docs/adr/` for accepted architectural decisions;
- `docs/research/` for evidence and prior art;
- `docs/rfcs/` for cross-cutting proposals and public-contract drafts;
- `docs/DESIGN_BACKLOG.md` for valuable but uncommitted directions;
- `docs/QUALITY_ATTRIBUTES.md` for architecture decision criteria;
- `docs/RISKS.md` for risks and technical debt;
- `docs/GLOSSARY.md` for shared terminology;
- this roadmap for sequenced intended work;
- `CHANGELOG.md` for implemented/shipped changes.

ADR-0001 establishes a standards-first architecture: Viewportable reuses mature protocols at external boundaries, keeps Surface IR internal, and concentrates product-specific engineering in rendered-surface normalization and analysis.

The contract work remains deliberately non-blocking. ReDeCheck benchmarking and the first new structural detector can continue while `ScanRequest` and canonical `Finding` semantics mature through additional callers.
