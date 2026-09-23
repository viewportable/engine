# Viewportable Engine

Viewportable Engine is deterministic responsive QA for coding agents and CI. It opens one URL in Chromium, scans a configured viewport matrix, detects horizontal overflow, fixed-element collisions, and fixed-content occlusion, searches exact per-issue breakpoint boundaries, groups deterministic layout root causes, and writes machine-readable evidence to `.slice/results.json` - without screenshots or AI-based visual judgment.

The repository and product are **Viewportable Engine**. The compatibility CLI package remains **`@viewportable/slice`** and the executable remains **`slice`**. Publishing is intentionally disabled with `"private": true` until the v0.1 release decision.

After package publication, the intended one-shot form is:

```bash
npx @viewportable/slice http://localhost:3000
```

## See it catch a real PR

[PR #44 - Viewportable catches and verifies a responsive regression](https://github.com/viewportable/engine/pull/44) is the public golden lifecycle proof.

The broken candidate introduced two structural regressions only from **350px through 499px**:

```text
350-499px exact
#checkout-button disappeared
visible -> missing

350-499px exact
#cta reparented
#pricing-card -> #page-root
```

The Golden PR workflow failed while the repository's ordinary CI stayed green. Viewportable published the retained `structural-diff.json`, a failing `Viewportable Engine` Check Run, and one managed PR evidence comment.

A follow-up fix commit restored the structure. The next run changed all sampled widths to PASS, created a successful Check Run for the new head, and updated the **same PR comment** from:

```text
❌ 2 structural regressions introduced
```

to:

```text
✅ No structural regressions introduced
```

The PR body keeps links to both the red and green workflow/check evidence so the failing phase remains inspectable after the managed comment updates in place.

## Use it from coding agents with MCP

Viewportable Engine includes a local stdio MCP server that exposes the same production Engine path to coding agents.

V1 tools:

```text
viewportable_scan
viewportable_compare
```

The MCP layer does **not** reimplement detection. Each tool invokes the built `slice` CLI, reads the same `results.json` or `structural-diff.json`, returns a compact structured result to the agent, and retains the full evidence under:

```text
.slice/mcp/scan-*/
.slice/mcp/compare-*/
```

Build and start it from this repository:

```bash
npm ci
npm run build
node dist/mcp.mjs
```

A generic local MCP client configuration can launch the server with:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/viewportable-engine/dist/mcp.mjs"]
}
```

After package publication, the intended binary is:

```text
viewportable-mcp
```

and the package exposes it alongside the compatibility `slice` CLI.

The tool contract preserves Engine semantics:

```text
exit 0 -> clean
exit 1 -> findings        (successful MCP tool call with product evidence)
exit 2 -> infra_failure   (MCP tool error)
```

MCP structured output uses the strict, versioned **Viewportable Canonical Agent Evidence Contract V5**:

```text
schemaVersion = viewportable.agent-evidence.v5
```

V5 preserves all V4 source evidence and adds a required canonical repair policy to every finding:

```json
{
  "repair": {
    "repairable": true,
    "reason": "deterministic-authored-css"
  }
}
```

If automatic repair is not authorized, `repairable` is `false` with one explicit fail-closed reason such as `unsupported-finding`, `missing-deterministic-source`, `missing-stylesheet-location`, or `missing-authored-location`.

Agents must treat `finding.repair` as authoritative and must not recreate the eligibility decision from source fields independently. The contract is validated at runtime before MCP returns it. Unknown fields are rejected at every schema level. Rich Engine artifacts remain separate and are referenced through `evidence.reportPath`.

See [Canonical Agent Evidence Contract V5](docs/contracts/agent-evidence-v5.md). The [V4](docs/contracts/agent-evidence-v4.md), [V3](docs/contracts/agent-evidence-v3.md), [V2](docs/contracts/agent-evidence-v2.md), and [V1](docs/contracts/agent-evidence-v1.md) contracts remain available as compatibility boundaries.

`viewportable_compare` returns introduced canonical `findings[]` directly to the agent; resolved evidence remains in the retained full structural report. `viewportable_scan` returns failing viewports and canonical root causes while retaining the complete scan report.

### Real build-tool source-map acceptance

The repository also keeps a production-build acceptance path for authored source mapping:

```bash
npm run acceptance:build-tool-source-map
```

The harness builds a temporary React application with pinned Vite 8.3.0 and Dart Sass 1.104.1, CSS Modules, and a PostCSS declaration transform. The acceptance deliberately covers two production CSS paths:

- Vite-native CSS Module output: Vite 8.3.0 currently emits the CSS asset but no CSS `.map` even with `build.sourcemap: true`; the harness records that limitation instead of inventing authored coordinates.
- Sass precompile -> Vite public asset copy: Dart Sass emits an external Source Map v3 with embedded sources, Vite copies the CSS/map unchanged into `dist/`, and Viewportable must map the exact 350-499px protrusion back to the checked-in `test/fixtures/build-tool-source-map/src/Candidate.source.scss`.

Because real build tools often emit source paths such as `../../src/Candidate.source.scss`, GitHub source resolution may use a checkout search only when the path suffix and SHA-256 `sourcesContent` proof identify exactly one file. Zero or multiple verified files fail closed.

Retained acceptance evidence is written under:

```text
.slice/build-tool-source-map-acceptance/
```

### Real build-tool agent repair E2E

The next acceptance closes the repair loop on the same production fixture:

```bash
npm run acceptance:build-tool-agent-repair
```

Normal CI runs this in deterministic `scripted` mode. The harness still uses the packaged MCP server and the real Sass/Vite production build, but the tool choices are scripted so ordinary PR verification does not spend API tokens.

The agent boundary is intentionally narrow:

```text
V5 repairable finding
  ↓
