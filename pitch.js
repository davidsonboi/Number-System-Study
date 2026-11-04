// Detecção de altura (algoritmo YIN) para uma nota tocada ao microfone.
// Retorna { freq, clarity, rms } ou null se não houver nota clara.
(function (root) {
  "use strict";

  const YIN_THRESHOLD = 0.15;
  const MIN_RMS = 0.006;

  function detectPitch(buf, sampleRate, minFreq = 60, maxFreq = 1200) {
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);
    if (rms < MIN_RMS) return null;

    const maxTau = Math.min(Math.floor(sampleRate / minFreq), Math.floor(buf.length / 2));
    const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
    const W = buf.length - maxTau;
    const d = new Float32Array(maxTau + 1);

    // Função diferença
    for (let tau = 1; tau <= maxTau; tau++) {
      let sum = 0;
      for (let i = 0; i < W; i++) {
        const diff = buf[i] - buf[i + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }
    // Diferença média normalizada cumulativa
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      running += d[tau];
      d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }

    let tau = -1;
    for (let t = minTau; t <= maxTau; t++) {
      if (d[t] < YIN_THRESHOLD) {
        while (t + 1 <= maxTau && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) return null;

    // Interpolação parabólica
    let better = tau;
    if (tau > 1 && tau < maxTau) {
      const a = d[tau - 1], b = d[tau], c = d[tau + 1];
      const denom = a + c - 2 * b;
      if (denom !== 0) better = tau + (a - c) / (2 * denom);
    }
    return { freq: sampleRate / better, clarity: 1 - d[tau], rms };
  }

  // Classe de altura: C = 0 ... B = 11 (independe da oitava)
  function freqToPitchClass(freq) {
    const midi = Math.round(69 + 12 * Math.log2(freq / 440));
    return ((midi % 12) + 12) % 12;
  }

  const api = { detectPitch, freqToPitchClass };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Pitch = api;
})(this);
