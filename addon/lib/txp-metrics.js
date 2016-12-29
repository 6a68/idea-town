// todo: extract to npm :-)

// goal: existing addons can just drop this in and not change their packet format.
// should work for webextensions, sdk, and restartless addons.
//
// const metrics = new Metrics({id: '@min-vid'}); // experiment without GA
// const metrics = new Metrics({id: '@min-vid', tid: xxx, cid: xxx}); // SDK experiment with GA
// 
// // this shorthand is nicer, if you just want to send events. might be good to have the full
// // metrics object while debugging, to verify its state.
// const { sendEvent } = new Metrics({id: 'testpilot@mozilla', tid: xxx, cid: xxx, topic: 'testpilot'}); // testpilot itself
//
// usage:
//
// sendEvent({id: 
//
//
//
// TODO: why not just use ES6 modules?

// TODO: remember to add this to package.json
const pingCentre = require('ping-centre');

// Abstract the sendBeacon DOM API, since sketchy hidden window magic is
// needed to get the reference, if the addon is not a WebExtension.
let _sendBeacon;

// config object:
//   tid: GA tid. required to use GA.
//   cid: GA cid. required to use GA.
//   id: we need the addon's ID (like '@min-vid'). better to get it once, here.
//   topic: (optional) 'testpilottest' by default. No experiment needs to change this value.
//   It's only modified by the Test Pilot addon.
//   debug: (optional) false by default; if true, logs to console. This value
//   can be updated after the object is instantiated.
function Metrics(opts) {
  // The console must be initialized first, since other init steps log to
  // console in debug mode.
  this._initConsole();
  this._initValues(opts);
  this._initTransport();
}

