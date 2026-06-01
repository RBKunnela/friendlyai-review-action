# Resilience: the reviewer fails OPEN, not closed

Status: Accepted — wrapper hardening implemented. Date: 2026-06-01.

## Why

This action is a thin wrapper: it sends PR context to a private review API and
reports the returned verdict as the `friendlyai/review` check-run. The review
API is best-effort. When it is unavailable or returns something the wrapper
cannot interpret, the wrapper must **not** turn that into a red, merge-blocking
check for every PR. A broken reviewer fails **open** to a neutral check and
defers to the maintainer.

### The failure this fixes

A PR check went red because the wrapper threw while validating the API response:
a finding's `line` came back as `0`, and the schema required `line > 0`. The
action threw before emitting any verdict, so the check failed as a crash rather
than as a clean result. The API may legitimately return `line: 0` for a finding
that is not tied to a specific line; the wrapper must tolerate that.

(Note: this is a schema-tolerance bug, not a "we ran out of credits" bug. A
non-positive `line` can arrive on any day regardless of API quota.)

## What changed

### 1. Tolerant response schema (`src/schema.ts`)

`findings[].line` now accepts any number and **drops** the field when the value
is not a usable 1-indexed integer (`0`, negatives, NaN). The finding itself is
kept — only the unreliable line pointer is discarded. Over-long strings are
truncated and unknown fields are ignored, so minor response drift no longer
crashes the action.

### 2. Fail-open on degraded / unavailable responses (`src/review-client.ts`, `src/index.ts`)

The review call is classified instead of thrown. When the API cannot produce a
trustworthy verdict, the check is **neutral**, never red:

| Situation | Check result (neutral title) |
|---|---|
| 402 / 429 / quota / out-of-credits | `FriendlyAI review unavailable — credits/quota` |
| Request timeout / network abort | `FriendlyAI review unavailable — timeout` |
| 5xx / other non-2xx | `FriendlyAI review unavailable — upstream error` |
| 2xx but unreadable / un-coercible body | `FriendlyAI review unavailable — malformed response` |
| 2xx, parsed, conclusion = failure | **failure** (real block — unchanged) |
| 2xx, parsed, success / neutral | as returned |

Each neutral result tells the maintainer they can apply the
`friendlyai-bypass-ack-by-maintainer` label as a documented soft override. The
`unavailable-reason` output (`credits` / `timeout` / `upstream` / `malformed`)
is set so a workflow can branch on it. Only a real parsed `failure` blocks the
PR. Misconfiguration (missing inputs, bad URL, missing token) still hard-fails —
that is operator error, not reviewer breakage.

## Operating guidance

- Treat `friendlyai/review` as **required-to-run but neutral-tolerant** in branch
  protection: a neutral result is not a merge blocker; the maintainer ack is.
- A fallback that does not depend on this action (a standalone script that calls
  the review API directly, and/or a secondary provider on the API side) is the
  recommended next step so a primary-API outage never blocks merges. The floor is
  always CodeRabbit + a maintainer applying the bypass label.

## Release

Changes are staged on a feature branch; `dist/` is rebuilt. Releasing is
operator-gated: merge to `main`, `npm run build`, commit `dist/`, tag a new
patch version, then bump the pinned ref in the consumer workflow.
