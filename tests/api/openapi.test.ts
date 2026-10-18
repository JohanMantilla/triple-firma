import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "@/app/api/openapi/build-openapi";

const API_DIR = path.resolve(__dirname, "../../src/app/api");
// The documentation routes describe the API itself and are not part of the document.
const UNDOCUMENTED = new Set(["get /api/openapi.json", "get /api/docs"]);

type Operations = Record<string, Record<string, Record<string, unknown>>>;

function listRouteFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listRouteFiles(full);
    return entry.name === "route.ts" ? [full] : [];
  });
}

export function toOpenApiPath(folder: string): string {
  const segments = folder.split(path.sep).map((segment) => {
    if (/^\[\w+\]$/.test(segment)) return `{${segment.slice(1, -1)}}`;
    if (/[[\]()]/.test(segment)) throw new Error(`Unsupported route folder: ${segment}`);
    return segment;
  });
  return `/api/${segments.join("/")}`;
}

export function listExportedMethods(source: string): string[] {
  const methods = "GET|POST|PUT|PATCH|DELETE";
  const declared = source.matchAll(
    new RegExp(
      `export (?:async )?function (${methods})\\b|export (?:const|let) (${methods})\\b`,
      "g",
    ),
  );
  const listed = [...source.matchAll(/export \{([^}]*)\}/g)].flatMap((match) =>
    (match[1] ?? "").split(",").map(
      (name) =>
        name
          .trim()
          .split(/\s+as\s+/)
          .pop() ?? "",
    ),
  );
  return [...[...declared].map((match) => match[1] ?? match[2] ?? ""), ...listed].filter((name) =>
    new RegExp(`^(${methods})$`).test(name),
  );
}

function listRoutePairs(): string[] {
  return listRouteFiles(API_DIR).flatMap((file) => {
    const urlPath = toOpenApiPath(path.relative(API_DIR, path.dirname(file)));
    return listExportedMethods(readFileSync(file, "utf8")).map(
      (method) => `${method.toLowerCase()} ${urlPath}`,
    );
  });
}

describe("buildOpenApiDocument", () => {
  it("documents exactly the routes that exist", () => {
    const expected = listRoutePairs()
      .filter((pair) => !UNDOCUMENTED.has(pair))
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    const { paths } = buildOpenApiDocument() as { paths: Operations };
    const documented = Object.entries(paths).flatMap(([urlPath, item]) =>
      Object.keys(item).map((method) => `${method} ${urlPath}`),
    );
    expect(documented.sort()).toEqual(expected);
  });

  it("gives every operation a unique operationId", () => {
    const { paths } = buildOpenApiDocument() as { paths: Operations };
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

  it("marks the rules update and the approvals as human only", () => {
    const { paths } = buildOpenApiDocument();
    expect(paths["/api/config"].put["x-human-only"]).toBe(true);
    expect(paths["/api/approvals/{decisionId}"].post["x-human-only"]).toBe(true);
  });
});

describe("route helpers", () => {
  it("finds every export form of an HTTP method", () => {
    const source = [
      "export async function GET() {}",
      "export const POST = () => {};",
      "export { handler as PUT, other };",
      "export function helper() {}",
    ].join("\n");
    expect(listExportedMethods(source).sort()).toEqual(["GET", "POST", "PUT"]);
  });

  it("converts folders and rejects unsupported ones", () => {
    expect(toOpenApiPath(path.join("decisions", "[id]"))).toBe("/api/decisions/{id}");
    for (const folder of ["[...slug]", "[[...slug]]", "(group)"]) {
      expect(() => toOpenApiPath(path.join("x", folder))).toThrow(folder);
    }
  });
});
