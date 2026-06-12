"use server";

import { revalidatePath } from "next/cache";

import { toUserError } from "@/lib/errors";
import { uploadFiles } from "@/server/services/file-service";

export interface UploadState {
  outcomes: { fileName: string; ok: boolean; error?: string }[];
  error?: string;
}

/**
 * Server action for the dashboard file-upload form. Delegates to the file
 * service and returns a per-file outcome so the UI can show successes and
 * failures together.
 */
export async function uploadFilesAction(
  projectId: string,
  _prev: UploadState,
  formData: FormData
): Promise<UploadState> {
  const files = formData
    .getAll("files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (files.length === 0) {
    return { outcomes: [], error: "Select at least one file to upload." };
  }

  try {
    const outcomes = await uploadFiles(projectId, files);
    revalidatePath(`/projects/${projectId}`);
    return { outcomes };
  } catch (error) {
    return { outcomes: [], error: toUserError(error).message };
  }
}
