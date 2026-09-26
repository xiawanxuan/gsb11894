/**
 * <demo-panel>: hosts a <demo-card> inside its own shadow root,
 * demonstrating nested Shadow DOM (shadow root inside shadow root).
 */
export const PANEL_TEMPLATE_HTML = `
<style>
  :host { display: block; background: #eef2ff; border-radius: 10px; padding: 16px; }
  .panel-label { color: #312e81; text-transform: uppercase; font-size: 0.75em; letter-spacing: 0.08em; }
</style>
<div class="panel-label"><slot name="label">面板</slot></div>
<demo-card id="nested-card" data-hydration='{"count":0}'>
  <span slot="header">嵌套卡片</span>
  <p>嵌套在外层 Shadow DOM 中的卡片。</p>
  <span slot="footer">nested</span>
</demo-card>
<slot></slot>`;

export class DemoPanel extends HTMLElement {
  connectedCallback() {
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: 'open' });
      shadow.innerHTML = PANEL_TEMPLATE_HTML;
    }
  }
}

if (!customElements.get('demo-panel')) {
  customElements.define('demo-panel', DemoPanel);
}
