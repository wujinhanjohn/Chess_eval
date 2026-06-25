import { describe, it, expect } from 'vitest'
import { Chess } from 'chess.js'
import type { AnalyzedPly, EvalResult } from '../types'
import { MoveQuality } from './moveQuality'
import { explainMove, materialConsequence } from './explainMove'

/**
 * Explanations read facts off engine output (EvalResult), so these tests feed
 * EvalResults that mirror what Stockfish reports for each position. PV/best-move
 * fields are real legal UCI lines for the positions used, so the material
 * PV-walk runs against genuine board states. We assert PROPERTIES (motif,
 * material magnitude, suppression), never hardcoded sentences.
 */

/** Build an AnalyzedPly for the position reached by playing `sans` from start. */
function ply(sans: string[], evalResult: EvalResult): AnalyzedPly {
  const c = new Chess()
  let san = ''
  let color: 'w' | 'b' = 'w'
  for (const s of sans) {
    const m = c.move(s)
    san = m.san
    color = m.color
  }
  return {
    fen: c.fen(),
    san,
    moveNumber: Math.ceil(sans.length / 2),
    color,
    eval: evalResult,
  }
}

/** UCI for a SAN played from a FEN (test helper). */
function uci(fen: string, san: string): string {
  const m = new Chess(fen).move(san)
  return m.from + m.to + (m.promotion ?? '')
}

function ev(partial: Partial<EvalResult>): EvalResult {
  return { cp: null, mate: null, bestMove: '', pv: [], depth: 16, ...partial }
}

describe('explainMove — mate handling', () => {
  it('flags Fool\'s mate (2.g4 allows Qh4#) as allows_mate, mateIn 1', () => {
    // before: position after 1.f3 e5 2.g4? is about to be classified.
    // before = after 1.f3 e5 (White to move, roughly equal — not decided).
    const before = ply(['f3', 'e5'], ev({ cp: -20, bestMove: 'e2e4', pv: ['e2e4'] }))
    // after = after 2.g4 (Black to move, has Qh4#). Engine reports mate for Black.
    const after = ply(['f3', 'e5', 'g4'], ev({ mate: -1, bestMove: 'd8h4', pv: ['d8h4'] }))

    const exp = explainMove(before, after, MoveQuality.Blunder)
    expect(exp).not.toBeNull()
    expect(exp!.motif).toBe('allows_mate')
    expect(exp!.mateIn).toBe(1)
    expect(exp!.sentence.toLowerCase()).toContain('mate in 1')
  })

  it('reports missed_mate when a forced mate is thrown away', () => {
    // Mover (White) had mate in 2 before; after the played move it is gone.
    const before = ply(['e4', 'e5'], ev({ mate: 2, bestMove: 'd1h5', pv: ['d1h5'] }))
    const after = ply(['e4', 'e5', 'Nf3'], ev({ cp: 30, bestMove: 'b8c6', pv: ['b8c6'] }))

    const exp = explainMove(before, after, MoveQuality.Miss)
    expect(exp!.motif).toBe('missed_mate')
    expect(exp!.mateIn).toBe(2)
  })
})

