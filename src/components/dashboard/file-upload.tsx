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
      className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
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
        className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-4"
      >
        <input
          type="file"
          name="files"
          multiple
          accept={ACCEPT_ATTR}
          className="text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
        <UploadButton />
        <p className="w-full text-xs text-slate-400">
          Accepted: .net, .txt, .csv, .xlsx, .pdf, .md, .docx · max 25 MB each
        </p>
      </form>

      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
        >
          {state.error}
        </div>
      )}

      {successes.length > 0 && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
          Uploaded {successes.length} file{successes.length > 1 ? "s" : ""}.
        </div>
      )}

      {failures.length > 0 && (
        <ul className="space-y-1 rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
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
