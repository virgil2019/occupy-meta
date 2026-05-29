# 单元测试用例计划（非 UI 业务逻辑）

> 范围：4 个高优先级文件的测试用例。每个用例只测一件事，给出 **Setup / Act / Expect** 三段。
> 框架：vitest（项目已装，`npm test` 跑全部）。
> 不在范围：UI 层（Phaser Scenes / hex rendering / tap visuals）。

---

## 1. `src/data/upgrade.test.ts` — 9 cases

升级数值的纯函数。

### `mult(level)` — 等级倍率查表

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 1 | Lv 1-4 返回查表值 | — | `mult(1)`, `mult(2)`, `mult(3)`, `mult(4)` | `1.0`, `1.1`, `1.25`, `1.45` |
| 2 | 越界等级 fallback 到 1.0 | — | `mult(0)`, `mult(5)`, `mult(-1)` | 全部 `1.0` |

### `upgradeCost(targetLevel)` — 升级目标等级所需

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 3 | Lv 2/3/4 返回正确表 | — | `upgradeCost(2)`, `(3)`, `(4)` | `{8,100}`, `{25,300}`, `{60,800}` |
| 4 | 越界等级 fallback 到 0/0 | — | `upgradeCost(1)`, `(5)`, `(0)` | `{shards:0, gold:0}` |

### `canUpgrade(currentLevel, shards, gold)` — 能否升级判定

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 5 | 资源刚好够 → true | — | `canUpgrade(1, 8, 100)` | `true` |
| 6 | 资源远超 → true | — | `canUpgrade(1, 999, 999)` | `true` |
| 7 | 碎片不够 → false | — | `canUpgrade(1, 7, 100)` | `false` |
| 8 | 金币不够 → false | — | `canUpgrade(1, 100, 99)` | `false` |
| 9 | 已满级 (Lv 4) → false（不查表） | — | `canUpgrade(4, 999, 999)` | `false` |

---

## 2. `src/meta/progression.test.ts` — 14 cases

对局外 meta 状态的关键变更。

### `defaultMeta()` / `createInitialMetaState()`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 1 | demo 默认值结构正确 | — | `defaultMeta()` | `chestSlots=[]`, `cardLevels` 4 张都=1, `cards` 4 张都 `{level:1, shards:200}`, `gold=5000`, `matchesPlayed=0`, `matchesWon=0`, `wins=0` |
| 2 | `createInitialMetaState()` 是 `defaultMeta()` 的别名 | — | 两个函数都调一次 | 返回结构相同（深 equal） |

### `recordMatchResult(meta, wonOrResult)`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 3 | 胜场 (won=true) → wins/matchesWon/matchesPlayed 各 +1 + 新箱子 | `defaultMeta()` | `recordMatchResult(m, true)` | `m.wins=1, matchesWon=1, matchesPlayed=1, chestSlots.length=1` |
| 4 | 败场 (won=false) → 只 matchesPlayed +1，不开箱不+win | `defaultMeta()` | `recordMatchResult(m, false)` | `m.wins=0, matchesWon=0, matchesPlayed=1, chestSlots.length=1`（注：当前实现仍发箱子；如果改为"败场不发箱"要更新此用例） |
| 5 | 平局接受 `'draw'` 字符串 | `defaultMeta()` | `recordMatchResult(m, 'draw')` | `wins=0, matchesPlayed=1` |
| 6 | `'player_win'` 字符串等价于 `won=true` | `defaultMeta()` | `recordMatchResult(m, 'player_win')` | `wins=1, matchesWon=1` |

### `awardChest(meta, won)`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 7 | 槽位空 → 加 1 个 waiting 箱子 | `defaultMeta()` | `awardChest(m, true)` | 返回 `{slotIdx:0, slotsFull:false}`；`m.chestSlots[0].remainingMs===600_000` |
| 8 | 槽位满 4 → 拒绝 | `meta.chestSlots.length=4` | `awardChest(m, true)` | 返回 `{slotsFull:true}`；`chestSlots.length` 仍 4 |

