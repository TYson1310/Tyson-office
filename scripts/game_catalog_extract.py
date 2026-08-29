#!/usr/bin/env python3
import io
import json
import os
import re
import sys
from pathlib import Path

MISSING_DEPS_MESSAGE = (
    "Game catalog extraction dependencies are missing. Install Python packages "
    "with `python3 -m pip install -r requirements-game-catalog.txt`."
)
#TYson
PRICE_RE = re.compile(r"\$\s*(\d{1,3}(?:\.\d{2})?)\b")
GAME_ID_RE = re.compile(r"#\s*0?(\d{1,5})\b")
PRIZE_RE = re.compile(r"\$?\s*([\d,]+(?:\.\d+)?(?:\*)?)\s*-\s*(\d+)")


def fail(message: str) -> None:
    print(json.dumps({"error": message}), file=sys.stderr)
    raise SystemExit(1)


def import_fitz():
    try:
        import fitz

        return fitz
    except ImportError:
        fail(MISSING_DEPS_MESSAGE)


def import_image():
    try:
        from PIL import Image

        return Image
    except ImportError:
        fail(MISSING_DEPS_MESSAGE)


def normalize_line(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def normalize_game_name(value: str) -> str:
    return normalize_line(value).replace("Ca$h", "Cash")


def max_pages() -> int:
    try:
        return max(1, int(os.environ.get("GAME_CATALOG_MAX_PAGES", "12")))
    except ValueError:
        return 12


def is_prize_line(value: str) -> bool:
    return PRIZE_RE.search(value) is not None and "-" in value


def is_catalog_noise_line(value: str) -> bool:
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
    )


def page_words(page):
    return [
        {
            "x0": float(word[0]),
            "y0": float(word[1]),
            "x1": float(word[2]),
            "y1": float(word[3]),
            "text": str(word[4]),
        }
        for word in page.get_text("words")
    ]


def words_to_lines(words, y_tolerance=3.0):
    lines = []

    for word in sorted(words, key=lambda item: (item["y0"], item["x0"])):
        matching_line = next(
            (
                line
                for line in reversed(lines[-4:])
                if abs(line["baseline"] - word["y0"]) <= y_tolerance
            ),
            None,
        )

        if matching_line is None:
            lines.append(
                {
                    "baseline": word["y0"],
                    "words": [word],
                }
            )
        else:
            matching_line["words"].append(word)

    normalized_lines = []

    for line in lines:
        line_words = sorted(line["words"], key=lambda item: item["x0"])
        text = normalize_line(" ".join(word["text"] for word in line_words))

        if not text:
            continue

        normalized_lines.append(
            {
                "text": text,
                "x0": min(word["x0"] for word in line_words),
                "y0": min(word["y0"] for word in line_words),
                "x1": max(word["x1"] for word in line_words),
                "y1": max(word["y1"] for word in line_words),
            }
        )

    return normalized_lines


def collect_box_lines(words, image_bbox):
    x0, y0, x1, y1 = image_bbox
    column_left = x0 - 25
    column_right = x1 + 25
    window_top = y0 - 115
    window_bottom = y1 + 210
    selected_words = []

    for word in words:
        word_center_x = (word["x0"] + word["x1"]) / 2
        word_center_y = (word["y0"] + word["y1"]) / 2

        if (
            column_left <= word_center_x <= column_right
            and window_top <= word_center_y <= window_bottom
        ):
            selected_words.append(word)

    return words_to_lines(selected_words)


def strip_game_metadata(value: str) -> str:
    value = GAME_ID_RE.sub("", value)
    value = re.sub(r"\$\s*\d{1,3}\.\d{2}\b", "", value)
    value = re.sub(r"\s+", " ", value)
    value = value.strip(" -")

    return normalize_line(value)


def has_direct_prize_lines(lines, image_bbox):
    _x0, _y0, _x1, image_bottom = image_bbox

    return any(
        is_prize_line(line["text"])
        and image_bottom - 5 <= line["y0"] <= image_bottom + 115
        for line in lines
    )


def extract_ticket_price(lines, game_id_line_index):
    candidates = []

    if game_id_line_index is not None:
        candidates.append(lines[game_id_line_index]["text"])

        for offset in range(1, 4):
            index = game_id_line_index - offset

            if index >= 0:
                candidates.append(lines[index]["text"])

    candidates.extend(line["text"] for line in lines)

    for line in candidates:
        if is_prize_line(line):
            continue

        for match in PRICE_RE.finditer(line):
            raw_price = match.group(1)
            has_decimal = "." in raw_price
            parsed = float(raw_price)
            compact_line = strip_game_metadata(line)

            if 0 < parsed <= 100 and (has_decimal or not compact_line):
                return parsed

    return None


