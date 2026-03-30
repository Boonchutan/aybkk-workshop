#!/usr/bin/env python3
"""Generate QR codes for workshop students with AYBKK logo + name"""

import qrcode
from qrcode.image.styledpil import StyledPilImage
from PIL import Image, ImageDraw, ImageFont
import os
import json
from neo4j import GraphDatabase

# Config
BASE_URL = "https://alfredos-mac-mini.tail54b8d2.ts.net/student.html"
LOGO_PATH = "/Users/alfredoagent/mission-control/public/aybkk-logo.jpg"
OUTPUT_DIR = "/Users/alfredoagent/mission-control/public/qr-cards"

os.makedirs(OUTPUT_DIR, exist_ok=True)

# Get students from Neo4j
d = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "aybkk_neo4j_2026"))
with d.session() as session:
    result = session.run("""
        MATCH (s:Student)
        WHERE s.classType IN ['chinese-workshop', 'in-depth-mysore-cn2']
        RETURN s.id AS id, s.name AS name, s.classType AS classType
        ORDER BY s.name
    """)
    students = [{"id": r["id"], "name": r["name"], "classType": r["classType"]} for r in result]
d.close()

print(f"Generating QR codes for {len(students)} students...")

# Load logo
try:
    logo = Image.open(LOGO_PATH)
    logo = logo.resize((50, 50), Image.LANCZOS)
    # Create circular mask
    mask = Image.new("L", (50, 50), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.ellipse((0, 0, 50, 50), fill=255)
    logo.putalpha(mask)
    has_logo = True
except:
    has_logo = False
    print("Logo not found, generating without logo")

# Generate QR codes
for i, student in enumerate(students):
    if not student["id"]:
        continue
    
    # Encode URL
    from urllib.parse import quote
    name_encoded = quote(student["name"])
    url = f"{BASE_URL}?id={student['id']}&name={name_encoded}&lang=zh"
    
    # Generate QR
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_H,  # High for logo overlay
        box_size=8,
        border=2,
    )
    qr.add_data(url)
    qr.make(fit=True)
    
    # QR image - brown/warm colors
    qr_img = qr.make_image(
        fill_color="#3d2b1f",
        back_color="#faf8f5"
    ).convert("RGBA")
    
    # Resize QR
    qr_size = 280
    qr_img = qr_img.resize((qr_size, qr_size), Image.LANCZOS)
    
    # Overlay logo in center
    if has_logo:
        logo_size = 60
        logo_resized = logo.resize((logo_size, logo_size), Image.LANCZOS)
        logo_x = (qr_size - logo_size) // 2
        logo_y = (qr_size - logo_size) // 2
        # White background behind logo
        logo_bg = Image.new("RGBA", (logo_size + 8, logo_size + 8), (255, 255, 255, 255))
        bg_draw = ImageDraw.Draw(logo_bg)
        bg_draw.rounded_rectangle([(0, 0), (logo_size + 8, logo_size + 8)], radius=8, fill=(255, 255, 255, 255))
        qr_img.paste(logo_bg, (logo_x - 4, logo_y - 4), logo_bg)
        qr_img.paste(logo_resized, (logo_x, logo_y), logo_resized)
    
    # Create card with name
    card_width = 320
    card_height = 380
    card = Image.new("RGB", (card_width, card_height), "#faf8f5")
    draw = ImageDraw.Draw(card)
    
    # Top border accent
    draw.rectangle([(0, 0), (card_width, 4)], fill="#c49564")
    
    # QR code centered
    qr_x = (card_width - qr_size) // 2
    qr_y = 30
    card.paste(qr_img, (qr_x, qr_y), qr_img)
    
    # Student name
    try:
        font_large = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 22)
        font_small = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 14)
    except:
        font_large = ImageFont.load_default()
        font_small = ImageFont.load_default()
    
    name_y = qr_y + qr_size + 20
    bbox = draw.textbbox((0, 0), student["name"], font=font_large)
    name_w = bbox[2] - bbox[0]
    name_x = (card_width - name_w) // 2
    draw.text((name_x, name_y), student["name"], fill="#2a2420", font=font_large)
    
    # Group label
    group = "In-depth Mysore" if student["classType"] == "in-depth-mysore-cn2" else "Workshop"
    bbox = draw.textbbox((0, 0), group, font=font_small)
    group_w = bbox[2] - bbox[0]
    group_x = (card_width - group_w) // 2
    draw.text((group_x, name_y + 30), group, fill="#8b7d6b", font=font_small)
    
    # Save
    safe_name = student["name"].replace("/", "_").replace(" ", "_")
    filename = f"{safe_name}.png"
    filepath = os.path.join(OUTPUT_DIR, filename)
    card.save(filepath)
    
    if (i + 1) % 10 == 0:
        print(f"  Generated {i + 1}/{len(students)}")

print(f"\n✅ Done! {len(students)} QR cards saved to {OUTPUT_DIR}")

# Save manifest
manifest = []
for s in students:
    if s["id"]:
        safe_name = s["name"].replace("/", "_").replace(" ", "_")
        manifest.append({
            "name": s["name"],
            "id": s["id"],
            "classType": s["classType"],
            "file": f"{safe_name}.png",
            "url": f"{BASE_URL}?id={s['id']}&name={quote(s['name'])}&lang=zh"
        })

with open(os.path.join(OUTPUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

print(f"📋 Manifest saved to {OUTPUT_DIR}/manifest.json")
