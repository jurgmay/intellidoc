# IntelliDoc web rebuild: core design notes (ingest to batch)

Companion to `intellidoc_core_schema.sql`. Everything here is derived from the FileMaker DDR, the sample XML/PDF pairs and your answers. Items tagged **CONFIRM** are my inference and need your sign-off.

## 1. Decisions applied

| # | Decision | Source |
|---|---|---|
| 1 | Support H-POD export **v6 only** (parser versioned so v3/v4 can be added later). | You |
| 2 | Drop MongoDB, Imprint and all Playground functionality. | You |
| 3 | JSON blobs are not stored; their data is normalised (passthrough, address-match rules, pack sequence, envelopes). | You |
| 4 | Store only real address data. "IMPORTANT NOTICE ENCLOSED" is stripped. Packs that had it are **not merged** with any other pack. | You (Q4 = No) |
| 5 | **One recipient per envelope, always.** Enforced by a database foreign key, not just code. | You |
| 6 | Batches are never combined across envelope, brand, etc. to reach a threshold. | You |
| 7 | Machine enclosing only when the batch has **more than 25** mailpieces **and** the outer envelope is **C5**. Reception-routed services (signed for / tracked / recorded) are routed separately. | You |
| 8 | Weight includes inserts. Insert **thickness** counts. The A4 sheet weight is a Settings value. | You |
| 9 | Batches of 25 or fewer mailpieces go to hand enclosing; 26 or more go to machine enclosing **if** the envelope is C5 (strictly "more than 25"). | You |
| 10 | Anonymous addressees (for example "THE OCCUPIER") never merge: each gets its own envelope. | You |
| 11 | Fewer batches than FileMaker where the same inserts appeared in a different order is acceptable. | You |
| 12 | `isCombineLettersToSameRecipient` is dropped. Nothing in the DDR reads it, and you agree it is redundant. | You + DDR check |

## 2. Ingest (per XML + PDF pair)

1. Pair `name.xml` with `name.pdf`; reject if either is missing. Validate `Version="6"`.
2. Parse with a streaming XML parser. Check the page ranges are contiguous, the page sum equals the PDF page count, and the PDF page count equals the last `EndPage`.
3. For each `Pack`, skip if `pack_guid` already exists (idempotent re-send).
4. Resolve accounts: `Source@OwnerAccount` matches `account.account_code`, and the customer is the account that holds the settings (itself, or the nearest ancestor that does not inherit).
5. Store the address (section 3), the option set (dedupe), passthrough as key and value dictionaries, identifiers as (type, value), and inserts by stock code. An unknown insert code is an ingest error, not a silent drop.
6. Analyse the PDF per pack for colour, mono and blank pages. Splitting is by page range with a streaming tool, because files can be 68 MB or more.

## 3. Addresses and the recipient rule

- Lines are stored as printed, minus the notice line, minus the trailing postcode line (it always equals the postcode attribute). There is no line limit. FileMaker silently dropped lines past six.
- `address_hash` = SHA-256 of the normalised lines (upper case; spaces, hyphens, dots, commas and apostrophes removed; "&" becomes "AND"). The addressee line(s) are part of the address, so different people never share an address row. `first_name` and `surname` from H-POD are guesses and are stored but never used for matching.
- **`pack.match_key`** = SHA-256 of: job + the normalised addressee and address lines + the values of the account's include-rule passthrough keys.
- A pack is **excluded** from matching (unique key, own envelope) if any of these hold:
  - an account exclude rule matches its passthrough;
  - its addressee is in `anonymous_addressee`, for example "THE OCCUPIER" (confirmed rule; the seed list still needs a review);
  - it had the notice line;
  - the account does not use address matching.
- Packs sharing `(job, match_key)` and not excluded become one mailpiece, ordered by `document_sequence`. This comes from `pack_sequence_rule`, keyed on the passthrough value of `account.pack_sequence_key_id`; 99 means unlisted.
- **Database guarantee.** `pack` has a foreign key `(mailpiece_id, job_id, account_id, address_id)` into `mailpiece`. A pack can only attach to a mailpiece whose address row is identical, so a cross-recipient merge is rejected by SQL Server even if the code is wrong. `v_rule_violations` is a second check for tests and audits.

