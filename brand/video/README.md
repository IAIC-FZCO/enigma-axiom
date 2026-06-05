# Promo video (goals-led)

`enigma-axiom-promo.mp4` — 1920×1080, ~29.5s, H.264, **silent** (voice-over + music
are added separately — see below). It's a motion-graphics cut (Ken Burns zoom +
crossfades) of six baked scene cards.

## Reproduce
```bash
cd ../../scripts
node generate-video-frames.mjs          # -> ../brand/video/frames/card-{1..6}.png
npm install ffmpeg-static               # portable ffmpeg (no system install)
```
Then the build steps (per card: zoompan Ken Burns -> clip; then xfade-concat the 6
clips). The exact ffmpeg recipe is in the project history / `docs/axiom/20260605_Promo_Video_TZ.md`.

`frames/` (source PNGs) are committed; the `.mp4` and `clips/` are build artifacts
(gitignored) — regenerate them.

## Voice-over (sultry female) — NOT in the file yet
The box has only the robotic Windows TTS, which would cheapen the promo. For a real
sultry voice use **ElevenLabs** (or a voice actor):
- Voice: **Charlotte** or **Matilda** (warm / soft). Model: *Eleven Multilingual v2*.
- Settings: Stability ~0.35, Similarity ~0.80, Style ~0.55, Speaker boost on. Slow delivery.
- Script (≈28s, paced to the scenes):
  1. "Start with a goal."
  2. "ENIGMA breaks it into a structure you can verify."
  3. "Work with any AI — and check every step against real sources."
  4. "Reach your goals with AI you can trust. Per aspera ad astra."
- Export WAV/MP3 → drop it in; we merge onto the video (and a music bed) with ffmpeg.
