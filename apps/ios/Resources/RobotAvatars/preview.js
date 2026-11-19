const canvas = document.querySelector("canvas");
const availableShapes = new Set(MainsRobot.catalogue.styles.flatMap(style => style.presets.map(preset => preset.id)));
const reactionDuration = { blink: 320, doubleBlink: 650, spin: 1080, sway: 890, shiver: 560, glance: 1120, nod: 750 };
const idleReactions = ["blink", "doubleBlink", "glance", "sway", "nod"];
const greetingReactions = ["blink", "glance", "nod"];
let robot, shape, frame, ambientTimer, gesture;
let active = false, reduceMotion = false, ambientMotion = true, dragging = false, rendered = false, tick = 0;
let motion = "idle", workStart;
let selectionTurn = 0;
let selectionReaction, lastReaction;
let earlyReactions = [];
let yaw = .28, pitch = .14;
let lookX = 0, lookY = 0, targetLookX = 0, targetLookY = 0;

function canDraw() {
  return robot && active && !document.hidden;
}

function requestFrame() {
  if (frame === undefined && canDraw()) frame = requestAnimationFrame(draw);
}

function cancelIdleTimer() {
  clearTimeout(ambientTimer);
  ambientTimer = undefined;
}

function stop() {
  if (frame !== undefined) cancelAnimationFrame(frame);
  cancelIdleTimer();
  frame = gesture = undefined;
  workStart = undefined;
  dragging = false;
  lookX = lookY = targetLookX = targetLookY = 0;
}

function publishFrame(ready) {
  rendered = ready;
  window.webkit?.messageHandlers.robot?.postMessage({ shape, rendered });
}

function smooth(progress) {
  const t = Math.max(0, Math.min(1, progress));
  return t * t * (3 - 2 * t);
}

function blinkAt(progress) {
  return smooth(progress / .36) * smooth((1 - progress) / .43);
}

function sampleWorkingPose(elapsed) {
  const time = elapsed / 1000;
  const easeIn = smooth(time / .35);
  return {
    yaw: .32 * Math.sin(2.6 * time) * easeIn,
    pitch: -.12 * Math.sin(3.4 * time) * easeIn,
    roll: .11 * Math.sin(2.6 * time + .5) * easeIn,
    lookX: .67 * Math.sin(1.9 * time) * easeIn,
    blink: blinkAt(((time + 2.5) % 3.2) / .32),
  };
}

function sampleAvatarReaction(kind, elapsed, direction, subtle = false) {
  const progress = Math.max(0, elapsed) / reactionDuration[kind];
  if (progress >= 1) return undefined;
  const arc = Math.sin(Math.PI * progress) ** 2;
  switch (kind) {
    case "blink":
      return { blink: blinkAt(progress) };
    case "doubleBlink":
      return { blink: blinkAt(progress / .42) + blinkAt((progress - .52) / .48) };
    case "spin":
      return { yaw: direction * Math.PI * 2 * smooth(progress), pitch: -.10 * arc };
    case "sway": {
      const shake = direction * Math.sin(4 * Math.PI * progress) * arc;
      return { yaw: .38 * shake, roll: .22 * shake };
    }
    case "shiver": {
      const shake = Math.sin(14 * Math.PI * progress) * arc;
      return { yaw: direction * .17 * shake, roll: .10 * shake, pitch: .05 * shake };
    }
    case "glance": {
      const look = direction * smooth(progress / .18) * smooth((1 - progress) / .26) * (subtle ? .8 : 1);
      return { lookX: look, lookY: .05 * Math.abs(look) };
    }
    case "nod": {
      const amount = arc * (subtle ? .44 : 1);
      return { pitch: .31 * amount, roll: direction * .12 * amount, lookY: .52 * amount };
    }
  }
}

function startReaction(kind, delay = 0) {
  lastReaction = kind;
  gesture = { kind, start: performance.now() + delay, direction: Math.random() < .5 ? -1 : 1, spinAngle: 0 };
  requestFrame();
}

function startGreeting(delay = 0) {
  const choices = greetingReactions.filter(kind => kind !== lastReaction);
  startReaction(choices[Math.floor(Math.random() * choices.length)], delay);
}

function interruptReaction(preserveSpin = false) {
  if (preserveSpin && gesture) yaw += gesture.spinAngle;
  gesture = undefined;
  cancelIdleTimer();
}

