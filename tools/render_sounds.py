"""Render the bundled Chime sounds to 16-bit mono WAV files.

Every sound is synthesized from scratch (no samples), so the output is
original work and ships under CC0 alongside the plugin.

    pip install numpy
    python tools/render_sounds.py

Writes plugins/chime/sounds/<id>.wav. The files are normalized to -1 dBFS;
the plugin applies the user's volume at play time.
"""

from __future__ import annotations

import math
import random
import wave
from pathlib import Path

import numpy as np

SR = 44100
PEAK = 10 ** (-1 / 20)  # -1 dBFS
OUT = Path(__file__).resolve().parent.parent / "plugins" / "chime" / "sounds"


# ---------------------------------------------------------------- building blocks


def exp_ramp(v0: float, v1: float, t0: float, t1: float, t: np.ndarray) -> np.ndarray:
    """Web Audio's exponentialRampToValueAtTime, held flat outside [t0, t1]."""
    x = np.clip((t - t0) / (t1 - t0), 0.0, 1.0)
    return v0 * (v1 / v0) ** x


def envelope(n: int, peak: float, attack: float) -> np.ndarray:
    """Exponential rise to `peak`, then exponential decay to silence."""
    t = np.arange(n) / SR
    dur = n / SR
    rise = exp_ramp(1e-4, peak, 0.0, attack, t)
    fall = exp_ramp(peak, 1e-4, attack, dur, t)
    return np.where(t < attack, rise, fall)


def oscillator(kind: str, freq: np.ndarray) -> np.ndarray:
    """Band-limited oscillator (additive, so high notes do not alias)."""
    phase = np.cumsum(2 * np.pi * freq / SR)
    top = max(1, int(18000 / max(float(freq.max()), 1.0)))
    if kind == "sine":
        return np.sin(phase)
    out = np.zeros_like(phase)
    if kind == "saw":
        for k in range(1, top + 1):
            out += np.sin(k * phase) / k
        return out * (2 / np.pi)
    if kind == "square":
        for k in range(1, top + 1, 2):
            out += np.sin(k * phase) / k
        return out * (4 / np.pi)
    if kind == "triangle":
        sign = 1.0
        for k in range(1, top + 1, 2):
            out += sign * np.sin(k * phase) / (k * k)
            sign = -sign
        return out * (8 / np.pi**2)
    raise ValueError(kind)


class Track:
    def __init__(self, seconds: float) -> None:
        self.buf = np.zeros(int(seconds * SR))

    def voice(self, kind: str, start: float, dur: float, peak: float, freq, attack: float = 0.005) -> None:
        """Add one note. `freq` is a number or a function of note-local time."""
        n = int(dur * SR)
        t = np.arange(n) / SR
        f = np.full(n, float(freq)) if not callable(freq) else np.asarray(freq(t), dtype=float)
        note = oscillator(kind, f) * envelope(n, peak, attack)
        i = int(start * SR)
        end = min(len(self.buf), i + n)
        self.buf[i:end] += note[: end - i]


def biquad(x: np.ndarray, kind: str, fc: float, q: float) -> np.ndarray:
    """RBJ cookbook low-pass / band-pass, applied sample by sample."""
    w0 = 2 * math.pi * fc / SR
    alpha = math.sin(w0) / (2 * q)
    c = math.cos(w0)
    if kind == "lowpass":
        b = [(1 - c) / 2, 1 - c, (1 - c) / 2]
    else:  # bandpass, constant 0 dB peak gain
        b = [alpha, 0.0, -alpha]
    a = [1 + alpha, -2 * c, 1 - alpha]
    b0, b1, b2 = (v / a[0] for v in b)
    a1, a2 = a[1] / a[0], a[2] / a[0]
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, xi in enumerate(x):
        yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1, y2, y1 = x1, xi, y1, yi
        y[i] = yi
    return y


def vibrato(base, rate: float, depth, start: float = 0.0):
    """Frequency function: `base` plus a sine wobble that begins at `start`."""
    def f(t):
        b = base(t) if callable(base) else base
        d = depth(t) if callable(depth) else depth
        return b + np.where(t >= start, d * np.sin(2 * np.pi * rate * (t - start)), 0.0)
    return f


# ---------------------------------------------------------------- the sounds


def coin() -> np.ndarray:
    tr = Track(0.6)
    tr.voice("square", 0.00, 0.09, 0.18, 988)
    tr.voice("square", 0.08, 0.45, 0.18, 1319)
    return tr.buf


