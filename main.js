/* global Hands, Camera, drawConnectors, drawLandmarks, HAND_CONNECTIONS */

const els = {
  toggleCamera: document.getElementById('toggleCamera'),
  playRound: document.getElementById('playRound'),
  resetScore: document.getElementById('resetScore'),

  gesture: document.getElementById('gesture'),
  playerMove: document.getElementById('playerMove'),
  computerMove: document.getElementById('computerMove'),
  result: document.getElementById('result'),
  countdown: document.getElementById('countdown'),

  playerScore: document.getElementById('playerScore'),
  computerScore: document.getElementById('computerScore'),
  drawScore: document.getElementById('drawScore'),

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
let roundBusy = false;
let latestMove = null;

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

  // Thumb detection is sometimes noisy, so paper is mainly based on four fingers.
  if (indexUp && middleUp && ringUp && pinkyUp && !thumbUp) return 'PAPER';

  return null;
}

function getComputerMove() {
  const moves = ['ROCK', 'PAPER', 'SCISSORS'];
  const randomIndex = Math.floor(Math.random() * moves.length);
  return moves[randomIndex];
}

function getWinner(playerMove, computerMove) {
  if (!playerMove) return 'UNKNOWN';
  if (playerMove === computerMove) return 'DRAW';

  const playerWins =
    (playerMove === 'ROCK' && computerMove === 'SCISSORS') ||
    (playerMove === 'PAPER' && computerMove === 'ROCK') ||
    (playerMove === 'SCISSORS' && computerMove === 'PAPER');

  return playerWins ? 'PLAYER' : 'COMPUTER';
}

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

function updateScore(winner) {
  if (winner === 'PLAYER') score.player += 1;
  if (winner === 'COMPUTER') score.computer += 1;
  if (winner === 'DRAW') score.draw += 1;

  els.playerScore.textContent = score.player;
  els.computerScore.textContent = score.computer;
  els.drawScore.textContent = score.draw;
}

function showRoundResult(playerMove, computerMove, winner) {
  els.playerMove.textContent = playerMove ? moveLabels[playerMove] : '—';
  els.computerMove.textContent = moveLabels[computerMove];
  els.result.textContent = explainResult(playerMove, computerMove, winner);

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
  els.computerMove.textContent = '—';

  const countdownWords = ['Rock', 'Paper', 'Scissors', 'Go!'];

  for (const word of countdownWords) {
    els.countdown.textContent = word;
    await wait(750);
  }

  // At "Go!", we use the latest gesture detected by MediaPipe.
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

  els.playerScore.textContent = '0';
  els.computerScore.textContent = '0';
  els.drawScore.textContent = '0';

  els.playerMove.textContent = '—';
  els.computerMove.textContent = '—';
  els.result.textContent = 'Score reset. Start a new round.';
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
  els.playRound.disabled = false;
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
