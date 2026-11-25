import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { VisualizationCommand, VisualizationControls, VisualizationDesignControl, VisualizationValue } from "@mains/contracts/visualization";
import { Button, Input, Select, Slider, Text, Toggle } from "@/components/ui";
import { ChevronLeft, Close, Settings } from "@/components/ui/icons";
import { useOverlayLifecycle } from "@/hooks/use-overlay-lifecycle";
import { restoreOverlayFocus } from "@/lib/overlay-lifecycle";
import { visualizationDesignPrompt, visualizationEdits } from "@/features/workspace/lib/visualization-controls";
import { requestVisualizationFollowUp } from "@/features/workspace/lib/visualization-bridge";

function ColorControl({ control, onChange }: { control: VisualizationDesignControl & { type: "color" }; onChange: (value: string) => void }) {
  const [draft, setDraft] = useState({ source: control.value, text: control.value });
  if (draft.source !== control.value) setDraft({ source: control.value, text: control.value });
  const hex = control.value.slice(1);
  const swatch = `#${hex.length < 5 ? hex.slice(0, 3).split("").map((part) => part + part).join("") : hex.slice(0, 6)}`;
  const alpha = hex.length === 4 ? hex[3] + hex[3] : hex.length === 8 ? hex.slice(6) : "";
  return <div className="flex items-center gap-2">
    <Input type="color" aria-label={`${control.label} — color picker`} value={swatch}
      onChange={(event) => onChange(event.target.value + alpha)} className="h-8 w-10 shrink-0 p-1" />
    <Input aria-label={control.label} value={draft.text} spellCheck={false} onBlur={() => setDraft({ source: control.value, text: control.value })}
      onChange={(event) => {
        const value = event.target.value;
        setDraft({ source: control.value, text: value });
        if (/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) onChange(value);
      }} />
  </div>;
}

function DesignControl({ control, onChange, onSelectOpen }: {
  control: VisualizationDesignControl; onChange: (value: VisualizationValue) => void; onSelectOpen: (open: boolean) => void;
}) {
  if (control.type === "range") return <div className="space-y-2">
    <Text as="div" size="xs" weight="medium">{control.label}</Text>
    <Slider label={control.label} value={control.value} min={control.min} max={control.max}
      step={control.step} onChange={onChange} formatValue={(value) => `${value}${control.unit ? ` ${control.unit}` : ""}`} />
  </div>;
  if (control.type === "toggle") return <Toggle label={control.label} enabled={control.value} onChange={onChange} />;
  return <div className="space-y-2">
    <Text as="div" size="xs" weight="medium">{control.label}</Text>
    {control.type === "select"
      ? <Select aria-label={control.label} size="sm" value={control.value} options={control.options} onChange={onChange} onOpenChange={onSelectOpen} />
      : <ColorControl control={control} onChange={onChange} />}
  </div>;
}

