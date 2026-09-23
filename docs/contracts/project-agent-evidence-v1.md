# Viewportable Project Agent Evidence V1

`viewportable.project-agent-evidence.v1` is the canonical envelope for an explicit multi-route project scan.

It does not replace or extend Canonical Agent Evidence V5. Each route keeps an ordinary strict
`viewportable.agent-evidence.v5` payload, including its authoritative per-finding repair policy.

## Shape

```text
viewportable.project-agent-evidence.v1
  mode: project-scan
  outcome / exitCode
  project summary
  routes[]
    route
    url
    evidence: viewportable.agent-evidence.v5
  evidence
    reportPath
    format: project-results.v1
```

This preserves a stable route boundary without adding route-specific fields to V5 findings.

## Exit semantics

Project exit semantics are deterministic and use precedence:

```text
all routes clean                    -> 0
one or more product findings        -> 1
one or more scanner/setup failures  -> 2
```

An infrastructure failure on one route does not prevent the remaining configured routes from being
attempted. The failing route receives an `infra_failure` V5 sidecar, while the project envelope
records the aggregate exit code.

## Artifacts

For an output directory such as `.slice`:

```text
.slice/
  project-results.json
  agent-evidence.json
  routes/
    001-root/
      results.json
      agent-evidence.json
    002-dashboard/
      results.json
      agent-evidence.json
```

The root `agent-evidence.json` is the project envelope. Route-level `agent-evidence.json` files
remain strict V5.

## Route semantics

V1 routes are explicit origin-relative paths configured in `slice.config.json`:

```json
{
  "routes": ["/", "/dashboard", "/settings?tab=profile"]
}
```

Routes must begin with exactly one `/`, must be unique, and must remain on the base URL origin.
V1 intentionally does not crawl, infer routes, or expand dynamic route parameters.

## MCP and GitHub

`viewportable_scan` automatically returns the project envelope when its supplied config contains
`routes`. Single-page scans continue returning V5 directly.

The composite GitHub Action exposes `project-results.json` as `result_path`, the project envelope
as `agent_evidence_path`, uploads the per-route evidence directory, and renders one route-level job
summary. PR comments and managed Check Runs remain compare-only and are unchanged.
