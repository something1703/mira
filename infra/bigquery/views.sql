-- The only things the brand console may read. Each applies the minimum cohort BEFORE anything is
-- returned: a group below `k` has no row at all, so no query can recover it. `k` is
-- MIRA_K_ANON_MIN (default 20, packages/schemas/src/env.ts); change it here and there together.
-- The same rule is applied in TypeScript for mock mode (apps/workflows/src/brand/aggregate.ts).

DECLARE k INT64 DEFAULT 20;

-- Shoppers per cell of hue angle (30° bins) and lightness (12.5 bins).
CREATE OR REPLACE VIEW `mira_brand.shade_demand_cells` AS
SELECT
  CAST(FLOOR(h_ab / 30) AS INT64) AS hue_bin,
  CAST(FLOOR(skin_L / 12.5) AS INT64) AS l_bin,
  COUNT(*) AS shoppers
FROM `mira_brand.shade_demand`
GROUP BY hue_bin, l_bin
HAVING COUNT(*) >= k;

-- Completed proofs per product and concern, overall and by measured skin-tone band.
CREATE OR REPLACE VIEW `mira_brand.efficacy_cells` AS
SELECT
  product_id,
  concern,
  IFNULL(fitzpatrick_band, 'all') AS band,
  COUNT(*) AS completed,
  COUNTIF(words IN ('small', 'clear')) / COUNT(*) AS detected_share
FROM `mira_brand.efficacy_outcomes`
GROUP BY product_id, concern, ROLLUP(fitzpatrick_band)
HAVING COUNT(*) >= k;

-- Looks that pair apparel with beauty, per pairing.
CREATE OR REPLACE VIEW `mira_brand.attach_cells` AS
SELECT
  ARRAY_TO_STRING(ARRAY(SELECT DISTINCT c FROM UNNEST(categories) AS c ORDER BY c), ' + ') AS pairing,
  COUNT(*) AS looks,
  COUNTIF(saved) / COUNT(*) AS saved_share
FROM `mira_brand.look_events`
WHERE 'apparel' IN UNNEST(categories) AND 'beauty' IN UNNEST(categories)
GROUP BY pairing
HAVING COUNT(*) >= k;
