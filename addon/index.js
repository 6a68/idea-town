/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the 'License'). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

const settings = {};

let currentPageMod;
let app;

// Canned selectable server environment configs
const SERVER_ENVIRONMENTS = {
  local: {
    BASE_URL: 'http://ideatown.dev:8000',
    IDEATOWN_PREFIX: 'ideatown.addon.LOCAL.',
    BADGE_COLOR: '#AA00AA'
  },
  development: {
    BASE_URL: 'http://idea-town-dev.elasticbeanstalk.com',
    IDEATOWN_PREFIX: 'ideatown.addon.DEVELOPMENT.',
    BADGE_COLOR: '#AAAA00'
  },
  stage: {
    BASE_URL: 'https://ideatown.stage.mozaws.net',
    IDEATOWN_PREFIX: 'ideatown.addon.STAGE.',
    BADGE_COLOR: '#A0AAA0'
  },
  production: {
    BASE_URL: 'https://ideatown.firefox.com',
    IDEATOWN_PREFIX: 'ideatown.addon.MAIN.',
    BADGE_COLOR: '#00AAAA'
  }
};

const store = require('sdk/simple-storage').storage;
const {Cc, Ci, Cu} = require('chrome');
Cu.import("resource://gre/modules/Services.jsm");
const self = require('sdk/self');
const tabs = require('sdk/tabs');
const {PageMod} = require('sdk/page-mod');
const {ActionButton} = require('sdk/ui/button/action');
const request = require('sdk/request').Request;
const AddonManager = Cu.import('resource://gre/modules/AddonManager.jsm').AddonManager;
const Prefs = Cu.import('resource://gre/modules/Preferences.jsm').Preferences;
const simplePrefs = require('sdk/simple-prefs');
const URL = require('sdk/url').URL;
const IdeaTown = require('idea-town');
const cookieManager2 = Cc['@mozilla.org/cookiemanager;1']
                       .getService(Ci.nsICookieManager2);
const pingServer = require('./lib/ping-server');

function updatePrefs() {
  // Select the environment, with production as a default.
  const envName = simplePrefs.prefs.SERVER_ENVIRONMENT;
  const env = (envName in SERVER_ENVIRONMENTS) ?
    SERVER_ENVIRONMENTS[envName] : SERVER_ENVIRONMENTS.production;

  // Update the settings from selected environment
  Object.assign(settings, {
    BASE_URL: env.BASE_URL,
    ALLOWED_ORIGINS: env.BASE_URL + '/*',
    HOSTNAME: URL(env.BASE_URL).hostname, // eslint-disable-line new-cap
    IDEATOWN_PREFIX: env.IDEATOWN_PREFIX
  });

  // Set up new PageMod, destroying any previously existing one.
  if (currentPageMod) { currentPageMod.destroy(); }
  currentPageMod = new PageMod({
    include: settings.ALLOWED_ORIGINS.split(','),
    contentScriptFile: self.data.url('message-bridge.js'),
    contentScriptWhen: 'start',
    attachTo: ['top', 'existing'],
    onAttach: setupApp
  });
}

// Listen for metrics events from experiments.
const metrics = {
  isInitialized: false,
  init: function() {
    if (this.isInitialized) {
      return;
    }
    this.isInitialized = true;
    // Note: the observer service holds a strong reference to this observer,
    // so we must detach it on shutdown / uninstall by calling destroy().
    Services.obs.addObserver(metrics, 'idea-town::send-metric', false);
  },
  destroy: function() {
    Services.obs.removeObserver(metrics, 'idea-town::send-metric', false);
    this.isInitialized = false;
  },
  // The metrics object format is { key, value, addonName }, where
  //   "key" is the name of the event,
  //   "value" is the value of the event (can be a complex object),
  //   "addonName" is the name of the experiment sending the data.
  observe: function() {
    // The nsIObserverService sends non-useful positional arguments; the third
    // is the only one we need
    const data = arguments[2];

    let d;
    try {
      d = JSON.parse(data);
    } catch (ex) {
      console.error('Idea Town metrics error: cannot process event, ' +
                    ' JSON.parse failed: ', ex);
      return;
    }
    if (d && 'key' in d && 'value' in d && 'addonName' in d) {
      pingServer(settings, d.key, d.value, d.addonName);
    } else {
      // TODO: verify this error message will be visible to experiments
      console.error('Idea Town metrics objects must have "key", "value", and' +
                    ' "addonName" properties. Object received was ', d);
    }
  }
};
metrics.init();

