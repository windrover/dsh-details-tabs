# dsh-details-tabs — 多面板右侧栏容器（v2 并列布局）

一个 DeepSeek Harness（`dsh`）**浏览器客户端插件**：把右侧详情栏（`details` 单槽）变成**多面板并列容器**，让多个面板（记忆、产物、未来的终端/文件浏览器……）以 Blender 编辑器式布局**同时可见**：左右/上下并排、可拖分隔条调比例、可拖拽合并/替换/关闭。

它解决了 DSH 的一个原生限制：`details` 槽是**单槽**（同一时刻只能渲染一个插件），多个面板会互相遮蔽或报 priority 冲突。本插件作为容器占住该槽，再通过**子槽位**让面板注册为并列的面板。

## 功能

| 能力 | 说明 |
|---|---|
| **v2 并列布局** | 面板以 `leaf / split(row/col, ratio)` 树渲染，多个面板同屏可见（不再只是切换 tab） |
| **默认纵向堆叠** | 新面板默认纵向排列（col）——详情栏窄，并排会让每个面板过窄无法阅读；需要并排时用拖拽显式创建 |
| **拖拽合并 / 替换** | 拖动面板标题到另一面板上：左/右 = 横向并排、上/下 = 纵向堆叠、中间 = 替换 |
| **可调分隔条** | 拖 split 之间的分隔条调整占比，比例实时持久化；横向（并排）子面板有 **140px 最小宽度**保护，不会被拖到无法阅读的宽度 |
| **面板条 (strip)** | 顶部列出所有已注册面板：亮=已打开、暗=已关闭；**点击切换显示/隐藏**；右侧 `↺` 重置布局（清空旧排列、纵向重排）、`»` 收起侧栏 |
| **Blender 风格 DockRail** | 侧栏收起时，右侧边缘竖向显示所有面板的短标签（点击展开对应面板）；无面板时显示 `≡` 兜底展开按钮 |
| **布局持久化** | 整棵树存 localStorage（`dsh-details-tabs:layout`）；关闭全部面板也会记住，重启不会复活 |
| **第三方兼容（零改动接入）** | 任何按原生方式注册进 `details` 槽的第三方插件都会被自动镜像为容器面板，无需改第三方代码（官方「工具调用详情」面板除外，见下） |
| **自适应挂载** | 面板「容器在 → 注册为面板；容器不在 → 直接占 details 槽」，互不依赖 |
| **会话上下文** | 每个面板用 `SessionProvider` 包裹，面板可拿到 `useSessions`/`useWorkspaces` 等会话 hooks |
| **零冲突** | 面板用 `key` + `label` 注册，无需 priority 竞争 |

## 安装

```sh
cd dsh-details-tabs
dsh plugin --profile web add .
# 或 file: 形式
dsh plugin --profile web add "file:$(pwd)"
```

然后**重启 `dsh web`**。bundle patch 插入 `id: details-tabs` 行。

> ⚠️ 若 `cordis.patch.yml` 或 profile 里已有 `details` 相关插件配置，注意本插件占 `details` 槽（priority **-10**）。同一 profile 只应有一个 details 容器。

## 第三方兼容（其他开发者插件，零改动接入）

DSH 原生让插件出现在右侧栏的方式是**直接注册进 `details` 单槽**。单槽只渲染最低 priority 的那个 entry，所以本容器（-10）会赢下该槽——**任何按原生方式注册的第三方插件，都会被自动镜像成容器面板**，第三方代码**一行都不用改**：

- 社区里按 `details` 槽写的面板（如 README 曾推荐的 priority -1/-2 写法）被吸收为容器面板；
- 若第三方面板后来也升级成自适应挂载（注册进 `details.tabs.item`），镜像自动让位，不会重复；
- **官方「工具调用详情」面板（shell 原生 DetailsPanel）不被镜像**——它是 DSH 自带内容而非第三方插件，识别特征为 locale `conversation` 且声明 `conversation.details.*` 子槽；若 DSH 改版导致识别失效，面板会重新出现（安全降级，不报错）。

**外部面板默认不自动加入布局**：镜像面板（key 统一带 `ext:` 前缀）只以**暗色 chip** 出现在顶部面板条，点击才打开——避免布局突变；已持久化进布局但已失效的叶子（插件被卸载、镜像被跳过）会在刷新时自动修剪（`prunePanels`）。

实现：`mountThirdPartyMirror` 订阅 `details` 槽，把每个外部 entry（同 component + inject）注册进 `details.tabs.item`，key 统一 `ext:<key|priority>`（单槽同 priority 会互斥，天然唯一且跨重启稳定）；不复制 children 声明（原 entry 仍持有）；启动顺序兜底由 2s 轮询重试。行为测试见 `test/mirror.test.mjs`（覆盖同步/延迟注入两种启动顺序）。