describe('explainMove — material', () => {
  it('names a hung queen with materialLost ~ 9', () => {
    // before: White to move, queen on d3, black pawn on e6 (not decided ~ even).
    // Best line keeps the queen (Qa3). The blunder Qd5 walks it onto the pawn's
    // capture square; the engine after-PV is the pawn taking it (e6xd5).
    const before: AnalyzedPly = {
      fen: '4k3/8/4p3/8/8/3Q4/8/4K3 w - - 0 1',
      san: '', moveNumber: 1, color: 'b',
      eval: ev({ cp: 50, bestMove: 'd3a3', pv: ['d3a3'] }),
    }
    const after: AnalyzedPly = {
      fen: '4k3/8/4p3/3Q4/8/8/8/4K3 b - - 0 1',
      san: 'Qd5', moveNumber: 1, color: 'w', // White just played Qd5
      eval: ev({ cp: -800, bestMove: 'e6d5', pv: ['e6d5'] }),
    }

    const exp = explainMove(before, after, MoveQuality.Blunder)
    expect(exp!.piece).toBe('queen')
    expect(exp!.square).toBe('d5')
    expect(exp!.materialLost).toBeGreaterThanOrEqual(8)
    expect(exp!.bestMove).not.toBe('Qd5')
  })

  it('reports ~0 material for an even trade (no "drops" claim)', () => {
    // Position with White Nd4 and Black pawn? Use a simple even recapture:
    // White Nxe5, Black ...Nxe5 (knight for knight via a real line).
    const beforeFen = 'rnbqkbnr/pppp1ppp/8/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 2'
    const before: AnalyzedPly = {
      fen: beforeFen, san: 'e5', moveNumber: 1, color: 'b',
      eval: ev({ cp: 30, bestMove: 'f3e5', pv: ['f3e5', 'd7d6', 'e5f3'] }),
    }
    // after Nxe5 (knight captures pawn): mover White is +1, but best line also
    // captured the pawn, so net material given up vs best ~ 0.
    const afterFen = new Chess(beforeFen)
    afterFen.move('Nxe5')
    const after: AnalyzedPly = {
      fen: afterFen.fen(), san: 'Nxe5', moveNumber: 2, color: 'w',
      eval: ev({ cp: 30, bestMove: 'd7d6', pv: ['d7d6'] }),
    }

    const mat = materialConsequence(before, after, uci(beforeFen, 'Nxe5'))
    expect(mat.net).toBe(0)
    expect(mat.piece).toBeNull()
  })

  it('near-equal inferior move makes no material claim', () => {
    const beforeFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    const before: AnalyzedPly = {
      fen: beforeFen, san: '', moveNumber: 0, color: 'w',
      eval: ev({ cp: 25, bestMove: 'e2e4', pv: ['e2e4', 'e7e5', 'g1f3'] }),
    }
    const afterFen = new Chess(beforeFen)
    afterFen.move('a3')
    const after: AnalyzedPly = {
      fen: afterFen.fen(), san: 'a3', moveNumber: 1, color: 'w',
      eval: ev({ cp: 5, bestMove: 'e7e5', pv: ['e7e5'] }),
    }

    const exp = explainMove(before, after, MoveQuality.Inaccuracy)
    expect(exp).not.toBeNull()
    expect(exp!.materialLost).toBe(0)
    expect(exp!.piece).toBeNull()
    expect(exp!.sentence.toLowerCase()).not.toContain('drops')
    // Better move + stakes are always present.
    expect(exp!.bestMove).toBe('e4')
    expect(exp!.stakes.length).toBeGreaterThan(0)
  })
})

describe('explainMove — gating', () => {
  it('suppresses explanation when the position was already winning (>90%)', () => {
    // Mover already crushing before the move (cp ~ +1500 → win% > 90).
    const beforeFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'
    const before: AnalyzedPly = {
      fen: beforeFen, san: '', moveNumber: 0, color: 'w',
      eval: ev({ cp: 1500, bestMove: 'e2e4', pv: ['e2e4'] }),
    }
    const afterFen = new Chess(beforeFen)
    afterFen.move('a3')
    const after: AnalyzedPly = {
      fen: afterFen.fen(), san: 'a3', moveNumber: 1, color: 'w',
      eval: ev({ cp: 1200, bestMove: 'e7e5', pv: ['e7e5'] }),
    }
    expect(explainMove(before, after, MoveQuality.Inaccuracy)).toBeNull()
  })

  it('does not explain good moves', () => {
    const beforeFen = new Chess().fen()
    const before: AnalyzedPly = {
      fen: beforeFen, san: '', moveNumber: 0, color: 'w',
      eval: ev({ cp: 20, bestMove: 'e2e4', pv: ['e2e4'] }),
    }
    const afterFen = new Chess(beforeFen)
    afterFen.move('e4')
    const after: AnalyzedPly = {
      fen: afterFen.fen(), san: 'e4', moveNumber: 1, color: 'w',
      eval: ev({ cp: 20, bestMove: 'e7e5', pv: ['e7e5'] }),
    }
    expect(explainMove(before, after, MoveQuality.Best)).toBeNull()
  })

  it('does not explain forced (single-legal-move) positions', () => {
    // White king on h1, only legal move; in check from a rook.
    const beforeFen = '7k/8/8/8/8/8/6r1/7K w - - 0 1'
    const before: AnalyzedPly = {
      fen: beforeFen, san: 'Rg2+', moveNumber: 1, color: 'b',
      eval: ev({ cp: -500, bestMove: 'h1g1', pv: ['h1g1'] }),
    }
    const afterFen = new Chess(beforeFen)
    const legal = afterFen.moves()
    afterFen.move(legal[0])
    const after: AnalyzedPly = {
      fen: afterFen.fen(), san: legal[0], moveNumber: 1, color: 'w',
      eval: ev({ cp: -500, bestMove: 'g2g1', pv: [] }),
    }
    expect(explainMove(before, after, MoveQuality.Blunder)).toBeNull()
  })
})