### `tickChestSlots(meta, dtMs, rng, rollReward)`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 9 | 倒计时减少但未到 0 → 不开 | `chestSlots=[{remainingMs:1000, status:'waiting'}]` | `tick(m, 100, ()=>0, rollFn)` | `chestSlots[0].remainingMs=900`，奖励未发 |
| 10 | 倒计时到 0 → 自动开 + 奖励加进 meta + 槽位移除 | `chestSlots=[{remainingMs:100, ...}]`，`rollReward` 返回 `{shards:5, gold:30}` | `tick(m, 100, ...)` | `chestSlots.length=0`, `m.shards+=5`, `m.gold+=30` |
| 11 | 多个槽位中某个到 0 不破坏其他 | 2 槽位，第一个 remainingMs=100 第二个 remainingMs=500 | `tick(m, 100, ...)` | `chestSlots.length=1`，剩下的是原来的第二个 |

### `rollChestReward(rng, won)`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 12 | won=false → 基础掉落 | `rng=()=>0.5` | `rollChestReward(rng, false)` | `{shards:10, gold:30, fromWins:false}` |
| 13 | won=true → 胜场加成 | `rng=()=>0.5` | `rollChestReward(rng, true)` | `{shards:12, gold:50, fromWins:true}` |

### `upgradeCard(meta, cardId)`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 14 | 满级拒绝；资源不足拒绝；成功扣资源 + level+1 | a) `cardLevels.spearman=4`<br>b) `shards=0`<br>c) `cardLevels.spearman=1, shards=10, gold=200` | `upgradeCard` 三次 | a) `{ok:false, reason:'already max level'}`<br>b) `{ok:false, reason:'insufficient resources'}`<br>c) `{ok:true}`, `cardLevels.spearman=2`, `shards=2`, `gold=100` |

---

## 3. `src/controller/DeckController.test.ts` — 8 cases

### 构造 + 快照

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 1 | 不传 initial → 用 `createInitialMetaState()` | — | `new DeckController()` | `getSnapshot()` 等于 `createInitialMetaState()` |
| 2 | 传 initial meta → 用它 | 自定义 meta `{gold:777, ...}` | `new DeckController(custom)` | `getSnapshot().gold===777` |

### `tryUpgrade(cardId)`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 3 | 满级 (Lv 4) → false 不变 | `cards.spearman.level=4` | `tryUpgrade('spearman')` | 返回 `false`；meta 不变 |
| 4 | 资源不足 → false 不变 | `cards.spearman={level:1, shards:0}, gold:0` | `tryUpgrade('spearman')` | 返回 `false`；meta 不变 |
| 5 | 资源足够 → true + 扣钱 + level+1 | default meta（shards=200, gold=5000） | `tryUpgrade('spearman')` | 返回 `true`；`cards.spearman={level:2, shards:192}`, `gold=4900` |

### subscribe / notify

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 6 | tryUpgrade 成功 → listener 被调一次 | 注册 mock listener | `tryUpgrade('spearman')` 成功 | listener 调用次数 === 1 |
| 7 | tryUpgrade 失败 → listener 不调用 | listener mock，初始 `level=4` 必失败 | `tryUpgrade('spearman')` | listener 调用次数 === 0 |
| 8 | unsubscribe 后 listener 不再被调 | subscribe 拿到 unsub，调用 unsub 后再 tryUpgrade | — | listener 调用次数 === 0 |

附加: setMeta 也应触发 notify（如果 9 个用例可以加一条但当前 8 个已够覆盖关键路径）。

---

## 4. `src/controller/MatchController.test.ts` — 10 cases

### 构造 + 初始状态

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 1 | new 时 `getStatus()==='active'`、`getRemainingMs()===180_000` | `new MatchController(null)` | — | 上述断言 |
| 2 | `getFinalMeta()` 初始为 null | `new MatchController(meta)` | `getFinalMeta()` | `null` |

### `tick(dtMs)` — 推进时间 / 产币 / 胜负

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 3 | active 时 elapsedMs 增加，剩余时间减少 | new MC | `tick(100)` | `getRemainingMs()===179_900`，`coin` 增加 1（实现里 `floor(dtMs/100)`） |
| 4 | status 非 active → 不推进 | 把 state.status 改成 `player_win` | `tick(1000)` | elapsedMs 不变 |
| 5 | ai.baseHp 归零 → status 变 `player_win` + 写 finalMeta 一次 | `meta` 非空；tick 前手动 `state.ai.baseHp=0` | `tick(100)` | `getStatus()==='player_win'`，`getFinalMeta()` 非 null（含 wins=1 等） |
| 6 | player.baseHp 归零 → status 变 `ai_win` | 手动设 player.baseHp=0 | `tick(100)` | `getStatus()==='ai_win'`，finalMeta 非 null（wins=0） |
| 7 | 时间到 → status 变 `draw`；finalMeta 按 hp 比较记 won | 把 elapsedMs 设到 179_999；player.baseHp=300, ai.baseHp=200 | `tick(100)` | `getStatus()==='draw'`，finalMeta 的 wins=1（因 player hp 更高） |
| 8 | endMatch 不会被二次覆盖 finalMeta | 让胜负判定连续触发两次 tick 都满足 win 条件 | tick 两次 | finalMeta 只在第一次被写，第二次不变 |

