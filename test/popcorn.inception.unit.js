/*global module, test, equal, expect, ok, start */
//not gonna be annoying
(function(window, Popcorn, QUnit, undefined) {

	'use strict';

	var testsrc = [
		'http://videos.mozilla.org/serv/webmademovies/atultroll.webm'
	];

	window.addEventListener('DOMContentLoaded', function() {
		var video = document.getElementById('video');
		video.muted = true;
		video.addEventListener('loadedmetadata', function() {
			QUnit.start();
		}, false);
	}, false);

	module('Core');
	test('Core', function() {
		var p, props = 0;
		
		expect(1);

		for (p in Popcorn) {
			props++;
		}
		
		equal(props, window.popcornProperties, 'No properties added to Popcorn global');
	});

	module('Update');

	test('Update source', function() {
		var popcorn,
			media,
			newMedia,
			id;

		popcorn = Popcorn('#video');

		popcorn.inception({
			start: 0,
			end: 4,
			target: 'container',
			onSetup: function(options) {
				media = options.popcorn.media;
			}
		});

		ok(media && media instanceof Popcorn._MediaElementProto, 'Null media created');

		id = popcorn.getLastTrackEventId();
		popcorn.inception(id, {
			source: '#t=0,6',
			onUpdate: function(options) {
				newMedia = options.popcorn.media;
			}
		});
		ok(media && media instanceof Popcorn._MediaElementProto, 'Null media updated');
		ok(media === newMedia, 'Use same media if type is the same');

		popcorn.inception(id, {
			source: testsrc,
			onUpdate: function(options) {
				newMedia = options.popcorn.media;
			}
		});
		ok(newMedia && newMedia instanceof window.HTMLVideoElement, 'Media changed to different type');

		media = newMedia;
		popcorn.inception(id, {
			source: [
				testsrc[0],
				'dummy.mp4'
			],
			onUpdate: function(options) {
				newMedia = options.popcorn.media;
			}
		});
		ok(media === newMedia, 'Use same media if current source is included in new source array');
		ok(media.firstChild === newMedia.firstChild, 'Use same source if current source is included in new source array');

		media = newMedia;
		popcorn.inception(id, {
			source: testsrc,
			onUpdate: function(options) {
				newMedia = options.popcorn.media;
			},
			mediaType: 'HTMLVideojsVideoElement'
		});
		ok(newMedia && newMedia._util.type === 'Videojs', 'Media forced to different type');

		popcorn.destroy();
	});

	asyncTest('Update Volume', function() {
		var popcorn,
			id,
			media;

		expect(5);

		popcorn = Popcorn('#video');
		popcorn.currentTime(0);
		popcorn.volume(0.2);

		popcorn.inception({
			start: 1,
			end: 4,
			volume: 0.8,
			source: testsrc,
			target: 'container',
			onSetup: function(options) {
				media = options.popcorn.media;
			}
		});

		equal(media.volume, 1, 'Spawned media volume starts at 1.0');

		id = popcorn.getLastTrackEventId();
		popcorn.inception(id, {
			volume: 0.6
		});
		popcorn.currentTime(1.5);
		setTimeout(function() {
			ok(Math.abs(media.volume - 0.6) < 0.00001, 'Spawned media volume changed, event not current');

			popcorn.inception(id, {
				volume: 0.4
			});
			ok(Math.abs(media.volume - 0.4) < 0.00001, 'Spawned media volume changed, event current');

			popcorn.inception(id, {
				volume: true
			});
			ok(Math.abs(media.volume - 0.2) < 0.00001, 'Spawned media volume copies main media, event current');
			popcorn.volume(0);
			setTimeout(function() {
				equal(media.volume, 0, 'Spawned media volume follows main media, event current');

				//clean up
				popcorn.volume(1);
				popcorn.currentTime(0);
				popcorn.destroy();
				start();
			}, 10);

		}, 100);
	});

	test('Update events', function() {
		var popcorn, events, id,
			obj = {},
			teardowns = 0;

		expect(6);

		Popcorn.plugin('test', function(options) {
			obj[options.key] = options.val;
			return {
				start: function() {},
				end: function() {},
				_update: function(original, changes) {
					delete obj[original.key];
					original.key = changes.key;
					original.val = changes.val;
					obj[original.key] = original.val;
				},
				_teardown: function() {
					teardowns++;
					delete obj[options.key];
				}
			};
		});

		popcorn = Popcorn('#video');
		popcorn.currentTime(0);

		events = {
			test: [
				{
					start: 0,
					end: 1,
					key: 'foo',
					val: 'bar'
				},
				{
					start: 0,
					end: 1,
					key: 'deleteme',
					val: 'baz'
				}
			]
		};

		popcorn.inception({
			start: 0,
			end: 1,
			source: testsrc,
			events: events
		});

		equal(obj.foo, 'bar', 'Nested plugin creation');
		equal(obj.deleteme, 'baz', 'Nested plugin creation');

		id = popcorn.getLastTrackEventId();
		events.test[0].val = 'baz';
		events.test.pop();
		events.test.push({
			start: 0,
			end: 1,
			key: 'hello',
			val: 'world'
		});
		popcorn.inception(id, {
			events: events
		});

		equal(obj.foo, 'baz', 'Nested event modified');
		equal(obj.deleteme, undefined, 'Nested event removed');
		equal(obj.hello, 'world', 'Nested event added');
		equal(teardowns, 1, 'Tear down removed events');

		popcorn.destroy();
		Popcorn.removePlugin('test');
	});

}(this, this.Popcorn, this.QUnit));