read_source_range        # max 5 lines, bounded byte budget
  ↓
replace_source_line      # attributed line only, exactly one write
  ↓
rebuild_and_compare      # Sass + Vite + viewportable_compare
  ↓
0 findings
```

There is no shell tool and no full-file read tool. The harness asserts that only one source line changed, exactly one write occurred, and the final V5 comparison is clean. Source-map identifiers may arrive as the raw `../../src/...` path, the normalized `src/...` form, or the resolved URL; all accepted aliases map to the same fixed authored target and never enable arbitrary path access.

A repeatable real-model proof is available through the **Real Build-Tool Agent Repair** workflow. It accepts any one of the repository secrets `OPENAI_API_KEY`, `OPENAI_API_TOKEN`, or `OPEN_API_TOKEN`, then uses GPT-5.6 through the OpenAI Responses API with strict JSON-schema function tools and the same three tool handlers as scripted CI. Evidence is retained under `.slice/build-tool-agent-repair/`.

The accepted GPT-5.6 proof on 2026-09-22 read 121 of 258 source bytes, performed exactly one write, used exactly three tool calls (`read_source_range -> replace_source_line -> rebuild_and_compare`), and finished with zero findings. The API run consumed 5,170 total tokens.

### Agent repair coverage matrix

The repair boundary is also tested as a capability matrix:

```bash
npm run acceptance:agent-repair-coverage
```

Positive cases reuse the same constrained three-tool repair loop and production Sass/Vite build:

- responsive `min-width: 400px` protrusion -> one authored-line edit -> clean;
- responsive fixed `width: 400px` protrusion -> the same repair machinery -> clean.

Negative cases intentionally remain non-repairable:

- `disappearance`;
- `reparenting`.

Canonical Agent Evidence V5 marks those findings `repairable: false` with `reason: unsupported-finding`. The matrix consumes that policy directly and exposes zero repair tools instead of asking an agent to infer eligibility or guess a source edit.

The manual **Real Build-Tool Agent Repair** workflow accepts a `min-width` or `width` scenario so either deterministic CSS cause can be re-proven with GPT-5.6.

### Scan-mode authored repair

Scan mode now carries the same deterministic location chain for horizontal-overflow root causes:

```text
viewportable_scan
  ↓
horizontal-overflow finding
  ↓
root-cause CSS diagnosis
  ↓
