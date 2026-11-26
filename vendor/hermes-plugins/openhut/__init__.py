import asyncio
import dataclasses
import enum
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

from gateway.session_context import get_session_env

from .slack_transport import broker_slack

OURS = "mcp__openhut__"
ORIGIN_FIELDS = ("platform", "chat_id", "chat_type", "chat_name", "thread_id", "user_id", "user_name")
LOCAL_TOOLSET = "openhut-local"
RUN = re.compile(r"\[Routine rt_[a-z0-9]+ · run (ru_[a-z0-9]+)\]")
POLL_SECONDS = 15
injected = set()


def register(ctx):
    broker_slack()
    for tool in ctx.get_config("tools", []) or []:
        ctx.register_tool(name=tool["name"], toolset=LOCAL_TOOLSET, schema=tool, handler=local(tool["name"]))
    ctx.register_hook("pre_tool_call", stamp)
    ctx.register_hook("post_llm_call", reported)
    for name in ctx.get_config("hooks", []) or []:
        ctx.register_hook(name, forward(name))
    for prefix in ctx.get_config("slack_actions", []) or []:
        ctx.register_slack_action_handler(re.compile("^" + re.escape(prefix)), lambda ack, body, action: clicked(ctx, ack, body, action))
    if os.environ.get("OPENHUT_GATEWAY"):
        threading.Thread(target=poll, args=(ctx,), name="openhut-routines", daemon=True).start()


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
            return gateway("/hooks/" + name, {"args": plain(kwargs), "origin": origin()}).get("result")
        except Exception:
            return None
    return hook


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
    while True:
        try:
            for run in gateway("/routines/due")["data"]:
                if run["runId"] not in injected:
                    if not ctx.inject_message(run["text"], origin=run["origin"]):
                        continue
                    injected.add(run["runId"])
                gateway("/routines/runs/" + run["runId"], {"picked": True})
        except Exception:
            pass
        time.sleep(POLL_SECONDS)


def reported(user_message="", assistant_response="", **_):
    match = RUN.search(str(user_message or ""))
    if not match or match.group(1) not in injected:
        return
    try:
        gateway("/routines/runs/" + match.group(1), {"said": str(assistant_response or "")})
    except Exception:
        pass


def gateway(path, body=None):
    request = urllib.request.Request(
        os.environ["OPENHUT_GATEWAY"] + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"authorization": "Agent " + os.environ["OPENHUT_AGENT_TOKEN"], "content-type": "application/json"},
        method="GET" if body is None else "POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)
