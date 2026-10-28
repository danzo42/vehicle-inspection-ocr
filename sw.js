/* =============================================================================
 * sw.js  ―― Service Worker（オフライン対応）
 * -----------------------------------------------------------------------------
 * 電波の届かない現場でもアプリが開き、文字読み取り（OCR）も使えるよう、
 * 画面・プログラム・OCRの文字データを端末に保存しておきます。
 *
 * ★アプリを更新したら、下の CACHE_VERSION の数字を1つ上げてください。
 *   これで利用者の端末に新しいファイルが配られます。
 * ========================================================================== */

const CACHE_PREFIX  = 'vis-ocr-';
const CACHE_VERSION = CACHE_PREFIX + 'v9';

/** オフラインでも必ず動くよう、先に取っておくファイル */
const PRECACHE = [
  './',
  'index.html',
  'vehicle.html',
  'inspect.html',
  'view.html',
  'settings.html',
  'manifest.webmanifest',
  'css/style.css',
  'config/app-config.js',
  'data/inspection-items.json',
  'assets/ydec-logo.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/icon-maskable-512.png',
  'icons/favicon-32.png',
  'src/common/install.js',
  'src/common/util.js',
  'src/storage/StorageAdapter.js',
  'src/storage/LocalStorageAdapter.js',
  'src/storage/storageFactory.js',
  'src/qr/scanner.js',
  'src/qr/shakenshoQr.js',
  'src/pages/qr-check.js',
  'qr-check.html',
  'vendor/jsQR.js',
  'src/form/formRenderer.js',
  'src/pdf/pdfGenerator.js',
  'src/ocr/ocrParser.js',
  'src/ocr/ocrEngine.js',
  'src/ocr/ocrCapture.js',
  'src/pages/common-list.js',
  'src/pages/index.js',
  'src/pages/vehicle.js',
  'src/pages/inspect.js',
  'src/pages/view.js',
  'src/pages/settings.js',
  'vendor/html5-qrcode.min.js',
  'vendor/jspdf.umd.min.js',
  // OCR（Tesseract.js）。最近のスマホは simd 版を使う。古い端末用の版は使ったときに保存する
  'vendor/tesseract/tesseract.min.js',
  'vendor/tesseract/worker.min.js',
  'vendor/tesseract/core/tesseract-core-simd-lstm.wasm.js',
  'vendor/tesseract/lang/jpn.traineddata.gz',
  'vendor/tesseract/lang/eng.traineddata.gz'
];

/** 中身が変わらない大きなファイル（毎回の更新確認をしない） */
const IMMUTABLE = /\/vendor\//;

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      // 1つでも失敗すると全部失敗するのを避けるため、個別に入れる
      .then(cache => Promise.all(PRECACHE.map(url =>
        cache.add(url).catch(e => console.warn('キャッシュできませんでした:', url, e))
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      // このアプリの古い版だけを消す（同じサイトの別アプリのキャッシュには触らない）
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_VERSION)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // ?id=DC4-0012 のような付加情報は無視してキャッシュを探す（同じ画面として扱う）
  const key = url.origin + url.pathname;

  if (IMMUTABLE.test(url.pathname)) {
    // ライブラリ・OCRデータ：キャッシュにあればそれを使う
    event.respondWith(
      caches.match(key).then(cached => cached || fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(key, copy));
        }
        return res;
      }))
    );
    return;
  }

  // 画面・プログラム：キャッシュ優先＋裏で更新（オフラインでもすぐ開き、次回起動で新しくなる）
  event.respondWith(
    caches.match(key).then(cached => {
      const network = fetch(req).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(key, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});