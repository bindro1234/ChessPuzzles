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
  pickMate3: true, // filters for the "Next puzzle" button
  pickMate4: true,
  pickMate5: true,
  pickRatingMin: 1500,
  pickRatingMax: 2300,
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
  boardOffsetX: 0,
  showSafeZones: true,
  templateLevels: 4,        // how many levels the Premiere template has
  templateBakeBoard: false, // true: level images and sequence frames contain the board squares too
  templateOutput: 'both',   // 'stills' (level1.png …), 'sequence' (puzzle_0000.png …) or 'both'
  labelFont: 'Arial Black',
  labelSize: 64,
  labelColor: '#ffffff',
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
  showPuzzle();
  updatePickerInfo(); // after showPuzzle, because the Skip button depends on the puzzle on screen
}

function showPuzzle() {
  current = null;
  generateButton.disabled = true;
  el('saveTemplate').disabled = true;
  renderLabel('', settings, el('labelPreview'));
  levelsBox.innerHTML = '';
  message.textContent = '';
  message.className = '';
  el('engineStatus').innerHTML = '';

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
  el('saveTemplate').disabled = false;
  renderLabel(labelText(result), settings, el('labelPreview'));

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
  if (puzzleLog[puzzle.id]) {
    const div = document.createElement('div');
    div.className = 'warning';
    div.textContent = 'You already ' + puzzleLog[puzzle.id].status + ' this puzzle on ' + puzzleLog[puzzle.id].date + '.';
    summary.appendChild(div);
  }

  if (result.levels.length !== settings.templateLevels) {
    const div = document.createElement('div');
    div.className = 'note';
    div.textContent = 'Template mode: this puzzle has ' + result.levels.length + ' levels, your template has ' + settings.templateLevels + '.';
    summary.appendChild(div);
  }

  // Engine check: only started again when the puzzle itself changed, not when a colour was changed.
  const key = puzzle.startFen + '|' + puzzle.moves.map(m => m.from + m.to).join(' ') + '|' + hasSetupMove.checked;
  if (engineCheck.key !== key) startEngineCheck(result, key);
  showEngineStatus();

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
  layoutPreview.appendChild(renderLayoutPreview(boardCanvas, positionCanvas, backgroundImage, settings.showSafeZones));
}

// ---------- Engine check (is the mate really forced?) ----------

// state: 'none', 'running', 'unavailable' (engine could not start) or 'done' (report is filled in)
let engineCheck = { key: '', state: 'none', report: null, progress: '' };
let engineQueue = Promise.resolve(); // makes sure only one check talks to the engine at a time

function startEngineCheck(result, key) {
  const mine = { key: key, state: 'running', report: null, progress: 'starting…' };
  engineCheck = mine;
  if (!startEngine()) {
    mine.state = 'unavailable';
    return;
  }
  engine.postMessage('stop'); // ends the search of an older check, if one is still running
  engineQueue = engineQueue
    .then(() => verifyPuzzle(result,
      text => { mine.progress = text; if (engineCheck === mine) showEngineStatus(); },
      () => engineCheck !== mine))
    .then(report => {
      if (!report || engineCheck !== mine) return;
      mine.state = 'done';
      mine.report = report;
      showEngineStatus();
    });
}

function showEngineStatus() {
  const box = el('engineStatus');
  box.innerHTML = '';
  const addLine = (className, text) => {
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text;
    box.appendChild(div);
  };
  if (!current) return;

  if (engineCheck.state === 'running') {
    addLine('hint', 'Engine check: ' + engineCheck.progress);
  } else if (engineCheck.state === 'unavailable') {
    addLine('warning', 'Engine check not possible: the browser blocks the chess engine when the page is opened as a local file. ' +
      'Use the GitHub Pages address or start-local.bat. This puzzle is NOT verified.');
  } else if (engineCheck.state === 'done') {
    if (engineCheck.report.problems.length === 0) {
      addLine('ok', '✔ Engine check passed: the mate is forced at every level.');
    } else {
      addLine('warning', '✘ Engine check failed. Do not post this puzzle:');
      for (const problem of engineCheck.report.problems) addLine('warning', '  • ' + problem);
    }
    for (const note of engineCheck.report.notes) addLine('note', 'Note: ' + note);
  }
}

// ---------- Puzzle picker ----------

