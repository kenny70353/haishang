// 《航海通商》海圖：東亞海域地形、航線、港口與各勢力船隻（含航行動畫）
import { PORTS, ROUTES, TEAMS } from './data.js?v=20261103h';

// ---------- 投影 ----------
// 以臺灣海峽為中心的「魚眼」投影：海峽附近放大約 3 倍，長崎、馬尼拉等遠端維持在畫面內。
const C = [120.3, 24.0];
const MAG = 2.0, RAD = 16;
const X0 = 112, Y0 = 35.5, K = 5;
export const W = 110, H = 130;
function proj(lon, lat) {
  const dx = lon - C[0], dy = lat - C[1];
  const d = Math.hypot(dx, dy);
  const f = d < 1e-9 ? 1 + MAG : (1 + MAG) / (1 + (MAG * d) / RAD);
  return [(C[0] + dx * f - X0) * K, (Y0 - (C[1] + dy * f)) * K];
}
const r1 = (n) => Math.round(n * 10) / 10;

// 多邊形邊線加密後再投影，讓海岸在放大區也是平滑曲線
function densify(pts, step = 0.2, closed = true) {
  const out = [];
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const [a, b] = [pts[i], pts[(i + 1) % n]];
    const seg = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let s = 0; s < seg; s++) out.push([a[0] + ((b[0] - a[0]) * s) / seg, a[1] + ((b[1] - a[1]) * s) / seg]);
  }
  if (!closed) out.push(pts[n - 1]);
  return out;
}
function polyPath(pts) {
  return 'M' + densify(pts).map(([lo, la]) => proj(lo, la).map(r1).join(' ')).join('L') + 'Z';
}
// Catmull-Rom 樣條（在經緯度上取樣，再投影）
function splinePts(wp, per = 14) {
  const P = [wp[0], ...wp, wp[wp.length - 1]];
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    for (let s = 0; s < per; s++) {
      const t = s / per, t2 = t * t, t3 = t2 * t;
      const f = (k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3);
      out.push([f(0), f(1)]);
    }
  }
  out.push(wp[wp.length - 1]);
  return out.map(([lo, la]) => proj(lo, la));
}

