// astroduck: a pixel-art deep-space backdrop, drawn as one SVG. Each session draws a sky of the eight planets of
// the solar system, random planets, moons, galaxies, black holes and astroducks. Most bodies appear inside the
// screen, drift, bounce off the edges and each other, then fade out. Astroducks move faster and face the way they fly.
// A sky holds at most MAX_AT_ONCE objects at once, not counting the background stars. It comes in three densities,
// and animated or still. Every style sits in the <style> sheet, none in a style attribute, since a surface may drop those.

export type Density = 'less' | 'normal' | 'more'
export type Motion = 'animated' | 'bounce' | 'still'

const W = 240
const H = 135
const MAX_SOURCE = 131072 // the Svg element's source limit

const CYCLE = 150 // seconds before the whole sky repeats
const STEP = 0.1 // simulation step, in seconds
const SAMPLE = 8 // seconds between the keyframes that record each object's path (wider apart keeps the SVG small)
const WANDER = 2 // how hard objects steer, in units per second squared

// The most objects on screen at once, not counting the background stars. No more than this are ever alive at once.
export const MAX_AT_ONCE: Record<Density, number> = { less: 10, normal: 20, more: 30 }
// How many bodies float in the bounce sky
export const FLOATERS: Record<Density, number> = { less: 6, normal: 10, more: 15 }
// How many objects a sky draws for each density: about twice the most at once, so the count rises and falls
const BODY_COUNT: Record<Density, number> = { less: 20, normal: 40, more: 42 }
// Astroducks that are always in the sky: this many, each living DUCK_LIFE seconds and starting evenly through the
// cycle. Five starts, with 90 s lives, keep at least two fully visible at every moment.
const GUARANTEED_DUCKS = 5
const DUCK_LIFE = 90
// The longest a body lives (the solar planets and the guaranteed ducks), so the simulation runs this far past the end
// of the cycle
const MAX_LIFE = 90
const SIM_END = CYCLE + MAX_LIFE

type Px = { x: number; y: number; c: string }
type Kind = 'planet' | 'moon' | 'galaxy' | 'astroduck' | 'hole'
type Palette = [string, string, string] // lit, middle, shadow
type Shape = { id: number; kind: Kind; px: Px[]; reach: number; glow: string }
type Body = {
  kind: Kind
  a: Shape
  b: Shape
  r: number // collision radius
  vmin: number // slowest and fastest speed, in units per second
  vmax: number
  start: number // when the body appears, in seconds into the cycle
  life: number
  spin: number // seconds per turn
  sizeSecs: number
  s0: number
  s1: number
  x: number
  y: number
  vx: number
  vy: number
  heading: number // unwrapped direction of travel, in degrees
  spawned: boolean
  alive: boolean
  xs: number[] // position after each simulation step
  ys: number[]
  hs: number[] // heading after each simulation step
}
type Ring = { back: string; front: string; rx: number; ry: number; tilt: number }
type Solar = { name: string; R: number; glow: string; draw: (R: number) => Px[] }
type Key = { tau: number; abs: number } // a time in the cycle, and the simulated time it shows

// Kinds drawn in this order, so black holes sit on top
const KIND_ORDER: Kind[] = ['galaxy', 'moon', 'planet', 'astroduck', 'hole']
// Kinds picked at random for the bodies after the solar planets, weighted by repeating them
const KIND_PICKS: Kind[] = ['planet', 'planet', 'planet', 'moon', 'moon', 'galaxy', 'astroduck', 'astroduck', 'hole']
// How many random shapes of each kind the sky draws from (the solar planets come on top of the planets)
const COUNTS: Record<Kind, number> = { planet: 5, moon: 3, galaxy: 3, astroduck: 1, hole: 2 }
// Slow bodies drift and bounce off the edges; astroducks fly faster, always pointing the way they travel
const SPEEDS: Record<Kind, [number, number]> = {
  planet: [0.5, 1.6],
  moon: [0.6, 1.8],
  galaxy: [0.4, 1.2],
  astroduck: [2, 3.5],
  hole: [0.4, 1.2],
}
const SPIN: Record<Kind, [number, number]> = {
  planet: [30, 60],
  moon: [60, 100],
  galaxy: [80, 140],
  astroduck: [30, 60],
  hole: [20, 40],
}
// The soft glow behind each kind, in the same units as the sprites
const GLOW: Record<Kind, number> = { planet: 9, moon: 6, galaxy: 12, astroduck: 6, hole: 9 }

const PALETTES: Palette[] = [
  ['#ffd39a', '#e2793a', '#7a2e12'], // sunset
  ['#bfe9ff', '#3f8fd6', '#16365e'], // ocean
  ['#c7f9d4', '#2fb27a', '#0f4d3a'], // jade
  ['#ffe3f5', '#c44ec0', '#4a1450'], // violet
  ['#fff3c4', '#d9a441', '#6b4410'], // gold
]
const MOON_PALETTE: Palette = ['#e9e9f2', '#a9abb8', '#4d4f5c']

// Shared gradients for the haze clouds
const HAZE_DEFS =
  '<radialGradient id="haze"><stop offset="0" stop-color="#4b2368" stop-opacity=".45"/><stop offset="1" stop-color="#4b2368" stop-opacity="0"/></radialGradient>' +
  '<radialGradient id="haze2"><stop offset="0" stop-color="#1b3a6b" stop-opacity=".4"/><stop offset="1" stop-color="#1b3a6b" stop-opacity="0"/></radialGradient>'

