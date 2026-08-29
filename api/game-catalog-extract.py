import base64
import hashlib
import hmac
import json
import os
import tempfile
from http.server import BaseHTTPRequestHandler
from pathlib import Path

from scripts.game_catalog_extract import extract_pdf_games


MAX_UPLOAD_BYTES = 25 * 1024 * 1024


class handler(BaseHTTPRequestHandler):
    def send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        expected_key = hashlib.sha256(service_role_key.encode("utf-8")).hexdigest()
        provided_key = self.headers.get("X-Game-Catalog-Key", "")

        if not service_role_key or not hmac.compare_digest(provided_key, expected_key):
            self.send_json(404, {"error": "Not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = 0

        if content_length <= 0:
            self.send_json(400, {"error": "Game catalog file is empty"})
            return

        if content_length > MAX_UPLOAD_BYTES:
            self.send_json(413, {"error": "Game catalog file must be 25MB or smaller"})
            return

        mime_type = self.headers.get("X-Game-Catalog-Mime-Type", "")

        if mime_type != "application/pdf":
            self.send_json(400, {"error": "Upload a PDF game catalog"})
            return

        file_data = self.rfile.read(content_length)

        try:
            with tempfile.TemporaryDirectory(prefix="game-catalog-") as temp_dir:
                input_path = Path(temp_dir) / "catalog.pdf"
                output_dir = Path(temp_dir) / "images"
                input_path.write_bytes(file_data)
                games, warnings, record_count, image_count = extract_pdf_games(
                    str(input_path),
                    str(output_dir),
                )

                if not games:
                    raise ValueError("No game catalog rows could be matched to game images")

                response_games = []

                for game in games:
                    image_data = base64.b64encode(
                        Path(game["image_path"]).read_bytes()
                    ).decode("ascii")
                    response_games.append(
                        {
                            **game,
                            "image_data": image_data,
                            "image_path": None,
                        }
                    )

                self.send_json(
                    200,
                    {
                        "games": response_games,
                        "warnings": warnings,
                        "recordCount": record_count,
                        "imageCount": image_count,
                        "matchedCount": len(games),
                    },
                )
        except SystemExit:
            self.send_json(422, {"error": "Game catalog extraction failed"})
        except Exception as error:
            self.send_json(422, {"error": str(error)})