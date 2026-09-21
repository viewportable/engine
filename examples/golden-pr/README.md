# Viewportable Golden PR Fixture

This fixture exists to prove the public pull-request lifecycle of Viewportable Engine against two real Git revisions.

The baseline on `main` is structurally clean:

- `#cta` is a child of `#pricing-card`;
- `#checkout-button` is visible;
- sampled widths are `320, 375, 430, 520`.

The golden regression branch deliberately changes only the candidate between `350px` and `499px`:

- `#cta` moves from `#pricing-card` to `#page-root`;
- `#checkout-button` becomes hidden.

Expected Viewportable evidence:

```text
350-499px exact
#checkout-button disappeared
visible -> missing

350-499px exact
#cta reparented
#pricing-card -> #page-root
```

The dedicated GitHub workflow checks out the pull request base SHA and head SHA separately, serves both versions, and runs the local candidate copy of Viewportable Engine. It enables both managed PR evidence surfaces:

- one updatable PR comment;
- one `Viewportable Engine` GitHub Check Run on the candidate head SHA.

The bootstrap PR that first adds this fixture skips comparison because its base revision does not yet contain the baseline app. Once the fixture is merged to `main`, subsequent fixture PRs execute the full comparison.
