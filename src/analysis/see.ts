/**
 * Static Exchange Evaluation (SEE) + sacrifice detection.
 *
 * isSacrifice(fenBefore, moveUci) returns true when the mover gives up
 * material worth at least CLASSIFICATION_THRESHOLDS.sacrificeMinGain pawn
 * units on the destination square by the opponent's best capture sequence.
 *
 * Algorithm: after playing the move, run SEE on the destination square from
 * the opponent's perspective.  SEE alternates sides until no profitable
 * capture remains, returning the net material gained by the first capturer.
 *
 * Limitations (by design – heuristic):
 *  - Only checks the destination square, not pieces exposed elsewhere.
 *  - En-passant capture squares are not re-checked (rare edge case).
 *  - Pawn sacrifices (gain < 2) are excluded by the threshold.
 */

import { Chess } from 'chess.js'
import type { Square } from 'chess.js'
import { CLASSIFICATION_THRESHOLDS } from './moveQuality'

const PIECE_VALUE: Record<string, number> = {
  p: 1, n: 3, b: 3, r: 5, q: 9,
  k: 99, // King last; practically unreachable in legal exchange sequences
}

/**
 * Returns how much material the side-to-move in `fen` can NET gain
 * by initiating a capture sequence on `sq`.  Returns 0 if no profitable
 * capture exists.  Depth cap prevents runaway recursion on edge positions.
 */
function seeGain(fen: string, sq: string, depth = 0): number {
  if (depth > 16) return 0

  const chess = new Chess(fen)
  const target = chess.get(sq as Square)
  if (!target) return 0

  // Collect legal captures that land on sq
  const caps = chess.moves({ verbose: true }).filter(m => m.to === sq && !!m.captured)
  if (caps.length === 0) return 0

  // Least valuable attacker first
  caps.sort((a, b) => (PIECE_VALUE[a.piece] ?? 0) - (PIECE_VALUE[b.piece] ?? 0))
  const lva = caps[0]

  const capturedVal = PIECE_VALUE[target.type] ?? 0
  chess.move(lva)

  // The other side responds; max(0,…) lets the capturer decline if it's losing
  const counterGain = seeGain(chess.fen(), sq, depth + 1)
  return Math.max(0, capturedVal - counterGain)
}

/**
 * Returns true if playing `moveUci` from `fenBefore` leaves the mover's
 * piece on the destination square exposed to a net-profitable capture sequence
 * by the opponent.  The threshold is CLASSIFICATION_THRESHOLDS.sacrificeMinGain
 * pawn units (default 2) so pawn-only "sacrifices" are excluded.
 */
export function isSacrifice(fenBefore: string, moveUci: string): boolean {
  const from = moveUci.slice(0, 2)
  const to   = moveUci.slice(2, 4)
  const promo = moveUci[4] as 'q' | 'r' | 'b' | 'n' | undefined

  let fenAfter: string
  let capturedValue = 0

  try {
    const chess = new Chess(fenBefore)
    // Record the value of any piece being captured (en passant has captured !== the to-square;
    // we use the Move.captured type from chess.js which handles it correctly).
    const capturedPiece = chess.get(to as Square)
    if (capturedPiece) capturedValue = PIECE_VALUE[capturedPiece.type] ?? 0

    const result = chess.move({ from, to, promotion: promo })
    if (!result) return false
    fenAfter = chess.fen()
  } catch {
    return false
  }

  // How much material can the opponent net on the destination square?
  const opponentGain = seeGain(fenAfter, to)

  // Net loss for the mover = opponent's gain minus what the mover already captured.
  // Equal exchanges (e.g. Nxd4 where White Qxd4) → netLoss = 3-3 = 0 → not a sacrifice.
  // Piece sacrifice (Nxf7 where Kxf7) → netLoss = 3-1 = 2 → IS a sacrifice.
  const netLoss = opponentGain - capturedValue
  return netLoss >= CLASSIFICATION_THRESHOLDS.sacrificeMinGain
}
