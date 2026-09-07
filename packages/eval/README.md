# @forinda-cms/eval

**ADR 0007 test 3** — can a model author this language correctly?

ADR 0006 chose a strict YAML profile primarily because *the model is a
first-class author of this language* and YAML has more training data behind it
than any alternative. That is a claim about model output validity, and the ADR
said to measure it: *"if it is not clearly better than the bespoke alternative
would plausibly be, the main argument is gone."*

This measures it.

## Running it

```bash
pnpm eval                  # replay recorded responses — no key, no cost
pnpm eval:record           # call the model for real and save the responses
pnpm eval --only trap      # just the ceiling tests
pnpm eval:record --model claude-sonnet-5
```

**Replay is the default deliberately.** An eval that needs a paid API call on
every CI run is an eval nobody runs, so recording is an explicit act. It also
keeps the suite consistent with doc 13: the platform must stay usable at zero AI
spend, and a test suite that could not run without a key would be the first
thing to break that rule.

Credentials come from `ANTHROPIC_API_KEY` or an `ant auth login` profile.

## What it measures

Four rates, in the order a failure bites — a spec that does not parse never
reaches validation, one that does not validate never reaches the checker, and
one that validates but did the wrong thing is the failure that actually ships.

| Rate | Of | Indicts |
|---|---|---|
| **parses** | everything emitted | the syntax choice (ADR 0006's headline metric) |
| **validates** | everything that parsed | how learnable the schema is |
| **correct** | everything valid | whether the language is obvious, not just expressible |
| **respects ceiling** | the trap tasks | whether the model approximates when cornered |

## The traps matter most

Four of the twenty tasks ask for something A2 cannot express — a computed field,
a compound condition, a nested loop, inline JavaScript. **The correct answer is
to say so.**

A model that scores well on edits and invents an expression when cornered is
worse than one that scores slightly lower and declines, because the first kind
of failure reaches a customer. Doc 04 puts it plainly: *the AI builders that
fail, fail by confidently producing something adjacent.* So a valid spec
produced for an inexpressible request scores as **approximated**, not as partial
credit, and it is the only outcome that makes the suite exit non-zero.

## What it edits

The real `examples/salon` spec, not a synthetic fixture. That spec is ADR 0007
test 1's artifact — a business someone could actually run — so the numbers mean
something about real use. A minimal hand-tuned spec would flatter them.

## Reading the result

The report names ADR 0006's trigger conditions, so nobody has to look them up:
below 90% parse rate, below 80% valid, below 80% correct, or any approximated
trap. **Two or more, and ADR 0006 says spike the bespoke grammar** — the AST does
not move, so that is a parser/printer pair, which is exactly the escape hatch the
syntax decision preserved.

## It becomes two other things

Neither needs building separately:

- **A conformance suite for pluggable harnesses** (doc 11 §3). The same tasks
  run against any harness, which is the basis for saying one is certified.
- **The seed of the eval set** doc 04 calls the compounding moat — the log of
  *(prompt, spec state) → accepted patch* is harness-agnostic by construction.

## Status

The harness is complete and tested. **The numbers are not in yet** — producing
them needs an API key and a recorded run, which is a decision with a cost
attached rather than something to do silently.
