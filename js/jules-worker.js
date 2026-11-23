// Runs Jules's search in the background so the board stays usable (premoves, clocks) while it thinks.
importScripts('engine.js', 'jules.js');

self.onmessage = (e) => {
  const { id, game, ms } = e.data;
  let action = null;
  try { action = self.TGJules.chooseAction(game, { ms }); } catch { /* the page falls back */ }
  self.postMessage({ id, action });
};
