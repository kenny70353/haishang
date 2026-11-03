// 《航海通商》規則引擎：純函式，操作一個可序列化的遊戲狀態 S
// S = { room, teams: {id: team}, hands: {id: hand}, secret: {decks, cards} }
import {
  PORTS, GOODS, LAT, BASE_PRICES, ROUTES, TEAMS, TEAM_IDS, START_SILVER, HOLD, ROUNDS,
  PHASES, EVENTS, INTEL, gibberish,
} from './data.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
export const PRICE_MAX = 12;
const clamp = (n) => Math.max(1, Math.min(PRICE_MAX, n));
export const season = (round) => (round % 2 === 1 ? '冬' : '夏');
export const cargoCount = (t) => GOODS.reduce((s, g) => s + (t.cargo[g] || 0), 0);
export const score = (t) => t.silver + cargoCount(t) + t.rep * 2;

let rng = Math.random;
export function setRandom(fn) { rng = fn; }
const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const shortId = () => Math.floor(rng() * 36 ** 5).toString(36).padStart(5, '0');

export function newGame({ code, teacherUid, mode = 'plain', eventOrder }) {
  const order = (eventOrder && eventOrder.length === ROUNDS) ? eventOrder.map(Number) : [2, 3, 12, 4, 7, 1];
  const teams = {};
  for (const id of TEAM_IDS) {
    const cargo = Object.fromEntries(GOODS.map((g) => [g, 0]));
    if (id === 'esp') cargo['白銀'] = 1;
    teams[id] = {
      id, name: TEAMS[id].name, members: {}, silver: START_SILVER, cargo, port: TEAMS[id].port,
      sea: null, rep: 0, zhengUsed: false, order: null, log: [], review: '',
    };
  }
  const hands = Object.fromEntries(TEAM_IDS.map((id) => [id, { cards: [], accused: [] }]));
  return {
    room: {
      code, teacherUid, mode, status: 'lobby', round: 0, phase: 'lobby', phaseEndsAt: null,
      prices: clone(BASE_PRICES), base: clone(BASE_PRICES), flags: {}, lastReport: null, reports: [],
    },
    teams, hands,
    secret: { eventOrder: order, cards: {}, decks: {} },
  };
}

export function activeTeams(S) {
  return TEAM_IDS.filter((id) => Object.keys(S.teams[id].members).length > 0);
}
export const currentEvent = (S) => S.secret.eventOrder[S.room.round - 1];

