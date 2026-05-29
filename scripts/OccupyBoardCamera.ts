/**
 * OccupyBoardCamera - Fixed top-down camera for the hex board.
 * Positioned above board center looking straight down.
 * Only activates when game state enters Playing.
 *
 * Component Attachment: Scene entity in space.hstf (dedicated camera entity)
 * Component Networking: Local (camera is client-only)
 * Component Ownership: Not Networked
 */

import {
  CameraComponent,
  CameraMode,
  CameraService,
  Component,
  ExecuteOn,
  NetworkingService,
  OnEntityStartEvent,
  Quaternion,
  TransformComponent,
  Vec3,
  component,
  property,
  subscribe,
} from 'meta/worlds';
import type {Maybe} from 'meta/worlds';

import {
  GameState,
  OnGameStateChangedLocal,
  GameStateChangedLocalPayload,
} from './GameStateComponent';

@component()
export class OccupyBoardCamera extends Component {
  /** Height above the board center */
  @property()
  cameraHeight: number = 14;

  private cameraActivated: boolean = false;

  @subscribe(OnEntityStartEvent, {execution: ExecuteOn.Everywhere})
  onStart(): void {
    if (NetworkingService.get().isServerContext()) return;
    console.log('[OccupyBoardCamera] Ready - waiting for match to start');
  }

  @subscribe(OnGameStateChangedLocal, {execution: ExecuteOn.Everywhere})
  onGameStateChanged(payload: GameStateChangedLocalPayload): void {
    if (NetworkingService.get().isServerContext()) return;

    const shouldActivate = payload.newState === GameState.Playing || payload.newState === GameState.GameOver;

    if (shouldActivate && !this.cameraActivated) {
      this.activateCamera();
    } else if (!shouldActivate && this.cameraActivated) {
      this.deactivateCamera();
    }
  }

  private activateCamera(): void {
    console.log('[OccupyBoardCamera] Activating board camera');

    const transform = this.entity.getComponent(TransformComponent);
    if (transform) {
      // Position above board center
      transform.worldPosition = new Vec3(0, this.cameraHeight, 0);
      // Look straight down: rotate -90 around X axis
      transform.worldRotation = Quaternion.fromEuler(new Vec3(-90, 0, 0));
    }

    const cameraComponent = this.entity.getComponent(CameraComponent);
    if (cameraComponent) {
      CameraService.get().setActiveCamera({camera: cameraComponent});
    }

    this.cameraActivated = true;
  }

  private deactivateCamera(): void {
    console.log('[OccupyBoardCamera] Deactivating board camera (returning to lobby)');
    // Reset to default camera mode
    CameraService.get().setCameraMode(CameraMode.ThirdPerson, {duration: 0.5});
    this.cameraActivated = false;
  }
}
