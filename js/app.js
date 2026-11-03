import { firebaseConfig, allowGuest } from './firebase-config.js?v=20261103w';
import { createMemoryBackend } from './backend-memory.js?v=20261103w';
import { Host } from './host.js?v=20261103w';
import * as L from './logic.js?v=20261103w';
import { chartSvg, layoutChart } from './chart.js?v=20261103w';
import {
  PORTS, GOODS, POS, ROUTES, TEAMS, TEAM_IDS, HOLD, ROUNDS, PHASES, PHASE_NAME, PHASE_HINT,
  EVENTS, RECOMMENDED_ORDER, BASE_PRICES, ERAS, PORT_NOTE, OPEN_YEAR, PORT_OPEN,
} from './data.js?v=20261103w';

// ================= 工具 =================
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('hs_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hs_' + k, JSON.stringify(v)); } catch { /* 無法儲存時略過 */ } },
};
let toastTimer;
function toast(msg, bad = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = bad ? 'bad' : ''; }, 2600);
}
function ask(msg, okText = '確定') {
  return new Promise((res) => {
    const d = document.createElement('div');
    d.className = 'modal';
    d.innerHTML = `<div class="modal-box card" role="dialog" aria-modal="true"><p>${esc(msg)}</p><div class="row" style="justify-content:flex-end"><button class="btn" data-x="0">取消</button><button class="btn seal" data-x="1">${esc(okText)}</button></div></div>`;
    document.body.appendChild(d);
    d.querySelector('[data-x="1"]').focus();
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-x]');
      if (!b && e.target !== d) return;
      d.remove(); res(!!b && b.dataset.x === '1');
    });
  });
}
const cargoText = (c) => GOODS.filter((g) => c && c[g]).map((g) => `${g}×${c[g]}`).join('、') || '空艙';
const teamColor = (id) => TEAMS[id]?.color || '#888';
const seasonOf = (round) => (round ? L.season(round) : '');

// ================= 全域狀態 =================
const params = new URLSearchParams(location.search);
const configured = !!(firebaseConfig && firebaseConfig.apiKey);
const U = {
  backend: null, user: null, demo: false, view: 'loading', role: null, code: null,
  host: null, tab: 'map', subs: [], pendingRender: false, toasted: new Set(), seenMsg: 0,
  draft: { qty: {}, order: null, offer: null, chat: '', chan: 'all', basis: '', name: '' },
  D: freshData(),
};
function freshData() { return { room: null, teams: {}, hand: null, actions: {}, msgs: {}, offers: {}, joined: false }; }
function clearSubs() { U.subs.forEach((u) => { try { u(); } catch { /* 已取消 */ } }); U.subs = []; }

// ================= 啟動 =================
async function boot() {
  if (!configured || params.has('demo')) return startDemo();
  try {
    const { createFirebaseBackend } = await import('./backend-firebase.js?v=20261103w');
    U.backend = await createFirebaseBackend(firebaseConfig);
  } catch (e) {
    console.error(e);
    $('#app').innerHTML = `<div class="hero card"><h2>無法連線到 Firebase</h2><p class="muted">請檢查網路或 firebase-config.js 的設定。</p><p><a href="?demo">改用展示模式</a></p></div>`;
    return;
  }
  U.backend.onAuth((u) => {
    U.user = u;
    if (!u) { clearSubs(); U.view = 'login'; render(); return; }
    U.draft.name = store.get('name', '') || u.name || '';
    const code = (params.get('room') || '').toUpperCase();
    const hosted = store.get('hosted');
    if (code && hosted !== code) { openStudent(code); return; }
    U.view = 'home';
    render();
  });
}

// ================= 展示模式 =================
const DEMO_USERS = [
  { uid: 'teacher', name: '王老師', role: 'teacher' },
  { uid: 's-voc', name: '小安', team: 'voc' },
  { uid: 's-esp', name: '阿哲', team: 'esp' },
  { uid: 's-zheng', name: '佳佳', team: 'zheng' },
  { uid: 's-jpn', name: '小光', team: 'jpn' },
  { uid: 's-minnan', name: '敏敏', team: 'minnan' },
];
async function startDemo(mode) {
  U.demo = true;
  clearSubs(); U.host?.stop();
  U.D = freshData(); U.toasted = new Set(); U.tab = 'map';
  U.backend = createMemoryBackend();
  U.backend.setUser(DEMO_USERS[0]);
  U.user = DEMO_USERS[0];
  const host = await Host.create(U.backend, { mode: mode || (params.get('mode') === 'gibberish' ? 'gibberish' : 'plain'), eventOrder: RECOMMENDED_ORDER });
  U.host = host;
  host.onChange = () => { if (U.role === 'teacher') render(); };
  host.start();
  for (const du of DEMO_USERS.slice(1)) {
    await U.backend.addDoc(`rooms/${host.code}/actions`, { uid: du.uid, name: du.name, type: 'join', team: du.team, status: 'pending', ts: Date.now() });
  }
  U.code = host.code;
  setTimeout(() => switchDemo(mode ? 'teacher' : (params.get('as') || 'teacher')), 60);
}
function switchDemo(uid) {
  const du = DEMO_USERS.find((d) => d.uid === uid) || DEMO_USERS[0];
  U.backend.setUser(du);
  U.user = du;
  if (du.role === 'teacher') { clearSubs(); U.role = 'teacher'; U.view = 'teacher'; subscribeTeacher(); render(); }
  else { U.draft = { qty: {}, order: null, offer: null, chat: '', chan: 'all', basis: '', name: du.name }; openStudent(U.code); }
}
function demoBar() {
  if (!U.demo) return '';
  return `<div class="demo-bar"><b>展示模式</b><span>所有資料只存在這個分頁，重新整理就會清空。切換身分：</span>
  <select id="demoAs">${DEMO_USERS.map((d) => `<option value="${d.uid}" ${U.user?.uid === d.uid ? 'selected' : ''}>${d.role ? '港務官（老師）' : TEAMS[d.team].name + '・' + d.name}</option>`).join('')}</select>
  <span class="spacer"></span><button class="btn sm" data-act="demoRestart" data-v="plain">重新開始（明碼版）</button><button class="btn sm" data-act="demoRestart" data-v="gibberish">重新開始（亂碼版）</button></div>`;
}

// ================= 渲染排程 =================
function render() {
  const a = document.activeElement;
  const typing = a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && ['text', 'number', 'search'].includes(a.type)));
  if (typing && $('#app').contains(a)) {
    U.pendingRender = true; updateLive(); return;
  }
  U.pendingRender = false;
  const scroll = window.scrollY;
  const msgBox = $('.msgs');
  const msgAtBottom = msgBox ? msgBox.scrollHeight - msgBox.scrollTop - msgBox.clientHeight < 30 : true;
  let html = '';
  if (U.view === 'login') html = viewLogin();
  else if (U.view === 'home') html = viewHome();
  else if (U.view === 'teacherSetup') html = viewTeacherSetup();
  else if (U.view === 'teacher') html = viewTeacher();
  else if (U.view === 'student') html = viewStudent();
  else html = '<div class="boot">載入中…</div>';
  $('#app').innerHTML = demoBar() + html;
  window.scrollTo(0, scroll);
  const m = $('.msgs'); if (m && msgAtBottom) m.scrollTop = m.scrollHeight;
  updateLive();
  const fleet = U.view === 'teacher' ? U.host?.S.teams : U.view === 'student' ? U.D.teams : null;
  if (fleet) layoutChart(fleet);
}
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.chart [data-act="port"]')) { e.preventDefault(); e.target.closest('[data-act]').dispatchEvent(new MouseEvent('click', { bubbles: true })); }
});
document.addEventListener('focusout', () => setTimeout(() => { if (U.pendingRender) render(); }, 0));
setInterval(updateLive, 1000);
function updateLive() {
  const room = U.role === 'teacher' ? U.host?.S.room : U.D.room;
  for (const el of document.querySelectorAll('[data-timer]')) {
    if (!room || !room.phaseEndsAt) { el.hidden = true; continue; }
    const left = Math.round((room.phaseEndsAt - Date.now()) / 1000);
    el.hidden = false;
    el.textContent = left >= 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '時間到';
    el.classList.toggle('late', left < 0);
  }
}

