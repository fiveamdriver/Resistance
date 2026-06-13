import Link from "next/link";
import FeatureTabs from "@/components/home/feature-tabs";

export default function HomePage() {
  return (
    <>
      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <div className="relative z-10">
        <section className="relative flex min-h-screen flex-col items-center justify-center px-6 pt-32 pb-20 text-center [scroll-snap-align:start] [scroll-snap-stop:always]">
          <span className="mb-6 inline-block rounded-full border border-[rgba(255,255,255,0.15)] px-3 py-1 text-xs font-medium text-[#6b7280]">
            Phase 1 · MVP foundation
          </span>

          <h1 className="max-w-4xl text-5xl font-bold tracking-tight text-white sm:text-6xl md:text-7xl">
            Built by engineers, for engineers.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[#94a3b8]">
            Drop in your Altium exports — netlists, BOMs, schematic PDFs,
            datasheets, requirements — and Resistance builds you a dynamic,
            interactive dashboard: searchable knowledge base, live connectivity
            graph, and an AI assistant that actually understands your hardware.
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

          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce opacity-25">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M5 7.5L10 12.5L15 7.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────────────────── */}
        <div className="h-screen pt-12 [scroll-snap-align:start] [scroll-snap-stop:always]">
          <div className="max-h-screen overflow-y-auto">
            <FeatureTabs />
          </div>
        </div>
      </div>
    </>
  );
}
