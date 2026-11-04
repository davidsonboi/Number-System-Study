(() => {
  "use strict";

  const T = window.Theory;

  // ---------- Configuração ----------
  const BPM_MIN = 40;
  const BPM_MAX = 200;
  const BPM_DEFAULT = 90;
  const BEATS_PER_BAR = 4;
  const RANDOM_BARS = 4; // aleatório: 4 compassos por nota
  const RANDOM_REVEAL_BAR = 2; // acorde aparece no 3º compasso (índice 2)
  const LINE_SIZE = 4; // progressões/músicas: até 4 acordes por linha
  const LOOKAHEAD_MS = 25;
  const SCHEDULE_AHEAD = 0.1; // segundos

  const PROGRESSIONS = [
    { id: "1564", degrees: [1, 5, 6, 4] },
    { id: "1645", degrees: [1, 6, 4, 5] },
    { id: "6415", degrees: [6, 4, 1, 5] },
    { id: "1451", degrees: [1, 4, 5, 1] },
    { id: "1465", degrees: [1, 4, 6, 5] },
    { id: "4156", degrees: [4, 1, 5, 6] },
    { id: "251", degrees: [2, 5, 1] },
    { id: "1625", degrees: [1, 6, 2, 5] },
    { id: "3625", degrees: [3, 6, 2, 5] },
  ];

  const HINTS = {
    random: "Número no 1º compasso, acorde no 3º · 4 compassos por nota",
    progressions: "Primeiro os números (1 por compasso), depois os acordes",
    song: "Cada acorde da cifra = 1 compasso · números primeiro, depois os acordes",
  };

  // ---------- Armazenamento ----------
  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch (_) {
      return fallback;
    }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  // ---------- Estado ----------
  let currentKey = T.KEYS.includes(load("nns-key2", "C")) ? load("nns-key2", "C") : "C";
  let bpm = (() => {
    const v = load("nns-bpm2", BPM_DEFAULT);
    return v >= BPM_MIN && v <= BPM_MAX ? v : BPM_DEFAULT;
  })();
  let mode = ["random", "progressions", "song"].includes(load("nns-mode", "random"))
    ? load("nns-mode", "random")
    : "random";
  let enabledProgs = load("nns-progs", PROGRESSIONS.map((p) => p.id));
  let playChords = load("nns-chords", true);
  let song = null; // { name, text, chords: [relativos] }
  let savedSongs = load("nns-songs", []);
  let songLine = 0;

  let audioCtx = null;
  let chordBus = null;
  let running = false;
  let timerId = null;
  let rafId = null;
  let nextBeatTime = 0;
  let beatInCycle = 0;
  let schedCycle = null;
  let lastDegree = null;
  let lastProg = null;
  const visualQueue = [];
  let shownCycle = null;

  // ---------- Elementos ----------
  const $ = (id) => document.getElementById(id);
  const cardEl = $("card");
  const barInfoEl = $("barInfo");
  const startBtn = $("startBtn");
  const beatsEl = $("beats");
  const keyLabel = $("keyLabel");
  const drawer = $("drawer");
  const backdrop = $("backdrop");
  const keyGrid = $("keyGrid");
  const scalePreview = $("scalePreview");
  const hintEl = $("hint");
  const progList = $("progList");
  const songText = $("songText");
  const songName = $("songName");
  const songPreview = $("songPreview");
  const songList = $("songList");
  const chordToggle = $("chordToggle");

  // ---------- Ciclos ----------
  // Um ciclo é o bloco que se repete: no modo aleatório, 1 nota em 4 compassos;
  // nos outros, uma linha de até 4 acordes: N compassos de números + N de acordes.
  function randomDegree() {
    let d;
    do { d = 1 + Math.floor(Math.random() * 7); } while (d === lastDegree);
    lastDegree = d;
    return d;
  }

  function pickProgression() {
    let pool = PROGRESSIONS.filter((p) => enabledProgs.includes(p.id));
    if (!pool.length) pool = PROGRESSIONS;
    if (pool.length > 1) pool = pool.filter((p) => p !== lastProg);
    const p = pool[Math.floor(Math.random() * pool.length)];
    lastProg = p;
    return p;
  }

  function songLines() {
    const lines = [];
    for (let i = 0; i < song.chords.length; i += LINE_SIZE) {
      lines.push(song.chords.slice(i, i + LINE_SIZE));
    }
    return lines;
  }

  function nextCycle() {
    if (mode === "progressions") {
      const p = pickProgression();
      const items = p.degrees.map(T.diatonic);
      return { type: "row", items, bars: items.length * 2, title: "Progressão " + p.degrees.join("–") };
    }
    if (mode === "song" && song && song.chords.length) {
      const lines = songLines();
      if (songLine >= lines.length) songLine = 0;
      const items = lines[songLine];
      const title = `${song.name || "Música"} · linha ${songLine + 1} de ${lines.length}`;
      songLine = (songLine + 1) % lines.length;
      return { type: "row", items, bars: items.length * 2, title };
    }
    return { type: "single", items: [T.diatonic(randomDegree())], bars: RANDOM_BARS, title: "" };
  }

  // Qual acorde soa em cada compasso, e por quantos compassos
  function chordForBar(cycle, bar) {
    if (cycle.type === "single") {
      return bar === RANDOM_REVEAL_BAR ? { chord: cycle.items[0], bars: RANDOM_BARS - RANDOM_REVEAL_BAR } : null;
    }
    const n = cycle.items.length;
    return bar >= n ? { chord: cycle.items[bar - n], bars: 1 } : null;
  }

  // ---------- Áudio ----------
  function ensureAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function click(time, kind) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = kind === "cycle" ? 1760 : kind === "bar" ? 1320 : 880;
    const vol = kind === "beat" ? 0.35 : 0.6;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(vol, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.07);
  }

  function midiToFreq(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  // Toca o acorde com um timbre simples de teclado (baixo + tríade em posição fechada)
  function playChord(time, chord, duration) {
    const rootPc = T.pitchClass(T.degreeRoot(currentKey, chord.deg, chord.acc));
    const bassPc = chord.bass ? T.pitchClass(T.degreeRoot(currentKey, chord.bass.deg, chord.bass.acc)) : rootPc;
    const notes = [40 + ((bassPc - 4 + 12) % 12)]; // baixo entre E2 e D#3
    T.chordIntervals(chord.suffix).forEach((iv) => {
      notes.push(52 + ((rootPc + iv - 4 + 120) % 12)); // vozes entre E3 e D#4
    });
    notes.sort((a, b) => a - b);

    const end = time + duration;
    notes.forEach((midi, i) => {
      const t = time + i * 0.012; // leve "strum"
      const filter = audioCtx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.setValueAtTime(2400, t);
      filter.frequency.exponentialRampToValueAtTime(900, t + 1.2);
      const gain = audioCtx.createGain();
      const peak = i === 0 ? 0.16 : 0.1;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.9);
      gain.gain.setValueAtTime(peak * 0.35, Math.max(t + 0.9, end - 0.12));
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      filter.connect(gain).connect(chordBus);
      ["triangle", "sawtooth"].forEach((type) => {
        const osc = audioCtx.createOscillator();
        osc.type = type;
        osc.frequency.value = midiToFreq(midi);
        const g = audioCtx.createGain();
        g.gain.value = type === "sawtooth" ? 0.25 : 1;
        osc.connect(g).connect(filter);
        osc.start(t);
        osc.stop(end + 0.05);
      });
    });
  }

  function scheduleBeat(beat, time) {
    if (beat === 0) schedCycle = nextCycle();
    const kind = beat === 0 ? "cycle" : beat % BEATS_PER_BAR === 0 ? "bar" : "beat";
    click(time, kind);
    if (playChords && beat % BEATS_PER_BAR === 0) {
      const c = chordForBar(schedCycle, beat / BEATS_PER_BAR);
      if (c) playChord(time, c.chord, (c.bars * BEATS_PER_BAR * 60) / bpm);
    }
    visualQueue.push({ beat, time, cycle: schedCycle });
  }

  function scheduler() {
    while (nextBeatTime < audioCtx.currentTime + SCHEDULE_AHEAD) {
      scheduleBeat(beatInCycle, nextBeatTime);
      nextBeatTime += 60 / bpm;
      beatInCycle = (beatInCycle + 1) % (schedCycle.bars * BEATS_PER_BAR);
    }
  }

  // ---------- Visual ----------
  let barEls = [];
  let dotEls = [];

  function buildBeats(bars) {
    beatsEl.innerHTML = "";
    barEls = [];
    dotEls = [];
    for (let b = 0; b < bars; b++) {
      const bar = document.createElement("div");
      bar.className = "bar";
      for (let i = 0; i < BEATS_PER_BAR; i++) {
        const dot = document.createElement("span");
        dot.className = "dot";
        bar.appendChild(dot);
        dotEls.push(dot);
      }
      beatsEl.appendChild(bar);
      barEls.push(bar);
    }
  }

  function buildCard(cycle) {
    cardEl.innerHTML = "";
    cardEl.className = "card " + cycle.type;
    if (cycle.type === "single") {
      cardEl.innerHTML = `<div class="number pop"></div><div class="note"></div>`;
      cardEl.querySelector(".number").textContent = T.chordNumber(cycle.items[0]);
    } else {
      const row = document.createElement("div");
      row.className = "row";
      cycle.items.forEach((c) => {
        const slot = document.createElement("div");
        slot.className = "slot";
        slot.innerHTML = `<div class="num"></div><div class="chord"></div>`;
        slot.querySelector(".num").textContent = T.chordNumber(c);
        row.appendChild(slot);
      });
      cardEl.appendChild(row);
    }
  }

  // Atualiza os nomes dos acordes (ex.: depois de trocar o tom)
  function refreshChordNames() {
    if (!shownCycle) return;
    if (shownCycle.type === "single") {
      const n = cardEl.querySelector(".note");
      if (n) n.textContent = T.chordText(currentKey, shownCycle.items[0]);
    } else {
      cardEl.querySelectorAll(".chord").forEach((el, i) => {
        el.textContent = T.chordText(currentKey, shownCycle.items[i]);
      });
    }
  }

  function render(ev) {
    const cycle = ev.cycle;
    const bar = Math.floor(ev.beat / BEATS_PER_BAR);
    const beatInBar = ev.beat % BEATS_PER_BAR;

    if (ev.beat === 0 || cycle !== shownCycle) {
      shownCycle = cycle;
      buildCard(cycle);
      buildBeats(cycle.bars);
      refreshChordNames();
    }

    if (cycle.type === "single") {
      cardEl.querySelector(".note").classList.toggle("show", bar >= RANDOM_REVEAL_BAR);
      barInfoEl.textContent = `Compasso ${bar + 1} de ${cycle.bars} · tempo ${beatInBar + 1}`;
    } else {
      const n = cycle.items.length;
      const pass2 = bar >= n;
      const pos = pass2 ? bar - n : bar;
      cardEl.querySelectorAll(".slot").forEach((slot, i) => {
        slot.classList.toggle("current", i === pos);
        slot.querySelector(".chord").classList.toggle("show", pass2 && i <= pos);
      });
      barInfoEl.textContent = `${cycle.title} · ${pass2 ? "acordes" : "números"} · compasso ${bar + 1} de ${cycle.bars}`;
    }

    barEls.forEach((el, i) => el.classList.toggle("current", i === bar));
    dotEls.forEach((d, i) => d.classList.toggle("on", i <= ev.beat));
  }

  function draw() {
    const now = audioCtx.currentTime;
    let latest = null;
    while (visualQueue.length && visualQueue[0].time <= now) latest = visualQueue.shift();
    if (latest) render(latest);
    rafId = requestAnimationFrame(draw);
  }

  function showIdle() {
    shownCycle = null;
    cardEl.className = "card single";
    cardEl.innerHTML = `<div class="number">–</div><div class="note"></div>`;
    buildBeats(mode === "random" ? RANDOM_BARS : LINE_SIZE * 2);
    if (mode === "song" && !(song && song.chords.length)) {
      barInfoEl.textContent = "Cole uma cifra em Ajustes para usar o modo Música";
    } else {
      barInfoEl.textContent = "Pronto";
    }
  }

  // ---------- Controle ----------
  async function start() {
    ensureAudio();
    if (audioCtx.state === "suspended") await audioCtx.resume();
    chordBus = audioCtx.createGain();
    chordBus.connect(audioCtx.destination);
    running = true;
    beatInCycle = 0;
    lastDegree = null;
    lastProg = null;
    songLine = 0;
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
    if (chordBus) {
      // Silencia acordes que ainda estavam soando
      const now = audioCtx.currentTime;
      chordBus.gain.setValueAtTime(chordBus.gain.value, now);
      chordBus.gain.linearRampToValueAtTime(0, now + 0.05);
    }
    showIdle();
    startBtn.textContent = "Iniciar";
    startBtn.classList.remove("running");
  }

  startBtn.addEventListener("click", () => (running ? stop() : start()));
  document.addEventListener("keydown", (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.code === "Space" && !typing && !drawer.classList.contains("open")) {
      e.preventDefault();
      running ? stop() : start();
    } else if (e.key === "Escape") {
      closeDrawer();
    }
  });

  // ---------- Modo ----------
  const modeBtns = document.querySelectorAll("[data-mode]");
  function setMode(m) {
    mode = m;
    save("nns-mode", m);
    modeBtns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === m)));
    hintEl.textContent = HINTS[m];
    $("progSection").hidden = m !== "progressions";
    $("songSection").hidden = m !== "song";
    if (!running) showIdle();
  }
  modeBtns.forEach((b) =>
    b.addEventListener("click", () => {
      setMode(b.dataset.mode);
      if (b.dataset.mode === "song" && !(song && song.chords.length)) openDrawer("songSection");
    })
  );

  // ---------- Tom ----------
  function renderKeys() {
    keyGrid.innerHTML = "";
    T.KEYS.forEach((k) => {
      const b = document.createElement("button");
      b.textContent = T.prettyNote(k);
      b.classList.toggle("active", k === currentKey);
      b.addEventListener("click", () => setKey(k));
      keyGrid.appendChild(b);
    });
    keyLabel.textContent = T.prettyNote(currentKey);
    scalePreview.innerHTML = T.MAJOR_STEPS.map(
      (_, i) => `<div><div class="deg">${i + 1}</div>${T.chordText(currentKey, T.diatonic(i + 1))}</div>`
    ).join("");
  }

  function setKey(k) {
    currentKey = k;
    save("nns-key2", k);
    renderKeys();
    refreshChordNames();
    renderSongPreview();
    renderProgs();
  }

  // ---------- Progressões ----------
  function renderProgs() {
    progList.innerHTML = "";
    PROGRESSIONS.forEach((p) => {
      const label = document.createElement("label");
      label.className = "check";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = enabledProgs.includes(p.id);
      cb.addEventListener("change", () => {
        enabledProgs = PROGRESSIONS.filter((q) =>
          q === p ? cb.checked : enabledProgs.includes(q.id)
        ).map((q) => q.id);
        save("nns-progs", enabledProgs);
      });
      const span = document.createElement("span");
      span.innerHTML = `<strong>${p.degrees.join(" – ")}</strong> <small></small>`;
      span.querySelector("small").textContent = p.degrees
        .map((d) => T.chordText(currentKey, T.diatonic(d)))
        .join(" ");
      label.append(cb, span);
      progList.appendChild(label);
    });
  }

  // ---------- Música ----------
  function makeSong(name, text) {
    const abs = T.parseChart(text);
    if (!abs.length) return null;
    const key = T.detectKey(abs);
    return { name: name.trim(), text, key, chords: T.relativize(key, abs) };
  }

  function useSong(s, { setDetectedKey = true } = {}) {
    song = s;
    songLine = 0;
    save("nns-song", { name: s.name, text: s.text });
    if (setDetectedKey) setKey(s.key);
    renderSongPreview();
    if (!running) showIdle();
  }

  function renderSongPreview() {
    if (!song) {
      songPreview.innerHTML = "";
      return;
    }
    const lines = [];
    for (let i = 0; i < song.chords.length; i += LINE_SIZE) {
      const part = song.chords.slice(i, i + LINE_SIZE);
      lines.push(
        `<div class="pline">${part
          .map((c) => `<span><b>${T.chordNumber(c)}</b>${T.chordText(currentKey, c)}</span>`)
          .join("")}</div>`
      );
    }
    songPreview.innerHTML =
      `<p class="muted">Tom detectado: <strong>${T.prettyNote(song.key)}</strong> · ` +
      `${song.chords.length} acordes. Troque o tom acima para transpor.</p>` +
      lines.join("");
  }

  function renderSongList() {
    songList.innerHTML = "";
    if (!savedSongs.length) {
      songList.innerHTML = `<li class="muted">Nenhuma música salva.</li>`;
      return;
    }
    savedSongs.forEach((s, idx) => {
      const li = document.createElement("li");
      const loadBtn = document.createElement("button");
      loadBtn.className = "link";
      loadBtn.textContent = s.name;
      loadBtn.addEventListener("click", () => {
        songText.value = s.text;
        songName.value = s.name;
        const parsed = makeSong(s.name, s.text);
        if (parsed) useSong(parsed);
      });
      const del = document.createElement("button");
      del.className = "del";
      del.setAttribute("aria-label", "Apagar " + s.name);
      del.textContent = "×";
      del.addEventListener("click", () => {
        savedSongs.splice(idx, 1);
        save("nns-songs", savedSongs);
        renderSongList();
      });
      li.append(loadBtn, del);
      songList.appendChild(li);
    });
  }

  $("songUse").addEventListener("click", () => {
    const s = makeSong(songName.value, songText.value);
    if (!s) {
      songPreview.innerHTML = `<p class="error">Nenhum acorde encontrado. Cole a cifra com os acordes separados por espaço.</p>`;
      return;
    }
    useSong(s);
  });

  $("songSave").addEventListener("click", () => {
    const s = makeSong(songName.value, songText.value);
    if (!s) {
      songPreview.innerHTML = `<p class="error">Nenhum acorde encontrado.</p>`;
      return;
    }
    if (!s.name) {
      songName.focus();
      songPreview.innerHTML = `<p class="error">Dê um nome à música para salvar.</p>`;
      return;
    }
    const existing = savedSongs.findIndex((x) => x.name === s.name);
    const entry = { name: s.name, text: s.text };
    if (existing >= 0) savedSongs[existing] = entry;
    else savedSongs.push(entry);
    save("nns-songs", savedSongs);
    renderSongList();
    useSong(s);
  });

  // ---------- Som ----------
  chordToggle.checked = playChords;
  chordToggle.addEventListener("change", () => {
    playChords = chordToggle.checked;
    save("nns-chords", playChords);
  });

  // ---------- Pop-up lateral ----------
  function openDrawer(sectionId) {
    drawer.classList.add("open");
    drawer.setAttribute("aria-hidden", "false");
    backdrop.hidden = false;
    if (sectionId) {
      const el = $(sectionId);
      if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
    }
  }
  function closeDrawer() {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
  }

  $("keyBtn").addEventListener("click", () => openDrawer());
  $("closeDrawer").addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);

  // ---------- BPM ----------
  const bpmSlider = $("bpmSlider");
  const bpmValue = $("bpmValue");
  bpmSlider.min = BPM_MIN;
  bpmSlider.max = BPM_MAX;
  bpmSlider.value = bpm;
  bpmValue.textContent = bpm;
  bpmSlider.addEventListener("input", () => {
    bpm = parseInt(bpmSlider.value, 10);
    bpmValue.textContent = bpm;
    save("nns-bpm2", bpm);
  });

  // ---------- Início ----------
  const storedSong = load("nns-song", null);
  if (storedSong && storedSong.text) {
    songText.value = storedSong.text;
    songName.value = storedSong.name || "";
    const s = makeSong(storedSong.name || "", storedSong.text);
    if (s) {
      song = s;
      renderSongPreview();
    }
  }
  renderKeys();
  renderProgs();
  renderSongList();
  setMode(mode);

  // App instalável / offline
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
