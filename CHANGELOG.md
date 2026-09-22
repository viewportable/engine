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
- Local MCP Server V1 using the official TypeScript MCP server SDK and stdio transport, exposing `viewportable_scan` and `viewportable_compare` while reusing the production CLI/report contract and retaining full evidence under `.slice/mcp/`.
- MCP Golden Agent Flow acceptance using the official client SDK over real stdio: broken candidate -> two exact 350-499px canonical findings -> fixed candidate -> zero findings through the same MCP connection.
- Viewportable Canonical Agent Evidence Contract V1 (`viewportable.agent-evidence.v1`): strict versioned agent semantics, runtime validation, normalized scan/compare findings, explicit evidence pointers, and MCP output schema sourced from one Zod contract.
- Deterministic CSS Source Attribution V1 plus Canonical Agent Evidence V2 (`viewportable.agent-evidence.v2`): direct protrusion constraints can carry uniquely proven stylesheet/source path, selector, property, value, and active media context; ambiguous and indirect causes remain `source: null`.
- Deterministic CSS Source Location V1 plus Canonical Agent Evidence V3 (`viewportable.agent-evidence.v3`): browser-proven CSS property ranges are exposed as one-based stylesheet line/column ranges after selector/property/value/media agreement and stylesheet-text verification; ambiguous locations remain `null`.
- GitHub Source Annotations V1: deterministic introduced CSS findings can be attached to exact PR Check Run lines/columns only after candidate-checkout path containment and property/value range re-verification; transformed or unverifiable source locations fail closed, while Cloud/App mode accepts a normalized repo-relative annotation payload from the authenticated executor.
- Source Map Mapping V1 plus Canonical Agent Evidence V4 (`viewportable.agent-evidence.v4`): exact generated CSS property segments can map through inline or same-origin external Source Map v3 data to hash-verified authored source positions; GitHub annotations prefer the authored file when the candidate checkout matches the source-map content proof.
- Real Build-Tool Source Map Acceptance V1: CI production-builds a React fixture with Vite 8.3.0, Sass 1.104.1, CSS Modules, and PostCSS. It records Vite-native CSS source maps as unavailable in this toolchain, then proves the positive production path with Sass-precompiled CSS/maps copied through Vite: Viewportable recovers the authored `Candidate.source.scss` line and produces a hash-verified repo-relative source annotation.
- Real Build-Tool Agent Repair E2E: V4 authored evidence now drives a constrained three-tool repair loop over the production Sass/Vite fixture. CI proves the plumbing without API cost; a manual GPT-5.6 Responses API workflow proves the same read-one-range, write-one-line, rebuild-and-compare flow with strict function tools. The accepted real-model proof read 121/258 source bytes, made one write, used three tool calls, and finished with zero findings.
- Agent Repair Coverage Matrix V1: the same repair loop must clean both deterministic protrusion causes currently supported by authored evidence (`min-width` and fixed pixel `width`). Unsupported `disappearance` and `reparenting` findings are explicitly verified as `source: null` and fail closed with zero repair-tool exposure.
- Scan-Mode Authored Repair V1: horizontal-overflow root-cause diagnosis now carries browser-proven CSS locations and Source Map v3 authored locations into Agent Evidence V3/V4. A production Sass/Vite acceptance proves `viewportable_scan -> authored SCSS -> one-line repair -> rebuild -> clean scan`.
- Agent Repair Policy V1 plus Canonical Agent Evidence V5 (`viewportable.agent-evidence.v5`): every finding now carries an authoritative `repair` decision. Deterministic authored compare protrusions and scan horizontal-overflow findings are repairable; unsupported finding semantics and missing proof layers fail closed with explicit reasons. MCP clients are instructed not to infer repairability independently from source fields.
- Scan Repair Coverage Matrix V1: production Sass/Vite/MCP acceptance now proves both scan-mode direct CSS constraints authorized by V5, pixel `min-width` and uniquely attributed fixed pixel `width`, each through authored SCSS, one-line repair, rebuild, and clean rescan.



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
