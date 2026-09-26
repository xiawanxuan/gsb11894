/**
 * Hydration: restores component state persisted in IndexedDB and
 * reconciles it with the server-rendered `data-hydration` attribute.
 * Emits `hydration-mismatch` when server and persisted state disagree
 * (水合状态不一致), then reconciles according to `policy`.
 */
import { diffHydrationState, reconcileState } from './hydration-diff.js';
import { saveState, loadState } from './hydration-store.js';

export function readServerState(el) {
  const raw = el.getAttribute('data-hydration');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    el.dispatchEvent(
      new CustomEvent('dsd:error', {
        bubbles: true,
        composed: true,
        detail: { message: 'data-hydration 不是合法 JSON' },
      }),
    );
    return null;
  }
}

/**
 * @param {HTMLElement} el  component host carrying data-hydration
 * @param {{id: string, policy?: 'persisted'|'server',
 *          onState: (state: object) => void}} options
 */
export async function hydrateComponent(el, { id, policy = 'persisted', onState }) {
  const serverState = readServerState(el);
  const persistedState = await loadState(id);

  const { consistent, mismatches } = diffHydrationState(serverState, persistedState);
  if (!consistent) {
    el.dispatchEvent(
      new CustomEvent('hydration-mismatch', {
        bubbles: true,
        composed: true,
        detail: { id, mismatches, policy },
      }),
    );
  }

  const state = reconcileState(serverState, persistedState, policy);
  onState(state);
  await saveState(id, state);
  el.dispatchEvent(
    new CustomEvent('dsd:hydrated', {
      bubbles: true,
      composed: true,
      detail: { id, state, consistent },
    }),
  );
  return { state, consistent, mismatches };
}

export { saveState, loadState };
