Component({
  /**
   * 组件的属性列表
   */
  properties: {
    src: Object, // 经过 util.encapsulateGroupRecord() 处理过的数据 或者 { record: String, totalDuration: Number // s }
    size: String, // md, sm
    showClose: Boolean, // 是否展示删除按钮
    customStyle: {
      type: String,
    }, // 自定义样式
  },
})
