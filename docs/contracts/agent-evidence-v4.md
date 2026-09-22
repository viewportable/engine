# Viewportable Canonical Agent Evidence Contract V4

Status: active for MCP

Schema version:

```text
viewportable.agent-evidence.v4
```

V4 preserves the V3 runtime stylesheet location and adds a nullable deterministic authored location:

```json
{
  "source": {
    "kind": "css-declaration",
    "confidence": "deterministic",
    "stylesheet": "https://app.example/assets/app.css",
    "selector": ".proof",
    "property": "min-width",
    "value": "400px",
    "media": null,
    "location": {
      "kind": "css-property-range",
      "confidence": "deterministic",
      "coordinateSpace": "stylesheet",
      "start": { "line": 6, "column": 5 },
      "end": { "line": 6, "column": 22 }
    },
    "authoredLocation": {
      "kind": "source-map-property",
      "confidence": "deterministic",
      "coordinateSpace": "authored-source",
      "source": "../../src/styles.scss",
      "resolvedSource": "https://app.example/src/styles.scss",
      "start": { "line": 18, "column": 5 },
      "sourceContentSha256": "<sha256>",
      "sourceMap": {
        "version": 3,
        "kind": "external",
        "url": "https://app.example/assets/app.css.map"
      }
    }
  }
}
```

If source-map proof is unavailable, ambiguous, unsupported, or unverifiable:

```json
{ "authoredLocation": null }
```

## Deterministic mapping rules

Source Map Mapping V1 is deliberately narrower than ordinary debugger source-map lookup.

Viewportable accepts an authored location only when all of the following are true:

1. Source Attribution V1 already proved one direct CSS declaration.
2. Source Location V1 already proved the exact generated CSS property range through Chromium CDP.
3. The generated stylesheet has a Source Map v3 reference.
4. The map is inline, or an external same-origin HTTP(S) resource.
5. The source map has a mapping segment at the exact generated property-start column. A nearest previous segment is not accepted.
6. The mapped source is not ignored by the source map.
7. The map contains `sourcesContent` for that source.
8. The exact mapped original line/column begins with the attributed CSS property.
9. The source content is hashed with SHA-256 and carried into V4 for later checkout verification.

If any condition fails, Viewportable preserves the V3 stylesheet location and returns `authoredLocation: null`.

The same mapping rules now apply to deterministic scan-mode horizontal-overflow root causes. Scan findings inherit the root cause's V3/V4 source evidence through `groupId`; there is no separate or weaker scan attribution algorithm.

## GitHub annotation verification

Standalone GitHub Action mode prefers `authoredLocation` when present.

The candidate checkout resolver:

1. derives a repo candidate from the source-map source identifier;
2. requires that path to stay inside `source-root`;
3. re-reads the local authored file;
4. requires its SHA-256 to equal `sourceContentSha256`;
5. verifies that the mapped line/column still starts with the attributed property.

Only then is a Check annotation attached to the authored source line. Otherwise Viewportable falls back to the existing direct stylesheet annotation when that runtime stylesheet itself is a verifiable checkout file.

This supports common relative source-map paths such as `../../src/styles.scss` without treating path rewriting as proof: the content hash is the proof.

## Supported map transport

V1 supports:

- Source Map v3;
- inline `data:` source maps;
- same-origin external HTTP(S) source maps.

V1 intentionally rejects cross-origin external source maps.

## Why this is V4

V3 explicitly defines `location.coordinateSpace = "stylesheet"`. Reinterpreting that field as authored source coordinates would break consumers.

V4 therefore adds `authoredLocation` while V1, V2, and V3 remain stable compatibility contracts.
