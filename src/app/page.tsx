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
          <div className="grid w-full grid-cols-1 gap-16 px-8 pt-28 pb-16 lg:grid-cols-[auto_1fr] lg:items-start lg:gap-12 xl:px-16">

            {/* Left: copy ─────────────────────────────────────────────────── */}
            <div className="relative z-10 pt-10">
              <span className="inline-block rounded border border-[rgba(var(--overlay-rgb),0.09)] px-2.5 py-1 font-mono text-xs text-[#374151]">
                Altium export intelligence · Beta
              </span>

              <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-[var(--fg)] lg:text-5xl xl:text-6xl">
                Know your design.<br />Navigate it.
              </h1>

              <p className="mt-7 max-w-xs text-base leading-relaxed text-[var(--fg)]/60">
                Drop in your Altium exports. Instantly search, trace, and
                interrogate your PCB — by refdes, net name, or pin.
                Built for designs with hundreds of nets and dozens of sheets,
                where manually hunting through schematics costs real time.
                Ask a question, get a precise answer — no digging required.
              </p>

              <div className="mt-10 flex flex-wrap gap-3">
                <Link
                  href="/projects"
                  className="rounded-md bg-[var(--accent-bg)] px-6 py-2.5 text-sm font-semibold text-[var(--accent-fg)] transition-all hover:bg-[var(--accent-bg-hover)]"
                >
                  Open projects
                </Link>
                <Link
                  href="/projects/new"
                  className="rounded-md border border-[rgba(var(--accent-bg-rgb),0.2)] px-6 py-2.5 text-sm font-semibold bg-[var(--accent-bg)] text-[var(--accent-fg)] transition-all hover:border-[rgba(var(--accent-bg-rgb),0.4)] hover:bg-[rgba(var(--accent-bg-rgb),0.05)]"
                >
                  New project
                </Link>
              </div>

              <div className="mt-6 space-y-1 font-mono text-xs text-[#2d3748]">
                <div>.SchDoc · .PcbDoc · .NET · .BomDoc</div>
                <div>.xlsx · .pdf · .md · .docx · max 25 MB</div>
              </div>
            </div>

            {/* Right: live connectivity graph ──────────────────────────── */}
            <div className="relative z-0 h-[80vh] w-full overflow-hidden lg:-ml-24 mt-8 [@media(min-height:800px)]:mt-0">
              <ConnectivityHeroGraph />
            </div>

          </div>

          {/* scroll indicator */}
          <ScrollNav />
        </section>

        {/* ── Features ─────────────────────────────────────────────────────── */}
        <div className="relative flex h-screen items-center [scroll-snap-align:start] [scroll-snap-stop:always]">
          <div className="w-full max-h-screen overflow-y-auto">
            <FeatureTabs />
          </div>
        </div>

      </div>
    </>
  );
}
