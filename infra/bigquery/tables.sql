-- Dataset `mira_brand` (docs/DATA_MODEL.md §3). Written, not applied: nothing has been deployed.
-- No user id, no image, and a week instead of a day, in every table.

CREATE TABLE IF NOT EXISTS `mira_brand.shade_demand` (
  skin_L           FLOAT64 NOT NULL,
  skin_a           FLOAT64 NOT NULL,
  skin_b           FLOAT64 NOT NULL,
  h_ab             FLOAT64 NOT NULL,
  fitzpatrick_band STRING,
  region           STRING,
  week             STRING NOT NULL
);

CREATE TABLE IF NOT EXISTS `mira_brand.efficacy_outcomes` (
  product_id       STRING NOT NULL,
  concern          STRING NOT NULL,
  delta            FLOAT64 NOT NULL,
  mdc              FLOAT64,
  words            STRING NOT NULL,
  fitzpatrick_band STRING,
  skin_type        STRING,
  week             STRING NOT NULL
);

CREATE TABLE IF NOT EXISTS `mira_brand.look_events` (
  categories ARRAY<STRING>,
  brand_ids  ARRAY<STRING>,
  saved      BOOL NOT NULL,
  week       STRING NOT NULL
);
