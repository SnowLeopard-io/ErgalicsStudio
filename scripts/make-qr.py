"""Generate the QR codes printed on the compendium cover.

Emits a vector SVG per target (inlined into the cover HTML by
scripts/build-tech-docs.mjs) plus a raster PNG for use outside the docs.
Run once; the outputs are committed.

    python scripts/make-qr.py
"""
from pathlib import Path

import qrcode
import qrcode.image.svg as svg

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "technical" / "assets"

# name -> URL. The name decides the asset filename (qr-<name>.svg/.png).
TARGETS = {
    "official-site": "https://snowleopard-io.github.io/ErgalicsStudio/",
    "github": "https://github.com/SnowLeopard-io/ErgalicsStudio",
    "gitee": "https://gitee.com/cnt-code/ergalics-studio",
}


def make(url: str) -> qrcode.QRCode:
    qr = qrcode.QRCode(
        version=None,
        # M (15%) survives a printed page being handled; the codes are only
        # ~30mm wide, so a higher level would inflate the module count and
        # shrink each module below a comfortable print resolution.
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    return qr


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    for name, url in TARGETS.items():
        qr = make(url)
        modules = qr.modules_count + 2 * qr.border

        svg_path = OUT / f"qr-{name}.svg"
        qr.make_image(image_factory=svg.SvgPathImage).save(str(svg_path))

        png_path = OUT / f"qr-{name}.png"
        qr.make_image(fill_color="black", back_color="white").save(str(png_path))

        print(f"encoded: {url}")
        print(f"  {modules}x{modules} modules -> {svg_path.name}, {png_path.name}")


if __name__ == "__main__":
    main()
