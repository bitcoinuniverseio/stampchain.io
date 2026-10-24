"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), yaml = require("js-yaml");
const workflow = name => yaml.load(fs.readFileSync(path.join(__dirname, "../.github/workflows", name), "utf8"));
test("PRs retain comprehensive and schema contracts on the isolated local application", () => {
  const jobs = workflow("newman-comprehensive-tests.yml").jobs;
  assert.equal(jobs["newman-comprehensive"].if, "github.event_name != 'pull_request'");
  const local = jobs["newman-local-dev"];
  assert.ok(local.if.includes("github.event_name == 'pull_request'"));
  assert.equal(local.env.DB_HOST, "127.0.0.1");
  assert.equal(local.env.DB_NAME, "btcstamps_test");
  assert.ok(local.services.mysql && local.services.redis);
  const comprehensive = local.steps.find(step => step.name === "Run Newman tests against localhost");
  const contracts = local.steps.find(step => step.name === "Run schema contract tests against localhost");
  assert.match(comprehensive.run, /tests\/postman\/collections\/comprehensive\.json/);
  assert.match(comprehensive.run, /--env-var dev_base_url=http:\/\/127\.0\.0\.1:\$\{STAMPCHAIN_PORT\}/);
  assert.match(comprehensive.run, /--env-var prod_base_url=http:\/\/127\.0\.0\.1:\$\{STAMPCHAIN_PORT\}/);
  assert.match(contracts.run, /tests\/postman\/collections\/schema-contract-tests\.json/);
  assert.match(contracts.run, /--env-var base_url=http:\/\/127\.0\.0\.1:\$\{STAMPCHAIN_PORT\}/);
  assert.equal(comprehensive["continue-on-error"], false);
  assert.equal(contracts["continue-on-error"], false);
});
test("deployment benchmark remains on protected main and PR source gates remain present", () => {
  const jobs = workflow("production-validation.yml").jobs;
  assert.equal(jobs["performance-benchmarking"].if, "github.event_name != 'pull_request' && github.ref == 'refs/heads/main'");
  for (const name of ["production-gates", "dependency-health", "security-validation"]) assert.ok(jobs[name]);
  const source = fs.readFileSync(path.join(__dirname, "../.github/workflows/daily-regression-tests.yml"), "utf8");
  assert.match(source, /critical_issues=\$\(\(schema_failures \+ performance_failures\)\)/);
});
