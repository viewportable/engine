# RFC Process

RFCs are proposals for cross-cutting changes that benefit from explicit design review before implementation or stabilization.

Use an RFC when a change:

- creates or changes a public contract;
- affects several engine layers or integrations;
- introduces a new platform or execution model;
- has significant compatibility or product consequences;
- is expensive to reverse.

Do not use an RFC for ordinary bug fixes, focused detector additions, refactors that preserve behavior, or routine documentation updates.

## Lifecycle

```text
Proposed
  -> Accepted
  -> Implemented

Proposed
  -> Rejected

Proposed
  -> Withdrawn
```

An accepted RFC records the agreed design direction. If the outcome is an architecturally significant long-lived decision, create or update a concise ADR that records the final decision and links to the RFC rather than duplicating the entire proposal.

## Relationship to ADRs

- RFC = proposal and design discussion before a decision.
- ADR = durable record of an architecturally significant decision after it is made.

Not every RFC needs an ADR, and not every ADR needs an RFC.

## Relationship to reference documentation

A draft contract belongs in an RFC.

Once a contract is implemented and intentionally supported, publish its normative form under reference documentation or as a versioned schema. Do not treat a proposal as a stable contract merely because it has a Markdown file.
