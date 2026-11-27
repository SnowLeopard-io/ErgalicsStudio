// ==========================================================================
// Ergalics Studio Plugin SDK — Host Audio Ducking Bridge (IoC)
//
// Sound-capable plugins (synth, keys, acoustics, audio clip players) inform
// the host when they are open or actively playing so background ambient music
// can stand down. The host registers its implementation at boot via
// `setHostAudioBridge`; in headless / standalone tests calls are safe no-ops.
// ==========================================================================

export interface HostAudioBridge {
  setHostAudioPluginOpen(open: boolean): void;
  setHostAudioActive(active: boolean): void;
}

let bridge: HostAudioBridge | null = null;

export function setHostAudioBridge(next: HostAudioBridge | null): void {
  bridge = next;
}

export function setHostAudioPluginOpen(open: boolean): void {
  bridge?.setHostAudioPluginOpen(open);
}

export function setHostAudioActive(active: boolean): void {
  bridge?.setHostAudioActive(active);
}
