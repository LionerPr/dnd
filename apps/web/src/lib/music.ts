/**
 * Музыка комнаты. Мастер выбирает трек — у всех участников он плавно сменяется: старый затихает,
 * новый нарастает (длительность — fade). Трек повторяется по кругу, скорость меняется без смены тона.
 * Позиция считается по часам сервера, поэтому все слышат одно и то же место.
 */
import { useSyncExternalStore } from 'react';
import { serverNow, type MusicState } from './board';
import { blobUrl } from './files';

interface Voice {
  trackId: string;
  el: HTMLAudioElement;
  gain: GainNode;
  src: MediaElementAudioSourceNode;
}

export interface EngineStatus {
  /** Браузер не дал включить звук без нажатия */
  blocked: boolean;
  loading: boolean;
  trackId: string | null;
  error?: string;
}

const LOCAL_KEY = 'letopis.musicVolume';
function readLocal(): { volume: number; muted: boolean } {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null');
    if (v && typeof v.volume === 'number') return { volume: v.volume, muted: !!v.muted };
  } catch {
    // нет доступа к хранилищу — берём по умолчанию
  }
  return { volume: 1, muted: false };
}

class Engine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voice: Voice | null = null;
  private last: MusicState | null = null;
  private seq = 0;
  local = readLocal();
  status: EngineStatus = { blocked: false, loading: false, trackId: null };
  private listeners = new Set<() => void>();

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  private set(p: Partial<EngineStatus>) {
    this.status = { ...this.status, ...p };
    this.listeners.forEach((l) => l());
  }

  private audio() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.local.muted ? 0 : this.local.volume;
      this.master.connect(this.ctx.destination);
      this.ctx.onstatechange = () => this.set({ blocked: this.ctx!.state === 'suspended' && !!this.last?.playing });
    }
    return this.ctx;
  }

  /** Вызывается по нажатию «Включить звук» */
  async unlock() {
    const ctx = this.audio();
    await ctx.resume().catch(() => {});
    if (this.voice?.el.paused && this.last?.playing) await this.voice.el.play().catch(() => {});
    this.set({ blocked: ctx.state === 'suspended' });
    if (this.last) this.apply(this.last, true);
  }

  setLocal(volume: number, muted: boolean) {
    this.local = { volume, muted };
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(this.local));
    } catch {
      // не сохранилось — не страшно
    }
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : volume, this.ctx.currentTime, 0.05);
    this.listeners.forEach((l) => l());
  }

  private position(m: MusicState, duration: number) {
    const pos = m.playing ? m.offset + ((serverNow() - m.startedAt) / 1000) * m.speed : m.offset;
    return duration > 0 && Number.isFinite(duration) ? pos % duration : pos;
  }

  private fadeOut(v: Voice, seconds: number) {
    const ctx = this.ctx!;
    const g = v.gain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(0, ctx.currentTime + Math.max(0.05, seconds));
    setTimeout(() => {
      if (this.voice === v) return;
      v.el.pause();
      v.src.disconnect();
      v.gain.disconnect();
    }, Math.max(0.05, seconds) * 1000 + 100);
  }

  private fadeTo(v: Voice, target: number, seconds: number) {
    const ctx = this.ctx!;
    const g = v.gain.gain;
    g.cancelScheduledValues(ctx.currentTime);
    g.setValueAtTime(g.value, ctx.currentTime);
    g.linearRampToValueAtTime(target, ctx.currentTime + Math.max(0.05, seconds));
  }

  /** Привести звук к состоянию мастера */
  async apply(m: MusicState, force = false) {
    const prev = this.last;
    this.last = m;
    const seq = ++this.seq;
    const ctx = this.audio();
    if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
    this.set({ blocked: ctx.state === 'suspended' && m.playing });

    // Пауза или нет трека — плавно гасим
    if (!m.playing || !m.trackId) {
      if (this.voice) {
        const v = this.voice;
        if (v.trackId !== m.trackId || !m.trackId) {
          this.voice = null;
          this.fadeOut(v, m.fade);
        } else {
          this.fadeTo(v, 0, m.fade);
          setTimeout(() => {
            if (this.last && !this.last.playing && this.voice === v) v.el.pause();
          }, m.fade * 1000 + 100);
        }
      }
      this.set({ trackId: m.trackId, loading: false });
      return;
    }

    // Тот же трек — меняем скорость, громкость и при заметном расхождении позицию
    if (this.voice && this.voice.trackId === m.trackId) {
      const v = this.voice;
      v.el.playbackRate = m.speed;
      const wanted = this.position(m, v.el.duration);
      const resumed = prev && !prev.playing;
      if (force || resumed || Math.abs(v.el.currentTime - wanted) > 1.5 || (prev && prev.offset !== m.offset && prev.startedAt !== m.startedAt && Math.abs(v.el.currentTime - wanted) > 0.5)) v.el.currentTime = wanted;
      if (v.el.paused) await v.el.play().catch(() => this.set({ blocked: true }));
      this.fadeTo(v, m.volume, resumed ? m.fade : 0.3);
      return;
    }

    // Новый трек: грузим, запускаем с нуля громкости и сводим со старым
    this.set({ loading: true, trackId: m.trackId, error: undefined });
    let url: string;
    try {
      url = await blobUrl(m.trackId);
    } catch (e) {
      if (seq === this.seq) this.set({ loading: false, error: (e as Error).message });
      return;
    }
    if (seq !== this.seq) return;
    const el = new Audio();
    el.src = url;
    el.loop = true;
    el.preload = 'auto';
    el.playbackRate = m.speed;
    (el as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = true;
    await new Promise<void>((res) => {
      if (el.readyState >= 1) return res();
      el.addEventListener('loadedmetadata', () => res(), { once: true });
      el.addEventListener('error', () => res(), { once: true });
    });
    if (seq !== this.seq) return;
    const src = ctx.createMediaElementSource(el);
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.master!);
    el.currentTime = this.position(m, el.duration);
    const old = this.voice;
    const v: Voice = { trackId: m.trackId, el, gain, src };
    this.voice = v;
    await el.play().catch(() => this.set({ blocked: true }));
    this.fadeTo(v, m.volume, m.fade);
    if (old) this.fadeOut(old, m.fade);
    this.set({ loading: false });
  }

  /** Ушли из комнаты — тихо выключаем */
  stop() {
    this.seq++;
    this.last = null;
    if (this.voice) {
      const v = this.voice;
      this.voice = null;
      this.fadeOut(v, 0.6);
    }
    this.set({ trackId: null, loading: false, blocked: false });
  }

  currentTime() {
    return this.voice?.el.currentTime ?? 0;
  }
  duration() {
    return this.voice?.el.duration ?? 0;
  }
}

export const music = new Engine();

export function useMusicStatus() {
  useSyncExternalStore(music.subscribe, () => music.local);
  return useSyncExternalStore(music.subscribe, () => music.status);
}
