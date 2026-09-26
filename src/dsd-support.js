/**
 * Feature detection for Declarative Shadow DOM and friends.
 */

export function supportsDSD() {
  return (
    typeof HTMLTemplateElement !== 'undefined' &&
    Object.prototype.hasOwnProperty.call(HTMLTemplateElement.prototype, 'shadowRootMode')
  );
}

export function supportsCustomElements() {
  return typeof customElements !== 'undefined';
}

export function supportsShadowDOM() {
  return (
    typeof Element !== 'undefined' &&
    typeof Element.prototype.attachShadow === 'function'
  );
}

export function supportsIndexedDB() {
  return typeof indexedDB !== 'undefined';
}

export function supportsWorker() {
  return typeof Worker !== 'undefined';
}

export function detectEnvironment() {
  return {
    dsd: supportsDSD(),
    customElements: supportsCustomElements(),
    shadowDOM: supportsShadowDOM(),
    indexedDB: supportsIndexedDB(),
    worker: supportsWorker(),
  };
}
