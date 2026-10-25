# 项目记忆：runqiuw.github.io

最近核查：2026-10-24。依据当前源码、`redesign/PLAN.md`、Git 历史和本地验证。开始任务时先检查 `git status` 和最新代码，不把日期快照当作永久现状。

## 工作约定

- 问题涉及用户的科研或生活资料时，先用 Notion 读 https://app.notion.com/p/3f99ba3b598181dd951dc1aa302c8be0 并按其流程处理。纯仓库实现与构建问题以代码为依据。
- 修改或提议功能前先读 `redesign/PLAN.md`，它记录当前设计决定、待办、延期和不做的项目。`redesign/CONTENT.md` 是 2026-10-07 的迁移盘点，其中旧路径和未来时态不代表当前实现。
- 保留用户已有的未提交修改；未被要求时不提交、不推送、不部署。此仓库公开，记忆和文档中不要写私人原型链接、机器上的资源库绝对路径或配置值。
- 计划保持简短：已完成的待办从 `PLAN.md` 移除，不堆积打勾的历史。

## 当前技术栈与发布

- 这是 **Astro 静态站点**，不是 Jekyll。Astro 重构于 2026-10-21 合入 `main`（`d2dafd6`）；旧 al-folio 站点保存在 `al-folio-final` 标签。
- `package.json`：Astro 7、TypeScript 6、Three.js、cannon-es、MapLibre GL；字体 Fredoka + Nunito；`package-lock.json` 锁定依赖。
- `npm run dev`：开发服务器，默认 :4321；`npm run build`：输出 `dist/`；`npm run preview`：预览已经构建的 `dist/`。若 :4321 上是 preview，改源码后要先重新 build。
- `.github/workflows/deploy.yml` 在推送 `main` 或手动触发时构建并部署 GitHub Pages，地址仍为 `https://runqiuw.github.io`。
- `astro.config.mjs` 管理站点地址、sitemap 和旧 URL 重定向；保留旧站链接兼容性。
- `bin/deploy`、`bin/cibuild`、`bin/entry_point.sh` 仍是旧 Jekyll 脚本，不能作为当前构建或发布入口。本地旧 Jekyll 残留（`_site/`、`vendor/` 等）和已合入的 worktree 已于 2026-10-24 清理。

## 页面与内容入口

| 内容或职责 | 入口 |
| --- | --- |
| 首页、区块与条目的观察器 | `src/pages/index.astro` |
| 身份、教育、链接、区块开关 | `src/data/profile.ts` |
| 介绍正文、发音和 news 开关 | `src/components/Intro.astro` |
| 论文 | `src/content/papers.bib` → `src/lib/bib.ts` → `src/content.config.ts` → `src/components/Papers.astro` |
| 项目 | `src/content/projects/*.md`；`external` 表示卡片外链、不生成详情页 |
| 游戏 | `src/content/games.yaml`；`clip` 是房间电视播放的演示视频 |
| Playground | `src/content/playground.yaml`、`src/components/Pinboard.astro` |
| 内容 schema | `src/content.config.ts` |
| 主题、SEO、全局样式 | `src/layouts/Base.astro`、`src/components/Nav.astro`、`src/styles/global.css` |
| 构建优化的图片 | `src/assets/img/` |
| 原样提供的 PDF、视频、音频、GIF | `public/assets/` |

- 论文的 `teaser` 用于房间左显示器的演示，`screen` 可指定不同于页面 `preview` 的显示器图片；右显示器显示标题与会议信息。
- CV 只提供 PDF：`public/assets/pdf/cv.pdf`；`/cv` 重定向到它。`bin/sync-cv` 从 Overleaf 编译下载后会**自动 commit 和 push**，`--no-push` 仍会 commit；不要把它当作只读检查命令运行。项目配置来自忽略的 `.overleaf-cv-project`。
- 当前 `show.playground = true`、`show.contact = false`，`SHOW_NEWS = false`。Playground 已恢复，不能沿用“尚未上线”的旧记忆；`/playground` 也有独立页面。

## 设计与房间交互