def extract_game_name(lines, game_id_line_index):
    if game_id_line_index is None:
        return ""

    name_lines = []

    for line in lines[:game_id_line_index]:
        text = line["text"]

        if is_catalog_noise_line(text) or is_prize_line(text):
            continue

        cleaned = strip_game_metadata(text)

        if cleaned and re.search(r"[A-Za-z]", cleaned):
            name_lines.append(cleaned)

    if not name_lines:
        return ""

    return normalize_game_name(" ".join(name_lines[-4:]))


def parse_prizes(lines):
    prizes = []
    seen = set()

    for line in lines:
        text = line["text"]

        for match in PRIZE_RE.finditer(text):
            amount = normalize_line(match.group(1)).replace(" ", "")
            remaining_count = int(match.group(2).replace(",", ""))
            key = (amount, remaining_count)

            if key in seen:
                continue

            seen.add(key)
            prizes.append(
                {
                    "prize_amount": amount,
                    "remaining_count": remaining_count,
                    "source_text": text,
                }
            )

    return [
        {
            **prize,
            "prize_rank": index + 1,
        }
        for index, prize in enumerate(prizes)
    ]


def parse_game_from_lines(lines):
    game_id = None
    game_id_line_index = None

    for index, line in enumerate(lines):
        match = GAME_ID_RE.search(line["text"])

        if match:
            game_id = match.group(1).zfill(5)
            game_id_line_index = index
            break

    if not game_id:
        return None

    ticket_price = extract_ticket_price(lines, game_id_line_index)
    game_name = extract_game_name(lines, game_id_line_index)

    if ticket_price is None or not game_name:
        return None

    return {
        "game_id": game_id,
        "game_name": game_name,
        "ticket_price": ticket_price,
        "prizes": parse_prizes(lines),
    }


def save_image_block_as_png(block, output_path):
    Image = import_image()

    try:
        with Image.open(io.BytesIO(block["image"])) as image:
            image.convert("RGBA").save(output_path, "PNG")
    except Exception as exc:
        fail(f"Failed to save game image {output_path.name}: {exc}")


def is_possible_game_image(block):
    x0, y0, x1, y1 = block["bbox"]
    width = x1 - x0
    height = y1 - y0

    return width >= 35 and height >= 30


def extract_text_record_count(document):
    game_ids = set()

    for page_index, page in enumerate(document):
        if page_index >= max_pages():
            break

        for match in GAME_ID_RE.finditer(page.get_text()):
            game_ids.add(match.group(1).zfill(5))

    return len(game_ids)


def extract_pdf_games(file_path: str, output_dir: str):
    fitz = import_fitz()
    Path(output_dir).mkdir(parents=True, exist_ok=True)

    try:
        document = fitz.open(file_path)
    except Exception as exc:
        fail(f"Game catalog PDF could not be opened: {exc}")

    games = []
    warnings = []
    seen_game_ids = set()
    parsed_image_count = 0

    for page_index, page in enumerate(document):
        if page_index >= max_pages():
            break

        page_number = page_index + 1
        words = page_words(page)
        image_blocks = [
            block
            for block in page.get_text("dict")["blocks"]
            if block.get("type") == 1 and is_possible_game_image(block)
        ]

        for block in image_blocks:
            lines = collect_box_lines(words, block["bbox"])

            if not has_direct_prize_lines(lines, block["bbox"]):
                continue

            record = parse_game_from_lines(lines)

            if not record:
                continue

            parsed_image_count += 1
            game_id = record["game_id"]

            if game_id in seen_game_ids:
                warnings.append(f"Ignored duplicate image block for game #{game_id}.")
                continue

            image_path = Path(output_dir) / f"{game_id}.png"
            save_image_block_as_png(block, image_path)
            seen_game_ids.add(game_id)
            games.append(
                {
                    **record,
                    "image_path": str(image_path),
                    "page_number": page_number,
                    "crop_index": parsed_image_count,
                    "crop_bbox": [round(float(value), 2) for value in block["bbox"]],
                }
            )

    record_count = extract_text_record_count(document)

    if record_count > len(games):
        warnings.append(
            f"Found {record_count} game number(s) in PDF text but matched "
            f"{len(games)} image-backed game row(s)."
        )

    return games, warnings, record_count, parsed_image_count


def main() -> None:
    if len(sys.argv) < 4:
        fail("Usage: game_catalog_extract.py <file_path> <mime_type> <output_dir>")

    file_path = sys.argv[1]
    mime_type = sys.argv[2]
    output_dir = sys.argv[3]

    if mime_type != "application/pdf":
        fail("Upload a PDF game catalog. PyMuPDF extraction requires a PDF file.")

    games, warnings, record_count, image_count = extract_pdf_games(
        file_path,
        output_dir,
    )

    if not games:
        fail("No game catalog rows could be matched to game images")

    print(
        json.dumps(
            {
                "games": games,
                "warnings": warnings,
                "recordCount": record_count,
                "imageCount": image_count,
                "matchedCount": len(games),
            }
        )
    )


if __name__ == "__main__":
    main()
