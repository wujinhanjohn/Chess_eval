import type { EvalResult } from '../types'

/**
 * Converts a centipawn evaluation (White-perspective) to White's win probability
 * as a percentage (0–100). Uses the same sigmoid used by Lichess/Stockfish WDL.
 *
 * At 0 cp → 50 %. Saturates smoothly toward 0 / 100 for large imbalances so
 * the bar looks meaningful at every stage of the game.
 */
export function winProbability(cp: number): number {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1)
}

/** White's win % from an engine eval; mate → 100 / 0, matching the eval bar. */
export function evalToWhiteWinPct(e: EvalResult): number {
  if (e.mate !== null) return e.mate > 0 ? 100 : 0
  if (e.cp !== null) return winProbability(e.cp)
  return 50
}

/** Win % from the side that just moved (or will move at this position). */
export function evalToMoverWinPct(e: EvalResult, mover: 'w' | 'b'): number {
  const whitePct = evalToWhiteWinPct(e)
  return mover === 'w' ? whitePct : 100 - whitePct
}
