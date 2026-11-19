import json
import os
import re
import urllib.request

from gateway.session_context import get_session_env

SPEC = re.compile(r"```spec\n[\s\S]*?```")
DESKTOP = "api_server"
MALFORMED = "I tried to show this as a card, but it couldn't be sent."


def register(ctx):
    ctx.register_hook("transform_llm_output", render)
    ctx.register_slack_action_handler(re.compile(r"^card"), lambda ack, body, action: clicked(ctx, ack, body, action))


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


def gateway(path, body):
    request = urllib.request.Request(
        os.environ["OPENHUT_GATEWAY"] + path,
        data=json.dumps(body).encode(),
        headers={"authorization": "Agent " + os.environ["OPENHUT_AGENT_TOKEN"], "content-type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        return json.load(response)
