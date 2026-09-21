# ADR-0002: GitHub App owns PR evidence in Cloud mode

- Status: Accepted
- Date: 2026-09-22

## Context

Viewportable Engine can publish a pull-request comment and a `Viewportable Engine` Check Run directly from a composite GitHub Action by using the workflow's `GITHUB_TOKEN`.

That is useful for standalone, zero-account adoption, but it is not the correct ownership model for Viewportable Cloud. During the golden PR work, a synthetic CI Check writer and a real structural-comparison Check writer briefly competed for the same product surface. The problem was architectural rather than detector-specific: more than one actor could author the current Viewportable result for one PR head.

Cloud also needs installation-aware repository discovery, durable project identity, webhook-driven review creation, and safe handling of private repositories without exposing GitHub credentials to candidate code.

## Decision

### One canonical writer

In **Cloud mode**, the Viewportable GitHub App is the only writer of:

- the `Viewportable Engine` Check Run;
- future App-owned PR evidence surfaces.

The Engine and its executor produce evidence. They do not receive GitHub App credentials and do not publish the Cloud product state directly.

Standalone Action mode remains supported and may opt into direct Check/comment publishing.

### Installation model

The control-plane identity chain is:

```text
GitHub App Installation
        ↓
Repository
        ↓
Viewportable Project
        ↓
Pull Request Review
        ↓
GitHub Check Run
```

V1 deterministic IDs are:

```text
project = github:<installation_id>:<repository_id>
review  = github:<repository_id>:pr:<number>:head:<sha>
```

`installation` and `installation_repositories` webhooks synchronize repository access. Removing repository access removes the corresponding project and pending review state.

### Pull request ingress

The App queues reviews on:

- `pull_request.opened`;
- `pull_request.reopened`;
- `pull_request.synchronize`;
- `pull_request.ready_for_review`.

Each accepted PR head creates one queued App-owned Check Run. Webhook delivery IDs are retained for idempotency.

### Authentication boundary

The server authenticates as the GitHub App with an RS256 JWT and exchanges that JWT for a short-lived installation access token.

The App private key and installation access tokens exist only in the control plane. They are never passed to:

- candidate application code;
- the browser under test;
- a GitHub Actions candidate job;
- the Viewportable Engine process.

Executor results return to the control plane through a separate result credential. V1 exposes:

```text
POST /api/reviews/:review_id/result
```

The control plane then completes the existing App-owned Check Run.

### Webhook authenticity

Webhook payloads are verified before parsing with the configured secret and `X-Hub-Signature-256` HMAC-SHA256 signature using constant-time comparison.

### Check conclusion

Engine semantics stay unchanged:

```text
0 -> success         -> allow
1 -> failure         -> block
2 -> action_required -> infra_failure
```

### V1 persistence

The first implementation uses a serialized JSON state adapter so the full lifecycle is runnable without selecting the permanent cloud database in this slice.

The domain model and webhook handlers do not depend on the JSON adapter. A later Postgres/D1 adapter may replace it without changing IDs, webhook semantics, or Check ownership.

## Required GitHub App permissions

Repository permissions:

- Metadata: read
- Contents: read
- Pull requests: read & write
- Checks: read & write

Subscribed event:

- Pull request

Installation lifecycle events are consumed to synchronize repository access.

## Consequences

### Positive

- exactly one Cloud writer owns the current PR result;
- installation-to-project mapping is explicit;
- repository access follows GitHub installation selection;
- App credentials stay outside untrusted execution;
- reruns and later executor backends share one GitHub publishing path;
- GitHub Actions, Viewportable runners, and BYOC can become interchangeable execution backends.

### Trade-offs

- Cloud now requires a server-side App installation and webhook endpoint;
- installation state must be durable;
- executor result authentication becomes a separate control-plane concern;
- standalone Action publishing and Cloud publishing are two explicit modes that documentation must keep distinct.

## Non-goals for V1

- starting an executor from the webhook handler;
- billing or organization membership;
- GitHub OAuth user login;
- requested-action buttons on Check Runs;
- PR comment ownership migration to the App;
- selecting the permanent cloud database.
