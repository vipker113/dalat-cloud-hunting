import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../store/gameStore';
import { captureAndComposePolaroid } from './polaroidComposer';

/**
 * Runs inside the R3F <Canvas> loop so shutter requests render and read the WebGL backbuffer
 * synchronously on the exact same frame—preventing blank/black captures even if
 * `preserveDrawingBuffer` is false on the root <Canvas>.
 */
export function PhotoCaptureBridge() {
  const lastNonceRef = useRef<number>(useGameStore.getState().photoShutterNonce);

  useFrame(({ gl, scene, camera }) => {
    const st = useGameStore.getState();
    if (st.photoShutterNonce === lastNonceRef.current) return;
    lastNonceRef.current = st.photoShutterNonce;

    // Force an explicit synchronous render pass right before reading gl.domElement
    gl.render(scene, camera);

    const entry = captureAndComposePolaroid({
      sourceCanvas: gl.domElement,
      filter: st.photoFilter,
      focalMm: st.photoFocalMm,
      caption: '',
      authorName: st.displayName || 'Lữ Khách',
      playerX: st.localTransient.x,
      playerY: st.localTransient.y,
      playerZ: st.localTransient.z,
      atmosphere: st.atmosphere,
    });

    st.setLatestCapturedPolaroid(entry);
  });

  return null;
}
