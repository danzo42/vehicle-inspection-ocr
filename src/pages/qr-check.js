/* =============================================================================
 * qr-check.js  ―― 車検証QRテスト（実物の車検証で、QRから読めるかを確かめる）
 * -----------------------------------------------------------------------------
 * カメラの映像から黄色の枠の中を切り出し、QRを探し続けます。
 * 分割されたQR（二次元コード2は2個、3は3個）がそろったら中身を表示します。
 * 読んだ内容は画面に出すだけで、保存・送信はしません。
 * ========================================================================== */
(function () {
  const VIS = window.VIS, util = VIS.util, $ = util.$, Q = VIS.shakenQr;

  const video = $('video');
  const guide = $('.qc-guide');
  const camBox = $('.qc-cam');
  const work = document.createElement('canvas');
  let collector = new Q.Collector();
  let stream = null, timer = null, startedAt = 0, doneAt = 0, frame = 0;
  const CAMERA_FRACS = [1, 0.5, 0.34, 0.25];

  // ------------------------------------------------------------------ カメラ
  async function startCamera() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('insecure');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
      video.srcObject = stream;
      await video.play().catch(() => {});
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      if (caps.torch) $('#btn-torch').hidden = false;
      if (caps.focusMode && caps.focusMode.includes('continuous')) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      }
      // ズーム（Androidの一部の機種）：小さいQRを大きく写せる
      if (caps.zoom) {
        const z = $('#zoom');
        Object.assign(z, { min: caps.zoom.min, max: caps.zoom.max, step: caps.zoom.step || 0.1, value: caps.zoom.min });
        z.hidden = false;
        z.addEventListener('input', () => track.applyConstraints({ advanced: [{ zoom: Number(z.value) }] }).catch(() => {}));
      }
      $('#cam-msg').textContent = `QRを探しています…（カメラ ${video.videoWidth}×${video.videoHeight}）`;
      scanLoop();
    } catch (e) {
      $('#cam-msg').textContent = e.message === 'insecure'
        ? 'この接続ではカメラを使えません。「写真から読む」をお使いください。'
        : 'カメラを起動できませんでした。「写真から読む」をお使いください。';
    }
  }

  /** 枠の中を、カメラの元の解像度で切り出して QR を探す */
  function scanLoop() {
    clearTimeout(timer);
    const vw = video.videoWidth, vh = video.videoHeight;
    if (vw && vh) {
      const box = camBox.getBoundingClientRect(), g = guide.getBoundingClientRect();
      const scale = Math.max(box.width / vw, box.height / vh);
      const offX = (box.width - vw * scale) / 2, offY = (box.height - vh * scale) / 2;
      const sx = Math.max(0, (g.left - box.left - offX) / scale), sy = Math.max(0, (g.top - box.top - offY) / scale);
      const sw = Math.min(vw - sx, g.width / scale), sh = Math.min(vh - sy, g.height / scale);
      work.width = Math.round(sw); work.height = Math.round(sh);
      work.getContext('2d', { willReadFrequently: true }).drawImage(video, sx, sy, sw, sh, 0, 0, work.width, work.height);
      // 1回の処理を軽くするため、区画の大きさを1回ごとに切り替えて探す
      const known = frame % 2 === 1 ? Q.findAll.lastSize : 0;   // 2回に1回は、見つけたQRの大きさで細かく探す
      addFound(Q.findAll(work, known ? [] : [CAMERA_FRACS[(frame >> 1) % CAMERA_FRACS.length]], known));
      frame++;
    }
    timer = setTimeout(scanLoop, 150);
  }

  // ------------------------------------------------------------- 写真から
  $('#btn-photo').addEventListener('click', () => { $('#file').value = ''; $('#file').click(); });
  $('#file').addEventListener('change', async () => {
    const f = $('#file').files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      if (!startedAt) startedAt = performance.now();
      // 写真の大きさを変えながら探す（QRが小さい写真・大きい写真の両方に対応）
      for (const maxSide of [2400, 1400]) {
        const s = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        addFound(Q.findAll(c));
        c.width = c.height = 0;
      }
      if (!collector.count) util.toast('写真からQRを見つけられませんでした。QRに近づいて撮ってください', 'warn');
    } catch (e) {
      util.toast('写真を読めませんでした', 'err');
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  // ------------------------------------------------------------ 結果の表示
  function addFound(list) {
    let added = false;
    list.forEach(s => { if (collector.add(s)) added = true; });
    if (!added) return;
    if (!startedAt) startedAt = performance.now();
    if (navigator.vibrate) navigator.vibrate(40);
    render();
  }

  function render() {
    const groups = collector.groups();
    $('#progress').innerHTML = groups.map(g => {
      const name = g.parsed && g.parsed.kind === 'code2' ? '二次元コード2（登録番号・車台番号）'
                 : g.parsed && g.parsed.kind === 'code3' ? '二次元コード3（型式・満了日など）'
                 : g.total === 2 ? '二次元コード2？（登録番号・車台番号）'
                 : g.total === 3 ? '二次元コード3？（型式・満了日など）' : `QR（${g.total}分割）`;
      const dots = Array.from({ length: g.total }, (_, i) => `<i class="${i < g.have ? 'on' : ''}"></i>`).join('');
      return `<div class="qc-row"><span class="qc-dots">${dots}</span><span>${util.esc(name)}　${g.have}/${g.total}${g.complete ? ' ✓' : ''}</span></div>`;
    }).join('') || '<p class="small muted" style="margin:0">まだQRを読めていません</p>';

    const r = collector.result();
    const set = (id, v) => { $(id).textContent = v || '―'; };
    set('#r-plate', r.plateNumber);
    set('#r-chassis', r.chassisNo);
    set('#r-model', r.model);
    set('#r-engine', r.engineModel);
    set('#r-expiry', r.shakenExpiry ? r.shakenExpiry : (r.model !== undefined ? '（券面のQRには入っていません）' : ''));
    set('#r-first', r.firstRegistration);
    $('#raw').textContent = groups.map(g => `[${g.have}/${g.total}] ${g.complete ? g.text : '（そろっていません）'}`).join('\n');

    if (r.plateNumber && r.chassisNo && !doneAt) {
      doneAt = performance.now();
      $('#cam-msg').textContent = '登録番号・車台番号を読み取りました';
    }
    const t = ((doneAt || performance.now()) - startedAt) / 1000;
    $('#elapsed').textContent = r.plateNumber && r.chassisNo
      ? `最初のQRを見つけてから、登録番号・車台番号がそろうまで ${t.toFixed(1)} 秒`
      : `読めたQR：${collector.count} 個`;
  }

  // ------------------------------------------------------------ そのほか
  $('#btn-reset').addEventListener('click', () => {
    collector = new Q.Collector();
    startedAt = doneAt = 0;
    $('#progress').innerHTML = '<p class="small muted" style="margin:0">まだQRを読めていません</p>';
    ['#r-plate', '#r-chassis', '#r-model', '#r-engine', '#r-expiry', '#r-first'].forEach(id => { $(id).textContent = '―'; });
    $('#raw').textContent = ''; $('#elapsed').textContent = '';
    $('#cam-msg').textContent = 'QRを探しています…';
  });

  let torchOn = false;
  $('#btn-torch').addEventListener('click', async () => {
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    torchOn = !torchOn;
    try { await track.applyConstraints({ advanced: [{ torch: torchOn }] }); } catch (e) { torchOn = !torchOn; }
  });

  // 画面を離れたらカメラを止める
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { clearTimeout(timer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; }
    else if (!stream) startCamera();
  });

  startCamera();
})();