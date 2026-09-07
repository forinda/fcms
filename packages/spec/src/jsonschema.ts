/**
 * JSON Schema generation.
 *
 * ADR 0006 promised this and made a cost argument out of it: YAML was chosen
 * partly because *"generate JSON Schema from `packages/spec` in CI; the existing
 * YAML language server gives autocomplete, inline validation and hover docs"* —
 * which discharges most of the editor-support cost of having human authors
 * without writing an LSP.
 *
 * The same artifact is what an AI harness should be handed to author a spec, so
 * one generator serves both audiences. That is the doc 04 pattern again: one
 * governed surface, many doors.
 */
import { z } from 'zod'

import { SiteSpec } from './site.js'

/**
 * `io: 'input'` matters. Several fields carry `.default()`, so the *output* type
 * has them required while the *input* type — what an author or a model actually
 * writes — does not. Emitting the output schema would reject valid specs for
 * omitting fields the platform fills in.
 */
export function siteSpecJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(SiteSpec, {
    io: 'input',
    unrepresentable: 'any',
    $refStrategy: 'none',
  } as Parameters<typeof z.toJSONSchema>[1]) as Record<string, unknown>
}
