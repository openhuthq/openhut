import asyncio, importlib.util, os, sys, threading, types
from http.server import BaseHTTPRequestHandler, HTTPServer
seen = []
class Gateway(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        seen.append((self.path, self.headers.get("authorization")))
        if self.path == "/u/slackfiles/files-pri/T1-F1/a.png":
            self.send_response(302); self.send_header("location", "/files-pri/T1-F1/a.png?t=1"); self.end_headers(); return
        self.send_response(200); self.send_header("content-type", "image/png"); self.end_headers(); self.wfile.write(b"PNG")
server = HTTPServer(("127.0.0.1", 0), Gateway)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d" % server.server_port
os.environ["OPENHUT_SLACK_API"] = base + "/u/slack/api/"
os.environ["OPENHUT_SLACK_FILES"] = base + "/u/slackfiles"
sys.path.insert(0, sys.argv[2])
spec = importlib.util.spec_from_file_location("ui", sys.argv[1])
ui = importlib.util.module_from_spec(spec); spec.loader.exec_module(ui)
class SlackAdapter:
    async def _download_slack_file_bytes(self, url, team_id="", *, html_label="file bytes"): return b"direct"
    def _resolve_download_token(self, url, team_id=""): return "xoxb-oh-ag_test0001.sig"
fake = types.ModuleType("hermes_slack_adapter"); fake.SlackAdapter = SlackAdapter; sys.modules["hermes_slack_adapter"] = fake
ui.broker_slack()
from slack_sdk.web.async_client import AsyncWebClient
from slack_sdk import WebClient
assert AsyncWebClient(token="xoxb-oh-x").base_url == os.environ["OPENHUT_SLACK_API"]
assert WebClient(token="xoxb-oh-x").base_url == os.environ["OPENHUT_SLACK_API"]
body = asyncio.run(SlackAdapter()._download_slack_file_bytes("https://files.slack.com/files-pri/T1-F1/a.png"))
assert body == b"PNG", body
assert seen == [("/u/slackfiles/files-pri/T1-F1/a.png", "Bearer xoxb-oh-ag_test0001.sig"), ("/u/slackfiles/files-pri/T1-F1/a.png?t=1", "Bearer xoxb-oh-ag_test0001.sig")], seen
try:
    asyncio.run(SlackAdapter()._download_slack_file_bytes("https://evil.example/files-pri/x"))
    raise SystemExit("evil host allowed")
except ValueError:
    pass
print("slack broker plugin ok")
