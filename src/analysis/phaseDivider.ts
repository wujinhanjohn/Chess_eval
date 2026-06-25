/**
 * Splits a game into opening / middlegame / endgame from the POSITIONS, not the
 * move number — a port of the Lichess "Divider" algorithm. Three positional
 * signals decide when the game has left the opening, and a material signal
 * decides when it has entered the endgame:
 *
 *   midgame starts at the first position where ANY of:
 *     • majors+minors (Q/R/B/N count) ≤ MIDGAME_MAJORS_MINORS_MAX
 *     • a back rank is "sparse" (< BACKRANK_PIECE_MIN pieces — pieces developed)
 *     • mixedness > MIXEDNESS_MIDGAME_MIN (white & black pieces intermingled)
 *
 *   endgame starts at the first position (at/after midgame) where:
 *     • majors+minors ≤ ENDGAME_MAJORS_MINORS_MAX
 *
 * All thresholds are tunable constants below.
 *
 * TRANSITION RULE (decided once, applied everywhere): the indices returned are
 * ply indices into the position list, and a MOVE belongs to the phase of the
 * position it produces. So if `endgame` is index E, the move that reached
 * position E (ply E) is the first endgame move. See phaseOfPly().
 */

import type { Ply } from '../types'

// ── Tunable thresholds ──────────────────────────────────────────────────────

export const DIVIDER_THRESHOLDS = {
  /** Midgame once non-pawn/king material falls to this many pieces or fewer. */
  MIDGAME_MAJORS_MINORS_MAX: 10,
  /** Endgame once non-pawn/king material falls to this many pieces or fewer. */
  ENDGAME_MAJORS_MINORS_MAX: 6,
  /** A back rank with fewer than this many pieces counts as "sparse". */
  BACKRANK_PIECE_MIN: 4,
  /** Midgame once the mixedness score exceeds this. */
  MIXEDNESS_MIDGAME_MIN: 150,
} as const

// ── Types ───────────────────────────────────────────────────────────────────

export type Phase = 'opening' | 'middlegame' | 'endgame'

export interface Division {
  /** Ply index where the middlegame begins, or null if the game never left book/opening. */
  midgame: number | null
  /** Ply index where the endgame begins, or null if no endgame was reached. */
  endgame: number | null
  /** Number of positions considered (plies including the start position). */
  plyCount: number
}

interface Piece {
  color: 'w' | 'b'
  role: string // lowercase: p n b r q k
}

/** board[r][f]: r = 0..7 for ranks 1..8, f = 0..7 for files a..h. */
type Board = (Piece | null)[][]

// ── FEN → board ─────────────────────────────────────────────────────────────

function parseBoard(fen: string): Board {
  const placement = fen.split(' ')[0]
  const rows = placement.split('/') // rows[0] = rank 8 … rows[7] = rank 1
  const board: Board = Array.from({ length: 8 }, () => Array<Piece | null>(8).fill(null))
  for (let i = 0; i < 8; i++) {
    const rank = 8 - i // rows[i] describes this rank
    let file = 0
    for (const ch of rows[i]) {
      if (ch >= '1' && ch <= '8') {
        file += ch.charCodeAt(0) - 48
      } else {
        board[rank - 1][file] = {
          color: ch === ch.toUpperCase() ? 'w' : 'b',
          role: ch.toLowerCase(),
        }
        file++
      }
    }
  }
  return board
}

// ── Signals ─────────────────────────────────────────────────────────────────

/** Count of non-pawn, non-king pieces (queens, rooks, bishops, knights). */
function majorsAndMinors(board: Board): number {
  let n = 0
  for (const row of board) {
    for (const p of row) {
      if (p && p.role !== 'p' && p.role !== 'k') n++
    }
  }
  return n
}

/** True if either back rank (rank 1 or rank 8) has fewer than BACKRANK_PIECE_MIN pieces. */
function backrankSparse(board: Board): boolean {
  const min = DIVIDER_THRESHOLDS.BACKRANK_PIECE_MIN
  const rank1 = board[0].filter(Boolean).length
  const rank8 = board[7].filter(Boolean).length
  return rank1 < min || rank8 < min
}

