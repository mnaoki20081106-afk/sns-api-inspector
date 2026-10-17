import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const input = process.argv[2];
if (!input) {
  throw new Error("Usage: node src/openapi-inventory.js <path-to-openapi-json>");
}

const inputPath = resolve(input);
const raw = await readFile(inputPath, "utf8");
if (raw.length > 10 * 1024 * 1024) {
  throw new Error("OpenAPI JSON exceeds the 10 MiB limit.");
}

let spec;
try {
  spec = JSON.parse(raw);
} catch {
  throw new Error("Input must be valid JSON. YAML is not supported by this tool.");
}

if (!spec || typeof spec !== "object" ||
    !["3.0.0", "3.0.1", "3.0.2", "3.0.3", "3.1.0", "3.1.1"].includes(spec.openapi)) {
  throw new Error("Expected an OpenAPI 3.0.x or 3.1.x JSON document.");
}
if (!spec.paths || typeof spec.paths !== "object") {
  throw new Error("OpenAPI document has no paths object.");
}

const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "trace"]);
const globalSecurity = Array.isArray(spec.security) ? spec.security : [];
const endpoints = [];

for (const [path, pathItem] of Object.entries(spec.paths)) {
  if (!pathItem || typeof pathItem !== "object") continue;
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!methods.has(method.toLowerCase()) || !operation || typeof operation !== "object") continue;

    const requestContent = Object.keys(operation.requestBody?.content ?? {});
    const responseContent = [...new Set(
      Object.values(operation.responses ?? {})
        .flatMap(response => Object.keys(response?.content ?? {}))
    )];
    const security = operation.security === undefined ? globalSecurity : operation.security;

    endpoints.push({
      method: method.toUpperCase(),
      path,
      operation_id: typeof operation.operationId === "string" ? operation.operationId : null,
      summary: typeof operation.summary === "string" ? operation.summary : null,
      tags: Array.isArray(operation.tags) ? operation.tags : [],
      authentication_declared: Array.isArray(security) && security.length > 0,
      request_content_types: requestContent,
      response_content_types: responseContent,
      response_codes: Object.keys(operation.responses ?? {})
    });
  }
}

endpoints.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
const report = {
  source_file: inputPath.split(/[\\/]/).pop(),
  openapi_version: spec.openapi,
  api_title: spec.info?.title ?? null,
  api_version: spec.info?.version ?? null,
  endpoint_count: endpoints.length,
  endpoints
};

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/api-inventory.json", JSON.stringify(report, null, 2) + "\n");
console.log(`Wrote inventory for ${endpoints.length} documented endpoints to artifacts/api-inventory.json`);
