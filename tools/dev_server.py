import http.server
import json
import os
import sys

PORT = 8765
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        if self.path == '/api/save-roads':
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                body = self.rfile.read(content_length).decode('utf-8')
                data = json.loads(body)

                target_filename = data.get('filename', 'zaire_village_roads.json')
                # Защита от выхода за пределы директории
                target_filename = os.path.basename(target_filename)
                target_file = os.path.join(ROOT, 'models', target_filename)
                with open(target_file, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2, ensure_ascii=False)

                resp = json.dumps({"status": "ok", "filename": target_filename, "message": f"Файл {target_filename} успешно сохранён!"}).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
                print(f"[Server] Успешно сохранено: {target_file} ({len(body)} байт)")
            except Exception as e:
                err_resp = json.dumps({"status": "error", "message": str(e)}).encode('utf-8')
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Content-Length', str(len(err_resp)))
                self.end_headers()
                self.wfile.write(err_resp)
                print(f"[Server ERROR] Ошибка сохранения: {e}", file=sys.stderr)
        else:
            self.send_response(404)
            self.end_headers()

    def end_headers(self):
        # Enable CORS for local tools
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

if __name__ == '__main__':
    server = http.server.ThreadingHTTPServer(('127.0.0.1', PORT), CustomHandler)
    print(f"AFRICAN_IT_DRIVERS Dev Server listening on http://127.0.0.1:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Server stopped.")
