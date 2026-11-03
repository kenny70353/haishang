// 《航海通商》規則引擎測試（歷史劇本 1609–1635）
import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { EVENTS, INTEL, PORT_OPEN, ROUTES, BASE_PRICES, GOODS, PORTS } from '../js/data.js';

let seed = 7;
L.setRandom(() => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; });

// 資料完整性：情報卡放在當回合已開放的港口
for (let r = 1; r <= 6; r++) {
  const e = EVENTS[r];
  assert.ok(e && INTEL[r], `事件 ${r} 缺資料`);
  for (const p of [...e.trueAt, e.rumorAt]) assert.ok(L.portOpen(p, r), `事件 ${r} 的情報放在未開港的${p}`);
}
for (const p of PORTS) for (const g of GOODS) assert.ok(BASE_PRICES[p][g] >= 1, `${p}${g} 缺物價`);

// 開港與航行
assert.equal(L.travelTime('月港', '澎湖', 1), null, '澎湖第 2 回合才開港');
assert.equal(L.travelTime('月港', '澎湖', 2), 1);
assert.equal(L.travelTime('澎湖', '大員', 2), null, '大員第 3 回合才開港');
assert.equal(L.travelTime('澎湖', '大員', 3), 1);
assert.equal(L.travelTime('大員', '雞籠', 3), null, '雞籠第 4 回合才開港');
assert.equal(L.travelTime('大員', '雞籠', 4), 1, '夏季往北順風');
assert.equal(L.travelTime('月港', '馬尼拉', 1), 2, '冬季長程往南');
assert.equal(L.travelTime('月港', '長崎', 1), null, '冬季長程往北不能出航');
assert.equal(L.travelTime('長崎', '馬尼拉', 1), 2);
assert.equal(L.travelTime('馬尼拉', '雞籠', 4), 2);
assert.ok(ROUTES.length === 9);

// 交易禁令
assert.ok(L.tradeBan('voc', '月港', 1), '外國船不能在月港交易');
assert.ok(L.tradeBan('jpn', '月港', 1));
assert.equal(L.tradeBan('minnan', '月港', 1), null);
assert.equal(L.tradeBan('esp', '長崎', 2), null, '1624 年前西班牙仍可到日本');
assert.ok(L.tradeBan('esp', '長崎', 3), '1624 年起禁西班牙');
assert.ok(L.tradeBan('voc', '長崎', 5) && !L.tradeBan('voc', '長崎', 4) && !L.tradeBan('voc', '長崎', 6), '日荷貿易只在 1628–1632 中斷');
assert.ok(L.tradeBan('voc', '馬尼拉', 1) && L.tradeBan('esp', '大員', 3) && L.tradeBan('voc', '雞籠', 4));
assert.equal(L.tradeBan('voc', '澎湖', 2), null, '荷蘭佔據澎湖時可交易');
assert.ok(L.tradeBan('voc', '澎湖', 3) && L.tradeBan('jpn', '澎湖', 3) && !L.tradeBan('minnan', '澎湖', 3));
assert.ok(L.destBlock('voc', '大員', 2) && !L.destBlock('voc', '大員', 3));
assert.ok(L.destBlock('esp', '長崎', 3) && !L.destBlock('esp', '長崎', 2));
assert.equal(L.holdOf('zheng'), 5);

// 開局（1609）
const S = L.newGame({ code: 'TEST', teacherUid: 't' });
for (const [uid, team] of [['a', 'voc'], ['b', 'esp'], ['c', 'zheng'], ['d', 'jpn'], ['e', 'minnan']]) {
  assert.ok(L.applyAction(S, { type: 'join', uid, name: uid, team }).ok);
}
assert.equal(S.teams.voc.port, '長崎', '荷蘭從平戶商館出發');
assert.equal(S.teams.zheng.port, '長崎');
assert.equal(S.teams.minnan.port, '月港');
assert.equal(S.teams.voc.cargo['胡椒'], 1);
assert.deepEqual(S.secret.eventOrder, [1, 2, 3, 4, 5, 6]);
assert.ok(L.startGame(S).ok);
assert.equal(S.hands.minnan.cards.length, 2, '閩南多抽 1 張');

