/**
 * @fileoverview a weapp eslint
 * @author eslint-plugin-weapp
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const requireIndex = require("requireindex");

//------------------------------------------------------------------------------
// Plugin Definition
//------------------------------------------------------------------------------


// import all rules in lib/rules
module.exports.rules = requireIndex(__dirname + "/rules");

module.exports.configs = {
  MyConfig: {
    globals: {
      Component: true
    }
  }
}



// import processors
module.exports.processors = {
  // add your processors here
};

