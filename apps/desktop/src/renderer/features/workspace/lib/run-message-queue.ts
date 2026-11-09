import { store } from "@/lib/redux";
import { getTransport } from "@/lib/transport";
import { clearTransientUploads, getTransientUploadsForOwner } from "../hooks/use-transient-uploads";
import { serializeAttachments } from "./run-helpers";
import { createRunQueueController } from "./run-queue-controller";
import { transientDocumentFiles } from "./document-lifecycle";

export const runMessageQueue = createRunQueueController({
  getState: store.getState,
  dispatch: store.dispatch,
  getTransport,
  serializeUploads: async (ownerKey) => {
    const files = getTransientUploadsForOwner(ownerKey);
    const release = transientDocumentFiles.hold(files);
    try { return files.length ? await serializeAttachments(files) : undefined; }
    finally { release(); }
  },
  clearUploads: clearTransientUploads,
});
