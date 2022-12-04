const { JSDOM } = require("jsdom");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const mkdirp = require("mkdirp");
const chalk = require("chalk");
const debug = require("debug")("tei-publisher");
const { DateTime } = require("luxon");
const { AssetCache } = require("@11ty/eleventy-fetch");

function log(input, ...messages) {
    console.log(`${chalk.cyan('[tei-publisher]')} ${input}`, ...messages);
}

function warn(input, ...messages) {
    console.warn(`${chalk.red('[tei-publisher]')} ${input}`, ...messages);
}

/**
 * @typedef {Object} Context
 * @property {string} inputPath
 * @property {string} outputPath
 * @property {string} baseDir
 */

/**
 * @typedef {Object} Config - Configuration options supported by the plugin
 * @property {string} remote
 * @property {Object} data
 * @property {Index} [index]
 * @property {Number} concurrency=2
 * @property {Number|null} limit=null
 * @property {boolean} collections=false
 * @property {boolean} useCache
 * @property {boolean} disabled=false
 */

/**
 * @typedef {{string: Function}} Index - Index configuration options
 */


class TpPlugin {

    /**
     * @param {Config} config 
     */
    constructor(config) {
        /** @type {Config} */
        this.config = config;
        this.client = axios.create({
            baseURL: this.config.remote,
            headers: {
                'Accept-Encoding': 'identity'
            }
        });
        this.queue = null;
        import('p-queue').then(({ default: PQueue }) => {
            this.queue = new PQueue.default({concurrency: this.config.concurrency, autoStart: true});
        });
    }

    /**
     * Fetch contents of a single resource by URL.
     * 
     * @param {string} url 
     * @returns Promise<string>
     */
    async fetch(url) {
        let asset;
        if (this.config.useCache) {
            asset = new AssetCache(url);
            if(asset.isCacheValid("1d")) {
                // return cached data.
                return asset.getCachedValue(); // a promise
            }
        }

        debug(`Fetching ${chalk.magenta(url)}`);
        const response = await this.client.request({
            url,
            method: 'get',
            responseType: 'text'
        })
        .catch(function (error) {
            const err = error.toJSON();
            debug('Failed to fetch %s: %s', chalk.bgRed(err.config.url), err.message);
        });
        if (!response) {
            return `Failed to fetch ${url}`;
        }
        if (asset) {
            await asset.save(response.data, 'text');
        }
        return response.data;
    }

    async addTransform(content, context) {
        return this.queue.add(() => this.transform(content, context));
    }

    /**
     * 
     * @param {string} content HTML content as string
     * @param {Context} context context of the current request
     * @returns 
     */
    async transform(content, context) {
        const dom = JSDOM.fragment(content);

        const views = [...dom.querySelectorAll('pb-view')];
        if (views.length > 0) {
            debug('Found %s views in page %s', chalk.blue(views.length), context.outputPath);

            context = createOutputDir(context);

            let componentsChanged = false;
            const mapping = {};
            const mapFile = path.resolve(context.outputDir, 'index.json');
            let oldMap = {};
            if (fs.existsSync(mapFile)) {
                oldMap = JSON.parse(fs.readFileSync(mapFile));
            }

            for (let i = 0; i < views.length; i++) {
                const component = views[i].id || `_v${1 + i}`;
                let params = {};
                const srcDoc = views[i].getAttribute('src');
                let docPath = '';

                if (!srcDoc) {
                    debug('No src attribute set for component %s in %s', chalk.blue(component), chalk.green(context.inputPath));
                    continue;
                }

                const doc = dom.getElementById(srcDoc);
                docPath = doc.getAttribute('path');
                const meta = await this._loadMeta(docPath);
                if (!meta) {
                    throw new Error(`Failed to load metadata for ${docPath}`);
                }
                const lastModified = DateTime.fromISO(meta.lastModified);
                const firstPageData = path.join(context.outputDir, `${component}-1.json`);
                if (fs.existsSync(firstPageData)) {
                    const fileStat = fs.statSync(firstPageData);
                    if (lastModified < DateTime.fromMillis(fileStat.mtimeMs)) {
                        debug('Skipping component %s for %s as it is unchanged', chalk.blue(component), chalk.magenta(docPath));
                        const testRegex = new RegExp(`^${component}-`);
                        for (const [key, value] of Object.entries(oldMap)) {
                            if (testRegex.test(value)) {
                                mapping[key] = value;
                            }
                        }
                        continue;
                    }
                }

                if (meta.odd) {
                    params.odd = meta.odd;
                }
                if (meta.view) {
                    params.view = meta.view;
                }
                getAttributes(doc, ['view', 'odd', 'view'], params);

                getParameters(views[i], getAttributes(views[i], ['view', 'odd', 'xpath'], params));

                this._checkCSS(params, context);

                log('Retrieving %s for %s', chalk.blue(component), chalk.magenta(docPath));

                let next = null;
                let counter = 1;
                const images = [];
                do {
                    next = await this._retrieve(component, docPath, params, context, mapping, next, counter, images);
                    counter += 1;
                    if (this.config.limit && counter > this.config.limit) {
                        break;
                    }
                } while(next);
                
                await this._loadImages(images, context.outputDir, `${this.config.remote}${docPath}`);

                componentsChanged = true;
            }

            fs.writeFileSync(mapFile, JSON.stringify(mapping, null, 4));

            if (componentsChanged) {
                this._index(context);
            }
        }
        return content; // no change done.
    }

