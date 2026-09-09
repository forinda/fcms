# How it works

For people who need to know what the database is doing, what a query costs, and
where to look when something is wrong. The [guide](GUIDE.md) is how to build a
site; this is what happens when you do.

## One table for all content

Every entry of every type on every site is a row in `entries`, with the
author-defined fields in one `jsonb` column:

```
entries
  id          uuid          uuidv7, so ids sort by creation time
  org_id      text          ─┬─ every query is scoped by both, always
  site_id     text          ─┘
  type_key    text          "property", "booking"
  slug        text          the address, unique per (site, type)
  status      text          draft | published
  data        jsonb         everything the spec declared
  visitor_id  uuid          who submitted it, when a visitor did
  created_at  timestamptz
  updated_at  timestamptz
```

The alternative was a table per content type, created and altered as authors
edit their spec. That means DDL on a live database driven by a text field in a
form, and a migration story for shapes nobody has seen yet. `jsonb` moves that
cost to read time, where it can be indexed, and to validation, where it can be
refused.

**The price of it:** Postgres enforces nothing inside `data`. A wrong write is a
permanently wrong row, so every write goes through `validateEntry` — in the
use-case, not in a controller, so an API, the admin, the CLI, MCP and the AI
cannot each forget it differently.

The rest of the schema is ordinary tables, because the rest of the schema is
ours rather than the author's: `sites`, `organizations`, `owners`,
`owner_sessions`, `login_attempts`, `visitors`, `visitor_sessions`,
`visitor_saves`, `site_specs`, `spec_patches`, `assets`, `payments`,
`workflow_runs`, `flow_sessions`.

## What `filterable: true` compiles to

A **partial expression index**, one per site, type and field:

```sql
CREATE INDEX ix_e_<hash> ON entries (((data ->> 'price')::numeric))
WHERE site_id = 's1' AND type_key = 'property'
```

Three things about that statement are load-bearing:

- **Partial.** The predicate scopes it to one site and one type, so N sites do
  not share one index, and one site's data cannot bloat another's.
- **An expression, not a column.** The original design said generated columns.
  That does not survive a shared table: a generated column is a table-wide
  change driven by one site's spec, and two sites whose `price` is a number in
  one and text in the other cannot both be satisfied. N sites × M fields is also
  N×M columns, almost all null.
- **Cast on purpose.** `->>` always yields text, so `10` sorts before `9`
  without one. Dates are deliberately left as text: `::timestamptz` is not
  `IMMUTABLE`, Postgres refuses it in an index expression, and ISO-8601 sorts
  lexicographically in the same order it sorts chronologically. That holds only
  while values share a format and offset, which is why timestamps are
  normalised to UTC on write.

**The query has to use the same expression the index was built on.** Both are
generated from the same field definition, which is what keeps them in step.

`unique: true` compiles to the same thing with `UNIQUE` in it, under a different
name, so a field can be both indexed and unique without the two colliding.

### Indexes are reconciled, not diffed

What should exist is a function of the current spec, so it is computed from the
spec rather than from a diff, on every apply. Anything a diff could not see —
a field that was already `unique` before uniqueness was enforced — is repaired
rather than missed forever. It is idempotent, so it stays out of the plan: the
plan is what a person agrees to, and "the indexes still match" is not a
decision anybody makes.

Ownership is the predicate, not the name. Every index we write is scoped
`WHERE site_id = '…'`, so reconciliation can never drop another site's.

## What a page's `data` block compiles to

Not SQL, mostly. A query reads rows through an `EntrySource`, and filtering,
sorting, facet counting and paging happen above it:

```yaml
data:
  from: property
  where:
    - { field: stars, op: gte, value: { param: stars } }
  sort: { param: sort, allow: [score, priceFrom], default: score, dir: desc }
  limit: 25
```

- **`limit` is mandatory and capped at 100.** An unbounded query is a
  performance bug the owner cannot see: the page just gets slower as their
  business grows, which is the worst possible time for it to happen.
- **An absent parameter drops its condition.** A search page has to work before
  anything is typed. The exception is `{ entry: … }` — "the rooms of *this*
  property" with no property is zero rooms, never every room on the site.
- **Facets count with their own filter excluded**, so ticking "4 stars" does not
  make every other rating read zero.

Three field types are computed on read and never stored, so nothing writes them
and no index over them would enforce anything:

| | |
|---|---|
| `aggregate` | `count`, `avg`, `sum`, `min`, `max` over rows of another type that reference this one |
| `computed` | a declared formula — six operations, and one hop across a reference |
| derived types | `schedule` and `stay`: availability, computed from bookings and hours |

## Two forms of a reference

A `reference` field holds either the row's id or `ref:<type>/<slug>`. The admin
writes the first, an authored file writes the second, and **both must match
everywhere** — a filter and an aggregate that disagree make one relationship
into two, depending on which part of the page is asking.

## Time belongs to the database

`now()`, not `new Date()`. Two processes on two machines disagree about what
time it is, and a queue that reads its own clock runs jobs early. This was a CI
failure before it was a rule: `runAt` is stamped by the database on insert, so
comparing it against a `Date` from the application means two clocks decide
whether a run is due.

The embedded database is the exception that proves it: it runs *in* the
application process, so there is one clock and skew cannot occur.

## The queue

`workflow_runs` is a table used as a queue, claimed with `FOR UPDATE SKIP
LOCKED` so two runners take different rows and neither waits. No broker, because
a broker is a second thing to install and the whole product fits in one process.

Under the embedded database there is one writer, so nothing can be claimed
twice and the lock is redundant rather than missing.

## Every change is a patch with an inverse

`spec_patches` holds what changed, who changed it, which surface it came
through, and how to undo it. That is why undo is a table lookup rather than a
git operation, and why the destructive warning — "340 customers will lose this
field" — is the same sentence in the admin, the CLI and an agent's tool call.

A migration step is classified before anything runs: **additive** applies on its
own, **destructive** needs an explicit yes. A field becoming `unique` on a type
that already has rows is destructive, because it can fail on data somebody
already has.

## Two databases, one dialect

`DATABASE_URL` is a `postgres://` URL or a directory. A directory means Postgres
runs inside the Node process (WebAssembly), with nothing to install. Same
dialect, same schema, same migrations — moving between them is `pg_dump` and one
variable.

The embedded database is one connection **and one process**. A second process on
the same directory corrupts it permanently, so opening one takes a lock with a
real pid in it and refuses rather than allows.

## Where to look when something is wrong

| Symptom | Where |
|---|---|
| A filter is slow | Is the field `filterable`? Check `pg_indexes` for `ix_e_%` and compare the index expression to the query's. |
| A filter matches nothing | A reference written one way and compared the other, or a parameter that is absent and silently dropped its condition. |
| An aggregate reads empty | The `on` field must be a `reference` on the other type pointing back at this one. Both forms of a reference count. |
| A price is null | A formula returns null rather than zero when anything in it is unknown — a missing reference, a missing number. Zero would be a claim. |
| A job ran early | Something compared the application's clock to `runAt`. |
| The site is slow under load | The embedded database serves one query at a time. Move to a server. |
