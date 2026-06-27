// 控制器：状态管理 + 渲染 + 导入导出 + 方案管理
// 计算是「按按钮触发」模式（不实时重算）；改输入只 markDirty + 渲染反算显示
// 依赖：dms.js, traverse.js, storage.js, sketch.js

import { dmsToDecimal, decimalToDms, formatDms, formatSeconds, azimuthBetween, normalize360, DEG } from './dms.js';
import { calcClosedTraverse, calcAttachedTraverse } from './traverse.js';
import {
  saveProject, listProjects, getProject, deleteProject, newProjectId,
  saveDraft, loadDraft, migrateState
} from './storage.js';
import { drawTraverse } from './sketch.js';
import { Plotter } from './plotter.js';
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
    roundedMode: false,
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
    const az = azimuthBetween(state.startB, state.startPoint);
    if (az !== null) return az;
  }
  if (state.startAzMode === 'decimal') return state.startAzDecimal;
  return dmsToDecimal(state.startAzimuth.d, state.startAzimuth.m, state.startAzimuth.s);
}

function resolveEndAz() {
  if (state.endCMode && state.endC) {
    const az = azimuthBetween(state.endPoint, state.endC);
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
    let startAzDec = resolveStartAz();
    let stationsList = JSON.parse(JSON.stringify(state.stations));
    let convertedModel = false;

    // 用户模型 -> 算法模型转换
    // 如果首站名等于起算点名，说明用户给的 startAzimuth 是“后视方位角”，且角度对应的是测站本身
    // 算法需要的是“第一条边方位角”，且角度对应边终点
    if (stationsList.length >= 3 && stationsList[0].name.trim() && stationsList[0].name.trim() === state.startPoint.name.trim()) {
      convertedModel = true;
    }

    const params = {
      startPoint: state.startPoint,
      startAzimuth: startAzDec,
      angleType: state.angleType,
      stations: stationsList,
      kLimit: 1 / state.kLimit,
      integerMode: state.integerMode,
      roundedMode: state.roundedMode,
      isStartPointMatching: convertedModel
    };

    if (state.mode === 'attached') {
      params.endPoint = state.endPoint;
      params.endAzimuth = resolveEndAz();
      lastResult = calcAttachedTraverse(params);
    } else {
      lastResult = calcClosedTraverse(params);
    }

    if (lastResult) {
      lastResult.convertedModel = convertedModel;
      lastResult.originalStations = state.stations; // 保留原始用户输入供渲染表格用
      lastResult.sourceMode = state.mode;           // 记录来源模式
      lastResult.stationCount = state.stations.length;
      if (convertedModel) {
        lastResult.originalStartAz = resolveStartAz();
      }
    }

  } catch (e) {
    console.warn('计算失败:', e);
    lastResult = null;
  }
  render();
}

// 输入被改 → 标脏 + 存草稿 + 渲染派生显示（不重算、不重建 input → 保留焦点 / 光标）
let _draftTimer = null;
function markDirty() {
  stateDirty = true;
  // debounce saveDraft，减少 localStorage 写入频率
  clearTimeout(_draftTimer);
  _draftTimer = setTimeout(() => saveDraft(state), 500);
  renderDerived();
  updateComputeButton();
}

// 点「🚀 计算」 → 立即算一次
function runCompute() {
  stateDirty = false;
  recompute();
}

// 计算按钮的视觉状态
let currentPage = 'calc';  // 'calc' | 'plotter'
let plotter = null;         // Plotter 实例
let importedResultId = null;  // 已导入的平差结果标识，避免重复覆盖

function updateComputeButton() {
  const btn = $('#btn-compute');
  const bar = btn?.closest('.compute-bar');
  if (!btn) return;
  // 绘图模式下隐藏计算按钮
  if (bar) bar.hidden = currentPage === 'plotter';
  if (stateDirty) {
    btn.classList.add('dirty');
    btn.innerHTML = '<span class="dot"></span>已修改 · 点此重算';
  } else {
    btn.classList.remove('dirty');
    btn.textContent = '🚀 计算';
  }
}

function switchPage(page) {
  currentPage = page;
  const pageCalc = $('#page-calc');
  const pagePlotter = $('#page-plotter');
  if (pageCalc) pageCalc.hidden = page !== 'calc';
  if (pagePlotter) pagePlotter.hidden = page !== 'plotter';

  if (page === 'plotter') {
    initPlotter();
  }
  updateComputeButton();
}

