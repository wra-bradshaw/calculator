import { useCallback, useEffect, useRef, useState } from 'react'
import type { MathfieldElement } from 'mathlive'
import { EraserIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Kbd } from '@/components/ui/kbd'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { SheetEvaluator, type SheetState } from '../engine/client'
import type { AngleUnit, RowInput, Settings } from '../engine/types'
import { useMathLive } from '../lib/mathlive'
import { DEFAULT_SETTINGS, load, save } from '../lib/storage'
import { MathField } from './MathField'
import { Result } from './Result'
import { Toolbar } from './Toolbar'

const newRow = (latex = ''): RowInput => ({ id: crypto.randomUUID(), latex })

/** There is always an empty row at the end to type into, as in Desmos. */
function withTrailingEmpty(rows: RowInput[]): RowInput[] {
  return rows.length > 0 && rows[rows.length - 1].latex === '' ? rows : [...rows, newRow()]
}

const DIGIT_OPTIONS = [4, 6, 8, 10, 12, 15]

const EXAMPLES = [
  'a=3',
  'f(x)=x^2+a',
  "f'(2)",
  '\\int_0^1f(x)\\,dx',
  '\\frac{d}{dx}\\sin\\left(x^2\\right)',
  '\\int x\\sin x\\,dx',
  'x^2-5x+6=0',
  '\\sum_{n=1}^{\\infty}\\frac{1}{n^2}',
  '\\lim_{x\\to0}\\frac{\\sin x}{x}',
  'A=\\begin{pmatrix}2&1\\\\1&2\\end{pmatrix}',
  'A^{-1}',
  '\\operatorname{Eigenvalues}\\left(A\\right)',
]

