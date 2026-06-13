"use client";

import { useActionState, useRef } from "react";
import { useFormStatus } from "react-dom";

import {
  uploadFilesAction,
  type UploadState,
} from "@/app/projects/[projectId]/actions";
import { ACCEPT_ATTR } from "@/lib/fileTypes";

const initialState: UploadState = { outcomes: [] };

function UploadButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Uploading…" : "Upload files"}
    </button>
  );
}

export function FileUpload({ projectId }: { projectId: string }) {
  const action = uploadFilesAction.bind(null, projectId);
  const [state, formAction] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);

  const failures = state.outcomes.filter((o) => !o.ok);
  const successes = state.outcomes.filter((o) => o.ok);

  return (
    <div className="space-y-3">
      <form
        ref={formRef}
        action={async (formData) => {
          await formAction(formData);
          formRef.current?.reset();
        }}
        className="flex flex-wrap items-center gap-3 rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] p-4"
      >
        <input
          type="file"
          name="files"
          multiple
          accept={ACCEPT_ATTR}
          className="text-sm text-[#94a3b8] file:mr-3 file:rounded-md file:border-0 file:bg-[rgba(255,255,255,0.08)] file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-[rgba(255,255,255,0.12)]"
        />
        <UploadButton />
        <p className="w-full text-xs text-[#4a5568]">
          Accepted: .net, .txt, .csv, .xlsx, .pdf, .md, .docx · max 25 MB each
        </p>
      </form>

      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-950/20 px-4 py-2 text-sm text-red-400"
        >
          {state.error}
        </div>
      )}

      {successes.length > 0 && (
        <div className="rounded-md border border-green-500/30 bg-green-950/20 px-4 py-2 text-sm text-green-400">
          Uploaded {successes.length} file{successes.length > 1 ? "s" : ""}.
        </div>
      )}

      {failures.length > 0 && (
        <ul className="space-y-1 rounded-md border border-red-500/30 bg-red-950/20 px-4 py-2 text-sm text-red-400">
          {failures.map((f) => (
            <li key={f.fileName}>
              <span className="font-medium">{f.fileName}</span>: {f.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
