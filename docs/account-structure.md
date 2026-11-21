# Account structure, inheritance, batching and invoicing

Agreed with the business on 21 Nov 2026. This is a specification. Nothing in it is built yet. Companion to `design_notes.md`.

## 1. The two separate concerns

- **Production batching** decides which mailpieces share a batch and an envelope. It uses the rules in `design_notes.md` section 5 and never looks at who is invoiced.
- **Invoicing and reporting** decides who is billed and how usage is grouped (invoicing account, brand, day). It is a separate pass over the mailpiece records. Fexco is the example: one unbranded outer envelope means fewer production batches, but invoices (and the daily bar chart PDF) are split by brand.

## 2. Account tree

- One tree through `parent_account_id`, any depth (Odevo > Vegner Group > B-hive Partners > 150+ sub-accounts). `grouping_account_id` is retired.
- The **root** of a tree is the batching boundary: "customer" in the batch uniqueness rule means the root. Sub-accounts under one root that resolve to the same envelope, brand, inserts and so on batch together.
- An account cannot be moved under its own descendant.
- Migration: each sub-account that has a grouping customer becomes a child of that customer, with every setting group set to inherit. Behaviour is unchanged on day one. Where `parent_account_id` and `grouping_account_id` disagree for an account, that needs a decision before migrating (query to be run on the scratch and live data).

## 3. Inheritance per setting group

Each account has a mode for each setting group.

| Group | Modes |
|---|---|
| Envelopes | own, inherit, inherit + extras |
| Brands | own, inherit, inherit + extras |
| Address-matching and pack-sequence rules | own, inherit |
| Notification emails | own, inherit, inherit + extras |
| Costing model (later) | own, inherit |

- **Own**: only this account's values.
- **Inherit**: the parent's effective values (resolved up to the nearest ancestor that has its own).
- **Inherit + extras**: the parent's effective list plus this account's own entries. Lists only.
- The importer reads the effective settings only, resolved once per run. The UI shows the effective result and where each item comes from.
- Examples: Somerset Council Planning and Housing use inherit + extras for envelopes (the generic envelope from the parent plus their own). Brands and matching rules are normally own.

## 4. Envelope choice

The user decides which envelopes an account may use (its effective list). The imported data names the envelope by WH stock code (`Envelope@Code`), and the importer changes size (for example C5 to C4) when the weight bands or sheet counts require it. Brand, passthrough and weight-band rules apply over the effective list as they do today.

## 5. Invoicing

- Each account has an **invoicing account** link. It must be the account itself or one of its ancestors. Moving an account re-checks it.
- Many accounts may share one invoicing account (B-hive's 150+ sub-accounts into one invoice). Odevo is never an invoicing account.
- Usage is calculated per invoicing account, brand and day, which feeds the PDF bar chart. Brand is always known at import (passthrough data, or derived from the envelope description).

## 6. Mailpiece records and history

- Each mailpiece keeps its own record, with links to its child packs where address matching was used.
- Anything reporting needs is a **snapshot taken at production time** (account, account path, invoicing account, brand name, envelope), so later restructuring never changes past reports.
- Production timestamps are kept for reporting and auditing.
- "Everything sent to this recipient" (debt collection) must be fast and exact, so recipient and identifiers need searchable storage.

## 7. Audit of the current schema against section 6

| Need | Today | Gap |
|---|---|---|
| Invoicing account | No column. It exists in FileMaker only. | Add `invoicing_account_id` on account; snapshot it. |
| Which sub-account produced a mailpiece | `mailpiece.account_id` and `batch.account_id` are the grouping (root) account. The sub-account is only on `pack.submitting_account_id`. | A mailpiece may merge packs from different sub-accounts, so it needs a rule (see open question 1). |
| Account in the tree at production time | Only live foreign keys. | Snapshot account code, name and path text. |
| Brand | `brand_id` on batch, mailpiece and pack (live). | Renaming a brand changes history. Snapshot the name. |
| Envelope | `batch.outer_stock_item_id` is a snapshot. `mailpiece.account_envelope_id` points at a live, editable row. | Snapshot the stock code on the mailpiece. |
| Production timestamps | `created_at` and `current_status` on batch, `is_enclosed` bit on mailpiece. | No event history (printed, enclosed, despatched). Add a batch event log. |
| Child packs | `pack.mailpiece_id` with a foreign key that forces one recipient. | None. |
| Recipient search | `address_line` text, `address_hash`, `pack_identifier`. Name guesses on pack are unreliable. | Need indexes (or full text) for name, postcode and identifier searches, and an agreed definition of "recipient". |
| Settings inheritance | Settings are read from the grouping account only. | Mode columns per group, an effective-settings resolver, the importer using it. |

## 8. Order of work

1. Audit the schema (this document, section 7).
2. Tree and migration; retire grouping.
3. Inheritance modes: schema, resolver, importer, UI.
4. Invoicing account link and validation.
5. Snapshot fields, batch event log and recipient search.
6. Reporting.

## 9. Open questions

1. Can address matching merge packs from different sub-accounts under one root into one mailpiece (it can today)? If yes, which account is billed for the mailpiece? If no, the account becomes part of the match key.
2. What is "recipient" for debt-collection searches: the normalised addressee and address, a customer reference from `pack_identifier`, or both?
3. Where `parent_account_id` and `grouping_account_id` disagree in live data, which wins?
