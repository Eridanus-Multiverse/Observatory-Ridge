# Observatory Ridge · 山脊天文台

[English](README.md) | 简体中文

把笔记、记忆和它们之间的关系，变成一片可以漫游的星系。

大多数知识图谱看起来像电路接线图。这套工具从另一个问题出发：如果你记住的东西配得上一片天空呢？概念成为行星，记忆围绕它所属的概念旋转，暂时没有归属的漂在小行星带里——而当你退得足够远，你写下的一切会聚成一团团有颜色的星云，像一座只有你能种出来的星系。

Observatory Ridge 是一套与后端无关的可视化工具箱，为同一份知识库提供三种彼此相关的视图：

- **近焦 3D**：可导航的恒星—行星系统，带卫星与小行星带。
- **近焦 2D**：SVG 星图，适合低功耗设备与紧凑布局。
- **星系视图（Galaxy View）**：按社群着色、力导向平衡的记忆图谱。

所有可视化只消费普通 JSON。它们不拥有数据库、不调用私有 API，也不替宿主应用决定鉴权方式。

> **开发状态：** 全部部件均已在仓库中并可从 demo 运行：数据契约、加固的哈希、太阳系预设、星系视图、近焦 2D、完整的近焦 3D（着色器恒星、bloom、镜头跟随导航、行星表面、记忆卫星、小行星带），以及回声之海双子（2D 星图 + 3D 情绪星系）。

## 设计原则

### 记忆归属：概念成为行星

行星是一个人工整理的概念。归属于该概念的记忆成为它的卫星；没有确定归属的记忆留在小行星带。这让"不确定"本身可见，而不是把每条记录硬塞进某个分类。

归属判定应放在适配器或数据摄入层，而不是渲染器里。一个实用的引擎应当：

1. 归一化别名与候选文本，但不改动源记录。
2. 显式归属和精确别名命中优先于启发式匹配。
3. 关键词或语义匹配只在确定性规则之后计分。
4. 用稳定规则解决平局，把低置信度的记录留为未归属。
5. 输出一份 `RidgeSnapshot`；永远不要让可视化组件自己去抓取私有数据。

当前的脚手架定义了输出契约，不包含语义分类器。

### 社群检测成为颜色

星系视图把记忆当作节点、把关系当作带权重的边。目标实现先用类别给每个节点播种，再执行一趟确定性的标签传播。邻居投票把相关区域合并成社群；稳定的平局裁决和稳定的社群排序保证同样的数据渲染两次颜色不会变。

颜色传达的是社群，不是身份。选中态、关系强度和关注度仍然可以改变亮度或强调程度，而不破坏社群地图。

### 力导向布局平衡整个图

一片有用的星系不能只有引力。当枢纽节点、孤立笔记和稠密社群共存时，它必须保持可读。目标布局组合了：

- 靠近黄金角社群锚点的确定性初始位置；
- 防止节点塌缩的成对斥力（小图上精确计算，大图上用确定性的有界采样）；
- 关联记忆之间的带权弹簧；
- 按度数归一化的弹簧强度，避免枢纽吸走所有力量；
- 社群向心力，叠加一个更弱的全局居中力；
- 固定的迭代上限与阻尼，保证可复现的输出。

近焦与星系视图都用稳定 ID 作为视觉种子。同样的数据应当渲染出同样的场景，直到数据本身改变。

## 组件地图

| 路径 | 状态 | 职责 |
| --- | --- | --- |
| `src/core` | 可用 | 共享的 TypeScript 数据契约与确定性视觉工具。 |
| `src/presets` | 可用 | 通用快照与主题，含太阳系预设。 |
| `src/near-focus-3d` | 可用 | React Three Fiber 星系：着色器恒星与 bloom、镜头跟随导航、按类型渲染的行星表面、记忆卫星、双层小行星带。 |
| `src/near-focus-2d` | 可用 | SVG 星图，与 3D 共享同一套选中语义和数据模型。 |
| `src/galaxy-view` | 可用 | 社群检测、力导向布局、图渲染与拾取。 |
| `src/echo-starmap` | 可用 | Canvas 情绪月空：气辉星云、羁绊线、情感坐标格。 |
| `src/echo-galaxy` | 可用 | React Three Fiber 情绪星云：明暗/汹涌/时间三轴、暗井、耀星。 |
| `demo` | 可用 | Vite 应用，带生成数据与可配置主题。 |

