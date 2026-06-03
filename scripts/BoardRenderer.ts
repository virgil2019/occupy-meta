import {
  Color,
  ColorComponent,
  Component,
  EntityService,
  ExecuteOn,
  NetworkMode,
  NetworkingService,
  OnEntityStartEvent,
  OnWorldUpdateEvent,
  Quaternion,
  TemplateAsset,
  TransformComponent,
  Vec3,
  WorldService,
  WorldTextComponent,
  component,
  property,
  subscribe,
} from 'meta/worlds';
import type {Entity, Maybe, OnWorldUpdateEventPayload} from 'meta/worlds';

import {
  TOTAL_TILES,
  hexToWorld,
  indexToColRow,
  Owner,
  tileIndex,
} from './HexGridConfig';
import {HexGameManager} from './HexGameManager';
import {OccupyCombatSystem} from './OccupyCombatSystem';
import {
  GameState,
  OnGameStateChangedLocal,
  GameStateChangedLocalPayload,
} from './GameStateComponent';

const COLOR_PLAYER = new Color(0.2, 0.4, 0.75, 1.0);
const COLOR_AI = new Color(0.75, 0.2, 0.2, 1.0);
const COLOR_NEUTRAL = new Color(0.4, 0.4, 0.4, 1.0);
const COLOR_FOG = new Color(0.15, 0.15, 0.15, 1.0);
// Dimmed red/orange for enemy tiles with buildings visible through fog
const COLOR_FOG_ENEMY_BUILDING = new Color(0.4, 0.15, 0.1, 1.0);

const TILE_SCALE = new Vec3(0.92, 1.0, 0.92);
// Scales per entity kind (applied to the spawned template)
const BASE_SCALE = new Vec3(0.7, 0.7, 0.7);
const BUILDING_SCALE = new Vec3(0.4, 0.4, 0.4);
const UNIT_SCALE = new Vec3(0.5, 0.5, 0.5);

const UNIT_Y = 0.12;
const BUILDING_Y = 0.18;
const BASE_Y = 0.35;

/** Max tiles to spawn per frame to avoid mobile hitches */
const TILES_PER_FRAME = 10;

// Death animation tuning
const DEATH_DURATION_MS = 300;
const DEATH_SINK_DISTANCE = 0.5;

/** A live marker; entity/color/transform are null between spawn request and the .then resolution. */
interface ActiveMarker {
  entity: Entity | null;
  color: ColorComponent | null;
  transform: TransformComponent | null;
  kindIdx: number;
  sideNum: number;
  isBase: boolean;
  isUnit: boolean;
  /** Base rgb (alpha applied dynamically during death). */
  baseR: number;
  baseG: number;
  baseB: number;
  /** Last reconciled grid position + world Y, used as death-animation start. */
  lastCol: number;
  lastRow: number;
  lastY: number;
}

/** A marker currently playing the death animation. */
interface DyingMarker {
  entity: Entity;
  color: ColorComponent | null;
  transform: TransformComponent | null;
  elapsedMs: number;
  startX: number;
  startY: number;
  startZ: number;
  baseR: number;
  baseG: number;
  baseB: number;
}

/**
 * HexBoardRenderer - Client-side renderer that spawns hex tile entities
 * to visualize the game board and combat entities with distinct 3D models.
 *
 * Component Attachment: Player entity in player.hstf
 * Component Networking: Local (client-only rendering)
 * Component Ownership: Not Networked (runs on owning client)
 *
 * Tile background + tile-text label spawn is staggered across frames
 * (10/frame) to amortize the 108-entity startup cost. Combat-entity
 * markers (units/buildings/bases) are spawned dynamically per server
 * entity id as combat creates them, and play a 0.3s sink+fade death
 * animation before being destroyed when the server entity disappears.
 */
@component()
export class HexBoardRenderer extends Component {
  @property()
  tileTemplate: Maybe<TemplateAsset> = null;

  // Per-kind entity templates (set in editor; OccupySoldier, OccupyTower, etc.) -- v2
  @property()
  soldierTemplate: Maybe<TemplateAsset> = null;

  @property()
  towerTemplate: Maybe<TemplateAsset> = null;

  @property()
  mineTemplate: Maybe<TemplateAsset> = null;

  @property()
  barracksTemplate: Maybe<TemplateAsset> = null;

  @property()
  baseTemplate: Maybe<TemplateAsset> = null;

  // Legacy fallback (kept for backward compat if new templates not yet assigned)
  @property()
  markerTemplate: Maybe<TemplateAsset> = null;

