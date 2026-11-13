// End-to-end test. Runs inside the test server as root (it plays the people, the channel and the attacker) and writes its
// results to $RESULTS. Usage: node packages/e2e/src/e2e.ts main | after-upgrade | after-restart   (packages/e2e/e2e.sh runs all three)
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from "node:fs";
import { connect } from "node:net";
import { createSocket } from "node:dgram";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const sh = promisify(execFile);
const APP = "http://127.0.0.1:8787";
const EV = process.env.RESULTS ?? "/results";
const PINNED = "sha256:276d44685c65c0cb2a25f190b63c65c8906f9dc76486fb1c05ae71b5826bda08";
mkdirSync(EV, { recursive: true });
const phase = process.argv[2] ?? "main";
const results: { id: string; check: string; expected: string; actual: string; pass: boolean }[] = [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const docker = async (...a: string[]) => (await sh("docker", a, { maxBuffer: 32 << 20 })).stdout.trim();
const shell = async (cmd: string) => (await sh("sh", ["-c", cmd], { maxBuffer: 32 << 20 })).stdout.trim();
const read = (p: string) => readFileSync(p, "utf8");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const count = (xs: string[]) => xs.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {} as Record<string, number>);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function check(id: string, what: string, expected: string, actual: unknown, pass: boolean) {
  const a = typeof actual === "string" ? actual : JSON.stringify(actual);
  results.push({ id, check: what, expected, actual: a.slice(0, 600), pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${what}\n     expected: ${expected}\n     actual:   ${a.slice(0, 400)}`);
}
async function until(fn: () => Promise<boolean>, seconds: number) {
  for (let i = 0; i < seconds; i += 3) { if (await fn().catch(() => false)) return true; await sleep(3000); }
  return false;
}
const firewall = async () => ({ agent: await shell("iptables -S AGENT"), agentIn: await shell("iptables -S AGENT-IN"),
  jumps: await shell("iptables -S DOCKER-USER | grep AGENT; iptables -S INPUT | grep AGENT-IN"), ipRule: await shell("ip rule | grep 10.200") });
const pidOf = (pattern: string) => shell(`pgrep -f '${pattern}' | tr '\\n' ' '`);
const reconcileCount = (id: string) => read("/var/log/jakebox/app.log").split(`reconcile: started ${id}`).length - 1;
const redact = (s: string) => s.replace(/(Agent |api_key: "|API_SERVER_KEY=)[^\s"]+/g, "$1<redacted>");

// ---------- people side: the dashboard's JSON API with a session cookie, then the control MCP signed in with OAuth ----------
type Reply = { status: number; json: any; cookie: string; setCookie: string };
async function api(method: string, path: string, body?: unknown, cookie = ""): Promise<Reply> {
  const r = await fetch(APP + path, { method, headers: { ...(body !== undefined && { "content-type": "application/json" }), ...(cookie && { cookie }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  const setCookie = r.headers.get("set-cookie") ?? "";
  return { status: r.status, json, cookie: setCookie.split(";")[0], setCookie };
}
// What an MCP client does: register itself, have the signed-in person approve it, trade the code (PKCE) for tokens.
async function oauthSignIn(cookie: string, client = "e2e") {
  const redirect = "http://127.0.0.1:33417/callback", verifier = randomBytes(32).toString("base64url");
  const reg = await api("POST", "/api/oauth/clients", { client_name: client, redirect_uris: [redirect] });
  const ok = await api("POST", "/api/oauth/codes", { clientId: reg.json.client_id, redirectUri: redirect, codeChallenge: createHash("sha256").update(verifier).digest("base64url"), codeChallengeMethod: "S256", allow: true }, cookie);
  const code = new URL(ok.json.redirect).searchParams.get("code") ?? "";
  const t: any = await fetch(APP + "/api/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: reg.json.client_id, redirect_uri: redirect }) }).then(r => r.json());
  return { access: String(t.access_token ?? ""), refresh: String(t.refresh_token ?? ""), clientId: String(reg.json.client_id) };
}
// Later phases come back with the refresh token (access tokens last an hour; refresh tokens rotate).
async function refreshed(st: { oauth: { refresh: string; clientId: string } }) {
  const t: any = await fetch(APP + "/api/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: st.oauth.refresh, client_id: st.oauth.clientId }) }).then(r => r.json());
  st.oauth.refresh = t.refresh_token;
  writeFileSync(`${EV}/state.json`, JSON.stringify(st));
  return String(t.access_token ?? "");
}
async function mcp(token: string) {
  const c = new Client({ name: "e2e", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(APP + "/mcp"), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return async (name: string, args: Record<string, unknown> = {}) => {
    const r: any = await c.callTool({ name, arguments: args });
    const t = r.content?.[0]?.text ?? "";
    if (r.isError) throw new Error(t);
    return JSON.parse(t);
  };
}
const health = async (): Promise<Record<string, any>> => { const r = await fetch(APP + "/health"); return { status: r.status, ...(await r.json() as Record<string, any>) }; };
// agentd's own answer, over its socket (the test runs as root on the server).
const agentdAsk = (cmd: string, args: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
  const s = connect("/run/agentd/agentd.sock"); let buf = "";
  s.on("data", d => (buf += d)).on("end", () => resolve(JSON.parse(buf))).on("error", reject);
  s.end(JSON.stringify({ cmd, ...args }) + "\n");
});

// ---------- channel side: Hermes's API server inside the agent's network ----------
type Agent = { id: string; net: number };
const channelKey = (id: string) => read(`/data/agent-conf/${id}/.env`).match(/API_SERVER_KEY=(\S+)/)![1];
const agentToken = (id: string) => read(`/data/agent-conf/${id}/config.yaml`).match(/Agent ([\w.]+)/)![1];
const waitReady = (a: Agent, seconds = 240) => until(async () =>
  (await fetch(`http://10.200.${a.net}.2:8642/v1/models`, { headers: { authorization: `Bearer ${channelKey(a.id)}` }, signal: AbortSignal.timeout(3000) })).ok, seconds);
async function chat(a: Agent, text: string) {
  const r = await fetch(`http://10.200.${a.net}.2:8642/v1/chat/completions`, { method: "POST", signal: AbortSignal.timeout(180_000),
    headers: { authorization: `Bearer ${channelKey(a.id)}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "hermes-agent", messages: [{ role: "user", content: text }] }) });
  const j: any = await r.json().catch(() => ({}));
  return String(j.choices?.[0]?.message?.content ?? JSON.stringify(j)).trim();
}
// The test model echoes a tool result as "TOOL RESULT: <untrusted_tool_result …>preamble\n\n{"result"|"error": "<gateway text>"}</…>".
// inner() returns the gateway's own text, so checks match exactly what the gateway said.
function inner(reply: string) {
  const m = reply.match(/\n\n(\{[\s\S]*?\})\s*(?:<\/untrusted_tool_result>|$)/);
  if (!m) return reply;
  try { const j = JSON.parse(m[1]); return String(j.result ?? j.error ?? m[1]); } catch { return m[1]; }
}
const rowsOf = (t: string) => { try { return JSON.parse(t).rows; } catch { return undefined; } };

// ---------- attacker side: code run inside an agent container as the agent's own user ----------
const pyPath = async (id: string) => (await docker("exec", `ag-${id}`, "sh", "-c", "command -v python3 || ls /opt/hermes/.venv/bin/python")).split("\n")[0];
const asAgent = async (a: Agent, code: string, env: Record<string, string> = {}) =>
  docker("exec", "-u", "10000:10000", ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]), `ag-${a.id}`, await pyPath(a.id), "-c", code);
// A raw MCP request to the gateway from inside an agent's network, with a given token.
const GW = `import urllib.request, json, os
req = urllib.request.Request(os.environ["URL"], data=os.environ["BODY"].encode(), headers={"authorization": "Agent " + os.environ["TOKEN"], "content-type": "application/json", "accept": "application/json, text/event-stream"})
try:
    r = urllib.request.urlopen(req, timeout=60); print(json.dumps({"status": r.status, "body": r.read().decode()}))
except urllib.error.HTTPError as e:
    print(json.dumps({"status": e.code, "body": e.read().decode()}))`;
async function gwRaw(from: Agent, token: string, body: object) {
  return JSON.parse(await asAgent(from, GW, { URL: `http://10.200.${from.net}.1:8081/api/v1/mcp`, TOKEN: token, BODY: JSON.stringify(body) })) as { status: number; body: string };
}
async function callTool(a: Agent, args: Record<string, unknown>) {
  const t0 = Date.now();
  const r = await gwRaw(a, agentToken(a.id), { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "call_tool", arguments: { reason: "e2e connector check", ...args } } });
  const res = JSON.parse(r.body).result;
  return { text: String(res?.content?.[0]?.text ?? r.body), isError: !!res?.isError, ms: Date.now() - t0 };
}
const PROBE = `
import socket, json, os, subprocess
def tcp(h, p):
    try:
        socket.create_connection((h, p), timeout=4).close(); return "open"
    except socket.timeout: return "timeout"
    except Exception as e: return type(e).__name__
def can_write(p):
    try:
        open(p, "a").close(); return True
    except Exception: return False
paths = {"root": "/usr/jb_probe", "config": "/opt/data/config.yaml", "env": "/opt/data/.env", "soul": "/opt/data/SOUL.md", "skills": "/opt/data/skills/x.md",
         "hooks": "/opt/data/hooks/x.py", "plugins": "/opt/data/plugins/x.py", "pairing": "/opt/data/platforms/pairing/slack-approved.json",
         "legacy_pairing": "/opt/data/pairing/slack-approved.json", "claude_settings": "/opt/data/.claude/settings.json", "claude_cli": "/usr/local/bin/claude"}
def can_rename(p):
    try:
        os.rename(p, p + ".moved"); os.rename(p + ".moved", p); return True
    except Exception: return False
def udp_dns(server):
    q = bytes.fromhex("123401000001000000000000076578616d706c6503636f6d0000010001")
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(3)
    try:
        s.sendto(q, (server, 53)); s.recvfrom(512); return "answered"
    except socket.timeout: return "timeout"
    except Exception as e: return type(e).__name__
renames = ["/opt/data/platforms", "/opt/data/.claude", "/opt/data/platforms/pairing", "/opt/data/.claude/settings.json", "/opt/data/config.yaml",
           "/opt/data/.env", "/opt/data/SOUL.md", "/opt/data/skills", "/opt/data/hooks", "/opt/data/plugins", "/opt/data/pairing"]
o = {"uid": os.getuid(), "kernel": open("/proc/version").read().strip()[:80],
     "writable": {k: can_write(p) for k, p in paths.items()}, "renamable": {p: can_rename(p) for p in renames},
     "udp_dns": {"other_resolver": udp_dns("8.8.8.8"), "own_resolver": udp_dns(open("/etc/resolv.conf").read().split()[1])},
     "capeff": [l.split()[1] for l in open("/proc/self/status") if l.startswith("CapEff")][0],
     "docker_sock": os.path.exists("/var/run/docker.sock"), "agentd_sock": os.path.exists("/run/agentd"),
     "own_env_has_key": "API_SERVER_KEY" in open("/opt/data/.env").read()}
try: socket.getaddrinfo("example.com", 443); o["dns"] = "ok"
except Exception as e: o["dns"] = type(e).__name__
o["net"] = {k: tcp(h, p) for k, (h, p) in json.loads(os.environ["TARGETS"]).items()}
print(json.dumps(o))`;
const probe = async (a: Agent, targets: Record<string, [string, number]>) => JSON.parse(await asAgent(a, PROBE, { TARGETS: JSON.stringify(targets) }));
const hostTcp = (h: string, p: number) => new Promise<string>(res => {
  const s = connect({ host: h, port: p, timeout: 4000 });
  s.on("connect", () => { s.destroy(); res("open"); }); s.on("timeout", () => { s.destroy(); res("timeout"); }); s.on("error", (e: any) => res(e.code ?? "error"));
});
const hostUdpDns = (h: string) => new Promise<string>(res => {
  const s = createSocket("udp4"), t = setTimeout(() => { s.close(); res("timeout"); }, 3000);
  s.on("message", () => { clearTimeout(t); s.close(); res("answered"); });
  s.send(Buffer.from("123401000001000000000000076578616d706c6503636f6d0000010001", "hex"), 53, h);
});
// What an agent may reach (open) and must not (blocked). Every blocked target is checked from the server too, where it
// must be open, so "blocked" can only come from the agent firewall. The LAN and metadata listeners run outside this server.
function targetsFor(a: Agent, other?: Agent) {
  const t: Record<string, { at: [string, number]; agent: "open" | "blocked" }> = {
    gateway: { at: [`10.200.${a.net}.1`, 8081], agent: "open" },
    internet_443: { at: ["1.1.1.1", 443], agent: "open" }, internet_by_name: { at: ["example.com", 443], agent: "open" },
    imap_993: { at: ["imap.gmail.com", 993], agent: "blocked" }, smtp_465: { at: ["smtp.gmail.com", 465], agent: "blocked" }, smtp_587: { at: ["smtp.gmail.com", 587], agent: "blocked" },
    dashboard: { at: [`10.200.${a.net}.1`, 8787], agent: "blocked" }, team_db: { at: ["172.30.0.10", 5432], agent: "blocked" },
    lan_10: { at: ["10.99.0.10", 80], agent: "blocked" }, lan_172: { at: ["172.29.0.10", 80], agent: "blocked" }, lan_192: { at: ["192.168.77.10", 80], agent: "blocked" },
    cloud_metadata: { at: ["169.254.169.254", 80], agent: "blocked" }, internet_80: { at: ["1.1.1.1", 80], agent: "blocked" }, dns_other_resolver: { at: ["8.8.8.8", 53], agent: "blocked" },
  };
  if (other) t.other_agent = { at: [`10.200.${other.net}.2`, 8642], agent: "blocked" };
  return t;
}
async function isolation(a: Agent, other?: Agent) {
  const t = targetsFor(a, other);
  const p = await probe(a, Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.at])));
  const host: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) if (v.agent === "blocked") host[k] = await hostTcp(...v.at);
  const rows = Object.entries(t).map(([k, v]) => ({ target: `${k} ${v.at.join(":")}`, agent: p.net[k], from_server: host[k] ?? "-",
    ok: v.agent === "open" ? p.net[k] === "open" : p.net[k] !== "open" && host[k] === "open" }));
  // Plain DNS (UDP) goes only to the configured resolver.
  const udpHost = await hostUdpDns("8.8.8.8");
  rows.push({ target: "dns_udp 8.8.8.8:53/udp", agent: p.udp_dns.other_resolver, from_server: udpHost, ok: p.udp_dns.other_resolver !== "answered" && udpHost === "answered" },
    { target: "dns_udp own resolver:53/udp", agent: p.udp_dns.own_resolver, from_server: "-", ok: p.udp_dns.own_resolver === "answered" });
  return { p, rows, pass: rows.every(r => r.ok) && p.dns === "ok" };
}

// ---------- main ----------
async function main() {
  const env = read("/etc/jakebox/env");
  const SETUP = env.match(/SETUP_CODE=(\S+)/)?.[1] ?? "";

  // I. The install
  const tamper = read(`${EV}/tamper.log`).replace(/\x1b\[[0-9;]*m/g, "");
  check("I0", "The installer refuses a tampered download", "a jakebox.tgz with one byte changed: \"checksum mismatch\", exit 1, nothing installed",
    tamper.trim().split("\n").filter(l => /mismatch|exit=|jakebox/.test(l)),
    /checksum mismatch: \S*jakebox\.tgz/.test(tamper) && /installer exit=1/.test(tamper) && /opt\/jakebox: No such file/.test(tamper));
  const log = read(`${EV}/install.log`).replace(/\x1b\[[0-9;]*m/g, "");
  const okLog = ["==> Packages", "==> gVisor", "==> JakeBox", "==> Claude Code", "JakeBox is running"].every(s => log.includes(s)) && !/checksum mismatch|unknown extended header/i.test(log);
  check("I1", "One curl command installs JakeBox on a bare server; every download matches its pinned checksum", "all steps, \"JakeBox is running\", no checksum or tar warnings",
    log.trim().split("\n").filter(l => l.startsWith("==>") || /JakeBox is running|mismatch|extended header/.test(l)), okLog);
  const loose = await shell("find /opt/jakebox ! -type l \\( ! -user root -o ! -group root -o -perm -0020 -o -perm -0002 \\) -print | head -5");
  check("I2", "Code that root runs is owned by root and writable by nobody else", "no file or folder under /opt/jakebox (symlinks aside) owned by another user or group-/world-writable", loose || "none", loose === "");
  const perms = await shell("stat -c '%a %U %n' /data/app /data/app/pglite /etc/jakebox/env /data/agents /data/agent-conf");
  check("I3", "The database (holds auth_secret) and settings are private", "/data/app 700 jakebox, its Postgres folder 700, env 600 root, agent folders 700",
    perms, same(perms.split("\n").map(l => l.split(" ").slice(0, 2).join(" ")), ["700 jakebox", "700 jakebox", "600 root", "700 root", "700 root"]));

  // A. Setup and sign-in
  const open = (await api("GET", "/api/setup")).json.open;
  const wrongCode = await api("POST", "/api/people", { setupCode: "0".repeat(18), username: "mallory", password: "mallory-password-1" });
  const stillOpen = (await api("GET", "/api/setup")).json.open;
  check("A1", "Setup needs the code the installer printed", "open before; a wrong code: 403 on setupCode; still open, no owner",
    `open ${open} | wrong code ${wrongCode.status} ${wrongCode.json?.error?.param} | open after ${stillOpen}`, open === true && wrongCode.status === 403 && wrongCode.json?.error?.param === "setupCode" && stillOpen === true);
  const creds = { username: "owner", password: randomBytes(12).toString("base64url") };
  writeFileSync(`${EV}/.test-credentials.json`, JSON.stringify(creds)); // generated test values for the screenshots; gitignored
  // The installer prints /setup?code=…; the page sends that code, so the owner only picks a username and password.
  const printed = read(`${EV}/install.log`).includes("/setup?code=");
  const setup = await api("POST", "/api/people", { setupCode: SETUP, ...creds });
  const cookie = setup.cookie, flags = setup.setCookie;
  check("A2", "The installer's link signs up the owner in one step", "the install prints the /setup?code= link; posting the code with a username and password makes the owner and a session cookie, HttpOnly and SameSite=Strict",
    `link printed ${printed} | ${setup.status} ${setup.json?.user?.role} ${flags.replace(/=[^;]+/, "=<redacted>")}`,
    printed && setup.status === 200 && setup.json?.user?.role === "owner" && /HttpOnly/.test(flags) && /SameSite=Strict/.test(flags));
  const again = await api("POST", "/api/people", { setupCode: SETUP, username: "second", password: "second-password-1" });
  const bad = await api("POST", "/api/sessions", { username: "owner", password: "wrong-password-123" });
  const nobody = await api("POST", "/api/sessions", { username: "nobody", password: "wrong-password-123" });
  const good = await api("POST", "/api/sessions", creds);
  const timed = async (username: string) => { const t = Date.now(); await api("POST", "/api/sessions", { username, password: "wrong-password-123" }); return Date.now() - t; };
  const ms = { wrong: [] as number[], unknown: [] as number[] };
  for (let i = 0; i < 5; i++) { ms.wrong.push(await timed("owner")); ms.unknown.push(await timed(`nobody${i}`)); }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length, ratio = avg(ms.unknown) / avg(ms.wrong);
  check("A3", "Setup closes after the owner exists; sign-in checks the password, taking as long for unknown names", "setup again: 403 and closed; wrong password 401; unknown user 401; right password 200 with a session; unknown/wrong time 0.5-2×",
    `setup ${again.status} open ${(await api("GET", "/api/setup")).json.open} | wrong ${bad.status} | unknown ${nobody.status} | right ${good.status} | ms wrong ${ms.wrong} unknown ${ms.unknown} ratio ${ratio.toFixed(2)}`,
    again.status === 403 && bad.status === 401 && nobody.status === 401 && good.status === 200 && !!good.cookie && ratio > 0.5 && ratio < 2);
  const noauth = await fetch(APP + "/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const withCookie = await fetch(APP + "/mcp", { method: "POST", headers: { "content-type": "application/json", cookie }, body: "{}" });
  const madeUp = await fetch(APP + "/mcp", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer jbo_${randomBytes(24).toString("base64url")}` }, body: "{}" });
  const oauth = await oauthSignIn(cookie);
  check("A4", "Control MCP takes only OAuth access tokens, and points clients at its sign-in", "no token: 401 with resource_metadata; a session cookie alone: 401; a made-up token: 401; signing in with OAuth gives a jbo_ token",
    `no token ${noauth.status} ${noauth.headers.get("www-authenticate")?.slice(0, 80)}; cookie ${withCookie.status}; made-up ${madeUp.status}; signed in ${oauth.access ? "jbo_<redacted>" : "no"}`,
    noauth.status === 401 && /resource_metadata=/.test(noauth.headers.get("www-authenticate") ?? "") && withCookie.status === 401 && madeUp.status === 401 && /^jbo_/.test(oauth.access));
  const call = await mcp(oauth.access);
  const people = await call("list_people");
  check("A5", "Only one owner exists", "list_people: [owner]", people.map((p: any) => `${p.username}:${p.role}`), same(people.map((p: any) => `${p.username}:${p.role}`), ["owner:owner"]));

  // A team database the agents must never reach directly. The agents' role CAN write, so only the gateway stops writes.
  await docker("network", "create", "--subnet", "172.30.0.0/24", "teamdb");
  const dbpw = randomBytes(12).toString("hex"), agentPw = randomBytes(12).toString("hex");
  // TLS with a test CA and a certificate for teamdb.test; wrong.test is the same address under a name the certificate lacks.
  // Kept under /root: the server's /tmp is emptied when it restarts, and the team DB must come back after the restart.
  await shell(`rm -rf /root/pgcerts && mkdir /root/pgcerts && cd /root/pgcerts &&
    openssl req -x509 -newkey rsa:2048 -nodes -days 2 -subj /CN=e2e-ca -keyout ca.key -out ca.crt 2>/dev/null &&
    openssl req -newkey rsa:2048 -nodes -subj /CN=teamdb.test -keyout server.key -out server.csr 2>/dev/null &&
    printf 'subjectAltName=DNS:teamdb.test\\n' > ext && openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 2 -extfile ext -out server.crt 2>/dev/null &&
    chown 70:70 server.key server.crt && chmod 600 server.key && grep -q teamdb.test /etc/hosts || echo '172.30.0.10 teamdb.test wrong.test' >> /etc/hosts`);
  await docker("run", "-d", "--name", "teamdb", "--restart", "unless-stopped", "--network", "teamdb", "--ip", "172.30.0.10", "-e", `POSTGRES_PASSWORD=${dbpw}`,
    "-v", "/root/pgcerts:/certs:ro", "postgres:16-alpine", "-c", "ssl=on", "-c", "ssl_cert_file=/certs/server.crt", "-c", "ssl_key_file=/certs/server.key");
  await until(async () => { await docker("exec", "teamdb", "pg_isready", "-U", "postgres"); return true; }, 60);
  await sleep(1500);
  const psql = (sql: string, user = "postgres") => docker("exec", "teamdb", "psql", "-U", user, "-d", "postgres", "-tAc", sql);
  await psql(`create table orders(id serial primary key, customer text, total numeric(10,2)); insert into orders(customer,total) select 'c'||g, g*10 from generate_series(1,42) g;
    create role jakebox_agent login password '${agentPw}'; grant select, insert, update, delete on orders to jakebox_agent; grant usage, select, update on sequence orders_id_seq to jakebox_agent;
    create role jakebox_files login password '${agentPw}'; grant pg_read_server_files to jakebox_files;
    create role jakebox_member login noinherit password '${agentPw}'; grant postgres to jakebox_member;`);
  const rows = async () => (await psql("select count(*) from orders")).trim();

  // B. Everything through the control MCP
  const conn = await call("create_connection", { name: "Orders DB", dsn: `postgres://jakebox_agent:${agentPw}@172.30.0.10:5432/postgres` });
  const dev = await call("create_agent", { name: "Dev", instructions: "# Dev\nYou answer engineers. Use the Orders DB when asked for data." });
  const sales = await call("create_agent", { name: "Sales", instructions: "# Sales\nYou answer customers. You have no database access." });
  const devGrant = await call("create_grant", { agentId: dev.id, connectionId: conn.id });
  const grants = (await call("list_grants", { agentId: dev.id })).map((g: any) => g.connectionId), salesGrants = await call("list_grants", { agentId: sales.id });
  check("B1", "Control MCP creates a connection, two agents and a grant", "Dev granted Orders DB, Sales has none", { dev: grants, sales: salesGrants }, same(grants, [conn.id]) && salesGrants.length === 0);
  await call("update_agent", { id: dev.id, wanted: "running" });
  await call("update_agent", { id: sales.id, wanted: "running" });
  const listed = await call("list_agents");
  check("B2", "Both agents run, one container each", "2 agents, status running", listed.map((a: any) => `${a.name}:${a.status}`), listed.length === 2 && listed.every((a: any) => a.status === "running"));
  const outputs = { list_connections: await call("list_connections"), get_agent: await call("get_agent", { id: dev.id }), list_agents: listed, created: conn,
    connection_api: (await api("GET", `/api/connections/${conn.id}`, undefined, cookie)).json, agent_api: (await api("GET", `/api/agents/${dev.id}`, undefined, cookie)).json };
  const files = await shell(`grep -rlF -e '${agentPw}' -e '${dbpw}' /data/agent-conf/${dev.id} /data/agents/${dev.id} /var/log/jakebox 2>/dev/null || true`);
  const leaks = Object.entries(outputs).filter(([, v]) => JSON.stringify(v).includes(agentPw)).map(([k]) => k);
  check("B3", "The gateway keeps the DB password: it never comes back out", "not in any control MCP reply, dashboard page, agent file or log", { leaks, files: files || "none" }, !leaks.length && !files);

  // C. The container spec actually applied
  const ins = JSON.parse(await docker("inspect", `ag-${dev.id}`))[0], hc = ins.HostConfig;
  const mounts = ins.Mounts.map((m: any) => `${m.Source} -> ${m.Destination}${m.RW ? "" : " (ro)"}`).sort();
  const spec = { image: ins.Config.Labels["agent.digest"], runtime: hc.Runtime, user: ins.Config.User, readOnly: hc.ReadonlyRootfs, privileged: hc.Privileged, capDrop: hc.CapDrop, capAdd: hc.CapAdd,
    securityOpt: hc.SecurityOpt, pids: hc.PidsLimit, memory: hc.Memory, nanoCpus: hc.NanoCpus, restart: hc.RestartPolicy?.Name, networks: Object.keys(ins.NetworkSettings.Networks),
    ip: Object.values<any>(ins.NetworkSettings.Networks)[0]?.IPAddress, tmpfs: Object.keys(hc.Tmpfs ?? {}).sort(), mounts };
  writeFileSync(`${EV}/dev-container-spec.json`, JSON.stringify(spec, null, 2));
  check("C1", "Agent container: pinned image, gVisor, uid 10000, read-only root, no caps, limits, one network, no restart policy",
    `${PINNED.slice(0, 19)}…, runsc, 10000:10000, ro, unprivileged, ALL dropped, none added, no-new-privileges, pids 512, 1 GiB, 1 CPU, only ag-<id> at .2, restart no`,
    { ...spec, mounts: undefined, tmpfs: undefined },
    String(spec.image).endsWith(PINNED) && spec.runtime === "runsc" && spec.user === "10000:10000" && spec.readOnly && !spec.privileged && same(spec.capDrop, ["ALL"]) && !spec.capAdd?.length &&
    spec.securityOpt?.includes("no-new-privileges") && spec.pids === 512 && spec.memory === 1 << 30 && spec.nanoCpus === 1e9 && same(spec.networks, [`ag-${dev.id}`]) && spec.ip === `10.200.${dev.net}.2` && spec.restart === "no");
  const c = `/data/agent-conf/${dev.id}`;
  const wantMounts = [`${c}/.env -> /opt/data/.env (ro)`, `${c}/SOUL.md -> /opt/data/SOUL.md (ro)`, `${c}/claude-settings.json -> /opt/data/.claude/settings.json (ro)`, `${c}/config.yaml -> /opt/data/config.yaml (ro)`,
    `${c}/skills -> /opt/data/skills (ro)`, `/data/agents/${dev.id} -> /opt/data`, `/data/agents/${dev.id}/.claude -> /opt/data/.claude`,
    `/data/agents/${dev.id}/platforms -> /opt/data/platforms`, "/etc/agentd/resolv.conf -> /etc/resolv.conf (ro)", "/opt/jakebox/bin/claude -> /usr/local/bin/claude (ro)",
    "/opt/jakebox/vendor/hermes-plugins -> /opt/data/plugins (ro)", "/var/lib/jakebox/whatsapp-bridge -> /opt/data/scripts/whatsapp-bridge (ro)"].sort();
  const wantTmpfs = ["/opt/data/hooks", "/opt/data/pairing", "/opt/data/platforms/pairing", "/tmp"];
  check("C2", "Exactly these mounts: its own folder, its rendered files read-only, the resolver, the Claude CLI, plugin and WhatsApp bridge read-only", "the 12 bind mounts and 4 tmpfs listed in dev-container-spec.json, nothing else",
    { mounts, tmpfs: spec.tmpfs }, same(mounts, wantMounts) && same(spec.tmpfs, wantTmpfs));
  writeFileSync(`${EV}/dev-config.yaml`, redact(read(`${c}/config.yaml`)));

  // D. Agents answer over their channel; the gateway decides what they reach
  const expected: Record<string, Record<string, number>> = { [dev.id]: {}, [sales.id]: {} };
  const audit = (a: Agent, outcome: string) => { expected[a.id] ??= {}; expected[a.id][outcome] = (expected[a.id][outcome] ?? 0) + 1; };
  const t0 = Date.now(), ready = (await Promise.all([waitReady(dev), waitReady(sales)])).every(Boolean), firstBoot = Date.now() - t0;
  check("D1", "Both agents' Hermes gateways come up under gVisor", "API server answers within 4 min", `${ready} in ${Math.round(firstBoot / 1000)} s`, ready);
  const echo = await chat(dev, "hello there");
  check("D2", "A message reaches the agent and its reply comes back", "\"ECHO: hello there\"", echo, echo === "ECHO: hello there");
  const d3 = inner(await chat(dev, "sql: select count(*)::int as n, sum(total)::text as revenue from orders")); audit(dev, "allowed");
  check("D3", "Dev (granted) queries the team DB through the gateway", "rows [{n: 42, revenue: 9030.00}]", d3, rowsOf(d3)?.[0]?.n === 42 && rowsOf(d3)?.[0]?.revenue === "9030.00");
  const d4 = inner(await chat(sales, "sql: select count(*) from orders")); audit(sales, "denied");
  check("D4", "Sales (no grant) is refused by the gateway", "\"Denied: no connection grants postgres_query to this agent.\"", d4, d4 === "Denied: no connection grants postgres_query to this agent.");
  const control = await docker("exec", "teamdb", "psql", "-U", "jakebox_agent", "-d", "postgres", "-c", "begin", "-c", "delete from orders", "-c", "rollback").catch(e => String(e.stderr ?? e));
  // Straight to the gateway from Dev's network (the door Hermes uses): Hermes pauses a server for 59 s after three refused calls.
  const del = (await callTool(dev, { name: "postgres_query", arguments: { sql: "delete from orders" } })).text; audit(dev, "failed");
  const seq = (await callTool(dev, { name: "postgres_query", arguments: { sql: "select nextval('orders_id_seq')" } })).text; audit(dev, "failed");
  const multi = (await callTool(dev, { name: "postgres_query", arguments: { sql: "select 1; commit; delete from orders" } })).text; audit(dev, "failed");
  const after = await rows(), lastId = (await psql("select last_value from orders_id_seq")).trim();
  check("D5", "A granted agent can't write, even with a role that can (one read-only SELECT per call)",
    "role alone can delete (control); via the gateway: delete, nextval() and a stacked \"commit; delete\" all fail; still 42 rows, sequence at 42",
    { control: control.replace(/\s+/g, " "), delete: del, nextval: seq, stacked: multi, rows: after, sequence: lastId },
    /DELETE 42/.test(control) && del.startsWith("Failed:") && /read-only transaction/.test(seq) && /cannot insert multiple commands/.test(multi) && after === "42" && lastId === "42");

  // E. Live revoke, no restart
  await call("delete_grant", { id: devGrant.id });
  const e1 = inner(await chat(dev, "sql: select 1 as one")); audit(dev, "denied");
  const lastRow = (await call("agent_activity", { id: dev.id }))[0];
  check("E1", "Revoking the grant takes effect on the next call, no restart", "\"Denied: …\" and a new denied audit row", { reply: e1, audit: `${lastRow?.tool} ${lastRow?.outcome}` },
    e1 === "Denied: no connection grants postgres_query to this agent." && lastRow?.outcome === "denied" && lastRow?.tool === "postgres_query");
  await call("create_grant", { agentId: dev.id, connectionId: conn.id });
  const e2 = inner(await chat(dev, "sql: select 7 as seven")); audit(dev, "allowed");
  check("E2", "Granting again works immediately", "rows [{seven: 7}]", e2, rowsOf(e2)?.[0]?.seven === 7);
  // Activity is per connection; a call no connection allowed stays in its agent's activity (D6 counts them all).
  const connEvents = (await api("GET", `/api/connection-events?connectionId=${conn.id}`, undefined, cookie)).json.data ?? [];
  const salesDenied = (await call("agent_activity", { id: sales.id })).filter((e: any) => e.outcome === "denied").length;
  check("E3", "A connection's Activity lists the calls through it; a denied call with no connection stays in its agent's activity",
    "connection events: Dev's calls only, newest first, with agent names; Sales' denial in agent_activity",
    { events: connEvents.length, agents: [...new Set(connEvents.map((e: any) => e.agentName))], salesDenied },
    connEvents.length >= 3 && connEvents.every((e: any) => e.agentId === dev.id && e.agentName === "Dev") && salesDenied >= 1);

  // K. The connector's limits, called straight from Dev's network with Dev's token (the same door Hermes uses)
  const q = async (sql: string, connectionId?: string) => callTool(dev, { name: "postgres_query", arguments: { sql }, ...(connectionId ? { connectionId } : {}) });
  const k1 = await q("select pg_sleep(20)"); audit(dev, "failed");
  const off = await q("select set_config('statement_timeout', '0', false) as was"); audit(dev, "allowed"); // tries to lift the limit for later calls
  const k2 = await q("select pg_sleep(20)"); audit(dev, "failed");
  check("K1", "A query is cancelled after 15 s, and a call can't lift that for the next one", "pg_sleep(20) fails with \"statement timeout\" in 14-19 s, before and after a call sets statement_timeout to 0",
    [`${k1.ms} ms ${k1.text}`, `set: ${off.text}`, `${k2.ms} ms ${k2.text}`], !off.isError && [k1, k2].every(k => k.isError && /statement timeout/.test(k.text) && k.ms > 14_000 && k.ms < 19_000));
  const k3 = await q("select g from generate_series(1, 2000) g"); audit(dev, "allowed");
  const k3j = JSON.parse(k3.text.startsWith("{") ? k3.text : "{}");
  check("K2", "At most 1000 rows come back", "1000 rows, truncated: true", { rows: k3j.rows?.length, truncated: k3j.truncated }, k3j.rows?.length === 1000 && k3j.truncated === true);
  const k4 = await q("with d as (delete from orders returning 1) select * from d"); audit(dev, "failed");
  check("K3", "A data-modifying CTE is refused", "fails; still 42 rows", `${k4.text} | rows=${await rows()}`, k4.isError && (await rows()) === "42");
  const extra = async (name: string, dsn: string) => { const x = await call("create_connection", { name, dsn }); await call("create_grant", { agentId: dev.id, connectionId: x.id }); return x.id; };
  const superId = await extra("Superuser DB", `postgres://postgres:${dbpw}@172.30.0.10:5432/postgres`);
  const filesId = await extra("Server files DB", `postgres://jakebox_files:${agentPw}@172.30.0.10:5432/postgres`);
  const memberId = await extra("Superuser member DB", `postgres://jakebox_member:${agentPw}@172.30.0.10:5432/postgres`);
  const k5 = []; for (const id of [superId, filesId, memberId]) { k5.push((await q("select 1", id)).text); audit(dev, "failed"); }
  check("K4", "Connections that could escape read-only are refused: a superuser, a pg_read_server_files role, a member of a superuser role", "3 × \"Refused: …\"",
    k5, k5.every(t => /^Failed: Refused: this connection logs in as a superuser/.test(t)));
  const guarded = [];
  for (const host of ["127.0.0.1", "[::ffff:127.0.0.1]", "169.254.169.254", `10.200.${dev.net}.1`, "0.0.0.0", "[::1]", "localhost"])
    guarded.push(await extra(`Guard ${host}`, `postgres://u:p@${host}:5432/x`));
  const k6 = []; for (const id of guarded) { k6.push((await q("select 1", id)).text); audit(dev, "failed"); }
  check("K5", "The gateway won't connect to loopback, this host, link-local or agent addresses, by IP (IPv4-mapped too) or by name", "7 × \"Refused address …\" (127.0.0.1, ::ffff:127.0.0.1, 169.254.169.254, the gateway's own 10.200.x.1, 0.0.0.0, ::1, localhost)",
    k6, k6.length === 7 && k6.every(t => /^Failed: Refused address/.test(t)));
  const refusedDsn = [];
  for (const dsn of [`postgres://jakebox_agent:${agentPw}@172.30.0.10/postgres?host=127.0.0.1`, `postgres://u:p@172.30.0.10/x?sslrootcert=/etc/jakebox/env`])
    refusedDsn.push(await call("create_connection", { name: "Sneaky", dsn }).then(() => "accepted", e => (e as Error).message));
  check("K6", "Connection strings can't override the host or point at local files", "both refused: Unsupported connection options", refusedDsn, refusedDsn.every(m => /Unsupported connection options/.test(m)));
  const k8 = await q("select 1"); audit(dev, "failed");
  const k9 = await callTool(dev, { name: "postgres_query", arguments: { sql: "select 1", evil: 1 }, connectionId: conn.id }); audit(dev, "failed");
  check("K7", "Ambiguous and malformed calls fail cleanly", "\"More than one connection …\"; \"Unknown arguments: evil\"", [k8.text, k9.text], /^More than one connection has postgres_query/.test(k8.text) && k9.text === "Unknown arguments: evil");
  for (const id of [superId, filesId, memberId, ...guarded]) await call("delete_connection", { id });
  // Bytes and concurrency: one wide result can't exhaust the app, and one agent can't use up the DB's connections.
  const fits = await q("select g, repeat('x', 40) as pad from generate_series(1, 600) g"); audit(dev, "allowed");      // ~40 KB
  const tooBigForAgent = await q("select g, repeat('x', 1000) as pad from generate_series(1, 1000) g"); audit(dev, "failed"); // ~1 MB
  const wide = await q("select repeat('x', 1000000) as x from generate_series(1, 20)"); audit(dev, "failed");                // ~20 MB
  const fitsRows = rowsOf(fits.text)?.length, h8 = await health();
  check("K8", "Results are whole or refused, never cut: under 64 KB they arrive complete; up to 8 MB they're refused as too large for the agent; past 8 MB the read stops",
    "600 rows parse; ~1 MB: \"Result too large for the agent\"; ~20 MB: \"Result too large: over 8 MB\"; the app still answers",
    { fits: `${fitsRows} rows`, oneMB: tooBigForAgent.text.slice(0, 90), twentyMB: wide.text.slice(0, 60), health: h8.status },
    fitsRows === 600 && /^Failed: Result too large for the agent/.test(tooBigForAgent.text) && /^Failed: Result too large: over 8 MB/.test(wide.text) && h8.status === 200);
  const parallel = await Promise.all([1, 2, 3].map(() => q("select pg_sleep(4)")));
  const busy = parallel.filter(r => /^Busy:/.test(r.text)).length, done = parallel.filter(r => !r.isError).length;
  for (let i = 0; i < done; i++) audit(dev, "allowed"); for (let i = 0; i < 3 - done; i++) audit(dev, "failed");
  check("K9", "At most 2 calls per agent per connection run at once", "3 parallel 4-second queries: 2 run, 1 \"Busy\"", parallel.map(r => r.text.slice(0, 80)), done === 2 && busy === 1);
  // TLS through the deployed app (call_tool): it trusts public CAs only, so the test CA's certificate passes "require"
  // (encrypts, checks nothing) and fails "verify-full"/"verify-ca".
  const tlsIds: Record<string, string> = {};
  for (const mode of ["require", "verify-full", "verify-ca"]) tlsIds[mode] = await extra(`TLS ${mode}`, `postgres://jakebox_agent:${agentPw}@teamdb.test:5432/postgres?sslmode=${mode}`);
  const live: Record<string, string> = {};
  for (const [mode, id] of Object.entries(tlsIds)) { live[mode] = (await q("select ssl from pg_stat_ssl where pid = pg_backend_pid()", id)).text; audit(dev, mode === "require" ? "allowed" : "failed"); }
  for (const id of Object.values(tlsIds)) await call("delete_connection", { id });
  check("K10a", "TLS through the live gateway: require encrypts; verify-full and verify-ca refuse a certificate from an untrusted CA", "require: ssl true; verify-full and verify-ca: certificate errors",
    live, rowsOf(live.require)?.[0]?.ssl === true && /^Failed: .*(self-signed|unable to (get|verify))/i.test(live["verify-full"]) && /^Failed: .*(self-signed|unable to (get|verify))/i.test(live["verify-ca"]));
  // TLS name checking, with the test CA trusted (the deployed app can't trust a private CA in v1): pgQuery in a scratch process.
  const tmpTls = mkdtempSync("/tmp/jb-tls-");
  const tls = async (host: string, mode: string, trustCa: boolean) => (await sh("node", ["--input-type=module", "-e",
    `import { pgQuery } from "/opt/jakebox/packages/app/src/integrations/postgres/postgres.ts";
     try { const r = await pgQuery(process.env.DSN, "select ssl from pg_stat_ssl where pid = pg_backend_pid()"); console.log("ok " + JSON.stringify(r.rows)); }
     catch (e) { console.log("error " + e.message); }`],
    { env: { ...process.env, JAKEBOX_DATA: tmpTls, DSN: `postgres://jakebox_agent:${agentPw}@${host}:5432/postgres?sslmode=${mode}`, ...(trustCa ? { NODE_EXTRA_CA_CERTS: "/root/pgcerts/ca.crt" } : {}) } })).stdout.trim().split("\n").pop()!;
  const k10 = { fullRightName: await tls("teamdb.test", "verify-full", true), fullWrongName: await tls("wrong.test", "verify-full", true),
    caWrongName: await tls("wrong.test", "verify-ca", true), fullUntrusted: await tls("teamdb.test", "verify-full", false), caUntrusted: await tls("teamdb.test", "verify-ca", false) };
  await shell(`rm -rf ${tmpTls}`);
  check("K10b", "With a trusted CA, TLS is checked as libpq's sslmode says, by the DSN's name even though the gateway connects to the checked IP",
    "verify-full: right name ok, wrong name fails, untrusted CA fails; verify-ca: wrong name ok, untrusted CA fails", k10,
    k10.fullRightName === 'ok [{"ssl":true}]' && k10.caWrongName === 'ok [{"ssl":true}]' && /^error .*(altnames|Hostname)/i.test(k10.fullWrongName) &&
    /^error .*(self-signed|unable to (get|verify))/i.test(k10.fullUntrusted) && /^error .*(self-signed|unable to (get|verify))/i.test(k10.caUntrusted));

  // D6: one audit row per call, nothing missing, nothing extra
  const devAct = await call("agent_activity", { id: dev.id }), salesAct = await call("agent_activity", { id: sales.id });
  writeFileSync(`${EV}/activity.json`, JSON.stringify({ dev: devAct, sales: salesAct }, null, 2));
  const got = { dev: count(devAct.map((e: any) => e.outcome)), sales: count(salesAct.map((e: any) => e.outcome)) };
  const want = { dev: expected[dev.id], sales: expected[sales.id] };
  const sorted = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).sort());
  check("D6", "Every tool call leaves exactly one audit row with its outcome", JSON.stringify(want), got, same(sorted(got.dev), sorted(want.dev)) && same(sorted(got.sales), sorted(want.sales)));

  // F. Isolation from inside an agent, as the agent's own user
  const iso = await isolation(sales, dev), p = iso.p;
  writeFileSync(`${EV}/isolation-probe-sales.json`, JSON.stringify({ probe: p, matrix: iso.rows }, null, 2));
  check("F1", "Runs as uid 10000 on gVisor's kernel", "uid 10000, /proc/version says gvisor", `uid=${p.uid} ${p.kernel}`, p.uid === 10000 && /gvisor/i.test(p.kernel));
  check("F2", "Can't write, or rename away, its config, .env, SOUL.md, skills, hooks, plugins, channel approvals, Claude settings or CLI, or the root FS", "every write and every rename fails",
    { writable: p.writable, renamable: p.renamable }, Object.values(p.writable).every(w => w === false) && Object.values(p.renamable).every(w => w === false));
  check("F3", "No capabilities, no Docker socket, no agentd socket", "CapEff 0, both false", { capeff: p.capeff, docker: p.docker_sock, agentd: p.agentd_sock }, /^0+$/.test(p.capeff) && !p.docker_sock && !p.agentd_sock);
  check("F4", "Network: the gateway, DNS to its resolver and the internet on 443 only; everything else (mail ports included) is blocked though the server reaches it", "matrix in isolation-probe-sales.json all ok",
    iso.rows.map(r => `${r.target}: ${r.agent}/${r.from_server}${r.ok ? "" : " ✗"}`), iso.pass);
  check("F5", "An agent reads its own .env (accepted risk) but no other agent's files", "own key visible; C2 shows no other agent's folder mounted", { own: p.own_env_has_key, mountsExact: results.find(r => r.id === "C2")?.pass }, p.own_env_has_key && !!results.find(r => r.id === "C2")?.pass);
  const list = { jsonrpc: "2.0", id: 1, method: "tools/list" };
  const stolen = await gwRaw(sales, agentToken(dev.id), list), own = await gwRaw(dev, agentToken(dev.id), list);
  check("F6", "Dev's gateway token is useless from Sales' network", "from Sales: 401; same request from Dev: 200", `from Sales ${stolen.status}; from Dev ${own.status}`, stolen.status === 401 && own.status === 200);
  const viaWget = (port: number) => docker("exec", "teamdb", "sh", "-c", `wget -S -T 3 -O /dev/null http://172.30.0.1:${port}/health 2>&1 | grep -q 'HTTP/' && echo open || echo blocked`);
  const f7 = { gateway_8081: await viaWget(8081), dashboard_8787: await viaWget(8787) };
  check("F7", "Only agents reach the gateway port; other containers on the server don't", "from the team DB's network: 8081 gets no HTTP answer at all; 8787 answers (control)", f7, f7.gateway_8081 === "blocked" && f7.dashboard_8787 === "open");
  const fw = await firewall();
  writeFileSync(`${EV}/firewall.txt`, Object.values(fw).join("\n\n") + "\n");

  // P. People, roles and the dashboard, as a member
  const mia = { username: "mia", password: randomBytes(12).toString("base64url") };
  // After the owner, people join only through a one-time invite link.
  const inv = await call("invite_person", { role: "member" }), inviteToken = String(inv.link).split("/invite/")[1] ?? "";
  const linkInfo = await api("GET", `/api/invite-links/${inviteToken}`);
  const join = await api("POST", "/api/people", { inviteToken, ...mia }), mc = join.cookie;
  const reuse = await api("POST", "/api/people", { inviteToken, username: "mallory", password: "mallory-password-1" });
  const unknown = await api("GET", "/api/invite-links/not-a-real-invite");
  const adminInv = await call("invite_person", { role: "admin" });
  const revoked = await api("DELETE", `/api/invites/${adminInv.id}`, undefined, cookie);
  const revokedUse = await api("POST", "/api/people", { inviteToken: String(adminInv.link).split("/invite/")[1], username: "mallory", password: "mallory-password-1" });
  check("P0", "People join only by invite; a link works once and can be revoked", "invite_person gives a link; its lookup 200 (member); joining makes a member with a session; the same link again 410; an unknown link 410; a revoked admin link 410",
    { link: String(inv.link).replace(inviteToken, "<token>"), lookup: `${linkInfo.status} ${linkInfo.json?.role}`, join: `${join.status} ${join.json?.user?.role}`, session: !!mc, reuse: reuse.status, unknown: unknown.status, revoked: `${revoked.status} then ${revokedUse.status}` },
    linkInfo.status === 200 && linkInfo.json.role === "member" && join.status === 200 && join.json.user.role === "member" && !!mc && reuse.status === 410 && unknown.status === 410 && revoked.status === 200 && revokedUse.status === 410);
  const mk = await api("POST", "/api/agents", { name: "Helper" }, mc), helper: Agent = { id: mk.json.id, net: mk.json.net };
  const steps = { start: (await api("PATCH", `/api/agents/${helper.id}`, { wanted: "running" }, mc)).status, instructions: (await api("PATCH", `/api/agents/${helper.id}`, { instructions: "# Helper\nHelps." }, mc)).status };
  const helperState = await docker("inspect", "-f", "{{.State.Status}}", `ag-${helper.id}`);
  check("P1", "A member manages their own agent from the dashboard", "create 200 (ag_…); start 200; instructions 200; container running",
    { create: `${mk.status} ${helper.id}`, ...steps, state: helperState }, mk.status === 200 && /^ag_/.test(helper.id) && steps.start === 200 && steps.instructions === 200 && helperState === "running");
  const denied = { deleteDev: (await api("DELETE", `/api/agents/${dev.id}`, undefined, mc)).status, grantPrivate: (await api("POST", "/api/grants", { agentId: helper.id, connectionId: conn.id }, mc)).status,
    invite: (await api("POST", "/api/invites", { role: "admin" }, mc)).status, setSeat: (await api("PATCH", "/api/admin", { seatToken: "x".repeat(30) }, mc)).status,
    removeOwner: (await api("DELETE", `/api/people/${setup.json.user.id}`, undefined, mc)).status };
  const devStill = (await call("list_agents")).some((a: any) => a.id === dev.id);
  check("P2", "A member can't delete others' agents, grant a connection they can't use, invite or remove people, or set the seat", "all 403; Dev still exists", { ...denied, devStill },
    Object.values(denied).every(s => s === 403) && devStill);
  await call("share_connection", { id: conn.id, everyone: true });
  const shared = await api("POST", "/api/grants", { agentId: helper.id, connectionId: conn.id }, mc);
  const p3a = await callTool(helper, { name: "postgres_query", arguments: { sql: "select count(*)::int as n from orders" } }); audit(helper, "allowed");
  await call("share_connection", { id: conn.id, everyone: false });
  const p3b = await callTool(helper, { name: "postgres_query", arguments: { sql: "select 1" } }); audit(helper, "denied");
  check("P3", "An agent reaches a connection only while its owner can: un-sharing cuts Helper off on its next call", "shared: grant 200, n=42; un-shared: Denied",
    { grant: shared.status, shared: p3a.text, unshared: p3b.text }, shared.status === 200 && rowsOf(p3a.text)?.[0]?.n === 42 && p3b.text === "Denied: no connection grants postgres_query to this agent.");
  const rm = await api("DELETE", `/api/agents/${helper.id}`, undefined, mc);
  const helperGone = await docker("ps", "-aq", "--filter", `name=ag-${helper.id}`);
  check("P4", "A member deletes their own agent from the dashboard", "deleted; container gone", `${rm.status} ${rm.json?.deleted} container=${helperGone || "gone"}`, rm.status === 200 && rm.json?.deleted === true && !helperGone);
  // Removing someone ends their access everywhere at once: sessions, personal tokens, OAuth apps, and their agents.
  const miaToken = (await oauthSignIn(mc, "mia's assistant")).access;
  const kept = await api("POST", "/api/agents", { name: "Keeper" }, mc), keeper: Agent = { id: kept.json.id, net: kept.json.net };
  await call("share_connection", { id: conn.id, everyone: true });
  await api("POST", "/api/grants", { agentId: keeper.id, connectionId: conn.id }, mc);
  await api("PATCH", `/api/agents/${keeper.id}`, { wanted: "running" }, mc);
  const miaId = (await call("list_people")).find((x: any) => x.username === "mia")?.id;
  await call("remove_person", { id: miaId });
  const afterRemoval = {
    session: (await api("GET", "/api/me", undefined, mc)).status,
    token: (await fetch(APP + "/mcp", { method: "POST", headers: { authorization: `Bearer ${miaToken}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).status,
    signIn: (await api("POST", "/api/sessions", mia)).status,
    agent: await docker("inspect", "-f", "{{.State.Status}}", `ag-${keeper.id}`),
    grantsLive: (await call("list_grants", { agentId: keeper.id })).length,
    listed: (await call("list_people")).some((x: any) => x.username === "mia"),
  };
  await call("share_connection", { id: conn.id, everyone: false });
  check("P5", "Removing a person ends their access at once", "their session 401, their OAuth app 401, sign-in 401; their agent stopped; they're off the People list",
    afterRemoval, afterRemoval.session === 401 && afterRemoval.token === 401 && afterRemoval.signIn === 401 && afterRemoval.agent === "exited" && !afterRemoval.listed);
  await call("delete_agent", { id: keeper.id });

  // O. OAuth for the control MCP: a client registers itself, the owner approves it while signed in, the client calls tools
  const redirect = "http://127.0.0.1:33418/callback", verifier = randomBytes(32).toString("base64url"), challenge = createHash("sha256").update(verifier).digest("base64url");
  const meta = (await api("GET", "/.well-known/oauth-protected-resource/mcp")).json, server = (await api("GET", "/.well-known/oauth-authorization-server")).json;
  const reg = await api("POST", "/api/oauth/clients", { client_name: "e2e assistant", redirect_uris: [redirect] });
  const approve = await api("POST", "/api/oauth/codes", { clientId: reg.json.client_id, redirectUri: redirect, codeChallenge: challenge, codeChallengeMethod: "S256", state: "xyz", allow: true }, cookie);
  const code = new URL(approve.json.redirect).searchParams.get("code") ?? "";
  const tokenReq = (body: Record<string, string>) => fetch(APP + "/api/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) }).then(r => r.json() as Promise<any>);
  const wrongVerifier = await tokenReq({ grant_type: "authorization_code", code, code_verifier: "x".repeat(43), client_id: reg.json.client_id, redirect_uri: redirect });
  const approve2 = await api("POST", "/api/oauth/codes", { clientId: reg.json.client_id, redirectUri: redirect, codeChallenge: challenge, codeChallengeMethod: "S256", allow: true }, cookie);
  const tokens = await tokenReq({ grant_type: "authorization_code", code: new URL(approve2.json.redirect).searchParams.get("code") ?? "", code_verifier: verifier, client_id: reg.json.client_id, redirect_uri: redirect });
  const viaOauth = (await (await mcp(tokens.access_token))("list_agents")).map((a: any) => a.name);
  const rotated = await tokenReq({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: reg.json.client_id });
  const oldRefresh = await tokenReq({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: reg.json.client_id });
  const apps = (await api("GET", "/api/oauth/grants", undefined, cookie)).json.data ?? [];
  check("O1", "An MCP client signs in with OAuth (registration, PKCE, refresh) and calls tools as the person", "metadata points at /mcp/authorize; a code with the wrong verifier fails; the right one gives jbo_/jbr_ tokens; tools work; refresh rotates (the old refresh token fails); Admin lists the app",
    { authorize: server.authorization_endpoint, resource: meta.resource, wrongVerifier: wrongVerifier.error?.message ?? wrongVerifier, access: /^jbo_/.test(tokens.access_token), agents: viaOauth, rotated: /^jbo_/.test(rotated.access_token) && rotated.access_token !== tokens.access_token, oldRefresh: oldRefresh.error?.message ?? oldRefresh, apps: apps.map((a: any) => a.client) },
    server.authorization_endpoint === `${APP}/mcp/authorize` && meta.resource === `${APP}/mcp` && !!code && !wrongVerifier.access_token && /^jbo_/.test(tokens.access_token) && /^jbr_/.test(tokens.refresh_token) &&
    viaOauth.includes("Dev") && rotated.access_token !== tokens.access_token && !oldRefresh.access_token && same(apps.map((a: any) => a.client).sort(), ["e2e", "e2e assistant"]));

  // CH. Channels: Slack checks both tokens with Slack itself; WhatsApp links from inside the agent's own container
  const badSlack = await api("POST", "/api/channels", { kind: "slack", agentId: dev.id, botToken: "xoxb-1111-2222-notarealtoken", appToken: "xapp-1-A111-2222-notarealtoken", ownerAddress: "U012ABCDEF", open: false, allowed: [] }, cookie);
  check("CH1", "Slack: the app checks the bot token with Slack before saving anything", "slack.com answers invalid_auth: 400 on botToken; no channel saved",
    { status: badSlack.status, param: badSlack.json?.error?.param, message: badSlack.json?.error?.message, saved: (await api("GET", `/api/channels?agentId=${dev.id}`, undefined, cookie)).json.data.length },
    badSlack.status === 400 && badSlack.json?.error?.param === "botToken" && /invalid_auth/.test(badSlack.json?.error?.message ?? ""));
  const wa = await api("POST", "/api/channels", { kind: "whatsapp", agentId: dev.id, ownerAddress: "+15551234567", open: false, allowed: ["+15557654321"] }, cookie);
  await waitReady(dev); // saving the channel restarts Dev with WhatsApp on
  const waEnv = read(`/data/agent-conf/${dev.id}/.env`).split("\n").filter(l => l.startsWith("WHATSAPP_"));
  const waApprovers = read(`/data/agent-conf/${dev.id}/config.yaml`).match(/approvers: (.*)/)?.[1];
  let qr = "", waErr = "";
  await until(async () => { const r = await api("GET", `/api/channels/${wa.json.id}`, undefined, cookie); qr = r.json?.qr ?? ""; waErr = r.json?.error?.message ?? ""; return !!qr || !!waErr; }, 120);
  check("CH2", "WhatsApp: linking shows a real pairing code from WhatsApp, fetched through the agent's own firewall", "channel linking; .env has bot mode with the owner and the allowed number; approvals go to the owner's WhatsApp; a WhatsApp QR payload (2@…) within 2 min",
    { status: wa.json?.status, env: waEnv, approvers: waApprovers, qr: qr ? `${qr.slice(0, 12)}…` : waErr || "none" },
    wa.json?.status === "linking" && waEnv.includes("WHATSAPP_MODE=bot") && waEnv.includes("WHATSAPP_ALLOWED_USERS=15551234567,15557654321") &&
    !!waApprovers?.includes("15551234567@s.whatsapp.net") && /^2@/.test(qr));
  const unlink = await api("DELETE", `/api/channels/${wa.json.id}`, undefined, cookie);
  await waitReady(dev);
  const afterUnlink = { session: await shell(`ls /data/agents/${dev.id}/platforms/whatsapp/session 2>/dev/null | wc -l`), env: read(`/data/agent-conf/${dev.id}/.env`).includes("WHATSAPP_ENABLED") };
  check("CH3", "Unlinking WhatsApp stops pairing, deletes the session and turns WhatsApp off", "deleted; no session files; no WHATSAPP_ lines in .env",
    { deleted: unlink.json?.deleted, ...afterUnlink }, unlink.json?.deleted === true && afterUnlink.session.trim() === "0" && !afterUnlink.env);

  // U. Claude mode, which the e2e can't run for real (no subscription here)
  const fake = `sk-ant-oat01-${randomBytes(24).toString("hex")}`;
  const tmp = mkdtempSync("/tmp/jb-u1-");
  // The real modules, in a scratch database: the owner sets the seat, then an agent's files are rendered.
  const A = "/opt/jakebox/packages/app/src";
  const u1 = JSON.parse((await sh("node", ["--input-type=module", "-e", `
    const { db, migrate, closeDb } = await import("${A}/platform/db.ts"); await migrate();
    const { seal } = await import("${A}/platform/secrets.ts"); const { settings } = await import("${A}/platform/settings.ts");
    const { renderFiles } = await import("${A}/agents/hermes-files.ts");
    await db.insertInto("person").values({ id: "usr_u1u1u1u1", username: "u1owner", pass: "x", role: "owner", removed_at: null }).execute();
    await settings.setSeatToken(process.env.FAKE);
    const a = await db.insertInto("agent").values({ id: "ag_u1u1u1u1", name: "U1", owner_id: "usr_u1u1u1u1", instructions: "# U1", model: "sonnet", net: 7, channel_key: seal("k".repeat(32)) }).returningAll().executeTakeFirstOrThrow();
    console.log(JSON.stringify(await renderFiles(a))); await closeDb(); process.exit(0);`],
    { env: { ...process.env, JAKEBOX_MODEL: "claude", JAKEBOX_DATA: tmp, FAKE: fake } })).stdout.trim().split("\n").pop()!);
  await shell(`rm -rf ${tmp}`);
  check("U1", "Claude mode renders the seat plugin as the model and the seat token into .env", "provider claude-subscription-directsdk-experimental, default sonnet, haiku for side tasks; CLAUDE_CODE_OAUTH_TOKEN set; no test model",
    { config: u1["config.yaml"].split("\n").filter((l: string) => /model:|default:|provider|auxiliary|approval|compression/.test(l)), env: u1[".env"].replace(/=.*/g, "=…") },
    /provider: claude-subscription-directsdk-experimental/.test(u1["config.yaml"]) && /default: sonnet/.test(u1["config.yaml"]) && /approval: \{ provider: claude-subscription-directsdk-experimental, model: haiku \}/.test(u1["config.yaml"]) &&
    u1[".env"].includes(`CLAUDE_CODE_OAUTH_TOKEN=${fake}`) && !/test-llm/.test(u1["config.yaml"]));
  const cli = await docker("exec", "-u", "10000:10000", `ag-${dev.id}`, "claude", "--version").catch(e => String(e.stderr ?? e));
  const plugins = await docker("exec", "-u", "10000:10000", "-e", "COLUMNS=250", `ag-${dev.id}`, "/opt/hermes/bin/hermes", "plugins", "list").catch(e => String(e.stdout ?? e));
  const pluginLine = plugins.split("\n").find(l => l.includes("claude-subscription-directsdk")) ?? "not listed";
  check("U2", "Every agent has the pinned Claude CLI and the seat plugin, read-only", "claude --version 2.1.311; hermes plugins list shows claude-subscription-directsdk",
    { cli, plugin: pluginLine.replace(/\s+/g, " ").trim() }, /^2\.1\.311\b/.test(cli) && pluginLine !== "not listed");
  const seatSet = await call("set_claude_seat", { token: fake });
  const admin = (await api("GET", "/api/admin", undefined, cookie)).json;
  const seatLeak = [JSON.stringify(await call("get_agent", { id: dev.id })), JSON.stringify(await call("list_agents")), JSON.stringify(admin), read(`/data/agent-conf/${dev.id}/.env`)].some(s => s.includes(fake));
  check("U3", "The owner sets the Claude seat over the control MCP; it's sealed and never shown", "{seat: set}; Admin says the seat is set; token in no reply (test mode keeps it out of .env)",
    { seatSet, adminSeat: admin.seat, leak: seatLeak }, seatSet.seat === "set" && admin.seat?.set === true && !seatLeak);
  await waitReady(dev); // setting the seat re-applies and restarts running agents

  // G. Lifecycle
  const idOf = async (id: string) => docker("inspect", "-f", "{{.Id}}", `ag-${id}`);
  const statusOf = async (id: string) => docker("inspect", "-f", "{{.State.Status}}", `ag-${id}`);
  const before = await idOf(sales.id);
  await call("update_agent", { id: sales.id, wanted: "stopped" });
  const stopped = await statusOf(sales.id);
  await call("update_agent", { id: sales.id, wanted: "running" });
  const t1 = Date.now(), restarted = await statusOf(sales.id), afterId = await idOf(sales.id), answers = await waitReady(sales, 120), backMs = Date.now() - t1;
  const bound = Math.max(30_000, 2 * firstBoot); // a stale PID file once held Hermes back ~90 s after a stop/start
  check("G1", "Stop and start keep the same container, and the agent answers again as fast as a first boot", `exited, then running; same container id; API server answers within ${Math.round(bound / 1000)} s`,
    `${stopped} -> ${restarted}; same id: ${before === afterId}; answers after ${Math.round(backMs / 1000)} s`, stopped === "exited" && restarted === "running" && before === afterId && answers && backMs <= bound);
  const startedBefore = await docker("inspect", "-f", "{{.State.StartedAt}}", `ag-${dev.id}`);
  await call("update_agent", { id: dev.id, instructions: "# Dev\nUpdated instructions v2." });
  const startedAfter = await docker("inspect", "-f", "{{.State.StartedAt}}", `ag-${dev.id}`);
  const soulInside = await docker("exec", `ag-${dev.id}`, "cat", "/opt/data/SOUL.md");
  const g2 = (await waitReady(dev)) ? await chat(dev, "hello again") : "not ready";
  check("G2", "Editing instructions restarts the agent, which then sees and answers with them", "new StartedAt; SOUL.md inside the container has v2; replies \"ECHO: hello again\"",
    { restarted: startedBefore !== startedAfter, soul: soulInside, reply: g2 }, startedBefore !== startedAfter && soulInside.includes("v2") && g2 === "ECHO: hello again");
  await call("delete_agent", { id: sales.id });
  const gone = { container: await docker("ps", "-aq", "--filter", `name=ag-${sales.id}`), network: await docker("network", "ls", "-q", "--filter", `name=ag-${sales.id}`),
    folders: await shell(`ls -d /data/agents/${sales.id} /data/agent-conf/${sales.id} 2>/dev/null || true`) };
  check("G3", "Delete removes the container, the network and both folders", "all empty", gone, !gone.container && !gone.network && !gone.folders);

  // W. The firewall watchdog: with the firewall gone, agentd refuses to start agents, puts the firewall back, or stops every agent
  const jump = ["DOCKER-USER", "-s", "10.200.0.0/16", "-j", "AGENT"];
  await call("update_agent", { id: dev.id, wanted: "stopped" });
  await sh("iptables", ["-D", ...jump]);
  await sleep(6000); // /health reads a firewall check at most 5 s old
  const h503 = await health();
  const refused = await call("update_agent", { id: dev.id, wanted: "running" }).then(() => "started", e => (e as Error).message);
  check("W1", "With the firewall gone, health fails and agentd refuses to start an agent", "/health 503 firewall:false; start refused \"firewall is off\"", { health: h503, start: refused },
    h503.status === 503 && h503.firewall === false && /firewall is off/.test(refused));
  const reapplied = await until(async () => (await health()).ok === true, 45);
  const back = await until(async () => (await statusOf(dev.id)) === "running", 45) && await waitReady(dev, 120);
  const agentdLog = await shell("tail -n 50 /var/log/jakebox/agentd.log");
  check("W2", "Within 30 s agentd puts the firewall back; the app then starts the agent that should be running", "health ok again; agentd.log \"re-applied the firewall\"; Dev running and answering",
    { healthBack: reapplied, devRunning: back, log: agentdLog.split("\n").filter(l => /watchdog/.test(l)).slice(-2) }, reapplied && back && /re-applied the firewall/.test(agentdLog));
  // The watchdog compares whole chains, so a single missing rule counts too: drop the INPUT guard's catch-all.
  await sh("iptables", ["-D", "AGENT-IN", "-s", "10.200.0.0/16", "-j", "DROP"]);
  await sleep(6000);
  const w2b503 = await health();
  const w2bBack = await until(async () => (await health()).ok === true, 45);
  const w2bSame = same(await firewall(), fw);
  check("W2b", "One missing rule is noticed and repaired too, in the right order", "after deleting AGENT-IN's agent DROP: health 503; within 30 s health ok and the chains identical to firewall.txt",
    { health: w2b503.status, back: w2bBack, identical: w2bSame }, w2b503.status === 503 && w2bBack && w2bSame);
  // A rule inserted above the INPUT jump would let agents skip AGENT-IN: it's noticed, and the jump goes back to the top.
  await sh("iptables", ["-I", "INPUT", "1", "-s", "10.200.0.0/16", "-j", "ACCEPT"]);
  await sleep(6000);
  const w2c503 = await health();
  const w2cBack = await until(async () => (await health()).ok === true, 45);
  const firstInput = await shell("iptables -S INPUT | sed -n 2p");
  await sh("iptables", ["-D", "INPUT", "-s", "10.200.0.0/16", "-j", "ACCEPT"]);
  check("W2c", "A rule slipped above a jump is noticed, and the jump goes back to the top", "after inserting an ACCEPT above INPUT's jump: health 503; within 30 s health ok and INPUT's first rule is the jump",
    { health: w2c503.status, back: w2cBack, first: firstInput }, w2c503.status === 503 && w2cBack && firstInput === "-A INPUT -j AGENT-IN");
  // One agent can't tie up the app. Connections held open with unfinished headers: the firewall lets 16 through.
  // Requests with slow 900 KB bodies: the gateway holds 8 and answers the rest 429 at once.
  const FLOOD = `import socket, os, time, json
gw, tok = os.environ["GW"], os.environ["TOKEN"]
def burst(n, payload):
    socks, refused = [], 0
    for i in range(n):
        try:
            s = socket.create_connection((gw, 8081), timeout=1)
        except Exception:
            refused += 1; continue
        try:
            s.sendall(payload)
        except Exception:
            pass
        socks.append(s)
    return socks, refused
held, held_refused = burst(30, b"POST /api/v1/mcp HTTP/1.1\\r\\nHost: x\\r\\n")
time.sleep(3)
for s in held: s.close()
time.sleep(2)
head = ("POST /api/v1/mcp HTTP/1.1\\r\\nHost: x\\r\\nAuthorization: Agent " + tok + "\\r\\nContent-Type: application/json\\r\\nContent-Length: 900000\\r\\n\\r\\n").encode()
bodies, _ = burst(12, head + b"x" * 100000)
time.sleep(8)
got429 = 0
for s in bodies:
    s.settimeout(0.5)
    try:
        if b" 429 " in s.recv(200): got429 += 1
    except Exception:
        pass
    s.close()
print(json.dumps({"headersHeld": len(held), "headersRefused": held_refused, "bodies": len(bodies), "got429": got429}))`;
  const [flood, during] = await Promise.all([asAgent(dev, FLOOD, { GW: `10.200.${dev.net}.1`, TOKEN: agentToken(dev.id) }).then(JSON.parse),
    sleep(22_000).then(health)]);
  const afterFlood = (await gwRaw(dev, agentToken(dev.id), { jsonrpc: "2.0", id: 1, method: "tools/list" })).status;
  check("K11", "One agent can't tie up the app", "30 connections with unfinished headers: at most 16 get through; 12 slow 900 KB uploads: all but 8 get 429; the app answers meanwhile; afterwards the agent works again",
    { ...flood, healthDuring: during.status, afterwards: afterFlood },
    flood.headersHeld <= 16 && flood.headersRefused >= 14 && flood.got429 >= flood.bodies - 8 && flood.got429 >= 4 && during.status === 200 && afterFlood === 200);
  // The gateway's own limits: a body over 1 MB is refused, and a request whose headers don't finish within 10 s is cut off.
  const LIMITS = `import socket, os, time, json
gw, tok = os.environ["GW"], os.environ["TOKEN"]
s = socket.create_connection((gw, 8081), timeout=20)
body = b"x" * 2000000
s.sendall(("POST /api/v1/mcp HTTP/1.1\\r\\nHost: x\\r\\nAuthorization: Agent " + tok + "\\r\\nContent-Type: application/json\\r\\nContent-Length: %d\\r\\n\\r\\n" % len(body)).encode())
try:
    s.sendall(body)
except Exception:
    pass
try:
    big = s.recv(200).decode(errors="replace").split("\\r\\n")[0]
except Exception as e:
    big = type(e).__name__
s.close()
t = time.time()
s = socket.create_connection((gw, 8081), timeout=40)
s.sendall(b"POST /api/v1/mcp HTTP/1.1\\r\\nHost: x\\r\\n")
try:
    first = s.recv(200).decode(errors="replace").split("\\r\\n")[0] or "closed"
except Exception as e:
    first = type(e).__name__
print(json.dumps({"bigBody": big, "slowHeaders": first, "after": round(time.time() - t)}))`;
  const limits = JSON.parse(await asAgent(dev, LIMITS, { GW: `10.200.${dev.net}.1`, TOKEN: agentToken(dev.id) }));
  check("K12", "The gateway refuses a body over 1 MB and cuts off headers that don't finish in 10 s", "2 MB body: 413; unfinished headers: 408 or closed after 10–15 s",
    limits, /\b413\b/.test(limits.bigBody) && (/\b408\b/.test(limits.slowHeaders) || limits.slowHeaders === "closed") && limits.after >= 10 && limits.after <= 15);
  await shell("chmod 0644 /opt/jakebox/install/agents-firewall.sh");
  await sh("iptables", ["-D", ...jump]);
  const stoppedAll = await until(async () => (await statusOf(dev.id)) === "exited", 45);
  const w3health = await health();
  await shell("chmod 0755 /opt/jakebox/install/agents-firewall.sh");
  const recovered = await until(async () => (await health()).ok === true, 45) && await until(async () => (await statusOf(dev.id)) === "running", 45) && await waitReady(dev, 120);
  const w3log = await shell("tail -n 50 /var/log/jakebox/agentd.log");
  check("W3", "If the firewall can't be put back, agentd stops every agent; once it's back they start again", "agentd.log \"stopped 1 agents\"; Dev exited, health 503; after the fix: health ok, Dev running and answering",
    { stoppedAll, health: w3health.status, recovered, log: w3log.split("\n").filter(l => /stopped \d+ agents/.test(l)).slice(-1) }, stoppedAll && w3health.status === 503 && recovered && /stopped 1 agents/.test(w3log));

  // For the upgrade phase: a file the next release doesn't have.
  writeFileSync("/opt/jakebox/packages/app/src/only-in-the-previous-release.ts", "// left behind by an earlier release\n");
  writeFileSync(`${EV}/state.json`, JSON.stringify({ dev, conn: conn.id, oauth: { refresh: oauth.refresh, clientId: oauth.clientId }, envSha: sha(env), fw, devContainer: await idOf(dev.id), reconciled: reconcileCount(dev.id),
    build: (await health()).build, pids: { agentd: await pidOf("^node /opt/jakebox/packages/agentd/src/agentd.ts"), app: await pidOf("^node /opt/jakebox/packages/app/src/app.ts") },
    devStarted: await docker("inspect", "-f", "{{.State.StartedAt}}", `ag-${dev.id}`) }));
}

// ---------- after re-running the installer over the live server ----------
async function afterUpgrade() {
  const st = JSON.parse(read(`${EV}/state.json`));
  const log = read(`${EV}/upgrade.log`).replace(/\x1b\[[0-9;]*m/g, "");
  const env = read("/etc/jakebox/env");
  const pin = read("/opt/jakebox/install/agent-image").trim(), hUp = await health(), agentdImage = (await agentdAsk("health")).image;
  check("UP1", "Re-running the curl command upgrades in place, keeps the settings, and agentd follows the new release's image pin", "\"JakeBox is running\"; /etc/jakebox/env unchanged (JAKEBOX_MODEL=test though not passed, no AGENT_IMAGE stored); the new pin names the image as docker.io/…, and agentd runs with exactly that",
    { done: log.includes("JakeBox is running"), envUnchanged: sha(env) === st.envSha, model: env.match(/JAKEBOX_MODEL=\S+/)?.[0], imageStored: /AGENT_IMAGE=/.test(env), pin, agentd: agentdImage },
    log.includes("JakeBox is running") && sha(env) === st.envSha && /JAKEBOX_MODEL=test/.test(env) && !/AGENT_IMAGE=/.test(env) && pin.startsWith("docker.io/") && pin.endsWith(PINNED) && agentdImage === pin && hUp.ok === true);
  const pids = { agentd: await pidOf("^node /opt/jakebox/packages/agentd/src/agentd.ts"), app: await pidOf("^node /opt/jakebox/packages/app/src/app.ts"), supervisors: await pidOf("^/bin/sh /opt/jakebox/install/supervise.sh") };
  const h = await health(), n = (p: string) => p.split(/\s+/).filter(Boolean).length;
  const stale = await shell("ls /opt/jakebox/packages/app/src/only-in-the-previous-release.ts 2>&1 || true");
  check("UP2", "The new release replaced the old: new build, new processes, nothing left behind", `/health build ${"e2e-2"} (was ${st.build}); 1 agentd and 1 app with new PIDs, 2 supervisors; the previous release's extra file gone`,
    { build: `${st.build} -> ${h.build}`, pids: { before: st.pids, after: pids }, stale },
    h.status === 200 && h.agentd === true && h.build === "e2e-2" && st.build === "e2e-1" && read("/opt/jakebox/BUILD").trim() === "e2e-2" &&
    n(pids.agentd) === 1 && n(pids.app) === 1 && n(pids.supervisors) === 2 && pids.agentd !== st.pids.agentd && pids.app !== st.pids.app && /No such file/.test(stale));
  const call = await mcp(await refreshed(st));
  const restarted = await until(async () => (await docker("inspect", "-f", "{{.State.StartedAt}}", `ag-${st.dev.id}`)) !== st.devStarted, 60) && await waitReady(st.dev, 180);
  const agents = await call("list_agents"), sameContainer = (await docker("inspect", "-f", "{{.Id}}", `ag-${st.dev.id}`)) === st.devContainer;
  const soul = await docker("exec", `ag-${st.dev.id}`, "cat", "/opt/data/SOUL.md");
  // The old release folder is gone; a running agent must have remounted the new one's plugin.
  const plugin = await docker("exec", `ag-${st.dev.id}`, "ls", "/opt/data/plugins/claude-subscription-directsdk/inert_mcp.py").catch(e => String(e.stderr ?? e).trim());
  const rebuilt = read("/var/log/jakebox/app.log").includes("new build e2e-1 -> e2e-2: restarted running agents");
  const setupClosed = (await api("GET", "/api/setup")).json.open === false;
  check("UP3", "Data, tokens and agents survive the upgrade; the new release restarts running agents once, so they mount its files", "token works; Dev in the same container; \"new build e2e-1 -> e2e-2\" in app.log; Dev restarted with its instructions intact and its plugin folder present; setup stays closed",
    { agents: agents.map((a: any) => `${a.name}:${a.status}`), sameContainer, rebuilt, restarted, soul, plugin, setup: setupClosed },
    agents.some((a: any) => a.id === st.dev.id && a.status === "running") && sameContainer && rebuilt && restarted && soul.includes("Updated instructions v2.") &&
    plugin.endsWith("inert_mcp.py") && setupClosed);
  const r = (await waitReady(st.dev)) ? inner(await chat(st.dev, "sql: select count(*)::int as n from orders")) : "not ready";
  check("UP4", "Dev still answers from the team DB", "rows [{n: 42}]", r, rowsOf(r)?.[0]?.n === 42);
}

// ---------- after the server restarts ----------
async function afterRestart() {
  const st = JSON.parse(read(`${EV}/state.json`));
  // The app restarts agents within 30 s of booting; wait for Dev to run and answer before judging the boot.
  const back = await until(async () => (await docker("inspect", "-f", "{{.State.Status}}", `ag-${st.dev.id}`)) === "running", 60) && await waitReady(st.dev, 180);
  // The last boot that started dockerd: from its "boot" line to the next one.
  const boot = read("/var/log/jakebox/boot.log").trim().split("\n");
  const li = boot.findLastIndex(l => l.endsWith(" dockerd launching"));
  const start = boot.slice(0, li).findLastIndex(l => l.endsWith(" boot")), next = boot.findIndex((l, i) => i > li && l.endsWith(" boot"));
  const last = boot.slice(start, next < 0 ? boot.length : next);
  const at = (m: string) => last.find(l => l.endsWith(` ${m}`))?.split(" ")[0] ?? "";
  const order = ["firewall applied", "dockerd launching", "dockerd up", "agentd and app started"].map(m => last.findIndex(l => l.endsWith(` ${m}`)));
  const devStarted = (await docker("inspect", "-f", "{{.State.StartedAt}}", `ag-${st.dev.id}`)).replace(/(\.\d{3})\d+/, "$1");
  check("H1", "After a restart the firewall is up before dockerd, and the agent starts after both", "boot.log lines in order: firewall, dockerd launching, dockerd up, agentd and app; Dev started at least 1 s after that last mark",
    { boot: last, devStarted }, order.every(i => i >= 0) && order.every((v, i) => i === 0 || order[i - 1] < v) &&
    new Date(devStarted).getTime() >= new Date(at("agentd and app started")).getTime() + 1000);
  const fw = await firewall();
  check("H2", "The firewall after the restart is exactly the one tested before it", "AGENT, AGENT-IN, both jumps and the ip rule identical to firewall.txt", Object.fromEntries(Object.entries(fw).map(([k, v]) => [k, v === st.fw[k]])), same(fw, st.fw));
  const call = await mcp(await refreshed(st));
  const agents = await call("list_agents");
  const restart = await docker("inspect", "-f", "{{.HostConfig.RestartPolicy.Name}}", `ag-${st.dev.id}`);
  const reconciled = reconcileCount(st.dev.id);
  check("H3", "JakeBox (not Docker) brings the agent back", "Dev running and answering within 4 min; restart policy no; a new \"reconcile: started\" line in app.log",
    { back, agents: agents.map((a: any) => `${a.name}:${a.status}`), restart, reconcileLines: `${st.reconciled} before, ${reconciled} now` },
    back && agents.some((a: any) => a.id === st.dev.id && a.status === "running") && restart === "no" && reconciled > st.reconciled);
  const r = (await waitReady(st.dev)) ? inner(await chat(st.dev, "sql: select count(*)::int as n from orders")) : "not ready";
  check("H4", "It still answers and still reaches the DB through the gateway", "rows [{n: 42}]", r, rowsOf(r)?.[0]?.n === 42);
  const iso = await isolation(st.dev);
  writeFileSync(`${EV}/isolation-probe-dev-after-restart.json`, JSON.stringify({ probe: iso.p, matrix: iso.rows }, null, 2));
  check("H5", "Isolation holds after the restart (same probe, from Dev)", "matrix all ok", iso.rows.map(x => `${x.target}: ${x.agent}/${x.from_server}${x.ok ? "" : " ✗"}`), iso.pass);
  const h = await health();
  check("H6", "Health reports agentd and the firewall", "200 {ok: true, agentd: true, firewall: true}", h, h.status === 200 && h.ok && h.agentd && h.firewall);
}

try { await ({ main, "after-upgrade": afterUpgrade, "after-restart": afterRestart } as Record<string, () => Promise<void>>)[phase](); }
catch (e) { check("X", "Run completed without an exception", "no exception", (e as Error).stack ?? String(e), false); }
const file = `${EV}/e2e-${phase}.json`;
writeFileSync(file, JSON.stringify({ phase, at: new Date().toISOString(), passed: results.filter(r => r.pass).length, failed: results.filter(r => !r.pass).length, results }, null, 2));
console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed -> ${file}`);
process.exit(results.every(r => r.pass) ? 0 : 1);