browser-proven stylesheet location
  ↓
source-map authoredLocation
  ↓
narrow source edit
  ↓
production rebuild
  ↓
viewportable_scan
  ↓
clean
```

The single-scenario production acceptance command is:

```bash
npm run acceptance:build-tool-scan-agent-repair
```

CI runs the broader scan repair coverage matrix:

```bash
npm run acceptance:scan-repair-coverage
```

The matrix uses the same Sass/Vite fixture project as compare-mode acceptance but a dedicated grouped scan page. It proves both deterministic scan root-cause constraints currently authorized by V5:

- `min-width: 700px` from `Scan.source.scss`;
- fixed `width: 700px` from `Scan.width.source.scss`.

For each scenario the harness calls only `viewportable_scan`, requires V5 to mark the grouped finding repairable and retain its V4 authored evidence, reads only a small range around that location, changes exactly one SCSS line, rebuilds production assets, and requires a clean rescan.

### MCP golden agent flow

The repository includes a real stdio MCP acceptance flow using the official MCP client SDK:

```bash
npm run golden:mcp-agent
```

It performs one continuous agent-style lifecycle:

```text
MCP client connects over stdio
        ↓
viewportable_compare
        ↓
broken candidate
        ↓
2 findings @ 350-499px exact
(disappearance + reparenting)
        ↓
candidate is fixed
        ↓
same MCP connection
        ↓
viewportable_compare
        ↓
0 findings
```

The acceptance harness does not call Engine internals directly. It launches the packaged `dist/mcp.mjs`, performs the MCP initialize/list-tools/call-tool protocol through `StdioClientTransport`, and verifies structured output. Full before/after Engine reports plus a compact acceptance record are retained in `.slice/mcp-golden-agent/`.

### Structural baseline comparison

Viewportable Engine can also compare the same UI state between a baseline and candidate URL. This mode reports structural relationship changes instead of treating unusual geometry in one render as a defect by itself.

```bash
slice http://localhost:3001 \
  --baseline-url http://localhost:3000 \
  --widths 390,768,1024
```

The positional URL is the **candidate**. `--baseline-url` is the reference render.

V1 compares:

- sibling overlap: `separate -> overlap` and `overlap -> separate`;
- parent containment: `contained -> protruding` and `protruding -> contained`;
- reparenting when the subject and both old/new parents have unique authored identity and both parent identities persist across versions;
- explicit-identity presence: `visible -> missing` is introduced, while `missing -> visible` is resolved evidence.

Presence changes deliberately ignore structural-path-only identities and ambiguous duplicate authored keys. Reparenting also stays silent when either parent cannot be proven to persist across both versions.

Only **introduced** structural changes make the command exit with code `1`. Resolved changes remain in the report but do not fail the run. Setup/capture failures still use exit code `2`.

The compare report is written separately from ordinary scan output:

```text
.slice/structural-diff.json
```

Repeated observations of the same relationship across adjacent sampled widths are also grouped into canonical sampled ranges. Raw per-viewport changes remain in `viewports[].changes`, while top-level `ranges[]` gives one product-facing unit such as `375-430px`. A missing observation at an intermediate sampled width splits the range.

When an introduced range is bracketed by a sampled viewport where that exact structural fingerprint is absent, the Engine reuses binary boundary search to refine the sampled edge to an exact pixel boundary. For a band observed at `375` and `430`, with clean samples at `320` and `520`, the report can therefore say `350-499px exact | sampled 375-430px`. This applies to overlap, protrusion, disappearance, and reparenting fingerprints through the same range/boundary pipeline. Exact probing is cached by viewport width across fingerprints and can be disabled with `--no-boundary`.

The compare report also exposes top-level `findings[]`, a product-facing contract derived from canonical ranges. Consumers such as GitHub comments do not need detector-specific `StructuralChange` shapes. Each finding carries a deterministic ID, normalized type (`overlap`, `protrusion`, `reparenting`, `disappearance`, or `appearance`), subject and related subjects, sampled/exact width range, baseline/candidate state, and raw evidence fingerprint/boundaries.

```json
{
  "id": "structural-...",
  "category": "structural",
  "type": "reparenting",
  "direction": "introduced",
  "subject": { "key": "id:cta" },
  "sampledRange": { "minWidth": 375, "maxWidth": 430, "widths": [375, 430] },
  "exactRange": { "minWidth": 350, "maxWidth": 499 },
  "baseline": { "state": "parented", "parent": { "key": "id:pricing-card" } },
  "candidate": { "state": "parented", "parent": { "key": "id:page-root" } }
}
```

Example:

```text
  Viewportable Engine compare
  baseline  http://localhost:3000
  candidate http://localhost:3001

  390   FAIL  2 introduced | 0 resolved | 84 matched nodes
        + id:first <> id:second separate -> overlap
        + id:cta in id:card contained -> protruding (right)

  2 introduced | 0 resolved in 1 viewports
  .slice/structural-diff.json