// ---------- 地理資料（經度, 緯度；風格化手繪）----------
const LAND = {
  china: [[113, 36], [120.0, 36.0], [120.3, 34.4], [120.6, 33.3], [120.9, 32.6], [121.8, 31.9], [121.9, 31.2], [121.0, 30.6], [121.9, 30.0], [122.1, 29.7], [121.6, 29.2], [121.9, 28.8], [121.4, 28.3], [121.1, 27.9], [120.7, 27.6], [120.6, 27.1], [120.2, 26.7], [119.8, 26.4], [119.6, 26.0], [119.7, 25.6], [119.4, 25.4], [119.1, 25.1], [118.8, 24.9], [118.6, 24.6], [118.15, 24.55], [118.05, 24.4], [117.8, 24.2], [117.5, 23.8], [117.1, 23.5], [116.7, 23.3], [116.5, 22.9], [115.9, 22.8], [115.4, 22.7], [114.9, 22.6], [114.3, 22.3], [113.7, 22.4], [113.2, 22.0], [112.5, 21.8], [111.5, 21.5], [110.5, 21.2], [110.2, 20.3], [109.8, 21.4], [108.5, 21.6], [104, 22], [104, 37]],
  hainan: [[108.7, 19.2], [109.6, 18.2], [110.5, 18.7], [111.0, 19.6], [110.6, 20.1], [109.6, 20.0], [108.7, 19.6]],
  taiwan: [[121.55, 25.3], [121.9, 25.1], [122.0, 24.9], [121.85, 24.5], [121.6, 24.0], [121.5, 23.5], [121.35, 23.0], [121.1, 22.6], [120.9, 22.2], [120.85, 21.9], [120.7, 22.1], [120.6, 22.4], [120.3, 22.6], [120.18, 22.95], [120.1, 23.3], [120.15, 23.7], [120.35, 24.1], [120.6, 24.5], [120.85, 24.85], [121.05, 25.05], [121.3, 25.2]],
  penghu1: [[119.52, 23.68], [119.62, 23.66], [119.66, 23.56], [119.58, 23.52], [119.5, 23.58]],
  penghu2: [[119.42, 23.4], [119.48, 23.38], [119.47, 23.32], [119.41, 23.34]],
  luzon: [[120.6, 18.55], [121.0, 18.6], [121.6, 18.4], [122.2, 18.5], [122.3, 17.6], [122.1, 16.9], [121.6, 16.2], [121.6, 15.6], [121.5, 15.0], [121.65, 14.3], [122.2, 14.1], [122.9, 14.1], [123.3, 13.8], [123.9, 13.8], [124.1, 13.0], [123.6, 12.7], [123.0, 13.3], [122.5, 13.6], [122.0, 13.8], [121.6, 13.75], [121.1, 13.6], [120.65, 13.8], [120.6, 14.2], [120.85, 14.35], [120.97, 14.55], [120.75, 14.75], [120.55, 14.65], [120.45, 14.45], [120.25, 14.8], [120.05, 15.3], [119.9, 15.8], [119.8, 16.3], [120.2, 16.15], [120.35, 16.5], [120.4, 17.3], [120.45, 18.0]],
  mindoro: [[120.3, 13.5], [121.0, 13.3], [121.5, 12.8], [121.2, 12.2], [120.4, 12.6]],
  kyushu: [[129.6, 33.3], [130.0, 33.9], [130.9, 33.95], [131.0, 33.6], [131.6, 33.2], [131.85, 32.5], [131.4, 31.5], [131.1, 31.0], [130.7, 31.0], [130.6, 31.3], [130.2, 31.3], [130.2, 31.9], [130.5, 32.3], [130.3, 32.7], [129.95, 32.6], [129.8, 32.75], [129.85, 33.0], [129.6, 33.05]],
  honshu: [[130.9, 34.0], [131.4, 34.4], [132.2, 34.3], [133.5, 34.4], [134, 36], [131.5, 34.9], [130.95, 34.25]],
  shikoku: [[132.0, 33.0], [132.4, 32.8], [133.0, 33.3], [134, 33.5], [134, 34.2], [132.6, 34.0]],
  korea: [[126.1, 36], [126.3, 34.7], [126.6, 34.3], [127.5, 34.6], [128.6, 34.9], [129.3, 35.3], [129.5, 36], [129.5, 37], [126, 37]],
  jeju: [[126.2, 33.35], [126.6, 33.25], [126.95, 33.45], [126.5, 33.55]],
  okinawa: [[127.65, 26.1], [127.95, 26.4], [128.3, 26.85], [128.2, 26.95], [127.8, 26.55]],
  amami: [[129.2, 28.2], [129.6, 28.45], [129.4, 28.55]],
  ishigaki: [[124.1, 24.35], [124.3, 24.45], [124.2, 24.55]],
  miyako: [[125.25, 24.73], [125.45, 24.8], [125.3, 24.88]],
  yakushima: [[130.4, 30.3], [130.65, 30.4], [130.5, 30.5]],
  batanes: [[121.85, 20.4], [121.98, 20.5], [121.9, 20.58]],
};
const PORT_GEO = { 長崎: [129.82, 32.75], 雞籠: [121.74, 25.2], 月港: [118.05, 24.42], 澎湖: [119.57, 23.57], 大員: [120.12, 23.0], 馬尼拉: [120.97, 14.6] };
// 船停泊時排列的方向（畫面角度，0 = 右、90 = 下），朝向開闊海面
const PORT_SEA = { 長崎: 165, 雞籠: -60, 月港: 20, 澎湖: 150, 大員: 115, 馬尼拉: 175 };
// 擠在畫面邊緣的港口改用固定停泊位置
const PORT_SLOTS = { 長崎: [[-9, 4], [-23, 5], [-15, 15], [-29, 16], [-37, 7]] };
// 標籤位置
const PORT_LABEL = { 長崎: 'down', 雞籠: 'right', 月港: 'up', 澎湖: 'right', 大員: 'right', 馬尼拉: 'right' };
const WAY = {
  '長崎|雞籠': [[129.2, 32.3], [127.0, 30.0], [124.5, 27.5], [122.4, 25.7]],
  '雞籠|大員': [[121.4, 25.45], [120.6, 25.0], [120.0, 24.2], [119.85, 23.4]],
  '大員|馬尼拉': [[119.9, 22.2], [119.5, 20.0], [119.4, 17.5], [119.5, 15.6], [120.0, 14.6], [120.4, 14.3], [120.65, 14.45]],
  '月港|澎湖': [[118.5, 24.2], [119.1, 23.8]],
  '澎湖|大員': [[119.85, 23.25]],
  '月港|長崎': [[118.6, 24.3], [119.6, 24.9], [120.6, 25.9], [121.5, 27.2], [122.8, 28.8], [124.8, 30.6], [127.4, 31.9], [129.2, 32.5]],
  '長崎|馬尼拉': [[128.8, 31.8], [126.0, 28.0], [123.3, 24.6], [122.6, 22.0], [121.3, 20.1], [119.9, 18.5], [119.4, 16.5], [119.6, 15.2], [120.0, 14.6], [120.4, 14.3], [120.65, 14.45]],
  '馬尼拉|雞籠': [[120.65, 14.45], [120.4, 14.3], [120.0, 14.6], [119.6, 15.2], [119.4, 16.5], [119.9, 18.5], [121.3, 20.1], [122.4, 22.0], [122.3, 24.0], [122.1, 25.2]],
  '月港|馬尼拉': [[118.4, 23.9], [118.4, 22.5], [118.5, 20.0], [118.9, 17.0], [119.3, 15.4], [120.0, 14.6], [120.4, 14.3], [120.65, 14.45]],
};
const LABELS = [
  ['大明', 116.3, 27.2, 'land big'], ['臺灣', 121.0, 23.9, 'land'], ['呂宋', 121.1, 16.6, 'land'], ['日本', 131.0, 32.2, 'land'],
  ['琉球', 128.1, 27.3, 'land sm'], ['朝鮮', 127.5, 34.5, 'land sm'],
  ['臺灣海峽', 117.6, 22.3, 'sea'], ['南海', 116.0, 17.0, 'sea big'], ['東海', 124.6, 29.2, 'sea'], ['太平洋', 127.6, 19.0, 'sea big'],
];

