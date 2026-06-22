import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Chess } from 'chess.js'
import { Chessboard } from 'react-chessboard'
import { CONFIG } from '../config'
import { Engine } from '../engine/Engine'
import { analyzeGame } from '../analysis/analyzeGame'
import { refineAnalysis } from '../analysis/refineAnalysis'
import { classifyGame } from '../analysis/classifyGame'
import { loadAnalysis, saveAnalysis } from '../analysis/analysisCache'
import type { ClassifiedMove, GameClassification } from '../analysis/classifyGame'
import { MoveQuality } from '../analysis/moveQuality'
import { EvalBar } from './EvalBar'
import { EvalGraph } from './EvalGraph'
import { MoveQualityBadge } from './MoveQualityBadge'
import type { Game, Ply, AnalyzedPly, EvalResult, MultiPVResult } from '../types'
import './GameViewer.css'

const ANALYSIS_DEPTH = 16
const EXPLORE_DEPTH = 14   // lower for responsiveness in interactive mode

// Arrow shape for react-chessboard v5
type RCBArrow = { startSquare: string; endSquare: string; color: string }

// ── UCI / display helpers ──────────────────────────────────────────────────

/** Convert UCI PV to display text: "1. Nxf3 Bxf3 2. Qxf3 …" */
function pvDisplay(
  startFen: string,
  pvUci: string[],
  maxMoves = 6,
): { firstSan: string; continuation: string } {
  const chess = new Chess(startFen)
  const parts: string[] = []
  let moveNum = parseInt(startFen.split(' ')[5] ?? '1')
  let turn = (startFen.split(' ')[1] ?? 'w') as 'w' | 'b'
  let firstSan = ''

  for (let i = 0; i < pvUci.length && i < maxMoves; i++) {
    try {
      const uci = pvUci[i]
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || undefined,
      })
      if (!move) break
      if (i === 0) {
        firstSan = move.san
        parts.push(turn === 'b' ? `${moveNum}…` : `${moveNum}.`)
        parts.push(move.san)
      } else {
        if (turn === 'w') parts.push(`${moveNum}.`)
        parts.push(move.san)
      }
      if (turn === 'b') moveNum++
      turn = turn === 'w' ? 'b' : 'w'
    } catch { break }
  }

  return { firstSan, continuation: parts.slice(2).join(' ') }
}

/** Replay UCI moves from a FEN; return per-step FENs and SANs. */
function buildSequence(
  startFen: string,
  pvUci: string[],
): { fens: string[]; sans: string[]; moves: string[] } {
  const chess = new Chess(startFen)
  const fens = [startFen]
  const sans: string[] = []
  const moves: string[] = []
  for (const uci of pvUci) {
    try {
      const move = chess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: (uci[4] as 'q' | 'r' | 'b' | 'n') || undefined,
      })
      if (!move) break
      sans.push(move.san)
      fens.push(chess.fen())
      moves.push(uci)
    } catch { break }
  }
  return { fens, sans, moves }
}

// ── Ply helpers ────────────────────────────────────────────────────────────

function buildPlies(pgn: string): Ply[] {
  try {
    const chess = new Chess()
    chess.loadPgn(pgn)
    const history = chess.history({ verbose: true })
    if (history.length === 0) return [{ fen: chess.fen(), san: '', moveNumber: 0, color: 'w' }]
    const plies: Ply[] = [{ fen: history[0].before, san: '', moveNumber: 0, color: 'w' }]
    for (let i = 0; i < history.length; i++) {
      const m = history[i]
      plies.push({ fen: m.after, san: m.san, moveNumber: Math.ceil((i + 1) / 2), color: m.color })
    }
    return plies
  } catch {
    return [{ fen: new Chess().fen(), san: '', moveNumber: 0, color: 'w' }]
  }
}

function plyLabel(ply: Ply): string {
  if (ply.moveNumber === 0) return 'Start'
  return `${ply.moveNumber}${ply.color === 'b' ? '...' : '.'} ${ply.san}`
}

function fmtEval(e: EvalResult): string {
  if (e.mate !== null) return e.mate > 0 ? `M+${e.mate}` : `M${e.mate}`
  if (e.cp !== null) {
    const p = (e.cp / 100).toFixed(1)
    return e.cp >= 0 ? `+${p}` : p
  }
  return ''
}

// ── State types ────────────────────────────────────────────────────────────

