# 阶段 3.1 交付报告：多模型配置管理

> **状态**：已完成（2026-08-27 代码复审通过）  
> **日期**：2026-08-27  
> **HEAD**：`a690175`（工作区含未提交的阶段 4.2 / 5A / 3.1 改动）

---

## 1. Git 与工作区

| 项 | 说明 |
|----|------|
| HEAD | `a6901751680f8fe96f318f3b19eeebbbb4e43330` |
| 提交 | **未 commit** |
| 推送 | **未 push** |
| 阶段边界 | 未进入 5B / 6；阶段 4.2、5A 改动完整保留 |

---

## 2. 存储 Schema 与迁移

### 磁盘路径

`{userData}/config/provider-config.json`

### Schema v2

```json
{
  "schemaVersion": "2",
  "activeProfileId": "uuid",
  "profiles": [
    {
      "id": "uuid",
      "name": "我的 DeepSeek",
      "providerId": "deepseek",
      "protocol": "openai-chat-completions",
      "baseUrl": "https://api.deepseek.com/v1",
      "model": "deepseek-chat",
      "encryptedApiKey": "...",
      "keyLastFour": "1234",
      "keyOrigin": "https://api.deepseek.com",
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### 行为要点

- Profile `id` 由主进程 `randomUUID()` 生成，Renderer 不可指定。
- 配置名称必填、trim 后 1–64 字符；最多 **20** 份配置。
- 首次读取阶段 3 单配置格式时**幂等迁移**为 v2：旧配置变为默认 Profile 并设为 active；**不解密、不重新加密**既有密文。
- 重复启动不重复创建 Profile（迁移后立即写回 v2）。
- 非法 Profile（重复 ID、空名称、字段类型错误、URL/Key 不一致等）在加载时**隔离忽略**并**写回净化后的 v2**；`activeProfileId` 无效时按 `createdAt` + `id` 确定性回退；读取时强制执行 `MAX_PROFILES` 上限。
- 有密文 Key 时：`keyOrigin` 必须与规范化 Base URL Origin 一致；`keyLastFour` 最多 4 字符；密文须为有效 base64；不一致则剥离 Key，Profile 不可进入 runnable 状态。
- 写入使用 **tmp + rename** 原子替换。

### 迁移测试覆盖

`tests/provider-profiles.test.ts`：有 Key / 无 Key / 无 keyOrigin / 幂等 / 损坏与重复 ID / 跨 Origin 拒绝。

---

## 3. IPC 契约

| 通道 | 输入 | 返回 |
|------|------|------|
| `provider:listProfiles` | — | `ProviderProfilesPublicState` |
| `provider:createProfile` | `CreateProviderProfileInput` | `ProviderProfilesPublicState` |
| `provider:updateProfile` | `UpdateProviderProfileInput` | `ProviderProfilesPublicState` |
| `provider:deleteProfile` | `{ profileId }` | `ProviderProfilesPublicState` |
| `provider:setActiveProfile` | `{ profileId }` | `ProviderProfilesPublicState` |
| `provider:testConnection` | `{ profileId }` | `ProviderTestResult` |
| `provider:testCapability` | `{ profileId }` | `ProviderTestResult` |

- 全部校验 `event.sender === mainWindow.webContents`。
- Renderer **已移除** `getProviderConfig` / `saveProviderConfig` / `deleteProviderApiKey` 写入入口。
- 测试连接/能力**仅接受 profileId**，禁止传 Base URL、模型或 Key 绕过已保存配置。

公开类型：`ProviderProfilePublic`、`ProviderProfilesPublicState`、`CreateProviderProfileInput`、`UpdateProviderProfileInput`。

---

## 4. Key 隔离与 Origin 绑定

- API Key 仅在主进程；`safeStorage` 加密；不可用时拒绝保存新 Key。
- Renderer 仅见 `hasKey`、`keyLastFour`；无解密 IPC。
- 每份 Profile 独立 `encryptedApiKey` / `keyOrigin`；新建 Profile **不继承**其他 Profile 的 Key。
- 同 Profile 更新：Origin 不变且 Key 留空 → 保留；同 Origin 路径变化 → 保留；Origin 变且 Key 留空 → `KEY_REENTRY_REQUIRED`。
- 错误、日志、测试结果不含完整 Key。

---

## 5. Agent 与 active Profile

- `getProviderConfig()` / `requireRunnableConfig()` 读取**当前 active Profile**（服务层映射为旧 `ProviderConfigPublic` 形状供 Agent 内部使用）。
- 无 active 或 active 无 Key → `CONFIG_MISSING` / `skipped_no_provider`；**不自动切换**其他 Profile。
- 每次 `requireRunnableConfig()` 调用取当时 active 快照；请求进行中切换 Profile 不影响已启动请求（见 `tests/provider-profiles-agent.test.ts`）。
- `rule-draft-agent-service` 同样依赖 active Profile。

---

## 6. 设置页操作流程

1. **已保存的配置**：列表卡片显示名称、Provider、模型、Origin、Key 状态、「当前使用」Badge。
2. 卡片操作：使用此配置 / 编辑 / 测试连接 / 能力测试 / **删除整份配置**（含 Key，确认文案含配置名）。
3. **添加 / 编辑配置**：名称、Provider、Base URL、模型、Key（留空保留、显示末四位、Origin 变更提示重输）。
4. 脏表单时卡片测试不可用；测试中 loading 仅锁定目标 Profile。
5. 列表与手风琴摘要使用 `textContent` / 安全 DOM（`provider-profile-render.ts`）。

---

## 7. 测试

| 新增/更新 | 说明 |
|-----------|------|
| `tests/provider-profiles.test.ts` | 多 Profile CRUD、迁移、限制、Key 隔离 |
| `tests/provider-profiles-agent.test.ts` | active 切换、快照、无 fallback |
| `tests/provider-profile-render.test.ts` | 安全渲染 |
| 更新 `provider-service`、`provider-ipc-*`、`provider-form-state`、`settings-summaries` | 契约与行为 |

**总测试数：405**（原 392 + 5 净增；移除旧单配置 store 测试合并入 profiles 测试）

---

## 8. 验证结果

| 命令 | 结果 |
|------|------|
| `npm test` | **405 passed** |
| `npm run typecheck` | **通过** |
| `npm run build` | **通过** |
| `git diff --check` | **通过**（仅 CRLF 提示） |

---

## 9. 已知延后问题（本阶段不修复）

- 扫描中展开大量「正在识别」详情过重
- 未配置模型时可能出现「正在分析」临时分类
- 扫描完成后可能激活空的「正在分析」Tab
- 任务阶段、分类 Tab 与实际数据生命周期尚未完全同步

---

## 10. 主要改动文件

- `src/main/provider/provider-config-store.ts` — schema v2、迁移、多 Profile
- `src/main/provider/provider-service.ts` / `provider-ipc.ts`
- `src/shared/provider-types.ts` / `provider-limits.ts` / `provider-profile-utils.ts`
- `src/preload/index.ts` / `index.d.ts`
- `src/renderer/provider-settings.ts` / `provider-profile-render.ts` / `provider-form-state.ts`
- `src/renderer/index.html` / `style.css` / `settings-summaries.ts`
- `src/renderer/main.ts` / `rule-draft-actions.ts`

---

**未 commit · 未 push · 未进入阶段 5B / 6 · 等待代码复审**
