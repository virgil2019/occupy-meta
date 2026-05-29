# 卡牌系统 + 对局后结算

> 4 张卡 / 等级倍率 / 升级消耗 / 箱子 / 结算奖励。

---

## 4 张卡（"升级条目"）

每张卡 = 一组数值 + 升级等级。**不是 deck-building**，所有 tile 翻开按当前等级套用数值。

| 卡 ID | 名字 | 类型 | 升级影响 |
|---|---|---|---|
| `spearman` | 矛兵 | 兵种 | 矛兵 HP / ATK + 兵营产矛兵周期 |
| `archer` | 弓手 | 兵种 | 弓手 HP / ATK + 兵营产弓手周期 |
| `tower` | 防御塔 | 建筑 | 防御塔 HP / ATK |
| `mine` | 金矿 | 建筑 | 金矿每次产币量 |

**没有"兵营卡"**。兵营 HP / 默认产兵周期是固定常量，不随卡升级。

---

## 等级倍率

```
Lv 1: 1.00x  (起始)
Lv 2: 1.10x
Lv 3: 1.25x
Lv 4: 1.45x  (满级)
```

### 升级消耗

```
Lv1 -> Lv2:  8 碎片 + 100 金币
Lv2 -> Lv3: 25 碎片 + 300 金币
Lv3 -> Lv4: 60 碎片 + 800 金币
```

### 倍率怎么套

```ts
// 矛兵
hp     = BASE_SPEARMAN_HP  * mult(spearmanLv)
atk    = BASE_SPEARMAN_ATK * mult(spearmanLv)
produceIntervalForBarracks = BASE_BARRACKS_INTERVAL / mult(被产兵种的 Lv)

// 弓手 同上
// 防御塔
hp  = BASE_TOWER_HP  * mult(towerLv)
atk = BASE_TOWER_ATK * mult(towerLv)

// 金矿
produceAmount = BASE_MINE_AMOUNT * mult(mineLv)
```

---

## 单位 / 建筑基础数值（Lv1）

| 名字 | 类型 | HP | ATK | 射程 | 移速 (格/s) | 攻速 (次/s) |
|---|---|---|---|---|---|---|
| 矛兵 | 单位 | 50 | 8 | 1 | 1.5 | 1.0 |
| 弓手 | 单位 | 30 | 6 | 3 | 1.2 | 1.0 |
| 防御塔 | 建筑 | 80 | 12 | 4 | 0 (静止) | 0.7 |
| 金矿 | 建筑 | 40 | 0 | 0 | 0 | 每 2s 产 10 × Lv 倍率 币 |
| 兵营 | 建筑 | 100 | 0 | 0 | 0 | 每 5s 产 1 兵（兵种建造时锁定） |
| Base | 建筑 | 500 | 10 | 2 | 0 | 1.0；另每 3s 产 6 币 |

注：base 自带攻击防止零防御被秒，base 不随任何卡升级。

---

## 产出参数（interval-based）

| 建筑 | 周期 | 每次产出 | 备注 |
|---|---|---|---|
| Base | 每 3000ms | 6 币 | 不随卡升级 |
| 金矿 | 每 2000ms | 10 × `LEVEL_MULT[mineLv]` 币 | Lv 1=10 / Lv 2=11 / Lv 3=12.5 / Lv 4=14.5 |
| 兵营 | 每 5000ms | 1 个 `spawnedUnitType` 兵 | 实际周期 ÷ `LEVEL_MULT[兵种卡 Lv]`；邻居满时 500ms 重试。完整逻辑见 [combat.md](./combat.md) |

**实现**: 产出方 entity 有 `produceCdMs / produceIntervalMs / produceAmount` 字段。每 tick `produceCdMs -= 100`，到 0 时触发产出，重置回 interval。

对局起始金币: **100**（见 [architecture.md](./architecture.md) 常量 `STARTING_COIN`）。

---

## 对局后结算

### 箱子机制

```
对局结束:
  if 箱子槽位 < 4:
    新箱子 status='waiting', remainingMs = 600000 (10 min)
    加入 chestSlots
  else:
    显示提示 "槽位已满"

后台 (每秒):
  所有 waiting 箱子 remainingMs -= 1000
  到 0 -> 自动开:
    立刻把奖励加进 MetaState
    箱子从槽位移除
    槽位空出来
```

### 箱子内容（单一品质）

```
基础掉落:
  - 10 个卡牌碎片, 分给 1-2 张卡 (按随机, 70% 给一张 10 个 / 30% 平分两张 5+5)
  - 30 金币

胜场加成 (player_win):
  - 额外 +20 金币
  - 额外 +2 碎片 (随机一张卡)
```

### 升级时机

升级在对局外卡牌界面操作，即时生效，下局对局应用新数值。
