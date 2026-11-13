const COMMAND = '<pre class="cmd"><code>curl -fsSL https://get.jakebox.dev | sh</code></pre>'

export const PAGES: Page[] = [
  {
    path: '/',
    nav: 'Overview',
    title: 'JakeBox: self-hosted agents for your team',
    description: 'One command on your Linux server runs your team\'s Hermes agents, each in its own gVisor container, with one gateway holding every key.',
    body: `
<p class="eyebrow">Self-hosted agents for your team</p>
<h1>Your team's AI agents, on your own server</h1>
<p class="lead">JakeBox runs many Hermes agents on one Linux server. Each agent lives in its own gVisor container, with its own Slack app and WhatsApp number. Agents reach your team's data only through JakeBox's gateway, which holds every key and checks each agent's grants on every call.</p>
${COMMAND}
<p class="mute">Run it as root on a Linux server. It prints a sign-up link, and the first person to open it becomes the owner. <a href="/docs/install">What the installer does</a></p>
<div class="grid">
  <div class="card"><div class="top"><span class="tile">${icon('<rect x="4" y="7" width="16" height="12" rx="4" /><path d="M12 7V4M9 13h.01M15 13h.01" />')}</span><span class="name">One container per agent</span></div><p>gVisor, a read-only root and its own network. An agent can't reach another agent, the server or your LAN.</p></div>
  <div class="card"><div class="top"><span class="tile">${icon('<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z" /><path d="M9 12l2 2 4-4" />')}</span><span class="name">One gateway holds the keys</span></div><p>Agents never see a password. The gateway checks the agent's grants on every call and logs each one.</p></div>
  <div class="card"><div class="top"><span class="tile">${icon('<path d="M4 6h16v10H8l-4 4z" />')}</span><span class="name">Its own channels</span></div><p>Each agent is its own Slack app and its own WhatsApp number. You choose who may message it.</p></div>
  <div class="card"><div class="top"><span class="tile">${icon('<circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3 6" />')}</span><span class="name">Managed your way</span></div><p>From the dashboard, or from your own AI assistant over the control MCP, signed in with OAuth.</p></div>
</div>
<h2>Next</h2>
<ul>
  <li><a href="/docs/install">Install</a>: what you need and what the command does.</li>
  <li><a href="/docs/upgrade">Upgrade</a>: run the same command again.</li>
  <li><a href="/docs/security">Security</a>: how agents are kept apart and away from your keys.</li>
  <li><a href="/docs/uninstall">Uninstall</a>: remove everything JakeBox put on the server.</li>
</ul>`,
  },
  {
    path: '/docs/install',
    nav: 'Install',
    title: 'Install JakeBox',
    description: 'What JakeBox needs and what the one-line installer does.',
    body: `
<h1>Install</h1>
<p class="lead">Run one command as root on your server:</p>
${COMMAND}
<p>Not root? Use <code>curl -fsSL https://get.jakebox.dev | sudo sh</code>.</p>
<h2>What you need</h2>
<ul>
  <li>A Linux server, x86_64 or arm64.</li>
  <li>Root.</li>
  <li>apt (Debian, Ubuntu) or apk (Alpine).</li>
  <li>Disk for the agent image: the first start pulls about 3 GB.</li>
  <li>systemd, or not:
    <ul>
      <li>With systemd, JakeBox runs as units and starts again after a reboot.</li>
      <li>Without systemd, the installer starts it with <code>/opt/jakebox/install/host-start.sh</code>. After a reboot, run that script again. Agents stay stopped until you do.</li>
    </ul>
  </li>
</ul>
<h2>What the installer does</h2>
<ol>
  <li>Installs what's missing: Docker, gVisor <code>20261109.0</code> and Node 22.
    <ul>
      <li>With apk, Node is Alpine's <code>nodejs</code> package. With apt, it's Node 22.23.5 from nodejs.org. Either way it needs Node 22.18 or newer.</li>
      <li>If Docker is already running, it reloads Docker and checks that Docker knows the <code>runsc</code> runtime.</li>
    </ul>
  </li>
  <li>Downloads JakeBox and Claude Code 2.1.311.</li>
  <li>Checks every download against a checksum written into the installer itself: gVisor's sha512, and the sha256 of Node, Claude Code and the JakeBox release. A tampered mirror can't swap a file.</li>
  <li>Unpacks the release into a clean <code>/opt/jakebox.new</code>, owned by root and writable by nobody else, and swaps it in whole. Nothing from an earlier release lingers.</li>
  <li>Writes its settings to <code>/etc/jakebox/env</code> (mode 0600). On a re-run it keeps what's there and only adds missing keys.</li>
  <li>Starts JakeBox. On a systemd server, with units: <code>jakebox-firewall</code> before <code>docker.service</code>, then agentd, then the app. Otherwise with <code>install/host-start.sh</code>, in the same order.</li>
  <li>Waits until the new app answers <code>/health</code>.</li>
  <li>Prints the owner sign-up link, <code>http://IP:8787/setup?code=…</code>. The first person to open it becomes the owner. After that, people join only by invite.</li>
</ol>
<p>Before agentd starts, the server pulls the pinned Hermes image and prepares the WhatsApp bridge, once per image. If the bridge fails, WhatsApp stays off and JakeBox still starts.</p>
<h2>After the install</h2>
<p>Keep port 8787 private, behind Tailscale or an SSH tunnel, or put TLS in front of it: sign-in travels over plain HTTP.</p>`,
  },
  {
    path: '/docs/upgrade',
    nav: 'Upgrade',
    title: 'Upgrade JakeBox',
    description: 'Upgrade JakeBox by running the install command again.',
    body: `
<h1>Upgrade</h1>
<p class="lead">Run the install command again:</p>
${COMMAND}
<p>It upgrades in place and keeps:</p>
<ul>
  <li>your data in <code>/data</code>;</li>
  <li>the settings in <code>/etc/jakebox/env</code>;</li>
  <li>people, tokens, connections and agents.</li>
</ul>
<h2>What happens to agents</h2>
<ul>
  <li>The Hermes image follows each release's pin, unless you set <code>AGENT_IMAGE</code> in <code>/etc/jakebox/env</code>.</li>
  <li>The new app restarts every running agent once, so each one gets the new release's plugin and CLI.</li>
  <li>After that, every 30 seconds it restarts any running agent whose files changed since it started.</li>
</ul>
<p>The installer finishes only when the new app answers <code>/health</code>.</p>`,
  },
  {
    path: '/docs/security',
    nav: 'Security',
    title: 'JakeBox security',
    description: 'How JakeBox keeps agents apart, off your network and away from your keys.',
    body: `
<h1>Security</h1>
<p class="lead">Agents read untrusted input from Slack and WhatsApp, so JakeBox assumes any agent can be talked into anything. It keeps each one in its own box, off your network and away from your keys.</p>
<h2>Isolation</h2>
<ul>
  <li>Each agent runs in its own container on gVisor: user 10000, a read-only root, every capability dropped, no new privileges, limits on processes, memory and CPU, and its own <code>/24</code> network.</li>
  <li>Its config, skills, plugin and the Claude CLI are mounted read-only.</li>
  <li>Containers have no Docker restart policy, so nothing starts an agent before the firewall.</li>
  <li>The dashboard app never touches Docker. agentd does, as root, on a Unix socket with a fixed set of commands. It refuses to start an agent unless the firewall check passes.</li>
</ul>
<h2>Firewall</h2>
<p>Two iptables chains, applied before Docker starts and again whenever agentd starts:</p>
<ul>
  <li><code>AGENT</code> covers agents' outbound traffic: DNS to one resolver and HTTPS on port 443, nothing else. Private ranges, Tailscale and link-local addresses, which include the cloud metadata address, are dropped.</li>
  <li><code>AGENT-IN</code> covers traffic to the server: agents reach only the gateway on port 8081, at most 16 connections each, and nobody else reaches 8081.</li>
</ul>
<p>Every 30 seconds agentd applies the firewall again, or stops every agent if it can't. <code>/health</code> fails unless the firewall check passes.</p>
<h2>The gateway holds the keys</h2>
<ul>
  <li>Agents reach team data, Postgres today, only through the gateway on port 8081. It holds every connection's credentials, sealed with AES-256-GCM. Agents never see them.</li>
  <li>Each agent has its own token, which works only from the agent's own network.</li>
  <li>On every call the gateway checks that the agent holds a grant and that its owner can still use the connection. Un-sharing a connection or removing a person cuts it off at once.</li>
  <li>Every call is logged, refused ones too.</li>
  <li>Limits per agent: 8 requests in flight, 1 MB per request, 60 seconds per request.</li>
  <li>Postgres calls run one SELECT each, in a read-only transaction, for at most 15 seconds and 1000 rows. Logins that are superusers, or can run programs or read files on the database server, are refused. The gateway won't connect to loopback, link-local or agent addresses.</li>
</ul>
<h2>People</h2>
<ul>
  <li>The first person with the installer's setup link becomes the owner. Then sign-up closes, and people join only by invite: one use, valid for 7 days.</li>
  <li>Passwords are hashed with scrypt.</li>
  <li>The control MCP takes only OAuth access tokens, never the session cookie, so another website can't drive it through your browser.</li>
</ul>
<h2>What it doesn't cover</h2>
<ul>
  <li>An agent that has been talked into it can still leak its own channel credentials, its own memories and the shared model key.</li>
  <li>Port 8787 is plain HTTP. Keep it private or put TLS in front of it.</li>
</ul>`,
  },
  {
    path: '/docs/uninstall',
    nav: 'Uninstall',
    title: 'Uninstall JakeBox',
    description: 'Remove JakeBox, its agents, its data and its firewall from your server.',
    body: `
<h1>Uninstall</h1>
<p class="lead">Run these as root. They delete every agent and all of JakeBox's data, and can't be undone.</p>
<h2>1. Stop JakeBox</h2>
<p>On a systemd server:</p>
<pre><code>systemctl disable --now jakebox.service jakebox-agentd.service
systemctl disable jakebox-firewall.service
rm /etc/systemd/system/jakebox*.service
systemctl daemon-reload</code></pre>
<p>Without systemd:</p>
<pre><code>pkill -f /opt/jakebox/install/supervise.sh
pkill -f '^node /opt/jakebox/packages/agentd/src/agentd.ts'
pkill -f '^node /opt/jakebox/packages/app/src/app.ts'</code></pre>
<h2>2. Remove the agents</h2>
<pre><code>docker ps -aq --filter label=jakebox.agent | xargs -r docker rm -f
docker network ls -q --filter label=jakebox.agent | xargs -r docker network rm
docker rmi "$(cat /opt/jakebox/install/agent-image)"</code></pre>
<p>The last line frees the agent image, about 3 GB. If you set <code>AGENT_IMAGE</code>, remove that image instead.</p>
<h2>3. Remove the firewall</h2>
<pre><code>iptables -D DOCKER-USER -s 10.200.0.0/16 -j AGENT
iptables -D INPUT -j AGENT-IN
iptables -F AGENT &amp;&amp; iptables -X AGENT
iptables -F AGENT-IN &amp;&amp; iptables -X AGENT-IN
ip rule del to 10.200.0.0/16 lookup main priority 5200</code></pre>
<h2>4. Remove the files</h2>
<pre><code>rm -rf /opt/jakebox /etc/jakebox /data/app /data/agents /data/agent-conf
rm -rf /etc/agentd /var/lib/jakebox /var/cache/jakebox /var/log/jakebox /var/log/jakebox-boot.log /run/jakebox /run/agentd
rmdir /data</code></pre>
<p>JakeBox keeps everything in <code>/data/app</code>, <code>/data/agents</code> and <code>/data/agent-conf</code>. <code>rmdir</code> removes <code>/data</code> only if nothing else is in it.</p>
<h2>5. Remove the user</h2>
<p>On Debian or Ubuntu, <code>userdel jakebox</code>. On Alpine, <code>deluser jakebox</code>.</p>
<h2>What stays</h2>
<p>Docker, gVisor (<code>runsc</code> in <code>/usr/local/bin</code> and its entry in <code>/etc/docker/daemon.json</code>) and Node stay installed, because other programs may use them. Remove them yourself if nothing else does.</p>`,
  },
]

function icon(paths: string) {
  return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
}

export type Page = { path: string, nav: string, title: string, description: string, body: string }
