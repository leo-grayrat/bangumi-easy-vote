# 排行榜长图原型

这一目录只负责复刻 Anime Corner 一类纵向榜单图的版式，暂时不接入现有投票 HTML。

目前保留三种表达：

- `render.py`：Pillow 实际渲染器；
- `layout.css`：把参考图拆成可读的尺寸和样式参数；
- `template.svg`：单行组件的 SVG 骨架，方便继续校准坐标和字体；
- `sample.json`：当前评分数据的示例输入，图片路径暂时使用占位文件名。

参考画布按 1024×1536 处理。榜单单行拆成 95 px 名次区、596 px 视觉图区和 295 px 数据区；右侧原本的“排名变化”区域改成“平均分 + 评分人数”。横版视觉图按 cover 方式裁切，可通过每项的 `focus: [x, y]` 调整裁切焦点。

运行：

```bash
python -m pip install -r tools/ranking-poster/requirements.txt
python tools/ranking-poster/render.py tools/ranking-poster/sample.json -o ranking-poster.png
```

如果没有对应图片，Pillow 渲染器会使用占位色块，因此可以先只校准排版。

字体不随仓库提交。可通过环境变量指定本机字体：

```bash
RANKING_FONT_CJK=/path/to/cjk-bold.ttf \
RANKING_FONT_LATIN=/path/to/latin-bold.ttf \
python tools/ranking-poster/render.py tools/ranking-poster/sample.json
```

下一阶段重点不是加功能，而是继续对照参考图校准：标题字体、字重、字号、数据区比例、行高/间距、视觉图暗幕和页脚高度。
