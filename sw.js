/* おしめぐ Service Worker
   目的は2つだけ。
     1. オフラインでも確実に起動すること（NFR-05）
     2. ホーム画面に追加できる状態を成立させること（NFR-06/07）
   記録データはIndexedDBにあり、ここでは一切さわらない。 */

const VERSION = "oshimegu-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./brand/app-icon-192.png",
  "./brand/app-icon-512.png",
  "./brand/app-icon-180.png",
  "./brand/maskable-icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // 1つ失敗しても導入自体は止めない（アイコン欠けで動かなくなるのを避ける）
    await Promise.all(ASSETS.map(u =>
      cache.add(new Request(u, { cache: "reload" })).catch(() => {})
    ));
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      await self.registration.navigationPreload.enable().catch(() => {});
    }
    await self.clients.claim();
  })());
});

/** 更新を待たずに新しい版へ切り替える（利用者が「更新する」を押したとき） */
self.addEventListener("message", e => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 画面遷移：まずネットワーク、だめならキャッシュ（オフラインでも必ず開く）
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const preload = await e.preloadResponse;
        if (preload) { putInCache(req, preload.clone()); return preload; }
        const fresh = await fetch(req);
        putInCache(req, fresh.clone());
        return fresh;
      } catch (_) {
        return (await caches.match(req)) ||
               (await caches.match("./index.html")) ||
               (await caches.match("./")) ||
               new Response("オフラインです", {
                 status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" }
               });
      }
    })());
    return;
  }

  // それ以外：キャッシュ優先。裏で静かに更新しておく
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) {
      fetch(req).then(r => { if (r && r.ok) putInCache(req, r.clone()); }).catch(() => {});
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) putInCache(req, res.clone());
      return res;
    } catch (_) {
      return new Response("", { status: 504 });
    }
  })());
});

function putInCache(req, res) {
  caches.open(VERSION).then(c => c.put(req, res)).catch(() => {});
}
