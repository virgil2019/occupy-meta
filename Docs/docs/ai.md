# AI 行为

> 单机本地 AI，决策树版（不用 minimax / 学习算法），每 2 秒决策一次。

---

## 决策节奏

每 2 秒（每 20 tick）跑一次决策。

---

## 决策树（4 段优先级）

```
aiThinkMs -= 100 每 tick, 到 0 时:
  coin = state.ai.coin

  # 1. 防守优先
  nearBase = entities filter (
    side == 'player' AND
    hexDistance(e, aiBase) <= 3
  )
  hasTowerNear = exists entity (
    side == 'ai' AND defId == 'tower' AND
    hexDistance(e, aiBase) <= 4
  )
  if nearBase.length > 0 AND not hasTowerNear AND coin >= 50:
    # 找一个 AI 视角下 可建造 + 是 tower type 的 tile, 越近 base 越好
    tile = pick nearest buildable tower-type tile to aiBase
    if tile: build(tile, ai), return

  # 2. 问号格优先 (省钱)
  qTile = find buildable question tile in AI 半盘
  if qTile AND coin >= 25: build(qTile, ai), return

  # 3. 推进
  if coin >= 50:
    # 选 离玩家 base 最近 + AI 可建造的 tile, 优先 barracks
    tile = pick buildable tile minimizing hexDistance(tile, playerBase),
           prefer type='barracks'
    if tile: build(tile, ai), return

  # 4. 攒钱, 什么都不做
  return

  aiThinkMs = 2000
```

---

## AI 卡牌等级

AI 卡牌固定 **level 1** 数值，不参与玩家升级（避免随着玩家变强 AI 也变强，难度递减）。

---

## 相关

- 建造前置条件 / tile 视野规则: [tiles.md](./tiles.md)
- hex distance / 目标选择: [board.md](./board.md) + [combat.md](./combat.md)