```

Cross-version matching does not rely on Chromium backend node IDs. It prefers stable authored IDs and test attributes, then uses a conservative structural-path fallback with match quality retained in the evidence.

```text
  Viewportable Engine · http://localhost:3000

  320   PASS
  375   PASS
  390   FAIL  nav.main-nav > ul.nav-links overflows right by 18px
  430   PASS
  768   FAIL  .hero-grid overflows right by 24px
  1024  PASS
  1280  PASS
  1440  PASS

  Boundaries
    issue-1  breaks at 712px  (9 probes, range 430-768)

  2 failures in 8 viewports · 3.4s
  .slice/results.json
```

```json
{
  "version": 1,
  "url": "http://localhost:3000",
  "summary": {
    "viewportsChecked": 8,
    "passed": 6,
    "failed": 2,
    "totalIssues": 2,
    "durationMs": 3412
  },
  "viewports": [
    {
      "width": 390,
      "height": 900,
      "status": "fail",
      "issues": [
        {
          "id": "issue-1",
          "type": "horizontal-overflow",
          "severity": "error",
          "selector": "nav.main-nav > ul.nav-links",
          "side": "right",
          "overflowPx": 18
        }
      ]
    }
  ]
}
```

## Five-minute local demo

The first demo is intentionally framework-neutral. Viewportable Engine consumes a URL, so a static page exercises the same browser/CDP path as Rails, React, or Next.js without adding another framework to debug.

```bash
git clone https://github.com/viewportable/engine.git
cd engine
npm ci
npm run demo
```

The demo scans a small standalone pricing site twice: first with an intentional responsive overflow, then with the CSS fix. JSON reports are kept at:

```text
.slice/demo/broken/results.json
.slice/demo/fixed/results.json
```

To see the bug in a browser:

```bash
npm run demo:serve
```

Open `http://127.0.0.1:4173/broken.html`, resize below roughly 744px, and compare it with `/fixed.html`. From a second terminal you can run the production CLI against the live demo:

```bash
npm run demo:scan
```

## Visual demo with Responsively

Viewportable Engine and Responsively can inspect the exact same local URL. Responsively provides the visual multi-device view; Viewportable Engine provides deterministic evidence for the same page: failing widths, CSS selector, overflow pixels, and the exact breakpoint boundary.

Install and launch Responsively App once. On macOS:

```bash
brew install --cask responsively
```

Then run:

```bash
npm run demo:visual
```

The command prefers `http://127.0.0.1:4173`. If that port is already occupied, it automatically selects a free local port, prints the chosen URL, opens `broken.html` in Responsively through its `responsively://` protocol, and scans that exact same URL with Viewportable Engine. The server remains running until you press Ctrl-C.

The key comparison is:

```text
Responsively                   Viewportable Engine
visual overflow                horizontal-overflow
narrow device previews    <=>  failing widths
wide preview is clean     <=>  768 / 1024 PASS
transition point           <=>  exact boundary
visible element            <=>  CSS selector + overflowPx
```

Open `http://127.0.0.1:4173/fixed.html` in Responsively to compare the corrected version. Viewportable Engine writes the broken-page evidence to `.slice/demo-responsively/results.json`.

