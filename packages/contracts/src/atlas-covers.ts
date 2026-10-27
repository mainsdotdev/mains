/** A bundled Page cover an agent can choose by id; the description is what the agent reads. */
export interface AtlasCoverPreset {
  id: string;
  /** Gallery section, from `ATLAS_COVER_GROUPS`. */
  group: AtlasCoverGroupId;
  /** Full-size image in `packages/backend/assets/atlas-covers/`. */
  file: string;
  description: string;
}

/** Gallery sections, in display order. */
export const ATLAS_COVER_GROUPS = [
  { id: "gradient", title: "Color & Gradient" },
  { id: "british-library", title: "British Library" },
  { id: "birmingham-museums", title: "Birmingham Museums Trust" },
  { id: "metropolitan-museum", title: "The Metropolitan Museum of Art" },
  { id: "nasa", title: "NASA" },
] as const;
export type AtlasCoverGroupId = (typeof ATLAS_COVER_GROUPS)[number]["id"];

/**
 * Keep descriptions short and about mood and fit: they are sent to the model by
 * `AtlasListCovers`. Full-size images are at most 2048 px wide (the widest the app
 * draws a cover), and every cover needs a gallery thumbnail: see
 * `npm run atlas:cover-thumbnails` in `apps/desktop`.
 */
