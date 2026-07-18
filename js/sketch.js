// 略图绘制
// 输入：coordinates 数组 [{name, x, y}, ...] + 选项
// 输出：把导线画到 canvas 上，自动适配 + 高 DPI 清晰

export function drawTraverse(canvas, coordinates, opts = {}) {
  if (!canvas || !coordinates || coordinates.length < 2) return;
  const { isClosed = true } = opts;

  const dpr = window.devicePixelRatio || 1;
  // 用 clientWidth/Height 跟随 CSS 布局；不要写死 style 宽高，否则缩放后错位
  const parent = canvas.parentElement;
  const cssW = Math.max(
    canvas.clientWidth || 0,
    parent?.clientWidth || 0,
    300
  );
  const cssH = Math.max(
    canvas.clientHeight || 0,
    parent ? Math.min(parent.clientHeight || 0, 600) || 0 : 0,
    240
  );

  // 仅设置绘图缓冲尺寸；显示尺寸交给 CSS（width:100%; height:...）
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const W = cssW;
  const H = cssH;
  const padding = 36;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of coordinates) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  // 避免所有点重合时 scale 爆炸
  const rangeX = Math.max(maxX - minX, 1e-6);
  const rangeY = Math.max(maxY - minY, 1e-6);

  // 等比例：测绘 Y(东)→画布宽，测绘 X(北)→画布高（向上）
  const scale = Math.min(
    (W - 2 * padding) / rangeY,
    (H - 2 * padding) / rangeX
  );
  const contentW = rangeY * scale;
  const contentH = rangeX * scale;
  // 内容块在画布中居中
  const originCx = (W - contentW) / 2;
  const originCy = (H - contentH) / 2;

  const toCanvas = (p) => ({
    cx: originCx + (p.y - minY) * scale,
    cy: originCy + (maxX - p.x) * scale
  });

  const css = getComputedStyle(document.documentElement);
  const bg = (css.getPropertyValue('--surface-2') || '#f8fafc').trim() || '#f8fafc';
  const grid = (css.getPropertyValue('--border') || '#e2e8f0').trim() || '#e2e8f0';
  const line = (css.getPropertyValue('--primary') || '#0f766e').trim() || '#0f766e';
  const lineAlt = (css.getPropertyValue('--accent') || '#1d4ed8').trim() || '#1d4ed8';
  const text = (css.getPropertyValue('--text') || '#0f172a').trim() || '#0f172a';
  const muted = (css.getPropertyValue('--text-muted') || '#475569').trim() || '#475569';
  const startC = (css.getPropertyValue('--danger') || '#dc2626').trim() || '#dc2626';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  const gridStep = chooseGridStep(scale, Math.min(rangeX, rangeY));
  for (let gy = Math.floor(minY / gridStep) * gridStep; gy <= maxY + gridStep * 0.5; gy += gridStep) {
    const cx = originCx + (gy - minY) * scale;
    if (cx < -1 || cx > W + 1) continue;
    ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, H); ctx.stroke();
  }
  for (let gx = Math.floor(minX / gridStep) * gridStep; gx <= maxX + gridStep * 0.5; gx += gridStep) {
    const cy = originCy + (maxX - gx) * scale;
    if (cy < -1 || cy > H + 1) continue;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(W, cy); ctx.stroke();
  }

  ctx.strokeStyle = isClosed ? line : lineAlt;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  coordinates.forEach((p, i) => {
    const c = toCanvas(p);
    if (i === 0) ctx.moveTo(c.cx, c.cy);
    else ctx.lineTo(c.cx, c.cy);
  });
  if (isClosed) {
    const c0 = toCanvas(coordinates[0]);
    ctx.lineTo(c0.cx, c0.cy);
  }
  ctx.stroke();

  coordinates.forEach((p, i) => {
    const c = toCanvas(p);
    const isStart = i === 0;
    const isEnd = i === coordinates.length - 1 && !isClosed;
    ctx.beginPath();
    ctx.arc(c.cx, c.cy, isStart ? 6 : 4, 0, Math.PI * 2);
    ctx.fillStyle = isStart ? startC : (isEnd ? '#a78bfa' : line);
    ctx.fill();
    ctx.strokeStyle = bg;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = '600 12px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const label = p.name || '';
    const labelX = c.cx + 9;
    const labelY = c.cy - 9;
    const m = ctx.measureText(label);
    ctx.fillStyle = bg;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(labelX - 3, labelY - 8, m.width + 6, 16);
    ctx.globalAlpha = 1;
    ctx.fillStyle = isStart ? startC : (isEnd ? '#a78bfa' : text);
    ctx.fillText(label, labelX, labelY);
  });

  const niceSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  const targetPx = W * 0.25;
  const targetMeter = targetPx / scale;
  let scaleStep = niceSteps[niceSteps.length - 1];
  for (const s of niceSteps) {
    if (s >= targetMeter) { scaleStep = s; break; }
  }
  const scaleLen = scaleStep * scale;
  const sx = padding, sy = H - padding / 2;
  ctx.strokeStyle = muted; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + scaleLen, sy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sx, sy - 4); ctx.lineTo(sx, sy + 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(sx + scaleLen, sy - 4); ctx.lineTo(sx + scaleLen, sy + 4); ctx.stroke();
  ctx.fillStyle = text; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
  ctx.font = '600 11px -apple-system, sans-serif';
  ctx.fillText(`${scaleStep} m`, sx, sy - 6);
}

function chooseGridStep(scale, rangeM) {
  const candidates = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
  const idealPx = 40;
  const idealM = idealPx / Math.max(scale, 1e-9);
  for (const c of candidates) {
    if (c >= idealM) return c;
  }
  return Math.max(rangeM / 8, candidates[candidates.length - 1]);
}
