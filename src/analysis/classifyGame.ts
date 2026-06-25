import { Chess } from 'chess.js'
import type { AnalyzedPly, EvalResult, MultiPVResult } from '../types'
import { evalToMoverWinPct } from './winProbability'
import { CLASSIFICATION_THRESHOLDS, MoveQuality } from './moveQuality'
import type { BrilliantGreatDebug } from './moveQuality'
import { isBookPosition, getOpeningAt, toPositionKey } from './openingBook'
import type { OpeningEntry } from './openingBook'
import { isSacrifice } from './see'
import { explainMove } from './explainMove'
import type { MoveExplanation } from './explainMove'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClassifiedMove {
  plyIndex: number
  quality: MoveQuality | null  // null for ply 0 (no move)
  winLoss: number | null       // win-probability points given up; null for ply 0
  debug?: BrilliantGreatDebug  // present only for Brilliant / Great moves
  explanation?: MoveExplanation // present only for explained (inaccuracy-or-worse) moves
}

export interface GameClassification {
  moves: ClassifiedMove[]
  opening: OpeningEntry | null
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const BAD_BASE_QUALITIES: ReadonlySet<MoveQuality> = new Set([
  MoveQuality.Inaccuracy,
  MoveQuality.Mistake,
  MoveQuality.Blunder,
])

function playedUci(beforeFen: string, san: string): string | null {
  try {
    const chess = new Chess(beforeFen)
    const move = chess.move(san)
    if (!move) return null
    return move.from + move.to + (move.promotion ?? '')
  } catch {
    return null
  }
}

function mateFavorsMover(e: EvalResult, mover: 'w' | 'b'): boolean {
  if (e.mate === null) return false
  return mover === 'w' ? e.mate > 0 : e.mate < 0
}

function classifyByWinLoss(winLoss: number, isEngineBest: boolean): MoveQuality {
  const t = CLASSIFICATION_THRESHOLDS
  if (isEngineBest || winLoss < t.bestMax)    return MoveQuality.Best
  if (winLoss < t.excellentMax)               return MoveQuality.Excellent
  if (winLoss < t.goodMax)                    return MoveQuality.Good
  if (winLoss < t.inaccuracyMax)              return MoveQuality.Inaccuracy
  if (winLoss < t.mistakeMax)                 return MoveQuality.Mistake
  return MoveQuality.Blunder
}

function isMiss(
  baseQuality: MoveQuality,
  moverWinBefore: number,
  moverWinAfter: number,
  beforeEval: EvalResult,
  mover: 'w' | 'b',
): boolean {
  if (!BAD_BASE_QUALITIES.has(baseQuality)) return false
  const t = CLASSIFICATION_THRESHOLDS
  const wasWinning =
    moverWinBefore >= t.missWinBeforeMin || mateFavorsMover(beforeEval, mover)
  const droppedToEqualOrWorse = moverWinAfter <= t.missWinAfterMax
  return wasWinning && droppedToEqualOrWorse
}

/** Construct a minimal EvalResult from a MultiPVResult for win-% conversion. */
function mpvToEval(mpv: MultiPVResult): EvalResult {
  return { cp: mpv.cp, mate: mpv.mate, bestMove: mpv.move, pv: mpv.pv, depth: 0 }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Assigns a quality label to every ply that represents a played move.
 * Ply 0 (starting position) gets quality/winLoss null.
 *
 * Pass `multiPVCache` (from refineAnalysis) to enable Brilliant/Great detection.
 * Without it the function is fast and synchronous; with it Brilliant/Great are
 * assigned where the criteria are met.
 *
 * Precedence: Brilliant > Great > Miss > Book > eval-based (Best … Blunder).
 */
export function classifyGame(
  analyzedPlies: AnalyzedPly[],
  multiPVCache?: Map<number, MultiPVResult[]>,
): GameClassification {
  const moves: ClassifiedMove[] = [
    { plyIndex: 0, quality: null, winLoss: null },
  ]

  let inBook = true
  let opening: OpeningEntry | null = null

  const t = CLASSIFICATION_THRESHOLDS

  for (let k = 1; k < analyzedPlies.length; k++) {
    const before = analyzedPlies[k - 1]
    const after  = analyzedPlies[k]
    const mover  = after.color

    const moverWinBefore = evalToMoverWinPct(before.eval, mover)
    const moverWinAfter  = evalToMoverWinPct(after.eval,  mover)
    const winLoss        = Math.max(0, moverWinBefore - moverWinAfter)

    const uci = playedUci(before.fen, after.san)
    const isEngineBest =
      uci !== null &&
      before.eval.bestMove !== '' &&
      uci === before.eval.bestMove

    const baseQuality = classifyByWinLoss(winLoss, isEngineBest)

    // ── Book ──────────────────────────────────────────────────────────────
    let quality: MoveQuality = baseQuality

    if (inBook) {
      const posKey = toPositionKey(after.fen)
      if (isBookPosition(posKey)) {
        quality = MoveQuality.Book
        const entry = getOpeningAt(posKey)
        if (entry) opening = entry
      } else {
        inBook = false
      }
    }

    // ── Miss ──────────────────────────────────────────────────────────────
    if (quality !== MoveQuality.Book &&
        isMiss(baseQuality, moverWinBefore, moverWinAfter, before.eval, mover)) {
      quality = MoveQuality.Miss
    }

    // ── Brilliant / Great (requires multiPV data) ──────────────────────────
    let debug: BrilliantGreatDebug | undefined

    if (
      quality !== MoveQuality.Book &&
      uci !== null &&
      multiPVCache &&
      (baseQuality === MoveQuality.Best || baseQuality === MoveQuality.Excellent)
    ) {
      const pvs = multiPVCache.get(k)

      if (pvs && pvs.length > 0) {
        const top = pvs[0]
        const playedIsTop = uci === top.move
        const topMoverWin = evalToMoverWinPct(mpvToEval(top), mover)

        // Gap between best and second-best move (for Great)
        let gap: number | null = null
        if (pvs.length >= 2) {
          const second = pvs[1]
          const secondMoverWin = evalToMoverWinPct(mpvToEval(second), mover)
          gap = topMoverWin - secondMoverWin
        }

        if (playedIsTop) {
          // Check Brilliant first
          const sac = isSacrifice(before.fen, uci)

          if (
            sac &&
            moverWinAfter >= t.brilliantMinWinAfter &&
            moverWinBefore <= t.brilliantMaxWinBefore
          ) {
            quality = MoveQuality.Brilliant
            debug = { sac, gap, moverWinBefore, moverWinAfter }
            console.log(
              `[Brilliant] ply ${k} (${after.san}) — ` +
              `sac=true, winBefore=${moverWinBefore.toFixed(1)}%, ` +
              `winAfter=${moverWinAfter.toFixed(1)}%, ` +
              `winLoss=${winLoss.toFixed(2)}, gap=${gap?.toFixed(1) ?? 'n/a'}%`,
            )
          }
          // Then check Great (if not already Brilliant)
          else if (
            gap !== null &&
            gap >= t.greatGap &&
            pvs.length >= 2 &&
            moverWinBefore <= t.greatMaxWinBefore
          ) {
            quality = MoveQuality.Great
            debug = { sac, gap, moverWinBefore, moverWinAfter }
            console.log(
              `[Great] ply ${k} (${after.san}) — ` +
              `gap=${gap.toFixed(1)}%, winBefore=${moverWinBefore.toFixed(1)}%, ` +
              `winAfter=${moverWinAfter.toFixed(1)}%, winLoss=${winLoss.toFixed(2)}, sac=${sac}`,
            )
          }
        }
      }
    }

    // ── Explanation (inaccuracy or worse; engine-grounded) ──────────────────
    // Pure off the already-stored before/after evals — no re-search. Returns
    // null for good/forced/already-decided moves, so it self-gates.
    const explanation = explainMove(before, after, quality) ?? undefined

    moves.push({ plyIndex: k, quality, winLoss, debug, explanation })
  }

  return { moves, opening }
}
