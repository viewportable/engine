# RFC-0001: Scan Contract

- Status: Proposed
- Date: 2026-09-19
- Scope: Public semantic contract
- Related ADR: ../adr/0001-standards-first-surface-ir.md

Related:

- [ADR-0001: Standards-first architecture with an internal Surface IR](../adr/0001-standards-first-surface-ir.md)
- [Engine Architecture](../ENGINE_ARCHITECTURE.md)
- [Protocol and Interchange Survey](../research/PROTOCOLS_AND_INTERCHANGE.md)

## Summary

Define the semantic public contract `ScanRequest -> ScanResult` shared by CLI, GitHub Action, MCP, Electron, and a future HTTP API without exposing the internal Surface IR.

## Purpose

All Viewportable entry points should express the same semantic operation:

```text
ScanRequest -> Viewportable Engine -> ScanResult
```

The transport may differ:

```text
CLI
GitHub Action
MCP
Electron
future HTTP API
```

but the meaning of the request and result should not.

This document defines that meaning without freezing a wire format.

## Design principles

1. The caller describes what to verify, not how capture works internally.
2. CDP, Appium, XCUITest, Fabric and other capture details stay behind adapters.
3. Internal Surface IR is never the primary public response.
4. Render-state dimensions are explicit and composable.
5. Findings remain semantic objects even if detector implementations change.
6. Expensive evidence is policy-driven and lazy.
7. Equivalent environments should produce reproducible requests and findings.

## ScanRequest

A request has six conceptual parts:

```text
target
scope
matrix
analysis
policy
evidence
```

### Target

What is being rendered.

```json
{
  "kind": "url",
  "url": "http://localhost:3000"
}
```

Possible future target kinds include URL, local static build, preview deployment, React Native simulator/app, and native app/session.

### Scope

Which parts of the target should be checked.

```json
{
  "kind": "routes",
  "routes": ["/checkout", "/pricing"]
}
```

Potential forms: exact route, explicit route list, prefix, changed surface, sitemap, constrained crawl, or current native screen.

### Matrix

Which render states should be evaluated.

```json
{
  "viewports": [
    { "width": 320, "height": 900 },
    { "width": 390, "height": 900 }
  ],
  "locales": ["en", "de"],
  "themes": ["light", "dark"]
}
```

Future dimensions may include browser engine, device, platform, font scale, authenticated state, feature flags, RTL, reduced motion, and high contrast.

### Analysis

Which product-level analysis families should run.

```json
{
  "include": ["layout"]
}
```

Candidate families: layout, accessibility, localization-layout, structural-regression, visual-verification.

### Policy

How findings affect the run.

```json
{
  "failOn": "error",
  "suppressions": []
}
```

Policy is logically separate from detector implementation.

### Evidence

How much supporting evidence to retain.

```json
{
  "mode": "on-finding"
}
```

Candidate modes: minimal, on-finding, full/debug. The default should avoid screenshots and traces when they are unnecessary.

## ScanResult

A result contains run metadata, summary, render states checked, findings, and optional evidence/artifact references.

Conceptual example:

```json
{
  "status": "fail",
  "summary": {
    "surfacesChecked": 12,
    "findings": 2
  },
  "findings": [
    {
      "id": "issue-1",
      "ruleId": "layout/element-protrusion",
      "severity": "error",
      "message": "Checkout button protrudes 24px outside its container",
      "renderState": {
        "route": "/checkout",
        "viewport": { "width": 375, "height": 812 },
        "locale": "de"
      },
      "subject": { "identity": "checkout-button" },
      "evidence": { "overflowPx": 24 }
    }
  ]
}
```

The exact JSON schema is intentionally not frozen yet.

## Canonical Finding

A Finding should answer:

1. What happened?
2. Where did it happen?
3. Under which render state?
4. Which UI subject or relationship is involved?
5. What evidence supports the claim?
6. Is the finding stable across a viewport/state range?
7. How can it be identified again later?
8. How can a human or agent reproduce it?

Candidate semantic fields:

```text
id
ruleId
severity
message
renderState
subjects
renderedLocation
evidence
sourceAttribution?
range
fingerprint
reproduction
verification
```

Not every rule needs every field. `renderedLocation` is intrinsic to Viewportable; `sourceAttribution` is optional and must only be emitted when it is trustworthy.

## Finding identity

Run-local IDs such as `issue-1` are useful within one result.

A stable fingerprint is a different concept and should survive across runs when the semantic problem is the same.

Candidate fingerprint inputs:

```text
rule
route/surface
subject identity
relationship/side
relevant state dimensions
```

Coordinates alone should not define identity.

Exact fingerprint design is deferred until current Slice identity is compared with SARIF and GitHub expectations.

## RenderState

Render state should be a first-class object:

```json
{
  "route": "/checkout",
  "viewport": { "width": 375, "height": 812 },
  "locale": "de-DE",
  "theme": "dark",
  "platform": "web"
}
```

Native states may add device and fontScale. New dimensions should not require redesigning every Finding type.

## Internal evidence vs public evidence

Detectors may use richer internal evidence than a public finding exposes, including raw DOMSnapshot indices, AX trees, paint tables, spatial candidates, or pixel masks.

These remain implementation details unless they materially improve reproduction or explanation.

## Output adapters

- Human CLI: immediate comprehension.
- Viewportable JSON: richest machine-readable representation.
- JSONL: streaming or large scans.
- SARIF: analysis ecosystem adapter, not canonical domain model.
- GitHub Checks: presentation/integration adapter.
- MCP: structured tool transport over the same ScanRequest and ScanResult semantics.

## Versioning

Do not declare a stable public schema until at least two independent callers exercise the semantic contract.

Suggested maturity path:

```text
CLI only
  -> internal draft

CLI + GitHub Action or MCP
  -> schema candidate

multiple adapters + external consumer
  -> versioned public contract
```

When versioning begins, prefer explicit schema versions and additive changes.

## Near-term implementation guidance

1. Keep current CLI compatible.
2. Keep SurfaceSnapshot internal.
3. Gradually move run configuration toward these semantic fields.
4. Add canonical Finding fields only when real capabilities require them.
5. Add formal JSON Schema when a second invocation surface needs it.
6. Evaluate SARIF mapping before freezing stable fingerprints.
7. Do not block ReDeCheck benchmarking or element-protrusion work on a full public-contract refactor.