# Platform Adapters

This guide follows [ADR-0001](adr/0001-standards-first-surface-ir.md): adapters should reuse mature platform protocols and translate them into the internal Surface IR rather than inventing a new automation transport.

Viewportable should verify rendered interfaces, not HTML specifically.

The engine therefore treats platform integration as an adapter problem:

```text
platform runtime
      |
surface adapter
      |
SurfaceSnapshot
      |
Viewportable Engine
      |
Findings
```

The first implementation remains browser-first, but core geometry and relationship analysis should not require a DOM.

## Browser

Current status: implemented.

The browser adapter uses Playwright plus Chromium CDP `DOMSnapshot.captureSnapshot` and normalizes the result into a `SurfaceSnapshot`.

Browser-specific evidence may include:

- DOM ancestry;
- CSS computed styles;
- paint order;
- stable selectors;
- authored stylesheet attribution.

Those details are useful to browser-specific detectors and diagnosis, but generic geometry algorithms should depend on the normalized surface contract where possible.

## Capacitor

Capacitor is the lowest-cost native extension because the rendered application remains a web application inside a native WebView.

Initial support can therefore reuse the browser engine against the same web build or a reachable WebView target.

Later native verification may add an adapter that captures:

- WebView geometry;
- safe-area behavior;
- native viewport dimensions;
- keyboard/viewport interaction;
- platform-specific WebView differences.

The engine should not need a separate Capacitor-specific geometry model.

Reference: https://capacitorjs.com/docs

## React Native

React Native does not expose a browser DOM. Its render pipeline still produces a layout tree with measured element geometry, so the same Viewportable relationship mathematics can apply after normalization.

A future React Native adapter should produce the same core shape:

```text
React Native / Fabric / native hierarchy
              |
        RN surface adapter
              |
        SurfaceSnapshot
              |
     shared geometry detectors
```

Possible evidence sources to research:

- React Native layout measurement APIs;
- Fabric/Shadow Tree layout information;
- native accessibility/view hierarchy;
- iOS Simulator and Android Emulator automation;
- optional development-only instrumentation such as `@viewportable/react-native`.

The first React Native experiment should not attempt broad product support. It should prove one thing:

> A real React Native layout bug can be normalized into SurfaceSnapshot and detected by an existing shared detector without rewriting its algorithm.

Good first candidates are element protrusion and generic collision.

Reference: https://reactnative.dev/architecture/render-pipeline

## Render-state dimensions

The same surface can eventually be evaluated across dimensions such as:

```text
viewport/device
x locale
x font scale
x theme
x application state
x platform
```

React Native makes font scale especially important because native text measurement can change layout differently across iOS and Android.

## Compute model

Native adapters must preserve Viewportable's bring-your-own-compute direction.

Examples:

```text
local Mac
  -> iOS Simulator
  -> Viewportable adapter

customer Linux runner
  -> Android Emulator
  -> Viewportable adapter

customer device-cloud account
  -> real device
  -> Viewportable orchestration
```

Viewportable should not require operating its own simulator or device farm.

## Architecture guardrails

- No DOM assumption in generic geometry algorithms.
- Platform-specific evidence stays in adapters or specialized detectors.
- Do not weaken deterministic findings to force cross-platform reuse.
- A detector may explicitly declare that it supports only a subset of platforms.
- Native support must not add runtime cost to ordinary browser scans.
- Start with shared geometry detectors before platform-specific heuristics.
