/**
 * HexGameManager - Server-owned game state manager for Occupy Master.
 *
 * Component Attachment: Scene entity in space.hstf (e.g., a "GameManager" entity)
 * Component Networking: Networked (server-owned)
 * Component Ownership: Server
 *
 * All game state is encoded as compact strings (1 char per tile = 108 chars).
 * @property() fields auto-sync to all clients. Clients read these to render.
 * Players use @rpc to request builds.
 *
 * Integrates with GameStateComponent: only ticks when state is Playing.
 * Match-end (result event + GameOver transition) is owned by OccupyCombatSystem.
 */

import {
  Component,
  ExecuteOn,
  NetworkingService,
  OnEntityStartEvent,
  OnWorldUpdateEvent,
  type OnWorldUpdateEventPayload,
  component,
  property,
  rpc,
  subscribe,
} from 'meta/worlds';

import {
  AI_BASE_COL,
  AI_BASE_ROW,
  BASE_COIN_INTERVAL,
  BASE_COIN_RATE,
  BASE_HP,
  BUILD_COST_MYSTERY,
  BUILD_COST_NEIGHBOR,
  BUILD_COST_NORMAL,
  BuildingType,
  GAME_DURATION,
  GRID_COLS,
  GRID_ROWS,
  LEVEL_MULT,
  MINE_COIN_INTERVAL,
  MINE_COIN_RATE,
  Owner,
  PLAYER_BASE_COL,
  PLAYER_BASE_ROW,
  STARTING_COINS,
  TOTAL_TILES,
  TileType,
  getBuildingTypeForTile,
  getInitialOwner,
  getNeighbors,
  getTileType,
  tileIndex,
  indexToColRow,
} from './HexGridConfig';

import {
  GameState,
  OnGameStateChanged,
  GameStateChangedPayload,
} from './GameStateComponent';

@component()
export class HexGameManager extends Component {
  // ─── Networked State (synced to all clients) ────────────────────────────────

  /** Tile ownership: P=player, A=ai, N=neutral. 108 chars. */
  @property({maxLength: 120})
  tileOwnership: string = '';

  /** Building on each tile: 0=none, 1=barracks, 2=tower, 3=mine, 4=base. 108 chars. */
  @property({maxLength: 120})
  tileBuildings: string = '';

  /** Player exploration: 0=unexplored, 1=explored. 108 chars. */
  @property({maxLength: 120})
  playerExplored: string = '';

  /** AI exploration: 0=unexplored, 1=explored. 108 chars. */
  @property({maxLength: 120})
  aiExplored: string = '';

  /** Random tile types: B=barracks, T=tower, M=mine, ?=mystery, #=base, ~=baseNeighbor. 108 chars. */
  @property({maxLength: 120})
  tileTypes: string = '';

  @property()
  playerCoins: number = STARTING_COINS;

  @property()
  aiCoins: number = STARTING_COINS;

  @property()
  timer: number = GAME_DURATION;

  @property()
  playerScore: number = 0;

  @property()
  aiScore: number = 0;

  @property()
  playerBaseHP: number = BASE_HP;

  @property()
  aiBaseHP: number = BASE_HP;

  @property()
  gameActive: boolean = false;

  // ─── Server-local state (not synced) ───────────────────────────────────────

