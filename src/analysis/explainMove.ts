/**
 * Human-readable explanations for sub-optimal moves.
 *
 * GOVERNING RULE: the engine is the ONLY source of truth. Every claim a
 * sentence makes is read off engine output (eval, best move, PV, mate score)
 * that the analysis pass already produced — we never invent a tactic. When a
 * fact can't be verified from engine output we fall back to a generic, true
 * statement (the positional/"better move" template).
 *
 * No re-search is needed: for a flagged ply k the analysis pass has already
 * stored the eval + best move + PV for the position BEFORE the move
 * (analyzedPlies[k-1].eval) and the eval + PV for the position AFTER it
 * (analyzedPlies[k].eval). All evals are White-perspective; we normalize to
 * the MOVING player's perspective here (positive = good for the player who
 * just moved) — sign handling is the #1 bug source, so it is explicit
 * throughout.
 */

import { Chess } from 'chess.js'
import type { AnalyzedPly, EvalResult } from '../types'
import { MoveQuality } from './moveQuality'
import { evalToMoverWinPct } from './winProbability'

// ── Tunables ─────────────────────────────────────────────────────────────────

export const EXPLAIN_THRESHOLDS = {
  /** Position already decided before the move → don't explain (mover win %). */
  suppressWinAbove: 90,
  suppressWinBelow: 10,
  /** Net pawns (mover's perspective) given up vs. the best line to count as a
   *  material loss rather than a positional one. */
  materialMinPawns: 0.8,
  /** How close net loss must be to a single piece's value to name that piece. */
  singlePieceTolerance: 1.0,
  /** Plies of PV to walk when measuring material consequence. */
  maxPvPlies: 12,
} as const

/** Qualities worth explaining — "inaccuracy or worse" (Miss is a thrown-away win). */
const EXPLAINABLE: ReadonlySet<MoveQuality> = new Set([
  MoveQuality.Inaccuracy,
  MoveQuality.Mistake,
  MoveQuality.Miss,
  MoveQuality.Blunder,
])

// ── Output contract ───────────────────────────────────────────────────────────

export interface MoveExplanation {
  square: string | null        // hung-piece square if a single piece was identified
  piece: string | null         // "knight" etc. if a single piece was dropped
  materialLost: number         // pawns given up vs. the best line; 0 if positional
  motif: 'missed_mate' | 'allows_mate' | null  // ONLY engine-verified
  mateIn: number | null
  bestMove: string             // SAN of the engine's best move
  bestLine: string[]           // first few SAN plies of the best line
  betterEvalPhrase: string
  stakes: string
  sentence: string             // final rendered one-liner for the UI
}

// ── Material helpers ───────────────────────────────────────────────────────────

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 }
const PIECE_NAME: Record<string, string> = {
  p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king',
}

/** Material balance from the mover's perspective (positive = mover ahead). */
function moverMaterial(fen: string, mover: 'w' | 'b'): number {
  let whiteMinusBlack = 0
  for (const row of new Chess(fen).board()) {
    for (const sq of row) {
      if (!sq) continue
      const v = PIECE_VALUE[sq.type] ?? 0
      whiteMinusBlack += sq.color === 'w' ? v : -v
    }
  }
  return mover === 'w' ? whiteMinusBlack : -whiteMinusBlack
}

interface LineWalk {
  /** Lowest mover-material balance (relative to the start) reached in the line. */
  trough: number
  /** The opponent capture of a mover piece that produced the trough, if any. */
  capturedAtTrough: { square: string; pieceType: string } | null
}

/**
 * Walk `uciMoves` from `startFen`, recomputing the mover's material balance after
 * each ply (recounting the board sidesteps en-passant/promotion bookkeeping), and
 * report the worst balance reached and the decisive opponent capture there.
 */
function walkLine(startFen: string, uciMoves: string[], mover: 'w' | 'b'): LineWalk {
  const chess = new Chess(startFen)
  const baseline = moverMaterial(startFen, mover)
  let trough = 0 // relative to baseline
  let capturedAtTrough: { square: string; pieceType: string } | null = null

  const limit = Math.min(uciMoves.length, EXPLAIN_THRESHOLDS.maxPvPlies)
  for (let i = 0; i < limit; i++) {
    const uci = uciMoves[i]
    let move
    try {
      move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || undefined,
      })
    } catch {
      break
    }
    if (!move) break

    const rel = moverMaterial(chess.fen(), mover) - baseline
    if (rel < trough) {
      trough = rel
      // A new trough caused by the opponent capturing one of the mover's pieces
      // tells us which piece was lost and where.
      capturedAtTrough =
        move.color !== mover && move.captured
          ? { square: move.to, pieceType: move.captured }
          : null
    }
  }

  return { trough, capturedAtTrough }
}

