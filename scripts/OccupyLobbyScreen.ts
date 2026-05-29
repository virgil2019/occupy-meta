/**
 * OccupyLobbyScreen - Lobby/Home screen controller for Occupy Master.
 * Owns the session meta state (card levels, shards, gold, chest slots) and
 * drives the home UI: card upgrades, chest slots, win rate, start button.
 *
 * Meta is session-only (resets on world reload) — see scripts/progression.ts.
 *
 * Component Attachment: Dedicated LobbyUI entity in space.hstf
 * Component Networking: Local (UI is client-only)
 * Component Ownership: Not Networked
 */

import {
  Component,
  EntityService,
  EventService,
  ExecuteOn,
  NetworkingService,
  OnEntityStartEvent,
  OnWorldUpdateEvent,
  type OnWorldUpdateEventPayload,
  component,
  subscribe,
} from 'meta/worlds';
import type {Maybe} from 'meta/worlds';
import {CustomUiComponent, UiEvent, UiViewModel, uiViewModel} from 'meta/custom_ui';

import {
  ChangeGameStateEvent,
  GameState,
  OnGameStateChangedLocal,
  GameStateChangedLocalPayload,
} from './GameStateComponent';
import {HexGameManager} from './HexGameManager';
import {OccupyShowResultEvent, OccupyShowResultPayload} from './OccupyResultScreen';
import {
  CardId,
  MAX_LEVEL,
  MetaState,
  UPGRADE_COST,
  awardChest,
  claimChest,
  defaultMeta,
  recordMatchResult,
  startUnlockingChest,
  tickChestSlots,
  upgradeCard,
} from './progression';

// Card slot order in the lobby UI (matches OccupyLobby.xaml card1..card4).
const CARD_ORDER: CardId[] = ['spearman', 'archer', 'tower', 'mine'];

// Module-level UiEvents (bound from OccupyLobby.xaml via events.<name>).
const onStartBattle = new UiEvent('OccupyLobby-onStartBattle');
const onUpgradeCard1 = new UiEvent('OccupyLobby-onUpgradeCard1');
const onUpgradeCard2 = new UiEvent('OccupyLobby-onUpgradeCard2');
const onUpgradeCard3 = new UiEvent('OccupyLobby-onUpgradeCard3');
const onUpgradeCard4 = new UiEvent('OccupyLobby-onUpgradeCard4');
const onChest1 = new UiEvent('OccupyLobby-onChest1');
const onChest2 = new UiEvent('OccupyLobby-onChest2');
const onChest3 = new UiEvent('OccupyLobby-onChest3');
const onChest4 = new UiEvent('OccupyLobby-onChest4');

function fmtTime(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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
    onUpgradeCard1,
    onUpgradeCard2,
    onUpgradeCard3,
    onUpgradeCard4,
    onChest1,
    onChest2,
    onChest3,
    onChest4,
  };
}

@component()
export class OccupyLobbyScreen extends Component {
  private viewModel = new OccupyLobbyViewModel();
  private uiComponent: Maybe<CustomUiComponent> = null;
  private gameManager: Maybe<HexGameManager> = null;

