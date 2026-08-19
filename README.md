# Win Disk Cleaner

Windows 磁盘清理小工具。规则驱动扫描，结果分三类展示，删除必须经用户确认。

第一期只做清理（缓存、临时文件、安装包等）。不做杀毒，不接 AI。

## 本地路径

```
C:\Users\admin\Projects\win-disk-cleaner
```

单分支：`main`。已 `git init`，有一次本地提交。

## 文档

- [产品决策](docs/DECISIONS.md)
- [v1 扫描规则草案](docs/RULES-v1.md)

## 推送到 GitHub（手动）

1. 打开 https://github.com/new
2. 仓库名：`win-disk-cleaner`，建议 Private
3. **不要**勾选 Add a README
4. 创建后执行（把 `YOUR_USER` 换成你的 GitHub 用户名）：

```powershell
cd C:\Users\admin\Projects\win-disk-cleaner

git add README.md docs
git commit -m "Keep a single main branch for this project"

git remote add origin https://github.com/YOUR_USER/win-disk-cleaner.git
git push -u origin main
```

家里电脑：

```powershell
git clone https://github.com/YOUR_USER/win-disk-cleaner.git
```
