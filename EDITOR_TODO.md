# Editor-side manual actions

Things that cannot be done from code and must be done by hand inside Meta Horizon Studio.
Code changes on branch `fix/core-gameplay-and-ui-lifecycle` rely on these.

## Status legend
- [ ] pending — needs manual action in editor
- [x] done

---

## Script sync
- [ ] After pulling this branch, open the project in Horizon Studio so it re-transpiles the edited scripts (`HexGameManager.ts`, `OccupyCombatSystem.ts`, `BoardRenderer.ts`, `HexInputController.ts`). No new components were added, so no new attachments are required (see notes below if that changes).

## Verification checklist (run one match in Studio)
- [ ] Build a barracks on a player tile → it spawns units within ~5s (mid-game builds now work).
- [ ] Build a tower → it shoots nearby enemies.
- [ ] AI side expands on its own (its tiles gain buildings, AI units appear and push toward you).
- [ ] HUD territory score (`X : Y`) changes in real time as tiles are captured.
- [ ] Match ends exactly once (single result screen) on base death OR timer hitting 0:00 — no double popup.
- [ ] Lobby/home screen shows NO 3D board or unit markers behind it (before first match AND after returning from a match).
- [ ] Pressing "Start" shows the board near-instantly (no long spawn delay).
- [ ] In lobby (and during a match) there is no movement joystick / first-person avatar control; input is tap-only.

---

## Open items needing your input

### B1 — Remove first-person UI in the lobby (avatar + movement joystick)

**Root cause (confirmed from code + Meta docs):**
- During a match the joystick is already gone: `HexInputController` turns on
  `FocusedInteractionService.enableFocusedInteraction(...)` on `Playing`, and
  Focused Interaction mode disables locomotion entirely.
- In the **lobby** Focused Interaction is intentionally OFF (turning it on would
  swallow the "Start" button tap), and `OccupyBoardCamera` only activates on
  `Playing`. So the lobby falls back to the default first-person/third-person
  avatar view with the system movement joystick + visible avatar.
- The movement joystick is a **protected system control** — per Meta's forum it
  cannot be fully removed via TypeScript except through Focused Interaction
  (blocks UI) or the **Avatar Pose Gizmo** (v214+). The "avatar hidden (scale=0)
  + no joystick" line in `Docs/PROJECT_SUMMARY.md` was never actually
  implemented in code.

**Why this isn't fixed in code yet:** hiding the avatar / disabling locomotion
needs the `meta/worlds` desktop-editor SDK player API, whose exact names I can't
confirm from public docs and can't typecheck locally. I won't guess and ship
code that may not compile.

**Pick one approach (I can implement A or C once you confirm the API/decision):**

- **[ ] A. Editor Player Settings (no code).** In the desktop editor open the
  world's Player Settings panel and look for avatar visibility + locomotion /
  movement options; set avatar to hidden/none and disable locomotion. Doc:
  `developers.meta.com/horizon-worlds/learn/documentation/desktop-editor/settings-modifications/player-settings-modification`
  → tell me if these toggles exist in your editor version.

- **[ ] B. Avatar Pose Gizmo (v214+).** Place a pose gizmo that seats the player
  with "allow exit" disabled, so the joystick can't move them; combine with
  hiding the avatar. Mostly editor setup.

- **[ ] C. Code via meta/worlds player API.** I can write a small component on
  the player entity (fold into `HexInputController`, already on `player.hstf`)
  that on player spawn hides the avatar (e.g. avatar scale → 0) and zeroes
  locomotion speed. **I need from you:** the exact API names available in your
  editor's autocomplete under `meta/worlds` for: player avatar scale/visibility,
  and locomotion speed / disabling movement. (Classic `horizon/core` used
  `player.avatarScale.set(0)` and `player.locomotionSpeed.set(0)` + 
  `PlayerControls.disableSystemControls()` — confirm the equivalents here.)

**Note:** even with avatar hidden, the joystick widget itself may remain unless
Focused Interaction or the Pose Gizmo is used. If a hidden avatar + fixed lobby
camera is "good enough" visually for the prototype, that's the cheapest path.
