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

Tests: `npm test`. The database test needs `INTELLIDOC_TEST_DB` (it drops and recreates the `idoc` schema).
