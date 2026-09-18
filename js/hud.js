import { clamp } from './utils.js';

export function drawHUD(ctx, width, height, opts) {
  const { score, gold, player, sentinel, spaceLion, floatingTexts, messages } = opts;

  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 6;

  // Score (top-left)
  ctx.font = '700 20px system-ui, sans-serif';
  ctx.fillStyle = '#ffd76a';
  ctx.textAlign = 'left';
  ctx.fillText(`Score ${score}`, 16, 14);

  // Gold (top-right)
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffc247';
  ctx.fillText(`✦ ${gold}`, width - 16, 14);

  // Player health bar
  const barW = Math.min(220, width * 0.5);
  const barH = 12;
  const hx = 16, hy = 46;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(hx, hy, barW, barH);
  const pct = clamp(player.health / player.maxHealth, 0, 1);
  ctx.fillStyle = pct > 0.35 ? '#5be36a' : '#ff5d5d';
  ctx.fillRect(hx, hy, barW * pct, barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(hx, hy, barW, barH);

  // Boss bar (top-center)
  if (sentinel && sentinel.isActive) {
    drawBossBar(ctx, width, 'SENTINEL', sentinel.health.fraction, 3, '#ff4470');
  } else if (spaceLion && spaceLion.active) {
    drawBossBar(ctx, width, 'SPACE LION', spaceLion.health.fraction, 1, '#ffb347');
  }

  ctx.restore();

  // Center messages (fading banner text)
  for (const m of messages) {
    const elapsed = m.maxLife - m.life;
    const fadeIn = clamp(elapsed / 0.3, 0, 1);
    const fadeOut = clamp(m.life / 0.4, 0, 1);
    const a = Math.min(fadeIn, fadeOut);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillStyle = m.color || '#eaf2ff';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 10;
    ctx.fillText(m.text, width / 2, m.y != null ? m.y : height * 0.24);
    ctx.restore();
  }

  // Floating combat text
  for (const f of floatingTexts) {
    ctx.save();
    ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
    ctx.fillStyle = f.color;
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 4;
    ctx.fillText(f.text, f.x, f.y);
    ctx.restore();
  }
}

function drawBossBar(ctx, width, label, fraction, segments, color) {
  const barW = Math.min(320, width * 0.72);
  const barH = 16;
  const x = width / 2 - barW / 2;
  const y = 14;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.font = '700 13px system-ui, sans-serif';
  ctx.fillStyle = '#eaf2ff';
  ctx.fillText(label, width / 2, y - 2);

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y + 14, barW, barH);

  const pct = clamp(fraction, 0, 1);
  ctx.fillStyle = pct > 0.6 ? '#5be36a' : pct > 0.3 ? '#ffb347' : color;
  ctx.fillRect(x, y + 14, barW * pct, barH);

  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y + 14, barW, barH);

  for (let i = 1; i < segments; i++) {
    const dx = x + (barW / segments) * i;
    ctx.beginPath();
    ctx.moveTo(dx, y + 14);
    ctx.lineTo(dx, y + 14 + barH);
    ctx.strokeStyle = 'rgba(5,5,15,0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}
