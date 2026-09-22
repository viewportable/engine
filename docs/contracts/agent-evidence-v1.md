# Viewportable Canonical Agent Evidence Contract V1

Status: active

Schema version:

```text
viewportable.agent-evidence.v1
```

## Purpose

This contract is the stable semantic language between Viewportable Engine and coding agents.

Engine reports such as `results.json` and `structural-diff.json` are rich diagnostic artifacts. They may grow detector-specific fields, raw observations, geometry, probes, timing metadata, or debugging data.

Agent-facing integrations must not depend on those internal report shapes directly.

The boundary is:

```text
Engine report
    ↓
buildCanonicalAgentEvidenceV1()
    ↓
runtime validation
    ↓
viewportable.agent-evidence.v1
    ↓
MCP / future REST API / GitHub App / agent integrations
```

## Strictness

The source of truth is `src/contracts/agent-evidence.ts`.

It uses strict Zod objects at every level. Unknown properties are rejected. The same Zod schema is supplied to MCP as the tool `outputSchema`, and can be exported as JSON Schema through `agentEvidenceV1JsonSchema()`.

The adapter validates every result before it leaves the Engine boundary.

## Top-level shape

Every result contains all top-level fields:

```json
{
  "schemaVersion": "viewportable.agent-evidence.v1",
  "mode": "compare",
  "outcome": "findings",
  "exitCode": 1,
  "summary": {
    "viewportsChecked": 4,
    "findingCount": 2,
    "introducedCount": 2,
    "resolvedCount": 0,
    "durationMs": 942
  },
  "findings": [],
  "evidence": {
    "reportPath": ".slice/mcp/compare-.../structural-diff.json",
    "format": "structural-diff.v1"
  },
  "error": null
}
```

## Outcome semantics

```text
exit 0 -> outcome clean
exit 1 -> outcome findings
exit 2 -> outcome infra_failure
```

For compare mode, `findings[]` contains introduced regressions only. Resolved structural ranges remain in the full Engine artifact and are represented by `summary.resolvedCount`.

For scan mode, `findings[]` contains current layout issues observed at failing viewports.

## Canonical finding

Each finding has the same outer shape regardless of detector:

```json
{
  "id": "structural-...",
  "category": "structural",
  "type": "disappearance",
  "direction": "introduced",
  "groupId": null,
  "subject": {
    "identity": "id:checkout-button",
    "tagName": "BUTTON",
    "matchQuality": "explicit"
  },
  "relatedSubjects": [],
  "range": {
    "kind": "exact",
    "minWidth": 350,
    "maxWidth": 499,
    "sampledMinWidth": 375,
    "sampledMaxWidth": 430,
    "viewportWidth": null
  },
  "baseline": {
    "state": "visible",
    "parent": null
  },
  "candidate": {
    "state": "missing",
    "parent": null
  }
}
```

### Finding types

Layout:

- `horizontal-overflow`
- `fixed-element-collision`
- `fixed-content-occlusion`
- `wrapping`

Structural compare:

- `overlap`
- `protrusion`
- `reparenting`
- `disappearance`
- `appearance`

### Direction

```text
current     scan issue observed in the candidate
introduced  compare regression introduced by the candidate
resolved    reserved for semantic consumers that need resolved change detail
```

V1 compare responses intentionally expose introduced findings only. Resolved counts are still preserved in the summary and full artifact.

### Range kinds

- `exact`: both exact responsive boundaries are known.
- `partial_exact`: one exact edge is known.
- `sampled`: only sampled failing widths are known.
- `viewport`: a current scan issue at one explicit viewport.
- `unknown`: no trustworthy width range can be expressed.

Nullable fields are deliberate. Missing semantic information is represented as `null`, not by silently omitting keys.

## Evidence pointer

The compact contract never replaces the full Engine artifact:

```json
{
  "evidence": {
    "reportPath": ".slice/...",
    "format": "structural-diff.v1"
  }
}
```

Agents should use the canonical contract for decisions and the full artifact only when deeper detector evidence is needed.

## Versioning rule

The string `viewportable.agent-evidence.v1` is a compatibility boundary.

Allowed without changing the version:

- bug fixes that make existing fields more accurate;
- support for already-enumerated finding types;
- internal Engine/report changes that do not change the contract.

Require a new schema version:

- removing or renaming fields;
- changing field meaning;
- adding required fields;
- changing enum semantics;
- changing the interpretation of outcomes or ranges.

Do not expose raw detector-specific fields through this contract merely because they exist in an Engine report.
