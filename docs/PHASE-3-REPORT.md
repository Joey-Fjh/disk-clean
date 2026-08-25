# 阶段 3 报告：模型 Provider 与安全凭证

> **日期**：2026-08-25
> **状态**：第二轮复审整改完成，**待产品复审**（路线图标记为「进行中」）
> **明确未做**：Agent 自动分析、扫描/Candidate 数据上送模型、SafetyValidator 授权迁移（阶段 4+ / 6）

---

## 1. 修改文件列表

### 新增（初版 + 复审整改）

| 路径 | 说明 |
|------|------|
| `src/shared/provider-types.ts` | Provider 类型、预设、错误码 |
| `src/shared/provider-limits.ts` | Base URL / 模型名 / API Key 长度上限 |
| `src/shared/provider-ipc.ts` | 结构化 IPC 结果 `{ ok, value } \| { ok, code, message }` |
| `src/main/provider/provider-key-origin.ts` | 旧配置 keyOrigin 推导与 Origin 兼容校验 |
| `src/main/window-security.ts` | 主窗口 sender 校验、导航限制 |
| `src/renderer/provider-settings.ts` | 设置页 UI |
| `src/renderer/provider-form-state.ts` | 脏表单 / 测试按钮可用性逻辑 |
| `src/renderer/settings-accordion.ts` | 设置页一级手风琴状态与 DOM 同步 |
| `src/renderer/settings-page.ts` | 手风琴交互、展开后滚动到标题 |
| `src/renderer/sub-tab-group.ts` | 卡片内二级 Tab 状态与 ARIA |
| `src/renderer/settings-summaries.ts` | 卡片 Header 摘要、规则分类筛选 |
| `tests/provider-*.test.ts` | Provider 专项测试（见 §6） |
| `tests/window-security.test.ts` | 导航白名单测试 |
| `tests/provider-form-state.test.ts` | 脏表单逻辑测试 |
| `tests/settings-*.test.ts` | 手风琴、二级 Tab、摘要与 ARIA 测试 |

### 修改

| 路径 | 说明 |
|------|------|
| `src/main/index.ts` | `setMainWindow` + `hardenMainWindow` |
| `src/preload/index.ts` | `invokeProviderIpc` 解包结构化错误 → `ProviderInvokeError` |
| `src/renderer/*` | 设置页、样式 |
| `README.md`、`docs/AGENT-ROADMAP.md`、`docs/DECISIONS.md` | 文档同步 |

---

## 2. 复审整改摘要

### 第一轮（2026-08-25）

| # | 整改项 | 实现要点 |
|---|--------|----------|
| 1 | **Key 与 Origin 绑定** | 保存 Key 时写入 `keyOrigin`；Origin 不变可留空 Key；变更须 `KEY_REENTRY_REQUIRED` |
| 2 | **响应体大小限制** | 无 Reader UTF-8 字节检查；Reader 超限 `cancel()`；`RESPONSE_TOO_LARGE` |
| 3 | **Provider IPC 加固** | sender 校验；结构化 `ProviderIpcResult` |
| 4 | **输入长度限制** | URL 2048 / 模型 128 / Key 512 |
| 5 | **脏表单** | 未保存时禁用测试按钮 |
| 6 | **IPC 错误契约** | Preload `ProviderInvokeError`，不依赖 `Error.code` |

### 第二轮（2026-08-25）

| # | 整改项 | 实现要点 |
|---|--------|----------|
| 1 | **无 keyOrigin 旧配置迁移** | 从 `existing.baseUrl` 推导旧 Origin；同 Origin 补写 `keyOrigin` 并保留 Key；无法解析或跨 Origin → `KEY_REENTRY_REQUIRED`；禁止静默绑定新 Origin |
| 2 | **file:// 导航白名单收紧** | 仅允许标准 `file:///C:/.../index.html`（hostname 必须为空）；拒绝 `file://host/...` 绕过；`isPackaged=false` 时精确匹配 `rendererIndexPath` 仍可用（npm start 回退） |
| 3 | **保存后表单规范化** | 保存成功 `fillForm(主进程返回配置)`；Base URL 去尾斜杠/空白后表单与 saved 同步，测试按钮立即可用 |

### 第三轮（2026-08-25）— 设置页信息架构

| # | 整改项 | 实现要点 |
|---|--------|----------|
| 1 | **单层滚动** | `#panel-settings` 为唯一纵向滚动区；隐藏滚动条但保留滚轮/键盘滚动 |
| 2 | **一级手风琴** | 外观主题 / 模型连接 / 扫描规则；同时最多展开一项；默认展开模型连接 |
| 3 | **卡片 Header 摘要** | 主题、Provider Key 末四位、规则启用数 |
| 4 | **模型连接二级 Tab** | 连接配置 / 连接测试；脏表单时测试 Tab 禁用按钮 |
| 5 | **扫描规则分类 Tab** | 全部 / 建议清理 / 谨慎处理 / 仅展示；规则列表无内部滚动 |
| 6 | **可访问性** | 手风琴 `button` + `aria-expanded`；二级 Tab `role="tablist/tab/tabpanel"` |