2D 与 3D 近焦视图是对等的，不是两个产品。它们应当接受同一份 `RidgeSnapshot`，并在平台允许的范围内暴露等价的恒星/行星事件。选中态目前是非受控的；需要连续性的宿主在切换视图时应自行保存选中实体。

## 数据契约

所有 ID 必须是稳定字符串。边引用记忆 ID；`planetId` 引用行星 ID。日期如果提供，应为 ISO 8601 字符串。适配器必须把源数据的关注度分数归一化到文档规定的 `heat` 范围（0 到 1）。渲染器应当校验外键并忽略非法的边，而不是让整个场景崩溃。

### 近焦快照

```json
{
  "star": {
    "name": "Archive",
    "definition": "The center of this collection"
  },
  "planets": [
    {
      "id": "concept-projects",
      "name": "Projects",
      "definition": "Things being built",
      "archetype": "rocky",
      "rank": 1,
      "memoryCount": 2,
      "memories": [
        {
          "id": "note-prototype",
          "title": "Prototype notes",
          "date": "2026-01-15",
          "category": "work",
          "preview": "First pass and open questions",
          "heat": 0.8,
          "planetId": "concept-projects"
        }
      ]
    }
  ],
  "asteroids": [
    {
      "id": "note-inbox",
      "title": "Unsorted note",
      "heat": 0.2,
      "planetId": null
    }
  ]
}
```

`RidgeSnapshot` 包含：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `star` | `{ name, definition? }` | 中央恒星的标签与可选描述。 |
| `planets` | `RidgePlanet[]` | 人工整理的概念，按 1 起始的 `rank` 排序。 |
| `asteroids` | `RidgeMemory[]` | 未归属的记忆，渲染在行星系统之外。 |

`RidgePlanet` 包含：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | `string` | 稳定唯一的概念 ID。 |
| `name` | `string` | 显示名。 |
| `definition` | `string?` | 供详情视图使用的简短描述。 |
| `archetype` | `rocky \| oceanic \| gas \| ice \| volcanic` | 可选的表面视觉类型。 |
| `rank` | `number` | 1 起始的显示顺序；数字越小轨道离恒星越近。 |
| `memoryCount` | `number` | 归属记录总数，含未随 `memories` 返回的记录。 |
| `memories` | `RidgeMemory[]?` | 可选，供详情视图使用的记录。 |

`RidgeMemory` 包含：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `id` | `string` | 稳定唯一的记忆 ID。 |
| `title` | `string` | 显示标题。 |
| `date` | `string?` | ISO 8601 日期，用于标签或排序。 |
| `category` | `string?` | 星系视图使用的类别种子。 |
| `preview` | `string?` | 简短、且已脱敏的详情文本。 |
| `heat` | `number?` | 0 到 1 的关注度。 |
| `planetId` | `string \| null?` | 所属行星；未归属时为 `null`。 |

`memoryCount` 有意与 `memories.length` 分离。服务端可以报告真实总数，同时只返回一小份脱敏的预览集。

### 星系图

```json
{
  "nodes": [
    {
      "id": "note-prototype",
      "title": "Prototype notes",
      "category": "work",
      "heat": 0.8,
      "planetId": "concept-projects"
    },
    {
      "id": "note-review",
      "title": "Review notes",
      "category": "work",
      "heat": 0.5,
      "planetId": "concept-projects"
    }
  ],
  "edges": [
    {
      "source": "note-prototype",
      "target": "note-review",
      "weight": 0.7
    }
  ]
}
```

`RidgeGraph.nodes` 使用与 `RidgeMemory` 相同的形状。每条 `RidgeEdge` 有 `source` ID、`target` ID 和可选的 `weight`（0 到 1）。重复边与自环应由数据适配器在渲染前归一化。

### 主题

```ts
import type { RidgeStarTheme } from "./src/core/types";

const theme: RidgeStarTheme = {
  starHot: "#fff3d2",
  starWarm: "#e8a052",
  keyLight: "#ffd6a0",
  background: "#01040c",
};
```

内置的 `SOLAR_STAR_THEME`、`BLUE_STAR_THEME` 和 `solarSystemSnapshot()` 都从 `src/presets/solar-system.ts` 导出。

## 安装与使用

要求：Node 20.19+ 与 npm。其余全部本地安装。

```bash
cd Observatory-Ridge
npm install    # 安装 React、three.js、@react-three/fiber、@react-three/drei、Vite
npm run demo   # 打开 demo 应用（星系视图 + 近焦，合成数据）
```

