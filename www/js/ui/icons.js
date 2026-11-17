// Icônes de l'appli : de simples tracés (grille 24 × 24, trait arrondi), dessinés pour ce projet.

import { s } from './dom.js';

const PATHS = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  checks: 'M3 12.5l4 4 7-8M12 16.5l1 1 8-9',
  back: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  down: 'M5 9l7 7 7-7',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  filter: 'M4 6h16M7 12h10M10 18h4',
  undo: 'M8 7L4 11l4 4M4 11h11a5 5 0 0 1 0 10h-3',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.01',
  help: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17v.01',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  envelope: 'M3 6h18v12H3zM3 7l9 7 9-7',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  stats: 'M5 20V11M12 20V4M19 20v-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 8.5h.01',
  repeat: 'M4 11V9a3 3 0 0 1 3-3h11l-3-3M20 13v2a3 3 0 0 1-3 3H6l3 3',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15.5 9h.01',
  bank: 'M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  share: 'M12 15V4M8 8l4-4 4 4M6 12v7h12v-7',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4',
  lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
  bug: 'M8 9a4 4 0 0 1 8 0v6a4 4 0 0 1-8 0zM4 13h4M16 13h4M5 7l3 3M19 7l-3 3M5 20l3-3M19 20l-3-3M12 5V3',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.01',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  transfer: 'M4 8h14l-3-3M20 16H6l3 3',
  arrowDown: 'M12 5v14M6 13l6 6 6-6',
  arrowUp: 'M12 19V5M6 11l6-6 6 6',
  arrowRight: 'M5 12h14M13 6l6 6-6 6',
  wallet: 'M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4zM4 7V5h12v2M16 13.5h.01',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 5l12 7-12 7z',
  target: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 12h.01',
  archive: 'M4 5h16v4H4zM6 9v10h12V9M10 13h4',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  chartLine: 'M4 19h16M5 15l4-5 4 3 6-8',
  shield: 'M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z',
  wand: 'M5 19L16 8M14 6l4 4M18 3v2M21 6h-2M19 12v2',
  select: 'M4 6l2 2 3-3M4 13l2 2 3-3M13 7h7M13 14h7M5 20h.01M13 20h7',
  paperclip: 'M8 12l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l7-7',
  database: 'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6',
  pencil: 'M4 20l1-4L16 5l3 3L8 19l-4 1z',
  seal: 'M12 3l2.2 2.2 3-.4.5 3 2.7 1.5-1.3 2.7 1.3 2.7-2.7 1.5-.5 3-3-.4L12 21l-2.2-2.2-3 .4-.5-3-2.7-1.5L4.9 12 3.6 9.3l2.7-1.5.5-3 3 .4z',
  chat: 'M4 5h16v11h-9l-5 4v-4H4z',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  phone: 'M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2',
  folder: 'M3 6h6l2 3h10v10H3z',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  send: 'M21 3L10 14M21 3l-7 18-4-7-7-4z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16v4M17 18h4',
};

/** icon('plus'), icon('check', 'sm') — renvoie un élément SVG décoratif (ignoré des lecteurs d'écran). */
export function icon(name, size = '') {
  const d = PATHS[name] || PATHS.info;
  return s('svg', { class: size ? `icon ${size}` : 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, s('path', { d }));
}

export function hasIcon(name) {
  return name in PATHS;
}
