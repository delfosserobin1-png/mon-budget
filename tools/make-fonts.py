"""Génère les polices embarquées de l'appli (sous-ensemble latin d'Inter, format WOFF).

À relancer uniquement si l'on veut changer de police ou de graisses. Nécessite fontTools
et les fichiers Inter installés sur la machine (paquet Debian/Ubuntu « fonts-inter »).
Usage : python3 tools/make-fonts.py
"""
import os, sys
from fontTools import subset
from fontTools.ttLib import TTFont

SRC = "/usr/share/fonts/opentype/inter"
OUT = os.path.join(os.path.dirname(__file__), "..", "www", "fonts")
FILES = {
    "Inter-Regular.otf": "inter-400.woff",
    "Inter-Medium.otf": "inter-500.woff",
    "Inter-SemiBold.otf": "inter-600.woff",
    "InterDisplay-SemiBold.otf": "inter-display-600.woff",
}
# Latin de base + Latin-1 (accents français) + ponctuation typographique + symboles utiles (€, −, ×, flèches simples)
UNICODES = (
    list(range(0x20, 0x7F)) + list(range(0xA0, 0x100))
    + [0x0152, 0x0153, 0x0178, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026, 0x202F, 0x2009,
       0x20AC, 0x2212, 0x00D7, 0x2022, 0x2192, 0x2190, 0x2191, 0x2193, 0x2248, 0x2260, 0x2264, 0x2265, 0x221E]
)
os.makedirs(OUT, exist_ok=True)
for src, dst in FILES.items():
    opts = subset.Options()
    opts.layout_features = ["kern", "liga", "calt", "tnum", "pnum", "case", "ccmp", "locl", "mark", "mkmk", "ss01", "cv11", "zero", "frac"]
    opts.name_IDs = [1, 2, 3, 4, 6]
    opts.notdef_outline = True
    opts.desubroutinize = True
    font = TTFont(os.path.join(SRC, src))
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=UNICODES)
    sub.subset(font)
    font.flavor = "woff"
    path = os.path.join(OUT, dst)
    font.save(path)
    print(f"{dst}: {os.path.getsize(path)} octets")