function initPlotter() {
  const canvas = $('#plotter-canvas');
  if (!canvas) return;
  if (!plotter) {
    plotter = new Plotter(canvas);
  }
  // 如果当前有计算坐标，进行智能比对与同步
  if (lastResult && lastResult.coordinates) {
    let needUpdate = false;
    const currentCoords = plotter.controlPoints;
    const newCoords = lastResult.coordinates;
    
    // 过滤掉闭合导线首尾重复点来进行长度对比
    const seen = new Set();
    const uniqueNewCoords = newCoords.filter(p => {
      const key = `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    
    if (currentCoords.length === 0) {
      needUpdate = true;
    } else if (currentCoords.length !== uniqueNewCoords.length) {
      needUpdate = true;
    } else {
      for (let i = 0; i < uniqueNewCoords.length; i++) {
        const cc = currentCoords[i];
        const nc = uniqueNewCoords[i];
        if (!cc || cc.name !== nc.name || Math.abs(cc.x - nc.x) > 1e-4 || Math.abs(cc.y - nc.y) > 1e-4) {
          needUpdate = true;
          break;
        }
      }
    }
    
    if (needUpdate) {
      importControlPoints();
    }
  }
  renderControlSource();
  renderPointList();
  plotter.render();
}

/** 从当前 lastResult 导入控制点到绘图器 */
function importControlPoints() {
  if (!plotter || !lastResult || !lastResult.coordinates) return;
  plotter.setControlPoints(lastResult.coordinates);
  // 记录导入来源
  importedResultId = {
    mode: lastResult.sourceMode || state.mode,
    stationCount: lastResult.stationCount || lastResult.coordinates.length,
    time: Date.now()
  };
  renderControlSource();
  renderPointList();
}

/** 渲染控制点来源信息 */
function renderControlSource() {
  const el = $('#control-source');
  if (!el) return;

  if (!plotter || plotter.controlPoints.length === 0) {
    el.innerHTML = '<span class="hint">尚未导入控制点 — 请先在闭合/附合导线页面完成计算</span>';
    return;
  }

  const modeText = importedResultId?.mode === 'attached' ? '附合导线' : '闭合导线';
  const count = plotter.controlPoints.length;
  const hasNewer = lastResult && lastResult.coordinates &&
    importedResultId && lastResult.sourceMode !== importedResultId.mode;

  let html = `<span class="source-badge">${modeText}</span> `;
  html += `<span class="hint">${count} 个控制点`;
  if (importedResultId?.time) {
    const t = new Date(importedResultId.time);
    html += ` · 导入于 ${t.getHours().toString().padStart(2,'0')}:${t.getMinutes().toString().padStart(2,'0')}`;
  }
  html += '</span>';

  if (hasNewer) {
    const newerMode = lastResult.sourceMode === 'attached' ? '附合导线' : '闭合导线';
    html += ` <span class="hint" style="color:var(--warn)">⚠️ ${newerMode}有新的计算结果</span>`;
  }

  el.innerHTML = html;
}

function renderPointList() {
  const list = $('#point-list');
  const countEl = $('#point-count');
  if (!list || !plotter) return;

  const controls = plotter.controlPoints;
  const details = plotter.detailPoints;
  const total = controls.length + details.length;

  if (countEl) countEl.textContent = total > 0 ? `(${total} 个)` : '';

  if (total === 0) {
    list.innerHTML = '<div class="empty-hint">暂无点位，请先计算导线或手动添加</div>';
    return;
  }

  list.innerHTML = '';

  // 控制点
  for (const p of controls) {
    const item = el('div', { class: 'point-item' },
      el('div', { class: 'point-info' },
        el('span', { class: 'point-name control' }, p.name),
        el('span', { class: 'point-coord' }, `X=${p.x.toFixed(3)}, Y=${p.y.toFixed(3)}`),
        el('span', { class: 'point-type control' }, '控制点')
      )
    );
    list.appendChild(item);
  }

  // 细部点
  for (const p of details) {
    const delBtn = el('button', { class: 'btn-del-point', onclick: () => {
      plotter.removeDetailPoint(p.name);
      renderPointList();
    }}, '✕');
    const item = el('div', { class: 'point-item' },
      el('div', { class: 'point-info' },
        el('span', { class: 'point-name detail' }, p.name),
        el('span', { class: 'point-coord' }, `X=${p.x.toFixed(3)}, Y=${p.y.toFixed(3)}`),
        el('span', { class: 'point-type detail' }, '细部点')
      ),
      delBtn
    );
    list.appendChild(item);
  }
}

function updateDrawingUI() {
  if (!plotter) return;
  const isDrawing = plotter.drawingMode;
  const canvas = $('#plotter-canvas');
  const drawBtn = $('#plotter-draw');
  const closeBtn = $('#plotter-close-poly');
  const finishBtn = $('#plotter-finish-poly');
  const undoSegBtn = $('#plotter-undo-seg');

  if (canvas) canvas.classList.toggle('drawing-mode', isDrawing);
  if (drawBtn) drawBtn.classList.toggle('active', isDrawing);
  if (closeBtn) closeBtn.disabled = !isDrawing || !plotter.currentPoly || plotter.currentPoly.length < 3;
  if (finishBtn) finishBtn.disabled = !isDrawing || !plotter.currentPoly || plotter.currentPoly.length < 2;
  if (undoSegBtn) undoSegBtn.disabled = !isDrawing || !plotter.currentPoly || plotter.currentPoly.length === 0;

  // 连线模式指示器
  const wrap = document.querySelector('.plotter-canvas-wrap');
  let indicator = wrap?.querySelector('.drawing-indicator');
  if (isDrawing) {
    if (!indicator && wrap) {
      indicator = document.createElement('div');
      indicator.className = 'drawing-indicator';
      indicator.textContent = '✏️ 连线模式 — 点击画布上的点来连线';
      wrap.appendChild(indicator);
    }
  } else {
    if (indicator) indicator.remove();
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
  const isPlotter = currentPage === 'plotter';
  $('#mode-closed').classList.toggle('active', state.mode === 'closed' && !isPlotter);
  $('#mode-attached').classList.toggle('active', state.mode === 'attached' && !isPlotter);
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

  $('#start-manual-panel').hidden = state.startBMode;
  $('#start-reverse-panel').hidden = !state.startBMode;
  $$('input[name="start_source"]').forEach(r => {
    r.checked = (r.value === 'reverse' ? state.startBMode : !state.startBMode);
  });
  if (state.startB) {
    $('#start-b-name').value = state.startB.name;
    $('#start-b-x').value   = state.startB.x;
    $('#start-b-y').value   = state.startB.y;
  }
  const startBName = state.startB ? state.startB.name : 'B';
  const startPName = state.startPoint.name || 'A1';
  $('#start-az-name-display').textContent = `${startBName}${startPName}`;

  const startBResolved = state.startBMode && state.startB
    ? azimuthBetween(state.startB, state.startPoint)
    : null;
  $('#start-b-az-display').textContent = startBResolved !== null
    ? formatDms(startBResolved)
    : `— (需填 ${startBName} 和 ${startPName} 坐标)`;

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

  $('#end-manual-panel').hidden = state.endCMode;
  $('#end-reverse-panel').hidden = !state.endCMode;
  $$('input[name="end_source"]').forEach(r => {
    r.checked = (r.value === 'reverse' ? state.endCMode : !state.endCMode);
  });
  if (state.endC) {
    $('#end-c-name').value = state.endC.name;
    $('#end-c-x').value   = state.endC.x;
    $('#end-c-y').value   = state.endC.y;
  }
  const endCName = state.endC ? state.endC.name : 'C';
  const endPName = state.endPoint.name || 'D';
  $('#end-az-name-display').textContent = `${endPName}${endCName}`;

  const endCResolved = state.endCMode && state.endC
    ? azimuthBetween(state.endPoint, state.endC)
    : null;
  $('#end-c-az-display').textContent = endCResolved !== null
    ? formatDms(endCResolved)
    : `— (需填 ${endPName} 和 ${endCName} 坐标)`;

  $('#k-limit-select').value = String(state.kLimit);
  $(`input[name="angle-type"][value="${state.angleType}"]`).checked = true;
  $('#integer-mode-toggle').checked = !!state.integerMode;
  $('#rounded-mode-toggle').checked = !!state.roundedMode;

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
    tbody.innerHTML = '<tr><td colspan="14" class="empty">请填写完整数据后点「🚀 计算」</td></tr>';
    $('#sum-beta').textContent = '—';
    $('#sum-d').textContent = '—';
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

  let sumBeta = 0;
  lastResult.adjustedAngles.forEach(a => sumBeta += a.original);
  let sumD = 0;
  lastResult.increments.forEach(inc => sumD += inc.distance);
  let sumVx = 0, sumVy = 0, sumDx = 0, sumDy = 0;
  lastResult.increments.forEach(inc => { sumVx += inc.vx; sumVy += inc.vy; sumDx += inc.dx; sumDy += inc.dy; });

  $('#sum-beta').textContent = formatDms(sumBeta);
  $('#sum-d').textContent = sumD.toFixed(3) + ' m';
  $('#fbeta').textContent = formatSeconds(c.fBeta);
  $('#fbeta').className = c.fBetaOver ? 'over' : 'ok';
  $('#fbeta-limit').textContent = `±${c.fBetaLimit.toFixed(1)}″`;
  $('#fx').textContent = c.fx.toFixed(4) + ' m';
  $('#fy').textContent = c.fy.toFixed(4) + ' m';
  $('#fs').textContent = c.fs.toFixed(4) + ' m';
  let kText;
  if (c.k <= 0) {
    kText = '∞';
  } else if (c.k < 1e-6) {
    kText = '< 1/1,000,000';
  } else {
    kText = `1/${Math.round(1 / c.k).toLocaleString()}`;
  }
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

  // 渲染交错表格
  let currentStartAz = lastResult.convertedModel ? lastResult.originalStartAz : resolveStartAz();

  const isStartPointMatching = lastResult.convertedModel;

  if (isStartPointMatching) {
    // === 用户模型：首站就是起点 ===
    
    // 1. 渲染后视方位角边 (B -> A1)
    const startBName = state.startBMode ? (state.startB?.name || '已知点') : '已知点';
    tbody.appendChild(buildResultRow({
      type: 'edge',
      name: `${startBName} → ${state.startPoint.name}`,
      az: currentStartAz, dist: null, dx: null, dy: null, vx: null, vy: null, adjDx: null, adjDy: null
    }));

    for (let i = 0; i < lastResult.adjustedAngles.length; i++) {
      const a = lastResult.adjustedAngles[i];
      const inc = lastResult.increments[i];
      const coord = lastResult.coordinates[i];
      
      // 渲染点 (i=0 时为 A1，并带上初始坐标)
      tbody.appendChild(buildResultRow({
        type: 'point',
        name: a.name,
        betaRaw: a.original, vBeta: a.correction, betaAdj: a.adjusted,
        x: coord.x, y: coord.y
      }));

      // 渲染边
      let edgeName = '';
      if (i < lastResult.adjustedAngles.length - 1) {
        edgeName = `${a.name} → ${lastResult.adjustedAngles[i+1].name}`;
      } else {
        edgeName = `${a.name} → ${state.mode === 'closed' ? state.startPoint.name : state.endPoint.name}`;
      }
      
      tbody.appendChild(buildResultRow({
        type: 'edge',
        name: edgeName,
        az: lastResult.azimuths[i],
        dist: inc.distance, dx: inc.dx, dy: inc.dy, vx: inc.vx, vy: inc.vy, adjDx: inc.adjustedDx, adjDy: inc.adjustedDy
      }));
    }
    
    // 渲染闭合点
    const lastCoord = lastResult.coordinates[lastResult.coordinates.length - 1];
    tbody.appendChild(buildResultRow({
      type: 'point',
      name: state.mode === 'closed' ? state.startPoint.name : state.endPoint.name,
      betaRaw: null, vBeta: null, betaAdj: null,
      x: lastCoord.x, y: lastCoord.y
    }));
  } else {
    // === 旧模型 / 附合导线模型 ===
    
    // 首站点行 (无观测角)
    tbody.appendChild(buildResultRow({
      type: 'point',
      name: state.startPoint.name,
      betaRaw: null, betaAdj: null, vBeta: null,
      x: state.startPoint.x, y: state.startPoint.y
    }));

    if (state.mode === 'attached' && state.startBMode) {
      tbody.appendChild(buildResultRow({
        type: 'edge',
        name: `${state.startB?.name || '已知点'} → ${state.startPoint.name}`,
        az: currentStartAz, dist: null, dx: null, dy: null, vx: null, vy: null, adjDx: null, adjDy: null
      }));
    }

    for (let i = 0; i < lastResult.adjustedAngles.length; i++) {
      const a = lastResult.adjustedAngles[i];
      const inc = lastResult.increments[i];
      const coord = lastResult.coordinates[i + 1];

      let edgeName = '';
      if (i === 0) {
        edgeName = `${state.startPoint.name} → ${a.name}`;
      } else {
        edgeName = `${lastResult.adjustedAngles[i-1].name} → ${a.name}`;
      }

      tbody.appendChild(buildResultRow({
        type: 'edge',
        name: edgeName,
        az: lastResult.azimuths[i],
        dist: inc.distance, dx: inc.dx, dy: inc.dy, vx: inc.vx, vy: inc.vy, adjDx: inc.adjustedDx, adjDy: inc.adjustedDy
      }));

      tbody.appendChild(buildResultRow({
        type: 'point',
        name: a.name,
        betaRaw: a.original, vBeta: a.correction, betaAdj: a.adjusted,
        x: coord.x, y: coord.y
      }));
    }
  }

  // Sum Row
  const vBetaText = sumBeta === 0 ? '' : formatDms(sumBeta);
  const corrDec = state.integerMode ? 3 : 4;
  const tr = el('tr', { class: 'row-sum' },
    el('td', { class: 'col-name' }, 'Σ'),
    el('td', { class: 'col-dms' }, vBetaText),
    el('td', { class: 'col-num vbeta' }, ''),
    el('td', { class: 'col-dms' }, ''),
    el('td', { class: 'col-dms' }, ''),
    el('td', { class: 'col-num' }, sumD.toFixed(3)),
    el('td', { class: 'col-num small' }, formatSigned(sumDx, 3)),
    el('td', { class: 'col-num small' }, formatSigned(sumDy, 3)),
    el('td', { class: 'col-num small' }, formatSigned(sumVx, corrDec)),
    el('td', { class: 'col-num small' }, formatSigned(sumVy, corrDec)),
    el('td', { class: 'col-num' }, formatSigned(sumDx + sumVx, 3)),
    el('td', { class: 'col-num' }, formatSigned(sumDy + sumVy, 3)),
    el('td', { class: 'col-num' }, ''),
    el('td', { class: 'col-num' }, '')
  );
  tbody.appendChild(tr);
}

function buildResultRow(r) {
  const tr = el('tr', { class: `row-${r.type}` });
  if (r.type === 'point') {
    const vBetaText = r.vBeta === null ? '' : formatSigned(r.vBeta, state.integerMode ? 0 : 1);
    tr.append(
      el('td', { class: 'col-name' }, r.name),
      el('td', { class: 'col-dms' }, r.betaRaw === null ? '' : formatDms(r.betaRaw)),
      el('td', { class: 'col-num vbeta' }, vBetaText),
      el('td', { class: 'col-dms' }, r.betaAdj === null ? '' : formatDms(r.betaAdj)),
      el('td', { class: 'col-dms' }, ''),
      el('td', { class: 'col-num' }, ''),
      el('td', { class: 'col-num small' }, ''),
      el('td', { class: 'col-num small' }, ''),
      el('td', { class: 'col-num small' }, ''),
      el('td', { class: 'col-num small' }, ''),
      el('td', { class: 'col-num' }, ''),
      el('td', { class: 'col-num' }, ''),
      el('td', { class: 'col-num' }, r.x.toFixed(3)),
      el('td', { class: 'col-num' }, r.y.toFixed(3))
    );
  } else {
    const corrDec = state.integerMode ? 3 : 4;
    tr.append(
      el('td', { class: 'col-name' }, ''), // name can optionally be placed here if wanted
      el('td', { class: 'col-dms' }, ''),
      el('td', { class: 'col-num vbeta' }, ''),
      el('td', { class: 'col-dms' }, ''),
      el('td', { class: 'col-dms' }, r.az === null ? '' : formatDms(r.az)),
      el('td', { class: 'col-num' }, r.dist === null ? '' : r.dist.toFixed(3)),
      el('td', { class: 'col-num small' }, r.dx === null ? '' : formatSigned(r.dx, 3)),
      el('td', { class: 'col-num small' }, r.dy === null ? '' : formatSigned(r.dy, 3)),
      el('td', { class: 'col-num small' }, r.vx === null ? '' : formatSigned(r.vx, corrDec)),
      el('td', { class: 'col-num small' }, r.vy === null ? '' : formatSigned(r.vy, corrDec)),
      el('td', { class: 'col-num' }, r.adjDx === null ? '' : formatSigned(r.adjDx, 3)),
      el('td', { class: 'col-num' }, r.adjDy === null ? '' : formatSigned(r.adjDy, 3)),
      el('td', { class: 'col-num' }, ''),
      el('td', { class: 'col-num' }, '')
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
      ? azimuthBetween(state.startB, state.startPoint)
      : null;
    const startBName = state.startB ? state.startB.name : 'B';
    const startPName = state.startPoint.name || 'A1';
    $('#start-b-az-display').textContent = az !== null
      ? formatDms(az)
      : `— (需填 ${startBName} 和 ${startPName} 坐标)`;
  }

  // 终止方位角反算显示
  if (state.endCMode) {
    const az = state.endC
      ? azimuthBetween(state.endPoint, state.endC)
      : null;
    const endCName = state.endC ? state.endC.name : 'C';
    const endPName = state.endPoint.name || 'D';
    $('#end-c-az-display').textContent = az !== null
      ? formatDms(az)
      : `— (需填 ${endPName} 和 ${endCName} 坐标)`;
  }
}

// ─────────────────────────────────────────────
// 输入绑定
// ─────────────────────────────────────────────
function bindEvents() {
  // 模式
  $('#mode-closed').addEventListener('click', () => { state.mode = 'closed'; switchPage('calc'); render(); });
  $('#mode-attached').addEventListener('click', () => { state.mode = 'attached'; switchPage('calc'); render(); });

  // 细部绘图页面进入和退出
  $('#btn-open-plotter')?.addEventListener('click', () => { switchPage('plotter'); render(); });
  $('#btn-back-calc')?.addEventListener('click', () => { switchPage('calc'); render(); });

  // 起算
  $('#start-name').addEventListener('input', e => { state.startPoint.name = e.target.value; markDirty(); });
  $('#start-x').addEventListener('input', e => { state.startPoint.x = num(e.target.value); markDirty(); });
  $('#start-y').addEventListener('input', e => { state.startPoint.y = num(e.target.value); markDirty(); });
  bindDms('#start-az', () => state.startAzimuth);
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
  $$('input[name="start_source"]').forEach(r => {
    r.addEventListener('change', e => {
      state.startBMode = (e.target.value === 'reverse');
      if (state.startBMode && !state.startB) {
        const az = dmsToDecimal(state.startAzimuth.d, state.startAzimuth.m, state.startAzimuth.s);
        state.startB = {
          name: 'B',
          x: state.startPoint.x - 100 * Math.cos(az * DEG),
          y: state.startPoint.y - 100 * Math.sin(az * DEG)
        };
      }
      render();
    });
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
  bindDms('#end-az', () => state.endAzimuth);
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
  $$('input[name="end_source"]').forEach(r => {
    r.addEventListener('change', e => {
      state.endCMode = (e.target.value === 'reverse');
      if (state.endCMode && !state.endC) {
        const az = dmsToDecimal(state.endAzimuth.d, state.endAzimuth.m, state.endAzimuth.s);
        state.endC = {
          name: 'C',
          x: state.endPoint.x + 100 * Math.cos(az * DEG),
          y: state.endPoint.y + 100 * Math.sin(az * DEG)
        };
      }
      render();
    });
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
  $('#rounded-mode-toggle').addEventListener('change', e => {
    state.roundedMode = e.target.checked;
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
    const idx = state.stations.length;
    const letter = String.fromCharCode('A'.charCodeAt(0) + (idx % 26));
    const suffix = idx >= 26 ? String(Math.floor(idx / 26)) : '';
    const nextName = letter + suffix;
    state.stations.push({ name: nextName, deg: 0, min: 0, sec: 0, distance: last ? last.distance : 100 });
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
  
  // 导入测站数据事件
  $('#btn-import-file')?.addEventListener('click', () => {
    closeModals();
    openImportModal();
  });
  $('#btn-select-file')?.addEventListener('click', () => {
    $('#import-file-input').click();
  });
  $('#import-file-input')?.addEventListener('change', (e) => {
    handleImportFile(e.target.files[0]);
  });
  $('#btn-import-confirm')?.addEventListener('click', () => {
    if (tempImportedStations && tempImportedStations.length >= 3) {
      state.stations = tempImportedStations;
      closeModals();
      markDirty();
      render();
      alert(`已成功导入 ${state.stations.length} 个测站数据！`);
    }
  });

  // 模态关闭
  $$('.modal-close, .modal-backdrop').forEach(el => {
    el.addEventListener('click', closeModals);
  });

  // ESC 键关闭模态框
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModals();
  });

  // ── 细部绘图 事件绑定 ──────────────────
  bindPlotterEvents();
}

function bindDms(prefix, getTarget) {
  const dEl = $(`${prefix}-d`);
  const mEl = $(`${prefix}-m`);
  const sEl = $(`${prefix}-s`);
  [dEl, mEl, sEl].forEach((e, i) => {
    const key = ['d', 'm', 's'][i];
    e.addEventListener('input', () => {
      getTarget()[key] = num(e.value);
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
  
  $$('#result-body tr').forEach(tr => {
    const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
    if (cells.length === 14) {
      lines.push(cells.join('\t'));
    }
  });

  const c = lastResult.closure;
  let kText;
  if (c.k <= 0) {
    kText = '∞';
  } else if (c.k < 1e-6) {
    kText = '< 1/1,000,000';
  } else {
    kText = `1/${Math.round(1 / c.k)}`;
  }
  let modeNotes = [];
  if (state.integerMode) modeNotes.push('整数修正模式');
  if (state.roundedMode) modeNotes.push('手工验算模式');
  const modeNote = modeNotes.length ? ` [${modeNotes.join(' + ')}]` : '';
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
  const W = 1200, rowH = 28, headH = 36, footH = 90;
  
  const trs = Array.from($$('#result-body tr')).filter(tr => tr.querySelectorAll('td').length === 14);
  const rows = trs.length;
  const H = headH + rows * rowH + footH;
  
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#0f172a'; ctx.font = 'bold 14px -apple-system, sans-serif';

  const cols = ['点', '观测角', 'v_β', '改正后', '方位角', '边长', "X'", "Y'", 'vx', 'vy', 'ΔX', 'ΔY', 'X', 'Y'];
  const colW = (W - 24) / cols.length;
  
  const draw = (txt, x, y, w, align = 'center', bold = false) => {
    ctx.font = `${bold ? 'bold ' : ''}${bold ? 14 : 13}px -apple-system, sans-serif`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(txt, x + (align === 'center' ? w / 2 : 4), y);
  };
  
  ctx.fillStyle = '#0f766e'; ctx.fillRect(0, 0, W, headH);
  ctx.fillStyle = '#fff';
  cols.forEach((h, i) => draw(h, 12 + i * colW, headH / 2, colW, 'center', true));
  
  let y = headH;
  
  trs.forEach((tr, i) => {
    if (tr.classList.contains('row-point')) {
      ctx.fillStyle = '#ffffff';
    } else if (tr.classList.contains('row-edge')) {
      ctx.fillStyle = '#f8fafc';
    } else if (tr.classList.contains('row-sum')) {
      ctx.fillStyle = '#fefce8';
    } else {
      ctx.fillStyle = i % 2 === 0 ? '#f8fafc' : '#ffffff';
    }
    
    ctx.fillRect(0, y, W, rowH);
    ctx.fillStyle = tr.classList.contains('row-edge') ? '#64748b' : '#0f172a';
    if (tr.classList.contains('row-sum')) ctx.fillStyle = '#854d0e';
    
    const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
    cells.forEach((txt, j) => {
      draw(txt, 12 + j * colW, y + rowH / 2, colW, 'center', tr.classList.contains('row-sum'));
    });
    
    y += rowH;
  });

  ctx.fillStyle = '#fef3c7'; ctx.fillRect(0, y, W, footH);
  ctx.fillStyle = '#92400e'; ctx.font = 'bold 13px -apple-system, sans-serif';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  const cl = lastResult.closure;
  const kText = cl.k > 0 ? `1/${Math.round(1 / cl.k)}` : '∞';
  let modeNotes = [];
  if (state.integerMode) modeNotes.push('整数修正模式');
  if (state.roundedMode) modeNotes.push('手工验算模式');
  const modeNote = modeNotes.length ? `  ｜ ${modeNotes.join(' + ')}` : '';
  const kLimitText = `1/${state.kLimit.toLocaleString()}`;
  ctx.fillText(`fβ = ${formatSeconds(cl.fBeta)}    fβ允 = ±${cl.fBetaLimit.toFixed(1)}″    fx = ${cl.fx.toFixed(4)} m    fy = ${cl.fy.toFixed(4)} m`, 12, y + 18);
  ctx.fillText(`fs = ${cl.fs.toFixed(4)} m    K = ${kText}    K限 = ${kLimitText}${modeNote}`, 12, y + 42);
  ctx.fillText(cl.fBetaOver || cl.kOver ? '❌ 超限（仍给出平差结果）' : '✅ 满足限差', 12, y + 66);

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
          const migrated = migrateState(data.state);
          if (!migrated || !migrated.stations) {
            alert('JSON 数据格式不兼容（缺少必要字段或测站数不足 3）');
            return;
          }
          state = migrated;
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

let tempImportedStations = null;

function loadSheetJS(callback) {
  if (window.XLSX) {
    callback();
    return;
  }
  const script = document.createElement('script');
  script.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
  script.onload = callback;
  script.onerror = () => {
    alert('加载 Excel 解析库失败，请检查网络或重试。');
  };
  document.head.appendChild(script);
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  let isFirst = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const rawParts = line.split(/[,;]/);
    if (rawParts.length < 5) continue;
    const parts = rawParts.slice(0, 5).map(p => p.replace(/^["']|["']$/g, '').trim());
    
    if (isFirst) {
      isFirst = false;
      const isHeader = isNaN(Number(parts[1])) || isNaN(Number(parts[2])) || isNaN(Number(parts[3])) || isNaN(Number(parts[4]));
      if (isHeader) continue;
    }
    
    result.push({
      name: parts[0],
      deg: parseInt(parts[1], 10),
      min: parseInt(parts[2], 10),
      sec: parseFloat(parts[3]),
      distance: parseFloat(parts[4])
    });
  }
  return result;
}

function parseTXT(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  let isFirst = true;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(/[\t\s]+/).map(p => p.trim());
    if (parts.length < 5) continue;
    
    if (isFirst) {
      isFirst = false;
      const isHeader = isNaN(Number(parts[1])) || isNaN(Number(parts[2])) || isNaN(Number(parts[3])) || isNaN(Number(parts[4]));
      if (isHeader) continue;
    }
    
    result.push({
      name: parts[0],
      deg: parseInt(parts[1], 10),
      min: parseInt(parts[2], 10),
      sec: parseFloat(parts[3]),
      distance: parseFloat(parts[4])
    });
  }
  return result;
}

function parseMD(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!line.startsWith('|')) continue;
    
    const rawParts = line.split('|').map(p => p.trim()).filter((p, idx) => idx > 0 && idx < line.split('|').length - 1);
    if (rawParts.length < 5) continue;
    const parts = rawParts.slice(0, 5);
    
    if (parts[0].includes('---') || parts[1].includes('---')) continue;
    
    const isHeader = isNaN(Number(parts[1])) || isNaN(Number(parts[2])) || isNaN(Number(parts[3])) || isNaN(Number(parts[4]));
    if (isHeader) continue;
    
    result.push({
      name: parts[0],
      deg: parseInt(parts[1], 10),
      min: parseInt(parts[2], 10),
      sec: parseFloat(parts[3]),
      distance: parseFloat(parts[4])
    });
  }
  return result;
}

function parseXLSX(arrayBuffer) {
  const data = new Uint8Array(arrayBuffer);
  const workbook = XLSX.read(data, { type: 'array' });
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  const result = [];
  let isFirst = true;
  for (let i = 0; i < json.length; i++) {
    const row = json[i];
    if (!row || row.length < 5) continue;
    
    const parts = row.slice(0, 5).map(val => (val !== undefined && val !== null) ? String(val).trim() : '');
    
    if (isFirst) {
      isFirst = false;
      const isHeader = isNaN(Number(parts[1])) || isNaN(Number(parts[2])) || isNaN(Number(parts[3])) || isNaN(Number(parts[4]));
      if (isHeader) continue;
    }
    
    result.push({
      name: parts[0],
      deg: parseInt(parts[1], 10),
      min: parseInt(parts[2], 10),
      sec: parseFloat(parts[3]),
      distance: parseFloat(parts[4])
    });
  }
  return result;
}

function validateImportData(stations) {
  if (!stations || stations.length === 0) {
    return { valid: false, error: '文件内未找到有效测站数据，请检查列数和格式！' };
  }
  if (stations.length < 3) {
    return { valid: false, error: `测站数量不足（仅有 ${stations.length} 个测站），导线平差至少需要 3 个测站！` };
  }
  
  for (let i = 0; i < stations.length; i++) {
    const s = stations[i];
    const lineNum = i + 1;
    
    if (!s.name || s.name.trim() === '') {
      return { valid: false, error: `第 ${lineNum} 行：测站名不能为空！` };
    }
    
    const deg = Number(s.deg);
    const min = Number(s.min);
    const sec = Number(s.sec);
    const dist = Number(s.distance);
    
    if (isNaN(deg) || deg < 0 || !Number.isInteger(deg)) {
      return { valid: false, error: `第 ${lineNum} 行（测站 ${s.name}）：角度的“度”必须为非负整数！` };
    }
    if (isNaN(min) || min < 0 || min >= 60 || !Number.isInteger(min)) {
      return { valid: false, error: `第 ${lineNum} 行（测站 ${s.name}）：角度的“分”必须为 0 到 59 之间的整数！` };
    }
    if (isNaN(sec) || sec < 0 || sec >= 60) {
      return { valid: false, error: `第 ${lineNum} 行（测站 ${s.name}）：角度的“秒”必须为 0 到 59.99... 之间的数值！` };
    }
    if (isNaN(dist) || dist <= 0) {
      return { valid: false, error: `第 ${lineNum} 行（测站 ${s.name}）：边长（水平距离）必须为大于 0 的数值！` };
    }
  }
  return { valid: true, error: null };
}

function openImportModal() {
  $('#modal-import').hidden = false;
  $('#import-file-input').value = '';
  $('#import-filename').textContent = '';
  $('#import-status').hidden = true;
  $('#import-preview-wrap').hidden = true;
  $('#btn-import-confirm').disabled = true;
  tempImportedStations = null;
}

function handleImportFile(file) {
  if (!file) return;
  
  $('#import-filename').textContent = `已选择文件: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  $('#import-status').hidden = true;
  $('#import-preview-wrap').hidden = true;
  $('#btn-import-confirm').disabled = true;
  tempImportedStations = null;
  
  const ext = file.name.split('.').pop().toLowerCase();
  
  if (ext === 'xlsx' || ext === 'xls') {
    loadSheetJS(() => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const stations = parseXLSX(e.target.result);
          processImportedStations(stations);
        } catch (err) {
          showImportError('Excel 解析失败: ' + err.message);
        }
      };
      reader.readAsArrayBuffer(file);
    });
  } else {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        let stations = [];
        if (ext === 'csv') {
          stations = parseCSV(text);
        } else if (ext === 'md') {
          stations = parseMD(text);
        } else {
          stations = parseTXT(text);
        }
        processImportedStations(stations);
      } catch (err) {
        showImportError('文件解析失败: ' + err.message);
      }
    };
    reader.readAsText(file, 'UTF-8');
  }
}

