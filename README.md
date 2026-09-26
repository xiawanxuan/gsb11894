# Declarative Shadow DOM 演示

预渲染 Shadow DOM 模板嵌入 HTML，客户端检测支持情况并激活；不支持时降级到 JS 创建 Shadow DOM，结果与原生一致。

## 技术栈

Declarative Shadow DOM + Custom Elements + Shadow DOM + Web Worker + IndexedDB（零依赖、无构建步骤，原生 ES Modules）。

## 运行

```bash
npm run serve          # http://localhost:8000 （演示页）
# 浏览器打开 http://localhost:8000/tests/ （验收测试页）
npm test               # Node 端纯逻辑测试
```

## 架构

| 文件 | 职责 |
| --- | --- |
| `src/dsd-support.js` | 特性检测（DSD / Custom Elements / Shadow DOM / IndexedDB / Worker） |
| `src/dsd-activator.js` | 激活器 = 降级方案：inert 模板 → `attachShadow`，递归处理嵌套，幂等防重复 |
| `src/template-validator.js` | 纯逻辑模板校验（可运行于 Worker / Node） |
| `src/workers/template-worker.js` | Web Worker 中异步校验模板，主线程不阻塞 |
| `src/worker-client.js` | Worker 桥接；Worker 不可用时回退主线程同步校验 |
| `src/slot-matcher.js` | 插槽分发计算，检测并修复插槽错位 |
| `src/hydration.js` / `src/hydration-store.js` | 水合：IndexedDB 持久化 + 服务端状态比对调和 |
| `src/hydration-diff.js` | 纯逻辑水合状态 diff / reconcile |
| `src/components/demo-card.js` | 卡片组件：插槽、样式隔离、composed 事件、水合 |
| `src/components/demo-panel.js` | 面板组件：shadow 内嵌套 `<demo-card>`（嵌套 Shadow DOM） |

## 验收标准对照

| 标准 | 实现 | 测试 |
| --- | --- | --- |
| 模板解析正确 | `activateShadowRoots` 移入模板内容 | `testTemplateParsing` |
| 插槽分发正确 | 命名/默认插槽 + `computeSlotAssignments` | `testSlotDistribution` |
| 样式隔离正确 | shadow 内 `<style>` 不受全局影响、不外泄 | `testStyleIsolation` |
| 事件冒泡正确 | `composed: true` 事件穿透边界、target 重定向 | `testEventBubbling` |
| 水合状态一致 | `data-hydration` vs IndexedDB diff + 策略调和 | `testHydration` |
| 不支持时有降级 | `supportsDSD()` 为假时激活器兜底 | `testFallback` |
| 解析失败有提示 | 页面内 `.dsd-error-notice` + `dsd:error` 事件 | `testParseFailureNotice` |
| 重复激活不崩 | `shadowRoot` / `data-dsd-activated` 双重幂等保护 | `testDuplicateActivation` |
| 降级方案结果一致 | `serializeShadowDOM` 对比原生解析与 JS 渲染 | `testFallbackConsistency` |

## 关键设计

- **降级即激活器**：浏览器不支持 DSD 时，`<template shadowrootmode>` 保持 inert，激活器用 `attachShadow` + 移动模板内容完成同样的工作；动态注入的 DSD 标记（DSD 仅作用于初始解析）也走同一路径。
- **幂等**：宿主已有 `shadowRoot` 或带 `data-dsd-activated` 属性时跳过并移除模板，重复调用安全。
- **水合不一致处理**：`hydration-mismatch` 事件暴露冲突字段，`policy: 'persisted' | 'server'` 决定调和方向，调和结果写回 IndexedDB。
- **解析失败**：非法 `shadowrootmode`、未闭合标签、重复插槽名、禁用的 `<script>` 等由校验器（Worker 内）拦截，页面显示错误提示而不中断其余激活。
