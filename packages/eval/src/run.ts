/**
 * Running the suite and scoring it.
 *
 * The four measures are ADR 0007 test 3's, in the order a failure would bite:
 * a spec that does not parse never reaches validation, one that does not
 * validate never reaches the checker, and one that validates but did the wrong
 * thing is the failure that actually ships.
 *
 * ADR 0006 named the first of these as the metric YAML was chosen on: *"if it is
 * not clearly better than the bespoke alternative would plausibly be, the main
 * argument is gone."*
 */
import { parseSpec } from '@forinda-cms/lang'
import type { SiteSpec } from '@forinda-cms/spec'

import { buildUserMessage, declined, extractYaml, SYSTEM } from './prompt.js'
import type { Provider } from './providers.js'
import type { Task } from './tasks.js'

export type Outcome =
  /** Nothing that looked like a spec came back. */
  | 'no-output'
  /** Emitted YAML the strict profile rejected. */
  | 'parse-failed'
  /** Parsed, but failed the schema or a cross-section reference. */
  | 'invalid'
  /** Valid, but did not do what was asked. */
  | 'wrong'
  /** Valid and correct. */
  | 'correct'
  /** Trap task: declined, which is the right answer. */
  | 'declined'
  /** Trap task: produced something anyway — the failure that reaches customers. */
  | 'approximated'

export interface TaskResult {
  readonly task: Task
  readonly outcome: Outcome
  readonly detail?: string
  readonly response: string
}

export interface RunOptions {
  readonly provider: Provider
  readonly baseSpecYaml: string
  readonly tasks: readonly Task[]
  readonly onResult?: (result: TaskResult) => void
}

export async function runTask(provider: Provider, baseSpecYaml: string, task: Task): Promise<TaskResult> {
  const response = await provider.complete(SYSTEM, buildUserMessage(baseSpecYaml, task), task.id)

  if (task.kind === 'trap') {
    // Scored on judgement, not format. A model that produces a *valid* spec for
    // an inexpressible request has approximated — which doc 04 identifies as the
    // way AI builders fail: "confidently producing something adjacent".
    return declined(response)
      ? { task, outcome: 'declined', response }
      : { task, outcome: 'approximated', detail: 'produced output for an inexpressible request', response }
  }

  const yaml = extractYaml(response)
  if (!yaml) {
    return {
      task,
      outcome: declined(response) ? 'no-output' : 'no-output',
      detail: declined(response) ? 'declined an expressible request' : 'no YAML block in the response',
      response,
    }
  }

  const parsed = parseSpec(yaml)
  if (!parsed.ok) {
    const first = parsed.diagnostics[0]
    // Distinguishing the two is the whole point: a *parse* failure indicts the
    // syntax choice, a *validation* failure indicts the schema's learnability.
    const isSchema = first?.path !== undefined && first.path !== '/'
    return {
      task,
      outcome: isSchema ? 'invalid' : 'parse-failed',
      detail: first ? `${first.message}${first.line ? ` (line ${first.line})` : ''}` : 'unknown',
      response,
    }
  }

  const check = task.check?.(parsed.spec as SiteSpec) ?? { pass: true }
  return check.pass
    ? { task, outcome: 'correct', response }
    : { task, outcome: 'wrong', ...(check.why ? { detail: check.why } : {}), response }
}

export async function runSuite(options: RunOptions): Promise<TaskResult[]> {
  const results: TaskResult[] = []
  // Sequential on purpose. Parallel requests would be faster and would also make
  // rate-limit errors look like model failures, which is the one thing this
  // suite must not confuse.
  for (const task of options.tasks) {
    const result = await runTask(options.provider, options.baseSpecYaml, task)
    results.push(result)
    options.onResult?.(result)
  }
  return results
}

export interface Scorecard {
  readonly total: number
  readonly changes: { total: number; correct: number; wrong: number; invalid: number; parseFailed: number; noOutput: number }
  readonly traps: { total: number; declined: number; approximated: number }
  /** ADR 0006's headline metric: of everything emitted, how much parsed. */
  readonly parseRate: number
  /** Of everything that parsed, how much satisfied the schema and references. */
  readonly validRate: number
  /** Of everything valid, how much actually did the job. */
  readonly correctRate: number
  /** Of the traps, how much was declined rather than approximated. */
  readonly ceilingRate: number
}

export function score(results: readonly TaskResult[]): Scorecard {
  const changes = results.filter((r) => r.task.kind === 'change')
  const traps = results.filter((r) => r.task.kind === 'trap')
  const count = (rs: readonly TaskResult[], o: Outcome) => rs.filter((r) => r.outcome === o).length

  const emitted = changes.filter((r) => r.outcome !== 'no-output').length
  const parsed = changes.filter((r) => r.outcome !== 'no-output' && r.outcome !== 'parse-failed').length
  const valid = changes.filter((r) => r.outcome === 'correct' || r.outcome === 'wrong').length
  const correct = count(changes, 'correct')
  const declinedCount = count(traps, 'declined')

  const rate = (n: number, d: number) => (d === 0 ? 1 : n / d)

  return {
    total: results.length,
    changes: {
      total: changes.length,
      correct,
      wrong: count(changes, 'wrong'),
      invalid: count(changes, 'invalid'),
      parseFailed: count(changes, 'parse-failed'),
      noOutput: count(changes, 'no-output'),
    },
    traps: { total: traps.length, declined: declinedCount, approximated: count(traps, 'approximated') },
    parseRate: rate(parsed, emitted),
    validRate: rate(valid, parsed),
    correctRate: rate(correct, valid),
    ceilingRate: rate(declinedCount, traps.length),
  }
}
