/** All move-quality labels (Chess.com-style). Brilliant/Great reserved for a later step. */
export const MoveQuality = {
  Brilliant: 'brilliant',
  Great: 'great',
  Best: 'best',
  Excellent: 'excellent',
  Good: 'good',
  Book: 'book',
  Inaccuracy: 'inaccuracy',
  Mistake: 'mistake',
  Miss: 'miss',
  Blunder: 'blunder',
} as const

export type MoveQuality = (typeof MoveQuality)[keyof typeof MoveQuality]

/**
 * Tunable thresholds — approximate Chess.com's unpublished grading bands.
 * Adjust win-loss cutoffs (in win-probability points) to taste.
 */
export const CLASSIFICATION_THRESHOLDS = {
  /** winLoss below this → Best (unless engine bestMove differs and winLoss ≥ this) */
  bestMax: 0.5,
  excellentMax: 2,
  goodMax: 5,
  inaccuracyMax: 10,
  mistakeMax: 20,
  /** Miss: mover was clearly winning before (win %) */
  missWinBeforeMin: 80,
  /** Miss: after the move, position is roughly equal or worse (win %) */
  missWinAfterMax: 55,

  // ── Brilliant / Great ──────────────────────────────────────────────────
  /** SEE gain (pawn units) the opponent can net on the destination square.
   *  Must be ≥ this for the move to count as a sacrifice.  2 = exchange up,
   *  so pure pawn sacs (gain=1) are excluded as too noisy. */
  sacrificeMinGain: 2,
  /** Mover's win% AFTER the sacrifice must be ≥ this (roughly equal or better). */
  brilliantMinWinAfter: 45,
  /** Mover's win% BEFORE must be ≤ this; cleanup sacs while crushing aren't brilliant. */
  brilliantMaxWinBefore: 90,
  /** Win-% gap between multipv #1 and #2 needed for Great (the uniquely good move). */
  greatGap: 10,
  /** Great only fires when the mover wasn't already completely winning.
   *  Prevents endgame technique ("avoid stalemate at 100%") from being labelled Great. */
  greatMaxWinBefore: 97,
} as const

/** Debug payload attached to Brilliant/Great ClassifiedMoves for display/logging. */
export interface BrilliantGreatDebug {
  sac: boolean           // isSacrifice returned true
  gap: number | null     // win-% gap between mpv[0] and mpv[1]; null for Brilliant when no Great check ran
  moverWinBefore: number
  moverWinAfter: number
}

export const MOVE_QUALITY_LABELS: Record<MoveQuality, string> = {
  [MoveQuality.Brilliant]: 'Brilliant',
  [MoveQuality.Great]: 'Great',
  [MoveQuality.Best]: 'Best',
  [MoveQuality.Excellent]: 'Excellent',
  [MoveQuality.Good]: 'Good',
  [MoveQuality.Book]: 'Book',
  [MoveQuality.Inaccuracy]: 'Inaccuracy',
  [MoveQuality.Mistake]: 'Mistake',
  [MoveQuality.Miss]: 'Miss',
  [MoveQuality.Blunder]: 'Blunder',
}
