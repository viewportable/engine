# Viewportable Canonical Agent Evidence Contract V5

Status: active for MCP

Schema version:

```text
viewportable.agent-evidence.v5
```

V5 preserves all V4 source attribution, browser-proven stylesheet coordinates, and authored Source Map evidence. It adds one required machine policy object to every canonical finding:

```json
{
  "repair": {
    "repairable": true,
    "reason": "deterministic-authored-css"
  }
}
```

or, when Viewportable cannot safely authorize automatic repair:

```json
{
  "repair": {
    "repairable": false,
    "reason": "missing-authored-location"
  }
}
```

## Why this is V5

V4 is strict. Adding a required field to V4 would break existing V4 consumers.

V5 is therefore a new compatibility boundary. V1 through V4 remain valid stable contracts with their previous meanings.

## Policy goal

Agents must not independently infer auto-repair eligibility from fields such as `source !== null`.

A source declaration can be useful evidence without being sufficient authorization for automated editing. V5 centralizes that decision inside Viewportable so every MCP client, coding agent, and future repair executor follows the same fail-closed rule.

## Repairable policy

V1 of the repair policy authorizes automatic repair only for finding semantics for which the repository already has an end-to-end deterministic repair proof:

- introduced compare-mode `protrusion`;
- current scan-mode `horizontal-overflow`.

For either case, all of the following must also be present:

1. deterministic CSS source attribution;
2. browser-proven generated stylesheet location;
3. deterministic authored Source Map location.

When all conditions hold:

```json
{
  "repairable": true,
  "reason": "deterministic-authored-css"
}
```

This policy intentionally says only that the finding is eligible for the existing constrained CSS repair flow. It does not authorize arbitrary shell access, multi-file edits, or unconstrained source changes.

## Fail-closed reasons

When auto-repair is not authorized, V5 returns exactly one reason:

| reason | meaning |
| --- | --- |
| `unsupported-finding` | the finding semantics do not have an accepted deterministic repair strategy |
| `missing-deterministic-source` | no unique direct CSS declaration has been proven |
| `missing-stylesheet-location` | the declaration exists but Chromium did not prove an exact generated property range |
| `missing-authored-location` | generated coordinates exist but no verified authored Source Map position is available |

The schema is a discriminated union. A payload such as `repairable: true` with `reason: "missing-authored-location"` is invalid.

## Current supported examples

Repairable:

```text
compare protrusion
  + min-width/width source
  + V3 location
  + V4 authoredLocation
  => repairable: true
```

```text
scan horizontal-overflow
  + grouped root-cause min-width/width source
  + V3 location
  + V4 authoredLocation
  => repairable: true
```

Not repairable:

```text
disappearance
reparenting
overlap
fixed-element-collision
fixed-content-occlusion
wrapping
```

These currently return `unsupported-finding` even if future internal evidence happens to become richer. A separate accepted repair strategy must deliberately extend the policy.

## MCP behavior

`viewportable_scan` and `viewportable_compare` publish V5 as their structured output schema.

MCP instructions explicitly define `finding.repair` as authoritative. Consumers should not recreate the eligibility algorithm by inspecting `source`, `location`, or `authoredLocation` themselves.

## Versioning

- fixes that preserve V5 meanings do not require V6;
- adding a new fail-closed reason, changing repair semantics, or adding a new required field requires a new schema version unless the change is backward-compatible by the contract rules;
- expanding which finding semantics are considered repairable may remain V5 only when the meaning of `repairable` stays unchanged and the new behavior is backed by an accepted deterministic repair strategy.
