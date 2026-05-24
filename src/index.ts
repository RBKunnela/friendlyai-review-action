/**
 * Public GitHub Action wrapper for FriendlyAI Review validation.
 *
 * This package intentionally does not contain review prompts, rubric logic, or
 * scoring methodology. It collects PR context, sends it to a private review API,
 * then reports the returned public verdict back to GitHub.
 */

import * as core from "./action-core";
import { GitHubClient } from "./github-client";
import { getGitHubContext } from "./github-context";
import { requestReview } from "./review-client";
import { buildReviewRequest, type PullRequestRef } from "./pr-context";
import {
  COMMENT_MARKER,
  postCheckRun,
  postOrUpdateComment,
  renderComment,
} from "./report";
import { countBlockingFindings } from "./schema";

async function actorIsCollaborator(
  githubClient: GitHubClient,
  owner: string,
  repo: string,
  username: string,
): Promise<boolean> {
  try {
    const permission = await githubClient.getCollaboratorPermission(
      owner,
      repo,
      username,
    );
    return ["admin", "maintain", "write"].includes(permission);
  } catch (err) {
    core.warning(
      `friendlyai-review: could not resolve collaborator permission for @${username}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return false;
  }
}

function parsePositiveInt(inputName: string, fallback: number): number {
  const raw = core.getInput(inputName);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${inputName} must be a positive integer.`);
  }
  return parsed;
}

function requireUrl(inputName: string): string {
  const raw = core.getInput(inputName, { required: true });
  try {
    return new URL(raw).toString();
  } catch {
    throw new Error(`${inputName} must be an absolute URL.`);
  }
}

