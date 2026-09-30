# Chessifity Level Puzzle

A small web tool that turns a forced-mate chess puzzle into a Premiere Pro sequence for the
Chessifity "level puzzle" videos: transparent 1080×1920 PNG stills plus an XML file that
Premiere imports as an editable sequence with level markers.

## Use

1. Open the page (GitHub Pages link, or double-click `index.html`) in Chrome or Edge.
2. Paste a puzzle: a PGN with `[FEN]` header, a Lichess puzzle database line, or a FEN followed by UCI moves.
3. Check the preview, adjust the options, click **Pick folder and generate**.
4. In Premiere: File > Import, choose the `.xml` in the new folder.

## Files

- `index.html` – the page
- `js/puzzle.js` – reads the pasted puzzle and splits it into levels
- `js/render.js` – draws the board and pieces
- `js/xml.js` – writes the Premiere sequence (Final Cut Pro 7 XML)
- `js/verify.js` – engine check: is the mate really forced?
- `js/picker.js` – "Next puzzle" shortlist and the used/skipped list
- `js/storage.js` – remembers the template folder and the preview background
- `js/app.js` – settings, preview and export
- `tools/make-shortlist.js` – one-time script that builds `data/shortlist.js` from the Lichess puzzle database
- `start-local.bat` – runs the tool on this PC (the engine check does not work when `index.html` is opened by double-click)
- `vendor/` – third-party files (see below)

## Credits

- [chess.js](https://github.com/jhlywa/chess.js) by Jeff Hlywa, BSD 2-Clause licence (`vendor/chess.js-LICENSE.txt`)
- [Stockfish.js](https://github.com/nmrugg/stockfish.js) 10, GPLv3 (`vendor/stockfish/Copying.txt`)
- Puzzles from the [Lichess puzzle database](https://database.lichess.org/#puzzles), CC0
- cburnett chess pieces by Colin M.L. Burnett, as distributed by [Lichess](https://github.com/lichess-org/lila) under GPLv2+
