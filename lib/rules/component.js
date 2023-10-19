module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "检查组件的 properties 属性是否规范",
    },
    fixable: "code",
    schema: [] // 没有提供选项
  },
  create: function (context) {
    // console.log('contextxxx', context);
    return {
      // 回调函数
      Property(node) {
        const callKey = node?.parent?.parent?.parent?.parent?.callee?.name;
        const parentKey = node?.parent?.parent?.key?.name;
        const key = node?.key?.name;
        const value = node?.value?.name;
        const type = node?.value?.type;
        if (callKey === 'Component' && parentKey === 'properties') {
          // console.log({
          //   callKey,
          //   parentKey,
          //   key,
          //   value,
          //   type
          // });
          if (type === 'Literal') {
            context.report({
              node,
              message: '组件的 properties 属性中的 {{key}} 的值必须是构造类型',
              data: {
                key: key
              },
              fix(fixer) {
                const typeStr = literalType(node?.value?.value);
                return fixer.replaceText(node.value, `{ type: ${typeStr ?? 'String'}, value: ${node?.value?.raw ?? ''} }`);
              }
            });
          } else if(node?.value?.type === 'ObjectExpression' && node?.value?.properties.length === 0){
            context.report({
              node,
              message: '组件的 properties 属性中的 {{key}} 的值不能为空对象',
              data: {
                key: key
              },
              fix(fixer) {
                return fixer.replaceText(node.value, `{ type: Object, value: {} }`);
              }
            });
          } else if(node?.value?.type === 'ObjectExpression' && !node?.value?.properties.some(item => item?.key?.name === 'type')) {
            context.report({
              node,
              message: '组件的 properties 属性中的 {{key}} 的值不能 type',
              data: {
                key: key
              },
              fix(fixer) {
                return fixer.replaceText(node.value, `{ type: Object, value: {} }`);
              }
            });
          } else if(node?.value?.type === 'ArrayExpression') {
            context.report({
              node,
              message: '组件的 properties 属性中的 {{key}} 的值不能是数组',
              data: {
                key: key
              },
              fix(fixer) {
                return fixer.replaceText(node.value, `{ type: Array, value: [] }`);
              }
            });
          }

        }
      }
    };
  }
};

function literalType(literalValue) {
  const type = typeof literalValue;
  if (type === 'string') {
    return 'String';
  } else if (type === 'number') {
    return 'Number';
  } else if (type === 'boolean') {
    return 'Boolean';
  } else if (type === 'object') {
    return 'Object';
  } else if (type === 'function') {
    return 'Function';
  } else if (type === 'symbol') {
    return 'Symbol';
  } else if (type === 'undefined') {
    return 'String';
  } else {
    return;
  }
}