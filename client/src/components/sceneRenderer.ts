/**
 * Draws the scene behind the tokens: a Dungeoneer map (some animated, one
 * with walls that block sight) or a public-domain painting for places no map
 * covers.
 *
 * Maps, wall lines and animation settings come from Dungeoneer's default map
 * library (AGPL-3.0). See client/public/maps/README.md.
 */

export interface SceneArt {
	title: string;
	image: string;
	/** Tactical map: show the grid and tokens even outside combat. */
	map: boolean;
	/** Background drifts sideways (open sea). */
	slide?: boolean;
	/** A second image drawn on top of the background, in 0..1 of the canvas square. */
	overlay?: { image: string; x: number; y: number; w: number; h: number; bob?: boolean };
	/** Wall lines in 0..1 of the image. Sight stops at them. */
	walls?: number[][];
	/** Unlit: only what the party can see is shown. */
	dark?: boolean;
}

/** Places with no tactical map get a painting. */
const PAINTINGS: Record<string, { title: string; file: string }> = {
	village: { title: "A settled place", file: "the-past" },
	crypt: { title: "Ruins and graves", file: "abbey-in-the-oakwood" },
	coast: { title: "Shore and water", file: "isle-of-the-dead" },
	siege: { title: "Under attack", file: "destruction" },
	infernal: { title: "Fire and shadow", file: "pandemonium" },
	mountain: { title: "High country", file: "manfred-on-the-jungfrau" },
	dragon: { title: "The great beast", file: "saint-george-and-the-dragon" },
};

type Manifest = Record<string, Omit<SceneArt, "map" | "dark">>;
let manifest: Promise<Manifest> | null = null;

function loadManifest(): Promise<Manifest> {
	manifest ??= fetch("/maps/manifest.json")
		.then((res) => (res.ok ? res.json() : {}))
		.catch(() => ({}));
	return manifest;
}

export async function sceneArt(key: string): Promise<SceneArt> {
	const maps = await loadManifest();
	const map = maps[key];
	if (map) return { ...map, map: true, dark: key === "cave" };
	const painting = PAINTINGS[key] ?? PAINTINGS.village;
	return { title: painting.title, image: `/backgrounds/${painting.file}.jpg`, map: false };
}

const images = new Map<string, HTMLImageElement>();

/** Cached image; calls onReady once when a new one finishes loading. */
export function image(src: string, onReady: () => void): HTMLImageElement | null {
	const cached = images.get(src);
	if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
	const img = new Image();
	img.onload = onReady;
	img.src = src;
	images.set(src, img);
	return null;
}

