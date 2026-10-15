/* =============================================================================
 * inspect.js  ―― 点検入力画面
 * -----------------------------------------------------------------------------
 *   1) QRで読んだ管理番号（?id=DC4-0754）を「YDEC№」にする
 *   2) 自動車登録番号・車台番号・車検満了日をカメラで読み取って入力する
 *      ・「車検証のQRで読み取る」…… 車検証の二次元コードから（いちばん確実）
 *      ・「車検証の文字から読み取る」… QRが読めないとき、文字認識（OCR）で
 *      ・各欄の「読取」………………… 1項目ずつOCR（車検証の欄・ナンバープレート・車体の打刻）
 *      ※この端末で前に点検した車両なら、前回の値を先に入れておく
 *   3) 点検項目は02と同じ定義（data/inspection-items.json）から自動生成
 *   4) 完了すると02と同じ書式の記録簿PDF（A4一枚）を作り、この端末に保存
 *
 *   入力の途中経過は自動で端末に保存し、ブラウザが閉じても続きから入力できます。
 * ========================================================================== */
(async function () {
  const VIS = window.VIS, util = VIS.util, $ = util.$, P = VIS.ocrParser;
  await VIS.ready();

  const id = util.normalizeVehicleId(util.param('id'));
  if (!id) {
    document.querySelector('main').innerHTML =
      '<div class="banner err">管理番号が指定されていません。</div><a class="btn" href="index.html">QR読み取りに戻る</a>';
    document.querySelector('.progress-bar').hidden = true;
    return;
  }
  $('#back').href = `vehicle.html?id=${encodeURIComponent(id)}`;

  const def      = await VIS.form.loadDefinition();
  const info     = util.prefixInfo(id);                          // 記号から決まる車種・点検区分
  const previous = await VIS.storage.getLatestInspection(id).catch(() => null);
  const prefs    = util.loadPrefs();
  const draft    = util.loadDraft(id);
  const form     = $('#form');

  /** 登録番号・車台番号・車検満了日をどこから入れたか（記録に残す）: qr / qr-edited / ocr / ocr-edited / previous / manual */
  const sources = { plateNumber: 'manual', chassisNo: 'manual', shakenExpiry: '' };
  let cycle = (previous && previous.inspectionCycle) || (info && info.cycle) || VIS.config.defaultCycle;
  let itemsBox = null;
  let submitted = false;

  // ------------------------------------------------------------------ 初期値
  $('#vehicleId').value = id;
  $('#vehicleType').value   = (previous && previous.vehicleType) || (info && info.type) || '';
  $('#inspectorName').value = prefs.inspectorName || '';
  $('#supervisorName').value = (previous && previous.supervisorName) || prefs.supervisorName || '';
  $('#branch').value = prefs.branch || (previous && previous.branch) || '';

  // 車種の入力候補（管理番号の記号の表から）
  const types = Array.from(new Set(Object.values(VIS.config.prefixes || {}).map(p => p.type)));
  $('#type-list').innerHTML = types.map(t => `<option value="${util.esc(t)}"></option>`).join('');

  if (previous) {
    markField('plateNumber', previous.plateNumber || '', 'previous');
    markField('chassisNo',   previous.chassisNo   || '', 'previous');
    $('#previousInspectionDate').value = String(previous.inspectedAt || '').slice(0, 10);
    if (previous.odometer != null)       $('#previousOdometer').value = previous.odometer;
    if (previous.shakenExpiry)         { $('#shakenExpiry').value     = previous.shakenExpiry; sources.shakenExpiry = 'previous'; }
    if (previous.shakenOdometer != null) $('#shakenOdometer').value   = previous.shakenOdometer;
    $('#prefill-note').textContent =
      `この端末の前回の記録（${util.formatDateTime(previous.inspectedAt)}）から一部を入力しました。点検日時は保存時に自動で記録されます。`;
  }

  renderItems(cycle);
  // 何も入力していない状態を覚えておく（ボタンを押しただけで下書きを作らないため）
  const baseline = snapshotKey();
  if (draft) restoreDraft(draft);
  renderHead();

  // --------------------------------------------------------------- 画面の部品

  /** 画面上部の管理番号の帯 */
  function renderHead() {
    const type = $('#vehicleType').value.trim();
    $('#vehicle-box').innerHTML = `
      <div class="vehicle-head">
        <div class="vid">${util.esc(id)}</div>
        <div class="vtype">${util.esc(type || '車種未設定')}　/　${util.esc(util.cycleLabel(cycle))}</div>
      </div>`;
  }

  /** 点検区分に合わせて点検項目を作り直す */
  function renderItems(c) {
    cycle = c;
    // 毎回新しい入れ物に描く（フォーム部品のイベントが二重に付かないように）
    const box = document.createElement('div');
    box.addEventListener('vis:progress', e => {
      const { done, total } = e.detail;
      $('#meter').style.width = (total ? done / total * 100 : 0) + '%';
      $('#count').textContent = `${done} / ${total}`;
    });
    $('#items').replaceChildren(box);
    itemsBox = box;
    VIS.form.render(box, def, cycle, { vehicleId: id });

    const spec = def.cycles[cycle];
    $('#title').textContent = spec.title;
    $('#omit-note').textContent = spec.omitNote;
    form.querySelectorAll('input[name="cycle"]').forEach(r => { r.checked = r.value === cycle; });
    $('#cycle-note').textContent = info
      ? `管理番号の記号「${info.prefix}」から ${util.cycleLabel(info.cycle)} と判定しました。`
      : `記号「${util.prefixOf(id) || id}」は登録されていません。点検区分を確認してください。`;
    renderHead();
  }

  /**
   * 登録番号・車台番号の欄に値を入れ、どこから入れたかの目印を付ける。
   * kind: 'qr' | 'qr-edited' | 'ocr' | 'ocr-edited' | 'previous' | 'manual'
   */
  function markField(name, value, kind) {
    const input = document.getElementById(name);
    const note  = document.getElementById(name + '-note');
    if (value != null) input.value = value;
    sources[name] = kind;
    input.classList.toggle('qr-filled',   kind === 'qr' || kind === 'qr-edited');
    input.classList.toggle('ocr-filled',  kind === 'ocr' || kind === 'ocr-edited');
    input.classList.toggle('prev-filled', kind === 'previous' && !!input.value);
    note.className = 'field-note';
    note.hidden = true;
    if (!input.value) return;
    if (kind === 'qr' || kind === 'qr-edited') {
      note.hidden = false;
      note.classList.add('qr');
      note.textContent = kind === 'qr'
        ? '車検証のQRから読み取りました。'
        : '車検証のQRから読み取り、その場で修正した値です。実物と見比べて確認してください。';
    } else if (kind === 'ocr' || kind === 'ocr-edited') {
      note.hidden = false;
      note.classList.add('ocr');
      note.textContent = 'カメラで読み取った値です。実物と1文字ずつ見比べて確認してください。';
    } else if (kind === 'previous') {
      note.hidden = false;
      note.classList.add('prev');
      note.textContent = 'この端末の前回の記録から入力しました。変わっていないか確認してください。';
    }
  }

  /** 形式チェック（明らかにおかしいときだけ赤い注意を出す） */
  function checkFormat(name) {
    const input = document.getElementById(name);
    const note  = document.getElementById(name + '-note');
    const ok = name === 'plateNumber' ? P.isPlausiblePlate(input.value) : P.isPlausibleChassis(input.value);
    if (!input.value || ok) {
      if (note.classList.contains('bad')) markField(name, null, sources[name]);
      return true;
    }
    note.hidden = false;
    note.className = 'field-note bad';
    note.textContent = name === 'plateNumber'
      ? '登録番号の形が通常と違います（例：金沢400わ1234）。もう一度確認してください。'
      : '車台番号の形が通常と違います（例：NHR85-0001234）。もう一度確認してください。';
    return false;
  }

  // ------------------------------------------------------------ OCRの読み取り
  document.querySelectorAll('[data-ocr]').forEach(btn => {
    btn.addEventListener('click', async () => {
      let r = await VIS.ocrCapture.open(btn.dataset.ocr);   // 'certqr' | 'cert' | 'plate' | 'chassis'
      // QRの画面で「文字で読む」を選んだときは、OCRの画面を開き直す
      if (r && r.switchTo) r = await VIS.ocrCapture.open(r.switchTo);
      if (!r) return;
      const kind = r.source === 'qr' ? 'qr' : 'ocr';
      const filled = [];
      ['plateNumber', 'chassisNo'].forEach(name => {
        if (!r.values[name]) return;
        // 読み取り結果をその場で直してから入れた場合は ○○-edited として残す
        markField(name, r.values[name], r.edited[name] ? kind + '-edited' : kind);
        checkFormat(name);
        filled.push(name === 'plateNumber' ? '登録番号' : '車台番号');
      });
      if (r.values.shakenExpiry) {
        const ex = $('#shakenExpiry');
        ex.value = r.values.shakenExpiry;
        ex.classList.remove('qr-filled', 'ocr-filled');
        ex.classList.add(kind === 'qr' ? 'qr-filled' : 'ocr-filled');
        sources.shakenExpiry = r.edited.shakenExpiry ? kind + '-edited' : kind;
        filled.push('車検満了日');
      }
      if (filled.length) {
        util.toast(`${filled.join('・')}を入力しました。` +
          (kind === 'qr' ? '' : '実物と見比べて確認してください'), 'ok');
      }
      saveDraftSoon();
    });
  });

  // 車検満了日を手で直したら目印を外す
  $('#shakenExpiry').addEventListener('input', () => {
    $('#shakenExpiry').classList.remove('qr-filled', 'ocr-filled');
    sources.shakenExpiry = $('#shakenExpiry').value ? 'manual' : '';
  });

  ['plateNumber', 'chassisNo'].forEach(name => {
    const input = document.getElementById(name);
    input.addEventListener('input', () => {
      // 手で書き換えたら目印を外す（OCRの値を直した場合は ocr-edited）
      const was = sources[name];
      const kind = (was === 'qr' || was === 'qr-edited') ? 'qr-edited'
                 : (was === 'ocr' || was === 'ocr-edited') ? 'ocr-edited' : 'manual';
      sources[name] = kind;
      input.classList.remove('prev-filled');
    });
    input.addEventListener('blur', () => {
      input.value = name === 'plateNumber' ? P.formatPlate(input.value) : P.formatChassis(input.value);
      checkFormat(name);
    });
  });

  $('#vehicleType').addEventListener('input', renderHead);

  // ---------------------------------------------------------------- 点検区分
  form.querySelectorAll('input[name="cycle"]').forEach(r => {
    r.addEventListener('change', () => {
      if (r.value === cycle) return;
      const hasInput = !!itemsBox.querySelector('.item input[type=radio]:checked');
      if (hasInput && !confirm('点検区分を変えると、入力した点検結果が消えます。よろしいですか？')) {
        form.querySelectorAll('input[name="cycle"]').forEach(x => { x.checked = x.value === cycle; });
        return;
      }
      renderItems(r.value);
      saveDraftSoon();
    });
  });

  // ---------------------------------------------------------------- 下書き
  function snapshot() {
    const d = { savedAt: util.nowIso(), cycle, fields: {}, radios: {}, sources: Object.assign({}, sources) };
    form.querySelectorAll('input, textarea, select').forEach(el => {
      if (el.type === 'radio') { if (el.checked) d.radios[el.name] = el.value; }
      else if (el.id && el.id !== 'vehicleId') d.fields[el.id] = el.value;
    });
    return d;
  }

  /** 下書きの比較用（保存日時を除いた中身） */
  function snapshotKey() {
    const s = snapshot();
    delete s.savedAt;
    return JSON.stringify(s);
  }

  /** 入力に変化があれば下書きを保存。最初の状態に戻っていれば下書きを消す */
  function saveDraftNow() {
    if (submitted) return;
    if (snapshotKey() === baseline) util.clearDraft(id);
    else util.saveDraft(id, snapshot());
  }

  let draftTimer = null;
  function saveDraftSoon() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveDraftNow, 400);
  }
  form.addEventListener('input',  saveDraftSoon);
  form.addEventListener('change', saveDraftSoon);
  form.addEventListener('click',  saveDraftSoon);    // 「この区分をすべて良好」などのボタン
  // 画面を離れる直前にも保存（iPhoneはアプリ切替でページが閉じられることがある）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveDraftNow();
  });

  function restoreDraft(d) {
    if (d.cycle && d.cycle !== cycle) renderItems(d.cycle);
    Object.keys(d.fields || {}).forEach(k => {
      const el = document.getElementById(k);
      if (el) el.value = d.fields[k];
    });
    Object.keys(d.radios || {}).forEach(name => {
      if (name === 'cycle') return;
      form.querySelectorAll(`input[type=radio]`).forEach(r => {
        if (r.name === name && r.value === d.radios[name]) r.checked = true;
      });
    });
    ['plateNumber', 'chassisNo'].forEach(n => markField(n, null, (d.sources && d.sources[n]) || 'manual'));
    if (d.sources && d.sources.shakenExpiry !== undefined) sources.shakenExpiry = d.sources.shakenExpiry;
    // 下書きの満了日がQR・OCRから入れたものなら、目印も戻す
    const ex = $('#shakenExpiry');
    ex.classList.toggle('qr-filled',  /^qr/.test(sources.shakenExpiry || '') && !!ex.value);
    ex.classList.toggle('ocr-filled', /^ocr/.test(sources.shakenExpiry || '') && !!ex.value);
    VIS.form.updateProgress(itemsBox);
    $('#draft-text').textContent = `途中まで入力した内容（${util.formatDateTime(d.savedAt)}）を復元しました。`;
    $('#draft-banner').hidden = false;
  }

  $('#draft-discard').addEventListener('click', () => {
    if (!confirm('途中まで入力した内容を消して、最初から入力しますか？')) return;
    util.clearDraft(id);
    submitted = true;      // 再読み込みの直前に下書きを書き戻さないように
    location.reload();
  });

  // ------------------------------------------------------------------- 保存
  function focusField(fieldId) {
    const el = document.getElementById(fieldId);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => el.focus(), 300);
  }

  $('#submit').addEventListener('click', async () => {
    const btn = $('#submit');

    const plate   = P.formatPlate($('#plateNumber').value);
    const chassis = P.formatChassis($('#chassisNo').value);
    $('#plateNumber').value = plate;
    $('#chassisNo').value   = chassis;
    const vehicleType    = $('#vehicleType').value.trim();
    const inspectorName  = $('#inspectorName').value.trim();
    const supervisorName = $('#supervisorName').value.trim();
    const branch         = $('#branch').value.trim();

    if (!plate) {
      util.toast('自動車登録番号を入力してください（「読取」でカメラから入力できます）', 'warn');
      return focusField('plateNumber');
    }
    if (!chassis) {
      util.toast('車台番号を入力してください（「読取」でカメラから入力できます）', 'warn');
      return focusField('chassisNo');
    }
    if (!inspectorName) {
      util.toast('点検担当者名を入力してください', 'warn');
      return focusField('inspectorName');
    }

    const data = VIS.form.collect(itemsBox, def, cycle);
    if (VIS.form.targetOptions(def.cycles[cycle]).length && !data.target) {
      util.toast('対象車種を選択してください', 'warn');
      itemsBox.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (Object.values(data.preChecks).some(v => !v.value)) {
      util.toast('備品確認（車検証・三角停止板）を選択してください', 'warn');
      itemsBox.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (data.summary.unfilled > 0) {
      util.toast(`未入力が ${data.summary.unfilled} 項目あります`, 'warn');
      VIS.form.focusFirstUnfilled(itemsBox);
      return;
    }

    const warnings = [];
    if (!P.isPlausiblePlate(plate))     warnings.push('※ 登録番号の形が通常と違います');
    if (!P.isPlausibleChassis(chassis)) warnings.push('※ 車台番号の形が通常と違います');
    const msg =
      '点検を完了して保存します。\n\n' +
      `管理番号：${id}\n` +
      `登録番号：${plate}\n` +
      `車台番号：${chassis}\n` +
      `車種：${vehicleType || '（未入力）'}\n` +
      `総合判定：${data.summary.overall}（整備実施 ${data.summary.actionCount} 件）\n` +
      (warnings.length ? '\n' + warnings.join('\n') + '\n' : '') +
      '\n登録番号・車台番号が実物と合っているか、もう一度確認してください。保存しますか？';
    if (!confirm(msg)) return;

    btn.disabled = true;
    const setBusy = m => { btn.textContent = m; };

    try {
      // 文字認識に使ったメモリを空けてからPDFを作る（iPhoneのメモリ対策）
      await VIS.ocr.terminate();

      const now = util.nowIso();
      const record = {
        inspectionId:     util.makeInspectionId(id),
        vehicleId:        id,                 // ＝QRコードの管理番号（記録簿の YDEC№）
        vehicleType:      vehicleType,
        plateNumber:      plate,
        chassisNo:        chassis,
        inputSources:     { plateNumber: sources.plateNumber, chassisNo: sources.chassisNo,
                            shakenExpiry: $('#shakenExpiry').value ? (sources.shakenExpiry || 'manual') : '' },
        inspectionCycle:  cycle,
        inspectedAt:      now,
        createdAt:        now,
        inspectorName:    inspectorName,
        supervisorName:   supervisorName,
        branch:           branch,
        odometer:         $('#odometer').value ? Number($('#odometer').value) : null,
        previousInspectionDate: $('#previousInspectionDate').value || '',
        previousOdometer: $('#previousOdometer').value ? Number($('#previousOdometer').value) : null,
        shakenExpiry:     $('#shakenExpiry').value || '',
        shakenOdometer:   $('#shakenOdometer').value ? Number($('#shakenOdometer').value) : null,
        remarks:          $('#remarks').value.trim(),
        target:           data.target,
        preChecks:        data.preChecks,
        results:          data.results,
        summary:          data.summary,
        appVersion:       VIS.config.appVersion
      };
      // 記録簿に載せる車両情報（02では車両マスタから引いていたものを、入力値から作る）
      const vehicle = { vehicleId: id, vehicleType, plateNumber: plate, chassisNo: chassis, branch };

      setBusy('PDFを作成中…');
      const pdfBlob = await VIS.pdf.generate(record, vehicle, def);

      setBusy('保存中…');
      await VIS.storage.saveInspection(record, pdfBlob);
      submitted = true;
      clearTimeout(draftTimer);
      util.clearDraft(id);
      util.savePrefs({ inspectorName, supervisorName, branch });

      location.href = `view.html?rid=${encodeURIComponent(record.inspectionId)}&done=1`;
    } catch (e) {
      console.error(e);
      util.toast('保存に失敗しました：' + e.message, 'err');
      btn.disabled = false;
      btn.textContent = '点検を完了';
    }
  });
})();