// Shared keyframes and star classes, for the animated sky only. Each body's own path, fade and shape swap are
// written below, one set per body.
const STYLE =
  '.tw{animation:twinkle 3s ease-in-out infinite}' +
  '.p1{animation-duration:3.7s;animation-delay:-1.3s}' +
  '.p2{animation-duration:4.4s;animation-delay:-2.1s}' +
  '.p3{animation-duration:5.2s;animation-delay:-3.4s}' +
  '.gl{animation:glow 6s ease-in-out infinite}' +
  '@keyframes twinkle{0%,100%{opacity:.2}50%{opacity:1}}' +
  '@keyframes glow{0%,100%{opacity:.2}50%{opacity:.4}}' +
  '@media (prefers-reduced-motion:reduce){*{animation-play-state:paused!important}}'

// A seeded random generator. Each sky is drawn from one seed, so the same seed gives the same sky.
function makeRandom(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function pick<T>(items: T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)]
}

function between(rand: () => number, lo: number, hi: number): number {
  return lo + rand() * (hi - lo)
}

// A sprite is its pixels, centred on (0, 0). Pixels are keyed by position, so the last one wins.
function sprite(draw: (put: (x: number, y: number, c: string) => void) => void): Px[] {
  const grid = new Map<string, Px>()
  draw((x, y, c) => grid.set(`${x},${y}`, { x, y, c }))
  return [...grid.values()]
}

// One <path> per colour, one unit square per pixel: far smaller than one <rect> per pixel
function toPaths(px: Px[]): string {
  const byColor = new Map<string, string>()
  // Each colour's pixels as horizontal runs: one rectangle per run, not per pixel
  const sorted = [...px].sort((p, q) => (p.c < q.c ? -1 : p.c > q.c ? 1 : p.y - q.y || p.x - q.x))
  for (let i = 0; i < sorted.length; ) {
    const p = sorted[i]
    let n = 1
    while (i + n < sorted.length && sorted[i + n].c === p.c && sorted[i + n].y === p.y && sorted[i + n].x === p.x + n) n++
    byColor.set(p.c, (byColor.get(p.c) ?? '') + `M${p.x} ${p.y}h${n}v1h-${n}z`)
    i += n
  }
  return [...byColor].map(([c, d]) => `<path fill="${c}" d="${d}"/>`).join('')
}

// How far a sprite's furthest pixel lies from its centre
function reach(px: Px[]): number {
  return Math.max(...px.map(p => Math.hypot(p.x + 0.5, p.y + 0.5)))
}

// A lit sphere: each pixel's colour comes from `colourAt`, given its place and how lit it is (upper left is lit).
// An optional ring passes behind the sphere and in front of it.
function sphere(R: number, colourAt: (x: number, y: number, lit: number) => string, ring?: Ring): Px[] {
  const L = [-0.5, -0.6, 0.62]
  return sprite(put => {
    const ringPoints: { x: number; y: number }[] = []
    if (ring) {
      for (let t = 0; t < Math.PI * 2; t += 0.04) {
        const rx = Math.cos(t) * ring.rx
        const ry = Math.sin(t) * ring.ry
        ringPoints.push({
          x: Math.round(rx * Math.cos(ring.tilt) - ry * Math.sin(ring.tilt)),
          y: Math.round(rx * Math.sin(ring.tilt) + ry * Math.cos(ring.tilt)),
        })
      }
      for (const r of ringPoints) if (r.y <= 0) put(r.x, r.y, ring.back)
    }
    for (let y = -R; y <= R; y++) {
      for (let x = -R; x <= R; x++) {
        if (x * x + y * y > R * R) continue
        const nz = Math.sqrt(R * R - x * x - y * y) / R
        const lit = (x / R) * L[0] + (y / R) * L[1] + nz * L[2]
        put(x, y, colourAt(x, y, lit))
      }
    }
    if (ring) {
      for (const r of ringPoints) if (r.y > 0) put(r.x, r.y, ring.front)
    }
  })
}

// Three shades by light: lit, middle, shadow
const shaded =
  (pal: Palette) =>
  (_x: number, _y: number, lit: number): string =>
    lit > 0.45 ? pal[0] : lit > 0.05 ? pal[1] : pal[2]

