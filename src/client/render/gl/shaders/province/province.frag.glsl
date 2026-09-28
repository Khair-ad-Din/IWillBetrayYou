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
  bool border;
  if (px >= 0.5) {
    // Zoomed out: a tile is thinner than two pixels, so mark whole tiles.
    if (emphasized) {
      border = outside(id, tile + ivec2(1, 0)) || outside(id, tile + ivec2(-1, 0)) ||
               outside(id, tile + ivec2(0, 1)) || outside(id, tile + ivec2(0, -1));
    } else {
      // Only right/bottom, keeping plain lines one tile wide.
      border = differs(id, tile + ivec2(1, 0)) || differs(id, tile + ivec2(0, 1));
    }
  } else {
    vec2 f = wp - vec2(tile);
    if (emphasized) {
      float lw = min(px * 2.5, 0.5);
      border = (f.x < lw && outside(id, tile + ivec2(-1, 0))) ||
               (f.x > 1.0 - lw && outside(id, tile + ivec2(1, 0))) ||
               (f.y < lw && outside(id, tile + ivec2(0, -1))) ||
               (f.y > 1.0 - lw && outside(id, tile + ivec2(0, 1)));
    } else {
      float lw = px * 1.25;
      border = (f.x < lw && differs(id, tile + ivec2(-1, 0))) ||
               (f.x > 1.0 - lw && differs(id, tile + ivec2(1, 0))) ||
               (f.y < lw && differs(id, tile + ivec2(0, -1))) ||
               (f.y > 1.0 - lw && differs(id, tile + ivec2(0, 1)));
    }
  }

  if (border) {
    fragColor = emphasized ? vec4(accent, 0.9) : vec4(uColor, uOpacity);
    return;
  }
  // A faint wash over the hovered / contested province.
  if (emphasized) {
    fragColor = vec4(accent, hovered && flags == 0u ? 0.08 : 0.12);
    return;
  }
  discard;
}
