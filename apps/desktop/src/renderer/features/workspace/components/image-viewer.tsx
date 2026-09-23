import { useEffect, useState } from "react";
import { Text } from "@/components/ui";
import { signLocalImage } from "@/lib/local-image-url";

interface ImageViewerProps {
  filePath: string;
  name: string;
  className?: string;
}

export function ImageViewer({ filePath, name, className = "" }: ImageViewerProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    signLocalImage(filePath).then((url) => {
      if (cancelled) return;
      if (url) setSrc(url);
      else setError(true);
    });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (error) {
    return (
      <div className={`flex h-full items-center justify-center ${className}`}>
        <Text size="s" tone="subtle">Could not load image.</Text>
      </div>
    );
  }

  return (
    <div className={`flex h-full min-h-0 w-full overflow-auto p-6 ${className}`}>
      {src ? (
        <img
          src={src}
          alt={name}
          className="m-auto max-h-full max-w-full object-contain"
          onError={() => setError(true)}
        />
      ) : (
        <Text size="xs" tone="subtle" className="m-auto">Loading image...</Text>
      )}
    </div>
  );
}
