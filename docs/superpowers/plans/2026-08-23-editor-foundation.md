# 动画投票编辑器基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把当前固定范式单页工具改成自由题目模板编辑器，并建立题目页、图片页共享且刷新不丢失的本地项目。

**Architecture:** 继续使用原生 HTML、CSS 和 ES modules。纯数据模型负责模板与题目展开，平台生成器只输出真实页面已经验证过的文本语法，IndexedDB 保存项目和图片 Blob；题目页与图片页通过 `BroadcastChannel` 同步。此计划不实现 yuc.wiki 获取，不生成没有真实消费者的图片上传任务，也不操作问卷星或腾讯问卷编辑器。

**Tech Stack:** HTML5、Bangumi Frontend 官方组件 CSS 的原生 CSS 移植、ES modules、IndexedDB、BroadcastChannel、Browser File API、Node.js 20+ built-in test runner

**Spec:** `docs/superpowers/specs/2026-08-23-anime-vote-generator-design.md`

## Global Constraints

- 问卷文本导入和图片上传始终是两个阶段；本计划只完成文本和本地图片管理，不生成 `ImageUploadTask[]`，也不上传图片。
- 不创建问卷星或腾讯问卷的模拟页面，不用自造 DOM 证明平台适配器可行。
- 不自动登录、发布、分享、提交或开始回收问卷。
- 逐部图片模式不得生成矩阵题。
- 只输出 `form-import-findings.md` 已在真实页面验证的题型语法；不支持的“平台 + 题型”组合必须给出错误。
- 页面控件只机械移植锁定版本的 Bangumi 官方 Button、Input、Tab、Select 和 Editor 规则；本项目布局单独标明，不冒充官方 Layout。
- 不新增运行时或测试第三方依赖。
- 既有实测文档、YUC 证据图片和历史提交不得删除。

## File Map

- `src/model.js`：动画条目、自由题目模板、占位符替换、项目验证和 v1→v2 数据迁移。
- `src/generators.js`：跨平台中间题目和平台文本。
- `src/project-store.js`：IndexedDB 项目/图片存储和跨页通知。
- `src/app.js`：题目页状态、模板编辑、预览、导入文本和自动保存。
- `src/images-app.js`：图片页状态、本地图片写入、版本选择和自动保存。
- `index.html`：题目编辑页。
- `images.html`：图片工作页。
- `bangumi-components.css`：从锁定提交逐项机械转换的 Bangumi 控件规则。
- `styles.css`：只包含本项目自己的页面结构和状态布局。
- `THIRD_PARTY_NOTICES.md`：Bangumi Frontend 来源文件与 BSD-3-Clause 许可说明。
- `tests/model.test.mjs`：模板、迁移和项目验证。
- `tests/generators.test.mjs`：两平台文本和题目展开。
- `tests/serve.test.mjs`：两个页面和新增模块的静态服务白名单。

---

### Task 1: 用自由题目模板替换固定范式

**Files:**
- Modify: `src/model.js`
- Modify: `tests/model.test.mjs`

**Interfaces:**
- Produces: `QUESTION_TYPES: Set<'single' | 'multiple' | 'dropdown' | 'scale' | 'shortText' | 'longText'>`
- Produces: `EXPANSION_MODES: Set<'perAnime' | 'allAsOptions'>`
- Produces: `createQuestionTemplate(overrides?): QuestionTemplate`
- Produces: `interpolatePrompt(prompt, entry, index): string`
- Produces: `normalizeProjectRecord(record): VoteProjectV2`
- Produces: `validateProject(project): { errors: Issue[], warnings: Issue[] }`

- [ ] **Step 1: 把模型测试改成自由模板的失败测试**

在 `tests/model.test.mjs` 删除依赖 `project.template = 'vote'` 的断言，加入：

