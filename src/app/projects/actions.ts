"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { toUserError } from "@/lib/errors";
import { createProject as createProjectService } from "@/server/services/project-service";

export interface CreateProjectState {
  error?: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Server action for the "New Project" form. Thin adapter: delegates business
 * logic to the project service, maps failures to a form-friendly state, and
 * redirects to the new dashboard on success.
 */
export async function createProjectAction(
  _prev: CreateProjectState,
  formData: FormData
): Promise<CreateProjectState> {
  let projectId: string;
  try {
    const project = await createProjectService({
      name: formData.get("name"),
      description: formData.get("description"),
    });
    projectId = project.id;
  } catch (error) {
    const { message, details } = toUserError(error);
    return { error: message, fieldErrors: details };
  }

  revalidatePath("/projects");
  redirect(`/projects/${projectId}`);
}
