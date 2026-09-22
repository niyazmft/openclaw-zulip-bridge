import test from "node:test";
import assert from "node:assert/strict";

import {
  clearRefValidationCache,
  defaultRefLabel,
  findZulipRefMarkers,
  githubApiUrl,
  GITHUB_API_ORIGIN,
  MAX_REFS_PER_MESSAGE,
  parseGithubRef,
  renderZulipRefs,
} from "../src/zulip/refs.js";

type FetchCall = { url: string; init?: RequestInit };
type FakeResponse = { ok: boolean; status: number };

function makeFetch(handler: (call: FetchCall) => FakeResponse | Promise<FakeResponse>) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: any, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const result = await handler(call);
    return result as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ok = () => ({ ok: true, status: 200 });
const notFound = () => ({ ok: false, status: 404 });

const PR_URL = "https://github.com/niyazmft/openclaw-zulip-bridge/pull/307";
const COMMIT_URL = "https://github.com/niyazmft/openclaw-zulip-bridge/commit/5fe4f4c1a2b3c4d5";
const RUN_URL = "https://github.com/niyazmft/openclaw-zulip-bridge/actions/runs/12345";

// ── Marker parsing ──────────────────────────────────────────────────────────

test("findZulipRefMarkers: parses url + optional label, in order", () => {
  const markers = findZulipRefMarkers(
    `shipped it [[zulip_ref: ${PR_URL} | PR #307]] and [[zulip_ref: ${COMMIT_URL}]]`,
  );
  assert.equal(markers.length, 2);
  assert.equal(markers[0].url, PR_URL);
  assert.equal(markers[0].label, "PR #307");
  assert.equal(markers[1].url, COMMIT_URL);
  assert.equal(markers[1].label, undefined);
  assert.ok(markers[0].index < markers[1].index);
});

test("findZulipRefMarkers: ignores text with no markers", () => {
  assert.deepEqual(findZulipRefMarkers("nothing here"), []);
  assert.deepEqual(findZulipRefMarkers(""), []);
});

// ── URL parsing ─────────────────────────────────────────────────────────────

test("parseGithubRef: accepts pull, issue, commit and actions run", () => {
  assert.deepEqual(parseGithubRef(PR_URL), {
    kind: "pull",
    owner: "niyazmft",
    repo: "openclaw-zulip-bridge",
    id: "307",
  });
  assert.equal(parseGithubRef("https://github.com/o/r/issues/12")?.kind, "issue");
  assert.equal(parseGithubRef(COMMIT_URL)?.kind, "commit");
  assert.equal(parseGithubRef(RUN_URL)?.kind, "run");
  assert.equal(parseGithubRef(`${PR_URL}/`)?.kind, "pull");
});

test("parseGithubRef: rejects anything that is not a well-formed GitHub ref", () => {
  for (const url of [
    "http://github.com/o/r/pull/1",
    "https://github.com.evil.com/o/r/pull/1",
    "https://evil.com/github.com/o/r/pull/1",
    "https://github.com:8443/o/r/pull/1",
    "https://user:pass@github.com/o/r/pull/1",
    "https://github.com/o/r/pull/1?x=1",
    "https://github.com/o/r/pull/1#frag",
    "https://github.com/o/r/issues/not-a-number",
    "https://github.com/o/r/pull/",
    "https://github.com/o/r/commit/xyz",
    "https://github.com/o/r/pull/1/../../evil",
    "https://api.github.com/repos/o/r/pulls/1",
    "not a url",
  ]) {
    assert.equal(parseGithubRef(url), undefined, `expected rejection: ${url}`);
  }
});

test("githubApiUrl: hardcodes the api.github.com origin", () => {
  assert.equal(
    githubApiUrl(parseGithubRef(PR_URL)!),
    `${GITHUB_API_ORIGIN}/repos/niyazmft/openclaw-zulip-bridge/pulls/307`,
  );
  assert.match(githubApiUrl(parseGithubRef(COMMIT_URL)!), /\/commits\/5fe4f4c1a2b3c4d5$/);
  assert.match(githubApiUrl(parseGithubRef(RUN_URL)!), /\/actions\/runs\/12345$/);
});

