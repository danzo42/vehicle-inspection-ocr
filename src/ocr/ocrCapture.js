/* =============================================================================
 * ocrCapture.js  ―― 車検証などの読み取り画面（スマホ前提）
 * -----------------------------------------------------------------------------
 * 入力画面の「読取」ボタンを押すと全画面で開きます。
 *
 *   ① カメラ ……… 画面の枠に車検証（または読みたい欄・ナンバープレート）を合わせる。
 *                   QRモードは枠に入れるだけで自動で読み取り、文字（OCR）モードはシャッターを押す。
 *   ② 写真から …… カメラが使えないとき・高画質で撮りたいときは、
 *                   スマホのカメラアプリで撮った写真（またはアルバム）を選ぶ。
 *   ③ 結果 ……… 撮った画像と読み取り結果を並べて表示。
 *                   見比べて、違っていればその場で直してから「この内容で入力」。
 *
 * 読み取りの種類
 *   'certqr'  … 車検証の二次元コード（QR）から 自動車登録番号・車台番号・車検満了日
 *               （QRは読めた時点で中身が正確。いちばん確実）
 *   'cert'    … 車検証の文字（OCR）から 自動車登録番号・車台番号（紙の車検証なら車検満了日も）
 *   'plate'   … 自動車登録番号だけ（OCR。車検証の欄・ナンバープレート）
 *   'chassis' … 車台番号だけ（OCR。車検証の欄・車体の打刻）
 *
 * 使い方（画面側）:
 *   const r = await VIS.ocrCapture.open('certqr');
 *   // 閉じたときは null。「文字で読む」を選んだときは { switchTo: 'cert' }
 *   r.values.plateNumber / r.values.chassisNo / r.values.shakenExpiry
 *   r.edited[キー] … 読み取り結果をその場で直してから入力したら true
 *   r.source       … 'qr'（QRから）または 'ocr'（文字認識から）
 * ========================================================================== */

