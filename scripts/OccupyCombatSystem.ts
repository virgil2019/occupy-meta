/**
 * OccupyCombatSystem - Server-side combat simulation for Occupy Master.
 *
 * Component Attachment: Same GameManager entity as HexGameManager in space.hstf
 * Component Networking: Networked (server-owned)
 * Component Ownership: Server
 */

import {
  Component,
  EventService,
  ExecuteOn,
  NetworkingService,
  OnEntityStartEvent,
  OnWorldUpdateEvent,
  component,
  property,
  subscribe,
} from 'meta/worlds';
import type {Maybe, OnWorldUpdateEventPayload} from 'meta/worlds';

import {
  BASE_BARRACKS_INTERVAL_MS,
  BLACKLIST_DURATION_MS,
  BuildingType,
  LEVEL_MULT,
  Owner,
  STUCK_THRESHOLD_MS,
  TICK_MS,
  TOTAL_TILES,
  TileType,
  UNIT_STATS,
  getNeighbors,
  getTileType,
  hexDistance,
  indexToColRow,
  tileIndex,
} from './HexGridConfig';

import {HexGameManager} from './HexGameManager';
import {
  GameState,
  GameStateComponent,
  OnGameStateChanged,
  GameStateChangedPayload,
} from './GameStateComponent';
import {OccupyShowResultEvent} from './OccupyResultScreen';

interface CombatEntity {
  id: number;
  kind: string;
  side: string;
  col: number;
  row: number;
  hp: number;
  hpMax: number;
  atk: number;
  range: number;
  moveSpeed: number;
  attackSpeed: number;
  moveCdMs: number;
  atkCdMs: number;
  stuckMs: number;
  blacklistedTargetId: number;
  blacklistMs: number;
  produceCdMs: number;
  spawnedUnitType: string;
  // Smooth movement interpolation
  visualCol: number;
  visualRow: number;
  interpT: number;
  interpFromCol: number;
  interpFromRow: number;
}

const AI_THINK_MS = 2000;

function kindToIndex(kind: string): number {
  switch (kind) {
    case 'spearman': return 0;
    case 'archer': return 1;
    case 'tower': return 2;
    case 'mine': return 3;
    case 'barracks': return 4;
    case 'base': return 5;
    case 'ruin': return 6;
    default: return 0;
  }
}

/** Map authoritative tileBuildings char to the combat-entity kind, or '' for empty. */
function buildingCharToKind(c: string): string {
  switch (c) {
    case '1': return 'barracks';
    case '2': return 'tower';
    case '3': return 'mine';
    case '4': return 'base';
    case '5': return 'ruin';
    default: return '';
  }
}

@component()
export class OccupyCombatSystem extends Component {
  @property({maxLength: 4000})
  entityData: string = '[]';