export interface MaterialConsequence {
  /** Pawns the played move gives up vs. the best line (>= 0); 0 if positional. */
  net: number
  square: string | null
  piece: string | null
  multi: boolean
}

/**
 * PRIMARY method (engine PV-walk, not a standalone SEE): compares the worst
 * material the mover reaches in the PLAYED line against the worst in the
 * engine's BEST line from the same starting position. An even trade that also
 * happens in the best line nets to ~0 and is NOT reported as a loss.
 */
export function materialConsequence(
  before: AnalyzedPly,
  after: AnalyzedPly,
  playedUci: string,
): MaterialConsequence {
  const mover = after.color
  const played = walkLine(before.fen, [playedUci, ...(after.eval.pv ?? [])], mover)
  const best = walkLine(before.fen, before.eval.pv ?? [], mover)

  const net = best.trough - played.trough
  if (net < EXPLAIN_THRESHOLDS.materialMinPawns) {
    return { net: 0, square: null, piece: null, multi: false }
  }

  // A static "is this piece hanging" check could also name the piece, but a pin
  // or an overloaded defender can fool it — so the PV-walk (engine) wins and we
  // only borrow the captured-piece identity it surfaced.
  const cap = played.capturedAtTrough
  if (cap) {
    const pieceVal = PIECE_VALUE[cap.pieceType] ?? 0
    if (Math.abs(net - pieceVal) <= EXPLAIN_THRESHOLDS.singlePieceTolerance) {
      return { net, square: cap.square, piece: PIECE_NAME[cap.pieceType] ?? null, multi: false }
    }
  }
  return { net, square: null, piece: null, multi: true }
}

// ── UCI → SAN ──────────────────────────────────────────────────────────────────

function uciToSan(fen: string, uci: string): string | null {
  try {
    const move = new Chess(fen).move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || undefined,
    })
    return move ? move.san : null
  } catch {
    return null
  }
}

function uciLineToSan(fen: string, uciLine: string[], maxPlies: number): string[] {
  const chess = new Chess(fen)
  const sans: string[] = []
  for (let i = 0; i < uciLine.length && i < maxPlies; i++) {
    const uci = uciLine[i]
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || undefined,
      })
      if (!move) break
      sans.push(move.san)
    } catch {
      break
    }
  }
  return sans
}

// ── Mate / stakes / phrasing ───────────────────────────────────────────────────

function mateFavors(e: EvalResult, side: 'w' | 'b'): boolean {
  if (e.mate === null) return false
  return side === 'w' ? e.mate > 0 : e.mate < 0
}

type StakeBucket = 'winning' | 'better' | 'equal' | 'worse' | 'losing'

function bucket(winPct: number): StakeBucket {
  if (winPct > 80) return 'winning'
  if (winPct > 60) return 'better'
  if (winPct >= 40) return 'equal'
  if (winPct >= 20) return 'worse'
  return 'losing'
}

const BUCKET_NOUN: Record<StakeBucket, string> = {
  winning: 'winning', better: 'better', equal: 'equal', worse: 'worse', losing: 'losing',
}

function article(noun: string): string {
  return /^[aeiou]/.test(noun) ? 'an' : 'a'
}

function stakesSentence(winBefore: number, winAfter: number): string {
  const b = bucket(winBefore)
  const a = bucket(winAfter)
  if (b === a) return `Stayed roughly ${BUCKET_NOUN[b]}, but conceded ground.`
  return `Turned ${article(BUCKET_NOUN[b])} ${BUCKET_NOUN[b]} position into ${article(BUCKET_NOUN[a])} ${BUCKET_NOUN[a]} one.`
}

/** Mover-perspective eval, formatted like the eval bar ("+1.8", "-0.4", "M+3"). */
function fmtMoverEval(e: EvalResult, mover: 'w' | 'b'): string {
  const sign = mover === 'w' ? 1 : -1
  if (e.mate !== null) {
    const m = e.mate * sign
    return m > 0 ? `M+${m}` : `M${m}`
  }
  if (e.cp !== null) {
    const cp = (e.cp * sign) / 100
    return cp >= 0 ? `+${cp.toFixed(1)}` : cp.toFixed(1)
  }
  return ''
}

function betterEvalPhrase(before: EvalResult, mover: 'w' | 'b'): string {
  if (mateFavors(before, mover)) {
    return `forces mate in ${Math.abs(before.mate as number)}`
  }
  const win = evalToMoverWinPct(before, mover)
  const base =
    win > 80 ? 'keeps a winning position'
    : win > 60 ? 'keeps a clear edge'
    : win >= 40 ? 'keeps the balance'
    : win >= 20 ? 'keeps the damage minimal'
    : 'was the toughest defense'
  const ev = fmtMoverEval(before, mover)
  return ev ? `${base} (${ev})` : base
}

