import { MOVE_QUALITY_LABELS, MoveQuality } from '../analysis/moveQuality'
import type { BrilliantGreatDebug } from '../analysis/moveQuality'
import './MoveQualityBadge.css'

interface Props {
  quality: MoveQuality
  compact?: boolean
  debug?: BrilliantGreatDebug
}

const QUALITY_SYMBOL: Partial<Record<MoveQuality, string>> = {
  [MoveQuality.Brilliant]: '★',
  [MoveQuality.Great]: '✦',
  [MoveQuality.Best]: '●',
  [MoveQuality.Excellent]: '◆',
  [MoveQuality.Good]: '▲',
  [MoveQuality.Book]: '☰',
  [MoveQuality.Inaccuracy]: '?',
  [MoveQuality.Mistake]: '!',
  [MoveQuality.Miss]: '✕',
  [MoveQuality.Blunder]: '‼',
}

function buildTitle(quality: MoveQuality, debug?: BrilliantGreatDebug): string {
  const base = MOVE_QUALITY_LABELS[quality]
  if (!debug) return base
  const parts = [
    base,
    `win before: ${debug.moverWinBefore.toFixed(1)}%`,
    `win after: ${debug.moverWinAfter.toFixed(1)}%`,
  ]
  if (debug.sac) parts.push('sacrifice: yes')
  if (debug.gap !== null) parts.push(`#1/#2 gap: ${debug.gap.toFixed(1)}%`)
  return parts.join(' · ')
}

export function MoveQualityBadge({ quality, compact = false, debug }: Props) {
  const label = MOVE_QUALITY_LABELS[quality]
  const symbol = QUALITY_SYMBOL[quality] ?? '·'
  const title = buildTitle(quality, debug)

  return (
    <span
      className={`mq-badge mq-${quality}${compact ? ' mq-compact' : ''}`}
      title={title}
      aria-label={label}
    >
      <span className="mq-dot" aria-hidden="true">
        {symbol}
      </span>
      {!compact && <span className="mq-label">{label}</span>}
    </span>
  )
}
