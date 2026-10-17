import type { SourceFormat } from "@/contracts/invoice";

// What the extraction module needs to know about one received invoice file.
export type ExtractInvoiceInput = {
  fileHash: string;
  fileBuffer: Buffer;
  sourceFormat: SourceFormat;
  sourceText: string | null;
};
