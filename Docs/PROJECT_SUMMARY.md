# 占城大师 (Occupy Master)

A 3D hex-grid real-time strategy game ported from a Phaser 3 prototype to Meta Horizon Worlds.

## Core Loop
- 9×12 hex board, 3-minute matches, player vs AI
- Tap tiles to build (barracks/tower/mine/question)
- Barracks produce units that auto-seek enemies
- Destroy enemy base or own more tiles to win
- Post-match: chest rewards, card upgrades (4 cards, max Lv4)

## Reference
- 抖音小游戏《占城大师》

## Milestone 1 Implementation (MHS)
- Server-owned HexGameManager holds all game state as compact 108-char property strings (ownership, buildings, exploration) synced to all clients
- Client-side HexBoardRenderer spawns 108 LocalOnly disc tiles on the player entity using staggered spawning (10 tiles/frame to prevent mobile hitches), colors them each update cycle based on server properties
- FocusedInteractionService tap input → ray-plane intersection → @rpc RpcBuildOnTile routes build requests from client to server
- Fixed top-down camera (OccupyBoardCamera) activates on OnPlayerCreateEvent, positioned at Y=cameraHeight looking straight down
- ScreenSpace HUD (OccupyHudController + OccupyHudViewModel) displays timer, coins, territory score, and base HP
- HexTile template: disc mesh + ColorComponent on Visuals child + StaticCollision physics at Templates/GameplayObjects/HexTile.hstf
- CombatMarker template: cube mesh + ColorComponent on Visuals child for rendering combat entities (units, buildings, bases) at Templates/GameplayObjects/CombatMarker.hstf
- Entity marker pool (60 max) spawned after tiles, recolored/repositioned each frame to represent combat entities
- Player avatar hidden (scale=0) and movement controls disabled (no joystick) — tap-only input

## Technical
- Tick-based sim (100ms ticks), local AI (decision every 2s)
- Dynamic fog of war based on adjacent buildings
- No PvP/multiplayer in demo scope
- Economy: base income (+6 coins/3s), mine income (+10 coins/2s per mine), initial 100 coins
- Game duration: 180 seconds (3 minutes), starting HP: 500 per base