  @property()
  labelTemplate: Maybe<TemplateAsset> = null;

  /** Shown on a tile where a building used to be (persists for the rest of the match). */
  @property()
  ruinTemplate: Maybe<TemplateAsset> = null;

  private tileEntities: (Entity | null)[] = [];
  private tileColors: (ColorComponent | null)[] = [];
  private tilesSpawned: boolean = false;
  private gameManager: Maybe<HexGameManager> = null;
  private combatManager: Maybe<OccupyCombatSystem> = null;
  private boardVisible: boolean = false;

  // Staggered spawning state
  private isSpawning: boolean = false;
  private spawnIndex: number = 0;

  // Dynamic combat-entity markers (spawn-on-demand per server entity id)
  private activeMarkers: Map<number, ActiveMarker> = new Map();
  private dyingMarkers: Map<number, DyingMarker> = new Map();

  // Tile text labels (one per tile, 108 total) - for type letters on explored tiles
  private tileTexts: (WorldTextComponent | null)[] = [];
  private tileTextEntities: (Entity | null)[] = [];
  private tilesTextReady: boolean = false;
  private lastTileTextKey: string = '';
  private tileTextSpawnIndex: number = 0;

  // Diagnostic flags (per-match, reset on show)
  private loggedFirstRender: boolean = false;
  private loggedEntityDiag: boolean = false;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (NetworkingService.get().isServerContext()) return;
    console.log('[HexBoardRenderer] Starting');
    this.tileEntities = new Array(TOTAL_TILES).fill(null);
    this.tileColors = new Array(TOTAL_TILES).fill(null);

    // Hardcode template references if not set via editor properties
    if (!this.soldierTemplate) {
      this.soldierTemplate = new TemplateAsset('@Templates/GameplayObjects/OccupySoldier.hstf');
    }
    if (!this.towerTemplate) {
      this.towerTemplate = new TemplateAsset('@Templates/GameplayObjects/OccupyTower.hstf');
    }
    if (!this.mineTemplate) {
      this.mineTemplate = new TemplateAsset('@Templates/GameplayObjects/OccupyMine.hstf');
    }
    if (!this.barracksTemplate) {
      this.barracksTemplate = new TemplateAsset('@Templates/GameplayObjects/OccupyBarracks.hstf');
    }
    if (!this.baseTemplate) {
      this.baseTemplate = new TemplateAsset('@Templates/GameplayObjects/OccupyBase.hstf');
    }
    if (!this.labelTemplate) {
      this.labelTemplate = new TemplateAsset('@Templates/GameplayObjects/TileLabel.hstf');
    }
    if (!this.ruinTemplate) {
      this.ruinTemplate = new TemplateAsset('@Templates/GameplayObjects/RuinMarker.hstf');
    }

