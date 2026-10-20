/**
 * Chiptune loop + SFX through a small Web Audio mixer.
 * The context is created/resumed synchronously inside a user gesture.
 */
export class ToraAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private step = 0;
  private nextTime = 0;
  private running = false;
  private paused = false;
  private muted = false;
  private duckUntil = 0;
  private ducked = false;
  private musicLevel = 0.14;

  private readonly lead = [
    69, 72, 76, 79, 76, 72, 74, 71, 69, 72, 76, 81, 79, 76, 74, 72, 68, 71, 76, 79, 76, 71, 72, 69, 67, 71, 74,
    77, 76, 74, 72, 71,
  ];
  private readonly bass = [45, 45, 52, 50, 45, 45, 53, 52, 41, 41, 48, 47, 43, 43, 50, 48];

  unlock(): void {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      this.ctx = new AC({ latencyHint: "interactive" });
      this.master = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.music.gain.value = this.musicLevel;
      this.sfx.gain.value = 0.8;
      this.master.gain.value = this.muted ? 0 : 1;
      this.music.connect(this.master);
      this.sfx.connect(this.master);
      this.master.connect(this.ctx.destination);
      const frames = Math.floor(this.ctx.sampleRate * 0.5);
      this.noiseBuf = this.ctx.createBuffer(1, frames, this.ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(muted ? 0 : 1, this.ctx.currentTime, 0.02);
  }

  startMusic(): void {
    this.unlock();
    if (!this.ctx) return;
    this.running = true;
    this.paused = false;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.step = 0;
    this.music?.gain.setTargetAtTime(this.musicLevel, this.ctx.currentTime, 0.05);
  }

  pauseMusic(): void {
    this.paused = true;
    if (this.ctx && this.music) this.music.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
  }

  resumeMusic(): void {
    this.unlock();
    if (!this.ctx) return;
    this.paused = false;
    this.nextTime = this.ctx.currentTime + 0.06;
    this.music?.gain.setTargetAtTime(this.musicLevel, this.ctx.currentTime, 0.05);
  }

  stopMusic(): void {
    this.running = false;
    this.paused = false;
    if (this.ctx && this.music) this.music.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
  }

  tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.running || this.paused || !this.music || !this.sfx) return;
    if (this.ducked && ctx.currentTime > this.duckUntil) {
      this.ducked = false;
      this.music.gain.setTargetAtTime(this.musicLevel, ctx.currentTime, 0.12);
    }
    const ahead = ctx.currentTime + 0.22;
    const eighth = 0.17;
    while (this.nextTime < ahead) {
      const i = this.step % this.lead.length;
      this.note(this.midi(this.lead[i] ?? 69), eighth * 0.92, "square", 0.09, this.nextTime, this.music);
      if (i % 2 === 0) {
        const b = this.bass[(i >> 1) % this.bass.length] ?? 45;
        this.note(this.midi(b), eighth * 1.8, "triangle", 0.11, this.nextTime, this.music);
      } else {
        this.burst(0.03, 0.025, this.nextTime, 5000);
      }
      this.step++;
      this.nextTime += eighth;
    }
  }

  shoot(): void {
    this.unlock();
    this.duck();
    this.note(920, 0.045, "square", 0.12, 0, this.sfx, 280);
    this.burst(0.04, 0.08, 0, 2400);
  }

  explosion(big = false): void {
    this.unlock();
    this.duck();
    this.burst(big ? 0.42 : 0.26, big ? 0.35 : 0.22, 0, big ? 900 : 1600);
    this.note(big ? 160 : 220, big ? 0.34 : 0.2, "square", big ? 0.16 : 0.1, 0, this.sfx, 40);
  }

  fuel(): void {
    this.unlock();
    this.note(523, 0.06, "square", 0.08, 0, this.sfx);
    this.note(659, 0.06, "square", 0.08, 0.05, this.sfx);
    this.note(784, 0.08, "square", 0.08, 0.1, this.sfx);
  }

  lowFuel(amount: number): void {
    this.unlock();
    const f = 380 + (1 - amount) * 280;
    this.note(f, 0.07, "square", 0.07, 0, this.sfx);
  }

  oneUp(): void {
    this.unlock();
    [523, 659, 784, 1046].forEach((f, i) => this.note(f, 0.09, "square", 0.09, i * 0.07, this.sfx));
  }

  fanfare(): void {
    this.unlock();
    this.duck();
    [392, 523, 659, 784].forEach((f, i) => this.note(f, 0.12, "square", 0.1, i * 0.08, this.sfx));
  }

  crash(): void {
    this.explosion(true);
    this.note(90, 0.45, "sawtooth", 0.08, 0, this.sfx, 30);
  }

  resumeCtx(): void {
    if (this.ctx && this.ctx.state === "suspended") void this.ctx.resume();
  }

  dispose(): void {
    this.running = false;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) void ctx.close();
  }

  private duck(): void {
    if (!this.ctx || !this.music || this.paused || !this.running) return;
    this.ducked = true;
    this.duckUntil = this.ctx.currentTime + 0.22;
    this.music.gain.setTargetAtTime(this.musicLevel * 0.35, this.ctx.currentTime, 0.015);
  }

  private midi(n: number): number {
    return 440 * 2 ** ((n - 69) / 12);
  }

  private note(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    when: number,
    bus: GainNode | null,
    slideTo?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !bus) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(1, freq), t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(bus);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }

  private burst(dur: number, gain: number, when: number, cutoff: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || !this.noiseBuf) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.6 + Math.random() * 0.5;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.sfx);
    const offset = Math.random() * Math.max(0, this.noiseBuf.duration - dur - 0.02);
    src.start(t, offset, dur);
    src.stop(t + dur + 0.02);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }
}
