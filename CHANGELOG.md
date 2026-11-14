# Changelog

## 1.0.4

* The animated sky now moves in the desktop app. It is laid out like scenes the app animates: the style sheet first, nothing on the root but its size, and each sprite drawn in place instead of through `<use>`.
* `/astroduck bounce on | bounce off`: a new mode where 6, 10 or 15 objects stay on screen and bounce off the edges. Ducks fly faster and turn to face the way they go.
* If the app stops animations (reduced motion, no GPU), the animated skies show a still frame instead of an empty sky.
* The theme is called astroduck everywhere (it was Space Black).
* `more` draws 42 objects across its cycle instead of 60, so it stays under the app's size limit.

## 1.0.0

* astroduck for the Claude desktop app: a black theme with a pixel sky behind the conversation.
* The eight planets of the solar system, random planets and moons, galaxies, black holes, and astroducks in helmets with jetpacks.
* Astroducks share one design, and at least two are on screen at any time.
* `/astroduck less | normal | more` sets the most objects on screen at once: 10, 20 or 30. Background stars don't count.
* `/astroduck animated on | animated off` turns the drifting sky on or off.
* `/astroduck off` returns the app's own look for this session.
