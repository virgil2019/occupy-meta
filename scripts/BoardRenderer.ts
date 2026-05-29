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

const COLOR_PLAYER = new Color(0.3, 0.5, 0.8, 1.0);
const COLOR_AI = new Color(0.8, 0.3, 0.3, 1.0);
const COLOR_NEUTRAL = new Color(0.4, 0.4, 0.4, 1.0);
const COLOR_FOG = new Color(0.15, 0.15, 0.15, 1.0);

// Entity marker colors - distinct per type and side
// Bases: high-contrast colors that stand out against tile backgrounds
// Player base uses bright white-cyan to contrast against blue player tiles
const COLOR_PLAYER_BASE = new Color(1.0, 1.0, 1.0, 1.0);
const COLOR_AI_BASE = new Color(1.0, 0.1, 0.1, 1.0);
// Buildings: lighter variants (cyan for player, orange for AI)
const COLOR_PLAYER_BUILDING = new Color(0.0, 0.7, 0.9, 1.0);
const COLOR_AI_BUILDING = new Color(1.0, 0.5, 0.1, 1.0);
// Units: smaller blue/red markers
const COLOR_PLAYER_UNIT = new Color(0.2, 0.6, 1.0, 1.0);
const COLOR_AI_UNIT = new Color(1.0, 0.2, 0.2, 1.0);

const TILE_SCALE = new Vec3(0.5, 0.05, 0.5);
// Bases: largest and tallest to ensure visibility from top-down camera
const BASE_SCALE = new Vec3(0.7, 0.6, 0.7);
// Buildings: medium (scale ~1.2)
const BUILDING_SCALE = new Vec3(0.4, 0.3, 0.4);
// Units: small (scale ~0.6-0.8)
const UNIT_SCALE = new Vec3(0.2, 0.12, 0.2);

const UNIT_Y = 0.12;
const BUILDING_Y = 0.18;
const BASE_Y = 0.35;

/** Max tiles to spawn per frame to avoid mobile hitches */
const TILES_PER_FRAME = 10;

/** Max entity markers to spawn per frame */
const MARKERS_PER_FRAME = 8;

