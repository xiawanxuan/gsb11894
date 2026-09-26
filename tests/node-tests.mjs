/**
 * Node tests for the pure-logic modules (no DOM required).
 * Run: node tests/node-tests.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateTemplateSource } from '../src/template-validator.js';
import { computeSlotAssignments } from '../src/slot-matcher.js';
import { diffHydrationState, reconcileState } from '../src/hydration-diff.js';

test('validator: 合法模板通过', () => {
  const html = `<template shadowrootmode="open"><style>:host{color:red}</style><slot name="header"></slot><slot></slot></template>`;
  const r = validateTemplateSource(html);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'open');
  assert.deepEqual(r.slots, ['header', '']);
  assert.equal(r.nestedCount, 0);
});

test('validator: 识别嵌套模板', () => {
  const html = `<template shadowrootmode="open"><div><template shadowrootmode="closed"><slot></slot></template></div></template>`;
  const r = validateTemplateSource(html);
  assert.equal(r.ok, true);
  assert.equal(r.nestedCount, 1);
});

test('validator: 非法 shadowrootmode 报错', () => {
  const r = validateTemplateSource(`<template shadowrootmode="broken"><p>x</p></template>`);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /shadowrootmode/);
});

test('validator: 缺少 shadowrootmode 报错', () => {
  const r = validateTemplateSource(`<template><p>x</p></template>`);
  assert.equal(r.ok, false);
  assert.match(r.errors.at(-1), /shadowrootmode/);
});

test('validator: 未闭合标签报错', () => {
  const r = validateTemplateSource(`<template shadowrootmode="open"><div><p>x</div></template>`);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('不匹配')));
});

test('validator: 多余闭合标签报错', () => {
  const r = validateTemplateSource(`<template shadowrootmode="open"><p>x</p></span></template>`);
  assert.equal(r.ok, false);
});

test('validator: 禁止 script', () => {
  const r = validateTemplateSource(`<template shadowrootmode="open"><script>alert(1)</script></template>`);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('script')));
});

test('validator: 重复插槽名产生错位警告', () => {
  const html = `<template shadowrootmode="open"><slot name="a"></slot><slot name="a"></slot></template>`;
  const r = validateTemplateSource(html);
  assert.equal(r.ok, true);
  assert.ok(r.warnings.some((w) => w.includes('错位')));
});

test('validator: 空内容报错', () => {
  assert.equal(validateTemplateSource('').ok, false);
  assert.equal(validateTemplateSource('   ').ok, false);
});

test('validator: void 元素不影响配对', () => {
  const html = `<template shadowrootmode="open"><img src="a.png"><br><input type="text"></template>`;
  assert.equal(validateTemplateSource(html).ok, true);
});

test('slot-matcher: 正常分发', () => {
  const { assignments, mismatches } = computeSlotAssignments(
    [{ slot: 'header' }, { slot: null }, { slot: 'footer' }],
    ['header', '', 'footer'],
  );
  assert.equal(mismatches.length, 0);
  assert.deepEqual(assignments.map((a) => a.slot), ['header', '', 'footer']);
  assert.ok(assignments.every((a) => !a.repaired));
});

test('slot-matcher: 不存在的插槽降级到默认插槽', () => {
  const { assignments, mismatches } = computeSlotAssignments(
    [{ slot: 'sidebar' }],
    ['header', ''],
  );
  assert.equal(mismatches.length, 1);
  assert.match(mismatches[0], /sidebar/);
  assert.deepEqual(assignments[0], { child: 0, slot: '', repaired: true });
});

test('slot-matcher: 无默认插槽时未命名子节点重路由', () => {
  const { assignments, mismatches } = computeSlotAssignments(
    [{ slot: null }],
    ['only'],
  );
  assert.equal(mismatches.length, 1);
  assert.deepEqual(assignments[0], { child: 0, slot: 'only', repaired: true });
});

test('hydration-diff: 状态一致', () => {
  const r = diffHydrationState({ count: 3 }, { count: 3 });
  assert.equal(r.consistent, true);
  assert.equal(r.mismatches.length, 0);
});

test('hydration-diff: 检测不一致字段', () => {
  const r = diffHydrationState({ count: 3, open: true }, { count: 5, open: true });
  assert.equal(r.consistent, false);
  assert.deepEqual(r.mismatches, [{ key: 'count', server: 3, persisted: 5 }]);
});

test('hydration-diff: 任一侧为空视为一致', () => {
  assert.equal(diffHydrationState(null, { a: 1 }).consistent, true);
  assert.equal(diffHydrationState({ a: 1 }, null).consistent, true);
});

test('hydration-reconcile: persisted 优先（默认）', () => {
  const s = reconcileState({ count: 3 }, { count: 5 }, 'persisted');
  assert.equal(s.count, 5);
});

test('hydration-reconcile: server 优先', () => {
  const s = reconcileState({ count: 3 }, { count: 5 }, 'server');
  assert.equal(s.count, 3);
});

test('hydration-reconcile: 合并双方独有字段', () => {
  const s = reconcileState({ a: 1 }, { b: 2 });
  assert.deepEqual(s, { a: 1, b: 2 });
});

console.log('所有 Node 测试通过');
