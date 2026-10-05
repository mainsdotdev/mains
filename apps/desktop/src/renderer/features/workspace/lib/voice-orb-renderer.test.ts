import { describe, expect, it, vi } from "vitest";
import { createVoiceOrbRenderer, type VoiceOrbPalette } from "./voice-orb-renderer";

function gpu() {
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    ARRAY_BUFFER: 5, STATIC_DRAW: 6, FLOAT: 7, TRIANGLE_STRIP: 8,
    isContextLost: () => false,
    createShader: vi.fn(() => ({})), shaderSource: vi.fn(), compileShader: vi.fn(), getShaderParameter: () => true,
    deleteShader: vi.fn(), createProgram: vi.fn(() => ({})), attachShader: vi.fn(), linkProgram: vi.fn(),
    getProgramParameter: () => true, deleteProgram: vi.fn(), useProgram: vi.fn(),
    createBuffer: vi.fn(() => ({})), bindBuffer: vi.fn(), bufferData: vi.fn(), deleteBuffer: vi.fn(),
    getAttribLocation: () => 0, enableVertexAttribArray: vi.fn(), vertexAttribPointer: vi.fn(), disableVertexAttribArray: vi.fn(),
    getUniformLocation: (_program: unknown, name: string) => name,
    uniform1f: vi.fn(), uniform2f: vi.fn(), uniform3f: vi.fn(), viewport: vi.fn(), drawArrays: vi.fn(),
  };
  const canvas = { width: 256, height: 256, getContext: vi.fn(() => gl) } as unknown as HTMLCanvasElement;
  return { gl, canvas };
}

const palette: VoiceOrbPalette = [[0.2, 0.3, 0.4], [0.6, 0.7, 0.8], [0.9, 0.95, 1], [0.6, 0.85, 0.75], [0.95, 0.8, 0.65]];

describe("orb shader style", () => {
  it("switches all three styles using the same GPU resources, palette and voice inputs", () => {
    const { gl, canvas } = gpu();
    const renderer = createVoiceOrbRenderer(canvas, palette)!;
    expect(gl.uniform1f).toHaveBeenLastCalledWith("u_style", 0);
    renderer.setStyle("sphere");
    expect(gl.uniform1f).toHaveBeenLastCalledWith("u_style", 1);
    renderer.setStyle("aurora");
    expect(gl.uniform1f).toHaveBeenLastCalledWith("u_style", 2);
    expect(gl.createProgram).toHaveBeenCalledOnce();
    expect(gl.createShader).toHaveBeenCalledTimes(2);
    expect(gl.createBuffer).toHaveBeenCalledOnce();
    expect(gl.uniform3f).toHaveBeenCalledTimes(5);
    expect(gl.uniform3f).toHaveBeenCalledWith("u_secondary", ...palette[3]);
    expect(gl.uniform3f).toHaveBeenCalledWith("u_tertiary", ...palette[4]);
    renderer.draw(3, { input: 0.2, output: 0.5 });
    expect(gl.uniform1f).toHaveBeenCalledWith("u_flow", 3);
    expect(gl.uniform2f).toHaveBeenLastCalledWith("u_voice", 0.2, 0.5);
    expect(gl.drawArrays).toHaveBeenCalledOnce();
    renderer.setStyle("cloud");
    expect(gl.uniform1f).toHaveBeenLastCalledWith("u_style", 0);
    renderer.dispose();
    renderer.dispose();
    const updates = gl.uniform1f.mock.calls.length;
    renderer.setStyle("aurora");
    renderer.draw(4, { input: 1, output: 1 });
    expect(gl.uniform1f).toHaveBeenCalledTimes(updates);
    expect(gl.deleteProgram).toHaveBeenCalledOnce();
    expect(gl.deleteBuffer).toHaveBeenCalledOnce();
  });

  it.each([["sphere", 1], ["aurora", 2]] as const)("initializes a restored %s directly in its selected style", (style, uniform) => {
    const { gl, canvas } = gpu();
    const renderer = createVoiceOrbRenderer(canvas, palette, style)!;
    expect(gl.uniform1f).toHaveBeenLastCalledWith("u_style", uniform);
    renderer.dispose();
  });
});
