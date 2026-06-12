/**
 * Zod schemas for all external inputs (form data, API requests, uploaded file
 * metadata). Parsing through these is the single boundary where untrusted input
 * becomes typed domain data.
 */
import { z } from "zod";

import { ValidationError } from "./errors";
import { isAcceptedFile } from "./fileTypes";

/** Maximum upload size per file (25 MB) — mirrors next.config server action limit. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export const createProjectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Project name is required")
    .max(120, "Project name must be 120 characters or fewer"),
  // Trim, then normalize a blank/whitespace-only field to undefined so an empty
  // form input is stored as null rather than an empty string.
  description: z
    .string()
    .trim()
    .max(2000, "Description must be 2000 characters or fewer")
    .optional()
    .transform((value) => (value === "" ? undefined : value)),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

/**
 * Validate an uploaded file's metadata (name + size). The actual bytes are
 * streamed to disk by the storage layer; here we gate type and size.
 */
export const uploadFileMetaSchema = z.object({
  name: z
    .string()
    .min(1, "File must have a name")
    .refine(isAcceptedFile, "Unsupported file type"),
  size: z
    .number()
    .int()
    .positive("File is empty")
    .max(MAX_UPLOAD_BYTES, "File exceeds the 25 MB limit"),
});

/**
 * Parse input through a schema, converting Zod failures into a structured
 * ValidationError with field-level details safe to show the user.
 */
export function parseOrThrow<T>(
  schema: z.ZodSchema<T>,
  input: unknown,
  message = "Invalid input"
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(message, result.error.flatten().fieldErrors);
  }
  return result.data;
}
