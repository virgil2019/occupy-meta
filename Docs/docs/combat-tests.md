# Combat System Test Documentation

> Generated from `src/sim/combat.test.ts` — 20 test cases covering tickCombat, cullDead, and revertIsolatedRevealedTiles.

---

## attackIntervalMs

| # | Test | Description |
|---|------|-------------|
| 1 | `returns 1000ms for attackSpeed=1` | Verifies 1 attack/sec → 1000ms interval |
| 2 | `returns 500ms for attackSpeed=2` | Verifies 2 attacks/sec → 500ms interval |
| 3 | `returns 2000ms for attackSpeed=0.5` | Verifies 0.5 attacks/sec → 2000ms interval |

---

## pickTarget

| # | Test | Description |
|---|------|-------------|
| 1 | `returns nearest enemy by hex distance` | Tower at (4,5) picks near enemy at (5,4) over far at (7,4) |
| 2 | `ignores dead entities (hp<=0)` | Dead enemy filtered out, picks living target |
| 3 | `returns null when no enemies alive` | Empty candidate list returns null |

---

## tickCombat

| # | Test | Description |
|---|------|-------------|
| 1 | `unit attacks target in range and deals damage` | Tower (atk=12, range=4) attacks enemy at distance 3, deals 12 damage |
| 2 | `entity with attackSpeed=0 is skipped` | Barracks (attackSpeed=0) does not attack |
| 3 | `entity does not attack if cd is not ready` | Tower with atkCdMs=500 doesn't attack within 100ms tick |
| 4 | `entity does not attack if target out of range` | Tower (range=2) ignores enemy at distance 3 |
| 5 | `cooldowns are reduced by dtMs` | Tower with atkCdMs=300 reduced to 150 after 150ms tick |

---

## cullDead

| # | Test | Description |
|---|------|-------------|
| 1 | `removes entity with hp<=0 from entities map` | Dead entity not present after cullDead |
| 2 | `clears tile.entityId when entity removed` | tile.entityId set to null after entity removal |
| 3 | `preserves tile.everBuilt when entity removed` | tile.everBuilt remains true after entity removal |
| 4 | `living entities are not removed` | Alive entity remains in entities map |
| 5 | `removes multiple dead entities` | Both e1 and e2 removed, alive stays |

---

## cullDead + revertIsolatedRevealedTiles

| # | Test | Description |
|---|------|-------------|
| 1 | `revealed tile reverts to everBuilt=false when building destroyed with no other adjacent owned buildings` | AI-half tile (row 7) conquered by player, tower destroyed, no adjacent player buildings → everBuilt reverts to false |
| 2 | `revealed tile keeps everBuilt=true when other adjacent owned building exists` | Same scenario but tower2 at (4,7) survives, keeps (5,7) revealed |
| 3 | `native tiles (nativeHalf matches owner) are not reverted` | Player native tile (row 3) stays revealed after building destroyed |
| 4 | `revealed tile with entityId still set is not reverted` | Living entity prevents revert check |

---

## Reveal Logic Rules

A tile's `everBuilt` reverts to `false` when ALL conditions are met:
1. `everBuilt === true`
2. `nativeHalf !== owner` (revealed enemy tile, not native)
3. `entityId === null` (no building on tile)

AND there is **no adjacent living owned building** (checked via 6-neighbor hex neighbors).

Adjacency check:
```ts
function hasAdjacentOwnedBuilding(tile: Tile, state: MatchState): boolean {
  for (const [nc, nr] of neighbors(tile.col, tile.row)) {
    const adj = state.board[nr]?.[nc];
    if (!adj) continue;
    if (adj.owner !== tile.owner) continue;
    if (adj.entityId !== null && (state.entities.get(adj.entityId)?.hp ?? 0) > 0) {
      return true;
    }
  }
  return false;
}
```

---

## Bug Fixes Caught by Tests

### Row/Col Indexing Bug
**Symptom:** `tile.entityId` not cleared when entity removed

**Root cause:** `state.board[entity.col]?.[entity.row]` reversed row/col

**Fix:** `state.board[entity.row]?.[entity.col]`

---

## Running Tests

```bash
npm test -- src/sim/combat.test.ts
```

All 20 tests must pass for PR to merge.