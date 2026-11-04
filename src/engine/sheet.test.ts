import { describe, expect, it } from 'vitest'
import { evaluateSheet } from './sheet'
import { rewriteApplications, classifyRow } from './latex'
import { formatReal } from './format'
import type { CacheEntry, RowResult, Settings } from './types'

const settings: Settings = { angleUnit: 'rad', digits: 10 }

function run(
  latex: string[],
  options: { settings?: Settings; cache?: Map<string, CacheEntry> } = {},
) {
  const results: RowResult[] = []
  const entries: CacheEntry[] = []
  const started: string[] = []
  evaluateSheet(
    latex.map((l, i) => ({ id: String(i), latex: l })),
    options.settings ?? settings,
    options.cache ?? new Map(),
    new Set(),
    {
      onStart: (id) => started.push(id),
      onResult: (id, entry) => {
        results[Number(id)] = entry.result
        entries[Number(id)] = entry
      },
    },
  )
  return { results, entries, started }
}

const one = (latex: string, s?: Settings) => run([latex], { settings: s }).results[0]

describe('latex helpers', () => {
  it('classifies definitions', () => {
    expect(classifyRow('a=3')).toMatchObject({ type: 'variable', name: 'a' })
    expect(classifyRow('a:=3')).toMatchObject({ type: 'variable', name: 'a' })
    expect(classifyRow('x_{1}=3')).toMatchObject({ type: 'variable', name: 'x_{1}' })
    expect(classifyRow('\\alpha=3')).toMatchObject({ type: 'variable', name: '\\alpha' })
    expect(classifyRow('f\\left(x\\right)=x^2')).toMatchObject({
      type: 'function', name: 'f', params: ['x'], rhs: 'x^2',
    })
    expect(classifyRow('g(x, y)=xy')).toMatchObject({ type: 'function', params: ['x', 'y'] })
    expect(classifyRow('x^2=4')).toMatchObject({ type: 'expression' })
    expect(classifyRow('e=3')).toMatchObject({ type: 'reserved' })
    expect(classifyRow('a==3')).toMatchObject({ type: 'expression' })
  })

  it('rewrites implicit multiplication', () => {
    const fns = new Set(['f'])
    expect(rewriteApplications('a(b+1)', fns)).toBe('a\\cdot (b+1)')
    expect(rewriteApplications('xy\\left(x+1\\right)', fns)).toBe('xy\\cdot \\left(x+1\\right)')
    expect(rewriteApplications('f(x)+\\sin(x)', fns)).toBe('f(x)+\\sin(x)')
    expect(rewriteApplications('\\operatorname{Cross}(a,b)', fns)).toBe('\\operatorname{Cross}(a,b)')
    expect(rewriteApplications('\\alpha_{1}(2)', fns)).toBe('\\alpha_{1}\\cdot (2)')
  })

  it('formats reals', () => {
    expect(formatReal(Math.PI, 10)).toBe('3.141592654')
    expect(formatReal(0.5, 10)).toBe('0.5')
    expect(formatReal(1.5e-7, 10)).toBe('1.5\\times10^{-7}')
    expect(formatReal(2 ** 100, 10)).toBe('1.2676506\\times10^{30}')
    expect(formatReal(-42, 10)).toBe('-42')
  })
})

