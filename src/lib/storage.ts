import type { RowInput, Settings } from '../engine/types'

const KEY = 'calculator:v1'

export interface Saved {
  rows: RowInput[]
  settings: Settings
}

export const DEFAULT_SETTINGS: Settings = { angleUnit: 'rad', digits: 10 }

export function load(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as Partial<Saved>
    if (!Array.isArray(saved.rows)) return null
    return {
      rows: saved.rows.filter(
        (r): r is RowInput => typeof r?.id === 'string' && typeof r?.latex === 'string',
      ),
      settings: { ...DEFAULT_SETTINGS, ...saved.settings },
    }
  } catch {
    return null
  }
}

export function save(saved: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved))
  } catch {
    // Storage full or disabled: the sheet just won't persist.
  }
}
