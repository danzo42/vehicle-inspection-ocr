/* =============================================================================
 * vehicle.js  ―― 車両の確認：読み取った管理番号が正しいかを見てから点検に進む
 * ========================================================================== */
(async function () {
  const VIS = window.VIS, util = VIS.util, $ = util.$, esc = util.esc;
  await VIS.ready();

  const id  = util.normalizeVehicleId(util.param('id'));
  const box = $('#content');
  if (!id) {
    box.innerHTML = '<div class="banner err">管理番号が指定されていません。</div>' +
                    '<a class="btn" href="index.html">QR読み取りに戻る</a>';
    return;
  }

  const info    = util.prefixInfo(id);
  const history = await VIS.storage.listInspections(id, VIS.config.historyLimit).catch(() => []);
  const latest  = history[0] || null;
  const draft   = util.loadDraft(id);
  const type    = (latest && latest.vehicleType) || (info && info.type) || '';
  const cycle   = (latest && latest.inspectionCycle) || (info && info.cycle) || VIS.config.defaultCycle;
  const q = encodeURIComponent(id);

  box.innerHTML = `
    <div class="vehicle-head">
      <div class="vid">${esc(id)}</div>
      <div class="vtype">${esc(type || '車種未設定')}　/　${esc(util.cycleLabel(cycle))}</div>
    </div>

    ${info ? '' : `<div class="banner warn">記号「${esc(util.prefixOf(id) || id)}」は登録されていない記号です。
      管理番号が正しいか確認してください（車種と点検区分は点検の画面で選べます）。</div>`}

    <div class="card">
      <dl class="kv">
        <dt>管理番号</dt><dd><b>${esc(id)}</b></dd>
        <dt>車種</dt><dd>${esc(type || '―')}</dd>
        <dt>点検区分</dt><dd>${esc(util.cycleLabel(cycle))}</dd>
        <dt>前回点検<br><span class="small">（この端末）</span></dt>
        <dd>${latest ? esc(util.formatDateTime(latest.inspectedAt)) : '記録なし'}</dd>
        ${latest ? `
        <dt>自動車登録番号</dt><dd>${esc(latest.plateNumber || '―')}</dd>
        <dt>車台番号</dt><dd>${esc(latest.chassisNo || '―')}</dd>` : ''}
      </dl>
    </div>

    <div class="card">
      ${draft ? `<p class="small" style="margin:0 0 4px">入力途中の点検があります（${esc(util.formatDateTime(draft.savedAt))}）。</p>` : ''}
      <a class="btn big" href="inspect.html?id=${q}">${draft ? '点検の続きを入力する' : '点検を始める'}</a>
      ${latest ? `<a class="btn secondary" href="view.html?rid=${encodeURIComponent(latest.inspectionId)}">前回の記録簿を見る</a>` : ''}
      <a class="btn ghost" href="index.html">別の車両を読み取る</a>
    </div>

    ${history.length > 1 ? `
    <div class="card">
      <h2>この車両の点検記録（この端末）</h2>
      <ul class="rec-list">${VIS.recordListHtml(history)}</ul>
    </div>` : ''}

    <p class="center small muted">自動車登録番号と車台番号は、点検の画面でカメラから読み取ります。</p>`;
})();