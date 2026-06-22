/**
 * Position-keyed opening book built from the lichess-org/chess-openings
 * dataset (CC0).  Import the JSON at build time — no runtime network requests.
 *
 * Regenerate: npx tsx scripts/build-openings.ts
 */

// TypeScript needs a type cast for the raw JSON import.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import rawBook from '../data/openings.json'

export interface OpeningEntry {
  eco: string
  name: string
}

/**
 * Map from position key → opening info.
 * Built once at module load; all lookups are O(1).
 */
const bookMap = new Map<string, OpeningEntry>(
  Object.entries(rawBook as Record<string, OpeningEntry>),
)

/**
 * Canonical position key: the first four FEN fields (piece placement,
 * side to move, castling rights, en-passant square).  Dropping the
 * half-move clock and full-move number normalises transpositions so
 * "1.e4 c5" and "1.c4 c5 2.e4" reach the same key in the Sicilian.
 */
export function toPositionKey(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ')
}

/** True if this position exists in the compiled opening book. */
export function isBookPosition(positionKey: string): boolean {
  return bookMap.has(positionKey)
}

/**
 * Returns the most-specific opening name/ECO for this position key,
 * or null if the position is not in the book.
 */
export function getOpeningAt(positionKey: string): OpeningEntry | null {
  return bookMap.get(positionKey) ?? null
}