// 預先計算：陸地路徑、港口座標、航線點列
const LAND_D = Object.values(LAND).map(polyPath).join('');
export const PXY = Object.fromEntries(PORTS.map((p) => [p, proj(...PORT_GEO[p])]));
const RT = ROUTES.map(([a, b, type]) => {
  const wp = [PORT_GEO[a], ...(WAY[`${a}|${b}`] || WAY[`${b}|${a}`]?.slice().reverse() || []), PORT_GEO[b]];
  const pts = splinePts(wp);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { a, b, type, pts, cum, len: cum[cum.length - 1], d: 'M' + pts.map((p) => p.map(r1).join(' ')).join('L') };
});
function routeOf(a, b) {
  const r = RT.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  return r ? { r, rev: r.a !== a } : null;
}
// 沿航線取點：p 為 0–1（從 from 到 to），回傳 [x, y, 朝向 dx]
function along(from, to, p) {
  const ro = routeOf(from, to);
  if (!ro) return null;
  const { r, rev } = ro;
  const q = rev ? 1 - p : p;
  const L = Math.max(0, Math.min(r.len, q * r.len));
  let i = 1;
  while (i < r.cum.length - 1 && r.cum[i] < L) i++;
  const [x1, y1] = r.pts[i - 1], [x2, y2] = r.pts[i];
  const t = (L - r.cum[i - 1]) / ((r.cum[i] - r.cum[i - 1]) || 1);
  return [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, (x2 - x1) * (rev ? -1 : 1)];
}

