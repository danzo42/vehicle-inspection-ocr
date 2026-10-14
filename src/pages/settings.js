/* =============================================================================
 * settings.js  ―― 設定・使い方
 *   ・いつも使う入力値（点検担当者名など）
 *   ・OCRの事前準備（文字データを端末に読み込んでおく）
 *   ・この端末の点検記録の整理
 * ========================================================================== */
(async function () {
  const VIS = window.VIS, util = VIS.util, $ = util.$;
  await VIS.ready();
  $('#ver').textContent = 'v' + VIS.config.appVersion;

  // ------------------------------------------------------- いつも使う入力値
  const prefs = util.loadPrefs();
  ['inspectorName', 'supervisorName', 'branch'].forEach(k => { $('#pref-' + k).value = prefs[k] || ''; });
  $('#btn-save-prefs').addEventListener('click', () => {
    util.savePrefs({
      inspectorName:  $('#pref-inspectorName').value.trim(),
      supervisorName: $('#pref-supervisorName').value.trim(),
      branch:         $('#pref-branch').value.trim()
    });
    util.toast('保存しました', 'ok');
  });

  // ------------------------------------------------------------ OCRの準備
  const ocrStatus = $('#ocr-status');
  async function checkOcrCache() {
    if (!('caches' in window)) { ocrStatus.textContent = '状態を確認できません'; return; }
    const files = ['vendor/tesseract/lang/jpn.traineddata.gz', 'vendor/tesseract/lang/eng.traineddata.gz'];
    const hits = await Promise.all(files.map(f => caches.match(new URL(f, location.href).href)));
    ocrStatus.textContent = hits.every(Boolean)
      ? '準備済み（電波が無くても読み取りできます）'
      : 'まだ準備していません';
  }
  checkOcrCache().catch(() => {});

  $('#btn-warmup').addEventListener('click', async () => {
    const btn = $('#btn-warmup');
    btn.disabled = true;
    try {
      await VIS.ocr.warmup((msg, p) => {
        ocrStatus.textContent = msg + (p > 0 && p < 1 ? `（${Math.round(p * 100)}%）` : '…');
      });
      await VIS.ocr.terminate();
      ocrStatus.textContent = '準備できました（電波が無くても読み取りできます）';
      util.toast('OCRの準備ができました', 'ok');
    } catch (e) {
      console.error(e);
      ocrStatus.textContent = '準備に失敗しました：' + e.message;
    } finally {
      btn.disabled = false;
    }
  });

  // ------------------------------------------------------ 端末内の点検記録
  async function refreshUsage() {
    const rows = await VIS.storage.listRecent(0);
    $('#rec-count').textContent = `${rows.length} 件`;
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      $('#usage').textContent = `約 ${(est.usage / 1024 / 1024).toFixed(1)} MB（OCRの文字データを含む）`;
    }
    return rows;
  }
  refreshUsage().catch(() => {});

  $('#btn-purge').addEventListener('click', async () => {
    const days = Number($('#purge-days').value);
    const cutoff = new Date(Date.now() - days * 86400000);
    const rows = (await VIS.storage.listRecent(0)).filter(r => new Date(r.inspectedAt) < cutoff);
    if (!rows.length) { util.toast('削除する記録はありません', 'info'); return; }
    if (!confirm(`${rows.length} 件の点検記録を、この端末から削除します。元に戻せません。\n（共有・印刷済みのPDFは消えません）\n\nよろしいですか？`)) return;
    for (const r of rows) await VIS.storage.deleteInspection(r.inspectionId);
    util.toast(`${rows.length} 件削除しました`, 'ok');
    refreshUsage().catch(() => {});
  });

  // ------------------------------------------------------------- 全部消す
  $('#btn-wipe').addEventListener('click', async () => {
    if (!confirm('この端末に保存した点検記録・入力途中の内容・いつも使う入力値をすべて削除します。元に戻せません。よろしいですか？')) return;
    if (!confirm('本当に削除しますか？')) return;
    try { VIS.storage.db.close(); } catch (e) { /* ignore */ }
    await new Promise(res => {
      const r = indexedDB.deleteDatabase(VIS.config.dbName);
      r.onsuccess = r.onerror = r.onblocked = () => res();
    });
    try {
      Object.keys(localStorage).filter(k => k.startsWith('vis-ocr')).forEach(k => localStorage.removeItem(k));
    } catch (e) { /* ignore */ }
    alert('削除しました。');
    location.href = 'index.html';
  });
})();