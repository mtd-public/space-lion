import { Tower } from './entities.js';
import { rand, dist, TWO_PI } from './utils.js';

export const WORLD_W = 3000;
export const WORLD_H = 4000;

export function generateWorld(playerX, playerY) {
  const towers = [];
  const minDistFromPlayer = 500;
  const target = 16;
  let attempts = 0;
  while (towers.length < target && attempts < 500) {
    attempts++;
    const x = rand(150, WORLD_W - 150);
    const y = rand(150, WORLD_H - 150);
    if (dist(x, y, playerX, playerY) < minDistFromPlayer) continue;
    if (towers.some(t => dist(t.x, t.y, x, y) < 260)) continue;
    towers.push(new Tower(x, y));
  }
  return { towers };
}

// Simple starfield used for parallax / motion feedback.
export function makeStarfield(count = 140) {
  const stars = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rand(0, WORLD_W),
      y: rand(0, WORLD_H),
      r: rand(0.6, 2.2),
      a: rand(0.25, 0.9),
    });
  }
  return stars;
}

export function drawBackground(ctx, camera, width, height, stars) {
  ctx.save();
  ctx.fillStyle = '#05050f';
  ctx.fillRect(0, 0, width, height);

  // Stars drawn relative to camera with wrap-around so it feels endless.
  for (const s of stars) {
    let sx = s.x - camera.x + width / 2;
    let sy = s.y - camera.y + height / 2;
    sx = ((sx % WORLD_W) + WORLD_W) % WORLD_W;
    sy = ((sy % WORLD_H) + WORLD_H) % WORLD_H;
    if (sx > width || sy > height) continue;
    ctx.globalAlpha = s.a;
    ctx.fillStyle = '#cfe0ff';
    ctx.beginPath();
    ctx.arc(sx, sy, s.r, 0, TWO_PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}
