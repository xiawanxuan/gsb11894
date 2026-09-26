/**
 * idb-store.js
 * IndexedDB 水合状态仓库；环境不支持 IndexedDB 时自动降级为内存 Map。
 */

const DB_NAME = 'dsd-hydration';
const STORE_NAME = 'state';

export class HydrationStore {
  constructor({ dbName = DB_NAME, storeName = STORE_NAME } = {}) {
    this.dbName = dbName;
    this.storeName = storeName;
    this.dbPromise = null;
    this.memoryFallback = null;
    if (typeof indexedDB === 'undefined') {
      this.memoryFallback = new Map();
    }
  }

  get persistent() {
    return this.memoryFallback === null;
  }

  openDb() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(this.storeName, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }

  async set(id, envelope) {
    if (this.memoryFallback) {
      this.memoryFallback.set(id, structuredClone(envelope));
      return;
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).put({ id, ...envelope });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async get(id) {
    if (this.memoryFallback) {
      const hit = this.memoryFallback.get(id);
      return hit ? structuredClone(hit) : null;
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const request = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async delete(id) {
    if (this.memoryFallback) {
      this.memoryFallback.delete(id);
      return;
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear() {
    if (this.memoryFallback) {
      this.memoryFallback.clear();
      return;
    }
    const db = await this.openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      tx.objectStore(this.storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}
