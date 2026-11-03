export type AngleUnit = 'rad' | 'deg'

export interface Settings {
  angleUnit: AngleUnit
  /** Significant digits shown in decimal approximations. */
  digits: number
}

export interface RowInput {
  id: string
  latex: string
}

export type RowResult =
  | { kind: 'empty' }
  /** The input is still being typed (unbalanced braces, trailing operator…). */
  | { kind: 'incomplete' }
  /** A function definition: nothing to show besides confirming it parsed. */
  | { kind: 'defined'; name: string }
  | { kind: 'value'; exact?: string; approx?: string; note?: string }
  | { kind: 'error'; message: string }
  | { kind: 'timeout' }

/**
 * What a row contributes to later rows, as MathJSON, so a cached row can be
 * replayed into a fresh engine without recomputing it.
 */
export interface Definition {
  name: string
  value: unknown
}

export interface CacheEntry {
  key: string
  result: RowResult
  definition?: Definition
}

export interface RunRequest {
  type: 'run'
  runId: number
  rows: RowInput[]
  settings: Settings
  cache: CacheEntry[]
  /** Row keys that previously timed out; they are reported, not recomputed. */
  skip: string[]
}

export type WorkerMessage =
  | { type: 'start'; runId: number; rowId: string; key: string }
  | { type: 'result'; runId: number; rowId: string; entry: CacheEntry }
  | { type: 'done'; runId: number }
