const NODE_TYPE = require("jsdom/lib/jsdom/living/node-type");

/**
 * Extracts plain text of a DOM node, optionally omitting certain
 * descendant elements selected by a CSS selector.
 * 
 * @param {Node} node the DOM node to index
 * @param {string} exclude CSS selector defining elements to omit from indexing
 * @returns the plain text of the document fragment
 */
module.exports.extractPlainText = (node, exclude = "style,script") => {
    const content = [];
    _extractPlainText(node, content, exclude);
    return content.join('');
};

function _extractPlainText(node, content, exclude) {
    for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes[i];
        switch (child.nodeType) {
            case NODE_TYPE.ELEMENT_NODE:
                if (!child.matches(exclude)) {
                    _extractPlainText(child, content, exclude);
                }
                break;
            case NODE_TYPE.TEXT_NODE:
            case NODE_TYPE.CDATA_SECTION_NODE:
                content.push(child.textContent);
                break;
            default:
                break;
        }
    }
}