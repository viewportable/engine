# Viewportable Canonical Agent Evidence Contract V3

Status: active for MCP

Schema version:

```text
viewportable.agent-evidence.v3
```

V3 preserves V2 source attribution and adds a strict nullable source location:

```json
{
  "source": {
    "kind": "css-declaration",
    "confidence": "deterministic",
    "stylesheet": "/workspace/src/renderer/styles.css",
    "selector": "[data-viewport-id=\"iphone-15-pro\"]",
    "property": "min-width",
    "value": "1400px",
    "media": "(min-width: 850px) and (max-width: 949px)",
    "location": {
      "kind": "css-property-range",
      "confidence": "deterministic",
      "coordinateSpace": "stylesheet",
      "start": { "line": 572, "column": 5 },
      "end": { "line": 572, "column": 23 }
    }
  }
}
```

When Viewportable cannot prove a unique browser source range, the field is present as:

```json
{ "location": null }
```

## Why this is V3

V2 is strict. Adding a required `location` key to its source object would break V2 consumers.

V3 is therefore a new compatibility boundary. V1 and V2 schemas/builders remain available in the repository.

## Coordinate semantics

Chrome DevTools Protocol reports CSS source ranges with zero-based lines and columns. The canonical agent contract converts both to **one-based** coordinates so they map naturally to editor and GitHub-style locations.

`coordinateSpace: "stylesheet"` is deliberate. V1 does not claim that a runtime stylesheet range is automatically an original authored-file range after arbitrary CSS transforms.

The existing `source.stylesheet` still identifies the authored/runtime source path when Viewportable can determine it. A later source-map slice can add an explicitly mapped authored coordinate space without changing the meaning of V3.

## Deterministic location algorithm

For a structurally attributed CSS declaration Viewportable:

1. resolves the exact DOM subject through the existing stable selector;
2. enables the Chromium DOM and CSS protocol domains;
3. asks `CSS.getMatchedStylesForNode` for browser-parsed matching rules;
4. requires the matched rule selector, active media context, property name, and property value to agree with Source Attribution V1;
5. requires a browser-provided property `SourceRange`;
6. retrieves the stylesheet text through `CSS.getStyleSheetText`;
7. verifies that the reported range actually contains the attributed property/value text;
8. accepts the location only when exactly one candidate remains.

If any step fails or multiple candidates survive, `location` is `null`.

There is no line-number guessing by searching project files.

## Current scope

Source Location V1 follows Source Attribution V1 scope:

- structural compare direct protrusion constraints;
- pixel `min-width`;
- uniquely attributable fixed pixel `width`.

Other finding types and scan-mode locations remain `null` until equally deterministic browser evidence exists.

## Authored source maps

V3 intentionally remains limited to runtime stylesheet coordinates.

Authored source-map positions are added by [Canonical Agent Evidence V4](agent-evidence-v4.md) through a separate nullable `authoredLocation`. V4 does not reinterpret the V3 `location` field, so existing V3 consumers keep the same coordinate semantics.