describe('evaluation', () => {
  it('keeps exact answers and adds a decimal', () => {
    expect(one('\\frac{1}{3}+\\frac{1}{6}')).toEqual({
      kind: 'value', exact: '\\frac{1}{2}', approx: '0.5', note: undefined,
    })
    expect(one('\\sqrt{8}')).toMatchObject({ exact: '2\\sqrt{2}', approx: '2.828427125' })
    expect(one('2+3')).toMatchObject({ exact: '5', approx: undefined })
  })

  it('keeps big integers exact', () => {
    const r = one('30!')
    expect(r).toMatchObject({ exact: '265\\,252\\,859\\,812\\,191\\,058\\,636\\,308\\,480\\,000\\,000' })
    expect(r).toMatchObject({ approx: '2.652528598\\times10^{32}' })
  })

  it('shows decimal input as fractions where possible', () => {
    expect(one('1.5\\times2.25')).toMatchObject({ exact: '\\frac{27}{8}', approx: '3.375' })
    expect(one('0.1+0.2')).toMatchObject({ exact: '\\frac{3}{10}', approx: '0.3' })
    expect(one('2.5\\times4')).toMatchObject({ exact: '10', approx: undefined })
    expect(one('1.5\\times10^{-7}')).toMatchObject({ exact: '\\frac{3}{20\\,000\\,000}', approx: '1.5\\times10^{-7}' })
    const r = one('\\sin(0.5)')
    expect(r).toMatchObject({ exact: '0.4794255386' })
    expect(r).not.toHaveProperty('approx')
  })

  it('carries decimals through definitions', () => {
    const { results } = run(['a=0.5', 'a+1', 'b=\\sqrt{2.0}', 'b^2', 'b+1', 'f(x)=0.5x', 'f(3)'])
    expect(results[0]).toMatchObject({ exact: '\\frac{1}{2}', approx: '0.5' })
    expect(results[1]).toMatchObject({ exact: '\\frac{3}{2}', approx: '1.5' })
    expect(results[2]).toMatchObject({ exact: '1.414213562' })
    expect(results[3]).toMatchObject({ exact: '2' })
    expect(results[4]).toMatchObject({ exact: '2.414213562' })
    expect(results[6]).toMatchObject({ exact: '\\frac{3}{2}', approx: '1.5' })
  })

  it('solves decimal equations as fractions', () => {
    expect(one('0.4x=1')).toMatchObject({ exact: 'x=\\frac{5}{2}', approx: 'x=2.5' })
  })

  it('does calculus', () => {
    expect(one('\\frac{d}{dx}\\sin\\left(x^2\\right)')).toMatchObject({ exact: '2x\\cos(x^2)' })
    expect(one('\\int x\\sin x\\,dx')).toMatchObject({ exact: '\\sin(x)-x\\cos(x)' })
    expect(one('\\int_0^1x^2\\,dx')).toMatchObject({ exact: '\\frac{1}{3}', approx: '0.3333333333' })
    expect(one('\\lim_{x\\to0}\\frac{\\sin x}{x}')).toMatchObject({ exact: '1' })
    expect(one('\\sum_{n=1}^{\\infty}\\frac{1}{n^2}')).toMatchObject({ approx: '1.644934067' })
  })

  it('notes integrals with no closed form', () => {
    expect(one('\\int_0^1\\sin(\\sin x)dx')).toMatchObject({
      note: 'No closed form found', approx: '0.4306061031',
    })
  })

  it('simplifies, but respects explicit expand', () => {
    expect(one('\\frac{x^2-1}{x-1}')).toMatchObject({ exact: 'x+1' })
    expect(one('\\operatorname{Expand}((x+1)^3)')).toMatchObject({ exact: 'x^3+3x^2+3x+1' })
  })

  it('does matrices', () => {
    expect(one('\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}^{-1}')).toMatchObject({
      exact: expect.stringContaining('\\begin{pmatrix}'),
      approx: '\\begin{pmatrix}-2&1\\\\1.5&-0.5\\end{pmatrix}',
    })
    expect(one('\\det\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}')).toMatchObject({ exact: 'ad-bc' })
  })

  it('reports errors in words', () => {
    const r = one('\\begin{pmatrix}1&2\\end{pmatrix}+\\begin{pmatrix}1&2&3\\end{pmatrix}')
    expect(r).toMatchObject({ kind: 'error' })
    expect((r as { message: string }).message).toMatch(/^Incompatible dimensions/)
  })

  it('treats unfinished input as incomplete', () => {
    expect(one('2+')).toEqual({ kind: 'incomplete' })
    expect(one('\\frac{1}{')).toEqual({ kind: 'incomplete' })
    expect(one('')).toEqual({ kind: 'empty' })
  })

  it('respects degrees', () => {
    expect(one('\\sin(30)', { angleUnit: 'deg', digits: 10 })).toMatchObject({ exact: '\\frac{1}{2}' })
  })
})

