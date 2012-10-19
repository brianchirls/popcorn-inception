# Popcorn Inception #

A [Popcorn.js](http://mozillapopcorn.org/) plugin that lets you embed an entire Popcorn composition inside another one, for as many levels deep as your computer can handle.

## Features ##

- Embed any media playable by Popcorn
- Load Popcorn events on spawned media
- Supports HTML5 video and audio, Vimeo and Soundcloud, with a Popcorn "[wrapper](https://github.com/mozilla/popcorn-js/tree/master/wrappers)"
- Synchronize main media with spawned media (optional)
- Specify in- and out-points to play partial section of spawned media
- Automatically detects browser support for multiple videos, with [popcorn.compatible](https://github.com/hapyak/popcorn.compatible)

## Roadmap ##
- Allow main media to pause while spawned media plays
- Support YouTube and other hosted formats

## Requirements ##

- [Popcorn Base](https://github.com/brianchirls/popcorn-base/) - Must be loaded *before* popcorn.inception.js. The file is included in this repo.
- Certain browsers (e.g. Mobile Safari on iPad) will not play more than one media file (audio or video) at a time.
- [popcorn-compatible](https://github.com/hapyak/popcorn.compatible) is not strictly required but is highly recommended to detect browser support and replace the plugin with a fallback when support is not available. Must be loaded *before* popcorn.inception.js. (Included)

### Additional media formats ###

To play Vimeo or Soundcloud media (YouTube and jPlayer coming soon), load the appropriate Popcorn [wrapper](https://github.com/mozilla/popcorn-js/tree/master/wrappers).

## Usage ##

### Loading a video ###

Even without the full interactive video features of a Popcorn composition, Popcorn Inception can be used simply to spawn a video or audio clip.

	popcorn.inception({
		//start and end times, just like any Popcorn event
		start: 5,
		end: 25,

		/*
		id of the element in which to put the new video/audio element
		or the element itself. Required.
		*/
		target: 'container',

		//a single string URL
		//url: 'videos/myvideo.webm'

		//...or an array of multiple sources:
		url: [
			'videos/myvideo.mp4',
			'videos/myvideo.webm'
		]
		/*
		inception will also an accept multiple sources as a new-line delimited string or a JSON string representing an array
		*/
	});

By default, the spawned media will play in sync with the main media. To have them play independently, set the `sync` parameter to `false`.

Media elements are rendered without built-in controls, but they may be enabled by setting `controls: true`.

### Playing a partial clip ###

When a child media clip is loaded into your main composition, by default, the entire clip is played, up to the end of your event.  But you can specify a section of the media, if you don't want to include the whole thing.

	popcorn.inception({
		start: 0, //play this video right at the beginning of the main video
		end: 15,
		url: 'http://vimeo.com/50531435', //play a Vimeo video

		//play this video for 15 seconds, starting 20 seconds in
		from: 20,
		to: 35
	});

It is usually a good idea to have the length of the clip match the length of the Popcorn event. If the clip is longer, it will just be cut off sooner. If the clip is shorter than the event, it will freeze on the last frame until the event is over and then disappear.

### Loading up Popcorn events ###

### Animation ###

Popcorn Inception is built with *Popcorn Base*, so any CSS styles can be set on the element containing the media as options on the event, and most of these can be animated with optional keyframes. See [detailed instructions](https://github.com/brianchirls/popcorn-base/#animate-param-options).

	popcorn.inception({
		start: 0,
		end: 10,
		url: 'videos/myvideo.webm',

		// animate video position from left to right and back again
		left: {
			0: '10%',
			0.5: '50%',
			1: '100%'
		},
		top: '10%',

		//fade out at the end
		opacity: {
			0.9: 1,
			1: 0
		}
	});

### Events ###

You can set the `onStart`, `onEnd`, `onFrame` and `onTeardown` parameters as callback functions, which will be passed the options object, in case you want to perform additional operations after the event is created.
