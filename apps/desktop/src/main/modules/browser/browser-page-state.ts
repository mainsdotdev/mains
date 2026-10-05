/** Session-only fallback for form/scroll state Chromium does not always serialize. */
export interface BrowserPageState {
  url: string;
  x: number;
  y: number;
  overflow?: boolean;
  fields: Array<{ selector: string; value: string; checked?: boolean; editable?: boolean }>;
}

export const CAPTURE_PAGE_STATE = `(() => {
  const fields = [];
  let chars = 0;
  const selector = (element) => {
    if (element.id) return '#' + CSS.escape(element.id);
    const path = [];
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      const siblings = [...node.parentElement.children].filter(sibling => sibling.tagName === node.tagName);
      path.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')');
    }
    return 'body > ' + path.join(' > ');
  };
  for (const element of document.querySelectorAll('input,textarea,select,[contenteditable="true"]')) {
    if (element.type === 'file' && element.value) return { overflow: true };
    if (['password', 'file', 'hidden', 'submit', 'button', 'reset'].includes(element.type)) continue;
    const editable = element.isContentEditable;
    const value = editable ? element.textContent : element.value;
    chars += value?.length ?? 0;
    if (chars > 512000 || fields.length >= 200) return { overflow: true };
    fields.push({ selector: selector(element), value: value ?? '',
      checked: element.type === 'checkbox' || element.type === 'radio' ? element.checked : undefined, editable });
  }
  return { url: location.href, x: scrollX, y: scrollY, fields };
})()`;

export function restorePageStateScript(state: BrowserPageState): string {
  return `(async () => {
    const state = ${JSON.stringify(state)};
    if (location.href !== state.url) return false;
    // A client-rendered form may appear shortly after did-finish-load.
    for (let attempt = 0; attempt < 10; attempt++) {
      if (state.fields.every(field => document.querySelector(field.selector))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    let restored = true;
    for (const field of state.fields) {
      const element = document.querySelector(field.selector);
      if (!element || ['password', 'file', 'hidden'].includes(element.type)) { restored = false; continue; }
      if (field.editable) element.textContent = field.value;
      else {
        // Use the native setter so controlled React fields observe the change.
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value');
        if (descriptor?.set) descriptor.set.call(element, field.value);
        else element.value = field.value;
        if (field.checked !== undefined) {
          const checked = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'checked');
          if (checked?.set) checked.set.call(element, field.checked);
          else element.checked = field.checked;
        }
      }
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await new Promise(resolve => setTimeout(resolve, 0));
    window.scrollTo(state.x, state.y);
    return restored;
  })()`;
}