function scheduleIdle() {
  const state = motion === "thinking" ? "thinking" : "idle";
  const detailGesture = selectionTurn ? undefined : MainsRobot.nextRobotAmbientGesture(state, tick);
  const [minimum, spread] = tick === 0 ? [450, 250] : earlyReactions.length ? [1450, 500] : [2600, 1800];
  const delay = detailGesture?.delay ?? minimum + Math.random() * spread;
  ambientTimer = setTimeout(() => {
    ambientTimer = undefined;
    if (motion === "greeting") {
      startGreeting();
    } else if (detailGesture) {
      startReaction(detailGesture.gesture);
    } else {
      const choices = idleReactions.filter(kind => kind !== lastReaction);
      startReaction(earlyReactions.shift() ?? choices[Math.floor(Math.random() * choices.length)]);
    }
    tick++;
  }, delay);
}

function draw(now) {
  frame = undefined;
  if (!canDraw()) return;
  const size = Math.round(Math.min(canvas.clientWidth, canvas.clientHeight) * Math.min(window.devicePixelRatio || 1, 2.5));
  if (!size) return;
  if (canvas.width !== size) canvas.width = canvas.height = size;

  const playingWorkMotion = motion === "creating" && !reduceMotion;
  let sample;
  if (playingWorkMotion) {
    workStart ??= now;
    sample = sampleWorkingPose(now - workStart);
  } else if (gesture) {
    const elapsed = now - gesture.start;
    sample = selectionTurn || motion === "greeting"
      ? sampleAvatarReaction(gesture.kind, elapsed, gesture.direction, motion === "greeting")
      : MainsRobot.sampleRobotGesture(gesture.kind, elapsed, gesture.direction);
    if (!sample) gesture = undefined;
    else if (gesture.kind === "spin") gesture.spinAngle = sample.yaw;
  }
  lookX += (targetLookX - lookX) * .24;
  lookY += (targetLookY - lookY) * .24;
  const eyesMoving = Math.abs(targetLookX - lookX) > .008 || Math.abs(targetLookY - lookY) > .008;
  robot.draw({
    yaw: yaw + (sample?.yaw ?? 0), pitch: pitch + (sample?.pitch ?? 0),
    roll: sample?.roll, lookX: lookX + (sample?.lookX ?? 0), lookY: lookY + (sample?.lookY ?? 0), blink: sample?.blink,
    focus: motion === "thinking" ? MainsRobot.robotRestingPose("thinking").focus : 0,
  });
  if (!rendered) publishFrame(true);

  if (playingWorkMotion || gesture || eyesMoving) requestFrame();
  else if (ambientMotion && !reduceMotion && !dragging && ambientTimer === undefined) scheduleIdle();
}

window.showRobot = (selectedShape, visible, reduced, ambient = true, turn = 0, reaction = "", nextMotion = "idle") => {
  if (!availableShapes.has(selectedShape)) return "unavailable";
  const startsMotion = !active || motion !== nextMotion || selectedShape !== shape || !robot;
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
  if (motion !== nextMotion || reduced) workStart = undefined;
  motion = nextMotion;
  if (!active) stop();
  else if (reduceMotion || startsMotion) interruptReaction();
  else if (!ambientMotion) cancelIdleTimer();
  if (turn !== selectionTurn) {
    selectionTurn = turn;
    selectionReaction = reaction;
    tick = 0;
    interruptReaction();
    if (turn) {
      // Give each avatar a readable blink and glance soon after its first reaction.
      earlyReactions = ["blink", "glance"].filter(kind => kind !== (reaction === "doubleBlink" ? "blink" : reaction));
      if (Math.random() < .5) earlyReactions.reverse();
      if (active && !reduceMotion && Object.hasOwn(reactionDuration, reaction)) startReaction(reaction, 125);
    }
  }
  if (startsMotion && active && !reduceMotion) {
    if (motion === "greeting") startGreeting(180);
    if (motion === "thinking") startReaction(MainsRobot.robotEntryGesture("thinking"));
  }
  requestFrame();
  return rendered ? "ready" : robot ? "pending" : "unavailable";
};

window.rotateRobot = direction => {
  interruptReaction(true);
  yaw += direction * .24;
  requestFrame();
};

window.dragRobot = (selectedShape, dx, dy, held) => {
  if (selectedShape !== shape || !robot || !active) return;
  if (held && !dragging) interruptReaction(true);
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
    if (window.showRobot(shape, active, reduceMotion, ambientMotion, selectionTurn, selectionReaction, motion) === "unavailable") publishFrame(false);
  } catch {
    publishFrame(false);
  }
});
