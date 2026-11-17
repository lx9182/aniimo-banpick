window.ABP = window.ABP || {};

ABP.VERSION = '2.4.1';

/** Defaults for a new room. The host can change them in the lobby. */
ABP.DEFAULT_CFG = {
  bring: 8,   // Aniimo each player picks
  banEach: 2, // bans each player places on the opponent's picks
};

/** A room dies after this long without any activity (also enforced in rules). */
ABP.ROOM_TTL_MS = 24 * 60 * 60 * 1000;

/** Manifest + art. Images: assets/aniimos/{id}.webp, icons: assets/icons/{element}.webp */
ABP.MANIFEST_URL = 'assets/aniimos.json';
ABP.IMG_BASE = 'assets/aniimos/';
ABP.ICON_BASE = 'assets/icons/';

/** Canonical elements, in display order. */
ABP.ELEMENT_ORDER = ['light', 'fire', 'ice', 'dark', 'lightning', 'grass', 'water', 'rock', 'wind'];

ABP.ELEMENTS = {
  light:     { label: 'Light',     color: '#f6a93c' },
  fire:      { label: 'Fire',      color: '#e26161' },
  ice:       { label: 'Ice',       color: '#45c1d6' },
  dark:      { label: 'Dark',      color: '#a373d2' },
  lightning: { label: 'Lightning', color: '#e0c21a' },
  grass:     { label: 'Grass',     color: '#51b17a' },
  water:     { label: 'Water',     color: '#529de7' },
  rock:      { label: 'Rock',      color: '#bea77b' },
  wind:      { label: 'Wind',      color: '#2a52be' },
};

/** Older manifests use these names; map them onto the canonical set. */
ABP.ELEMENT_ALIASES = {
  nature: 'grass',
  electric: 'lightning',
  earth: 'rock',
  air: 'wind',
  shadow: 'dark',
};

/** Room codes: no look-alike characters (0/O, 1/I/L). */
ABP.CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
ABP.CODE_LEN = 8;

/** LOCAL test mode (no Firebase config). Two tabs on the same machine. */
ABP.LOCAL_KEY_PREFIX = 'abp:room:';
