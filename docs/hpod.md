# H-POD module

The H-POD page (`/hpod` in the web app) exercises the H-POD print API v3 (<https://api-uk.h-pod.co.uk/v3/docs/>) so it can be tested and used in live demos. The same sign-in is used by the **Test the connection** button on Settings > Connectivity.

## Setting up

Settings > Connectivity > H-POD API settings: **Endpoint** (for example `https://api-uk.h-pod.co.uk`; `/v3` is added when missing), **Instance**, **Account code**, **Username** and **Password** (stored encrypted, never shown again). The test button signs in with `POST /authenticate` and reports who signed in and when the token runs out, or why H-POD refused. H-POD limits sign-ins to 5 a minute, so avoid clicking it repeatedly.

## The page

| Tab | What it does |
|---|---|
| Submit | Loads the account's options (paper, envelope, ink, duplex, pack mode, delivery), takes a PDF and optional recipient, and sends it: init, document parts, commit. Shows each step and the job GUID, with a button to track the job. |
| Track | Job status, pack details, and setting a pack's status (printed, posted, delivered, failed...). |
| Console | Every operation of the API with its documented parameters and a sample body; shows the response, the request actually sent, the status, time and call-limit headers. |

The bar at the top shows whether the page is signed in and until when. The first call signs in by itself; **Sign in again** and **Sign out** are there for demos.

## Safety

- Anything that can print or post mail or change live packs (commit, pack status update, framework submit, a whole submission) asks for confirmation on the page, and the server refuses it without one.
- The password and the token stay on the server. The request echo shows `********` for passwords and a shortened bearer token; tokens in responses are hidden.
- Use a test account for demos: a committed job is real in H-POD.

## Code

- `ingest/src/hpod/client.ts`: the fetch-based client (token handling, one re-sign-in on 401, throttling and timeout errors, request echo).
- `ingest/src/hpod/submit.ts`: init, parts and commit for one document.
- `api/src/hpod/operations.ts`: the 23 operations (paths, parameters, sample bodies, which are "live").
- `api/src/hpod/service.ts`, `routes.ts`: the session held on the server and the routes (see `api/README.md`).
- `web/src/pages/HpodPage.tsx` and `web/src/pages/hpod/`.
- `api/src/stubHpod.ts`: a pretend H-POD for the stub server.

## Not known / to check against the real service

- The shape of `GET /print/configuration`: the Submit tab matches its lists by name (paper, envelope, ink, duplex, pack mode, delivery) and falls back to typing GUIDs when a list is not found.
- Whether the OpenID Connect provider calls need a token (they are sent without one except user info).
- The pack status values are sent as the API documents them (`printed`, `rejected`, `posted`, `delivered`, `returned`, `userActionRequired`, `failed`, `confirmedDownloadedForPrinting`).