其它命令：

```bash
npm run typecheck  # TypeScript 契约与组件检查
npm test           # 确定性布局与 SVG/SSR 回归测试
npm run build      # 生产版库构建 + demo 构建
npm run verify:package  # 检查发布 tarball 并导入其构建产物
```

要把组件嵌进你自己的 React 应用，安装 peer 依赖（`react`、`react-dom`、`three`、`@react-three/fiber`、`@react-three/drei`——精确版本范围见 `package.json`），然后从包根导入：

```tsx
import { GalaxyView, NearFocus2D, NearFocus3D } from "observatory-ridge";

<GalaxyView graph={yourGraph} />
<NearFocus2D snapshot={yourSnapshot} />
<NearFocus3D snapshot={yourSnapshot} />
```

`NearFocus2D.palette` 接受 `#RRGGBB` 颜色，数组为空时回落到内置色轮。`GalaxyView.dustPerNode` 会被归一化为 0 到 32 的整数，畸形的显示配置不可能触发无界的 typed-array 分配。

没有插件、没有构建期代码生成、没有服务依赖——组件只渲染你递给它的 JSON。

在源码检出状态下工作时，适配器已经可以对准共享契约，而不必把私有记录形状耦合进渲染器：

```ts
import type { RidgeMemory, RidgeSnapshot } from "./src/core/types";

type SourceRecord = {
  key: string;
  label: string;
  owner?: string;
};

export function makeSnapshot(records: SourceRecord[]): RidgeSnapshot {
  const memories: RidgeMemory[] = records.map((record) => ({
    id: record.key,
    title: record.label,
    planetId: record.owner ?? null,
  }));

  return {
    star: { name: "Archive" },
    planets: [],
    asteroids: memories.filter((memory) => memory.planetId == null),
  };
}
```

抓取、鉴权、归属判定和脱敏都留在宿主应用里。只把最小的展示载荷传进可视化组件。

## 部署 demo

```bash
npm run build:demo   # 产出 demo/dist，资源为相对路径（base: "./"）
```

`demo/dist` 是完全静态的站点——没有服务端代码、没有环境变量、不需要重写规则。任何能提供静态文件的地方都能托管它：

- **GitHub Pages**：`npx gh-pages -d demo/dist`，或用上传 `demo/dist` 的 Pages 工作流。相对路径 base 意味着放在项目子路径（`user.github.io/repo/`）下开箱即用。
- **Netlify / Vercel**：构建命令 `npm run build:demo`，发布目录 `demo/dist`。
- **自有服务器**：把目录拷到任意 web 根下——`rsync -a demo/dist/ server:/var/www/ridge/`——按普通静态文件伺服即可。

demo 只携带合成数据；部署它不会发布任何个人内容。当你把组件接上真实知识库时，把适配器和数据源留在宿主应用里（见上一节），然后按你原本的方式部署那个应用——组件本身始终只是一个静态依赖。

## 避坑日志

这些实现层面的失败起初看起来只是外观问题，进了生产环境就会吞掉几个小时。每条记录了可见症状、真正的原因和真正管用的修法。

### SVG 光晕被裁成方盒

**症状：** 模糊的恒星或日冕，在光晕的上下左右出现笔直的透明切边。

**根因：** SVG 滤镜默认使用较小的对象包围盒区域，每侧只有约 10% 的余量，宽高斯模糊在滤镜边界处被直接丢弃。把圆画大并不会同步放大滤镜区域。

**修法：** 给光晕滤镜一个显式、余量充足的区域。例如中等模糊可用 `x="-70%" y="-70%" width="240%" height="240%"`；当所需边界在场景坐标下已知时，`filterUnits="userSpaceOnUse"` 更稳。测试光晕要测视口边缘，不要只看中心。

### 透明渐变吃掉点击

**症状：** 行星看得见却点不中，尤其当它在日冕或星云覆层后面时。

**根因：** 视觉上透明不等于从命中测试中移除。一个完全透明的渐变依然可以压在可交互节点上方，成为事件目标。

**修法：** 给每一个装饰层设置 `pointer-events="none"`。为小目标添加独立、显式的命中区域，让命中区域保持在装饰之上，只在真正的交互处理器内部停止事件传播。

### 顺序 ID 产出一模一样的星环

**症状：** ID 形如 `planet-01`、`planet-02`、`planet-03` 的行星，星环数量、倾角或纹理可疑地雷同。

