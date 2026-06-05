// 闭合 / 附合导线平差计算
// 输入：起算数据 + 测站列表
// 输出：观测角改正、方位角、坐标增量与改正、最终坐标、闭合差汇总

import { dmsToDecimal, decimalToDms, normalize360, DEG } from './dms.js';

/**
 * 公共：把测站的度分秒输入转成十进制度，返回新数组（不修改原对象）
 */
function stationsToDecimal(stations) {
  return stations.map(s => ({
    name: s.name,
    original: dmsToDecimal(s.deg, s.min, s.sec),
    distance: Number(s.distance) || 0
  }));
}

/**
 * 整数（倍）分配
 * @param {number} target   总和（如 -f_β，单位秒；或 -fx，单位米）
 * @param {number} unit     最小单位（角度 = 1 秒；坐标 = 0.001 米）
 * @param {number} n        项数
 * @param {number[]} weights 权重数组（绝对值大者优先分到 +unit / -unit）
 * @returns {number[]}      长度为 n 的数组，每个都是 unit 的整数倍，总和 = target
 */
function integerDistribute(target, unit, n, weights) {
  const targetInUnit = target / unit;
  const base = Math.trunc(targetInUnit / n);
  const result = new Array(n).fill(base * unit);
  // remainder 理论是整数；浮点误差可能让它有 1e-10 量级偏移 → round
  const remainder = Math.round(targetInUnit - base * n);
  if (remainder === 0) return result;

  const step = remainder > 0 ? 1 : -1;
  const absRem = Math.abs(remainder);
  // 按权重绝对值从大到小排，前 absRem 项 +step*unit
  const indices = weights.map((w, i) => i)
    .sort((a, b) => Math.abs(weights[b]) - Math.abs(weights[a]));
  for (let i = 0; i < absRem; i++) {
    result[indices[i]] += step * unit;
  }
  return result;
}

/**
 * 角度改正 + 推方位角
 *  - 左角： α_next = α_prev + β' - 180°
 *  - 右角： α_next = α_prev - β' + 180°
 * @param {boolean} [integerMode]  若 true：v_β 为整秒（按 |原始β| 大小分余量）
 * 返回 {adjustedAngles, azimuths}
 *   - adjustedAngles[i] = {name, original, correction, adjusted}（correction 单位：秒）
 *   - azimuths[i]        = 第 i 条边（站 i 出发）的方位角
 *   - azimuths.length    === n（不含回到起点的最后一条校验边）
 */
function adjustAnglesAndAzimuths(obsAngles, startAzimuth, angleType, fBeta, integerMode) {
  const n = obsAngles.length;
  let vArr;
  if (integerMode) {
    vArr = integerDistribute(-fBeta, 1, n, obsAngles.map(a => a.original));
  } else {
    const v = -fBeta / n;                           // 每角平均改正（秒），允许小数
    vArr = new Array(n).fill(v);
  }
  const adjusted = obsAngles.map((a, i) => ({
    name: a.name,
    original: a.original,
    correction: vArr[i],
    adjusted: a.original + vArr[i] / 3600
  }));

  const azimuths = [normalize360(startAzimuth)];
  let cur = startAzimuth;
  for (let i = 0; i < n; i++) {
    let next;
    if (angleType === 'left') {
      next = cur + adjusted[i].adjusted - 180;
    } else {
      next = cur - adjusted[i].adjusted + 180;
    }
    cur = normalize360(next);
    if (i < n - 1) azimuths.push(cur);
  }
  // 推算回到起点应满足的角度闭合（理论上为 0）
  const lastAz = cur;
  return { adjusted, azimuths, lastAz };
}

/**
 * 由方位角和边长算坐标增量（X=纵=北向, Y=横=东向）
 *   ΔX = D·cosα
 *   ΔY = D·sinα
 * 同时累加 ΣΔX、ΣΔY、ΣD
 */
function computeIncrements(stations, azimuths) {
  const n = stations.length;
  let sumDx = 0, sumDy = 0, sumD = 0;
  const incs = [];
  for (let i = 0; i < n; i++) {
    const az = azimuths[i];
    const dx = stations[i].distance * Math.cos(az * DEG);
    const dy = stations[i].distance * Math.sin(az * DEG);
    sumDx += dx;
    sumDy += dy;
    sumD += stations[i].distance;
    incs.push({ dx, dy, az, distance: stations[i].distance });
  }
  return { incs, sumDx, sumDy, sumD };
}

/**
 * 按边长比例分配 fx、fy 闭合差到各增量
 * @param {Array} incs       增量数组（含 dx, dy, distance, az）
 * @param {number} fx        X 方向闭合差
 * @param {number} fy        Y 方向闭合差
 * @param {number} sumD      总边长
 * @param {boolean} [integerMode]  若 true：vx/vy 为 0.001 m 的整数倍（按 distance 大小分余量）
 */
