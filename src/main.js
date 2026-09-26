/**
 * main.js
 * 演示页启动：检测 → Worker 分析 → 激活（polyfill 优先于组件升级）→ 水合 → 事件日志。
 */

import {
  supportsDeclarativeShadowDOM,
  supportsShadowDOM,
  activateDeclarativeShadowDOM,
  createTemplateAnalyzer,
} from './dsd.js';
import { createEnvelope } from './hydration-core.js';

const $ = (sel) => document.querySelector(sel);
const eventLog = $('#event-log');
const analysisLog = $('#analysis-log');

function logEvent(kind, message, cls = '') {
  const line = document.createElement('div');
  line.className = cls;
  line.textContent = `[${new Date().toLocaleTimeString()}] [${kind}] ${message}`;
  eventLog.prepend(line);
}

/* 1. 环境检测 */
const nativeDsd = supportsDeclarativeShadowDOM();
const shadowDom = supportsShadowDOM();
$('#support-status').innerHTML = [
  `Declarative Shadow DOM：${nativeDsd ? '<span class="ok">原生支持</span>' : '<span class="warn">不支持 → 启用 JS polyfill 降级</span>'}`,
  `Shadow DOM：${shadowDom ? '<span class="ok">支持</span>' : '<span class="err">不支持（无法降级）</span>'}`,
  `Web Worker：${typeof Worker !== 'undefined' ? '<span class="ok">支持</span>' : '<span class="warn">不支持 → 主线程分析</span>'}`,
  `IndexedDB：${typeof indexedDB !== 'undefined' ? '<span class="ok">支持</span>' : '<span class="warn">不支持 → 内存降级</span>'}`,
].join('<br>');

/* 2. Worker 模板分析（对页面中静态模板源码做静态检查） */
const analyzer = createTemplateAnalyzer({
  workerUrl: new URL('./worker/template-worker.js', import.meta.url),
});

async function analyzeExistingTemplates() {
  const templates = document.querySelectorAll('template[shadowrootmode]');
  if (templates.length === 0 && nativeDsd) {
    analysisLog.innerHTML = '<span class="ok">原生 DSD 已在解析期消费所有模板；动态插入的模板将实时分析。</span><br>';
    return;
  }
  for (const template of templates) {
    const host = template.parentNode;
    const result = await analyzer.analyze(template.innerHTML ? `<template shadowrootmode="${template.getAttribute('shadowrootmode')}">${template.innerHTML}</template>` : '', host?.innerHTML ?? '');
    reportAnalysis('现有模板', result);
  }
}

function reportAnalysis(label, result) {
  const head = document.createElement('div');
  head.innerHTML = `${label}：${result.ok ? '<span class="ok">分析通过</span>' : '<span class="err">发现问题</span>'}（${analyzer.usingWorker ? 'Web Worker' : '主线程'}）`;
  analysisLog.append(head);
  for (const d of result.diagnostics) {
    const line = document.createElement('div');
    line.className = d.severity === 'error' ? 'err' : 'warn';
    line.textContent = `  [${d.severity}/${d.code}] ${d.message}`;
    analysisLog.append(line);
    logEvent('analysis', `${d.code}: ${d.message}`, line.className);
  }
}

/* 3. 激活（在组件定义/升级之前执行，保证 polyfill 先生效） */
const stats = activateDeclarativeShadowDOM(document);
logEvent('activate', `native=${stats.native} 激活=${stats.activated} 已激活=${stats.alreadyActive} 失败=${stats.failed}`,
  stats.failed > 0 ? 'err' : 'ok');

/* 4. 组件升级（动态 import 确保激活先于升级） */
const { sharedStore } = await import('./components.js');

/* 5. 事件监听：冒泡穿过 Shadow DOM 的 composed 事件 */
document.addEventListener('counter-changed', (e) => {
  logEvent('event', `counter-changed count=${e.detail.count} target=<${e.target.localName}> path深度=${e.composedPath().length}`);
});
document.addEventListener('hydration-mismatch', (e) => {
  logEvent('hydration', `状态不一致 id=${e.detail.id} source=${e.detail.source} reason=${e.detail.reason}`, 'err');
});
document.addEventListener('dsd-error', (e) => {
  logEvent('error', `${e.detail.context}: ${e.detail.message}`, 'err');
});
document.addEventListener('state-changed', (e) => {
  logEvent('persist', `状态已变更并计划持久化 id=${e.detail.id} ${JSON.stringify(e.detail.state)}`);
});

await analyzeExistingTemplates();

// 水合结果汇报
for (const el of document.querySelectorAll('demo-counter, demo-card')) {
  const report = () => logEvent('hydration', `<${el.localName}#${el.id || el.getAttribute('state-id') || '?'}> 渲染方式=${el.dataset.dsdRender} 水合来源=${el.dataset.hydratedFrom ?? '…'}`);
  if (el.dataset.hydratedFrom) report();
  else setTimeout(report, 300);
}

/* 6. 交互按钮 */
$('#btn-reactivate').addEventListener('click', () => {
  const again = activateDeclarativeShadowDOM(document);
  logEvent('activate', `重复激活：激活=${again.activated} 已激活=${again.alreadyActive} 失败=${again.failed}（应不崩溃）`, 'ok');
});

$('#btn-clear-store').addEventListener('click', async () => {
  await sharedStore.clear();
  logEvent('store', `IndexedDB 已清空（持久化=${sharedStore.persistent}）`, 'warn');
});

$('#btn-corrupt').addEventListener('click', async () => {
  const good = createEnvelope({ count: 999 });
  await sharedStore.set('main-counter', { ...good, checksum: 'deadbeef' });
  logEvent('store', '已写入校验和损坏的状态，刷新页面观察水合不一致处理', 'warn');
});

$('#btn-insert-dynamic').addEventListener('click', async () => {
  // 在分离子树中构建 → polyfill 激活 → 再挂载，演示动态内容的完整激活链路
  const staging = document.createElement('div');
  staging.innerHTML = `
    <div class="polyfill-host">
      <template shadowrootmode="open">
        <style>.box { padding: .6rem; border: 1px dashed #7c6cff; border-radius: 8px; color: #7ee787; }</style>
        <div class="box">动态插入的模板已被 <b>polyfill</b> 激活（shadow root 隔离样式）。</div>
      </template>
    </div>`;
  const templateHtml = staging.querySelector('template').outerHTML;
  const result = await analyzer.analyze(templateHtml, '');
  reportAnalysis('动态模板', result);
  const stats2 = activateDeclarativeShadowDOM(staging);
  $('#dynamic-zone').append(...staging.childNodes);
  logEvent('activate', `动态模板激活=${stats2.activated} 失败=${stats2.failed}`, stats2.failed ? 'err' : 'ok');
});

$('#btn-insert-broken').addEventListener('click', async () => {
  const staging = document.createElement('div');
  staging.innerHTML = `
    <div class="broken-host">
      <template shadowrootmode="bogus">
        <slot name="nowhere"></slot>
        <div>未闭合的模板
      </template>
    </div>`;
  const result = await analyzer.analyze(staging.querySelector('template').outerHTML, '<span slot="missing"></span>');
  reportAnalysis('损坏模板', result);
  const stats2 = activateDeclarativeShadowDOM(staging);
  $('#dynamic-zone').append(...staging.childNodes);
  logEvent('activate', `损坏模板：激活=${stats2.activated} 失败=${stats2.failed}（已提示，不中断其它模板）`, 'warn');
});
