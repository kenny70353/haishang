// 老師端主機：保存完整遊戲狀態、依序處理學生送來的動作，並寫回資料庫
import * as L from './logic.js?v=20261103w';
import { TEAM_IDS, TEAMS, EVENTS, PHASE_NAME } from './data.js?v=20261103w';

const PUBLIC_TEAM_KEYS = ['id', 'name', 'members', 'silver', 'cargo', 'port', 'sea', 'rep', 'zhengUsed', 'review'];

export function splitState(S) {
  const docs = {};
  const roomPath = `rooms/${S.room.code}`;
  docs[roomPath] = S.room;
  docs[`${roomPath}/secret/main`] = S.secret;
  for (const id of TEAM_IDS) {
    const t = S.teams[id];
    const pub = Object.fromEntries(PUBLIC_TEAM_KEYS.map((k) => [k, t[k] ?? null]));
    pub.orderSent = !!t.order;
    docs[`${roomPath}/teams/${id}`] = pub;
    docs[`${roomPath}/hands/${id}`] = { ...S.hands[id], order: t.order, log: t.log };
  }
  return docs;
}

export async function loadState(backend, code) {
  const p = `rooms/${code}`;
  const room = await backend.getDoc(p);
  if (!room) return null;
  const secret = await backend.getDoc(`${p}/secret/main`);
  const teams = {}, hands = {};
  for (const id of TEAM_IDS) {
    const t = await backend.getDoc(`${p}/teams/${id}`);
    const h = await backend.getDoc(`${p}/hands/${id}`) || { cards: [], accused: [], order: null, log: [] };
    teams[id] = { ...t, order: h.order || null, log: h.log || [] };
    delete teams[id].orderSent;
    hands[id] = { cards: h.cards || [], accused: h.accused || [] };
  }
  return { room, secret, teams, hands };
}

export class Host {
  constructor(backend, S, onChange) {
    this.backend = backend;
    this.S = S;
    this.onChange = onChange || (() => {});
    this.written = {};
    this.queue = [];
    this.seen = new Set();
    this.busy = false;
    this.offers = {};
    this.unsubs = [];
    this.code = S.room.code;
  }

  static async create(backend, { mode, eventOrder }) {
    let code;
    for (let i = 0; i < 20; i++) {
      code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
      if (!(await backend.getDoc(`rooms/${code}`))) break;
    }
    const S = L.newGame({ code, teacherUid: backend.user.uid, mode, eventOrder });
    S.room.createdAt = backend.now();
    S.room.teacherName = backend.user.name || '老師';
    // 房間文件要先建立，安全規則才能判斷誰是老師
    await backend.setDoc(`rooms/${code}`, S.room);
    const h = new Host(backend, S);
    await h.persist();
    return h;
  }

  static async resume(backend, code) {
    const S = await loadState(backend, code);
    if (!S) return null;
    const h = new Host(backend, S);
    for (const [p, d] of Object.entries(splitState(S))) h.written[p] = JSON.stringify(d);
    return h;
  }

  start() {
    const p = `rooms/${this.code}`;
    this.unsubs.push(this.backend.onQuery(`${p}/actions`, ['status', 'pending'], (list) => {
      for (const a of list.sort((x, y) => (x.ts || 0) - (y.ts || 0))) {
        if (this.seen.has(a.id)) continue;
        this.seen.add(a.id);
        this.queue.push(a);
      }
      this.pump();
    }));
    this.unsubs.push(this.backend.onQuery(`${p}/offers`, null, (list) => {
      this.offers = Object.fromEntries(list.map((o) => [o.id, o]));
      this.onChange();
    }));
  }
  stop() { this.unsubs.forEach((u) => u()); this.unsubs = []; }

  async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const a = this.queue.shift();
        await this.handle(a);
      }
    } finally { this.busy = false; }
  }

  async handle(a) {
    const p = `rooms/${this.code}`;
    let res;
    const extraWrites = [];
    try {
      if (a.type === 'respond') {
        const offer = this.offers[a.offerId];
        const tid = TEAM_IDS.find((id) => this.S.teams[id].members[a.uid]);
        res = tid ? L.respondOffer(this.S, tid, { offer, accept: a.accept }) : { ok: false, msg: '你還沒有加入任何勢力' };
        if (res.ok && res.offerStatus) extraWrites.push({ path: `${p}/offers/${offer.id}`, data: { ...offer, status: res.offerStatus } });
      } else {
        res = L.applyAction(this.S, a);
        if (res.ok && res.offer) extraWrites.push({ path: `${p}/offers/${res.offer.id}`, data: { ...res.offer, ts: this.backend.now() } });
        if (res.ok && res.publicNote) extraWrites.push({ path: `${p}/messages/n${a.id}`, data: { from: 'system', to: 'all', text: res.publicNote, ts: this.backend.now(), uid: 'system' } });
      }
    } catch (e) {
      console.error(e);
      res = { ok: false, msg: '處理時發生錯誤' };
    }
    extraWrites.push({ path: `${p}/actions/${a.id}`, data: { ...a, status: res.ok ? 'done' : 'rejected', msg: res.msg } });
    await this.persist(extraWrites);
  }

  async persist(extra = []) {
    const writes = [];
    for (const [path, data] of Object.entries(splitState(this.S))) {
      const j = JSON.stringify(data);
      if (this.written[path] !== j) { writes.push({ path, data }); this.written[path] = j; }
    }
    writes.push(...extra);
    if (writes.length) await this.backend.batch(writes);
    this.onChange();
  }

  async command(name, arg) {
    let res = { ok: true };
    if (name === 'start') res = L.startGame(this.S);
    else if (name === 'advance') {
      const before = this.S.room.phase;
      res = L.advance(this.S);
      if (res.ok) {
        this.S.room.phaseEndsAt = null;
        if (this.S.room.phase === 'resolve' || before === 'resolve') await this.say(this.S.room.phase === 'resolve'
          ? `第 ${this.S.room.round} 回合事件：${EVENTS[this.S.room.lastReport.ev].title}`
          : (this.S.room.status === 'ended' ? '遊戲結束，請查看排名並寫下航海檢討。' : `第 ${this.S.room.round} 回合開始，進入情報階段。`));
      }
    } else if (name === 'timer') this.S.room.phaseEndsAt = arg ? this.backend.now() + arg * 1000 : null;
    else if (name === 'kick') { for (const id of TEAM_IDS) delete this.S.teams[id].members[arg]; }
    if (res.ok) await this.persist();
    return res;
  }

  async say(text) {
    await this.backend.setDoc(`rooms/${this.code}/messages/s${this.backend.now()}${Math.random().toString(36).slice(2, 5)}`,
      { from: 'teacher', to: 'all', text, ts: this.backend.now(), uid: this.backend.user.uid, name: '港務官' });
  }

  phaseLabel() { return PHASE_NAME[this.S.room.phase]; }

  exportCsv() {
    const rows = [['回合', '階段', '勢力', '組員', '紀錄', '依據情報']];
    for (const id of TEAM_IDS) {
      const t = this.S.teams[id];
      if (!Object.keys(t.members).length) continue;
      const mem = Object.values(t.members).join('、');
      for (const e of t.log) rows.push([e.round, PHASE_NAME[e.phase] || e.phase, TEAMS[id].name, mem, e.text, e.basis ? '#' + e.basis : '']);
      if (t.review) rows.push(['終局', '航海檢討', TEAMS[id].name, mem, t.review, '']);
    }
    return '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  }
}
