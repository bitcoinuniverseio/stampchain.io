// Run against a locally started, built application; see README.md.
import assert from "node:assert/strict";
import { test } from "node:test";

const base = process.env.APP_VERSION_TEST_BASE_URL;
if (!base) {
  throw new Error("Set APP_VERSION_TEST_BASE_URL to the local application base URL");
}
const baseUrl = new URL(base.endsWith("/") ? base : `${base}/`);
if (!["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname)) {
  throw new Error("APP_VERSION_TEST_BASE_URL must point to a local server");
}

const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

async function get(path) {
  const response = await fetch(new URL(path, baseUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(response.status, 200, `${path || "/"} must return 200`);
  return response;
}

let metadata;
test("published version metadata has valid build identity", async () => {
  const response = await get("version.json");
  assert.match(response.headers.get("content-type") ?? "", /\bjson\b/i);
  metadata = await response.json();
  assert.equal(typeof metadata.version, "string");
  assert.match(metadata.version, semver);
  assert.equal(typeof metadata.sha, "string");
  assert.match(metadata.sha, /^[0-9a-f]{7,40}$/i);
  assert.equal(typeof metadata.builtAt, "string");
  assert.match(metadata.builtAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/);
  assert.ok(Number.isFinite(Date.parse(metadata.builtAt)));
  assert.equal(typeof metadata.channel, "string");
  assert.ok(metadata.channel.trim().length > 0);
});

test("footer exposes the running version, short SHA and build date", async () => {
  // Fetch independently so a failed metadata test cannot mask this assertion.
  const identity = metadata ?? await (await get("version.json")).json();
  const html = await (await get("")).text();
  const footer = html.match(/<footer\b[^>]*>[\s\S]*?<\/footer\s*>/i)?.[0];
  assert.ok(footer, "application must render a footer");
  const text = footer.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.ok(text.includes(identity.version), "footer must show the running semver");
  assert.ok(
    text.toLowerCase().includes(identity.sha.slice(0, 7).toLowerCase()),
    "footer must show a recognizable short SHA",
  );
  assert.ok(
    text.includes(identity.builtAt.slice(0, 10)),
    "footer must show the build date in ISO date format",
  );
});
