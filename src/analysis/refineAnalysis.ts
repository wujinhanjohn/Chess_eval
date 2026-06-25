/**
 * Second analysis pass: targeted multi-PV evaluation for Brilliant/Great detection.
 *
 * Returns a Map from ply index → top-2 MultiPVResult[] from the position BEFORE
 * that ply, but only for plies that could ACTUALLY upgrade. classifyGame only
 * awards Brilliant/Great when the played move is the engine's top move and the
 * side wasn't already winning, so we pre-filter to exactly those positions using
 * data the first pass already produced (best move + before/after evals). This
 * skips the costly multi-PV search on the large majority of Best/Excellent moves
 * that can never qualify, which is the main analysis-time saving.
 */

import { Chess } from 'chess.js'
import { Engine } from '../engine/Engine'
import type { AnalyzedPly, MultiPVResult } from '../types'
import type { ClassifiedMove } from './classifyGame'
import { MoveQuality, CLASSIFICATION_THRESHOLDS } from './moveQuality'
import { evalToMoverWinPct } from './winProbability'
import type { AnalysisSignal } from './analyzeGame'

const MULTIPV_COUNT = 2

/** UCI of the move that produced `san` from `beforeFen`, or null if illegal. */
function playedUci(beforeFen: string, san: string): string | null {
  try {
    const chess = new Chess(beforeFen)
    const move = chess.move(san)
    return move ? move.from + move.to + (move.promotion ?? '') : null
  } catch {
    return null
  }
}

export async function refineAnalysis(
  analyzedPlies: AnalyzedPly[],
  baseClassifications: ClassifiedMove[],
  depth: number,
  engine: Engine,
  signal: AnalysisSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<number, MultiPVResult[]>> {
  await engine.ready

  const t = CLASSIFICATION_THRESHOLDS

  const candidates: number[] = []
  for (let k = 1; k < analyzedPlies.length; k++) {
    const q = baseClassifications[k]?.quality
    if (q !== MoveQuality.Best && q !== MoveQuality.Excellent) continue

    const before = analyzedPlies[k - 1]
    const after = analyzedPlies[k]

    // Necessary condition #1: the played move must be the engine's best move.
    // (Brilliant/Great are only ever assigned when playedIsTop.)
    const best = before.eval.bestMove
    if (!best) continue
    if (playedUci(before.fen, after.san) !== best) continue

    // Necessary condition #2: the side wasn't already (almost) winning before
    // the move — otherwise neither Great (≤97%) nor Brilliant (≤90%) can fire.
    if (evalToMoverWinPct(before.eval, after.color) > t.greatMaxWinBefore) continue

    candidates.push(k)
  }

  const result = new Map<number, MultiPVResult[]>()
  const total = candidates.length
  let done = 0
  onProgress?.(0, total)

  for (const k of candidates) {
    if (signal.cancelled) break

    // Evaluate the position BEFORE ply k (position k-1) with multi-PV
    const posBefore = analyzedPlies[k - 1].fen
    const pvs = await engine.evaluateMultiPV(posBefore, depth, MULTIPV_COUNT)

    if (signal.cancelled) break

    result.set(k, pvs)
    done++
    onProgress?.(done, total)
  }

  return result
}
