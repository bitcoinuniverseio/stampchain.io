#!/usr/bin/env node

/**
 * validate-expected-changes.js
 *
 * Validates Newman test results against OpenAPI schema definitions
 * and distinguishes between expected vs unexpected API changes.
 *
 * This script is called by CI/CD workflows to ensure API responses
 * conform to documented schemas and detect regressions.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

class SchemaValidator {
  constructor({ config, schema } = {}) {
    this.config = config || this.loadConfig();
    this.schema = schema || this.loadOpenAPISchema();
    this.results = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests: 0,
        schemaValidations: 0,
        schemaFailures: 0,
        expectedChanges: 0,
        unexpectedChanges: 0,
        criticalPerformanceIssues: 0,
        status: "success",
      },
      validationDetails: [],
      unexpectedChanges: [],
      schemaViolations: [],
    };
  }

  loadConfig() {
    const configPath = "scripts/validate-expected-changes-config.json";

    // Create default config if it doesn't exist
    const defaultConfig = {
      expectedChanges: {
        allowedNewFields: [
          "marketData",
          "dispenserInfo",
          "cacheStatus",
          "timestamp",
          "lastUpdated",
        ],
        allowedFieldModifications: {
          "pagination": ["total", "pages", "hasNext", "hasPrev"],
          "status": ["new", "updated", "active", "inactive"],
        },
        ignoreResponseFields: [
          "responseTime",
          "timestamp",
          "cacheAge",
        ],
      },
      schemaValidation: {
        enforceRequired: true,
        enforceTypes: true,
        allowAdditionalProperties: true,
        ignoreEndpoints: [
          "/api/v2/error", // Test endpoint that intentionally returns errors
        ],
      },
      performance: {
        warningThreshold: 2000, // ms
        criticalThreshold: 5000, // ms
      },
    };

    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
      console.log(`Created default config at ${configPath}`);
    }

    try {
      return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (error) {
      console.warn(
        `Could not load config from ${configPath}, using defaults:`,
        error.message,
      );
      return defaultConfig;
    }
  }

  loadOpenAPISchema() {
    const schemaPath = "schema.yml";

    if (!fs.existsSync(schemaPath)) {
      throw new Error(`OpenAPI schema file not found at ${schemaPath}`);
    }

    try {
      const schemaContent = fs.readFileSync(schemaPath, "utf8");
      const schema = yaml.load(schemaContent);
      console.log(`Loaded OpenAPI schema from ${schemaPath}`);
      console.log(`Schema version: ${schema.info?.version || "unknown"}`);
      return schema;
    } catch (error) {
      throw new Error(`Failed to parse OpenAPI schema: ${error.message}`);
    }
  }

  findLatestNewmanResults() {
    const reportDirs = [
      "reports/daily-regression",
      "reports/newman",
      "reports",
    ];

    let latestResults = null;
    let latestTime = 0;

    for (const dir of reportDirs) {
      if (!fs.existsSync(dir)) continue;

      const files = this.findNewmanFiles(dir);
      for (const file of files) {
        const stats = fs.statSync(file);
        if (stats.mtime.getTime() > latestTime) {
          latestTime = stats.mtime.getTime();
          latestResults = file;
        }
      }
    }

    if (!latestResults) {
      throw new Error("No Newman results found. Run Newman tests first.");
    }

    console.log(`Using Newman results: ${latestResults}`);
    return latestResults;
  }

  findNewmanFiles(dir) {
    const files = [];

    if (!fs.existsSync(dir)) return files;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        files.push(...this.findNewmanFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith("-results.json")) {
        files.push(fullPath);
      }
    }

    return files;
  }

  validateSchemaResponse(endpoint, method, statusCode, responseBody) {
    const pathDef = this.schema.paths?.[endpoint] || Object.entries(this.schema.paths || {})
      .filter(([template]) => {
        const expected = template.split("/"), actual = endpoint.split("/");
        return expected.length === actual.length && expected.every((part, i) => part === actual[i] || /^\{[^{}]+\}$/.test(part) && actual[i] !== "");
      })
      .sort(([a], [b]) => (a.match(/\{/g) || []).length - (b.match(/\{/g) || []).length || a.localeCompare(b))[0]?.[1];
    if (!pathDef) {
      return {
        valid: false,
        error: `Endpoint ${endpoint} not found in OpenAPI schema`,
      };
    }

    const methodDef = pathDef[method.toLowerCase()];
    if (!methodDef) {
      return {
        valid: false,
        error: `Method ${method} not found for endpoint ${endpoint}`,
      };
    }

    const responseDef = methodDef.responses?.[statusCode.toString()];
    if (!responseDef) {
      return {
        valid: false,
        error: `Response ${statusCode} not defined for ${method} ${endpoint}`,
      };
    }

    // Extract schema from response definition
    const contentType = "application/json";
    const schemaRef = responseDef.content?.[contentType]?.schema;

    if (!schemaRef) {
      return {
        valid: true,
        warning: `No schema defined for ${statusCode} response`,
      };
    }

    // Basic schema validation (simplified for now)
    try {
      const parsedBody = typeof responseBody === "string"
        ? JSON.parse(responseBody)
        : responseBody;

      const validation = this.validateAgainstSchema(parsedBody, schemaRef);
      return validation;
    } catch (error) {
      return {
        valid: false,
        error: `Response parsing failed: ${error.message}`,
      };
    }
  }

  validateAgainstSchema(data, schema, depth = 0) {
    // Simplified schema validation - in production, use ajv or similar
    const errors = [];

    if (depth > 40) return { valid: false, errors: ["Schema recursion exceeds bound"] };
    if (schema === false) return { valid: false, errors: ["Response schema rejects this value"] };
    if (schema === true) return { valid: true };
    if (!schema || typeof schema !== "object") return { valid: false, errors: ["Response schema is invalid"] };

    if (schema.$ref) {
      if (!schema.$ref.startsWith("#/")) return { valid: false, errors: ["Only local schema references are supported"] };
      const target = schema.$ref.slice(2).split("/").reduce((value, key) => value?.[key.replace(/~1/g, "/").replace(/~0/g, "~")], this.schema);
      if (!target) return { valid: false, errors: [`Unresolved schema reference: ${schema.$ref}`] };
      return this.validateAgainstSchema(data, target, depth + 1);
    }

    if (data === null && schema.nullable) return { valid: true };
    const actualType = data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
    if (schema.type && !(schema.type === "integer" ? Number.isInteger(data) : schema.type === actualType)) return { valid: false, errors: [`Expected ${schema.type}, got ${actualType}`] };
    if (schema.enum && !schema.enum.some(value => JSON.stringify(value) === JSON.stringify(data))) errors.push("Value is outside schema enum");
    for (const part of schema.allOf || []) errors.push(...(this.validateAgainstSchema(data, part, depth + 1).errors || []));
    for (const keyword of ["anyOf", "oneOf"]) {
      if (schema[keyword]) {
        const count = schema[keyword].filter(part => this.validateAgainstSchema(data, part, depth + 1).valid).length;
        if (count === 0 || keyword === "oneOf" && count !== 1) errors.push(`Response does not satisfy ${keyword}`);
      }
    }
    if (Array.isArray(data) && schema.items) {
      data.forEach((value, index) => errors.push(...(this.validateAgainstSchema(value, schema.items, depth + 1).errors || []).map(error => `[${index}]: ${error}`)));
    }

    if (schema.type === "object" && schema.properties) {
      // Check required properties
      if (schema.required && this.config.schemaValidation.enforceRequired) {
        for (const requiredField of schema.required) {
          if (!Object.hasOwn(data, requiredField)) {
            errors.push(`Missing required field: ${requiredField}`);
          }
        }
      }

      // Check property types
      if (this.config.schemaValidation.enforceTypes) {
        for (
          const [propName, propSchema] of Object.entries(schema.properties)
        ) {
          if (Object.hasOwn(data, propName)) {
            const value = data[propName];
            errors.push(...(this.validateAgainstSchema(value, propSchema, depth + 1).errors || []).map(error => `${propName}: ${error}`));
          }
        }
      }

      // Check for unexpected properties (if not allowed)
      if (
        !this.config.schemaValidation.allowAdditionalProperties &&
        !schema.additionalProperties
      ) {
        const allowedProps = Object.keys(schema.properties || {});
        const actualProps = Object.keys(data);
        const unexpectedProps = actualProps.filter((prop) =>
          !allowedProps.includes(prop) &&
          !this.config.expectedChanges.allowedNewFields.includes(prop)
        );

        if (unexpectedProps.length > 0) {
          errors.push(`Unexpected properties: ${unexpectedProps.join(", ")}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async validateNewmanResults() {
    const resultsFile = this.findLatestNewmanResults();

    let newmanData;
    try {
      newmanData = JSON.parse(fs.readFileSync(resultsFile, "utf8"));
    } catch (error) {
      throw new Error(`Failed to parse Newman results: ${error.message}`);
    }

    console.log("Starting schema validation of Newman results...");

    const executions = newmanData.run?.executions;
    if (!Array.isArray(executions) || executions.length === 0) throw new Error("Newman report contains no executions");
    this.results.summary.totalTests = executions.length;

    for (const execution of executions) {
      const request = execution.request;
      const response = execution.response;

      if (!request || !response) {
        this.results.summary.schemaFailures++;
        this.results.schemaViolations.push({ endpoint: "/unknown", method: request?.method || "unknown", schemaErrors: ["Newman execution is missing its request or response"] });
        continue;
      }

      const endpoint = this.extractEndpointPath(request.url);
      const method = request.method;
      const statusCode = response.code;
      const responseTime = response.responseTime;

      // Skip ignored endpoints
      if (this.config.schemaValidation.ignoreEndpoints.includes(endpoint)) {
        continue;
      }

      this.results.summary.schemaValidations++;

      // Validate response against schema
      const schemaValidation = this.validateSchemaResponse(
        endpoint,
        method,
        statusCode,
        this.decodeResponseBody(response.stream),
      );

      const validationResult = {
        endpoint,
        method,
        statusCode,
        responseTime,
        schemaValid: schemaValidation.valid,
        timestamp: new Date().toISOString(),
      };

      if (!schemaValidation.valid) {
        this.results.summary.schemaFailures++;
        validationResult.schemaErrors = schemaValidation.errors ||
          [schemaValidation.error];
        this.results.schemaViolations.push(validationResult);
      }

      if (schemaValidation.warning) {
        validationResult.warning = schemaValidation.warning;
      }

      // Check performance thresholds
      if (responseTime > this.config.performance.criticalThreshold) {
        validationResult.performanceIssue = "critical";
        this.results.summary.criticalPerformanceIssues++;
        this.results.summary.unexpectedChanges++;
      } else if (responseTime > this.config.performance.warningThreshold) {
        validationResult.performanceIssue = "warning";
      }

      this.results.validationDetails.push(validationResult);
    }

    // Determine overall status
    if (
      this.results.summary.schemaFailures > 0 ||
      this.results.summary.unexpectedChanges > 0
    ) {
      this.results.summary.status = "failure";
    } else if (this.results.schemaViolations.length > 0) {
      this.results.summary.status = "warning";
    }

    console.log(`Schema validation completed:`);
    console.log(`- Total tests: ${this.results.summary.totalTests}`);
    console.log(
      `- Schema validations: ${this.results.summary.schemaValidations}`,
    );
    console.log(`- Schema failures: ${this.results.summary.schemaFailures}`);
    console.log(`- Critical latency observations: ${this.results.summary.criticalPerformanceIssues}`);
    console.log(`- Status: ${this.results.summary.status}`);
  }

  decodeResponseBody(stream) {
    if (typeof stream === "string") return stream;
    if (Buffer.isBuffer(stream) || stream instanceof Uint8Array) return Buffer.from(stream).toString("utf8");
    if (stream?.type === "Buffer" && Array.isArray(stream.data) && stream.data.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) return Buffer.from(stream.data).toString("utf8");
    return "invalid Newman response body";
  }

  extractEndpointPath(url) {
    // Extract path from Newman URL object or string
    let urlString = url;
    if (typeof url === "object") {
      urlString = url.raw ||
        url.protocol + "://" + url.host.join(".") + "/" + url.path.join("/");
    }

    try {
      const parsedUrl = new URL(urlString);
      let pathname = parsedUrl.pathname;
      
      // Normalize path to match OpenAPI schema
      // Newman results may have /v2/... but schema has /api/v2/...
      if (pathname.startsWith("/v2/")) {
        pathname = "/api" + pathname;
      }
      
      return pathname;
    } catch (error) {
      console.warn(`Could not parse URL: ${urlString}`);
      return "/unknown";
    }
  }

  generateReport() {
    const reportPath = "reports/expected-changes-validation.json";

    // Ensure reports directory exists
    const reportsDir = path.dirname(reportPath);
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
    console.log(`Validation report saved to ${reportPath}`);

    // Generate human-readable summary
    this.generateSummaryReport();
  }

  generateSummaryReport() {
    const summaryPath = "reports/schema-validation-summary.md";

    let markdown = `# OpenAPI Schema Validation Report\n\n`;
    markdown += `**Generated**: ${this.results.timestamp}\n`;
    markdown += `**Status**: ${this.results.summary.status.toUpperCase()}\n\n`;

    markdown += `## Summary\n\n`;
    markdown += `- **Total Tests**: ${this.results.summary.totalTests}\n`;
    markdown +=
      `- **Schema Validations**: ${this.results.summary.schemaValidations}\n`;
    markdown +=
      `- **Schema Failures**: ${this.results.summary.schemaFailures}\n`;
    markdown +=
      `- **Critical latency observations**: ${this.results.summary.criticalPerformanceIssues}\n\n`;

    if (this.results.schemaViolations.length > 0) {
      markdown += `## Schema Violations\n\n`;
      for (const violation of this.results.schemaViolations) {
        markdown += `### ${violation.method} ${violation.endpoint}\n`;
        markdown += `- **Status Code**: ${violation.statusCode}\n`;
        markdown += `- **Response Time**: ${violation.responseTime}ms\n`;
        if (violation.schemaErrors) {
          markdown += `- **Errors**:\n`;
          for (const error of violation.schemaErrors) {
            markdown += `  - ${error}\n`;
          }
        }
        markdown += `\n`;
      }
    }

    if (this.results.summary.status === "success") {
      markdown += `## ✅ All Validations Passed\n\n`;
      markdown +=
        `All API responses conform to the OpenAPI schema definitions.\n`;
    }

    fs.writeFileSync(summaryPath, markdown);
    console.log(`Summary report saved to ${summaryPath}`);
  }
}

// Main execution
async function main() {
  try {
    const validator = new SchemaValidator();
    await validator.validateNewmanResults();
    validator.generateReport();

    // Exit with appropriate code
    const exitCode = validator.results.summary.status === "failure" ? 1 : 0;
    console.log(
      `\nValidation ${
        validator.results.summary.status === "failure" ? "FAILED" : "PASSED"
      }`,
    );
    process.exit(exitCode);
  } catch (error) {
    console.error("Schema validation failed:", error.message);
    process.exit(1);
  }
}

// Install js-yaml if not present
if (require.main === module) {
  try {
    require("js-yaml");
    main();
  } catch (error) {
    console.log("Installing required dependency: js-yaml");
    const { execSync } = require("child_process");
    execSync("npm install --no-save js-yaml", { stdio: "inherit" });
    delete require.cache[require.resolve("js-yaml")];
    main();
  }
}

module.exports = { SchemaValidator };
