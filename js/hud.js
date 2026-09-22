import { clamp } from './utils.js';

// Chunky toy HUD, after gig-ambulance: cream pills and cards with thick ink
// borders and hard drop shadows, bold rounded type, pop-in toast banners.
const INK = '#3b2e5a';
const CREAM = '#fffdf8';
const FONT = '"Trebuchet MS", "Avenir Next", system-ui, -apple-system, sans-serif';
const TOAST_BG = {
  bad: '#ffc4cc',
  warn: '#ffe0b0',
  good: '#b9f5cf',
  gold: '#ffd45e',
  ring: '#bff3ec',
};
const PAUSE_BTN = 44; // matches #btn-pause in css/style.css

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A card: hard ink drop shadow, fill, thick ink border.
function card(ctx, x, y, w, h, r, fill, drop = 4, line = 3) {
  ctx.fillStyle = INK;
  roundRect(ctx, x, y + drop, w, h, r);
  ctx.fill();
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function font(weight, size) {
  return `${weight} ${size}px ${FONT}`;
}

// A meter inside an ink-bordered trough, with an optional number of segments.
function bar(ctx, x, y, w, h, pct, color, segments) {
  ctx.fillStyle = '#e7def8';
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fill();
  if (pct > 0) {
    ctx.save();
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * pct, h);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(x, y + 2, w * pct, Math.max(2, h * 0.22));
    ctx.restore();
  }
  if (segments > 1) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    for (let i = 1; i < segments; i++) {
      const dx = x + (w / segments) * i;
      ctx.beginPath();
      ctx.moveTo(dx, y);
      ctx.lineTo(dx, y + h);
      ctx.stroke();
    }
  }
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.stroke();
}

