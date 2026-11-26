import os
import sys


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
