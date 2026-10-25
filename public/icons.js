// Icon system: Monoline for UI items, Offset Duotone for reward badges.
// Everything is inline SVG that inherits the app's colour tokens, so white and dark modes just work.
const G = {
  refresh: '<path fill="none" d="M20 12a8 8 0 1 1-2.3-5.7"/><path fill="none" d="M20 4v5h-5"/>',
  beads: '<path fill="none" d="M3 8Q12 22 21 8"/><circle fill="FILL" cx="4.5" cy="9" r="1.8"/><circle fill="FILL" cx="8" cy="14" r="1.8"/><circle fill="FILL" cx="12" cy="16" r="1.8"/><circle fill="FILL" cx="16" cy="14" r="1.8"/><circle fill="FILL" cx="19.5" cy="9" r="1.8"/>',
  flame: '<path fill="FILL" d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z"/>',
  shield: '<path fill="FILL" d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z"/>',
  leaf: '<path fill="FILL" d="M5 19C5 9 11 5 19 5c0 8-4 14-14 14z"/><path fill="none" d="M5 19l8-8"/>',
  lens: '<circle fill="FILL" cx="10.5" cy="10.5" r="6"/><path fill="none" d="M15 15l5 5"/>',
  book: '<path fill="FILL" d="M4 5h7a1.5 1.5 0 0 1 1 .5A1.5 1.5 0 0 1 13 5h7v14h-7a1.5 1.5 0 0 0-1 .5 1.5 1.5 0 0 0-1-.5H4z"/><path fill="none" d="M12 5.5v14"/>',
  nodes: '<path fill="none" d="M12 7l-6 10M12 7l6 10M6 17h12"/><circle fill="FILL" cx="12" cy="6" r="2.4"/><circle fill="FILL" cx="5.5" cy="17.5" r="2.4"/><circle fill="FILL" cx="18.5" cy="17.5" r="2.4"/>',
  seat: '<circle fill="FILL" cx="12" cy="12" r="3"/><circle fill="FILL" cx="20" cy="12" r="1.5"/><circle fill="FILL" cx="16" cy="18.9" r="1.5"/><circle fill="FILL" cx="8" cy="18.9" r="1.5"/><circle fill="FILL" cx="4" cy="12" r="1.5"/><circle fill="FILL" cx="8" cy="5.1" r="1.5"/><circle fill="FILL" cx="16" cy="5.1" r="1.5"/>',
  chain: '<rect fill="FILL" x="2" y="8.5" width="12" height="7" rx="3.5"/><rect fill="FILL" x="10" y="8.5" width="12" height="7" rx="3.5"/>',
  star: '<rect fill="FILL" x="5.5" y="5.5" width="13" height="13"/><rect fill="FILL" x="5.5" y="5.5" width="13" height="13" transform="rotate(45 12 12)"/>',
  home: '<path fill="FILL" d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',
  bars: '<rect fill="FILL" x="3.5" y="10" width="4" height="10"/><rect fill="FILL" x="10" y="4" width="4" height="16"/><rect fill="FILL" x="16.5" y="13" width="4" height="7"/>',
  caravan: '<path fill="none" d="M8 13l2.5-3M15.5 10l2.5 3M8.5 19.5h7"/><circle fill="FILL" cx="5.5" cy="14" r="2.6"/><circle fill="FILL" cx="12" cy="8" r="2.6"/><circle fill="FILL" cx="18.5" cy="14" r="2.6"/>',
  me: '<circle fill="FILL" cx="12" cy="8" r="3.6"/><path fill="none" d="M5 20c1-4 4-6 7-6s6 2 7 6"/>',
  tap: '<circle fill="FILL" cx="12" cy="12" r="3"/><circle fill="none" cx="12" cy="12" r="7.5"/>',
  play: '<rect fill="FILL" x="3" y="5" width="18" height="14"/><path fill="none" d="M10 9.5l5 2.5-5 2.5z"/>',
  check: '<path fill="none" d="M5 12.5l4.5 4.5L19 7"/>',
  menu: '<path fill="none" d="M4 7h16M4 12h16M4 17h16"/>',
  plus: '<path fill="none" d="M12 5v14M5 12h14"/>',
  camera: '<rect fill="FILL" x="3" y="7" width="18" height="12"/><circle fill="none" cx="12" cy="13" r="3.2"/><path fill="none" d="M8.5 7l1.2-2h4.6l1.2 2"/>',
  share: '<path fill="none" d="M5 12v7h14v-7M12 4v10M8 8l4-4 4 4"/>',
  bolt: '<path fill="FILL" d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  feed: '<rect fill="FILL" x="4" y="4" width="16" height="6"/><path fill="none" d="M4 14h16M4 18h10"/>',
  heart: '<path fill="FILL" d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
  flag: '<path fill="none" d="M6 21V4"/><path fill="FILL" d="M6 5h11l-2.5 3.5L17 12H6z"/>',
  chat: '<path fill="none" d="M4 5h16v11H9l-5 4z"/>',
  pen: '<path fill="FILL" d="M4 20l1-4L16 5l3 3L8 19z"/><path fill="none" d="M14 7l3 3"/>',
};
const glyph = (name, fill) => G[name].replaceAll('FILL', fill);