/**
 * HexBoardRenderer - Client-side renderer that spawns hex tile entities
 * to visualize the game board and combat entities.
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

  @property()
  markerTemplate: Maybe<TemplateAsset> = null;

  private tileEntities: (Entity | null)[] = [];
  private tileColors: (ColorComponent | null)[] = [];
  private tilesSpawned: boolean = false;
  private gameManager: Maybe<HexGameManager> = null;
  private combatManager: Maybe<OccupyCombatSystem> = null;
  private boardVisible: boolean = false;

  // Staggered spawning state
  private isSpawning: boolean = false;
  private spawnIndex: number = 0;

  // Entity marker pool
  private markerPool: Entity[] = [];
  private markerColors: (ColorComponent | null)[] = [];
  private markerTransforms: (TransformComponent | null)[] = [];
  private markersActive: number = 0;
  private markersSpawned: number = 0;
  private isSpawningMarkers: boolean = false;
  private markerSpawnIndex: number = 0;
  private markersReady: boolean = false;

  // Pre-allocated for update loop
  private readonly MAX_MARKERS = 60;
  private lastEntityData: string = '[]';
  private lastMarkersReady: number = 0;
  private loggedFirstRender: boolean = false;
  private loggedEntityDiag: boolean = false;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (NetworkingService.get().isServerContext()) return;
    console.log('[HexBoardRenderer] Starting');
    this.tileEntities = new Array(TOTAL_TILES).fill(null);
    this.tileColors = new Array(TOTAL_TILES).fill(null);
  }

  @subscribe(OnGameStateChangedLocal, {execution: ExecuteOn.Everywhere})
  onGameStateChanged(payload: GameStateChangedLocalPayload): void {
    if (NetworkingService.get().isServerContext()) return;
    if (payload.newState === GameState.Playing && !this.tilesSpawned && !this.isSpawning) {
      this.beginStaggeredSpawn();
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
    if (!this.markerTemplate) {
      console.log('[HexBoardRenderer] No markerTemplate - skipping marker spawn');
      return;
    }
    console.log('[HexBoardRenderer] Spawning entity marker pool...');
    this.isSpawningMarkers = true;
    this.markerSpawnIndex = 0;
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Everywhere})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (NetworkingService.get().isServerContext()) return;

    // Phase 1: Spawn tiles
    if (this.isSpawning) {
      this.spawnTileBatch();
      return;
    }

    // Phase 2: Spawn marker pool
    if (this.isSpawningMarkers) {
      this.spawnMarkerBatch();
      return;
    }

    // Phase 3: Update tile colors and entity markers
    if (this.tilesSpawned) {
      this.updateTileColors();
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
      // Now spawn marker pool
      this.beginMarkerSpawn();
    }
  }

  private spawnMarkerBatch(): void {
    if (!this.markerTemplate) {
      this.isSpawningMarkers = false;
      return;
    }

    const endIndex = Math.min(this.markerSpawnIndex + MARKERS_PER_FRAME, this.MAX_MARKERS);

    for (let i = this.markerSpawnIndex; i < endIndex; i++) {
      WorldService.get().spawnTemplate({
        templateAsset: this.markerTemplate,
        networkMode: NetworkMode.LocalOnly,
        position: Vec3.zero,
        rotation: Quaternion.identity,
        scale: UNIT_SCALE,
      }).then((ent: Entity) => {
        this.markerPool.push(ent);
        ent.enabledSelf = false;

        // Cache color + transform
        const children = ent.getChildren();
        let colorComp: ColorComponent | null = null;
        for (const child of children) {
          const c = child.getComponent(ColorComponent);
          if (c) { colorComp = c; break; }
        }
        this.markerColors.push(colorComp);
        this.markerTransforms.push(ent.getComponent(TransformComponent));
        this.markersSpawned++;
      });
    }

    this.markerSpawnIndex = endIndex;

    if (this.markerSpawnIndex >= this.MAX_MARKERS) {
      this.isSpawningMarkers = false;
      console.log('[HexBoardRenderer] Marker pool spawned');
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

    for (let i = 0; i < TOTAL_TILES; i++) {
      const colorComp = this.tileColors[i];
      if (!colorComp) continue;

      // Fog of war: unexplored tiles render as dark
      if (explored && explored.length >= TOTAL_TILES && explored[i] !== '1') {
        colorComp.color = COLOR_FOG;
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

  /** Lazy re-fetch a marker's cached ColorComponent if it was null at spawn time */
  private refetchMarkerColor(idx: number): ColorComponent | null {
    const marker = this.markerPool[idx];
    if (!marker) return null;
    const children = marker.getChildren();
    for (const child of children) {
      const c = child.getComponent(ColorComponent);
      if (c) {
        this.markerColors[idx] = c;
        console.log(`[HexBoardRenderer] Lazy re-fetched markerColors[${idx}] - was null at spawn`);
        return c;
      }
    }
    return null;
  }

  /** Lazy re-fetch a marker's cached TransformComponent if it was null at spawn time */
  private refetchMarkerTransform(idx: number): TransformComponent | null {
    const marker = this.markerPool[idx];
    if (!marker) return null;
    const t = marker.getComponent(TransformComponent);
    if (t) {
      this.markerTransforms[idx] = t;
      console.log(`[HexBoardRenderer] Lazy re-fetched markerTransforms[${idx}] - was null at spawn`);
      return t;
    }
    return null;
  }

  private updateEntityMarkers(): void {
    if (!this.combatManager) return;

    // Wait until ALL markers in the pool have resolved their async spawn.
    // isSpawningMarkers becomes false when all spawn calls are ISSUED,
    // but .then() callbacks resolve later. Only process once pool is fully ready.
    if (this.markersSpawned < this.MAX_MARKERS) return;

    // Mark pool as ready on first full resolution
    if (!this.markersReady) {
      this.markersReady = true;
      console.log('[HexBoardRenderer] Marker pool fully resolved, ready to render entities');
    }

    const dataStr = this.combatManager.entityData;
    if (!dataStr || dataStr.length < 2) return; // Guard against empty/invalid strings

    // Invalidate cache if marker count changed (safety net)
    if (this.markersSpawned !== this.lastMarkersReady) {
      this.lastEntityData = '[]';
      this.lastMarkersReady = this.markersSpawned;
    }

    if (dataStr === this.lastEntityData) return;

    // Parse entity data: [[id, kindIdx, sideNum, col, row, hp, hpMax], ...]
    let entities: number[][] = [];
    try {
      entities = JSON.parse(dataStr);
    } catch {
      console.log('[HexBoardRenderer] Failed to parse entityData, length=' + dataStr.length);
      return;
    }
    // Only update cache AFTER successful parse to avoid blocking future updates
    this.lastEntityData = dataStr;

    // One-time diagnostic: log first few entities to confirm player base is present
    if (!this.loggedEntityDiag) {
      this.loggedEntityDiag = true;
      const preview = entities.slice(0, 3);
      console.log(`[HexBoardRenderer] entityData first 3 entries: ${JSON.stringify(preview)}, total=${entities.length}`);
    }

    // Hide all previously-active markers (use max of markersActive and markersSpawned
    // to catch any stale visible markers from prior partial renders)
    const hideCount = Math.max(this.markersActive, this.markersSpawned);
    for (let i = 0; i < hideCount; i++) {
      if (this.markerPool[i]) {
        this.markerPool[i].enabledSelf = false;
      }
    }

    // Show markers for each entity (up to pool size)
    const count = Math.min(entities.length, this.markersSpawned);
    const explored = this.gameManager ? this.gameManager.playerExplored : '';
    let activeIdx = 0;
    for (let i = 0; i < count; i++) {
      const [id, kindIdx, sideNum, col, row, hp, hpMax] = entities[i];

      // Fog of war: hide AI markers on unexplored tiles
      if (sideNum === 1 && explored && explored.length >= TOTAL_TILES) {
        const tIdx = tileIndex(col, row);
        if (explored[tIdx] !== '1') {
          continue;
        }
      }

      if (activeIdx >= this.markersSpawned) break;
      const marker = this.markerPool[activeIdx];
      if (!marker) { activeIdx++; continue; }

      marker.enabledSelf = true;

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

      // Lazy re-fetch transform if null (children may not have been ready at spawn)
      let transform = this.markerTransforms[activeIdx];
      if (!transform) {
        transform = this.refetchMarkerTransform(activeIdx);
      }
      if (transform) {
        transform.worldPosition = new Vec3(pos.x, yPos, pos.z);
        transform.localScale = scale;
      }

      // Lazy re-fetch color if null (children may not have been ready at spawn)
      let colorComp = this.markerColors[activeIdx];
      if (!colorComp) {
        colorComp = this.refetchMarkerColor(activeIdx);
      }
      if (colorComp) {
        if (sideNum === 0) {
          colorComp.color = isBase ? COLOR_PLAYER_BASE : isUnit ? COLOR_PLAYER_UNIT : COLOR_PLAYER_BUILDING;
        } else {
          colorComp.color = isBase ? COLOR_AI_BASE : isUnit ? COLOR_AI_UNIT : COLOR_AI_BUILDING;
        }
      }

      activeIdx++;
    }

    this.markersActive = activeIdx;

    // One-shot diagnostic: confirm base markers are being rendered
    if (!this.loggedFirstRender && activeIdx > 0) {
      this.loggedFirstRender = true;
      const baseEntities = entities.filter((e: number[]) => e[1] === 5);
      console.log(`[HexBoardRenderer] First render: ${activeIdx} markers active, ${entities.length} entities total`);
      for (const b of baseEntities) {
        const pos = hexToWorld(b[3], b[4]);
        console.log(`[HexBoardRenderer] Base marker: id=${b[0]} side=${b[2] === 0 ? 'Player' : 'AI'} col=${b[3]} row=${b[4]} pos=(${pos.x.toFixed(2)}, ${BASE_Y}, ${pos.z.toFixed(2)})`);
      }
    }
  }
}
