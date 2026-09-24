/* Kart Circuit's pre-race menu, as a one-decision-per-screen flow.
 *
 * It used to be a single tall card holding every control at once — mode,
 * players, gamepad mapping, driver, kart, colour, cup, all fourteen tracks,
 * difficulty — which meant the thing you wanted was always somewhere below the
 * fold, and the thing you'd already chosen was never obvious. This walks
 * through the same choices one screen at a time, the way classic kart racers does.
 *
 * Deliberately additive: it moves nothing and rebinds nothing. Every picker is
 * still the element game.js looked up at load and attached its own handler to,
 * just parented into a <section class="mk-step">. All this file decides is
 * which section is on screen, so if it were deleted the menu would degrade to
 * the old single scrolling card rather than break.
 *
 * The flow is per-mode because the modes genuinely differ: an online race has
 * no track to choose (it's randomised, and shared with strangers), and a solo
 * race has no lobby to wait in.
 */
(function () {
  "use strict";

  const overlay = document.getElementById("overlay");
  const stage = document.getElementById("mkStage");
  if (!overlay || !stage) return;

  const titleEl = document.getElementById("mkStepTitle");
  const hintEl = document.getElementById("overlayDescription");
  const dotsEl = document.getElementById("mkStepDots");
  const countEl = document.getElementById("mkStepCount");
  const backBtn = document.getElementById("mkBackButton");
  const nextBtn = document.getElementById("mkNextButton");
  const summaryEl = document.getElementById("mkSummary");
  const startBtn = document.getElementById("startButton");
  const steps = new Map([...stage.querySelectorAll(".mk-step")].map((el) => [el.dataset.step, el]));

  // Free Play is the only cup that leaves the track open, so it's the only one
  // whose flow includes a track screen — see `visibleFlow`.
  const FLOWS = {
    solo: ["mode", "driver", "cup", "track", "difficulty", "ready"],
    local: ["mode", "players", "driver", "cup", "track", "difficulty", "ready"],
    online: ["mode", "driver", "online"],
    friends: ["mode", "friends", "driver", "cup", "track", "difficulty", "ready"],
  };

  let mode = null;
  let index = 0;
  // "controls" is reachable from the mode screen but isn't part of any flow —
  // it's reference material, not a decision, so it remembers where you came
  // from and returns you there rather than advancing.
  let detourReturn = null;

  function currentCupKey() {
    const selected = document.querySelector(".cup-button.is-selected");
    return selected ? selected.dataset.cup : "free";
  }

  function visibleFlow() {
    const flow = FLOWS[mode] || ["mode"];
    // A cup brings its own tracks in a fixed order, so choosing one makes the
    // track screen meaningless — drop it rather than showing a dead step.
    return currentCupKey() === "free" ? flow : flow.filter((step) => step !== "track");
  }

  // What's actually on screen, which is not always flow[index]: the Controls
  // screen is shown without advancing the flow, so deriving this from `index`
  // alone reported the step you came *from* and left Back hidden there — no way
  // out of the detour.
  let shown = null;

  function stepName() {
    return shown;
  }

  function show(name, keepHint) {
    shown = name;
    steps.forEach((el, key) => el.classList.toggle("is-active", key === name));
    const el = steps.get(name);
    if (!el) return;
    if (titleEl) titleEl.textContent = el.dataset.title || "";
    // The hint line doubles as game.js's #overlayDescription, which that file
    // rewrites with race results and cup progress. `keepHint` is set when the
    // menu is reopening at the end of a race, so "You won the cup!" survives
    // instead of being replaced by this step's generic blurb a frame later.
    if (hintEl && el.dataset.hint && !keepHint) hintEl.textContent = el.dataset.hint;
    syncLobbyDock(name);
    stage.scrollTop = 0;
  }

  function renderNav() {
    const flow = visibleFlow();
    const name = stepName();
    const onDetour = detourReturn !== null;

    backBtn.classList.toggle("is-hidden", index === 0 && !onDetour);
    // The last screen of a flow is its own call to action — Start Race, or a
    // lobby that starts itself — so there is nothing left to advance to.
    const isLast = index >= flow.length - 1;
    nextBtn.classList.toggle("is-hidden", isLast || name === "mode" || onDetour);
    if (startBtn) startBtn.classList.toggle("is-hidden", name !== "ready");
    // The mode screen is before the flow forks, so there is no honest step
    // count to give yet — every mode has a different number of them.
    const showProgress = !onDetour && name !== "mode";
    countEl.textContent = showProgress ? `Step ${index + 1} of ${flow.length}` : "";

    dotsEl.innerHTML = "";
    if (showProgress) {
      flow.forEach((_, i) => {
        const dot = document.createElement("li");
        dot.className = "mk-step-dot" + (i === index ? " is-current" : i < index ? " is-done" : "");
        dotsEl.appendChild(dot);
      });
    }
  }

  function goTo(i, keepHint) {
    detourReturn = null;
    const flow = visibleFlow();
    index = Math.max(0, Math.min(i, flow.length - 1));
    show(flow[index], keepHint);
    if (flow[index] === "ready") renderSummary();
    renderNav();
  }

  function next() { goTo(index + 1); }
  function back() {
    if (detourReturn !== null) {
      const to = detourReturn;
      detourReturn = null;
      goTo(to);
      return;
    }
    if (index === 0) return;
    goTo(index - 1);
  }

  function openDetour(name) {
    detourReturn = index;
    show(name);
    renderNav();
  }

  function setMode(nextMode) {
    mode = nextMode;
    document.querySelectorAll(".mk-mode-card").forEach((card) => {
      card.classList.toggle("is-selected", card.dataset.mode === nextMode);
    });
    // Online and Friends both need a single local racer — the seat count picker
    // isn't on their path, so reset it here rather than letting a stale "3
    // Players" from an earlier local session block the connection later.
    if ((nextMode === "online" || nextMode === "friends") && typeof setLocalPlayerCount === "function") {
      setLocalPlayerCount(1);
    }
    if (nextMode === "local" && typeof setLocalPlayerCount === "function" && localPlayerCount < 2) {
      setLocalPlayerCount(2);
    }
    goTo(1);
  }

  function labelOf(selector) {
    const el = document.querySelector(selector);
    return el ? el.textContent.trim() : "—";
  }

  // The ready screen is the one place every earlier choice is visible at once,
  // which is the trade a step-by-step flow has to make good on.
  function renderSummary() {
    if (!summaryEl) return;
    const rows = [];
    const modeLabel = { solo: "Single Player", local: "Local Multiplayer", online: "Play Online", friends: "Play with Friends" }[mode];
    rows.push(["Mode", modeLabel || "—"]);
    if (mode === "local") rows.push(["Players", `${localPlayerCount}`]);
    rows.push(["Driver", labelOf("#characterPicker .map-button.is-selected") || "—"]);
    rows.push(["Kart", labelOf("#kartPicker .map-button.is-selected") || "—"]);
    rows.push(["Cup", labelOf(".cup-button.is-selected")]);
    // Scoped to the track step on purpose: the character and kart pickers are
    // built with the same .map-picker/.map-button classes, so an unscoped
    // ".map-button.is-selected" finds the selected *driver* first.
    if (currentCupKey() === "free") rows.push(["Track", labelOf('[data-step="track"] .map-button.is-selected')]);
    rows.push(["Difficulty", labelOf(".difficulty-button.is-selected")]);
    summaryEl.innerHTML = "";
    rows.forEach(([label, value]) => {
      const row = document.createElement("div");
      row.className = "mk-summary-row";
      row.innerHTML = `<span>${label}</span><strong></strong>`;
      row.querySelector("strong").textContent = value;
      summaryEl.appendChild(row);
    });
  }

  /* --- wiring ----------------------------------------------------------- */

  document.querySelectorAll(".mk-mode-card").forEach((card) => {
    card.addEventListener("click", () => setMode(card.dataset.mode));
  });

  // Picking one of these *is* the decision that screen exists for, so it also
  // advances — the Next button is there for the screens you might want to skip
  // past without changing anything. game.js's own handler on the same element
  // has already run by the time this listener fires, so the selection is
  // committed before the flow moves on.
  const AUTO_ADVANCE = [".difficulty-button", ".cup-button", ".map-button", ".local-mp-button"];
  AUTO_ADVANCE.forEach((selector) => {
    document.querySelectorAll(selector).forEach((btn) => {
      btn.addEventListener("click", () => {
        // Choosing a cup adds or removes the track screen, so the flow has to
        // be re-derived before advancing rather than after.
        window.setTimeout(() => next(), 140);
      });
    });
  });

  backBtn.addEventListener("click", back);
  nextBtn.addEventListener("click", next);

  const controlsBtn = document.getElementById("mkControlsButton");
  if (controlsBtn) controlsBtn.addEventListener("click", () => openDetour("controls"));

  document.querySelectorAll(".mk-pool-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".mk-pool-card").forEach((c) => c.classList.toggle("is-selected", c === card));
      if (typeof mpMatchmake === "function") mpMatchmake(card.dataset.pool);
    });
  });

  const onlineLeave = document.getElementById("onlineLeaveButton");
  if (onlineLeave) {
    onlineLeave.addEventListener("click", () => {
      if (typeof mpLeave === "function") mpLeave();
      document.querySelectorAll(".mk-pool-card").forEach((c) => c.classList.remove("is-selected"));
    });
  }

  /* The chat panel and the camera strip are positioned over the track, which is
   * where they belong mid-race — but with the menu open they landed straight on
   * top of the card, which is exactly the clutter this flow exists to remove.
   * On a lobby step they're moved into the card instead; anywhere else they go
   * back to floating over the frame. Moving the live nodes (rather than
   * duplicating them) keeps chat handlers bound and video streams playing. */
  const mpChatEl = document.getElementById("mpChat");
  const mpVideosEl2 = document.getElementById("mpVideos");
  const floatHome = mpChatEl ? mpChatEl.parentElement : null;

  function syncLobbyDock(name) {
    if (!floatHome) return;
    const dock = name === "online" || name === "friends"
      ? steps.get(name).querySelector("[data-lobby-dock]")
      : null;
    [mpChatEl, mpVideosEl2].forEach((el) => {
      if (!el) return;
      const target = dock || floatHome;
      if (el.parentElement !== target) target.appendChild(el);
      el.classList.toggle("is-docked", Boolean(dock));
    });
  }

  /* game.js reopens this overlay when a race ends (finishRace) without knowing
   * anything about steps. Rather than reach into that function, watch the class
   * it toggles: on reopen, drop the player back on the screen that makes sense
   * for the mode they're in — the lobby if they're racing online, otherwise the
   * ready screen so a rematch is one click away. */
  new MutationObserver(() => {
    if (overlay.classList.contains("hidden") || !mode) return;
    const flow = visibleFlow();
    const target = mode === "online" ? "online" : "ready";
    const at = flow.indexOf(target);
    if (at >= 0 && stepName() !== target) goTo(at, true);
    else if (stepName() === "ready") renderSummary();
  }).observe(overlay, { attributes: true, attributeFilter: ["class"] });

  goTo(0);
})();
