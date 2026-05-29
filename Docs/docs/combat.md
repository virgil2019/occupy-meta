# 战斗 / 兵营产兵 / 移动 / 胜负判定

> Tick-based 战斗循环，6 邻居贪心移动，3 分钟超时按占地判。

---

## Tick 节奏

```
TICK_MS = 100         // 10 Hz
MATCH_MS = 180_000    // 3 分钟
```

---

## 单 tick 处理顺序（决定论）

```
1. 经济阶段:
   每个 base / mine / barracks 的 produceCdMs -= 100
   到 0 -> 产币或产兵, cd 重置

2. 问号格刷新检查 (每 15s 一次, 见 tiles.md)

3. AI 决策 (每 2s 一次, 见 ai.md)

4. Entity 行为阶段:
   遍历所有 entity (按 id 升序, 决定论):
     a. moveCdMs / atkCdMs -= 100, 最低 0
     b. 找最近敌方目标 (hex distance, 同距取 id 小者)
        (排除 blacklistedTargetId)
     c. 如果目标在射程内 且 atkCdMs == 0:
          扣对方 HP, atkCdMs = 1000 / attackSpeed
     d. 否则 不在射程内 且 moveCdMs == 0 且 自己能动:
          朝目标走 1 格, moveCdMs = 1000 / moveSpeed

5. 死亡清理: HP <= 0 的 entity 移除
   tile.entityId = null
   tile.owner 不变
   // 注: 探明状态是动态派生的, 死亡后不需要单独清理 —— 下一 tick 重算 isExplored()
   //     时, 如果该格 6 邻居再无其他自方实体, 自动退化回未探明

6. 占领判定: 单位移动后, 如果走到 owner != self 的 tile:
   tile.owner = self.side
   (其他字段不变)

7. 胜负判定:
   任一 base HP <= 0 -> 立刻结束
   elapsedMs >= MATCH_MS -> 比较 ownedTiles
```

---

## 攻击细节

- **瞬时伤害**，无投射物。
- **单体目标**，无 AOE。
- 攻击不需要视线，只看 `hexDistance ≤ range`。
- 一个 entity 一个 tick 内 **只走 OR 只打**，互斥（攻击优先）。
- 死亡在 step 5 统一处理，**同一 tick 内可能互相打死**。

---

## 目标选择

```ts
function pickTarget(self: Entity, entities: Entity[]): Entity | null {
  return entities
    .filter(e => e.side !== self.side && e.hp > 0 && e.id !== self.blacklistedTargetId)
    .sort((a, b) => {
      const da = hexDistance(self, a);
      const db = hexDistance(self, b);
      if (da !== db) return da - db;
      return a.id.localeCompare(b.id);
    })[0] ?? null;
}
```

每 tick 重新选目标。

---

## 兵营产兵

兵营在建造时锁定一个兵种（矛兵 / 弓手），之后只产那一种。

```
每兵营字段:
  spawnedUnitType: 'spearman' | 'archer'   // 建造时锁定
  produceCdMs: number

基础产兵周期:
  BASE_BARRACKS_INTERVAL = 5000ms
  实际周期 = BASE_BARRACKS_INTERVAL / mult(spawnedUnitType 的卡等级)

每 tick:
  produceCdMs -= 100
  if produceCdMs <= 0:
    if 兵营所在 tile 的某个 6 邻居有空 (entityId==null) 且 owner==self:
      在该邻居 spawn 一个 spawnedUnitType 兵
      produceCdMs = 实际周期
    else:
      跳过, produceCdMs = 500 (短 cd 重试)
```

**注意**：兵营本身不动也不打，HP 100 被敌方近战很容易拆。玩家要用防御塔或推进保护。

---

## 移动规则

### 6 邻居贪心

```
self.target = 选出的目标 entity (上方目标选择)
所有 6 邻居里 (odd-r offset):
  过滤掉:
    - 棋盘外
    - 有友方 entity 在 (entityId != null AND owner == self.side)
    - 是敌方 base 所在 tile (不能直接踩 base, 只能打)
  按 hexDistance(nbr, target) 升序排序
  同距 tie-break: (col, row) 字典序
取第一个作为下一步
如果没可走的: 这 tick 不动, stuckMs += 100
```

### 占领

单位移动到 `tile.owner != self.side` 的 tile：

```
tile.owner = self.side
ownedTiles 计数更新
其他字段 (type / entityId / nativeHalf) 不变
```

新占领的 tile 上**没有建筑**（你单位刚走过去）。如果该 tile 的 6 邻居有自方实体（如刚走过来的这个单位本身），则 `isExplored=true`，可以下次点击重建（见 [tiles.md](./tiles.md)）。

### 友方挡路

- 友方 entity 占的 tile 是**物理障碍**（不能踩）。
- 友方 owner 的空 tile（entityId=null）**是通路**。

### 死亡后

```
entity.hp <= 0:
  tile.entityId = null
  tile.owner 不变
  // 探明状态动态派生, 不在此处理
```

死亡 entity 的归属者**保留对这格的占领**，敌方要单位走过来才能改 owner。

### 卡死处理

```
Entity 增加运行时字段:
  stuckMs: number               // 连续未成功移动的累计 ms
  blacklistedTargetId?: string  // 暂时排除的目标 id
  blacklistMs: number           // 排除剩余 ms

每 tick 移动阶段:
  if 6 邻居能选到合法格 -> 走, stuckMs = 0
  else -> stuckMs += 100

  if stuckMs >= 3000:
    blacklistedTargetId = 当前 target.id
    blacklistMs = 2000
    stuckMs = 0

  blacklistMs = max(0, blacklistMs - 100)
  if blacklistMs == 0: blacklistedTargetId = null
```

被堵 3 秒就换 2 秒目标。**故意不做 A* / BFS**，demo 这种密度 + 棋盘大小，6 邻居贪心 + blacklist 够用。

---

## 胜负判定

```ts
function checkResult(state: MatchState): MatchStatus {
  if (state.player.baseHp <= 0) return 'ai_win';
  if (state.ai.baseHp <= 0) return 'player_win';
  if (state.elapsedMs >= MATCH_MS) {
    const p = state.player.ownedTiles;
    const a = state.ai.ownedTiles;
    if (p > a) return 'player_win';
    if (a > p) return 'ai_win';
    return 'draw';
  }
  return 'active';
}
```

同 tick 双方 base 都 HP=0：按 ownedTiles 判。
