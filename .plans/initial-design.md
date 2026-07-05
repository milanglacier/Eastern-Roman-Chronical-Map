# 东罗马帝国编年地图可视化 (Eastern Roman Chronicle Map)

## Context

Greenfield 项目（空仓库）。目标：一个交互式历史可视化网站，以文明5风格的45°等距六边形瓦片地图展现东罗马帝国 330–1453 年的疆域变迁，配合可点击的大事件 widget（政治/军事/经济/文化/艺术/法律/文明各类别）、可拖动+自动播放的时间轴、中英双语，UI 采用紫色主基调的东罗马艺术风格（byzantine artistic style）。

**项目规范第一条：绝不将该国称为"拜占庭/Byzantium"——一律称"东罗马/Eastern Roman Empire/罗马"。**（艺术风格描述可用 "byzantine art style"，但 UI 文案、数据内容、代码命名中的国家名必须是东罗马。）此规范写入项目 CLAUDE.md。

已确认的决策：
- 地图：PixiJS 程序化等距六边形瓦片地图（文明5式）
- 内容规模：~25 个疆域快照、~100 条双语大事件（内容由 Claude 编写）
- 技术栈：React + TypeScript + Vite，纯静态站点；Vitest 测试
- 事件内容全部做成数据资产（JSON config），不硬编码

## 技术架构

```
React (UI 层: 时间轴/详情面板/语言切换)
  ├─ zustand store (currentYear, isPlaying, selectedEvent, language, camera)
  ├─ PixiJS v8 地图层 (地形瓦片、疆域染色、城市图标) — 挂在一个 <canvas>
  └─ DOM overlay 事件 widget 层 (绝对定位, 随相机变换同步) — 便于样式与测试
数据资产 (src/data/*.json, zod 校验)
构建脚本 (scripts/) — 从地理数据生成瓦片资产
```

依赖：`react` `react-dom` `pixi.js@^8` `zustand` `zod`；dev: `vite` `vitest` `@testing-library/react` `jsdom` `typescript` `eslint`。字体用 `@fontsource/cinzel`（拉丁展示体）+ 系统中文衬线回退（可选 `@fontsource-variable/noto-serif-sc`，注意体积）。

## 目录结构

```
CLAUDE.md                      # 项目规范（第一条：不称拜占庭）
scripts/
  generate-tiles.mjs           # 构建时生成六边形瓦片地形资产
  assets/coastline-110m.json   # 简化海岸线 GeoJSON（Natural Earth 110m 裁剪到地图范围）
  assets/terrain-config.json   # 手工配置：山脉折线(托罗斯/庞廷/巴尔干/阿尔卑斯/阿特拉斯/扎格罗斯/高加索/品都斯/亚平宁)、沙漠区域、主要河流(多瑙/尼罗/幼发拉底, 装饰用)
src/
  main.tsx / App.tsx
  lib/hex.ts                   # 轴向坐标↔像素、等距投影(y压扁0.5+海拔偏移)、经纬度↔瓦片
  lib/geo.ts                   # point-in-polygon、GeoJSON 工具
  data/schema.ts               # zod: EventSchema / SnapshotSchema / TilesSchema
  data/tiles.json              # 生成的瓦片资产（提交到仓库）
  data/snapshots.json          # 25个快照元数据: {id, year, label:{en,zh}, note:{en,zh}}
  data/territories/<year>.json # 每快照一个 GeoJSON MultiPolygon（手绘近似历史疆界, 经纬度）
  data/events.json             # ~100条事件（见 schema）
  data/cities.json             # 重要城市: {id, name:{en,zh}, lonlat, eras[]} 君士坦丁堡/塞萨洛尼基/安条克/亚历山大/拉文纳/罗马/迦太基/尼西亚/特拉布宗/米斯特拉斯…
  map/MapCanvas.tsx            # Pixi 初始化 + React 桥接
  map/renderer/terrain.ts      # 瓦片绘制: 海(深/浅)/平原/草地/丘陵/山脉/沙漠; 山丘有挤出高度
  map/renderer/territory.ts    # 疆域层: 快照多边形→瓦片集(运行时栅格化+memoize), 紫色染色+描边, 快照切换时 crossfade
  map/renderer/cities.ts       # 城市图标(程序绘制小建筑/城墙轮廓, 君堡特殊图标)
  map/camera.ts                # 拖拽平移、滚轮缩放、边界钳制
  map/EventMarkers.tsx         # DOM overlay: 当前时代事件 widget, 按类别配色的徽章图标
  state/store.ts               # zustand
  i18n/index.ts                # useT() hook + UI 字符串字典 {en, zh}
  ui/Timeline.tsx              # 底部时间轴: 330–1453 刻度、快照节点、拖拽 scrubber、播放/暂停、年份显示(含双语纪年)
  ui/EventPanel.tsx            # 点击 widget 弹出的详情面板（羊皮纸/马赛克风格）
  ui/Legend.tsx  ui/Header.tsx ui/LanguageToggle.tsx
  styles/theme.css             # 紫金主题
tests/ (或 co-locate *.test.ts(x))
```

