[Project] Browser-based chess game analysis tool, similar to Chess.com Game Review.

[Data flow] Chess.com's public API gives us full games as PGN (every move + clocks + ratings + opening code). It does NOT give per-move evals or move classifications — only an overall accuracy number, and only if a game was already reviewed. So we generate all evaluations ourselves with Stockfish. Pipeline: fetch PGN → replay into positions (FENs) → Stockfish evaluates each position → compute centipawn loss / win% delta per move → render eval bar + per-move grades.

[Stack] Vite + React + TypeScript, chess.js, react-chessboard, Stockfish WASM in a Web Worker.

[Chess.com API rules] Base URL https://api.chess.com/pub/. Read-only, no auth. Past-month archives are immutable — cache them, never refetch; only the current month changes. Make requests serially, not in parallel bursts. A descriptive User-Agent is expected by Chess.com but browsers forbid setting it on fetch — note this; a backend proxy would be needed to set it in production.

[Eval conventions] Centipawns: +100 = white up ~1 pawn. Convert eval to win% for the bar: Win% = 50 + 50*(2/(1+exp(-0.00368208*cp)) - 1). Grade each move by the win% drop (or centipawn loss) of the move played vs. the engine's best move.

[IP boundary] Do NOT copy Chess.com proprietary assets — board/piece art, sounds, or their exact move-classification glyph names/icons. Use our own grade labels and visuals.

[Conventions] Keep engine/analysis logic pure and UI-agnostic so it's unit-testable. Small focused modules.
