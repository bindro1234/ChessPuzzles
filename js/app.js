// app.js – connects the page to puzzle.js (reading), render.js (drawing) and xml.js (Premiere sequence).

const FPS = 30;

const el = id => document.getElementById(id);
const puzzleText = el('puzzleText');
const hasSetupMove = el('hasSetupMove');
const puzzleId = el('puzzleId');
const summary = el('summary');
const levelsBox = el('levels');
const layoutPreview = el('layoutPreview');
const message = el('message');
const generateButton = el('generate');

// ---------- Settings (remembered between sessions) ----------
// Each setting has an <input> or <select> in index.html with the same id.

const DEFAULT_SETTINGS = {
  secondsPerLevel: 3,
  finalHold: 3,
  eloList: '2200, 1800, 1400, 1000, 600',
  animateMoves: true,
  framesBefore: 8, // at the start of a level, before the bar template starts moving: the opponent's reply slides
  framesAfter: 6,  // at the end of a level, after the bar has finished: the solution move slides
  lightColor: '#f0d9b5',
  darkColor: '#b58863',
  coordinates: true,
  orientation: 'auto',
  lastMoveColor: '#ffd500',
  lastMoveOpacity: 55,
  checkHighlight: true,
  arrow: false,
  arrowColor: '#15781b',
  boardSize: 960,
  boardY: 480,
};
const settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem('settings') || '{}'));

function showSettings() {
  for (const name in DEFAULT_SETTINGS) {
    const input = el(name);
    if (input.type === 'checkbox') input.checked = settings[name];
    else input.value = settings[name];
  }
}

function readSetting(name) {
  const input = el(name);
  if (input.type === 'checkbox') return input.checked;
  if (input.type === 'number') return Number(input.value);
  return input.value;
}

for (const name in DEFAULT_SETTINGS) {
  el(name).addEventListener('input', () => {
    settings[name] = readSetting(name);
    localStorage.setItem('settings', JSON.stringify(settings));
    refresh();
  });
}

el('resetSettings').addEventListener('click', () => {
  Object.assign(settings, DEFAULT_SETTINGS);
  localStorage.removeItem('settings');
  showSettings();
  refresh();
});

function eloNumbers() {
  const numbers = String(settings.eloList).split(/[^\d]+/).filter(Boolean).map(Number);
  return numbers.length ? numbers : [600];
}

// Black at the bottom?
function isFlipped(result) {
  if (settings.orientation === 'white') return false;
  if (settings.orientation === 'black') return true;
  return result.solver === 'b';
}

// ---------- Reading the puzzle and showing the preview ----------

let pieceImages = null; // loaded once at startup
let current = null;     // { puzzle, result } of the puzzle on screen, or null if there is none

function refresh() {
  current = null;
  generateButton.disabled = true;
  levelsBox.innerHTML = '';
  message.textContent = '';
  message.className = '';

  if (!puzzleText.value.trim()) {
    summary.textContent = 'Nothing pasted yet.';
    showLayoutPreview(renderBoard(false, settings), null);
    return;
  }

  let puzzle, result;
  try {
    puzzle = readPuzzleText(puzzleText.value);
    result = buildLevels(puzzle, hasSetupMove.checked, eloNumbers());
  } catch (error) {
    summary.innerHTML = '<span class="warning"></span>';
    summary.firstChild.textContent = error.message;
    showLayoutPreview(renderBoard(false, settings), null);
    return;
  }
  current = { puzzle: puzzle, result: result };
  generateButton.disabled = false;

  // Summary line + warnings
  const side = result.solver === 'w' ? 'White' : 'Black';
  summary.textContent = side + ' to move, mate in ' + result.levels.length + ' · ' +
    result.levels.length + (result.levels.length === 1 ? ' level' : ' levels') +
    (puzzle.rating ? ' · rating ' + puzzle.rating : '');
  for (const warning of result.warnings) {
    const div = document.createElement('div');
    div.className = 'warning';
    div.textContent = 'Warning: ' + warning;
    summary.appendChild(div);
  }

  // One preview per level, plus the final mate position
  const flipped = isFlipped(result);
  const board = renderBoard(flipped, settings);
  showLayoutPreview(board, renderPosition(result.levels[0].position, flipped, settings, pieceImages));
  for (const level of result.levels) {
    addPreview(board, level.position, flipped, markerName(level),
      level.reply ? 'then ' + level.solverMove + ' ' + level.reply : 'then ' + level.solverMove);
  }
  addPreview(board, result.finalPosition, flipped, 'Mate', 'after ' + result.finalMove);
}

