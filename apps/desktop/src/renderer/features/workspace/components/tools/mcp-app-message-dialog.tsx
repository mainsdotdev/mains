import { useId, useRef, useState } from "react";
import { Body, Button, Caption, Modal, ModalHeader, Muted, Textarea } from "@/components/ui";
import type { McpAppMessagePreview } from "../../hooks/use-mcp-app-message-preview";

export function McpAppMessageDialog({ appName, preview, onCancel, onSend }: {
  appName: string;
  preview: McpAppMessagePreview;
  onCancel: () => void;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState(preview.text);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const descriptionId = useId();
  const canSend = Boolean(text.trim()) && text.trim().length <= 32_000;

  return (
    <Modal isOpen onClose={onCancel} initialFocusRef={inputRef} aria-describedby={descriptionId}
      className="w-full max-w-xl rounded-3xl p-3">
      <ModalHeader onClose={onCancel} closeLabel="Cancel app prompt">
        <Body as="h2" weight="medium">Send prompt?</Body>
      </ModalHeader>
      <div className="flex min-h-0 flex-col gap-4 px-4 pb-4">
        <Muted id={descriptionId} className="text-sm">
          {appName} wants to send this prompt. You can edit it before sending.
        </Muted>
        <Textarea ref={inputRef} aria-label="App prompt" value={text} rows={4}
          className="max-h-[40vh] min-h-28 resize-y rounded-2xl"
          onChange={(event) => setText(event.target.value)} />
        {preview.newConversation && <Caption>This will start a new chat.</Caption>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="primary" onClick={onCancel}>Cancel</Button>
          <Button variant="submit" disabled={!canSend} onClick={() => onSend(text)}>Send</Button>
        </div>
      </div>
    </Modal>
  );
}
