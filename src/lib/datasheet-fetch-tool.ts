/**
 * fetch_datasheet — assistant tool that closes the "here's a URL, go upload
 * it yourself" gap: when document search misses a part's datasheet, the
 * assistant can retrieve and ingest it through the SAME pipeline the design
 * review uses (ingest-service), with every trust property intact:
 *
 *  - Gated by the Settings "Datasheet web fetch" toggle (off = tool refuses).
 *  - Every fetched PDF passes the verification gate; failures are quarantined
 *    for one-click human approval and are NEVER silently indexed.
 *  - Provenance is preserved (design_link / web_fetch) so citations keep
 *    carrying the "found online" caveat.
 *
 * Assistant-only: the design review already runs this pipeline up front for
 * the whole BOM, so this tool is not added to its tool list.
 */
import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { prisma } from "@/lib/prisma";
import { enrichMpn } from "@/server/services/datasheet-service";
import { ingestRemotePdf } from "@/server/services/ingest-service";
import { getSettings } from "@/server/services/settings-service";

export const fetchTools: Anthropic.Messages.Tool[] = [
  {
    name: "fetch_datasheet",
    description:
      "Find, download, verify, and index the datasheet for a component so search_documents can ground answers in it. Use when search_documents found nothing for a part-specific question and the part has an MPN. The document goes through the same verification gate as all ingested datasheets: status 'ingested' means it is verified and searchable right now (re-run search_documents); status 'quarantined' means it was fetched but failed automatic verification and is waiting for the user's one-click approval in the Files tab — tell the user that, it is different from 'not on file'. Respects the 'Datasheet web fetch' Settings toggle. Takes a few seconds.",
    input_schema: {
      type: "object" as const,
      properties: {
        refdes: {
          type: "string",
          description:
            "Reference designator of the component whose datasheet is needed, e.g. 'U1'. The MPN is looked up from the parsed design.",
        },
        mpn: {
          type: "string",
          description:
            "Manufacturer part number, e.g. 'AP64501SP-13'. Use when the user asked about a part number directly rather than a refdes.",
        },
      },
    },
  },
];

export const FETCH_TOOL_NAMES = new Set(fetchTools.map((t) => t.name));

export async function executeFetchTool(
  projectId: string,
  name: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (name !== "fetch_datasheet") {
    return { error: `Unknown fetch tool: ${name}` };
  }

  try {
    const settings = await getSettings();
    if (!settings.datasheetFetchEnabled) {
      return {
        status: "disabled",
        message:
          "Datasheet web fetch is turned off in Settings. Documents can only come from files the user uploads. Suggest enabling 'Datasheet web fetch' in Settings or uploading the datasheet manually.",
      };
    }

    // ── Resolve the MPN ──────────────────────────────────────────────────
    let mpn = typeof input.mpn === "string" ? input.mpn.trim() : "";
    let designUrl: string | null = null;

    const refdes = typeof input.refdes === "string" ? input.refdes.trim() : "";
    if (refdes) {
      const component = await prisma.component.findFirst({
        where: { projectId, refDes: refdes.toUpperCase() },
        select: { mpn: true, datasheetUrl: true },
      });
      if (!component) {
        return {
          error: `Component "${refdes}" not found in the parsed netlist.`,
        };
      }
      if (!mpn) mpn = component.mpn ?? "";
      designUrl = component.datasheetUrl;
      if (!mpn) {
        return {
          status: "no_mpn",
          message: `${refdes.toUpperCase()} has no MPN in the parsed design, so its datasheet cannot be searched for. Suggest the user upload the datasheet manually.`,
        };
      }
    }
    if (!mpn) {
      return { error: "Provide a refdes or an mpn." };
    }

    // ── Already on file? ─────────────────────────────────────────────────
    const existing = await prisma.projectFile.findFirst({
      where: { projectId, mpn, verifyStatus: { in: ["verified", "quarantined"] } },
      orderBy: { uploadedAt: "desc" },
      select: { originalName: true, verifyStatus: true, parseError: true },
    });
    if (existing?.verifyStatus === "verified") {
      return {
        status: "already_available",
        fileName: existing.originalName,
        message:
          "A verified datasheet for this part is already indexed — search_documents can find it. If a search missed, retry with different wording.",
      };
    }
    if (existing?.verifyStatus === "quarantined") {
      return {
        status: "quarantined",
        fileName: existing.originalName,
        reason: existing.parseError,
        message:
          "The datasheet is already on file but QUARANTINED: it failed automatic verification and needs the user's one-click approval in the Files tab before it becomes searchable. Tell the user — this is different from 'not on file'.",
      };
    }

    // ── Find a URL: the engineer's design link outranks web search ───────
    let url = designUrl;
    let provenance: "design_link" | "web_fetch" = "design_link";
    if (!url) {
      // enrichMpn is cache-first: a completed MPN costs one DB read; a cold
      // one runs the spec web search (needs aiEnabled) and caches the URL.
      await enrichMpn(mpn);
      const cache = await prisma.mpnCache.findUnique({ where: { mpn } });
      url = cache?.datasheetUrl ?? null;
      provenance = "web_fetch";
      if (!url) {
        return {
          status: "not_found",
          message: `No datasheet could be found online for MPN "${mpn}". Suggest the user upload it manually.`,
        };
      }
    }

    // ── Ingest through the shared verified pipeline ──────────────────────
    const result = await ingestRemotePdf({ projectId, mpn, url, provenance });

    switch (result.status) {
      case "verified":
        return {
          status: "ingested",
          mpn,
          provenance,
          detail: result.reason,
          message:
            "Datasheet fetched, verified, and indexed. Re-run search_documents now — and cite it as a datasheet found online for this part number (not human-vouched).",
        };
      case "quarantined":
        return {
          status: "quarantined",
          mpn,
          reason: result.reason,
          message:
            "Datasheet fetched but it FAILED automatic verification, so it was quarantined instead of indexed. Tell the user it is waiting in the Files tab for one-click approval — this is different from 'not on file'.",
        };
      case "skipped":
        return {
          status: "already_available",
          mpn,
          detail: result.reason,
          message:
            "An equal-or-better document for this part is already on file — search_documents can find it.",
        };
      default:
        return {
          status: "failed",
          mpn,
          reason: result.reason,
          message:
            "The fetch failed (see reason). Report this to the user and suggest uploading the datasheet manually.",
        };
    }
  } catch (err) {
    return {
      error:
        "fetch_datasheet failed: " +
        (err instanceof Error ? err.message : "unknown error"),
    };
  }
}
