#!/usr/bin/env python3
"""bed120.py out.wav seconds : an original 120 BPM F-minor led-class bed (kick, off-beat bass, pad, pluck, hats, clap). Pure synthesis."""
import sys, numpy as np, wave
from scipy.signal import butter, sosfilt
out, DUR = sys.argv[1], float(sys.argv[2])
SR = 44100; BPM = 120.0; BEAT = 60 / BPM; N = int(SR * DUR)
t_all = np.arange(N) / SR
rng = np.random.default_rng(7)
L = np.zeros(N, np.float32); R = np.zeros(N, np.float32)
def add(buf, sig, start):
    a = int(round(start * SR))
    if a >= N or a + len(sig) <= 0: return
    s = sig[: max(0, N - a)]
    buf[a:a + len(s)] += s
def hz(note):  # midi -> Hz
    return 440.0 * 2 ** ((note - 69) / 12)
def lp(x, fc, order=2): return sosfilt(butter(order, fc / (SR / 2), 'low', output='sos'), x).astype(np.float32)
def hp(x, fc, order=2): return sosfilt(butter(order, fc / (SR / 2), 'high', output='sos'), x).astype(np.float32)
def bp(x, f1, f2): return sosfilt(butter(2, [f1 / (SR / 2), f2 / (SR / 2)], 'band', output='sos'), x).astype(np.float32)
def env(n, a, d, curve=4.0):
    e = np.exp(-curve * np.arange(n) / max(1, d * SR)); k = max(1, int(a * SR)); e[:k] *= np.linspace(0, 1, k); return e.astype(np.float32)
