/**
 * The whole spec document.
 *
 * ADR 0006 derives a multi-file layout from this (`site.yaml`, `content/*.yaml`,
 * `pages/*.yaml`, `logic/*.yaml`) — but the layout is a *projection*, computed
 * deterministically from the AST so `pull` is a pure function and no file
 * provenance needs storing. In memory it is one object.
 */
import { z } from 'zod'

import { Access } from './access.js'
import { ContentType } from './content.js'
import { Workflow } from './logic.js'
import { Page } from './pages.js'
import { Key, Label } from './primitives.js'
import { CustomCss, Theme } from './style.js'
import { Wiring } from './wiring.js'

/**
 * Internal, not user-facing, and not the plugin API integer (ADR 0003/0012).
 * A `specVersion` bump is a data migration; an `api` bump is an ecosystem event.
 */
export const SPEC_VERSION = 1

export const SiteSpec = z
  .object({
    specVersion: z.literal(SPEC_VERSION),
    name: Label,
    /** Site-level tier-3 CSS. Gated to the `developer` role (ADR 0004/0008). */
    css: CustomCss.optional(),
    theme: Theme,
    content: z.array(ContentType),
    pages: z.array(Page),
    logic: z.array(Workflow).default([]),
    access: Access.default({}),
    wiring: Wiring.default([]),
  })
  .strict()

export type SiteSpec = z.infer<typeof SiteSpec>

/**
 * Cross-section checks Zod cannot express, because they need the whole document.
 *
 * These are the errors that would otherwise reach a customer as a blank section
 * or a 500 — a query against a type nobody declared, a page bound to a missing
 * collection, a workflow watching a type that was renamed. Catching them in
 * `validate` is most of what makes the language safe to hand to a model.
 */
export interface SpecIssue {
  readonly path: string
  readonly message: string
}

export function checkReferences(spec: SiteSpec): SpecIssue[] {
  const issues: SpecIssue[] = []
  const types = new Map(spec.content.map((t) => [t.key, t]))

  const seen = <T extends { key: string }>(items: readonly T[], where: string) => {
    const keys = items.map((i) => i.key)
    for (const dup of new Set(keys.filter((k, i) => keys.indexOf(k) !== i))) {
      issues.push({ path: where, message: `duplicate key "${dup}"` })
    }
  }
  seen(spec.content, '/content')
  seen(spec.pages, '/pages')
  seen(spec.logic, '/logic')

  const paths = spec.pages.map((p) => p.path)
  for (const dup of new Set(paths.filter((p, i) => paths.indexOf(p) !== i))) {
    issues.push({ path: '/pages', message: `two pages both answer "${dup}"` })
  }

  // `reference` fields must point at a declared type.
  for (const t of types.values()) {
    for (const f of t.fields) {
      if ('to' in f && typeof f.to === 'string' && !types.has(f.to)) {
        issues.push({
          path: `/content/${t.key}/fields/${f.name}`,
          message: `references unknown content type "${f.to}"`,
        })
      }
    }
  }

  // Every `data.from` in every block of every page, at any depth.
  const walk = (blocks: readonly import('./pages.js').Block[], at: string) => {
    blocks.forEach((b, i) => {
      const here = `${at}/${i}`
      if (b.data && !types.has(b.data.from)) {
        issues.push({ path: `${here}/data`, message: `queries unknown content type "${b.data.from}"` })
      }
      if (b.data?.sort) {
        const t = types.get(b.data.from)
        if (t && !t.fields.some((f) => f.name === b.data!.sort!.field)) {
          issues.push({
            path: `${here}/data/sort`,
            message: `sorts by "${b.data.sort.field}", which "${b.data.from}" does not have`,
          })
        }
      }
      if (b.item) walk(b.item, `${here}/item`)
      if (b.children) walk(b.children, `${here}/children`)
    })
  }

  for (const p of spec.pages) {
    walk(p.blocks, `/pages/${p.key}/blocks`)
    if (p.collection && !types.has(p.collection)) {
      issues.push({ path: `/pages/${p.key}`, message: `bound to unknown collection "${p.collection}"` })
    }
    for (const f of p.flows ?? []) {
      f.steps.forEach((s, i) => walk(s.blocks, `/pages/${p.key}/flows/${f.key}/steps/${i}/blocks`))
    }
  }

  // Workflows watching a type, and transition triggers naming a real state.
  for (const w of spec.logic) {
    const t = 'type' in w.trigger ? w.trigger.type : undefined
    if (t && !types.has(t)) {
      issues.push({ path: `/logic/${w.key}/trigger`, message: `watches unknown content type "${t}"` })
    }
    if (w.trigger.on === 'entry.transitioned' && w.trigger.to && t) {
      const state = types.get(t)?.fields.find((f) => f.type === 'state')
      if (state && 'values' in state && !state.values.includes(w.trigger.to)) {
        issues.push({
          path: `/logic/${w.key}/trigger`,
          message: `waits for state "${w.trigger.to}", which "${t}" does not declare`,
        })
      }
    }
  }

  // Access rules for types that no longer exist — usually a rename left behind.
  for (const key of Object.keys(spec.access.types ?? {})) {
    if (!types.has(key)) {
      issues.push({ path: `/access/types/${key}`, message: `grants access to unknown content type "${key}"` })
    }
  }

  return issues
}
