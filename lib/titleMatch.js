// Whitespace and punctuation vary between catalogues. Edition/sequel words remain significant.
const titleKey = value => String(value || '').normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, '');
function matchingTitles(candidates, manga) {
  const compatible = candidates.filter(c => !Number.isInteger(c.year) || !Number.isInteger(manga.year) || c.year === manga.year);
  const canonical = compatible.filter(c => titleKey(c.title) === titleKey(manga.title));
  if (canonical.length) return canonical;
  const aliases = new Set((manga.alternativeTitles || []).map(titleKey));
  return compatible.filter(c => [c.title, ...(c.aliases || [])].some(name => aliases.has(titleKey(name))));
}
module.exports = {titleKey, matchingTitles};
