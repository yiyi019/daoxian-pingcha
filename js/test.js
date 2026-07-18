// P1 自测：闭合 + 附合 导线平差
// 用 mock 数据对算法做端到端验证，所有期望值都给出了几何上的可推算结果

import { calcClosedTraverse, calcAttachedTraverse } from './traverse.js';
import { dmsToDecimal, decimalToDms, formatDms, formatSeconds, azimuthBetween, normalize360, DEG } from './dms.js';

let pass = 0, fail = 0;

function ok(cond, msg) {
  if (cond) { pass++; console.log(`  ✅ ${msg}`); }
  else { fail++; console.log(`  ❌ ${msg}`); }
}

function approxEq(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

function dmsEq(decimalA, decimalB, epsSec = 0.5) {
  return Math.abs(decimalA - decimalB) * 3600 < epsSec;
}

// ===================================================================
// Test 1: 完美正方形闭合导线（X=北, Y=东）
//   A(0,0) → B(100,0): α=0°(正北), 边长 100
//   B(100,0) → C(100,100): α=90°(正东), 边长 100
//   C(100,100) → D(0,100): α=180°(正南), 边长 100
//   D(0,100) → A(0,0): α=270°(正西), 边长 100
// 沿 N→E→S→W（顺时针），故各内角为右角 = 90°
// 期望: fβ=0, fx=fy=0, K=0, 坐标完全闭合
// ===================================================================
function testPerfectSquare() {
  console.log('\n[Test 1] 完美正方形闭合导线 (顺时针, 右角)');
  const r = calcClosedTraverse({
    startPoint: { name: 'A', x: 0, y: 0 },
    startAzimuth: 0,
    startAzBasis: 'first',
    angleType: 'right',
    stations: [
      { name: 'A', deg: 90, min: 0, sec: 0, distance: 100 },
      { name: 'B', deg: 90, min: 0, sec: 0, distance: 100 },
      { name: 'C', deg: 90, min: 0, sec: 0, distance: 100 },
      { name: 'D', deg: 90, min: 0, sec: 0, distance: 100 }
    ]
  });

  ok(approxEq(r.closure.fBeta, 0, 1e-9), `fβ = ${formatSeconds(r.closure.fBeta)} ≈ 0`);
  ok(approxEq(r.closure.fx, 0, 1e-9), `fx = ${r.closure.fx.toExponential(2)} ≈ 0`);
  ok(approxEq(r.closure.fy, 0, 1e-9), `fy = ${r.closure.fy.toExponential(2)} ≈ 0`);
  ok(approxEq(r.closure.k, 0, 1e-12), `K = 0`);

  ok(dmsEq(r.azimuths[0], 0), `α_AB = ${formatDms(r.azimuths[0])} ≈ 0°`);
  ok(dmsEq(r.azimuths[1], 90), `α_BC = ${formatDms(r.azimuths[1])} ≈ 90°`);
  ok(dmsEq(r.azimuths[2], 180), `α_CD = ${formatDms(r.azimuths[2])} ≈ 180°`);
  ok(dmsEq(r.azimuths[3], 270), `α_DA = ${formatDms(r.azimuths[3])} ≈ 270°`);

  // 坐标: A(0,0), B(100,0), C(100,100), D(0,100)
  ok(approxEq(r.coordinates[0].x, 0) && approxEq(r.coordinates[0].y, 0), `A = (${r.coordinates[0].x}, ${r.coordinates[0].y})`);
  ok(approxEq(r.coordinates[1].x, 100) && approxEq(r.coordinates[1].y, 0), `B = (${r.coordinates[1].x}, ${r.coordinates[1].y})`);
  ok(approxEq(r.coordinates[2].x, 100) && approxEq(r.coordinates[2].y, 100), `C = (${r.coordinates[2].x}, ${r.coordinates[2].y})`);
  ok(approxEq(r.coordinates[3].x, 0) && approxEq(r.coordinates[3].y, 100), `D = (${r.coordinates[3].x}, ${r.coordinates[3].y})`);

  return r;
}

// ===================================================================
// Test 2: 正方形加角度误差（无距离误差）
//   角度: 89°59'58, 90°00'05, 90°00'00, 89°59'52
//   fβ = -5", 各角 +1.25"
//   由于对称，距离误差应几乎被抵消，fx/fy 仍接近 0
// ===================================================================
function testSquareWithAngleError() {
  console.log('\n[Test 2] 正方形+角度误差 (fβ 应 = -5")');
  const r = calcClosedTraverse({
    startPoint: { name: 'A', x: 0, y: 0 },
    startAzimuth: 0,
    startAzBasis: 'first',
    angleType: 'right',
    stations: [
      { name: 'A', deg: 89, min: 59, sec: 58, distance: 100 },
      { name: 'B', deg: 90, min: 0,  sec: 5,  distance: 100 },
      { name: 'C', deg: 90, min: 0,  sec: 0,  distance: 100 },
      { name: 'D', deg: 89, min: 59, sec: 52, distance: 100 }
    ]
  });

  ok(dmsEq(r.closure.fBeta, -5, 0.01), `fβ = ${formatSeconds(r.closure.fBeta)} ≈ -5"`);
  ok(Math.abs(r.closure.fx) < 0.01, `|fx| = ${r.closure.fx.toExponential(2)} < 0.01`);
  ok(Math.abs(r.closure.fy) < 0.01, `|fy| = ${r.closure.fy.toExponential(2)} < 0.01`);
  ok(r.closure.k < 1e-4, `K = ${r.closure.k.toExponential(2)} 极小 (无距离误差)`);

  // 改正数: 每角 +1.25"
  const vBeta = r.adjustedAngles[0].correction;
  ok(approxEq(vBeta, 1.25, 1e-9), `vβ_i = ${vBeta}″ ≈ +1.25"`);

  // 改正后角和 = (n-2)·180 = 360
  const sumAdj = r.adjustedAngles.reduce((s, a) => s + a.adjusted, 0);
  ok(approxEq(sumAdj, 360, 1e-9), `Σβ' = ${sumAdj.toFixed(9)} ≈ 360°`);

  return r;
}

// ===================================================================
// Test 3: 正方形加距离误差（无角度误差）
//   距离: 100.05, 99.98, 100.02, 99.95  ΣD = 400
//   方位角: 0°, 90°, 180°, 270°
//   ΔX = 100.05, 0, -100.02, 0     ΣΔX = 0.03
//   ΔY = 0, 99.98, 0, -99.95       ΣΔY = 0.03
//   fx = 0.03, fy = 0.03,  fs ≈ 0.0424
//   改正按距离比例分配：v_i = -0.03 * D_i / 400
//   改正后 B ≈ (100.0425, -0.0075), C ≈ (100.0350, 99.9650), D ≈ (0.0075, 99.9575)
// ===================================================================
function testSquareWithDistanceError() {
  console.log('\n[Test 3] 正方形+距离误差 (fβ=0, fx/fy≠0)');
  const r = calcClosedTraverse({
    startPoint: { name: 'A', x: 0, y: 0 },
    startAzimuth: 0,
    startAzBasis: 'first',
    angleType: 'right',
    stations: [
      { name: 'A', deg: 90, min: 0, sec: 0, distance: 100.05 },
      { name: 'B', deg: 90, min: 0, sec: 0, distance: 99.98  },
      { name: 'C', deg: 90, min: 0, sec: 0, distance: 100.02 },
      { name: 'D', deg: 90, min: 0, sec: 0, distance: 99.95  }
    ]
  });

  ok(approxEq(r.closure.fBeta, 0, 1e-9), `fβ = ${formatSeconds(r.closure.fBeta)} ≈ 0`);
  ok(approxEq(r.closure.fx, 0.03, 1e-6), `fx = ${r.closure.fx.toFixed(4)} ≈ 0.03`);
  ok(approxEq(r.closure.fy, 0.03, 1e-6), `fy = ${r.closure.fy.toFixed(4)} ≈ 0.03`);
  ok(approxEq(r.closure.fs, Math.sqrt(0.03**2 + 0.03**2), 1e-6), `fs = ${r.closure.fs.toFixed(4)}`);

  const k = r.closure.k;
  ok(k < 1/2000, `K = 1/${(1/k).toFixed(0)} 满足 1/2000 限差`);

  // 改正后坐标: B(100.0425, -0.0075), C(100.0350, 99.9650), D(0.0075, 99.9575)
  const B = r.coordinates[1], C = r.coordinates[2], D = r.coordinates[3];
  ok(Math.abs(B.x - 100.0425) < 1e-3, `B.x ≈ 100.0425 (got ${B.x})`);
  ok(Math.abs(B.y - (-0.0075)) < 1e-3, `B.y ≈ -0.0075 (got ${B.y})`);
  ok(Math.abs(C.x - 100.0350) < 1e-3, `C.x ≈ 100.0350 (got ${C.x})`);
  ok(Math.abs(C.y - 99.9650) < 1e-3, `C.y ≈ 99.9650 (got ${C.y})`);
  ok(Math.abs(D.x - 0.0075) < 1e-3, `D.x ≈ 0.0075 (got ${D.x})`);
  ok(Math.abs(D.y - 99.9575) < 1e-3, `D.y ≈ 99.9575 (got ${D.y})`);

  return r;
}

// ===================================================================
// Test 4: 完美附合导线 (沿东西向)
//   起点 A(0,0)  α=90° (正东)
//   终点 E(0,400) α=90° (正东)   —— 终止方位角 = 起始方位角
//   4 条边: 100, 100, 100, 100 全部正东
//   4 个左角均为 180°（直行）
//   期望: fβ=0, 终点坐标 E(0,400), fx=fy=0
//   (坐标约定：X=北, Y=东; 所以向东 400m → Y 增加 400)
// ===================================================================
function testPerfectAttached() {
  console.log('\n[Test 4] 完美直线附合导线 (沿东向, 左角=180°, 4 站)');
  const r = calcAttachedTraverse({
    startPoint: { name: 'A', x: 0,   y: 0 },
    startAzimuth: 90,
    startAzBasis: 'first',
    endPoint:   { name: 'E', x: 0,   y: 400 },
    endAzimuth: 90,
    endConnAngle: { deg: 180, min: 0, sec: 0 },
    angleType: 'left',
    stations: [
      { name: 'A', deg: 0,   min: 0, sec: 0, distance: 100 },
      { name: 'B', deg: 180, min: 0, sec: 0, distance: 100 },
      { name: 'C', deg: 180, min: 0, sec: 0, distance: 100 },
      { name: 'D', deg: 180, min: 0, sec: 0, distance: 100 }
    ]
  });

  ok(approxEq(r.closure.fBeta, 0, 1e-9), `fβ = ${formatSeconds(r.closure.fBeta)} ≈ 0`);
  ok(approxEq(r.closure.fx, 0, 1e-9), `fx = ${r.closure.fx.toExponential(2)} ≈ 0`);
  ok(approxEq(r.closure.fy, 0, 1e-9), `fy = ${r.closure.fy.toExponential(2)} ≈ 0`);

  // 方位角全部 90° (东)
  for (let i = 0; i < 4; i++) {
    ok(dmsEq(r.azimuths[i], 90), `α_${i+1} = ${formatDms(r.azimuths[i])} ≈ 90°`);
  }

  // 坐标: A(0,0), B(0,100), C(0,200), D(0,300), E(0,400)
  ok(approxEq(r.coordinates[1].x, 0) && approxEq(r.coordinates[1].y, 100), `B = (${r.coordinates[1].x}, ${r.coordinates[1].y})`);
  ok(approxEq(r.coordinates[2].x, 0) && approxEq(r.coordinates[2].y, 200), `C = (${r.coordinates[2].x}, ${r.coordinates[2].y})`);
  ok(approxEq(r.coordinates[3].x, 0) && approxEq(r.coordinates[3].y, 300), `D = (${r.coordinates[3].x}, ${r.coordinates[3].y})`);
  ok(approxEq(r.coordinates[4].x, 0) && approxEq(r.coordinates[4].y, 400), `E = (${r.coordinates[4].x}, ${r.coordinates[4].y})`);

  return r;
}

// ===================================================================
// Test 5: 附合导线带角度误差 (沿东向)
//   起点 A(0,0)  α=90°
//   终点 E(0,400) α=90°
//   4 个左角: 180°00′10, 179°59′50, 180°00′05, 180°00′00
//   Σβ = 720°00′05"
//   fβ = α_起 + Σβ - α_终 - n·180° = 90 + 720°00′05" - 90 - 4·180 = +5"
//   期望: fβ=+5", fx=fy=0 (无距离误差)
// ===================================================================
function testAttachedWithAngleError() {
  console.log('\n[Test 5] 附合导线+角度误差 (期望 fβ=+5")');
  const r = calcAttachedTraverse({
    startPoint: { name: 'A', x: 0, y: 0 },
    startAzimuth: 90,
    startAzBasis: 'first',
    endPoint:   { name: 'E', x: 0, y: 400 },
    endAzimuth: 90,
    endConnAngle: { deg: 180, min: 0, sec: 0 },
    angleType: 'left',
    stations: [
      { name: 'A', deg: 0,   min: 0, sec: 0,  distance: 100 },
      { name: 'B', deg: 180, min: 0, sec: 10, distance: 100 },
      { name: 'C', deg: 179, min: 59, sec: 50, distance: 100 },
      { name: 'D', deg: 180, min: 0, sec: 5,  distance: 100 }
    ]
  });

  ok(dmsEq(r.closure.fBeta, 5, 0.01), `fβ = ${formatSeconds(r.closure.fBeta)} ≈ +5"`);
  ok(Math.abs(r.closure.fx) < 0.01, `|fx| = ${r.closure.fx.toExponential(2)} < 0.01 (无距离误差)`);
  ok(Math.abs(r.closure.fy) < 0.01, `|fy| = ${r.closure.fy.toExponential(2)} < 0.01 (无距离误差)`);
  ok(r.closure.k < 1e-4, `K = ${r.closure.k.toExponential(2)} 极小`);

  return r;
}

// ===================================================================
// Test 6: DMS 转换工具
// ===================================================================
function testDmsUtils() {
  console.log('\n[Test 6] DMS 工具函数');
  ok(approxEq(dmsToDecimal(123, 45, 6), 123.7516666, 1e-6), '123°45′06″ = 123.7516666°');
  ok(approxEq(dmsToDecimal(0, 0, 30), 0.0083333, 1e-6), '0°00′30″ = 0.008333°');
  ok(approxEq(dmsToDecimal(-90, 30, 0), -90.5, 1e-9), '-90°30′00″ = -90.5°');

  const r = decimalToDms(123.7516666);
  ok(r.deg === 123 && r.min === 45 && Math.abs(r.sec - 6) < 0.01, `123.7516 → ${r.deg}°${r.min}′${r.sec}″`);

  const r2 = decimalToDms(0.005);
  ok(r2.deg === 0 && r2.min === 0 && Math.abs(r2.sec - 18) < 0.01, `0.005 → ${r2.deg}°${r2.min}′${r2.sec}″`);

  // 边界: 60 秒进位
  const r3 = decimalToDms(10.9999999);
  ok(r3.deg === 11 && r3.min === 0 && r3.sec === 0, `10.9999... → ${r3.deg}°${r3.min}′${r3.sec}″ (60秒进位)`);

  console.log(`  formatDms(123.7516666) = "${formatDms(123.7516666)}"`);
  console.log(`  formatDms(0)          = "${formatDms(0)}"`);
  console.log(`  formatDms(-45.5)      = "${formatDms(-45.5)}"`);
}

// ===================================================================
// Test 7: 河海大学《测量学》(公开教材例题，5 站闭合导线对拍)
//   起算:  A(100, 100),  α_AB = 96°51'36"
//   5 站观测角(右角):
//     121°28'00"  108°27'00"  84°10'30"  135°48'00"  90°07'30"
//   5 站边长(m):
//     201.58  263.41  241.00  83.84  231.32
//   角和实测 = 540°01'00"  理论 = (5-2)·180 = 540°  →  fβ = +60"
//   教材公布: fβ允 = ±60"·√5 ≈ ±134.16"  (4 等导线限差)
//   vβ 每角 = -12"  (平均分配)
//   改正后角: 121°27'48" 108°26'48" 84°10'18" 135°47'48" 90°07'18"
//   推方位角(右角公式 α_next = α_prev - β + 180):
//     α_AB=96°51'36" → α_BC=155°23'48" → α_CD=226°57'00"
//     → α_DE=322°46'42" → α_EA=6°58'54"   → 闭合回 α_AB=96°51'36" ✓
//   教材公布坐标增量闭合差: fx=+0.25  fy=-0.22  fs=0.33  K=1/3400
//   (注: 本测试组 ΣD=1021.15m, 与教材公布 ΣD≈1132m 不一致 ——
//    公开搜索结果转录的 5 个边长数据与教材原表存在差异 (约 -10%);
//    本测试不验证 fs/K 的具体数值, 仅打印参考。
//    角度相关 8 项关键值 (fβ、vβ、5 个改正后角、α_BC、α 闭合) 严格匹配教材)
// ===================================================================
function testTextbookExample() {
  console.log('\n[Test 7] 河海大学《测量学》5 站闭合导线 (教材例题)');
  const r = calcClosedTraverse({
    startPoint: { name: 'A', x: 100, y: 100 },
    startAzimuth: dmsToDecimal(96, 51, 36),
    startAzBasis: 'first',
    angleType: 'right',
    angleLimit: 60 * Math.sqrt(5),
    kLimit: 1 / 2000,
    stations: [
      { name: 'A', deg:  90, min:  7, sec: 30, distance: 201.58 },
      { name: 'B', deg: 121, min: 28, sec:  0, distance: 263.41 },
      { name: 'C', deg: 108, min: 27, sec:  0, distance: 241.00 },
      { name: 'D', deg:  84, min: 10, sec: 30, distance:  83.84 },
      { name: 'E', deg: 135, min: 48, sec:  0, distance: 231.32 }
    ]
  });

  ok(dmsEq(r.closure.fBeta, 60, 0.01),
     `fβ = ${formatSeconds(r.closure.fBeta)} ≈ +60"`);
  ok(Math.abs(r.closure.fBeta) < r.closure.fBetaLimit,
     `|fβ|=${Math.abs(r.closure.fBeta).toFixed(2)}" < fβ允=${r.closure.fBetaLimit.toFixed(2)}"  (4 等导线)`);

  const vBeta = r.adjustedAngles[0].correction;
  ok(approxEq(vBeta, -12, 0.01),
     `vβ_i = ${vBeta.toFixed(2)}" ≈ -12"`);

  const sumAdj = r.adjustedAngles.reduce((s, a) => s + a.adjusted, 0);
  ok(approxEq(sumAdj, 540, 1e-9),
     `Σβ' = ${sumAdj.toFixed(9)}° ≈ 540° (5 站闭合理论值)`);

  const expAdj = [
    dmsToDecimal( 90,  7, 18),
    dmsToDecimal(121, 27, 48),
    dmsToDecimal(108, 26, 48),
    dmsToDecimal( 84, 10, 18),
    dmsToDecimal(135, 47, 48)
  ];
  for (let i = 0; i < 5; i++) {
    ok(dmsEq(r.adjustedAngles[i].adjusted, expAdj[i], 0.5),
       `β_${r.adjustedAngles[i].name}' = ${formatDms(r.adjustedAngles[i].adjusted)} ≈ ${formatDms(expAdj[i])}`);
  }

  ok(dmsEq(r.azimuths[0], dmsToDecimal(96, 51, 36), 0.5),
     `α_AB = ${formatDms(r.azimuths[0])} ≈ 96°51'36"`);
  ok(dmsEq(r.azimuths[1], dmsToDecimal(155, 23, 48), 0.5),
     `α_BC = ${formatDms(r.azimuths[1])} ≈ 155°23'48"  ← 教材公布关键值`);

  // 6) 方位角闭合差 ≈ 0
  ok(Math.abs(r.closure.azimuthClosureError) < 0.01,
     `α 推算闭合差 = ${r.closure.azimuthClosureError.toFixed(6)}" ≈ 0`);

  // 7) 坐标回到起点 (平差后)
  const finalPt = r.coordinates[r.coordinates.length - 1];
  ok(approxEq(finalPt.x, 100, 0.01) && approxEq(finalPt.y, 100, 0.01),
     `闭合点 = (${finalPt.x.toFixed(3)}, ${finalPt.y.toFixed(3)}) ≈ (100, 100)`);

  // 8) 长度闭合差分量 (数值范围合理即可，因教材 K=1/3400 基于 1132m 总边长,
  //    而本组数据 ΣD=1021.15m; 距离是公开转录，可能与教材原表略有差异)
  console.log(`  边长总和 ΣD = ${r.closure.sumD.toFixed(2)} m`);
  console.log(`  fx = ${r.closure.fx.toFixed(4)} m   fy = ${r.closure.fy.toFixed(4)} m`);
  console.log(`  fs = ${r.closure.fs.toFixed(4)} m   K = 1/${r.closure.k > 0 ? Math.round(1 / r.closure.k).toLocaleString() : '∞'}` +
              (r.closure.kOver ? '  (教材公布 1/3400 < 1/2000 限差)' : ''));

  return r;
}

// ===================================================================
// Test 8: azimuthBetween 反算方位角 (X=北, Y=东)
//   公式: α = atan2(ΔY, ΔX), 顺时针从北起, 归一化到 [0, 360°)
// ===================================================================
function testAzimuthBetween() {
  console.log('\n[Test 8] azimuthBetween 反算方位角 (X=北, Y=东)');
  const A = { x: 0, y: 0 };

  // 4 主方向 + 4 隅角
  ok(approxEq(azimuthBetween(A, { x:  1, y:  0 }),   0, 1e-9), 'A→(1, 0)   =   0° (正北)');
  ok(approxEq(azimuthBetween(A, { x:  1, y:  1 }),  45, 1e-9), 'A→(1, 1)   =  45° (东北)');
  ok(approxEq(azimuthBetween(A, { x:  0, y:  1 }),  90, 1e-9), 'A→(0, 1)   =  90° (正东)');
  ok(approxEq(azimuthBetween(A, { x: -1, y:  1 }), 135, 1e-9), 'A→(-1, 1)  = 135° (东南)');
  ok(approxEq(azimuthBetween(A, { x: -1, y:  0 }), 180, 1e-9), 'A→(-1, 0)  = 180° (正南)');
  ok(approxEq(azimuthBetween(A, { x: -1, y: -1 }), 225, 1e-9), 'A→(-1, -1) = 225° (西南)');
  ok(approxEq(azimuthBetween(A, { x:  0, y: -1 }), 270, 1e-9), 'A→(0, -1)  = 270° (正西)');
  ok(approxEq(azimuthBetween(A, { x:  1, y: -1 }), 315, 1e-9), 'A→(1, -1)  = 315° (西北)');

  // 河海大学例题: A(100,100), α_AB = 96°51'36", 取 D=100m 算出 B, 再反算
  const az = dmsToDecimal(96, 51, 36);
  const D = 100;
  const B = {
    x: 100 + D * Math.cos(az * DEG),
    y: 100 + D * Math.sin(az * DEG)
  };
  const back = azimuthBetween({ x: 100, y: 100 }, B);
  ok(dmsEq(back, az, 0.5),
     `A(100,100)→B(${B.x.toFixed(3)},${B.y.toFixed(3)}) = ${formatDms(back)} ≈ 96°51'36"`);

  // 边界
  ok(azimuthBetween(null, B) === null, 'null 入参 → null');
  ok(azimuthBetween({ x: 0, y: 0 }, { x: 0, y: 0 }) === null, '两点重合 → null');
  ok(azimuthBetween({ x: NaN, y: 0 }, B) === null, 'NaN 入参 → null');

  // 大坐标平移 (应保持方位角不变)
  const shifted = azimuthBetween({ x: 12345.678, y: -987.654 }, { x: 12345.678 + 1, y: -987.654 });
  ok(approxEq(shifted, 0, 1e-9), '平移不影响方位角 (仍为 0°)');
}

// ===================================================================
// Test 9: 闭合导线, 起始方位角由两点反算
//   A(100,100)  B ≈ (88.169, 199.302)  →  α_AB = 96°51'36"
//   4 站正方形 (90° 右角), fβ 应 = 0
// ===================================================================
function testClosedWithReverseAzimuth() {
  console.log('\n[Test 9] 闭合导线 + 起始方位角由两点反算');
  const az = dmsToDecimal(96, 51, 36);
  const A = { x: 100, y: 100 };
  const B = {
    x: A.x + 100 * Math.cos(az * DEG),
    y: A.y + 100 * Math.sin(az * DEG)
  };
  const azComputed = azimuthBetween(A, B);

  const r = calcClosedTraverse({
    startPoint: { name: 'A', x: A.x, y: A.y },
    startAzimuth: azComputed,
    startAzBasis: 'first',
    angleType: 'right',
    stations: [
      { name: 'A', deg: 90, min: 0, sec: 0, distance: 100 },
      { name: 'B', deg: 90, min: 0, sec: 0, distance: 100 },
      { name: 'C', deg: 90, min: 0, sec: 0, distance: 100 },
      { name: 'D', deg: 90, min: 0, sec: 0, distance: 100 }
    ]
  });

  ok(dmsEq(r.azimuths[0], az, 0.5),
     `α_AB = ${formatDms(r.azimuths[0])} ≈ 96°51'36" (反算后填入)`);
  ok(approxEq(r.closure.fBeta, 0, 1e-9), `fβ = 0 (正方形)`);
  ok(approxEq(r.closure.fx, 0, 1e-9), `fx ≈ 0`);
  ok(approxEq(r.closure.fy, 0, 1e-9), `fy ≈ 0`);
  ok(dmsEq(r.azimuths[1], dmsToDecimal(186, 51, 36), 0.5),
     `α_BC = ${formatDms(r.azimuths[1])} ≈ 186°51'36"`);
}

// ===================================================================
// Test 10: 整数修正模式 (v_β 整秒 / vx, vy 为 0.001 整数倍)
//   a) 河海 5 站例题：v_β/vx/vy 全部为整数倍，sum 严格闭合
//   b) 4 角 f_β = -25″ 构造 case：base=-6, remainder=-1 → 1 角 -7, 3 角 -6
// ===================================================================
function testIntegerMode() {
  console.log('\n[Test 10] 整数修正模式');

  // a) 河海 5 站闭合例题 + integerMode
  const r = calcClosedTraverse({
    startPoint: { name: 'A', x: 100, y: 100 },
    startAzimuth: dmsToDecimal(96, 51, 36),
    startAzBasis: 'first',
    angleType: 'right',
    integerMode: true,
    stations: [
      { name: 'A', deg: 90,  min: 7,  sec: 30, distance: 201.58 },
      { name: 'B', deg: 121, min: 28, sec: 0,  distance: 263.41 },
      { name: 'C', deg: 108, min: 27, sec: 0,  distance: 241.00 },
      { name: 'D', deg: 84,  min: 10, sec: 30, distance: 83.84  },
      { name: 'E', deg: 135, min: 48, sec: 0,  distance: 231.32 }
    ]
  });

  // v_β 全部为整数秒
  const vBetaAllInt = r.adjustedAngles.every(a => Math.abs(a.correction - Math.round(a.correction)) < 1e-9);
  ok(vBetaAllInt, 'v_β 全部为整数秒');

  // Σv_β 严格 = -f_β
  const sumV = r.adjustedAngles.reduce((s, a) => s + a.correction, 0);
  ok(approxEq(sumV, -r.closure.fBeta, 1e-6),
     `Σv_β = ${sumV.toFixed(2)} ≈ -f_β = ${(-r.closure.fBeta).toFixed(2)}`);

  // vx/vy 全部为 0.001 整数倍
  const vxAllMM = r.increments.every(inc => Math.abs(inc.vx * 1000 - Math.round(inc.vx * 1000)) < 1e-9);
  const vyAllMM = r.increments.every(inc => Math.abs(inc.vy * 1000 - Math.round(inc.vy * 1000)) < 1e-9);
  ok(vxAllMM, 'vx 全部为 1mm 整数倍');
  ok(vyAllMM, 'vy 全部为 1mm 整数倍');

  // Σvx = -fx, Σvy = -fy（容差 0.002m = 2mm，5 站累计舍入可达 ~2.5mm）
  const sumVx = r.increments.reduce((s, inc) => s + inc.vx, 0);
  const sumVy = r.increments.reduce((s, inc) => s + inc.vy, 0);
  ok(approxEq(sumVx, -r.closure.fx, 2e-3),
     `Σvx = ${sumVx.toFixed(4)} ≈ -fx = ${(-r.closure.fx).toFixed(4)}`);
  ok(approxEq(sumVy, -r.closure.fy, 2e-3),
     `Σvy = ${sumVy.toFixed(4)} ≈ -fy = ${(-r.closure.fy).toFixed(4)}`);

  // b) 4 角构造：3 个 90° + 1 个 89°59'35" → 和 = 359.99306° → f_β = -25″
  //    期望 v_β 全部为整数，和 = -25；分布 = [-7,-6,-6,-6] 或任意 1 角 -7 + 3 角 -6
  const r2 = calcClosedTraverse({
    startPoint: { name: 'A', x: 0, y: 0 },
    startAzimuth: 0,
    startAzBasis: 'first',
    angleType: 'right',
    integerMode: true,
    stations: [
      { name: 'A', deg: 90, min: 0,  sec: 0,  distance: 100 },
      { name: 'B', deg: 90, min: 0,  sec: 0,  distance: 100 },
      { name: 'C', deg: 90, min: 0,  sec: 0,  distance: 100 },
      { name: 'D', deg: 89, min: 59, sec: 35, distance: 100 }
    ]
  });
  const sumV2 = r2.adjustedAngles.reduce((s, a) => s + a.correction, 0);
  const allInt2 = r2.adjustedAngles.every(a => Math.abs(a.correction - Math.round(a.correction)) < 1e-9);
  const vals = r2.adjustedAngles.map(a => a.correction);
  const minV = Math.min(...vals), maxV = Math.max(...vals);
  ok(approxEq(r2.closure.fBeta, -25, 1e-3), `f_β = ${r2.closure.fBeta.toFixed(3)} ≈ -25″`);
  ok(allInt2, '4 角 f_β=-25″: v_β 全部为整数');
  ok(approxEq(sumV2, -r2.closure.fBeta, 1e-6), `Σv_β = ${sumV2} ≈ -f_β = ${(-r2.closure.fBeta).toFixed(3)}`);
  // largest-remainder 不变量：4 个整数和 = 25，且 max - min = 1
  ok(maxV - minV === 1,
     `分布 = largest-remainder（极差 = 1）：[${vals.join(', ')}]，max-min = ${maxV - minV}`);
}

// ===================================================================
// Test 11: 附合导线（4 站，带角度误差与距离误差）
//   已知起算点 A(1000.000, 1000.000)，起算方位角 α_AB = 45°
//   已知终算点 E(880.000, 1291.421356)，终算方位角 α_EF = 135°
//   测站数据（左角，观测距离）：
//     B: 225°00'10", 100.020m  (AB 边)
//     C: 225°00'05", 149.970m  (BC 边)
//     D: 224°59'50", 100.010m  (CD 边)
//     E: 135°00'15", 120.030m  (DE 边)
//   理论角度之和（左角公式）: fβ = α_AB + Σβ - α_EF - n*180 = 45 + (910°00'20") - 135 - 720 = +20"
//   平差角度：每个角改正数 -5"，改正后角分别为：
//     B: 225°00'05"
//     C: 225°00'00"
//     D: 224°59'45"
//     E: 135°00'10"
//   改正后方位角：
//     α_BC = 90°00'05"
//     α_CD = 135°00'05"
//     α_DE = 179°59'50"
//     α_EF = 135°00'00" (符合已知)
//   经计算: 
//     fx = -0.028278 m, fy = -0.004682 m, fs = 0.028663 m
//     ΣD = 470.030 m, K ≈ 1 / 16398
//   验证最终坐标平差精度
// ===================================================================
function testAttachedTraverseWithErrors() {
  console.log('\n[Test 11] 附合导线平差 (4 站, 带角度和距离误差)');
  const r = calcAttachedTraverse({
    startPoint: { name: 'A', x: 1000.000, y: 1000.000 },
    startAzimuth: 45.0,
    startAzBasis: 'first',
    endPoint: { name: 'E', x: 880.000, y: 1291.421356 },
    endAzimuth: 135.0,
    endConnAngle: { deg: 135, min: 0, sec: 15 },
    angleType: 'left',
    stations: [
      { name: 'A', deg: 0,   min: 0, sec: 0,  distance: 100.020 },
      { name: 'B', deg: 225, min: 0, sec: 10, distance: 149.970 },
      { name: 'C', deg: 225, min: 0, sec:  5, distance: 100.010 },
      { name: 'D', deg: 224, min: 59, sec: 50, distance: 120.030 }
    ]
  });

  ok(dmsEq(r.closure.fBeta, 20, 0.01), `fβ = ${formatSeconds(r.closure.fBeta)} ≈ +20"`);
  ok(approxEq(r.adjustedAngles[0].correction, 0, 0.01), `vβ_A = 0 (首边模式)`);
  ok(approxEq(r.adjustedAngles[1].correction, -5, 0.01), `vβ_B ≈ -5"`);
  ok(approxEq(r.adjustedAngles[4].correction, -5, 0.01), `vβ_E ≈ -5"`);
  ok(dmsEq(r.azimuths[0], 45.0, 0.5), `α_AB = ${formatDms(r.azimuths[0])} ≈ 45°`);
  ok(dmsEq(r.azimuths[3], dmsToDecimal(179, 59, 50), 0.5), `α_DE ≈ 179°59'50"`);
  ok(approxEq(r.closure.fx, -0.028278, 1e-4), `fx ≈ -0.028278m`);
  ok(approxEq(r.closure.fy, -0.004682, 1e-4), `fy ≈ -0.004682m`);
  const finalPt = r.coordinates[r.coordinates.length - 1];
  ok(approxEq(finalPt.x, 880.000, 1e-3) && approxEq(finalPt.y, 1291.421356, 1e-3),
     `E = (${finalPt.x.toFixed(3)}, ${finalPt.y.toFixed(3)})`);
  return r;
}

// ===================================================================
// Test 12: 闭合导线（6 站，带角度误差与距离误差）
//   已知点 A(100.000, 100.000)，起算方位角 α_AB = 90.0°
//   测站数据（左角，观测距离）：
//     B: 116°34'00", 111.800m
//     C: 126°52'10", 111.810m
//     D: 116°34'00",  99.995m
//     E: 116°33'55", 111.805m
//     F: 126°52'15", 111.798m
//     A: 116°33'50", 100.005m
//   理论内角之和：(6 - 2) * 180 = 720°
//   观测内角之和 = 720°00'10"  ->  fβ = +10"
//   改正后角度和 = 720°00'00"
//   坐标增量闭合差以及坐标改正数分配
// ===================================================================
function testClosedTraverseSixStations() {
  console.log('\n[Test 12] 闭合导线平差 (6 站, 带角度和距离误差)');
  const r = calcClosedTraverse({
    startPoint: { name: 'A', x: 100.000, y: 100.000 },
    startAzimuth: 90.0,
    startAzBasis: 'first',
    angleType: 'left',
    stations: [
      { name: 'A', deg: 116, min: 33, sec: 50, distance: 111.800 },
      { name: 'B', deg: 116, min: 34, sec:  0, distance: 111.810 },
      { name: 'C', deg: 126, min: 52, sec: 10, distance:  99.995 },
      { name: 'D', deg: 116, min: 34, sec:  0, distance: 111.805 },
      { name: 'E', deg: 116, min: 33, sec: 55, distance: 111.798 },
      { name: 'F', deg: 126, min: 52, sec: 15, distance: 100.005 }
    ]
  });

  ok(dmsEq(r.closure.fBeta, 10, 0.01), `fβ = ${formatSeconds(r.closure.fBeta)} ≈ +10"`);

  const sumAdj = r.adjustedAngles.reduce((s, a) => s + a.adjusted, 0);
  ok(approxEq(sumAdj, 720, 1e-9), `Σβ' = ${sumAdj.toFixed(9)}° ≈ 720°`);

  ok(r.closure.k < 1 / 5000, `K = 1/${Math.round(1 / r.closure.k)} < 1/5000`);

  const finalPt = r.coordinates[r.coordinates.length - 1];
  ok(approxEq(finalPt.x, 100.000, 1e-3) && approxEq(finalPt.y, 100.000, 1e-3),
     `A_end = (${finalPt.x.toFixed(3)}, ${finalPt.y.toFixed(3)}) ≈ (100.000, 100.000)`);

  return r;
}


// ===================================================================
// 打印示例结果（用 Test 3 的结果，模拟 Excel 风格表）
// ===================================================================
function printExcelLikeTable(r, title) {
  console.log(`\n  📋 ${title}`);
  console.log('  ' + '点'.padEnd(4) +
    '观测角'.padEnd(14) + '改正后角值'.padEnd(14) +
    '方位角'.padEnd(14) + '边长'.padStart(8) +
    "X'".padStart(10) + "Y'".padStart(10) +
    'vx'.padStart(8) + 'vy'.padStart(8) +
    'ΔX'.padStart(10) + 'ΔY'.padStart(10) +
    'X'.padStart(12) + 'Y'.padStart(12));
  console.log('  ' + '-'.repeat(136));
  const nEdge = r.increments.length;
  for (let i = 0; i < nEdge; i++) {
    console.log('  ' +
      r.adjustedAngles[i].name.padEnd(4) +
      formatDms(r.adjustedAngles[i].original).padEnd(14) +
      formatDms(r.adjustedAngles[i].adjusted).padEnd(14) +
      formatDms(r.azimuths[i]).padEnd(14) +
      r.increments[i].distance.toFixed(2).padStart(8) +
      r.increments[i].dx.toFixed(4).padStart(10) +
      r.increments[i].dy.toFixed(4).padStart(10) +
      r.increments[i].vx.toFixed(4).padStart(8) +
      r.increments[i].vy.toFixed(4).padStart(8) +
      r.increments[i].adjustedDx.toFixed(4).padStart(10) +
      r.increments[i].adjustedDy.toFixed(4).padStart(10) +
      r.coordinates[i + 1].x.toFixed(3).padStart(12) +
      r.coordinates[i + 1].y.toFixed(3).padStart(12));
  }
  if (r.endConnAngle) {
    console.log('  ' +
      (r.adjustedAngles[nEdge]?.name || 'E').padEnd(4) +
      formatDms(r.endConnAngle.original).padEnd(14) +
      formatDms(r.endConnAngle.adjusted).padEnd(14) +
      '(终点连接角)'.padEnd(14));
  }
  const c = r.closure;
  console.log('  ' + '-'.repeat(120));
  console.log(`  fβ = ${formatSeconds(c.fBeta)}  fβ允 = ±${c.fBetaLimit.toFixed(2)}″  ` +
    `fx = ${c.fx.toFixed(4)}  fy = ${c.fy.toFixed(4)}  ` +
    `fs = ${c.fs.toFixed(4)}  K = 1/${c.k > 0 ? Math.round(1 / c.k).toLocaleString() : '∞'}` +
    (c.k > c.kLimit ? ' ❌ 超限' : ' ✅'));
}

function testUnifiedModel() {
  console.log('\n[Test 13] 统一模型：后视/首边 + 附合终点连接角');

  const stationsClosed = [
    { name: 'A', deg: 90,  min: 7,  sec: 30, distance: 201.58 },
    { name: 'B', deg: 121, min: 28, sec: 0,  distance: 263.41 },
    { name: 'C', deg: 108, min: 27, sec: 0,  distance: 241.00 },
    { name: 'D', deg: 84,  min: 10, sec: 30, distance: 83.84  },
    { name: 'E', deg: 135, min: 48, sec: 0,  distance: 231.32 }
  ];

  const alphaFirst = dmsToDecimal(96, 51, 36);
  const rFirst = calcClosedTraverse({
    startPoint: { name: 'A', x: 100, y: 100 },
    startAzimuth: alphaFirst,
    startAzBasis: 'first',
    angleType: 'right',
    stations: stationsClosed
  });

  const rBS = calcClosedTraverse({
    startPoint: { name: 'A', x: 100, y: 100 },
    startAzimuth: alphaFirst + dmsToDecimal(90, 7, 30) - 180,
    startAzBasis: 'backsight',
    angleType: 'right',
    stations: stationsClosed
  });

  ok(approxEq(rFirst.closure.fBeta, rBS.closure.fBeta, 1e-9),
     `首边/后视 fβ 一致: ${rFirst.closure.fBeta.toFixed(2)} vs ${rBS.closure.fBeta.toFixed(2)}`);
  ok(dmsEq(rFirst.azimuths[0], alphaFirst, 0.5),
     `首边模式 α_AB 固定 = ${formatDms(rFirst.azimuths[0])}`);
  ok(Math.abs(rFirst.closure.azimuthClosureError) < 0.01, `首边方位角闭合差 ≈ 0`);
  ok(Math.abs(rBS.closure.azimuthClosureError) < 0.01, `后视方位角闭合差 ≈ 0`);

  const lastF = rFirst.coordinates[rFirst.coordinates.length - 1];
  const lastB = rBS.coordinates[rBS.coordinates.length - 1];
  ok(approxEq(lastF.x, 100, 0.01) && approxEq(lastF.y, 100, 0.01),
     `首边末点闭合: (${lastF.x.toFixed(3)}, ${lastF.y.toFixed(3)})`);
  ok(approxEq(lastB.x, 100, 0.01) && approxEq(lastB.y, 100, 0.01),
     `后视末点闭合: (${lastB.x.toFixed(3)}, ${lastB.y.toFixed(3)})`);

  const rAtt = calcAttachedTraverse({
    startPoint: { name: 'A', x: 1000, y: 1000 },
    startAzimuth: 225.0,
    startAzBasis: 'backsight',
    endPoint: { name: 'E', x: 880, y: 1291.421356 },
    endAzimuth: 135.0,
    endConnAngle: { deg: 135, min: 0, sec: 15 },
    angleType: 'left',
    stations: [
      { name: 'A', deg: 0,   min: 0, sec: 0,  distance: 100.020 },
      { name: 'B', deg: 225, min: 0, sec: 10, distance: 149.970 },
      { name: 'C', deg: 225, min: 0, sec: 5,  distance: 100.010 },
      { name: 'D', deg: 224, min: 59, sec: 50, distance: 120.030 }
    ]
  });

  ok(dmsEq(rAtt.closure.fBeta, 20, 0.01),
     `附合后视+终点连接角 fβ = ${formatSeconds(rAtt.closure.fBeta)} ≈ +20″`);
  ok(Math.abs(rAtt.closure.azimuthClosureError) < 0.01, `附合方位角闭合差 ≈ 0`);
  const lastA = rAtt.coordinates[rAtt.coordinates.length - 1];
  ok(approxEq(lastA.x, 880, 1e-3) && approxEq(lastA.y, 1291.421356, 1e-3),
     `附合终点闭合: (${lastA.x.toFixed(3)}, ${lastA.y.toFixed(3)})`);
  ok(rAtt.adjustedAngles.length === 5, `附合改正角数 = 5 (4 站 + 终点连接角)`);
}

// ============== main ==============
console.log('═══════════════════════════════════════════════════════');
console.log('  P1 算法自测：闭合/附合导线平差');
console.log('═══════════════════════════════════════════════════════');

const r1 = testPerfectSquare();
printExcelLikeTable(r1, 'Test 1 完美正方形');

const r3 = testSquareWithDistanceError();
printExcelLikeTable(r3, 'Test 3 正方形+距离误差（平差后）');

testSquareWithAngleError();
testPerfectAttached();
testAttachedWithAngleError();
testDmsUtils();

const r7 = testTextbookExample();
printExcelLikeTable(r7, 'Test 7 河海大学《测量学》5 站闭合 (教材例题)');

testAzimuthBetween();
testClosedWithReverseAzimuth();
testIntegerMode();

const r11 = testAttachedTraverseWithErrors();
printExcelLikeTable(r11, 'Test 11 附合导线 4站（带误差）');

const r12 = testClosedTraverseSixStations();
printExcelLikeTable(r12, 'Test 12 闭合导线 6站（带误差）');

testUnifiedModel();

console.log('\n═══════════════════════════════════════════════════════');
console.log(`  结果: ${pass} passed, ${fail} failed`);
console.log('═══════════════════════════════════════════════════════');
process.exit(fail > 0 ? 1 : 0);