```js
const template = createQuestionTemplate({
  expansion: 'perAnime',
  prompt: '你对《{title}》的期待度是？',
  type: 'scale',
  scale: { min: 1, max: 5, minLabel: '没兴趣', maxLabel: '很期待' },
});

assert.equal(template.type, 'scale');
assert.equal(
  interpolatePrompt(template.prompt, { title: '世界舞动' }, 0),
  '你对《世界舞动》的期待度是？',
);
assert.equal(interpolatePrompt('第 {index} 部：{title}', { title: '世界舞动' }, 1), '第 2 部：世界舞动');
```

加入无效题型、选项不足、量表越界、未知占位符以及没有 `{title}` 时的验证断言：

```js
assert.equal(validateProject(projectWithUnknownType).errors[0].code, 'unsupported-question-type');
assert.ok(validateProject(singleChoiceWithOneOption).errors.some((x) => x.code === 'too-few-options'));
assert.ok(validateProject(scaleWithMinAboveMax).errors.some((x) => x.code === 'invalid-scale-range'));
assert.ok(validateProject(perAnimePromptWithoutTitle).warnings.some((x) => x.code === 'prompt-without-title'));
assert.ok(validateProject(projectWithUnknownPlaceholder).errors.some((x) => x.code === 'unknown-placeholder'));
assert.ok(validateProject(allAsOptionsWithTitlePlaceholder).errors.some((x) => x.code === 'placeholder-not-available'));
```

只允许 `{title}` 和 `{index}`。`allAsOptions` 只有一份聚合题干，没有当前动画，因而不允许使用这两个逐部占位符；聚合方式只支持 `single`、`multiple` 和 `dropdown`。

- [ ] **Step 2: 运行模型测试并确认旧模型不能满足新断言**

Run: `node --test tests/model.test.mjs`

Expected: FAIL，错误指向 `createQuestionTemplate`、`interpolatePrompt` 或 `normalizeProjectRecord` 尚未导出。

- [ ] **Step 3: 实现 v2 模型与迁移**

在 `src/model.js` 定义默认模板：

```js
export const DEFAULT_QUESTION_TEMPLATE = Object.freeze({
  expansion: 'perAnime',
  prompt: '你对《{title}》的期待度是？',
  type: 'scale',
  options: ['推荐', '不推荐'],
  scale: { min: 1, max: 5, minLabel: '完全不感兴趣', maxLabel: '非常期待' },
});
```

`createEntry()` 改为持久化图片标识，不再把 blob URL 当成项目数据：

```js
{
  id,
  title,
  order,
  sourceUrl: '',
  visualAssetId: '',
  infoCardAssetId: '',
  selectedAssetId: ''
}
```

`normalizeProjectRecord()` 把当前 v1 三种范式机械迁移为：

```js
const legacyTemplates = {
  vote: { expansion: 'allAsOptions', prompt: '本季你最期待哪一部动画？', type: 'single' },
  score: { expansion: 'perAnime', prompt: '请为《{title}》评分', type: 'scale' },
  status: {
    expansion: 'perAnime',
    prompt: '《{title}》的追番状态',
    type: 'dropdown',
    options: ['必追', '观望', '不追', '尚未决定'],
  },
};
```

序列化版本升级为 `version: 2`，并保留动画顺序和资源 ID。

- [ ] **Step 4: 运行模型测试**

Run: `node --test tests/model.test.mjs`

Expected: PASS；v1 项目迁移后不再含 `template: 'vote' | 'score' | 'status'`，而是含完整 `questionTemplate`。

- [ ] **Step 5: 提交自由模板模型**

```bash
git add src/model.js tests/model.test.mjs
git commit -m "feat: model editable anime question templates"
```

---

### Task 2: 生成真实可导入文本

**Files:**
- Modify: `src/generators.js`
- Modify: `tests/generators.test.mjs`

**Interfaces:**
- Consumes: `VoteProjectV2` from `src/model.js`
- Produces: `expandQuestions(project): ExpandedQuestion[]`
- Preserves: `generateImportText(project): string`

- [ ] **Step 1: 用平台能力表替换六个固定范式测试**

在 `tests/generators.test.mjs` 建立一个每部动画量表模板，并断言问卷星和腾讯问卷都展开成两道独立题：

