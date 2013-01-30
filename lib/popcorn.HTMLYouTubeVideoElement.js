(function( Popcorn, window, document ) {

  "use strict";

  var

  CURRENT_TIME_MONITOR_MS = 10,
  EMPTY_STRING = "",
  MediaError = window.MediaError,

  // YouTube suggests 200x200 as minimum, video spec says 300x150.
  MIN_WIDTH = 300,
  MIN_HEIGHT = 200,

  // Example: http://www.youtube.com/watch?v=12345678901
  regexYouTube = /^.*(?:\/|v=)(.{11})/,
  regexYouTubeEmbed = /^https?:\/\/(?:www\.)?youtube\.com\/embed\/([A-Z0-9\-]+)($|\?.*)/i,

  ABS = Math.abs,

  // Setup for YouTube API
  ytReady = window.YT && window.YT.Player,
  ytLoaded = window.YT,
  ytCallbacks = [];

  function isYouTubeReady() {
    function onYouTubeIframeAPIReady() {
      ytReady = true;
      var i = ytCallbacks.length;
      while( i-- ) {
        ytCallbacks[ i ]();
        delete ytCallbacks[ i ];
      }
    }

    var oldReady = window.onYouTubeIframeAPIReady;

    if ( !ytReady ) {
      if ( window.YT && window.YT.Player ) {
        ytReady = true;
        onYouTubeIframeAPIReady();
        return true;
      }

      window.onYouTubeIframeAPIReady = function () {
        if ( oldReady && typeof oldReady === "function" ) {
          oldReady();
        }
        onYouTubeIframeAPIReady();
      };
    }

    // If the YouTube iframe API isn't injected, to it now.
    if( !ytLoaded && !window.YT ) {
      var tag = document.createElement( "script" );
      var protocol = window.location.protocol === "file:" ? "http:" : "";

      tag.src = protocol + "//www.youtube.com/iframe_api";
      var firstScriptTag = document.getElementsByTagName( "script" )[ 0 ];
      firstScriptTag.parentNode.insertBefore( tag, firstScriptTag );
      ytLoaded = true;
    }
    return ytReady;
  }

  function addYouTubeCallback( callback ) {
    ytCallbacks.unshift( callback );
  }

  // like instanceof, but it will work on elements that come from different windows (e.g. iframes)
  function instanceOfElement (element, proto) {
      var result;
      if (!element || typeof element !== "object") {
          return false;
      }

      if (!proto) {
          proto = "Element";
      } else if (typeof proto !== "string") {
          return element instanceof proto;
      }

      if (element instanceof window[proto]) {
          return true;
      }

      if (!element.ownerDocument || !element.ownerDocument.defaultView) {
          return false;
      }

      result = (element instanceof element.ownerDocument.defaultView[proto]);
      return result;
  }

  function findExistingPlayer( obj ) {
    if ( instanceOfElement( obj, "HTMLIFrameElement" ) ) {
      if ( obj.src && regexYouTubeEmbed.test( obj.src ) ) {
        return obj;
      }
    }

    if ( !window.YT || !obj || !window.YT.Player ) {
      return false;
    }

    if ( obj instanceof window.YT.Player ) {
      return obj;
    }
  }

  function HTMLYouTubeVideoElement( id ) {

    // YouTube iframe API requires postMessage
    if( !window.postMessage ) {
      throw "ERROR: HTMLYouTubeVideoElement requires window.postMessage";
    }

    var self = this,
      parent = typeof id === "string" ? document.querySelector( id ) : id,
      elem,
      iframe,
      impl = {
        src: EMPTY_STRING,
        networkState: self.NETWORK_EMPTY,
        readyState: self.HAVE_NOTHING,
        seeking: false,
        autoplay: EMPTY_STRING,
        preload: EMPTY_STRING,
        controls: false,
        loop: false,
        poster: EMPTY_STRING,
        volume: -1,
        muted: false,
        currentTime: 0,
        duration: NaN,
        ended: false,
        paused: true,
        width: parent.width|0   ? parent.width  : MIN_WIDTH,
        height: parent.height|0 ? parent.height : MIN_HEIGHT,
        error: null
      },
      playerReady = false,
      player,
      existingPlayer,
      playerReadyCallbacks = [],
      metadataReadyCallbacks = [],
      playerState = -1,
      stateMonitors = {},
      stateMonitorTimeout,
      updateDurationTimeout,
      bufferedInterval,
      lastLoadedFraction = 0,
      currentTimeInterval,
      lastCurrentTime = 0,
      seekTarget = -1,
      timeUpdateInterval,
      forcedLoadMetadata = false;

    function addPlayerReadyCallback( callback ) {
      if ( playerReadyCallbacks.indexOf( callback ) < 0 ) {
        playerReadyCallbacks.unshift( callback );
      }
    }

    function addMetadataReadyCallback( callback ) {
      if ( metadataReadyCallbacks.indexOf( callback ) < 0 ) {
        metadataReadyCallbacks.unshift( callback );
      }
    }

    function onPlayerReady( event ) {
      var fn;
      if ( !event || player === event.target ) {
        playerReady = true;
        while( playerReadyCallbacks.length ) {
          fn = playerReadyCallbacks.pop();
          fn();
        }
      }
    }

    // YouTube sometimes sends a duration of 0.  From the docs:
    // "Note that getDuration() will return 0 until the video's metadata is loaded,
    // which normally happens just after the video starts playing."
    function forceLoadMetadata() {
      if( !forcedLoadMetadata ) {
        forcedLoadMetadata = true;
        self.play();
        self.pause();
      }
    }

    function getDuration() {
      if( !playerReady ) {
        // Queue a getDuration() call so we have correct duration info for loadedmetadata
        addPlayerReadyCallback( getDuration );
        return impl.duration;
      }

      var oldDuration = impl.duration,
          newDuration = player.getDuration();

      // Deal with duration=0 from YouTube
      if( newDuration ) {
        if( oldDuration !== newDuration ) {
          impl.duration = newDuration;
          self.dispatchEvent( "durationchange" );
        }
      } else {
        // Force loading metadata, and wait on duration>0
        forceLoadMetadata();
        setTimeout( getDuration, 50 );
      }

      return newDuration;
    }

    function onPlayerError(event) {
      // There's no perfect mapping to HTML5 errors from YouTube errors.
      var err = { name: "MediaError" };

      switch( event.data ) {

        // invalid parameter
        case 2:
          err.message = "Invalid video parameter.";
          err.code = MediaError.MEDIA_ERR_ABORTED;
          break;

        // HTML5 Error
        case 5:
          err.message = "The requested content cannot be played in an HTML5 player or another error related to the HTML5 player has occurred.";
          err.code = MediaError.MEDIA_ERR_DECODE;
          break;

        // requested video not found
        case 100:
          err.message = "Video not found.";
          err.code = MediaError.MEDIA_ERR_NETWORK;
          break;

        // video can't be embedded by request of owner
        case 101:
        case 150:
          err.message = "Video not usable.";
          err.code = MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
          break;

        default:
          err.message = "Unknown error.";
          err.code = 5;
      }

      impl.error = err;
      self.dispatchEvent( "error" );
    }

    function onPlayerStateChange( event ) {
      function updateDuration() {
        var fn;

        if ( !impl.readyState && playerReady && getDuration() ) {
          // XXX: this should really live in cued below, but doesn't work.
          impl.readyState = self.HAVE_METADATA;
          self.dispatchEvent( "loadedmetadata" );
          bufferedInterval = setInterval( monitorBuffered, 50 );

          while( metadataReadyCallbacks.length ) {
            fn = metadataReadyCallbacks.pop();
            fn();
          }

          self.dispatchEvent( "loadeddata" );

          impl.readyState = self.HAVE_FUTURE_DATA;
          self.dispatchEvent( "canplay" );

          // We can't easily determine canplaythrough, but will send anyway.
          impl.readyState = self.HAVE_ENOUGH_DATA;
          self.dispatchEvent( "canplaythrough" );

          // Auto-start if necessary
          if( impl.autoplay ) {
            self.play();
          }
          return;
        }

        if (!updateDurationTimeout) {
          updateDurationTimeout = setTimeout( updateDuration, 50 );
        }
      }

      updateDuration();

      switch( event.data ) {
        // ended
        case YT.PlayerState.ENDED:
          onEnded();
          break;

        // playing
        case YT.PlayerState.PLAYING:
          onPlay();
          break;

        // paused
        case YT.PlayerState.PAUSED:
          onPause();
          break;

        // buffering
        case YT.PlayerState.BUFFERING:
          impl.networkState = self.NETWORK_LOADING;
          self.dispatchEvent( "waiting" );
          break;

        // video cued
        case YT.PlayerState.CUED:
          // XXX: cued doesn't seem to fire reliably, bug in youtube api?
          break;
      }
      if (event.data !== YT.PlayerState.BUFFERING && playerState === YT.PlayerState.BUFFERING) {
        onProgress();
      }

      playerState = event.data;
    }

    function onPlaybackQualityChange() {
      self.dispatchEvent( "playbackqualitychange" );
    }

    function destroyPlayer() {
      if( !( playerReady && player ) ) {
        return;
      }
      clearInterval( currentTimeInterval );
      clearInterval( bufferedInterval );
      clearTimeout( stateMonitorTimeout );
      clearTimeout( updateDurationTimeout );
      Popcorn.forEach( stateMonitors, function(obj, i) {
        delete stateMonitors[i];
      });

      //don't destroy existing player
      if ( existingPlayer ) {
        return;
      }

      try {
        player.stopVideo();
      } catch (stopError) {
      }

      try {
        player.clearVideo();
      } catch (clearError) {
      }

      //really destroy iframe
      if (iframe) {
        iframe.src = '';
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
        iframe = null;
      }

      if ( elem && elem.parentNode ) {
        elem.parentNode.removeChild( elem );
      }
      elem = null;
    }

    function changeSrc( aSrc ) {
      var playerVars,
          match, newPlayer = true;

      if ( aSrc === player ) {
        return;
      }

      if( !self._canPlaySrc( aSrc ) ) {
        impl.error = {
          name: "MediaError",
          message: "Media Source Not Supported",
          code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
        };
        self.dispatchEvent( "error" );
        return;
      }

      impl.src = aSrc;

      // Make sure YouTube is ready, and if not, register a callback
      if( !isYouTubeReady() ) {
        addYouTubeCallback( function() { changeSrc( aSrc ); } );
        return;
      }

      if( playerReady ) {
        destroyPlayer();
      }

      playerReady = false;
      impl.networkState = self.NETWORK_LOADING;
      self.dispatchEvent( "loadstart" );
      self.dispatchEvent( "progress" );

      if ( existingPlayer ) {
        if ( instanceOfElement( existingPlayer, "HTMLIFrameElement" ) ) {
          iframe = existingPlayer;
          match = regexYouTubeEmbed.exec( iframe.src );
          if ( player ) {
            newPlayer = false;
          } else {
            player = new window.YT.Player( iframe );
            aSrc = match[1];
            impl.src = (window.location.protocol === "file:" ? "http:" : window.location.protocol) + "//www.youtube.com/watch?v=" + aSrc;
          }

          //impl.src = getVideoUrl
          impl.width = parseFloat(iframe.width) || iframe.offsetWidth;
          impl.height = parseFloat(iframe.height) || iframe.offsetHeight;
        } else {
          if ( player ) {
            newPlayer = false;
          } else {
            player = existingPlayer;
          }
          iframe = player.getIframe();
        }

        if ( player.getPlayerState ) {
          playerReady = true;
          onPlayerReady();
        } else if ( newPlayer ) {
          player.addEventListener( "onReady", onPlayerReady );
        }

        if ( newPlayer ) {
          player.addEventListener( "onError", onPlayerError );
          player.addEventListener( "onStateChange", onPlayerStateChange );
          player.addEventListener( "onPlaybackQualityChange", onPlaybackQualityChange );
        } else if ( typeof aSrc === "string" ) {
          if ( playerReady ) {
            player.loadVideoById( aSrc );
          } else {
            addPlayerReadyCallback( function() {
              player.loadVideoById( aSrc );
            } );
          }
        }

      } else {
        elem = document.createElement( "div" );
        parent.appendChild( elem );

        // Use any player vars passed on the URL
        playerVars = self._util.parseUri( aSrc ).queryKey;

        // Remove the video id, since we don't want to pass it
        delete playerVars.v;

        // Sync autoplay, but manage internally
        impl.autoplay = playerVars.autoplay === "1" || impl.autoplay;
        delete playerVars.autoplay;

        // Sync loop, but manage internally
        impl.loop = playerVars.loop === "1" || impl.loop;
        delete playerVars.loop;

        // Don't show related videos when ending
        playerVars.rel = playerVars.rel || 0;

        // Don't show YouTube's branding
        playerVars.modestbranding = playerVars.modestbranding || 1;

        // Don't show annotations by default
        playerVars.iv_load_policy = playerVars.iv_load_policy || 3;

        // Don't show video info before playing
        playerVars.showinfo = playerVars.showinfo || 0;

        // Specify our domain as origin for iframe security
        var domain = window.location.protocol === "file:" ? "*" :
          window.location.protocol + "//" + window.location.host;
        playerVars.origin = playerVars.origin || domain;

        // Show/hide controls. Sync with impl.controls and prefer URL value.
        playerVars.controls = playerVars.controls || impl.controls ? 2 : 0;
        impl.controls = playerVars.controls;

        // Get video ID out of youtube url
        aSrc = regexYouTube.exec( aSrc )[ 1 ];

        player = new YT.Player( elem, {
          width: impl.width,
          height: impl.height,
          videoId: aSrc,
          playerVars: playerVars,
          events: {
            'onReady': onPlayerReady,
            'onError': onPlayerError,
            'onStateChange': onPlayerStateChange,
            'onPlaybackQualityChange': onPlaybackQualityChange
          }
        });

        iframe = parent.lastChild;
      }

      // Queue a get duration call so we'll have duration info
      // and can dispatch durationchange.
      forcedLoadMetadata = false;
      getDuration();
    }

    function monitorState() {
      var finished = true;

      Popcorn.forEach( stateMonitors, function(change, i) {
        change = stateMonitors[ i ];

        if ( typeof player[i] !== 'function' ) {

          delete stateMonitors[i];
          return;

        }

        if ( player[i]() !== change.val ) {

          self.dispatchEvent( change.evt );
          delete stateMonitors[i];
          return;

        }

        finished = false;
      });

      if (finished) {
        stateMonitorTimeout = false;
      } else {
        stateMonitorTimeout = setTimeout( monitorState, 10 );
      }
    }

    function changeState(playerHook, value, eventName) {
      if (stateMonitors[playerHook]) {
        return;
      }

      stateMonitors[playerHook] = {
        val: value,
        evt: eventName
      };

      if (!stateMonitorTimeout) {
        stateMonitorTimeout = setTimeout(monitorState);
      }
    }

    function monitorCurrentTime() {
      var currentTime = impl.currentTime = player.getCurrentTime();

      // See if the user seeked the video via controls
      if( !impl.seeking && ABS( lastCurrentTime - currentTime ) > CURRENT_TIME_MONITOR_MS ) {
        onSeeking();
        onSeeked();
      }

      // See if we had a pending seek via code.  YouTube drops us within
      // 1 second of our target time, so we have to round a bit, or miss
      // many seek ends.
      if( ( seekTarget > -1 ) &&
          ( ABS( currentTime - seekTarget ) < 1 ) ) {
        seekTarget = -1;
        onSeeked();
      }
      lastCurrentTime = impl.currentTime;
    }

    function monitorBuffered() {
      var fraction = player.getVideoLoadedFraction();

      if ( lastLoadedFraction !== fraction ) {
        lastLoadedFraction = fraction;

        onProgress();

        if (fraction >= 1) {
          clearInterval( bufferedInterval );
        }
      }
    }

    function getCurrentTime() {
      if( !playerReady ) {
        return 0;
      }

      impl.currentTime = player.getCurrentTime();
      return impl.currentTime;
    }

    function changeCurrentTime( aTime ) {
      if( !playerReady ) {
        addMetadataReadyCallback( function() { changeCurrentTime( aTime ); } );
        return;
      }

      if ( !currentTimeInterval ) {
        currentTimeInterval = setInterval( monitorCurrentTime,
                                           CURRENT_TIME_MONITOR_MS ) ;
      }
      onSeeking( aTime );
      player.seekTo( aTime );
    }

    function onTimeUpdate() {
      self.dispatchEvent( "timeupdate" );
    }

    function onSeeking( target ) {
      if( target !== undefined ) {
        seekTarget = target;
      }
      impl.seeking = true;
      self.dispatchEvent( "seeking" );
    }

    function onSeeked() {
      impl.seeking = false;
      self.dispatchEvent( "timeupdate" );
      self.dispatchEvent( "seeked" );
      self.dispatchEvent( "canplay" );
      self.dispatchEvent( "canplaythrough" );
    }

    function onPlay() {
      if (impl.seeking && impl.paused) {
        player.pauseVideo();
        return;
      }

      // We've called play once (maybe through autoplay),
      // no need to force it from now on.
      forcedLoadMetadata = true;

      if( impl.ended && player.getCurrentTime() >= getDuration() ) {
        changeCurrentTime( 0 );
      }

      if ( !currentTimeInterval ) {
        currentTimeInterval = setInterval( monitorCurrentTime,
                                           CURRENT_TIME_MONITOR_MS ) ;

        // Only 1 play when video.loop=true
        if ( impl.loop ) {
          setTimeout(function() {
            self.dispatchEvent( "play" );
          }, 10);
        }
      }

      timeUpdateInterval = setInterval( onTimeUpdate,
                                        self._util.TIMEUPDATE_MS );

      if( impl.paused ) {
        impl.paused = false;

        // Only 1 play when video.loop=true
        if ( !impl.loop ) {
          self.dispatchEvent( "play" );
        }
        self.dispatchEvent( "playing" );
      }
    }

    function onProgress() {
      self.dispatchEvent( "progress" );
    }

    function onPause() {
      impl.paused = true;
      clearInterval( timeUpdateInterval );
      self.dispatchEvent( "pause" );
    }

    function onEnded() {
      if( impl.loop ) {
        changeCurrentTime( 0 );
        self.play();
      } else {
        impl.ended = true;
        self.dispatchEvent( "ended" );
      }
    }

    function setVolume( aValue ) {
      impl.volume = aValue;
      if( !playerReady ) {
        addMetadataReadyCallback( function() {
          setVolume( impl.volume );
        });
        return;
      }
      changeState( "getVolume", player.getVolume(), "volumechange" );
      player.setVolume( aValue );
    }

    function getVolume() {
      if( !playerReady ) {
        return impl.volume > -1 ? impl.volume : 100;
      }
      return player.getVolume();
    }

    function setMuted( aValue ) {
      impl.muted = aValue;
      if( !playerReady ) {
        addMetadataReadyCallback( function() { setMuted( impl.muted ); } );
        return;
      }
      changeState( "isMuted", player.isMuted(), "volumechange" );
      player[ aValue ? "mute" : "unMute" ]();
    }

    function getMuted() {
      // YouTube has isMuted(), but for sync access we use impl.muted
      return impl.muted;
    }

    function updateSize() {
      player.setSize( impl.width, impl.height );
    }

    // Namespace all events we'll produce
    self._eventNamespace = Popcorn.guid( "HTMLYouTubeVideoElement::" );

    self.parentNode = parent;

    //so the original doesn't get modified
    self._util = Popcorn.extend( {}, self._util );

    // Mark this as YouTube
    self._util.type = "YouTube";

    self._util.destroy = function () {
      destroyPlayer();
    };

    self.play = function() {
      if( !playerReady ) {
        addPlayerReadyCallback( function() { self.play(); } );
        return;
      }
      player.playVideo();
    };

    self.pause = function() {
      if( !playerReady ) {
        addPlayerReadyCallback( function() { self.pause(); } );
        return;
      }
      player.pauseVideo();
    };

    Object.defineProperties( self, {

      src: {
        get: function() {
          return impl.src;
        },
        set: function( aSrc ) {
          if( aSrc && aSrc !== impl.src ) {
            changeSrc( aSrc );
          }
        }
      },

      autoplay: {
        get: function() {
          return impl.autoplay;
        },
        set: function( aValue ) {
          impl.autoplay = self._util.isAttributeSet( aValue );
        }
      },

      loop: {
        get: function() {
          return impl.loop;
        },
        set: function( aValue ) {
          impl.loop = self._util.isAttributeSet( aValue );
        }
      },

      width: {
        get: function() {
          return impl.width || iframe && iframe.width;
        },
        set: function( aValue ) {
          impl.width = aValue;

          if( playerReady ) {
              player.setSize( impl.width, impl.height );
          } else {
              addPlayerReadyCallback( updateSize );
          }
        }
      },

      height: {
        get: function() {
          return impl.height || iframe && iframe.height;
        },
        set: function( aValue ) {
          impl.height = aValue;

          if( playerReady ) {
              player.setSize( impl.width, impl.height );
          } else {
              addPlayerReadyCallback( updateSize );
          }
        }
      },

      currentTime: {
        get: function() {
          return getCurrentTime();
        },
        set: function( aValue ) {
          changeCurrentTime( aValue );
        }
      },

      duration: {
        get: function() {
          return getDuration();
        }
      },

      ended: {
        get: function() {
          return impl.ended;
        }
      },

      paused: {
        get: function() {
          return impl.paused;
        }
      },

      seeking: {
        get: function() {
          return impl.seeking;
        }
      },

      readyState: {
        get: function() {
          return impl.readyState;
        }
      },

      networkState: {
        get: function() {
          return impl.networkState;
        }
      },

      volume: {
        get: function() {
          // Remap from HTML5's 0-1 to YouTube's 0-100 range
          var volume = getVolume();
          return volume / 100;
        },
        set: function( aValue ) {
          if( aValue < 0 || aValue > 1 ) {
            throw "Volume value must be between 0.0 and 1.0";
          }

          // Remap from HTML5's 0-1 to YouTube's 0-100 range
          aValue = aValue * 100;
          setVolume( aValue );
        }
      },

      muted: {
        get: function() {
          return getMuted();
        },
        set: function( aValue ) {
          setMuted( self._util.isAttributeSet( aValue ) );
        }
      },

      error: {
        get: function() {
          return impl.error;
        }
      },

      buffered: {
        get: function () {
          var timeRanges = {
            start: function( index ) {
              if (index === 0) {
                return 0;
              }

              //throw fake DOMException/INDEX_SIZE_ERR
              throw "INDEX_SIZE_ERR: DOM Exception 1";
            },
            end: function( index ) {
              var duration;
              if (index === 0) {
                duration = getDuration();
                if (!duration) {
                  return 0;
                }

                return duration * player.getVideoLoadedFraction();
              }

              //throw fake DOMException/INDEX_SIZE_ERR
              throw "INDEX_SIZE_ERR: DOM Exception 1";
            }
          };

          Object.defineProperties( timeRanges, {
            length: {
              get: function() {
                return 1;
              }
            }
          });

          return timeRanges;
        }
      }
    });

    self._util.getPlaybackQuality = function() {
      return playerReady && player.getPlaybackQuality() || impl.quality || 'default';
    };

    self._util.setPlaybackQuality = function( quality ) {
      impl.quality = quality;

      if( !playerReady ) {
        addMetadataReadyCallback( function() {
          player.setPlaybackQuality( impl.quality );
        });
        return;
      }

      player.setPlaybackQuality( quality );
    };

    self._util.getAvailableQualityLevels = function() {
      return playerReady && player.getAvailableQualityLevels() || [];
    };

    existingPlayer = findExistingPlayer( parent );
    if ( existingPlayer ) {
      changeSrc( existingPlayer );
    }

  }

  HTMLYouTubeVideoElement.prototype = new Popcorn._MediaElementProto();
  HTMLYouTubeVideoElement.prototype.constructor = HTMLYouTubeVideoElement;

  // Helper for identifying URLs we know how to play.
  HTMLYouTubeVideoElement.prototype._canPlaySrc = function( url ) {
    return ( findExistingPlayer( url ) || (/(?:http:\/\/www\.|http:\/\/|www\.|\.|^)(youtu)/).test( url ) ) ?
      "probably" :
      EMPTY_STRING;
  };

  // We'll attempt to support a mime type of video/x-youtube
  HTMLYouTubeVideoElement.prototype.canPlayType = function( type ) {
    return type === "video/x-youtube" ? "probably" : EMPTY_STRING;
  };

  Popcorn.HTMLYouTubeVideoElement = function( id ) {
    return new HTMLYouTubeVideoElement( id );
  };
  Popcorn.HTMLYouTubeVideoElement._canPlaySrc = HTMLYouTubeVideoElement.prototype._canPlaySrc;

}( Popcorn, window, document ));
