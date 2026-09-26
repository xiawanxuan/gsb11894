/**
 * hydration-core.js
 * 水合状态信封：版本号 + 校验和 + 数据。纯逻辑，无 DOM 依赖。
 */

export const STATE_VERSION = 1;

export const MISMATCH_REASON = Object.freeze({
  MALFORMED: 'malformed',
  VERSION_MISMATCH: 'version-mismatch',
  CHECKSUM_MISMATCH: 'checksum-mismatch',
});

/** FNV-1a 32 位哈希，输出 8 位十六进制字符串。 */
export function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** 键排序后的稳定序列化，保证同一状态产生同一校验和。 */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  const body = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',');
  return `{${body}}`;
}

/** 打包状态为可持久化信封。 */
export function createEnvelope(data, version = STATE_VERSION) {
  const checksum = fnv1a(stableStringify(data));
  return { version, checksum, data, savedAt: Date.now() };
}

/**
 * 校验信封。
 * 成功：{ ok: true, data }
 * 失败：{ ok: false, reason, data: null }
 */
export function verifyEnvelope(envelope, expectedVersion = STATE_VERSION) {
  if (
    envelope === null
    || typeof envelope !== 'object'
    || typeof envelope.version !== 'number'
    || typeof envelope.checksum !== 'string'
    || !('data' in envelope)
  ) {
    return { ok: false, reason: MISMATCH_REASON.MALFORMED, data: null };
  }
  if (envelope.version !== expectedVersion) {
    return { ok: false, reason: MISMATCH_REASON.VERSION_MISMATCH, data: null };
  }
  const actual = fnv1a(stableStringify(envelope.data));
  if (actual !== envelope.checksum) {
    return { ok: false, reason: MISMATCH_REASON.CHECKSUM_MISMATCH, data: null };
  }
  return { ok: true, data: envelope.data };
}
