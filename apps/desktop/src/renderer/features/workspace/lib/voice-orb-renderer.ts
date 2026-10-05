import type { VoiceAudioLevels } from "./realtime-voice-audio";
import type { VoiceOrbStyle } from "@mains/contracts/realtime";

type OrbColor = readonly [number, number, number];
export type VoiceOrbPalette = readonly [OrbColor, OrbColor, OrbColor, OrbColor, OrbColor];

const VERTEX_SHADER = `
  attribute vec2 a_position;
  varying vec2 v_position;
  void main() {
    v_position = a_position;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
  #else
    precision mediump float;
  #endif
  varying vec2 v_position;
  uniform float u_flow;
  uniform float u_edge;
  uniform float u_style;
  uniform vec2 u_voice;
  uniform vec3 u_deep;
  uniform vec3 u_soft;
  uniform vec3 u_light;
  uniform vec3 u_secondary;
  uniform vec3 u_tertiary;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), f.x),
               mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), f.x), f.y);
  }

  float cloud(vec2 p) {
    float value = 0.0;
    float weight = 0.55;
    mat2 bend = mat2(0.8, -0.6, 0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      value += weight * noise(p);
      p = bend * p * 1.92 + 7.3;
      weight *= 0.45;
    }
    return value;
  }

  vec3 cloudColor(vec2 p, float energy) {
    vec2 drift = vec2(u_flow * 0.24, -u_flow * 0.18);
    vec2 breeze = vec2(sin(u_flow * 0.42), cos(u_flow * 0.31)) * 0.3;
    vec2 wind = vec2(cloud(p * 1.25 + drift),
                     cloud(p * 1.25 - drift * 0.7 + 9.2)) - 0.48;
    vec2 curl = p + breeze + wind * (1.5 + energy * 0.7);
    curl += (vec2(cloud(curl * 1.5 + drift + 3.7),
                  cloud(curl * 1.5 - drift + 12.4)) - 0.48) * 0.75;

    float mist = cloud(curl * 1.65 + drift * 0.5);
    float billow = cloud(curl * 1.1 - drift * 0.65 + 5.6);
    float ribbon = curl.x * 0.46 + curl.y * 0.2 + (mist - 0.48) * 2.15 + (billow - 0.48) * 0.65;
    float warmth = smoothstep(-0.55, 0.72, ribbon);
    vec3 color = mix(u_deep, u_soft, warmth);
    float light = smoothstep(0.04, 0.72, ribbon + billow * 0.25);
    color = mix(color, u_light, light);

    // Shading stays gentle; only the interior flows, never the circular edge.
    float shade = 0.96 + 0.04 * smoothstep(-1.0, 1.0, p.y - p.x * 0.3);
    return color * shade;
  }

  float volumeNoise(vec3 p) {
    vec3 cell = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    vec2 layer = cell.xy + vec2(37.0, 17.0) * cell.z;
    float near = mix(mix(hash(layer), hash(layer + vec2(1.0, 0.0)), f.x),
                     mix(hash(layer + vec2(0.0, 1.0)), hash(layer + vec2(1.0)), f.x), f.y);
    layer += vec2(37.0, 17.0);
    float far = mix(mix(hash(layer), hash(layer + vec2(1.0, 0.0)), f.x),
                    mix(hash(layer + vec2(0.0, 1.0)), hash(layer + vec2(1.0)), f.x), f.y);
    return mix(near, far, f.z);
  }

  float volumeCloud(vec3 p) {
    // Broad banks plus a softer detail layer; no high-frequency ripples.
    return volumeNoise(p) * 0.65 + volumeNoise(p.yzx * 1.85 + vec3(3.7, 7.3, 5.1)) * 0.35;
  }

  vec3 sphereColor(vec2 p, float energy) {
    // Keep spherical depth while advecting clouds through its interior.
    float depth = sqrt(max(0.0, 1.0 - dot(p, p)));
    vec3 normal = vec3(p, depth);
    vec3 medium = vec3(p * 1.1, depth * 0.65);
    float angle = u_flow * 0.14;
    medium.xy = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * medium.xy;
    vec3 drift = vec3(u_flow * 0.21, -u_flow * 0.16, u_flow * 0.13);
    vec3 wind = vec3(
      volumeCloud(medium * 1.15 + drift),
      volumeCloud(medium.yzx * 1.1 - drift * 0.75 + 8.7),
      volumeCloud(medium.zxy * 1.2 + drift * 0.6 + 17.9)
    ) - 0.5;
    vec3 curl = medium + wind * (1.25 + energy * 0.15);
    curl += sin(curl.yzx * 2.0 + drift * 0.65) * 0.18;

    float bank = volumeCloud(curl * 1.55 + drift * 0.45);
    float wisp = volumeCloud(curl * 1.3 - drift * 0.6 + 5.6);
    float ribbon = curl.x * 0.32 + curl.y * 0.18 + (bank - 0.5) * 1.45 + (wisp - 0.5) * 0.65;
    vec3 color = mix(u_deep, u_soft, smoothstep(-0.55, 0.65, ribbon));
    float secondary = volumeCloud(curl * 1.1 + drift * 0.3 + 11.3);
    float tertiary = volumeCloud(curl * 1.35 - drift * 0.5 + 21.7);
    color = mix(color, u_secondary, smoothstep(0.36, 0.67, secondary) * 0.86);
    color = mix(color, u_tertiary, smoothstep(0.35, 0.69, tertiary) * 0.82);
    float light = smoothstep(0.48, 0.73, bank + (wisp - 0.5) * 0.35);
    color = mix(color, u_light, light * 0.62);

    float diffuse = max(0.0, dot(normal, normalize(vec3(-0.72, 0.58, 0.67))));
    color *= 0.55 + 0.49 * pow(diffuse, 0.9);
    float highlight = pow(max(0.0, dot(normal, normalize(vec3(-0.47, 0.51, 1.0)))), 20.0) * 0.24;
    float rim = pow(1.0 - depth, 3.0) * diffuse * 0.18;
    color = mix(color, u_light, highlight + rim);
    // Film grain stays fixed in screen space: the clouds move without flicker.
    float grain = (hash(floor(gl_FragCoord.xy)) - 0.5) * 0.07;
    return clamp(color + grain, 0.0, 1.0);
  }

  vec3 auroraColor(vec2 p, float energy) {
    float depth = sqrt(max(0.0, 1.0 - dot(p, p)));
    vec3 normal = vec3(p, depth);
    vec3 medium = normal;
    // Laminar folds curl through the volume, leaving the glass silhouette still.
    float turn = u_flow * 0.12 + depth * 1.25;
    medium.xy = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * medium.xy;
    medium.yz = mat2(0.94, -0.342, 0.342, 0.94) * medium.yz;
    vec3 drift = vec3(u_flow * 0.12, -u_flow * 0.09, u_flow * 0.07);
    float bank = volumeCloud(medium * 1.45 + drift);
    float veil = volumeCloud(medium.zxy * 1.6 - drift * 0.7 + 9.4);
    float fold = medium.y * 2.15 + medium.x * 0.3
      + sin(medium.x * 2.8 + medium.z * 1.6 + u_flow * 0.16) * (0.55 + energy * 0.08)
      + (bank - 0.5) * 1.25 + (veil - 0.5) * 0.45;
    float phase = fold * 3.8 - u_flow * 0.22;
    float ribbon = 0.5 + 0.5 * sin(phase);
    float pearl = smoothstep(0.24, 0.94, ribbon);
    float hue = smoothstep(-0.65, 0.8, medium.x + (veil - 0.5) * 1.6);
    vec3 silk = mix(u_tertiary, u_secondary, hue);
    vec3 color = mix(u_deep * 0.56, u_soft, 0.16 + bank * 0.24);
    color = mix(color, silk, pearl * 0.88);
    color = mix(color, u_light, pow(ribbon, 5.0) * (0.52 + u_voice.y * 0.1));

    // A narrow luminous hem gives each broad ribbon depth at compact sizes.
    float hem = pow(0.5 + 0.5 * cos(phase - 0.72), 56.0);
    float underside = pow(0.5 + 0.5 * cos(phase - 1.12), 18.0);
    color *= 1.0 - underside * 0.2;
    color = mix(color, u_light, hem * (0.58 + u_voice.x * 0.1));
    float diffuse = max(0.0, dot(normal, normalize(vec3(-0.5, 0.65, 0.9))));
    color *= 0.65 + diffuse * 0.36;
    float fresnel = pow(1.0 - depth, 2.7);
    color = mix(color, mix(u_soft, u_light, 0.65), fresnel * (0.28 + diffuse * 0.3));
    float glint = pow(max(0.0, dot(normal, normalize(vec3(-0.38, 0.48, 0.8)))), 80.0);
    float reflection = pow(max(0.0, dot(normal, normalize(vec3(0.6, -0.5, 0.55)))), 28.0);
    color = mix(color, u_light, glint * 0.72 + reflection * 0.16);
    return clamp(color, 0.0, 1.0);
  }

  void main() {
    vec2 p = v_position;
    float energy = max(u_voice.x, u_voice.y);
    vec3 color;
    if (u_style > 1.5) color = auroraColor(p, energy);
    else if (u_style > 0.5) color = sphereColor(p, energy);
    else color = cloudColor(p, energy);
    float alpha = 1.0 - smoothstep(1.0 - u_edge, 1.0, length(p));
    gl_FragColor = vec4(color, alpha);
  }
`;

