import type { AssistantRobotShape } from "@mains/contracts/assistants";
import { createRobotModel } from "./assistant-robot-models";
import type { RobotFinish, RobotPart } from "./assistant-robot-mesh";

const vertexSource = `
attribute vec3 aPosition;
attribute vec3 aNormal;

uniform vec3 uPosition;
uniform vec3 uOrbit;
uniform vec2 uPartRoll;
uniform vec2 uLook;
uniform vec2 uScale;

varying vec3 vNormal;
varying vec3 vSurface;

vec3 rotate(vec3 point, vec2 angles) {
  float s = sin(angles.x);
  float c = cos(angles.x);
  vec3 yaw = vec3(c * point.x + s * point.z, point.y, c * point.z - s * point.x);
  s = sin(angles.y);
  c = cos(angles.y);
  return vec3(yaw.x, c * yaw.y - s * yaw.z, s * yaw.y + c * yaw.z);
}

vec3 orient(vec3 point) {
  point = rotate(point, uOrbit.xy);
  float s = sin(uOrbit.z);
  float c = cos(uOrbit.z);
  return vec3(c * point.x - s * point.y, s * point.x + c * point.y, point.z);
}

void main() {
  vec3 point = aPosition;
  point.xy *= uScale;
  mat2 roll = mat2(uPartRoll.y, uPartRoll.x, -uPartRoll.x, uPartRoll.y);
  point.xy = roll * point.xy;
  point += uPosition + vec3(uLook, 0.0);
  vec3 view = orient(point);
  vNormal = orient(vec3(roll * aNormal.xy, aNormal.z));
  vSurface = point;
  gl_Position = vec4(view.xy * 0.99, -view.z * 0.30, 1.0 - view.z * 0.09);
}
`;

const fragmentSource = `
precision mediump float;
uniform vec3 uColor;
uniform float uFinish;
uniform float uLidEdge;
varying vec3 vNormal;
varying vec3 vSurface;

void main() {
  if (vSurface.y < uLidEdge) discard;
  vec3 normal = normalize(vNormal);
  vec3 key = normalize(vec3(-0.50, 0.68, 0.78));
  vec3 fill = normalize(vec3(0.75, -0.40, 0.52));
  vec3 halfLight = normalize(key + vec3(0.0, 0.0, 1.0));
  float diffuse = 0.51 + 0.41 * max(0.0, dot(normal, key)) + 0.12 * max(0.0, dot(normal, fill));
  float rim = pow(1.0 - abs(normal.z), 2.4);
  float specular = max(0.0, dot(normal, halfLight));
  float noise = fract(sin(dot(floor(vSurface.xy * 240.0 + vSurface.z * 90.0),
    vec2(13.17, 47.53))) * 173.71) - 0.5;

  vec3 rgb = uColor * (diffuse + noise * 0.035);
  if (uFinish == 1.0) {
    float brush = fract(sin(floor(vSurface.y * 330.0) * 17.1) * 81.7) - 0.5;
    rgb += vec3(pow(specular, 8.0) * 0.23 + rim * 0.10 + brush * 0.033);
  } else if (uFinish == 2.0) {
    rgb += vec3(pow(specular, 15.0) * 0.23 + pow(specular, 4.0) * 0.047);
  } else if (uFinish == 3.0) {
    rgb = uColor * 0.92 + vec3(0.09);
  } else {
    rgb += vec3(pow(specular, 12.0) * 0.10 + rim * 0.045);
  }
  rgb += vec3(0.09 * (1.0 - smoothstep(0.0, 0.012, vSurface.y - uLidEdge)));
  gl_FragColor = vec4(rgb, 1.0);
}
`;

const finishes: Record<RobotFinish, number> = { matte: 0, metal: 1, glass: 2, light: 3 };
type RobotPose = {
  yaw: number;
  pitch: number;
  roll?: number;
  lookX?: number;
  lookY?: number;
  blink?: number;
  focus?: number;
  accent?: number;
};

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Could not allocate robot shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  const error = gl.getShaderInfoLog(shader) ?? "Could not compile robot shader";
  gl.deleteShader(shader);
  throw new Error(error);
}

