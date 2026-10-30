// AudioWorklet do áudio por aplicativo: recebe blocos PCM (48 kHz, estéreo, 16 bits) do app,
// guarda num buffer curto e toca numa saída que vira a faixa de áudio enviada aos amigos.
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 48000;                       // até 1 s guardado
    this.L = new Float32Array(this.cap);
    this.R = new Float32Array(this.cap);
    this.r = 0; this.w = 0; this.n = 0; this.started = false;
    this.port.onmessage = (e) => {
      const s = new Int16Array(e.data);
      for (let i = 0; i + 1 < s.length; i += 2) {
        if (this.n === this.cap) { this.r = (this.r + 1) % this.cap; this.n--; }
        this.L[this.w] = s[i] / 32768;
        this.R[this.w] = s[i + 1] / 32768;
        this.w = (this.w + 1) % this.cap; this.n++;
      }
      if (this.n > 9600) {                  // passou de 200 ms acumulados: descarta o excesso (atraso baixo)
        const drop = this.n - 4800;
        this.r = (this.r + drop) % this.cap; this.n -= drop;
      }
    };
  }

  process(inputs, outputs) {
    const oL = outputs[0][0], oR = outputs[0][1] || outputs[0][0];
    if (!this.started) {                    // junta ~40 ms antes de começar, para não picotar
      if (this.n < 1920) { oL.fill(0); oR.fill(0); return true; }
      this.started = true;
    }
    for (let i = 0; i < oL.length; i++) {
      if (this.n > 0) {
        oL[i] = this.L[this.r]; oR[i] = this.R[this.r];
        this.r = (this.r + 1) % this.cap; this.n--;
      } else { oL[i] = 0; oR[i] = 0; this.started = false; }
    }
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
