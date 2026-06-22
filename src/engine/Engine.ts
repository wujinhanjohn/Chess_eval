/**
 * Stockfish 18 WASM engine wrapper.
 *
 * We use the SINGLE-THREADED lite build (stockfish-18-lite-single.*):
 *   - No SharedArrayBuffer required → no COOP/COEP headers needed.
 *   - ~7 MB WASM, loads in the browser without any server-side config.
 *
 * To upgrade to the MULTI-THREADED build (stockfish-18-lite.*) for better
 * performance, you would need Vite to emit these HTTP headers on every
 * response (required for SharedArrayBuffer access):
 *     Cross-Origin-Opener-Policy: same-origin
 *     Cross-Origin-Embedder-Policy: require-corp
 * Add them in vite.config.ts → server.headers (dev) and via a hosting
 * adapter (Netlify _headers / Vercel headers / nginx) for production.
 */

import type { EvalResult, MultiPVResult } from '../types'

/**
 * Load the stockfish JS as a plain Worker entry point (no hash).
 * When the hash contains ",worker", the file's init guard short-circuits and
 * the engine never starts. Without a hash, the Worker branch auto-derives
 * the WASM path by replacing ".js" with ".wasm" in the worker URL.
 */
const SF_WORKER_URL = '/stockfish-18-lite-single.js'

/**
 * UCI scores are always from the side-to-move's perspective.
 * Multiply by this factor to convert to White's perspective:
 *   White to move → +1 (no change)
 *   Black to move → -1 (negate)
 */
function whitePerspMult(fen: string): 1 | -1 {
  return fen.split(' ')[1] === 'b' ? -1 : 1
}

export class Engine {
  private readonly worker: Worker
  private handler: ((line: string) => void) | null = null

  /** Resolves once UCI handshake is complete and the engine is ready. */
  readonly ready: Promise<void>

  constructor() {
    this.worker = new Worker(SF_WORKER_URL)

    let rejectReady: (reason: unknown) => void = () => {}

    this.ready = new Promise<void>((resolve, reject) => {
      rejectReady = reject
      this.boot(resolve, reject)
    })

    this.worker.onmessage = ({ data }: MessageEvent<unknown>) => {
      for (const raw of String(data).split('\n')) {
        const line = raw.trim()
        if (line) this.handler?.(line)
      }
    }

    this.worker.onerror = (e) => {
      rejectReady(new Error(`Stockfish worker error: ${e.message}`))
    }
  }

  private send(cmd: string): void {
    this.worker.postMessage(cmd)
  }