For the exact boundary experiment, Viewportable Engine also scans `742`, `743`, and `744` pixels. A ready-to-import Responsively backup lives at:

```text
examples/responsively/slice-boundary-suite.json
```

Import it from Responsively's device/suite manager, then activate **Viewportable Engine Boundary 742-744**. This gives three side-by-side previews around the same boundary that Viewportable Engine reports. With the shared 1px overflow tolerance, the golden result is `742 FAIL / 743 PASS / 744 PASS`, and the reported boundary is `742px` - the last bad width when moving from wide to narrow.


This intentionally exposes an important current product limitation too: a human may perceive one overflowing pricing grid while the current deepest-element detector can report several leaf elements that share the same breakpoint. That is useful evidence for the next root-cause grouping slice.

### Grouped root causes

Viewportable Engine keeps the deepest overflowing elements as raw evidence, but groups repeated manifestations under a shared overflowing grid or flex layout root when that attribution is deterministic. For the built-in pricing demo, the human-visible problem and machine result now converge:

```text
390   FAIL  section.plan-grid overflows right ... · affected elements
430   FAIL  section.plan-grid overflows right ... · affected elements
768   PASS

Root causes
  root-1  section.plan-grid · breaks at 742px
```

The JSON report preserves every leaf issue in `viewports[].issues`, links grouped leaves with `rootCauseId`, and exposes canonical aggregates in top-level `rootCauses[]`. Horizontal-overflow roots carry diagnosis/boundary evidence; wrapping roots carry parent-level flow and transition evidence.

### Deterministic CSS diagnosis

For grouped layout roots, Viewportable Engine can explain conservative CSS causes without AI. It recognizes a pixel `min-width` constraint that is wider than the available viewport space, and an authored fixed pixel `width` when that declaration can be attributed uniquely. Because computed `width` is often resolved to pixels even for responsive layouts, Viewportable Engine does not claim a fixed-width cause unless it can find exactly one matching authored CSS declaration.

```text
390   FAIL  section.plan-grid overflows right by 348px | 8 affected elements
      reason: min-width: 720px | 720px wide vs 372px available

Root causes
  root-1  section.plan-grid | breaks at 742px | 8 evidence selectors
          reason: min-width: 720px
          source: .broken .plan-grid @ http://127.0.0.1:4173/styles.css
          likely fix: remove or constrain min-width, or let the layout reflow
```

Source attribution is intentionally conservative: ambiguous or inaccessible stylesheet matches produce no source claim rather than a guess.

### Application readiness

For SPAs or authenticated/local harnesses, require a visible element that proves the intended application state mounted before Viewportable Engine scans it:

```sh
slice http://127.0.0.1:4173 --ready-selector 'main[data-app-ready]'
```

If the selector does not become visible within `--timeout`, Viewportable Engine exits with code `2` and does not write a partial report. This prevents a login, error, or loading shell from being mistaken for a clean application scan.

### Project configuration and suppressions

Put project defaults in `slice.config.json` at the working directory root:

```json
{
  "widths": [320, 390, 430, 768, 1024],
  "height": 900,
  "wait": 100,
  "timeout": 30000,
  "readySelector": "main[data-app-ready]",
  "boundary": true,
  "out": ".slice",
  "ignore": [
    {
      "type": "fixed-content-occlusion",
      "selector": "button.help",
      "targetSelector": "button.dismiss"
    }
  ]
}
```

Viewportable Engine automatically loads this file when it exists. Use `--config path/to/config.json` for another location. Explicit CLI options override config values.

Suppressions are exact and detector-specific rather than heuristic allowlists. A suppressed finding does not fail the viewport, contribute to boundary search, or make the CLI exit with code `1`. The evidence is not discarded: it remains in `viewports[].suppressedIssues`, and the aggregate count is stored in `summary.suppressedIssues`.

Supported suppression shapes are:

```json
[
  {
    "type": "horizontal-overflow",
    "selector": "div.known-strip",
    "side": "right"
  },
  {
    "type": "fixed-element-collision",
    "selector": "button.help",
    "otherSelector": "button.chat"
  },
  {
    "type": "fixed-content-occlusion",
    "selector": "button.help",
    "targetSelector": "button.dismiss"
  }
]
```