def level_up() -> np.ndarray:
    tr = Track(0.8)
    for i, f in enumerate([523, 659, 784, 1047]):
        tr.voice("square", i * 0.085, 0.45 if i == 3 else 0.1, 0.14, f)
    tr.voice("triangle", 0.255, 0.45, 0.08, 2093)
    return tr.buf


def rubber_duck() -> np.ndarray:
    tr = Track(0.45)
    squeak = lambda t: np.where(t < 0.05, exp_ramp(900, 1500, 0, 0.05, t), exp_ramp(1500, 1050, 0.05, 0.15, t))
    for s in (0.0, 0.22):
        tr.voice("saw", s, 0.16, 0.5, squeak, attack=0.01)
    return biquad(tr.buf, "bandpass", 1600, 3)


def tada() -> np.ndarray:
    tr = Track(1.15)
    tr.voice("saw", 0.0, 0.12, 0.12, 392)
    for f in (523, 659, 784, 1047):
        tr.voice("saw", 0.15, 0.9, 0.07, vibrato(f, 6, f * 0.008, start=0.05), attack=0.02)
    return biquad(tr.buf, "lowpass", 2400, 0.8)


def microwave() -> np.ndarray:
    tr = Track(0.85)
    for s in (0.0, 0.28, 0.56):
        tr.voice("square", s, 0.18, 0.12, 1000, attack=0.003)
    return tr.buf


def sad_trombone() -> np.ndarray:
    tr = Track(2.3)
    s = 0.0
    notes = [(311, 0.32), (294, 0.32), (277, 0.32), (262, 1.1)]
    for i, (f, d) in enumerate(notes):
        slide = lambda t, f=f, d=d: f - (f * 0.03) * (t / d)
        tr.voice("saw", s, d, 0.22, vibrato(slide, 5.5, 7, start=0.15) if i == 3 else slide, attack=0.03)
        s += d * 0.95
    return biquad(tr.buf, "lowpass", 1100, 0.8)


def doorbell() -> np.ndarray:
    tr = Track(1.6)
    for f, s in ((659, 0.0), (523, 0.55)):
        tr.voice("sine", s, 1.0, 0.35, f, attack=0.004)
        tr.voice("sine", s, 0.4, 0.05, f * 2.76, attack=0.004)
    return tr.buf


def boing() -> np.ndarray:
    tr = Track(0.85)
    base = lambda t: np.where(t < 0.08, exp_ramp(90, 360, 0, 0.08, t), exp_ramp(360, 220, 0.08, 0.7, t))
    depth = lambda t: exp_ramp(90, 2, 0, 0.7, t)
    tr.voice("triangle", 0.0, 0.75, 0.45, vibrato(base, 14, depth))
    return tr.buf


def robot() -> np.ndarray:
    rng = random.Random(7)  # fixed seed: the same chirps on every render
    tr = Track(1.0)
    s = 0.0
    for _ in range(7):
        d = 0.05 + rng.random() * 0.09
        f1, f2 = 700 + rng.random() * 1900, 700 + rng.random() * 1900
        tr.voice("sine", s, d, 0.25, lambda t, f1=f1, f2=f2, d=d: exp_ramp(f1, f2, 0, d, t), attack=0.004)
        s += d + rng.random() * 0.03
    return tr.buf[: int((s + 0.05) * SR)]


def slide_whistle() -> np.ndarray:
    tr = Track(0.7)
    tr.voice("sine", 0.0, 0.6, 0.3, vibrato(lambda t: exp_ramp(550, 1900, 0, 0.5, t), 9, 25), attack=0.03)
    return tr.buf


SOUNDS = {
    "coin": coin,
    "level-up": level_up,
    "rubber-duck": rubber_duck,
    "tada": tada,
    "microwave": microwave,
    "sad-trombone": sad_trombone,
    "doorbell": doorbell,
    "boing": boing,
    "robot": robot,
    "slide-whistle": slide_whistle,
}


def write_wav(path: Path, x: np.ndarray) -> None:
    fade = min(len(x), int(0.01 * SR))
    x = x.copy()
    x[-fade:] *= np.linspace(1, 0, fade)
    x *= PEAK / max(float(np.abs(x).max()), 1e-9)
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name, render in SOUNDS.items():
        x = render()
        write_wav(OUT / f"{name}.wav", x)
        print(f"{name:14s} {len(x) / SR:4.2f}s")


if __name__ == "__main__":
    main()
