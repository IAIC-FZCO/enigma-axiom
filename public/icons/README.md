# Extension icons

Phase 1 placeholder. Replace with branded PNGs before Chrome Web Store
submission.

Required sizes (Manifest V3):

- `icon-16.png` — 16×16 toolbar / favicon
- `icon-32.png` — 32×32 medium toolbar
- `icon-48.png` — 48×48 install dialog
- `icon-128.png` — 128×128 Chrome Web Store listing

Generation approach for Phase 1:

```bash
# From a 1024×1024 source SVG (drop in src/branding/icon.svg later)
for size in 16 32 48 128; do
  rsvg-convert -w $size -h $size src/branding/icon.svg \
    -o extension/public/icons/icon-$size.png
done
```

Until the source SVG is finalized, ship placeholder PNGs with the ENIGMA
purple square + white "E" — these can be exported from any vector tool
or generated via ImageMagick:

```bash
for size in 16 32 48 128; do
  magick -size ${size}x${size} xc:'#7c6fe0' \
    -fill white -gravity center -pointsize $((size / 2)) \
    -annotate +0+0 'E' icon-$size.png
done
```
