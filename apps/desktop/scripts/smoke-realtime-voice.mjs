#!/usr/bin/env node
/* global AudioContext, RTCPeerConnection, Audio, Voice, document, window */
// Exercise the actual controller, Web Audio meter and orb over local WebRTC.
// Uses fake capture, an isolated Electron profile and no provider connection.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const appRoot = path.resolve(import.meta.dirname, "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mains-voice-smoke-"));

async function probe() {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const capture = await navigator.mediaDevices.getUserMedia({ audio: true });
  const producer = new AudioContext();
  await producer.resume();
  const oscillator = producer.createOscillator();
  const gain = producer.createGain();
  const destination = producer.createMediaStreamDestination();
  oscillator.frequency.value = 330;
  gain.gain.value = 0;
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  const remote = new RTCPeerConnection();
  remote.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
  let listener;
  let analysis;
  const controller = Voice.createRealtimeVoiceController({
    api: () => ({
      subscribe(callback) { listener = callback; return () => { listener = undefined; }; },
      async stop() { return { success: true }; },
      async start(payload) {
        await remote.setRemoteDescription({ type: "offer", sdp: payload.sdp });
        await remote.setLocalDescription(await remote.createAnswer());
        if (remote.iceGatheringState !== "complete") {
          await new Promise((resolve) => {
            remote.onicegatheringstatechange = () => { if (remote.iceGatheringState === "complete") resolve(); };
          });
        }
        listener({ ...payload, type: "started", sessionId: null });
        listener({ ...payload, type: "sdp", sdp: remote.localDescription.sdp });
        return { success: true };
      },
    }),
    getUserMedia: () => Promise.resolve(capture),
    createPeer: () => new RTCPeerConnection(),
    createAudio: () => new Audio(),
    createAudioMeter: () => Voice.createRealtimeVoiceAudioMeter(() => {
      analysis = new AudioContext({ latencyHint: "interactive" });
      return analysis;
    }),
    createId: () => "local-smoke",
    timeoutMs: 10_000,
  });
  const root = Voice.createRoot(document.getElementById("root"));
  try {
    await controller.start({ runId: "local", accountId: "local", label: "Local audio test" });
    const deadline = performance.now() + 5000;
    while (controller.getSnapshot().phase === "connecting" && performance.now() < deadline) await wait(25);
    assert(controller.getSnapshot().phase === "connected", `RTC failed: ${controller.getSnapshot().error}`);
    assert(analysis.state === "running", `Audio analysis is ${analysis.state}`);
    controller.toggleMute();
    // Offscreen testing does not need OS animation preferences or a visible UI.
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    const nativeMatchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => query.includes("prefers-reduced-motion")
      ? { matches: false, addEventListener() {}, removeEventListener() {} }
      : nativeMatchMedia(query);
    root.render(Voice.createElement(Voice.VoiceOrb, { active: true, getAudioLevels: controller.getAudioLevels }));
    await wait(200);
    const canvas = document.querySelector("canvas");
    assert(canvas?.style.opacity === "1", "The orb did not draw");
    const gl = canvas.getContext("webgl");
    const program = gl.getParameter(gl.CURRENT_PROGRAM);
    const flowUniform = gl.getUniformLocation(program, "u_flow");
    const voiceUniform = gl.getUniformLocation(program, "u_voice");
    const sample = async (amplitude, settleMs = 450) => {
      gain.gain.value = amplitude;
      await wait(settleMs);
      const start = performance.now();
      const flowBefore = gl.getUniform(program, flowUniform);
      await wait(350);
      return { amplitude, output: gl.getUniform(program, voiceUniform)[1],
        speed: (gl.getUniform(program, flowUniform) - flowBefore) / ((performance.now() - start) / 1000) };
    };
    const idle = await sample(0);
    const quiet = await sample(0.006);
    const speaking = await sample(0.10);
    const settled = await sample(0, 700);
    assert(quiet.output > 0.12, "Quiet RTC speech was discarded");
    assert(quiet.speed > idle.speed * 2.5, "Quiet speech did not speed up the actual orb");
    assert(speaking.speed > quiet.speed * 1.5, "The orb did not follow increasing RTC volume");
    assert(settled.output < 0.03, "The orb held speech levels after silence");
    assert(gl.getError() === gl.NO_ERROR, "The orb produced a WebGL error");
    return { transport: "local WebRTC", analysis: analysis.state, idle, quiet, speaking, settled };
  } finally {
    root.unmount();
    await controller.stop();
    remote.close();
    oscillator.stop();
    capture.getTracks().forEach((track) => track.stop());
    destination.stream.getTracks().forEach((track) => track.stop());
    await producer.close();
    assert(analysis?.state === "closed", "Analysis did not close on stop");
  }
}

try {
  const bundle = await build({
    stdin: { contents: `
      export { createRealtimeVoiceAudioMeter } from './src/renderer/features/workspace/lib/realtime-voice-audio';
      export { createRealtimeVoiceController } from './src/renderer/features/workspace/lib/realtime-voice-controller';
      export { VoiceOrb } from './src/renderer/features/workspace/components/voice-orb';
      export { createRoot } from 'react-dom/client'; export { createElement } from 'react';
    `, resolveDir: appRoot },
    tsconfig: path.join(appRoot, "tsconfig.renderer.json"),
    bundle: true, format: "iife", globalName: "Voice", platform: "browser", write: false,
  });
  const htmlPath = path.join(temporaryRoot, "probe.html");
  fs.writeFileSync(htmlPath, `<html><head><style>
    .voice-orb { display:block; width:112px; height:112px;
      --color-voice-orb-deep:rgb(190, 45, 48); --color-voice-orb-soft:rgb(242, 145, 151); --color-voice-orb-light:rgb(253, 232, 218); }
  </style></head><body><div id="root"></div><script>${bundle.outputFiles[0].text}</script></body></html>`);
  const mainPath = path.join(temporaryRoot, "main.cjs");
  fs.writeFileSync(mainPath, `
    const {app,BrowserWindow,session}=require('electron');
    app.setPath('userData',${JSON.stringify(path.join(temporaryRoot, "profile"))});
    app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
    app.commandLine.appendSwitch('use-fake-device-for-media-stream');
    app.whenReady().then(async()=>{
      app.dock?.hide();
      session.defaultSession.setPermissionRequestHandler((wc,permission,cb)=>cb(permission==='media'));
      session.defaultSession.setPermissionCheckHandler(()=>true);
      const win=new BrowserWindow({show:false,webPreferences:{offscreen:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
      try {
        await win.loadFile(${JSON.stringify(htmlPath)});
        const result=await win.webContents.executeJavaScript(${JSON.stringify(`(${probe.toString()})()`)},false);
        process.stdout.write(JSON.stringify(result)+'\\n');win.destroy();app.exit(0);
      }catch(error){process.stderr.write(String(error)+'\\n');win.destroy();app.exit(1);}
    });setTimeout(()=>app.exit(2),20000);
  `);
  const child = spawn(require("electron"), [mainPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stdout.on("data", (data) => process.stdout.write(data));
  child.stderr.on("data", (data) => { errors += data; });
  const code = await new Promise((resolve, reject) => { child.on("exit", resolve); child.on("error", reject); });
  if (code !== 0) throw new Error(`Voice smoke failed (${code}): ${errors.slice(-4000)}`);
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
