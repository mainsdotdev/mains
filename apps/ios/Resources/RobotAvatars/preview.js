const canvas = document.querySelector("canvas");
const availableShapes = new Set(MainsRobot.catalogue.styles.flatMap(style => style.presets.map(preset => preset.id)));
let robot, shape, frame, ambientTimer, gesture, spin;
let active = false, reduceMotion = false, ambientMotion = true, dragging = false, rendered = false, tick = 0;
let selectionTurn = 0;
let yaw = .28, pitch = .14;
let lookX = 0, lookY = 0, targetLookX = 0, targetLookY = 0;

function canDraw() {
  return robot && active && !document.hidden;
}

function requestFrame() {
  if (frame === undefined && canDraw()) frame = requestAnimationFrame(draw);
}

function clearAmbient() {
  clearTimeout(ambientTimer);
  ambientTimer = gesture = undefined;
}

function stop() {
  if (frame !== undefined) cancelAnimationFrame(frame);
  clearAmbient();
  frame = spin = undefined;
  dragging = false;
  lookX = lookY = targetLookX = targetLookY = 0;
}

function publishFrame(ready) {
  rendered = ready;
  window.webkit?.messageHandlers.robot?.postMessage({ shape, rendered });
}

function draw(now) {
  frame = undefined;
  if (!canDraw()) return;
  const size = Math.round(Math.min(canvas.clientWidth, canvas.clientHeight) * Math.min(window.devicePixelRatio || 1, 2.5));
  if (!size) return;
  if (canvas.width !== size) canvas.width = canvas.height = size;

  const sample = gesture && MainsRobot.sampleRobotGesture(gesture.kind, now - gesture.start, gesture.direction);
  if (!sample) gesture = undefined;
  if (spin) {
    spin.start ??= now;
    const progress = Math.min(1, (now - spin.start) / 1050);
    spin.angle = Math.PI * 2 * progress * progress * (3 - 2 * progress);
    if (progress === 1) spin = undefined;
  }
  lookX += (targetLookX - lookX) * .24;
  lookY += (targetLookY - lookY) * .24;
  const eyesMoving = Math.abs(targetLookX - lookX) > .008 || Math.abs(targetLookY - lookY) > .008;
  robot.draw({
    yaw: yaw + (spin?.angle ?? 0) + (sample?.yaw ?? 0), pitch: pitch + (sample?.pitch ?? 0),
    roll: sample?.roll, lookX: lookX + (sample?.lookX ?? 0), lookY: lookY + (sample?.lookY ?? 0), blink: sample?.blink,
  });
  if (!rendered) publishFrame(true);

  if (gesture || spin || eyesMoving) requestFrame();
  else if (ambientMotion && !reduceMotion && !dragging && ambientTimer === undefined) {
    const next = selectionTurn ? {
      gesture: tick % 3 === 1 ? "glance" : "blink",
      delay: tick === 0 ? 350 + Math.random() * 300 : 2200 + Math.random() * 1700,
    } : MainsRobot.nextRobotAmbientGesture("idle", tick);
    tick++;
    ambientTimer = setTimeout(() => {
      ambientTimer = undefined;
      gesture = { kind: next.gesture, start: performance.now(), direction: Math.random() < .5 ? -1 : 1 };
      requestFrame();
    }, next.delay);
  }
}

window.showRobot = (selectedShape, visible, reduced, ambient = true, turn = 0) => {
  if (!availableShapes.has(selectedShape)) return "unavailable";
  if (selectedShape !== shape || !robot) {
    stop();
    robot?.dispose();
    rendered = false;
    robot = MainsRobot.createRobotRenderer(canvas, selectedShape);
    shape = selectedShape;
    yaw = .28;
    pitch = .14;
    selectionTurn = tick = 0;
  }
  active = visible;
  reduceMotion = reduced;
  ambientMotion = ambient;
  if (!active) stop();
  else if (reduceMotion || !ambientMotion) clearAmbient();
  if (turn !== selectionTurn) {
    selectionTurn = turn;
    tick = 0;
    clearAmbient();
    spin = active && !reduceMotion && turn ? { angle: 0 } : undefined;
  }
  if (reduceMotion) spin = undefined;
  requestFrame();
  return rendered ? "ready" : robot ? "pending" : "unavailable";
};

window.rotateRobot = direction => {
  if (spin) { yaw += spin.angle; spin = undefined; }
  yaw += direction * .24;
  requestFrame();
};

window.dragRobot = (selectedShape, dx, dy, held) => {
  if (selectedShape !== shape || !robot || !active) return;
  if (held && !dragging) {
    clearAmbient();
    if (spin) { yaw += spin.angle; spin = undefined; }
  }
  dragging = held;
  yaw += dx * .027;
  pitch = Math.max(-.57, Math.min(.72, pitch + dy * .015));
  if (selectionTurn && !reduceMotion) {
    targetLookX = held ? Math.max(-.6, Math.min(.6, dx * .044)) : 0;
    targetLookY = held ? Math.max(-.4, Math.min(.4, -dy * .036)) : 0;
  }
  requestFrame();
};

new ResizeObserver(requestFrame).observe(canvas);
document.addEventListener("visibilitychange", () => document.hidden ? stop() : requestFrame());
canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  stop();
  robot = undefined;
  publishFrame(false);
});
canvas.addEventListener("webglcontextrestored", () => {
  try {
    if (window.showRobot(shape, active, reduceMotion, ambientMotion, selectionTurn) === "unavailable") publishFrame(false);
  } catch {
    publishFrame(false);
  }
});
