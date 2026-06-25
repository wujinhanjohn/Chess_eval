import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import type { Ply } from '../types'
import { divideGame, phaseOfPly } from './phaseDivider'

// ── Fixture helpers ─────────────────────────────────────────────────────────

/** Build plies (fen only) by replaying SAN moves from the start. */
function game(sans: string[]): Ply[] {
  const c = new Chess()
  const plies: Ply[] = [{ fen: c.fen(), san: '', moveNumber: 0, color: 'w' }]
  sans.forEach((san, i) => {
    const m = c.move(san)
    plies.push({ fen: c.fen(), san: m.san, moveNumber: Math.ceil((i + 1) / 2), color: m.color })
  })
  return plies
}

/** Build plies straight from a list of position FENs. */
function fenGame(fens: string[]): Ply[] {
  return fens.map((fen, i) => ({
    fen,
    san: '',
    moveNumber: Math.ceil(i / 2),
    color: i % 2 ? 'b' : 'w',
  }))
}

// ── Game 1: ends in the opening (Scholar's mate) ────────────────────────────

describe('divideGame — game that ends in the opening', () => {
  const scholars = game(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#'])

  it('detects no middlegame or endgame', () => {
    const d = divideGame(scholars)
    expect(d.midgame).toBeNull()
    expect(d.endgame).toBeNull()
    expect(d.plyCount).toBe(scholars.length)
  })

  it('classifies every ply as opening', () => {
    const d = divideGame(scholars)
    for (let k = 0; k < scholars.length; k++) {
      expect(phaseOfPly(d, k)).toBe('opening')
    }
  })
})

// ── Game 2: quick to the endgame (heavy trades) ─────────────────────────────

describe('divideGame — quick-to-endgame', () => {
  // Position sequence: opening → opening → opening → 10 majors/minors (midgame)
  // → 2 majors/minors (endgame) → deeper endgame.
  const quick = fenGame([
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2',
    'rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3',
    'r1b2rk1/ppp2ppp/2n2n2/8/8/2N2N2/PPP2PPP/R1B2RK1 w - - 0 10',
    '5rk1/ppp2ppp/8/8/8/8/PPP2PPP/5RK1 w - - 0 20',
    '6k1/ppp2ppp/8/8/8/8/PPP2PPP/6K1 w - - 0 25',
  ])

  it('reaches an endgame, with the middlegame strictly before it', () => {
    const d = divideGame(quick)
    expect(d.midgame).not.toBeNull()
    expect(d.endgame).not.toBeNull()
    expect(d.midgame!).toBeLessThan(d.endgame!)
  })

  it('enters the endgame quickly (low ply index)', () => {
    const d = divideGame(quick)
    expect(d.endgame!).toBeLessThan(10)
  })

  it('assigns phases consistently across the transition', () => {
    const d = divideGame(quick)
    expect(phaseOfPly(d, 0)).toBe('opening')
    expect(phaseOfPly(d, d.midgame!)).toBe('middlegame')
    expect(phaseOfPly(d, d.midgame! - 1)).toBe('opening')
    expect(phaseOfPly(d, d.endgame!)).toBe('endgame')
    expect(phaseOfPly(d, d.endgame! - 1)).toBe('middlegame')
    expect(phaseOfPly(d, quick.length - 1)).toBe('endgame')
  })
})

// ── Game 3: long middlegame (Morphy, Opera Game 1858) ───────────────────────

describe('divideGame — long middlegame', () => {
  const opera = game([
    'e4', 'e5', 'Nf3', 'd6', 'd4', 'Bg4', 'dxe5', 'Bxf3', 'Qxf3', 'dxe5',
    'Bc4', 'Nf6', 'Qb3', 'Qe7', 'Nc3', 'c6', 'Bg5', 'b5', 'Nxb5', 'cxb5',
    'Bxb5+', 'Nbd7', 'O-O-O', 'Rd8', 'Rxd7', 'Rxd7', 'Rd1', 'Qe6',
    'Bxd7+', 'Nxd7', 'Qb8+', 'Nxb8', 'Rd8#',
  ])

  it('leaves the opening but only reaches the endgame near the end', () => {
    const d = divideGame(opera)
    expect(d.midgame).not.toBeNull()
    // Past the pure opening, but not absurdly late.
    expect(d.midgame!).toBeGreaterThanOrEqual(6)
    expect(d.midgame!).toBeLessThan(25)
    // The middlegame spans a substantial stretch of the game.
    const endIdx = d.endgame ?? d.plyCount
    expect(endIdx - d.midgame!).toBeGreaterThanOrEqual(5)
  })

  it('orders the phases correctly', () => {
    const d = divideGame(opera)
    if (d.endgame !== null) expect(d.midgame!).toBeLessThan(d.endgame)
  })
})

// ── Edge cases ──────────────────────────────────────────────────────────────

describe('divideGame — edge cases', () => {
  it('handles a single-position game (no moves)', () => {
    const d = divideGame(game([]))
    expect(d.plyCount).toBe(1)
    expect(d.midgame).toBeNull()
    expect(d.endgame).toBeNull()
    expect(phaseOfPly(d, 0)).toBe('opening')
  })

  it('never reports endgame without a middlegame', () => {
    const d = divideGame(game(['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6', 'Qxf7#']))
    if (d.endgame !== null) expect(d.midgame).not.toBeNull()
  })

  it('collapses a position that triggers both into endgame only', () => {
    // Start position then a bare K+R endgame: the second position trips both the
    // midgame and endgame triggers, so it is endgame with no separate midgame.
    const d = divideGame(
      fenGame([
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
        '6k1/8/8/8/8/8/8/R5K1 w - - 0 30',
      ]),
    )
    expect(d.endgame).toBe(1)
    expect(d.midgame).toBeNull()
    expect(phaseOfPly(d, 1)).toBe('endgame')
  })
})
