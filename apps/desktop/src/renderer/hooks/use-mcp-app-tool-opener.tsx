import { createContext, useContext, type ReactNode } from "react";
import type { McpAppToolOpen } from "@mains/contracts/mcp-apps";

type McpAppToolOpener = (result: McpAppToolOpen, automatic?: boolean) => void;
const Context = createContext<McpAppToolOpener | null>(null);

/** Separate renderers can route to the main panel without hosting an app document. */
export function McpAppToolOpenerProvider({ openTool, children }: {
  openTool: McpAppToolOpener; children?: ReactNode;
}) {
  return <Context.Provider value={openTool}>{children}</Context.Provider>;
}

export function useMcpAppToolOpener() { return useContext(Context); }