    async _retrieve(name, docPath, params, context, mapping, root = null, counter = 1, images) {
        const url = `api/parts/${encodeURIComponent(docPath)}/json`;
        if (root) {
            params = {...params, ...root};
        }
        const response = await this.client.request({
            url,
            method: 'get',
            params
        })
        .catch(function (error) {
            const err = error.toJSON();
            debug('Failed to retrieve fragment %s: %s', chalk.bgRed(err.config.url), err.message);
            debug(err);
            return null;
        });

        if (response && response.status === 200) {
            
            const outName = `${name}-${counter}.json`;
            const outFile = path.resolve(context.outputDir, outName);
            if (!response.data.content) {
                debug('No content received for %s', chalk.bgRed(url));
                return null;
            }
            const dom = new JSDOM(response.data.content);
            const { transformed, ids } = 
                await this._expandPageContent(
                    dom, 
                    images, 
                    `${this.config.remote}/${docPath}`
                );
            response.data.content = transformed;
            fs.writeFileSync(outFile, JSON.stringify(response.data, null, 4));

            mapping[computeKey(params)] = outName;
            if (response.data.id) {
                ids.push(response.data.id);
            }
            this._addById(mapping, outName, params, ids);
            
            if (response.data.next) {
                return { root: response.data.next };
            }
        }
        return null;
    }

    _addById(mapping, outName, params, ids) {
        const paramsNoRoot = {...params};
        delete paramsNoRoot.root;
        ids.forEach(id => {
            const paramsWithId = {...paramsNoRoot, ...{id}}
            mapping[computeKey(paramsWithId)] = outName;
        });
    }

    async _expandPageContent(dom, images, baseURI) {
        const document = dom.window.document;
        document.querySelectorAll('img[src]').forEach((img) => images.push(img.src));
        document.querySelectorAll('a[href]').forEach((link) => {
            const url = new URL(link.href, baseURI);
            if (url.toString().startsWith(this.config.remote)) {
                link.setAttribute('href', `/${link.getAttribute('href')}`);
            }
        });
        const ids = document.querySelectorAll('[id]');
        return {
            transformed: dom.serialize(),
            ids: Array.from(ids).map((elem) => elem.getAttribute('id'))
        };
    }

    /**
     * 
     * @param {Context} context
     */
    _index(context) {
        if (!(this.config.index)) {
            return;
        }
        debug(`Indexing files in ${context.outputDir}...`);
        const indexFile = path.join(context.baseDir, 'index.jsonl');
        for (const [component, indexDef] of Object.entries(this.config.index)) {
            let counter = 1;
            while (true) {
                const file = path.join(context.outputDir, `${component}-${counter}.json`);
                if (fs.existsSync(file)) {
                    const json = JSON.parse(fs.readFileSync(file));
                    const dom = JSDOM.fragment(json.content);
                    if (typeof indexDef === 'function') {
                        let entries = indexDef.call(null, dom, json, context.outputDir);
                        if (!Array.isArray(entries)) {
                            entries = [entries];
                        }
                        entries.forEach(entry => {
                            fs.writeFileSync(indexFile, JSON.stringify(entry) + '\n', {
                                flag: 'a'
                            });
                        });
                    }
                } else {
                    break;
                }
                counter += 1;
            }
        }
    }

    async _loadMeta(path) {
        try {
            const response = await this.client.request({
                url: `api/document/${encodeURIComponent(path)}/meta`,
                method: 'get'
            })
            .catch(function (error) {
                const err = error.toJSON();
                debug('Failed to load metadata from %s: %s', chalk.bgRed(err.config.url), err.message);
            });
            if (!response) {
                return null;
            }
            return response.data;
        } catch(e) {
            return null;
        }
    }

    async _checkCSS(params, context) {
        if (params.odd) {
            if (!fs.existsSync(context.baseDir)) {
                mkdirp.sync(context.baseDir)
            }
            const file = `${params.odd.substring(0, params.odd.length - 4)}.css`;
            const url = `transform/${file}`;
            const outDir = path.resolve(context.baseDir, 'css');
            mkdirp.sync(outDir);
            const outFile = path.resolve(outDir, file);
            if (!fs.existsSync(outFile)) {
                this.client.request({
                    url,
                    method: 'get'
                })
                .then((response) => {
                    fs.writeFileSync(outFile, response.data);
                })
                .catch(function (error) {
                    const err = error.toJSON();
                    debug('Failed to load CSS from %s: %s', chalk.bgRed(err.config.url), err.message);
                });
            }
        }
    }