// Register handler to reconfigure on pref change, kick off initial setup
simplePrefs.on('SERVER_ENVIRONMENT', updatePrefs);
updatePrefs();

// update the our icon for devtools themes
Prefs.observe('devtools.theme', pref => {
  setActionButton(pref === 'dark');
});

setActionButton(Prefs.get('devtools.theme') === 'dark');

if (!store.clientUUID) {
  store.clientUUID = generateUUID();
}

function setActionButton(dark) {
  const iconPrefix = dark ? './icon-inverted' : './icon';

  ActionButton({ // eslint-disable-line new-cap
    id: 'idea-town-link',
    label: 'Idea Town',
    icon: {
      '16': iconPrefix + '-16.png',
      '32': iconPrefix + '-32.png',
      '64': iconPrefix + '-64.png'
    },
    onClick: function() {
      tabs.open({ url: settings.BASE_URL });
    }
  });
}

function setupApp() {
  updateExperiments().then(() => {
    app = new Router(currentPageMod);

    app.on('install-experiment', installExperiment);

    app.on('uninstall-experiment', uninstallExperiment);

    app.on('uninstall-all', function() {
      for (let id of store.installedAddons) { // eslint-disable-line prefer-const
        uninstallExperiment({addon_id: id});
      }
    });

    app.on('sync-installed', serverInstalled => {
      syncAllAddonInstallations(serverInstalled).then(() => {
        app.send('sync-installed-result', {
          clientUUID: store.clientUUID,
          installed: store.installedAddons
        });
      });
    });

    if (self.loadReason === 'install') {
      app.send('addon-self:installed');
    } else if (self.loadReason === 'enable') {
      app.send('addon-self:enabled');
    } else if (self.loadReason === 'upgrade') {
      app.send('addon-self:upgraded');
    }
  });
}

function Router(mod) {
  this.mod = mod;
  this._events = {};
  this.mod.port.on('from-web-to-addon', function(evt) {
    if (this._events[evt.type]) this._events[evt.type](evt.data);
  }.bind(this));
  return this;
}

Router.prototype.on = function(name, f) {
  this._events[name] = f;
  return this;
};

Router.prototype.send = function(name, data, addon) {
  if (addon) {
    data.tags = ['main-addon'];
    const packet = JSON.stringify({
      key: name,
      value: data,
      addonName: addon
    });
    Services.obs.notifyObserver(null, 'idea-town::send-metric', packet);
  }
  this.mod.port.emit('from-addon-to-web', {type: name, data: data});
  return this;
};

function updateExperiments() {
  // Fetch the list of available experiments
  return requestAPI({
    url: settings.BASE_URL + '/api/experiments'
  }).then(res => {
    // Index the available experiments by addon ID
    store.availableExperiments = {};
    res.json.results.forEach(exp => {
      store.availableExperiments[exp.addon_id] = exp;
    });

    // Query all installed addons
    return new Promise(resolve => AddonManager.getAllAddons(resolve));
  }).then(addons => {
    // Filter addons by known experiments, index by ID
    store.installedAddons = {};
    addons.filter(addon => isIdeatownAddonID(addon.id))
          .forEach(addon => store.installedAddons[addon.id] = addon);
    return store.installedAddons;
  });
}

function syncAllAddonInstallations(serverInstalled) {
  const availableIDs = Object.keys(store.availableExperiments);
  const clientIDs = Object.keys(store.installedAddons);
  const serverIDs = serverInstalled
    .filter(item => item.client_id === store.clientUUID)
    .map(item => item.addon_id);

  return Promise.all(availableIDs.filter(id => {
    const cidx = clientIDs.indexOf(id);
    const sidx = serverIDs.indexOf(id);
    // Both missing? Okay.
    if (cidx === -1 && sidx === -1) { return false; }
    // Both found? Okay.
    if (cidx !== -1 && sidx !== -1) { return false; }
    // One found, one not? Better sync.
    return true;
  }).map(syncAddonInstallation));
}

function uninstallExperiment(experiment) {
  if (isIdeatownAddonID(experiment.addon_id)) {
    AddonManager.getAddonByID(experiment.addon_id, a => a.uninstall());
  }
}

function installExperiment(experiment) {
  if (isIdeatownAddonID(experiment.addon_id)) {
    AddonManager.getInstallForURL(experiment.xpi_url, install => {
      install.install();
    }, 'application/x-xpinstall');
  }
}

