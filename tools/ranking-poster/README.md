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
- `sample.json`：完结评分红榜；
- `sample-black.json`：完结评分黑榜；
- `sample-favorite.json`：完结喜爱度榜；
- `sample-controversy.json`：完结争议 / 一致榜；
- `sample-midseason-change.json`：中期到完结涨跌榜；
- `sample-bgm-deviation.json`：社内 / Bangumi 评分偏差榜。

参考画布为 **1200×1800**。榜单单行拆成 110 px 名次区、699 px 视觉图区和 345 px 数据区。横版视觉图按 cover 方式裁切；Pillow 版可用 `focus: [x, y]` 调整焦点，浏览器版会保存更细的 `zoom / offsetX / offsetY` 非破坏裁切参数。

## 六种榜单模式

`poster.html` 现在支持：

- `red`：评分红榜 TOP 10；
- `black`：评分黑榜 BOTTOM 10；
- `favorite`：喜爱度 TOP 10；
- `controversy`：标准差最高 5 部 + 最低 5 部；
- `midseason-change`：中期到完结涨幅最高 5 部 + 跌幅最大 5 部；
- `bgm-deviation`：相对 Bangumi 偏高最多 5 部 + 偏低最多 5 部。

后三种双分区榜单都使用独立的 1～5 名次，上下分区不会重复同一条目。

## 浏览器编辑器

运行仓库根目录的：

```powershell
npm run dev
```

然后从顶部进入 **“排行榜海报”**。浏览器版可以：

- 在六种榜单之间切换，每种模式保存自己的本地编辑状态；
- 载入六份内置榜单或整理后的项目 JSON；
- 逐项修改当前模式需要的均分、人数、BGM 分数、标准差、喜爱分、排名或中期数据；
- 在页面上直接调整当前模式的 ↓ / ↑ 箭头阈值；
- 给每一项导入本地视觉图，并在 699×136 视窗里拖动、缩放裁切；
- 复用视觉方案、使用 TMDB 选图、修改字体和字号；
- 实时预览并导出 1200×1800 透明 PNG；
- 下载不含图片和字体二进制的海报项目 JSON。

图片会缓存在仓库下的 `.local/poster-assets/`，六种海报项目分别保存在 `.local/poster-projects/<scope>--<mode>.json`，视觉方案库保存在 `.local/poster-visuals/`。这些本地状态以及原始问卷 Excel 都不应提交到仓库。

## 各模式信息结构

### 评分红榜 / 黑榜

- 主值：`AVERAGE SCORE`
- 对比：`VS BANGUMI`
- 底栏：`投票数 N / BGM x.xx`

排序：红榜按均分降序，黑榜按均分升序；同分时均由评分人数更多者优先。

### 喜爱度

- 主值：`FAVORITE PTS`
- 对比：`VS SCORE RANK`
- 底栏：`TOP5 N / SCORE #排名`

喜爱排名按喜爱分降序，同分时由进入 Top5 次数更多者优先。右侧排名差为 `社内评分排名 - 喜爱排名`。

### 争议 / 一致

- 上半：`MOST CONTROVERSIAL`
- 下半：`MOST CONSISTENT`
- 主值：`STD. DEV.`
- 对比：`VS BANGUMI`
- 底栏：`AVG x.xx · N人数 / BGM SD x.xx`

右侧差值为 `社内标准差 - BGM 标准差`，上下分区使用同一套箭头阈值。

### 中期 → 完结

- 上半：`MOST IMPROVED`
- 下半：`MOST DECLINED`
- 主值：完结 `AVERAGE SCORE`
- 对比：`VS MID-SEASON`
- 底栏：`MID N<中期评分人数> / MID <中期均分>`

变化量为 `完结均分 - 中期均分`。输入数据中的 `midseasonVoters` 明确表示中期评分人数，不是完结人数。

### BGM 偏差

- 上半：`MOST ABOVE BANGUMI`
- 下半：`MOST BELOW BANGUMI`
- 主值：`AVERAGE SCORE`
- 对比：`VS BANGUMI`
- 底栏：`投票数 N / BGM x.xx`

按 `社内均分 - BGM` 的差值分别取最高 5 部和最低 5 部。

## 箭头阈值

箭头使用从参考图提取的透明小素材。阈值是**海报项目数据的一部分**，浏览器编辑器可以直接修改；下面只是在新项目中的默认值，不代表以后调查必须继续沿用。

```text
评分 vs BGM：scoreBgmDown = 0.0，scoreBgmUp = 0.7
喜爱排名差：favoriteDown = 0，favoriteUp = 5
标准差差值：controversyDown = -0.5，controversyUp = 0.5
中期变化：midseasonDown = 0.0，midseasonUp = 0.0
```

具体判断：

```text
评分 vs BGM：delta < down -> down；delta >= up -> up；其余 flat
喜爱排名差：delta < down -> down；delta >= up -> up；其余 flat
标准差差值：delta <= down -> down；delta >= up -> up；其余 flat
中期变化：delta < down -> down；delta > up -> up；其余 flat
```

`red`、`black`、`bgm-deviation` 共用 `scoreBgmDown / scoreBgmUp`。旧项目中的 `redDown/redUp` 或 `blackDown/blackUp` 会按项目原模式读取；旧争议榜上下半区的两套阈值不再沿用，新项目统一使用一套标准差差值阈值。

## 透明输出

Pillow 和 Canvas 输出都保持透明底层。页头、名次块、视觉图、数据区等榜单组件仍然是不透明的，可以把导出的 PNG 叠到其他背景上继续排版。

## Pillow 直接运行

```bash
python -m pip install -r tools/ranking-poster/requirements.txt
python tools/ranking-poster/render.py tools/ranking-poster/sample.json -o ranking-red.png
python tools/ranking-poster/render.py tools/ranking-poster/sample-midseason-change.json -o ranking-midseason.png
python tools/ranking-poster/render.py tools/ranking-poster/sample-bgm-deviation.json -o ranking-bgm-deviation.png
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
- `metric`：平均分 / 标准差 / 喜爱分主数字；
- `trend_delta`：右侧分差或排名差；
- `aux`：底部趋势色条小字；
- `label`：两列小标题。

`style.local.json`、本地预览图和 `.xlsx` 已在这个工具目录的 `.gitignore` 中忽略。原始问卷表不要提交到仓库；仓库里只保留整理后的榜单数据。
