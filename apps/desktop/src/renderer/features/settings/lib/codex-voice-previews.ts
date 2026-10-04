import arbor from "../assets/voice-previews/arbor.en.wav";
import breeze from "../assets/voice-previews/breeze.en.wav";
import cove from "../assets/voice-previews/cove.en.wav";
import ember from "../assets/voice-previews/ember.en.wav";
import juniper from "../assets/voice-previews/juniper.en.wav";
import maple from "../assets/voice-previews/maple.en.wav";
import sol from "../assets/voice-previews/sol.en.wav";
import spruce from "../assets/voice-previews/spruce.en.wav";
import vale from "../assets/voice-previews/vale.en.wav";

const previews: Record<string, string | undefined> = {
  arbor, breeze, cove, ember, juniper, maple, sol, spruce, vale,
};

export function voicePreviewUrl(voice: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(previews, voice) ? previews[voice] : undefined;
}
