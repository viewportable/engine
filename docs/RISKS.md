# Risks and Technical Debt

This is the current risk register for the Viewportable Engine.

It is not a feature backlog. A risk may exist even when no implementation task is scheduled.

## R1 - Chromium capture bias

Current deep capture depends on CDP and Chromium DOMSnapshot.

Risk:
- assumptions may accidentally leak into generic analysis;
- Firefox, WebKit, native, or React Native adapters may expose weaker or differently shaped evidence.

Mitigation:
- keep platform adapters explicit;
- keep Surface IR internal and evolvable;
- validate generic analyzers against at least one non-DOM spike before claiming cross-platform portability.

## R2 - Unstable subject identity

DOM indices, coordinates, and generated selectors can change across widths, reloads, and application versions.

Risk:
- poor cross-run grouping;
- unstable fingerprints;
- incorrect structural base-vs-head comparison.

Mitigation:
- research semantic identity separately from runtime node indices;
- do not freeze stable fingerprints before benchmark and SARIF/GitHub identity experiments.

## R3 - Source attribution can be weaker than rendered evidence

A runtime layout failure can be real even when the exact source file/line is ambiguous.

Risk:
- misleading diagnostics if the engine overclaims a CSS/component cause;
- bad SARIF/code-scanning locations.

Mitigation:
- rendered location is primary;
- source attribution is optional;
- never fabricate a source location to satisfy an integration.

## R4 - False positives from geometry alone

Rectangles can intersect intentionally.

Risk:
- generic collision, wrapping, protrusion, or occlusion detectors can become noisy.

Mitigation:
- structural candidate first;
- use tree, paint, visibility, interaction, authored-style, and later optional visual verification as evidence;
- benchmark every generalized detector against known-good and known-bad cases.

## R5 - Benchmark corpus age

ReDeCheck corpora contain archived historical pages and browser-era assumptions.

Risk:
- obsolete assets or rendering behavior may distort current results;
- benchmark numbers may be mistaken for modern real-world accuracy.

Mitigation:
- classify environment/obsolete cases explicitly;
- use the corpus as an independent regression suite, not the only benchmark;
- add modern fixtures over time.

## R6 - Corpus redistribution rights

Archived third-party pages may not be safe to vendor publicly.

Mitigation:
- verify redistribution rights before committing external site snapshots;
- prefer local/external benchmark acquisition when rights are unclear.

## R7 - Performance growth from optional capabilities

Accessibility, text ranges, screenshots, pixels, native automation, and large relationship graphs can increase scan time and memory.

Mitigation:
- capability-driven execution;
- shared capture;
- measure before enabling by default;
- introduce spatial indexing only when benchmarks justify it.

## R8 - Documentation drift and duplicate sources of truth

Roadmap, backlog, research, ADRs, RFCs, architecture guides, issues, and changelog can repeat the same statement with different status.

Mitigation:
- follow the taxonomy in `docs/README.md`;
- link instead of copying detail;
- keep one source of truth for decision state and one for implementation state.

## R9 - Public contract frozen too early

A schema designed around the current web CLI may poorly fit native, agents, or multi-state scanning.

Mitigation:
- keep RFC-0001 proposed;
- exercise the semantic contract through at least two independent callers before versioning;
- keep internal Surface IR outside the public contract.

## R10 - Cross-platform lowest-common-denominator trap

Trying to make every analyzer universal can weaken useful browser-specific or native-specific evidence.

Mitigation:
- generic analyzers depend on minimal capabilities;
- platform-specific analyzers are allowed;
- portability is a design goal, not a requirement to discard richer evidence.
