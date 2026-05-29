/**
 * OccupyHudController - ViewModel for the in-match HUD.
 * Displays timer, coins, territory score, and base HP.
 * Only visible during Playing state.
 *
 * Component Attachment: Dedicated HUD entity (child of scene)
 * Component Networking: Local (UI is client-only)
 * Component Ownership: Not Networked
 */

import {
  Component,
  EntityService,
  ExecuteOn,
  NetworkingService,
  OnEntityStartEvent,
  OnWorldUpdateEvent,
  type OnWorldUpdateEventPayload,
  component,
  subscribe,
} from 'meta/worlds';
import type {Maybe} from 'meta/worlds';
import {CustomUiComponent, UiViewModel, uiViewModel} from 'meta/custom_ui';

import {HexGameManager} from './HexGameManager';
import {
  GameState,
  OnGameStateChangedLocal,
  GameStateChangedLocalPayload,
} from './GameStateComponent';

@uiViewModel()
export class OccupyHudViewModel extends UiViewModel {
  timerText: string = '3:00';
  coinText: string = '100';
  scoreText: string = '54 : 54';
  playerHPText: string = '500 / 500';
  aiHPText: string = '500 / 500';
  mineCountText: string = '0';
}

@component()
export class OccupyHudController extends Component {
  private viewModel = new OccupyHudViewModel();
  private gameManager: Maybe<HexGameManager> = null;
  private updateCooldown: number = 0;
  private uiComponent: Maybe<CustomUiComponent> = null;
  private hudVisible: boolean = false;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (NetworkingService.get().isServerContext()) return;

    this.uiComponent = this.entity.getComponent(CustomUiComponent);
    if (this.uiComponent) {
      this.uiComponent.dataContext = this.viewModel;
      // Start hidden - only show during match
      this.uiComponent.isVisible = false;
      console.log('[OccupyHudController] ViewModel bound, hidden until match');
    }
  }

  @subscribe(OnGameStateChangedLocal, {execution: ExecuteOn.Everywhere})
  onGameStateChanged(payload: GameStateChangedLocalPayload): void {
    if (NetworkingService.get().isServerContext()) return;

    const shouldShow = payload.newState === GameState.Playing;
    this.hudVisible = shouldShow;

    if (this.uiComponent) {
      this.uiComponent.isVisible = shouldShow;
    }
    console.log(`[OccupyHudController] HUD ${shouldShow ? 'shown' : 'hidden'}`);
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Everywhere})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (NetworkingService.get().isServerContext()) return;
    if (!this.hudVisible) return;

    // Throttle UI updates to ~5fps
    this.updateCooldown -= payload.deltaTime;
    if (this.updateCooldown > 0) return;
    this.updateCooldown = 0.2;

    // Find game manager
    if (!this.gameManager) {
      const managers = EntityService.findEntitiesWithComponent(HexGameManager);
      if (managers.length > 0) {
        this.gameManager = managers[0].getComponent(HexGameManager);
      }
      if (!this.gameManager) return;
    }

    const gm = this.gameManager;

    // Update timer
    const totalSeconds = Math.max(0, Math.floor(gm.timer));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    this.viewModel.timerText = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    // Update coins
    this.viewModel.coinText = Math.floor(gm.playerCoins).toString();

    // Update score
    this.viewModel.scoreText = `${gm.playerScore} : ${gm.aiScore}`;

    // Update HP
    this.viewModel.playerHPText = `${gm.playerBaseHP} / 500`;
    this.viewModel.aiHPText = `${gm.aiBaseHP} / 500`;
  }
}
