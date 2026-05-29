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
  BUILD_COST_NEIGHBOR,
  BUILD_COST_NORMAL,
  BuildingType,
  GAME_DURATION,
  GRID_COLS,
  GRID_ROWS,
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
    let playerExp = '';
    let aiExp = '';

    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const tileChar = getTileType(col, row);
        const owner = getInitialOwner(row);
        ownership += owner;

        // Place base buildings
        if (tileChar === TileType.Base) {
          buildings += BuildingType.Base.toString();
        } else {
          buildings += BuildingType.None.toString();
        }

        playerExp += '0';
        aiExp += '0';
      }
    }

    this.tileOwnership = ownership;
    this.tileBuildings = buildings;

    // Calculate initial exploration based on base buildings
    playerExp = this.computeExploration(Owner.Player, buildings, ownership);
    aiExp = this.computeExploration(Owner.AI, buildings, ownership);

    this.playerExplored = playerExp;
    this.aiExplored = aiExp;

    // Calculate initial scores
    this.recalculateScores();

    console.log('[HexGameManager] Game state initialized');
  }

  private computeExploration(side: Owner, buildings: string, ownership: string): string {
    const explored = new Array(TOTAL_TILES).fill('0');

    // Native half is always fully explored for each side (per design doc:
    // "玩家自己半盘的 type 直接可见", player rows 0-5, AI rows 6-11)
    const nativeOwner = side;
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const idx = tileIndex(col, row);
        if (getInitialOwner(row) === nativeOwner) {
          explored[idx] = '1';
        }
      }
    }

    // Buildings also reveal their 6 neighbors (relevant for enemy-half expansion)
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const idx = tileIndex(col, row);
        const building = parseInt(buildings[idx]);
        const tileOwner = ownership[idx];

        if (building > 0 && tileOwner === side) {
          const neighbors = getNeighbors(col, row);
          for (const n of neighbors) {
            explored[tileIndex(n.col, n.row)] = '1';
          }
          explored[idx] = '1';
        }
      }
    }

    return explored.join('');
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
      this.playerCoins += playerMines * MINE_COIN_RATE;
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

    const tileChar = getTileType(col, row);
    const cost = tileChar === TileType.BaseNeighbor ? BUILD_COST_NEIGHBOR : BUILD_COST_NORMAL;

    const coins = side === Owner.Player ? this.playerCoins : this.aiCoins;
    if (coins < cost) return false;

    if (side === Owner.Player) this.playerCoins -= cost;
    else this.aiCoins -= cost;

    const buildingType = getBuildingTypeForTile(tileChar);

    const buildingsArr = this.tileBuildings.split('');
    buildingsArr[idx] = buildingType.toString();
    this.tileBuildings = buildingsArr.join('');

    console.log(`[HexGameManager] ${side} built ${BuildingType[buildingType]} at (${col}, ${row}), cost: ${cost}`);

    // Reveal newly-adjacent tiles for the building side.
    if (side === Owner.Player) {
      this.playerExplored = this.computeExploration(Owner.Player, this.tileBuildings, this.tileOwnership);
    } else {
      this.aiExplored = this.computeExploration(Owner.AI, this.tileBuildings, this.tileOwnership);
    }
    this.recalculateScores();
    return true;
  }
}