    console.log('[HexBoardRenderer] Per-kind templates: ' +
      `soldier=${!!this.soldierTemplate} tower=${!!this.towerTemplate} ` +
      `mine=${!!this.mineTemplate} barracks=${!!this.barracksTemplate} base=${!!this.baseTemplate}`);
    this.beginStaggeredSpawn();
  }

  @subscribe(OnGameStateChangedLocal, {execution: ExecuteOn.Everywhere})
  onGameStateChanged(payload: GameStateChangedLocalPayload): void {
    if (NetworkingService.get().isServerContext()) return;
    const show = payload.newState === GameState.Playing || payload.newState === GameState.GameOver;
    console.log(`[HexBoardRenderer DIAG] onGameStateChanged newState=${payload.newState} show=${show} tilesSpawned=${this.tilesSpawned} tileEntities.length=${this.tileEntities.length}`);
    this.boardVisible = show;
    this.setBoardVisible(show);
    let aliveCount = 0;
    for (let i = 0; i < this.tileEntities.length; i++) if (this.tileEntities[i]) aliveCount++;
    console.log(`[HexBoardRenderer DIAG] after setBoardVisible(${show}): aliveTileEntities=${aliveCount}/${this.tileEntities.length}`);
  }

  /** Toggle visibility of all spawned tiles + markers */
  private setBoardVisible(visible: boolean): void {
    if (visible) {
      this.loggedFirstRender = false;
      this.loggedEntityDiag = false;
    }
    for (let i = 0; i < this.tileEntities.length; i++) {
      const t = this.tileEntities[i];
      if (t) t.enabledSelf = visible;
    }
    // Tile text labels follow board visibility too. They have no per-frame enable
    // pass (updateTileTexts only sets .text), so if they were pre-spawned while
    // the board was hidden they must be re-enabled here or they stay invisible.
    for (let i = 0; i < this.tileTextEntities.length; i++) {
      const ent = this.tileTextEntities[i];
      if (ent) ent.enabledSelf = visible;
    }
    if (!visible) {
      // Destroy all live + dying markers. Server resets nextEntityId per match,
      // so retained markers would collide with the next match's ids.
      this.destroyAllMarkers();
    }
    if (visible) {
      this.lastTileTextKey = '';
    }
  }

  /** Tear down every active and dying marker (called when the board hides). */
  private destroyAllMarkers(): void {
    for (const m of this.activeMarkers.values()) {
      if (m.entity) m.entity.destroy();
    }
    this.activeMarkers.clear();
    for (const m of this.dyingMarkers.values()) {
      m.entity.destroy();
    }
    this.dyingMarkers.clear();
  }

  /** Template lookup for a server-side kindIdx
   *  (0=spearman, 1=archer, 2=tower, 3=mine, 4=barracks, 5=base, 6=ruin). */
  private getTemplateForKind(kindIdx: number): TemplateAsset | null {
    switch (kindIdx) {
      case 0:
      case 1: return this.soldierTemplate || this.markerTemplate || null;
      case 2: return this.towerTemplate || this.markerTemplate || null;
      case 3: return this.mineTemplate || this.markerTemplate || null;
      case 4: return this.barracksTemplate || this.markerTemplate || null;
      case 5: return this.baseTemplate || this.markerTemplate || null;
      case 6: return this.ruinTemplate || this.markerTemplate || null;
      default: return null;
    }
  }

  private beginStaggeredSpawn(): void {
    if (!this.tileTemplate) {
      console.log('[HexBoardRenderer] No tileTemplate assigned - cannot spawn tiles');
      return;
    }
    console.log('[HexBoardRenderer] Beginning staggered tile spawn...');
    this.isSpawning = true;
    this.spawnIndex = 0;
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Everywhere})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (NetworkingService.get().isServerContext()) return;

    // Phase 1: Spawn tiles
    if (this.isSpawning) {
      this.spawnTileBatch();
      return;
    }

    // Phase 2: Spawn tile text labels (after tiles spawned)
    if (!this.tilesTextReady && this.tilesSpawned) {
      this.spawnTileTextBatch();
      return;
    }

    // Phase 3: Per-frame updates (only while the board is shown). Marker spawn
    // is now dynamic, driven by updateEntityMarkers on every frame using dt for
    // the death animation.
    if (this.tilesSpawned && this.boardVisible) {
      this.updateTileColors();
      this.updateTileTexts();
      this.updateEntityMarkers(payload.deltaTime);
    }
  }

  private spawnTileBatch(): void {
    const endIndex = Math.min(this.spawnIndex + TILES_PER_FRAME, TOTAL_TILES);

    for (let i = this.spawnIndex; i < endIndex; i++) {
      const {col, row} = indexToColRow(i);
      const pos = hexToWorld(col, row);

      WorldService.get().spawnTemplate({
        templateAsset: this.tileTemplate!,
        networkMode: NetworkMode.LocalOnly,
        position: new Vec3(pos.x, 0, pos.z),
        rotation: Quaternion.identity,
        scale: TILE_SCALE,
      }).then((ent: Entity) => {
        this.tileEntities[i] = ent;
        ent.enabledSelf = this.boardVisible;
        const children = ent.getChildren();
        for (const child of children) {
          const color = child.getComponent(ColorComponent);
          if (color) {
            this.tileColors[i] = color;
            break;
          }
        }
      });
    }

    this.spawnIndex = endIndex;

    if (this.spawnIndex >= TOTAL_TILES) {
      this.isSpawning = false;
      this.tilesSpawned = true;
      console.log('[HexBoardRenderer] All tiles spawned');
    }
  }

  private spawnTileTextBatch(): void {
    if (!this.labelTemplate) {
      this.tileTextSpawnIndex = TOTAL_TILES;
      this.tilesTextReady = true;
      console.log('[HexBoardRenderer] labelTemplate not set, skipping tile text');
      return;
    }

    const endIndex = Math.min(this.tileTextSpawnIndex + TILES_PER_FRAME, TOTAL_TILES);

    for (let i = this.tileTextSpawnIndex; i < endIndex; i++) {
      const {col, row} = indexToColRow(i);
      const pos = hexToWorld(col, row);

      WorldService.get().spawnTemplate({
        templateAsset: this.labelTemplate,
        networkMode: NetworkMode.LocalOnly,
        position: new Vec3(pos.x, 0.3, pos.z),
        rotation: Quaternion.identity,
        scale: Vec3.one,
      }).then((ent: Entity) => {
        this.tileTextEntities.push(ent);
        ent.enabledSelf = this.boardVisible;

        const children = ent.getChildren();
        let textComp: WorldTextComponent | null = null;
        for (const child of children) {
          const t = child.getComponent(WorldTextComponent);
          if (t) { textComp = t; break; }
        }
        this.tileTexts.push(textComp);

        if (this.tileTextEntities.length === 1) {
          console.log('[HexBoardRenderer] First tile text entity spawned, visible=' + this.boardVisible);
        }
      });
    }

    this.tileTextSpawnIndex = endIndex;

    if (this.tileTextSpawnIndex >= TOTAL_TILES) {
      this.tilesTextReady = true;
      console.log('[HexBoardRenderer] Tile text labels spawned');
    }
  }

  private updateTileTexts(): void {
    if (!this.gameManager || !this.tilesTextReady) return;

    const ownership = this.gameManager.tileOwnership;
    const explored = this.gameManager.playerExplored;
    const buildings = this.gameManager.tileBuildings;
    const tileTypes = this.gameManager.tileTypes;
    if (!ownership || !explored || !buildings || !tileTypes) return;

    // Must include tileTypes: the empty-tile branch renders from it (e.g. a
    // Mystery tile resolving '?' -> 'E' changes nothing else), so omitting it
    // would cache-suppress that label refresh once the cache actually hits.
    const cacheKey = ownership + explored + buildings + tileTypes;
    if (cacheKey === this.lastTileTextKey) return;
    this.lastTileTextKey = cacheKey;

    for (let i = 0; i < TOTAL_TILES; i++) {
      const textComp = this.tileTexts[i];
      if (!textComp) continue;

      // Only show letter on explored tiles (fog of war)
      if (explored[i] !== '1') {
        textComp.text = '';
        continue;
      }

      const buildingChar = buildings[i];
      // If tile has a building, show its type letter
      if (buildingChar !== '0' && buildingChar !== undefined) {
        switch (buildingChar) {
          case '1': textComp.text = 'B'; break; // barracks
          case '2': textComp.text = 'T'; break; // tower
          case '3': textComp.text = 'M'; break; // mine
          case '4': textComp.text = 'G'; break; // base (G for general/headquarters)
          case '5': textComp.text = ''; break;  // ruin — 3D ruin marker speaks for itself
          default: textComp.text = '?';
        }
        continue;
      }

      // Empty explored tile - show tile type letter from runtime random assignment
      const tileChar = tileTypes[i];
      switch (tileChar) {
        case 'B': textComp.text = 'B'; break;
        case 'T': textComp.text = 'T'; break;
        case 'M': textComp.text = 'M'; break;
        case '?': textComp.text = '?'; break;
        case '#': textComp.text = 'G'; break;
        case '~': textComp.text = '~'; break;
        case 'E': textComp.text = ''; break; // Resolved empty mystery tile
        default: textComp.text = '';
      }
    }
  }

  private findGameManager(): void {
    if (this.combatManager) return;
    const found = EntityService.findEntitiesWithComponent(OccupyCombatSystem);
    if (found.length > 0) {
      this.combatManager = found[0].getComponent(OccupyCombatSystem);
      this.gameManager = found[0].getComponent(HexGameManager);
    }
  }

  private updateTileColors(): void {
    if (!this.gameManager) {
      this.findGameManager();
    }
    if (!this.gameManager) return;

    const ownership = this.gameManager.tileOwnership;
    if (!ownership || ownership.length < TOTAL_TILES) return;

    const explored = this.gameManager.playerExplored;
    const buildings = this.gameManager.tileBuildings;

    for (let i = 0; i < TOTAL_TILES; i++) {
      const colorComp = this.tileColors[i];
      if (!colorComp) continue;

      if (explored && explored.length >= TOTAL_TILES && explored[i] !== '1') {
        // Dim-red tint signals an enemy building visible through fog. Ruins
        // (char '5') are inert rubble, not a threat — render them as plain fog.
        if (buildings && buildings[i] !== '0' && buildings[i] !== '5' && buildings[i] !== undefined && ownership[i] === Owner.AI) {
          colorComp.color = COLOR_FOG_ENEMY_BUILDING;
        } else {
          colorComp.color = COLOR_FOG;
        }
        continue;
      }

      const owner = ownership[i];
      if (owner === Owner.Player) {
        colorComp.color = COLOR_PLAYER;
      } else if (owner === Owner.AI) {
        colorComp.color = COLOR_AI;
      } else {
        colorComp.color = COLOR_NEUTRAL;
      }
    }
  }

  /** Per-frame: advance death animations, reconcile active markers with server data, spawn/kill as needed. */
  private updateEntityMarkers(dt: number): void {
    if (!this.combatManager) return;

    // 1) Advance death animations regardless of server data (they're driven by dt only).
    this.tickDyingMarkers(dt);

    const dataStr = this.combatManager.entityData;
    if (!dataStr || dataStr.length < 2) {
      // Server has no entities — anything still active should die.
      if (this.activeMarkers.size > 0) this.killAllActiveMarkers();
      return;
    }

    // Parse entity data: [[id, kindIdx, sideNum, col, row, hp, hpMax], ...]
    let entities: number[][];
    try {
      entities = JSON.parse(dataStr);
    } catch {
      console.log('[HexBoardRenderer] Failed to parse entityData, length=' + dataStr.length);
      return;
    }

    // One-shot diagnostic: log a preview the first time entityData arrives.
    if (!this.loggedEntityDiag) {
      this.loggedEntityDiag = true;
      const preview = entities.slice(0, 3);
      console.log(`[HexBoardRenderer] entityData first 3: ${JSON.stringify(preview)}, total=${entities.length}`);
    }

    const explored = this.gameManager ? this.gameManager.playerExplored : '';
    const seenIds = new Set<number>();

    // 2) Reconcile each server-side entity with the active map.
    for (let i = 0; i < entities.length; i++) {
      const [id, kindIdx, sideNum, col, row] = entities[i];
      seenIds.add(id);

      let marker = this.activeMarkers.get(id);
      if (!marker) {
        marker = this.spawnMarker(id, kindIdx, sideNum, col, row);
        if (!marker) continue;
      }

      // Update cached position (used for death-animation start when this marker later dies).
      const yPos = marker.isBase ? BASE_Y : marker.isUnit ? UNIT_Y : BUILDING_Y;
      marker.lastCol = col;
      marker.lastRow = row;
      marker.lastY = yPos;

      // Fog of war: AI units on unexplored tiles stay hidden, but the marker is retained
      // (re-revealing the tile re-enables them without a respawn).
      let visible = true;
      if (marker.isUnit && sideNum === 1 && explored && explored.length >= TOTAL_TILES) {
        const tIdx = tileIndex(col, row);
        if (explored[tIdx] !== '1') visible = false;
      }

      if (marker.entity) {
        marker.entity.enabledSelf = visible;
        if (marker.transform) {
          const pos = hexToWorld(col, row);
          marker.transform.worldPosition = new Vec3(pos.x, yPos, pos.z);
        }
      }
    }

    // 3) Anything in active not seen this frame → start dying. Collect ids
    // first to avoid mutating the map while iterating.
    const toKill: number[] = [];
    for (const id of this.activeMarkers.keys()) {
      if (!seenIds.has(id)) toKill.push(id);
    }
    for (const id of toKill) this.transitionToDying(id);

    // One-shot first-render log
    if (!this.loggedFirstRender) {
      if (entities.length > 0) {
        this.loggedFirstRender = true;
        const baseEntities = entities.filter((e: number[]) => e[1] === 5);
        console.log(`[HexBoardRenderer] First render: ${entities.length} entities (dynamic spawn)`);
        for (const b of baseEntities) {
          const pos = hexToWorld(b[3], b[4]);
          console.log(`[HexBoardRenderer] Base: id=${b[0]} side=${b[2] === 0 ? 'Player' : 'AI'} pos=(${pos.x.toFixed(2)}, ${BASE_Y}, ${pos.z.toFixed(2)})`);
        }
      }
    }
  }

  /** Request a marker spawn for a server entity id; returns the (initially unfilled) ActiveMarker.
   *  Returns undefined (not null) so the call site's `let marker = this.activeMarkers.get(id)`
   *  (whose Map.get return is `T | undefined`) can be reassigned without a type widening error. */
  private spawnMarker(id: number, kindIdx: number, sideNum: number, col: number, row: number): ActiveMarker | undefined {
    const template = this.getTemplateForKind(kindIdx);
    if (!template) return undefined;

    const isBase = kindIdx === 5;
    const isUnit = kindIdx <= 1;
    const yPos = isBase ? BASE_Y : isUnit ? UNIT_Y : BUILDING_Y;
    const scale = isBase ? BASE_SCALE : isUnit ? UNIT_SCALE : BUILDING_SCALE;
    const pos = hexToWorld(col, row);
    const [r, g, b] = this.colorForKind(sideNum, kindIdx);

    // Insert placeholder immediately so subsequent frames see this id as active.
    const marker: ActiveMarker = {
      entity: null, color: null, transform: null,
      kindIdx, sideNum, isBase, isUnit,
      baseR: r, baseG: g, baseB: b,
      lastCol: col, lastRow: row, lastY: yPos,
    };
    this.activeMarkers.set(id, marker);

    WorldService.get().spawnTemplate({
      templateAsset: template,
      networkMode: NetworkMode.LocalOnly,
      position: new Vec3(pos.x, yPos, pos.z),
      rotation: Quaternion.identity,
      scale: scale,
    }).then((ent: Entity) => {
      // If the entity already died before the spawn resolved, destroy the orphan.
      if (this.activeMarkers.get(id) !== marker) {
        ent.destroy();
        return;
      }
      marker.entity = ent;
      marker.transform = ent.getComponent(TransformComponent);
      const children = ent.getChildren();
      for (const child of children) {
        const c = child.getComponent(ColorComponent);
        if (c) { marker.color = c; break; }
      }
      if (marker.color) {
        marker.color.color = new Color(r, g, b, 1.0);
      }
      if (marker.transform) {
        marker.transform.localScale = scale;
      }
    });

    return marker;
  }

  /** Static base rgb per (side, kindIdx). Mirrors the legacy COLOR_* constants. */
  private colorForKind(sideNum: number, kindIdx: number): [number, number, number] {
    // Ruins are side-tinted but desaturated, so they read as "abandoned".
    if (kindIdx === 6) {
      return sideNum === 0 ? [0.4, 0.4, 0.5] : [0.5, 0.4, 0.4];
    }
    const isBase = kindIdx === 5;
    const isUnit = kindIdx <= 1;
    if (sideNum === 0) {
      if (isBase) return [1.0, 1.0, 1.0];
      if (isUnit) return [0.2, 0.6, 1.0];
      return [0.0, 0.7, 0.9];
    }
    if (isBase) return [1.0, 0.1, 0.1];
    if (isUnit) return [1.0, 0.2, 0.2];
    return [1.0, 0.5, 0.1];
  }

  /** Move a marker from active → dying, capturing start position for the sink animation. */
  private transitionToDying(id: number): void {
    const m = this.activeMarkers.get(id);
    if (!m) return;
    this.activeMarkers.delete(id);
    if (!m.entity) {
      // Spawn never resolved; the .then will see the missing-from-active sentinel and destroy.
      return;
    }
    const pos = hexToWorld(m.lastCol, m.lastRow);
    this.dyingMarkers.set(id, {
      entity: m.entity, color: m.color, transform: m.transform,
      elapsedMs: 0,
      startX: pos.x, startY: m.lastY, startZ: pos.z,
      baseR: m.baseR, baseG: m.baseG, baseB: m.baseB,
    });
  }

  /** Drive death animations: sink + alpha fade; destroy when t >= 1. */
  private tickDyingMarkers(dt: number): void {
    if (this.dyingMarkers.size === 0) return;
    const finished: number[] = [];
    for (const [id, m] of this.dyingMarkers) {
      m.elapsedMs += dt * 1000;
      if (m.elapsedMs >= DEATH_DURATION_MS) {
        finished.push(id);
        continue;
      }
      const t = m.elapsedMs / DEATH_DURATION_MS;
      if (m.transform) {
        m.transform.worldPosition = new Vec3(m.startX, m.startY - DEATH_SINK_DISTANCE * t, m.startZ);
      }
      if (m.color) {
        m.color.color = new Color(m.baseR, m.baseG, m.baseB, 1.0 - t);
      }
    }
    for (const id of finished) {
      const m = this.dyingMarkers.get(id);
      if (m) m.entity.destroy();
      this.dyingMarkers.delete(id);
    }
  }

  /** Move every active marker into the dying set (used when entityData empties out). */
  private killAllActiveMarkers(): void {
    const ids: number[] = [];
    for (const id of this.activeMarkers.keys()) ids.push(id);
    for (const id of ids) this.transitionToDying(id);
  }
}
