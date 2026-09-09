# Stays — a marketplace, as a directory of YAML

The third reference site, and the largest. `salon` is the appointment shape and
`rooms` is one guesthouse; this is the **marketplace** shape — many properties,
search with counted filters, and a booking journey.

Twelve properties across five cities, twenty-five rooms, forty-two reviews.

```sh
npx fcms dev examples/stays        # localhost:4321, no server, no database
```

## What it is here to prove

| | |
|---|---|
| **Counted filters** | every option carries how many properties it would leave, counted with its own filter lifted |
| **Numbers nobody types** | guest score, review count and "from" price are aggregates over reviews and rooms |
| **Availability** | `vacancy` is derived: the rooms free for every night between two dates, computed from bookings and never stored |
| **A price the guest cannot choose** | the deposit is a computed field — the room's rate times the nights — and the schema refuses it as input |
| **A journey** | dates and a room in one step, details in the next; the room chosen is the room charged for |
| **Their own bookings** | a guest sees theirs and nobody else's |

## Why it exists

Building it is what found the bugs. Sixteen of them, none of which would have
surfaced from inside this repository — validation errors that never reached a
self-hosted caller, a content round-trip that unpublished a whole site,
aggregates that never matched a reference written the documented way, two
processes corrupting an embedded database, a booking journey that could not
filter and then choose.

Every one of those is fixed, and every fix has a test that fails against the
commit before it. That is what this directory is for: a site large enough to
disagree with the platform.

## What it does not have yet

- **Photos.** Media works; these properties have none, so the cards are text.
- **A first step that only collects dates.** A flow step is answered by choosing
  a row, so "when are you coming?" cannot be a step of its own — the dates sit
  in the same step as the rooms they filter.
- Search by map, currency per property, cancellation policies as data.
