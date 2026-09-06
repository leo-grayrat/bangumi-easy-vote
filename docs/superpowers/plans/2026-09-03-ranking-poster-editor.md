# 排行榜海报编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有番组投票台中新增第三个同级“排行榜海报”工作区，在纯浏览器环境里完成榜单数据编辑、视觉图导入与裁切、字体样式调整、实时 Canvas 预览和透明 PNG 导出。

**Architecture:** 保留当前 Python/Pillow 渲染器作为参考实现；新增纯 JavaScript 的 `poster-model.js` 和 `poster-renderer.js`，把排序、趋势判断、裁切参数和固定几何从 DOM 交互中隔离。`poster-editor.js` 只负责浏览器状态、文件/字体加载、裁切交互与导出；现有问卷生成器不改内部模型。

**Tech Stack:** HTML5、CSS、ES modules、Canvas 2D、File API、FontFace API、Node.js 20+ built-in test runner

**Spec:** `docs/superpowers/specs/2026-09-03-ranking-poster-editor-design.md`

## Global Constraints

- 排行榜编辑器必须纯前端运行，不需要 Python 服务端。
- 所有用户视觉图与本地字体只保留在当前浏览器会话，不上传网络。
- 不解析或提交原始问卷 Excel；第一版只消费整理后的榜单 JSON/项目 JSON。
- 画布固定为 1200×1800，背景透明；沿用现有 Pillow 原型的行坐标、排名区、699×136 视觉区和右侧评分区。
- 红榜排序：平均分降序，再按评分人数降序；黑榜排序：平均分升序，再按评分人数降序。
- 红榜/黑榜趋势阈值与当前 Pillow 原型一致，并允许项目 JSON 覆盖。
- 图片裁切是非破坏式的，保存 `zoom`、`offsetX`、`offsetY`，不改写原图。
- 项目 JSON 不内嵌图片或字体二进制，只保存文件名、裁切参数和样式配置。
- 现有问卷文本生成器继续工作；不为排行榜编辑器重写或迁移现有功能。

---

### Task 1: 建立可测试的海报数据模型

**Files:**
- Create: `src/poster-model.js`
- Create: `tests/poster-model.test.mjs`

**Interfaces:**
- Produces: `POSTER_DEFAULTS`
- Produces: `createPosterProject(input?): PosterProject`
- Produces: `normalizePosterProject(input): PosterProject`
- Produces: `sortPosterItems(items, mode): PosterItem[]`
- Produces: `trendState(score, bgmScore, mode, thresholds?): 'up'|'flat'|'down'`
- Produces: `serializePosterProject(project): string`
- Produces: `cropTransform(imageWidth, imageHeight, viewportWidth, viewportHeight, crop): {sx, sy, sw, sh}`

- [ ] **Step 1: 写失败测试**

覆盖：红/黑榜排序、同分人数优先、红黑榜不同趋势阈值、项目序列化移除 `imageUrl`/字体 object URL、默认裁切为居中 cover、`zoom/offsetX/offsetY` 改变裁切窗口但始终夹在图片范围内。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/poster-model.test.mjs`

Expected: FAIL，因为 `src/poster-model.js` 尚不存在。

- [ ] **Step 3: 实现最小模型**

`PosterItem` 固定包含 `id/title/titleLines/score/voters/bgmScore/imageName/imageUrl/crop`；`crop` 默认 `{zoom: 1, offsetX: 0, offsetY: 0}`。序列化时删除 `imageUrl` 和仅会话存在的字体 URL。

- [ ] **Step 4: 运行模型测试**

Run: `node --test tests/poster-model.test.mjs`

Expected: PASS。

---

### Task 2: 实现浏览器 Canvas 海报渲染核心

**Files:**
- Create: `src/poster-renderer.js`
- Create: `src/poster-assets.js`
- Create: `tests/poster-renderer.test.mjs`

**Interfaces:**
- Consumes: `PosterProject` and helpers from `poster-model.js`
- Produces: `POSTER_LAYOUT`
- Produces: `measurePosterRows(project): PosterRowLayout[]`
- Produces: `renderPoster(canvas, project, resources): void`
- Produces: `rowAtCanvasPoint(x, y): number | null`

- [ ] **Step 1: 写布局失败测试**

断言画布 1200×1800；十行 y 坐标为 `[168,317,467,616,766,915,1065,1214,1364,1514]`；视觉区宽 699、高 136；点击任意行视觉区/评分区都能映射回对应行；排序由模型完成。

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test tests/poster-renderer.test.mjs`

