// LaTeX-level analysis of a row, done before handing it to the Compute Engine.
//
// The Compute Engine parses `a(b+1)` as an application of an unknown function
// `a`, and declares `a` as a function as a side effect. A calculator should
// read it as multiplication unless `a` is a function the user has defined, so
// definitions are found here first and other applications are rewritten.

const GREEK = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta',
  'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'rho',
  'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma',
  'Delta', 'Theta', 'Lambda', 'Xi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
]

/** A user-definable name: a letter or Greek letter with an optional subscript. */
const NAME = String.raw`(?:[a-zA-Z]|\\(?:${GREEK.join('|')})(?![a-zA-Z]))(?:_(?:[a-zA-Z0-9]|\{[a-zA-Z0-9]+\}))?`

const ASSIGN = String.raw`\s*(?::=|=(?!=))`

const FUNCTION_DEF = new RegExp(
  String.raw`^\s*(${NAME})\s*(?:\\left)?\(\s*(${NAME}(?:\s*,\s*${NAME})*)\s*(?:\\right)?\)${ASSIGN}([\s\S]*)$`,
)

const VARIABLE_DEF = new RegExp(String.raw`^\s*(${NAME})${ASSIGN}([\s\S]*)$`)

/** `e` and `i` parse as constants, so they can't be assigned. */
const RESERVED = new Set(['e', 'i'])

export type RowShape =
  | { type: 'empty' }
  | { type: 'variable'; name: string; rhs: string }
  | { type: 'function'; name: string; params: string[]; rhs: string }
  | { type: 'expression'; latex: string }
  | { type: 'reserved'; name: string }

/** Names are returned as LaTeX; the caller maps them to engine symbols. */
export function classifyRow(latex: string): RowShape {
  if (latex.trim() === '') return { type: 'empty' }

  const fn = FUNCTION_DEF.exec(latex)
  if (fn) {
    const [, name, params, rhs] = fn
    if (RESERVED.has(name)) return { type: 'reserved', name }
    return {
      type: 'function',
      name,
      params: params.split(',').map((p) => p.trim()),
      rhs,
    }
  }

  const v = VARIABLE_DEF.exec(latex)
  if (v) {
    const [, name, rhs] = v
    if (RESERVED.has(name)) return { type: 'reserved', name }
    return { type: 'variable', name, rhs }
  }

  return { type: 'expression', latex }
}

/** Commands whose `{…}` argument is text, not a sequence of variables. */
const TEXT_COMMANDS = new Set([
  'operatorname', 'mathrm', 'text', 'textrm', 'mathit', 'mathbf', 'mathsf',
  'mathtt', 'mathcal', 'mathbb', 'begin', 'end',
])

const GREEK_SET = new Set(GREEK)

/**
 * Rewrite `a(…)` as `a\cdot(…)` unless `a` is one of `functions` (LaTeX
 * names). Rows calling the ODE solvers keep their applications, since `y(x)`
 * there names the unknown function.
 */
export function rewriteApplications(
  latex: string,
  functions: ReadonlySet<string>,
): string {
  if (/\\operatorname\{N?DSolve/.test(latex)) return latex

  let out = ''
  let i = 0

  // Consume a `{…}` group starting at `i`, returning the index after it.
  const skipGroup = (start: number) => {
    let depth = 0
    for (let j = start; j < latex.length; j++) {
      if (latex[j] === '\\') j++
      else if (latex[j] === '{') depth++
      else if (latex[j] === '}' && --depth === 0) return j + 1
    }
    return latex.length
  }

  // Consume an optional `_x` or `_{…}` subscript.
  const skipSubscript = (start: number) => {
    if (latex[start] !== '_') return start
    if (latex[start + 1] === '{') return skipGroup(start + 1)
    return Math.min(start + 2, latex.length)
  }

  const isApplied = (start: number) => {
    const rest = latex.slice(start).trimStart()
    return rest.startsWith('(') || rest.startsWith('\\left(')
  }

  const emitName = (start: number, end: number) => {
    const name = latex.slice(start, end)
    out += name
    if (isApplied(end) && !functions.has(name)) out += '\\cdot '
    i = end
  }

  while (i < latex.length) {
    const ch = latex[i]
    if (ch === '\\') {
      const command = /^\\([a-zA-Z]+)/.exec(latex.slice(i))
      if (!command) {
        out += latex.slice(i, i + 2)
        i += 2
        continue
      }
      const end = i + command[0].length
      if (GREEK_SET.has(command[1])) {
        emitName(i, skipSubscript(end))
      } else if (TEXT_COMMANDS.has(command[1]) && latex[end] === '{') {
        const groupEnd = skipGroup(end)
        out += latex.slice(i, groupEnd)
        i = groupEnd
      } else {
        out += command[0]
        i = end
      }
    } else if (/[a-zA-Z]/.test(ch)) {
      emitName(i, skipSubscript(i + 1))
    } else {
      out += ch
      i++
    }
  }
  return out
}