**未改动**：Provider 安全逻辑、safeStorage、Origin 绑定、IPC、扫描规则业务。

---

## 3. 架构与安全设计

```
Renderer (provider-settings.ts + provider-form-state.ts)
    │  window.diskClean.*（无 Key 明文）
    ▼
Preload（invokeProviderIpc → ProviderInvokeError）
    ▼
provider-ipc.ts（sender 校验 + 输入校验 + ProviderIpcResult）
    ▼
provider-service.ts
    ├─ provider-config-store.ts（safeStorage + keyOrigin 绑定）
    └─ provider-client.ts（超时 + RESPONSE_TOO_LARGE）
```

**Key 绑定规则：**

- `keyOrigin` = `new URL(normalizeProviderBaseUrl(baseUrl)).origin`
- 同 Origin 路径变更（如 `/v1` → `/v2`）可保留 Key
- 跨 Origin（OpenAI → DeepSeek、自定义域名变更）必须重新输入 Key

**IPC 返回契约：**

```typescript
type ProviderIpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ProviderErrorCode; message: string }
```

新增错误码：`KEY_REENTRY_REQUIRED`、`RESPONSE_TOO_LARGE`、`IPC_UNAUTHORIZED`

---

## 4. Provider 预设

| ID | 默认 Base URL |
|----|---------------|
| `openai` | `https://api.openai.com/v1` |
| `deepseek` | `https://api.deepseek.com/v1` |
| `custom` | 用户填写 |

---

## 5. 测试与验证结果

| 检查项 | 结果 |
|--------|------|
| `npm test` | **152** 项通过 |
| `npm run typecheck` | 通过 |
| `npm run build` | 通过 |
| `git diff --check` | 通过 |

### 设置页 UI 测试

| 文件 | 覆盖 |
|------|------|
| `settings-accordion.test.ts` | 单展开、收起、默认展开模型连接 |
| `settings-accordion-dom.test.ts` | `aria-expanded`、折叠 body `hidden` |
| `sub-tab-group.test.ts` | 二级 Tab 切换、`aria-selected`、面板显隐 |
| `settings-summaries.test.ts` | Header 摘要、规则分类 Tab 映射与筛选 |

### Provider 专项测试文件

| 文件 | 覆盖 |
|------|------|
| `provider-config-store.test.ts` | Key 加密、Origin 绑定、**旧配置无 keyOrigin 迁移**、跨 Origin 拒绝、非法旧地址 |
| `provider-key-origin.test.ts` | `deriveStoredKeyOrigin` / `assertKeyOriginCompatible` |
| `provider-form-state.test.ts` | 脏表单、**保存后规范化同步与测试按钮可用** |
| `window-security.test.ts` | **标准 file:/// 路径**、hostname 绕过拒绝、npm start 回退、目录穿越、外部 URL 拒绝 |
| `provider-client.test.ts` | 无 Reader / 有 Reader 的 `RESPONSE_TOO_LARGE` 断言 |
| `provider-ipc-security.test.ts` | 未授权 sender、`KEY_REENTRY_REQUIRED` 结构化返回、超长 Key IPC 拒绝 |
| `provider-ipc-contract.test.ts` | Preload 结构化解包、无解密 IPC |
| `provider-url/errors/service.test.ts` | URL、脱敏、连接/能力测试 |

扫描 / 清理相关测试未改动行为，全部仍通过。

---

## 6. 人工 UI 验收（待本地确认）

### Provider 与安全

- [ ] Key 末四位显示；无法查看完整 Key
- [ ] 同 Origin 改路径可留空 Key 保存；换 Origin 必须重输 Key
- [ ] 未保存修改时测试按钮禁用
- [ ] 连接/能力测试反馈正常
- [ ] 无 Key 时清理功能正常

### 设置页手风琴与滚动

- [ ] 三张卡片全部收起
- [ ] 模型连接展开 + 连接配置 Tab
- [ ] 模型连接展开 + 连接测试 Tab
- [ ] 扫描规则展开 + 分类 Tab
- [ ] 1366×768 / 1920×1080 无嵌套滚动、无截断
- [ ] 浅色与深色主题

---

## 7. 边界声明

- **未进入阶段 4+**
- **SafetyValidator** 未修改
- **扫描 IPC** 未加 sender 限制（仅 Provider 五通道加固）

---

## 8. 状态

阶段 3 路线图：**进行中，待复审**。产品批准后方可标为「已完成」。

未执行 `git commit` / `git push`。