(function (global) {
  'use strict';

  const VIS = global.VIS;
  const util = VIS.util;
  const P = () => VIS.ocrParser;

  /** 結果欄の種類ごとの設定 */
  const OUTPUTS = {
    plateNumber: {
      label: '自動車登録番号', placeholder: '例：金沢400わ1234',
      format: v => P().formatPlate(v),
      ok: r => r.score >= 9 && r.regionHow === 'exact',
      hint: r => r.regionHow !== 'exact'
        ? '地名がはっきり読めませんでした。候補から選ぶか、直接直してください。'
        : '読み取りに自信がありません。違う所を直してください。'
    },
    chassisNo: {
      label: '車台番号', placeholder: '例：NHR85-0001234',
      format: v => P().formatChassis(v),
      ok: r => r.score >= 7 && r.votes >= 2,
      hint: r => r.votes < 2
        ? '読むたびに結果が少し違いました。1文字ずつ見比べ、違えば候補から選ぶか直してください。'
        : '読み取りに自信がありません。違う所を直してください。'
    },
    shakenExpiry: {
      label: '車検満了日', type: 'date', optional: true,
      format: v => v,
      ok: () => true,
      hint: () => ''
    }
  };

  /** 読み取りの種類ごとの設定 */
  const MODES = {
    certqr: {
      title: '車検証のQRで読み取る',
      hint: '車検証の小さなQR（普通車は2つ並びと3つ並び、軽自動車は1つずつ並んだQR）を枠に入れてください。10〜15cmくらいの距離でピントが合うと、自動で読み取ります',
      aspect: 2.2,
      outputs: ['plateNumber', 'chassisNo', 'shakenExpiry'],
      qr: true,
      // 写真からQRが見つからず「全体を読む」を押したときは、文字（OCR）で読む
      read: (c, p) => MODES.cert.read(c, p)
    },
    cert: {
      title: '車検証の文字から読み取る',
      hint: '車検証の全体を枠に合わせてください（電子車検証・紙の車検証どちらでも可）。文字が小さいときは「写真から」で撮ると確実です',
      aspect: 1.42,
      outputs: ['plateNumber', 'chassisNo', 'shakenExpiry'],
      read: async (c, p) => {
        const o = await VIS.ocr.readCertificate(c, p);
        return {
          texts: o.texts,
          results: {
            plateNumber: o.plate,
            chassisNo: o.chassis,
            shakenExpiry: o.expiry ? { value: o.expiry, score: 9, votes: 1 } : null
          }
        };
      }
    },
    plate: {
      title: '自動車登録番号を読み取る',
      hint: '車検証の「自動車登録番号又は車両番号」欄を枠に合わせてください（ナンバープレートでも読めます）',
      aspect: 2.0,
      outputs: ['plateNumber'],
      read: async (c, p) => {
        const o = await VIS.ocr.readPlate(c, p);
        return { texts: o.texts, results: { plateNumber: o.result } };
      }
    },
    chassis: {
      title: '車台番号を読み取る',
      hint: '車検証の「車台番号」欄を枠に合わせてください（車体の打刻でも読めます）',
      aspect: 4.2,
      outputs: ['chassisNo'],
      read: async (c, p) => {
        const o = await VIS.ocr.readChassis(c, p);
        return { texts: o.texts, results: { chassisNo: o.result } };
      }
    }
  };

  /** QRを探すときの区画の大きさ（1回ごとに切り替えて、1回の処理を軽くする） */
  const QR_FRACS = [1, 0.5, 0.34, 0.25];
  /** 2つ並び（登録番号・車台番号）がそろってから、3つ並び（満了日）を待つ時間 */
  const WAIT_CODE3_MS = 2500;

  const ICON_CAMERA = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>';

  function open(modeKey) {
    const mode = MODES[modeKey];
    if (!mode) throw new Error('未知の読み取り: ' + modeKey);
    const Q = VIS.shakenQr;

    return new Promise(resolve => {
      let stream = null;
      let photo = null;        // 写真から選んだときの画像（canvas）
      let sel = null;          // 写真上の選択範囲（表示座標）
      let lastResults = {};
      let lastSource = mode.qr ? 'qr' : 'ocr';
      let closed = false;

      // QRモードの状態
      let collector = mode.qr ? new Q.Collector() : null;
      let qrTimer = null, qrFrame = 0, code2At = 0, wantCode3 = false, qrPreview = '';
      const work = document.createElement('canvas');
      if (mode.qr) Q.findAll.lastSize = 0;

      // ------------------------------------------------------------- 画面を作る
      const cameraActions = mode.qr ? `
            <button type="button" class="ocr-btn ghost" data-act="photo">写真から</button>
            <button type="button" class="ocr-btn ghost" data-act="to-ocr">文字で読む</button>
            <button type="button" class="ocr-btn ghost" data-act="skip-code3" hidden>満了日なしで進む</button>
            <button type="button" class="ocr-btn ghost" data-act="torch" hidden>ライト</button>
            <span class="ocr-spacer" data-act="torch-spacer" hidden></span>` : `
            <button type="button" class="ocr-btn ghost" data-act="photo">写真から</button>
            <button type="button" class="ocr-shutter" data-act="shoot" aria-label="撮影">${ICON_CAMERA}</button>
            <button type="button" class="ocr-btn ghost" data-act="torch" hidden>ライト</button>
            <span class="ocr-spacer" data-act="torch-spacer"></span>`;

      const ov = document.createElement('div');
      ov.className = 'ocr-overlay';
      ov.setAttribute('role', 'dialog');
      ov.setAttribute('aria-modal', 'true');
      ov.innerHTML = `
        <div class="ocr-top">
          <button type="button" class="ocr-close" aria-label="閉じる">&#10005;</button>
          <div class="ocr-title">${util.esc(mode.title)}</div>
        </div>

        <div class="ocr-stage">
          <div class="ocr-cam" data-mode="camera">
            <video playsinline muted autoplay></video>
            <div class="ocr-guide"><i></i><i></i><i></i><i></i></div>
            ${mode.qr ? '<div class="ocr-qr-status">QRを探しています…</div>' : ''}
            <p class="ocr-hint">${util.esc(mode.hint)}</p>
            <p class="ocr-cam-msg" hidden></p>
          </div>

          <div class="ocr-select" data-mode="select" hidden>
            <p class="ocr-hint ocr-select-hint">そのまま「全体を読む」か、読みたい部分を<b>指でなぞって囲んで</b>ください</p>
            <div class="ocr-photo-area">
              <div class="ocr-photo-wrap">
                <img alt="選んだ写真">
                <div class="ocr-sel" hidden></div>
              </div>
            </div>
          </div>

          <div class="ocr-result" data-mode="result" hidden>
            <img class="ocr-crop" alt="読み取った部分">
            <div class="ocr-status"><span class="ocr-spinner"></span><span class="ocr-status-text">準備中…</span></div>
            <div class="ocr-outputs"></div>
            <details class="ocr-raw-box" hidden>
              <summary>読み取った文字（参考）</summary>
              <pre class="ocr-raw"></pre>
            </details>
          </div>
        </div>

        <div class="ocr-bottom">
          <div class="ocr-actions" data-mode="camera">${cameraActions}
          </div>
          <div class="ocr-actions" data-mode="select" hidden>
            <button type="button" class="ocr-btn ghost" data-act="retake">撮り直す</button>
            <button type="button" class="ocr-btn ghost" data-act="read-sel" disabled>囲んだ所を読む</button>
            <button type="button" class="ocr-btn primary" data-act="read-all">全体を読む</button>
          </div>
          <div class="ocr-actions" data-mode="result" hidden>
            <button type="button" class="ocr-btn ghost" data-act="retake">撮り直す</button>
            <button type="button" class="ocr-btn ghost" data-act="more-qr" hidden>満了日のQRも読む</button>
            <button type="button" class="ocr-btn primary" data-act="apply" disabled>この内容で入力</button>
          </div>
        </div>
        <input type="file" accept="image/*" class="ocr-file" hidden>`;
      document.body.appendChild(ov);
      document.body.classList.add('ocr-open');

      const $ = s => ov.querySelector(s);
      const video = $('video');
      const guide = $('.ocr-guide');
      const camBox = $('.ocr-cam');
      const fileInput = $('.ocr-file');
      const photoImg = $('.ocr-photo-wrap img');
      const photoWrap = $('.ocr-photo-wrap');
      const selBox = $('.ocr-sel');

      // ------------------------------------------------------------ 画面の切替
      function setMode(m) {
        ov.querySelectorAll('[data-mode]').forEach(el => { el.hidden = el.dataset.mode !== m; });
        if (m === 'camera') { layoutGuide(); startCamera(); }
        else stopCamera();
      }

      // -------------------------------------------------------------- カメラ
      async function startCamera() {
        if (stream) { if (mode.qr) startQr(); return; }
        const msg = $('.ocr-cam-msg');
        msg.hidden = true;
        try {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('insecure');
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          });
          if (closed) { stopCamera(); return; }
          video.srcObject = stream;
          await video.play().catch(() => {});

          // ライト（Androidの一部の機種のみ対応）とピント合わせ
          const track = stream.getVideoTracks()[0];
          const caps = track && track.getCapabilities ? track.getCapabilities() : {};
          $('[data-act="torch"]').hidden = !caps.torch;
          $('[data-act="torch-spacer"]').hidden = !!caps.torch || mode.qr;
          if (caps.focusMode && caps.focusMode.includes('continuous')) {
            track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
          }
          if (mode.qr) startQr();
        } catch (e) {
          console.warn('camera', e);
          stream = null;
          msg.hidden = false;
          msg.textContent = (e && e.message === 'insecure')
            ? 'この接続ではカメラを使えません（https で開く必要があります）。下の「写真から」で撮影してください。'
            : 'カメラを起動できませんでした。カメラの使用を許可するか、下の「写真から」で撮影してください。';
        }
      }

      function stopCamera() {
        clearTimeout(qrTimer);
        if (stream) stream.getTracks().forEach(t => t.stop());
        stream = null;
        video.srcObject = null;
      }

      /** 撮影枠の大きさを画面に合わせる */
      function layoutGuide() {
        const r = camBox.getBoundingClientRect();
        let w = r.width * 0.9;
        let h = w / mode.aspect;
        if (h > r.height * 0.62) { h = r.height * 0.62; w = h * mode.aspect; }
        guide.style.width  = w + 'px';
        guide.style.height = h + 'px';
        guide.style.left   = (r.width - w) / 2 + 'px';
        guide.style.top    = Math.max(12, (r.height - h) / 2 - 24) + 'px';
      }
      const onResize = () => { if (!camBox.hidden) layoutGuide(); };
      window.addEventListener('resize', onResize);

      /**
       * 枠の中（margin の割合だけ余白を付ける）を、カメラの元の解像度で切り出す。
       * target を渡すとその canvas に描く（QRを探すときは同じ canvas を使い回す）。
       */
      function captureGuide(margin, target) {
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return null;
        const box = camBox.getBoundingClientRect();
        const g = guide.getBoundingClientRect();
        // video は object-fit: cover で表示しているので、その拡大率とずれを計算する
        const scale = Math.max(box.width / vw, box.height / vh);
        const offX = (box.width  - vw * scale) / 2;
        const offY = (box.height - vh * scale) / 2;
        const m = margin == null ? 1 : margin;
        const mx = g.width * 0.04 * m, my = g.height * 0.08 * m;
        let sx = (g.left - box.left - mx - offX) / scale;
        let sy = (g.top  - box.top  - my - offY) / scale;
        let sw = (g.width  + mx * 2) / scale;
        let sh = (g.height + my * 2) / scale;
        // 整数の画素にそろえて、拡大縮小なしで写す（端数があると少しぼけて、小さなQRが読めなくなる）
        sx = Math.max(0, Math.round(sx)); sy = Math.max(0, Math.round(sy));
        sw = Math.min(vw - sx, Math.round(sw)); sh = Math.min(vh - sy, Math.round(sh));
        const c = target || document.createElement('canvas');
        c.width = sw; c.height = sh;
        c.getContext('2d', { willReadFrequently: !!target }).drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
        return c;
      }

      // ------------------------------------------------------- QRの読み取り
      function startQr() {
        clearTimeout(qrTimer);
        qrTimer = setTimeout(qrTick, 200);
      }

      /** カメラの映像から、枠の中のQRを探し続ける */
      function qrTick() {
        if (closed || !stream) return;
        const c = captureGuide(0, work);
        if (c) {
          // 2回に1回は、見つけたQRの大きさに合わせて細かく探す
          const known = qrFrame % 2 === 1 ? Q.findAll.lastSize : 0;
          const found = Q.findAll(c, known ? [] : [QR_FRACS[(qrFrame >> 1) % QR_FRACS.length]], known);
          qrFrame++;
          let added = false;
          found.forEach(s => { if (collector.add(s)) added = true; });
          if (added && navigator.vibrate) navigator.vibrate(30);
          if (checkQr(() => c.toDataURL('image/jpeg', 0.8))) return;
        }
        qrTimer = setTimeout(qrTick, 150);
      }

      /** 読めたQRの状況（2つ並び＝登録番号・車台番号、3つ並び＝満了日など） */
      function qrState() {
        const groups = collector.groups();
        const code2 = groups.find(g => g.complete ? (g.parsed && g.parsed.kind === 'code2') : g.total === 2) || null;
        const code3 = groups.find(g => g.complete ? (g.parsed && g.parsed.kind === 'code3') : g.total === 3) || null;
        return { code2, code3, count: collector.count };
      }

      /** 状況を表示し、そろっていれば結果画面へ進む。進んだら true */
      function checkQr(preview) {
        const st = qrState();
        const dots = (have, total) => Array.from({ length: total }, (_, i) => i < have ? '●' : '○').join('');
        // 軽自動車のQRは分割なし（1個でそろう）ので、そろったら丸をすべて埋める
        const c2 = st.code2 ? (st.code2.complete ? 2 : st.code2.have) : 0, c3 = st.code3 ? (st.code3.complete ? 3 : st.code3.have) : 0;
        let msg = `登録番号・車台番号 ${dots(c2, 2)}　満了日 ${dots(c3, 3)}`;
        const code2Done = !!(st.code2 && st.code2.complete);
        const code3Done = !!(st.code3 && st.code3.complete);
        // 読めたのに中身の形が想定と違うQR（古い形式の車検証など）があるか
        const unknown = collector.groups().some(g => g.complete && !g.parsed);
        if (code2Done && !code3Done) msg += wantCode3 ? '\n満了日のQR（普通車は3つ並び）を枠に入れてください' : '\n満了日のQRを探しています…';
        else if (!code2Done && unknown) msg += '\nQRの形式が想定と違います。下の「文字で読む」をお使いください';
        else if (!code2Done && c3 && !c2) msg += '\n登録番号・車台番号のQR（普通車は2つ並び）も枠に入れてください';
        $('.ocr-qr-status').textContent = msg;

        if (!code2Done) return false;
        if (!code2At) { code2At = Date.now(); qrPreview = preview(); }
        if (code3Done || (!wantCode3 && Date.now() - code2At > WAIT_CODE3_MS)) {
          finishQr(st);
          return true;
        }
        return false;
      }

      /** QRの読み取り結果を表示する */
      function finishQr(st) {
        st = st || qrState();
        if (!st.code2 || !st.code2.complete) return;
        const p2 = st.code2.parsed;
        const p3 = st.code3 && st.code3.complete ? st.code3.parsed : null;
        lastSource = 'qr';
        wantCode3 = false;
        setMode('result');
        $('.ocr-crop').src = qrPreview || '';
        const results = {
          // QRは読めた時点で中身が正確なので「確実」として扱う
          plateNumber: { value: p2.plateNumber, score: 99, votes: 9, regionHow: 'exact', candidates: [] },
          chassisNo:   { value: p2.chassisNo,   score: 99, votes: 9, candidates: [] },
          shakenExpiry: p3 && p3.shakenExpiry ? { value: p3.shakenExpiry, score: 9, votes: 9 } : null
        };
        const notes = {};
        if (!results.shakenExpiry) {
          notes.shakenExpiry = p3
            ? 'このQRには車検満了日が入っていません（電子車検証のカードのQRは空欄です）。「自動車検査証記録事項」（A4の紙）のQRを読むか、手で入力してください。'
            : '満了日のQR（普通車は3つ並び）が読めなかったため、車検満了日は入っていません。「満了日のQRも読む」で続けて読めます。';
        }
        $('[data-act="more-qr"]').hidden = !!(results.shakenExpiry || p3);
        showResult({ texts: [], results, notes }, 'qr');
      }

      /** 写真からQRを探す。登録番号・車台番号がそろえば true */
      function readQrFromPhoto(canvas) {
        Q.findAll.lastSize = 0;
        for (const maxSide of [2400, 1400]) {
          const s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
          const c = document.createElement('canvas');
          c.width = Math.round(canvas.width * s); c.height = Math.round(canvas.height * s);
          c.getContext('2d').drawImage(canvas, 0, 0, c.width, c.height);
          Q.findAll(c).forEach(sym => collector.add(sym));
          c.width = c.height = 0;
          const st = qrState();
          if (st.code2 && st.code2.complete && (!st.code3 || st.code3.complete || maxSide === 1400)) break;
        }
        const st = qrState();
        if (!(st.code2 && st.code2.complete)) return false;
        if (!qrPreview) qrPreview = canvas.toDataURL('image/jpeg', 0.8);
        finishQr(st);
        return true;
      }

      // ------------------------------------------------------------- 写真から
      async function loadPhoto(file) {
        const url = URL.createObjectURL(file);
        try {
          const img = await new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i);
            i.onerror = () => rej(new Error('画像を開けませんでした'));
            i.src = url;
          });
          // 大きすぎる写真は縮小（スマホのメモリ対策。車検証の小さな文字が読める解像度は残す）
          const max = 3000;
          const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          photo = document.createElement('canvas');
          photo.width = Math.round(img.naturalWidth * s);
          photo.height = Math.round(img.naturalHeight * s);
          photo.getContext('2d').drawImage(img, 0, 0, photo.width, photo.height);

          // QRモード：まず写真の中のQRを探す（見つかればそのまま結果へ）
          if (mode.qr) {
            stopCamera();
            if (readQrFromPhoto(photo)) return;
            $('.ocr-select-hint').innerHTML = collector.count
              ? 'QRは見つかりましたが、登録番号・車台番号のQR（2つ並び）がそろいませんでした。QRに近づいて撮り直すか、「全体を読む」で<b>文字（OCR）から</b>読み取れます'
              : 'この写真からはQRを見つけられませんでした。QRに近づいて撮り直すか、「全体を読む」で<b>文字（OCR）から</b>読み取れます';
          }

          sel = null;
          selBox.hidden = true;
          $('[data-act="read-sel"]').disabled = true;
          setMode('select');
          // 写真を画面いっぱい（はみ出さない大きさ）に表示する
          const area = $('.ocr-photo-area');
          photoImg.style.maxWidth  = area.clientWidth + 'px';
          photoImg.style.maxHeight = area.clientHeight + 'px';
          photoImg.src = photo.toDataURL('image/jpeg', 0.85);
        } finally {
          URL.revokeObjectURL(url);
        }
      }

      // 指でなぞって範囲を選ぶ
      let dragStart = null;
      function pointIn(e) {
        const r = photoImg.getBoundingClientRect();
        return {
          x: Math.max(0, Math.min(r.width,  e.clientX - r.left)),
          y: Math.max(0, Math.min(r.height, e.clientY - r.top))
        };
      }
      function drawSel() {
        if (!sel) { selBox.hidden = true; return; }
        selBox.hidden = false;
        Object.assign(selBox.style, { left: sel.x + 'px', top: sel.y + 'px', width: sel.w + 'px', height: sel.h + 'px' });
      }
      photoWrap.addEventListener('pointerdown', e => {
        e.preventDefault();
        photoWrap.setPointerCapture(e.pointerId);
        dragStart = pointIn(e);
        sel = { x: dragStart.x, y: dragStart.y, w: 0, h: 0 };
        drawSel();
      });
      photoWrap.addEventListener('pointermove', e => {
        if (!dragStart) return;
        const p = pointIn(e);
        sel = {
          x: Math.min(p.x, dragStart.x), y: Math.min(p.y, dragStart.y),
          w: Math.abs(p.x - dragStart.x), h: Math.abs(p.y - dragStart.y)
        };
        drawSel();
      });
      const endDrag = () => {
        if (!dragStart) return;
        dragStart = null;
        if (sel && (sel.w < 16 || sel.h < 10)) sel = null;   // 小さすぎる＝タップしただけ
        drawSel();
        $('[data-act="read-sel"]').disabled = !sel;
      };
      photoWrap.addEventListener('pointerup', endDrag);
      photoWrap.addEventListener('pointercancel', endDrag);

      /** 選んだ範囲を写真の元の解像度で切り出す */
      function cropPhoto(useSelection) {
        if (!useSelection || !sel) return photo;
        const r = photoImg.getBoundingClientRect();
        const k = photo.width / r.width;
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(sel.w * k));
        c.height = Math.max(1, Math.round(sel.h * k));
        c.getContext('2d').drawImage(photo, sel.x * k, sel.y * k, sel.w * k, sel.h * k, 0, 0, c.width, c.height);
        return c;
      }

      // ------------------------------------------------------- 文字（OCR）で読む
      async function read(canvas) {
        if (!canvas) { util.toast('撮影できませんでした。もう一度お試しください', 'warn'); return; }
        lastSource = 'ocr';
        setMode('result');
        $('[data-act="more-qr"]').hidden = true;
        $('.ocr-crop').src = canvas.toDataURL('image/jpeg', 0.85);
        $('.ocr-status').className = 'ocr-status';
        $('.ocr-outputs').innerHTML = '';
        $('.ocr-raw-box').hidden = true;
        $('[data-act="apply"]').disabled = true;
        const statusText = $('.ocr-status-text');
        statusText.textContent = 'OCRエンジンを準備中…（初回は数秒かかります）';

        try {
          const out = await mode.read(canvas, (msg, p) => {
            if (closed) return;
            statusText.textContent = msg + (p > 0 && p < 1 ? `（${Math.round(p * 100)}%）` : '…');
          });
          if (closed) return;
          showResult(out, 'ocr');
        } catch (e) {
          console.error(e);
          $('.ocr-status').className = 'ocr-status err';
          statusText.textContent = '読み取りに失敗しました：' + e.message;
          showResult({ texts: [], results: {} }, 'ocr');
        }
      }

      /**
       * 結果を表示する。
       * out.results[キー] … 読み取った値（無ければ null）
       * out.notes[キー]   … 値が無いときに出す説明（満了日が入っていない理由など）
       */
      function showResult(out, source) {
        lastResults = out.results || {};
        const notes = out.notes || {};
        const box = $('.ocr-outputs');
        let okCount = 0, foundCount = 0, required = 0;

        box.innerHTML = mode.outputs.map(key => {
          const o = OUTPUTS[key];
          const r = lastResults[key];
          const isOptional = !!o.optional;
          if (!isOptional) required++;
          if (isOptional && !r && !notes[key]) return '';     // 満了日は見つかったときだけ出す
          let note = '', cls = '';
          if (!r) {
            cls = isOptional ? 'warn' : 'err';
            note = notes[key] || '読み取れませんでした。撮り直すか、手で入力してください。';
          } else {
            if (!isOptional) foundCount++;
            if (o.ok(r)) {
              if (!isOptional) okCount++;
              cls = 'ok';
              note = isOptional ? (source === 'qr' ? '車検証のQRから読み取りました。' : '車検証の記載から読み取りました。') : '';
            } else { cls = 'warn'; note = o.hint(r); }
          }
          // 候補（別の読み方・よく使う地名）
          const chips = [];
          if (r && r.candidates) r.candidates.filter(v => v !== r.value).slice(0, 3).forEach(v => chips.push({ label: v, value: v }));
          if (key === 'plateNumber' && r && r.regionHow !== 'exact') {
            const rest = r.classNo + r.kana + r.number;
            (VIS.config.ocr.preferredRegions || []).forEach(name => chips.push({ label: name, value: name + rest, region: true }));
          }
          return `
            <div class="ocr-out" data-key="${key}">
              <label class="ocr-value-label">
                <span>${util.esc(o.label)}</span>
                <input type="${o.type || 'text'}" class="ocr-value" data-key="${key}" autocomplete="off"
                       placeholder="${util.esc(o.placeholder || '')}" value="${util.esc(r ? r.value : '')}">
              </label>
              ${note ? `<p class="ocr-out-note ${cls}">${util.esc(note)}</p>` : ''}
              ${chips.length ? `<div class="ocr-chips"><span class="ocr-chips-title">候補：</span>${chips.map(c =>
                `<button type="button" class="ocr-chip${c.region ? ' region' : ''}" data-value="${util.esc(c.value)}">${util.esc(c.label)}</button>`).join('')}</div>` : ''}
            </div>`;
        }).join('');

        const st = $('.ocr-status'), text = $('.ocr-status-text');
        if (!foundCount) {
          st.className = 'ocr-status err';
          text.textContent = modeKey === 'cert' || modeKey === 'certqr'
            ? '読み取れませんでした。車検証を枠いっぱいに写すか、「写真から」で撮り直してください。'
            : '読み取れませんでした。枠いっぱいに大きく写して撮り直すか、手で入力してください。';
        } else if (okCount >= required) {
          st.className = 'ocr-status ok';
          text.textContent = source === 'qr'
            ? '車検証のQRから読み取りました。念のため、車検証の記載と見比べてください。'
            : '読み取りました。上の画像と1文字ずつ見比べて確認してください。';
        } else {
          st.className = 'ocr-status warn';
          text.textContent = '一部に自信がありません。黄色の注意がある欄を確認してください。';
        }

        $('.ocr-raw').textContent = (out.texts || []).map((t, i) => `【${i + 1}回目】\n${String(t).trim() || '（文字なし）'}`).join('\n\n');
        $('.ocr-raw-box').hidden = !(out.texts || []).length;
        $('[data-act="apply"]').disabled = false;
      }

      // 候補ボタン → その欄に入れる
      $('.ocr-outputs').addEventListener('click', e => {
        const b = e.target.closest('.ocr-chip');
        if (!b) return;
        const input = b.closest('.ocr-out').querySelector('.ocr-value');
        input.value = b.dataset.value;
      });

      // ---------------------------------------------------------------- 終了
      function close(value) {
        if (closed) return;
        closed = true;
        stopCamera();
        window.removeEventListener('resize', onResize);
        document.body.classList.remove('ocr-open');
        ov.remove();
        resolve(value);
      }

      function apply() {
        const values = {}, edited = {};
        ov.querySelectorAll('.ocr-value').forEach(input => {
          const key = input.dataset.key;
          const v = OUTPUTS[key].format(input.value.trim());
          if (!v) return;
          values[key] = v;
          const r = lastResults[key];
          edited[key] = !r || r.value !== v;
        });
        if (!Object.keys(values).length) { util.toast('入力する値がありません', 'warn'); return; }
        close({ values, edited, source: lastSource });
      }

      /** QRモードを最初からやり直す */
      function resetQr() {
        collector = new Q.Collector();
        Q.findAll.lastSize = 0;
        code2At = 0; wantCode3 = false; qrPreview = '';
        $('[data-act="skip-code3"]').hidden = true;
        $('[data-act="to-ocr"]').hidden = false;
        $('.ocr-qr-status').textContent = 'QRを探しています…';
      }

      // ------------------------------------------------------------ ボタン操作
      ov.addEventListener('click', e => {
        const b = e.target.closest('[data-act], .ocr-close');
        if (!b || b.disabled) return;
        if (b.classList.contains('ocr-close')) { close(null); return; }
        switch (b.dataset.act) {
          case 'shoot': read(captureGuide()); break;
          case 'photo': fileInput.value = ''; fileInput.click(); break;
          case 'torch': toggleTorch(b); break;
          case 'retake':
            photo = null;
            if (mode.qr) resetQr();
            setMode('camera');
            break;
          case 'read-all': read(cropPhoto(false)); break;
          case 'read-sel': read(cropPhoto(true)); break;
          case 'apply': apply(); break;
          case 'to-ocr': close({ switchTo: 'cert' }); break;
          case 'more-qr':
            // 登録番号・車台番号は読めたまま、満了日のQR（3つ並び）を続けて読む
            wantCode3 = true;
            $('[data-act="skip-code3"]').hidden = false;
            $('[data-act="to-ocr"]').hidden = true;
            setMode('camera');
            break;
          case 'skip-code3': finishQr(); break;
        }
      });
      fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        if (f) loadPhoto(f).catch(err => util.toast(err.message, 'err'));
      });

      let torchOn = false;
      async function toggleTorch(btn) {
        const track = stream && stream.getVideoTracks()[0];
        if (!track) return;
        torchOn = !torchOn;
        try {
          await track.applyConstraints({ advanced: [{ torch: torchOn }] });
          btn.classList.toggle('on', torchOn);
        } catch (e) { torchOn = !torchOn; }
      }

      setMode('camera');
    });
  }

  VIS.ocrCapture = { open, MODES };

})(window);