"use strict";

const path = require("node:path");
const { RuleTester } = require("eslint");

require("../../../lib");
const { clearCache } = require("../../../lib/import/app-json");
const rule = require("../../../lib/rules/wx-navigate");

const ROOT = path.resolve(__dirname, "../../fixtures/miniprogram");
const PROJECT_CONFIG = path.resolve(__dirname, "../../fixtures/project.config.json");

function file(...segments) {
  return path.join(ROOT, ...segments);
}

function opts(extra) {
  return [Object.assign({ projectConfigPath: PROJECT_CONFIG }, extra || {})];
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
    // 1. 未配置 projectConfigPath 且找不到 project.config.json → 规则静默跳过
    {
      code: "wx.navigateTo({ url: '/pages/not-found/not-found' });",
      filename: path.resolve(__dirname, "../../no-project/pages/index/index.js"),
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
    // 4b. 以 app.json 注册页面为准：页面文件不存在但已注册也合法
    {
      code: "wx.navigateTo({ url: '/pages/registered-only/registered-only' });",
      filename: file("pages/index/index.js"),
      options: opts(),
    },
    // 4c. 相对路径最终也归一化为 app.json 里的 page stem
    {
      code: "wx.navigateTo({ url: '../detail/detail' });",
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
    // 13a. 关闭 crossSubpackage 子开关后：分包 → 分包 静默
    {
      code: "wx.switchTab({ url: '/subB/pages/b1/b1' });",
      filename: file("subA/pages/a1/a1.js"),
      options: opts({ checks: { crossSubpackage: false } }),
    },
    // 13b. 关闭 mainImportSubpackage 子开关后：主包 → 分包 静默
    {
      code: "wx.redirectTo({ url: '/subA/pages/a1/a1' });",
      filename: file("pages/index/index.js"),
      options: opts({ checks: { mainImportSubpackage: false } }),
    },
    // 13c. 关闭 independentCross 子开关后：独立分包 → 外部 静默
    {
      code: "wx.reLaunch({ url: '/pages/index/index' });",
      filename: file("subInd/pages/i1/i1.js"),
      options: opts({ checks: { independentCross: false } }),
    },
    // 14. ignorePatterns：匹配到的 url 整条跳过
    {
      code: "wx.redirectTo({ url: '/subA/pages/a1/a1' });",
      filename: file("pages/index/index.js"),
      options: opts({ ignorePatterns: ["^/subA/"] }),
    },
    // 15. 未配置 projectConfigPath 时，自动向上查找 project.config.json 定位 app.json
    {
      code: "wx.navigateTo({ url: '/pages/detail/detail' });",
      filename: file("pages/index/index.js"),
    },
    // 16. 公共模块不是 app.json 注册页面：只校验目标注册，不做源页面分包边界推断
    {
      code: "wx.navigateTo({ url: '/subA/pages/a1/a1' });",
      filename: file("utils/util.js"),
      options: opts(),
    },
    // 17. 公共模块里的相对跳转无法静态确定运行时页面，安全跳过
    {
      code: "wx.navigateTo({ url: '../subA/pages/a1/a1' });",
      filename: file("utils/util.js"),
      options: opts(),
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
    // 1b. 文件存在但未在 app.json 注册，仍然视为非法页面
    {
      code: "wx.navigateTo({ url: '/components/hello/hello' });",
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
    // 7. projectConfigPath 指向不存在文件 → 文件级报一次
    {
      code: "wx.navigateTo({ url: '/pages/index/index' });",
      filename: file("pages/index/index.js"),
      options: [
        {
          projectConfigPath: path.resolve(
            __dirname,
            "../../fixtures/__missing_project.config.json"
          ),
        },
      ],
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
