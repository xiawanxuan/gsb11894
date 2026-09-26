/**
 * Browser acceptance tests for the DSD pipeline.
 * Open tests/index.html via a static server; results render into the page
 * and are summarized in document.title for automation.
 */
import { detectEnvironment } from '../src/dsd-support.js';
import { activateShadowRoots, serializeShadowDOM } from '../src/dsd-activator.js';
import { hydrateComponent } from '../src/hydration.js';
import { saveState, clearState } from '../src/hydration-store.js';
import '../src/components/demo-card.js';

const results = [];
function assert(name, cond, extra = '') {
  results.push({ name, pass: !!cond, extra });
  const li = document.createElement('li');
  li.className = cond ? 'pass' : 'fail';
  li.textContent = `${cond ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`;
  document.getElementById('results').appendChild(li);
}

const nextTick = () => new Promise((r) => setTimeout(r, 0));

function makeHost(html) {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

const CARD_TEMPLATE = `
  <template shadowrootmode="open">
    <style>.inner { color: rgb(1, 2, 3); }</style>
    <div class="inner"><slot name="header"></slot><slot></slot></div>
  </template>`;

async function testTemplateParsing() {
  const host = makeHost(CARD_TEMPLATE);
  const r = await activateShadowRoots(host, { validateSync: true });
  assert('模板解析正确：JS 激活后生成 shadow root', host.shadowRoot && r.activated === 1);
  assert('模板内容移入 shadow（含 style）',
    host.shadowRoot.querySelector('style') && host.shadowRoot.querySelector('.inner'));
  host.remove();
}

async function testSlotDistribution() {
  const host = makeHost(`
    <template shadowrootmode="open">
      <slot name="header"></slot><slot></slot>
    </template>
    <span slot="header" id="h">H</span>
    <span id="d">D</span>`);
  await activateShadowRoots(host, { validateSync: true });
  const [named, dflt] = host.shadowRoot.querySelectorAll('slot');
  assert('插槽分发正确：命名插槽', named.assignedElements()[0]?.id === 'h');
  assert('插槽分发正确：默认插槽', dflt.assignedElements()[0]?.id === 'd');
  host.remove();
}

async function testSlotMisalignmentRepair() {
  let warned = false;
  const host = makeHost(`
    <template shadowrootmode="open"><slot name="header"></slot><slot></slot></template>
    <span slot="sidebar" id="mis">X</span>`);
  host.addEventListener('dsd:slot-mismatch', () => { warned = true; });
  await activateShadowRoots(host, { validateSync: true });
  const el = host.querySelector('#mis');
  assert('插槽错位：发出警告事件', warned);
  assert('插槽错位：重路由到默认插槽', !el.hasAttribute('slot'));
  const dflt = host.shadowRoot.querySelectorAll('slot')[1];
  assert('插槽错位：修复后正确分发', dflt.assignedElements()[0]?.id === 'mis');
  host.remove();
}

async function testStyleIsolation() {
  const style = document.createElement('style');
  style.textContent = '.iso { color: rgb(255, 0, 0); }';
  document.head.appendChild(style);
  const host = makeHost(`
    <template shadowrootmode="open">
      <style>.iso { color: rgb(0, 0, 255); }</style>
      <span class="iso" id="in">in</span>
    </template>
    <span class="iso" id="out">out</span>`);
  await activateShadowRoots(host, { validateSync: true });
  const inner = getComputedStyle(host.shadowRoot.querySelector('#in')).color;
  const outer = getComputedStyle(host.querySelector('#out')).color;
  assert('样式隔离：shadow 内样式不被全局覆盖', inner === 'rgb(0, 0, 255)', inner);
  assert('样式隔离：shadow 内样式不外泄', outer === 'rgb(255, 0, 0)', outer);
  host.remove();
  style.remove();
}

async function testEventBubbling() {
  await clearState('hydration:test-card-events');
  const card = document.createElement('demo-card');
  card.id = 'test-card-events';
  card.setAttribute('data-hydration', '{"count":0}');
  const hydrated = new Promise((resolve) => {
    card.addEventListener('dsd:hydrated', resolve, { once: true });
  });
  document.body.appendChild(card);
  await hydrated;
  const received = new Promise((resolve) => {
    document.addEventListener('demo-count-change', (e) => resolve(e), { once: true });
  });
  card.shadowRoot.querySelector('button').click();
  const event = await received;
  assert('事件冒泡：composed 事件穿越 shadow 边界', event.detail.count === 1);
  assert('事件冒泡：target 重定向到宿主', event.target === card);
  assert('事件冒泡：composedPath 包含 shadow 内部节点',
    event.composedPath().some((n) => n === card.shadowRoot));
  await clearState('hydration:test-card-events');
  card.remove();
}

async function testHydration() {
  const id = 'hydration:test-hyd';
  await clearState(id);
  // 一致：persisted 与 server 相同
  await saveState(id, { count: 7 });
  const el = document.createElement('div');
  el.setAttribute('data-hydration', '{"count":7}');
  document.body.appendChild(el);
  const r1 = await hydrateComponent(el, { id, onState: () => {} });
  assert('水合状态一致：无 mismatch', r1.consistent && r1.state.count === 7);

  // 不一致：persisted 与 server 冲突，触发事件并按策略调和
  await saveState(id, { count: 9 });
  let mismatchFired = false;
  el.addEventListener('hydration-mismatch', () => { mismatchFired = true; });
  const r2 = await hydrateComponent(el, { id, policy: 'persisted', onState: () => {} });
  assert('水合状态不一致：触发 hydration-mismatch 事件', mismatchFired && !r2.consistent);
  assert('水合状态不一致：persisted 策略调和', r2.state.count === 9);
  const r3 = await hydrateComponent(el, { id, policy: 'server', onState: () => {} });
  assert('水合状态不一致：server 策略调和', r3.state.count === 7);
  await clearState(id);
  el.remove();
}

async function testFallback() {
  // 降级路径即 activateShadowRoots：无论浏览器是否支持 DSD，
  // 对 inert 模板执行 JS attachShadow。
  const env = detectEnvironment();
  assert('环境检测返回完整能力表',
    ['dsd', 'customElements', 'shadowDOM', 'indexedDB', 'worker'].every((k) => k in env),
    JSON.stringify(env));
  const host = makeHost(CARD_TEMPLATE);
  const r = await activateShadowRoots(host, { validateSync: true });
  assert('降级方案：JS 创建 Shadow DOM 成功', !!host.shadowRoot && r.activated === 1);
  host.remove();
}

async function testParseFailureNotice() {
  const host = makeHost(`<template shadowrootmode="broken"><p>x</p></template>`);
  let errEvent = null;
  host.addEventListener('dsd:error', (e) => { errEvent = e; });
  const r = await activateShadowRoots(host, { validateSync: true });
  const notice = host.querySelector('.dsd-error-notice');
  assert('解析失败：页面内显示错误提示', !!notice && /解析失败/.test(notice.textContent));
  assert('解析失败：派发 dsd:error 事件', !!errEvent);
  assert('解析失败：计入结果 errors', r.errors.length === 1);
  host.remove();

  // 结构损坏（未闭合标签）由校验器拦截
  const host2 = makeHost(`<template shadowrootmode="open"><div><p>x</div></template>`);
  const r2 = await activateShadowRoots(host2, { validateSync: true });
  assert('解析失败：结构损坏被校验器拦截', r2.errors.length === 1 && !host2.shadowRoot);
  host2.remove();
}

async function testDuplicateActivation() {
  const host = makeHost(CARD_TEMPLATE);
  const r1 = await activateShadowRoots(host, { validateSync: true });
  const r2 = await activateShadowRoots(host, { validateSync: true });
  const r3 = await activateShadowRoots(document, { validateSync: true });
  assert('重复激活不崩：首次激活 1 个', r1.activated === 1);
  assert('重复激活不崩：后续全部跳过且无错误',
    r2.activated === 0 && r3.errors.length === 0);
  assert('重复激活不崩：shadow root 保持唯一', !!host.shadowRoot);
  host.remove();
}

async function testNestedShadowDOM() {
  const host = makeHost(`
    <template shadowrootmode="open">
      <div id="inner-host">
        <template shadowrootmode="open"><span id="deep">deep</span></template>
      </div>
    </template>`);
  await activateShadowRoots(host, { validateSync: true });
  const innerHost = host.shadowRoot.querySelector('#inner-host');
  assert('嵌套 Shadow DOM：外层激活', !!host.shadowRoot);
  assert('嵌套 Shadow DOM：内层递归激活',
    innerHost.shadowRoot?.querySelector('#deep')?.textContent === 'deep');
  host.remove();
}

async function testFallbackConsistency() {
  // 静态 DSD 标记（tests/index.html 中）：支持 DSD 的浏览器在解析期原生激活，
  // 不支持的浏览器由下方 activateShadowRoots 兜底。与纯 JS 渲染的同款组件对比序列化结果。
  const nativeHost = document.getElementById('consistency-native');
  await activateShadowRoots(nativeHost, { validateSync: true }); // 不支持 DSD 时兜底；支持时幂等跳过

  const jsHost = document.createElement('demo-card');
  jsHost.setAttribute('data-hydration', '{"count":0}');
  document.body.appendChild(jsHost);
  await nextTick();

  const normalize = (s) => s.replace(/\s+/g, ' ').trim();
  const a = normalize(serializeShadowDOM(nativeHost));
  const b = normalize(serializeShadowDOM(jsHost));
  assert('降级方案结果一致：原生/JS 渲染序列化相同', a === b, a === b ? '' : `A=${a} B=${b}`);
  jsHost.remove();
}

async function testWorkerValidation() {
  // 走 Web Worker 校验路径（Worker 不可用时自动回退主线程）
  const host = makeHost(CARD_TEMPLATE);
  const r = await activateShadowRoots(host); // validateSync 缺省 = 走 worker
  assert('Web Worker 校验路径可用', r.activated === 1 && r.errors.length === 0);
  host.remove();
}

async function run() {
  document.getElementById('env').textContent = JSON.stringify(detectEnvironment());
  await testTemplateParsing();
  await testSlotDistribution();
  await testSlotMisalignmentRepair();
  await testStyleIsolation();
  await testEventBubbling();
  await testHydration();
  await testFallback();
  await testParseFailureNotice();
  await testDuplicateActivation();
  await testNestedShadowDOM();
  await testFallbackConsistency();
  await testWorkerValidation();
  const failed = results.filter((r) => !r.pass);
  document.title = failed.length === 0
    ? `ALL ${results.length} TESTS PASSED`
    : `${failed.length}/${results.length} TESTS FAILED`;
  document.getElementById('summary').textContent = document.title;
  document.getElementById('summary').className = failed.length === 0 ? 'pass' : 'fail';
}

run();
