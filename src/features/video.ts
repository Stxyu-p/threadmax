/**
 * ThreadMax — Video Player Booster
 * Speed control, PiP, Volume memory.
 */

import { TM_Config } from '../config';
import { TIMING, VIDEO_SPEEDS, CSS_PREFIX, Z_INDEX } from '../constants';

interface VideoController {
  element: HTMLDivElement;
  speedBtn: HTMLButtonElement;
  pipBtn: HTMLButtonElement;
  currentSpeedIdx: number;
  video: HTMLVideoElement;
}

const controllers = new WeakMap<HTMLVideoElement, VideoController>();

export function enhanceVideo(video: HTMLVideoElement): void {
  if (controllers.has(video)) return;

  // Apply saved volume
  const savedVolume = TM_Config.getVideoVolume();
  video.volume = Math.max(0, Math.min(1, savedVolume));

  video.addEventListener('volumechange', () => {
    if (!video.muted) {
      TM_Config.setVideoVolume(video.volume);
    }
  });

  const parent = video.parentElement;
  if (!parent || parent.querySelector(`.${CSS_PREFIX}video-controls`)) return;

  const ctrl = document.createElement('div');
  ctrl.className = `${CSS_PREFIX}video-controls`;
  
  let currentSpeedIdx = 0;
  ctrl.innerHTML = `
    <button type="button" class="${CSS_PREFIX}video-btn ${CSS_PREFIX}speed-btn" title="Click to cycle speed">1.0x</button>
    <button type="button" class="${CSS_PREFIX}video-btn ${CSS_PREFIX}pip-btn" title="Picture-in-Picture">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="2" y="4" width="20" height="16" rx="2"></rect>
        <rect x="13" y="11" width="7" height="7" rx="1" fill="currentColor"></rect>
      </svg>
    </button>
  `;

  const speedBtn = ctrl.querySelector(`.${CSS_PREFIX}speed-btn`) as HTMLButtonElement;
  const pipBtn = ctrl.querySelector(`.${CSS_PREFIX}pip-btn`) as HTMLButtonElement;

  speedBtn.onclick = (e) => {
    e.stopPropagation();
    e.preventDefault();
    currentSpeedIdx = (currentSpeedIdx + 1) % VIDEO_SPEEDS.length;
    const newSpeed = VIDEO_SPEEDS[currentSpeedIdx];
    video.playbackRate = newSpeed;
    speedBtn.textContent = `${newSpeed}x`;
  };

  pipBtn.onclick = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      if (document.pictureInPictureElement === video) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await video.requestPictureInPicture();
      } else {
        showToast('⚠️ Browser does not support PiP');
      }
    } catch (err) {
      console.warn('[ThreadMax] PiP error:', err);
    }
  };

  parent.style.position = 'relative';
  parent.appendChild(ctrl);

  controllers.set(video, { element: ctrl, speedBtn, pipBtn, currentSpeedIdx, video });
}

// ─── Re-attach on src swap (MutationObserver) ─────────────────
const videoSrcObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.type === 'attributes' && (m.attributeName === 'src' || m.attributeName === 'currentSrc')) {
      const video = m.target as HTMLVideoElement;
      if (video.tagName === 'VIDEO') {
        // Re-enhance on next tick
        setTimeout(() => enhanceVideo(video), 0);
      }
    }
  }
});

export function startVideoSrcObserver(): void {
  videoSrcObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['src', 'currentSrc'],
    subtree: true,
  });
}

export function stopVideoSrcObserver(): void {
  videoSrcObserver.disconnect();
}

export function initAllVideos(): void {
  document.querySelectorAll<HTMLVideoElement>('video').forEach(enhanceVideo);
}

// ─── Toast helper (shared) ────────────────────────────────────
function showToast(msg: string, duration = TIMING.TOAST_DURATION_MS): void {
  let toast = document.getElementById(`${CSS_PREFIX}toast`);
  if (!toast) {
    toast = document.createElement('div');
    toast.id = `${CSS_PREFIX}toast`;
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add(`${CSS_PREFIX}toast-visible`);
  clearTimeout((toast as any)._timer);
  (toast as any)._timer = setTimeout(() => {
    toast.classList.remove(`${CSS_PREFIX}toast-visible`);
  }, duration);
}