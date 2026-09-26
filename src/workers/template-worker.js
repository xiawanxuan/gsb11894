/**
 * Web Worker: validates DSD template sources off the main thread.
 * Receives {id, html}, replies {id, report}.
 */
import { validateTemplateSource } from '../template-validator.js';

self.onmessage = (event) => {
  const { id, html } = event.data || {};
  try {
    const report = validateTemplateSource(html);
    self.postMessage({ id, report });
  } catch (err) {
    self.postMessage({
      id,
      report: { ok: false, errors: [`Worker 校验异常：${err.message}`], warnings: [], slots: [], nestedCount: 0, mode: null },
    });
  }
};