### `onTileTap(col, row)`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 9 | active + coin 够 → 返回 `{ok:true}`，applyInput 被调（state 引用可能更新） | new MC，state.player.coin=100 | `onTileTap(4, 0)` | 返回 `{ok:true}`；notify 触发 |
| 10 | 状态非 active OR coin<50 → 返回 `{ok:false}`，listener 不调 | a) state.status=`player_win` b) coin=10 | `onTileTap(4, 0)` 两种 setup 各一次 | 返回 `{ok:false}`；listener 未被调 |

---

## 5. `src/sim/rng.test.ts` — 4 cases

种子化随机数 + 加权选择。

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 1 | 同 seed → 同序列（决定论） | `a=new SeededRng(42); b=new SeededRng(42)` | 各 call `next()` 5 次 | 5 个值一一相等 |
| 2 | `nextInt(min, max)` 返回闭区间内整数 | `rng=new SeededRng(7)` | call `nextInt(1, 10)` 1000 次 | 全部 ∈ [1, 10] 且为整数；min/max 都出现过 |
| 3 | `nextInt(min, max)` 当 min > max → throw | `rng=new SeededRng(1)` | `nextInt(10, 5)` | 抛错 |
| 4 | `pickWeighted` 尊重权重比例 | items=`['a','b']`, weights=`[1, 3]` | 调 4000 次 | 'b' 计数大约 3000±200，'a' 大约 1000±200（统计断言用容差） |

---

## 6. `src/sim/spawn.test.ts` — 12 cases

建造 / 探明传播 / 问号 roll / 兵营兵种锁定。

**entityId 语义：**
- `null` — 未探明（不可建）
- `0` — 已探明（空地，可建）
- `>0` — 有建筑（建筑 id）
- `<0` — 建筑曾被摧毁（可重建）

### `canBuild(tile, side, coin, board)`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 1 | owner 不匹配 → reject | tile.owner='ai' | `canBuild(tile, 'player', ...)` | `{success:false, reason:'owner_mismatch'}` |
| 2 | entityId > 0（有建筑）→ reject | entityId=123 | `canBuild(...)` | `reason:'entity_already_present'` |
| 3 | entityId = 0（空地）→ reject | entityId=0 | `canBuild(...)` | `reason:'not_visible'` |
| 4 | entityId < 0（已摧毁）→ success（可重建） | entityId=-99, coin=100 | `canBuild(...)` | `{success:true}` |
| 5 | 没有已探明邻居 → reject | tile.owner='player', 6邻居 entityId 全为 null | `canBuild(...)` | `reason:'no_adjacent_owned'` |
| 6 | 有已探明邻居 + coin 够 → success | 6邻居有 entityId=0，coin=100 | `canBuild(...)` | `{success:true}` |
| 7 | 全条件满足 + coin 不够 → reject | coin=10, tile.cost=50 | `canBuild(..., 10, ...)` | `reason:'insufficient_coin'` |

### `tryBuild` + 探明传播

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 8 | 建造后 6邻居 null → 0（探明传播） | (x,y) 建造，6邻居 entityId 全为 null | `tryBuild(state, 'player', x, y)` | 6邻居 entityId 全变为 0 |
| 9 | 建造后 6邻居 0 / >0 / <0 保持不变 | 6邻居：entityId=0、123、-99 各一 | `tryBuild(...)` | 各保持原值不变 |
| 10 | 在 entityId < 0 的格重建 | entityId=-99，6邻居无已探明 | `tryBuild(...)` | entityId 变为新建筑 id（原-99覆盖） |

### `rollQuestionType(rng)` / `rollSpawnedUnitType(rng)`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 11 | 问号 roll 50/25/25 分布 | seed 固定的 SeededRng | 调 2000 次 | barracks ≈ 1000±100, tower ≈ 500±80, mine ≈ 500±80 |
| 12 | 兵营 spawn 兵种 50/50 | seed 固定 | 调 2000 次 | spearman ≈ 1000±100, archer ≈ 1000±100 |

