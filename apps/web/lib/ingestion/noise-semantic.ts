/**
 * Semantic noise classifier — embedding zero-shot.
 *
 *   classifyNoiseSemantic(body) → { isNoise, reason, noiseSim, signalSim }
 *
 * How it works:
 *   We pre-define two anchor sets: "this is noise" and "this is a real
 *   customer/technical problem". For each set we compute the centroid
 *   (mean) of the anchor embeddings. At classification time we embed the
 *   incoming text once and compare cosine similarity to both centroids.
 *   Whichever is closer wins.
 *
 * Why this beats regex:
 *   Regex needs literal pattern matches. "What are the plans for outing
 *   this weekend?" has no noise keywords (no "lunch", no "OOO", no
 *   "happy birthday") yet is clearly social chatter. Embedding similarity
 *   captures that semantic intent regardless of phrasing.
 *
 * Why this beats running a full LLM per event:
 *   - 200ms per event (one embedding call) vs 1-10s for tiny LLMs
 *   - Free, uses model already pulled (nomic-embed-text)
 *   - No new operational dependency
 *   - Centroids cached for the process lifetime (computed once)
 *
 * Tuning:
 *   The anchors here are calibrated against the kinds of messages PCS
 *   actually receives — customer-success Slack channels + support inboxes.
 *   If you're seeing false positives (real signal flagged as noise) or
 *   false negatives (noise slipping through), add more anchors to whichever
 *   side is misclassifying and the centroid shifts.
 *
 * Decision rule:
 *   - If embeddings unavailable → return { isNoise: false } (fail-safe)
 *   - Compute noise_sim and signal_sim
 *   - Mark noise if (noise_sim - signal_sim) > MARGIN
 *     OR if noise_sim is very high in absolute terms
 *   - The margin (0.05) avoids razor-thin calls — borderline events fall
 *     through to the resolver where the LLM judge can decide.
 */

import { embedText, embedBatch, embeddingsAvailable } from '@/lib/intelligence/embeddings';

// ---------------------------------------------------------------------------
// Anchor sets
//
// Each anchor is a short text representative of the category. Aim for 10-20
// per category, diverse phrasings. The more anchors you add, the smoother
// the centroid and the more robust the classifier. But more anchors also
// dilute distinct edges — quality over quantity.
// ---------------------------------------------------------------------------

const NOISE_ANCHORS = [
  // Casual social
  'Anyone want to grab lunch today?',
  'What are the plans for outing this weekend?',
  'Happy birthday Sarah, hope you have an awesome day!',
  'Welcome to the team! Excited to have you onboard.',
  'Congrats on the launch everyone, great work this quarter.',
  'Its TSP\'s 1st anniversary, congrats to everyone in the team.',
  'Looking forward to the offsite next month, who else is going?',
  'Happy Friday team, see you on Monday.',
  // Off-topic personal
  'Anyone seen my keyboard cable? I think I left it in the conference room.',
  'Pizza in the kitchen if anyone wants some.',
  'I\'ll be out on Friday afternoon for a doctor\'s appointment.',
  'Working from home today, ping me on Slack if you need anything.',
  // Operational meta
  'Just a reminder about our standup at 10 tomorrow.',
  'Calendar invite for the all-hands going out shortly.',
  'Sorry I missed the meeting, ran over on the previous call.',
  // Auto-generated
  'This is an automated notification — please do not reply to this email.',
  'You are receiving this email because you subscribed to our newsletter.',
  'Click here to unsubscribe from future communications.',
  // Reactions / acks
  'Got it, thanks!',
  'Sounds good to me, let\'s do it.',
];

const SIGNAL_ANCHORS = [
  // Site / app issues
  'Mobile site speed has tanked again on the homepage. LCP at 7.2 seconds, customers complaining.',
  'Massive 5xx error spike in Search Console — 2,800 pages returning server errors.',
  'SSL certificate expired this morning. Chrome shows Not Secure on the entire site.',
  'Contact form on /contact page has been silently failing for 3 days, no submissions.',
  // Customer reports
  'Customer reports their dashboard numbers are off by about 15% compared to their internal records.',
  'Acme is flagging that COD reconciliation amounts don\'t match what their hub collected.',
  'Mumbai hub is showing the wrong cash totals at end of day. Got reports from operations again this morning.',
  // Data / pipeline
  'The daily ETL job failed overnight, customer-facing reports stale until we backfill.',
  'Database query on the analytics page is timing out, p99 hit 18 seconds.',
  'Webhook from Stripe not arriving — payment confirmations delayed by 2+ hours.',
  // Search / SEO
  'Google Search Console verification keeps failing despite DNS TXT being set correctly.',
  'Article schema validates in Rich Results Test but no rich snippets appear in actual SERPs.',
  'Organic traffic dropped 30% overnight after the last deploy, investigating cause.',
  // Auth / API
  'OAuth callback failing for the Slack integration after token rotation.',
  'API rate limits hitting customers — 429 responses on 12% of requests.',
  // Incidents
  'Production is down — getting 504s from the load balancer. War room in #incidents.',
  'Memory leak in the worker process, OOM-killed twice in the last hour.',
];

