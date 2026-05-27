/**
 * Cross-cutting constants. Tuneables for the resolution layer live here so
 * we can revise them without hunting through code.
 */

/** Confidence floor below which auto-resolution falls back to manual review. */
export const RESOLUTION_AUTO_THRESHOLD = 0.85;

/** Cosine similarity threshold for vector-based problem clustering. */
export const PROBLEM_CLUSTER_SIMILARITY_THRESHOLD = 0.78;

/**
 * Embedding dimension — MUST match the schema's vector(N) column.
 *
 * 768 is the sweet spot for our provider lineup:
 *   - Ollama / nomic-embed-text  →  native 768
 *   - OpenAI text-embedding-3-small →  set `dimensions: 768` (native is 1536, but the model supports truncation server-side)
 *
 * If you swap to a model with a different native dim, you must also update
 * the `vector(N)` annotation in packages/db/prisma/schema.prisma on the
 * Problem.embedding and Event.embedding columns, then re-push the schema
 * and re-run the embeddings backfill.
 */
export const EMBEDDING_DIMENSION = 768;

/** Maximum body length stored on Events. Longer bodies are summarized + linked to raw storage. */
export const MAX_EVENT_BODY_CHARS = 32_000;

/** Audit log retention in days (per-workspace setting can override). */
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;
