import type { SVGProps } from "react";

type MarkProps = SVGProps<SVGSVGElement>;

function FigmaMark(props: MarkProps) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...props}>
    <path d="M12 2H8.67a3.33 3.33 0 0 0 0 6.67H12V2Zm0 0h3.33a3.33 3.33 0 0 1 0 6.67H12V2Zm0 6.67H8.67a3.33 3.33 0 0 0 0 6.66H12V8.67Zm0 6.66H8.67a3.33 3.33 0 1 0 3.33 3.34v-3.34Z" />
    <circle cx="15.33" cy="12" r="3.33" />
  </svg>;
}

function CanvaMark(props: MarkProps) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path fillRule="evenodd" d="M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21Zm3.54 4.81c-1.41-.51-2.98-.09-4.21.9-1.65 1.36-2.52 3.36-2.87 5.6-.45 2.98.65 4.91 2.85 4.91 1.54 0 2.86-.74 3.99-2.22l-.77-.6c-.93 1.14-1.85 1.69-2.72 1.69-1.12 0-1.7-1.16-1.48-3.2.2-1.95.89-3.99 1.83-5.23.5-.64.99-.98 1.51-.98.73 0 .97.64.75 1.86l1.8-.35c.45-1.09.2-1.91-.68-2.38Z" clipRule="evenodd" />
  </svg>;
}

function TldrawMark(props: MarkProps) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <circle cx="12" cy="5.5" r="2.5" />
    <path d="M12 11c-1.66 0-3 1.34-3 3 0 1.49 1.08 2.72 2.5 2.96-.34 1.21-1.13 2.44-2.5 3.66L10.7 22c3.06-2.3 4.3-4.93 4.3-7.9 0-1.79-1.24-3.1-3-3.1Z" />
  </svg>;
}

function ShopifyMark(props: MarkProps) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path fillRule="evenodd" clipRule="evenodd" d="m18.25 6.33 2.2 1.13 1.3 13.78-5.7 1.26-13.8-2.8L4.2 7.03l3.35-.95C8.25 2.83 9.93 1.5 11.54 1.5c1.01 0 1.82.54 2.41 1.49.94.02 1.72.82 2.2 2.36l1.63-.46.47 1.44Zm-9.46-.72 2.27-.64c.15-1.14.55-2.1 1.17-2.72a1.43 1.43 0 0 0-.73-.2c-1.06 0-2.08 1.13-2.71 3.56Zm3.47-.98 2.68-.77c-.25-.62-.57-.98-.93-1.13-.49.4-.85 1.04-1.07 1.9h-.68ZM10.53 8.72c-2.4 0-4.12 1.4-4.12 3.46 0 2.55 3.55 2.51 3.55 3.91 0 .49-.39.8-.98.8-.8 0-1.69-.45-2.28-.88l-.59 2.45c.66.48 1.74.8 2.9.8 2.42 0 3.9-1.4 3.9-3.56 0-2.81-3.53-2.7-3.53-3.94 0-.43.29-.74.92-.74.56 0 1.24.2 1.76.45l.67-2.4a5.51 5.51 0 0 0-2.2-.35Z" />
  </svg>;
}

// Brand artwork only: this lookup never determines which plugins enter the rail.
// These catalog logos include opaque backgrounds or need an outline treatment.
export function mcpAppRailMark(tool: string | undefined, props: MarkProps) {
  switch (tool?.split(".", 1)[0]) {
    case "figma": return <FigmaMark {...props} />;
    case "canva": return <CanvaMark {...props} />;
    case "tldraw": return <TldrawMark {...props} />;
    case "shopify": return <ShopifyMark {...props} />;
    default: return null;
  }
}
