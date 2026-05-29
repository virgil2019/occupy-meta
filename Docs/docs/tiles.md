# Tile 系统

> Tile 类型 / 视野规则 / 翻开-建造流程 / 固定地图 / 问号刷新。
> 棋盘坐标系 / 邻居函数 / Tile 数据结构见 [board.md](./board.md)。

---

## 4 种 tile 类型

| Tile | 翻开成本 | 翻开效果 |
|---|---|---|
| **兵营** | 50 | 建一座兵营，**建造瞬间** 50/50 随机选 1 个兵种（矛兵 / 弓手），之后兵营持续产那一种 |
| **防御** | 50 | 建一座防御塔 |
| **金矿** | 50 | 建一座金矿 |
| **问号** | 25 | 不是开局有，中途刷新（见下文）。翻开按权重 roll 一种实际 type（兵营 50% / 防御 25% / 金矿 25%）然后按那种 type 建造 |

---

## 固定地图布局

demo **不做 map gen**，使用一张 hardcoded 地图。每格类型如下：

字符编码：
- `B` = 兵营 tile (cost 50)
- `T` = 防御塔 tile (cost 50)
- `M` = 金矿 tile (cost 50)
- `#` = base（开局 entity 已存在）
- `~` = base 6 邻居（开局无 entity，由 base 自动 `isExplored=true`，见下方"视野规则"）

> 注：`~` tile 也要有一个固定的可建 type（实现在 `static-map.ts` 里给 默认 type，如 `barracks`），玩家可以从开局就在这 6 格上建造。

```
                col:  0 1 2 3 4 5 6 7 8
Row 11 (AI 最上):     B M T ~ ~ B T M B
Row 10 (AI base 行):  B M T ~ # ~ B M B
Row 9:                T B M ~ ~ B M B T
Row 8:                B B T M B B M T B
Row 7:                M B T B B B T M B
Row 6 (AI 最下):      B T B M B M B T B
─────────────  水平中线  ─────────────
Row 5 (玩家最上):     B T B M B M B T B
Row 4:                M B T B B B T M B
Row 3:                B B T M B B M T B
Row 2:                T B M B ~ ~ B M T
Row 1 (玩家 base 行): B M T ~ # ~ B M B
Row 0 (玩家最下):     B M B T ~ ~ B T M
```

**统计**:
- 双方各 47 个可建 tile + 6 个 `~` + 1 个 `#` = 54 格
- 类型数量双方相等：每方 B × 24, T × 11, M × 12
- 总：9 × 12 = 108 格 ✓

注意：`~` 位置不完全镜像（hex odd-r offset 在玩家 base 处于 odd row、AI base 处于 even row 时，邻居 col offset 不同）。**类型数量对称**保证战略公平即可。

实现：在 `/sim/static-map.ts` 里直接写常量数组返回 `Tile[][]`。

**开局金矿保证**：双方 base（玩家 (4,1)、AI (4,10)）的 6 邻居中**至少各有 1 个金矿（M tile）**，确保玩家从开局就有经济 ramp 可用。

---

## 视野规则（动态探明）

每个 tile 对某一方是否"已探明"是**派生**状态，每 tick 根据当前活着的实体重算 —— 不是 tile 上的永久 flag。

```ts
function isExplored(tile: Tile, side: Side, state: MatchState): boolean {
  // 该 tile 的 6 邻居里有任一被己方 *建筑* 占着 → 已探明
  // 单位（kind === 'unit'）不算 —— 兵走过不算探明
  for (const [nc, nr] of neighbors(tile.col, tile.row)) {
    const adj = state.board[nr]?.[nc]; // 注意 [row][col] canonical
    if (!adj?.entityId) continue;
    const ent = state.entities.get(adj.entityId);
    if (!ent || ent.side !== side) continue;
    if (ent.kind === 'unit') continue; // 兵不算
    return true;
  }
  return false;
}
```

side X 能看到 `tile.type` 的条件（**严格**）：

```
side X 能看到 tile.type  ⟺  isExplored(tile, X, state)
```

注意：自方半盘**不**自动可见 —— 玩家也要靠自方实体扩散探明。开局只有 base 周围 6 格因 base 自动 explored；其他自方半盘 tile 必须等自方实体扩散过去才可见。

