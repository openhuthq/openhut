import importlib.util, json, os, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
class G(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['content-length'])))
        if body.get("channel")=="ch_ok":
            out=(200,{"object":"message_target","target":"slack:C0PULSE001","place":"#pulse"})
        else:
            out=(400,{"error":{"type":"invalid_request","message":"You can only post in your own channels: ch_ok C0PULSE001 (#pulse)."}})
        self.send_response(out[0]); self.send_header("content-type","application/json"); self.end_headers(); self.wfile.write(json.dumps(out[1]).encode())
srv=HTTPServer(("127.0.0.1",0),G); threading.Thread(target=srv.serve_forever,daemon=True).start()
os.environ["OPENHUT_GATEWAY"]=f"http://127.0.0.1:{srv.server_port}"; os.environ["OPENHUT_AGENT_TOKEN"]="t"
spec=importlib.util.spec_from_file_location("plug",sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
tools={}
class Ctx:
    def register_tool(self,**kw): tools[kw["name"]]=kw
    def register_hook(self,*a): pass
    def register_slack_action_handler(self,*a): pass
m.threading=type("T",(),{"Thread":lambda *a,**k: type("X",(),{"start":lambda s:None})()})
m.register(Ctx())
assert tools["post_message"]["toolset"]=="openhut-post"
h=tools["post_message"]["handler"]
print("ok   ", h({"channel":"ch_ok","message":"DB is healthy: 0 slow queries."}))
sent=sys.modules["tools.send_message_tool"].sent
assert sent==[{"action":"send","target":"slack:C0PULSE001","message":"DB is healthy: 0 slow queries."}], sent
print("deny ", h({"channel":"ch_someone_else","message":"hi"}))
print("empty", h({"channel":"ch_ok","message":"  "}))
assert len(sent)==1
print("plugin post_message check ok")