// The eight planets of the solar system, each in its own colours. Sizes are pixel-art sizes, not to scale.
const SOLAR: Solar[] = [
  { name: 'Mercury', R: 2, glow: '#948d86', draw: R => sphere(R, shaded(['#d8d2ca', '#948d86', '#4f4a46'])) },
  { name: 'Venus', R: 3, glow: '#e8c27a', draw: R => sphere(R, shaded(['#fff4cf', '#e8c27a', '#a8762e'])) },
  {
    name: 'Earth',
    R: 3,
    glow: '#3d8fe0',
    draw: R =>
      sphere(R, (x, y, lit) => {
        if (Math.cos(x * 2.3 - y * 1.1) > 0.85) return '#f4f8ff' // clouds
        if (Math.sin(x * 1.7 + 1.1) * Math.cos(y * 1.3) > 0.35) return '#4caf5a' // land
        return lit > 0.45 ? '#6fb4f5' : lit > 0.05 ? '#3d8fe0' : '#1d4f94' // ocean
      }),
  },
  {
    name: 'Mars',
    R: 2,
    glow: '#c1440e',
    draw: R =>
      sphere(R, (x, y, lit) => {
        if (y <= 1 - R) return '#fff3ec' // polar cap
        return lit > 0.45 ? '#f2a071' : lit > 0.05 ? '#c1440e' : '#6b2409'
      }),
  },
  {
    name: 'Jupiter',
    R: 6,
    glow: '#c99a6b',
    draw: R =>
      sphere(R, (x, y, lit) => {
        if (x >= 1 && x <= 3 && y >= 1 && y <= 2) return '#c8553d' // the great red spot
        if (lit <= 0.05) return '#6b4a2f'
        return ['#f3dcb0', '#c99a6b', '#e9c48f'][Math.floor((y + R) / 2) % 3] // bands
      }),
  },
  {
    name: 'Saturn',
    R: 5,
    glow: '#dcc17e',
    draw: R =>
      sphere(R, shaded(['#fbeec0', '#e0c58a', '#a88a4d']), {
        back: '#b59b64',
        front: '#e7d49a',
        rx: R * 2.1,
        ry: R * 0.45,
        tilt: 0.25,
      }),
  },
  {
    name: 'Uranus',
    R: 4,
    glow: '#8ee6ee',
    draw: R =>
      sphere(R, shaded(['#e4fdff', '#8ee6ee', '#3fa9b8']), {
        back: '#6f9aa3',
        front: '#9cc3ca',
        rx: R * 1.9,
        ry: R * 0.25,
        tilt: -0.2,
      }),
  },
  { name: 'Neptune', R: 4, glow: '#4568d8', draw: R => sphere(R, shaded(['#a9c2ff', '#4568d8', '#22388f'])) },
]

// A random planet: a sphere with its own palette, and sometimes a ring
function planet(rand: () => number, R: number, pal: Palette, ring: boolean): Px[] {
  const tilt = between(rand, -0.5, 0.5)
  return sphere(R, shaded(pal), ring ? { back: '#c9b38a', front: '#e9d8b0', rx: R * 1.9, ry: R * 0.42, tilt } : undefined)
}

// A moon: a grey sphere with a few craters
function moon(rand: () => number, R: number): Px[] {
  const base = planet(rand, R, MOON_PALETTE, false)
  return sprite(put => {
    for (const p of base) put(p.x, p.y, p.c)
    for (let k = 0; k < 2; k++) {
      put(Math.round(between(rand, -R + 1, R - 1)), Math.round(between(rand, -R + 1, R - 1)), MOON_PALETTE[2])
    }
  })
}

function galaxy(rand: () => number, arms: number, turn: number, sx: number, sy: number, R: number, core: number): Px[] {
  return sprite(put => {
    for (let arm = 0; arm < arms; arm++) {
      for (let t = 1; t <= R * 10; t++) {
        const u = t / (R * 10)
        const a = u * turn + (arm * 2 * Math.PI) / arms
        const x = Math.round(Math.cos(a) * u * R * sx + (rand() - 0.5) * (0.5 + u))
        const y = Math.round(Math.sin(a) * u * R * sy + (rand() - 0.5) * (0.5 + u))
        put(x, y, u < 0.25 ? '#ffe9b0' : u < 0.5 ? '#b9a6ff' : u < 0.8 ? '#6c5ce7' : '#3d2f9e')
      }
    }
    for (let y = -core; y <= core; y++) {
      for (let x = -core; x <= core; x++) {
        if (x * x + y * y <= core * core) put(x, y, '#fff3d1')
      }
    }
  })
}

// A black disc, an accretion ring that is brightest inside, and a faint halo. `hot` adds a hot spot.
function blackHole(rd: number, ring: number, halo: number, hot: boolean): Px[] {
  const R = rd + ring + halo
  return sprite(put => {
    for (let y = -R; y <= R; y++) {
      for (let x = -R; x <= R; x++) {
        const d = Math.hypot(x, y)
        if (d <= rd) {
          put(x, y, '#000000')
        } else if (d <= rd + ring) {
          const side = Math.cos(Math.atan2(y, x)) > 0
          put(x, y, hot && side ? '#fff3d1' : d <= rd + ring / 2 ? '#ffd166' : side ? '#ff8a3d' : '#c04bff')
        } else if (d <= R) {
          put(x, y, '#2a1a66')
        }
      }
    }
  })
}

