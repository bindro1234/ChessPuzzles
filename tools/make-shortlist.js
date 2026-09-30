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
const { Readable } = require('stream');

const projectFolder = path.join(__dirname, '..');
const zstFile = path.join(projectFolder, 'lichess_db_puzzle.csv.zst');
const csvFile = path.join(projectFolder, 'lichess_db_puzzle.csv'); // also fine if you already unpacked it
const outputFile = path.join(projectFolder, 'data', 'shortlist.js');

// The Lichess file is made of many separately packed blocks. In front of each block sits a small
// "skippable" note that says how many bytes the block has. This reads and unpacks block by block
// and hands out the unpacked data piece by piece.
function* unpackedBlocks(file) {
  const fd = fs.openSync(file, 'r');
  const header = Buffer.alloc(12);
  let position = 0;
  while (fs.readSync(fd, header, 0, 12, position) === 12) {
    const isNote = (header.readUInt32LE(0) & 0xFFFFFFF0) === 0x184D2A50 && header.readUInt32LE(4) === 4;
    if (!isNote) {
      // Not in blocks after all: unpack the whole rest of the file in one go.
      const rest = Buffer.alloc(fs.fstatSync(fd).size - position);
      fs.readSync(fd, rest, 0, rest.length, position);
      yield zlib.zstdDecompressSync(rest);
      break;
    }
    const block = Buffer.alloc(header.readUInt32LE(8));
    fs.readSync(fd, block, 0, block.length, position + 12);
    position += 12 + block.length;
    yield zlib.zstdDecompressSync(block);
  }
  fs.closeSync(fd);
}

async function main() {
  let input;
  if (fs.existsSync(zstFile)) {
    input = Readable.from(unpackedBlocks(zstFile));
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

  if (kept.length === 0) {
    console.error('Read ' + total + ' puzzles but none passed the filters. Nothing written.');
    process.exit(1);
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
