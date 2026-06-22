import type { Game, ApiResult } from '../types'

const BASE = 'https://api.chess.com/pub'

// Raw API shapes — not exported; callers work with normalized types only
interface RawPlayer {
  username: string
  rating: number
  result: string
}

interface RawGame {
  url: string
  pgn: string
  time_control: string
  time_class: string
  rated: boolean
  white: RawPlayer
  black: RawPlayer
  eco?: string
  end_time: number
  accuracies?: { white: number; black: number }
}

function deriveResult(white: RawPlayer, black: RawPlayer): 'white' | 'black' | 'draw' {
  if (white.result === 'win') return 'white'
  if (black.result === 'win') return 'black'
  return 'draw'
}

function normalizeGame(raw: RawGame): Game {
  return {
    url: raw.url,
    pgn: raw.pgn,
    timeControl: raw.time_control,
    timeClass: raw.time_class,
    rated: raw.rated,
    white: { username: raw.white.username, rating: raw.white.rating, result: raw.white.result },
    black: { username: raw.black.username, rating: raw.black.rating, result: raw.black.result },
    result: deriveResult(raw.white, raw.black),
    eco: raw.eco ? raw.eco.split('/').pop()?.replace(/-/g, ' ') : undefined,
    endTime: raw.end_time,
    accuracies: raw.accuracies,
  }
}

async function apiFetch<T>(url: string): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url)
    if (res.status === 404) {
      return { ok: false, error: { kind: 'not_found', message: `Not found: ${url}` } }
    }
    if (res.status === 429) {
      return {
        ok: false,
        error: { kind: 'rate_limited', message: 'Rate limited by Chess.com. Please wait and try again.' },
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        error: { kind: 'network_error', message: `Unexpected HTTP ${res.status} from Chess.com` },
      }
    }
    const data = (await res.json()) as T
    return { ok: true, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network request failed'
    return { ok: false, error: { kind: 'network_error', message } }
  }
}

/** Returns the list of monthly archive URLs for a player, oldest first. */
export async function getArchives(username: string): Promise<ApiResult<string[]>> {
  const result = await apiFetch<{ archives: string[] }>(
    `${BASE}/player/${username}/games/archives`,
  )
  if (!result.ok) return result
  return { ok: true, data: result.data.archives }
}

/**
 * Fetches one monthly archive. Past-month archives are immutable — callers
 * should cache the returned games keyed by archiveUrl to avoid re-fetching.
 */
export async function getMonthGames(archiveUrl: string): Promise<ApiResult<Game[]>> {
  const result = await apiFetch<{ games: RawGame[] }>(archiveUrl)
  if (!result.ok) return result
  return { ok: true, data: result.data.games.map(normalizeGame) }
}

/**
 * Fetches the most recent `limit` games for a player, newest first.
 * Walks archives from newest to oldest, stopping as soon as enough games
 * have been collected. Requests are made serially per Chess.com guidelines.
 */
export async function getRecentGames(
  username: string,
  limit: number,
): Promise<ApiResult<Game[]>> {
  const archivesResult = await getArchives(username)
  if (!archivesResult.ok) return archivesResult

  // Archives are returned oldest-first; reverse to start from most recent
  const archives = [...archivesResult.data].reverse()
  const collected: Game[] = []

  for (const archiveUrl of archives) {
    if (collected.length >= limit) break
    const monthResult = await getMonthGames(archiveUrl)
    if (!monthResult.ok) return monthResult
    // Games within an archive are oldest-first; reverse so newest come first
    const monthGames = [...monthResult.data].reverse()
    collected.push(...monthGames)
  }

  return { ok: true, data: collected.slice(0, limit) }
}
