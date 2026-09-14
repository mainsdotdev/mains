import { Component, ReactNode, useId, useState } from "react";
import Text, { Body, Caption, Heading2 } from "./text";
import { Button } from "./button";

interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
  level: "app" | "route";
}

/**
 * The one-line identifier under the explanation — the thing a user reads out
 * or pastes into a bug report. The stack stays behind "Learn more"; this is
 * only what the error calls itself.
 */
function errorSummary(error: Error): string {
  const firstLine = error.message.split("\n")[0]?.trim();
  return [error.name, firstLine].filter(Boolean).join(": ");
}

function ErrorFallback({ error, resetError, level }: ErrorFallbackProps) {
  const [showDetails, setShowDetails] = useState(false);
  const detailsId = useId();

  const isApp = level === "app";
  const handleReload = () => {
    window.location.reload();
  };

  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      {/* Centered block, left-aligned text: the reader scans one edge, and the
          buttons sit under the sentence that explains them. */}
      <div className="w-full max-w-md">
        <Heading2 weight="semibold">Something’s not right</Heading2>

        <Body className="mt-3">
          {isApp
            ? "Mains ran into an error while loading this screen. Reloading usually clears it."
            : "Mains ran into an error while loading this section. You can try again, or move to another screen."}
        </Body>

        <Caption as="p" className="mt-1.5 wrap-break-word">
          {errorSummary(error)}
        </Caption>

        <div className="mt-5 flex gap-2">
          <Button
          className="glass-outline"
            variant="ghost"
            onClick={() => setShowDetails((shown) => !shown)}
            aria-expanded={showDetails}
            aria-controls={detailsId}
          >
            {showDetails ? "Hide details" : "Learn more"}
          </Button>
          <Button variant="submit" onClick={isApp ? handleReload : resetError}>
            {isApp ? "Reload" : "Try again"}
          </Button>
        </div>

        {showDetails && (
          <Text
            as="pre"
            id={detailsId}
            size="xs"
            tone="subtle"
            className="mt-4 max-h-64 overflow-auto rounded-xl glass-outline bg-primary-100 dark:bg-primary-900 p-3 whitespace-pre-wrap select-text"
          >
            {error.stack || error.message}
          </Text>
        )}
      </div>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  level?: "app" | "route";
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error(
      `[ErrorBoundary:${this.props.level ?? "app"}]`,
      error,
      info.componentStack,
    );
  }

  resetError = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <ErrorFallback
          error={this.state.error}
          resetError={this.resetError}
          level={this.props.level ?? "app"}
        />
      );
    }

    return this.props.children;
  }
}
