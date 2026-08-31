# 阶段 7D 交付报告：v0.1.0 Release Candidate

> **状态**：Release Candidate 已生成，待用户集中试用

## 安装包

| 项 | 值 |
|----|-----|
| 路径 | `D:\fjh\disk-clean\release\Disk Clean-0.1.0-x64.exe` |
| 大小 | 81,938,520 字节 (~78.1 MB) |
| SHA-256 | `0A9712EA355A4C43A9AA7219E046EDD23307F23DA15AF1B9D26BF91DA2351DA1` |
| 签名 | **未签名**（Windows SmartScreen 可能提示） |
| 配置 | NSIS 非 one-click；可选安装目录；开始菜单 + 桌面快捷方式 |

## 打包内容

- 不含 `provider-config.json`、API Key、Mock Provider
- `config/` 官方规则与安全策略通过 `extraResources` 打入
- CSP / IPC sender / 窗口导航加固在生产包继续生效

## 文档

- [RELEASE-CHECKLIST-v0.1.md](RELEASE-CHECKLIST-v0.1.md)
- [RELEASE-NOTES-v0.1.0.md](RELEASE-NOTES-v0.1.0.md)
- [LICENSE](../LICENSE)

## 验证

- `npm test` 565 passed
- `npm run typecheck` / `npm run build` / `npm run pack`