- 页面独立、完整地呈现学术信息；房间展示当前条目的实物、演示或卡片。名字、研究、论文、CV、联系方式不需要进入房间就能读到。不要在侧边房间重复页面说明或加字幕。
- 桌面（≥901px）：左侧固定房间占 42%，右侧页面滚动；移动端以页面为主，通过卡片按需打开全屏房间。
- 滚动决定区块与相机镜头，视口中间的条目决定屏幕或物件内容；hover/focus 临时切换条目，不能移动相机。
- 三层视图：页面 → `#room` 全屏房间 → `#room/board` 或 `#room/hoops` 特写。Esc、返回按钮和浏览器返回逐层退出。`RoomPanel.astro` 管理视图、history 和展开收起动画；`room.ts` 管理相机与场景交互；新增特写由 `room.config.ts` 的 `CLOSEUPS` 配置。`section` 可选，没有页面区块的 hoops 不显示“on the page”按钮。
- 首次加载、刷新和页面内 hash 跳转都识别 `#room`、`#room/board`、`#room/hoops`，直接打开对应视图（手机也立即加载房间）。直达链接先将当前记录替换为页面，再重建页面 → 房间 → 特写的 history 栈，保证逐层返回；初始化房间机位后才进入特写。旧 `history.state` 不能让显示器/书架/电视返回页面时自动重开旧投篮。未知特写不自动打开房间。
- board 特写可拖动卡片；点击卡片退出房间并定位到页面对应卡片。页面与房间通过 `sectionchange`、`itemchange`、`themechange`、`roomlevel`、`pinchange` 等事件同步。
- Research 对应桌面双显示器；Projects 对应书架上的 Rover、蓝牙小车、柔性夹爪机械臂、Quest 3 头显、IMU 充电设备组、Telegram 小机器人及其他项目的封面相框；Games 对应电视、游戏盒；Playground 对应软木板。门当前只是场景，不代表已启用的 Say hi。
- 已实现：可开合百叶窗、可切换灯具/电视氛围光/辉光管时钟、旋转椅子、植物摆动；床上枕头和三所学校的玩偶可拖拽、投掷、碰撞。投篮特写自动轮换纸团、瓶子、弹力球，以洗牌的 24 个机位改变实际出手位置和相机（约 0.59–3.55 m，含近框、两侧底线、六个床上位置、四个新增超远三分和五个低机位），无需手选物品。桶位于平面 (3, 0.15) m，桶后距墙约 1.25 cm；篮板小框下沿对齐桶口。球场地毯为 1.40 × 1.68 m，避开床，推车摆放已隐藏但资源保留，桶底和碰撞面与地毯高度一致。三分线半径 1.32 m，与计分判断一致。
- 投篮：每个 1/120 s 物理子步检查向下穿过桶口即得分，停在桶边/桶底本身不计分，每个投掷物只记一次，弹出也算；两分是绿色单环/小粒子，三分是金粉双色双环/大粒子，提示不同。引导最多 16 点，使用独立 cannon-es 世界复制静态障碍与真实出手初始状态，截取首次碰撞前 82% 的轨迹并渐隐；不显示碰撞后反弹或最终落点。待投物只有约 1.8 CSS px 的薄荷色细轮廓，松手后去掉，不持续自转；不再把各子网格单独放大描粗边。下拉只改变力度、左右只改变方向，瞄准时显示力度条；取消出手的随机自转扰动，改善可预测性。下拉满力度需画面短边的 22%；真实出手点固定投影在画面 (50%, 62%)，蓄力不漂移。出手后保持视角；进球或碰到非篮板物体结束本轮，结果停留 1.4 s（与文字动画一致），再用 650 ms 换镜头。墙地/家具碰撞关闭计分，擦桶沿在结果停留期间仍可落入得分；只在篮板真实范围内的碰撞可继续打板，其他墙面碰撞结束本轮。异常飞行 8 s 才触发兜底，不能用固定 0.5 s 自动换球，也不等待物体落地/静止。两/三分 × 普通/打板四组随机解说词，避免连续重复；打板须实际碰撞篮板范围后进球。粒子和相机动画结束、物体休眠后停止重绘。减少动态效果时不生成庆祝粒子。
- 投篮镜头由 `room-hoops.ts` 的 `hoopsView` 计算，随距离/屏幕比例调整相机高度与视野，固定真实出手点的屏幕位置，resize 后重算；远端镜头避开衣柜缩窄的墙面。镜头不模拟背后的植物摆动，避免镜头外的叶片持续触发重绘，离开投篮后恢复；返回普通房间恢复 30° 视野。投篮物理含椅子和主要家具、天花板，椅子旁出手点已避开实体范围；临墙时沿相机后退方向缩短距离，避免独立 clamp 轴导致竖屏桶口出画，低机位的眼睛高度可由配置指定。投掷物仍抖动时，出手满 10 秒强制休眠，碰撞的反复唤醒不续期，防止床沿或旧球接触导致永久重绘。
- 篮板胶带是 `alphaTest` 镂空的不透明材质，保留 `alphaToCoverage` 抗锯齿。待投轮廓把完整物体焊接为选择几何并平滑法线，在裁剪空间扩展固定像素宽度，用 stencil mask 排除内部接缝与透明瓶身；不用后处理或粗黑底边。renderer 必须启用 stencil；mask 只写 stencil、不写颜色/深度，外轮廓写深度，避免后绘制的篮板黑线穿透。resize 同步轮廓 viewport。
- 日夜跟随页面主题开关，不跟随 Madison 当地时间。时钟显示 Madison 时间。

