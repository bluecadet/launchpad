import getUrls from 'get-urls';

class JsonUtils {
    // static getUrls(json, options, include = /.+(.jpg|.jpeg|.png)/ig, excludes = /.*/ig) {
    static getUrls(json, options, include, exclude) {
        let urls = new Set();
        let config = this.getUrlOptions(options);
        
        // convert include/exclude to regexp (e.g. if they're strings)
        if (include) {
            include = new RegExp(include);
        }
        if (exclude) {
            exclude = new RegExp(exclude);
        }
        
        this.forEachLeaf(json, (value) => {
            if (!this.isString(value)) {
                return; // only parse strings
            }
            const possibleUrls = getUrls(value, config);
            for (const url of possibleUrls) {
                if (include && (include instanceof RegExp) && !url.match(include)) {
                    continue; // url doesn't match include
                }
                if (exclude && (exclude instanceof RegExp) && url.match(exclude)) {
                    continue; // url matches exclude
                }
                urls.add(url);
            }
        });
        return urls;
    }

    static getUrlOptions(userSettings) {
        return {...{
            'stripAuthentication': false,
            'stripWWW': false,
            'removeTrailingSlash': false,
            'sortQueryParameters': false
        }, ...userSettings};
    }

    static forEachLeaf(node, fn) {
        if (node === null || node === undefined || this.isFunction(node)) {
            return;
        }
        if (this.isPrimitive(node)) {
            fn(node);
            return;
        }
        for (const key of Object.keys(node)) {
            this.forEachLeaf(node[key], fn);
        }
    }

    static isFunction(arg) {
        return arg !== null && arg !== undefined && typeof arg === 'function';
    }

    static isPrimitive(arg) {
        if (arg === null || arg === undefined) {
            return false;
        }
        const t = (typeof arg);
        return t === 'string' || t === 'number' || t === 'boolean';
    }

    static isLeaf(arg) {
        return !this.isObject(arg) && !Array.isArray(arg);
    }

    static isString(arg) {
        return arg !== null && arg !== undefined && typeof arg === 'string';
    }

    static isObject(arg) {
        return arg !== null && arg !== undefined && typeof arg === 'object';
    }
}

export default JsonUtils;