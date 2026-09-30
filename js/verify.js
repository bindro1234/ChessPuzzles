// verify.js – checks with the Stockfish chess engine that the puzzle really is a forced mate.
// Stockfish runs in the background (a "Worker") and is talked to with text commands (the UCI protocol).
//
// How the check works. When Stockfish says "mate in 3", that mate really exists, but a shorter one may
// exist too: its number is an upper limit, not always the exact distance. So instead of asking once
// "how far is mate?", every level is checked like this:
//   - play the solution move, then try EVERY reply the defender has (chess.js lists them);
//   - the reply from the puzzle leads to the next level, which gets its own check;
//   - for every other reply Stockfish must show a mate that is at least as fast.
// If that holds at every level, the mate is forced no matter what the defender does.

const ENGINE_MAX_MS = 3000;  // give up on one search after this long
const ENGINE_MAX_DEPTH = 22; // … or when Stockfish has looked this deep (in half-moves)

let engine = null;
let engineListener = null; // function that receives each line of text Stockfish prints

// Returns true if the engine could be started. Browsers refuse to start it when the page
// is opened as a local file (file://), so it only works on GitHub Pages or via start-local.bat.
function startEngine() {
  if (engine) return true;
  try {
    engine = new Worker('vendor/stockfish/stockfish.js');
  } catch (error) {
    return false;
  }
  engine.onmessage = event => { if (engineListener) engineListener(String(event.data)); };
  engine.postMessage('uci');
  return true;
}

// Asks Stockfish for a mate in at most "mateIn" moves for the side to move.
// Returns { move: 'e2e4', mate: 3 } – or mate: null if it found none in the time allowed.
// onlyMoves (optional): a list of first moves Stockfish is allowed to consider.
function findMate(fen, mateIn, onlyMoves) {
  return new Promise(resolve => {
    let best = { move: '', mate: null };
    engineListener = text => {
      if (text.startsWith('info') && text.includes(' pv ')) {
        const mate = text.match(/ score mate (-?\d+)/);
        best = { move: text.split(' pv ')[1].split(' ')[0], mate: mate ? Number(mate[1]) : null };
      }
      if (text.startsWith('bestmove')) {
        engineListener = null;
        resolve(best);
      }
    };
    engine.postMessage('position fen ' + fen);
    engine.postMessage('go mate ' + mateIn + ' depth ' + ENGINE_MAX_DEPTH + ' movetime ' + ENGINE_MAX_MS +
      (onlyMoves ? ' searchmoves ' + onlyMoves.join(' ') : ''));
  });
}

// Checks every level. Returns { problems: [text], notes: [text] }.
//   problems = do not post: the mate is not forced, a faster mate exists,
//              or (before the final level) another move mates just as fast
//   notes    = worth knowing, but the puzzle is sound
// isCancelled() is asked between searches, so a check can be dropped when a new puzzle is loaded.
async function verifyPuzzle(result, onProgress, isCancelled) {
  const problems = [];
  const notes = [];

  for (const level of result.levels) {
    onProgress('checking level ' + level.number + ' of ' + result.levels.length + '…');
    const name = 'Level ' + level.number + ': ';
    const n = level.mateIn;
    const chess = new Chess(level.position.fen);
    const solverMoves = chess.moves({ verbose: true });

    // 1. Other moves for the solver in this position.
    const others = solverMoves.filter(move => toUci(move) !== level.solverUci);
    if (n === 1) {
      // Other mates in one are harmless; chess.js can see them without the engine.
      const mates = others.filter(move => move.san.includes('#')).map(move => move.san);
      if (mates.length) notes.push(name + mates.join(', ') + ' also mate' + (mates.length === 1 ? 's' : '') + ' in one.');
    } else if (others.length) {
      const other = await findMate(level.position.fen, n, others.map(toUci));
      if (isCancelled()) return null;
      if (other.mate !== null && other.mate > 0) {
        const san = solverMoves.find(move => toUci(move) === other.move).san;
        if (other.mate < n) problems.push(name + san + ' mates faster (in ' + other.mate + ') than the solution ' + level.solverMove + '.');
        else if (other.mate === n) problems.push(name + san + ' also mates in ' + n + ', so the solution is not unique.');
        else notes.push(name + san + ' also mates, but slower (in ' + other.mate + ' or less).');
      }
    }

    // 2. After the solution move, every reply of the defender must lose in time.
    chess.move(level.solverMove);
    if (n === 1) {
      if (!chess.in_checkmate()) problems.push(name + level.solverMove + ' is not checkmate.');
      continue;
    }
    const replies = chess.moves({ verbose: true });
    if (replies.length === 0) {
      problems.push(name + 'after ' + level.solverMove + ' the game is already over (mate or stalemate).');
      continue;
    }
    for (const reply of replies) {
      if (toUci(reply) === level.replyUci) continue; // the puzzle's own line: checked as the next level
      chess.move(reply);
      const answer = await findMate(chess.fen(), n - 1, null);
      chess.undo();
      if (isCancelled()) return null;
      if (answer.mate === null || answer.mate <= 0) {
        problems.push(name + 'after ' + level.solverMove + ' ' + reply.san + ' the engine finds no forced mate.');
      } else if (answer.mate > n - 1) {
        problems.push(name + 'after ' + level.solverMove + ' ' + reply.san + ' the engine needs ' + answer.mate +
          ' more moves, so ' + reply.san + ' may be a better defence than ' + level.reply + '.');
      }
    }
  }
  return { problems: problems, notes: notes };
}
