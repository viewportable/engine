# Architecture Knowledge Base

This directory is the durable engineering memory for the Viewportable Engine.

The goal is to preserve not only the current design, but also **why it exists, what evidence changed our thinking, what is committed next, and what remains only an idea**.

## Scope

This is contributor and architecture documentation.

It is not intended to replace end-user product documentation. If Viewportable's public documentation grows, organize tutorials, how-to guides, reference, and explanation separately using a Diátaxis-style structure rather than mixing those concerns into the Architecture Knowledge Base.

## Information types

### Architecture Decision Records - `docs/adr/`

Use an ADR when we have made an architecture decision that future contributors should not casually reverse without understanding its context.

An ADR records:

- context;
- the decision;
- alternatives or previous assumptions;
- consequences;
- what would justify revisiting it.

Current:

- [ADR-0001: Standards-first architecture with an internal Surface IR](adr/0001-standards-first-surface-ir.md)

### Research - `docs/research/`

Research notes are evidence, not commitments.

Use them for:

- prior art;
- external standards;
- experiments;
- benchmark results;
- competitor/academic approaches;
- unresolved technical observations.

Current:

- [ReDeCheck research](research/REDECHECK.md)
- [Protocol and interchange survey](research/PROTOCOLS_AND_INTERCHANGE.md)
- [SARIF and runtime UI findings](research/SARIF_RUNTIME_UI.md)

### RFCs - `docs/rfcs/`

RFCs are proposals for major or cross-cutting changes before they become accepted design.

Current:

- [RFC process](rfcs/README.md)
- [RFC-0001: Scan Contract](rfcs/0001-scan-contract.md)

### Architecture guides

These describe the architecture that contributors should currently build against.

- [Engine Architecture](ENGINE_ARCHITECTURE.md)
- [Platform Adapters](PLATFORM_ADAPTERS.md)
- [Quality Attributes](QUALITY_ATTRIBUTES.md)
- [Risks and Technical Debt](RISKS.md)
- [Glossary](GLOSSARY.md)

If a guide and an accepted ADR conflict, the ADR explains the decision and the guide should be updated.

### Roadmap - `../ROADMAP.md`

The roadmap contains **sequenced work we currently intend to do**.

An item should not enter the roadmap merely because it is interesting. It should have a reason to be next or near-next.

### Design Backlog - `DESIGN_BACKLOG.md`

This is the correct home for important ideas, possible integrations, future capabilities, and deferred experiments that are worth preserving but are **not committed roadmap work**.

This replaces vague buckets such as "ChatGPT ideas" or a single undifferentiated "deferred actions" list.

Items can move:

```text
research -> RFC
research -> design backlog
RFC -> ADR when a durable architectural decision is accepted
RFC -> implementation when no separate ADR is needed
design backlog -> roadmap
roadmap -> implementation
implementation -> changelog when the change is notable to users
```

They can also be rejected or superseded.

### Changelog - `../CHANGELOG.md`

The changelog records notable user-facing changes that shipped or are intended for the next release. Internal refactors, research, and documentation-only architecture changes belong in PRs, ADRs, RFCs, or research notes instead.

It is not a planning document.

## Suggested statuses

For Design Backlog entries:

- `candidate` - plausible future work;
- `research-needed` - cannot responsibly schedule yet;
- `deferred` - understood but intentionally postponed;
- `blocked` - depends on another capability or external condition;
- `rejected` - retained only so we remember why not to do it.

## Rule of thumb

Ask one question:

> Is this evidence, a decision, a commitment, an idea, or something already shipped?

Then put it in:

```text
evidence   -> Research
proposal   -> RFC
decision   -> ADR
commitment -> Roadmap
idea       -> Design Backlog
shipped    -> Changelog
```

This taxonomy keeps the repository useful to humans and agents without turning every conversation into an implementation commitment.