**关键性质**:
- 可见性由"自方 **建筑** 是否在 6 邻居"决定。**单位不探明** —— 兵走过的格子不会变 explored。无论敌方/自方半盘统一这条规则。
- 自方建筑（base / 兵营 / 防御塔 / 矿）建造或被摧毁 → 该建筑 6 邻居 tile 可见性立即变化。建筑死亡 + 6 邻居再无其他自方建筑 → tile 退化回不可见，`tile.type` 也会再次隐藏。
- Base 永远活着（HP=0 即游戏结束），所以 base 周围 6 格在 active 状态下**永远** explored。
- 设计意图：让玩家用建筑（持久投入）建立视野，而不是用流动的部队来探地图——避免兵走过留下"探明痕迹"的闪烁。

UI 表现:
- `isExplored=true`：显示 type 图标 + 价格（区分 owner 用背景颜色）
- `isExplored=false`：显示灰色 `?`，看不到 type
- 问号 tile（`isExplored=true` 时）：显示黄色 `?` 图标 + 25 价格
- tile.owner 颜色**始终可见**（玩家能看到双方领土边界，只是看不到对方探明范围之外的 tile type）

完整 UI 视觉规则见 [ui.md](./ui.md)。

---

## 建造前置条件（全部满足）

```ts
function canBuild(tile: Tile, side: Side, coin: number, state: MatchState): boolean {
  return (
    tile.owner === side &&                  // 自己领地
    tile.entityId === null &&               // 上面没东西
    isExplored(tile, side, state) &&        // 探明 (见上方视野规则)
    coin >= tile.cost                       // 钱够
  );
}
```

**注意**: 之前版本独立的"扩张规则"（`hasOwnedAdjacentExplored`）现在被 `isExplored` 吸收 —— 探明性本身就要求 6 邻居有自方实体，所以不再需要单独扩张检查。也不再有 `tile.nativeHalf === side` 的可见性短路 —— 自己半盘也要靠扩散。

---

## 翻开 / 建造流程

```
扣 coin (cost)
按 tile.type 创建 entity:
  if barracks:
    spawnedUnitType = rng() < 0.5 ? 'spearman' : 'archer'
    创建 Barracks entity, 锁定 spawnedUnitType
  if tower:    创建 Tower entity
  if mine:     创建 Mine entity
  if question:
    实际 type = roll by weight (兵营 50 / 防御 25 / 金矿 25)
    按上面规则建造对应建筑
    tile.type = 实际 type   (问号永久消失, 还原成真实 type)
tile.entityId = newEntity.id
```

兵营产兵规则见 [combat.md](./combat.md)。

---

## 实体数量

**不设全局 unit cap，也不设每兵营在场上限**。理论上每个兵营每 5s 出 1 兵，但实战中会被打死、被推回，棋盘容量自然限制总数。如 demo 实测性能 / 视觉问题再加 cap。

---

## 翻格时机与反馈

- 玩家 tap tile → sim 同帧判定 → 立刻扣币 + 立刻创建 entity（无动画延迟，下一 tick 开始行动）。
- **成功反馈**: tile 闪一下己方颜色 (150ms) + entity icon 渐入 (200ms) + HUD 金币数字滚动。
- **失败反馈**（按优先级判定一条）:

| 原因 | 反馈 |
|---|---|
| 金币不足 | tile 红色边框闪烁 1 次 + HUD 金币数字红色晃动 |
| 不可见 type（`isExplored=false`） | 不显示价格 / 不响应 tap |
| `isExplored=true` 但 `owner !== self`（探明了但不是自己领地） | tile 灰色边框闪烁 1 次 |
| 上有 entity / 已经在建 | 无反应（轻微 tap 音） |

**翻格无 cd**，只受金币限制。

---

## 问号格刷新

```
全局 questionRefreshCdMs, 起始 = 15000ms, 每 tick -= 100

到 0 时:
  对双方半盘各检查一次:
    if 当前半盘有未翻开问号 tile (type=='question' AND entityId==null):
      跳过该半盘
    else:
      候选 = tiles where (nativeHalf == 该半盘 AND entityId==null AND type != 'question')
      在候选里随机选 1 个 tile:
        tile.originalType = tile.type
        tile.type = 'question'
        tile.cost = 25
  questionRefreshCdMs = 15000

玩家翻开问号 tile:
  执行 question 分支的 spawn 逻辑
  (注意 spawn 完成后 tile.type 被设为实际 type, 问号失效)

如果问号 tile 被占领但未翻开 (owner 变了):
  tile.type = tile.originalType   (回退)
  tile.cost = 50
  tile.originalType = undefined
  问号失效, 下次刷新可重新刷
```

**效果**: 每半盘任意时刻最多 1 个未翻开问号。玩家可选择翻 (25 币博彩) 或忽略。
