# FriendlyAI Review Action

Public GitHub Action wrapper for PR validation.

This repository contains only the GitHub integration layer:

- collect pull request metadata and changed-file patches
- call a private validation API
- post a sticky pull request comment
- create a `friendlyai/review` check-run
- add inline check annotations for findings that include file and line
- fail the workflow when the API returns `conclusion: "failure"`

It does not contain private review rules, prompts, scoring logic, or validation
methodology.

## Usage

```yaml
name: FriendlyAI Review

on:
  pull_request:
    # `labeled` lets the deliberate bypass label re-run the workflow.
    types: [opened, synchronize, reopened, ready_for_review, labeled]

permissions:
  contents: read
  pull-requests: read
  issues: write
  checks: write

jobs:
  review:
    name: review verdict
    runs-on: ubuntu-latest
    steps:
      - uses: RBKunnela/friendlyai-review-action@v1.0.0
        with:
          review-api-key: ${{ secrets.FRIENDLYAI_REVIEW_API_KEY }}
          review-api-url: ${{ secrets.FRIENDLYAI_REVIEW_API_URL }}
          github-token: ${{ github.token }}
```

## Inputs

| Input | Required | Default | Description |
|---|---:|---|---|
| `review-api-key` | yes | - | API key for the private validation service. |
| `review-api-url` | yes | - | Absolute URL of the private review endpoint. |
| `github-token` | no | `${{ github.token }}` | Token used to read PR files and post comments/check-runs. |
| `max-diff-tokens` | no | `15000` | Approximate token budget for inline patches sent to the API. |
| `request-timeout-seconds` | no | `120` | Timeout for the review API request. |
| `bypass-label` | no | `friendlyai-bypass-ack-by-maintainer` | Deliberate soft-override label that bypasses validation. |

## Outputs

| Output | Description |
|---|---|
| `conclusion` | Final conclusion: `success`, `failure`, or `neutral`. |
| `finding-count` | Number of findings returned by the review service. |
| `blocking-finding-count` | Number of medium/high/critical findings returned by the review service. |
| `max-risk` | Maximum risk returned by the review service, when provided. |
| `report-url` | Optional report URL returned by the review service. |

## API Contract

The action sends a JSON request to `review-api-url`:

### Authentication

`review-api-key` is sent as an HTTP Bearer token:

```http
Authorization: Bearer <review-api-key>
Content-Type: application/json
User-Agent: friendlyai-review-action
```

```json
{
  "version": "friendlyai.review.v1",
  "repository": {
    "owner": "RBKunnela",
    "repo": "paybot-sdk",
    "fullName": "RBKunnela/paybot-sdk"
  },
  "pullRequest": {
    "number": 45,
    "title": "Improve validation",
    "body": "Pull request body",
    "baseRef": "main",
    "headRef": "feature/validation",
    "headSha": "abc1234",
    "actor": "octocat",
    "labels": [],
    "isDraft": false,
    "isFork": false
  },
  "files": [
    {
      "filename": "src/auth.ts",
      "status": "modified",
      "additions": 10,
      "deletions": 2,
      "patch": "@@ ..."
    }
  ],
  "limits": {
    "maxDiffTokens": 15000,
    "approxTokens": 1200,
    "truncated": false,
    "omittedFiles": []
  },
  "action": {
    "eventName": "pull_request",
    "runId": "123456",
    "runAttempt": "1",
    "workflow": "FriendlyAI Review",
    "actionRef": "v1"
  }
}
```

The API must return:

```json
{
  "conclusion": "failure",
  "reason": "Security validation failed.",
  "summary": "The pull request introduces unsafe command execution.",
  "maxRisk": "HIGH",
  "findings": [
    {
      "severity": "high",
      "file": "src/auth.ts",
      "line": 42,
      "issue": "User input reaches shell execution without validation.",
      "suggestion": "Validate against an allowlist or remove shell execution."
    }
  ],
  "reportUrl": "https://example.invalid/reports/123"
}
```

`findings[].file` and `findings[].line` are optional, but when both are present
the action creates inline GitHub check annotations.

## Failure Handling

This action fails closed for operational errors. The GitHub Actions job is marked
failed when any of these paths occur:

- missing required inputs: `review-api-key` or `review-api-url`
- invalid `review-api-url`
- missing `github-token` and missing `GITHUB_TOKEN`
- GitHub API errors while reading PR files or writing comments/check-runs
- private review API timeout
- private review API HTTP error response
- malformed JSON from the private review API
- response JSON that does not match the documented schema
- API verdict with `conclusion: "failure"`

The action exits neutral only for non-validation states: non-PR events, draft
PRs, fork PRs without secrets, and deliberate bypass-label use.

## Version Pinning

The example pins `@v1.0.0`. Release automation may also maintain a floating
`v1` tag for convenience, but trust-root consumers should pin an exact tag or
commit SHA.

## Public Surface

Safe to expose:

- GitHub API wrapper code
- request/response JSON schemas
- PR comment and check-run rendering
- inline annotation formatting

Kept outside this repository:

- private review rules
- prompt text
- scoring and calibration logic
- internal operational notes

## Bypass Label

The `bypass-label` input defaults to
`friendlyai-bypass-ack-by-maintainer` and skips validation when
the label is present on the PR. This is a soft override:

- The default label string is intentionally long and deliberate so it cannot be
  applied by accident or muscle memory.
- GitHub permits users with label permissions to apply labels. The action does
  not verify the labeler's role in v1.0.0.
- Pair this with branch protection that requires the `friendlyai/review` check.
  A bypass produces a `neutral` conclusion, which GitHub treats as acceptable
  for required checks.
- The real control is repository permission hygiene plus audit review of label
  events.

Planned for v1.1.x: validate the labeler's repository role through the GitHub
API and reject bypass when the actor lacks the configured role.
