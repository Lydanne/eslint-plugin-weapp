const { RuleTester } = require("eslint");
const rule = require("../../../lib/rules/component");

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

ruleTester.run("component", rule, {
  valid: [
    {
      code: `
        Component({
          properties: {
            src: Object,
            size: String,
            customStyle: {
              type: String,
            },
          },
        });
      `,
    },
  ],

  invalid: [
    {
      code: `
        Component({
          properties: {
            title: "",
          },
        });
      `,
      output: `
        Component({
          properties: {
            title: { type: String, value: "" },
          },
        });
      `,
      errors: [{ messageId: "literalType" }],
    },
    {
      code: `
        Component({
          properties: {
            config: {},
          },
        });
      `,
      output: `
        Component({
          properties: {
            config: { type: Object, value: {} },
          },
        });
      `,
      errors: [{ messageId: "emptyObject" }],
    },
    {
      code: `
        Component({
          properties: {
            options: {
              value: {},
            },
          },
        });
      `,
      output: `
        Component({
          properties: {
            options: { type: Object, value: {} },
          },
        });
      `,
      errors: [{ messageId: "missingType" }],
    },
    {
      code: `
        Component({
          properties: {
            list: [],
          },
        });
      `,
      output: `
        Component({
          properties: {
            list: { type: Array, value: [] },
          },
        });
      `,
      errors: [{ messageId: "arrayValue" }],
    },
  ]
});
