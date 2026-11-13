// Plays get.jakebox.dev locally: "/" is the installer, everything else is a file in DIR (default dist/).
// node dev/serve.ts [PORT] [DIR]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
const port = Number(process.argv[2] ?? 8099), dir = process.argv[3] ?? "dist";
createServer(async (req, res) => {
  const name = req.url === "/" ? "install.sh" : (req.url ?? "").replace(/^\/+/, "");
  if (!/^[\w.-]+$/.test(name)) return res.writeHead(404).end();
  const body = await readFile(`${dir}/${name}`).catch(() => null);
  body ? res.writeHead(200).end(body) : res.writeHead(404).end();
}).listen(port, "127.0.0.1", () => console.log(`serving ${dir}/ on :${port}`));
