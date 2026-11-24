import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { request, type RequestOptions } from "node:https";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";

/** Isolated trust anchor covering the test host. Never installed in the system keychain. */
export function createTestTls() {
  const dir = mkdtempSync(join(tmpdir(), "mains-connect-tls-"));
  const certFile = join(dir, "cert.pem"), keyFile = join(dir, "key.pem");
  const dispose = () => rmSync(dir, { recursive: true, force: true });
  try {
    const ips = new Set(["127.0.0.1", "::1"]);
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) if (entry.family === "IPv4") ips.add(entry.address);
    }
    const names = ["DNS:localhost", ...Array.from(ips, ip => "IP:" + ip)];
    const config = join(dir, "openssl.cnf");
    writeFileSync(config, ["[req]", "distinguished_name=dn", "prompt=no", "x509_extensions=ext",
      "[dn]", "CN=localhost", "[ext]", "subjectAltName=" + names.join(",")].join("\n"));
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
      "-config", config, "-out", certFile, "-keyout", keyFile], { stdio: "pipe" });
    return { certFile, keyFile, cert: readFileSync(certFile), key: readFileSync(keyFile), dispose };
  } catch (error) { dispose(); throw error; }
}

export function requestTls(url: string, ca: Buffer, options: RequestOptions = {}) {
  return new Promise<{status: number | undefined; body: string; cookies: string[]}>((resolve, reject) => {
    const req = request(url, { ...options, ca }, res => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.once("error", reject);
      res.once("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), cookies: res.headers["set-cookie"] ?? [] }));
    });
    req.once("error", reject);
    req.end();
  });
}
