import { useEffect, useRef } from 'react'
import type { MathfieldElement } from 'mathlive'
import type { MathLive } from '../lib/mathlive'

export interface MathFieldHandlers {
  onChange: (latex: string) => void
  /** Enter: start a new row below. */
  onEnter: () => void
  /** Backspace in an empty field: remove the row. */
  onDeleteEmpty: () => void
  /** Arrow keys pressed with nowhere left to go inside the field. */
  onMoveOut: (direction: 'up' | 'down') => void
  onFocus: () => void
}

interface Props extends MathFieldHandlers {
  mathlive: MathLive
  value: string
  placeholder?: string
  register: (field: MathfieldElement | null) => void
}

/**
 * A `<math-field>` managed imperatively: React re-rendering the web component
 * would reset its caret, so the element is created once and synced by hand.
 */
export function MathField({ mathlive, value, placeholder, register, ...handlers }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const field = useRef<MathfieldElement | null>(null)
  const latest = useRef(handlers)
  latest.current = handlers

  useEffect(() => {
    const mf = new mathlive.MathfieldElement()
    mf.smartFence = true
    // The keyboard is shown and hidden by the calculator, not per field.
    mf.mathVirtualKeyboardPolicy = 'manual'
    mf.value = value
    if (placeholder) mf.placeholder = placeholder
    mf.className = 'block w-full'

    mf.addEventListener('input', () => latest.current.onChange(mf.value))
    mf.addEventListener('focusin', () => latest.current.onFocus())
    mf.addEventListener('move-out', (event) => {
      const direction = event.detail.direction
      if (direction === 'upward' || direction === 'downward') {
        event.preventDefault()
        latest.current.onMoveOut(direction === 'upward' ? 'up' : 'down')
      }
    })
    // Capture runs before MathLive's own handler, so the value is still the
    // one from before this key press.
    mf.addEventListener(
      'keydown',
      (event) => {
        const plain = !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey
        if (event.key === 'Enter' && plain) {
          event.preventDefault()
          event.stopPropagation()
          latest.current.onEnter()
        } else if (event.key === 'Backspace' && plain && mf.value === '') {
          event.preventDefault()
          event.stopPropagation()
          latest.current.onDeleteEmpty()
        }
      },
      { capture: true },
    )

    container.current!.append(mf)
    field.current = mf
    register(mf)
    return () => {
      register(null)
      mf.remove()
      field.current = null
    }
    // The element is created once; later prop changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mathlive])

  useEffect(() => {
    const mf = field.current
    if (mf && mf.value !== value) mf.value = value
  }, [value])

  return <div ref={container} className="min-w-0 flex-1" />
}
