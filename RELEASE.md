# v0.1.0 Release Checklist

## Product

- [x] Per-issue responsive boundaries.
- [x] Horizontal overflow detector.
- [x] Fixed-element collision detector.
- [x] Fixed-content occlusion detector.
- [x] Conservative root-cause diagnosis.
- [x] Project config.
- [x] Deterministic suppressions.
- [x] Stable machine-readable report.
- [x] Exit codes 0 / 1 / 2.
- [x] GitHub Action surface.
- [x] Job summary and report artifact.

## Package

- [x] Repository metadata.
- [x] Homepage metadata.
- [x] Issue tracker metadata.
- [x] AGPL-3.0-only license metadata.
- [x] Full LICENSE.
- [x] Changelog.
- [x] Final npm package identity: `@viewportable/slice`.
- [x] CLI executable identity remains `slice`.
- [x] Accidental publication blocked with `"private": true`.
- [x] Package tarball can be built with `npm pack` while publication remains blocked.
- [ ] Confirm npm `@viewportable` scope permissions before any future npm publication.
- [ ] Remove `"private": true` only for an explicitly approved npm publish.

## Release engineering

- [x] `npm run validate:release` checks package identity, license, Action runtime files, and publication safety.
- [x] Tagged validation requires the tag to equal `v<package.version>`.
- [x] Tagged validation rejects `viewportable/engine@main` in release-facing Action docs.
- [x] `npm run preflight:rc` composes repository, browser, demo, release-layout, and Openings golden gates.
- [x] Tag-driven GitHub Release workflow verifies the tag commit is on `main`.
- [x] Tag-driven workflow reruns browser and composite-Action smoke checks.
- [x] Tag-driven workflow creates a `.tgz` inspection artifact.
- [x] Tag-driven workflow creates a GitHub prerelease for prerelease tags.
- [x] Release workflow contains no npm publish step.

## Acceptance

- [x] Golden harness prepared around historical broken ref `27bc8c0d...`.
- [x] Run `npm run preflight:rc` locally.
- [x] Openings broken-state golden run passes.
- [x] Exact historical mismatch window is confirmed: clean at 767px, occluded 768-819px, clean at 820px.
- [x] Openings fixed-state clean run passes.
- [x] Consecutive-run determinism passes.

## First release candidate

Local acceptance completed on 2026-09-19 against current Openings HEAD `d15848c681b4ce348b34a4ef5849ba5d1308d58a`.

After all Acceptance items are green:

- [x] Set package version to `0.1.0-rc.1`.
- [x] Finalize the changelog date/content.
- [x] Replace release-facing `viewportable/engine@main` examples with `viewportable/engine@v0.1.0-rc.1`.
- [ ] Run `npm run validate:release -- v0.1.0-rc.1`.
- [ ] Commit the RC preparation to `main`.
- [ ] Confirm CI is green on that release commit.
- [ ] Tag that exact commit `v0.1.0-rc.1`.
- [ ] Push the tag and verify the GitHub prerelease is created successfully.

## Stable v0.1.0

Do not create the stable tag until the RC has been exercised externally or otherwise accepted.

- [ ] Set package version to `0.1.0`.
- [ ] Update immutable Action examples to `viewportable/engine@v0.1.0`.
- [ ] Run `npm run validate:release -- v0.1.0`.
- [ ] Tag `v0.1.0`.
