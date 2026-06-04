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

// Entity marker colors - distinct per type and side
const COLOR_PLAYER_BASE = new Color(1.0, 1.0, 1.0, 1.0);
const COLOR_AI_BASE = new Color(1.0, 0.1, 0.1, 1.0);
const COLOR_PLAYER_BUILDING = new Color(0.0, 0.7, 0.9, 1.0);
const COLOR_AI_BUILDING = new Color(1.0, 0.5, 0.1, 1.0);
const COLOR_PLAYER_UNIT = new Color(0.2, 0.6, 1.0, 1.0);
const COLOR_AI_UNIT = new Color(1.0, 0.2, 0.2, 1.0);

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

/** Max entity markers to spawn per frame */
const MARKERS_PER_FRAME = 8;

// Pool sizes per entity kind
const POOL_SIZE_SOLDIER = 24; // spearman + archer combined
const POOL_SIZE_TOWER = 10;
const POOL_SIZE_MINE = 10;
const POOL_SIZE_BARRACKS = 10;
const POOL_SIZE_BASE = 4;
const TOTAL_MARKERS = POOL_SIZE_SOLDIER + POOL_SIZE_TOWER + POOL_SIZE_MINE + POOL_SIZE_BARRACKS + POOL_SIZE_BASE;

/** Marker pool entry with cached components */
interface MarkerEntry {
  entity: Entity;
  color: ColorComponent | null;
  transform: TransformComponent | null;
}

