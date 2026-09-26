/**
 * Node 测试：纯逻辑模块（模板分析器 / 水合核心 / IndexedDB 内存降级）。
 * 运行：node --test tests/node-tests.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  analyzeTemplate,
  extractDeclaredSlots,
  extractRequestedSlots,
  checkTagBalance,
  parseAttributes,
} from '../src/template-analyzer.js';
import {
  createEnvelope,
  verifyEnvelope,
  fnv1a,
  stableStringify,
  MISMATCH_REASON,
  STATE_VERSION,
} from '../src/hydration-core.js';
import { HydrationStore } from '../src/idb-store.js';

/* --------------------------- 模板分析器 --------------------------- */

test('合法模板分析通过', () => {
  const result = analyzeTemplate(
    '<template shadowrootmode="open"><style>.a{color:red}</style><slot name="header"></slot><slot></slot></template>',
    { lightDomHtml: '<span slot="header">t</span><p>body</p>' },
  );
  assert.equal(result.ok, true);
  assert.equal(result.mode, 'open');
  assert.deepEqual(result.declaredSlots.sort(), ['', 'header']);
});

test('非法 shadowrootmode 报错', () => {
  const result = analyzeTemplate('<template shadowrootmode="bogus"><slot></slot></template>');
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.code === 'invalid-shadowrootmode'));
});

test('缺少 shadowrootmode 报错', () => {
  const result = analyzeTemplate('<template><slot></slot></template>');
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.code === 'missing-shadowrootmode'));
});

test('模板标签不配平（解析失败信号）', () => {
  const result = analyzeTemplate('<template shadowrootmode="open"><template shadowrootmode="open"></template></template>');
  // 嵌套两个开、两个闭 → 配平；再测不配平场景
  assert.equal(result.ok, true);
  const broken = analyzeTemplate('<template shadowrootmode="open"><div><template shadowrootmode="open"></template>');
  assert.equal(broken.ok, false);
  assert.ok(broken.diagnostics.some((d) => d.code === 'unbalanced-template'));
});

test('插槽错位：light DOM 请求未声明的插槽 → error', () => {
  const result = analyzeTemplate(
    '<template shadowrootmode="open"><slot name="a"></slot></template>',
    { lightDomHtml: '<span slot="b">x</span>' },
  );
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((d) => d.code === 'slot-mismatch' && d.detail.name === 'b'));
});

test('插槽未分配 → warning，不算失败', () => {
  const result = analyzeTemplate('<template shadowrootmode="open"><slot name="lonely"></slot></template>');
  assert.equal(result.ok, true);
  assert.ok(result.diagnostics.some((d) => d.code === 'slot-unassigned' && d.severity === 'warning'));
});

test('重复插槽声明 → warning', () => {
  const result = analyzeTemplate('<template shadowrootmode="open"><slot name="x"></slot><slot name="x"></slot></template>');
  assert.ok(result.diagnostics.some((d) => d.code === 'duplicate-slot'));
});

test('空模板 → error', () => {
  assert.equal(analyzeTemplate('').ok, false);
  assert.equal(analyzeTemplate('   ').ok, false);
});

test('属性解析与插槽提取', () => {
  assert.deepEqual(parseAttributes('shadowrootmode="open" delegatesfocus'), { shadowrootmode: 'open', delegatesfocus: '' });
  assert.deepEqual(extractDeclaredSlots('<slot></slot><slot name="a"></slot>'), ['', 'a']);
  assert.deepEqual(extractRequestedSlots('<i slot="a"></i><i slot=\'b\'></i>'), ['a', 'b']);
  assert.deepEqual(checkTagBalance('<template><template></template></template>', 'template'), { opens: 2, closes: 2, balanced: true });
});

/* ---------------------------- 水合核心 ----------------------------- */

test('状态信封往返一致', () => {
  const data = { count: 42, nested: { a: [1, 2], b: 'x' } };
  const envelope = createEnvelope(data);
  assert.equal(envelope.version, STATE_VERSION);
  const result = verifyEnvelope(envelope);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, data);
});

test('校验和损坏 → checksum-mismatch', () => {
  const envelope = createEnvelope({ count: 1 });
  const result = verifyEnvelope({ ...envelope, checksum: 'deadbeef' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MISMATCH_REASON.CHECKSUM_MISMATCH);
});

test('数据被篡改 → checksum-mismatch', () => {
  const envelope = createEnvelope({ count: 1 });
  const result = verifyEnvelope({ ...envelope, data: { count: 2 } });
  assert.equal(result.ok, false);
  assert.equal(result.reason, MISMATCH_REASON.CHECKSUM_MISMATCH);
});

test('版本不一致 → version-mismatch', () => {
  const envelope = createEnvelope({ count: 1 }, 999);
  const result = verifyEnvelope(envelope);
  assert.equal(result.ok, false);
  assert.equal(result.reason, MISMATCH_REASON.VERSION_MISMATCH);
});

test('畸形信封 → malformed', () => {
  for (const bad of [null, undefined, 42, 'x', {}, { version: 1 }, { version: 1, checksum: 'a' }]) {
    assert.equal(verifyEnvelope(bad).reason, MISMATCH_REASON.MALFORMED);
  }
});

test('stableStringify 键序无关', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  assert.equal(fnv1a(stableStringify({ b: 1, a: 2 })), fnv1a(stableStringify({ a: 2, b: 1 })));
});

/* ------------------------ IndexedDB 内存降级 ------------------------ */

test('无 indexedDB 环境下 HydrationStore 降级为内存存储', async () => {
  const store = new HydrationStore();
  assert.equal(store.persistent, false);
  const envelope = createEnvelope({ count: 7 });
  await store.set('k1', envelope);
  assert.deepEqual(await store.get('k1'), envelope);
  await store.delete('k1');
  assert.equal(await store.get('k1'), null);
  await store.set('a', envelope);
  await store.clear();
  assert.equal(await store.get('a'), null);
});
