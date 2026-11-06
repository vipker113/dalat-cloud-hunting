import { useEffect } from 'react';
import type { IMultiplayerController } from '../network/types';
import { LocalPlayerAvatar } from './HighlandAvatar';
import { PeerCrowdRenderer } from './PeerCrowdRenderer';
import { PhotoCaptureBridge } from './PhotoCaptureBridge';
import { PlayerController } from './PlayerController';
import { NetControllerContext, setNetController } from './netBridge';

export interface GameplayRootProps {
  net?: IMultiplayerController;
}

/**
 * Root 3D Gameplay graph mounted inside the R3F <Canvas>.
 * Coordinates third-person BVH capsule locomotion, local HighlandAvatar,
 * 16/32 near peer crowd + distant storm-lantern beacons, and synchronous Polaroid frame capture.
 */
export function GameplayRoot({ net }: GameplayRootProps) {
  useEffect(() => {
    if (net) {
      setNetController(net);
    }
  }, [net]);

  return (
    <NetControllerContext.Provider value={net ?? null}>
      <PlayerController net={net} />
      <LocalPlayerAvatar />
      <PeerCrowdRenderer />
      <PhotoCaptureBridge />
    </NetControllerContext.Provider>
  );
}
