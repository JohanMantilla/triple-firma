import type { ApiError, ApiErrorCode } from "@/contracts/api-error";

type ValidationIssue = { path: readonly PropertyKey[]; message: string };

// Every 4xx body is an ApiError: a stable code the UI translates, plus the invalid fields, if any.
export function jsonError(
  status: number,
  error: ApiErrorCode,
  issues?: readonly ValidationIssue[],
): Response {
  const body: ApiError = { error };
  if (issues !== undefined) {
    body.issues = issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    }));
  }
  return Response.json(body, { status });
}