function distributeClosure(incs, fx, fy, sumD, integerMode) {
  const distances = incs.map(inc => inc.distance);
  let vxArr, vyArr;
  if (integerMode && sumD > 0) {
    vxArr = integerDistribute(-fx, 0.001, incs.length, distances);
    vyArr = integerDistribute(-fy, 0.001, incs.length, distances);
  } else {
    vxArr = incs.map(inc => sumD > 0 ? -fx * inc.distance / sumD : 0);
    vyArr = incs.map(inc => sumD > 0 ? -fy * inc.distance / sumD : 0);
  }
  return incs.map((inc, i) => {
    const vx = vxArr[i];
    const vy = vyArr[i];
    return {
      dx: inc.dx,
      dy: inc.dy,
      vx,
      vy,
      adjustedDx: inc.dx + vx,
      adjustedDy: inc.dy + vy,
      az: inc.az,
      distance: inc.distance
    };
  });
}

/**
 * 闭合导线
 * @param {Object} params
 * @param {{name:string, x:number, y:number}} params.startPoint
 * @param {number} params.startAzimuth  十进制度
 * @param {'left'|'right'} params.angleType
 * @param {Array<{name:string, deg:number, min:number, sec:number, distance:number}>} params.stations
 * @param {number} [params.angleLimit]  角度闭合差限差（秒），默认 40·√n
 * @param {number} [params.kLimit]      全长相对闭合差限差（>0 数字），默认 1/2000
 */
export function calcClosedTraverse(params) {
  const { startPoint, startAzimuth, angleType, stations, angleLimit, kLimit, integerMode } = params;

  if (!Array.isArray(stations) || stations.length < 3) {
    throw new Error('闭合导线至少需要 3 个测站');
  }
  if (angleType !== 'left' && angleType !== 'right') {
    throw new Error('angleType 必须是 "left" 或 "right"');
  }

  const n = stations.length;
  const obs = stationsToDecimal(stations);

  // 1) 角度闭合差
  const sumBeta = obs.reduce((s, a) => s + a.original, 0);
  const sumBetaTheo = (n - 2) * 180;
  const fBeta = (sumBeta - sumBetaTheo) * 3600;            // 秒
  const fBetaLimit = angleLimit ?? 40 * Math.sqrt(n);
  const fBetaOver = Math.abs(fBeta) > fBetaLimit;

  // 2) 改正 + 方位角
  const { adjusted, azimuths, lastAz } = adjustAnglesAndAzimuths(
    obs, startAzimuth, angleType, fBeta, integerMode
  );
  const azClosureErr = (lastAz - startAzimuth) * 3600;      // 应 ≈ 0

  // 3) 增量
  const { incs, sumDx, sumDy, sumD } = computeIncrements(obs, azimuths);
  // 闭合：理论 ΣΔX = 0, ΣΔY = 0
  const fx = sumDx, fy = sumDy;
  const fs = Math.sqrt(fx * fx + fy * fy);
  const k = sumD > 0 ? fs / sumD : 0;
  const kLimitVal = kLimit ?? 1 / 2000;
  const kOver = k > kLimitVal;

  // 4) 分配闭合差
  const adjIncs = distributeClosure(incs, fx, fy, sumD, integerMode);

  // 5) 坐标
  const coords = [{ name: startPoint.name, x: startPoint.x, y: startPoint.y }];
  let cx = startPoint.x, cy = startPoint.y;
  for (let i = 0; i < n; i++) {
    cx += adjIncs[i].adjustedDx;
    cy += adjIncs[i].adjustedDy;
    coords.push({ name: stations[i].name, x: cx, y: cy });
  }

  return {
    adjustedAngles: adjusted,
    azimuths,
    increments: adjIncs,
    coordinates: coords,
    closure: {
      fBeta, fBetaLimit, fBetaOver,
      azimuthClosureError: azClosureErr,
      fx, fy, fs, k, kLimit: kLimitVal, kOver, sumD
    }
  };
}

/**
 * 附合导线
 * @param {Object} params
 * @param {{name:string, x:number, y:number}} params.startPoint
 * @param {number} params.startAzimuth
 * @param {{name:string, x:number, y:number}} params.endPoint
 * @param {number} params.endAzimuth
 * @param {'left'|'right'} params.angleType
 * @param {Array<{name:string, deg:number, min:number, sec:number, distance:number}>} params.stations
 * @param {number} [params.angleLimit]
 * @param {number} [params.kLimit]
 */