Expected: FAIL，因为渲染模块尚不存在。

- [ ] **Step 3: 固化参考素材和几何**

`poster-assets.js` 只保存当前 Python `trend_assets.py` 已提取的三种透明箭头 data URL；不提交原始参考截图。`POSTER_LAYOUT` 以当前 Pillow 版最终参数为准，而不是重新从旧 `layout-calibrated.json` 的早期 split 值猜测。

- [ ] **Step 4: 实现 Canvas 绘制**

顺序：透明清屏 → 黑色页头与空品牌色块 → 两行标题 → 十行排名/视觉图/暗幕/动画标题/评分区 → 一次性顶部列名 → 趋势箭头与窄色带。视觉图通过 `cropTransform()` 计算 `drawImage` 源矩形；缺图时绘制低对比占位图。

- [ ] **Step 5: 运行渲染测试和语法检查**

Run: `node --test tests/poster-renderer.test.mjs`

Run: `node --check src/poster-renderer.js`

Expected: PASS / exit 0。

---

### Task 3: 把排行榜海报接成第三个顶层工作区

**Files:**
- Modify: `index.html`
- Modify: `styles.css`
- Modify: `src/app.js`
- Create: `src/poster-editor.js`

**Interfaces:**
- Consumes: `renderPoster`, `rowAtCanvasPoint`, poster-model exports
- Produces: third top-level tool selector `data-tool="poster"`
- Produces: `mountPosterEditor(root)`

- [ ] **Step 1: 在 HTML 中加入第三个同级入口和独立工作区**

顶层工具切换保持“题目文本 / YUC 图卡 / 排行榜海报”同级语义。排行榜区自身包含：数据载入、红/黑榜、条目列表、样式面板、预览 Canvas、导出动作和隐藏文件输入。若当前远端页面尚未包含 YUC 前端工作区，则只添加兼容的三项切换容器，不伪造 YUC 功能实现；保留现有页面内容作为“题目文本”面板。

- [ ] **Step 2: 让 `app.js` 只负责顶层工具切换并挂载 poster editor**

现有问卷事件逻辑保持不变。海报入口第一次打开时动态调用 `mountPosterEditor()`；离开再回来保留当前海报状态。

- [ ] **Step 3: 实现榜单 JSON/项目 JSON 载入和条目编辑**

支持 `tools/ranking-poster/sample.json` 同形结构，也支持编辑器自己导出的项目 JSON。每个条目可以修改标题、人工两行标题、分数、评分人数、BGM 分数；修改后立即重绘。

- [ ] **Step 4: 实现完整预览交互**

Canvas CSS 缩放到可视宽度，但内部 width/height 永远 1200/1800。点击 Canvas 行后选中对应条目并滚动到编辑卡片；当前选中行在编辑列表中突出显示。

- [ ] **Step 5: 静态语法检查**

Run: `node --check src/app.js`

Run: `node --check src/poster-editor.js`

Expected: exit 0。

---

### Task 4: 实现视觉图导入和 699×136 非破坏裁切

**Files:**
- Modify: `src/poster-editor.js`
- Modify: `styles.css`
- Modify: `src/poster-model.js`
- Test: `tests/poster-model.test.mjs`

**Interfaces:**
- Consumes: `cropTransform()`
- Produces: per-item image picker and crop modal/panel
- Produces: crop state `{zoom, offsetX, offsetY}`

- [ ] **Step 1: 为裁切边界补失败测试**

测试超大正负 offset 会被夹在可见范围；zoom 最小为 1；不同原图比例都能覆盖 699×136。

- [ ] **Step 2: 实现图片选择**