// ── Main ────────────────────────────────────────────────────────────────────

/** UCI of the move that produced `san` from `beforeFen`, or null if illegal. */
function playedUci(beforeFen: string, san: string): string | null {
  try {
    const move = new Chess(beforeFen).move(san)
    return move ? move.from + move.to + (move.promotion ?? '') : null
  } catch {
    return null
  }
}

function legalMoveCount(fen: string): number {
  try {
    return new Chess(fen).moves().length
  } catch {
    return 0
  }
}

/**
 * Produce a one-line explanation for a flagged move, or null when the move
 * shouldn't be explained (good enough, forced, or the position was already
 * decided). `quality` is the move's classification; `before`/`after` are the
 * analyzed plies straddling it.
 */
export function explainMove(
  before: AnalyzedPly,
  after: AnalyzedPly,
  quality: MoveQuality,
): MoveExplanation | null {
  // ── Gating ──────────────────────────────────────────────────────────────
  if (!EXPLAINABLE.has(quality)) return null
  // Forced: a single legal move can't be a mistake worth explaining.
  if (legalMoveCount(before.fen) <= 1) return null

  const mover = after.color
  const winBefore = evalToMoverWinPct(before.eval, mover)
  const winAfter = evalToMoverWinPct(after.eval, mover)

  const uci = playedUci(before.fen, after.san)
  if (!uci) return null

  // ── Better move + stakes (always included) ────────────────────────────────
  const bestUci = before.eval.pv?.[0] ?? before.eval.bestMove
  const bestMove = bestUci ? uciToSan(before.fen, bestUci) ?? '' : ''
  const bestLine = before.eval.pv?.length ? uciLineToSan(before.fen, before.eval.pv, 3) : []
  const stakes = stakesSentence(winBefore, winAfter)
  const phrase = betterEvalPhrase(before.eval, mover)

  const base: MoveExplanation = {
    square: null,
    piece: null,
    materialLost: 0,
    motif: null,
    mateIn: null,
    bestMove,
    bestLine,
    betterEvalPhrase: phrase,
    stakes,
    sentence: '',
  }

  // ── Missed mate (priority over everything; always worth flagging) ──────────
  // Checked BEFORE win% suppression: a forced mate reads as win% 100, which the
  // suppression rule would otherwise swallow — but throwing away a forced win is
  // exactly what a player wants explained.
  if (mateFavors(before.eval, mover) && !mateFavors(after.eval, mover)) {
    const mateIn = Math.abs(before.eval.mate as number)
    return {
      ...base,
      motif: 'missed_mate',
      mateIn,
      sentence: bestMove
        ? `Missed mate in ${mateIn} with ${bestMove}.`
        : `Missed mate in ${mateIn}.`,
    }
  }

  // Suppress when the story was already over before the move (and no mate was
  // missed): "everything is a blunder when you're already lost / winning easily".
  if (winBefore > EXPLAIN_THRESHOLDS.suppressWinAbove) return null
  if (winBefore < EXPLAIN_THRESHOLDS.suppressWinBelow) return null

  // ── Allows mate (priority over material) ───────────────────────────────────
  // Played move allows the opponent a forced mate that wasn't already there.
  const opponent: 'w' | 'b' = mover === 'w' ? 'b' : 'w'
  if (mateFavors(after.eval, opponent) && !mateFavors(before.eval, opponent)) {
    const mateIn = Math.abs(after.eval.mate as number)
    return {
      ...base,
      motif: 'allows_mate',
      mateIn,
      sentence: bestMove
        ? `Allows mate in ${mateIn}; ${bestMove} held.`
        : `Allows mate in ${mateIn}.`,
    }
  }

  // ── Material consequence (engine PV-walk) ──────────────────────────────────
  const mat = materialConsequence(before, after, uci)
  const better = bestMove ? `${bestMove} was better.` : phrase + '.'

  if (mat.net > 0 && !mat.multi && mat.piece && mat.square) {
    return {
      ...base,
      square: mat.square,
      piece: mat.piece,
      materialLost: round1(mat.net),
      sentence: `Drops the ${mat.piece} on ${mat.square}. ${better}`,
    }
  }
  if (mat.net > 0) {
    return {
      ...base,
      materialLost: round1(mat.net),
      sentence: `Loses material (${round1(mat.net)} pawns). ${better}`,
    }
  }

  // ── Positional ─────────────────────────────────────────────────────────────
  return {
    ...base,
    sentence: bestMove ? `${stakes} ${bestMove} was better.` : stakes,
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
