// make-shortlist.js – one-time script: picks the good mate puzzles out of the Lichess puzzle database.
//
// 1. Download lichess_db_puzzle.csv.zst from https://database.lichess.org/#puzzles
//    and put it in the project folder (next to index.html).
// 2. In a terminal in the project folder, run:   node tools/make-shortlist.js
// 3. It writes data/shortlist.js, which the web page loads for the "Next puzzle" button.

// ---------- Change these to taste ----------
const THEMES = ['mateIn3', 'mateIn4', 'mateIn5']; // keep a puzzle if it has at least one of these themes
const MIN_POPULARITY = 90;        // Lichess popularity, -100 … 100
const MIN_PLAYS = 2000;           // how often the puzzle has been played
const MIN_RATING = 1500;
const MAX_RATING = 2300;
const MAX_RATING_DEVIATION = 80;  // lower = the rating is more certain
// -------------------------------------------

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const projectFolder = path.join(__dirname, '..');
const zstFile = path.join(projectFolder, 'lichess_db_puzzle.csv.zst');
const csvFile = path.join(projectFolder, 'lichess_db_puzzle.csv'); // also fine if you already unpacked it
const outputFile = path.join(projectFolder, 'data', 'shortlist.js');

async function main() {
  let input;
  if (fs.existsSync(zstFile)) {
    input = fs.createReadStream(zstFile).pipe(zlib.createZstdDecompress());
  } else if (fs.existsSync(csvFile)) {
    input = fs.createReadStream(csvFile);
  } else {
    console.error('Cannot find lichess_db_puzzle.csv.zst in ' + projectFolder);
    process.exit(1);
  }

  const kept = [];
  const perTheme = {};
  let total = 0;
  let column = null; // column name -> position in the row, read from the first line

  for await (const line of readline.createInterface({ input: input, crlfDelay: Infinity })) {
    const cells = line.split(',');
    if (!column) {
      column = {};
      cells.forEach((name, i) => { column[name.trim()] = i; });
      continue;
    }
    total++;
    if (total % 500000 === 0) console.log('  read ' + total + ' puzzles…');

    const themes = cells[column.Themes].split(' ');
    const theme = THEMES.find(t => themes.includes(t));
    const rating = Number(cells[column.Rating]);
    if (!theme) continue;
    if (Number(cells[column.Popularity]) < MIN_POPULARITY) continue;
    if (Number(cells[column.NbPlays]) < MIN_PLAYS) continue;
    if (rating < MIN_RATING || rating > MAX_RATING) continue;
    if (Number(cells[column.RatingDeviation]) > MAX_RATING_DEVIATION) continue;

    // PuzzleId,FEN,Moves,Rating,Themes,GameUrl – the first move in Moves is the opponent's setup move.
    kept.push([cells[column.PuzzleId], cells[column.FEN], cells[column.Moves], rating,
      cells[column.Themes], cells[column.GameUrl]].join(','));
    perTheme[theme] = (perTheme[theme] || 0) + 1;
  }

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile,
    '// Made by tools/make-shortlist.js from the Lichess puzzle database (CC0). One puzzle per line:\n' +
    '// PuzzleId,FEN,Moves,Rating,Themes,GameUrl\n' +
    'const PUZZLE_SHORTLIST = [\n' + kept.map(line => JSON.stringify(line)).join(',\n') + '\n];\n');

  console.log('Read ' + total + ' puzzles, kept ' + kept.length + ':');
  for (const theme of THEMES) console.log('  ' + theme + ': ' + (perTheme[theme] || 0));
  console.log('Written to ' + outputFile + ' (' + Math.round(fs.statSync(outputFile).size / 1024) + ' KB)');
}

main();
