"""開発用サーバー（キャッシュ無効）。python3 build/devserver.py 8891
POST /__save?name=<英小文字・数字・_> で本文を build/baked/<name>.json に保存する（ローカルからだけ。生成器の結果の焼き込み用）"""
import http.server, os, re, sys
from urllib.parse import urlparse, parse_qs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def do_POST(self):
        u = urlparse(self.path)
        if u.path != '/__save' or self.client_address[0] not in ('127.0.0.1', '::1', '::ffff:127.0.0.1'):
            self.send_error(403)
            return
        name = parse_qs(u.query).get('name', [''])[0]
        if not re.fullmatch(r'[a-z0-9_]{1,40}', name):
            self.send_error(400)
            return
        n = int(self.headers.get('Content-Length', 0))
        if n <= 0 or n > 4_000_000:
            self.send_error(413)
            return
        body = self.rfile.read(n)
        d = os.path.join(ROOT, 'build', 'baked')
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, name + '.json'), 'wb') as f:
            f.write(body)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b'ok')


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8891
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
