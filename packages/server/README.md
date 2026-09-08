# @forinda/fcms-core

Run a site. Needs Node 22+ and a Postgres URL — no Docker.

```sh
DATABASE_URL=postgres://user:pass@localhost:5432/forinda \
OWNER_EMAIL=you@example.com OWNER_PASSWORD=a-long-enough-password \
npx @forinda/fcms-core
```

It migrates the database on boot, creates the first owner once, and serves on
`PORT` (8080 by default). `npx @forinda/fcms-core --help` lists everything it reads.

What this does not bring, because Docker Compose was what brought it: a
database, TLS, or a backup script. Put a reverse proxy in front for HTTPS
(`SECURE_COOKIES=true`, `TRUST_PROXY=true`), point `MEDIA_DIR` at a directory
that survives a redeploy, and take your own `pg_dump` backups.
