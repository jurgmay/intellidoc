# PDF composition

Makes the print PDF(s) of a batch from the customer's PDF. The rules come from FileMaker's `@Create PDFs` script.

## Run it

```
npm run compose -- <jobId> <outDir> [pdfDir] [logo.png]      (compose:env reads .env; MRDF_OUT_DIR is where MRDF files go)
```

`pdfDir` defaults to `$WATCH_DIR/processed` (the watcher keeps a prefix on the name, so the PDF is found by the end of its name). The job must be **Received**. Every batch of the job that is still **Created** is composed; others are reported as skipped. It is safe to repeat: it keeps the sequence numbers, replaces its own files and records, and deletes files of earlier runs that it no longer makes. Ghostscript is needed only when a colour page has to be printed mono (`GS_PATH` names the executable if it is not `gs`, `gswin64c` on Windows).

## Automatic (the watcher)

The folder watcher can make the print files itself. Once a minute it looks for Received jobs with a batch that has mail to print and no print file yet, and composes them (`src/compose/auto.ts`). It does this only when **both** are true:

* **Make print files automatically** is on in Settings (Print file marks). It is **off** by default: switch it on once the marks have been checked on a printed proof. It is re-read every minute, no restart.
* `COMPOSE_OUT_DIR` is set in the watcher's `.env` (the folder the PDFs are written to). `GS_PATH` names Ghostscript if it is not on the PATH. `MRDF_OUT_DIR` is the inserter's input folder for MRDF files.

It reads the customer's PDF from the watcher's `processed` folder, so a job is composed a minute or so after it is Received, never while the PDF is still in the inbox. A batch that already has print files is left alone, and so is a batch that is no longer Created. A job that fails (PDF not found, Ghostscript missing, ...) is tried again after 1, 2, 5, 10 and then every 30 minutes, an e-mail goes to the alert recipients once after the third failure in a row, and it is never given up on. The compose command still works at any time and composes the batches again.

## From the Jobs screen

**Jobs** in the web app lists the newest jobs (search by customer or file name, filter by status) with how many of their batches have print files. A Received job has **Make print files**; once files exist the button reads **Make again** and asks first, with the choice to leave the batches that already have files (`onlyNew`). **Details** shows each batch and its files. The API does the same work as the command line and the watcher (`POST /api/jobs/:id/compose`, `src/jobs/ingestComposer.ts`), so the results are identical.

* The API server needs `WATCH_DIR` (its `processed` folder holds the PDFs) and `COMPOSE_OUT_DIR` in its `.env`, and optionally `MRDF_OUT_DIR` and `GS_PATH`; see `api/.env.example`. Without them the screen says so and the buttons are disabled.
* One job is composed by one request at a time; a second request for it is refused until the first finishes. The request waits for the files to be made, so a very large job can take a while.
* It works whether or not "Make print files automatically" is on. Only Received jobs can be composed. A job still waiting for its PDF, or whose PDF was rejected, shows why in its status.
* Nothing is written to the change log; the print files and their records are the evidence.

## What it does

* One PDF per batch, named as the run sheet's *File name* row says, as FileMaker did: `<job no> - IntelliDoc - <customer> - <batch code> - Batch <n> of <m>.pdf`. A batch that needs several files has ` - Segment <x> of <y>` before the `.pdf`. (Print files made before this change keep their old `<batchCode>_<segment>.pdf` names until they are made again; the old files are removed then.) A file is closed after the mailpiece that takes it past **Most pages in one print file** (Settings, default 10 000; the run sheet and padding count), so a file can run over by one mailpiece. The rest of the batch continues in the next file.
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
* **MRDF** for customers that use it (account flag `is_use_mrdf`, read from the owner of the account tree): see the section below.
* PDF metadata: title = file name, PDF/X-4 version, not trapped, keyword `imposition:SRA4` for edge-to-edge paper.

## MRDF (Bluecrest inserter)

For a customer with **Use MRDF** on, composing a batch also does two things.

**Page codes** on the front of every sheet (odd page of the mailpiece; the control marks layer, black), in the positions of the **MRDF page codes** settings:

