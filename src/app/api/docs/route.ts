import { connection } from "next/server";

const SWAGGER_UI = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14";

const PAGE = `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Triple Firma API</title>
    <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_UI}/swagger-ui-bundle.js"></script>
    <script>
      SwaggerUIBundle({ url: "/api/openapi.json", dom_id: "#swagger-ui" });
    </script>
  </body>
</html>
`;

// Interactive documentation: Swagger UI loaded from a pinned CDN version.
export async function GET(): Promise<Response> {
  await connection();
  return new Response(PAGE, { headers: { "content-type": "text/html; charset=utf-8" } });
}
