"use strict";

const path = require("node:path");
const { RuleTester } = require("eslint");

// 先加载插件主入口，确保 @oxlint/plugins 把 create 挂到规则对象上
require("../../../lib");
const { clearCache } = require("../../../lib/import/app-json");
const rule = require("../../../lib/rules/wx-navigate");

const ROOT = path.resolve(__dirname, "../../fixtures/miniprogram");
const APP_JSON = path.join(ROOT, "app.json");

function file(...segments) {
  return path.join(ROOT, ...segments);
}

function opts(extra) {
  return [Object.assign({ appJsonPath: APP_JSON }, extra || {})];
}

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
});

clearCache();

ruleTester.run("wx-navigate", rule, {
  valid: [
    // 1. 未配置 appJsonPath → 规则静默跳过（无参 wx.navigateTo 也应该不报）
    {
      code: "wx.navigateTo({ url: '/pages/not-found/not-found' });",
      filename: file("pages/index/index.js"),
    },
    // 2. 合法页面跳转
    {
      code: "wx.navigateTo({ url: '/pages/detail/detail' });",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 3. 带 query 参数
    {
      code: "wx.redirectTo({ url: '/pages/detail/detail?id=1' });",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 4. 带 hash
    {
      code: "wx.navigateTo({ url: '/pages/detail/detail#foo' });",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 5. 动态 url（非字面量）→ 跳过
    {
      code: "wx.navigateTo({ url });",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    {
      code: "const p = '/x'; wx.navigateTo({ url: p });",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    {
      code: "wx.redirectTo({ url: `/pages/${name}/index` });",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 6. 非 wx 开头的跳转调用 → 规则不管
    {
      code: "router.navigateTo({ url: '/pages/not/found' });",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 7. 不在 apis 白名单内的 API → 默认只管这四个，其它忽略
    {
      code: "wx.someOtherApi({ url: '/pages/not/found' });",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 8. 动态 url 走 alias 后指向合法主包页面
    {
      code: "wx.navigateTo({ url: '@/pages/detail/detail' });",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 9. 文件不在 miniprogramRoot 下 → 跳过
    {
      code: "wx.navigateTo({ url: '/pages/not/found' });",
      filename: path.resolve(__dirname, "../../fixtures/outside.js"),
      options: opts(),
    },
    // 10. 裸名/协议类 url 不在校验范围
    {
      code: "wx.navigateTo({ url: 'plugin://foo/bar' });",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 11. apis 选项覆盖：只校验 navigateTo，redirectTo 被忽略
    {
      code: "wx.redirectTo({ url: '/pages/not-found/not-found' });",
      filename: file("pages/index/index.js"),
      options: opts({ apis: ["navigateTo"] }),
    },
    // 12. 禁用所有检查 → 不报
    {
      code: "wx.navigateTo({ url: '/pages/not-found/not-found' });",
      filename: file("pages/index/index.js"),
      options: opts({
        checks: { pathExists: false, packageBoundary: false },
      }),
    },
  ],

  invalid: [
    // 1. 跳转到不存在页面
    {
      code: "wx.navigateTo({ url: '/pages/not/found' });",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [{ messageId: "notResolved" }],
    },
    // 2. 主包 → 分包
    {
      code: "wx.redirectTo({ url: '/subA/pages/a1/a1' });",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [{ messageId: "mainImportSubpackage" }],
    },
    // 3. 分包 → 分包
    {
      code: "wx.switchTab({ url: '/subB/pages/b1/b1' });",
      filename: file("subA/pages/a1/a1.js"),
      options: opts(),
      errors: [{ messageId: "crossSubpackage" }],
    },
    // 4. 独立分包 → 主包
    {
      code: "wx.reLaunch({ url: '/pages/index/index' });",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts(),
      errors: [{ messageId: "independentCross" }],
    },
    // 5. alias 展开后仍不存在 → notResolved，带原始 request
    {
      code: "wx.navigateTo({ url: '@/pages/not/found' });",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [
        { messageId: "notResolved", data: { request: "@/pages/not/found" } },
      ],
    },
    // 6. alias 展开后穿越分包边界 → mainImportSubpackage
    {
      code: "wx.redirectTo({ url: '@/subA/pages/a1/a1' });",
      filename: file("pages/index/index.js"),
      options: opts(),
      errors: [{ messageId: "mainImportSubpackage" }],
    },
    // 7. appJsonPath 指向不存在文件 → 文件级报一次
    {
      code: "wx.navigateTo({ url: '/pages/index/index' });",
      filename: file("pages/index/index.js"),
      options: [{ appJsonPath: path.join(ROOT, "__missing__.json") }],
      errors: [{ messageId: "appJsonNotFound" }],
    },
    // 8. apis 选项扩展：支持自定义跳转函数
    {
      code: "wx.customNavigate({ url: '/pages/not/found' });",
      filename: file("pages/index/index.js"),
      options: opts({ apis: ["navigateTo", "customNavigate"] }),
      errors: [{ messageId: "notResolved" }],
    },
  ],
});
