# 排行榜海报六模式扩展设计

## 背景

现有排行榜海报工具支持四种模式：

- `red`：评分红榜；
- `black`：评分黑榜；
- `favorite`：喜爱度榜；
- `controversy`：争议 / 一致榜。

本次 7 月新番完结调查需要新增两种 5+5 双分区榜单，并且此前写死在项目默认值中的箭头阈值已经证明会随调查样本和评分环境变化，因此阈值必须提升为项目级可编辑配置。

目标是在不破坏现有 1200×1800 海报版式、视觉方案库、图片裁切、字体和本地持久化逻辑的前提下，将海报工具稳定扩展为六种模式。

## 目标模式

### 1. `red`

评分红榜 TOP 10。

- 主指标：`AVERAGE SCORE`
- 对比栏：`VS BANGUMI`
- 底栏左：`投票数 N`
- 底栏右：`BGM x.xx`
- 排序：社内平均分降序，其次评分人数降序

### 2. `black`

评分黑榜 BOTTOM 10。

- 主指标：`AVERAGE SCORE`
- 对比栏：`VS BANGUMI`
- 底栏左：`投票数 N`
- 底栏右：`BGM x.xx`
- 排序：社内平均分升序，其次评分人数降序

### 3. `favorite`

喜爱度 TOP 10。

- 主指标：`FAVORITE PTS`
- 对比栏：`VS SCORE RANK`
- 底栏左：`TOP5 N`
- 底栏右：`SCORE #排名`
- 排序：喜爱分降序，其次 Top5 人数降序
- 排名差定义：`scoreRank - favoriteRank`

### 4. `controversy`

争议度 / 一致度双分区。

- 上半 5 项：`MOST CONTROVERSIAL`
- 下半 5 项：`MOST CONSISTENT`
- 主指标：`STD. DEV.`
- 对比栏：`VS BANGUMI`
- 底栏左：`AVG x.xx · N人数`
- 底栏右：`BGM SD x.xx`
- 上半排序：社内标准差降序
- 下半排序：从剩余项目中按社内标准差升序
- 标准差差值定义：`stdDev - bgmStdDev`

争议榜不再根据“最争议 / 最一致”分区使用两套箭头判断。所有条目统一使用同一组标准差差值阈值。

### 5. `midseason-change`

中期到完结的评价变化双分区。

- 上半 5 项：`MOST IMPROVED`
- 下半 5 项：`MOST DECLINED`
- 主指标：`AVERAGE SCORE`，显示完结均分
- 对比栏：`VS MID-SEASON`
- 底栏左：`MID N<中期评分人数>`
- 底栏右：`MID <中期均分>`
- 变化量定义：`score - midseasonScore`
- 上半排序：变化量降序
- 下半排序：变化量升序

每个条目新增：

- `midseasonScore`
- `midseasonVoters`

该模式只负责展示已经整理好的项目数据，不负责从原始 Excel 计算或筛选样本。

### 6. `bgm-deviation`

社内与 Bangumi 评分偏差双分区。

- 上半 5 项：`MOST ABOVE BANGUMI`
- 下半 5 项：`MOST BELOW BANGUMI`
- 主指标：`AVERAGE SCORE`
- 对比栏：`VS BANGUMI`
- 底栏左：`投票数 N`
- 底栏右：`BGM x.xx`
- 差值定义：`score - bgmScore`
- 上半排序：差值降序
- 下半排序：差值升序

该模式与 red / black 共用同一组“社内评分 vs Bangumi”箭头阈值。

## 阈值模型

阈值全部保存在海报项目 JSON 中，并在编辑器里提供数字输入框。默认值只是新项目的初始值，不视为固定规则。

### 评分 vs Bangumi

适用于 `red`、`black`、`bgm-deviation`。

默认：

- `scoreBgmDown = 0.0`
- `scoreBgmUp = 0.7`

判断：

- `delta < scoreBgmDown` -> `down`
- `delta >= scoreBgmUp` -> `up`
- 其余 -> `flat`

### 喜爱排名差

适用于 `favorite`。

默认：

- `favoriteDown = 0`
- `favoriteUp = 5`

判断沿用现有逻辑：

- `scoreRank - favoriteRank >= favoriteUp` -> `up`
- `scoreRank - favoriteRank < favoriteDown` -> `down`
- 其余 -> `flat`

### 标准差差值

适用于 `controversy`。

默认：

- `controversyDown = -0.5`
- `controversyUp = 0.5`

判断：

- `deltaSD <= controversyDown` -> `down`
- `deltaSD >= controversyUp` -> `up`
- 其余 -> `flat`

### 中期变化

适用于 `midseason-change`。

默认：

- `midseasonDown = 0.0`
- `midseasonUp = 0.0`

判断：

- `delta < midseasonDown` -> `down`
- `delta > midseasonUp` -> `up`
- 其余 -> `flat`

这里默认上下阈值都为 0，因此正变化为 ↑、负变化为 ↓、完全不变为 →。编辑器允许以后按调查分布改成其他阈值。

