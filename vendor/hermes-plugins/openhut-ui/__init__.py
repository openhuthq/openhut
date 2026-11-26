import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request

from gateway.session_context import get_session_env

SPEC = re.compile(r"```spec\n[\s\S]*?```")
DESKTOP = "api_server"
MALFORMED = "I tried to show this as a card, but it couldn't be sent."
RUN = re.compile(r"\[Routine rt_[a-z0-9]+ · run (ru_[a-z0-9]+)\]")
INVITE = re.compile(r"^/start(?:@\w+)?\s+([\w-]{16,64})$")
POLL_SECONDS = 15
ORIGIN_FIELDS = ("platform", "chat_id", "chat_type", "chat_name", "thread_id", "user_id", "user_name")
STAMPED = ("schedule_routine", "update_self", "add_channel", "update_channel", "remove_channel", "request_connection", "call_tool", "add_webhook", "add_secret", "propose_connection")
injected = set()
POST_TOOLSET = "openhut-post"
POST_SCHEMA = {
    "name": "post_message",
    "description": "Post a message in one of your own channels without being asked there first, like a report for the team. get_self's postTo lists where you can post. You can't post anywhere else.",
    "parameters": {
        "type": "object",
        "properties": {
            "channel": {"type": "string", "description": "The channel id from postTo."},
            "chat": {"type": "string", "description": "The chat from postTo. Leave out for the channel's first one."},
            "message": {"type": "string", "description": "What to post, in plain words."},
        },
        "required": ["channel", "message"],
    },
}


def register(ctx):
    broker_slack()
    ctx.register_tool(name="post_message", toolset=POST_TOOLSET, schema=POST_SCHEMA, handler=post_message)
    ctx.register_hook("transform_llm_output", render)
    ctx.register_hook("pre_tool_call", stamp)
    ctx.register_hook("post_llm_call", reported)
    ctx.register_hook("pre_gateway_dispatch", invited)
    ctx.register_slack_action_handler(re.compile(r"^card"), lambda ack, body, action: clicked(ctx, ack, body, action))
    if os.environ.get("OPENHUT_GATEWAY"):
        threading.Thread(target=poll, args=(ctx,), name="openhut-routines", daemon=True).start()


def broker_slack():
    api, files = os.environ.get("OPENHUT_SLACK_API"), os.environ.get("OPENHUT_SLACK_FILES")
    if not api or not files:
        return
    try:
        from slack_sdk.web import async_base_client, base_client
    except ImportError:
        return
    for klass in (async_base_client.AsyncBaseClient, base_client.BaseClient):
        klass.__init__ = through_gateway(klass.__init__, api, files)


def through_gateway(original, api, files):
    def init(self, *args, **kwargs):
        if len(args) > 1:
            args = (args[0], api, *args[2:])
        else:
            kwargs["base_url"] = api
        original(self, *args, **kwargs)
        patch_downloads(files)
    return init


def patch_downloads(files):
    for module in list(sys.modules.values()):
        adapter = getattr(module, "SlackAdapter", None)
        if adapter is None or not hasattr(adapter, "_download_slack_file_bytes") or getattr(adapter, "_openhut_brokered", False):
            continue
        adapter._download_slack_file_bytes = download_through(files)
        adapter._openhut_brokered = True


def download_through(files):
    async def download(self, url, team_id="", *, html_label="file bytes"):
        import httpx
        from urllib.parse import urljoin, urlparse
        token = self._resolve_download_token(url, team_id)
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=False) as client:
            for _ in range(4):
                parsed = urlparse(url)
                if parsed.scheme != "https" or (parsed.hostname or "").lower() != "files.slack.com":
                    raise ValueError("Blocked a file URL that isn't on files.slack.com")
                response = await client.get(files + parsed.path + ("?" + parsed.query if parsed.query else ""), headers={"Authorization": "Bearer " + token})
                if response.status_code in (301, 302, 303, 307, 308) and response.headers.get("location"):
                    url = urljoin(url, response.headers["location"])
                    continue
                response.raise_for_status()
                if response.headers.get("content-type", "").startswith("text/html"):
                    raise ValueError("Slack sent a sign-in page instead of the " + html_label)
                return response.content
        raise ValueError("Slack redirected the " + html_label + " too many times")
    return download


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


def post_message(args, **_):
    message = str(args.get("message") or "").strip()
    if not message:
        return json.dumps({"error": "Send the message to post."})
    body = {"channel": str(args.get("channel") or "")}
    if args.get("chat"):
        body["chat"] = str(args["chat"])
    try:
        found = gateway("/messages/target", body)
    except urllib.error.HTTPError as err:
        return json.dumps({"error": json.load(err).get("error", {}).get("message", "OpenHut refused that channel.")})
    from tools.send_message_tool import send_message_tool
    return send_message_tool({"action": "send", "target": found["target"], "message": message})


def invited(event=None, **_):
    source = getattr(event, "source", None)
    platform = getattr(source, "platform", None)
    if str(getattr(platform, "value", platform) or "") != "telegram":
        return None
    match = INVITE.match(str(getattr(event, "text", "") or "").strip())
    if not match or not getattr(source, "user_id", None):
        return None
    try:
        gateway("/telegram/joins", {"code": match.group(1), "userId": str(source.user_id), "name": source.user_name or "there", "chatId": int(source.chat_id)})
    except Exception:
        pass
    return {"action": "skip", "reason": "openhut invite"}


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
