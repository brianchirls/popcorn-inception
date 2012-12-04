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
		},
		smart,
		findWrapper;

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

	findWrapper = function(sources) {
		var i, j, wrapper;

		if (!Popcorn.isArray(sources)) {
			sources = [sources];
		}
		for (i in Popcorn) {
			wrapper = Popcorn[i];
			if (wrapper && wrapper._canPlaySrc &&
				wrapper !== Popcorn.HTMLVideoElement &&
				wrapper !== Popcorn.HTMLAudioElement &&
				typeof wrapper._canPlaySrc === 'function') {

				if (wrapper._canPlaySrc(sources)) {
					return i;
				}
				for (j = 0; j < sources.length; j++) {
					if (wrapper._canPlaySrc(sources[j])) {
						return i;
					}
				}
			}
		}
	};

	smart = function(div, sources) {
		var i, j, wrapper,
			media;

		if (!Popcorn.isArray(sources)) {
			sources = [sources];
		}
		for (i in Popcorn) {
			wrapper = Popcorn[i];
			if (wrapper && wrapper._canPlaySrc &&
				wrapper !== Popcorn.HTMLVideoElement &&
				wrapper !== Popcorn.HTMLAudioElement &&
				typeof wrapper._canPlaySrc === 'function') {

				if (wrapper._canPlaySrc(sources)) {
					media = wrapper(div);
					media.src = sources;
					return media;
				}
				for (j = 0; j < sources.length; j++) {
					if (wrapper._canPlaySrc(sources[j])) {
						media = wrapper(div);
						media.src = sources[j];
						return media;
					}
				}
			}
		}
	};

	Popcorn.basePlugin('inception', function (options, base) {
		var me = this,
			popcorn,
			media,
			sync = options.sync === undefined ? true : options.sync,
			paused,
			container, div, doc, iframe,
			sources,
			mediaType,
			from, to,
			duration = Infinity,
			popcornOptions,
			targetTime,
			active,
			optionEvents = {},
			i,
			sourceParams, mediaWrapperProto;

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
			if (sync && !paused) {
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
			if (sync && !paused) {
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

		function updateSources(sources) {
			var newSource = false,
				newMedia = false,
				isNative = false,
				newWrapperProto,
				i, node;

			//todo: don't require options.source if null player is unavailable
			sources = base.toArray(sources);
			if (!sources || !sources.length) {
				//todo: handle missing end and/or from/to
				sources = ['#t=0,' + (options.end - options.start)];
			}

			newWrapperProto = findWrapper(sources);
			if (!newWrapperProto) {
				newWrapperProto = options.type || guessMediaType(sources) || '';
				newWrapperProto = newWrapperProto.toLowerCase() || 'video';
				isNative = true;
			}

			if (sourceParams && sourceParams.length === sources.length) {
				for (i = 0; i < sources.length; i++) {
					if (sources[i] !== sourceParams[i]) {
						newSource = true;
						break;
					}
				}
			} else {
				newSource = true;
			}

			if (!newSource) {
				return;
			}

			if (newWrapperProto !== mediaWrapperProto || !media) {
				//completely new media type
				newMedia = true;
				if (sourceParams) {
					//clean out old sources and/or media
					if (media) {
						media.src = '';
						if (media._util && typeof media._util.destroy === 'function') {
							media._util.destroy();
						}
						if (media.parentNode && media.parentNode.removeChild) {
							try {
								media.parentNode.removeChild(media);
							} catch (e) {
							}
						}
					}

					//gonna need a new popcorn instance
					popcorn.destroy();
					popcorn = false;
					options.popcorn = false;
					optionEvents = {};
				}

				media = smart(div, sources);
				if (!media) {
					media = doc.createElement(newWrapperProto);
					media.setAttribute('preload', 'auto');
					if (options.poster) {
						media.setAttribute('poster', options.poster);
					}
					div.appendChild(media);
				}
				mediaWrapperProto = newWrapperProto;

			} else {
				if (media.childNodes && (media.tagName === 'VIDEO' || media.tagName === 'AUDIO')) {
					for (i = media.childNodes.length - 1; i >= 0; i--) {
						node = media.childNodes[i];
						if (node.tagName === 'source') {
							media.removeChild(node);
						}
					}
				}
			}

			if (isNative) {
				Popcorn.forEach(sources, function(url) {
					var source = doc.createElement('source');

					url += '#t=' + from;
					if (to < Infinity) {
						url += ',' + to;
					}

					source.setAttribute('src', url);
					media.appendChild(source);
				});
			} else if (!newMedia) {
				media.src = sources[0];
			}

			sourceParams = sources;
		}

		function updatePopcorn() {
			var i;

			popcorn = Popcorn(media, popcornOptions);
			options.popcorn = popcorn;

			for (i in Popcorn.registryByName) {
				if (Popcorn.registryByName.hasOwnProperty(i)) {
					popcorn.defaults(i, {
						target: div
					});
					if (!active) {
						popcorn.disable(i);
					}
				}
			}
		}

		function setUpPopcornEvents(events) {
			var id, i,
				optionEvent, eventType,
				eventList,
				deleteQueue = [],
				createQueue = [];

			function findExisting(plugin, obj) {
				var i, list = optionEvents[plugin];

				if (!list) {
					return false;
				}

				for (i in list) {
					if (list[i] === obj) {
						return i;
					}
				}

				return false;
			}

			//list of old popcorn events to delete if not updated
			Popcorn.forEach(optionEvents, function(list/*, plugin*/) {
				var i;
				for (i in list) {
					deleteQueue.push(i);
				}
			});

			if (Popcorn.isArray(events)) {
				for (i = 0; i < events.length; i++) {
					optionEvent = events[i];
					eventType = optionEvent._type;
					if (eventType && Popcorn.registryByName[eventType]) {
						id = findExisting(eventType, optionEvent);
						if (id) {
							popcorn[eventType](id, optionEvent);
							delete optionEvents[eventType][id];
							deleteQueue.splice(deleteQueue.indexOf(id), 1);
						} else {
							if (!optionEvents[eventType]) {
								optionEvents[eventType] = {};
							}
							createQueue.push({
								plugin: eventType,
								options: optionEvent
							});
						}
					}
				}
			} else if (typeof events === 'object') {
				for (eventType in events) {
					if (Popcorn.registryByName[eventType]) {
						if (!optionEvents[eventType]) {
							optionEvents[eventType] = {};
						}
						eventList = events[eventType];
						for (i = 0; i < eventList.length; i++) {
							optionEvent = eventList[i];
							id = findExisting(eventType, optionEvent);
							if (id) {
								popcorn[eventType](id, optionEvent);
								delete optionEvents[eventType][id];
								deleteQueue.splice(deleteQueue.indexOf(id), 1);
							} else {
								createQueue.push({
									plugin: eventType,
									options: optionEvent
								});
							}
						}
					}
				}
			}

			while (deleteQueue.length) {
				id = deleteQueue.shift();
				popcorn.removeTrackEvent(id);
			}

			while (createQueue.length) {
				optionEvent = createQueue.shift();
				popcorn[optionEvent.plugin](optionEvent.options);
				id = popcorn.getLastTrackEventId();
				optionEvents[optionEvent.plugin][id] = optionEvent.options;

			}
		}

		if (!base.target) {
			base.target = document.body;
		}

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

		updateSources(options.source);
		updatePopcorn();

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

		if (options.volume === true) {
			mainVideoVolume();
			me.on('volumechange', mainVideoVolume);
		}

		popcorn.on('loadedmetadata', function() {
			to = Math.min(to, popcorn.duration());
			to = Math.min(to, from + (options.end - options.start));

			//option to pause main video
			if (options.pause) {
				base.pause((options.pause === true || options.pause === 0) ? to : options.pause, {
					timeFn: function() {
						return popcorn.currentTime();
					},
					onPause: function() {
						paused = true;
					}
				});
			}
		});

		setUpPopcornEvents(options.events);

		return {
			start: function(event, options) {
				var i;

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
					if (Popcorn.registryByName.hasOwnProperty(i)) {
						popcorn.enable(i);
					}
				}

				me.on('play', playOnStart);
				if (!me.paused()) {
					playOnStart();
				}
			},
			end: function() {
				var i;

				active = false;
				paused = false;
				popcorn.pause();

				//in case there are any lingering popcorn events
				for (i in Popcorn.registryByName) {
					if (Popcorn.registryByName.hasOwnProperty(i)) {
						popcorn.disable(i);
					}
				}

				me.off('play', playOnStart);

				base.removeClass(container, 'active');

				//remove any seeking/seeked listeners on 'me'
				me.off('pause', mainVideoPaused);
				me.off('seeking', mainVideoSeeking);
				me.off('seeked', mainVideoSeeked);
			},
			_update: function(options, changes) {
				var newPopcorn;

				//todo: update from/to

				//update source, adjust durations
				if ('source' in changes) {
					updateSources(changes.source);
				}

				//todo: or new popcornOptions
				if (!popcorn) {
					updatePopcorn();
					newPopcorn = true;
				}

				if ('controls' in changes) {
					media.controls = !!changes.controls;
				}

				if ('events' in changes) {
					setUpPopcornEvents(changes.events);
				} else if (newPopcorn) {
					setUpPopcornEvents(options.events);
				}

				if ('volume' in changes && changes.volume !== options.volume) {
					if (changes.volume === true) {
						me.on('volumechange', mainVideoVolume);
						mainVideoVolume();
					} else {
						me.off('volumechange', mainVideoVolume);
						if (active && !isNaN(changes.volume) && changes.volume !== false) {
							popcorn.volume(options.volume);
						}
					}
				}
			},
			_teardown: function() {
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
