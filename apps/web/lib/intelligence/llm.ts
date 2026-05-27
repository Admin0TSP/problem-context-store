/**
 * LLM provider — pluggable.
 *
 *   Default: Ollama (free, local). Falls back to Anthropic if configured.
 *   No-op if neither is reachable / configured — resolver skips the LLM
 *   judge stage and routes ambiguous events to Inbox.
 *
 * Provider selection:
 *   - LLM_PROVIDER explicitly "ollama" or "anthropic"
 *   - Otherwise auto-detect: Ollama if OLLAMA_BASE_URL set, else Anthropic
 *     if ANTHROPIC_API_KEY set, else nothing.
 */

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_LLM_MODEL = process.env.OLLAMA_LLM_MODEL || 'llama3.1:8b';

type ProviderName = 'ollama' | 'anthropic' | 'none';

function selectedProvider(): ProviderName {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (explicit === 'ollama') return 'ollama';
  if (explicit === 'anthropic') return 'anthropic';
  if (process.env.OLLAMA_BASE_URL) return 'ollama';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'none';
}

export function llmAvailable(): boolean {
  return selectedProvider() !== 'none';
}

export function llmProviderName(): ProviderName {
  return selectedProvider();
}

// ---------------------------------------------------------------------------
// Ollama
// ---------------------------------------------------------------------------

async function ollamaComplete(opts: {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  model?: string;
}): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model || OLLAMA_LLM_MODEL,
      messages: [
        ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
        { role: 'user', content: opts.prompt },
      ],
      stream: false,
      ...(opts.jsonMode ? { format: 'json' } : {}),
      options: {
        temperature: opts.temperature ?? 0,
        num_predict: opts.maxTokens ?? 1024,
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Ollama chat failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { message?: { content?: string } };
  return json.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// Anthropic (lazy import)
// ---------------------------------------------------------------------------

let anthropicClient: any = null;

async function anthropicComplete(opts: {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
}): Promise<string> {
  if (!anthropicClient) {
    // webpackIgnore lets @anthropic-ai/sdk be a fully optional dep.
    const mod = await import(/* webpackIgnore: true */ '@anthropic-ai/sdk');
    const Anthropic = (mod as any).default ?? mod;
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  const res = await anthropicClient.messages.create({
    model: opts.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0,
    system: opts.system,
    messages: [{ role: 'user', content: opts.prompt }],
  });
  const block = res.content[0];
  if (block?.type === 'text') return block.text as string;
  return '';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function complete(opts: {
  system?: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  /** If true, request JSON output (uses Ollama format:json or strict prompt). */
  jsonMode?: boolean;
  model?: string;
}): Promise<string> {
  const provider = selectedProvider();
  if (provider === 'none') throw new Error('No LLM provider configured');
  if (provider === 'ollama') return ollamaComplete(opts);
  if (provider === 'anthropic') return anthropicComplete(opts);
  return '';
}

/**
 * Try to extract the first JSON object from an LLM response.
 * Resilient to code fences and prose wrapping.
 */
export function parseJsonFromLlm<T = unknown>(text: string): T | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const candidate = fenceMatch ? fenceMatch[1]! : text;

  const start = candidate.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(start, i + 1);
        try {
          return JSON.parse(slice) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