function showImportError(msg) {
  const status = $('#import-status');
  status.textContent = msg;
  status.hidden = false;
  $('#import-preview-wrap').hidden = true;
  $('#btn-import-confirm').disabled = true;
}

function processImportedStations(stations) {
  const validation = validateImportData(stations);
  if (!validation.valid) {
    showImportError(validation.error);
    return;
  }
  
  tempImportedStations = stations;
  
  const tbody = $('#import-preview-body');
  tbody.innerHTML = '';
  stations.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.name}</td>
      <td class="col-num">${s.deg}</td>
      <td class="col-num">${s.min}</td>
      <td class="col-num">${s.sec}</td>
      <td class="col-num">${s.distance.toFixed(3)}</td>
    `;
    tbody.appendChild(tr);
  });
  
  $('#import-row-count').textContent = stations.length;
  $('#import-preview-wrap').hidden = false;
  $('#btn-import-confirm').disabled = false;
}

// ─────────────────────────────────────────────
// 细部绘图事件
// ─────────────────────────────────────────────
function bindPlotterEvents() {
  // 背景切换
  $('#plotter-bg-grid')?.addEventListener('click', () => {
    if (!plotter) return;
    plotter.setBackground('grid');
    $('#plotter-bg-grid').classList.add('active');
    $('#plotter-bg-plain').classList.remove('active');
  });
  $('#plotter-bg-plain')?.addEventListener('click', () => {
    if (!plotter) return;
    plotter.setBackground('plain');
    $('#plotter-bg-plain').classList.add('active');
    $('#plotter-bg-grid').classList.remove('active');
  });

  // 连线模式
  $('#plotter-draw')?.addEventListener('click', () => {
    if (!plotter) return;
    if (plotter.drawingMode) {
      plotter.finishPolyline();
    } else {
      plotter.startPolyline();
    }
    updateDrawingUI();
  });

  // 闭合
  $('#plotter-close-poly')?.addEventListener('click', () => {
    if (!plotter) return;
    plotter.closePolyline();
    updateDrawingUI();
  });

  // 结束连线（不闭合）
  $('#plotter-finish-poly')?.addEventListener('click', () => {
    if (!plotter) return;
    plotter.finishPolyline();
    updateDrawingUI();
  });

  // 撤销一段
  $('#plotter-undo-seg')?.addEventListener('click', () => {
    if (!plotter) return;
    plotter.undoLastSegment();
    updateDrawingUI();
  });

  // 删除最后一条轮廓线
  $('#plotter-undo-poly')?.addEventListener('click', () => {
    if (!plotter) return;
    plotter.undoLastPolyline();
  });

  // 自适应视图
  $('#plotter-fit')?.addEventListener('click', () => {
    if (!plotter) return;
    plotter.fitView();
  });

  // 导出 PNG
  $('#plotter-export-png')?.addEventListener('click', () => {
    if (!plotter) return;
    plotter.downloadPNG();
  });

  // 导出 DXF
  $('#plotter-export-dxf')?.addEventListener('click', () => {
    if (!plotter) return;
    plotter.downloadDXF();
  });

  // 比例尺
  $('#plotter-scale-apply')?.addEventListener('click', () => {
    if (!plotter) return;
    const val = $('#plotter-scale').value;
    plotter.setUserScale(val ? +val : null);
  });

  // 添加细部点
  $('#btn-add-detail')?.addEventListener('click', () => {
    if (!plotter) return;
    const name = $('#detail-name').value.trim();
    const x = +$('#detail-x').value;
    const y = +$('#detail-y').value;
    if (!name) { alert('请输入点名'); return; }
    if (isNaN(x) || isNaN(y)) { alert('请输入有效坐标'); return; }
    if (!plotter.addDetailPoint(name, x, y)) {
      alert(`点名 "${name}" 已存在`);
      return;
    }
    // 清空输入
    $('#detail-name').value = '';
    $('#detail-x').value = '';
    $('#detail-y').value = '';
    $('#detail-name').focus();
    renderPointList();
  });

  // 批量导入
  $('#btn-batch-import')?.addEventListener('click', () => {
    if (!plotter) return;
    const text = $('#batch-input').value;
    if (!text.trim()) { alert('请粘贴坐标数据'); return; }
    const added = plotter.addDetailPointsBatch(text);
    if (added > 0) {
      alert(`成功导入 ${added} 个点`);
      $('#batch-input').value = '';
      renderPointList();
    } else {
      alert('未能识别有效数据，请检查格式');
    }
  });

  // 在 plotter 的 canvas 点击后更新 UI（连线可能改变了按钮状态）
  $('#plotter-canvas')?.addEventListener('click', () => {
    setTimeout(updateDrawingUI, 50);
  });

  // 重新导入控制点
  $('#btn-reimport')?.addEventListener('click', () => {
    if (!lastResult || !lastResult.coordinates) {
      alert('暂无平差计算结果，请先在闭合/附合导线页面完成计算');
      return;
    }
    const modeText = lastResult.sourceMode === 'attached' ? '附合导线' : '闭合导线';
    const count = lastResult.coordinates.length;
    if (confirm(`将从「${modeText}」的最新计算结果中导入 ${count} 个控制点，当前的控制点将被替换。\n\n细部点和连线不受影响。继续？`)) {
      importControlPoints();
    }
  });
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
