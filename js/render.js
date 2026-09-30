// render.js – draws the board layer and the pieces layer onto 1080x1920 canvases.
// "look" is the settings object from app.js (colours, board size, …).

const FRAME_W = 1080;
const FRAME_H = 1920;

function newCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

// Loads the 12 piece images from vendor/pieces-cburnett.js. Returns { wK: Image, … }.
async function loadPieceImages() {
  const images = {};
  for (const code in PIECE_SVGS) {
    const image = new Image();
    image.src = PIECE_SVGS[code];
    await image.decode();
    images[code] = image;
  }
  return images;
}

// Where the board sits on the frame: centred left-right, boardY pixels from the top.
// The size is rounded down to a multiple of 8 so every square is a whole number of pixels.
function boardRect(look) {
  const size = Math.floor(look.boardSize / 8) * 8;
  return { x: Math.round((FRAME_W - size) / 2), y: look.boardY, size: size };
}

// "e4" -> pixel position of that square's top-left corner, plus the square size s.
// flipped = false: White at the bottom.  flipped = true: Black at the bottom.
function squareXY(square, flipped, look) {
  let col = square.charCodeAt(0) - 97; // a=0 … h=7
  let row = 8 - Number(square[1]);     // rank 8 = row 0 (top)
  if (flipped) {
    col = 7 - col;
    row = 7 - row;
  }
  const board = boardRect(look);
  const s = board.size / 8;
  return { x: board.x + col * s, y: board.y + row * s, s: s, col: col, row: row };
}

// Layer 1: the 64 squares and (optionally) the coordinates. Everything outside the board stays transparent.
function renderBoard(flipped, look) {
  const canvas = newCanvas(FRAME_W, FRAME_H);
  const ctx = canvas.getContext('2d');
  for (let file = 0; file < 8; file++) {
    for (let rank = 1; rank <= 8; rank++) {
      const { x, y, s, col, row } = squareXY('abcdefgh'[file] + rank, flipped, look);
      const isLight = (file + rank) % 2 === 0;
      ctx.fillStyle = isLight ? look.lightColor : look.darkColor;
      ctx.fillRect(x, y, s, s);

      if (look.coordinates) {
        // Small letters/numbers inside the edge squares, in the colour of the opposite square.
        ctx.fillStyle = isLight ? look.darkColor : look.lightColor;
        ctx.font = 'bold ' + Math.round(s * 0.2) + 'px system-ui, sans-serif';
        if (col === 0) {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(rank, x + s * 0.06, y + s * 0.06);
        }
        if (row === 7) {
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          ctx.fillText('abcdefgh'[file], x + s * 0.94, y + s * 0.96);
        }
      }
    }
  }
  return canvas;
}

// Layer 2: highlights + pieces (+ arrow) on a transparent background.
// position comes from snapshot() in puzzle.js:
//   { pieces: { e1: 'wR', … }, lastMove: ['e1', 'e8'] or null, check: 'g8' or null }
function renderPosition(position, flipped, look, pieceImages) {
  const canvas = newCanvas(FRAME_W, FRAME_H);
  const ctx = canvas.getContext('2d');

  // Last move: both squares tinted.
  ctx.globalAlpha = look.lastMoveOpacity / 100;
  ctx.fillStyle = look.lastMoveColor;
  for (const square of position.lastMove || []) {
    const { x, y, s } = squareXY(square, flipped, look);
    ctx.fillRect(x, y, s, s);
  }
  ctx.globalAlpha = 1;

  // Check: red glow under the king.
  if (look.checkHighlight && position.check) {
    const { x, y, s } = squareXY(position.check, flipped, look);
    const glow = ctx.createRadialGradient(x + s / 2, y + s / 2, 0, x + s / 2, y + s / 2, s * 0.7);
    glow.addColorStop(0, 'rgba(255, 0, 0, 1)');
    glow.addColorStop(0.25, 'rgba(231, 0, 0, 1)');
    glow.addColorStop(0.89, 'rgba(169, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x, y, s, s);
  }

  for (const square in position.pieces) {
    const { x, y, s } = squareXY(square, flipped, look);
    ctx.drawImage(pieceImages[position.pieces[square]], x, y, s, s);
  }

  if (look.arrow && position.lastMove) {
    drawArrow(ctx, squareXY(position.lastMove[0], flipped, look), squareXY(position.lastMove[1], flipped, look), look.arrowColor);
  }
  return canvas;
}

// An arrow from the middle of one square to the middle of another.
function drawArrow(ctx, from, to, color) {
  const s = from.s;
  const x1 = from.x + s / 2, y1 = from.y + s / 2;
  const x2 = to.x + s / 2, y2 = to.y + s / 2;
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const length = Math.hypot(x2 - x1, y2 - y1);
  const head = s * 0.4; // length of the arrow head

  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = color;
  ctx.translate(x1, y1);
  ctx.rotate(angle); // from here on the arrow simply points to the right
  ctx.beginPath();
  ctx.moveTo(s * 0.25, -s * 0.08);
  ctx.lineTo(length - head, -s * 0.08);
  ctx.lineTo(length - head, -s * 0.22);
  ctx.lineTo(length, 0);
  ctx.lineTo(length - head, s * 0.22);
  ctx.lineTo(length - head, s * 0.08);
  ctx.lineTo(s * 0.25, s * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Small square preview: board + pieces stacked, cropped to the board area.
function renderPreview(boardCanvas, positionCanvas, size, look) {
  const board = boardRect(look);
  const canvas = newCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(boardCanvas, board.x, board.y, board.size, board.size, 0, 0, size, size);
  ctx.drawImage(positionCanvas, board.x, board.y, board.size, board.size, 0, 0, size, size);
  return canvas;
}

// Whole-frame preview with the areas TikTok covers with its own interface.
// These zones are approximate (TikTok changes them and they differ per phone).
const TIKTOK_ZONES = [
  { label: 'top bar', x: 0, y: 0, w: 1080, h: 130 },
  { label: 'caption', x: 0, y: 1440, w: 1080, h: 480 },
  { label: 'buttons', x: 940, y: 800, w: 140, h: 640 },
];

function renderLayoutPreview(boardCanvas, positionCanvas) {
  const canvas = newCanvas(FRAME_W, FRAME_H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  ctx.drawImage(boardCanvas, 0, 0);
  if (positionCanvas) ctx.drawImage(positionCanvas, 0, 0);

  ctx.font = '44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const zone of TIKTOK_ZONES) {
    ctx.fillStyle = 'rgba(255, 60, 60, 0.35)';
    ctx.fillRect(zone.x, zone.y, zone.w, zone.h);
    ctx.fillStyle = '#fff';
    ctx.save();
    ctx.translate(zone.x + zone.w / 2, zone.y + zone.h / 2);
    if (zone.h > zone.w) ctx.rotate(-Math.PI / 2); // tall zones get sideways text
    ctx.fillText(zone.label, 0, 0);
    ctx.restore();
  }
  return canvas;
}

function canvasToPngBlob(canvas) {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}
