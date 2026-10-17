import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ExtractionSchema, type Extraction } from "@/contracts/extraction";
import { Sha256Schema } from "@/contracts/invoice";

// Extractions are cached by the SHA-256 of the file, one JSON file each. The demo and the evaluation
// run from this cache, so they work offline and give the same result every time.
export const DEFAULT_CACHE_DIR = path.join(process.cwd(), "data", "cache");

// The hash becomes part of a file name, so it is validated to keep the path inside the cache directory.
function cachePath(fileHash: string, cacheDir: string): string {
  return path.join(cacheDir, `${Sha256Schema.parse(fileHash)}.json`);
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// A missing, unparseable or schema-invalid entry is a cache miss: it is read again and overwritten.
export async function readCachedExtraction(
  fileHash: string,
  cacheDir: string = DEFAULT_CACHE_DIR,
): Promise<Extraction | null> {
  let content: string;
  try {
    content = await readFile(cachePath(fileHash, cacheDir), "utf8");
  } catch (error) {
    if (isFileNotFound(error)) return null;
    throw error;
  }

  try {
    const parsed = ExtractionSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

// Writes to a temporary file and renames it, so a crash never leaves a half-written entry.
export async function writeCachedExtraction(
  fileHash: string,
  extraction: Extraction,
  cacheDir: string = DEFAULT_CACHE_DIR,
): Promise<void> {
  const target = cachePath(fileHash, cacheDir);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await mkdir(cacheDir, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(ExtractionSchema.parse(extraction), null, 2)}\n`);
  await rename(temporary, target);
}