// The astroduck: a yellow duck in a big white helmet with a blue visor, with a jetpack on its back and a flame
// behind. There is one design, so every duck looks the same. It faces right; the flame trails to the left.
function astroduck(): Px[] {
  const outline = '#2b2d42'
  const white = '#f5f7fb'
  const whiteShade = '#c5ccda'
  const visor = '#3a86ff'
  const glint = '#bde0ff'
  const yellow = '#ffd23f'
  const yellowLight = '#fff08a'
  const yellowShade = '#e0a526'
  const orange = '#ff8a3d'
  const orangeShade = '#d9631f'
  const tank = '#8d99ae'
  const tankLight = '#c0c9d6'
  const dark = '#4a5068'
  return sprite(put => {
    // Jetpack: two tanks on the back with a dark strap, drawn first so the body overlaps its inner edge
    for (let y = -2; y <= 4; y++) {
      for (let x = -7; x <= -6; x++) put(x, y, y === -2 || y === 4 ? dark : x === -7 ? tankLight : tank)
    }
    for (let y = -1; y <= 3; y++) put(-5, y, dark)
    // Body: a rounded yellow shape with a dark outline, lit from the upper left and shaded underneath
    for (let y = 0; y <= 6; y++) {
      for (let x = -5; x <= 5; x++) {
        const d = (x / 5) ** 2 + ((y - 3) / 3) ** 2
        if (d <= 1) put(x, y, y >= 5 ? yellowShade : y <= 2 && x <= 0 ? yellowLight : yellow)
        else if (d <= 1.5) put(x, y, outline)
      }
    }
    // Wing: a shaded stripe across the middle of the body
    for (let x = -3; x <= 0; x++) put(x, 3, yellowShade)
    for (let x = -2; x <= -1; x++) put(x, 4, yellowShade)
    // Webbed feet under the body
    for (const x of [-2, -1, 1, 2]) put(x, 7, orange)
    // Beak, sticking out to the right, under the visor
    for (const [x, y] of [[4, 0], [5, 0], [6, 0]]) put(x, y, orange)
    for (const [x, y] of [[4, 1], [5, 1]]) put(x, y, orangeShade)
    // Helmet: big and white, centred at (0, -4), with a blue visor on the right and shading on the lower right.
    // Drawn last, so it sits on top of the body.
    for (let y = -9; y <= 1; y++) {
      for (let x = -5; x <= 5; x++) {
        const d = Math.hypot(x, y + 4)
        if (d <= 4) {
          if (x >= 1 && x <= 4 && y >= -5 && y <= -3) put(x, y, x === 1 && y === -5 ? glint : visor)
          else put(x, y, x > 1 && y > -4 && d > 2.8 ? whiteShade : white)
        } else if (d <= 4.7) {
          put(x, y, outline)
        }
      }
    }
    // Flame from the nozzle, three pixels long and tapering
    put(-8, 0, '#fff3c4')
    put(-8, 1, '#fff3c4')
    put(-8, 2, '#fff3c4')
    put(-9, 0, '#ffd166')
    put(-9, 1, '#ffd166')
    put(-9, 2, '#ffd166')
    put(-10, 1, orange)
  })
}

// One random shape of a kind, with its own size, colours and details
function shapeOf(kind: Kind, rand: () => number): { px: Px[]; glow: string } {
  switch (kind) {
    case 'planet': {
      const pal = pick(PALETTES, rand)
      return { px: planet(rand, Math.round(between(rand, 4, 6)), pal, rand() < 0.4), glow: pal[1] }
    }
    case 'moon':
      return { px: moon(rand, Math.round(between(rand, 2, 3))), glow: MOON_PALETTE[1] }
    case 'galaxy':
      return {
        px: galaxy(
          rand,
          Math.floor(between(rand, 2, 5)),
          between(rand, 2, 6),
          between(rand, 0.6, 1),
          between(rand, 0.45, 1),
          Math.round(between(rand, 9, 12)),
          2,
        ),
        glow: '#9d8cff',
      }
    case 'astroduck':
      return { px: astroduck(), glow: '#ffd23f' }
    case 'hole':
      return {
        px: blackHole(
          Math.round(between(rand, 2, 4)),
          Math.round(between(rand, 2, 3)),
          Math.round(between(rand, 1, 2)),
          rand() < 0.5,
        ),
        glow: '#ff8a3d',
      }
  }
}

// Two bodies that overlap are pushed apart and bounce. The push is capped, so nothing jumps.
function collide(p: Body, q: Body): void {
  const dx = p.x - q.x
  const dy = p.y - q.y
  const d = Math.hypot(dx, dy) || 0.001
  const min = p.r + q.r
  if (d >= min) return
  const nx = dx / d
  const ny = dy / d
  // Mass goes with area, so a big body moves less when it is pushed
  const mp = p.r * p.r
  const mq = q.r * q.r
  const push = Math.min(min - d, 0.8)
  p.x += nx * push * (mq / (mp + mq))
  p.y += ny * push * (mq / (mp + mq))
  q.x -= nx * push * (mp / (mp + mq))
  q.y -= ny * push * (mp / (mp + mq))
  const approach = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny
  if (approach >= 0) return // already moving apart
  const e = 0.6
  const j = (-(1 + e) * approach) / (1 / mp + 1 / mq)
  p.vx += (j / mp) * nx
  p.vy += (j / mp) * ny
  q.vx -= (j / mq) * nx
  q.vy -= (j / mq) * ny
}

// A candidate start for a body: inside the screen, far enough from the edges that it is whole, heading off in a
// random direction, so it drifts across the view rather than in from off it
function spawnCandidate(rand: () => number, b: Body): { x: number; y: number; vx: number; vy: number } {
  const speed = between(rand, b.vmin, b.vmax)
  const aim = between(rand, 0, Math.PI * 2)
  return {
    x: between(rand, b.r, W - b.r),
    y: between(rand, b.r, H - b.r),
    vx: Math.cos(aim) * speed,
    vy: Math.sin(aim) * speed,
  }
}

// The gap between a candidate position and the bodies already on screen
function gapTo(x: number, y: number, bodies: Body[], b: Body): number {
  let gap = Infinity
  for (const o of bodies) {
    if (o.alive) gap = Math.min(gap, Math.hypot(x - o.x, y - o.y) - (o.r + b.r))
  }
  return gap
}

