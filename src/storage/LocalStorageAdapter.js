/* =============================================================================
 * LocalStorageAdapter.js  ―― この端末のブラウザ内（IndexedDB）に保存する
 * -----------------------------------------------------------------------------
 * 点検記録とPDFは、点検したスマホの中にだけ保存されます。外部には送信しません。
 * 記録簿は「車載用コピーを印刷・共有」でPDFとして社内に提出・印刷します。
 *
 * ※ ブラウザの「履歴とWebサイトデータを消去」をすると、この記録も消えます。
 *    正式な記録は、共有・印刷したPDFの方です。
 * ========================================================================== */

(function (global) {
  'use strict';

  const DB_VERSION = 1;

  class LocalStorageAdapter extends global.VIS.StorageAdapter {

    get name() { return 'この端末に保存'; }

    async init() {
      this.dbName = (global.VIS.config && global.VIS.config.dbName) || 'vis-ocr';
      this.db = await this._openDb();
      return this;
    }

    _openDb() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(this.dbName, DB_VERSION);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          // 点検記録：inspectionId をキーに、管理番号でも探せるようにする
          if (!db.objectStoreNames.contains('inspections')) {
            const s = db.createObjectStore('inspections', { keyPath: 'inspectionId' });
            s.createIndex('byVehicle', 'vehicleId', { unique: false });
          }
          // 点検記録PDF
          if (!db.objectStoreNames.contains('files')) {
            db.createObjectStore('files', { keyPath: 'path' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
      });
    }

    _store(name, mode) {
      return this.db.transaction(name, mode).objectStore(name);
    }

    _wrap(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror   = () => reject(request.error);
      });
    }

    async saveInspection(record, pdfBlob) {
      const pdfPath = `inspections/${record.vehicleId}/${record.inspectionId}/record.pdf`;
      record.pdfPath = pdfBlob ? pdfPath : '';
      record.storedBy = this.name;

      // 記録とPDFを1回の処理でまとめて保存（片方だけ残ることがないように）
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(['inspections', 'files'], 'readwrite');
        if (pdfBlob) tx.objectStore('files').put({ path: pdfPath, blob: pdfBlob });
        tx.objectStore('inspections').put(record);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('保存が中断されました（端末の空き容量を確認してください）'));
      });

      // 端末の容量が少なくなってもブラウザが勝手に消さないようお願いしておく
      if (navigator.storage && navigator.storage.persist) {
        navigator.storage.persist().catch(() => {});
      }
      return { inspectionId: record.inspectionId };
    }

    async getInspection(inspectionId) {
      const r = await this._wrap(this._store('inspections', 'readonly').get(inspectionId));
      return r || null;
    }

    async listInspections(vehicleId, limit = 30) {
      const idx = this._store('inspections', 'readonly').index('byVehicle');
      const rows = await this._wrap(idx.getAll(IDBKeyRange.only(vehicleId)));
      rows.sort((a, b) => String(b.inspectedAt).localeCompare(String(a.inspectedAt)));
      return rows.slice(0, limit);
    }

    async listRecent(limit = 30) {
      const rows = await this._wrap(this._store('inspections', 'readonly').getAll());
      rows.sort((a, b) => String(b.inspectedAt).localeCompare(String(a.inspectedAt)));
      return limit ? rows.slice(0, limit) : rows;
    }

    async getPdf(record) {
      if (!record || !record.pdfPath) return null;
      const f = await this._wrap(this._store('files', 'readonly').get(record.pdfPath));
      return f ? f.blob : null;
    }

    async deleteInspection(inspectionId) {
      const rec = await this.getInspection(inspectionId);
      if (!rec) return;
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction(['inspections', 'files'], 'readwrite');
        tx.objectStore('inspections').delete(inspectionId);
        if (rec.pdfPath) tx.objectStore('files').delete(rec.pdfPath);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  global.VIS.LocalStorageAdapter = LocalStorageAdapter;

})(window);