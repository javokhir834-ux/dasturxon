"""FastHub brend rasmlari: ilova ikonkalari va ochilish ekrani (splash) — ko'k fon, oq chaqmoq, tezlik chiziqlari.
Ishlatish:  python mobile/brand-assets.py   (Pillow kerak: pip install pillow)
Har ilova (mijoz, kuryer, biznes) uchun: apps/<ilova>/assets/*.png, Android res (mipmap, drawable splash) va iOS (AppIcon, Splash)
mavjud fayllar o'lchamida qayta chiziladi. Rang o'zgarsa — BLUE ni almashtirib, qayta ishga tushiring.
"""
import glob
import os
from PIL import Image, ImageDraw

BLUE = (29, 107, 255, 255)      # #1D6BFF — brend
BLUE_DARK = (11, 79, 216, 255)  # #0B4FD8 — splash pastki qismi
WHITE = (255, 255, 255, 255)
SS = 4  # silliq chetlar uchun kattaroq chizib, keyin kichraytiramiz
BOLT = [(13, 2), (3, 14), (12, 14), (11, 22), (21, 10), (12, 10)]  # 24x24 to'rdagi chaqmoq (Lucide "zap" ga yaqin)
ROOT = os.path.dirname(os.path.abspath(__file__))


def bolt(draw, cx, cy, size, color):
    k = size / 24
    draw.polygon([(cx + (x - 12) * k, cy + (y - 12) * k) for x, y in BOLT], fill=color)


def lines(draw, right, cy, h, color):
    """Tezlik chiziqlari: o'ng tomoni `right` da tugaydi, uzunliklari kamayib boradi."""
    for i, w in enumerate((1.0, 0.7, 0.4)):
        y = cy + (i - 1) * h * 1.35
        length = h * 5 * w
        draw.rounded_rectangle([right - length, y - h / 2, right, y + h / 2], radius=h / 2, fill=color)


def canvas(w, h, bg=(0, 0, 0, 0)):
    im = Image.new('RGBA', (w * SS, h * SS), bg)
    return im, ImageDraw.Draw(im)


def done(im, w, h):
    return im.resize((w, h), Image.LANCZOS)


def icon_full(w, h, shape='square'):
    """Ko'k fonli to'liq ikonka: oq chaqmoq + chiziqlar (eski Android ikonkasi, iOS, icon-only)."""
    im, d = canvas(w, h)
    W, H = w * SS, h * SS
    if shape == 'round':
        d.ellipse([0, 0, W - 1, H - 1], fill=BLUE)
    elif shape == 'rounded':
        d.rounded_rectangle([0, 0, W - 1, H - 1], radius=W * 0.22, fill=BLUE)
    else:
        d.rectangle([0, 0, W, H], fill=BLUE)
    s = min(W, H)
    bolt(d, W * 0.56, H / 2, s * 0.5, WHITE)
    lines(d, W * 0.36, H / 2, s * 0.045, WHITE)
    return done(im, w, h)


def icon_foreground(w, h):
    """Android adaptiv ikonka old qatlami: shaffof fonda oq chaqmoq (fon — ko'k, alohida qatlam)."""
    im, d = canvas(w, h)
    W, H = w * SS, h * SS
    s = min(W, H)
    bolt(d, W * 0.56, H / 2, s * 0.56, WHITE)
    lines(d, W * 0.34, H / 2, s * 0.05, WHITE)
    return done(im, w, h)


def solid(w, h, color=BLUE):
    im, d = canvas(w, h, color)
    return done(im, w, h)


def splash(w, h):
    """Ochilish ekrani: ko'k fon (pastga qarab quyuqroq), markazda oq kartada ko'k chaqmoq, chapda oq chiziqlar."""
    im, d = canvas(w, h)
    W, H = w * SS, h * SS
    for y in range(0, H, SS * 4):  # vertikal gradient (yo'l-yo'l bo'lmasligi uchun mayda qadam)
        t = y / H
        c = tuple(int(BLUE[i] + (BLUE_DARK[i] - BLUE[i]) * t) for i in range(3)) + (255,)
        d.rectangle([0, y, W, y + SS * 4], fill=c)
    s = min(W, H) * 0.24
    cx, cy = W / 2, H / 2
    d.rounded_rectangle([cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2], radius=s * 0.29, fill=WHITE)
    bolt(d, cx, cy, s * 0.62, BLUE)
    lines(d, cx - s / 2 - s * 0.1, cy, s * 0.075, WHITE)
    return done(im, w, h)


def redraw(path, maker):
    w, h = Image.open(path).size
    maker(w, h).save(path, optimize=True)


def main():
    n = 0
    for app in ('mijoz', 'kuryer', 'biznes'):
        base = os.path.join(ROOT, 'apps', app)
        if not os.path.isdir(base):
            continue
        a = os.path.join(base, 'assets')
        jobs = [(os.path.join(a, 'icon-only.png'), lambda w, h: icon_full(w, h)), (os.path.join(a, 'icon-foreground.png'), icon_foreground),
                (os.path.join(a, 'icon-background.png'), solid), (os.path.join(a, 'splash.png'), splash), (os.path.join(a, 'splash-dark.png'), splash)]
        res = os.path.join(base, 'android', 'app', 'src', 'main', 'res')
        for f in glob.glob(os.path.join(res, 'mipmap-*', '*.png')):
            name = os.path.basename(f)
            jobs.append((f, {'ic_launcher.png': lambda w, h: icon_full(w, h, 'rounded'), 'ic_launcher_round.png': lambda w, h: icon_full(w, h, 'round'),
                             'ic_launcher_foreground.png': icon_foreground, 'ic_launcher_background.png': solid}[name]))
        jobs += [(f, splash) for f in glob.glob(os.path.join(res, 'drawable*', 'splash.png'))]
        ios = os.path.join(base, 'ios', 'App', 'App', 'Assets.xcassets')
        jobs += [(f, lambda w, h: icon_full(w, h)) for f in glob.glob(os.path.join(ios, 'AppIcon.appiconset', '*.png'))]
        jobs += [(f, splash) for f in glob.glob(os.path.join(ios, 'Splash.imageset', '*.png'))]
        for path, maker in jobs:
            if os.path.exists(path):
                redraw(path, maker)
                n += 1
        bgxml = os.path.join(res, 'values', 'ic_launcher_background.xml')
        if os.path.exists(bgxml):
            with open(bgxml, 'w', encoding='utf-8', newline='\n') as fh:
                fh.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#1D6BFF</color>\n</resources>\n')
    print(f'{n} ta rasm qayta chizildi')


if __name__ == '__main__':
    main()
