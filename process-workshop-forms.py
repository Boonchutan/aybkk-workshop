#!/usr/bin/env python3
"""
Huizhou Workshop Form Processor
Processes scanned paper assessment forms and generates Neo4j import JSON.

Usage:
    python3 process-workshop-forms.py --input ./forms/ --output ./output/
    python3 process-workshop-forms.py --single form-photo.jpg

Requirements:
    - Pillow (PIL) for image processing
    - tesseract-ocr (optional, for text extraction)
    
Install: pip3 install Pillow pytesseract
"""

import os
import sys
import json
import argparse
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import re

# Check for PIL
try:
    from PIL import Image, ImageEnhance, ImageFilter
    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("Warning: Pillow not installed. Install with: pip3 install Pillow")

# Check for tesseract
HAS_TESSERACT = False
try:
    result = subprocess.run(['which', 'tesseract'], capture_output=True, text=True)
    if result.returncode == 0:
        HAS_TESSERACT = True
        import pytesseract
except Exception:
    pass

# ─────────────────────────────────────────────────────────
# ATTRIBUTE MAPPING
# Maps form checkbox selections to attribute scores (1-5)
# ─────────────────────────────────────────────────────────

ATTRIBUTE_MAP = {
    # Forward Fold (Uttanasana)
    "forward_fold": {
        "地板": 5, "Floor": 5,  # Easy - full expression
        "脚踝": 4, "Ankles": 4,  # Minor restriction
        "小腿": 3, "Shins": 3,   # Moderate tightness
        "膝盖以上": 2, "Above knees": 2,  # Significant restriction
        "无法": 1, "Cannot": 1   # Major limitation
    },
    
    # Plank Hold (Core Stability)
    "core_stability": {
        "轻松稳定": 5, "Easy & stable": 5,  # Strong
        "轻微摇晃": 4, "Shaky but finished": 4,  # Developing
        "明显下沉": 2, "Sagging": 2,  # Limited
        "无法完成": 1, "Cannot complete": 1  # Priority concern
    },
    
    # Chaturanga (Triceps Strength)
    "triceps_strength": {
        "轻松，手肘贴身体": 5, "Easy, elbows in": 5,  # Strong
        "能完成，手肘打开": 4, "Can do, elbows out": 3,  # Moderate
        "只能2-3次": 2, "Only 2-3 reps": 2,  # Limited
        "无法完成": 1, "Cannot do": 1  # Priority concern
    },
    
    # Shoulder Mobility
    "shoulder_mobility": {
        "肩膀打开": 5, "Open": 5,  # Strong
        "有些紧张": 3, "Somewhat tight": 3,  # Moderate
        "耸肩明显": 2, "Noticeable shrugging": 2,  # Limited
        "非常紧张": 1, "Very tight": 1  # Priority concern
    },
    
    # Leg Behind Head (Hip Flexibility)
    "leg_behind_head": {
        "能轻松放到头后": 5, "Can place behind head": 5,  # Strong
        "能放到肩膀附近": 3, "Can reach shoulder": 3,  # Moderate
        "只能弯曲膝盖放": 2, "Only with bent knee": 2,  # Limited
        "无法完成": 1, "Cannot do": 1  # Priority concern
    },
    
    # Jump Through (Control/Power)
    "jump_through": {
        "能轻松跳起并控制落地": 5, "Jump with control": 5,  # Strong
        "能跳起但落地较重": 3, "Jump, heavy landing": 3,  # Moderate
        "能轻微跳起": 2, "Slight lift": 2,  # Limited
        "无法跳起": 1, "Cannot jump": 1  # Priority concern
    },
    
    # Downward Dog Heels (Ankle Mobility)
    "ankle_mobility": {
        "脚跟轻松着地": 5, "Heels on ground": 5,  # Strong
        "脚跟接近地面": 4, "Heels close": 4,  # Good
        "脚跟离地较远": 2, "Heels far": 2,  # Limited
        "脚跟离地很高": 1, "Heels very high": 1  # Priority concern
    }
}

# ─────────────────────────────────────────────────────────
# LIMITATION CHECKBOX MAPPING
# ─────────────────────────────────────────────────────────