async function run(): Promise<void> {
  try {
    const reviewApiKey = core.getInput("review-api-key", { required: true });
    const reviewApiUrl = requireUrl("review-api-url");
    const ghToken = core.getInput("github-token") || process.env.GITHUB_TOKEN;
    const maxDiffTokens = parsePositiveInt("max-diff-tokens", 15000);
    const timeoutSeconds = parsePositiveInt("request-timeout-seconds", 120);
    const bypassLabel =
      core.getInput("bypass-label") ||
      "friendlyai-review-bypass-acknowledged-by-maintainer";

    if (!ghToken) {
      throw new Error(
        "github-token input or GITHUB_TOKEN env var is required to post comments.",
      );
    }

    const context = getGitHubContext();
    if (
      context.eventName !== "pull_request" &&
      context.eventName !== "pull_request_target"
    ) {
      core.info(
        `friendlyai-review: event "${context.eventName}" is not a pull_request event; skipping.`,
      );
      return;
    }

    const pull = context.payload.pull_request;
    if (!pull) {
      throw new Error("Event payload has no pull_request.");
    }

    const githubClient = new GitHubClient(ghToken);
    const baseRepoFullName = pull.base?.repo?.full_name;
    const headRepoFullName = pull.head?.repo?.full_name;
    const isFork = !!(
      baseRepoFullName &&
      headRepoFullName &&
      baseRepoFullName !== headRepoFullName
    );

    const labels: string[] = Array.isArray(pull.labels)
      ? pull.labels.map((label) => label.name ?? "").filter(Boolean)
      : [];

    const pr: PullRequestRef = {
      owner: context.repo.owner,
      repo: context.repo.repo,
      number: pull.number,
      title: pull.title ?? "(no title)",
      body: pull.body ?? null,
      baseRef: pull.base?.ref ?? "main",
      headRef: pull.head?.ref ?? "",
      headSha: pull.head?.sha ?? "",
      isFork,
      isDraft: !!pull.draft,
      labels,
      actor: pull.user?.login ?? context.actor,
    };

    core.info(
      `friendlyai-review: PR #${pr.number} "${pr.title}" by @${pr.actor} (fork=${pr.isFork}, draft=${pr.isDraft})`,
    );

    if (pr.isDraft) {
      await postCheckRun({
        githubClient,
        owner: pr.owner,
        repo: pr.repo,
        headSha: pr.headSha,
        conclusion: "neutral",
        title: "Skipped: draft PR",
        summary: "FriendlyAI Review waits until the PR is marked ready for review.",
      });
      core.setOutput("conclusion", "neutral");
      return;
    }

    if (pr.isFork) {
      await postOrUpdateComment({
        githubClient,
        owner: pr.owner,
        repo: pr.repo,
        prNumber: pr.number,
        body: [
          COMMENT_MARKER,
          "",
          "## FriendlyAI Review skipped on fork PR",
          "",
          "FriendlyAI Review did not run because GitHub does not expose repository secrets",
          "to workflows triggered by fork contributors.",
        ].join("\n"),
      });
      await postCheckRun({
        githubClient,
        owner: pr.owner,
        repo: pr.repo,
        headSha: pr.headSha,
        conclusion: "neutral",
        title: "Skipped: fork PR",
        summary: "FriendlyAI Review does not run on fork PRs without explicit maintainer setup.",
      });
      core.setOutput("conclusion", "neutral");
      return;
    }

    if (labels.includes(bypassLabel)) {
      await postOrUpdateComment({
        githubClient,
        owner: pr.owner,
        repo: pr.repo,
        prNumber: pr.number,
        body: [
          COMMENT_MARKER,
          "",
          "## FriendlyAI Review bypassed",
          "",
          `Validation was skipped because the \`${bypassLabel}\` label is present.`,
          "",
          "Treat this as a documented soft override. Restrict who can apply this label through repository permissions.",
        ].join("\n"),
      });
      await postCheckRun({
        githubClient,
        owner: pr.owner,
        repo: pr.repo,
        headSha: pr.headSha,
        conclusion: "neutral",
        title: "Bypassed by label",
        summary: `Validation skipped because the ${bypassLabel} label is present.`,
      });
      core.setOutput("conclusion", "neutral");
      return;
    }

    const prContext = await buildReviewRequest(
      githubClient,
      pr,
      maxDiffTokens,
      {
        eventName: context.eventName,
        runId: context.runId,
        runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? "1",
        workflow: process.env.GITHUB_WORKFLOW ?? "",
        actionRef: process.env.GITHUB_ACTION_REF ?? "",
      },
    );

    const response = await requestReview({
      apiUrl: reviewApiUrl,
      apiKey: reviewApiKey,
      timeoutMs: timeoutSeconds * 1000,
      request: prContext.request,
    });

    const runUrl = `https://github.com/${pr.owner}/${pr.repo}/actions/runs/${context.runId}`;
    const commentBody = renderComment({
      response,
      runUrl,
      fileCount: prContext.fileCount,
      truncated: prContext.truncated,
      omittedFiles: prContext.omittedFiles,
    });

    const commentUrl = await postOrUpdateComment({
      githubClient,
      owner: pr.owner,
      repo: pr.repo,
      prNumber: pr.number,
      body: commentBody,
    });
    core.info(`friendlyai-review: comment posted/updated -> ${commentUrl}`);

    const checkUrl = await postCheckRun({
      githubClient,
      owner: pr.owner,
      repo: pr.repo,
      headSha: pr.headSha,
      conclusion: response.conclusion,
      title: response.reason,
      summary:
        response.summary ??
        `${response.findings.length} finding(s), max risk: ${response.maxRisk ?? "unknown"}.`,
      details: commentBody,
      findings: response.findings,
    });
    core.info(`friendlyai-review: check-run posted -> ${checkUrl}`);

    const blockingCount = countBlockingFindings(response.findings);
    core.setOutput("conclusion", response.conclusion);
    core.setOutput("finding-count", String(response.findings.length));
    core.setOutput("blocking-finding-count", String(blockingCount));
    core.setOutput("max-risk", response.maxRisk ?? "");
    if (response.reportUrl) core.setOutput("report-url", response.reportUrl);

    if (response.conclusion === "failure") {
      core.setFailed(`FriendlyAI Review blocked merge: ${response.reason}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    core.setFailed(`friendlyai-review: ${msg}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run();
