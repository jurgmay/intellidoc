# intellidoc-ingest

Ingest of H-POD export v6 (XML + PDF) into mailpieces and production batches.

    npm test                         # unit + adversarial GDPR tests
    npm run dry-run -- a.xml a.pdf [--check-postcodes]   # needs qpdf (+ pdftotext for --check-postcodes)

Pipeline: parse (SAX, v6 only) -> validate page ranges vs PDF -> duplicate GUID skip -> normalise address
(recipient in hash; notice line dropped) -> exclusions -> group into mailpieces (assertSingleRecipient)
-> physical (sheets, weight, thickness, format, envelope) -> route -> batch key -> batches. All-or-nothing save.

`src/fixtureReference.ts` holds ILLUSTRATIVE (TEST ONLY) reference data (weights, C4 codes, format limits). The MSSQL
repository (idoc.* schema) is not implemented here.
