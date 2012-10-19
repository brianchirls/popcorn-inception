(function( Popcorn, document ) {

  "use strict";

  var pluginFn,
    incompatible = {},
    fallbacks = {},
    nullFallback,
    addEventListener, media;

  pluginFn = Popcorn.plugin;

  nullFallback = {
    start: function() {},
    end: function() {}
  };

  function getFallback(popcorn, name, options) {
    var fallback = ( popcorn.data.fallbacks && ( popcorn.data.fallbacks[ name ] || popcorn.data.fallbacks[ '' ] ) ) ||
      fallbacks[ name ] || fallbacks[ '' ] || nullFallback;
    if ( typeof fallback === "function" ) {
      fallback = fallback.call( popcorn, options );
    }
    return fallback;
  }

  Popcorn.plugin = function( name, definition, manifest ) {
    var newDefinition, testFn;

    testFn = ( manifest && manifest.incompatible ) || definition.incompatible;
    if ( typeof testFn === "function" ) {
      incompatible[ name ] = testFn();
      if ( !incompatible[ name ] ) {
        //everything is fine. proceed as normal
        newDefinition = definition;
      } else {
        newDefinition = function (options) {
          return getFallback(this, name, options);
        };
      }
    } else if ( typeof definition !== "function" ) {
      //This plugin knows no incompatible, so ignore and proceed as normal
      newDefinition = definition;
    } else {
      //incompatibility test is deferred. This is not ideal
      newDefinition = function (options) {
        var def = definition.call( this, options ),
          incomp;

        incomp = incompatible[name];

        if ( incomp === undefined && typeof def.incompatible === "function" ) {
          incomp = def.incompatible.call( this, options );
          incompatible[ name ] = incomp;
          if ( incomp && def._teardown ) {
            def._teardown.call( this, options );
          }
        }

        if ( !incomp ) {
          //everything is fine
          return def;
        }

        //this plugin is incompatible. return fallback
        return getFallback(this, name, options);
      };
    }

    pluginFn( name, newDefinition, manifest );

  };

  Popcorn.incompatible = function( hook ) {
    var elem;

    if ( hook ) {
      return incompatible[ hook ] || false;
    }

    if ( addEventListener === undefined ) {
      addEventListener = !document.addEventListener;
    }

    if ( addEventListener ) {
      return "Obsolete browser: No support for addEventListener";
    }

    //check for HTML5 video/audio support or some other wrapper support
    if ( media === undefined ) {
      media = false;
      if ( !Popcorn._MediaElementProto ) {
        elem = document.createElement('video');
        if (!elem || !elem.canPlayType) {
          media = true;
        }
      }
    }

    if ( media ) {
      return "Obsolete browser: No support for HTML5 video";
    }

    return false;

  };

  Popcorn.prototype.incompatible = function( hook ) {
    var failure, obj, i,
    events, evt, t,
    count = 0;

    failure = Popcorn.incompatible( hook );
    if ( failure || hook ) {
      return failure || false;
    }

    //test plugins
    obj = {};
    events = this.data.trackEvents.byStart;

    //todo: make this much more efficient
    for (i = 0; i < events.length && count < Popcorn.registry.length; i++) {
      evt = events[ i ];
      t = evt._natives && evt._natives.type;
      if ( t && obj[t] === undefined ) {
        obj[ t ] = Popcorn.incompatible( t );
        count++;
      }
    }

    return !!count && obj;
  };

  Popcorn.fallback = function ( hook, definition ) {
    if ( typeof hook === 'object' || typeof hook === 'function' ) {
      definition = hook;
      hook = '';
    }

    fallbacks[hook] = definition;
  };

  Popcorn.prototype.fallback = function( hook, definition ) {
    if ( !this.data.fallbacks ) {
      this.data.fallbacks = {
        '': nullFallback
      };
    }

    if ( typeof hook === 'object' || typeof hook === 'function' ) {
      definition = hook;
      hook = '';
    }

    this.data.fallbacks[hook] = definition;

  };

}( Popcorn, window.document ));