---

## 7. `src/sim/movement.test.ts` — 8 cases

6 邻居贪心 / 占领 / 卡死处理。

**tile.entityId 行走规则：**
- `>0` — 有建筑，禁止通行
- `0` — 空地，可通行
- `<0` — 建筑曾被摧毁（可重建），可通行
- `null` — 未探明，不可通行（不可走到未探明格）

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 1 | 单位移动 1 格朝向最近敌方 | player unit at (4,3) range=1，AI unit at (4,5)，moveCd=0 | `tickMovement(state, 100)` | unit 位置移动到 (4,4) 或最佳 6 邻居（取决于 odd-r offset） |
| 2 | 目标在射程内 → 不移动（让 combat 处理） | unit range=3, target 距离 2 | `tickMovement(...)` | unit 位置不变 |
| 3 | 友方 entityId>0 挡路 → 不能走到那格 | 唯一最优邻居被友方 entity（entityId>0）占 | `tickMovement(...)` | 走第二最优邻居 OR 不动 |
| 4 | 走到 entityId=0 的敌方 tile → 占领（owner 变 + ownedTiles 更新） | unit 在 own tile，邻居 tile.entityId=0, owner='ai' | `tickMovement(...)` | 走过去后 `tile.owner='player'`, `player.ownedTiles+=1`, `ai.ownedTiles-=1`；entityId 保持 0（无建筑） |
| 5 | 走到 entityId<0 的敌方 tile → 占领 | 邻居 entityId=-99，owner='ai' | `tickMovement(...)` | `tile.owner='player'`；entityId 保持 -99 |
| 6 | entityId>0 的格不可通行（建筑挡路） | 唯一最优邻居 entityId=123 | `tickMovement(...)` | 选其他方向，不走建筑格 |
| 7 | entityId=null 的格不可通行（未探明） | 唯一最优邻居 entityId=null | `tickMovement(...)` | 选其他方向，不走未探明格 |
| 8 | stuckMs ≥ 3000 → 设 blacklist 2000ms | unit stuckMs=2900, no valid neighbor | `tickMovement(state, 100)` | `stuckMs=0`, `blacklistedTargetId=target.id`, `blacklistMs=2000` |

---

## 8. `src/sim/combat.test.ts` — 20 cases

目标选择 / 攻击 / 死亡清理 / 探明传播与消失。

### `attackIntervalMs`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 1 | attackSpeed=1 → 1000ms | — | `attackIntervalMs(1)` | `1000` |
| 2 | attackSpeed=2 → 500ms | — | `attackIntervalMs(2)` | `500` |
| 3 | attackSpeed=0.5 → 2000ms | — | `attackIntervalMs(0.5)` | `2000` |

### `pickTarget(self, entities)`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 4 | 选最近敌方（hex distance） | self 在 (4,4)，2 个 enemy 分别在 (5,4) 和 (7,4) | `pickTarget(self, ents)` | 返回 (5,4) 那个（距离近） |
| 5 | 跳过 hp<=0 的敌方 | 一活一死 | `pickTarget(self, ents)` | 返回存活的 |
| 6 | 无存活敌方 → 返回 null | 只有己方实体 | `pickTarget(self, ents)` | `null` |

### `tickCombat(state, dtMs)`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 7 | 在射程内 + cd 到 → 扣对方 HP，重置 atkCdMs | tower atk=12 range=4，enemy at (7,4) 距离 3 | `tickCombat(state, 100)` | `enemy.hp===38`, `self.atkCdMs===1000` |
| 8 | attackSpeed=0 → 跳过不攻击 | barracks attackSpeed=0 | `tickCombat(...)` | 敌人 hp 不变 |
| 9 | cd 未到 → 不攻击 | tower atkCdMs=500 | `tickCombat(state, 100)` | `atkCdMs===400`，敌人 hp 不变 |
| 10 | 目标超出射程 → 不攻击 | tower range=2，enemy 距离 3 | `tickCombat(...)` | 敌人 hp 不变 |
| 11 | cd 按 dtMs 减少 | tower atkCdMs=300 | `tickCombat(state, 150)` | `atkCdMs===150` |

