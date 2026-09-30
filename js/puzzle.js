// puzzle.js – turns pasted text into a puzzle, and a puzzle into levels.
// Uses chess.js (vendor/chess.js) for the rules.

// A FEN: 8 ranks separated by "/", side to move, castling, en passant, and optionally the two counters.
const FEN_PATTERN = /((?:[pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+)\s+([wb])\s+(-|[KQkq]+)\s+(-|[a-h][36])(?:\s+(\d+)\s+(\d+))?/;
// A UCI move such as e2e4 or e7e8q.
const UCI_PATTERN = /\b[a-h][1-8][a-h][1-8][qrbn]?\b/g;

// Reads the pasted text. Returns:
//   { format: 'pgn' | 'fen', startFen, moves: [{from, to, promotion}], id, rating, source }
// Throws an Error with a readable message if the text can't be understood.
function readPuzzleText(text) {
  text = text.trim();
  if (!text) throw new Error('Paste a puzzle first.');

  // --- PGN (starts with [Header "…"] lines) ---
  if (text.startsWith('[')) {
    const chess = new Chess();
    if (!chess.load_pgn(text, { sloppy: true })) throw new Error('Could not read this PGN.');
    const headers = chess.header();
    const site = headers.Site || '';
    const idMatch = site.match(/lichess\.org\/training\/(\w+)/);
    return {
      format: 'pgn',
      startFen: headers.FEN || new Chess().fen(),
      moves: chess.history({ verbose: true }).map(m => ({ from: m.from, to: m.to, promotion: m.promotion })),
      id: idMatch ? idMatch[1] : '',
      rating: '',
      source: site,
    };
  }

  // --- FEN + UCI moves (Lichess puzzle database line, or just a FEN and a move list) ---
  const fenMatch = text.match(FEN_PATTERN);
  if (!fenMatch) throw new Error('No FEN found. Paste a PGN with a [FEN] header, or a FEN followed by UCI moves.');
  const fen = fenMatch[1] + ' ' + fenMatch[2] + ' ' + fenMatch[3] + ' ' + fenMatch[4] + ' ' +
    (fenMatch[5] || '0') + ' ' + (fenMatch[6] || '1');

  const before = text.slice(0, fenMatch.index);
  const after = text.slice(fenMatch.index + fenMatch[0].length);
  const sourceMatch = after.match(/https?:\/\/[^\s,]+/);
  const beforeUrl = sourceMatch ? after.slice(0, sourceMatch.index) : after;

  const moves = (beforeUrl.match(UCI_PATTERN) || []).map(uci => ({
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4], // undefined when the move is not a promotion
  }));
  if (moves.length === 0) throw new Error('Found a FEN but no moves after it (expected moves like "e2e4 e7e5").');

  const idMatch = before.match(/(\w+)\s*,\s*$/);        // "00008," in front of the FEN
  const ratingMatch = beforeUrl.match(/,\s*(\d{3,4})\s*,/); // first number column after the moves
  return {
    format: 'fen',
    startFen: fen,
    moves: moves,
    id: idMatch ? idMatch[1] : '',
    rating: ratingMatch ? ratingMatch[1] : '',
    source: sourceMatch ? sourceMatch[0] : '',
  };
}

// { from: 'e7', to: 'e8', promotion: 'q' } -> 'e7e8q'
function toUci(move) {
  return move.from + move.to + (move.promotion || '');
}

// What the board looks like right now, in the shape render.js wants.
function snapshot(chess, lastMove) {
  const pieces = {};
  const rows = chess.board(); // rows[0] is rank 8
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const piece = rows[r][f];
      if (piece) pieces['abcdefgh'[f] + (8 - r)] = piece.color + piece.type.toUpperCase(); // e.g. "wK"
    }
  }
  // If the side to move is in check, remember where its king stands.
  let check = null;
  if (chess.in_check()) {
    for (const square in pieces) {
      if (pieces[square] === chess.turn() + 'K') check = square;
    }
  }
  return { fen: chess.fen(), pieces: pieces, lastMove: lastMove, check: check };
}

// The Elo list is anchored at the end: the last level always gets the last number.
// If a puzzle has more levels than the list has numbers, it keeps counting up in the same step.
function eloForLevel(eloList, levelIndex, levelCount) {
  const i = eloList.length - levelCount + levelIndex;
  if (i >= 0) return eloList[i];
  const step = eloList.length > 1 ? eloList[0] - eloList[1] : 400;
  return eloList[0] + step * -i;
}

// Plays the puzzle through and splits it into levels. Returns:
//   { solver: 'w' | 'b', levels: [{ number, mateIn, elo, position, solverMove, reply }],
//     setupPosition, positions, finalPosition, finalMove, warnings: [text, …] }
function buildLevels(puzzle, hasSetupMove, eloList) {
  const chess = new Chess();
  if (!chess.load(puzzle.startFen)) throw new Error('The FEN is not a valid position.');

  const moves = puzzle.moves.slice();
  let lastMove = null;
  let setupPosition = null; // the position before the opponent's setup move, if there is one
  if (hasSetupMove) {
    setupPosition = snapshot(chess, null);
    const setup = chess.move(moves.shift());
    if (!setup) throw new Error('The first (setup) move is not legal in this position.');
    lastMove = [setup.from, setup.to];
  }
  if (moves.length === 0) throw new Error('No solution moves left after the setup move.');

  const solver = chess.turn();
  const positions = [snapshot(chess, lastMove)];
  const sans = []; // moves in normal notation, e.g. "Qxh7+"
  for (const move of moves) {
    const played = chess.move(move);
    if (!played) throw new Error('Move ' + move.from + move.to + ' is not legal (after ' + sans.length + ' solution moves).');
    sans.push(played.san);
    positions.push(snapshot(chess, [played.from, played.to]));
  }

  const warnings = [];
  if (sans.length % 2 === 0) warnings.push('The line has an even number of moves, so the defender moves last. Is "first move is the setup move" set correctly?');
  if (!chess.in_checkmate()) warnings.push('The line does not end in checkmate.');

  const levelCount = Math.ceil(sans.length / 2);
  const levels = [];
  for (let k = 0; k < levelCount; k++) {
    levels.push({
      number: k + 1,
      mateIn: levelCount - k,
      elo: eloForLevel(eloList, k, levelCount),
      position: positions[2 * k],
      solverMove: sans[2 * k],
      solverUci: toUci(moves[2 * k]), // e.g. "g5f7", for the engine check
      replyUci: moves[2 * k + 1] ? toUci(moves[2 * k + 1]) : '',
      reply: sans[2 * k + 1] || '',
    });
  }

  return {
    solver: solver,
    levels: levels,
    setupPosition: setupPosition,
    positions: positions, // every position in order: start, after move 1, after move 2, …
    finalPosition: positions[positions.length - 1],
    finalMove: sans[sans.length - 1],
    warnings: warnings,
  };
}
