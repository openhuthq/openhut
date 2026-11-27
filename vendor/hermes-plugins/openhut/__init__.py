import asyncio
import dataclasses
import enum
import json
import os
import queue
import re
import sys
import threading
import time
import urllib.error
import urllib.request

from gateway.session_context import get_session_env

from .slack_transport import broker_slack

OURS = "mcp__openhut__"
ORIGIN_FIELDS = ("platform", "chat_id", "chat_type", "chat_name", "thread_id", "parent_chat_id", "user_id", "user_name", "scope_id")
LOCAL_TOOLSET = "openhut-local"
WAKE = re.compile(r"\[OpenHut (\w+:\w+)\]")
POLL_SECONDS = 15
RETRY_SECONDS = 2
MCP_SERVER = "openhut"
ANSWERED = ("pre_", "transform_")
NOTIFY_SECONDS = 5
STRANGER = {"action": "skip", "reason": "openhut stranger"}
injected = set()
warned = {}
notices = queue.Queue()
allowing = threading.Lock()


def register(ctx):
    broker_slack()
    for tool in ctx.get_config("tools", []) or []:
        ctx.register_tool(name=tool["name"], toolset=LOCAL_TOOLSET, schema=tool, handler=local(tool["name"]))
    ctx.register_hook("pre_tool_call", stamp)
    ctx.register_hook("pre_llm_call", turn("start"))
    ctx.register_hook("post_llm_call", said)
    for name in ctx.get_config("hooks", []) or []:
        ctx.register_hook(name, dispatch if name == "pre_gateway_dispatch" else forward(name))
    for prefix in ctx.get_config("slack_actions", []) or []:
        ctx.register_slack_action_handler(re.compile("^" + re.escape(prefix)), lambda ack, body, action: clicked(ctx, ack, body, action))
    threading.Thread(target=notify, name="openhut-notices", daemon=True).start()
    if os.environ.get("OPENHUT_GATEWAY"):
        threading.Thread(target=poll, args=(ctx,), name="openhut-wakes", daemon=True).start()


def origin():
    found = {field: get_session_env("HERMES_SESSION_" + field.upper()) for field in ORIGIN_FIELDS}
    return {key: value for key, value in found.items() if value}


def stamp(tool_name="", **_):
    if not str(tool_name).startswith(OURS):
        return None
    return {"action": "modify", "args": {"origin": origin()}}


def local(name):
    def run(args, **_):
        try:
            found = gateway("/tools/" + name, {"args": args or {}, "origin": origin()})
        except urllib.error.HTTPError as err:
            return json.dumps({"error": json.load(err).get("error", {}).get("message", "OpenHut refused that.")})
        if "send" in found:
            from tools.send_message_tool import send_message_tool
            return send_message_tool({"action": "send", **found["send"]})
        return found["text"]
    return run


def forward(name):
    def hook(**kwargs):
        try:
            body = {"args": plain(kwargs), "origin": origin()}
            if not name.startswith(ANSWERED):
                notices.put(("/hooks/" + name, body))
                return None
            return gateway("/hooks/" + name, body).get("result")
        except Exception:
            return None
    return hook


def notify():
    while True:
        path, body = notices.get()
        try:
            gateway(path, body, timeout=NOTIFY_SECONDS)
        except Exception as err:
            warn(path, describe(err))


def dispatch(**kwargs):
    source = getattr(kwargs.get("event"), "source", None)
    user = str(getattr(source, "user_id", None) or "")
    result = forward("pre_gateway_dispatch")(**kwargs)
    if plain(getattr(source, "platform", None)) != "telegram" or not user:
        return result
    with allowing:
        allowed = os.environ.get("TELEGRAM_ALLOWED_USERS", "")
        if os.environ.get("TELEGRAM_ALLOW_ALL_USERS") == "true" or user in allowed.split(","):
            return result
        if isinstance(result, dict) and result.get("action") == "allow":
            os.environ["TELEGRAM_ALLOWED_USERS"] = allowed + "," + user if allowed else user
            return result
    return result if isinstance(result, dict) and result.get("action") == "skip" else STRANGER


def plain(value, depth=0):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, enum.Enum):
        return plain(value.value, depth)
    if depth > 4:
        return None
    if isinstance(value, dict):
        return {str(key): plain(item, depth + 1) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [plain(item, depth + 1) for item in value]
    if dataclasses.is_dataclass(value) and not isinstance(value, type):
        return {field.name: plain(getattr(value, field.name), depth + 1) for field in dataclasses.fields(value) if not field.name.startswith("_")}
    return None


async def clicked(ctx, ack, body, action):
    await ack()
    try:
        found = await asyncio.to_thread(gateway, "/slack-actions", {"body": body, "action": action})
    except Exception:
        return
    if found.get("inject"):
        ctx.inject_message(found["inject"]["text"], origin=found["inject"]["origin"])


def poll(ctx):
    lost = False
    while True:
        try:
            due = gateway("/wakes")["data"]
            if lost:
                revive()
            lost = False
            for wake in due:
                try:
                    if wake["id"] not in injected:
                        if not ctx.inject_message(wake["text"], origin=wake["origin"]):
                            warn("wake " + wake["id"], "Hermes refused to start a turn at " + json.dumps(wake["origin"]) + "; its log says why")
                            continue
                        injected.add(wake["id"])
                    gateway("/wakes/" + wake["id"], {"picked": True})
                except Exception as err:
                    warn("wake " + wake["id"], describe(err))
        except Exception as err:
            lost = True
            warn("wake poll", describe(err))
        time.sleep(RETRY_SECONDS if lost else POLL_SECONDS)


def revive():
    try:
        from tools.mcp_tool_loop import reconnect_mcp_server
        reconnect_mcp_server(MCP_SERVER)
    except Exception as err:
        warn("mcp reconnect", describe(err))


def turn(state):
    def hook(turn_id="", **_):
        if turn_id and os.environ.get("OPENHUT_GATEWAY"):
            notices.put(("/turn-state", {"turn": str(turn_id), "state": state}))
    return hook


def warn(key, message):
    if warned.get(key) == message:
        return
    warned[key] = message
    print("openhut: " + key + ": " + message, file=sys.stderr, flush=True)


def describe(err):
    if isinstance(err, urllib.error.HTTPError):
        try:
            return "gateway answered " + str(err.code) + ": " + json.load(err).get("error", {}).get("message", "")
        except Exception:
            return "gateway answered " + str(err.code)
    return type(err).__name__ + ": " + str(err)


def said(user_message="", assistant_response="", turn_id="", **_):
    turn("end")(turn_id=turn_id)
    match = WAKE.search(str(user_message or ""))
    if not match or match.group(1) not in injected:
        return
    try:
        gateway("/wakes/" + match.group(1), {"said": str(assistant_response or "")})
    except Exception:
        pass


def gateway(path, body=None, timeout=15):
    request = urllib.request.Request(
        os.environ["OPENHUT_GATEWAY"] + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"authorization": "Agent " + os.environ["OPENHUT_AGENT_TOKEN"], "content-type": "application/json"},
        method="GET" if body is None else "POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)
