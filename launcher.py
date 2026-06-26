import threading
import webbrowser
import time
import sys
import os

# Add bundled path when running as PyInstaller exe
if getattr(sys, 'frozen', False):
    os.chdir(sys._MEIPASS)

from app import app

def open_browser():
    time.sleep(1.5)
    webbrowser.open('http://localhost:5050')

threading.Thread(target=open_browser, daemon=True).start()
app.run(port=5050, debug=False)
