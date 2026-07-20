// 紡 -tsumugi- service worker
// Stage 1: 登録だけの最小構成。キャッシュはしない(常にネットワーク)。
// Stage 3 でプッシュ通知のリスナーをここに足す予定。
const VERSION = 'tsumugi-sw-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// fetchハンドラは置くが何もしない = ブラウザの通常ネットワーク処理に任せる
self.addEventListener('fetch', () => {});
