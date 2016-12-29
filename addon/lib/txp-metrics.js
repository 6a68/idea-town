// todo: extract to npm :-)

// goal: existing addons can just drop this in and not change their packet format.
// should work for webextensions, sdk, and restartless addons.
// TODO: detect webextension vs sdk vs bootstrapped automatically.
//
// const metrics = new Metrics(); // experiment without GA
// const metrics = new Metrics({tid: xxx, cid: xxx, type: 'sdk'}); // SDK experiment with GA
// const metrics = new Metrics({tid: xxx, cid: xxx, type: 'sdk', topic: 'testpilot'}); // testpilot itself
//
//
//





// config object:
//   tid: GA tid. required to use GA.
//   cid: GA cid. required to use GA.
//   (optional) topic: 'testpilottest' by default
function Metrics({tid, cid, topic}) {
  if (tid && cid) {
    this.tid = tid || null;
    this.cid = cid || null;
  }

  // This is only configurable to cover Test Pilot's own pings. Experiment authors
  // should just use the default 'testpilottest' topic.
  this.topic = topic || 'testpilottest';

  // We'll need Services.jsm, unless we're in a webextension.
  // TODO: what if we just try/catch this for all addons? Then we can detect the type. See if this works...
  try {
    const { Cu } = require('chrome');
    Cu.import('resource://gre/modules/Services.jsm');
    this.type = 'sdk';
  } catch(ex) {
    // If require wasn't defined, try the bootstrapped approach:
    try {
      // Components should always be defined.
      Components.utils.import('resource://gre/modules/Services.jsm');
      this.type = 'bootstrapped';
    } catch(ex) {
      // If everything failed, it must be a webextension.
      this.type = 'webextension';
    }
  }
}

// o is an object with some stuff:
//   o.data = the actual packet
//   o.id = the id of the addon, like '@foo' or 'foo@bar'.
Metrics.prototype.send = function(o) { // TODO: what arguments?
  if (this.tid && this.cid) { ga(o); }
  telemetry(o);
  pingCentre(o);
}

// Just always fire the telemetry signal. Worst case, nothing is listening
// for the testpilot::send-metric signal.
function telemetry(o) {
  // TODO: assuming o.id exists and is the addon name.
  const id = o.id;
  // TODO: assuming o.data exists and is the actual packet.
  const data = o.data;


  if (this.type == 'sdk' || this.type == 'bootstrapped') {
    const subject = {
      wrappedJSObject: {
        observersModuleSubjectWrapper: true,
        object: id
      }
    };
    Services.obs.notifyObservers(subject, 'testpilot::send-metric',
                                 JSON.stringify(data)); // TODO: what's data?
  } else { // webextension
    // TODO: do we need a window passed in to get a BroadcastChannel ref?
    // based on the TxP example, I don't think so:
    // https://github.com/mozilla/testpilot/blob/master/docs/examples/webextension/background.js
    const txpChannel = new BroadcastChannel('testpilot-telemetry');
    // TODO: does the data object need to be transformed before sending over?
    txpChannel.postMessage(data);
  }
}

function ga(o) {
  // TODO: do webextensions have fetch()?
  // TODO: I think the hidden window will work to get fetch otherwise.
}
