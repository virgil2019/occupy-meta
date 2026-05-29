/**
 * HexInputController - Client-side input handler for tap-to-build.
 * Uses FocusedInteractionService to capture taps, converts screen tap to
 * hex coordinates, and calls RPC on HexGameManager to request a build.
 *
 * Component Attachment: Player entity in player.hstf
 * Component Networking: Local (input is client-only)
 * Component Ownership: Not Networked (client-side input processing)
 *
 * Only processes input when game state is Playing.
 */

import {
  Component,
  EntityService,
  ExecuteOn,
  FocusedInteractionService,
  NetworkingService,
  OnEntityStartEvent,
  OnFocusedInteractionInputEndedEvent,
  type OnFocusedInteractionInputEventPayload,
  component,
  subscribe,
} from 'meta/worlds';
import type {Maybe} from 'meta/worlds';

import {
  GRID_COLS,
  GRID_ROWS,
  tileIndex,
  worldToHex,
} from './HexGridConfig';
import {HexGameManager} from './HexGameManager';
import {
  GameState,
  GameStateComponent,
  OnGameStateChangedLocal,
  GameStateChangedLocalPayload,
} from './GameStateComponent';

@component()
export class HexInputController extends Component {
  private gameManager: Maybe<HexGameManager> = null;
  private inputEnabled: boolean = false;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (NetworkingService.get().isServerContext()) return;
    // Do NOT enable FocusedInteraction here — it suppresses all UI touches
    // including the lobby "Start Game" button. Wait until game state is Playing.
    console.log('[HexInputController] Initialized, waiting for Playing state to enable input');
  }

  @subscribe(OnGameStateChangedLocal, {execution: ExecuteOn.Everywhere})
  onGameStateChanged(payload: GameStateChangedLocalPayload): void {
    if (NetworkingService.get().isServerContext()) return;
    this.inputEnabled = payload.newState === GameState.Playing;
    console.log(`[HexInputController] Input ${this.inputEnabled ? 'enabled' : 'disabled'}`);

    if (this.inputEnabled) {
      // Enable FocusedInteraction only during gameplay so lobby UI remains tappable.
      // disableFocusExitButton: true prevents the brief "exit" icon (Issue 2).
      FocusedInteractionService.get().enableFocusedInteraction({
        interactionStringId: 'occupy_hex_input',
        disableFocusExitButton: true,
        disableEmotesButton: true,
      });
      FocusedInteractionService.get().setTapVfxEnabled(false);
      FocusedInteractionService.get().setTrailVfxEnabled(false);
      console.log('[HexInputController] Focused interaction enabled (Playing)');
    } else {
      // Disable FocusedInteraction so UI buttons work again (e.g., result screen).
      FocusedInteractionService.get().disableFocusedInteraction();
      console.log('[HexInputController] Focused interaction disabled (not Playing)');
    }
  }

  @subscribe(OnFocusedInteractionInputEndedEvent, {execution: ExecuteOn.Everywhere})
  onTapEnd(payload: OnFocusedInteractionInputEventPayload): void {
    if (NetworkingService.get().isServerContext()) return;
    if (!this.inputEnabled) return;

    // Ray-plane intersection with Y=0
    const origin = payload.worldRayOrigin;
    const direction = payload.worldRayDirection;

    if (Math.abs(direction.y) < 0.001) return;

    const t = -origin.y / direction.y;
    if (t < 0) return;

    const worldX = origin.x + t * direction.x;
    const worldZ = origin.z + t * direction.z;

    const hex = worldToHex(worldX, worldZ);

    if (hex.col < 0 || hex.col >= GRID_COLS || hex.row < 0 || hex.row >= GRID_ROWS) {
      return;
    }

    console.log(`[HexInputController] Tap at hex (${hex.col}, ${hex.row})`);

    if (!this.gameManager) {
      const managers = EntityService.findEntitiesWithComponent(HexGameManager);
      if (managers.length > 0) {
        this.gameManager = managers[0].getComponent(HexGameManager);
      }
    }

    if (this.gameManager) {
      // Client-side fog of war check: reject taps on unexplored tiles
      const explored = this.gameManager.playerExplored;
      const idx = tileIndex(hex.col, hex.row);
      if (explored && explored.length > idx && explored[idx] !== '1') {
        console.log(`[HexInputController] Tap rejected - tile unexplored`);
        return;
      }

      this.gameManager.RpcBuildOnTile(hex.col, hex.row);
    } else {
      console.log('[HexInputController] GameManager not found!');
    }
  }
}