### Sibling wrapping and canonical groups

Viewportable Engine detects a minority group of stable siblings moving onto a lower visual row between sampled viewport widths. Cross-viewport identity comes from the normalized browser surface, so snapshot-local node indices are not treated as stable identities.

Raw moved elements remain in `viewports[].issues` as `type: "wrapping"`. Related observations are also grouped by their stable parent into a canonical `type: "wrapping"` entry in top-level `rootCauses[]`, and each active leaf issue links back through `rootCauseId`.

```text
390   FAIL  #footer-links wraps 1 sibling | 4 stay
      evidence: #terms wraps below siblings | 4 stay / 1 wrap
```

The canonical group records structural flow evidence without guessing product intent:

- explicit parent `display: flex|inline-flex` with `flex-wrap: wrap|wrap-reverse`;
- the number of distinct cross-width wrap transitions;
- whether the same parent reflows repeatedly across sampled widths;
- the raw selectors and issue IDs behind every grouped observation.

Explicit flex wrapping is surfaced as an `authored-reflow-candidate` review hint, but the finding remains active. Repeated wrapping alone is not classified as intentional because confirmed failures can also persist across several sampled transitions. Viewportable Engine does not change severity, exit code, or suppression behavior from this assessment.

### Fixed-element collision detector

Viewportable Engine also reports deterministic collisions between independent visible `position: fixed` elements. It ignores full-viewport backdrops, ancestor/descendant fixed pairs, `aria-hidden` subtrees, and overlaps of 1px or less.

```text
390   FAIL  button.target-profile overlaps button.role-shapes | 80x40px
```

Collision issues are stored as `type: "fixed-element-collision"` with both stable selectors, both bounding boxes, overlap width/height/area, and z-index evidence. Exact breakpoint search is issue-specific and applies to fixed-element collisions as well as horizontal overflow.

### Fixed-content occlusion detector

Viewportable Engine reports a fixed element when it paints above and meaningfully covers a visible enabled interactive target from another DOM branch. The rule is intentionally conservative: the target must be actionable, the fixed element must accept pointer events, overlap must exceed the 1px tolerance, and at least 20% of the target's visible area must be covered.

```text
390   FAIL  button.target-profile covers button.apply | 63% (100x48px)
```

Occlusion issues are stored as `type: "fixed-content-occlusion"` with the occluder and target selectors, both bounding boxes, overlap area, target coverage percentage, z-index values, and DOMSnapshot paint-order evidence. Fixed-vs-fixed overlaps remain the responsibility of `fixed-element-collision`. Exact breakpoint search tracks each occlusion independently, even when unrelated findings exist at both sampled widths.

## GitHub Action

Viewportable Engine can run as a composite GitHub Action using the same CLI and report schema as local development. The action writes a job summary, uploads the machine-readable report, and preserves the CLI exit semantics: `0` clean, `1` findings, `2` scanner/setup failure.

```yaml
name: Viewportable Engine

on:
  pull_request:

permissions:
  contents: read

concurrency:
  group: slice-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  responsive-qa:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - name: Start application
        run: |
          npm ci
          npm run start -- --host 127.0.0.1 > /tmp/app.log 2>&1 &
          for attempt in {1..30}; do
            if curl -fsS http://127.0.0.1:3000 >/dev/null; then
              exit 0
            fi
            sleep 1
          done
          cat /tmp/app.log
          exit 1

      - name: Responsive QA
        uses: viewportable/engine@v0.1.0-rc.1
        with:
          url: http://127.0.0.1:3000
          config: slice.config.json
```

The action uploads the rich Engine report plus `.slice/agent-evidence.json` as `slice-results` by default. The sidecar is strict Canonical Agent Evidence V5 and is also exposed through the `agent_evidence_path` Action output. Use the `out` and `artifact-name` inputs to change those values. Set `install-browser: 'false'` only when Playwright Chromium and its OS dependencies are already installed earlier in the job.