/**
 * Per-region score for the mixedness measure (Lichess table). `y` is the rank
 * (1..8) of the region's lower edge + 1. White pieces score higher when
 * advanced (large y), black pieces when advanced (small y); equal mixing
 * scores highest — capturing the hand-to-hand fighting of a middlegame.
 */
function mixednessScore(white: number, black: number, y: number): number {
  if (white === 0 && black === 0) return 0
  if (white === 1 && black === 0) return 1 + (8 - y)
  if (white === 2 && black === 0) return y > 2 ? 2 + (y - 2) : 0
  if (white === 3 && black === 0) return y > 1 ? 3 + (y - 1) : 0
  if (white === 4 && black === 0) return y > 1 ? 3 + (y - 1) : 0

  if (white === 0 && black === 1) return 1 + y
  if (white === 1 && black === 1) return 5 + Math.abs(3 - y)
  if (white === 2 && black === 1) return 4 + y
  if (white === 3 && black === 1) return 5 + y
  if (white === 4 && black === 1) return 5 + y

  if (white === 0 && black === 2) return y < 6 ? 2 + (6 - y) : 0
  if (white === 1 && black === 2) return 4 + (6 - y)
  if (white === 2 && black === 2) return 7
  if (white === 3 && black === 2) return 8

  if (white === 0 && black === 3) return y < 7 ? 3 + (7 - y) : 0
  if (white === 1 && black === 3) return 5 + (6 - y)
  if (white === 2 && black === 3) return 8

  if (white === 0 && black === 4) return y < 7 ? 3 + (7 - y) : 0
  if (white === 1 && black === 4) return 5 + (6 - y)

  return 0
}

/** Sum the region score over every overlapping 2×2 block of the board. */
function mixedness(board: Board): number {
  let mix = 0
  for (let r = 0; r < 7; r++) {
    for (let f = 0; f < 7; f++) {
      let white = 0
      let black = 0
      for (let dr = 0; dr < 2; dr++) {
        for (let df = 0; df < 2; df++) {
          const p = board[r + dr][f + df]
          if (p) {
            if (p.color === 'w') white++
            else black++
          }
        }
      }
      // r is 0-indexed for rank 1; Lichess passes the region rank (1..7) + 1.
      mix += mixednessScore(white, black, r + 2)
    }
  }
  return mix
}

// ── Public API ──────────────────────────────────────────────────────────────

function isMidgameStart(board: Board): boolean {
  return (
    majorsAndMinors(board) <= DIVIDER_THRESHOLDS.MIDGAME_MAJORS_MINORS_MAX ||
    backrankSparse(board) ||
    mixedness(board) > DIVIDER_THRESHOLDS.MIXEDNESS_MIDGAME_MIN
  )
}

function isEndgameStart(board: Board): boolean {
  return majorsAndMinors(board) <= DIVIDER_THRESHOLDS.ENDGAME_MAJORS_MINORS_MAX
}

/**
 * Computes the phase division of a game from its ply positions. `plies[0]` is
 * the starting position; `plies[k]` is the position after ply k.
 */
export function divideGame(plies: Ply[]): Division {
  const boards = plies.map((p) => parseBoard(p.fen))

  let midgame: number | null = null
  for (let i = 0; i < boards.length; i++) {
    if (isMidgameStart(boards[i])) {
      midgame = i
      break
    }
  }

  let endgame: number | null = null
  if (midgame !== null) {
    for (let i = 0; i < boards.length; i++) {
      if (isEndgameStart(boards[i])) {
        endgame = i
        break
      }
    }
  }

  // Keep the invariant midgame < endgame; a position can satisfy both triggers,
  // in which case it is the endgame start and there is no separate middlegame.
  if (midgame !== null && endgame !== null && midgame >= endgame) {
    midgame = null
  }

  return { midgame, endgame, plyCount: plies.length }
}

/** Phase of the move that produced position `plyIndex` (see TRANSITION RULE). */
export function phaseOfPly(division: Division, plyIndex: number): Phase {
  if (division.endgame !== null && plyIndex >= division.endgame) return 'endgame'
  if (division.midgame !== null && plyIndex >= division.midgame) return 'middlegame'
  return 'opening'
}
