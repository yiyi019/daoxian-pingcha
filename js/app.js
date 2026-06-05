// 控制器：状态管理 + 渲染 + 导入导出 + 方案管理
// 计算是「按按钮触发」模式（不实时重算）；改输入只 markDirty + 渲染反算显示
// 依赖：dms.js, traverse.js, storage.js, sketch.js

import { dmsToDecimal, decimalToDms, formatDms, formatSeconds, azimuthBetween, DEG } from './dms.js';
import { calcClosedTraverse, calcAttachedTraverse } from './traverse.js';
import {
  saveProject, listProjects, getProject, deleteProject, newProjectId,
  saveDraft, loadDraft
} from './storage.js';
import { drawTraverse } from './sketch.js';
import { STATE_VERSION } from './version.js';

// ─────────────────────────────────────────────
// 默认状态
// ─────────────────────────────────────────────
function defaultState() {
  return {
    mode: 'closed',                  // 'closed' | 'attached'
    startPoint: { name: 'A', x: 0, y: 0 },
    startAzimuth: { d: 0, m: 0, s: 0 },
    startAzMode: 'dms',              // 'dms' | 'decimal'
    startAzDecimal: 0,
    startBMode: false,               // true = 用两点反算
    startB: null,                    // { name, x, y } | null
    endPoint: { name: 'E', x: 0, y: 0 },
    endAzimuth: { d: 0, m: 0, s: 0 },
    endAzMode: 'dms',
    endAzDecimal: 0,
    endCMode: false,                 // true = 用 C→D 反算终止方位角
    endC: null,                      // { name, x, y } | null
    angleType: 'right',
    kLimit: 2000,
    integerMode: false,
    stations: [
      { name: 'A', deg: 90, min: 0, sec: 0, distance: 100 },
      { name: 'B', deg: 90, min: 0, sec: 0, distance: 100 },
      { name: 'C', deg: 90, min: 0, sec: 0, distance: 100 },
      { name: 'D', deg: 90, min: 0, sec: 0, distance: 100 }
    ]
  };
}

function resolveStartAz() {
  if (state.startBMode && state.startB) {
    const az = azimuthBetween(state.startPoint, state.startB);
    if (az !== null) return az;
  }
  if (state.startAzMode === 'decimal') return state.startAzDecimal;
  return dmsToDecimal(state.startAzimuth.d, state.startAzimuth.m, state.startAzimuth.s);
}

function resolveEndAz() {
  if (state.endCMode && state.endC) {
    const az = azimuthBetween(state.endC, state.endPoint);
    if (az !== null) return az;
  }
  if (state.endAzMode === 'decimal') return state.endAzDecimal;
  return dmsToDecimal(state.endAzimuth.d, state.endAzimuth.m, state.endAzimuth.s);
}

let state = defaultState();
let lastResult = null;          // 上次计算结果
let stateDirty = false;         // 输入已改但未重算
let currentProjectId = null;

// ─────────────────────────────────────────────
// 计算（仅在按按钮或加载时触发）
// ─────────────────────────────────────────────
function recompute() {
  try {
    const params = {
      startPoint: state.startPoint,
      startAzimuth: resolveStartAz(),
      angleType: state.angleType,
      stations: state.stations,
      kLimit: 1 / state.kLimit,
      integerMode: state.integerMode
    };
    if (state.mode === 'attached') {
      params.endPoint = state.endPoint;
      params.endAzimuth = resolveEndAz();
      lastResult = calcAttachedTraverse(params);
    } else {
      lastResult = calcClosedTraverse(params);
    }
  } catch (e) {
    console.warn('计算失败:', e);
    lastResult = null;
  }
  render();
}

// 输入被改 → 标脏 + 存草稿 + 渲染派生显示（不重算、不重建 input → 保留焦点 / 光标）
function markDirty() {
  stateDirty = true;
  saveDraft(state);
  renderDerived();
  updateComputeButton();
}

// 点「🚀 计算」 → 立即算一次
function runCompute() {
  stateDirty = false;
  recompute();
}

// 计算按钮的视觉状态
function updateComputeButton() {
  const btn = $('#btn-compute');
  if (!btn) return;
  if (stateDirty) {
    btn.classList.add('dirty');
    btn.innerHTML = '<span class="dot"></span>已修改 · 点此重算';
  } else {
    btn.classList.remove('dirty');
    btn.textContent = '🚀 计算';
  }
}

// ─────────────────────────────────────────────
// DOM 工具
// ─────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// 带符号格式化：正数加 "+"，负数自带 "-"
function formatSigned(v, decimals) {
  if (v === 0) return decimals > 0 ? (0).toFixed(decimals) : '0';
  return v > 0 ? '+' + v.toFixed(decimals) : v.toFixed(decimals);
}