function pickerFilters() {
  return {
    mateIn: [3, 4, 5].filter(n => settings['pickMate' + n]),
    ratingMin: settings.pickRatingMin,
    ratingMax: settings.pickRatingMax,
  };
}

function updatePickerInfo() {
  const statuses = Object.values(puzzleLog).map(entry => entry.status);
  const used = statuses.filter(s => s === 'used').length;
  const skipped = statuses.filter(s => s === 'skipped').length;
  el('pickerInfo').textContent = shortlist.length === 0
    ? 'No shortlist found (data/shortlist.js). Run tools/make-shortlist.js first.'
    : unusedPuzzles(pickerFilters()).length + ' unused puzzles match · ' + used + ' used · ' + skipped + ' skipped';
  el('nextPuzzle').disabled = shortlist.length === 0;
  el('skipPuzzle').disabled = !(current && current.puzzle.id);
}

// Puts a random unused shortlist puzzle into the paste box, exactly as if it had been pasted.
function loadNextPuzzle() {
  const puzzle = randomUnusedPuzzle(pickerFilters());
  if (!puzzle) {
    message.textContent = 'No unused puzzle matches these filters.';
    return;
  }
  puzzleText.value = puzzle.line;
  puzzleText.dispatchEvent(new Event('input'));
}

el('nextPuzzle').addEventListener('click', loadNextPuzzle);
el('skipPuzzle').addEventListener('click', () => {
  markPuzzle(current.puzzle.id, 'skipped', todayString());
  refresh();
  if (shortlist.length) loadNextPuzzle();
});
el('saveLog').addEventListener('click', event => {
  event.preventDefault();
  downloadPuzzleLog();
});
el('loadLog').addEventListener('click', event => {
  event.preventDefault();
  el('logFile').click();
});
el('logFile').addEventListener('change', async () => {
  if (el('logFile').files[0]) await loadPuzzleLogFile(el('logFile').files[0]);
  refresh();
});

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
  if (engineCheck.state !== 'done') {
    lines.push('Engine check: NOT DONE. The forced mate is unverified.');
  } else if (engineCheck.report.problems.length) {
    lines.push('Engine check: PROBLEMS FOUND');
    for (const problem of engineCheck.report.problems) lines.push('  ' + problem);
  } else {
    lines.push('Engine check (Stockfish 10): forced mate confirmed at every level.');
  }
  if (engineCheck.state === 'done') {
    for (const note of engineCheck.report.notes) lines.push('  Note: ' + note);
  }
  lines.push('Chess pieces: cburnett set by Colin M.L. Burnett.');
  return lines.join('\r\n') + '\r\n';
}

