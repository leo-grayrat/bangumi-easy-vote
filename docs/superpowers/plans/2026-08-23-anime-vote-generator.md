# 动画投票生成器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个零第三方依赖的本地单页工具，将批量动画标题或视觉图转换为问卷星/腾讯问卷可导入文本。

**Architecture:** 使用原生 HTML、CSS 和浏览器 JavaScript；数据模型、平台生成器和 DOM 交互分离。Node.js 仅用于运行内置测试和本地静态服务器，不参与图片绘制或字体渲染。

**Tech Stack:** HTML5、CSS custom properties、ES modules、Browser File API、Node.js 20+ built-in test runner

**Spec:** `docs/superpowers/specs/2026-08-23-anime-vote-generator-design.md`

## Global Constraints

- 所有功能在本地完成；不上传图片，不调用外部 API，不自动登录或发布问卷。
- 不引入运行时或开发时第三方依赖。
- 只生成 `form-import-findings.md` 已实测通过的题型语法。
- 问卷星可以生成矩阵题；腾讯问卷必须把矩阵语义展开为量表题或下拉题。
- 所有生成文本必须移除零宽字符、BOM、行尾空白和危险的题内空行。
- 页面必须在 320、375、414、768 像素宽度无横向滚动，并支持键盘操作和减少动态效果。
- 保留现有文档和证据图片，不删除或覆盖。

---

### Task 1: 建立可测试的数据模型

**Files:**
- Create: `package.json`
- Create: `src/model.js`
- Create: `tests/model.test.mjs`

**Interfaces:**
- Produces: `deriveTitleFromFilename(filename: string): string`
- Produces: `titlesFromText(text: string): string[]`
- Produces: `createEntry(input: {title: string, imageName?: string, imageUrl?: string}): AnimeEntry`
- Produces: `validateProject(project: VoteProject): {errors: Issue[], warnings: Issue[]}`
- Produces: `serializeProject(project: VoteProject): string`

- [ ] **Step 1: 添加 Node 内置测试入口和失败测试**

创建 `package.json`，只声明模块类型与命令：

```json
{
  "name": "bangumi-easy-vote",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "dev": "node scripts/serve.mjs"
  }
}
```

在 `tests/model.test.mjs` 覆盖以下断言：

```js
assert.equal(deriveTitleFromFilename('世界舞动.visual.jpg'), '世界舞动.visual');
assert.deepEqual(titlesFromText('世界舞动\n\n  相反的你和我  '), ['世界舞动', '相反的你和我']);
assert.equal(validateProject(projectWithDuplicateTitles).warnings[0].code, 'duplicate-title');
assert.equal(JSON.parse(serializeProject(projectWithBlobUrl)).entries[0].imageUrl, undefined);
```

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `npm test`

Expected: FAIL，错误明确指向 `src/model.js` 尚不存在或导出缺失。

- [ ] **Step 3: 实现最小数据模型**

`AnimeEntry` 使用 `{ id, title, imageName, imageUrl }`；`VoteProject` 使用 `{ title, description, platform, template, entries }`。ID 使用 `crypto.randomUUID()`，测试环境不可用时使用单调回退值。序列化时保留 `imageName`，删除仅在当前页面有效的 `imageUrl`。

- [ ] **Step 4: 运行模型测试**

Run: `npm test`

Expected: 所有 `tests/model.test.mjs` 测试 PASS。

- [ ] **Step 5: 提交数据模型**

```bash
git add package.json src/model.js tests/model.test.mjs
git commit -m "feat: add anime vote project model"
```

---

### Task 2: 实现两平台文本生成器

**Files:**
- Create: `src/generators.js`
- Create: `tests/generators.test.mjs`

**Interfaces:**
- Consumes: `VoteProject` from `src/model.js`
- Produces: `sanitizeImportText(text: string): string`
- Produces: `generateImportText(project: VoteProject): string`

- [ ] **Step 1: 为六种平台/范式组合写失败测试**

测试固定包含“世界舞动”和“相反的你和我”两项，并验证：

```js
assert.match(generateImportText(wjxVote), /\[单选题\]/);
assert.match(generateImportText(wjxScore), /\[矩阵题\]/);
assert.match(generateImportText(wjxStatus), /必追 观望 不追 尚未决定/);
assert.equal((generateImportText(qqScore).match(/\[量表题\]/g) ?? []).length, 2);
assert.equal((generateImportText(qqStatus).match(/\[下拉题\]/g) ?? []).length, 2);
assert.doesNotMatch(generateImportText(qqScore), /\[矩阵题\]/);
```

再加入危险输入测试：`U+200B`、BOM、不换行空格、题型标签尾空格、连续空行和行尾制表符均不得出现在输出中。

- [ ] **Step 2: 运行测试并确认生成器尚不存在**

Run: `npm test`

Expected: 模型测试 PASS，生成器测试 FAIL。

- [ ] **Step 3: 实现问卷星生成器**

- `vote`：问卷标题、`[段落说明]`、一个 `[单选题]` 和连续选项行。
- `score`：一个 `[矩阵题]`，列为 `1 2 3 4 5`，每部动画占一行。
- `status`：一个 `[矩阵题]`，列为 `必追 观望 不追 尚未决定`。

- [ ] **Step 4: 实现腾讯问卷生成器**

- `vote`：标题、欢迎语、一个 `[单选题]`。
- `score`：每部动画一个 `[量表题]`，下一行为 `1(完全不感兴趣)~5(非常期待)`。
- `status`：每部动画一个 `[下拉题]`，四个状态连续排列且题内无空行。

- [ ] **Step 5: 实现统一清理并运行全部测试**

