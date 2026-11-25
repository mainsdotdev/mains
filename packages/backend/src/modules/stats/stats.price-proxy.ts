import { globalAgent } from "node:https";
import { EnvHttpProxyAgent, Pool } from "undici";

/** Use the host's proxy settings and let the price cache schedule retries. */
export function createPriceProxy(): EnvHttpProxyAgent | undefined {
  const { proxyEnv } = globalAgent.options as { proxyEnv?: NodeJS.ProcessEnv };
  const env = proxyEnv ?? (process.env.NODE_USE_ENV_PROXY === "1" ? process.env : undefined);
  if (!env) return undefined;
  const httpProxy = env.http_proxy ?? env.HTTP_PROXY ?? "";
  const httpsProxy = env.https_proxy ?? env.HTTPS_PROXY ?? httpProxy;
  if (!httpsProxy && !httpProxy) return undefined;

  return new EnvHttpProxyAgent({
    httpProxy,
    httpsProxy,
    noProxy: env.no_proxy ?? env.NO_PROXY ?? "",
    factory(origin, poolOptions) {
      const options = poolOptions as Pool.Options;
      const connect = options.connect;
      if (typeof connect !== "function") return new Pool(origin, options);
      return new Pool(origin, {
        ...options,
        connect(target, done) {
          connect(target, (error, socket) => {
            // Undici can requeue the pending GET immediately when CONNECT
            // reports UND_ERR_SOCKET. Finish this refresh on a failed tunnel.
            if (error) done(Object.assign(new Error("Price feed connection failed"), { cause: error }), null);
            else done(null, socket);
          });
        },
      });
    },
  });
}
