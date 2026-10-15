import { createContext, useContext } from "react";

/** Scoped to a replica transcript, independent of the client's remote-control connection. */
export const ReplicaViewContext = createContext<{ label: string; online: boolean | null } | null>(null);
export function useReplicaView() { return useContext(ReplicaViewContext); }
