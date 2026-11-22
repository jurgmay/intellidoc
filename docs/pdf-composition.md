# PDF composition

Makes the print PDF(s) of a batch from the customer's PDF. The rules come from FileMaker's `@Create PDFs` script.

## Run it

```
npm run compose -- <jobId> <outDir> [pdfDir] [logo.png]      (compose:env reads .env)
```

`pdfDir` defaults to `$WATCH_DIR/processed` (the watcher keeps a prefix on the name, so the PDF is found by the end of its name). The job must be **Received**. Every batch of the job that is still **Created** is composed; others are reported as skipped. It is safe to repeat: it keeps the sequence numbers, replaces its own files and records, and deletes files of earlier runs that it no longer makes. Ghostscript is needed only when a colour page has to be printed mono (`GS_PATH` names the executable if it is not `gs`, `gswin64c` on Windows).

## Automatic (the watcher)

The folder watcher can make the print files itself. Once a minute it looks for Received jobs with a batch that has mail to print and no print file yet, and composes them (`src/compose/auto.ts`). It does this only when **both** are true:

* **Make print files automatically** is on in Settings (Print file marks). It is **off** by default: switch it on once the marks have been checked on a printed proof. It is re-read every minute, no restart.
* `COMPOSE_OUT_DIR` is set in the watcher's `.env` (the folder the PDFs are written to). `GS_PATH` names Ghostscript if it is not on the PATH.

It reads the customer's PDF from the watcher's `processed` folder, so a job is composed a minute or so after it is Received, never while the PDF is still in the inbox. A batch that already has print files is left alone, and so is a batch that is no longer Created. A job that fails (PDF not found, Ghostscript missing, ...) is tried again after 1, 2, 5, 10 and then every 30 minutes, an e-mail goes to the alert recipients once after the third failure in a row, and it is never given up on. The compose command still works at any time and composes the batches again.

## What it does

* One PDF per batch, named `<batchCode>_<segment>.pdf`. A file is closed after the mailpiece that takes it past **Most pages in one print file** (Settings, default 10 000; the run sheet and padding count), so a file can run over by one mailpiece. The rest of the batch continues in the next file.
* Segment 1 starts with the batch's run sheet, plus a blank page when the run sheet has an odd number of pages.
* Mailpieces are in **sequence order**. Sequence numbers (`mailpiece.sequence_number`, 1..n per batch) are given the first time a batch is composed: lightest weight band first, then source PDF order; mailpieces with an unknown band go last. They are never renumbered; a mailpiece added later gets the next number. Cancelled mailpieces are left out and get none.
* Packs in a mailpiece: with address matching, by document sequence; otherwise by submitting account, release date, then source order.
* Each pack's pages are copied from the source PDF. A pack with an odd number of pages gets a blank page, so every pack starts on the front of a sheet. Each pack's pages in the file (padding included) are saved on the pack (`batch_file_id`, `output_start_page`, `output_end_page`), and each file in `batch_file`.
* **Colour mode** (per customer; see account-structure.md): No change, all mono, first page of each pack in colour, first page of each mailpiece in colour. A pack whose own option says Mono is mono whatever the mode. Pages that are already mono or blank are not touched; only colour pages that must become mono are converted, once per batch, with Ghostscript (`-sColorConversionStrategy=Gray`).
* **Control marks**, on the first page of the first pack of each mailpiece only, on an optional-content layer named "Control marks", measured from the top left of the page's trim box:
  * the window sequence number `<batchCode>/<6-digit sequence>` in OCR-B, centred in its box;
  * the window Data Matrix: the last 5 digits of the batch code, 6 digits of sequence, `00000` (vector, not a picture);
  * the pack start dot, 2 mm across at 205.5 mm / 269 mm: red, or black when that page is printed mono;
  * a bookmark per mailpiece, titled with the first 11 characters of the Data Matrix.
* PDF metadata: title = file name, PDF/X-4 version, not trapped, keyword `imposition:SRA4` for edge-to-edge paper.

## Settings

The Settings page has a group **Print file marks** (box positions, font size, dot, most pages per file). FileMaker kept these in its Settings table, which was not in the DDR, so **the starting values are placeholders** (except the dot, which FileMaker fixed in the script). Check them against a printed proof and correct them there.

## Not built, and differences from FileMaker

* **MRDF** (Bluecrest MRDF codes on every odd page and the MRDF input/header files) is not built.
* Archive keywords (`moduleArchive`) are not written; `forceA4PageSize` is not implemented.
* FileMaker forced mono for modes 2 and 3 as well as mode 1 (`forceMono = colourMode > 0 …`), which looks like a mistake; here the four modes mean what the customer was told.
* Pricing still uses the colour mode but not a pack's own Mono option; the composed pages and the billed pages can differ for such a pack.
* FileMaker recounted the composed pages and priced then; here pricing happens when the job is Received, from the colour mode (`composedPages`).
* The Ghostscript conversion is tested only with a stand-in converter (it was not installable where this was built); try one real mono batch first.
