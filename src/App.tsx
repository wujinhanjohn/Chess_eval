import { useEffect, useState } from 'react'
import { CONFIG } from './config'
import { getRecentGames } from './api/chesscom'
import { getCachedUrls, clearAnalysisCache } from './analysis/analysisCache'
import { GameViewer } from './components/GameViewer'
import { StyleGuide } from './components/StyleGuide'
import type { Game, ApiError } from './types'
import './App.css'

const GAME_LIMIT = 30

// ---------------------------------------------------------------------------
// Navigation state
// ---------------------------------------------------------------------------

type AppView = { mode: 'list' } | { mode: 'game'; game: Game }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(endTime: number): string {
  return new Date(endTime * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function playerSide(game: Game, username: string): 'white' | 'black' {
  return game.white.username.toLowerCase() === username.toLowerCase()
    ? 'white'
    : 'black'
}

function playerOutcome(game: Game, username: string): 'win' | 'loss' | 'draw' {
  if (game.result === 'draw') return 'draw'
  return game.result === playerSide(game, username) ? 'win' : 'loss'
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ---------------------------------------------------------------------------
// GameRow
// ---------------------------------------------------------------------------

function GameRow({ game, onClick, analyzed }: { game: Game; onClick: () => void; analyzed: boolean }) {
  const side = playerSide(game, CONFIG.username)
  const opponent = side === 'white' ? game.black : game.white
  const outcome = playerOutcome(game, CONFIG.username)

  return (
    <div
      className={`game-row outcome-${outcome}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick()
      }}
    >
      <span className={`piece-badge piece-${side}`} title={`Playing as ${side}`}>
        {side === 'white' ? '♔' : '♚'}
      </span>

      <div className="game-details">
        <span className="opponent-name">
          vs <strong>{opponent.username}</strong>
          <span className="rating"> ({opponent.rating})</span>
        </span>
        <span className="game-meta">
          {capitalise(game.timeClass)} · {formatDate(game.endTime)}
          {game.eco ? ` · ${game.eco}` : ''}
        </span>
      </div>

      <span className={`outcome-badge outcome-${outcome}`}>
        {outcome === 'win' ? 'Win' : outcome === 'loss' ? 'Loss' : 'Draw'}
      </span>

      {analyzed && (
        <span className="analyzed-chip" title="Analysis saved — opens instantly">✓ Analyzed</span>
      )}

      <span className="view-link">{analyzed ? 'Review →' : 'Analyze →'}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Error display
// ---------------------------------------------------------------------------

function ErrorMessage({ error }: { error: ApiError }) {
  const detail: Record<ApiError['kind'], string> = {
    not_found: 'Player not found. Check the username in src/config.ts.',
    rate_limited:
      'Chess.com rate limited this request — wait a moment and reload.',
    network_error: error.message,
  }
  return (
    <div className="error-box" role="alert">
      <strong>Failed to load games:</strong> {detail[error.kind]}
    </div>
  )
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const [view, setView] = useState<AppView>({ mode: 'list' })
  const [cachedUrls, setCachedUrls] = useState<Set<string>>(new Set())

  // Design-system review page, opened at #style (no effect on real screens).
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function load() {
      const result = await getRecentGames(CONFIG.username, GAME_LIMIT)
      if (cancelled) return
      if (result.ok) {
        setGames(result.data)
      } else {
        setError(result.error)
      }
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Refresh the set of locally-analyzed games whenever we land on the list
  // (a freshly analyzed game gets its badge on return).
  useEffect(() => {
    if (view.mode !== 'list') return
    let cancelled = false
    void getCachedUrls().then((urls) => {
      if (!cancelled) setCachedUrls(urls)
    })
    return () => {
      cancelled = true
    }
  }, [view.mode])

  if (hash === '#style') return <StyleGuide />

  // Game viewer — key ensures fresh state for every game selected
  if (view.mode === 'game') {
    return (
      <GameViewer
        key={view.game.url}
        game={view.game}
        onBack={() => setView({ mode: 'list' })}
      />
    )
  }

  // Game list
  return (
    <main className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">♞</span>
          <h1>Chess Review</h1>
        </div>
        <p className="subtitle">
          Recent games for <strong>{CONFIG.username}</strong>
          {!loading && !error && games.length > 0 && (
            <span className="game-count"> · {games.length} games</span>
          )}
        </p>
        {cachedUrls.size > 0 && (
          <button
            className="clear-cache-btn"
            onClick={async () => {
              if (!window.confirm(`Clear ${cachedUrls.size} saved game analysis${cachedUrls.size === 1 ? '' : 'es'}? They'll need re-evaluating next time.`)) return
              await clearAnalysisCache()
              setCachedUrls(new Set())
            }}
          >
            Clear {cachedUrls.size} saved analysis{cachedUrls.size === 1 ? '' : 'es'}
          </button>
        )}
      </header>

      {loading && <p className="status-message">Loading games…</p>}

      {error && <ErrorMessage error={error} />}

      {!loading && !error && games.length === 0 && (
        <p className="status-message">No games found for {CONFIG.username}.</p>
      )}

      {games.length > 0 && (
        <section className="game-list" aria-label="Recent games">
          {games.map((game) => (
            <GameRow
              key={game.url}
              game={game}
              analyzed={cachedUrls.has(game.url)}
              onClick={() => setView({ mode: 'game', game })}
            />
          ))}
        </section>
      )}
    </main>
  )
}
