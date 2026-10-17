import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "@/app/api/openapi/build-openapi";

const API_DIR = path.resolve(__dirname, "../../src/app/api");
// The documentation routes describe the API itself and are not part of the document.
const UNDOCUMENTED = new Set(["get /api/openapi.json", "get /api/docs"]);

function listRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listRouteFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

function listRoutePairs(): string[] {
  return listRouteFiles(API_DIR).flatMap((file) => {
    const urlPath = `/api/${path.relative(API_DIR, path.dirname(file))}`
      .replaceAll(path.sep, "/")
      .replace(/\[(\w+)\]/g, "{$1}");
    const source = readFileSync(file, "utf8");
    const methods = [
      ...source.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g),
    ];
    return methods.map((match) => `${match[1]?.toLowerCase()} ${urlPath}`);
  });
}

function listDocumentPairs(): string[] {
  const { paths } = buildOpenApiDocument();
  return Object.entries(paths).flatMap(([urlPath, item]) =>
    Object.keys(item).map((method) => `${method} ${urlPath}`),
  );
}

describe("buildOpenApiDocument", () => {
  it("documents exactly the routes that exist", () => {
    const expected = listRoutePairs()
      .filter((pair) => !UNDOCUMENTED.has(pair))
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(listDocumentPairs().sort()).toEqual(expected);
  });

  it("gives every operation a unique operationId", () => {
    const { paths } = buildOpenApiDocument();
    const ids = Object.values(paths).flatMap((item) =>
      Object.values(item).map((operation) => operation.operationId),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("resolves every $ref to a component schema", () => {
    const document = buildOpenApiDocument();
    const refs = [
      ...JSON.stringify(document).matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g),
    ];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(document.components.schemas).toHaveProperty(ref[1] ?? "");
  });

  it("marks the rules update as human only", () => {
    expect(buildOpenApiDocument().paths["/api/config"]?.put?.["x-human-only"]).toBe(true);
  });
});
