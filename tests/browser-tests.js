/**
 * browser-tests.js
 * 浏览器端验收测试：覆盖全部 9 条验收标准。
 * 结果渲染到页面，并暴露在 window.__TEST_RESULTS__。
 */

import {
  supportsDeclarativeShadowDOM,
  activateDeclarativeShadowDOM,
  activateTemplate,
  createTemplateAnalyzer,
  serializeWithShadow,
} from '../src/dsd.js';
import { createEnvelope } from '../src/hydration-core.js';
import { DemoCard, sharedStore } from '../src/components.js';

const sandbox = document.getElementById('sandbox');
const resultsEl = document.getElementById('results');
const summaryEl = document.getElementById('summary');
const results = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function test(name, fn) {
  const line = document.createElement('div');
  line.className = 'pending';
  line.textContent = `… ${name}`;
  resultsEl.append(line);
  try {
    await fn();
    line.className = 'pass';
    line.textContent = `✓ ${name}`;
    results.push({ name, ok: true });
  } catch (error) {
    line.className = 'fail';
    line.textContent = `✗ ${name} — ${error.message}`;
    results.push({ name, ok: false, error: error.message });
    console.error(error);
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEqual(a, b, msg) { if (a !== b) throw new Error(`${msg}（期望 ${JSON.stringify(b)}，实际 ${JSON.stringify(a)}）`); }

function makeHost(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  sandbox.append(host);
  return host;
}

async function waitHydrated(el, timeout = 2000) {
  const start = Date.now();
  while (!el.dataset.hydratedFrom) {
    if (Date.now() - start > timeout) throw new Error(`等待水合超时: ${el.localName}`);
    await sleep(20);
  }
  return el.dataset.hydratedFrom;
}

/* 1. 模板解析正确 */
await test('1. 模板解析正确（分析器 + 激活后结构）', async () => {
  const analyzer = createTemplateAnalyzer({
    workerUrl: new URL('../src/worker/template-worker.js', import.meta.url),
  });
  const html = '<template shadowrootmode="open"><style>.x{color:red}</style><slot name="a"></slot></template>';
  const analysis = await analyzer.analyze(html, '<span slot="a"></span>');
  assert(analysis.ok, `分析应通过: ${JSON.stringify(analysis.diagnostics)}`);
  assertEqual(analysis.mode, 'open', 'mode');

  const host = makeHost('<template shadowrootmode="open"><p id="inner">hello</p></template>');
  const stats = activateDeclarativeShadowDOM(sandbox);
  assert(stats.activated >= 1, '应至少激活一个模板');
  assert(host.shadowRoot, '宿主应有 shadow root');
  assertEqual(host.shadowRoot.querySelector('#inner').textContent, 'hello', 'shadow 内容');
});

/* 2. 插槽分发正确 */
await test('2. 插槽分发正确（具名 + 默认）', async () => {
  const host = makeHost(`
    <template shadowrootmode="open">
      <slot name="title"></slot><slot></slot>
    </template>
    <span slot="title">T</span><span class="body">B</span>`);
  activateDeclarativeShadowDOM(sandbox);
  const named = host.shadowRoot.querySelector('slot[name="title"]');
  const dflt = host.shadowRoot.querySelector('slot:not([name])');
  assertEqual(named.assignedNodes()[0].textContent, 'T', '具名插槽分发');
  assert(dflt.assignedNodes().some((n) => n.textContent === 'B'), '默认插槽应分到正文节点');
});

/* 3. 样式隔离正确 */
await test('3. 样式隔离正确（内不外泄 / 外不侵入）', async () => {
  const style = document.createElement('style');
  style.textContent = '.leak-test { color: rgb(4, 5, 6); }';
  document.head.append(style);

  const host = makeHost(`
    <template shadowrootmode="open">
      <style>.iso { color: rgb(1, 2, 3); }</style>
      <span class="iso">in</span><span class="leak-test">in2</span>
    </template>`);
  activateDeclarativeShadowDOM(sandbox);

  const outside = document.createElement('span');
  outside.className = 'iso';
  outside.textContent = 'out';
  sandbox.append(outside);

  const inner = host.shadowRoot.querySelector('.iso');
  assertEqual(getComputedStyle(inner).color, 'rgb(1, 2, 3)', 'shadow 内样式应生效');
  assert(getComputedStyle(outside).color !== 'rgb(1, 2, 3)', 'shadow 内样式不应外泄');
  assert(getComputedStyle(host.shadowRoot.querySelector('.leak-test')).color !== 'rgb(4, 5, 6)', '外部样式不应侵入 shadow');
  style.remove();
});

/* 4. 事件冒泡正确 */
await test('4. 事件冒泡正确（composed 跨界 / 目标重定向）', async () => {
  const host = makeHost(`
    <template shadowrootmode="open"><button id="btn" type="button">go</button></template>`);
  activateDeclarativeShadowDOM(sandbox);
  const btn = host.shadowRoot.querySelector('#btn');

  let seen = null;
  const onDoc = (e) => { seen = { target: e.target, path: e.composedPath() }; };
  document.addEventListener('test-composed', onDoc, { once: true });
  btn.dispatchEvent(new CustomEvent('test-composed', { bubbles: true, composed: true }));
  assert(seen, 'composed 事件应冒泡到 document');
  assertEqual(seen.path[0], btn, 'composedPath 起点应为内部按钮');
  assertEqual(seen.target, host, '跨边界后 target 应重定向为宿主');

  let leaked = false;
  document.addEventListener('test-noncomposed', () => { leaked = true; }, { once: true });
  btn.dispatchEvent(new CustomEvent('test-noncomposed', { bubbles: true, composed: false }));
  await sleep(10);
  assert(!leaked, '非 composed 事件不应穿出 shadow 边界');
});

/* 5. 水合状态一致 */
await test('5. 水合状态一致（持久化 → 恢复 → 损坏回退）', async () => {
  await sharedStore.clear();
  const id = `t5-${Date.now()}`;

  const first = document.createElement('demo-counter');
  first.setAttribute('state-id', id);
  sandbox.append(first);
  await waitHydrated(first);
  first.setState({ count: 5 });
  await sleep(400); // 等待防抖持久化

  const second = document.createElement('demo-counter');
  second.setAttribute('state-id', id);
  sandbox.append(second);
  assertEqual(await waitHydrated(second), 'indexeddb', '第二实例应从 IndexedDB 水合');
  assertEqual(second.shadowRoot.querySelector('.count').textContent, '5', '恢复后的计数');

  // 写入损坏状态 → 水合不一致 → 回退默认并发出事件
  const good = createEnvelope({ count: 9 });
  await sharedStore.set(id, { ...good, checksum: 'deadbeef' });
  let mismatch = null;
  document.addEventListener('hydration-mismatch', (e) => { mismatch = e.detail; }, { once: true });
  const third = document.createElement('demo-counter');
  third.setAttribute('state-id', id);
  sandbox.append(third);
  assertEqual(await waitHydrated(third), 'defaults', '损坏状态应回退默认值');
  assert(mismatch && mismatch.reason === 'checksum-mismatch', '应发出 checksum-mismatch 事件');
  assertEqual(third.shadowRoot.querySelector('.count').textContent, '0', '回退后计数为默认 0');
  first.remove(); second.remove(); third.remove();
});

/* 6. 不支持时有降级 */
await test('6. 不支持时有降级（polyfill 激活 inert 模板）', async () => {
  // 无论是否原生支持，innerHTML 插入的模板都是 inert 的，必须靠 polyfill 激活
  const host = makeHost('<template shadowrootmode="open"><b class="poly">polyfilled</b></template>');
  assert(!host.shadowRoot, '激活前不应有 shadow root');
  const stats = activateDeclarativeShadowDOM(sandbox);
  assert(host.shadowRoot, 'polyfill 应创建 shadow root');
  assertEqual(host.shadowRoot.querySelector('.poly').textContent, 'polyfilled', 'polyfill 内容');
  assert(stats.activated >= 1, '统计应记录激活');
  console.info(`原生 DSD 支持：${supportsDeclarativeShadowDOM()}（本测试验证的是降级路径本身）`);
});

/* 7. 解析失败有提示 */
await test('7. 解析失败有提示（错误事件 + 不中断其它模板）', async () => {
  const errors = [];
  const onErr = (e) => errors.push(e.detail);
  document.addEventListener('dsd-error', onErr);

  const bad = makeHost('<template shadowrootmode="bogus"><p>x</p></template>');
  const goodHost = makeHost('<template shadowrootmode="open"><p>ok</p></template>');
  const stats = activateDeclarativeShadowDOM(sandbox);
  document.removeEventListener('dsd-error', onErr);

  assert(stats.failed >= 1, '应记录失败');
  assert(errors.some((e) => e.context === 'invalid-shadowrootmode'), '应发出 invalid-shadowrootmode 错误提示');
  assert(goodHost.shadowRoot, '其它模板不应受影响');
  assert(!bad.shadowRoot, '坏模板不应产生 shadow root');

  const analyzer = createTemplateAnalyzer({});
  const analysis = await analyzer.analyze('<template shadowrootmode="open"><div></template>');
  assert(!analysis.ok, '不配平模板应分析失败');
  assert(analysis.diagnostics.some((d) => d.code === 'unbalanced-template'), '应报告标签不配平');
});

/* 8. 重复激活不崩 */
await test('8. 重复激活不崩（幂等）', async () => {
  const host = makeHost('<template shadowrootmode="open"><p>once</p></template>');
  const first = activateDeclarativeShadowDOM(sandbox);
  assert(first.activated >= 1, '首次应激活');
  const shadowBefore = host.shadowRoot;

  const second = activateDeclarativeShadowDOM(sandbox);
  const third = activateDeclarativeShadowDOM(sandbox);
  assertEqual(host.shadowRoot, shadowBefore, 'shadow root 应保持同一个');
  assertEqual(host.shadowRoot.querySelectorAll('p').length, 1, '内容不应重复挂载');

  // 同一宿主上再次出现模板（极端场景）→ attachShadow 抛错被捕获为 already-active
  const stray = document.createElement('template');
  stray.setAttribute('shadowrootmode', 'open');
  host.append(stray);
  const result = activateTemplate(stray);
  assertEqual(result.status, 'already-active', '已有 shadow root 的宿主应返回 already-active');
  stray.remove();
});

/* 9. 降级方案结果一致 */
await test('9. 降级方案结果一致（polyfill 激活 ≡ JS 渲染）', async () => {
  await sharedStore.clear();

  // 路径 A：组件 JS 渲染（无模板）
  const jsRendered = document.createElement('demo-card');
  sandbox.append(jsRendered);

  // 路径 B：polyfill 激活同样的模板
  const polyfilled = document.createElement('div');
  polyfilled.innerHTML = `<template shadowrootmode="open">${DemoCard.templateHTML}</template>`;
  sandbox.append(polyfilled);
  activateTemplate(polyfilled.querySelector('template'));

  // 等待两边嵌套组件水合完成
  const nestedA = jsRendered.shadowRoot.querySelector('demo-counter');
  const nestedB = polyfilled.shadowRoot.querySelector('demo-counter');
  await waitHydrated(nestedA);
  await waitHydrated(nestedB);

  const serA = serializeWithShadow(jsRendered.shadowRoot);
  const serB = serializeWithShadow(polyfilled.shadowRoot);
  assertEqual(serA, serB, '两种路径的 shadow DOM 序列化应一致');

  jsRendered.remove(); polyfilled.remove();
});

/* 汇总 */
const passed = results.filter((r) => r.ok).length;
summaryEl.className = passed === results.length ? 'pass' : 'fail';
summaryEl.textContent = `${passed}/${results.length} 通过 · 原生 DSD：${supportsDeclarativeShadowDOM() ? '是' : '否（已走降级）'}`;
window.__TEST_RESULTS__ = { passed, total: results.length, results };