/**
 * HexBoardRenderer - Client-side renderer that spawns hex tile entities
 * to visualize the game board and combat entities with distinct 3D models.
 *
 * Component Attachment: Player entity in player.hstf
 * Component Networking: Local (client-only rendering)
 * Component Ownership: Not Networked (runs on owning client)
 *
 * Spawning is staggered across frames (10 tiles/frame) to prevent
 * mobile performance hitches from 108 simultaneous entity spawns.
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

  private tileEntities: (Entity | null)[] = [];
  private tileColors: (ColorComponent | null)[] = [];
  private tilesSpawned: boolean = false;
  private gameManager: Maybe<HexGameManager> = null;
  private combatManager: Maybe<OccupyCombatSystem> = null;
  private boardVisible: boolean = false;

  // Staggered spawning state
  private isSpawning: boolean = false;
  private spawnIndex: number = 0;

  // Per-kind marker pools
  private soldierPool: MarkerEntry[] = [];
  private towerPool: MarkerEntry[] = [];
  private minePool: MarkerEntry[] = [];
  private barracksPool: MarkerEntry[] = [];
  private basePool: MarkerEntry[] = [];

  // Spawning state for markers
  private isSpawningMarkers: boolean = false;
  private markerSpawnPhase: number = 0; // 0=soldier, 1=tower, 2=mine, 3=barracks, 4=base
  private markerSpawnIndex: number = 0;
  private markersReady: boolean = false;
  private totalMarkersSpawned: number = 0;

  // Tile text labels (one per tile, 108 total) - for type letters on explored tiles
  private tileTexts: (WorldTextComponent | null)[] = [];
  private tileTextEntities: (Entity | null)[] = [];
  private tilesTextReady: boolean = false;
  private lastTileTextKey: string = '';
  private tileTextSpawnIndex: number = 0;

  // Pre-allocated for update loop
  private lastEntityData: string = '[]';
  private lastEntityCount: number = -1;
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

    console.log('[HexBoardRenderer] Per-kind templates: ' +
      `soldier=${!!this.soldierTemplate} tower=${!!this.towerTemplate} ` +
      `mine=${!!this.mineTemplate} barracks=${!!this.barracksTemplate} base=${!!this.baseTemplate}`);
    this.beginStaggeredSpawn();
  }

  @subscribe(OnGameStateChangedLocal, {execution: ExecuteOn.Everywhere})
  onGameStateChanged(payload: GameStateChangedLocalPayload): void {
    if (NetworkingService.get().isServerContext()) return;
    const show = payload.newState === GameState.Playing || payload.newState === GameState.GameOver;
    this.boardVisible = show;
    this.setBoardVisible(show);
  }

  /** Toggle visibility of all spawned tiles + markers */
  private setBoardVisible(visible: boolean): void {
    if (visible) {
      this.lastEntityData = '[]';
      this.lastEntityCount = -1;
      this.markersReady = false;
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
      this.hideAllMarkers();
    }
    if (visible) {
      this.lastTileTextKey = '';
    }
  }

  private hideAllMarkers(): void {
    const allPools = [this.soldierPool, this.towerPool, this.minePool, this.barracksPool, this.basePool];
    for (const pool of allPools) {
      for (let i = 0; i < pool.length; i++) {
        const e = pool[i].entity;
        if (e) e.enabledSelf = false;
      }
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

  private beginMarkerSpawn(): void {
    // Check if at least one entity template is available
    const hasAnyTemplate = this.soldierTemplate || this.towerTemplate ||
      this.mineTemplate || this.barracksTemplate || this.baseTemplate || this.markerTemplate;
    if (!hasAnyTemplate) {
      console.log('[HexBoardRenderer] No entity templates assigned - skipping marker spawn');
      return;
    }
    console.log('[HexBoardRenderer] Spawning per-kind entity marker pools...');
    this.isSpawningMarkers = true;
    this.markerSpawnPhase = 0;
    this.markerSpawnIndex = 0;
    this.totalMarkersSpawned = 0;
  }

  /** Get template for a specific spawn phase, with fallback to markerTemplate */
  private getTemplateForPhase(phase: number): TemplateAsset | null {
    switch (phase) {
      case 0: return this.soldierTemplate || this.markerTemplate || null;
      case 1: return this.towerTemplate || this.markerTemplate || null;
      case 2: return this.mineTemplate || this.markerTemplate || null;
      case 3: return this.barracksTemplate || this.markerTemplate || null;
      case 4: return this.baseTemplate || this.markerTemplate || null;
      default: return null;
    }
  }

  /** Get pool size for a specific spawn phase */
  private getPoolSizeForPhase(phase: number): number {
    switch (phase) {
      case 0: return POOL_SIZE_SOLDIER;
      case 1: return POOL_SIZE_TOWER;
      case 2: return POOL_SIZE_MINE;
      case 3: return POOL_SIZE_BARRACKS;
      case 4: return POOL_SIZE_BASE;
      default: return 0;
    }
  }

  /** Get the pool array for a specific phase */
  private getPoolForPhase(phase: number): MarkerEntry[] {
    switch (phase) {
      case 0: return this.soldierPool;
      case 1: return this.towerPool;
      case 2: return this.minePool;
      case 3: return this.barracksPool;
      case 4: return this.basePool;
      default: return [];
    }
  }

  /** Map kindIdx to pool */
  private getPoolForKind(kindIdx: number): MarkerEntry[] {
    switch (kindIdx) {
      case 0: // spearman
      case 1: // archer
        return this.soldierPool;
      case 2: return this.towerPool;
      case 3: return this.minePool;
      case 4: return this.barracksPool;
      case 5: return this.basePool;
      default: return this.soldierPool;
    }
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Everywhere})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (NetworkingService.get().isServerContext()) return;

    // Phase 1: Spawn tiles
    if (this.isSpawning) {
      this.spawnTileBatch();
      return;
    }

    // Phase 2: Spawn marker pools
    if (this.isSpawningMarkers) {
      this.spawnMarkerBatch();
      return;
    }

    // Phase 2.5: Spawn tile text labels (after tiles spawned, sequentially after markers)
    if (!this.tilesTextReady && this.tilesSpawned) {
      this.spawnTileTextBatch();
      return;
    }

    // Phase 3: Update tile colors and entity markers (only while the board is shown)
    if (this.tilesSpawned && this.boardVisible) {
      this.updateTileColors();
      this.updateTileTexts();
      this.updateEntityMarkers();
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
      this.beginMarkerSpawn();
    }
  }

  private spawnMarkerBatch(): void {
    const poolSize = this.getPoolSizeForPhase(this.markerSpawnPhase);
    const template = this.getTemplateForPhase(this.markerSpawnPhase);
    const pool = this.getPoolForPhase(this.markerSpawnPhase);

    if (!template) {
      // Skip this phase, move to next
      this.markerSpawnPhase++;
      this.markerSpawnIndex = 0;
      if (this.markerSpawnPhase > 4) {
        this.isSpawningMarkers = false;
        console.log(`[HexBoardRenderer] Marker pools spawned (${this.totalMarkersSpawned} total)`);
      }
      return;
    }

    const endIndex = Math.min(this.markerSpawnIndex + MARKERS_PER_FRAME, poolSize);

    for (let i = this.markerSpawnIndex; i < endIndex; i++) {
      WorldService.get().spawnTemplate({
        templateAsset: template,
        networkMode: NetworkMode.LocalOnly,
        position: Vec3.zero,
        rotation: Quaternion.identity,
        scale: UNIT_SCALE,
      }).then((ent: Entity) => {
        ent.enabledSelf = false;

        // Cache color + transform
        const children = ent.getChildren();
        let colorComp: ColorComponent | null = null;
        for (const child of children) {
          const c = child.getComponent(ColorComponent);
          if (c) { colorComp = c; break; }
        }
        pool.push({
          entity: ent,
          color: colorComp,
          transform: ent.getComponent(TransformComponent),
        });
        this.totalMarkersSpawned++;
      });
    }

    this.markerSpawnIndex = endIndex;

    if (this.markerSpawnIndex >= poolSize) {
      this.markerSpawnPhase++;
      this.markerSpawnIndex = 0;
      if (this.markerSpawnPhase > 4) {
        this.isSpawningMarkers = false;
        console.log(`[HexBoardRenderer] Marker pools spawned (${this.totalMarkersSpawned} total)`);
      }
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
        if (buildings && buildings[i] !== '0' && buildings[i] !== undefined && ownership[i] === Owner.AI) {
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

  /** Lazy re-fetch a marker's cached ColorComponent if null at spawn time */
  private refetchMarkerColor(entry: MarkerEntry): ColorComponent | null {
    if (!entry.entity) return null;
    const children = entry.entity.getChildren();
    for (const child of children) {
      const c = child.getComponent(ColorComponent);
      if (c) {
        entry.color = c;
        return c;
      }
    }
    return null;
  }

  /** Lazy re-fetch a marker's cached TransformComponent if null at spawn time */
  private refetchMarkerTransform(entry: MarkerEntry): TransformComponent | null {
    if (!entry.entity) return null;
    const t = entry.entity.getComponent(TransformComponent);
    if (t) {
      entry.transform = t;
      return t;
    }
    return null;
  }

  private updateEntityMarkers(): void {
    if (!this.combatManager) return;

    // Wait until marker spawning is complete (isSpawningMarkers goes false when done)
    if (this.isSpawningMarkers) return;

    if (!this.markersReady) {
      this.markersReady = true;
      this.lastEntityData = '[]'; // Force refresh on first render
      console.log('[HexBoardRenderer] Marker pools ready, rendering entities');
    }

    const dataStr = this.combatManager.entityData;
    if (!dataStr || dataStr.length < 2) return;

    // Parse entity data: [[id, kindIdx, sideNum, col, row, hp, hpMax], ...]
    let entities: number[][] = [];
    try {
      entities = JSON.parse(dataStr);
    } catch {
      console.log('[HexBoardRenderer] Failed to parse entityData, length=' + dataStr.length);
      return;
    }

    // Skip if entity count unchanged and string unchanged
    if (entities.length === this.lastEntityCount && dataStr === this.lastEntityData) return;
    this.lastEntityCount = entities.length;
    this.lastEntityData = dataStr;

    if (!this.loggedEntityDiag) {
      this.loggedEntityDiag = true;
      const preview = entities.slice(0, 3);
      console.log(`[HexBoardRenderer] entityData first 3: ${JSON.stringify(preview)}, total=${entities.length}`);
    }

    // Hide all markers first
    this.hideAllMarkers();

    // Track per-pool usage index
    const poolUsage: number[] = [0, 0, 0, 0, 0, 0]; // indexed by kindIdx (0-5)

    const explored = this.gameManager ? this.gameManager.playerExplored : '';

    for (let i = 0; i < entities.length; i++) {
      const [id, kindIdx, sideNum, col, row, hp, hpMax] = entities[i];

      // Fog of war: hide AI UNITS on unexplored tiles
      if (sideNum === 1 && kindIdx <= 1 && explored && explored.length >= TOTAL_TILES) {
        const tIdx = tileIndex(col, row);
        if (explored[tIdx] !== '1') {
          continue;
        }
      }

      const pool = this.getPoolForKind(kindIdx);
      // For soldier pool, both kindIdx 0 and 1 share it; combine usage
      const usageKey = kindIdx <= 1 ? 0 : kindIdx;
      const idx = poolUsage[usageKey];
      if (idx >= pool.length) continue; // pool exhausted
      poolUsage[usageKey]++;

      const entry = pool[idx];
      if (!entry || !entry.entity) continue;

      entry.entity.enabledSelf = true;

      // Determine type: unit (0-1), building (2-4), base (5)
      const isBase = kindIdx === 5;
      const isUnit = kindIdx <= 1;

      // Position and scale based on type
      const pos = hexToWorld(col, row);
      let yPos: number;
      let scale: Vec3;
      if (isBase) {
        yPos = BASE_Y;
        scale = BASE_SCALE;
      } else if (isUnit) {
        yPos = UNIT_Y;
        scale = UNIT_SCALE;
      } else {
        yPos = BUILDING_Y;
        scale = BUILDING_SCALE;
      }

      let transform = entry.transform;
      if (!transform) {
        transform = this.refetchMarkerTransform(entry);
      }
      if (transform) {
        transform.worldPosition = new Vec3(pos.x, yPos, pos.z);
        transform.localScale = scale;
      }

      // Color based on side (player=blue tones, AI=red tones)
      let colorComp = entry.color;
      if (!colorComp) {
        colorComp = this.refetchMarkerColor(entry);
      }
      if (colorComp) {
        if (sideNum === 0) {
          colorComp.color = isBase ? COLOR_PLAYER_BASE : isUnit ? COLOR_PLAYER_UNIT : COLOR_PLAYER_BUILDING;
        } else {
          colorComp.color = isBase ? COLOR_AI_BASE : isUnit ? COLOR_AI_UNIT : COLOR_AI_BUILDING;
        }
      }
    }

    // One-shot diagnostic
    if (!this.loggedFirstRender && entities.length > 0) {
      this.loggedFirstRender = true;
      const baseEntities = entities.filter((e: number[]) => e[1] === 5);
      console.log(`[HexBoardRenderer] First render: ${entities.length} entities, pools: soldier=${this.soldierPool.length} tower=${this.towerPool.length} mine=${this.minePool.length} barracks=${this.barracksPool.length} base=${this.basePool.length}`);
      for (const b of baseEntities) {
        const pos = hexToWorld(b[3], b[4]);
        console.log(`[HexBoardRenderer] Base: id=${b[0]} side=${b[2] === 0 ? 'Player' : 'AI'} pos=(${pos.x.toFixed(2)}, ${BASE_Y}, ${pos.z.toFixed(2)})`);
      }
    } else if (!this.loggedFirstRender && entities.length === 0) {
      this.loggedFirstRender = true;
      console.log('[HexBoardRenderer] First update: no entities yet (combat may not have started)');
    }
  }

}