const go = (phase) => { while (S.room.phase !== phase) assert.ok(L.advance(S).ok); };

// 第 1 回合
go('trade');
S.teams.zheng.silver = 60; S.teams.minnan.silver = 40;
assert.ok(L.applyAction(S, { type: 'buy', uid: 'a', good: '白銀', qty: 1 }).ok, '荷蘭在長崎可交易');
assert.ok(L.applyAction(S, { type: 'buy', uid: 'c', good: '白銀', qty: 4 }).ok);
assert.ok(L.applyAction(S, { type: 'buy', uid: 'c', good: '白銀', qty: 1 }).ok, '鄭芝龍集團第 5 箱');
assert.equal(L.cargoCount(S.teams.zheng), 5);
assert.ok(L.applyAction(S, { type: 'buy', uid: 'e', good: '生絲', qty: 4 }).ok);
assert.equal(L.applyAction(S, { type: 'buy', uid: 'e', good: '瓷器', qty: 1 }).ok, false, '閩南只能裝 4 箱');

go('orders');
assert.equal(L.applyAction(S, { type: 'order', uid: 'a', dest: '澎湖' }).ok, false, '澎湖未開港');
assert.ok(L.applyAction(S, { type: 'order', uid: 'c', dest: '月港', bet: { port: '馬尼拉', good: '生絲', dir: 'up', amt: 2 } }).ok);
assert.ok(L.applyAction(S, { type: 'order', uid: 'd', dest: '馬尼拉' }).ok);
go('resolve');
// 事件 1（1622）：荷蘭集結澎湖、馬尼拉生絲上漲、下注猜中
assert.equal(S.teams.voc.port, '澎湖');
assert.ok(S.room.prices['馬尼拉']['生絲'] > BASE_PRICES['馬尼拉']['生絲']);
assert.equal(S.teams.zheng.rep, 1, '猜中馬尼拉生絲漲');
assert.ok(S.teams.zheng.sea && S.teams.zheng.sea.to === '月港');
assert.match(S.room.lastReport.title, /1622/);

// 第 2 回合（1622–1623）：荷蘭在澎湖交易；西班牙還能前往長崎
assert.ok(L.advance(S).ok);
go('trade');
assert.ok(L.applyAction(S, { type: 'buy', uid: 'a', good: '生絲', qty: 1 }).ok, '荷蘭在澎湖可交易');
go('orders');
assert.ok(L.applyAction(S, { type: 'order', uid: 'b', dest: '長崎' }).ok);
go('resolve');
assert.equal(S.teams.voc.port, '大員', '1624 荷蘭轉往大員');
assert.equal(S.teams.zheng.port, '月港');
assert.ok(S.teams.esp.sea);

// 第 3 回合（1624–1625）：鄭芝龍集團在月港賣白銀
assert.ok(L.advance(S).ok);
go('trade');
assert.ok(L.applyAction(S, { type: 'sell', uid: 'c', good: '白銀', qty: 2 }).ok, '在月港賣白銀');
go('resolve');
assert.equal(S.teams.esp.port, '長崎');
assert.ok(L.advance(S).ok);
go('trade');
assert.equal(L.applyAction(S, { type: 'buy', uid: 'b', good: '白銀', qty: 1 }).ok, false, '1624 後西班牙不能在長崎交易');

// 走完全局；第 6 事件：日本朱印船若在海外會失去貨
for (let i = 0; i < 40 && S.room.status !== 'ended'; i++) L.advance(S);
assert.equal(S.room.status, 'ended');
assert.equal(S.room.reports.length, 6);
assert.deepEqual(S.room.reports.map((r) => r.ev), [1, 2, 3, 4, 5, 6]);
assert.match(S.room.reports[5].title, /1635/);
assert.ok(PORT_OPEN['雞籠'] === 4);
console.log('ALL TESTS PASSED');
