(() => {
  "use strict";

  // ---------- Configuração ----------
  const BPM_MIN = 40;
  const BPM_MAX = 200;
  const BPM_DEFAULT = 90;
  const BEATS_PER_BAR = 4;
  const BARS_PER_NOTE = 4;
  const BEATS_PER_CYCLE = BEATS_PER_BAR * BARS_PER_NOTE; // 16
  const NOTE_REVEAL_BAR = 3; // a nota aparece no 3º compasso
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.1; // segundos

  // ---------- Teoria ----------
  // Apenas sustenidos (#), nunca bemóis
  const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const KEYS = NOTES;
  const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

  function majorScale(tonic) {
    const t = NOTES.indexOf(tonic);
    return MAJOR_STEPS.map((step) => NOTES[(t + step) % 12]);
  }

  // ---------- Estado ----------
  let currentKey = loadKey();
  let bpm = loadBpm();
  let audioCtx = null;
  let running = false;
  let timerId = null;
  let nextBeatTime = 0;
  let beatInCycle = 0;
  let currentDegree = null;
  let lastDegree = null;
  const visualQueue = [];
  let rafId = null;

  function loadKey() {
    try {
      const k = localStorage.getItem("nns-key");
      if (KEYS.includes(k)) return k;
    } catch (_) {}
    return "C";
  }
  function loadBpm() {
    try {
      const v = parseInt(localStorage.getItem("nns-bpm"), 10);
      if (v >= BPM_MIN && v <= BPM_MAX) return v;
    } catch (_) {}
    return BPM_DEFAULT;
  }
  function saveBpm(v) {
    try { localStorage.setItem("nns-bpm", String(v)); } catch (_) {}
  }
  function saveKey(k) {
    try { localStorage.setItem("nns-key", k); } catch (_) {}
  }

  function randomDegree() {
    let d;
    do { d = 1 + Math.floor(Math.random() * 7); } while (d === lastDegree);
    lastDegree = d;
    return d;
  }

  // ---------- Elementos ----------
  const $ = (id) => document.getElementById(id);
  const numberEl = $("number");
  const noteEl = $("note");
  const barInfoEl = $("barInfo");
  const startBtn = $("startBtn");
  const beatsEl = $("beats");
  const keyLabel = $("keyLabel");
  const drawer = $("drawer");
  const backdrop = $("backdrop");
  const keyGrid = $("keyGrid");
  const scalePreview = $("scalePreview");

  // Indicador de tempos: 4 compassos x 4 tempos
  const bars = [];
  const dots = [];
  for (let b = 0; b < BARS_PER_NOTE; b++) {
    const bar = document.createElement("div");
    bar.className = "bar";
    for (let i = 0; i < BEATS_PER_BAR; i++) {
      const dot = document.createElement("span");
      dot.className = "dot";
      bar.appendChild(dot);
      dots.push(dot);
    }
    beatsEl.appendChild(bar);
    bars.push(bar);
  }

  // ---------- Áudio ----------
  function click(time, kind) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const freq = kind === "cycle" ? 1760 : kind === "bar" ? 1320 : 880;
    const vol = kind === "beat" ? 0.35 : 0.6;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(vol, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.07);
  }

  function scheduleBeat(beat, time) {
    if (beat === 0) currentDegree = randomDegree();
    const kind = beat === 0 ? "cycle" : beat % BEATS_PER_BAR === 0 ? "bar" : "beat";
    click(time, kind);
    visualQueue.push({ beat, time, degree: currentDegree });
  }

  function scheduler() {
    while (nextBeatTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
      scheduleBeat(beatInCycle, nextBeatTime);
      nextBeatTime += 60 / bpm;
      beatInCycle = (beatInCycle + 1) % BEATS_PER_CYCLE;
    }
  }

  // ---------- Visual ----------
  let shownDegree = null;

  function render(ev) {
    const bar = Math.floor(ev.beat / BEATS_PER_BAR); // 0..3
    const beatInBar = ev.beat % BEATS_PER_BAR;

    if (ev.beat === 0) {
      shownDegree = ev.degree;
      numberEl.textContent = ev.degree;
      numberEl.classList.remove("pop");
      void numberEl.offsetWidth;
      numberEl.classList.add("pop");
      noteEl.classList.remove("show");
    }
    if (bar >= NOTE_REVEAL_BAR - 1 && shownDegree != null) {
      noteEl.textContent = (majorScale(currentKey)[shownDegree - 1]);
      noteEl.classList.add("show");
    }

    bars.forEach((el, i) => el.classList.toggle("current", i === bar));
    dots.forEach((d, i) => d.classList.toggle("on", i <= ev.beat));
    barInfoEl.textContent = `Compasso ${bar + 1} de ${BARS_PER_NOTE} · tempo ${beatInBar + 1}`;
  }

  function draw() {
    const now = audioCtx.currentTime;
    let latest = null;
    while (visualQueue.length && visualQueue[0].time <= now) latest = visualQueue.shift();
    if (latest) render(latest);
    rafId = requestAnimationFrame(draw);
  }

  // ---------- Controle ----------
  async function start() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    running = true;
    beatInCycle = 0;
    lastDegree = null;
    visualQueue.length = 0;
    nextBeatTime = audioCtx.currentTime + 0.1;
    scheduler();
    timerId = setInterval(scheduler, LOOKAHEAD_MS);
    rafId = requestAnimationFrame(draw);
    startBtn.textContent = "Parar";
    startBtn.classList.add("running");
  }

  function stop() {
    running = false;
    clearInterval(timerId);
    cancelAnimationFrame(rafId);
    visualQueue.length = 0;
    shownDegree = null;
    numberEl.textContent = "–";
    noteEl.classList.remove("show");
    bars.forEach((el) => el.classList.remove("current"));
    dots.forEach((d) => d.classList.remove("on"));
    barInfoEl.textContent = "Pronto";
    startBtn.textContent = "Iniciar";
    startBtn.classList.remove("running");
  }

  startBtn.addEventListener("click", () => (running ? stop() : start()));
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !drawer.classList.contains("open")) {
      e.preventDefault();
      running ? stop() : start();
    } else if (e.key === "Escape") {
      closeDrawer();
    }
  });

  // ---------- Pop-up lateral de tom ----------
  function renderKeys() {
    keyGrid.innerHTML = "";
    KEYS.forEach((k) => {
      const b = document.createElement("button");
      b.textContent = (k);
      b.classList.toggle("active", k === currentKey);
      b.addEventListener("click", () => setKey(k));
      keyGrid.appendChild(b);
    });
    keyLabel.textContent = (currentKey);
    scalePreview.innerHTML = majorScale(currentKey)
      .map((n, i) => `<div><div class="deg">${i + 1}</div>${(n)}</div>`)
      .join("");
  }

  function setKey(k) {
    currentKey = k;
    saveKey(k);
    renderKeys();
    // Se a nota já está visível, atualiza para o novo tom
    if (shownDegree != null && noteEl.classList.contains("show")) {
      noteEl.textContent = (majorScale(currentKey)[shownDegree - 1]);
    }
  }

  function openDrawer() {
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    backdrop.hidden = false;
  }
  function closeDrawer() {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
  }

  $("keyBtn").addEventListener("click", openDrawer);
  $("closeDrawer").addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);

  // ---------- Slider de BPM ----------
  const bpmSlider = $("bpmSlider");
  const bpmValue = $("bpmValue");
  bpmSlider.min = BPM_MIN;
  bpmSlider.max = BPM_MAX;
  bpmSlider.value = bpm;
  bpmValue.textContent = bpm;
  bpmSlider.addEventListener("input", () => {
    bpm = parseInt(bpmSlider.value, 10);
    bpmValue.textContent = bpm;
    saveBpm(bpm);
  });

  renderKeys();

  // Exposto para testes
  window.__nns = { majorScale, KEYS };
})();
