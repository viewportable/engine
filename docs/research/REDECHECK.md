# ReDeCheck Research Notes

Status: initial research

ReDeCheck (Responsive Design Checker) is an academic/open-source responsive layout failure detector developed around the concept of a **Responsive Layout Graph (RLG)**.

Primary references:

- ReDeCheck repository: https://github.com/redecheck/redecheck
- 2017 example corpus: https://github.com/redecheck/example-webpages
- 2020 regression-study corpus: https://github.com/redecheck/jstvr-webpages
- 2020 paper: https://doi.org/10.1002/stvr.1748
- VISER visual verification prototype: https://github.com/redecheck/viser

The ReDeCheck code is MIT-licensed. The 2020 paper is published open access under CC BY 4.0.

## Why this matters to Slice

Slice and ReDeCheck independently converge on several important ideas:

- model layout structurally instead of relying only on pixels;
- inspect behavior across viewport widths;
- search for exact or narrow failure ranges;
- distinguish different classes of responsive layout failures;
- retain machine-readable evidence.

Slice already has a modern Chromium/CDP capture path using `DOMSnapshot.captureSnapshot`, exact per-issue boundary search, deterministic detectors, grouping, and conservative CSS diagnosis.

The research opportunity is therefore **not** to embed ReDeCheck or port it wholesale. The opportunity is to study its mathematical/modeling ideas and benchmark Slice against its known failure corpus.

## ReDeCheck model

The RLG stores nodes plus constraints whose validity is associated with viewport-width ranges.

Two major kinds of constraints appear in the implementation:

### Visibility constraints

A node has intervals over which it appears/disappears.

Conceptually:

```text
menu:
  visible 320..767
  hidden  768..1023
  visible 1024..1400
```

ReDeCheck refines appearance/disappearance transitions with search rather than assuming the transition occurs exactly at the sampled width.

### Alignment constraints

Relationships between elements are represented over width ranges. The implementation distinguishes parent-child and sibling relationships and labels sibling geometry with attributes such as relative alignment and overlap.

Conceptually:

```text
A left-of B        768..1400
A overlaps B       620..767
A below B          320..619
```

This range-oriented representation is the most important idea to investigate for Viewportable.

## Failure classes worth studying

ReDeCheck reports five major responsive-layout failure classes.

### 1. Element collision

Two elements that did not overlap at a wider range begin to overlap at a narrower range.

Slice currently has a narrower deterministic `fixed-element-collision` rule. Research question: can an RLG-like relationship model let us safely generalize collision detection beyond fixed elements without exploding false positives?

### 2. Element protrusion

An element exceeds the bounds of its parent.

This differs from Slice's current document-level horizontal overflow. A child can protrude from a component while the document itself still has no horizontal scrollbar.

Potential future detector:

```text
element-protrusion
child -> parent
overflow side / px
range
clipping/overflow context
```

### 3. Viewport protrusion

An element becomes visible outside the usable viewport.

This overlaps conceptually with current horizontal-overflow evidence, but ReDeCheck reasons about element/parent constraints across ranges rather than only document scroll width.

### 4. Small-range layout anomaly

ReDeCheck flags a relationship interval shorter than a threshold when compatible relationships exist immediately before and after it. Its implementation uses a 5px threshold.

Example:

```text
320..989   stable relation
990..991   anomalous overlap
992..1400  stable relation
```

This is highly relevant to Viewportable because a conventional device list can completely miss a 2px-wide regression.

We should not copy the hard-coded 5px threshold blindly. The useful idea is:

> detect short-lived relationship states between stable neighboring states.

### 5. Wrapping failure

ReDeCheck groups sibling elements into rows across behavior ranges, then detects an element that leaves a row and appears below it while remaining in the same parent.

Potential Viewportable evolution:

- derive row/column membership from normalized geometry;
- track row membership across adjacent ranges;
- classify unexpected single-element wrap separately from legitimate responsive reflow;
- optionally use authored CSS and semantic evidence to reduce false positives.