function createProgram(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  if (!program) throw new Error("Could not allocate robot program");
  const shaders: WebGLShader[] = [];
  try {
    shaders.push(compile(gl, gl.VERTEX_SHADER, vertexSource));
    shaders.push(compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
    shaders.forEach(shader => gl.attachShader(program, shader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? "Could not link robot program");
    }
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    shaders.forEach(shader => gl.deleteShader(shader));
  }
}

export function createRobotRenderer(canvas: HTMLCanvasElement, shape: AssistantRobotShape) {
  const context = canvas.getContext("webgl", { alpha: true, antialias: true });
  if (!context) return null;
  const gl = context;

  const program = createProgram(gl);
  const positionAttr = gl.getAttribLocation(program, "aPosition");
  const normalAttr = gl.getAttribLocation(program, "aNormal");
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const position = uniform("uPosition"), orbit = uniform("uOrbit"), partRoll = uniform("uPartRoll");
  const look = uniform("uLook"), scale = uniform("uScale"), color = uniform("uColor"), finish = uniform("uFinish");
  const lidEdge = uniform("uLidEdge");
  const parts: Array<RobotPart & { buffer: WebGLBuffer; tint: [number, number, number] }> = [];
  function dispose() {
    parts.forEach(({ buffer }) => gl.deleteBuffer(buffer));
    gl.deleteProgram(program);
  }

  try {
    for (const part of createRobotModel(shape)) {
      const buffer = gl.createBuffer();
      if (!buffer) throw new Error("Could not allocate robot mesh");
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, part.vertices, gl.STATIC_DRAW);
      const rgb = Number.parseInt(part.color.slice(1), 16);
      parts.push({ ...part, buffer, tint: [(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255] });
    }
  } catch (error) {
    dispose();
    throw error;
  }

  return {
    dispose,
    draw({ yaw, pitch, roll = 0, lookX = 0, lookY = 0, blink = 0, focus = 0, accent = 0 }: RobotPose) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(program);
      gl.enable(gl.CULL_FACE);
      gl.enable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.cullFace(gl.BACK);
      gl.enableVertexAttribArray(positionAttr);
      gl.enableVertexAttribArray(normalAttr);

      gl.uniform3f(orbit, yaw, pitch + focus * 0.036, roll);

      function drawPart(part: typeof parts[number]) {
        let [x, y, z] = part.position;
        let gazeX = 0, gazeY = 0, width = 1, height = 1, lowerEdge = -2;
        let sin = 0, cos = 1;
        if (part.gesture && accent) {
          const { translate, roll: angle = 0, pivot, oneWay } = part.gesture;
          const drive = oneWay ? Math.abs(accent) : accent;
          sin = Math.sin(angle * drive);
          cos = Math.cos(angle * drive);
          if (pivot) {
            const [px, py] = pivot;
            const dx = x - px, dy = y - py;
            x = px + dx * cos - dy * sin;
            y = py + dx * sin + dy * cos;
          }
          if (translate) {
            x += translate[0] * drive;
            y += translate[1] * drive;
            z += translate[2] * drive;
          }
        }
        switch (part.motion) {
          case "terminalEyes":
            gazeX = lookX * 0.045;
            gazeY = lookY * 0.038;
            height = Math.max(0.09, 1 - blink * 0.91 - focus * 0.29);
            break;
          case "iris":
            gazeX = lookX * 0.101;
            gazeY = lookY * 0.040;
            width = height = 1 - focus * 0.22;
            break;
          case "lid":
            // Reveal the upper lid down to its moving edge, keeping the rim fixed inside the lens.
            lowerEdge = y + 0.082 - blink * 0.43 - focus * 0.018;
            break;
          case "specialistEyes":
            gazeX = Math.max(-1, Math.min(1, lookX)) * .049;
            gazeY = Math.max(-1, Math.min(1, lookY)) * .044;
            height = Math.max(.08, 1 - blink * .92 - focus * .24);
            break;
        }
        gl.uniform3f(position, x, y, z);
        gl.uniform2f(look, gazeX, gazeY);
        gl.uniform2f(partRoll, sin, cos);
        gl.uniform2f(scale, width, height);
        gl.uniform3fv(color, part.tint);
        gl.uniform1f(finish, finishes[part.finish]);
        gl.uniform1f(lidEdge, lowerEdge);
        gl.bindBuffer(gl.ARRAY_BUFFER, part.buffer);
        gl.vertexAttribPointer(positionAttr, 3, gl.FLOAT, false, 24, 0);
        gl.vertexAttribPointer(normalAttr, 3, gl.FLOAT, false, 24, 12);
        gl.drawArrays(gl.TRIANGLES, 0, part.vertices.length / 6);
      }

      parts.forEach(drawPart);
    },
  };
}
