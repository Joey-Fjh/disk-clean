# v1 扫描规则草案

运行时由规则驱动，不靠 AI 临时判断。路径里的环境变量在扫描时展开。

## 安全（safe）

删除后一般会再生，或不影响用户数据。默认可勾选。

| 规则 ID | 名称 | 路径 / 模式 |
|---------|------|-------------|
| `user-temp` | 用户临时文件 | `%TEMP%`、`%LOCALAPPDATA%\Temp` |
| `windows-temp` | Windows Temp | `C:\Windows\Temp`（需权限则跳过失败项） |
| `thumbcache` | 缩略图缓存 | `%LOCALAPPDATA%\Microsoft\Windows\Explorer\thumbcache_*.db` |
| `chrome-cache` | Chrome 缓存 | Chrome 用户目录下 `Cache`、`Code Cache`、`GPUCache` |
| `edge-cache` | Edge 缓存 | Edge 对应用户目录缓存 |
| `npm-cache` | npm 缓存 | `%LOCALAPPDATA%\npm-cache`、`%APPDATA%\npm-cache` |
| `pip-cache` | pip 缓存 | `%LOCALAPPDATA%\pip\Cache` |
| `recycle-bin` | 回收站 | 各盘 `$Recycle.Bin`（单独确认） |
| `error-reports` | Windows 错误报告 | `%LOCALAPPDATA%\Microsoft\Windows\WER` |
| `installer-leftovers` | 安装包缓存（Windows Installer 临时） | 仅明确的 Temp 安装残留，不碰 `C:\Windows\Installer` |

## 建议（recommended）

能腾空间，但可能影响预览/下载体验。默认不勾选。

| 规则 ID | 名称 | 路径 / 模式 |
|---------|------|-------------|
| `wechat-cache` | 微信缓存 | 微信 `FileStorage\Cache`、视频/图片缓存目录（不含聊天记录库） |
| `qq-preview-cache` | QQ 预览缓存 | QQ 图片/视频预览、缩略图缓存（不含消息库） |
| `downloads-installers` | 下载目录安装包 | `%USERPROFILE%\Downloads` 下较旧的 `.exe` / `.msi` / `.iso` |
| `browser-downloads-dup` | 浏览器下载残留 | 各浏览器 Default\Downloads 中的安装包（若独立存放） |
| `app-logs` | 应用日志 | 常见软件 `Logs` 目录，排除系统日志 |

## 危险（dangerous）

只列出、算大小、写说明。默认不可删。

| 规则 ID | 名称 | 说明 |
|---------|------|------|
| `windows-old` | `C:\Windows.old` | 升级残留，删前需确认不再回退 |
| `hiberfil` | `hiberfil.sys` | 休眠文件，关休眠才能安全处理 |
| `pagefile` | `pagefile.sys` | 虚拟内存，不建议手工删 |
| `large-user-files` | 用户目录 >500MB 文件 | 只报告路径和大小，由用户决定 |
| `program-files-huge` | Program Files 下超大目录 | 只报告，可能是正常软件 |

## 永不扫描 / 永不删除

- `C:\Windows\System32`
- `C:\Windows\SysWOW64`
- `C:\Windows\WinSxS`
- Boot / EFI 相关目录
- 注册表
- 微信/QQ **聊天记录数据库**（只扫明确的 Cache 子目录）

## 盘符策略

- C 盘：上表全部适用
- 其他盘：扫该盘 `Temp`、`Downloads`、根目录旧安装包、回收站、大文件报告
- 权限拒绝：跳过并记入报告，不中断整次扫描
