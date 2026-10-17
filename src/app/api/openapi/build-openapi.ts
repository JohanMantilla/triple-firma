import { z } from "zod";
import { ApiErrorCodeSchema, ApiErrorSchema } from "@/contracts/api-error";
import { AuditVerificationSchema } from "@/contracts/audit-entry";
import { DecisionRecordSchema } from "@/contracts/decision-record";
import { HistoryEntryStatusSchema } from "@/contracts/history";
import { MetricsSchema } from "@/contracts/metrics";
import { RulesConfigSchema, RulesConfigVersionSchema } from "@/contracts/rules-config";
import pkg from "../../../../package.json";

type Json = Record<string, unknown>;
type Operation = Json & { operationId: string };
type PathItem = Partial<Record<"get" | "post" | "put", Operation>>;
type OpenApiDocument = {
  openapi: "3.1.0";
  info: Json;
  tags: Json[];
  paths: Record<string, PathItem>;
  components: { schemas: Record<string, Json> };
};

// Zod emits JSON Schema 2020-12, which is what OpenAPI 3.1 uses; only the $schema key must go.
function toSchema(schema: z.ZodType, io: "input" | "output"): Json {
  const { $schema: _dropped, ...rest } = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io,
    unrepresentable: "any",
  });
  return rest;
}

const ref = (name: string): Json => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (name: string): Json => ({
  content: { "application/json": { schema: ref(name) } },
});
const jsonArrayBody = (name: string): Json => ({
  content: { "application/json": { schema: { type: "array", items: ref(name) } } },
});

function errorResponse(description: string, codes: readonly string[]): Json {
  return {
    description: `${description} Códigos: ${codes.join(", ")}.`,
    ...jsonBody("ApiError"),
  };
}

const idParameter = (description: string): Json => ({
  name: "id",
  in: "path",
  required: true,
  description,
  schema: { type: "string" },
});

const NOT_FOUND = errorResponse("No existe.", ["NOT_FOUND"]);
const FILE_CONTENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
];

