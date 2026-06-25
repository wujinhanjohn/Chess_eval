import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import type { AnalyzedPly, EvalResult } from '../types'
import type { ClassifiedMove } from './classifyGame'
import { MoveQuality } from './moveQuality'
import type { Division } from './phaseDivider'
import { computePhaseStats, presentQualities } from './phaseStats'

// ── Fixture helpers ─────────────────────────────────────────────────────────

function mkEval(cp: number): EvalResult {
  return { cp, mate: null, bestMove: '', pv: [], depth: 16 }
}

/** Replay SAN moves and attach a white-perspective cp to each position. */
function makeGame(sans: string[], whiteCp: number[]): AnalyzedPly[] {
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

/** Hand-built classifications aligned by ply index. */
function classify(qualities: (MoveQuality | null)[]): ClassifiedMove[] {
  return qualities.map((quality, plyIndex) => ({
    plyIndex,
    quality,
    winLoss: quality === null ? null : 0,
  }))
}

/** Sum of every count in a QualityCounts record. */
function totalCounts(counts: Record<MoveQuality, number>): number {
  return Object.values(counts).reduce((a, b) => a + b, 0)
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('computePhaseStats', () => {
  const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']
  const flat = [0, 0, 0, 0, 0, 0, 0]

  it('assigns moves to phases by their resulting position', () => {
    const plies = makeGame(sans, flat)
    // Force a clean split: opening = plies 1–2, middlegame = 3–4, endgame = 5–6.
    const division: Division = { midgame: 3, endgame: 5, plyCount: plies.length }
    const cls = classify([null, ...Array(6).fill(MoveQuality.Best)])

    const { white, black } = computePhaseStats(plies, cls, division)

    // White moves are plies 1,3,5 → one per phase. Same for Black at 2,4,6.
    expect(white.opening.totalMoves).toBe(1)
    expect(white.middlegame.totalMoves).toBe(1)
    expect(white.endgame.totalMoves).toBe(1)
    expect(black.opening.totalMoves).toBe(1)
    expect(black.middlegame.totalMoves).toBe(1)
    expect(black.endgame.totalMoves).toBe(1)
  })

  it('counts classifications per phase and exposes raw totals', () => {
    const plies = makeGame(sans, flat)
    const division: Division = { midgame: 3, endgame: null, plyCount: plies.length }
    // White: Best, Excellent, Blunder | Black: Good, Good, Inaccuracy
    const cls = classify([
      null,
      MoveQuality.Best, // ply1 white, opening
      MoveQuality.Good, // ply2 black, opening
      MoveQuality.Excellent, // ply3 white, middlegame
      MoveQuality.Good, // ply4 black, middlegame
      MoveQuality.Blunder, // ply5 white, middlegame
      MoveQuality.Inaccuracy, // ply6 black, middlegame
    ])

    const { white, black } = computePhaseStats(plies, cls, division)

    expect(white.opening.counts[MoveQuality.Best]).toBe(1)
    expect(white.middlegame.counts[MoveQuality.Excellent]).toBe(1)
    expect(white.middlegame.counts[MoveQuality.Blunder]).toBe(1)
    expect(black.opening.counts[MoveQuality.Good]).toBe(1)
    expect(black.middlegame.counts[MoveQuality.Good]).toBe(1)
    expect(black.middlegame.counts[MoveQuality.Inaccuracy]).toBe(1)

    // Raw counts always sum to the player's actual move totals.
    expect(totalCounts(white.opening.counts) + totalCounts(white.middlegame.counts)).toBe(3)
    expect(totalCounts(black.opening.counts) + totalCounts(black.middlegame.counts)).toBe(3)
  })

  it('returns null accuracy for a phase with no graded moves (no endgame)', () => {
    const plies = makeGame(sans, flat)
    const division: Division = { midgame: 3, endgame: null, plyCount: plies.length }
    const cls = classify([null, ...Array(6).fill(MoveQuality.Best)])

    const { white, black } = computePhaseStats(plies, cls, division)

    expect(white.endgame.accuracy).toBeNull()
    expect(white.endgame.gradedMoveCount).toBe(0)
    expect(white.endgame.totalMoves).toBe(0)
    expect(black.endgame.accuracy).toBeNull()
  })

  it('excludes book moves from accuracy but keeps them in counts', () => {
    const plies = makeGame(sans, flat)
    const division: Division = { midgame: null, endgame: null, plyCount: plies.length }
    // First two plies are Book; the rest Best. Everything is opening here.
    const cls = classify([
      null,
      MoveQuality.Book, // ply1 white
      MoveQuality.Book, // ply2 black
      MoveQuality.Best, // ply3 white
      MoveQuality.Best, // ply4 black
      MoveQuality.Best, // ply5 white
      MoveQuality.Best, // ply6 black
    ])

    const { white } = computePhaseStats(plies, cls, division)

    // Book move is counted but not graded.
    expect(white.opening.counts[MoveQuality.Book]).toBe(1)
    expect(white.opening.totalMoves).toBe(3) // plies 1,3,5
    expect(white.opening.gradedMoveCount).toBe(2) // book ply1 excluded
    expect(white.opening.accuracy).not.toBeNull()
  })

  it('handles a very short game (one move)', () => {
    const plies = makeGame(['e4'], [0, 0])
    const division: Division = { midgame: null, endgame: null, plyCount: plies.length }
    const cls = classify([null, MoveQuality.Best])

    const { white, black } = computePhaseStats(plies, cls, division)

    expect(white.opening.totalMoves).toBe(1)
    expect(white.middlegame.accuracy).toBeNull()
    expect(black.opening.totalMoves).toBe(0)
    expect(black.opening.accuracy).toBeNull()
  })

  it('presentQualities lists only labels that occur, in canonical order', () => {
    const plies = makeGame(sans, flat)
    const division: Division = { midgame: 3, endgame: null, plyCount: plies.length }
    const cls = classify([
      null,
      MoveQuality.Blunder,
      MoveQuality.Best,
      MoveQuality.Good,
      MoveQuality.Best,
      MoveQuality.Good,
      MoveQuality.Best,
    ])

    const stats = computePhaseStats(plies, cls, division)
    // Canonical order is Best < Good < Blunder (per MoveQuality declaration order).
    expect(presentQualities(stats)).toEqual([
      MoveQuality.Best,
      MoveQuality.Good,
      MoveQuality.Blunder,
    ])
  })
})
