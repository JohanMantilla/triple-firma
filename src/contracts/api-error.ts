import { z } from "zod";

// Stable codes the UI translates into Spanish: the API never sends user-facing text.
export const ApiErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "MISSING_FILE",
  "FILE_TOO_LARGE",
  "UNSUPPORTED_FILE_TYPE",
  "EMPTY_SOURCE_TEXT",
  "SOURCE_TEXT_TOO_LONG",
  "NO_RULES_CONFIG",
  "NOT_FOUND",
  "NOT_ESCALATED",
  "ALREADY_RESOLVED",
  "UNAUTHORIZED",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

// Body of every 4xx response. issues lists the invalid fields of a rejected body, such as a rules config.
export const ApiErrorSchema = z.object({
  error: ApiErrorCodeSchema,
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
