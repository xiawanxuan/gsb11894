/**
 * Main-thread bridge to the template validation worker.
 * Falls back to synchronous main-thread validation when Workers
 * (or module workers) are unavailable.
 */
import { validateTemplateSource } from './template-validator.js';

let worker = null;
let workerFailed = false;
let nextId = 0;
const pending = new Map();

function getWorker() {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./workers/template-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (event) => {
      const { id, report } = event.data || {};
      const resolve = pending.get(id);
      if (resolve) {
        pending.delete(id);
        resolve(report);
      }
    };
    worker.onerror = () => {
      workerFailed = true;
      worker = null;
      for (const resolve of pending.values()) {
        resolve(validateTemplateSource(''));
      }
      pending.clear();
    };
  } catch {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

/**
 * Validate a template source, preferably in a Web Worker.
 * @param {string} html
 * @returns {Promise<object>} validation report (see template-validator.js)
 */
export function validateTemplate(html) {
  const w = getWorker();
  if (!w) {
    return Promise.resolve(validateTemplateSource(html));
  }
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    w.postMessage({ id, html });
  });
}
