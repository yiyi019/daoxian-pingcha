// 闭合 / 附合导线平差计算
// 统一模型（matching）：
//   - stations[0] = 起点（观测起点连接角 / 内角）
//   - stations[i].distance = 离开该点的边长
//   - startAzimuth 语义由 startAzBasis 决定（与最初版本一致）：
//       'backsight' 后视方位角 α(已知→起点)  —— 默认
//       'first'     首边方位角 α(起点→下一站)
//   - 附合：另需 endConnAngle（终点连接角），不计入 stations

import { dmsToDecimal, normalize360, DEG } from './dms.js';

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
 * 把角度差归一化到 (-180, 180] 度，再转秒
 */
function angleDiffSeconds(a, b) {
  let d = ((a - b + 180) % 360 + 360) % 360 - 180;
  return d * 3600;
}

/**
 * 角度改正 + 推方位角（统一 matching 模型）
 *
 *  - 左角： α_next = α_prev + β' - 180°
 *  - 右角： α_next = α_prev - β' + 180°
 *
 * @param {Array<{name:string, original:number}>} obsAngles  参与改正的观测角（十进制度）
 * @param {number} startAzimuth  用户输入的起算方位角（十进制度）
 * @param {'left'|'right'} angleType
 * @param {number} fBeta  角度闭合差（秒）
 * @param {boolean} [integerMode]
 * @param {'backsight'|'first'} [startAzBasis]
 */
function adjustAnglesAndAzimuths(obsAngles, startAzimuth, angleType, fBeta, integerMode, startAzBasis, edgeCount) {
  const n = obsAngles.length;
  let vArr;
  if (integerMode) {
    vArr = integerDistribute(-fBeta, 1, n, obsAngles.map(a => a.original));
  } else {
    const v = -fBeta / n;
    vArr = new Array(n).fill(v);
  }
  const adjusted = obsAngles.map((a, i) => ({
    name: a.name,
    original: a.original,
    correction: vArr[i],
    adjusted: a.original + vArr[i] / 3600
  }));

  const nEdges = edgeCount ?? n;
  const basis = startAzBasis === 'first' ? 'first' : 'backsight';
  const azimuths = [];

  // 后视：cur = 后视方向，推边后得各边方位角
  // 首边：先反推虚拟后视，使改正后第一条边仍等于输入的首边方位角
  let cur;
  if (basis === 'first') {
    const b0 = adjusted[0].adjusted;
    if (angleType === 'left') cur = normalize360(startAzimuth - b0 + 180);
    else cur = normalize360(startAzimuth + b0 - 180);
  } else {
    cur = normalize360(startAzimuth);
  }
  const effectiveBacksight = cur;

  for (let i = 0; i < nEdges; i++) {
    if (angleType === 'left') cur = normalize360(cur + adjusted[i].adjusted - 180);
    else cur = normalize360(cur - adjusted[i].adjusted + 180);
    azimuths.push(cur);
  }

  let lastAz = cur;
  if (n > nEdges) {
    if (angleType === 'left') lastAz = normalize360(cur + adjusted[nEdges].adjusted - 180);
    else lastAz = normalize360(cur - adjusted[nEdges].adjusted + 180);
  }

  return { adjusted, azimuths, lastAz, effectiveBacksight };
}

/**
 * 由方位角和边长算坐标增量（X=纵=北向, Y=横=东向）
 *   ΔX = D·cosα
 *   ΔY = D·sinα
 * @param {boolean} [roundedMode]  若 true：dx/dy 保留 3 位小数后再求和（与手工计算一致）
 */
function computeIncrements(stations, azimuths, roundedMode) {
  const n = stations.length;
  let sumDx = 0, sumDy = 0, sumD = 0;
  const incs = [];
  for (let i = 0; i < n; i++) {
    const az = azimuths[i];
    let dx = stations[i].distance * Math.cos(az * DEG);
    let dy = stations[i].distance * Math.sin(az * DEG);
    if (roundedMode) {
      dx = Math.round(dx * 1000) / 1000;
      dy = Math.round(dy * 1000) / 1000;
    }
    sumDx += dx;
    sumDy += dy;
    sumD += stations[i].distance;
    incs.push({ dx, dy, az, distance: stations[i].distance });
  }
  return { incs, sumDx, sumDy, sumD };
}