describe('equations', () => {
  it('solves for x', () => {
    expect(one('x^2-5x+6=0')).toMatchObject({ bare: true, exact: 'x=3,\\quad x=2' })
  })

  it('solves for the only unknown', () => {
    expect(one('2y+1=7')).toMatchObject({ exact: 'y=3' })
  })

  it('solves systems', () => {
    expect(one('\\begin{cases}x+y=3\\\\x-y=1\\end{cases}')).toMatchObject({ exact: 'x=2,\\;y=1' })
  })

  it('checks equations without unknowns', () => {
    expect(one('2+2=4')).toMatchObject({ exact: '\\text{true}' })
  })

  it('reports equations it cannot solve', () => {
    expect(one('e^x=x+2')).toMatchObject({ kind: 'error' })
  })
})

describe('variables and functions', () => {
  it('uses definitions from any row', () => {
    const { results } = run(['2a+1', 'a=3'])
    expect(results[0]).toMatchObject({ exact: '7' })
    expect(results[1]).toEqual({ kind: 'value' })
  })

  it('shows the value of a computed definition', () => {
    expect(run(['b=3+4']).results[0]).toMatchObject({ exact: '7' })
  })

  it('reads a(…) as multiplication', () => {
    const { results } = run(['a=3', 'a(b+1)', 'ab'])
    expect(results[1]).toMatchObject({ exact: '3b+3' })
    expect(results[2]).toMatchObject({ exact: '3b' })
  })

  it('defines and calls functions', () => {
    const { results } = run(['f(x)=x^2+a', 'a=1', 'f(3)', "f'(2)", '\\int_0^1f(x)\\,dx'])
    expect(results[0]).toEqual({ kind: 'defined', name: 'f' })
    expect(results[2]).toMatchObject({ exact: '10' })
    expect(results[3]).toMatchObject({ exact: '4' })
    expect(results[4]).toMatchObject({ exact: '\\frac{4}{3}' })
  })

  it('keeps function parameters separate from variables', () => {
    const { results } = run(['x=10', 'f(x)=x^2', 'f(2)', 'x+1'])
    expect(results[2]).toMatchObject({ exact: '4' })
    expect(results[3]).toMatchObject({ exact: '11' })
  })

  it('treats bound variables as bound', () => {
    const { results } = run(['x=5', '\\frac{d}{dx}x^2', '\\int_0^1x\\,dx'])
    expect(results[1]).toMatchObject({ exact: '2x' })
    expect(results[2]).toMatchObject({ exact: '\\frac{1}{2}' })
  })

  it('stores matrices', () => {
    const { results } = run(['A=\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}', '\\det(A)', 'A^2'])
    expect(results[0]).toEqual({ kind: 'value' })
    expect(results[1]).toMatchObject({ exact: '-2' })
    expect(results[2]).toMatchObject({ exact: expect.stringMatching(/^\\begin\{pmatrix\}7 & 10/) })
  })

  it('flags duplicate and circular definitions', () => {
    const dup = run(['a=1', 'a=2', 'a+1']).results
    expect(dup[0]).toMatchObject({ kind: 'error', message: 'a is defined more than once' })
    expect(dup[2]).toMatchObject({ kind: 'error' })

    const cycle = run(['a=b+1', 'b=a+1']).results
    expect(cycle[0]).toMatchObject({ kind: 'error', message: expect.stringMatching(/^Circular/) })
  })

  it('errors on rows that use an unfinished definition', () => {
    const { results } = run(['a=2+', 'a+1'])
    expect(results[0]).toEqual({ kind: 'incomplete' })
    expect(results[1]).toMatchObject({ kind: 'error', message: "Uses a, whose definition isn't complete" })
  })

  it('refuses to redefine constants', () => {
    expect(one('e=3')).toMatchObject({ kind: 'error' })
  })
})

describe('caching', () => {
  it('reuses rows whose inputs did not change', () => {
    const cache = new Map<string, CacheEntry>()
    const first = run(['a=2', '\\int_0^1x^a\\,dx', 'a+1'], { cache })
    for (const entry of first.entries) cache.set(entry.key, entry)

    const second = run(['a=2', '\\int_0^1x^a\\,dx', 'a+2'], { cache })
    expect(second.started).toEqual(['2'])
    expect(second.results[1]).toMatchObject({ exact: '\\frac{1}{3}' })

    const third = run(['a=3', '\\int_0^1x^a\\,dx', 'a+2'], { cache })
    expect(third.started).toEqual(['0', '1', '2'])
    expect(third.results[1]).toMatchObject({ exact: '\\frac{1}{4}' })
  })
})