export function Calculator() {
  const mathlive = useMathLive()
  const [rows, setRows] = useState<RowInput[] | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [sheet, setSheet] = useState<SheetState>({ results: new Map(), pending: new Set() })

  const fields = useRef(new Map<string, MathfieldElement>())
  const lastFocused = useRef<string | null>(null)
  const evaluator = useRef<SheetEvaluator | null>(null)

  useEffect(() => {
    const saved = load()
    setRows(withTrailingEmpty(saved?.rows ?? []))
    if (saved) setSettings(saved.settings)
  }, [])

  useEffect(() => {
    const instance = new SheetEvaluator(setSheet)
    evaluator.current = instance
    return () => instance.dispose()
  }, [])

  useEffect(() => {
    if (!rows) return
    evaluator.current?.run(rows, settings)
    const timer = setTimeout(
      () => save({ rows: rows.filter((r) => r.latex !== ''), settings }),
      300,
    )
    return () => clearTimeout(timer)
  }, [rows, settings])

  const focusRow = useCallback((id: string | undefined, atStart = false) => {
    if (!id) return
    // The field may not exist until the next render.
    requestAnimationFrame(() => {
      const field = fields.current.get(id)
      if (!field) return
      field.focus()
      field.position = atStart ? 0 : field.lastOffset
    })
  }, [])

  const update = (fn: (rows: RowInput[]) => RowInput[]) =>
    setRows((rows) => withTrailingEmpty(fn(rows ?? [])))

  const handlersFor = (row: RowInput, index: number) => ({
    onChange: (latex: string) =>
      update((rows) => rows.map((r) => (r.id === row.id ? { ...r, latex } : r))),
    onEnter: () => {
      const next = rows![index + 1]
      if (next && next.latex === '') {
        focusRow(next.id)
        return
      }
      const inserted = newRow()
      update((rows) => [...rows.slice(0, index + 1), inserted, ...rows.slice(index + 1)])
      focusRow(inserted.id)
    },
    onDeleteEmpty: () => {
      if (rows!.length <= 1) return
      focusRow(rows![index - 1]?.id ?? rows![index + 1]?.id)
      update((rows) => rows.filter((r) => r.id !== row.id))
    },
    onMoveOut: (direction: 'up' | 'down') =>
      focusRow(rows![direction === 'up' ? index - 1 : index + 1]?.id, direction === 'down'),
    onFocus: () => {
      lastFocused.current = row.id
    },
  })

  const insert = (latex: string) => {
    const active = [...fields.current].find(([, f]) => f === document.activeElement)?.[0]
    const id = active ?? lastFocused.current ?? rows?.at(-1)?.id
    const field = id ? fields.current.get(id) : undefined
    if (!field) return
    field.focus()
    field.insert(latex, { selectionMode: 'placeholder', format: 'latex' })
    // insert() doesn't fire an input event.
    update((rows) => rows.map((r) => (r.id === id ? { ...r, latex: field.value } : r)))
  }

  const removeRow = (id: string) => update((rows) => rows.filter((r) => r.id !== id))

  const clearAll = () => {
    const fresh = newRow()
    setRows([fresh])
    focusRow(fresh.id)
  }

  const loadExamples = () => {
    setRows(withTrailingEmpty([...(rows ?? []).filter((r) => r.latex !== ''), ...EXAMPLES.map((l) => newRow(l))]))
  }

  if (!mathlive || !rows) {
    return <div className="p-8 text-center text-muted-foreground">Loading…</div>
  }

  const isBlank = rows.every((r) => r.latex === '')

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-heading text-xl font-semibold tracking-tight">Calculator</h1>
        <div className="flex items-center gap-2">
          <ToggleGroup
            variant="outline"
            size="sm"
            spacing={0}
            value={[settings.angleUnit]}
            onValueChange={(value: string[]) => {
              // Ignore deselection: one unit is always active.
              const angleUnit = value[0] as AngleUnit | undefined
              if (angleUnit) setSettings((s) => ({ ...s, angleUnit }))
            }}
            aria-label="Angle unit"
          >
            <ToggleGroupItem value="rad">Rad</ToggleGroupItem>
            <ToggleGroupItem value="deg">Deg</ToggleGroupItem>
          </ToggleGroup>
          <Select
            items={DIGIT_OPTIONS.map((d) => ({ value: d, label: `${d} digits` }))}
            value={settings.digits}
            onValueChange={(digits) => {
              if (digits !== null) setSettings((s) => ({ ...s, digits }))
            }}
          >
            <SelectTrigger size="sm" aria-label="Digits shown">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIGIT_OPTIONS.map((d) => (
                <SelectItem key={d} value={d}>
                  {d} digits
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <EraserIcon data-icon="inline-start" />
            Clear
          </Button>
        </div>
      </header>

      <Toolbar mathlive={mathlive} onInsert={insert} />

      <Card className="gap-0 py-0">
        <ol className="divide-y">
          {rows.map((row, index) => (
            <li key={row.id} className="group">
              <div className="flex items-center gap-3 py-3 pr-3">
                <span className="w-9 shrink-0 select-none text-right text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <MathField
                  mathlive={mathlive}
                  value={row.latex}
                  placeholder={index === 0 && isBlank ? '\\text{Type an expression…}' : undefined}
                  register={(field) => {
                    if (field) fields.current.set(row.id, field)
                    else fields.current.delete(row.id)
                  }}
                  {...handlersFor(row, index)}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeRow(row.id)}
                  aria-label={`Delete row ${index + 1}`}
                  className={cn(
                    'text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
                    row.latex === '' && 'invisible',
                  )}
                >
                  <XIcon />
                </Button>
              </div>
              <Result
                mathlive={mathlive}
                result={sheet.results.get(row.id)}
                pending={sheet.pending.has(row.id)}
              />
            </li>
          ))}
        </ol>
      </Card>

      {isBlank && (
        <p className="text-center text-sm text-muted-foreground">
          New here?
          <Button variant="link" size="sm" onClick={loadExamples}>
            Load some examples
          </Button>
        </p>
      )}

      <footer className="mt-auto pt-6 text-center text-xs text-muted-foreground">
        Define variables with <code>a=3</code> and functions with <code>f(x)=…</code>. Equations
        are solved for <code>x</code>. <Kbd>Enter</Kbd> adds a row.
      </footer>
    </div>
  )
}
