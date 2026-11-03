import { ComputeEngine, isFunction, isNumber, sym } from '@cortex-js/compute-engine'
import type { Expression, ExpressionInput } from '@cortex-js/compute-engine'
import {
  MAX_LATEX_LENGTH,
  containsFloat,
  errorMessage,
  exactLatex,
  isIntegral,
  numericLatex,
} from './format'
import { classifyRow, rewriteApplications, type RowShape } from './latex'
import type {
  CacheEntry,
  Definition,
  RowInput,
  RowResult,
  Settings,
} from './types'

export interface SheetCallbacks {
  onStart?: (rowId: string, key: string) => void
  onResult: (rowId: string, entry: CacheEntry) => void
}

interface Row {
  id: string
  index: number
  shape: RowShape
  /** Engine symbol defined by this row, if any. */
  defines?: string
  /** Engine symbols defined elsewhere in the sheet that this row reads. */
  deps: string[]
  /** Set when the row can't be evaluated for structural reasons. */
  problem?: string
  key?: string
}

/** Operators whose result is already in the form the user asked for. */
const NO_SIMPLIFY = new Set([
  'Expand', 'ExpandAll', 'Factor', 'Together', 'Apart', 'Series', 'Normal',
])

/**
 * Evaluate every row of a sheet. Definitions are evaluated first, in
 * dependency order, so rows may reference names defined further down. Each
 * result is reported as soon as it's computed.
 */
