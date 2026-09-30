// picker.js – the "Next puzzle" shortlist and the list of puzzles that were already used or skipped.

// data/shortlist.js (made by tools/make-shortlist.js) defines PUZZLE_SHORTLIST. It is fine if it is missing.
// Each line: PuzzleId,FEN,Moves,Rating,Themes,GameUrl
const shortlist = (typeof PUZZLE_SHORTLIST === 'undefined' ? [] : PUZZLE_SHORTLIST).map(line => {
  const cells = line.split(',');
  const mate = cells[4].match(/mateIn(\d)/);
  return { id: cells[0], line: line, rating: Number(cells[3]), mateIn: mate ? Number(mate[1]) : 0 };
});

// { puzzleId: { status: 'used' or 'skipped', date: '2026-09-30' } } – kept in this browser.
let puzzleLog = JSON.parse(localStorage.getItem('puzzleLog') || '{}');

function markPuzzle(id, status, date) {
  puzzleLog[id] = { status: status, date: date };
  localStorage.setItem('puzzleLog', JSON.stringify(puzzleLog));
}

// Shortlist puzzles that pass the filters and were never used or skipped.
// filters: { mateIn: [3, 4], ratingMin, ratingMax }
function unusedPuzzles(filters) {
  return shortlist.filter(p =>
    !puzzleLog[p.id] &&
    filters.mateIn.includes(p.mateIn) &&
    p.rating >= filters.ratingMin && p.rating <= filters.ratingMax);
}

function randomUnusedPuzzle(filters) {
  const list = unusedPuzzles(filters);
  return list.length ? list[Math.floor(Math.random() * list.length)] : null;
}

// Backup: the used-list as a downloadable file, and reading such a file back in (merging with what is there).
function downloadPuzzleLog() {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(puzzleLog, null, 1)], { type: 'application/json' }));
  link.download = 'chessifity-used-puzzles.json';
  link.click();
  URL.revokeObjectURL(link.href);
}

async function loadPuzzleLogFile(file) {
  const loaded = JSON.parse(await file.text());
  puzzleLog = Object.assign({}, loaded, puzzleLog);
  // "used" always wins over "skipped"
  for (const id in loaded) {
    if (loaded[id].status === 'used') puzzleLog[id] = loaded[id];
  }
  localStorage.setItem('puzzleLog', JSON.stringify(puzzleLog));
}