export function calcAttachedTraverse(params) {
  const {
    startPoint, startAzimuth, endPoint, endAzimuth,
    angleType, stations, angleLimit, kLimit, integerMode
  } = params;

  if (!Array.isArray(stations) || stations.length < 2) {
    throw new Error('附合导线至少需要 2 个测站');
  }
  if (angleType !== 'left' && angleType !== 'right') {
    throw new Error('angleType 必须是 "left" 或 "right"');
  }

  const n = stations.length;
  const obs = stationsToDecimal(stations);

  // 1) 角度闭合差
  //   左角：fβ = α_起 + Σβ_左 - α_终 - n·180°
  //   右角：fβ = α_起 - Σβ_右 - α_终 + n·180°
  const sumBeta = obs.reduce((s, a) => s + a.original, 0);
  let fBetaDeg;
  if (angleType === 'left') {
    fBetaDeg = startAzimuth + sumBeta - endAzimuth - n * 180;
  } else {
    fBetaDeg = startAzimuth - sumBeta - endAzimuth + n * 180;
  }
  // 归一化到 (-180, 180] 这种范围内（理论上应该很小）
  fBetaDeg = ((fBetaDeg + 180) % 360 + 360) % 360 - 180;
  const fBeta = fBetaDeg * 3600;
  const fBetaLimit = angleLimit ?? 40 * Math.sqrt(n);
  const fBetaOver = Math.abs(fBeta) > fBetaLimit;

  // 2) 改正 + 方位角
  const { adjusted, azimuths, lastAz } = adjustAnglesAndAzimuths(
    obs, startAzimuth, angleType, fBeta, integerMode
  );
  const azClosureErr = (lastAz - endAzimuth) * 3600;       // 应 ≈ 0

  // 3) 增量
  const { incs, sumDx, sumDy, sumD } = computeIncrements(obs, azimuths);

  // 4) 坐标闭合差：从起点推算到终点的坐标 vs 已知终点坐标
  let endX = startPoint.x, endY = startPoint.y;
  for (let i = 0; i < n; i++) {
    endX += incs[i].dx;
    endY += incs[i].dy;
  }
  const fx = endX - endPoint.x;
  const fy = endY - endPoint.y;
  const fs = Math.sqrt(fx * fx + fy * fy);
  const k = sumD > 0 ? fs / sumD : 0;
  const kLimitVal = kLimit ?? 1 / 2000;
  const kOver = k > kLimitVal;

  // 5) 分配
  const adjIncs = distributeClosure(incs, fx, fy, sumD, integerMode);

  // 6) 坐标
  const coords = [{ name: startPoint.name, x: startPoint.x, y: startPoint.y }];
  let cx = startPoint.x, cy = startPoint.y;
  for (let i = 0; i < n; i++) {
    cx += adjIncs[i].adjustedDx;
    cy += adjIncs[i].adjustedDy;
    coords.push({ name: stations[i].name, x: cx, y: cy });
  }

  return {
    adjustedAngles: adjusted,
    azimuths,
    increments: adjIncs,
    coordinates: coords,
    closure: {
      fBeta, fBetaLimit, fBetaOver,
      azimuthClosureError: azClosureErr,
      fx, fy, fs, k, kLimit: kLimitVal, kOver, sumD,
      endPointComputed: { x: endX, y: endY },
      endPointKnown: { x: endPoint.x, y: endPoint.y }
    }
  };
}

/**
 * 把结果格式化为 Excel 风格表格行（每行一测站）
 * 返回 rows 数组，每行字段：name, betaRaw, betaAdj, az, dist, vx, vy, dx, dy, x, y
 * - betaRaw/betaAdj/az 为格式化好的 DMS 字符串
 * - dist/vx/vy/dx/dy/x/y 为 number（UI 端按需格式化）
 */
export function formatAsExcelRows(result) {
  const { adjustedAngles, azimuths, increments, coordinates, stations } = unwrap(result);
  const rows = [];
  for (let i = 0; i < adjustedAngles.length; i++) {
    rows.push({
      name: stations[i].name,
      betaRaw: adjustedAngles[i].original,           // 十进制，UI 端转 DMS
      betaAdj: adjustedAngles[i].adjusted,
      vBeta: adjustedAngles[i].correction,          // 秒
      az: azimuths[i],
      dist: increments[i].distance,
      vx: increments[i].vx,
      vy: increments[i].vy,
      dx: increments[i].dx,
      dy: increments[i].dy,
      x: coordinates[i + 1].x,                      // 第 0 个是起点，第 i+1 是本测站
      y: coordinates[i + 1].y
    });
  }
  return rows;
}

// 工具：从结果里取 stations（仅当 result 携带了原始 stations 时用）
function unwrap(result) {
  if (!result._stations) {
    // 重新构造一个 stations 视图：从 adjustedAngles 推出
    return { ...result, stations: result.adjustedAngles.map(a => ({ name: a.name })) };
  }
  return result;
}
