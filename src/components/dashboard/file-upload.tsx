"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Upload } from "lucide-react";

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
      onClick={(e) => e.stopPropagation()}
      className="shrink-0 rounded border border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] px-3 py-1.5 text-xs font-medium text-[#94a3b8] transition-colors hover:bg-[rgba(255,255,255,0.09)] hover:text-[#F5F0E8] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Uploading…" : "Upload files"}
    </button>
  );
}

export function FileUpload({ projectId }: { projectId: string }) {
  const action = uploadFilesAction.bind(null, projectId);
  const [state, formAction] = useActionState(action, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileCount, setFileCount] = useState(0);

  const failures = state.outcomes.filter((o) => !o.ok);
  const successes = state.outcomes.filter((o) => o.ok);

  return (
    <div className="space-y-2">
      <form
        ref={formRef}
        action={async (formData) => {
          await formAction(formData);
          formRef.current?.reset();
          setFileCount(0);
        }}
      >
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setDragging(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (inputRef.current && e.dataTransfer.files.length) {
              const dt = new DataTransfer();
              Array.from(e.dataTransfer.files).forEach((f) => dt.items.add(f));
              inputRef.current.files = dt.files;
              setFileCount(dt.files.length);
            }
          }}
          className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
            dragging
              ? "border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.04)]"
              : "border-dashed border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] hover:border-[rgba(255,255,255,0.16)] hover:bg-[rgba(255,255,255,0.03)]"
          }`}
        >
          <Upload className="h-4 w-4 shrink-0 text-[#4a5568]" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-[#94a3b8]">
              {fileCount > 0 ? (
                <>
                  <span className="font-medium text-[#F5F0E8]">
                    {fileCount} file{fileCount > 1 ? "s" : ""} selected
                  </span>{" "}
                  — click to change
                </>
              ) : (
                <>
                  Drop files or{" "}
                  <span className="font-medium text-[#F5F0E8]">browse</span>
                </>
              )}
            </p>
            <p className="text-xs text-[#4a5568]">
              .net · .csv · .xlsx · .pdf · .schdoc · .pcbdoc · .md · .txt ·
              .docx · max 50 MB
            </p>
          </div>
          <UploadButton />
        </div>

        <input
          ref={inputRef}
          type="file"
          name="files"
          multiple
          accept={ACCEPT_ATTR}
          className="hidden"
          onChange={(e) => setFileCount(e.target.files?.length ?? 0)}
        />
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
