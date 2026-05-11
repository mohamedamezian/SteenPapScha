/* global Hands, Camera, drawConnectors, drawLandmarks, HAND_CONNECTIONS */

const els = {
  toggleCamera: document.getElementById('toggleCamera'),
  gesture: document.getElementById('gesture'),
  status: document.getElementById('status'),
  video: document.querySelector('.input_video'),
  canvas: document.querySelector('.output_canvas'),
};

/** @type {HTMLCanvasElement} */
const canvasEl = els.canvas;
const ctx = canvasEl.getContext('2d');

let hands = null;
let camera = null;
let running = false;

function setStatus(text) {
  els.status.textContent = text;
}

function resizeCanvasToVideo(results) {
  const width = results?.image?.width ?? els.video.videoWidth ?? 1280;
  const height = results?.image?.height ?? els.video.videoHeight ?? 720;

  if (canvasEl.width !== width) canvasEl.width = width;
  if (canvasEl.height !== height) canvasEl.height = height;
}

function isFingerExtended(landmarks, tipIdx, pipIdx) {
  const tip = landmarks[tipIdx];
  const pip = landmarks[pipIdx];
  const MARGIN = 0.02;
  return tip.y < pip.y - MARGIN;
}

function isThumbExtended(landmarks, handednessLabel) {
  const tip = landmarks[4];
  const ip = landmarks[3];
  const MARGIN = 0.015;

  if (handednessLabel === 'Left') return tip.x < ip.x - MARGIN;
  return tip.x > ip.x + MARGIN;
}

function classifyRps(landmarks, handednessLabel) {
  const indexUp = isFingerExtended(landmarks, 8, 6);
  const middleUp = isFingerExtended(landmarks, 12, 10);
  const ringUp = isFingerExtended(landmarks, 16, 14);
  const pinkyUp = isFingerExtended(landmarks, 20, 18);
  const thumbUp = isThumbExtended(landmarks, handednessLabel);

  if (!indexUp && !middleUp && !ringUp && !pinkyUp) return 'ROCK';
  if (indexUp && middleUp && ringUp && pinkyUp) return 'PAPER';
  if (indexUp && middleUp && !ringUp && !pinkyUp) return 'SCISSORS';

  // If thumb detection is noisy, this still counts as paper.
  if (indexUp && middleUp && ringUp && pinkyUp && !thumbUp) return 'PAPER';

  return null;
}

function draw(results) {
  resizeCanvasToVideo(results);

  ctx.save();
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  // Mirror for a selfie view.
  ctx.translate(canvasEl.width, 0);
  ctx.scale(-1, 1);

  ctx.drawImage(results.image, 0, 0, canvasEl.width, canvasEl.height);

  const landmarks = results.multiHandLandmarks?.[0];
  if (landmarks) {
    drawConnectors(ctx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 3 });
    drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 3 });

    const handednessLabel = results.multiHandedness?.[0]?.label ?? 'Right';
    const move = classifyRps(landmarks, handednessLabel);

    els.gesture.textContent = move ?? '—';
    setStatus(move ? `Detected: ${move}` : 'Hand detected. Try a clear ROCK, PAPER, or SCISSORS pose.');
  } else {
    els.gesture.textContent = '—';
    setStatus('No hand detected. Put your hand in view.');
  }

  ctx.restore();
}

async function start() {
  if (running) return;

  if (typeof Hands === 'undefined' || typeof Camera === 'undefined') {
    setStatus('MediaPipe scripts failed to load. Check your internet connection.');
    return;
  }

  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });

  hands.onResults(draw);

  camera = new Camera(els.video, {
    onFrame: async () => {
      await hands.send({ image: els.video });
    },
    width: 1280,
    height: 720,
  });

  try {
    await camera.start();
  } catch (err) {
    console.error(err);
    setStatus('Could not start camera. Allow camera permission and use https or localhost.');
    return;
  }

  running = true;
  els.toggleCamera.textContent = 'Stop camera';
  setStatus('Camera started. Show ROCK, PAPER, or SCISSORS.');
}

async function stop() {
  if (!running) return;

  const stream = els.video.srcObject;
  if (stream && typeof stream.getTracks === 'function') {
    for (const track of stream.getTracks()) track.stop();
  }
  els.video.srcObject = null;

  hands?.close?.();
  hands = null;
  camera = null;
  running = false;

  els.gesture.textContent = '—';
  els.toggleCamera.textContent = 'Start camera';
  setStatus('Camera stopped.');
}

els.toggleCamera.addEventListener('click', async () => {
  if (running) await stop();
  else await start();
});

setStatus('Click “Start camera”, then show a hand pose.');