// Approvals (POST /api/approvals/{decisionId}) are not built yet; when added they are `x-human-only`.
const PATHS: Record<string, PathItem> = {
  "/api/health": {
    get: {
      operationId: "getHealth",
      tags: ["system"],
      summary: "Estado del servicio",
      description: "Úsalo para comprobar que el servidor responde.",
      responses: {
        "200": {
          description: "El servidor está activo.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { status: { const: "ok" } },
                required: ["status"],
              },
            },
          },
        },
      },
    },
  },
  "/api/invoices": {
    post: {
      operationId: "uploadInvoice",
      tags: ["invoices"],
      summary: "Subir una factura",
      description:
        "Úsalo para que el agente lea una factura (PDF, imagen, .eml o .txt) y decida PAGAR, FRENAR o ESCALAR.",
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              properties: { file: { type: "string", format: "binary" } },
              required: ["file"],
            },
          },
        },
      },
      responses: {
        "200": {
          description: "El archivo ya estaba decidido: se devuelve la decisión existente.",
          ...jsonBody("DecisionRecord"),
        },
        "201": { description: "Decisión nueva.", ...jsonBody("DecisionRecord") },
        "400": errorResponse("Solicitud inválida.", [
          "MISSING_FILE",
          "UNSUPPORTED_FILE_TYPE",
          "EMPTY_SOURCE_TEXT",
        ]),
        "409": errorResponse("Aún no hay reglas configuradas.", ["NO_RULES_CONFIG"]),
        "413": errorResponse("Archivo demasiado grande.", [
          "FILE_TOO_LARGE",
          "SOURCE_TEXT_TOO_LONG",
        ]),
      },
    },
  },
  "/api/invoices/{id}/file": {
    get: {
      operationId: "getInvoiceFile",
      tags: ["invoices"],
      summary: "Archivo original de la factura",
      description: "Úsalo para mostrar o descargar el archivo exactamente como llegó.",
      parameters: [idParameter("Identificador de la decisión o factura.")],
      responses: {
        "200": {
          description: "Bytes originales del archivo.",
          content: Object.fromEntries(
            FILE_CONTENT_TYPES.map((type) => [
              type,
              { schema: { type: "string", format: "binary" } },
            ]),
          ),
        },
        "404": NOT_FOUND,
      },
    },
  },
  "/api/decisions": {
    get: {
      operationId: "listDecisions",
      tags: ["decisions"],
      summary: "Listar decisiones",
      description:
        "Úsalo para ver las decisiones, de la más nueva a la más antigua; filtra por estado para ver la bandeja de escaladas.",
      parameters: [
        {
          name: "status",
          in: "query",
          required: false,
          description: "Estado resultante de la decisión.",
          schema: toSchema(HistoryEntryStatusSchema, "input"),
        },
      ],
      responses: {
        "200": { description: "Lista de decisiones.", ...jsonArrayBody("DecisionRecord") },
        "400": errorResponse("Filtro inválido.", ["INVALID_REQUEST"]),
      },
    },
  },
  "/api/decisions/{id}": {
    get: {
      operationId: "getDecision",
      tags: ["decisions"],
      summary: "Detalle de una decisión",
      description:
        "Úsalo para leer el resultado por regla y la explicación de una decisión concreta.",
      parameters: [idParameter("Identificador de la decisión.")],
      responses: {
        "200": { description: "La decisión.", ...jsonBody("DecisionRecord") },
        "404": NOT_FOUND,
      },
    },
  },
  "/api/config": {
    get: {
      operationId: "getRulesConfig",
      tags: ["config"],
      summary: "Reglas vigentes",
      description: "Úsalo para leer la versión actual de las reglas configuradas.",
      responses: {
        "200": { description: "Versión vigente de las reglas.", ...jsonBody("RulesConfigVersion") },
        "404": NOT_FOUND,
      },
    },
    put: {
      operationId: "saveRulesConfig",
      tags: ["config"],
      summary: "Guardar reglas",
      description:
        "Úsalo solo con autorización de una persona: crea una versión nueva de las reglas y todavía no hay autenticación.",
      "x-human-only": true,
      requestBody: { required: true, ...jsonBody("RulesConfigInput") },
      responses: {
        "200": { description: "Versión guardada.", ...jsonBody("RulesConfigVersion") },
        "400": errorResponse("Reglas inválidas; `issues` lista los campos.", ["INVALID_REQUEST"]),
      },
    },
  },
  "/api/audit/verify": {
    get: {
      operationId: "verifyAuditChain",
      tags: ["audit"],
      summary: "Verificar el registro",
      description:
        "Úsalo para comprobar que la cadena de hashes del registro de auditoría no fue alterada.",
      responses: {
        "200": { description: "Resultado de la verificación.", ...jsonBody("AuditVerification") },
      },
    },
  },
  "/api/metrics": {
    get: {
      operationId: "getMetrics",
      tags: ["metrics"],
      summary: "Métricas",
      description:
        "Úsalo para ver autonomía, exactitud y fugas de las decisiones guardadas frente a lo esperado.",
      responses: { "200": { description: "Métricas.", ...jsonBody("Metrics") } },
    },
  },
};

export function buildOpenApiDocument(): OpenApiDocument {
  return {
    openapi: "3.1.0",
    info: {
      title: "Triple Firma API",
      version: pkg.version,
      description:
        "El LLM lee, el código decide, la persona autoriza. Nota: «Try it out» usa la base de datos a la que apunta el servidor; las operaciones con x-human-only requieren autorización de una persona.",
    },
    tags: [
      { name: "system", description: "Estado del servicio" },
      { name: "invoices", description: "Facturas" },
      { name: "decisions", description: "Decisiones" },
      { name: "config", description: "Reglas" },
      { name: "audit", description: "Registro de auditoría" },
      { name: "metrics", description: "Métricas" },
    ],
    paths: PATHS,
    components: {
      schemas: {
        ApiError: {
          ...toSchema(ApiErrorSchema, "output"),
          description: `Cuerpo de todo error 4xx. Códigos: ${ApiErrorCodeSchema.options.join(", ")}.`,
        },
        DecisionRecord: toSchema(DecisionRecordSchema, "output"),
        RulesConfig: toSchema(RulesConfigSchema, "output"),
        RulesConfigInput: toSchema(RulesConfigSchema, "input"),
        RulesConfigVersion: toSchema(RulesConfigVersionSchema, "output"),
        Metrics: toSchema(MetricsSchema, "output"),
        AuditVerification: toSchema(AuditVerificationSchema, "output"),
      },
    },
  };
}
