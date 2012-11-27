// PLUGIN: inception

(function (window, Popcorn, undefined) {

	'use strict';

	var styleSheet,
		mediaTypes = {
			'webm': 'video',
			'mp4': 'video',
			'm4v': 'video',
			'ogv': 'video',

			'mp3': 'audio',
			'oga': 'audio',
			'ogg': 'audio',
			'aac': 'audio',
			'wav': 'audio'
		};

	function guessMediaType(sources) {
		var ext, i;

		for (i = 0; i < sources.length; i++) {
			ext = /\.([a-z]+)$/i.exec(sources[i]);
			if (ext) {
				ext = ext[1];
				if (mediaTypes[ext]) {
					return mediaTypes[ext];
				}
			}
		}

		return false;
	}

	Popcorn.basePlugin('inception', function (options, base) {
		var me = this,
			popcorn,
			media,
			sync = options.sync === undefined ? true : options.sync,
			container, div, doc, iframe,
			sources,
			mediaType,
			i, events, evt, eventType,
			from, to,
			duration = Infinity,
			popcornOptions,
			targetTime,
			active;

		function seek(time) {
			function seekWhenReady() {
				duration = popcorn.duration();
				if (active) {
					popcorn.currentTime(targetTime);
				}
				popcorn.off('loadedmetadata', seekWhenReady);
			}

			if (popcorn.duration()) {
				popcorn.currentTime(time);
			} else {
				if (targetTime === undefined) {
					popcorn.on('loadedmetadata', seekWhenReady);
				}
				targetTime = time;
			}
		}

		function playOnStart() {
			var time = 0;

			if (!active) {
				return;
			}

			//if options.sync, advance to appropriate time
			if (options.sync) {
				time = me.currentTime() - options.start + from;
			}
			if (time < to) {
				seek(time);
				popcorn.play();
			} else {
				seek(Math.min(to, duration));
			}
		}

		function mainVideoPaused() {
			popcorn.pause();
		}

		function mainVideoSeeking() {
			var time = 0;

			if (!active) {
				return;
			}
			popcorn.pause();

			//if options.sync, advance to appropriate time
			if (options.sync) {
				time = me.currentTime() - options.start + from;
			}
			if (time >= to) {
				time = Math.min(to, duration);
			}
			seek(time);
		}

		function mainVideoSeeked() {
			if (!me.paused()) {
				playOnStart();
			}
		}

		function mainVideoVolume() {
			popcorn.volume(me.volume());
			popcorn.muted(me.muted());
		}

		if (!base.target) {
			return;
		}

		//todo: don't require options.source if null player is available
		sources = base.toArray(options.source, /[\n\r]+/);
		if (!sources || !sources.length) {
			return;
		}

		//todo: if no sources pass canPlayType, return null

		//todo: add stylesheet with basePlugin
		if (!styleSheet) {
			styleSheet = document.createElement('style');
			styleSheet.setAttribute('type', 'text/css');
			styleSheet.appendChild(
				document.createTextNode(
					'.popcorn-inception { display: none; }\n' +
					'.popcorn-inception > div.popcorn-inception-container { position: relative; }\n' +
					'.popcorn-inception > div.popcorn-inception-container > * { max-width: 100%; }\n' +
					'.popcorn-inception.active { display: inline-block; }\n'
			));
			document.head.appendChild(styleSheet);
		}

		container = options.container = base.makeContainer();
		if (options.id) {
			container.id = options.id;
		}
		base.animate(container);
		div = document.createElement(options.tag || 'div');
		div.className = 'popcorn-inception-container';
		container.appendChild(div);

		if (div.tagName === 'IFRAME') {
			doc = div.contentDocument;
			iframe = div;
			div = doc.body;
		} else {
			doc = document;
		}

		from = options.from && Math.max(Popcorn.util.toSeconds(options.from), 0) || 0;
		to = options.to && Popcorn.util.toSeconds(options.to) || Infinity;
		if (to < from) {
			to = Infinity;
		}

		popcornOptions = Popcorn.extend({}, me.options);
		Popcorn.extend(popcornOptions, options.options || {});
		if (popcornOptions.defaults) {
			// https://webmademovies.lighthouseapp.com/projects/63272-popcornjs/tickets/1374-popcorn-init-should-deep-copy-optionsdefaults
			(function() {
				var obj = {};

				Popcorn.forEach(popcornOptions.defaults, function(def, plugin) {
					obj[plugin] = Popcorn.extend({}, popcornOptions.defaults[plugin]);
				});
				popcornOptions.defaults = obj;
			}());
		}

		//use Popcorn.smart if available
		mediaType = options.type || guessMediaType(sources) || '';
		mediaType = mediaType.toLowerCase();
		if (mediaType !== 'video' && mediaType !== 'audio' && Popcorn.smart) {
			popcorn = Popcorn.smart(div, sources, popcornOptions);
			media = popcorn.media;
		} else {
			media = doc.createElement(mediaType || 'video');
			media.setAttribute('preload', 'auto');
			Popcorn.forEach(sources, function(url) {
				var source = doc.createElement('source');

				url += '#t=' + from;
				if (to < Infinity) {
					url += ',' + to;
				}

				source.setAttribute('src', url);
				media.appendChild(source);
			});
			if (options.poster) {
				media.setAttribute('poster', options.poster);
			}
			div.appendChild(media);
			popcorn = Popcorn(media, popcornOptions);
		}

		options.popcorn = popcorn;

		if (options.controls) {
			media.controls = true;
		}

		if (iframe) {
			popcorn.on('loadedmetadata', function() {
				iframe.width = media.videoWidth || media.width;
				iframe.height = media.videoHeight || media.height;
			});
		}

		if (from > 0) {
			seek(from);
		}

		if (to < Infinity) {
			popcorn.cue(to, function() {
				popcorn.pause();
			});
		}

		popcorn.on('loadedmetadata', function() {
			to = Math.min(to, popcorn.duration());
			to = Math.min(to, from + (options.end - options.start));
		});

		//todo: option to pause main video

		//set up popcorn events
		if (options.events) {
			for (i in Popcorn.registryByName) {
				popcorn.defaults(i, {
					target: div
				});
				popcorn.disable(i);
			}

			if (Popcorn.isArray(options.events)) {
				for (i = 0; i < options.events.length; i++) {
					evt = options.events[i];
					eventType = evt._type;
					if (eventType && Popcorn.registryByName[eventType]) {
						evt = Popcorn.extend({}, evt);
						delete evt._type;
						popcorn[eventType](evt);
					}
				}
			} else if (typeof options.events === 'object') {
				for (eventType in options.events) {
					if (Popcorn.registryByName[eventType]) {
						events = options.events[eventType];
						for (i = 0; i < events.length; i++) {
							evt = events[i];
							popcorn[eventType](evt);
						}
					}
				}
			}
		}

		return {
			start: function(event, options) {
				active = true;
				base.addClass(container, 'active');

				if (sync) {
					me.on('pause', mainVideoPaused);
					me.on('seeking', mainVideoSeeking);
					me.on('seeked', mainVideoSeeked);
				}

				if (options.volume === true) {
					mainVideoVolume();
				} else if (!isNaN(options.volume) && options.volume !== false) {
					popcorn.volume(options.volume);
				}

				for (i in Popcorn.registryByName) {
					popcorn.enable(i);
				}

				me.on('play', playOnStart);
				if (!me.paused()) {
					playOnStart();
				}
			},
			end: function(event, options) {
				var i;

				active = false;
				popcorn.pause();

				//in case there are any lingering popcorn events
				for (i in Popcorn.registryByName) {
					popcorn.disable(i);
				}

				me.off('play', playOnStart);

				base.removeClass(container, 'active');

				//remove any seeking/seeked listeners on 'me'
				me.off('pause', mainVideoPaused);
				me.off('seeking', mainVideoSeeking);
				me.off('seeked', mainVideoSeeked);
			},
			_teardown: function(event, options) {
				me.off('volumechange', mainVideoVolume);
				popcorn.destroy();
			}
		};
	}, {
		about: {
			name: 'Popcorn Inception Plugin',
			version: '0.1',
			author: 'Brian Chirls, @bchirls',
			website: 'https://github.com/brianchirls/popcorn-inception'
		},
		options: {
			start: {
				elem: 'input',
				type: 'number',
				label: 'Start',
				units: 'seconds'
			},
			end: {
				elem: 'input',
				type: 'number',
				label: 'End',
				units: 'seconds'
			},
			source: {
				elem: 'input',
				type: 'url',
				label: 'Source URL'
			},
			width: {
				elem: 'input',
				type: 'number',
				label: 'Width',
				'default': 100,
				'units': '%',
				hidden: true
			},
			height: {
				elem: 'input',
				type: 'number',
				label: 'Height',
				'default': 100,
				'units': '%',
				hidden: true
			},
			top: {
				elem: 'input',
				type: 'number',
				label: 'Top',
				'default': 0,
				'units': '%',
				hidden: true
			},
			left: {
				elem: 'input',
				type: 'number',
				label: 'Left',
				'default': 0,
				'units': '%',
				hidden: true
			},
			from: {
				elem: 'input',
				type: 'number',
				label: 'In',
				'default': 0
			},
			to: {
				elem: 'input',
				type: 'number',
				label: 'Out',
				'default': 10
			},
			volume: {
				elem: 'input',
				type: 'number',
				label: 'Volume',
				'default': 1,
				min: 0,
				max: 1,
				step: 0.01
			},
			zindex: {
				hidden: true
			}
		},
		incompatible: function() {
			return !!navigator.userAgent.match(/iP(od|ad|hone)/i) &&
				'Browser is unable to play multiple simultaneous media.';
		}
	});
}(this, this.Popcorn));
