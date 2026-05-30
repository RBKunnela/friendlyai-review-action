import * as core from "./action-core";
import type { GitHubClient } from "./github-client";

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string | null;
  baseRef: string;
  headRef: string;
  headSha: string;
  isFork: boolean;
  isDraft: boolean;
  labels: string[];
  actor: string;
}

export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

export interface ReviewRequest {
  version: "friendlyai.review.v1";
  methodology: "standard" | "story-driven";
  repository: {
    owner: string;
    repo: string;
    fullName: string;
  };
  pullRequest: {
    number: number;
    title: string;
    body: string | null;
    baseRef: string;
    headRef: string;
    headSha: string;
    actor: string;
    labels: string[];
    isDraft: boolean;
    isFork: boolean;
  };
  files: ChangedFile[];
  limits: {
    maxDiffTokens: number;
    approxTokens: number;
    truncated: boolean;
    omittedFiles: string[];
  };
  action: {
    eventName: string;
    runId: string;
    runAttempt: string;
    workflow: string;
    actionRef: string;
  };
}

export interface ReviewContext {
  request: ReviewRequest;
  fileCount: number;
  truncated: boolean;
  omittedFiles: string[];
}

interface ActionMetadata {
  eventName: string;
  runId: string;
  runAttempt: string;
  workflow: string;
  actionRef: string;
}

function approxTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

async function listAllPrFiles(
  githubClient: GitHubClient,
  pr: PullRequestRef,
): Promise<ChangedFile[]> {
  const out: ChangedFile[] = [];
  let page = 1;

  while (page <= 30) {
    const data = await githubClient.listPullRequestFiles(
      pr.owner,
      pr.repo,
      pr.number,
      page,
    );

    if (data.length === 0) break;
    out.push(
      ...data.map((file: {
        filename: string;
        status: string;
        additions: number;
        deletions: number;
        patch?: string;
      }) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        patch: file.patch,
      })),
    );
    if (data.length < 100) break;
    page += 1;
  }

  return out;
}

export async function buildReviewRequest(
  githubClient: GitHubClient,
  pr: PullRequestRef,
  maxDiffTokens: number,
  action: ActionMetadata,
  methodology: "standard" | "story-driven",
): Promise<ReviewContext> {
  const files = await listAllPrFiles(githubClient, pr);
  const omittedFiles: string[] = [];
  const includedFiles: ChangedFile[] = [];

  let usedTokens = approxTokens(
    JSON.stringify({
      title: pr.title,
      body: pr.body,
      files: files.map(({ filename, status, additions, deletions }) => ({
        filename,
        status,
        additions,
        deletions,
      })),
    }),
  );

  for (const file of files) {
    if (!file.patch) {
      includedFiles.push(file);
      continue;
    }

    const patchTokens = approxTokens(file.patch);
    if (usedTokens + patchTokens > maxDiffTokens) {
      omittedFiles.push(file.filename);
      includedFiles.push({ ...file, patch: undefined });
      continue;
    }

    includedFiles.push(file);
    usedTokens += patchTokens;
  }

  const truncated = omittedFiles.length > 0;
  core.info(
    `friendlyai-review: prepared ${files.length} changed file(s), approx ${usedTokens} token(s), truncated=${truncated}.`,
  );

  return {
    request: {
      version: "friendlyai.review.v1",
      methodology,
      repository: {
        owner: pr.owner,
        repo: pr.repo,
        fullName: `${pr.owner}/${pr.repo}`,
      },
      pullRequest: {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        baseRef: pr.baseRef,
        headRef: pr.headRef,
        headSha: pr.headSha,
        actor: pr.actor,
        labels: pr.labels,
        isDraft: pr.isDraft,
        isFork: pr.isFork,
      },
      files: includedFiles,
      limits: {
        maxDiffTokens,
        approxTokens: usedTokens,
        truncated,
        omittedFiles,
      },
      action,
    },
    fileCount: files.length,
    truncated,
    omittedFiles,
  };
}
