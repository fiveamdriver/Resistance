CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts
  USING fts5(content, chunk_id UNINDEXED, project_id UNINDEXED);
