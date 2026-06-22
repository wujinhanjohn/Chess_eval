/**
 * Persistent cache for completed game analysis, backed by IndexedDB.
 *
 * Stockfish runs in the visitor's browser, so re-opening a game would
 * otherwise re-evaluate every position. We persist the raw engine output
 * (per-ply evals + the multi-PV refinement) keyed by the game URL, which
 * Chess.com guarantees is immutable for finished games. Only raw engine
 * results are stored — move classifications are recomputed on load, so the
 * grading logic can evolve without invalidating the cache.
 *
 * Every entry on disk is the visitor's own data; there is no network or
 * server component. All operations degrade gracefully to a no-op when
 * IndexedDB is unavailable (e.g. some private-browsing modes).
 */

import type { AnalyzedPly, MultiPVResult } from '../types'

const DB_NAME = 'chess-review'
const STORE = 'analysis'
const DB_VERSION = 1

/**
 * Bump when the stored shape or engine semantics change in a way that makes
 * old entries unusable. Entries with a different version are treated as a miss.
 */
const CACHE_VERSION = 1

export interface CachedAnalysis {
  results: AnalyzedPly[]
  multiPV: Map<number, MultiPVResult[]>
}

interface StoredRecord {
  url: string // keyPath
  version: number
  depth: number
  savedAt: number
  results: AnalyzedPly[]
  /** Map serialized as entries — explicit and portable. */
  multiPV: [number, MultiPVResult[]][]
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDB(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'url' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
  return dbPromise
}

/** Returns cached analysis for a game, or null on miss / version or depth mismatch. */
export async function loadAnalysis(
  url: string,
  depth: number,
): Promise<CachedAnalysis | null> {
  const db = await openDB()
  if (!db) return null
  return new Promise((resolve) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction(STORE, 'readonly')
    } catch {
      resolve(null)
      return
    }
    const req = tx.objectStore(STORE).get(url)
    req.onsuccess = () => {
      const rec = req.result as StoredRecord | undefined
      if (!rec || rec.version !== CACHE_VERSION || rec.depth !== depth) {
        resolve(null)
        return
      }
      resolve({ results: rec.results, multiPV: new Map(rec.multiPV) })
    }
    req.onerror = () => resolve(null)
  })
}

/** Persists completed analysis for a game, overwriting any existing entry. */
export async function saveAnalysis(
  url: string,
  depth: number,
  data: CachedAnalysis,
): Promise<void> {
  const db = await openDB()
  if (!db) return
  const rec: StoredRecord = {
    url,
    version: CACHE_VERSION,
    depth,
    savedAt: Date.now(),
    results: data.results,
    multiPV: [...data.multiPV.entries()],
  }
  await new Promise<void>((resolve) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction(STORE, 'readwrite')
    } catch {
      resolve()
      return
    }
    tx.objectStore(STORE).put(rec)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

/** Deletes every saved analysis entry. */
export async function clearAnalysisCache(): Promise<void> {
  const db = await openDB()
  if (!db) return
  await new Promise<void>((resolve) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction(STORE, 'readwrite')
    } catch {
      resolve()
      return
    }
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

/** URLs of every game with a saved analysis entry (any version). For list badges. */
export async function getCachedUrls(): Promise<Set<string>> {
  const db = await openDB()
  if (!db) return new Set()
  return new Promise((resolve) => {
    let tx: IDBTransaction
    try {
      tx = db.transaction(STORE, 'readonly')
    } catch {
      resolve(new Set())
      return
    }
    const req = tx.objectStore(STORE).getAllKeys()
    req.onsuccess = () => resolve(new Set(req.result as string[]))
    req.onerror = () => resolve(new Set())
  })
}
