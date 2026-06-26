import threading
import sys
import os
import logging

# Add bundled path when running as PyInstaller exe
if getattr(sys, 'frozen', False):
    os.chdir(sys._MEIPASS)

from app import app
import webview

logging.getLogger('werkzeug').setLevel(logging.ERROR)

HOST = '127.0.0.1'
PORT = 5050


def run_server():
    app.run(host=HOST, port=PORT, debug=False, use_reloader=False)


if __name__ == '__main__':
    threading.Thread(target=run_server, daemon=True).start()
    webview.create_window('Simulador de Volumen', f'http://{HOST}:{PORT}', width=1100, height=800, min_size=(800, 600))
    webview.start()