// Steps every body through the cycle and past its end: wander, move, bounce off the edges and each other
function simulate(rand: () => number, bodies: Body[]): void {
  const steps = Math.round(SIM_END / STEP)
  for (let k = 0; k <= steps; k++) {
    const t = k * STEP
    for (const b of bodies) {
      if (!b.spawned && t >= b.start) {
        // Among several candidate starts, take the one with the most room
        let best = spawnCandidate(rand, b)
        let bestGap = gapTo(best.x, best.y, bodies, b)
        for (let c = 0; c < 20; c++) {
          const cand = spawnCandidate(rand, b)
          const gap = gapTo(cand.x, cand.y, bodies, b)
          if (gap > bestGap) {
            best = cand
            bestGap = gap
          }
        }
        b.x = best.x
        b.y = best.y
        b.vx = best.vx
        b.vy = best.vy
        b.heading = Math.atan2(b.vy, b.vx) * (180 / Math.PI)
        b.spawned = true
      }
      b.alive = b.spawned && t < b.start + b.life
    }
    for (const b of bodies) {
      if (!b.alive) continue
      b.vx += (rand() - 0.5) * 2 * WANDER * STEP
      b.vy += (rand() - 0.5) * 2 * WANDER * STEP
      const speed = Math.hypot(b.vx, b.vy)
      const clamped = Math.min(b.vmax, Math.max(b.vmin, speed))
      const f = speed > 0 ? clamped / speed : 1
      b.vx *= f
      b.vy *= f
      b.x += b.vx * STEP
      b.y += b.vy * STEP
      // Every body bounces off the screen edges, so it stays in view while it lives
      if ((b.x < b.r && b.vx < 0) || (b.x > W - b.r && b.vx > 0)) b.vx = -b.vx
      if ((b.y < b.r && b.vy < 0) || (b.y > H - b.r && b.vy > 0)) b.vy = -b.vy
    }
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        if (bodies[i].alive && bodies[j].alive) collide(bodies[i], bodies[j])
      }
    }
    for (const b of bodies) {
      // The heading is unwrapped, so a body turning past 180 degrees turns smoothly
      const now = Math.atan2(b.vy, b.vx) * (180 / Math.PI)
      let turn = now - (b.heading % 360)
      if (turn > 180) turn -= 360
      if (turn < -180) turn += 360
      b.heading += turn
      b.xs.push(b.x)
      b.ys.push(b.y)
      b.hs.push(b.heading)
    }
  }
}

// Where a body is, how big it is and how it is turned, at a simulated time
function poseAt(b: Body, t: number): { x: number; y: number; scale: number; turn: number } {
  // Round up, so a keyframe at the spawn time reads the spawn step, not the origin recorded before it
  const k = Math.min(Math.ceil(t / STEP - 1e-6), b.xs.length - 1)
  const grow = 0.5 - 0.5 * Math.cos((2 * Math.PI * (t - b.start)) / b.sizeSecs)
  const scale = b.s0 + (b.s1 - b.s0) * grow
  // Astroducks turn to face the way they fly; other bodies keep turning at their own speed
  const turn = b.kind === 'astroduck' ? b.hs[k] : ((t - b.start) / b.spin) * 360
  return { x: b.xs[k], y: b.ys[k], scale, turn }
}

const pct = (t: number) => `${((t / CYCLE) * 100).toFixed(3)}%`

// The transform of a body at a simulated time, as CSS
function poseCss(b: Body, abs: number): string {
  const p = poseAt(b, abs)
  return `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) scale(${p.scale.toFixed(2)}) rotate(${p.turn.toFixed(0)}deg)`
}

// Opacity at a simulated time: fades in over the first 12% of the life, stays, and fades out over the last 20%
function fadeAt(b: Body, abs: number): number {
  const u = (abs - b.start) / b.life
  if (u <= 0 || u >= 1) return 0
  return u < 0.12 ? u / 0.12 : u > 0.8 ? (1 - u) / 0.2 : 1
}

// The first shape shows until the middle of the life, then gives way to the second over a tenth of a second
function swapAt(b: Body, abs: number): number {
  const mid = b.start + 0.5 * b.life
  return abs <= mid ? 1 : abs >= mid + 0.1 ? 0 : 1 - (abs - mid) / 0.1
}

// The stretches of the cycle where a body is alive. A body whose life runs past the end of the cycle is split:
// its tail is the start of the cycle, and its head is from its own start to the end. Every point of an animation
// is a key: the `extra` simulated times (where its values turn) and, if `step` is given, one every `step` seconds.
function keyTimes(b: Body, step: number | null, extra: number[]): Key[] {
  const end = b.start + b.life
  const spans =
    end <= CYCLE
      ? [{ from: b.start, to: end, shift: 0 }]
      : [
          { from: 0, to: end - CYCLE, shift: CYCLE },
          { from: b.start, to: CYCLE, shift: 0 },
        ]
  const found = new Map<number, number>()
  const add = (tau: number, abs: number) => found.set(Math.round(tau * 1000) / 1000, abs)
  for (const span of spans) {
    add(span.from, span.from + span.shift)
    add(span.to, span.to + span.shift)
    if (step !== null) for (let t = span.from; t < span.to; t += step) add(t, t + span.shift)
    for (const m of extra) {
      const tau = m - span.shift
      if (tau > span.from && tau < span.to) add(tau, m)
    }
  }
  return [...found].sort((p, q) => p[0] - q[0]).map(([tau, abs]) => ({ tau, abs }))
}

