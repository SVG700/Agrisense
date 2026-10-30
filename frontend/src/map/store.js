/**
 * Redux store used ONLY by the Pest Surveillance Map. The rest of the dashboard
 * keeps its plain React state; this module is only loaded with the map chunk.
 *
 * kepler.gl requires its reducer and its task middleware (enhanceReduxMiddleware).
 * The map starts read-only: kepler's "add data" / file-upload UI is hidden, which
 * also keeps its xlsx / parquet loaders (see DECISIONS.md, npm audit) unreachable.
 */
import { applyMiddleware, combineReducers, createStore } from 'redux';
import { enhanceReduxMiddleware, keplerGlReducer } from '@kepler.gl/reducers';

const reducer = combineReducers({
  keplerGl: keplerGlReducer.initialState({
    uiState: {
      readOnly: true,
      currentModal: null,
      activeSidePanel: null,
    },
  }),
});

export function createMapStore() {
  return createStore(reducer, {}, applyMiddleware(...enhanceReduxMiddleware([])));
}
