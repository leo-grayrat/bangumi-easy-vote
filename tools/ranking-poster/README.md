# 排行榜长图

这一目录保留排行榜海报的 **Pillow 离线参考实现**。浏览器中的可视化编辑器已经接入站点第三个页面 `poster.html`，两边共用同一套榜单数据含义和已确认的版式规则。

当前包含：

- `render.py`：Pillow 实际渲染器；
- `preview.py`：本地样式覆盖与自动预览；
- `style.example.json`：可复制后自行调整的样式文件；
- `layout.css`：与渲染器同步的版式参数；
- `template.svg`：SVG 骨架；
- `layout-calibrated.json`：机器可读的实测版式参数；
- `reference-calibration.md`：参考图测量记录；
- `sample.json`：当前红榜示例输入；
- `sample-black.json`：当前黑榜示例输入。

参考画布为 **1200×1800**。榜单单行拆成 110 px 名次区、699 px 视觉图区和 345 px 数据区。横版视觉图按 cover 方式裁切；Pillow 版可用 `focus: [x, y]` 调整焦点，浏览器版会保存更细的 `zoom / offsetX / offsetY` 非破坏裁切参数。

## 浏览器编辑器

运行仓库根目录的：

```powershell
npm run dev
```

然后从顶部进入 **“排行榜海报”**。浏览器版可以：

- 载入当前红榜 / 黑榜或整理后的项目 JSON；
- 逐项修改标题、人工换行、社内均分、投票数和 BGM 分数；
- 给每一项导入本地视觉图，并在 699×136 视窗里拖动、缩放裁切；
- 分别修改主标题、副标题、动画标题、排名数字、平均分、差值和小字的字体与字号；
- 临时载入本地字体；
- 实时预览并导出 1200×1800 透明 PNG；
- 下载不含图片和字体二进制的海报项目 JSON。

本地图片和字体只在当前浏览器会话中使用，不上传网络。重新载入项目 JSON 后需要重新选择对应图片；原始问卷 Excel 不进入这一层，也不要提交到仓库。

## 当前信息结构

右侧上方仍为两列：

- `AVERAGE SCORE`：本次问卷平均分；
- `VS BANGUMI`：相对 Bangumi 的趋势箭头与分差。

底部是一条较窄的趋势色条：

- 左侧：`投票数 7`；
- 右侧：`BGM 6.94`。

箭头使用从参考图提取的透明小素材，不再用字体字符或临时矢量线条拼接。

箭头判定按红榜和黑榜分别处理，默认阈值为：

```text
红榜：delta >= +1.0 -> up；delta < +0.4 -> down；其余 flat
黑榜：delta >  -0.4 -> up；delta <= -1.0 -> down；其余 flat
```

其中 `delta = 社内平均分 - BGM 分数`。阈值可以在 JSON 的 `thresholds` 中覆盖。

## 排序

渲染器会根据榜单模式自动排序：

```text
红榜：平均分降序 -> 评分人数降序
黑榜：平均分升序 -> 评分人数降序
```

因此同分时由评分人数更多的条目排在前面。

个别标题如果自动换行观感不好，可以只对该条目设置 `title_lines`。这只是局部覆盖，不会影响其他条目的自动换行。

## 透明输出

Pillow 和 Canvas 输出都保持透明底层。页头、名次块、视觉图、数据区等榜单组件仍然是不透明的，可以把导出的 PNG 叠到其他背景上继续排版。

## Pillow 直接运行

```bash
python -m pip install -r tools/ranking-poster/requirements.txt
python tools/ranking-poster/render.py tools/ranking-poster/sample.json -o ranking-red.png
python tools/ranking-poster/render.py tools/ranking-poster/sample-black.json -o ranking-black.png
```

如果没有对应视觉图，渲染器会使用占位色块，因此可以先只校准排版。

## Pillow 本地自己调字体

如果只想快速试字体，也可以继续使用原来的本地样式覆盖文件：

```powershell
cd tools/ranking-poster
copy style.example.json style.local.json
python preview.py sample.json --style style.local.json --watch -o preview.png
```

`--watch` 开启后，只要保存 `style.local.json`，就会自动重渲染 `preview.png`。

常用角色含义：

- `header_title`：顶部中文主标题；
- `header_subtitle`：顶部英文副标题；
- `anime` / `anime_small`：作品标题；
- `rank`：左侧名次数字；
- `metric`：平均分大数字；
- `trend_delta`：右侧分差；
- `aux`：底部趋势色条小字；
- `label`：`AVERAGE SCORE / VS BANGUMI` 两个小标题。

`style.local.json`、本地预览图和 `.xlsx` 已在这个工具目录的 `.gitignore` 中忽略。原始问卷表不要提交到仓库；仓库里只保留整理后的榜单数据。
