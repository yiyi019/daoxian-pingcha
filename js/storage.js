// 方案存储（localStorage）
// - saveProject / listProjects / getProject / deleteProject
// - saveDraft / loadDraft：自动保存当前编辑状态
// - 所有写入带 STATE_VERSION 字段；旧版本草稿/方案通过 migrateState 升级

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

function cloneStation(s) {
  return {
    name: String(s?.name ?? '').slice(0, 8),
    deg: Number(s?.deg) || 0,
    min: Number(s?.min) || 0,
    sec: Number(s?.sec) || 0,
    distance: Number(s?.distance) || 0
  };
}

/**
 * 把旧「到达点」模型（首站名 ≠ 起点名）旋转为统一 matching 模型：
 * stations[0] = 起点，边长 = 离开该点的边。
 * 旧附合：末站 = 终点（含终点连接角）→ 拆出 endConnAngle。
 */
function upgradeLegacyStations(st) {
  const startName = (st.startPoint?.name ?? 'A').trim();
  let stations = Array.isArray(st.stations) ? st.stations.map(cloneStation) : [];
  let endConnAngle = st.endConnAngle
    ? { d: Number(st.endConnAngle.d) || 0, m: Number(st.endConnAngle.m) || 0, s: Number(st.endConnAngle.s) || 0 }
    : { d: 180, m: 0, s: 0 };
  // last 为短暂存在过的选项，迁移回 first（旧模型语义）
  let startAzBasis = st.startAzBasis === 'first' || st.startAzBasis === 'last'
    ? 'first'
    : 'backsight';
  let endPoint = {
    name: st.endPoint?.name ?? 'E',
    x: Number(st.endPoint?.x) || 0,
    y: Number(st.endPoint?.y) || 0
  };

  if (stations.length === 0) {
    return { stations: null, endConnAngle, startAzBasis, endPoint };
  }

  const firstName = (stations[0].name || '').trim();
  const isLegacy = firstName && firstName !== startName;

  if (isLegacy) {
    startAzBasis = 'first';
    if (st.mode === 'attached') {
      // 旧附合：末站 = 终点
      const last = stations[stations.length - 1];
      endConnAngle = { d: last.deg, m: last.min, s: last.sec };
      if (!endPoint.name || endPoint.name === 'E') endPoint.name = last.name || 'E';
      const mids = stations.slice(0, -1);
      if (mids.length === 0) {
        stations = [{ name: startName, deg: 0, min: 0, sec: 0, distance: last.distance }];
      } else {
        stations = [
          { name: startName, deg: 0, min: 0, sec: 0, distance: mids[0].distance },
          ...mids.map((s, i) => ({
            name: s.name,
            deg: s.deg, min: s.min, sec: s.sec,
            distance: i < mids.length - 1 ? mids[i + 1].distance : last.distance
          }))
        ];
      }
    } else {
      // 旧闭合：末站 = 起点（闭合角）
      const last = stations[stations.length - 1];
      const rest = stations.slice(0, -1);
      stations = [
        { name: startName, deg: last.deg, min: last.min, sec: last.sec, distance: stations[0].distance },
        ...rest.map((s, i) => ({
          name: s.name,
          deg: s.deg, min: s.min, sec: s.sec,
          distance: i < rest.length - 1 ? rest[i + 1].distance : last.distance
        }))
      ];
    }
  }

  // 强制首站名 = 起点名
  if (stations.length > 0) stations[0].name = startName;

  const minStations = st.mode === 'attached' ? 2 : 3;
  if (stations.length < minStations) {
    return { stations: null, endConnAngle, startAzBasis, endPoint };
  }

  return { stations, endConnAngle, startAzBasis, endPoint };
}

export function migrateState(st) {
  if (!st) return null;

  const upgraded = upgradeLegacyStations(st);
  if (!upgraded.stations) return null;

  return {
    mode: st.mode === 'attached' ? 'attached' : 'closed',
    startPoint: {
      name: st.startPoint?.name ?? 'A',
      x: Number(st.startPoint?.x) || 0,
      y: Number(st.startPoint?.y) || 0
    },
    startAzimuth: {
      d: Number(st.startAzimuth?.d) || 0,
      m: Number(st.startAzimuth?.m) || 0,
      s: Number(st.startAzimuth?.s) || 0
    },
    startAzMode: st.startAzMode ?? 'dms',
    startAzDecimal: Number(st.startAzDecimal) || 0,
    startAzBasis: upgraded.startAzBasis,
    startBMode: !!st.startBMode,
    startB: st.startB
      ? { name: st.startB.name ?? 'B', x: Number(st.startB.x) || 0, y: Number(st.startB.y) || 0 }
      : null,
    endPoint: upgraded.endPoint,
    endAzimuth: {
      d: Number(st.endAzimuth?.d) || 0,
      m: Number(st.endAzimuth?.m) || 0,
      s: Number(st.endAzimuth?.s) || 0
    },
    endAzMode: st.endAzMode ?? 'dms',
    endAzDecimal: Number(st.endAzDecimal) || 0,
    endCMode: !!st.endCMode,
    endC: st.endC
      ? { name: st.endC.name ?? 'C', x: Number(st.endC.x) || 0, y: Number(st.endC.y) || 0 }
      : null,
    endConnAngle: upgraded.endConnAngle,
    angleType: st.angleType === 'left' ? 'left' : 'right',
    kLimit: Number(st.kLimit) || 2000,
    integerMode: !!st.integerMode,
    roundedMode: !!st.roundedMode,
    stations: upgraded.stations
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
  // v2→v3 可迁移：保留 version 缺失或 ≤ STATE_VERSION 的方案
  return list
    .filter(p => !p.version || p.version <= STATE_VERSION)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getProject(id) {
  const list = readJSON(KEY_PROJECTS, []);
  const p = list.find(p => p.id === id);
  if (!p) return null;
  if (p.version && p.version > STATE_VERSION) return null;
  if (p.state) {
    p.state = migrateState(p.state);
    if (!p.state) return null;
  }
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
  if (d.version && d.version > STATE_VERSION) return null;
  if (d.state) {
    d.state = migrateState(d.state);
    if (!d.state) return null;
  }
  return d;
}

export function clearDraft() {
  localStorage.removeItem(KEY_DRAFT);
}
