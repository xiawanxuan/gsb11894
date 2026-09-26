/**
 * template-worker.js
 * Web Worker：在后台线程做模板静态分析，避免阻塞主线程。
 */
import { analyzeTemplate } from '../template-analyzer.js';

self.onmessage = (event) => {
  const { id, templateHtml, lightDomHtml } = event.data;
  try {
    const result = analyzeTemplate(templateHtml, { lightDomHtml });
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({
      id,
      result: {
        ok: false,
        diagnostics: [{ severity: 'error', code: 'worker-crash', message: String(error), detail: null }],
        declaredSlots: [],
        requestedSlots: [],
        mode: null,
      },
    });
  }
};
