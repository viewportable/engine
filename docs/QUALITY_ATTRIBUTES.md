# Quality Attributes

These are the architecture qualities that should guide implementation choices, ADRs, benchmarks, and trade-offs.

## Determinism

Equivalent inputs and environments should produce equivalent findings.

Avoid hidden heuristics, timing-sensitive behavior, and nondeterministic evidence whenever a deterministic alternative exists.

## Explainability

A finding should be supported by concrete evidence and should be understandable by both a developer and an agent.

Prefer:

```text
what
where
when
evidence
range
likely cause when deterministically attributable
```

over opaque scores.

## Precision before breadth

A smaller set of high-confidence findings is more valuable than broad noisy detection.

New detectors should justify their false-positive cost.

## Performance proportionality

Disabled capabilities should add approximately zero runtime cost.

Expensive evidence such as screenshots, traces, accessibility trees, text ranges, or pixel comparison should be captured only when enabled analysis requires it.

## Composability

New analyzers should normally be additive modules rather than changes to unrelated engine layers.

Platform adapters should normalize evidence without forcing generic analyzers to understand platform-specific transports.

## Evolvability

The internal Surface IR is allowed to evolve.

Public compatibility should be concentrated in stable semantic contracts such as ScanRequest and ScanResult once they are intentionally versioned.

## Portability

Generic layout analysis should avoid DOM-specific assumptions where the required semantics can be represented by a platform-neutral surface model.

Platform-specific capabilities remain valid when they materially improve evidence quality.

## Reproducibility

A finding should carry enough render-state context to reproduce the condition that caused it, including relevant route/screen, viewport/device, locale, theme, state, platform, and other dimensions when applicable.

## Low integration burden

Use mature standards and protocols at system boundaries where possible.

Viewportable should not require users to adopt proprietary transport or device infrastructure when existing ecosystem tools already provide the needed execution environment.
