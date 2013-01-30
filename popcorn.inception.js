// PLUGIN: inception

(function (window, Popcorn, undefined) {

	'use strict';

	var styleSheet,
		mediaTypes = {
			'webm': 'video',
			'mp4': 'video',
			'm4v': 'video',
			'ogv': {
				type: 'video',
				ext: 'ogg'
			},
			'mp3': 'audio',
			'oga': {
				type: 'audio',
				ext: 'ogg'
			},
			'ogg': 'audio',
			'aac': 'audio',
			'wav': 'audio',
			'opus': 'audio'
		},
		smart,
		baseURI;

	/*********************************************************************************
	* parseUri 1.2.2
	* http://blog.stevenlevithan.com/archives/parseuri
	* (c) Steven Levithan <stevenlevithan.com>
	* MIT License
	*/
	function parseUri (str) {
		var	o   = parseUri.options,
				m   = o.parser[o.strictMode ? "strict" : "loose"].exec(str),
				uri = {},
				i   = 14;

		while (i--) {
			uri[o.key[i]] = m[i] || "";
		}

		uri[o.q.name] = {};
		uri[o.key[12]].replace(o.q.parser, function ($0, $1, $2) {
			if ($1) {
				uri[o.q.name][$1] = $2;
			}
		});

		return uri;
	}

	parseUri.options = {
		strictMode: false,
		key: ["source","protocol","authority","userInfo","user","password","host","port","relative","path","directory","file","query","anchor"],
		q:   {
			name:   "queryKey",
			parser: /(?:^|&)([^&=]*)=?([^&]*)/g
		},
		parser: {
			strict: /^(?:([^:\/?#]+):)?(?:\/\/((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?))?((((?:[^?#\/]*\/)*)([^?#]*))(?:\?([^#]*))?(?:#(.*))?)/,
			loose:  /^(?:(?![^:@]+:[^:@\/]*@)([^:\/?#.]+):)?(?:\/\/)?((?:(([^:@]*)(?::([^:@]*))?)?@)?([^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/
		}
	};

	function sourcesMatch(current, sources, from, to) {
		var uri, i, j, source,
			currentUri = parseUri(current),
			path, split;

		for (i = 0; i < sources.length; i++) {
			source = sources[i];
			if (current === source) {
				return true;
			}

			if (source.indexOf('#') < 0) {
				source += '#t=' + from;
				if (to < Infinity) {
					source += ',' + to;
				}
			}
			if (current === source) {
				return true;
			}

			if (!baseURI) {
				baseURI = parseUri(document.baseURI);
			}

			uri = parseUri(source);
			if (!uri.host &&
				(!uri.protocol || uri.protocol === currentUri.protocol) &&
				(!currentUri.anchor || uri.anchor === currentUri.anchor) &&
				uri.queryKey === currentUri.queryKey) {

				split = uri.path.split('/');

				if (split.length && split[0] === '') {
					if (uri.path === currentUri.path) {
						return true;
					}
				} else {
					path = baseURI.path.split('/');
					path.pop();
					for (j = 0; j < split.length; j++) {
						if (split[j] === '..') {
							path.pop();
						} else if (split[j] !== '.') {
							path.push(split[j]);
						}
					}
					if (path.join('/') === currentUri.path) {
						return true;
					}
				}
			}
		}

		return false;
	}

	smart = function(div, sources, preferred) {
		var i, j, wrapper,
			media,
			keys = Object.keys(Popcorn);

		if (preferred && Popcorn.hasOwnProperty(preferred)) {
			keys.unshift(preferred);
		}

		if (!Popcorn.isArray(sources)) {
			sources = [sources];
		}
		for (i = 0; i < keys.length; i++) {
			wrapper = Popcorn[keys[i]];
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
			from, to,
			duration = Infinity,
			popcornOptions,
			targetTime,
			active,
			optionEvents = {},
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
			var newWrapperProto,
				mediaType,
				mimeType,
				i, node,
				src,
				extensions = {};

			function getExtension(source) {
				var ext = extensions[source];
				if (ext) {
					return ext;
				}
				ext = /\.([a-z]+)(\?|#|$)/i.exec(source);
				ext = ext && ext[1] || '';
				extensions[source] = ext;
				return ext;
			}

			function getMimeType(source) {
				var ext = getExtension(source),
					t = mediaTypes[ext];

				return t && (t.type ? t.type + '/' + t.ext : t + '/' + ext) || '';
			}

			function loadSources(media, sources, mimeType, force) {
				var node, i;
				if (mimeType && media.canPlayType(mimeType)) {
					for (i = 0; i < sources.length; i++) {
						src = sources[i];
						node = document.createElement('source');
						node.setAttribute('src', src);
						node.setAttribute('type', mimeType);
						media.appendChild(node);
					}
				} else if (!mimeType || force) {
					for (i = 0; i < sources.length; i++) {
						src = sources[i];

						mimeType = getMimeType(src);
						if ((!mimeType && force) || (mimeType && media.canPlayType(mimeType))) {
							node = document.createElement('source');
							node.setAttribute('src', src);
							if (mimeType) {
								node.setAttribute('type', mimeType);
							}
							media.appendChild(node);
						}
					}
				}
				if (node) {
					media.load();
					return true;
				}
				return false;
			}

			//todo: don't require options.source if null player is unavailable
			sources = base.toArray(sources);
			if (!sources || !sources.length) {
				//todo: handle missing end and/or from/to
				sources = ['#t=0,' + (options.end - options.start)];
			}

			if (options.mediaType && typeof options.mediaType === 'string') {
				if (Popcorn[options.mediaType] && Popcorn[options.mediaType]._canPlaySrc) {
					newWrapperProto = options.mediaType;
				}
				mediaType = options.mediaType.toLowerCase().split('/');
				if (mediaType.length > 1) {
					mimeType = mediaType[0] + '/' + mediaType[1];
					mediaType = mediaType[0];
				} else {
					mediaType = options.mediaType;
				}
			}

			//first see if we can play with an existing player
			if (media && (!newWrapperProto || mediaWrapperProto === newWrapperProto)) {
				//try to keep using current media src if possible
				if (media.currentSrc && sourcesMatch(media.currentSrc, sources, from, to)) {
					//source is the same as it was. move along
					return;
				}

				if (mediaWrapperProto && media._canPlaySrc &&
					!(newWrapperProto || newWrapperProto === mediaWrapperProto)) {

					for (i = 0; i < sources.length; i++) {
						src = sources[i];
						if (media._canPlaySrc(src)) {
							media.src = src;
							sourceParams = sources;
							return;
						}
					}
				} else if (media.canPlayType) { //native
					//clear out old sources before adding new ones
					for (i = 0; i < media.childNodes.length; i++) {
						node = media.childNodes[i];
						if (node.tagName === 'SOURCE') {
							media.removeChild(node);
						}
					}
					media.removeAttribute('src');
					if (loadSources(media, sources, mimeType)) {
						return;
					}
				}
			}

			//old media did not work, so remove it
			mediaWrapperProto = false;
			if (media) {
				media.src = '';
				if (typeof media.load === 'function') {
					media.load();
				}
				if (media._util && media._util.destroy) {
					media._util.destroy();
				}
				if (media.parentNode) {
					try {
						media.parentNode.removeChild(media);
					} catch (e) {}
				}
				media = null;
			}
			if (popcorn) {
				//gonna need a new popcorn instance
				popcorn.destroy();
				popcorn = false;
				options.popcorn = false;
				optionEvents = {};
			}


			if (!mediaType) {
				//guess media type from file extensions
				for (i = 0; i < sources.length; i++) {
					mediaType = mediaTypes[getExtension(sources[i])];
					if (mediaType) {
						if (mediaType.type) {
							mediaType = mediaType.type;
						}
						break;
					}
				}
			}

			if (!mediaType || mediaType === 'audio' || mediaType === 'video') {
				//if mime type is set explicitly or clear from file extensions,
				//try to use native media elements
				media = document.createElement(mediaType || 'video');
				if (loadSources(media, sources, mimeType)) {
					div.appendChild(media);
				} else {
					media = false;
				}
			}

			if (!media) {
				media = smart(div, sources, newWrapperProto);
				if (media) {
					mediaWrapperProto = media._eventNamespace.split('::')[0];
				}
			}
			if (!media) {
				media = document.createElement('video');
				if (loadSources(media, sources, mimeType, true)) {
					div.appendChild(media);
				} else {
					media = false;
				}
			}

			if (media) {
				media.preload = options.preload || 'auto';
				if (options.poster) {
					media.poster = options.poster;
				}
			}
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
			var id, i, j,
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
					if (list.hasOwnProperty(i)) {
						deleteQueue.push(i);
					}
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
							j = deleteQueue.indexOf(id);
							if (j >= 0) {
								deleteQueue.splice(j, 1);
							}
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
					if (events.hasOwnProperty(eventType) && Popcorn.registryByName[eventType]) {
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
								j = deleteQueue.indexOf(id);
								if (j >= 0) {
									deleteQueue.splice(j, 1);
								}
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

		from = (options.from && Math.max(Popcorn.util.toSeconds(options.from), 0)) || 0;
		to = (options.to && Popcorn.util.toSeconds(options.to)) || Infinity;
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
				if (changes.hasOwnProperty('mediaType')) {
					options.mediaType = changes.mediaType;
				}
				if (changes.hasOwnProperty('source')) {
					updateSources(changes.source);
				}

				//todo: or new popcornOptions
				if (!popcorn) {
					updatePopcorn();
					newPopcorn = true;
				}

				if (changes.hasOwnProperty('controls')) {
					media.controls = !!changes.controls;
				}

				if (changes.hasOwnProperty('events')) {
					setUpPopcornEvents(changes.events);
				} else if (newPopcorn) {
					setUpPopcornEvents(options.events);
				}

				if (changes.hasOwnProperty('volume') && changes.volume !== options.volume) {
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
