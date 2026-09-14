import { Body, Heading1, Text } from "@/components/ui";
import { MainsColor } from "@/components/ui/icons";

/** Full-screen welcome hero shown as the first onboarding step. */
export function WelcomeIntroStep() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
        <MainsColor className=" size-24 " />
      <Text
        as="span"
        size="xs"
        tone="secondary"
        weight="medium"
        className="mt-8 uppercase tracking-widest"
      >
        v{__APP_VERSION__ ?? "1.0"}
      </Text>
      <Heading1 className="mt-3 font-mono tracking-tight">
        Welcome to Mains
      </Heading1>
      <Body className="mt-3 max-w-md">
        Your AI-powered workspace. Let&apos;s get you set up.
      </Body>
    </div>
  );
}
