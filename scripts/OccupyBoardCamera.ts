/**
 * OccupyBoardCamera - Fixed angled camera for the hex board.
 * Positioned above and slightly south of board center, tilted down so the
 * board has a perspective (near-large/far-small) look instead of pure top-down.
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
  /** Height (Y) of the camera above world Y=0. */
  @property()
  cameraHeight: number = 10;

  /** Z offset behind the board center (camera sits at +Z, looks toward -Z and -Y). */
  @property()
  cameraOffsetZ: number = 8;

  /** Tilt angle in degrees from horizontal. 90 = pure top-down, 45 = 3/4 view. */
  @property()
  cameraTiltDegrees: number = 45;

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
      // Position: above board center, offset +Z (south of center under the
      // tile coordinate system — low rows / player side maps to +Z).
      transform.worldPosition = new Vec3(0, this.cameraHeight, this.cameraOffsetZ);
      // Rotation: tilt down by cameraTiltDegrees. -X rotation pitches the
      // camera's +Z view direction toward -Y (looking down at the board).
      transform.worldRotation = Quaternion.fromEuler(new Vec3(-this.cameraTiltDegrees, 0, 0));
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