```js
const sampleProject = project('wjx', {
  expansion: 'perAnime',
  prompt: '请为《{title}》评分',
  type: 'scale',
  scale: { min: 1, max: 5, minLabel: '低', maxLabel: '高' },
});
const questions = expandQuestions(sampleProject);
const text = generateImportText(sampleProject);

assert.equal(questions.length, 2);
assert.equal((text.match(/\[量表题\]/g) ?? []).length, 2);
assert.doesNotMatch(text, /\[矩阵题\]/);
```

为选项模式断言只生成一道题；问卷星选项使用连续 `A.` 前缀，腾讯选项不加前缀：

```js
assert.match(wjxText, /A\.世界舞动\nB\.相反的你和我/);
assert.match(tencentText, /\[单选题\]\n世界舞动\n相反的你和我/);
```

加入平台不支持组合：问卷星 `dropdown` 和 `longText` 必须抛出“尚未实测支持”，腾讯六种题型都使用 `form-import-findings.md` 已验证标签。

- [ ] **Step 2: 运行生成器测试并确认固定范式实现失败**

Run: `node --test tests/generators.test.mjs`

Expected: FAIL，旧代码仍要求 `project.template`，并会为问卷星评分生成矩阵。

- [ ] **Step 3: 实现跨平台中间题目**

`expandQuestions()` 输出统一结构：

```js
{
  ordinal: 1,
  prompt: '请为《世界舞动》评分',
  type: 'scale',
  options: [],
  scale: { min: 1, max: 5, minLabel: '低', maxLabel: '高' },
  animeEntryId: 'one',
  selectedAssetId: 'asset-one'
}
```

`allAsOptions` 输出一道题，`options` 来自动画标题，`animeEntryId` 和 `selectedAssetId` 为空，因为平台文本导入不能给每个选项分别绑定图片。

- [ ] **Step 4: 实现实测平台映射**

问卷星使用：

- `single`：题干不加标签，选项使用连续 `A.`、`B.`。
- `multiple`：`[多选题]`，选项使用连续字母前缀。
- `scale`：`[量表题]` 和 `1(低)~5(高)`。
- `shortText`：编号题干，无选项和标签。
- `dropdown`、`longText`：阻止生成，因为当前问卷星实测记录没有稳定模板。

腾讯问卷使用显式 `[单选题]`、`[多选题]`、`[下拉题]`、`[量表题]`、`[单行文本题]`、`[多行文本题]`；题目前不添加人工编号。

- [ ] **Step 5: 运行生成器测试**

Run: `node --test tests/generators.test.mjs`

Expected: PASS；输出无矩阵、无零宽字符、无标签尾空格，也不包含平台图片上传任务或 DOM 假设。

- [ ] **Step 6: 提交生成器**

```bash
git add src/generators.js tests/generators.test.mjs
git commit -m "feat: generate editable anime questions"
```

---

### Task 3: 用真实 IndexedDB 保存项目和图片 Blob

**Files:**
- Create: `src/project-store.js`
- Modify: `src/model.js`
- Modify: `tests/model.test.mjs`

**Interfaces:**
- Produces: `openProjectStore(indexedDBFactory = globalThis.indexedDB): Promise<ProjectStore>`
- Produces: `ProjectStore.saveProject(project): Promise<void>`
- Produces: `ProjectStore.loadProject(id): Promise<VoteProjectV2 | null>`
- Produces: `ProjectStore.listProjects(): Promise<VoteProjectV2[]>`
- Produces: `ProjectStore.saveAsset(asset): Promise<string>`
- Produces: `ProjectStore.loadAsset(id): Promise<AssetRecord | null>`
- Produces: `ProjectStore.deleteAsset(id): Promise<void>`
- Produces: `createProjectChannel(projectId): { post(type): void, close(): void, subscribe(listener): () => void }`

- [ ] **Step 1: 先为可纯测的记录迁移补失败测试**

把 IndexedDB 无关的迁移留在 `model.js`，断言旧 JSON 导入、资源 ID 和条目顺序稳定。Node 测试不伪造 IndexedDB：

