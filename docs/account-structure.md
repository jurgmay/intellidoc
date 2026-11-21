# Account structure, inheritance, batching and invoicing

Agreed with the business on 21 Nov 2026. This is a specification. Nothing in it is built yet. Companion to `design_notes.md`.

## 1. The two separate concerns

- **Production batching** decides which mailpieces share a batch and an envelope. It uses the rules in `design_notes.md` section 5 and never looks at who is invoiced.
- **Invoicing and reporting** decides who is billed and how usage is grouped (invoicing account, brand, day). It is a separate pass over the mailpiece records. Fexco is the example: one unbranded outer envelope means fewer production batches, but invoices (and the daily bar chart PDF) are split by brand.

## 2. Account tree

- One tree through `parent_account_id`, any depth (Odevo > Vegner Group > B-hive Partners > 150+ sub-accounts). `grouping_account_id` is retired.
- The **root** of a tree is the batching boundary: "customer" in the batch uniqueness rule means the root. Sub-accounts under one root that resolve to the same envelope, brand, inserts and so on batch together.
- An account cannot be moved under its own descendant.
- Migration: each sub-account that has a grouping customer becomes a child of that customer, with every setting group set to inherit. Behaviour is unchanged on day one. Where `parent_account_id` and `grouping_account_id` disagree for an account, **the parent wins**.

## 3. Inheritance per setting group

Each account has a mode for each setting group.

| Group | Modes |
|---|---|
| Envelopes | own, inherit, inherit + extras |
| Brands | own, inherit, inherit + extras |
| Address-matching and pack-sequence rules | own, inherit |
| Notification emails | own, inherit, inherit + extras |
| Costing model | own, inherit |

- **Own**: only this account's values.
- **Inherit**: the parent's effective values (resolved up to the nearest ancestor that has its own).
- **Inherit + extras**: the parent's effective list plus this account's own entries. Lists only.
- The importer reads the effective settings only, resolved once per run. The UI shows the effective result and where each item comes from.
- Examples: Somerset Council Planning and Housing use inherit + extras for envelopes (the generic envelope from the parent plus their own). Brands and matching rules are normally own.

**Built (step 3):** five groups, each with its own choice on the account (`envelopes_mode`, `brands_mode`, `matching_mode`, `sequence_mode`, `emails_mode`; OWN, INHERIT, EXTEND), all resolved by the view `idoc.v_account_setting_source`, which lists the accounts whose rows make up an account's effective settings (nearest first). An account that inherits all its settings follows its parent. A nearer entry with the same key replaces a further one (envelopes: brand name, delivery band, postal rate and reference; brands: name; matching rules: kind, key and value; pack order: value; e-mails: address). Matching covers address matching on or off, the batching key and the matching rules; pack sequence covers its key and order. The single values (address matching, batching key, pack sequence key) are the parent's under INHERIT and the account's own under OWN and EXTEND. The importer reads the effective settings, and each customer tab (Envelopes, Brands, Matching & batching, Notifications) has the choice, shows the parent's settings read only with where each comes from, and removing a customer's parent puts every group back on its own. The defaults are OWN, so nothing changes until a choice is made; brands and matching rules are normally left on their own. Costing models will use the same mechanism.

**Customer to sub-account and back:** an existing customer with a parent can be made a full sub-account (Customers > Details > Sub-account), as B-hive's other accounts are: `inherits_settings` becomes 1, so every setting comes from its parent. Its own brands, envelopes, rules and emails are kept but not used, and its own sub-accounts move up with it. It is refused while customers are placed under it (move them first). Its invoicing account follows the parent unless one was chosen. The reverse is on the parent's Accounts tab (Edit > Give it its own settings): the account holds its own settings again, with whatever it had kept, and its invoicing account then defaults to itself. Both directions write History for the account and for the customer that holds its settings. Nothing in the tree changes, so batches, mailpieces and job numbers already recorded are unaffected.

## 3a. Merging packs from different sub-accounts

**Decided: not needed.** Two sub-accounts never share an envelope (the submitting account and the invoicing account are part of the match key), and there is no setting to change that. If it is ever wanted, the earlier idea was an opt-in on an account applying below it, only between accounts with the same invoicing account, so that a merged mailpiece always has exactly one invoicing account.

## 4. Envelope choice

The user decides which envelopes an account may use (its effective list). The imported data names the envelope by WH stock code (`Envelope@Code`), and the importer changes size (for example C5 to C4) when the weight bands or sheet counts require it. Brand, passthrough and weight-band rules apply over the effective list as they do today.

## 5. Invoicing

