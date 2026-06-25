/**
 * Per-player accuracy, average centipawn loss (ACPL), and an estimated Elo,
 * derived from an already-analysed game (AnalyzedPly[]).
 *
 * Pure and UI-agnostic so it can be unit-tested in isolation. Reuses the
 * existing engine evals — no new searches — so it is free on cached games.
 *
 * Accuracy follows the Lichess method:
 *   1. Per ply, take the centipawn eval before/after the move from the moving
 *      side's perspective (mate scores are first converted to a capped cp).
 *   2. cp -> win%:   winPct = 50 + 50 * (2/(1+exp(-0.00368208*cp)) - 1)
 *      (implemented in winProbability.ts)
 *   3. move accuracy = clamp(103.1668*exp(-0.04354*(winBefore-winAfter)) - 3.1669, 0, 100)
 *   4. Per-player game accuracy = average of
 *        (a) a volatility-weighted mean of move accuracies (weights from a
 *            sliding-window stdev of win%), and
 *        (b) the harmonic mean of move accuracies.
 *   5. Forced moves (single legal move) and leading book moves are excluded.
 */

import { Chess } from 'chess.js'
import type { AnalyzedPly, EvalResult } from '../types'
import { winProbability } from './winProbability'

// ── Tunable constants ───────────────────────────────────────────────────────

/**
 * Mate scores have no centipawn value, so we substitute a large capped cp for
 * win% / ACPL math. A nearer mate maps to a slightly larger magnitude, but the
 * cap keeps a single forced mate from dwarfing every real centipawn swing.
 */
const MATE_CP = 1000

/** Volatility weights are floored so a flat (drawn-looking) stretch still counts. */
const MIN_WEIGHT = 0.5
/** ...and capped so one wild swing doesn't drown out the rest of the game. */
const MAX_WEIGHT = 12

// ── Public types ────────────────────────────────────────────────────────────

export interface PlayerStats {
  /** Lichess-style game accuracy, 0–100. */
  accuracy: number
  /** Average centipawn loss across the player's counted moves. */
  acpl: number
  /** Rough Elo estimate (see estimateElo); label as an estimate in the UI. */
  estimatedElo: number
  /** Number of moves that counted toward the stats (after exclusions). */
  moveCount: number
}

export interface GameStats {
  white: PlayerStats
  black: PlayerStats
}

export interface PlayerStatsOptions {
  /**
   * Ply indices (into the AnalyzedPly[] array) that are opening "book" moves and
   * should be excluded. Typically the plies classifyGame() labelled Book.
   */
  bookPlies?: ReadonlySet<number>
  /** Override the mate→cp cap (mainly for tests). */
  mateCp?: number
}

// ── Small numeric helpers (exported for unit tests) ─────────────────────────

export function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x))
}

/** Population standard deviation. Returns 0 for fewer than 2 values. */
export function stdev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance =
    values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / values.length
  return Math.sqrt(variance)
}

/** Arithmetic mean weighted by `weights`; falls back to a plain mean if weights sum to 0. */
export function weightedMean(values: number[], weights: number[]): number {
  let num = 0
  let den = 0
  for (let i = 0; i < values.length; i++) {
    num += values[i] * weights[i]
    den += weights[i]
  }
  if (den === 0) return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
  return num / den
}

/**
 * Harmonic mean. Sensitive to small values by design — a single very low
 * accuracy (a bad move) pulls the whole game down, which is the intent.
 * A zero in the set drives the result to 0 (1/0 → Infinity → n/Infinity → 0).
 */
export function harmonicMean(values: number[]): number {
  if (values.length === 0) return 0
  let recipSum = 0
  for (const v of values) recipSum += 1 / v
  return values.length / recipSum
}

// ── Eval conversions ────────────────────────────────────────────────────────

/** White-perspective centipawns, substituting a capped value for mate scores. */
export function evalToCp(e: EvalResult, mateCp = MATE_CP): number {
  if (e.mate !== null) return e.mate > 0 ? mateCp : -mateCp
  return e.cp ?? 0
}

/** Win % (0–100) for the side that just moved (or is to move) at a position. */
function moverWinPct(e: EvalResult, mover: 'w' | 'b', mateCp: number): number {
  const whitePct = winProbability(evalToCp(e, mateCp))
  return mover === 'w' ? whitePct : 100 - whitePct
}

/**
 * Single-move accuracy from the win% the mover held before vs. after the move.
 * `winBefore`/`winAfter` are both from the mover's perspective (0–100).
 */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const drop = Math.max(0, winBefore - winAfter)
  return clamp(103.1668 * Math.exp(-0.04354 * drop) - 3.1669, 0, 100)
}

// ── Estimated Elo ───────────────────────────────────────────────────────────

/**
 * Maps play quality to an estimated Elo. ACPL-primary with a light accuracy
 * blend, per design. This is a deliberately simple, single function so it can
 * be recalibrated against real rated games later — tweak the named constants
 * below; do not scatter Elo math elsewhere. Treat the output as a rough
 * ESTIMATE and label it as such in the UI.
 *
 * @param acpl     average centipawn loss (lower = stronger)
 * @param accuracy Lichess accuracy 0–100 (secondary signal)
 */
