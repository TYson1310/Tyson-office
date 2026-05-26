#!/usr/bin/env python3
import json
import os
import re
import sys
from pathlib import Path

MISSING_DEPS_MESSAGE = (
    "Game catalog extraction dependencies are missing. Install system tools with "
    "`brew install poppler tesseract`, then install Python packages with "
    "`python3 -m pip install -r requirements-game-catalog.txt`."
)


def fail(message: str) -> None:
    print(json.dumps({"error": message}), file=sys.stderr)
    raise SystemExit(1)


def import_optional(module_name: str):
    try:
        return __import__(module_name)
    except ImportError:
        return None


def normalize_line(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def normalize_game_name(value: str) -> str:
    return normalize_line(value).replace("Ca$h", "Cash")


def parse_ticket_price(value: str) -> float:
    return float(re.sub(r"[^0-9.]", "", value))


def is_ticket_price_line(value: str) -> bool:
    return re.match(r"^\$\s*\d+(?:\.\d{2})$", value) is not None


def is_game_id_line(value: str) -> bool:
    return re.match(r"^#\s*\d{4,5}$", value) is not None


def is_prize_line(value: str) -> bool:
    return re.match(r"^\$[\d,*. ]+\s+.*-\s*\d+", value) is not None


def is_name_boundary(value: str) -> bool:
    normalized = normalize_line(value)
    lower = normalized.lower()

    return (
        not normalized
        or lower.startswith("scratch-offs")
        or lower.startswith("as of")
        or "availability subject" in lower
        or "scratch-offs unclaimed" in lower
        or "all games may" in lower
        or re.match(r"^\d+\s+of\s+\d+$", normalized) is not None
        or is_game_id_line(normalized)
        or is_ticket_price_line(normalized)
        or is_prize_line(normalized)
    )


def extract_pdf_page_lines(file_path: str):
    pypdf = import_optional("pypdf")

    if not pypdf:
        return []

    try:
        reader = pypdf.PdfReader(file_path)
    except Exception:
        return []

    page_lines = []

    for page_index, page in enumerate(reader.pages):
        if page_index >= max_pages():
            break

        text = page.extract_text() or ""
        page_lines.append(
            [
                normalize_line(line)
                for line in text.splitlines()
                if normalize_line(line)
            ]
        )

    return page_lines


def flatten_page_lines(page_lines):
    return [line for lines in page_lines for line in lines]


def extract_pdf_lines(file_path: str):
    return flatten_page_lines(extract_pdf_page_lines(file_path))


def prepare_ocr_image(image):
    from PIL import ImageOps

    return ImageOps.autocontrast(image.convert("L"))


def extract_ocr_page_lines(images):
    if not import_optional("pytesseract"):
        return []

    import pytesseract

    page_lines = []

    for image in images:
        text = pytesseract.image_to_string(
            prepare_ocr_image(image),
            config="--psm 6",
        )
        page_lines.append(
            [
                normalize_line(line)
                for line in text.splitlines()
                if normalize_line(line)
            ]
        )

    return page_lines


def extract_ocr_lines(images):
    return flatten_page_lines(extract_ocr_page_lines(images))


def parse_game_records(lines, page_number=None):
    records = []

    for index, line in enumerate(lines[:-1]):
        next_line = lines[index + 1]

        if not is_ticket_price_line(line) or not is_game_id_line(next_line):
            continue

        name_lines = []
        cursor = index - 1

        while cursor >= 0 and len(name_lines) < 4:
            candidate = lines[cursor]

            if is_name_boundary(candidate):
                break

            name_lines.append(candidate)
            cursor -= 1

        game_name = normalize_game_name(" ".join(reversed(name_lines)))

        if not game_name:
            continue

        record = {
            "game_id": re.sub(r"\D", "", next_line),
            "game_name": game_name,
            "ticket_price": parse_ticket_price(line),
        }

        if page_number is not None:
            record["page_number"] = page_number

        records.append(record)

    return records


def parse_game_records_from_pages(page_lines):
    records = []

    for page_number, lines in enumerate(page_lines, start=1):
        records.extend(parse_game_records(lines, page_number=page_number))

    return records


def ocr_cell_lines(image, cell_bbox):
    if not import_optional("pytesseract"):
        return []

    import pytesseract

    try:
        text = pytesseract.image_to_string(
            prepare_ocr_image(image.crop(cell_bbox)),
            config="--psm 6",
        )
    except Exception:
        return []

    return [
        normalize_line(line)
        for line in text.splitlines()
        if normalize_line(line)
    ]


def extract_game_id_from_lines(lines):
    normalized = normalize_line(" ".join(lines))
    matches = re.findall(r"#\s*(\d{4,5})", normalized)

    if matches:
        return matches[0]

    matches = re.findall(r"(?:game|no\.?)\s*#?\s*(\d{4,5})", normalized, re.I)

    if matches:
        return matches[0]

    return None


def extract_ticket_price_from_line(value):
    if is_ticket_price_line(value):
        price = parse_ticket_price(value)

        return price if 0 < price <= 100 else None

    match = re.search(r"\$\s*(\d{1,3})(?:\.00)?(?![\d,])", value)

    if not match:
        return None

    price = float(match.group(1))

    return price if 0 < price <= 100 else None


def find_ticket_price_in_lines(lines, game_id_index=None):
    indexed_lines = list(enumerate(lines))

    if game_id_index is not None:
        indexed_lines.sort(key=lambda item: abs(item[0] - game_id_index))

    for index, line in indexed_lines:
        price = extract_ticket_price_from_line(line)

        if price is not None:
            return price, index

    return None, None


def is_cell_name_line(value):
    normalized = normalize_line(value)
    lower = normalized.lower()

    if is_name_boundary(normalized):
        return False

    if re.search(r"(?:game|no\.?)\s*#?\s*\d{4,5}", lower):
        return False

    if lower.startswith(("overall odds", "odds", "top prize", "prize")):
        return False

    return re.search(r"[A-Za-z]", normalized) is not None


def extract_game_name_from_cell_lines(lines, game_id_index=None, price_index=None):
    cutoff = len(lines)

    if price_index is not None:
        cutoff = min(cutoff, price_index)

    if game_id_index is not None:
        cutoff = min(cutoff, game_id_index)

    name_lines = [line for line in lines[:cutoff] if is_cell_name_line(line)]

    if not name_lines:
        name_lines = [line for line in lines if is_cell_name_line(line)]

    return normalize_game_name(" ".join(name_lines[-4:]))


def parse_cell_game_record(lines, page_number=None):
    parsed_records = parse_game_records(lines, page_number=page_number)

    if parsed_records:
        return parsed_records[0]

    game_id = extract_game_id_from_lines(lines)

    if not game_id:
        return None

    game_id_index = next(
        (
            index
            for index, line in enumerate(lines)
            if game_id in re.sub(r"\D", "", line)
        ),
        None,
    )
    ticket_price, price_index = find_ticket_price_in_lines(lines, game_id_index)
    game_name = extract_game_name_from_cell_lines(
        lines,
        game_id_index=game_id_index,
        price_index=price_index,
    )

    if ticket_price is None or not game_name:
        return None

    record = {
        "game_id": game_id,
        "game_name": game_name,
        "ticket_price": ticket_price,
    }

    if page_number is not None:
        record["page_number"] = page_number

    return record


def merge_text_and_cell_records(text_records, crops):
    warnings = []
    records = []
    seen_game_ids = set()
    recovered_count = 0

    for record in text_records:
        game_id = record["game_id"]

        if game_id in seen_game_ids:
            continue

        records.append({**record, "_source": "text"})
        seen_game_ids.add(game_id)

    for crop in crops:
        record = crop.get("record")

        if not record:
            continue

        game_id = record["game_id"]

        if game_id in seen_game_ids:
            continue

        records.append({**record, "_source": "cell"})
        seen_game_ids.add(game_id)
        recovered_count += 1

    if recovered_count > 0:
        warnings.append(
            f"Found {recovered_count} OCR-only game row candidate(s) that "
            "were missing from PDF text."
        )

    return records, warnings


def clean_record(record):
    return {
        key: value
        for key, value in record.items()
        if not key.startswith("_")
    }


def merge_game_and_crop(record, crop):
    return {
        **clean_record(record),
        "image_path": crop["path"],
        "page_number": crop["page_number"],
        "crop_index": crop["crop_index"],
        "crop_bbox": crop["bbox"],
    }


def describe_game_ids(records, limit=8):
    game_ids = [f"#{record['game_id']}" for record in records]

    if len(game_ids) <= limit:
        return ", ".join(game_ids)

    return ", ".join(game_ids[:limit]) + f", +{len(game_ids) - limit} more"


def match_records_to_crops(records, crops):
    warnings = []
    games = []
    used_crop_indexes = set()
    used_game_ids = set()
    crops_by_game_id = {}

    for index, crop in enumerate(crops):
        game_id = crop.get("game_id")

        if not game_id:
            continue

        crops_by_game_id.setdefault(game_id, []).append(index)

    def add_match(record, crop_index):
        used_crop_indexes.add(crop_index)
        used_game_ids.add(record["game_id"])
        games.append(merge_game_and_crop(record, crops[crop_index]))

    def find_ocr_crop_index(record):
        candidate_crop_indexes = crops_by_game_id.get(record["game_id"], [])
        record_page_number = record.get("page_number")
        crop_index = next(
            (
                candidate_index
                for candidate_index in candidate_crop_indexes
                if candidate_index not in used_crop_indexes
                and (
                    record_page_number is None
                    or crops[candidate_index]["page_number"] == record_page_number
                )
            ),
            None,
        )

        if crop_index is not None:
            return crop_index

        return next(
            (
                candidate_index
                for candidate_index in candidate_crop_indexes
                if candidate_index not in used_crop_indexes
            ),
            None,
        )

    def match_by_ocr(records_to_match):
        unmatched = []

        for record in records_to_match:
            if record["game_id"] in used_game_ids:
                continue

            crop_index = find_ocr_crop_index(record)

            if crop_index is None:
                unmatched.append(record)
                continue

            add_match(record, crop_index)

        return unmatched

    def match_by_page_order(records_to_match, warning_label):
        unmatched_by_page = {}

        for record in records_to_match:
            unmatched_by_page.setdefault(record.get("page_number"), []).append(record)

        for page_number, page_records in unmatched_by_page.items():
            page_crops = [
                (index, crop)
                for index, crop in enumerate(crops)
                if index not in used_crop_indexes
                and (page_number is None or crop["page_number"] == page_number)
            ]

            if len(page_crops) < len(page_records):
                page_label = (
                    f"page {page_number}"
                    if page_number is not None
                    else "the document"
                )
                skipped_records = page_records[len(page_crops):]
                warnings.append(
                    f"Skipped {len(skipped_records)} {warning_label} game row(s) on "
                    f"{page_label} because no unused image cell remained: "
                    f"{describe_game_ids(skipped_records)}."
                )

            for record, (crop_index, _crop) in zip(page_records, page_crops):
                if record["game_id"] in used_game_ids:
                    continue

                add_match(record, crop_index)

    text_records = [record for record in records if record.get("_source") == "text"]
    cell_records = [record for record in records if record.get("_source") == "cell"]
    primary_records = text_records if text_records else cell_records
    recovery_records = cell_records if text_records else []
    unmatched_primary = match_by_ocr(primary_records)

    if unmatched_primary and crops_by_game_id:
        warnings.append(
            "Some game images could not be matched by OCR game number; remaining rows were matched by page order."
        )

    match_by_page_order(unmatched_primary, "parsed")

    before_recovered_count = len(games)
    unmatched_recovery = match_by_ocr(recovery_records)
    recovered_count = len(games) - before_recovered_count

    if recovered_count > 0:
        warnings.append(
            f"Imported {recovered_count} OCR-only game row(s) from leftover image cells."
        )

    if unmatched_recovery:
        warnings.append(
            f"Skipped {len(unmatched_recovery)} OCR-only game row(s) because their "
            f"image cells were already used by parsed rows: "
            f"{describe_game_ids(unmatched_recovery)}."
        )

    duplicate_cell_record_count = 0

    for index, crop in enumerate(crops):
        record = crop.get("record")

        if (
            record
            and index not in used_crop_indexes
            and record["game_id"] in used_game_ids
        ):
            used_crop_indexes.add(index)
            duplicate_cell_record_count += 1

    if duplicate_cell_record_count > 0:
        warnings.append(
            f"Ignored {duplicate_cell_record_count} duplicate OCR game cell(s)."
        )

    games.sort(key=lambda game: (game["page_number"], game["crop_index"]))

    unused_crop_count = len(crops) - len(used_crop_indexes)

    if unused_crop_count > 0:
        unused_counts_by_page = {}

        for index, crop in enumerate(crops):
            if index not in used_crop_indexes:
                unused_counts_by_page[crop["page_number"]] = (
                    unused_counts_by_page.get(crop["page_number"], 0) + 1
                )

        page_summaries = ", ".join(
            f"page {page_number}: {count}"
            for page_number, count in sorted(unused_counts_by_page.items())
        )
        warnings.append(
            f"Ignored {unused_crop_count} extra detected image(s)"
            f" ({page_summaries})."
        )

    return games, warnings


def max_pages() -> int:
    try:
        return max(1, int(os.environ.get("GAME_CATALOG_MAX_PAGES", "12")))
    except ValueError:
        return 12


def render_dpi() -> int:
    try:
        return max(96, int(os.environ.get("GAME_CATALOG_DPI", "150")))
    except ValueError:
        return 150


def render_pdf_pages(file_path: str):
    if not import_optional("pdf2image"):
        fail(MISSING_DEPS_MESSAGE)

    try:
        from pdf2image import convert_from_path

        return [
            page.convert("RGB")
            for page in convert_from_path(
                file_path,
                dpi=render_dpi(),
                fmt="png",
                first_page=1,
                last_page=max_pages(),
                thread_count=2,
            )
        ]
    except Exception as exc:
        fail(f"Game catalog PDF rendering failed: {exc}. {MISSING_DEPS_MESSAGE}")


def render_image_page(file_path: str):
    try:
        from PIL import Image
    except ImportError:
        fail(MISSING_DEPS_MESSAGE)

    try:
        with Image.open(file_path) as image:
            return [image.convert("RGB")]
    except Exception as exc:
        fail(f"Game catalog image rendering failed: {exc}")


def merge_line_positions(positions, gap=12):
    if not positions:
        return []

    merged = []
    current = [positions[0]]

    for position in positions[1:]:
        if position - current[-1] <= gap:
            current.append(position)
        else:
            merged.append(round(sum(current) / len(current)))
            current = [position]

    merged.append(round(sum(current) / len(current)))
    return merged


def find_grid_lines(image):
    gray = image.convert("L")
    width, height = gray.size
    pixels = gray.load()
    x_positions = []
    y_positions = []

    for x in range(width):
        dark_count = 0

        for y in range(height):
            if pixels[x, y] < 145:
                dark_count += 1

        if dark_count > height * 0.52:
            x_positions.append(x)

    for y in range(height):
        dark_count = 0

        for x in range(width):
            if pixels[x, y] < 145:
                dark_count += 1

        if dark_count > width * 0.72:
            y_positions.append(y)

    return merge_line_positions(x_positions), merge_line_positions(y_positions)


def is_artwork_pixel(pixel):
    red, green, blue = pixel
    maximum = max(red, green, blue)
    minimum = min(red, green, blue)
    saturation = maximum - minimum

    return (
        (saturation > 30 and maximum < 252)
        or maximum < 90
        or (maximum < 235 and saturation > 8)
        or maximum < 225
    )


def find_artwork_bbox(image, cell_bbox):
    left, top, right, bottom = cell_bbox
    padding = 10
    left += padding
    top += padding
    right -= padding
    bottom -= padding

    if right <= left or bottom <= top:
        return None

    crop = image.crop((left, top, right, bottom)).convert("RGB")
    width, height = crop.size
    pixels = crop.load()
    row_counts = []

    for y in range(height):
        count = 0

        for x in range(width):
            if is_artwork_pixel(pixels[x, y]):
                count += 1

        row_counts.append(count)

    threshold = max(10, int(width * 0.22))
    bands = []
    start = None

    for index, count in enumerate(row_counts):
        if count >= threshold:
            if start is None:
                start = index
        elif start is not None:
            if index - start >= 25:
                bands.append((start, index - 1, sum(row_counts[start:index])))
            start = None

    if start is not None and height - start >= 25:
        bands.append((start, height - 1, sum(row_counts[start:])))

    if not bands:
        return None

    band = max(
        bands,
        key=lambda item: (item[1] - item[0] + 1)
        * min(width, item[2] / max(1, item[1] - item[0] + 1)),
    )
    band_top, band_bottom = band[0], band[1]

    while band_top > 0 and row_counts[band_top - 1] > 5:
        band_top -= 1

    while band_bottom < height - 1 and row_counts[band_bottom + 1] > 5:
        band_bottom += 1

    column_counts = []

    for x in range(width):
        count = 0

        for y in range(band_top, band_bottom + 1):
            if is_artwork_pixel(pixels[x, y]):
                count += 1

        column_counts.append(count)

    column_threshold = max(5, int((band_bottom - band_top + 1) * 0.12))
    columns = [
        index
        for index, count in enumerate(column_counts)
        if count >= column_threshold
    ]

    if not columns:
        return None

    margin = 4
    art_left = max(0, min(columns) - margin)
    art_right = min(width, max(columns) + margin)
    art_top = max(0, band_top - margin)
    art_bottom = min(height, band_bottom + margin)

    if art_right - art_left < 80 or art_bottom - art_top < 35:
        return None

    return (
        left + art_left,
        top + art_top,
        left + art_right,
        top + art_bottom,
    )


def extract_artwork_crops(images, output_dir: str):
    Path(output_dir).mkdir(parents=True, exist_ok=True)
    crops = []

    for page_index, image in enumerate(images, start=1):
        x_lines, y_lines = find_grid_lines(image)

        if len(x_lines) < 2 or len(y_lines) < 2:
            continue

        for row_index in range(len(y_lines) - 1):
            if y_lines[row_index + 1] - y_lines[row_index] < 100:
                continue

            for column_index in range(len(x_lines) - 1):
                if x_lines[column_index + 1] - x_lines[column_index] < 100:
                    continue

                cell_bbox = (
                    x_lines[column_index],
                    y_lines[row_index],
                    x_lines[column_index + 1],
                    y_lines[row_index + 1],
                )
                bbox = find_artwork_bbox(image, cell_bbox)

                if bbox is None:
                    continue

                cell_lines = ocr_cell_lines(image, cell_bbox)
                cell_record = parse_cell_game_record(
                    cell_lines,
                    page_number=page_index,
                )
                crop_index = len(crops) + 1
                output_path = Path(output_dir) / f"game-{crop_index:03d}.png"
                image.crop(bbox).save(output_path, "PNG")
                crops.append(
                    {
                        "path": str(output_path),
                        "page_number": page_index,
                        "crop_index": crop_index,
                        "bbox": bbox,
                        "game_id": (
                            cell_record["game_id"]
                            if cell_record
                            else extract_game_id_from_lines(cell_lines)
                        ),
                        "record": cell_record,
                    }
                )

    return crops


def main() -> None:
    if len(sys.argv) < 4:
        fail("Usage: game_catalog_extract.py <file_path> <mime_type> <output_dir>")

    file_path = sys.argv[1]
    mime_type = sys.argv[2]
    output_dir = sys.argv[3]

    if mime_type == "application/pdf":
        images = render_pdf_pages(file_path)
        page_lines = extract_pdf_page_lines(file_path)
    elif mime_type.startswith("image/"):
        images = render_image_page(file_path)
        page_lines = []
    else:
        fail("Upload a PDF, PNG, JPG, or WEBP game catalog")

    lines = flatten_page_lines(page_lines)

    if len(lines) < 10:
        page_lines = extract_ocr_page_lines(images)
        lines = flatten_page_lines(page_lines)

    text_records = (
        parse_game_records_from_pages(page_lines)
        if page_lines
        else parse_game_records(lines)
    )
    crops = extract_artwork_crops(images, output_dir)

    if not crops:
        fail("No game images were found in the uploaded file")

    records, warnings = merge_text_and_cell_records(text_records, crops)

    if not records:
        fail("No game catalog rows were found in the uploaded file")

    games, match_warnings = match_records_to_crops(records, crops)
    warnings.extend(match_warnings)

    if not games:
        fail("No game catalog rows could be matched to game images")

    print(
        json.dumps(
            {
                "games": games,
                "warnings": warnings,
                "recordCount": len(records),
                "imageCount": len(crops),
                "matchedCount": len(games),
            }
        )
    )


if __name__ == "__main__":
    main()
