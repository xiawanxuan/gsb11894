/**
 * dsd.js
 * Declarative Shadow DOM 核心：特性检测、激活、降级 polyfill、防重复激活。
 */

import { analyzeTemplate, VALID_SHADOW_ROOT_MODES } from './template-analyzer.js';

/** 标准特性检测：解析器是否原生消费 <template shadowrootmode>。 */
export function supportsDeclarativeShadowDOM() {
  return Object.prototype.hasOwnProperty.call(HTMLTemplateElement.prototype, 'shadowRootMode');
}

/** 是否至少支持命令式 Shadow DOM（降级方案的前提）。 */
export function supportsShadowDOM() {
  const probe = document.createElement('div');
  return typeof probe.attachShadow === 'function';
}

export const ACTIVATED_ATTR = 'data-dsd-activated';
const activatedHosts = new WeakSet();

function reportError(errors, context, error) {
  const entry = { context, message: error?.message ?? String(error), at: Date.now() };
  errors.push(entry);
  console.error(`[dsd] ${context}:`, error);
  document.dispatchEvent(new CustomEvent('dsd-error', { detail: entry }));
}

/**
 * 激活单个 <template shadowrootmode>（含嵌套模板的递归激活）。
 * 幂等：重复调用返回 already-active，不抛异常。
 */
export function activateTemplate(template, { errors = [] } = {}) {
  const host = template.parentNode;
  if (!host) return { status: 'error', reason: 'no-host' };

  if (activatedHosts.has(host) || host.getAttribute?.(ACTIVATED_ATTR) === 'true') {
    return { status: 'already-active' };
  }

  const mode = template.getAttribute('shadowrootmode');
  if (!VALID_SHADOW_ROOT_MODES.includes(mode)) {
    reportError(errors, 'invalid-shadowrootmode', new Error(`非法 shadowrootmode: "${mode}"`));
    return { status: 'error', reason: 'invalid-shadowrootmode' };
  }

  let shadowRoot;
  try {
    shadowRoot = host.attachShadow({ mode });
  } catch (error) {
    // 宿主已有 shadow root（例如重复激活）：视为已激活，不崩溃
    activatedHosts.add(host);
    host.setAttribute?.(ACTIVATED_ATTR, 'true');
    return { status: 'already-active' };
  }

  try {
    shadowRoot.append(template.content);
    template.remove();
  } catch (error) {
    reportError(errors, 'template-parse-failed', error);
    return { status: 'error', reason: 'parse-failed', error };
  }

  activatedHosts.add(host);
  host.setAttribute?.(ACTIVATED_ATTR, 'true');

  // 嵌套 Shadow DOM：递归激活 shadow root 内部的模板
  const nested = shadowRoot.querySelectorAll('template[shadowrootmode]');
  let nestedCount = 0;
  for (const inner of nested) {
    const result = activateTemplate(inner, { errors });
    if (result.status === 'activated') nestedCount += 1;
  }

  return { status: 'activated', shadowRoot, nestedCount };
}

/**
 * 扫描并激活 root 下所有尚未激活的 DSD 模板。
 * 返回统计信息；可安全重复调用。
 */
export function activateDeclarativeShadowDOM(root = document) {
  const errors = [];
  const stats = { native: supportsDeclarativeShadowDOM(), activated: 0, alreadyActive: 0, failed: 0, errors };

  if (!supportsShadowDOM()) {
    reportError(errors, 'no-shadow-dom', new Error('当前环境不支持 Shadow DOM，无法降级'));
    stats.failed = -1;
    return stats;
  }

  const templates = root.querySelectorAll('template[shadowrootmode]');
  for (const template of templates) {
    const result = activateTemplate(template, { errors });
    if (result.status === 'activated') stats.activated += 1;
    else if (result.status === 'already-active') stats.alreadyActive += 1;
    else stats.failed += 1;
  }
  return stats;
}

/** 序列化（含 shadow root）为规范化字符串，用于一致性对比。 */
export function serializeWithShadow(node) {
  const parts = [];
  const walk = (current, depth) => {
    const indent = '  '.repeat(depth);
    if (current.nodeType === Node.TEXT_NODE) {
      const text = current.textContent.trim();
      if (text) parts.push(`${indent}#text ${JSON.stringify(text)}`);
      return;
    }
    if (current.nodeType !== Node.ELEMENT_NODE && current.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return;
    if (current.nodeType === Node.ELEMENT_NODE) {
      const attrs = [...current.attributes]
        .map((a) => `${a.name}=${JSON.stringify(a.value)}`)
        .sort()
        .join(' ');
      parts.push(`${indent}<${current.localName}${attrs ? ` ${attrs}` : ''}>`);
    } else {
      parts.push(`${indent}#shadow-root`);
    }
    for (const child of current.childNodes) walk(child, depth + 1);
    const shadow = current.shadowRoot;
    if (shadow) walk(shadow, depth + 1);
  };
  walk(node, 0);
  return parts.join('\n');
}

/**
 * 模板分析客户端：优先用 Web Worker 离线分析，Worker 不可用时回退主线程。
 */
export function createTemplateAnalyzer({ workerUrl } = {}) {
  let worker = null;
  let seq = 0;
  const pending = new Map();

  if (typeof Worker !== 'undefined' && workerUrl) {
    try {
      worker = new Worker(workerUrl, { type: 'module' });
      worker.onmessage = (event) => {
        const { id, result } = event.data;
        const entry = pending.get(id);
        if (entry) {
          pending.delete(id);
          entry.resolve(result);
        }
      };
      worker.onerror = (error) => {
        console.warn('[dsd] 模板分析 Worker 失败，回退主线程分析', error);
        worker = null;
        for (const entry of pending.values()) entry.fallback();
        pending.clear();
      };
    } catch {
      worker = null;
    }
  }

  const analyze = (templateHtml, lightDomHtml = '') => {
    if (!worker) return Promise.resolve(analyzeTemplate(templateHtml, { lightDomHtml }));
    const id = ++seq;
    return new Promise((resolve) => {
      pending.set(id, {
        resolve,
        fallback: () => resolve(analyzeTemplate(templateHtml, { lightDomHtml })),
      });
      worker.postMessage({ id, templateHtml, lightDomHtml });
    });
  };

  return { analyze, get usingWorker() { return worker !== null; } };
}
