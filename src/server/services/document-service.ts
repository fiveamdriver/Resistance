import "server-only";

import { readFile } from "fs/promises";
import path from "path";

import { Prisma } from "@prisma/client";

import { extractDocxText } from "@/lib/parsers/docxParser";
import { chunkDocument } from "@/lib/parsers/documentChunker";
import { extractPdfText } from "@/lib/parsers/pdfParser";
import { prisma } from "@/lib/prisma";

export async function indexDocumentFile(
  projectId: string,
  fileId: string,
  absolutePath: string,
  category: "pdf" | "document",
): Promise<{ chunkCount: number }> {
  const buffer = await readFile(absolutePath);

  let text: string;
  if (category === "pdf") {
    text = await extractPdfText(buffer);
  } else {
    const ext = path.extname(absolutePath).toLowerCase();
    if (ext === ".docx") {
      text = await extractDocxText(buffer);
    } else {
      text = buffer.toString("utf-8");
    }
  }

  const chunks = chunkDocument(text);

  for (const chunk of chunks) {
    const record = await prisma.documentChunk.create({
      data: {
        projectId,
        fileId,
        chunkIndex: chunk.chunkIndex,
        content: chunk.content,
      },
    });

    await prisma.$executeRaw(
      Prisma.sql`INSERT INTO document_chunks_fts(content, chunk_id, project_id) VALUES (${chunk.content}, ${record.id}, ${projectId})`,
    );
  }

  return { chunkCount: chunks.length };
}

export async function searchDocuments(
  projectId: string,
  query: string,
  limit = 5,
): Promise<Array<{ content: string; fileName: string | null; chunkIndex: number; score: number }>> {
  if (!query.trim()) return [];

  type Row = {
    chunk_id: string;
    rank: number;
    content: string;
    chunkIndex: number;
    originalName: string | null;
  };

  let rows: Row[];
  try {
    rows = await prisma.$queryRaw<Row[]>(
      Prisma.sql`
        SELECT f.chunk_id, f.rank, dc.content, dc.chunkIndex, pf.originalName
        FROM document_chunks_fts f
        JOIN DocumentChunk dc ON dc.id = f.chunk_id
        LEFT JOIN ProjectFile pf ON pf.id = dc.fileId
        WHERE f.project_id = ${projectId} AND document_chunks_fts MATCH ${query}
        ORDER BY rank
        LIMIT ${limit}
      `,
    );
  } catch {
    return [];
  }

  return rows.map((r) => ({
    content: r.content,
    fileName: r.originalName ?? null,
    chunkIndex: r.chunkIndex,
    score: r.rank,
  }));
}

export async function deleteDocumentChunks(fileId: string): Promise<void> {
  await prisma.$executeRaw(
    Prisma.sql`
      DELETE FROM document_chunks_fts
      WHERE chunk_id IN (SELECT id FROM DocumentChunk WHERE fileId = ${fileId})
    `,
  );
  await prisma.documentChunk.deleteMany({ where: { fileId } });
}
