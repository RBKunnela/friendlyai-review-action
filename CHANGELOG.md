# Changelog

## 1.0.2 - 2026-05-24

- Shortened the default bypass label to
  `friendlyai-bypass-ack-by-maintainer` so it fits GitHub's 50-character label
  name limit while remaining deliberate and auditable.

## 1.0.1 - 2026-05-24

- Made PR comment posting best-effort so repository token comment restrictions
  do not prevent the `friendlyai/review` check-run from reporting the verdict.

## 1.0.0 - 2026-05-24

- Converted the action into a public-safe wrapper around a private review API.
- Removed private review material from the repository surface.
- Replaced direct model orchestration with a `review-api-url` request.
- Added a public request/response contract for validation results.
- Added inline GitHub check annotations for findings with `file` and `line`.
- Set the default bypass label to
  `friendlyai-review-bypass-acknowledged-by-maintainer` so bypass requires a
  deliberate, auditable label.

### Breaking Changes

- Public package/repository surface is now `friendlyai-review-action`.
- Public action inputs are now `review-api-key` and `review-api-url`.
- The semantic check-run emitted by the action is now `friendlyai/review`.
- The request contract version is now `friendlyai.review.v1`.
- The default bypass label changed to
  `friendlyai-review-bypass-acknowledged-by-maintainer`.

### Release Verification

- `npm run typecheck` passed.
- `npm test` passed, including the public-surface exposure check.
- `npm run build` produced the committed `dist/index.js`.
- `npm audit --omit=dev` reported zero vulnerabilities.

### Migration Context

This repository is the public successor to the internal pre-1.0 action
repository. The internal repository should remain private and be archived after
consumers are migrated.

## Pre-1.0 internal builds

Earlier internal builds contained private review implementation details and
should not be used as the public release surface.
