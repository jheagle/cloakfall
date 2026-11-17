# Epic: player-perspective layout (CLOA-6)

Every mode is played from the player's own point of view, phone first. Only the essentials show on their own;
everything else is one tap away and can be hidden again.

Why now: the first real two-person game (2026-11-14, phone vs laptop) showed the phone layout doesn't work. Online
with 2 humans + 2 robots, a 390 px wide phone shows your own small board and then three full-width target boards
stacked: about 1,650 px of scrolling on an 844 px screen, so you scroll to find the board you want to fire at.

## Decisions (user)

- **Only essential things are shown automatically; everything else can be hidden** (2026-11-12).
- **Opponents' boards: one at a time** on a phone (2026-11-17). The main area shows one opponent's board, full width
  (a 10x10 board at ~32 px cells is about what a 390 px phone fits, and what a thumb can hit). The stats bar lists
  every player; tap an opponent to switch to their board. Wide screens show every target side by side instead.
- **Your own board goes in a drawer** that slides in and out (on a phone it's never on screen next to a target).
- **Wide screens: your own board is apart from the opponents' boards** (2026-11-17): docked in a column of its own,
  not in the same group.
- **"Show my ships" and "sensor scan" are in-game options** in the player's control panel, not pre-game settings
  (2026-11-12).
- **Restart is a game-menu option for every player**; in online games it is the host's (2026-11-12).
- **Local multiplayer: a turn banner**; the turn countdown is an opt-in game-menu option (2026-11-12, Q1).
- **Robot speed needs the configurable timings first** (CLOA-8).
- **Your own controls work on any turn** (2026-11-17, CLOA-14): the lobby lets a player use anything inside their
  own `PLAYER_CONTROLS_CLASS` area at any time and nobody else ever. The control panel and the game menu build on
  that, and anything they need to change on the server goes through the same rule.

## Scope

In: the in-game screen for every mode (single player, local multiplayer, robots only, online), the pre-game screens
named in the slices below, phone first with a wide-screen layout, keyboard and screen-reader access for every new
control (drawer, tabs, menus).

Out: see "Out of scope" below. New game rules (Armada, races, abilities) come after this epic.

## Layout (phone)

```
┌──────────────────────┐
│ turn banner          │  slice 5: whose turn, countdown when on
│                      │
│  selected opponent's │  one target at a time (wide screens: all)
│  board, full width   │
│                      │
├──────────────────────┤
│ [Guest 100%][P3 82%] │  stats bar, fixed: tap an opponent to view
│ [P4 64%] [◧ me] [☰]  │  ◧ own-board drawer, ☰ controls + menu
└──────────────────────┘
```

## Work Split

Order: the stats bar and the drawer first (they fix the phone), then the rest. Slices 1 and 2 are small, clear and
testable, and stay reserved for the role-based agents (task-manager queue) unless they fit naturally. The layout
slices need a human visual review: screenshots at phone and desktop widths in every PR.

- [x] **4a. Stats bar + one target at a time.** (#186) Fixed bar at the bottom: every player's name, colour, % left and
  turn marker; tapping an opponent shows their board in the main area (the attacker's current choice is kept per
  viewer; the first target is the next one alive). Wide screens: all targets side by side, the bar still shows
  stats. Replaces the per-board stats lists on the phone. Skill: ui/css + logic. (notes [3][6])
- [x] **4b. Own-board drawer.** (#187) Your own board (and your fleet list) slides in from the side or bottom and out
  again; closed by default on a phone; on wide screens docked in a column of its own, apart from the opponents. Local multiplayer: closed at the start of every turn
  (players never see each other's placement by accident). Skill: ui/css. (notes [3][6])
- [x] **3. Highlight only the current attacker; drop the coloured board borders.** (#188) Removes the robots'
  `displayTargets`/`resetTargets` border painting (most of the ~2,400 style writes per shot measured in the treeloom
  work, so faster too). Also makes the sensor-scan heat map show only to the player who turned it on (today
  everyone sees it during that player's turn; public information only, found in CLOA-14). Skill: ui + logic. (notes [2])
- [x] **4c. Player control panel.** (#189) Opens from the bar: "Sensor scan" (when the game's hint setting is optional)
  and "Show my ships" (where it applies). Inside `PLAYER_CONTROLS_CLASS`, so it works on any turn in online games.
  Skill: ui. (notes [3])
- [ ] **4d. Game menu.** Quit (to the main menu), Restart (every player; host only online), Return to lobby (online
  only). Confirm before Quit/Restart. Home for 5's countdown option and 7's robot speed. Skill: ui + logic. (notes [3])
  - Split (2026-11-17): **4d-1** the "Game" section: local Restart + Quit, online Leave (everyone; for the host it
    ends the game for everyone, as leaving does today). **4d-2** online Restart and Return to lobby for the host:
    the server has no mid-game "end and go back to the waiting room" or restart yet (startGame refuses while a game
    runs).
- [ ] **5. Turn banner (local multiplayer first).** Slides across the top: whose turn, "waiting for [player] to
  attack", and the countdown when the game-menu option is on (local games have no turn timer today; online has
  20 s). Sensor scan moves off the board into the turn's controls. Skill: ui + logic. (notes [5])
- [ ] **6. Show which board got hit before the view switches.** A short pause on the struck cell and board, then
  the perspective changes. Replaces what the coloured borders used to show. Skill: ui + logic. (notes [8])
- [ ] **1. Drop the sensor-scan option from the single-player and robots-only pre-game screens** (agent). It lives
  in the control panel (4c); robots-only has no human, so no hints. Skill: ui. (notes [1])
- [ ] **2. Turn-order screen: names only** (agent). "All players are ready, choose who goes first": no sensor-scan
  checkbox, no game stats. Skill: ui. (notes [4])
- [ ] **7. Robot speed in the game menu.** Shown when the game has robots; host only online; hidden in local games
  without robots. Blocked by CLOA-8 (configurable timings). Skill: logic + ui. (notes [7])

## Open questions (suggested defaults; change them here before the slice starts)

- **4a: during someone else's turn**, does the main area stay on the board you chose, or follow the action (show
  the board being fired at)? Suggested: follow the action, and go back to your choice when your turn starts. Slice 6
  covers the moment of the hit.
- **4b: drawer from the side or from the bottom?** Suggested: from the side on phones, so the stats bar stays put.
- **4c: "Show my ships"** (decided 2026-11-17, the suggested default): your ships always show on your own board (it's
  in the drawer, so nobody sees it by accident), and the option goes away; local multiplayer keeps hiding them until
  you open your drawer on your own turn.
- **4c/4d: one ☰ button with two sections** (decided 2026-11-17): "My controls" then "Game".

## Out of scope (found along the way)

- **Main menu / lobby on a phone**: the lobby form sits on top of the intro's robot demo boards and is hard to read
  (labels over the boards, fields overflowing the width). Separate task.
- **Lobby sharing** (copy link, QR code, native share): CLOA-13.
- **The game on its own URL** (cloakfall.joshuaheagle.com): CLOA-12.