### `cullDead(state)`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 12 | hp<=0 → 从 entities map 移除 | entity hp=0 | `cullDead(state)` | `entities.has(id) === false` |
| 13 | 移除后 tile.entityId 变为负数（建筑曾被摧毁，可重建） | entity 在 tile (5,5)，entityId=123，hp=0 | `cullDead(state)` | `tile.entityId === -123` |
| 14 | 存活 entity 的 tile.entityId 不变 | entity hp=50, entityId=200 | `cullDead(state)` | `tile.entityId === 200` |
| 15 | 存活 entity 不被移除 | entity hp=50 | `cullDead(state)` | entity 仍在 map 中 |
| 16 | 多个死亡实体同时处理 | e1 hp=0, e2 hp=0, alive hp>0 | `cullDead(state)` | 只剩 alive，e1/e2 移除，tile.entityId 变负 |

### `cullDead + revertRevealedTiles`（探明消失）

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 17 | 建筑摧毁后无相邻已探明自方格 → 6邻居 entityId=0 变回 null | tile (x,y) entityId=-123（摧毁），6邻居中 entityId=0 的格有 A、B，且无 entityId>0 或 entityId=0 的自方建筑 | `cullDead(state)` | A、B 的 entityId 变回 null |
| 18 | 建筑摧毁后有相邻自方建筑 → 保持探明 | 同上，但 6邻居中有 entityId>0 的自方建筑（如另一个tower） | `cullDead(state)` | 6邻居 entityId=0 的格保持 0 |
| 19 | 6邻居有 entityId>0（其他建筑）→ 保持探明 | tile (x,y) entityId=-123，6邻居中有 entityId=456 的自方建筑 | `cullDead(state)` | 6邻居 entityId=0 的格保持 0 |
| 20 | entityId < 0 的格被重建后 → entityId 变为正数 | entityId=-99，coin 够，在同一格再建造 | `tryBuild(...)` | entityId 变为新正数 id |

**entityId 状态机：**
```
建造:           entityId = null → 正数（新建筑 id）
建筑摧毁:       entityId = 正数 → 负数（-原id）
重建:           entityId = 负数 → 正数（新 id）
探明传播:       entityId = null → 0（6邻居建造时）
探明消失:       entityId = 0 → null（6邻居无已探明自方格时）
```

---

## 9. `src/sim/barracks.test.ts` — 3 cases

兵营产兵。

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 1 | 邻居有空 + cd 到 → spawn 兵 | 兵营 spawnedUnitType='spearman', cd=0, 邻居都空 | `tickBarracks(state, 100)` | 邻居出现新 entity，side 同兵营，defCardId='spearman'，兵营 cd 重置到 5000 |
| 2 | 邻居全占 → cd 重置到 500 (retry) | cd=0，所有 6 邻居都被 entity 占 | `tickBarracks(...)` | 无新 entity，兵营 cd === 500 |
| 3 | 等级倍率影响产兵周期 | matchState.cardLevels.spearman=4 (倍率 1.45), 兵营 spearman 类型 cd=0 | `tickBarracks(...)` | 兵营 cd ≈ 5000/1.45 ≈ 3448ms |

---

## 10. `src/sim/question.test.ts` — 4 cases

问号格刷新规则。

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 1 | refresh cd 未到 → 不刷新 | questionRefreshCdMs=10000 | `tickQuestion(state, 100)` | 不变 9900；没新增问号 |
| 2 | refresh cd 到 0 + 半盘无问号 → 刷出 1 个 | cd=100, 半盘都是普通 tile | `tickQuestion(state, 100)` | 该半盘有 1 个 tile type='question'，cost=25，originalType 备份 |
| 3 | 半盘已有未翻问号 → 跳过 | 已有 type='question' 在 player 半盘 | `tickQuestion(...)` | 不增加新的问号 tile |
| 4 | 问号 tile 被占领但未翻开 → type 回退 | tile.type='question', originalType='barracks', owner 变化（这条由调用方触发，但 question.ts 的 rollback 路径要单测） | 模拟占领后调 rollback | tile.type='barracks', cost=50, originalType undefined |

---

## 11. `src/sim/result.test.ts` — 5 cases

