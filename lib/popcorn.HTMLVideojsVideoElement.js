(function ( window, Popcorn, undefined ) {
  "use strict";

  var

  document = window.document,

  EMPTY_STRING = "",

  // YouTube suggests 200x200
  // as minimum, video spec says 300x150.
  MIN_WIDTH = 300,
  MIN_HEIGHT = 200,
  apiScriptElement,
  apiCSS,
  apiReadyCallbacks = [],
  _V_ = window._V_ || window.VideoJS,

  htmlMode,

  validVideoTypes = {
    "mp4": {
      "type": "video/mp4"
    },
    "ogv": {
      "type": "video/ogg"
    },
    "webm": {
      "type": "video/webm"
    },
    "m4v": {
      "type": "videp/m4v"
    },
    "x-videojs": {
      "type": "video/x-videojs"
    },
    "flv": {
      "type": "video/flv"
    }
  },
  flashVideoTypes = {
    "video/flv": "FLV",
    "video/x-flv": "FLV",
    "video/mp4": "MP4",
    "video/m4v": "MP4"
  },
  readyStates = [
    //HAVE_NOTHING = 0
    [ "loadstart" ],

    //HAVE_METADATA = 1
    [ "durationchange", "loadedmetadata" ],

    //HAVE_CURRENT_DATA = 2
    [ "loadeddata" ],

    //HAVE_FUTURE_DATA = 3
    [ "loadeddata", "canplay" ],

    //HAVE_ENOUGH_DATA = 4
    [ "canplaythrough" ]
  ];

  function apiReadyPromise( fn ) {
    // VideoJS doesn't notify us when the script has loaded so we have to do poll
    // and check for existance of _V_ on the window
    function checkAPIReady() {
      if ( window._V_ ) {
        _V_ = window._V_;
        while ( apiReadyCallbacks.length ) {
          ( apiReadyCallbacks.shift() )();
        }
        return;
      }
      setTimeout( checkAPIReady, 10 );
    }

    if ( window._V_ ) {
      fn();
      return;
    }

    if ( !apiScriptElement ) {
      // Insert the VideoJS script and wait for it to fire the callback
      apiScriptElement = document.createElement( "script" );
      apiScriptElement.async = true;
      apiScriptElement.src = (document.location.protocol === 'file:' ? 'http:' : document.location.protocol) + "//vjs.zencdn.net/c/video.js";

      apiCSS = document.createElement( "link" );
      apiCSS.type = "text/css";
      apiCSS.rel = "stylesheet";
      apiCSS.href = ( document.location.protocol === "file:" ? "http:" : document.location.protocol ) + "//vjs.zencdn.net/c/video-js.css";

      document.head.appendChild( apiCSS );
      document.head.appendChild( apiScriptElement );
    }

    if ( !apiReadyCallbacks.length ) {
      setTimeout( checkAPIReady, 10 );
    }
    apiReadyCallbacks.push(fn);
  }

  function findExistingVideoJSPlayer( obj ) {
    var id, byName, player;

    if ( !_V_ || !obj || !_V_.players ) {
      return false;
    }

    byName = typeof obj === 'string';
    id = byName ? obj : obj.id;

    player = _V_.players[ id ];
    if ( player && ( byName || obj === player ) ) {
      return player;
    }

    if ( typeof obj !== 'object' || typeof obj.techGet !== 'function' ) {
      return false;
    }

    for ( id in _V_.players ) {
      if ( _V_.players.hasOwnProperty( id ) && _V_.players[ id ] === obj ) {
        return _V_.players[ id ];
      }
    }
    return false;
  }

  function HTMLVideojsVideoElement( id ) {

    var self = this,
      parent = typeof id === "string" ? Popcorn.dom.find( id ) : id,
      elem,
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
        volume: 1,
        muted: 0,
        currentTime: 0,
        duration: NaN,
        ended: false,
        paused: true,
        width: parent.width|0   ? parent.width  : MIN_WIDTH,
        height: parent.height|0 ? parent.height : MIN_HEIGHT,
        error: null,
        progressAmount: null
      },
      maxReadyState = 0,
      existingPlayer,
      playEventPending = false,
      playingEventPending = false,
      playerReady = false,
      player,
      playerReadyCallbacks = [],
      stalledTimeout,
      eventCallbacks = {};

    function playerReadyPromise( fn, unique ) {
      var i;
      if ( playerReady ) {
        fn();
        return;
      }

      if ( unique ) {
        i = playerReadyCallbacks.indexOf( fn );
        if (i >= 0) {
          playerReadyCallbacks.splice( i, 1 );
        }
      }
      playerReadyCallbacks.push( fn );
    }

    function dispatchEvent( event ) {
      //fire all events asynch
      setTimeout( function () {
        self.dispatchEvent( event );
      }, 0 );
    }

    function registerEventListener( name, src, dest ) {
      var callback;

      //no duplicates, just in case
      callback = eventCallbacks[ name ];
      if ( callback ) {
        player.removeEvent( name, callback );
      }

      if ( typeof src === 'string' ) {
        callback = function() {
          var val;
          if ( player ) {
            val = player[ dest || src ];
            if ( impl[ src ] !== val ) {
              impl[ src ] = val;
              dispatchEvent( name );
            }
          }
        };
      } else if ( typeof src === 'function' ) {
        callback = function ( evt ) {
          if ( player && src.apply( this, evt ) ) {
            dispatchEvent( name );
          }
        };
      } else {
        callback = function () {
          if ( player ) {
            dispatchEvent( name );
          }
        };
      }

      eventCallbacks[ name ] = callback;
      player.addEvent( name, callback );
    }

    function removeEventListeners() {
      Popcorn.forEach( eventCallbacks, function ( name, callback ) {
        player.removeEvent( name, callback );
      } );
    }

    function setReadyState( state ) {
      var i, queue;

      if ( state <= impl.readyState ) {
        return;
      }

      maxReadyState = Math.max( maxReadyState, state );
      if ( state - impl.readyState > 1 ) {
        return;
      }

      impl.readyState++;
      queue = readyStates[ impl.readyState ];
      for ( i = 0; i < queue.length; i++ ) {
        dispatchEvent( queue[ i ] );
      }
      setReadyState( maxReadyState );
    }

    function destroyPlayer() {

      clearTimeout( stalledTimeout );

      if( !player ) {
        return;
      }

      removeEventListeners();

      if ( !existingPlayer ) {
        player.pause();

        if ( player.techName === "html5" ) {
          player.tech.el.src = "";
          player.tech.el.load();
        }

        try {
          player.destroy();
        } catch (e) {}

        if ( elem && elem.parentNode === parent ) {
          parent.removeChild( elem );
        }
      }

      existingPlayer = null;
      player = null;
      parent = null;
      playerReady = false;
      elem = null;
    }

    function onDurationChange() {
      var duration = player.duration();

      if ( !duration || duration === impl.duration ) {
        return;
      }

      impl.duration = player.duration();
      if ( impl.readyState < self.HAVE_METADATA ) {
        setReadyState( self.HAVE_METADATA );
      } else {
        dispatchEvent( "durationchange" );
      }

      if ( playEventPending ) {
        dispatchEvent( "play" );
      }

      if ( playingEventPending ) {
        playingEventPending = false;
        dispatchEvent( "playing" );
      }

      if ( playEventPending ) {
        playEventPending = false;
        if ( impl.paused ) {
          dispatchEvent( "pause" );
        }
      }
    }

    function onStalled() {
      if ( !impl.duration || impl.progressAmount < impl.duration ) {
          impl.networkState = self.NETWORK_IDLE;
          dispatchEvent( "stalled" );
      } else {
        monitorStalled();
      }
    }

    function monitorStalled() {
      // if progress doesn't happen for 3 seconds, fire "stalled" event

      clearTimeout( stalledTimeout );
      stalledTimeout = setTimeout( onStalled, 3000 );
    }

    function updateWidth() {
      player.width( impl.width );
      player.tech.el.width = impl.width;
    }

    function updateHeight() {
      player.height( impl.height );
      player.tech.el.height = impl.height;
    }

    function changeSrc( aSrc ) {

      if ( aSrc === player ) {
        return;
      }

      // http://www.whatwg.org/specs/web-apps/current-work/multipage/the-video-element.html#media-element-load-algorithm

      destroyPlayer();

      impl.readyState = -1;
      maxReadyState = -1;
      playEventPending = false;
      playingEventPending = false;

      if ( impl.networkState !== self.NETWORK_EMPTY ) {
        if ( impl.networkState === self.NETWORK_LOADING || impl.networkState === self.NETWORK_IDLE ) {
          dispatchEvent( "abort" );
        }
        dispatchEvent( "emptied" );
      }

      if ( !impl.paused ) {
        if ( playerReady ) {
          player.pause();
        }
        impl.paused = false;
      }

      impl.seeking = false;

      impl.duration = NaN;

      if ( impl.currentTime ) {
        impl.currentTime = 0;
        dispatchEvent( "timeupdate" );
      }

      impl.error = null;

      // technically, an empty src should fire MEDIA_ERR_SRC_NOT_SUPPORTED
      // but we allow it for now as a way to clean up the player
      if ( !aSrc ) {
        impl.readyState = self.HAVE_NOTHING;
        return;
      }

      // begin "resource fetch algorithm", set networkState to NETWORK_IDLE and fire "suspend" event

      if ( existingPlayer ) {
        aSrc = impl.src = existingPlayer.currentSrc();
      } else {
        impl.src = aSrc;
      }

      impl.networkState = self.NETWORK_LOADING;
      setReadyState( self.HAVE_NOTHING );

      apiReadyPromise( function() {
        if ( !impl.src ) {
          if ( player ) {
            destroyPlayer();
          }
        }

        player = existingPlayer;

        if ( !player && !self._canPlaySrc( aSrc ) ) {
          impl.error = {
            name: "MediaError",
            message: "Media Source Not Supported",
            code: window.MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          };
          impl.networkState = self.NETWORK_NO_SRC;
          dispatchEvent( "error" );
          return;
        }

        if ( !player ) {
          if ( elem ) {
            player = _V_( elem );
          } else {
            elem = document.createElement( "video" );
            parent.appendChild( elem );

            player = _V_( elem, {
              width: impl.width,
              height: impl.height,
              loop: impl.loop,
              preload: impl.preload,
              autoplay: impl.autoplay,
              controls: impl.controls
            } );
            player.ready(function() {
              player.src( impl.src );
            } );
          }
        }

        player.ready(function() {
          playerReady = true;

          while ( playerReadyCallbacks.length ) {
            ( playerReadyCallbacks.shift() )();
          }
        });

        playerReadyPromise( function () {
          // set up event listeners
          registerEventListener( "error" );

          monitorStalled();

          registerEventListener( "progress", function () {
            if ( !impl.duration && player.duration() ) {
              onDurationChange();
            }

            impl.progressAmount = player.buffered().end();
            impl.progressAmount = Math.max( impl.progressAmount, player.currentTime() );

            setReadyState( self.HAVE_CURRENT_DATA );

            if ( impl.progressAmount >= impl.duration ) {
              impl.networkState = self.NETWORK_IDLE;
              setReadyState( self.HAVE_CURRENT_DATA );
              setReadyState( self.HAVE_FUTURE_DATA );
              setReadyState( self.HAVE_ENOUGH_DATA );
            } else {
              impl.networkState = self.NETWORK_LOADING;
              monitorStalled();
            }
            return true;
          } );

          registerEventListener( "stalled", onStalled );

          registerEventListener( "waiting" );
          registerEventListener( "ratechange" );
          registerEventListener( "abort" );

          registerEventListener( "timeupdate", "currentTime" );
          registerEventListener( "durationchange", onDurationChange );
          registerEventListener( "loadedmetadata", onDurationChange );

          registerEventListener( "volumechange", function() {
            var volume = player.volume(),
              muted = player.muted();

            if ( impl.volume !== volume || impl.muted !== muted ) {
              impl.volume = volume;
              impl.muted = muted;
              return true;
            }
          } );

          registerEventListener( "canplay", function () {
            if ( !impl.duration && player.duration() ) {
              onDurationChange();
            }

            setReadyState( self.HAVE_CURRENT_DATA );
            setReadyState( self.HAVE_FUTURE_DATA );
          } );

          registerEventListener( "canplaythrough", function () {
            setReadyState( self.HAVE_ENOUGH_DATA );
          } );

          registerEventListener( "play", function () {
            if ( impl.paused ) {
              impl.paused = false;
              if ( !impl.duration) {
                playEventPending = true;
              } else {
                return true;
              }
            }
          } );

          registerEventListener( "seeking" , function () {
            impl.seeking = true;
            return true;
          } );

          registerEventListener( "seeked" , function () {
            if ( impl.seeking ) {
              impl.seeking = false;
              return true;
            }
          } );

          registerEventListener( "playing", function () {
            if ( !impl.duration && player.duration() ) {
              onDurationChange();
            }

            if ( !impl.duration ) {
              playingEventPending = true;
              return false;
            }
            setReadyState( self.HAVE_CURRENT_DATA );
            setReadyState( self.HAVE_FUTURE_DATA );

            if ( impl.seeking ) {
              impl.seeking = false;
              dispatchEvent( "seeked" );
            }

            return true;
          } );

          registerEventListener( "pause", function () {
            if ( !impl.paused ) {
              //if ( impl.loop && player.currentTime >= impl.duration ) {
              //  return false;
              //}
              impl.paused = true;
              return !!impl.duration;
            }
          } );

          registerEventListener( "ended", function () {
            impl.ended = true;
            return true;
          });
        });
      }, true );
    }

    function setVolume() {
      player.volume( impl.muted > 0 ? 0 : impl.volume );
    }

    function getVolume() {
      // If we're muted, the volume is cached on impl.muted.
      return impl.muted > 0 ? impl.muted : impl.volume;
    }

    function setMuted() {
      player.muted( impl.muted );
      setVolume();
    }

    function getMuted() {
      return impl.muted > 0;
    }

    function setCurrentTime() {
      player.currentTime( impl.currentTime );
    }

    // Namespace all events we'll produce
    self._eventNamespace = Popcorn.guid( "HTMLVideojsVideoElement::" );

    self.parentNode = parent;

    self._util = Popcorn.extend( {}, self._util );

    // Mark type as Videojs
    self._util.type = "Videojs";

    self._util.destroy = function () {
      destroyPlayer();
    };

    self.play = function () {
      function play() {
        player.play();
      }

      playerReadyPromise(play, true);
    };

    self.pause = function () {
      function pause() {
        player.pause();
      }

      playerReadyPromise(pause, true);
    };

    self.load = function () {
      changeSrc( impl.src );
    };

    Object.defineProperties( self, {

      src: {
        get: function() {
          return impl.src;
        },
        set: function( aSrc ) {
          if ( aSrc !== impl.src ) {
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

      controls: {
        get: function() {
          return impl.controls;
        },
        set: function( aValue ) {
          impl.controls = self._util.isAttributeSet( aValue );
        }
      },

      width: {
        get: function() {
          return elem && elem.width || impl.width;
        },
        set: function( aValue ) {
          impl.width = aValue;
          playerReadyPromise( updateWidth );
        }
      },

      videoHeight: {
        get: function() {
          if ( player ) {
            if ( player.techName === "html5" && player.tech.el ) {
              return player.tech.el.videoHeight;
            }
            return player.techGet && player.techGet( "videoHeight" ) || 0;
          }
          return 0;
        }
      },

      videoWidth: {
        get: function() {
          if ( player ) {
            if ( player.techName === "html5" && player.tech.el ) {
              return player.tech.el.videoWidth;
            }
            return player.techGet && player.techGet( "videoWidth" ) || 0;
          }
          return 0;
        }
      },

      height: {
        get: function() {
          return elem && elem.height || impl.height;
        },
        set: function( aValue ) {
          impl.height = aValue;
          playerReadyPromise( updateHeight );
        }
      },

      currentTime: {
        get: function() {
          return player && player.currentTime() || 0;
        },
        set: function( aValue ) {
          aValue = parseFloat( aValue );
          /*
          if( !impl.duration || aValue < 0 || impl.duration > 1 || isNaN( aValue ) ) {
            throw "Invalid currentTime";
          }
          */

          impl.currentTime = aValue;
          playerReadyPromise( setCurrentTime, true );
        }
      },

      currentSrc: {
        get: function() {
          return impl.src;
        }
      },

      duration: {
        get: function() {
          return impl.duration;
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
          return getVolume();
        },
        set: function( aValue ) {
          aValue = parseFloat( aValue );
          if( aValue < 0 || aValue > 1 || isNaN( aValue ) ) {
            throw "Volume value must be between 0.0 and 1.0";
          }

          impl.volume = aValue;
          playerReadyPromise( setVolume, true );
        }
      },

      muted: {
        get: function() {
          return getMuted();
        },
        set: function( aValue ) {
          impl.muted = self._util.isAttributeSet( aValue ) && 1 || 0;
          playerReadyPromise( setMuted, true );
        }
      },

      error: {
        get: function() {
          return impl.error;
        }
      }
    } );

    existingPlayer = findExistingVideoJSPlayer( parent );
    if ( existingPlayer ) {
      elem = existingPlayer.el;
      parent = elem;
      changeSrc( existingPlayer );
    } else if ( parent && parent.nodeName === "VIDEO" ) {
      elem = parent;
      if ( elem.src ) {
        impl.src = elem.src;
      } else if ( elem.firstChild && elem.firstChild.nodeName === "SOURCE" ) {
        impl.src = [];
        Popcorn.forEach( elem.childNodes, function ( node ) {
          if ( node.nodeName === "SOURCE" ) {
            impl.src.push({
              src: node.getAttribute('src'),
              type: node.getAttribute('type')
            });
          }
        } );
      }
      changeSrc( impl.src );
    }
  }

  HTMLVideojsVideoElement.prototype = new Popcorn._MediaElementProto();
  HTMLVideojsVideoElement.prototype.constructor = HTMLVideojsVideoElement;

  // Helper for identifying URLs we know how to play.
  HTMLVideojsVideoElement.prototype._canPlaySrc = function( source ) {
    var extensionIdx,
        extension,
        result,
        i,
        l;

    // url can be array or obj, make lookup table
    if ( Array.isArray( source ) ) {
      for ( i = 0, l = source.length; i < l; i++ ) {
        result = HTMLVideojsVideoElement.prototype._canPlaySrc( source[ i ] );
        if ( result ) {
          return result;
        }
      }
      return result;
    }

    if ( typeof source === "object" ) {
      if ( source.type ) {
        result = HTMLVideojsVideoElement.prototype.canPlayType( source.type ) ? "probably" : EMPTY_STRING;
        if ( result ) {
          return result;
        }
      }
      source = source.url || "";
    }

    if ( typeof source === "string" ) {
      extensionIdx = source.lastIndexOf( "." );
      extension = validVideoTypes[ source.substr( extensionIdx + 1, source.length - extensionIdx ) ];

      if ( !extension ) {
        return EMPTY_STRING;
      }

      return HTMLVideojsVideoElement.prototype.canPlayType( extension.type );
    }
  };

  // We'll attempt to support a mime type of video/x-videojs
  HTMLVideojsVideoElement.prototype.canPlayType = function( type ) {
    function hasFlash() {
      //VideoJS requires at least Flash version 10
      var version = "0,0,0";
      try {
        version = new ActiveXObject( "ShockwaveFlash.ShockwaveFlash" ).GetVariable( "$version" ).replace( /\D+/g, "," ).match( /^,?(.+),?$/ )[ 1 ];
      } catch (e1) {
        try {
          if ( navigator.mimeTypes[ "application/x-shockwave-flash" ].enabledPlugin ) {
            version = ( navigator.plugins[ "Shockwave Flash 2.0" ] || navigator.plugins[ "Shockwave Flash" ]).description.replace( /\D+/g, "," ).match( /^,?(.+),?$/ )[ 1 ];
          }
        } catch (e2) {
        }
      }
      return parseFloat( version.split( "," )[ 0 ] ) >= 10;
    }

    function checkVideoJsSupport( mimeType ) {
      var techOrder = _V_.options.techOrder,
        tech, techName, i;

      for ( i = 0; i < techOrder.length; i++ ) {
        techName = techOrder[ i ];
        tech = _V_[ techName ];
        if ( tech.isSupported() && tech.canPlaySource( {
          type: mimeType
        } ) ) {
          return "probably";
        }
      }
      return EMPTY_STRING;
    }

    var testVideo;

    if ( type === "video/x-videojs" ) {
      return "probably";
    }

    //if VideoJS is loaded, use it to determine play capabilities. Otherwise, check HTML5 and Flash
    if ( _V_ ) {
      return checkVideoJsSupport( type );
    }

    testVideo = document.createElement( "video" );

    if ( testVideo.canPlayType( type ) ) {
      return "probably";
    }

    return flashVideoTypes.hasOwnProperty( type ) ? "probably" : EMPTY_STRING;
  };

  Popcorn.HTMLVideojsVideoElement = function( id ) {
    return new HTMLVideojsVideoElement( id );
  };
  Popcorn.HTMLVideojsVideoElement._canPlaySrc = HTMLVideojsVideoElement.prototype._canPlaySrc;

}( this, this.Popcorn ));
/*
## readyState reference ##

impl.duration > 0
- readyState: HAVE_METADATA
  - durationchange
  - loadedmetadata

first progress event
- readyState: HAVE_CURRENT_DATA
  - loadeddata

canplay event (or playing)
- readyState: HAVE_FUTURE_DATA
  - loadeddata
  - canplay

canplaythrough or progressAmount >= duration
- readyState: HAVE_ENOUGH_DATA
  - canplaythrough
*/
