/**
 * DSD activator: finds inert `<template shadowrootmode>` templates and
 * attaches real shadow roots from them. This doubles as the fallback
 * (降级方案) for browsers without native Declarative Shadow DOM, and as
 * the activation path for dynamically injected DSD markup.
 *
 * Guarantees:
 *  - 重复激活不崩：hosts that already have a shadow root are skipped.
 *  - 解析失败有提示：invalid templates produce an in-page error notice
 *    plus a `dsd:error` event.
 *  - 插槽错位检测：light-DOM slot attributes are checked against the
 *    template's slots and optionally repaired.
 *  - 嵌套 Shadow DOM：templates inside activated shadow roots are
 *    processed recursively.
 */
import { validateTemplate } from './worker-client.js';
import { validateTemplateSource } from './template-validator.js';
import { computeSlotAssignments } from './slot-matcher.js';

export const ACTIVATED_ATTR = 'data-dsd-activated';

function isShadowTemplate(node) {
  return (
    node instanceof HTMLTemplateElement &&
    node.hasAttribute('shadowrootmode')
  );
}

function collectTemplates(root, out = []) {
  if (root.querySelectorAll) {
    for (const tpl of root.querySelectorAll('template[shadowrootmode]')) {
      out.push(tpl);
    }
  }
  return out;
}

function templateSource(tpl) {
  const clone = tpl.cloneNode(true);
  const wrapper = clone.ownerDocument.createElement('div');
  wrapper.appendChild(clone);
  return wrapper.innerHTML;
}

function reportError(host, tpl, message, errors, result) {
  const entry = { host, message, errors };
  result.errors.push(entry);
  const notice = document.createElement('div');
  notice.className = 'dsd-error-notice';
  notice.setAttribute('role', 'alert');
  notice.textContent = `Shadow DOM 模板解析失败：${message}`;
  tpl.replaceWith(notice);
  host.dispatchEvent(
    new CustomEvent('dsd:error', { bubbles: true, composed: true, detail: entry }),
  );
}

function validateSlots(host, shadowRoot, repair, result) {
  const slots = [...shadowRoot.querySelectorAll('slot')].map((s) => s.name || '');
  const lightChildren = [...host.children].map((el) => ({ slot: el.getAttribute('slot') }));
  if (lightChildren.length === 0) return;
  const { assignments, mismatches } = computeSlotAssignments(lightChildren, slots);
  for (const msg of mismatches) {
    result.warnings.push({ host, message: msg });
    host.dispatchEvent(
      new CustomEvent('dsd:slot-mismatch', { bubbles: true, composed: true, detail: { message: msg } }),
    );
  }
  if (repair) {
    assignments.forEach(({ child, slot, repaired }) => {
      if (!repaired) return;
      const el = host.children[child];
      if (!el) return;
      if (slot === '') el.removeAttribute('slot');
      else el.setAttribute('slot', slot);
    });
  }
}

async function activateOne(tpl, options, result) {
  const host = tpl.parentNode instanceof ShadowRoot ? tpl.parentNode.host : tpl.parentElement;
  if (!host) {
    result.errors.push({ host: null, message: '模板没有可用的宿主元素', errors: [] });
    tpl.remove();
    return;
  }

  if (host.shadowRoot || host.hasAttribute(ACTIVATED_ATTR)) {
    result.skipped += 1;
    tpl.remove();
    host.dispatchEvent(
      new CustomEvent('dsd:skipped', { bubbles: true, composed: true, detail: { reason: 'already-activated' } }),
    );
    return;
  }

  const mode = tpl.getAttribute('shadowrootmode');
  if (mode !== 'open' && mode !== 'closed') {
    reportError(host, tpl, `shadowrootmode 值非法："${mode}"`, [`非法的 shadowrootmode: ${mode}`], result);
    return;
  }

  if (options.validate !== false) {
    const report = options.validateSync
      ? validateTemplateSource(templateSource(tpl))
      : await validateTemplate(templateSource(tpl));
    if (!report.ok) {
      reportError(host, tpl, report.errors[0] ?? '未知错误', report.errors, result);
      return;
    }
    for (const warning of report.warnings) {
      result.warnings.push({ host, message: warning });
    }
  }

  let shadowRoot;
  try {
    shadowRoot = host.attachShadow({ mode });
  } catch (err) {
    reportError(host, tpl, `attachShadow 失败：${err.message}`, [err.message], result);
    return;
  }

  // Move (not clone) template content so <style> and <slot> stay live.
  shadowRoot.appendChild(tpl.content);
  tpl.remove();
  host.setAttribute(ACTIVATED_ATTR, '');

  validateSlots(host, shadowRoot, options.repairSlots !== false, result);

  result.activated += 1;
  host.dispatchEvent(
    new CustomEvent('dsd:activated', { bubbles: true, composed: true, detail: { mode } }),
  );

  // Recurse for nested shadow templates inside the new shadow root.
  await activateInto(shadowRoot, options, result);
}

async function activateInto(root, options, result) {
  const templates = collectTemplates(root);
  for (const tpl of templates) {
    if (isShadowTemplate(tpl)) {
      await activateOne(tpl, options, result);
    }
  }
}

/**
 * Activate all inert DSD templates under `root`.
 * @param {Document|Element|ShadowRoot} root
 * @param {{validate?: boolean, validateSync?: boolean, repairSlots?: boolean}} options
 * @returns {Promise<{activated: number, skipped: number,
 *          errors: Array, warnings: Array}>}
 */
export async function activateShadowRoots(root = document, options = {}) {
  const result = { activated: 0, skipped: 0, errors: [], warnings: [] };
  await activateInto(root, options, result);
  return result;
}

/**
 * Serialize a host's shadow DOM (including nested shadow roots) to HTML.
 * Used to verify that the JS fallback produces the same result as
 * native DSD parsing (降级方案结果一致).
 */
export function serializeShadowDOM(host) {
  const serializeChildren = (node) =>
    [...node.childNodes].map(serializeNode).join('');
  const serializeNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent;
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node;
    const attrs = [...el.attributes]
      .map((a) => ` ${a.name}="${a.value}"`)
      .join('');
    let inner = serializeChildren(el);
    if (el.shadowRoot) {
      inner =
        `<template shadowrootmode="${el.shadowRoot.mode}">` +
        serializeChildren(el.shadowRoot) +
        '</template>' +
        inner;
    }
    return `<${el.localName}${attrs}>${inner}</${el.localName}>`;
  };
  if (!host.shadowRoot) return '';
  return serializeChildren(host.shadowRoot);
}
