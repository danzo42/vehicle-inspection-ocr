/* =============================================================================
 * ocrEngine.js  ―― 文字認識（OCR）の実行
 * -----------------------------------------------------------------------------
 * Tesseract.js（オープンソースのOCR）を、スマホのブラウザの中だけで動かします。
 *   ・プログラム本体と文字データ（日本語・英数字）はアプリに同梱
 *     → 撮影した画像を外部のサーバーへ送ることは一切ありません
 *   ・初回だけ読み込みに数秒かかります。2回目以降は端末に保存したものを使います
 *
 * 読み取りの流れ
 *   1) 撮影した画像を見やすく加工（白黒にする・コントラストを上げる・必要なら白黒反転）
 *   2) Tesseract で文字にする
 *   3) ocrParser.js で「登録番号」「車台番号」の形を探す
 *   4) うまく見つからなければ、設定を変えてもう一度（最大3回）
 *   車台番号は読み方を変えて2回以上読み、結果が一致したときだけ「読み取れた」とします
 *   （1文字の読み間違いを見逃さないため）。
 * ========================================================================== */

(function (global) {
  'use strict';

  const VIS = global.VIS;

  let worker = null;          // Tesseract のワーカー（1つを使い回す）
  let workerLang = null;      // いま読み込んでいる言語（'jpn' / 'eng'）
  let queue = Promise.resolve();   // 同時に2つ動かさないための順番待ち
  let progressCb = null;

  const STATUS_JA = {
    'loading tesseract core':           'OCRエンジンを読み込み中',
    'initializing tesseract':           'OCRエンジンを起動中',
    'initialized tesseract':            'OCRエンジンを起動中',
    'loading language traineddata':     '文字データを読み込み中',
    'loading language traineddata (from cache)': '文字データを読み込み中',
    'loaded language traineddata':      '文字データを読み込み中',
    'initializing api':                 '準備中',
    'initialized api':                  '準備中',
    'recognizing text':                 '読み取り中'
  };

  /** 相対パスを絶対URLにする（ワーカーの中では相対パスの基準が変わるため） */
  function abs(p) { return new URL(p, location.href).href; }

  function report(msg, p) { if (progressCb) progressCb(msg, p); }

  /** 指定した言語のワーカーを用意する */
  async function getWorker(lang) {
    if (!global.Tesseract) throw new Error('OCRエンジンが読み込まれていません');
    const cfg = VIS.config.ocr;
    if (!worker) {
      report('OCRエンジンを準備中', 0);
      worker = await global.Tesseract.createWorker(lang, 1 /* LSTMのみ */, {
        workerPath: abs(cfg.workerPath),
        corePath:   abs(cfg.corePath),
        langPath:   abs(cfg.langPath),
        // ワーカーは同じサイトのファイルから直接起動する（外部CDNは使わない）
        workerBlobURL: false,
        // 文字データの保存名（他のアプリと混ざらないように）
        cachePath: 'vis-ocr',
        logger: m => report(STATUS_JA[m.status] || m.status, m.progress),
        errorHandler: e => console.warn('OCR:', e)
      });
      workerLang = lang;
    } else if (workerLang !== lang) {
      report('文字データを切り替え中', 0);
      await worker.reinitialize(lang, 1);
      workerLang = lang;
    }
    return worker;
  }

  /** 順番待ちをしてから fn を実行する */
  function enqueue(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  // ---------------------------------------------------------------------------
  //  画像の前処理
  // ---------------------------------------------------------------------------

  /**
   * OCRしやすい画像に加工する。
   *   ・幅を width px 前後にそろえる（小さすぎても大きすぎても精度が落ちる）
   *   ・白黒（グレー）にして、コントラストを最大まで広げる
   *   ・背景の方が暗ければ白黒反転（緑地に白文字の事業用ナンバーなど）
   *   ・binarize: true なら完全な白と黒の2色にする
   *   ・clearBorder: true なら、画像の縁につながる暗い部分（車体・枠線）を消す
   */
  function preprocess(src, opt) {
    opt = opt || {};
    const sw = src.width, sh = src.height;
    const scale = Math.max(0.25, Math.min(3, (opt.width || 1400) / sw));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));

    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);

    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const n = w * h;
    const gray = new Uint8ClampedArray(n);
    const hist = new Uint32Array(256);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const g = (d[p] * 299 + d[p + 1] * 587 + d[p + 2] * 114) / 1000 | 0;
      gray[i] = g;
      hist[g]++;
    }

    // 明るさの下位1%〜上位1%を 0〜255 に引き伸ばす
    const cut = n * 0.01;
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > cut) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > cut) { hi = v; break; } }
    if (hi - lo < 10) { lo = 0; hi = 255; }
    const span = hi - lo;

    // 大津の方法で「文字」と「背景」の境目を決める
    const t = otsu(hist, n);
    let dark = 0;
    for (let v = 0; v <= t; v++) dark += hist[v];
    // 暗い部分の方が多い ＝ 背景が暗い → 反転して「白地に黒文字」にする
    const invert = opt.invert != null ? opt.invert : dark > n * 0.55;
    const tt = (t - lo) * 255 / span;

    const out = new Uint8ClampedArray(n);
    for (let i = 0; i < n; i++) {
      let v = (gray[i] - lo) * 255 / span;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      if (opt.binarize) v = v > tt ? 255 : 0;
      if (invert) v = 255 - v;
      out[i] = v;
    }

    // 画像の縁につながっている暗い部分（車体・プレートや欄の枠線・影）を白で塗りつぶす。
    // 文字は枠の内側にあるので消えず、OCRが枠線や車体を文字と間違えにくくなる。
    if (opt.clearBorder) clearBorder(out, w, h, invert ? 255 - tt : tt);

    for (let i = 0, p = 0; i < n; i++, p += 4) {
      d[p] = d[p + 1] = d[p + 2] = out[i];
      d[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** 縁から続く暗い画素（しきい値未満）をたどって白にする */
  function clearBorder(px, w, h, threshold) {
    const seen = new Uint8Array(w * h);
    const stack = [];
    const push = i => { if (!seen[i] && px[i] < threshold) { seen[i] = 1; stack.push(i); } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (stack.length) {
      const i = stack.pop();
      px[i] = 255;
      const x = i % w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i < (h - 1) * w) push(i + w);
    }
  }

  function otsu(hist, total) {
    let sum = 0;
    for (let v = 0; v < 256; v++) sum += v * hist[v];
    let sumB = 0, wB = 0, best = 0, th = 127;
    for (let v = 0; v < 256; v++) {
      wB += hist[v];
      if (!wB) continue;
      const wF = total - wB;
      if (!wF) break;
      sumB += v * hist[v];
      const mB = sumB / wB, mF = (sum - sumB) / wF;
      const between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; th = v; }
    }
    return th;
  }

  // ---------------------------------------------------------------------------
  //  読み取り
  // ---------------------------------------------------------------------------

  /** canvas の一部を切り出す */
  function crop(src, x, y, w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, w); c.height = Math.max(1, h);
    c.getContext('2d').drawImage(src, x, y, w, h, 0, 0, c.width, c.height);
    return c;
  }

  /** 1回分の文字認識 */
  async function recognize(canvas, pass) {
    const w = await getWorker(pass.lang);
    await w.setParameters({
      tessedit_pageseg_mode: String(pass.psm),
      tessedit_char_whitelist: pass.whitelist || '',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300'
    });
    report('読み取り中', 0);
    const { data } = await w.recognize(canvas);
    return {
      text: data.text || '',
      confidence: data.confidence || 0,
      // 行ごとの文字と位置（車検証から特定の行だけ読み直すときに使う）
      lines: (data.lines || []).map(l => ({ text: l.text || '', bbox: l.bbox }))
    };
  }


  /**
   * 設定を変えながら最大数回読み、一番よい結果を返す。
   * @param {HTMLCanvasElement} src 撮影した画像（読み取りたい部分を切り出したもの）
   * @param {Object[]} passes  読み方の設定（前処理・言語・ページ区切り・使う文字）
   * @param {(text)=>Object|null} parse 文字から目的の値を取り出す関数
   * @param {(r)=>boolean} good これを満たせばそこで終了
   */
  function runPasses(src, passes, parse, good, onProgress, opts) {
    return enqueue(async () => {
      progressCb = onProgress;
      try {
        return await runPassesInner(src, passes, parse, good, opts);
      } finally {
        progressCb = null;
      }
    });
  }

  /** runPasses の中身（順番待ちの中から呼ぶ用） */
  async function runPassesInner(src, passes, parse, good, opts) {
    opts = opts || {};
    const needVotes = opts.needVotes || 1;   // 何回同じ結果が出たら終わりにするか
    const texts = [];
    const parsedList = [];
    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      const img = preprocess(src, pass.pre);
      const r = await recognize(img, pass);
      img.width = img.height = 0;          // iPhoneのメモリ節約
      texts.push(r.text);
      const parsed = parse(r.text);
      if (parsed) parsedList.push(parsed);
      const best = pickBest(parsedList, opts.byScore);
      if (best && good(best) && best.votes >= needVotes) break;
      if (i < passes.length - 1) report(`読み方を変えて確認中（${i + 2}/${passes.length}）`, 0);
    }
    return { result: pickBest(parsedList, opts.byScore), texts, parsedList };
  }

  /**
   * 各回の結果から1つ選ぶ。
   *   既定     … 同じ値が出た回数（votes）が多いものを優先し、同数なら形の確からしさ（score）で決める
   *   byScore … 形の確からしさを優先（登録番号：地名・番号の桁数がそろっているものを選ぶ）
   * ほかの回で出た値は「候補」として残す（結果画面でワンタップで選べる）。
   */
  function pickBest(list, byScore) {
    if (!list.length) return null;
    const groups = new Map();
    list.forEach(p => {
      const g = groups.get(p.value);
      if (!g) groups.set(p.value, { item: p, votes: 1 });
      else { g.votes++; if (p.score > g.item.score) g.item = p; }
    });
    const ranked = Array.from(groups.values()).sort(byScore
      ? (a, b) => (b.item.score - a.item.score) || (b.votes - a.votes)
      : (a, b) => (b.votes - a.votes) || (b.item.score - a.item.score));
    const best = Object.assign({}, ranked[0].item, { votes: ranked[0].votes, passes: list.length });
    const extra = [];
    ranked.slice(1).forEach(g => extra.push(g.item.value));
    list.forEach(p => (p.candidates || []).forEach(v => extra.push(v)));
    best.candidates = Array.from(new Set([best.value].concat(extra))).slice(0, 6);
    return best;
  }

  /** 登録番号用に使ってよい文字（数字・ひらがな・地名の漢字だけに絞ると誤読が減る） */
  function regionChars() {
    return Array.from(new Set((VIS.config.ocr.plateRegions || []).join(''))).join('');
  }
  const CHASSIS_WHITELIST = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-';

  /**
   * 自動車登録番号を読む。
   *   ① まとめて読む …… 車検証の「自動車登録番号又は車両番号」欄のような1〜2行の文字
   *   ② ナンバープレートとして読む …… 上段（地名・分類番号）・下段（ひらがな・番号）・
   *      ひらがな1文字 を別々に読み、組み合わせて一番もっともらしいものを選ぶ
   *      （プレートは上段と下段で文字の大きさが大きく違い、まとめて読むと上段を落としやすい）
   * @returns {Promise<{result:Object|null, texts:string[]}>}
   */
  function readPlate(src, onProgress) {
    return enqueue(async () => {
      progressCb = onProgress;
      const P = VIS.ocrParser;
      const texts = [];
      const parsed = [];
      const add = t => { const r = P.parsePlate(t); if (r) parsed.push(r); };
      try {
        // ① まとめて読む（車検証向け）
        const block = preprocess(src, { width: 1000, clearBorder: true });
        const r1 = await recognize(block, { lang: 'jpn', psm: 6, whitelist: '0123456789-・' + P.PLATE_KANA + regionChars() });
        block.width = block.height = 0;
        texts.push(r1.text);
        add(r1.text);
        const best = pickBest(parsed, true);
        if (best && best.score >= 9 && best.regionHow === 'exact') return { result: best, texts };

        // ② ナンバープレートとして読む
        report('ナンバープレートとして読み直し中', 0);
        const tops = [], bottoms = [], kanas = [];
        for (const W of [400, 800]) {
          const img = preprocess(src, { width: W, clearBorder: true });
          const h = img.height, w = img.width;
          const top = crop(img, 0, 0, w, Math.round(h * 0.46));
          const bot = crop(img, 0, Math.round(h * 0.36), w, h - Math.round(h * 0.36));
          tops.push((await recognize(top, { lang: 'jpn', psm: 7, whitelist: '0123456789' + regionChars() })).text.trim());
          bottoms.push((await recognize(bot, { lang: 'jpn', psm: 7, whitelist: '0123456789-・' + P.PLATE_KANA })).text.trim());
          if (W === 400) {
            // 下段の左にある ひらがな1文字だけを切り出して読む（小さくて落としやすいため）
            const k = crop(img, 0, Math.round(h * 0.40), Math.round(w * 0.26), Math.round(h * 0.5));
            kanas.push((await recognize(k, { lang: 'jpn', psm: 10, whitelist: P.PLATE_KANA })).text.trim());
            k.width = k.height = 0;
          }
          top.width = top.height = bot.width = bot.height = img.width = img.height = 0;
        }
        texts.push(tops.map((t, i) => `${t} / ${bottoms[i]}`).join('\n') + (kanas[0] ? `\n（ひらがな：${kanas[0]}）` : ''));

        // 上段と下段を組み合わせて解析する（下段にひらがなが無ければ、単独で読んだものを補う）
        tops.forEach(t => bottoms.forEach(b => {
          add(t + '\n' + b);
          if (!/[ぁ-んァ-ヶ]/.test(b)) kanas.filter(Boolean).forEach(k => add(t + '\n' + k + b));
        }));
        // ①で下段だけ読めていた場合も組み合わせる
        tops.forEach(t => add(t + '\n' + r1.text));

        return { result: pickBest(parsed, true), texts };
      } finally {
        progressCb = null;
      }
    });
  }

  /**
   * 車台番号を読む（車検証の「車台番号」欄、または車体の打刻）。
   * 1文字の読み違い（8とS、0とOなど）を見逃さないよう、日本語用・英数字用の2つの方法で読み、
   * 同じ結果が2回出たら確定。食い違ったら読み方を変えて多い方を採る。
   * @returns {Promise<{result:Object|null, texts:string[]}>}
   */
  const CHASSIS_PASSES = [
    { pre: { width: 900, clearBorder: true },                  lang: 'jpn', psm: 6, whitelist: CHASSIS_WHITELIST },
    { pre: { width: 900, clearBorder: true },                  lang: 'eng', psm: 6, whitelist: CHASSIS_WHITELIST },
    { pre: { width: 1300, clearBorder: true, binarize: true }, lang: 'eng', psm: 7, whitelist: CHASSIS_WHITELIST },
    { pre: { width: 1300, clearBorder: true, binarize: true }, lang: 'jpn', psm: 7, whitelist: CHASSIS_WHITELIST }
  ];
  const chassisGood = r => r.score >= 7;

  function readChassis(canvas, onProgress) {
    return runPasses(canvas, CHASSIS_PASSES, t => VIS.ocrParser.parseChassis(t), chassisGood, onProgress, { needVotes: 2 });
  }

  /**
   * 1回目の結果の「行の位置」から、目的の値が書かれた行だけを元の画像から切り出す。
   * 車検証全体を読むより、1行だけを大きくして読み直した方が正確になる。
   */
  function cropLine(src, lines, scale, parse) {
    let best = null;
    (lines || []).forEach(l => {
      const r = parse(l.text);
      if (r && l.bbox && (!best || r.score > best.score)) best = { score: r.score, bbox: l.bbox };
    });
    if (!best) return null;
    const b = best.bbox;
    const x0 = b.x0 / scale, y0 = b.y0 / scale, x1 = b.x1 / scale, y1 = b.y1 / scale;
    const padY = (y1 - y0) * 0.35, padX = (y1 - y0) * 0.8;
    const sx = Math.max(0, x0 - padX), sy = Math.max(0, y0 - padY);
    const sw = Math.min(src.width - sx, x1 - x0 + padX * 2), sh = Math.min(src.height - sy, y1 - y0 + padY * 2);
    if (sw < 8 || sh < 8) return null;
    return crop(src, Math.round(sx), Math.round(sy), Math.round(sw), Math.round(sh));
  }

  /**
   * 車検証を1枚撮って、自動車登録番号・車台番号（紙の車検証なら車検満了日も）をまとめて読む。
   * 電子車検証（小さいカード型）・紙の車検証のどちらでも使えます。
   * @returns {Promise<{plate:Object|null, chassis:Object|null, expiry:string, texts:string[]}>}
   */
  function readCertificate(src, onProgress) {
    return enqueue(async () => {
      progressCb = onProgress;
      const P = VIS.ocrParser;
      const texts = [], plates = [], chassis = [];
      let expiry = '';
      try {
        // ① 車検証全体を読む
        const img = preprocess(src, { width: 1800 });
        const scale = img.width / src.width;
        const r = await recognize(img, { lang: 'jpn', psm: 3 });
        img.width = img.height = 0;
        texts.push(r.text);
        const p0 = P.parsePlate(r.text);   if (p0) plates.push(p0);
        const c0 = P.parseChassis(r.text); if (c0) chassis.push(c0);
        expiry = P.parseExpiry(r.text);

        // ② 車台番号の行だけを切り出して、読み方を変えながら読み直す（1文字の読み違い対策）
        report('車台番号を確認中', 0);
        const chassisLine = cropLine(src, r.lines, scale, t => P.parseChassis(t));
        if (chassisLine) {
          const o = await runPassesInner(chassisLine, CHASSIS_PASSES, t => P.parseChassis(t), chassisGood, { needVotes: 2 });
          texts.push(...o.texts);
          // 行だけを読んだ結果の方が確かなので、全体の結果より優先する
          o.parsedList.forEach(x => chassis.push(x, x));
          chassisLine.width = chassisLine.height = 0;
        }

        // ③ 登録番号がはっきりしなければ、その行だけ読み直す
        const bp = pickBest(plates, true);
        if (!bp || bp.score < 9 || bp.regionHow !== 'exact') {
          report('自動車登録番号を確認中', 0);
          const plateLine = cropLine(src, r.lines, scale, t => P.parsePlate(t));
          if (plateLine) {
            const o = await runPassesInner(plateLine, [
              { pre: { width: 1000, clearBorder: true }, lang: 'jpn', psm: 7, whitelist: '0123456789-・' + P.PLATE_KANA + regionChars() },
              { pre: { width: 1000, clearBorder: true }, lang: 'jpn', psm: 6, whitelist: '' }
            ], t => P.parsePlate(t), x => x.score >= 9 && x.regionHow === 'exact', { byScore: true });
            texts.push(...o.texts);
            plates.push(...o.parsedList);
            plateLine.width = plateLine.height = 0;
          }
        }

        // ④ どちらも見つからなければ、読み方を変えて全体をもう一度
        if (!plates.length || !chassis.length) {
          report('読み方を変えて確認中', 0);
          const img2 = preprocess(src, { width: 2400, binarize: true });
          const r2 = await recognize(img2, { lang: 'jpn', psm: 11 });
          img2.width = img2.height = 0;
          texts.push(r2.text);
          const p = P.parsePlate(r2.text);   if (p) plates.push(p);
          const c = P.parseChassis(r2.text); if (c) chassis.push(c);
          expiry = expiry || P.parseExpiry(r2.text);
        }
        return { plate: pickBest(plates, true), chassis: pickBest(chassis), expiry, texts };
      } finally {
        progressCb = null;
      }
    });
  }
  /**
   * 事前準備：OCRエンジンと文字データ（日本語・英数字）を読み込んで端末に保存しておく。
   * 電波の弱い現場に行く前に、Wi-Fiのある所で1回実行しておくと安心です。
   */
  function warmup(onProgress) {
    return enqueue(async () => {
      progressCb = onProgress;
      try {
        await getWorker('jpn');
        await getWorker('eng');
      } finally {
        progressCb = null;
      }
    });
  }

  /** ワーカーを終了してメモリを空ける */
  async function terminate() {
    if (!worker) return;
    const w = worker;
    worker = null; workerLang = null;
    try { await w.terminate(); } catch (e) { /* 終了済み */ }
  }

  VIS.ocr = { readPlate, readChassis, readCertificate, warmup, terminate, preprocess };

})(window);