// The keyframes of one animation: each key's value, with 0% and 100% held at the first and last key
function frames(keys: Key[], value: (abs: number) => string): string {
  const first = keys[0]
  const last = keys[keys.length - 1]
  return (
    (first.tau > 0 ? `0%{${value(first.abs)}}` : '') +
    keys.map(k => `${pct(k.tau)}{${value(k.abs)}}`).join('') +
    (last.tau < CYCLE ? `100%{${value(last.abs)}}` : '')
  )
}

// The keyframes for one body: its path, fade and shape swap, each with its own keys
function rulesFor(b: Body, i: number, offset: number): string {
  const end = b.start + b.life
  const mid = b.start + 0.5 * b.life
  const path = keyTimes(b, SAMPLE, [])
  const fade = keyTimes(b, null, [b.start, b.start + 0.12 * b.life, b.start + 0.8 * b.life, end])
  const swap = keyTimes(b, null, [mid, mid + 0.1])
  const mv = frames(path, abs => `transform:${poseCss(b, abs)}`)
  const life = frames(fade, abs => `opacity:${fadeAt(b, abs).toFixed(2)}`)
  const sa = frames(swap, abs => `opacity:${swapAt(b, abs).toFixed(2)}`)
  const sb = frames(swap, abs => `opacity:${(1 - swapAt(b, abs)).toFixed(2)}`)
  // Duration, timing and the start offset are shared by every body, in one rule in spaceSvg.
  // Each rule also holds the body's state at the load instant, outside the animation. The desktop app drops every
  // animation when it will not animate (its reduce-motion setting, or no GPU compositing), and without these a body
  // would fall back to no transform, at the top-left corner, off the screen.
  // A value equal to the CSS default (opacity 1) is left out, to keep the source under its limit.
  const now = aliveAt(b, offset)
  const fadeNow = now === null ? 0 : Number(fadeAt(b, now).toFixed(2))
  const swapNow = now === null ? 1 : Number(swapAt(b, now).toFixed(2))
  const opacity = (v: number) => (v === 1 ? '' : `opacity:${v};`)
  const pose = fadeNow === 0 ? '' : `transform:${poseCss(b, now!)};`
  return (
    `@keyframes life${i}{${life}}@keyframes mv${i}{${mv}}@keyframes sa${i}{${sa}}@keyframes sb${i}{${sb}}` +
    `.o${i}{${opacity(fadeNow)}animation-name:life${i}}` +
    `.o${i} .mv{${pose}animation-name:mv${i}}` +
    `.o${i} .sa{${opacity(swapNow)}animation-name:sa${i}}` +
    `.o${i} .sb{${opacity(Number((1 - swapNow).toFixed(2)))}animation-name:sb${i}}`
  )
}

// The simulated time at which a body is alive at a moment of the cycle, or null if it is not alive then
function aliveAt(b: Body, tau: number): number | null {
  for (const t of [tau, tau + CYCLE]) if (t >= b.start && t < b.start + b.life) return t
  return null
}

// The moment a still sky is drawn at: the one with the most bodies on the screen
function stillMoment(bodies: Body[]): number {
  let best = 0
  let most = -1
  for (let tau = 0; tau < CYCLE; tau += 1) {
    let n = 0
    for (const b of bodies) {
      const abs = aliveAt(b, tau)
      if (abs === null) continue
      const p = poseAt(b, abs)
      if (p.x >= 0 && p.x <= W && p.y >= 0 && p.y <= H) n++
    }
    if (n > most) {
      most = n
      best = tau
    }
  }
  return best
}

const RANK = (k: Kind) => KIND_ORDER.indexOf(k)

// The name a sky's settings are kept under, which the backdrop uses as its scene
export function sceneKey(density: Density, motion: Motion): string {
  return `astroduck-${density}-${motion}`
}

// Every variant of one sky: each density, animated and still. One seed, so the variants share their sky.
export function allScenes(seed: number): Record<string, string> {
  const out: Record<string, string> = {}
  for (const density of ['less', 'normal', 'more'] as Density[]) {
    for (const motion of ['animated', 'bounce', 'still'] as Motion[]) {
      out[sceneKey(density, motion)] = spaceSvg(seed, density, motion)
    }
  }
  return out
}

