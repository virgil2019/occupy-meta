/**
 * GameStateComponent - Core state machine for game flow management
 *
 * Manages the primary game loop: MainMenu → Playing ↔ Pause → GameOver → MainMenu
 *
 * This component is the central authority for game state. All screens subscribe to
 * state change events and show/hide themselves reactively.
 *
 * Component Attachment: Scene entity (one per world, typically on a "GameManager" entity)
 * Component Networking: Networked (state synchronized across all clients)
 * Component Ownership: Server-owned (authoritative state changes)
 *
 * @module GameLoop
 */

import {
  subscribe,
  serializable,
  property,
  OnEntityStartEvent,
  OnEntityCreateEvent,
  NetworkEvent,
  LocalEvent,
  ExecuteOn,
  EventService,
  component,
  Component,
} from "meta/worlds";
import type { Maybe } from "meta/worlds";

// ============================================================================
// GAME STATE ENUM
// ============================================================================

/**
 * All possible game states.
 * Extend this enum to add custom states (e.g., LevelUp, Shop, Cutscene).
 */
export enum GameState {
  MainMenu = 'mainMenu',
  Playing = 'playing',
  Pause = 'pause',
  GameOver = 'gameOver'
}

// ============================================================================
// EVENT PAYLOADS
// ============================================================================

/**
 * Payload for local game state change events (UI updates)
 */
@serializable()
export class GameStateChangedLocalPayload {
  @property()
  readonly newState: string = '';
}

/**
 * Payload for network game state change events
 */
@serializable()
export class GameStateChangedPayload {
  @property()
  readonly newState: string = '';

  @property()
  readonly lastState: string = '';

  /**
   * Helper to detect a fresh game start (useful for resetting player state)
   */
  public isNewGameStart(): boolean {
    return this.lastState === GameState.MainMenu && this.newState === GameState.Playing;
  }
}

/**
 * Payload for requesting a state change
 */
@serializable()
export class ChangeGameStatePayload {
  @property()
  readonly toState: string = '';
}

// ============================================================================
// EVENTS
// ============================================================================

/**
 * Local event fired when game state changes.
 * Subscribe to this for client-side UI updates.
 */
export const OnGameStateChangedLocal = new LocalEvent(
  'GameLoop-OnGameStateChangedLocal',
  GameStateChangedLocalPayload
);

/**
 * Network event fired when game state changes.
 * Broadcast to all clients for synchronized state.
 */
export const OnGameStateChanged = new NetworkEvent(
  'GameLoop-OnGameStateChanged',
  GameStateChangedPayload
);

/**
 * Network event to request a state change.
 * Send this to transition between states.
 */
export const ChangeGameStateEvent = new NetworkEvent(
  'GameLoop-ChangeGameState',
  ChangeGameStatePayload
);

// ============================================================================
// GAME STATE COMPONENT
// ============================================================================

/**
 * GameStateComponent manages the game's state machine and broadcasts state changes.
 *
 * Usage:
 * - Access the singleton via `GameStateComponent.instance`
 * - Change state via `EventService.sendGlobally(ChangeGameStateEvent, { toState: GameState.Playing })`
 * - Check state via `GameStateComponent.instance?.isInState(GameState.Playing)`
 */
@component()
export class GameStateComponent extends Component {
  /** Singleton instance for easy access */
  public static instance: Maybe<GameStateComponent> = null;

  @property()
  private currentState: GameState = GameState.MainMenu;

  @property()
  private paused: boolean = true;

  @subscribe(OnEntityCreateEvent, { execution: ExecuteOn.Everywhere })
  private onCreate() {
    GameStateComponent.instance = this;
    console.log('[GameStateComponent] Instance created');
  }

  @subscribe(OnEntityStartEvent)
  private onStart() {
    // Initialize to MainMenu state and broadcast
    this.setState(GameState.MainMenu);
  }

  /**
   * Handle state change requests
   */
  @subscribe(ChangeGameStateEvent)
  onChangeGameState(payload: ChangeGameStatePayload) {
    this.setState(payload.toState as GameState);
  }

  /**
   * Rebroadcast network events as local events for UI components
   */
  @subscribe(OnGameStateChanged, { execution: ExecuteOn.Everywhere })
  onGameStateChangedRebroadcast(payload: GameStateChangedPayload) {
    EventService.sendLocally(OnGameStateChangedLocal, { newState: payload.newState });
  }

  /**
   * Changes the game state and broadcasts the change event.
   *
   * State transition guards:
   * - GameOver can ONLY transition to MainMenu (prevents invalid states)
   * - Duplicate state changes are ignored
   *
   * @param newState - The new game state to transition to
   */
  public setState(newState: GameState): void {
    if (this.currentState === newState) {
      console.warn(`[GameStateComponent] Already in state: ${newState}`);
      return;
    }

    // Guard: GameOver can only go to MainMenu
    if (this.currentState === GameState.GameOver && newState !== GameState.MainMenu) {
      console.warn(`[GameStateComponent] GameOver can only transition to MainMenu, not: ${newState}`);
      return;
    }

    const lastState = this.currentState;
    this.currentState = newState;
    this.paused = this.currentState !== GameState.Playing;

    console.log(`[GameStateComponent] State changed: ${lastState} -> ${newState}`);

    // Broadcast state change to all clients
    const payload = Object.assign(new GameStateChangedPayload(), {
      newState: newState,
      lastState: lastState
    });

    // Broadcast state change to all clients
    EventService.sendGlobally(OnGameStateChanged, payload);
  }

  /**
   * Gets the current game state
   */
  public getState(): GameState {
    return this.currentState;
  }

  /**
   * Checks if the game is currently in a specific state
   */
  public isInState(state: GameState): boolean {
    return this.currentState === state;
  }

  /**
   * Checks if the game is currently paused (any state other than Playing)
   */
  public isPaused(): boolean {
    return this.paused;
  }
}
