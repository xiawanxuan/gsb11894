# Declarative Shadow DOM 演示与验收

围绕 **Declarative Shadow DOM (DSD)** 的完整方案：把预渲染的 Shadow DOM 模板嵌入 HTML，
客户端检测支持情况并激活；不支持时降级为 JS 创建 Shadow DOM，结果保持一致。

## 技术栈

Declarative Shadow DOM + Custom Elements + Shadow DOM + Web Worker + IndexedDB（无构建步骤，原生 ES Modules）。

## 运行

```bash
npm start          # python3 -m http.server 8000
# 打开 http://localhost:8000/            演示页
# 打开 http://localhost:8000/tests/browser-tests.html   浏览器验收测试
npm test           # Node 纯逻辑测试（模板分析器 / 水合核心 / 存储降级）
```

> 需要通过 HTTP 访问：Web Worker 与 ES Module 在 `file://` 下不可用。

## 架构

| 文件 | 职责 |
| --- | --- |
| `src/dsd.js` | 特性检测、模板激活（含嵌套递归）、防重复激活、降级 polyfill、Worker 分析客户端 |
| `src/template-analyzer.js` | 纯字符串模板静态分析（标签配平、`shadowrootmode` 校验、插槽对齐），可运行于 Worker/Node |
| `src/worker/template-worker.js` | Web Worker，后台线程执行模板分析，失败自动回退主线程 |
| `src/hydration-core.js` | 水合状态信封：版本号 + FNV-1a 校验和 + 稳定序列化 |
| `src/idb-store.js` | IndexedDB 状态仓库；无 IndexedDB 时降级为内存 Map |
| `src/components.js` | `demo-card` / `demo-counter`：DSD 预渲染时水合，否则 JS 渲染同一结构 |
| `src/main.js` | 演示页启动：检测 → 分析 → 激活（先于组件升级）→ 水合 → 事件日志 |

## 关键设计

- **特性检测**：`'shadowRootMode' in HTMLTemplateElement.prototype`（`supportsDeclarativeShadowDOM()`）。
- **激活顺序**：`main.js` 先运行 `activateDeclarativeShadowDOM(document)`，再动态 `import('./components.js')`
  触发自定义元素升级，保证 polyfill 先于水合生效。
- **嵌套 Shadow DOM**：激活时递归处理 shadow root 内部的 `<template shadowrootmode>`。
- **重复激活**：`WeakSet` + `data-dsd-activated` 双重标记；`attachShadow` 抛错被捕获为 `already-active`，不崩溃。
- **解析失败**：Worker 静态分析（标签配平 / 非法 mode / 插槽错位）+ 激活期错误事件 `dsd-error`，
  单个模板失败不中断其它模板。
- **水合一致性**：状态以 `{version, checksum, data, savedAt}` 信封持久化到 IndexedDB；
  恢复时依次尝试内嵌 JSON（服务端直出）与 IndexedDB（取 `savedAt` 最新），
  校验失败发出 `hydration-mismatch` 事件并回退下一候选，最终回退默认状态。
- **降级一致性**：组件 JS 渲染使用与预渲染模板**同一份** `templateHTML`，
  并清理 light DOM 中未消费的模板；验收测试对两条路径的 shadow DOM 序列化做相等断言。

## 验收标准对照（`tests/browser-tests.js`）

1. 模板解析正确 — 分析器通过 + 激活后 shadow 结构断言
2. 插槽分发正确 — 具名/默认插槽 `assignedNodes()` 断言
3. 样式隔离正确 — shadow 内样式生效、不外泄、外部样式不侵入
4. 事件冒泡正确 — `composed` 事件跨界、`composedPath` 起点、`target` 重定向、非 composed 不外泄
5. 水合状态一致 — 持久化 → 新实例恢复 → 损坏状态回退默认并发出事件
6. 不支持时有降级 — inert 模板由 polyfill 激活出 shadow root
7. 解析失败有提示 — `dsd-error` 事件 + 分析器诊断，其它模板不受影响
8. 重复激活不崩 — 多次激活幂等，shadow root 唯一
9. 降级方案结果一致 — polyfill 激活 ≡ JS 渲染（序列化相等）