function addPreview(board, position, flipped, title, moves) {
  const box = document.createElement('div');
  box.className = 'level';
  box.innerHTML = '<div class="title"></div><div class="moves"></div>';
  box.children[0].textContent = title;
  box.children[1].textContent = moves;
  const positionCanvas = renderPosition(position, flipped, settings, pieceImages);
  box.insertBefore(renderPreview(board, positionCanvas, 480, settings), box.children[1]);
  levelsBox.appendChild(box);
}

function showLayoutPreview(boardCanvas, positionCanvas) {
  const old = layoutPreview.querySelector('canvas');
  if (old) old.remove();
  layoutPreview.appendChild(renderLayoutPreview(boardCanvas, positionCanvas));
}

// "L1 · 1800 · Mate in 4" – also used as the marker name in Premiere.
function markerName(level) {
  return 'L' + level.number + ' · ' + level.elo + ' · Mate in ' + level.mateIn;
}

// When new text is pasted, guess the setup-move checkbox and the ID from it.
puzzleText.addEventListener('input', () => {
  try {
    const puzzle = readPuzzleText(puzzleText.value);
    hasSetupMove.checked = puzzle.format === 'fen' && puzzle.moves.length % 2 === 0;
    puzzleId.value = puzzle.id;
  } catch (error) { /* refresh() shows the error */ }
  refresh();
});
hasSetupMove.addEventListener('change', refresh);

// ---------- Export ----------

function todayString() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

