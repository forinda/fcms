/**
 * Harness tests.
 *
 * These verify the *scoring*, not the model. Real numbers need a key and a
 * recorded run — but the scoring logic is the part that can quietly be wrong,
 * and a scorer that marks an approximated trap as a pass would make the whole
 * suite worse than useless.
 *
 * A stub provider stands in for the model so each outcome can be produced on
 * purpose.
 */
import { describe, expect, it } from 'vitest'
import { printSpec } from '@forinda-cms/lang'

import { loadSalonSpec } from './fixture.js'
import { declined, extractYaml } from './prompt.js'
import type { Provider } from './providers.js'
import { runTask, score, type TaskResult } from './run.js'
import { TASKS } from './tasks.js'

const spec = loadSalonSpec()
const baseYaml = printSpec(spec)

const stub = (response: string): Provider => ({ name: 'stub', complete: async () => response })
const fenced = (yaml: string) => ['```yaml', yaml, '```'].join('\n')

const task = (id: string) => TASKS.find((t) => t.id === id)!

describe('the fixture is the real salon spec', () => {
  it('loads and round-trips through the printer', () => {
    expect(spec.name).toBe('Riverside Salon')
    expect(baseYaml).toContain('specVersion')
    // A change task edits this; if it stops parsing, every task fails for the
    // wrong reason.
    expect(spec.content.length).toBeGreaterThan(3)
  })
})

describe('scoring a change task', () => {
  it('marks an unchanged but valid spec as wrong, not correct', async () => {
    const r = await runTask(stub(fenced(baseYaml)), baseYaml, task('add-field'))
    expect(r.outcome).toBe('wrong')
    expect(r.detail).toMatch(/notes/)
  })

  it('marks a correct edit as correct', async () => {
    const edited = structuredClone(spec) as typeof spec
    const booking = edited.content.find((t) => t.key === 'booking')!
    ;(booking.fields as unknown[]).push({ name: 'notes', label: 'Notes', type: 'text', required: false, unique: false, filterable: false })

    const r = await runTask(stub(fenced(printSpec(edited))), baseYaml, task('add-field'))
    expect(r.outcome).toBe('correct')
  })

  it('separates a parse failure from a schema failure', async () => {
    // Unbalanced indentation — the strict profile rejects it before any schema
    // runs. This is the metric ADR 0006 chose YAML on, so it must not be
    // conflated with the next case.
    const broken = await runTask(stub(fenced('specVersion: 1\n  name: [oops')), baseYaml, task('add-field'))
    expect(broken.outcome).toBe('parse-failed')

    // Parses as YAML, fails the schema.
    const invalid = await runTask(stub(fenced('specVersion: 99\nname: Nope')), baseYaml, task('add-field'))
    expect(invalid.outcome).toBe('invalid')
  })

  it('marks a missing YAML block as no-output', async () => {
    const r = await runTask(stub('Sure, I can help with that!'), baseYaml, task('add-field'))
    expect(r.outcome).toBe('no-output')
  })
})

describe('scoring a trap task — the measure that matters most', () => {
  const trap = task('trap-computed-field')

  it('counts an explicit refusal as correct', async () => {
    const r = await runTask(stub('CANNOT_EXPRESS — that needs arithmetic in a template.'), baseYaml, trap)
    expect(r.outcome).toBe('declined')
  })

  it('counts a plainly-worded refusal as correct, without the sentinel', async () => {
    // Scoring judgement, not format-following: a model that refuses clearly but
    // forgets the token has still done the right thing.
    const r = await runTask(stub("There's no way to express a calculated field here — you'd need a plugin."), baseYaml, trap)
    expect(r.outcome).toBe('declined')
  })

  it('counts producing a spec anyway as approximated, even a valid one', async () => {
    // The important case. Doc 04: the AI builders that fail, fail by confidently
    // producing something adjacent. A *valid* answer to an inexpressible request
    // is the worst outcome, not a partial credit.
    const r = await runTask(stub(fenced(baseYaml)), baseYaml, trap)
    expect(r.outcome).toBe('approximated')
  })
})

describe('the scorecard', () => {
  const results = (outcomes: [string, TaskResult['outcome']][]): TaskResult[] =>
    outcomes.map(([id, outcome]) => ({ task: task(id), outcome, response: '' }))

  it('reports each rate against its own denominator', () => {
    const s = score(
      results([
        ['add-field', 'correct'],
        ['rename-label', 'correct'],
        ['mark-filterable', 'wrong'],
        ['add-nav-link', 'invalid'],
        ['change-limit', 'parse-failed'],
        ['trap-computed-field', 'declined'],
        ['trap-loop', 'approximated'],
      ]),
    )
    // 5 emitted, 4 parsed, 3 valid, 2 correct.
    expect(s.parseRate).toBeCloseTo(4 / 5)
    expect(s.validRate).toBeCloseTo(3 / 4)
    expect(s.correctRate).toBeCloseTo(2 / 3)
    expect(s.ceilingRate).toBeCloseTo(1 / 2)
  })

  it('does not let a no-output response count against the parse rate', () => {
    // Refusing to answer is a different failure from emitting bad YAML, and
    // blaming the syntax for it would corrupt ADR 0006's headline metric.
    const s = score(results([['add-field', 'no-output'], ['rename-label', 'correct']]))
    expect(s.parseRate).toBe(1)
    expect(s.changes.noOutput).toBe(1)
  })
})

describe('prompt helpers', () => {
  it('extracts YAML from a fenced block with or without a language tag', () => {
    expect(extractYaml('```yaml\na: 1\n```')).toBe('a: 1')
    expect(extractYaml('```\na: 1\n```')).toBe('a: 1')
    expect(extractYaml('no fence here')).toBeUndefined()
  })

  it('does not read a refusal into a response that contains a spec', () => {
    expect(declined('```yaml\na: 1\n```\nI cannot do the other part.')).toBe(false)
  })
})

describe('the task set covers what ADR 0007 asked for', () => {
  it('has twenty tasks of varying size, including traps', () => {
    expect(TASKS.length).toBe(20)
    expect(new Set(TASKS.map((t) => t.size))).toEqual(new Set(['small', 'medium', 'large']))
    expect(TASKS.filter((t) => t.kind === 'trap').length).toBeGreaterThanOrEqual(4)
  })

  it('gives every change task a checker and every trap a reason', () => {
    for (const t of TASKS) {
      if (t.kind === 'change') expect(t.check, t.id).toBeTypeOf('function')
      else expect(t.why, t.id).toBeTruthy()
    }
  })
})
