# IntelliDoc (web rebuild)

- `docs/design_notes.md` - design decisions and business rules
- `db/intellidoc_core_schema.sql` - T-SQL schema (schema `idoc`)
- `ingest/` - H-POD v6 ingest service and folder watcher (TypeScript); see its README
- `api/` - web API (Fastify + SQL Server); see its README
- `web/` - web app (React + Mantine); see its README
- `deploy/` - installs the API and the folder watcher as Windows services; see `docs/deployment.md`

Real customer XML/PDF files must never be committed (see `.gitignore`).
