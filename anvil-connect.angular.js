'use strict';

angular.module('anvil', [])


  .provider('Anvil', function AnvilProvider () {

    /**
     * Private state
     */

    var issuer, pubkey, params, display, session = {};


    /**
     * Provider configuration
     */

    this.configure = function (options) {
      this.issuer = issuer = options.issuer;
      this.pubkey = pubkey = options.pubkey;
      this.params = params = {};
      this.params.response_type = options.response_type || 'id_token token';
      this.params.client_id = options.client_id;
      this.params.redirect_uri = options.redirect_uri;
      this.params.scope = [
        'openid',
        'profile'
      ].concat(options.scope).join(' ');
      this.display = display = options.display || 'page';
    };


    /**
     * Factory
     */

    this.$get = [
      '$q',
      '$http',
      '$location',
      '$document',
      '$window', function ($q, $http, $location, $document, $window) {


      /**
       * Service
       */

      var Anvil = {};


      /**
       * Form Urlencode an object
       */

      function toFormUrlEncoded (obj) {
        var pairs = [];

        Object.keys(obj).forEach(function (key) {
          pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(obj[key]));
        });

        return pairs.join('&');
      }

      Anvil.toFormUrlEncoded = toFormUrlEncoded;


      /**
       * Parse Form Urlencoded data
       */

      function parseFormUrlEncoded (str) {
        var obj = {};

        str.split('&').forEach(function (property) {
          var pair = property.split('=')
            , key  = decodeURIComponent(pair[0])
            , val  = decodeURIComponent(pair[1])
            ;

          obj[key] = val;
        });

        return obj;
      }

      Anvil.parseFormUrlEncoded = parseFormUrlEncoded;


      /**
       * Get URI Fragment
       */

      function getUrlFragment (url) {
        return url.split('#').pop();
      }

      Anvil.getUrlFragment = getUrlFragment;


      /**
       * Configure the authorize popup window
       * Adapted from dropbox-js for ngDropbox
       */

      function popup (popupWidth, popupHeight) {
        var x0, y0, width, height, popupLeft, popupTop;

        // Metrics for the current browser window.
        x0 = $window.screenX || $window.screenLeft
        y0 = $window.screenY || $window.screenTop
        width = $window.outerWidth || $document.documentElement.clientWidth
        height = $window.outerHeight || $document.documentElement.clientHeight

        // Computed popup window metrics.
        popupLeft = Math.round(x0) + (width - popupWidth) / 2
        popupTop = Math.round(y0) + (height - popupHeight) / 2.5
        if (popupLeft < x0) { popupLeft = x0 }
        if (popupTop < y0) { popupTop = y0 }

        return 'width=' + popupWidth + ',height=' + popupHeight + ',' +
               'left=' + popupLeft + ',top=' + popupTop + ',' +
               'dialog=yes,dependent=yes,scrollbars=yes,location=yes';
      }

      Anvil.popup = popup;


      /**
       * Session object
       */

      Anvil.session = session;


      /**
       * Serialize session
       */

      function serialize () {
        var now = new Date()
          , time = now.getTime()
          , exp = time + (Anvil.session.expires_in || 3600) * 1000
          , random = Math.random().toString(36).substr(2, 10)
          , secret = sjcl.codec.hex.fromBits(sjcl.hash.sha256.hash(random))
          ;

        now.setTime(exp);
        document.cookie = 'anvil.connect=' + secret
                        + '; expires=' + now.toUTCString();

        var encrypted = sjcl.encrypt(secret, JSON.stringify(Anvil.session));
        localStorage['anvil.connect'] = encrypted;
        console.log('SERIALIZED', encrypted);
      };

      Anvil.serialize = serialize;


      /**
       * Deserialize session
       */

      function deserialize () {
        var re, secret, json, parsed;

        try {
          // Use the cookie value to decrypt the session in localStorage
          re      = new RegExp('[; ]anvil.connect=([^\\s;]*)');
          secret  = document.cookie.match(re).pop();
          json    = sjcl.decrypt(secret, localStorage['anvil.connect']);
          parsed  = JSON.parse(json);

        } catch (e) {
          console.log('Cannot deserialize session data');
        }

        Anvil.session = session = parsed || {};
        console.log('DESERIALIZED', session);
      };

      Anvil.deserialize = deserialize;


      /**
       * Reset
       */

      function reset () {
        Anvil.session = session = {};
        document.cookie = 'anvil.connect=; expires=Thu, 01 Jan 1970 00:00:01 GMT;';
        delete localStorage['anvil.connect'];
        // what about signing out of the auth server?
      };

      Anvil.reset = reset;


      /**
       * Quick and dirty uri method with nonce
       */

      function uri (endpoint) {
        return issuer + '/'
             + (endpoint || 'authorize') + '?'
             + toFormUrlEncoded(angular.extend({}, params, {
                nonce: this.nonce()
               }));
      };

      Anvil.uri = uri;


      /**
       * Create or verify a nonce
       */

      function nonce (nonce) {
        if (nonce) {
          return (Anvil.sha256url(localStorage['nonce']) === nonce);
        } else {
          localStorage['nonce'] = Math.random().toString(36).substr(2, 10);
          return this.sha256url(localStorage['nonce']);
        }
      };

      Anvil.nonce = nonce;


      /**
       * Base64url encode a SHA256 hash of the input string
       */

      function sha256url (str) {
        return sjcl.codec.base64url.fromBits(sjcl.hash.sha256.hash(str));
      };

      Anvil.sha256url = sha256url;


      /**
       * Headers
       */

      function headers (headers) {
        if (this.session.access_token) {
          return angular.extend(headers || {}, {
            'Authorization': 'Bearer ' + this.session.access_token
          });
        } else {
          return headers;
        }
      };

      Anvil.headers = headers;


      /**
       * Request
       */

      function request (config) {
        var deferred = $q.defer();

        config.headers = this.headers(config.headers);

        function success (response) {
          deferred.resolve(response.data);
        }

        function failure (fault) {
          deferred.reject(fault);
          console.log(fault)
        }

        $http(config).then(success, failure);

        return deferred.promise;
      };

      Anvil.request = request;


      /**
       * UserInfo
       */

      function userInfo () {
        return this.request({
          method: 'GET',
          url: issuer + '/userinfo'
        });
      };

      Anvil.userInfo = userInfo;


      /**
       * Callback
       */

      function callback (response) {
        var deferred = $q.defer();

        if (response.error) {
          // clear localStorage/cookie/etc
          Anvil.reset()
          deferred.reject(response);
        }

        else {

          var accessJWS = new KJUR.jws.JWS();
          var idJWS = new KJUR.jws.JWS();

          try {
            accessJWS.verifyJWSByPemX509Cert(response.access_token, pubkey)
          } catch (e) {}

          try {
            response.access_claims = JSON.parse(accessJWS.parsedJWS.payloadS)
          } catch (e) {}

          try {
            idJWS.verifyJWSByPemX509Cert(response.id_token, pubkey)
          } catch (e) {}

          try {
            response.id_claims = JSON.parse(idJWS.parsedJWS.payloadS)
          } catch (e) {}

          // TODO:
          // - verify id token
          // - verify nonce
          // - verify access token (athash claim)

          Anvil.session = session = response;

          Anvil.userInfo().then(
            function userInfoSuccess (userInfo) {
              Anvil.session.userInfo = userInfo;
              Anvil.serialize();
              deferred.resolve(session);
            },

            function userInfoFailure () {
              deferred.reject('Retrieving user info from server failed.');
            }
          );
        }

        return deferred.promise;
      };

      Anvil.callback = callback;


      /**
       * Authorize
       */

      function authorize () {
        // handle the auth response
        if ($location.hash()) {
          return Anvil.callback(parseFormUrlEncoded($location.hash()));
        }

        // initiate the auth flow
        else {
          // open the signin page in a popup window
          if (display === 'popup') {
            var deferred = $q.defer();


            var listener = function listener (event) {
              var fragment = getUrlFragment(event.data);
              Anvil.callback(parseFormUrlEncoded(fragment)).then(
                  function (result) { deferred.resolve(result); },
                  function (fault) { deferred.reject(fault); }
              );
              $window.removeEventListener('message', listener, false);
            }


            $window.addEventListener('message', listener, false);
            $window.open(this.uri(), 'anvil', popup(700, 500));

            return deferred.promise;
          }

          // navigate the current window to the provider
          else {
            $window.location = this.uri();
          }
        }
      };

      Anvil.authorize = authorize;


      /**
       * Signout
       */

      function signout () {
        Anvil.reset()
        $window.location = issuer + '/signout?redirect_uri=' + $window.location.href;
      }

      Anvil.signout = signout;


      /**
       * Reinstate an existing session
       */

      Anvil.deserialize();


      /**
       * Service
       */

      return Anvil;

    }];
  })

