#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;    // unit quad [0,1]
layout(location = 1) in vec3 aSite;   // tile x, tile y, icon index

uniform mat3 uCamera;
uniform float uHalfSize;              // half the icon size, in world units

out vec2 vUV;
flat out float vIcon;

void main() {
  // Map y grows downward, like the canvas the atlas was drawn on.
  vUV = aPos;
  vIcon = aSite.z;
  vec2 world = aSite.xy + 0.5 + (aPos * 2.0 - 1.0) * uHalfSize;
  vec3 clip = uCamera * vec3(world, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