/** Where a square image lands when it covers a width x height canvas. */
function coverBox(width: number, height: number, aspect = 1) {
	const w = Math.max(width, height * aspect);
	const h = w / aspect;
	return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

export function drawScene(
	ctx: CanvasRenderingContext2D,
	art: SceneArt,
	width: number,
	height: number,
	timeMs: number,
	redraw: () => void,
): void {
	const base = image(art.image, redraw);
	if (!base) return;
	const box = coverBox(width, height, base.naturalWidth / base.naturalHeight);

	if (art.slide) {
		// The sea scrolls under the ship, wrapping around.
		const shift = ((timeMs / 1000) * 14) % box.w;
		ctx.drawImage(base, box.x - shift, box.y, box.w, box.h);
		ctx.drawImage(base, box.x - shift + box.w, box.y, box.w, box.h);
	} else {
		ctx.drawImage(base, box.x, box.y, box.w, box.h);
	}

	if (art.overlay) {
		const over = image(art.overlay.image, redraw);
		if (over) {
			const o = art.overlay;
			const bob = o.bob ? Math.sin(timeMs / 900) * 3 : 0;
			const tilt = o.bob ? Math.sin(timeMs / 1400) * 0.008 : 0;
			const w = box.w * o.w * 1.9;
			const h = box.w * o.h * 1.9;
			ctx.save();
			ctx.translate(width / 2, height / 2 + bob);
			ctx.rotate(tilt);
			ctx.drawImage(over, -w / 2, -h / 2, w, h);
			ctx.restore();
		}
	}

	if (!art.map) {
		// Paintings sit back a little so tokens and text stay readable.
		ctx.fillStyle = "rgba(10, 12, 24, 0.25)";
		ctx.fillRect(0, 0, width, height);
	}
}

type Segment = [number, number, number, number];

function wallsOnCanvas(art: SceneArt, width: number, height: number): Segment[] {
	const box = coverBox(width, height, 1);
	return (art.walls ?? []).map(([x1, y1, x2, y2]) => [
		box.x + x1 * box.w,
		box.y + y1 * box.h,
		box.x + x2 * box.w,
		box.y + y2 * box.h,
	]);
}

/** Distance along the ray from (px,py) in direction (dx,dy) to a segment, or null. */
function hit(px: number, py: number, dx: number, dy: number, s: Segment): number | null {
	const sx = s[2] - s[0];
	const sy = s[3] - s[1];
	const denom = dx * sy - dy * sx;
	if (Math.abs(denom) < 1e-9) return null;
	const t = ((s[0] - px) * sy - (s[1] - py) * sx) / denom;
	const u = ((s[0] - px) * dy - (s[1] - py) * dx) / denom;
	return t > 0 && u >= 0 && u <= 1 ? t : null;
}

/** Everything visible from a point, out to a radius, with walls blocking sight. */
function visibleArea(px: number, py: number, radius: number, walls: Segment[]): [number, number][] {
	const near = walls.filter(
		(s) =>
			Math.min(s[0], s[2]) < px + radius &&
			Math.max(s[0], s[2]) > px - radius &&
			Math.min(s[1], s[3]) < py + radius &&
			Math.max(s[1], s[3]) > py - radius,
	);
	const angles: number[] = [];
	for (let i = 0; i < 48; i++) angles.push((i / 48) * Math.PI * 2 - Math.PI);
	for (const s of near) {
		for (const [x, y] of [
			[s[0], s[1]],
			[s[2], s[3]],
		]) {
			const a = Math.atan2(y - py, x - px);
			angles.push(a - 0.0005, a, a + 0.0005);
		}
	}
	angles.sort((a, b) => a - b);
	return angles.map((a) => {
		const dx = Math.cos(a);
		const dy = Math.sin(a);
		let reach = radius;
		for (const s of near) {
			const t = hit(px, py, dx, dy, s);
			if (t !== null && t < reach) reach = t;
		}
		return [px + dx * reach, py + dy * reach];
	});
}

let fogCanvas: HTMLCanvasElement | null = null;

/**
 * Darkness over an unlit map, cut open around each light source. Walls stop
 * the light, so a corridor is seen only as far as the party can see down it.
 */
export function drawDarkness(
	ctx: CanvasRenderingContext2D,
	art: SceneArt,
	width: number,
	height: number,
	lights: { x: number; y: number }[],
	radius: number,
): void {
	if (!art.dark) return;
	fogCanvas ??= document.createElement("canvas");
	if (fogCanvas.width !== width || fogCanvas.height !== height) {
		fogCanvas.width = width;
		fogCanvas.height = height;
	}
	const fog = fogCanvas.getContext("2d");
	if (!fog) return;
	fog.globalCompositeOperation = "source-over";
	fog.clearRect(0, 0, width, height);
	fog.fillStyle = "rgba(4, 6, 14, 0.9)";
	fog.fillRect(0, 0, width, height);

	const walls = wallsOnCanvas(art, width, height);
	fog.globalCompositeOperation = "destination-out";
	for (const light of lights) {
		const area = visibleArea(light.x, light.y, radius, walls);
		if (area.length < 3) continue;
		const glow = fog.createRadialGradient(light.x, light.y, radius * 0.15, light.x, light.y, radius);
		glow.addColorStop(0, "rgba(0,0,0,1)");
		glow.addColorStop(0.7, "rgba(0,0,0,0.85)");
		glow.addColorStop(1, "rgba(0,0,0,0)");
		fog.fillStyle = glow;
		fog.beginPath();
		fog.moveTo(area[0][0], area[0][1]);
		for (const [x, y] of area) fog.lineTo(x, y);
		fog.closePath();
		fog.fill();
	}
	ctx.drawImage(fogCanvas, 0, 0, width, height);
}