    async fetchCollections(dir) {
        const docList = [];
        if (this.config.collections) {
            await this._fetchCollection(null, 1, dir, path.resolve(dir, 'collections'), docList);
        }

        let asset;
        if (this.config.useCache) {
            asset = new AssetCache('tp-teidocuments');
            if(asset.isCacheValid("1d")) {
                // return cached data.
                return asset.getCachedValue(); // a promise
            }
        }

        debug('Retrieving document metadata ...');
        const result = {};
        for (let i = 0; i < docList.length; i++) {
            const meta = await this._loadMeta(docList[i]);
            const entry = {
                path: docList[i],
                odd: 'teipublisher',
                view: 'div',
                template: 'view'
            };
            if (meta) {
                entry.odd = meta.odd.substring(0, meta.odd.length - 4);
                entry.view = meta.view;
                entry.template = meta.template.replace(/\.html$/, '');
            }
            const oldEntry = result[entry.template];
            if (oldEntry) {
                oldEntry.push(entry);
            } else {
                result[entry.template] = [entry];
            }
        }
        if (asset) {
            await asset.save(result, "json");
        }
        return result;
    }
    
    async _fetchCollection(collection, start, rootDir, dir, docList) {
        mkdirp.sync(dir);
        const url = collection ? `api/collection/${encodeURIComponent(collection)}`: 'api/collection/';
        log('Retrieving collection %s; start = %s', collection || '/', start);
        const response = await this.client.request({
            url,
            method: 'get',
            params: { start }
        })
        .catch(function (error) {
            const err = error.toJSON();
            debug('Failed to load collection %s from %s: %s', chalk.bgRed(collection), err.config.url, err.message);
        });
        if (!response) {
            return;
        }
        const outputFile = path.resolve(dir, `${start}.html`);
        fs.writeFileSync(outputFile, response.data);
        
        const subcols = await this._expandCollectionContent(response.data, docList, rootDir);
        const total = response.headers['pb-total'];
        if (total && start + 10 < total) {
            await this._fetchCollection(collection, start + 10, rootDir, dir, docList);
        }

        for (let i = 0; i < subcols.length; i++) {
            await this._fetchCollection(
                collection ? `${collection}/${subcols[i]}` : subcols[i], 
                1,
                path.resolve(rootDir, subcols[i]),
                path.resolve(dir, subcols[i]), 
                docList
            );
        }
    }

    async _expandCollectionContent(content, docList, outputDir) {
        const dom = JSDOM.fragment(content);
        const subcols = [];
        const images = Array.from(dom.querySelectorAll('img[src]'), (elem) => elem.src);
        await this._loadImages(images, outputDir, this.config.remote);
        dom.querySelectorAll('.document a[data-collection]')
            .forEach(link => subcols.push(link.getAttribute('data-collection')));
        dom.querySelectorAll('.document a:not([data-collection])')
            .forEach(link => {
                if (link.href) {
                    if (/\.md$/.test(link.href)) {
                        return;
                    }
                    const url = new URL(link.href, this.config.remote);
                    if (url.toString().startsWith(this.config.remote)) {
                        docList.push(link.href);
                    }
                }
            });
        return subcols;
    }

    async _loadImages(images, outputDir, baseURI) {
        for (let i = 0; i < images.length; i++) {
            const url = new URL(images[i], baseURI);
            if (url.toString().startsWith(this.config.remote)) {
                debug('Loading image: %s', url);
                const response = await this.client.request({
                    url,
                    method: 'get',
                    responseType: 'arraybuffer'
                })
                .catch(function (error) {
                    const err = error.toJSON();
                    debug('Failed to load image data from %s: %s', chalk.bgRed(err.config.url), err.message);
                });
                if (response && response.status === 200) {
                    const outputFile = path.join(outputDir, images[i]);
                    const imageDir = path.dirname(outputFile);
                    mkdirp.sync(imageDir);
                    fs.writeFileSync(outputFile, response.data);
                }
            }
        }
    }
}

function computeKey(params) {
    const encParams = [];
    Object.keys(params).sort().forEach((key) => {
        encParams.push(`${key}=${params[key]}`);
    });
    return encParams.join('&');
}

function createOutputDir(context) {
    const outputDir = path.dirname(context.outputPath);
    if (!fs.existsSync(outputDir)) {
        mkdirp.sync(outputDir);
    }
    return {...context, ...{ outputDir }};
}

function getAttributes(elem, attributes, properties) {
    attributes.forEach((attr) => {
        if (elem.hasAttribute(attr)) {
            if (attr === 'odd') {
                properties[attr] = `${elem.getAttribute(attr)}.odd`;
            } else {
                properties[attr] = elem.getAttribute(attr);
            }
        }
    });
    return properties;
}

function getParameters(elem, properties) {
    const params = elem.querySelectorAll('pb-param');
    params.forEach((param) => {
        properties[`user.${param.getAttribute('name')}`] = param.getAttribute('value');
    });
    return properties;
}

module.exports = { TpPlugin };