/**
 * TS mirror of the move-classification colors defined in tokens.css.
 *
 * CSS owns the tokens; this object exists only for the few places that need a
 * concrete color string in JavaScript (e.g. canvas/SVG fills, board arrows).
 * Keep the values in sync with --cls-* in tokens.css.
 */
import { MoveQuality } from '../analysis/moveQuality'

export const CLASSIFICATION_COLORS: Record<MoveQuality, string> = {
  [MoveQuality.Brilliant]: '#25c4c4',
  [MoveQuality.Great]: '#5b9bd5',
  [MoveQuality.Best]: '#7cb342',
  [MoveQuality.Excellent]: '#9ccc52',
  [MoveQuality.Good]: '#69b58f',
  [MoveQuality.Book]: '#b58150',
  [MoveQuality.Inaccuracy]: '#e6c84a',
  [MoveQuality.Mistake]: '#e7913c',
  [MoveQuality.Miss]: '#e0667e',
  [MoveQuality.Blunder]: '#d9483b',
}

/** Accent green used for board arrows / highlights (matches --accent). */
export const ACCENT = '#7cb342'
