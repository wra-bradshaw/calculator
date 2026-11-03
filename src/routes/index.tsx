import { createFileRoute } from '@tanstack/react-router'
import { Calculator } from '../components/Calculator'

export const Route = createFileRoute('/')({
  // MathLive and the evaluation worker only exist in the browser.
  ssr: false,
  component: Calculator,
})
