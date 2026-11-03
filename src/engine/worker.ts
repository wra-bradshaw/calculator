/// <reference lib="webworker" />
import { evaluateSheet } from './sheet'
import type { RunRequest, WorkerMessage } from './types'

const post = (message: WorkerMessage) => self.postMessage(message)

self.onmessage = (event: MessageEvent<RunRequest>) => {
  const { runId, rows, settings, cache, skip } = event.data
  evaluateSheet(
    rows,
    settings,
    new Map(cache.map((entry) => [entry.key, entry])),
    new Set(skip),
    {
      onStart: (rowId, key) => post({ type: 'start', runId, rowId, key }),
      onResult: (rowId, entry) => post({ type: 'result', runId, rowId, entry }),
    },
  )
  post({ type: 'done', runId })
}
