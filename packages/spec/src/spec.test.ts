/**
 * The checks that fail if the ceiling slips.
 *
 * Most of these are not testing Zod — they are testing ADR 0001 and ADR 0009.
 * If one of them starts failing because someone "made the language more
 * flexible", that is the signal doc 12 warned about: the ceiling being lost by
 * increments rather than by decision.
 */
import { describe, expect, it } from 'vitest'

import { Condition } from './condition.js'
import { Integration } from './wiring.js'
import { Page, dataNestingDepth } from './pages.js'
import { StyleProps } from './style.js'
import { TemplateString, parseTemplate } from './primitives.js'
import { classify } from './patch.js'
import { validateSpec } from './index.js'

const theme = {
  colors: { brand: '#1a7f5a', surface: '#f5f5f4' },
  fonts: { body: 'Inter' },
  typeScale: { sm: '0.875rem', md: '1rem', lg: '1.5rem' },
}

/** A minimal but real spec: a service list bound to a declared type. */
const base = {
  specVersion: 1 as const,
  name: 'Test Salon',
  theme,
  content: [
    {
      key: 'service',
      label: 'Service',
      titleField: 'name',
      fields: [
        { name: 'name', label: 'Name', type: 'text' as const },
        { name: 'active', label: 'Active', type: 'boolean' as const, filterable: true },
      ],
    },
  ],
  pages: [
    {
      key: 'home',
      path: '/',
      title: 'Home',
      blocks: [
        {
          type: 'list',
          data: { from: 'service', where: [{ field: 'active', op: 'eq' as const, value: true }], limit: 12 },
          item: [{ type: 'card', attrs: { heading: '{{ item.name }}' } }],
        },
      ],
    },
  ],
}

describe('templates stay weak (ADR 0001)', () => {
  it('accepts property access and one formatter', () => {
    expect(parseTemplate('{{ item.name }} — {{ entry.price | currency }}')).toEqual([
      { path: 'item.name', raw: '{{ item.name }}' },
      { path: 'entry.price', formatter: 'currency', raw: '{{ entry.price | currency }}' },
    ])
  })

  it.each([
    ['{{ price * 2 }}', 'arithmetic'],
    ['{{ fn(x) }}', 'a call'],
    ['{{ a > b }}', 'a comparison'],
    ['{{ items[0] }}', 'dynamic lookup'],
  ])('rejects %s (%s)', (input) => {
    expect(TemplateString.safeParse(input).success).toBe(false)
  })

  it('rejects an unknown formatter rather than ignoring it', () => {
    expect(TemplateString.safeParse('{{ a.b | frobnicate }}').success).toBe(false)
  })
})

describe('conditions are structured, never expressions (ADR 0009)', () => {
  it('accepts the triple', () => {
    expect(Condition.safeParse({ field: 'item.price', op: 'gt', value: 100 }).success).toBe(true)
  })

  it('rejects an expression string in place of a triple', () => {
    expect(Condition.safeParse('item.price > 100').success).toBe(false)
  })

  it('rejects an unknown operator', () => {
    expect(Condition.safeParse({ field: 'a', op: 'matches', value: 'x' }).success).toBe(false)
  })

  it('requires a list for `in` and a scalar for the rest', () => {
    expect(Condition.safeParse({ field: 'a', op: 'in', value: 'x' }).success).toBe(false)
    expect(Condition.safeParse({ field: 'a', op: 'eq', value: ['x'] }).success).toBe(false)
    expect(Condition.safeParse({ field: 'a', op: 'in', value: ['x', 'y'] }).success).toBe(true)
  })
})

describe('tier 2 stays token-valued (ADR 0004)', () => {
  it('accepts token references and enums', () => {
    const r = StyleProps.safeParse({ padding: 'lg', background: 'token:color.surface', cols: { base: 1, md: 3 } })
    expect(r.success).toBe(true)
  })

  it.each([
    ['a raw colour', { background: '#ff0000' }],
    ['a px value', { padding: '24px' }],
    ['margin, which is excluded by name', { margin: 'lg' }],
    ['absolute positioning', { position: 'absolute' }],
  ])('rejects %s', (_label, props) => {
    expect(StyleProps.safeParse(props).success).toBe(false)
  })
})