export const ATLAS_COVER_PRESETS = [
  { id: "dawn", group: "gradient", file: "dawn.png", description: "Soft peach-to-lilac sunrise haze; gentle, hopeful. Journals, plans, wellness." },
  { id: "ocean", group: "gradient", file: "ocean.png", description: "Deep blue fading to turquoise; calm and spacious. Research, travel, long-form notes." },
  { id: "forest", group: "gradient", file: "forest.png", description: "Dark pine green with misty light; grounded, natural. Outdoors, sustainability, reading." },
  { id: "sunset", group: "gradient", file: "sunset.png", description: "Violet sky into pink and amber glow; warm, expressive. Creative work, events, personal pages." },
  { id: "lavender", group: "gradient", file: "lavender.png", description: "Pale violet with a bright glow; light, dreamy. Ideas, design, brainstorming." },
  { id: "aurora", group: "gradient", file: "aurora.png", description: "Midnight blue into green with a violet glow; futuristic. Engineering, science, product vision." },
  { id: "citrus", group: "gradient", file: "citrus.png", description: "Bright yellow to orange; energetic, optimistic. Goals, launches, sprints, to-do lists." },
  { id: "graphite", group: "gradient", file: "graphite.png", description: "Near-black charcoal; minimal and focused. Technical specs, logs, security, dark themes." },
  { id: "new-zealand-flora", group: "british-library", file: "new-zealand-flora.jpg", description: "Hand-coloured vintage plate: lush palms and tall trees below snowy peaks, with kiwi and moa. Nature, wildlife, biology, travel." },
  { id: "polar-halo", group: "british-library", file: "polar-halo.jpg", description: "Pale sun ringed by a halo over an icy polar sea; hazy gold and sage, quiet and otherworldly. Science, weather, reflection, winter." },
  { id: "egyptian-frieze", group: "british-library", file: "egyptian-frieze.jpg", description: "Wide ancient Egyptian tomb painting of offering bearers and gods on cream; ornate, ceremonial. History, culture, ritual, archives." },
  { id: "nutmeg", group: "british-library", file: "nutmeg.jpg", description: "Botanical painting of a nutmeg branch with fruit and mace on soft grey-white; calm, precise. Food, spices, botany, research." },
  { id: "lake-valley", group: "british-library", file: "lake-valley.jpg", description: "Golden-lit mountain lake valley under a hazy sky; warm and expansive. Travel, outdoors, long-term plans, reflection." },
  { id: "country-house", group: "british-library", file: "country-house.jpg", description: "Victorian country house across a still lake, soft greens and cream sky; stately, peaceful. Property, heritage, home, leisure." },
  { id: "rio-aqueduct", group: "british-library", file: "rio-aqueduct.jpg", description: "Old aqueduct arches behind a hillside town with palms under a warm sepia sky; historic, lively. Cities, architecture, culture, travel." },
  { id: "sepia-coast", group: "british-library", file: "sepia-coast.jpg", description: "Sepia lithograph of a strait with cliffs and a hilltop fortress, golden foliage up front; nostalgic. History, geography, exploration." },
  { id: "castle-storm", group: "birmingham-museums", file: "castle-storm.jpg", description: "Oil painting of a stormy green sea breaking below a ruined castle headland, a lone sail in the rain; dramatic, moody. Resilience, challenges, history, risk." },
  { id: "ember-sky", group: "birmingham-museums", file: "ember-sky.jpg", description: "Burning orange sunset clouds over a dark ship and rocky shore; intense, painterly. Creative work, big ideas, endings and beginnings." },
  { id: "sunlit-courtyard", group: "birmingham-museums", file: "sunlit-courtyard.jpg", description: "Sunlit stone courtyard with terracotta roofs and an arched gateway under a deep blue sky; warm, bold. Home, places, architecture, projects." },
  { id: "harvest-bay", group: "birmingham-museums", file: "harvest-bay.jpg", description: "Golden haystacks above a turquoise bay under billowing white clouds; bright, airy summer. Harvest, planning, outdoors, happy memories." },
  { id: "pale-estuary", group: "birmingham-museums", file: "pale-estuary.jpg", description: "Hazy pastel estuary with distant chimneys under a soft pink-blue sky; quiet, dreamy. Reflection, journaling, slow days, drafts." },
  { id: "twilight-loch", group: "birmingham-museums", file: "twilight-loch.jpg", description: "Still blue loch at dusk with pink-lit hills on the horizon; serene, wide open. Calm focus, wellbeing, evening notes, travel." },
  { id: "storm-beach", group: "birmingham-museums", file: "storm-beach.jpg", description: "Wide grey-gold beach with breaking waves, gulls and cormorants under heavy clouds; wild, windswept. Nature, weather, field notes." },
  { id: "open-sea", group: "birmingham-museums", file: "open-sea.jpg", description: "Deep blue open water with sailing boats under scattered clouds; steady, expansive. Long-term goals, strategy, voyages, exploration." },
  { id: "bridge-travelers", group: "metropolitan-museum", file: "bridge-travelers.jpg", description: "Japanese woodblock print of travellers and a packhorse crossing a wooden bridge by a river and hills; busy, warm. Travel, journeys, logistics, trip plans." },
  { id: "rope-bridge", group: "metropolitan-museum", file: "rope-bridge.jpg", description: "Japanese woodblock print of two porters crossing a rope bridge between cliffs under a bright blue sky; adventurous. Risky bets, milestones, leaps, hiking." },
  { id: "kite-rooftops", group: "metropolitan-museum", file: "kite-rooftops.jpg", description: "Japanese woodblock print of kites flying over tiled rooftops with Mount Fuji beyond; playful, airy. Play, hobbies, side projects, fresh ideas." },
  { id: "giant-tree", group: "metropolitan-museum", file: "giant-tree.jpg", description: "Japanese woodblock print of a giant tree trunk with small travellers and a smoking mountain; grounded, monumental. Roots, growth, big picture, legacy." },
  { id: "great-wave", group: "metropolitan-museum", file: "great-wave.jpg", description: "Hokusai's Great Wave off Kanagawa: a towering blue wave with Mount Fuji behind; iconic, powerful. Momentum, change, big challenges, art." },
  { id: "snow-bridge", group: "metropolitan-museum", file: "snow-bridge.jpg", description: "Japanese woodblock print of a snowy floating bridge across a blue river with a pine and thatched house; quiet winter. Rest, planning ahead, seasons, calm." },
  { id: "blue-fisherman", group: "metropolitan-museum", file: "blue-fisherman.jpg", description: "Monochrome blue Japanese print of fishermen on a rocky cliff above waves, Fuji in the distance; cool, patient. Focus, deep work, research, routines." },
  { id: "cranes-fuji", group: "metropolitan-museum", file: "cranes-fuji.jpg", description: "Japanese woodblock print of cranes on green hills below Mount Fuji; elegant, peaceful. Wellness, nature, journaling, long-term vision." },
  { id: "jupiter", group: "nasa", file: "jupiter.jpg", description: "Jupiter's swirling cream and amber bands and Great Red Spot against black space; bold, dramatic. Science, scale, big questions, astronomy." },
  { id: "lunar-craters", group: "nasa", file: "lunar-craters.jpg", description: "Half-lit Moon, grey and crater-covered on black; stark, quiet. Minimal focus, night work, space, history of exploration." },
  { id: "saturn", group: "nasa", file: "saturn.jpg", description: "Saturn with its thin rings, soft gold on black; elegant, calm. Design, long-term thinking, learning, astronomy." },
  { id: "orbit-horizon", group: "nasa", file: "orbit-horizon.jpg", description: "A spacecraft silhouetted against Earth's glowing orange-to-blue horizon; epic, hopeful. Launches, milestones, ambition, engineering." },
  { id: "earth-view", group: "nasa", file: "earth-view.jpg", description: "Earth seen from space, blue oceans and white clouds over Australia on black; global, humbling. Sustainability, travel, world news, big picture." },
  { id: "hubble", group: "nasa", file: "hubble.jpg", description: "The Hubble Space Telescope floating above Earth's clouds; technical, awe-inspiring. Research, instruments, engineering, discovery." },
  { id: "spacewalk", group: "nasa", file: "spacewalk.jpg", description: "An astronaut on a spacewalk with Earth's blue curve and clouds behind; adventurous, human. Teamwork, risk, hard projects, exploration." },
  { id: "neptune", group: "nasa", file: "neptune.jpg", description: "Deep blue Neptune with a dark storm on black; cool, serene, mysterious. Calm focus, depth, night mode, research." },
] as const satisfies readonly AtlasCoverPreset[];

export type AtlasCoverId = (typeof ATLAS_COVER_PRESETS)[number]["id"];
export const ATLAS_COVER_IDS = ATLAS_COVER_PRESETS.map((preset) => preset.id) as [AtlasCoverId, ...AtlasCoverId[]];
/** Source key of a preset's Atlas image, shared by every Page and every device. */
export const ATLAS_COVER_SOURCE_PREFIX = "cover-preset:";

export function isCoverId(value: unknown): value is AtlasCoverId {
  return typeof value === "string" && (ATLAS_COVER_IDS as string[]).includes(value);
}
export function coverPreset(id: string): AtlasCoverPreset | undefined {
  return ATLAS_COVER_PRESETS.find((preset) => preset.id === id);
}