选择图片后使用 `URL.createObjectURL(file)` 与 `Image.decode()`，保存文件名和会话 URL；替换图片时回收旧 URL。项目导入后缺图时显示“重新选择图片”。

- [ ] **Step 3: 实现裁切界面**

裁切视窗严格保持 699:136。拖动更新 offset；范围滑杆和滚轮更新 zoom；“居中复位”写回 `{zoom:1,offsetX:0,offsetY:0}`。裁切预览与最终 Canvas 使用同一 `cropTransform()`，避免两套算法。

- [ ] **Step 4: 运行模型测试和语法检查**

Run: `node --test tests/poster-model.test.mjs`

Run: `node --check src/poster-editor.js`

Expected: PASS / exit 0。

---

### Task 5: 实现字体/字号微调、本地字体和导出

**Files:**
- Modify: `src/poster-editor.js`
- Modify: `src/poster-renderer.js`
- Modify: `styles.css`
- Test: `tests/poster-model.test.mjs`

**Interfaces:**
- Produces: style controls compatible with current `style.example.json` roles
- Produces: `loadLocalFont(file, role)` via `FontFace`
- Produces: transparent PNG download and project JSON download/import

- [ ] **Step 1: 增加样式状态测试**

项目规范化必须保留 `fontFamilies/fontSizes/headerLineGap/deltaMinusYOffset`，缺值回落到 Pillow 当前默认值；项目序列化不得保存字体二进制或 blob URL。

- [ ] **Step 2: 实现样式控件**

提供主标题、副标题、动画标题、排名、平均分、差值、辅助字的字体族输入和字号输入；另外提供标题行距和负号 y 偏移。所有控件 input/change 后实时重绘。

- [ ] **Step 3: 实现本地字体加载**

文件只通过 `FontFace` 注册到 `document.fonts`，给会话生成稳定 family 名并写入对应角色；不持久化字体二进制。加载失败显示本地错误，不影响已有海报。

- [ ] **Step 4: 实现导出**

PNG：`canvas.toBlob(..., 'image/png')`，下载原始 1200×1800 透明画布。项目 JSON：调用模型序列化；重新载入后恢复文字/数值/样式/裁切并提示重新选图。

- [ ] **Step 5: 运行全部 Node 测试**

Run: `npm test`

Expected: 现有问卷测试与新增 poster 测试全部 PASS。

---

### Task 6: 集成复核与文档收尾

**Files:**
- Modify: `README.md`
- Modify: `tools/ranking-poster/README.md`
- Verify: `index.html`, `styles.css`, `src/*.js`, `tests/*.mjs`

**Interfaces:**
- Produces: documented startup and poster-editor workflow

- [ ] **Step 1: 更新文档**

README 说明第三个顶层入口、榜单 JSON → 补图 → 裁切 → 调字体 → 导 PNG 的流程；明确图片和字体不上传、项目 JSON 不含图片、原始 Excel 不进入仓库。`tools/ranking-poster/README.md` 说明 Python 版继续作为离线参考实现。

- [ ] **Step 2: 全量语法和测试检查**

Run: `npm test`

Run: `node --check src/model.js`

Run: `node --check src/generators.js`

Run: `node --check src/app.js`

Run: `node --check src/poster-model.js`

Run: `node --check src/poster-renderer.js`

Run: `node --check src/poster-editor.js`

Expected: 全部退出码 0，测试无失败。

- [ ] **Step 3: 浏览器人工验收**

用 `npm run dev` 打开本地页面：切到排行榜海报，载入红榜 JSON；给至少两项导入不同宽高比图片；拖动/缩放裁切；修改一个字体族和字号；点击预览行联动条目；导出 PNG 和项目 JSON；重载项目确认图片提示重新选择。检查导出的 PNG 尺寸 1200×1800 且透明区域 alpha=0。

- [ ] **Step 4: 对照范围检查**

确认未添加 Excel 解析、Bangumi 网络请求、图片上传、字体上传、自由旋转/滤镜/任意图层；确认仓库内没有用户原始问卷文件。
