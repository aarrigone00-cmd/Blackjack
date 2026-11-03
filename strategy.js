// Basic strategy for this table's rules: dealer stands on all 17s, double on any
// first two cards, no splitting or surrender. Used to grade each decision.
window.BasicStrategy = (() => {
  // up = dealer upcard value 2..11 (ace = 11)
  function hard(total, up, canDouble) {
    if (total <= 8) return "hit";
    if (total === 9) return canDouble && up >= 3 && up <= 6 ? "double" : "hit";
    if (total === 10) return canDouble && up <= 9 ? "double" : "hit";
    if (total === 11) return canDouble && up <= 10 ? "double" : "hit";
    if (total === 12) return up >= 4 && up <= 6 ? "stand" : "hit";
    if (total <= 16) return up <= 6 ? "stand" : "hit";
    return "stand";
  }

  function soft(total, up, canDouble) {
    if (total <= 12) return "hit"; // A,A counted as soft 12
    if (total <= 14) return canDouble && up >= 5 && up <= 6 ? "double" : "hit";
    if (total <= 16) return canDouble && up >= 4 && up <= 6 ? "double" : "hit";
    if (total === 17) return canDouble && up >= 3 && up <= 6 ? "double" : "hit";
    if (total === 18) {
      if (up >= 3 && up <= 6) return canDouble ? "double" : "stand";
      if (up <= 8) return "stand";
      return "hit";
    }
    return "stand";
  }

  return {
    recommend(total, isSoft, up, canDouble) {
      return isSoft ? soft(total, up, canDouble) : hard(total, up, canDouble);
    },
  };
})();
