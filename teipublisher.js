const { JSDOM } = require("jsdom");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const mkdirs = require("mkdirp");
const chalk = require("chalk");

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
        console.log(`Fetching ${chalk.magenta(url)}`);
        return this.client.request({
            url,
            method: 'get',
            responseType: 'text'
        })
        .then((response) => {
            return response.data;
        })
        .catch(function (error) {
            console.error(error.toJSON());
            throw Error(error.code);
        });
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
            console.log('Found %s views in page %s', chalk.blue(views.length), context.inputPath);

            context = createOutputDir(context);
            const mapping = {};
            for (let i = 0; i < views.length; i++) {
                let params = {};
                const srcDoc = views[i].getAttribute('src');
                let docPath = '';
                if (srcDoc) {
                    const doc = document.getElementById(srcDoc);
                    docPath = doc.getAttribute('path');
                    const meta = await this._loadMeta(docPath);
                    if (meta.odd) {
                        params.odd = meta.odd;
                    }
                    if (meta.view) {
                        params.view = meta.view;
                    }
                    getAttributes(doc, ['view', 'odd', 'view'], params);
                }
                getParameters(views[i], getAttributes(views[i], ['view', 'odd', 'xpath'], params));

                this._checkCSS(params, context);

                const url = `api/parts/${encodeURIComponent(docPath)}/json`;
                const component = views[i].id || `_v${1 + i}`;
                console.log('Retrieving %s from %s', chalk.blue(component), chalk.magenta(url));

                let next = null;
                let counter = 1;
                do {
                    next = await this._retrieve(component, url, params, context, mapping, next, counter);
                    counter += 1;
                } while(next && counter <= 10);
                
            }

            const mapFile = path.resolve(context.outputDir, 'index.json');
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
            throw Error(error.code);
        });

        if (response.status === 200) {
            const outName = `${name}-${counter}.json`;
            const outFile = path.resolve(context.outputDir, outName);
            fs.writeFileSync(outFile, JSON.stringify(response.data, null, 4));

            mapping[this._getKey(params)] = outName;
            if (response.data.id) {
                const paramsWithId = {...params, ...{id: response.data.id}};
                delete paramsWithId.root;
                mapping[this._getKey(paramsWithId)] = outName;
            }
            if (response.data.next) {
                return { root: response.data.next };
            }
        }
        return null;
    }

    _getKey(params) {
        const encParams = [];
        Object.keys(params).sort().forEach((key) => {
            encParams.push(`${key}=${params[key]}`);
        });
        return encParams.join('&');
    }

    async _loadMeta(path) {
        const response = await this.client.request({
            url: `api/document/${encodeURIComponent(path)}/meta`,
            method: 'get'
        })
        .catch(function (error) {
            console.error(error.toJSON());
            throw Error(error.code);
        });
        return response.data;
    }

    async _checkCSS(params, context) {
        if (params.odd) {
            if (!fs.existsSync(context.baseDir)) {
                mkdirs(context.baseDir)
            }
            const file = `${params.odd.substring(0, params.odd.length - 4)}.css`;
            const url = `transform/${file}`;
            const outDir = path.resolve(context.baseDir, 'css');
            mkdirs(outDir);
            const outFile = path.resolve(outDir, file);
            if (!fs.existsSync(outFile)) {
                this.client.request({
                    url,
                    method: 'get'
                })
                .catch(function (error) {
                    console.error('Failed to load CSS from %s', url);
                    console.error(error.response.data);
                    throw Error(error.code);
                })
                .then((response) => {
                    fs.writeFileSync(outFile, response.data);
                });
            }
        }
    }

}

function createOutputDir(context) {
    const outputDir = path.dirname(context.outputPath);
    if (!fs.existsSync(outputDir)) {
        mkdirs(outputDir);
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