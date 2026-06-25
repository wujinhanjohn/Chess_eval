import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import type { AnalyzedPly, EvalResult } from '../types'
import {
  clamp,
  stdev,
  weightedMean,
  harmonicMean,
  evalToCp,
  moveAccuracy,
  estimateElo,
  computePlayerStats,
} from './playerStats'

// ── Fixture helpers ─────────────────────────────────────────────────────────

function mkEval(cp: number | { mate: number }): EvalResult {
  if (typeof cp === 'number') return { cp, mate: null, bestMove: '', pv: [], depth: 16 }
  return { cp: null, mate: cp.mate, bestMove: '', pv: [], depth: 16 }
}

/**
 * Replays `sans` from the initial position and attaches the white-perspective
 * eval at each position. `whiteCp` must have length sans.length + 1 (one per
 * position, including the start).
 */
function makeGame(sans: string[], whiteCp: (number | { mate: number })[]): AnalyzedPly[] {
  const chess = new Chess()
  const plies: AnalyzedPly[] = [
    { fen: chess.fen(), san: '', moveNumber: 0, color: 'w', eval: mkEval(whiteCp[0]) },
  ]
  sans.forEach((san, i) => {
    const m = chess.move(san)
    plies.push({
      fen: chess.fen(),
      san: m.san,
      moveNumber: Math.ceil((i + 1) / 2),
      color: m.color,
      eval: mkEval(whiteCp[i + 1]),
    })
  })
  return plies
}

// ── Numeric primitives ──────────────────────────────────────────────────────

describe('numeric helpers', () => {
  it('clamp bounds a value', () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(99, 0, 10)).toBe(10)
  })

  it('stdev matches the textbook example', () => {
    // Classic dataset with population stdev exactly 2.
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 10)
    expect(stdev([5, 5, 5])).toBe(0)
    expect(stdev([7])).toBe(0)
  })

  it('weightedMean weights values', () => {
    expect(weightedMean([100, 0], [1, 1])).toBe(50)
    expect(weightedMean([100, 50], [3, 1])).toBe(87.5)
    // Zero total weight falls back to a plain mean.
    expect(weightedMean([100, 50], [0, 0])).toBe(75)
  })

  it('harmonicMean is dominated by small values', () => {
    expect(harmonicMean([100, 100])).toBeCloseTo(100, 10)
    expect(harmonicMean([50, 100])).toBeCloseTo(66.6667, 3)
    // A single zero drags the harmonic mean to zero.
    expect(harmonicMean([100, 0])).toBe(0)
  })
})

// ── Eval conversion ─────────────────────────────────────────────────────────

describe('evalToCp', () => {
  it('passes centipawns through', () => {
    expect(evalToCp(mkEval(123))).toBe(123)
    expect(evalToCp(mkEval(-50))).toBe(-50)
  })

  it('caps mate scores by sign', () => {
    expect(evalToCp(mkEval({ mate: 3 }), 1000)).toBe(1000)
    expect(evalToCp(mkEval({ mate: -1 }), 1000)).toBe(-1000)
  })
})

// ── Move accuracy ───────────────────────────────────────────────────────────

describe('moveAccuracy', () => {
  it('is ~100 for no win% drop', () => {
    expect(moveAccuracy(50, 50)).toBeCloseTo(100, 2)
    // An improving move (negative drop) is floored to a 0 drop → still ~100.
    expect(moveAccuracy(40, 60)).toBeCloseTo(100, 2)
  })

  it('decreases as the win% drop grows', () => {
    // 103.1668*exp(-0.04354*10) - 3.1669 ≈ 63.58
    expect(moveAccuracy(60, 50)).toBeCloseTo(63.58, 1)
    expect(moveAccuracy(90, 40)).toBeLessThan(moveAccuracy(60, 50))
  })

  it('is clamped to [0, 100]', () => {
    const a = moveAccuracy(100, 0)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThanOrEqual(100)
  })
})

// ── Estimated Elo ───────────────────────────────────────────────────────────

