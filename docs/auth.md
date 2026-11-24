# Sign-in (Microsoft Entra ID)

Staff sign in with their Microsoft work account. IntelliDoc stores no passwords. The API does the sign-in (OpenID Connect, authorisation code with PKCE), checks the ID token against Entra's published keys and puts the person in a signed, HTTP-only cookie (`idoc_session`, 8 hours by default). There is no session table to maintain; a restart of the API does not sign anyone out. Changing `SESSION_SECRET` signs everyone out.

## Roles

Roles come from the app roles you define on the Entra app registration. They arrive in the ID token's `roles` claim.

| Role | Can |
|---|---|
| `User` | Everything except the rows below |
| `Admin` | Everything (it includes `User`) |

Admin-only: all of Settings (`/api/settings`), reference data (`/api/reference`), re-pricing (`/api/reprice`), the margin report (`/api/reports/margin` and its PDF), and **changes** to costing (`/api/costing`) and postal prices (`/api/postal`); the web app hides Settings and the margin report from other people. A signed-in person with no role gets a "no access" page, and the API answers 403. The list is `ADMIN_ONLY` in `api/src/auth/access.ts` and is easy to change.

## Registering the app in Entra

1. **Entra admin centre > App registrations > New registration.** Name: `IntelliDoc`. Supported account types: *this organisational directory only*. Redirect URI (type *Web*): `https://<your address>/api/auth/callback`.
2. **Authentication:** add a second redirect URI for sign-out: `https://<your address>/signed-out` (front-channel logout URL is not needed).
3. **Certificates & secrets > New client secret.** Copy the *value* now (it is shown once). Put a reminder in the calendar for its expiry; sign-in stops working when it expires.
4. **App roles > Create app role**, twice: display name `User`, value `User`, allowed member types *Users/Groups*; and display name `Administrator`, value `Admin`.
5. **Enterprise applications > IntelliDoc > Properties:** set *Assignment required* to **Yes**, so only people you assign can sign in at all. Then **Users and groups > Add user/group** and give each person or group a role. Assigning a group is easiest.
6. From the **Overview** page take the *Directory (tenant) ID* and *Application (client) ID*.

Roles are used rather than group membership because a person in many groups does not get a group list in the token at all (Entra's "overage"), whereas app roles always arrive.

## Settings (`api/.env`)

```
ENTRA_TENANT_ID=<directory id>
ENTRA_CLIENT_ID=<application id>
ENTRA_CLIENT_SECRET=<secret value>
AUTH_PUBLIC_URL=https://intellidoc.example.com      # what people type; no trailing slash; https
SESSION_SECRET=<32+ characters>                      # openssl rand -base64 48
SESSION_HOURS=8                                      # optional
```

The API will not start if any of these is missing. `AUTH_PUBLIC_URL` must be https (except `http://localhost`), because the cookie is marked `Secure` and Entra only allows http redirects to localhost.

## Behind a proxy

Serve the site and `/api` from the same address, over https, for example IIS or nginx forwarding to `127.0.0.1:3001`. Entra sends the browser to `AUTH_PUBLIC_URL`, not to the API's own address. Writes (anything but GET) that carry an `Origin` different from `AUTH_PUBLIC_URL` are refused, as a second defence on top of `SameSite=Lax` cookies. Sign-out is a POST.

## Development

- `AUTH_MODE=off` (and `npm run dev:stub`): no sign-in; everyone is `dev@localhost` with the `Admin` role. It is refused when `NODE_ENV=production` or `API_HOST` is not `127.0.0.1`/`localhost`.
- To try the real sign-in on your own machine, add `http://localhost:5173/api/auth/callback` as a second redirect URI, set `AUTH_PUBLIC_URL=http://localhost:5173` and leave `AUTH_MODE` unset (the Vite dev server proxies `/api`).

## Who is recorded

`userOf(req)` gives the signed-in person's e-mail address (or name) for the audit log (`idoc.audit_log.changed_by`). Each mailpiece audit report is logged there too (entity `audit report`, the account, the number of mailpieces and the search terms), because it holds personal data. The batch events table's `recorded_by` is not set from the web app yet (batches are changed by the watcher and print tools).
