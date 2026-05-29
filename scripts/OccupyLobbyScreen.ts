/**
 * OccupyLobbyScreen - Lobby/Home screen controller for Occupy Master.
 * Shows card levels, gold, chests, win rate, and start button.
 *
 * Component Attachment: Dedicated LobbyUI entity in space.hstf
 * Component Networking: Local (UI is client-only)
 * Component Ownership: Not Networked
 */

import {
  Component,
  EventService,
  ExecuteOn,
  NetworkingService,
  OnEntityStartEvent,
  component,
  subscribe,
} from 'meta/worlds';
import type {Maybe} from 'meta/worlds';
import {CustomUiComponent, UiEvent, UiViewModel, uiViewModel} from 'meta/custom_ui';

import {
  ChangeGameStateEvent,
  GameState,
  GameStateComponent,
  OnGameStateChangedLocal,
  GameStateChangedLocalPayload,
} from './GameStateComponent';

// Module-level UiEvent
const onStartBattle = new UiEvent('OccupyLobby-onStartBattle');

@uiViewModel()
export class OccupyLobbyViewModel extends UiViewModel {
  goldText: string = '0';
  card1Level: string = 'Lv1';
  card1Shards: string = '0/8';
  card2Level: string = 'Lv1';
  card2Shards: string = '0/8';
  card3Level: string = 'Lv1';
  card3Shards: string = '0/8';
  card4Level: string = 'Lv1';
  card4Shards: string = '0/8';
  chest1Text: string = 'Empty';
  chest2Text: string = 'Empty';
  chest3Text: string = 'Empty';
  chest4Text: string = 'Empty';
  winRateText: string = '0 / 0 matches';

  readonly events = {
    onStartBattle,
  };
}

@component()
export class OccupyLobbyScreen extends Component {
  private viewModel = new OccupyLobbyViewModel();
  private uiComponent: Maybe<CustomUiComponent> = null;

  // Local meta state (would be persisted in a real game)
  private gold: number = 500;
  private matchesPlayed: number = 0;
  private matchesWon: number = 0;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (NetworkingService.get().isServerContext()) return;

    this.uiComponent = this.entity.getComponent(CustomUiComponent);
    if (this.uiComponent) {
      this.uiComponent.dataContext = this.viewModel;
      console.log('[OccupyLobbyScreen] ViewModel bound');
    }

    this.updateViewModel();
  }

  @subscribe(onStartBattle)
  onStartBattleClicked(): void {
    console.log('[OccupyLobbyScreen] Start Battle clicked');
    EventService.sendGlobally(ChangeGameStateEvent, {toState: GameState.Playing});
  }

  @subscribe(OnGameStateChangedLocal, {execution: ExecuteOn.Everywhere})
  onGameStateChanged(payload: GameStateChangedLocalPayload): void {
    if (NetworkingService.get().isServerContext()) return;

    const isLobby = payload.newState === GameState.MainMenu;
    if (this.uiComponent) {
      this.uiComponent.isVisible = isLobby;
    }

    if (isLobby) {
      this.updateViewModel();
      console.log('[OccupyLobbyScreen] Showing lobby');
    }
  }

  /** Record match result (called externally via local event) */
  public recordMatchResult(won: boolean): void {
    this.matchesPlayed++;
    if (won) this.matchesWon++;
    // Award gold for playing
    this.gold += won ? 50 : 20;
    this.updateViewModel();
  }

  private updateViewModel(): void {
    this.viewModel.goldText = this.gold.toString();
    this.viewModel.winRateText = `${this.matchesWon} / ${this.matchesPlayed} matches`;
    // Card levels are placeholder for now (would come from persistence)
    this.viewModel.card1Level = 'Lv1';
    this.viewModel.card1Shards = '3/8';
    this.viewModel.card2Level = 'Lv1';
    this.viewModel.card2Shards = '1/8';
    this.viewModel.card3Level = 'Lv1';
    this.viewModel.card3Shards = '5/8';
    this.viewModel.card4Level = 'Lv1';
    this.viewModel.card4Shards = '2/8';
  }
}
