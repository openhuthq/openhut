import asyncio, json, os, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
calls = []
ANSWERS = {
    "/tools/post_message": lambda body: (200, {"send": {"target": "slack:C0PULSE001", "message": body["args"]["message"]}}) if body["args"].get("channel") == "ch_ok" else (400, {"error": {"type": "invalid_request", "message": "You can only post in your own channels: ch_ok C0PULSE001 (#pulse)."}}),
    "/tools/list_things": lambda body: (200, {"text": "two things"}),
    "/hooks/transform_llm_output": lambda body: (200, {"result": body["args"]["response_text"].replace("CARD", "card posted") if "CARD" in body["args"]["response_text"] else None}),
    "/hooks/pre_gateway_dispatch": lambda body: (200, {"result": {"action": "skip", "reason": "openhut invite"} if body["args"]["event"]["text"].startswith("/start ") else {"action": "allow", "reason": "openhut member"} if body["args"]["event"]["source"]["user_id"] == "555000111" else None}),
    "/hooks/subagent_stop": lambda body: (200, {"result": None}),
    "/wakes/inbox:ru_abc123": lambda body: (200, {"object": "wake", "id": "inbox:ru_abc123"}),
    "/slack-actions": lambda body: (200, {"inject": {"text": body["action"]["value"], "origin": {"platform": "slack", "chat_id": body["body"]["channel"]["id"]}}}),
}
WAKES = [{"id": "inbox:ru_abc123", "text": "[OpenHut inbox:ru_abc123] Routine rt_x: time for \"Chase Acme\".", "origin": {"platform": "slack", "chat_id": "C9", "thread_id": "1.2"}}]
class Gateway(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        calls.append((self.path, None))
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps({"object": "list", "data": WAKES}).encode())
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        calls.append((self.path, body))
        status, out = ANSWERS[self.path](body)
        self.send_response(status); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(out).encode())
server = HTTPServer(("127.0.0.1", 0), Gateway); threading.Thread(target=server.serve_forever, daemon=True).start()
os.environ["OPENHUT_GATEWAY"] = "http://127.0.0.1:%d" % server.server_port; os.environ["OPENHUT_AGENT_TOKEN"] = "t"; os.environ["TELEGRAM_ALLOWED_USERS"] = "123456789"
import openhut as m
m.threading = type("T", (), {"Thread": lambda *a, **k: type("X", (), {"start": lambda s: None})()})
settings = {"tools": [{"name": "post_message", "description": "Post.", "parameters": {"type": "object"}}, {"name": "list_things", "description": "List.", "parameters": {"type": "object"}}], "hooks": ["transform_llm_output", "pre_gateway_dispatch", "subagent_stop"], "slack_actions": ["card:"]}
tools, hooks, actions, injected = {}, {}, [], []
class Ctx:
    def get_config(self, key, default=None): return settings.get(key, default)
    def register_tool(self, **kw): tools[kw["name"]] = kw
    def register_hook(self, name, fn): hooks[name] = fn
    def register_slack_action_handler(self, pattern, fn): actions.append((pattern, fn))
    def inject_message(self, text, origin=None): injected.append((text, origin)); return True
ctx = Ctx(); m.register(ctx)
assert sorted(tools) == ["list_things", "post_message"] and {t["toolset"] for t in tools.values()} == {"openhut-local"}, tools
assert tools["post_message"]["schema"] == settings["tools"][0]
assert sorted(hooks) == ["post_llm_call", "pre_gateway_dispatch", "pre_llm_call", "pre_tool_call", "subagent_stop", "transform_llm_output"], hooks
assert [p.pattern for p, _ in actions] == ["^card:"]
stamped = {"action": "modify", "args": {"origin": {"platform": "slack", "chat_id": "C1"}}}
assert [hooks["pre_tool_call"](tool_name=n) for n in ("mcp__openhut__list_routines", "mcp__openhut__any_new_tool", "terminal", "mcp__github__x")] == [stamped, stamped, None, None]
print("ok   ", tools["post_message"]["handler"]({"channel": "ch_ok", "message": "DB is healthy."}))
assert sys.modules["tools.send_message_tool"].sent == [{"action": "send", "target": "slack:C0PULSE001", "message": "DB is healthy."}]
assert calls[-1] == ("/tools/post_message", {"args": {"channel": "ch_ok", "message": "DB is healthy."}, "origin": {"platform": "slack", "chat_id": "C1"}}), calls[-1]
print("deny ", tools["post_message"]["handler"]({"channel": "ch_other", "message": "hi"}))
assert tools["list_things"]["handler"]({}) == "two things"
assert len(sys.modules["tools.send_message_tool"].sent) == 1
assert hooks["transform_llm_output"](response_text="Here. CARD", platform="slack") == "Here. card posted"
assert hooks["transform_llm_output"](response_text="Plain.", platform="slack") is None
import dataclasses, enum
class Platform(enum.Enum):
    TELEGRAM = "telegram"
