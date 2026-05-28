# 新生儿记录

一个零依赖的手机端 PWA，用来快速记录新生儿吃奶、小便和大便时间。母乳支持开始/结束计时，结束时自动记录持续时间；其他喂奶可选择奶瓶、配方奶、瓶喂母乳或其他。页面会按日汇总喂奶、大小便时间和间隔。数据保存在当前手机浏览器本地，可导出 CSV 给 Excel/OneDrive，也可导出 JSON 做完整备份。

## 使用

直接用浏览器打开 `index.html` 可以记录数据；如果要安装到手机桌面或验证离线缓存，请通过 HTTPS 静态站点或本地服务器访问。

本地预览示例：

```powershell
python -m http.server 4173
```

然后打开 `http://127.0.0.1:4173`。

## 部署

把整个目录发布到 GitHub Pages、Cloudflare Pages 或其他静态托管即可。应用只加载静态文件，不会把记录上传到托管服务。

## 数据

- `localStorage` key: `baby-log:v1:records`
- schema version: `1`
- CSV 导出带 UTF-8 BOM，Excel 通常可直接识别中文。
- JSON 导出用于完整恢复；恢复时会替换当前浏览器里的本地记录。