// 计算「边长表」第 i 行的「起点 → 终点」标签
function sideLabel(i) {
  const n = state.stations.length;
  if (i < 0 || i >= n) return '';
  const from = state.stations[i].name || `点${i + 1}`;
  let to;
  if (i < n - 1) {
    to = state.stations[i + 1].name || `点${i + 2}`;
  } else {
    to = state.mode === 'attached' ? (state.endPoint.name || '终点') : (state.stations[0].name || '点1');
  }
  return `${from} → ${to}`;
}

// ─────────────────────────────────────────────
// 输入区：从 state 渲染到 DOM
// ─────────────────────────────────────────────
function renderInputs() {
  $('#mode-closed').classList.toggle('active', state.mode === 'closed');
  $('#mode-attached').classList.toggle('active', state.mode === 'attached');
  $('#attached-end').hidden = state.mode !== 'attached';

  $('#start-name').value = state.startPoint.name;
  $('#start-x').value = state.startPoint.x;
  $('#start-y').value = state.startPoint.y;
  $('#start-az-d').value = state.startAzimuth.d;
  $('#start-az-m').value = state.startAzimuth.m;
  $('#start-az-s').value = state.startAzimuth.s;
  $('#start-az-decimal').value = state.startAzDecimal;

  const isStartDms = state.startAzMode === 'dms';
  $('#start-az-dms-row').hidden = !isStartDms;
  $('#start-az-decimal').hidden = isStartDms;
  $('#btn-toggle-start-decimal').classList.toggle('active', !isStartDms);
  $('#btn-toggle-start-decimal').textContent = isStartDms ? '⇄ 十进制' : '⇄ 度分秒';

  $('#start-reverse-panel').hidden = !state.startBMode;
  $('#btn-toggle-start-reverse').classList.toggle('active', state.startBMode);
  if (state.startB) {
    $('#start-b-name').value = state.startB.name;
    $('#start-b-x').value   = state.startB.x;
    $('#start-b-y').value   = state.startB.y;
  }
  const startBResolved = state.startBMode && state.startB
    ? azimuthBetween(state.startPoint, state.startB)
    : null;
  $('#start-b-az-display').textContent = startBResolved !== null
    ? formatDms(startBResolved)
    : '— (需填 A 和 B 坐标)';

  const startManual = $('#start-az-dms-row').parentElement;
  startManual.classList.toggle('auto-override', state.startBMode);

  $('#end-name').value = state.endPoint.name;
  $('#end-x').value = state.endPoint.x;
  $('#end-y').value = state.endPoint.y;
  $('#end-az-d').value = state.endAzimuth.d;
  $('#end-az-m').value = state.endAzimuth.m;
  $('#end-az-s').value = state.endAzimuth.s;
  $('#end-az-decimal').value = state.endAzDecimal;

  const isEndDms = state.endAzMode === 'dms';
  $('#end-az-dms-row').hidden = !isEndDms;
  $('#end-az-decimal').hidden = isEndDms;
  $('#btn-toggle-end-decimal').classList.toggle('active', !isEndDms);
  $('#btn-toggle-end-decimal').textContent = isEndDms ? '⇄ 十进制' : '⇄ 度分秒';

  $('#end-reverse-panel').hidden = !state.endCMode;
  $('#btn-toggle-end-reverse').classList.toggle('active', state.endCMode);
  if (state.endC) {
    $('#end-c-name').value = state.endC.name;
    $('#end-c-x').value   = state.endC.x;
    $('#end-c-y').value   = state.endC.y;
  }
  const endCResolved = state.endCMode && state.endC
    ? azimuthBetween(state.endC, state.endPoint)
    : null;
  $('#end-c-az-display').textContent = endCResolved !== null
    ? formatDms(endCResolved)
    : '— (需填 C 和 D 坐标)';

  const endManual = $('#end-az-dms-row').parentElement;
  endManual.classList.toggle('auto-override', state.endCMode);

  $('#k-limit-select').value = String(state.kLimit);
  $(`input[name="angle-type"][value="${state.angleType}"]`).checked = true;
  $('#integer-mode-toggle').checked = !!state.integerMode;

  const n = state.stations.length;
  $('#fbeta-limit-hint').textContent = `自动: ±40″·√${n} = ±${(40 * Math.sqrt(n)).toFixed(1)}″`;

  // 测站角度表（点号 + β，不含边长）
  const stationsBody = $('#stations-body');
  stationsBody.innerHTML = '';
  state.stations.forEach((s, i) => {
    const tr = el('tr');
    tr.append(
      el('td', {}, el('input', { type: 'text', value: s.name, maxlength: 4, 'data-i': i, 'data-f': 'name', class: 'cell-name' })),
      el('td', {}, el('input', { type: 'number', value: s.deg, 'data-i': i, 'data-f': 'deg', class: 'cell-dms', inputmode: 'numeric' })),
      el('td', {}, el('input', { type: 'number', value: s.min, 'data-i': i, 'data-f': 'min', class: 'cell-dms', inputmode: 'numeric' })),
      el('td', {}, el('input', { type: 'number', value: s.sec, step: '0.01', 'data-i': i, 'data-f': 'sec', class: 'cell-dms', inputmode: 'decimal' })),
      el('td', { class: 'cell-actions' }, el('button', { class: 'btn-del', 'data-i': i, title: '删除该行' }, '×'))
    );
    stationsBody.appendChild(tr);
  });

  // 边长表（独立表：每条边 = 一行；标签只读，距离可输入）
  const distBody = $('#distances-body');
  distBody.innerHTML = '';
  state.stations.forEach((s, i) => {
    const tr = el('tr');
    tr.append(
      el('td', { class: 'seg-label', 'data-i': i }, sideLabel(i)),
      el('td', {}, el('input', {
        type: 'number', value: s.distance, step: '0.001',
        'data-i': i, 'data-f': 'distance', class: 'cell-dist', inputmode: 'decimal'
      }))
    );
    distBody.appendChild(tr);
  });
}

