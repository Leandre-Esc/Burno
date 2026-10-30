// Sound effect played on every send.

import slimeUrl from "./assets/sounds/slime.mp3";
import { loadSounds } from "./storage";

const slimeAudio = new Audio(slimeUrl);
slimeAudio.preload = "auto";

/** Played on every send */
export function slime() {
  if (!loadSounds()) return;
  // Restart when sending again before the previous sound ended
  slimeAudio.currentTime = 0;
  slimeAudio.play().catch(() => {
    // autoplay refused or no audio device: stay silent
  });
}
