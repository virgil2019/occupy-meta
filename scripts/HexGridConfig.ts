/**
 * HexGridConfig - Contains all hex grid constants, map layout, and utility functions
 * for the Occupy Master (占城大师) strategy game.
 *
 * This is a pure data/utility module - no components, no side effects.
 */

// ─── Hex Grid Constants ───────────────────────────────────────────────────────
export const GRID_COLS = 9;
export const GRID_ROWS = 12;
export const TOTAL_TILES = GRID_COLS * GRID_ROWS; // 108

// Hex sizing (flat-top hexes, odd-r offset)
export const HEX_WIDTH = 1.2;
export const HEX_HEIGHT = HEX_WIDTH * 0.866; // √3/2 * W

// Board centering offset (so board center is at world origin)
// Even rows: x ranges [0, 8*W] = [0, 9.6], center = 4.8
// Odd rows: x ranges [W/2, 8*W + W/2] = [0.6, 10.2], center = 5.4
// Average x center ≈ 5.1; z center = 11 * H / 2 ≈ 5.72
export const BOARD_OFFSET_X = 5.1;
export const BOARD_OFFSET_Z = (GRID_ROWS - 1) * HEX_HEIGHT / 2;

// ─── Tile Types ───────────────────────────────────────────────────────────────
export enum TileType {
  Barracks = 'B',
  Tower = 'T',
  Mine = 'M',
  Mystery = '?',
  Base = '#',
}

// ─── Building Types ───────────────────────────────────────────────────────────
export enum BuildingType {
  None = 0,
  Barracks = 1,
  Tower = 2,
  Mine = 3,
  Base = 4,
  /** A destroyed building's remains. Blocks normal "build on empty tile" only by
   *  signaling that this tile WAS built; buildForSide treats Ruin as buildable. */
  Ruin = 5,
}

// ─── Ownership ────────────────────────────────────────────────────────────────
export enum Owner {
  Neutral = 'N',
  Player = 'P',
  AI = 'A',
}

// ─── Economy Constants ────────────────────────────────────────────────────────
export const STARTING_COINS = 100;
export const BASE_COIN_RATE = 6;        // coins per tick
export const BASE_COIN_INTERVAL = 3.0;  // seconds
export const MINE_COIN_RATE = 10;       // coins per tick
export const MINE_COIN_INTERVAL = 2.0;  // seconds
export const BUILD_COST_NORMAL = 50;

// ─── HP Constants ─────────────────────────────────────────────────────────────
export const BASE_HP = 500;

// ─── Combat Constants ───────────────────────────────────────────────────────────
export const TICK_MS = 100;
export const STUCK_THRESHOLD_MS = 3000;
export const BLACKLIST_DURATION_MS = 2000;
export const BASE_BARRACKS_INTERVAL_MS = 5000;
export const MATCH_DURATION_MS = 180000; // 3 minutes

// Unit stats: [hp, atk, range, moveSpeed (tiles/sec), attackSpeed (atk/sec)]
export const UNIT_STATS: Record<string, {hp: number; atk: number; range: number; moveSpeed: number; attackSpeed: number}> = {
  spearman: {hp: 50, atk: 8, range: 1, moveSpeed: 1.0, attackSpeed: 1.0},
  archer: {hp: 30, atk: 6, range: 3, moveSpeed: 0.8, attackSpeed: 1.0},
  tower: {hp: 80, atk: 12, range: 4, moveSpeed: 0, attackSpeed: 0.7},
  mine: {hp: 40, atk: 0, range: 0, moveSpeed: 0, attackSpeed: 0},
  barracks: {hp: 100, atk: 0, range: 0, moveSpeed: 0, attackSpeed: 0},
  base: {hp: 500, atk: 10, range: 2, moveSpeed: 0, attackSpeed: 1.0},
  /** Inert remains. combat code skips it (no targeting, no death-cleanup),
   *  but use a large hp sentinel so any future "AoE damages all buildings"
   *  effect doesn't accidentally 1-shot ruins. */
  ruin: {hp: 999999, atk: 0, range: 0, moveSpeed: 0, attackSpeed: 0},
};

export type EntityKind = 'spearman' | 'archer' | 'tower' | 'mine' | 'barracks' | 'base' | 'ruin';

// Level multipliers (index = level - 1)
export const LEVEL_MULT = [1.0, 1.2, 1.5, 2.0];

// ─── Hex Distance (cube coordinate conversion) ─────────────────────────────────

export function offsetToCube(col: number, row: number): {x: number; y: number; z: number} {
  const x = col - ((row - (row & 1)) >> 1);
  const z = row;
  const y = -x - z;
  return {x, y, z};
}

export function hexDistance(aCol: number, aRow: number, bCol: number, bRow: number): number {
  const ac = offsetToCube(aCol, aRow);
  const bc = offsetToCube(bCol, bRow);
  return (Math.abs(ac.x - bc.x) + Math.abs(ac.y - bc.y) + Math.abs(ac.z - bc.z)) / 2;
}

// ─── Timer ────────────────────────────────────────────────────────────────────
export const GAME_DURATION = 180; // 3 minutes in seconds

// ─── Player/AI Base Positions ─────────────────────────────────────────────────
export const PLAYER_BASE_COL = 4;
export const PLAYER_BASE_ROW = 1;
export const AI_BASE_COL = 4;
export const AI_BASE_ROW = 10;

