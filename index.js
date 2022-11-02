const UserConfig = require("@11ty/eleventy/src/UserConfig");
const { TpPlugin } = require("./plugin");

/** @param {UserConfig} eleventyConfig */
module.exports = (eleventyConfig, userOptions) => {
  const defaults = {
      /* Add option to disable the plugin */
      disabled: process.env['TP_DISABLED'] === 'true',
      /* Base URL of the app to retrieve data from */
      remote: 'http://localhost:8080/exist/apps/tei-publisher/',
      /* For debugging: limit number of pages retrieved per document or null for unlimited */
      limit: null,
      /* Browse collection contents */
      collections: false,
      /* Use caching for document lists and resources fetched via tpfetch */
      useCache: process.env['TP_NO_CACHE'] !== 'true'
  };
  
  const options = {...defaults, ...userOptions};

  const pluginInstance = new TpPlugin(options);
  if (!options.disabled) {
    eleventyConfig.addGlobalData('tp-config', options);

    eleventyConfig.addTransform('transform-tp-components', function(content, deprecatedOutputPath) {
        const outputPath = deprecatedOutputPath || this.outputPath;
        const context = {
            outputPath,
            inputPath: this.inputPath,
            baseDir: eleventyConfig.dir ? eleventyConfig.dir.output : '_site'
        };
        return pluginInstance.transform(content, context);
    });
  }

  eleventyConfig.addAsyncShortcode('tpfetch', (url) => {
    if (options.disabled) {
      return '';
    }
    return pluginInstance.fetch(url);
  });

  eleventyConfig.addGlobalData('teidocuments', async function() {
    if (options.disabled) {
      return {};
    }
    return await pluginInstance.fetchCollections(eleventyConfig.dir ? eleventyConfig.dir.output : '_site');
  });
};