// o is an object with some stuff:
//   o.data = the actual packet
//   o.id = the id of the addon, like '@foo' or 'foo@bar'.
Metrics.prototype = {

  /* public API */

  // The sendEvent method forwards pings to Google Analytics, if configured.
  // It also tries to send pings to Telemetry and Ping Centre, discarding
  // any errors encountered. These endpoints will generally only work while the
  // add-on is an active Test Pilot experiment.
  //
  // Parameters:
  // * `event`: What is happening?  eg. `click`
  // * `object`: What is being affected?  eg. `home-button-1`
  // * `category` (optional): If you want to add a category for easy reporting
  //   later. eg. `mainmenu`
  //
  // The final two parameters are optional, and are used together to capture
  // information about multivariate or A/B tests that an experiment might be
  // running.
  //
  // * `study` (optional): String ID for a given test, eg. `button-test`. Note
  //   that Google Analytics truncates this field past a 40 byte limit, or, 40
  //   ascii characters encoded as UTF-8. Note that the string is trimmed, and
  //   adjacent whitespace chars are converted to single spaces, before bytes
  //   are counted. This library will log a message (visible in debug mode) if
  //   the `study` field is too long.
  // * `variant` (optional): An identifying string if you're running different
  //   variants. eg. `red-button` or `green-button`.
  sendEvent: (event, object, category, study, variant) => { // TODO: will this arrow func preserve `this`? or do we need to bind in the ctor?
    if (!event) {
      throw new Error(`event field must be passed to sendEvent`);
    }
    if (!object) {
      throw new Error(`object field must be passed to sendEvent`);
    }

    if (this.tid && this.cid) {
      this._sendGA(event, object, category, study, variant);
    }

    // Construct and serialize the payload sent to telemetry.
    const data = {
      event: event,
      object: object
    };
    if (category) {
      data.category = category;
    }
    if (study) {
      data.study = study;
      data.variant = variant;
    }
    let msg;
    try {
      msg = JSON.stringify(data);
    } catch(ex) {
      throw new Error(`Unable to serialize metrics event: ${ex}`);
    }
    this._sendTelemetry(msg);
    this._sendPingCentre(msg);
  },

  /* private API */

  // Ensure console is present. Only required for bootstrapped addons.
  _initConsole: function() {
    try {
      Components.utils.import('resource://gre/modules/Services.jsm');
    } catch (ex) {} // Ignore the error for SDK or WebExtensions.
  },
  // Ensure required parameters are present and assign them.
  _initValues: function(opts) {
    const {id, tid, cid, topic, debug} = opts;

    this.debug = !!debug;
    this._log(`_initValues: debug set to true; verbose debug logging enabled.`);

    if (!id) {
      throw new Error('id is required.');
    } 
    this.id = id;
    this._log(`_initValues: Initialized this.id to ${id}.`);

    if (tid && !cid) {
      throw new Error('Both tid and cid are required for Google Analytics to work. cid not provided.');
    } else if (!tid && cid) {
      throw new Error('Both tid and cid are required for Google Analytics to work. tid not provided.');
    }
    this._log(`_initValues: Initialized this.tid to ${tid} and this.cid to ${cid}.`);
    this.tid = tid;
    this.cid = cid;

    // Experiment authors should just use the default 'testpilottest' topic.
    // `topic` is only configurable so that the Test Pilot addon can submit its
    // own pings using this same library.
    this.topic = topic || 'testpilottest';
    this._log(`_initValues: Initialized this.topic to ${topic || 'testpilottest'}.`);
  },
  // Load transports needed for Telemetry and GA submissions, and infer the
  // addon's type.
  _initTransports: function() {
    // The Telemetry transport is either the BroadcastChannel DOM API (for 
    // WebExtensions), or the nsIObserverService (for SDK and bootstrapped
    // addons).
    //
    // The GA transport is the navigator.sendBeacon DOM API. In the case of 
    // SDK and bootstrapped addons, there might not be a DOM window yet, so get
    // the reference from the hidden window. 
    //
    // The ping-centre transport is provided by the ping-centre library, so
    // we don't really need to do anything here.
    try {
      // First, try the SDK approach.
      const { Cu } = require('chrome');
      Cu.import('resource://gre/modules/Services.jsm');
      _sendBeacon = Services.appShell.hiddenDOMWindow.navigator.sendBeacon;
      this.type = 'sdk';
      this._log('Initialized SDK addon transports.');
    } catch(ex) {
      // Next, try the bootstrapped approach.
      try {
        Components.utils.import('resource://gre/modules/Services.jsm');
        _sendBeacon = Services.appShell.hiddenDOMWindow.navigator.sendBeacon;
        this.type = 'bootstrapped';
        this._log('Initialized bootstrapped addon transports.');
      } catch(ex) {
        // Finally, try the WebExtension approach.
        try {
          this._channel = new BroadcastChannel(this.topic);
          _sendBeacon = navigator.sendBeacon; // TODO: will this always be visible to webextensions?
          this.type = 'webextension';
          this._log('Initialized WebExtension addon transports.');
        } catch (ex) {
          // If all three approaches fail, give up.
          throw new Error('Unable to initialize transports: ', ex);
        }
      }
    }
  },
  // Log to console if `this.debug` is true.
  // Note that `this.debug` can be dynamically changed, for instance, set to
  // true while the debugger is paused, and it'll work properly.
  _log: function(str) {
    if (this.debug) {
      console.log(str);
    }
  },
  // Send a ping to Telemetry.
  _sendTelemetry: function(msg) {
    if (this.type === 'webextension') {
      try {
        this._channel.postMessage(msg); // TODO: is msg the right format?
      } catch (ex) {
        this._log(`Failed to postMessage metrics event to Telemetry: ${ex}`);
      }
    } else { /* type is 'sdk' or 'bootstrapped' */
      const subject = {
        wrappedJSObject: {
          observersModuleSubjectWrapper: true,
          object: this.id
        }
      };
      // Services should have been loaded by _initTransport().
      try {
        Services.obs.notifyObservers(subject, 'testpilot::send-metric', msg);
      } catch (ex) {
        this._log(`Failed to notify observers of Telemetry metrics event: ${ex}`);
      }
    }
  },
  // Send a ping to Google Analytics.
  _sendGA: function(event, object, category, study, variant) {
    if (!this.tid && !this.cid) {
      return this._log(`Unable to send metrics event to GA, because tid and cid are missing.`);
    } else if (!this.tid) {
      return this._log(`Unable to send metrics event to GA, because tid is missing.`);
    } else if (!this.cid) {
      return this._log(`Unable to send metrics event to GA, because cid is missing.`);
    }

    if ((study && !variant) || (!study && variant)) {
      this._log(`Warning: 'study' and 'variant' must both be present to be recorded by Google Analytics.`);
    }

    // TODO: I think we need the hidden window again, to get FormData from bootstrapped / sdk.
    const data = new _FormData();

    // For field descriptions, see https://developers.google.com/analytics/devguides/collection/protocol/v1/ 
    data.append('v', 1);
    data.append('tid', this.tid);
    data.append('cid', this.cid);
    data.append('t', 'event');
    data.append('ec', category || 'add-on Interactions'); // TODO: should we not default ec to 'add-on Interactions'?
    data.append('ea', object);
    data.append('el', event);

    // Send the optional multivariate testing info, if it was included.
    if (study && variant) {
      this._checkStudyLength(study);
      data.append('xid', study);
      data.append('xval', variant);
    }

    _sendBeacon('https://ssl.google-analytics.com/collect', data);
  },
  // If the study name is too long, GA will truncate it. Count bytes and log a
  // warning if the name exceeds 40 bytes.
  _checkStudyLength: function(str) {
    // GA preprocesses text fields by removing leading / trailing whitespace,
    // and converting adjacent whitespace chars to single spaces[1], then
    // counts up 40 bytes[2], truncating the xid past that limit.
    // [1] https://developers.google.com/analytics/devguides/collection/protocol/v1/reference#text
    // [2] https://developers.google.com/analytics/devguides/collection/protocol/v1/parameters#xid
    const processed = encodeURIComponent(str).trim().replace(/\s{2,}/, ' ');
    // TODO: is TextEncoder always available in add-ons?
    // I think so: https://dxr.mozilla.org/mozilla-central/source/toolkit/components/extensions/Extension.jsm#24
    const length = (new TextEncoder('utf-8').encode(encodeURI(processed))).length;
    if (length > 40) {
      this._log(`Warning: study name '${processed}' is longer than 40 bytes and will be truncated by Google Analytics.`);
    }
  }

};

function ga(o) {
  // TODO: do webextensions have fetch()?
  // TODO: I think the hidden window will work to get fetch otherwise.
}