// ---------- 船 ----------
const SHORT = { voc: '荷蘭', esp: '西班牙', zheng: '李旦・鄭芝龍', jpn: '朱印船', minnan: '閩南' };
const EURO = new Set(['voc', 'esp']);
function lighten(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s) => Math.round(((n >> s) & 255) + (255 - ((n >> s) & 255)) * k);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}
function flag(id, x, y) {
  const w = 2.8, h = 1.8;
  const box = (inner) => `<g transform="translate(${x} ${y})"><path d="M0 0V${-h - 1.2}" stroke="#2e1d0e" stroke-width=".25"/>${inner}</g>`;
  const fy = -h - 1.2;
  if (id === 'voc') return box(`<rect x="0" y="${fy}" width="${w}" height="${h / 3}" fill="#e8742a"/><rect x="0" y="${fy + h / 3}" width="${w}" height="${h / 3}" fill="#fff"/><rect x="0" y="${fy + (2 * h) / 3}" width="${w}" height="${h / 3}" fill="#1f4e9c"/>`);
  if (id === 'esp') return box(`<rect x="0" y="${fy}" width="${w}" height="${h}" fill="#fff"/><path d="M.3 ${fy + .2}L${w - .3} ${fy + h - .2}M${w - .3} ${fy + .2}L.3 ${fy + h - .2}" stroke="#b91c1c" stroke-width=".45"/>`);
  if (id === 'jpn') return box(`<rect x="0" y="${fy}" width="${w}" height="${h}" fill="#fff"/><circle cx="${w / 2}" cy="${fy + h / 2}" r=".55" fill="#c81e1e"/>`);
  if (id === 'zheng') return box(`<path d="M0 ${fy}H${w + .4}L${w - .4} ${fy + h / 2}L${w + .4} ${fy + h}H0Z" fill="#b91c1c"/><text x="${w / 2 - .1}" y="${fy + h / 2 + .5}" font-size="1.3" text-anchor="middle" fill="#fde68a" font-weight="700">鄭</text>`);
  return box(`<path d="M0 ${fy}H${w + .6}L${w - .3} ${fy + h / 2}L${w + .6} ${fy + h}H0Z" fill="#1d4ed8"/>`);
}
function shipArt(id) {
  const c = TEAMS[id]?.color || '#888', l = lighten(c, 0.45), hull = '#5b3a1e', dk = '#2e1d0e';
  if (EURO.has(id)) {
    return `<path d="M-5.8 -1.8 L-4.7 2.6 L3.2 2.6 Q5.4 1.6 6 -.4 L-3.9 -.4 L-4.3 -1.8 Z" fill="${hull}" stroke="${dk}" stroke-width=".3"/>
      <path d="M-4.5 .8 L5.3 .8" stroke="#d4a72c" stroke-width=".4"/>
      <circle cx="-2" cy="1.7" r=".28" fill="${dk}"/><circle cx="0" cy="1.7" r=".28" fill="${dk}"/><circle cx="2" cy="1.7" r=".28" fill="${dk}"/>
      <path d="M-2.5 -.4V-7.8M1 -.4V-9.4M3.9 -.4V-6.9M5.6 -.6L8.2 -2.6" stroke="${dk}" stroke-width=".35"/>
      <path d="M-1.5 -8.7Q1 -7.9 3.5 -8.7L3.2 -5.5Q1 -4.9 -1.2 -5.5Z" fill="${l}" stroke="${dk}" stroke-width=".15"/>
      <path d="M-1.9 -5.1Q1 -4.2 3.9 -5.1L3.6 -1.4Q1 -.6 -1.6 -1.4Z" fill="${c}" stroke="${dk}" stroke-width=".15"/>
      <path d="M-4.1 -7.3Q-2.5 -6.7 -.9 -7.3L-1.1 -2Q-2.5 -1.4 -3.9 -2Z" fill="${c}" stroke="${dk}" stroke-width=".15"/>
      <path d="M2.7 -6.3Q3.9 -5.8 5.1 -6.3L4.9 -1.8Q3.9 -1.2 2.9 -1.8Z" fill="${l}" stroke="${dk}" stroke-width=".15"/>
      <path d="M5.8 -.9L8.1 -2.5L6.6 -.6Z" fill="${l}"/>
      ${flag(id, 1, -9.4)}`;
  }
  return `<path d="M-6.2 -2.2 L-5 2.4 L3.6 2.4 Q5.7 1.2 6.2 -1.2 L4.4 -.5 L-3.6 -.3 L-4.6 -2.2 Z" fill="${hull}" stroke="${dk}" stroke-width=".3"/>
    <path d="M-6.2 -2.2L-6.6 -3.4H-4.4L-4.6 -2.2Z" fill="${hull}" stroke="${dk}" stroke-width=".25"/>
    <path d="M-5 .9H4.9" stroke="#b45309" stroke-width=".35"/>
    <circle cx="4.5" cy=".5" r=".45" fill="#fff"/><circle cx="4.6" cy=".5" r=".22" fill="${dk}"/>
    <path d="M-1.7 -.3V-9.7M3.1 -.4V-7.1M-5.2 -3.2V-6.6" stroke="${dk}" stroke-width=".35"/>
    <path d="M-4.2 -9.3L.6 -9.9L1.5 -1L-3.8 -1Z" fill="${c}" stroke="${dk}" stroke-width=".2"/>
    <path d="M-4.1 -7.6L.9 -8.1M-4 -5.8L1.1 -6.2M-3.9 -4L1.3 -4.3M-3.85 -2.4L1.4 -2.6" stroke="rgba(0,0,0,.38)" stroke-width=".2"/>
    <path d="M1.9 -6.9L4.6 -7.2L5.2 -1.1L2.1 -1.1Z" fill="${l}" stroke="${dk}" stroke-width=".2"/>
    <path d="M2 -5.3L4.8 -5.5M2.05 -3.4L5 -3.5" stroke="rgba(0,0,0,.3)" stroke-width=".18"/>
    <path d="M-6.5 -6.3L-4.6 -6.6L-4.4 -3.5L-6.3 -3.5Z" fill="${l}" stroke="${dk}" stroke-width=".18"/>
    ${flag(id, -1.7, -9.7)}`;
}
function shipSvg(id, mine) {
  return `<g class="ship-g" data-ship="${id}" transform="translate(-50 -50)">
    ${mine ? '<ellipse class="me-ring" cx="0" cy="1.6" rx="6.2" ry="2.2"/>' : ''}
    <g class="bob" style="animation-delay:-${(id.length * 0.37) % 2}s"><g class="flip" transform="scale(.62)">
      <path class="wake" d="M-7 3.2q1.6-.9 3.2 0t3.2 0t3.2 0"/>${shipArt(id)}</g></g>
    <text class="ship-name ${mine ? 'me' : ''}" y="4.6" text-anchor="middle">${mine ? '我方・' : ''}${SHORT[id] || ''}</text>
  </g>`;
}