  private meta: MetaState = defaultMeta();
  private lobbyVisible: boolean = true;
  private refreshCooldown: number = 0;

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
    // Push the player's card levels to the server before the match starts so
    // combat can scale player units. Falls back to Lv1 if the manager isn't found.
    const gm = this.findGameManager();
    if (gm) {
      gm.RpcSetCardLevels(
        this.meta.cards.spearman.level,
        this.meta.cards.archer.level,
        this.meta.cards.tower.level,
        this.meta.cards.mine.level,
      );
    }
    EventService.sendGlobally(ChangeGameStateEvent, {toState: GameState.Playing});
  }

  // ─── Upgrade handlers (one per card slot) ──────────────────────────────────
  @subscribe(onUpgradeCard1)
  onUpgrade1(): void { this.tryUpgrade(CARD_ORDER[0]); }
  @subscribe(onUpgradeCard2)
  onUpgrade2(): void { this.tryUpgrade(CARD_ORDER[1]); }
  @subscribe(onUpgradeCard3)
  onUpgrade3(): void { this.tryUpgrade(CARD_ORDER[2]); }
  @subscribe(onUpgradeCard4)
  onUpgrade4(): void { this.tryUpgrade(CARD_ORDER[3]); }

  private tryUpgrade(cardId: CardId): void {
    if (upgradeCard(this.meta, cardId)) {
      console.log(`[OccupyLobbyScreen] Upgraded ${cardId} to Lv${this.meta.cards[cardId].level}`);
    }
    this.updateViewModel();
  }

  // ─── Chest handlers (one per slot) ─────────────────────────────────────────
  @subscribe(onChest1)
  onChestTap1(): void { this.tapChest(0); }
  @subscribe(onChest2)
  onChestTap2(): void { this.tapChest(1); }
  @subscribe(onChest3)
  onChestTap3(): void { this.tapChest(2); }
  @subscribe(onChest4)
  onChestTap4(): void { this.tapChest(3); }

  private tapChest(slotIdx: number): void {
    const slot = this.meta.chestSlots[slotIdx];
    if (!slot) return;
    if (slot.status === 'locked') {
      startUnlockingChest(this.meta, slotIdx);
    } else if (slot.status === 'ready') {
      const reward = claimChest(this.meta, slotIdx, Math.random);
      if (reward) {
        console.log(`[OccupyLobbyScreen] Claimed chest: +${reward.shards} ${reward.cardId} shards`);
      }
    }
    this.updateViewModel();
  }

  @subscribe(OnGameStateChangedLocal, {execution: ExecuteOn.Everywhere})
  onGameStateChanged(payload: GameStateChangedLocalPayload): void {
    if (NetworkingService.get().isServerContext()) return;

    this.lobbyVisible = payload.newState === GameState.MainMenu;
    if (this.uiComponent) {
      this.uiComponent.isVisible = this.lobbyVisible;
    }
    if (this.lobbyVisible) {
      this.updateViewModel();
      console.log('[OccupyLobbyScreen] Showing lobby');
    }
  }

  /** Record the just-finished match + award a chest. Fired globally on match end. */
  @subscribe(OccupyShowResultEvent, {execution: ExecuteOn.Everywhere})
  onMatchResult(payload: OccupyShowResultPayload): void {
    if (NetworkingService.get().isServerContext()) return;
    recordMatchResult(this.meta, payload.won);
    awardChest(this.meta);
    this.updateViewModel();
  }

  @subscribe(OnWorldUpdateEvent, {execution: ExecuteOn.Everywhere})
  onUpdate(payload: OnWorldUpdateEventPayload): void {
    if (NetworkingService.get().isServerContext()) return;

    // Advance chest countdowns (only 'unlocking' slots move).
    tickChestSlots(this.meta, payload.deltaTime * 1000);

    // Refresh the chest timer display ~4x/sec while the lobby is visible.
    if (!this.lobbyVisible) return;
    this.refreshCooldown -= payload.deltaTime;
    if (this.refreshCooldown > 0) return;
    this.refreshCooldown = 0.25;
    this.updateViewModel();
  }

  private findGameManager(): Maybe<HexGameManager> {
    if (this.gameManager) return this.gameManager;
    const managers = EntityService.findEntitiesWithComponent(HexGameManager);
    if (managers.length > 0) {
      this.gameManager = managers[0].getComponent(HexGameManager);
    }
    return this.gameManager;
  }

  private chestLabel(slotIdx: number): string {
    const slot = this.meta.chestSlots[slotIdx];
    if (!slot) return 'Empty';
    if (slot.status === 'locked') return 'Tap to\nopen';
    if (slot.status === 'ready') return 'Ready!\nClaim';
    return fmtTime(slot.remainingMs);
  }

  private shardLabel(cardId: CardId): string {
    const card = this.meta.cards[cardId];
    if (card.level >= MAX_LEVEL) return 'MAX';
    const cost = UPGRADE_COST[card.level - 1];
    return `${card.shards}/${cost.shards}`;
  }

  private updateViewModel(): void {
    const vm = this.viewModel;
    vm.goldText = this.meta.gold.toString();

    vm.card1Level = `Lv${this.meta.cards[CARD_ORDER[0]].level}`;
    vm.card2Level = `Lv${this.meta.cards[CARD_ORDER[1]].level}`;
    vm.card3Level = `Lv${this.meta.cards[CARD_ORDER[2]].level}`;
    vm.card4Level = `Lv${this.meta.cards[CARD_ORDER[3]].level}`;

    vm.card1Shards = this.shardLabel(CARD_ORDER[0]);
    vm.card2Shards = this.shardLabel(CARD_ORDER[1]);
    vm.card3Shards = this.shardLabel(CARD_ORDER[2]);
    vm.card4Shards = this.shardLabel(CARD_ORDER[3]);

    vm.chest1Text = this.chestLabel(0);
    vm.chest2Text = this.chestLabel(1);
    vm.chest3Text = this.chestLabel(2);
    vm.chest4Text = this.chestLabel(3);

    vm.winRateText = `${this.meta.matchesWon} / ${this.meta.matchesPlayed} matches`;
  }
}
