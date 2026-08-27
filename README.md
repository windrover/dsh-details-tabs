# dsh-details-tabs — 多标签右侧栏容器

一个 DeepSeek Harness（`dsh`）**浏览器客户端插件**：把右侧详情栏（`details` 单槽）变成**多标签容器**，让多个面板（记忆、产物、未来的终端/文件浏览器……）以 tab 形式共存、可切换、可拖动排序。

它解决了 DSH 的一个原生限制：`details` 槽是**单槽**（同一时刻只能渲染一个插件），多个面板会互相遮蔽或报 priority 冲突。本插件作为容器占住该槽，再通过**子槽位**让面板注册为标签。

## 功能

| 能力 | 说明 |
|---|---|
| **多标签** | 右侧栏顶部 tab 栏，每个已注册面板一个标签，点击切换 |
| **Blender 风格 DockRail** | 侧栏收起时，右侧边缘竖向显示所有面板的短标签（点击展开对应面板）；无面板时显示 `≡` 兜底展开按钮 |
| **拖拽排序** | HTML5 DnD 拖动 tab 换序，顺序存 localStorage（`dsh-details-tabs:order`） |
| **自适应挂载** | 面板「容器在 → 注册为 tab；容器不在 → 直接占 details 槽」，互不依赖 |
| **会话上下文** | 用 `SessionProvider` 包裹子面板，面板可拿到 `useSessions`/`useWorkspaces` 等会话 hooks |
| **零冲突** | 面板用 `key` + `label` 注册，无需 priority 竞争 |

## 安装

```sh
cd dsh-details-tabs
dsh plugin --profile web add .
# 或 file: 形式
dsh plugin --profile web add "file:$(pwd)"
```

然后**重启 `dsh web`**。bundle patch 插入 `id: details-tabs` 行。

> ⚠️ 若 `cordis.patch.yml` 或 profile 里已有 `details` 相关插件配置，注意本插件占 `details` 槽（priority -1）。同一 profile 只应有一个 details 容器。

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

- `key` 唯一；`label` 显示在 tab 栏和 DockRail 磁贴。
- 组件可接收注入的 `sessionId` / `useSessions` / `useWorkspaces` / `t`（会话标准 props）。
- **不需要 priority**——容器按注册顺序 + 用户拖拽排序渲染。

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

这样面板**单独安装也能用**（standalone details），装了容器就自动变成 tab。

## 与现有面板配合

| 面板 | key | label |
|---|---|---|
| dsh-long-term-memory（记忆） | `long-term-memory` | 长期记忆 |
| dsh-artifacts-panel（产物） | `artifacts` | 产物 |

两个面板都做了自适应挂载：容器在 → tab；容器不在 → 各自独立占 details（自动避让 priority）。

## 已知限制

- **会话上下文**：子面板若要 `useSessions`/`useWorkspaces`，容器已用 `SessionProvider` 包裹（无需面板额外处理）；但面板自身仍要能容忍 hooks 为 undefined 的降级（standalone 或异常时）。
- **DockRail 轮询**：tab 列表用 2s `setInterval` 刷新（量小无碍；未来可换 slot 订阅）。
- **排序持久化**：localStorage 按浏览器 origin 存，不跨设备同步。
- **并列布局（v2）**：横向/纵向 split-merge（Blender 编辑器布局）未实现——当前是单列多 tab。计划中。

## 文件

- `lib/client.js` — 浏览器 bundle：`TabsContainer`（tab 栏 + 内容）、`DockRail`（竖向磁贴）、`applyOrder`/`readOrder`/`writeOrder`（排序持久化）。
- `lib/index.js` — 宿主空 apply（仅使 bundle 行存在）。
- `cordis.patch.yml` — bundle patch（插入 `id: details-tabs`）。
- `package.json` — bundle manifest（`dsh.bundle.patch` + `dsh.client`）。

## 许可

MIT
