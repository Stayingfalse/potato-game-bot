'use strict';

/** Returns a new array with the items of `arr` in random order (Fisher–Yates). */
function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** Picks `n` unique items at random from `arr`. */
function sampleN(arr, n) {
  return shuffle(arr).slice(0, n);
}

module.exports = { shuffle, sampleN };
