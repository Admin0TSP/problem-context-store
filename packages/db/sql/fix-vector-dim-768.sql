-- One-shot fix: switch the pgvector columns from 1536 → 768 to match
-- nomic-embed-text. Safe because no embeddings have been successfully
-- written yet (every backfill attempt failed with the dim-mismatch error).
--
-- Run this in Supabase → SQL Editor, or via psql against $DATABASE_URL.

BEGIN;

-- Drop any ANN indexes on the embedding columns first (they're typed to the
-- old dimension and would block the ALTER).
DROP INDEX IF EXISTS problem_embedding_idx;
DROP INDEX IF EXISTS event_embedding_idx;

-- Recreate the columns at the right dimension. Since no rows have a non-null
-- embedding yet, DROP + ADD is the cleanest path (no cast gymnastics).
ALTER TABLE problem DROP COLUMN IF EXISTS embedding;
ALTER TABLE problem ADD  COLUMN embedding vector(768);

ALTER TABLE event   DROP COLUMN IF EXISTS embedding;
ALTER TABLE event   ADD  COLUMN embedding vector(768);

COMMIT;

-- Optional: add IVFFlat indexes for fast cosine search at scale.
-- Skip for now if your tables are tiny; pgvector does a fine seq-scan under ~10k rows.
--
-- CREATE INDEX problem_embedding_idx ON problem USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- CREATE INDEX event_embedding_idx   ON event   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
