// DMS 转换工具
// 输入：度分秒(三个数) 或 十进制度(一个数)
// 输出：格式化字符串 / 对象

const DEG = Math.PI / 180;

/**
 * 度分秒 -> 十进制度
 * @param {number} deg  度（可带小数表示度的小数部分，但通常用整数）
 * @param {number} min  分
 * @param {number} sec  秒
 * @returns {number}    十进制度
 */
export function dmsToDecimal(deg, min, sec) {
  const sign = deg < 0 ? -1 : 1;
  const d = Math.abs(Number(deg) || 0);
  const m = Math.abs(Number(min) || 0);
  const s = Math.abs(Number(sec) || 0);
  return sign * (d + m / 60 + s / 3600);
}

/**
 * 十进制度 -> {deg, min, sec}
 * - deg 保留整数符号
 * - sec 保留 2 位小数
 */
export function decimalToDms(decimal) {
  const v = Number(decimal);
  if (!Number.isFinite(v)) return { deg: 0, min: 0, sec: 0 };
  const sign = v < 0 ? -1 : 1;
  const abs = Math.abs(v);
  const d = Math.floor(abs);
  const mFloat = (abs - d) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  // 防止 59.999... 进位问题
  let secRounded = Math.round(s * 100) / 100;
  let minOut = m, degOut = d;
  if (secRounded >= 60) {
    secRounded -= 60;
    minOut += 1;
  }
  if (minOut >= 60) {
    minOut -= 60;
    degOut += 1;
  }
  return { deg: sign * degOut, min: sign * minOut, sec: sign * secRounded };
}

/**
 * 格式化为 "ddd°mm′ss.ss″" 字符串
 * 默认 deg 至少 3 位，不足补零；sec 固定 2 位小数
 */
export function formatDms(decimal, opts = {}) {
  const { degWidth = 3, secDigits = 2 } = opts;
  const { deg, min, sec } = decimalToDms(decimal);
  const aDeg = Math.abs(deg);
  const aMin = Math.abs(min);
  const aSec = Math.abs(sec);
  const degStr = String(aDeg).padStart(degWidth, '0');
  const minStr = String(aMin).padStart(2, '0');
  const secStr = aSec.toFixed(secDigits).padStart(secDigits === 2 ? 5 : 7, '0');
  const sign = deg < 0 ? '-' : ' ';
  return `${sign}${degStr}°${minStr}′${secStr}″`;
}

/**
 * 把角度归一化到 [0, 360)
 */
export function normalize360(deg) {
  let r = Number(deg) % 360;
  if (r < 0) r += 360;
  return r;
}

/**
 * 从两点坐标反算方位角 (X=北, Y=东)
 *   α = atan2(ΔY, ΔX) (顺时针从北起)
 * @param {{x:number,y:number}} pFrom  起算点 (如 A)
 * @param {{x:number,y:number}} pTo    目标点 (如 B)
 * @returns {number|null}              十进制度 [0, 360)，两点重合返回 null
 */
export function azimuthBetween(pFrom, pTo) {
  if (!pFrom || !pTo) return null;
  const x1 = Number(pFrom.x), y1 = Number(pFrom.y);
  const x2 = Number(pTo.x),   y2 = Number(pTo.y);
  if (!Number.isFinite(x1) || !Number.isFinite(y1) ||
      !Number.isFinite(x2) || !Number.isFinite(y2)) return null;
  const dx = x2 - x1, dy = y2 - y1;
  if (dx === 0 && dy === 0) return null;
  return normalize360(Math.atan2(dy, dx) * 180 / Math.PI);
}

/**
 * 秒数 -> "±ss.ss″" 字符串（带符号，用于显示闭合差）
 */
export function formatSeconds(sec, digits = 2) {
  if (!Number.isFinite(sec)) return '';
  const s = Number(sec).toFixed(digits);
  if (sec > 0) return `+${s}″`;
  if (sec < 0) return `${s}″`;
  return '0.00″';
}

export { DEG };
