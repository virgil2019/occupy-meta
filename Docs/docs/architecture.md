# 架构与数据模型

> 完整 TypeScript 类型定义 / 代码模块组织 / Horizon Worlds 平台注意事项。
> 所有 sim 模块基于这里定义的类型。

---

## 数据模型（TypeScript 完整定义）

```ts
// ============ 静态数据 ============

type Side = 'player' | 'ai';
type CardId = 'spearman' | 'archer' | 'tower' | 'mine';
type TileType = 'barracks' | 'tower' | 'mine' | 'question';
type UnitType = 'spearman' | 'archer';
type EntityKind = 'unit' | 'barracks' | 'tower' | 'mine' | 'base';

interface CardDef {
  id: CardId;
  name: string;
  baseHp: number;
  baseAtk: number;
  range: number;
  moveSpeed: number;     // tiles/sec, 0 = static
  attackSpeed: number;   // attacks/sec, 0 = no attack
  produceAmount: number; // 仅金矿用
  produceIntervalMs: number;  // 仅金矿用; 兵营有自己的 BASE_BARRACKS_INTERVAL
}

const LEVEL_MULT: Record<number, number> = {
  1: 1.00, 2: 1.10, 3: 1.25, 4: 1.45,
};

const UPGRADE_COST: Record<number, { shards: number; gold: number }> = {
  2: { shards:  8, gold: 100 },
  3: { shards: 25, gold: 300 },
  4: { shards: 60, gold: 800 },
};

const STARTING_COIN = 100;             // 对局开局每方金币

const BASE_BARRACKS_HP = 100;
const BASE_BARRACKS_INTERVAL_MS = 5000;
const BASE_HP = 500;
const BASE_ATK = 10;
const BASE_RANGE = 2;
const BASE_PRODUCE_INTERVAL_MS = 3000;
const BASE_PRODUCE_AMOUNT = 6;

// ============ Meta 状态 (对局外, 持久化) ============

interface CardProgress {
  level: number;     // 1-4
  shards: number;
}

interface ChestSlot {
  remainingMs: number;   // 倒计时
}

interface MetaState {
  cards: Record<CardId, CardProgress>;
  gold: number;
  chestSlots: ChestSlot[];     // 最多 4 个
  matchesPlayed: number;
  matchesWon: number;
}

// ============ Match 状态 (对局内) ============

interface Tile {
  col: number;
  row: number;
  type: TileType;
  originalType?: TileType;   // 问号覆盖时备份
  cost: number;
  nativeHalf: Side;
  owner: Side;
  entityId: string | null;
  // everBuilt field removed — exploration is now derived from current entities;
  // see docs/tiles.md § 视野规则（动态探明）.
}

interface Entity {
  id: string;
  kind: EntityKind;
  defCardId?: CardId;     // unit / tower / mine 用; barracks / base 不需要
  side: Side;
  col: number;
  row: number;
  hp: number;
  hpMax: number;
  atk: number;
  range: number;
  moveSpeed: number;       // tiles/sec
  attackSpeed: number;     // attacks/sec
  moveCdMs: number;
  atkCdMs: number;
  // 仅 unit 用
  stuckMs: number;
  blacklistedTargetId?: string;
  blacklistMs: number;
  // 仅 barracks 用
  spawnedUnitType?: UnitType;
  produceCdMs?: number;
  // 仅 mine / base 用
  produceAmount?: number;
  produceIntervalMs?: number;
}

interface PlayerSnapshot {
  side: Side;
  coin: number;
  baseEntityId: string;
  baseHp: number;
  ownedTiles: number;
}

interface MatchState {
  tickMs: number;                 // 100
  elapsedMs: number;
  board: Tile[][];                // board[col][row]
  entities: Map<string, Entity>;
  player: PlayerSnapshot;
  ai: PlayerSnapshot;
  rng: SeededRng;
  status: 'active' | 'player_win' | 'ai_win' | 'draw';
  questionRefreshCdMs: number;
  aiThinkCdMs: number;
}

// ============ 输入事件 ============

type PlayerInput =
  | { kind: 'build'; col: number; row: number }
  | { kind: 'noop' };
```

---

## 模块结构

```
/src
  /data
    cards.ts               # CardDef 表 (4 张)
    constants.ts           # TICK_MS / MATCH_MS / 经济参数 / 棋盘尺寸 / 兵营常量
    upgrade.ts             # LEVEL_MULT / UPGRADE_COST
  /sim                     # 纯逻辑, 无 Horizon 依赖
    hex.ts                 # offset/cube 转换 / neighbors / hexDistance
    rng.ts                 # SeededRng (mulberry32)
    static-map.ts          # hardcoded 棋盘布局 (见 tiles.md) + base 初始化
    match.ts               # createMatch / advanceTick / applyInput
    economy.ts             # base / mine produce, 翻格扣费
    spawn.ts               # 翻开 tile -> 创建 entity (含问号 roll + 兵营随机兵种)
    barracks.ts            # 兵营产兵逻辑
    combat.ts              # 找目标 / 攻击 / 死亡判定
    movement.ts            # 6 邻居贪心 / 占领 / 卡死处理
    question.ts            # 问号 tile 刷新
    ai.ts                  # AI 决策
    result.ts              # checkResult
  /meta                    # 对局外
    progression.ts         # 卡牌升级 / 结算箱子奖励 / 槽位管理
    save.ts                # Horizon 持久化封装
  /ui                      # Horizon 侧 (CustomUI panel)
    hex-render.tsx         # hex tile 渲染 + tap 处理
    entity-layer.tsx       # 单位 / 建筑 sprite
    hud.tsx                # 金币 / 时间 / 双方占地 / 卡组栏
    base-bar.tsx           # 棋盘上下的 base 状态条
    result-screen.tsx      # 胜负界面 + 箱子动画
    deck-screen.tsx        # 对局外卡牌养成
  main.ts                  # 入口, setInterval(advanceTick, 100)
```

### 关键不变量

- **`/sim` 不导入 `/ui` 或任何 Horizon API**。
- **`/sim` 是纯函数式**: `advanceTick(state, inputs) -> newState`。同 input 同 state 必出同 output（用 seeded rng）。
- **`/ui` 只读 state，把 input 推给 sim**。

后续加 PvP 只在 `/sim` 外面加 `/net` 层。

---

## Horizon Worlds 注意事项

- 移动端 CustomUI 用 React-like API。hex tile 用 UI 元素绝对定位（每 cell `(x, y) = (col * W + (row & 1) * W/2, row * H)`，`W` 是 hex 宽度，`H` ≈ W × 0.866）。
- 9 × 12 = 108 个 cell + 双方 ~20 个 unit/building，总元素约 130-150。每帧别全量 setProps，diff 出变化的再更新。
- 持久化 MetaState 用 `world.persistentVariableGroup`（JSON 序列化）。
- 主循环用 `async.setInterval(tick, 100)` 或 Horizon 的 update event，具体 API 查 SDK 文档。
- 移动端触控：tile tap target ≥ 36dp 见方，间距足够避免误触。
- Sim 跑在客户端本地（无服务端，无网络），AI 在本地决策。
