/**
 * ProvincePass — province borders, the hovered province and contested ones.
 *
 * Province ids (one per tile, from core/game/Provinces) live in an R16UI
 * texture; the fragment shader draws a thin line wherever a tile's id differs
 * from its neighbor's. A small per-province flag texture marks the provinces
 * the local player is attacking (orange) or being attacked in (red), which
 * get a dashed accent/black outline and diagonal stripes, as does the hovered
 * province (white): pattern and motion keep them readable on any territory
 * color. The red outline marches.
 * Nothing is drawn until setProvinces() provides the ids.
 */

import type { RenderSettings } from "../RenderSettings";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
} from "../utils/GlUtils";

import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import provinceFragSrc from "../shaders/province/province.frag.glsl?raw";

// Flag texture layout: province id -> (id % FLAG_TEX_WIDTH, id / FLAG_TEX_WIDTH).
const FLAG_TEX_WIDTH = 256;
const FLAG_OUTGOING = 1;
const FLAG_INCOMING = 2;

export class ProvincePass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private provinceTex: WebGLTexture | null = null;
  private flagTex: WebGLTexture | null = null;
  private flags = new Uint8Array(FLAG_TEX_WIDTH);
  private highlight = 0;

  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uOpacity: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;
  private uHighlight: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;

  constructor(
    gl: WebGL2RenderingContext,
    private mapW: number,
    private mapH: number,
    private settings: RenderSettings,
  ) {
    this.gl = gl;
    this.program = createProgram(gl, overlayVertSrc, provinceFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uZoom = gl.getUniformLocation(this.program, "uZoom")!;
    this.uOpacity = gl.getUniformLocation(this.program, "uOpacity")!;
    this.uColor = gl.getUniformLocation(this.program, "uColor")!;
    this.uHighlight = gl.getUniformLocation(this.program, "uHighlight")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uProvinceTex"), 0);
    gl.uniform1i(gl.getUniformLocation(this.program, "uFlagTex"), 1);

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  /** Uploads the province id of every tile (mapW * mapH, row-major). */
  setProvinces(ids: Uint16Array): void {
    const gl = this.gl;
    if (ids.length !== this.mapW * this.mapH) {
      throw new Error(
        `Province ids length ${ids.length} does not match map ${this.mapW}x${this.mapH}`,
      );
    }
    if (this.provinceTex !== null) gl.deleteTexture(this.provinceTex);
    // Rows are 2 * mapW bytes, not always a multiple of the default 4.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.provinceTex = createTexture2D(gl, {
      width: this.mapW,
      height: this.mapH,
      internalFormat: gl.R16UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_SHORT,
      data: ids,
      filter: gl.NEAREST,
    });

    let maxId = 0;
    for (let i = 0; i < ids.length; i++) if (ids[i] > maxId) maxId = ids[i];
    const rows = Math.floor(maxId / FLAG_TEX_WIDTH) + 1;
    this.flags = new Uint8Array(rows * FLAG_TEX_WIDTH);
    this.uploadFlags();
  }

  /** The province under the cursor (0 = none). */
  setHighlight(province: number): void {
    this.highlight = province;
  }

  /** Provinces the local player is attacking and being attacked in. */
  setAttackedProvinces(outgoing: number[], incoming: number[]): void {
    this.flags.fill(0);
    for (const p of outgoing) {
      if (p > 0 && p < this.flags.length) this.flags[p] |= FLAG_OUTGOING;
    }
    for (const p of incoming) {
      if (p > 0 && p < this.flags.length) this.flags[p] |= FLAG_INCOMING;
    }
    this.uploadFlags();
  }

  private uploadFlags(): void {
    const gl = this.gl;
    if (this.flagTex !== null) gl.deleteTexture(this.flagTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.flagTex = createTexture2D(gl, {
      width: FLAG_TEX_WIDTH,
      height: this.flags.length / FLAG_TEX_WIDTH,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: this.flags,
      filter: gl.NEAREST,
    });
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    const opacity = this.settings.mapOverlay.provinceBorderOpacity;
    if (this.provinceTex === null || this.flagTex === null || opacity <= 0) {
      return;
    }
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uOpacity, opacity);
    gl.uniform3f(this.uColor, 0.08, 0.08, 0.1);
    gl.uniform1ui(this.uHighlight, this.highlight);
    // Wrapped so float precision holds up in long sessions.
    gl.uniform1f(this.uTime, (performance.now() / 1000) % 1000);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.provinceTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.flagTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    if (this.provinceTex !== null) gl.deleteTexture(this.provinceTex);
    if (this.flagTex !== null) gl.deleteTexture(this.flagTex);
  }
}