已知限制：未适配 `embedded` 的第三方面板打开后会同时显示自己的标题栏与容器叶子标题栏（双重标题）；这是第三方代码决定的，可提示对方接 `embedded`。

## 注册新面板（给插件开发者）

任何插件想进右侧栏，只需在**客户端 bundle** 里注册到子槽 `details.tabs.item`：

```js
ctx.slots.inject("details.tabs.item", () => ctx.slots.register({
  name: "details.tabs.item",
  key: "my-panel",          // 唯一 key，tab 与 DockRail 用它标识
  label: "我的面板",          // tab 标题
  locale: "my-plugin",      // 可选：locale namespace
  inject: () => ({
    closeDetails: () => ctx.layout.closeDetails(),
  }),
}, MyPanelComponent));
```

- `key` 唯一；`label` 显示在面板条、面板标题和 DockRail 磁贴。
- 组件可接收注入的 `sessionId` / `useSessions` / `useWorkspaces` / `t`（会话标准 props）。
- **不需要 priority**——容器按注册顺序 + 布局树渲染。

### 自适应挂载（推荐模式）

建议面板用**自适应挂载**：容器在则注册为 tab，不在则回退到直接占 `details` 槽（独立可用），并监听槽变化自动迁移。参考 `dsh-long-term-memory` 与 `dsh-artifacts-panel` 的 `mountPanel` 实现：

```js
function mountPanel(ctx, panel) {
  const containerKey = "details.tabs.item";
  let disposer = null, mountedAs = null;
  const hasContainer = () => { try { return ctx.slots.spec(containerKey) !== undefined; } catch { return false; } };
  const mountTab = () => { /* register into details.tabs.item with key/label */ };
  const mountStandalone = () => { /* register into details with priority -2+ */ };
  const sync = () => {
    const desired = hasContainer() ? "tab" : "standalone";
    if (mountedAs === desired) return;          // 已在正确位置——no-op
    mountedAs = desired;                        // 先设目标再挂载（防重入循环）
    if (desired === "tab") mountTab(); else mountStandalone();
  };
  // 订阅 details + 子槽两个 key：容器后注册 details 时触发迁移
  const off1 = ctx.slots.subscribe("details", sync);
  const off2 = ctx.slots.subscribe(containerKey, sync);
  sync();
}
```

这样面板**单独安装也能用**（standalone details），装了容器就自动变成容器面板。

## 与现有面板配合

| 面板 | key | label |
|---|---|---|
| dsh-long-term-memory（记忆） | `long-term-memory` | 长期记忆 |
| dsh-artifacts-panel（产物） | `artifacts` | 产物 |

两个面板都做了自适应挂载：容器在 → 容器面板；容器不在 → 各自独立占 details（自动避让 priority）。

## 已知限制

- **会话上下文**：子面板若要 `useSessions`/`useWorkspaces`，容器已用 `SessionProvider` 包裹（无需面板额外处理）；但面板自身仍要能容忍 hooks 为 undefined 的降级（standalone 或异常时）。
- **轮询刷新**：面板列表用 2s `setInterval` 刷新（量小无碍；未来可换 slot 订阅）。
- **布局持久化**：localStorage 按浏览器 origin 存，不跨设备同步。
- **布局代数**：当前每个面板在树中唯一；`center` 落下 = 替换（被替换面板关闭，仍可在面板条/ DockRail 重新打开）。

## 文件

- `lib/client.js` — 浏览器 bundle：`TabsContainer`（并列布局渲染 + 拖放 + 分隔条）、`DockRail`（竖向磁贴）、`mountThirdPartyMirror`（第三方兼容镜像）、布局代数（与 `lib/layout.js` 保持同步）、持久化。
- `lib/layout.js` — 纯布局代数（`leaf/split/dropOn/closePanel/setRatioAt/addPanels`），无 React/DOM 依赖，单元测试覆盖。
- `test/layout.test.mjs` — 布局代数断言（`node test/layout.test.mjs`）。
- `test/mirror.test.mjs` — 第三方镜像行为测试（模拟 slots 核心，`node test/mirror.test.mjs`）。
- `lib/index.js` — 宿主空 apply（仅使 bundle 行存在）。
- `cordis.patch.yml` — bundle patch（插入 `id: details-tabs`）。
- `package.json` — bundle manifest（`dsh.bundle.patch` + `dsh.client`）。

## 许可

MIT
