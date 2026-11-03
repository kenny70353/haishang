// Firebase 專案 haishang-game 的網頁設定（這些值本來就會公開在網頁原始碼中，安全由 firestore.rules 把關）
// 若要換成別的 Firebase 專案，把下面六個值換掉即可；全部清空則網站會進入展示模式
export const firebaseConfig = {
  apiKey: 'AIzaSyDU8n1vjyl620ZDxE0eCSInmbtNQIwFZLQ',
  authDomain: 'haishang-game.firebaseapp.com',
  projectId: 'haishang-game',
  storageBucket: 'haishang-game.firebasestorage.app',
  messagingSenderId: '28882969033',
  appId: '1:28882969033:web:ad861dcedb33e43d820818',
};

// 是否顯示「訪客登入」按鈕（學校 Google 帳號無法登入時的備案）
export const allowGuest = true;
