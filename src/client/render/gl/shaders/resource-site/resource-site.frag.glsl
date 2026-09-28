#version 300 es
precision highp float;

uniform sampler2D uAtlas;   // one square icon per column
uniform float uIconCount;

in vec2 vUV;
flat in float vIcon;
out vec4 fragColor;

void main() {
  vec4 c = texture(uAtlas, vec2((vIcon + vUV.x) / uIconCount, vUV.y));
  if (c.a < 0.01) discard;
  fragColor = c;
}
