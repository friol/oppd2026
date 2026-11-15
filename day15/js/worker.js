// Runs the generator off the main thread so the page stays responsive.
const V = self.location.search; // version query from main.js, against stale cached scripts
importScripts('dict-it.js' + V, 'dict-it-hard.js' + V, 'dict-en.js' + V, 'generator.js' + V);

const dicts = {};

// Same composition as in main.js: the hard Italian list goes first, so its clues win.
function lines(lang, level) {
  if (lang === 'en') return self.DICT_EN;
  return level === 'h' ? self.DICT_IT_HARD.concat(self.DICT_IT) : self.DICT_IT;
}

self.onmessage = e => {
  const { id, lang, level, size, seed, portraits } = e.data;
  const k = lang + level;
  if (!dicts[k]) dicts[k] = self.Crossword.parseDictionary(lines(lang, level)).map;
  const res = self.Crossword.generate({ dict: dicts[k], lang, size, seed, portraits });
  self.postMessage({ id, res });
};
