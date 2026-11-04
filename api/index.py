import sys
import os

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
    path_info = environ.get("PATH_INFO", "")
    if path_info in ("/api/index.py", "/api/index", "/api", "/api/"):
        matched = environ.get("HTTP_X_MATCHED_PATH") or environ.get("RAW_URI") or environ.get("REQUEST_URI")
        if matched and matched not in ("/api/index.py", "/api/index"):
            environ["PATH_INFO"] = matched.split("?")[0]
        else:
            environ["PATH_INFO"] = "/"
    elif path_info.startswith("/api/index.py/"):
        environ["PATH_INFO"] = path_info.replace("/api/index.py", "", 1)
        
    return wsgi_app(environ, start_response)
