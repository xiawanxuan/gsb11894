/**
 * components.js
 * 自定义元素：DSD 预渲染时走水合，否则用 JS 创建 Shadow DOM（降级路径，结构一致）。
 */

import { createEnvelope, verifyEnvelope, STATE_VERSION } from './hydration-core.js';
import { HydrationStore } from './idb-store.js';

const sharedStore = new HydrationStore();

export class HydratableElement extends HTMLElement {
  static templateHTML = '';
  static defaultState = {};

  constructor() {
    super();
    this.state = { ...this.constructor.defaultState };
    this.persistTimer = null;
  }

  get stateId() {
    return this.getAttribute('state-id') || this.id || this.localName;
  }

  connectedCallback() {
    if (!this.shadowRoot) {
      // 降级路径：无 DSD（或 polyfill 未覆盖动态插入），用 JS 创建同样的 Shadow DOM
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = this.constructor.templateHTML;
      // JS 渲染已取代预渲染模板：清理 light DOM 中未被消费的 DSD 模板，
      // 保证降级结果与 polyfill 激活结果结构一致
      for (const stale of this.querySelectorAll('template[shadowrootmode]')) stale.remove();
      this.dataset.dsdRender = 'js-fallback';
    } else {
      this.dataset.dsdRender = 'declarative';
    }
    this.wireUp();
    this.restoreState();
  }

  disconnectedCallback() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
  }

  /** 子类覆盖：绑定事件、缓存节点引用。 */
  wireUp() {}

  /** 子类覆盖：把 this.state 反映到 shadow DOM。 */
  render() {}

  setState(patch) {
    Object.assign(this.state, patch);
    this.render();
    this.schedulePersist();
    this.dispatchEvent(new CustomEvent('state-changed', {
      bubbles: true,
      composed: true,
      detail: { id: this.stateId, state: { ...this.state } },
    }));
  }

  schedulePersist() {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistState(), 100);
  }

  async persistState() {
    try {
      await sharedStore.set(this.stateId, createEnvelope(this.state));
    } catch (error) {
      console.warn('[hydration] 状态持久化失败', error);
    }
  }

  /** 读取预渲染 HTML 中内嵌的水合状态（服务端直出）。 */
  readEmbeddedState() {
    const script = this.querySelector('script[type="application/json"][data-hydration]');
    if (!script) return null;
    try {
      return JSON.parse(script.textContent);
    } catch {
      return null;
    }
  }

  async restoreState() {
    const embedded = this.readEmbeddedState();
    const candidates = [];
    if (embedded) candidates.push({ source: 'embedded', envelope: embedded });
    try {
      const stored = await sharedStore.get(this.stateId);
      if (stored) candidates.push({ source: 'indexeddb', envelope: stored });
    } catch (error) {
      console.warn('[hydration] IndexedDB 读取失败', error);
    }

    // 取 savedAt 最新的候选
    candidates.sort((a, b) => (b.envelope?.savedAt ?? 0) - (a.envelope?.savedAt ?? 0));

    for (const { source, envelope } of candidates) {
      const result = verifyEnvelope(envelope, STATE_VERSION);
      if (result.ok) {
        this.state = { ...this.constructor.defaultState, ...result.data };
        this.dataset.hydratedFrom = source;
        this.render();
        return;
      }
      // 水合状态不一致：上报事件并尝试下一个候选
      this.dispatchEvent(new CustomEvent('hydration-mismatch', {
        bubbles: true,
        composed: true,
        detail: { id: this.stateId, source, reason: result.reason },
      }));
      console.warn(`[hydration] 状态不一致 (${this.stateId}/${source}): ${result.reason}`);
    }

    // 全部不可用：回退默认状态
    this.state = { ...this.constructor.defaultState };
    this.dataset.hydratedFrom = 'defaults';
    this.render();
  }
}

/* ------------------------------ demo-counter ------------------------------ */

export class DemoCounter extends HydratableElement {
  static templateHTML = `
    <style>
      :host { display: inline-block; }
      .counter { display: inline-flex; align-items: center; gap: 0.5rem;
        padding: 0.4rem 0.8rem; border: 1px solid #7c6cff; border-radius: 8px;
        background: #1e1b2e; color: #cfc8ff; font-family: system-ui, sans-serif; }
      button { background: #7c6cff; color: #fff; border: none; border-radius: 6px;
        width: 1.6rem; height: 1.6rem; cursor: pointer; font-size: 1rem; }
      button:hover { background: #9185ff; }
      .count { min-width: 2ch; text-align: center; font-variant-numeric: tabular-nums; }
    </style>
    <div class="counter">
      <slot name="label">计数器</slot>
      <button type="button" data-dec>-</button>
      <span class="count">0</span>
      <button type="button" data-inc>+</button>
    </div>`;

  static defaultState = { count: 0 };

  wireUp() {
    this.countEl = this.shadowRoot.querySelector('.count');
    this.shadowRoot.querySelector('[data-inc]').addEventListener('click', () => {
      this.setState({ count: this.state.count + 1 });
      this.dispatchEvent(new CustomEvent('counter-changed', {
        bubbles: true, composed: true, detail: { count: this.state.count },
      }));
    });
    this.shadowRoot.querySelector('[data-dec]').addEventListener('click', () => {
      this.setState({ count: this.state.count - 1 });
      this.dispatchEvent(new CustomEvent('counter-changed', {
        bubbles: true, composed: true, detail: { count: this.state.count },
      }));
    });
  }

  render() {
    if (this.countEl) this.countEl.textContent = String(this.state.count);
  }
}

/* ------------------------------- demo-card -------------------------------- */

export class DemoCard extends HydratableElement {
  static templateHTML = `
    <style>
      :host { display: block; }
      .card { border: 1px solid #3a3555; border-radius: 12px; overflow: hidden;
        background: #171425; color: #e8e4ff; font-family: system-ui, sans-serif; }
      .card-header { padding: 0.75rem 1rem; background: #241f3d; font-weight: 600; }
      .card-body { padding: 1rem; }
      .card-footer { padding: 0.5rem 1rem; border-top: 1px solid #3a3555;
        font-size: 0.85rem; color: #9a92c8; }
      .highlight { color: #ffd166; }
    </style>
    <div class="card">
      <div class="card-header"><slot name="header">默认标题</slot></div>
      <div class="card-body">
        <slot>默认正文</slot>
        <p class="highlight">此行样式被 Shadow DOM 隔离（.highlight 为金黄色）。</p>
        <demo-counter state-id="card-inner-counter">
          <template shadowrootmode="open">
            ${DemoCounter.templateHTML}
          </template>
          <span slot="label">嵌套计数</span>
        </demo-counter>
      </div>
      <div class="card-footer"><slot name="footer">默认页脚</slot></div>
    </div>`;

  wireUp() {
    this.addEventListener('counter-changed', (event) => {
      this.dispatchEvent(new CustomEvent('card-observed-counter', {
        bubbles: true, composed: true, detail: event.detail,
      }));
    });
  }
}

if (typeof customElements !== 'undefined') {
  if (!customElements.get('demo-counter')) customElements.define('demo-counter', DemoCounter);
  if (!customElements.get('demo-card')) customElements.define('demo-card', DemoCard);
}

export { sharedStore };
