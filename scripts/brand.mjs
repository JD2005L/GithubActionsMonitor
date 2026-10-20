// Brand artwork shared by the extension icons, store icon, promo tile, screenshots and product page.
// Same family as GitHub Repo Navigator: a dark rounded tile (#1f2328, corner radius 20%) carrying colored marks.

const TILE = '#1f2328';
const GREEN = '#3fb950';
const YELLOW = '#d29922';
const RED = '#f85149';

const tile = (size) => {
  const m = size * 0.02;
  return `<rect x="${m}" y="${m}" width="${size - 2 * m}" height="${size - 2 * m}" rx="${size * 0.2}" fill="${TILE}"/>`;
};

/**
 * The brand icon: a status ring (mostly green, with yellow and red segments) around a green center, on the tile.
 * Reads as "pipeline health" and stays legible down to 16px.
 */
export function brandSvg(size) {
  const c = size / 2;
  const r = size * 0.29;
  const w = Math.max(1.6, size * 0.12);
  const arc = (from, to, color) => {
    const rad = (deg) => ((deg - 90) * Math.PI) / 180;
    const [x1, y1] = [c + r * Math.cos(rad(from)), c + r * Math.sin(rad(from))];
    const [x2, y2] = [c + r * Math.cos(rad(to)), c + r * Math.sin(rad(to))];
    return `<path d="M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" fill="none"/>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
${tile(size)}${arc(24, 216, GREEN)}${arc(246, 282, YELLOW)}${arc(312, 344, RED)}
<circle cx="${c}" cy="${c}" r="${size * 0.1}" fill="${GREEN}"/>
</svg>`;
}

/** The toolbar icon the extension draws at runtime (icon-manager.js): the tile with a solid status circle. */
export function statusSvg(size, color) {
  const fill = { green: '#2da44e', yellow: '#fbbf24', red: '#ef4444', gray: '#9ca3af' }[color] ?? color;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
${tile(size)}<circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.3}" fill="${fill}"/>
</svg>`;
}

// Kept for older callers: the brand mark.
export const ringSvg = brandSvg;