// ─── Map Layout (12 rows × 9 cols, row 0 = bottom) ───────────────────────────
// Each string is 9 characters representing tile types for that row
// Only '#' (base) is positional; every other character is overwritten with a
// randomly-rolled tile type in initializeGameState. The non-'#' letters here
// are just placeholders to keep the layout readable.
const MAP_LAYOUT: readonly string[] = [
  'BMBTBBBTM', // Row 0 (bottom)
  'BMTB#BBMB', // Row 1 (player base)
  'TBMBBBMBT', // Row 2
  'BBTMBBMTB', // Row 3
  'MBTBBBTMB', // Row 4
  'BTBMBMBTB', // Row 5
  'BTBMBMBTB', // Row 6
  'MBTBBBTMB', // Row 7
  'BBTMBBMTB', // Row 8
  'TBMBBBMBT', // Row 9
  'BMTB#BBMB', // Row 10 (AI base)
  'BMTBBBTMB', // Row 11 (top)
];

/**
 * Get the tile type character at (col, row)
 */
export function getTileType(col: number, row: number): string {
  if (row < 0 || row >= GRID_ROWS || col < 0 || col >= GRID_COLS) return 'B';
  return MAP_LAYOUT[row][col];
}

/**
 * Convert grid (col, row) to world position (x, z), centered at origin.
 * Z is INVERTED so that low rows (player side) map to positive Z (screen bottom)
 * and high rows (AI side) map to negative Z (screen top) under the top-down camera.
 */
export function hexToWorld(col: number, row: number): {x: number; z: number} {
  const x = col * HEX_WIDTH + (row & 1) * (HEX_WIDTH / 2) - BOARD_OFFSET_X;
  const z = BOARD_OFFSET_Z - row * HEX_HEIGHT;
  return {x, z};
}

/**
 * Convert world position (x, z) back to grid (col, row)
 */
export function worldToHex(worldX: number, worldZ: number): {col: number; row: number} {
  // Undo offset (Z is inverted: z_world = BOARD_OFFSET_Z - row * HEX_HEIGHT)
  const x = worldX + BOARD_OFFSET_X;
  const z = BOARD_OFFSET_Z - worldZ;

  // Approximate row first
  const row = Math.round(z / HEX_HEIGHT);
  // Then col accounting for offset
  const col = Math.round((x - (row & 1) * (HEX_WIDTH / 2)) / HEX_WIDTH);

  return {col, row};
}

/**
 * Convert (col, row) to a linear index (0..107)
 */
export function tileIndex(col: number, row: number): number {
  return row * GRID_COLS + col;
}

/**
 * Convert linear index back to (col, row)
 */
export function indexToColRow(index: number): {col: number; row: number} {
  const row = Math.floor(index / GRID_COLS);
  const col = index % GRID_COLS;
  return {col, row};
}

/**
 * Get the 6 hex neighbors of (col, row) in odd-r offset coordinates
 */
export function getNeighbors(col: number, row: number): Array<{col: number; row: number}> {
  const isOdd = row & 1;
  const neighbors: Array<{col: number; row: number}> = [];

  // Odd-r offset: ODD rows are shifted right (matches hexToWorld / offsetToCube).
  // The two direction sets were previously swapped, offsetting every neighbour
  // by one column relative to the rendered layout.
  const directions = isOdd
    ? [
        {dc: 1, dr: 0},   // E
        {dc: 1, dr: -1},  // SE
        {dc: 0, dr: -1},  // SW
        {dc: -1, dr: 0},  // W
        {dc: 0, dr: 1},   // NW
        {dc: 1, dr: 1},   // NE
      ]
    : [
        {dc: 1, dr: 0},   // E
        {dc: 0, dr: -1},  // SE
        {dc: -1, dr: -1}, // SW
        {dc: -1, dr: 0},  // W
        {dc: -1, dr: 1},  // NW
        {dc: 0, dr: 1},   // NE
      ];

  for (const d of directions) {
    const nc = col + d.dc;
    const nr = row + d.dr;
    if (nc >= 0 && nc < GRID_COLS && nr >= 0 && nr < GRID_ROWS) {
      neighbors.push({col: nc, row: nr});
    }
  }

  return neighbors;
}

/**
 * Determine initial ownership based on row position
 */
export function getInitialOwner(row: number): Owner {
  if (row <= 5) return Owner.Player;
  return Owner.AI;
}

/**
 * Get building type from tile type character
 */
export function getBuildingTypeForTile(tileChar: string): BuildingType {
  switch (tileChar) {
    case TileType.Barracks: return BuildingType.Barracks;
    case TileType.Tower: return BuildingType.Tower;
    case TileType.Mine: return BuildingType.Mine;
    case TileType.Base: return BuildingType.Base;
    // Mystery tiles resolved at build time; default mapping is Barracks
    case TileType.Mystery: return BuildingType.Barracks;
    default: return BuildingType.Barracks;
  }
}

/** Cost for Mystery tile */
export const BUILD_COST_MYSTERY = 25;

/**
 * Get build cost for a tile
 */
export function getBuildCost(tileChar: string): number {
  if (tileChar === TileType.Mystery) return BUILD_COST_MYSTERY;
  return BUILD_COST_NORMAL;
}
