import * as THREE from 'three'
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js'
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js'
import {Pass} from 'three/addons/postprocessing/Pass.js'
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js'
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js'

export function blackHoleScene(canvas) {
	/**
	 * A black hole and what circles it, as a three.js scene. Lengths are in radii of the hole, which sits at the origin.
	 *
	 * The hole and its disk of gas are a simulation: light is traced through the
	 * curved space around the hole, pixel by pixel. See `holeFragment`.
	 *
	 * Around them is a scene of objects, and everything in it moves:
	 *
	 * - clouds: soft, lit puffs of gas. Dust and faint gas at the rim of the disk,
	 *   large cold clouds far around the scene, two jets along the axis of the
	 *   hole, and a stream of gas that the star loses to the disk;
	 * - spheres: a companion star with a boiling surface and a corona; a ringed
	 *   gas giant with a moon and a rocky planet, lit by the star and by the
	 *   disk; and a belt of tumbling rocks;
	 * - the sky: a nebula and 7,000 stars.
	 *
	 * Their light bends around the hole too. Every vertex that is behind the
	 * hole, as seen from the camera, is moved to where its light arrives from:
	 * the gravitational lens equation, in `LENS`. Stars slide around the hole as
	 * the camera moves, and each has a second, fainter image on the other side.
	 * In front of the hole nothing is bent.
	 *
	 * All motion is a function of the playhead, so scrubbing the timeline shows
	 * the same frame every time, and every orbit closes when the timeline loops:
	 * each makes a whole number of turns per loop.
	 *
	 * Bloom, a little lens colour and grain (three.js post-processing) finish the
	 * image. The timeline drives the camera: see `draw()` at the end.
	 */

	const DISK_IN = 3
	const DISK_OUT = 15
	/** The black disc is 2.6 radii wide: light closer than that never leaves. */
	const SHADOW = 2.6
	const STAR_ORBIT = 36
	const STAR_RADIUS = 3.2
	const TAU = Math.PI * 2

	// ---------------------------------------------------------------------------
	// Shaders
	// ---------------------------------------------------------------------------

	/**
	 * Where a point is seen, given that the hole bends its light. `image` is 1
	 * for the main image and -1 for the second one, on the other side of the hole.
	 * `behind` is how far the point is behind the hole; in front of it, nothing
	 * is bent.
	 */
	const LENS = /* glsl */ `
uniform vec3 uCam;

vec3 lens(vec3 point, float which, out float behind) {
	float away = length(uCam);
	vec3 axis = -uCam / away;
	float along = dot(point - uCam, axis);
	behind = along - away;
	if (behind <= 0.0) return point;

	// The point as it would be seen on the plane of the hole, without bending.
	vec3 unbent = uCam + (point - uCam) * (away / along);
	float aside = length(unbent);
	vec3 outward = aside > 1e-4 ? unbent / aside : vec3(0.0, 1.0, 0.0);
	// The Einstein radius, squared, for a hole of radius 1.
	float ring = 2.0 * away * behind / along;
	float seen = 0.5 * (aside + which * sqrt(aside * aside + 4.0 * ring));
	return uCam + (outward * seen - uCam) * (along / away);
}
`

	const NOISE = /* glsl */ `
float hash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
		f.z);
}
float fbm(vec3 p) {
	float sum = 0.0;
	float gain = 0.5;
	for (int i = 0; i < 4; i++) {
		sum += gain * noise(p);
		p = p * 2.03 + 7.1;
		gain *= 0.5;
	}
	return sum;
}
`

	/** The colour of hot gas, from deep red through orange to blue-white. */
	const HEAT = /* glsl */ `
vec3 heat(float t) {
	vec3 cold = vec3(0.55, 0.06, 0.01);
	vec3 warm = vec3(1.0, 0.36, 0.07);
	vec3 hot = vec3(1.0, 0.82, 0.55);
	vec3 white = vec3(0.82, 0.9, 1.0);
	return t < 0.35 ? mix(cold, warm, t / 0.35) : t < 0.7 ? mix(warm, hot, (t - 0.35) / 0.35) : mix(hot, white, (t - 0.7) / 0.3);
}
/** How much brighter matter on a circular orbit looks when it moves towards the camera. */
float doppler(vec3 point, vec3 camera) {
	float radius = max(length(point.xz), 1.6);
	vec3 velocity = normalize(vec3(-point.z, 0.0, point.x));
	float speed = sqrt(0.5 / radius);
	float shift = sqrt(1.0 - speed * speed) / (1.0 - speed * dot(velocity, normalize(camera - point)));
	return shift * sqrt(1.0 - 1.0 / radius);
}
`

	/**
	 * The hole and its disk: for every pixel, a ray of light is followed backwards
	 * from the camera through the curved space around the hole.
	 *
	 * - The path is that of light around a non-rotating (Schwarzschild) black
	 *   hole, exactly: the ray is stepped with the acceleration -1.5 h² r / |r|⁵,
	 *   where h is its angular momentum. A ray that comes within the horizon is
	 *   lost: that is the black disc. Rays that graze it circle the hole before
	 *   they leave, and pick up the disk again and again: the thin bright ring.
	 * - The disk is a volume of gas, thin and flared, and the ray is marched
	 *   through it: gas emits light and hides what is behind it. Its far side is
	 *   seen over the hole and its underside under it, because their light takes
	 *   the long way round. Nothing is drawn twice.
	 * - Gas circles at Kepler speed, √(1/2r) of the speed of light. Light from
	 *   gas that comes towards the camera is brighter and bluer, light from gas
	 *   that leaves is dimmer and redder (Doppler beaming), and all of it loses
	 *   energy climbing away from the hole (gravitational redshift).
	 * - The rest of the scene is behind and in front: a ray stops at the first
	 *   solid thing it meets, and what it has not met by then shows through.
	 */
	const holeVertex = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

	const holeFragment = /* glsl */ `
#define STEPS 250
#define REACH 21.0
uniform sampler2D tScene;
uniform sampler2D tDepth;
uniform sampler2D uNoise;
uniform vec3 uCam;
uniform vec3 uForward;
uniform mat4 uUnproject;
uniform float uTurn;
uniform float uNear;
uniform float uFar;
varying vec2 vUv;
${HEAT}

// Gas at this radius and angle: long streaks along the orbit, and lanes between them.
float gas(float radius, float angle) {
	float around = angle / 6.2831853;
	float streaks = texture2D(uNoise, vec2(around * 3.0, radius * 0.23)).r;
	float fine = texture2D(uNoise, vec2(around * 13.0, radius * 1.1)).g;
	float lanes = texture2D(uNoise, vec2(around * 1.0, radius * 0.67)).b;
	return streaks * 0.5 + fine * 0.28 + lanes * 0.42;
}

void main() {
	vec3 scene = texture2D(tScene, vUv).rgb;
	vec4 distant = uUnproject * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
	vec3 ray = normalize(distant.xyz / distant.w - uCam);

	// Rays that pass far from the hole are not bent enough to see: they show the scene as it is.
	float nearest = -dot(uCam, ray);
	float miss = length(uCam + ray * nearest);
	if (nearest < 0.0 || miss > REACH) {
		gl_FragColor = vec4(scene, 1.0);
		return;
	}

	// How far along this ray the first solid thing is: a planet, a rock, the star.
	float depth = texture2D(tDepth, vUv).r;
	float solid = depth >= 1.0 ? 1e9 : -(uNear * uFar / ((uFar - uNear) * depth - uFar)) / dot(ray, uForward);

	// Start where the ray comes within reach of the hole.
	float gone = max(0.0, nearest - sqrt(REACH * REACH - miss * miss));
	vec3 at = uCam + ray * gone;
	vec3 going = ray;
	vec3 momentum = cross(at, going);
	float h2 = dot(momentum, momentum);

	float cycle = uTurn * 4.0;
	float a = fract(cycle);
	float b = fract(cycle + 0.5);
	float blend = 1.0 - abs(a * 2.0 - 1.0);

	vec3 light = vec3(0.0);
	float through = 1.0;
	bool lost = false;

	for (int i = 0; i < STEPS; i++) {
		float r2 = dot(at, at);
		float r = sqrt(r2);
		if (r < 1.0) {
			lost = true;
			break;
		}
		if (r > REACH + 0.5 || gone > solid) break;

		// Long steps in empty space, short ones close to the hole and inside the gas.
		float across = length(at.xz);
		float pace = clamp(0.085 * r, 0.03, 1.4);
		if (across > ${(DISK_IN - 0.6).toFixed(1)} && across < ${(DISK_OUT + 0.6).toFixed(1)}) {
			pace = min(pace, 0.012 + 0.008 * across + 0.42 * abs(at.y));
		}
		going += -1.5 * h2 * at / (r2 * r2 * r) * pace;
		at += going * pace;
		gone += pace;

		float radius = length(at.xz);
		if (radius < ${DISK_IN.toFixed(1)} || radius > ${DISK_OUT.toFixed(1)}) continue;
		float thick = 0.045 + 0.03 * radius;
		float height = at.y / thick;
		if (abs(height) > 3.0) continue;

		// The whole disk turns twice per loop. On top of that the inside outruns the
		// outside, which would wind the pattern up for ever: so two copies of it are
		// wound, half a cycle apart, and each is faded out as the other takes over.
		float angle = atan(at.z, at.x) - uTurn * 12.5663706;
		float faster = pow(${DISK_IN.toFixed(1)} / radius, 1.5) * 7.0;
		float density = mix(gas(radius, angle - faster * (b - 0.5)), gas(radius, angle - faster * (a - 0.5)), blend);
		density = pow(max(density - 0.2, 0.0) * 1.55, 1.6);

		// Billows: where there is more gas the disk is thicker.
		height /= 0.55 + 0.9 * density;
		float amount = exp(-height * height)
			* smoothstep(${DISK_IN.toFixed(1)}, ${(DISK_IN + 0.5).toFixed(1)}, radius)
			* (1.0 - smoothstep(${(DISK_OUT * 0.55).toFixed(1)}, ${DISK_OUT.toFixed(1)}, radius))
			* (0.22 + 1.5 * density);
		if (amount < 0.002) continue;

		// Light travels against the ray. Gas that moves along it is brighter and bluer.
		vec3 orbit = vec3(-at.z, 0.0, at.x) / radius;
		float speed = sqrt(0.5 / radius);
		float shift = sqrt(1.0 - speed * speed) / (1.0 + speed * dot(orbit, normalize(going)));
		shift *= sqrt(1.0 - 1.0 / radius);

		float temperature = pow(${DISK_IN.toFixed(1)} / radius, 0.75);
		vec3 color = heat(clamp(temperature * 0.62 * shift + density * 0.22 + 0.12, 0.0, 1.0));
		float bright = (0.1 + 2.4 * temperature * temperature * temperature) * pow(shift, 2.6) * (0.5 + density);

		float hidden = 1.0 - exp(-amount * pace * 3.2 / thick * 0.35);
		light += through * color * bright * hidden;
		through *= 1.0 - hidden;
		if (through < 0.015) break;
	}

	if (lost) through = 0.0;
	gl_FragColor = vec4(light + scene * through, 1.0);
}
`

	/**
	 * Puffs of gas: flat squares that face the camera, with a cloud drawn on each.
	 * `MODE` picks where they are: 0 circling in the disk, 1 hanging far away,
	 * 2 shooting along the jets, 3 streaming from the star to the disk.
	 */
	const puffVertex = /* glsl */ `
${LENS}
${HEAT}
uniform float uTurn;
uniform float uStar;
uniform float uHalf;
attribute vec4 aPlace;
attribute vec4 aLook;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vShade;
varying float vOpaque;

void main() {
	float size = aLook.x;
	float seed = aLook.y;
	vec3 center;
	vec3 color;
	float alpha = 1.0;
	float opaque = 0.0;
	float spin = seed * 6.2831853;
	bool under = false;

#if MODE == 0
	// aPlace: radius, angle, height, turns per loop. aLook.w: 0 glowing gas, 1 dark dust.
	float radius = aPlace.x;
	float angle = aPlace.y + 6.2831853 * aPlace.w * uTurn;
	center = vec3(radius * cos(angle), aPlace.z * (1.0 + 0.3 * sin(angle * 2.0 + seed * 40.0)), radius * sin(angle));
	float temperature = pow(${DISK_IN.toFixed(1)} / radius, 0.9);
	float shift = doppler(center, uCam);
	opaque = aLook.w;
	color = mix(heat(clamp(temperature * 0.8 + aLook.z * 0.25, 0.0, 1.0)) * (0.03 + 0.22 * temperature) * pow(min(shift, 1.15), 2.0),
		vec3(0.20, 0.085, 0.045) * (0.6 + aLook.z), opaque);
	alpha = mix(0.1, 0.13, opaque);
	spin += angle;
#elif MODE == 1
	// aPlace: where it hangs. aLook.z: which colour. It rolls slowly, once per loop.
	center = aPlace.xyz;
	vec3 teal = vec3(0.07, 0.3, 0.42);
	vec3 violet = vec3(0.36, 0.12, 0.46);
	vec3 rust = vec3(0.5, 0.2, 0.09);
	color = (aLook.z < 0.4 ? mix(teal, violet, aLook.z / 0.4) : mix(violet, rust, (aLook.z - 0.4) / 0.6)) * 0.22;
	alpha = 0.2;
	opaque = 0.55;
	spin += 6.2831853 * uTurn * aPlace.w;
#elif MODE == 2
	// aPlace: where along the jet it starts, which side, angle, cycles per loop.
	float along = fract(aPlace.x + uTurn * aPlace.w);
	float height = 4.5 + 50.0 * along * along;
	float wide = 0.1 + 0.05 * height;
	float angle = aPlace.z + height * 0.3 - uTurn * 12.5663706;
	center = vec3(wide * cos(angle), aPlace.y * height, wide * sin(angle));
	color = mix(vec3(0.45, 0.7, 1.0), vec3(0.12, 0.25, 1.0), along) * 1.1;
	alpha = smoothstep(0.0, 0.12, along) * pow(1.0 - along, 1.6) * 0.1;
	size *= 0.3 + 1.9 * along;
	// The jet on the other side of the disk is seen through the disk: it belongs behind it.
	under = aPlace.y * uCam.y < 0.0;
#else
	// aPlace: where along the stream it starts, across it, above it, cycles per loop.
	float along = fract(aPlace.x + uTurn * aPlace.w);
	float spread = 0.3 + 1.5 * (1.0 - along);
	float radius = mix(${(STAR_ORBIT - STAR_RADIUS * 0.8).toFixed(1)}, ${(DISK_OUT - 2.5).toFixed(1)}, pow(along, 0.75)) + aPlace.y * spread;
	float angle = uStar + 0.06 + along * 3.6;
	center = vec3(radius * cos(angle), aPlace.z * spread * 0.7, radius * sin(angle));
	color = mix(vec3(1.0, 0.62, 0.25), vec3(1.0, 0.3, 0.07), along) * 0.8;
	alpha = smoothstep(0.0, 0.05, along) * (1.0 - smoothstep(0.82, 1.0, along)) * 0.13;
	size *= 0.7 + 0.6 * along;
	spin += angle;
#endif

	float behind;
	vec4 view = viewMatrix * vec4(lens(center, 1.0, behind), 1.0);
	// Lit from the hole: the side of a puff that faces the disk is the bright side.
	vec3 toLight = (viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz - view.xyz;
	vShade = vec3(normalize(toLight.xy + 1e-4), spin);
	vUv = uv * 2.0 - 1.0;
	vColor = vec4(color, alpha);
	vOpaque = opaque;
	view.xy += position.xy * size;
	gl_Position = projectionMatrix * view;
	// Drawn in two goes: what is behind the hole before it, and what is in front of the hole after it.
	if ((uHalf > 0.0) != (behind > 0.0 || under)) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`

	const puffFragment = /* glsl */ `
uniform sampler2D uNoise;
uniform sampler2D tSolid;
uniform vec2 uSize;
uniform float uHalf;
varying vec2 vUv;
varying vec4 vColor;
varying vec3 vShade;
varying float vOpaque;

void main() {
	float reach = length(vUv);
	if (reach > 1.0) discard;
	// In the second go the solid things are already drawn: stay behind them.
	if (uHalf < 0.0 && gl_FragCoord.z > texture2D(tSolid, gl_FragCoord.xy / uSize).r) discard;

	float turned = vShade.z;
	vec2 at = mat2(cos(turned), -sin(turned), sin(turned), cos(turned)) * vUv;
	vec4 cloud = texture2D(uNoise, at * 0.17 + vec2(turned * 0.37, turned * 0.11));
	// A cloud, not a disc: the noise eats into the edge and leaves holes.
	float body = smoothstep(0.18, 0.72, cloud.r * 0.75 + cloud.a * 0.4 + (1.0 - reach) * 0.62 - 0.4);
	float alpha = body * smoothstep(1.0, 0.45, reach) * vColor.a;
	float lit = 0.6 + 0.5 * dot(vUv, vShade.xy) + (cloud.g - 0.5) * 0.7;
	// Colour is added to what is behind it; 'opaque' also hides what is behind.
	gl_FragColor = vec4(vColor.rgb * max(lit, 0.08) * alpha, alpha * vOpaque);
}
`

	const dotFragment = /* glsl */ `
varying vec3 vColor;
void main() {
	float reach = length(gl_PointCoord * 2.0 - 1.0);
	float alpha = smoothstep(1.0, 0.2, reach);
	gl_FragColor = vec4(vColor * alpha, 0.0);
}
`

	const starsVertex = /* glsl */ `
${LENS}
uniform float uTurn;
uniform float uScale;
uniform float uImage;
attribute vec3 aStar;
varying vec3 vColor;

void main() {
	float behind;
	vec3 seen = lens(position, uImage, behind);
	// Stars twinkle a whole number of times per loop.
	float twinkle = 0.75 + 0.25 * sin(aStar.z * 6.2831853 + uTurn * 6.2831853 * floor(3.0 + aStar.z * 9.0));
	vec3 tint = aStar.y < 0.5 ? mix(vec3(1.0, 0.72, 0.5), vec3(1.0), aStar.y * 2.0) : mix(vec3(1.0), vec3(0.62, 0.76, 1.0), aStar.y * 2.0 - 1.0);
	// The second image is small and faint, and there is none of a star that is not behind the hole.
	float strength = uImage > 0.0 ? 1.0 : step(0.0001, behind) * 0.45;
	vColor = tint * twinkle * aStar.x * aStar.x * 1.6 * strength;
	gl_Position = projectionMatrix * viewMatrix * vec4(seen, 1.0);
	gl_PointSize = max(1.0, uScale * (0.6 + 1.5 * aStar.x));
}
`

	const skyVertex = /* glsl */ `
varying vec3 vDirection;
void main() {
	vDirection = normalize(position);
	gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
}
`

	const skyFragment = /* glsl */ `
varying vec3 vDirection;
${NOISE}
void main() {
	vec3 d = normalize(vDirection);
	float clouds = fbm(d * 2.2 + 3.0);
	float wisps = fbm(d * 5.5 - 11.0);
	// A band of dust and light across the sky, like a galaxy seen from inside.
	float band = exp(-pow((d.y * 0.92 + d.x * 0.38 + (clouds - 0.5) * 0.5) * 3.2, 2.0));
	vec3 color = vec3(0.004, 0.006, 0.014);
	color += vec3(0.11, 0.05, 0.16) * pow(clouds, 2.6) * 1.7;
	color += vec3(0.02, 0.1, 0.14) * pow(wisps, 3.0) * 1.5;
	color += vec3(0.16, 0.11, 0.09) * band * (0.25 + wisps);
	color *= 1.0 - 0.75 * band * smoothstep(0.5, 0.7, wisps);
	gl_FragColor = vec4(color, 1.0);
}
`

	const sunVertex = /* glsl */ `
${LENS}
varying vec3 vLocal;
varying vec3 vNormalWorld;
varying vec3 vWorld;
void main() {
	vLocal = position;
	vec4 world = modelMatrix * vec4(position, 1.0);
	vWorld = world.xyz;
	vNormalWorld = normalize(mat3(modelMatrix) * normal);
	float behind;
	gl_Position = projectionMatrix * viewMatrix * vec4(lens(world.xyz, 1.0, behind), 1.0);
}
`

	const sunFragment = /* glsl */ `
uniform float uTurn;
uniform vec3 uCam;
varying vec3 vLocal;
varying vec3 vNormalWorld;
varying vec3 vWorld;
${NOISE}

float surface(vec3 p, float phase) {
	// Cells that boil: the pattern drifts outwards through the noise.
	float cells = fbm(p * 1.5 + vec3(0.0, phase * 1.3, phase));
	float fine = fbm(p * 5.0 - vec3(phase * 2.0, 0.0, phase));
	return cells * 0.7 + fine * 0.5;
}

void main() {
	float cycle = uTurn * 4.0;
	float a = fract(cycle);
	float b = fract(cycle + 0.5);
	float boil = mix(surface(vLocal, b + 3.0), surface(vLocal, a), 1.0 - abs(a * 2.0 - 1.0));
	float facing = max(dot(normalize(vNormalWorld), normalize(uCam - vWorld)), 0.0);

	vec3 color = mix(vec3(1.0, 0.2, 0.02), vec3(1.0, 0.72, 0.25), smoothstep(0.35, 0.75, boil));
	color = mix(color, vec3(1.0, 0.97, 0.85), smoothstep(0.72, 0.95, boil));
	// Darker towards the edge, as a real star is, with a bright rim of gas.
	color *= 0.55 + 1.5 * pow(facing, 0.55);
	color += vec3(1.0, 0.45, 0.12) * pow(1.0 - facing, 3.0) * 1.6;
	gl_FragColor = vec4(color * 1.15, 1.0);
}
`

	/** A glow around a sphere: a square that faces the camera, where the sphere is seen. */
	const coronaVertex = /* glsl */ `
${LENS}
varying vec2 vUv;
void main() {
	vUv = uv * 2.0 - 1.0;
	float behind;
	vec4 view = viewMatrix * vec4(lens((modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz, 1.0, behind), 1.0);
	view.xy += position.xy;
	gl_Position = projectionMatrix * view;
}
`

	/** The corona of the star: a glow with rays that slowly turn. */
	const coronaFragment = /* glsl */ `
uniform float uTurn;
uniform sampler2D uNoise;
varying vec2 vUv;
void main() {
	float reach = length(vUv);
	float angle = atan(vUv.y, vUv.x) / 6.2831853;
	float rays = texture2D(uNoise, vec2(angle * 2.0 + uTurn, reach * 0.12 - uTurn * 2.0)).r;
	float glow = pow(max(1.0 - reach, 0.0), 2.6);
	vec3 color = vec3(1.0, 0.5, 0.16) * glow * (0.5 + 1.9 * rays) * 0.8;
	gl_FragColor = vec4(color, 0.0);
}
`

	/** Last, over the whole image: colours part slightly towards the corners, which darken, and film grain. */
	const finish = {
		uniforms: {tDiffuse: {value: null}, uTime: {value: 0}},
		vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,
		fragmentShader: /* glsl */ `
		uniform sampler2D tDiffuse;
		uniform float uTime;
		varying vec2 vUv;
		void main() {
			vec2 off = vUv - 0.5;
			float far = dot(off, off);
			vec3 color = vec3(
				texture2D(tDiffuse, vUv - off * far * 0.014).r,
				texture2D(tDiffuse, vUv).g,
				texture2D(tDiffuse, vUv + off * far * 0.014).b);
			color *= 1.0 - far * 0.85;
			float grain = fract(sin(dot(vUv * 913.0 + uTime, vec2(12.9898, 78.233))) * 43758.5453);
			color += (grain - 0.5) * 0.012;
			gl_FragColor = vec4(max(color, 0.0), 1.0);
		}
	`,
	}

	// ---------------------------------------------------------------------------
	// Building blocks
	// ---------------------------------------------------------------------------

	/** The same numbers every time: the scene looks the same on every visit. */
	function random(seed) {
		let state = seed >>> 0
		return () => {
			state = (state + 0x6d2b79f5) | 0
			let t = Math.imul(state ^ (state >>> 15), 1 | state)
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296
		}
	}

	/**
	 * Cloudy noise that repeats at its edges, with a different cloud in each of
	 * the four channels. Everything soft in the scene is cut from it.
	 */
	function noiseTexture() {
		const size = 256
		const data = new Uint8Array(size * size * 4)
		const next = random(7)
		for (let channel = 0; channel < 4; channel++) {
			const sum = new Float32Array(size * size)
			let gain = 0.5
			for (let cells = 4; cells <= 64; cells *= 2) {
				const grid = Float32Array.from({length: cells * cells}, next)
				const at = (x, y) => grid[(y % cells) * cells + (x % cells)]
				for (let y = 0; y < size; y++) {
					const gy = (y / size) * cells
					const y0 = Math.floor(gy)
					let fy = gy - y0
					fy = fy * fy * (3 - 2 * fy)
					for (let x = 0; x < size; x++) {
						const gx = (x / size) * cells
						const x0 = Math.floor(gx)
						let fx = gx - x0
						fx = fx * fx * (3 - 2 * fx)
						const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * fx
						const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * fx
						sum[y * size + x] += gain * (top + (bottom - top) * fy)
					}
				}
				gain *= 0.5
			}
			for (let i = 0; i < sum.length; i++) data[i * 4 + channel] = Math.min(255, Math.max(0, sum[i] * 1.03 * 255))
		}
		const texture = new THREE.DataTexture(data, size, size)
		texture.wrapS = texture.wrapT = THREE.RepeatWrapping
		// No smaller copies: where an angle wraps around, they would draw a seam.
		texture.minFilter = texture.magFilter = THREE.LinearFilter
		texture.needsUpdate = true
		return texture
	}

	/** How many whole turns per loop something at this radius makes: faster inside, like a real orbit. */
	const turns = radius => Math.max(1, Math.round(2 * Math.pow(DISK_OUT / radius, 1.5)))

	function canvasTexture(width, height, paint) {
		const canvas = document.createElement('canvas')
		canvas.width = width
		canvas.height = height
		paint(canvas.getContext('2d'))
		const texture = new THREE.CanvasTexture(canvas)
		texture.colorSpace = THREE.SRGBColorSpace
		return texture
	}

	/** The bands and storms of a gas giant. */
	function giantTexture() {
		const next = random(21)
		return canvasTexture(512, 256, context => {
			const palette = ['#c9a27a', '#e8d2b0', '#a8683f', '#f1e3c8', '#8a5a3c', '#d9b48a', '#b9805a']
			let y = 0
			while (y < 256) {
				const band = 6 + next() * 26
				context.fillStyle = palette[Math.floor(next() * palette.length)]
				context.fillRect(0, y, 512, band + 1)
				y += band
			}
			// Streaks that follow the bands, and a few storms.
			for (let i = 0; i < 900; i++) {
				context.globalAlpha = 0.05 + next() * 0.12
				context.fillStyle = next() < 0.5 ? '#fff4dc' : '#6b3f26'
				context.fillRect(next() * 512, next() * 256, 20 + next() * 120, 1 + next() * 2.5)
			}
			for (let i = 0; i < 7; i++) {
				context.globalAlpha = 0.5
				context.fillStyle = i ? '#f3e2c4' : '#a5482c'
				context.beginPath()
				context.ellipse(next() * 512, 40 + next() * 176, 8 + next() * 18, 4 + next() * 7, 0, 0, TAU)
				context.fill()
			}
			// The poles are darker.
			const shade = context.createLinearGradient(0, 0, 0, 256)
			shade.addColorStop(0, 'rgba(40,20,10,0.6)')
			shade.addColorStop(0.2, 'rgba(40,20,10,0)')
			shade.addColorStop(0.8, 'rgba(40,20,10,0)')
			shade.addColorStop(1, 'rgba(40,20,10,0.6)')
			context.globalAlpha = 1
			context.fillStyle = shade
			context.fillRect(0, 0, 512, 256)
		})
	}

	/** Rock, with craters. */
	function rockTexture() {
		const next = random(34)
		return canvasTexture(512, 256, context => {
			context.fillStyle = '#7d736b'
			context.fillRect(0, 0, 512, 256)
			for (let i = 0; i < 1400; i++) {
				context.globalAlpha = 0.04 + next() * 0.1
				context.fillStyle = next() < 0.5 ? '#3d3632' : '#b5a99c'
				context.beginPath()
				context.arc(next() * 512, next() * 256, 2 + next() * 22, 0, TAU)
				context.fill()
			}
			for (let i = 0; i < 90; i++) {
				const x = next() * 512
				const y = next() * 256
				const radius = 2 + next() * next() * 16
				context.globalAlpha = 0.5
				context.fillStyle = '#2f2a27'
				context.beginPath()
				context.arc(x, y, radius, 0, TAU)
				context.fill()
				context.globalAlpha = 0.45
				context.strokeStyle = '#cdc2b6'
				context.lineWidth = 1
				context.beginPath()
				context.arc(x - radius * 0.12, y - radius * 0.12, radius, 0, TAU)
				context.stroke()
			}
		})
	}

	/** The rings of the giant: thin bands with gaps, across the width of the texture. */
	function ringsTexture() {
		const next = random(55)
		return canvasTexture(256, 4, context => {
			context.clearRect(0, 0, 256, 4)
			for (let x = 0; x < 256; x++) {
				const gap = (x > 96 && x < 108) || (x > 176 && x < 181)
				context.globalAlpha = gap ? 0.03 : 0.35 + next() * 0.55
				context.fillStyle = next() < 0.5 ? '#d8c3a0' : '#a48b6c'
				context.fillRect(x, 0, 1, 4)
			}
		})
	}

	/**
	 * Makes one of three.js's own materials bend around the hole, like the rest
	 * of the scene: its vertices go through `lens` before they are projected.
	 */
	function bend(material, shared) {
		material.onBeforeCompile = shader => {
			shader.uniforms.uCam = shared.uCam
			shader.vertexShader =
				LENS +
				shader.vertexShader.replace(
					'#include <project_vertex>',
					/* glsl */ `
				vec4 mvPosition = vec4(transformed, 1.0);
				#ifdef USE_INSTANCING
					mvPosition = instanceMatrix * mvPosition;
				#endif
				mvPosition = modelMatrix * mvPosition;
				float lensBehind;
				mvPosition = viewMatrix * vec4(lens(mvPosition.xyz, 1.0, lensBehind), 1.0);
				gl_Position = projectionMatrix * mvPosition;
				`,
				)
		}
		return material
	}

	/** Squares that face the camera, one per puff. `fill` writes the place and the look of each. */
	function puffs(count, mode, shared, fill) {
		const square = new THREE.PlaneGeometry(2, 2)
		const geometry = new THREE.InstancedBufferGeometry()
		geometry.index = square.index
		geometry.setAttribute('position', square.getAttribute('position'))
		geometry.setAttribute('uv', square.getAttribute('uv'))
		const place = new Float32Array(count * 4)
		const look = new Float32Array(count * 4)
		for (let i = 0; i < count; i++) fill(place.subarray(i * 4, i * 4 + 4), look.subarray(i * 4, i * 4 + 4), i)
		geometry.setAttribute('aPlace', new THREE.InstancedBufferAttribute(place, 4))
		geometry.setAttribute('aLook', new THREE.InstancedBufferAttribute(look, 4))
		geometry.instanceCount = count

		const material = new THREE.ShaderMaterial({
			vertexShader: puffVertex,
			fragmentShader: puffFragment,
			defines: {MODE: mode},
			uniforms: shared,
			transparent: true,
			premultipliedAlpha: true,
			depthWrite: false,
		})
		const mesh = new THREE.Mesh(geometry, material)
		mesh.frustumCulled = false
		// Layer 1 is what is drawn again in front of the hole.
		mesh.layers.enable(1)
		return mesh
	}

	/** Adds colour to what is behind it, and hides nothing. */
	const light = {transparent: true, premultipliedAlpha: true, depthWrite: false}

	// ---------------------------------------------------------------------------
	// The scene
	// ---------------------------------------------------------------------------

	/** The scene without the hole, into a picture that also knows how far away each solid thing is. */
	class ScenePass extends Pass {
		target = new THREE.WebGLRenderTarget(1, 1, {type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(1, 1)})

		constructor(scene, camera, shared) {
			super()
			this.scene = scene
			this.camera = camera
			this.shared = shared
			this.needsSwap = false
		}
		setSize(width, height) {
			this.target.setSize(width, height)
			this.shared.uSize.value.set(width, height)
		}
		render(renderer) {
			// Clouds: only those behind the hole. The others come after the hole is drawn.
			this.shared.uHalf.value = 1
			this.shared.tSolid.value = null
			this.camera.layers.set(0)
			renderer.setRenderTarget(this.target)
			renderer.render(this.scene, this.camera)
		}
		dispose() {
			this.target.dispose()
		}
	}

	/** The clouds in front of the hole, over the picture so far. */
	class FrontPass extends Pass {
		constructor(scene, camera, shared, solid) {
			super()
			this.scene = scene
			this.camera = camera
			this.shared = shared
			this.solid = solid
			this.needsSwap = false
		}
		render(renderer, _write, read) {
			this.shared.uHalf.value = -1
			this.shared.tSolid.value = this.solid.depthTexture
			this.camera.layers.set(1)
			const clears = renderer.autoClear
			renderer.autoClear = false
			renderer.setRenderTarget(read)
			renderer.clearDepth()
			renderer.render(this.scene, this.camera)
			renderer.autoClear = clears
			this.camera.layers.set(0)
			this.shared.tSolid.value = null
		}
	}

	/** `oval` is the eccentricity of the orbit, and `turned` where its nearest point is. */

	const orbit = {radius: 0, angle: 0}

	/**
	 * Where a body is on its orbit: an ellipse with the hole at one focus, swept
	 * faster near the hole than far from it (Kepler's laws). `mean` is the angle
	 * the body would have on a circle; Kepler's equation, solved by Newton's
	 * method, turns it into the place on the ellipse.
	 */
	function kepler(mean, size, oval, turned) {
		let e = mean
		for (let i = 0; i < 6; i++) e -= (e - oval * Math.sin(e) - mean) / (1 - oval * Math.cos(e))
		orbit.radius = size * (1 - oval * Math.cos(e))
		orbit.angle = turned + 2 * Math.atan2(Math.sqrt(1 + oval) * Math.sin(e / 2), Math.sqrt(1 - oval) * Math.cos(e / 2))
		return orbit
	}

	const MIN_RATIO = 0.3

	class BlackHoleView {
		renderer
		composer
		finish
		scene = new THREE.Scene()
		camera = new THREE.PerspectiveCamera(42, 16 / 9, 0.1, 2000)
		shared
		solid
		hole
		orbiters = []
		star = new THREE.Object3D()
		rocks
		rockPlaces
		helper = new THREE.Object3D()

		/** Render pixels per stage pixel. Lowered when frames arrive late, raised again when they do not. */
		ratio = 1
		maxRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1) * 1.25)
		ceiling = this.maxRatio
		raised = false
		/** Frames in a row that took far too long. */
		late = 0
		/** The shortest average frame seen: about the display's own interval. */
		fastest = Infinity
		gaps = []
		stamp = 0
		drawn = ''
		size = ''

		constructor(canvas) {
			this.renderer = new THREE.WebGLRenderer({
				canvas,
				antialias: false,
				alpha: false,
				powerPreference: 'high-performance',
			})
			this.renderer.toneMapping = THREE.ACESFilmicToneMapping
			this.renderer.toneMappingExposure = 1

			const shared = (this.shared = {
				uCam: {value: new THREE.Vector3()},
				uTurn: {value: 0},
				uStar: {value: 0},
				uScale: {value: 1},
				uNoise: {value: noiseTexture()},
				// Which half of the scene the clouds are drawn for, and the solid things they stay behind.
				uHalf: {value: 1},
				tSolid: {value: null},
				uSize: {value: new THREE.Vector2(1, 1)},
			})
			const scene = this.scene
			const next = random(1)
			/** Mostly small values: `bell() * width` is a soft-edged layer. */
			const bell = () => (next() + next() + next() - 1.5) / 1.5

			// --- The sky: a nebula, and stars, each drawn twice (the hole shows a second image of every star).
			const sky = new THREE.Mesh(
				new THREE.SphereGeometry(900, 32, 16),
				new THREE.ShaderMaterial({
					vertexShader: skyVertex,
					fragmentShader: skyFragment,
					side: THREE.BackSide,
					depthWrite: false,
				}),
			)
			sky.frustumCulled = false
			sky.renderOrder = -10
			scene.add(sky)

			const starCount = 7000
			const starPlaces = new Float32Array(starCount * 3)
			const starLooks = new Float32Array(starCount * 3)
			for (let i = 0; i < starCount; i++) {
				const y = next() * 2 - 1
				const angle = next() * TAU
				const flat = Math.sqrt(1 - y * y)
				starPlaces.set([flat * Math.cos(angle) * 700, y * 700, flat * Math.sin(angle) * 700], i * 3)
				// Most stars are faint; a few are bright.
				starLooks.set([0.25 + 0.75 * Math.pow(next(), 4), next(), next()], i * 3)
			}
			const starGeometry = new THREE.BufferGeometry()
			starGeometry.setAttribute('position', new THREE.BufferAttribute(starPlaces, 3))
			starGeometry.setAttribute('aStar', new THREE.BufferAttribute(starLooks, 3))
			for (const image of [1, -1]) {
				const stars = new THREE.Points(
					starGeometry,
					new THREE.ShaderMaterial({
						vertexShader: starsVertex,
						fragmentShader: dotFragment,
						uniforms: {...shared, uImage: {value: image}},
						...light,
					}),
				)
				stars.frustumCulled = false
				stars.renderOrder = -9
				scene.add(stars)
			}

			// --- Far clouds: cold gas and dust that hangs around the whole scene.
			const far = puffs(170, 1, shared, (place, look) => {
				const angle = next() * TAU
				const radius = 70 + next() * 150
				place.set([radius * Math.cos(angle), bell() * 46, radius * Math.sin(angle), next() < 0.5 ? 1 : -1])
				look.set([16 + next() * 34, next(), next(), 0])
			})
			far.renderOrder = -8
			scene.add(far)

			// --- Clouds at the rim of the disk, where it thins out: faintly glowing gas, and dark dust.
			const clouds = puffs(520, 0, shared, (place, look) => {
				const radius = DISK_OUT - 2.5 + Math.pow(next(), 1.4) * 8
				const dust = next() < 0.5 ? 1 : 0
				place.set([radius, next() * TAU, bell() * (0.12 + radius * 0.075), turns(radius)])
				look.set([0.5 + next() * 0.55 + radius * 0.13, next(), next(), dust])
			})
			clouds.renderOrder = 2
			scene.add(clouds)

			// --- Jets: gas thrown out along the axis of the hole, both ways.
			const jets = puffs(800, 2, shared, (place, look, i) => {
				place.set([next(), i % 2 ? 1 : -1, next() * TAU, 3 + Math.floor(next() * 3)])
				look.set([0.5 + next() * 0.5, next(), next(), 0])
			})
			jets.renderOrder = 4
			scene.add(jets)

			// --- The companion star, its corona, and the gas it loses to the disk.
			const sun = new THREE.Mesh(
				new THREE.SphereGeometry(STAR_RADIUS, 64, 32),
				new THREE.ShaderMaterial({vertexShader: sunVertex, fragmentShader: sunFragment, uniforms: shared}),
			)
			const corona = new THREE.Mesh(
				new THREE.PlaneGeometry(STAR_RADIUS * 7.6, STAR_RADIUS * 7.6),
				new THREE.ShaderMaterial({
					vertexShader: coronaVertex,
					fragmentShader: coronaFragment,
					uniforms: shared,
					...light,
				}),
			)
			corona.renderOrder = 5
			corona.frustumCulled = false
			const sunlight = new THREE.PointLight(0xfff0d8, 1400, 0, 2)
			this.star.add(sun, corona, sunlight)
			scene.add(this.star)

			const stream = puffs(1100, 3, shared, (place, look) => {
				place.set([next(), bell(), bell(), 2 + Math.floor(next() * 2)])
				look.set([0.7 + next() * 0.8, next(), next(), 0])
			})
			stream.renderOrder = 4
			scene.add(stream)

			// --- Planets, lit by the star and by the glow of the disk.
			scene.add(new THREE.AmbientLight(0xa9a0b8, 0.32), new THREE.PointLight(0xffa060, 700, 0, 2))

			const giant = new THREE.Object3D()
			const giantBall = new THREE.Mesh(
				new THREE.SphereGeometry(1.5, 64, 32),
				bend(new THREE.MeshStandardMaterial({map: giantTexture(), roughness: 0.9, metalness: 0}), shared),
			)
			const bandGeometry = new THREE.RingGeometry(2.0, 3.5, 128, 1)
			// Across the rings, not around them: the texture is a row of bands.
			const bandPlaces = bandGeometry.getAttribute('position')
			const bandUv = bandGeometry.getAttribute('uv')
			for (let i = 0; i < bandPlaces.count; i++) {
				bandUv.setXY(i, (Math.hypot(bandPlaces.getX(i), bandPlaces.getY(i)) - 2.0) / 1.5, 0.5)
			}
			bandGeometry.rotateX(-Math.PI / 2)
			const bands = new THREE.Mesh(
				bandGeometry,
				bend(
					new THREE.MeshStandardMaterial({
						map: ringsTexture(),
						transparent: true,
						side: THREE.DoubleSide,
						roughness: 1,
						depthWrite: false,
					}),
					shared,
				),
			)
			const tilted = new THREE.Object3D()
			tilted.rotation.set(0.42, 0, 0.2)
			tilted.add(giantBall, bands)
			giant.add(tilted)
			// A moon, which circles the giant.
			const moon = new THREE.Mesh(
				new THREE.SphereGeometry(0.3, 32, 16),
				bend(new THREE.MeshStandardMaterial({map: rockTexture(), roughness: 1}), shared),
			)
			giant.add(moon)
			scene.add(giant)
			// It passes between the camera and the hole near the end of the loop, when the camera is far out.
			this.orbiters.push({body: giant, radius: 23, phase: 5.38, turns: 2, tilt: 0.1, spin: 6, oval: 0.1, turned: 0.6})
			this.orbiters.push({body: moon, radius: 4.4, phase: 0.5, turns: 7, tilt: 0.35, spin: 7, oval: 0.2, turned: 1})

			const rocky = new THREE.Mesh(
				new THREE.SphereGeometry(0.62, 48, 24),
				bend(new THREE.MeshStandardMaterial({map: rockTexture(), roughness: 1, color: 0xd9b9a0}), shared),
			)
			scene.add(rocky)
			this.orbiters.push({
				body: rocky,
				radius: 18.4,
				phase: 5.1,
				turns: 3,
				tilt: -0.12,
				spin: 4,
				oval: 0.09,
				turned: 2.4,
			})

			// --- A belt of rocks, each tumbling as it goes.
			const rockGeometry = new THREE.IcosahedronGeometry(1, 1)
			const rockShape = rockGeometry.getAttribute('position')
			for (let i = 0; i < rockShape.count; i++) {
				// The same push for the same corner, wherever it appears in the list of triangles.
				const x = rockShape.getX(i)
				const y = rockShape.getY(i)
				const z = rockShape.getZ(i)
				const push = 0.72 + (Math.abs(Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1) * 0.5
				rockShape.setXYZ(i, x * push, y * push * 0.8, z * push)
			}
			rockGeometry.computeVertexNormals()
			const rockCount = 320
			this.rocks = new THREE.InstancedMesh(
				rockGeometry,
				bend(new THREE.MeshStandardMaterial({color: 0x8d8279, roughness: 1, flatShading: true}), shared),
				rockCount,
			)
			this.rocks.frustumCulled = false
			// Per rock: size of the orbit, angle, tilt, size, turns, how it tumbles, and the shape of its orbit.
			this.rockPlaces = new Float32Array(rockCount * 10)
			for (let i = 0; i < rockCount; i++) {
				const radius = 16.6 + next() * 4.6
				this.rockPlaces.set(
					[
						radius,
						next() * TAU,
						bell() * 0.9,
						0.04 + Math.pow(next(), 3) * 0.26,
						radius < 18.6 ? 3 : 2,
						next() * TAU,
						next() * TAU,
						(1 + Math.floor(next() * 5)) * (next() < 0.5 ? 1 : -1),
						// Never so oval that it dips into the disk.
						next() * Math.min(0.12, (radius - 15.8) / radius),
						next() * TAU,
					],
					i * 10,
				)
			}
			scene.add(this.rocks)

			// Four steps make the image. The scene, without the hole; the hole and its disk, traced over it;
			// then the clouds that are in front of the hole; then the glow of everything bright.
			const camera = this.camera
			this.solid = new ScenePass(scene, camera, shared)
			this.hole = new ShaderPass(
				new THREE.ShaderMaterial({
					vertexShader: holeVertex,
					fragmentShader: holeFragment,
					uniforms: {
						tScene: {value: this.solid.target.texture},
						tDepth: {value: this.solid.target.depthTexture},
						uNoise: shared.uNoise,
						uCam: shared.uCam,
						uTurn: shared.uTurn,
						uForward: {value: new THREE.Vector3()},
						uUnproject: {value: new THREE.Matrix4()},
						uNear: {value: camera.near},
						uFar: {value: camera.far},
					},
					depthTest: false,
					depthWrite: false,
				}),
			)
			this.composer = new EffectComposer(this.renderer)
			this.composer.addPass(this.solid)
			this.composer.addPass(this.hole)
			this.composer.addPass(new FrontPass(scene, camera, shared, this.solid.target))
			this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(640, 360), 0.42, 0.75, 0.8))
			this.finish = new ShaderPass(finish)
			this.composer.addPass(this.finish)
			this.composer.addPass(new OutputPass())
		}

		/** Draws a frame, unless it would be the frame already on screen. */
		draw(frame, playing) {
			const width = Math.max(1, Math.round(frame.width))
			const height = Math.max(1, Math.round(frame.height))
			const key = [frame.rotation, frame.scale, frame.time, frame.duration, width, height].join()
			if (key === this.drawn) return
			this.drawn = key

			if (frame.playing) this.adapt()
			else this.stamp = 0

			const size = [width, height, this.ratio].join()
			if (size !== this.size) {
				this.size = size
				this.renderer.setPixelRatio(this.ratio)
				this.renderer.setSize(width, height, false)
				this.composer.setPixelRatio(this.ratio)
				this.composer.setSize(width, height)
				this.camera.aspect = width / height
				this.camera.updateProjectionMatrix()
				// Points are sized in pixels: keep them the same size on the stage.
				this.shared.uScale.value = (height * this.ratio) / 360
			}

			const loop = Math.max(1, frame.duration)
			// How far through the loop the playhead is: 0 to 1. Everything that moves is a function of this.
			const turn = (((frame.time / loop) % 1) + 1) % 1
			const camera = this.camera

			// The camera circles the hole above the disk, rising and sinking as it goes, never inside the disk.
			const azimuth = (frame.rotation * Math.PI) / 180
			const elevation = ((11 + 6 * Math.sin(azimuth)) * Math.PI) / 180
			const distance = Math.max(17, 34 / Math.max(0.2, frame.scale))
			camera.position
				.set(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth))
				.multiplyScalar(distance)
			camera.up.set(0, 1, 0)
			camera.lookAt(0, 0, 0)
			// Held at a slight angle, like a camera in a hand.
			camera.rotateZ((9 * Math.PI) / 180)
			camera.updateMatrixWorld()
			this.shared.uCam.value.copy(camera.position)
			this.shared.uTurn.value = turn
			this.finish.uniforms.uTime.value = turn * 97

			// The star goes around once per loop.
			const starAngle = 1.48 + TAU * turn
			this.shared.uStar.value = starAngle
			this.star.position.set(STAR_ORBIT * Math.cos(starAngle), 0, STAR_ORBIT * Math.sin(starAngle))
			this.star.children[0].rotation.y = TAU * turn

			for (const orbiter of this.orbiters) {
				const {radius, angle} = kepler(
					orbiter.phase - orbiter.turned + TAU * orbiter.turns * turn,
					orbiter.radius,
					orbiter.oval,
					orbiter.turned,
				)
				orbiter.body.position.set(
					radius * Math.cos(angle),
					radius * Math.sin(angle) * Math.sin(orbiter.tilt),
					radius * Math.sin(angle) * Math.cos(orbiter.tilt),
				)
				const spinning = orbiter.body.children[0]?.children[0] ?? orbiter.body
				spinning.rotation.y = TAU * orbiter.spin * turn
			}

			const places = this.rockPlaces
			const helper = this.helper
			for (let i = 0; i < this.rocks.count; i++) {
				const at = i * 10
				const {radius, angle} = kepler(
					places[at + 1] + TAU * places[at + 4] * turn,
					places[at],
					places[at + 8],
					places[at + 9],
				)
				helper.position.set(
					radius * Math.cos(angle),
					places[at + 2] * Math.sin(angle - places[at + 9]),
					radius * Math.sin(angle),
				)
				helper.rotation.set(places[at + 5] + TAU * places[at + 7] * turn, places[at + 6], TAU * places[at + 7] * turn)
				helper.scale.setScalar(places[at + 3])
				helper.updateMatrix()
				this.rocks.setMatrixAt(i, helper.matrix)
			}
			this.rocks.instanceMatrix.needsUpdate = true

			const hole = this.hole.uniforms
			camera.getWorldDirection(hole.uForward.value)
			hole.uUnproject.value.multiplyMatrices(camera.matrixWorld, camera.projectionMatrixInverse)

			this.composer.render()
		}

		/**
		 * Keeps playback smooth on any graphics card: the image is rendered with
		 * fewer pixels while frames take too long, and with more again once they
		 * do not.
		 */
		adapt() {
			const now = performance.now()
			const gap = now - this.stamp
			this.stamp = now
			// One long gap is the first frame, or playback was interrupted. Several in a row
			// are a graphics card far too slow for this many pixels: do not wait to find out.
			this.late = gap > 90 ? this.late + 1 : 0
			if (this.late >= 2 && gap < 5000 && this.ratio > MIN_RATIO) {
				this.late = 0
				this.gaps.length = 0
				this.ceiling = Math.min(this.ceiling, this.ratio * 0.9)
				this.ratio = Math.max(MIN_RATIO, this.ratio * 0.5)
				this.raised = false
				return
			}
			if (gap > 250) return
			this.gaps.push(gap)
			if (this.gaps.length < 20) return

			const average = this.gaps.reduce((sum, value) => sum + value, 0) / this.gaps.length
			this.gaps.length = 0

			this.fastest = Math.min(this.fastest, average)
			const slow = Math.min(24, Math.max(13, this.fastest * 1.4))
			const fast = Math.min(18.5, this.fastest * 1.15 + 0.5)

			if (average > slow && this.ratio > MIN_RATIO) {
				// Raising it is what made it slow: do not try that again.
				if (this.raised) this.ceiling = this.ratio * 0.9
				this.ratio = Math.max(MIN_RATIO, this.ratio * 0.72)
				this.raised = false
			} else if (average < fast && this.ratio < this.ceiling) {
				this.ratio = Math.min(this.ceiling, this.ratio * 1.15)
				this.raised = true
			} else this.raised = false
		}

		dispose() {
			this.scene.traverse(object => {
				const mesh = object
				mesh.geometry?.dispose()
				for (const material of [mesh.material].flat()) {
					if (!material) continue
					material.map?.dispose()
					material.dispose()
				}
			})
			this.shared.uNoise.value.dispose()
			this.solid.dispose()
			this.composer.dispose()
			this.renderer.dispose()
			this.renderer.forceContextLoss()
		}
	}

	return new BlackHoleView(canvas)
}