export function VisualizationControlsView({ controls, absPath, sendCommand, frameRef }: {
  controls: VisualizationControls; absPath: string; sendCommand: (command: VisualizationCommand) => void;
  frameRef: RefObject<HTMLIFrameElement | null>;
}) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const openSelects = useRef(new Set<string>());
  const previewHeld = useRef(false);
  const id = useId();
  const groups = controls.groups.filter((group) => group.visible && group.controls.length);
  const edits = visualizationEdits(controls);
  const [error, setError] = useState(false);
  const [position, setPosition] = useState({ top: 12, left: 12, width: 320, maxHeight: 420 });
  const overlay = useOverlayLifecycle({ frames: 1, disabled: !groups.length });
  const { isVisible, isAnimatedIn, open, close, frame } = overlay;
  const tr = controls.language === "tr";
  const words = tr ? {
    settings: "Tasarım ayarları", close: "Kapat", pick: "Varyant seç", reset: "Sıfırla", original: "Orijinali önizle",
    hold: "Orijinali görmek için basılı tutun", add: "Sohbete aktar", edits: "Değişiklik", error: "Değişiklikler mesaj sınırını aşıyor. Daha az değişiklik seçin.",
  } : {
    settings: "Design settings", close: "Close", pick: "Choose a variant", reset: "Reset", original: "Preview original",
    hold: "Press and hold to preview the original", add: "Add to chat", edits: "Edits", error: "These changes exceed the message limit. Select fewer changes.",
  };

  const endPreview = useCallback(() => {
    if (!previewHeld.current) return;
    previewHeld.current = false;
    sendCommand({ type: "preview-original", active: false });
  }, [sendCommand]);

  const dismiss = useCallback((returnFocus = false) => {
    endPreview();
    if (returnFocus) restoreOverlayFocus(triggerRef.current, panelRef.current);
    close();
  }, [close, endPreview]);

  useEffect(() => {
    const pointerUp = () => endPreview();
    const blur = () => { endPreview(); if (document.activeElement === frameRef.current) dismiss(); };
    window.addEventListener("pointerup", pointerUp);
    window.addEventListener("pointercancel", pointerUp);
    window.addEventListener("blur", blur);
    return () => {
      endPreview();
      window.removeEventListener("pointerup", pointerUp);
      window.removeEventListener("pointercancel", pointerUp);
      window.removeEventListener("blur", blur);
    };
  }, [dismiss, endPreview, frameRef]);

  useEffect(() => {
    if (!isVisible) return undefined;
    const outside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (panelRef.current?.contains(target) || toolbarRef.current?.contains(target)) return;
      if (openSelects.current.size && target.closest('[data-dropdown-portal="true"]')) return;
      dismiss();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || openSelects.current.size) return;
      event.preventDefault(); dismiss(true);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", key); };
  }, [isVisible, dismiss]);

  useLayoutEffect(() => {
    if (!isVisible) return undefined;
    const measure = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const width = Math.min(320, window.innerWidth - 24);
      const maxHeight = Math.min(420, window.innerHeight - 24);
      const height = Math.min(panel.scrollHeight, maxHeight);
      setPosition({ width, maxHeight, left: Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12)),
        top: Math.max(12, anchor.top - height - 8) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (panelRef.current) observer.observe(panelRef.current);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const cancelFocus = frame(() => closeRef.current?.focus());
    return () => { cancelFocus(); observer.disconnect(); window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); };
  }, [isVisible, frame]);

  if (!controls.carousels.length && !groups.length) return null;
  return <div ref={toolbarRef} className="relative flex min-h-12 w-full items-center justify-center gap-2 px-10 py-2">
    <div className="flex min-w-0 flex-col gap-2">
      {controls.carousels.map((carousel) => {
        const selected = carousel.variants.findIndex((variant) => variant.id === carousel.selectedId);
        const select = (variantId: string) => { endPreview(); sendCommand({ type: "select-variant", carouselId: carousel.id, variantId }); };
        return <div key={carousel.id} role="group" aria-label={carousel.label} className="min-w-0">
          {controls.carousels.length > 1 && <Text as="div" size="xs" tone="muted" className="mb-1 text-center">{carousel.label}</Text>}
          <div className="flex min-w-0 items-center justify-center gap-1">
            <Button variant="icon" aria-label={carousel.previousLabel} disabled={selected <= 0} onClick={() => select(carousel.variants[selected - 1].id)}><ChevronLeft /></Button>
            <div className="w-44 min-w-0 max-w-full">
              <Select aria-label={words.pick} size="sm" value={carousel.selectedId} onChange={select}
                options={carousel.variants.map((variant, i) => ({ value: variant.id, label: variant.label,
                  selectedLabel: `${i + 1} / ${carousel.variants.length} ${variant.label}` }))} />
            </div>
            <Button variant="icon" aria-label={carousel.nextLabel} disabled={selected >= carousel.variants.length - 1}
              onClick={() => select(carousel.variants[selected + 1].id)}><ChevronLeft className="rotate-180" /></Button>
          </div>
        </div>;
      })}
    </div>
    {groups.length > 0 && <Button ref={triggerRef} variant="icon" aria-label={words.settings} aria-expanded={isVisible} aria-controls={id}
      className="absolute right-1 top-2" onClick={() => { setError(false); if (isVisible) dismiss(); else open(); }}><Settings /></Button>}
    {isVisible && createPortal(<div ref={panelRef} id={id} role="dialog" aria-label={words.settings}
      className={`fixed z-(--z-dropdown) flex flex-col overflow-hidden rounded-2xl glass-card bg-primary-50 text-primary-900 shadow-xl transition-[opacity,transform] duration-150 motion-reduce:transition-none dark:bg-primary-950 dark:text-primary-100 ${isAnimatedIn ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}
      style={position}>
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-primary-950/10 px-3 py-2 dark:border-primary/10">
        <Text size="s" weight="medium">{words.settings}</Text>
        <Button ref={closeRef} variant="icon" aria-label={words.close} onClick={() => dismiss(true)}><Close /></Button>
      </div>
      <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain p-3">
        {groups.map((group) => <fieldset key={group.id} className="min-w-0 space-y-3">
          <Text as="legend" size="xs" weight="medium" className="mb-3">{group.label}</Text>
          {group.controls.map((control) => <DesignControl key={control.id} control={control}
            onChange={(value) => { setError(false); endPreview(); sendCommand({ type: "set-control", groupId: group.id, controlId: control.id, value }); }}
            onSelectOpen={(active) => { if (active) openSelects.current.add(control.id); else openSelects.current.delete(control.id); }} />)}
        </fieldset>)}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-primary-950/10 p-3 dark:border-primary/10">
        <Text as="div" size="xs" tone={error ? "danger" : "muted"} role="status" className="w-full">{error ? words.error : `${words.edits}: ${edits.length}`}</Text>
        <Button variant="ghost" disabled={!edits.length} aria-pressed={controls.previewing} title={words.hold}
          onPointerDown={() => { previewHeld.current = true; sendCommand({ type: "preview-original", active: true }); }}
          onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); previewHeld.current = true; sendCommand({ type: "preview-original", active: true }); } }}
          onKeyUp={endPreview} onBlur={endPreview}
          onClick={(event) => { if (!event.detail) { previewHeld.current = !previewHeld.current; sendCommand({ type: "preview-original", active: previewHeld.current }); } }}>{words.original}</Button>
        <Button variant="ghost" disabled={!edits.length} onClick={() => { endPreview(); setError(false); sendCommand({ type: "reset" }); }}>{words.reset}</Button>
        <Button variant="primary" disabled={!edits.length} className="ml-auto" onClick={() => {
          endPreview();
          const prompt = visualizationDesignPrompt(absPath, controls);
          if (!prompt) { setError(true); return; }
          requestVisualizationFollowUp({ prompt, title: words.settings });
          dismiss(true);
        }}>{words.add}</Button>
      </div>
    </div>, document.body)}
  </div>;
}