@dataclasses.dataclass
class Source:
    platform: Platform
    chat_id: str
    user_id: str
    user_name: str
@dataclasses.dataclass
class Event:
    text: str
    source: Source
    raw_message: object = None
class Runner: pass
event = lambda text, user="123456789": Event(text, Source(Platform.TELEGRAM, user, user, "Alex"), raw_message=Runner())
assert hooks["pre_gateway_dispatch"](event=event("/start abcdefghijklmnop"), gateway=Runner(), session_store=None) == {"action": "skip", "reason": "openhut invite"}
assert hooks["pre_gateway_dispatch"](event=event("hello"), gateway=Runner()) is None
assert calls[-1] == ("/hooks/pre_gateway_dispatch", {"args": {"event": {"text": "hello", "source": {"platform": "telegram", "chat_id": "123456789", "user_id": "123456789", "user_name": "Alex"}, "raw_message": None}, "gateway": None}, "origin": {"platform": "slack", "chat_id": "C1"}}), calls[-1]
stranger = {"action": "skip", "reason": "openhut stranger"}
assert hooks["pre_gateway_dispatch"](event=event("hello", "999000111"), gateway=Runner()) == stranger, "a stranger the gateway has no answer for gets nothing"
assert hooks["pre_gateway_dispatch"](event=event("hello", "555000111"), gateway=Runner()) == {"action": "allow", "reason": "openhut member"}
assert os.environ["TELEGRAM_ALLOWED_USERS"] == "123456789,555000111", "a member who just joined goes on Hermes's list before Hermes restarts"
before = len(calls)
assert hooks["subagent_stop"](parent_session_id="s1", child_status="completed", tool_call_history=[{"tool": "terminal"}], duration_ms=12) is None
assert len(calls) == before and m.notices.qsize() == 1, "an observer hook returns at once and is sent from the notices thread"
class Drained(Exception): pass
queued = m.notices
m.notices = type("Q", (), {"get": lambda s: queued.get_nowait() if queued.qsize() else (_ for _ in ()).throw(Drained())})()
try:
    m.notify()
except Drained:
    pass
assert calls[-1] == ("/hooks/subagent_stop", {"args": {"parent_session_id": "s1", "child_status": "completed", "tool_call_history": [{"tool": "terminal"}], "duration_ms": 12}, "origin": {"platform": "slack", "chat_id": "C1"}}), calls[-1]
m.notices = queued
async def ack(): pass
asyncio.run(actions[0][1](ack, {"channel": {"id": "C9"}}, {"action_id": "card:approve", "value": "Approve"}))
assert injected == [("Approve", {"platform": "slack", "chat_id": "C9"})], injected
class Stop(Exception): pass
def stop(_): raise Stop()
m.time.sleep = stop
injected.clear()
try:
    m.poll(ctx)
except Stop:
    pass
assert injected == [(WAKES[0]["text"], WAKES[0]["origin"])], injected
assert calls[-2:] == [("/wakes", None), ("/wakes/inbox:ru_abc123", {"picked": True})], calls[-2:]
try:
    m.poll(ctx)
except Stop:
    pass
assert len(injected) == 1, "a wake is injected once, however often it is listed"
hooks["post_llm_call"](user_message="Slack says: " + WAKES[0]["text"], assistant_response="Chased Acme.")
assert calls[-1] == ("/wakes/inbox:ru_abc123", {"said": "Chased Acme."}), calls[-1]
before = len(calls)
hooks["post_llm_call"](user_message="[OpenHut inbox:ru_other1] not ours", assistant_response="x")
hooks["post_llm_call"](user_message="hello", assistant_response="x")
assert len(calls) == before, "only a wake this plugin injected is reported"
while not m.notices.empty(): m.notices.get()
assert hooks["pre_llm_call"](turn_id="tu_1", user_message="hi") is None
hooks["post_llm_call"](turn_id="tu_1", user_message="hi", assistant_response="x")
assert [m.notices.get(), m.notices.get()] == [("/turns", {"turn": "tu_1", "state": "start"}), ("/turns", {"turn": "tu_1", "state": "end"})], "each turn's start and end go to the gateway in the background"
os.environ["OPENHUT_GATEWAY"] = "http://127.0.0.1:9"
assert hooks["transform_llm_output"](response_text="CARD", platform="slack") is None
assert hooks["pre_gateway_dispatch"](event=event("/start abcdefghijklmnop")) is None
assert hooks["pre_gateway_dispatch"](event=event("hello", "999000111")) == stranger, "with the gateway down, a stranger still gets nothing"
assert hooks["pre_gateway_dispatch"](event=event("hello", "555000111")) is None
print("openhut plugin check ok")
