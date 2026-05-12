/* MediaPipe Tasks Vision (HandLandmarker)
Bron/guide (Web JS):
https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js

Belangrijk verschil t.o.v. de "oude" Solutions aanpak:
- We gebruiken `HandLandmarker` uit `@mediapipe/tasks-vision`.
- We doen zelf `getUserMedia()` voor de webcam.
- Per frame roepen we `detectForVideo(video, timestamp)` aan.
*/
import {
  DrawingUtils,
  FilesetResolver,
  HandLandmarker,
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs';

/* DOM referenties:
- video: onzichtbare <video> waarop de webcam stream binnenkomt
- canvas: om de hand-landmarks op te tekenen
- gesture/status: tekst output
*/
const els = {
  toggleCamera: document.getElementById('toggleCamera'),
  playRound: document.getElementById('playRound'),
  resetScore: document.getElementById('resetScore'),

  gesture: document.getElementById('gesture'),
  playerMove: document.getElementById('playerMove'),
  computerMove: document.getElementById('computerMove'),
  computerHistory: document.getElementById('computerHistory'),
  result: document.getElementById('result'),
  countdown: document.getElementById('countdown'),

  playerScore: document.getElementById('playerScore'),
  computerScore: document.getElementById('computerScore'),
  drawScore: document.getElementById('drawScore'),

  status: document.getElementById('status'),
  video: document.querySelector('.input_video'),
  canvas: document.querySelector('.output_canvas'),
};

/*
 Canvas context:
 We tekenen niet rechtstreeks op de video, maar op een canvas.
 Dit maakt het makkelijk om ook landmarks/labels te tekenen.
 @type {HTMLCanvasElement}
 */
const canvasEl = els.canvas;
const ctx = canvasEl.getContext('2d');

// MediaPipe Tasks object (wordt aangemaakt zodra we starten)
/** @type {HandLandmarker | null} */

let handLandmarker = null;

// Webcam stream + render-loop state
let stream = null;
let rafId = null;
let running = false;
let roundBusy = false;
let latestMove = null;

// Kleine “geschiedenis” van computer-keuzes zodat de speler kan nadenken.
const COMPUTER_HISTORY_LIMIT = 8;
/** @type {string[]} */
let computerMoveHistory = [];

// Model URL (officiële MediaPipe-hosted model bundle)
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const score = {
  player: 0,
  computer: 0,
  draw: 0,
};

const moveLabels = {
  ROCK: 'Rock',
  PAPER: 'Paper',
  SCISSORS: 'Scissors',
};

function setStatus(text) {
  els.status.textContent = text;
}

function renderComputerHistory() {
  if (!els.computerHistory) return;
  if (computerMoveHistory.length === 0) {
    els.computerHistory.textContent = '—';
    return;
  }

  // Toon nieuwste eerst.
  const formatted = computerMoveHistory
    .slice()
    .reverse()
    .map((m) => moveLabels[m] ?? m)
    .join(' • ');

  els.computerHistory.textContent = formatted;
}

function resizeCanvasToVideo(results) {
  // We zorgen dat het canvas dezelfde resolutie heeft als de video.
  // Anders worden landmarks scheef/slecht geschaald getekend.
  const width = els.video.videoWidth || 1280;
  const height = els.video.videoHeight || 720;

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

  if (indexUp && middleUp && ringUp && pinkyUp && !thumbUp) return 'PAPER';

  return null;
}

// Geeft een willekeurige keuze terug voor de computer
function getComputerMove() {
  const moves = ['ROCK', 'PAPER', 'SCISSORS'];
  const randomIndex = Math.floor(Math.random() * moves.length);
  return moves[randomIndex];
}

// Bepaalt wie de ronde wint
function getWinner(playerMove, computerMove) {
  if (!playerMove) return 'UNKNOWN';
  if (playerMove === computerMove) return 'DRAW';

  const playerWins =
    (playerMove === 'ROCK' && computerMove === 'SCISSORS') ||
    (playerMove === 'PAPER' && computerMove === 'ROCK') ||
    (playerMove === 'SCISSORS' && computerMove === 'PAPER');

  return playerWins ? 'PLAYER' : 'COMPUTER';
}

// Geeft een nette tekst terug voor de uitslag
function explainResult(playerMove, computerMove, winner) {
  if (winner === 'UNKNOWN') {
    return 'Gesture not clear. Try again with a clear rock, paper, or scissors pose.';
  }

  if (winner === 'DRAW') {
    return `Draw! You both chose ${moveLabels[playerMove]}.`;
  }

  const winningText = `${moveLabels[playerMove]} beats ${moveLabels[computerMove]}`;
  const losingText = `${moveLabels[computerMove]} beats ${moveLabels[playerMove]}`;

  if (winner === 'PLAYER') {
    return `You win! ${winningText}.`;
  }

  return `Computer wins! ${losingText}.`;
}

// Werkt de score bij na elke ronde
function updateScore(winner) {
  if (winner === 'PLAYER') score.player += 1;
  if (winner === 'COMPUTER') score.computer += 1;
  if (winner === 'DRAW') score.draw += 1;

  els.playerScore.textContent = score.player;
  els.computerScore.textContent = score.computer;
  els.drawScore.textContent = score.draw;
}

// Toont de uitslag van een gespeelde ronde
function showRoundResult(playerMove, computerMove, winner) {
  els.playerMove.textContent = playerMove ? moveLabels[playerMove] : '—';
  els.computerMove.textContent = moveLabels[computerMove];
  els.result.textContent = explainResult(playerMove, computerMove, winner);

  computerMoveHistory.push(computerMove);
  if (computerMoveHistory.length > COMPUTER_HISTORY_LIMIT) {
    computerMoveHistory = computerMoveHistory.slice(-COMPUTER_HISTORY_LIMIT);
  }
  renderComputerHistory();

  if (winner !== 'UNKNOWN') {
    updateScore(winner);
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function playRound() {
  if (!running || roundBusy) return;

  roundBusy = true;
  els.playRound.disabled = true;
  els.result.textContent = 'Get ready...';
  els.playerMove.textContent = '—';
  // Let op: we laten de laatste computer-keuze staan,
  // zodat je tijdens de countdown nog “history” ziet.

  const countdownWords = ['Rock', 'Paper', 'Scissors', 'Go!'];

  for (const word of countdownWords) {
    els.countdown.textContent = word;
    await wait(750);
  }

  // Bij "Go!", word de laatste gesture gepakt uit mediapipe.
  const playerMove = latestMove;
  const computerMove = getComputerMove();
  const winner = getWinner(playerMove, computerMove);

  els.countdown.textContent = '';
  showRoundResult(playerMove, computerMove, winner);

  roundBusy = false;
  els.playRound.disabled = !running;
}

function resetScore() {
  score.player = 0;
  score.computer = 0;
  score.draw = 0;

  computerMoveHistory = [];
  renderComputerHistory();

  els.playerScore.textContent = '0';
  els.computerScore.textContent = '0';
  els.drawScore.textContent = '0';

  els.playerMove.textContent = '—';
  els.computerMove.textContent = '—';
  els.result.textContent = 'Score reset. Start a new round.';
}

/**
 * Tekent de huidige video-frame + landmarks.
 * 'result' komt uit 'handLandmarker.detectForVideo()'.
 */
function draw(result) {
  resizeCanvasToVideo();

  ctx.save();
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  // Mirror/selfie view:
  // Omdat veel camera apps gespiegeld tonen, spiegelen we ook het canvas.
  // Hierdoor voelt de beweging “natuurlijker” aan voor de gebruiker.
  ctx.translate(canvasEl.width, 0);
  ctx.scale(-1, 1);

  // 1) Video frame tekenen
  ctx.drawImage(els.video, 0, 0, canvasEl.width, canvasEl.height);

  // 2) Landmarks tekenen + classificeren (we nemen de eerste hand)
  const landmarks = result?.landmarks?.[0];

  if (landmarks) {
    const drawingUtils = new DrawingUtils(ctx);
    drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
      color: '#00FF00',
      lineWidth: 3,
    });
    drawingUtils.drawLandmarks(landmarks, {
      color: '#FF0000',
      lineWidth: 1,
      radius: 3,
    });

    // Handedness (links/rechts) is optioneel; afhankelijk van versie kan de vorm iets verschillen.
    const handednessLabel =
      result?.handednesses?.[0]?.[0]?.categoryName ??
      result?.handednesses?.[0]?.categories?.[0]?.categoryName ??
      'Right';

    const move = classifyRps(landmarks, handednessLabel);
    latestMove = move;
    els.gesture.textContent = move ? moveLabels[move] : '—';

    if (!roundBusy) {
      setStatus(move ? `Detected: ${moveLabels[move]}` : 'Hand detected. Try a clear ROCK, PAPER, or SCISSORS pose.');
    }
  } else {
    latestMove = null;
    els.gesture.textContent = '—';

    if (!roundBusy) {
      setStatus('No hand detected. Put your hand in view.');
    }
  }

  ctx.restore();
}

async function start() {
  if (running) return;

  // 1) HandLandmarker initialiseren (model + wasm laden) als dat nog niet gebeurd is.
  // Dit is de setup zoals in de officiële Web JS guide.
  if (!handLandmarker) {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
      );

      handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: MODEL_URL,
        },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
    } catch (err) {
      console.error(err);
      setStatus('HandLandmarker kon niet initialiseren (model/wasm). Check je internet.');
      return;
    }
  }

  // 2) Webcam stream ophalen via de browser.
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: 1280,
        height: 720,
      },
      audio: false,
    });
  } catch (err) {
    console.error(err);
    setStatus('Kon camera niet openen. Geef toestemming en gebruik https/localhost.');
    return;
  }

  els.video.srcObject = stream;
  try {
    await els.video.play();
  } catch (err) {
    console.error(err);
    setStatus('Video kon niet starten (autoplay/permissions).');
    return;
  }

  // 3) Render loop starten.
  // Per frame: detectForVideo(...) -> draw(result)
  const loop = () => {
    if (!running || !handLandmarker) return;

    if (els.video.readyState >= 2) {
      const timestampMs = performance.now();
      const result = handLandmarker.detectForVideo(els.video, timestampMs);
      draw(result);
    }

    rafId = requestAnimationFrame(loop);
  };

  running = true;
  els.toggleCamera.textContent = 'Stop camera';
  els.playRound.disabled = false;
  setStatus('Camera started. Show ROCK, PAPER, or SCISSORS.');

  rafId = requestAnimationFrame(loop);
}

async function stop() {
  if (!running) return;

  // Stop de detectie-loop.
  if (rafId != null) cancelAnimationFrame(rafId);
  rafId = null;

  // Webcam stream stoppen door alle tracks te stoppen.
  if (stream && typeof stream.getTracks === 'function') {
    for (const track of stream.getTracks()) track.stop();
  }
  stream = null;
  els.video.srcObject = null;
  running = false;
  latestMove = null;

  els.gesture.textContent = '—';
  els.toggleCamera.textContent = 'Start camera';
  els.playRound.disabled = true;
  els.countdown.textContent = '';
  setStatus('Camera stopped.');
}

els.toggleCamera.addEventListener('click', async () => {
  if (running) await stop();
  else await start();
});

els.playRound.addEventListener('click', playRound);
els.resetScore.addEventListener('click', resetScore);

setStatus('Click “Start camera”, then show a hand pose.');