## 4. Mailpiece: physical derivation

All constants come from `settings`.

```
sheets      = sum(pack.sheet_count)            -- duplex: ceil(pages/2)  CONFIRM vs PDF analysis
inserts     = union of the packs' inserts + linked child stock items
weight_g    = ceil( sheets * a4_sheet_weight_g + sum(insert.weight_g * qty) + outer_envelope.weight_g )
thickness   = sheets * a4_sheet_thickness_mm + sum(insert.thickness_mm * qty)
```

The envelope depends on the postal format, and the format depends on the weight, so the code walks formats from smallest (`rank_order`):

1. Look up the `account_envelope` for (account, brand, delivery band, format).
2. Compute weight and thickness with that envelope.
3. Accept the format if `weight <= max_weight_g` and `thickness <= max_thickness_mm` and `sheets <= max_sheets`. Otherwise step up to the next format.

That is how a C5 Letter becomes a C4 Large Letter when inserts push the mailpiece over the limit. The customer's requested envelope in the XML is advisory only. The weight band is the `postal_rate` row for the chosen service that contains the weight. The mailpiece's delivery band is the alphabetically first of its packs' requested services, so "1st Class" wins over "2nd Class" (as FileMaker does).

## 5. Batch identity and enclosing route

`batch_key` = SHA-256 of this canonical string, unique per job:

```
account_id | brand_id or 0 | outer_stock_item_id | postal_service_id | postal_format_id |
paper.batch_name | sorted insert stock ids | batching_value | enclosing_route
```

- `batching_value` is the passthrough value for `account.batching_key_id`, taken from the first pack in sequence order.
- Paper uses `batch_name`, so "A4 Plain" and "A4 White" batch together, as FileMaker does.
- Inserts are a **sorted** set. FileMaker used name order from a relationship, so the same inserts in a different order made a different batch. Expect fewer batches than FileMaker in those cases (accepted).
- `enclosing_route` per mailpiece:
  - `RECEPTION` if the service is signed for, tracked or recorded.
  - `MACHINE_CANDIDATE` if envelope size = C5, format = Letter and sheets <= `machine_enclosing_max_sheets`.
  - Otherwise `HAND`.
- After counting, a `MACHINE_CANDIDATE` batch becomes **Machine enclosing** only if `mailpiece_count > machine_enclosing_min_mailpieces` (25). Otherwise it is **Hand enclosing**. A batch is never topped up from another.

## 6. Differences from FileMaker (intentional)

- Customers are keyed by id, not name text, so renaming a customer no longer splits batches.
- Insert order no longer splits batches (sorted set).
- Machine enclosing uses `>` 25 (confirmed). FileMaker's setting meant "fewer than minimum goes to hand", so exactly 25 used to be machine.
- FileMaker's per-mailpiece weight in `@Create Mailpieces` left out insert weights, and a second formula included them. Insert weight is always included here.
- Mailpiece inserts are the union of all merged packs' inserts. FileMaker read them from the first pack only.
- FileMaker used a 16-sheet proxy for the Letter thickness limit. That proxy is kept as `max_sheets` alongside the real thickness check.
- Hand/machine was decided in three places. It is now one rule.
- Passthrough JSON, Address Match JSON, envelope JSON and the scratch table and xlsx round trip do not exist in the new design.

## 7. Open items

1. `anonymous_addressee`: global list for now. The seed values need your review, and say if any account needs its own.
2. Postal format limits in the seed data (Medium Parcel especially).
3. `sheet_count` for duplex packs where the last page is blank (National Grid shows 47 near-blank fourth pages).
4. `Coverage` is ignored, as in FileMaker.
5. `pack_sequence_rule` mapping from `PackSequenceRules.description` / `sequence`.
6. Not yet designed: pricing/invoicing, run sheets, spoils/returns, stock allocation, docketing, archiving, reading back the inserter's MRDF output, reports, users and roles.
