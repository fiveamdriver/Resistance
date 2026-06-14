"use client";

import { useState } from "react";

import { AiAssistant } from "./ai-assistant";
import { BomTab } from "./bom-tab";
import { ComponentsTab } from "./components-tab";
import { ConnectivityTab } from "./connectivity-tab";
import { FileUpload } from "./file-upload";
import { FilesTable } from "./files-table";
import { NetsTab } from "./nets-tab";
import { ReportsTab } from "./reports-tab";
import type { DashboardVM } from "./view-models";

const TABS = [
  "Files",
  "Components",
  "Nets",
  "Connectivity Graph",
  "BOM",
  "AI Assistant",
  "Reports",
] as const;

type Tab = (typeof TABS)[number];

export function DashboardTabs({ vm }: { vm: DashboardVM }) {
  const [active, setActive] = useState<Tab>("Files");

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-1 border-b border-[rgba(255,255,255,0.08)]">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              active === tab
                ? "border-brand text-brand"
                : "border-transparent text-[#4a5568] hover:text-[#F5F0E8]"
            }`}
          >
            {tab}
          </button>
        ))}
      </nav>

      <div>
        {active === "Files" && (
          <div className="space-y-4">
            <FileUpload projectId={vm.project.id} />
            <FilesTable files={vm.files} />
          </div>
        )}
        {active === "Components" && (
          <ComponentsTab components={vm.components} />
        )}
        {active === "Nets" && <NetsTab nets={vm.nets} />}
        {active === "Connectivity Graph" && (
          <ConnectivityTab graph={vm.graph} />
        )}
        {active === "BOM" && <BomTab bomItems={vm.bomItems} />}
        {active === "AI Assistant" && <AiAssistant projectId={vm.project.id} />}
        {active === "Reports" && <ReportsTab vm={vm} />}
      </div>
    </div>
  );
}
