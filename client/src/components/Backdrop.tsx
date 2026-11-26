/**
 * Full-screen painting behind the interface, greyed and darkened so text on
 * top stays readable. All images are public-domain works from Wikimedia
 * Commons; sources are listed in /backgrounds/credits.json.
 */

const SCENES = [
	"the-past",
	"saint-george-and-the-dragon",
	"abbey-in-the-oakwood",
	"isle-of-the-dead",
	"destruction",
	"pandemonium",
	"manfred-on-the-jungfrau",
] as const;

type Scene = (typeof SCENES)[number];

/** Words in an adventure's title, tone or pitch that suggest a particular painting. */
const HINTS: [RegExp, Scene][] = [
	[/dragon|wyrm|drake/i, "saint-george-and-the-dragon"],
	[/death|dead|crypt|tomb|grave|undead|damned|ghost|haunt|gothic|horror/i, "abbey-in-the-oakwood"],
	[/island|sea|ship|coast|pirate|clam|frog|swamp|lake/i, "isle-of-the-dead"],
	[/fire|demon|devil|hell|cult|infernal/i, "pandemonium"],
	[/war|tyranny|siege|outlaw|raid|army|battle/i, "destruction"],
	[/winter|snow|ice|mountain|north|peak|shrine/i, "manfred-on-the-jungfrau"],
	[/village|castle|festival|goblin|pie|comic|light/i, "the-past"],
];

/** The same text always gets the same painting. */
export function sceneFor(text: string | null | undefined): Scene {
	if (!text) return SCENES[0];
	for (const [pattern, scene] of HINTS) {
		if (pattern.test(text)) return scene;
	}
	let hash = 0;
	for (const ch of text) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return SCENES[hash % SCENES.length];
}

export function Backdrop({
	scene,
	dim = "lobby",
}: {
	scene?: string | null;
	/** "table" is darker, for the busy in-game screen. */
	dim?: "lobby" | "table";
}) {
	const name = sceneFor(scene);
	return (
		<div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden bg-slate-950">
			{SCENES.map((s) => (
				<div
					key={s}
					className="absolute inset-0 bg-cover bg-center transition-opacity duration-700"
					style={{
						backgroundImage: s === name ? `url(/backgrounds/${s}.jpg)` : undefined,
						opacity: s === name ? 1 : 0,
						filter:
							dim === "table"
								? "grayscale(0.65) brightness(0.42)"
								: "grayscale(0.6) brightness(0.45)",
						transform: "scale(1.03)",
					}}
				/>
			))}
			<div className="absolute inset-0 bg-gradient-to-b from-slate-950/40 via-slate-900/30 to-slate-950/80" />
		</div>
	);
}