function formatInstallData(install, addon) {
  const formatted = {
    'name': install.name || '',
    'error': install.error,
    'state': install.state,
    'version': install.version || '',
    'progress': install.progress,
    'maxProgress': install.maxProgress
  };

  if (addon) {
    Object.assign(formatted, {
      'id': addon.id,
      'description': addon.description,
      'homepageURL': addon.homepageURL,
      'iconURL': addon.iconURL,
      'size': addon.size,
      'signedState': addon.signedState,
      'permissions': addon.permissions
    });
  }

  return formatted;
}

function isIdeatownAddonID(id) {
  return id in store.availableExperiments;
}

function syncAddonInstallation(addonID) {
  const experiment = store.availableExperiments[addonID];
  const method = (addonID in store.installedAddons) ? 'put' : 'delete';
  // HACK: Use the same "done" handler for 2xx & 4xx responses -
  // 200 = PUT success, 410 = DELETE success, 404 = DELETE redundant
  const done = (res) => [addonID, method, res.status];
  return requestAPI({
    method: method,
    url: experiment.installations_url + store.clientUUID
  }).then(done, done);
}

function requestAPI(opts) {
  const headers = {
    'Accept': 'application/json',
    'Cookie': ''
  };

  const hostname = settings.HOSTNAME;
  const cookieEnumerator = cookieManager2.getCookiesFromHost(hostname);
  while (cookieEnumerator.hasMoreElements()) {
    const c = cookieEnumerator.getNext().QueryInterface(Ci.nsICookie); // eslint-disable-line new-cap
    headers.Cookie += c.name + '=' + c.value + ';';
    if (c.name === 'csrftoken') {
      headers['X-CSRFToken'] = c.value;
    }
  }

  return new Promise((resolve, reject) => {
    request({
      url: opts.url,
      headers: Object.assign(headers, opts.headers || {}),
      contentType: 'application/json',
      onComplete: res => (res.status < 400) ? resolve(res) : reject(res)
    })[opts.method || 'get']();
  });
}

// source: http://jsfiddle.net/briguy37/2mvfd/
function generateUUID() {
  let d = new Date().getTime();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = (d + Math.random() * 16) % 16 | 0;
    d = Math.floor(d / 16);
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

require('sdk/system/unload').when(function(reason) {
  metrics.destroy();
  if (reason === 'uninstall') {
    app.send('addon-self:uninstalled');
    if (store.installedAddons) {
      for (let id of store.installedAddons) { // eslint-disable-line prefer-const
        uninstallExperiment({addon_id: id});
      }
      delete store.installedAddons;
    }
    delete store.availableExperiments;
  }
});

AddonManager.addAddonListener({
  onUninstalling: function(addon) {
    if (isIdeatownAddonID(addon.id)) {
      app.send('addon-uninstall:uninstall-started', {
        id: addon.id,
        name: addon.name,
        version: addon.version
      });
    }
  },
  onUninstalled: function(addon) {
    if (isIdeatownAddonID(addon.id)) {
      app.send('addon-uninstall:uninstall-ended', {
        id: addon.id,
        name: addon.name,
        version: addon.version
      }, addon);

      if (store.installedAddons[addon.id]) {
        delete store.installedAddons[addon.id];
        syncAddonInstallation(addon.id);
      }
    }
  }
});

AddonManager.addInstallListener({
  onInstallEnded: function(install, addon) {
    if (!isIdeatownAddonID(addon.id)) { return; }
    store.installedAddons[addon.id] = addon;
    syncAddonInstallation(addon.id).then(() => {
      app.send('addon-install:install-ended',
               formatInstallData(install, addon), addon);
    });
  },
  onInstallFailed: function(install) {
    app.send('addon-install:install-failed', formatInstallData(install));
  },
  onInstallStarted: function(install) {
    app.send('addon-install:install-started', formatInstallData(install));
  },
  onNewInstall: function(install) {
    app.send('addon-install:install-new', formatInstallData(install));
  },
  onInstallCancelled: function(install) {
    app.send('addon-install:install-cancelled', formatInstallData(install));
  },
  onDownloadStarted: function(install) {
    app.send('addon-install:download-started', formatInstallData(install));
  },
  onDownloadProgress: function(install) {
    app.send('addon-install:download-progress', formatInstallData(install));
  },
  onDownloadEnded: function(install) {
    app.send('addon-install:download-ended', formatInstallData(install));
  },
  onDownloadCancelled: function(install) {
    app.send('addon-install:download-cancelled', formatInstallData(install));
  },
  onDownloadFailed: function(install) {
    app.send('addon-install:download-failed', formatInstallData(install));
  }
});
