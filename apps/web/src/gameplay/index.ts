export { GameplayRoot, type GameplayRootProps } from './GameplayRoot';
export {
  HighlandAvatar,
  LocalPlayerAvatar,
  type AvatarMotionSample,
  type HighlandAvatarProps,
} from './HighlandAvatar';
export { PeerCrowdRenderer } from './PeerCrowdRenderer';
export { PlayerController, type PlayerControllerProps } from './PlayerController';
export { PhotoCaptureBridge } from './PhotoCaptureBridge';
export {
  NetControllerContext,
  getNetController,
  setNetController,
  useNetController,
} from './netBridge';
export {
  HIGHLAND_GUITAR_CHORDS,
  INTERACTION_SPOTS,
  evaluateNearbyPrompt,
  executeInteractPrompt,
  isNearCampfireStage,
  playTemporaryEmote,
  triggerGuitarChord,
} from './interactions';
export {
  PHOTO_FILTER_LABELS,
  captureAndComposePolaroid,
  updatePolaroidCaption,
  type PhotoFilterId,
} from './polaroidComposer';