export function spaceSvg(seed: number, density: Density, motion: Motion): string {
  const animated = motion !== 'still'
  const rand = makeRandom(seed)
  // Where in the cycle the animated sky starts, so a paused picture shows a full sky
  const offset = between(rand, 50, 90)

  // Stars: four twinkle phases, three colours, one path per phase and colour
  const stars = new Map<string, string>()
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(rand() * W)
    const y = Math.floor(rand() * H)
    const key = `p${i % 4} ${['#ffffff', '#bcd4ff', '#ffd7a6'][i % 3]}`
    stars.set(key, (stars.get(key) ?? '') + `M${x} ${y}h1v1h-1z`)
  }
  // A few sparkles: plus-shaped white stars that twinkle slowly
  let sparkle = ''
  for (let i = 0; i < 12; i++) {
    const x = 3 + Math.floor(rand() * (W - 6))
    const y = 3 + Math.floor(rand() * (H - 6))
    sparkle +=
      `M${x} ${y}h1v1h-1z` + `M${x - 1} ${y}h1v1h-1z` + `M${x + 1} ${y}h1v1h-1z` + `M${x} ${y - 1}h1v1h-1z` + `M${x} ${y + 1}h1v1h-1z`
  }
  const starPaths =
    [...stars]
      .map(([key, d]) => {
        const [phase, color] = key.split(' ')
        return `<path${animated ? ` class="tw ${phase}"` : ''} fill="${color}" d="${d}"/>`
      })
      .join('') + `<path${animated ? ' class="tw p2"' : ''} fill="#ffffff" d="${sparkle}"/>`

  // Two soft haze clouds, at random places
  const hazes = [0, 1]
    .map(
      k =>
        `<ellipse cx="${between(rand, 40, 200).toFixed(0)}" cy="${between(rand, 20, 115).toFixed(0)}" ` +
        `rx="${between(rand, 70, 110).toFixed(0)}" ry="${between(rand, 40, 60).toFixed(0)}" fill="url(#${k ? 'haze2' : 'haze'})"/>`,
    )
    .join('')

  // The shapes the sky draws from. Each is written once and shared by every body that uses it.
  const shapes: Shape[] = []
  const add = (kind: Kind, px: Px[], glow: string): Shape => {
    const s: Shape = { id: shapes.length, kind, px, reach: reach(px), glow }
    shapes.push(s)
    return s
  }
  const solar = SOLAR.map(p => add('planet', p.draw(p.R), p.glow))
  const pools: Record<Kind, Shape[]> = { planet: [], moon: [], galaxy: [], astroduck: [], hole: [] }
  for (const kind of KIND_ORDER) {
    for (let n = 0; n < COUNTS[kind]; n++) {
      const s = shapeOf(kind, rand)
      pools[kind].push(add(kind, s.px, s.glow))
    }
  }

  // The bodies. The first eight are the solar planets, one each. Every body is placed at a start in the cycle where
  // it fits under MAX_AT_ONCE, counting its whole life, so no more than that many are alive at once. A life that runs
  // past the end of the cycle wraps round to the start. Each body draws its kind, shapes, lifetime and size from its
  // own seed, so the same seed always gives the same sky.
  const max = MAX_AT_ONCE[density]
  const slots = Math.round(CYCLE / STEP)
  const busy = new Uint8Array(slots)
  const room = (from: number, n: number): boolean => {
    for (let j = 0; j < n; j++) if (busy[(from + j) % slots] >= max) return false
    return true
  }
  const bodies: Body[] = []
  // The guaranteed astroducks come first, spaced evenly through the cycle, then the solar planets, then the rest
  const ducks = GUARANTEED_DUCKS
  const phase = between(rand, 0, CYCLE / ducks)
  for (let i = 0; i < ducks + BODY_COUNT[density]; i++) {
    const own = makeRandom(seed + (i + 1) * 7919)
    const guaranteed = i < ducks
    const after = i - ducks
    const solo = !guaranteed && after < solar.length
    const kind: Kind = guaranteed ? 'astroduck' : solo ? 'planet' : pick(KIND_PICKS, own)
    const a = guaranteed ? pools.astroduck[0] : solo ? solar[after] : pick(pools[kind], own)
    // An astroduck keeps one look, and a solar planet keeps its colours, so neither changes into another shape
    const b = solo || kind === 'astroduck' ? a : pick(pools[kind], own)
    const life = guaranteed ? DUCK_LIFE : solo ? between(own, 60, 90) : between(own, 26, 40)
    const n = Math.round(life / STEP)
    let from = -1
    if (guaranteed) {
      from = Math.round((((phase + i * (CYCLE / ducks)) % CYCLE) / STEP)) % slots
    } else {
      for (let tries = 0; tries < 200 && from < 0; tries++) {
        const s = Math.floor(own() * slots)
        if (room(s, n)) from = s
      }
      for (let s = 0; from < 0 && s < slots; s++) if (room(s, n)) from = s
      if (from < 0) continue // no room left in the cycle for this body
    }
    for (let j = 0; j < n; j++) busy[(from + j) % slots] += 1
    const [spinLo, spinHi] = SPIN[kind]
    const [vmin, vmax] = SPEEDS[kind]
    bodies.push({
      kind,
      a,
      b,
      r: Math.max(a.reach, b.reach),
      vmin,
      vmax,
      start: from * STEP,
      life,
      spin: between(own, spinLo, spinHi),
      sizeSecs: between(own, 8, 14),
      s0: between(own, 0.7, 0.95),
      s1: between(own, 0.95, 1.3),
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      heading: 0,
      spawned: false,
      alive: false,
      xs: [],
      ys: [],
      hs: [],
    })
  }
  simulate(makeRandom(seed + 104729), bodies)
  bodies.sort((p, q) => RANK(p.kind) - RANK(q.kind))

  const shapeDefs = shapes.map(s => `<g id="s${s.id}">${toPaths(s.px)}</g>`).join('')
  const glowDefs = shapes
    .map(
      s =>
        `<radialGradient id="gs${s.id}"><stop offset="0" stop-color="${s.glow}" stop-opacity=".3"/>` +
        `<stop offset="1" stop-color="${s.glow}" stop-opacity="0"/></radialGradient>`,
    )
    .join('')

  let style = ''
  let markup: string
  if (motion === 'bounce') {
    // Floaters: a few bodies that stay in the sky the whole time, drifting and bouncing off its edges. Each moves on
    // two short loops of its own (across and up and down), so the sky looks alive even if the app restarts it.
    // ponytail: bodies pass through each other; bounce off each other needs per-pair paths, add if wanted
    const n = FLOATERS[density]
    const ducks = bodies.filter(b => b.kind === 'astroduck').slice(0, 3)
    const rest = bodies.filter(b => b.kind !== 'astroduck')
    const every = rest.length / (n - ducks.length)
    const picked = [...ducks, ...Array.from({ length: n - ducks.length }, (_, k) => rest[Math.floor(k * every)])].sort(
      (p, q) => RANK(p.kind) - RANK(q.kind),
    )
    // Where a there-and-back loop of `dist` stands at `phase` (0 to 1): out over the first half, back over the second
    const along = (dist: number, phase: number) => (phase < 0.5 ? 2 * phase : 2 - 2 * phase) * dist
    let rules =
      '@keyframes spin{to{transform:rotate(360deg)}}' +
      '@keyframes face{0%,50%{transform:scaleX(1)}50.01%,100%{transform:scaleX(-1)}}'
    markup = picked
      .map((b, i) => {
        const r = Math.ceil(b.a.reach)
        const dx = W - 2 * r
        const dy = H - 2 * r
        const duck = b.kind === 'astroduck'
        // Seconds for one there-and-back loop: ducks cross the sky in about 10-15 s, the rest in 20-60 s
        const tx = (2 * dx) / between(rand, duck ? 16 : 4, duck ? 24 : 12)
        const ty = (2 * dy) / between(rand, duck ? 10 : 3, duck ? 16 : 8)
        const px = rand()
        const py = rand()
        const loop = (t: number, phase: number) => `${t.toFixed(1)}s linear -${(phase * t).toFixed(1)}s infinite`
        // Each rule also holds where the body stands at load, for when the app stops every animation
        rules +=
          `@keyframes x${i}{0%,100%{transform:translateX(0)}50%{transform:translateX(${dx}px)}}` +
          `@keyframes y${i}{0%,100%{transform:translateY(0)}50%{transform:translateY(${dy}px)}}` +
          `.x${i}{transform:translateX(${along(dx, px).toFixed(0)}px);animation:x${i} ${loop(tx, px)}}` +
          `.y${i}{transform:translateY(${along(dy, py).toFixed(0)}px);animation:y${i} ${loop(ty, py)}}` +
          (duck
            ? `.t${i}{transform:scaleX(${px < 0.5 ? 1 : -1});animation:face ${loop(tx, px)}}`
            : `.t${i}{animation:spin ${b.spin.toFixed(0)}s linear infinite}`)
        return (
          `<g class="x${i}"><g class="y${i}"><g transform="translate(${r} ${r})"><g class="t${i}">` +
          `<circle class="gl" r="${GLOW[b.kind]}" fill="url(#gs${b.a.id})"/>${toPaths(b.a.px)}</g></g></g></g>`
        )
      })
      .join('')
    style = `<style>${STYLE}${rules}</style>`
  } else if (animated) {
    // One timing for every body animation (the groups o0, o1, ... and their parts); each body names only its keyframes
    const timing =
      `g[class^=o],.mv,.sa,.sb{animation-duration:${CYCLE}s;animation-timing-function:linear;` +
      `animation-delay:-${offset.toFixed(1)}s;animation-iteration-count:infinite}`
    style = `<style>${STYLE}${timing}${bodies.map((b, i) => rulesFor(b, i, offset)).join('')}</style>`
    markup = bodies
      .map(
        (b, i) =>
          `<g class="o${i}"><g class="mv"><circle class="gl" r="${GLOW[b.kind]}" fill="url(#gs${b.a.id})"/>` +
          // Sprites are drawn in place (no <use>); a body that keeps one shape draws it once
          (b.a.id === b.b.id
            ? toPaths(b.a.px)
            : `<g class="sa">${toPaths(b.a.px)}</g><g class="sb">${toPaths(b.b.px)}</g>`) +
          `</g></g>`,
      )
      .join('')
  } else {
    // Still: each body alive at the chosen moment is drawn once, in its pose at that moment
    const at = stillMoment(bodies)
    markup = bodies
      .map(b => {
        const abs = aliveAt(b, at)
        if (abs === null) return ''
        const p = poseAt(b, abs)
        return (
          `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) scale(${p.scale.toFixed(2)}) rotate(${p.turn.toFixed(0)})">` +
          `<circle r="${GLOW[b.kind]}" fill="url(#gs${b.a.id})"/><use href="#s${b.a.id}"/></g>`
        )
      })
      .join('')
  }

  const source =
    // The animated sky follows the synthwave84 scene's layout, which the app animates: the style sheet first, no
    // attribute on the root but its size, and every sprite drawn in place rather than shared through <use>
    (animated
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">` +
        style +
        `<defs>${HAZE_DEFS}${glowDefs}</defs>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges">` +
        `<defs>${HAZE_DEFS}${glowDefs}${shapeDefs}</defs>`) +
    `<rect width="${W}" height="${H}" fill="#000000"/>` +
    hazes +
    starPaths +
    markup +
    `</svg>`
  if (source.length > MAX_SOURCE) throw new Error(`astroduck: ${density} ${motion} sky is over the 131,072-character limit`)
  return source
}
