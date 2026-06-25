import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import type { Ply } from '../types'
import type { ClassifiedMove } from './classifyGame'
import { MoveQuality } from './moveQuality'
import { countMoveQualities } from './moveCounts'

function game(sans: string[]): Ply[] {
  const c = new Chess()
  const plies: Ply[] = [{ fen: c.fen(), san: '', moveNumber: 0, color: 'w' }]
  sans.forEach((san, i) => {
    const m = c.move(san)
    plies.push({ fen: c.fen(), san: m.san, moveNumber: Math.ceil((i + 1) / 2), color: m.color })
  })
  return plies
}

function classify(qualities: (MoveQuality | null)[]): ClassifiedMove[] {
  return qualities.map((quality, plyIndex) => ({
    plyIndex,
    quality,
    winLoss: quality === null ? null : 0,
  }))
}

describe('countMoveQualities', () => {
  it('tallies each classification per side and totals', () => {
    const plies = game(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'])
    const cls = classify([
      null,
      MoveQuality.Best, // ply1 white
      MoveQuality.Book, // ply2 black
      MoveQuality.Best, // ply3 white
      MoveQuality.Blunder, // ply4 black
      MoveQuality.Excellent, // ply5 white
      MoveQuality.Good, // ply6 black
    ])

    const c = countMoveQualities(plies, cls)

    expect(c.white[MoveQuality.Best]).toBe(2)
    expect(c.white[MoveQuality.Excellent]).toBe(1)
    expect(c.black[MoveQuality.Book]).toBe(1)
    expect(c.black[MoveQuality.Blunder]).toBe(1)
    expect(c.black[MoveQuality.Good]).toBe(1)

    expect(c.whiteMoves).toBe(3)
    expect(c.blackMoves).toBe(3)
    expect(c.totalMoves).toBe(6)
  })

  it('skips the start position and unclassified plies', () => {
    const plies = game(['e4', 'e5'])
    const cls = classify([null, MoveQuality.Best, null]) // ply2 unclassified

    const c = countMoveQualities(plies, cls)

    expect(c.totalMoves).toBe(1)
    expect(c.white[MoveQuality.Best]).toBe(1)
    expect(c.blackMoves).toBe(0)
  })

  it('returns all-zero counts for a game with no moves', () => {
    const c = countMoveQualities(game([]), classify([null]))
    expect(c.totalMoves).toBe(0)
    expect(c.white[MoveQuality.Blunder]).toBe(0)
  })
})
