import { useState } from 'react'
import { Engine } from '../engine/Engine'
import type { EvalResult } from '../types'
import './EngineTest.css'

const DEPTH = 16

const TEST_CASES = [
  {
    label: 'Starting position',
    fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    expect: '≈ 0  (equal)',
  },
  {
    label: '1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 — Italian Game',
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    expect: 'slight + (White edge)',
  },
  {
    label: 'K+R vs K — White to move (White winning)',
    fen: '8/8/8/8/8/7K/6R1/7k w - - 0 1',
    expect: 'large + or Mx (White mates)',
  },
  {
    label: 'K+r vs K — Black to move (Black winning)',
    fen: '8/8/8/8/8/7k/6r1/7K b - - 0 1',
    expect: 'large − or M−x (Black mates) ← sign test',
  },
] as const

type Slot = { result?: EvalResult; error?: string }

function formatEval(r: EvalResult): string {
  let score: string
  if (r.mate !== null) {
    score = r.mate > 0 ? `M+${r.mate}` : `M${r.mate}`
  } else if (r.cp !== null) {
    const pawn = (r.cp / 100).toFixed(2)
    score = r.cp > 0 ? `+${pawn}` : pawn
  } else {
    score = 'n/a'
  }
  return `${score}  @ depth ${r.depth}  best: ${r.bestMove || '—'}`
}

export function EngineTest() {
  const [slots, setSlots] = useState<Slot[]>([])
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')

  async function runTest() {
    setRunning(true)
    setSlots(TEST_CASES.map(() => ({})))
    setStatus('Booting Stockfish (fetching ~7 MB WASM)…')

    const engine = new Engine()

    try {
      await engine.ready
      setStatus(`Running depth-${DEPTH} analysis…`)

      for (let i = 0; i < TEST_CASES.length; i++) {
        const result = await engine.evaluate(TEST_CASES[i].fen, DEPTH)
        setSlots((prev) => {
          const next = [...prev]
          next[i] = { result }
          return next
        })
      }
      setStatus('Done.')
    } catch (err) {
      setStatus(`Error: ${String(err)}`)
    } finally {
      engine.terminate()
      setRunning(false)
    }
  }

  return (
    <section className="engine-test">
      <h2>Engine test — Stockfish 18 lite (single-threaded WASM)</h2>
      <p className="et-note">
        Verifies eval sign convention: positive&nbsp;=&nbsp;White ahead,
        negative&nbsp;=&nbsp;Black ahead.
      </p>
      <button className="et-run-btn" onClick={runTest} disabled={running}>
        {running ? 'Running…' : `Run test (depth ${DEPTH})`}
      </button>
      {status && <p className="et-status">{status}</p>}

      {slots.length > 0 && (
        <table className="et-table">
          <thead>
            <tr>
              <th>Position</th>
              <th>Expected</th>
              <th>Engine result (White+)</th>
            </tr>
          </thead>
          <tbody>
            {TEST_CASES.map((tc, i) => {
              const s = slots[i]
              return (
                <tr key={tc.fen}>
                  <td>{tc.label}</td>
                  <td className="et-expect">{tc.expect}</td>
                  <td className="et-result">
                    {s?.error ? (
                      <span className="et-err">{s.error}</span>
                    ) : s?.result ? (
                      <span
                        className={
                          s.result.cp !== null && s.result.cp < 0
                            ? 'et-neg'
                            : s.result.mate !== null && s.result.mate < 0
                              ? 'et-neg'
                              : 'et-pos'
                        }
                      >
                        {formatEval(s.result)}
                      </span>
                    ) : running ? (
                      <span className="et-pending">…</span>
                    ) : null}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