## 3D 管线与性能

- **Blender 构建资源，Three.js 组装场景。** `src/scripts/room.config.ts` 管房间轮廓、摆放、颜色角色、镜头、标签、灯光和贴图；`src/scripts/room.ts` 管渲染与交互；`src/scripts/room-physics.ts` 管床上玩具物理，`src/scripts/room-hoops.ts` 管投篮，均使用 cannon-es 并按需加载。
- 房间约 4.13 × 3.70 × 2.70 m，配置采用平面坐标：x 向右、y 沿平面向上、z 为高度；不要直接套用 Three.js 轴。Blender 模型正面朝 −Y，1 单位 = 1 m，原点通常是底面中心（挂墙物为背面底部中心）。
- 资源库在仓库外的 `room_assets.blend`，位置由 `ROOM_ASSETS` 或忽略的 `bin/.room-assets-path` 提供。每个资源一个 `asset_<name>` collection，不直接改测量原始模型。
- `bin/room-assets [--watch]` 导出并 meshopt 压缩到 `public/room/assets/*.glb`，同时写 `manifest.json`。模型通过材质角色、`Color` 顶点色和 manifest 元数据驱动；屏幕/封面/板面需要 0–1 UV 平面。
- 布局或光照改动后：先 build，在 :4321 提供预览，再运行 `bin/room-posters`，最后重新 build。脚本生成日夜 poster，且会调用 `node bin/room-og.mjs` 更新 `public/og.png`。OG 单独重绘也可调用该 Node 脚本。
- 展开收起使用 Web Animations；验证动画需实时浏览器/CDP，不能只靠 Chrome `--virtual-time-budget`。
- 当前布局为 PLAN 中的 Layout B，使用 `bed_single`；旧镜子、Layout A 和双人床不能当成当前布局。
- 静态 HTML 优先，桌面空闲时加载 Three.js，移动端进入房间才加载；无 WebGL 保留 poster。尊重 reduced-motion，不让学术页面依赖动画。
- 渲染按需进行，画面不可见或标签页隐藏时停止绘制。时钟日夜默认开启；白天仅在秒数变化时重绘，空闲基线约为 2 frames / 2 s，手动关闭时钟且无其他动态源时才为零绘制。夜间时钟闪烁及氛围光开启时约 30 fps 重绘。床上玩具物理首次进入全屏才加载，投篮首次进入 hoops 才加载，物体静止后休眠。
- 论文/游戏视频只在页面侧栏播放，进入全屏及任何特写暂停，回到页面恢复；不可见或隐藏标签页也暂停。视频帧回调触发重绘，不支持回调时降为约 30 fps，不能再用“有视频未暂停就每帧 dirty”的逻辑。暂停造成的 `play()` AbortError 和过期请求不能覆盖当前画面。
- 光照：Neutral tone mapping、房间配色的环境反射、按角色的表面质感、资源 baked AO；隐藏的墙仍遮光，天花板保留永久遮光层；室内视角另显示与物理高度一致的 2.7 m 顶面，总览继续敞顶，日/月光从窗户进入。床上可移动玩具不保留固定接触阴影；软木板用绘制的柔和墙面阴影。
- 切墙只用于页面/室外总览。全屏相机位于房间平面轮廓内且高度在 0–2.7 m 内时，墙、墙柱、门窗和天花板内表面完整显示；天花板面沿实际 L 形轮廓，保留原遮光封口，顶面不接收该封口的自遮挡阴影。不能继续按视线方向隐藏墙面，否则宽视角会露出页面背景，在夜间形成黑带。判断须使用实际 L 形轮廓，不能只用外接矩形。
- 书架每层暖色灯带用 shader 线光实现，随深色主题开启；不要改回聚光灯光斑或无必要增加 RectAreaLight 体积。显示器灯条也随主题，不提供独立开关。
- PLAN 的目标预算：GLB 总计约 ≤3 MB，房间 JS ≤200 KB gzip；不加后处理。Lighthouse 目标桌面 ≥90、移动 ≥80、可访问性 ≥95，目标不等于已测结果。

