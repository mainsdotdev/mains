const canvas = document.querySelector("canvas");
const availableShapes = new Set(MainsRobot.catalogue.styles.flatMap(style => style.presets.map(preset => preset.id)));
let robot, shape, frame, ambientTimer, gesture;
let active = false, reduceMotion = false, dragging = false, tick = 0;
let yaw = .28, pitch = .14;

function canDraw() {
  return robot && active && !document.hidden;
}

function requestFrame() {
  if (frame === undefined && canDraw()) frame = requestAnimationFrame(draw);
}

function stop() {
  if (frame !== undefined) cancelAnimationFrame(frame);
  clearTimeout(ambientTimer);
  frame = ambientTimer = gesture = undefined;
  dragging = false;
}

function draw(now) {
  frame = undefined;
  if (!canDraw()) return;
  const size = Math.round(Math.min(canvas.clientWidth, canvas.clientHeight) * Math.min(window.devicePixelRatio || 1, 2.5));
  if (!size) return;
  if (canvas.width !== size) canvas.width = canvas.height = size;

  const sample = gesture && MainsRobot.sampleRobotGesture(gesture.kind, now - gesture.start, gesture.direction);
  if (!sample) gesture = undefined;
  robot.draw({
    yaw: yaw + (sample?.yaw ?? 0), pitch: pitch + (sample?.pitch ?? 0),
    roll: sample?.roll, lookX: sample?.lookX, lookY: sample?.lookY, blink: sample?.blink,
  });

  if (gesture) requestFrame();
  else if (!reduceMotion && !dragging && ambientTimer === undefined) {
    const next = MainsRobot.nextRobotAmbientGesture("idle", tick++);
    ambientTimer = setTimeout(() => {
      ambientTimer = undefined;
      gesture = { kind: next.gesture, start: performance.now(), direction: Math.random() < .5 ? -1 : 1 };
      requestFrame();
    }, next.delay);
  }
}

window.showRobot = (selectedShape, visible, reduced) => {
  if (!availableShapes.has(selectedShape)) return false;
  if (selectedShape !== shape || !robot) {
    stop();
    robot?.dispose();
    robot = MainsRobot.createRobotRenderer(canvas, selectedShape);
    shape = selectedShape;
    yaw = .28;
    pitch = .14;
  }
  active = visible;
  reduceMotion = reduced;
  if (!active || reduceMotion) stop();
  requestFrame();
  return !!robot;
};

window.rotateRobot = direction => {
  yaw += direction * .24;
  requestFrame();
};

window.dragRobot = (selectedShape, dx, dy, held) => {
  if (selectedShape !== shape || !robot || !active) return;
  if (held && !dragging) {
    clearTimeout(ambientTimer);
    ambientTimer = gesture = undefined;
  }
  dragging = held;
  yaw += dx * .027;
  pitch = Math.max(-.57, Math.min(.72, pitch + dy * .015));
  requestFrame();
};

new ResizeObserver(requestFrame).observe(canvas);
document.addEventListener("visibilitychange", () => document.hidden ? stop() : requestFrame());
canvas.addEventListener("webglcontextlost", event => {
  event.preventDefault();
  stop();
  robot = undefined;
  window.webkit?.messageHandlers.robot?.postMessage({ shape, rendered: false });
});
canvas.addEventListener("webglcontextrestored", () => {
  try {
    const rendered = window.showRobot(shape, active, reduceMotion);
    window.webkit?.messageHandlers.robot?.postMessage({ shape, rendered });
  } catch {
    window.webkit?.messageHandlers.robot?.postMessage({ shape, rendered: false });
  }
});