/**
 * 按边长比例分配 fx、fy 闭合差到各增量
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
 * @param {'backsight'|'first'} [params.startAzBasis]
 * @param {'left'|'right'} params.angleType
 * @param {Array<{name:string, deg:number, min:number, sec:number, distance:number}>} params.stations
 * @param {number} [params.angleLimit]
 * @param {number} [params.kLimit]
 * @param {boolean} [params.integerMode]
 * @param {boolean} [params.roundedMode]
 */
export function calcClosedTraverse(params) {
  const {
    startPoint, startAzimuth, startAzBasis,
    angleType, stations, angleLimit, kLimit, integerMode, roundedMode
  } = params;

  if (!Array.isArray(stations) || stations.length < 3) {
    throw new Error('闭合导线至少需要 3 个测站');
  }
  if (angleType !== 'left' && angleType !== 'right') {
    throw new Error('angleType 必须是 "left" 或 "right"');
  }

  const n = stations.length;
  const obs = stationsToDecimal(stations);

  // 1) 角度闭合差：Σβ - (n-2)·180°
  const sumBeta = obs.reduce((s, a) => s + a.original, 0);
  const sumBetaTheo = (n - 2) * 180;
  const fBeta = (sumBeta - sumBetaTheo) * 3600;            // 秒
  const fBetaLimit = angleLimit ?? 40 * Math.sqrt(n);
  const fBetaOver = Math.abs(fBeta) > fBetaLimit;

  // 2) 改正 + 方位角
  const { adjusted, azimuths, lastAz, effectiveBacksight } = adjustAnglesAndAzimuths(
    obs, startAzimuth, angleType, fBeta, integerMode, startAzBasis, n
  );
  const azClosureErr = angleDiffSeconds(lastAz, effectiveBacksight);

  // 3) 增量
  const { incs, sumDx, sumDy, sumD } = computeIncrements(obs, azimuths, roundedMode);
  // 闭合：理论 ΣΔX = 0, ΣΔY = 0
  const fx = sumDx, fy = sumDy;
  const fs = Math.sqrt(fx * fx + fy * fy);
  const k = sumD > 0 ? fs / sumD : 0;
  const kLimitVal = kLimit ?? 1 / 2000;
  const kOver = k > kLimitVal;

  // 4) 分配闭合差
  const adjIncs = distributeClosure(incs, fx, fy, sumD, integerMode);

  // 5) 坐标：coords[0]=起点，coords[i+1]=边 i 到达点
  const coords = [{ name: startPoint.name, x: startPoint.x, y: startPoint.y }];
  let cx = startPoint.x, cy = startPoint.y;
  for (let i = 0; i < n; i++) {
    cx += adjIncs[i].adjustedDx;
    cy += adjIncs[i].adjustedDy;
    const nextName = (i === n - 1) ? startPoint.name : stations[i + 1].name;
    coords.push({ name: nextName, x: cx, y: cy });
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
 * 附合导线（与最初 matching 逻辑一致 + 终点连接角）
 * startAzBasis: 'backsight' 后视 | 'first' 首边
 */
export function calcAttachedTraverse(params) {
  const {
    startPoint, startAzimuth, startAzBasis,
    endPoint, endAzimuth, endConnAngle,
    angleType, stations, angleLimit, kLimit, integerMode, roundedMode
  } = params;

  if (!Array.isArray(stations) || stations.length < 2) {
    throw new Error('附合导线至少需要 2 个测站（含起点）');
  }
  if (angleType !== 'left' && angleType !== 'right') {
    throw new Error('angleType 必须是 "left" 或 "right"');
  }

  const n = stations.length;
  const obsStations = stationsToDecimal(stations);
  const basis = startAzBasis === 'first' ? 'first' : 'backsight';

  let endConnDeg;
  if (typeof endConnAngle === 'number') {
    endConnDeg = endConnAngle;
  } else if (endConnAngle && typeof endConnAngle === 'object') {
    endConnDeg = dmsToDecimal(endConnAngle.deg, endConnAngle.min, endConnAngle.sec);
  } else {
    throw new Error('附合导线需要终点连接角 endConnAngle');
  }

  // 后视：全部站角 + 终点连接角参与改正
  // 首边：首边已知 → 起点角不参与改正（与最初「旧模型/首边」一致）
  const midAndEnd = [
    ...obsStations.slice(basis === 'first' ? 1 : 0).map(a => ({ name: a.name, original: a.original })),
    { name: endPoint.name, original: endConnDeg }
  ];
  const nAngles = midAndEnd.length;
  const sumBeta = midAndEnd.reduce((s, a) => s + a.original, 0);
  const alphaStart = normalize360(startAzimuth);

  let fBetaDeg;
  if (angleType === 'left') {
    fBetaDeg = alphaStart + sumBeta - endAzimuth - nAngles * 180;
  } else {
    fBetaDeg = alphaStart - sumBeta - endAzimuth + nAngles * 180;
  }
  fBetaDeg = ((fBetaDeg + 180) % 360 + 360) % 360 - 180;
  const fBeta = fBetaDeg * 3600;
  const fBetaLimit = angleLimit ?? 40 * Math.sqrt(nAngles);
  const fBetaOver = Math.abs(fBeta) > fBetaLimit;

  let vArr;
  if (integerMode) {
    vArr = integerDistribute(-fBeta, 1, nAngles, midAndEnd.map(a => a.original));
  } else {
    const v = -fBeta / nAngles;
    vArr = new Array(nAngles).fill(v);
  }
  const midAdjusted = midAndEnd.map((a, i) => ({
    name: a.name,
    original: a.original,
    correction: vArr[i],
    adjusted: a.original + vArr[i] / 3600
  }));

  let adjusted;
  if (basis === 'first') {
    adjusted = [
      {
        name: obsStations[0].name,
        original: obsStations[0].original,
        correction: 0,
        adjusted: obsStations[0].original
      },
      ...midAdjusted
    ];
  } else {
    adjusted = midAdjusted;
  }

  const azimuths = [];
  let cur;
  if (basis === 'first') {
    cur = normalize360(startAzimuth);
    azimuths.push(cur);
    for (let i = 0; i < n - 1; i++) {
      const beta = midAdjusted[i].adjusted;
      if (angleType === 'left') cur = normalize360(cur + beta - 180);
      else cur = normalize360(cur - beta + 180);
      azimuths.push(cur);
    }
  } else {
    cur = normalize360(startAzimuth);
    for (let i = 0; i < n; i++) {
      const beta = midAdjusted[i].adjusted;
      if (angleType === 'left') cur = normalize360(cur + beta - 180);
      else cur = normalize360(cur - beta + 180);
      azimuths.push(cur);
    }
  }

  const endBetaAdj = midAdjusted[midAdjusted.length - 1].adjusted;
  let lastAz;
  if (angleType === 'left') lastAz = normalize360(cur + endBetaAdj - 180);
  else lastAz = normalize360(cur - endBetaAdj + 180);
  const azClosureErr = angleDiffSeconds(lastAz, endAzimuth);

  const { incs, sumDx, sumDy, sumD } = computeIncrements(obsStations, azimuths, roundedMode);

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

  const adjIncs = distributeClosure(incs, fx, fy, sumD, integerMode);

  const coords = [{ name: startPoint.name, x: startPoint.x, y: startPoint.y }];
  let cx = startPoint.x, cy = startPoint.y;
  for (let i = 0; i < n; i++) {
    cx += adjIncs[i].adjustedDx;
    cy += adjIncs[i].adjustedDy;
    const nextName = (i === n - 1) ? endPoint.name : stations[i + 1].name;
    coords.push({ name: nextName, x: cx, y: cy });
  }

  const endAdj = adjusted[adjusted.length - 1];
  return {
    adjustedAngles: adjusted,
    azimuths,
    increments: adjIncs,
    coordinates: coords,
    endConnAngle: {
      original: endAdj.original,
      correction: endAdj.correction,
      adjusted: endAdj.adjusted
    },
    closure: {
      fBeta, fBetaLimit, fBetaOver,
      azimuthClosureError: azClosureErr,
      fx, fy, fs, k, kLimit: kLimitVal, kOver, sumD,
      endPointComputed: { x: endX, y: endY },
      endPointKnown: { x: endPoint.x, y: endPoint.y }
    }
  };
}
