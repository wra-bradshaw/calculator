import { useEffect, useState } from 'react'
import 'mathlive/static.css'

export type MathLive = typeof import('mathlive')

let loading: Promise<MathLive> | null = null

/** MathLive touches the DOM on import, so it's loaded on demand in the browser. */
export function loadMathLive(): Promise<MathLive> {
  loading ??= import('mathlive').then((mathlive) => {
    // Fonts come from mathlive/static.css, bundled by Vite.
    mathlive.MathfieldElement.fontsDirectory = null
    mathlive.MathfieldElement.soundsDirectory = null
    return mathlive
  })
  return loading
}

export function useMathLive(): MathLive | null {
  const [mathlive, setMathLive] = useState<MathLive | null>(null)
  useEffect(() => {
    let cancelled = false
    loadMathLive().then((m) => !cancelled && setMathLive(m))
    return () => {
      cancelled = true
    }
  }, [])
  return mathlive
}
