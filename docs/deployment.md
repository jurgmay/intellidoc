# Running IntelliDoc on the server

Two programs run all the time, each as a Windows service:

| Service | What it does | Folder |
|---|---|---|
| **IntelliDocApi** | The web app and its API. It serves the built web app (`web/dist`) and `/api` on `API_PORT` (3001), bound to `127.0.0.1` unless `API_HOST` says otherwise. | `api` |
| **IntelliDocWatcher** | The folder watcher: imports XML and PDF files, makes print files, sends alerts, records Activity. | `ingest` |

Both start when the server boots and read their settings from the `.env` file in their own folder.

## One-time set-up

Do this on the server, in an Administrator terminal.

1. Install **Node 22** (20.6 or newer is needed) and **Ghostscript** (set `GS_PATH` in both `.env` files if `gswin64c` is not on the PATH). Install git and clone the repository.
2. In each of `api`, `ingest`, `web` and `deploy`: `npm install`.
3. Build the web app: in `web`, `npm run build` (creates `web/dist`, which the API serves).
4. Create the database (`db/intellidoc_core_schema.sql`, then the reference import) and copy `api/.env.example` to `api/.env` and the matching file to `ingest/.env`, then fill them in: `INTELLIDOC_DB`, `INTELLIDOC_SECRET_KEY`, `WATCH_DIR`, `COMPOSE_OUT_DIR`, `MRDF_OUT_DIR`, the mail server, and the Entra sign-in values (`docs/auth.md`).
5. In `deploy`: `node service.mjs print` shows what will be installed, then `npm run install-services`. It checks that the `.env` files, `web/dist` and `tsx` are there first, installs both services (start: automatic), sets Windows to restart them a minute after any failure, and starts them.

Put IIS or nginx in front for https (see `docs/auth.md`), forwarding to `127.0.0.1:3001`.

### Which account the services run as
New services run as **Local System**, which cannot see mapped drives or most network shares. If `WATCH_DIR`, `COMPOSE_OUT_DIR` or `MRDF_OUT_DIR` are on another machine, open **Services > IntelliDoc ... > Log On** and choose an account that can read and write those shares (use UNC paths, `\\server\share`, not drive letters), then restart the service. The same account needs to read the program folders and write `deploy\services`.

## Day to day

From `deploy` (Administrator terminal), `npm run start-services`, `stop-services`, `restart-services`, or add `-- api` / `-- watcher` for one service. The normal Services app works too.

- **Logs** are in `deploy\services\daemon`: `*.out.log` (what the program prints) and `*.err.log`, rolled automatically. The watcher's log lines are the same ones you see with `npm run watch`.
- **Updating**: stop both services, `git pull`, `npm install` where `package.json` changed, `npm run build` in `web`, then start them. Run any database change listed in the release notes first.
- **Changing a service's options**: `npm run uninstall-services` then `npm run install-services`. Changes to `.env` only need a restart.
- **Stopping**: Windows cannot ask a program to finish its current file, so stopping the watcher part-way through an import or compose ends it immediately. The task is marked Abandoned the next time the watcher starts and is picked up again. Where you can, stop when the Activity screen shows nothing running.
- If the database is not reachable when the server boots (for example SQL Server is still starting), the programs stop and Windows starts them again a minute later until it is.

## Not done by the service
Backups, the https certificate, firewall rules and Entra app registration are set up separately.
