/**
 * Pure-logic hydration state diff: compares server-rendered state
 * (data-hydration attribute) with persisted client state (IndexedDB).
 */

/**
 * @param {object|null} serverState  state serialized into the HTML by the server
 * @param {object|null} persistedState  state restored from IndexedDB
 * @returns {{consistent: boolean, mismatches: Array<{key: string, server: *, persisted: *}>}}
 */
export function diffHydrationState(serverState, persistedState) {
  const mismatches = [];
  if (serverState == null || persistedState == null) {
    return { consistent: true, mismatches };
  }
  const keys = new Set([...Object.keys(serverState), ...Object.keys(persistedState)]);
  for (const key of keys) {
    const serverVal = serverState[key];
    const persistedVal = persistedState[key];
    if (!Object.is(serverVal, persistedVal)) {
      mismatches.push({ key, server: serverVal, persisted: persistedVal });
    }
  }
  return { consistent: mismatches.length === 0, mismatches };
}

/**
 * Reconcile server vs persisted state.
 * @param {'persisted'|'server'} policy  who wins on conflict
 */
export function reconcileState(serverState, persistedState, policy = 'persisted') {
  const base = { ...(serverState ?? {}), ...(persistedState ?? {}) };
  if (policy === 'server') {
    return { ...(persistedState ?? {}), ...(serverState ?? {}) };
  }
  return base;
}
