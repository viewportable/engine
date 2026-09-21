# Modular Engine Architecture

Slice is expected to evolve into the Viewportable engine. The engine should be modular and composable from the beginning, without turning detector development into plugin-framework work and without charging runtime cost for disabled capabilities.

## System context

Viewportable Engine sits between callers that request visual verification and platform runtimes that can render a UI.

```text
Human / Agent / CI / Desktop
           |
           v
      ScanRequest
           |
           v
    Viewportable Engine
      /           \
     v             v
browser/native   findings/reporters
runtime          GitHub/MCP/JSON/UI
```

The engine does not own application deployment, CI compute, browser/device farms, or product source code. It consumes reachable/renderable targets and produces structured findings.

## Goals

1. Keep the deterministic layout engine small and fast.
2. Make new analysis capabilities additive rather than invasive.
3. Allow future modules such as pixel comparison, accessibility analysis, localization stress testing, or visual verification without forcing them into every scan.
4. Share expensive browser evidence once per viewport and reuse it across detectors.
5. Keep the machine-readable finding contract stable even as internal implementations evolve.
6. Preserve a simple development loop: a detector should be easy to add, test, benchmark, and remove.

## Non-goals

The initial architecture does not need:

- runtime package discovery;
- third-party detector loading;
- a dependency injection framework;
- a generic event bus;
- screenshots for every viewport;
- AI in the critical detection path;
- a separate process per detector.

Those mechanisms can be introduced only if a real use case justifies them.

## Pipeline

The intended engine shape is:

```text
target
  |
browser/runtime
  |
capture
  |
normalized surface snapshot
  |
detectors
  |
optional verifiers
  |
diagnosis/grouping
  |
findings
  |
reporters
```

The important boundary is between **capturing evidence** and **interpreting evidence**.

Today Slice already captures Chromium layout data with CDP `DOMSnapshot.captureSnapshot`, including DOM rects and paint order. Detectors should consume a normalized internal representation instead of each detector independently querying the page.

## Capability-driven execution

Each detector should declare the evidence it needs.

Conceptually:

```ts
type Capability =
  | "geometry"
  | "computed-styles"
  | "paint-order"
  | "dom-relationships"
  | "text-ranges"
  | "aria"
  | "screenshot"
  | "pixels";

interface Detector {
  id: string;
  requires: Capability[];
  detect(context: DetectorContext): Promise<FindingCandidate[]>;
}
```

This is a design direction, not a commitment to this exact TypeScript API.

The execution planner unions the requirements of enabled modules:

```text
overflow detector     -> geometry + computed styles
occlusion detector    -> geometry + paint order
future wrapping       -> geometry + relationships
future axe adapter    -> aria
future pixel verifier -> screenshot + pixels
```

If no enabled detector requires screenshots, the browser must not capture screenshots. If several detectors need the same DOM snapshot, it is captured once.

This gives us a useful invariant:

> Disabled capabilities should have approximately zero runtime cost.

## Modules, not microservices

A "module" should initially be a normal TypeScript unit with a small contract and focused tests. Modularity is a code boundary, not a deployment boundary.

Good:

```text
capture/
model/
detect/
verify/
diagnose/
report/
```

Premature:

```text
plugin loader
RPC between detectors
one package per rule
one process per capability
```

We should split packages only when release cadence, dependency weight, or reuse creates a concrete need.

## Candidate and verifier separation

Some detectors can prove a finding from structural evidence alone. Others can cheaply identify a candidate and then use a more expensive verifier.

Example:

```text
geometry collision candidate
        |
        +-- deterministic proof -> finding
        |
        +-- ambiguous -> optional visual verification
                          |
                          screenshot/pixel evidence
```

This lets future visual verification reduce false positives without turning every scan into a screenshot-diff run.

## Stable finding protocol

The public report schema should remain independent of detector implementation details.

A finding should answer:

- what happened;
- where it happened;
- at which viewport/state/locale;
- what deterministic evidence supports it;
- what range of widths is affected when known;
- whether optional verification strengthened or rejected the candidate;
- what confidence or proof level applies, if we introduce such a concept.

Internal module versions can change without forcing consumers to understand the internal pipeline.

## Performance rules

New modules must not silently make the default scan slower.

Before enabling a capability by default, measure at least:

- median scan duration;
- browser round trips;
- number of viewport renders/probes;
- bytes of screenshots or other artifacts produced;
- memory usage on representative large pages.

Prefer:

1. one browser session;
2. one normalized capture per viewport;
3. shared caches;
4. deterministic structural analysis first;
5. expensive evidence only for suspicious cases;
6. early stop where a rule has enough evidence.

## Development-speed rules

Architecture is only useful if adding a detector remains cheap.

A new detector should normally require:

1. a detector implementation;
2. focused fixtures;
3. unit/integration tests;
4. schema changes only when genuinely new evidence is required;
5. benchmark coverage when it introduces a new expensive capability.

It should not require changes across CLI, GitHub Action, reporter, browser setup, and unrelated detectors.

## Third-party primitives

We should distinguish product intelligence from commodity primitives.

Reasonable dependencies or adapters:

- Playwright for browser automation;
- Chromium CDP DOMSnapshot for deep layout capture;
- a spatial index such as RBush if pairwise geometry becomes expensive;
- axe-core for accessibility rules;
- pixelmatch or ODiff if/when pixel verification is justified.

Viewportable-owned logic should remain ours:

- responsive relationship model;
- viewport/range sampling;
- breakpoint discovery;
- layout failure detectors;
- grouping and root-cause logic;
- locale/theme/state matrices;
- evidence fusion;
- finding semantics and agent-oriented explanations.

## Versioning philosophy

New capabilities should arrive incrementally.

For example, adding pixel verification in a future major release should mean:

```text
existing structural engine
        +
optional screenshot capability
        +
pixel verifier module
```

not a rewrite of the scan pipeline.

The core architectural requirement is therefore:

> Viewportable should become more capable by composition, while the cheapest useful scan stays cheap.


## Platform-neutral surface boundary

The first implementation of the modular engine introduces a small `SurfaceSnapshot` contract between capture and detection. Browser layout nodes remain richer than the minimum surface node, but generic geometry work should increasingly depend on the minimum normalized fields rather than browser DOM details.

Platform-specific adapters are documented in [PLATFORM_ADAPTERS.md](PLATFORM_ADAPTERS.md). The immediate goal is not React Native support itself. The goal is to make browser evolution avoid assumptions that would make a future React Native or Capacitor adapter unnecessarily expensive.


## Standards-first boundary model

The engine architecture is governed by [ADR-0001](adr/0001-standards-first-surface-ir.md).

The key distinction is:

```text
public semantics:
ScanRequest -> ScanResult / Finding

internal implementation:
platform adapter -> Surface IR -> analyzers -> evidence fusion
```

`SurfaceSnapshot` is an internal IR, not a public protocol. It may evolve or be replaced without forcing external callers to change.

Existing standards should be used at system boundaries where they fit:

- WebDriver / WebDriver BiDi and Playwright for browser automation;
- CDP for rich Chromium capture;
- Appium and platform-native automation/accessibility APIs for native capture;
- MCP for agent tool exposure;
- SARIF for analysis-result interchange.

The proposed public semantic contract is documented in [RFC-0001](rfcs/0001-scan-contract.md).


## Architecture quality and risk references

Architecture trade-offs should be evaluated against [Quality Attributes](QUALITY_ATTRIBUTES.md).

Known architectural risks and technical debt are tracked separately in [Risks and Technical Debt](RISKS.md), so the Design Backlog does not become a risk register.

Shared terminology is defined in [Glossary](GLOSSARY.md).