// ---------- 航行 ----------
export function routeBetween(a, b) {
  return ROUTES.find(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// 回傳航行回合數；null 代表不能出航。flags 是當回合生效的狀態
export function travelTime(from, to, round, flags = {}) {
  const r = routeBetween(from, to);
  if (!r) return null;
  const type = r[2];
  const blk = flags.blockedRoute;
  if (blk && blk.round === round && ((blk.a === from && blk.b === to) || (blk.a === to && blk.b === from))) return null;
  if (type === 'ew') return 1;
  const south = LAT[to] < LAT[from];
  const tail = season(round) === '冬' ? south : !south;
  if (type === 'ns') return tail ? 1 : 2;
  if (flags.openSea === round) return 2;
  return tail ? 2 : null;
}

export function destinations(S, teamId) {
  const t = S.teams[teamId];
  if (t.sea) return [];
  return PORTS.filter((p) => p !== t.port).map((p) => {
    const turns = travelTime(t.port, p, S.room.round, S.room.flags);
    return { port: p, turns };
  }).filter((d) => d.turns != null);
}

export function portClosedFor(S, teamId) {
  const c = S.room.flags.closed;
  const t = S.teams[teamId];
  return !!(c && c.round === S.room.round && c.port === t.port);
}

// ---------- 情報卡 ----------
function cardText(S, ev, kind) {
  const [src, text] = INTEL[ev][kind];
  return { src, text };
}

function generalCard(S, port, round) {
  const pr = S.room.prices[port];
  const sorted = [...GOODS].sort((a, b) => pr[a] - pr[b]);
  const low = sorted[0], high = sorted[sorted.length - 1];
  return { src: `${port}的牙行`, text: `本港目前最便宜的是${low}（${pr[low]} 兩），最貴的是${high}（${pr[high]} 兩）。` };
}

function makeHandCard(S, cid, port, round, src, text) {
  const gib = S.room.mode === 'gibberish';
  return {
    cid, port, round,
    src: gib ? gibberish(cid + 's', 6).replace('。', '') : src,
    text: gib ? gibberish(cid, 24) : text,
  };
}

// 依本回合事件建立牌疊：2 張真情報、1 張謠言
function buildDecks(S) {
  const ev = currentEvent(S);
  const e = EVENTS[ev];
  const decks = Object.fromEntries(PORTS.map((p) => [p, []]));
  const place = (port, kind) => {
    const cid = shortId();
    S.secret.cards[cid] = { ev, kind, round: S.room.round };
    decks[port].push(cid);
  };
  place(e.trueAt[0], 'A');
  place(e.trueAt[1], 'B');
  place(e.rumorAt, 'R');
  S.secret.decks = decks;
}

function drawOne(S, teamId) {
  const t = S.teams[teamId];
  const deck = S.secret.decks[t.port] || [];
  const round = S.room.round;
  if (deck.length) {
    const cid = deck.splice(Math.floor(rng() * deck.length), 1)[0];
    const info = S.secret.cards[cid];
    const { src, text } = cardText(S, info.ev, info.kind);
    return makeHandCard(S, cid, t.port, round, src, text);
  }
  const cid = 'g' + shortId();
  S.secret.cards[cid] = { ev: null, kind: 'G', round };
  const { src, text } = generalCard(S, t.port, round);
  return makeHandCard(S, cid, t.port, round, src, text);
}

function deal(S) {
  buildDecks(S);
  const order = activeTeams(S).sort(() => rng() - 0.5);
  for (const id of order) {
    const t = S.teams[id];
    if (t.sea) { log(t, S, '在海上航行，本回合抽不到情報。'); continue; }
    const n = id === 'minnan' ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const c = drawOne(S, id);
      S.hands[id].cards.push(c);
      log(t, S, `在${t.port}取得情報 #${c.cid}`);
    }
  }
}

function log(t, S, text, basis = null) {
  t.log.push({ round: S.room.round, phase: S.room.phase, text, basis });
}

// ---------- 階段推進 ----------
export function startGame(S) {
  if (S.room.status !== 'lobby') return fail('遊戲已經開始');
  if (activeTeams(S).length < 2) return fail('至少要有 2 組加入');
  S.room.status = 'playing';
  S.room.round = 1;
  S.room.phase = 'intel';
  deal(S);
  return ok('遊戲開始');
}

export function advance(S) {
  const r = S.room;
  if (r.status !== 'playing') return fail('遊戲不在進行中');
  const i = PHASES.indexOf(r.phase);
  if (r.phase === 'resolve') {
    if (r.round >= ROUNDS) {
      r.status = 'ended';
      r.phase = 'ended';
      return ok('遊戲結束');
    }
    r.round += 1;
    r.phase = 'intel';
    for (const id of TEAM_IDS) S.teams[id].order = null;
    deal(S);
    return ok(`第 ${r.round} 回合開始`);
  }
  r.phase = PHASES[i + 1];
  if (r.phase === 'resolve') resolve(S);
  return ok(`進入${r.phase}階段`);
}

// ---------- 結算 ----------
function addPrice(S, port, good, d, report, deltas) {
  S.room.prices[port][good] = clamp(S.room.prices[port][good] + d);
  deltas.push([port, good, d]);
}

function loseCargo(t) {
  const have = GOODS.filter((g) => t.cargo[g] > 0);
  if (!have.length) return null;
  const g = pick(have);
  t.cargo[g] -= 1;
  return g;
}

export function resolve(S) {
  const r = S.room;
  const round = r.round;
  const ev = currentEvent(S);
  const E = EVENTS[ev];
  const report = [];
  const deltas = [];
  const ids = activeTeams(S);

  // 1. 船隻移動（依本回合生效的旗標）
  for (const id of ids) {
    const t = S.teams[id];
    if (t.sea) {
      if (t.sea.arrive <= round) {
        t.port = t.sea.to; t.sea = null;
        report.push(`${t.name}抵達${t.port}。`);
        log(t, S, `抵達${t.port}`);
      }
      continue;
    }
    const o = t.order;
    if (!o || !o.dest) continue;
    const turns = travelTime(t.port, o.dest, round, r.flags);
    if (turns == null) { log(t, S, `無法前往${o.dest}，留在${t.port}`); continue; }
    if (portClosedFor(S, id)) {
      if (id === 'zheng' && !t.zhengUsed) {
        t.zhengUsed = true;
        report.push(`${t.name}突破封港。`);
      } else { log(t, S, `${t.port}封港中，無法出航`); continue; }
    }
    const from = t.port;
    if (turns === 1) {
      t.port = o.dest;
      report.push(`${t.name}從${from}抵達${t.port}。`);
      log(t, S, `從${from}航行至${t.port}`, o.basis);
    } else {
      t.sea = { from, to: o.dest, arrive: round + turns - 1 };
      report.push(`${t.name}從${from}出航，前往${o.dest}，預計第 ${t.sea.arrive} 回合結束時抵達。`);
      log(t, S, `出航前往${o.dest}（需 ${turns} 回合）`, o.basis);
    }
  }

  // 2. 物價回穩（先回穩，事件的衝擊才會完整留到下回合）
  for (const p of PORTS) for (const g of GOODS) {
    const cur = r.prices[p][g], b = r.base[p][g];
    if (cur > b) r.prices[p][g] = cur - 1; else if (cur < b) r.prices[p][g] = cur + 1;
  }

  // 3. 事件
  const flagsNext = {};
  let eventApplies = true;
  if (E.summerOnly && season(round) !== '夏') eventApplies = false;
  report.unshift(`事件：${E.title}——${E.text}`);
  if (eventApplies) {
    switch (ev) {
      case 1:
        flagsNext.closed = { port: '月港', round: round + 1 };
        addPrice(S, '月港', '生絲', 2, report, deltas); addPrice(S, '月港', '瓷器', 2, report, deltas); break;
      case 2: addPrice(S, '長崎', '生絲', 3, report, deltas); break;
      case 3: addPrice(S, '馬尼拉', '白銀', -2, report, deltas); addPrice(S, '馬尼拉', '生絲', 2, report, deltas); break;
      case 4:
        for (const id of ids) {
          const t = S.teams[id];
          if (t.sea) { const g = loseCargo(t); if (g) { report.push(`${t.name}在海上遇颱風，失去 1 箱${g}。`); log(t, S, `颱風損失 1 箱${g}`); } }
        }
        break;
      case 5: addPrice(S, '大員', '蔗糖', -2, report, deltas); break;
      case 6:
        for (const p of ['大員', '雞籠']) { r.base[p]['鹿皮'] = clamp(r.base[p]['鹿皮'] + 2); addPrice(S, p, '鹿皮', 2, report, deltas); }
        break;
      case 7:
        for (const id of ids) {
          const t = S.teams[id];
          if (!t.sea && t.port === '澎湖') {
            if (t.silver >= 2) { t.silver -= 2; report.push(`${t.name}在澎湖付給海盜 2 銀兩。`); log(t, S, '付給海盜 2 銀兩'); }
            else { const g = loseCargo(t); report.push(`${t.name}在澎湖被海盜搶走${g ? ' 1 箱' + g : '，但船上空無一物'}。`); if (g) log(t, S, `被海盜搶走 1 箱${g}`); }
          }
        }
        break;
      case 8: for (const p of PORTS) addPrice(S, p, '香料', 1, report, deltas); break;
      case 9: {
        const allowed = ['jpn'];
        for (const id of ids) {
          if (S.hands[id].cards.some((c) => { const k = S.secret.cards[c.cid]; return k && k.ev === 9 && k.kind !== 'R'; })) allowed.push(id);
        }
        flagsNext.restrict = { port: '長崎', round: round + 1, allowed: [...new Set(allowed)] };
        break;
      }
      case 10:
        for (const g of GOODS) addPrice(S, '月港', g, -1, report, deltas);
        flagsNext.openSea = round + 1; break;
      case 11: flagsNext.blockedRoute = { a: '雞籠', b: '大員', round: round + 1 }; break;
      case 12: addPrice(S, '長崎', '瓷器', 2, report, deltas); addPrice(S, '馬尼拉', '瓷器', 2, report, deltas); break;
      default: break;
    }
  } else {
    report.push('（本回合是冬季，颱風沒有成形。）');
  }

  // 3. 預測下注
  for (const id of ids) {
    const t = S.teams[id];
    const b = t.order && t.order.bet;
    if (!b) continue;
    const d = deltas.filter(([p, g]) => p === b.port && g === b.good).reduce((s, x) => s + x[2], 0);
    const hit = (b.dir === 'up' && d > 0) || (b.dir === 'down' && d < 0);
    const dirTxt = b.dir === 'up' ? '漲' : '跌';
    if (hit) {
      t.silver += b.amt * 2; t.rep += 1;
      report.push(`${t.name}猜中${b.port}${b.good}會${dirTxt}，贏得 ${b.amt * 2} 銀兩與 1 聲望。`);
      log(t, S, `下注猜中：${b.port}${b.good}${dirTxt}，+${b.amt * 2} 銀兩、+1 聲望`, t.order.basis);
    } else {
      log(t, S, `下注落空：${b.port}${b.good}${dirTxt}，失去 ${b.amt} 銀兩`, t.order.basis);
    }
  }

  // 4. 指認謠言
  for (const id of ids) {
    const t = S.teams[id];
    const h = S.hands[id];
    for (const acc of h.accused) {
      if (acc.judged) continue;
      const k = S.secret.cards[acc.cid];
      if (!k || k.kind === 'G') { acc.judged = true; continue; }
      if (k.round > round) continue;
      acc.judged = true;
      if (k.kind === 'R') { t.rep += 1; acc.result = 'right'; report.push(`${t.name}識破謠言 #${acc.cid}，聲望 +1。`); log(t, S, `識破謠言 #${acc.cid}，+1 聲望`); }
      else { t.rep -= 1; acc.result = 'wrong'; report.push(`${t.name}把真情報 #${acc.cid} 誤當謠言，聲望 −1。`); log(t, S, `誤判 #${acc.cid} 為謠言，−1 聲望`); }
    }
  }

  // 公開本回合情報真假（事件已發生）
  const reveal = {};
  for (const [cid, k] of Object.entries(S.secret.cards)) if (k.round === round && k.kind !== 'G') reveal[cid] = k.kind === 'R' ? 'rumor' : 'true';

  r.flags = flagsNext;
  r.lastReport = { round, ev, title: E.title, text: E.text, lines: report, reveal };
  r.reports.push(r.lastReport);
}

// ---------- 玩家動作 ----------
const ok = (msg, extra = {}) => ({ ok: true, msg, ...extra });
const fail = (msg) => ({ ok: false, msg });

function memberTeam(S, uid) {
  return TEAM_IDS.find((id) => S.teams[id].members[uid]);
}

export function applyAction(S, a) {
  const r = S.room;
  if (a.type === 'join') {
    if (r.status === 'ended') return fail('遊戲已結束');
    const cur = memberTeam(S, a.uid);
    if (!TEAMS[a.team]) return fail('沒有這個勢力');
    if (cur && r.status !== 'lobby') return fail('遊戲已開始，不能換組');
    if (cur) delete S.teams[cur].members[a.uid];
    S.teams[a.team].members[a.uid] = String(a.name || '船員').slice(0, 12);
    return ok(`加入${TEAMS[a.team].name}`);
  }
  if (a.type === 'leave') {
    const cur = memberTeam(S, a.uid);
    if (!cur) return fail('你還沒有加入任何勢力');
    if (r.status !== 'lobby') return fail('遊戲已開始，不能換組');
    delete S.teams[cur].members[a.uid];
    return ok('已離開，請重新選擇勢力');
  }
  const tid = memberTeam(S, a.uid);
  if (!tid) return fail('你還沒有加入任何勢力');
  const t = S.teams[tid];
  if (a.type === 'review') {
    if (r.status !== 'ended') return fail('終局後才能寫航海檢討');
    t.review = String(a.text || '').slice(0, 120);
    return ok('已送出航海檢討');
  }
  if (r.status !== 'playing') return fail('遊戲不在進行中');

  switch (a.type) {
    case 'buy':
    case 'sell': return trade(S, tid, a);
    case 'order': return order(S, tid, a);
    case 'accuse': {
      const h = S.hands[tid];
      if (!h.cards.some((c) => c.cid === a.cid)) return fail('你手上沒有這張情報');
      if (a.cid.startsWith('g')) return fail('牙行的行情不能指認為謠言');
      if (h.accused.some((x) => x.cid === a.cid)) return fail('已經指認過了');
      if (r.phase === 'resolve') return fail('結算中，下回合再指認');
      h.accused.push({ cid: a.cid, round: r.round, judged: false });
      log(t, S, `公開指認 #${a.cid} 是謠言`);
      return ok(`已公開指認 #${a.cid} 是謠言`, { publicNote: `${t.name}公開指認情報 #${a.cid} 是謠言。` });
    }
    case 'offer': return makeOffer(S, tid, a);
    case 'respond': return respondOffer(S, tid, a);
    case 'review': t.review = String(a.text || '').slice(0, 120); return ok('已送出航海檢討');
    default: return fail('未知的動作');
  }
}

function trade(S, tid, a) {
  const r = S.room, t = S.teams[tid];
  if (r.phase !== 'trade') return fail('現在不是交易階段');
  if (t.sea) return fail('船在海上，不能交易');
  const g = a.good;
  if (!GOODS.includes(g)) return fail('沒有這種貨物');
  const rs = r.flags.restrict;
  if (rs && rs.round === r.round && rs.port === t.port && !rs.allowed.includes(tid)) return fail(`${t.port}限制外商，本組不能交易`);
  const qty = Math.max(1, Math.min(4, Number(a.qty) || 1));
  const pr = r.prices[t.port];
  let total = 0, done = 0;
  for (let i = 0; i < qty; i++) {
    let p = pr[g];
    if (tid === 'jpn' && t.port === '長崎' && g === '白銀') p = a.type === 'buy' ? Math.max(1, p - 1) : p + 1;
    if (a.type === 'buy') {
      if (cargoCount(t) >= HOLD) break;
      if (t.silver < p) break;
      t.silver -= p; t.cargo[g] += 1; total += p; done++;
      if (!(tid === 'voc' && t.port === '大員')) pr[g] = clamp(pr[g] + 1);
    } else {
      if (t.cargo[g] < 1) break;
      t.silver += p; t.cargo[g] -= 1; total += p; done++;
      pr[g] = clamp(pr[g] - 1);
    }
  }
  if (!done) return fail(a.type === 'buy' ? (cargoCount(t) >= HOLD ? '船艙已滿' : '銀兩不夠') : `船上沒有${g}`);
  const verb = a.type === 'buy' ? '買進' : '賣出';
  log(t, S, `在${t.port}${verb} ${done} 箱${g}，共 ${total} 銀兩`, a.basis || null);
  return ok(`${verb} ${done} 箱${g}，共 ${total} 銀兩`);
}

function order(S, tid, a) {
  const r = S.room, t = S.teams[tid];
  if (r.phase !== 'orders') return fail('現在不是指令階段');
  let dest = a.dest || null;
  if (dest) {
    if (t.sea) return fail('船在海上，不能改變航向');
    const turns = travelTime(t.port, dest, r.round, r.flags);
    if (turns == null) return fail(`這個季節無法從${t.port}前往${dest}`);
  }
  let bet = null;
  if (a.bet && a.bet.amt > 0) {
    const amt = Math.min(3, Math.max(1, Math.floor(a.bet.amt)));
    if (!PORTS.includes(a.bet.port) || !GOODS.includes(a.bet.good) || !['up', 'down'].includes(a.bet.dir)) return fail('下注內容不完整');
    const prevAmt = (t.order && t.order.bet) ? t.order.bet.amt : 0;
    if (t.silver + prevAmt < amt) return fail('銀兩不夠下注');
    t.silver += prevAmt;
    t.silver -= amt;
    bet = { port: a.bet.port, good: a.bet.good, dir: a.bet.dir, amt };
  } else if (t.order && t.order.bet) {
    t.silver += t.order.bet.amt;
  }
  t.order = { dest, bet, basis: a.basis || null };
  const parts = [dest ? `下一站：${dest}` : '留在港口'];
  if (bet) parts.push(`押 ${bet.amt} 銀兩賭${bet.port}${bet.good}${bet.dir === 'up' ? '漲' : '跌'}`);
  return ok('指令已送出：' + parts.join('，'));
}

// ---------- 談判交易 ----------
function makeOffer(S, tid, a) {
  const r = S.room, t = S.teams[tid];
  if (!['negotiate', 'trade'].includes(r.phase)) return fail('只有談判或交易階段能提出交換');
  const to = a.to;
  if (!S.teams[to] || to === tid || !Object.keys(S.teams[to].members).length) return fail('對象不存在');
  const give = normPack(a.give), want = normPack(a.want);
  if (isEmpty(give) && isEmpty(want)) return fail('交換內容是空的');
  const chk = canPay(S, tid, give);
  if (chk) return fail(chk);
  const id = 'o' + shortId();
  return ok('已送出交換提議', { offer: { id, from: tid, to, give, want, status: 'open', round: r.round } });
}

export function normPack(p = {}) {
  const cargo = {};
  for (const g of GOODS) { const n = Math.max(0, Math.floor((p.cargo || {})[g] || 0)); if (n) cargo[g] = n; }
  return { silver: Math.max(0, Math.floor(p.silver || 0)), cargo, cards: [...new Set(p.cards || [])].slice(0, 5) };
}
const isEmpty = (p) => !p.silver && !Object.keys(p.cargo).length && !p.cards.length;

function canPay(S, tid, p) {
  const t = S.teams[tid];
  if (t.silver < p.silver) return `${t.name}銀兩不夠`;
  for (const [g, n] of Object.entries(p.cargo)) if ((t.cargo[g] || 0) < n) return `${t.name}的${g}不夠`;
  for (const cid of p.cards) if (!S.hands[tid].cards.some((c) => c.cid === cid)) return `${t.name}沒有情報 #${cid}`;
  return null;
}

// offer 物件由呼叫端提供（存在資料庫中）
export function respondOffer(S, tid, a) {
  const o = a.offer;
  if (!o || o.status !== 'open') return fail('這個提議已經失效');
  if (a.accept === false) {
    if (o.to !== tid && o.from !== tid) return fail('不是你的提議');
    return ok(o.from === tid ? '已撤回提議' : '已拒絕提議', { offerStatus: o.from === tid ? 'withdrawn' : 'declined' });
  }
  if (o.to !== tid) return fail('只有被提議的一方能接受');
  if (!['negotiate', 'trade'].includes(S.room.phase)) return fail('只有談判或交易階段能交換');
  const A = S.teams[o.from], B = S.teams[o.to];
  const hasCargo = Object.keys(o.give.cargo).length || Object.keys(o.want.cargo).length;
  if (hasCargo && (A.sea || B.sea || A.port !== B.port)) return fail('交換貨物時，兩艘船必須停在同一個港口');
  const e1 = canPay(S, o.from, o.give) || canPay(S, o.to, o.want);
  if (e1) return fail(e1);
  const incA = sumCargo(o.want.cargo) - sumCargo(o.give.cargo);
  const incB = -incA;
  if (cargoCount(A) + incA > HOLD) return fail(`${A.name}船艙放不下`);
  if (cargoCount(B) + incB > HOLD) return fail(`${B.name}船艙放不下`);
  transfer(S, o.from, o.to, o.give);
  transfer(S, o.to, o.from, o.want);
  log(A, S, `與${B.name}完成交換：付出${packText(o.give)}，得到${packText(o.want)}`);
  log(B, S, `與${A.name}完成交換：付出${packText(o.want)}，得到${packText(o.give)}`);
  return ok('交換完成', { offerStatus: 'accepted' });
}
const sumCargo = (c) => Object.values(c).reduce((s, n) => s + n, 0);
function transfer(S, from, to, p) {
  const A = S.teams[from], B = S.teams[to];
  A.silver -= p.silver; B.silver += p.silver;
  for (const [g, n] of Object.entries(p.cargo)) { A.cargo[g] -= n; B.cargo[g] += n; }
  for (const cid of p.cards) {
    const i = S.hands[from].cards.findIndex((c) => c.cid === cid);
    if (i >= 0) { const [c] = S.hands[from].cards.splice(i, 1); S.hands[to].cards.push({ ...c, from }); }
  }
}
export function packText(p) {
  const parts = [];
  if (p.silver) parts.push(`${p.silver} 銀兩`);
  for (const [g, n] of Object.entries(p.cargo || {})) parts.push(`${n} 箱${g}`);
  for (const cid of p.cards || []) parts.push(`情報 #${cid}`);
  return parts.length ? parts.join('、') : '（無）';
}

export function ranking(S) {
  return activeTeams(S).map((id) => ({ id, name: S.teams[id].name, score: score(S.teams[id]), rep: S.teams[id].rep }))
    .sort((a, b) => b.score - a.score || b.rep - a.rep);
}
