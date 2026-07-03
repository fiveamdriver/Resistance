/**
 * POST /api/projects/[id]/files/[fileId]/approve
 *
 * One-click human approval of a quarantined document: promotes it to
 * verified and indexes it for search. The human vouching for the document is
 * the highest trust tier, so lower-tier docs for the same MPN are superseded.
 */
import { NextResponse } from "next/server";

import { AppError, toUserError } from "@/lib/errors";
import { approveQuarantinedFile } from "@/server/services/ingest-service";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileId: string }> }
) {
  const { id: projectId, fileId } = await params;

  try {
    const file = await prisma.projectFile.findUnique({
      where: { id: fileId },
      select: { projectId: true },
    });
    if (!file || file.projectId !== projectId) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const result = await approveQuarantinedFile(fileId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const { message, details } = toUserError(error);
    const status = error instanceof AppError ? 400 : 500;
    return NextResponse.json({ error: message, details }, { status });
  }
}
