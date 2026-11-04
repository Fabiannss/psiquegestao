import sys
import os

# Adiciona o diretório raiz ao sys.path para importar app e database
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from database import init_db
from app import wsgi_app

# Inicializa o banco de dados se necessário
try:
    init_db()
except Exception as e:
    print(f"Erro ao inicializar DB: {e}")

# Vercel Serverless Function entrypoint
app = wsgi_app
