/**
 * <demo-card>: custom element demonstrating slots, style isolation,
 * composed event bubbling, and IndexedDB-backed hydration.
 *
 * Works in three modes with identical results:
 *  1. Native DSD: browser attaches the shadow root at parse time.
 *  2. JS fallback: dsd-activator attaches it from the inert template.
 *  3. Client-rendered: connectedCallback attaches it from TEMPLATE_HTML.
 */
import { hydrateComponent, saveState } from '../hydration.js';

export const TEMPLATE_HTML = `
<style>
  :host { display: block; border: 2px solid #4f46e5; border-radius: 8px; padding: 12px; margin: 8px 0; }
  .card-title { color: #4f46e5; font-weight: bold; }
  .card-body { color: #111827; }
  .card-footer { font-size: 0.85em; color: #6b7280; }
  button { background: #4f46e5; color: #fff; border: 0; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
  .count { font-variant-numeric: tabular-nums; }
</style>
<div class="card-title"><slot name="header">默认标题</slot></div>
<div class="card-body"><slot></slot></div>
<div class="card-footer"><slot name="footer"></slot></div>
<button type="button" part="counter">+1</button>
<span class="count">0</span>`;

export class DemoCard extends HTMLElement {
  connectedCallback() {
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: 'open' });
      shadow.innerHTML = TEMPLATE_HTML;
    }
    if (this._wired) return; // 重复激活/重连保护
    this._wired = true;

    this._countEl = this.shadowRoot.querySelector('.count');
    this.shadowRoot.querySelector('button').addEventListener('click', () => this._increment());

    const id = this.id || `demo-card-${Math.random().toString(36).slice(2)}`;
    this._hydrationId = `hydration:${id}`;
    hydrateComponent(this, {
      id: this._hydrationId,
      policy: this.getAttribute('hydration-policy') || 'persisted',
      onState: (state) => this._applyState(state),
    });
  }

  _applyState(state) {
    this._count = Number(state.count) || 0;
    if (this._countEl) this._countEl.textContent = String(this._count);
  }

  _increment() {
    this._count = (this._count ?? 0) + 1;
    this._countEl.textContent = String(this._count);
    saveState(this._hydrationId, { count: this._count });
    this.dispatchEvent(
      new CustomEvent('demo-count-change', {
        bubbles: true,
        composed: true, // 穿透 Shadow DOM 边界
        detail: { count: this._count },
      }),
    );
  }

  get count() {
    return this._count ?? 0;
  }
}

if (!customElements.get('demo-card')) {
  customElements.define('demo-card', DemoCard);
}
