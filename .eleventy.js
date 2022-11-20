const UserConfig = require("@11ty/eleventy/src/UserConfig");
const tpPlugin = require("./index");

/** @param {UserConfig} eleventyConfig */
module.exports = (eleventyConfig) => {
  eleventyConfig.addPassthroughCopy('demo/css/*.css');
  eleventyConfig.addPlugin(tpPlugin, {
    remote: 'http://localhost:8040/exist/apps/tei-publisher/',
    collections: true,
    index: {
      content: {
          "view1": {
              selectors: "p,dd,li,h1,h2,h3,h4,h5,h6",
              tag: 'guidelines'
          }
      },
      title: {
          "breadcrumbs": {
              selectors: ".breadcrumb",
              allowHtml: true
          }
      }
    }
  });

  return {
    dir: {
      input: "demo",
      output: "_site"
    }
  }
};