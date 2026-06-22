import { useRef, useState, useCallback, useMemo, useId } from 'react'
import type { AnalyzedPly } from '../types'
import type { ClassifiedMove } from '../analysis/classifyGame'
import { MoveQuality } from '../analysis/moveQuality'
import { evalToWhiteWinPct } from '../analysis/winProbability'
import './EvalGraph.css'

// SVG viewBox coordinate space (logical units — SVG stretches to fill container)
const VB_W = 480
const VB_H = 120
const MID_Y = VB_H / 2   // y = 60 → 50% win prob (equal position)

// Dot markers for turning-point classifications
const QUALITY_DOT: Partial<Record<MoveQuality, string>> = {
  [MoveQuality.Blunder]:    '#ef4444',
  [MoveQuality.Mistake]:    '#f97316',
  [MoveQuality.Miss]:       '#eab308',
  [MoveQuality.Inaccuracy]: '#fbbf24',
}

interface Props {
  analyzedPlies: AnalyzedPly[]
  currentPly: number
  onSelectPly: (ply: number) => void
  classifications?: ClassifiedMove[]
  disabled?: boolean   // true when in PV preview or explore mode — scrubbing is blocked
}

function fmtEval(ply: AnalyzedPly): string {
  const e = ply.eval
  if (e.mate !== null) return e.mate > 0 ? `M+${Math.abs(e.mate)}` : `M−${Math.abs(e.mate)}`
  if (e.cp !== null) {
    const v = (Math.abs(e.cp) / 100).toFixed(1)
    return e.cp >= 0 ? `+${v}` : `−${v}`
  }
  return '='
}

