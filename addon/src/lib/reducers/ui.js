/*
 * This Source Code is subject to the terms of the Mozilla Public License
 * version 2.0 (the 'License'). You can obtain a copy of the License at
 * http://mozilla.org/MPL/2.0/.
 */

// @flow

import * as actions from '../actions';

import type { Action } from 'testpilot/types';

export function reducer(
  // Looks like this particular reducer has its own little bit of state
  // that is probably walled off from other stores.
  state: Object = { badge: null, clicked: Date.now(), shareShown: false },
  { payload, type }: Action
) {
  switch (type) {
    case actions.SELF_INSTALLED.type:
      return Object.assign({}, state, { installTimestamp: Date.now() });

    // When the type of the currently dispatched action is actions.SET_BADGE.type,
    // update the state.ui.badge state to payload.text (i.e. _('new_badge')).
    //
    // In itself, this change doesn't produce any changes in the UI.
    // The lib/reducers/sideEffects code actually calls the function that
    // updates the UI.
    case actions.SET_BADGE.type:
      return Object.assign({}, state, { badge: payload.text });

    // Note that, when the button is clicked, the badge state is nulled out,
    // and the clicked state is set. I assume that's used in some kind of
    // telemetry ping.
    case actions.MAIN_BUTTON_CLICKED.type:
      return Object.assign({}, state, { badge: null, clicked: payload.time });

    case actions.PROMPT_SHARE.type:
      return Object.assign({}, state, { shareShown: true });

    default:
      return state;
  }
}
