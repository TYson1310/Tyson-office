import base64
import hashlib
import importlib.util
import io
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch


def load_api_module():
    module_path = Path(__file__).parents[1] / "api" / "game-catalog-extract.py"
    spec = importlib.util.spec_from_file_location("game_catalog_extract_api", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GameCatalogExtractApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.api = load_api_module()

    def build_request(self, key):
        request = object.__new__(self.api.handler)
        request.headers = {
            "Content-Length": "4",
            "X-Game-Catalog-Key": key,
            "X-Game-Catalog-Mime-Type": "application/pdf",
        }
        request.rfile = io.BytesIO(b"%PDF")
        request.wfile = io.BytesIO()
        request.status_codes = []
        request.send_response = request.status_codes.append
        request.send_header = lambda *_args: None
        request.end_headers = lambda: None
        return request

    def test_rejects_request_without_server_credential(self):
        request = self.build_request("invalid")

        with patch.dict(os.environ, {"SUPABASE_SERVICE_ROLE_KEY": "secret"}):
            request.do_POST()

        self.assertEqual(request.status_codes, [404])
        self.assertEqual(json.loads(request.wfile.getvalue()), {"error": "Not found"})

    def test_returns_extracted_image_data(self):
        def fake_extract(_input_path, output_dir):
            image_path = Path(output_dir) / "00001.png"
            image_path.parent.mkdir(parents=True)
            image_path.write_bytes(b"png-data")
            return (
                [
                    {
                        "game_id": "00001",
                        "game_name": "Test Game",
                        "ticket_price": 5,
                        "image_path": str(image_path),
                        "page_number": 1,
                        "crop_index": 1,
                        "crop_bbox": [0, 0, 1, 1],
                        "prizes": [],
                    }
                ],
                [],
                1,
                1,
            )

        secret = "secret"
        request = self.build_request(hashlib.sha256(secret.encode()).hexdigest())

        with (
            patch.dict(os.environ, {"SUPABASE_SERVICE_ROLE_KEY": secret}),
            patch.object(self.api, "extract_pdf_games", fake_extract),
        ):
            request.do_POST()

        payload = json.loads(request.wfile.getvalue())
        self.assertEqual(request.status_codes, [200])
        self.assertEqual(payload["matchedCount"], 1)
        self.assertEqual(
            base64.b64decode(payload["games"][0]["image_data"]),
            b"png-data",
        )


if __name__ == "__main__":
    unittest.main()