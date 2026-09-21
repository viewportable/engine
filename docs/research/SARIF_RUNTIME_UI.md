# SARIF and Runtime UI Findings

Status: initial research

Related:

- [ADR-0001](../adr/0001-standards-first-surface-ir.md)
- [Scan Contract Draft](../contracts/SCAN_CONTRACT.md)
- [Protocol and Interchange Survey](PROTOCOLS_AND_INTERCHANGE.md)

## Question

Can SARIF be the primary interchange and GitHub presentation format for Viewportable runtime UI findings?

## Findings

SARIF itself is flexible enough to represent results that do not have a physical source location.

The SARIF 2.1.0 specification says a result **should** contain locations, but explicitly allows rare results where a location cannot be specified. SARIF also supports logical locations and custom properties.

GitHub Code Scanning is stricter: GitHub requires at least one location for a result to be displayed as a code-scanning alert.

That distinction matters for Viewportable.

A runtime UI finding such as:

```text
/checkout
375x812
de-DE

ELEMENT_PROTRUSION
button.checkout protrudes 24px outside footer
```

has a strong rendered-surface location but may not have a trustworthy source-code file/line.

Inventing a fake code location would make the integration misleading.

## Design implications

SARIF should remain an **output adapter**, not the canonical Viewportable finding model.

GitHub integration should have two paths:

### GitHub Checks

Use for all runtime UI findings.

Checks can present:

- route/screen;
- viewport/device;
- locale/state;
- rendered subject;
- evidence;
- links to artifacts/reproduction;
- pass/fail summary.

This does not require pretending that every rendered failure maps to a source line.

### SARIF / Code Scanning

Use when Viewportable has trustworthy source attribution.

Examples:

- uniquely attributed authored CSS declaration;
- component/source-map attribution that meets a defined confidence threshold;
- future framework instrumentation that provides source location.

In these cases SARIF can provide code-native alerts and stable code-scanning identity.

## Research recommendation

> Never manufacture a source-code location merely to satisfy GitHub Code Scanning.

If attribution is ambiguous, keep the finding in Viewportable JSON / GitHub Checks / MCP output.

## Canonical finding consequence

Canonical Finding should distinguish:

```text
renderedLocation
sourceAttribution?
```

Rendered location is intrinsic to Viewportable.

Source attribution is optional evidence.

Conceptually:

```json
{
  "renderedLocation": {
    "route": "/checkout",
    "viewport": { "width": 375, "height": 812 },
    "subject": "button.checkout"
  },
  "sourceAttribution": {
    "confidence": "unique",
    "file": "app/components/checkout.css",
    "line": 42
  }
}
```

The exact schema remains a design draft.

## Fingerprinting

SARIF supports result fingerprinting concepts, and GitHub Code Scanning uses supported partial fingerprints when available.

Viewportable should still define its own stable semantic fingerprint independently of GitHub because many findings will never enter Code Scanning.

A future SARIF reporter can project the Viewportable fingerprint into the supported SARIF/GitHub mechanism where appropriate.

## References

- SARIF 2.1.0 Plus Errata 01: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
- GitHub SARIF support: https://docs.github.com/en/code-security/reference/code-scanning/sarif-files/sarif-support
