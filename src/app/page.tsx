import Link from "next/link";

const FEATURES = [
  {
    title: "Project knowledge base",
    body: "Upload Altium exports, BOMs, datasheets, and requirements into one searchable workspace.",
  },
  {
    title: "Connectivity graph",
    body: "See what connects to U7, what's on the 5V rail, and which nets reach an IC.",
  },
  {
    title: "BOM intelligence",
    body: "Match BOM rows to placed components and link datasheets to the right parts.",
  },
  {
    title: "AI design assistant",
    body: "Ask questions in plain English and surface design-review risks for a human to check.",
  },
];

const QUESTIONS = [
  "What connects to U7?",
  "What components are on the 5V rail?",
  "What nets connect to this IC?",
  "Which BOM rows match this component?",
  "Which datasheets belong to these parts?",
  "What design-review risks should I check?",
];

export default function HomePage() {
  return (
    <div className="space-y-12">
      <section className="space-y-4">
        <span className="inline-block rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-brand">
          Phase 1 · MVP foundation
        </span>
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">
          An AI assistant for your electrical engineering projects
        </h1>
        <p className="max-w-2xl text-lg text-slate-600">
          Resistance turns your Altium project exports — netlists, BOMs,
          schematic PDFs, datasheets, and requirements — into a searchable
          knowledge base, a connectivity graph, and an AI assistant for hardware
          engineers.
        </p>
        <div className="flex gap-3 pt-2">
          <Link
            href="/projects"
            className="rounded-md bg-brand px-5 py-2.5 font-medium text-white hover:bg-brand-dark"
          >
            View projects
          </Link>
          <Link
            href="/projects/new"
            className="rounded-md border border-slate-300 bg-white px-5 py-2.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            Create a project
          </Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="rounded-lg border border-slate-200 bg-white p-5"
          >
            <h3 className="font-semibold text-slate-900">{f.title}</h3>
            <p className="mt-1 text-sm text-slate-600">{f.body}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Questions it will answer
        </h2>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {QUESTIONS.map((q) => (
            <li key={q} className="flex items-start gap-2 text-slate-700">
              <span className="text-brand">›</span>
              <span>{q}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
