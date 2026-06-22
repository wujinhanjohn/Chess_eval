/**
 * Fetches the lichess-org/chess-openings TSV files (CC0, public domain) and
 * emits src/data/openings.json — a position-keyed lookup the app imports at
 * build time so no network requests are needed at runtime.
 *
 * Run:  npx tsx scripts/build-openings.ts
 * Re-run any time you want to refresh the opening database.
 *
 * Output format:
 *   { [positionKey: string]: { eco: string; name: string } }
 *
 * positionKey = first four FEN fields (piece placement · side to move ·
 * castling rights · en-passant square).  Dropping the clock counters
 * normalises transpositions so "e4 c5" and "c5 e4" both map to the same
 * Sicilian key regardless of move order.
 *
 * When multiple opening lines pass through the same position the DEEPEST
 * (most specific) line's name wins, so e.g. position after 1.e4 c5 2.Nf3
 * shows "Sicilian Defence, Open" rather than the generic "Sicilian Defence".
 */

import { Chess } from 'chess.js'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const BASE_URL =
  'https://raw.githubusercontent.com/lichess-org/chess-openings/master/'
const LETTERS = ['a', 'b', 'c', 'd', 'e'] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPositionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

async function fetchTsv(letter: string): Promise<string> {
  const url = `${BASE_URL}${letter}.tsv`
  process.stdout.write(`  fetching ${url} … `)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  console.log(`${res.headers.get('content-length') ?? '?'} bytes`)
  return text
}

function parseTsv(
  content: string,
): Array<{ eco: string; name: string; pgn: string }> {
  return content
    .split('\n')
    .slice(1) // skip header row: eco\tname\tpgn
    .filter((l) => l.trim())
    .map((l) => {
      const [eco, name, pgn] = l.split('\t')
      return { eco: eco?.trim() ?? '', name: name?.trim() ?? '', pgn: pgn?.trim() ?? '' }
    })
    .filter((r) => r.eco && r.name && r.pgn)
}

// ---------------------------------------------------------------------------
// Replay each opening line, recording positions
// ---------------------------------------------------------------------------

interface Entry {
  eco: string
  name: string
  depth: number // number of moves into the line (for specificity tie-breaking)
}

function replayLine(
  eco: string,
  name: string,
  pgn: string,
  book: Map<string, Entry>,
): void {
  try {
    const loader = new Chess()
    loader.loadPgn(pgn) // chess.js 1.x returns void; throws on invalid PGN
    const moves = loader.history()

    const chess = new Chess()
    for (let i = 0; i < moves.length; i++) {
      chess.move(moves[i])
      const key = toPositionKey(chess.fen())
      const depth = i + 1
      const existing = book.get(key)
      // Prefer deeper (more specific) line; equal depth keeps first seen
      if (!existing || depth > existing.depth) {
        book.set(key, { eco, name, depth })
      }
    }
  } catch {
    // Malformed PGN — skip silently
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Building opening book from lichess-org/chess-openings …\n')

  const book = new Map<string, Entry>()
  let totalRows = 0

  for (const letter of LETTERS) {
    const tsv = await fetchTsv(letter)
    const rows = parseTsv(tsv)
    totalRows += rows.length
    console.log(`    → ${rows.length} openings`)
    for (const { eco, name, pgn } of rows) {
      replayLine(eco, name, pgn, book)
    }
  }

  // Strip internal depth field before serialising
  const output: Record<string, { eco: string; name: string }> = {}
  for (const [key, { eco, name }] of book) {
    output[key] = { eco, name }
  }

  const outDir  = join(__dirname, '..', 'src', 'data')
  const outPath = join(outDir, 'openings.json')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(outPath, JSON.stringify(output))

  const sizeKb = Math.round(Buffer.byteLength(JSON.stringify(output)) / 1024)
  console.log(
    `\nDone. ${totalRows} opening lines → ${book.size} unique positions` +
    ` → ${outPath} (${sizeKb} KB)`,
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
