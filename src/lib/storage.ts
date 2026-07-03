/**
 * Local file storage helpers.
 *
 * Files are written to an on-disk uploads directory (default: `/uploads`).
 * This module is the single seam to swap for S3 / GCS / blob storage —
 * keep all disk I/O behind these functions.
 */
import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { AppError } from "./errors";
import { getExtension } from "./fileTypes";

class StorageError extends AppError {
  constructor(message: string) {
    super("STORAGE_ERROR", message);
    this.name = "StorageError";
  }
}

/** Absolute path to the uploads root directory. */
export function getUploadsRoot(): string {
  const dir = process.env.UPLOADS_DIR || "uploads";
  return path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
}

export interface StoredFile {
  storedName: string; // unique filename on disk
  relativePath: string; // path relative to uploads root (stored in DB)
  absolutePath: string; // full path on disk
  sizeBytes: number;
}

/**
 * Persist an uploaded File (Web API File from a server action) to disk under a
 * per-project subdirectory, using a collision-safe stored name.
 */
export async function saveUploadedFile(
  projectId: string,
  file: File
): Promise<StoredFile> {
  const ext = getExtension(file.name);
  const storedName = `${randomUUID()}${ext}`;
  const relativePath = path.join(projectId, storedName);

  const absoluteDir = path.join(getUploadsRoot(), projectId);
  await mkdir(absoluteDir, { recursive: true });

  const absolutePath = path.join(absoluteDir, storedName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(absolutePath, bytes);

  return {
    storedName,
    relativePath,
    absolutePath,
    sizeBytes: bytes.length,
  };
}

/**
 * Persist a datasheet into the shared library area (`uploads/library/`),
 * named by content hash so identical documents are stored exactly once
 * across all projects. Idempotent: an existing file is left untouched.
 */
export async function saveLibraryFile(
  contentHash: string,
  ext: string,
  bytes: Buffer
): Promise<StoredFile> {
  const storedName = `${contentHash}${ext}`;
  const relativePath = path.join("library", storedName);

  const absoluteDir = path.join(getUploadsRoot(), "library");
  await mkdir(absoluteDir, { recursive: true });

  const absolutePath = path.join(absoluteDir, storedName);
  try {
    // wx: fail if it already exists — first writer wins, content is identical.
    await writeFile(absolutePath, bytes, { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }

  return {
    storedName,
    relativePath,
    absolutePath,
    sizeBytes: bytes.length,
  };
}

/**
 * Resolve a DB-stored relative path back to an absolute path on disk, refusing
 * any path that escapes the uploads root (defense-in-depth against traversal,
 * even though stored names are server-generated UUIDs).
 */
export function resolveStoredPath(relativePath: string): string {
  const root = getUploadsRoot();
  const resolved = path.resolve(root, relativePath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new StorageError("Resolved path escapes the uploads directory");
  }
  return resolved;
}
