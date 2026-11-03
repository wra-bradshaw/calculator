import type {
  CacheEntry,
  RowInput,
  RowResult,
  RunRequest,
  Settings,
  WorkerMessage,
} from './types'

/** A row computing for longer than this is abandoned and marked as timed out. */
const ROW_TIMEOUT_MS = 5000
const MAX_CACHE_ENTRIES = 500

export interface SheetState {
  results: ReadonlyMap<string, RowResult>
  /** Rows whose displayed result is from an older input. */
  pending: ReadonlySet<string>
}

interface Input {
  version: number
  rows: RowInput[]
  settings: Settings
}

/**
 * Runs sheet evaluation in a worker, keeping the page responsive.
 *
 * The engine can't be interrupted, so a row that runs too long is stopped by
 * terminating the worker; the sheet is then re-run with that row skipped.
 * Results are cached here, not in the worker, so they survive restarts.
 */
export class SheetEvaluator {
  private worker: Worker | null = null
  private latest: Input | null = null
  private active: { runId: number; input: Input } | null = null
  private current: { rowId: string; key: string; timer: number } | null = null
  private runId = 0
  private version = 0

  private cache = new Map<string, CacheEntry>()
  private skip = new Set<string>()
  private results = new Map<string, RowResult>()
  /** Rows given a result in the run for the latest input. */
  private fresh = new Set<string>()

  constructor(private onUpdate: (state: SheetState) => void) {}

  run(rows: RowInput[], settings: Settings) {
    const previous = this.latest
    this.latest = { version: ++this.version, rows, settings }

    if (!this.active) {
      this.dispatch()
      return
    }
    // Let the active run finish unless the row it's computing is now stale;
    // the next run reuses its cached results.
    if (this.current && previous && this.isObsolete(this.current.rowId, previous)) {
      this.restart()
      this.dispatch()
    }
    this.emit()
  }

  dispose() {
    this.clearCurrent()
    this.worker?.terminate()
    this.worker = null
  }

  private isObsolete(rowId: string, previous: Input) {
    const latest = this.latest!
    if (JSON.stringify(latest.settings) !== JSON.stringify(previous.settings)) return true
    const before = previous.rows.find((r) => r.id === rowId)
    const after = latest.rows.find((r) => r.id === rowId)
    return !after || before?.latex !== after.latex
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (event: MessageEvent<WorkerMessage>) =>
      this.handle(event.data)
    worker.onerror = (event) => {
      event.preventDefault()
      console.error('Calculator worker crashed:', event.message)
      // Treat a crash like a timeout of the row being computed.
      if (this.current) this.skip.add(this.current.key)
      this.restart()
      this.dispatch()
    }
    this.worker = worker
    return worker
  }

  private dispatch() {
    const input = this.latest
    if (!input) return
    const runId = ++this.runId
    this.active = { runId, input }
    this.fresh.clear()
    const request: RunRequest = {
      type: 'run',
      runId,
      rows: input.rows,
      settings: input.settings,
      cache: [...this.cache.values()],
      skip: [...this.skip],
    }
    this.ensureWorker().postMessage(request)
    this.emit()
  }

  private restart() {
    this.clearCurrent()
    this.worker?.terminate()
    this.worker = null
    this.active = null
  }

  private clearCurrent() {
    if (this.current) clearTimeout(this.current.timer)
    this.current = null
  }

  private handle(message: WorkerMessage) {
    if (message.runId !== this.active?.runId) return

    switch (message.type) {
      case 'start': {
        this.clearCurrent()
        const { rowId, key } = message
        const timer = window.setTimeout(() => {
          this.skip.add(key)
          this.restart()
          this.dispatch()
        }, ROW_TIMEOUT_MS)
        this.current = { rowId, key, timer }
        break
      }

      case 'result': {
        this.clearCurrent()
        const { rowId, entry } = message
        if (entry.key) {
          this.cache.delete(entry.key)
          this.cache.set(entry.key, entry)
          if (this.cache.size > MAX_CACHE_ENTRIES) {
            this.cache.delete(this.cache.keys().next().value!)
          }
        }
        this.results.set(rowId, entry.result)
        if (this.active.input.version === this.version) this.fresh.add(rowId)
        this.emit()
        break
      }

      case 'done': {
        this.clearCurrent()
        const finished = this.active.input
        this.active = null
        const ids = new Set(finished.rows.map((r) => r.id))
        for (const id of this.results.keys()) if (!ids.has(id)) this.results.delete(id)
        if (finished.version !== this.version) this.dispatch()
        else this.emit()
        break
      }
    }
  }

  private emit() {
    // With no active run, the latest input has been fully evaluated.
    const pending = new Set<string>()
    if (this.active) {
      const runIsLatest = this.active.input.version === this.version
      for (const row of this.latest?.rows ?? []) {
        if (!runIsLatest || !this.fresh.has(row.id)) pending.add(row.id)
      }
    }
    this.onUpdate({ results: new Map(this.results), pending })
  }
}
