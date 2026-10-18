import { connection } from "next/server";
import { buildOpenApiDocument } from "../openapi/build-openapi";

// The machine-readable description of this API; Swagger UI at /api/docs reads it.
export async function GET(): Promise<Response> {
  await connection();
  return Response.json(buildOpenApiDocument());
}
