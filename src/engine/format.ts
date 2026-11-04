import { sym } from '@cortex-js/compute-engine'
import type {
  ComputeEngine,
  Expression,
  ExpressionInput,
} from '@cortex-js/compute-engine'

// The Compute Engine's LaTeX serializer ignores `fractionalDigits` and prints
// numeric uncertainty (`0.746…±0.000…66`), so decimal results are serialized
// here instead.

type Json = unknown

/** Results longer than this are not rendered (e.g. the 450k digits of 100000!). */
export const MAX_LATEX_LENGTH = 4000

function toNumber(json: Json): number | null {
  if (typeof json === 'number') return json
  if (json && typeof json === 'object' && 'num' in json) {
    const n = Number.parseFloat(String((json as { num: string }).num))
    return Number.isNaN(n) && String((json as { num: string }).num) !== 'NaN'
      ? null
      : n
  }
  if (json === 'PositiveInfinity') return Infinity
  if (json === 'NegativeInfinity') return -Infinity
  if (json === 'NaN') return NaN
  if (Array.isArray(json)) {
    if (json[0] === 'Measurement') return toNumber(json[1])
    if (json[0] === 'Rational' && json.length === 3) {
      const [p, q] = [toNumber(json[1]), toNumber(json[2])]
      return p === null || q === null ? null : p / q
    }
    if (json[0] === 'Negate' && json.length === 2) {
      const n = toNumber(json[1])
      return n === null ? null : -n
    }
  }
  return null
}

export function formatReal(x: number, digits: number): string {
  if (Number.isNaN(x)) return '\\operatorname{undefined}'
  if (!Number.isFinite(x)) return x > 0 ? '\\infty' : '-\\infty'
  if (x === 0) return '0'

  const exponent = Math.floor(Math.log10(Math.abs(x)))
  if (exponent >= digits || exponent < -5) {
    const [mantissa, exp] = x.toExponential(digits - 1).split('e')
    return `${trimZeros(mantissa)}\\times10^{${Number(exp)}}`
  }
  return trimZeros(x.toPrecision(digits))
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

function formatComplex(re: number, im: number, digits: number): string {
  // Drop parts that are rounding noise relative to the other part.
  const scale = Math.max(Math.abs(re), Math.abs(im))
  const eps = scale * 10 ** -(digits + 1)
  if (Math.abs(im) <= eps) return formatReal(re, digits)
  const imaginary =
    Math.abs(Math.abs(im) - 1) < 10 ** -digits
      ? ''
      : formatReal(Math.abs(im), digits)
  if (Math.abs(re) <= eps) return `${im < 0 ? '-' : ''}${imaginary}i`
  return `${formatReal(re, digits)}${im < 0 ? '-' : '+'}${imaginary}i`
}

/**
 * Serialize a fully numeric result (a number, complex number, or a list or
 * matrix of them). Returns `null` if the expression is not purely numeric.
 */
export function numericLatex(json: Json, digits: number): string | null {
  const real = toNumber(json)
  if (real !== null) return formatReal(real, digits)

  if (!Array.isArray(json)) return null
  const [head, ...ops] = json

  if (head === 'Complex' && ops.length === 2) {
    const [re, im] = ops.map(toNumber)
    return re === null || im === null ? null : formatComplex(re, im, digits)
  }

  if (head === 'List' || head === 'Matrix') {
    const inner = head === 'Matrix' ? ops[0] : json
    if (isRectangularMatrix(inner)) {
      const rows = (inner as Json[][]).slice(1).map((row) =>
        row.slice(1).map((cell) => numericLatex(cell, digits)),
      )
      if (rows.some((row) => row.some((cell) => cell === null))) return null
      return matrixLatex(rows as string[][])
    }
    if (head === 'List') {
      const items = ops.map((op) => numericLatex(op, digits))
      if (items.some((item) => item === null)) return null
      return `\\left[${items.join(',\\,')}\\right]`
    }
  }
  return null
}

function matrixLatex(rows: string[][]): string {
  return `\\begin{pmatrix}${rows.map((row) => row.join('&')).join('\\\\')}\\end{pmatrix}`
}

function isList(json: Json): json is Json[] {
  return Array.isArray(json) && json[0] === 'List'
}

/** A `List` of at least one `List`, all of the same length, none nested deeper. */
function isRectangularMatrix(json: Json): boolean {
  if (!isList(json) || json.length < 2) return false
  const rows = json.slice(1)
  if (!rows.every(isList)) return false
  const width = (rows[0] as Json[]).length
  return (
    width > 1 &&
    rows.every(
      (row) =>
        (row as Json[]).length === width &&
        (row as Json[]).slice(1).every((cell) => !isList(cell)),
    )
  )
}

/** True for an integer, or a list or matrix of integers: no decimal needed. */
/** The engine writes exact integers like 30! as `"26525…848e+7"`. */
const INTEGER_STRING = /^-?\d+(e\+?\d+)?$/i

export function isIntegral(json: Json): boolean {
  if (typeof json === 'number') return Number.isInteger(json)
  if (json && typeof json === 'object' && 'num' in json) {
    return INTEGER_STRING.test(String((json as { num: string }).num))
  }
  if (Array.isArray(json) && (json[0] === 'List' || json[0] === 'Matrix')) {
    return json.slice(1).every(isIntegral)
  }
  return false
}

const CLOSED_FORM_OPERATORS = new Set([
  'Add', 'Subtract', 'Multiply', 'Divide', 'Negate', 'Sqrt', 'Root', 'Complex', 'List', 'Matrix',
])

/**
 * True for a number built from fractions, roots and π, such as `√3/2` or
 * `π/3`, or a list or matrix of them. Unevaluated functions like `sin(1/2)`
 * or `e^{3/10}` don't count.
 */
export function isClosedForm(json: Json): boolean {
  if (isIntegral(json) || json === 'Pi') return true
  if (!Array.isArray(json)) return false
  const [head, ...ops] = json
  if (head === 'Rational') return ops.length === 2 && ops.every(isIntegral)
  if (head === 'Power') return ops.length === 2 && isClosedForm(ops[0]) && isRational(ops[1])
  return CLOSED_FORM_OPERATORS.has(head as string) && ops.every(isClosedForm)
}

function isRational(json: Json): boolean {
  if (isIntegral(json)) return true
  if (Array.isArray(json) && json[0] === 'Rational') return json.slice(1).every(isIntegral)
  if (Array.isArray(json) && json[0] === 'Negate') return isRational(json[1])
  return false
}

const DECIMAL_STRING = /^(-?)(\d*)\.?(\d*)(?:e([+-]?\d+))?$/i

/** Replace every decimal literal with the exact fraction it denotes. */
export function rationalize(json: Json): Json {
  if (typeof json === 'number') {
    return Number.isInteger(json) || !Number.isFinite(json) ? json : decimalToRational(String(json)) ?? json
  }
  if (json && typeof json === 'object' && 'num' in json) {
    return decimalToRational(String((json as { num: string }).num)) ?? json
  }
  if (Array.isArray(json)) return json.map((op, i) => (i === 0 ? op : rationalize(op)))
  return json
}

function decimalToRational(s: string): Json | null {
  const match = DECIMAL_STRING.exec(s)
  if (!match || (match[2] === '' && match[3] === '')) return null
  const [, sign, whole, fraction, exp] = match
  let numerator = BigInt(sign + (whole || '0') + fraction)
  let denominator = 1n
  const shift = Number(exp ?? 0) - fraction.length
  if (shift >= 0) numerator *= 10n ** BigInt(shift)
  else denominator = 10n ** BigInt(-shift)
  const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator)
  numerator /= divisor
  denominator /= divisor
  return denominator === 1n ? bigintJson(numerator) : ['Rational', bigintJson(numerator), bigintJson(denominator)]
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) [a, b] = [b, a % b]
  return a
}

