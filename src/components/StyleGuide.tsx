/**
 * Design-system style guide. Renders every token and primitive so the look can
 * be reviewed in isolation, before screens are converted. Open at #style.
 */
import { MoveQualityBadge } from './MoveQualityBadge'
import { EvalBar } from './EvalBar'
import { MoveQuality } from '../analysis/moveQuality'
import type { EvalResult } from '../types'
import './StyleGuide.css'

const BG_TOKENS = ['--bg-page', '--bg', '--bg-raised', '--bg-hover', '--bg-inset', '--border', '--border-strong']
const ACCENT_TOKENS = ['--accent', '--accent-hover', '--accent-active', '--btn-primary-bg']
const TEXT_TOKENS = ['--text-h', '--text', '--text-dim', '--text-faint']
const STATUS_TOKENS = ['--win', '--loss', '--draw']
const CLS_TOKENS = [
  '--cls-brilliant', '--cls-great', '--cls-best', '--cls-excellent', '--cls-good',
  '--cls-book', '--cls-inaccuracy', '--cls-mistake', '--cls-miss', '--cls-blunder',
]
const SPACING = ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7', '--space-8']
const RADII = ['--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-pill']
const TYPE = [
  { token: '--fs-2xl', label: 'Display 2xl' },
  { token: '--fs-xl', label: 'Heading xl' },
  { token: '--fs-lg', label: 'Heading lg' },
  { token: '--fs-md', label: 'Subhead md' },
  { token: '--fs-base', label: 'Body base' },
  { token: '--fs-sm', label: 'Small sm' },
  { token: '--fs-xs', label: 'Caption xs' },
]
const ALL_QUALITIES = Object.values(MoveQuality)

function Swatch({ token }: { token: string }) {
  return (
    <div className="sg-swatch">
      <span className="sg-swatch-chip" style={{ background: `var(${token})` }} />
      <code className="sg-swatch-name">{token}</code>
    </div>
  )
}

function evalOf(cp: number | null, mate: number | null = null): EvalResult {
  return { cp, mate, bestMove: '', pv: [], depth: 16 }
}

export function StyleGuide() {
  return (
    <main className="sg">
      <header className="sg-top">
        <h1>Design System</h1>
        <p className="sg-sub">Dark theme · tokens &amp; primitives · review before screen conversion</p>
      </header>

      {/* ── Color tokens ── */}
      <section className="sg-section">
        <h2>Color</h2>
        <h3 className="sg-h3">Background &amp; border tiers</h3>
        <div className="sg-swatches">{BG_TOKENS.map((t) => <Swatch key={t} token={t} />)}</div>
        <h3 className="sg-h3">Green primary</h3>
        <div className="sg-swatches">{ACCENT_TOKENS.map((t) => <Swatch key={t} token={t} />)}</div>
        <h3 className="sg-h3">Text tiers</h3>
        <div className="sg-swatches">{TEXT_TOKENS.map((t) => <Swatch key={t} token={t} />)}</div>
        <h3 className="sg-h3">Status</h3>
        <div className="sg-swatches">{STATUS_TOKENS.map((t) => <Swatch key={t} token={t} />)}</div>
        <h3 className="sg-h3">Classification</h3>
        <div className="sg-swatches">{CLS_TOKENS.map((t) => <Swatch key={t} token={t} />)}</div>
      </section>

      {/* ── Typography ── */}
      <section className="sg-section">
        <h2>Typography — Inter / JetBrains Mono</h2>
        {TYPE.map(({ token, label }) => (
          <p key={token} className="sg-type-row" style={{ fontSize: `var(${token})` }}>
            {label} <code className="sg-inline">{token}</code>
          </p>
        ))}
        <p className="sg-type-row sg-mono">Mono numerals 0123456789 +1.4 −2.7 M3</p>
      </section>

      {/* ── Spacing & radii ── */}
      <section className="sg-section">
        <h2>Spacing &amp; radii</h2>
        <h3 className="sg-h3">Spacing scale</h3>
        <div className="sg-spacing">
          {SPACING.map((t) => (
            <div key={t} className="sg-spacing-row">
              <span className="sg-spacing-bar" style={{ width: `var(${t})` }} />
              <code className="sg-inline">{t}</code>
            </div>
          ))}
        </div>
        <h3 className="sg-h3">Radii</h3>
        <div className="sg-radii">
          {RADII.map((t) => (
            <div key={t} className="sg-radius-box" style={{ borderRadius: `var(${t})` }}>
              <code className="sg-inline">{t}</code>
            </div>
          ))}
        </div>
      </section>

      {/* ── Buttons ── */}
      <section className="sg-section">
        <h2>Buttons</h2>
        <div className="sg-row">
          <button className="btn btn-primary">Primary</button>
          <button className="btn btn-secondary">Secondary</button>
          <button className="btn btn-ghost">Ghost</button>
          <button className="btn btn-danger">Danger</button>
          <button className="btn btn-primary" disabled>Disabled</button>
        </div>
        <div className="sg-row">
          <button className="btn btn-primary btn-sm">Small</button>
          <button className="btn btn-primary">Default</button>
          <button className="btn btn-primary btn-lg">Large</button>
          <button className="btn btn-secondary btn-pill">Pill</button>
          <button className="btn btn-secondary btn-icon" aria-label="icon">★</button>
        </div>
        <div className="sg-row">
          <button className="btn btn-primary btn-lg btn-block">Block CTA — Start Review</button>
        </div>
      </section>

      {/* ── Panels / cards ── */}
      <section className="sg-section">
        <h2>Panels &amp; cards</h2>
        <div className="sg-row sg-row-wrap">
          <div className="panel panel-pad">.panel</div>
          <div className="panel-raised panel-pad">.panel-raised</div>
          <div className="card card-hover">.card (hover me)</div>
        </div>
        <div className="panel" style={{ maxWidth: 320 }}>
          <div className="panel-header">★ Panel header</div>
          <div className="panel-pad">Header + body composition.</div>
        </div>
      </section>

      {/* ── Table ── */}
      <section className="sg-section">
        <h2>Table</h2>
        <table className="ds-table" style={{ maxWidth: 420 }}>
          <thead>
            <tr><th>Phase</th><th className="num">Acc</th><th className="num">Moves</th></tr>
          </thead>
          <tbody>
            <tr><td>Opening</td><td className="num">—</td><td className="num">6</td></tr>
            <tr><td>Middlegame</td><td className="num">88.4%</td><td className="num">21</td></tr>
            <tr><td>Endgame</td><td className="num">75.7%</td><td className="num">9</td></tr>
          </tbody>
        </table>
      </section>

      {/* ── Classification badges ── */}
      <section className="sg-section">
        <h2>Classification badges</h2>
        <div className="sg-row sg-row-wrap">
          {ALL_QUALITIES.map((q) => <MoveQualityBadge key={q} quality={q} />)}
        </div>
        <div className="sg-row sg-row-wrap">
          {ALL_QUALITIES.map((q) => <MoveQualityBadge key={q} quality={q} compact />)}
        </div>
      </section>

      {/* ── Eval bar ── */}
      <section className="sg-section">
        <h2>Eval bar</h2>
        <div className="sg-evalbars">
          <EvalBar eval={evalOf(120)} orientation="white" />
          <EvalBar eval={evalOf(0)} orientation="white" />
          <EvalBar eval={evalOf(-260)} orientation="white" />
          <EvalBar eval={evalOf(null, 3)} orientation="white" />
        </div>
      </section>
    </main>
  )
}