```js
const migrated = normalizeProjectRecord(JSON.parse(legacyJson));
assert.equal(migrated.version, 2);
assert.deepEqual(migrated.entries.map((entry) => entry.order), [0, 1]);
assert.equal(migrated.questionTemplate.expansion, 'allAsOptions');
```

- [ ] **Step 2: 实现 IndexedDB 两个对象仓库**

数据库名固定为 `bangumi-easy-vote`，版本为 `1`：

```js
request.onupgradeneeded = () => {
  const db = request.result;
  if (!db.objectStoreNames.contains('projects')) {
    db.createObjectStore('projects', { keyPath: 'id' });
  }
  if (!db.objectStoreNames.contains('assets')) {
    db.createObjectStore('assets', { keyPath: 'id' });
  }
};
```

`AssetRecord` 使用 `{ id, animeEntryId, kind, filename, mimeType, createdAt, blob }`；`kind` 只允许 `visual` 或 `infoCard`。

- [ ] **Step 3: 实现项目级跨页通知**

频道名固定为 `bangumi-easy-vote:<projectId>`，消息只包含 `{ type: 'project-saved', projectId }` 或 `{ type: 'asset-saved', projectId, assetId }`。消息不携带 Blob，接收页收到后重新从 IndexedDB 读取。

- [ ] **Step 4: 在真实本地浏览器验证，不使用存储模拟器**

Run: `npm run dev`

在本地页面的真实浏览器上下文中执行以下验收：

1. 保存一个含两部动画的项目。
2. 保存一个实际的小 PNG `Blob` 并把其 ID 写入第一部动画。
3. 关闭数据库连接后重新打开，读取项目和图片。
4. 刷新页面，再次确认标题、顺序、`Blob.size` 和 `Blob.type` 未变化。
5. 在第二个本地标签页订阅同一项目频道，保存后确认收到一次通知并能从 IndexedDB 读到新值。

只有真实 Chromium IndexedDB 结果通过后才把本任务标为完成。

- [ ] **Step 5: 运行 Node 回归测试**

Run: `npm test`

Expected: 所有纯模型、生成器和服务器测试 PASS；Node 测试不声称验证了 IndexedDB。

- [ ] **Step 6: 提交本地项目仓库**

```bash
git add src/project-store.js src/model.js tests/model.test.mjs
git commit -m "feat: persist vote projects and image assets"
```

---

### Task 4: 直接移植 Bangumi 控件 CSS 并重建题目页

**Files:**
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `bangumi-components.css`
- Delete: `tokens.css`
- Modify: `styles.css`
- Modify: `index.html`
- Modify: `src/app.js`

**Interfaces:**
- Consumes: `createQuestionTemplate`, `validateProject`, `expandQuestions`, `generateImportText`, `openProjectStore`
- Produces: 可编辑 `questionTemplate` 的题目页和自动保存项目

- [ ] **Step 1: 记录官方来源与许可证**

在 `THIRD_PARTY_NOTICES.md` 记录：

- Repository: `https://github.com/bangumi/frontend`
- Commit: `b288723022873123cb8c8ccf77c2baf3c98bfb84`
- License: BSD-3-Clause
- Source paths: `packages/website/src/index.css`、`packages/design/components/Button/index.tsx`、`Input/index.tsx`、`Tab/index.tsx`、`Select/index.tsx`、`EditorForm/Editor.tsx`
- Modification: CSS and component style objects mechanically translated to vanilla CSS selectors used by this project.

并完整保留官方 `LICENSE` 中的版权声明、三项许可条件和免责声明，不能只写许可证名称。

- [ ] **Step 2: 删除命名主题并建立可追溯的控件样式文件**

删除 `tokens.css` 及其 HTML 引用，不再维持一套自行命名的主题变量。新建 `bangumi-components.css`，文件头只保留必要的来源提交、原始路径和许可证通知位置。控件使用 `bgm-button`、`bgm-input`、`bgm-tab`、`bgm-select` 和 `bgm-editor` 类，方便逐项回查。

