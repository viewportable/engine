# Viewportable Canonical Agent Evidence Contract V2

Status: active for MCP

Schema version:

```text
viewportable.agent-evidence.v2
```

V2 preserves all V1 finding semantics and adds one strict field to every finding:

```json
{
  "source": {
    "kind": "css-declaration",
    "confidence": "deterministic",
    "stylesheet": "/workspace/src/renderer/styles.css",
    "selector": "[data-viewport-id=\"iphone-15-pro\"]",
    "property": "min-width",
    "value": "800px",
    "media": "(min-width: 850px) and (max-width: 949px)"
  }
}
```

When no authored declaration can be proven uniquely, the field is present as:

```json
{ "source": null }
```

## Why this is V2

V1 is strict and rejects unknown fields. Adding `source` to V1 would therefore break an existing V1 consumer.

V2 is a deliberate compatibility boundary rather than a silent schema extension.

The V1 schema and builder remain in the repository for consumers that still need the previous contract.

## Attribution policy

Source attribution is conservative.

V1 of the attribution engine supports deterministic CSS declarations that directly constrain a protruding subject:

- pixel `min-width`;
- uniquely attributable authored fixed pixel `width`.

For a structural protrusion, Viewportable:

1. selects a sampled failing viewport;
2. resolves the canonical structural subject and parent back to unique captured DOM nodes;
3. proves the subject width constraint is wider than the available parent width;
4. builds a stable selector for the subject;
5. finds exactly one active authored CSS rule whose property/value explains the computed constraint;
6. records the stylesheet, selector, property, value, and active media context.

If any step is ambiguous, inaccessible, indirect, or unsupported, `source` remains `null`.

Viewportable does not guess a file, line, rule, or property from naming conventions.

## Active media context

Attribution traverses active CSS media rules and records the media condition that was active at the failing width.

Inactive media branches are ignored.

## Stylesheet identity

For linked stylesheets, `stylesheet` is the stylesheet URL.

For Vite development styles injected into `<style>` tags, Viewportable uses `data-vite-dev-id` when available. This allows coding agents to receive the real source path instead of `null`.

## Scan mode

Existing deterministic scan root-cause diagnosis is normalized into the same V2 `source` field when a finding belongs to a root cause with uniquely attributed CSS.

## Compare mode

Structural compare source attribution is currently limited to direct protrusion constraints. Other findings such as reparenting, disappearance, overlap, or indirect protrusion side-effects retain `source: null` until an equally deterministic attribution rule exists.

## Versioning

The same strict-versioning rule applies as V1:

- compatible implementation fixes do not change the version;
- new required fields, changed meanings, or enum changes require a new schema version;
- raw detector fields do not leak into the agent contract merely because the Engine report contains them.