  /**
   * Sets up a one-shot listener that resolves the returned promise as soon
   * as predicate returns true for a received line, then clears itself.
   * Always call this BEFORE sending the command that triggers the response.
   */
  private listenUntil(predicate: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      this.handler = (line) => {
        if (predicate(line)) {
          this.handler = null
          resolve()
        }
      }
    })
  }

  private async boot(resolve: () => void, reject: (e: unknown) => void): Promise<void> {
    try {
      // Wait for uciok before sending isready — the engine may still be loading
      // the WASM binary when 'uci' is sent; the JS wrapper queues it.
      const uciOk = this.listenUntil((l) => l === 'uciok')
      this.send('uci')
      await uciOk

      const readyOk = this.listenUntil((l) => l === 'readyok')
      this.send('isready')
      await readyOk

      resolve()
    } catch (e) {
      reject(e)
    }
  }

  /**
   * Evaluates a single position to the given depth.
   * Only one evaluation may be in flight at a time; use evaluatePositions
   * for sequential batches.
   */
  async evaluate(fen: string, depth: number): Promise<EvalResult> {
    await this.ready

    // UCI reports score from the side-to-move perspective.
    // Multiply by mult to normalize to White's perspective.
    const mult = whitePerspMult(fen)

    const result: EvalResult = { cp: null, mate: null, bestMove: '', pv: [], depth: 0 }

    return new Promise((resolve) => {
      this.handler = (line) => {
        if (line.startsWith('info ')) {
          // Parse depth
          const dMatch = line.match(/\bdepth (\d+)/)
          if (dMatch) result.depth = parseInt(dMatch[1])

          // Parse score — skip lowerbound/upperbound lines (not exact)
          if (!line.includes('lowerbound') && !line.includes('upperbound')) {
            const sMatch = line.match(/\bscore (cp|mate) (-?\d+)/)
            if (sMatch) {
              const val = parseInt(sMatch[2]) * mult
              if (sMatch[1] === 'cp') {
                result.cp = val
                result.mate = null
              } else {
                result.mate = val
                result.cp = null
              }
            }
          }

          // Parse principal variation
          const pvMatch = line.match(/ pv (.+)$/)
          if (pvMatch) result.pv = pvMatch[1].trim().split(' ')
        } else if (line.startsWith('bestmove')) {
          const bm = line.match(/bestmove (\S+)/)
          if (bm && bm[1] !== '(none)') result.bestMove = bm[1]
          this.handler = null
          resolve({ ...result })
        }
      }

      this.send(`position fen ${fen}`)
      this.send(`go depth ${depth}`)
    })
  }

  /**
   * Evaluates an array of FENs sequentially (Stockfish can only search one
   * position at a time). Calls onProgress after each position completes.
   * Sends 'ucinewgame' once at the start to clear hash tables.
   */
  async evaluatePositions(
    fens: string[],
    depth: number,
    onProgress?: (index: number, result: EvalResult) => void,
  ): Promise<EvalResult[]> {
    await this.ready
    this.send('ucinewgame')

    const results: EvalResult[] = []
    for (let i = 0; i < fens.length; i++) {
      const r = await this.evaluate(fens[i], depth)
      results.push(r)
      onProgress?.(i, r)
    }
    return results
  }

  /**
   * Evaluates a position with multi-PV, returning the top `pvCount` moves.
   * Resets MultiPV back to 1 after the search so the single-PV path is unaffected.
   * All scores are normalized to White's perspective like `evaluate`.
   */
  async evaluateMultiPV(fen: string, depth: number, pvCount: number): Promise<MultiPVResult[]> {
    await this.ready
    const mult = whitePerspMult(fen)

    // rank → latest parsed data (we overwrite on each depth iteration, keeping final)
    const pvData = new Map<number, { cp: number | null; mate: number | null; pv: string[] }>()

    return new Promise((resolve) => {
      this.handler = (line) => {
        if (line.startsWith('info ')) {
          const mpvMatch = line.match(/\bmultipv (\d+)/)
          if (!mpvMatch) return
          const rank = parseInt(mpvMatch[1])

          if (line.includes('lowerbound') || line.includes('upperbound')) return

          let cp: number | null = null
          let mate: number | null = null
          const sMatch = line.match(/\bscore (cp|mate) (-?\d+)/)
          if (sMatch) {
            const val = parseInt(sMatch[2]) * mult
            if (sMatch[1] === 'cp') { cp = val; mate = null }
            else { mate = val; cp = null }
          }

          const pvMatch = line.match(/ pv (.+)$/)
          const pv = pvMatch ? pvMatch[1].trim().split(' ') : []
          if (pv.length > 0) pvData.set(rank, { cp, mate, pv })
        } else if (line.startsWith('bestmove')) {
          this.handler = null
          // Reset to single-PV so subsequent evaluate() calls are unaffected
          this.send('setoption name MultiPV value 1')

          const results: MultiPVResult[] = []
          for (let r = 1; r <= pvCount; r++) {
            const d = pvData.get(r)
            if (d && d.pv.length > 0) {
              results.push({ rank: r, move: d.pv[0], cp: d.cp, mate: d.mate, pv: d.pv })
            }
          }
          resolve(results)
        }
      }

      this.send(`setoption name MultiPV value ${pvCount}`)
      this.send(`position fen ${fen}`)
      this.send(`go depth ${depth}`)
    })
  }

  clearHash(): void {
    this.send('ucinewgame')
  }

  terminate(): void {
    this.worker.terminate()
  }
}
