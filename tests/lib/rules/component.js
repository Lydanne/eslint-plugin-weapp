const { RuleTester } = require('eslint');
const { readFileSync } = require('fs');

// console.log(code);
const ruleTester = new RuleTester();

ruleTester.run("component", require('../../../lib/rules/component.js'), {
  valid: [
    {
      code: readFileSync('./examples/component-valid.js', 'utf8'),
    }
  ],

  invalid: [
    {
      code: readFileSync('./examples/component-invalid.js', 'utf8'),
      errors: [{ message: "组件的 properties 属性中的 xxxx 的值必须是 Object 类型" }]
    },
  ]
});