test("defaultRefLabel: derives a readable label", () => {
  assert.equal(defaultRefLabel(parseGithubRef(PR_URL)!), "niyazmft/openclaw-zulip-bridge#307");
  assert.equal(defaultRefLabel(parseGithubRef(COMMIT_URL)!), "niyazmft/openclaw-zulip-bridge@5fe4f4c");
  assert.equal(defaultRefLabel(parseGithubRef(RUN_URL)!), "niyazmft/openclaw-zulip-bridge run 12345");
});

// ── Rendering ───────────────────────────────────────────────────────────────

test("renderZulipRefs: disabled or marker-free input is returned verbatim", async () => {
  const { fetchImpl, calls } = makeFetch(ok);
  const withMarker = `see [[zulip_ref: ${PR_URL}]]`;
  assert.equal(await renderZulipRefs(withMarker, { enabled: false, fetchImpl }), withMarker);
  assert.equal(await renderZulipRefs("plain reply", { enabled: true, fetchImpl }), "plain reply");
  assert.equal(calls.length, 0);
});

test("renderZulipRefs: a confirmed ref becomes a clickable link", async () => {
  const { fetchImpl, calls } = makeFetch(ok);
  clearRefValidationCache();
  const text = await renderZulipRefs(
    `opened [[zulip_ref: ${PR_URL} | PR #307]] — please review`,
    { enabled: true, fetchImpl },
  );
  assert.equal(text, `opened [PR #307](${PR_URL}) — please review`);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${GITHUB_API_ORIGIN}/repos/niyazmft/openclaw-zulip-bridge/pulls/307`);
  // No credentials on this path, ever.
  const headers = (calls[0].init?.headers ?? {}) as Record<string, string>;
  assert.equal(headers.Authorization, undefined);
  assert.equal(headers.authorization, undefined);
  assert.ok(headers["User-Agent"]);
});

test("renderZulipRefs: derives a label when the marker omits one", async () => {
  const { fetchImpl } = makeFetch(ok);
  clearRefValidationCache();
  const text = await renderZulipRefs(`done [[zulip_ref: ${COMMIT_URL}]]`, {
    enabled: true,
    fetchImpl,
  });
  assert.equal(text, `done [niyazmft/openclaw-zulip-bridge@5fe4f4c](${COMMIT_URL})`);
});

test("renderZulipRefs: a 404 renders as unverified plain text, not a link", async () => {
  const { fetchImpl } = makeFetch(notFound);
  clearRefValidationCache();
  const text = await renderZulipRefs(`claimed [[zulip_ref: ${PR_URL} | PR #999]]`, {
    enabled: true,
    fetchImpl,
  });
  assert.doesNotMatch(text, /\]\(/);
  assert.match(text, /`PR #999`/);
  assert.match(text, new RegExp(`\`${PR_URL.replace(/[/.]/g, "\\$&")}\``));
});

test("renderZulipRefs: non-GitHub and internal-host refs are rejected before any fetch", async () => {
  const { fetchImpl, calls } = makeFetch(ok);
  clearRefValidationCache();
  const text = await renderZulipRefs(
    [
      `a [[zulip_ref: https://evil.example.com/pr/1 | phish]]`,
      `b [[zulip_ref: http://169.254.169.254/latest/meta-data | metadata]]`,
      `c [[zulip_ref: https://github.com.evil.com/o/r/pull/1 | lookalike]]`,
    ].join("\n"),
    { enabled: true, fetchImpl },
  );
  assert.equal(calls.length, 0, "no request may be made for a rejected ref");
  assert.doesNotMatch(text, /\]\(/);
  assert.match(text, /phish/);
  assert.match(text, /metadata/);
  assert.match(text, /lookalike/);
});

test("renderZulipRefs: network error and timeout degrade to unverified text", async () => {
  clearRefValidationCache();
  const throwing = makeFetch(() => {
    throw new Error("ECONNRESET");
  });
  const errorText = await renderZulipRefs(`see [[zulip_ref: ${PR_URL} | PR #307]]`, {
    enabled: true,
    fetchImpl: throwing.fetchImpl,
  });
  assert.doesNotMatch(errorText, /\]\(/);

  clearRefValidationCache();
  const hanging = makeFetch(() => new Promise<FakeResponse>(() => {}));
  const started = Date.now();
  const timeoutText = await renderZulipRefs(`see [[zulip_ref: ${PR_URL} | PR #307]]`, {
    enabled: true,
    fetchImpl: hanging.fetchImpl,
    timeoutMs: 25,
  });
  assert.doesNotMatch(timeoutText, /\]\(/);
  assert.ok(Date.now() - started < 1500, "must return promptly on timeout");
});