// ─────────────────────────────────────────────
// 输出区：从 lastResult 渲染
// ─────────────────────────────────────────────
function renderResult() {
  const tbody = $('#result-body');
  tbody.innerHTML = '';

  if (!lastResult) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty">请填写完整数据后点「🚀 计算」</td></tr>';
    $('#fbeta').textContent = '—';
    $('#fbeta').className = '';
    $('#fx').textContent = '—';
    $('#fy').textContent = '—';
    $('#fs').textContent = '—';
    $('#k').textContent = '—';
    $('#k').className = '';
    $('#warning-bar').hidden = true;
    return;
  }

  const c = lastResult.closure;
  tbody.appendChild(buildResultRow({
    name: state.startPoint.name + ' (起)',
    betaRaw: null,
    betaAdj: null,
    az: resolveStartAz(),
    dist: '',
    vx: '', vy: '', dx: '', dy: '',
    x: state.startPoint.x,
    y: state.startPoint.y,
    isStart: true
  }));

  lastResult.adjustedAngles.forEach((a, i) => {
    const inc = lastResult.increments[i];
    const coord = lastResult.coordinates[i + 1];
    tbody.appendChild(buildResultRow({
      name: a.name,
      betaRaw: a.original,
      betaAdj: a.adjusted,
      vBeta: a.correction,
      az: lastResult.azimuths[i],
      dist: inc.distance,
      dx: inc.dx,
      dy: inc.dy,
      vx: inc.vx,
      vy: inc.vy,
      adjDx: inc.adjustedDx,
      adjDy: inc.adjustedDy,
      x: coord.x,
      y: coord.y,
      isStart: false
    }));
  });

  $('#fbeta').textContent = formatSeconds(c.fBeta);
  $('#fbeta').className = c.fBetaOver ? 'over' : 'ok';
  $('#fbeta-limit').textContent = `±${c.fBetaLimit.toFixed(1)}″`;
  $('#fx').textContent = c.fx.toFixed(4) + ' m';
  $('#fy').textContent = c.fy.toFixed(4) + ' m';
  $('#fs').textContent = c.fs.toFixed(4) + ' m';
  const kText = c.k > 0 ? `1/${Math.round(1 / c.k).toLocaleString()}` : '∞';
  $('#k').textContent = kText;
  $('#k').className = c.kOver ? 'over' : 'ok';
  $('#k-limit-display').textContent = `1/${state.kLimit.toLocaleString()}`;

  const warnings = [];
  if (c.fBetaOver) warnings.push(`⚠ 角度闭合差 ${formatSeconds(c.fBeta)} 超过限差 ±${c.fBetaLimit.toFixed(1)}″`);
  if (c.kOver) warnings.push(`⚠ 全长相对闭合差 K=${kText} 超过限差 1/${state.kLimit.toLocaleString()}`);
  if (warnings.length) {
    $('#warning-bar').textContent = warnings.join('  ·  ');
    $('#warning-bar').hidden = false;
  } else {
    $('#warning-bar').hidden = true;
  }
}

