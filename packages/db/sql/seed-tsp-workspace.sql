-- Seed test data for the TSP workspace (TheSEOPilot test).
--
-- Run this in Supabase → SQL Editor.
-- Idempotent: re-running won't duplicate (uses ON CONFLICT DO NOTHING).
--
-- After running this, go to /settings in the app and click
-- "Backfill embeddings" — that vectorises the 3 new problems so the
-- resolver can match incoming Slack messages against them.
--
-- IF YOUR WORKSPACE SLUG IS NOT 'tsp', EDIT IT BELOW:

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Clients
-- -----------------------------------------------------------------------------
WITH ws AS (
  SELECT id FROM workspace WHERE slug = 'tsp' LIMIT 1
)
INSERT INTO client (
  id, "workspaceId", name, slug, domain, status, metadata, "externalIds",
  "createdAt", "updatedAt"
)
SELECT
  v.id, ws.id, v.name, v.slug, v.domain,
  'ACTIVE'::"ClientStatus",
  '{}'::jsonb, '{}'::jsonb,
  NOW(), NOW()
FROM ws, (VALUES
  ('seed-tsp-client-theseopilot', 'TheSEOPilot', 'theseopilot', 'theseopilot.pro'),
  ('seed-tsp-client-acme',        'Acme Corp',   'acme',        'acme.com')
) AS v(id, name, slug, domain)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. Problems (all for TheSEOPilot client)
-- -----------------------------------------------------------------------------
WITH ws AS (
  SELECT id FROM workspace WHERE slug = 'tsp' LIMIT 1
)
INSERT INTO problem (
  id, "workspaceId", "clientId", title, description,
  status, severity,
  "firstSeenAt", tags, "createdAt", "updatedAt"
)
SELECT
  v.id, ws.id, 'seed-tsp-client-theseopilot',
  v.title, v.description,
  'OPEN'::"ProblemStatus",
  v.severity::"Severity",
  NOW(), '[]'::jsonb, NOW(), NOW()
FROM ws, (VALUES
  (
    'seed-tsp-problem-site-speed',
    'Site speed issues on theseopilot.pro homepage',
    'Homepage takes 8+ seconds to load on mobile. LCP is 6.2 seconds. Affecting bounce rate badly. Suspect oversized hero image and unoptimized JS bundle. Tried compressing images last week but no measurable improvement.',
    'HIGH'
  ),
  (
    'seed-tsp-problem-gsc',
    'Google Search Console verification keeps failing',
    'DNS TXT record is set correctly via Cloudflare DNS but GSC reports verification failed. Tried both meta-tag method and DNS verification. Propagation looks correct in dig +short TXT lookups. Possibly a Cloudflare proxy interaction issue.',
    'MEDIUM'
  ),
  (
    'seed-tsp-problem-schema',
    'Schema markup not appearing in rich results',
    'Article schema is valid in Google''s Rich Results Test but no rich snippets appear in actual SERPs. Pages have been indexed for 3 weeks. Schema includes headline, datePublished, author, image. May be a quality signal issue rather than a markup problem.',
    'MEDIUM'
  )
) AS v(id, title, description, severity)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- -----------------------------------------------------------------------------
-- Sanity check — should return 2 clients + 3 problems
-- -----------------------------------------------------------------------------
SELECT 'clients' AS kind, COUNT(*) FROM client c
  JOIN workspace w ON w.id = c."workspaceId" WHERE w.slug = 'tsp'
UNION ALL
SELECT 'problems' AS kind, COUNT(*) FROM problem p
  JOIN workspace w ON w.id = p."workspaceId" WHERE w.slug = 'tsp';
