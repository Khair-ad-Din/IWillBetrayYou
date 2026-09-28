/**
 * ResourceSitePass — one icon per resource site (farm, mine, natural harbor).
 *
 * Icons are drawn at a fixed on-screen size, centered on the site's tile, as
 * instanced quads sampling a small atlas. The atlas holds placeholder art
 * (an emoji on a round badge) until custom icons replace it. Sites stay
 * hidden until setVisible(true): they must not show while players pick where
 * to spawn.
 */

import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/resource-site/resource-site.frag.glsl?raw";
import vertSrc from "../shaders/resource-site/resource-site.vert.glsl?raw";

export interface ResourceSiteIcon {
  x: number;
  y: number;
  /** Index into RESOURCE_ICON_GLYPHS. */
  icon: number;
}

/** Placeholder art, one per icon index: glyph and badge color. */
export const RESOURCE_ICON_GLYPHS: readonly { glyph: string; badge: string }[] =
  [
    { glyph: "⚓", badge: "#1f5f8b" }, // natural harbor
    { glyph: "🌾", badge: "#5b7a1e" }, // farm
    { glyph: "⛏️", badge: "#7a5a1e" }, // mine
  ];

const ICON_PX = 64; // atlas resolution per icon
const SCREEN_PX = 26; // on-screen icon size
const FLOATS_PER_INSTANCE = 3;

export class ResourceSitePass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: WebGLBuffer;
  private atlas: WebGLTexture;
  private count = 0;
  private visible = false;

  private uCamera: WebGLUniformLocation;
  private uHalfSize: WebGLUniformLocation;
  private uIconCount: WebGLUniformLocation;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, vertSrc, fragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uHalfSize = gl.getUniformLocation(this.program, "uHalfSize")!;
    this.uIconCount = gl.getUniformLocation(this.program, "uIconCount")!;
    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uAtlas"), 0);

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.instanceBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, 0, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, FLOATS_PER_INSTANCE, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);

    this.atlas = this.createAtlas();
  }

  setSites(sites: ResourceSiteIcon[]): void {
    const data = new Float32Array(sites.length * FLOATS_PER_INSTANCE);
    sites.forEach((s, i) => {
      data[i * 3] = s.x;
      data[i * 3 + 1] = s.y;
      data[i * 3 + 2] = s.icon;
    });
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    this.count = sites.length;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    if (!this.visible || this.count === 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uHalfSize, SCREEN_PX / 2 / zoom);
    gl.uniform1f(this.uIconCount, RESOURCE_ICON_GLYPHS.length);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.instanceBuf);
    gl.deleteTexture(this.atlas);
  }

  private createAtlas(): WebGLTexture {
    const canvas = document.createElement("canvas");
    canvas.width = ICON_PX * RESOURCE_ICON_GLYPHS.length;
    canvas.height = ICON_PX;
    const ctx = canvas.getContext("2d")!;
    const r = ICON_PX / 2;
    RESOURCE_ICON_GLYPHS.forEach(({ glyph, badge }, i) => {
      const cx = i * ICON_PX + r;
      ctx.beginPath();
      ctx.arc(cx, r, r - 3, 0, Math.PI * 2);
      ctx.fillStyle = badge;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(10, 10, 12, 0.9)";
      ctx.stroke();
      ctx.font = `${Math.round(ICON_PX * 0.5)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(glyph, cx, r + 2);
    });

    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }
}
