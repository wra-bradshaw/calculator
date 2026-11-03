import { Grid2X2Icon, Grid3X3Icon, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { MathLive } from '../lib/mathlive'

interface Template {
  /** Shown on the button, as LaTeX, or an icon. */
  label: string | LucideIcon
  title: string
  /** Inserted into the focused field; `#0` is the selection, `#?` a placeholder. */
  insert: string
}

const GROUPS: Template[][] = [
  [
    { label: '\\frac{d}{dx}', title: 'Derivative', insert: '\\frac{d}{dx}\\left(#0\\right)' },
    { label: '\\int', title: 'Integral', insert: '\\int #0\\,dx' },
    { label: '\\int_a^b', title: 'Definite integral', insert: '\\int_{#?}^{#?}#0\\,dx' },
    { label: '\\lim', title: 'Limit', insert: '\\lim_{x\\to #?}#0' },
    { label: '\\sum', title: 'Sum', insert: '\\sum_{n=#?}^{#?}#0' },
    { label: '\\prod', title: 'Product', insert: '\\prod_{n=#?}^{#?}#0' },
  ],
  [
    { label: '\\sqrt{x}', title: 'Square root', insert: '\\sqrt{#0}' },
    { label: '\\sqrt[n]{x}', title: 'nth root', insert: '\\sqrt[#?]{#0}' },
    { label: '|x|', title: 'Absolute value', insert: '\\left|#0\\right|' },
    { label: 'n!', title: 'Factorial', insert: '#0!' },
    { label: '\\binom{n}{k}', title: 'Binomial coefficient', insert: '\\binom{#?}{#?}' },
  ],
  [
    {
      label: Grid2X2Icon,
      title: '2×2 matrix',
      insert: '\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}',
    },
    {
      label: Grid3X3Icon,
      title: '3×3 matrix',
      insert: '\\begin{pmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{pmatrix}',
    },
    { label: '\\det', title: 'Determinant', insert: '\\det\\left(#0\\right)' },
    { label: 'A^{-1}', title: 'Inverse', insert: '#0^{-1}' },
    { label: 'A^{T}', title: 'Transpose', insert: '#0^{T}' },
    { label: '\\lambda', title: 'Eigenvalues', insert: '\\operatorname{Eigenvalues}\\left(#0\\right)' },
    { label: '\\times', title: 'Cross product', insert: '\\operatorname{Cross}\\left(#?,#?\\right)' },
  ],
  [
    { label: '\\text{expand}', title: 'Expand', insert: '\\operatorname{Expand}\\left(#0\\right)' },
    { label: '\\text{factor}', title: 'Factor', insert: '\\operatorname{Factor}\\left(#0\\right)' },
    { label: '\\text{series}', title: 'Taylor series about 0', insert: '\\operatorname{Series}\\left(#0,x\\right)' },
  ],
]

interface Props {
  mathlive: MathLive
  onInsert: (latex: string) => void
}

export function Toolbar({ mathlive, onInsert }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {GROUPS.map((group, i) => (
        <ButtonGroup key={i} className="flex-wrap">
          {group.map((template) => (
            <Tooltip key={template.title}>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-lg"
                    aria-label={template.title}
                    // Keep focus (and the caret) in the math field.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onInsert(template.insert)}
                    className="h-10 w-auto min-w-10 px-2"
                  />
                }
              >
                {typeof template.label === 'string' ? (
                  <span
                    className="toolbar-math"
                    dangerouslySetInnerHTML={{
                      __html: mathlive.convertLatexToMarkup(template.label),
                    }}
                  />
                ) : (
                  <template.label className="size-5" />
                )}
              </TooltipTrigger>
              <TooltipContent>{template.title}</TooltipContent>
            </Tooltip>
          ))}
        </ButtonGroup>
      ))}
    </div>
  )
}