## 地图与尚未开展的功能

- 已有距离卡：MapLibre + OpenFreeMap，浏览器请求 GeoJS 做城市级 IP 定位，失败退回时区，再失败保留默认文案。地图在卡片接近视口或全屏房间打开时加载，静态截图同步到房间软木板。`src/scripts/distance-map.ts` 负责地图。
- 距离卡不是访客统计或在线用户系统。访客地图服务仍延期，不能声称已接入。
- 后续工作以 PLAN 为准：更多 Playground 素材、书架项目模型、旅行地图、博客、Say hi 角色和访客地图均未完成或延期。
- 明确不做：news 区块、旧课程日历、论文桌面道具、按当地时间切房间日夜、镜子热点和单独 About & CV 区块。不要把已放弃的想法重新列为待办。

## 检查与近期维护

- PC Era 主机及节点分组贴图与投篮功能共同保留在当前场景中。检查和提交资源时同步核对 GLB、manifest、贴图及源码，不能只提交 manifest。导出器支持 JSON 数组/对象元数据，也须保留空字符串。
- `asset_rover` 是从 `all_2` CAD 装配恢复并精简的书架模型；`asset_quest3` 对应 SketchGenie，仅保留正放头显，不含手柄；`asset_imu_devices` 是 IMU 的手机、智能手表和闭合耳机盒，共用简化的薄三合一充电底座。设备机身按 Apple 尺寸校准，整组等比缩放；IMU 与 Quest 以 `lifeSize: true` 保持房间内 1:1，不能为槽位缩小。保留原有每层两个项目的顺序：顶层 IMU/Quest，中层车/机械臂，下层 Rover/机器人，最底层不放项目。不要为适配模型擅自重排布局；Quest 已移除两个手柄以保留原槽位。hover 仍临时放大最多 22%，但增长向前留空间、后沿不顶入背板；书架前方为空气，允许探出前沿。Quest 按约 160 mm 的刚性前壳宽度校准，头带展开外包围尺寸不等于最小调节尺寸；手表为金属表壳、单层深色表面和哑光表带。`asset_robotics_vehicle` 依据项目照片建模：麦轮底盘、亚克力塔架、放下的橙色举升臂、海绵夹爪，底盘上有简化的 Arduino Uno、两块 L298N、HC-06 和 18650 电池盒；省略线束。`asset_robotic_arm` 依据照片、CAD 截图和作者说明建模：四根加长红腿（不做木块）、底板电机小齿轮驱动大齿轮、六根柱子、缩短的实色箱形悬臂梁与滑车齿条、三指硅胶软爪。`asset_chatbot_robot` 是 Telegram 的静态小机器人，由 CC BY 的 S-Bot 改为短身体、手臂下垂、白蓝配色并补做蓝色眼睛。头显、手机和机器人采用 CC BY 模型，来源见 `public/room/assets/CREDITS.txt`，页脚提供入口。`bin/room_model_assets.py` 将已审核的 collection 追加到外部资源库并单独导出，标准导出器已能保留它。`PROJECT_MODELS` 映射项目条目到模型，未配置的条目保留相框。页面 hover/focus 和房间直接 hover 共用有界的展品放大，各模型以底部为锚点放大 10–22%：缩小的模型只预留 10% 以尽量填满槽位，放大幅度取槽位宽高允许的值；放大时后沿固定、向前移动，深度不预留，并可伸出敞开的书架前沿最多 4 cm。Rover、机械臂朝向 0°，小车 5°，以减少斜放占用的槽位；书架整体不再放大。`npm run check:shelf` 用实际构建和 GLB 检查动画中的层板/邻近展品边界、相机固定和 hover/focus。
- `asset_court` 是新的 Blender 地毯资源，`bin/room_court_asset.py` 在现有库中生成并单独导出，之后标准 `bin/room-assets` 会保留它。该生成器更新后仍须 meshopt 压缩并更新 manifest 的 bytes；不需要重导出其他资源。
- 2026-10-24：manifest 的 42 项资源文件均存在，总计 2,145,664 bytes，大小记录匹配；房间主 chunk 约 193 KB gzip，低于 200 KB。物理库可能被构建器拆为共享 chunk，地图还有独立 worker，不要只按一个入口估算总下载。
- 类型检查用 `npm run check` 或 `npx astro check`。`tsconfig.json` 已限于 `.astro/types.d.ts`、`src/**/*`、`astro.config.mjs`，不再扫描旧 Jekyll 依赖或本地 worktree；旧缓存、依赖、日志、`.claude/` 由 `.gitignore` 忽略。
- 浏览器回归：先 `npm run build`，使用已有 :4321 Astro preview，再运行 `URL=http://localhost:4321 npm run check:room`；`CHROME` 可指定 Chrome，`VIDEO_FALLBACK=1` 验证无视频帧回调路径，`ROOM_LINKS_ONLY=1` 只验证直达、刷新恢复、手机冷启动、减少动态效果及返回/前进/区块跳转。脚本使用独立临时浏览器配置，不修改日常浏览器。
- `npm run check:hoops` 使用实际 GLB 和 cannon-es、模拟指针输入与时间，验证 24 机位 × 三种物品共 72 种实际进球、两/三分打板识别与文案、特效、自动轮换、固定出手投影、碰撞结束（含未落地的椅子碰撞）、完整结果停留、描边只在待投时显示、引导与真实轨迹一致、力度与方向解耦、取消输入及休眠；不需要 GPU 或真实等待。
- `bin/check-room.mjs` 在 SwiftShader 下计数房间 canvas 未绑定 framebuffer 时的 WebGL clear，报告 room frames，排除阴影贴图 pass：视频在页面播放并在退出房间后恢复，白天全屏/board/hoops 稳定后仅保留时钟的 1 Hz 重绘，三种投掷物投出会额外重绘、落稳后恢复该基线。测量前须等待相机、物理及初始 120 帧预热结束；空闲断言容许最多 3 frames / 2 s 的计时边界余量，不能再要求默认零绘制。
- 2026-10-22 验证：`npx astro check` 的 25 个文件为 0 errors、0 warnings、0 hints；正常视频帧回调与 30 fps 兼容路径均通过浏览器回归。当时白天时钟默认关闭，全屏、board、hoops 空闲及三种投掷物落稳后的 0 clear / 2 s 是旧实现的历史结果，不能作为当前默认基线。夜间时钟和氛围灯可正常驱动重绘。
- 2026-10-24：类型检查、构建、带床碰撞的 72 种“机位 × 物品”实际物理进球测试和 Chrome 回归通过，页面视频正常恢复；已检查 24 个机位及桌面/手机取景，当前白天描边待投及投篮落稳后的空闲基线约为 2 frames / 2 s（时钟每秒更新一次）；回归还核对各机位的桶口在竖屏内、待投物不与家具重叠、结果动画不被切断。资源和脚本大小随资源再生成而变化，发布前重新核对 manifest 与 200 KB gzip 预算。新日夜 poster 和 OG 已重绘。
- Lighthouse 指标仍是目标，未完成实测；Vite 的大 chunk 提示不能当作类型错误，也不能忽略总加载体积。
