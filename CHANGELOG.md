# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions follow [Semantic Versioning](https://semver.org/lang/fr/).

## [Unreleased]

### Fixed
- Builds follow every in-game item group: no more Black Cleaver with Serylda's Grudge, Lord Dominik's or Mortal Reminder, nor Terminus with another Fatality or Blight item. Mortal Reminder and Morellonomicon can now come together, as in game.
- ARAM du Chaos: several Tear items (Manamune, Archangel's Staff, Winter's Approach) can come in the same build, as in game.

## [1.2.0] - 2026-10-09

### Added
- Link previews (Discord...): room links show the room code, mode, options, players and host, with a preview image.
- Copy button on the own card: copies the build as a PNG image to paste in Discord (downloaded where copying images is not supported).

### Changed
- Line icons (SVG) instead of emojis for every button and indicator, all the same size.
- Card layout: name, champion and role stacked next to the portrait; buttons on their own bar under the header.

## [1.1.0] - 2026-10-09

### Added
- The host can kick a player, who cannot rejoin that room.
- The host can hand the host role to another player; when the host quits, the earliest online player takes it.
- Normal mode picker: big "Tout aléatoire" button (role, champion and build), then roles, then champions.
- "Aléatoire" champion tile in every mode: the champion is drawn when generating the build.
- Card buttons: ↺ regenerates with the same choices, the red bin clears them.
- Room option at creation: offer 1 to 5 builds per generation, the player keeps one.
- Room option at creation: rerolls allowed (0 to 3, or unlimited); out of rerolls, the build is final.
- Room options folded behind a one-line summary on the home page.
- Offered builds shown side by side in a window over the page.
- Locks: each player can lock their build (ready), the host can lock the whole room; "Prêts : x/y" counter.
- Data Dragon patch shown in the footer.

### Changed
- Automated tests (roll rules, room rules, browser flows) run before every release deploy.
- Game data is compacted and cached by the Worker: about 20 KB to download instead of about 1 MB.
- Random role badge shortened to "🎲 Support".

### Fixed
- Cassiopeia gets boots again: she can buy them since patch 26.01.
- Junglers always get Smite; other roles never do.
- Melee champions no longer roll Runaan's Hurricane (ranged only; range-switching champions excepted).
- A room that expired while open sends players home instead of reconnecting forever.

## [1.0.0] - 2026-10-09

### Added
- Rooms shared by code or link, synced live between players (Cloudflare Durable Objects).
- Game modes chosen at room creation: Normal, ARAM, ARAM du Chaos.
- Ultimate Bravery rolls from Data Dragon: items, runes, summoner spells, skill order.
- Normal: per-player role (including random); role items for jungle and support, an extra legendary for ADC.
- ARAM modes: select 1 to 3 offered champions, the roll picks one.
- ARAM du Chaos: no runes, augment reroll/pick instructions at levels 1, 7, 11 and 15.
- Fuzzy champion search with initials and nicknames.
- Champion-specific skill orders: Udyr includes R, Aphelios gets a bonus stat priority.
- Per-player clear button; floating champion picker hidden once rolled.
- Version and build number shown in the header.
- Footer with signature, hosting and privacy notice, and Riot Games legal notice; pinned to the bottom with a fade.
- Click the room code to copy it.
- Clear message when a room is full (10 players max).
- Builds never contain two items from the same exclusive group (Hydras, Lifeline, Last Whisper...).
- Cassiopeia gets no boots and an extra legendary instead.
