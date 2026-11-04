import sys
import os
from urllib.parse import parse_qs

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from database import init_db
from app import wsgi_app

try:
    init_db()
except Exception as e:
    print(f"Erro ao inicializar DB: {e}")

def app(environ, start_response):
    qs = parse_qs(environ.get("QUERY_STRING", ""))
    if "__path" in qs and qs["__path"]:
        orig_path = qs["__path"][0]
        environ["PATH_INFO"] = orig_path if orig_path.startswith("/") else f"/{orig_path}"
        # Remove __path do QUERY_STRING para não poluir as queries da API
        query_pairs = [p for p in environ.get("QUERY_STRING", "").split("&") if not p.startswith("__path=")]
        environ["QUERY_STRING"] = "&".join(query_pairs)
    elif environ.get("PATH_INFO") in ("/api/index.py", "/api/index", "/api", "/api/"):
        environ["PATH_INFO"] = "/"

    return wsgi_app(environ, start_response)