LIMITATION_MAP = {
    "肩膀紧": "tight_shoulders",
    "Tight shoulders": "tight_shoulders",
    "髋部紧": "tight_hips",
    "Tight hips": "tight_hips",
    "腿后侧紧": "tight_hamstrings",
    "Tight hamstrings": "tight_hamstrings",
    "核心弱": "weak_core",
    "Weak core": "weak_core",
    "手臂力量弱": "weak_arms",
    "Weak arms": "weak_arms",
    "平衡差": "poor_balance",
    "Poor balance": "poor_balance"
}

# ─────────────────────────────────────────────────────────
# FORM PARSING
# ─────────────────────────────────────────────────────────

def parse_practice_years(text: str) -> float:
    """Extract practice years from text."""
    patterns = [
        r'(\d+)\s*[年岁]',
        r'(\d+)\s*(?:years?|months?)',
        r'practice[^\d]*(\d+)'
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = int(match.group(1))
            # If value > 50, probably years (human lifespan)
            if value > 50:
                return 50
            # If value <= 12, could be years or months - assume years
            return float(value)
    return 0.0


def extract_text_from_image(image_path: str) -> str:
    """Extract all text from an image using tesseract OCR."""
    if not HAS_TESSERACT:
        return ""
    
    try:
        img = Image.open(image_path)
        # Enhance for better OCR
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(1.5)
        enhancer = ImageEnhance.Sharpness(img)
        img = enhancer.enhance(1.5)
        
        # Try Chinese + English
        text = pytesseract.image_to_string(img, lang='chi_sim+eng')
        return text
    except Exception as e:
        print(f"OCR error for {image_path}: {e}")
        return ""


def parse_assessment_text(text: str, image_path: str) -> Dict:
    """
    Parse assessment text and return structured data.
    Falls back to manual entry if OCR confidence is low.
    """
    result = {
        "name": "",
        "name_chinese": "",
        "observer": "",
        "partner": "",
        "date": "",
        "group": "",
        "attributes": {},
        "limitations": [],
        "practice_years": 0,
        "injuries": [],
        "raw_text": text,
        "confidence": 0.0,
        "needs_review": True,
        "source_image": os.path.basename(image_path)
    }
    
    if not text.strip():
        result["needs_review"] = True
        return result
    
    lines = text.split('\n')
    confidence = 0.5  # Base confidence
    
    # Extract names (usually at start of form or after specific labels)
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
            
        # Name patterns
        name_match = re.search(r'[学生名字姓名][：:]\s*([^\n]+)', line, re.IGNORECASE)
        if name_match:
            result["name"] = name_match.group(1).strip()
            confidence += 0.1
        
        # Observer
        obs_match = re.search(r'[评估者观察者][：:]\s*([^\n]+)', line, re.IGNORECASE)
        if obs_match:
            result["observer"] = obs_match.group(1).strip()
        
        # Partner
        partner_match = re.search(r'[同伴伙伴][：:]\s*([^\n]+)', line, re.IGNORECASE)
        if partner_match:
            result["partner"] = partner_match.group(1).strip()
        
        # Date
        date_match = re.search(r'(\d{4}[-/]\d{2}[-/]\d{2}|\d{2}[-/]\d{2}[-/]\d{4})', line)
        if date_match:
            result["date"] = date_match.group(1)
        
        # Group
        group_match = re.search(r'[组号Group#][：:\s]*(\d+)', line, re.IGNORECASE)
        if group_match:
            result["group"] = group_match.group(1)
        
        # Parse each attribute
        for attr_key, attr_options in ATTRIBUTE_MAP.items():
            for option_text, score in attr_options.items():
                if option_text.lower() in line.lower():
                    if result["attributes"].get(attr_key, {}):
                        # Keep higher score if multiple found
                        if score > result["attributes"][attr_key]:
                            result["attributes"][attr_key] = score
                    else:
                        result["attributes"][attr_key] = score
        
        # Parse limitations
        for limit_text, limit_key in LIMITATION_MAP.items():
            if limit_text in line:
                if limit_key not in result["limitations"]:
                    result["limitations"].append(limit_key)
        
        # Practice years
        if any(kw in line.lower() for kw in ['练习', 'practice', 'years']):
            years = parse_practice_years(line)
            if years > 0:
                result["practice_years"] = years
        
        # Injuries (after injury keyword)
        if any(kw in line.lower() for kw in ['伤病', 'injury', '受伤']):
            # Next few lines might contain injury details
            for j in range(i+1, min(i+4, len(lines))):
                injury_text = lines[j].strip()
                if injury_text and len(injury_text) > 1:
                    result["injuries"].append(injury_text)
    
    # Calculate confidence based on how many attributes we found
    expected_attrs = len(ATTRIBUTE_MAP)  # 7 attributes
    found_attrs = len(result["attributes"])
    confidence = 0.3 + (found_attrs / expected_attrs) * 0.5  # 0.3 to 0.8 range
    
    # Boost confidence if we found a name
    if result["name"]:
        confidence += 0.1
    
    result["confidence"] = min(1.0, confidence)
    result["needs_review"] = result["confidence"] < 0.8
    
    return result


def process_single_form(image_path: str) -> Dict:
    """Process a single form image and return structured data."""
    print(f"Processing: {image_path}")
    
    if not os.path.exists(image_path):
        return {"error": f"File not found: {image_path}"}
    
    # Extract text using OCR
    text = extract_text_from_image(image_path)
    
    # Parse the extracted text
    result = parse_assessment_text(text, image_path)
    
    return result


def generate_neo4j_import(students: List[Dict], output_dir: str) -> Tuple[str, str]:
    """
    Generate Neo4j import JSON files.
    Returns (students_json_path, progress_checks_json_path)
    """
    os.makedirs(output_dir, exist_ok=True)
    
    # Generate students JSON
    students_data = []
    for s in students:
        if s.get("needs_review") and s.get("confidence", 0) < 0.5:
            continue  # Skip low confidence entries
            
        student = {
            "id": f"student_{hash(s.get('name', s.get('source_image', ''))) % 1000000}",
            "name": s.get("name", ""),
            "nameChinese": s.get("name_chinese", ""),
            "practiceYears": s.get("practice_years", 0),
            "series": "Primary",  # Default
            "workshop": "huizhou-2026",
            "attributes": json.dumps(s.get("attributes", {})),
            "limitations": json.dumps(s.get("limitations", [])),
            "strengths": json.dumps(detect_strengths(s.get("attributes", {}))),
            "injuries": json.dumps(s.get("injuries", [])),
            "assessmentDate": s.get("date", datetime.now().strftime("%Y-%m-%d")),
            "sourceImage": s.get("source_image", ""),
            "confidence": s.get("confidence", 0),
            "needsReview": s.get("needs_review", False)
        }
        students_data.append(student)
    
    students_path = os.path.join(output_dir, "students_import.json")
    with open(students_path, 'w', encoding='utf-8') as f:
        json.dump(students_data, f, ensure_ascii=False, indent=2)
    
    # Generate progress checks JSON (baseline assessments)
    progress_data = []
    for s in students:
        if s.get("needs_review") and s.get("confidence", 0) < 0.5:
            continue
            
        attrs = s.get("attributes", {})
        if not attrs:
            continue
            
        overall_score = sum(attrs.values()) / len(attrs) if attrs else 0
        
        progress = {
            "id": f"progress_{hash(s.get('name', s.get('source_image', ''))) % 1000000}",
            "studentId": f"student_{hash(s.get('name', s.get('source_image', ''))) % 1000000}",
            "checkDate": s.get("date", datetime.now().strftime("%Y-%m-%d")),
            "attributes": json.dumps(attrs),
            "overallScore": round(overall_score, 2),
            "notes": f"Baseline assessment from {s.get('source_image', 'unknown')}. Confidence: {s.get('confidence', 0):.0%}",
            "assessor": s.get("observer", "workshop"),
            "workshop": "huizhou-2026"
        }
        progress_data.append(progress)
    
    progress_path = os.path.join(output_dir, "progress_checks_import.json")
    with open(progress_path, 'w', encoding='utf-8') as f:
        json.dump(progress_data, f, ensure_ascii=False, indent=2)
    
    return students_path, progress_path


def detect_strengths(attributes: Dict) -> List[str]:
    """Detect strengths (attributes with score >= 4)"""
    strengths = []
    for attr, score in attributes.items():
        if score >= 4:
            # Convert attribute name to readable format
            strength_name = attr.replace("_", " ")
            strengths.append(strength_name)
    return strengths


def print_form_summary(results: List[Dict]):
    """Print summary of processed forms."""
    print("\n" + "="*60)
    print("FORM PROCESSING SUMMARY")
    print("="*60)
    
    total = len(results)
    successful = sum(1 for r in results if not r.get("error") and r.get("confidence", 0) >= 0.5)
    needs_review = sum(1 for r in results if r.get("needs_review"))
    
    print(f"Total forms processed: {total}")
    print(f"High confidence: {successful}")
    print(f"Needs manual review: {needs_review}")
    print()
    
    print("Individual Results:")
    print("-"*60)
    for r in results:
        if r.get("error"):
            print(f"  ERROR: {r.get('source_image', 'unknown')}: {r.get('error')}")
        else:
            name = r.get('name') or r.get('source_image', 'Unknown')
            conf = r.get('confidence', 0)
            attrs_found = len(r.get('attributes', {}))
            status = "✓" if conf >= 0.8 else "?" if conf >= 0.5 else "✗"
            print(f"  {status} {name}: {attrs_found}/7 attributes, confidence {conf:.0%}")
    
    print("="*60)


def main():
    parser = argparse.ArgumentParser(
        description='Process Huizhou Workshop Assessment Forms'
    )
    parser.add_argument(
        '--input', '-i',
        help='Input directory containing form images'
    )
    parser.add_argument(
        '--output', '-o',
        default='./output',
        help='Output directory for JSON files (default: ./output)'
    )
    parser.add_argument(
        '--single', '-s',
        help='Process a single form image'
    )
    parser.add_argument(
        '--batch-size', '-b',
        type=int,
        default=10,
        help='Number of forms to process before showing progress'
    )
    parser.add_argument(
        '--generate-cypher',
        action='store_true',
        help='Also generate Cypher queries for direct Neo4j import'
    )
    
    args = parser.parse_args()
    
    print("="*60)
    print("HUIZHOU WORKSHOP FORM PROCESSOR")
    print("="*60)
    print(f"Tesseract OCR: {'Available' if HAS_TESSERACT else 'NOT available'}")
    print(f"Output directory: {args.output}")
    print()
    
    results = []
    
    if args.single:
        # Process single file
        result = process_single_form(args.single)
        results.append(result)
    elif args.input:
        # Process directory
        input_dir = Path(args.input)
        if not input_dir.exists():
            print(f"Error: Directory not found: {input_dir}")
            sys.exit(1)
        
        # Find all images
        extensions = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.bmp']
        image_files = []
        for ext in extensions:
            image_files.extend(input_dir.glob(f'*{ext}'))
            image_files.extend(input_dir.glob(f'*{ext.upper()}'))
        
        if not image_files:
            print(f"No images found in {input_dir}")
            sys.exit(1)
        
        print(f"Found {len(image_files)} images to process")
        print()
        
        for i, img_path in enumerate(sorted(image_files)):
            result = process_single_form(str(img_path))
            results.append(result)
            
            if (i + 1) % args.batch_size == 0:
                print(f"Processed {i + 1}/{len(image_files)}...")
        
        print(f"\nCompleted processing {len(results)} forms")
    else:
        print("Error: Please specify --input directory or --single file")
        sys.exit(1)
    
    # Print summary
    print_form_summary(results)
    
    # Generate Neo4j import files
    if results:
        students_path, progress_path = generate_neo4j_import(results, args.output)
        print(f"\nGenerated Neo4j import files:")
        print(f"  Students: {students_path}")
        print(f"  Progress checks: {progress_path}")
        
        if args.generate_cypher:
            # Generate Cypher queries
            cypher_path = os.path.join(args.output, "import_queries.cypher")
            with open(cypher_path, 'w') as f:
                f.write("-- Huizhou Workshop Data Import\n")
                f.write(f"-- Generated: {datetime.now().isoformat()}\n\n")
                
                for r in results:
                    if r.get('needs_review') and r.get('confidence', 0) < 0.5:
                        continue
                    
                    name = r.get('name', 'Unknown')
                    name_cn = r.get('name_chinese', '')
                    practice_years = r.get('practice_years', 0)
                    attrs = r.get('attributes', {})
                    
                    f.write(f"""
// {name} {'(' + name_cn + ')' if name_cn else ''}
CREATE (s:Student {{
    name: "{name}",
    nameChinese: "{name_cn}",
    practiceYears: {practice_years},
    workshop: "huizhou-2026",
    series: "Primary",
    attributes: '{json.dumps(attrs)}'
}});
""")
            print(f"  Cypher queries: {cypher_path}")
    
    print("\n" + "="*60)
    print("Processing complete!")
    print("="*60)


if __name__ == '__main__':
    main()
