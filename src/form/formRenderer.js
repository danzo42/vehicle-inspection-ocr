/* =============================================================================
 * formRenderer.js  ―― 点検フォームを data/inspection-items.json から自動生成
 * -----------------------------------------------------------------------------
 * 点検項目を増やしたい・文言を直したいときは JSON を編集するだけです。
 * このファイルを触る必要はありません。
 * ========================================================================== */

(function (global) {
  'use strict';

  const VIS = global.VIS;
  const util = VIS.util;

  let cachedDef = null;

  /** 点検項目定義（JSON）を読み込む */
  async function loadDefinition() {
    if (cachedDef) return cachedDef;
    const res = await fetch(VIS.config.inspectionItemsUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error('点検項目の定義ファイルを読み込めませんでした');
    cachedDef = await res.json();
    return cachedDef;
  }

  /**
   * フォームを描画する。
   * @param {HTMLElement} container 描画先
   * @param {Object} def            定義（loadDefinitionの戻り値）
   * @param {string} cycle          '3month' | '6month'
   */
  function render(container, def, cycle, vehicle) {
    const spec = def.cycles[cycle];
    if (!spec) throw new Error(`点検区分が定義にありません: ${cycle}`);

    const codes = def.judgementCodes;
    const html = [];

    // --- 対象車種（記録簿右上で○を付ける車種。管理番号の記号から自動で選ぶ）---
    const targets = targetOptions(spec);
    if (targets.length) {
      const guessed = vehicle ? guessTarget(spec, vehicle.vehicleId) : null;
      html.push('<section class="card">');
      html.push('<h2>対象車種</h2>');
      html.push('<p class="small muted">記録簿の「対象車種」で○を付ける車種です。違っていれば選び直してください。</p>');
      html.push('<div class="chips">');
      targets.forEach(t => {
        html.push(`
          <label class="chip"><input type="radio" name="target" value="${util.esc(t.id)}"
            ${guessed && guessed.id === t.id ? 'checked' : ''}><span>${util.esc(t.text)}</span></label>`);
      });
      html.push('</div></section>');
    }

    // --- 事前確認（車検証・三角停止板の有無）---
    html.push('<section class="card">');
    html.push('<h2>備品確認</h2>');
    html.push('<div class="pre-checks">');
    def.preChecks.forEach(pc => {
      html.push(`
        <div class="pre-check">
          <span class="pre-check-label">${util.esc(pc.label)}</span>
          <div class="seg">
            <label><input type="radio" name="pre_${pc.id}" value="有" required><span>有</span></label>
            <label><input type="radio" name="pre_${pc.id}" value="無"><span>無</span></label>
          </div>
        </div>`);
    });
    html.push('</div></section>');

    // --- 点検項目 ---
    spec.groups.forEach((group, gi) => {
      html.push('<section class="card group">');
      html.push(`<h2>${util.esc(group.name)}</h2>`);

      group.units.forEach(unit => {
        // 中分類ごとにまとめる（「まとめて該当なし」で中の項目を一括で選べるように）
        html.push('<div class="unit-block">');
        if (unit.name) {
          // 装置が付いていない車両がある中分類（定義で bulkNa: true）だけ「まとめて該当なし」を付ける
          //（例：エアサスペンションの無い車、点火装置の無いディーゼル車、クラッチの無いAT車）
          const naAll = unit.bulkNa && unit.items.length >= 2
            ? '<button type="button" class="unit-na">まとめて該当なし</button>' : '';
          html.push(`<h3 class="unit"><span>${util.esc(unit.name)}</span>${naAll}</h3>`);
        }

        unit.items.forEach(item => {
          const optTag = item.optional ? '<span class="badge-opt">省略可</span>' : '';
          const name = `item_${util.esc(item.id)}`;
          const radio = c => `
                  <label class="judge-opt judge-${c.type}">
                    <input type="radio" name="${name}" value="${util.esc(c.code)}" required>
                    <span class="mark">${util.esc(c.mark)}</span>
                    <span class="txt">${util.esc(c.label)}</span>
                  </label>`;

          // スマホで片手でも速く入力できるよう、
          //   1段目：「レ 良好」（大きく）＋「省略」＋「該当なし」＋「整備 ▾」
          //   2段目：△修理 ×交換 ○分解 Ａ調整 Ｔ締付 Ｃ清掃 Ｌ給油水（「整備 ▾」を押すと開く）
          // の2段に分けている。ほとんどの項目は「良好」を1回押すだけで済む。
          // 「省略」を選べるのは記録簿で下線の無い（白い□の）項目だけ。
          // 下線付き（黄色の□）の項目は走行距離に関係なく必ず点検する。
          // 「該当なし」はその装置が車両に無い場合で、すべての項目で選べる。
          const good    = codes.filter(c => c.type === 'good');
          const skip    = item.optional ? codes.filter(c => c.type === 'skip') : [];
          const na      = codes.filter(c => c.type === 'na');
          const actions = codes.filter(c => c.type === 'action');
          html.push(`
            <div class="item${item.optional ? '' : ' required'}" data-item-id="${util.esc(item.id)}">
              <div class="item-label">${util.esc(item.label)}${optTag}</div>
              <div class="judge">
                ${good.map(radio).join('')}
                ${skip.map(radio).join('')}
                ${na.map(radio).join('')}
                <button type="button" class="judge-more" aria-expanded="false">整備 ▾</button>
              </div>
              <div class="judge-actions" hidden>
                ${actions.map(radio).join('')}
              </div>
            </div>`);
        });
        html.push('</div>');
      });

      html.push('</section>');
    });

    container.innerHTML = html.join('');

    // 「良好」を一括で入れるボタンを各グループ先頭に付ける（現場の入力を速くする）
    util.$$('.card.group', container).forEach(card => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-all-ok';
      btn.textContent = 'この区分をすべて「良好」';
      btn.addEventListener('click', () => {
        util.$$('.item', card).forEach(it => {
          const r = it.querySelector('input[value="OK"]');
          if (r) r.checked = true;
        });
        updateProgress(container);
      });
      card.querySelector('h2').insertAdjacentElement('afterend', btn);
    });

    // 「まとめて該当なし」：その中分類の項目をすべて「該当なし」にする
    container.addEventListener('click', e => {
      const btn = e.target.closest('.unit-na');
      if (!btn) return;
      util.$$('.item input[value="NA"]', btn.closest('.unit-block')).forEach(r => { r.checked = true; });
      updateProgress(container);
    });

    // 「整備 ▾」を押すと整備記号の段を開く／閉じる
    container.addEventListener('click', e => {
      const more = e.target.closest('.judge-more');
      if (!more) return;
      const panel = more.closest('.item').querySelector('.judge-actions');
      panel.hidden = !panel.hidden;
      more.setAttribute('aria-expanded', String(!panel.hidden));
    });

    container.addEventListener('change', () => updateProgress(container));
    updateProgress(container);
  }

  /**
   * 項目の見た目を選択状態に合わせる。
   *   整備記号を選んでいる … 2段目を開いたままにし、ボタンに記号を表示
   *   良好／省略を選んだ  … 2段目を閉じる
   *   まだ何も選んでいない … 利用者が開いた状態をそのまま保つ
   */
  function syncItem(it) {
    it.querySelectorAll('.judge-opt').forEach(l => l.classList.toggle('on', l.querySelector('input').checked));
    const checked = it.querySelector('input[type=radio]:checked');
    const more  = it.querySelector('.judge-more');
    const panel = it.querySelector('.judge-actions');
    if (!more || !panel || !checked) return;

    const isAction = !!checked.closest('.judge-actions');
    if (isAction) {
      const lab = checked.closest('label');
      more.textContent = `${lab.querySelector('.mark').textContent}${lab.querySelector('.txt').textContent} ▾`;
      more.classList.add('selected');
      panel.hidden = false;
    } else {
      more.textContent = '整備 ▾';
      more.classList.remove('selected');
      panel.hidden = true;
    }
    more.setAttribute('aria-expanded', String(!panel.hidden));
  }

  /** 定義の targets から、○で囲める車種だけを取り出す */
  function targetOptions(spec) {
    const out = [];
    (spec.targets || []).forEach(line => line.forEach(seg => { if (seg && typeof seg === 'object') out.push(seg); }));
    return out;
  }

  /** 管理番号の記号（DC4-0012 → DC4）から、対象車種を推定する。見つからなければ null */
  function guessTarget(spec, vehicleId) {
    const prefix = util.prefixOf(util.normalizeVehicleId(vehicleId));
    return targetOptions(spec).find(t => (t.prefixes || []).includes(prefix)) || null;
  }

  /** 入力の進み具合を数える */
  function updateProgress(container) {
    const items = util.$$('.item', container);
    const done  = items.filter(it => it.querySelector('input[type=radio]:checked'));
    items.forEach(it => {
      it.classList.toggle('filled', !!it.querySelector('input[type=radio]:checked'));
      const checked = it.querySelector('input[type=radio]:checked');
      it.classList.toggle('warn', !!checked && !['OK', 'SKIP', 'NA'].includes(checked.value));
      syncItem(it);
    });
    const ev = new CustomEvent('vis:progress', { detail: { done: done.length, total: items.length } });
    container.dispatchEvent(ev);
    return { done: done.length, total: items.length };
  }

  /**
   * フォームの入力内容を集める。
   * @returns {{preChecks:Object, results:Object[], summary:Object}}
   */
  function collect(container, def, cycle) {
    const spec  = def.cycles[cycle];
    const codeMap = {};
    def.judgementCodes.forEach(c => { codeMap[c.code] = c; });

    const targetEl = container.querySelector('input[name="target"]:checked');
    const targetDef = targetEl ? targetOptions(spec).find(t => t.id === targetEl.value) : null;
    const target = targetDef ? { id: targetDef.id, text: targetDef.text } : null;

    const preChecks = {};
    def.preChecks.forEach(pc => {
      const el = container.querySelector(`input[name="pre_${pc.id}"]:checked`);
      preChecks[pc.id] = { label: pc.label, value: el ? el.value : '' };
    });

    const results = [];
    spec.groups.forEach(group => {
      group.units.forEach(unit => {
        unit.items.forEach(item => {
          const el   = container.querySelector(`input[name="item_${item.id}"]:checked`);
          const code = el ? el.value : '';
          results.push({
            groupName: group.name,
            unitName:  unit.name || '',
            itemId:    item.id,
            label:     item.label,
            code:      code,
            mark:      code ? codeMap[code].mark  : '',
            judgement: code ? codeMap[code].label : ''
          });
        });
      });
    });

    const unfilled = results.filter(r => !r.code);
    const actions  = results.filter(r => r.code && codeMap[r.code].type === 'action');
    const skipped  = results.filter(r => r.code === 'SKIP');
    const notApplicable = results.filter(r => r.code === 'NA');

    return {
      target,
      preChecks,
      results,
      summary: {
        total:        results.length,
        unfilled:     unfilled.length,
        actionCount:  actions.length,
        skipCount:    skipped.length,
        naCount:      notApplicable.length,
        // 記録簿の△修理・×交換・Ａ調整などは「点検時に実施した整備」を表す記号。
        // 未解決の不具合ではないので「要整備」ではなく「整備実施あり」と表記する。
        overall:      actions.length === 0 ? '良好' : '整備実施あり',
        actionItems:  actions.map(a => `${a.groupName}／${a.label}：${a.judgement}`)
      }
    };
  }

  /** 未入力の項目へ画面をスクロールする */
  function focusFirstUnfilled(container) {
    const el = util.$$('.item', container).find(it => !it.querySelector('input[type=radio]:checked'));
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1200);
    }
    return el;
  }

  VIS.form = { loadDefinition, render, collect, updateProgress, focusFirstUnfilled, guessTarget, targetOptions };

})(window);
