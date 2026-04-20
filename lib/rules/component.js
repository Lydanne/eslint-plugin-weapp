module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "检查组件的 properties 属性是否规范",
    },
    fixable: "code",
    messages: {
      literalType: "组件的 properties 属性中的 {{key}} 的值必须是构造类型",
      emptyObject: "组件的 properties 属性中的 {{key}} 的值不能为空对象",
      missingType: "组件的 properties 属性中的 {{key}} 的值缺少 type 字段",
      arrayValue: "组件的 properties 属性中的 {{key}} 的值不能是数组",
    },
    schema: [],
  },
  createOnce(context) {
    return {
      Property(node) {
        const callKey = node?.parent?.parent?.parent?.parent?.callee?.name;
        const parentKey = node?.parent?.parent?.key?.name;
        const key = node?.key?.name;
        const type = node?.value?.type;

        if (callKey === 'Component' && parentKey === 'properties') {
          if (type === "Literal") {
            context.report({
              node,
              messageId: "literalType",
              data: {
                key,
              },
              fix(fixer) {
                const typeStr = literalType(node?.value?.value);
                return fixer.replaceText(
                  node.value,
                  `{ type: ${typeStr ?? "String"}, value: ${node?.value?.raw ?? ""} }`,
                );
              },
            });
          } else if (
            node?.value?.type === "ObjectExpression" &&
            node?.value?.properties.length === 0
          ) {
            context.report({
              node,
              messageId: "emptyObject",
              data: {
                key,
              },
              fix(fixer) {
                return fixer.replaceText(node.value, `{ type: Object, value: {} }`);
              },
            });
          } else if (
            node?.value?.type === "ObjectExpression" &&
            !node?.value?.properties.some((item) => item?.key?.name === "type")
          ) {
            context.report({
              node,
              messageId: "missingType",
              data: {
                key,
              },
              fix(fixer) {
                return fixer.replaceText(node.value, `{ type: Object, value: {} }`);
              },
            });
          } else if (node?.value?.type === "ArrayExpression") {
            context.report({
              node,
              messageId: "arrayValue",
              data: {
                key,
              },
              fix(fixer) {
                return fixer.replaceText(node.value, `{ type: Array, value: [] }`);
              },
            });
          }
        }
      },
    };
  },
};

function literalType(literalValue) {
  switch (typeof literalValue) {
    case "string":
      return "String";
    case "number":
      return "Number";
    case "boolean":
      return "Boolean";
    case "object":
      return "Object";
    case "function":
      return "Function";
    case "symbol":
      return "Symbol";
    case "undefined":
      return "String";
    default:
      return undefined;
  }
}
