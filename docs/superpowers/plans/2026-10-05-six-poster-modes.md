# 排行榜海报六模式扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有排行榜海报工具从红榜、黑榜、争议度、喜爱度 4 种模式扩展为 6 种，新增中期→完结变化榜与相对 Bangumi 偏差榜，并把所有箭头阈值变为项目级可编辑参数。

**Architecture:** 继续由 `src/poster-model.js` 统一负责模式、标准化、排序/5+5 分区和箭头状态；`src/poster-renderer.js` 只消费标准化项目绘制 1200×1800 Canvas；`src/poster-editor.js` 暴露模式相关字段和阈值控件；本地状态存储只扩展模式白名单。Pillow 参考实现同步六种模式的数据含义，不改变既有几何、视觉方案、裁切和字体体系。

**Tech Stack:** HTML5、CSS、ES modules、Canvas 2D、Node.js built-in test runner、Python/Pillow 离线参考实现

**Spec:** `docs/superpowers/specs/2026-10-05-six-poster-modes-design.md`

## Global Constraints

- 画布继续固定 1200×1800，十行坐标和 699×136 视觉区不变。
- 不破坏已有图片缓存、视觉方案库、TMDB 映射、裁切、字体和模式独立持久化。
- 不引入第三方 Node 依赖，不解析或提交原始 `.xlsx`。
- 新项目序列化只输出新阈值字段；旧 red/black 阈值按当前模式迁移，旧 controversy 两套阈值不迁移。
- `red`、`black`、`bgm-deviation` 共用评分-vs-BGM阈值；`controversy` 改为统一一套 SD 差值阈值。
- `controversy`、`midseason-change`、`bgm-deviation` 都采用互斥的 5+5 双分区。

## Review Focus

1. 旧 red/black JSON 迁移是否严格按当前模式选取旧阈值，且序列化后不继续保留旧字段。
2. 三种 5+5 模式是否保证同一条目不会同时进入上下两区。
3. 中期变化的正/负/零边界与可调阈值是否按 spec 的 `< down`、`> up`、其余 flat 实现。
4. 新的带连字符模式名是否在浏览器、本地状态白名单和静态 sample 服务中完整贯通。
5. 浏览器 Canvas 与 Pillow 参考实现对主值、比较值、底栏和箭头语义是否一致。

---

### Task 1: 扩展模型、阈值与六模式排序

**Files:**
- Modify: `src/poster-model.js`
- Modify: `tests/poster-model.test.mjs`
- Create: `tests/poster-six-modes.test.mjs`

**Interfaces:**
- `normalizePosterProject()` 接受六种模式
- item 新增 `midseasonScore`、`midseasonVoters`
- thresholds 新结构：`scoreBgmDown/Up`、`favoriteDown/Up`、`controversyDown/Up`、`midseasonDown/Up`
- `posterDisplayRows()` 支持三种 5+5 模式
- 新增 `midseasonTrendState()`；`trendState()` 使用统一 score-vs-BGM 阈值

- [ ] **Step 1: 写失败测试**

覆盖六种模式 normalize/serialize、旧 red/black 阈值迁移、新阈值优先、旧 controversy 回落新默认值、midseason 字段、统一评分阈值、统一争议阈值、中期阈值、三种 5+5 分区和上下区互斥。

- [ ] **Step 2: 运行模型测试确认 RED**

Run: `node --test tests/poster-model.test.mjs tests/poster-six-modes.test.mjs`

Expected: FAIL，原因是新模式/字段/阈值/函数尚不存在。

- [ ] **Step 3: 实现最小模型扩展**

只改模型层，不碰 DOM。对双分区排序保持稳定的二级排序；兼容现有 favorite 接口和视觉字段。

- [ ] **Step 4: 运行模型测试确认 GREEN**

Run: `node --test tests/poster-model.test.mjs tests/poster-six-modes.test.mjs`

Expected: PASS。

---

### Task 2: 扩展 Canvas 渲染与本地状态/静态服务

**Files:**
- Modify: `src/poster-renderer.js`
- Modify: `scripts/poster-asset-store.mjs`
- Modify: `scripts/serve.mjs`
- Modify: `tests/poster-renderer.test.mjs`
- Modify: `tests/poster-asset-store.test.mjs`
- Modify: `tests/serve.test.mjs`
- Modify: `tests/poster-api.test.mjs`

**Interfaces:**
- 双分区 badge：controversial/consistent、improved/declined、above/below
- `midseason-change` 比较 `score-midseasonScore`，底栏 `MID Nn / MID x.xx`
- `bgm-deviation` 比较 `score-bgmScore`，底栏与 red/black 相同
- 本地状态白名单接受六种 mode；静态服务暴露两份新 sample

- [ ] **Step 1: 写失败测试**

覆盖新模式状态路径、静态 sample 路径、渲染源码中的三套双分区 badge/中期底栏，以及新模式 API round-trip。

- [ ] **Step 2: 运行聚焦测试确认 RED**

Run: `node --test tests/poster-renderer.test.mjs tests/poster-asset-store.test.mjs tests/serve.test.mjs tests/poster-api.test.mjs tests/poster-six-modes.test.mjs`