## 旧项目兼容

当前旧项目可能仍含：

- `redUp`
- `redDown`
- `blackUp`
- `blackDown`
- `controversyHighUp`
- `controversyHighDown`
- `controversyLowUp`
- `controversyLowDown`
- `favoriteUp`
- `favoriteDown`

兼容策略：

1. 新字段存在时优先读取新字段。
2. 对旧 `red / black` 项目，如果新字段缺失：
   - `scoreBgmUp` 优先从与当前模式对应的旧 up 阈值迁移；
   - `scoreBgmDown` 优先从与当前模式对应的旧 down 阈值迁移。
3. 对旧 `controversy` 项目，如果新字段缺失：
   - 由于旧规则上下半区含义不同，不做复杂推断，使用新默认 `-0.5 / +0.5`；旧数据本身仍完整保留。
4. `favoriteUp / favoriteDown` 名称保持兼容。
5. 序列化新项目时只输出新阈值结构，避免继续扩散旧字段。

## 编辑器改动

### 模式选择

模式选择器扩展到 6 种：

- 红榜
- 黑榜
- 争议 / 一致榜
- 喜爱榜
- 中期 → 完结
- BGM 偏差

每种模式继续按现有 scope + mode 方式独立持久化。

### 样例加载

现有：

- `sample.json`
- `sample-black.json`
- `sample-favorite.json`
- `sample-controversy.json`

新增：

- `sample-midseason-change.json`
- `sample-bgm-deviation.json`

现有四份样例同步升级阈值字段。

### 阈值编辑区

在编辑器中增加“箭头阈值”区，根据当前模式只显示相关输入框：

- red / black / bgm-deviation：BGM 差值 ↓ 阈值、↑ 阈值
- favorite：排名差 ↓ 阈值、↑ 阈值
- controversy：SD 差值 ↓ 阈值、↑ 阈值
- midseason-change：中期变化 ↓ 阈值、↑ 阈值

阈值修改后即时重渲染并进入现有本地持久化流程。

### 条目字段编辑

- red / black / bgm-deviation：均分、评分人数、BGM 分
- favorite：喜爱分、Top5 人数、评分排名
- controversy：均分、评分人数、社内 SD、BGM SD
- midseason-change：完结均分、中期均分、中期评分人数

## 渲染器改动

### 双分区模式

`controversy`、`midseason-change`、`bgm-deviation` 共用 5+5 的展示框架，但分区名和排序依据由模式决定。

第 1 行与第 6 行继续显示分区 badge：

- controversy：`MOST CONTROVERSIAL` / `MOST CONSISTENT`
- midseason-change：`MOST IMPROVED` / `MOST DECLINED`
- bgm-deviation：`MOST ABOVE BANGUMI` / `MOST BELOW BANGUMI`

### 表头

左侧主指标标签：

- controversy：`STD. DEV.`
- favorite：`FAVORITE PTS`
- 其余：`AVERAGE SCORE`

右侧比较标签：

- favorite：`VS SCORE RANK`
- midseason-change：`VS MID-SEASON`
- 其余：`VS BANGUMI`

### 底栏

- controversy：`AVG x.xx · Nn` / `BGM SD x.xx`
- favorite：`TOP5 n` / `SCORE #n`
- midseason-change：`MID Nn` / `MID x.xx`
- red / black / bgm-deviation：`投票数 n` / `BGM x.xx`

## 数据模型扩展

标准化后的 item 新增：

- `midseasonScore: number | null`
- `midseasonVoters: positive integer | null`

其余字段继续复用现有：

- `score`
- `voters`
- `bgmScore`
- `stdDev`
- `bgmStdDev`
- `favoritePoints`
- `top5Count`
- `scoreRank`

不把问卷原始数据、样本筛选规则或 Excel 解析逻辑引入海报工具。

## 排序与展示行规则

`posterDisplayRows` 扩展：

- red：前 10 高分
- black：前 10 低分
- favorite：前 10 喜爱分
- controversy：最高 SD 5 + 从剩余项中最低 SD 5
- midseason-change：变化量最高 5 + 变化量最低 5
- bgm-deviation：BGM 差值最高 5 + BGM 差值最低 5

双分区模式必须避免同一条目同时进入上下两区。

## 测试与验证

至少覆盖：

1. 六种 mode 均可 normalize / serialize / reload。
2. red / black 排序不回归。
3. favorite 排序与排名箭头不回归。
4. controversy 5+5 分区与统一阈值正确。
5. midseason-change 5+5 分区、变化量、箭头正确。
6. bgm-deviation 5+5 分区、差值、箭头正确。
7. 旧四模式 JSON 可被新模型读取。
8. 阈值编辑后能序列化并恢复。
9. 六种 sample JSON 均能加载并生成 10 行展示数据。
10. 浏览器编辑器切换六模式时使用各自独立持久化键。

不提交原始 `.xlsx`、本地字体、本地视觉图或用户私有素材。