export function evaluateSheet(
  inputs: RowInput[],
  settings: Settings,
  cache: ReadonlyMap<string, CacheEntry>,
  skip: ReadonlySet<string>,
  callbacks: SheetCallbacks,
): void {
  const rows = analyze(inputs)
  const order = evaluationOrder(rows)

  const ce = new ComputeEngine()
  ce.angularUnit = settings.angleUnit

  const failed = new Map<string, Row>()
  const keyOf = new Map<string, string>()
  for (const row of rows) {
    if (row.defines && row.problem) failed.set(row.defines, row)
  }

  for (const row of order) {
    const report = (entry: Omit<CacheEntry, 'key'>) => {
      const key = row.key ?? ''
      if (row.defines && entry.definition) keyOf.set(row.defines, key)
      else if (row.defines) failed.set(row.defines, row)
      callbacks.onResult(row.id, { key, ...entry })
    }

    if (row.problem) {
      report({ result: { kind: 'error', message: row.problem } })
      continue
    }

    const brokenDep = row.deps.find((dep) => failed.has(dep))
    if (brokenDep) {
      report({
        result: {
          kind: 'error',
          message: `Uses ${brokenDep}, whose definition isn't complete`,
        },
      })
      continue
    }

    row.key = [
      settings.angleUnit,
      settings.digits,
      ...row.deps.map((dep) => `${dep}:${keyOf.get(dep)}`),
      JSON.stringify(row.shape),
    ].join('|')

    if (skip.has(row.key)) {
      report({ result: { kind: 'timeout' } })
      continue
    }

    const cached = cache.get(row.key)
    if (cached) {
      if (cached.definition) define(ce, cached.definition)
      report(cached)
      continue
    }

    callbacks.onStart?.(row.id, row.key)
    let entry: Omit<CacheEntry, 'key'>
    try {
      entry = evaluateRow(ce, row, settings)
    } catch (err) {
      entry = { result: { kind: 'error', message: messageOf(err) } }
    }
    if (entry.definition) {
      try {
        define(ce, entry.definition)
      } catch (err) {
        entry = { result: { kind: 'error', message: messageOf(err) } }
      }
    }
    report(entry)
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function define(ce: ComputeEngine, definition: Definition) {
  ce.assign(definition.name, ce.box(definition.value as ExpressionInput))
}

// ---------------------------------------------------------------------------
// Analysis: what each row defines and depends on.

function analyze(inputs: RowInput[]): Row[] {
  // A scratch engine: parsing declares symbols as a side effect, so the
  // engine used for evaluation must not see these parses.
  const scratch = new ComputeEngine()
  const shapes = inputs.map((input) => classifyRow(input.latex))

  const functionNames = new Set(
    shapes.flatMap((s) => (s.type === 'function' ? [s.name] : [])),
  )

  const rows: Row[] = inputs.map((input, index) => {
    const shape = shapes[index]
    const row: Row = { id: input.id, index, shape, deps: [] }

    if (shape.type === 'reserved') {
      row.problem = `${shape.name} is a constant and can't be redefined`
      return row
    }
    if (shape.type === 'variable' || shape.type === 'function') {
      const name = symbolName(scratch, shape.name)
      if (!name) {
        row.problem = `${shape.name} can't be used as a name`
        return row
      }
      row.defines = name
    }
    if (shape.type === 'function') {
      const params = shape.params.map((p) => symbolName(scratch, p))
      if (params.some((p) => !p)) row.problem = 'Invalid parameter name'
    }
    return row
  })

  // Rewrite after classification so every row sees every user function.
  for (const row of rows) {
    const shape = row.shape
    if (shape.type === 'variable' || shape.type === 'function') {
      row.shape = { ...shape, rhs: rewriteApplications(shape.rhs, functionNames) }
    } else if (shape.type === 'expression') {
      row.shape = { ...shape, latex: rewriteApplications(shape.latex, functionNames) }
    }
  }

  // Names defined more than once are ambiguous; flag every definition.
  const definers = new Map<string, Row[]>()
  for (const row of rows) {
    if (row.defines) definers.set(row.defines, [...(definers.get(row.defines) ?? []), row])
  }
  for (const [name, list] of definers) {
    if (list.length > 1) {
      for (const row of list) row.problem = `${name} is defined more than once`
    }
  }

  for (const row of rows) {
    const latex = bodyLatex(row.shape)
    if (latex === null) continue
    const bound =
      row.shape.type === 'function'
        ? new Set(row.shape.params.map((p) => symbolName(scratch, p)))
        : new Set<string>()
    const names = new Set<string>()
    collectSymbols(scratch.parse(latex).json, names)
    row.deps = [...names].filter(
      (name) => definers.has(name) && !bound.has(name),
    )
  }
  return rows
}

function bodyLatex(shape: RowShape): string | null {
  switch (shape.type) {
    case 'variable':
    case 'function':
      return shape.rhs
    case 'expression':
      return shape.latex
    default:
      return null
  }
}

function symbolName(ce: ComputeEngine, latex: string): string | null {
  return sym(ce.parse(latex)) ?? null
}

/** Collect the free symbols of a MathJSON expression, operators included. */
function collectSymbols(json: unknown, out: Set<string>, bound = new Set<string>()) {
  if (typeof json === 'string') {
    if (!json.startsWith("'") && !bound.has(json)) out.add(json)
    return
  }
  if (!Array.isArray(json)) return
  const [head, ...ops] = json

  if (head === 'Function') {
    const [body, ...params] = ops
    collectSymbols(body, out, new Set([...bound, ...params.filter(isString)]))
    return
  }

  // Sum, Product, Integrate…: the variables of `Limits` are bound in the body.
  const limits = ops.filter(
    (op): op is unknown[] => Array.isArray(op) && (op[0] === 'Limits' || op[0] === 'Element'),
  )
  if (limits.length > 0) {
    const inner = new Set(bound)
    for (const [, variable, ...range] of limits) {
      if (isString(variable)) inner.add(variable)
      for (const r of range) collectSymbols(r, out, bound)
    }
    for (const op of ops) if (!limits.includes(op as unknown[])) collectSymbols(op, out, inner)
    return
  }

  collectSymbols(head, out, bound)
  for (const op of ops) collectSymbols(op, out, bound)
}

const isString = (x: unknown): x is string => typeof x === 'string'

/**
 * Definitions first, in dependency order; then everything else in row
 * order. Rows on a cycle get a problem and are evaluated as errors.
 */
function evaluationOrder(rows: Row[]): Row[] {
  const byName = new Map<string, Row>()
  for (const row of rows) if (row.defines && !row.problem) byName.set(row.defines, row)

  const order: Row[] = []
  const state = new Map<Row, 'visiting' | 'done'>()

  const visit = (row: Row, path: Row[]) => {
    if (state.get(row) === 'done') return
    if (state.get(row) === 'visiting') {
      const cycle = path.slice(path.indexOf(row))
      const names = cycle.map((r) => r.defines).join(' → ')
      for (const r of cycle) r.problem ??= `Circular definition: ${names} → ${row.defines}`
      return
    }
    state.set(row, 'visiting')
    for (const dep of row.deps) {
      const target = byName.get(dep)
      if (target) visit(target, [...path, row])
    }
    state.set(row, 'done')
    order.push(row)
  }

  for (const row of rows) if (row.defines) visit(row, [])
  for (const row of rows) if (!row.defines) order.push(row)
  return order
}

// ---------------------------------------------------------------------------
// Evaluating a single row.

function evaluateRow(
  ce: ComputeEngine,
  row: Row,
  settings: Settings,
): Omit<CacheEntry, 'key'> {
  const shape = row.shape
  switch (shape.type) {
    case 'empty':
      return { result: { kind: 'empty' } }

    case 'function': {
      const body = ce.parse(shape.rhs)
      if (!body.isValid || shape.rhs.trim() === '') return incomplete(body)
      const params = shape.params.map((p) => sym(ce.parse(p))!)
      return {
        result: { kind: 'defined', name: shape.name },
        definition: { name: row.defines!, value: ['Function', body.json, ...params] },
      }
    }

    case 'variable': {
      const rhs = ce.parse(shape.rhs)
      if (!rhs.isValid || shape.rhs.trim() === '') return incomplete(rhs)
      const value = rhs.evaluate()
      const error = errorMessage(value.json)
      if (error) return { result: { kind: 'error', message: error } }
      // `a = 3` and `A = (matrix)` need no answer; `a = 3 + 4` shows `7`.
      const trivial =
        /^\s*-?\d+(\.\d+)?\s*$/.test(shape.rhs) ||
        (/^\s*\\begin\{[pbvV]?matrix\}/.test(shape.rhs) &&
          exactLatex(ce, rhs) === exactLatex(ce, value))
      return {
        result: trivial ? { kind: 'value' } : present(ce, value, settings),
        definition: { name: row.defines!, value: value.json },
      }
    }

    case 'expression': {
      const expr = ce.parse(shape.latex)
      if (!expr.isValid) return incomplete(expr)
      if (isEquation(expr)) return { result: solveEquation(ce, expr, settings) }

      let value = expr.evaluate()
      if (!NO_SIMPLIFY.has(expr.operator)) value = simplest(value)
      const error = errorMessage(value.json)
      if (error) return { result: { kind: 'error', message: error } }
      return { result: present(ce, value, settings) }
    }

    case 'reserved':
      return { result: { kind: 'error', message: 'Reserved name' } }
  }
}

/**
 * An unparseable row is usually still being typed. Errors that aren't about
 * syntax (e.g. an unknown command) are worth reporting.
 */
function incomplete(expr: Expression): Omit<CacheEntry, 'key'> {
  const message = errorMessage(expr.json)
  const syntax = /expected|unexpected|missing|closing|delimiter|operand/i
  if (message && !syntax.test(message)) {
    return { result: { kind: 'error', message } }
  }
  return { result: { kind: 'incomplete' } }
}

function simplest(value: Expression): Expression {
  try {
    const simplified = value.simplify()
    return simplified.latex.length <= value.latex.length ? simplified : value
  } catch {
    return value
  }
}

function present(
  ce: ComputeEngine,
  value: Expression,
  settings: Settings,
): RowResult {
  const json = value.json
  const note =
    value.operator === 'Integrate' ? 'No closed form found' : undefined

  // Decimal input gives a decimal answer; there's nothing more exact to show.
  if (containsFloat(json)) {
    const numeric = numericLatex(json, settings.digits)
    if (numeric) return { kind: 'value', exact: numeric, note }
  }

  let exact: string | undefined = exactLatex(ce, value)
  let approx: string | undefined

  if (value.unknowns.length === 0) {
    const n = value.N()
    const isNaN = sym(n) === 'NaN' || (isNumber(n) && Number.isNaN(n.re))
    if (!isNaN) approx = numericLatex(n.json, settings.digits) ?? undefined
    // Integers are already exact decimals, unless too long to read at a glance.
    if (approx && isIntegral(json) && !approx.includes('\\times10^')) approx = undefined
  }

  if (exact.length > MAX_LATEX_LENGTH) {
    exact = undefined
    if (!approx) return { kind: 'error', message: 'The result is too long to display' }
  }
  if (approx && exact && sameNumber(approx, exact)) approx = undefined

  return { kind: 'value', exact, approx, note }
}

/** Avoid `= 6 ≈ 6`: compare with the exact form, ignoring spacing. */
function sameNumber(approx: string, exact: string): boolean {
  const normalize = (s: string) => s.replace(/\\[,;:! ]|\s/g, '')
  return normalize(approx) === normalize(exact)
}

// ---------------------------------------------------------------------------
// Equations.

function isEquation(expr: Expression): boolean {
  if (expr.operator === 'Equal') return true
  return (
    isFunction(expr, 'List') &&
    expr.ops.length > 0 &&
    expr.ops.every((op) => op.operator === 'Equal')
  )
}

function solveEquation(
  ce: ComputeEngine,
  expr: Expression,
  settings: Settings,
): RowResult {
  const unknowns = [...expr.unknowns].sort()

  if (unknowns.length === 0) {
    const value = expr.evaluate()
    return { kind: 'value', exact: exactLatex(ce, value) }
  }

  if (expr.operator === 'Equal') {
    const variable = unknowns.includes('x') ? 'x' : unknowns[0]
    const solutions = expr.solve(variable) as Expression[] | null | undefined
    if (!Array.isArray(solutions)) {
      return { kind: 'error', message: `Couldn't solve for ${variable}` }
    }
    const name = ce.box(variable).latex
    return describeSolutions(
      ce,
      solutions.map((s) => ({ [name]: s })),
      settings,
    )
  }

  const solved = expr.solve(unknowns) as
    | Record<string, Expression>
    | Record<string, Expression>[]
    | null
    | undefined
  if (!solved) return { kind: 'error', message: 'No unique solution found' }
  const list = Array.isArray(solved) ? solved : [solved]
  return describeSolutions(
    ce,
    list.map((s) =>
      Object.fromEntries(Object.entries(s).map(([k, v]) => [ce.box(k).latex, v])),
    ),
    settings,
  )
}

function describeSolutions(
  ce: ComputeEngine,
  solutions: Record<string, Expression>[],
  settings: Settings,
): RowResult {
  if (solutions.length === 0) {
    return { kind: 'value', bare: true, exact: '\\text{no solution}' }
  }

  const format = (fn: (value: Expression) => string | null) => {
    const parts = solutions.map((solution) => {
      const assignments = Object.entries(solution).map(([name, value]) => {
        const latex = fn(value)
        return latex === null ? null : `${name}=${latex}`
      })
      return assignments.includes(null) ? null : assignments.join(',\\;')
    })
    return parts.includes(null) ? null : parts.join(',\\quad ')
  }

  const exact = format((value) =>
    containsFloat(value.json)
      ? numericLatex(value.json, settings.digits)
      : exactLatex(ce, value),
  )!
  const approx = format((value) =>
    value.unknowns.length === 0 ? numericLatex(value.N().json, settings.digits) : null,
  )
  return {
    kind: 'value',
    bare: true,
    exact,
    approx: approx && !sameNumber(approx, exact) ? approx : undefined,
  }
}