describe('queries are bounded (ADR 0009 §1)', () => {
  it('requires a limit', () => {
    const spec = structuredClone(base) as any
    delete spec.pages[0].blocks[0].data.limit
    expect(validateSpec(spec).ok).toBe(false)
  })

  it('refuses data without item, and item without data', () => {
    const noItem = structuredClone(base) as any
    delete noItem.pages[0].blocks[0].item
    expect(validateSpec(noItem).ok).toBe(false)
  })

  it('caps data nesting at one level', () => {
    const nested = structuredClone(base) as any
    nested.pages[0].blocks[0].item = [
      { type: 'card', data: { from: 'service', limit: 3 }, item: [{ type: 'text' }] },
    ]
    const result = Page.safeParse(nested.pages[0])
    expect(result.success).toBe(false)
    expect(dataNestingDepth(nested.pages[0].blocks)).toBeGreaterThan(1)
  })
})

describe('cross-section references (the errors that reach customers)', () => {
  it('accepts a coherent spec', () => {
    expect(validateSpec(base).ok).toBe(true)
  })

  it('catches a query against an undeclared content type', () => {
    const spec = structuredClone(base) as any
    spec.pages[0].blocks[0].data.from = 'treatment'
    const r = validateSpec(spec)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.issues[0]!.message).toContain('treatment')
  })

  it('catches sorting by a field the type does not have', () => {
    const spec = structuredClone(base) as any
    spec.pages[0].blocks[0].data.sort = { field: 'price', dir: 'asc' }
    expect(validateSpec(spec).ok).toBe(false)
  })

  it('catches two pages answering the same path', () => {
    const spec = structuredClone(base) as any
    spec.pages.push({ ...spec.pages[0], key: 'other' })
    expect(validateSpec(spec).ok).toBe(false)
  })

  it('catches a workflow waiting on a state nobody declared', () => {
    const spec = structuredClone(base) as any
    spec.content[0].fields.push({
      name: 'status', label: 'Status', type: 'state',
      initial: 'draft', values: ['draft', 'live'],
      transitions: [{ from: 'draft', to: ['live'] }],
    })
    spec.logic = [{
      key: 'notify',
      trigger: { on: 'entry.transitioned', type: 'service', to: 'archived' },
      steps: [{ action: 'email-send' }],
    }]
    expect(validateSpec(spec).ok).toBe(false)
  })
})

describe('state fields declare a closed machine (ADR 0009 §4)', () => {
  it('rejects an initial state outside values', () => {
    const spec = structuredClone(base) as any
    spec.content[0].fields.push({
      name: 'status', label: 'Status', type: 'state',
      initial: 'nowhere', values: ['draft', 'live'],
      transitions: [{ from: 'draft', to: ['live'] }],
    })
    expect(validateSpec(spec).ok).toBe(false)
  })
})

describe('secrets never enter the spec (ADR 0001)', () => {
  it('accepts a secret reference', () => {
    const r = Integration.safeParse({
      key: 'mpesa', kind: 'payment.mpesa',
      config: { shortcode: '174379' },
      secrets: { consumerKey: 'secret:MPESA_CONSUMER_KEY' },
    })
    expect(r.success).toBe(true)
  })

  it('flags a credential pasted into config', () => {
    const r = Integration.safeParse({
      key: 'mpesa', kind: 'payment.mpesa',
      config: { consumerKey: 'A7fQ2xLm90ZbNq4RtYuVwXcE13sPdKgH' },
    })
    expect(r.success).toBe(false)
  })
})

describe('patches classify for the gate (doc 03)', () => {
  it('treats removal and movement as destructive', () => {
    expect(classify([{ op: 'set', path: '/name', value: 'x' }])).toBe('additive')
    expect(classify([{ op: 'insert', path: '/pages/0', value: {} }])).toBe('additive')
    expect(classify([{ op: 'remove', path: '/content/0/fields/1' }])).toBe('destructive')
    expect(classify([
      { op: 'set', path: '/name', value: 'x' },
      { op: 'move', path: '/pages/0/blocks/0', to: '/pages/0/blocks/2' },
    ])).toBe('destructive')
  })
})
