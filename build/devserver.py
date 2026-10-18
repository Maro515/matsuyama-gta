"""開発用サーバー（キャッシュ無効）。python3 build/devserver.py 8891"""
import http.server, sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8891
http.server.ThreadingHTTPServer(('', port), NoCache).serve_forever()
