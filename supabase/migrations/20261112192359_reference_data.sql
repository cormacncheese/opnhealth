-- Reference data the pipeline needs in every environment.

insert into public.sources (slug, kind, name, url, license, trust_tier) values
  ('openfoodfacts', 'public_dataset', 'Open Food Facts', 'https://world.openfoodfacts.org', 'ODbL-1.0', 3),
  ('usda-fdc', 'public_dataset', 'USDA FoodData Central', 'https://fdc.nal.usda.gov', 'CC0-1.0', 2),
  ('openfda', 'regulator', 'openFDA food enforcement reports', 'https://open.fda.gov/apis/food/enforcement/', 'CC0-1.0', 1),
  ('us-fda', 'regulator', 'U.S. Food and Drug Administration', 'https://www.fda.gov', null, 1),
  ('eu-commission', 'regulator', 'European Commission', 'https://eur-lex.europa.eu', null, 1),
  ('ca-oehha', 'regulator', 'California OEHHA (Proposition 65)', 'https://oehha.ca.gov/proposition-65', null, 1),
  ('lab-submission', 'lab', 'Documents submitted by testing laboratories', null, null, 2),
  ('brand-submission', 'brand', 'Documents submitted by verified brand accounts', null, null, 3),
  ('brand-website', 'crawler', 'Documents found on brand websites', null, null, 3),
  ('consumer-submission', 'consumer', 'Documents submitted by consumers', null, null, 4);

insert into public.pipeline_controls (pipeline, daily_budget_usd) values
  ('coa', 50.00),
  ('discovery', 10.00),
  ('monitor', 5.00);

insert into public.analytes (slug, name, cas_number, category, synonyms) values
  ('lead', 'Lead', '7439-92-1', 'heavy_metal', array['pb', 'lead (pb)', 'total lead']),
  ('cadmium', 'Cadmium', '7440-43-9', 'heavy_metal', array['cd', 'cadmium (cd)', 'total cadmium']),
  ('arsenic', 'Arsenic (total)', '7440-38-2', 'heavy_metal', array['as', 'arsenic', 'arsenic (as)', 'total arsenic']),
  ('inorganic-arsenic', 'Arsenic (inorganic)', null, 'heavy_metal', array['inorganic arsenic', 'ias', 'arsenic, inorganic']),
  ('mercury', 'Mercury (total)', '7439-97-6', 'heavy_metal', array['hg', 'mercury', 'mercury (hg)', 'total mercury']),
  ('methylmercury', 'Methylmercury', '22967-92-6', 'heavy_metal', array['methyl mercury', 'mehg']),
  ('chromium', 'Chromium', '7440-47-3', 'heavy_metal', array['cr', 'chromium (cr)', 'total chromium']),
  ('nickel', 'Nickel', '7440-02-0', 'heavy_metal', array['ni', 'nickel (ni)']),
  ('aluminium', 'Aluminium', '7429-90-5', 'heavy_metal', array['al', 'aluminum', 'aluminum (al)']),
  ('antimony', 'Antimony', '7440-36-0', 'heavy_metal', array['sb', 'antimony (sb)']),
  ('thallium', 'Thallium', '7440-28-0', 'heavy_metal', array['tl', 'thallium (tl)']),
  ('tin', 'Tin', '7440-31-5', 'heavy_metal', array['sn', 'tin (sn)']),
  ('uranium', 'Uranium', '7440-61-1', 'heavy_metal', array['u', 'uranium (u)']),
  ('copper', 'Copper', '7440-50-8', 'mineral', array['cu', 'copper (cu)']),
  ('fluoride', 'Fluoride', '16984-48-8', 'mineral', array['f-', 'fluoride (f)']),
  ('nitrate', 'Nitrate', '14797-55-8', 'other', array['no3', 'nitrate (as n)', 'nitrate-n']),
  ('perchlorate', 'Perchlorate', '14797-73-0', 'other', array['clo4']),
  ('pfoa', 'PFOA', '335-67-1', 'pfas', array['perfluorooctanoic acid']),
  ('pfos', 'PFOS', '1763-23-1', 'pfas', array['perfluorooctanesulfonic acid', 'perfluorooctane sulfonic acid']),
  ('pfhxs', 'PFHxS', '355-46-4', 'pfas', array['perfluorohexanesulfonic acid', 'perfluorohexane sulfonic acid']),
  ('pfna', 'PFNA', '375-95-1', 'pfas', array['perfluorononanoic acid']),
  ('hfpo-da', 'HFPO-DA (GenX)', '13252-13-6', 'pfas', array['genx', 'hfpo-da']),
  ('glyphosate', 'Glyphosate', '1071-83-6', 'pesticide', array[]::text[]),
  ('aflatoxins-total', 'Aflatoxins (total)', null, 'mycotoxin', array['total aflatoxins', 'aflatoxin b1+b2+g1+g2', 'aflatoxins']),
  ('aflatoxin-b1', 'Aflatoxin B1', '1162-65-8', 'mycotoxin', array['afb1']),
  ('aflatoxin-m1', 'Aflatoxin M1', '6795-23-9', 'mycotoxin', array['afm1']),
  ('ochratoxin-a', 'Ochratoxin A', '303-47-9', 'mycotoxin', array['ota']),
  ('bisphenol-a', 'Bisphenol A', '80-05-7', 'plasticiser', array['bpa']),
  ('dehp', 'DEHP', '117-81-7', 'plasticiser', array['di(2-ethylhexyl) phthalate', 'bis(2-ethylhexyl) phthalate']),
  ('acrylamide', 'Acrylamide', '79-06-1', 'process_contaminant', array[]::text[]),
  ('salmonella', 'Salmonella', null, 'microbial', array['salmonella spp.', 'salmonella spp']),
  ('e-coli', 'E. coli', null, 'microbial', array['escherichia coli', 'e.coli']),
  ('total-plate-count', 'Total plate count', null, 'microbial', array['aerobic plate count', 'apc', 'tpc', 'total aerobic count', 'total aerobic microbial count']),
  ('yeast-and-mould', 'Yeast and mould', null, 'microbial', array['yeast & mold', 'yeast and mold', 'yeast/mold', 'total yeast and mold']),
  ('coliforms', 'Coliforms', null, 'microbial', array['total coliforms', 'coliform']);