function bigintJson(n: bigint): Json {
  return n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(n)
    : { num: n.toString() }
}

/** True if the expression contains a non-integer float anywhere. */
export function containsFloat(json: Json): boolean {
  if (typeof json === 'number') return !Number.isInteger(json)
  if (json && typeof json === 'object' && 'num' in json) {
    return !INTEGER_STRING.test(String((json as { num: string }).num))
  }
  if (Array.isArray(json)) {
    if (json[0] === 'Measurement') return true
    return json.slice(1).some(containsFloat)
  }
  return false
}

/** Exact (symbolic) LaTeX for a result, with matrices shown as matrices. */
export function exactLatex(ce: ComputeEngine, expr: Expression): string {
  if (sym(expr) === 'True') return '\\text{true}'
  if (sym(expr) === 'False') return '\\text{false}'
  const json = wrapMatrices(expr.json)
  const display = json === expr.json ? expr : ce.box(json as ExpressionInput, { form: 'raw' })
  return display.toLatex({ digitGroupSeparator: '\\,' })
}

function wrapMatrices(json: Json): Json {
  if (!Array.isArray(json)) return json
  if (json[0] === 'Matrix') return json
  if (isRectangularMatrix(json)) return ['Matrix', json]
  const ops = json.slice(1).map(wrapMatrices)
  return ops.every((op, i) => op === json[i + 1]) ? json : [json[0], ...ops]
}

/** Find the first `Error` node and turn its code into a sentence. */
export function errorMessage(json: Json): string | null {
  if (!Array.isArray(json)) return null
  if (json[0] === 'Error') return describeError(json.slice(1))
  for (const op of json.slice(1)) {
    const message = errorMessage(op)
    if (message) return message
  }
  return null
}

const unquote = (s: Json) =>
  typeof s === 'string' ? s.replace(/^'(.*)'$/s, '$1') : null

function describeError(ops: Json[]): string {
  let [code, ...details] = ops
  if (Array.isArray(code) && code[0] === 'ErrorCode') {
    details = code.slice(2)
    code = code[1]
  }
  const text = unquote(code) ?? 'invalid expression'
  const sentence = text.replace(/-/g, ' ')
  // Prefer a hint written as a sentence (e.g. "use Cross(a, b) …") when present.
  const hint = details.map(unquote).find((d) => d && /\s/.test(d))
  return hint ? `${capitalize(sentence)}: ${hint}` : capitalize(sentence)
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
