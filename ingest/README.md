# intellidoc-ingest

Ingest of H-POD export v6 (XML + PDF) into mailpieces and production batches.

    npm test                         # unit + adversarial GDPR tests
    npm run dry-run -- a.xml a.pdf [--check-postcodes]   # needs qpdf (+ pdftotext for --check-postcodes)

Pipeline: parse (SAX, v6 only) -> validate page ranges vs PDF -> duplicate GUID skip -> normalise address
(recipient in hash; notice line dropped) -> exclusions -> group into mailpieces (assertSingleRecipient)
-> physical (sheets, weight, thickness, format, envelope) -> route -> batch key -> batches. All-or-nothing save.

`src/fixtureReference.ts` holds ILLUSTRATIVE (TEST ONLY) reference data (weights, C4 codes, format limits). The MSSQL
repository (idoc.* schema) is not implemented here.

## SQL Server repository

`src/mssql/reference.ts` (`loadReferenceData`) reads settings, postal formats, stock, accounts/brands/rules and
envelope options from the `idoc.*` tables; `src/mssql/repository.ts` (`MssqlRepository`) saves an ingest result
in one transaction.

    const pool = new sql.ConnectionPool(connectionString); await pool.connect();
    const repo = new MssqlRepository(pool);
    const ref  = await loadReferenceData(pool);
    await ingest(xml, xmlName, pdfPath, { ref, pdf: new CliPdfInspector(), repo });

Behaviour worth knowing:
- Account config (matching flag, batching key, rules, brands, envelopes) is read from the customer (grouping account);
  the submitting account is kept on each pack. Batches and mailpieces belong to the customer.
- Unknown paper and brand values arriving in the XML are created (paper `batch_name` defaults to the upper-cased name).
  Unknown accounts, stock codes, postal formats and postal services are errors and roll the whole job back.
- If a postal service name exists under several providers for the same format the save fails as ambiguous.
- Writes are row by row inside the transaction (fine for hundreds/low thousands of packs); switch to table-valued
  parameters or bulk inserts if exports grow much larger.

### Running the database tests

They run against a REAL scratch database and DROP/recreate the `idoc` schema, then load `db/test_seed.sql`.
The database name must contain `test`, `scratch` or `tmp`; anything else is refused.

    export INTELLIDOC_TEST_DB="Server=host,1433;Database=idoc_test;User Id=...;Password=...;Encrypt=true;TrustServerCertificate=true"
    npm run test:db

Without the variable the database tests are skipped, so `npm test` still runs everywhere.
