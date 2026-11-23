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

## Recipient search

`GET /api/recipients/scopes` lists the accounts a search can be scoped to. `GET /api/recipients/search?accountId=…` needs an account and searches that account and everything below it. Optional: `name` (contains, first address line), `address` (contains, other lines and postcode), `reference` (exact, or prefix with a trailing `*`), `referenceKey` (limit `reference` to one passthrough name), `from` and `to` (release dates, YYYY-MM-DD, inclusive) and `limit` (1 to 500, default 100). At least one of name, address, reference or a date is required, and text terms need 2 or more characters. The reply is `{ scope, rows, truncated }`.

## Usage report

`GET /api/reports/invoicing-accounts` lists the invoicing accounts that have produced anything. `GET /api/reports/usage?invoicingAccountId=…&from=YYYY-MM-DD&to=YYYY-MM-DD` returns the daily usage for one invoicing account (at most 366 days), and `GET /api/reports/usage.pdf` with the same parameters returns it as a PDF. The numbers come from the view `idoc.v_usage_daily`, so the view has to exist (it also carries the sell value of production and postage, which the report adds up as `productionSell`, `postageSell`, `totalSell` and counts `unpriced` mailpieces): rebuild the scratch DB (`npm run db:rebuild <folder>` in `ingest`) after pulling this change.
