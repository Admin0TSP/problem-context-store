/**
 * Embeddings provider — pluggable.
 *
 *   Default: Ollama (free, local). Falls back to OpenAI if configured.
 *   No-op if neither is reachable / configured — resolver runs rules-only.
 *
 * Provider selection:
 *   - EMBEDDINGS_PROVIDER explicitly "ollama" or "openai"
 *   - Otherwise auto-detect: Ollama if OLLAMA_BASE_URL set, else OpenAI if
 *     OPENAI_API_KEY set, else nothing.
 *
 * Both providers return 768-dim vectors. OpenAI text-embedding-3-small is
 * asked for `dimensions: 768` (the model supports server-side truncation).
 * Ollama nomic-embed-text returns 768 natively.
 */

import { EMBEDDING_DIMENSION } from '@pcs/core';

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text';

type ProviderName = 'ollama' | 'openai' | 'none';

function selectedProvider(): ProviderName {
  const explicit = (process.env.EMBEDDINGS_PROVIDER || '').toLowerCase();
  if (explicit === 'ollama') return 'ollama';
  if (explicit === 'openai') return 'openai';
  if (process.env.OLLAMA_BASE_URL) return 'ollama';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'none';
}

export function embeddingsAvailable(): boolean {
  return selectedProvider() !== 'none';
}

export function embeddingsProviderName(): ProviderName {
  return selectedProvider();
}

/**
 * Format a JS number[] as a pgvector literal: '[0.1,0.2,...]'.
 */
export function pgvectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

async function ollamaEmbed(texts: string[]): Promise<(number[] | null)[]> {
  if (!texts.length) return [];
  // Ollama's /api/embed accepts either a string or an array. Use array for batching.
  const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_EMBED_MODEL, input: texts.map((t) => t.slice(0, 8000)) }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama embed failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { embeddings?: number[][] };
  if (!json.embeddings) return texts.map(() => null);

  // Sanity check dimension. If a misconfigured model returns a different dim,
  // surface a helpful error rather than corrupting the DB.
  const first = json.embeddings[0];
  if (first && first.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Ollama model "${OLLAMA_EMBED_MODEL}" returned ${first.length}-dim vectors, ` +
        `but EMBEDDING_DIMENSION is ${EMBEDDING_DIMENSION}. Pick a model with the right dim, ` +
        `or update EMBEDDING_DIMENSION + the vector(N) schema annotation.`,
    );
  }
  return json.embeddings;
}

// ---------------------------------------------------------------------------
// OpenAI (loaded lazily so the import is optional)
// ---------------------------------------------------------------------------

let openaiClient: any = null;
async function openaiEmbed(texts: string[]): Promise<(number[] | null)[]> {
  if (!texts.length) return [];
  if (!openaiClient) {
    // webpackIgnore lets the OpenAI SDK be a fully optional dep — only loaded
    // at runtime if the OpenAI provider is selected.
    const mod = await import(/* webpackIgnore: true */ 'openai');
    const OpenAI = (mod as any).default ?? mod;
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  const inputs = texts.map((t) => t.slice(0, 8000));
  const nonEmpty: string[] = [];
  const positions: number[] = [];
  inputs.forEach((t, i) => {
    if (t.trim()) {
      positions.push(i);
      nonEmpty.push(t);
    }
  });
  if (!nonEmpty.length) return texts.map(() => null);

  const res = await openaiClient.embeddings.create({
    model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    input: nonEmpty,
    dimensions: EMBEDDING_DIMENSION,
  });
  const out: (number[] | null)[] = texts.map(() => null);
  res.data.forEach((d: { embedding: number[] }, i: number) => {
    out[positions[i]!] = d.embedding;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function embedText(text: string): Promise<number[] | null> {
  const [vec] = await embedBatch([text]);
  return vec ?? null;
}

export async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const provider = selectedProvider();
  if (provider === 'none') return texts.map(() => null);
  // Errors bubble up — the caller decides whether to swallow or surface.
  // (The ingest pipeline catches and logs; the backfill action surfaces.)
  if (provider === 'ollama') return ollamaEmbed(texts);
  if (provider === 'openai') return openaiEmbed(texts);
  return texts.map(() => null);
}
