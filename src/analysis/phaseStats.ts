/**
 * Per-player, per-phase aggregation: accuracy % plus raw counts of each move
 * classification (best/excellent/…/blunder) for the opening, middlegame, and
 * endgame.
 *
 * The classification labels are taken DIRECTLY from classifyGame()'s output, so
 * the counts here agree move-for-move with what the rest of the UI shows — no
 * separate grading. Accuracy reuses the exact Lichess method in playerStats.ts
 * (buildMoveData / aggregateMoves), just restricted to each phase's moves, so it
 * cannot diverge from the game-wide accuracy either.
 *
 * Book moves (classifyGame's Book label) stay in their phase's counts but are
 * excluded from accuracy — so opening accuracy is often sparse, by design.
 */

import type { AnalyzedPly } from '../types'
import type { ClassifiedMove } from './classifyGame'
import { MoveQuality } from './moveQuality'
import { buildMoveData, aggregateMoves } from './playerStats'
import type { MoveDatum } from './playerStats'
import { phaseOfPly } from './phaseDivider'
import type { Division, Phase } from './phaseDivider'

export type QualityCounts = Record<MoveQuality, number>

export interface PhaseBreakdown {
  phase: Phase
  /** Phase accuracy %, or null when the phase has no graded moves (no divide-by-zero). */
  accuracy: number | null
  /** Moves that counted toward accuracy (excludes forced + book). */
  gradedMoveCount: number
  /** All of the player's moves in this phase, including book/forced. */
  totalMoves: number
  /** Raw count of each classification label in this phase. */
  counts: QualityCounts
}

export interface PlayerPhaseStats {
  opening: PhaseBreakdown
  middlegame: PhaseBreakdown
  endgame: PhaseBreakdown
}

export interface GamePhaseStats {
  division: Division
  white: PlayerPhaseStats
  black: PlayerPhaseStats
}

const ALL_PHASES: Phase[] = ['opening', 'middlegame', 'endgame']

function emptyCounts(): QualityCounts {
  const counts = {} as QualityCounts
  for (const q of Object.values(MoveQuality)) counts[q] = 0
  return counts
}

/**
 * Aggregates phase stats for both players. `classifications` must be aligned by
 * ply index with `plies` (as produced by classifyGame). Book plies are derived
 * from the classifications so accuracy exclusion matches the displayed labels.
 */
export function computePhaseStats(
  plies: AnalyzedPly[],
  classifications: ClassifiedMove[],
  division: Division,
  opts: { mateCp?: number } = {},
): GamePhaseStats {
  const bookPlies = new Set<number>()
  for (const c of classifications) {
    if (c.quality === MoveQuality.Book && c.plyIndex > 0) bookPlies.add(c.plyIndex)
  }

  const data = buildMoveData(plies, { bookPlies, mateCp: opts.mateCp })
  const byPly = new Map<number, MoveDatum>(data.map((d) => [d.plyIndex, d]))

  function buildFor(color: 'w' | 'b'): PlayerPhaseStats {
    const buckets: Record<Phase, { data: MoveDatum[]; counts: QualityCounts; total: number }> = {
      opening: { data: [], counts: emptyCounts(), total: 0 },
      middlegame: { data: [], counts: emptyCounts(), total: 0 },
      endgame: { data: [], counts: emptyCounts(), total: 0 },
    }

    for (let k = 1; k < plies.length; k++) {
      if (plies[k].color !== color) continue
      const bucket = buckets[phaseOfPly(division, k)]
      bucket.total++
      const quality = classifications[k]?.quality
      if (quality) bucket.counts[quality]++
      const datum = byPly.get(k)
      if (datum) bucket.data.push(datum)
    }

    const make = (phase: Phase): PhaseBreakdown => {
      const bucket = buckets[phase]
      const agg = aggregateMoves(bucket.data)
      return {
        phase,
        accuracy: agg.moveCount > 0 ? agg.accuracy : null,
        gradedMoveCount: agg.moveCount,
        totalMoves: bucket.total,
        counts: bucket.counts,
      }
    }

    return { opening: make('opening'), middlegame: make('middlegame'), endgame: make('endgame') }
  }

  return { division, white: buildFor('w'), black: buildFor('b') }
}

/** Quality labels that occur at least once across both players/all phases, in canonical order. */
export function presentQualities(stats: GamePhaseStats): MoveQuality[] {
  const present = new Set<MoveQuality>()
  for (const player of [stats.white, stats.black]) {
    for (const phase of ALL_PHASES) {
      for (const q of Object.values(MoveQuality)) {
        if (player[phase].counts[q] > 0) present.add(q)
      }
    }
  }
  return (Object.values(MoveQuality) as MoveQuality[]).filter((q) => present.has(q))
}
