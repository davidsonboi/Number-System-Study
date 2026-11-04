// Teoria musical: escalas, graus, leitura de cifras e detecção de tom.
(function (root) {
  "use strict";

  // Tons maiores com a grafia usual: cada grau usa uma letra diferente,
  // então F tem Bb (e não A#), D tem F#, etc.
  const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  // Ordem de preferência em caso de empate na detecção de tom
  const KEY_PREFERENCE = ["C", "G", "D", "A", "E", "F", "Bb", "Eb", "B", "Ab", "Db", "F#"];
  const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

  // Campo harmônico maior: o número é sempre o grau (sem "m"),
  // mas o acorde tem a qualidade do grau: 2, 3, 6 e 7 menores.
  const QUALITIES = ["", "m", "m", "", "", "m", "m"];

  // Distância em semitons a partir da tônica -> [grau, acidente]
  const OFFSET_TO_DEGREE = [
    [1, 0], [2, -1], [2, 0], [3, -1], [3, 0], [4, 0],
    [4, 1], [5, 0], [6, -1], [6, 0], [7, -1], [7, 0],
  ];

  const mod12 = (n) => ((n % 12) + 12) % 12;

  function pitchClass(name) {
    let pc = LETTER_PC[name[0]];
    for (const ch of name.slice(1)) pc += ch === "#" ? 1 : ch === "b" ? -1 : 0;
    return mod12(pc);
  }

  function majorScale(tonic) {
    const tonicPc = pitchClass(tonic);
    const startLetter = LETTERS.indexOf(tonic[0]);
    return MAJOR_STEPS.map((step, i) => {
      const letter = LETTERS[(startLetter + i) % 7];
      const target = (tonicPc + step) % 12;
      let diff = mod12(target - LETTER_PC[letter]);
      if (diff > 6) diff -= 12;
      return letter + (diff > 0 ? "#".repeat(diff) : "b".repeat(-diff));
    });
  }

  function addAccidental(name, acc) {
    let n = name;
    for (; acc < 0; acc++) n = n.endsWith("#") ? n.slice(0, -1) : n + "b";
    for (; acc > 0; acc--) n = n.endsWith("b") ? n.slice(0, -1) : n + "#";
    return n;
  }

  // Exibe bemol com ♭ (sustenido continua #)
  const prettyNote = (n) => n[0] + n.slice(1).replace(/b/g, "♭");
  const prettySuffix = (s) => s.replace(/b(?=\d)/g, "♭");

  // ---------- Acordes relativos ao tom ----------
  // { deg: 1..7, acc: -1|0|1, suffix: "m7", bass: {deg, acc} | null }
  function diatonic(deg) {
    return { deg, acc: 0, suffix: QUALITIES[deg - 1], bass: null };
  }

  function degreeRoot(key, deg, acc) {
    return addAccidental(majorScale(key)[deg - 1], acc);
  }

  function degreeLabel(deg, acc) {
    return (acc < 0 ? "♭" : acc > 0 ? "#" : "") + deg;
  }

  // Número do Nashville (sem "m"; com baixo quando houver: 1/3)
  function chordNumber(c) {
    return degreeLabel(c.deg, c.acc) + (c.bass ? "/" + degreeLabel(c.bass.deg, c.bass.acc) : "");
  }

  // Nome do acorde no tom escolhido
  function chordText(key, c) {
    return (
      prettyNote(degreeRoot(key, c.deg, c.acc)) +
      prettySuffix(c.suffix) +
      (c.bass ? "/" + prettyNote(degreeRoot(key, c.bass.deg, c.bass.acc)) : "")
    );
  }

  function isMinorSuffix(s) {
    return /^(m(?!aj)|min|-)/.test(s) || /dim|°|ø/.test(s);
  }

  // Intervalos (semitons) para tocar o acorde
  function chordIntervals(suffix) {
    const s = suffix;
    let third = isMinorSuffix(s) ? 3 : 4;
    const fifth = /dim|°|b5|ø/.test(s) ? 6 : /aug|\+|#5/.test(s) ? 8 : 7;
    if (/sus2/.test(s)) third = 2;
    else if (/sus/.test(s)) third = 5;
    const iv = [0, third, fifth];
    if (/maj7|M7|7M|7\+|Δ/.test(s)) iv.push(11);
    else if (/(dim|°)7/.test(s)) iv.push(9);
    else if (/7|9|11|13|ø/.test(s)) iv.push(10);
    else if (/6/.test(s)) iv.push(9);
    return iv;
  }

  // ---------- Leitura de cifras ----------
  const CHORD_RE = /^([A-G])([#b♯♭]?)([^/]*)(?:\/([A-G])([#b♯♭]?))?$/;
  const SUFFIX_RE = /^(m|min|maj|M|dim|aug|sus|add|no|°|ø|Δ|\+|-|\d|b|#|♭|♯|\(|\)|,|\.)*$/;
  const IGNORE_TOKEN_RE = /^(\|+|:?\|+:?|-+|–|\(?x?\d+x?\)?|%|\.+|\/|\(|\))$/i;

  const normAcc = (a) => (a === "♯" ? "#" : a === "♭" ? "b" : a || "");

  function parseChord(tok) {
    const m = CHORD_RE.exec(tok);
    if (!m || !SUFFIX_RE.test(m[3])) return null;
    const suffix = m[3].replace(/♭/g, "b").replace(/♯/g, "#").replace(/^min/, "m");
    return {
      rootPc: pitchClass(m[1] + normAcc(m[2])),
      suffix,
      bassPc: m[4] ? pitchClass(m[4] + normAcc(m[5])) : null,
    };
  }

  // Lê uma cifra colada (com ou sem letra). Linhas que não são só acordes
  // (ex.: letra da música) são ignoradas. Um acorde = um compasso.
  function parseChart(text) {
    const chords = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.replace(/\[[^\]]*\]/g, " "); // [Intro], [Refrão]...
      const tokens = line
        .split(/\s+/)
        .filter((t) => t && !IGNORE_TOKEN_RE.test(t) && !/:$/.test(t))
        .map((t) => t.replace(/^\|+|\|+$/g, ""))
        .filter(Boolean);
      if (!tokens.length) continue;
      const parsed = tokens.map(parseChord);
      if (parsed.every(Boolean)) chords.push(...parsed);
    }
    return chords;
  }

  // Escolhe o tom maior que melhor explica os acordes
  function detectKey(chords) {
    let best = "C";
    let bestScore = -Infinity;
    for (const key of KEY_PREFERENCE) {
      const tonic = pitchClass(key);
      let score = 0;
      chords.forEach((c) => {
        const idx = MAJOR_STEPS.indexOf(mod12(c.rootPc - tonic));
        if (idx < 0) return;
        const expectMinor = QUALITIES[idx] === "m";
        score += expectMinor === isMinorSuffix(c.suffix) ? 2 : 0.5;
      });
      if (chords.length) {
        const first = chords[0], last = chords[chords.length - 1];
        if (first.rootPc === tonic && !isMinorSuffix(first.suffix)) score += 1;
        if (last.rootPc === tonic && !isMinorSuffix(last.suffix)) score += 1.5;
      }
      if (score > bestScore) {
        bestScore = score;
        best = key;
      }
    }
    return best;
  }

  function toRelative(key, pc) {
    const [deg, acc] = OFFSET_TO_DEGREE[mod12(pc - pitchClass(key))];
    return { deg, acc };
  }

  // Converte acordes absolutos para graus no tom (para poder transpor)
  function relativize(key, chords) {
    return chords.map((c) => ({
      ...toRelative(key, c.rootPc),
      suffix: c.suffix,
      bass: c.bassPc == null ? null : toRelative(key, c.bassPc),
    }));
  }

  const api = {
    KEYS, MAJOR_STEPS, QUALITIES,
    pitchClass, majorScale, prettyNote,
    diatonic, degreeRoot, chordNumber, chordText, chordIntervals,
    parseChord, parseChart, detectKey, relativize,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Theory = api;
})(this);
