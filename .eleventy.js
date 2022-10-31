const UserConfig = require("@11ty/eleventy/src/UserConfig");
const tpPlugin = require("./index");

/** @param {UserConfig} eleventyConfig */
module.exports = (eleventyConfig) => {
  eleventyConfig.addPassthroughCopy('demo/css/*.css');
  eleventyConfig.addPlugin(tpPlugin, {
    remote: 'http://localhost:8080/exist/apps/tei-publisher/',
    collections: true
  });

  return {
    dir: {
      input: "demo",
      output: "_site"
    }
  }
};