async function writeFile(folderHandle, name, content) {
  const fileHandle = await folderHandle.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

// Keyframes that slide a piece from one square to another during a clip of "frames" frames.
// Ease-in-out: slow start, fast middle, slow end. The frame after the clip shows the piece on its target square.
function slideKeyframes(from, to, frames, flipped) {
  const a = squareXY(from, flipped, settings);
  const b = squareXY(to, flipped, settings);
  const keyframes = [];
  for (let i = 0; i < frames; i++) {
    const t = (i + 1) / (frames + 1);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    keyframes.push({ frame: i, dx: (b.x - a.x) * eased, dy: (b.y - a.y) * eased });
  }
  return keyframes;
}

// Works out every still and where it goes on the timeline. Returns:
//   { stills: { fileName: canvas }, tracks: [V1, V2, V3], markers, totalFrames }
// V1 = board, V2 = pieces + highlights, V3 = the piece that is sliding (only while it slides).
function buildTimeline(result, name) {
  const flipped = isFlipped(result);
  const draw = position => renderPosition(position, flipped, settings, pieceImages);

  const levelFrames = Math.round(settings.secondsPerLevel * FPS);
  const holdFrames = Math.round(settings.finalHold * FPS);
  const animate = settings.animateMoves;
  const framesBefore = animate ? settings.framesBefore : 0;
  const framesAfter = animate ? settings.framesAfter : 0;
  if (levelFrames <= framesBefore + framesAfter) {
    throw new Error('The level is too short for the animation frames. Raise "seconds per level".');
  }

  const stills = {};
  const piecesTrack = [];
  const sliderTrack = [];
  const markers = [];

  // One animated move: the position without the moving piece on V2, the moving piece alone on V3.
  // A captured piece stays visible until the cut to the next still. When castling, only the king slides.
  function addSlide(before, after, start, frames, label) {
    const [from, to] = after.lastMove;
    const restPieces = Object.assign({}, before.pieces);
    delete restPieces[from];
    stills[label + '_rest.png'] = draw({ pieces: restPieces, lastMove: before.lastMove, check: before.check });
    stills[label + '_piece.png'] = draw({ pieces: { [from]: before.pieces[from] }, lastMove: null, check: null });
    piecesTrack.push({ fileName: label + '_rest.png', start: start, end: start + frames });
    sliderTrack.push({ fileName: label + '_piece.png', start: start, end: start + frames,
      keyframes: slideKeyframes(from, to, frames, flipped) });
  }

  let frame = 0;
  result.levels.forEach((level, k) => {
    const label = name + '_L' + level.number;
    const levelEnd = frame + levelFrames;
    markers.push({ name: markerName(level), frame: frame });

    // Start of the level: the opponent's move that led to this position slides in.
    let stillStart = frame;
    const previous = k === 0 ? result.setupPosition : result.positions[2 * k - 1];
    if (animate && previous) {
      addSlide(previous, level.position, frame, framesBefore, label + '_in');
      stillStart += framesBefore;
    }

    // Middle of the level: the position stands still while the bar counts down.
    stills[label + '.png'] = draw(level.position);
    piecesTrack.push({ fileName: label + '.png', start: stillStart, end: levelEnd - framesAfter });

    // End of the level: the solution move slides.
    if (animate) {
      addSlide(level.position, result.positions[2 * k + 1], levelEnd - framesAfter, framesAfter, label + '_out');
    }
    frame = levelEnd;
  });

  stills[name + '_mate.png'] = draw(result.finalPosition);
  piecesTrack.push({ fileName: name + '_mate.png', start: frame, end: frame + holdFrames });
  markers.push({ name: 'Mate', frame: frame });
  frame += holdFrames;

  stills[name + '_board.png'] = renderBoard(flipped, settings);
  const boardTrack = [{ fileName: name + '_board.png', start: 0, end: frame }];

  return { stills: stills, tracks: [boardTrack, piecesTrack, sliderTrack], markers: markers, totalFrames: frame };
}

// The text for readme.txt: what the puzzle is and how it is solved.
function buildReadme(puzzle, result, name) {
  const lines = [
    'Chessifity level puzzle ' + name,
    '',
    (result.solver === 'w' ? 'White' : 'Black') + ' to move, mate in ' + result.levels.length,
    'Start position (FEN): ' + result.levels[0].position.fen,
    '',
    'Levels:',
  ];
  for (const level of result.levels) {
    lines.push('  ' + markerName(level) + '   solution: ' + level.solverMove + (level.reply ? ', reply: ' + level.reply : ''));
  }
  lines.push('');
  if (puzzle.rating) lines.push('Lichess rating: ' + puzzle.rating);
  if (puzzle.source) lines.push('Source: ' + puzzle.source);
  lines.push('Engine check: not done yet (coming in a later version).');
  lines.push('Chess pieces: cburnett set by Colin M.L. Burnett.');
  return lines.join('\r\n') + '\r\n';
}

async function generate() {
  if (!window.showDirectoryPicker) {
    throw new Error('This browser cannot write into folders. Use a current Chrome or Edge.');
  }
  let baseHandle;
  try {
    baseHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (error) {
    message.textContent = 'No folder picked.';
    return;
  }

  const id = puzzleId.value.trim().replace(/[^\w-]/g, '') || 'puzzle';
  const name = todayString() + '_' + id; // used for the folder and as a prefix for every file
  const timeline = buildTimeline(current.result, name);

  const folderHandle = await baseHandle.getDirectoryHandle(name, { create: true });
  for (const fileName in timeline.stills) {
    await writeFile(folderHandle, fileName, await canvasToPngBlob(timeline.stills[fileName]));
  }

  const xml = buildXmeml({
    name: name,
    fps: FPS,
    width: FRAME_W,
    height: FRAME_H,
    durationFrames: timeline.totalFrames,
    tracks: timeline.tracks,
    markers: timeline.markers,
  });
  await writeFile(folderHandle, name + '.xml', xml);
  await writeFile(folderHandle, 'readme.txt', buildReadme(current.puzzle, current.result, name));

  message.textContent = 'Done. Created folder "' + name + '" inside "' + baseHandle.name + '" with ' +
    Object.keys(timeline.stills).length + ' PNGs, readme.txt and ' + name + '.xml.\nIn Premiere: File > Import > ' + name + '.xml';
}

generateButton.addEventListener('click', () => {
  message.className = '';
  generate().catch(error => {
    message.className = 'error';
    message.textContent = 'Something went wrong: ' + error.message;
  });
});

// ---------- Start ----------

showSettings();
loadPieceImages().then(images => {
  pieceImages = images;
  refresh();
});
