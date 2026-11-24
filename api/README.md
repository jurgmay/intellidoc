# IntelliDoc API

Fastify + SQL Server. Serves the web app's data under `/api`, and the built web app (`../web/dist`) at `/`.

    cd api
    npm install
    copy .env.example .env      (set INTELLIDOC_DB)
    npm run dev                 (http://127.0.0.1:3001)
    npm run dev:stub            (no database: in-memory data, for working on the web app)

There is no sign-in yet. Changes are recorded as made by `system`; `userOf()` in `src/settings/routes.ts` is the one place
that will return the signed-in person once Microsoft sign-in is added. The API listens on `127.0.0.1` only; set `API_HOST`
to expose it on the network (do that only behind the company network).

## Settings

`src/settings/catalogue.ts` lists every setting in `idoc.settings` with its label, limits, what it does, where the app uses it and
when a change takes effect. The Settings page is generated from that list, so the explanations live next to the code.

| Endpoint | |
|---|---|
| `GET /api/settings` | all settings with explanations and values, and the batch code |
| `PUT /api/settings` | `{ "values": { key: value } }`; validated; 422 with a message per setting; one change-log row per changed value |
| `POST /api/settings/marks-preview` | `{ "page": "window" \| "mrdf", "values": { key: value } }`: a PNG of the page with the control marks and envelope window drawn from the saved settings overlaid with `values` (nothing is saved). 422 for a value that could not be saved, 503 if the picture cannot be drawn (Ghostscript missing) |
| `DELETE /api/settings/:key/secret` | removes a saved password (the only way; an empty value in `PUT` is refused). The change log says `(set)` / `(not set)`, never the value |
| `GET /api/settings/audit?limit=50` | the change log |
| `PUT /api/settings/batch-code` | `{ "next": 5000 }`; only upwards, never onto a number already used |

**Settings > Network** holds folder paths and one password. Nothing reads them yet. The password (`networkPassword`) is a *secret* setting: it is encrypted with AES-256-GCM before it reaches the database (`src/settings/secret.ts`), `GET /api/settings` never returns it (its `value` is empty and `isSet` says whether one is saved), and the change log never records it. The key comes from `INTELLIDOC_SECRET_KEY` in the API's `.env` (any passphrase of 16+ characters). Without it saving a password is refused with a message saying so (paths still save). If the key is lost or changed the saved password cannot be read: type it again. Server code that needs the password calls `store.secret('networkPassword')`; it is never sent to a browser. `settings:export` copies the encrypted text into `db/local_settings.sql`, which only works with the same key.

**Settings > Connectivity** holds the e-mail (SMTP) settings and the H-POD API settings, with a test button for each. `POST /api/settings/test-email` sends a test e-mail to the Alert e-mail recipients (Settings > General) through the mail server given; `POST /api/settings/test-hpod` signs in to H-POD with `POST /authenticate` (the H-POD API's own authentication call) using the endpoint, instance, account code, username and password. Both take `{ "values": { ... } }`, the values on screen (saved or not) laid over the saved ones, and answer `{ "ok": true | false, "message": "..." }` (a refused login or an unreachable host is an answer, not an error; 422 only for a value that could not be saved). A successful H-POD test says who signed in and until when the token is valid; a refusal says so (with H-POD's reason) and the password is never in a message. A password typed on screen is used for that one request and not kept; otherwise the saved one is read on the server. The test signs in on its own and does not touch the session the H-POD page holds. Port 465 uses TLS from the start, any other port starts plain and upgrades (STARTTLS) when the server offers it. Both passwords are secret settings like the network one. The watcher and the run sheet e-mail still use the `SMTP_*` lines in their `.env` files.

## H-POD

The **H-POD** page (`/hpod`) tries every call of the H-POD print API v3 (<https://api-uk.h-pod.co.uk/v3/docs/>) and sends a document through it, for testing and live demos. It uses the sign-in details on Settings > Connectivity; if they are not filled in, the page says which. The client is `ingest/src/hpod/client.ts` (fetch based), the server side `api/src/hpod/`.

- **Submit** loads the account's print options (`GET /print/configuration`), takes a PDF, then runs `POST /print/init`, one `POST /print/docpart` for each 300 KB of the file (H-POD's limit is 500 KB a part) and `POST /print/commit`, pacing the calls (`/print` allows 10 a second). It stops at the first step that fails and says which.
- **Track** shows a job (`GET /job/status/{jobGuid}`) and a pack (`GET /pack/{packGuid}`), and sets a pack's status (`POST /pack/batch`).
- **Console** has all 23 operations (authenticate, print, job, pack, blob, framework and the OpenID Connect provider calls): it builds a form from the operation (path and query values, JSON or form body, a file chooser for the blob upload, an optional token override and idempotency key) and shows the status, time, call-limit headers, the response, the request that was sent and the response headers.

Routes: `GET /api/hpod/operations` (the catalogue the page builds its forms from), `GET | POST | DELETE /api/hpod/session` (status; sign in; sign out), `POST /api/hpod/call` `{ operation, path?, query?, body?, idempotencyKey?, bearerOverride?, confirm? }` and `POST /api/hpod/submit` `{ options, fileName, data (base-64), commit, confirm }`.

- The **token is held on the server**, in memory, and signed in with the first call that needs it (and again once if H-POD answers 401). The password and the token never go to the browser: the sign-in body is built on the server, the request echo hides passwords and shortens the bearer token, and any token in a response body is shown as `********`. Changing the H-POD settings starts a new session.
- Calls that change live data or can print and post mail (`printCommit`, `packBatch`, `frameworkSubmit`, and a submission) need `confirm: true`; without it the server answers 422 and the page asks first.
- What H-POD answers, errors included (404, 400...), comes back as the result of the call (HTTP 200 from this API) so it can be inspected. Trouble reaching or signing in to H-POD is the error: 422 when a setting is missing, 429 when H-POD throttles (sign-in is limited to 5 a minute; the message gives its Retry-After), 502 for a refused sign-in or an unreachable host. Redirects are not followed (the Location header is shown). A `/v3` is added to the endpoint when it is not there. Non-GET calls get an `Idempotency-Key` unless one is given.
- `npm run dev:stub` (the stub server, in `api`) has a pretend H-POD with demo sign-in details, so the page can be tried with no account or network.

### Customers

Accounts form one tree through `parent_account_id`. A customer is an account that holds its own settings (`inherits_settings = 0`); a sub-account is an account that reads them from its parent, at any depth (`idoc.v_account_owner` gives the account that holds the settings). Everything the importer reads
(flags, brands, envelopes, matching rules, batching and sequence keys) is edited here. Errors: 422 `{ errors: { field: message } }`,
409 `{ error }` for duplicates or a record in use, 404 for an unknown id. Every change writes a readable line to `idoc.audit_log` in the same transaction.

| Endpoint | |
|---|---|
| `GET /api/customers?search=&deleted=1` | list with account, brand and envelope counts |
| `POST /api/customers` | `{ code, name }` |
| `GET` / `PUT /api/customers/:id` | the whole customer; PUT saves code, name, MIS job number, return address, flags, batching key, pack sequence key and `parentId` (hierarchy parent, `null` for none; must be another customer and never a loop) |
| `PUT /api/customers/:id/inheritance` | `{ "setting": "envelopes" \| "brands" \| "matching" \| "sequence" \| "emails", "mode": "OWN" \| "INHERIT" \| "EXTEND" }`: where a group of settings comes from (its own, the parent's, or the parent's plus its own). matching = address matching, batching key and matching rules; sequence = pack sequence key and rules. INHERIT and EXTEND need a parent (422 otherwise); removing the parent resets every group to OWN. `GET` returns `modes`, `inheritedEnvelopes` and `inherited` (brands, rules, e-mails, and for INHERIT the single values; all read only, each with `from`) |
| (invoicing account) | `PUT /api/customers/:id` also takes `invoicingAccountId` (`null` = the customer itself; otherwise the customer or one of its parents). `GET` returns `invoicing` and `invoicingOptions`. The invoicing account's job number is printed on the run sheet |
| (pending job number) | `PUT /api/customers/:id` also takes `pendingJobNumber` (`null` for none) and `jobNumberRolloverDay` (1 to 28, default 1; one customer uses the 21st). A new pending number starts on the next occurrence of that day (London time); the API checks every 10 minutes and the watcher every minute, and when it is due it replaces the job number, is cleared, and is written to the History tab |
| `GET /api/customers/lookups` | passthrough keys, delivery bands, postal rates, envelope stock, flag labels |
| `GET /api/customers/:id/history` | the change history |
| `POST /api/customers/:id/accounts`, `PUT /api/accounts/:id` | sub-accounts (removing one is a soft delete) |
| `POST /api/customers/:id/make-sub-account`, `POST /api/accounts/:id/make-customer` | a customer with a parent takes all its settings from it (refused while customers are placed under it); the reverse gives an account its own settings again. Both write History |
| `POST /api/customers/:id/brands`, `PUT` / `DELETE /api/brands/:id` | brands; one in use cannot be deleted |
| `POST /api/customers/:id/envelopes`, `PUT` / `DELETE /api/envelopes/:id` | envelope settings (delete is soft) |
| `PUT /api/customers/:id/match-rules`, `/sequence-rules`, `/emails` | each replaces the whole list |

Tests: `npm test`. The database tests (`npm run test:db`) read `INTELLIDOC_TEST_DB` from `api/.env.test` (copy `.env.test.example`). They drop and recreate the `idoc` schema in that database, so point it at a test database, never at real data.

## Recipient search (the Mailpieces page)

`GET /api/recipients/scopes` lists the accounts a search can be scoped to. `GET /api/recipients/search?accountId=…` needs an account and searches that account and everything below it. Optional: `name` (contains, first address line), `address` (contains, other lines and postcode), `reference` (exact, or prefix with a trailing `*`), `referenceKey` (limit `reference` to one passthrough name), `from` and `to` (release dates, YYYY-MM-DD, inclusive) and `limit` (1 to 500, default 100). At least one of name, address, reference or a date is required, and text terms need 2 or more characters. The reply is `{ scope, rows, truncated }`.

**The rows are always mailpieces** (one row for each envelope, newest release first), never packs. A row has the address (`addressLines`, addressee first, and `postcode`), the account it was sent from and invoiced to, the batch, the price (`priceSell`), `isCancelled`, and `packs`: every letter in the envelope, in envelope order. Each pack has `position` (1, 2, 3...), `sequence` (its number in the customer's pack sequence rules, or `null` when it is not listed), `startPage`, `pageCount`, `releaseDate` and `references` (all the fields the customer sent with that letter). The order is the customer's pack sequence, unlisted packs last, then the order in the PDF, the same order the composer uses. The name and address belong to the mailpiece; a reference or a release date matches when one of its packs has it (a reference and a date together must be on the same pack), and the row then shows all its packs. The web page shows the address in one comma-separated line under the name.

**Searching by GUID:** `jobGuid` (the H-POD job, stored as the pack's source GUID) and `packGuid` (one letter) find the mailpieces that have a matching pack; both are exact, accept any case and optional braces, and answer 422 if they are not GUIDs. Either counts as a search term on its own. When both are given, the same pack must match both. Each pack in a result now carries its `packGuid` and `jobGuid`, and the Mailpieces page shows them in the letters table.

## Batches page

`GET /api/batches/search?accountId=…` needs an account and finds the batches that hold at least one mailpiece submitted from that account or below (a batch can hold mailpieces of several sub-accounts). Optional: `code` (the batch code, exact), `status` (Created, Printed, Enclosed, Despatched, Cancelled), `job` (contains, at least 2 characters), `from` / `to` (the UK day the batch was made, both included, `YYYY-MM-DD`), `limit` (default 100, at most 500). Newest first, with a `truncated` flag. Each row is the common data of the batch: code, status, job, when created (UK time), enclosing department, service, envelope, brand, invoicing account, and its figures *for the mailpieces the search covers*: `mailpieces` (not cancelled), `mailpiecesInBatch` (all of the batch, which is more when other sub-accounts have mail in it), `cancelled`, `packs`, `pages`, `sheets`, `priceSell` (what the customer pays for the priced ones) and `unpriced`.

The mailpieces of a batch come from the mailpiece search, so the two pages show them identically: `GET /api/recipients/search?accountId=…&batchId=…` lists a batch's mailpieces in print order (`sequenceNumber`, unnumbered last) and needs no other term. `offset` skips that many rows, so a big batch can be read a page at a time (`truncated` says there are more). Rows now carry `sequenceNumber`.

The web page (`/batches`) works like Mailpieces: a header band for each batch (collapsed at first; click it, or press Enter or Space on it, to show its mailpieces, and again to hide them), and each mailpiece inside is the same collapsible box as on the Mailpieces page, with its print-order number. The mailpieces are fetched 50 at a time when a batch is first opened ("Show more mailpieces" for the rest). Like the Mailpieces page it keeps its account, terms, results, and which batches and mailpieces are open while the app is open. Code: `api/src/batches/`, `web/src/pages/BatchesPage.tsx`, and `MailpieceCard.tsx` which both pages share.

## Mailpiece audit report (proof of postage)

For when a customer's customer says they never received a letter. On the Reports page, choose **Mailpiece audit report**. It has two steps, because a name and address match can catch a different person:

1. **Find and review.** The form takes the Mailpieces search terms (name, address, job GUID, pack GUID, reference and its name, release dates) within an account and below, and lists up to 300 matching mailpieces as the Mailpieces page does, so the letters and their metadata can be opened and checked. Nothing is ticked at first. Tick the mailpieces that are the recipient's (Tick all / Untick all help).
2. **Create report.** `POST /api/reports/audit.pdf` with `{ accountId, mailpieceIds, criteria, thumbnails }` returns a PDF. Only mailpieces in that account or below are included (the rest are named in a note on the first page), at most 300, oldest first. `criteria` is the words describing the search, printed on the first page with the number ticked and the time the report was made. `thumbnails` (default true) turns the page images off.

**What it holds:** a summary page, then one page per mailpiece: the address, the first page of the letter, when it was produced, the job, who submitted it (the account path as it was at the time, and the export's Source owner account and user), the service (and whether it is tracked), contents and weight, the batch and its place in the print order, a **timeline** (job received, PDF received, mailpiece produced, print file made, then the batch's Created, Printed, Enclosed and Despatched events with who recorded them and any note), and each letter's pack GUID, job GUID, sequence, pages, release and receipt times and references. All times are shown in UK time (GMT or BST). It holds no prices or costs. IntelliDoc stores no tracking numbers or delivery scans, so for tracked and signed-for services the report only says the service is tracked; the proof of delivery is the carrier's.

**Page images** are rendered with Ghostscript from the customer's PDF in the watcher's `processed` folder, which keeps them for 90 days. The page used is the first page of the mailpiece's first letter. When the PDF is gone (or the API has no `WATCH_DIR` / `AUDIT_PDF_DIR`) that mailpiece's page says so, and the rest of the report is unaffected. `AUDIT_PDF_DIR` overrides `WATCH_DIR/processed`; `GS_PATH` names Ghostscript if it is not on the PATH. Code: `api/src/audit/`, `web/src/pages/AuditReportPanel.tsx`.

## Usage report

The internal margin report has the same parameters at `GET /api/reports/margin`, and `GET /api/reports/margin.pdf` returns it as a PDF in the same style as the usage PDF (sell and cost for each day, then the numbers; marked INTERNAL because it shows costs).

`GET /api/reports/invoicing-accounts` lists the invoicing accounts that have produced anything. `GET /api/reports/usage?invoicingAccountId=…&from=YYYY-MM-DD&to=YYYY-MM-DD` returns the daily usage for one invoicing account (at most 366 days), and `GET /api/reports/usage.pdf` with the same parameters returns it as a PDF. The numbers come from the view `idoc.v_usage_daily`, so the view has to exist (it also carries the sell value of production and postage, which the report adds up as `productionSell`, `postageSell`, `totalSell` and counts `unpriced` mailpieces): rebuild the scratch DB (`npm run db:rebuild <folder>` in `ingest`) after pulling this change.
