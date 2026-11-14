import type { EngineInterface, Register, ThemeSetArgs } from 'claude-code'

import { makeColors } from './make-colors.js'
import { allScenes, FLOATERS, MAX_AT_ONCE, sceneKey, type Density, type Motion } from './scene'

// astroduck: a pure black theme with the planets of the solar system, galaxies, black holes and
// astroducks drifting behind the conversation. Dark only. Pair it with no other theme: only one can be active.
//
//   /astroduck less | normal | more          up to 10, 20 or 30 objects on screen at once, or 6, 10 or 15 bouncing
//                                            (normal is the default)
//   /astroduck animated on | animated off    the objects drift, or stand still (on is the default)
//   /astroduck bounce on | bounce off        a few objects float the whole time and bounce off the edges, or drift again
//   /astroduck off                           back to the app's own look, for this session
//
// The choice is kept for the next sessions. Each session draws a new random sky.

const USAGE = 'Use /astroduck less | normal | more, /astroduck animated on | off, /astroduck bounce on | off, or /astroduck off.'

const { theme } = makeColors({
  id: 'astroduck',
  label: 'astroduck',
  only: 'dark',
  dark: {
    gray: {
      anchors: {
        'surface-0': '#000000',
        'surface-1': '#08080d',
        'surface-2': '#0e0e16',
        'surface-3': '#14141e',
        'text-primary': '#eaeaf2',
        'text-secondary': '#bcbccc',
        'text-muted': '#7d7d95',
      },
    },
    roles: { accent: '#9d8cff', danger: '#ff4d6d', success: '#5ef2b0', warning: '#ffd166', pro: '#4cc9f0' },
    git: { added: '#5ef2b0', removed: '#ff4d6d', modified: '#b893ce', merged: '#9d8cff' },
  },
})

// Every variant is drawn once, from one seed, so the sky of a session stays the same while the settings change
const SCENES = allScenes(Math.floor(Math.random() * 4294967296))

const isDensity = (value: unknown): value is Density => value === 'less' || value === 'normal' || value === 'more'
const isMotion = (value: unknown): value is Motion => value === 'animated' || value === 'bounce' || value === 'still'

async function apply($: EngineInterface): Promise<string> {
  const storedDensity = await $.store.get('density')
  const storedMotion = await $.store.get('motion')
  const density: Density = isDensity(storedDensity) ? storedDensity : 'normal'
  const motion: Motion = isMotion(storedMotion) ? storedMotion : 'animated'
  const set = await $.theme.set({
    colors: theme,
    backdrop: { scene: sceneKey(density, motion), glass: { blur: 18, opacity: 0.62 } },
  } satisfies ThemeSetArgs)
  if (!set.isDrawn) return `Set, but nothing draws it here: ${set.reason}`
  if (motion === 'bounce') return `${density}, ${FLOATERS[density]} objects bouncing.`
  return `${density}, up to ${MAX_AT_ONCE[density]} objects at once, animation ${motion === 'animated' ? 'on' : 'off'}.`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'astroduck',
      description: 'Pixel space sky: /astroduck less | normal | more, animated on | off, bounce on | off, off',
    })
    await apply($)
    return next(e)
  })

  on('command.run', { command: 'astroduck' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const unknown: string[] = []
    let themeOff = false
    for (let i = 0; i < words.length; i++) {
      const word = words[i]
      const next = words[i + 1]
      if (word === 'animated' && (next === 'on' || next === 'off')) {
        await $.store.set('motion', next === 'on' ? 'animated' : 'still')
        i++
      } else if (word === 'bounce') {
        // "bounce" or "bounce on" bounces; "bounce off" goes back to drifting
        await $.store.set('motion', next === 'off' ? 'animated' : 'bounce')
        if (next === 'on' || next === 'off') i++
      } else if (isDensity(word)) {
        await $.store.set('density', word)
      } else if (word === 'off') {
        themeOff = true
      } else {
        unknown.push(word)
      }
    }
    if (unknown.length > 0) return { text: `Unknown: ${unknown.join(' ')}. ${USAGE}` }
    if (themeOff) {
      await $.theme.clear()
      return { text: 'Off for this session. /astroduck brings it back.' }
    }
    return { text: await apply($) }
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    if (e.surface !== 'desktop' && e.surface !== 'mobile') return next(e)
    const source = SCENES[e.props.scene]
    if (source === undefined) return next(e)
    const { Svg } = $.ui.resolve(e)
    return <Svg source={source} alt="Pixel planets of the solar system, galaxies, a black hole and astroducks in deep space" isInteractive />
  })
}