// ================= 登入與首頁 =================
function viewLogin() {
  return `<div class="main"><div class="hero">
    <div class="seal-mark">${shipIcon(40)}</div>
    <h1>航海通商</h1>
    <p>十七世紀的東亞海域，讀懂情報的人，才能搶先一步。</p>
    <div class="card stack" style="text-align:left">
      <button class="btn primary block" data-act="google">使用 Google 帳號登入</button>
      ${allowGuest ? `<div class="hr"></div><label class="field"><span>學校帳號無法登入時，可以用訪客身分（換裝置後無法找回紀錄）</span>
      <input type="text" id="guestName" placeholder="座號與姓名，例如 12 王小明" maxlength="12"></label>
      <button class="btn block" data-act="guest">以訪客身分進入</button>` : ''}
    </div></div></div>`;
}
function viewHome() {
  const last = store.get('lastRoom', '');
  const hosted = store.get('hosted', '');
  return `<div class="main"><div class="hero">
    <div class="seal-mark">${shipIcon(40)}</div>
    <h1>航海通商</h1>
    <p>${esc(U.user.name)}，歡迎上船。<a href="#" data-act="logout" class="small">登出</a></p>
    <div class="choice">
      <div class="card stack">
        <h2>我是學生</h2>
        <label class="field"><span>老師給的房間代碼</span>
        <input type="text" id="joinCode" class="code-input" maxlength="4" value="${esc(params.get('room') || last)}" autocomplete="off"></label>
        <button class="btn seal block" data-act="joinRoom">加入房間</button>
      </div>
      <div class="card stack">
        <h2>我是老師</h2>
        <p class="small muted">建立房間後請保持頁面開啟，學生的操作會由老師這台裝置處理。</p>
        <button class="btn primary block" data-act="newRoom">建立新房間</button>
        ${hosted ? `<button class="btn block" data-act="resumeRoom">回到房間 ${esc(hosted)}</button>` : ''}
      </div>
    </div></div></div>`;
}
function viewTeacherSetup() {
  const order = U.draft.eventOrder || [...RECOMMENDED_ORDER];
  U.draft.eventOrder = order;
  const mode = U.draft.mode || 'plain';
  return `<div class="main"><div class="card stack" style="max-width:720px;margin:0 auto">
    <h2>建立房間</h2>
    <div><div class="small muted">情報卡文字</div>
      <div class="seg" style="margin-top:4px">
        <button data-act="mode" data-v="gibberish" class="${mode === 'gibberish' ? 'on' : ''}">亂碼版（第一輪試玩）</button>
        <button data-act="mode" data-v="plain" class="${mode === 'plain' ? 'on' : ''}">明碼版</button>
      </div></div>
    <div><div class="small muted">歷史進程（依史實固定：每回合結束時發生的大事，決定下一個時期的局勢）</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>回合</th><th>時期</th><th>回合結束時的大事</th></tr></thead><tbody>
      ${RECOMMENDED_ORDER.map((ev, i) => `<tr><td>第 ${i + 1} 回合<div class="small muted">${L.season(i + 1)}季</div></td><td>${ERAS[i + 1].years}<div class="small">${esc(ERAS[i + 1].title)}</div></td><td>${EVENTS[ev].year} ${esc(EVENTS[ev].title)}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small muted">學生不知道下一件大事是什麼，只能從情報推測；讀過這段歷史的學生會更有優勢。</p></div>
    <div class="row"><button class="btn" data-act="home">返回</button><button class="btn primary" data-act="createRoom">建立</button></div>
  </div></div>`;
}

// ================= 老師端 =================
function subscribeTeacher() {
  const code = U.host.code;
  U.D.msgs = {};
  U.subs.push(U.backend.onQuery(`rooms/${code}/messages`, null, (list) => {
    U.D.msgs = Object.fromEntries(list.map((m) => [m.id, m])); render();
  }));
}
function viewTeacher() {
  const S = U.host.S, r = S.room;
  const active = L.activeTeams(S);
  const url = `${location.origin}${location.pathname}?room=${r.code}`;
  const ev = r.round ? S.secret.eventOrder[r.round - 1] : S.secret.eventOrder[0];
  const nextBtn = r.status === 'lobby' ? `<button class="btn seal" data-act="t-start" ${active.length < 2 ? 'disabled' : ''}>開始遊戲</button>`
    : r.status === 'playing' ? `<button class="btn seal" data-act="t-next">${r.phase === 'resolve' ? (r.round >= ROUNDS ? '結束遊戲' : `進入第 ${r.round + 1} 回合`) : `下一階段：${PHASE_NAME[PHASES[PHASES.indexOf(r.phase) + 1]]}`}</button>` : '';
  const steps = PHASES.map((p, i) => {
    const cur = PHASES.indexOf(r.phase);
    return `<span class="${p === r.phase ? 'on' : (cur > i ? 'done' : '')}">${PHASE_NAME[p]}</span>`;
  }).join('');
  const offers = Object.values(U.host.offers).filter((o) => o.status === 'accepted').length;
  const msgs = Object.values(U.D.msgs).sort((a, b) => a.ts - b.ts).slice(-40);
  return `<div class="shell">
    <div class="topbar"><span class="brand">航海通商</span><span class="chip">港務官</span>
      ${r.round ? `<span class="chip">第 ${r.round}/${ROUNDS} 回合・${ERAS[r.round].years}・${seasonOf(r.round)}季</span>` : ''}
      <span class="chip phase">${PHASE_NAME[r.phase]}</span><span class="chip timer" data-timer hidden></span>
      <span class="spacer"></span>${U.demo ? '' : '<a href="#" data-act="home" class="small" style="color:inherit">離開</a>'}</div>
    <div class="main">
      <div class="hint"><b>請保持這個頁面開啟。</b>學生送出的買賣、指令與交換，都由這台裝置處理；關掉後學生的操作會停在排隊中，重新打開就會接著處理。</div>
      <div class="grid2">
        <div>
          <div class="card">
            <div class="row" style="justify-content:space-between;align-items:flex-start">
              <div><div class="small muted">房間代碼</div><div class="room-code">${r.code}</div>
              <div class="small muted">${r.mode === 'gibberish' ? '亂碼版情報' : '明碼版情報'}</div></div>
              <div class="stack" style="text-align:right">
                <button class="btn sm" data-act="copyLink" data-url="${esc(url)}">複製加入連結</button>
                ${r.status === 'ended' && !U.demo ? '<button class="btn sm" data-act="t-csv">下載航海日誌 CSV</button>' : ''}
              </div>
            </div>
            ${r.status !== 'lobby' ? `<div class="phase-steps">${steps}</div>` : ''}
            ${r.status === 'playing' ? `<p class="small" style="margin:0 0 10px">${esc(PHASE_HINT[r.phase])}</p>` : ''}
            <div class="row">${nextBtn}
              ${r.status === 'playing' ? `<span class="small muted">計時：</span>${[2, 3, 5].map((m) => `<button class="btn sm" data-act="t-timer" data-v="${m * 60}">${m} 分</button>`).join('')}<button class="btn sm ghost" data-act="t-timer" data-v="0">取消</button>` : ''}
            </div>
          </div>
          ${eraCard(r.round || 1, r.status === 'lobby')}
          ${chartCard(r, S.teams, null, { legend: false, focus: U.portSel })}
          ${r.status === 'lobby' ? viewTeacherLobby(S) : ''}
          ${r.status !== 'lobby' ? `<div class="card"><h2>各組狀況 <small>已完成 ${offers} 筆組間交換</small></h2>
            <div class="tbl-wrap"><table class="tbl"><thead><tr><th>勢力</th><th>位置</th><th>銀兩</th><th>貨艙</th><th>聲望</th><th>指令</th><th>分數</th></tr></thead><tbody>
            ${active.map((id) => { const t = S.teams[id]; return `<tr><td><span class="flag" style="display:inline-block;background:${teamColor(id)}"></span> ${esc(t.name)}<div class="small muted">${esc(Object.values(t.members).join('、'))}</div></td>
              <td>${t.sea ? `海上→${t.sea.to}` : t.port}</td><td>${t.silver}</td><td class="small">${cargoText(t.cargo)}</td><td>${t.rep}</td>
              <td>${t.order ? '<span class="ok">已送出</span>' : '<span class="no">—</span>'}</td><td><b>${L.score(t)}</b></td></tr>`; }).join('')}
            </tbody></table></div></div>` : ''}
          ${r.status !== 'lobby' ? priceBoard(r, null) : ''}
        </div>
        <div>
          ${r.status === 'playing' ? `<div class="card"><h2>本回合結束時的大事 <small>只有老師看得到</small></h2>
            <p style="margin:0"><b>${EVENTS[ev].year} 年 ${esc(EVENTS[ev].title)}</b>：${esc(EVENTS[ev].text)}</p>
            <p class="small muted">真情報在 ${EVENTS[ev].trueAt.join('、')}；謠言在 ${EVENTS[ev].rumorAt}。</p>
            ${r.round < ROUNDS ? `<p class="small muted">再下一件：${EVENTS[S.secret.eventOrder[r.round]].year} ${esc(EVENTS[S.secret.eventOrder[r.round]].title)}</p>` : ''}</div>` : ''}
          ${r.status === 'ended' ? viewRanking(S.teams, active, true) : ''}
          ${r.lastReport ? reportCard(r.lastReport) : ''}
          <div class="card"><h2>訊息監看 <small>含各組私訊</small></h2>
            <div class="msgs">${msgs.map((m) => msgHtml(m, null, true)).join('') || '<p class="muted small">還沒有訊息</p>'}</div>
            <div class="row" style="margin-top:8px"><input type="text" id="tSay" placeholder="以港務官身分廣播" maxlength="200"><button class="btn sm primary" data-act="t-say">廣播</button></div>
          </div>
        </div>
      </div>
    </div></div>`;
}
function viewTeacherLobby(S) {
  return `<div class="card"><h2>等待學生加入</h2>
    <p class="small muted">學生登入後輸入代碼，選擇勢力。每組至少 1 人，同一勢力可以多人共用一艘船。至少 2 組加入才能開始。</p>
    ${TEAM_IDS.map((id) => { const t = S.teams[id]; const m = Object.entries(t.members); return `<div class="row" style="padding:6px 0;border-bottom:1px dashed var(--line)">
      <span class="flag" style="background:${teamColor(id)}"></span><b style="min-width:8em">${esc(t.name)}</b>
      <span class="small">${m.length ? m.map(([uid, n]) => `${esc(n)} <a href="#" class="small muted" data-act="t-kick" data-v="${esc(uid)}">移除</a>`).join('、') : '<span class="muted">尚無人加入</span>'}</span></div>`; }).join('')}
  </div>`;
}

// ================= 學生端 =================
async function openStudent(code) {
  clearSubs();
  U.D = freshData();
  U.code = code;
  U.role = 'student';
  U.view = 'student';
  U.tab = U.tab || 'map';
  store.set('lastRoom', code);
  const p = `rooms/${code}`;
  const uid = U.user.uid;
  U.subs.push(U.backend.onDoc(p, (room) => {
    U.D.room = room;
    if (!room) { toast('找不到這個房間，請確認代碼', true); U.view = 'home'; clearSubs(); }
    render();
  }));
  U.subs.push(U.backend.onQuery(`${p}/teams`, null, (list) => {
    U.D.teams = Object.fromEntries(list.map((t) => [t.id, t]));
    const mine = myTeamId();
    if (mine && !U.D.joined) { U.D.joined = mine; subscribeTeam(code, mine); }
    render();
  }));
  let firstActions = true;
  U.subs.push(U.backend.onQuery(`${p}/actions`, ['uid', uid], (list) => {
    if (firstActions) { firstActions = false; for (const a of list) if (a.status !== 'pending') U.toasted.add(a.id); }
    for (const a of list) {
      U.D.actions[a.id] = a;
      if (a.status !== 'pending' && !U.toasted.has(a.id)) {
        U.toasted.add(a.id);
        if (Date.now() - (a.ts || 0) < 60000) toast(a.msg || (a.status === 'done' ? '完成' : '未成功'), a.status !== 'done');
      }
    }
    render();
  }));
  U.subs.push(U.backend.onQuery(`${p}/messages`, ['to', 'all'], (list) => { mergeMsgs(list); }));
}
function subscribeTeam(code, tid) {
  const p = `rooms/${code}`;
  U.subs.push(U.backend.onDoc(`${p}/hands/${tid}`, (h) => { U.D.hand = h; render(); }));
  U.subs.push(U.backend.onQuery(`${p}/messages`, ['to', tid], mergeMsgs));
  U.subs.push(U.backend.onQuery(`${p}/messages`, ['from', tid], mergeMsgs));
  const mergeOffers = (list) => { for (const o of list) U.D.offers[o.id] = o; render(); };
  U.subs.push(U.backend.onQuery(`${p}/offers`, ['to', tid], mergeOffers));
  U.subs.push(U.backend.onQuery(`${p}/offers`, ['from', tid], mergeOffers));
}
function mergeMsgs(list) { for (const m of list) U.D.msgs[m.id] = m; render(); }
function myTeamId() { return TEAM_IDS.find((id) => U.D.teams[id]?.members?.[U.user.uid]); }

async function send(type, payload = {}) {
  const room = U.D.room;
  if (!room) return;
  try {
    await U.backend.addDoc(`rooms/${U.code}/actions`, { uid: U.user.uid, name: U.draft.name || U.user.name || '', type, ...payload, status: 'pending', ts: Date.now() });
  } catch (e) { console.error(e); toast('送出失敗，請檢查網路', true); }
}
async function sendChat(to, text) {
  const tid = myTeamId();
  if (!text.trim() || !tid) return;
  try {
    await U.backend.addDoc(`rooms/${U.code}/messages`, { from: tid, to, text: text.trim().slice(0, 200), ts: Date.now(), uid: U.user.uid, name: U.draft.name || U.user.name || '' });
  } catch (e) { console.error(e); toast('訊息沒有送出', true); }
}

function viewStudent() {
  const { room } = U.D;
  if (!room) return `<div class="main"><div class="boot">正在找房間 ${esc(U.code)}…</div></div>`;
  const tid = myTeamId();
  const top = `<div class="topbar"><span class="brand">航海通商</span><span class="chip">房間 ${esc(room.code)}</span>
    ${room.round ? `<span class="chip">第 ${room.round}/${ROUNDS} 回合・${ERAS[room.round].years}・${seasonOf(room.round)}季</span>` : ''}
    <span class="chip phase">${PHASE_NAME[room.phase]}</span><span class="chip timer" data-timer hidden></span>
    <span class="spacer"></span>${U.demo ? '' : '<a href="#" data-act="home" class="small" style="color:inherit">離開</a>'}</div>`;
  if (!tid) return `<div class="shell">${top}<div class="main">${viewPickTeam(room)}</div></div>`;
  if (room.status === 'lobby') {
    const t = U.D.teams[tid];
    return `<div class="shell">${top}<div class="main"><div class="card stack" style="max-width:640px;margin:0 auto">
      <div class="team-banner"><span class="flag" style="background:${teamColor(tid)}"></span><h2 style="margin:0">${esc(t.name)}</h2></div>
      <p>起始港：<b>${TEAMS[tid].port}</b>。特殊能力：${esc(TEAMS[tid].ability)}</p>
      <p class="small muted">同組船員：${esc(Object.values(t.members).join('、'))}</p>
      ${eraCard(1, true)}<p>等待港務官開始遊戲⋯⋯ 可以先看看規則：</p>${rulesHtml()}
      <button class="btn sm ghost" data-act="leaveTeam">換一個勢力</button></div></div></div>`;
  }
  const tabs = [['map', '圖', '海圖'], ['market', '市', '市場'], ['intel', '報', '情報'], ['talk', '談', '談判'], ['orders', '令', '指令'], ['log', '誌', '日誌']];
  const unreadTalk = Object.values(U.D.msgs).some((m) => m.ts > U.seenMsg && m.from !== tid) || Object.values(U.D.offers).some((o) => o.status === 'open' && o.to === tid);
  const body = { map: tabMap, market: tabMarket, intel: tabIntel, talk: tabTalk, orders: tabOrders, log: tabLog }[U.tab]();
  if (U.tab === 'talk') U.seenMsg = Math.max(U.seenMsg, ...Object.values(U.D.msgs).map((m) => m.ts || 0), 0);
  return `<div class="shell">${top}<div class="main">
    ${statusStrip(tid)}
    ${room.status !== 'lobby' && room.round ? eraCard(room.round, false, true) : ''}
    ${room.status === 'playing' ? `<div class="hint"><b>${PHASE_NAME[room.phase]}階段</b>：${esc(PHASE_HINT[room.phase])}</div>` : ''}
    <nav class="tabs">${tabs.map(([k, ico, nm]) => `<button data-tab="${k}" class="${U.tab === k ? 'on' : ''}"><span class="ico">${ico}</span>${nm}${k === 'talk' && unreadTalk && U.tab !== 'talk' ? '<i class="dot"></i>' : ''}</button>`).join('')}</nav>
    ${body}
  </div></div>`;
}
function viewPickTeam(room) {
  if (room.status !== 'lobby') {
    return `<div class="card"><h2>遊戲已經開始</h2><p>這個房間已開始航行，無法再加入新的勢力。請找老師協助。</p><button class="btn" data-act="home">返回</button></div>`;
  }
  const pending = Object.values(U.D.actions).some((a) => a.type === 'join' && a.status === 'pending');
  return `<div class="card stack" style="max-width:760px;margin:0 auto">
    <h2>選擇你的勢力</h2>
    <label class="field"><span>你的顯示名稱（建議填座號與名字）</span><input type="text" id="myName" maxlength="12" value="${esc(U.draft.name)}"></label>
    <div class="teams">${TEAM_IDS.map((id) => { const t = U.D.teams[id]; const m = t ? Object.values(t.members) : []; return `<button class="team-pick" data-act="join" data-v="${id}" ${pending ? 'disabled' : ''}>
      <div class="nm"><span class="flag" style="background:${teamColor(id)}"></span>${esc(TEAMS[id].name)}</div>
      <div class="small">起始港：${TEAMS[id].port}</div><div class="small muted">${esc(TEAMS[id].ability)}</div>
      <div class="small" style="margin-top:4px">${m.length ? '船員：' + esc(m.join('、')) : '<span class="muted">還沒有人</span>'}</div></button>`; }).join('')}</div>
    ${pending ? '<p class="small muted">正在等港務官的裝置確認⋯⋯</p>' : ''}
  </div>`;
}
function statusStrip(tid) {
  const t = U.D.teams[tid];
  const n = GOODS.reduce((s, g) => s + (t.cargo[g] || 0), 0);
  return `<div class="team-banner"><span class="flag" style="background:${teamColor(tid)}"></span><h2 style="margin:0">${esc(t.name)}</h2>
      <span class="small muted">${esc(Object.values(t.members).join('、'))}</span></div>
    <div class="status">
      <div class="stat"><span>位置</span><b>${t.sea ? '海上' : t.port}</b>${t.sea ? `<span>前往${t.sea.to}，第 ${t.sea.arrive} 回合抵達</span>` : ''}</div>
      <div class="stat"><span>銀兩</span><b>${t.silver}</b></div>
      <div class="stat"><span>貨艙</span><b>${n}/${L.holdOf(tid)}</b><span>${esc(cargoText(t.cargo))}</span></div>
      <div class="stat"><span>聲望</span><b>${t.rep}</b></div>
    </div>`;
}

// ---------- 海圖 ----------
function laneClass(room, from) {
  return (a, b) => {
    if (!from || (a !== from && b !== from)) return '';
    const n = L.travelTime(from, a === from ? b : a, room.round || 1, room.flags || {});
    return n === 1 ? 'r1' : n === 2 ? 'r2' : 'rx';
  };
}
function destHints(room, t) {
  if (!t || t.sea) return null;
  const h = { [t.port]: '目前位置' };
  for (const p of PORTS) {
    if (p === t.port || !L.routeBetween(t.port, p)) continue;
    if (!L.portOpen(p, room.round)) continue;
    if (L.destBlock(t.id, p, room.round)) { h[p] = '禁止前往'; continue; }
    const n = L.travelTime(t.port, p, room.round || 1, room.flags || {});
    h[p] = n == null ? '這季逆風' : `${n} 回合${L.tradeBan(t.id, p, room.round) ? '・不能交易' : ''}`;
  }
  return h;
}
function shutPorts(round) {
  return Object.fromEntries(PORTS.filter((p) => !L.portOpen(p, round)).map((p) => [p, `${OPEN_YEAR[p]} 年開港`]));
}
function chartCard(room, teams, mine, { selectable = null, dest = null, focus = null, legend = true } = {}) {
  const me = mine && teams[mine];
  const from = me && !me.sea ? me.port : null;
  const round = room.round || 1;
  const tags = {};
  if (mine && !selectable) for (const p of PORTS) if (L.portOpen(p, round) && L.tradeBan(mine, p, round)) tags[p] = '不能交易';
  const key = Object.keys(teams).filter((id) => Object.keys(teams[id].members || {}).length).map((id) => `<span><i style="background:${teamColor(id)}"></i>${esc(TEAMS[id].name)}${id === mine ? '（我方）' : ''}</span>`).join('');
  return `<div class="card chart-card">${chartSvg({ round, teams, mine, dest, focus, selectable, shut: shutPorts(round), tags, routeClass: laneClass(room, from) })}
    <div class="fleet-key">${key}</div>
    ${legend ? `<div class="legend">${from ? '<span><i style="border-color:var(--good)"></i>1 回合到</span><span><i style="border-color:var(--warn);border-top-style:dashed"></i>2 回合到</span><span><i style="border-color:var(--muted);border-top-style:dotted"></i>這季不能航行</span>' : ''}<span class="muted">灰色港口尚未開港；點港口看詳情</span></div>` : ''}</div>`;
}
function eraCard(round, lobby = false, compact = false) {
  const e = ERAS[round];
  if (!e) return '';
  const open = PORTS.filter((p) => L.portOpen(p, round));
  const key = `era${round}`;
  const full = !compact || U.draft.eraOpen === key;
  return `<div class="era card ${full ? '' : 'clamp'}"><span class="era-years">${e.years.replace('–', '︱')}</span><div class="era-head"><h2>${lobby ? '開局時代背景：' : ''}${esc(e.title)}</h2>
    ${compact ? `<button class="btn sm ghost" data-act="eraToggle" data-v="${key}" aria-expanded="${full}">${full ? '收合' : '讀全文'}</button>` : ''}</div>
    <p class="era-intro">${esc(e.intro)}</p><p class="small muted era-open">開放的貿易港：${open.join('、')}</p></div>`;
}
function portInfo(room, teams, tid, p) {
  const t = teams[tid];
  const round = room.round || 1;
  const base = (room.base || BASE_PRICES)[p], pr = room.prices?.[p] || base;
  const isOpen = L.portOpen(p, round);
  const here = Object.values(teams).filter((x) => Object.keys(x.members || {}).length && !x.sea && x.port === p);
  const blocked = t && L.destBlock(tid, p, round);
  const n = t && !t.sea && t.port !== p && L.routeBetween(t.port, p) && !blocked ? L.travelTime(t.port, p, round, room.flags || {}) : undefined;
  const canSet = room.status === 'playing' && room.phase === 'orders' && n != null;
  const ban = isOpen && t ? L.tradeBan(tid, p, round) : null;
  const who = TEAM_IDS.filter((id) => teams[id] && Object.keys(teams[id].members || {}).length && !L.tradeBan(id, p, round));
  const sub = !isOpen ? `${OPEN_YEAR[p]} 年才開港` : t && !t.sea && t.port === p ? '你在這裡' : blocked ? esc(blocked) : n === undefined ? (t?.sea ? '船在海上' : '沒有直達航線') : n == null ? '這季逆風，無法從你的港口出航到這裡' : `從${t.port}出發 ${n} 回合`;
  return `<div class="card"><h2>${p} <small>${sub}</small></h2>
    <p class="port-note">${esc(PORT_NOTE[p])}</p>
    ${isOpen ? `${ban ? `<p class="ban-note"><b>本組不能在這裡交易</b>：${esc(ban)}。</p>` : ''}
    <div class="goods">${GOODS.map((g) => `<div class="good ${pr[g] > base[g] ? 'up' : pr[g] < base[g] ? 'down' : ''}">${goodIcon(g)}<span>${g}</span><b>${pr[g]}</b></div>`).join('')}</div>
    <p class="small muted" style="margin:8px 0 0">本時期可在此交易：${who.length ? who.map((id) => `<span class="flag" style="display:inline-block;background:${teamColor(id)}"></span> ${esc(TEAMS[id].name)}`).join('、') : '本局沒有勢力'}</p>
    <p class="small muted" style="margin:4px 0 0">停在港內：${here.length ? here.map((x) => esc(x.name)).join('、') : '沒有船'}</p>` : '<p class="small muted">這個時期還不是本遊戲的貿易港，船不能前往。</p>'}
    ${canSet ? `<button class="btn seal" style="margin-top:10px" data-act="setDest" data-v="${p}">設為下一站</button>` : ''}
  </div>`;
}
function tabMap() {
  const { room, teams } = U.D;
  const tid = myTeamId(), t = teams[tid];
  const sel = U.portSel && PORTS.includes(U.portSel) ? U.portSel : (t.sea ? t.sea.to : t.port);
  return `<div class="grid2 map-grid">${chartCard(room, teams, tid, { focus: sel })}
    <div>${portInfo(room, teams, tid, sel)}
    <div class="card"><h2>船隊動態 <small>${seasonOf(room.round)}季</small></h2><ul class="fleet">${Object.values(teams).filter((x) => Object.keys(x.members).length).map((x) => `<li><span class="flag" style="background:${teamColor(x.id)}"></span><b>${esc(x.name)}</b><span>${x.sea ? `航行中 → ${x.sea.to}（第 ${x.sea.arrive} 回合抵達）` : `停泊於${x.port}`}</span></li>`).join('')}</ul></div>
    </div></div>`;
}
function routeListHtml(room, port) {
  const rows = PORTS.filter((p) => p !== port && L.routeBetween(port, p)).map((p) => {
    const n = L.travelTime(port, p, room.round || 1, room.flags || {});
    return `<li>${p}：${n == null ? '<span class="muted">這季逆風或封鎖，無法出航</span>' : `<b>${n} 回合</b>${n === 2 ? '（中途停在海上）' : ''}`}</li>`;
  });
  const closed = room.flags?.closed;
  const warn = closed && closed.round === room.round && closed.port === port ? `<p class="small" style="color:var(--bad)">${port}本回合封港，船不能離開。</p>` : '';
  return warn + `<ul class="log">${rows.join('')}</ul>`;
}

// ---------- 市場 ----------
function priceBoard(room, myPort) {
  const pr = room.prices, base = room.base || BASE_PRICES;
  return `<div class="card"><h2>各港物價 <small>紅字高於基準、綠字低於基準</small></h2><div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>貨物</th>${PORTS.map((p) => `<th class="${p === myPort ? 'hl' : ''}">${p}${L.portOpen(p, room.round || 1) ? '' : '<div class="small muted">未開港</div>'}</th>`).join('')}</tr></thead><tbody>
    ${GOODS.map((g) => `<tr><td>${g}</td>${PORTS.map((p) => { const v = pr[p][g], b = base[p][g]; return `<td class="${p === myPort ? 'hl ' : ''}${v > b ? 'up' : v < b ? 'down' : ''}">${v}</td>`; }).join('')}</tr>`).join('')}
    </tbody></table></div></div>`;
}
function basisSelect(id) {
  const cards = U.D.hand?.cards || [];
  return `<label class="field"><span>這個決定依據哪張情報？（選填，會記進日誌）</span><select id="${id}" data-live="1">
    <option value="">不依據情報</option>${[...cards].reverse().map((c) => `<option value="${c.cid}" ${U.draft.basis === c.cid ? 'selected' : ''}>#${c.cid}（第 ${c.round} 回合・${c.port}）</option>`).join('')}</select></label>`;
}
function tabMarket() {
  const { room, teams } = U.D;
  const tid = myTeamId(), t = teams[tid];
  const canTrade = room.phase === 'trade' && !t.sea && room.status === 'playing';
  const ban = t.sea ? null : L.tradeBan(tid, t.port, room.round);
  const restricted = !!ban;
  const pr = room.prices[t.port] || {};
  const panel = t.sea ? '<p>船在海上，抵達港口後才能交易。</p>' : `
    ${restricted ? `<p class="ban-note"><b>本組不能在${t.port}交易</b>：${esc(ban)}。可以和能交易的勢力談判，請他們代買代賣。</p>` : ''}
    ${canTrade ? '' : '<p class="small muted">交易階段才能買賣，現在先看看行情。</p>'}
    ${basisSelect('basisTrade')}
    ${GOODS.map((g) => { const q = U.draft.qty[g] || 1; return `<div class="trade-row"><div class="g">${goodIcon(g)}<b>${g}</b> ${pr[g]} 兩<small>船上 ${t.cargo[g] || 0} 箱</small></div>
      <div class="stepper"><button data-act="qty" data-g="${g}" data-d="-1" aria-label="減少">−</button><span>${q}</span><button data-act="qty" data-g="${g}" data-d="1" aria-label="增加">＋</button></div>
      <div class="row"><button class="btn sm primary" data-act="buy" data-g="${g}" ${canTrade && !restricted ? '' : 'disabled'}>買</button><button class="btn sm" data-act="sell" data-g="${g}" ${canTrade && !restricted && t.cargo[g] ? '' : 'disabled'}>賣</button></div></div>`; }).join('')}
    <p class="small muted">連續買同一種貨，每箱都比前一箱貴 1 兩；連續賣則每箱便宜 1 兩。</p>`;
  return `<div class="grid2"><div class="card"><h2>${t.sea ? '交易' : t.port + '市集'} <small>船艙上限 ${L.holdOf(tid)} 箱</small></h2>${panel}</div>${priceBoard(room, t.sea ? null : t.port)}</div>`;
}

// ---------- 情報 ----------
function revealMap(room) {
  const m = {};
  for (const r of room.reports || []) Object.assign(m, r.reveal || {});
  return m;
}
function tabIntel() {
  const { room, hand } = U.D;
  const cards = [...(hand?.cards || [])].reverse();
  const rev = revealMap(room);
  const accused = Object.fromEntries((hand?.accused || []).map((a) => [a.cid, a]));
  const teamName = (id) => TEAMS[id]?.name || '';
  return `<div class="grid2"><div class="card"><h2>手上的情報 <small>${cards.length} 張</small></h2>
    ${cards.length ? cards.map((c) => {
      const r = rev[c.cid], a = accused[c.cid];
      return `<div class="intel"><div class="meta"><b>#${c.cid}</b><span>第 ${c.round} 回合・${c.port}取得</span>${c.from ? `<span>來自${esc(teamName(c.from))}</span>` : ''}
        ${r ? `<span class="badge ${r === 'rumor' ? 'rumor' : 'true'}">${r === 'rumor' ? '事後證實是謠言' : '事後證實為真'}</span>` : ''}
        ${a ? `<span class="badge acc">${a.judged ? (a.result === 'right' ? '指認正確 +1' : '指認錯誤 −1') : '已指認為謠言'}</span>` : ''}</div>
        <div class="src">來源：${esc(c.src)}</div><div class="txt">${esc(c.text)}</div>
        ${!a && !r && !c.cid.startsWith('g') && room.phase !== 'resolve' && room.status === 'playing' ? `<div class="row" style="margin-top:8px"><button class="btn sm ghost" data-act="accuse" data-v="${c.cid}">公開指認為謠言</button><span class="small muted">猜對 +1 聲望，猜錯 −1</span></div>` : ''}
      </div>`;
    }).join('') : '<p class="muted">還沒有情報。每回合的情報階段，會在所在港口抽到情報。</p>'}
    </div><div>${room.lastReport ? reportCard(room.lastReport) : '<div class="card"><h2>上回合事件</h2><p class="muted">第 1 回合結算後，這裡會顯示發生了什麼事。</p></div>'}
    <div class="card"><h2>怎麼判斷真假？</h2><ul class="small"><li>看來源：這個人有沒有可能真的知道？他有沒有理由騙人？</li><li>比對：別組拿到的情報說法一樣嗎？可以用交換或談判查證。</li><li>想時機：消息說的事，現在發生合理嗎？</li></ul></div></div></div>`;
}

// ---------- 談判 ----------
function tabTalk() {
  const { room, teams, offers } = U.D;
  const tid = myTeamId();
  const others = TEAM_IDS.filter((id) => id !== tid && teams[id] && Object.keys(teams[id].members).length);
  const chan = U.draft.chan;
  const msgs = Object.values(U.D.msgs).filter((m) => chan === 'all' ? m.to === 'all' : ((m.from === tid && m.to === chan) || (m.from === chan && m.to === tid))).sort((a, b) => a.ts - b.ts);
  const my = Object.values(offers).filter((o) => o.status === 'open').sort((a, b) => (b.ts || 0) - (a.ts || 0));
  const canOffer = ['negotiate', 'trade'].includes(room.phase) && room.status === 'playing';
  const o = U.draft.offer || (U.draft.offer = { to: others[0] || '', give: { silver: 0, cargo: {}, cards: [] }, want: { silver: 0, cargo: {} } });
  if (!others.includes(o.to)) o.to = others[0] || '';
  const cards = U.D.hand?.cards || [];
  return `<div class="grid2"><div class="card"><h2>對話</h2>
    <div class="chans"><button class="btn sm ${chan === 'all' ? 'primary' : ''}" data-act="chan" data-v="all">全體廣播</button>
      ${others.map((id) => `<button class="btn sm ${chan === id ? 'primary' : ''}" data-act="chan" data-v="${id}">私訊 ${esc(TEAMS[id].name)}</button>`).join('')}</div>
    <div class="msgs">${msgs.map((m) => msgHtml(m, tid)).join('') || '<p class="muted small">還沒有訊息。私訊只有雙方（和老師）看得到。</p>'}</div>
    <div class="row" style="margin-top:8px;flex-wrap:nowrap"><input type="text" id="chatText" maxlength="200" placeholder="${chan === 'all' ? '對所有人說⋯⋯' : '私訊' + esc(TEAMS[chan]?.name || '')}" value="${esc(U.draft.chat)}"><button class="btn primary" data-act="sendChat">送出</button></div>
  </div>
  <div><div class="card"><h2>提出交換 <small>${canOffer ? '談判或交易階段可用' : '談判階段才能提出'}</small></h2>
    ${others.length ? `<label class="field"><span>對象</span><select id="offTo">${others.map((id) => `<option value="${id}" ${o.to === id ? 'selected' : ''}>${esc(TEAMS[id].name)}</option>`).join('')}</select></label>
    <h3 style="margin-top:10px">我給</h3>${packForm('give', o.give, true, cards)}
    <h3 style="margin-top:10px">我要</h3>${packForm('want', o.want, false)}
    <p class="small muted">交換貨物時兩艘船要停在同一港；銀兩和情報隨時能交換。對方接受前，你可以撤回。</p>
    <button class="btn seal" data-act="sendOffer" ${canOffer ? '' : 'disabled'}>送出提議</button>` : '<p class="muted">目前沒有其他組。</p>'}
  </div>
  <div class="card"><h2>進行中的提議</h2>
    ${my.length ? my.map((x) => `<div class="offer"><div class="small muted">${x.from === tid ? `你向${esc(TEAMS[x.to].name)}提議` : `${esc(TEAMS[x.from].name)}向你提議`}・第 ${x.round} 回合</div>
      <div>${x.from === tid ? '你給' : '對方給'}：<b>${esc(L.packText(x.give))}</b></div><div>${x.from === tid ? '你要' : '對方要'}：<b>${esc(L.packText(x.want))}</b></div>
      <div class="row" style="margin-top:6px">${x.to === tid ? `<button class="btn sm seal" data-act="respond" data-v="${x.id}" data-ok="1">接受</button><button class="btn sm" data-act="respond" data-v="${x.id}" data-ok="0">拒絕</button>` : `<button class="btn sm" data-act="respond" data-v="${x.id}" data-ok="0">撤回</button>`}</div></div>`).join('') : '<p class="muted small">沒有進行中的提議。</p>'}
  </div></div></div>`;
}
function packForm(side, p, withCards, cards = []) {
  return `<div class="pack-grid"><label>銀兩<input type="number" min="0" max="99" data-pack="${side}" data-k="silver" value="${p.silver || 0}"></label>
    ${GOODS.map((g) => `<label>${g}<input type="number" min="0" max="4" data-pack="${side}" data-k="${g}" value="${p.cargo[g] || 0}"></label>`).join('')}</div>
    ${withCards && cards.length ? `<div class="small muted" style="margin-top:6px">附上情報：</div><div class="row">${cards.map((c) => `<label class="small"><input type="checkbox" data-packcard="${c.cid}" ${p.cards.includes(c.cid) ? 'checked' : ''}> #${c.cid}</label>`).join('')}</div>` : ''}`;
}
function msgHtml(m, tid, teacher = false) {
  const sys = m.from === 'system' || m.from === 'teacher';
  const fromName = sys ? '港務官' : (TEAMS[m.from]?.name || '');
  const toName = m.to === 'all' ? '' : ` → ${TEAMS[m.to]?.name || ''}`;
  const time = new Date(m.ts).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
  if (sys) return `<div class="msg sys">${esc(m.text)}</div>`;
  return `<div class="msg ${m.from === tid ? 'me' : ''}"><div class="who">${esc(fromName)}・${esc(m.name || '')}${teacher ? esc(toName) : ''}・${time}</div>${esc(m.text)}</div>`;
}

// ---------- 指令 ----------
function tabOrders() {
  const { room, teams, hand } = U.D;
  const tid = myTeamId(), t = teams[tid];
  const sent = hand?.order;
  if (!U.draft.order || (!U.draft.orderSynced && hand)) {
    U.draft.order = { dest: sent?.dest || U.draft.order?.dest || '', bet: sent?.bet ? { ...sent.bet } : (U.draft.order?.bet || { port: '長崎', good: '生絲', dir: 'up', amt: 0 }) };
    U.draft.orderSynced = !!hand;
  }
  const d = U.draft.order;
  const can = room.phase === 'orders' && room.status === 'playing';
  const dests = t.sea ? [] : PORTS.filter((p) => p !== t.port && L.routeBetween(t.port, p)).map((p) => ({ p, n: L.destBlock(tid, p, room.round) ? null : L.travelTime(t.port, p, room.round, room.flags || {}), why: L.destBlock(tid, p, room.round), ban: L.tradeBan(tid, p, room.round) }));
  return `${t.sea ? '' : `<div class="pick-hint small muted">在海圖上點港口，或在下方選擇下一站。</div>`}<div class="grid2 map-grid">${chartCard(room, teams, tid, { selectable: destHints(room, t), dest: d.dest || null, legend: false })}<div class="card"><h2>航向 <small>${seasonOf(room.round)}季・${t.sea ? '海上' : t.port}出發</small></h2>
    ${t.sea ? `<p>船正在海上前往${t.sea.to}，這回合不能改航向，但仍可以下注。</p>` : `<div class="dest">
      <label class="${!d.dest ? 'on' : ''}"><input type="radio" name="dest" value="" ${!d.dest ? 'checked' : ''}> 留在${t.port}</label>
      ${dests.map(({ p, n, why, ban }) => `<label class="${d.dest === p ? 'on' : ''}" ${n == null ? 'style="opacity:.5"' : ''}><input type="radio" name="dest" value="${p}" ${d.dest === p ? 'checked' : ''} ${n == null ? 'disabled' : ''}> ${p}<span class="small muted">${why ? esc(why) : n == null ? '這季逆風，無法出航' : n + ' 回合' + (ban ? '・到了也不能交易' : '')}</span></label>`).join('')}
    </div>`}
  </div></div><div class="grid2"><div class="card"><h2>預測下注 <small>猜中拿回 2 倍並 +1 聲望</small></h2>
    <p class="small muted">猜本回合結算的事件會讓哪個港口的哪種貨漲或跌。押 0 代表不下注。</p>
    <div class="row"><select id="betPort" style="width:auto">${PORTS.map((p) => `<option ${d.bet.port === p ? 'selected' : ''}>${p}</option>`).join('')}</select>
      <select id="betGood" style="width:auto">${GOODS.map((g) => `<option ${d.bet.good === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
      <div class="seg"><button data-act="betDir" data-v="up" class="${d.bet.dir === 'up' ? 'on' : ''}">漲</button><button data-act="betDir" data-v="down" class="${d.bet.dir === 'down' ? 'on' : ''}">跌</button></div></div>
    <div class="row" style="margin-top:8px"><span>押</span><div class="seg">${[0, 1, 2, 3].map((n) => `<button data-act="betAmt" data-v="${n}" class="${d.bet.amt === n ? 'on' : ''}">${n}</button>`).join('')}</div><span>銀兩</span></div>
    <div style="margin-top:10px">${basisSelect('basisOrder')}</div>
    <button class="btn seal block" style="margin-top:12px" data-act="sendOrder" ${can ? '' : 'disabled'}>${sent ? '更新指令' : '送出指令'}</button>
    ${sent ? `<p class="small ok" style="margin-top:8px">已送出：${sent.dest ? '前往' + sent.dest : '留在港口'}${sent.bet ? `；押 ${sent.bet.amt} 賭${sent.bet.port}${sent.bet.good}${sent.bet.dir === 'up' ? '漲' : '跌'}` : ''}</p>` : ''}
    ${can ? '' : '<p class="small muted">指令階段才能送出。</p>'}
  </div></div>`;
}

// ---------- 日誌與排名 ----------
function reportCard(rep) {
  return `<div class="card"><h2>第 ${rep.round} 回合結算</h2><div class="report"><h3>${esc(rep.title)}</h3><p>${esc(rep.text)}</p></div>
    ${rep.lines.slice(1).map((l) => `<p class="small" style="margin:4px 0">・${esc(l)}</p>`).join('')}</div>`;
}
function viewRanking(teams, ids, teacher) {
  const list = ids.map((id) => ({ id, t: teams[id], s: L.score(teams[id]) })).sort((a, b) => b.s - a.s || b.t.rep - a.t.rep);
  return `<div class="card"><h2>終局排名 <small>銀兩 + 貨箱 + 聲望×2</small></h2><ol class="rank">${list.map((x) => `<li><span class="n">${esc(x.t.name)}</span><b>${x.s} 分</b></li>`).join('')}</ol>
    ${teacher ? `<div class="hr"></div><h3>航海檢討</h3>${list.map((x) => `<p class="small"><b>${esc(x.t.name)}</b>：${esc(x.t.review || '（尚未填寫）')}</p>`).join('')}` : ''}</div>`;
}
function tabLog() {
  const { room, teams, hand } = U.D;
  const tid = myTeamId(), t = teams[tid];
  const log = [...(hand?.log || [])].reverse();
  const ended = room.status === 'ended';
  const active = Object.keys(teams).filter((id) => Object.keys(teams[id].members).length);
  return `<div class="grid2"><div>${ended ? viewRanking(teams, active) + `<div class="card"><h2>航海檢討</h2>
      <p>我們賺（或虧）最多的一次，是因為⋯⋯</p><textarea id="review" maxlength="120">${esc(t.review || '')}</textarea>
      <button class="btn seal" style="margin-top:8px" data-act="sendReview">送出</button></div>` : ''}
    <div class="card"><h2>航海日誌</h2><ul class="log">${log.map((e) => `<li><span class="muted small">第 ${e.round} 回合・${PHASE_NAME[e.phase] || ''}</span> ${esc(e.text)}${e.basis ? ` <span class="badge acc">依據 #${esc(e.basis)}</span>` : ''}</li>`).join('') || '<li class="muted">還沒有紀錄</li>'}</ul></div></div>
    <div>${[...(room.reports || [])].reverse().map(reportCard).join('') || '<div class="card"><h2>歷次事件</h2><p class="muted">還沒有事件發生。</p></div>'}
    <div class="card"><h2>規則速查</h2>${rulesHtml()}</div></div></div>`;
}
function rulesHtml() {
  return `<ul class="small">
    <li>每回合五個階段：情報 → 談判 → 交易 → 指令 → 事件與結算，共 ${ROUNDS} 回合。</li>
    <li>單數回合是冬季（東北季風，往南順風），雙數回合是夏季（西南季風，往北順風）。</li>
    <li>南北航線順風 1 回合、逆風 2 回合；月港往長崎或馬尼拉是長程，順風 2 回合，逆風不能出航。月港—澎湖—大員不受風向影響。</li>
    <li>買 1 箱漲 1 兩、賣 1 箱跌 1 兩；每回合結算時物價往原本價格回 1 格。船艙最多 ${HOLD} 箱（李旦・鄭芝龍集團 ${HOLD + 1} 箱）。</li>
    <li>港口依史實逐步開放：月港、長崎、馬尼拉一開始就能去；澎湖 1622、大員 1624、雞籠 1626 年才開港。</li>
    <li>各國有禁令與敵對關係：外國船不得在月港交易、荷蘭船不能進西班牙的港口（反之亦然）、1624 年起日本禁止西班牙船⋯⋯在海圖上點港口可以看到誰能交易。</li>
    <li>情報可能是真的，也可能是謠言。公開指認謠言，猜對 +1 聲望、猜錯 −1。</li>
    <li>每回合結束時會發生一件真實的歷史大事，影響物價、開港和禁令；情報就是關於這件大事的消息。</li>
    <li>終局分數：銀兩 + 每箱貨 1 分 + 聲望 × 2。</li></ul>`;
}
function shipIcon(s) {
  return `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><path d="M7 20h18l-3.5 5h-11z" fill="#f4e9d3"/><path d="M16 5v14" stroke="#f4e9d3" stroke-width="1.6"/><path d="M16.8 6.5l7 11h-7z" fill="#f4e9d3"/><path d="M15.2 9l-5 8.5h5z" fill="#f4e9d3" opacity=".7"/></svg>`;
}

const GOOD_ICON = {
  生絲: '<ellipse cx="12" cy="13" rx="7.5" ry="5.5" fill="#f3ead2" stroke="#b9a274"/><path d="M5 12q7 -4 14 1M5.5 15q7 -4 13 0M8 9q5 4 9 9" fill="none" stroke="#c8b07e" stroke-width="1"/>',
  瓷器: '<path d="M9 4h6l-1 3q5 3 4 9q-1 4 -6 4q-5 0 -6 -4q-1 -6 4 -9z" fill="#f7f9fc" stroke="#3b5ba5"/><path d="M8 13q4 -3 8 0M8.5 16q3.5 2 7 0" fill="none" stroke="#3b5ba5" stroke-width="1.1"/>',
  鹿皮: '<path d="M6 5q6 2 12 0l1 4q-2 3 0 6l-2 5q-5 -2 -10 0l-2 -5q2 -3 0 -6z" fill="#b8814a" stroke="#7a4f24"/><circle cx="10" cy="10" r=".9" fill="#f1dcc0"/><circle cx="14" cy="13" r=".9" fill="#f1dcc0"/><circle cx="11" cy="15" r=".8" fill="#f1dcc0"/>',
  蔗糖: '<path d="M7 8q5 -4 10 0l1 11h-12z" fill="#e9d9b6" stroke="#9b7a44"/><path d="M8 8q4 2 8 0" fill="none" stroke="#9b7a44"/><path d="M9 13h6M9 16h6" stroke="#c7a76a" stroke-width="1"/>',
  白銀: '<path d="M4 15l3 -6h10l3 6q-8 3 -16 0z" fill="#d6dbe1" stroke="#7b8794"/><ellipse cx="12" cy="9.5" rx="4.5" ry="1.4" fill="#eef1f4" stroke="#7b8794" stroke-width=".8"/>',
  胡椒: '<path d="M5 17q7 -12 14 0z" fill="#b45309" stroke="#7c2d12"/><circle cx="9" cy="8" r="1.6" fill="#7c2d12"/><circle cx="13" cy="6.5" r="1.4" fill="#9a3412"/><circle cx="15.5" cy="9.5" r="1.3" fill="#7c2d12"/>',
};
function goodIcon(g) { return `<svg class="gico" viewBox="0 0 24 24" aria-hidden="true">${GOOD_ICON[g] || ''}</svg>`; }

// ================= 事件處理 =================
document.addEventListener('click', async (e) => {
  const tabBtn = e.target.closest('[data-tab]');
  if (tabBtn) { U.tab = tabBtn.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, v = el.dataset.v;
  if (el.tagName === 'A') e.preventDefault();
  try {
    switch (act) {
      case 'demoRestart': if (await ask(`重新開始一局${v === 'gibberish' ? '亂碼版' : '明碼版'}？目前的進度會清空。`, '重新開始')) await startDemo(v); break;
      case 'google': await U.backend.signInGoogle(); break;
      case 'guest': {
        const name = ($('#guestName')?.value || '').trim();
        if (!name) return toast('請先填寫名字', true);
        store.set('name', name);
        await U.backend.signInGuest(name);
        break;
      }
      case 'logout': await U.backend.signOut(); break;
      case 'home': clearSubs(); U.host?.stop(); U.host = null; U.role = null; U.view = 'home'; render(); break;
      case 'joinRoom': {
        const code = ($('#joinCode')?.value || '').trim().toUpperCase();
        if (code.length !== 4) return toast('房間代碼是 4 個英文字母', true);
        openStudent(code); break;
      }
      case 'newRoom': U.view = 'teacherSetup'; render(); break;
      case 'mode': U.draft.mode = v; render(); break;
      case 'createRoom': {
        el.disabled = true;
        U.host = await Host.create(U.backend, { mode: U.draft.mode || 'plain', eventOrder: RECOMMENDED_ORDER });
        startTeacher();
        break;
      }
      case 'resumeRoom': {
        const h = await Host.resume(U.backend, store.get('hosted'));
        if (!h || h.S.room.teacherUid !== U.user.uid) return toast('找不到你建立的房間', true);
        U.host = h; startTeacher(); break;
      }
      case 'copyLink': {
        try { await navigator.clipboard.writeText(el.dataset.url); toast('已複製加入連結'); } catch { toast(el.dataset.url); }
        break;
      }
      case 't-start': { const r = await U.host.command('start'); toast(r.msg, !r.ok); break; }
      case 't-next': {
        if (U.host.S.room.phase === 'orders') {
          const missing = L.activeTeams(U.host.S).filter((id) => !U.host.S.teams[id].order && !U.host.S.teams[id].sea);
          if (missing.length && !await ask(`還有 ${missing.map((id) => TEAMS[id].name).join('、')} 沒送出指令，確定進入結算？（沒送的船會留在原港）`)) return;
        }
        const r = await U.host.command('advance'); if (!r.ok) toast(r.msg, true); break;
      }
      case 't-timer': await U.host.command('timer', Number(v)); break;
      case 't-kick': if (await ask('確定把這位學生移出勢力？')) await U.host.command('kick', v); break;
      case 't-say': { const tx = $('#tSay').value.trim(); if (tx) { await U.host.say(tx); $('#tSay').value = ''; } break; }
      case 't-csv': {
        const blob = new Blob([U.host.exportCsv()], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `航海日誌_${U.host.code}.csv`; a.click();
        break;
      }
      case 'join': {
        const name = ($('#myName')?.value || '').trim();
        if (!name) return toast('請先填寫顯示名稱', true);
        U.draft.name = name; store.set('name', name);
        await send('join', { team: v });
        break;
      }
      case 'leaveTeam': await send('leave'); break;
      case 'qty': { const g = el.dataset.g; U.draft.qty[g] = Math.max(1, Math.min(4, (U.draft.qty[g] || 1) + Number(el.dataset.d))); render(); break; }
      case 'buy': case 'sell': await send(act, { good: el.dataset.g, qty: U.draft.qty[el.dataset.g] || 1, basis: $('#basisTrade')?.value || null }); break;
      case 'accuse': if (await ask(`確定公開指認 #${v} 是謠言？全體都會看到。`)) await send('accuse', { cid: v }); break;
      case 'chan': U.draft.chan = v; render(); break;
      case 'sendChat': { const tx = $('#chatText').value; U.draft.chat = ''; await sendChat(U.draft.chan, tx); break; }
      case 'sendOffer': {
        const o = U.draft.offer;
        o.to = $('#offTo').value;
        await send('offer', { to: o.to, give: o.give, want: o.want });
        U.draft.offer = null; render(); break;
      }
      case 'respond': await send('respond', { offerId: v, accept: el.dataset.ok === '1' }); break;
      case 'betDir': U.draft.order.bet.dir = v; render(); break;
      case 'betAmt': U.draft.order.bet.amt = Number(v); render(); break;
      case 'sendOrder': {
        const d = U.draft.order;
        d.bet.port = $('#betPort').value; d.bet.good = $('#betGood').value;
        await send('order', { dest: d.dest || null, bet: d.bet.amt > 0 ? d.bet : null, basis: $('#basisOrder')?.value || null });
        break;
      }
      case 'port': {
        if (U.view === 'student' && U.tab === 'orders') {
          const t = U.D.teams[myTeamId()], room = U.D.room;
          if (!U.draft.order) tabOrders();
          if (!t || t.sea) return toast('船在海上，不能改航向', true);
          if (v === t.port) { U.draft.order.dest = ''; render(); return; }
          if (!L.routeBetween(t.port, v)) return toast(`${t.port}沒有直達${v}的航線`, true);
          { const why = L.destBlock(myTeamId(), v, room.round); if (why) return toast(why, true); }
          if (L.travelTime(t.port, v, room.round, room.flags || {}) == null) return toast(`這個季節無法從${t.port}前往${v}`, true);
          U.draft.order.dest = v; render(); return;
        }
        U.portSel = v; if (U.view === 'student' && U.tab !== 'map') U.tab = 'map'; render(); break;
      }
      case 'setDest': {
        U.tab = 'orders';
        if (!U.draft.order) tabOrders();
        U.draft.order.dest = v; render(); window.scrollTo(0, 0); break;
      }
      case 'eraToggle': U.draft.eraOpen = U.draft.eraOpen === v ? '' : v; render(); break;
      case 'sendReview': await send('review', { text: $('#review').value }); break;
      default: break;
    }
  } catch (err) {
    console.error(err);
    toast(err?.code === 'permission-denied' ? '沒有權限，請確認房間代碼或重新登入' : '發生錯誤：' + (err?.message || err), true);
  }
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'demoAs') return switchDemo(el.value);
  if (el.dataset.ev != null) { U.draft.eventOrder[Number(el.dataset.ev)] = Number(el.value); render(); return; }
  if (el.name === 'dest') { U.draft.order.dest = el.value; render(); return; }
  if (el.id === 'basisTrade' || el.id === 'basisOrder') { U.draft.basis = el.value; return; }
  if (el.id === 'offTo') { U.draft.offer.to = el.value; return; }
  if (el.dataset.pack) {
    const p = U.draft.offer[el.dataset.pack], k = el.dataset.k, n = Math.max(0, Math.floor(Number(el.value) || 0));
    if (k === 'silver') p.silver = n; else p.cargo[k] = n;
    return;
  }
  if (el.dataset.packcard) {
    const c = U.draft.offer.give.cards, cid = el.dataset.packcard;
    if (el.checked) { if (!c.includes(cid)) c.push(cid); } else U.draft.offer.give.cards = c.filter((x) => x !== cid);
  }
});
document.addEventListener('input', (e) => { if (e.target.id === 'chatText') U.draft.chat = e.target.value; });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'chatText' && !e.isComposing) { e.preventDefault(); $('[data-act="sendChat"]')?.click(); }
  if (e.key === 'Enter' && e.target.id === 'joinCode' && !e.isComposing) $('[data-act="joinRoom"]')?.click();
});

function startTeacher() {
  clearSubs();
  store.set('hosted', U.host.code);
  U.role = 'teacher';
  U.view = 'teacher';
  U.host.onChange = () => render();
  U.host.start();
  subscribeTeacher();
  render();
}

boot();