/** Monoline UI icon: thin currentColor strokes, no fills. */
export function uiIcon(name, size = 22, stroke = 1.7) {
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${glyph(name, 'none')}</svg>`;
}

// badge code -> [glyph, tier, tiers in its family]; names and descriptions live in i18n
export const BADGES = {
  first_step: ['beads', 1, 5], d1k: ['beads', 2, 5], d10k: ['beads', 3, 5], d100k: ['beads', 4, 5], d1m: ['beads', 5, 5],
  streak7: ['flame', 1, 3], streak30: ['flame', 2, 3], streak100: ['flame', 3, 3],
  sunnah1: ['leaf', 1, 3], sunnah7: ['leaf', 2, 3], sunnah30: ['leaf', 3, 3],
  karwan7: ['flame', 1, 2], karwan30: ['flame', 2, 2],
  qabila10: ['nodes', 1, 3], qabila50: ['nodes', 2, 3], qabila250: ['nodes', 3, 3],
  league_silver: ['bolt', 1, 3], league_gold: ['bolt', 2, 3], league_diamond: ['bolt', 3, 3],
  city_podium: ['star', 1, 2], city_champion: ['star', 2, 2],
  group10k: ['caravan', 1, 3], group100k: ['caravan', 2, 3], group1m: ['caravan', 3, 3],
  recruit1: ['nodes', 1, 3], recruit5: ['nodes', 2, 3], recruit25: ['nodes', 3, 3],
  scholar1: ['book', 1, 2], scholar10: ['book', 2, 2], circle: ['seat', 1, 1], circle_teacher: ['seat', 2, 2],
  caravan10k: ['chain', 1, 4], caravan100k: ['chain', 2, 4], caravan1m: ['chain', 3, 4], caravan10m: ['chain', 4, 4],
};

/** Offset Duotone reward badge: outlined tile, hard offset shadow, green wash; small squares show the tier. Locked = greyed outline. */
export function badgeSvg(code, earned, size = 76) {
  const [g, tier, max] = BADGES[code];
  const ink = earned ? 'var(--ink)' : 'var(--line)';
  const sw = 2 * 24 / 32;
  const squares = [...Array(max)].map((_, i) => `<rect x="${12 + i * 8}" y="53" width="5" height="5" fill="${i < tier ? ink : 'none'}" stroke="${ink}" stroke-width="1"/>`).join('');
  return `<svg class="badge-svg" width="${size}" height="${size}" viewBox="0 0 76 76" aria-hidden="true">
    <rect x="11" y="11" width="58" height="58" fill="${earned ? 'var(--sig)' : 'var(--track)'}"/>
    <rect x="6" y="6" width="58" height="58" fill="${earned ? 'var(--tint)' : 'var(--paper)'}" stroke="${ink}" stroke-width="2.4"/>
    <g transform="translate(19 17) scale(${32 / 24})" fill="none" stroke="${ink}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${glyph(g, earned ? 'var(--sig)' : 'none')}</g>
    ${squares}</svg>`;
}
