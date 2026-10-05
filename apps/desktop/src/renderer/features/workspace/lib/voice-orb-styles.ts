import type { VoiceOrbStyle } from "@mains/contracts/realtime";

export const VOICE_ORB_STYLES: Array<{ value: VoiceOrbStyle; label: string }> = [
  { value: "cloud", label: "Cloud" },
  { value: "sphere", label: "Sphere" },
  { value: "aurora", label: "Aurora" },
];

export function resolveVoiceOrbStyle(value?: string): VoiceOrbStyle {
  return VOICE_ORB_STYLES.find((style) => style.value === value)?.value ?? "cloud";
}
