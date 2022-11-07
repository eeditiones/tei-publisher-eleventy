## Eleventy Plugin for TEI Publisher

A plugin for [11ty](https://www.11ty.dev/) to embed a static view of TEI/XML resources transformed via TEI Publisher. 11ty is a popular static site generator written in Javascript. The plugin communicates with TEI Publisher's API to take a snapshot of some or all TEI documents, i.e. it basically creates a static version of the website by pre-generating all content. It does so by traversing the site's content via TEI Publishers public API, transforming all documents via the associated ODDs and storing the output into the file system. The result is a website without dynamic content: neither eXist-db nor TEI Publisher are required.

Obviously the generated website will lack some of the functionality, which requires a database backend, in particular:

* simple client-side search only
* no facetted browsing

On the upside, the resulting HTML files can be hosted on any webserver at small or no cost (e.g. using github pages). A static site is thus a viable option for small editions with a strong focus on the text presentation and requiring less advanced features.

And the best: most TEI Publisher webcomponents can be used as on a dynamic website!

### Features

The plugin consists of 3 parts:

1. a preprocessing step, which traverses the document collections exposed by the TEI Publisher instance, downloading the HTML listing for each page of documents to show. A list of all documents (and some metadata) is stored into an 11ty global data object called `teidocuments`.
2. a transformer, which will scan every HTML page generated by 11ty and search for occurrances of TEI Publisher's core view webcomponent `pb-view`. For every `pb-view` the transformer pre-loads the content of all pages which would be displayed by the component. 
3. a template shortcode, `{% tpfetch %}`, to pre-fetch other static content needed on a page, e.g. for a table of contents.

### Installation

In your existing 11ty project, install the package via npm:

```bash
npm install --save @teipublisher/pb-eleventy-plugin
```

and add the plugin in your `.eleventy.js`:

```js
const pluginTP = require('@teipublisher/pb-eleventy-plugin');

module.exports = function(eleventyConfig) {
  eleventyConfig.addPlugin(pluginTP, {
    /* Base URL of the app to retrieve data from */
    remote: 'http://localhost:8080/exist/apps/tei-publisher/',
    /* Browse collection contents */
    collections: false,
    /* Use caching for document lists and resources fetched via tpfetch */
    useCache: process.env['TP_NO_CACHE'] !== 'true',
    /* For debugging: limit number of pages retrieved per document or null for unlimited */
    limit: null,
    /* Limit the number of concurrent requests sent to the server */
    concurrency: 2,
    /**
     * Use this to add entries to the `tpdata` global data object. Data will be retrieved from the URL
     * given as property value. It must return JSON. The result will be stored to the global data object under 
     * the properties name.
     */
    data: {}
  });
};
```

Known options are:

* `remote <string>`: the base URL of the TEI Publisher app you would like to retrieve TEI documents from. This can also be a custom app generated by TEI Publisher.
* `collections <boolean>`: if set to true, the plugin will scan the document collections provided by the TEI Publisher instance and save the collection listings. It also adds all documents found to a global data object (`teidocuments`), which can be used later to automatically output a page for each document.
* `useCache <boolean>`: the plugin can cache some resources which would otherwise take a longer time to retrieve, e.g. the global list of documents
* `limit <number>`: for testing: only retrieve the first X pages for each document. This will speed up the build time.
* `concurrency <number>`: limits the number of concurrent requests sent to the server.
* `data <object>`: downloads JSON data from the server and adds it to the global data object named `tpdata`. Data will be loaded from the URL given as value of each property. It should be in JSON format. The result will be stored to the global data object under the properties' name. For example, the following `data` definition will retrieve JSON data from `api/people` and you can later use it in templates via the variable `tpdata.people`:
  ```javascript
  data: {
    "people": "api/people"
  }
  ```

### Writing templates

You can use any of TEI Publisher's webcomponents within a 11ty template. The transformer installed by the plugin will automatically detect the relevant components and pre-load the required data to make them work in a static environment. The only requirements to pay attention to are:

1. every `pb-view` in the page should reference a `pb-document` in its `@src` attribute, which defines the basic parameters needed to process the document, i.e. the relative path to the document in `@path`, the `@odd` to be used for the transformation and the `@view` mode ('page', 'div', 'single'). The `pb-view` may also overwrite the `@odd` and `@view` attributes defined on the `pb-document`.
2. the `@odd` and `@view` need to correspond to the actual ODD and view mode being used by TEI Publisher when transforming the document. This means: if your document overwrites those settings via a processing instruction, fetching the content may not work.
3. every `pb-view` and `pb-browse-docs` requires an additional attribute `@static` to signal the component that it operates in static mode.
4. somewhere in your template chain you must import TEI Publisher's javascript library, e.g. from CDN:
   ```html
   <script type="module" src="https://cdn.jsdelivr.net/npm/@teipublisher/pb-components@latest/dist/pb-components-bundle.js"></script>
   ```

Have a look at the provided demo templates:

* [documentation.njk](demo/documentation.njk) 
* [dta.njk](demo/dta.njk)
* [index.md](demo/index.njk)

### Running the Demo

This repository contains a simple demo website to generate a static copy of the default TEI Publisher website. Before starting the build, you should have a default TEI Publisher instance running on port 8080 (or change the port in [.eleventy.js](.eleventy.js) accordingly).

1. clone the repository
2. run `npm install` once
3. start the build process and launch a webserver with `npm start`
4. once the build has completed, browse to the indicated URL (`http://localhost:8081` by default)