type AnalysisState =
  | { phase: 'idle' }
  | { phase: 'running'; partial: AnalyzedPly[]; total: number }
  | { phase: 'refining'; results: AnalyzedPly[]; done: number; total: number }
  | { phase: 'done'; results: AnalyzedPly[]; multiPV: Map<number, MultiPVResult[]>; fromCache?: boolean }
  | { phase: 'error'; message: string }

interface PvPreview {
  returnToPly: number  // mainline ply to restore on exit
  pvMoves: string[]    // validated UCI moves
  fens: string[]       // FEN at each step; [0] = position before first PV move
  sans: string[]       // SAN labels; sans[i] = move that led to fens[i+1]
  offset: number       // 0 = fens[0], N = fens[N]
}

interface ExploreState {
  basePly: number   // mainline ply branched from
  moves: string[]   // UCI moves played so far (full history, may exceed offset)
  fens: string[]    // [baseFen, after move 1, …]
  sans: string[]    // SAN labels
  evals: (EvalResult | null)[]  // aligned with fens; eval of each position (null until computed)
  offset: number    // current position in variation
}

// ── MoveList ───────────────────────────────────────────────────────────────

interface MoveListProps {
  plies: Ply[]
  currentPly: number
  onSelect: (i: number) => void
  evals?: AnalyzedPly[]
  classifications?: ClassifiedMove[]
  disabled?: boolean
}

