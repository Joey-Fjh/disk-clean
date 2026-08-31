# Disk Clean v0.1.0 Release Checklist

## 构建前

- [x] 版本号 `0.1.0`
- [x] `productName` = Disk Clean
- [x] `appId` = com.diskclean.app
- [x] `build/icon.png` 存在
- [x] 无密钥/Mock 配置进入 Git
- [x] `release/` 在 `.gitignore`

## 构建

```powershell
npm test
npm run typecheck
npm run build
npm run pack
```

## 安装包检查

- [ ] 安装程序可选择目录
- [ ] 开始菜单与桌面快捷方式
- [ ] 首次启动无 Key 可扫描
- [ ] 设置页可配置 Provider
- [ ] 卸载不删除用户文件与回收站内容

## 安全

- [x] Renderer 不提交 path 删除授权
- [x] 清理仍经 Validator + confirmationId
- [x] 用户经验不扩大删除权限
- [x] RC 收口：经验库大小/损坏隔离、totalSize 扣除保留项、测量缓存完整性边界

## 签名

- [ ] 代码签名（RC 未签名，正式版可选）
