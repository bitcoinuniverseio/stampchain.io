"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { SchemaValidator } = require("./validate-expected-changes.cjs");
const config = { schemaValidation: { enforceRequired: true, enforceTypes: true, allowAdditionalProperties: true, ignoreEndpoints: [] }, expectedChanges: { allowedNewFields: [] }, performance: { warningThreshold: 2000, criticalThreshold: 5000 } };
const item = { type: "object", required: ["id", "name"], properties: { id: { type: "integer" }, name: { type: "string", nullable: true } } };
const schema = { components: { schemas: { Item: item } }, paths: { "/api/v2/stamps/{identifier}": { get: { responses: { 200: { content: { "application/json": { schema: { $ref: "#/components/schemas/Item" } } } } } } }, "/api/v2/stamps/count": { get: { responses: { 200: { content: { "application/json": { schema: { type: "integer" } } } } } } } } };
test("Newman serialized buffers and URL segments resolve actual local response contracts", () => {
  const validator = new SchemaValidator({ config, schema });
  const body = JSON.stringify({ id: 1, name: null });
  for (const encoded of [body, Buffer.from(body), new Uint8Array(Buffer.from(body)), { type: "Buffer", data: [...Buffer.from(body)] }]) assert.equal(validator.decodeResponseBody(encoded), body);
  assert.equal(validator.extractEndpointPath({ protocol: "https", host: ["fixture", "invalid"], path: ["api", "v2", "stamps", "1"] }), "/api/v2/stamps/1");
  assert.equal(validator.validateSchemaResponse("/api/v2/stamps/1", "GET", 200, body).valid, true);
  assert.equal(validator.validateSchemaResponse("/api/v2/stamps/count", "GET", 200, "12").valid, true);
  for (const bad of ["{}", '{"id":"1","name":"valid"}', '{"id":1.5,"name":"valid"}', validator.decodeResponseBody({ type: "Buffer", data: [256] })]) assert.equal(validator.validateSchemaResponse("/api/v2/stamps/1", "GET", 200, bad).valid, false);
  assert.equal(validator.validateSchemaResponse("/not-documented", "GET", 200, body).valid, false);
  assert.equal(validator.validateSchemaResponse("/api/v2/stamps/1", "GET", 503, body).valid, false);
  assert.equal(validator.validateAgainstSchema({}, { $ref: "#/missing" }).valid, false);
  assert.equal(validator.validateAgainstSchema({}, { $ref: "https://fixture.invalid/schema" }).valid, false);
});
test("referenced arrays, composed schemas and required nested types remain blocking", () => {
  const validator = new SchemaValidator({ config, schema });
  const array = { type: "array", items: { $ref: "#/components/schemas/Item" } };
  assert.equal(validator.validateAgainstSchema([{ id: 3, name: "x" }], array).valid, true);
  assert.equal(validator.validateAgainstSchema([{ id: "wrong", name: "x" }], array).valid, false);
  assert.equal(validator.validateAgainstSchema({ id: 3 }, { allOf: [item] }).valid, false);
  assert.equal(validator.validateAgainstSchema(true, { oneOf: [{ type: "boolean" }, { type: "string" }] }).valid, true);
  assert.equal(validator.validateAgainstSchema(3, { anyOf: [{ type: "boolean" }, { type: "string" }] }).valid, false);
});
test("5000ms latency boundary and actual schema failures remain fatal with separate counts", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stamp-regression-"));
  try {
    const validator = new SchemaValidator({ config, schema }), file = path.join(dir, "results.json");
    const execution = (body, responseTime) => ({ request: { url: "https://fixture.invalid/api/v2/stamps/1", method: "GET" }, response: { code: 200, responseTime, stream: { type: "Buffer", data: [...Buffer.from(JSON.stringify(body))] } } });
    fs.writeFileSync(file, JSON.stringify({ run: { executions: [execution({ id: 1, name: "x" }, 5000), execution({ id: 1, name: "x" }, 5001), execution({ id: "bad", name: "x" }, 10)] } }));
    validator.findLatestNewmanResults = () => file;
    await validator.validateNewmanResults();
    assert.equal(validator.results.summary.schemaFailures, 1);
    assert.equal(validator.results.summary.criticalPerformanceIssues, 1);
    assert.equal(validator.results.summary.unexpectedChanges, 1);
    assert.equal(validator.results.summary.status, "failure");
    fs.writeFileSync(file, JSON.stringify({ run: { executions: [] } }));
    await assert.rejects(validator.validateNewmanResults(), /no executions/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