**根因：** 裸 FNV-1a 确定又快，但对只在结尾处不同的输入雪崩性很弱。把这些相关的输出映射进少量视觉桶，碰撞就一目了然。

**修法：** 在 FNV-1a 之后跑一遍最终雪崩混合。`src/core/hash.ts` 使用 MurmurHash3 的 `fmix32` 序列，再把无符号结果映射到 `[0, 1)`。不相关的视觉属性使用不同的盐。这是视觉随机性，不是安全哈希。

### 等距柱状天空出现接缝或极区弧线

**症状：** 天空有一条竖直的接缝、重复的星点，或极点附近的同心弧。

**根因：** 等距柱状纹理在 `u=0/1` 处拼接，且在两极把大量纹素压进极小的面积。离散的星点会同时暴露接缝和投影畸变。

**修法：** 等距柱状纹理只用于无缝、低频的颜色和噪声，并让其水平边缘吻合或交叉淡化。离散星点用真正的 3D `Points` 分布在球面上渲染，密度就不会在极点塌缩。

### PWA 更新了但仍在跑旧包

**症状：** service worker 和缓存都是新的，已安装的 PWA 却继续运行旧 JavaScript，直到整页重载。

**根因：** 更新 service worker 不会替换当前文档里正在执行的代码。激活、接管和文档导航是相互独立的生命周期步骤。

**修法：** 应用回到前台时调用 `registration.update()`，检测 `controllerchange` 或服务端 build ID 不匹配，然后在新 worker 接管页面后做一次受保护的整页重载。存下已见过的 build ID 防止重载循环，并在过渡期间保留旧的哈希资源，让存量文档不会请求到缺失的 chunk。

### UnrealBloom 在 DPR 3 下非常昂贵

**症状：** 基础场景在高密度屏手机上很锐利，一开 bloom，旋转或缩放就开始卡顿。

**根因：** 全屏后处理的成本跟着像素数走。DPR 3 意味着每个 CSS 像素约九个设备像素的全分辨率处理，而 UnrealBloom 还要加好几个模糊渲染目标。

**修法：** 独立地给效果合成器的 pixel ratio 设上限（通常 1 到 2），在锐利几何重要时让基础渲染器保持设备比率。为受限设备减少或关闭 bloom 通道，并在真实手机上度量渲染调用与帧时间。

### `Points` 渲染成方形粒子

**症状：** 星野看起来像彩色的方形纸屑，即使开了叠加混合。

**根因：** 点图元光栅化为方形点精灵。没有 alpha 遮罩时，方块内每个片元都可见。

**修法：** 给 points 材质挂一张小的径向 alpha 纹理（比如 `CanvasTexture`），或在着色器里用 `gl_PointCoord` 采样。使用透明混合，为叠加的星尘关闭深度写入，并在持有者卸载时释放生成的纹理与材质。

### 力导向图在枢纽周围被撕开

**症状：** 高连接度的记忆把布局拉成松散的长线，低度数的关系不再呈现为紧密的成对。

**根因：** 给每条边同样的弹簧强度，会让枢纽积累远超普通节点的合力。加大全局引力只是靠压塌整张图来掩盖问题。

**修法：** 按端点度数归一化每条连线。一个实用的起点是 `1 / max(1, min(degree(source), degree(target)))` 再乘以边权重。保持独立的社群力与全局居中力，给孤立节点稍强的社群牵引，使用确定性初始化加固定迭代预算。如果用 `d3-force`，通过 link-strength 访问器实现同样的策略，不要假设一个常数适合所有图。

## 发布安全

把每一个候选版本都当作仓库已经公开来对待。发布之前：

1. 扫描源码、夹具、截图、source map 和 Git 历史，查找真实姓名、私有实体标签、主机名、地址和本地文件系统路径。
2. 拒绝真实的记忆标题、预览、日期、关系文本和数据库摘录。示例必须是合成的。
3. 拒绝凭据、会话材料、鉴权头、签名文件、环境文件和拷贝来的部署配置。
4. 确认 demo 生成器没有网络依赖，也没有回落到任何私有端点。
5. 从干净检出构建，检查产出的 bundle，并在改变仓库可见性之前对构建产物重复上述扫描。

干净的工作区不能证明历史也干净。任何泄漏材料都要在发布前重写或替换掉；在后续 commit 里删除是不够的。

## 许可证

[MIT](LICENSE)
