/**
 * Accurate per-frame 3D scene GPU draw-call and triangle telemetry captured
 * immediately after the main scene render pass (before post-processing FullScreenQuads
 * reset `WebGLRenderer.info.render`).
 */
export const sceneRenderStats = {
  drawCalls: 0,
  triangles: 0,
};
