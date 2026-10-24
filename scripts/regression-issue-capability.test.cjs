"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { canOpenRegressionIssue } = require("./regression-issue-capability.cjs");

test("disabled Issues retain a visible alert without calling issue APIs", async () => {
  const messages = [], summary = { addHeading: x => { messages.push(x); return summary; }, addRaw: x => { messages.push(x); return summary; }, addLink: (...x) => { messages.push(x.join(" ")); return summary; }, write: async () => {} };
  const config = { context: { repo: { owner: "bitcoinuniverseio", repo: "stampchain.io" }, runId: 123, serverUrl: "https://github.com" }, github: { rest: { repos: { get: async () => ({ data: { has_issues: false } }) } } }, core: { warning: x => messages.push(x), summary } };
  assert.equal(await canOpenRegressionIssue(config), false);
  assert.ok(messages.some(x => x.includes("gate still fails")));
  assert.ok(messages.some(x => x.includes("/actions/runs/123")));
  config.github.rest.repos.get = async () => ({ data: { has_issues: true } });
  assert.equal(await canOpenRegressionIssue(config), true);
  config.github.rest.repos.get = async () => ({ data: {} });
  await assert.rejects(canOpenRegressionIssue(config), /not returned/);
  const denied = new Error("403 Forbidden");
  config.github.rest.repos.get = async () => { throw denied; };
  await assert.rejects(canOpenRegressionIssue(config), x => x === denied);
});
