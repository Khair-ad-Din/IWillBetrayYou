#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uProvinceTex;  // R16UI — province id per tile, 0 = none
uniform usampler2D uFlagTex;      // R8UI — per-province flags, id -> (id % W, id / W)
uniform vec2 uMapSize;
uniform float uZoom;
uniform float uOpacity;
uniform vec3 uColor;
uniform uint uHighlight;          // hovered province id, 0 = none
uniform float uTime;              // seconds, for the marching outline

in vec2 vWorldPos;
out vec4 fragColor;

const uint FLAG_OUTGOING = 1u;  // the local player is attacking it
const uint FLAG_INCOMING = 2u;  // the local player is attacked there

uint provinceAt(ivec2 t) {
  if (t.x < 0 || t.y < 0 || t.x >= int(uMapSize.x) || t.y >= int(uMapSize.y))
    return 0u;
  return texelFetch(uProvinceTex, t, 0).r;
}

uint flagsOf(uint id) {
  int w = textureSize(uFlagTex, 0).x;
  int i = int(id);
  return texelFetch(uFlagTex, ivec2(i % w, i / w), 0).r;
}

// Plain lines: a border against another province; coastlines (id 0) are not.
bool differs(uint id, ivec2 t) {
  uint other = provinceAt(t);
  return other != 0u && other != id;
}

// Emphasized outlines also run along the coast.
bool outside(uint id, ivec2 t) {
  return provinceAt(t) != id;
}

void main() {
  vec2 wp = vWorldPos;
  if (wp.x < 0.0 || wp.y < 0.0 || wp.x >= uMapSize.x || wp.y >= uMapSize.y)
    discard;

  ivec2 tile = ivec2(floor(wp));
  uint id = provinceAt(tile);
  if (id == 0u) discard;

  uint flags = flagsOf(id);
  bool hovered = id == uHighlight;
  bool emphasized = hovered || flags != 0u;

  vec3 accent = vec3(1.0);
  if ((flags & FLAG_OUTGOING) != 0u) accent = vec3(1.0, 0.62, 0.1);
  if ((flags & FLAG_INCOMING) != 0u) accent = vec3(0.95, 0.15, 0.15);

  float px = 1.0 / uZoom;  // one screen pixel in world units

  if (!emphasized) {
    bool line;
    if (px >= 0.5) {
      // Zoomed out: a tile is thinner than two pixels, so mark whole tiles
      // (right/bottom only, keeping lines one tile wide).
      line = differs(id, tile + ivec2(1, 0)) || differs(id, tile + ivec2(0, 1));
    } else {
      vec2 f = wp - vec2(tile);
      float lw = px * 1.25;
      line = (f.x < lw && differs(id, tile + ivec2(-1, 0))) ||
             (f.x > 1.0 - lw && differs(id, tile + ivec2(1, 0))) ||
             (f.y < lw && differs(id, tile + ivec2(0, -1))) ||
             (f.y > 1.0 - lw && differs(id, tile + ivec2(0, 1)));
    }
    if (!line) discard;
    fragColor = vec4(uColor, uOpacity);
    return;
  }

  // Emphasis has to read on any territory color: a solid accent stroke with
  // a thin dark rim on the outside separates it from a similar-colored
  // neighbor, and provinces under attack breathe instead of relying on hue.
  bool incoming = (flags & FLAG_INCOMING) != 0u;
  float pulse = incoming ? 0.5 + 0.5 * sin(uTime * 4.0) : 1.0;
  vec4 accentStroke = vec4(accent, incoming ? 0.55 + 0.4 * pulse : 0.95);
  vec4 rim = vec4(0.03, 0.03, 0.04, 0.85);
  float washAlpha = hovered && flags == 0u ? 0.10 : 0.12;
  if (incoming) washAlpha = 0.08 + 0.12 * pulse;

  if (px >= 0.5) {
    bool edge = outside(id, tile + ivec2(1, 0)) || outside(id, tile + ivec2(-1, 0)) ||
                outside(id, tile + ivec2(0, 1)) || outside(id, tile + ivec2(0, -1));
    fragColor = edge ? accentStroke : vec4(accent, washAlpha);
    return;
  }

  // Distance (world units) from this fragment to the nearest edge of the
  // tile that faces outside the province.
  vec2 f = wp - vec2(tile);
  float d = 1.0;
  if (outside(id, tile + ivec2(-1, 0))) d = min(d, f.x);
  if (outside(id, tile + ivec2(1, 0))) d = min(d, 1.0 - f.x);
  if (outside(id, tile + ivec2(0, -1))) d = min(d, f.y);
  if (outside(id, tile + ivec2(0, 1))) d = min(d, 1.0 - f.y);

  float rimW = min(px * 1.0, 0.2);
  float strokeW = min(px * 3.0, 0.5);
  if (d < rimW) {
    fragColor = rim;
  } else if (d < strokeW) {
    fragColor = accentStroke;
  } else {
    fragColor = vec4(accent, washAlpha);
  }
}