function buildResultRow(r) {
  const tr = el('tr', { class: r.isStart ? 'row-start' : '' });
  if (r.isStart) {
    tr.append(
      el('td', { class: 'col-name' }, r.name),
      el('td', { colspan: 4, class: 'col-meta' }, `起始点 (α=${formatDms(r.az)})`),
      el('td', { class: 'col-num' }, '—'),
      el('td', { class: 'col-num' }, '—'),
      el('td', { class: 'col-num' }, '—'),
      el('td', { class: 'col-num' }, '—'),
      el('td', { class: 'col-num' }, '—'),
      el('td', { class: 'col-num' }, '—'),
      el('td', { class: 'col-num' }, '—'),
      el('td', { class: 'col-num' }, r.x.toFixed(3)),
      el('td', { class: 'col-num' }, r.y.toFixed(3))
    );
  } else {
    // v_β：整数模式 → 整秒；小数模式 → 1 位小数
    const vBetaText = formatSigned(r.vBeta, state.integerMode ? 0 : 1);
    // vx/vy：整数模式 → 3 位小数（mm）；小数模式 → 4 位
    const corrDec = state.integerMode ? 3 : 4;
    tr.append(
      el('td', { class: 'col-name' }, r.name),
      el('td', { class: 'col-dms' }, formatDms(r.betaRaw)),
      el('td', { class: 'col-num vbeta' }, vBetaText),
      el('td', { class: 'col-dms' }, formatDms(r.betaAdj)),
      el('td', { class: 'col-dms' }, formatDms(r.az)),
      el('td', { class: 'col-num' }, r.dist.toFixed(3)),
      el('td', { class: 'col-num small' }, formatSigned(r.dx, 3)),
      el('td', { class: 'col-num small' }, formatSigned(r.dy, 3)),
      el('td', { class: 'col-num small' }, formatSigned(r.vx, corrDec)),
      el('td', { class: 'col-num small' }, formatSigned(r.vy, corrDec)),
      el('td', { class: 'col-num' }, formatSigned(r.adjDx, 3)),
      el('td', { class: 'col-num' }, formatSigned(r.adjDy, 3)),
      el('td', { class: 'col-num' }, r.x.toFixed(3)),
      el('td', { class: 'col-num' }, r.y.toFixed(3))
    );
  }
  return tr;
}

function renderSketch() {
  const canvas = $('#sketch');
  if (!canvas) return;
  if (!lastResult || !lastResult.coordinates) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  drawTraverse(canvas, lastResult.coordinates, {
    isClosed: state.mode === 'closed',
    startName: state.startPoint.name
  });
}

function render() {
  renderInputs();
  renderDerived();
  renderResult();
  renderSketch();
  updateComputeButton();
}

// 只更新「派生显示」（限差提示、边长 label、α 反算），不动 input DOM → 保留焦点 / 光标
function renderDerived() {
  // 限差提示（依赖测站数）
  const n = state.stations.length;
  $('#fbeta-limit-hint').textContent = `自动: ±40″·√${n} = ±${(40 * Math.sqrt(n)).toFixed(1)}″`;

  // 边长表 label（按行 index 更新 textContent）
  for (let i = 0; i < n; i++) {
    const cell = document.querySelector(`#distances-body .seg-label[data-i="${i}"]`);
    if (cell) cell.textContent = sideLabel(i);
  }

  // 起算方位角反算显示
  if (state.startBMode) {
    const az = state.startB
      ? azimuthBetween(state.startPoint, state.startB)
      : null;
    $('#start-b-az-display').textContent = az !== null
      ? formatDms(az)
      : '— (需填 A 和 B 坐标)';
  }

  // 终止方位角反算显示
  if (state.endCMode) {
    const az = state.endC
      ? azimuthBetween(state.endC, state.endPoint)
      : null;
    $('#end-c-az-display').textContent = az !== null
      ? formatDms(az)
      : '— (需填 C 和 D 坐标)';
  }
}

