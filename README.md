# 新生儿记录

一个零依赖、手机优先的静态 PWA。主页是宝宝日记，每次添加一条文字，可选择从相册附图或拍照；勾选“属于第一次”后，同一条日记也会自动展示在“第一次”板块。支持编辑、删除、按日期查看，所有内容按北京时间分组，日期从 2026-05-26 算第 1 天。

## 页面

- `index.html`：宝宝日记主页；`index.html#firsts` 打开“第一次”。
- `quick.html`：原有快速喂养和大小便记录。
- `records.html`：原有完整记录、历史、每日总结、CSV/JSON 备份。
- `photos.html`：原有大便和肚脐照片。
- 原规律分析页面已移除；旧 `analysis.html` 链接自动转到日记主页。

## 使用

通过 HTTPS 静态站点或本地服务器访问 `index.html`。在手机浏览器中添加到主屏幕即可作为 PWA 使用，默认进入日记主页。首次联网加载后支持离线使用。已经安装的旧版快捷方式可能仍打开快速记录页，可以通过“宝宝日记”入口进入主页。

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
- JSON 导出用于完整备份；导入时会按记录 ID 自动合并，同一条记录保留更新时间较新的版本。

### 日记

- IndexedDB 数据库：`baby-diary`，版本 `1`，对象仓库 `entries`。
- 每条记录包含 `id`、`time`、`text`、`isFirst`、`photos`、`createdAt`、`updatedAt`。
- 日记图片以 Blob 存储在同一条记录中，最长边压缩到 1600px，每条最多 6 张。
- “第一次”根据 `isFirst` 实时筛选；编辑、取消标记或删除日记时同步更新。
- 主页底部的“日记备份”导出完整 JSON，包含附图；导入按 ID 和更新时间合并，重复导入不会生成副本。
- 日记备份和喂养记录备份分别管理，旧喂养记录 JSON 继续在“喂养记录”页面导入。
- 原有 `baby-log:v1:records` 和照片数据库 `baby-photo-log` 不迁移、不清空。
