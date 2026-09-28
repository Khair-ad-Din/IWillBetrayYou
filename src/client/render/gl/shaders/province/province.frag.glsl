#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uProvinceTex;  // R16UI — province id per tile, 0 = none
uniform vec2 uMapSize;
uniform float uZoom;
uniform float uOpacity;
uniform vec3 uColor;

in vec2 vWorldPos;
out vec4 fragColor;

uint provinceAt(ivec2 t) {
  if (t.x < 0 || t.y < 0 || t.x >= int(uMapSize.x) || t.y >= int(uMapSize.y))
    return 0u;
  return texelFetch(uProvinceTex, t, 0).r;
}

// A border against another province; coastlines (id 0) are not borders.
bool differs(uint id, ivec2 t) {
  uint other = provinceAt(t);
  return other != 0u && other != id;
}

void main() {
  vec2 wp = vWorldPos;
  if (wp.x < 0.0 || wp.y < 0.0 || wp.x >= uMapSize.x || wp.y >= uMapSize.y)
    discard;

  ivec2 tile = ivec2(floor(wp));
  uint id = provinceAt(tile);
  if (id == 0u) discard;

  float px = 1.0 / uZoom;  // one screen pixel in world units
  bool border;
  if (px >= 0.5) {
    // Zoomed out: a tile is thinner than two pixels, so mark whole tiles.
    // Only the right/bottom neighbor is checked, keeping lines one tile wide.
    border = differs(id, tile + ivec2(1, 0)) || differs(id, tile + ivec2(0, 1));
  } else {
    // Zoomed in: a thin line along the tile edges facing another province.
    vec2 f = wp - vec2(tile);
    float lw = px * 1.25;
    border = (f.x < lw && differs(id, tile + ivec2(-1, 0))) ||
             (f.x > 1.0 - lw && differs(id, tile + ivec2(1, 0))) ||
             (f.y < lw && differs(id, tile + ivec2(0, -1))) ||
             (f.y > 1.0 - lw && differs(id, tile + ivec2(0, 1)));
  }
  if (!border) discard;
  fragColor = vec4(uColor, uOpacity);
}
