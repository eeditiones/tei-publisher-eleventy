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

class TpPlugin {

    /**
     * 
     * @param {{remote: string}} config 
     */
    constructor(config) {
        this.config = config;
        this.client = axios.create({
            baseURL: this.config.remote
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
            warn(error.toJSON());
            return null;
            // throw Error(error.code);
        });

        if (asset) {
            await asset.save(response.data, 'text');
        }
        return response.data;
    }

    /**
     * 
     * @param {string} content HTML content as string
     * @param {{inputPath: string, outputPath: string}} context context of the current request
     * @returns 
     */
    async transform(content, context) {
        const dom = new JSDOM(content);
        const { document } = dom.window;

        const views = [...document.querySelectorAll('pb-view')];
        if (views.length > 0) {
            debug('Found %s views in page %s', chalk.blue(views.length), context.outputPath);

            context = createOutputDir(context);

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
                    warn('No src attribute set for component %s in %s', chalk.blue(component), chalk.green(context.inputPath));
                    continue;
                }

                const doc = document.getElementById(srcDoc);
                docPath = doc.getAttribute('path');
                const meta = await this._loadMeta(docPath);

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

                const url = `api/parts/${encodeURIComponent(docPath)}/json`;
                log('Retrieving %s for %s', chalk.blue(component), chalk.magenta(docPath));

                let next = null;
                let counter = 1;
                do {
                    next = await this._retrieve(component, url, params, context, mapping, next, counter);
                    counter += 1;
                    if (this.config.limit && counter > this.config.limit) {
                        break;
                    }
                } while(next);
                
            }

            fs.writeFileSync(mapFile, JSON.stringify(mapping, null, 4));
        }
        return content; // no change done.
    }

    async _retrieve(name, url, params, context, mapping, root = null, counter = 1) {
        if (root) {
            params = {...params, ...root};
        }
        const response = await this.client.request({
            url,
            method: 'get',
            params
        })
        .catch(function (error) {
            console.error(error.toJSON());
            return null;
        });

        if (response && response.status === 200) {
            const outName = `${name}-${counter}.json`;
            const outFile = path.resolve(context.outputDir, outName);
            fs.writeFileSync(outFile, JSON.stringify(response.data, null, 4));

            mapping[computeKey(params)] = outName;
            if (response.data.id) {
                const paramsWithId = {...params, ...{id: response.data.id}};
                delete paramsWithId.root;
                mapping[computeKey(paramsWithId)] = outName;
            }
            if (response.data.next) {
                return { root: response.data.next };
            }
        }
        return null;
    }

    async _loadMeta(path) {
        try {
            const response = await this.client.request({
                url: `api/document/${encodeURIComponent(path)}/meta`,
                method: 'get'
            })
            .catch(function (error) {
                console.error(error.toJSON());
                return null;
                // throw Error(error.code);
            });
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
                    console.error('Failed to load CSS from %s', url);
                    console.error(error.response.data);
                    // throw Error(error.code);
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
            warn('Failed to load collection from %s', url);
            return;
        });
        const outputFile = path.resolve(dir, `${start}.html`);
        fs.writeFileSync(outputFile, response.data);
        
        const subcols = this._expandCollectionContent(response.data, docList, rootDir);
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

    _expandCollectionContent(content, docList, outputDir) {
        const dom = new JSDOM(content);
        const { document } = dom.window;
        const subcols = [];
        this._loadImages(document.querySelectorAll('img[src]'), outputDir);
        document.querySelectorAll('.document a[data-collection]')
            .forEach(link => subcols.push(link.getAttribute('data-collection')));
        document.querySelectorAll('.document a:not([data-collection])')
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

    _loadImages(images, outputDir) {
        for (const image of images) {
            const url = new URL(image.src, this.config.remote);
            if (url.toString().startsWith(this.config.remote)) {
                debug('Loading image: %s', image.src);
                this.client.request({
                    url,
                    method: 'get',
                    responseType: 'arraybuffer'
                })
                .catch(function (error) {
                    console.error('Failed to load image data from %s', url);
                })
                .then((response) => {
                    const outputFile = path.join(outputDir, image.src);
                    fs.writeFileSync(outputFile, response.data);
                });
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