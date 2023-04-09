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
      useCache: process.env['TP_NO_CACHE'] !== 'true',
      /* Limit the number of concurrent requests sent to the server */
      concurrency: 2,
      /**
       * Use this to add entries to the `tpdata` global data object. Data will be retrieved from the URL
       * given as property value. It must return JSON. The result will be stored to the global data object under 
       * the properties name.
       */
      data: {},
      index: null
  };
  
  const options = {...defaults, ...userOptions};

  const pluginInstance = new TpPlugin(options);
  eleventyConfig.addGlobalData('tpConfig', options);
  if (!options.disabled) {

    eleventyConfig.addTransform('transform-tp-components', function(content, deprecatedOutputPath) {
        const outputPath = deprecatedOutputPath || this.outputPath;
        const context = {
            outputPath,
            inputPath: this.inputPath,
            baseDir: eleventyConfig.dir ? eleventyConfig.dir.output : '_site'
        };
        return pluginInstance.addTransform(content, context);
    });
  }

  eleventyConfig.addAsyncShortcode('tpfetch', async (url) => {
    if (options.disabled) {
      return '';
    }
    return pluginInstance.fetch(url);
  });

  eleventyConfig.addGlobalData('tpdocuments', async function() {
    if (options.disabled) {
      return {};
    }
    return await pluginInstance.fetchCollections(eleventyConfig.dir ? eleventyConfig.dir.output : '_site');
  });

  eleventyConfig.addGlobalData('tpdata', async function() {
    const data = {};
    for (let entry of Object.entries(options.data)) {
      const fetched = await pluginInstance.fetch(entry[1]);
      try {
        data[entry[0]] = JSON.parse(fetched);
      } catch (e) {
        data[entry[0]] = fetched;
      }
    }
    return data;
  });
};