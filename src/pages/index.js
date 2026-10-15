/* =============================================================================
 * index.js  ―― トップ画面：QRコードから管理番号を読み取る
 * -----------------------------------------------------------------------------
 * QRコードの中身は「DC4-0754」のような管理番号の文字だけです。
 * 車両マスタは持たないので、読んだ管理番号をそのまま使って次の画面へ進みます。
 * ========================================================================== */
(async function () {
  const VIS = window.VIS, util = VIS.util, $ = util.$;
  // アプリとしてインストールの案内（アプリとして開いているときは出ない）
  VIS.install.render($('#install-card'), { dismissible: true });
  await VIS.ready();

  // この端末の点検記録（新しい順に10件）
  const recent = await VIS.storage.listRecent(10).catch(() => []);
  if (recent.length) {
    $('#recent').innerHTML = VIS.recordListHtml(recent);
    $('#recent-card').hidden = false;
  }

  let busy = false;
  let lastRaw = '', lastAt = 0;

  /** 読んだ管理番号で次の画面へ */
  async function go(vehicleId, rawText, fromCamera) {
    if (busy || !vehicleId) return;
    if (!util.looksLikeVehicleId(vehicleId)) {
      if (fromCamera) {
        // 管理番号ではないQR（URLなど）を写したとき。同じQRで何度も出さないようにする
        const now = Date.now();
        if (rawText === lastRaw && now - lastAt < 4000) return;
        lastRaw = rawText; lastAt = now;
        util.toast(`管理番号のQRではありません：${String(rawText).slice(0, 30)}`, 'warn');
        return;
      }
      if (!confirm(`「${vehicleId}」は管理番号の形（例：DC4-0754）ではありません。このまま進みますか？`)) return;
    }
    busy = true;
    await scanner.stop();
    location.href = `vehicle.html?id=${encodeURIComponent(vehicleId)}`;
  }

  // ------------------------------------------------------------- カメラ読み取り
  const scanner = new VIS.QrScanner('reader');

  async function startCamera() {
    try {
      await scanner.start((id, raw) => {
        $('#scan-hint').textContent = `読み取り：${raw}`;
        go(id, raw, true);
      });
      $('#scan-hint').textContent = 'QRを枠の中に合わせてください';
      $('#btn-restart').hidden = true;
    } catch (e) {
      console.warn(e);
      $('#scan-hint').textContent =
        'カメラを起動できませんでした。下の「管理番号を直接入力」か「QRコードの写真から読み取る」をお使いください。';
      $('#btn-restart').hidden = false;
    }
  }
  startCamera();
  $('#btn-restart').addEventListener('click', startCamera);

  // ----------------------------------------------------------------- 手入力
  const input = $('#manual-id');
  $('#btn-manual').addEventListener('click', () => {
    const id = util.normalizeVehicleId(input.value);
    if (!id) { util.toast('管理番号を入力してください', 'warn'); input.focus(); return; }
    go(id, input.value, false);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-manual').click(); });

  // ------------------------------------------------------- 写真から読む
  $('#qr-file').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = await VIS.QrScanner.decodeFile(f);
      util.toast(`読み取り：${r.rawText}`, 'ok');
      go(r.vehicleId, r.rawText, false);
    } catch (err) {
      util.toast('写真からQRを読み取れませんでした', 'err');
    }
  });
})();