  private baseCoinTimer: number = 0;
  private mineCoinTimer: number = 0;
  private aiBaseCoinTimer: number = 0;
  private aiMineCoinTimer: number = 0;
  /** Player card levels (1..4), pushed from the lobby via RpcSetCardLevels just
   *  before Start. Combat scales player unit hp/atk by these. AI stays Lv1. */
  private playerCardLevels: Record<string, number> = {spearman: 1, archer: 1, tower: 1, mine: 1};

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    // Game starts inactive - waits for GameState to enter Playing
    console.log('[HexGameManager] Initialized - waiting for game state Playing');
  }

  /**
   * Listen for game state changes to start/stop the match.
   */
  @subscribe(OnGameStateChanged, {execution: ExecuteOn.Everywhere})
  onGameStateChanged(payload: GameStateChangedPayload): void {
    if (!NetworkingService.get().isServerContext()) return;

    if (payload.lastState === GameState.MainMenu && payload.newState === GameState.Playing) {
      console.log('[HexGameManager] New game start - initializing');
      this.initializeGameState();
    } else if (payload.newState === GameState.MainMenu) {
      // Returning to lobby - deactivate
      this.gameActive = false;
      console.log('[HexGameManager] Returning to lobby - deactivating');
    }
  }

  private initializeGameState(): void {
    // Initialize all game counters
    this.timer = GAME_DURATION;
    this.playerCoins = STARTING_COINS;
    this.aiCoins = STARTING_COINS;
    this.playerBaseHP = BASE_HP;
    this.aiBaseHP = BASE_HP;
    this.gameActive = true;
    this.baseCoinTimer = 0;
    this.mineCoinTimer = 0;

    // Build ownership string - player half (rows 0-5), AI half (rows 6-11)
    let ownership = '';
    let buildings = '';

    // Generate random tile types for all 108 tiles
    let types = '';

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const mapChar = getTileType(col, row);
        const owner = getInitialOwner(row);
        ownership += owner;

        // Place base buildings
        if (mapChar === TileType.Base) {
          buildings += BuildingType.Base.toString();
        } else {
          buildings += BuildingType.None.toString();
        }

        // Tile types: Base and BaseNeighbor keep their fixed type; others randomize
        if (mapChar === TileType.Base) {
          types += '#';
        } else if (mapChar === TileType.BaseNeighbor) {
          types += '~';
        } else {
          // Random assignment: 30% B, 25% T, 25% M, 20% ?
          const r = Math.random();
          if (r < 0.3) types += 'B';
          else if (r < 0.55) types += 'T';
          else if (r < 0.8) types += 'M';
          else types += '?';
        }
      }
    }

    this.tileOwnership = ownership;
    this.tileBuildings = buildings;
    this.tileTypes = types;

    // Calculate initial exploration based on base buildings only (dynamic fog)
    this.playerExplored = this.computeExploration(Owner.Player, buildings, ownership);
    this.aiExplored = this.computeExploration(Owner.AI, buildings, ownership);

    // Calculate initial scores
    this.recalculateScores();

    console.log('[HexGameManager] Game state initialized with random tile types');
  }

  private computeExploration(side: Owner, buildings: string, ownership: string): string {
    const explored = new Array(TOTAL_TILES).fill('0');

    // Only tiles with owned buildings + their 6 neighbors are explored (dynamic fog)
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const idx = tileIndex(col, row);
        const building = parseInt(buildings[idx]);
        const tileOwner = ownership[idx];

        if (building > 0 && tileOwner === side) {
          explored[idx] = '1';
          const neighbors = getNeighbors(col, row);
          for (const n of neighbors) {
            explored[tileIndex(n.col, n.row)] = '1';
          }
        }
      }
    }

    return explored.join('');
  }

  /** Recalculate exploration for both sides. Call after building destruction. */
  recalculateAllExploration(): void {
    this.playerExplored = this.computeExploration(Owner.Player, this.tileBuildings, this.tileOwnership);
    this.aiExplored = this.computeExploration(Owner.AI, this.tileBuildings, this.tileOwnership);
  }

  private recalculateScores(): void {
    let playerCount = 0;
    let aiCount = 0;
    for (let i = 0; i < TOTAL_TILES; i++) {
      if (this.tileOwnership[i] === Owner.Player) playerCount++;
      else if (this.tileOwnership[i] === Owner.AI) aiCount++;
    }
    this.playerScore = playerCount;
    this.aiScore = aiCount;
  }

  // ─── Economy Tick ──────────────────────────────────────────────────────────

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Owner})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (!NetworkingService.get().isServerContext()) return;
    if (!this.gameActive) return;

    const dt = payload.deltaTime;

    // Timer countdown. Match-end is owned solely by OccupyCombatSystem.tickWinCheck
    // (it reads this.timer <= 0). We only count down and clamp here to avoid two
    // systems racing to send the result event / set GameOver.
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0;
    }

    // Keep territory score live: combat captures tiles every tick, so recompute
    // each frame (108 chars, cheap) instead of only on player builds.
    this.recalculateScores();

    // Base coin production (both sides) - only if base is alive
    this.baseCoinTimer += dt;
    if (this.baseCoinTimer >= BASE_COIN_INTERVAL) {
      this.baseCoinTimer -= BASE_COIN_INTERVAL;
      if (this.playerBaseHP > 0) this.playerCoins += BASE_COIN_RATE;
      if (this.aiBaseHP > 0) this.aiCoins += BASE_COIN_RATE;
    }

    // Mine coin production
    this.mineCoinTimer += dt;
    if (this.mineCoinTimer >= MINE_COIN_INTERVAL) {
      this.mineCoinTimer -= MINE_COIN_INTERVAL;
      const playerMines = this.countBuildings(Owner.Player, BuildingType.Mine);
      const aiMines = this.countBuildings(Owner.AI, BuildingType.Mine);
      // Player mine income scales with the Mine card level (AI fixed at Lv1).
      const mineMult = LEVEL_MULT[this.getPlayerCardLevel('mine') - 1] ?? 1.0;
      this.playerCoins += Math.round(playerMines * MINE_COIN_RATE * mineMult);
      this.aiCoins += aiMines * MINE_COIN_RATE;
    }
  }

  private countBuildings(owner: Owner, buildingType: BuildingType): number {
    let count = 0;
    for (let i = 0; i < TOTAL_TILES; i++) {
      if (this.tileOwnership[i] === owner && this.tileBuildings[i] === buildingType.toString()) {
        count++;
      }
    }
    return count;
  }

  // ─── Build RPC (called by client) ─────────────────────────────────────────

  @rpc()
  RpcBuildOnTile(col: number, row: number): void {
    this.buildForSide(Owner.Player, col, row);
  }

  /** Lobby pushes the player's card levels here right before the match starts. */
  @rpc()
  RpcSetCardLevels(spearman: number, archer: number, tower: number, mine: number): void {
    this.playerCardLevels = {spearman, archer, tower, mine};
    console.log(`[HexGameManager] Card levels set: S${spearman} A${archer} T${tower} M${mine}`);
  }

  /** Player card level (1..4) for a unit/building kind; 1 for kinds without a card. */
  getPlayerCardLevel(kind: string): number {
    return this.playerCardLevels[kind] ?? 1;
  }

  /**
   * Validate + execute a build for either side. Shared by the player RPC and the
   * AI driver (OccupyCombatSystem) so both go through one code path.
   * Returns true if a building was placed.
   */
  buildForSide(side: Owner, col: number, row: number): boolean {
    if (!this.gameActive) return false;
    if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return false;

    const idx = tileIndex(col, row);

    if (this.tileOwnership[idx] !== side) return false;
    if (this.tileBuildings[idx] !== BuildingType.None.toString()) return false;

    const explored = side === Owner.Player ? this.playerExplored : this.aiExplored;
    if (explored[idx] !== '1') return false;

    // Read tile type from the runtime random assignment
    const tileChar = this.tileTypes[idx] || getTileType(col, row);

    // Determine cost
    let cost: number;
    if (tileChar === TileType.BaseNeighbor) cost = BUILD_COST_NEIGHBOR;
    else if (tileChar === TileType.Mystery) cost = BUILD_COST_MYSTERY;
    else cost = BUILD_COST_NORMAL;

    const coins = side === Owner.Player ? this.playerCoins : this.aiCoins;
    if (coins < cost) return false;

    if (side === Owner.Player) this.playerCoins -= cost;
    else this.aiCoins -= cost;

    // Handle Mystery tile: 70% chance barracks, 30% chance empty (partial refund)
    if (tileChar === TileType.Mystery) {
      const resolved = Math.random() < 0.7;
      if (!resolved) {
        // Empty result - refund 50% of cost
        const refund = Math.floor(cost * 0.5);
        if (side === Owner.Player) this.playerCoins += refund;
        else this.aiCoins += refund;
        // Mark mystery tile as resolved empty (change '?' to 'E' so it can't be built again)
        const typesArr = this.tileTypes.split('');
        typesArr[idx] = 'E';
        this.tileTypes = typesArr.join('');
        console.log(`[HexGameManager] ${side} Mystery tile at (${col}, ${row}) resolved: EMPTY, refund ${refund}`);
        return true;
      }
      // Resolved as barracks
      const typesArr = this.tileTypes.split('');
      typesArr[idx] = 'B';
      this.tileTypes = typesArr.join('');
      console.log(`[HexGameManager] ${side} Mystery tile at (${col}, ${row}) resolved: BARRACKS`);
    }

    const buildingType = getBuildingTypeForTile(tileChar === TileType.Mystery ? TileType.Barracks : tileChar);

    const buildingsArr = this.tileBuildings.split('');
    buildingsArr[idx] = buildingType.toString();
    this.tileBuildings = buildingsArr.join('');

    console.log(`[HexGameManager] ${side} built ${BuildingType[buildingType]} at (${col}, ${row}), cost: ${cost}`);

    // Recalculate exploration for the building side (reveals neighbors)
    if (side === Owner.Player) {
      this.playerExplored = this.computeExploration(Owner.Player, this.tileBuildings, this.tileOwnership);
    } else {
      this.aiExplored = this.computeExploration(Owner.AI, this.tileBuildings, this.tileOwnership);
    }
    this.recalculateScores();
    return true;
  }
}
