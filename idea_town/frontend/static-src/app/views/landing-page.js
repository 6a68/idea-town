import app from 'ampersand-app';

import BaseView from './base-view';

// TODO replace with an api endpoint that exposes idea town addon info
const addonInfo = {
  name: window.sadface.addon.name,
  url: window.sadface.addon.url
};

export default BaseView.extend({
  _template: `
            {{^loggedIn}}
              <div class="sign-up" id="cta">
                <div id="main-content">
                  <div id="tabzilla">
                    <a href="https://www.mozilla.org/">Mozilla</a>
                  </div>
                  <div class="firefox-logo"></div>
                  <h1 class="hero">Introducing Idea Town</h1>
                  <h2 class="sub-hero">We're building the next generation of<br> Firefox features and we want your feedback! <br>Get started with a Firefox Account.</h2>
                  <div class="cta-layout-wrapper">
                    <div class="cta-layout">
                      <a href="/accounts/login/?next=/home"><button class="button large primary">Sign up</button></a>
                      <a href="/accounts/login/?next=/home" class="fxa-alternate">Already have an account? Sign in.</a>
                      <p class="cta-legal">By proceeding, you agree to the Terms of Service and Privacy Notice of Idea Town.</p>
                    </div>
                    <div class="town"></div>
                  </div>
                </div>
              </div>
            {{/loggedIn}}
            {{#loggedIn}}
              <div class="add-on" id="cta">
                <div id="main-content">
                  <div id="tabzilla">
                    <a href="https://www.mozilla.org/">Mozilla</a>
                  </div>
                  <div class="firefox-logo"></div>
                  <h1 class="hero">Thanks for Signing up!</h1>
                  <h2 class="sub-hero">Install the Idea Town Add-on to participate<br> in experiments and give us feedback<br></h2>
                  <div class="cta-layout-wrapper">
                    <div class="cta-layout">
                      <a href="{{ downloadUrl }}"><button class="button large primary">Install the Add-on</button></a>
                    </div>
                    <div class="town"></div>
                  </div>
                </div>
                <div id="footer">
                </div>
            {{/loggedIn}}
              `,
  render() {
    this.loggedIn = !!app.me.session;
    this.downloadUrl = addonInfo.url;
    BaseView.prototype.render.apply(this, arguments);
  }
});
