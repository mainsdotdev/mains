import { useRef, useState, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { prAttachmentId, prAttachmentUrl } from "@mains/contracts/pr-attachments";
import { Button, Text } from "@/components/ui";
import { Close } from "@/components/ui/icons";
import { markdownComponents } from "@/components/markdown-components";
import type { PrMediaAsset } from "../../../hooks/use-pr-attachments";

const schema = {
  ...defaultSchema,
  attributes: { ...defaultSchema.attributes, img: [...(defaultSchema.attributes?.img ?? []), "width", "height"] },
  protocols: { ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), "mains-pr-attachment"],
    href: [...(defaultSchema.protocols?.href ?? []), "mains-pr-attachment"],
  },
};

export function PrDescriptionPreview({ value, assets }: { value: string; assets: PrMediaAsset[] }) {
  const [opened, setOpened] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const assetFor = (url: string | undefined) => assets.find((asset) => asset.id === prAttachmentId(url));
  const media = (asset: PrMediaAsset, alt = asset.file.name, width?: string | number, height?: string | number) => (
    asset.type.startsWith("image/")
      ? <img data-pr-media-id={asset.id} src={asset.url} alt={alt} width={width} height={height} className="h-auto max-w-full rounded-lg object-contain" />
      : <video data-pr-media-id={asset.id} src={asset.url} aria-label={alt} controls preload="metadata" className="max-h-72 max-w-full rounded-lg" />
  );
  const components: Components = {
    ...markdownComponents,
    img: ({ src, alt, width, height }) => {
      const asset = assetFor(src);
      if (asset) return media(asset, alt, width, height);
      if (prAttachmentId(src)) return <Text as="span" size="xs" tone="subtle">Missing attachment: {alt}</Text>;
      return <img src={src} alt={alt ?? ""} width={width} height={height} loading="lazy" className="h-auto max-w-full rounded-lg object-contain" />;
    },
    a: ({ href, children }: { href?: string; children?: ReactNode }) => {
      const asset = assetFor(href);
      if (asset) return <a href={asset.url} className="text-accent hover:underline"
        onClick={(event) => {
          event.preventDefault();
          const existing = contentRef.current?.querySelector<HTMLElement>(`[data-pr-media-id="${asset.id}"]`);
          if (existing) { existing.scrollIntoView?.({ block: "nearest" }); existing.focus(); }
          else setOpened(asset.id);
        }}>{children}</a>;
      if (prAttachmentId(href)) return <Text as="span" tone="subtle">{children} (missing attachment)</Text>;
      return <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline"
        onClick={(event) => { if (href && window.api?.shell) { event.preventDefault(); void window.api.shell.openExternal(href); } }}>{children}</a>;
    },
  };
  const active = assets.find((asset) => asset.id === opened);
  return <div ref={contentRef}>
    {value ? <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
      urlTransform={(url) => prAttachmentId(url) ? url : defaultUrlTransform(url)} components={components}>{value}</ReactMarkdown>
      : <Text size="xs" tone="subtle">Nothing to preview yet.</Text>}
    {active && <figure aria-label={`Preview ${active.file.name}`} className="relative mt-4 rounded-lg border border-primary-200 p-3 dark:border-primary-800">
      <Button variant="icon" iconSize="xs" aria-label="Close media preview" className="absolute top-1 right-1" onClick={() => setOpened(null)}><Close /></Button>
      {media(active)}
    </figure>}
    {assets.filter((asset) => !value.includes(prAttachmentUrl(asset.id))).map((asset) => <figure key={asset.id} className="mt-4">
      {media(asset)}<figcaption className="mt-1 text-xs text-primary-500">{asset.file.name}</figcaption>
    </figure>)}
  </div>;
}
