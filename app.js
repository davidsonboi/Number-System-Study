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
  const LISTEN_BAR = 2; // com microfone: você toca no 2º compasso
  const FEEDBACK_BAR = 4; // e o resultado aparece no 4º
  const CLICK_IGNORE = 0.12; // s ignorados após cada clique (evita captar o metrônomo)
  const MIN_VOICED_FRAMES = 4;
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.1; // segundos

  // ---------- Teoria ----------
  // Tons maiores com a grafia usual: cada grau usa uma letra diferente,
  // então F tem Bb (e não A#), D tem F#, etc.
  const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

  function pitchClass(name) {
    let pc = LETTER_PC[name[0]];
    for (const ch of name.slice(1)) pc += ch === "#" ? 1 : ch === "b" ? -1 : 0;
    return ((pc % 12) + 12) % 12;
  }

  function majorScale(tonic) {
    const tonicPc = pitchClass(tonic);
    const startLetter = LETTERS.indexOf(tonic[0]);
    return MAJOR_STEPS.map((step, i) => {
      const letter = LETTERS[(startLetter + i) % 7];
      const target = (tonicPc + step) % 12;
      let diff = (target - LETTER_PC[letter] + 12) % 12;
      if (diff > 6) diff -= 12;
      return letter + (diff > 0 ? "#".repeat(diff) : "b".repeat(-diff));
    });
  }

  // Campo harmônico maior: o número é sempre o grau (sem "m"),
  // mas o acorde tem a qualidade do grau: 2, 3, 6 e 7 menores.
  // Ex.: em C, 2 = Dm, 6 = Am, 7 = Bm.
  const QUALITIES = ["", "m", "m", "", "", "m", "m"];

  function chordName(tonic, degree) {
    return pretty(majorScale(tonic)[degree - 1]) + QUALITIES[degree - 1];
  }

  // Nome de uma classe de altura qualquer, usando a grafia do tom quando possível
  const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  function pitchClassName(tonic, pc) {
    const inScale = majorScale(tonic).find((n) => pitchClass(n) === pc);
    if (inScale) return pretty(inScale);
    const flatKey = tonic === "F" || tonic.includes("b");
    return pretty((flatKey ? FLAT_NAMES : SHARP_NAMES)[pc]);
  }

  // Exibe bemol com o símbolo ♭ (sustenido continua #)
  const pretty = (n) => n[0] + n.slice(1).replace(/b/g, "♭");

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

  // Microfone
  let micOn = false;
  let micStream = null;
  let analyser = null;
  let micBuf = null;
  let listening = false;
  let heardWindow = false; // o 2º compasso inteiro foi escutado neste ciclo
  let votes = new Array(12).fill(0);
  let voicedFrames = 0;
  let result = null; // { heard: pc | null, correct: bool }
  let lastBeatTime = -Infinity;
  let score = { hits: 0, total: 0 };

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
  const micBtn = $("micBtn");
  const feedbackEl = $("feedback");
  const scoreEl = $("score");

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

    lastBeatTime = ev.time;

    if (ev.beat === 0) {
      resetFeedback();
      shownDegree = ev.degree;
      numberEl.textContent = ev.degree;
      numberEl.classList.remove("pop");
      void numberEl.offsetWidth;
      numberEl.classList.add("pop");
      noteEl.classList.remove("show");
    }
    if (bar >= NOTE_REVEAL_BAR - 1 && shownDegree != null) {
      noteEl.textContent = chordName(currentKey, shownDegree);
      noteEl.classList.add("show");
    }

    if (micOn && beatInBar === 0) {
      if (bar === LISTEN_BAR - 1) startListening();
      else if (bar === LISTEN_BAR && listening) finishListening();
      else if (bar === FEEDBACK_BAR - 1) showFeedback();
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
    if (listening) analyzeFrame(now);
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
    score = { hits: 0, total: 0 };
    updateScore();
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
    resetFeedback();
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

  // ---------- Microfone ----------
  function resetFeedback() {
    listening = false;
    heardWindow = false;
    result = null;
    noteEl.classList.remove("correct", "wrong");
    feedbackEl.textContent = "";
    feedbackEl.className = "feedback";
  }

  function startListening() {
    votes = new Array(12).fill(0);
    voicedFrames = 0;
    listening = true;
    heardWindow = true;
    feedbackEl.textContent = "Ouvindo…";
    feedbackEl.className = "feedback listening";
  }

  function analyzeFrame(now) {
    // Ignora o instante de cada clique para não confundir o metrônomo com a nota
    if (now - lastBeatTime < CLICK_IGNORE) return;
    analyser.getFloatTimeDomainData(micBuf);
    const r = Pitch.detectPitch(micBuf, audioCtx.sampleRate);
    if (!r) return;
    votes[Pitch.freqToPitchClass(r.freq)] += r.clarity;
    voicedFrames++;
  }

  function finishListening() {
    listening = false;
    feedbackEl.textContent = "";
    feedbackEl.className = "feedback";
    if (!heardWindow || shownDegree == null) return;
    let heard = null;
    if (voicedFrames >= MIN_VOICED_FRAMES) {
      heard = votes.indexOf(Math.max(...votes));
    }
    const target = pitchClass(majorScale(currentKey)[shownDegree - 1]);
    result = { heard, correct: heard === target };
  }

  function showFeedback() {
    if (!result) return;
    noteEl.classList.add(result.correct ? "correct" : "wrong");
    if (result.heard == null) {
      feedbackEl.textContent = "Não ouvi nenhuma nota";
    } else if (result.correct) {
      feedbackEl.textContent = "Certo!";
    } else {
      feedbackEl.textContent = `Você tocou ${pitchClassName(currentKey, result.heard)}`;
    }
    feedbackEl.className = "feedback " + (result.correct ? "correct" : "wrong");
    score.total++;
    if (result.correct) score.hits++;
    updateScore();
  }

  function updateScore() {
    scoreEl.hidden = !micOn;
    scoreEl.textContent = `Acertos: ${score.hits}/${score.total}`;
  }

  async function enableMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("O microfone só funciona em páginas https (ex.: GitHub Pages) ou em localhost.");
      return;
    }
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
    } catch (err) {
      alert("Não foi possível acessar o microfone. Verifique a permissão do navegador.");
      return;
    }
    const source = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    micBuf = new Float32Array(analyser.fftSize);
    source.connect(analyser);
    micOn = true;
    micBtn.classList.add("on");
    micBtn.setAttribute("aria-pressed", "true");
    updateScore();
  }

  function disableMic() {
    micOn = false;
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
    analyser = null;
    resetFeedback();
    micBtn.classList.remove("on");
    micBtn.setAttribute("aria-pressed", "false");
    updateScore();
  }

  micBtn.addEventListener("click", () => (micOn ? disableMic() : enableMic()));

  // ---------- Pop-up lateral de tom ----------
  function renderKeys() {
    keyGrid.innerHTML = "";
    KEYS.forEach((k) => {
      const b = document.createElement("button");
      b.textContent = pretty(k);
      b.classList.toggle("active", k === currentKey);
      b.addEventListener("click", () => setKey(k));
      keyGrid.appendChild(b);
    });
    keyLabel.textContent = pretty(currentKey);
    scalePreview.innerHTML = MAJOR_STEPS
      .map((_, i) => `<div><div class="deg">${i + 1}</div>${chordName(currentKey, i + 1)}</div>`)
      .join("");
  }

  function setKey(k) {
    currentKey = k;
    saveKey(k);
    renderKeys();
    // Se a nota já está visível, atualiza para o novo tom
    if (shownDegree != null && noteEl.classList.contains("show")) {
      noteEl.textContent = chordName(currentKey, shownDegree);
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
  window.__nns = { majorScale, chordName, KEYS };
})();
