/**
 * template-analyzer.js
 * 纯字符串级别的 Declarative Shadow DOM 模板静态分析。
 * 不依赖 DOM，因此可同时运行在：主线程 / Web Worker / Node 测试环境。
 */

export const VALID_SHADOW_ROOT_MODES = ['open', 'closed'];

export const SEVERITY = Object.freeze({
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info',
});

function makeDiagnostic(severity, code, message, detail = null) {
  return { severity, code, message, detail };
}

/** 从标签文本中解析属性（足以覆盖 shadowrootmode / name / slot 场景）。 */
export function parseAttributes(tagText) {
  const attrs = {};
  const attrRe = /([a-zA-Z_][\w-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;
  let match;
  while ((match = attrRe.exec(tagText)) !== null) {
    const name = match[1].toLowerCase();
    if (name === tagText.split(/\s/)[0].toLowerCase()) continue;
    const value = match[3] ?? match[4] ?? match[5] ?? '';
    attrs[name] = value;
  }
  return attrs;
}

/** 提取模板内声明的插槽名（匿名默认插槽用 '' 表示）。 */
export function extractDeclaredSlots(templateHtml) {
  const slots = [];
  const slotRe = /<slot\b([^>]*)>/gi;
  let match;
  while ((match = slotRe.exec(templateHtml)) !== null) {
    const attrs = parseAttributes(match[1]);
    slots.push(attrs.name ?? '');
  }
  return slots;
}

/** 提取 light DOM 子节点请求分配的插槽名。 */
export function extractRequestedSlots(lightDomHtml) {
  const requested = [];
  const slotAttrRe = /\bslot\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let match;
  while ((match = slotAttrRe.exec(lightDomHtml)) !== null) {
    requested.push(match[2] ?? match[3] ?? '');
  }
  return requested;
}

/** 检查指定标签的开闭是否配平（忽略自闭合与注释）。 */
export function checkTagBalance(html, tagName) {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
  const openRe = new RegExp(`<${tagName}\\b(?![^>]*/\\s*>)`, 'gi');
  const closeRe = new RegExp(`</${tagName}\\s*>`, 'gi');
  const opens = (stripped.match(openRe) || []).length;
  const closes = (stripped.match(closeRe) || []).length;
  return { opens, closes, balanced: opens === closes };
}

/**
 * 分析一段 DSD 模板（可选地对照其宿主 light DOM）。
 * 返回 { ok, diagnostics, declaredSlots, requestedSlots, mode }。
 */
export function analyzeTemplate(templateHtml, { lightDomHtml = '' } = {}) {
  const diagnostics = [];

  if (typeof templateHtml !== 'string' || templateHtml.trim() === '') {
    diagnostics.push(makeDiagnostic(SEVERITY.ERROR, 'empty-template', '模板内容为空'));
    return { ok: false, diagnostics, declaredSlots: [], requestedSlots: [], mode: null };
  }

  // 1. <template> 标签配平（嵌套模板解析失败的主要信号）
  const balance = checkTagBalance(templateHtml, 'template');
  if (!balance.balanced) {
    diagnostics.push(makeDiagnostic(
      SEVERITY.ERROR,
      'unbalanced-template',
      `<template> 标签不配平：开 ${balance.opens} 个 / 闭 ${balance.closes} 个`,
      balance,
    ));
  }

  // 2. shadowrootmode 属性校验
  const templateTagRe = /<template\b([^>]*)>/i;
  const firstTag = templateTagRe.exec(templateHtml);
  let mode = null;
  if (!firstTag) {
    diagnostics.push(makeDiagnostic(SEVERITY.ERROR, 'missing-template-tag', '未找到 <template> 起始标签'));
  } else {
    const attrs = parseAttributes(firstTag[1]);
    mode = attrs.shadowrootmode ?? null;
    if (mode === null) {
      diagnostics.push(makeDiagnostic(SEVERITY.ERROR, 'missing-shadowrootmode', '缺少 shadowrootmode 属性'));
    } else if (!VALID_SHADOW_ROOT_MODES.includes(mode)) {
      diagnostics.push(makeDiagnostic(
        SEVERITY.ERROR,
        'invalid-shadowrootmode',
        `shadowrootmode 值非法："${mode}"（仅支持 open/closed）`,
        { mode },
      ));
    }
  }

  // 3. 插槽声明与分发对齐
  const declaredSlots = extractDeclaredSlots(templateHtml);
  const requestedSlots = extractRequestedSlots(lightDomHtml);

  const seen = new Set();
  for (const name of declaredSlots) {
    if (seen.has(name)) {
      diagnostics.push(makeDiagnostic(
        SEVERITY.WARNING,
        'duplicate-slot',
        `模板中重复声明插槽 "${name || '(default)'}"，只有第一个会接收节点`,
        { name },
      ));
    }
    seen.add(name);
  }

  for (const name of requestedSlots) {
    if (!declaredSlots.includes(name)) {
      diagnostics.push(makeDiagnostic(
        SEVERITY.ERROR,
        'slot-mismatch',
        `light DOM 请求插槽 "${name}"，但模板未声明，该内容将不会渲染`,
        { name },
      ));
    }
  }

  for (const name of declaredSlots) {
    if (name !== '' && !requestedSlots.includes(name)) {
      diagnostics.push(makeDiagnostic(
        SEVERITY.WARNING,
        'slot-unassigned',
        `模板声明了插槽 "${name}"，但 light DOM 没有节点分配给它，将显示回退内容`,
        { name },
      ));
    }
  }

  const ok = !diagnostics.some((d) => d.severity === SEVERITY.ERROR);
  return { ok, diagnostics, declaredSlots, requestedSlots, mode };
}
