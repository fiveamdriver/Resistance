"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  createProjectAction,
  type CreateProjectState,
} from "@/app/projects/actions";

const initialState: CreateProjectState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-white px-5 py-2.5 font-semibold text-black transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Creating…" : "Create project"}
    </button>
  );
}

export function NewProjectForm() {
  const [state, formAction] = useActionState(createProjectAction, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <div
          role="alert"
          className="rounded-md border border-red-500/30 bg-red-950/20 px-4 py-3 text-sm text-red-400"
        >
          {state.error}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="name" className="block text-sm font-medium text-[#94a3b8]">
          Project name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={120}
          placeholder="e.g. Power Board Rev B"
          className="w-full rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-white placeholder:text-[#2a2a35] outline-none transition focus:border-[rgba(255,255,255,0.3)] focus:ring-1 focus:ring-[rgba(255,255,255,0.1)]"
        />
        {state.fieldErrors?.name?.map((msg) => (
          <p key={msg} className="text-xs text-red-400">
            {msg}
          </p>
        ))}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="description" className="block text-sm font-medium text-[#94a3b8]">
          Description{" "}
          <span className="text-[#4a5568]">(optional)</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          maxLength={2000}
          placeholder="Short description of the board / system"
          className="w-full rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-3 py-2 text-white placeholder:text-[#2a2a35] outline-none transition focus:border-[rgba(255,255,255,0.3)] focus:ring-1 focus:ring-[rgba(255,255,255,0.1)]"
        />
        {state.fieldErrors?.description?.map((msg) => (
          <p key={msg} className="text-xs text-red-400">
            {msg}
          </p>
        ))}
      </div>

      <SubmitButton />
    </form>
  );
}
