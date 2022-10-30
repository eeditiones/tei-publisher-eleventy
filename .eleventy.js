const UserConfig = require("@11ty/eleventy/src/UserConfig");
const tpPlugin = require("./index");

/** @param {UserConfig} eleventyConfig */
module.exports = (eleventyConfig) => {
  eleventyConfig.addPlugin(tpPlugin, {
    limit: 10
  });

  return {
    dir: {
      input: "demo",
      output: "_site"
    }
  }
};