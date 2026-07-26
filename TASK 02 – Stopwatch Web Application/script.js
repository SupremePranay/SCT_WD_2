/* ============================================================
   CHRONLY — Stopwatch Logic (Vanilla JS, no dependencies)
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {

  /* ---------- 0. ELEMENT REFERENCES ---------- */
  const hhEl = document.getElementById("hh");
  const mmEl = document.getElementById("mm");
  const ssEl = document.getElementById("ss");
  const msEl = document.getElementById("ms");
  const statusLabel = document.getElementById("statusLabel");
  const dialWrap = document.querySelector(".dial-wrap");
  const dialProgress = document.getElementById("dialProgress");
  const ticksGroup = document.getElementById("ticks");

  const toggleBtn = document.getElementById("toggleBtn");
  const toggleLabel = document.getElementById("toggleLabel");
  const resetBtn = document.getElementById("resetBtn");
  const lapBtn = document.getElementById("lapBtn");

  const lapsList = document.getElementById("lapsList");
  const lapsEmpty = document.getElementById("lapsEmpty");
  const lapsCount = document.getElementById("lapsCount");

  const themeToggle = document.getElementById("themeToggle");


  /* ---------- 1. STATE ---------- */
  // "idle"    -> never started, or freshly reset
  // "running" -> actively counting
  // "paused"  -> stopped mid-count, can resume
  let state = "idle";

  let startTimestamp = 0;   // performance.now() value when the run began
  let elapsedBeforePause = 0; // accumulated ms from previous run segments
  let rafId = null;
  let lapCount = 0;
  let lastLapElapsed = 0;   // elapsed ms at the previous lap, for split calculation


  /* ---------- 2. DIAL SETUP (ticks + progress ring) ---------- */
  const DIAL_RADIUS = 110;
  const DIAL_CENTER = 130;
  const CIRCUMFERENCE = 2 * Math.PI * DIAL_RADIUS;

  dialProgress.style.strokeDasharray = `${CIRCUMFERENCE}`;
  dialProgress.style.strokeDashoffset = `${CIRCUMFERENCE}`;

  // Draw 60 tick marks around the dial (every 5th one longer/brighter)
  (function buildTicks() {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 60; i++) {
      const angle = (i / 60) * 2 * Math.PI;
      const isMajor = i % 5 === 0;
      const outer = DIAL_RADIUS + 12;
      const inner = isMajor ? DIAL_RADIUS + 2 : DIAL_RADIUS + 6;

      const x1 = DIAL_CENTER + outer * Math.cos(angle);
      const y1 = DIAL_CENTER + outer * Math.sin(angle);
      const x2 = DIAL_CENTER + inner * Math.cos(angle);
      const y2 = DIAL_CENTER + inner * Math.sin(angle);

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", x1.toFixed(2));
      line.setAttribute("y1", y1.toFixed(2));
      line.setAttribute("x2", x2.toFixed(2));
      line.setAttribute("y2", y2.toFixed(2));
      if (isMajor) line.classList.add("tick-major");

      fragment.appendChild(line);
    }
    ticksGroup.appendChild(fragment);
  })();


  /* ---------- 3. TIME FORMATTING ---------- */
  function formatTime(totalMs) {
    const ms = Math.floor(totalMs % 1000);
    const totalSeconds = Math.floor(totalMs / 1000);
    const s = totalSeconds % 60;
    const m = Math.floor(totalSeconds / 60) % 60;
    const h = Math.floor(totalSeconds / 3600);

    return {
      h: String(h).padStart(2, "0"),
      m: String(m).padStart(2, "0"),
      s: String(s).padStart(2, "0"),
      ms: String(ms).padStart(3, "0"),
    };
  }

  function renderTime(totalMs) {
    const t = formatTime(totalMs);
    hhEl.textContent = t.h;
    mmEl.textContent = t.m;
    ssEl.textContent = t.s;
    msEl.textContent = `.${t.ms}`;

    // Sweep the progress arc once per minute (60s loop)
    const secondsIntoMinute = (totalMs % 60000) / 60000;
    const offset = CIRCUMFERENCE * (1 - secondsIntoMinute);
    dialProgress.style.strokeDashoffset = offset.toFixed(2);
  }


  /* ---------- 4. CORE TIMER LOOP (accurate via performance.now) ---------- */
  function getElapsed() {
    if (state === "running") {
      return performance.now() - startTimestamp;
    }
    return elapsedBeforePause;
  }

  function tick() {
    renderTime(getElapsed());
    rafId = requestAnimationFrame(tick);
  }


  /* ---------- 5. STATE TRANSITIONS ---------- */
  function updateStatusUI() {
    dialWrap.classList.toggle("running", state === "running");
    dialWrap.classList.toggle("paused", state === "paused");
    toggleBtn.classList.toggle("is-running", state === "running");

    if (state === "idle") { statusLabel.textContent = "Ready"; toggleLabel.textContent = "Start"; }
    if (state === "running") { statusLabel.textContent = "Running"; toggleLabel.textContent = "Pause"; }
    if (state === "paused") { statusLabel.textContent = "Paused"; toggleLabel.textContent = "Resume"; }

    // Lap is only meaningful while running; Reset is disabled mid-run
    // so a run can't be wiped out by accident.
    lapBtn.disabled = state !== "running";
    resetBtn.disabled = state === "running";
  }

  function startOrResume() {
    if (state === "running") return;
    startTimestamp = performance.now() - elapsedBeforePause;
    state = "running";
    tick();
    updateStatusUI();
  }

  function pause() {
    if (state !== "running") return;
    elapsedBeforePause = performance.now() - startTimestamp;
    state = "paused";
    cancelAnimationFrame(rafId);
    renderTime(elapsedBeforePause); // freeze the exact paused value
    updateStatusUI();
  }

  function toggleStartPause() {
    if (state === "running") {
      pause();
    } else {
      startOrResume();
    }
  }

  function reset() {
    // Reset is intentionally blocked while running (see updateStatusUI),
    // so this only ever fires from idle or paused.
    if (state === "running") return;

    cancelAnimationFrame(rafId);
    state = "idle";
    elapsedBeforePause = 0;
    lastLapElapsed = 0;
    lapCount = 0;

    renderTime(0);
    clearLaps();
    updateStatusUI();
  }


  /* ---------- 6. LAP HANDLING ---------- */
  function clearLaps() {
    lapsList.querySelectorAll(".lap-item").forEach((el) => el.remove());
    lapsEmpty.style.display = "block";
    lapsCount.textContent = "0";
  }

  function addLap() {
    // "Prevent duplicate laps while paused": the Lap button is disabled
    // whenever state !== "running" (see updateStatusUI), and this guard
    // double-checks the same rule for the keyboard shortcut path.
    if (state !== "running") return;

    const currentElapsed = getElapsed();
    const splitMs = currentElapsed - lastLapElapsed;
    lastLapElapsed = currentElapsed;
    lapCount += 1;

    // Un-highlight the previous latest lap
    const previousLatest = lapsList.querySelector(".lap-item.latest");
    if (previousLatest) previousLatest.classList.remove("latest");

    const li = document.createElement("li");
    li.className = "lap-item latest";

    const splitT = formatTime(splitMs);
    const totalT = formatTime(currentElapsed);

    li.innerHTML = `
      <span class="lap-index">Lap ${lapCount}</span>
      <span class="lap-split">+${splitT.m}:${splitT.s}.${splitT.ms}</span>
      <span class="lap-total">${totalT.h}:${totalT.m}:${totalT.s}.${totalT.ms}</span>
    `;

    lapsEmpty.style.display = "none";
    // Newest lap goes to the top of the scrollable list
    lapsList.insertBefore(li, lapsList.firstChild);
    lapsList.scrollTop = 0;
    lapsCount.textContent = String(lapCount);

    playLapSound();
  }


  /* ---------- 7. SOUND EFFECT (Web Audio API, no external files) ---------- */
  let audioCtx = null;
  function playLapSound() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.18);

      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.18);
    } catch (err) {
      // Audio isn't essential to the app's function — fail silently
      // if the browser blocks it (e.g. before any user gesture).
    }
  }


  /* ---------- 8. BUTTON RIPPLE EFFECT ---------- */
  function attachRipple(btn) {
    btn.addEventListener("click", function (e) {
      if (this.disabled) return;
      const rect = this.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      const circle = document.createElement("span");

      circle.className = "ripple-circle";
      circle.style.width = circle.style.height = `${size}px`;
      circle.style.left = `${e.clientX - rect.left - size / 2}px`;
      circle.style.top = `${e.clientY - rect.top - size / 2}px`;

      this.appendChild(circle);
      circle.addEventListener("animationend", () => circle.remove());
    });
  }
  [toggleBtn, resetBtn, lapBtn].forEach(attachRipple);


  /* ---------- 9. THEME TOGGLE (persists via localStorage) ---------- */
  function applyTheme(theme) {
    document.body.classList.toggle("light", theme === "light");
  }

  const savedTheme = localStorage.getItem("chronly-theme");
  if (savedTheme) {
    applyTheme(savedTheme);
  } else if (window.matchMedia("(prefers-color-scheme: light)").matches) {
    applyTheme("light");
  }

  themeToggle.addEventListener("click", () => {
    const isLight = document.body.classList.toggle("light");
    localStorage.setItem("chronly-theme", isLight ? "light" : "dark");
  });


  /* ---------- 10. WIRE UP CONTROLS ---------- */
  toggleBtn.addEventListener("click", toggleStartPause);
  resetBtn.addEventListener("click", reset);
  lapBtn.addEventListener("click", addLap);


  /* ---------- 11. KEYBOARD SHORTCUTS ---------- */
  document.addEventListener("keydown", (e) => {
    // Ignore shortcuts if focus is on an interactive text field (future-proofing)
    const tag = document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (e.code === "Space") {
      e.preventDefault(); // stop the page from scrolling on Space
      toggleStartPause();
    } else if (e.key.toLowerCase() === "l") {
      addLap();
    } else if (e.key.toLowerCase() === "r") {
      reset();
    }
  });


  /* ---------- 12. INITIAL RENDER ---------- */
  renderTime(0);
  updateStatusUI();

});