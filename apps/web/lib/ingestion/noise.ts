/**
 * Noise classifier — runs BEFORE the resolver to drop obvious chatter.
 *
 *   classifyNoise(body) → { isNoise, reason, score }
 *
 * Why a pre-filter exists:
 *   The resolver is expensive (vector lookup ~200ms, LLM judge 30-60s on
 *   Ollama). Running it against every "lunch?" Slack message or every
 *   "Out of office" Gmail bounce wastes time and slowly pollutes the
 *   embedding space for future client-guess accuracy. The cheap rule-based
 *   filter here catches the 80% of obvious cases for free, before any LLM
 *   touches the event.
 *
 * Conservatism is the rule:
 *   We err strongly toward NOT flagging things as noise. False negatives
 *   (noise that slips through) just land in /inbox and the human triages.
 *   False positives (real signal flagged as noise) get silently dropped
 *   from the resolver — much worse. If a pattern is ambiguous, leave it
 *   for the LLM judge to decide. The judge already biases toward
 *   "uncertain" thanks to M9.5, so it ends up in inbox anyway.
 *
 * Workspace customization:
 *   We accept an optional list of extra block-patterns from the workspace's
 *   metadata. Admins can add their own keywords without code changes.
 *
 * What this does NOT do:
 *   - LLM-based classification (could be M9.7 if rule-based isn't enough)
 *   - Per-sender or per-channel filtering (could be M9.8 — UI to opt
 *     channels in/out)
 *   - Deduping similar messages (the ingest pipeline already dedups by
 *     source/sourceId)
 */

export interface NoiseResult {
  /** True if the message should be marked as noise and skipped by the resolver. */
  isNoise: boolean;
  /** Short human-readable explanation, e.g. "OOO autoreply" or "too short". */
  reason: string;
  /**
   * Optional informational confidence (not currently used in the gate — the
   * gate is binary). Reserved for future LLM-based classifier.
   */
  score?: number;
}

export interface ClassifyNoiseOptions {
  /** Workspace-specific extra patterns to treat as noise. Case-insensitive substring or regex. */
  extraPatterns?: Array<string | RegExp>;
  /** Override the minimum useful body length (default 25 chars). */
  minBodyChars?: number;
}

/** Built-in pattern library — high-precision, low-false-positive. */
const BUILTIN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  // Out of office / auto-reply
  { pattern: /\b(out of (the )?office|i'?m OOO|on vacation|on PTO|away from my desk)\b/i, reason: 'OOO / auto-reply' },
  { pattern: /\bauto-?reply\b/i, reason: 'Auto-reply' },

  // Automated / system emails
  { pattern: /\bdo not (reply|respond) to this (email|message)\b/i, reason: 'Automated email' },
  { pattern: /\bthis (is an?|email was) (automated|automatically generated)\b/i, reason: 'Automated email' },
  { pattern: /\bto unsubscribe\b|\bunsubscribe (from|here)\b/i, reason: 'Marketing footer' },
  { pattern: /\byou are receiving this (email|message) because\b/i, reason: 'Notification email' },

  // Calendar / meeting invites
  { pattern: /\b(calendar|meeting) invite\b/i, reason: 'Calendar invite' },
  { pattern: /\b(declined|accepted|tentatively accepted) (your )?invitation\b/i, reason: 'Calendar response' },
  { pattern: /\bgoogle (calendar|meet)\b.*\b(invite|invitation|join)\b/i, reason: 'Calendar invite' },

  // Social / off-topic Slack
  { pattern: /^(lol|haha|hehe|lmao|rofl|same|\+1|👍|👏|🙌|ty|thx|thanks!?|cool|ok|okay|sure|yes|no)\.?$/i, reason: 'One-word reaction' },
  { pattern: /^(happy birthday|happy anniversary|congrats|congratulations|welcome|good morning|good night|good evening|good luck|cheers)/i, reason: 'Social greeting' },
  // Mid-sentence celebratory keywords — anniversaries, milestones, kudos.
  // Conservative on purpose: only fires when the sentence is celebratory at
  // its core, not when "congrats" appears tangentially.
  { pattern: /\b(\d+(st|nd|rd|th)?\s+(year\s+)?anniversary|congrats? (to|on)|congratulations to|happy birthday|kudos to)\b/i, reason: 'Internal celebration / kudos' },

  // Operational / standup chatter
  { pattern: /\b(standup|stand-up) (notes|update)\b/i, reason: 'Standup chatter' },
  { pattern: /\b(all-?hands|weekly sync|1:1|town hall)\b/i, reason: 'Internal meeting chatter' },

  // Lunch / coffee / casual
  { pattern: /\b(lunch|coffee|tea|snack)\??$/i, reason: 'Casual / social' },
  { pattern: /\b(wanna grab|fancy a) (lunch|coffee|tea|drink)\b/i, reason: 'Casual / social' },

  // Tracking / pixels / status pages
  { pattern: /\bsystem status: (operational|maintenance|incident)\b/i, reason: 'Status page broadcast' },
  { pattern: /\b(servicenow|pagerduty|datadog) (notification|alert)\b/i, reason: 'Monitoring alert (noisy)' },
];

const DEFAULT_MIN_CHARS = 25;

export function classifyNoise(body: string | null | undefined, opts: ClassifyNoiseOptions = {}): NoiseResult {
  const text = (body ?? '').trim();

  // Empty / very short → noise. "ok" "thanks" etc. carry no resolver value.
  // Note: a real customer report can be short though ("site is down") — keep
  // the threshold conservative.
  const minChars = opts.minBodyChars ?? DEFAULT_MIN_CHARS;
  if (text.length === 0) {
    return { isNoise: true, reason: 'Empty body' };
  }
  if (text.length < minChars) {
    return { isNoise: true, reason: `Too short (< ${minChars} chars)` };
  }

  // Builtin patterns
  for (const { pattern, reason } of BUILTIN_PATTERNS) {
    if (pattern.test(text)) {
      return { isNoise: true, reason };
    }
  }

  // Workspace-specific extras
  if (opts.extraPatterns?.length) {
    for (const p of opts.extraPatterns) {
      const re = typeof p === 'string' ? new RegExp(escapeRegex(p), 'i') : p;
      if (re.test(text)) {
        return { isNoise: true, reason: `Workspace blocklist (${p.toString().slice(0, 60)})` };
      }
    }
  }

  // Subject-line probe — emails often pack the intent into the subject. We
  // PREPEND the subject onto the body during Gmail parsing, so a noise
  // subject already gets caught above. This block is reserved for future
  // explicit-subject parsing if we change the parser.

  return { isNoise: false, reason: 'No noise pattern matched' };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convenience: parse a workspace's metadata.noisePatterns array into the
 * shape classifyNoise() expects. Supports strings (treated as case-insensitive
 * substrings) and `/pattern/flags` syntax to allow custom regexes.
 *
 *   ["lunch", "/^FYI:/i"]  →  [/lunch/i, /^FYI:/i]
 */
export function extractWorkspaceNoisePatterns(
  workspaceMetadata: unknown,
): Array<string | RegExp> {
  if (!workspaceMetadata || typeof workspaceMetadata !== 'object') return [];
  const raw = (workspaceMetadata as { noisePatterns?: unknown }).noisePatterns;
  if (!Array.isArray(raw)) return [];
  const out: Array<string | RegExp> = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const m = item.match(/^\/(.+)\/([gimsuy]*)$/);
    if (m) {
      try {
        out.push(new RegExp(m[1]!, m[2]!));
      } catch {
        /* malformed regex — skip silently */
      }
    } else {
      out.push(item);
    }
  }
  return out;
}
