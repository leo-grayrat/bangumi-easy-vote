# 排行榜长图原型

这一目录只负责复刻 Anime Corner 一类纵向榜单图的版式，暂时不接入现有投票 HTML。

当前包含：

- `render.py`：Pillow 实际渲染器；
- `layout.css`：与渲染器同步的版式参数；
- `template.svg`：SVG 骨架；
- `layout-calibrated.json`：机器可读的实测版式参数；
- `reference-calibration.md`：参考图测量记录；
- `sample.json`：红榜示例输入；
- `sample-black.json`：黑榜示例输入；
- `test_render.py`：透明输出、字体、排序、箭头规则和顶部标签位置的回归测试。

参考画布为 **1200×1800**。榜单单行拆成 110 px 名次区、699 px 视觉图区和 345 px 数据区。横版视觉图按 cover 方式裁切，可通过每项的 `focus: [x, y]` 调整裁切焦点。

## 当前信息结构

右侧主区显示：

- `AVERAGE SCORE`：本次问卷平均分；
- `RATERS`：实际评分人数。

单行底条不再重复“平均评分 / X 人评分”，改为：

- 左侧：`BGM 7.12`；
- 右侧：`↑ +0.88` / `→ +0.36` / `↓ -1.24`。

箭头判定按红榜和黑榜分别处理，默认阈值为：

```text
红榜：delta >= +1.0 -> up；delta < +0.4 -> down；其余 flat
黑榜：delta >  -0.4 -> up；delta <= -1.0 -> down；其余 flat
```

其中 `delta = 社内平均分 - BGM 分数`。阈值可以在 JSON 的 `thresholds` 中覆盖。

## 排序

渲染器不再信任手写 `rank`，会根据榜单模式自动排序：

```text
红榜：平均分降序 -> 评分人数降序
黑榜：平均分升序 -> 评分人数降序
```

因此同分时永远由评分人数更多的条目排在前面。

## 透明输出

Pillow 输出保持 `RGBA`，画布底层和页脚底色都使用透明像素。页头、名次块、视觉图、右侧数据块等真正的榜单组件仍然是不透明的，因此可以直接把导出的 PNG 压到其他背景图上继续排版。

## 运行

```bash
python -m pip install -r tools/ranking-poster/requirements.txt
python tools/ranking-poster/render.py tools/ranking-poster/sample.json -o ranking-red.png
python tools/ranking-poster/render.py tools/ranking-poster/sample-black.json -o ranking-black.png
```

如果没有对应图片，Pillow 渲染器会使用占位色块，因此可以先只校准排版。

## 字体

字体文件不随仓库提交。默认会优先寻找常见的 Noto CJK / DejaVu 字体；页头主标题默认优先使用支持中文的字体，避免中文标题显示成方框或空白。

字体可以在 JSON 的 `fonts` 中按角色覆盖，例如：

```json
"fonts": {
  "latin": "/path/to/latin-bold.ttf",
  "cjk": "/path/to/cjk-bold.ttc",
  "header_title": "/path/to/title-font.ttc",
  "anime": "/path/to/anime-title-font.ttc",
  "rank": "/path/to/rank-number-font.ttf",
  "metric": "/path/to/metric-font.ttf",
  "small": "/path/to/small-cjk-font.ttc"
}
```

## 测试

```bash
cd tools/ranking-poster
python -m unittest -v test_render.py
```
