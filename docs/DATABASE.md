# Database And Storage Setup

No Supabase account or external database is required for the selected local configuration.

1. Set `DATA_DIR` identically for the web process and worker; default `./data` is relative to the application directory.
2. Run `npm run dev`, or `npm run build` followed by `npm start`.
3. The directory, original-file folder, SQLite database, tables, indexes, and triggers are created automatically.

Layout:

```text
data/
  contracts.sqlite
  contracts.sqlite-wal
  contracts.sqlite-shm
  files/
    <document-uuid>
```

Tables:

- `documents`: content hash, original name/type, processing state/error, lease/attempts/progress, extracted text, and page/paragraph metadata.
- `chunks`: source document, stable row identifier, source section, absolute start/end positions, and bounded passage text.
- `chunk_search`: FTS5 text index maintained by insertion/deletion triggers.
- `messages`: conversation key (sorted selected UUIDs), role, content, status, verified citations, research activity, retrieval coverage, and timestamp.

WAL mode, a busy timeout, and short transactions allow the worker and web process to share the database. Foreign keys cascade chunk deletion; document deletion also removes associated conversations and the original file. If upgrading from a development schema lacking chunk ranges, delete and reupload those development documents so their chunks receive actual ranges.

For a consistent backup, stop web and worker, then back up the entire data directory. Do not copy only a live SQLite main file while ignoring its WAL. Restore the complete directory and restart both processes. Never commit this directory or real contracts.

On hosted infrastructure, mount a persistent volume at `/app/data` and set `DATA_DIR=/app/data`. Do not run multiple replicas with independent local disks. Job records survive restarts; an interrupted lease becomes eligible after twenty minutes. Failed jobs are visible in the library; delete and reupload a corrected file to retry.