* a Data Matrix of 23 digits: batch code (10), sequence (6), sheet number (2), sheets in the mailpiece (2), `000`;
* an OCR-B code (font size 8.2 by default): sheet number (2), sheets in the mailpiece (2), sequence (6), e.g. `0203000007`.

The sheet number and sheet count are of the composed file, padding included, so they are what the inserter will see. (FileMaker counted from the source pages; the two agree whenever every pack has an even number of pages.)

**The MRDF file** `<batchCode>.txt`, written to `MRDF_OUT_DIR` (watcher `.env`, or the environment of the compose command): ANSI (Windows-1252), CRLF line ends, written under a `.tmp` name and renamed so the inserter never reads half a file. If `MRDF_OUT_DIR` is not set the page codes are still printed and no file is written (the watcher logs a warning at start). A re-compose writes the file again. It has one **header** record (790 characters) and one **input** record per mailpiece (1406 characters), in sequence order. Every field has a fixed width taken from its "Auto enter" calculation in FileMaker (`src/compose/mrdf.ts` lists them in order): text is left-justified, padded with spaces and cut to the width (a 40-character address line is cut at 40); numbers are right-justified and zero padded. The file is checked for length before it is written.

What goes in them: the header has the batch code as job and run id, the date and time (`dd/mm/yyyy hh:mm:ss`), the cycle (`mm_yy`), mailpiece count, sheet count, and FileMaker's constants (inserter mode `SM_CH_01`, carrier `SM`, class `002`, feeder 1 mode 6, the rest 1, document ids `None`, print job name `Hybrid Default`). Each input record has the batch code, sequence number, sheets, the customer's account code, the addressee and up to five address lines (the postcode in its own field), the customer's return address (up to five lines, one per line of the account's return address), and FileMaker's constants for weight, postage and processing category. Every other field is blank or zero.

Things to know:

* **HostSortID** is 20 characters wide in FileMaker's field list but its calculation only ever produced 18 (`Hybrid Mail 01042 `), so 18 is written: the inserter has been reading 1406-character records. If it should be 20, change `HOST_SORT_ID_WIDTH`; the record becomes 1408.
* **Logos**: FileMaker's customer record had two logo codes (`LogoBitmapSelect1/2`). They are not in the account table yet, so those two fields are blank.
* Weight and postage in each record are FileMaker's constants (000.933 and 00.355), not the mailpiece's real values.
* The page-code positions are placeholders until set from a printed proof, like the other marks.

## Run sheets

