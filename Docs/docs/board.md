# 棋盘（六边形 hex grid）

> 9 × 12 棋盘，odd-r offset 坐标，6 邻居 + hex 距离公式。

---

## 尺寸与坐标

- **9 列 × 12 行**（共 108 个 tile）
- **odd-r offset 坐标**：内部存储 `(col, row)`，奇数行视觉上向右偏半格
- 玩家 base: `(4, 1)`
- AI base: `(4, 10)`
- 玩家原始半盘: `row ∈ [0, 5]`（54 格）
- AI 原始半盘: `row ∈ [6, 11]`（54 格）
- 双方 base 周围 6 邻居 + 自己 = 7 格，只在 base 那格放 base 实体；6 邻居因 base 而自动 `isExplored=true`（动态探明，见 [tiles.md](./tiles.md)）

---

## 6 邻居（odd-r offset）

```ts
// 邻居偏移 (col_offset, row_offset)
const NEIGHBOR_OFFSETS_EVEN_ROW = [
  [-1,  0], [+1,  0],   // 同行左右
  [-1, -1], [ 0, -1],   // 上一行 左 / 右
  [-1, +1], [ 0, +1],   // 下一行 左 / 右
];
const NEIGHBOR_OFFSETS_ODD_ROW = [
  [-1,  0], [+1,  0],
  [ 0, -1], [+1, -1],
  [ 0, +1], [+1, +1],
];

function neighbors(col, row) {
  const offsets = (row & 1) ? NEIGHBOR_OFFSETS_ODD_ROW : NEIGHBOR_OFFSETS_EVEN_ROW;
  return offsets
    .map(([dc, dr]) => [col + dc, row + dr])
    .filter(([c, r]) => inBounds(c, r));
}
```

---

## Hex 距离

```ts
function offsetToCube(col, row) {
  const x = col - ((row - (row & 1)) >> 1);
  const z = row;
  const y = -x - z;
  return { x, y, z };
}

function hexDistance(a, b) {
  const ac = offsetToCube(a.col, a.row);
  const bc = offsetToCube(b.col, b.row);
  return (Math.abs(ac.x - bc.x) + Math.abs(ac.y - bc.y) + Math.abs(ac.z - bc.z)) / 2;
}
```

替换所有 manhattan 距离用法（目标选择 / AI 决策 / 路径贪心）。

---

## Tile 数据结构（摘要）

完整定义见 [architecture.md](./architecture.md)，下面是要点：

```ts
type TileType = 'barracks' | 'tower' | 'mine' | 'question';
type Side = 'player' | 'ai';

interface Tile {
  col: number;
  row: number;
  type: TileType;           // 固定 type, 但 question tile 可在中途由 spawn 注入
  originalType?: TileType;  // 若被问号覆盖, 保留原 type 以便回退
  cost: number;             // 50 (普通) / 25 (question)
  nativeHalf: Side;         // 开局时所属半盘, 不变
  owner: Side;              // 当前归属, 占领时变
  entityId: string | null;  // 当前建筑 / 兵营 / 兵
  // 注: 探明状态是动态派生的, 不存 tile 上;
  //     见 tiles.md § 视野规则（动态探明）的 isExplored()
}
```

Tile 类型 / 视野 / 翻开-建造规则见 [tiles.md](./tiles.md)。
