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
              message: '组件的 properties 属性中的 {{key}} 的值必须是 Object 类型',
              data: {
                key: key
              }
            });
          }

        }
      }
    };
  }
};