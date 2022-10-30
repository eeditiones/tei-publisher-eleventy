const UserConfig = require("@11ty/eleventy/src/UserConfig");
const { TpPlugin } = require("./teipublisher");

/** @param {UserConfig} eleventyConfig */
module.exports = (eleventyConfig, userOptions) => {
  const defaults = {
      /* Base URL of the app to retrieve data from */
      remote: 'http://localhost:8080/exist/apps/tei-publisher/',
      /* For debugging: limit number of pages retrieved per document or null for unlimited */
      limit: null
  };
  
  const options = {...defaults, ...userOptions};
  const pluginInstance = new TpPlugin(options);

  eleventyConfig.addTransform('transform-tp-components', function(content, deprecatedOutputPath) {
      const outputPath = deprecatedOutputPath || this.outputPath;
      const context = {
          outputPath,
          inputPath: this.inputPath,
          baseDir: eleventyConfig.dir ? eleventyConfig.dir.output : '_foo'
      };
      return pluginInstance.transform(content, context);
  });

  eleventyConfig.addAsyncShortcode('tpfetch', (url) => {
    return pluginInstance.fetch(url);
  });
};