export function estimateElo(acpl: number, accuracy: number): number {
  // Primary: ACPL → Elo as exponential decay. ceiling at ~0 ACPL, falling off
  // as mistakes pile up. Rough anchors with these constants:
  //   ACPL  10 → ~2490   ACPL 20 → ~2070   ACPL 50 → ~1190   ACPL 100 → ~470
  const ACPL_CEILING = 3000 // asymptotic Elo at perfect (0) ACPL
  const ACPL_DECAY = 0.0185 // larger = Elo drops faster as ACPL grows
  const eloFromAcpl = ACPL_CEILING * Math.exp(-ACPL_DECAY * acpl)

  // Secondary: accuracy as a linear term. ~ -600 at 0%, ~1900 at 100%.
  const eloFromAccuracy = 25 * accuracy - 600

  // Blend, weighted toward ACPL.
  const ACPL_BLEND = 0.8
  const blended = ACPL_BLEND * eloFromAcpl + (1 - ACPL_BLEND) * eloFromAccuracy

  return clamp(Math.round(blended), 100, 3000)
}

// ── Volatility weights ──────────────────────────────────────────────────────

/**
 * One volatility weight per move (plies 1..N), from a sliding-window stdev of
 * the white-perspective win% sequence. Mirrors Lichess: the window grows with
 * game length (clamped 2–8), and the first few moves reuse the opening window so
 * every move gets a weight. Returned array is indexed by move (0 = ply 1).
 */
function moveWeights(winPctWhite: number[]): number[] {
  const positions = winPctWhite.length // N + 1
  const moves = positions - 1
  if (moves <= 0) return []

  const windowSize = clamp(Math.floor(moves / 10), 2, 8)
  const firstWindow = winPctWhite.slice(0, Math.min(windowSize, positions))

  const weights: number[] = []
  for (let m = 0; m < moves; m++) {
    let window: number[]
    if (m < windowSize - 2) {
      window = firstWindow
    } else {
      const start = m - (windowSize - 2)
      window = winPctWhite.slice(start, start + windowSize)
    }
    weights.push(clamp(stdev(window), MIN_WEIGHT, MAX_WEIGHT))
  }
  return weights
}

// ── Forced-move detection ───────────────────────────────────────────────────

/** True when the side to move in `fen` has exactly one legal move. */
function isForced(fen: string): boolean {
  try {
    return new Chess(fen).moves().length === 1
  } catch {
    return false
  }
}

// ── Per-move data (shared by game-wide and per-phase aggregation) ────────────

/**
 * One move's contribution to a player's stats. `forced`/`book` moves are kept in
 * the list (so callers can show them) but skipped by aggregateMoves().
 */
export interface MoveDatum {
  plyIndex: number
  color: 'w' | 'b'
  accuracy: number // 0–100
  weight: number // volatility weight (from the whole-game win% window)
  cpLoss: number // mover-perspective centipawn loss, floored at 0
  forced: boolean // single legal move
  book: boolean // listed in opts.bookPlies
}

/**
 * Builds per-move data for every played ply. The volatility weights are computed
 * once over the whole game's win% sequence, so any subset (e.g. a single phase)
 * aggregated later shares the same weighting context.
 */
export function buildMoveData(plies: AnalyzedPly[], opts: PlayerStatsOptions = {}): MoveDatum[] {
  const mateCp = opts.mateCp ?? MATE_CP
  const bookPlies = opts.bookPlies

  const winPctWhite = plies.map((p) => winProbability(evalToCp(p.eval, mateCp)))
  const weights = moveWeights(winPctWhite)

  const data: MoveDatum[] = []
  for (let k = 1; k < plies.length; k++) {
    const mover = plies[k].color
    const before = plies[k - 1].eval
    const after = plies[k].eval

    const winBefore = moverWinPct(before, mover, mateCp)
    const winAfter = moverWinPct(after, mover, mateCp)

    // ACPL from the mover's perspective (capped cp), floored at 0.
    const cpBefore = mover === 'w' ? evalToCp(before, mateCp) : -evalToCp(before, mateCp)
    const cpAfter = mover === 'w' ? evalToCp(after, mateCp) : -evalToCp(after, mateCp)

    data.push({
      plyIndex: k,
      color: mover,
      accuracy: moveAccuracy(winBefore, winAfter),
      weight: weights[k - 1],
      cpLoss: Math.max(0, cpBefore - cpAfter),
      forced: isForced(plies[k - 1].fen),
      book: bookPlies?.has(k) ?? false,
    })
  }
  return data
}

/**
 * Aggregates a set of moves into accuracy / ACPL / estimated Elo. Forced and
 * book moves are excluded from the aggregates. Returns moveCount 0 (and zeroed
 * stats) when no graded move remains — callers decide how to present that.
 */
export function aggregateMoves(data: MoveDatum[]): PlayerStats {
  const counted = data.filter((d) => !d.forced && !d.book)
  const moveCount = counted.length
  if (moveCount === 0) {
    return { accuracy: 0, acpl: 0, estimatedElo: 0, moveCount: 0 }
  }

  const accuracies = counted.map((d) => d.accuracy)
  const weights = counted.map((d) => d.weight)

  const weighted = weightedMean(accuracies, weights)
  const harmonic = harmonicMean(accuracies)
  const accuracy = clamp((weighted + harmonic) / 2, 0, 100)
  const acpl = counted.reduce((a, d) => a + d.cpLoss, 0) / moveCount

  return { accuracy, acpl, estimatedElo: estimateElo(acpl, accuracy), moveCount }
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Computes accuracy, ACPL, and estimated Elo for both players from an analysed
 * game. Forced moves and `opts.bookPlies` are excluded from the per-player
 * aggregates (but still inform the volatility window, which spans the whole game).
 */
export function computePlayerStats(
  plies: AnalyzedPly[],
  opts: PlayerStatsOptions = {},
): GameStats {
  const data = buildMoveData(plies, opts)
  return {
    white: aggregateMoves(data.filter((d) => d.color === 'w')),
    black: aggregateMoves(data.filter((d) => d.color === 'b')),
  }
}