## 2020 regression comparison

Later ReDeCheck work compares two RLGs rather than only looking for predefined failure patterns.

The comparator:

- matches nodes between two versions;
- compares visibility constraints;
- compares alignment constraints;
- reports changed attributes, changed interval bounds, and unmatched constraints.

This is strategically important for Viewportable.

A future structural regression mode could compare:

```text
base surface graph
        vs
candidate surface graph
```

and report changes such as:

```text
/pricing

PricingCard -> CTA
base:      same row 768..1440
candidate: CTA wraps below 812..846
```

That is more informative and potentially less noisy than raw screenshot diffing.

## VISER lesson: structural candidate, visual verification

VISER was built to visually verify failures emitted by ReDeCheck and classify them as visually observable or non-observable.

The architectural lesson is more valuable than the old implementation:

```text
cheap structural detector
        |
candidate
        |
optional expensive verifier
        |
confirmed/rejected finding
```

This fits the modular engine direction documented in `docs/ENGINE_ARCHITECTURE.md`.

We should preserve structural detection as the fast default and add screenshot/pixel evidence only when a detector needs it.

## Oracle semantics discovered during benchmark work

The published ReDeCheck results archive distinguishes between **raw failure reports** and manually grouped **Distinct RLFs**.

This matters because one underlying visual defect can have:

- several raw reports involving related elements;
- several viewport ranges;
- more than one ReDeCheck report class.

For example, CloudConvert Distinct RLF #1 is represented both as an `Element Collision` report and a `Small-Range` report at 980px. PepFeed RLF #6 and WillMyPhoneWork RLF #8 similarly combine collision and small-range reports.

Therefore the benchmark oracle is modeled as:

```text
Distinct RLF
  -> page
  -> reports[]
       -> type
       -> viewport range
       -> reason/source report
```

not as:

```text
failure ID -> one detector type
```

This is directly relevant to Viewportable architecture: detector outputs are evidence, while a user-facing canonical finding or root cause may group multiple detector observations.

## Benchmark assets

### ReDeCheck 2017 corpus

`redecheck/example-webpages` contains 26 archived responsive pages and documents 33 distinct responsive layout failures across:

- collisions;
- element protrusions;
- viewport protrusions;
- small-range layouts;
- wrapping.

This is a useful external benchmark because it was assembled independently of Slice.

### 2020 regression corpus

`redecheck/jstvr-webpages` contains 15 archived sites used in the later regression study.

The 2020 paper reports that the RLG-comparison approach detected more injected changes than the manual and automated baselines used in that study, including subtle regressions.

We should treat these numbers as results of that experiment, not as current product-comparison claims.

## Accepted Slice baseline

The first benchmark baseline is now established against the pinned 2017 corpus and manually classified results archive.

The important distinction is between **automatic candidate matches** and **manually reviewed detections**.

Baseline:

```text
33 distinct RLFs
26 / 26 pages scanned
504 sampled viewport renders

9 automatic candidate matches
5 reviewed confirmed detections
4 reviewed incidental candidates

10 misses in nominally compatible/partial families
14 unsupported distinct RLFs

131 anti-oracle raw reports
22 negative candidates
25 clean comparable reports
36 unsupported anti-oracle reports

8,838 raw Slice issues
96.4s aggregate Slice scan time
```

The five confirmed detections are:

- RLF 12 - 3-Minute-Journal graph protrusion at narrow widths;
- RLF 13 - 3-Minute-Journal graph protrusion at the wider failure range;
- RLF 14 - BugMeNot right-side form-field protrusion;
- RLF 15 - BugMeNot left-side form-field protrusion;
- RLF 21 - Pdf-Escape PCWorld logo protrusion.

The four automatic matches rejected as incidental are:

- RLF 16 - Consumer-Reports Featured Products failure, while Slice matched mobile-header elements;
- RLF 17 - Consumer-Reports footer Privacy Policy failure, while Slice matched mobile-header elements;
- RLF 18 - Consumer-Reports Price Watch / Featured tiles failure, while Slice matched mobile-header elements;
- RLF 19 - Duolingo carousel arrow failure, while Slice matched cloned language label/flag elements.

This establishes an important benchmark rule:

> Page + viewport range + detector family is sufficient for a candidate queue, but not for a confirmed detection. Subject/evidence identity must agree with the oracle.

The reviewed overlay is stored in `benchmark/redecheck/review.json`.

### Immediate implication

The first benchmark-driven precision improvement should not add a new detector. It should reduce geometry-only noise while preserving the five reviewed confirmed detections.

A follow-up experiment showed that repairing layout ancestry across non-layout DOM nodes can substantially reduce raw issue volume and anti-oracle candidates. That change is evaluated separately in PR #13 so the baseline remains stable.

## Initial mapping to Slice

| ReDeCheck concept | Slice today | Research direction |
| --- | --- | --- |
| layout extraction | CDP DOMSnapshot | keep Slice capture |
| visibility ranges | indirect/per-issue probing | normalized visibility intervals |
| alignment ranges | limited detector-specific geometry | Surface Graph relationships |
| collision | fixed elements only | safe generic collision candidate |
| element protrusion | not first-class | parent-boundary detector |
| viewport protrusion | horizontal overflow | unify/clarify semantics |
| small-range anomaly | exact issue boundaries | relationship-state anomaly |
| wrapping | not first-class | row-membership transition |
| RLG comparison | not present | structural base-vs-head diff |
| visual verification | not present | optional verifier module |

## Proposed Viewportable model

Working name: **Responsive Surface Graph**.

A node may carry:

```text
identity
DOM ancestry
bounding geometry
visibility
computed layout properties
paint order
text ranges
accessibility identity
```

Relationships may include:

```text
contains
left-of / right-of
above / below
same-row / same-column
intersects
occludes
clips
offscreen
wraps
```

Each relationship should be representable over a range and, eventually, over a broader render state:

```text
relationship(
  viewport,
  locale,
  theme,
  application state
)
```

Do not implement the full graph until benchmarks show which relationships materially improve detection.

## Research plan

### R1 - Reproduce the corpus - complete

- clone/archive the 2017 example corpus for local benchmark use;
- identify the 33 documented failures and their expected width ranges;
- confirm how many still render deterministically in current Chromium;
- record failures that depend on obsolete browser behavior/assets.

### R2 - Establish a Slice baseline - complete

Run current Slice against every usable corpus page and classify:

- detected correctly;
- partially detected;
- missed because detector does not exist;
- false positive;
- scanner/environment failure.

This gives us a real capability gap instead of designing from theory.

### R3 - Prototype relationship intervals

Implement the smallest useful representation first:

- stable node identity;
- parent-child containment;
- sibling overlap;
- relative vertical/horizontal ordering;
- visibility.

Build intervals only when a relationship actually changes across probes.

### R4 - Add one detector at a time

Suggested order:

1. element protrusion;
2. small-range relationship anomaly;
3. wrapping;
4. generic collision candidate;
5. structural base-vs-head graph comparison.

Each detector should earn its place through benchmark improvement and acceptable runtime cost.

### R5 - Visual verifier research

Only after structural candidates are useful:

- prototype screenshot/pixel verification for ambiguous candidates;
- compare pixelmatch and ODiff;
- measure false-positive reduction versus runtime/artifact cost.

## Guardrails

- Do not add ReDeCheck as a runtime dependency.
- Do not port old Selenium/Java infrastructure unless a specific algorithm cannot be expressed cleanly in the current engine.
- Do not add screenshots to the default path merely because VISER used them.
- Do not copy thresholds such as 5px without validation.
- Do not make a graph abstraction larger than the detectors that consume it.
- Preserve deterministic, explainable findings.
- Do not vendor archived third-party corpus pages until redistribution rights are verified; external/local benchmark use is the default.
- Benchmark every new expensive capability.
