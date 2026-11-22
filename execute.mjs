// picode-tools/1 executor for cognix-games.
// Reads the broker-authenticated request on stdin and forwards it over loopback
// to the single background process writer announced in <dataDir>/process.json.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:http";

const sayErr = (text) => process.stdout.write(JSON.stringify({ content: [{ type: "text", text }], isError: true }));
const AWAY = "Games Arena's background process is starting up. Try again in a moment; nothing was changed.";

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let req;
try {
  req = JSON.parse(raw);
} catch {
  sayErr("Unparseable tool request.");
  process.exit(0);
}

const dataDir = req?.context?.dataDir;
if (!dataDir) {
  sayErr("Missing dataDir in extension caller context.");
  process.exit(0);
}

let door;
try {
  door = JSON.parse(readFileSync(join(dataDir, "process.json"), "utf8"));
} catch {
  sayErr(AWAY);
  process.exit(0);
}
if (!Number.isInteger(door?.port) || !door?.key) {
  sayErr(AWAY);
  process.exit(0);
}
try {
  process.kill(door.pid, 0);
} catch (err) {
  if (err.code === "ESRCH") {
    sayErr(AWAY);
    process.exit(0);
  }
}

const body = JSON.stringify(req);
const resp = await new Promise((resolve) => {
  const r = request({
    host: "127.0.0.1",
    port: door.port,
    path: "/tool",
    method: "POST",
    timeout: 25000,
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      "x-games-tool-key": door.key
    }
  }, (res) => {
    let data = "";
    res.setEncoding("utf8");
    res.on("data", (c) => { data += c; });
    res.on("end", () => resolve({ status: res.statusCode, data }));
  });
  r.on("timeout", () => r.destroy(Object.assign(new Error("timeout"), { code: "TIMEOUT" })));
  r.on("error", (e) => resolve(e.code === "ECONNREFUSED" ? {} : { lost: true }));
  r.end(body);
});

if (resp.lost) {
  sayErr("Games Arena did not answer in time; call state before retrying your move.");
} else if (!resp.data && resp.status === undefined) {
  sayErr(AWAY);
} else {
  let parsed = null;
  try { parsed = JSON.parse(resp.data); } catch { /* handled below */ }
  if (parsed && Array.isArray(parsed.content)) {
    process.stdout.write(JSON.stringify(parsed));
  } else {
    sayErr(parsed?.error || AWAY);
  }
}
