// 方案存储（localStorage）
// - saveProject / listProjects / getProject / deleteProject
// - saveDraft / loadDraft：自动保存当前编辑状态
// - 所有写入带 STATE_VERSION 字段；旧版本草稿/方案不兼容会被丢弃

import { STATE_VERSION } from './version.js';

const KEY_PROJECTS = 'traverse-calc:projects';
const KEY_DRAFT = 'traverse-calc:draft';
export { STATE_VERSION };

function readJSON(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (!v) return fallback;
    return JSON.parse(v);
  } catch (e) {
    console.warn('storage read fail', key, e);
    return fallback;
  }
}

function writeJSON(key, val) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
    return true;
  } catch (e) {
    console.error('storage write fail', key, e);
    return false;
  }
}

export function migrateState(st) {
  // 字段补全: 老草稿可能缺新加的字段, 用默认填上, 避免 undefined 引发渲染错
  if (!st) return null;
  return {
    mode: st.mode ?? 'closed',
    startPoint: { name: st.startPoint?.name ?? 'A', x: Number(st.startPoint?.x) || 0, y: Number(st.startPoint?.y) || 0 },
    startAzimuth: { d: Number(st.startAzimuth?.d) || 0, m: Number(st.startAzimuth?.m) || 0, s: Number(st.startAzimuth?.s) || 0 },
    startAzMode: st.startAzMode ?? 'dms',
    startAzDecimal: Number(st.startAzDecimal) || 0,
    startBMode: !!st.startBMode,
    startB: st.startB ? { name: st.startB.name ?? 'B', x: Number(st.startB.x) || 0, y: Number(st.startB.y) || 0 } : null,
    endPoint: { name: st.endPoint?.name ?? 'E', x: Number(st.endPoint?.x) || 0, y: Number(st.endPoint?.y) || 0 },
    endAzimuth: { d: Number(st.endAzimuth?.d) || 0, m: Number(st.endAzimuth?.m) || 0, s: Number(st.endAzimuth?.s) || 0 },
    endAzMode: st.endAzMode ?? 'dms',
    endAzDecimal: Number(st.endAzDecimal) || 0,
    endCMode: !!st.endCMode,
    endC: st.endC ? { name: st.endC.name ?? 'C', x: Number(st.endC.x) || 0, y: Number(st.endC.y) || 0 } : null,
    angleType: st.angleType === 'left' ? 'left' : 'right',
    kLimit: Number(st.kLimit) || 2000,
    integerMode: !!st.integerMode,
    roundedMode: !!st.roundedMode,
    stations: Array.isArray(st.stations) && st.stations.length >= 3 ? st.stations.map(s => ({
      name: String(s.name ?? '').slice(0, 4),
      deg: Number(s.deg) || 0,
      min: Number(s.min) || 0,
      sec: Number(s.sec) || 0,
      distance: Number(s.distance) || 0
    })) : null
  };
}

export function saveProject(project) {
  const list = readJSON(KEY_PROJECTS, []);
  const now = Date.now();
  const idx = list.findIndex(p => p.id === project.id);
  const payload = { ...project, version: STATE_VERSION, updatedAt: now };
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...payload };
  } else {
    list.push({ ...payload, createdAt: now });
  }
  writeJSON(KEY_PROJECTS, list);
  return project.id;
}

export function listProjects() {
  const list = readJSON(KEY_PROJECTS, []);
  return list
    .filter(p => !p.version || p.version === STATE_VERSION)   // 丢弃不兼容版本
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id) {
  const list = readJSON(KEY_PROJECTS, []);
  const p = list.find(p => p.id === id);
  if (!p) return null;
  if (p.version && p.version !== STATE_VERSION) return null;
  if (p.state) p.state = migrateState(p.state);
  return p;
}

export function deleteProject(id) {
  const list = readJSON(KEY_PROJECTS, []).filter(p => p.id !== id);
  writeJSON(KEY_PROJECTS, list);
}

export function newProjectId() {
  return 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export function saveDraft(state) {
  writeJSON(KEY_DRAFT, { version: STATE_VERSION, state, savedAt: Date.now() });
}

export function loadDraft() {
  const d = readJSON(KEY_DRAFT, null);
  if (!d) return null;
  if (d.version && d.version !== STATE_VERSION) return null;
  if (d.state) d.state = migrateState(d.state);
  return d;
}

export function clearDraft() {
  localStorage.removeItem(KEY_DRAFT);
}
