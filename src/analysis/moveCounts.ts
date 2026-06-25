/**
 * Whole-game tally of move classifications, per player.
 *
 * Counts come straight from classifyGame()'s labels, so they agree move-for-move
 * with everything else shown in the UI. Every played move has exactly one label
 * (ply 0, the start position, has none and is skipped).
 */

import type { Ply } from '../types'
import type { ClassifiedMove } from './classifyGame'
import { MoveQuality } from './moveQuality'
import type { QualityCounts } from './phaseStats'

export interface MoveCounts {
  white: QualityCounts
  black: QualityCounts
  whiteMoves: number
  blackMoves: number
  totalMoves: number
}

function emptyCounts(): QualityCounts {
  const counts = {} as QualityCounts
  for (const q of Object.values(MoveQuality)) counts[q] = 0
  return counts
}

/**
 * Tallies each classification per side. `classifications` must align by ply
 * index with `plies` (as produced by classifyGame over the same game).
 */
export function countMoveQualities(
  plies: Ply[],
  classifications: ClassifiedMove[],
): MoveCounts {
  const white = emptyCounts()
  const black = emptyCounts()
  let whiteMoves = 0
  let blackMoves = 0

  for (let k = 1; k < plies.length; k++) {
    const quality = classifications[k]?.quality
    if (!quality) continue
    if (plies[k].color === 'w') {
      white[quality]++
      whiteMoves++
    } else {
      black[quality]++
      blackMoves++
    }
  }

  return { white, black, whiteMoves, blackMoves, totalMoves: whiteMoves + blackMoves }
}
