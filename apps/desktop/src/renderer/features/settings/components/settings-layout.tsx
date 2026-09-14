import type { ReactNode } from "react";
import { Body, Caption, Heading3, Muted } from "@/components/ui";

export function SettingsPageShell({
  title,
  isLoading,
  error,
  loadingMessage = "Loading...",
  errorMessage,
  headerActions,
  className = "",
  children,
}: {
  title: string;
  isLoading?: boolean;
  error?: unknown;
  loadingMessage?: string;
  errorMessage?: string;
  headerActions?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const header = headerActions ? (
    <div className="flex items-center justify-between mb-8">
      <Heading3>{title}</Heading3>
      {headerActions}
    </div>
  ) : (
    <div className="mb-4">
      <Heading3>{title}</Heading3>
    </div>
  );

  let body: ReactNode;
  if (isLoading) {
    body = <Muted>{loadingMessage}</Muted>;
  } else if (error) {
    body = (
      <Muted>{errorMessage ?? `Unable to load ${title.toLowerCase()}.`}</Muted>
    );
  } else {
    body = children;
  }

  return (
    <div className={`bg-primary dark:bg-primary-950 ${className}`}>
      {header}
      {body}
    </div>
  );
}

export function PlaceholderSection({ title }: { title: string }) {
  return (
    <SettingsPageShell title={title}>
      <Muted>{title} settings will be available here.</Muted>
    </SettingsPageShell>
  );
}

export function SettingsSection({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      {title && (
        <Body className=" mb-3">
          {title}
        </Body>
      )}
      <div className="rounded-3xl glass-surface px-4 py-1">
        {children}
      </div>
    </div>
  );
}

export function SettingsRow({
  title,
  description,
  children,
  variant = "default",
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  variant?: "default" | "detail";
}) {
  if (variant === "detail") {
    // Stack on mobile — the fixed w-120 (480px) title block overflows narrow
    // screens; side-by-side only from md up.
    return (
      <div className="flex flex-col gap-3 py-5 md:flex-row md:items-start md:justify-between md:gap-8">
        <div className="md:w-120 md:shrink-0">
          <Body className=" mb-1">
            {title}
          </Body>
          {description && (
            <Caption className="mt-1">
              {description}
            </Caption>
          )}
        </div>
        <div className="flex md:flex-1 md:justify-end md:text-right">{children}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
      <div className="md:flex-1 md:pr-8">
        <Body className=" mb-1">
          {title}
        </Body>
        {description && (
          <Caption>
            {description}
          </Caption>
        )}
      </div>
      <div className="md:shrink-0">{children}</div>
    </div>
  );
}

export function SettingsDivider() {
  return (
    <div className="border-b border-primary-200/60 dark:border-primary-800/20" />
  );
}