删除 `styles.css` 顶部 Hallmark 主题注释、Google Fonts 依赖、现有彩色卡片变量和宣传式装饰。

- [ ] **Step 3: 机械移植实际使用的官方控件规则**

按钮保留官方 `14px/600`、`38px` 高度、`2px` 边框、半高圆角和主/次/蓝色状态；Input 保留 `2px solid #e8e3e3`、`12px` 普通圆角、聚焦 `#c8c2c2`；Tab 保留 `#facdd0` 轨道和 `#f09199` 激活项。`textarea` 和 `select` 分别按锁定提交中的 Editor 和 Select 源规则转换，不能套用 Input 后声称来自官方。

`styles.css` 的编辑器布局属于本项目自有规则。官方 Layout 的“主栏 + 246px 右栏”只能作为来源记录，不能直接套在不相同的信息结构上，也不能把项目自有响应式布局标为 Bangumi CSS。

- [ ] **Step 4: 把 HTML 改为紧凑题目编辑器**

删除大标题、介绍段、固定范式卡、常驻诊断说明和口号式 footer。保留：

```html
<nav class="bgm-tab app-tabs" aria-label="工作区">
  <a class="bgm-tab__item bgm-tab__item--active" href="/">题目</a>
  <a class="bgm-tab__item" href="/images.html">图片</a>
</nav>
```

模板区提供 `expansion-mode`、`question-prompt`、`question-type`、`question-options` 和四个量表字段。根据题型只显示有关字段。

- [ ] **Step 5: 重写题目页状态与自动保存**

`src/app.js` 启动时：

1. 打开 `ProjectStore`。
2. 从 URL `?project=<id>` 或最近项目读取数据。
3. 表单每次修改后更新内存，250ms 防抖保存。
4. 调用 `expandQuestions()` 和 `generateImportText()` 更新实例预览和文本。
5. 错误显示在对应字段旁；平台不支持当前题型时禁用复制和下载。

固定的 `templateInputs` 和 `expectedQuestionCount()` 分支全部删除。

- [ ] **Step 6: 在真实本地页面验证题型联动**

Run: `npm run dev`

在本地页面依次选择六种题型，确认选项区、量表区和文本区只在有关题型出现；输入两部动画后切换 `perAnime/allAsOptions`，确认实例题数分别为 2 和 1。切到问卷星 `dropdown` 时必须明确阻止导出，不得静默变成别的题型。

- [ ] **Step 7: 运行回归测试并提交题目页**

Run: `npm test`

Expected: PASS。

```bash
git add THIRD_PARTY_NOTICES.md bangumi-components.css tokens.css styles.css index.html src/app.js
git commit -m "feat: rebuild question editor with Bangumi styles"
```

---

### Task 5: 建立共享图片页并验证跨页工作流

**Files:**
- Create: `images.html`
- Create: `src/images-app.js`
- Modify: `src/app.js`
- Modify: `styles.css`
- Modify: `scripts/serve.mjs`
- Modify: `tests/serve.test.mjs`

**Interfaces:**
- Consumes: `ProjectStore`, `createProjectChannel(projectId)`
- Produces: 本地图片写入、视觉图/资料卡槽位选择、两个页面即时同步

- [ ] **Step 1: 先扩展静态服务器失败测试**

在 `tests/serve.test.mjs` 加入：

```js
assert.equal(resolveRequestPath('/images.html', root), path.join(root, 'images.html'));
assert.equal(
  resolveRequestPath('/src/images-app.js', root),
  path.join(root, 'src', 'images-app.js'),
);
assert.equal(resolveRequestPath('/src/platform-adapters/wjx.js', root), null);
```

Run: `node --test tests/serve.test.mjs`

Expected: `images.html` 当前返回 `null`，测试 FAIL。

- [ ] **Step 2: 创建与题目页一致的图片页骨架**

`images.html` 使用同一顶部 Tab 和项目 ID。左侧列出动画缩略图和标题；主区只提供本地视觉图、本地资料卡两个文件入口、当前两张预览以及“设为问卷图片”。不放置假 YUC 抓取按钮。

