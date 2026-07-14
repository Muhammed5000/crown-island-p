"""
Crown Island — professional diagram generator (Pillow).
Draws branded flowcharts + hub-and-spoke diagrams and exports PNGs.
Source file lives beside its exports in /deliverables/diagrams/.
Run: python deliverables/diagrams/diagrams.py
"""
import os, math
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.dirname(os.path.abspath(__file__))
SS = 3  # supersample for crisp anti-aliased output

# Brand palette
NAVY = (31, 58, 95)
TEAL = (42, 157, 143)
GOLD = (183, 137, 46)
BG = (248, 250, 252)
SLATE = (110, 122, 138)
LINE = (206, 214, 222)
WHITE = (255, 255, 255)

FONT_REG = r"C:\Windows\Fonts\arial.ttf"
FONT_BLD = r"C:\Windows\Fonts\arialbd.ttf"


def font(size, bold=False):
    return ImageFont.truetype(FONT_BLD if bold else FONT_REG, int(size * SS))


def canvas(w, h):
    img = Image.new("RGB", (int(w * SS), int(h * SS)), BG)
    return img, ImageDraw.Draw(img)


def wrap(draw, text, fnt, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=fnt) <= maxw:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def node(draw, cx, cy, w, h, text, fill, fs=15, tcol=WHITE, radius=16):
    x0, y0 = (cx - w / 2) * SS, (cy - h / 2) * SS
    x1, y1 = (cx + w / 2) * SS, (cy + h / 2) * SS
    draw.rounded_rectangle([x0, y0, x1, y1], radius=int(radius * SS), fill=fill)
    fnt = font(fs, True)
    lines = wrap(draw, text, fnt, (w - 22) * SS)
    lh = fnt.getbbox("Ay")[3] + 5 * SS
    ty = cy * SS - (len(lines) * lh) / 2
    for ln in lines:
        tw = draw.textlength(ln, font=fnt)
        draw.text((cx * SS - tw / 2, ty), ln, font=fnt, fill=tcol)
        ty += lh


def arrow(draw, x1, y1, x2, y2, col=SLATE, wd=2.4):
    draw.line([x1 * SS, y1 * SS, x2 * SS, y2 * SS], fill=col, width=int(wd * SS))
    ang = math.atan2(y2 - y1, x2 - x1)
    L, W = 11 * SS, 6 * SS
    bx, by = x2 * SS - L * math.cos(ang), y2 * SS - L * math.sin(ang)
    left = (bx - W * math.sin(ang), by + W * math.cos(ang))
    right = (bx + W * math.sin(ang), by - W * math.cos(ang))
    draw.polygon([(x2 * SS, y2 * SS), left, right], fill=col)


def title(draw, text, x=52):
    draw.text((x * SS, 28 * SS), text, font=font(22, True), fill=NAVY)
    draw.line([x * SS, 62 * SS, (x + 120) * SS, 62 * SS], fill=GOLD, width=3 * SS)


