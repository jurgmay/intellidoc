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

## Folder watcher (service)

Watches a folder for `<name>.xml` + `<name>.pdf` pairs and runs the ingest into SQL Server.

    <WATCH_DIR>/inbox        drop pairs here (same file name, .xml and .pdf)
    <WATCH_DIR>/processing   claimed while being ingested (put back to inbox on restart)
    <WATCH_DIR>/processed    ingested; <name>.result.json describes mailpieces and batches
    <WATCH_DIR>/duplicates   every pack was already stored (nothing saved)
    <WATCH_DIR>/failed       rejected; <name>.error.txt says why. Nothing was saved. Fix and drop the pair in the inbox again.

Nothing is ever deleted. A pair is picked up only when both files have stopped changing for `STABLE_SECONDS`
(copy finished) and can be renamed (not held open by another program). Database outages are retried
every `RETRY_SECONDS`; problems with a file are not. A lone XML or PDF just waits (and is logged after 5 minutes).

### Settings (environment variables)

| Variable | Meaning |
|---|---|
| `INTELLIDOC_DB` | SQL Server connection string (required) |
| `WATCH_DIR` | base folder; the five sub-folders above are created inside it (required) |
| `POLL_SECONDS` / `STABLE_SECONDS` / `RETRY_SECONDS` | 5 / 10 / 60 |
| `PDF_ENGINE` | `auto` (qpdf if installed, else built-in pdf-lib), `qpdf`, `pdflib` |
| `CHECK_POSTCODES` | `1` warns when a pack's postcode is not on its first PDF page (needs qpdf + pdftotext) |
| `LOG_FILE` | also append the log to this file |

Flags: `--dry-run` (read and validate against the database, save nothing, leave files in the inbox) and
`--once` (handle what is in the inbox, then exit).

### Trying it on a scratch database (Windows PowerShell, in the `ingest` folder)

    $env:INTELLIDOC_DB = "Server=HOST,1433;Database=idoc_dev;User Id=USER;Password=PASSWORD;Encrypt=true;TrustServerCertificate=true"
    $env:WATCH_DIR = "C:\IntelliDoc\watch"
    npm run db:init            # idoc schema + TEST reference data; the DB name must contain test, scratch, tmp or dev
    npm run watch -- --dry-run # first look: validates and logs what it WOULD do
    npm run watch              # real run; copy an xml+pdf pair into C:\IntelliDoc\watch\inbox

Alternatively copy `.env.example` to `.env`, edit it, and use `npm run db:init:env` / `npm run watch:env` (Node 20.6+).
Stop with Ctrl+C: the current file is finished first.

`db:init` loads **test** reference data (placeholder stock weights, accounts `FEXCO`, `NATIONAL_GRID_PSR`). Real
accounts, stock, postal rates and envelopes must be loaded before real use; a file from an unknown account lands in `failed/`.

## Reference-data import (FileMaker exports)

Loads accounts, brands, address-match / pack-sequence rules, notification emails, the postal catalogue, stock and
customer envelope mappings from four FileMaker **Merge (.mer)** exports (UTF-8, field names in the header row):
`customers.mer`, `brands.mer`, `stock_items.mer`, `envelopes.mer` in one folder.

```
npm run import:ref -- C:\path\to\folder             # dry run: summary + import-warnings.txt, nothing written
npm run import:ref:env -- C:\path\to\folder --apply # load into INTELLIDOC_DB (one transaction, safe to re-run)
```

Rules baked in (confirmed with the business):
- Envelope rows not referenced by any account's `envelopesJSON` are stale and are not imported.
- `isEnvelope` is derived from stock type (`Outer Envelope`); the flag in the export is wrong for booklets, postcards, certificates.
- Stock codes must be unique. When a code is used twice, the active item keeps it and the other is imported with no code (warning).
  Codes starting `WH` are warehouse-managed (`is_stock_managed`); other codes are provisional.
- Stock-control quantities are never imported. `hpodAccount*` credentials are never read.
- Rows are matched on the FileMaker id (`legacy_id`), so the import can be re-run as the exports are corrected.
- `.mer` / `.csv` exports contain customer data: keep them out of the repo (ignored by `.gitignore`).