export function EvalGraph({ analyzedPlies, currentPly, onSelectPly, classifications, disabled }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const uid = useId()
  const clipTopId = `eg-clip-top-${uid}`
  const clipBotId = `eg-clip-bot-${uid}`
  const isDragging = useRef(false)
  const [hover, setHover] = useState<{ leftPct: number; plyIdx: number } | null>(null)

  const N = analyzedPlies.length

  const winPcts = useMemo(
    () => analyzedPlies.map(p => evalToWhiteWinPct(p.eval)),
    [analyzedPlies],
  )

  // ply index → viewBox x
  const xOf = useCallback(
    (i: number): number => N <= 1 ? VB_W / 2 : (i / (N - 1)) * VB_W,
    [N],
  )

  // win% → viewBox y (100% = top = 0; 0% = bottom = VB_H)
  const yOf = (pct: number): number => (1 - pct / 100) * VB_H

  const points = useMemo(
    () => winPcts.map((pct, i) => [xOf(i), yOf(pct)] as [number, number]),
    [winPcts, xOf],
  )

  const polyStr = useMemo(
    () => points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '),
    [points],
  )

  // Area from curve up to y=0 — fills White advantage region when clipped to top half
  // Area from curve down to y=VB_H — fills Black advantage region when clipped to bottom half
  const { whiteArea, blackArea } = useMemo(() => {
    if (points.length < 2) return { whiteArea: '', blackArea: '' }
    const curve = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L ')
    const x0 = points[0][0].toFixed(1)
    const xN = points[points.length - 1][0].toFixed(1)
    return {
      whiteArea: `M ${x0},0 L ${curve} L ${xN},0 Z`,
      blackArea: `M ${x0},${VB_H} L ${curve} L ${xN},${VB_H} Z`,
    }
  }, [points])

  // Dot markers for notable moves
  const dots = useMemo(() => {
    if (!classifications) return []
    return classifications.flatMap(c => {
      if (!c.quality) return []
      const color = QUALITY_DOT[c.quality]
      if (!color || c.plyIndex >= N) return []
      const pct = winPcts[c.plyIndex]
      if (pct === undefined) return []
      return [{ x: xOf(c.plyIndex), y: yOf(pct), color }]
    })
  }, [classifications, winPcts, xOf, N])

  // Convert clientX → ply index (using actual rendered SVG width)
  const plyFromClientX = useCallback(
    (clientX: number): number => {
      const svg = svgRef.current
      if (!svg || N === 0) return 0
      const rect = svg.getBoundingClientRect()
      const ratio = (clientX - rect.left) / rect.width
      return Math.max(0, Math.min(N - 1, Math.round(ratio * (N - 1))))
    },
    [N],
  )

  // Convert clientX → left% for tooltip positioning
  const leftPctFromClientX = useCallback((clientX: number): number => {
    const svg = svgRef.current
    if (!svg) return 0
    const rect = svg.getBoundingClientRect()
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100))
  }, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const plyIdx = plyFromClientX(e.clientX)
      setHover({ leftPct: leftPctFromClientX(e.clientX), plyIdx })
      if (isDragging.current && !disabled) onSelectPly(plyIdx)
    },
    [plyFromClientX, leftPctFromClientX, onSelectPly, disabled],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      isDragging.current = true
      if (!disabled) onSelectPly(plyFromClientX(e.clientX))
    },
    [plyFromClientX, onSelectPly, disabled],
  )

  const handleMouseUp = useCallback(() => { isDragging.current = false }, [])

  const handleMouseLeave = useCallback(() => {
    isDragging.current = false
    setHover(null)
  }, [])

  const currentX = N > 0 ? xOf(currentPly) : VB_W / 2

  // Clamp tooltip X so it doesn't overflow chart edges
  const hoverPly = hover ? analyzedPlies[hover.plyIdx] : null
  const ttLeft = hover ? hover.leftPct : 0
  const ttXform = ttLeft < 10 ? 'translateX(0)' : ttLeft > 90 ? 'translateX(-100%)' : 'translateX(-50%)'

  if (N < 2) return null

  return (
    <div className="eval-graph-wrap">
      {/* Side labels */}
      <div className="eval-graph-axis-labels" aria-hidden="true">
        <span className="eval-graph-axis-lbl">W</span>
        <span className="eval-graph-axis-lbl">B</span>
      </div>

      {/* Chart */}
      <div className="eval-graph-chart">
        <svg
          ref={svgRef}
          className={`eval-graph-svg${disabled ? ' eval-graph-svg--dim' : ''}`}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          preserveAspectRatio="none"
          aria-label="Game evaluation graph"
          onMouseMove={handleMouseMove}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <clipPath id={clipTopId}>
              <rect x="0" y="0" width={VB_W} height={MID_Y} />
            </clipPath>
            <clipPath id={clipBotId}>
              <rect x="0" y={MID_Y} width={VB_W} height={MID_Y} />
            </clipPath>
          </defs>

          {/* Two-tone background: White zone (top) / Black zone (bottom) */}
          <rect x="0" y="0" width={VB_W} height={MID_Y} className="eg-bg-w" />
          <rect x="0" y={MID_Y} width={VB_W} height={MID_Y} className="eg-bg-b" />

          {/* Advantage fills (clipped to their respective halves) */}
          {whiteArea && <path d={whiteArea} className="eg-fill-w" clipPath={`url(#${clipTopId})`} />}
          {blackArea && <path d={blackArea} className="eg-fill-b" clipPath={`url(#${clipBotId})`} />}

          {/* Center line (50%) */}
          <line x1="0" y1={MID_Y} x2={VB_W} y2={MID_Y} className="eg-midline" />

          {/* Win% curve */}
          {polyStr && <polyline points={polyStr} className="eg-curve" />}

          {/* Classification dot markers */}
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={3.5} fill={d.color} className="eg-dot" />
          ))}

          {/* Hover ghost line */}
          {hover && (
            <line
              x1={xOf(hover.plyIdx)} y1={0}
              x2={xOf(hover.plyIdx)} y2={VB_H}
              className="eg-hover-line"
            />
          )}

          {/* Current ply cursor */}
          <line x1={currentX} y1={0} x2={currentX} y2={VB_H} className="eg-cursor" />
        </svg>

        {/* Tooltip (HTML overlay — no distortion from SVG scaling) */}
        {hover && hoverPly && (
          <div
            className="eval-graph-tooltip"
            style={{ left: `${ttLeft}%`, transform: ttXform }}
          >
            <span className="eg-tt-move">
              {hoverPly.moveNumber > 0
                ? `${hoverPly.moveNumber}${hoverPly.color === 'b' ? '…' : '.'} ${hoverPly.san}`
                : 'Start'}
            </span>
            <span className="eg-tt-eval">{fmtEval(hoverPly)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