// ---------- 海圖 SVG ----------
// opts: { round, flags, teams, mine, routeClass(a,b) -> class, selectPorts: { port: hint }, dest, focus }
export function chartSvg(opts) {
  const { round = 1, teams = {}, mine = null, dest = null, routeClass, selectable = null, focus = null, shut = {}, tags = {} } = opts;
  const winter = round % 2 === 1;
  const grat = [];
  for (let lat = 15; lat <= 35; lat += 5) {
    const pts = []; for (let lo = 104; lo <= 136; lo += 0.5) pts.push(proj(lo, lat));
    grat.push(`<path class="grat" d="M${pts.map((p) => p.map(r1).join(' ')).join('L')}"/>`);
  }
  for (let lon = 115; lon <= 130; lon += 5) {
    const pts = []; for (let la = 8; la <= 38; la += 0.5) pts.push(proj(lon, la));
    grat.push(`<path class="grat" d="M${pts.map((p) => p.map(r1).join(' ')).join('L')}"/>`);
  }
  const routes = RT.map((r) => {
    const cls = routeClass ? routeClass(r.a, r.b) : '';
    const sel = dest && mine && teams[mine] && !teams[mine].sea && ((r.a === teams[mine].port && r.b === dest) || (r.b === teams[mine].port && r.a === dest));
    return `<path class="lane ${r.type} ${cls} ${sel ? 'sel' : ''}" d="${r.d}"/>`;
  }).join('');
  const myPort = mine && teams[mine] && !teams[mine].sea ? teams[mine].port : null;
  const ports = PORTS.map((p) => {
    const [x, y] = PXY[p];
    const pos = PORT_LABEL[p];
    const wlab = p.length * 3.3 + 2.2;
    const lx = pos === 'left' ? x - 3 - wlab : pos === 'right' ? x + 3 : Math.min(W - wlab - 1, Math.max(1, x - wlab / 2));
    const ly = pos === 'up' ? y - 8.2 : pos === 'down' ? y + 3.6 : y - 2.3;
    const closed = shut[p];
    const hint = closed || (selectable ? selectable[p] : tags[p]) || null;
    const cls = ['port', p === myPort ? 'mine' : '', p === dest ? 'dest' : '', p === focus ? 'focus' : '', closed ? 'shut' : '', (selectable && selectable[p] === undefined) || closed ? 'off' : '', tags[p] && !selectable ? 'banned' : ''].join(' ');
    return `<g class="${cls}" data-act="port" data-v="${p}" role="button" tabindex="0" aria-label="${p}">
      <circle class="hit" cx="${x}" cy="${y}" r="5.5"/>
      <circle class="halo" cx="${x}" cy="${y}" r="3.4"/>
      <path class="fort" d="M${x - 1.8} ${y + 1.4}V${y - .6}h.7v-.7h.7v.7h.8v-.7h.7v.7h.7v2Z"/>
      <rect class="plate" x="${r1(lx)}" y="${r1(ly)}" width="${r1(wlab)}" height="4.6" rx="1"/>
      <text class="pname" x="${r1(lx + wlab / 2)}" y="${r1(ly + 3.5)}" text-anchor="middle">${p}</text>
      ${hint ? `<text class="phint" x="${r1(lx + wlab / 2)}" y="${r1(ly + 7.6)}" text-anchor="middle">${hint}</text>` : ''}
    </g>`;
  }).join('');
  const labels = LABELS.map(([t, lo, la, cls]) => { const [x, y] = proj(lo, la); return `<text class="lbl ${cls}" x="${r1(x)}" y="${r1(y)}" text-anchor="middle">${t}</text>`; }).join('');
  // 通往其他大洲的航路（裝飾）
  const ext = (wp) => 'M' + splinePts(wp, 10).map((p) => p.map(r1).join(' ')).join('L');
  const bat = ext([[120.3, 14.2], [118.5, 12.8], [116.0, 11.8], [113.0, 11.2]]);
  const aca = ext([[123.0, 13.6], [124.3, 12.6], [126.5, 12.8], [131.0, 13.6], [134.5, 14.2]]);
  const mac = ext([[118.3, 23.6], [116.8, 22.4], [115.0, 21.8], [112.5, 21.0]]);
  const ships = Object.keys(teams).filter((id) => Object.keys(teams[id].members || {}).length).map((id) => shipSvg(id, id === mine)).join('');
  // 季風動態線
  const gusts = [];
  const seeds = [[124, 27], [126, 23], [117, 20], [122, 19], [128, 30], [119, 17], [116, 24.5], [125.5, 17], [129, 25], [122.5, 22.2], [117.5, 14.5], [127, 15]];
  seeds.forEach(([lo, la], i) => {
    const [x, y] = proj(lo, la);
    const d = winter ? 'M0 0q-1.6 .2 -3.4 3.4' : 'M0 0q1.6 -.2 3.4 -3.4';
    gusts.push(`<path class="gust ${winter ? 'w' : 's'}" d="${d}" transform="translate(${r1(x)} ${r1(y)})" style="animation-delay:${(i * 0.53) % 4}s"/>`);
  });
  const [cx, cy] = proj(128.6, 21.6);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="東亞海圖：港口、航線與各勢力船隻">
    <defs>
      <radialGradient id="seaG" cx="30%" cy="45%" r="85%"><stop offset="0" stop-color="var(--sea-a)"/><stop offset="1" stop-color="var(--sea-b)"/></radialGradient>
      <pattern id="wavesP" width="9" height="6" patternUnits="userSpaceOnUse"><path d="M0 3q1.1-1.2 2.25 0t2.25 0" class="wv"/><path d="M4.5 6q1.1-1.2 2.25 0t2.25 0" class="wv"/></pattern>
      <filter id="landSh" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx=".4" dy=".6" stdDeviation=".5" flood-opacity=".25"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#seaG)"/>
    <rect width="${W}" height="${H}" fill="url(#wavesP)" opacity=".5"/>
    ${grat.join('')}
    <g class="gusts">${gusts.join('')}</g>
    <path class="shoal" d="${LAND_D}"/>
    <path class="land" d="${LAND_D}" filter="url(#landSh)"/>
    ${labels}
    <path class="ext" d="${bat}"/><path class="ext" d="${aca}"/><path class="ext" d="${mac}"/>
    <text class="extl" x="${r1(proj(114.4, 10.7)[0])}" y="${r1(proj(114.4, 10.7)[1])}">↙ 往巴達維亞・歐洲</text>
    <text class="extl" x="${W - 1.5}" y="${r1(proj(132.5, 13.4)[1] - 2)}" text-anchor="end">往阿卡普科・美洲 →</text>
    <text class="extl" x="1.5" y="${r1(proj(112.8, 20.6)[1] + 4)}">← 往澳門</text>
    <g class="lanes">${routes}</g>
    ${ports}
    <g class="compass" transform="translate(${r1(cx)} ${r1(cy)})">
      <circle r="7" class="cmp-bg"/><path d="M0 -6.5L1.2 0L0 6.5L-1.2 0Z" class="cmp-ns"/><path d="M-6.5 0L0 -1.2L6.5 0L0 1.2Z" class="cmp-ew"/>
      <text y="-7.8" text-anchor="middle" class="cmp-t">北</text></g>
    <g class="ships">${ships}</g>
    <g class="season" transform="translate(2 2)"><rect width="25.5" height="9" rx="2" class="season-bg"/>
      <path transform="translate(4.5 4.5) rotate(${winter ? 225 : 45})" d="M-2.6 0H2.2M.6 -1.6L2.4 0L.6 1.6" class="season-ar"/>
      <text x="9" y="3.9" class="season-t">${winter ? '冬・東北季風' : '夏・西南季風'}</text>
      <text x="9" y="7.4" class="season-s">${winter ? '往南順風' : '往北順風'}</text></g>
  </svg>`;
}

// ---------- 船隻定位與動畫 ----------
const ST = {}; // teamId -> { key, x, y, dir, anim }
const reduce = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
function targetOf(teams, id, slotIdx, slotCount, seaIdx) {
  const t = teams[id];
  if (t.sea) {
    const from = t.sea.from || t.port, to = t.sea.to;
    const pt = along(from, to, 0.5);
    if (pt) {
      const off = (seaIdx - 0.5) * 3.2;
      return { key: `s:${from}>${to}`, from, to, x: pt[0], y: pt[1] + off, dir: Math.sign(pt[2]) || 1, sea: true };
    }
  }
  const p = t.port;
  const [px, py] = PXY[p];
  const fixed = PORT_SLOTS[p];
  if (fixed) { const [ox, oy] = fixed[slotIdx % fixed.length]; return { key: `p:${p}`, port: p, x: px + ox, y: py + oy, dir: -1 }; }
  const ang = ((PORT_SEA[p] + (slotIdx - (slotCount - 1) / 2) * 34) * Math.PI) / 180;
  const dist = (p === '長崎' ? 9 : 6.8) + (slotCount > 3 ? (slotIdx % 2) * 2.4 : 0);
  return { key: `p:${p}`, port: p, x: px + Math.cos(ang) * dist, y: py + Math.sin(ang) * dist + 1, dir: px > 70 ? -1 : 1 };
}
function place(el, x, y, dir) {
  el.setAttribute('transform', `translate(${r1(x)} ${r1(y)})`);
  const f = el.querySelector('.flip');
  if (f) f.setAttribute('transform', `scale(${dir < 0 ? -0.62 : 0.62} .62)`);
}
let raf = 0;
function tick() {
  raf = 0;
  const now = performance.now();
  let more = false;
  for (const [id, s] of Object.entries(ST)) {
    const a = s.anim;
    if (!a) continue;
    let u = (now - a.start) / a.dur;
    if (u < 0) { more = true; u = 0; }
    if (u >= 1) { s.anim = null; u = 1; } else more = true;
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    const p = a.p0 + (a.p1 - a.p0) * e;
    const pt = along(a.from, a.to, p);
    let x, y, dir;
    if (pt) {
      x = pt[0] + a.o0[0] * (1 - e) + a.o1[0] * e; y = pt[1] + a.o0[1] * (1 - e) + a.o1[1] * e;
      dir = Math.sign(pt[2]) || 1;
      if (u >= 1) { x = s.x; y = s.y; dir = s.dir; }
    } else { x = s.x; y = s.y; dir = s.dir; }
    document.querySelectorAll(`.chart [data-ship="${id}"]`).forEach((el) => { place(el, x, y, dir); el.classList.toggle('sailing', !!s.anim); });
  }
  if (more) raf = requestAnimationFrame(tick);
}
// 每次重繪後呼叫：把船放到正確位置；位置改變時沿航線播放航行動畫
export function layoutChart(teams) {
  const charts = document.querySelectorAll('.chart');
  if (!charts.length) return;
  const ids = Object.keys(teams).filter((id) => Object.keys(teams[id].members || {}).length);
  const byPort = {}, bySea = {};
  for (const id of ids) {
    const t = teams[id];
    if (t.sea) (bySea[`${t.sea.from}>${t.sea.to}`] ||= []).push(id);
    else (byPort[t.port] ||= []).push(id);
  }
  let stagger = 0;
  for (const id of ids) {
    const t = teams[id];
    const grp = t.sea ? bySea[`${t.sea.from}>${t.sea.to}`] : byPort[t.port];
    const tg = targetOf(teams, id, grp.indexOf(id), grp.length, grp.length > 1 ? grp.indexOf(id) / (grp.length - 1) : 0.5);
    const prev = ST[id];
    if (prev && prev.key !== tg.key && !reduce()) {
      // 判斷航段
      let from, to, p0, p1;
      const pk = prev.key, nk = tg.key;
      if (pk.startsWith('p:') && nk.startsWith('s:')) { from = pk.slice(2); [, to] = nk.slice(2).split('>'); p0 = 0; p1 = 0.5; }
      else if (pk.startsWith('s:') && nk.startsWith('p:')) { [from, to] = pk.slice(2).split('>'); p0 = 0.5; p1 = 1; if (to !== nk.slice(2)) from = null; }
      else if (pk.startsWith('p:') && nk.startsWith('p:')) { from = pk.slice(2); to = nk.slice(2); p0 = 0; p1 = 1; }
      if (from && routeOf(from, to)) {
        const s0 = along(from, to, p0), s1 = along(from, to, p1);
        const o0 = [prev.x - s0[0], prev.y - s0[1]], o1 = [tg.x - s1[0], tg.y - s1[1]];
        const dur = 2600 + (p1 - p0) * 1600;
        ST[id] = { ...tg, anim: { from, to, p0, p1, o0, o1, start: performance.now() + stagger, dur } };
        stagger += 350;
      } else ST[id] = { ...tg, anim: null };
    } else if (!prev || prev.key !== tg.key || !prev.anim) {
      ST[id] = { ...tg, anim: prev && prev.key === tg.key ? prev.anim : null };
    } else {
      Object.assign(prev, { x: tg.x, y: tg.y, dir: tg.dir });
    }
    const s = ST[id];
    if (!s.anim) document.querySelectorAll(`.chart [data-ship="${id}"]`).forEach((el) => place(el, s.x, s.y, s.dir));
  }
  if (Object.values(ST).some((s) => s.anim)) { if (raf) cancelAnimationFrame(raf); tick(); }
}
// 測試用：重設記錄的船位（切換房間時）
export function resetChart() { for (const k of Object.keys(ST)) delete ST[k]; }
