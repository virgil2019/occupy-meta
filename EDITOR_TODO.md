# Editor-side manual actions

Things that cannot be done from code and must be done by hand inside Meta Horizon Studio.
Code changes on branch `fix/core-gameplay-and-ui-lifecycle` rely on these.

## Status legend
- [ ] pending — needs manual action in editor
- [x] done

---

## Script sync
- [ ] After pulling this branch, open the project in Horizon Studio so it re-transpiles the edited/new scripts (`HexGameManager.ts`, `OccupyCombatSystem.ts`, `BoardRenderer.ts`, `OccupyLobbyScreen.ts`, and the new `progression.ts`). No new components were added, so no new attachments are required.
- [ ] Confirm the `HexBoardRenderer` component (on the player entity) still has its `tileTemplate` and `markerTemplate` properties assigned. The board is now pre-spawned at component start, so if these bindings are empty the board won't appear at all (log: `No tileTemplate assigned - cannot spawn tiles`).
- [ ] `progression.ts` is a plain module (no component) — it just needs to exist in the scripts folder so `OccupyLobbyScreen` can import it. No attachment.

## Meta UI — XAML binding to verify (`ui/OccupyLobby.xaml`)
The 4 "Upgrade" buttons and 4 chest slots were changed from static `Border`s into
`Button`s bound to `events.onUpgradeCard1..4` / `events.onChest1..4`. The chest
`TextBlock` text binds (`{Binding Path=chestNText}`) **inside a Button
ControlTemplate**.
- [ ] Verify the chest slots still show their text (Empty / countdown / "Ready!") after templating. If they render blank, the in-template `DataContext` isn't inheriting — tell me and I'll switch those to `Button.Content` + a `ContentPresenter` template instead.
- [ ] Verify tapping Upgrade / chest buttons fires (watch console: `Upgraded ...`, `Claimed chest ...`).

## Verification checklist (run one match in Studio)
- [ ] Build a barracks on a player tile → it spawns units within ~5s (mid-game builds now work).
- [ ] Build a tower → it shoots nearby enemies.
- [ ] AI side expands on its own (its tiles gain buildings, AI units appear and push toward you).
- [ ] HUD territory score (`X : Y`) changes in real time as tiles are captured.
- [ ] Match ends exactly once (single result screen) on base death OR timer hitting 0:00 — no double popup.
- [ ] Lobby/home screen shows NO 3D board or unit markers behind it (before first match AND after returning from a match).
- [ ] Pressing "Start" shows the board near-instantly (no long spawn delay).
- [ ] In lobby (and during a match) there is no movement joystick / first-person avatar control; input is tap-only.
- [ ] Card upgrades work: tap Upgrade → level rises, gold/shards drop (starts at 5000 gold, 200 shards/card so it's immediately testable).
- [ ] Card level affects the match: upgrade e.g. Spearman to Lv4, start a match, your spearmen are visibly tankier/stronger than the AI's. (AI is fixed Lv1 by design.)
- [ ] Chest loop: after a match a chest appears → tap to start its 10-min countdown → (it won't finish quickly; to sanity-check the "ready/claim" path you can temporarily lower `CHEST_DURATION_MS` in `progression.ts`).
- [ ] Meta is session-only by design — gold/levels/chests reset when the world reloads. (Persistence was deferred.)

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

**CHOSEN APPROACH: A — Editor Player Settings (no code).**

- **[ ] A. Editor Player Settings (no code).** In the desktop editor open the
  world's Player Settings panel and set avatar to hidden/none and disable
  locomotion / movement. Doc:
  `developers.meta.com/horizon-worlds/learn/documentation/desktop-editor/settings-modifications/player-settings-modification`
  - If your editor version doesn't expose an avatar-hide or locomotion toggle,
    tell me and we fall back to B or C.

Fallback options (only if A's toggles don't exist in your editor version):
- **B. Avatar Pose Gizmo (v214+)** — seat the player with "allow exit" disabled
  so the joystick can't move them; combine with hiding the avatar.
- **C. Code via `meta/worlds` player API** — a small component on the player
  entity that hides the avatar + zeroes locomotion on spawn. Would need the
  exact `meta/worlds` API names for avatar scale/visibility and locomotion speed
  (classic `horizon/core` equivalents: `player.avatarScale.set(0)`,
  `player.locomotionSpeed.set(0)`, `PlayerControls.disableSystemControls()`).

**Note:** even with the avatar hidden, the joystick widget may remain unless
locomotion is actually disabled (Player Settings / Focused Interaction / Pose
Gizmo). Verify in-editor that the joystick is gone on the home screen.
