# ADR-0001: Standards-first architecture with an internal Surface IR

- Status: Accepted
- Date: 2026-09-19
- Scope: Viewportable Engine
- Related: PR #11, docs/ENGINE_ARCHITECTURE.md, docs/PLATFORM_ADAPTERS.md, docs/research/REDECHECK.md

## Context

The first modular-engine slice introduced a platform-neutral `SurfaceSnapshot` between browser capture and detectors.

That was useful because it separated Chromium-specific capture from layout analysis and made future React Native or Capacitor adapters possible.

However, the initial framing risked turning `SurfaceSnapshot` into a Viewportable-specific public protocol and encouraged us to invent adjacent abstractions ourselves as new needs appeared.

A broader architecture survey shows that most surrounding layers already have standards or mature de facto protocols:

- W3C WebDriver and WebDriver BiDi for browser control and browser events;
- Chrome DevTools Protocol for rich Chromium DOM/layout/accessibility capture;
- platform accessibility and automation APIs for native UI trees;
- Appium/WebDriver-style APIs for cross-platform native automation;
- SARIF for machine-readable analysis findings;
- MCP and JSON Schema for agent-facing structured tools;
- established compiler/linter/telemetry patterns for adapters, intermediate representations, passes, and exporters.

There is no single standard that normalizes rendered UI geometry, relationships, visibility, semantics, paint information, and text across web and native platforms specifically for visual-layout analysis.

That missing layer is where Viewportable should innovate.

## Decision drivers

- avoid proprietary transport where mature standards already exist;
- keep the public compatibility surface small;
- preserve freedom to evolve layout representation and algorithms;
- support web and future native adapters without a DOM-shaped public API;
- keep expensive evidence optional;
- keep deterministic analysis and explanation as the product-specific core.

## Considered options

### Option A - Public universal SurfaceSnapshot protocol

Expose a Viewportable-specific normalized tree as the main public API.

Pros:
- simple conceptual model;
- direct access to engine inputs.

Cons:
- freezes the least-understood part of the system too early;
- makes every platform fit our invented schema;
- couples callers to internal analysis needs;
- duplicates surrounding standards.

### Option B - No normalized IR

Let every detector consume CDP, Playwright, Appium, or platform-native structures directly.

Pros:
- minimal initial abstraction.

Cons:
- detector logic becomes platform-coupled;
- repeated capture/normalization logic;
- difficult cross-platform analysis;
- poor separation between evidence acquisition and interpretation.

### Option C - Standards-first boundaries with an internal Surface IR

Reuse mature protocols externally and normalize only inside the engine.

Pros:
- preserves evolvability;
- keeps platform adapters replaceable;
- enables shared analysis where semantics genuinely overlap;
- avoids inventing transport and ecosystem protocols.

Cons:
- requires explicit normalization work;
- internal IR still needs careful design and benchmarking.

**Chosen: Option C.**

## Decision

Viewportable will use a **standards-first architecture**.

We will reuse existing protocols and data models at system boundaries and keep Viewportable-specific invention concentrated in an **internal rendered-UI intermediate representation** and the analysis performed over it.

The high-level architecture is:

```text
INPUT / CONTROL
CLI | GitHub Action | MCP | API | Electron
                    |
                    v
               ScanRequest
                    |
                    v
CAPTURE ADAPTERS
CDP | WebDriver/BiDi | Appium | native APIs | RN instrumentation
                    |
                    v
        INTERNAL SURFACE IR
                    |
                    v
ANALYSIS PASSES
overflow | protrusion | collision | wrapping | small-range | ...
                    |
                    v
          CANONICAL FINDINGS
                    |
                    v
OUTPUT ADAPTERS
human | JSON | JSONL | SARIF | GitHub | MCP | Electron
```

## Public contracts

The long-lived public contracts should be small.

### ScanRequest

Represents what the caller wants checked:

```text
target
scope
render matrix
enabled analysis
policy
output preferences
```

The same semantic request should be representable through CLI flags, a GitHub Action, an MCP tool, or a future API.

### ScanResult / Finding

Represents the outcome:

```text
summary
findings
evidence
stable identity/fingerprint
render state
optional reproduction information
```

Output adapters may serialize this to Viewportable JSON, SARIF, GitHub Checks, MCP structured output, or human text.

