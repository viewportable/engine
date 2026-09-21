# Viewportable GitHub App - Installation V1

This directory is the first server/control-plane boundary for Viewportable Cloud. It is intentionally isolated from the Engine runtime and from the Electron application.

## Ownership

In Cloud mode, the GitHub App is the **only writer** of the product Check Run.

```text
GitHub pull_request webhook
        ↓
installation_id
        ↓
repository
        ↓
Viewportable project
        ↓
review request
        ↓
Viewportable GitHub App creates queued Check Run
        ↓
executor runs Viewportable Engine
        ↓
POST /api/reviews/:id/result
        ↓
Viewportable GitHub App completes the same Check Run
```

The executor never receives the GitHub App private key or installation token.

Standalone Action mode may still opt into direct GitHub publishing. Cloud/App mode must leave Action `check-run` and `pr-comment` disabled so there is one canonical writer.

## State model

The V1 durable JSON adapter stores four explicit relationships:

```text
Installation
  └─ Repository
       └─ Project
            └─ Review
                 └─ GitHub Check Run
```

IDs are deterministic:

```text
project: github:<installation_id>:<repository_id>
review:  github:<repository_id>:pr:<number>:head:<sha>
```

The JSON store is an implementation adapter for this slice, not the long-term database choice. The model is kept separate so it can move to Postgres/D1 without changing webhook or GitHub ownership semantics.

## GitHub App settings

Repository permissions:

- Metadata: read
- Contents: read
- Pull requests: read & write
- Checks: read & write

Subscribe to:

- Pull request

GitHub delivers `installation` and `installation_repositories` lifecycle events to GitHub Apps; V1 consumes both to keep repository/project access synchronized.

Webhook URL:

```text
https://<control-plane>/github/webhooks
```

Use a high-entropy webhook secret. V1 verifies `X-Hub-Signature-256` with HMAC-SHA256 before parsing the payload.

## Environment

```text
VIEWPORTABLE_GITHUB_APP_ID
VIEWPORTABLE_GITHUB_PRIVATE_KEY
VIEWPORTABLE_GITHUB_WEBHOOK_SECRET
VIEWPORTABLE_RESULT_TOKEN

# optional
VIEWPORTABLE_APP_BASE_URL
VIEWPORTABLE_GITHUB_STATE_PATH=.viewportable/github-app-state.json
VIEWPORTABLE_GITHUB_API_VERSION=2026-03-10
GITHUB_API_URL=https://api.github.com
PORT=8787
```

The private key may be supplied with literal `\n` sequences by secret managers; the server normalizes them at startup.

## Run

```bash
npm run github-app:serve
```

Health check:

```bash
curl http://127.0.0.1:8787/healthz
```

## Executor result contract

The executor/control-plane worker posts the Engine result back with a control-plane credential, not a GitHub credential:

```http
POST /api/reviews/<url-encoded-review-id>/result
Authorization: Bearer $VIEWPORTABLE_RESULT_TOKEN
Content-Type: application/json
```

```json
{
  "exitCode": 1,
  "detailsUrl": "https://app.viewportable.dev/reviews/...",
  "report": {
    "findings": []
  }
}
```

Conclusion mapping stays aligned with Engine semantics:

```text
0 -> success         -> allow
1 -> failure         -> block
2 -> action_required -> infra_failure
```

## Pull request actions

V1 queues a review for:

- `opened`
- `reopened`
- `synchronize`
- `ready_for_review`

Webhook deliveries are idempotent by `X-GitHub-Delivery`. Duplicate deliveries do not create a second review or second Check Run.