/** Resolve CSS colours in the browser, including color-mix and custom themes. */
export function readVoiceOrbPalette(element: HTMLElement): VoiceOrbPalette | undefined {
  const canvas = element.ownerDocument.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return;
  const style = getComputedStyle(element);
  function color(token: string): OrbColor {
    context!.fillStyle = style.getPropertyValue(token).trim();
    context!.fillRect(0, 0, 1, 1);
    const pixel = context!.getImageData(0, 0, 1, 1).data;
    return [pixel[0] / 255, pixel[1] / 255, pixel[2] / 255];
  }
  return [color("--color-voice-orb-deep"), color("--color-voice-orb-soft"), color("--color-voice-orb-light"),
    color("--color-voice-orb-secondary"), color("--color-voice-orb-tertiary")];
}

/** One small fragment shader, with no textures, simulation buffers or dependencies. */
export function createVoiceOrbRenderer(canvas: HTMLCanvasElement, palette: VoiceOrbPalette, style: VoiceOrbStyle = "cloud") {
  const gl = canvas.getContext("webgl", {
    alpha: true, antialias: false, depth: false, stencil: false,
    premultipliedAlpha: false, powerPreference: "low-power",
  });
  if (!gl || gl.isContextLost()) return;

  function compile(type: number, source: string) {
    const shader = gl!.createShader(type);
    if (!shader) return null;
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    if (gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) return shader;
    gl!.deleteShader(shader);
    return null;
  }

  const vertex = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  if (!vertex || !fragment || !program || !buffer) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    return;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    return;
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const flow = gl.getUniformLocation(program, "u_flow");
  const edge = gl.getUniformLocation(program, "u_edge");
  const orbStyle = gl.getUniformLocation(program, "u_style");
  const voice = gl.getUniformLocation(program, "u_voice");
  const colors = ["u_deep", "u_soft", "u_light", "u_secondary", "u_tertiary"].map((name) => gl.getUniformLocation(program, name));
  let disposed = false;

  function setPalette(next: VoiceOrbPalette) {
    if (disposed) return;
    gl!.useProgram(program);
    next.forEach((color, index) => gl!.uniform3f(colors[index], ...color));
  }
  function setStyle(next: VoiceOrbStyle) {
    if (disposed) return;
    gl!.useProgram(program);
    gl!.uniform1f(orbStyle, next === "aurora" ? 2 : next === "sphere" ? 1 : 0);
  }
  setPalette(palette);
  setStyle(style);

  return {
    setPalette,
    setStyle,
    draw(time: number, levels: VoiceAudioLevels) {
      if (disposed || gl.isContextLost()) return;
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(flow, time);
      gl.uniform1f(edge, 2 / Math.max(1, canvas.width));
      gl.uniform2f(voice, levels.input, levels.output);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      gl.disableVertexAttribArray(position);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.useProgram(null);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    },
  };
}
