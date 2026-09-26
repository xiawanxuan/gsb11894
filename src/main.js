/**
 * Demo bootstrap: feature detection, fallback activation, event logging,
 * dynamic DSD injection, and hydration reset.
 */
import { detectEnvironment, supportsDSD } from './dsd-support.js';
import { activateShadowRoots } from './dsd-activator.js';
import { clearState } from './hydration-store.js';
import './components/demo-card.js';
import './components/demo-panel.js';

const log = (msg, kind = 'info') => {
  const panel = document.getElementById('event-log');
  if (!panel) return;
  const line = document.createElement('div');
  line.className = `log-${kind}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  panel.prepend(line);
};

function showEnvironment() {
  const env = detectEnvironment();
  const el = document.getElementById('env-report');
  el.textContent = Object.entries(env)
    .map(([k, v]) => `${k}: ${v ? '✅' : '❌'}`)
    .join('  |  ');
  if (!env.dsd) {
    log('浏览器不支持 Declarative Shadow DOM，启用 JS 降级激活', 'warn');
  }
}

function wireEvents() {
  document.addEventListener('dsd:activated', (e) =>
    log(`已激活 <${e.target.localName}> 的 Shadow DOM`, 'ok'));
  document.addEventListener('dsd:skipped', (e) =>
    log(`跳过重复激活 <${e.target.localName}>（幂等保护）`, 'warn'));
  document.addEventListener('dsd:error', (e) =>
    log(`错误：${e.detail.message}`, 'error'));
  document.addEventListener('dsd:slot-mismatch', (e) =>
    log(`插槽错位：${e.detail.message}`, 'warn'));
  document.addEventListener('hydration-mismatch', (e) =>
    log(`水合状态不一致（${e.detail.id}）：${e.detail.mismatches.map((m) => m.key).join(', ')}`, 'warn'));
  document.addEventListener('demo-count-change', (e) =>
    log(`事件冒泡穿越 Shadow 边界：count = ${e.detail.count}`, 'ok'));
}

async function boot() {
  showEnvironment();
  wireEvents();

  // 降级路径：浏览器不支持 DSD 时，模板仍是 inert 状态，用 JS 激活。
  // 支持 DSD 时浏览器已在解析期完成激活，此处调用会全部跳过（幂等）。
  const result = await activateShadowRoots(document);
  log(`激活完成：${result.activated} 个激活，${result.skipped} 个跳过，${result.errors.length} 个失败`,
    result.errors.length ? 'error' : 'ok');

  document.getElementById('inject-dynamic').addEventListener('click', async () => {
    const host = document.createElement('demo-card');
    host.id = 'dynamic-card';
    host.setAttribute('data-hydration', '{"count":0}');
    host.innerHTML = `
      <template shadowrootmode="open">
        <style>:host{display:block;border:2px dashed #0891b2;border-radius:8px;padding:12px;margin:8px 0}
        .card-title{color:#0891b2;font-weight:bold}</style>
        <div class="card-title"><slot name="header"></slot></div>
        <slot></slot>
      </template>
      <span slot="header">动态注入的卡片</span>
      <p>动态插入的 DSD 标记，由 JS 激活器处理。</p>`;
    document.getElementById('dynamic-zone').appendChild(host);
    // 动态插入的模板不会被浏览器原生激活（DSD 仅作用于初始解析），
    // 即使浏览器支持 DSD 也需要激活器。
    const r = await activateShadowRoots(host);
    log(`动态注入：激活 ${r.activated}，跳过 ${r.skipped}`, 'ok');
  });

  document.getElementById('reset-hydration').addEventListener('click', async () => {
    for (const card of document.querySelectorAll('demo-card[id]')) {
      await clearState(`hydration:${card.id}`);
    }
    log('已清除 IndexedDB 中的水合状态，刷新页面可观察服务端状态恢复', 'warn');
  });

  document.getElementById('reactivate').addEventListener('click', async () => {
    const r = await activateShadowRoots(document);
    log(`重复激活测试：激活 ${r.activated}，跳过 ${r.skipped}，未崩溃`, 'ok');
  });
}

boot();
