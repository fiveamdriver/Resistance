import Link from "next/link";
import PCBBackground from "@/components/home/pcb-background";
import FeatureTabs from "@/components/home/feature-tabs";

export default function HomePage() {
  return (
    <>
      {/* Fixed canvas background — sits behind all sections */}
      <PCBBackground />

      {/* All page content in a stacking context above the canvas */}
      <div className="relative z-10">
        {/* ── Hero ───────────────────────────────────────────────────────────── */}
        <section className="flex flex-col items-center justify-center px-6 pt-32 pb-20 text-center">
          <span className="mb-6 inline-block rounded-full border border-[rgba(255,255,255,0.15)] px-3 py-1 text-xs font-medium text-[#6b7280]">
            Phase 1 · MVP foundation
          </span>

          <h1 className="max-w-4xl text-5xl font-bold tracking-tight text-white sm:text-6xl md:text-7xl">
            Built by engineers, for engineers.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[#94a3b8]">
            Resistance turns your Altium project exports — netlists, BOMs,
            schematic PDFs, datasheets, and requirements — into a searchable
            knowledge base, a connectivity graph, and an AI assistant built for
            hardware engineers.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/projects"
              className="rounded-md bg-white px-6 py-3 font-semibold text-black transition-all hover:bg-white/90"
            >
              View projects
            </Link>
            <Link
              href="/projects/new"
              className="rounded-md border border-[rgba(255,255,255,0.2)] bg-transparent px-6 py-3 font-semibold text-white transition-all hover:bg-white/5"
            >
              Create a project
            </Link>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────────────────── */}
        <FeatureTabs />

        {/* ── Questions strip ──────────────────────────────────────────────────── */}
        <section className="py-20">
          <div className="mx-auto max-w-5xl px-6">
            <h2 className="text-center text-xs font-semibold uppercase tracking-widest text-[#4a5568]">
              Questions it will answer
            </h2>
            <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                "What connects to U7?",
                "What components are on the 5V rail?",
                "What nets connect to this IC?",
                "Which BOM rows match this component?",
                "Which datasheets belong to these parts?",
                "What design-review risks should I check?",
              ].map((q) => (
                <li
                  key={q}
                  className="flex items-start gap-3 rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3"
                >
                  <span className="mt-px font-mono text-sm text-[#4a5568]">›</span>
                  <span className="text-sm text-[#94a3b8]">{q}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </>
  );
}