清理顺序固定为：标准化换行 → 删除 BOM/零宽字符 → 转换 NBSP → 删除行尾空白 → 折叠连续空行为一个 → 删除首尾空行。生成器自己保证选择题题干与选项之间没有空行。

Run: `npm test`

Expected: 所有模型和生成器测试 PASS。

- [ ] **Step 6: 提交平台生成器**

```bash
git add src/generators.js tests/generators.test.mjs
git commit -m "feat: generate verified form import text"
```

---

### Task 3: 构建第一版工作台界面

**Files:**
- Create: `index.html`
- Create: `tokens.css`
- Create: `styles.css`
- Create: `src/app.js`
- Create: `.hallmark/log.json`

**Interfaces:**
- Consumes: model exports from `src/model.js`
- Consumes: `generateImportText(project)` from `src/generators.js`
- Produces: interactive single-page editor mounted at `[data-app]`

- [ ] **Step 1: 创建可识别的工作台语义骨架**

`index.html` 依次包含：紧凑页头、项目标题和说明、批量标题输入、图片多选入口、条目列表、平台切换、三种范式、诊断区域、生成文本区和导出按钮。所有输入都有显式 `<label>`，状态区使用 `aria-live="polite"`。

- [ ] **Step 2: 建立锁定的设计令牌**

`tokens.css` 只使用命名变量定义纸张色、墨色、珊瑚色主操作、蓝绿色状态色、字体栈、4pt 间距、字体尺寸、圆角、阴影、时长和缓动。`styles.css` 不直接声明原始颜色或字体。

- [ ] **Step 3: 实现批量标题和图片入口**

标题输入点击“加入”后调用 `titlesFromText`。图片入口使用 `multiple` 和 `accept="image/*"`，每个文件调用 `deriveTitleFromFilename` 与 `URL.createObjectURL`。重复文件不覆盖已有条目；验证器负责提示同名项。

- [ ] **Step 4: 实现条目编辑和资源释放**

每项显示缩略图或无图占位、标题输入、上移、下移和删除按钮。删除图片条目和 `beforeunload` 时回收 object URL；排序只改变数组顺序，不重新创建 URL。

- [ ] **Step 5: 实现即时输出和导出**

任意项目状态变化均重新运行 `validateProject` 与 `generateImportText`。有错误时禁用复制和下载；无错误时使用 Clipboard API 复制，用 `Blob` 下载 `.txt`，并用 `serializeProject` 下载 `.json`。

- [ ] **Step 6: 做一次静态语义检查**

Run: `npm test`

Run: `node --check src/app.js`

Expected: 测试全部 PASS，语法检查无输出并以 0 退出。

- [ ] **Step 7: 提交可操作的首版界面**

```bash
git add index.html tokens.css styles.css src/app.js .hallmark/log.json
git commit -m "feat: add anime vote generator workbench"
```

---

### Task 4: 添加本地预览并完成真实浏览器验证

**Files:**
- Create: `scripts/serve.mjs`
- Modify: `styles.css`
- Modify: `src/app.js`

**Interfaces:**
- Produces: `npm run dev` local server on `127.0.0.1` with a printed URL
- Verifies: the complete browser flow without navigating or publishing external form tabs

- [ ] **Step 1: 创建零依赖静态服务器**

`scripts/serve.mjs` 仅服务仓库根目录内的已知静态文件，默认监听 `127.0.0.1:4173`；拒绝包含 `..` 的路径，并为 HTML、CSS、JS、JSON 和常见图片扩展名设置正确 MIME。

- [ ] **Step 2: 启动并检查首个有效预览**

Run: `npm run dev`

Expected: 输出 `http://127.0.0.1:4173/`，浏览器打开后首屏可见批量输入、平台选择和输出区域，不显示空白脚手架。

- [ ] **Step 3: 在浏览器执行完整流程**

一次加入三个动画标题，再一次选择两张本地证据图片；修改一个标题、调整顺序、删除一项，依次切换六个平台/范式组合。确认复制按钮状态、文本预览和警告同步更新，且没有触碰问卷星或腾讯问卷标签页。

- [ ] **Step 4: 验证四个窄屏宽度**

在 320、375、414、768 像素宽度检查：`document.documentElement.scrollWidth <= window.innerWidth`；按钮文字不拆成两行；图片不撑破网格；焦点顺序与视觉顺序一致。只修复实际发现的问题。

- [ ] **Step 5: 运行最终检查**

Run: `npm test`

Run: `node --check src/model.js`

Run: `node --check src/generators.js`

Run: `node --check src/app.js`

Run: `node --check scripts/serve.mjs`

Expected: 全部退出码为 0，测试无失败。

- [ ] **Step 6: 提交本地预览与响应式修正**

```bash
git add scripts/serve.mjs styles.css src/app.js
git commit -m "test: verify local vote generator workflow"
```

---

### Task 5: 完成使用说明和限制说明

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: final commands and behavior from Tasks 1–4
- Produces: user-facing startup, workflow and limitation documentation

- [ ] **Step 1: 更新 README**

加入以下内容：`npm run dev` 启动方式；标题/图片批量导入流程；三个范式的两平台映射表；复制与下载方法；图片只本地预览、文本导入不上传图片、腾讯矩阵降级等限制；链接到设计说明、计划和 `form-import-findings.md`。

- [ ] **Step 2: 对照实际界面复核文字**

逐项确认 README 中出现的按钮名、范式名、文件名和命令均与实现一致，不使用“自动上传图片”或“直接生成线上问卷”等容易误解的表述。

- [ ] **Step 3: 运行回归测试并提交文档**

Run: `npm test`

Expected: 所有测试 PASS。

```bash
git add README.md
git commit -m "docs: explain anime vote generator workflow"
```

