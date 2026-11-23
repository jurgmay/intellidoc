# PDF composition

Makes the print PDF(s) of a batch from the customer's PDF. The rules come from FileMaker's `@Create PDFs` script.

## Run it

```
npm run compose -- <jobId> <outDir> [pdfDir] [logo.png]      (compose:env reads .env; MRDF_OUT_DIR is where MRDF files go)
```

`pdfDir` defaults to `$WATCH_DIR/processed` (the watcher keeps a prefix on the name, so the PDF is found by the end of its name). The job must be **Received**. Every batch of the job that is still **Created** is composed; others are reported as skipped. It is safe to repeat: it keeps the sequence numbers, replaces its own files and records, and deletes files of earlier runs that it no longer makes. Ghostscript is needed only when a colour page has to be printed mono (`GS_PATH` names the executable if it is not `gs`, `gswin64c` on Windows).

## Automatic (the watcher)

**Order of work.** The watcher handles one XML+PDF pair at a time and always takes the pair with the **smallest XML file** first (ties by name). A small XML usually means a small PDF, so the quickest jobs reach production first and one huge PDF does not hold the rest up. A lone PDF (attaching to a job already imported) is handled after the XML files. A file that arrives while a big one is being processed waits for it to finish; nothing is interrupted.

The folder watcher can make the print files itself. Once a minute it looks for Received jobs with a batch that has mail to print and no print file yet, and composes them (`src/compose/auto.ts`). It does this only when **both** are true:

* **Make print files automatically** is on in Settings (Print production settings). It is **off** by default: switch it on once the marks have been checked on a printed proof. It is re-read every minute, no restart.
* `COMPOSE_OUT_DIR` is set in the watcher's `.env` (the folder the PDFs are written to). `GS_PATH` names Ghostscript if it is not on the PATH. `MRDF_OUT_DIR` is the inserter's input folder for MRDF files.

It reads the customer's PDF from the watcher's `processed` folder, so a job is composed a minute or so after it is Received, never while the PDF is still in the inbox. A batch that already has print files is left alone, and so is a batch that is no longer Created. A job that fails (PDF not found, Ghostscript missing, ...) is tried again after 1, 2, 5, 10 and then every 30 minutes, an e-mail goes to the alert recipients once after the third failure in a row, and it is never given up on. The compose command still works at any time and composes the batches again.

## Activity screen

**Activity** in the web app is a live list (it refreshes every 3 seconds), in the order the work happens:

1. **Making print files** and **Processing**: what the watcher or the API is doing now. Print files show a bar counting **mailpieces** (so a batch of thousands takes as much of the bar as it should, and the bar keeps moving while a big batch is built) and the step ("1 of 5 batches. Batch 81899 (2 of 5): file 3 of 13 built"); an import or PDF check shows how long it has been running.
2. **Waiting**: the XML files in the watcher's `inbox`, in the order the watcher takes them (smallest XML first), each with **PDF: Arrived / Not yet**. A PDF with no XML shows as waiting for its XML.
3. **Awaiting PDF**: jobs whose XML is imported but whose PDF has not arrived (XML-first).
4. **Failed**: imports and PDF checks that failed in the last 6 hours, and jobs whose PDF was rejected, with the reason.
5. **Completed**: the newest jobs, newest first, with whether their print files are made.

**Account and file name.** The **Account** column is the customer's account name (blank for a file whose XML has not been imported yet). The file name is in the **Progress** column, on its own line under the status, which reads like "Print files made for:" followed by the file name; job numbers are not shown.

**Times.** Each line has **Start time**, **End time** and **Duration**. Running work has a start and a running duration (with "about N left" when it can be estimated); waiting files show how long they have been waiting; finished work shows both times and how long it took. A finished job's times are those of its import and PDF check (matched by file name); making its print files extends that same line (there is one Completed row per file): it ends when the print files were last made, so the Duration is from the start of the import to the end of the print files.

**Making print files, step by step.** Within a batch the bar moves as the PDF's colour is checked (first 20%), colour pages are converted to grey (to 30%, one step that cannot show progress), and the files are built (in proportion to each file's mailpieces, adding the marks about every 200 ms); the batch's last 10% is writing the files, saving to the database and writing the MRDF file, each shown in the text. When every batch is made and "E-mail run sheets" is on, the job shows **E-mailing the run sheets** (checking the settings, loading, each run sheet, joining, sending) with the bar full, before it is marked Done. This was the pause after the last batch: the run sheets were drawn a second time for the e-mail. They are now reused from the ones drawn for the batches.

**Warning.** If "Make print files automatically" (Settings, Print production settings) is off, a yellow warning at the top says jobs wait for **Make print files** on the Jobs screen, with a link to Settings.

