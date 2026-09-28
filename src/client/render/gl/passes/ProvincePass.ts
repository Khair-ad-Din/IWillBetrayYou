/**
 * ProvincePass — thin lines along province borders.
 *
 * Province ids (one per tile, from core/game/Provinces) live in an R16UI
 * texture; the fragment shader draws a line wherever a tile's id differs from
 * its neighbor's. Nothing is drawn until setProvinces() provides the ids.
 */

import type { RenderSettings } from "../RenderSettings";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
} from "../utils/GlUtils";

import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import provinceFragSrc from "../shaders/province/province.frag.glsl?raw";

export class ProvincePass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private provinceTex: WebGLTexture | null = null;

  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uOpacity: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;

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

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uProvinceTex"), 0);

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
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    const opacity = this.settings.mapOverlay.provinceBorderOpacity;
    if (this.provinceTex === null || opacity <= 0) return;
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uOpacity, opacity);
    gl.uniform3f(this.uColor, 0.08, 0.08, 0.1);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.provinceTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    if (this.provinceTex !== null) gl.deleteTexture(this.provinceTex);
  }
}
