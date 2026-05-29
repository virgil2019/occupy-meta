/**
 * OccupyResultScreen - Match result screen (Victory/Defeat/Draw).
 * Shows after match ends, with a button to return to lobby.
 *
 * Component Attachment: Dedicated ResultUI entity in space.hstf
 * Component Networking: Local (UI is client-only)
 * Component Ownership: Not Networked
 */

import {
  Component,
  EventService,
  ExecuteOn,
  NetworkEvent,
  NetworkingService,
  OnEntityStartEvent,
  component,
  property,
  serializable,
  subscribe,
} from 'meta/worlds';
import type { Maybe } from 'meta/worlds';
import {CustomUiComponent, UiEvent, UiViewModel, uiViewModel} from 'meta/custom_ui';

import {
  ChangeGameStateEvent,
  GameState,
  OnGameStateChangedLocal,
  GameStateChangedLocalPayload,
} from './GameStateComponent';

// --- Events ---

@serializable()
export class OccupyShowResultPayload {
  @property()
  readonly won: boolean = false;

  @property()
  readonly isDraw: boolean = false;

  @property()
  readonly playerScore: number = 0;

  @property()
  readonly aiScore: number = 0;
}

/** Network event to show the result screen (sent from server to all clients) */
export const OccupyShowResultEvent = new NetworkEvent(
  'OccupyGame-ShowResult',
  OccupyShowResultPayload
);

// Module-level UiEvent
const onReturnToLobby = new UiEvent('OccupyResult-onReturnToLobby');

@uiViewModel()
export class OccupyResultViewModel extends UiViewModel {
  resultTitle: string = '';
  resultColor: string = '#FFFFFFFF';
  scoreDisplay: string = '';
  territoryDisplay: string = '';

  readonly events = {
    onReturnToLobby,
  };
}

@component()
export class OccupyResultScreen extends Component {
  private viewModel = new OccupyResultViewModel();
  private uiComponent: Maybe<CustomUiComponent> = null;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (NetworkingService.get().isServerContext()) return;

    this.uiComponent = this.entity.getComponent(CustomUiComponent);
    if (this.uiComponent) {
      this.uiComponent.dataContext = this.viewModel;
      this.uiComponent.isVisible = false;
      console.log('[OccupyResultScreen] ViewModel bound, hidden');
    }
  }

  @subscribe(OccupyShowResultEvent, {execution: ExecuteOn.Everywhere})
  onShowResult(payload: OccupyShowResultPayload): void {
    if (NetworkingService.get().isServerContext()) return;

    console.log(`[OccupyResultScreen] Showing result: won=${payload.won}, draw=${payload.isDraw}`);

    if (payload.isDraw) {
      this.viewModel.resultTitle = 'DRAW';
      this.viewModel.resultColor = '#FFFFCC00';
    } else if (payload.won) {
      this.viewModel.resultTitle = 'VICTORY!';
      this.viewModel.resultColor = '#FF44FF88';
    } else {
      this.viewModel.resultTitle = 'DEFEAT';
      this.viewModel.resultColor = '#FFFF4444';
    }

    this.viewModel.scoreDisplay = `Territory: ${payload.playerScore} vs ${payload.aiScore}`;
    this.viewModel.territoryDisplay = payload.won ? 'You dominated the board!' : 'Better luck next time!';

    if (this.uiComponent) {
      this.uiComponent.isVisible = true;
    }
  }

  @subscribe(onReturnToLobby)
  onReturnToLobbyClicked(): void {
    console.log('[OccupyResultScreen] Return to lobby clicked');
    if (this.uiComponent) {
      this.uiComponent.isVisible = false;
    }
    EventService.sendGlobally(ChangeGameStateEvent, {toState: GameState.MainMenu});
  }

  @subscribe(OnGameStateChangedLocal, {execution: ExecuteOn.Everywhere})
  onGameStateChanged(payload: GameStateChangedLocalPayload): void {
    if (NetworkingService.get().isServerContext()) return;
    // Hide when going back to lobby
    if (payload.newState === GameState.MainMenu && this.uiComponent) {
      this.uiComponent.isVisible = false;
    }
  }
}