def saw(f, n, harm=None):  # band-limited saw by additive synthesis
    tt = np.arange(n) / SR; H = harm or max(1, int(min(40, (SR * 0.45) // f)))
    return sum(np.sin(2 * np.pi * f * k * tt) / k for k in range(1, H + 1)).astype(np.float32) * 0.6
def tri(f, n):
    tt = np.arange(n) / SR
    return sum(((-1) ** k) * np.sin(2 * np.pi * f * (2 * k + 1) * tt) / (2 * k + 1) ** 2 for k in range(6)).astype(np.float32)

# ---- drums
def kick():
    n = int(0.32 * SR); tt = np.arange(n) / SR
    f = 50 + 130 * np.exp(-tt * 34); ph = 2 * np.pi * np.cumsum(f) / SR
    body = (np.sin(ph) + 0.35 * np.sin(2 * ph)) * np.exp(-tt * 13)
    click = hp(rng.standard_normal(n).astype(np.float32), 2500) * np.exp(-tt * 220) * 0.12
    return (np.tanh(body * 1.6) * 0.95 + click).astype(np.float32)
def hat(open_=False):
    n = int((0.22 if open_ else 0.05) * SR); x = hp(rng.standard_normal(n).astype(np.float32), 7000, 4)
    return (x * env(n, 0.001, 0.09 if open_ else 0.016, 5)).astype(np.float32)
def clap():
    n = int(0.22 * SR); x = bp(rng.standard_normal(n).astype(np.float32), 900, 3200); tt = np.arange(n) / SR
    e = sum(np.exp(-np.maximum(0, tt - d) * 55) * (tt >= d) for d in (0.0, 0.011, 0.023)) * 0.5 + np.exp(-tt * 22) * 0.35
    return (x * e).astype(np.float32)
def shaker():
    n = int(0.04 * SR); x = bp(rng.standard_normal(n).astype(np.float32), 5000, 9000)
    return (x * env(n, 0.004, 0.02, 4)).astype(np.float32)
K, HC, HO, CL, SHK = kick(), hat(), hat(True), clap(), shaker()

# ---- harmony: 4-bar loop, F minor: Fm7 | Fm7 | Cm7 | Cm7
CH = [dict(root=29, pad=[53, 56, 60, 63], pl=[68, None, 72, 68, None, 67, None, 65]),      # F1 ; F3 Ab3 C4 Eb4
      dict(root=29, pad=[53, 56, 60, 63], pl=[68, None, 72, 68, None, 67, 72, None]),
      dict(root=36, pad=[55, 58, 60, 63], pl=[67, None, 70, 67, None, 63, None, 67]),      # C2 ; G3 Bb3 C4 Eb4
      dict(root=36, pad=[55, 58, 60, 63], pl=[67, None, 70, 67, None, 70, 72, None])]
BAR = 4 * BEAT; nbars = int(np.ceil(DUR / BAR)) + 1
kick_t = []
pad = np.zeros(N + SR * 4, np.float32); padR = np.zeros_like(pad)
bass = np.zeros(N, np.float32); plk = np.zeros(N, np.float32); plkR = np.zeros(N, np.float32)
dr = np.zeros(N, np.float32); hatsL = np.zeros(N, np.float32); hatsR = np.zeros(N, np.float32)
for b in range(nbars):
    c = CH[b % 4]; t0 = b * BAR
    intro = b < 2                       # first 2 bars: pad + soft kick only
    fill = (b % 8 == 7)                 # every 8th bar: tiny break on the last beat
    for q in range(4):
        tb = t0 + q * BEAT
        if not (fill and q == 3):
            add(dr, K * (0.75 if intro else 1.0), tb); kick_t.append(tb)
        if not intro:
            add(hatsL, HC * 0.20, tb + BEAT / 2); add(hatsR, HC * 0.17, tb + BEAT / 2)
            if q in (1, 3): add(dr, CL * 0.30, tb)
            for s in range(4):
                g = 0.05 if s % 2 else 0.035
                add(hatsL, SHK * g, tb + s * BEAT / 4); add(hatsR, SHK * g * 1.15, tb + s * BEAT / 4 + 0.004)
        if fill and q == 3:
            add(hatsL, HO * 0.16, tb + BEAT / 2); add(hatsR, HO * 0.16, tb + BEAT / 2)
        # off-beat bass (root, with an octave pop on the last 8th of beats 2 and 4)
        if not intro:
            n = int(0.21 * SR); f = hz(c['root'] + 12)
            note = (lp(saw(f, n, 10) * 0.55, 700) + 0.9 * np.sin(2 * np.pi * f * np.arange(n) / SR) + 0.7 * np.sin(np.pi * f * np.arange(n) / SR)).astype(np.float32) * env(n, 0.006, 0.16, 3.2)
            add(bass, note * 0.9, tb + BEAT / 2)
            if q in (1, 3) and b % 2 == 1:
                n2 = int(0.12 * SR); note2 = lp(saw(f * 2, n2, 6), 900) * env(n2, 0.004, 0.08, 4)
                add(bass, note2 * 0.25, tb + BEAT * 0.75)
    # pad: sustained chord over the bar, slow attack, crossfaded into the next bar
    n = int((BAR + 0.5) * SR); tt = np.arange(n) / SR
    e = np.minimum(1, tt / 0.35) * np.minimum(1, (n / SR - tt) / 0.5)
    for i, m in enumerate(c['pad']):
        f = hz(m); v = (saw(f * 0.997, n, 10) + saw(f * 1.004, n, 10)) * 0.5
        v = lp(v, 1700 + 400 * np.sin(b * 0.7 + i)) * e * 0.16
        add(pad, v * (0.9 if i % 2 else 0.6), t0); add(padR, v * (0.6 if i % 2 else 0.9), t0)
    # pluck motif on 8ths (enters after 4 bars, rests in bar 8k+7)
    if b >= 4 and not fill:
        for s, m in enumerate(c['pl']):
            if m is None: continue
            n = int(0.30 * SR); f = hz(m)
            v = lp(tri(f, n) + 0.35 * saw(f, n, 8), 2400) * env(n, 0.003, 0.11, 4.2) * 0.22
            ts = t0 + s * BEAT / 2
            add(plk, v, ts); add(plkR, v * 0.8, ts)
            add(plkR, v * 0.38, ts + BEAT * 0.75); add(plk, v * 0.18, ts + BEAT * 1.5)     # dotted-8th echo, right then left
pad, padR = pad[:N], padR[:N]
# side-chain: duck pad, bass and pluck on every kick
duck = np.ones(N, np.float32)
for tk in kick_t:
    a = int(round(tk * SR)); n = int(0.26 * SR)
    if a < N:
        sh = 1 - 0.62 * np.exp(-np.arange(n) / (0.085 * SR)); m = min(n, N - a)
        duck[a:a + m] = np.minimum(duck[a:a + m], sh[:m])
bass = lp(bass, 800) * duck
G = dict(dr=0.95, bass=0.80, pad=2.7, plk=2.9, hat=1.3)
L = dr * G['dr'] + bass * G['bass'] + pad * duck * G['pad'] + plk * (0.55 + 0.45 * duck) * G['plk'] + hatsL * G['hat']
R = dr * G['dr'] + bass * G['bass'] + padR * duck * G['pad'] + plkR * (0.55 + 0.45 * duck) * G['plk'] + hatsR * G['hat']
M = np.stack([L, R], 1)
# gentle master: high-pass 28 Hz, soft clip, fades
M = np.stack([hp(M[:, 0], 28), hp(M[:, 1], 28)], 1)
M = np.tanh(M * 0.9) / 0.9
f_in, f_out = int(0.4 * SR), int(1.6 * SR)
M[:f_in] *= np.linspace(0, 1, f_in)[:, None]; M[-f_out:] *= np.linspace(1, 0, f_out)[:, None]
M /= max(1e-9, np.abs(M).max()) / 0.89
w = wave.open(out, 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((M * 32767).astype(np.int16).tobytes()); w.close()
rms = 20 * np.log10(np.sqrt((M ** 2).mean()))
print('bed written', out, 'dur %.2f s' % DUR, 'rms %.1f dBFS' % rms)