Expected: FAIL，新模式尚未接入渲染/服务。

- [ ] **Step 3: 实现渲染与服务扩展**

保留既有几何和颜色；只按 mode 选择 metric、comparison、footer、badge 和 trend helper。

- [ ] **Step 4: 运行聚焦测试确认 GREEN**

Run: 同 Step 2。

Expected: PASS。

---

### Task 3: 扩展浏览器编辑器与可调阈值 UI

**Files:**
- Modify: `poster.html`
- Modify: `poster.css`
- Modify: `src/poster-editor.js`
- Modify: `tests/poster-page.test.mjs`
- Modify: `tests/poster-controversy.test.mjs`
- Modify: `tests/poster-favorite.test.mjs`
- Modify: `tests/poster-six-modes.test.mjs`

**Interfaces:**
- 工具栏和 select 提供六模式
- mode-specific threshold controls 显示两个数字输入并即时写回 `project.thresholds`
- 中期模式编辑：完结均分、中期均分、中期评分人数
- 三种双分区在左侧编辑列表显示对应分区标题
- 六模式继续使用各自独立 `.local/poster-projects/<scope>--<mode>.json`

- [ ] **Step 1: 写失败测试**

断言页面有两种新模式按钮/选项和阈值控件；编辑器包含六 SAMPLE_PATHS、六模式标签、阈值 key 映射、中期字段和三种双分区标题。

- [ ] **Step 2: 运行页面测试确认 RED**

Run: `node --test tests/poster-page.test.mjs tests/poster-controversy.test.mjs tests/poster-favorite.test.mjs tests/poster-six-modes.test.mjs`

Expected: FAIL。

- [ ] **Step 3: 实现编辑器**

使用通用的两个阈值输入框，根据 mode 替换标签和字段 key；不复制四套 UI。模式切换、保存和恢复沿用现有流程。

- [ ] **Step 4: 运行页面测试和语法检查确认 GREEN**

Run: `node --test tests/poster-page.test.mjs tests/poster-controversy.test.mjs tests/poster-favorite.test.mjs tests/poster-six-modes.test.mjs`

Run: `node --check src/poster-editor.js && node --check src/poster-renderer.js && node --check src/poster-model.js`

Expected: PASS / exit 0。

---

### Task 4: 更新六份样例为完结调查数据

**Files:**
- Modify: `tools/ranking-poster/sample.json`
- Modify: `tools/ranking-poster/sample-black.json`
- Modify: `tools/ranking-poster/sample-favorite.json`
- Modify: `tools/ranking-poster/sample-controversy.json`
- Create: `tools/ranking-poster/sample-midseason-change.json`
- Create: `tools/ranking-poster/sample-bgm-deviation.json`
- Modify: `tests/poster-six-modes.test.mjs`

- [ ] **Step 1: 写 sample 失败测试**

六份 sample 都必须 normalize 后产生恰好 10 个展示行；双分区各自 5+5；阈值字段必须是新结构；中期 sample 的底层数据使用中期评分人数而不是完结人数。

- [ ] **Step 2: 运行 sample 测试确认 RED**

Run: `node --test tests/poster-six-modes.test.mjs`

Expected: FAIL，因为两份 sample 尚不存在且旧 sample 仍是中期数据/旧阈值。

- [ ] **Step 3: 写入已确认的六张完结榜数据**

采用当前调查统一的完结有效评分人数 ≥8 结果；中期变化 sample 使用中期评分人数；不写入原始问卷数据。

- [ ] **Step 4: 运行 sample 测试确认 GREEN**

Run: `node --test tests/poster-six-modes.test.mjs`

Expected: PASS。

---

### Task 5: 同步 Pillow 参考实现与文档，跑全量回归

**Files:**
- Modify: `tools/ranking-poster/render.py`
- Modify: `tools/ranking-poster/test_render.py`
- Modify: `tools/ranking-poster/README.md`
- Modify: `README.md`

- [ ] **Step 1: 更新 Python 失败测试**

覆盖统一 score-vs-BGM 阈值、统一 controversy 阈值、新的 midseason/bgm-deviation 排序和 5+5 展示语义。

- [ ] **Step 2: 运行 Python 测试确认 RED**

Run: `python -m unittest tools/ranking-poster/test_render.py`

Expected: FAIL。

- [ ] **Step 3: 实现 Pillow 六模式兼容并更新文档**

Pillow 只保持离线参考实现，不复制浏览器编辑器阈值 UI；从 JSON 读取同一套阈值和字段。

- [ ] **Step 4: 全量验证**

Run: `npm test`

Run: `python -m unittest tools/ranking-poster/test_render.py`

Run: `node --check src/poster-model.js`

Run: `node --check src/poster-renderer.js`

Run: `node --check src/poster-editor.js`

Run: `node --check scripts/poster-asset-store.mjs`

Run: `node --check scripts/serve.mjs`

Expected: 全部 PASS / exit 0。

- [ ] **Step 5: 范围检查**

确认未提交 `.xlsx`、字体文件、`.local/` 用户素材；确认 `master` 未修改，所有变更只在 `feature/six-poster-modes`。
