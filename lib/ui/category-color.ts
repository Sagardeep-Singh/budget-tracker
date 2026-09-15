// Category chips get color from the existing 6-hue chart palette
// (app/globals.css --chart-1..6), hashed by name — no new design tokens,
// and no per-category color stored anywhere in the data model.
export const categoryColorVar = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `var(--chart-${(hash % 6) + 1})`;
};
