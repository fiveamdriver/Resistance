/**
 * EDA adapter interface (desktop Phase 4, docs/DESKTOP_APP_PLAN.md).
 *
 * The folder sync service is EDA-agnostic: an adapter knows how to recognize
 * a project in a linked folder and produce fresh netlist/BOM exports from it.
 * KiCad (kicad-cli) is the first adapter; Altium's realistic tier is watching
 * for manually exported files, so its future adapter may return no planned
 * exports and rely on the document scan alone.
 */
import "server-only";

export interface EdaProjectInfo {
  adapterId: string;
  /** Project name shown in the UI (usually the project file's stem). */
  name: string;
  /** Absolute path to the root schematic (netlist/BOM source). */
  schematic: string;
  /** Absolute path to the EDA project file (.kicad_pro), when one exists —
   *  what "Open in KiCad" hands to the OS. */
  projectFile: string | null;
  /** Absolute path to the board file, when exactly one is unambiguous. */
  board: string | null;
  /** All design files in the folder — what auto-sync watches, and what
   *  staleness (boardMtime) is computed from. */
  designFiles: string[];
  /** EDA tool version read from the design files, e.g. "10.0". */
  generatorVersion: string | null;
}

export interface EdaExportPlan {
  filename: string;
  kind: "netlist" | "bom";
}

export interface EdaExport extends EdaExportPlan {
  content: Buffer;
}

export interface EdaAdapter {
  id: string;
  displayName: string;
  /** Recognize a project in `dir`; null if this adapter sees none. */
  detect(dir: string): Promise<EdaProjectInfo | null>;
  /** What exportArtifacts would produce — lets the scan UI list fresh
   *  exports without paying for the CLI run until import time. */
  plannedExports(info: EdaProjectInfo): EdaExportPlan[];
  /** Generate fresh exports (shells out to the EDA's CLI). */
  exportArtifacts(info: EdaProjectInfo): Promise<EdaExport[]>;
}