// Reasons to think twice before exporting this puzzle (used by both export buttons).
function exportDoubts(id) {
  const doubts = [];
  if (engineCheck.state !== 'done') doubts.push('The engine has NOT confirmed that this is a forced mate.');
  else if (engineCheck.report.problems.length) doubts.push('The engine check found problems:\n' + engineCheck.report.problems.join('\n'));
  if (puzzleLog[id] && puzzleLog[id].status === 'used') doubts.push('You already used this puzzle on ' + puzzleLog[id].date + '.');
  return doubts;
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

  // Safety questions before anything is written.
  const doubts = exportDoubts(id);
  for await (const [entryName, entry] of baseHandle.entries()) {
    if (id !== 'puzzle' && entry.kind === 'directory' && entryName.endsWith('_' + id) && entryName !== name) {
      doubts.push('This folder already contains "' + entryName + '" for the same puzzle.');
    }
  }
  if (doubts.length && !confirm(doubts.join('\n\n') + '\n\nGenerate anyway?')) {
    message.textContent = 'Cancelled.';
    return;
  }

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

  if (current.puzzle.id) markPuzzle(current.puzzle.id, 'used', todayString());
  updatePickerInfo();

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

// ---------- Template mode ----------
// Writes stills with fixed names into one remembered folder, so a Premiere template picks them up.

let templateFolder = null; // the folder handle, remembered between sessions (see storage.js)

function showTemplateFolder() {
  el('templateFolderName').textContent = templateFolder ? templateFolder.name : 'none picked yet';
}

async function chooseTemplateFolder() {
  try {
    templateFolder = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (error) {
    return false; // dialog closed
  }
  await keepSet('templateFolder', templateFolder);
  showTemplateFolder();
  return true;
}

// "WHITE TO MOVE · MATE IN 4"
function labelText(result) {
  return (result.solver === 'w' ? 'WHITE' : 'BLACK') + ' TO MOVE · MATE IN ' + result.levels.length;
}

async function fileExists(folderHandle, name) {
  try {
    await folderHandle.getFileHandle(name);
    return true;
  } catch (error) {
    return false;
  }
}

async function saveTemplate() {
  if (!window.showDirectoryPicker) {
    throw new Error('This browser cannot write into folders. Use a current Chrome or Edge.');
  }
  if (!templateFolder && !(await chooseTemplateFolder())) {
    message.textContent = 'No folder picked.';
    return;
  }
  // After a browser restart Chrome asks once more whether the page may write into the folder.
  if ((await templateFolder.requestPermission({ mode: 'readwrite' })) !== 'granted') {
    message.textContent = 'Chrome did not get permission to write into "' + templateFolder.name + '".';
    return;
  }

  const result = current.result;
  const levelCount = result.levels.length;
  const id = puzzleId.value.trim().replace(/[^\w-]/g, '') || 'puzzle';

  const writeStills = settings.templateOutput !== 'sequence';
  const writeFrames = settings.templateOutput !== 'stills';
  // The same timeline as the XML export, so timing and slides are identical.
  const timeline = writeFrames ? buildTimeline(result, id) : null;

  const doubts = exportDoubts(id);
  if (levelCount !== settings.templateLevels) {
    doubts.push('This puzzle has ' + levelCount + ' levels, but your template has ' + settings.templateLevels + '.');
  }
  if (timeline && timeline.totalFrames !== templateFrameCount()) {
    doubts.push('The PNG sequence would have ' + timeline.totalFrames + ' frames instead of the ' + templateFrameCount() +
      ' your template expects, so Premiere\'s image sequence clip will not match.');
  }
  if (doubts.length && !confirm(doubts.join('\n\n') + '\n\nSave anyway?')) {
    message.textContent = 'Cancelled.';
    return;
  }

  const flipped = isFlipped(result);
  const board = renderBoard(flipped, settings);
  const still = position => {
    const pieces = renderPosition(position, flipped, settings, pieceImages);
    if (!settings.templateBakeBoard) return pieces;
    const both = newCanvas(FRAME_W, FRAME_H);
    both.getContext('2d').drawImage(board, 0, 0);
    both.getContext('2d').drawImage(pieces, 0, 0);
    return both;
  };

  // board.png, label.png and info.txt are always written; the level stills only when asked for.
  const files = { 'board.png': board, 'label.png': renderLabel(labelText(result), settings) };
  if (writeStills) {
    files['mate.png'] = still(result.finalPosition);
    for (const level of result.levels) files['level' + level.number + '.png'] = still(level.position);
  }
  for (const name in files) {
    await writeFile(templateFolder, name, await canvasToPngBlob(files[name]));
  }
  await writeFile(templateFolder, 'info.txt', buildReadme(current.puzzle, result, id));

  // Level images of an earlier, longer puzzle are left alone, but pointed out.
  const leftovers = [];
  if (writeStills) {
    for (let n = levelCount + 1; n <= 9; n++) {
      if (await fileExists(templateFolder, 'level' + n + '.png')) leftovers.push('level' + n + '.png');
    }
  }

  let framesText = '';
  if (timeline) {
    const removed = await writeSequence(timeline, settings.templateBakeBoard ? board : null);
    framesText = '\nPNG sequence: ' + frameName(0) + ' … ' + frameName(timeline.totalFrames - 1) +
      ' (' + timeline.totalFrames + ' frames)' + (removed ? ', ' + removed + ' leftover frames deleted' : '') + '.';
  }

  if (current.puzzle.id) markPuzzle(current.puzzle.id, 'used', todayString());
  updatePickerInfo();
  message.textContent = 'Saved to "' + templateFolder.name + '": ' + Object.keys(files).sort().join(', ') + ' and info.txt.' +
    framesText +
    (leftovers.length ? '\nWARNING: ' + leftovers.join(', ') + ' in that folder belong' + (leftovers.length === 1 ? 's' : '') +
      ' to an earlier puzzle and ' + (leftovers.length === 1 ? 'was' : 'were') + ' not changed.' : '');
  if (leftovers.length) message.className = 'error';
}

// ---------- PNG sequence (template mode) ----------

function frameName(frame) {
  return 'puzzle_' + String(frame).padStart(4, '0') + '.png';
}

// How many frames a puzzle with the template's level count gives with the current timing.
// Must match what buildTimeline() produces.
function templateFrameCount() {
  return settings.templateLevels * Math.round(settings.secondsPerLevel * FPS) + Math.round(settings.finalHold * FPS);
}

// Writes every frame of the timeline as puzzle_0000.png, puzzle_0001.png, …
// Each frame is put together exactly like Premiere stacks the XML tracks:
// board (if baked in), then the pieces still on V2, then the sliding piece on V3 moved by its keyframe.
// Frames that look the same (all the frames of a standing position) are packed into PNG only once.
// Afterwards, puzzle_XXXX.png files numbered beyond the end are deleted. Returns how many were deleted.
async function writeSequence(timeline, board) {
  const [, piecesTrack, sliderTrack] = timeline.tracks;
  const clipAt = (track, frame) => track.find(clip => frame >= clip.start && frame < clip.end);
  const total = timeline.totalFrames;
  const progress = el('saveProgress');
  progress.max = total;
  progress.hidden = false;

  let lastKey = null;
  let lastBlob = null;
  try {
    for (let frame = 0; frame < total; frame++) {
      const pieces = clipAt(piecesTrack, frame);
      const slider = clipAt(sliderTrack, frame);
      const key = pieces.fileName + (slider ? '|' + slider.fileName + '@' + (frame - slider.start) : '');
      if (key !== lastKey) {
        const canvas = newCanvas(FRAME_W, FRAME_H);
        const ctx = canvas.getContext('2d');
        if (board) ctx.drawImage(board, 0, 0);
        ctx.drawImage(timeline.stills[pieces.fileName], 0, 0);
        if (slider) {
          const move = slider.keyframes[frame - slider.start];
          ctx.drawImage(timeline.stills[slider.fileName], move.dx, move.dy);
        }
        lastBlob = await canvasToPngBlob(canvas);
        lastKey = key;
      }
      await writeFile(templateFolder, frameName(frame), lastBlob);
      if (frame % 10 === 0 || frame === total - 1) {
        progress.value = frame + 1;
        message.textContent = 'Writing frame ' + (frame + 1) + ' of ' + total + '…';
      }
    }
  } finally {
    progress.hidden = true;
  }

  // Leftover frames from a longer earlier puzzle would otherwise stay part of Premiere's sequence.
  const leftovers = [];
  for await (const [name, entry] of templateFolder.entries()) {
    const match = name.match(/^puzzle_(\d+)\.png$/);
    if (entry.kind === 'file' && match && Number(match[1]) >= total) leftovers.push(name);
  }
  for (const name of leftovers) await templateFolder.removeEntry(name);
  return leftovers.length;
}

el('saveTemplate').addEventListener('click', () => {
  message.className = '';
  saveTemplate().catch(error => {
    message.className = 'error';
    message.textContent = 'Something went wrong: ' + error.message;
  });
});
el('changeTemplateFolder').addEventListener('click', async event => {
  event.preventDefault();
  await chooseTemplateFolder();
});

// ---------- Preview background (never exported) ----------

let backgroundImage = null;

async function setBackground(file) {
  backgroundImage = file ? await createImageBitmap(file) : null;
  await keepSet('background', file || null);
  refresh();
}

el('backgroundFile').addEventListener('change', () => setBackground(el('backgroundFile').files[0]));
el('clearBackground').addEventListener('click', event => {
  event.preventDefault();
  el('backgroundFile').value = '';
  setBackground(null);
});

// ---------- Start ----------

showSettings();
loadPieceImages().then(async images => {
  pieceImages = images;
  refresh();
  // Things remembered from last time: the template folder and the preview background.
  try {
    templateFolder = (await keepGet('templateFolder')) || null;
    showTemplateFolder();
    const file = await keepGet('background');
    if (file) {
      backgroundImage = await createImageBitmap(file);
      refresh();
    }
  } catch (error) { /* nothing remembered, or the browser blocks storage: start without */ }
});
