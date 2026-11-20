/*
  TEST SEED - illustrative reference data for automated tests ONLY. Never run against a real database.
  Mirrors ingest/src/fixtureReference.ts. Run after intellidoc_core_schema.sql (which seeds settings, postal formats, anonymous list).
*/
INSERT INTO idoc.paper (name, batch_name) VALUES (N'A4 White', N'A4 WHITE');
INSERT INTO idoc.envelope_size (code, description) VALUES (N'C5', N'C5 (229x162mm)'), (N'C4', N'C4 (324x229mm)');

INSERT INTO idoc.stock_item (stock_code, description, is_envelope, is_insert, envelope_size_id, weight_g, thickness_mm)
SELECT v.code, v.code, 1, 0, z.envelope_size_id, v.weight_g, v.thickness_mm
FROM (VALUES
    (N'WH21518', N'C5', 3.5, 0.2), (N'WH21519', N'C5', 3.5, 0.2), (N'WH06113', N'C5', 3.5, 0.2), (N'WH20066', N'C5', 3.5, 0.2),
    (N'C4-REMUS', N'C4', 8, 0.3), (N'C4-CRABTREE', N'C4', 8, 0.3), (N'C4-PEGASUS', N'C4', 8, 0.3), (N'C4-LAMBY', N'C4', 8, 0.3)
) AS v (code, size_code, weight_g, thickness_mm)
INNER JOIN idoc.envelope_size AS z ON z.code = v.size_code;

INSERT INTO idoc.stock_item (stock_code, description, is_insert, weight_g, thickness_mm) VALUES
    (N'WH22911', N'National Grid insert', 1, 6, 0.15),
    (N'INSERT-HEAVY', N'Test heavy insert', 1, 120, 2),
    (N'INSERT-PARENT', N'Test parent insert', 1, 5, 0.1);
INSERT INTO idoc.stock_item (stock_code, description, is_insert, weight_g, thickness_mm, parent_stock_item_id)
SELECT N'INSERT-CHILD', N'Test linked child', 1, 4, 0.1, stock_item_id FROM idoc.stock_item WHERE stock_code = N'INSERT-PARENT';

INSERT INTO idoc.postal_provider (name) VALUES (N'Test Provider');
INSERT INTO idoc.postal_service (postal_provider_id, postal_format_id, name)
SELECT p.postal_provider_id, f.postal_format_id, s.name
FROM idoc.postal_provider AS p CROSS JOIN idoc.postal_format AS f
CROSS JOIN (VALUES (N'1st Class'), (N'2nd Class')) AS s (name);
INSERT INTO idoc.postal_rate (postal_service_id, min_weight_g, max_weight_g, valid_from)
SELECT ps.postal_service_id, 0, f.max_weight_g, '2020-01-01'
FROM idoc.postal_service AS ps INNER JOIN idoc.postal_format AS f ON f.postal_format_id = ps.postal_format_id;

-- Customers (grouping accounts) and the submitting account FEXCO that belongs to FEXCO_CUSTOMER
INSERT INTO idoc.account (account_code, name, is_address_matching) VALUES (N'FEXCO_CUSTOMER', N'Fexco (customer)', 1), (N'NATIONAL_GRID_PSR', N'National Grid PSR', 1);
INSERT INTO idoc.account (account_code, name, grouping_account_id, is_address_matching)
SELECT N'FEXCO', N'Fexco (submitting)', account_id, 0 FROM idoc.account WHERE account_code = N'FEXCO_CUSTOMER';

INSERT INTO idoc.brand (account_id, name)
SELECT a.account_id, b.name
FROM (VALUES (N'FEXCO_CUSTOMER', N'Remus'), (N'FEXCO_CUSTOMER', N'Crabtree'), (N'NATIONAL_GRID_PSR', N'Pegasus'), (N'NATIONAL_GRID_PSR', N'Lamby')) AS b (acct, name)
INNER JOIN idoc.account AS a ON a.account_code = b.acct;

INSERT INTO idoc.account_envelope (account_id, brand_id, delivery_band, postal_rate_id, outer_stock_item_id, reference)
SELECT br.account_id, br.brand_id, ps.name, r.postal_rate_id, st.stock_item_id, br.name
FROM idoc.brand AS br
INNER JOIN (VALUES
    (N'Remus', N'C5', N'WH21518'), (N'Remus', N'C4', N'C4-REMUS'), (N'Crabtree', N'C5', N'WH21519'), (N'Crabtree', N'C4', N'C4-CRABTREE'),
    (N'Pegasus', N'C5', N'WH06113'), (N'Pegasus', N'C4', N'C4-PEGASUS'), (N'Lamby', N'C5', N'WH20066'), (N'Lamby', N'C4', N'C4-LAMBY')
) AS m (brand, size_code, stock_code) ON m.brand = br.name
INNER JOIN (VALUES (N'Letter', N'C5'), (N'Large Letter', N'C4'), (N'Small Parcel', N'C4'), (N'Medium Parcel', N'C4')) AS fs (format_name, size_code) ON fs.size_code = m.size_code
INNER JOIN idoc.postal_format AS pf ON pf.name = fs.format_name
INNER JOIN idoc.postal_service AS ps ON ps.postal_format_id = pf.postal_format_id
INNER JOIN idoc.postal_rate AS r ON r.postal_service_id = ps.postal_service_id
INNER JOIN idoc.stock_item AS st ON st.stock_code = m.stock_code;
GO
