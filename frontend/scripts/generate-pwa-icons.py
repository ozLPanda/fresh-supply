from pathlib import Path
from PIL import Image, ImageDraw


PUBLIC_DIR = Path(__file__).resolve().parent.parent / "public"


def cubic(start, control_a, control_b, end, steps=24):
    points = []
    for index in range(steps + 1):
        t = index / steps
        mt = 1 - t
        points.append(
            (
                mt**3 * start[0]
                + 3 * mt**2 * t * control_a[0]
                + 3 * mt * t**2 * control_b[0]
                + t**3 * end[0],
                mt**3 * start[1]
                + 3 * mt**2 * t * control_a[1]
                + 3 * mt * t**2 * control_b[1]
                + t**3 * end[1],
            )
        )
    return points


def droplet(center_x, top, width, height):
    left = center_x - width / 2
    right = center_x + width / 2
    bottom = top + height
    middle_y = top + height * 0.6
    return (
        [(center_x, top)]
        + cubic((center_x, top), (center_x, top), (left, middle_y - height * 0.2), (left, middle_y))
        + cubic((left, middle_y), (left, bottom - height * 0.1), (center_x - width * 0.22, bottom), (center_x, bottom))
        + cubic((center_x, bottom), (center_x + width * 0.22, bottom), (right, bottom - height * 0.1), (right, middle_y))
        + cubic((right, middle_y), (right, middle_y - height * 0.2), (center_x, top), (center_x, top))
    )


def make_icon(size, filename, maskable=False):
    scale = 4
    canvas_size = size * scale
    background = "#091426" if maskable else "#f7f9fb"
    image = Image.new("RGB", (canvas_size, canvas_size), background)
    draw = ImageDraw.Draw(image)
    padding = 0.24 if maskable else 0.16
    inset = canvas_size * padding
    draw.rounded_rectangle(
        (inset, inset, canvas_size - inset, canvas_size - inset),
        radius=canvas_size * 0.12,
        fill="#ffffff",
    )
    center = canvas_size / 2
    top = canvas_size * (0.29 if maskable else 0.23)
    height = canvas_size * (0.42 if maskable else 0.54)
    width = height * 0.65
    draw.polygon(droplet(center, top, width, height), fill="#0047bb")
    inner_height = height * 0.47
    draw.polygon(
        droplet(center, top + height * 0.29, width * 0.48, inner_height),
        fill="#ffffff",
    )
    flame_height = height * 0.24
    draw.polygon(
        droplet(center, top + height * 0.53, width * 0.24, flame_height),
        fill="#ff6b00",
    )
    image.resize((size, size), Image.Resampling.LANCZOS).save(PUBLIC_DIR / filename, optimize=True)


make_icon(192, "pwa-192x192.png")
make_icon(512, "pwa-512x512.png")
make_icon(512, "pwa-maskable-512x512.png", maskable=True)
make_icon(180, "apple-touch-icon.png")