**PDF check progress.** An import that reads a PDF, and a PDF check, show a bar of pages checked and what they are on ("Checking the colour of page 1,200 of 54,000"): reading the PDF, then counting its pages, then looking at the colour of each page, which is where a big PDF spends its time. The colour check now hands control back about every 200 ms, so the watcher's timers and database updates keep running while a very large PDF is being read (before, they waited until it finished). Opening a very large PDF is still one step that cannot show progress.

**Queue estimate.** The blue line at the top says how long the inbox should take. It is worked out from the last 40 finished imports and PDF checks: seconds per megabyte for a pair (or a PDF arriving), and the average for an XML on its own, applied to each waiting file's size, plus what is left of the file being processed (from its page progress, else its size). A file is shown as "about 2 min" in the list. It needs at least 3 finished jobs of each kind; until then it says nothing, and "At least" means some waiting files could not be estimated. It covers imports and PDF checks only, not print files. It is a guide: the real time depends on how many pages are colour and on what else the server is doing.

How it works: the watcher and the composer write what they are doing to `idoc.activity` (a few rows, no business data; finished rows are deleted after 7 days). The API reads that table, lists `WATCH_DIR\inbox` itself (so the API needs `WATCH_DIR`, as for the Jobs screen) and adds the newest jobs. A "Running" row that has not moved for 10 minutes is shown in red as stopped (the program doing it has probably stopped) and is marked Abandoned the next time the watcher starts. Recording progress never stops the work: if the database cannot take the update the watcher logs a warning once and carries on. Make print files from the Jobs screen shows here too. The schema changed (`idoc.activity`, with `bytes` and `with_pdf`). To add the two columns without resetting the scratch database: `ALTER TABLE idoc.activity ADD bytes BIGINT NULL, with_pdf BIT NOT NULL CONSTRAINT df_activity_pdf DEFAULT (0);` (or reset it with `npm run db:rebuild <folder>`).

## From the Jobs screen

**Jobs** in the web app lists the newest jobs (search by customer or file name, filter by status) with how many of their batches have print files. A Received job has **Make print files**; once files exist the button reads **Make again** and asks first, with the choice to leave the batches that already have files (`onlyNew`). **Details** shows each batch and its files. The API does the same work as the command line and the watcher (`POST /api/jobs/:id/compose`, `src/jobs/ingestComposer.ts`), so the results are identical.

* The API server needs `WATCH_DIR` (its `processed` folder holds the PDFs) and `COMPOSE_OUT_DIR` in its `.env`, and optionally `MRDF_OUT_DIR` and `GS_PATH`; see `api/.env.example`. Without them the screen says so and the buttons are disabled.
* One job is composed by one request at a time; a second request for it is refused until the first finishes. The request waits for the files to be made, so a very large job can take a while.
* It works whether or not "Make print files automatically" is on. Only Received jobs can be composed. A job still waiting for its PDF, or whose PDF was rejected, shows why in its status.
* Nothing is written to the change log; the print files and their records are the evidence.

## What it does

* One PDF per batch, named as the run sheet's *File name* row says, as FileMaker did: `<job no> - IntelliDoc - <customer> - <batch code> - Batch <n> of <m>.pdf`. A batch that needs several files has ` - Segment <x> of <y>` before the `.pdf`. (Print files made before this change keep their old `<batchCode>_<segment>.pdf` names until they are made again; the old files are removed then.) A file is closed after the mailpiece that takes it past **Maximum pages in one print file** (Settings, default 10 000; the run sheet and padding count), so a file can run over by one mailpiece. The rest of the batch continues in the next file.
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

The mark positions are on the **Control marks** tab of the Settings page, in six groups: **Page size** (width and height, 210 x 297 mm to start with, never hard-coded; the preview uses it, and the composer uses it for a blank page that has no page before it to copy a size from), **Envelope window** (left, top, width, height of the address window; the preview draws it, print files do not use it), **Sequence number**, **Data Matrix** and **Pack start dot** (the print file marks) and **MRDF page codes**; the tab shares the Save changes bar with the General tab. Inside a group the fields carry no prefix (*Left*, *Top*, *Font size*), but the change log and error messages give the full name ("Sequence number: left"). **Print production settings** on the General tab holds *Make print files automatically* and *Maximum pages in one print file*.

**Preview positions** (button on the Control marks tab) shows where the marks fall. `POST /api/settings/marks-preview` takes `{ page: 'window' | 'mrdf', values }`, lays the values on screen (saved or not) over the saved settings and draws one page of the configured size with the same functions that make the print files (`drawMarks`, `drawMrdfMarks`) using sample numbers (batch 1042, mailpiece 123), plus a 10 mm grid, the envelope window and the boxes the marks are fitted in (preview only; none of this reaches a print file). Ghostscript turns that page into a PNG (`ingest/src/compose/preview.ts`), so it needs the same Ghostscript as the greyscale conversion (`GS_PATH`); without it the preview says so and nothing else is affected. FileMaker kept these in its Settings table, which was not in the DDR, so **the starting values are placeholders** (except the dot, which FileMaker fixed in the script). Check them against a printed proof and correct them there.

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
