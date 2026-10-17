import path from "node:path";
import { connection } from "next/server";
import { getDb } from "@/store/db";
import { findInvoiceFile } from "@/store/invoice-repository";
import { jsonError } from "../../../responses";

const CONTENT_TYPES = new Map([
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".eml", "text/plain; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
]);

// The original file, shown inline by the document viewer. nosniff stops the browser from treating it
// as anything but the declared type.
export async function GET(
  _request: Request,
  ctx: RouteContext<"/api/invoices/[id]/file">,
): Promise<Response> {
  await connection();
  const { id } = await ctx.params;
  const file = await findInvoiceFile(await getDb(), id);
  if (file === null) return jsonError(404, "NOT_FOUND");

  const extension = path.extname(file.fileName).toLowerCase();
  return new Response(file.fileBytes, {
    headers: {
      "content-type": CONTENT_TYPES.get(extension) ?? "application/octet-stream",
      "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(file.fileName))}`,
      "x-content-type-options": "nosniff",
    },
  });
}
