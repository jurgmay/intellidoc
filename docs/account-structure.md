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
| Costing model (later) | own, inherit |

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

**Built (step 5, snapshot fields):** each mailpiece stores, as at production, its sub-account (`submitting_account_id`, which is live, plus `submitting_account_code`, `submitting_account_name` and `submitting_account_path`, the account names from the top of the tree separated by ` > `), the invoicing account (`invoicing_account_id`, `invoicing_account_code`, `invoicing_account_name`), `brand_name` and `outer_stock_code`. All packs of a mailpiece share one sub-account because packs from different sub-accounts are never merged. Renaming or moving an account, renaming a brand or recoding an envelope afterwards does not change them. The batch event log and recipient search are still to come.
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
| Production timestamps | `created_at` and `current_status` on batch, `is_enclosed` bit on mailpiece. | No event history (printed, enclosed, despatched). Add a batch event log. |
| Child packs | `pack.mailpiece_id` with a foreign key that forces one recipient. | None. |
| Recipient search | `address_line` text, `address_hash`, `pack_identifier`. Name guesses on pack are unreliable. | Need indexes (or full text) for name, postcode and identifier searches, and an agreed definition of "recipient". |
| Settings inheritance | Settings are read from the grouping account only. | Mode columns per group, an effective-settings resolver, the importer using it. |

## 8. Order of work

1. Audit the schema (this document, section 7). **Done.**
2. Tree and migration; retire grouping. **Done.**
3. Inheritance modes: schema, resolver, importer, UI. **Done** for envelopes, brands, matching, pack sequence and notification e-mails; costing to follow.
4. Invoicing account link and validation. **Done** (see section 5), apart from editing job numbers on sub-accounts, which is not needed for B-hive. The opt-in merge setting (3a) will not be built.
5. Snapshot fields (**done**), batch event log and recipient search.
6. Reporting.

## 9. Decisions on the open questions

1. Cross-sub-account merging: never, and no setting to allow it (revised; see section 3a).
2. "Recipient" means both the printed name and address, and the passthrough metadata.
3. Parent wins where parent and grouping disagree.

Still open: whether name and address searches need partial (contains) matching.
