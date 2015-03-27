'use strict';

var _ = require("lodash");

module.exports = function (schema, options) {
  var states = options.states;
  var transitions = options.transitions;
  var stateNames = _.keys(states);
  var transitionNames = _.keys(transitions);

  var defaultStateName = getDefaultState(states);
  var defaultState = states[defaultStateName];

  schema.add({ state: { type: String,
                        enum: stateNames,
                        default: defaultStateName } });

  if(_.has(defaultState, 'value')) {
    schema.add({ stateValue: { type: Number,
                               default: defaultState.value } });

    schema.statics.getStateValue = function(stateName) {
      return states[stateName].value;
    };
  }

  schema.virtual('_states').get(function() {
    return schema.paths.state.enumValues;
  });

  function transitionize(t) {
    return function(callback) {
      var self = this;
      var transition = transitions[t];
      var from;
      var exit;

      // if state not set yet, assume default
      if (!self.state) {
        self.state = defaultStateName;
      }

      // check validity of from state
      if(_.isString(transition.from)) {
        if('*' === transition.from) {
          from = self.state;
        } else {
          from = transition.from;
        }
      } else if(_.isArray(transition.from)) {
        from = _.find(transition.from, function(s) { return s === self.state; });
      }

      // if from state allowed for transition
      if(self.state === from) {
        self.state = transition.to;

        if(from) {
          exit = states[from].exit;
        }

        var enter = states[transition.to].enter;
        var guard = transition.guard;
        var behavior = transition.behavior;

        // evaluate transition guard
        if(_.isFunction(guard)) {
          if(!guard.apply(self)) {
            return callback(new Error('Guard failed'), self);
          }
        } else if(_.isPlainObject(guard)) {
          _.forEach(guard, function(v, k) {
            var tmp = v.apply(self);
            if(tmp) {
              self.invalidate(k, tmp);
            }
          });
          if(self.$__.validationError) {
            return callback(self.$__.validationError, self);
          }
        }

        if(_.has(defaultState, 'value')) {
          self.stateValue = states[self.state].value;
        }

        self.save(function(err) {
          if(err) {
            return callback(err, self);
          }

          if(exit) { exit.call(self); }
          if(behavior) { behavior.call(self); }
          if(enter) { enter.call(self); }
          return callback(null, self);
        });
      } else {
          return callback(new Error('Invalid transition'), self);
      }
    };
  }

  var transitionMethods = {};
  var transitionStatics = {};
  transitionNames.forEach(function(t) {
    transitionMethods[t] = transitionize(t);
    transitionStatics[t] = staticTransitionize(t);
  });
  schema.method(transitionMethods);
  schema.static(transitionStatics);
};

function staticTransitionize(transitionName) {
  return function(id, callback) {
    this.findOne({ _id: id }).exec(function(err, item) {
      if(err) {
        return callback(err);
      }
      if(!item) {
        return callback(new Error('Not found'));
      }
      item[transitionName].call(item, callback);
    });
  };
}

function getDefaultState(states) {
  var stateNames = _.keys(states);
  var selected = _.filter(stateNames, function(s) {
    return !!states[s].default;
  });
  return selected[0] || stateNames[0];
}