function coinIcon(ctx, cx, cy, r) {
  ctx.fillStyle = '#ffc53a';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? r * 0.55 : r * 0.24;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const px = cx + Math.cos(a) * rr, py = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

// A pill with a small label and a big value; returns its width.
function statPill(ctx, x, y, label, value, align, icon) {
  ctx.font = font(900, 20);
  const vw = ctx.measureText(value).width;
  ctx.font = font(800, 11);
  const lw = label ? ctx.measureText(label).width + 6 : 0;
  const iw = icon ? 24 : 0;
  const w = 28 + lw + iw + vw;
  const h = 36;
  const left = align === 'right' ? x - w : x;
  card(ctx, left, y, w, h, h / 2, CREAM);
  let cx = left + 14;
  if (icon) { icon(ctx, cx + 9, y + h / 2, 10); cx += iw; }
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  if (label) {
    ctx.font = font(800, 11);
    ctx.fillStyle = 'rgba(59,46,90,0.7)';
    ctx.fillText(label, cx, y + h / 2 + 1);
    cx += lw;
  }
  ctx.font = font(900, 20);
  ctx.fillStyle = INK;
  ctx.fillText(value, cx, y + h / 2 + 1);
  return w;
}

export function drawHUD(ctx, width, height, opts) {
  const { score, gold, player, sentinel, spaceLion, floatingTexts, messages, input, playing, time } = opts;
  const safeTop = opts.safeTop || 0;
  const safeBottom = opts.safeBottom || 0;
  const top = Math.max(12, safeTop + 8);
  const t = time || 0;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.lineJoin = 'round';

  // Score (top-left) and gold (top-right, left of the pause button)
  statPill(ctx, 12, top, 'SCORE', String(score), 'left');
  statPill(ctx, width - 12 - PAUSE_BTN - 10, top + 4, null, String(gold), 'right', coinIcon);

  // Hull bar under the score
  const hpW = Math.min(180, width * 0.44);
  const hpY = top + 46;
  card(ctx, 12, hpY, hpW, 26, 13, CREAM, 3, 3);
  ctx.font = font(900, 11);
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('HP', 22, hpY + 13.5);
  const pct = clamp(player.health / player.maxHealth, 0, 1);
  const low = pct <= 0.35;
  const hpColor = pct > 0.6 ? '#3ddc84' : pct > 0.35 ? '#ffd45e' : '#ee4b5e';
  const pulse = low ? 0.5 + 0.5 * Math.sin(t * 10) : 0;
  bar(ctx, 44, hpY + 6, hpW - 42, 14, pct, pulse > 0.5 ? '#ff8a96' : hpColor, 4);

  // Boss card (centered, below the top row)
  if (sentinel && sentinel.isActive) {
    drawBossBar(ctx, width, top + 84, 'SENTINEL', sentinel.health.fraction, sentinel.health.phases, '#ff5d7a');
  } else if (spaceLion && spaceLion.active) {
    drawBossBar(ctx, width, top + 84, 'SPACE LION', spaceLion.health.fraction, spaceLion.health.phases, '#ff9e4a');
  }

  // Thumbstick: the live stick while dragging, else a faint hint where it lives
  if (playing && input) {
    if (input.stickActive) {
      drawStick(ctx, input.stickBaseX, input.stickBaseY, input.stickThumbX, input.stickThumbY, input.stickRadius, 1);
    } else {
      const r = input.stickRadius;
      const bx = 24 + r, by = height - Math.max(24, safeBottom + 12) - r;
      drawStick(ctx, bx, by, bx, by, r, 0.4);
    }
  }
  ctx.restore();

  // Toast banners
  messages.forEach((m, idx) => {
    const elapsed = m.maxLife - m.life;
    const popIn = clamp(elapsed / 0.18, 0, 1);
    const settle = elapsed < 0.18 ? popIn * 1.12 : 1 + Math.max(0, 0.12 - (elapsed - 0.18) * 0.8);
    const fadeOut = clamp(m.life / 0.35, 0, 1);
    const rise = (1 - fadeOut) * 24;
    ctx.save();
    ctx.globalAlpha = fadeOut;
    ctx.translate(width / 2, height * 0.64 + idx * 56 - rise);
    ctx.scale(settle, settle);
    ctx.font = font(900, 21);
    const tw = ctx.measureText(m.text).width;
    const w = tw + 36, h = 44;
    ctx.lineJoin = 'round';
    card(ctx, -w / 2, -h / 2, w, h, 14, TOAST_BG[m.kind] || '#ffd45e', 4, 3);
    ctx.fillStyle = INK;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(m.text, 0, 1);
    ctx.restore();
  });

  // Floating combat text: bold, ink-stroked, pops in
  for (const f of floatingTexts) {
    const k = clamp(f.life / f.maxLife, 0, 1);
    const age = f.maxLife - f.life;
    const s = age < 0.12 ? 0.6 + (age / 0.12) * 0.55 : 1.15 - Math.min(0.15, (age - 0.12));
    ctx.save();
    ctx.globalAlpha = Math.min(1, k * 2);
    ctx.translate(f.x, f.y);
    ctx.scale(s, s);
    ctx.font = font(900, 20);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = INK;
    ctx.strokeText(f.text, 0, 0);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, 0, 0);
    ctx.restore();
  }
}

function drawStick(ctx, bx, by, tx, ty, r, alpha) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(255,253,248,0.22)';
  ctx.beginPath();
  ctx.arc(bx, by, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(59,46,90,0.75)';
  ctx.stroke();
  const kr = 24;
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(tx, ty + 4, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = CREAM;
  ctx.beginPath();
  ctx.arc(tx, ty, kr, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

function drawBossBar(ctx, width, y, label, fraction, segments, color) {
  const w = Math.min(320, width - 24);
  const x = width / 2 - w / 2;
  const h = 46;
  ctx.save();
  card(ctx, x, y, w, h, 14, CREAM);
  ctx.font = font(900, 12);
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, width / 2, y + 12);
  bar(ctx, x + 12, y + 22, w - 24, 14, clamp(fraction, 0, 1), color, segments);
  ctx.restore();
}