def save(img, name):
    img = img.resize((img.width // SS, img.height // SS), Image.LANCZOS)
    p = os.path.join(OUT, name)
    img.save(p, "PNG")
    print("wrote", name, img.size)


def snake(name, ttl, steps, cols, nodew=248, nodeh=92, hgap=64, vgap=66, fs=14):
    rows = math.ceil(len(steps) / cols)
    m, top = 52, 92
    W = m * 2 + cols * nodew + (cols - 1) * hgap
    H = top + rows * nodeh + (rows - 1) * vgap + m
    img, d = canvas(W, H)
    title(d, ttl)
    pos = []
    for i in range(len(steps)):
        r, c = i // cols, i % cols
        if r % 2 == 1:
            c = cols - 1 - c
        cx = m + nodew / 2 + c * (nodew + hgap)
        cy = top + nodeh / 2 + r * (nodeh + vgap)
        pos.append((cx, cy))
    for i in range(len(steps) - 1):
        (x1, y1), (x2, y2) = pos[i], pos[i + 1]
        if i // cols == (i + 1) // cols:
            if x2 > x1:
                arrow(d, x1 + nodew / 2, y1, x2 - nodew / 2, y2)
            else:
                arrow(d, x1 - nodew / 2, y1, x2 + nodew / 2, y2)
        else:
            arrow(d, x1, y1 + nodeh / 2, x2, y2 - nodeh / 2)
    for (text, fill), (cx, cy) in zip(steps, pos):
        node(d, cx, cy, nodew, nodeh, text, fill, fs=fs)
    save(img, name)


def hub(name, ttl, center, spokes, cw=250, ch=104, sw=206, sh=82, fs=13):
    W, H = 840, 700
    img, d = canvas(W, H)
    title(d, ttl)
    cx, cy = W / 2, H / 2 + 24
    radius = 232
    posn = []
    for i in range(len(spokes)):
        ang = -math.pi / 2 + i * 2 * math.pi / len(spokes)
        posn.append((cx + radius * math.cos(ang), cy + radius * math.sin(ang)))
    for sx, sy in posn:
        d.line([cx * SS, cy * SS, sx * SS, sy * SS], fill=LINE, width=int(2.4 * SS))
    node(d, cx, cy, cw, ch, center, NAVY, fs=17)
    for (text, fill), (sx, sy) in zip(spokes, posn):
        node(d, sx, sy, sw, sh, text, fill, fs=fs)
    save(img, name)


# 1 — Overall system architecture
snake("01_architecture.png", "Overall System Architecture", [
    ("Visitor / Guest", TEAL),
    ("Website  &  Mobile App", NAVY),
    ("Smart Booking Engine", NAVY),
    ("Central Secure Database", GOLD),
    ("Admin Supervision Dashboard", NAVY),
    ("Reception  &  Gate Validation", TEAL),
], cols=3)

# 2 — Visitor booking journey
snake("02_booking_journey.png", "Visitor Booking Journey", [
    ("Choose Date", TEAL),
    ("Select Service", NAVY),
    ("Add Adults / Children / Cars", NAVY),
    ("Accept Terms & Conditions", GOLD),
    ("Confirm Booking", NAVY),
    ("Generate QR / Barcode Pass", TEAL),
    ("Arrive at Crown Island", NAVY),
    ("Reception Validation", TEAL),
], cols=4)

# 3 — Admin control workflow
snake("03_admin_workflow.png", "Admin Control Workflow", [
    ("Admin Secure Login", NAVY),
    ("Manage Services & Categories", TEAL),
    ("Manage Capacity & Places", TEAL),
    ("View & Control Bookings", NAVY),
    ("Validate Guest Data", GOLD),
    ("Supervise Reception & Gate", TEAL),
    ("Reports & Operational Records", NAVY),
], cols=4)

# 4 — Gate & reception validation
snake("04_gate_workflow.png", "Gate & Reception Validation Workflow", [
    ("Guest Arrives", TEAL),
    ("Scan QR / Barcode", NAVY),
    ("Booking Instantly Found", NAVY),
    ("Check Access Status", GOLD),
    ("Verify Guests & Headcount", NAVY),
    ("Print / Confirm Entry", TEAL),
    ("Guest Enters", NAVY),
], cols=4)

# 5 — Ticket & capacity logic (hub)
hub("05_ticket_logic.png", "Ticket & Capacity Logic", "Main Booking Ticket", [
    ("Adults (Ticket Capacity)", NAVY),
    ("Children Counter", TEAL),
    ("Car / Parking Counter", TEAL),
    ("Extra Person Counter", GOLD),
    ("Umbrella / Cabana Allocation", NAVY),
])

# 6 — Operational impact (hub)
hub("06_operational_impact.png", "Operational Impact on Crown Island", "Crown Island System", [
    ("Booking Control", NAVY),
    ("Reception Speed", TEAL),
    ("Premium Guest Experience", GOLD),
    ("Capacity Planning", NAVY),
    ("Management Visibility", TEAL),
    ("Rule Enforcement", GOLD),
])

print("ALL DIAGRAMS DONE")
