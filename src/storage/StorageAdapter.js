/* =============================================================================
 * StorageAdapter.js  ―― 保存先を切り替えるための「インターフェース（約束事）」
 * -----------------------------------------------------------------------------
 * 02の点検アプリと同じ考え方です。画面のプログラムはこのクラスで決めた
 * メソッドだけを呼び、実際の保存処理は下のアダプタが担当します。
 *
 *      画面(inspect.html など)
 *            ↓  ここで定義したメソッドしか呼ばない
 *      StorageAdapter（この抽象クラス）
 *            ↓
 *      ├─ LocalStorageAdapter   （今回：この端末のブラウザ内に保存。外部へは送らない）
 *      └─ ★将来 SharePointAdapter などを足せば、社内の保存先に送れるようになる
 *
 * OCR版は車両マスタを持たないので、02にあった getVehicle / importVehicles などは
 * ありません。点検記録の保存・取得だけです。
 * ========================================================================== */

(function (global) {
  'use strict';

  class StorageAdapter {

    /** アダプタ名（画面に表示して、今どこに保存しているか分かるようにする） */
    get name() { return 'StorageAdapter(未実装)'; }

    /** 接続の初期化。アプリ起動時に1回だけ呼ばれます。 */
    async init() { this._notImplemented('init'); }

    /**
     * 点検記録を1件保存する。点検記録PDFもここで一緒に預けます。
     * @param {Object} record  点検結果本体（JSON）
     * @param {Blob}   pdfBlob 生成済みの点検記録PDF
     * @returns {Promise<{inspectionId:string}>}
     */
    async saveInspection(record, pdfBlob) { this._notImplemented('saveInspection'); }

    /** 点検記録を1件取得する（無ければ null） */
    async getInspection(inspectionId) { this._notImplemented('getInspection'); }

    /** 指定した管理番号の点検記録を新しい順に返す */
    async listInspections(vehicleId, limit) { this._notImplemented('listInspections'); }

    /** 指定した管理番号の直近の点検記録（無ければ null） */
    async getLatestInspection(vehicleId) {
      const rows = await this.listInspections(vehicleId, 1);
      return rows[0] || null;
    }

    /** すべての車両の点検記録を新しい順に返す（トップ画面の一覧用） */
    async listRecent(limit) { this._notImplemented('listRecent'); }

    /** 点検記録のPDFを取り出す（無ければ null） */
    async getPdf(record) { this._notImplemented('getPdf'); }

    /** 点検記録を削除する（端末の容量整理用） */
    async deleteInspection(inspectionId) { this._notImplemented('deleteInspection'); }

    _notImplemented(method) {
      throw new Error(`${this.constructor.name}.${method}() が実装されていません`);
    }
  }

  global.VIS = global.VIS || {};
  global.VIS.StorageAdapter = StorageAdapter;

})(window);