/**
 * Hydration state persistence backed by IndexedDB, with an in-memory
 * fallback when IndexedDB is unavailable (隐私模式 / 老浏览器).
 */
import { supportsIndexedDB } from './dsd-support.js';

const DB_NAME = 'dsd-hydration';
const STORE = 'component-state';

const memoryFallback = new Map();

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
function getDB() {
  if (!supportsIndexedDB()) return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = openDB().catch(() => null);
  }
  return dbPromise;
}

export async function saveState(id, state) {
  const db = await getDB();
  if (!db) {
    memoryFallback.set(id, structuredClone(state));
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(state, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadState(id) {
  const db = await getDB();
  if (!db) {
    return memoryFallback.has(id) ? structuredClone(memoryFallback.get(id)) : null;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function clearState(id) {
  const db = await getDB();
  if (!db) {
    memoryFallback.delete(id);
    return;
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