function MoveList({ plies, currentPly, onSelect, evals, classifications, disabled }: MoveListProps) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentPly])

  const pairs = useMemo(() => {
    const r: Array<{ n: number; wIdx: number; bIdx: number | null }> = []
    for (let i = 1; i < plies.length; i += 2)
      r.push({ n: plies[i].moveNumber, wIdx: i, bIdx: i + 1 < plies.length ? i + 1 : null })
    return r
  }, [plies])

  return (
    <div className={`move-list${disabled ? ' move-list--dim' : ''}`} ref={listRef}>
      {pairs.map(({ n, wIdx, bIdx }) => {
        const wEval = evals?.[wIdx] ? fmtEval(evals[wIdx].eval) : ''
        const bEval = bIdx !== null && evals?.[bIdx] ? fmtEval(evals[bIdx].eval) : ''
        const wC = classifications?.[wIdx]
        const bC = bIdx !== null ? classifications?.[bIdx] : undefined
        return (
          <div key={n} className="move-pair">
            <span className="move-num">{n}.</span>
            <button
              className={`move-btn${currentPly === wIdx ? ' active' : ''}`}
              onClick={() => !disabled && onSelect(wIdx)}
              data-active={currentPly === wIdx}
            >
              <span className="move-san">{plies[wIdx].san}</span>
              <span className="move-meta">
                {wC?.quality && <MoveQualityBadge quality={wC.quality} compact debug={wC.debug} />}
                {wEval && <span className="move-eval">{wEval}</span>}
              </span>
            </button>
            {bIdx !== null ? (
              <button
                className={`move-btn${currentPly === bIdx ? ' active' : ''}`}
                onClick={() => !disabled && onSelect(bIdx)}
                data-active={currentPly === bIdx}
              >
                <span className="move-san">{plies[bIdx].san}</span>
                <span className="move-meta">
                  {bC?.quality && <MoveQualityBadge quality={bC.quality} compact debug={bC.debug} />}
                  {bEval && <span className="move-eval">{bEval}</span>}
                </span>
              </button>
            ) : (
              <span className="move-btn" />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── GameViewer ─────────────────────────────────────────────────────────────

interface Props { game: Game; onBack: () => void }

export function GameViewer({ game, onBack }: Props) {
  const plies = useMemo(() => buildPlies(game.pgn), [game.pgn])

  // ── Core state ────────────────────────────────────────────────────
  const [currentPly, setCurrentPly] = useState(0)
  const [analysis, setAnalysis] = useState<AnalysisState>({ phase: 'idle' })
  const [showArrow, setShowArrow] = useState(false)
  const [pvPreview, setPvPreview] = useState<PvPreview | null>(null)
  const [explore, setExplore] = useState<ExploreState | null>(null)
  const [exploreEval, setExploreEval] = useState<EvalResult | null>(null)
  const [exploreEvalLoading, setExploreEvalLoading] = useState(false)
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null)

  const engineRef = useRef<Engine | null>(null)
  const signalRef = useRef({ cancelled: false })
  const exploreEngineRef = useRef<Engine | null>(null)
  const exploreSignalRef = useRef({ cancelled: false })

  const isMyWhite = game.white.username.toLowerCase() === CONFIG.username.toLowerCase()
  const orientation = isMyWhite ? 'white' : 'black'
  const isInPvPreview = pvPreview !== null
  const isInExplore = explore !== null

  // ── Derived analysis data ─────────────────────────────────────────
  const evals: AnalyzedPly[] | undefined = useMemo(() => {
    if (analysis.phase === 'running') return analysis.partial
    if (analysis.phase === 'refining' || analysis.phase === 'done') return analysis.results
    return undefined
  }, [analysis])

  const multiPVCache = analysis.phase === 'done' ? analysis.multiPV : undefined

  const gameClassification = useMemo<GameClassification | undefined>(
    () => (evals && evals.length > 0 ? classifyGame(evals, multiPVCache) : undefined),
    [evals, multiPVCache],
  )
  const classifications = gameClassification?.moves
  const opening = gameClassification?.opening

  // ── Display values ────────────────────────────────────────────────
  const displayFen = isInExplore
    ? explore.fens[explore.offset]
    : isInPvPreview
      ? pvPreview.fens[pvPreview.offset]
      : plies[currentPly].fen

  const displayEval: EvalResult | null = isInExplore
    ? exploreEval
    : isInPvPreview
      ? null
      : (evals?.[currentPly]?.eval ?? null)

  // ── Arrows ────────────────────────────────────────────────────────
  const arrows = useMemo((): RCBArrow[] => {
    if (!showArrow) return []
    if (isInPvPreview && pvPreview) {
      if (pvPreview.offset < pvPreview.pvMoves.length) {
        const uci = pvPreview.pvMoves[pvPreview.offset]
        return [{ startSquare: uci.slice(0, 2), endSquare: uci.slice(2, 4), color: '#3b82f6' }]
      }
      return []
    }
    const bm = isInExplore ? exploreEval?.bestMove : evals?.[currentPly]?.eval?.bestMove
    if (!bm || bm === '' || bm === '(none)') return []
    return [{ startSquare: bm.slice(0, 2), endSquare: bm.slice(2, 4), color: '#3b82f6' }]
  }, [showArrow, isInPvPreview, pvPreview, isInExplore, exploreEval, evals, currentPly])

  // ── Best-line data (for "Best was" panel) ─────────────────────────
  const bestLineData = useMemo(() => {
    if (!evals || currentPly === 0 || isInPvPreview || isInExplore) return null
    const q = classifications?.[currentPly]?.quality
    if (!q || q === MoveQuality.Best || q === MoveQuality.Brilliant ||
        q === MoveQuality.Great || q === MoveQuality.Book) return null
    const prevEval = evals[currentPly - 1]?.eval
    if (!prevEval?.bestMove || !prevEval.pv?.length) return null
    const baseFen = plies[currentPly - 1].fen
    const { firstSan, continuation } = pvDisplay(baseFen, prevEval.pv, 7)
    if (!firstSan) return null
    return { firstSan, continuation, baseFen, pvUci: prevEval.pv }
  }, [evals, currentPly, plies, classifications, isInPvPreview, isInExplore])

  // ── Explore turn ──────────────────────────────────────────────────
  const exploreTurn = useMemo((): 'w' | 'b' => {
    if (!explore) return 'w'
    return (explore.fens[explore.offset].split(' ')[1] ?? 'w') as 'w' | 'b'
  }, [explore])

  // ── Explore move classifications ──────────────────────────────────
  // Grade each played variation move (Best, Excellent, … Blunder, Miss) by
  // reusing the mainline classifier on its before/after eval pair. Brilliant/
  // Great need the multi-PV second pass and so don't appear here. A move stays
  // unclassified until both surrounding positions have been evaluated.
  const exploreClassifications = useMemo<(MoveQuality | null)[]>(() => {
    if (!explore) return []
    return explore.sans.map((san, i) => {
      const beforeEval = explore.evals[i]
      const afterEval = explore.evals[i + 1]
      if (!beforeEval || !afterEval) return null
      const mover = (explore.fens[i].split(' ')[1] ?? 'w') as 'w' | 'b'
      const before: AnalyzedPly = { fen: explore.fens[i], san: '', moveNumber: 0, color: 'w', eval: beforeEval }
      const after: AnalyzedPly = { fen: explore.fens[i + 1], san, moveNumber: 1, color: mover, eval: afterEval }
      return classifyGame([before, after]).moves[1]?.quality ?? null
    })
  }, [explore])

  // ── Mainline navigation ───────────────────────────────────────────
  const goTo = useCallback(
    (i: number) => setCurrentPly(Math.max(0, Math.min(i, plies.length - 1))),
    [plies.length],
  )

  // ── PV preview ────────────────────────────────────────────────────
  const enterPvPreview = useCallback(() => {
    if (!evals || currentPly === 0) return
    const prevEval = evals[currentPly - 1]?.eval
    if (!prevEval?.pv?.length) return
    const baseFen = plies[currentPly - 1].fen
    const { fens, sans, moves } = buildSequence(baseFen, prevEval.pv)
    if (!moves.length) return
    setPvPreview({ returnToPly: currentPly, pvMoves: moves, fens, sans, offset: 0 })
  }, [evals, currentPly, plies])

  const exitPvPreview = useCallback(() => {
    if (!pvPreview) return
    setCurrentPly(pvPreview.returnToPly)
    setPvPreview(null)
  }, [pvPreview])

  const pvStep = useCallback((dir: 1 | -1) => {
    setPvPreview(prev => {
      if (!prev) return prev
      const n = prev.offset + dir
      if (n < 0 || n > prev.sans.length) return prev
      return { ...prev, offset: n }
    })
  }, [])

  // ── Explore engine eval ────────────────────────────────────────────
  // Evaluates `fen` (the position at `offset` in the variation) and records the
  // result both as the live eval and into explore.evals[offset] so each played
  // move keeps its own evaluation.
  const evaluateExplorePosition = useCallback(async (fen: string, offset: number) => {
    exploreSignalRef.current.cancelled = true
    const signal = { cancelled: false }
    exploreSignalRef.current = signal
    setExploreEval(null)
    setExploreEvalLoading(true)
    const engine = exploreEngineRef.current
    if (!engine) { setExploreEvalLoading(false); return }
    try {
      await engine.ready
      const result = await engine.evaluate(fen, EXPLORE_DEPTH)
      if (signal.cancelled) return
      setExploreEval(result)
      setExploreEvalLoading(false)
      setExplore(prev => {
        // Guard against the variation having changed under us.
        if (!prev || prev.fens[offset] !== fen || prev.evals[offset] === result) return prev
        const evals = prev.evals.slice()
        evals[offset] = result
        return { ...prev, evals }
      })
    } catch {
      if (!signal.cancelled) setExploreEvalLoading(false)
    }
  }, [])

  // ── Explore mode ──────────────────────────────────────────────────
  const enterExplore = useCallback(() => {
    if (isInExplore) return
    setPvPreview(null)
    const baseFen = plies[currentPly].fen
    setExplore({ basePly: currentPly, moves: [], fens: [baseFen], sans: [], evals: [null], offset: 0 })
    setExploreEval(null)
    const engine = new Engine()
    exploreEngineRef.current = engine
    void evaluateExplorePosition(baseFen, 0)
  }, [isInExplore, currentPly, plies, evaluateExplorePosition])

  const exitExplore = useCallback(() => {
    exploreSignalRef.current.cancelled = true
    exploreEngineRef.current?.terminate()
    exploreEngineRef.current = null
    setExplore(null)
    setExploreEval(null)
    setExploreEvalLoading(false)
    setPendingPromotion(null)
  }, [])

  const exploreGoTo = useCallback((offset: number) => {
    setExplore(prev => {
      if (!prev) return prev
      const clamped = Math.max(0, Math.min(offset, prev.moves.length))
      if (clamped === prev.offset) return prev
      void evaluateExplorePosition(prev.fens[clamped], clamped)
      return { ...prev, offset: clamped }
    })
  }, [evaluateExplorePosition])

  const exploreTakeback = useCallback(() => {
    setExplore(prev => {
      if (!prev || prev.moves.length === 0) return prev
      const newMoves = prev.moves.slice(0, -1)
      const newFens = prev.fens.slice(0, -1)
      const newSans = prev.sans.slice(0, -1)
      const newEvals = prev.evals.slice(0, -1)
      const newOffset = Math.min(prev.offset, newMoves.length)
      void evaluateExplorePosition(newFens[newOffset], newOffset)
      return { ...prev, moves: newMoves, fens: newFens, sans: newSans, evals: newEvals, offset: newOffset }
    })
  }, [evaluateExplorePosition])

  const exploreClear = useCallback(() => {
    setExplore(prev => {
      if (!prev) return prev
      void evaluateExplorePosition(prev.fens[0], 0)
      return { ...prev, moves: [], fens: [prev.fens[0]], sans: [], evals: [prev.evals[0] ?? null], offset: 0 }
    })
  }, [evaluateExplorePosition])

  // ── Piece drop ────────────────────────────────────────────────────
  const handlePieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: { sourceSquare: string; targetSquare: string | null }): boolean => {
      if (!explore || !targetSquare) return false
      const fen = explore.fens[explore.offset]
      const chess = new Chess(fen)

      const piece = chess.get(sourceSquare as Parameters<typeof chess.get>[0])
      const isPromotion =
        piece?.type === 'p' &&
        ((piece.color === 'w' && targetSquare[1] === '8') ||
         (piece.color === 'b' && targetSquare[1] === '1'))

      if (isPromotion) {
        setPendingPromotion({ from: sourceSquare, to: targetSquare })
        return false
      }

      let move: ReturnType<typeof chess.move>
      try {
        move = chess.move({ from: sourceSquare, to: targetSquare })
      } catch { return false }
      if (!move) return false

      const uci = move.from + move.to
      const newMoves = [...explore.moves.slice(0, explore.offset), uci]
      const newFens = [...explore.fens.slice(0, explore.offset + 1), chess.fen()]
      const newSans = [...explore.sans.slice(0, explore.offset), move.san]
      const newEvals = [...explore.evals.slice(0, explore.offset + 1), null]
      setExplore({ ...explore, moves: newMoves, fens: newFens, sans: newSans, evals: newEvals, offset: explore.offset + 1 })
      void evaluateExplorePosition(chess.fen(), explore.offset + 1)
      return true
    },
    [explore, evaluateExplorePosition],
  )

  const handlePromotion = useCallback(
    (piece: 'q' | 'r' | 'b' | 'n') => {
      if (!pendingPromotion || !explore) return
      const fen = explore.fens[explore.offset]
      const chess = new Chess(fen)
      let move: ReturnType<typeof chess.move>
      try {
        move = chess.move({ from: pendingPromotion.from, to: pendingPromotion.to, promotion: piece })
      } catch { setPendingPromotion(null); return }
      if (!move) { setPendingPromotion(null); return }
      const uci = move.from + move.to + piece
      const newMoves = [...explore.moves.slice(0, explore.offset), uci]
      const newFens = [...explore.fens.slice(0, explore.offset + 1), chess.fen()]
      const newSans = [...explore.sans.slice(0, explore.offset), move.san]
      const newEvals = [...explore.evals.slice(0, explore.offset + 1), null]
      setExplore({ ...explore, moves: newMoves, fens: newFens, sans: newSans, evals: newEvals, offset: explore.offset + 1 })
      setPendingPromotion(null)
      void evaluateExplorePosition(chess.fen(), explore.offset + 1)
    },
    [pendingPromotion, explore, evaluateExplorePosition],
  )

  // ── Keyboard navigation ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isInExplore) { exitExplore(); return }
        if (isInPvPreview) { exitPvPreview(); return }
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        if (isInExplore) exploreGoTo((explore?.offset ?? 0) - 1)
        else if (isInPvPreview) pvStep(-1)
        else setCurrentPly(p => Math.max(0, p - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        if (isInExplore) exploreGoTo((explore?.offset ?? 0) + 1)
        else if (isInPvPreview) pvStep(1)
        else setCurrentPly(p => Math.min(plies.length - 1, p + 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [plies.length, isInExplore, isInPvPreview, explore, pvStep, exploreGoTo, exitExplore, exitPvPreview])

  // ── Cleanup on unmount ────────────────────────────────────────────
  useEffect(() => {
    return () => {
      signalRef.current.cancelled = true
      engineRef.current?.terminate()
      exploreSignalRef.current.cancelled = true
      exploreEngineRef.current?.terminate()
    }
  }, [])

  // ── Auto-load saved analysis ──────────────────────────────────────
  // Re-opening an already-evaluated game restores its analysis from
  // IndexedDB instead of re-running Stockfish.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const cached = await loadAnalysis(game.url, ANALYSIS_DEPTH)
      if (cancelled || !cached) return
      setAnalysis(prev =>
        prev.phase === 'idle'
          ? { phase: 'done', results: cached.results, multiPV: cached.multiPV, fromCache: true }
          : prev,
      )
    })()
    return () => { cancelled = true }
  }, [game.url])

  // ── Analysis ──────────────────────────────────────────────────────
  async function startAnalysis() {
    const engine = new Engine()
    engineRef.current = engine
    const signal = { cancelled: false }
    signalRef.current = signal
    setAnalysis({ phase: 'running', partial: [], total: plies.length })
    try {
      const results = await analyzeGame(
        plies, ANALYSIS_DEPTH, engine,
        (_d, _t, latest) => {
          if (signal.cancelled) return
          setAnalysis(prev =>
            prev.phase === 'running' ? { ...prev, partial: [...prev.partial, latest] } : prev,
          )
        },
        signal,
      )
      if (signal.cancelled) { setAnalysis({ phase: 'idle' }); return }

      const baseClass = classifyGame(results)
      const candidateCount = baseClass.moves.filter(
        m => m.quality === MoveQuality.Best || m.quality === MoveQuality.Excellent,
      ).length

      if (candidateCount > 0 && !signal.cancelled) {
        setAnalysis({ phase: 'refining', results, done: 0, total: candidateCount })
        const multiPV = await refineAnalysis(
          results, baseClass.moves, ANALYSIS_DEPTH, engine, signal,
          (done, total) => {
            if (signal.cancelled) return
            setAnalysis(prev => prev.phase === 'refining' ? { ...prev, done, total } : prev)
          },
        )
        if (signal.cancelled) { setAnalysis({ phase: 'idle' }); return }
        setAnalysis({ phase: 'done', results, multiPV })
        void saveAnalysis(game.url, ANALYSIS_DEPTH, { results, multiPV })
      } else if (!signal.cancelled) {
        const multiPV = new Map<number, MultiPVResult[]>()
        setAnalysis({ phase: 'done', results, multiPV })
        void saveAnalysis(game.url, ANALYSIS_DEPTH, { results, multiPV })
      }
    } catch (e) {
      if (!signal.cancelled) setAnalysis({ phase: 'error', message: String(e) })
      else setAnalysis({ phase: 'idle' })
    } finally {
      engine.terminate()
      engineRef.current = null
    }
  }

  function cancelAnalysis() {
    signalRef.current.cancelled = true
    engineRef.current?.terminate()
    engineRef.current = null
    setAnalysis({ phase: 'idle' })
  }

  // ── Render helpers ─────────────────────────────────────────────────
  const ply = plies[currentPly]
  const atStart = currentPly === 0
  const atEnd = currentPly === plies.length - 1
  const currentClassification = classifications?.[currentPly]
  const resultText = game.result === 'draw' ? '½–½' : game.result === 'white' ? '1–0' : '0–1'

  const PROMO: Record<string, Record<'w' | 'b', string>> = {
    q: { w: '♕', b: '♛' }, r: { w: '♖', b: '♜' },
    b: { w: '♗', b: '♝' }, n: { w: '♘', b: '♞' },
  }

  return (
    <div className="game-viewer">
      <button className="back-btn" onClick={onBack}>← Back to games</button>

      <div className="gv-header">
        <div className="gv-players">
          <span className="gv-player">
            {game.white.username}<span className="gv-rating"> ({game.white.rating})</span>
          </span>
          <span className="gv-result">{resultText}</span>
          <span className="gv-player">
            {game.black.username}<span className="gv-rating"> ({game.black.rating})</span>
          </span>
        </div>
        <p className="gv-meta">
          {game.timeClass}{game.eco ? ` · ${game.eco}` : ''}{` · Playing as ${isMyWhite ? 'white' : 'black'}`}
        </p>
        {opening && <p className="gv-opening-name">{opening.eco} · {opening.name}</p>}
      </div>

      <div className="gv-layout">
        {/* ── Board column ── */}
        <div className="gv-board-col">
          <div className="gv-board-area">
            <EvalBar eval={displayEval} orientation={orientation} />

            <div className="gv-board-inner">
              {/* Board */}
              <div className="board-wrapper" style={{ position: 'relative' }}>
                <Chessboard
                  options={{
                    position: displayFen,
                    boardOrientation: orientation,
                    allowDragging: isInExplore,
                    arrows,
                    canDragPiece: isInExplore
                      ? ({ piece }) => piece.pieceType[0] === exploreTurn
                      : undefined,
                    onPieceDrop: isInExplore ? handlePieceDrop : undefined,
                  }}
                />
                {pendingPromotion && (
                  <div className="promotion-overlay">
                    <p>Promote to:</p>
                    <div className="promotion-pieces">
                      {(['q', 'r', 'b', 'n'] as const).map(p => (
                        <button key={p} className="promo-btn" onClick={() => handlePromotion(p)}>
                          {PROMO[p][exploreTurn]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* ── Mode-specific controls ── */}
              {isInPvPreview ? (
                /* PV preview */
                <>
                  <div className="mode-bar mode-bar--pv">
                    <span className="mode-bar-label">
                      Best line · {pvPreview.offset}/{pvPreview.sans.length}
                    </span>
                    <button className="mode-exit-btn" onClick={exitPvPreview} title="Exit (Esc)">
                      ✕ Exit
                    </button>
                  </div>
                  <div className="gv-controls">
                    <button className="ctrl-btn" onClick={() => pvStep(-1)} disabled={pvPreview.offset === 0}>◀</button>
                    <span className="gv-move-label">
                      {pvPreview.offset === 0
                        ? <span style={{ color: 'var(--text)' }}>before best line</span>
                        : pvPreview.sans[pvPreview.offset - 1]}
                    </span>
                    <button className="ctrl-btn" onClick={() => pvStep(1)} disabled={pvPreview.offset >= pvPreview.sans.length}>▶</button>
                  </div>
                  {pvPreview.offset < pvPreview.sans.length && (
                    <div className="pv-remaining">
                      <span className="pv-remaining-label">Next: </span>
                      {pvPreview.sans.slice(pvPreview.offset, pvPreview.offset + 5).join(' · ')}
                      {pvPreview.sans.length - pvPreview.offset > 5 ? ' …' : ''}
                    </div>
                  )}
                </>
              ) : isInExplore ? (
                /* Explore mode */
                <>
                  <div className="mode-bar mode-bar--explore">
                    <span className="mode-bar-label">
                      ⊕ Exploring from {explore.basePly === 0 ? 'start' : plyLabel(plies[explore.basePly])}
                    </span>
                    <button className="mode-exit-btn mode-exit-btn--explore" onClick={exitExplore} title="Return to game (Esc)">
                      ✕ Return
                    </button>
                  </div>
                  <div className="gv-controls">
                    <button className="ctrl-btn" onClick={() => exploreGoTo(0)} disabled={explore.offset === 0} title="Start">⏮</button>
                    <button className="ctrl-btn" onClick={() => exploreGoTo(explore.offset - 1)} disabled={explore.offset === 0} title="Back (←)">◀</button>
                    <span className="gv-move-label">
                      {explore.offset === 0
                        ? <span style={{ color: 'var(--text)' }}>start of variation</span>
                        : explore.sans[explore.offset - 1]}
                    </span>
                    <button className="ctrl-btn" onClick={() => exploreGoTo(explore.offset + 1)} disabled={explore.offset >= explore.moves.length} title="Forward (→)">▶</button>
                    <button className="ctrl-btn" onClick={exploreTakeback} disabled={explore.moves.length === 0} title="Takeback">↩</button>
                  </div>
                  {/* Live eval */}
                  <div className="explore-eval-row">
                    {exploreEvalLoading
                      ? <><span className="eval-spinner" /><span className="explore-eval-text">Evaluating…</span></>
                      : exploreEval
                        ? <span className="explore-eval-text">Engine: <strong>{fmtEval(exploreEval)}</strong></span>
                        : null}
                  </div>
                  {/* Explore move chips */}
                  <div className="explore-variation-panel">
                    {explore.sans.length === 0
                      ? <span className="explore-empty">Drag pieces to explore…</span>
                      : explore.sans.map((san, i) => {
                        const moveEval = explore.evals[i + 1]
                        const quality = exploreClassifications[i]
                        return (
                          <button
                            key={i}
                            className={`explore-move-chip${explore.offset === i + 1 ? ' active' : ''}`}
                            onClick={() => exploreGoTo(i + 1)}
                          >
                            <span className="explore-chip-san">{san}</span>
                            {quality && <MoveQualityBadge quality={quality} compact />}
                            {moveEval && <span className="explore-chip-eval">{fmtEval(moveEval)}</span>}
                          </button>
                        )
                      })
                    }
                  </div>
                </>
              ) : (
                /* Normal mainline */
                <div className="gv-controls">
                  <button className="ctrl-btn" onClick={() => goTo(0)} disabled={atStart} title="First">⏮</button>
                  <button className="ctrl-btn" onClick={() => goTo(currentPly - 1)} disabled={atStart} title="Previous (←)">◀</button>
                  <span className="gv-move-label">
                    {plyLabel(ply)}
                    {currentClassification?.quality && (
                      <MoveQualityBadge quality={currentClassification.quality} debug={currentClassification.debug} />
                    )}
                  </span>
                  <button className="ctrl-btn" onClick={() => goTo(currentPly + 1)} disabled={atEnd} title="Next (→)">▶</button>
                  <button className="ctrl-btn" onClick={() => goTo(plies.length - 1)} disabled={atEnd} title="Last">⏭</button>
                </div>
              )}

              {/* ── Evaluation graph ── */}
              {evals && evals.length > 1 && (
                <EvalGraph
                  analyzedPlies={evals}
                  currentPly={currentPly}
                  onSelectPly={goTo}
                  classifications={classifications}
                  disabled={isInPvPreview || isInExplore}
                />
              )}

              {/* ── Secondary toolbar ── */}
              <div className="gv-secondary-toolbar">
                <button
                  className={`gv-tool-btn${showArrow ? ' active' : ''}`}
                  onClick={() => setShowArrow(v => !v)}
                  title="Show engine's best-move arrow on the board"
                >
                  ↗ Best arrow
                </button>
                {!isInPvPreview && !isInExplore && (
                  <button className="gv-tool-btn" onClick={enterExplore} title="Enter interactive exploration mode">
                    ⊕ Explore
                  </button>
                )}
                {isInExplore && explore.moves.length > 0 && (
                  <button className="gv-tool-btn" onClick={exploreClear}>
                    ↺ Reset variation
                  </button>
                )}
              </div>

              {/* ── Best line panel ── */}
              {!isInPvPreview && !isInExplore && bestLineData && (
                <div className="best-line-panel">
                  <div className="best-line-header">
                    <span className="best-line-title">Best:</span>
                    <span className="best-line-move">{bestLineData.firstSan}</span>
                    {bestLineData.continuation && (
                      <span className="best-line-cont">{bestLineData.continuation}</span>
                    )}
                  </div>
                  <button className="see-line-btn" onClick={enterPvPreview}>
                    See full line →
                  </button>
                </div>
              )}

              {/* ── Analysis controls ── */}
              {!isInPvPreview && !isInExplore && (
                <>
                  {analysis.phase === 'idle' && (
                    <button className="analyze-btn" onClick={() => { void startAnalysis() }}>
                      Analyze game (depth {ANALYSIS_DEPTH})
                    </button>
                  )}
                  {analysis.phase === 'running' && (
                    <div className="analysis-running">
                      <div className="analysis-progress-row">
                        <div className="progress-bar">
                          <div className="progress-fill" style={{ width: `${(analysis.partial.length / analysis.total) * 100}%` }} />
                        </div>
                        <span className="progress-label">{analysis.partial.length} / {analysis.total}</span>
                        <button className="cancel-btn" onClick={cancelAnalysis}>Cancel</button>
                      </div>
                    </div>
                  )}
                  {analysis.phase === 'refining' && (
                    <div className="analysis-running">
                      <div className="analysis-progress-row">
                        <div className="progress-bar">
                          <div className="progress-fill progress-fill--refine" style={{ width: analysis.total > 0 ? `${(analysis.done / analysis.total) * 100}%` : '0%' }} />
                        </div>
                        <span className="progress-label">{analysis.done} / {analysis.total}</span>
                        <button className="cancel-btn" onClick={cancelAnalysis}>Cancel</button>
                      </div>
                      <p className="refine-label">Checking for brilliant moves…</p>
                    </div>
                  )}
                  {analysis.phase === 'done' && (
                    <div className="analysis-done-bar">
                      <span className="done-status">
                        {analysis.fromCache && <span className="cache-dot" title="Restored from saved analysis">✓ saved</span>}
                        {analysis.fromCache ? 'Loaded saved analysis' : 'Analysis complete'} ({analysis.results.length} positions)
                      </span>
                      <button className="reanalyze-btn" onClick={() => setAnalysis({ phase: 'idle' })}>
                        Re-analyze
                      </button>
                    </div>
                  )}
                  {analysis.phase === 'error' && (
                    <p className="analysis-error">{analysis.message}</p>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Move list ── */}
        <MoveList
          plies={plies}
          currentPly={currentPly}
          onSelect={goTo}
          evals={evals}
          classifications={classifications}
          disabled={isInPvPreview || isInExplore}
        />
      </div>
    </div>
  )
}