// ─────────────────────────────────────────────
// 输入绑定
// ─────────────────────────────────────────────
function bindEvents() {
  // 模式
  $('#mode-closed').addEventListener('click', () => { state.mode = 'closed'; render(); });
  $('#mode-attached').addEventListener('click', () => { state.mode = 'attached'; render(); });

  // 起算
  $('#start-name').addEventListener('input', e => { state.startPoint.name = e.target.value; markDirty(); });
  $('#start-x').addEventListener('input', e => { state.startPoint.x = num(e.target.value); markDirty(); });
  $('#start-y').addEventListener('input', e => { state.startPoint.y = num(e.target.value); markDirty(); });
  bindDms('#start-az', state.startAzimuth);
  $('#start-az-decimal').addEventListener('input', e => {
    state.startAzDecimal = num(e.target.value);
    markDirty();
  });
  $('#btn-toggle-start-decimal').addEventListener('click', () => {
    if (state.startAzMode === 'dms') {
      state.startAzDecimal = dmsToDecimal(state.startAzimuth.d, state.startAzimuth.m, state.startAzimuth.s);
      state.startAzMode = 'decimal';
    } else {
      const d = decimalToDms(state.startAzDecimal);
      state.startAzimuth = { d: d.deg, m: d.min, s: d.sec };
      state.startAzMode = 'dms';
    }
    render();
  });
  $('#btn-toggle-start-reverse').addEventListener('click', () => {
    state.startBMode = !state.startBMode;
    if (state.startBMode && !state.startB) {
      const az = dmsToDecimal(state.startAzimuth.d, state.startAzimuth.m, state.startAzimuth.s);
      state.startB = {
        name: 'B',
        x: state.startPoint.x + 100 * Math.cos(az * DEG),
        y: state.startPoint.y + 100 * Math.sin(az * DEG)
      };
    }
    render();
  });
  $('#start-b-name').addEventListener('input', e => {
    if (!state.startB) state.startB = { name: '', x: 0, y: 0 };
    state.startB.name = e.target.value;
    markDirty();
  });
  $('#start-b-x').addEventListener('input', e => {
    if (!state.startB) state.startB = { name: 'B', x: 0, y: 0 };
    state.startB.x = num(e.target.value);
    markDirty();
  });
  $('#start-b-y').addEventListener('input', e => {
    if (!state.startB) state.startB = { name: 'B', x: 0, y: 0 };
    state.startB.y = num(e.target.value);
    markDirty();
  });

  $('#end-name').addEventListener('input', e => { state.endPoint.name = e.target.value; markDirty(); });
  $('#end-x').addEventListener('input', e => { state.endPoint.x = num(e.target.value); markDirty(); });
  $('#end-y').addEventListener('input', e => { state.endPoint.y = num(e.target.value); markDirty(); });
  bindDms('#end-az', state.endAzimuth);
  $('#end-az-decimal').addEventListener('input', e => {
    state.endAzDecimal = num(e.target.value);
    markDirty();
  });
  $('#btn-toggle-end-decimal').addEventListener('click', () => {
    if (state.endAzMode === 'dms') {
      state.endAzDecimal = dmsToDecimal(state.endAzimuth.d, state.endAzimuth.m, state.endAzimuth.s);
      state.endAzMode = 'decimal';
    } else {
      const d = decimalToDms(state.endAzDecimal);
      state.endAzimuth = { d: d.deg, m: d.min, s: d.sec };
      state.endAzMode = 'dms';
    }
    render();
  });
  $('#btn-toggle-end-reverse').addEventListener('click', () => {
    state.endCMode = !state.endCMode;
    if (state.endCMode && !state.endC) {
      const az = dmsToDecimal(state.endAzimuth.d, state.endAzimuth.m, state.endAzimuth.s);
      state.endC = {
        name: 'C',
        x: state.endPoint.x - 100 * Math.cos(az * DEG),
        y: state.endPoint.y - 100 * Math.sin(az * DEG)
      };
    }
    render();
  });
  $('#end-c-name').addEventListener('input', e => {
    if (!state.endC) state.endC = { name: '', x: 0, y: 0 };
    state.endC.name = e.target.value;
    markDirty();
  });
  $('#end-c-x').addEventListener('input', e => {
    if (!state.endC) state.endC = { name: 'C', x: 0, y: 0 };
    state.endC.x = num(e.target.value);
    markDirty();
  });
  $('#end-c-y').addEventListener('input', e => {
    if (!state.endC) state.endC = { name: 'C', x: 0, y: 0 };
    state.endC.y = num(e.target.value);
    markDirty();
  });

  // 限差
  $('#k-limit-select').addEventListener('change', e => { state.kLimit = num(e.target.value, 2000); markDirty(); });
  $$('input[name="angle-type"]').forEach(r => {
    r.addEventListener('change', e => { state.angleType = e.target.value; markDirty(); });
  });
  $('#integer-mode-toggle').addEventListener('change', e => {
    state.integerMode = e.target.checked;
    markDirty();
  });

  // 测站角度表（事件委托）
  const stationsBody = $('#stations-body');
  stationsBody.addEventListener('input', e => {
    const t = e.target;
    const i = num(t.dataset.i);
    const f = t.dataset.f;
    if (i < 0 || i >= state.stations.length) return;
    if (f === 'name') state.stations[i].name = t.value;
    else if (f === 'deg' || f === 'min' || f === 'sec') state.stations[i][f] = num(t.value);
    markDirty();
  });
  stationsBody.addEventListener('click', e => {
    if (e.target.classList.contains('btn-del')) {
      const i = num(e.target.dataset.i);
      if (state.stations.length <= 3) {
        alert('闭合导线至少需要 3 个测站');
        return;
      }
      state.stations.splice(i, 1);
      render();
    }
  });

  // 边长表（事件委托）
  const distBody = $('#distances-body');
  distBody.addEventListener('input', e => {
    const t = e.target;
    const i = num(t.dataset.i);
    if (i < 0 || i >= state.stations.length) return;
    if (t.dataset.f === 'distance') {
      state.stations[i].distance = num(t.value);
      markDirty();
    }
  });

  $('#btn-add-row').addEventListener('click', () => {
    const last = state.stations[state.stations.length - 1];
    const next = String.fromCharCode('A'.charCodeAt(0) + state.stations.length);
    state.stations.push({ name: next, deg: 0, min: 0, sec: 0, distance: last ? last.distance : 100 });
    render();
  });

  // 「🚀 计算」按钮
  $('#btn-compute').addEventListener('click', runCompute);

  // 顶部按钮
  $('#btn-new').addEventListener('click', () => {
    if (confirm('新建空白方案？当前数据会保留为草稿。')) {
      currentProjectId = null;
      state = defaultState();
      stateDirty = false;
      recompute();
    }
  });
  $('#btn-save').addEventListener('click', () => {
    const name = prompt('方案名称', currentProjectId ? ($('#saved-list li.active')?.textContent || '未命名') : '未命名');
    if (!name) return;
    const id = currentProjectId || newProjectId();
    saveProject({ id, name, state: JSON.parse(JSON.stringify(state)) });
    currentProjectId = id;
    stateDirty = false;
    alert('已保存');
    updateComputeButton();
  });
  $('#btn-load').addEventListener('click', openLoadModal);
  $('#btn-export').addEventListener('click', openExportModal);
  $('#btn-help').addEventListener('click', openHelpModal);

  // 模态关闭
  $$('.modal-close, .modal-backdrop').forEach(el => {
    el.addEventListener('click', closeModals);
  });
}