describe('estimateElo', () => {
  it('matches the documented blend at a reference point', () => {
    // ACPL 20, accuracy 85 → 0.8*2072.19 + 0.2*1525 ≈ 1963
    expect(estimateElo(20, 85)).toBe(1963)
  })

  it('falls as ACPL rises', () => {
    expect(estimateElo(10, 90)).toBeGreaterThan(estimateElo(50, 70))
    expect(estimateElo(50, 70)).toBeGreaterThan(estimateElo(120, 40))
  })

  it('stays within bounds', () => {
    expect(estimateElo(0, 100)).toBeLessThanOrEqual(3000)
    expect(estimateElo(500, 0)).toBeGreaterThanOrEqual(100)
  })
})

// ── computePlayerStats: whole-game behaviour ────────────────────────────────

describe('computePlayerStats', () => {
  it('rates a flat, error-free game near-perfect for both sides', () => {
    const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']
    const stats = computePlayerStats(makeGame(sans, [0, 0, 0, 0, 0, 0, 0]))

    expect(stats.white.accuracy).toBeGreaterThan(99)
    expect(stats.black.accuracy).toBeGreaterThan(99)
    expect(stats.white.acpl).toBeCloseTo(0, 5)
    expect(stats.black.acpl).toBeCloseTo(0, 5)
    expect(stats.white.moveCount).toBe(3)
    expect(stats.black.moveCount).toBe(3)
  })

  it('penalises the side that blunders', () => {
    // White hangs the game on move 3 (ply 5): +0.2 → -4.0.
    const sans = ['d4', 'd5', 'Nf3', 'Nf6', 'Bf4', 'Bf5']
    const whiteCp = [20, 20, 15, 25, 20, -400, -380]
    const stats = computePlayerStats(makeGame(sans, whiteCp))

    expect(stats.white.accuracy).toBeLessThan(stats.black.accuracy)
    expect(stats.white.acpl).toBeGreaterThan(stats.black.acpl)
    expect(stats.white.estimatedElo).toBeLessThan(stats.black.estimatedElo)

    // White: only the blunder loses cp → (0 + 0 + 420) / 3 = 140.
    expect(stats.white.acpl).toBeCloseTo(140, 5)
    // Black: only the last move concedes cp → (0 + 0 + 20) / 3 ≈ 6.67.
    expect(stats.black.acpl).toBeCloseTo(6.6667, 3)
  })

  it('excludes book plies from the per-player aggregates', () => {
    const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']
    const game = makeGame(sans, [0, 0, 0, 0, 0, 0, 0])
    const stats = computePlayerStats(game, { bookPlies: new Set([1, 2]) })

    expect(stats.white.moveCount).toBe(2) // ply 1 dropped
    expect(stats.black.moveCount).toBe(2) // ply 2 dropped
  })

  it('excludes forced (single-legal-move) moves', () => {
    // Black king on a8 has exactly one legal move: Kb8.
    const forcedFen = 'k7/7R/8/8/8/8/8/K6R b - - 0 1'
    const game: AnalyzedPly[] = [
      { fen: forcedFen, san: '', moveNumber: 0, color: 'w', eval: mkEval(800) },
      {
        fen: '1k6/7R/8/8/8/8/8/K6R w - - 1 2',
        san: 'Kb8',
        moveNumber: 1,
        color: 'b',
        eval: mkEval(800),
      },
    ]
    const stats = computePlayerStats(game)
    expect(stats.black.moveCount).toBe(0)
  })

  it('treats a forced mate as a large advantage, not a crash', () => {
    const sans = ['e4', 'e5', 'Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7']
    // White converts to mate on the last move.
    const whiteCp: (number | { mate: number })[] = [20, 20, 10, 60, 50, 80, 40, { mate: 1 }]
    const stats = computePlayerStats(makeGame(sans, whiteCp))

    expect(Number.isFinite(stats.white.accuracy)).toBe(true)
    expect(Number.isFinite(stats.white.estimatedElo)).toBe(true)
    // The mating move should not register as a loss for White.
    expect(stats.white.acpl).toBeGreaterThanOrEqual(0)
  })
})
