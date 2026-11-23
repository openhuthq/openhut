import json
import os
import re
import threading
import time
import urllib.request

from gateway.session_context import get_session_env

SPEC = re.compile(r"```spec\n[\s\S]*?```")
DESKTOP = "api_server"
MALFORMED = "I tried to show this as a card, but it couldn't be sent."
RUN = re.compile(r"\[Routine rt_[a-z0-9]+ · run (ru_[a-z0-9]+)\]")
POLL_SECONDS = 15
ORIGIN_FIELDS = ("platform", "chat_id", "chat_type", "chat_name", "thread_id", "user_id", "user_name")
STAMPED = ("schedule_routine", "update_self", "add_channel", "update_channel", "remove_channel", "request_connection")
injected = set()


def register(ctx):
    ctx.register_hook("transform_llm_output", render)
    ctx.register_hook("pre_tool_call", stamp)
    ctx.register_hook("post_llm_call", reported)
    ctx.register_slack_action_handler(re.compile(r"^card"), lambda ack, body, action: clicked(ctx, ack, body, action))
    if os.environ.get("OPENHUT_GATEWAY"):
        threading.Thread(target=poll, args=(ctx,), name="openhut-routines", daemon=True).start()


def render(response_text="", platform="", **_):
    platform = str(getattr(platform, "value", platform) or "")
    if "```spec" not in response_text or platform == DESKTOP:
        return None
    try:
        return gateway("/cards/render", {
            "text": response_text,
            "channel": platform,
            "chatId": get_session_env("HERMES_SESSION_CHAT_ID"),
            "threadId": get_session_env("HERMES_SESSION_THREAD_ID"),
        })["text"]
    except Exception:
        return SPEC.sub("", response_text).strip() or MALFORMED


def stamp(tool_name="", **_):
    if not str(tool_name).endswith(STAMPED):
        return None
    origin = {field: get_session_env("HERMES_SESSION_" + field.upper()) for field in ORIGIN_FIELDS}
    return {"action": "modify", "args": {"origin": {key: value for key, value in origin.items() if value}}}


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


async def clicked(ctx, ack, body, action):
    await ack()
    if not action.get("action_id", "").startswith("card:"):
        return
    channel = (body.get("channel") or {}).get("id", "")
    message = body.get("message") or {}
    ctx.inject_message(action.get("value") or "", origin={
        "platform": "slack",
        "chat_id": channel,
        "chat_type": "dm" if channel.startswith("D") else "group",
        "user_id": (body.get("user") or {}).get("id"),
        "thread_id": message.get("thread_ts") or message.get("ts"),
        "scope_id": (body.get("team") or {}).get("id"),
    })


def gateway(path, body=None):
    request = urllib.request.Request(
        os.environ["OPENHUT_GATEWAY"] + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={"authorization": "Agent " + os.environ["OPENHUT_AGENT_TOKEN"], "content-type": "application/json"},
        method="GET" if body is None else "POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)
