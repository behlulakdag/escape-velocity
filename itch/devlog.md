# How we made Escape Velocity in 48 hours

**Theme: Speed. One verb: hold to grab a planet, let go to fling.**

## The idea
Speed is your life, your score and your way out. You are a comet, a grumpy supernova climbs up the page behind you, and the only way to stay ahead is to steal speed from planets: hold to swing around one, let go to fling to the next. The faster you go, the faster you gain.

## A sketchbook, not a render
We wanted the game to look like someone drew it, not like a template. There are no image files: every planet, card, button and the supernova's angry face is drawn in code as gel-pen ink and crayon hatching on construction paper. The lines re-wobble about ten times a second ("line boil"), and every new zone turns to a new sheet of paper: navy, teal, maroon, black, purple, cream, kraft, forest green, blueprint, graph paper, charcoal... and it keeps going.

## Teaching one verb
Our first friends to play didn't get it: "where do I press?", "it goes to weird places", "I was trying NOT to get caught by the planets". So the first run now freezes in slow motion on the first two planets: the page dims, a hand-drawn finger says HOLD, the comet swings a full lap, then LET GO with an arrow to the next planet. After that, no more prompts, ever. Planets are your friends.

## Tuned by bots
To keep it fair, we ran thousands of headless runs with different bot "players": idle, random tappers, careful players, experts. That caught real bugs: one card let a random tapper live forever at 800 km/s, and a wall rule let blind tapping climb to the end. Both are fixed: tapping at random dies fast, skilled play reaches BEYOND (40,000 m and up).

## What's inside
12 upgrade cards in 4 families with set bonuses, missions that pay coins, 7 comet skins, a card journal, a pause button, and procedural music and sound that react to your speed.

## Credits
Made for Slapjam #2 with Phaser 3. AI tools used: Claude Code (code, in-code drawings, procedural audio). Font: Lilita One (OFL).

Thanks for playing, and thanks to everyone who tested it on their phones!