  private entities: Map<number, CombatEntity> = new Map();
  private nextEntityId: number = 1;
  private tickAccumulatorMs: number = 0;
  private running: boolean = false;
  private needsInit: boolean = false;
  private gm: Maybe<HexGameManager> = null;
  private unitOnTile: Map<number, number> = new Map();
  /** tileIndex → entityId for static buildings, so reconcile won't double-spawn. */
  private buildingOnTile: Map<number, number> = new Map();
  private aiThinkCdMs: number = AI_THINK_MS;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (!NetworkingService.get().isServerContext()) return;
    this.gm = this.entity.getComponent(HexGameManager);
    console.log('[OccupyCombatSystem] Initialized on server');
  }

  @subscribe(OnGameStateChanged, {execution: ExecuteOn.Everywhere})
  onGameStateChanged(payload: GameStateChangedPayload): void {
    if (!NetworkingService.get().isServerContext()) return;
    if (payload.lastState === GameState.MainMenu && payload.newState === GameState.Playing) {
      // Defer initCombat until HexGameManager has populated tileBuildings
      this.needsInit = true;
      this.running = true;
      console.log('[OccupyCombatSystem] Game started - waiting for tileBuildings to be populated');
    } else if (payload.newState === GameState.MainMenu) {
      this.running = false;
      this.needsInit = false;
      this.entities.clear();
      this.unitOnTile.clear();
      this.buildingOnTile.clear();
      this.entityData = '[]';
    }
  }

  private initCombat(): void {
    this.entities.clear();
    this.unitOnTile.clear();
    this.buildingOnTile.clear();
    this.nextEntityId = 1;
    this.tickAccumulatorMs = 0;
    this.aiThinkCdMs = AI_THINK_MS;
    this.reconcileBuildings();
    this.syncEntityData();
  }

  /**
   * Reconcile the entity set against the authoritative tileBuildings string.
   * Handles three transitions:
   *   - empty -> building: spawn the matching entity
   *   - building destroyed: tickDeathCleanup converts the char to '5' (ruin)
   *     and removes the buildingOnTile entry; the next reconcile spawns a ruin
   *     entity in its place
   *   - ruin overwritten by a new build (buildForSide accepts '5'): kind no
   *     longer matches, so we destroy the ruin entity and spawn the new one
   * This is what makes mid-game builds (player RPC AND AI) actually come alive.
   */
  private reconcileBuildings(): void {
    if (!this.gm) return;
    for (let i = 0; i < TOTAL_TILES; i++) {
      const expectedKind = buildingCharToKind(this.gm.tileBuildings[i]);
      const existingId = this.buildingOnTile.get(i);
      const existingEnt = existingId !== undefined ? this.entities.get(existingId) : undefined;
      const existingKind = existingEnt ? existingEnt.kind : '';

      if (existingKind === expectedKind) {
        // Same kind, but for ruins the side can drift after a unit captures the
        // tile — update existingEnt.side so the client renders the right tint.
        if (existingEnt && expectedKind === 'ruin') {
          const liveSide = this.gm.tileOwnership[i] === Owner.Player ? Owner.Player : Owner.AI;
          if (existingEnt.side !== liveSide) existingEnt.side = liveSide;
        }
        continue;
      }

      // Mismatch: drop the old entity (if any), then spawn the new one (if any).
      if (existingId !== undefined && existingEnt) {
        this.entities.delete(existingId);
        this.buildingOnTile.delete(i);
      }
      if (expectedKind === '') continue;

      const colRow = indexToColRow(i);
      const side = this.gm.tileOwnership[i] === Owner.Player ? Owner.Player : Owner.AI;
      const id = this.spawnEntity(expectedKind, side, colRow.col, colRow.row);
      this.buildingOnTile.set(i, id);
    }
  }

  private spawnEntity(kind: string, side: string, col: number, row: number): number {
    const stats = UNIT_STATS[kind];
    // Player units/buildings scale with their card level; AI is fixed at Lv1.
    let hp = stats.hp;
    let atk = stats.atk;
    if (side === Owner.Player && this.gm) {
      const mult = LEVEL_MULT[this.gm.getPlayerCardLevel(kind) - 1] ?? 1.0;
      hp = Math.round(hp * mult);
      atk = Math.round(atk * mult);
    }
    const ent: CombatEntity = {
      id: this.nextEntityId++, kind: kind, side: side, col: col, row: row,
      hp: hp, hpMax: hp, atk: atk, range: stats.range,
      moveSpeed: stats.moveSpeed, attackSpeed: stats.attackSpeed,
      moveCdMs: 0, atkCdMs: 0, stuckMs: 0,
      blacklistedTargetId: 0, blacklistMs: 0,
      produceCdMs: BASE_BARRACKS_INTERVAL_MS,
      spawnedUnitType: Math.random() < 0.5 ? 'spearman' : 'archer',
      visualCol: col, visualRow: row, interpT: 1.0, interpFromCol: col, interpFromRow: row,
    };
    this.entities.set(ent.id, ent);
    if (stats.moveSpeed > 0) this.unitOnTile.set(tileIndex(col, row), ent.id);
    return ent.id;
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Owner})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (!NetworkingService.get().isServerContext()) return;
    if (!this.running || !this.gm) return;

    // Deferred init: wait until HexGameManager has populated tileBuildings (108 chars)
    if (this.needsInit) {
      if (this.gm.tileBuildings.length >= TOTAL_TILES) {
        console.log('[OccupyCombatSystem] tileBuildings ready - initializing combat');
        this.initCombat();
        this.needsInit = false;
      } else {
        return; // Wait for next frame
      }
    }

    this.tickAccumulatorMs += payload.deltaTime * 1000;
    while (this.tickAccumulatorMs >= TICK_MS) {
      this.tickAccumulatorMs -= TICK_MS;
      this.processTick();
      if (!this.running) break;
    }
    this.tickInterpolation(payload.deltaTime);
    this.syncEntityData();
  }

  private tickInterpolation(dt: number): void {
    // Update visual positions for smooth unit movement
    for (const ent of this.entities.values()) {
      if (ent.interpT >= 1.0) continue;
      // Move visual position toward target
      ent.interpT = Math.min(1.0, ent.interpT + dt * 4.0); // 0.25s to complete
      if (ent.interpT >= 1.0) {
        ent.visualCol = ent.col;
        ent.visualRow = ent.row;
      } else {
        // Linear interpolation
        ent.visualCol = ent.interpFromCol + (ent.col - ent.interpFromCol) * ent.interpT;
        ent.visualRow = ent.interpFromRow + (ent.row - ent.interpFromRow) * ent.interpT;
      }
    }
  }

  private processTick(): void {
    // Bring newly-built tiles (player or AI) into the entity set first.
    this.reconcileBuildings();
    this.tickAi();
    this.tickBarracksSpawn();
    const ids: number[] = [];
    for (const k of this.entities.keys()) ids.push(k);
    ids.sort((a, b) => a - b);
    for (let i = 0; i < ids.length; i++) {
      const ent = this.entities.get(ids[i]);
      if (!ent || ent.hp <= 0) continue;
      this.tickEntityBehavior(ent);
    }
    this.tickDeathCleanup();
    this.tickWinCheck();
  }

  private tickBarracksSpawn(): void {
    const barracks: CombatEntity[] = [];
    for (const ent of this.entities.values()) {
      if (ent.kind === 'barracks' && ent.hp > 0) barracks.push(ent);
    }
    for (let b = 0; b < barracks.length; b++) {
      const ent = barracks[b];
      ent.produceCdMs -= TICK_MS;
      if (ent.produceCdMs > 0) continue;
      const neighbors = getNeighbors(ent.col, ent.row);
      let spawned = false;
      for (let n = 0; n < neighbors.length; n++) {
        const nb = neighbors[n];
        const idx = tileIndex(nb.col, nb.row);
        if (!this.gm) break;
        if (this.gm.tileOwnership[idx] !== ent.side) continue;
        if (this.unitOnTile.has(idx)) continue;
        // Empty or ruin tiles are valid spawn sites; only an active building
        // (or base) blocks placement. Mirrors tryMove's no-block-on-buildings rule.
        const bc = this.gm.tileBuildings[idx];
        if (bc !== '0' && bc !== '5') continue;
        this.spawnEntity(ent.spawnedUnitType, ent.side, nb.col, nb.row);
        spawned = true;
        break;
      }
      ent.produceCdMs = spawned ? BASE_BARRACKS_INTERVAL_MS / LEVEL_MULT[0] : 500;
    }
  }

  /**
   * AI opponent. Ported (simplified) from the web prototype's sim/ai.ts decision
   * tree. Runs every AI_THINK_MS of sim time. The original had a "build on a
   * question tile" priority, but this map has no '?' tiles, so it's dropped.
   * Builds go through the shared HexGameManager.buildForSide path.
   */
  private tickAi(): void {
    if (!this.gm) return;
    this.aiThinkCdMs -= TICK_MS;
    if (this.aiThinkCdMs > 0) return;
    this.aiThinkCdMs = AI_THINK_MS;

    const aiBase = this.findBase(Owner.AI);
    const playerBase = this.findBase(Owner.Player);
    if (!aiBase || !playerBase) return;

    const coin = this.gm.aiCoins;

    // Priority 1 — Defense: player units pressing the AI base and no tower covering it.
    if (coin >= 50 && this.playerUnitsNear(aiBase, 3) > 0 && !this.aiTowerNear(aiBase, 4)) {
      const t = this.pickBuildableTile(TileType.Tower, aiBase);
      if (t && this.gm.buildForSide(Owner.AI, t.col, t.row)) return;
    }

    // Priority 2 — Economy: keep a couple of mines running so the AI isn't
    // starved on base income alone. Build mines near the AI base.
    if (coin >= 50 && this.aiBuildingCount(BuildingType.Mine) < 3) {
      const m = this.pickBuildableTile(TileType.Mine, aiBase);
      if (m && this.gm.buildForSide(Owner.AI, m.col, m.row)) return;
    }

    // Priority 3 — Push: build toward the player base, prefer barracks, else anything.
    if (coin >= 50) {
      let t = this.pickBuildableTile(TileType.Barracks, playerBase);
      if (!t) t = this.pickBuildableTile(null, playerBase);
      if (t && this.gm.buildForSide(Owner.AI, t.col, t.row)) return;
    }
  }

  private findBase(side: string): CombatEntity | null {
    for (const ent of this.entities.values()) {
      if (ent.kind === 'base' && ent.side === side && ent.hp > 0) return ent;
    }
    return null;
  }

  private playerUnitsNear(base: CombatEntity, d: number): number {
    let n = 0;
    for (const ent of this.entities.values()) {
      if (ent.side === Owner.Player && ent.moveSpeed > 0 && ent.hp > 0 &&
          hexDistance(ent.col, ent.row, base.col, base.row) <= d) n++;
    }
    return n;
  }

  private aiBuildingCount(buildingType: BuildingType): number {
    if (!this.gm) return 0;
    const ch = buildingType.toString();
    let n = 0;
    for (let i = 0; i < TOTAL_TILES; i++) {
      if (this.gm.tileOwnership[i] === Owner.AI && this.gm.tileBuildings[i] === ch) n++;
    }
    return n;
  }

  private aiTowerNear(base: CombatEntity, d: number): boolean {
    for (const ent of this.entities.values()) {
      if (ent.side === Owner.AI && ent.kind === 'tower' && ent.hp > 0 &&
          hexDistance(ent.col, ent.row, base.col, base.row) <= d) return true;
    }
    return false;
  }

  /** Nearest empty, explored AI tile (optionally of a given type) to `target`. */
  private pickBuildableTile(type: TileType | null, target: CombatEntity): {col: number; row: number} | null {
    if (!this.gm) return null;
    let best: {col: number; row: number} | null = null;
    let bestDist = Infinity;
    for (let i = 0; i < TOTAL_TILES; i++) {
      if (this.gm.tileOwnership[i] !== Owner.AI) continue;
      // '0' = empty, '5' = ruin (rubble we can build over); both are buildable.
      const bc = this.gm.tileBuildings[i];
      if (bc !== '0' && bc !== '5') continue;
      if (this.gm.aiExplored[i] !== '1') continue;
      const tileChar = this.gm.tileTypes[i] || getTileType(indexToColRow(i).col, indexToColRow(i).row);
      if (tileChar === 'E') continue; // Resolved empty mystery tile
      if (type !== null && tileChar !== type) continue;
      const {col, row} = indexToColRow(i);
      const dist = hexDistance(col, row, target.col, target.row);
      if (dist < bestDist) { bestDist = dist; best = {col, row}; }
    }
    return best;
  }

  private tickEntityBehavior(ent: CombatEntity): void {
    if (ent.atk <= 0 && ent.moveSpeed <= 0) return;
    if (ent.atkCdMs > 0) ent.atkCdMs = Math.max(0, ent.atkCdMs - TICK_MS);
    if (ent.moveCdMs > 0) ent.moveCdMs = Math.max(0, ent.moveCdMs - TICK_MS);
    if (ent.blacklistMs > 0) {
      ent.blacklistMs -= TICK_MS;
      if (ent.blacklistMs <= 0) { ent.blacklistedTargetId = 0; ent.blacklistMs = 0; }
    }
    const target = this.findTarget(ent);
    if (!target) return;
    const dist = hexDistance(ent.col, ent.row, target.col, target.row);
    if (ent.atk > 0 && dist <= ent.range && ent.atkCdMs <= 0) {
      target.hp -= ent.atk;
      ent.atkCdMs = Math.round(1000 / ent.attackSpeed);
      ent.stuckMs = 0;
      return;
    }
    if (ent.moveSpeed > 0 && ent.moveCdMs <= 0 && dist > ent.range) {
      const moved = this.tryMove(ent, target);
      if (moved) { ent.moveCdMs = Math.round(1000 / ent.moveSpeed); ent.stuckMs = 0; }
      else {
        ent.stuckMs += TICK_MS;
        if (ent.stuckMs >= STUCK_THRESHOLD_MS) {
          ent.blacklistedTargetId = target.id;
          ent.blacklistMs = BLACKLIST_DURATION_MS;
          ent.stuckMs = 0;
        }
      }
    }
  }

  private findTarget(ent: CombatEntity): CombatEntity | null {
    let best: CombatEntity | null = null;
    let bestDist = 999999;
    for (const other of this.entities.values()) {
      if (other.side === ent.side || other.hp <= 0) continue;
      if (other.kind === 'ruin') continue; // ruins are not valid targets
      if (other.id === ent.blacklistedTargetId) continue;
      const d = hexDistance(ent.col, ent.row, other.col, other.row);
      if (d < bestDist || (d === bestDist && best !== null && other.id < best.id)) {
        bestDist = d; best = other;
      }
    }
    return best;
  }

  private tryMove(ent: CombatEntity, target: CombatEntity): boolean {
    if (!this.gm) return false;
    const neighbors = getNeighbors(ent.col, ent.row);
    let bestCol = -1; let bestRow = -1; let bestDist = 999999;
    for (let n = 0; n < neighbors.length; n++) {
      const nb = neighbors[n];
      const idx = tileIndex(nb.col, nb.row);
      const occupantId = this.unitOnTile.get(idx);
      if (occupantId !== undefined) {
        const occupant = this.entities.get(occupantId);
        if (occupant && occupant.side === ent.side && occupant.hp > 0) continue;
      }
      if (this.gm.tileBuildings[idx] === BuildingType.Base.toString()) {
        if (this.gm.tileOwnership[idx] !== ent.side) continue;
      }
      const d = hexDistance(nb.col, nb.row, target.col, target.row);
      if (d < bestDist) { bestDist = d; bestCol = nb.col; bestRow = nb.row; }
    }
    if (bestCol < 0) return false;
    this.unitOnTile.delete(tileIndex(ent.col, ent.row));
    // Start smooth interpolation from current visual position
    ent.interpFromCol = ent.visualCol;
    ent.interpFromRow = ent.visualRow;
    ent.interpT = 0.0;
    ent.col = bestCol; ent.row = bestRow;
    const newIdx = tileIndex(ent.col, ent.row);
    this.unitOnTile.set(newIdx, ent.id);
    if (this.gm.tileOwnership[newIdx] !== ent.side) {
      const ownerArr = this.gm.tileOwnership.split('');
      ownerArr[newIdx] = ent.side;
      this.gm.tileOwnership = ownerArr.join('');
    }
    return true;
  }

  private tickDeathCleanup(): void {
    const dead: number[] = [];
    for (const ent of this.entities.values()) {
      // Ruins are inert (no one targets them, no hp drain); guard against any
      // future code path that might decrement their hp anyway.
      if (ent.kind === 'ruin') continue;
      if (ent.hp <= 0) dead.push(ent.id);
    }
    let buildingDied = false;
    for (let i = 0; i < dead.length; i++) {
      const ent = this.entities.get(dead[i]);
      if (!ent) continue;
      if (ent.moveSpeed > 0) {
        const idx = tileIndex(ent.col, ent.row);
        if (this.unitOnTile.get(idx) === ent.id) this.unitOnTile.delete(idx);
      }
      if (ent.moveSpeed === 0 && this.gm) {
        const idx = tileIndex(ent.col, ent.row);
        const arr = this.gm.tileBuildings.split('');
        // Destroyed buildings leave a ruin behind. reconcileBuildings will
        // spawn the ruin entity on the next tick.
        arr[idx] = BuildingType.Ruin.toString();
        this.gm.tileBuildings = arr.join('');
        this.buildingOnTile.delete(idx);
        buildingDied = true;
      }
      this.entities.delete(dead[i]);
    }
    if (dead.length > 0) this.syncBaseHP();
    // Recalculate fog of war when any building is destroyed (re-fog mechanic)
    if (buildingDied && this.gm) {
      this.gm.recalculateAllExploration();
    }
  }

  private syncBaseHP(): void {
    if (!this.gm) return;
    let pHP = 0; let aHP = 0;
    for (const ent of this.entities.values()) {
      if (ent.kind === 'base') {
        if (ent.side === Owner.Player) pHP = ent.hp; else aHP = ent.hp;
      }
    }
    this.gm.playerBaseHP = pHP;
    this.gm.aiBaseHP = aHP;
  }

  private tickWinCheck(): void {
    if (!this.gm) return;
    let pAlive = false; let aAlive = false;
    for (const ent of this.entities.values()) {
      if (ent.kind === 'base' && ent.hp > 0) {
        if (ent.side === Owner.Player) pAlive = true; else aAlive = true;
      }
    }
    if (!pAlive || !aAlive) {
      this.endMatch(pAlive && !aAlive, !pAlive && !aAlive);
      return;
    }
    if (this.gm.timer <= 0) {
      let pT = 0; let aT = 0;
      for (let i = 0; i < TOTAL_TILES; i++) {
        if (this.gm.tileOwnership[i] === Owner.Player) pT++;
        else if (this.gm.tileOwnership[i] === Owner.AI) aT++;
      }
      this.endMatch(pT > aT, pT === aT);
    }
  }

  private endMatch(won: boolean, isDraw: boolean): void {
    this.running = false;
    if (!this.gm) return;
    this.gm.gameActive = false;
    let pS = 0; let aS = 0;
    for (let i = 0; i < TOTAL_TILES; i++) {
      if (this.gm.tileOwnership[i] === Owner.Player) pS++;
      else if (this.gm.tileOwnership[i] === Owner.AI) aS++;
    }
    EventService.sendGlobally(OccupyShowResultEvent, {
      won: won, isDraw: isDraw, playerScore: pS, aiScore: aS,
    });
    const gs = GameStateComponent.instance;
    if (gs) gs.setState(GameState.GameOver);
  }

  private syncEntityData(): void {
    const arr: number[][] = [];
    for (const ent of this.entities.values()) {
      if (ent.hp <= 0) continue;
      // Use visualCol/visualRow for smooth interpolated positions
      arr.push([ent.id, kindToIndex(ent.kind), ent.side === Owner.Player ? 0 : 1,
        ent.visualCol, ent.visualRow, ent.hp, ent.hpMax]);
    }
    this.entityData = JSON.stringify(arr);
  }
}
