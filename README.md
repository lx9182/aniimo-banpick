# Aniimo Ban/Pick

A tiny draft tool for 2 players: each side picks **8** Aniimo, bans **2** of the
opponent's picks, then plays the **6** that are left. No accounts, no install —
just share a room code.

## How it works

1. One player creates a room and sends the 6–8 character code.
2. The host can tweak picks/bans behind the settings icon in the top bar
   (picks − bans must stay at least **6**). Both players hit **Ready**, then the
   host starts the draft.
3. Pick 8 and confirm. Picks stay hidden until both sides confirm.
4. Ban up to 2 of the opponent's picks (both sides at the same time) and confirm.
5. Copy the final line-up and play.

Rooms expire after 24 hours without activity.

Drafting always uses the basic form. Aniimo with regional or Prismana variants show
a small `+N forms` tag in the pool **and** on your picks — hover a card/slot (or
tap the tag on a phone) to preview the other art and their attributes, as
reference only.

## Files

- `assets/aniimos.json` — pool manifest: `id`, `name`, `types`, `stage`, `img`, plus every extra `forms` entry.
- `assets/aniimos/<id>.webp` — card art; extra forms are `<id>-<form>.webp`. Missing files fall back to initials.
- `assets/icons/<element>.webp` — element icons (official attribute sprites).
- `database.rules.json` — Realtime Database rules to paste into the Firebase console.

Static site, no build step. Hosted on GitHub Pages.