- [ ] **Step 3: 把真实文件 Blob 写入 IndexedDB**

`src/images-app.js` 对用户选择的文件调用：

```js
const assetId = await store.saveAsset({
  animeEntryId: entry.id,
  kind: selectedKind,
  filename: file.name,
  mimeType: file.type,
  blob: file,
});
```

更新 `visualAssetId` 或 `infoCardAssetId`；若 `selectedAssetId` 为空，则自动选择新资源。预览通过 `URL.createObjectURL(record.blob)` 创建，切换条目或卸载页面时撤销。

- [ ] **Step 4: 实现两个页面的实时同步**

题目页和图片页都订阅同一项目频道。收到 `project-saved` 或 `asset-saved` 后重新读取项目；本地正在编辑且尚未保存的字段不被远端刷新覆盖，保存完成后再应用新版本。

- [ ] **Step 5: 放行两个页面和新增模块**

在 `scripts/serve.mjs` 的根文件白名单加入 `images.html` 和 `THIRD_PARTY_NOTICES.md`；保留 `src/<name>.js` 规则，不允许 `src/platform-adapters/`，确保本计划没有偷偷加入平台适配器。

- [ ] **Step 6: 在真实 Chromium 中做完整本地验收**

同时打开：

- `http://127.0.0.1:4173/?project=<same-id>`
- `http://127.0.0.1:4173/images.html?project=<same-id>`

完成以下真实操作：

1. 题目页加入两部动画，图片页无需刷新即出现两项。
2. 图片页从磁盘选择一张实际 PNG/JPEG，题目页无需刷新即显示对应缩略图。
3. 图片页在视觉图与资料卡之间切换 `selectedAssetId`，题目页的对应缩略图和缺图状态同步改变。
4. 刷新两个页面，数据和图片仍在。
5. 关闭其中一个页面，另一个页面继续可编辑，不出现通道错误。

这一验收只证明本地跨页与 IndexedDB；报告中不得把它表述为问卷平台上传已验证。

- [ ] **Step 7: 运行全部测试并提交图片页**

Run: `npm test`

Expected: 所有测试 PASS。

```bash
git add images.html src/images-app.js src/app.js styles.css scripts/serve.mjs tests/serve.test.mjs
git commit -m "feat: share local image assets across workspaces"
```

---

### Task 6: 更新使用说明并做基础完成检查

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-23-editor-foundation.md`

**Interfaces:**
- Documents: 自由模板、两页共享项目、平台能力边界和后续真实页面工作

- [ ] **Step 1: 更新 README 的实际能力**

README 必须写明：

- `npm run dev` 后的题目页和图片页地址。
- `{title}`、`{index}` 占位符及两种展开方式。
- 问卷星当前阻止 `dropdown`、`longText`，原因是没有稳定实测文本模板。
- 图片保存在浏览器 IndexedDB，不进入导入文本。
- 当前版本不生成平台图片上传任务，也不操作问卷平台编辑器；必须先在真实页面验证上传链路。
- yuc.wiki 获取和平台图片上传分别需要后续真实页面计划。

- [ ] **Step 2: 运行完整验证**

Run: `npm test`

Expected: 所有测试 PASS。

Run: `git diff --check`

Expected: 无空白错误。

- [ ] **Step 3: 检查计划完成标记并提交文档**

把本计划已实际完成的 checkbox 改为 `[x]`；没有经过真实 Chromium 验收的步骤保持 `[ ]`，不得为了完成率勾选。

```bash
git add README.md docs/superpowers/plans/2026-08-23-editor-foundation.md
git commit -m "docs: explain the local editor foundation"
```

## Deferred Real-Site Work

以下内容不属于本计划，也不能用模拟页面代替：

1. yuc.wiki 视觉图原图、横向资料卡原图和本地 Chromium 重渲染，使用单独实施计划和真实季度页面验收。
2. 问卷星图片上传适配器，必须在登录后的真实编辑页发现控件、核对题目并验证实际上传结果。
3. 腾讯问卷图片上传适配器，必须单独实测，不复用问卷星 DOM 假设。