// ---------------------------------------------------------------------------
// Classification rule constants
// ---------------------------------------------------------------------------

/** Noise must beat signal by at least this margin to be flagged. */
const NOISE_LEAD_MARGIN = 0.05;

/**
 * Absolute floor — even if noise wins by margin, require it to be at least
 * "somewhat similar" to the noise anchor cluster. Otherwise the event is
 * outside both clusters and we let the resolver handle it.
 */
const NOISE_ABSOLUTE_FLOOR = 0.35;

// ---------------------------------------------------------------------------
// Centroid cache — computed lazily on first call
// ---------------------------------------------------------------------------

interface Centroids {
  noise: number[];
  signal: number[];
}

let _centroids: Centroids | null = null;
let _centroidPromise: Promise<Centroids | null> | null = null;

async function getCentroids(): Promise<Centroids | null> {
  if (_centroids) return _centroids;
  // Coalesce concurrent calls — first caller computes, the rest await it.
  if (_centroidPromise) return _centroidPromise;

  _centroidPromise = (async () => {
    if (!embeddingsAvailable()) return null;

    const allAnchors = [...NOISE_ANCHORS, ...SIGNAL_ANCHORS];
    const t0 = Date.now();
    console.log(
      `[noise/semantic] computing centroids from ${NOISE_ANCHORS.length} noise + ${SIGNAL_ANCHORS.length} signal anchors…`,
    );
    let vecs: (number[] | null)[];
    try {
      vecs = await embedBatch(allAnchors);
    } catch (err) {
      console.error('[noise/semantic] anchor embed failed:', err);
      _centroidPromise = null; // allow retry next call
      return null;
    }

    const noiseVecs = vecs.slice(0, NOISE_ANCHORS.length).filter((v): v is number[] => !!v);
    const signalVecs = vecs.slice(NOISE_ANCHORS.length).filter((v): v is number[] => !!v);
    if (noiseVecs.length < 3 || signalVecs.length < 3) {
      console.error('[noise/semantic] too few anchors embedded successfully — disabling');
      _centroidPromise = null;
      return null;
    }

    _centroids = {
      noise: meanVector(noiseVecs),
      signal: meanVector(signalVecs),
    };
    console.log(
      `[noise/semantic] centroids ready in ${Date.now() - t0}ms ` +
        `(${noiseVecs.length} noise + ${signalVecs.length} signal anchors)`,
    );
    return _centroids;
  })();

  return _centroidPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SemanticNoiseResult {
  isNoise: boolean;
  reason: string;
  noiseSim?: number;
  signalSim?: number;
  /** True when the classifier ran successfully (false → couldn't decide, treat as signal). */
  classified: boolean;
}

export async function classifyNoiseSemantic(body: string): Promise<SemanticNoiseResult> {
  const text = (body ?? '').trim();
  if (!text) {
    return { isNoise: true, reason: 'Empty body', classified: true };
  }
  if (!embeddingsAvailable()) {
    return { isNoise: false, reason: 'Embeddings unavailable — semantic check skipped', classified: false };
  }

  const centroids = await getCentroids();
  if (!centroids) {
    return { isNoise: false, reason: 'Centroids unavailable — semantic check skipped', classified: false };
  }

  let eventVec: number[] | null;
  try {
    eventVec = await embedText(text);
  } catch (err) {
    return {
      isNoise: false,
      reason: `Embedding event failed: ${err instanceof Error ? err.message : String(err)}`,
      classified: false,
    };
  }
  if (!eventVec) {
    return { isNoise: false, reason: 'Empty event embedding', classified: false };
  }

  const noiseSim = cosineSimilarity(eventVec, centroids.noise);
  const signalSim = cosineSimilarity(eventVec, centroids.signal);
  const margin = noiseSim - signalSim;

  const isNoise = noiseSim > NOISE_ABSOLUTE_FLOOR && margin > NOISE_LEAD_MARGIN;
  const reason = isNoise
    ? `Semantic: closer to noise cluster (noise=${noiseSim.toFixed(3)}, signal=${signalSim.toFixed(3)}, Δ=${margin.toFixed(3)})`
    : `Semantic: closer to signal (noise=${noiseSim.toFixed(3)}, signal=${signalSim.toFixed(3)}, Δ=${margin.toFixed(3)})`;

  return { isNoise, reason, noiseSim, signalSim, classified: true };
}

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

function meanVector(vecs: number[][]): number[] {
  if (vecs.length === 0) return [];
  const dim = vecs[0]!.length;
  const sum = new Array<number>(dim).fill(0);
  for (const v of vecs) {
    for (let i = 0; i < dim; i++) sum[i] = (sum[i] ?? 0) + (v[i] ?? 0);
  }
  return sum.map((s) => s / vecs.length);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Test helper — clear cached centroids so anchors can be re-evaluated. */
export function resetSemanticNoiseCache(): void {
  _centroids = null;
  _centroidPromise = null;
}
