import type { ChangedFile } from "./pr-context";
import type { Finding, ReviewResponse } from "./schema";

interface IssueComment {
  id: number;
  body?: string | null;
  html_url: string;
}

interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: "notice" | "warning" | "failure";
  message: string;
  title: string;
  raw_details: string;
}

interface CreateCheckRunArgs {
  owner: string;
  repo: string;
  headSha: string;
  conclusion: ReviewResponse["conclusion"];
  title: string;
  summary: string;
  details?: string;
  annotations?: CheckAnnotation[];
}

export class GitHubClient {
  private readonly apiBase: string;

  constructor(private readonly token: string) {
    this.apiBase = process.env.GITHUB_API_URL ?? "https://api.github.com";
  }

  async listPullRequestFiles(
    owner: string,
    repo: string,
    pullNumber: number,
    page: number,
  ): Promise<ChangedFile[]> {
    return this.request<ChangedFile[]>(
      "GET",
      `/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
    );
  }

  async getCollaboratorPermission(
    owner: string,
    repo: string,
    username: string,
  ): Promise<string> {
    const response = await this.request<{ permission: string }>(
      "GET",
      `/repos/${owner}/${repo}/collaborators/${username}/permission`,
    );
    return response.permission;
  }

  async listIssueComments(
    owner: string,
    repo: string,
    issueNumber: number,
    page: number,
  ): Promise<IssueComment[]> {
    return this.request<IssueComment[]>(
      "GET",
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
    );
  }

  async updateIssueComment(
    owner: string,
    repo: string,
    commentId: number,
    body: string,
  ): Promise<IssueComment> {
    return this.request<IssueComment>(
      "PATCH",
      `/repos/${owner}/${repo}/issues/comments/${commentId}`,
      { body },
    );
  }

  async createIssueComment(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<IssueComment> {
    return this.request<IssueComment>(
      "POST",
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      { body },
    );
  }

  async createCheckRun(args: CreateCheckRunArgs): Promise<string> {
    const response = await this.request<{ id: number; html_url?: string }>(
      "POST",
      `/repos/${args.owner}/${args.repo}/check-runs`,
      {
        name: "friendlyai/review",
        head_sha: args.headSha,
        status: "completed",
        conclusion: args.conclusion,
        completed_at: new Date().toISOString(),
        output: {
          title: args.title,
          summary: args.summary,
          ...(args.details ? { text: args.details } : {}),
          ...(args.annotations && args.annotations.length > 0
            ? { annotations: args.annotations }
            : {}),
        },
      },
    );
    return (
      response.html_url ??
      `https://github.com/${args.owner}/${args.repo}/runs/${response.id}`
    );
  }

  private async request<T>(
    method: "GET" | "PATCH" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        "User-Agent": "friendlyai-review-action",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `GitHub API ${method} ${path} failed with HTTP ${response.status}: ${text.slice(0, 500)}`,
      );
    }

    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}

export type { CheckAnnotation, Finding };
