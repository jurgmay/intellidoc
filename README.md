# IntelliDoc (web rebuild)

- `docs/design_notes.md` - design decisions and business rules
- `db/intellidoc_core_schema.sql` - T-SQL schema (schema `idoc`)
- `ingest/` - H-POD v6 ingest service (TypeScript); see its README

Real customer XML/PDF files must never be committed (see `.gitignore`).