## 关键设计

### 1. 瓦片地图生成（不手写 4000 块瓦片）
`scripts/generate-tiles.mjs`：地图范围约 lon [-12, 46] × lat [24, 49]（覆盖查士丁尼极盛期含北非、意大利、西班牙南部）。六边形网格约 90×55 ≈ 4500 瓦片。对每个瓦片中心：海岸线多边形内→陆地，否则海（离岸远→深海）；落在山脉折线缓冲带内→山脉/丘陵；沙漠区域内→沙漠；其余按纬度区分草地/平原。输出 `src/data/tiles.json`（axial 坐标+地形类型，提交仓库，运行时零地理计算）。脚本可重跑、terrain-config 可手工调优。

### 2. 等距渲染 (lib/hex.ts + renderer)
尖顶六边形，屏幕 y = 世界 y × 0.55 实现45°俯视感；丘陵/山脉瓦片整体上移并绘制侧面棱柱+雪顶三角形，海洋加波纹点缀，营造文明5式立体感。全部 Pixi Graphics 程序化绘制（无外部贴图资产）。瓦片渲染进一个静态容器（地形只画一次），疆域/城市/高亮各自独立图层。

### 3. 疆域快照
快照 = 手绘 GeoJSON 多边形（历史近似疆界）。运行时 `territoryTiles(snapshot)`：所有陆地瓦片中心做 point-in-polygon → Set<tileId>，memoize。染色：帝国紫 (#6B2FA0 系) 半透明覆盖 + 边界瓦片金色描边（文明游戏边界感）。约 25 个快照年份（大致）：330, 395, 450, 527, 555(查士丁尼极盛), 565, 602, 626, 650, 717, 780, 843, 867, 925, 976, 1025(巴西尔二世极盛), 1071(曼齐刻尔特后), 1081, 1143, 1180, 1204(帝国瓦解/尼西亚), 1261(收复君堡), 1300, 1350, 1400, 1453 —— 编写数据时可微调。

### 4. 事件数据 (config 而非硬编码 — 用户已确认此方向)
```jsonc
{
  "id": "founding-constantinople",
  "year": 330,
  "category": "politics",  // politics|military|economy|culture|art|law|religion|civilization
  "lonlat": [28.98, 41.01],
  "importance": 1,          // 1 major / 2 notable
  "title":   {"en": "...", "zh": "..."},
  "summary": {"en": "...", "zh": "..."},   // widget hover / 面板首段
  "detail":  {"en": "...", "zh": "..."}    // 详情面板正文, 2-3段
}
```
显示规则：当前年份所属快照区间 `[snapshot.year, next.year)` 内的事件显示为地图上的 widget。类别以徽章配色/图标区分（军事=剑红、法律=卷轴金、艺术=马赛克青…在紫金主题内取协调色）。~100 条事件覆盖全类别：米兰敕令后续、君堡奠基、狄奥多西、《查士丁尼法典》、圣索菲亚、希拉克略与真十字架、希腊火、毁坏圣像运动、《农业法》、西里尔字母、马其顿文艺复兴、巴西尔二世、1054大分裂、曼齐刻尔特、普洛尼亚制、科穆宁中兴、1204第四次十字军、尼西亚流亡政权、1261收复、帕列奥列格文艺复兴、赫西卡斯争论、1341内战、1453陷落等。

### 5. 时间轴 + 自动播放
- 底部时间轴：330–1453 线性刻度，快照年份为节点，scrubber 可拖拽/点击跳转。
- 播放/暂停按钮：自动播放以固定节奏推进快照（每个快照停留 ~4s，store 里 `isPlaying` + rAF/interval driver）。
- **点击任意事件 widget → `pause()` + 打开 EventPanel**（用户明确要求）。关闭面板不自动恢复播放（用户手动继续）。
- 年份显示随播放更新，快照切换时地图疆域 crossfade。

### 6. 双语
`language: 'en' | 'zh'` 存 zustand（persist 到 localStorage）。UI 字符串走 i18n 字典；数据内容直接取 `field[language]`。语言切换按钮在 Header。年份显示：`AD 555 / 公元555年`。

### 7. 主题（东罗马艺术风格）
- 主色：帝国紫 `#3D1A5B`(深底) / `#6B2FA0`(疆域) / 泰尔紫点缀 `#66023C`
- 辅色：马赛克金 `#C9A227`、羊皮纸 `#F0E6D2`、深海蓝
- Header/面板：金色马赛克 tessera 边框（CSS repeating-gradient 实现）、Chi-Rho/双头鹰 SVG 装饰（自绘 inline SVG）
- 字体：Cinzel（拉丁标题）、中文衬线（宋体系回退）
- 遵循 dataviz skill 校验类别配色的对比度（实现阶段加载该 skill）

## 测试 (Vitest)

1. **数据校验测试**（最重要，保障 config 资产质量）：所有 events/snapshots/cities/territories 通过 zod schema；年份 ∈ [330,1453]；坐标在地图范围内；en/zh 均非空；事件 id 唯一；每个快照有对应 territory 文件；快照年份严格递增。
2. **lib 单测**：hex 坐标转换往返、lonlat→tile、point-in-polygon 边界情形。
3. **逻辑单测**：`snapshotForYear()` 边界（330 前夹取、1453、快照间年份）；播放 driver 推进/暂停；事件过滤（时代区间归属）。
4. **组件测试** (Testing Library + jsdom)：Timeline 拖拽/点击改变年份、播放按钮切换状态、点击事件 widget → 自动播放停止 + 面板打开、语言切换后文案变化。
5. **脚本测试**：generate-tiles 对小型 fixture 产出预期地形分类。
Pixi 渲染层不做 jsdom 测试（canvas 环境限制），由端到端人工/浏览器验证覆盖。

## 实施顺序

1. 脚手架：Vite+React+TS、Vitest、eslint、CLAUDE.md（含命名规范）、目录骨架
2. `lib/hex.ts` + `generate-tiles.mjs`（含获取/裁剪 Natural Earth 海岸线、terrain-config 编写）→ `tiles.json`
3. Pixi 地图：地形渲染 + 相机（拖拽/缩放）
4. 数据 schema + `snapshots.json` + 25 个 territory GeoJSON（内容编写重头之一）+ 疆域渲染层 + 城市层
5. `events.json` ~100 条双语事件（内容编写重头之二，分类别分时代批量编写）
6. EventMarkers overlay + EventPanel + 点击暂停联动
7. Timeline + 自动播放 + 语言切换
8. 主题美化（紫金马赛克风格）、图例、响应式
9. 测试补全、README（含如何新增事件/快照的数据贡献指南）

内容编写量大（100事件×双语 + 25疆界多边形），步骤 4/5 可用并行 subagent 分时代批量产出数据文件，再由 schema 测试统一把关。

## 验证

- `npm test`：全部数据校验 + 单测 + 组件测试通过
- `npm run build`：静态构建成功
- `npm run dev` + `agent-browser-wrapped` 浏览器实测：截图核对地图渲染效果（等距地形、紫色疆域）；拖动时间轴看疆域变化（330→555→1025→1204→1453 关键节点）；点击自动播放再点击事件 widget 验证暂停+面板；切换中英文核对双语；核对全站无"拜占庭/Byzantium"作为国名出现（grep 数据文件把关，测试中加断言）
