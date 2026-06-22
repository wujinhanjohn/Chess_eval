/**
 * Second analysis pass: targeted multi-PV evaluation for Brilliant/Great detection.
 *
 * Only re-analyses positions before moves already classified as Best or Excellent
 * (the only ones that can upgrade to Brilliant/Great).  Returns a Map from
 * ply index → top-2 MultiPVResult[] from the position BEFORE that ply.
 */

import { Engine } from '../engine/Engine'
import type { AnalyzedPly, MultiPVResult } from '../types'
import type { ClassifiedMove } from './classifyGame'
import { MoveQuality } from './moveQuality'
import type { AnalysisSignal } from './analyzeGame'

const MULTIPV_COUNT = 2

export async function refineAnalysis(
  analyzedPlies: AnalyzedPly[],
  baseClassifications: ClassifiedMove[],
  depth: number,
  engine: Engine,
  signal: AnalysisSignal,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<number, MultiPVResult[]>> {
  await engine.ready

  const candidates: number[] = []
  for (let k = 1; k < analyzedPlies.length; k++) {
    const q = baseClassifications[k]?.quality
    if (q === MoveQuality.Best || q === MoveQuality.Excellent) {
      candidates.push(k)
    }
  }

  const result = new Map<number, MultiPVResult[]>()
  const total = candidates.length
  let done = 0

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
