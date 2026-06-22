import { Engine } from '../engine/Engine'
import type { Ply, AnalyzedPly } from '../types'

export interface AnalysisSignal {
  cancelled: boolean
}

/**
 * Evaluates every position in `plies` sequentially at the given depth.
 * Calls `onProgress` after each ply completes, passing the running count,
 * total, and the just-evaluated AnalyzedPly so the UI can update incrementally.
 * Respects `signal.cancelled` between evaluations — cannot interrupt a search
 * already in flight, but stops before starting the next one.
 */
export async function analyzeGame(
  plies: Ply[],
  depth: number,
  engine: Engine,
  onProgress: (done: number, total: number, latest: AnalyzedPly) => void,
  signal: AnalysisSignal,
): Promise<AnalyzedPly[]> {
  await engine.ready
  engine.clearHash()

  const results: AnalyzedPly[] = []
  const total = plies.length

  for (let i = 0; i < total; i++) {
    if (signal.cancelled) break

    const evalResult = await engine.evaluate(plies[i].fen, depth)

    if (signal.cancelled) break

    const analyzed: AnalyzedPly = { ...plies[i], eval: evalResult }
    results.push(analyzed)
    onProgress(results.length, total, analyzed)
  }

  return results
}
