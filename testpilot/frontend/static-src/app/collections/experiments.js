import app from 'ampersand-app';
import Collection from 'ampersand-rest-collection';

import Experiment from '../models/experiment';

export default Collection.extend({
  model: Experiment,
  indexes: ['slug'],
  url: '/api/experiments.json',
  usageCountsUrl: '/api/experiments/usage_counts.json',
  comparator: 'order',

  // Ampersand.sync doesn't seem to pass correct Accept headers by default.
  // This supposedly is fixed by https://github.com/AmpersandJS/ampersand-sync/pull/24
  // but still seems busted. Maybe the deps of the dependents haven't been
  // updated yet? TODO: investigate
  ajaxConfig: { headers: { 'Accept': 'application/json' }},

  initialize() {
    app.on('webChannel:addon-self:uninstalled', () => {
      this.models.forEach(m => m.enabled = false);
    });
  },

  fetch(optionsIn) {
    // Fetch usage counts and experiment content in parallel.
    return Promise.all([
      fetch(this.usageCountsUrl).then(response => response.json()),
      new Promise((resolve, reject) => {
        const options = optionsIn || {};
        options.success = resolve;
        options.error = reject;
        Collection.prototype.fetch.call(this, options);
      })
    ]).then(([counts, coll]) => {
      // Update all the fetched models with corresponding usage counts
      this.forEach(item => item.installation_count = counts[item.addon_id] || 0);
      return coll;
    });
  },

  // django-rest-framework returns the actual models under 'results'
  parse(response) {
    return response.results;
  }
});
