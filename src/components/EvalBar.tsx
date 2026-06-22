import type { EvalResult } from '../types'
import { winProbability } from '../analysis/winProbability'
import './EvalBar.css'

interface EvalBarProps {
  eval: EvalResult | null
  orientation: 'white' | 'black'
}

function toWhitePct(e: EvalResult | null): number {
  if (e === null) return 50
  if (e.mate !== null) return e.mate > 0 ? 100 : 0
  if (e.cp !== null) return winProbability(e.cp)
  return 50
}

function labelText(e: EvalResult | null): string {
  if (e === null) return ''
  if (e.mate !== null) return `M${Math.abs(e.mate)}`
  if (e.cp !== null) {
    const pawn = (Math.abs(e.cp) / 100).toFixed(1)
    return e.cp >= 0 ? `+${pawn}` : `-${pawn}`
  }
  return ''
}

export function EvalBar({ eval: e, orientation }: EvalBarProps) {
  const whitePct = toWhitePct(e)

  // "My" side sits at the bottom; percentage tells how much of the bar I own.
  const myPct = orientation === 'white' ? whitePct : 100 - whitePct
  const opponentPct = 100 - myPct
  const myWinning = myPct >= 50

  const myClass    = orientation === 'white' ? 'eb-light' : 'eb-dark'
  const oppClass   = orientation === 'white' ? 'eb-dark'  : 'eb-light'

  const label = labelText(e)

  // Label sits centred inside the winning section, clamped away from edges.
  // "Winning section" when myWinning = bottom section; top when opponent winning.
  const rawPct = myWinning ? 100 - myPct / 2 : opponentPct / 2
  const labelTopPct = Math.max(4, Math.min(96, rawPct))

  // Contrast: label must be readable against its background section.
  // Light bg (eb-light) → dark text; dark bg (eb-dark) → light text.
  const labelOnLight = myWinning
    ? orientation === 'white'   // winning as white → label in light section
    : orientation === 'black'   // losing as black → opponent is white → label in light section
  const labelColor = labelOnLight ? '#1a1a1a' : '#f0ede8'

  return (
    // Outer wrap: full height, no overflow-clip so the label can be read freely
    <div className="eval-bar-wrap" aria-label={label ? `Eval ${label}` : 'Equal'} role="img">
      {/* Inner bar: clipped to border-radius */}
      <div className="eval-bar">
        <div className={`eb-section ${oppClass}`}  style={{ height: `${opponentPct}%` }} />
        <div className={`eb-section ${myClass}`}   style={{ height: `${myPct}%` }} />
      </div>

      {/* Label floats outside the clipping box, centred on the winning section */}
      {label && (
        <span
          className="eb-label"
          style={{ top: `${labelTopPct}%`, color: labelColor }}
        >
          {label}
        </span>
      )}
    </div>
  )
}