function bindDms(prefix, target) {
  const dEl = $(`${prefix}-d`);
  const mEl = $(`${prefix}-m`);
  const sEl = $(`${prefix}-s`);
  [dEl, mEl, sEl].forEach((e, i) => {
    const key = ['d', 'm', 's'][i];
    e.addEventListener('input', () => {
      target[key] = num(e.value);
      markDirty();
    });
  });
}

// ─────────────────────────────────────────────
// 模态
// ─────────────────────────────────────────────
function openLoadModal() {
  const list = listProjects();
  const ul = $('#saved-list');
  ul.innerHTML = '';
  if (list.length === 0) {
    ul.innerHTML = '<li class="empty">尚无已保存方案</li>';
  } else {
    list.forEach(p => {
      const li = el('li', {},
        el('div', { class: 'proj-info' },
          el('b', {}, p.name),
          el('small', {}, `${p.state.mode === 'closed' ? '闭合' : '附合'} · ${p.state.stations.length} 站 · ${new Date(p.updatedAt).toLocaleString()}`)
        ),
        el('div', { class: 'proj-actions' },
          el('button', { class: 'btn-load', 'data-id': p.id }, '载入'),
          el('button', { class: 'btn-del',  'data-id': p.id }, '删除')
        )
      );
      ul.appendChild(li);
    });
    ul.querySelectorAll('.btn-load').forEach(b => {
      b.addEventListener('click', () => {
        const p = getProject(b.dataset.id);
        if (p) {
          currentProjectId = p.id;
          state = JSON.parse(JSON.stringify(p.state));
          stateDirty = false;
          closeModals();
          recompute();
        }
      });
    });
    ul.querySelectorAll('.btn-del').forEach(b => {
      b.addEventListener('click', () => {
        if (confirm('删除该方案？')) {
          deleteProject(b.dataset.id);
          openLoadModal();
        }
      });
    });
  }
  $('#modal-load').hidden = false;
}

function openExportModal() {
  $('#modal-export').hidden = false;
  $('#btn-copy-tsv').onclick = copyAsTsv;
  $('#btn-export-png').onclick = exportPng;
  $('#btn-export-json').onclick = exportJson;
  $('#btn-import-json').onclick = importJson;
}

