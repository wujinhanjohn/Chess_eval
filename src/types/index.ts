export interface GamePlayer {
  username: string
  rating: number
  result: string
}

export interface Game {
  url: string
  pgn: string
  timeControl: string
  timeClass: string
  rated: boolean
  white: GamePlayer
  black: GamePlayer
  /** Normalized outcome from white's perspective */
  result: 'white' | 'black' | 'draw'
  eco?: string
  endTime: number
  accuracies?: { white: number; black: number }
}

export type ApiErrorKind = 'not_found' | 'rate_limited' | 'network_error'

export interface ApiError {
  kind: ApiErrorKind
  message: string
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError }

/**
 * Engine evaluation result.
 * ALL scores are normalized to White's perspective:
 *   positive cp / positive mate → White is ahead / White mates
 *   negative cp / negative mate → Black is ahead / Black mates
 */
export interface EvalResult {
  cp: number | null    // centipawns (null when forced mate is found)
  mate: number | null  // moves to mate; positive = White mates, negative = Black mates
  bestMove: string     // best move in UCI format, e.g. "e2e4"
  pv: string[]         // principal variation in UCI format
  depth: number        // search depth reached
}

/**
 * One half-move (ply) in a game replay.
 * Index 0 = starting position (san is '' and moveNumber is 0).
 * Index N > 0 = position after ply N was played.
 * This array is the direct input to the engine analysis step.
 */
export interface Ply {
  fen: string
  san: string        // '' for the starting position
  moveNumber: number // 0 for start; 1 for first white/black move pair; etc.
  color: 'w' | 'b'  // side that just moved ('w' sentinel for index 0)
}

/** A Ply enriched with the engine's evaluation of that position. */
export interface AnalyzedPly extends Ply {
  eval: EvalResult
}

/**
 * One entry in a multi-PV analysis result.
 * Scores are normalized to White's perspective, matching EvalResult.
 */
export interface MultiPVResult {
  rank: number        // 1-indexed PV rank
  move: string        // UCI move (first move of this PV)
  cp: number | null   // centipawns (null when mate found)
  mate: number | null // moves to mate (White-perspective sign)
  pv: string[]        // principal variation in UCI
}
