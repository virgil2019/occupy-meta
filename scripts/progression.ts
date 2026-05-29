/**
 * Meta progression (session-only): card upgrades + chest slots.
 *
 * Pure TypeScript, no Horizon SDK dependency. Owned by OccupyLobbyScreen on the
 * client. State lives in memory and resets on world reload — a persistence seam
 * (Horizon Persistent Variables) can be added later without touching this logic.
 *
 * Ported from the web prototype's src/meta/progression.ts, simplified to a
 * single shard model: shards are per-card (cards[id].shards), gold is global.
 */

export type CardId = 'spearman' | 'archer' | 'tower' | 'mine';
export const CARD_IDS: CardId[] = ['spearman', 'archer', 'tower', 'mine'];

export const MAX_LEVEL = 4;
export const MAX_CHEST_SLOTS = 4;
export const CHEST_DURATION_MS = 600_000; // 10 minutes
export const MATCH_WIN_GOLD = 100;
export const CHEST_REWARD_SHARDS = 10;

/** Cost to upgrade from level L to L+1. Index = L - 1 (Lv1→2 at [0]). */
export const UPGRADE_COST: ReadonlyArray<{shards: number; gold: number}> = [
  {shards: 8, gold: 100},  // Lv1 → Lv2
  {shards: 25, gold: 300}, // Lv2 → Lv3
  {shards: 60, gold: 800}, // Lv3 → Lv4
];

export interface ChestSlot {
  remainingMs: number;
  /**
   * locked    — newly awarded; countdown does NOT tick until tapped.
   * unlocking — countdown ticking to 0.
   * ready     — finished; tap to claim reward + free the slot.
   */
  status: 'locked' | 'unlocking' | 'ready';
}

export interface CardProgress {
  level: number; // 1..4
  shards: number;
}

export interface Reward {
  cardId: CardId;
  shards: number;
}

export interface MetaState {
  cards: Record<CardId, CardProgress>;
  gold: number;
  chestSlots: ChestSlot[];
  matchesPlayed: number;
  matchesWon: number;
}

export function defaultMeta(): MetaState {
  // Prototype-generous starting resources so the upgrade UI is exercisable on
  // first launch (a session won't accumulate much from 10-minute chests).
  return {
    cards: {
      spearman: {level: 1, shards: 200},
      archer: {level: 1, shards: 200},
      tower: {level: 1, shards: 200},
      mine: {level: 1, shards: 200},
    },
    gold: 5000,
    chestSlots: [],
    matchesPlayed: 0,
    matchesWon: 0,
  };
}

/** Record a match outcome. Wins award gold (chests only drop shards). */
export function recordMatchResult(meta: MetaState, won: boolean): void {
  meta.matchesPlayed += 1;
  if (won) {
    meta.matchesWon += 1;
    meta.gold += MATCH_WIN_GOLD;
  }
}

/** Award a chest slot (capped). Starts 'locked' — countdown waits for a tap. */
export function awardChest(meta: MetaState): boolean {
  if (meta.chestSlots.length >= MAX_CHEST_SLOTS) return false;
  meta.chestSlots.push({remainingMs: CHEST_DURATION_MS, status: 'locked'});
  return true;
}

/** Tap a 'locked' slot to start its countdown. */
export function startUnlockingChest(meta: MetaState, slotIdx: number): boolean {
  const slot = meta.chestSlots[slotIdx];
  if (!slot || slot.status !== 'locked') return false;
  slot.status = 'unlocking';
  return true;
}

/** Advance only 'unlocking' timers; flip to 'ready' at 0 (no auto-claim). */
export function tickChestSlots(meta: MetaState, dtMs: number): void {
  for (const slot of meta.chestSlots) {
    if (slot.status !== 'unlocking') continue;
    slot.remainingMs -= dtMs;
    if (slot.remainingMs <= 0) {
      slot.remainingMs = 0;
      slot.status = 'ready';
    }
  }
}

export function rollChestReward(rng: () => number): Reward {
  const idx = Math.floor(rng() * CARD_IDS.length) % CARD_IDS.length;
  return {cardId: CARD_IDS[idx], shards: CHEST_REWARD_SHARDS};
}

/** Tap a 'ready' slot to claim: add shards to a card, remove the slot. */
export function claimChest(meta: MetaState, slotIdx: number, rng: () => number): Reward | null {
  const slot = meta.chestSlots[slotIdx];
  if (!slot || slot.status !== 'ready') return null;
  const reward = rollChestReward(rng);
  meta.cards[reward.cardId].shards += reward.shards;
  meta.chestSlots.splice(slotIdx, 1);
  return reward;
}

export function canUpgrade(meta: MetaState, cardId: CardId): boolean {
  const card = meta.cards[cardId];
  if (card.level >= MAX_LEVEL) return false;
  const cost = UPGRADE_COST[card.level - 1];
  return card.shards >= cost.shards && meta.gold >= cost.gold;
}

/** Spend shards + gold to raise a card one level. */
export function upgradeCard(meta: MetaState, cardId: CardId): boolean {
  if (!canUpgrade(meta, cardId)) return false;
  const card = meta.cards[cardId];
  const cost = UPGRADE_COST[card.level - 1];
  card.shards -= cost.shards;
  meta.gold -= cost.gold;
  card.level += 1;
  return true;
}
