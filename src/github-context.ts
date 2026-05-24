import { readFileSync } from "node:fs";

interface PullRequestPayload {
  number: number;
  title?: string;
  body?: string | null;
  draft?: boolean;
  labels?: Array<{ name?: string }>;
  user?: { login?: string };
  base?: { ref?: string; repo?: { full_name?: string } };
  head?: { ref?: string; sha?: string; repo?: { full_name?: string } };
}

interface EventPayload {
  pull_request?: PullRequestPayload;
}

export interface GitHubContext {
  eventName: string;
  actor: string;
  runId: string;
  repo: {
    owner: string;
    repo: string;
  };
  payload: EventPayload;
}

export function getGitHubContext(): GitHubContext {
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error("GITHUB_REPOSITORY must be set to owner/repo.");
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is required.");
  }

  const payload = JSON.parse(readFileSync(eventPath, "utf8")) as EventPayload;

  return {
    eventName: process.env.GITHUB_EVENT_NAME ?? "",
    actor: process.env.GITHUB_ACTOR ?? "",
    runId: process.env.GITHUB_RUN_ID ?? "",
    repo: { owner, repo },
    payload,
  };
}
