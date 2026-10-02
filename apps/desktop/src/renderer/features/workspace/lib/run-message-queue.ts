import { store } from "@/lib/redux";
import { getTransport } from "@/lib/transport";
import { clearTransientUploads, getTransientUploadsForOwner } from "../hooks/use-transient-uploads";
import { serializeAttachments } from "./run-helpers";
import { createRunQueueController } from "./run-queue-controller";

export const runMessageQueue = createRunQueueController({
  getState: store.getState,
  dispatch: store.dispatch,
  getTransport,
  serializeUploads: async (ownerKey) => {
    const files = getTransientUploadsForOwner(ownerKey);
    return files.length ? serializeAttachments(files) : undefined;
  },
  clearUploads: clearTransientUploads,
});