## Internal contract

The rendered UI model is an **internal IR**, not a stable external API.

The current `SurfaceSnapshot` is the first implementation of that IR.

It may later evolve into a richer Surface Graph or another representation without requiring callers to change, as long as `ScanRequest` and `ScanResult` remain compatible.

This distinction is intentional:

```text
public:
ScanRequest -> ScanResult

private:
CDP -> SurfaceSnapshot -> relationship graph -> analysis passes -> evidence fusion
```

## Adapter rule

Adapters translate platform-specific evidence into the internal IR.

Examples:

- Chromium: CDP `DOMSnapshot`, AX tree, CSS and page metadata;
- standards-based web: WebDriver/BiDi where appropriate;
- Capacitor: browser/WebView path first, native evidence only when required;
- Android: accessibility/view hierarchy and automation primitives;
- iOS: XCUITest/accessibility geometry and automation primitives;
- React Native: native hierarchy, Fabric/layout measurement, or explicit dev instrumentation.

We should not create a custom transport or automation protocol when a mature platform protocol already provides the required evidence.

## Analysis-pass rule

Analysis modules operate over the smallest internal capability set they need.

Examples:

```text
element protrusion
  requires: geometry + tree

fixed occlusion
  requires: geometry + tree + paint ordering + interaction semantics

future pixel verifier
  requires: screenshot/pixels
```

Expensive capabilities remain demand-driven. Adding a new analyzer must not add cost to scans that do not enable or require it.

## Output rule

Viewportable keeps a canonical internal finding model, but standard output formats should be used where they fit.

In particular:

- SARIF should be evaluated as a first-class reporter for code-scanning ecosystems;
- MCP structured output should be preferred for agent integration rather than inventing a Viewportable agent protocol;
- GitHub Checks/annotations are output adapters, not the engine's source-of-truth model.

Viewportable-specific JSON remains useful when SARIF or another external format cannot express all layout evidence cleanly.

## What Viewportable owns

Viewportable should own the parts that are genuinely product-specific:

- normalized rendered-surface semantics;
- responsive relationship modeling;
- efficient viewport/state sampling;
- exact and small-range transition discovery;
- layout failure/anomaly detection;
- evidence fusion and optional verification;
- stable issue identity across renders;
- root-cause grouping and explanation;
- deciding how much evidence is enough to produce a useful visual finding.

The product value is not obtaining rectangles from a browser. It is converting a large rendered interface into a small number of high-value, reproducible findings.

## What Viewportable should not reinvent

Unless evidence proves an existing standard is insufficient, do not invent replacements for:

- browser automation;
- native device automation;
- accessibility trees;
- agent tool transport;
- generic schema machinery;
- generic code-analysis interchange formats;
- artifact storage protocols.

## Consequences

### Positive

- Smaller public compatibility surface.
- Freedom to evolve the internal layout model.
- Easier adoption of better platform capture sources.
- More natural CLI, CI, agent, desktop, and future API integration.
- Less engineering spent rebuilding mature infrastructure.
- Clearer differentiation: analysis intelligence rather than transport plumbing.

### Trade-offs

- Adapters must normalize imperfect and platform-specific source models.
- Some findings will remain platform-specific.
- SARIF/MCP/WebDriver cannot represent every Viewportable concept directly, so adapters will still need Viewportable extensions or properties.
- Internal IR design remains a real architecture problem even though it is no longer a public-protocol problem.

## Superseded assumption

The earlier mental model treated `SurfaceSnapshot` as if it might become the universal Viewportable API.

This ADR supersedes that assumption.

`SurfaceSnapshot` is now explicitly an implementation detail of the engine. It is valuable, but it is free to evolve.

## References

- W3C WebDriver: https://www.w3.org/TR/webdriver2/
- W3C WebDriver BiDi: https://www.w3.org/TR/webdriver-bidi/
- Chrome DevTools Protocol: https://chromedevtools.github.io/devtools-protocol/
- Appium: https://appium.io/docs/
- SARIF 2.1.0: https://docs.oasis-open.org/sarif/sarif/v2.1.0/
- Model Context Protocol tools: https://modelcontextprotocol.io/specification/
- ReDeCheck research notes: ../research/REDECHECK.md
