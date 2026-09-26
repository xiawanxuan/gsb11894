/**
 * Pure-logic validator for Declarative Shadow DOM template sources.
 * Runs in Web Workers (no DOM needed) and in Node for tests.
 */

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const FORBIDDEN_ELEMENTS = new Set(['script', 'iframe', 'object']);

const TAG_RE = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s<>"'=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const ATTR_RE = /([^\s<>"'=]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;

function parseAttrs(attrText) {
  const attrs = {};
  let match;
  ATTR_RE.lastIndex = 0;
  while ((match = ATTR_RE.exec(attrText)) !== null) {
    attrs[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[5] ?? '';
  }
  return attrs;
}

/**
 * Validate a `<template shadowrootmode>` HTML source string.
 * @param {string} html
 * @returns {{ok: boolean, errors: string[], warnings: string[],
 *            slots: string[], nestedCount: number, mode: string|null}}
 */
export function validateTemplateSource(html) {
  const errors = [];
  const warnings = [];
  const slots = [];
  let mode = null;
  let nestedCount = 0;

  if (typeof html !== 'string' || html.trim() === '') {
    return { ok: false, errors: ['模板内容为空'], warnings, slots, nestedCount, mode };
  }

  const stack = [];
  let sawRootTemplate = false;
  let match;
  TAG_RE.lastIndex = 0;

  while ((match = TAG_RE.exec(html)) !== null) {
    const [, rawName, attrText, selfClose] = match;
    const name = rawName.toLowerCase();
    const isClose = match[0].startsWith('</');
    const attrs = parseAttrs(attrText || '');

    if (isClose) {
      if (VOID_ELEMENTS.has(name)) continue;
      const top = stack.pop();
      if (top !== name) {
        errors.push(
          top === undefined
            ? `多余的闭合标签 </${name}>`
            : `标签不匹配：期望 </${top}>，实际 </${name}>`,
        );
      }
      continue;
    }

    if (FORBIDDEN_ELEMENTS.has(name)) {
      errors.push(`模板中禁止出现 <${name}> 元素`);
    }

    if (name === 'template' && ('shadowrootmode' in attrs)) {
      const m = attrs.shadowrootmode;
      if (!sawRootTemplate) {
        sawRootTemplate = true;
        if (m !== 'open' && m !== 'closed') {
          errors.push(`shadowrootmode 值非法："${m}"（应为 open 或 closed）`);
        } else {
          mode = m;
        }
      } else {
        nestedCount += 1;
      }
    }

    if (name === 'slot') {
      const slotName = attrs.name ?? '';
      if (slots.includes(slotName)) {
        warnings.push(
          slotName
            ? `重复的命名插槽 "${slotName}"，可能导致插槽错位`
            : '存在多个默认插槽，可能导致插槽错位',
        );
      }
      slots.push(slotName);
    }

    if (!VOID_ELEMENTS.has(name) && !selfClose) {
      stack.push(name);
    }
  }

  for (const unclosed of stack) {
    errors.push(`标签 <${unclosed}> 未闭合`);
  }

  if (!sawRootTemplate) {
    errors.push('缺少 shadowrootmode 属性，不是 Declarative Shadow DOM 模板');
  }

  return { ok: errors.length === 0, errors, warnings, slots, nestedCount, mode };
}
