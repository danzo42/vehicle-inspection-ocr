/* =============================================================================
 * view.js  ―― 点検記録簿の表示・印刷・共有
 * -----------------------------------------------------------------------------
 * 保存した点検記録を、02と同じ書式の記録簿（A4一枚）で表示します。
 * 「印刷・共有」でスマホの共有画面を開き、印刷・メール・Teams などに送れます。
 * このページからは記録の書き換えを一切行いません。
 * ========================================================================== */
(async function () {
  const VIS = window.VIS, util = VIS.util, $ = util.$, esc = util.esc;
  await VIS.ready();

  const box = $('#content');
  const rid = util.param('rid');
  const record = rid ? await VIS.storage.getInspection(rid).catch(() => null) : null;
  if (!record) {
    box.innerHTML = '<div class="banner err">点検記録が見つかりません（この端末に保存されていない可能性があります）。</div>' +
                    '<a class="btn" href="index.html">トップへ戻る</a>';
    return;
  }
  $('#back').href = `vehicle.html?id=${encodeURIComponent(record.vehicleId)}`;

  // 記録簿に載せる車両情報（点検時に入力・読み取りした値）
  const vehicle = {
    vehicleId:   record.vehicleId,
    vehicleType: record.vehicleType,
    plateNumber: record.plateNumber,
    chassisNo:   record.chassisNo,
    branch:      record.branch
  };

  const others = (await VIS.storage.listInspections(record.vehicleId, VIS.config.historyLimit).catch(() => []))
    .filter(r => r.inspectionId !== record.inspectionId);

  const pdfBlob  = await VIS.storage.getPdf(record).catch(() => null);
  const fileName = `点検記録簿_${record.vehicleId}_${util.ymdCompact(record.inspectedAt)}.pdf`;
  const pdfFile  = pdfBlob ? new File([pdfBlob], fileName, { type: 'application/pdf' }) : null;
  const pdfUrl   = pdfBlob ? URL.createObjectURL(pdfBlob) : '';

  const s = record.summary || {};
  const isOk = s.overall === '良好';
  const src = record.inputSources || {};
  const srcLabel = k => ({
    'ocr': 'カメラで読み取り', 'ocr-edited': 'カメラで読み取り後に修正',
    'previous': '前回の記録から', 'manual': '手入力'
  }[k] || '');
  const km = v => (v != null && v !== '') ? `${Number(v).toLocaleString('ja-JP')} km` : '―';
  const actions = s.actionItems || [];

  box.innerHTML = `
    ${util.param('done') ? `<div class="banner info">点検記録を保存しました。<br>
      <b>「印刷・共有」から記録簿を印刷し、車載用コピーを車両に搭載してください。</b></div>` : ''}

    <div class="vehicle-head">
      <div class="vid">${esc(record.vehicleId)}</div>
      <div class="vtype">${esc(record.vehicleType || '')}　/　${esc(record.plateNumber || '')}</div>
    </div>

    <div class="card">
      <h2>点検記録簿</h2>
      <div id="sheet-preview" class="sheet-preview"><p class="small muted center">記録簿を表示しています…</p></div>
      ${pdfBlob ? `
        <button type="button" class="btn" id="btn-share">印刷・共有（車載用コピー）</button>
        <a class="btn secondary" href="${pdfUrl}" download="${esc(fileName)}">PDFを保存</a>
        <p class="small muted" style="margin:4px 0 0">
          iPhone：「印刷・共有」→「プリント」で印刷できます。<br>
          Android：「PDFを保存」→ 開いたPDFのメニューから印刷できます。
        </p>` : '<p class="muted small">PDFが見つかりません。</p>'}
    </div>

    <div class="card">
      <div class="verdict ${isOk ? 'ok' : 'ng'}">総合判定：${esc(s.overall || '―')}</div>
      <dl class="kv" style="margin-top:14px">
        <dt>点検日時</dt><dd>${esc(util.formatDateTime(record.inspectedAt))}</dd>
        <dt>点検区分</dt><dd>${esc(util.cycleLabel(record.inspectionCycle))}</dd>
        <dt>自動車登録番号</dt><dd>${esc(record.plateNumber || '―')}
          ${src.plateNumber ? `<div class="small muted">${esc(srcLabel(src.plateNumber))}</div>` : ''}</dd>
        <dt>車台番号</dt><dd>${esc(record.chassisNo || '―')}
          ${src.chassisNo ? `<div class="small muted">${esc(srcLabel(src.chassisNo))}</div>` : ''}</dd>
        <dt>点検担当者</dt><dd>${esc(record.inspectorName || '―')}</dd>
        <dt>整備管理者</dt><dd>${esc(record.supervisorName || '―')}</dd>
        <dt>点検営業所</dt><dd>${esc(record.branch || '―')}</dd>
        <dt>走行距離</dt><dd>${esc(km(record.odometer))}</dd>
        <dt>点検項目</dt><dd>全 ${esc(s.total)} 項目 / 整備実施 ${esc(s.actionCount)} 件</dd>
      </dl>
      ${record.remarks ? `<p class="small" style="margin-top:12px"><b>所見：</b>${esc(record.remarks)}</p>` : ''}
    </div>

    ${actions.length ? `
    <div class="card">
      <h2>点検時に実施した整備</h2>
      <ul class="list">${actions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
    </div>` : ''}

    ${others.length ? `
    <div class="card">
      <h2>この車両の他の記録（この端末）</h2>
      <ul class="rec-list">${VIS.recordListHtml(others)}</ul>
    </div>` : ''}

    <a class="btn ghost" href="index.html">トップへ戻る（次の車両を読み取る）</a>
    <p class="center small muted">記録ID：${esc(record.inspectionId)}<br>この記録はこの端末の中にだけ保存されています。</p>`;

  // ------------------------------------------------ 車載用コピーの印刷・共有
  // iPhoneは「共有」を押した直後でないと共有画面を開けない決まりがあるため、
  // PDFファイルは画面を開いた時点で用意してある（pdfFile）。
  const shareBtn = document.getElementById('btn-share');
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      if (navigator.canShare && navigator.canShare({ files: [pdfFile] })) {
        try {
          await navigator.share({ files: [pdfFile], title: fileName });
        } catch (e) {
          if (e.name !== 'AbortError') util.toast('共有できませんでした：' + e.message, 'err');
        }
      } else {
        // 共有に対応していない端末（PCなど）：PDFを開き、そこから印刷・保存してもらう
        window.open(pdfUrl, '_blank', 'noopener');
      }
    });
  }

  // -------------------------------------------------------- 記録簿のプレビュー
  // スマホのブラウザはPDFの埋め込み表示がほぼできないため、
  // PDFと同じ描画処理で記録簿を画像にして表示する（ピンチで拡大できる）。
  (async () => {
    const holder = document.getElementById('sheet-preview');
    try {
      const def = await VIS.form.loadDefinition();
      const canvas = await VIS.pdf.renderPage(record, vehicle, def);
      const img = new Image();
      img.alt = '点検記録簿';
      img.src = canvas.toDataURL('image/jpeg', 0.85);
      canvas.width = 0; canvas.height = 0;   // iPhoneのメモリ節約
      holder.replaceChildren(img);
    } catch (e) {
      console.warn('記録簿の表示に失敗', e);
      holder.innerHTML = '<p class="small muted">記録簿を表示できませんでした。「PDFを保存」から開いてください。</p>';
    }
  })();
})();