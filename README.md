# Slice

Slice is deterministic responsive QA for coding agents and CI. It opens one URL in Chromium, scans a configured viewport matrix, detects horizontal overflow, fixed-element collisions, and fixed-content occlusion, searches exact per-issue breakpoint boundaries, groups deterministic layout root causes, and writes machine-readable evidence to `.slice/results.json` - without screenshots or AI-based visual judgment.

The package identity is reserved as **`@viewportable/slice`** and the executable remains **`slice`**. Publishing is intentionally disabled with `"private": true` until the v0.1 release decision.

After package publication, the intended one-shot form is:

```bash
npx @viewportable/slice http://localhost:3000
```

```text
  Slice · http://localhost:3000

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

The first demo is intentionally framework-neutral. Slice consumes a URL, so a static page exercises the same browser/CDP path as Rails, React, or Next.js without adding another framework to debug.

```bash
git clone https://github.com/viewportable/slice.git
cd slice
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

Slice and Responsively can inspect the exact same local URL. Responsively provides the visual multi-device view; Slice provides deterministic evidence for the same page: failing widths, CSS selector, overflow pixels, and the exact breakpoint boundary.

Install and launch Responsively App once. On macOS:

```bash
brew install --cask responsively
```

Then run:

```bash
npm run demo:visual
```

The command prefers `http://127.0.0.1:4173`. If that port is already occupied, it automatically selects a free local port, prints the chosen URL, opens `broken.html` in Responsively through its `responsively://` protocol, and scans that exact same URL with Slice. The server remains running until you press Ctrl-C.

The key comparison is:

```text
Responsively                   Slice
visual overflow                horizontal-overflow
narrow device previews    <=>  failing widths
wide preview is clean     <=>  768 / 1024 PASS
transition point           <=>  exact boundary
visible element            <=>  CSS selector + overflowPx
```

Open `http://127.0.0.1:4173/fixed.html` in Responsively to compare the corrected version. Slice writes the broken-page evidence to `.slice/demo-responsively/results.json`.

For the exact boundary experiment, Slice also scans `742`, `743`, and `744` pixels. A ready-to-import Responsively backup lives at:

```text
examples/responsively/slice-boundary-suite.json
```

Import it from Responsively's device/suite manager, then activate **Slice Boundary 742-744**. This gives three side-by-side previews around the same boundary that Slice reports. With the shared 1px overflow tolerance, the golden result is `742 FAIL / 743 PASS / 744 PASS`, and the reported boundary is `742px` - the last bad width when moving from wide to narrow.


This intentionally exposes an important current product limitation too: a human may perceive one overflowing pricing grid while the current deepest-element detector can report several leaf elements that share the same breakpoint. That is useful evidence for the next root-cause grouping slice.

### Grouped root causes

Slice keeps the deepest overflowing elements as raw evidence, but groups repeated manifestations under a shared overflowing grid or flex layout root when that attribution is deterministic. For the built-in pricing demo, the human-visible problem and machine result now converge:

```text
390   FAIL  section.plan-grid overflows right ... · affected elements
430   FAIL  section.plan-grid overflows right ... · affected elements
768   PASS

Root causes
  root-1  section.plan-grid · breaks at 742px
```

The JSON report preserves every leaf issue in `viewports[].issues`, links grouped leaves with `rootCauseId`, and exposes canonical aggregates in top-level `rootCauses[]`. Horizontal-overflow roots carry diagnosis/boundary evidence; wrapping roots carry parent-level flow and transition evidence.

### Deterministic CSS diagnosis

For grouped layout roots, Slice can explain conservative CSS causes without AI. It recognizes a pixel `min-width` constraint that is wider than the available viewport space, and an authored fixed pixel `width` when that declaration can be attributed uniquely. Because computed `width` is often resolved to pixels even for responsive layouts, Slice does not claim a fixed-width cause unless it can find exactly one matching authored CSS declaration.

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

For SPAs or authenticated/local harnesses, require a visible element that proves the intended application state mounted before Slice scans it:

```sh
slice http://127.0.0.1:4173 --ready-selector 'main[data-app-ready]'
```

If the selector does not become visible within `--timeout`, Slice exits with code `2` and does not write a partial report. This prevents a login, error, or loading shell from being mistaken for a clean application scan.

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

Slice automatically loads this file when it exists. Use `--config path/to/config.json` for another location. Explicit CLI options override config values.

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

Slice detects a minority group of stable siblings moving onto a lower visual row between sampled viewport widths. Cross-viewport identity comes from the normalized browser surface, so snapshot-local node indices are not treated as stable identities.

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

Authored or repeated reflow is evidence, not an automatic suppression. A deliberately wrapping component can still contain a real responsive defect, so Slice preserves the failure until a stronger intentional-reflow policy can distinguish expected flow from suspicious wrapping.

### Fixed-element collision detector

Slice also reports deterministic collisions between independent visible `position: fixed` elements. It ignores full-viewport backdrops, ancestor/descendant fixed pairs, `aria-hidden` subtrees, and overlaps of 1px or less.

```text
390   FAIL  button.target-profile overlaps button.role-shapes | 80x40px
```

Collision issues are stored as `type: "fixed-element-collision"` with both stable selectors, both bounding boxes, overlap width/height/area, and z-index evidence. Exact breakpoint search is issue-specific and applies to fixed-element collisions as well as horizontal overflow.

### Fixed-content occlusion detector

Slice reports a fixed element when it paints above and meaningfully covers a visible enabled interactive target from another DOM branch. The rule is intentionally conservative: the target must be actionable, the fixed element must accept pointer events, overlap must exceed the 1px tolerance, and at least 20% of the target's visible area must be covered.

```text
390   FAIL  button.target-profile covers button.apply | 63% (100x48px)
```

Occlusion issues are stored as `type: "fixed-content-occlusion"` with the occluder and target selectors, both bounding boxes, overlap area, target coverage percentage, z-index values, and DOMSnapshot paint-order evidence. Fixed-vs-fixed overlaps remain the responsibility of `fixed-element-collision`. Exact breakpoint search tracks each occlusion independently, even when unrelated findings exist at both sampled widths.

## GitHub Action

Slice can run as a composite GitHub Action using the same CLI and report schema as local development. The action writes a job summary, uploads the machine-readable report, and preserves the CLI exit semantics: `0` clean, `1` findings, `2` scanner/setup failure.

```yaml
name: Slice

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
        uses: viewportable/slice@v0.1.0-rc.1
        with:
          url: http://127.0.0.1:3000
          config: slice.config.json
```

The action uploads `.slice/results.json` as `slice-results` by default. Use the `out` and `artifact-name` inputs to change those values. Set `install-browser: 'false'` only when Playwright Chromium and its OS dependencies are already installed earlier in the job.

The copy-ready workflow lives at `examples/github/slice.yml`. The repository CI also invokes `uses: ./` against the built-in fixed demo so the published Action surface is exercised end to end.

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

The preflight requires a clean Slice checkout and runs:

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

Then finalize the changelog date and replace the temporary `viewportable/slice@v0.1.0-rc.1` references in this README and `examples/github/slice.yml` with the immutable `viewportable/slice@v0.1.0-rc.1` reference.

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

Slice is licensed under the GNU Affero General Public License v3.0 only (`AGPL-3.0-only`). See [LICENSE](LICENSE) for the full terms.