function openHelpModal() {
  $('#modal-help').hidden = false;
}

function closeModals() {
  $$('.modal').forEach(m => m.hidden = true);
}

// ─────────────────────────────────────────────
// 导出
// ─────────────────────────────────────────────
function buildTsv() {
  if (!lastResult) return '';
  const headers = ['点名', '观测角', 'v_β', '改正后角值', '方位角', '边长', "X'", "Y'", 'vx', 'vy', 'ΔX', 'ΔY', 'X', 'Y'];
  const lines = [headers.join('\t')];
  // 起始点行：屏幕上是「起始点 (α=...)」一格跨 5 列（点+角度组 4 列），TSV 无 colspan 展开成 12 个 cell
  // 角组 4 列空，v_β/改正后/方位角 都为空，az 内嵌在「点名」cell 文本
  const startAz = formatDms(resolveStartAz());
  lines.push([
    `${state.startPoint.name}(起) (α=${startAz})`,
    '', '', '', '',                       // 观测角 / v_β / 改正后 / 方位角
    '', '', '', '', '', '', '',           // 边长 / X' / Y' / vx / vy / ΔX / ΔY
    state.startPoint.x.toFixed(3), state.startPoint.y.toFixed(3)
  ].join('\t'));
  // 跟屏幕一致：整数模式 v_β 整秒、vx/vy 3 位（1mm）；小数模式 v_β 1 位、vx/vy 4 位
  const vBetaDec = state.integerMode ? 0 : 1;
  const corrDec = state.integerMode ? 3 : 4;
  lastResult.adjustedAngles.forEach((a, i) => {
    const inc = lastResult.increments[i];
    const c = lastResult.coordinates[i + 1];
    lines.push([
      a.name,
      formatDms(a.original),
      formatSigned(a.vBeta, vBetaDec),
      formatDms(a.adjusted),
      formatDms(lastResult.azimuths[i]),
      inc.distance.toFixed(3),
      inc.dx.toFixed(3),
      inc.dy.toFixed(3),
      formatSigned(inc.vx, corrDec),
      formatSigned(inc.vy, corrDec),
      inc.adjustedDx.toFixed(3),
      inc.adjustedDy.toFixed(3),
      c.x.toFixed(3),
      c.y.toFixed(3)
    ].join('\t'));
  });
  const c = lastResult.closure;
  const kText = c.k > 0 ? `1/${Math.round(1 / c.k)}` : '∞';
  const modeNote = state.integerMode ? ' [整数修正模式]' : '';
  lines.push('');
  lines.push(`fβ\t${formatSeconds(c.fBeta)}\tfβ允\t±${c.fBetaLimit.toFixed(1)}″\tfx\t${c.fx.toFixed(4)}\tfy\t${c.fy.toFixed(4)}\tfs\t${c.fs.toFixed(4)}\tK\t${kText}${modeNote}`);
  return lines.join('\n');
}

async function copyAsTsv() {
  const tsv = buildTsv();
  if (!tsv) { alert('暂无可导出的结果'); return; }
  try {
    await navigator.clipboard.writeText(tsv);
    alert('已复制到剪贴板，可粘到 Excel');
  } catch (e) {
    const ta = document.createElement('textarea');
    ta.value = tsv;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    alert('已复制（fallback）');
  }
}