* **Envelope row**: the envelope's stock code is shown only for `WH…` codes; an insert is always `code : description` (FileMaker's wording).
* **More than one page**: a run sheet that does not fit on a page continues on the next, with "(continued)" on a repeated section heading. A row is kept together when it fits on a page; a row longer than a page (a very long insert list) is split line by line. The footer reads "Batch X - page n of m" only when there is more than one page. The composer counts the run sheet's pages (padded to an even number) when it plans the file.
* **E-mail** (FileMaker's *Email Run Sheets*). Switch on **E-mail run sheets** in Settings (PDF and alerts) and set **Run sheet recipients**. The first time a job's print files are made (by the watcher or the Jobs screen) one e-mail goes out for the job: subject = the job name, body = the customer in capitals, the totals (mailpieces, packs, sheets, pages as colour/mono/blank, as printed after the colour mode), `ALL MAILPIECES TO BE ARCHIVED` for an archiving customer, then each batch (postal service - envelope - department, mailpieces, pages, weight bands, file name). The attachment is the run sheets of all batches in one PDF, named `<job no> - IntelliDoc Run Sheet(s) - <customer> - N batch(es) (<first> - <last>).pdf`.
  * **To** is the first run sheet recipient; **Cc** is the rest plus the customer's notification e-mail addresses (the `emails` setting of the customer, inherited as usual).
  * A customer (or its owning account) marked **Testing** is sent to the alert recipients only, with `[TEST] ` before the subject, and nobody else is copied.
  * It is sent once: `idoc.job.run_sheets_emailed_at` records it. Making the files again does not send another. A problem (no recipients, no mail server, the mail server refusing) is logged (watcher) or shown in a notification (Jobs screen) and never stops the print files being made; nothing is recorded, so the next compose tries again.
  * The Jobs screen **Details** has **Download run sheets** (the same merged PDF) and **E-mail run sheets** / **Resend run sheets**, which send now whether or not the setting is on, and again even if it was sent before.
  * The mail server is `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` in the watcher's `.env` and in the API's `.env`. Without `SMTP_HOST` nothing is sent and the reason is shown.

## Settings

The Settings page has two groups, **Print file marks** and **MRDF page codes**. **Print file marks** (box positions, font size, dot, most pages per file). FileMaker kept these in its Settings table, which was not in the DDR, so **the starting values are placeholders** (except the dot, which FileMaker fixed in the script). Check them against a printed proof and correct them there.

## Not built, and differences from FileMaker

* Run sheet gaps still open: spoil run sheets, scan/archive run sheets, the comments row, the UINSURE stock-items page and the QA tick lines.

* **MRDF**: reading what the inserter sends back (FileMaker's output, select and lock folders and the `MRDF_OutputRecords` / `MRDF_SelectRecords` tables) is not built. Only the files the inserter is given are (see MRDF below).
* `forceA4PageSize` is not implemented on purpose: FileMaker's script has the code commented out, so it never ran.
* Archived batches: FileMaker skipped the archive keywords for a batch already archived (`isArchived`). There is no archiving process here yet, so every batch is treated as not archived.
* The archive provider's tag is typed on the customer page. FileMaker kept it in an ArchivingProviders table that is not in the exports, so the import leaves it blank and warns for each archiving customer.
* FileMaker forced mono for modes 2 and 3 as well as mode 1 (`forceMono = colourMode > 0 …`), which looks like a mistake; here the four modes mean what the customer was told.
* Pricing follows the composer on a pack's own Mono option (all of its pages are billed as mono). One approximation remains: for "first page of each mailpiece", pricing takes the first pack in document-sequence order, the composer in envelope order, so they differ only when those orders differ and only one of the two packs has colour pages.
* FileMaker recounted the composed pages and priced then; here pricing happens when the job is Received, from the colour mode (`composedPages`).
* **Ghostscript** (`test/ghostscript.test.ts`, runs only where `gs` is installed; set `GS_PATH` if it is not on the PATH) has been tested for real, with Ghostscript 10.02: RGB text, CMYK fills, a colour picture and a Ghostscript-made CMYK shading all come out as grey (zero cyan, magenta and yellow by Ghostscript's `inkcov` device), with the page count, page sizes and TrimBox kept, text still readable, and a whole print file composed with it keeps its keywords, title and "Control marks" layer. A 2,000-page colour batch converted in about 6 seconds. Still to do: one real customer file on the real press RIP.
* **Pages that are already pure black are not converted** (only colour pages go through Ghostscript, to save time). A customer page whose black is *RGB* 0 0 0 stays RGB, and Ghostscript reads that as a mix of cyan, magenta and yellow. It is billed and counted as mono. Whether the press RIP prints RGB black with black toner only is not known; check it on the first proof. If it does not, the fix is to send RGB-black pages through Ghostscript as well (slower).
* The marks the composer draws (data matrix, OCR line, sequence number, black pack dot) are DeviceGray black, so they are black toner only whatever the RIP does with RGB. The red pack dot on colour pages is RGB red.

## Keywords and logos

The PDF keywords are one comma-separated string (no spaces), built by `compose/keywords.ts`:

* A customer with "Archive mailpieces" on gets `archiving_customer:<tag>,archiving_provider:<tag>,archiving_directory:<tag>` (only the tags that are set). The tags are on the customer page and belong to the account that holds the settings, as the MRDF switch does.
* Edge-to-edge paper adds `imposition:SRA4`. FileMaker overwrote the archive keywords with this one; both are written here.

The customer's Logo 1 and Logo 2 (up to 8 characters, imported from `logo1` / `logo2`) fill `LogoBitmapSelect1` / `LogoBitmapSelect2` in the MRDF.
