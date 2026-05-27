/**
 * Shows the current resolver provider configuration. Server component so we
 * can read env vars + ping Ollama for health.
 */

import { embeddingsProviderName } from '@/lib/intelligence/embeddings';
import { llmProviderName } from '@/lib/intelligence/llm';

async function pingOllama(): Promise<{ ok: boolean; detail?: string }> {
  const base = process.env.OLLAMA_BASE_URL;
  if (!base) return { ok: false, detail: 'OLLAMA_BASE_URL not set' };
  try {
    const res = await fetch(`${base}/api/version`, {
      // Short timeout — we don't want this to hold up the page render.
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { ok: false, detail: `HTTP ${res.status}` };
    const json = (await res.json()) as { version?: string };
    return { ok: true, detail: `v${json.version ?? '?'}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : 'unreachable' };
  }
}

export async function IntelligenceStatus() {
  const embed = embeddingsProviderName();
  const llm = llmProviderName();
  const ollama = embed === 'ollama' || llm === 'ollama' ? await pingOllama() : null;

  return (
    <div className="mt-3 space-y-2 text-xs">
      <Row
        label="Embeddings"
        value={embed === 'none' ? 'Disabled (rules-only resolver)' : providerLabel(embed)}
        ok={embed !== 'none'}
        detail={embed === 'ollama' ? (ollama?.ok ? `Ollama ${ollama.detail}` : ollama?.detail) : undefined}
      />
      <Row
        label="LLM judge"
        value={llm === 'none' ? 'Disabled (ambiguous events → inbox)' : providerLabel(llm)}
        ok={llm !== 'none'}
        detail={llm === 'ollama' ? (ollama?.ok ? `Ollama ${ollama.detail}` : ollama?.detail) : undefined}
      />
      {(embed === 'ollama' || llm === 'ollama') && ollama && !ollama.ok && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-red-800">
          Can't reach Ollama at {process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'}: {ollama.detail}.
          Start it with <code className="rounded bg-red-100 px-1">ollama serve</code> in another terminal.
        </p>
      )}
      {(embed === 'ollama' || llm === 'ollama') && ollama?.ok && (
        <p className="text-ink-500">
          Ollama reachable. If "Backfill embeddings" fails, the model may not be pulled —
          run <code className="rounded bg-ink-100 px-1">ollama pull nomic-embed-text</code>
          {llm === 'ollama' && (
            <> and <code className="rounded bg-ink-100 px-1">ollama pull llama3.1:8b</code></>
          )}
          .
        </p>
      )}
    </div>
  );
}

function providerLabel(p: 'ollama' | 'openai' | 'anthropic' | 'none'): string {
  return (
    {
      ollama: `Ollama (free, local · ${process.env.OLLAMA_EMBEDDING_MODEL || process.env.OLLAMA_LLM_MODEL || ''})`,
      openai: 'OpenAI',
      anthropic: 'Anthropic',
      none: 'None',
    }[p] ?? p
  );
}

function Row({
  label,
  value,
  ok,
  detail,
}: {
  label: string;
  value: string;
  ok: boolean;
  detail?: string;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-24 text-ink-500">{label}</span>
      <span className={ok ? 'font-medium text-ink-900' : 'text-ink-500'}>{value}</span>
      {detail && <span className="text-ink-500">· {detail}</span>}
      <span
        className={
          ok ? 'ml-auto inline-block h-1.5 w-1.5 rounded-full bg-emerald-500' : 'ml-auto inline-block h-1.5 w-1.5 rounded-full bg-ink-300'
        }
      />
    </div>
  );
}
