import Link from "next/link";
import FeatureTabs from "@/components/home/feature-tabs";
import ConnectivityHeroGraph from "@/components/home/connectivity-hero-graph";
import ScrollNav from "@/components/home/scroll-nav";

export default function HomePage() {
  return (
    <>
      <div className="relative z-10">

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative flex min-h-screen items-start [scroll-snap-align:start] [scroll-snap-stop:always]">
          <div className="mx-auto grid w-full max-w-7xl grid-cols-1 gap-16 px-6 pt-32 pb-4 lg:grid-cols-[auto_1fr] lg:items-start lg:gap-12">

            {/* Left: copy ─────────────────────────────────────────────────── */}
            <div>
              <span className="inline-block rounded border border-[rgba(255,255,255,0.09)] px-2.5 py-1 font-mono text-xs text-[#374151]">
                Altium export intelligence · Beta
              </span>

              <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-[#F5F0E8] lg:text-5xl xl:text-6xl">
                Know your design.<br />Navigate it.
              </h1>

              <p className="mt-7 max-w-xs text-base leading-relaxed text-[#F5F0E8]/60">
                Drop in your Altium exports. Instantly search, trace, and
                interrogate your PCB — by refdes, net name, or pin.
                Built for designs with hundreds of nets and dozens of sheets,
                where manually hunting through schematics costs real time.
                Ask a question, get a precise answer — no digging required.
              </p>

              <div className="mt-10 flex flex-wrap gap-3">
                <Link
                  href="/projects"
                  className="rounded-md bg-[#F5F0E8] px-6 py-2.5 text-sm font-semibold text-black transition-all hover:bg-[#F5F0E8]/90"
                >
                  Open projects
                </Link>
                <Link
                  href="/projects/new"
                  className="rounded-md border border-[#F5F0E8]/20 px-6 py-2.5 text-sm font-semibold bg-[#F5F0E8] text-black transition-all hover:border-[#F5F0E8]/40 hover:bg-[#F5F0E8]/5"
                >
                  New project
                </Link>
              </div>

              <div className="mt-6 space-y-1 font-mono text-xs text-[#2d3748]">
                <div>.SchDoc · .PcbDoc · .NET · .BomDoc</div>
                <div>.xlsx · .pdf · .md · .docx · max 25 MB</div>
              </div>
            </div>

            {/* Right: live connectivity graph — frameless ──────────────────── */}
            <div className="relative h-[min(665px,60vh)] w-[calc(100%+8rem)] -ml-52 mt-20 overflow-hidden">
              <ConnectivityHeroGraph />
            </div>

          </div>

          {/* scroll indicator */}
          <ScrollNav />
        </section>

        {/* ── Features ─────────────────────────────────────────────────────── */}
        <div className="relative h-screen pt-16 [scroll-snap-align:start] [scroll-snap-stop:always]">
          <div className="max-h-screen overflow-y-auto">
            <FeatureTabs />
          </div>
        </div>

      </div>
    </>
  );
}