-- Reference limits. Each row cites the document it was taken from. Limits
-- with basis 'concentration' are compared with COA results when the product
-- falls under category_keywords; 'per_day' limits are shown as context only.
with src as (
  select slug, id from public.sources
), a as (
  select slug, id from public.analytes
)
insert into public.reference_limits (
  analyte_id, authority, jurisdiction, kind, basis, limit_value, unit,
  normalised_value, normalised_unit, applies_to, category_keywords, source_id,
  source_url, effective_on, notes
)
select
  (select id from a where slug = v.analyte),
  v.authority, v.jurisdiction, v.kind, v.basis, v.limit_value, v.unit,
  v.normalised_value, v.normalised_unit, v.applies_to, v.keywords,
  (select id from src where slug = v.source),
  v.source_url, v.effective_on, v.notes
from (
  values
    -- FDA action levels for lead in food intended for babies and young children (final guidance, January 2025)
    ('lead', 'FDA', 'US', 'advisory', 'concentration', 10, 'ppb', 10, 'ug/kg',
      'Baby food: fruits, vegetables (excluding single-ingredient root vegetables), mixtures, yogurts, custards and puddings, single-ingredient meats',
      array['baby food', 'baby-food', 'baby foods', 'infant food', 'toddler food'], 'us-fda',
      'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-action-levels-lead-processed-food-intended-babies-and-young-children',
      date '2025-01-06', 'Action level; not a legal maximum.'),
    ('lead', 'FDA', 'US', 'advisory', 'concentration', 20, 'ppb', 20, 'ug/kg',
      'Baby food: single-ingredient root vegetables and dry infant cereals',
      array['infant cereal', 'infant cereals', 'baby cereal', 'baby cereals'], 'us-fda',
      'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-action-levels-lead-processed-food-intended-babies-and-young-children',
      date '2025-01-06', 'Action level; not a legal maximum.'),
    ('inorganic-arsenic', 'FDA', 'US', 'advisory', 'concentration', 100, 'ppb', 100, 'ug/kg',
      'Infant rice cereal',
      array['infant rice cereal', 'rice cereal', 'baby rice cereal'], 'us-fda',
      'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/guidance-industry-action-level-inorganic-arsenic-rice-cereals-infants',
      date '2020-08-05', 'Action level; not a legal maximum.'),
    -- FDA bottled water quality standards, 21 CFR 165.110(b)
    ('lead', 'FDA', 'US', 'regulatory', 'concentration', 0.005, 'mg/L', 5, 'ug/L',
      'Bottled water', array['bottled water', 'waters', 'spring water', 'mineral water', 'drinking water'], 'us-fda',
      'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-165/subpart-B/section-165.110',
      null, null),
    ('arsenic', 'FDA', 'US', 'regulatory', 'concentration', 0.010, 'mg/L', 10, 'ug/L',
      'Bottled water', array['bottled water', 'waters', 'spring water', 'mineral water', 'drinking water'], 'us-fda',
      'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-165/subpart-B/section-165.110',
      null, null),
    ('cadmium', 'FDA', 'US', 'regulatory', 'concentration', 0.005, 'mg/L', 5, 'ug/L',
      'Bottled water', array['bottled water', 'waters', 'spring water', 'mineral water', 'drinking water'], 'us-fda',
      'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-165/subpart-B/section-165.110',
      null, null),
    ('mercury', 'FDA', 'US', 'regulatory', 'concentration', 0.002, 'mg/L', 2, 'ug/L',
      'Bottled water', array['bottled water', 'waters', 'spring water', 'mineral water', 'drinking water'], 'us-fda',
      'https://www.ecfr.gov/current/title-21/chapter-I/subchapter-B/part-165/subpart-B/section-165.110',
      null, null),
    -- FDA action level for methylmercury in fish (Compliance Policy Guide 540.600)
    ('methylmercury', 'FDA', 'US', 'advisory', 'concentration', 1, 'ppm', 1000, 'ug/kg',
      'Fish, shellfish, crustaceans and other aquatic animals (edible portion)',
      array['fish', 'fishes', 'seafood', 'shellfish', 'canned fish', 'tuna', 'tunas'], 'us-fda',
      'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/cpg-sec-540600-fish-shellfish-crustaceans-and-other-aquatic-animals-fresh-frozen-or-processed-methyl',
      null, 'Action level.'),
    -- FDA action level for total aflatoxins in human food (Compliance Policy Guide 555.400)
    ('aflatoxins-total', 'FDA', 'US', 'advisory', 'concentration', 20, 'ppb', 20, 'ug/kg',
      'Human food in general', array[]::text[], 'us-fda',
      'https://www.fda.gov/regulatory-information/search-fda-guidance-documents/cpg-sec-555400-aflatoxins-human-food',
      null, 'Action level. Shown as context because it has no product category.'),
    -- Commission Regulation (EU) 2023/915, cadmium in chocolate and cocoa products
    ('cadmium', 'European Commission', 'EU', 'regulatory', 'concentration', 0.10, 'mg/kg', 100, 'ug/kg',
      'Milk chocolate with less than 30% total dry cocoa solids',
      array[]::text[], 'eu-commission',
      'https://eur-lex.europa.eu/eli/reg/2023/915/oj', date '2023-05-25',
      'Shown as context: applying it needs the cocoa content of the product.'),
    ('cadmium', 'European Commission', 'EU', 'regulatory', 'concentration', 0.30, 'mg/kg', 300, 'ug/kg',
      'Chocolate with less than 50% total dry cocoa solids; milk chocolate with 30% or more',
      array[]::text[], 'eu-commission',
      'https://eur-lex.europa.eu/eli/reg/2023/915/oj', date '2023-05-25',
      'Shown as context: applying it needs the cocoa content of the product.'),
    ('cadmium', 'European Commission', 'EU', 'regulatory', 'concentration', 0.80, 'mg/kg', 800, 'ug/kg',
      'Chocolate with 50% or more total dry cocoa solids',
      array[]::text[], 'eu-commission',
      'https://eur-lex.europa.eu/eli/reg/2023/915/oj', date '2023-05-25',
      'Shown as context: applying it needs the cocoa content of the product.'),
    ('cadmium', 'European Commission', 'EU', 'regulatory', 'concentration', 0.60, 'mg/kg', 600, 'ug/kg',
      'Cocoa powder sold to the final consumer',
      array['cocoa powder', 'cocoa powders', 'cocoa and chocolate powders'], 'eu-commission',
      'https://eur-lex.europa.eu/eli/reg/2023/915/oj', date '2023-05-25', null),
    -- California Proposition 65 safe harbor levels
    ('lead', 'California OEHHA', 'US-CA', 'advisory', 'per_day', 0.5, 'ug/day', null, null,
      'Any consumer product: maximum allowable dose level for reproductive toxicity',
      array[]::text[], 'ca-oehha',
      'https://oehha.ca.gov/proposition-65/general-info/current-proposition-65-no-significant-risk-levels-nsrls-maximum',
      null, 'Daily exposure, so it depends on serving size and servings per day.'),
    ('cadmium', 'California OEHHA', 'US-CA', 'advisory', 'per_day', 4.1, 'ug/day', null, null,
      'Any consumer product: maximum allowable dose level for reproductive toxicity (oral)',
      array[]::text[], 'ca-oehha',
      'https://oehha.ca.gov/proposition-65/general-info/current-proposition-65-no-significant-risk-levels-nsrls-maximum',
      null, 'Daily exposure, so it depends on serving size and servings per day.')
) as v (
  analyte, authority, jurisdiction, kind, basis, limit_value, unit, normalised_value,
  normalised_unit, applies_to, keywords, source, source_url, effective_on, notes
);