`checkResult(state): 'active' | 'player_win' | 'ai_win' | 'draw'`

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 1 | 双方都还活着 + 时间未到 → 'active' | baseHp 都=500, elapsedMs=0 | `checkResult(state)` | 'active' |
| 2 | player.baseHp=0 → 'ai_win' | player.baseHp=0 | — | 'ai_win' |
| 3 | ai.baseHp=0 → 'player_win' | ai.baseHp=0 | — | 'player_win' |
| 4 | 超时 + player 占地多 → 'player_win' | elapsedMs=180_000, player.ownedTiles=30, ai=20 | — | 'player_win' |
| 5 | 超时 + 占地相等 → 'draw' | elapsedMs=180_000, 都=27 | — | 'draw' |

---

## 12. `src/sim/match.test.ts` — 4 cases

`createEmptyMatch` / `makeEntity` / `applyInput` 桥接。

| # | 用例 | Setup | Act | Expect |
|---|---|---|---|---|
| 1 | createEmptyMatch 返回合法初始状态 | — | `createEmptyMatch(42)` | status='active', player.baseHp=500, ai.baseHp=500, elapsedMs=0, entities 空 Map, board 是 [], rng 实例化 |
| 2 | createEmptyMatch 同 seed 决定论 | seed=42 | 调两次 | rng 各 next() 一次返回值相等 |
| 3 | makeEntity 自动分配唯一 id | — | `makeEntity({kind, side, col, row})` 调 3 次 | 三个 entity 的 id 各不相同 |
| 4 | applyInput stub 不改 state | state 任意 | `applyInput(state, {kind:'build', col:0, row:0})` | 返回值 === state（无副作用 / 引用相等） |

---

## 总计

| 文件 | 用例数 |
|---|---|
| `src/data/upgrade.test.ts` | 9 |
| `src/meta/progression.test.ts` | 14 |
| `src/controller/DeckController.test.ts` | 8 |
| `src/controller/MatchController.test.ts` | 10 |
| `src/sim/rng.test.ts` | 4 |
| `src/sim/spawn.test.ts` | 8 |
| `src/sim/movement.test.ts` | 8 |
| `src/sim/combat.test.ts` | 6 |
| `src/sim/barracks.test.ts` | 3 |
| `src/sim/question.test.ts` | 4 |
| `src/sim/combat.test.ts` | 20 |
| `src/sim/barracks.test.ts` | 3 |
| `src/sim/question.test.ts` | 4 |
| `src/sim/result.test.ts` | 5 |
| `src/sim/match.test.ts` | 4 |
| **合计** | **101 cases** |

每个 case 大约 5-15 行 vitest 代码，整组约 1200-1600 行测试。

---

## 几个用例要确认的边界

写之前你看一下，**有几个用例的"预期行为"我是按当前代码推断的**，可能跟你的设计意图不一致：

1. **progression 用例 4（败场也发箱子）**: 当前实现 `recordMatchResult` 不管胜负都调 `awardChest`。如果你期望"败场不发箱"，要改实现 + 用例。
2. **MatchController 用例 7（time-up→draw 但根据 hp 决定 won）**: 当前 MatchController 是这逻辑（`playerWonOnHp`）。但 docs/combat.md 说"超时 → 占地多者赢"。**用例按当前代码写**，但跟规范有偏差，等修。
3. **progression 用例 12-13（rollChestReward 数值）**: 当前实现胜场 +20 金 +2 碎片，所以 won → `{shards:12, gold:50}`。数值跟 docs/cards.md 一致。
4. **rng 用例 4 / spawn 用例 7-8（统计断言）**: 用容差判定（±100/±200）会偶有 flaky。可以用固定种子让结果可重复，或用更宽容差。**写代码时要明确选哪种。**
5. **movement 用例 1（朝目标方向）**: 6 邻居贪心的"最佳"邻居取决于 odd-r tie-break，**测试要按代码里的 tie-break 规则**（`(col, row) 字典序`）写期望。
6. **question 用例 4（rollback 路径）**: 当前实现里 rollback 是 question.ts 内部的 if-branch，调用方是 movement.ts（在占领时触发）。**单测要决定是 mock 调用方还是构造该状态后直接调内部函数**。这条可能要换写法。
7. **barracks 用例 3（倍率影响周期）**: 兵营产兵周期 = `5000 / mult(cardLevel)`。**当前 barracks.ts 实现是否真这样套了倍率**要先 grep 验证一下，可能现在还是固定 5000。

OK 你看完批准这版后，我就开始动手按这个表写测试代码。要不要 commit 这份 plan 到 main？还是先 review？
