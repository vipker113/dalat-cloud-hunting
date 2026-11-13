import { useEffect, useState } from 'react';
import type { IMultiplayerController } from '../network/types';
import { NetControllerContext, setNetController } from '../gameplay/netBridge';
import { useGameStore } from '../store/gameStore';
import { AnalogPhotoMode } from './AnalogPhotoMode';
import { DiegeticHUD } from './DiegeticHUD';
import { LandingOverlay } from './LandingOverlay';
import { MistLoadingVeil } from './MistLoadingVeil';
import { MobileTouchControls } from './MobileTouchControls';
import { AlmanacModal } from './modals/AlmanacModal';
import { ChannelsModal } from './modals/ChannelsModal';
import { PocketMapModal } from './modals/PocketMapModal';
import { PolaroidWallModal } from './modals/PolaroidWallModal';
import { SettingsModal } from './modals/SettingsModal';
import { WardrobeModal } from './modals/WardrobeModal';
import { WindChimeModal } from './modals/WindChimeModal';
import { DIEGETIC_GLOBAL_CSS } from './uiStyles';

export interface DiegeticUIRootProps {
  net?: IMultiplayerController;
}

/**
 * Whisper-Quiet Diegetic UX Overlay Root for "Chạm Mây Đà Lạt".
 * Floats cleanly over the live WebGL 3D world with frosted dark highland glass,
 * 4.5s stillness auto-fade, 35mm Analog Film Photo Mode, and cozy illustrated modals.
 */
export function DiegeticUIRoot({ net }: DiegeticUIRootProps) {
  const hasEnteredWorld = useGameStore((s) => s.hasEnteredWorld);
  const photoModeActive = useGameStore((s) => s.photoModeActive);
  const activeModal = useGameStore((s) => s.activeModal);
  const [hudPrewarmed, setHudPrewarmed] = useState(false);

  useEffect(() => {
    if (net) {
      setNetController(net);
    }
  }, [net]);

  useEffect(() => {
    const t = window.setTimeout(() => setHudPrewarmed(true), 220);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <NetControllerContext.Provider value={net ?? null}>
      <style>{DIEGETIC_GLOBAL_CSS}</style>

      <div
        className="dalat-full-viewport"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 'var(--dl-vh, 100vh)',
          maxWidth: '100vw',
          overflow: 'hidden',
          pointerEvents: 'none',
          zIndex: 25,
        }}
      >
        <MistLoadingVeil />

        {!hasEnteredWorld && <LandingOverlay net={net} />}

        {(hasEnteredWorld || hudPrewarmed) && (
          <div
            style={{ display: hasEnteredWorld && !photoModeActive ? 'contents' : 'none' }}
            aria-hidden={!hasEnteredWorld || photoModeActive}
          >
            <DiegeticHUD net={net} />
          </div>
        )}

        {hasEnteredWorld && photoModeActive && <AnalogPhotoMode net={net} />}

        {hasEnteredWorld && <MobileTouchControls />}

        {hasEnteredWorld && !photoModeActive && activeModal === 'map' && <PocketMapModal />}
        {hasEnteredWorld && !photoModeActive && activeModal === 'wardrobe' && (
          <WardrobeModal net={net} />
        )}
        {hasEnteredWorld && !photoModeActive && activeModal === 'channels' && (
          <ChannelsModal net={net} />
        )}
        {hasEnteredWorld && !photoModeActive && activeModal === 'polaroids' && (
          <PolaroidWallModal net={net} />
        )}
        {hasEnteredWorld && !photoModeActive && activeModal === 'windchimes' && (
          <WindChimeModal net={net} />
        )}
        {hasEnteredWorld && !photoModeActive && activeModal === 'almanac' && <AlmanacModal />}
        {hasEnteredWorld && !photoModeActive && activeModal === 'settings' && <SettingsModal />}
      </div>
    </NetControllerContext.Provider>
  );
}
