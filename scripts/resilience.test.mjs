/**
 * Resilience unit tests for the wrapper hardening (fail-open-on-degraded).
 *
 * No TS test runner is vendored in this repo, so we compile the two source
 * modules under test to a temp ESM dir with the already-present `tsc`, then
 * import and assert with node:test. This keeps the dependency surface at zero.
 *
 * Covers:
 *  - schema: findings[].line === 0 (and negatives/floats) is coerced, not rejected
 *  - schema: a valid line is preserved
 *  - review-client: HTTP 402/429 + quota bodies → ok:false kind:"credits"
 *  - review-client: timeout/abort → ok:false kind:"timeout"
 *  - review-client: 2xx malformed JSON → ok:false kind:"malformed"
 *  - review-client: 2xx valid verdict with line:0 → ok:true (no crash)
 */

import { strict as assert } from "node:assert";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = mkdtempSync(join(tmpdir(), "fai-resilience-"));

// Compile the modules under test to CommonJS so Node resolves the extensionless
// relative imports (`./schema`) that TS does not rewrite. We invoke the local
// tsc entrypoint via the current node binary (npx/tsc shell shims are flaky on
// Windows runners) and load the output with createRequire.
const tscBin = fileURLToPath(
  new URL("../node_modules/typescript/bin/tsc", import.meta.url),
);
execFileSync(
  process.execPath,
  [
    tscBin,
    "src/schema.ts",
    "src/review-client.ts",
    "src/pr-context.ts",
    "--outDir",
    outDir,
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--target",
    "es2022",
    "--skipLibCheck",
    "--esModuleInterop",
  ],
  { stdio: "inherit" },
);

const require = createRequire(import.meta.url);
const schema = require(join(outDir, "schema.js"));
const client = require(join(outDir, "review-client.js"));

test.after(() => rmSync(outDir, { recursive: true, force: true }));

const baseFinding = {
  severity: "high",
  file: "src/x.ts",
  issue: "thing is wrong",
  suggestion: "fix the thing",
};

function parseResponse(findings) {
  return schema.ReviewResponseSchema.parse({
    conclusion: "neutral",
    reason: "test",
    findings,
  });
}

test("[UNIT] FindingSchema — drops line:0 instead of throwing", () => {
  const parsed = parseResponse([{ ...baseFinding, line: 0 }]);
  assert.equal(parsed.findings.length, 1);
  assert.equal(parsed.findings[0].line, undefined);
});

test("[UNIT] FindingSchema — drops negative and float lines, preserves issue", () => {
  const parsed = parseResponse([
    { ...baseFinding, line: -5 },
    { ...baseFinding, line: 3.9 },
  ]);
  assert.equal(parsed.findings.length, 2);
  assert.equal(parsed.findings[0].line, undefined);
  // 3.9 truncates to 3 (a usable 1-indexed line), so it is preserved.
  assert.equal(parsed.findings[1].line, 3);
});

test("[UNIT] FindingSchema — preserves a valid positive line", () => {
  const parsed = parseResponse([{ ...baseFinding, line: 42 }]);
  assert.equal(parsed.findings[0].line, 42);
});

test("[UNIT] FindingSchema — whole response with mixed line:0 parses cleanly", () => {
  const parsed = parseResponse([
    { ...baseFinding, line: 0 },
    { ...baseFinding, line: 0 },
    { ...baseFinding, line: 7 },
  ]);
  assert.equal(parsed.findings.length, 3);
});

// ---- review-client classification (fail-open) ----

function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      globalThis.fetch = original;
    });
}

const req = {
  apiUrl: "https://example.test/review",
  apiKey: "k",
  timeoutMs: 5000,
  request: {},
};

test("[UNIT] requestReview — HTTP 402 → ok:false kind:credits", async () => {
  await withFetch(
    async () =>
      new Response("payment required", { status: 402 }),
    async () => {
      const r = await client.requestReview(req);
      assert.equal(r.ok, false);
      assert.equal(r.kind, "credits");
    },
  );
});

test("[UNIT] requestReview — HTTP 429 quota body → ok:false kind:credits", async () => {
  await withFetch(
    async () =>
      new Response(JSON.stringify({ error: "insufficient_quota" }), {
        status: 429,
      }),
    async () => {
      const r = await client.requestReview(req);
      assert.equal(r.ok, false);
      assert.equal(r.kind, "credits");
    },
  );
});

test("[UNIT] requestReview — HTTP 500 (no quota words) → ok:false kind:upstream", async () => {
  await withFetch(
    async () => new Response("boom", { status: 500 }),
    async () => {
      const r = await client.requestReview(req);
      assert.equal(r.ok, false);
      assert.equal(r.kind, "upstream");
    },
  );
});

test("[UNIT] requestReview — abort/timeout → ok:false kind:timeout", async () => {
  await withFetch(
    async () => {
      const e = new Error("The operation was aborted");
      e.name = "AbortError";
      throw e;
    },
    async () => {
      const r = await client.requestReview(req);
      assert.equal(r.ok, false);
      assert.equal(r.kind, "timeout");
    },
  );
});

test("[UNIT] requestReview — 2xx invalid JSON → ok:false kind:malformed", async () => {
  await withFetch(
    async () => new Response("<html>not json</html>", { status: 200 }),
    async () => {
      const r = await client.requestReview(req);
      assert.equal(r.ok, false);
      assert.equal(r.kind, "malformed");
    },
  );
});

test("[UNIT] requestReview — 2xx verdict with line:0 → ok:true (no crash)", async () => {
  const body = JSON.stringify({
    conclusion: "neutral",
    reason: "ok",
    findings: [
      { severity: "medium", file: "a.ts", line: 0, issue: "x", suggestion: "y" },
    ],
  });
  await withFetch(
    async () =>
      new Response(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    async () => {
      const r = await client.requestReview(req);
      assert.equal(r.ok, true);
      assert.equal(r.response.findings.length, 1);
      assert.equal(r.response.findings[0].line, undefined);
    },
  );
});
