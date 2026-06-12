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
      className="rounded-md bg-brand px-5 py-2.5 font-medium text-white hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-60"
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
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {state.error}
        </div>
      )}

      <div className="space-y-1.5">
        <label htmlFor="name" className="block text-sm font-medium text-slate-700">
          Project name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          maxLength={120}
          placeholder="e.g. Power Board Rev B"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        />
        {state.fieldErrors?.name?.map((msg) => (
          <p key={msg} className="text-xs text-red-600">
            {msg}
          </p>
        ))}
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="description"
          className="block text-sm font-medium text-slate-700"
        >
          Description <span className="text-slate-400">(optional)</span>
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          maxLength={2000}
          placeholder="Short description of the board / system"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-brand focus:ring-1 focus:ring-brand"
        />
        {state.fieldErrors?.description?.map((msg) => (
          <p key={msg} className="text-xs text-red-600">
            {msg}
          </p>
        ))}
      </div>

      <SubmitButton />
    </form>
  );
}
