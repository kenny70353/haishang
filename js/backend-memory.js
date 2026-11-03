// 記憶體版資料層：展示模式與測試用，介面與 backend-firebase.js 相同
export function createMemoryBackend() {
  const store = new Map(); // path -> data
  const docSubs = new Map(); // path -> Set(cb)
  const querySubs = new Set(); // {col, where, cb}
  let counter = 0;
  const backend = {
    kind: 'memory',
    user: null,
    async signInGoogle() { return backend.user; },
    async signInGuest(name) { backend.user = { uid: 'guest-' + (++counter), name }; return backend.user; },
    async signOut() { backend.user = null; },
    onAuth(cb) { cb(backend.user); return () => {}; },
    setUser(u) { backend.user = u; },
    now: () => Date.now(),
    async getDoc(path) { const d = store.get(path); return d ? clone(d) : null; },
    async setDoc(path, data) { write(path, data); },
    async updateDoc(path, patch) { write(path, { ...(store.get(path) || {}), ...patch }); },
    async addDoc(col, data) { const id = 'm' + (++counter).toString(36) + Math.random().toString(36).slice(2, 6); write(`${col}/${id}`, data); return id; },
    async batch(writes) { for (const w of writes) write(w.path, w.data, true); flush(); },
    async listDocs(col) { return list(col, null); },
    onDoc(path, cb) {
      if (!docSubs.has(path)) docSubs.set(path, new Set());
      docSubs.get(path).add(cb);
      queueMicrotask(() => cb(store.has(path) ? clone(store.get(path)) : null));
      return () => docSubs.get(path).delete(cb);
    },
    onQuery(col, where, cb) {
      const sub = { col, where, cb };
      querySubs.add(sub);
      queueMicrotask(() => cb(list(col, where)));
      return () => querySubs.delete(sub);
    },
  };
  const dirty = new Set();
  function write(path, data, defer) {
    store.set(path, clone(data));
    dirty.add(path);
    if (!defer) flush();
  }
  let scheduled = false;
  function flush() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const paths = [...dirty]; dirty.clear();
      for (const p of paths) for (const cb of docSubs.get(p) || []) cb(clone(store.get(p)));
      const cols = new Set(paths.map((p) => p.slice(0, p.lastIndexOf('/'))));
      for (const s of querySubs) if (cols.has(s.col)) s.cb(list(s.col, s.where));
    });
  }
  function list(col, where) {
    const out = [];
    for (const [p, d] of store) {
      const i = p.lastIndexOf('/');
      if (p.slice(0, i) !== col) continue;
      if (where && d[where[0]] !== where[1]) continue;
      out.push({ id: p.slice(i + 1), ...clone(d) });
    }
    return out;
  }
  return backend;
}
const clone = (o) => JSON.parse(JSON.stringify(o));
