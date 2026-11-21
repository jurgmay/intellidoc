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
every `RETRY_SECONDS`; problems with a file are not.

### XML first, PDF later (default)

The data must not be held up by a missing PDF, so an XML is imported as soon as it has settled, even with no PDF beside it.

1. The XML is imported and the job is saved with status **Awaiting PDF** (page ranges are checked against each other; run sheets can be made).
2. When `<same name>.pdf` turns up, its page count is checked against the pack page ranges. If they agree the job becomes **Received**;
   if not it becomes **PDF Rejected**, the PDF goes to `failed/` and an e-mail is sent. The PDF is filed in `processed/` next to the XML.
3. If the PDF has not arrived after `PDF_WAIT_MINUTES` (30) an e-mail goes to `ALERT_TO`, then a reminder every `PDF_REMINDER_MINUTES` until it arrives.
   When it arrives after an alert, a "PDF received" e-mail says so.

A PDF that arrives before its XML waits in the inbox and is handled together with the XML as before. If the alert e-mail cannot be sent
it is tried again at the next check (once a minute). Without `SMTP_HOST` the alerts are only written to the log (with a warning at start-up).
`XML_FIRST=0` restores the old behaviour (wait for both files). Existing databases need the new `idoc.job` columns: `initDevDb.ts --reset`.

### Settings (environment variables)

| Variable | Meaning |
|---|---|
| `INTELLIDOC_DB` | SQL Server connection string (required) |
| `WATCH_DIR` | base folder; the five sub-folders above are created inside it (required) |
| `POLL_SECONDS` / `STABLE_SECONDS` / `RETRY_SECONDS` | 5 / 10 / 60 |
| `PDF_ENGINE` | `auto` (qpdf if installed, else built-in pdf-lib), `qpdf`, `pdflib` |
| `CHECK_POSTCODES` | `1` warns when a pack's postcode is not on its first PDF page (needs qpdf + pdftotext) |
| `LOG_FILE` | also append the log to this file |
| `XML_FIRST` | `1` (default) imports an XML without waiting for its PDF; `0` waits for the pair |
| `PDF_WAIT_MINUTES` / `PDF_REMINDER_MINUTES` | 30 / same as the wait: when to alert, and how often to repeat |
| `ALERT_TO` | who is e-mailed, comma separated |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | mail server (port 587 + `SMTP_SECURE=0` = STARTTLS; 465 + `1` = TLS). `SMTP_FROM` defaults to `SMTP_USER` |

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
npm run import:ref -- C:\idoc-import             # dry run: summary + import-warnings.txt, nothing written
npm run import:ref:env -- C:\idoc-import --apply # load into INTELLIDOC_DB (one transaction, safe to re-run)
```

Rules baked in (confirmed with the business):
- Envelope rows not referenced by any account's `envelopesJSON` are stale and are not imported.
- `isEnvelope` is derived from stock type (`Outer Envelope`); the flag in the export is wrong for booklets, postcards, certificates.
- Stock codes must be unique. When a code is used twice, the active item keeps it and the other is imported with no code (warning).
  Codes starting `WH` are warehouse-managed (`is_stock_managed`); other codes are provisional.
- Stock-control quantities are never imported. `hpodAccount*` credentials are never read.
- Rows are matched on the FileMaker id (`legacy_id`), so the import can be re-run as the exports are corrected.
- `.mer` / `.csv` exports contain customer data: keep them out of the repo (ignored by `.gitignore`).

### Stock codes
Every stock item must end up with a unique code. After an import, items without one (blank, or the extra item of a duplicated code) are listed and numbered with:
```
npx tsx --env-file=.env src/import/assignCodes.ts            # list what would be assigned
npx tsx --env-file=.env src/import/assignCodes.ts --apply    # assign unique 5-digit codes (from 10001; --start=N to change)
```
Existing codes are never changed, and re-running the import keeps codes already assigned.
Decisions applied by the import: stock with no owner and no WH code is dropped; envelopes whose stock is not in the export are dropped.

### How the envelope is chosen
1. Content weight = sheets x A4 sheet weight (5.625 g for 90gsm) + inserts. The envelope is NOT added yet.
2. Formats are tried smallest first: Letter (1-100 g, max 5 mm, max 16 sheets), Large Letter (101-750 g), Small Parcel (to 2,000 g), Medium Parcel.
   For each, the account's envelopes for the brand / reference / delivery band are tried from the lowest "up to" weight band; the pack weight
   including THAT envelope's own weight (C5 8 g, C4 17 g) must fit the band and the format limits. The first fit wins, so a short letter asked for in a C4
   is posted in a C5, and the postal service is kept.
3. If nothing configured fits, the customer's own selection is used and a warning is recorded.
4. Brand: the `Brand` passthrough (from the letter template) wins, then the bracketed brand in the envelope text. Reference: text after `ref: ` up to the end or ` (`
   (a configured reference that itself contains brackets takes precedence).
5. Machine enclosing: C5, at most 12 sheets, in a batch of MORE than 25 mailpieces. Everything else is hand enclosed. The limits live in `idoc.settings`.

For an existing database the machine limit must be changed by hand:  `UPDATE idoc.settings SET machine_enclosing_max_sheets = 12;`

### Trial run of a real XML/PDF pair (no database)
Runs the full ingest of one pair against the real configuration in the FileMaker exports (same four .mer files as the import) and prints the batches,
the issues, and a comparison with the delivery band the customer system wrote in the XML:
```
npx tsx src/import/trial.ts C:\imports C:\samples\file.xml C:\samples\file.pdf
```

## Run sheets

One A4 run sheet per batch, plus one merged PDF per job (FileMaker: "Create Run Sheets" + "Merge Run Sheets").

- **Batch code**: one global running number, from the SQL sequence `idoc.batch_code_seq`. To continue from FileMaker's current value:
  `ALTER SEQUENCE idoc.batch_code_seq RESTART WITH <next number>;` The file name on the sheet is `<batch code>.pdf`.
- **Real job** (after it has been ingested): `npx tsx --env-file=.env src/runsheet/cli.ts <jobId> <outDir> [logo.png]`
  writes `<batchCode>.pdf` for each batch and `job-<jobId>.pdf` (all sheets merged).
- **Trial, no database**: add `--runsheets <outDir> [logo.png]` to the trial command. Batch codes are temporary (1, 2, 3...).
- Layout: Job details, Production details, Fulfilment details, and a DataMatrix of the batch code. The wording of "Print method" follows FileMaker.
  Helvetica stands in for Poppins until the font files are supplied.
- Not yet: large-print flag, batch comments, the separate insert page, spoil run sheets, e-mail and archive.

An existing database needs the new sequence/column: re-run `initDevDb.ts --reset` and the reference import (a scratch DB has no jobs worth keeping).