test("renderZulipRefs: a rate limit is not cached, a confirmed ref is", async () => {
  clearRefValidationCache();
  let status = 403;
  const rateLimited = makeFetch(() => ({ ok: status === 200, status }));
  const limited = await renderZulipRefs(`see [[zulip_ref: ${PR_URL} | PR #307]]`, {
    enabled: true,
    fetchImpl: rateLimited.fetchImpl,
  });
  assert.doesNotMatch(limited, /\]\(/);
  assert.equal(rateLimited.calls.length, 1);

  // The limit clears on the next attempt: it must be re-checked, not cached.
  status = 200;
  const again = await renderZulipRefs(`see [[zulip_ref: ${PR_URL} | PR #307]]`, {
    enabled: true,
    fetchImpl: rateLimited.fetchImpl,
  });
  assert.match(again, /\]\(/);
  assert.equal(rateLimited.calls.length, 2);

  // A confirmed ref is cached: no third request.
  const cached = await renderZulipRefs(`see [[zulip_ref: ${PR_URL} | PR #307]]`, {
    enabled: true,
    fetchImpl: rateLimited.fetchImpl,
  });
  assert.match(cached, /\]\(/);
  assert.equal(rateLimited.calls.length, 2);
});

test("renderZulipRefs: caps the number of validated refs per message", async () => {
  clearRefValidationCache();
  const { fetchImpl, calls } = makeFetch(ok);
  const urls = Array.from({ length: MAX_REFS_PER_MESSAGE + 1 }, (_, i) =>
    `https://github.com/o/r/pull/${i + 1}`,
  );
  const text = await renderZulipRefs(
    urls.map((url, i) => `[[zulip_ref: ${url} | PR ${i + 1}]]`).join(" "),
    { enabled: true, fetchImpl },
  );
  assert.equal(calls.length, MAX_REFS_PER_MESSAGE);
  // Everything still renders, but only the first N are links.
  const links = text.match(/\]\(/g) ?? [];
  assert.equal(links.length, MAX_REFS_PER_MESSAGE);
  assert.match(text, new RegExp(`\`PR ${MAX_REFS_PER_MESSAGE + 1}\``));
});

test("renderZulipRefs: a bracket in the label renders nothing, and cannot inject a link", async () => {
  clearRefValidationCache();
  const { fetchImpl } = makeFetch(ok);
  const text = await renderZulipRefs(
    `see [[zulip_ref: ${PR_URL} | [PR](https://attacker.example)]]`,
    { enabled: true, fetchImpl },
  );
  // The marker grammar refuses labels containing `]`, so the marker never
  // parses. It must not reach the room as internal syntax, and it must not
  // become a link — especially not to the attacker host in the label.
  assert.doesNotMatch(text, /\[\[zulip_ref/);
  assert.doesNotMatch(text, /\]\(https:\/\/attacker\.example\)/);
  assert.doesNotMatch(text, new RegExp(`\\[\\]\\(${PR_URL.replace(/[/.]/g, "\\$&")}`));
  assert.match(text, /`https:\/\/github\.com\//);
});

test("renderZulipRefs: multiple refs render independently", async () => {
  clearRefValidationCache();
  const { fetchImpl } = makeFetch((call) =>
    call.url.includes("/pulls/") ? notFound() : ok(),
  );
  const text = await renderZulipRefs(
    `pr [[zulip_ref: ${PR_URL} | PR 307]] run [[zulip_ref: ${RUN_URL} | CI]]`,
    { enabled: true, fetchImpl },
  );
  assert.match(text, /`PR 307`/);
  assert.doesNotMatch(text, /\[PR 307\]/);
  assert.match(text, new RegExp(`\\[CI\\]\\(${RUN_URL.replace(/[/.]/g, "\\$&")}\\)`));
});
