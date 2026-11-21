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
| `GET /api/settings/audit?limit=50` | the change log |
| `PUT /api/settings/batch-code` | `{ "next": 5000 }`; only upwards, never onto a number already used |

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
