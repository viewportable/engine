# Protocol and Interchange Survey

Status: initial architecture survey

This note records which parts of the Viewportable system already have mature external standards and which part remains genuinely product-specific.

The conclusion is captured in [ADR-0001](../adr/0001-standards-first-surface-ir.md).

## Layer map

| Layer | Existing standards / mature primitives | Viewportable role |
| --- | --- | --- |
| Browser control | WebDriver, WebDriver BiDi, Playwright | consume, do not replace |
| Chromium deep capture | Chrome DevTools Protocol / DOMSnapshot / AX | consume and normalize |
| Native automation | XCUITest, Android UI/accessibility APIs, Appium | consume through adapters |
| Agent tools | MCP + JSON Schema | expose high-level tools |
| Analysis interchange | SARIF | provide reporter/adapter |
| Rendered visual-layout IR | no single cross-platform standard found | internal Viewportable IR |
| Responsive/anomaly analysis | research/tools exist, no common engine standard | primary Viewportable intelligence |

## Browser control

W3C WebDriver defines language- and platform-neutral browser automation semantics.

WebDriver BiDi adds a bidirectional event-oriented protocol.

Playwright provides a higher-level automation API and already supports the browser lifecycle Slice uses today.

Decision implication:

> Do not create a Viewportable browser-control protocol.

Use the richest reliable source for each adapter, with CDP remaining appropriate for Chromium-specific layout capture.

References:

- https://www.w3.org/TR/webdriver2/
- https://www.w3.org/TR/webdriver-bidi/
- https://playwright.dev/

## Chromium capture

Chrome DevTools Protocol exposes DOM, DOMSnapshot, CSS, Accessibility, Page and related domains.

Slice already uses `DOMSnapshot.captureSnapshot` with DOM rectangles and paint order.

Decision implication:

> Browser capture should translate CDP evidence into the internal Surface IR instead of detectors making ad hoc browser calls.

Reference:

- https://chromedevtools.github.io/devtools-protocol/

## Native UI hierarchy and automation

Native platforms already expose UI/accessibility hierarchies and screen geometry.

Cross-platform tools such as Appium build WebDriver-like automation over platform drivers.

Decision implication:

> Future native adapters should translate platform trees into the internal IR rather than forcing native apps to imitate the DOM.

References:

- https://appium.io/docs/
- https://developer.android.com/reference/android/view/accessibility/AccessibilityNodeInfo
- https://developer.apple.com/documentation/xcuiautomation

## Agent-facing interface

MCP already defines discoverable tools with JSON-schema input and structured output.

Decision implication:

> If Viewportable exposes agent-native operations, prefer an MCP server over a proprietary agent protocol.

Likely semantic tools:

```text
viewportable.scan
viewportable.compare
viewportable.explain
viewportable.reproduce
```

The MCP layer should translate into the same engine-level `ScanRequest` used by CLI/CI.

Reference:

- https://modelcontextprotocol.io/specification/

## Findings interchange

SARIF is an OASIS standard for static-analysis result interchange and is consumed by GitHub code scanning and other ecosystems.

Useful concepts include:

- rule IDs;
- levels;
- messages;
- locations and related locations;
- fingerprints;
- arbitrary properties.

Decision implication:

> Add a SARIF reporter rather than inventing a second generic diagnostics interchange format.

Not every rendered-UI concept maps naturally to source locations, so canonical Viewportable findings remain richer than SARIF.

Reference:

- https://docs.oasis-open.org/sarif/sarif/v2.1.0/
- https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning

## Architecture analogies

The architecture is not novel in shape.

### Compiler pipelines

```text
many frontends -> common IR -> analysis/optimization passes -> targets
```

### ESLint

```text
parser/AST -> independent rules -> diagnostics
```

### OpenTelemetry Collector

```text
receivers -> normalized data -> processors -> exporters
```

Viewportable follows the same family:

```text
capture adapters -> Surface IR -> analyzers -> canonical findings -> output adapters
```

The product differentiation is the rendered-surface model and analysis quality, not the existence of an adapter/pipeline pattern.

## Gap that Viewportable fills

There is no widely adopted cross-platform representation discovered in this survey that combines the properties needed for deterministic visual-layout analysis:

- screen geometry;
- parent/child and sibling relationships;
- visibility;
- rendered text geometry;
- interaction semantics;
- clipping and scrolling context;
- paint/occlusion evidence;
- responsive state over viewport ranges;
- locale/theme/font-scale/application state.

Accessibility trees are too semantic and incomplete for layout.

DOM is web-specific.

Appium/XML/page-source representations are platform-dependent and not designed as a visual-analysis IR.

CDP is rich but Chromium-specific.

Therefore a private normalization layer remains justified.

## Next research questions

1. Which minimum node identity survives across viewport changes and base/head versions?
2. Which capabilities belong in the base IR versus optional evidence stores?
3. How much of canonical Finding can map losslessly to SARIF?
4. Should `ScanRequest` be specified in JSON Schema now or only after one additional caller beyond CLI?
5. Which WebDriver BiDi capabilities can eventually replace Chromium-only CDP without reducing evidence quality?
6. What subset of Surface IR is truly cross-platform enough for the first React Native spike?