For structural PR comparison, pass the candidate URL as `url` and the reference render as `baseline-url`:

```yaml
- name: Compare baseline and candidate
  uses: viewportable/engine@v0.1.0-rc.1
  with:
    url: http://127.0.0.1:3001
    baseline-url: http://127.0.0.1:3000
    out: .slice/compare
    artifact-name: slice-structural-diff
```

When `baseline-url` is set, the Action switches to structural compare mode, writes `structural-diff.json` plus `agent-evidence.json`, renders introduced/resolved structural ranges and canonical V5 repair status in the GitHub job summary, uploads both artifacts, and preserves the same exit contract: `0` no introduced changes, `1` introduced changes, `2` scanner/setup failure. The `result_path` output automatically points to either `results.json` or `structural-diff.json`; `agent_evidence_path` points to the V5 sidecar.

Set `pr-comment: 'true'` to create one managed PR evidence comment. The Action finds its previous marker comment and updates it on subsequent runs instead of creating duplicates. The comment includes exact ranges, baseline/candidate states, base/head SHAs, Engine ref, duration, artifact evidence, and canonical V5 repair status. `Auto-repairable` and `Manual review` labels come only from `agent-evidence.json`; GitHub renderers do not reconstruct repair policy from raw source fields. Grant both `issues: write` and `pull-requests: write` for PR evidence, plus `checks: write` for the managed Check Run:

```yaml
permissions:
  contents: read
  issues: write
  pull-requests: write
  checks: write

# ...
with:
  url: http://127.0.0.1:3001
  baseline-url: http://127.0.0.1:3000
  pr-comment: 'true'
  check-run: 'true'
  source-root: candidate # when the candidate checkout is ./candidate
```

When deterministic source evidence should appear directly on the PR source line, set `source-root` to the candidate repository checkout. The Check writer prefers V4 `authoredLocation` evidence, resolves the source-map path inside that checkout, verifies the local file against the source-map SHA-256 content proof, and confirms the mapped line/column still begins with the attributed property. If authored mapping is unavailable, it falls back to the V3 direct stylesheet verification path. Unsupported, transformed, mismatched, cross-origin, or ambiguous mappings fail closed. If `source-root` is omitted, standalone mode falls back to `GITHUB_WORKSPACE`.

PR commenting and Check Run publishing are deliberately non-blocking: a read-only token, such as on some fork PRs, does not hide or replace the Engine result. The scan/report/artifact and exit code remain authoritative.

### GitHub publishing modes

Direct Action publishing is the **standalone / zero-account mode**. When `check-run: 'true'` is enabled, the Action creates or updates one `Viewportable Engine` Check Run on the PR head SHA. Re-running the same head updates the managed check instead of creating a duplicate. The Check conclusion follows the Engine contract: `0 -> success`, `1 -> failure`, and scanner/setup failure `2 -> action_required`.

In **Viewportable Cloud mode**, leave both direct publishing inputs disabled:

```yaml
with:
  pr-comment: 'false'
  check-run: 'false'
```

The installed Viewportable GitHub App becomes the only canonical Check writer. Its control-plane lifecycle is:

```text
installation_id
  -> repository
  -> Viewportable project
  -> pull_request review
  -> queued App-owned Check Run
  -> executor result
  -> completed App-owned Check Run
```

The first runnable control-plane slice lives in `apps/github-app/`. It verifies signed GitHub webhooks, consumes installation/repository lifecycle events, creates deterministic project/review identities, authenticates with installation access tokens, and completes Checks from returned Engine evidence. Executor result submission accepts canonical `agentEvidence` alongside the rich report so App-owned Checks use the same V5 repair decision as standalone Action mode. App credentials never enter candidate execution.

The HTTP result path has a permanent acceptance:

```bash
npm run acceptance:github-app-v5-result
```

It starts the real App server on an ephemeral local port, queues an App-owned review, rejects an invalid bearer token, submits a real `POST /api/reviews/:id/result` containing the rich report plus Canonical Agent Evidence V5, verifies the resulting `Manual review · unsupported-finding` Check output and `block` decision, and then proves duplicate result delivery is idempotent.

