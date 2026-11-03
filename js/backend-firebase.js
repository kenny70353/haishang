// Firebase 版資料層（Firestore + Google 登入）
const V = '10.12.2';
const base = `https://www.gstatic.com/firebasejs/${V}`;

export async function createFirebaseBackend(config) {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = initializeApp(config);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  const ref = (path) => F.doc(db, path);
  const col = (path) => F.collection(db, path);
  const strip = (o) => JSON.parse(JSON.stringify(o));

  const backend = {
    kind: 'firebase',
    user: null,
    async signInGoogle() {
      const provider = new A.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try { await A.signInWithPopup(auth, provider); }
      catch (e) {
        if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) await A.signInWithRedirect(auth, provider);
        else throw e;
      }
    },
    async signInGuest(name) {
      const cred = await A.signInAnonymously(auth);
      await A.updateProfile(cred.user, { displayName: name });
      backend.user = { uid: cred.user.uid, name, guest: true };
      return backend.user;
    },
    async signOut() { await A.signOut(auth); },
    onAuth(cb) {
      return A.onAuthStateChanged(auth, (u) => {
        backend.user = u ? { uid: u.uid, name: u.displayName || '船員', email: u.email || '', guest: u.isAnonymous } : null;
        cb(backend.user);
      });
    },
    now: () => Date.now(),
    async getDoc(path) { const s = await F.getDoc(ref(path)); return s.exists() ? s.data() : null; },
    async setDoc(path, data) { await F.setDoc(ref(path), strip(data)); },
    async updateDoc(path, patch) { await F.updateDoc(ref(path), strip(patch)); },
    async addDoc(path, data) { const r = await F.addDoc(col(path), strip(data)); return r.id; },
    async batch(writes) {
      for (let i = 0; i < writes.length; i += 400) {
        const b = F.writeBatch(db);
        for (const w of writes.slice(i, i + 400)) b.set(ref(w.path), strip(w.data));
        await b.commit();
      }
    },
    async listDocs(path) {
      const s = await F.getDocs(col(path));
      return s.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    onDoc(path, cb, onErr) {
      return F.onSnapshot(ref(path), (s) => cb(s.exists() ? s.data() : null), (e) => { console.error(path, e); onErr && onErr(e); });
    },
    onQuery(path, where, cb, onErr) {
      const q = where ? F.query(col(path), F.where(where[0], '==', where[1])) : col(path);
      return F.onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => { console.error(path, e); onErr && onErr(e); });
    },
  };
  return backend;
}