**Built (step 4):**
- `account.invoicing_account_id` is the invoicing account (NULL = the account that holds the settings, so nothing changes for existing customers). `idoc.v_account_invoicing` gives the effective one. The API and the import check that it is the account itself or an ancestor.
- The **job number, name and return address on the run sheet come from the invoicing account**. A job number belongs to an invoicing account and applies to all its sub-accounts.
- **Invoicing accounts never share a batch**: the invoicing account is part of the batch key (and recorded on each batch and mailpiece). Production batching is otherwise unaffected by who is invoiced.
- The batching boundary is now the **root of the tree**: jobs, batches, mailpieces and packs belong to the root.
- Packs from different sub-accounts are not merged into one envelope by default (the sub-account and the invoicing account are in the match key).  There is no opt-in to merge them; it was decided not to build one (section 3a).
- The FileMaker import reads `id_invoicingAccount` (name assumed) and falls back, with a warning, when it is not an ancestor.
- Editing the job number and return address of a sub-account that is itself an invoicing account is not on the screens yet.

- Each account has an **invoicing account** link. It must be the account itself or one of its ancestors. Moving an account re-checks it.
- Many accounts may share one invoicing account (B-hive's 150+ sub-accounts into one invoice). Odevo is never an invoicing account.
- Usage is calculated per invoicing account, brand and day, which feeds the PDF bar chart. Brand is always known at import (passthrough data, or derived from the envelope description).

## 6. Mailpiece records and history

- Each mailpiece keeps its own record, with links to its child packs where address matching was used.
- Anything reporting needs is a **snapshot taken at production time** (account, account path, invoicing account, brand name, envelope), so later restructuring never changes past reports.

**Built (step 5, snapshot fields):** each mailpiece stores, as at production, its sub-account (`submitting_account_id`, which is live, plus `submitting_account_code`, `submitting_account_name` and `submitting_account_path`, the account names from the top of the tree separated by ` > `), the invoicing account (`invoicing_account_id`, `invoicing_account_code`, `invoicing_account_name`), `brand_name` and `outer_stock_code`. All packs of a mailpiece share one sub-account because packs from different sub-accounts are never merged. Renaming or moving an account, renaming a brand or recoding an envelope afterwards does not change them. 

**Built (step 5, batch event log):** `idoc.batch_event` holds one row per thing that happened to a batch: `Created` (written when the batch is made), then `Printed`, `Enclosed`, `Despatched` or `Cancelled`, each with a UTC time, who recorded it (empty for the ingest watcher) and an optional note. `batch.current_status` is always the latest event, and both are written in one transaction by `MssqlRepository.recordBatchEvent`, which also refuses a second `Created`, an unknown batch and any event after `Cancelled`. Events are only added, never changed. Both columns are checked in the database (`ck_batch_event_type`, `ck_batch_status`). There is no screen or API for it yet, and the production gate (only 'Received' jobs go to printing) is separate. 

**Built (production gate):** a batch can only be printed, enclosed or despatched once the PDF of its job has arrived and passed its checks (job status `Received`). A job that is `Awaiting PDF` or `PDF Rejected` holds all its batches; cancelling is always allowed. `MssqlRepository.recordBatchEvent` checks this first and throws a `ProductionGateError` with a readable message (it names the batch code and job, and the rejection reason). Two triggers (`trg_batch_event_gate`, `trg_batch_status_gate`) stop any other writer from adding a Printed, Enclosed or Despatched event, or setting that status, for a job without its PDF. The view `idoc.v_batch_production` gives each batch's job status, `hold_reason` (waiting for the PDF, or PDF rejected with the reason) and `can_print` (job received and batch still Created), for the print step and screens to use. Run sheets can still be made while the PDF is awaited.

**Built (price on each mailpiece):** the recipient search shows what the customer pays for each hit's mailpiece (a "Price" column; "Not priced" when it has none) and the figure opens a breakdown: the costing model used, the page counts, what the customer pays, what it costs Latcham, the difference, and every line (quantity, unit cost and sell, cost and sell) with production, postage and total rows. An incomplete price (no envelope price, no postage rate) says so. A mailpiece with no price says why: cancelled, the colours of some pages are not known yet (the PDF has not been read), no costing model was in force for the customer that day, or it has simply not been priced yet. `GET /api/mailpieces/:id/price`; the search rows carry `priceSell`. A mailpiece is only priced when its job is Received, so mail from before a costing model existed stays unpriced until it is priced again (`priceJob`); there is no button for that yet.

**Built (costing model screens):** a Costing tab on each customer. It shows where the prices come from (this customer's own price lists, or the parent's; a sub-account that takes all its settings from its parent cannot choose) and lists the customer's models with their dates, status (in force, replaced by a later model, ended, not started, switched off) and how many mailpieces each has priced. When the prices are inherited the parent's models are shown read only, with a link to edit them on the parent. A model can be created empty or copied from another model (its prices, envelope prices and postage adjustments are copied and `copied_from_id` remembers the source). The editor shows every charge in groups (Print, Enclosing and inserts, Adjustments) with cost, sell price, adjustment and what the customer pays; the outer envelope prices (add or remove envelopes); and the customer's adjustment on each current postal rate (the postal rates themselves are not edited here and are still to come in Settings). A whole model is saved in one request. Rules: two models of a customer cannot start on the same day; costs and sell prices cannot be negative, adjustments can; at most 4 decimal places. Because every priced mailpiece keeps its own snapshot, a model that has already priced mail can still be edited, and the screen says that the change only affects mail priced from now on; it cannot be deleted (switch it off instead). Every change is written to the customer's History as one line naming each price that changed, before and after. Endpoints: `GET /api/customers/:id/costing`, `PUT /api/customers/:id/costing-mode`, `POST /api/customers/:id/costing-models`, `GET|PUT|DELETE /api/costing-models/:id`, `GET /api/costing/lookups`.

**Built (price at production):** once a job is Received (on a direct XML+PDF ingest, or when the PDF arrives on the XML-first path) every mailpiece in it is priced from the costing model in force on its production day (the UK day it was created), and the result is stored on the mailpiece: `costing_model_id`, `production_cost`, `production_sell`, `postage_cost`, `postage_sell`, `priced_at` and `price_warnings`, plus one `mailpiece_price_line` per charge (code, quantity, unit and line cost and sell). Later changes to a price list never change what was charged. Inputs: the packs' colour, mono and blank pages (summed over the mailpiece), the inserts in the mailpiece, Machine enclosing for machine batches and Hand for hand and Reception batches, the batch's mailpiece count (small batch adjustment), the postal format, the envelope's oversticker flag, the customer's address matching setting, the batch's outer envelope, and the mailpiece's postal rate. A mailpiece is left unpriced (`priced_at` NULL) when its customer has no costing model that day, or when any pack's page colours are unknown. A missing envelope price or postage rate still prices the rest and says so in `price_warnings`. Pricing never undoes an ingest: if it fails the watcher logs it and the job stays saved. `priceJob(pool, jobId)` (`src/mssql/pricing.ts`) prices a job again and replaces its lines. The schema changed (section 13), so reset the scratch database (`npm run db:rebuild <folder>`). Not built yet: a screen or report for the prices, and the maintenance screens for costing models.

**Built (PDF page analysis):** when a PDF is read, every page is classed as blank, mono or colour, and the counts are stored on each pack (`colour_pages`, `mono_pages`, `blank_pages`). On a direct XML+PDF ingest they are written with the pack. On the XML-first path they are written in the same transaction that makes the job Received, so a Received job has them whenever the PDF could be read; a PDF whose colours cannot be read is still accepted and its packs keep NULL counts. The rules: a blank page has no marks at all. A page is colour if any element has colour in it: RGB values that differ, or any cyan, magenta or yellow ink. Interpretations to know about: white (RGB 1,1,1, CMYK 0,0,0,0, grey 1) is not ink, so a white-filled page is still blank; any other grey counts as colour, as does any image that is not a 1-bit black-and-white image or mask; invisible text (render mode 3 or 7) and text of spaces only are not marks; form XObjects are followed; a page that cannot be read counts as colour so it is never under-charged. The analyser is pure JavaScript (pdf-lib), with no external tools. It reads each page's content stream, so very large PDFs take a few seconds.

**Built (step 6, daily usage):** the view `idoc.v_usage_daily` counts mailpieces, packs and sheets per invoicing account, brand, UK calendar day, postal format and service, straight from the production snapshot on the mailpiece. The day is the day the mailpiece was produced. Cancelled mailpieces and mailpieces in a cancelled batch are left out. `GET /api/reports/usage` (invoicing account, first and last day, at most 366 days) returns the days (empty days included), the brands, the format and service lines, and the totals. `GET /api/reports/usage.pdf` returns the same report as an A4 PDF: totals, a stacked bar chart of mailpieces per day by brand (the six biggest brands, the rest as "Other"), then tables by day, brand, and format and service. The "Usage report" screen shows it and links the PDF. Costing and other reports are still to come.

**Built (postal rate editor):** a "Postal rates" tab in Settings covers providers, services (format, code, signed for / tracked / recorded) and weight-band prices (cost and sell price). Prices change by a **dated change**: "Change prices from a date" ends each chosen band's row the day before and starts a new row on that date (a later last day carries over, the date cannot be in the past, and a band that already has a later row is refused). Customer postage adjustments are copied to the new row. Envelope settings keep pointing at the old row; ingest follows the band (same service and weights) to the row in force today, so a mailpiece is priced with the row of its production day. Within one band no two rows may overlap in dates. A price used by an envelope setting, a customer costing adjustment or a mailpiece cannot be deleted and its weights and first day cannot change; it is ended with a last day. A service is deleted only with no prices and no batches, a provider only with no services; "switching off" a service means ending all its prices. Postal formats and their size limits are not edited here. Every change writes a line to `idoc.audit_log` (entity `postal`), shown under "Recent changes". No schema change.

**Built (step 5, recipient search):** `GET /api/recipients/search` and a "Recipient search" screen. A search always needs an account (`accountId`) and covers that account and every account below it, found by the packs' `submitting_account_id`. There is no all-customers option and the API answers 422 without an account. Names are matched against the first address line and addresses against the other lines and the postcode, both as "contains" and ignoring case. References (any passthrough value, or one named key) match exactly, or by prefix when the text ends with `*`. An optional release date range includes both days. Each term needs at least 2 characters, at least one term or date is required, and results are the newest first, 100 by default (at most 500) with a flag when there are more. LIKE wildcards in the text are treated literally. A hit shows the recipient's address lines, the sub-account (as at production), the invoicing account, brand, batch code and status, and the references. No text index yet; add one only if searches turn out to be slow. `GET /api/recipients/scopes` lists the accounts that can be chosen.
- Production timestamps are kept for reporting and auditing.
- "Everything sent to this recipient" (debt collection) must be fast and exact. Two searches are needed: by printed name and address, and by passthrough metadata (Tenant Reference, Property Reference, Document Type and so on). Reference values are matched exactly or by prefix; whether name and address also need partial (contains) matching is still to be decided.

## 7. Audit of the current schema against section 6

| Need | Today | Gap |
|---|---|---|
| Invoicing account | No column. It exists in FileMaker only. | Add `invoicing_account_id` on account; snapshot it. |
| Which sub-account produced a mailpiece | `mailpiece.account_id` and `batch.account_id` are the grouping (root) account. The sub-account is only on `pack.submitting_account_id`. | A mailpiece may merge packs from different sub-accounts, so it needs a rule (see open question 1). |
| Account in the tree at production time | Only live foreign keys. | Snapshot account code, name and path text. |
| Brand | `brand_id` on batch, mailpiece and pack (live). | Renaming a brand changes history. Snapshot the name. |
| Envelope | `batch.outer_stock_item_id` is a snapshot. `mailpiece.account_envelope_id` points at a live, editable row. | Snapshot the stock code on the mailpiece. |
| Production timestamps | `created_at` and `current_status` on batch, `is_enclosed` bit on mailpiece. | No event history (printed, enclosed, despatched). **Done:** `idoc.batch_event`. |
| Child packs | `pack.mailpiece_id` with a foreign key that forces one recipient. | None. |
| Recipient search | `address_line` text, `address_hash`, `pack_identifier`. Name guesses on pack are unreliable. | Need indexes (or full text) for name, postcode and identifier searches, and an agreed definition of "recipient". |
| Settings inheritance | Settings are read from the grouping account only. | Mode columns per group, an effective-settings resolver, the importer using it. |

## 8. Order of work

1. Audit the schema (this document, section 7). **Done.**
2. Tree and migration; retire grouping. **Done.**
3. Inheritance modes: schema, resolver, importer, UI. **Done** for envelopes, brands, matching, pack sequence and notification e-mails; costing models and the price calculation **done** (part 1, see section 6); pricing at production, maintenance screens and the FileMaker import to follow.
4. Invoicing account link and validation. **Done** (see section 5), apart from editing job numbers on sub-accounts, which is not needed for B-hive. The opt-in merge setting (3a) will not be built.
5. Snapshot fields, batch event log and recipient search (all **done**).
6. PDF page analysis **done** (colour, mono and blank pages per pack). Pricing at production **done** (see "Built (price at production)"); costing model screens **done** (see "Built (costing model screens)"); the price on each mailpiece **done** (see "Built (price on each mailpiece)"); the postal rate editor **done** (see "Built (postal rate editor)"); pricing existing mail again, the FileMaker costing-model import and money in the reports are next.
7. Reporting. **Daily usage done** (see section 6, "Built (step 6)"). Costing and other reports still to come.

## 9. Decisions on the open questions

1. Cross-sub-account merging: never, and no setting to allow it (revised; see section 3a).
2. "Recipient" means both the printed name and address, and the passthrough metadata.
3. Parent wins where parent and grouping disagree.

Still open: whether name and address searches need partial (contains) matching.