See [ADR-0002](docs/adr/0002-github-app-check-ownership.md).

The copy-ready single-render workflow lives at `examples/github/slice.yml`. A full pull-request example that checks out `base.sha` and `head.sha`, starts both versions, and compares them lives at `examples/github/compare.yml`. The repository CI exercises both Action modes end to end.

## Openings Golden Acceptance

The v0.1 release candidate has a real-project golden harness against `sergii/openings`. It uses the actual historical pre-fix commit `27bc8c0d...` as the broken state and the current local Openings checkout as the fixed state.

```bash
npm run golden:openings
```

The command expects a local Openings Git checkout. It auto-detects common sibling paths, or you can provide it explicitly:

```bash
OPENINGS_REPO=/absolute/path/to/openings npm run golden:openings
```

Acceptance is deliberately stronger than a single screenshot or sample width:

- the historical regression must reproduce a `fixed-content-occlusion`;
- that stable issue must be absent at 767px, present from 768px through 819px, and absent again at 820px;
- per-issue boundary search must report the exact 768px and 819px edges of that historical mismatch window;
- the current Openings checkout must be clean across `320,375,390,430,767,768,819,820,1024,1280,1440`;
- the current checkout is scanned twice on the same local URL;
- the two reports must be byte-equivalent after removing only `timestamp` and `summary.durationMs`.

The run writes retained evidence under:

```text
.slice/golden/openings/broken/results.json
.slice/golden/openings/fixed-1/results.json
.slice/golden/openings/fixed-2/results.json
.slice/golden/openings/summary.json
```

The harness requires a clean Openings working tree by default. Set `OPENINGS_ALLOW_DIRTY=1` only when deliberately validating uncommitted work.

## Release candidate preflight

Before creating an RC tag, run the same local release gate as the maintainer:

```bash
npm ci
npm run preflight:rc
```

The preflight requires a clean Viewportable Engine checkout and runs:

1. formatting, lint, typecheck, unit tests, build, npm package validation, and release-layout validation;
2. Playwright Chromium availability;
3. browser integration tests and built CLI smoke;
4. broken/fixed demo acceptance;
5. Responsively correlation acceptance;
6. the real Openings Golden Acceptance, including exact 768-819px historical boundaries and consecutive-run determinism.

A successful run ends with `RC READY`.

The first RC is prepared only after that pass:

```bash
npm version 0.1.0-rc.1 --no-git-tag-version
```

Then finalize the changelog date and confirm release-facing Action examples in this README and `examples/github/slice.yml` use the immutable `viewportable/engine@v0.1.0-rc.1` reference.

Validate that exact tag contract before committing:

```bash
npm run validate:release -- v0.1.0-rc.1
```

After the release commit is on `main`, create and push the tag:

```bash
git tag v0.1.0-rc.1
git push origin main v0.1.0-rc.1
```

The tag-triggered Release workflow reruns repository/browser/Action checks, creates a package `.tgz` for inspection, and creates a GitHub prerelease. It does **not** publish to npm. Tagged release validation refuses `@main` Action references, so release documentation must point to the immutable tag.

## Local modernization lab

Use Node.js 24 for development. The repository includes a `.node-version` file so version managers can select it automatically.

```bash
git pull
npm ci
npm run lab
```

`npm ci` installs the locked dependencies and Playwright Chromium. The lab then runs the same layers as CI:

1. Oxfmt formatting check.
2. Oxlint static analysis.
3. TypeScript typecheck.
4. Pure unit tests.
5. tsdown production build.
6. npm package validation.
7. Browser integration tests.
8. Real CLI smoke scenarios against local fixtures.

The final smoke phase is intentionally visible. It runs a clean page, a fixed-width overflow page, and the breakpoint fixture that must resolve to exactly 712px.

For the fastest agent feedback without Chromium, run:

```bash
npm run check:fast
```

To run only the visible product smoke after a successful build:

```bash
npm run smoke
```

## License

Viewportable Engine is licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). See [LICENSE](LICENSE) for the full terms.
