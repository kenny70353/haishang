import assert from 'node:assert/strict';
import * as L from '../js/logic.js';
import { TEAM_IDS, PORTS, GOODS } from '../js/data.js';

let seed = 7;
L.setRandom(() => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; });

// 航行規則
assert.equal(L.travelTime('長崎', '雞籠', 1), 1, '冬季往南順風');
assert.equal(L.travelTime('雞籠', '長崎', 1), 2, '冬季往北逆風');
assert.equal(L.travelTime('雞籠', '長崎', 2), 1, '夏季往北順風');
assert.equal(L.travelTime('月港', '澎湖', 1), 1, '東西航線');
assert.equal(L.travelTime('月港', '長崎', 1), null, '冬季長程往北不能出航');
assert.equal(L.travelTime('月港', '長崎', 2), 2, '夏季長程往北 2 回合');
assert.equal(L.travelTime('月港', '長崎', 1, { openSea: 1 }), 2, '開海時不受風向');
assert.equal(L.travelTime('雞籠', '大員', 3, { blockedRoute: { a: '雞籠', b: '大員', round: 3 } }), null);
assert.equal(L.travelTime('月港', '大員', 1), null, '沒有直達航線');

const S = L.newGame({ code: 'ABCD', teacherUid: 't', mode: 'plain' });
let r = L.startGame(S); assert.equal(r.ok, false, '沒人時不能開始');
for (const [i, id] of TEAM_IDS.entries()) L.applyAction(S, { type: 'join', uid: 'u' + i, team: id, name: '學生' + i });
L.applyAction(S, { type: 'join', uid: 'u9', team: 'voc', name: '第二人' });
assert.equal(Object.keys(S.teams.voc.members).length, 2);
assert.ok(L.startGame(S).ok);
assert.equal(S.room.round, 1);
assert.equal(S.hands.minnan.cards.length, 2, '閩南多抽一張');
assert.equal(S.hands.jpn.cards.length, 1);
assert.equal(S.teams.esp.cargo['白銀'], 1);
// 手牌不應洩漏真假
for (const id of TEAM_IDS) for (const c of S.hands[id].cards) assert.ok(!('kind' in c));

// 交易：非交易階段不能買
assert.equal(L.applyAction(S, { type: 'buy', uid: 'u2', good: '生絲', qty: 1 }).ok, false);
L.advance(S); L.advance(S); assert.equal(S.room.phase, 'trade');
// 鄭氏在月港買 3 箱生絲：2+3+4
r = L.applyAction(S, { type: 'buy', uid: 'u2', good: '生絲', qty: 3 });
assert.ok(r.ok, r.msg); assert.equal(S.teams.zheng.silver, 1); assert.equal(S.room.prices['月港']['生絲'], 5);
// 荷蘭在大員買鹿皮不漲價
L.applyAction(S, { type: 'buy', uid: 'u0', good: '鹿皮', qty: 2 });
assert.equal(S.room.prices['大員']['鹿皮'], 2); assert.equal(S.teams.voc.silver, 6);
// 日本在長崎賣白銀前先買：price 2 -> 付 1
L.applyAction(S, { type: 'buy', uid: 'u3', good: '白銀', qty: 1 });
assert.equal(S.teams.jpn.silver, 9);
// 交換提議：同港才可換貨
const off = L.applyAction(S, { type: 'offer', uid: 'u0', to: 'esp', give: { silver: 2 }, want: { cargo: { 白銀: 1 } } });
assert.ok(off.ok);
r = L.respondOffer(S, 'esp', { accept: true, offer: off.offer });
assert.equal(r.ok, false, '不同港不能換貨');
const off2 = L.applyAction(S, { type: 'offer', uid: 'u0', to: 'esp', give: { silver: 2, cards: [S.hands.voc.cards[0].cid] }, want: {} });
r = L.respondOffer(S, 'esp', { accept: true, offer: off2.offer });
assert.ok(r.ok, r.msg); assert.equal(S.teams.esp.silver, 12); assert.equal(S.hands.esp.cards.length, 2);

L.advance(S); assert.equal(S.room.phase, 'orders');
// 鄭氏冬季從月港往長崎：不行；往澎湖可以
assert.equal(L.applyAction(S, { type: 'order', uid: 'u2', dest: '長崎' }).ok, false);
assert.ok(L.applyAction(S, { type: 'order', uid: 'u2', dest: '澎湖' }).ok);
// 日本往雞籠（冬南順風）並押長崎生絲漲（第 1 回合事件 2）
r = L.applyAction(S, { type: 'order', uid: 'u3', dest: '雞籠', bet: { port: '長崎', good: '生絲', dir: 'up', amt: 3 } });
assert.ok(r.ok, r.msg); assert.equal(S.teams.jpn.silver, 6);
// 西班牙往大員北上（冬季逆風 2 回合）
assert.ok(L.applyAction(S, { type: 'order', uid: 'u1', dest: '大員' }).ok);
L.advance(S); assert.equal(S.room.phase, 'resolve');
assert.equal(S.teams.zheng.port, '澎湖');
assert.equal(S.teams.jpn.port, '雞籠');
assert.equal(S.teams.jpn.silver, 12, '猜中拿回兩倍');
assert.equal(S.teams.jpn.rep, 1);
assert.ok(S.teams.esp.sea && S.teams.esp.sea.arrive === 2);
assert.equal(S.room.prices['長崎']['生絲'], 10, '先回穩再 +3');
assert.equal(S.room.prices['月港']['生絲'], 4, '月港生絲 5 回穩為 4');
console.log('report', S.room.lastReport.lines);

// 跑完 6 回合
for (let k = 0; k < 40 && S.room.status !== 'ended'; k++) L.advance(S);
assert.equal(S.room.status, 'ended');
assert.equal(S.room.reports.length, 6);
const rk = L.ranking(S);
assert.equal(rk.length, 5);
for (const p of PORTS) for (const g of GOODS) assert.ok(S.room.prices[p][g] >= 1 && S.room.prices[p][g] <= 12);
console.log(rk);
console.log('ALL TESTS PASSED');
