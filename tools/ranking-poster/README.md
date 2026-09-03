# 排行榜长图原型

这一目录只负责复刻 Anime Corner 一类纵向榜单图的版式，暂时不接入现有投票 HTML。

目前保留几种表达：

- `render.py`：Pillow 实际渲染器；
- `layout.css`：把参考图拆成可读的尺寸、样式和字体角色；
- `template.svg`：SVG 版骨架，方便继续核对坐标与字体；
- `layout-calibrated.json`：机器可读的实测版式参数；
- `reference-calibration.md`：参考图测量记录；
- `sample.json`：当前评分数据的示例输入；
- `test_render.py`：透明输出和字体配置的最小回归测试。

参考画布为 **1200×1800**。榜单单行拆成 110 px 名次区、699 px 视觉图区和 345 px 数据区；右侧原本的“排名变化”区域改成“平均分 + 评分人数”。横版视觉图按 cover 方式裁切，可通过每项的 `focus: [x, y]` 调整裁切焦点。

## 透明输出

Pillow 输出保持 `RGBA`，画布底层和页脚底色都使用透明像素。页头、名次块、视觉图、右侧数据块等真正的榜单组件仍然是不透明的，因此可以直接把导出的 PNG 压到其他背景图上继续排版。

## 运行

```bash
python -m pip install -r tools/ranking-poster/requirements.txt
python tools/ranking-poster/render.py tools/ranking-poster/sample.json -o ranking-poster.png
```

如果没有对应图片，Pillow 渲染器会使用占位色块，因此可以先只校准排版。

## 字体

字体文件不随仓库提交。默认会优先寻找常见的 Noto CJK / DejaVu 字体；页头主标题默认优先使用支持中文的字体，避免中文标题显示成方框或空白。

字体可以在 `sample.json` 的 `fonts` 中按角色覆盖：

```json
"fonts": {
  "latin": "/path/to/latin-bold.ttf",
  "cjk": "/path/to/cjk-bold.ttc",
  "header_title": "/path/to/title-font.ttc",
  "header_subtitle": "/path/to/subtitle-font.ttf",
  "brand": "/path/to/brand-font.ttc",
  "anime": "/path/to/anime-title-font.ttc",
  "rank": "/path/to/rank-number-font.ttf",
  "metric": "/path/to/metric-font.ttf",
  "small": "/path/to/small-cjk-font.ttc",
  "footer": "/path/to/footer-font.ttc"
}
```

没有单独指定某个角色时，会退回到通用的 `cjk` / `latin`，再退回到脚本内置的常见系统路径。

原有环境变量仍然可用：

```bash
RANKING_FONT_CJK=/path/to/cjk-bold.ttc \
RANKING_FONT_LATIN=/path/to/latin-bold.ttf \
python tools/ranking-poster/render.py tools/ranking-poster/sample.json
```

## 测试

在该目录运行：

```bash
cd tools/ranking-poster
python -m unittest -v test_render.py
```

测试会确认导出的 PNG 保留透明通道，并检查字体角色覆盖与默认中文标题字体的优先级。
