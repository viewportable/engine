# Glossary

Use these terms consistently in code and documentation.

## Adapter

A boundary component that translates an external platform or transport into or out of Viewportable semantics.

Examples: Chromium capture adapter, future React Native adapter, SARIF reporter, MCP tool adapter.

## Analyzer

A unit of analysis that interprets captured evidence and produces candidate or canonical findings.

"Analyzer" is the broader architectural term. Existing code may still use "detector" for a focused rule implementation.

## Capability

A class of evidence an analyzer requires, such as geometry, tree, computed styles, paint order, ARIA, text ranges, screenshots, or pixels.

## Canonical Finding

The Viewportable domain representation of a detected problem before it is projected into CLI text, GitHub Checks, SARIF, MCP, or another output.

## Capture

The act of obtaining rendered-platform evidence for one render state.

## Detector

A focused implementation that detects a specific condition, such as horizontal overflow or fixed-element collision.

Use "detector" for rule-level code and "analyzer" for the broader architecture concept.

## Evidence

Measured or observed data that supports a finding.

Examples: geometry, overlap area, paint order, computed style, width range, screenshot, or source attribution.

## Finding

A machine-readable statement that a rule observed a relevant problem under a particular render state.

## Internal Surface IR

Viewportable's private normalized representation of rendered UI evidence.

The current `SurfaceSnapshot` is the first implementation. The IR is not a stable public API.

## Render State

The dimensions that define one rendered condition.

Examples: route/screen, viewport/device, locale, theme, platform, font scale, authentication/application state, feature flags.

## Rendered Location

Where a problem exists in the rendered interface.

It is distinct from source attribution and may exist even when no trustworthy source file/line can be identified.

## Reporter / Output Adapter

A component that projects canonical findings into an external representation such as human CLI text, JSON, SARIF, GitHub Checks, or MCP structured output.

## ScanRequest

The proposed public semantic description of what Viewportable should verify.

Defined by RFC-0001 and not yet a stable public schema.

## ScanResult

The proposed public semantic result containing summary, findings, render-state context, and optional evidence/artifact references.

## Source Attribution

Optional evidence connecting a rendered finding to authored source such as a CSS declaration, component, file, or line.

It must not be emitted as certain when attribution is ambiguous.

## SurfaceSnapshot

The current TypeScript implementation of the internal Surface IR.

It is intentionally free to evolve.

## Visual Verification

An optional more expensive stage that uses rendered visual evidence, such as screenshots or pixels, to confirm or reject a structural candidate.