function exportPng() {
  if (!lastResult) { alert('暂无可导出的结果'); return; }
  const W = 1200, rowH = 28, headH = 36, footH = 60;
  const rows = lastResult.adjustedAngles.length + 2;
  const H = headH + rows * rowH + footH;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0f172a'; ctx.font = 'bold 14px -apple-system, sans-serif';

  const cols = ['点', '观测角', 'v_β', '改正后', '方位角', '边长', "X'", "Y'", 'vx', 'vy', 'ΔX', 'ΔY', 'X', 'Y'];
  const colW = (W - 24) / cols.length;
  const vBetaDec = state.integerMode ? 0 : 1;
  const corrDec = state.integerMode ? 3 : 4;
  const draw = (txt, x, y, w, align = 'center', bold = false) => {
    ctx.font = `${bold ? 'bold ' : ''}${bold ? 14 : 13}px -apple-system, sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(txt, x + (align === 'center' ? w / 2 : 4), y);
  };
  ctx.fillStyle = '#0f766e'; ctx.fillRect(0, 0, W, headH);
  ctx.fillStyle = '#fff';
  cols.forEach((h, i) => draw(h, 12 + i * colW, headH / 2, colW, 'center', true));
  let y = headH;
  ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, y, W, rowH);
  ctx.fillStyle = '#0f172a';
  // 起始点行：屏幕是 起始点(α=...) 跨 col 0-4，PNG 展开成 12 个 cell，az 内嵌在 col 0 文本
  draw(`${state.startPoint.name}(起) (α=${formatDms(resolveStartAz())})`, 12, y + rowH / 2, 5 * colW, 'center', true);
  for (let k = 1; k <= 4; k++) draw('', 12 + k * colW, y + rowH / 2, colW);
  for (let k = 5; k <= 11; k++) draw('—', 12 + k * colW, y + rowH / 2, colW);
  draw(state.startPoint.x.toFixed(3), 12 + 12 * colW, y + rowH / 2, colW);
  draw(state.startPoint.y.toFixed(3), 12 + 13 * colW, y + rowH / 2, colW);
  y += rowH;

  lastResult.adjustedAngles.forEach((a, i) => {
    const inc = lastResult.increments[i];
    const coord = lastResult.coordinates[i + 1];
    if (i % 2 === 0) { ctx.fillStyle = '#f8fafc'; ctx.fillRect(0, y, W, rowH); }
    ctx.fillStyle = '#0f172a';
    draw(a.name, 12, y + rowH / 2, colW);
    draw(formatDms(a.original), 12 + colW, y + rowH / 2, colW);
    draw(formatSigned(a.vBeta, vBetaDec), 12 + 2 * colW, y + rowH / 2, colW);
    draw(formatDms(a.adjusted), 12 + 3 * colW, y + rowH / 2, colW);
    draw(formatDms(lastResult.azimuths[i]), 12 + 4 * colW, y + rowH / 2, colW);
    draw(inc.distance.toFixed(3), 12 + 5 * colW, y + rowH / 2, colW);
    draw(inc.dx.toFixed(3), 12 + 6 * colW, y + rowH / 2, colW);
    draw(inc.dy.toFixed(3), 12 + 7 * colW, y + rowH / 2, colW);
    draw(formatSigned(inc.vx, corrDec), 12 + 8 * colW, y + rowH / 2, colW);
    draw(formatSigned(inc.vy, corrDec), 12 + 9 * colW, y + rowH / 2, colW);
    draw(inc.adjustedDx.toFixed(3), 12 + 10 * colW, y + rowH / 2, colW);
    draw(inc.adjustedDy.toFixed(3), 12 + 11 * colW, y + rowH / 2, colW);
    draw(coord.x.toFixed(3), 12 + 12 * colW, y + rowH / 2, colW);
    draw(coord.y.toFixed(3), 12 + 13 * colW, y + rowH / 2, colW);
    y += rowH;
  });

  ctx.fillStyle = '#fef3c7'; ctx.fillRect(0, y, W, footH);
  ctx.fillStyle = '#92400e'; ctx.font = 'bold 14px -apple-system, sans-serif';
  const cl = lastResult.closure;
  const kText = cl.k > 0 ? `1/${Math.round(1 / cl.k)}` : '∞';
  const modeNote = state.integerMode ? '  ｜ 整数修正模式' : '';
  ctx.fillText(`fβ=${formatSeconds(cl.fBeta)} (±${cl.fBetaLimit.toFixed(1)}″)  fx=${cl.fx.toFixed(4)}  fy=${cl.fy.toFixed(4)}  fs=${cl.fs.toFixed(4)}  K=${kText}${modeNote}`, 12, y + 22);
  ctx.fillText(cl.fBetaOver || cl.kOver ? '❌ 超限（仍给出平差结果）' : '✅ 满足限差', 12, y + 44);

  c.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `导线平差_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function exportJson() {
  const data = {
    name: '导线平差方案',
    exportedAt: new Date().toISOString(),
    state: state,
    result: lastResult
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `导线平差_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importJson() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = () => {
    const f = inp.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (data.state) {
          state = data.state;
          currentProjectId = null;
          stateDirty = false;
          closeModals();
          recompute();
        }
      } catch (e) {
        alert('JSON 解析失败: ' + e.message);
      }
    };
    r.readAsText(f);
  };
  inp.click();
}

// ─────────────────────────────────────────────
// 启动
// ─────────────────────────────────────────────
function init() {
  const draft = loadDraft();
  if (draft && draft.state && Array.isArray(draft.state.stations) && draft.state.stations.length >= 3) {
    state = draft.state;
  }
  bindEvents();
  // 首次主动算一次，让结果区先有内容
  runCompute();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// 注册 Service Worker（离线缓存）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW 注册失败', err);
    });
  });
}
